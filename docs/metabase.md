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
| Läuft der Import? | `mart.sync_status`, `mart.backfill_fortschritt` — seit `0116` mit `ableitungen_bis` (wann die Auswertungen frisch waren) und `nachladen_offen` (was der Backfill noch vor sich hat) |
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

> **Seit dem 13.09.2026: keine neue `mart`-Sicht ohne Körnung.** Der Kommentar muss
> ausschreiben, wovon die Sicht eine Zeile führt — „eine Zeile je Betrieb und Monat". Der
> Grund ist gemessen: von 188 Kommentaren trugen 114 ein Warnwort, aber nur **23** ihre
> Körnung. Genau die braucht aber jeder, der summiert, zuerst: `mart.umsatz_tag` darf man
> summieren, `mart.umsatz_tag_sparte` nur je Sparte, `mart.round_table_monat` gar nicht.
>
> Gepflegt wird sie in `mcp.sicht.koernung`; `mcp.koernung_in_kommentare()` hängt sie an den
> Tabellenkommentar an, damit Metabase und Postico sie ebenfalls zeigen. Fehlende stehen in
> `mcp.koernung_fehlend`. Siehe `docs/datenmodell.md`, Schema `mcp`.

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

Die Zeile **„Belegarchiv: Zaehlung ueberfaellig (Takt je Freigabe)"** (bis `0099`: „seit ueber 36 h nicht gezaehlt"; seit dem gestaffelten Takt vom 01.09.2026 misst sie 10 Tage fuer freigegebene und 36 fuer nie geladene Belegarten) klammert `kein belegarchiv` aus —
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

## Zwei Yext-Sichten (Migration `0078`, 14.08.2026)

* **`mart.betrieb_ohne_yext`** — Betriebe ohne Zuordnung. **Erwartung: keine
  Zeile mit `status = 'operativ'` UND `macht_umsatz = true`.** Alles andere ist
  in Ordnung: geschlossene Betriebe, Holdings und Testeinträge haben zu Recht
  keine Yext-Entität, und sie mitzuzählen ergäbe eine Prüfzeile, die nie auf
  null geht.
* **`mart.yext_abgleich`** — wann die drei Yext-Aufgaben zuletzt liefen
  (täglicher Lauf, Vollabgleich, Zuordnung). Sie beantwortet die Frage, die man
  dem Bestand nicht ansieht: `core.bewertung_stand` sah am 14.08.2026
  vollständig aus (25 Monate, 2.819 Zeilen), war aber seit dem 03.08. nicht mehr
  nachgezogen worden.

**Die Prüfzeile zu `eintraege_live`** ist die Gegenprobe zu einem Tippfehler mit
vier Monaten Wirkung: die Spalte stand in allen 1.497 Zeilen auf NULL, weil
`POWERLISTINGS_LIVE` angefordert und `LISTINGS_LIVE` gelesen wurde. Eine leere
Spalte hinter einer grünen Ampel fällt sonst niemandem auf.

## Kalender und Vergleichstag (`0084`, `0085`)

**`mart.vergleichstag_basis` ist materialisiert und wird nachts aufgefrischt**
(`src/sync/vergleichstag.ts`, gemessen 40,9 s über 443.304 Zeilen). Die alte
Sicht `mart.vergleichstag` bleibt als dünne Hülle darüber bestehen — sie
rechnete bis dahin je Zeile vier Nachbartage nach und war nur mit Filter
benutzbar. Genau deshalb hatte sie zwischen `0051` und `0084` **keine einzige
Karte**: geladen, gerechnet, nie gezeigt.

**Vier Regeln für Karten auf diesen Sichten:**

1. **Immer auf `vergleichstage = 4` filtern.** Ein Vergleich aus einem Tag ist
   keiner, und `vergleichstage = 0` ist häufiger als man denkt (17,6 % der
   Zeilen, überwiegend dauerhafte Ruhetage).
2. **Der Nullpunkt liegt bei −3,5 %, nicht bei 0.** Ein einzelner Tag wird
   gegen den *Mittelwert* von vier Tagen gestellt; bei rechtsschiefen
   Tagesumsätzen liegt der darüber. Karten zeigen deshalb
   `median_gegen_basis_pp`, nicht nur `median_pct` — oder stellen die Zeile
   *gewöhnlicher Tag* daneben.
3. **Einen Median nicht weiterverdichten.** Der Median über „alle Betriebe der
   Marke" ist nicht der Median der Betriebs-Mediane. Karten mit Marken- oder
   Zeitraumfilter rechnen auf `mart.kalendertag_lage` mit `percentile_cont`;
   `mart.kalendereffekt_gruppe` ist die fertige Gruppenzahl, richtig gerechnet.
4. **Die drei Effekte nicht addieren.** Feiertag, Ferienlage und Wetter stehen
   *nebeneinander*, nicht gegeneinander verrechnet. Ein Feiertag im Sommer ist
   auch ein warmer Tag.

**`kalender_quelle` gehört in jede Karte, die nach Betrieb aufteilt.**
`bundesweit` heißt: kein gepflegter Standort, nur die neun bundesweiten
Feiertage, keine Schulferien. Das betrifft 81 der 141 Betriebe, davon neun mit
laufendem Umsatz (22 %). Eine Kachel, die 78 % der Gruppe zeigt und wie 100 %
aussieht, ist schlimmer als keine — die Arbeitsliste dazu ist
`mart.kalender_fehlend`.

**`mart.pruefung_kalender` steht bewusst als eigene Sicht** und wird in
`mart.pruefung_uebersicht` mit einer einzigen `UNION`-Zeile eingehängt. Grund:
jede Migration, die eine Prüfzeile ergänzt, erzeugt `pruefung_uebersicht`
komplett neu — arbeiten zwei Sessions parallel, überschreibt die später
angewendete Migration die Zeilen der früheren still. Als eigene Sicht kostet
eine solche Kollision eine Zeile statt drei Prüfungen.

**`mart.pruefung_materialisierung` (`0091`) folgt demselben Muster** und steht
über `mart.materialisierung_stand`: eine Zeile je materialisierter Sicht, mit
der Frage, ob sie so frisch ist wie der letzte Lauf. Die zweite Prüfzeile
vergleicht die Zuordnung Sicht → Nachlauf gegen `pg_matviews` — wer eine neue
materialisierte Sicht anlegt und den Refresh vergisst, sieht es am nächsten
Morgen. Der Vergleichstag steht dort mit drin und hat seit `0084` zusätzlich
seine eigene Zeile in `mart.pruefung_kalender`; wer die Sicht das nächste Mal
ohnehin neu erzeugt, kann sie dort streichen.

**„So frisch wie der letzte Lauf" heißt seit `0116`: aufgefrischt nach dem
Tagesgeschäft.** Der Lauf endet seitdem erst nach dem Nachladen (Phase C),
Stunden nach den Refreshes; gegen `beendet_am` stünde jede Sicht abends auf
„veraltet". Bezug ist `sync.lauf.tagesgeschaeft_bis`, für den Wetter-Merker
der Laufbeginn — der stand vorher seit `0111` jeden Tag grundlos auf
„veraltet" (`fehlerkatalog.md`, 23.09.2026). Die Spalte `letzter_lauf` zeigt
weiter das Laufende.

## Wetter (`0086`, `0087`)

**`mart.wetter_tag` führt zwei Verdichtungen je Tag**, und beide sind auf den
**Geschäftstag** gerechnet — der beginnt um 08:00 Berliner Zeit, nicht um
Mitternacht. `fenster_*` sind die ersten 16 Stunden (08–24, Entscheidung E2,
99,5 % des Umsatzes), `tag_*` ist der volle Geschäftstag. Karten zeigen das
Fenster; der Ganztagssatz steht daneben, damit die Wahl überprüfbar bleibt.

**Drei Regeln für Wetterkarten:**

1. **Die Sonnenklasse ist relativ, Temperatur und Niederschlag sind absolut.**
   Ein absoluter Sonnenanteil im Fenster 08–24 misst die Jahreszeit: im Januar
   wären 71,2 % der Tage „trüb", im Juni 19,6 %. `sonne_abweichung_pp` rechnet
   gegen die letzten 28 Tage am selben Ort.
2. **Die Klassengrenzen stehen in `manual.wetter_klasse`**, gepflegt über
   `pflege/wetter_klasse.csv`. Wer eine Grenze verschiebt, muss die
   Nachbarklasse mitziehen — `mart.wetter_klasse_pruefung` rechnet es nach und
   steht als Prüfzeile in der Übersicht.
3. **Die Namensnennung gehört auf den Wetter-Reiter.** DWD-Daten sind unter
   GeoNutzV frei, aber nicht anonym: *„Wetterdaten: Deutscher Wetterdienst
   (DWD), bezogen über Bright Sky"*. Der Text steht in `src/wetter/quelle.ts`
   als `HERKUNFT`, damit er beim Quellenwechsel mitgeändert wird.

**Was eine Wetterkachel nicht darf: neben einer Feiertagskachel addiert
werden.** Ein Feiertag im Sommer ist auch ein warmer Tag. Die drei Effekte
stehen nebeneinander, nicht gegeneinander verrechnet.

**Die Abdeckung ist kleiner als beim Kalender.** Wetter braucht Koordinaten,
und die haben 60 von 141 Betrieben — der Kalender kommt seit `0084` auch ohne
aus. Eine Wetterkachel zeigt also weniger Betriebe als die Feiertagskachel
daneben, und das gehört in die Beschreibung.

---

## Pflichtartikel-Sichten (Migration `0094`)

Welche Sicht welche Frage beantwortet. Die drei `*_basis`-Sichten sind
Rechenstände und werden **nicht direkt abgefragt** — sie tragen die Erklärung
nicht.

| Sicht | Frage |
|---|---|
| `mart.pflichtartikel_betrieb` | **Die Leitzahl.** Welcher Anteil der Ausgaben läuft an der Liste vorbei, je Betrieb, mit Rang und Datenbasis |
| `mart.pflichtartikel_einkauf` | dasselbe je Monat und Zustand — für Verlauf und Kacheln |
| `mart.pflichtartikel_klassifikation` | je bestelltem Artikel: steht er auf der Liste? Fünf Zustände |
| `mart.pflichtartikel_abseits` | **Der Drilldown.** Welche Artikel genau, nach Ausgaben |
| `mart.pflichtartikel_verdacht` | Arbeitsliste: gleicher Name, andere Nummer → Nachfolgenummer? |
| `mart.pflichtartikel_abdeckung` | Gegenrichtung: welcher Pflichtartikel wurde nicht bezogen — **immer mit `datenbasis` lesen** |
| `mart.pflichtartikel_nicht_pruefbar` | die 112 Positionen ohne Artikelnummer |
| `mart.pflichtartikel_regional` | Auflösung der regionalen Gerichte auf Betriebe |
| `mart.pflichtartikel_stand` | Listenumfang und Laufzeit |
| `mart.pflichtartikel_ueberlappung` | Prüfsicht, Erwartung **leer** |
| `mart.pflichtartikel_regional_offen` | Prüfsicht, Erwartung **leer** |

### Drei Regeln für Karten auf diesen Sichten

**1. `abseits_pct` nie ohne `datenbasis`.** Ein Betrieb mit drei Bestellungen
kommt rechnerisch auf 90 % — richtig gerechnet und trotzdem keine Aussage.
Tabellen tragen die Spalte, Diagramme filtern auf `belastbar` und sagen das in
ihrer Beschreibung.

**2. `namensgleich` ist kein Befund, sondern die Unschärfe.** Diese Ausgaben
zählen weder als erfüllt noch als abseits. Solange die Zahl groß ist, ist
`abseits_pct` eine **Obergrenze**. Sie gehört als eigene Kachel sichtbar
daneben, nie stillschweigend in einen der beiden Töpfe.

**3. Kein Zeitraumfilter.** Der Zeitraum ist die Laufzeit der Liste und wird in
`0094` geschnitten. Ein freier Filter darüber könnte diesen Schnitt nur
aufweichen.

**4. In der Abdeckung gilt dieselbe Regel wie bei der Quote** (seit `0095`):
`bezogen = false` ohne `datenbasis` ist irreführend. Ein Betrieb ohne eine
einzige Bestellung im Laufzeitraum hat *jeden* Pflichtartikel „nicht bezogen" —
am 22.08.2026 waren das 1.503 von 4.669 Fehlmeldungen aus sieben Häusern.
`mart.pflichtartikel_abdeckung` filtert sie **nicht** weg (Regel 10: sichtbar
machen, nicht verschwinden lassen), aber jede Karte darauf muss die Spalte
zeigen oder ausklammern und das sagen.

### Was nachgesehen wird

```sql
-- Erwartung: nichts Auffaelliges. Die dritte Zeile ist die stille — eine
-- ausgelaufene Liste erzeugt keinen Fehler, sondern eine leere Seite.
SELECT * FROM mart.pruefung_uebersicht WHERE pruefung LIKE 'Pflichtartikel%';

-- Die lohnendste Arbeit: bestaetigte Nachfolgenummern machen die Quote genauer.
SELECT * FROM mart.pflichtartikel_verdacht ORDER BY ausgaben DESC LIMIT 20;

-- Und die Rangliste selbst.
SELECT konzept, betrieb, abseits_pct, datenbasis
  FROM mart.pflichtartikel_betrieb
 WHERE datenbasis = 'belastbar' ORDER BY abseits_pct DESC;
```

## Bounti-Sichten (Migration `0096`, 24.08.2026)

Neun Sichten, **keine einzige Karte** — und das ist Absicht: bis zum ersten echten Lauf gibt
es keine Zahl, gegen die man eine Karte prüfen könnte. Ein Dashboard, das auf leeren Tabellen
gebaut wird, sieht fertig aus und ist es nicht.

An der Sichtbarkeit ändert sich nichts: `core.bounti_*` fällt unter die Schemaregel
(`core` versteckt), `mart.bounti_*` ist automatisch sichtbar. `metabase/sichtbarkeit.ts`
braucht keine Zeile.

| Sicht | wofür |
|---|---|
| `mart.bounti_schulung_betrieb_monat` | Erfüllungsquote je Betrieb, Monat und Art (Kurs/Pfad), dazu überfällig und Notenschnitt |
| `mart.bounti_audit_betrieb_monat` | Auditnoten je Betrieb, Monat und Auditart — **nur** `LOCATION_AUDIT` |
| `mart.bounti_standort_betrieb` | die Brücke Standort → Betrieb |
| `mart.bounti_ohne_betrieb` | die Arbeitsliste der Zuordnung, **beide Richtungen** |
| `mart.bounti_mehrfachzuordnung` | Personen an mehreren Standorten — die Erklärung für jede Summendifferenz |
| `mart.bounti_fortschritt_gegenprobe` | unsere Rechnung gegen Bountis eigene Aggregation |
| `mart.bounti_zuweisung_stand` | der Rückstand, der fallen muss |
| `mart.bounti_zuweisung_ohne_mitarbeiter` | Zuweisungen an gelöschte Personen |
| `mart.pruefung_bounti` | **sechs** Prüfzeilen — und sie hängen seit `0096` an `mart.pruefung_uebersicht`, werden also von der bestehenden Karte mitgelesen. Eine Prüfsicht, die niemand liest, ist keine |

**Vier Dinge gehören auf jede Karte, die daraus gebaut wird** — sie sind der Unterschied
zwischen einer Zahl und einer belastbaren Zahl:

1. **Eine Person kann an mehreren Standorten stehen.** Jede über Personen aggregierte
   Betriebszahl zählt sie mehrfach; die Summe über alle Betriebe ist größer als die Kopfzahl
   des Unternehmens.
2. **Es gibt hier keine Fluktuationszahl, und das ist kein Versehen.** Die Kennzahl der
   Berichtsliste kommt aus LINA; eine aus Bounti-Konten gerechnete Näherung stand kurz im
   Entwurf und ist wieder entfernt worden (`entscheidungen.md`, B4). Wer eine Karte
   „Fluktuation" baut, baut sie auf der LINA-Quelle — sobald `lina-fragen d10` gelaufen ist.
3. **Zuweisungen ohne Frist sind keine Pflichtschulungen.** Die Spalte `ohne_frist` steht
   daneben, weil die Schnittstelle kein Pflichtkennzeichen kennt; ist sie groß, ist
   „überfällig" wertlos.
4. **Solange `mart.bounti_zuweisung_stand` Zeilen mit `zustand = 'nie'` führt, ist der
   Bestand unvollständig.** Eine Erfüllungsquote auf halbem Bestand sieht aus wie eine
   schlechte Quote.

```sql
-- Steht der Bestand schon? Erst wenn hier 0 steht, sind die Quoten belastbar.
SELECT zustand, count(*) FROM mart.bounti_zuweisung_stand GROUP BY zustand;

-- Erfüllung je Betrieb im laufenden Monat.
SELECT b.name, s.zugewiesen, s.abgeschlossen, s.ueberfaellig, s.ohne_frist, s.erfuellung_pct
  FROM mart.bounti_schulung_betrieb_monat s
  JOIN core.betrieb b ON b.betrieb_key = s.betrieb_key
 WHERE s.monat = date_trunc('month', current_date)::date AND s.art = 'kurs'
 ORDER BY s.erfuellung_pct NULLS LAST;
```

---

## Bounti-Auswertungssichten (Migration `0097`, 24.08.2026)

Neun weitere `mart`-Sichten, keine neue Tabelle. Die aus `0096` beantworten, **ob die
Anbindung stimmt**; diese beantworten, **was die Daten über die Betriebe sagen**.

| Sicht | Ebene | Inhalt |
|---|---|---|
| `mart.bounti_schulung_person` | Zuweisung | die unterste Ebene — Person, Lerneinheit, Frist, **vier** Zustände |
| `mart.bounti_person_stand` | Person | die Arbeitsliste: wer muss was nachholen, seit wann |
| `mart.bounti_betrieb_stand` | Betrieb | die **Leitsicht**, Stand heute, **alle 141 Betriebe** |
| `mart.bounti_schulung_verlauf` | Betrieb × Monat | die einzige Zeitachse; Monat = der der **Zuweisung** |
| `mart.bounti_lerneinheit_betrieb` | Lerneinheit | die andere Leserichtung: welche Schulung liegt brach |
| `mart.bounti_auditbericht_liste` | Auditbericht | **einschließlich** der Berichte ohne Betrieb |
| `mart.bounti_rolle_betrieb` | Rolle | Kopfzahl je Bereich — die einzige Strukturaussage ohne LINA |
| `mart.bounti_standort_offen` | Standort | die Zuordnungslücke **mit Gewicht** (Köpfe, Zuweisungen, Audits) |
| `mart.bounti_abdeckung` | je Gegenstand | wie viel überhaupt bei einem Betrieb ankommt |

### Vier Dinge, die man wissen muss, bevor man eine dieser Sichten abfragt

**1. `mart.bounti_betrieb_stand` führt auch Betriebe ohne Bounti.** `in_bounti = false`
heißt „wir wissen nichts über diesen Betrieb", nicht „dort ist nichts offen". Wer nach
`ueberfaellig` sortiert, ohne auf `in_bounti` zu filtern, hält 79 leere Zeilen für
vorbildliche Betriebe.

**2. `operativ` filtern.** 13 der 62 zugeordneten Betriebe sind geschlossen, verwaltend
oder ohne Umsatz; an ihnen hängen 6.330 Zuweisungen. Dieselbe Linie wie `0039` für die
Ampeln — nur ohne den Filter sind sie in jeder Rangliste dabei.

**3. `betrieb_key IS NULL` ist kein Datenfehler, sondern der Befund.**
`mart.bounti_schulung_person` und `mart.bounti_auditbericht_liste` führen absichtlich auch
die Zeilen ohne Betriebszuordnung. Am 24.08.2026 sind das 10.369 Zuweisungen und **alle**
133 Auditberichte. Wer sie herausfiltert, bekommt eine saubere Zahl über einen Ausschnitt.

**4. `ohne_frist` gehört neben jede Erfüllungsquote — und meint „offen und ohne Frist".**
Im `CASE` gewinnt `abgeschlossen` vor `ohne Frist`. Kein Fälligkeitsdatum tragen 29.513 der
74.683 Zuweisungen (39,5 %), aber 21.505 davon sind abgeschlossen; offen bleiben 8.008, in
operativen Betrieben 5.832. Wer die andere Zahl braucht, zählt in `core.bounti_zuweisung`
auf `faellig_am IS NULL`.

### Die Gegenprobe von Hand

```sql
-- Deckt sich die Leitsicht mit der untersten Ebene?
SELECT sum(ueberfaellig) FROM mart.bounti_betrieb_stand WHERE in_bounti AND operativ;
SELECT count(*) FROM mart.bounti_schulung_person
 WHERE betrieb_key IS NOT NULL AND operativ AND zustand = 'ueberfaellig';
-- am 24.08.2026 beide: 12.352

-- Was fällt heraus?
SELECT * FROM mart.bounti_abdeckung;
```

An der Sichtbarkeit ändert sich nichts: `mart.bounti_*` ist über die Schemaregel automatisch
sichtbar, `metabase/sichtbarkeit.ts` braucht keinen Eintrag.

## Nulltage, der Rand des Fensters, das Korn der Pflichtartikel (Migration `0100`, 10.09.2026)

**`mart.umsatztag_luecke`** — je Betrieb und Geschäftstag der letzten 120 Tage: Artikelverkauf
kennt Umsatz, Umsatzbericht steht auf null. Die Spur eines Kassenausfalls, dessen Nachlieferung
erst nach dem kurzen Fenster kam. Gemessen beim Anlegen: Aposto Schwetzingen 04.–14.08. und
Enchilada Aschaffenburg 31.07.–10.08., je elf Tage, zusammen 83.000 € netto. Die Sicht ist
zugleich Arbeitsliste des Laufs (`nulltageNachziehen()` liest `zustand = 'faellig'`) und
Prüfgrundlage: die Prüfübersicht zählt **nur `aufgegeben`** — was fällig ist, holt die nächste
Nacht, das ist Betrieb und kein Befund.

```sql
SELECT * FROM mart.umsatztag_luecke WHERE zustand <> 'im Fenster';   -- Erwartung: leer nach einer Woche
```

**`mart.umsatz_lochtag`** (seit `0101`, 14.09.2026) — dieselbe Bauart für den Fall, den die Lücke
oben nicht sieht: **beide** Berichte leer. Die Sicht aus `0039` (Tage der letzten 120 Tage mit
weniger als 60 % der Betriebe mit Umsatz gegen den 28-Tage-Schnitt davor) trägt jetzt am Ende
`alter_tage`, `nachgeholt`, `offen`, `zuletzt_eingereiht` und `zustand` mit denselben fünf
Werten; `lochtageNachziehen()` liest `faellig`, die Prüfübersicht zählt `aufgegeben`. Die ersten
sechs Spalten sind unverändert (`CREATE OR REPLACE VIEW` kann nur anhängen); die Karte „Tage mit
Datenloch" zeigt den Zustand mit. Anlass: 20.–22.07.2026, sieben Wochen null in beiden Berichten.

```sql
SELECT * FROM mart.umsatz_lochtag WHERE zustand <> 'im Fenster';   -- Erwartung: leer nach einer Woche
```

**`mart.nachzuegler_tiefe`** misst den Rand jetzt am konfigurierten Fenster
(`sync.quelle.nachzuegler_tage`, neue Spalten `rand_konfiguriert`, `aenderungen_pct`). Bis
`0100` war `rand` der größte beobachtete Abstand — 60, weil Lauf 1 am 26.07.2026 Tage mit
Abstand 23–60 einmalig holte — und die Prüfzeile „Änderungen am Rand des Fensters" konnte für
keinen LINA-Bericht anschlagen. `am_rand_noch_aenderungen` verlangt jetzt mehr als jeden zehnten
Abruf mit Änderung an den letzten beiden Fenstertagen. Nach dem Deploy wird die Zeile für
`getPersonalkosten` rot (80 % am Tag 22) — das ist richtig; die monatliche Nachlese
(`nachlese_tage`) ist die Antwort darauf, die Zeile bleibt als Messung stehen.

Zwei Vorbehalte beim Lesen der Sicht stehen in ihrem `COMMENT`: die Kurve des
Artikelverkaufsberichts bis zum 10.09. ist Rauschen (`columns` in Zufallsreihenfolge; seit dem
10.09. kanonischer Hash), und ein Betrieb, der erst nach dem Fenster nachliefert, ist hier nur
ein leises Signal — dafür gibt es `mart.umsatztag_luecke`.

**`mart.pflichtartikel_klassifikation_basis`** hat dasselbe Korn wie zuvor, aber `name_roh`
ist `min()` über alle Schreibweisen. Zwei Rohnamen desselben Artikels („Rapsöl 10L" /
„Rapsoel 10L") ließen den CONCURRENTLY-Refresh vom 25.08. bis 10.09. jede Nacht scheitern;
`mart.materialisierung_stand` führte drei Sichten als „veraltet", das Dashboard zeigte zwei
Wochen alte Zahlen. Die elf abhängigen Sichten wurden mit `0100` wortgleich neu angelegt —
Metabase liest `COMMENT ON` nur beim ersten Mal, deshalb tragen alle ihre Kommentare wieder.

**Neue Prüfzeile:** „Umsatz: Nulltag mit Artikelverkauf ausserhalb des Fensters (3x nachgeholt,
bleibt null)". Erwartung 0; `geprueft` ist die Zahl aller Lücken, auch der fälligen.

## `mart.ampel_schwelle` — das Regelwerk zum Nachlesen (Migration `0107`, 20.09.2026)

Solange eine Schwelle für alle galt, war „welche Schwelle gilt hier eigentlich" eine Frage,
die man aus dem Kopf beantworten konnte. Seit der Wareneinsatz je Marke gilt, nicht mehr —
und sie wird bei jedem roten Feld gestellt.

Die Sicht löst die drei Stufen aus `ampel.bewerte()` auf: eine Zeile je Regelwerk, Bereich
und Marke, dazu je Bereich die Zeile **„(alle übrigen Marken)"** — der Rückfall aus
`ampel.regel`, an dem gemessen wird, wer keinen eigenen Satz hat.

```sql
SELECT bereich_name, konzept, gilt, betriebe_operativ
  FROM mart.ampel_schwelle WHERE ist_standard
 ORDER BY reihenfolge, ist_rueckfall DESC, konzept;
```

Drei Spalten, die man kennen sollte:

* **`gilt`** — die Schwelle als lesbarer Satz („grün bis 17,00 · orange bis 19,00",
  „kein Urteil", „je Betrieb aus LINA"). Das Dezimalkomma wird von Hand gesetzt:
  `to_char()` folgt `lc_numeric`, und das steht auf dem Server auf `C`.
* **`ohne_urteil`** — hier wird bewusst nicht bewertet, der Grund steht in `hinweis`.
* **`betriebe_operativ`** — wen die Zeile heute trifft. Beim Rückfall sind das genau die
  operativen Betriebe, deren Marke in diesem Bereich **keinen** eigenen Satz hat. Eine
  Schwelle ohne Betriebe dahinter ist meist ein Rest und kein Regelwerk.

**Keine Historie.** `ampel.regel` führt immer nur den aktuellen Stand; welche Schwelle im
Mai galt, weiß diese Datenbank nicht. Deshalb hat die Sicht keine Zeitachse und die Karte
darauf keinen Monatsfilter (Ausnahme in `uebernehmen.ts` begründet).

### Zwei Sichten, die eine zweite Ursache dazubekommen haben

`mart.round_table_unvollstaendig` trennt seither `fehlt_*` (die Zahl fehlt) von
`ohne_schwelle_*` (die Zahl ist da, die Marke wird hier bewusst nicht bewertet), dazu
`signale_ohne_schwelle` und `grund_ohne_schwelle`. Die sechs `ohne_schwelle_*`-Spalten
bilden die sechs `fehlt_*` vollständig ab, obwohl heute nur `we_bar` belegt ist — wer
morgen einen Bereich aussetzt, braucht die Spalte schon, sonst verschwindet es wieder still.

`mart.ampel_bereich` kennt in `ampel_text` jetzt drei Fälle statt zwei: ein Urteil schlägt
**„– keine Schwelle"** schlägt **„– keine Daten"**. Dazu die Spalten `ohne_schwelle` und
`ohne_schwelle_hinweis`. `ampel IS NULL` heißt damit nicht mehr eindeutig „keine Daten" —
in keinem der beiden Fälle heißt es „in Ordnung".

## `mart.leserolle_pruefung` — hebt eine Funktion den Schutz ihrer Sicht auf? (Migration `0109`)

**Die Regel, die dahintersteht, gilt für jede neue `mart`-Sicht:**

> Eine **Sicht** greift auf ihre Tabellen mit den Rechten ihres **Eigentümers** zu.
> Ein **Funktionsrumpf** mit denen des **Aufrufers** — auch aus einer Sicht heraus.

`mcp_leser` darf `core`, `raw`, `part` und `sync` nicht sehen (`0105`). Solange eine Sicht
selbst dorthin greift, ist das kein Problem: sie tut es mit den Rechten ihres Eigentümers.
Sobald derselbe Zugriff in eine Funktion wandert, ist die Sicht für die Leserolle tot —
und zwar lautlos, denn als Eigentümer getestet läuft alles. Am 20.09.2026 hat das drei
Sichten gekostet, Hergang in `fehlerkatalog.md`.

Zwei Wege heraus, beide in `0109` vorgeführt:

* **Die Auflösung in die Sicht ziehen.** So macht es `ampel.konzept_je_betrieb`;
  `ampel.hauptkonzept()` ist nur noch eine Hülle darum. Der Vorzugsweg.
* **`SECURITY DEFINER` mit festem `search_path`.** Nur, wenn der erste Weg nicht geht —
  bei `mart.quelle_messen()` etwa, weil deren zweiter Zweig die Abfrage dynamisch aus
  `sync.quelle` zusammenbaut.

`mart.leserolle_pruefung` findet den nächsten Fall, **Erwartung: leer**, und steht in
`mart.pruefung_uebersicht`. Sie ist eine Textsuche im Funktionsrumpf: sie findet keinen
Zugriff über dynamisches SQL und keinen über einen Alias. Leer heißt „nichts
Offensichtliches", nicht „bewiesen sauber" — der harte Nachweis sind die zwei Tests in
`mcp/test/ausfuehren.test.ts`, die gegen die echte Leserolle lesen.

**Und die Probe, die nichts beweist:** `SELECT count(*) FROM <sicht>` wertet die
Spaltenausdrücke der Sicht **nicht** aus. Wer so prüft, ob eine Sicht lesbar ist, bekommt
grün und weiß nichts. `SELECT * FROM <sicht> LIMIT 1` nehmen.

## Drei Wachen für die Lesbarkeit der Schicht (Migration `0110`, 21.09.2026)

Die Wache aus `0109` hat ihren eigenen Nachfolgefall nicht gefunden: sie sucht nur unter den
Funktionen **in** `ampel`/`mart`, und `core.geschaeftstag()` steht im gesperrten Schema
selbst. Ergebnis: elf Sichten unlesbar für `mcp_leser`, darunter alle Wettersichten,
`mart.vergleichstag`, die Prüfliste `mart.pruefung_uebersicht` und die Wache selbst. Hergang
und Messung in `fehlerkatalog.md`, die Schemaseite in `datenmodell.md`.

Seither sehen drei Sichten hin, und sie sehen **verschiedene Dinge** — das ist der Punkt,
nicht Redundanz:

| Sicht | Grundlage | findet | findet nicht |
|---|---|---|---|
| `mart.leserolle_pruefung` | `pg_proc` + `pg_depend` | Funktionen in **jedem** Schema, deren Rumpf `core`/`raw`/`part`/`sync` nennt, samt der Sichten, die daran hängen | Zugriff über dynamisches SQL, über eine zweite Funktion dazwischen, über einen Alias |
| `mart.sicht_ohne_leserecht` | `pg_class` + `has_table_privilege` | Relationen in `mart`/`manual`/`ampel` ohne `SELECT` für `mcp_leser` | alles, was ein Recht hat und trotzdem nicht läuft |
| `mart.sicht_defekt` | `mcp.sicht_gesundheit` | was ein `SELECT * … LIMIT 1` **als `mcp_leser`** wirklich nicht lesen konnte — mit SQLSTATE und Meldung | nichts, solange der Lauf läuft. Genau deshalb steht in der Prüfliste eine Zeile, die anschlägt, wenn er älter als 24 Stunden ist |
| `mart.sicht_unklar` | `mcp.sicht_gesundheit` | Proben **ohne Urteil**: Zeitüberlauf nach fünf Sekunden oder ein Fehler ohne SQLSTATE. Kein Defekt, aber der Prüfer warnt — ohne engen Zeitraum läuft so eine Sicht in die 20-Sekunden-Grenze | ob die Sicht mit engem Zeitraum läuft; das weiß erst die Abfrage |

**Erwartung bei allen vier: leer.** Alle vier stehen in `mart.pruefung_uebersicht`.

**Die dritte hat einen eigenen blinden Fleck**, und deshalb ersetzt sie die ersten zwei
nicht: sie liest jede Sicht mit `LIMIT 1`, und bei einer `UNION ALL`-Kette hört Postgres
nach dem ersten Zweig auf. Ein Fehler in einem späteren Zweig fällt damit nur auf, wenn er
beim **Planen** auffällt — nachgemessen am 21.09.2026: dieselbe kaputte Funktion ergab 8
Befunde, solange der Fehler beim Planen entstand, und nur 6, als er erst beim Lesen entstand
(Messung in `fehlerkatalog.md`). **Leer heißt „was die Probe erreicht, läuft".**

**Die dritte ist trotzdem die einzige, die überhaupt etwas beweist**, und sie ist keine Sicht über den Katalog,
sondern eine Momentaufnahme: der MCP-Server probiert stündlich jede Relation aus und legt
das Ergebnis über `mcp.gesundheit_melden(jsonb)` in `mcp.sicht_gesundheit` ab. Das muss der
Server tun und kann nicht in der Datenbank stehen — eine Sicht kann sich nicht selbst
ausprobieren, und wer es als Eigentümer tut, beweist nichts (die Lehre aus `0107`). Kosten,
nachgemessen über 236 Relationen: 1,3 s warm.

**Für eine neue `mart`-Sicht folgt daraus zweierlei**, und beides gehört in die Migration,
nicht in einen guten Vorsatz:

1. **`SELECT mcp.rechte_auffrischen();` am Ende.** Die Standardrechte aus `0105` gelten
   `FOR ROLE <current_user>` und tragen nicht, wenn eine Migration mit einem anderen Zugang
   eingespielt wird.
2. **Die Wirkung als `mcp_leser` nachweisen**, mit `SELECT * … LIMIT 1` und niemals mit
   `count(*)`. `0110` macht es am eigenen Ende vor.

## `mart.verkaufsstelle_abdeckung` und die dritte Zeilenart im Umsatzbericht (Migration `0112`, 22.09.2026)

Seit `0112` trägt `core.umsatzbericht_tag` je Betrieb und Tag **drei Arten** Zeilen: die
Gesamtzeile (`hauptsparte_key` und `verkaufsstelle_key` NULL), je Hauptsparte eine und — neu — je
Verkaufsstelle eine. Die Gesamtzeile ist die mit **beiden** Schlüsseln NULL. Alle bestehenden
Sichten filtern so; `mart.hauptsparte_abdeckung` filterte nur die Hauptsparte und hätte jede
Verkaufsstellenzeile als zweiten Gesamtumsatz gezählt — in `0112` repariert (Spaltenliste
unverändert).

`mart.verkaufsstelle_abdeckung` (ein Monat je Zeile) ist die Gegenprobe zum **ungeprüften**
Parameter `verkaufsstellen`: die Summe der Stellen muss den Gesamtumsatz treffen. `zustand`
nennt die beiden Fehlbilder ausdrücklich („Filter liefert 0 EUR", „LINA ignoriert den Filter").
Eine Zeile in `mart.pruefung_uebersicht` zählt Monate mit `zustand` außer `ok`. Eine fachliche
`mart`-Sicht „Umsatz je Verkaufsstelle" gibt es noch nicht — erst, wenn die Abdeckung stimmt.

## Prüfsichten zu den Betriebsberichten (Migration `0114`, 22.09.2026)

Fünf `mart`-Sichten, alle zum **Import**, keine davon eine fachliche Auswertung — die baut der
nächste Schritt (M5 in `plan-lina-vollabzug.md`). Alle stehen im Katalog mit Körnung und
`thema = 'import'`.

| Sicht | Körnung | Erwartung |
|---|---|---|
| `mart.betriebsbericht_gegenprobe` | Bericht × Betrieb × Abrufzeitraum | `befund` ok; `nachholen` sagt, was der Lauf damit tut — seit `0119` auch `abgeschaltet` (Bericht wird nicht mehr geholt, etwa 88) |
| `mart.betriebsbericht_luecke` | Bericht × Betrieb × Tag (9–60 Tage alt) | **leer** ab der zweiten Nacht |
| `mart.finanzweg_88_97_abgleich` | Betrieb × Tag × Finanzweg, wo beide Quellen da sind | kein `weicht ab`. Wächst seit 23.09.2026 nicht mehr (88 abgeschaltet, `0119`) |
| `mart.bericht_hinweis` | Bericht × Betrieb × Zeitraum × Text | LINAs eigene Hinweise, kein Importfehler |
| `mart.rabatt_artikel_unaufgeloest` | Betrieb × Monat × Artikelname | so klein wie möglich — die Auflösungsquote |

Drei Zeilen in `mart.pruefung_uebersicht`: Lücken (9–60 Tage), aufgegebene Gegenproben (60 Tage),
88 gegen 97 (60 Tage). Die dritte läuft seit der Abschaltung von 88 (23.09.2026) mit ihrem
60-Tage-Fenster aus: `geprueft` fällt auf 0 — das ist dort kein Ausfall, sondern das Ende der
zweiten Quelle.

**Zwei Fallen für jede spätere Auswertung auf den neuen `core`-Tabellen:**

* `core.finanzweg_tag` trägt dieselbe Zahl aus zwei Berichten (`bericht` 88 und 97). Eine Summe
  über beide ist doppelt.
* `core.rabatt_artikel_tag` und `core.finanzweg_tag` (Bericht 88) tragen den Abrufzeitraum; im
  Betrieb ist er ein Tag. Wer Tage summiert, filtert `zeitraum_bis = geschaeftstag` — der
  Monatsabruf der Abnahme M1 steht sonst daneben.

`mart.betriebsbericht_gegenprobe` rechnet je Abrufzeile gegen den Umsatzbericht. Über die ganze
Historie ist das teuer; die Prüfzeile liest nur die letzten 60 Tage, wer mehr will, filtert
`zeitraum_bis`.

## Kassensichten aus den Betriebsberichten (Migrationen `0117`/`0118`, 23.09.2026)

Bis `0115` lagen die neuen Kassendaten nur in `core` — für den MCP-Zugang (`mcp_leser`) und für
jede Karte unerreichbar. Die Frage, die das Vorhaben ausgelöst hat (*„Wie viele Stück je Artikel
liefen im August über die Glücksrad-Finanzwege 10/25/50 %, je Betrieb?"*), stand damit weiter nur
per Auftrag. Seit `0117` steht sie in `mart` (M5 in `plan-lina-vollabzug.md`).

**Abnahme am 23.09.2026** (Klon `lina_m5_0923` auf Stand `0118`, echte Antworten der 14
Wilma-Wunder-Betriebe, August 2026, gelesen **als `mcp_leser` über `mcp/src/ausfuehren.ts`**): der
Bericht `ka_nachlass_betrieb` (42 Zeilen, 14 Betriebe) summiert sich je Stufe zu **10 %: 149,
25 %: 1.413, 50 %: 7.335**; `ka_nachlass_artikel` mit „Durchstarter" zu **12 / 107 / 432 = 551**;
`aa_nachlass` und die freie Abfrage auf `mart.artikel_nachlass_monat` liefern dieselben Zahlen.
Dieselbe Prüfung steht als Test in `src/sync/betriebsbericht.test.ts` („M5").

### Die Sichten

Jede fachliche Sicht trägt `betrieb_key`, `enc_id`, `betrieb`, `marke` und am **Ende** `operativ`
(wie die Bounti-Sichten, `CREATE OR REPLACE VIEW` kann nur anhängen).

| Sicht | Körnung | Quelle | worauf man achten muss |
|---|---|---|---|
| `mart.finanzweg` | ein Finanzweg | Stamm aus 97 (bis 23.09.2026 auch 88) | `aktion` = Name ohne Prozentzahl, nur bei Nachlässen |
| `mart.finanzweg_namen` | Finanzweg × Monat × Name | `core.finanzweg_stand` | `namen_im_monat > 1`: die Nummer taugt nicht als Schlüssel |
| `mart.artikel_nachlass_tag` | Betrieb × Abrufzeitraum (ein Tag) × Finanzweg × Artikel | 92 | `menge` = Artikel auf Nachlass-Bons, **nicht** Verkauf; nur Zeilen mit Artikelnamen |
| `mart.artikel_nachlass_monat` | Betrieb × Monat × Finanzweg × Artikel | 92 | die Glücksrad-Tabelle |
| `mart.finanzweg_tag` | Betrieb × Tag × Finanzweg | 97, sonst 88 (88 abgeschaltet 23.09.2026, nur noch Rückfall für schon geladene Tage) | **je Betrieb und Tag eine Quelle** (`quelle_bericht`); ein Monat steht erst ab Monatsende + 7 Tagen da |
| `mart.finanzweg_monat` | Betrieb × Monat × Finanzweg | über `…_basis` (materialisiert) | so frisch wie der letzte Lauf |
| `mart.nachlass_monat` | Betrieb × Monat × Finanzgruppe × Aktion × Prozentsatz | 97 (vorher 88/97) | die zwei 25-%-Wege in **einer** Zeile; vollständiger Betrag |
| `mart.zahlart_monat` | Betrieb × Monat × Zahlart | 97 (vorher 88/97) | Summe aller Zeilen = Bruttoumsatz; Trinkgeld/Rückgeld negativ |
| `mart.bon_tag` | Betrieb × Tag | 96 | keine Uhrzeit, keine Nachlässe; Ø-Bon aus Summen neu rechnen |
| `mart.bon_zahlart_tag` | Betrieb × Tag × Zahlart | 96 | über Zahlarten **nicht** summierbar (ein Bon, mehrere Zahlarten) |
| `mart.debitor_monat` | Betrieb × Monat × Debitor | 96 | Partialindex auf `core.bon` |
| `mart.debitorenauswertung_tag` | Betrieb × Tag × Debitor | 86 | Gegenprobe; 86 lieferte am 15.08. dieselben Bons wie 96 |
| `mart.tisch_tag` | Betrieb × Tag × Tisch | 113 | `tisch_id` ist LINAs Kennung, kein Name |
| `mart.tagesabschluss_tag` | Betrieb × Tag × Hauptsparte × Steuersatz | 97 | brutto |
| `mart.monatsaufstellung_tag` | Betrieb × Tag | 90 + 108 | `zahlungen_je_rechnung` nicht mitteln |
| `mart.storno_artikel_monat` | Betrieb × Monat × Artikel × Typ × Grund | 39 | Storno **positiv** |
| `mart.storno_grund_monat` | Betrieb × Monat × Typ × Grund | 39 | `stornoquote_pct` gegen den Bruttoumsatz nach Storno |
| `mart.kellner_monat` | Betrieb × Monat × Kellnernummer | 60, 57 | kein Name; Summe über Kellner ≠ Betriebsumsatz |
| `mart.kellner_umsatz_tag` | Betrieb × Tag × Kellnerblock | 61 | `kellnernummer` nur bei eindeutiger Monatssumme, sonst NULL |
| `mart.kellner_artikel_monat` | Betrieb × Monat × Kellnerblock × Artikel | 53 | immer mit `monat` filtern (Partitionen) |
| `mart.gutschrift` | eine Gutschrift | 57 | LINAs Vorzeichen |
| `mart.betriebsstelle_monat`, `…_hauptsparte_monat` | Betrieb × Monat × Stelle (× Sparte) | 68, 69 | `netto_je_gast` aus Summen |
| `mart.verkaufsstelle_monat`, `…_hauptsparte_monat` | Betrieb × Monat × Verkaufsstelle (× Sparte) | 112, 71 | die belastbare Verkaufsstellenzahl |
| `mart.verkaufsstelle_tag` | Betrieb × Tag × Verkaufsstelle | Konzern-Umsatzbericht (`0112`) | gilt erst, wenn `mart.verkaufsstelle_abdeckung` „ok" sagt |
| `mart.zeitzone_hauptsparte_monat`, `…_feinsparte_monat` | Betrieb × Monat × Sparte × Zeitzone | 76, 75 | ohne Kopfzeilen; nie beide zusammen summieren |
| `mart.unbar_zahlung_monat` | Betrieb × Monat × Betriebsstelle × Zahlart | 99 | `zahlbetrag` positiv |
| `mart.betriebsbericht_ladestand_monat` | Bericht × Monat | Abrufe + Warteschlange | über `…_basis` (materialisiert); **ohne 88** seit `0119` — für die Finanzwege gilt der Stand von 97 |
| `mart.betriebsbericht_ladestand` | ein Bericht | darüber | `aussage` hängt der MCP-Server an jede Kassenantwort |

**Jede core-Tabelle aus `0112`–`0115` hat damit mindestens eine lesbare Sicht** (Vollständigkeitsliste
Tabelle → Sicht → Bericht in `datenherkunft.md`, Abschnitt „Betriebsberichte").

### Sechs Regeln, die in den Sichten stecken

1. **Eine Quelle je Betrieb und Tag.** `core.finanzweg_tag` führt 88 und 97 mit denselben Zahlen.
   `mart.finanzweg_tag` nimmt 97, wo es ihn gibt, sonst 88. Seit dem 23.09.2026 wird nur noch 97
   geholt (`0119`); die Regel bleibt, 88 ist Rückfall für die bis dahin geladenen Tage. Die Prüfsicht
   `mart.finanzweg_88_97_abgleich` führt beide nebeneinander und ist im MCP-Katalog gegen `sum()`
   gesperrt.
2. **Der Abrufzeitraum.** 88 und 92 sind Tagesberichte; ein Mehrtagesabruf (Abnahme, Handabruf)
   steht in der Tagessicht mit `tage > 1` und nur dort, wo der Betrieb im Zeitraum **keinen**
   Tagesabruf hat. Karten filtern deshalb `geschaeftstag >= von AND zeitraum_bis <= bis` — ein
   Abruf zählt, wenn er ganz im Zeitraum liegt — und zusätzlich `geschaeftstag <= bis`, damit
   Postgres nur die betroffenen Monate liest.
3. **Artikel gegen Vorgänge.** 92 zählt Artikel (`menge`), 88/97 zählen Vorgänge
   (`anzahl_vorgaenge`). Die Spalten heißen absichtlich verschieden, keine heißt `anzahl`.
4. **Nur Zeilen mit Artikelnamen** in den Nachlass-Sichten (28 von 8.533 Zeilen im August 2026 ohne
   Namen, die Glücksrad-Zahl zählt sie nicht). Den vollständigen Nachlassbetrag führt
   `mart.nachlass_monat`.
5. **Aktionen über `aktion` + `prozentsatz`,** nie über eine Nummer (3501 **und** 3168 sind 25 %
   Glücksrad). `mart.finanzweg_aktion()` und `mart.finanzweg_prozentsatz()` sind reine Funktionen
   ohne Tabellenzugriff — sie laufen mit den Rechten des Aufrufers und brauchen nichts
   (`sicht-gegen-funktionsrumpf`).
6. **Vorzeichen.** LINA führt Zahlungen, Nachlässe und Stornos negativ; in `mart` sind
   `nachlass_*`, `storno_*`, `zahlbetrag` und `betrag` (bei Zahlarten und Nachlässen) positiv.
   Die Zahlarten eines Tages summieren sich damit zum Bruttoumsatz: Wilma Wunder Düsseldorf, August
   2026, 369.841,09 EUR — nachgerechnet am 23.09.2026.

### Leistung in Produktionsgröße — nachgemessen am 23.09.2026

**Datenmenge.** Klon `lina_m5_last` (24 GB), synthetisch auf den **152.782 echten Betrieb-Tagen**
mit Umsatz (79 Betriebe, 5.382 Betrieb-Monate, 2018 bis Juli 2026) aus `core.umsatzbericht_tag`:
`core.rabatt_artikel_tag` 8,41 Mio. (55 Zeilen je Betrieb-Tag), `core.finanzweg_tag` 10,39 Mio.
(34 Finanzwege aus 88 **und** 97), `core.bon` 30,15 Mio. (eine Zeile je echter Rechnung),
`core.betriebsbericht_abruf` 454.626, `core.storno_artikel_monat` 2,69 Mio. (500 je Betrieb-Monat),
`core.kellner_umsatz_tag` 4,2 Mio., `core.gutschrift_kellner` 2,15 Mio. **Nur 24 Monate in voller
Dichte** (Aug 2024 – Jul 2026, der Rest wäre reine Schreibzeit): `core.kellner_artikel_monat`
9,59 Mio. (6.700 je Betrieb-Monat; hochgerechnet auf alle 5.382 Betrieb-Monate ~36 Mio.),
`core.debitor_bon` und `core.tischtransfer_bon` je 8,2 Mio. (hochgerechnet ~30 Mio. je Tabelle). Da
diese Tabellen nach Monat partitioniert sind bzw. über den Tag gefiltert werden, ist für eine
Monatsabfrage die Dichte je Monat entscheidend, nicht die Zahl der Monate. Die Werte sind nicht
fachlich echt, nur in Menge und Verteilung.

**Gemessen über den MCP-Ausführungsweg** (`abfrageAusfuehren`/`berichtAusfuehren` als `mcp_leser`,
also mit Prüfung, Datenstand, Ladestand-Hinweis und Protokoll). „Erster Lauf" ist der erste
Aufruf nach dem Laden — ein echter Kaltstart (Neustart von Postgres, leerer Dateicache) war nicht
möglich, weil die Instanz mit einer parallelen Sitzung geteilt ist.

| Abfrage | vorher | nachher: erster Lauf / warm (DB-Anteil) | Plan-Stichwort |
|---|---|---|---|
| Glücksrad 14 Betriebe × 1 Monat (Bericht `ka_nachlass_betrieb`) | 11,0 s (DB 0,16 s; 10,4 s Ladestand-Hinweis) | 0,50 / 0,21 s (0,17 s) | Seq Scan nur auf `rabatt_artikel_tag_2026_08` |
| Durchstarter je Stufe (`ka_nachlass_artikel`) | 10,4 s | 0,15 / 0,14 s | wie oben |
| Nachlass alle Betriebe × 1 Monat, Monatssicht | 9,3 s bzw. 2,2 s (ohne Ausdrucksindex, 7,8 Mio. Zeilen) | 0,43 / 0,44 s (0,30 s) | Index Scan `rabatt_artikel_tag_monat_idx` je Partition |
| Zahlungsmix eine Marke × 12 Monate (`ka_zahlart_betrieb`) | 13,9 s (DB 2,7 s) | 0,14 / 0,14 s (5 ms) | Bitmap Heap Scan `finanzweg_monat_basis` |
| Zahlungsmix alle Betriebe × Monat × 12 Monate (frei, 12.155 Zeilen) | — | 0,16 / 0,15 s (15 ms) | wie oben |
| `mart.zahlart_monat` 1 Monat | 1,0 s → 6,5 s (Join auf `core.finanzweg` verdarb die Schätzung) | 0,17 s ohne den Join, danach materialisiert | — |
| Nachlasskosten alle Betriebe × 12 Monate | 4,6 s (1 Monat, mit Join) | 0,17 / 0,17 s (31 ms) | materialisiert |
| Storno je Grund alle Betriebe × 12 Monate (`ka_storno_grund`) | 11,4 s (DB 0,68 s) | 0,99 / 0,39 s (0,71 s) | Bitmap Heap Scan `storno_artikel_monat`, LATERAL je Betrieb-Monat in den Umsatzbericht |
| Bonkennzahlen je Tag, 1 Monat, alle Betriebe (frei) | — | 0,18 / 0,18 s (42 ms) | Seq Scan nur auf `bon_2025_03` (335.229 Bons) |
| Zahlarten je Bon, 1 Monat, alle Betriebe | 10,1 s (6,1 Mio. Bons, Unterabfrage las alle Monate) | 0,21 / 0,21 s (73 ms) | Fensterfunktion über (Tag, Betrieb), eine Partition |
| Kellner-Artikel 1 Betrieb × 1 Monat | — | 0,17 / 0,15 s (31 ms) | eine Monatspartition |
| Debitoren 12 Monate | — | 0,96 / 0,19 s (0,81 s) | Partialindex `bon_debitor_idx` |
| Ladestand je Bericht | 10,9 s | 0,15 / 0,13 s (3 ms) | materialisiert |
| `mart.datenstand` (hängt an jeder Antwort) | 14 ms | 0,13 s gesamt (2 ms) | unverändert |

**Alle 35 gemessenen Abfragen blieben unter 1 s**, die längste im ersten Lauf 0,99 s (Storno über
ein Jahr). Die Grundlast des MCP-Wegs ohne Datenbankzeit liegt bei rund 130 ms (Prüfung,
Datenstand, Ladestand, Protokoll). Die Rohdaten der Messung: `messen.ts` im Arbeitsverzeichnis der
Sitzung, nicht im Repo.

### Was dafür gebaut wurde, und warum

| Maßnahme | wogegen | gemessen |
|---|---|---|
| Ausdrucksindex `(date_trunc('month', geschaeftstag::timestamp)::date, betrieb_key)` auf `core.rabatt_artikel_tag` und `core.finanzweg_tag` | Ein Filter auf den **Monat** einer Sicht schneidet keine Partition weg (er liegt auf einem Ausdruck). Die Sichten bilden den Monat mit **genau** diesem Ausdruck — `date` auf `timestamp`, weil nur so `date_trunc` unveränderlich und indexierbar ist | 9,3 s → 0,17 s |
| „Erst verdichten, dann benennen" in allen Sichten mit Gruppierung | Betrieb, Marke und Status in der Gruppierung ließen Postgres jede Zeile nach elf Schlüsseln sortieren | Teil der obigen Zahlen |
| Kein Join auf `core.finanzweg` in `mart.finanzweg_tag` (`art` aus der Zeile abgeleitet, wie im Lader) | verdorbene Zeilenschätzung, Nested Loops | 6,5 s → 0,17 s |
| Fensterfunktion statt zweiter Gruppierung in `mart.bon_zahlart_tag` | ein Datumsbereich wandert über einen Join **nicht** in eine gruppierte Unterabfrage — sie las alle Bons | 10,1 s → 0,07 s |
| LATERAL je Betrieb-Monat in den Umsatzbericht (`nachlass_monat`, `storno_grund_monat`) | dieselbe Falle mit dem Monatsumsatz | — |
| **Materialisiert:** `mart.finanzweg_monat_basis` (183.022 Zeilen, 33 MB) | jede 88-Zeile prüfte, ob es für ihren Tag 97 gibt | 2,7 s → 5 ms; Refresh 32,9 s nebenläufig |
| **Materialisiert:** `mart.betriebsbericht_ladestand_basis` | der Ladestand hängt an **jeder** Kassenantwort | 10,9 s → 3 ms; Refresh 13,9 s nebenläufig |
| Partialindex `bon_debitor_idx` auf `core.bon (betrieb_key, geschaeftstag) WHERE debitor IS NOT NULL` | Debitoren sind selten, ohne Index läse jede Monatsabfrage alle Bons | 0,19 s warm |

**Nicht gemacht, weil nicht nötig:** BRIN (die Tabellen sind nach dem Tag partitioniert, das leistet
mehr), Statistikziele (keine Fehlschätzung nach dem Umbau gemessen), eine Materialisierung von
`mart.artikel_nachlass_monat` (0,3 s für einen Monat über alle Betriebe) und von `mart.bon_tag`
(eine Partition je Monat).

Beide Materialisierungen frischt `betriebsberichtSichtenNachlauf()` auf — in Phase B und nach
Phase C (`importer.md`, „Drei Phasen"). `mart.materialisierung_stand` führt sie unter
`betriebsbericht_sichten_refresh`; `0117` hängt die Einträge an die Sicht an, statt sie
abzuschreiben (sie wurde in `0116` neu gefasst).

### Die Karten lesen nur `mart`

Der MCP-Zugang führt jede Karte als `mcp_leser` aus. Eine Karte auf `core` läuft in Metabase und
scheitert im Chat mit „permission denied". Die neuen Karten (`ka_*`, `aa_nachlass`) lesen deshalb
nur `mart`; `mcp/test/berichte.test.ts` prüft das. Die älteren Artikelaktion-Karten
(`aa_kopf` … `aa_liste_pruefung`) lesen `core.artikelverkauf_tag` und laufen im Chat **nicht**
(`offene-punkte.md`).
