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

Deshalb reiht `--taeglich` die letzten `NACHZUEGLER_TAGE` (Voreinstellung 10) Geschäftstage ein. Die Zieltabellen sind Upserts, ein zweiter Abruf korrigiert den ersten also einfach. Kosten: 8 Endpunkte × 10 Tage = 80 Aufrufe am Tag, bei einem Tagesbudget von 6.000.

**`ON CONFLICT DO NOTHING` ist hier genau richtig — und zwar aus demselben Grund, aus dem es in `historie_einreihen()` genau falsch war.** Der Eindeutigkeitsindex ist partiell (`WHERE erledigt_am IS NULL`) und blockiert nur noch *offene* Posten. Für den Backfill hieß das: alles Erledigte wird erneut geholt, ein teurer Fehler. Für das Nachlauffenster heißt dasselbe: derselbe Tag wird nicht doppelt eingereiht, solange er noch aussteht, aber sehr wohl erneut, wenn er fertig ist. Genau das soll er.

## Wenn LINA dichtmacht

Der einzige Fall, den man nicht abwarten kann, sondern bauen muss — und der teuerste, wenn er falsch behandelt wird. **Es gibt genau einen Zugang, und eine Kontosperre wäre nicht rückgängig zu machen.**

Vier Signale gelten als Sperre:

| Signal | `art` | Basispause |
|---|---|---|
| HTTP 429 | `http_429` | `SPERRE_PAUSE_STUNDEN` (6) |
| HTTP 403 | `http_403` | 6 |
| HTML-Abwehrseite statt JSON (`captcha`, `cloudflare`, `access denied`, …) | `challenge` | 6 |
| die **Anmeldung** selbst schlägt fehl | `anmeldung` | `SPERRE_ANMELDUNG_STUNDEN` (24) |

**Die Sperre läuft von selbst ab.** Niemand muss etwas freigeben — nach einem Tag versucht es der Importer erneut. Ein Tag ist lang genug, dass eine Tagesbegrenzung bei LINA sicher zurückgesetzt ist, und kurz genug, dass der Rückstand aufholbar bleibt.

Ein `Retry-After`-Header gilt als **Untergrenze**. Die Pause verdoppelt sich je weiterer Sperre der letzten 24 Stunden, höchstens zweimal: 24 → 48 → 96 Stunden. Wer dreimal am Tag gesperrt wird, hat ein anderes Problem als wer einmal gesperrt wird — dann soll ein Mensch hinsehen, und dafür gibt es `/status`.

Was dann passiert:

1. **Der Posten bleibt offen.** Er wird *nicht* als `aufgegeben` quittiert, und sein verbrauchter Versuch wird zurückgegeben. Mit dem Zeitraum ist nichts verkehrt, nur mit dem Zugang — ihn abzuschreiben wäre eine Falschaussage über die Daten.
2. **Der Lauf endet sofort.** Nicht erst nach `ABBRUCH_NACH_FEHLERN`. Zehn weitere Anfragen gegen ein System, das gerade „nein" gesagt hat, sind genau das Gegenteil von dem, was man will.
3. **Die Pause steht in `sync.zugangssperre`**, nicht im Prozess. Sonst wäre sie beim stündlichen Neustart wieder weg — dieselbe Lektion wie beim Tagesbudget.
4. **Der nächste Lauf nimmt gar keinen Kontakt auf.** Die Prüfung steht vor der Laufsperre und vor jeder Anmeldung: auch ein Login ist Kontakt.

**Beim Anmeldefehler wird in diesem Prozess kein zweites Mal angemeldet.** Bis zum 26.07.2026 tat der Code genau das — zehnmal in Folge, stündlich wiederholt, gegen ein sperrbares Konto. Siehe `fehlerkatalog.md`.

Nachsehen und — wenn man nicht warten will — abkürzen:

```sql
SELECT * FROM mart.zugangssperre;          -- Erwartung: leer
SELECT sync.sperre_aufheben('eugene');     -- Abkürzung, nicht Bedingung
```

Das Aufheben ist **nicht nötig**. Wer es trotzdem tut, sollte sich vorher im Browser angemeldet und nachgesehen haben: blind aufzuheben schickt den Importer sofort zurück in dieselbe Sperre — und verlängert sie, weil die Verdopplung greift.

## Was ein Sync-Lauf synchron hält — vollständig aufgezählt

Nachgeprüft am 10.08.2026, weil die Frage gestellt wurde. **Ein** Zeitplan (`bun run sync`)
löst alles hier aus:

| Quelle | Was nachgezogen wird | Wie oft | Wo |
|---|---|---|---|
| **LINA** | jeder aktive Endpunkt mit Schrittweite *Tag*, über das Nachzügler-Fenster | jeder Lauf | `linaNachfuellen` |
| **LINA** | Jahresberichte des laufenden Jahres (BWA wird rückwirkend gebucht) | jeder Lauf | dito |
| **LINA** | Stammdaten-Momentaufnahmen | einmal je Kalendermonat | dito |
| **FoodNotify** | Betriebe, Kostenstellen, POS-Standorte | einmal je Kalendermonat | `foodnotifyNachfuellen` |
| **FoodNotify** | letzte Bestellseite je Kostenstelle → Köpfe und Positionen | jeder Lauf | dito |
| **FoodNotify** | letzte Inventurseite je Marke → Zählungen und Positionen | jeder Lauf | `inventurenNachfuellen` |
| **Yext** | Stände je Betrieb/Monat/Portal, Kennzahl, einzelne Bewertungen | alle 20 h | `yextNachlauf` |
| **Yext** | Themen, Antwortverhalten, Notenverteilung, Sichtbarkeit | alle 20 h | dito, seit 10.08.2026 |
| *abgeleitet* | Auswahllisten, Deckungsbeitrag, Round Table, Einkaufspreis-Prüfung | jeder Lauf | Nachläufe in `sync.ts` |

**LINA ist vollständig per Bauart, nicht per Pflege.** `linaNachfuellen` läuft über
`AKTIVE_ENDPUNKTE` und gruppiert nach Schrittweite — wer einen Endpunkt auf `aktiv: true`
stellt, bekommt das Nachziehen geschenkt. Es gibt hier keine zweite Liste, die man vergessen
könnte.

**FoodNotify und Yext sind es nicht.** Dort steht jeder Abruf einzeln im Quelltext, und
genau daraus ist am 10.08.2026 ein Fehler entstanden (`fehlerkatalog.md`: „Ein Importer, der
die Hälfte des Imports nicht kennt"). Für Yext hält das jetzt ein Test fest
(`src/yext/nachlauf.test.ts`): jede exportierte `*Laden`- oder `*Fuellen`-Funktion muss im
Nachlauf vorkommen, sonst schlägt er fehl.

### Was der Sync ausdrücklich NICHT tut

Die beiden **Backfills** — `einreihen --historie` und `einreihen --foodnotify` — bleiben
Handarbeit. Das ist keine Lücke, sondern eine Entscheidung: sie stellen Zehntausende Posten
ein, und das soll eine Entscheidung sein, kein Nebeneffekt eines Neustarts. Der laufende
Abgleich holt das jeweils neue Ende der Liste; der Backfill holt ihren Anfang.

## Wann jemand hinsehen muss: `/status`

Der Container läuft über `health.ts` und beantwortet zwei **verschiedene** Fragen an zwei Endpunkten. Sie zu vermischen wäre gefährlich:

| Endpunkt | Frage | Wer fragt | 503 wann |
|---|---|---|---|
| `/health` | Lebt der Container, ist die Datenbank da? | Docker/Dokploy-Health-Check | **nur** wenn die Datenbank weg ist |
| `/status` | Läuft der Import, wie er soll? | Monitoring (Uptime Kuma, Better Stack, Dokploy-Benachrichtigung) | wenn ein Mensch hinsehen sollte |

**`/health` darf nur rot werden, wenn ein Neustart hilft.** Bei einer Zugangssperre hilft er nicht — er macht es schlimmer: Dokploy drehte den Container im Kreis, während LINA ohnehin gerade nichts von uns hören will.

`/status` prüft neun Dinge und sagt zu jedem, was daraus folgt:

| Prüfung | Stufe | wann |
|---|---|---|
| `zugang` | Warnung / **Störung** | Sperre aktiv. Störung nur beim Anmeldefall — der kann ein gesperrtes Konto bedeuten |
| `fortschritt` | **Störung** | seit `STATUS_STILLSTAND_STUNDEN` (3) kein Posten erledigt, obwohl fällige Arbeit da ist |
| `laeufe` | **Störung** | die letzten drei Läufe sind fehlgeschlagen |
| `aufgegebene_posten` | Warnung | in 24 h wurde ein Zeitraum endgültig aufgegeben — der fehlt dauerhaft |
| `schema` | Warnung | LINA liefert etwas anderes als erwartet |
| `bwa_bruecke` | Warnung | aktive Betriebe ohne LINA-ID — sie tauchen in keiner BWA-Auswertung auf |
| `bwa_fortschritt` | Warnung | die **Spitze** steht mehr als `STATUS_BWA_RUECKSTAND_MONATE` (3) Monate zurück — Verdacht auf fehlende BWA-Rechte, denn dann liefert `getKennzahlen` kommentarlos Nullen |
| `dashboard_filter` | Warnung | die Auswahllisten der Metabase-Filter kennen nicht mehr alle Betriebe — ein fehlender Betrieb im Dropdown fällt sonst niemandem auf |
| `yext` | Warnung | der Yext-Nachlauf hängt (> 48 h), oder er läuft und die **Analytics-Tabellen sind leer** |

`warnung` bleibt bei **HTTP 200**: Dinge, die man wissen sollte, wecken niemanden nachts. Nur `stoerung` gibt 503.

Drei Entwurfsentscheidungen, die den Alarm brauchbar halten:

* **Ruht der Zugang, meldet `fortschritt` keinen Stillstand.** Zwei Alarme für dieselbe Ursache sind einer zu viel.
* **Jede Prüfung liefert `naechster_schritt` mit.** Ein Alarm ohne Handlungsanweisung kostet nur Zeit — meist steht dort direkt das SQL, das man als Nächstes braucht.
* **`bwa_fortschritt` misst die Spitze, nicht die Nachzügler.** Dass einzelne Betriebe hinterherhängen, ist Normalzustand — am 26.07.2026 hatten 62 von 141 nie eine gebuchte BWA, und 38 der 69 buchenden lagen einen Monat zurück. Wer darauf alarmiert, hat eine dauerhaft gelbe Ampel, und die liest nach zwei Wochen niemand mehr. Die Namen stehen in `mart.bwa_rueckstand`, wenn jemand sie sucht.

Einrichten: einen HTTP-Monitor auf `https://<host>/status` legen, Intervall 5–15 Minuten. Er schlägt bei 503 an. Der Rumpf ist JSON und lässt sich in die Benachrichtigung übernehmen.

Alle vier Fälle sind im Ende-zu-Ende-Test nachgestellt — die Attrappe kann auf Kommando sperren (`sperreAb`, `sperreArt`, `retryAfter`). Geprüft wird nicht nur, dass der Lauf endet, sondern **wie oft danach noch angeklopft wird**. Die richtige Antwort ist: kein einziges Mal.

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

**Lieferanten laufen über eine Whitelist.** Die Antwort hat 28 Felder, darunter `ustid`, `hrb`, `kreditor`, `gegenkonto*`, `tel`, `email` und die Anschrift von 540 Geschäftspartnern. Gespeichert werden fünf: ID, Name, aktiv, Mindestbestellwert, Liefertage. Durchgesetzt wird das in `transform.lieferanten()` — namentliches Auslesen, **kein Spread**; ein `...rest` hätte hier den gegenteiligen Effekt. Ein Test in `transform.test.ts` und einer im Ende-zu-Ende-Test nageln es fest, letzterer sogar auf Ebene der Tabellenspalten.

Der Grund ist seit dem 11.08.2026 **nicht mehr Datenminimierung als Grundsatz** (die Regel ist aufgehoben, siehe `entscheidungen.md`), sondern schlicht: Steuer- und Bankdaten von Geschäftspartnern beantworten keine Kennzahl. Braucht eine Auswertung eines dieser Felder, wird die Whitelist erweitert — dann aber Transformation **und** beide Tests gemeinsam.

## Drosselung

Die Drosselung ist keine Höflichkeit, sondern das, was die Integration am Leben hält: kein offizieller Zugang, keine dokumentierten Limits, **keine Rate-Limit-Header** (in Phase 1 geprüft — es gibt schlicht keine).

| Variable | Vorgabe | Wirkung |
|---|---|---|
| `TAKT_MIN_MS` / `TAKT_MAX_MS` | 20.000 / 40.000 | zufällige Pause je Request, kein fester Rhythmus |
| `TAGESBUDGET` | 6.000 | harte Obergrenze je Kalendertag (UTC), **laufübergreifend** |
| `FENSTER_VON_STUNDE` / `_BIS_` | 0 / 24 | durchgehend — das Arbeitsfenster ist entfallen, siehe `entscheidungen.md` |
| `ANFRAGE_TIMEOUT_MS` | 60.000 | Zeitlimit je Anfrage; ohne das hängt ein stummer Server den Worker auf |
| `MAX_VERSUCHE` | 4 | danach wird ein Posten aufgegeben |
| `ABBRUCH_NACH_FEHLERN` | 10 | Fehler in Folge → Lauf stoppt |

**Nicht nachts abschalten.** Die frühere Begründung war, ein Client um drei Uhr früh sei im Log ein Ausreißer. Das stimmt — aber ein Gerät, das jeden Abend schlagartig verstummt und morgens wieder anspringt, ist eine deutlichere Kante als ein gleichmäßiges Rinnsal. Was das Tempo begrenzt, sind `TAKT_*` und `TAGESBUDGET`, nicht die Uhrzeit.

**Das Budget zählt über Läufe hinweg.** `LinaClient.budgetLaden()` holt beim Laufstart die heutigen Zeilen aus `sync.aufgabe`. Bis zum 26.07.2026 lag der Zähler nur im Arbeitsspeicher — und weil jeder Lauf ein frisch startender Prozess ist, begann er stündlich wieder bei null. Die Bremse war wirkungslos, was nur deshalb nicht auffiel, weil der Takt sie ohnehin nie erreichen ließ.

Die tatsächlich gewartete Zeit steht je Aufruf in `sync.aufgabe.wartezeit_ms` — die Drosselung ist damit im Nachhinein prüfbar, nicht nur behauptet. Nachgemessen am 26.07.2026 über 526 Aufrufe: **623 ms Antwortzeit gegen 30.228 ms Warten, also 98 % Leerlauf.** Der Engpass ist ausschließlich die selbst gesetzte Pause; an der Zahl der Anfragen lässt sich nichts sparen, weil eine Antwort bereits alle 141 Betriebe enthält.

**Den Takt zu senken ist eine bewusste Entscheidung, keine Optimierung.** Es gibt genau einen Zugang, und eine Sperre wäre nicht rückgängig zu machen. Für einen beaufsichtigten Backfill ist ein schnellerer Takt vertretbar — dann aber über Umgebungsvariablen für diesen einen Lauf, nicht als neue Vorgabe in `src/config.ts`.

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

## FoodNotify: Inventuren (`src/foodnotify/inventur.ts`, Stufe 4)

Diese Datei ist bisher LINA-lastig geschrieben; der ganze FoodNotify-Importer (`src/foodnotify/`, seit `0030`) fehlt hier noch als eigenes Kapitel — der vollständige Ablauf steht bislang nur in `docs/plan-foodnotify.md` §6 und in den Kommentaren von `src/foodnotify/laden.ts` selbst. Dieser Abschnitt deckt nur die **Inventuren** (B1) ab, den zuletzt gebauten Teil.

**Zwei neue Endpunkte** in `src/foodnotify/endpunkte.ts`:

| Endpunkt | Pfad | Besonderheit |
|---|---|---|
| `fn:inventuren` | `GET /api/erp/stocktakings?erpIds[]=…&page=N` | bündelt **alle** Kostenstellen einer Marke in einem Aufruf — anders als `fn:bestellungen`, das je Kostenstelle läuft |
| `fn:inventurpositionen` | `GET /api/erp/stocktakings/{uuid}/items` | `shopArticleId` zeigt auf `core.ware`, nicht auf `core.artikel` |

**Der Ablauf steuert sich wie bei Bestellungen selbst**, nur mit einer anderen Wurzel: `bun run einreihen --foodnotify-inventuren` reiht je Marke **einen** `fn:inventuren`-Posten (Seite 1) mit den `erpIds` aller aktuell bekannten Kostenstellen ein. Das Laden der ersten Seite (`src/foodnotify/laden.ts`) reiht dann selbstständig die übrigen Seiten ein (rückwärts, wie bei Bestellungen — neueste zuerst) und je gefundener Inventur einen `fn:inventurpositionen`-Posten. Ein Aufruf genügt, der Rest läuft von selbst.

**Bewusst kein eigener Schalter in `fn:kostenstellen`** — anders als `fn:bestellungen` wird `fn:inventuren` NICHT automatisch angestoßen, wenn die Kostenstellen einer Marke geladen werden. Grund: Inventuren lohnen praktisch nur bei Wilma Wunder (plan-foodnotify.md Stufe 4), ein automatischer Anstoß für alle vier Marken wäre unnötige Last ohne Gegenwert bei drei von vieren.

**Und kein Eintrag im laufenden Abgleich** (`src/sync/nachfuellen.ts`) — anders als Bestellungen, wo stündlich die jeweils letzte Seite je Kostenstelle nachgezogen wird. Begründung mit Zahlen: `docs/entscheidungen.md`, „Inventuren bleiben ein reiner Backfill".

**Die Antworthülle ist nicht gemessen, nur abgeleitet.** `/api/erp/stocktakings` folgt dem Pfadmuster `/api/erp/*`, für das drei andere Endpunkte die `{code,errors,isError,payload}`-Hülle bestätigt haben — aber der stocktakings-Pfad selbst wurde nie gegen das echte FoodNotify abgefragt (harte Regel, `AGENTS.md`). Mock und Tests bilden die plausibelste Form nach (`payload.data` + `payload.pagination`, dieselbe Schachtelung, an der die Exploration bei Wilma Wunder einmal gescheitert ist — `docs/foodnotify-api-inventar.md` §1). Der erste echte Abruf gehört von Hand geprüft, bevor jemand den geladenen Zeilen traut.

---

## `src/messen.ts` — Einzelmessungen ohne Warteschlange (11.08.2026)

`bun run lina-fragen <d1..d6>` stellt **einen** lesenden Aufruf gegen LINA und druckt Status,
Form, Größe und die ersten Zeichen der Antwort. Kein Schreibvorgang — weder in LINA
(Regel 1) noch in `raw.api_antwort`: `LinaClient.holen()` holt und gibt zurück, das Ablegen
macht `sync/laden.ts`, und das läuft hier nicht.

**Warum ein eigener Einstiegspunkt und kein Eintrag in `ENDPUNKTE`.** Was in `ENDPUNKTE`
steht, reiht `nachfuellen()` automatisch ein. Eine einmalige Messung soll genau das nicht
auslösen. Der Endpunkt wird deshalb ad hoc im Skript gebaut und ist `aktiv: false`.

**Was übernommen wird:** Drosselung, Tagesbudget, Arbeitsfenster und die
Anmelde-Notbremse aus Regel 7 — es ist derselbe `LinaClient` wie im Sync. Ein gescheiterter
Anmeldeversuch beendet den Lauf, statt ihn zu wiederholen.

**Warum die Deutung im Code steht und nicht in der Ausgabe entsteht.** Jede Messung führt
eine Liste „Antwort → Schlussfolgerung", die **vor** dem Aufruf feststeht und danach erneut
gedruckt wird. Wer den Schluss erst nach dem Ergebnis formuliert, findet immer einen.

Läuft nach Regel 7a **nur im Terminal des Nutzers**, nicht aus der Agentenumgebung.

---

## `src/belege.ts` — Belegdateien als Beispieldaten für das PIM (13.08.2026)

`bun run belege-herunterladen` zieht **Dateien** statt Zeilen: die PDFs aus LINAs
Belegarchiv und die darin eingebetteten E-Rechnungs-XML. Zweck ist ein Testkorpus für
die Matching-Pipeline des PIM bei brain.food — **kein Teil des nächtlichen Laufs**, kein
Eintrag in `ENDPUNKTE`, nichts, was `nachfuellen()` je einreiht.

Bis dahin galt der Satz aus `docs/lina-api-inventar-ladenakte.md` wörtlich: *keine einzige
Belegdatei heruntergeladen*. Mit `getBeleg` in `ERLAUBTE_PFADE` gilt er nicht mehr, und
das ist der Grund, warum der Eintrag dort einen längeren Kommentar trägt als die anderen
fünf: er ändert die Größenordnung dessen, was dieser Importer bewegen kann.

**Weg A, nicht Weg B.** Weg B (`/finanzen/document/filelistByBelegart`) lieferte `lineItems`
und `is_xrechnung` fertig strukturiert — Labels frei Haus. Er hängt am aktiven Mandanten,
und ein Mandantenwechsel ist ausgeschlossen: der Zugang steht auf CONCEPT FAMILY
Franchise AG und bleibt dort (Eugene, 13.08.2026). Bleibt Weg A, dieselbe Tür wie täglich.

**Was an die Stelle der Labels tritt.** Der Kopf jedes Belegs steht schon in
`core.buchungsbeleg` — Lieferant, Netto, MwSt-Aufteilung, Kreditor, Sachkonto, DATEV-GUID,
Bar/Küche. Er geht als `manifest.jsonl` mit. Positionen gibt es nur dort, wo eine E-Rechnung
im PDF steckt.

**Die Dateinamen-Heuristik ist eine Untergrenze, keine Erkennung.** 113 Belege heißen
„…zugferd…", aber ein ZUGFeRD-PDF muss das nicht. Erkannt wird deshalb erst nach dem
Laden, an den Bytes: jeder `stream…endstream`-Block wird ausgepackt und auf die
Wurzelelemente `CrossIndustryInvoice` (ZUGFeRD/Factur-X) und `Invoice` im UBL-Namensraum
(XRechnung) geprüft. XMP-Metadaten sind ebenfalls XML und werden ausdrücklich nicht
mitgezählt — sonst hielte der Lauf 300.000 Scans für E-Rechnungen.

**Auswahl aus der Produktion, Dateien von LINA.** Die lokale Datenbank ist ein Torso ohne
Belegarchiv; gelesen wird deshalb über Metabase `/api/dataset`, streng SELECT. Die Auswahl
ist sortiert statt zufällig — derselbe Aufruf liefert morgen denselben Korpus, sonst wäre er
als Testbestand wertlos. Gemessen am 13.08.2026: **1.585 Belege** (542 Lieferscheine,
113 E-Rechnungs-Verdacht, 930 gestreute Eingangsrechnungen).

**Zwei Befehle, kein Schalter.** `bun run belege-vorschau` rechnet nur — Zahl je Topf,
Obergrenze, geschätzte Dauer; `bun run belege-herunterladen` zieht. Zuerst entschied das
eine Umgebungsvariable, was die falsche Bauform ist: sie steht nicht im Befehl, den man
später im Verlauf wiederfindet, sie überlebt in der Shell den nächsten Aufruf, und wer sie
einmal gesetzt hat, zieht beim nächsten Lauf unbeabsichtigt erneut. Ohne Flagge passiert
jetzt das Harmlose. Fortsetzbar ist der Abzug ohnehin — was auf der Platte liegt, wird
übersprungen.

**Läuft nur lokal, nie auf dem Server.** Nichts startet es dort: der Container-CMD ist
`health.ts`, der Dokploy-Job ruft `bun run sync`. Es wäre auch der falsche Ort — die
Dateien sollen bei dem liegen, der die PIM-Pipeline baut, nicht im Container. Ablage ist
`./belege`, gitignoriert wie `examples/`.

Läuft nach Regel 7a **nur im Terminal des Nutzers**. Der Takt ist derselbe wie im Sync;
für den beaufsichtigten Lauf lässt er sich über `TAKT_MIN_MS`/`TAKT_MAX_MS` senken, aber
über Umgebungsvariablen für diesen einen Lauf — es gibt genau einen Zugang.

---

## Der Zulauf des Belegarchivs: zählen, dann holen (13.08.2026)

Bis zum 13.08.2026 hatte das Belegarchiv **einen Abzug und danach nichts mehr**. Was daran
falsch war und wie es aufgefallen ist, steht in `docs/fehlerkatalog.md`; hier steht, wie es
jetzt läuft.

**Zwei Endpunkte auf demselben Pfad.** `/intranet/ladenakte/beleglist` unterscheidet sich
nur durch `length`:

| Endpunkt | `length` | Antwort | schreibt |
|---|---|---|---|
| `la:belegzahl` | 1 | eine Zeile plus `recordsTotal` | eine Zeile `core.belegarchiv_bestand` (`quelle='zaehlung'`) |
| `la:belegliste` | 100.000 | der ganze Ordner | alle Belege plus `quelle='abzug'` |

**Der tägliche Ablauf.**

1. `belegzaehlungEinreihen()` stellt je Betrieb und Belegart eine Zählung ein — als **eine**
   `INSERT … SELECT` über das Kreuzprodukt `core.betrieb × core.belegart`, nicht als
   Schleife. Migration `0059` hat vorgeführt, was 262 Einzelprüfungen kosten: sieben Minuten
   Nachfüllzeit. Das Kreuzprodukt ist siebenmal so groß.
2. Der Worker holt die Zählung. `laLaden()` schreibt den Zählstand und vergleicht ihn mit
   `count(*)` aus `core.buchungsbeleg` für dasselbe Paar.
3. Weicht er ab **und** ist die Belegart freigegeben (`core.belegart.inhalt_holen`), reiht
   dieselbe Transaktion `la:belegliste` mit Priorität 93 nach. Der Worker holt sie im selben
   Lauf, weil 93 vor 95 liegt.

**Warum die Reihenfolge `ORDER BY lina_betrieb_id` zählt.** Der `storeId`-Token gilt je
Betrieb und hält gemessene 172 s (`src/ladenakte/token.ts`). Werden die Ordner eines Betriebs
nacheinander abgearbeitet, kostet er zwei Zusatzaufrufe je Betrieb statt zwei je Ordner —
262 statt 3.668. `posten_holen()` sortiert bei gleicher Priorität nach `posten_id`, also nach
Einreihreihenfolge.

**Die Rechnung gegen das Tagesbudget** (LINA: 10.500, bisher verbraucht 82):

```
131 Betriebe x 14 Belegarten          1.834 Zaehlungen
+ storeId-Token, 2 je Betrieb           262
+ LINA-Tagesberichte wie bisher          82
+ nachgereihte Abzuege                 ~ 60   (296 Paare hatten in 28 Tagen Zulauf)
--------------------------------------------
                                     ~ 2.238 von 10.500
```

Bei dem am 13.08.2026 gemessenen Takt von rund 3 s je Aufruf sind das etwa 1,7 Stunden. Der
Erstabzug brauchte für 621 **volle** Ordner acht Stunden — das ist der Unterschied, den die
Zählung kauft.

**Was sichtbar bleibt.** `mart.belegarchiv_zulauf` führt jedes der 1.834 Paare mit einem
Zustand: `vollstaendig`, `abzug eingereiht`, `abzug fehlt`, `gezaehlt, nicht freigegeben`,
`nie gezaehlt`. Dazu vier Zeilen in `mart.pruefung_uebersicht`. Ein Log-WARN wäre hier
wertlos gewesen — niemand liest Logs, und genau deshalb hat der Stillstand zwei Tage
gedauert.

## FoodNotify: die Zählung einer Inventur blättert (13.08.2026)

`fn:inventurpositionen` trägt seit dem 13.08.2026 `seite` als **Pflichtparameter**. Kein
Vorgabewert: ein stilles `?? '1'` wäre der alte Zustand mit einem Parameter davor, und ein
Posten ohne Seite ist ein Einreihungsfehler, kein HTTP-Fehler.

Die Kette ist dieselbe wie bei `fn:bestellungen` und `fn:inventuren` — Seite 1 reiht die
Seiten 2…n rückwärts ein, in derselben Transaktion, in der sie ihre Positionen schreibt.
**Gelöscht wird nur auf Seite 1**; die Begründung steht im Fehlerkatalog und ist wichtiger
als der Fehler, den sie behebt.

Der Parameter änderte zugleich den Idempotenzschlüssel: alte Posten tragen nur `{uuid}`, neue
`{uuid, seite}`.

## Was der Lauf von selbst repariert (13.08.2026)

Zwei Funktionen in `nachfuellen()`, beide bei **jedem** Sync-Lauf. Sie sind der Grund, warum
es für die Lücken aus Phase 1 keinen Handbefehl gibt — Entscheidung Eugene vom 13.08.2026,
Begründung in `docs/entscheidungen.md`.

### `inventurpositionenNachziehen(markeKey)`

Vergleicht je Inventur `core.inventur.anzahl_positionen` (FoodNotifys
`totalNumberOfItems`) mit den geladenen Zeilen und reiht bei Abweichung **Seite 1** neu ein;
die Folgeseiten reiht das Laden selbst ein.

Gesperrt wird gegen jeden **offenen** Posten derselben Inventur, gleich welcher Seite. Ohne
das stellt der nächste Lauf eine zweite Seite 1, während Seite 2 noch läuft — und Seite 1
löscht beim Laden alles weg, was Seite 2 gerade geschrieben hat.

Selbstbegrenzend, und das ist gemessen: 349 der 358 Inventuren stimmen auf die Position
genau überein, neun waren bei exakt 800 abgeschnitten, null andere Ausreißer. Bliebe eine
dauerhaft ungleich, kostet sie einen Aufruf je Nacht und steht in
`mart.inventur_abgeschnitten` — der bewusste Preis dafür, dass eine echte Lücke nicht
vergessen wird.

### `aufgegebeneWiederbeleben()`

Setzt aufgegebene Posten zurück (`erledigt_am = NULL`, `ergebnis = NULL`, `versuche = 0`) und
zählt `wiederbelebt` hoch. Drei Bedingungen begrenzen sie:

| Bedingung | wogegen |
|---|---|
| `wiederbelebt < MAX_WIEDERBELEBUNGEN` (3) | ein dauerhaft kaputter Posten, der jede Nacht vier Aufrufe kostet |
| letztes Scheitern liegt über 20 h zurück | fünf Sync-Läufe an einem Tag (12.08.2026) kosten sonst fünf Leben |
| derselbe Endpunkt hatte in 24 h ein `ok` | ein zweitägiger Ausfall der Gegenstelle verbraucht sonst den ganzen Vorrat |

Dazu die Sperre gegen einen offenen Zwilling: der Eindeutigkeitsindex ist partiell
(`WHERE erledigt_am IS NULL`), ein Wiederbeleben würde ihn sonst verletzen.

`versuche` und `wiederbelebt` sind **nicht dasselbe**: `versuche` zählt die Anläufe innerhalb
eines Lebens und fängt beim Wiederbeleben bei 0 an, `wiederbelebt` zählt die Leben.

### Die Rechnung

FoodNotify, Tagesbudget 140.000, verbraucht 155 bis 1.000:

```
275 aufgegebene x hoechstens 4 Versuche x 3 Wiederbelebungen
  = hoechstens 3.300 Aufrufe, verteilt auf mehrere Tage        2,4 %
9 abgeschnittene Inventuren, Seite 1 plus Folgeseiten
  = rund 20 Aufrufe, einmalig                                  0,01 %
```

Danach fällt beides auf null zurück, weil die Bedingungen nicht mehr zutreffen. Kein
Dauerverbrauch — und das ist nachprüfbar, nicht behauptet: `mart.posten_aufgegeben` zeigt,
wie viele noch Leben haben.

### Der Statusbericht sagt seit dem 13.08.2026 etwas anderes

`src/status.ts` zählte unter `aufgegebene_posten` alles, was auf `aufgegeben` stand, und
schrieb darüber „diese Zeiträume fehlen dauerhaft". Für Posten, die der Lauf noch bis zu
dreimal zurückholt, ist der Satz schlicht falsch. Gezählt wird deshalb jetzt nur das
**endgültige**; die übrigen erscheinen als Randnotiz („4 werden erneut versucht") und färben
die Ampel nicht.

Eine Warnung, die zu viel behauptet, wird genauso ignoriert wie eine, die nie ausschlägt —
dieselbe Lehre wie bei der Wareneinsatz-Prüfung, die bis Migration `0029` immer grün zeigte.

## Zwei Sperrmodi beim Einreihen von Folgeposten (13.08.2026, Phase 1c)

`folgepostenEinreihen()` in `src/foodnotify/laden.ts` entscheidet, ob ein Folgeposten
entsteht. Bis zum 13.08.2026 kannte es nur eine Antwort: sperren gegen ALLE Posten
derselben Parameter, erledigte eingeschlossen. Seither sind es zwei.

| Modus | Sperrt gegen | Bedeutung | Wer nutzt ihn |
|---|---|---|---|
| `'alle'` (Vorgabe) | jeden Posten derselben Parameter | ein EINMALIGER Abruf: was einmal geholt wurde, wird nicht erneut geholt | `fn:bestellungen`-Seiten, `fn:bestellung`, `fn:bestellpositionen`, `fn:inventuren`-Seiten |
| `'offen'` | nur einen noch offenen Posten | ein WIEDERHOLBARER Abruf: nicht zweimal gleichzeitig, aber sehr wohl ein zweites Mal | die Folgeseiten von `fn:inventurpositionen` |

**Warum der Unterschied sein muss.** Eine Inventur wird nachgezogen, sobald ihr Kopf mehr
Positionen meldet als geladen sind — und das passiert bei JEDER Änderung in FoodNotify, nicht
einmal. Seite 1 löscht dabei den ganzen Bestand und lädt neu, die Folgeseiten müssen also
jedes Mal mitkommen. Mit `'alle'` blockierte ab dem zweiten Zyklus der erledigte Zwilling
`{uuid, seite:'2'}` aus dem ersten. Hergang und Messwerte in `fehlerkatalog.md`.

**Warum `'offen'` innerhalb eines Zyklus genügt.** Seite 1 reiht die Folgeseiten in DERSELBEN
Transaktion ein, in der sie löscht — entweder ist gelöscht UND die Kette steht, oder nichts
von beidem. Bis zur Abarbeitung sind sie offen und damit gesperrt. Ein zweiter Zyklus beginnt
ohnehin erst, wenn der erste durch ist: `inventurpositionenNachziehen()` sperrt gegen jeden
offenen Posten derselben Inventur, gleich welcher Seite.

**Was bewusst bei `'alle'` bleibt.** Die Bestelldetails (`fn:bestellung`,
`fn:bestellpositionen`) sperren absichtlich dauerhaft. Dass sie damit nie nachaltern, ist ein
eigener Befund und bekommt einen eigenen Takt — Punkt 2.6 in
`plan-datenvollstaendigkeit-nachtrag.md`, nicht diese Sperre.

## Der Abzug kann jetzt schrumpfen (13.08.2026, Phase 1c)

`belegeSchreiben()` in `src/ladenakte/laden.ts` war ein reiner Upsert. Ein in LINA gelöschter
Beleg blieb bei uns stehen — und weil der Zulaufabgleich aus 0069 auf GLEICHHEIT prüft, galt
ab dem ersten gelöschten Beleg dauerhaft `gehalten > gezaehlt`. Der Lauf holte den vollen
Ordner jede Nacht neu, bis zu 12.668 Belege, ohne dass sich je etwas änderte.

`verschwundeneEntfernen()` löscht deshalb nach jedem vollen Abzug die Belege des Paars
`(betrieb_key, typ_id)`, deren `lina_id` nicht in der Antwort steht.

* **Nur bei geprüfter Vollständigkeit.** Ohne `recordsTotal` wird nichts gelöscht; mit
  `recordsTotal` hat die Prüfung `zeilen.length === recordsTotal` eine Zeile darüber schon
  geworfen, falls etwas fehlt.
* **`core.buchungsbeleg_steuer` hängt per `ON DELETE CASCADE` dran** (0053) — es bleibt nichts
  verwaist. Der Test prüft genau das, nicht eine Zeilenzahl.
* **Schranke: mehr als 5 % UND mehr als 10 Belege in einer Nacht → werfen statt löschen.**
  Beide Teile sind nötig; die Begründung mit den gemessenen Ordnergrößen steht als Kommentar
  am Konstantenpaar `SCHWUND_ANTEIL` / `SCHWUND_MINDESTZAHL`.
* **Geworfen wird in derselben Transaktion, in der gelöscht wird.** „Nichts gelöscht" ist
  deshalb keine Zusage des Codes, sondern die Folge des Rücklaufs.
* **Unterhalb der Schranke wird geloggt.** Eine Löschung ist die einzige Stelle, an der uns
  Daten absichtlich abhandenkommen; lautlos darf das nicht passieren.

**Ein Beleg, der den Ordner wechselt, geht nicht verloren.** Der Upsert-Schlüssel ist
`(betrieb_key, lina_id)` ohne `typ_id` (0053, Falle 5). Zieht der neue Ordner zuerst ab,
steht der Beleg schon auf der neuen `typ_id` und die Löschbedingung des alten trifft ihn
nicht mehr; zieht der alte zuerst ab, löscht er ihn und der Abzug des neuen schreibt ihn
wieder. Spätestens in der zweiten Nacht steht er richtig.

## Bestelldetails altern nach (13.08.2026, Phase 2.6)

`bestelldetailsAuffrischen()` in `src/sync/nachfuellen.ts` läuft je Marke bei jedem Lauf und
reiht `fn:bestellung` und `fn:bestellpositionen` für nicht-finale Bestellungen neu ein.

| Stellschraube (`src/config.ts`) | Vorgabe | Wofür |
|---|---|---|
| `BESTELLDETAIL_FENSTER_TAGE` | 45 | das rollierende Fenster — so lange wird eine Bestellung noch geliefert, korrigiert und abgerechnet |
| `BESTELLDETAIL_NACHHOLTIEFE_MONATE` | 12 | wie weit der eingefrorene Altbestand nachgeholt wird (Entscheidung 5) |
| `BESTELLDETAIL_JE_LAUF` | 11.000 | Obergrenze je Lauf und Marke — und der ganze „Nachholauf" |

**Der Wiederholtakt hängt an `core.bestellung.detail_geholt_am`, nicht an der
Warteschlange.** Das ist der Kern: die Alle-Posten-Sperre von `folgepostenEinreihen()` ist
genau der Grund, warum bis zum 13.08.2026 keine Bestellung je erneut geholt wurde. Gesperrt
wird hier deshalb nur gegen einen noch **offenen** Zwilling — damit derselbe Abruf nicht
zweimal gleichzeitig läuft, mehr nicht.

**Gestempelt wird nur von `fn:bestellung`.** Der Listen-Upsert bei `fn:bestellungen` frischt
allein den Status auf und darf nicht so tun, als sei das Detail geholt — sonst sähe eine
Bestellung, deren Status sich änderte, aus wie eine, deren Liefermenge frisch ist.

**Jüngste zuerst.** `ORDER BY bestellt_am DESC` sorgt dafür, dass die Obergrenze zuerst das
rollierende Fenster (gemessen 2.981 Bestellungen) und erst danach den Altbestand bedient.
Dieselbe Entscheidung wie beim Bestell-Backfill am 02.08.2026: aktuelle Preise vor der
Historie.

**„Nicht final" heißt: Status weder `canceled` noch `finished`.** `imported` gilt
ausdrücklich als nicht final, solange niemand gemessen hat, ob sich solche Bestellungen noch
ändern — der Nachholauf beantwortet das selbst.

**Priorität 30:** hinter LINAs Tagesdaten (10) und dem Stammdaten-Abgleich (20), klar vor dem
Backfill (89/90).

## Der Wächter über das Berichtsregister (13.08.2026, Phase 2.5/2.7)

Einen Endpunkt zu aktivieren ist ein Einzeiler: `aktiv: false` wird `aktiv: true`. Ob dahinter
etwas passiert, hängt an drei weiteren Stellen — und **jede versagt lautlos**. Der Posten
meldet „ok", die Zieltabelle bleibt leer.

`endpunkteZusichern()` (`src/sync/waechter.ts`) prüft deshalb beim Start jedes Laufs drei
Zusicherungen und **wirft**, statt zu warnen:

| # | Zusicherung | Was sonst passiert |
|---|---|---|
| 1 | Die `schrittweite` hat einen Einreihzweig in `linaNachfuellen()` | `monat` hat keinen. Alle vier `getReport`-Endpunkte tragen ihn — wer einen aktiviert, reiht **null** Posten ein |
| 2 | Der Endpunkt hat einen Fall im Dispatch von `laden.ts` | der stille `default: break`. Schreibt raw, meldet „ok", transformiert nichts — genau daran ist der Aktionsbericht einmal monatelang vorbeigelaufen |
| 3 | `ebene: 'betrieb'` braucht einen Producer für `betrieb_enc_id` | **es gibt keinen.** Nachgesehen am 13.08.2026: kein einziger `INSERT` im Repo setzt die Spalte, sie wird nur gelesen. Der Aufruf liefe ohne `storeId` los |

**Warum er wirft und nicht warnt.** Ein Log-WARN liest niemand. Und anders als die Befunde in
der Datenbank ist das kein Datenzustand, sondern ein Baufehler: er entsteht beim Deploy und
ist beim Deploy behebbar. Der Aufruf steht in `nachfuellen()` ausdrücklich **vor** und
**außerhalb** der `try`-Blöcke — alles andere dort darf scheitern, ohne den Lauf zu
verhindern; hier ist es umgekehrt, weil die Folge genau null Arbeit bei „ok" wäre.

Geprüft wird zweimal: als Test vor dem Deploy (`waechter.test.ts`, mit je einer Verletzung
je Zusicherung) und zur Laufzeit, falls jemand am Test vorbei deployt.

**`TRANSFORMIERTE_ENDPUNKTE` steht in `laden.ts`, neben dem `switch`, den es beschreibt.**
Eine doppelt gepflegte Liste ohne Abgleich wäre nur eine zweite Stelle, an der dasselbe falsch
stehen kann — deshalb liest `waechter.test.ts` die Datei und vergleicht die `case`-Zeilen
gegen die Menge.

## Die Zuordnung Kostenstelle → Betrieb läuft endlich mit (13.08.2026, Phase 2.4)

`manual.betrieb_vorschlaege_berechnen()` und `manual.betrieb_zuordnung_anwenden()` gibt es
seit Migration `0034` — vollständig gebaut, kommentiert und getestet. **In Produktion wurden
sie nie aufgerufen:** der einzige Aufrufer im ganzen Repo war `zuordnung.test.ts`.

`zuordnungNachlauf()` (`src/sync/zuordnung.ts`) ruft jetzt beide bei jedem Lauf, in dieser
Reihenfolge — `anwenden()` arbeitet auf dem, was `berechnen()` schreibt.

**Er steht als ERSTER Nachlauf, direkt hinter dem Worker.** Alle anderen rechnen auf
`betrieb_key`: Auswahllisten, Deckungsbeitrag, Round Table, Einkaufssichten. Liefe die
Zuordnung dahinter, zeigten sie bis zum nächsten Lauf den Stand von gestern — genau die Falle,
in der `yextNachlauf()` bis heute sitzt (Punkt 5.3 des Plans).

**Warum bei jedem Lauf und nicht einmalig.** Ein einmaliger Aufruf hätte denselben Fehler wie
`manual.belegarchiv_soll`: er wäre die Bedingung eines Erstabzugs, und jeder danach angelegte
Betrieb fiele stumm heraus. Seit dem 13.08.2026 kommen die FoodNotify-Stammdaten täglich statt
monatlich, also entstehen neue Kostenstellen auch täglich.

**Er rät nicht.** „unsicher" und „kein_treffer" bleiben NULL. Die offenen Fälle stehen in
`mart.kostenstelle_ohne_betrieb` und als eigene Prüfzeile — Begründung in `entscheidungen.md`.

**Er meldet auch, wenn er nichts tut.** Die Logzeile führt `zugeordnet` **und**
`offen_mit_bestellungen`. „0 zugeordnet" allein liest sich wie „nichts zu tun"; erst mit der
zweiten Zahl steht da, ob wirklich nichts zu tun ist oder ob jemand entscheiden muss.

## Die beiden Rückschaufenster (13.08.2026, Phase 2.1–2.3)

**Je Endpunkt statt global.** `Endpunkt.nachzuegler_tage` überschreibt
`config.NACHZUEGLER_TAGE`. Gesetzt ist es bei `getPersonalkosten` und
`getArtikelverkaufsbericht` (je 21 Tage); alle übrigen bleiben beim globalen Wert. Die
Begründung samt Messreihe steht in `befunde-datenlage.md` — kurz: die drei geprüften
Tagesberichte haben drei völlig verschiedene Kurven, ein gemeinsames Fenster kann für
höchstens einen richtig sein.

**`getKennzahlen` holt laufendes Jahr UND Vorjahr**, das ganze Jahr über. Zwei zusätzliche
Aufrufe je Lauf. Das Vorjahr läuft ausdrücklich nicht nur bis August mit: erst dadurch wird
die Rückbuchungstiefe überhaupt beobachtbar, und ein Fenster, das im September wortlos
schmaler wird, ist wieder eines, dessen Grenze niemand sieht.

**Punkt 2.2 des Plans erledigt sich damit.** Er verlangte einen einmaligen Nachholauf an
`sync.historie_einreihen()` vorbei, weil die Funktion erledigte Zeiträume überspringt. Der
nächtliche Lauf braucht sie gar nicht: sein `ON CONFLICT DO NOTHING` läuft gegen einen
**partiellen** Index (`WHERE erledigt_am IS NULL`), den ein erledigter Posten nicht besetzt.
Das Vorjahr wird also beim nächsten Lauf von selbst geholt — kein Befehl auf dem Server. Ein
Test hält genau das fest.

**Was das an Aufrufen kostet** (LINA-Tagesbudget 10.500, verbraucht ~82):

```
heute        8 Tagesendpunkte × 10 Tage                     80
neu          6 × 10 + 2 × 21 (Personal, Artikel)           102
Kennzahlen   2 Endpunkte × 2 Jahre statt × 1                +2
                                              ~104 von 10.500
```
