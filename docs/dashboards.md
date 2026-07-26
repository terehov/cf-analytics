# Dashboards

Was in Metabase steht, wie es dorthin kommt und warum es so aussieht, wie es aussieht.

Die **Einrichtung** von Metabase (Schemata, Berechtigungen, welche `mart`-Sicht welche Frage
beantwortet) steht in [`metabase.md`](metabase.md). Hier geht es um die Dashboards selbst.

---

## Der Grundsatz: Dashboards sind Code

Sie werden **nicht in der Oberfläche gepflegt**, sondern aus `metabase/` erzeugt. Der Grund
ist derselbe wie beim Schema: eine in der Oberfläche zusammengeklickte Auswertung hat keine
Historie, keine Begründung und keinen zweiten Ort, an dem sie überlebt. Wer eine Karte in
Metabase inhaltlich ändert, verliert die Änderung beim nächsten Lauf.

```text
metabase/
  typen.ts              Was eine Karte, eine Reihe, ein Klickziel ist
  gemeinsam.ts          Monats- und Zeitraum-Ausdrücke, die sich alle Karten teilen
  layout.ts             Rechnet aus Reihen die Kachelpositionen
  karten-drilldown.ts   Ebenen ① bis ⑤
  karten-portfolio.ts   Ebenen ⑥ und ⑦
  karten-round-table.ts Die Excel-Ablösung
  karten-fach.ts        Umsatz, Struktur, Personal, Ware, BWA, Datenqualität
  dashboards.ts         Welche Karte auf welchem Dashboard, in welcher Reihe
  uebernehmen.ts        Trägt alles nach Metabase ein
  sichtbarkeit.ts       Setzt, welche Tabellen Metabase zeigt (siehe metabase-sichtbarkeit.md)
```

Stand 26.07.2026: **98 Karten, 17 Dashboards, drei Sammlungen.**

### Übernehmen

```bash
bun run metabase/uebernehmen.ts     # startet einen Server auf :8899
# dann http://localhost:8899/ im Browser öffnen und „Übernehmen" klicken
```

Ein zweiter Lauf legt **nichts doppelt an**. Jede Karte und jedes Dashboard trägt seinen
Schlüssel als `[key:...]` am Ende der Beschreibung; danach wird zuerst gesucht. Wer eine
Karte in der Oberfläche *umbenennt*, verliert sie deshalb nicht.

### Warum der Umweg über Port 8899

Metabase schickt

```text
Content-Security-Policy: … connect-src 'self' …
```

Ein Skript, das im Metabase-Tab läuft, darf damit nichts von außen holen — die
Kartendefinitionen kommen also nicht zu ihm. Umgekehrt geht es: der Server unter `:8899`
liefert eine Seite aus, die die Arbeit macht, und reicht `/api/*` an Metabase weiter. Für
die Seite ist das gleichursprünglich, also weder CSP noch CORS im Weg.

Die Anmeldung kommt vom Browser selbst: **Cookies gelten je Host und ignorieren den Port**,
das Sitzungs-Cookie für `localhost` geht deshalb auch an `:8899` und wird von dort
unverändert weitergereicht. Es wird nirgends gespeichert, und es entsteht kein zusätzlicher
API-Schlüssel, den jemand später wieder aufräumen müsste.

---

## Die drei Sammlungen

### Drill-Down — hier fängt man an

Eine Kette, in der jeder Klick eine Ebene tiefer führt **und den Filter mitnimmt**. Der
Rückweg ist immer, den Filter oben zu löschen.

| Ebene | Dashboard | Was man sieht | Klick führt zu |
|---|---|---|---|
| ① | Marken | Eine Zeile je Marke, alle Metriken, Ampeln gezählt | ② mit gesetzter Marke |
| ② | Filialen | Alle Betriebe der Marke über sämtliche Metriken | ③ mit gesetztem Betrieb |
| ③ | Betrieb | Das Betriebsblatt: Kennzahlen, Verlauf, Struktur, Personal, Ware, BWA, Maßnahmen, Datenstand | das jeweilige Fach-Dashboard |
| ④ | Zeiträume vergleichen | Zwei frei wählbare Zeiträume nebeneinander | ③ |
| ⑤ | Standorte vergleichen | Mehrere Betriebe über alle Metriken, Verlauf, Tagesprofil, Spartenmix | ③ |
| ⑥ | Portfolio und Potenzial | Konzentration, Streuung, was der Abstand zum Median kostet | — |
| ⑦ | Muster im Geschäft | Wochenrhythmus, Stabilität, Gäste gegen Bon | — |

### Round Table — die Excel-Ablösung

`JULI_Round_Table_Ampelsystem.xlsx`, Blatt für Blatt:

| Excel-Blatt | Dashboard |
|---|---|
| `00_Dashboard`, `Eingabe` | Round Table — Übersicht |
| `Trend_2Monate`, `Ampelhistorie` | Round Table — Trend und Ampelhistorie |
| `Ursachenanalyse`, `Massnahmen` | Round Table — Ursachen und Maßnahmen |
| `Regeln` (die offene Schwellenfrage) | Round Table — Regelwerk-Vergleich |

### Betrieb — die Fachberichte

Aus `Umsetzung Berichte (1).xlsx`, Ebene „Laden" und „Franchise": Umsatz-Entwicklung,
Umsatz-Struktur, Personal, Warenwirtschaft, BWA — und **Datenqualität und Import**, die
Seite, die man aufmacht, bevor man einer anderen glaubt.

---

## Was bewusst anders ist als im Excel

**Es gibt eine Kachel „Ohne Urteil".** Im Excel fiel ein Betrieb ohne BWA unsichtbar unter
den Tisch und sah aus wie ein Betrieb ohne Befund. Am 26.07.2026 waren das 72 von 141 — mehr
als die Hälfte der Zeilen war unbeurteilbar, ohne dass das Blatt es sagte.

**Das Blatt `Ampelhistorie` entfällt ersatzlos.** Dort musste man zum Monatsabschluss „Werte
kopieren und als Werte einfügen"; im Postgres ist die Historie ohne Zutun da.

**Die Vormonate in `Trend_2Monate` werden nicht mehr abgetippt.** Sie sind eine
Fensterfunktion über `mart.round_table_trend`.

**Die bekannten Excel-Fehler sind gegenstandslos** — `#REF!` in `00_Dashboard!B3`, der
Zeilenversatz in `Eingabe!K6` (die Personal-Ampel war im Juli-Report um eine Zeile
verschoben), `#NAME?` durch `_xludf.TEXTJOIN`. Details in
[`kennzahlen-mapping.md`](kennzahlen-mapping.md).

**Der Markenschnitt ist neu.** Das Excel war für 22 Betriebe *einer* Marke gebaut; bei 141
Betrieben und mehreren Marken ist „schwächelt der Betrieb oder seine ganze Marke" die erste
Frage vor jeder Maßnahme.

---

## Das Layout wird gerechnet, nicht gepflegt

In `dashboards.ts` steht nur, **was nebeneinander gehört** — eine `reihe` ist eine
waagerechte Gruppe. `layout.ts` rechnet daraus `x`, `y`, Breite und Höhe.

Das ist die Konsequenz aus einem konkreten Fehler: von Hand gepflegte `y`-Werte halten genau
bis zur ersten Höhenänderung weiter oben. Danach schiebt sich alles darunter ineinander —
und **Metabase nimmt überlappende Kacheln klaglos entgegen**. Der Fehler fällt erst im
Browser auf, und dort sieht er aus wie ein Darstellungsproblem statt wie eine falsche Zahl
in der Definition.

### Mindesthöhen

Am gerenderten Ergebnis abgelesen, nicht geraten. Eine Rastereinheit sind rund 40 Pixel;
davon geht bei jeder Karte der Titel ab, bei Diagrammen zusätzlich die Achsenbeschriftung.

| Anzeige | Einheiten | Warum |
|---|---|---|
| `scalar` | 4 | Titel + große Zahl, mehr steht da nicht |
| `bar`, `row`, `line`, `combo`, `area`, `pie` | 8 | Plot + Achsenbeschriftung + Legende |
| `scatter` | 9 | Punktwolke wird sonst ein Strich |
| `table` | 9 | Kopfzeile + ~6 Datenzeilen; darunter lohnt keine Tabelle |

Textkacheln rechnet `textHoehe()` aus der Zeichenzahl — rund 95 Zeichen je Zeile bei voller
Breite, Überschriften mit Faktor 1,5, Blockzitate mit 1,2. Bewusst großzügig: lieber eine
Einheit zu viel als ein abgeschnittener Satz.

### Die Prüfung bricht ab

`uebernehmen.ts` wirft, bevor irgendetwas angelegt wird, wenn

* zwei Kacheln sich überlappen,
* eine Kachel über die 24 Rasterspalten hinausragt,
* eine Kachel unter ihrem Mindestmaß liegt,
* ein Dashboard auf eine Karte verweist, die es nicht gibt.

Beim ersten Lauf hat die Prüfung sofort eine echte Überlappung gefunden.

---

## Visualisierungsregeln

Jede hat einen Anlass, keine ist Geschmack.

**Keine zwei Y-Achsen.** Euro und Prozent in einem Bild lassen sich beliebig gegeneinander
verschieben und erfinden damit eine Beziehung, die in den Daten nicht steht. „Umsatz je
Monat mit Vorjahr" war ursprünglich ein Kombi-Diagramm mit Euro links und Prozent rechts; es
sind jetzt zwei Karten nebeneinander.

**Balkendiagramme über Betriebe sind gekappt.** 69 oder 141 Kategorien auf einer Achse ergeben
einen Balkenwald mit übereinanderliegenden Namen. Diagramme zeigen die Top 20; die
vollständige Reihe steht als **Tabelle daneben, nicht statt ihrer**.

**Lange Namen laufen waagerecht** (`row` statt `bar`). „Alte Post Aachen
Gaststättenbetriebs GmbH" ist senkrecht nicht lesbar.

**Ab etwa sieben Klassen eine Tabelle.** Benachbarte Farbklassen verwischen, und 69 Zeilen
liest man ohnehin, statt sie zu überfliegen.

**Ampeln werden gezählt, nicht gemittelt.** Der Mittelwert zweier Ampeln ist keine Ampel.
Auf Markenebene stehen deshalb vier Zähler (🔴 🟠 🟢 ohne Urteil), nicht eine Durchschnittsfarbe.

**Prozentwerte im Markenschnitt sind Mediane.** Bei 141 Betrieben reicht ein einzelner
Ausreißer, um einen Mittelwert zu verziehen — am 26.07.2026 stand ein geschlossener Betrieb
mit 1109 % Personalquote in den Daten.

**`⚪` heißt „keine Daten", nicht „in Ordnung".** Ein Betrieb ohne BWA darf nicht aussehen wie
ein unauffälliger Betrieb.

---

## Der Monatsparameter und seine Rückfälle

Ein Pflichtparameter ohne Vorgabe lässt jede Karte beim ersten Öffnen mit *„You'll need to
pick a value"* scheitern. Ein fest eingetragener Vorgabemonat veraltet ab dem nächsten
Monatswechsel. Deshalb steht in `gemeinsam.ts` ein Ausdruck, der beides vermeidet:

```sql
WITH gewaehlt AS (
    SELECT coalesce([[ {{monat}}::date, ]]
                    (SELECT max(monat) FROM …),
                    date_trunc('month', current_date)::date) AS monat
)
```

Die eckigen Klammern sind Metabases optionaler Block: steht kein Wert an, fällt der ganze
Abschnitt weg und `coalesce` bleibt mit einem Argument stehen — gültiges SQL.

**Es gibt vier Varianten, und das ist kein Schönheitsfehler.** Sie hängen an verschiedenen
Datenreihen, die verschieden weit reichen:

| Konstante | Rückfall auf | Für |
|---|---|---|
| `MONAT_CTE` | jüngster Monat mit einem Round-Table-Urteil | Ampeln, Round Table |
| `MONAT_CTE_UMSATZ` | jüngster Monat mit Umsatz | Umsatz, Sparten, Zeitzonen |
| `MONAT_CTE_BWA` | jüngster **gebuchter** BWA-Monat | EBIT, Deckungsbeitrag |
| `MONAT_CTE_WECHSEL` | jüngster Monat mit einem Ampelwechsel | „Wer hat die Farbe gewechselt" |

Der Round Table trägt den jüngsten gebuchten BWA-Monat in spätere Berichtsmonate nach
(`bwa_monat`) und hat deshalb für Juli ein Urteil, obwohl der Steuerberater den Juli noch
nicht gebucht hat. Eine EBIT-Karte kann das nicht — sie zeigt den Monat selbst. Wer beiden
denselben Rückfall gibt, bekommt eine leere EBIT-Karte neben gefüllten, und **das liest sich
als „kein EBIT", nicht als „noch nicht gebucht"**.

---

## Drill-Down: wie die Übergabe funktioniert

Metabase kennt ein `click_behavior` je Dashcard. In `dashboards.ts` steht es als:

```ts
{ karte: 'dd_marken_tabelle',
  klick: [{ ziel: 'dd_filialen', spalte: 'Marke', uebergabe: { marke: 'Marke' } }] }
```

* `ziel` — Schlüssel des Ziel-Dashboards. Die numerische ID ist beim Anlegen noch nicht
  bekannt, deshalb legt `uebernehmen.ts` **erst alle Dashboards an** und setzt die Kacheln in
  einem zweiten Durchgang.
* `spalte` — nur diese Tabellenspalte ist klickbar. Ohne sie gilt der Klick für die ganze
  Karte (richtig bei Balken, falsch bei Tabellen: dort würde jeder Klick auf eine Zahl
  wegnavigieren).
* `uebergabe` — bildet einen **Parameter des Ziels** auf eine **Spalte der Quelle** ab. Ohne
  diese Abbildung öffnet der Klick das Zieldashboard ungefiltert, was schlimmer ist als kein
  Klick.

### Beim Umzug: `site-url`

Die Metabase-Einstellung `site-url` bestimmt, wohin Drill-Down-Klicks und Links in
Abo-Mails zeigen. Sie stand auf `http://192.168.97.2:3000` — jeder Klick lief damit ins
Leere, sobald man Metabase unter einem anderen Namen aufrief.

Aktuell `http://localhost:3000`. **Beim Umzug nach Hetzner auf die künftige Domain setzen**
(Admin → Allgemein).

---

## Die Karte

Gewünscht ist eine Deutschlandkarte auf der Markenübersicht: alle Standorte, eingefärbt nach
der Round-Table-Gesamtampel, anklickbar bis ins Betriebsblatt, und beim Filtern auf eine
Marke nur deren Häuser. Bei mehreren Marken in derselben Stadt ist die geografische
Verteilung sonst unsichtbar.

**Die Struktur steht, die Koordinaten fehlen.** Am 26.07.2026 gemessen:
`getStoreData` **führt** Adresse und Geokoordinaten (`geo_lat_ort`, `geo_long_ort`) — aber
immer nur für den Betrieb, in dem die Session steht, und das ist die Konzernzentrale.
Neun Parametervarianten durchprobiert, keine wirkt; `storeList` in `/common/api/account`
kennt zwei Betriebe und keine Geofelder. Vollständige Messung in
[`befunde-datenlage.md`](befunde-datenlage.md), Befund 8.

Der einzige verbliebene Weg wäre ein Wechsel des aktiven Betriebs in der Session — der
verändert LINA-Zustand und ist damit durch Regel 1 in `AGENTS.md` ausgeschlossen. Offen in
[`offene-punkte.md`](offene-punkte.md).

Bis das geklärt ist, bleibt `manual.betrieb_standort` leer — und **die Karte zeigt nichts,
statt etwas Falsches**.

### Was gebaut ist

`migrations/0008_standort.sql` legt an:

| Objekt | Zweck |
|---|---|
| `manual.betrieb_standort` | Adresse und Koordinaten je Betrieb, von Hand gepflegt |
| `mart.standort` | Standort + Ampel + Umsatz je Monat — die Quelle der Kartenkarte |
| `mart.standort_fehlend` | Arbeitsliste: welche Betriebe noch keine Koordinate haben |

Die Tabelle führt zwei Spalten mit, die man später nicht mehr rekonstruieren kann:
`herkunft` (`lina` / `manuell` / `geocoding` / `concept_family`) und `genauigkeit`
(`adresse` / `strasse` / `ort`). Ohne sie lässt sich nicht unterscheiden, was jemand
nachgeschlagen und was eine Automatik geraten hat.

Zwei Prüfungen fangen die häufigsten Fehler ab: Koordinaten nur paarweise, und ein
Plausibilitätsfenster für Mitteleuropa. Vertauschte Achsen sind der häufigste Fehler beim
Übernehmen aus einer Tabelle — `49.8/9.9` ist Würzburg, `9.9/49.8` liegt im Golf von Guinea.
Das ist getestet: der Einfügeversuch scheitert.

### Warum nicht aus dem Betriebsnamen abgeleitet

Es wäre verlockend: „Aposto Aalen GmbH", „Alte Post Aachen Gaststättenbetriebs GmbH" — die
Stadt steht oft im Namen. Aber:

* **Nicht immer.** „Alter Kranen GmbH", „SCHAFFERONE GmbH", „Riviera Calling AG" tragen
  keine Ortsangabe.
* **Nicht eindeutig.** Fünf Betriebe heißen nach derselben Stadt, ohne dieselbe zu sein
  (siehe `AGENTS.md`); und der Stadtmittelpunkt ist nicht der Betrieb.
* **Ein falscher Punkt wird nicht hinterfragt.** Ein Betrieb, der auf der Karte fehlt, fällt
  jemandem auf. Einer, der an der falschen Stelle steht, sieht aus wie eine Tatsache.

Deshalb: **kein Rateverfahren.** Die Karte zeigt genau die Betriebe, die in
`manual.betrieb_standort` stehen. Aktuell sind das null von 141; `mart.standort_fehlend`
sagt jederzeit, wie viele fehlen und welche davon Umsatz machen.

### Was noch fehlt, um die Karte zu bauen

1. **Koordinaten beschaffen.** Drei Wege, in dieser Reihenfolge:
   **(a)** eine Standortliste von Concept Family — sie führen sie mit Sicherheit
   (Franchiseverträge, Website, Google Business), und es ist der einzige Weg ohne
   LINA-Zustandsänderung;
   **(b)** klären, ob sich der aktive Betrieb *lesend* umschalten lässt — dann liefert
   `getStoreData` je Betrieb Adresse, Koordinaten, Sitzplätze und Fläche;
   **(c)** Geokodierung aus Adressen, sobald (a) oder (b) Adressen liefert.
   Steht als offener Punkt in [`offene-punkte.md`](offene-punkte.md).
2. **Dann die Kartenkarte anlegen.** `mart.standort` ist so geschnitten, dass Metabases
   Kartentyp „Pin map" sie direkt lesen kann: `breitengrad` / `laengengrad` als
   Koordinatenspalten, `punkt` als Beschriftung, Klickverhalten auf `dd_betrieb`.

### Zum Logo auf dem Kartenpunkt

**Metabase kann das nicht.** Die Pin-Map zeichnet einen Standardmarker; ein eigenes Bild je
Punkt ist in der Kartenvisualisierung nicht vorgesehen (anders als bei Tabellenspalten, wo
`view_as: image` geht).

Was stattdessen geht und in `mart.standort.punkt` bereits vorbereitet ist: die Beschriftung
trägt **Ampel-Emoji + Marke + Betriebsname** — `🔴 Enchilada — Enchilada Würzburg GmbH`. Bei
eng beieinanderliegenden Betrieben macht die vorangestellte Marke auf einen Blick klar, um
welches Haus es geht, und das Emoji trägt die Ampelfarbe auch dann, wenn zwei Marker
überlappen.

Wer echte Logos will, braucht eine eigene Kartenanwendung außerhalb von Metabase. Das wäre
ein eigenes Vorhaben; der Nutzen gegenüber Emoji-plus-Markenname ist überschaubar.

---

## Fallen beim Bauen einer neuen Karte

**Komma-Join bindet schwächer als `LEFT JOIN`.** Bei

```sql
FROM mart.round_table_monat r, gewaehlt g
LEFT JOIN ampel.beschriftung a ON a.status = r.gesamt
```

gehört das `LEFT JOIN` zu `gewaehlt`, und `r` ist in der `ON`-Klausel **unsichtbar**.
Postgres meldet *„invalid reference to FROM-clause entry"*. Sechs Karten sind darauf
hereingefallen; `CROSS JOIN` bindet gleich stark und löst es.

**`percentile_cont` liefert `double precision`.** `round(double, int)` gibt es in Postgres
nicht — erst `::numeric` casten.

**Emoji statt Farbformatierung.** Die Ampeln kommen als Text aus `ampel.beschriftung`, damit
die Tabelle ohne bedingte Formatierung lesbar ist und auch in einem CSV-Export oder einer
Abo-Mail funktioniert. Das entspricht der Excel-Darstellung.

**Eine leere Karte ist eine Aussage.** Wo sie „noch nicht erfasst" heißt und nicht „keine
Probleme", gehört das in die Beschreibung — die Metabase als Kartentext anzeigt.

---

## Sprache der Beschreibungen

**Zielgruppe sind Fachbereichs-Mitarbeitende, keine Techniker.** Jede Beschreibung, jeder
Kartenname und jeder Überschriftentext in Metabase ist so formuliert, dass er ohne Kenntnis
der Datenbank, des Importers oder der Excel-Vorlagen verständlich ist.

Am 26.07.2026 wurden dafür **98 Kartenbeschreibungen, 17 Dashboard-Beschreibungen, 37
Überschriftentexte, 16 Kartennamen und 3 Sammlungsbeschreibungen** überarbeitet.

### Was aus den Texten verschwunden ist

| Weg | Warum |
|---|---|
| Tabellennamen (`mart.artikelverkauf`, `manual.massnahme`) | Sagt niemandem etwas, der die Datenbank nicht kennt |
| Implementierungsgründe („monatlich partitioniert", „zwei Y-Achsen erfinden eine Beziehung") | Begründet eine Entscheidung, die längst getroffen ist. Gehört in den Quelltext, nicht auf den Bildschirm |
| Excel-Zellbezüge (`00_Dashboard!A5`, Blatt „Eingabe") | Verweist auf eine Datei, die abgelöst werden soll |
| Verweise auf `docs/…` und „Umsetzung Berichte" | Interne Projektunterlagen |
| Fachbegriffe aus der Statistik („Variationskoeffizient", „Standardabweichung") | Durch die Bedeutung ersetzt: „wie stark der Umsatz im Verhältnis zum eigenen Durchschnitt schwankt" |
| Begriffe aus dem Datenfluss („Backfill", „Endpunkt", „Importer", „Feldfilter") | Ersetzt durch „Datenabruf", „Berichtsart" |
| Feste Messwerte („Am 26.07.2026 waren es 79 von 141") | **Veraltet still.** Ersetzt durch die Aussage; die Zahl steht in der Karte daneben |

### Was bewusst geblieben ist

- **BWA, EBIT, YTD, Deckungsbeitrag, Bon** — Vokabular des Fachbereichs, kein Technikjargon.
- **Jede Warnung, die vor einem Fehlschluss schützt.** „Ein weißer Punkt heißt keine Daten,
  nicht in Ordnung", „ein Monat auf null ist nicht gebucht, nicht umsatzlos", „zuerst auf die
  Abdeckung sehen". Diese Sätze sind der Grund, warum die Beschreibungen überhaupt existieren.
- **Median**, aber nie unerklärt — immer als „der mittlere Betrieb" oder „das Mittelfeld".

### Regel für neue Karten

> Die Beschreibung beantwortet **was sehe ich hier** und **worauf muss ich achten, um daraus
> nicht das Falsche zu schließen.** Sie beantwortet nicht, wie die Karte gebaut ist.
> Begründungen für Bauentscheidungen gehören als Kommentar in die `karten-*.ts`.

---

## Filter

### Auswahllisten statt Freitext

Die Filter **Betrieb** und **Marke** sind Auswahllisten. Das war nicht immer so: bis zum
26.07.2026 zeigte Metabase dort ein Freitextfeld, und wer „Enchilada Bremen" nicht auf den
Buchstaben genau traf, bekam **keine Fehlermeldung, sondern ein leeres Dashboard** — nicht zu
unterscheiden von einem Betrieb ohne Geschäft.

Die Liste wird beim Übernehmen aus der Datenbank gelesen (141 Betriebe, 11 Marken) und als
feste Werteliste am Dashboard hinterlegt.

> **Warum eine feste Liste und kein Verweis auf die Spalte:** Die Karten sind natives SQL,
> ihre Filter hängen deshalb an einer *Variablen* und nicht an einer Spalte. Metabase bietet
> ein Feld-Dropdown nur dort an, wo es die Spalte kennt; bei einer Variablen bleibt es beim
> Freitextfeld, gleichgültig was in `values_source_config` steht. Das wurde am 26.07.2026
> erst mit der Feld-Variante versucht und im Browser als wirkungslos nachgewiesen.

**Nach jedem neuen Betrieb einmal `bun run metabase/uebernehmen.ts` laufen lassen** — sonst
fehlt er in der Auswahlliste.

### Kein Filter ohne Wirkung

Jeder Filter am Dashboard muss von mindestens einer Karte darauf gelesen werden. Auf
*Warenwirtschaft* standen bis zum 26.07.2026 **Monat und Zeitraum nebeneinander**, und keiner
von beiden bewegte die ganze Seite: der Zeitraum wirkte nur auf die Artikellisten, der Monat
nur auf den Deckungsbeitrag, zwei Karten reagierten auf gar nichts. Zwei Zeitfilter, von denen
jeder einen anderen Teil der Seite bewegt, sind für Lesende nicht auseinanderzuhalten.

Aufgelöst, indem der Deckungsbeitrag denselben Zeitraum verwendet. Da diese Auswertung nur je
Monat vorliegt, nimmt sie alle Monate, die der gewählte Zeitraum berührt — **ein halber Monat
zählt ganz**, und genau das steht auch im Kopftext der Seite.

Die Prüfung lässt sich wiederholen: Karten-Variablen (auch die aus `gemeinsam.ts` geerbten)
gegen die Filterliste des Dashboards halten; was übrig bleibt, ist tot.
