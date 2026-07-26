# Importer

Bun/TypeScript, läuft als Dokploy-Application im Container. Der Container bleibt über `health.ts` oben; die Läufe stößt ein Schedule Job per `docker exec` an (`bun run sync`) — jeder Lauf ist damit ein frisch startender Prozess.

Was hier an Fallstricken steckt und schon einmal zugeschlagen hat, steht gesammelt in
`fehlerkatalog.md` — besonders die Abschnitte zum partiellen Eindeutigkeitsindex und dazu,
warum ein Lauf früher an jedem Verbindungsfehler starb.

## Eine Schlange, kein Modus-Unterschied

Es gibt **keinen** getrennten Backfill- und Sync-Modus. Beides sind Einträge in `sync.warteschlange`, die ein einzelner Worker konstant und langsam abarbeitet:

| Priorität | Bedeutung |
|---|---|
| 10 | Tagesberichte (gestern), täglich eingereiht — legen Betriebe und Artikel an |
| 12 | `analyticsFilterOptions` — braucht die Betriebe, liefert deren LINA-ID |
| 14 | `getKennzahlen` — braucht die LINA-ID |
| 20 | übrige Momentaufnahmen — brauchen den Artikelkatalog |
| 50 | Nacharbeit nach Fehlern |
| 90 | Historie, rückwärts |

Aktuelle Daten können damit nie hinter dem Backfill verhungern, und es gibt nur einen Codepfad statt zweier, die auseinanderlaufen.

**12 und 14 sind keine Feinheit, sondern eine echte Kette.** Ein Tagesbericht legt die Betriebe an — ihr Schlüssel ist LINAs `encId`, und die kommt nur dort vor. `analyticsFilterOptions` heftet ihnen die *numerische* LINA-ID an, verbunden über den Namen, weil `encId` in dieser Antwort fehlt. Und `getKennzahlen` kennt Betriebe ausschließlich über diese Zahl. Reißt die Kette, meldet der Posten trotzdem `ok` und `core.kennzahlen_monat` bleibt leer — am 26.07.2026 sind so 7.860 BWA-Zeilen durchgefallen. Genauso still hängt `articleApi:franchise` am Artikelverkaufsbericht: es ordnet Warengruppen nur Artikeln zu, die `core.artikel` schon kennt.

Die Reihenfolge steht in `einreihPrioritaet()` in `src/lina/endpunkte.ts` und wird dort getestet. Zusätzlich schreibt der Lader es als `error` mit Handlungsanweisung, wenn keine einzige BWA-Zeile zugeordnet werden konnte — die Reihenfolge soll stimmen, aber ihr Bruch darf nicht mehr leise sein.

## Der tägliche Lauf holt ein Fenster, nicht einen Tag

**LINAs Konzernberichte füllen sich über mehrere Tage.** Am 26.07.2026 gegen die echte Instanz gemessen:

| Geschäftstag | Betriebe mit Umsatz | Netto |
|---|---|---|
| 25.07. | 0 | 0 € |
| 24.07. | 0 | 0 € |
| 23.07. | 0 | 0 € |
| 22.07. | 0 | 0 € |
| 21.07. | 21 | 13.268 € |
| 20.07. | 51 | 236.999 € |
| 19.07. | 55 | 351.168 € |
| 18.07. | 56 | 557.031 € |
| 17.07. | 56 | 399.054 € |

Ab dem 17.07. steht die Zahl der Betriebe stabil bei 56 — davor läuft sie hoch. Die Anlaufzeit beträgt also rund fünf bis sechs Tage.

„Gestern" zu holen liefert damit verlässlich Nullen. Und weil der Posten danach als erledigt gilt und `historie_einreihen()` bewusst nichts Erledigtes noch einmal einreiht, bliebe dieser Tag **für immer** auf null. Zahlen dieser Sorte sind schlimmer als fehlende: eine Lücke sieht man, eine Null nicht.

Deshalb reiht `--taeglich` die letzten `NACHZUEGLER_TAGE` (Voreinstellung 10) Geschäftstage ein. Die Zieltabellen sind Upserts, ein zweiter Abruf korrigiert den ersten also einfach. Kosten: 8 Endpunkte × 10 Tage = 80 Aufrufe am Tag, bei einem Tagesbudget von 3.000.

**`ON CONFLICT DO NOTHING` ist hier genau richtig — und zwar aus demselben Grund, aus dem es in `historie_einreihen()` genau falsch war.** Der Eindeutigkeitsindex ist partiell (`WHERE erledigt_am IS NULL`) und blockiert nur noch *offene* Posten. Für den Backfill hieß das: alles Erledigte wird erneut geholt, ein teurer Fehler. Für das Nachlauffenster heißt dasselbe: derselbe Tag wird nicht doppelt eingereiht, solange er noch aussteht, aber sehr wohl erneut, wenn er fertig ist. Genau das soll er.

## Was ein laufender Import von sich zeigt

Erfolge gingen früher nach `debug`. Zwischen zwei Posten liegen 20 bis 40 Sekunden, ein Backfill war auf `info` also stundenlang vollkommen still und von einem Hänger nicht zu unterscheiden — am 26.07.2026 wurde deshalb ein intakter Lauf für tot gehalten und abgebrochen.

Es gibt jetzt eine Fortschrittszeile mit Endpunkt, Zeitraum, Zeilen, Position im Lauf, offener Schlange und geschätzter Restdauer. `FORTSCHRITT_ALLE` steuert die Häufigkeit; die Voreinstellung unterscheidet lokal von Produktion, ohne dass jemand etwas setzen muss:

| Umgebung | Voreinstellung | Wirkung |
|---|---|---|
| Terminal (TTY) | 1 | jede Zeile — da will jemand zusehen |
| Container | 50 | etwa alle 25 Minuten ein Lebenszeichen |
| `FORTSCHRITT_ALLE=0` | — | aus |

Die Restdauer kommt aus dem **tatsächlich gemessenen** Tempo dieses Laufs, nicht aus dem eingestellten Takt. Sie schwankt deshalb am Anfang und wird nach ein paar Dutzend Posten belastbar — dafür bleibt sie ehrlich, wenn LINA langsamer antwortet als gedacht.

`sync.posten_holen()` reserviert mit `FOR UPDATE SKIP LOCKED` — aktuell läuft nur ein Worker, aber die Sperre kostet nichts und erspart einen späteren Umbau. `sync.haengende_posten_freigeben()` räumt Reservierungen auf, die ein Absturz hinterlassen hat.

## Momentaufnahmen — die dritte Sorte Posten

Berichte und Momentaufnahmen sind fachlich verschiedene Dinge, und der Unterschied ist nicht kosmetisch:

| | Bericht | Momentaufnahme |
|---|---|---|
| Zeitbezug | ein Tag/Monat/Jahr, abgeschlossener Fakt | nur „jetzt" |
| Wiederholung | liefert in fünf Jahren dasselbe | LINA **überschreibt**, alter Stand ist weg |
| Einreihung | täglich bzw. jährlich | monatlich, auf den Monatsersten |
| Backfill | ja | **nein** — rückwärts existiert nichts |

Betroffen sind die sieben Stammdaten-Endpunkte (`schrittweite: 'momentaufnahme'`, `ebene: 'stamm'`): `articleApi:franchise`, `analyticsFilterOptions`, `wawi:items`, `wawi:suppliers`, `wawi:units`, `wawi:orders`, `wawi:inventory`. Zusammen kosten sie sieben Anfragen im Monat.

**Warum das überhaupt gebaut wurde:** Eine Verkaufsmenge ohne den Einkaufspreis und die Warengruppe, die *damals* galten, ist eine Zahl ohne Bedeutung. `prices[].updated` verrät nur, wann zuletzt geändert wurde — nicht, was vorher galt. **Was heute nicht gesichert wird, ist rückwirkend nicht nachholbar.** Genau derselbe Fehler steckte bis `0007` im eigenen Schema, wo `core.artikel` den `fixer_we` überschrieb.

`--historie` überspringt diese Endpunkte ausdrücklich und protokolliert das. Ein Backfill über sie würde hundertmal denselben heutigen Stand holen und die Historie trotzdem nicht herstellen.

Drei Eigenheiten, die beim Bau Zeit gekostet haben und deshalb im Code festgenagelt sind:

- **`artnr`, nicht `id`.** `articleApi` liefert beides; nur `artnr` trifft die Artikelnummern des Verkaufsberichts. Gemessen: 3 von 3 gegen 0 von 3, verschiedene Zahlenräume (`id 19324` vs. `artnr 300213`).
- **`prices` ist mal Objekt, mal leeres Array.** PHPs `json_encode` macht aus einem leeren Array `[]` und erst aus einem gefüllten assoziativen Array `{}`. 594 Waren mit Objekt, 304 mit `[]`, kein einziger gefüllter Array-Fall. Ohne diesen Zweig meldete jede Momentaufnahme eine Schemaabweichung.
- **Inventurtermine kommen mehrfach je Tag** — 11 Sätze auf 4 Tage, teils mit widersprüchlichem `isEditable`. Ohne Zusammenfassung scheitert der `INSERT` an „ON CONFLICT DO UPDATE command cannot affect row a second time". Zusammengefasst wird als „bearbeitbar, wenn irgendeiner es sagt".

**Lieferanten unterliegen der Datenminimierung.** Die Antwort hat 28 Felder, darunter `ustid`, `hrb`, `kreditor`, `gegenkonto*`, `tel`, `email` und die Anschrift von 540 Geschäftspartnern. Gespeichert werden fünf: ID, Name, aktiv, Mindestbestellwert, Liefertage. Durchgesetzt wird das in `transform.lieferanten()` — namentliches Auslesen, **kein Spread**; ein `...rest` hätte hier den gegenteiligen Effekt. Ein Test in `transform.test.ts` und einer im Ende-zu-Ende-Test nageln es fest, letzterer sogar auf Ebene der Tabellenspalten.

## Drosselung

Die Drosselung ist keine Höflichkeit, sondern das, was die Integration am Leben hält: kein offizieller Zugang, keine dokumentierten Limits, **keine Rate-Limit-Header** (in Phase 1 geprüft — es gibt schlicht keine).

| Variable | Vorgabe | Wirkung |
|---|---|---|
| `TAKT_MIN_MS` / `TAKT_MAX_MS` | 20.000 / 40.000 | zufällige Pause je Request, kein fester Rhythmus |
| `TAGESBUDGET` | 2.000 | harte Obergrenze je Kalendertag |
| `FENSTER_VON_STUNDE` / `_BIS_` | 7 / 23 | Arbeitsfenster in Berliner Zeit |
| `MAX_VERSUCHE` | 4 | danach wird ein Posten aufgegeben |
| `ABBRUCH_NACH_FEHLERN` | 10 | Fehler in Folge → Lauf stoppt |

**Tagsüber, nicht nachts.** Ein einzelner Client um drei Uhr früh ist im Log ein Ausreißer; dieselben Anfragen im Tagesverkehr von 141 Betrieben fallen nicht auf. Zusätzlich laufen LINAs eigene Importe (BWA vom Steuerberater) vermutlich nachts.

Die tatsächlich gewartete Zeit steht je Aufruf in `sync.aufgabe.wartezeit_ms` — die Drosselung ist damit im Nachhinein prüfbar, nicht nur behauptet.

Wiedervorlage nach Fehlern: exponentiell mit Jitter, gedeckelt bei sechs Stunden. Nie im festen Takt nachfassen.

## Drei Fehlerarten, die auseinandergehalten werden

| | Bedeutung | Reaktion |
|---|---|---|
| `ok` | Daten da | schreiben, quittieren |
| **`keine_daten`** | HTTP 500 **mit leerem Body** — der Betrieb hat für diesen Bericht nichts | quittieren, **kein Retry** |
| `fehler` | alles andere | Wiedervorlage oder aufgeben |

Der mittlere Fall ist der wichtigste: Er sieht wie ein Serverfehler aus, ist aber Normalzustand. Ein Retry darauf läuft in eine Endlosschleife.

Anmeldefehler werden **nie** wiederholt — falsche Zugangsdaten mehrfach zu senden ist der schnellste Weg zu einer Kontosperre.

## Session

LINA kennt keine API-Schlüssel und kein OAuth, nur Formular-Login und ein httpOnly-Sessioncookie. Der Service meldet sich mit `LINA_USER` / `LINA_PASSWORD` an und hält das Cookie **nur im Speicher** — nichts auf Platte, nichts in die Datenbank, nichts ins Log.

### Der Anmeldeablauf

Aus `/js/common/login.js` rekonstruiert, nachdem der erste echte Lauf mit `Login 200, Probe 302` gescheitert war. Das sichtbare Formular führt in drei Punkten in die Irre:

| | Was das Formular nahelegt | Was tatsächlich passiert |
|---|---|---|
| Ziel | POST auf `/login` (kein `action`-Attribut) | POST auf **`/common/index/dologin`** |
| Passwort | Klartext | **MD5-Hex** (`hex_md5(password)`) |
| Felder | `source`, `username`, `password`, `system` | **genau** `username`, `password`, `secret`, `system` |

Das `secret` sind 64 Hex-Zeichen, die als `window.secret` in der Loginseite stehen, je Aufruf neu vergeben und nur einmal akzeptiert werden. Die Loginseite muss deshalb **vor jeder** Anmeldung geholt werden — sie setzt in einem Aufruf das Sessioncookie und liefert das `secret`.

`source` gehört **nicht** in den POST. `login.js` liest es zwar aus dem Formular, benutzt es aber nur, um zu entscheiden, wohin der Browser nach dem Erfolg springt.

#### Die Antwort auf `dologin`

`login.js` fordert `dataType: "json"` an und entscheidet an `response.status === "SUCCESS"`. **LINA antwortet immer mit HTTP 200 und JSON — auch im Fehlerfall.** Der Statuscode taugt hier zu gar nichts:

```json
{"status":"SUCCESS","url":"\/common\/dashboard\/index"}
{"status":"ERROR","message":"Benutzername oder Passwort ist falsch!"}
```

Im Fehlerfall zeigt `login.js` `message` dem Nutzer wörtlich an. **Diese Meldung ist die verlässlichste Auskunft, die es an dieser Stelle gibt, und `src/lina/auth.ts` reicht sie wörtlich in den Fehler durch.** Bis zum 25.07.2026 stand dort nur die Länge der Antwort („Antwort 69 Bytes"), was die eigentliche Ursache als Hash- und Systemproblem getarnt hat.

Zusätzlich geprüft wird danach, ob `/common/api/account` JSON liefert: `status: SUCCESS` heißt nur, dass der Passwortschritt anerkannt wurde, nicht, dass die Sitzung nutzbar ist.

#### Zwei-Faktor-Authentifizierung

`login.js` enthält `one_doTwoFa()`, das einen Code an **`/common/index/dotwofaauth`** postet. Auf der anonym geholten Loginseite ist die Maske nicht enthalten — sie kommt erst nach dem Passwortschritt. Für unseren Zugang war sie bisher nie aktiv.

Falls sie es wird, sieht das so aus: `dologin` meldet `SUCCESS`, `/common/api/account` antwortet trotzdem mit 401. `auth.ts` erkennt genau diese Kombination und sagt es explizit. **Unbeaufsichtigt ist ein zweiter Faktor nicht bedienbar** — der Dienst braucht dann einen Zugang ohne 2FA.

#### Hashverfahren

SHA-256 steht in LINAs Code auskommentiert vorbereitet (`//var passwordHidden = forge_sha256(password);`, die Loginseite lädt `sha256.js` bereits mit). Aktiv ist MD5. Stellt LINA um, reicht `LINA_PASSWORD_HASH=sha256` — Code bleibt unverändert.

`src/lina/mock.ts` bildet diesen Ablauf streng nach und lehnt ab, was das echte LINA ablehnt. Sonst würde der Ende-zu-Ende-Test einen Anmeldeablauf grün melden, den es so nicht gibt — genau der Fall, der zu dem gescheiterten ersten Lauf führte.

**Die Attrappe hatte selbst diesen Fehler:** Sie antwortete auf einen fehlgeschlagenen `dologin` mit HTML und auf einen erfolgreichen mit `302`. Das echte LINA schickt beides nie — es ist immer 200 mit JSON. Der Test war damit grün auf einem Ablauf, den es nicht gibt. Seit dem 25.07.2026 antwortet die Attrappe mit demselben JSON wie das Original.

### Widerlegte Annahmen zum Anmeldeablauf

Der wertvollste Teil dieses Abschnitts. Stand 25.07.2026, nach drei gescheiterten Läufen (`Login 200, Probe 401`):

| Annahme | Befund |
|---|---|
| Der Statuscode von `dologin` sagt etwas aus | **Nein.** Immer 200, Erfolg wie Misserfolg. Nur `status` im JSON zählt. |
| Ein Fehlschlag liefert HTML | **Nein.** JSON, mit einer verwertbaren `message`. Die Attrappe behauptete das Gegenteil. |
| `Probe 401` deutet auf ein Transportproblem | **Nein.** Der Transport war in Ordnung; LINA lehnte die Zugangsdaten ab und sagte das auch. |
| `LINA_PASSWORD_HASH` könnte falsch sein | **Nein.** `login.js` nutzt unverändert `hex_md5`. Eine alte, nicht mehr gelesene Variable `LINA_PASSWORD_SHA256=true` in der `.env` hatte diese Fährte gelegt. |
| Node-MD5 und LINAs `hex_md5` könnten sich unterscheiden | **Hier nicht.** Paul-Johnstons `md5.js` gibt es in einer UTF-8- und einer Latin-1-Variante; für **reines ASCII sind beide byte-identisch** mit Node. Nur bei Zeichen jenseits von ASCII wäre das eine echte Fehlerquelle. |
| `system` könnte falsch sein | **Nein.** `a360` ist korrekt. |
| Die Zugangsdaten in der `.env` sind falsch | **Nein — sie kamen nur nie vollständig an.** Siehe unten. Das war die Ursache. |

#### Die eigentliche Ursache: die `.env` verstümmelte das Passwort

Das Passwort war korrekt. Es erreichte LINA nur nie vollständig.

In der `.env` stand es **unquotiert** und enthielt `$` und `#`. Bun macht daraus zwei Dinge, beide still und ohne Warnung:

1. `$name` wird als Variable **expandiert** — ist sie unbekannt, verschwindet der Ausdruck ersatzlos. Das passiert **auch in einfachen Anführungszeichen**; Quotieren allein genügt bei Bun also nicht.
2. `#` beginnt einen **Kommentar** — alles dahinter fällt weg.

Aus 25 Zeichen wurden so 9. Der Importer schickte brav den MD5 dieses Fragments, und LINA antwortete völlig zu Recht „Benutzername oder Passwort ist falsch!". Die Meldung stimmte die ganze Zeit — nur nicht über das, was vermutet wurde.

Richtig ist **Anführungszeichen und `\$`** (alle vier Werte nachgemessen):

```bash
FALSCH:   LINA_PASSWORD=Ab$cdef1ghi&!jklm#nopqrs2       ->  8 Zeichen
FALSCH:   LINA_PASSWORD='Ab$cdef1ghi&!jklm#nopqrs2'     -> 16 (Quotes allein: $ expandiert doch)
FALSCH:   LINA_PASSWORD=Ab\$cdef1ghi&!jklm#nopqrs2      -> 17 (Maskierung allein: # kommentiert doch)
RICHTIG:  LINA_PASSWORD='Ab\$cdef1ghi&!jklm#nopqrs2'    -> 25
```

Damit das nie wieder tagelang sucht, loggt der Start jetzt `passwortLaenge` (die Länge, nie den Wert). Stimmt die Zahl nicht mit dem tatsächlichen Passwort überein, ist der Wert verstümmelt — sichtbar in der ersten Logzeile statt nach drei Fehlanmeldungen. Am selben Tag hat genau diese Zeile eine kaputte Nachbearbeitung abgefangen, bevor ein Request rausging.

Die Lehre, zweifach:

* Die Ursache stand von Anfang an wörtlich in der Antwort. Sie wurde nur weggeworfen, bevor sie jemand lesen konnte. **Wenn ein Fremdsystem eine Fehlermeldung mitschickt, gehört sie in den eigenen Fehler** — jede selbstgebaute Prüfreihenfolge daneben ist Raterei.
* **Ein Geheimnis, das man nie zu Gesicht bekommt, muss man an seiner Form prüfen.** Länge, Zeichenklassen, Rundreise durch den Parser — das verrät nichts und hätte hier sofort gereicht.

### Neuanmeldung

Es wird nicht vorsorglich neu angemeldet. Erst wenn eine Antwort erkennbar abgelaufen ist (HTML statt JSON, Weiterleitung auf `/login`), wird einmal neu angemeldet und der Aufruf wiederholt. Eine Anmeldung pro Tag fällt nicht auf, Anmeldungen im Minutentakt schon. Parallele Anmeldeversuche teilen sich eine Promise.

### Wie sich der Client ausgibt

Voreingestellt ist **aktuelles Chrome Stable auf Windows 10/11** — die häufigste Kombination in einem deutschen Firmennetz und damit die, die in keinem Log auffällt.

Entscheidend ist nicht die Kennung allein, sondern dass alles zusammenpasst. Chrome schickt auf HTTPS immer Client-Hints (`sec-ch-ua`, `sec-ch-ua-platform`, `sec-ch-ua-mobile`) und Fetch-Metadaten (`sec-fetch-dest/mode/site`) mit. Ein Aufruf mit Chrome-Kennung, aber ohne diese Header, ist auffälliger als einer ganz ohne Kennung — die Kombination gibt es bei keinem echten Browser. `src/lina/auth.ts` unterscheidet deshalb dieselben zwei Fälle wie Chrome: Seitenaufruf (`dokument`, beim Holen der Loginseite) und Hintergrundaufruf (`xhr`, alles andere).

Die Versionsnummer in `sec-ch-ua` wird aus `LINA_USER_AGENT` gelesen, nicht separat gepflegt — sonst widersprächen sich Kennung und Hints nach der ersten Änderung. Wird die Kennung angehoben, ziehen die Hints automatisch nach. **Nicht auf eine ältere Version zurückstellen:** Chrome aktualisiert sich still, eine ein Jahr alte Version fällt mehr auf als gar keine Angabe.

Der `Zugang` (Basis-URL, Benutzer, Passwort, Hashverfahren, System, Kennung) wird der `LinaSession` als Wert übergeben, nicht aus der globalen Konfiguration gelesen. Das macht ihn testbar — und hält die Tür für die Idee offen, dass sich später jeder Nutzer mit seinen eigenen LINA-Zugangsdaten anmeldet.

## Berichtsregister

`src/lina/endpunkte.ts` ist die einzige Stelle, an der steht, welche Berichte geholt werden, wie ihre Parameter aussehen und in welcher Schrittweite sie eingereiht werden. Ein neuer Bericht ist ein Eintrag, kein Codeumbau.

Deaktiviert eingetragen und begründet: `getReport:38` (Stornobericht — wird bei Concept Family nicht genutzt) und `getReport:97`.

Zwei Ebenen mit unterschiedlichem Datumsformat:
- Konzern `/intranet/analytics/…` — alle 141 Betriebe je Antwort, `01.06.2026`
- Betrieb `/finanzen/analytics/…` — ein Betrieb je Antwort (`storeId`), `1.6.2026` **ohne führende Null**

## Transformationen

`src/transform/index.ts` enthält reine Funktionen: JSON rein, Zeilen raus. Kein Datenbankzugriff, keine Uhr, kein Zufall — deshalb testbar. Die Tests laufen gegen die **echten** anonymisierten Antworten aus der Exploration (`docs/payloads/`, identisch mit `src/transform/fixtures/`).

Fallstricke, die dort abgefangen werden:
- **Kennzahlen deduplizieren:** Sicherheitsnetz über den Betriebsschlüssel. Erwartet wird ein Vorkommen je Betrieb; der Name „Karlsruhe" taucht zwar fünfmal auf, das sind aber fünf Restaurants mit fünf Schlüsseln. Käme ein Schlüssel doch doppelt, vervielfachten sich die Werte still.
- **Stunden 0–7 gehören zum Vortag** (Geschäftstag 08:00–07:59).
- **Artikel ohne Verkauf überspringen:** sonst 141 × 6.451 Zeilen pro Tag statt der tatsächlich verkauften.
- **`avgTicket`/`avgGuest` kommen fertig** — nicht selbst aus Umsatz/Rechnungen rechnen, das weicht bei Nullwerten ab.

## Schreiben

`src/sync/laden.ts` schreibt in **einer** Transaktion: erst `raw.api_antwort`, dann Stammdaten, dann `core`. Entweder ein Posten ist ganz da oder gar nicht.

Weicht die Struktur vom zod-Schema ab, wird **nicht verworfen** — die Daten landen trotzdem im Raw-Layer, und die Abweichung geht nach `sync.schema_abweichung`. Nachträglich transformieren geht jederzeit, ohne LINA anzufassen.

## Tests

39 Tests, wiederholbar:

- **Transformationen** gegen die echten Payloads
- **Zeitfunktionen** als Kreuzprobe gegen die SQL-Gegenstücke, inklusive beider Zeitumstellungen und mit absichtlich falsch gesetztem `TZ`
- **Arbeitsfenster** — hier saß ein echter Bug (siehe unten)
- **Ende-zu-Ende** gegen `src/lina/mock.ts`: Warteschlange → Client → Transformation → `core`. Die Attrappe bildet LINAs Eigenheiten nach, nicht ein ideales API: Formular-Login, Sessionablauf mitten im Lauf, HTTP 500 mit leerem Body.

Der Ende-zu-Ende-Test braucht `TEST_DATABASE_URL`; ohne die Variable wird er übersprungen.

### Zwei Bugs, die dieser Test gefunden hat

1. **`Intl.DateTimeFormat` mit `de-DE`** liefert bei reiner Stundenausgabe `"22 Uhr"`. `Number()` darauf ist `NaN`, damit war das Arbeitsfenster dauerhaft geschlossen und der Importer wäre nie gelaufen. Jetzt `formatToParts` mit `en-GB` — und ein eigener Test dafür.
2. **`date`-Spalten kommen als `Date`-Objekt zurück**, nicht als String. Alles, was ein ISO-Datum erwartet, lief in eine Ausnahme, bevor der erste Request rausging. Jetzt `alsIsoDatum()` am Übergang — und in `src/db/pool.ts` ist der DATE-Parser abgeschaltet, damit `pg` daraus gar nicht erst ein Date in Ortszeit baut (das kann den Tag verschieben).
