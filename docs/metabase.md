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
| Umsatzentwicklung je Betrieb oder Marke | `mart.umsatz_tag` |
| Speisen gegen Getränke | `mart.umsatz_tag_sparte` |
| Stoßzeiten, Tagesverlauf | `mart.umsatz_stunde`, `mart.umsatz_zeitzone` |
| Artikel, Renner und Penner, Deckungsbeitrag | `mart.artikelverkauf` |
| Sortiment nach Warengruppe | `mart.deckungsbeitrag_warengruppe` |
| Einkaufspreise über die Zeit | `mart.preisentwicklung_ware` |
| BWA-Kennzahlen, jüngster Stand | `mart.kennzahlen_aktuell` |
| Stimmen die Zahlen? | `mart.pruefung_uebersicht` |
| Läuft der Import? | `mart.sync_status`, `mart.backfill_fortschritt` |
| Fehlt einem Betrieb die BWA-Brücke? | `mart.betrieb_ohne_lina_id` — Erwartung: leer |

Jede dieser Sichten trägt einen Tabellenkommentar; Metabase zeigt ihn als Beschreibung an.
Dort steht auch, was man mit ihr **nicht** tun soll.

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

## Tempo

`mart.artikelverkauf` liegt bei rund 20 Millionen Zeilen im Jahr. Die Tabelle darunter ist
monatlich partitioniert — **wer nach `geschaeftstag` filtert, liest nur die betroffenen
Monate.** Ohne Zeitfilter wird die ganze Historie gelesen. Beim Anlegen einer Frage auf
dieser Sicht also zuerst den Zeitraum setzen, dann gruppieren.

Für alles andere ist die Datenmenge unkritisch: der Umsatzbericht sind ~150.000 Zeilen im
Jahr, die BWA ~8.000.

## Berechtigungen

`manual` ist das einzige Schema, in das geschrieben wird — Maßnahmen, OM-Einschätzungen,
Ursachen. Metabase kann das nicht; v1 läuft über CSV-Upload, später über eine kleine
Eingabemaske. Der Metabase-Datenbankbenutzer braucht deshalb nur Lesezugriff.
