# Importer

Bun/TypeScript, läuft als Dokploy-Application im Container. Der Container bleibt über `health.ts` oben; die Läufe stößt ein Schedule Job per `docker exec` an (`bun run sync`) — jeder Lauf ist damit ein frisch startender Prozess.

Was hier an Fallstricken steckt und schon einmal zugeschlagen hat, steht gesammelt in
`fehlerkatalog.md` — besonders die Abschnitte zum partiellen Eindeutigkeitsindex und dazu,
warum ein Lauf früher an jedem Verbindungsfehler starb.

## Zwei Phasen: die Dienste nebeneinander, die Ableitungen danach (24.08.2026)

`sync.ts` war bis zum 24.08.2026 eine Kette von `await`s: erst der Import, dann
Yext, Handpflege, Bounti, dann alles Materialisierte. **Nur die Warteschlange
lief parallel, und auch die nur zweispurig.**

Nachgemessen an Lauf 101:

| Spur | von | bis | Dauer |
|---|---|---|---|
| FoodNotify | 05:06:52 | 07:03:52 | 1 h 57 |
| LINA (Berichte) | 05:06:51 | 08:30:14 | 3 h 23 |
| LINA (Ladenakte) | 08:30:25 | 15:14:49 | 6 h 44 |

Die FoodNotify-Spur stand nach zwei Stunden still und wartete acht Stunden;
Yext und Bounti warteten bis 15:15, um dann zwanzig Minuten zu arbeiten.

**Faustregel seitdem (Eugene): alle separaten Dienste parallelisieren.**

```text
  nachfuellen()                     Vorlauf: die Schlange füllen

  ── Phase A ── die Dienste, nebeneinander ───────────────
     workerLauf()   LINA-Spur ‖ FoodNotify-Spur
     yextNachlauf()
     bountiNachlauf()
     wetterNachlauf()
     pflegeNachlauf()               Handpflege + Feiertage/Schulferien
  ── Sammelpunkt: Promise.allSettled ─────────────────────

  ── Phase B ── die Ableitungen, seriell ─────────────────
     zuordnungNachlauf()            Kostenstelle → Betrieb
     deckungsbeitrag · roundTable · auswahllisten · vergleichstag
     einkaufspreis · einkaufSichten · pflichtartikel · zulaufPruefen
```

**Was das bringt — und was nicht.** Der Lauf wird dadurch **nicht kürzer**: die
LINA-Spur trägt zehn von zehn Stunden, davon 6 h 40 allein die Belegzählung.
Was sich ändert:

1. Bewertungen, Schulungen, Wetter und Handnoten stehen um **05:30 statt 15:30**.
2. Sie gehen **nicht mehr verloren, wenn der Import abbricht.** 30 der bisher
   101 Läufe stehen auf `abgebrochen`; in jedem davon liefen die vier Dienste
   gar nicht, weil sie dahinter standen.

**Warum die Warteschlange trotzdem zweispurig bleibt.** LINA-Berichte und
Ladenakte sind derselbe Dienst — gleicher Host, gleiche Sitzung, gleiches Tempo
(Regel 3). Eine dritte Spur wäre nicht Parallelität, sondern doppeltes Tempo
gegen einen fremden Zugang. Die Faustregel sagt „separate Dienste", und die
Ladenakte ist keiner.

**Die Grenze zwischen den Phasen ist die Bedingung, an der alles hängt.** Yext
und die Handpflege schreiben Round-Table-Kennzahlen, und `mart.round_table_monat`
ist seit Migration `0039` materialisiert. Liefe der Refresh los, während die
beiden noch schreiben, trüge die Ampel die Note vom Vortag — derselbe Fehler wie
am 14.08.2026, nur als Wettlauf statt als Reihenfolge und damit nicht einmal
verlässlich reproduzierbar. `src/sync/phasen.test.ts` prüft am Quelltext, dass
jede Ableitung hinter dem Sammelpunkt steht und kein Dienst herausfällt.

**Der Preis, ehrlich genannt.** Yext und Bounti gleichen ihre Betriebszuordnung
einmal im Monat ab, und dieser Abgleich sieht `core.betrieb` künftig im Stand
des Laufbeginns statt nach dem Import. Ein Betrieb, der in dieser Nacht zuerst
auftaucht, bekäme seine Zuordnung erst beim nächsten Monatsabgleich. Gemessen:
seit Juli 2026 kam kein neuer Betrieb dazu, und der Fall stünde die ganze Zeit
in `mart.betrieb_ohne_yext` und `mart.bounti_ohne_betrieb` — beide hängen an
`mart.pruefung_uebersicht`.

**Die Verbindungen reichen.** Der Pool steht auf `max: 8`; jeder Zweig greift
seine Abfragen streng nacheinander ab, hält also höchstens eine Verbindung. Zwei
Worker-Spuren plus vier Dienste sind sechs. Die Verbindung der Laufsperre zählt
nicht mit, sie liegt außerhalb des Pools.

---

## Eine Schlange, zwei Schleifen, kein Modus-Unterschied

Es gibt **keinen** getrennten Backfill- und Sync-Modus. Beides sind Einträge in `sync.warteschlange`, die konstant und langsam abgearbeitet werden:

| Priorität | Bedeutung |
|---|---|
| 10 | Tagesberichte (gestern), täglich eingereiht — legen Betriebe und Artikel an |
| 12 | `analyticsFilterOptions` — braucht die Betriebe, liefert deren LINA-ID |
| 14 | `getKennzahlen` — braucht die LINA-ID |
| 20 | übrige Momentaufnahmen — brauchen den Artikelkatalog |
| 50 | Nacharbeit nach Fehlern |
| 90 | Historie, rückwärts |

Aktuelle Daten können damit nie hinter dem Backfill verhungern, und es gibt nur einen Codepfad statt zweier, die auseinanderlaufen.

**Seit dem 19.08.2026 (Migration `0082`) arbeiten zwei Schleifen an dieser einen Schlange — eine je Anbieter.** LINA (Posten ohne `marke_key`, inklusive der `la:*`-Ladenakte) und FoodNotify (`marke_key IS NOT NULL`) laufen nebenläufig im selben Prozess; `sync.posten_holen(lauf, anbieter)` grenzt jede auf ihre Seite ein, zusammengeführt wird mit `Promise.allSettled`.

Der Grund ist gemessen: in Lauf 95 (18.08.2026) brauchte LINA 10 h 10 und FoodNotify 2 h 12, und weil sie sich eine Schleife teilten, dauerte der Lauf 12 h 17. FoodNotify stand in LINAs Taktpausen still — mit eigenem Takt und eigenem Budget. Aus der Summe wird jetzt das Maximum, der Lauf also rund zwei Stunden kürzer.

**Die Drosselung ändert sich dabei nicht.** Sie hängt an der Client-Instanz (`letzterRequest` ist ein Instanzfeld), und je Anbieter gibt es weiterhin genau eine Instanz mit genau einem Aufrufer. Jedes Anbietersystem sieht denselben Mindestabstand wie vorher. Die Advisory-Sperre bleibt eine je Prozess. **Die Grenze verläuft bei „ein Aufrufer je Client", nicht bei „eine Schleife"** — ein zweiter Worker desselben Anbieters wäre eine echte Ratenerhöhung und ist ausgeschlossen; Begründung in `entscheidungen.md`.

Was je Anbieter getrennt zählt: `fehlerInFolge` (sonst löschten FoodNotifys 20–60 Erfolge je LINA-Abruf LINAs Fehlerserie, und `ABBRUCH_NACH_FEHLERN` löste nie mehr aus), der reservierte Posten, die Notiz und die Tempomessung der Restschätzung. Was gemeinsam bleibt: die Zähler des Laufs, `MAX_POSTEN_PRO_LAUF`, das Arbeitsfenster, die Zugangssperre und ein eigener Zähler für Datenbankfehler beim Ziehen.

Die Restschätzung rechnet seither **je Anbieter das Bindende (Tempo oder Tagesrate) und danach das Maximum beider** — die alte Summenformel setzte voraus, dass beide sich eine Schleife teilen.

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
3. **Die Pause steht in `sync.zugangssperre`**, nicht im Prozess. Sonst wäre sie beim nächsten Prozessstart wieder weg — dieselbe Lektion wie beim Tagesbudget. Bei einem **täglichen** Takt wiegt das schwerer, nicht leichter: was der Prozess vergisst, ist einen ganzen Tag lang vergessen.
4. **Der nächste Lauf nimmt gar keinen Kontakt auf.** Die Prüfung steht vor der Laufsperre und vor jeder Anmeldung: auch ein Login ist Kontakt.

**Beim Anmeldefehler wird in diesem Prozess kein zweites Mal angemeldet.** Bis zum 26.07.2026 tat der Code genau das — zehnmal in Folge, Lauf für Lauf wiederholt, gegen ein sperrbares Konto. Siehe `fehlerkatalog.md`.

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

`/status` prüft elf Dinge und sagt zu jedem, was daraus folgt:

| Prüfung | Stufe | wann |
|---|---|---|
| `zugang` | Warnung / **Störung** | Sperre aktiv. Störung nur beim Anmeldefall — der kann ein gesperrtes Konto bedeuten |
| `fortschritt` | **Störung** | seit `STATUS_STILLSTAND_STUNDEN` (3) kein Posten erledigt, obwohl fällige Arbeit da ist |
| `laeufe` | **Störung** | die letzten drei Läufe sind fehlgeschlagen |
| `aufgegebene_posten` | Warnung | in 24 h wurde ein Zeitraum endgültig aufgegeben — der fehlt dauerhaft |
| `zulauf` | Warnung / **Störung** | eine erwartete Quelle bekommt keinen Zulauf mehr. Störung, wenn der Importer sie gar nicht mehr abfragt — das ist ein Baufehler, kein Ausfall |
| `schema` | Warnung | LINA liefert etwas anderes als erwartet |
| `bwa_bruecke` | Warnung | aktive Betriebe ohne LINA-ID — sie tauchen in keiner BWA-Auswertung auf |
| `bwa_fortschritt` | Warnung | die **Spitze** steht mehr als `STATUS_BWA_RUECKSTAND_MONATE` (3) Monate zurück — Verdacht auf fehlende BWA-Rechte, denn dann liefert `getKennzahlen` kommentarlos Nullen |
| `dashboard_filter` | Warnung | die Auswahllisten der Metabase-Filter kennen nicht mehr alle Betriebe — ein fehlender Betrieb im Dropdown fällt sonst niemandem auf |
| `materialisierung` | Warnung | eine materialisierte Sicht ist älter als der letzte Lauf — oder hängt an gar keinem Nachlauf. Die Refreshes werfen nie, ein gescheiterter sah bis `0091` aus wie ein gelungener Lauf |
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

**Das Budget zählt über Läufe hinweg.** `LinaClient.budgetLaden()` holt beim Laufstart die heutigen Zeilen aus `sync.aufgabe`. Bis zum 26.07.2026 lag der Zähler nur im Arbeitsspeicher — und weil jeder Lauf ein frisch startender Prozess ist, begann er bei jedem Start wieder bei null. Die Bremse war wirkungslos, was nur deshalb nicht auffiel, weil der Takt sie ohnehin nie erreichen ließ.

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

**Und kein Eintrag im laufenden Abgleich** (`src/sync/nachfuellen.ts`) — anders als Bestellungen, wo in jedem Lauf die jeweils letzte Seite je Kostenstelle nachgezogen wird. Begründung mit Zahlen: `docs/entscheidungen.md`, „Inventuren bleiben ein reiner Backfill".

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

## Der 403-Zweig hat jetzt ein Ende (Migration `0075`, 14.08.2026)

FoodNotify antwortet auf Kostenstellen, die uns nicht gehören, mit HTTP 403. Das ist kein
Kontoproblem, sondern eine Ressourcengrenze — deshalb ruht seit dem 03.08.2026 nur der eine
Posten und nicht die ganze Marke.

Nur endete das nie. `sync.warteschlange.gesperrt_seit` hält jetzt fest, **seit wann** die
Quelle nein sagt; jeder Erfolg räumt die Spalte wieder ab. Drei Stufen:

| Zustand | Was passiert |
|---|---|
| unter `SPERRE_AUFGEBEN_TAGE` (14) | Posten ruht 24 h, wie bisher |
| darüber, Quelle antwortet sonst | `ergebnis = 'kein_zugriff'`, geschlossen |
| darüber, Quelle antwortet nirgends | Posten bleibt liegen — es ist das Konto |

`kein_zugriff` ist ein eigener Ausgang neben `aufgegeben`, weil
`aufgegebeneWiederbeleben()` nur letzteres anfasst. Sonst holte der nächtliche Lauf einen
403-Posten dreimal zurück, um dreimal dieselbe Antwort zu bekommen — drei Wochen Rauschen für
eine Aussage, die am ersten Tag feststand.

Sichtbar in `mart.posten_ohne_zugriff`, und zwar mit der Frage, auf die es ankommt:
`eigener_betrieb`. Bei einer fremden Kostenstelle ist der 403 richtig und die Sache erledigt;
bei einem eigenen Betrieb fehlen uns dessen Bestellungen.

## `sync.fortschritt` wird geschrieben (Migration `0075`, 14.08.2026)

Die Tabelle hatte seit `0005` vier Leser und keinen Schreiber — 0 Zeilen in Produktion, und
`/health` meldete daraus für immer „null pausierte Endpunkte". `standSchreiben()` in
`worker.ts` schreibt sie jetzt bei jedem Ausgang fort:

| Ausgang | `letzter_erfolg_am` | `fehler_in_folge` | `pausiert_bis` |
|---|---|---|---|
| `ok` | `now()` | 0 | `NULL` |
| `keine_daten` | `now()` | 0 | `NULL` |
| Wiedervorlage | bleibt | +1 | die gerade gesetzte Frist |
| aufgegeben | bleibt | +1 | `NULL` |

`keine_daten` zählt ausdrücklich als Erfolg: ein gelungener Aufruf ohne Inhalt ist kein
Fehler (Regel in `AGENTS.md`), und sonst sähe ein geschlossener Betrieb aus wie einer, den wir
nicht erreichen. `letzter_zeitraum` wird über `greatest()` fortgeschrieben, damit der
rückwärts laufende Historienlauf den erreichten Stand nicht zurückdreht.

Die Funktion **wirft nie**: der Fortschritt ist eine Beobachtung über die Arbeit, nicht die
Arbeit. Ein Fehler beim Notieren darf den Posten nicht mitnehmen, der gerade sauber geladen
wurde.

## Der Wächter über den Zulauf (Migration `0076`, 14.08.2026)

Phase 4 des Plans, und der Punkt, unter dem alle anderen stehen: **Stillstand
sieht aus wie Erfolg.** Zweimal hat das diesem Projekt Tage gekostet, und beide
Male auf verschiedene Weise — deshalb führt die Sicht **zwei** Zahlen:

| | Was ausfiel | Was frisch aussah |
|---|---|---|
| 02.08. / 12.08.2026 | es wurde nicht mehr **gefragt** | 269 von 269 Aufgaben „ok" |
| 10.08.2026 (Yext) | es kamen keine **Zeilen** | der Merker, täglich erneuert |

Eine Zahl allein hätte beide Male beruhigt.

**Drei Teile, mehr nicht** (der Plan verlangt ausdrücklich, es klein zu halten —
ein Wächter, der drei Wochen Arbeit ist, entsteht nie):

1. **`src/sync/quellen.ts`** — das Register: welche Quelle in welchem Takt
   Zulauf haben muss, je Eintrag begründet. In TypeScript und nicht als Seed in
   der Migration, damit es neben den Endpunkten liegt, die es beschreibt, und
   damit `waechter.test.ts` es **ohne Datenbank** gegen `AKTIVE_ENDPUNKTE`
   prüfen kann: kein aktiver Endpunkt kommt ohne Eintrag durch.
2. **`mart.quelle_zulauf`** — die Messung. Über `sync.aufgabe`, wo der Importer
   selbst protokolliert hat; direkt an der Tabelle für Yext, das keine Aufgabe
   schreibt (und dort ist es ohnehin die schärfere Prüfung).
3. **`src/sync/zulauf.ts`** — der Lauf meldet nicht mehr blind „ok". Läuft als
   **letztes**, nach allen Nachläufen: davor wäre Yext noch nicht geladen, und
   vier Quellen stünden in jedem Lauf als stumm da.

**Was der Lauf tut und was ausdrücklich nicht.** Er setzt `sync.lauf.status`
von `ok` auf `teilweise` und schreibt die Namen in die Notiz. Kein
`fehlgeschlagen` und kein Exitcode 1: der Lauf hat getan, was er konnte, und ein
Neustart durch Dokploy löst nichts. Ein Lauf, der schon `abgebrochen` ist,
behält seinen Grund — die erste Ursache ist die wichtigere.

**Zwei Funde beim Anlegen des Registers**, beide vorher unsichtbar:

* **`fn:profil` war ein Einmalposten** — vier Aufgaben, alle vom 02.08.2026,
  danach nie wieder. Es liefert die Benutzer-ID, aus der `fnEndpunkt()` die
  Pfade **aller anderen** FoodNotify-Aufrufe baut. Ändert sie sich, laufen sie
  geschlossen ins Leere. Läuft seit dem 14.08.2026 täglich mit den übrigen
  Stammdaten mit (+4 Aufrufe am Tag gegen 140.000 Budget).
* **Drei `core`-Tabellen haben null Zeilen und keinen Schreiber**:
  `core.rezept`, `core.pos_artikel`, `core.ware_stand`. Sie stehen im Register
  als `erwartet: false` mit Begründung — siehe `offene-punkte.md`.

## Zehn Umsatzberichte statt zwei (Migration `0077`, 14.08.2026)

`getUmsatzbericht` wird jetzt zehnmal geholt: einmal ohne Filter (die
Gesamtzeile) und neunmal je Hauptsparte. Der Unterschied ist ein einziges
Query-Feld (`hauptsparten`), und der Loader schlägt daraus die `hauptsparte_key`
nach — alle zehn teilen sich deshalb einen `case`.

**`hauptsparten` erwartet die `posId`, NICHT die `nummer`.** Mit der `nummer`
kommt kommentarlos 0 €. Das steht seit dem 26.07.2026 am Eintrag für Speisen und
gilt für alle. Drei der zehn Sparten tragen zweistellige `posId` (92 Pfand,
94 Trinkgeld, 95 Gutschein) — ein älterer Nummernkreis, aber ebenfalls `posId`.

**Aufrufe:** acht zusätzliche Endpunkte × 10 Nachzügler-Tage = 80 am Tag.

```
vorher       6 × 10 + 2 × 21 (Personal, Artikel) + 2 BWA-Jahre    ~104
Sparten      8 × 10                                                +80
                                                       ~184 von 10.500
```

Ein neuer Spartenendpunkt ist damit ein Registereintrag, eine `case`-Zeile, ein
Schema-Eintrag und eine Zeile im Quellenregister — der Wächter
(`waechter.test.ts`) lässt keinen davon weg.

## Yext braucht keinen Befehl mehr (Migration `0078`, 14.08.2026)

Drei Dinge hingen bis dahin an einem Menschen oder an der falschen Stelle:

| | vorher | jetzt |
|---|---|---|
| Vollabgleich, 25 Monate | `bun run yext --voll`, zuletzt 03.08.2026 | im Nachlauf, alle 30 Tage |
| Zuordnung Betrieb → Entität | `bun run yext:zuordnen --schreiben`, zuletzt 03.08.2026 | im selben Takt |
| Reihenfolge | letzter Nachlauf, **hinter** dem Round Table | zweiter Nachlauf, **vor** allem Materialisierten |

**Die Zuordnung läuft VOR den Ständen**, und das ist keine Kosmetik:
`staendeLaden()` fragt Yext je *zugeordnetem* Betrieb. Ein Betrieb ohne Eintrag
in `manual.betrieb_fremd_id` wird nicht geholt — kein Fehler, keine leere Zeile,
gar nichts. Liefe die Zuordnung dahinter, bekäme ein neuer Betrieb seine erste
Bewertung einen Monat später.

**Monatlich und nicht täglich**, weil die Namensheuristik dabei entscheidet —
und eine Entscheidung, die sich täglich neu fällt, ist keine. Der Takt hängt an
einem Merker (`yext_letzte_zuordnung`, `yext_letzter_vollabgleich`) und nicht am
Monatsersten: sonst machte der Ausfall eines einzigen Laufs den Ausfall eines
ganzen Monats.

**Aufrufe:** der Vollabgleich kostet rund 3.300 statt 400, einmal im Monat. Das
Stundenlimit der Yext Management API liegt bei 5.000. Der Zuordnungsabgleich
sind zwei Aufrufe (Entitäten und Ordner).

`src/yext_zuordnen.ts` bleibt als **Vorschau** — es rechnet nichts mehr selbst,
sondern ruft denselben Abgleich auf und druckt ihn lesbar aus. Wer eine neue
Entität in `VON_HAND` einträgt, will vor dem Schreiben sehen, was daraus folgt;
der nächtliche Lauf zeigt das nicht, er schreibt.

## Kein Backfill mehr auf Zuruf (14.08.2026)

`bun run einreihen --historie` war der letzte Befehl, den ein Mensch anstoßen
musste. Am 14.08.2026 nachgemessen hatte er nichts mehr zu tun: für die acht
alten Tagesendpunkte fehlt seit dem 01.01.2018 **kein einziger** Geschäftstag.

**Das war Glück und kein Argument.** Mit den acht neuen Hauptsparten (`0077`)
fehlen rund 3.100 Tage je Endpunkt — die es ohne einen automatischen Weg erst
ab heute gäbe, und niemand hätte es der Spartenauswertung angesehen.

`historieNachziehen()` in `src/sync/nachfuellen.ts` vergleicht deshalb bei jedem
Lauf die Abdeckung jedes aktiven Tagesendpunkts gegen `HISTORIE_AB` und reiht
die fehlenden Tage ein — **neueste zuerst** und höchstens `HISTORIE_JE_LAUF`
(2.000) über alle Endpunkte zusammen.

```
laufender Betrieb   ~184
Nachholen          2.000
                   ~2.184 von 10.500
```

Bei diesem Tempo stehen die acht Sparten nach gut zwei Wochen. Danach reiht die
Funktion 0 Posten ein und kostet eine Abfrage je Endpunkt und Nacht.

**Neueste zuerst** ist keine Geschmacksfrage: ein Backfill, der vorne anfängt,
liefert das Nützlichste zuletzt, und bricht er ab, fehlt genau das.

Die vier Schalter in `src/einreihen.ts` bleiben stehen — als Entscheidung über
einen *bestimmten* Zeitraum sind sie weiter brauchbar. Gebraucht werden sie
nicht mehr; `--foodnotify` und `--foodnotify-inventuren` sind seit dem
13.08.2026 ohnehin täglicher Betrieb.

## Die Handpflege hat einen Weg (Migration `0079`, 14.08.2026)

Sechs Tabellen, sechs Wege — und fünf davon führten durch eine Migration. Jetzt
einer: eine Datei in `pflege/`, committet und gepusht, wird vom nächsten Lauf
eingelesen (`pflegeNachlauf()`, vor allem Materialisierten, weil
`manual.om_einschaetzung` in den Round Table eingeht).

**Drei Eigenschaften, die weder ein Upload noch ein Formular hätte:** eine
Historie (`git log`), eine Überprüfung vor dem Wirksamwerden (der Commit ist
lesbar), und einen Weg zurück (`git revert`).

**Nur Upsert, nie Löschen.** Eine Zeile, die aus der Datei verschwindet, bleibt
in der Tabelle — eine versehentlich halb gespeicherte Excel-Datei würde sonst
Monate an Noten entfernen, und der Verlust sähe aus wie ein Betrieb ohne
Bewertung.

**Und ganz oder gar nicht.** Ein unbekannter Spaltenname, ein Betriebsname, den
es nicht gibt, eine Zahl, die keine ist: die ganze Datei wird abgewiesen, der
Grund steht in `mart.pflege_stand`. Der wichtigste Fall ist der Tippfehler im
Betriebsnamen — der einzige, bei dem ein nachsichtiger Importer eine Note
**verschwinden** ließe, ohne dass irgendwo etwas rot wird.

**Die Spaltennamen kommen aus dem Register in `src/pflege/tabellen.ts`, die
Typen aus dem Katalog.** Nie aus der Datei: sonst wäre die Kopfzeile einer CSV
eine Eingabe in SQL.

**Feiertage und Schulferien holt der Lauf selbst** — einmal im Monat von
`openholidaysapi.org`, derselben Quelle, die schon in `manual.feiertag.quelle`
steht. Sie liefert beides über denselben Weg, frei und ohne Schlüssel, und
stellt die Jahre weit im Voraus bereit (am 14.08.2026 nachgesehen: 2029
vollständig). Vorlauf drei Jahre.

**Der Vergleichstag wird nachts materialisiert** (`src/sync/vergleichstag.ts`,
seit Migration `0084`). Er steht **nach `pflegeNachlauf()`** — der schreibt die
Feiertage, aus denen die Sicht liest; andersherum trüge die Materialisierung
den Kalenderstand vom Vortag. Dieselbe Falle, die `yextNachlauf()` bis zum
14.08.2026 hatte.

Gemessen am 20.08.2026: `REFRESH ... CONCURRENTLY` über 443.304 Zeilen in
**40,9 s** — neben den zwei Minuten des Artikel-Refresh (`0068`) unauffällig.
Wirft nie: ein misslungener Refresh bedeutet einen veralteten Vergleichstag,
keine verlorenen Daten.

**Ein Sonderfall, den `round_table.ts` nebenan nicht behandelt:** `REFRESH ...
CONCURRENTLY` scheitert mit PG `55000`, wenn die Sicht **nie befüllt** wurde —
der Normalfall in einer frisch geklonten Datenbank, denn CONCURRENTLY braucht
einen alten Stand, gegen den es abgleicht. Genau daran hing der
Ende-zu-Ende-Test nach `0080`. `vergleichstagAuffrischen()` fängt diesen einen
Fehlercode ab und befüllt einmal ohne CONCURRENTLY; danach greift der normale
Weg.

**Das Wetter holt der Lauf selbst** (`src/wetter/nachlauf.ts`, seit Migration
`0086`). Zwei Dinge an einer Stelle: ein **rollierendes Fenster** über die
letzten 14 Tage (48 Aufrufe, einer je Gitterpunkt — DWD-Stationen melden nach
und korrigieren) und ein **Backfill mit Obergrenze**
(`WETTER_BACKFILL_JE_LAUF`, Vorgabe 60 Ortsjahre), neueste zuerst. Kein
Handbefehl; auf 0 gesetzt hört das Nachholen auf.

Die Einheit ist das **Ortsjahr, also genau ein Aufruf** — Bright Sky liefert
ein volles Jahr in einer Antwort. Der Plan nannte die Größe
`WETTER_BACKFILL_ORTE_PRO_NACHT`; ein Ort trägt aber neun Jahre, die Zahl im
Namen hätte um den Faktor neun danebengelegen.

Er steht **vor `vergleichstagNachlauf()`**: dessen Hülle liest über
`mart.betrieb_wetter_tag` mit. Wirft nie — ein fehlender Wetterwert ist eine
leere Spalte, kein verlorener Umsatz.

**Gemessen am 20.08.2026:** 48 + 66 Aufrufe, 596.032 Zeilen, 1.024 s. Dabei 30
Fehlschläge, alle in Jahrgängen ab 2024 abwärts — ein Aufruf für 2024 braucht
108 s, das Zeitlimit stand auf 60. Es steht jetzt auf 180 s. Ein gescheitertes
Ortsjahr bleibt in `mart.wetter_rueckstand` als `fehlt` stehen und wird in der
nächsten Nacht erneut geholt.

---

## Was jede Nacht abgefragt wird — und was davon etwas bringt (24.08.2026)

Anlass war eine Frage von Eugene: *„Die Anzahl der Requests scheint mir verrückt
hoch. Wenn alles per Backfill aufgefüllt wurde, muss doch nur ein Tag pro Betrieb
geholt werden."* Nachgemessen an Lauf 101 (24.08., 10 h 08, 10.355 Aufgaben) und
am `raw`-Archiv der letzten zwölf Tage. Die Vermutung stimmt, aber aus zwei
verschiedenen Gründen.

### Die Verteilung

| Anteil | Endpunkt | Aufrufe | Zeilen | Zeit |
|--:|---|--:|--:|--:|
| 55 % | `la:belegzahl` | 1.974 | 1.974 | 6 h 40 |
| 25 % | Historien-Backfill (`getUmsatzbericht:trinkgeld`) | 1.990 | 282.141 | 2 h 57 |
| 16 % | `fn:bestellung` + `fn:bestellpositionen` | 6.002 | 44.991 | 1 h 51 |
| 4 % | alles Übrige | ~390 | 570.000 | ~30 min |

Nur der zweite Block ist Backfill und damit endlich (noch ~9.500 Tage, bei 2.000
je Lauf also rund fünf Nächte). Die beiden anderen laufen **jede Nacht neu**.

### `la:belegzahl`: 1.974 Aufrufe für einen Tag — aber nicht wegen des Tages

Die 1.974 sind **nicht** 1.974 Tage. Es ist **141 Betriebe × 14 Belegarten für
genau einen Stichtag**, und jede Antwort ist eine einzige Zahl (`recordsTotal`).

Der Grund ist kein Versehen, sondern eine bewusste Entscheidung aus dem
13.08.2026: die Ladenakte bietet **kein Delta**. Ein Fenster über Zeilenversatz
(`start=<bekannt>`) wurde verworfen, weil `lina_id` innerhalb eines Ordners nicht
verlässlich mit der Uploadzeit mitläuft — gemessen: Korrelation im Mittel 0,991,
aber acht Ordner unter 0,9, kleinster Wert 0,779. Wird in der Mitte eines Ordners
gelöscht und hinten angehängt, bliebe `recordsTotal` gleich, das Fenster
verschöbe sich, und der neue Beleg fehlte **für immer, lautlos**. Die tägliche
Zählung ist der Ersatz für das fehlende Delta.

**Was sie kostet, und was sie findet:**

| Lauf | Zählproben | daraus volle Abzüge |
|--:|--:|--:|
| 96 | 1.974 | 41 |
| 97 | 1.974 | 34 |
| 98 | 1.974 | 26 |
| 99 | 1.974 | 20 |
| 100 | 1.974 | 17 |
| 101 | 1.974 | 21 |

**Rund ein Prozent.** 1.953 Proben je Nacht à 12,2 s (7,2 s Arbeit, 5,0 s Pause)
stellen fest, dass sich nichts geändert hat — 6 h 37 der Laufzeit.

**Und der Sparmechanismus greift kaum:** eine Zählprobe kostet im Mittel
7.159 ms, ein **voller Ordnerabzug** (`la:belegliste`, derselbe Pfad mit großem
`length`) 8.272 ms. Die Probe spart also **13 % gegenüber dem, was sie vermeiden
soll** — der Preis ist der HTTP-Umlauf gegen eine Weboberfläche, nicht die
Nutzlast. Zum Vergleich: `la:belegliste` holte im selben Lauf **108.839 Zeilen in
21 Aufrufen**.

Daraus folgt: der Hebel ist nicht die Probe, sondern der **Takt**. Bei
wöchentlicher Rotation statt täglich (282 statt 1.974 Proben je Nacht) fiele
dieser Block von 6 h 40 auf rund 55 min; der Preis wäre, dass ein neuer Beleg bis
zu sieben Tage später auffällt. Das ist eine fachliche Abwägung und keine
technische — deshalb steht sie hier und ist nicht umgesetzt.

### FoodNotify: 2.144 der 2.960 aufgefrischten Bestellungen sind nachweislich eingefroren

`bestelldetailsAuffrischen()` holt jede Bestellung der letzten
`BESTELLDETAIL_FENSTER_TAGE` (45) erneut, sofern ihr Status nicht `canceled` oder
`finished` ist. Gemessen sind das **2.960 Bestellungen × 2 Endpunkte = 5.920
Aufrufe je Nacht**.

**Die Statusbedingung greift praktisch nie.** In Produktion:

| Status | Bestellungen |
|---|--:|
| `imported` | 47.920 |
| `pending` | 16.288 |
| `canceled` | 3.350 |
| `accepted` | 61 |
| **`finished`** | **13** |

13 von 67.632. Eine Bestellung verlässt das Fenster also faktisch nie über ihren
Status, sondern nur, indem sie 45 Tage alt wird.

**Was die Auffrischung tatsächlich einbringt** — `raw.api_antwort` hat
`payload_hash`, die Frage ist also exakt beantwortbar:

*Positionen* (`fn:bestellpositionen`, 400 Bestellungen, 4.026 Abrufe über 12 Tage):
322 der 400 Antworten änderten sich auf Rohebene — **aber 0 von 400 änderten sich
im Inhalt der Bestellung.** Der Unterschied steckt ausschließlich in Feldern, die
FoodNotify mitliefert und die nichts mit der Bestellung zu tun haben:
`concreteProduct.stock` (aktueller Lagerbestand), `timeModified` des
Artikelstamms, `productStockDetails.arrivingOrders`. Position, Menge, Preis,
Status: unverändert. **`payload_hash` ist bei diesem Endpunkt kein
Änderungsmerkmal, sondern das Rauschen des Artikelstamms.**

*Köpfe* (`fn:bestellung`, 3.182 Bestellungen, 31.942 Abrufe): 87,2 % änderten
sich kein einziges Mal. Die 408, die sich änderten, taten es hier:

| Alter der Bestellung bei der Änderung | Änderungen |
|---|--:|
| 0–3 Tage | 277 |
| 4–7 Tage | 189 |
| 8–14 Tage | 6 |
| **älter als 14 Tage** | **0** |

In zwölf Tagen Beobachtung keine einzige Änderung an einer Bestellung, die älter
als 14 Tage war. Das Fenster steht auf 45.

| | Bestellungen | Aufrufe je Nacht |
|---|--:|--:|
| 0–14 Tage — ändert sich noch | 816 | 1.632 |
| **15–45 Tage — nachweislich eingefroren** | **2.144** | **4.288** |

**72 % der FoodNotify-Aufrufe je Nacht holen Daten, die sich nachweislich nicht
mehr ändern.**

> ### Behoben am 25.08.2026 (Migration `0098`) — und zwar anders als hier vorgeschlagen
>
> Der naheliegende Einzeiler wäre gewesen, `BESTELLDETAIL_FENSTER_TAGE` von 45
> auf 14 zu setzen: 4.288 Aufrufe gespart. Er wurde **nicht** gewählt, aus zwei
> Gründen. Erstens bliebe es dabei, dass jede Bestellung im Fenster
> **vierzehnmal** geholt wird, obwohl sie sich im Schnitt einmal ändert.
> Zweitens hinge er an einer Messung über zwölf Tage ohne Monatswechsel —
> genau der Fall, für den die Auffrischung gebaut wurde.
>
> **Stattdessen entscheidet jetzt ein Auslöser statt einer Frist.** Die
> Bestellliste (`fn:bestellungen`) wird ohnehin in jedem Lauf geholt und trägt
> genau die Felder, die sich ändern — `shopOrderStatus`, `shopOrderInvoices`,
> `shopOrderDeliveryNote`, `extDeliveryNoteId`, `billingSyncStatus`, `total`,
> `markedShopOrder`, `comment`. Einen Lagerbestand enthält sie **nicht**; das
> Rauschen, an dem `payload_hash` auf dem Detail scheitert, gibt es hier gar
> nicht.
>
> `core.bestellung` trägt deshalb zwei Spalten:
>
> | Spalte | Bedeutung |
> |---|---|
> | `listen_fingerabdruck` | md5 des kanonisch sortierten Listeneintrags, bei jedem Listenabruf neu |
> | `detail_fingerabdruck` | für welchen Listenstand das Detail geholt wurde |
>
> Gehen beide auseinander, gibt es Arbeit — und zwar **genau einmal je
> Änderung**. Der Zustand steht damit in der Datenbank statt in einer
> Zeitrechnung (Regel 10); `mart.bestelldetail_offen` zählt ihn, und die
> Prüfzeile „FoodNotify: Detail passt nicht zum Listenstand" hängt daran.
>
> **Was dabei mitgehen musste:** die alte Prüfzeile „Bestellung: Details im
> Fenster älter als 48 h" beschreibt ein Verfahren, das es nicht mehr gibt.
> Sie ist aus `mart.pruefung_uebersicht` entfernt worden — ein Prüflabel, das
> etwas anderes sagt als es misst, steht in derselben Tabelle wie die richtigen
> und wird genauso gelesen.
>
> **Der Preis:** die Liste ist jetzt das Auge des Abgleichs, also wird sie
> tiefer gelesen — `BESTELLDETAIL_LISTENSEITEN` (Vorgabe 2) statt nur der
> letzten Seite. Eine Seite fasst 25 Bestellungen; die aktivste Kostenstelle
> hatte in 14 Tagen genau 25, der Median 8. Kosten: rund 300 Listenaufrufe je
> Nacht statt 152, gegen bis zu 5.920 eingesparte Detailaufrufe.
>
> **Einmalig in der ersten Nacht:** alle Bestellungen auf den gelesenen
> Listenseiten haben noch keinen `detail_fingerabdruck` und werden deshalb
> einmal nachgeholt — rund 3.500 Aufrufe, also weniger als bisher jede Nacht.
> Danach fällt der Verbrauch auf die tatsächlichen Änderungen.

**Der Einwand, der die Lösung geformt hat:** die zwölf Tage Beobachtung decken
keine Monatsabrechnung ab. Wenn Rechnungen zum Monatsende gebündelt nachgetragen
werden, träfe eine 14-Tage-Grenze genau den Fall, für den die Auffrischung
gebaut wurde (Phase 2.6). Der Fingerabdruck verfehlt ihn nicht: er sieht die
Änderung, wann immer sie kommt, solange die Bestellung in den gelesenen
Listenseiten steht.

### Und der Lagerbestand?

Er wird **nicht erfasst** — `core.bestellposition` hat keine Lagerspalte, und das
soll so bleiben. Der Wert in der Bestellantwort ist der Bestand **zum
Abrufzeitpunkt**, nicht der zur Bestellung; er taugt deshalb grundsätzlich nicht
dazu, den Verbrauch einer Zutat nachzuvollziehen. Ihn mitzuschreiben ergäbe eine
Zeitreihe, deren Stützstellen davon abhängen, wann wir zufällig abgefragt haben.

Die richtige Quelle dafür gibt es bereits und dieses Projekt lädt sie: die
Inventur (`/api/erp/stocktakings`) mit `theoreticalStockLevelInBaseUnits` und
`countedAmountInBaseUnits` je Position. Sie ist eine echte Zählung zu einem
bekannten Stichtag. Wer den Zutatenverbrauch rechnen will, stellt sie gegen die
Bestellungen — nicht gegen einen Lagerstand, der als Beiwerk in einer
Bestellantwort mitgeliefert wurde.
