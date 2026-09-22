# Plan: Kassendaten aus LINA — Finanzwege, Rabatte, Bonebene

**Stand:** 22.09.2026. **Status:** Phase 0 und 1 erledigt (Abschnitt 0), Phase 2 ff. nicht
gebaut. Abschnitte 1 bis 3 sind der Stand **vor** der Erkundung und bleiben als Begründung
stehen; wo sie Abschnitt 0 widersprechen, gilt Abschnitt 0.

**Anlass.** Die Glücksrad-Auswertung für Wilma Wunder (August 2026, siehe
[`gluecksrad-august-2026.html`](gluecksrad-august-2026.html)) zählte alle Verkäufe der 51
Artikel. Gefragt war die Menge, die über die Finanzwege **3500 (10 %), 3501 (25 %) und
3502 (50 %) Glücksrad** abgeschlossen wurde, je Prozentsatz und Standort. Das geht mit
unserem Bestand nicht: `core.artikelverkauf_tag` kommt aus
`getArtikelverkaufsbericht` und ist schon je Betrieb, Tag und Artikel verdichtet. Welcher
Bon mit welchem Finanzweg schloss, ist dabei verloren.

Der Screenshot aus dem Fachbereich (Artikelverkaufsbericht, Durchstarter, 5.183 Stück)
ist derselbe Konzernbericht, den wir laden. Er zeigt also keinen Finanzweg-Filter, den wir
übersehen hätten.

**Ziel (Eugene, 22.09.2026):** möglichst viele Daten im eigenen System, damit solche
Auswertungen künftig ohne Export aus LINA gehen. Das schließt die **Historie** ein.

---

## 0. Stand nach Phase 0 (22.09.2026, im Browser erhoben)

Details in [`lina-api-inventar-1d.md`](lina-api-inventar-1d.md), die Endpunktkorrektur in
[`lina-api-korrekturen.md`](lina-api-korrekturen.md), KORREKTUR 7.

1. **Der Betriebsbericht-Endpunkt war falsch dokumentiert.** Richtig ist
   `GET /intranet/storeanalytics/getReport?report=<id>&von=…&bis=…&reltime=custom&interval=8&laden=<encId>`.
   Der bisherige Pfad `/finanzen/analytics/getReport?storeId=` antwortet mit 200 und leeren
   Gerüsten, für jeden Betrieb. Die inaktiven `getReport:*`-Einträge in
   `src/lina/endpunkte.ts` tragen noch den falschen Pfad.
2. **Die Glücksrad-Frage ist beantwortet, über den Rabattbericht (92).** Er gliedert jeden
   Finanzweg der Finanzgruppe *Hausbon* nach Artikel. Die Gruppensummen treffen den
   Finanzwege-Bericht (88) auf den Cent. Für August 2026 sind alle 14 Wilma-Wunder-Betriebe
   geholt. Das Ergebnis steht in `gluecksrad-august-2026-finanzwege.xlsx`. **Phase 1 ist damit
   erledigt.**
3. **Die Rabatt-Hypothese stimmte halb.** Nachlässe laufen tatsächlich als Finanzweg. Der
   Rabattbericht war aber nie leer, der Endpunkt war falsch. Es gibt **zwei** Finanzwege
   „25 % Glücksrad“ (3501 und 3168). Zuordnen muss man über den Namen, nicht über eine feste
   Nummernliste.
4. **Das Kassenjournal ist JSON** (`/finanzen/api/getJournalData?businessdate=TT.MM.JJJJ`,
   ~870 kB je Tag). Es gilt aber nur für den Betrieb, der in der Sitzung gewählt ist; `laden=`
   wirkt dort nicht. **`posBills` ist die Debitorenliste**, nicht die Bonebene.
5. **Die Berichte kennen nur das Raster „kumuliert“** (`possibleIntervals` = 8). Wer Tageswerte
   will, fragt je Tag mit `von = bis`.
6. **Tiefe:** Januar 2018 war bei Düsseldorf leer, 2020 und 2022 hatten Daten. Gemessen ist
   das nur an einem Betrieb.

7. **Bonebene mit Artikeln ist je Betrieb nicht erreichbar** (Nachtrag in `lina-api-inventar-1d.md`).
   Kassenjournal und Rechnungsdetail hängen am Betrieb der Sitzung, und der lässt sich nicht
   umstellen: im Kopf steht nur der Mandant. Je Betrieb erreichbar ist **96
   Rechnungsausgangsbuch**: eine Zeile je Bon mit Zahlarten und Betrag, aber ohne Artikel und
   ohne Nachlass-Finanzwege.

Damit verschiebt sich der Plan. **K5 (Rabattbericht 92) und K3 (Finanzwege 88) sind jetzt der
Hauptweg** und kosten einen Aufruf je Betrieb und Zeitraum. Die Bonebene (K1) wird zur Frage,
ob sich das Kassenjournal auf andere Betriebe umstellen lässt (Abschnitt 4).

---

## 1. Was heute fehlt

| Frage | heute möglich? | woran es fehlt |
|---|---|---|
| Menge je Artikel und Finanzweg | nein | Bonebene: Artikel und Zahlung am selben Bon |
| Umsatz je Finanzweg, je Betrieb und Tag | nein | kein Finanzweg-Bericht geladen |
| Rabatte, Personalverzehr, Hausbons | nein | 92 und 114 nie geladen |
| Bons mit Aktion, Ø Bon mit/ohne Aktion (Round-Table-Map 5.1) | nein | Bonebene |
| Zusatzverkauf je Kellner (Map 4.2) | nein | Kellnerberichte nie geladen |
| Wartezeiten, Bon-Uhrzeit (Map 7.2 / 11.1) | nur Stundenraster | Bonebene |
| Gutscheinverkauf und Einlösung | nur als Hauptsparte | Gutscheinberichte nie geladen |

**Keiner der 72 Betriebsberichte wird heute geladen.** Alles, was im Importer läuft, sind
Konzernberichte (`/intranet/analytics/*`), die Stammdaten und die Ladenakte.

### Eine Hypothese, die Phase 0 als Erstes prüft

Der Rabattbericht (92) kam am 25.07.2026 beim umsatzstärksten Betrieb **leer** zurück
(`nBillsGesamt: 0`, [`lina-api-korrekturen.md`](lina-api-korrekturen.md), Abschnitt
„Stornotyp"). Wir hielten ihn damals für eine leere Datenquelle. Das Glücksrad zeigt eine
andere Erklärung: **Concept Family bucht Nachlässe als Finanzweg, nicht als Rabatt.** Dann
ist 92 zu Recht leer, und die Nachlässe stehen im Bericht „Finanzwege". Wenn das stimmt,
ist die Frage nach „Rabatten" in dieser Gruppe eine Frage nach Finanzwegen.

---

## 2. Die Kandidaten

Sortiert nach Wert für die Frage, nicht nach Aufwand. Die Aufrufkosten gehen von
gemessenen Größen aus (lokale Datenbank, 22.09.2026, `core.umsatzbericht_tag`, nur Tage
mit Umsatz): **152.840 Betrieb-Tage** seit 2018, **5.115 Betrieb-Monate**, **30,3 Mio.
Bons**.

| # | Quelle | was wir wissen | was es beantwortet | Kosten Historie |
|---|---|---|---|---|
| K1 | **Kassenjournal** `/finanzen/report/kassenjournal` | nie aufgerufen (`d1` gebaut, nie gelaufen). Format unbekannt, „vermutlich HTML" | alles oben: Bon, Uhrzeit, Kellner, Artikel, Finanzweg | unbekannt. Bei einem Aufruf je Betrieb-Tag rund 153.000, mit Seiten mehr |
| K2 | **`/finanzen/document/posBills`** (Rechnungen) | nur der Menüname | vermutlich Bonebene wie K1 | unbekannt |
| K3 | **Finanzwege** (Betriebsbericht, zweimal im Katalog: buchhalterisch und je Kellner) | ID und Spalten unbekannt | Umsatz je Finanzweg, ohne Artikel | 5.115 je Monat, 152.840 je Tag |
| K4 | **Finanzwege, gefiltert auf Artikel** | Betriebsberichte haben einen Artikelfilter ([`lina-api-inventar-1b.md`](lina-api-inventar-1b.md), Z. 18). Ob er auf Finanzwege wirkt, ist unbekannt | Glücksrad-Frage für eine **feste** Artikelliste, ohne Bonebene | ein Aufruf je Betrieb, Zeitraum und Artikel. Nur als Einzelauswertung tragbar |
| K5 | **Rabattbericht 92** | 200, Spalten `Rabatt, Artikel, Brutto, Netto, Anzahl`, einmal leer | Rabatt je Artikel, falls überhaupt gebucht | 5.115 |
| K6 | **Tagesabschluss 97** | 200, 55 kB JSON, **Spalten nie dokumentiert** | vermutlich Zahlarten und Z-Bon je Tag | 5.115 bis 152.840 |
| K7 | Unbare Zahlungen, Erweiterter Tagesabschluss, Monatsaufstellung, Rechnungsausgangsbuch | nur Namen | Zahlarten, Karte gegen bar | je nach Raster |
| K8 | **114 Kost-Sach-Bezug** | 200 JSON, Spalten nicht dokumentiert | Personalverzehr, erklärt einen Teil der Wareneinsatzlücke | 5.115 |
| K9 | Kellnerberichte (60/61 Zusatzverkauf, 58, 59, Umsatz je Kellner) | nur IDs aus dem Mapping | Map 4.2 | 5.115 je Bericht |
| K10 | Gutscheine (Umsatz, Transaktionen, im Umlauf), Menüzweig „Voucher" | nur Namen | Gutscheinverkauf und Einlösung | klein |
| K11 | Reservierungen (Betriebsbericht, `reservation-summary`, `d3`) | einmal leer im Zentralkontext | Map 1.3, OpenTable-Umfang | klein |

Ausdrücklich **nicht** Teil dieses Plans, weil entschieden: Storno 38/39/58
(`entscheidungen.md`, „Storno wird nicht gebaut"), WAWI (Regel 5), die gesperrten Berichte
7/8/9/23/24/107/118, Rezepturen-HTML und ein eigener API-Schlüssel bei LINA.

**Wenn K1 oder K2 Bonebene mit Finanzweg liefert, werden K3 bis K7 überflüssig:** sie sind
dann Verdichtungen dessen, was wir selbst rechnen können. Sie bleiben als **Gegenprobe**
wertvoll, wie heute der Umsatzbericht gegen den Artikelverkauf
(`mart.pruefung_uebersicht`).

---

## 3. Phasen

### Phase 0 — Erkundung (lesend, ein Wilma-Wunder-Betrieb, August 2026)

Ein Betrieb **ganz**, bevor der nächste drankommt: Wilma Wunder Düsseldorf (4.705 Bons
bis 12.08.). Kein Speichern, kein Absenden, keine Favoriten (Regel 1). Diese Phase
entscheidet, welche der Phasen 2 bis 4 überhaupt gebaut werden.

1. **Katalog der Betriebsberichte vollständig abschreiben:** alle 72 mit ID, Route und
   Spalten. Heute kennen wir 18 IDs, und die Gruppengrößen im Inventar ergeben 69 statt
   72.
2. **Finanzwege (K3)** für August 2026 abrufen und prüfen, ob 3500/3501/3502 als Zeilen
   vorkommen. Ist die Hypothese aus Abschnitt 1 richtig, stehen die Glücksrad-Nachlässe
   hier.
3. **K4:** derselbe Bericht mit Artikelfilter auf Durchstarter. Kommt eine Menge heraus,
   die kleiner als 5.183 ist und sich je Finanzweg aufteilt, lässt sich die Glücksrad-Frage
   **sofort** beantworten, noch vor jedem Importerumbau.
4. **Kassenjournal (K1) und posBills (K2):** Format (JSON oder HTML), Seitenlogik, eine
   Bon-ID, ein Zeitstempel, Artikel am Bon, Finanzweg am Bon, geteilte Zahlungen.
   **Größe eines Betrieb-Tags in Bytes.** Braucht es `storeId`?
5. **97, 92, 114, Unbare Zahlungen:** je einmal, Spalten notieren.
6. **Historische Tiefe:** jeder Bericht, der in 2. bis 5. Daten liefert, noch einmal für
   **Januar 2018** und für den ersten Monat des Betriebs. Die Konzernberichte reichen bis
   31.12.2017. Für Betriebsberichte ist das ungemessen, und LINA hat schon einmal
   Rohdaten nur begrenzt aufbewahrt (die Tage 21. und 22.07.2026 fehlen dort ganz).
7. **Tagesraster:** nimmt `getReport` ein `interval`, das Tageszeilen liefert? Bisher
   gesehen ist nur 8 (kumuliert). Das entscheidet, ob eine Historie 5.115 oder 152.840
   Aufrufe kostet.

**Ergebnis:** `docs/lina-api-inventar-1d.md` mit je einem anonymisierten Payload unter
`docs/payloads/`. Dazu eine Zeile in `lina-api-korrekturen.md`, falls die
Rabatt-Hypothese stimmt.

### Phase 1 — Glücksrad August 2026 beantworten

Mit dem besten Weg aus Phase 0, **bevor** der Importer umgebaut ist:

- Liefert K4 das Ergebnis: 14 Betriebe × 51 Artikel = 714 Aufrufe, einmalig und über einen
  Messlauf. Das ist zu viel für einen einzelnen Aufruf aus dem Terminal. Besser: den
  Artikelfilter mit allen 51 Nummern auf einmal, falls er mehrere annimmt. Dann sind es 14.
- Liefert nur K1/K2 das Ergebnis: 14 Betriebe × 31 Tage = 434 Aufrufe, einmalig, über
  die normale Warteschlange.
- Liefert nichts davon Artikel je Finanzweg: Lauras Export ist der Weg. Wir sagen das dann
  als gemessene Grenze, nicht als Vermutung.

Lauras Export bleibt in jedem Fall **Gegenprobe**, denn er ist die Zahl, die der
Fachbereich kennt.

### Phase 2 — Der Importer lernt Betriebsberichte

Das ist Voraussetzung für alles Weitere. Heute ist es bewusst gesperrt: der Wächter in
`src/sync/waechter.ts` bricht ab, sobald ein Betriebsendpunkt aktiv wird. Drei Stücke
fehlen (`plan-datenvollstaendigkeit-nachtrag.md`, 199–212):

1. **Ein Erzeuger für `sync.warteschlange.betrieb_enc_id`.** Der Worker setzt `storeId`
   daraus (`src/sync/worker.ts`, 997 f.), aber kein `INSERT` im Repository füllt die
   Spalte. Vorlage ist `einreihenJeMonat` der Ladenakte (`nachfuellen.ts`, 856 ff.).
2. **Einreihen je Betrieb und Periode**, für Nachzügler und Historie. **Nur Betrieb-Tage
   mit Umsatz** laut `core.umsatzbericht_tag`, und zwar mit einem Rand von einem Tag.
   Das spart rund 60 % gegenüber 141 × Kalendertage und vermeidet die 500er von
   Betrieben ohne Daten. Aber: **ein Tag, den der Umsatzbericht nicht kennt, wird damit
   auch nie gefragt.** Deshalb muss er als eigene Zeile in der Prüfübersicht stehen
   (Regel 10), nicht still wegfallen.
3. **Ein `laden.ts`-Fall je Bericht** mit eigenem Transform. Die Hülle ist gleich
   (`BetriebsReportSchema`), die Spalten sind es nicht: `tableHead[].field` ist je Bericht
   anders. Das zod-Schema prüft deshalb **je Bericht die erwarteten Felder**, damit eine
   Spaltenänderung in `sync.schema_abweichung` landet und nicht als NULL durchrutscht.
   `errors` wird mitgespeichert, weil LINA dort fachliche Hinweise liefert.
4. **Gegenprobe gegen den Umsatzbericht, bevor ein Bericht als geladen gilt**
   (`fehlerkatalog.md`, 22.09.2026). `balanceSumNetto` jeder Antwort muss den Nettoumsatz
   aus `core.umsatzbericht_tag` für denselben Betrieb und Zeitraum treffen.
   `nBillsGesamt: 0` bei einem Betrieb mit Umsatz ist ein Fehler, kein „keine Daten“. Pfad
   und Parameter: `/intranet/storeanalytics/getReport`, `laden=` (Abschnitt 0).

Dazu je Bericht ein Eintrag in `sync.quelle` mit `erwartet: true`, damit ein Bericht ohne
Zulauf den Lauf auf `teilweise` setzt.

### Phase 3 — Bonebene laufend (nur falls K1 oder K2 trägt)

Schema, vorläufig, bis die Spalten gemessen sind:

| Tabelle | Körnung | Inhalt |
|---|---|---|
| `core.finanzweg` | Stamm | Nummer, Name, Art (bar, Karte, Gutschein, **Nachlass**), Prozentsatz, falls einer im Namen steht |
| `core.bon` | Bon | Betrieb, Geschäftstag, Zeitstempel, Kellner, Tisch, Gäste, Summen |
| `core.bon_position` | Position | Artikel, Menge, Brutto, Netto |
| `core.bon_zahlung` | Zahlung | Finanzweg, Betrag. **Mehrere je Bon** — geteilte Zahlung |

Alles nach Geschäftstag partitioniert wie `core.artikelverkauf_tag`, der Raw-Layer
append-only wie immer.

**Eine fachliche Festlegung, bevor die erste Zahl rausgeht:** Wird ein Bon teils mit 3502
(50 %) und teils bar bezahlt, welche Artikel „liefen über das Glücksrad"? Drei Lesarten:
alle Artikel des Bons, anteilig nach Betrag, oder nur Bons mit genau einem Finanzweg. Die
Sicht rechnet alle drei, und die Beschreibung sagt, welche die Karte zeigt.

Gegenprobe jede Nacht: die Summe von `core.bon_position` je Betrieb und Tag gegen
`core.artikelverkauf_tag`, als Zeile in `mart.pruefung_uebersicht`.

### Phase 4 — Historie

**Neueste Tage zuerst, dann absteigend, die ältesten zuletzt.** Das gilt für die
Bonebene und für jeden Betriebsbericht aus Phase 5, über alle Betriebe hinweg nach Datum
und nicht Betrieb für Betrieb. Die Reihenfolge ist entschieden (Abschnitt 4) und hat
praktische Gründe: bricht der Zugang ab, fehlt das Unwichtigste, und jede Nacht macht die
Auswertungen der letzten Monate zuerst vollständig. `historieNachziehen()` arbeitet schon
so. Ein neuer Einreihweg muss das übernehmen und darf nicht nach Betrieb-ID oder
Einfügereihenfolge sortieren. Ein Test prüft die Reihenfolge. Das Tempo kommt über eine **eigene
Obergrenze je Nacht** und nicht über `HISTORIE_JE_LAUF`. Sonst verdrängt die Bonebene
die übrigen Nachholarbeiten, oder umgekehrt. Auf 0 gesetzt hört es auf. Einen Handbefehl
gibt es nicht ([Betrieb ohne Handbefehl](../AGENTS.md)).

Rechnung auf die gemessenen 152.840 Betrieb-Tage, bei einem Aufruf je Betrieb-Tag:

| Obergrenze je Nacht | Dauer bis 2018 | Dauer bis 2024 (rund 54.000 Betrieb-Tage) |
|---|---|---|
| 1.000 | etwa 5 Monate | etwa 8 Wochen |
| 2.000 | etwa 11 Wochen | etwa 4 Wochen |
| 4.000 | etwa 5 Wochen | etwa 2 Wochen |

Das Tagesbudget steht in `.env` auf 10.500. Davon brauchen die Tagesberichte rund 184, die
Ladenakte rund 2.200 und die bestehende Historie bis zu 2.000. **Mehr als 4.000 wären
eine Temposteigerung gegen LINA** und brauchen eine Begründung (Regel 3). Braucht ein
Betrieb-Tag mehrere Seiten, verlängert sich jede Zeile entsprechend. Das misst Phase 0.

**Solange LINA erreichbar ist, ist die Historie der knappe Teil, nicht der laufende
Betrieb** ([`datensicherung.md`](datensicherung.md)). Die Reihenfolge ist deshalb: Phase 2,
dann laufend und Historie zusammen, nicht erst das eine fertig.

### Phase 5 — Die übrigen Betriebsberichte

Auf demselben Mechanismus, je Betrieb-Monat, jeweils rund 5.100 Aufrufe Historie:
K8 Kost-Sach-Bezug, K9 Kellnerberichte, K10 Gutscheine, K11 Reservierungen. Dazu K6
Tagesabschluss als Gegenprobe der Zahlarten. Jeder Bericht erst mit seiner
Phase-0-Messung, dann mit einer Zeile im Quellenregister.

Nebenbefund aus der Bestandsaufnahme, **gemessen nur am Code:**
`core.umsatzbericht_tag.verkaufsstelle_key` wird nie gefüllt. Kein Registereintrag fragt
`getUmsatzbericht` mit `verkaufsstellen` ab, obwohl `kennzahlen-mapping.md` „Umsatz pro
Verkaufsstelle" als erledigt führt. Das ist eine eigene kleine Arbeit (7 Verkaufsstellen ×
1 Aufruf je Tag, Konzernebene).

### Phase 6 — Auswertung

- `mart.finanzweg_tag`: Umsatz und Bons je Betrieb, Tag und Finanzweg.
- `mart.artikel_finanzweg_monat`: Menge je Artikel, Finanzweg und Betrieb. Das ist die
  Glücksrad-Tabelle.
- Das Dashboard „Artikelaktion — je Betrieb" (`metabase/karten-artikelaktion.ts`)
  bekommt einen Filter nach Finanzweg. Dann ist die nächste Aktion dieser Art eine
  Eingabe im Filter und keine Anfrage.
- Map 5.1 (Bons mit Aktion) wird als eigene Karte gebaut, wenn die Bonebene steht.

---

## 4. Entschieden (Eugene, 22.09.2026)

1. **Phase 0 läuft im Browser.** Eugene meldet sich an, der Agent liest im Report Center
   nur mit und schreibt die Aufrufe ab. Messskripte folgen erst, wenn Pfade und Parameter
   bekannt sind. Grund: IDs und Parameter der Betriebsberichte sind unbekannt, und ein
   Skript kann sie nicht raten.
2. **Die Bonebene geht bis 2018 zurück**, soweit LINA sie hat. Die Tiefe misst Phase 0,
   Schritt 6. **Reihenfolge: die neuesten Tage zuerst, dann absteigend, die ältesten
   zuletzt**, für alle Betriebe gemeinsam nach Datum.
3. **Obergrenze 4.000 Aufrufe je Nacht für die Bonebene**, zusätzlich zu den 2.000 der
   bestehenden Historie. Damit sind rund 8.400 der 10.500 Aufrufe belegt, bis 2018 dauert
   es etwa 5 Wochen. Das ist mehr Volumen, aber **kein höheres Tempo**: `TAKT_MIN_MS` und
   `TAKT_MAX_MS` bleiben, wie sie sind (Regel 3). Braucht ein Betrieb-Tag mehrere Seiten,
   dauert es entsprechend länger. Die Grenze wird nicht angehoben, um das auszugleichen.
4. ~~**Sitzungsbetrieb umstellen ist erlaubt** und gilt nicht als der am 13.08.2026 ausgeschlossene
   Mandantenwechsel. Damit ist das Kassenjournal für jeden Betrieb erreichbar. Wie genau
   umgestellt wird und was es in der Sitzung verändert, misst die nächste Erkundung. Für den
   Importer heißt das: eine Umstellung je Betrieb, in derselben Drosselung wie jeder andere
   Aufruf.~~ Hinfällig: Einen Sitzungsbetrieb gibt es im Kopf nicht, dort steht nur der
   Mandant (Eugene, 22.09.2026, nachgemessen in `lina-api-inventar-1d.md`).
5. **Rabattbericht (92) und Finanzwege (88) werden je Tag geholt** (`von = bis`), rückwärts bis
   2018, die neuesten zuerst. Grund: Aktionen halten sich nicht an Monatsgrenzen. Kosten:
   rund 153.000 Aufrufe je Bericht.
