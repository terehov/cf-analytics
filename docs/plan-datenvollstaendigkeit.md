# Plan: alles holen, alles aktuell halten

> **Stand 13.08.2026 abends: Phase 1, 1c und 2 sind umgesetzt und committet,
> aber NICHT deployt** — Produktion steht auf `0070`, die Migrationen `0071`
> bis `0074` liegen bereit. Was seit dem Schreiben dieses Plans gemessen wurde
> und ihm widerspricht, steht in `befunde-datenlage.md` (die beiden
> Fenster-Artefakte zu 2.1/2.3) und `lina-api-korrekturen.md` (`fn:betriebe`
> zu 2.8). Die Nachprüfungen nach dem Deploy stehen in `offene-punkte.md`.
> Offen bleiben die Phasen 3 bis 6 und die vier Entscheidungen in Abschnitt 4.

Stand 13.08.2026. Grundlage ist ein Audit vom selben Tag, das jede Aussage in
der Produktionsdatenbank nachgemessen hat — nicht am Code, nicht an der lokalen
Datenbank (die ist ein Torso, siehe `docs/backfill.md`).

**Der Anlass war eine Kleinigkeit:** in den Einkaufs-Dashboards stand „… lädt".
Es war keine hängende Ladeanzeige, sondern unser eigener Text — und die Suche
danach hat einen Zustand freigelegt, der weit darüber hinausgeht.

**Der Satz, um den es geht:** Der nächtliche Lauf meldet seit dem 06.08.2026
jeden Tag „ok" — Lauf 88 heute um 05:07 mit 269 von 269 Aufgaben, null Fehler.
Trotzdem stehen mehrere Quellen still. **Ein Importer ohne Arbeit sieht genauso
aus wie einer, der fertig ist.** Dieser Satz steht seit dem 02.08.2026 im Kopf
von `src/sync.ts`, nachdem LINA acht Tage stillstand, ohne dass es auffiel. Er
gilt weiterhin, nur an anderen Stellen.

---

## 1. Was heute nachweislich nicht mehr nachläuft

Alle Zahlen aus der Produktion, gemessen am 13.08.2026.

### 1.1 Das Belegarchiv ist eingefroren — der teuerste Befund

`core.buchungsbeleg` bekommt keinen Zulauf mehr:

| Tag | neu hochgeladene Belege |
|---|---|
| 08.08. | 89 |
| 09.08. | 187 |
| 10.08. | 659 |
| 11.08. | 488 |
| **12.08.** | **0** |
| **13.08.** | **0** |

Das Mittel der 19 Tage davor liegt bei rund 300 Belegen am Tag.

**Die Ursache ist bauartbedingt, nicht ein Ausfall.** `ladenakteNachfuellen()`
in `src/sync/nachfuellen.ts:352-360` reiht `la:belegliste` nur für solche Paare
aus Betrieb und Ordner ein, für die es **noch keinen** Bestandssatz mit
`records_total > 0` gibt. Der Abzug lief am 12.08. um 13:25 fertig — seither
liefert die Einreihbedingung 0 Zeilen. Die Läufe 85 bis 88 hatten je **null**
`la:*`-Aufgaben. Alle 621 Posten stehen auf „ok".

Torwächter ist `manual.belegarchiv_soll`: 1.048 Zeilen aus 131 Betrieben × 8
Ordnertypen, `gemessen_am` durchgehend 2026-08-11, einmal von Hand aus
`docs/ladenakte-bestand.csv` in Migration `0053` geschrieben und seither von
keinem Code fortgeschrieben.

**Was das im Dashboard anrichtet:** Der Belegarchiv-Anteil in `mart.fremdeinkauf`
fällt von stabil 76–82 % auf **52,3 % im August**. Fehlende Fremdrechnungen
sehen dort aus wie gesunkener Fremdeinkauf, nicht wie eine Lücke. Die Sicht
hängt an 18 Kartenstellen und ist damit die meistgenutzte Einkaufssicht.

Zwei Nebenwirkungen desselben Torwächters:

* **6 von 14 Belegarten wurden nie geholt** und können es bauartbedingt nie
  werden: `typ_id` 16, 3968, 3969, 3971, 3972, 3976 haben null Soll-Zeilen.
* **10 Betriebe haben keine Soll-Zeile.** Derzeit ist keiner davon operativ
  (3 geschlossen, 6 ohne Geschäft, 1 Test) — aber ein neu eröffneter Betrieb
  nähme denselben Weg und fiele ebenso stumm heraus.

### 1.2 275 aufgegebene Posten, 686.536 € ohne Positionen

`select count(*) from sync.warteschlange where ergebnis='aufgegeben'` → **275**,
ausnahmslos `fn:bestellpositionen`.

Folge: **322 Bestellungen über 686.536 €** stehen mit Kopf, aber ohne eine
einzige Position in der Datenbank. Sie zählen in `mart.einkauf_beleg` voll mit
und fehlen in jeder Positions- und Preissicht. `aufgegeben` setzt `erledigt_am`,
und kein Code holt aufgegebene Posten zurück — sie werden nie nachgeholt.

### 1.3 Inventurpositionen enden bei genau 800

`/api/erp/stocktakings/{uuid}/items` ist paginiert und sagt das auch:
`{perPage: 800, totalItems: 817, totalPages: 2}`. Der Pfadbau in
`src/foodnotify/endpunkte.ts:145` kennt keinen `page`-Parameter, und beim Laden
gibt es keine Folgeseiten-Kette wie bei `fn:bestellungen`.

Keine der 358 Inventuren in Produktion hat mehr als 800 Positionen; das Maximum
ist **exakt 800**. Neun Inventuren stoßen an, ihnen fehlen zusammen **936
Positionen** (02.02. bis 03.08.2026). Der Kopf zeigt weiter `anzahl_positionen`
bis 1426. Betroffen sind die größten Inventuren, also die mit dem höchsten
Warenwert — `mart.inventur_schwund` rechnet für sie einen zu kleinen Bestand.

Der Fehler ist lautlos: HTTP 200, kein Fehler, kein Log.

Aus derselben Quelle: **28,7 % aller Inventurpositionen tragen keine Zählung.**
Der Folgeposten entsteht einmal je `uuid`, nachträgliche Zählungen erreichen
`core` nie.

### 1.4 LINA bucht nach — unser Fenster ist zu kurz

**BWA / `getKennzahlen`:** `nachfuellen.ts:75` reiht ausschließlich das Jahr von
„gestern" ein. 2025 wurde zuletzt am 27.07.2026 geholt, 2018–2024 zwischen dem
27.07. und dem 01.08.; seither nie wieder.

Dass das folgenlos wäre, ist widerlegt. `core.kennzahlen_monat` ist append-only,
deshalb ließ sich messen, wann sich Werte real geändert haben: **selbst der
Januar 2026 hat sich noch am 12.08.2026 geändert** (3 Werte, 7.059,52 €).
Rückbuchungen über sieben Monate sind der Normalfall. Dezember-2025-Nachbuchungen
aus Februar/März 2026 sind in Produktion nie angekommen und mit dem vorhandenen
Werkzeug auch nicht nachholbar — `sync.historie_einreihen` überspringt erledigte
Zeiträume.

**Tagesberichte:** `NACHZUEGLER_TAGE = 10` (`src/config.ts:339`). An
`raw.api_antwort.payload_hash` gemessen setzen sich Umsatz und Artikel binnen
fünf Tagen. **Personalkosten nicht:** LINA ändert noch an Tag 10 (12 Änderungen)
und Tag 11 (8 Änderungen) — genau dort hört der Sync auf hinzusehen.
`core.personalkosten` ist ein Upsert ohne Historie, der Verlust ist unsichtbar.

**Eine latente Falle daneben:** `linaNachfuellen()` hat Zweige für `tag`, `jahr`
und Momentaufnahmen — aber **keinen für `monat`**. Alle vier `getReport`-Endpunkte
tragen `schrittweite: 'monat'` und `aktiv: false`. Wer eines Tages nur `aktiv: true`
setzt, reiht damit weiterhin null Posten ein und merkt es nicht.

### 1.5 FoodNotify-Stammdaten hängen im Monatstakt

`fn:betriebe`, `fn:kostenstellen` und `fn:pos_standorte` werden nur einmal je
Kalendermonat eingereiht (`nachfuellen.ts:160-165`) — seit 11 Tagen nicht mehr
abgerufen. Am Budget liegt es nicht: FoodNotify erlaubt 140.000 Aufrufe am Tag,
verbraucht werden rund 155.

Gemessene Folge: **25 von 152 Kostenstellen haben keinen `betrieb_key`**,
darunter zwei aktive Betriebe, deren Einkauf aus allen betriebsbezogenen Sichten
fällt. Die dafür gebauten Funktionen `manual.betrieb_vorschlaege_berechnen()` und
`betrieb_zuordnung_anwenden()` werden in Produktion **nie** aufgerufen — kein
Produktionspfad ruft sie, nur Tests.

### 1.6 Ein Drittel des Umsatzes ist nicht aufteilbar

`core.hauptsparte` hat 10 Zeilen, gefüllt werden zwei: Speisen (`posId` 10001)
und Getränke (10002). Für Gutscheine, Sonstiges, Straßenverkauf, Pfand,
Trinkgeld und Lieferkosten gibt es keinen Aufruf.

Gemessen vom 29.07. bis 11.08.: Gesamt 4.528.522,02 €, davon Speisen
1.766.418,77 € und Getränke 1.349.113,60 €. **Rest 1.412.989,65 € = 31,20 %.**
Der Betrag steckt in der Gesamtzeile, ist aber nicht aufteilbar.

### 1.7 Das „… lädt" — ein Falschalarm mit zwei Gesichtern

`metabase/karten-fach.ts:881` schreibt wörtlich `'… lädt'`, solange
`liste_vollstaendig` falsch ist. Die Spalte kommt aus `mart.einkauf_ladestand`
(Migration `0043`, Zeile 311/330): sie zählt offene `fn:bestellungen`-Posten
**je Marke** und hängt diese eine Zahl per `LEFT JOIN` an **jede** Monatszeile
der Marke.

In Produktion steht genau ein offener Posten: Nr. 28629, Enchilada, `erpId`
11805 — **„Layer-Chemie Testbetrieb"**, eine Kostenstelle im Enchilada-Mandanten,
die uns nicht gehört: `betrieb_key IS NULL`, 0 Bestellungen, 0 Rohantworten. Es
fehlt also nichts. Trotzdem färbt er alle **60 Enchilada-Monatszeilen** auf
„unvollständig".

Er kommt auch nie heraus: der 403-Zweig in `src/sync/worker.ts:654-671` setzt
`versuche = greatest(0, versuche - 1)` und springt per `continue` am
Aufgeben-Zweig (Zeile 725) vorbei. `sync.posten_holen()` zählt vorher hoch, der
Zweig zählt wieder herunter — netto ±0 pro Tag, seit neun Tagen. Das ist bewusst
so gebaut (Kommentar Zeile 645-649), aber ohne Obergrenze.

**Dieselbe Spalte lügt in die andere Richtung:** Wilma Wunder, Aposto und
Deutsche Konzepte melden „✓ vollständig", obwohl dort 46 Bestellungen ohne
Positionen liegen. Der Zähler sieht nur `fn:bestellungen`, nicht die Positionen.

### 1.8 Yext: Fenster, Zuordnung, Reihenfolge

* `staendeLaden` läuft mit drei Monaten (`nachlauf.ts:54,96`) — in
  `core.bewertung_stand` ist dadurch nachweislich ein Bruch entstanden. Die
  Altmonate korrigiert nur der Handlauf `bun run yext --voll` (25 Monate).
* **7 operative Betriebe mit Umsatz** haben keine Yext-Zuordnung und fehlen
  in jeder Bewertungstabelle. Geschrieben wird die Zuordnung nur von
  `bun run yext:zuordnen`.
* `core.betrieb_sichtbarkeit.eintraege_live` ist in **allen 1.497 Zeilen NULL**.
  `mart.betrieb_sichtbarkeit` hängt an 6 Kartenstellen und zeigt dort eine
  dauerhaft leere Spalte hinter einer grünen Statusampel.
* `yextNachlauf()` ist der **letzte** Nachlauf (`src/sync.ts:91`), der
  Round-Table-Refresh läuft davor — zwei Betriebe tragen heute eine veraltete
  Note in der Ampel.

### 1.9 Handgepflegte Tabellen ohne Pflegeweg

`manual.om_einschaetzung` endet im Juni: 23 fest im Quelltext stehende Noten auf
einen verdrahteten Monat. Folge — **`ampel_om` ist seit Juli für alle 141
Betriebe leer**, und das Round-Table-Gesamturteil wird **grün, wenn Signale
wegfallen**: drei von 56 operativen Betrieben tragen im August ein grünes
Gesamturteil ohne OM-Note. `mart.round_table_monat` ist mit 42 Kartenreferenzen
die meistgenutzte Sicht überhaupt.

Daneben leer oder eingefroren: `manual.bwa_zeile` (0 Zeilen, lässt
`mart.bwa_quellen_vergleich` per `INNER JOIN` auf null Zeilen laufen),
`manual.sachkonto`, `manual.ursache`, `manual.massnahme`, `manual.marktindex`
(endet 2026-05), `manual.lieferant_freigabe` (5 Freigaben gegen 10.205
Dachnamen), `manual.gfgh_betrieb` (13 von 141). `manual.feiertag` und
`manual.schulferien` reichen bis Ende 2027 und reißen danach.
`ampel.regel`/`regelwerk`/`beschriftung` sind ein unrevidierter Seed aus
Migration `0004` — und entscheiden über grün/orange/rot im ganzen Round Table.

### 1.10 Datenqualität, die durch die Sichten leckt

* **46 Belege mit `beleg_datum` bis 2038-01-19** erzeugen Phantomzeilen in vier
  Mart-Sichten (`einkauf_kreditor_monat` 27, `fremdeinkauf` 27,
  `buchungsbeleg_monat` 30, `wareneinsatz_beleg_monat` 29) und machen
  `max(monat)` als Frischemaß unbrauchbar. 20 Lieferanten tragen ein
  Zukunftsdatum als „letzter Beleg".
* **32.066 Belege** tragen eine mehrfach vergebene `encrypted_id`.
* `mart.inventur_schwund` ignoriert das `unplausibel`-Kennzeichen — der Februar
  2026 steht mit minus 2,97 Mio € aus **einer** Zeile.
* `sync.fortschritt` hat 0 Zeilen und **keinen Schreiber im ganzen Repo** — wird
  aber von `src/health.ts:39` gelesen. Der Gesundheitsbericht meldet
  strukturbedingt für immer „null pausierte Endpunkte".

---

## 2. Was ausdrücklich in Ordnung ist

Damit die Liste oben nicht den Blick verstellt — geprüft und für gut befunden:

* **Der Sync läuft.** Seit dem 06.08. jeder Kalendertag, kein Tag fehlt. Von den
  letzten 14 Läufen sind 12 „ok" und 2 „teilweise". Keine aktive Zugangssperre.
* **Alle neun materialisierten Sichten sind frisch**, heute Nacht aufgefrischt,
  keine eingefroren, keine verwaist.
* **LINA-Tagesberichte** (Umsatz, Artikel, Zeitzonen, Aktionen) sind fachlich
  zwei Kalendertage alt — das ist der Quelltakt, kein Rückstand.
* **FoodNotify-Bestellungen** laufen weiter, letzte Bestellung 12.08. 19:06.
* **Yext-Analytics** sind weder veraltet noch löchrig.
* Der `VerbotenerPfad`-Fehler aus dem Lauf-Log war ein Fehlalarm und ist seit
  dem 12.08. 07:13 verschwunden.
* Der Merkzettel „Inventur-Backfill bleibt manuell" ist **überholt** — er läuft
  von selbst.
* Die BWA-Sichten mit den drastischsten Zahlen (`bwa_plan_ist` ohne Planwerte
  für 2026, `mart.tagesbudget` durchweg 0, `bwa_longterm_stand` meldet
  fälschlich „gefüllt") haben **null Metabase-Referenzen**. Sie sind kaputt,
  aber niemand sieht sie. Deshalb stehen sie in diesem Plan weit hinten.

---

## 3. Die Reihenfolge

Sechs Phasen, jede für sich deploybar, jede mit einem nachprüfbaren Ergebnis.
Sortiert nach gestopptem Datenverlust, nicht nach Aufwand.

### Phase 1 — den Verlust stoppen

Alles, was **heute** Daten verliert, die morgen nicht mehr nachholbar sind.

| # | Was | Berührt |
|---|---|---|
| 1.1 | Belegarchiv-Zulauf dauerhaft machen: der tägliche Lauf muss den Zuwachs erkennen, statt einmalig gegen `manual.belegarchiv_soll` zu prüfen. Kern ist der Abgleich `records_total` heute gegen zuletzt aus `core.belegarchiv_bestand`. Neue Betriebe und Ordner müssen von selbst dazukommen. | `src/sync/nachfuellen.ts`, `src/ladenakte/laden.ts` |
| 1.2 | Paginierung für `fn:inventurpositionen` — genauso gebaut wie die Folgeseiten von `fn:bestellungen`, nicht anders. | `src/foodnotify/endpunkte.ts`, `src/foodnotify/laden.ts` |
| 1.3 | Die 275 aufgegebenen `fn:bestellpositionen`: erst messen, **woran** sie gescheitert sind (`sync.aufgabe`: Status, Fehlertext, Verteilung), dann entweder gezielt neu einreihen oder als Quellengrenze dokumentieren. | `src/sync/worker.ts`, Nachholauf |

**Danach nachprüfbar:** `core.buchungsbeleg` bekommt wieder täglich Zulauf; keine
Inventur endet mehr bei exakt 800; `mart.fremdeinkauf` zeigt für den August
wieder einen Belegarchiv-Anteil in der Größenordnung der Vormonate.

**Backfills:** die seit dem 12.08. fehlenden Belege (rund 300/Tag × Rückstand),
die 9 abgeschnittenen Inventuren (936 Positionen), die 322 Bestellungen ohne
Positionen. Alle drei laufen neben dem nächtlichen Lauf, keiner blockiert ihn.

### Phase 2 — Rückwirkung und Takt

| # | Was | Berührt |
|---|---|---|
| 2.1 | `getKennzahlen` auf ein rollierendes Rückschaufenster statt „nur das laufende Jahr". Die gemessenen Rückbuchungen reichen sieben Monate zurück. | `src/sync/nachfuellen.ts:75` |
| 2.2 | Einmaliger Nachholauf für die verlorenen Vorjahres-Nachbuchungen — braucht einen Weg an `sync.historie_einreihen` vorbei, das erledigte Zeiträume überspringt. | `migrations/0021…`, Nachholauf |
| 2.3 | Nachzügler-Fenster je Endpunkt statt global: Personalkosten brauchen mehr als 10 Tage, Umsatz und Artikel kommen mit 5 aus. | `src/config.ts:339`, `src/lina/endpunkte.ts` |
| 2.4 | FoodNotify-Stammdaten täglich statt monatlich, und die Zuordnung Kostenstelle → Betrieb bei **jedem** Lauf nachziehen. Die beiden vorhandenen SQL-Funktionen endlich benutzen. | `src/sync/nachfuellen.ts:160-165` |
| 2.5 | Wächter gegen die `monat`-Falle: ein aktivierter Endpunkt ohne passenden Zweig darf nicht still null Posten einreihen. | `src/sync/nachfuellen.ts` |

**Danach nachprüfbar:** die 25 Kostenstellen ohne `betrieb_key` sind zugeordnet
oder benannt; eine Rückbuchung in einem Vormonat erscheint im nächsten Lauf.

### Phase 3 — die Anzeige ehrlich machen

> **Erledigt am 14.08.2026, Migration `0075`.** Alle fünf Punkte, 3.5 ausdrücklich
> **ohne** Handgriff: `sync.warteschlange.gesperrt_seit` beendet den 403-Zweig
> von selbst, Posten 28629 läuft am 16.08.2026 aus. Eine Messung korrigiert
> dabei 3.1: nicht 60 Zeilen standen auf „… lädt", sondern alle 251
> (`fehlerkatalog.md`, `befunde-datenlage.md`).

| # | Was | Berührt |
|---|---|---|
| 3.1 | `mart.einkauf_ladestand` in **einer** Migration um beides erweitern: gesperrte Posten getrennt von offenen zählen, und „Bestellung mit Kopf, ohne Position" als eigene Spalte. Beide Änderungen fassen dieselbe Sicht an. | neue Migration |
| 3.2 | Die Karte auf drei Zustände: `… lädt` / `⚠ kein Zugriff` / `✓`. | `metabase/karten-fach.ts:881` |
| 3.3 | Obergrenze für dauerhaft gesperrte Posten im 403-Zweig — ohne `greatest(0, versuche - 1)` einfach zu streichen, davor warnt der Kommentar zu Recht. | `src/sync/worker.ts:654-671` |
| 3.4 | `sync.fortschritt`: füllen oder ersatzlos aus `src/health.ts:39` entfernen. Eine Prüfung, die strukturell immer „alles gut" sagt, ist schlimmer als keine. | `src/health.ts` |
| 3.5 | Posten 28629 in Produktion quittieren (Testbetrieb, gehört uns nicht). | Handgriff |

**Danach nachprüfbar:** kein „… lädt" mehr ohne echten Ladevorgang, und die
46 Bestellungen ohne Positionen stehen sichtbar da, statt hinter einem Häkchen.

### Phase 4 — der Wächter

> **Erledigt am 14.08.2026, Migration `0076`.** `sync.quelle` als Register der
> Zulauferwartungen (in `src/sync/quellen.ts`, nicht als Seed), `mart.quelle_zulauf`
> als Messung, eine Karte an zweiter Stelle auf dem Import-Dashboard, zwei
> Prüfzeilen und ein Lauf, der `teilweise` meldet statt `ok`. Gemessen wird
> **zweierlei** — `zuletzt_gefragt` und `zuletzt_zulauf` —, weil die beiden
> Ausfälle dieses Projekts verschiedene waren.
>
> Zwei Funde beim Anlegen: `fn:profil` war ein Einmalposten (läuft jetzt täglich
> mit), und drei `core`-Tabellen haben null Zeilen und keinen Schreiber
> (`offene-punkte.md`).

Der eigentliche Konstruktionsfehler hinter allen Befunden: **Stillstand sieht
aus wie Erfolg.** Das Belegarchiv lieferte zwei Tage nichts, und der Lauf meldete
269 von 269 ok. Derselbe Fehler kostete am 02.08.2026 schon einmal acht Tage.

Gebraucht wird eine Sicht „Zulauf je Quelle und Tag" mit einer erwarteten Kadenz
je Quelle und einer Ampel — sichtbar auf dem Import-Dashboard, nicht nur im Log.
Ein Log-WARN reicht nicht: niemand liest Logs.

Klein halten. Ein Wächter, der drei Wochen Arbeit ist, entsteht nie.

Dazu die Regel in `AGENTS.md`: **eine Quelle ohne Zulauf ist ein Fehler, kein
Normalzustand — der Lauf darf sie nicht als „ok" melden.**

### Phase 5 — Reichweite

> **5.1 und 5.4 erledigt am 14.08.2026, Migration `0077`.** Der Spartenfilter
> ist ein Parameter, wie vermutet — acht Registereinträge und acht
> `case`-Zeilen, +80 Aufrufe am Tag von 10.500. Die Zukunftsbelege sind an der
> **Quelle** behandelt (`beleg_datum` wird NULL, Rohwert in `beleg_datum_roh`),
> nicht in den Sichten: alle vier filtern ohnehin auf `IS NOT NULL`, es musste
> keine geändert werden. `mart.inventur_schwund` kennt jetzt das
> `unplausibel`-Kennzeichen.
>
> **5.2 und 5.3 erledigt am 14.08.2026, Migration `0078`.** Vollabgleich und
> Zuordnung laufen monatlich im Nachtlauf statt auf Zuruf; `yextNachlauf()`
> steht vor dem Round-Table-Refresh. `eintraege_live` war kein fehlendes Feld,
> sondern ein Tippfehler: angefordert wurde `POWERLISTINGS_LIVE`, gelesen
> `LISTINGS_LIVE`. Die sieben Betriebe ohne Zuordnung stehen in
> `mart.betrieb_ohne_yext` — sie werden **nicht** geraten.

| # | Was |
|---|---|
| 5.1 | Hauptsparten: acht statt zwei. Zuerst klären, ob der Spartenfilter ein Parameter ist, den wir einfach mit weiteren `posId` aufrufen können — dann ist die Reparatur klein. Kostet Aufrufe: das LINA-Tagesbudget ist 10.500, verbraucht werden 82. |
| 5.2 | Yext: Fenster von 3 auf 25 Monate im täglichen Lauf oder ein regelmäßiger Vollabgleich; die 7 operativen Betriebe ohne Zuordnung nachtragen; `eintraege_live` erst prüfen, ob Yext das Feld überhaupt liefert — wenn nicht, gehört die Spalte aus der Karte, nicht gefüllt. |
| 5.3 | `yextNachlauf()` **vor** den Round-Table-Refresh ziehen. Heute tragen zwei Betriebe eine Note aus dem Vortag in der Ampel. |
| 5.4 | Datenqualität: Zukunftsbelege bis 2038 an der richtigen Stelle filtern (Quelle oder Sicht — das ist zu entscheiden), `mart.inventur_schwund` das `unplausibel`-Kennzeichen beibringen. |

### Phase 6 — Handpflege wartbar machen

Nicht sechs Einzellösungen, sondern **ein** wiederholbarer Importweg
(Excel/CSV → Tabelle), der für `om_einschaetzung`, `gfgh_betrieb`, `bwa_zeile`
und `sachkonto` zusammen taugt — statt wie heute einmal in einer Migration
verdrahtet. Dazu automatisch nachziehbar: Feiertage, Schulferien, Marktindex.

---

## 4. Was Eugene entscheiden muss

1. **Darf eine Ampel grün sein, wenn ein Signal fehlt?**
   Heute ja — drei operative Betriebe stehen im August auf Grün, obwohl die
   OM-Note für alle 141 fehlt. *Empfehlung: nein. „Unvollständig" als eigener
   Zustand, sichtbar neben grün/orange/rot.*
2. **Kommen die OM-Einschätzungen für Juli und August?**
   Ohne sie bleibt `ampel_om` leer, egal was wir bauen.
3. **Sollen die 6 nie geholten Belegarten geholt werden?**
   USt-Voranmeldungen, Mahnungen, Steuerunterlagen, OPOS-Listen, sonstige
   Dokumente und Auswertungen. *Empfehlung: nur, wenn dort Wareneinkauf steckt —
   sonst kosten sie Aufrufe ohne Nutzen.*
4. **Hauptsparten — lohnt sich der Aufwand?**
   31,2 % des Umsatzes wären danach aufteilbar (Gutscheine, Pfand, Trinkgeld,
   Straßenverkauf, Lieferkosten). *Empfehlung: ja, wenn es ein Parameter ist.*

---

## 5. Was bewusst offen bleibt

* **`core.ware` bleibt dünn.** Einheit, Basiseinheit, Warengruppe und Lieferant
  sind in allen 43.120 Zeilen NULL, weil es für Waren, Warengruppen und
  Lieferanten keinen FoodNotify-Endpunkt gibt. Das ist eine Grenze der Quelle,
  keine Nachlässigkeit.
* **Die BWA-Sichten ohne Kartenreferenz** (`bwa_plan_ist`, `mart.tagesbudget`,
  `bwa_quellen_vergleich`) werden nicht repariert, solange sie niemand ansieht.
  Sie stehen hier, damit der nächste, der sie öffnet, weiß, was er sieht.
* **32.066 mehrfach vergebene `encrypted_id`** im Belegarchiv: erst verstehen,
  dann handeln. Eine Bereinigung ohne Ursache wäre geraten.

---

*Teil 3 dieses Plans — die zeilengenauen Entwürfe je Baustelle, jeder von einem
zweiten Durchgang gegengelesen — folgt als eigener Commit.*
