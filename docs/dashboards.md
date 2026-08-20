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
bun run metabase/uebernehmen.ts
```

> ⚠️ **Der Befehl prüft nicht, er überträgt.** Sind `METABASE_USER` und `METABASE_PASSWORD`
> gesetzt — und das sind sie in `.env` —, meldet sich das Skript selbst an und schreibt
> **sofort** gegen `METABASE_URL`, also gegen die Produktivinstanz. Kein Browser, keine
> Rückfrage, kein Trockenlauf. Nur **ohne** diese beiden Variablen fällt es auf den älteren
> Weg zurück: ein Server auf `:8899`, den man im Browser öffnet und wo man „Übernehmen"
> klickt.
>
> Wer nur wissen will, ob die Definitionen in sich stimmen, braucht den Befehl nicht: die
> Prüfungen (Überlappung, Mindesthöhe, tote und taube Filter, Klickziele) laufen ganz am
> Anfang und werfen, bevor irgendetwas angelegt wird — aber sie laufen im selben Prozess,
> der danach überträgt. Für einen reinen Test gibt es `bun test metabase/karten.test.ts`;
> der fasst Metabase nicht an.
>
> Am 10.08.2026 hat ein Agent den Befehl in der Annahme aufgerufen, er prüfe nur, und ihn
> nach vierzig Karten abgebrochen. Folgenlos, weil die Übertragung idempotent ist und die
> betroffenen Karten sich nicht geändert hatten — aber die Annahme kam aus dieser Datei.

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
| ③ | Betrieb | Das Betriebsblatt: Kennzahlen **samt Vergleich gegen Marke und Stadt**, Verlauf, Struktur, Personal, Ware, BWA, Einkauf & Inventur, Maßnahmen, Datenstand | das jeweilige Fach-Dashboard, ⑨ und ⑩ |
| ④ | Zeiträume vergleichen | Zwei frei wählbare Zeiträume nebeneinander | ③ |
| ⑤ | Standorte vergleichen | Mehrere Betriebe über alle Metriken, Verlauf, Tagesprofil, Spartenmix | ③ |
| ⑥ | Portfolio und Potenzial | Konzentration, Streuung, was der Abstand zum Median kostet | — |
| ⑦ | Muster im Geschäft | Wochenrhythmus, Stabilität, Gäste gegen Bon | — |
| ⑧ | Standortkarte | Alle Standorte mit Koordinate, eingefärbt nach Handlungsbedarf | ③ |
| ⑨ | Betrieb gegen Marke | Ein Betrieb gegen den Schnitt seiner eigenen Marke | ③ |
| ⑩ | Betrieb gegen die Stadt | Ein Betrieb gegen die Nachbarbetriebe am selben Ort | ③ |

Dazu drei Detailseiten ohne Nummer, die man nicht ansteuert, sondern in die man klickt:
**Beleg** (`dd_beleg`, aus der Bestellliste), **Zählung** (`dd_inventur`, aus der
Inventurliste) und **Sperre** (`dd_sperre`, aus „Warum eine Ware nicht verglichen wird" —
zeigt die Waren und Betriebe hinter einer der vier Sperren des Preisvergleichs).

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

Bis dahin sagte der Round Table, **dass** ein Betrieb abrutscht, und daneben standen die
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

**Der Schwachpunkt ist der Abstand, nicht die kleinste Note.** Ein Betrieb mit lauter Vieren hat
kein Wartezeitproblem, nur weil die Wartezeit bei 3,9 steht. Gezeigt wird deshalb der Abstand
zum eigenen Schnitt des Betriebs.

### Was daneben lag und mitgenommen wurde

Dieselbe API liefert zwei Blöcke, nach denen niemand gefragt hatte:

**Antwortverhalten** (Reiter *Antworten*). Wer auf Bewertungen antwortet und wie schnell. Das
war nirgends sichtbar: einzelne Betriebe antworten gar nicht, während der Konzernschnitt bei 91 %
liegt. Wo nicht geantwortet wurde, bleibt die Reaktionszeit **leer und nicht null** — Yext
liefert dort 0, und 0 Stunden hätte genau die Betriebe ohne Antwort an die Spitze der Bestenliste
gesetzt.

**Sichtbarkeit** (Reiter *Sichtbarkeit*). Impressionen, Suchen, Profilaufrufe, Klicks — und
der von Yext gelieferte **Median vergleichbarer Betriebe**. Faktor unter 1 heißt: dieser Betrieb
wird seltener gesehen als vergleichbare. Der Median ist **nicht addierbar**; über alle Betriebe
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
| ③ Betrieb, *Gäste & Bewertungen* | Themenprofil und Verlauf des Betriebs, dazu sein Antwortverhalten |
| Online-Bewertungen | drei neue Reiter: *Themen*, *Antworten*, *Sichtbarkeit* |

Die Kachel auf ① ist der eigentliche Punkt: „4,23" sagt niemandem, was zu tun ist,
„Bestellung · 2,14" schon.

---

## Vergleichsgruppen: gegen die Marke, gegen die Stadt (angefragt 10.08.2026)

> „Angenommen, wir möchten Enchilada Karlsruhe gegen Aposto und Wilma Wunder vergleichen, um
> festzustellen, ob bei allen der Umsatz eingebrochen ist oder nur bei einem."

Das ist die Frage nach dem **Maßstab**. Ein Umsatzrückgang von zwölf Prozent heißt etwas
völlig anderes, je nachdem ob die Nachbarbetriebe dasselbe zeigen oder ob der Betrieb allein
dasteht. Ohne Maßstab führt jede Zahl im Round Table zu derselben Rückfrage, und die wurde
bisher von Hand beantwortet.

### Die kurze Fassung steht auf ③ Betrieb, die lange auf ⑨ und ⑩

**Nachgereicht am 10.08.2026:** „das bestehende Betriebs-Dashboard um diese zwei Sachen
erweitern … alles auf einem Dashboard". Berechtigt — die Frage „liegt es an diesem Betrieb?"
stellt sich beim Lesen des Betriebsblatts, nicht auf einer Extraseite, zu der man erst
navigieren muss.

Auf ③ stehen deshalb direkt unter den sechs Kennzahlen zwei Karten:

| Karte | Zeigt |
|---|---|
| `dd_betrieb_vergleich` | dieselben sechs Kennzahlen, je mit Markenmedian **und** Stadtmedian samt Rang |
| `dd_betrieb_vergleich_verlauf` | Umsatzveränderung über 24 Monate: Betrieb, Marke und Stadt in **einem** Bild |

Das liest sich von oben nach unten: `dd_betrieb_kopf` beantwortet *wie hat es sich
entwickelt* (Vormonat, Trend, Ampelwechsel), die Karte darunter *wie steht es gegen die
anderen* — in derselben Zeilenreihenfolge, damit man die Kennzahl nicht suchen muss.

**Warum nicht einfach vier Spalten an `dd_betrieb_kopf` anhängen.** Die Karte führt bereits
neun Spalten. Vier weitere ergäben dreizehn und damit waagerechtes Scrollen — genau der
Fehler, der am 28.07.2026 dazu geführt hat, dass diese Tabelle die volle Breite bekam: wer
scrollen muss, um die dritte Spalte zu sehen, vergleicht sie nicht mehr mit der ersten.

**Der Rang trägt die Aussage, nicht der Abstand.** Auf ③ ist der Platz knapp, deshalb stehen
dort Median und Rang, aber keine Δ-Spalten. Das ist kein Verlust: „16 von 17" ist eindeutig,
ein „+5,8" wäre es nicht — bei Personal und Wareneinsatz ist weniger besser. Wer den Abstand
in Zahlen will, klickt auf einen Vergleichswert und landet auf ⑨ bzw. ⑩.

**Damit sind ⑨ und ⑩ erstmals angeklickt erreichbar.** ④ bis ⑦ hängen bis heute an keinem
Klick — man findet sie nur über die Sammlung.

Klickbar sind **vier** Spalten, nicht zwei: die ganze Marken-Hälfte der Zeile führt zu ⑨,
die ganze Stadt-Hälfte zu ⑩.

| Spalte | führt zu |
|---|---|
| `Marke (Median)`, `Rang Marke` | ⑨ Betrieb gegen Marke |
| `Stadt (Median)`, `Rang Stadt` | ⑩ Betrieb gegen die Stadt |

Zwei Klickflächen je Thema, weil die Hand nach der **roten Zahl** greift — und das ist meist
der Rang, denn der trägt die Aussage. Eine einzelne verlinkte Spalte daneben wäre ein Klick,
den man erst suchen muss.

`Kennzahl`, `●` und `Wert` bleiben bewusst stumm: sie beschreiben den **Betrieb**, nicht eine
Vergleichsgruppe, und hätten deshalb kein eindeutiges Ziel. Ein Klick, der zwischen Marke
und Stadt raten müsste, ist schlechter als keiner.

Der **Betrieb** kommt aus der angeklickten Zeile, der **Monat** wandert von selbst mit —
beide Zielseiten kennen den Filter unter demselben Namen. `zeitraum` und `Sterne` bleiben
zurück, weil ⑨ und ⑩ sie gar nicht führen.

Ein Beispiel, warum beide Ebenen bleiben — Enchilada Karlsruhe im Juli:

| Kennzahl | Wert | Marke | Rang Marke | Stadt | Rang Stadt |
|---|---|---|---|---|---|
| Umsatz | +21,2 % | −1,1 % | 2 von 18 | +7,4 % | 1 von 4 |
| Personal | 45,0 % | 39,2 % | 16 von 17 | 42,5 % | 3 von 4 |
| WE Küche | 37,4 % | 24,9 % | **17 von 17** | 33,9 % | **4 von 4** |

Der Umsatz ist nicht das Problem — der Betrieb ist der beste seiner Stadt und der zweitbeste
seiner Marke. Der Wareneinsatz Küche ist es: **letzter gegen beide Maßstäbe.** Diese
Diagnose steht jetzt auf dem Betriebsblatt selbst; ⑨ und ⑩ sagen anschließend, gegen *wen*
genau.

### Warum zwei Seiten und nicht eine mit Umschalter

Die beiden Gruppen fangen **verschiedene Störquellen** ab:

| Gruppe | gleich | verschieden | fängt ab, was … |
|---|---|---|---|
| **Marke** | Konzept, Karte, Preise, Zielgruppe | Standort, Einzugsgebiet, Wetter | … am Konzept liegt |
| **Stadt** | Einzugsgebiet, Wetter, Feiertage, Kaufkraft | Konzept, Karte, Preise | … am Standort liegt |

Erst wer beide nebeneinander liest, kann die dritte Aussage treffen: **fällt ein Betrieb
gegenüber seiner Marke *und* gegenüber seiner Stadt ab, liegt es am Betrieb.** Eine einzelne
Seite mit Umschalter hätte genau diesen Vergleich unmöglich gemacht — man sieht immer nur
eine der beiden Antworten.

### Die Vergleichsgruppe wird abgeleitet, nicht eingestellt

Beide Seiten haben **nur zwei Filter: Monat und Betrieb.** Marke und Stadt ergeben sich aus
dem gewählten Betrieb.

Die naheliegende Alternative — ein zweiter Filter „Marke" bzw. „Stadt" daneben — ist die
schlechtere: zwei Filter, die dieselbe Menge einschränken, können einander widersprechen
(„Betrieb = Aposto Mainz" und „Marke = Enchilada"), und das Ergebnis ist eine **leere Seite
ohne Fehlermeldung**. Nicht zu unterscheiden von einem Betrieb ohne Geschäft — dieselbe
Falle, wegen der die Textfilter überhaupt Auswahllisten bekommen haben.

Auch **keinen Zeitraumfilter**, und das ist kein Vergessen: die Verlaufskarten lesen zwei
verschiedene Tabellen (der Betrieb und seine Gruppe), und ein Metabase-Feldfilter baut seine
Klausel aus dem *Tabellennamen*. Er würde nur einen der beiden Äste einschränken und die
Linien still verschieden lang machen. Stattdessen ein festes **24-Monats-Fenster, das am
Monatsfilter hängt** — zwei Jahre, weil ein Jahresvergleich mindestens einen vollen
Saisonzyklus braucht.

### Ohne Auswahl zeigt jede Karte etwas anderes — mit Absicht

Ein Muster, das sich durch alle zehn Karten zieht:

| SQL | ohne Auswahl | benutzt in |
|---|---|---|
| `WHERE 1 = 1 [[AND betrieb = {{betrieb}}]]` | **alle** Zeilen | Tabellen |
| `WHERE false [[OR betrieb = {{betrieb}}]]` | **keine** Zeile | Diagrammen |

Tabellen stehen ohne Auswahl vollständig da und sind dann eine brauchbare Gesamtübersicht
(„wer liegt am weitesten unter seiner eigenen Marke"). Diagramme können das nicht — 49
Linien übereinander sind keine Kurve. Sie zeigen ohne Auswahl deshalb die **Gruppen selbst**
(die Marken bzw. die Städte) und mit Auswahl die einzelnen Betriebe.

### Was in den Sichten steht und nicht in den Karten

**Die Richtung.** Bei Umsatz und Bewertung ist mehr besser, bei Personal und Wareneinsatz
weniger. Eine Spalte „Abweichung: +3,2" ist ohne diese Angabe zweideutig — und zwar auf die
gefährliche Art, weil sie entschieden aussieht. Jede Zeile trägt deshalb eine Spalte
**„Stellung"** mit *besser* / *schlechter* / *gleich*, abgeleitet aus dem Standardregelwerk.
Angezeigt wird `▲ besser` — Zeichen **und** Wort, weil das Zeichen allein bei einer
Personalquote wieder als „höher" lesbar wäre und auch in einem CSV-Export funktionieren muss.

**Der Rang steht nie ohne die Gruppengröße** — „3 von 14", nicht „3". Platz drei ist unter
vierzehn gut und unter dreien der letzte.

**Der Maßstab zählt nur operative Betriebe.** Ein stillgelegter Betrieb steht mit −100 % Umsatz
in den Daten; zwei davon in einer kleinen Marke, und jeder laufende Betrieb sieht
überdurchschnittlich aus. Der **betrachtete** Betrieb darf trotzdem still sein — sonst öffnet
sich die Seite für ihn leer, und leer liest sich als „keine Daten" statt als „stillgelegt".

**Median, nicht Mittelwert** — dieselbe Begründung wie überall hier: die Personalquote hat
den Umsatz im Nenner und erreicht gemessen bis 316.576 %.

### Auf ⑩ steht eine Warnung, die auf ⑨ fehlt

Die Betriebe einer Stadt gehören **verschiedenen Marken**. In Karlsruhe stehen Aposto,
Enchilada, Lehners und Wilma Wunder nebeneinander — vier Konzepte mit verschiedenen Karten,
Preisen und Personalstrukturen. Ein Wareneinsatz von 24 % ist zwischen einem mexikanischen
und einem bürgerlichen Konzept **keine gemeinsame Messlatte**.

Belastbar ist dort die **Veränderung gegenüber dem Vorjahr**: die trägt jeder Betrieb in seiner
eigenen Einheit, und Wetter, Baustellen und Feiertage treffen alle gleichzeitig. Deshalb
steht auf ⑩ die Umsatzveränderung ganz oben (als Balken je Betrieb, die Karte, wegen der es die
Seite gibt) und die absoluten Quoten darunter — auf ⑨ ist die Reihenfolge dieselbe, aber der
Vorbehalt entfällt.

### Die Lücke steht auf der Seite, nicht daneben

Der Stadtvergleich ist nur so vollständig wie die von Hand gepflegte Standortliste. Am
10.08.2026 haben **60 von 141** Betrieben eine Ortsangabe, darunter **49 von 56** im letzten
bewerteten Monat operativen — sieben laufende Betriebe fehlen also in ihrer Stadt, **ohne dass
es dort auffiele**. Genau deshalb steht unten auf ⑩ die Karte „Wer im Stadtvergleich fehlt",
und die Kopfzeile sagt bei einem Betrieb ohne Ortsangabe ausdrücklich „(keine Stadt
hinterlegt)" statt leer zu bleiben.

Zehn Städte haben mindestens zwei laufende Betriebe; Karlsruhe mit vieren ist die größte
Gruppe. Für alle anderen Betriebe ist ⑩ eine leere Seite — das ist keine Datenlücke, sondern
die Lage.

---

## Die Karte

Gewünscht ist eine Deutschlandkarte auf der Markenübersicht: alle Standorte, eingefärbt nach
der Round-Table-Gesamtampel, anklickbar bis ins Betriebsblatt, und beim Filtern auf eine
Marke nur deren Betriebe. Bei mehreren Marken in derselben Stadt ist die geografische
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
welchen Betrieb es geht, und das Emoji trägt die Ampelfarbe auch dann, wenn zwei Marker
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
Betrieb für einen Bericht nichts hat — ein geschlossener Betrieb, ein Bericht, den dieser Betrieb
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

### „Wie vollständig sind die Einkaufsdaten?" — drei Zustände statt eines Häkchens

Die Karte `wa_ladestand` zeigte bis zum 14.08.2026 zwei Zustände: `✓` oder `… lädt`. Gemessen
um 00:16, während der nächtliche Lauf arbeitete, stand `… lädt` in **allen 251 Zeilen**.

Seit Migration `0075` sind es drei:

| Anzeige | Bedeutung |
|---|---|
| `✓` | die Liste ist durch |
| `… lädt` | Rückstand aus einem früheren Lauf — es fehlen **ganze** Bestellungen |
| `⚠ kein Zugriff` | der Lieferant verweigert eine Kostenstelle dauerhaft. Es kommt nichts nach |

**Warum der dritte Zustand ein eigener Text ist und kein Ladehinweis:** „lädt" verspricht, dass
es gleich da ist. Bei einem 403 ist es nie da, und wer darauf wartet, wartet umsonst. Ob das in
Ordnung ist, sagt `mart.posten_ohne_zugriff` — bei einer fremden Kostenstelle ja, bei einem
eigenen Betrieb nicht.

Dazu die Spalte **„ohne Positionen"** neben „Positionen %". Dieselbe Aussage absolut: 99,9 %
liest man weg, „18" nicht.

### Der Round Table hat eine vierte Kachel (Migration `0080`, 14.08.2026)

Zwischen „Orange" und „Grün" steht jetzt **„Unvollständig"** — Betriebe, bei
denen mindestens eine der sechs Kennzahlen fehlt und keine der vorhandenen
auffällig ist.

**Diese Zahl lief bis dahin unter „Grün" mit.** `ampel.gesamt()` ignorierte
fehlende Signale und fiel auf grün durch: das Urteil wurde gut, weil etwas
fehlte. Seit Juli 2026 ist die Vor-Ort-Note für alle 141 Betriebe leer.

Darunter die Tabelle **„Was fehlt für ein vollständiges Urteil?"** — eine Zahl
„8 unvollständig" ohne die Liste dahinter ist ein Vorwurf ohne Adresse. Die
Tabelle sagt je Betrieb, welches der sechs Signale fehlt; die häufigste Antwort
ist die Vor-Ort-Note, und die wird über `pflege/om_einschaetzung.csv`
nachgetragen.

**Die Sortierung überall ist rot → orange → unvollständig → grün.** Unvollständig
steht vor grün, weil es mehr Aufmerksamkeit verdient: bei grün ist nichts zu
tun, bei unvollständig fehlt etwas.

## ⑫ Feiertage, Ferien, Wetter (`db_kalender`)

**Der Anlass war eine Frage ohne Antwort.** Feiertage und Schulferien lagen
seit Migration `0051` in der Datenbank, `mart.vergleichstag` rechnete jeden Tag
gegen seine vier Vorgänger — und keine einzige Karte griff die Sicht auf.
Geladen, gerechnet, nie gezeigt. Die Seite schließt das und nimmt das Wetter
mit, weil es denselben Unterbau braucht.

**Vier Reiter, weil sich die Effekte nicht addieren lassen.** Ein Feiertag im
Sommer ist auch ein warmer Tag; wer Feiertags-, Ferien- und Wettereffekt
zusammenzählt, zählt denselben Euro zweimal. Getrennte Reiter machen das
räumlich klar, eine gemeinsame Reihe hätte zur Addition eingeladen.

**Kein Monatsfilter, und das ist der wichtigste Bauentscheid der Seite.** Jede
Karte hier verdichtet über viele Tage. Ein Stichmonat ließe von 190
Christi-Himmelfahrt-Tagen genau einen übrig, und der Median einer einzigen
Beobachtung ist diese Beobachtung. Gefiltert wird über **Zeitraum, Betrieb und
Marke** — dieselbe Überlegung wie bei den Verläufen auf ③, nur konsequenter.

### Warum überall „Punkte gegen einen normalen Tag" steht

Ein einzelner Tag wird gegen den **Mittelwert** von vier Tagen gestellt. Bei
rechtsschiefen Tagesumsätzen liegt der Mittelwert über dem Median — der
typische Tag liegt also unter dem Schnitt seiner Vorgänger, ohne dass etwas
schiefgelaufen wäre. Gemessen am 20.08.2026: **−3,5 %** über 56.226 gewöhnliche
Tage.

Die Karten zeigen deshalb die Differenz zu diesem Nullpunkt, nicht den rohen
Prozentwert. **Ohne diese Korrektur läse jede Kachel die halbe Gruppe als
schwach.** Der Basiswert wird dabei unter denselben Filtern mitgerechnet wie
die Kachel selbst; ein fest verdrahteter Wert wäre bei jedem Betriebsfilter
falsch.

### Warum jede Karte auf der Tagesebene rechnet

`mart.kalendereffekt` steht fertig da und wird trotzdem von keiner Karte
gelesen. Grund: **ein Median lässt sich nicht weiterverdichten.** Der Median
einer Marke ist nicht der Median der Betriebs-Mediane. Jede Karte rechnet
deshalb mit `percentile_cont` direkt auf `mart.kalendertag_lage` bzw.
`mart.wettertag_lage`. Die fertige Effektsicht ist der Drill-Down auf
Betriebsebene, nicht die Zwischenstufe für Gruppenzahlen.

### Die einzelnen Karten

| Reiter | Karte | Warum diese Darstellung |
|---|---|---|
| Feiertage | zwei Kacheln (bester/schwächster) | Der Einstieg in zwei Zahlen. Mindestens 20 vergleichbare Tage, sonst gewinnt ein Ausreißer |
| | `kw_feiertag_tabelle` | Tabelle statt Balken: die Spannen (unteres/oberes Viertel) gehören daneben, sonst sieht ein breit streuender Wert präzise aus. Farbskala auf der Punktespalte |
| | `kw_feiertag_marke` | Gruppierte Balken, auf die sechs stärksten Feiertage begrenzt — vierzehn × vier Marken wären 56 Balken |
| | `kw_naechste_feiertage` | Die **einzige** Karte, die nach vorn schaut. Der Grund, warum jemand die Seite ein zweites Mal öffnet |
| Ferien & Wochentage | `kw_ferien_lage` / `_bundesland` | Nebeneinander, weil die Gruppenzahl klein ist und die Länderaufteilung erklärt, warum |
| | `kw_brueckentag` | Enthält die Zeile *gewöhnlicher Tag* — sie steht per Definition auf null und ist der sichtbare Nullpunkt der ganzen Seite |
| | `kw_wochentag` | **Misst absichtlich fast nichts.** Der Wochentag ist im Vergleichstag schon herausgerechnet; die Kachel zeigt, wie ein Nicht-Effekt aussieht. Ohne diesen Maßstab fehlt die Einordnung für alles andere |
| Wetter | `kw_temperatur` | Balken über Klassen, nicht Streudiagramm: der Zusammenhang ist ein umgekehrtes U, und eine Trendlinie würde ihn verstecken |
| | `kw_regen` / `kw_sonne` | Nebeneinander, gleiche Skala, gleiche Lesart |
| | `kw_streuung` | Direkt unter den Balken, weil die Streuung die Aussage relativiert. Auf 3.000 Punkte begrenzt |
| Tagesliste | `kw_tagesliste` | Das Ziel jedes Drill-Downs. Führt Ruhetage mit `Vergleichstage = 0` **mit**, statt sie wegzulassen |

### Zwei Karten auf fremden Seiten

* **`db_umsatz`** bekommt `kw_kachel_feiertagseffekt` — die Spannweite zwischen
  bestem und schwächstem Feiertag, Klick führt auf ⑫. Sie steht dort, weil die
  Frage „war das ein guter Tag" beim Umsatz aufkommt und nicht in einem
  Dashboard, das man erst suchen muss.
* **`db_datenqualitaet`** bekommt `kw_ohne_kalender`: die Betriebe mit Umsatz,
  für die kein Standort hinterlegt ist. **Regel 10** — die Wetterkacheln auf ⑫
  zeigen weniger als die ganze Gruppe, und eine Kachel, die 78 % zeigt und wie
  100 % aussieht, ist schlimmer als keine. Keine festen Zahlen im Kartentext:
  sie erledigt sich durch Nachtragen der Adressen.

### Was bewusst fehlt

**Die Ampelfarben.** Rot/Gelb/Grün sind auf dieser Seite tabu — ein roter
Neujahrsbalken läse sich als Warnung, und Neujahr ist keine. Die Farbskalen der
beiden Tabellen laufen deshalb über Rot–Weiß–Grün als *Richtungsanzeige*, nicht
als Bewertung.

**Eine Gesamtaussage.** Es gibt keine Kachel „so viel bringt der Kalender
insgesamt". Sie wäre die Addition, die der ganze Seitenaufbau vermeidet.
