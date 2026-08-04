# Metabase

## Der Grundsatz

**Metabase soll nur `mart` sehen müssen.** Alles dort ist so geschnitten, dass eine naive
Summe ein richtiges Ergebnis liefert und die Namen schon dabeistehen. Wer in `core` joinen
muss, um eine Frage zu beantworten, hat eine Lücke in `mart` gefunden — dann gehört dort
eine Sicht hin, nicht eine gespeicherte SQL-Frage in Metabase.

Der Grund ist nicht Ästhetik. Die Fallen in diesen Daten sind still: der Umsatzbericht
enthält Gesamt- und Hauptspartenzeilen in derselben Tabelle, der Wareneinsatzansatz gilt
nur für einen Zeitraum, ein Betrieb kann in mehreren Konzepten hängen. Jede davon
produziert eine plausibel aussehende falsche Zahl. In `mart` sind sie ausgeräumt.

## Einrichtung

### Schemata einschränken

Admin → Datenbanken → *Lina* → **Schemata**: nur diese synchronisieren.

```
core, manual, ampel, mart
```

Ausdrücklich **nicht**:

| Schema | Warum nicht |
|---|---|
| `part` | Enthält ausschließlich Partitionskinder. Über hundert Tabellen, die alle `artikelverkauf_tag_2023_07` heißen und nie direkt abgefragt werden — die Elterntabelle in `core` liest sie mit. |
| `raw` | Die Versicherung. JSONB-Blobs, für Auswertungen wertlos, im Umfang das Größte, was hier liegt. |
| `sync` | Betriebszustand des Importers. Was man davon sehen will, steht in `mart.sync_status` und `mart.backfill_fortschritt`. |

Ohne diese Einschränkung zeigt Metabase rund 150 Tabellen an, davon etwa 110 ohne jede
fachliche Bedeutung.

### Tabellen in `core` ausblenden

`core` bleibt synchronisiert, weil die Fremdschlüssel von dort kommen — Metabase liest sie
aus dem Katalog und bietet daraufhin von selbst den Sprung vom Artikelverkauf zum Betrieb
und zum Artikel an. Für die Suche kann man `core` trotzdem auf **„Nur in Detailansichten"**
stellen: Admin → Tabellenmetadaten → Schema `core` → Sichtbarkeit.

## Wo man anfängt

| Frage | Sicht |
|---|---|
| Round Table, Ampeln, Maßnahmenbedarf | `mart.round_table_monat` — nach `monat` filtern |
| Marken nebeneinander, Ampelverteilung | `mart.konzept_schnitt_monat` — nach `monat` filtern, Prozente sind Mediane |
| Umsatzentwicklung je Betrieb oder Marke | `mart.umsatz_tag` |
| Speisen gegen Getränke | `mart.umsatz_tag_sparte` |
| Stoßzeiten, Tagesverlauf | `mart.umsatz_stunde`, `mart.umsatz_zeitzone` |
| Artikel, Renner und Penner, Deckungsbeitrag | `mart.artikelverkauf` |
| Sortiment nach Warengruppe | `mart.deckungsbeitrag_warengruppe` |
| Einkaufspreise über die Zeit | `mart.preisentwicklung_ware` |
| Was bringen die Marketingaktionen? | `mart.aktionsumsatz_monat` — mit Anteil am Gesamtumsatz |
| Welche Aktionen gibt es, laufen sie noch? | `mart.aktion` — hinterlegte gegen tatsächliche Laufzeit |
| BWA-Kennzahlen, jüngster Stand | `mart.kennzahlen_aktuell` |
| Wer hängt bei der BWA hinterher? | `mart.bwa_rueckstand` — „nie gebucht" ist kein Rückstand |
| Stimmen die Zahlen? | `mart.pruefung_uebersicht` |
| Läuft der Import? | `mart.sync_status`, `mart.backfill_fortschritt` |
| Fehlt einem Betrieb die BWA-Brücke? | `mart.betrieb_ohne_lina_id` — Erwartung: leer |
| Ampeln über Bereiche hinweg zählen | `mart.ampel_bereich` — Langformat, eine Zeile je Bereich |
| Umsatz kumuliert, Vorjahresvergleich | `mart.umsatz_ytd` |
| Wer hat sich verschlechtert? | `mart.round_table_trend` |
| Warum steht die Ampel auf rot? | `mart.ursachen_analyse` — nur so gut wie ihre Pflege |
| Maßnahmen-Tracking | `mart.massnahme` |
| Personalkosten und Effektivität je Bereich | `mart.personalkosten` |
| Sind die Zahlen dieses Betriebs überhaupt beurteilbar? | `mart.datenstand` |

Jede dieser Sichten trägt einen Tabellenkommentar; Metabase zeigt ihn als Beschreibung an.
Dort steht auch, was man mit ihr **nicht** tun soll.

## Die Dashboards

Angelegt und gepflegt werden sie aus dem Repository, nicht in der Oberfläche — siehe
`metabase/` und den Abschnitt weiter unten. Drei Sammlungen:

### Drill-Down — hier fängt man an

Eine Kette, in der jeder Klick eine Ebene tiefer führt und den Filter mitnimmt.

| Ebene | Dashboard | Was man sieht | Klick führt zu |
|---|---|---|---|
| ① | **Marken** | Eine Zeile je Marke, alle Metriken, Ampeln gezählt | ② mit gesetzter Marke |
| ② | **Filialen** | Alle Betriebe der Marke über sämtliche Metriken | ③ mit gesetztem Betrieb |
| ③ | **Betrieb** | Das Betriebsblatt: Kennzahlen, Verlauf, Struktur, Personal, Ware, BWA, Maßnahmen, Datenstand | das jeweilige Fach-Dashboard |
| ④ | **Zeiträume vergleichen** | Zwei frei wählbare Zeiträume nebeneinander | ③ |
| ⑤ | **Standorte vergleichen** | Mehrere Betriebe über alle Metriken, Verlauf, Tagesprofil, Spartenmix | ③ |

Auf ① sind die Prozentwerte **Mediane**, und die Ampeln werden **gezählt statt gemittelt** —
der Mittelwert zweier Ampeln ist keine Ampel. Der Rückweg ist immer, den Filter oben zu
löschen.

### Round Table — die Excel-Ablösung

`JULI_Round_Table_Ampelsystem.xlsx`, Blatt für Blatt:

| Excel-Blatt | Dashboard |
|---|---|
| `00_Dashboard`, `Eingabe` | Round Table — Übersicht |
| `Trend_2Monate`, `Ampelhistorie` | Round Table — Trend und Ampelhistorie |
| `Ursachenanalyse`, `Massnahmen` | Round Table — Ursachen und Maßnahmen |
| `Regeln` (die offene Schwellenfrage) | Round Table — Regelwerk-Vergleich |

Zwei Dinge sind bewusst **anders** als im Excel:

* Es gibt eine Kachel **„Ohne Urteil"**. Im Excel fiel ein Betrieb ohne BWA unsichtbar unter
  den Tisch und sah aus wie ein Betrieb ohne Befund. Am 26.07.2026 waren das 72 von 141.
* Das Blatt `Ampelhistorie` entfällt ersatzlos. Dort musste man zum Monatsabschluss „Werte
  kopieren und als Werte einfügen"; im Postgres ist die Historie ohne Zutun da.

Die bekannten Excel-Fehler (`#REF!`, der Zeilenversatz in `K6`) sind damit gegenstandslos.

Dazu zwei Seiten, die im Excel keine Entsprechung haben, weil es für 22 Betriebe einer
Marke gebaut war:

| Ebene | Dashboard | Die Frage dahinter |
|---|---|---|
| ⑥ | **Portfolio und Potenzial** | Wo steckt der Umsatz, wovon hängt die Gruppe ab, was kostet der Abstand zum Mittelfeld |
| ⑦ | **Muster im Geschäft** | Wochenrhythmus, Stabilität, und ob Umsatzveränderung von Gästen oder vom Bon kommt |

### Betrieb — die Fachberichte

Umsatz-Entwicklung, Umsatz-Struktur, Personal, Warenwirtschaft, BWA — und
**Datenqualität und Import**, die Seite, die man aufmacht, bevor man einer anderen glaubt.

## Drei Zahlen, die man vor der ersten Auswertung kennen sollte

Am 26.07.2026 nachgemessen. Sie ändern, wie jede andere Zahl zu lesen ist.

**Nur 62 der 141 geführten Betriebe machen überhaupt Umsatz.** Die übrigen 79 liefern
206 Tage lang Umsatzberichte über 0 €. Das ist *keine* Datenlücke — die Berichte kommen an
und sind leer. Beteiligungsgesellschaften, geschlossene Häuser, Testeinträge. Jeder
Mittelwert über „alle Betriebe" ist damit um mehr als die Hälfte verdünnt; die Arbeitsliste
steht auf ⑥ unter „Karteileichen".

**70 % des Umsatzes kommen aus dem stärksten Fünftel.** Ein Prozentpunkt bei einem großen
Haus wiegt mehr als eine ganze Sanierung im langen Schwanz. Das gehört in jede Priorisierung.

**Die Personalquote reicht von 0 % bis 1132 %.** Der Extremwert ist „Enchilada Bremen" —
1109 % bei 0 € Umsatz, also eine Division durch fast nichts. Deshalb rechnen alle
Markenschnitte hier mit **Medianen**, nie mit Mittelwerten.

## Wenn eine Visualisierung nicht passt

Die Regeln, nach denen die Diagrammtypen hier gewählt sind — sie haben alle einen Anlass:

* **Keine zwei Y-Achsen.** Euro und Prozent in einem Bild lassen sich beliebig
  gegeneinander verschieben und erfinden eine Beziehung, die in den Daten nicht steht.
  „Umsatz je Monat" und „Veränderung zum Vorjahr" sind deshalb zwei Karten.
* **Balkendiagramme sind gekappt.** 69 Betriebe nebeneinander ergeben einen Balkenwald mit
  überlappenden Namen. Diagramme zeigen die Top 20, die vollständige Reihe steht in einer
  Tabelle daneben — nicht statt ihrer.
* **Lange Namen laufen waagerecht** (`row` statt `bar`). Betriebsnamen wie „Alte Post Aachen
  Gaststättenbetriebs GmbH" sind senkrecht nicht lesbar.
* **Ab etwa sieben Klassen eine Tabelle.** Benachbarte Farbklassen verwischen, und 69 Zeilen
  liest man ohnehin, statt sie zu überfliegen.
* **Ampeln werden gezählt, nicht gemittelt.** Der Mittelwert zweier Ampeln ist keine Ampel.

## Dashboards ändern

Nicht in der Oberfläche, sondern im Repository:

```text
metabase/
  gemeinsam.ts          Monats- und Zeitraum-Ausdrücke, die sich alle Karten teilen
  karten-drilldown.ts   Ebenen ① bis ⑤
  karten-round-table.ts die Excel-Ablösung
  karten-fach.ts        Umsatz, Struktur, Personal, Ware, BWA, Datenqualität
  dashboards.ts         Anordnung im 24-Spalten-Raster und das Klickverhalten
  uebernehmen.ts        trägt alles nach Metabase ein
```

```bash
bun run metabase/uebernehmen.ts     # startet auf :8899
# dann http://localhost:8899/ im Browser öffnen und "Übernehmen" klicken
```

Ein zweiter Lauf legt **nichts doppelt an**: jede Karte trägt ihren Schlüssel als
`[key:...]` in der Beschreibung, und danach wird zuerst gesucht. Wer eine Karte in der
Oberfläche umbenennt, verliert sie deshalb nicht — wer sie dort *inhaltlich* ändert, dessen
Änderung wird beim nächsten Lauf überschrieben.

Der Umweg über `:8899` hat einen Grund: Metabase schickt `connect-src 'self'`, seine eigene
Seite darf also nichts von außen holen. Der Server unter `:8899` liefert deshalb die Seite
*und* reicht `/api/*` an Metabase weiter; die Anmeldung kommt vom Browser selbst, weil
Cookies je Host und nicht je Port gelten. Es entsteht kein zusätzlicher Schlüssel.

**Beim Umzug nach Hetzner:** `site-url` in Metabase auf die künftige Domain setzen (Admin →
Allgemein). Sie bestimmt, wohin Drill-Down-Klicks und Links in Abo-Mails zeigen; steht sie
falsch, führt jeder Klick ins Leere. Aktuell: `http://localhost:3000`.

## Was Metabase nicht kann, und was stattdessen da ist

**Tabellenwertige Funktionen.** `mart.round_table(monat, regelwerk)` lässt sich im
Abfrage-Editor nicht auswählen — dafür bräuchte es jedes Mal eine SQL-Frage mit Parameter.
Deshalb gibt es `mart.round_table_monat` als Sicht über alle Monate, fertig bewertet mit
dem Standardregelwerk. Die Funktion bleibt für den Fall, dass jemand die
betriebsindividuellen LINA-Schwellen braucht; den Unterschied zeigt
`mart.round_table_vergleich()`.

Wer das Regelwerk in Metabase umschaltbar haben will, baut eine SQL-Frage mit einem
Feldfilter auf `mart.regelwerk` — die Sicht existiert genau dafür.

**Beziehungen über Sichten.** Metabase erkennt Fremdschlüssel nur zwischen Tabellen, nicht
zwischen Views. Das ist der Grund, warum die `mart`-Sichten die Namen selbst mitbringen,
statt Schlüssel zum Weiterjoinen anzubieten.

## Fallen, die in `mart` bereits ausgeräumt sind

Der Vollständigkeit halber, falls doch jemand direkt auf `core` geht:

* **`core.umsatzbericht_tag`** enthält Gesamtwerte (`hauptsparte_key IS NULL`) **und**
  Hauptspartenwerte. Eine Summe über alles ergibt den doppelten Umsatz.
* **`core.artikel`** ist der Verkaufskatalog, **`core.artikelverkauf_tag`** sind die
  Verkäufe. Die ähnlichen Namen stehen im Tabellenverzeichnis direkt untereinander.
* **`core.artikel.fixer_we`** ist der **heutige** Wareneinsatzansatz. Für einen vergangenen
  Monat gilt `core.artikel_stand_zeitraum`.
* **`core.betrieb_konzept`** ist n:m. Ein Markenschnitt darüber zählt mehrfach zugeordnete
  Betriebe mehrfach. Dafür ist `mart.konzept_zuordnung.hauptkonzept` da.
* **`core.kennzahlen_monat`** ist append-only mit `abgerufen_am` im Schlüssel. Ohne
  `DISTINCT ON` bekommt man jede Nachbuchung als eigene Zeile. Fertig:
  `mart.kennzahlen_aktuell`.

## Wer eine `mart`-Sicht ergänzt

Vier Regeln, und alle vier haben einen konkreten Fehler als Anlass.

**1. Auf `mart.round_table_basis` aufsetzen, nicht die BWA-Logik neu ableiten.**
Die Sicht liefert eine Zeile je aktivem Betrieb und Monat mit allen Rohgrößen — Umsatz,
Vorjahr, Veränderung, die drei BWA-Quoten, Bewertung, OM-Score — und dazu `bwa_monat`, aus
welchem Monat die BWA-Werte stammen. `mart.round_table_monat` und `mart.round_table()`
setzen bereits darauf auf; alles Weitere (Ampeln im Langformat, Trend, YTD) gehört ebenfalls
dorthin. Sonst liegt dieselbe Regel an fünf Stellen und zerfällt bei der ersten Korrektur.

**2. „Gebucht" heißt: irgendein Wert ungleich null.**
`getKennzahlen` liefert immer das ganze Jahr, ungebuchte Monate als `0,00` — nicht als
`NULL`. Wer `mart.kennzahlen_aktuell` direkt joint und nur auf `IS NOT NULL` filtert, holt
sich diese Monate zurück, und weil sie die jüngsten sind, gewinnen sie. 0 % Personalkosten
ist „niedriger ist besser" und damit grün. Gemessen am 26.07.2026: September bis Dezember
standen für alle 131 Betriebe auf grün. Die Bedingung lautet:

```sql
HAVING count(*) FILTER (WHERE wert_absolut IS NOT NULL AND wert_absolut <> 0) > 0
```

**3. Keine Zukunftsmonate herausfiltern — sie entstehen gar nicht mehr.**
Aus demselben Grund enthielt `mart.round_table_monat` Zeilen für August bis Dezember 2026.
Seit dem 26.07.2026 leitet die Sicht ihre Monatsliste aus POS-Umsatz und *gebuchten*
BWA-Monaten ab. Ein `WHERE monat <= current_date` im Dashboard ist damit überflüssig — und
wäre in einer wiederhergestellten Datenbank ohnehin sofort falsch.

**4. `mart.kennzahlen_aktuell` führt Euro und Prozent zusammen.**
Beide Spalten sind gefüllt. Bis zum 26.07.2026 war das nicht so: die Sicht behielt per
`DISTINCT ON` nur die später geholte der beiden Zeilen und warf die andere Wertspalte weg.
Wer gegen den alten Stand gebaut hat, rechnet jetzt mit anderen Zahlen.

**5. Ein Zeitfilter muss auf der Spalte liegen, die partitioniert ist — nicht in einer
Unterabfrage.** Am 01.08.2026 stand in der Karte „Deckungsbeitrag je Warengruppe":

```sql
WHERE d.monat IN (SELECT DISTINCT monat FROM mart.artikelverkauf WHERE {{zeitraum}})
```

Rechnerisch richtig, und trotzdem der Grund für einen Abbruch nach zwei Minuten: der Zeitraum
wirkt nur in der **inneren** Abfrage. Die äußere Sicht aggregiert vorher die gesamte Historie
und filtert erst danach — 111 Partitionsscans statt der drei gebrauchten. Wer einen Zeitraum
setzt, muss ihn auf `geschaeftstag` der Basissicht legen. Ausführlich in `fehlerkatalog.md`.

Neue Sichten kommen in eine **neue** Migrationsdatei. `0001` bis `0006` sind angewendet und
werden nicht mehr geändert; der Stand steht in `public.schema_migration`.

## Tempo

`mart.artikelverkauf` liegt bei rund 20 Millionen Zeilen im Jahr — Stand 01.08.2026 sind es
**27,5 Millionen Zeilen in 108 Monatspartitionen ab Januar 2018, 3,8 GB.** Die Tabelle
darunter ist monatlich partitioniert — **wer nach `geschaeftstag` filtert, liest nur die
betroffenen Monate.** Ohne Zeitfilter wird die ganze Historie gelesen. Beim Anlegen einer
Frage auf dieser Sicht also zuerst den Zeitraum setzen, dann gruppieren.

Für alles andere ist die Datenmenge unkritisch: der Umsatzbericht sind ~150.000 Zeilen im
Jahr, die BWA ~8.000.

### Die eine materialisierte Sicht

`mart.deckungsbeitrag_warengruppe` ist seit dem 01.08.2026 **materialisiert** — als bislang
einziges der `mart`-Objekte. Sie aggregiert die 27,5 Millionen Zeilen auf rund 174.000, und
das Ergebnis ändert sich genau einmal je Importlauf; als reine Sicht wurde es bei jedem
Kartenaufruf neu gerechnet.

Zwei Dinge folgen daraus:

* **Die Zahlen sind so alt wie der letzte Refresh.** Der läuft im Nachlauf jedes Sync-Laufs
  (`src/sync/deckungsbeitrag.ts`). Wie alt genau, steht in `mart.deckungsbeitrag_stand` —
  diese Frage soll beantwortbar sein, ohne jemanden zu fragen.
* **Wer auf ein großes Aggregat aus `artikelverkauf` stößt, das keinen Zeitfilter haben
  kann, setzt darauf auf statt auf die Rohsicht.** Der Musterfall war
  `mart.pruefung_wareneinsatz`: keine Zeitraumfilterung möglich, also nie Pruning — über
  die materialisierte Sicht fiel sie von 61,7 s auf 0,04 s bei identischem Ergebnis.
  (Die Sicht selbst ist seit Migration `0029` stillgelegt, aus fachlichen Gründen; das
  Muster gilt unverändert.)

Von Hand auffrischen:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mart.deckungsbeitrag_warengruppe;
```

`CONCURRENTLY`, damit niemand währenddessen vor einem sperrenden Dashboard sitzt. Der dafür
nötige eindeutige Index liegt in Migration `0027`. Ein Refresh dauert rund 145 Sekunden.

## Berechtigungen

`manual` ist das einzige Schema, in das geschrieben wird — Maßnahmen, OM-Einschätzungen,
Ursachen. Metabase kann das nicht; v1 läuft über CSV-Upload, später über eine kleine
Eingabemaske. Der Metabase-Datenbankbenutzer braucht deshalb nur Lesezugriff.
