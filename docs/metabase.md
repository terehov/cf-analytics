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
| Einkaufspreise über die Zeit, echte Belegpreise | `mart.einkaufspreis_monat` — löst das stillgelegte `preisentwicklung_ware` ab |
| Zahlt **dieser Betrieb** mehr als die anderen für dieselbe Ware? | `mart.einkaufspreis_betrieb` — **nur mit `vergleichbar = true` lesen**, und auch dann mit den drei Sperren aus dem Abschnitt zu Migration `0056` |
| Konkrete Bestellungen je Betrieb, inklusive Stornos | `mart.einkauf_beleg` — eine Zeile je Bestellung, `storniert` kennzeichnet statt auszublenden |
| Ist dieser Lieferant überhaupt eingeordnet? | `mart.lieferant_freigabe_stand` — die Arbeitsliste, hier fängt man an; Sortierung nach `fn_netto` selbst setzen |
| Fremdeinkauf: Volumen je Betrieb, Monat und Lieferant | `mart.fremdeinkauf` — **immer auf genau eine `quelle` filtern**, sonst Doppelzählung |
| Inventuren und bewerteter Schwund | `mart.inventur` (je Inventur), `mart.inventur_schwund` (je Betrieb und Monat), `mart.inventurposition` (je gezählte Ware) — belastbar praktisch nur bei Wilma Wunder, siehe Migration `0044`–`0048`. Gefüllt seit dem 09.08.2026 (358 Zählungen, 81.190 Positionen) |
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
| Schwächelt der Betrieb oder seine ganze Marke? | `mart.marke_vergleich` — je Monat, Betrieb und Kennzahl mit Markenmedian, Abstand und Rang |
| Liegt es am Betrieb oder am Standort? | `mart.stadt_vergleich` — dasselbe, aber gegen die Nachbarbetriebe am Ort |
| Wer steht mit wem in einer Stadt? | `mart.nachbarschaft` — die einzige belastbare Stadtangabe |
| Die Stadt als eine Zeile | `mart.stadt_schnitt_monat` — Gegenstück zu `konzept_schnitt_monat`, nur Orte mit mehr als einem laufenden Betrieb |
| Wer fehlt im Stadtvergleich? | `mart.nachbarschaft_fehlend` — Erwartung: für Betriebe mit Umsatz leer |

Jede dieser Sichten trägt einen Tabellenkommentar; Metabase zeigt ihn als Beschreibung an.
Dort steht auch, was man mit ihr **nicht** tun soll.

**Eine Ausnahme, gefunden am 12.08.2026:** der Tabellenkommentar von
`mart.einkaufspreis_betrieb` (Migration `0056`) beschreibt an drei Stellen eine andere Sicht
als die gebaute — Preisbasis, Bezugsgröße von `mehrkosten`, Bedeutung von `preis`. Wer die
Metabase-Beschreibung dieser einen Sicht gegen die Zahl hält, bekommt einen Widerspruch. Was
gilt, steht unten im Abschnitt zu `0056`.

> **Die Spalte `stadt` ist überall NULL.** Sie läuft durch `mart.umsatz_ytd`,
> `mart.round_table_monat`, `mart.ampel_bereich` und ein Dutzend weiterer Sichten, kommt aus
> `core.betrieb.stadt` und ist dort bei **allen 141** Betrieben leer — LINA liefert für
> Betriebe keine Adresse (nachgemessen 26.07.2026, erneut 10.08.2026). Wer danach gruppiert,
> bekommt keine Fehlermeldung, sondern **eine** Gruppe mit allen Betrieben darin. Die
> gepflegte Stadt steht in `mart.nachbarschaft.ort`, gespeist aus `manual.betrieb_standort`.
> Seit Migration `0049` tragen die beiden verlockendsten dieser Spalten einen
> Spaltenkommentar, der das sagt.

## Die Dashboards

Angelegt und gepflegt werden sie aus dem Repository, nicht in der Oberfläche — siehe
`metabase/` und den Abschnitt weiter unten. Drei Sammlungen:

### Drill-Down — hier fängt man an

Eine Kette, in der jeder Klick eine Ebene tiefer führt und den Filter mitnimmt.

| Ebene | Dashboard | Was man sieht | Klick führt zu |
|---|---|---|---|
| ① | **Marken** | Eine Zeile je Marke, alle Metriken, Ampeln gezählt | ② mit gesetzter Marke |
| ② | **Filialen** | Alle Betriebe der Marke über sämtliche Metriken | ③ mit gesetztem Betrieb |
| ③ | **Betrieb** | Das Betriebsblatt: Kennzahlen, Verlauf, Struktur, Personal, Ware, BWA, Einkauf & Inventur, Maßnahmen, Datenstand | das jeweilige Fach-Dashboard |
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

Dazu **Fremdeinkauf — wer liefert, obwohl er nicht darf** (`db_fremdeinkauf`, seit
12.08.2026). Eigene Seite und kein Reiter auf *Einkauf*, weil die Datenbasis eine andere
ist: *Einkauf* steht auf FoodNotify-Bestellungen, der Fremdeinkauf auf dem **Belegarchiv**.
Genau darin liegt der Punkt — wer bei einem nicht freigegebenen Lieferanten kauft,
bestellt ihn nicht über das Bestellsystem des Konzerns. Verlinkt ist sie von *Einkauf* und
vom Reiter *Einkauf & Inventur* des Betriebsblatts, jeweils über die Kachel
`fe_kachel_verweis`.

Drei Regeln gelten dort für jede Karte, und jede hat einen Anlass
(`docs/befunde-datenlage.md`, 12.08.2026):

* **Nie über `quelle` summieren.** Dieselbe Rechnung steht in FoodNotify *und* im
  Belegarchiv. Tabellen tragen die Spalte und gruppieren danach; Kacheln und Diagramme
  legen die Quelle fest, weil sie keine Spalte dafür haben.
* **Immer `wareneinkauf IS TRUE`.** Das Belegarchiv führt alle Eingangsrechnungen. Ohne den
  Filter zählen Strom, Leasing, Finanzamt und Kartengebühren als Fremdeinkauf — gemessen
  29,8 von 126,6 Mio EUR.
* **`wareneinkauf IS NULL` ist kein Befund, sondern die Arbeitsliste** und steht auf einer
  eigenen Karte. 44 Mio EUR auf 8.292 Namen unsichtbar zu lassen, wäre eine stille Kürzung
  — und die Zahl oben sähe nach einem Ergebnis aus statt nach einer Untergrenze.

Die Kachel `fe_kachel_verweis` trägt bewusst **keinen** Markenfilter: `db_einkauf` filtert
nach dem FoodNotify-Mandanten, `db_fremdeinkauf` nach dem Round-Table-Konzept. Beide Filter
heissen `marke`, und verdrahtet wird nach Namen — eine Karte mit `marke` stünde auf
*Einkauf* dauerhaft leer, ohne Fehlermeldung.

## Drei Zahlen, die man vor der ersten Auswertung kennen sollte

Am 26.07.2026 nachgemessen. Sie ändern, wie jede andere Zahl zu lesen ist.

**Nur 62 der 141 geführten Betriebe machen überhaupt Umsatz.** Die übrigen 79 liefern
206 Tage lang Umsatzberichte über 0 €. Das ist *keine* Datenlücke — die Berichte kommen an
und sind leer. Beteiligungsgesellschaften, geschlossene Betriebe, Testeinträge. Jeder
Mittelwert über „alle Betriebe" ist damit um mehr als die Hälfte verdünnt; die Arbeitsliste
steht auf ⑥ unter „Karteileichen".

**70 % des Umsatzes kommen aus dem stärksten Fünftel.** Ein Prozentpunkt bei einem großen
Betrieb wiegt mehr als eine ganze Sanierung im langen Schwanz. Das gehört in jede Priorisierung.

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
  karten-fremdeinkauf.ts Fremdeinkauf und Preisvergleich zwischen den Betrieben
  dashboards.ts         Anordnung im 24-Spalten-Raster und das Klickverhalten
  uebernehmen.ts        trägt alles nach Metabase ein
```

```bash
bun run metabase/uebernehmen.ts
```

> ⚠️ **Das ist kein Trockenlauf.** Mit `METABASE_USER` und `METABASE_PASSWORD` in der
> Umgebung — so steht es in `.env` — meldet sich das Skript selbst an und schreibt sofort
> gegen `METABASE_URL`, die Produktivinstanz. Ohne die beiden Variablen fällt es auf den
> älteren Weg zurück und startet einen Server auf `:8899`, den man im Browser öffnet und wo
> man „Übernehmen" klickt. Wer nur die Definitionen prüfen will, nimmt
> `bun test metabase/karten.test.ts` — der fasst Metabase nicht an.

Ein zweiter Lauf legt **nichts doppelt an**: jede Karte trägt ihren Schlüssel als
`[key:...]` in der Beschreibung, und danach wird zuerst gesucht. Wer eine Karte in der
Oberfläche umbenennt, verliert sie deshalb nicht — wer sie dort *inhaltlich* ändert, dessen
Änderung wird beim nächsten Lauf überschrieben. Aus derselben Idempotenz folgt, dass ein
abgebrochener Lauf nichts kaputt macht: der nächste stellt alles wieder her.

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

Neue Sichten kommen in eine **neue** Migrationsdatei. ~~`0001` bis `0006` sind angewendet und
werden nicht mehr geändert;~~ der Stand steht in `public.schema_migration`.
(Nachgemessen am 12.08.2026: angewendet sind ~~**58 Dateien bis einschließlich
`0055_lieferantenfreigabe.sql`**~~. Die Regel gilt unverändert, nur die Nummern sind
weitergelaufen — angewendet heißt eingefroren, gleich welche Nummer.)
Erneut nachgemessen am 12.08.2026, 12:29 Uhr: **59 Dateien bis einschließlich
`0056_einkaufspreis_betriebsvergleich.sql`**.

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

---

## Kalender, Marktindex, Vergleichstag, Zeitfenster (Migrationen 0051 und 0052, 11.08.2026)

Vier Sichten für vier Kennzahlenbereiche der Round-Table-Map, die als „nicht angebunden"
galten. Alle vier waren offene Daten oder vorhandene Rohdaten, keine Anfragen.

| Sicht | Beantwortet | Falle |
|---|---|---|
| `mart.betrieb_kalender` | Feiertag und Schulferien **im Bundesland des Betriebs**, je Tag | Nur Betriebe mit gepflegter PLZ — am 11.08.2026 sind das 60 von 141 |
| `mart.vergleichstag` | Kapitel 7.1: jeder Tag gegen die letzten vier gleichen Wochentage ohne Feiertag | Rechnet je Zeile vier Nachbartage nach — **immer auf Betrieb oder Zeitraum filtern** |
| `mart.markt_vergleich` | Kapitel 1.1 / 9.2: eigenes Wachstum gegen den Gastronomiemarkt | `delta_pp` vergleicht gegen die **nominale** Reihe. Real steht daneben und dreht das Vorzeichen |
| `mart.umsatz_zeitfenster` | Umsatz je selbst geschnittenem Zeitfenster, ab 2018 | **Nicht** gegen `core.zeitzonenbericht_zone` halten: LINAs Zonen brechen auf halben Stunden |

Dazu zwei Arbeitslisten mit derselben Aufgabe wie `mart.nachbarschaft_fehlend` — eine
unvollständige Auswertung, die sich als vollständig ausgibt, ist schlimmer als keine:

* **`mart.kalender_fehlend`** — Betriebe mit Umsatz im laufenden Jahr, für die kein
  Bundesland ableitbar ist. Am 11.08.2026 neun, angeführt vom umsatzstärksten Betrieb der Gruppe.
* **`mart.zeitfenster_pruefung`** — Stunden, die in keinem oder in mehreren Fenstern liegen.
  Erwartung: leer. Eine Fensterdefinition mit Loch summiert sich plausibel falsch.

**Warum real und nominal beide geführt werden.** Die Entscheidung steht aus, und sie dreht
das Ergebnis um: Mai 2026 gegen Mai 2018 ist nominal +19,4 %, real −20,2 %. Unsere Umsätze sind
nominal; wer sie gegen die reale Reihe hält, misst die Inflation mit und nennt sie Wachstum.

**Warum `ferien_abweichung` in `mart.vergleichstag` steht und nicht bereinigt wird.** Ein
Samstag in den Sommerferien gegen vier Samstage in der Schulzeit ist ein schlechter
Vergleich. Ob er verworfen wird, entscheidet der Fachbereich — wer stillschweigend
bereinigt, verliert genau die Fälle, in denen die Ferien die Erklärung sind.

---

## Lieferantenfreigabe und Fremdeinkauf (Migration 0055, 12.08.2026)

Die Erhebung „GFGH Q2 2026.xlsx" kam fast leer zurück — nachgemessen am 12.08.2026: **607 von
6.952 Preiszellen gefüllt (8,7 %)**, bei 44 der 88 Betriebsspalten stand überhaupt nichts. Statt
nachzufordern wird der Fremdeinkauf aus den Rechnungen abgeleitet; die beiden Sichten sind das
Ergebnis. Warum es drei Zustände sind und nicht zwei, und warum der Getränkefachgroßhändler je
Betrieb gepflegt wird und nicht konzernweit, steht in `entscheidungen.md`; die Tabellen dahinter
stehen in `datenmodell.md`.

| Sicht | Beantwortet | Falle |
|---|---|---|
| `mart.lieferant_freigabe_stand` | Eine Zeile je Lieferanten-Dachname: eingeordnet oder nicht, Volumen beider Quellen nebeneinander, letzter Beleg | Kennt weder `betrieb_status` noch `operativ` und hat kein `ORDER BY` |
| `mart.fremdeinkauf` | Volumen je Betrieb, Monat und Lieferant, mit der Einordnung daneben | Die Spalte `quelle` darf nicht weggruppiert werden |

**Angefangen wird mit `mart.lieferant_freigabe_stand`, nicht mit `mart.fremdeinkauf`.** Die
Volumensicht ist nur so gut wie die Pflegeliste dahinter: solange ein Lieferant nicht eingeordnet
ist, landet sein Umsatz in der Restgruppe, und die Restgruppe ist heute die Mehrheit —
nachgemessen am 12.08.2026 sind **112 von 119 Dachnamen** „nicht eingeordnet". Die Arbeitsliste
sagt, wie belastbar eine Fremdeinkauf-Karte gerade wäre. Erst abarbeiten, dann auswerten.

### Zwei Sätze, die vor jeder Karte stehen

**Die Spalte `quelle` darf nicht weggruppiert werden.** `foodnotify` und `belegarchiv` zeigen
dieselbe Rechnung, sobald sie über FoodNotify bestellt und in LINA gebucht wurde; addiert ergibt
das den doppelten Einkauf. Jede Karte filtert deshalb auf **genau eine** Quelle. Dieselbe Regel
in der Arbeitsliste: `fn_netto` und `beleg_netto` stehen nebeneinander, damit ihr Abstand sichtbar
wird, und werden nie summiert. Heute ist die Falle unsichtbar — nachgemessen am 12.08.2026 hat
`quelle = 'belegarchiv'` **0 Zeilen**, weil `core.buchungsbeleg` noch leer ist. Sie schlägt mit
dem ersten Belegarchiv-Abzug zu, und der startet beim nächsten Sync-Lauf von selbst. Wer bis dahin
ohne Quellenfilter baut, merkt den Bruch nicht an einem Fehler, sondern an einer Zahl, die sich
über Nacht verdoppelt.

**„nicht eingeordnet" ist kein Fremdeinkauf, sondern die Arbeitsliste.** Der Wert heißt: über
diesen Lieferanten hat noch niemand entschieden. Nachgemessen am 12.08.2026 in
`mart.fremdeinkauf`: 6.517.388 EUR über die ganze Historie, in den letzten zwölf Monaten
1.116.877 EUR bei 33 Betrieben und 71 Lieferanten. Darin stehen Brauereien mit Liefervertrag —
Dinkelacker Stuttgart, Höpfner Karlsruhe, Auerbräu Rosenheim — und rund ein Dutzend Winzer. Eine
Karte, die diese Gruppe „Fremdeinkauf" nennt, meldet über hundert Firmen als Befund und ist am
Tag nach der ersten Pflegerunde eine andere Karte. Fremdeinkauf ist allein
`einordnung = 'nicht freigegeben'`.

### Fallen dieser beiden Sichten

| Falle | Nachgemessen am 12.08.2026 | Was man tut |
|---|---|---|
| `einordnung = 'nicht freigegeben'` heißt im Tabellenkommentar „die Verdachtsliste" | **0 von 9.078** Zeilen tragen den Wert, über die gesamte Historie | Eine Karte darauf ist heute dauerhaft leer und sieht aus wie „kein Befund". Der Verdacht kommt vorerst aus der Arbeitsliste |
| `mart.lieferant_freigabe_stand` hat kein `ORDER BY`, obwohl ihr Kommentar „absteigend lesen" sagt | — | Sortierung in der Karte selbst setzen, nach `fn_netto` |
| Dieselbe Sicht trägt weder `betrieb_status` noch `operativ` und zählt geschlossene und verwaltende Betriebe mit | 3.385.426 EUR = **9,7 %** des Volumens stammen aus nicht operativen Betrieben | Alles, was auf laufende Betriebe zielt, aus `mart.fremdeinkauf` bauen — die trägt beide Spalten |
| Die beiden Sichten nennen für denselben Bestand verschiedene Summen: die Arbeitsliste zählt Kostenstellen ohne Betrieb mit, `mart.fremdeinkauf` filtert sie weg | `sum(fn_netto)` **35.894.104 EUR** gegen **34.766.971 EUR**, Differenz 1.127.133 EUR aus 25 Kostenstellen ohne `betrieb_key` | Beide Zahlen sind für ihre Frage richtig. Nicht nebeneinander auf ein Dashboard, ohne den Unterschied dazuzuschreiben |
| `gfgh_des_betriebs` verspricht den Getränkefachgroßhändler des Betriebs | in **9.078 von 9.078** Zeilen NULL | In der Tabellenmetadaten-Ansicht ausblenden, bis sie trägt |
| `warengruppe` bleibt in den Fremdeinkaufzeilen NULL | — | Ein Filter `warengruppe = 'getraenke'` verliert genau die Getränke-Fremdeinkaufzeilen. Stattdessen über `lieferant` filtern |

**`quelle = 'foodnotify'` ist keine Vollerhebung, und der Nenner „141" führt in die Irre.**
Nachgemessen am 12.08.2026: FoodNotify-Bestellungen der letzten zwölf Monate gibt es für 51
Betriebe. Von den 141 geführten sind aber nur **57 operativ** — der Rest ist geschlossen,
verwaltend, ohne Geschäft, inaktiv oder Test. Von den 57 haben **43** FoodNotify und **14 nicht**,
und diese 14 stehen für **30,0 % des operativen Umsatzes** (33.530.901 EUR von 111,9 Mio EUR);
zehn davon sind „Deutsche Konzepte". Der blinde Fleck ist also fast eine ganze Marke und kein
Streuverlust: eine Lieferantenkonzentration aus FoodNotify ist die Konzentration der 43. Die
Aufschlüsselung nach Status und Umsatz steht in `befunde-datenlage.md`.

---

## Einkaufspreis im Betriebsvergleich (Migration 0056, 12.08.2026)

Die andere Hälfte derselben Erhebung. „GFGH Q2 2026.xlsx" wollte je Betrieb und Produkt einen
Preis und daneben Durchschnitt, Höchst- und Tiefstpreis; zurück kamen 8,7 %. Die Zahlen stehen
längst in FoodNotify, nur ohne die Achse, nach der gefragt war: `mart.einkaufspreis_monat`
(`0041`) gruppiert nach Ware, Marke, Einheit und Monat — **ohne Betrieb und ohne Lieferant**.
`mart.einkaufspreis_betrieb` ergänzt genau diese Achse.

Eine Zeile je Ware, Gebinde, Betrieb, Lieferant, Monat **und Bereich** (`bar` / `kueche`). Der
Bereich steht nicht im Tabellenkommentar und ist der Grund für die erste der drei Sperren weiter
unten. Nachgemessen am 12.08.2026 im Fenster `monat >= '2026-04-01'`: 35.587 Zeilen, 2.896 Waren,
49 Betriebe, 4.512.053 EUR Ausgaben; über die ganze Historie 230.350 Zeilen. `betrieb_status`
und `operativ` sind da, gefiltert wird nicht (Falle 12) — geschlossene Betriebe behalten ihre Zeile
und bekommen ihre Abweichung, bilden den Maßstab aber nicht mit.

### Welche der beiden Preissichten — und warum sie verschiedene Zahlen nennen

| Frage | Sicht | Preisbasis |
|---|---|---|
| Was kostet diese Ware im Konzern, wie läuft der Preis über die Zeit? | `mart.einkaufspreis_monat` | Gebindepreis, `summe_preis / menge` |
| Zahlt **dieser Betrieb** mehr als die anderen für dieselbe Ware? | `mart.einkaufspreis_betrieb` | Preis je Basiseinheit, `summe_preis / gesamt_menge` |

Über die Zeit ist der Gebindepreis richtig: derselbe Besteller bucht dieselbe Einheit. Über
Betriebe hinweg nicht — der eine Betrieb bucht den Karton als `menge = 1`, der andere sechs Flaschen
als `menge = 6`. Gleiche Ware, gleiches Geld, Faktor 6.

**Die beiden Sichten nennen deshalb für dieselbe Ware verschiedene Preise, und das ist kein
Fehler, sondern die Preisbasis.** Nachgemessen am 12.08.2026: von 7.742 eindeutigen
Ware/Einheit/Monat-Zellen weichen **274 (3,5 %)** voneinander ab, im Extremfall um 47.432 EUR.
Nicht nebeneinander auf ein Dashboard, ohne den Unterschied dazuzuschreiben.

Und die Wahl ist schwächer belegt, als der Migrationskopf sagt. Er nennt 979 Waren, über Faktor 3
streuen 119 beim Gebindepreis gegen 67 beim Basispreis. Nachgemessen über die Grundgesamtheit,
die die Sicht tatsächlich verwendet (2.182 Waren mit mindestens vier Betrieben, ohne Zeitfilter):
**286 gegen 337** — dort ist die Basiseinheit nach dem eigenen Maßstab die schlechtere Wahl. Die
Richtung hält nur im jungen `bar`-Bestand.

### Immer auf `vergleichbar` filtern

**Ohne `WHERE vergleichbar` stehen Mengenartefakte als Preisbefunde da.** Die Spalte ist `false`,
solange weniger als drei operative Betriebe dieselbe Ware im selben Monat gekauft haben, oder
solange die Betriebe verschiedene Gebindegrößen buchen. Im Fenster ab April 2026 tragen 24.682 von
35.587 Zeilen `true`: 7.944 fallen an der Drei-Betriebe-Schwelle, 3.144 an `gebinde_uneinheitlich`,
42 an `einheit_verdaechtig`. In allen anderen Zeilen sind `abweichung_pct` und `mehrkosten` NULL,
die Zeile selbst bleibt stehen.

Zwei Nebenbedingungen:

* **Auf `vergleichbar` filtern, nicht auf die Einzelkennzeichen.** `einheit_verdaechtig` ist
  nicht `false`, sondern **NULL**, wo kein Betrieb operativ ist — 3.676 Zeilen der Sicht. Ein
  `WHERE NOT einheit_verdaechtig` verliert sie still; `WHERE vergleichbar` nicht.
* **`mehrkosten` über Betriebe *und* Waren summiert ist kein Einsparpotenzial.** Der Median
  verschiebt sich, sobald jemand günstiger einkauft. Steht so auch im Tabellenkommentar.

### Was `vergleichbar = true` heute trotzdem durchlässt

Drei gemessene Lücken, alle am 12.08.2026 im Fenster ab April 2026. Sie sind der Grund, warum
eine Karte auf dieser Sicht heute noch eine eigene Sperre in der Abfrage braucht.

**1. Der Maßstab zählt Zeilen, nicht Betriebe.** `bereich` gehört zum Korn, `betriebe_operativ`
zählt aber mit `count(*)` darüber. Ein Betrieb, der dieselbe Ware über `bar` **und** `kueche` bucht,
geht zweimal ein. 1.525 Betrieb-Zellen sind so gespalten, 1.077 von 9.519 Gruppen zählen zu hoch,
und **50 Gruppen erreichen die Drei-Betriebe-Schwelle ausschließlich durch die Doppelzählung** —
162 Zeilen, davon **156 mit `vergleichbar = true`** und einer Abweichung, die es nach der
dokumentierten Regel nicht geben dürfte. Gegenprobe in der Karte: `count(DISTINCT betrieb_key)`
je Ware/Einheit/Monat.

**2. `einheit_verdaechtig` prüft nur die teure Richtung.** Geprüft wird, ob
`preis / konzern_median` ein glattes Vielfaches ≥ 2 ist; der Spiegelfall — der Betrieb zählt Liter
statt Kartons, also `konzern_median / preis` ganzzahlig — wird nie angesehen. 79 Zeilen, **66
davon `vergleichbar = true`**, Abweichungen bis **−90,0 %**, in Summe **−37.339 EUR erfundene
„Ersparnis"**.

**3. Bei zwei Mengen-Clustern greift die Heuristik gar nicht.** Liegt der Median zwischen den
Clustern, ist kein Quotient ganzzahlig. „Captain Morgan Dark Rum 40% 1l Karton 12x1l": **jedes
Betrieb zahlt exakt 147,84 EUR je Karton**, und die Sicht meldet für die einen +84,6 % und für die
anderen −84,6 %, beide mit `vergleichbar = true` und `einheit_verdaechtig = false`. 78 solcher
Gruppen, 643 Zeilen, davon 311 vergleichbar, geflaggt nur 34. Aus ihnen stammen **−45.045 EUR von
−55.282 EUR (81 %)** aller negativen `mehrkosten` der Sicht.

Was übrig bleibt, wenn man alle drei zusätzlich sperrt — Betriebe distinct zählen, den Kehrfaktor
mitprüfen, Gruppen mit ganzzahliger Spreizung verwerfen: 24.221 der 24.682 vergleichbaren Zeilen,
und aus **+5.449 / −55.282 EUR** werden **+2.550 / −9.628 EUR**. Als Preisliste je Betrieb ist die
Sicht heute brauchbar; als Einsparpotenzial-Karte erst nach dieser Korrektur.

### Fallen dieser Sicht

| Falle | Nachgemessen am 12.08.2026 | Was man tut |
|---|---|---|
| Der Tabellenkommentar widerspricht der Sicht | Drei Stellen: „DIE PREISBASIS IST DER GEBINDEPREIS (summe_preis / menge)", „mehrkosten ist die Abweichung MAL der bezogenen Gebindezahl", „Median der Gebindepreise" | Gerechnet wird durchgehend auf der **Basiseinheit**. Der Kommentar ist falsch, nicht der Code — die Metabase-Beschreibung dieser Sicht nicht zitieren |
| `preis` ist der Preis je Basiseinheit, nicht der Kartonpreis | Zum Lesen steht `preis_je_gebinde` daneben | Spalte in der Karte entsprechend beschriften. Ein Einkäufer, der „Preis" liest, denkt an den Karton |
| `gesamt_menge` ist der Nenner und stimmt selten | `menge * gebinde_menge` trifft sie in 26 % der Positionen; **5.466** als `menge_unstimmig` markierte Positionen fließen ungeprüft in die Basis, obwohl `core.bestellposition.preis_je_einheit` (Migration `0042`) genau dafür gebaut wurde | Vor jedem Extremwert die Rohposition ansehen. „Idee Entkoffeiniert 50 Pouches A 7G" steht mit **48.400,00 EUR je kg** und `vergleichbar = true` (Februar 2026, drei Betriebe) — `mart.einkaufspreis_monat` nennt für dieselbe Ware 16,94 EUR je Gebinde. Über die ganze Sicht: 330 Zeilen mit `preis > 1.000 EUR` je Basiseinheit, **91 davon vergleichbar**, 19 Waren |
| Gruppiert wird über den Lieferanten-**Klarnamen** (Falle 13) | 162 `lieferant_key` verteilen sich auf **132** Namen; „Layer-Chemie" und „FFD - Frisch Fruchtig Delp" je 5×, „CHEFS CULINAR", „Transgourmet DE", „CF Gastro", „J.J. Darboven" je 4× | Hier ist eine **falsche Zusammenführung** möglich — anders als beim Warennamen, wo der Tabellenkommentar zu Recht nur von Untererfassung spricht |
| Untererfassung über den Warennamen | „…Karton 12x1l" und „…Karton 12X1L" sind zwei Waren mit je eigenem Betriebskreis | Erwartet und im Tabellenkommentar beschrieben. `betriebe_operativ = 1` heißt oft „andere Schreibweise", nicht „nur ein Betrieb kauft das" |
| `mehrkosten` geht gegen `ausgaben` nicht auf | `preis` ist ein Median, `ausgaben` eine Summe: in **134 von 24.682** vergleichbaren Zeilen weicht `preis * menge` um mehr als 1 % von `ausgaben` ab | Nicht als „von X EUR Ausgaben sind Y EUR zu viel" lesen. Beide Zahlen sind für ihre Frage richtig |
| Ohne Monatsfilter stellt die Sicht 2021 neben 2026 | Bestand reicht bis 2020 zurück | Immer auf Monate filtern, so wie die Excel es für Q2 2026 wollte |

**Nur FoodNotify.** Was am Bestellsystem vorbei gekauft wurde, hat hier keine Zeile. Für „zahle
ich zu viel" ist das richtig — verhandelte Preise gibt es nur bei freigegebenen Lieferanten. Wer
wissen will, **wo** überhaupt eingekauft wurde, nimmt `mart.fremdeinkauf` (`0055`); dass
FoodNotify keine Vollerhebung ist, steht im Abschnitt darüber.


---

## Nachtrag 12.08.2026: beide Sichten haben sich vor dem Commit noch geändert

**`mart.fremdeinkauf` führt zwei Zustände, nicht drei.** Der Abschnitt oben beschreibt
`nicht eingeordnet` als eigenen Zustand — den gibt es in der Sicht nicht mehr. Standard ist
`nicht freigegeben`; wer nicht auf der Freigabeliste steht und nicht der GFGH seines Betriebs
ist, gilt als Fremdeinkauf. Die neue Spalte **`grund`** sagt warum: `konzernfreigabe`,
`gfgh des betriebs`, `ausdruecklich gesperrt`, `fremder getraenkehaendler` oder
`steht nicht auf der liste`.

Für Karten heisst das: auf `einordnung = 'nicht freigegeben'` filtern liefert die
Verdachtsliste (12 Monate: 1.116.877 EUR, 71 Lieferanten, 33 Betriebe). Wer die Arbeitsliste
sehen will, filtert zusätzlich auf `grund = 'steht nicht auf der liste'`.

**`mart.einkaufspreis_betrieb` hat jetzt vier Sperren statt drei**, und die im Abschnitt
oben genannten Fallen sind behoben: die `bereich`-Doppelzählung, der umgangene
`menge_unstimmig`-Schutz und die einseitige Heuristik. Neu sind `menge_widerspruechlich` und
`spreizung_zu_gross`; `einheit_verdaechtig` gibt es nicht mehr. Die Regel bleibt dieselbe
und wird dadurch nur wichtiger: **immer auf `vergleichbar = true` filtern.**

Nachgemessen am 12.08.2026: negative `mehrkosten` von −55.282 auf −17.512 EUR gefallen.
Rest-Einschränkung: dicht unter der Dreifach-Grenze stehen weiter glatte Faktoren (150,0 und
200,0 Prozent). Belastbar ist der einstellige bis niedrig zweistellige Bereich.

---

## Materialisierte Einkaufssichten und der Drill-Down in eine Sperre (Migration 0063, 12.08.2026)

**Was sich für Kartenbauer ändert: nichts an den Namen.**
`mart.fremdeinkauf`, `mart.lieferant_freigabe_stand`, `mart.einkaufspreis_monat` und
`mart.einkaufspreis_betrieb` heissen weiter so, tragen dieselben Spalten in derselben
Reihenfolge und liefern dieselben Zeilen. Sie stehen jetzt nur auf drei
materialisierten Sichten statt direkt auf `core`:

| materialisiert | trägt | wird gelesen von |
|---|---|---|
| `mart.einkauf_kreditor_monat` | Volumen je Quelle, Betrieb, Monat, Dachlieferant | `fremdeinkauf`, `lieferant_freigabe_stand` |
| `mart.einkaufspreis_monat_basis` | Preis je Ware und Monat | `einkaufspreis_monat` → `einkaufspreis_veraenderung` |
| `mart.einkaufspreis_betrieb_basis` | Preis je Ware, Betrieb und Monat | `einkaufspreis_betrieb` |
| `mart.einkauf_betrieb_monat_basis` (0064) | Einkaufsvolumen je Betrieb und Monat | `einkauf_betrieb_monat` |
| `mart.einkauf_pruefung_basis` (0064) | auffällige Positionen mit Grund | `einkauf_pruefung` |

Aufgefrischt in `src/sync/einkauf_sichten.ts`, `CONCURRENTLY`, direkt nach
`einkaufspreisNachlauf()` — in dieser Reihenfolge, weil dort
`core.gebinde_vereinheitlichen()` die Preise korrigiert.

**Warum die Einordnung NICHT mitmaterialisiert ist.** Freigabe, GFGH und
Lieferantenart kommen aus `manual.*` und werden bei jedem Kartenaufruf frisch
gejoint. Wer im Einkauf einen Lieferanten in `manual.lieferant_art` einträgt,
sieht das Ergebnis sofort und nicht nach dem nächsten Sync. Das ist die
Trennlinie: **materialisiert wird, was aus der Quelle kommt; live bleibt, was
jemand pflegt.**

**Drei Regeln, wenn jemand diese Sichten ändert:**

1. Die *Logik* steht in der Sicht — dort ändern, wirkt sofort.
2. Die *Aggregation* steht in der materialisierten Sicht — dort ändern heisst
   `DROP MATERIALIZED VIEW ... CASCADE` und alles darüber neu anlegen. `CREATE OR
   REPLACE` gibt es für materialisierte Sichten nicht.
3. Eine neue Spalte in der Basis erscheint **nicht** von selbst oben. Die Sicht
   darüber zählt ihre Spalten auf; `CREATE OR REPLACE VIEW` darf nur anhängen.

**Neu in `mart.einkaufspreis_betrieb`: `sperre` und `gebinde_typisch`.**
`sperre` nennt, welche der vier Sperren greift („zu wenige Betriebe (unter 3)",
„Gebinde uneinheitlich", „Menge widersprüchlich", „Spreizung über Faktor 3") oder
„vergleichbar". Reisst ein Fall mehrere, steht die erste da. Die Spalte ersetzt
den CASE, der bisher in der Zählkarte stand — zwei Kopien derselben
Fallunterscheidung waren zwei Kopien zum Auseinanderlaufen.

**Der Drill-Down.** „Warum eine Ware nicht verglichen wird" ist ab jetzt eine Tür:
ein Klick auf die Spalte **Sperre** öffnet `dd_sperre` mit den Waren
(`sp_waren`) und den einzelnen Betrieben (`sp_positionen`) hinter dieser einen
Zahl. Nur die Spalte ist klickbar, nicht die Zeile — sonst navigiert ein Klick auf
„Betroffener Einkauf" weg, während man nur lesen wollte. Der Warenfilter auf
`dd_sperre` bringt einen von 300 Zeilen auf eine Ware herunter; dann steht
nebeneinander, was jeder Betrieb für dieselbe Sache gebucht hat.

---

## Betrieb, nicht Haus (12.08.2026)

Vorgabe: durchgehend, über alle Dashboards und Charts, heißt es **Betrieb**.
Ersetzt in allen Karten, Kopftexten und Spaltenüberschriften; „Ausser-Haus-Geschäft"
bleibt als Fachbegriff stehen, ebenso Betriebsnamen wie „Lehners Wirtshaus" und
„hausgenau" als Angabe zur Adressgenauigkeit. Beim Ersetzen ziehen Artikel und
Adjektive mit — „Haus" ist sächlich, „Betrieb" männlich.

Ein Wert stand **in der Datenbank**: `mart.einkaufspreis_betrieb.sperre` trug seit
0063 die Beschriftung `'zu wenige Häuser (unter 3)'`, und der Drill-Down filtert
darauf. **Migration 0065** verschiebt die Fallunterscheidung deshalb aus der
materialisierten Sicht in die Sicht darüber.

### Vier Wege, und der Kartentext ist nur einer

Nachgemessen am Abend des 12.08.2026, nachdem das Wort trotz 0065 weiter auf den
Dashboards stand:

| Weg | Wo es sichtbar wird | Wo es geändert wird |
|---|---|---|
| Kartentext | Titel, Beschreibung, Textkacheln | `metabase/` — wirkt **erst nach** `bun run metabase/uebernehmen.ts` |
| Datenwert | in der Zelle | in der Sicht darüber (0065: `sperre`; 0066: `mart.fremdeinkauf.grund`, `'gfgh des hauses'`) |
| Spaltenname | Filterfeld, Abfrage-Editor, Datenreferenz — Metabase macht aus `haeuser_am_ort` von selbst „Haeuser Am Ort" | `ALTER VIEW … RENAME COLUMN` (0066), dazu die Karten, die die Spalte lesen |
| `COMMENT ON` | Info-Fenster an Tabelle und Spalte | Migration, danach `uebernehmen.ts` |

**Der teuerste Irrtum war der erste.** Die Kartentexte lagen seit dem Nachmittag
umbenannt im Repo und waren committet — übernommen hatte sie niemand. In Metabase
stand deshalb weiter „Alle Häuser der Marke". Ein Commit ändert dort nichts.

**Ein fehlender Kommentar löscht in Metabase nichts.** 0065 hat
`mart.einkaufspreis_betrieb_basis` mit `DROP … CASCADE` neu gebaut; die abhängigen
Sichten entstanden dabei ohne ihre Kommentare (`mart.fremdeinkauf`,
`mart.lieferant_freigabe_stand`, sechs Spalten von `mart.einkaufspreis_betrieb`).
Metabase zeigte darauf weiter den Text vom letzten Sync — mit „Haus" darin, und von
der Datenbank aus nicht mehr erreichbar: ein leerer Kommentar überschreibt nichts.
0066 setzt die verlorenen Texte in der neuen Wortwahl zurück. **Wer eine Sicht mit
CASCADE neu baut, schreibt ihre Kommentare in derselben Migration wieder hin.**

**Und der Sync holt geänderte Kommentare nicht nach.** Metabase liest `COMMENT ON`
nur, wenn es eine Tabelle oder ein Feld zum ersten Mal sieht; ein `sync_schema`
zieht Spaltennamen nach, Beschreibungen nicht. `metabase/uebernehmen.ts` hat deshalb
seit dem 12.08.2026 einen letzten Schritt: es liest die Kommentare über
`/api/dataset` aus derselben Bank, an der Metabase hängt, und schreibt jede
abweichende Beschreibung an Tabelle und Feld zurück (beim ersten Lauf 38 Stück).
Nach einer Migration, die Kommentare ändert, gehört `uebernehmen.ts` also genauso
dazu wie nach einer Kartenänderung.

**Die Regel dahinter, für den nächsten Fall:** in die materialisierte Sicht gehört,
was *gerechnet* werden muss. **Beschriftungen gehören in die Sicht darüber.** Was
jemand irgendwann umbenennt, darf nicht in einer Tabelle festliegen, die man nur
mit `DROP ... CASCADE` ändern kann — sonst kostet ein Wort einen Neuaufbau über
278.054 Zeilen.

Die Migrationen 0055 bis 0064 bleiben unverändert: sie sind angewendet, und die
Datei ist das Protokoll. `docs/` dagegen ist Arbeitsmaterial und wurde am
12.08.2026 durchgehend umgestellt — was hier stehen bleibt, steht beim nächsten
Schreiben wieder in einer Karte.

---

## Zwei Sichten für den Zulauf (Migration `0069`, 13.08.2026)

Beide entstehen aus demselben Satz: **eine Quelle ohne Zulauf ist ein Fehler, kein
Normalzustand.** Am 12. und 13.08.2026 stand das Belegarchiv still, während der Lauf 269 von
269 Aufgaben als „ok" meldete. Ein Log-WARN hätte daran nichts geändert — niemand liest Logs.
Deshalb stehen `differenz` und `zustand` jetzt dort, wo auch die Zahlen stehen.

### `mart.belegarchiv_zulauf`

Eine Zeile je Betrieb und Ordner, 1.834 insgesamt. Die Arbeitsliste steht in **einer** Spalte:

| `zustand` | bedeutet |
|---|---|
| `vollstaendig` | LINAs Zählung und unser Bestand stimmen überein |
| `abzug eingereiht` | Abweichung erkannt, der Abzug steht in der Schlange |
| `abzug fehlt` | Abweichung erkannt, aber **kein** offener Posten — der Befund, auf den man sehen will |
| `gezaehlt, nicht freigegeben` | dort liegen Belege, `core.belegart.inhalt_holen` ist false |
| `nie gezaehlt` | noch keine Zählung |

`differenz` rechnet Zählstand minus Bestand. **Negativ** heißt, wir halten mehr als LINA
zählt — möglich, wenn dort ein Beleg gelöscht wurde. Auch das löst einen Abzug aus, weil die
Bedingung auf ungleich prüft und nicht auf kleiner.

Beide Zählspalten sind auf `integer` gecastet. `count(*)` ist `bigint`, und `bigint` kommt bei
node-postgres als **Zeichenkette** an — in einem Test fällt das auf, in einer Metabase-Kachel
wird daraus stillschweigend eine Textspalte, die sich nicht summieren lässt.

### `mart.inventur_abgeschnitten`

Erwartung: **leer**. Beim Anlegen standen hier neun Zeilen mit zusammen 936 fehlenden
Positionen, alle bei `geladen = 800` — der Seitengrenze von
`/api/erp/stocktakings/{uuid}/items`.

`endet_auf_seitengrenze` trennt die beiden Ursachen: `true` heißt abgeschnittene Paginierung
(ein Fehler bei uns), `false` heißt, dass FoodNotify im Kopf etwas anderes zählt als in den
Zeilen (eine Eigenart der Quelle). Ohne diese Spalte sähe beides gleich aus, und die Sicht
wäre nach der Reparatur nicht mehr von einem Datenfehler zu unterscheiden.

### Vier neue Zeilen in `mart.pruefung_uebersicht`

Die Übersicht ist die Gewohnheit, die es schon gibt („nach jedem größeren Backfill zuerst",
AGENTS.md). **Ein Wächter, der eine eigene Gewohnheit braucht, entsteht nie** — deshalb
kommen die neuen Befunde dorthin und nicht auf eine eigene Seite:

* Belegarchiv: Ordner ohne den fälligen Abzug
* Belegarchiv: seit über 36 h nicht gezählt
* Inventur: Zählung abgeschnitten
* Bestellung: Kopf ohne eine einzige Position
* Warteschlange: aufgegebene Posten

Die 36 Stunden sind bewusst großzügig: der Lauf ist täglich um 05:02, und ein einzelner
ausgefallener Lauf soll die Zeile nicht sofort rot färben. Zwei ausgefallene schon.

Keine dieser Sichten hängt bisher an einer Karte. Das ist Absicht — das Zulauf-Dashboard ist
Phase 4 des Plans, und dieser Commit stellt nur die Zahlen bereit, gegen die es gebaut wird.

## `mart.posten_aufgegeben` (Migration `0070`, 13.08.2026)

Seit dem 13.08.2026 holt der nächtliche Lauf aufgegebene Posten von selbst zurück — höchstens
dreimal. Damit zerfällt „aufgegeben" in zwei Zustände, und nur einer davon ist ein Befund:

| `zustand` | bedeutet |
|---|---|
| `wird erneut versucht` | der Lauf holt ihn zurück, solange `quelle_antwortet` true ist. **Betrieb, kein Befund.** |
| `endgueltig` | der Vorrat ist aufgebraucht. Das ist die Aussage „diese Daten sind aus der Quelle nicht zu bekommen" |

`quelle_antwortet` sagt, ob derselbe Endpunkt in den letzten 24 Stunden überhaupt einmal
geliefert hat. Steht dort false, ruht die Wiederbelebung — sonst verbrauchte ein zweitägiger
Ausfall der Gegenstelle den ganzen Vorrat, ausgerechnet bevor sie wieder da ist.

**Die Zeile in `mart.pruefung_uebersicht` zählt ausdrücklich nur die endgültigen.** Wer beide
Zustände in eine Zahl wirft, bekommt eine Kachel, die immer rot ist — und eine Kachel, die
immer rot ist, sieht sich niemand mehr an. Das ist dieselbe Lehre wie bei der
Wareneinsatz-Prüfung, die 2026 immer grün zeigte (Migration 0029), nur andersherum.

## Prüfsichten-Hygiene (Migration `0071`, 13.08.2026)

Drei Stellen, an denen die Anzeige etwas anderes sagte, als sie meint. Alle drei führen zum
selben Ergebnis: eine Kachel, die dauerhaft rot steht, sieht sich niemand mehr an — derselbe
Verlust wie eine, die dauerhaft grün steht, nur langsamer.

### `mart.belegarchiv_zulauf`: ein Zustand mehr und eine Spalte mehr

Neu ist der Zustand **`kein belegarchiv`** und die Spalte **`zaehlung_status`**.

`belegToken()` wirft ein `KeinBelegarchiv`, wenn der Baumknoten eines Betriebs keinen
einzigen Ordner führt; der Client macht `keine_daten` daraus. Solche Betriebe bekommen nie
eine Zeile in `core.belegarchiv_bestand` und stünden damit für immer auf „nie gezaehlt" — und
für immer in der 36-h-Prüfzeile.

**Nachgemessen nach dem fertigen Lauf 89 am 13.08.2026: es gibt heute keinen solchen
Betrieb.** Alle 1.974 Zählungen über alle 141 Betriebe endeten mit `ok`, auch die zehn, die
die Vollzählung vom 11.08.2026 nicht kannte. Der Zustand ist also **vorbeugend** und nicht
heilend: er greift für einen neu eröffneten Betrieb oder einen, dessen Ladenakte noch nicht
eingerichtet ist. Das gehört dazugesagt, damit niemand aus einer 0 in dieser Zeile schließt,
die Sicht sei kaputt.

`zaehlung_status` ist der Ausgang der jüngsten `la:belegzahl`-Aufgabe **je Betrieb** — nicht
je Ordner, weil das fehlende Belegarchiv eine Eigenschaft des Betriebs ist — und **nur aus
den letzten sieben Tagen**. Das Fenster ist Absicht, die Begründung steht in
`entscheidungen.md`: eine Ausnahme darf ihren Beleg nicht überleben.

Der Zustand ist eng gefasst: nur wo wir auch nichts halten und nie etwas gezählt haben. Ein
Betrieb, der sein Belegarchiv VERLIERT, steht weiter auf „abzug fehlt" und gehört angesehen.

### Zwei Zeilen in `mart.pruefung_uebersicht`, und eine liest sich anders

Die Zeile **„Belegarchiv: seit ueber 36 h nicht gezaehlt"** klammert `kein belegarchiv` aus —
in `geprueft` wie in `auffaellig`. Sie zählt jetzt nur noch Paare, für die eine Zählung
überhaupt zu erwarten ist.

Neu daneben: **„Belegarchiv: Betrieb ohne Belegarchiv"**. Ihre **Erwartung ist KONSTANZ,
nicht null** — die einzige Zeile der Übersicht, für die das gilt. Die Zahl ist eine
Eigenschaft des Bestands und kein Rückstand; interessant ist allein, wenn sie sich ändert:
nach oben heißt, ein Betrieb hat sein Belegarchiv verloren oder ein neuer ist ohne eines
angelegt worden, nach unten heißt, einer hat eines bekommen und wird ab jetzt gezählt.

Ohne diese Zeile wäre „kein Belegarchiv" ein stiller Zweig, der „nichts zu tun" bedeutet —
genau das, wovor AGENTS.md Regel 10 warnt. Ausklammern allein hätte den Fall unsichtbar
gemacht statt ehrlich.

### `mart.posten_aufgegeben`: gleiche Logik, ehrlicher Kommentar

Die Sicht ist unverändert. Ihr Kommentar nennt jetzt `config.MAX_WIEDERBELEBUNGEN` beim Namen
und den Test, der die 3 festhält (`src/config.test.ts`). Eine Sicht kann keine
Umgebungsvariable lesen; wer die Grenze ändert, ändert damit still die Bedeutung dieser
Spalte und die von `src/status.ts`. Der rote Test führt zur Sicht.

### Und was „abzug fehlt" jetzt wieder heißt

Der Sichtkommentar sagte bis dahin nicht, dass ein Abzug fehlerfrei laufen und trotzdem nichts
ändern konnte. Seit `verschwundeneEntfernen()` (im selben Deploy) löscht der Abzug, was LINA
nicht mehr führt — „abzug fehlt" heißt damit wieder, was es sagt: eine Abweichung ist gemessen
und es steht kein Posten dafür.

## `mart.bestelldetail_stand` und die achte Prüfzeile (Migration `0072`, 13.08.2026)

Bis dahin wurde jede der 66.966 Bestellungen genau einmal im Detail geholt und keine je
erneut. Die Sicht zeigt je Marke, wie frisch die Details sind — über den nicht-finalen
Bestand der letzten zwölf Monate, also genau über den Bestand, den das Auffrischen bearbeitet.

| Spalte | Bedeutung |
|---|---|
| `nicht_final` | Status weder `canceled` noch `finished` |
| `im_fenster` | davon aus den letzten 45 Tagen — die, die **jede** Nacht drankommen |
| `nie_aufgefrischt` | `detail_geholt_am IS NULL`: der Rest des Nachholaufs. **Diese Zahl muss jede Nacht fallen.** Bleibt sie zwei Nächte gleich, reiht das Auffrischen nicht mehr ein |
| `fenster_veraltet` | im Fenster und trotzdem älter als 48 h. **Erwartung 0** nach jedem Nachtlauf |

**Die Prüfzeile zählt nur das Fenster, nicht den Altbestand.** Das ist eine bewusste
Entscheidung: der Altbestand arbeitet sich über zwei Nächte ab und stünde sonst zweimal mit
fünfstelligen Zahlen in der Übersicht. Eine Kachel, die beim Einschalten rot ist, sieht sich
niemand mehr an — und dann ist auch der echte Ausfall unsichtbar. Wie weit der Nachholauf
ist, steht in `nie_aufgefrischt`, wo es hingehört.

**Beim Anlegen stand die Zeile auf 2.981 von 2.981** — dem ganzen Fenster, weil bis dahin
keine Bestellung je erneut geholt wurde. Nach dem ersten Lauf mit 0072 muss sie 0 sein.

## `mart.kostenstelle_ohne_betrieb` (Migration `0073`, 13.08.2026)

Eine Zeile je Restaurant ohne `betrieb_key`, nach Bestellvolumen sortiert. Ihr Einkauf fällt
aus **jeder** betriebsbezogenen Sicht heraus, ohne dass man es einer Zahl ansieht — die Summen
stimmen, sie stehen nur nirgends.

Das ist eine **Entscheidungsliste**, keine Fehlerliste. Die Spalte `grund` sagt, was zu tun
ist: `unsicher` braucht einen Menschen (`manual.betrieb_zuordnung.entscheidung_key` setzen,
der nächste Lauf trägt sie ein), `kein_treffer` ist eine Grenze der Quelle, `testbetrieb`
bleibt so.

**Die Prüfzeile zählt Testbetriebe und Kostenstellen ohne Bestellungen ausdrücklich nicht
mit.** Wer sie mitzählte, bekäme eine Zeile, die nie auf null geht — und die liest dann
niemand mehr. Dieselbe Überlegung wie bei „Betrieb ohne Belegarchiv" (0071) und
„endgueltig aufgegeben" (0070).

## Zwei Sichten, die unser eigenes Hinsehen messen (Migration `0074`, 13.08.2026)

`mart.nachzuegler_tiefe` und `mart.bwa_rueckbuchung` beantworten dieselbe Frage für
Tagesberichte und BWA: **wie lange bucht LINA nach?** Beide zählen echte Änderungen —
verschiedener `payload_hash` bzw. verschiedener Wert bei erneutem Abruf.

Sie sind der ungewöhnliche Fall einer Sicht, die nicht über die Daten spricht, sondern über
das Fenster, durch das wir sie ansehen. `am_rand_noch_aenderungen` ist die Spalte, auf die man
sieht: `true` heißt, dass am äußeren Rand des Abrufsfensters noch Änderungen ankommen — dann
ist es zu kurz, und was dahinter liegt, sehen wir nicht.

Die Prüfzeile „Nachzuegler: Aenderungen am Rand des Fensters" zählt **Endpunkte, nicht
Zeilen** — „zwei Endpunkte sehen zu kurz" ist die Aussage, die jemand braucht.

**Warum das hier steht und nicht in einem Kommentar:** die Zahlen, mit denen der Plan die
Fenster begründen wollte, waren Artefakte der Fenster selbst (`befunde-datenlage.md`,
13.08.2026). Eine Größe, die man nur einmal schätzt und danach nie wieder ansieht, veraltet
still. Diese hier meldet sich.

## Der Ladestand kennt drei Zustände (Migration `0075`, 14.08.2026)

`mart.einkauf_ladestand.liste_vollstaendig` hieß bis dahin „keine offene
`fn:bestellungen`-Seite". Am 14.08.2026 um 00:16 gemessen, während Lauf 90 lief, standen damit
**alle 251 Monatszeilen aller vier Marken** auf unvollständig — nicht die 60, die der Plan
erwartet hatte. Der nächtliche Lauf reiht je Kostenstelle die letzte Bestellseite ein; solange
die abgearbeitet wird, ist „offene Seite" der Regelzustand und keine Aussage.

Die Unterscheidung ist nicht „offen oder nicht", sondern **„hat ein ganzer Lauf sie nicht
weggearbeitet"** — `erstellt_am` gegen den Beginn des letzten beendeten Laufs.

| Spalte | Bedeutung |
|---|---|
| `seiten_offen` | alle offenen Seiten. Während eines Laufs normalerweise > 0 — **keine** Aussage |
| `seiten_rueckstand` | Seiten, die einen ganzen Lauf überlebt haben. **Das** ist die Aussage |
| `seiten_kein_zugriff` | dauerhaft mit 403 verweigert. Kein Ladevorgang, sondern eine Grenze |
| `ohne_positionen` | Bestellungen mit Kopf und ohne eine einzige Position, absolut |
| `zustand` | `laedt` / `kein zugriff` / `vollstaendig` — ein Wert, damit die Karte nicht rechnet |

`ohne_positionen` steht neben `positionen_pct`, weil 99,9 % wie fertig aussieht und
47 fehlende Bestellungen nicht.

**Neu daneben: `mart.posten_ohne_zugriff`.** Erwartung: nur Zeilen mit
`eigener_betrieb = false`. Ein 403 auf einer fremden Kostenstelle ist richtig; einer auf einem
eigenen Betrieb heißt, dass uns dessen Bestellungen fehlen, ohne dass etwas rot wird. Die
Prüfzeile zählt deshalb **nur die eigenen** — eine Zeile, die nie auf null geht, liest niemand
mehr (dieselbe Überlegung wie bei `0070`, `0071` und `0073`).

## `mart.quelle_zulauf` — die Sicht zu Regel 10 (Migration `0076`, 14.08.2026)

Bekommt jede Quelle noch Zulauf? Vier Zustände, und der Unterschied zwischen
zweien davon ist der ganze Punkt:

| `zustand` | Bedeutung |
|---|---|
| `ok` | Zulauf innerhalb der erwarteten Kadenz |
| `stumm` | seit länger als `kadenz_stunden` keine Zeile mehr |
| `nie` | es ist noch nie eine Zeile entstanden |
| `nicht erwartet` | liefert bewusst nichts, **mit** Begründung in `bemerkung` |

**Auf `wird_noch_gefragt` sehen, nicht nur auf `zustand`.** `false` heißt, der
Importer holt diese Quelle gar nicht mehr ab — ein Baufehler, und genau der vom
12.08.2026. `true` bei fehlendem Zulauf heißt, die Quelle selbst liefert nichts;
das kann in Ordnung sein (keine Inventuren, keine neuen Belege).

Zwei Prüfzeilen, nicht eine: „Quelle ohne Zulauf in ihrer Kadenz" und „Quelle
wird nicht mehr abgefragt". Gezählt werden nur die **erwarteten** — die bewusst
stillen stehen in der Sicht und in keiner Zahl. Eine Prüfzeile, die nie auf null
geht, liest niemand mehr.

**Die Kadenzen sind großzügig gewählt und je Quelle begründet**
(`src/sync/quellen.ts`): 36 h für alles Tägliche, 8 Tage für alles, was nur bei
Bedarf Zeilen liefert (Belegabzug, Inventuren), 35 Tage für Momentaufnahmen.
Eine Schwelle, die bei jedem normalen Schwanken ausschlägt, wird abgeschaltet;
eine, die nie ausschlägt, wird nicht gelesen. Beides ist derselbe Fehler.

## Drei Sichten zu Datenqualität und Sparten (Migration `0077`, 14.08.2026)

* **`mart.hauptsparte_abdeckung`** — Gesamtumsatz gegen die Summe der Sparten,
  je Monat. `nicht_aufteilbar_pct` ist die Zahl: sie stand vor dem 14.08.2026
  bei 31,8 %, weil zwei von zehn Sparten geholt wurden. Die Gesamtzeile
  (`hauptsparte_key IS NULL`) wird **nicht** durch die Summe der Sparten
  ersetzt — die Differenz ist genau die Aussage.
* **`mart.belegdatum_ausreisser`** — Belege, deren Belegdatum mehr als ein Jahr
  nach ihrem eigenen Upload lag. Sie stehen mit `beleg_datum = NULL` in `core`
  und fallen damit aus allen datumsbezogenen Sichten. **Erwartung ist Konstanz,
  nicht null:** der Rohwert bleibt erhalten, die Zeile bleibt stehen. Wächst
  sie, liefert LINA neue Ausreißer.
* **`mart.inventur_schwund`** rechnet seit `0077` nicht mehr mit Positionen, die
  `mart.inventurposition` selbst `unplausibel` nennt (über 50.000 € je
  Position). Was herausfiel, steht in `positionen_unplausibel` und
  `wert_unplausibel`.

**Die gemeinsame Regel:** was aus einer Summe herausgerechnet wird, bekommt eine
eigene Spalte oder eine eigene Sicht. Eine Bereinigung ohne Anzeige ist derselbe
stille Zweig wie der Fehler davor — und der Befund von übermorgen.
