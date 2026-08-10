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
| ③ | Betrieb | Das Betriebsblatt: Kennzahlen, Verlauf, Struktur, Personal, Ware, BWA, Einkauf & Inventur, Maßnahmen, Datenstand | das jeweilige Fach-Dashboard |
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

## Bewertungsthemen: woran es liegt (angefragt 10.08.2026)

> „Wir importieren von Yext aktuell nur die Bewertung. Allerdings interessiert uns die
> Klusterung, was denn genau die Themen sind."

Bis dahin sagte der Round Table, **dass** ein Haus abrutscht, und daneben standen die
Bewertungstexte, damit ein Mensch das **woran** selbst liest. Yext klassifiziert diese Texte
aber bereits selbst. Migration 0050 holt das Ergebnis herein, `metabase/karten-yext.ts` zeigt
es. Der vollständige Befund zur API steht in [`yext-analytics-inventar.md`](yext-analytics-inventar.md).

### Fünf Themen, und die Note ist die Aussage

Küche · Service & Personal · Wartezeit · Bestellung · Sauberkeit. Jedes trägt die
Durchschnittsnote **der Bewertungen, die es ansprechen** — „Bestellung 2,14" heißt: wer über
die Bestellung schrieb, vergab im Schnitt 2,14 Sterne. Über alle operativen Betriebe im Juli
2026 trugen Küche (4,35) und Service (4,12) die Note, Bestellung (2,14) und Wartezeit (3,15)
zogen sie herunter.

**Nicht Yexts Sentiment.** Yext liefert zu jedem Stichwort einen Stimmungswert; für unsere
Daten steht er bei 4.362 von 5.119 Stichworten auf exakt 0 — darunter *essen*, *bedienung*,
*personal*. Dieselben Themen trennt die Note von 2,50 bis 4,35. Die Note ist das bessere
Sentiment, und deshalb rechnet jede Karte auf ihr.

### Drei Eigenschaften, die auf den Seiten stehen und nicht in einer Fußnote

**Die Themen beginnen im April 2026.** Davor stehen vier von Hand vergebene Alt-Labels („5",
„5 Sterne AR") mit je einer Nennung, dann elf leere Monate. `mart.bewertung_thema_start`
rechnet deshalb den Beginn der **lückenlosen** Reihe aus, nicht `min(monat)` — sonst meldete
die Seite „Vorjahresvergleich möglich", während der Vergleich gegen eine einzige handvergebene
Marke liefe. Die Karte *Seit wann es Themen gibt* sagt es auf der Seite.

**Eine Bewertung trägt mehrere Themen.** Die Anteile ergeben zusammen über 100 % — das ist
richtig. Deshalb rechnet `mart.bewertung_thema.anteil` gegen die echte Bewertungszahl aus
`core.bewertung_antwort` und nicht gegen die Themensumme, und deshalb steht auf diesen Seiten
**kein Kreisdiagramm**: ein Tortenstück behauptet einen Anteil an einem Ganzen, das es hier
nicht gibt.

**Der Schwachpunkt ist der Abstand, nicht die kleinste Note.** Ein Haus mit lauter Vieren hat
kein Wartezeitproblem, nur weil die Wartezeit bei 3,9 steht. Gezeigt wird deshalb der Abstand
zum eigenen Schnitt des Hauses.

### Was daneben lag und mitgenommen wurde

Dieselbe API liefert zwei Blöcke, nach denen niemand gefragt hatte:

**Antwortverhalten** (Reiter *Antworten*). Wer auf Bewertungen antwortet und wie schnell. Das
war nirgends sichtbar: einzelne Häuser antworten gar nicht, während der Konzernschnitt bei 91 %
liegt. Wo nicht geantwortet wurde, bleibt die Reaktionszeit **leer und nicht null** — Yext
liefert dort 0, und 0 Stunden hätte genau die Häuser ohne Antwort an die Spitze der Bestenliste
gesetzt.

**Sichtbarkeit** (Reiter *Sichtbarkeit*). Impressionen, Suchen, Profilaufrufe, Klicks — und
der von Yext gelieferte **Median vergleichbarer Betriebe**. Faktor unter 1 heißt: dieses Haus
wird seltener gesehen als vergleichbare. Der Median ist **nicht addierbar**; über alle Häuser
summiert ergäbe er eine Zahl, die nach Faktor 9 aussieht und nichts bedeutet. Deshalb nur je
Betrieb und nur, wo Yext überhaupt einen Vergleich führt.

### Zwei Wächter, weil zwei Annahmen fest verdrahtet sind

*Unbekannte Themen* listet Labels, die Yext liefert und die die Fünf-Spalten-Tabelle nicht
kennt — sie **soll leer sein**. Die vier historischen Handvergaben sind ausgenommen: ein
Wächter, der immer piept, wird abgeschaltet.

*Wie frisch die Yext-Zahlen sind* zeigt je Kennzahl, bis wann Yext sie als vollständig meldet.
Nötig, weil der Bericht für angefangene Zeiträume Zahlen liefert, die vollständig **aussehen**:
Bewertungen sind bis gestern vollständig, Impressionen bis zu einer Woche älter.

### Wo die aggregierten Werte stehen

| Seite | was dort steht |
|---|---|
| ① Round Table, *Lage* | Kacheln **Schwächstes Thema** und **Antwortquote**, beide führen auf das Bewertungs-Dashboard |
| ② Filialen | *Woran es bei wem liegt* — die Note je Thema unter der Bewertungs-Rangliste |
| ③ Betrieb, *Gäste & Bewertungen* | Themenprofil und Verlauf des Hauses, dazu sein Antwortverhalten |
| Online-Bewertungen | drei neue Reiter: *Themen*, *Antworten*, *Sichtbarkeit* |

Die Kachel auf ① ist der eigentliche Punkt: „4,23" sagt niemandem, was zu tun ist,
„Bestellung · 2,14" schon.

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

## Belege und Inventur

Zwei Auswertungen, die auf denselben Daten aufbauen wie die Warenwirtschaft, aber eine
andere Frage beantworten: nicht „was kostet die Ware im Schnitt", sondern „was ist an einem
konkreten Beleg passiert" und „was hat die Zählung ergeben".

**Ein eigener Reiter statt einer weiteren Zeile auf „Personal · Ware · BWA".** Die Karten
dort sind verdichtete Kennzahlen — Quoten, Ranglisten, Zeitreihen. Belegliste und
Inventurliste sind Rohlisten, dieselbe Kategorie wie „Maßnahmen & Datenstand" nebenan, nur
ein eigenes Fachthema: „was wurde verkauft" gegen „was wurde eingekauft und gezählt". Ein
Anhängsel hätte die Warenreihe auf sechs Karten gestreckt und die beiden neuen Listen unter
dem Artikelverkauf begraben.

**Stornos stehen in der Liste, nicht daneben.** Eine stornierte Bestellung verschwindet
nicht aus der Belegliste — sie bekommt eine eigene Spalte „Storno". Wer eine Bestellung
sucht, die vor Wochen aufgegeben und dann storniert wurde, muss sie finden können, nicht nur
ihre Abwesenheit erraten. Dieselbe Logik gilt für eine noch nicht signierte Inventur: sie
bleibt sichtbar und gekennzeichnet, zählt aber nicht in den bewerteten Euro-Summen mit.

**Die Inventurkarten sind heute leer, und das ist kein Fehler.** Die Rohtabellen stehen seit
Migration `0044`, der Abruf der Zählungen ist eine bewusste, manuelle Entscheidung
(`bun run einreihen --foodnotify-inventuren`) und läuft erst später. Die Kartenbeschreibung
sagt das ausdrücklich, damit eine leere Liste nicht als „keine Inventuren gemacht" gelesen
wird.

**Eine flächige Schwundaussage über alle Marken gibt es nicht, und die Karte verschweigt das
nicht.** Gemessen an den geladenen Inventurköpfen (Migration `0044`) kommen von den echten
Zählungen praktisch alle bei Wilma Wunder vor; bei den anderen drei Marken ist die Fallzahl
zu klein, um daraus einen Schwundwert für die ganze Marke abzuleiten. Der Vorbehalt steht
deshalb doppelt: als Textkachel über der Karte auf „Einkauf" und als Satz in der
Kartenbeschreibung selbst — eine Überschrift auf der Seite sieht man leichter über als einen
Kartentext.

**Schwund wird je Betrieb und Monat verdichtet, nicht je Inventur.** Dieselbe Körnung wie
das Einkaufsvolumen und die Personalkosten, damit sich Schwund neben diesen beiden in
denselben Zeitraster einordnet. Nur signierte, nicht stornierte Inventuren gehen in die
bewerteten Euro-Summen ein — eine laufende Zählung ist kein Ergebnis, eine stornierte kein
Beleg.

### Der einzelne Beleg (angefragt 10.08.2026)

Dasselbe Muster wie bei der Zählung unten: Ein Klick auf „ansehen →" in der Bestellliste
öffnet `dd_beleg` — Kopfdaten plus jede bestellte Ware mit Menge, Gebinde, Einzelpreis und
Summe, nach Positionswert sortiert. Eine eigene mart-Sicht brauchte es nicht:
`mart.einkauf_position` führt die Positionsebene bereits, inklusive `bestellung_key`.

**Angesteuert wird über den Bestellschlüssel, nicht über Belegnummer + Datum.** Gemessen am
10.08.2026: in **9.795** Fällen bestellt derselbe Betrieb am selben Tag mehrfach beim selben
Lieferanten, und **50.063 von 50.072** Belegen haben gar keine Belegnummer — FoodNotify füllt
sie erst, wenn eine Rechnung angehängt ist. Beides zusammen macht jede andere Ansteuerung
mehrdeutig.

**„nicht angekommen" heißt nicht „ersetzt".** Die Spalte in `core.bestellposition` heißt
`ersetzt`, misst aber `status = 'not arrived'` — `isSubstituted` ist in allen Positionen
`null` (siehe den Kommentar in `src/foodnotify/transform.ts`). Bei einer noch offenen
Bestellung (Status `pending`) steht der Vermerk deshalb auf **jeder** Zeile und heißt schlicht
„noch nicht geliefert"; nur bei einer abgeschlossenen Bestellung ist er ein Fehlartikel. Der
erste Entwurf der Karte beschriftete die Spalte mit „ersetzt" — beim Live-Test fielen 13 von
14 Zeilen eines Belegs auf, was die Fehldeutung aufdeckte.

### Die einzelne Zählung (angefragt 10.08.2026)

Die Kopfzeile sagt, **dass** ein Betrieb 5.500 € Schwund hat; sie sagt nicht, **woran**. Ein
Klick auf „ansehen →" in der Inventurliste öffnet deshalb `dd_inventur` — Kopfdaten plus
jede gezählte Ware mit Soll- und Ist-Menge, Preis je Einheit und Differenz.

**Angesteuert wird über den Inventurschlüssel, nicht über Betrieb + Datum.** An einem Tag
zählen Bar und Küche getrennt (zwei Kostenstellen, zwei Inventuren) — beide tragen denselben
Betrieb und dasselbe Datum. Ein Klick müsste sonst raten, welche der beiden gemeint war. Die
Schlüsselspalte steht in der Liste, ist aber ausgeblendet: Metabase reicht auch verborgene
Spalten an das Klickziel weiter.

**Nur die Spalte „ansehen →" ist klickbar**, nicht die ganze Zeile. Sonst navigiert ein
versehentlicher Klick auf eine Zahl weg — dieselbe Regel wie bei allen Tabellen hier.

**Die Detailsicht filtert bewusst NICHTS weg.** `mart.inventur` und `mart.inventur_schwund`
nehmen unplausible Positionen aus den Euro-Summen (Migration `0046`); `mart.inventurposition`
lässt sie stehen und kennzeichnet sie mit **⚠**. Wer eine einzelne Zählung öffnet, sucht
gerade die Ausreißer — eine Detailansicht, die die auffälligen Zeilen versteckt, beantwortet
die Frage nicht, wegen der man sie geöffnet hat. Die Kopfkarte nennt daneben, wie viele
Positionen ausgenommen wurden.

**Sortiert nach dem Geldwert der Differenz, absteigend.** Wer eine Zählung öffnet, sucht die
Zeile, die den Schwund trägt — nicht die alphabetisch erste Ware. `abs()` um die Differenz,
weil auch ein Überbestand ein Befund ist: positiv heißt „es fehlt", negativ heißt „mehr da
als gebucht", meist ein Buchungsfehler.

**Die Einheit gehört zur Menge.** Dieselbe Ware führt bei FoodNotify Positionen in `g` und in
`mpce` nebeneinander (siehe `0046`). Eine Menge ohne ihre Einheit ist hier keine Aussage,
sondern eine Falle — deshalb steht `Einheit` als eigene Spalte direkt neben den Mengen.

---

## Zwei Personalkosten-Größen auf einer Seite

**Gefragt am 04.08.2026:** „Die Personalkosten, welche du anzeigst — sind das Kosten gesamt,
Kosten ohne GF oder nur die operativen Kosten aus den Bereichen (Bar, Küche, Service)?" Die
Frage war berechtigt, denn auf dem Personal-Dashboard standen **beide** Größen, ohne dass
irgendwo stand, dass es zwei sind.

| Größe | Herkunft | Was drin ist | Wozu |
|---|---|---|---|
| `persoog_bwa` → „Personal o. GF % (BWA · Ampel)" | LINA-Feld `persoogBwa`, aus der **BWA** | Personalkosten **ohne Geschäftsführung**, fertig in % vom Umsatz | **Trägt die Ampel** „Personal" im Round Table (grün bis 28 %); ist Spalte `Eingabe!J` des Excel |
| `pek_gesamt` → „Personal gesamt % (operativ)" | LINA-Bericht „Personalkosten/Effektivität pro Bereich", aus der **Kasse** | Nur **Service + Bar + Küche**; ohne GF, ohne Verwaltung | Sagt, **wo** es klemmt — trägt keine Ampel |

**Sie sind nicht ineinander umrechenbar, und eine Abweichung ist der Normalfall** — die eine
ist gebuchtes Ergebnis vom Steuerberater, die andere der laufende Betrieb aus dem
Kassensystem. `pek_service`, `pek_bar` und `pek_kueche` sind die Aufteilung der zweiten,
nicht der ersten.

Der Kartentext von `pe_bereich` stellte beide bis dahin wortlos nebeneinander in eine
Tabelle — das liest sich zwangsläufig als dieselbe Zahl in zwei Fassungen. Behoben an vier
Stellen, weil jede für sich gelesen wird: in der Einleitung des Personal-Dashboards, in den
Beschreibungen von `pe_quote_betrieb`, `pe_quote_tabelle` und `pe_bereich`, in
`dd_betrieb_personal` auf ③ Betrieb — und in den **Spaltentiteln selbst**. Der Spaltentitel
ist die einzige Erklärung, die mitwandert, wenn jemand die Tabelle exportiert oder einen
Screenshot verschickt.

**Die `eff_*`-Spalten sind eine dritte Größe** und heißen im LINA-Bericht ebenfalls
„Effektivität": Umsatz je geleisteter Personalstunde in **Euro**, keine Quote. Deshalb stehen
sie in einer eigenen Karte und nicht neben den Prozentwerten — zwei Achsen in einem Diagramm
wären hier der sichere Weg zur Fehldeutung.

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

### Wie die Liste aktuell bleibt

**Von selbst.** Man weiß nicht, wann ein Betrieb dazukommt — der Importer legt ihn
stillschweigend an, sobald LINA ihn liefert. Deshalb hängt der Abgleich am Sync-Lauf:
`src/sync.ts` ruft ihn als **Nachlauf** auf, nach dem Import. Ein neuer Betrieb steht damit
spätestens nach dem nächsten Importlauf im Filter, ohne dass jemand etwas tut.

Kein Cron-Auftrag, kein API-Schlüssel, keine zusätzliche Umgebungsvariable: die Adresse von
Metabases Datenbank wird aus `DATABASE_URL` abgeleitet (dieselbe Instanz, Datenbank
`lina_metabase`). `METABASE_DB_URL` überschreibt das, falls Metabase woanders liegt.

> **Zwei Regeln, die den Preis dafür bezahlen.** Der Importer weiß damit von Metabase, was er
> eigentlich nicht müsste. Abgefedert durch: **(1)** Der Nachlauf kann einen Sync-Lauf niemals
> scheitern lassen — die Funktion fängt alles und wirft nie; ein abgestürztes, abgeschaltetes
> oder nie eingerichtetes Metabase ist kein Importproblem. **(2)** Er läuft **nach** dem
> Import, nie davor. Beides ist mit einem Test festgehalten, der eine unerreichbare
> Metabase-Datenbank vorgibt.

**Von Hand geht auch** — nachsehen, ohne einen Import abzuwarten:

```bash
bun run metabase/auswahllisten.ts            # zeigt nur, was sich ändern würde
bun run metabase/auswahllisten.ts --setzen   # schreibt es sofort
```

Ohne `--setzen` endet der Lauf mit Rückgabewert 1, sobald es etwas zu tun gibt. Beide Wege
benutzen **dieselbe Funktion** (`src/sync/auswahllisten.ts`) — zwei Umsetzungen desselben
Abgleichs wären zwei Gelegenheiten, dass eine davon still etwas anderes tut.

### Und wenn der Nachlauf ausfällt

Etwa weil der Importer selbst steht. Dann veraltet die Liste **still** — das Dashboard sieht
vollständig richtig aus, es fehlt nur ein Betrieb im Dropdown, und niemand vermisst, was er
nicht sieht. Deshalb zählt `/status` nach:

```json
{ "name": "dashboard_filter", "stufe": "warnung",
  "meldung": "3 Betrieb(e) fehlen in der Filterauswahl der Dashboards",
  "naechster_schritt": "bun run metabase/auswahllisten.ts --setzen — läuft der Importer noch?" }
```

Der Abgleich hinterlegt dafür bei jedem Lauf in `sync.merker`, mit wie vielen Betrieben er
gearbeitet hat; `/status` vergleicht das mit dem Bestand. Der Zeitstempel dort sagt
zusätzlich, wann zuletzt abgeglichen wurde — ein alter Zeitstempel heißt, dass auch der Import
steht.

**Nach einem größeren Umbau** an Karten oder Layout weiterhin `bun run metabase/uebernehmen.ts` —
das ist der vollständige Lauf und setzt die Listen nebenbei mit.

### Kein Filter ohne Wirkung

Jeder Filter am Dashboard muss von mindestens einer Karte darauf gelesen werden. Auf
*Warenwirtschaft* standen bis zum 26.07.2026 **Monat und Zeitraum nebeneinander**, und keiner
von beiden bewegte die ganze Seite: der Zeitraum wirkte nur auf die Artikellisten, der Monat
nur auf den Deckungsbeitrag, zwei Karten reagierten auf gar nichts. Zwei Zeitfilter, von denen
jeder einen anderen Teil der Seite bewegt, sind für Lesende nicht auseinanderzuhalten.

Aufgelöst, indem der Deckungsbeitrag denselben Zeitraum verwendet. Da diese Auswertung nur je
Monat vorliegt, nimmt sie alle Monate, die der gewählte Zeitraum berührt — **ein halber Monat
zählt ganz**, und genau das steht auch im Kopftext der Seite.

Seit dem 27.07.2026 wird das **erzwungen**, nicht mehr geprüft: `uebernehmen.ts` scheitert,
bevor irgendetwas angelegt wird, wenn ein Filter nicht von allen Karten seines Dashboards
gelesen wird. Zwei Stufen, beide sind Fehler:

- **tot** — keine einzige Karte liest ihn
- **taub** — nur ein Teil liest ihn. Schlimmer als tot, weil die Seite halb antwortet und
  dadurch funktionierend aussieht

Genauso für den Drill-Down: Führt ein Klick zu einem Dashboard, das den übergebenen Parameter
nicht kennt, landet man dort **ungefiltert** — und hält den zuletzt gewählten Betrieb für den
angeklickten. Auch das lässt den Lauf scheitern.

**Ausnahmen gehören begründet.** `FILTER_AUSNAHME` in `uebernehmen.ts` nennt je Karte und
Filter den fachlichen Grund. Die häufigsten:

| Fall | Grund |
|---|---|
| Verlaufskurven (`*_verlauf`, `rt_historie`) | Ein Stichmonat ließe einen einzigen Punkt übrig |
| Kacheln „laufender Monat" | Zeigen ausdrücklich *jetzt*, nicht den gewählten Monat |
| `pf_karteileichen`, `pf_kachel_aktiv` | Betriebe ohne **jeden** Umsatz — über die gesamte Historie |
| `wa_preise` | Einkaufspreise gelten je Lieferant für die Gruppe; die Sicht hat gar keine Betriebsspalte |
| Tagesprofile (`*_stunde`, `*_zeitzone`) | Muster über die gesamte Historie, nicht über einen Monat |

Wer eine Karte ergänzt, die einen Filter ignoriert, muss diese Entscheidung hinschreiben —
sonst läuft das Provisionieren nicht durch.

---

## Import — Überwachung (Sammlung „Technik")

Die technische Seite. Sie beantwortet keine fachliche Frage, sondern die davor: **läuft der
Datenimport, und wenn nicht, woran liegt es.** Deshalb stehen hier Endpunktnamen und
technische Begriffe — sie sind die Sache selbst, nicht ihre Verpackung.

Aufbau in der Reihenfolge, in der man nachfragt:

| Abschnitt | Beantwortet | Wichtigste Karte |
|---|---|---|
| **Läuft es?** | Zugang frei? Wie weit? Wie schnell? Wann fertig? | Vier Kacheln: Zugang · Fortschritt · Tempo · Restzeit |
| **Woran hängt es?** | Sperre, Fehlermuster, Strukturänderungen, letzte Läufe | „Warum der Zugang ruht" — ist die belegt, erübrigt sich alles Weitere |
| **Was läuft gerade?** | Puls, Antwortzeiten, die offene Warteschlange | „Was als Nächstes drankommt" in echter Abarbeitungsreihenfolge |
| **Wie vollständig?** | Je Bericht und je Betrieb | „Tage alt" — daran erkennt man einen hängenden Bericht |

### Drei Dinge, die man wissen muss, um die Seite richtig zu lesen

**„keine Daten" ist kein Fehler.** LINA antwortet mit HTTP 500 und leerem Body, wenn ein
Betrieb für einen Bericht nichts hat — ein geschlossenes Haus, ein Bericht, den dieser Betrieb
nicht führt. Bei 141 Betrieben ist das ständig der Fall. Nur was unter „Fehler" steht, ist
einer.

**„wartet" heißt nicht kaputt.** Der laufende Betrieb (Priorität ≤ 10) geht immer vor der
Historie (≥ 90). Historienposten können deshalb tagelang unberührt bleiben, während alles
richtig funktioniert.

**„abgebrochen" bei einem Lauf ist der Normalfall.** Ein Lauf mit Zeitfrist endet per SIGTERM;
der nächste macht dort weiter, wo dieser aufhörte. Der Zustand liegt in der Datenbank, nicht im
Prozess.

### Die Restzeit ist eine Größenordnung

Sie wird aus dem Durchsatz der **letzten Stunde** hochgerechnet — bewusst kurz gefenstert, weil
das Tempo an `TAKT_*` und am Tagesbudget hängt und ein Mittel über Tage jede Pause als
dauerhafte Langsamkeit lesen würde. Läuft gerade nichts, steht dort „—" statt einer erfundenen
Zahl.

### Die Sichten dahinter

Alle in `mart`, angelegt in `migrations/0019_import_ueberwachung.sql`:

| Sicht | Beantwortet |
|---|---|
| `import_gesamt` | Eine Zeile: Fortschritt, Tempo, Restzeit, Reichweite, Sperre |
| `import_naechste` | Die offene Warteschlange in Abarbeitungsreihenfolge |
| `import_fehler` | Fehlermuster der letzten 24 h, gruppiert |
| `import_bericht` | Je Bericht: Fortschritt, Aktualität, Gesundheit |
| `import_betrieb` | Je Betrieb: was fehlt, wie weit reichen die Daten |
| `import_lauf` | Die Läufe mit Durchsatz je Minute |
| `import_puls` | Posten je Stunde, letzte drei Tage |
| `import_sperre` | Zugangssperren, aktive zuerst |
| `import_strukturaenderung` | Wenn LINA das Antwortformat ändert |

> Die letzten beiden waren zuerst Karten direkt auf `sync.zugangssperre` und
> `sync.schema_abweichung`. Das läuft — natives SQL fragt die Sichtbarkeit nicht — verstößt
> aber gegen den Grundsatz aus `metabase.md`. `sync` ist gar nicht nach Metabase
> synchronisiert; eine Karte darauf ist eine, die niemand in der Oberfläche nachbauen oder
> prüfen kann. Deshalb nachträglich zwei `mart`-Sichten.

### Verhältnis zu „Datenqualität und Import"

Die ältere Seite bleibt. Sie fragt **fachlich**: welchen Betrieben fehlen Daten, stimmen die
Zahlen gegen LINAs eigene Aggregate, wer ist überhaupt beurteilbar. Diese hier fragt
**technisch**: läuft der Abruf. Wer eine fehlende Zahl sucht, fängt hier an und geht dann
dorthin.
