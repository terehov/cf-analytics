# Was Metabase zeigt — und was nicht

Stand 26.07.2026. Von **111 Tabellen und Sichten** in der Datenbank sind in Metabase
**40 sichtbar**, 29 auf „nur in Detailansichten" gestellt und 42 gar nicht erst
synchronisiert.

Der Grundsatz dahinter steht in [`metabase.md`](metabase.md): *Metabase soll nur `mart`
sehen müssen.* Er gilt seit dem 26.07.2026 buchstäblich — im Datenbrowser stehen nur noch
**`mart`, `manual` und `ampel`**. Von den 98 Dashboard-Karten greift **keine einzige** mehr
auf `core` zu.

---

## Die drei Stufen

| Stufe | Was das heißt | Anzahl |
|---|---|---|
| **Sichtbar** | In Suche, Abfrage-Editor und Datenbrowser | 40 |
| **Nur in Detailansichten** (`technical`) | Aus Suche und Editor verschwunden, über einen Fremdschlüssel weiterhin erreichbar. Metabase liest die Beziehungen weiter aus dem Katalog. | 29 |
| **Nicht synchronisiert** | Metabase kennt sie nicht. Schema-Filter auf der Datenbank. | 42 |

Der Unterschied zwischen Stufe 2 und 3 ist wichtig: `core` bleibt **synchronisiert**, weil
die Fremdschlüssel von dort kommen. Metabase liest sie aus dem Katalog und bietet daraufhin
von selbst den Sprung vom Artikelverkauf zum Betrieb an. Ausgeblendet wird nur die
*Sichtbarkeit*, nicht die Struktur.

---

## Sichtbar (40)

### `mart` — die Auswertungsschicht (29)

Dafür ist sie da. Jede Sicht ist so geschnitten, dass eine naive Summe ein richtiges
Ergebnis liefert, und bringt die Namen schon mit.

| Sicht | Wofür |
|---|---|
| `round_table_monat` | **Der Round Table.** Ersetzt das Excel-Blatt „Eingabe", fertig bewertet |
| `round_table_basis` | Dieselben Zahlen ohne Ampel — die Grundlage, auf der alles Weitere aufsetzt |
| `round_table_trend` | Drei-Monats-Blick je Betrieb und Bereich, ersetzt `Trend_2Monate` |
| `ampel_bereich` | Die sechs Ampeln im Langformat — für alles, was über Bereiche hinweg zählt |
| `ursachen_analyse` | Ursache × Bereich, ersetzt das Blatt `Ursachenanalyse` |
| `massnahme` | Maßnahmen mit Betriebsname und Fälligkeit |
| `umsatz_tag` | Tagesumsatz gesamt — **darf man bedenkenlos summieren** |
| `umsatz_tag_sparte` | Nach Speisen/Getränken bzw. Verkaufsstelle, bewusst getrennt |
| `umsatz_stunde`, `umsatz_zeitzone` | Tagesverlauf und vordefinierte Zeitzonen |
| `umsatz_ytd` | Monats- und Jahresumsatz mit Vorjahr — Spalten G/H/I des Excels |
| `artikelverkauf` | Artikelverkäufe mit dem Wareneinsatzansatz **des jeweiligen Tages** |
| `deckungsbeitrag_warengruppe` | DB je Warengruppe, mit Abdeckungsgrad |
| `preisentwicklung_ware` | Einkaufspreise mit Vormonatsvergleich |
| `personalkosten` | Quoten und Effektivitäten, gesamt und je Bereich |
| `kennzahlen_aktuell` | Jüngster BWA-Stand, Euro und Prozent getrennt aufgelöst |
| `betrieb`, `konzept_zuordnung` | Betriebsübersicht und Markenzuordnung |
| `betrieb_ohne_lina_id` | Arbeitsliste — **Erwartung: leer** |
| `datenstand` | Je Betrieb: bis wann Umsatz, bis wann BWA. Vor jeder Auswertung |
| `standort`, `standort_fehlend` | Grundlage der Karte, derzeit leer (siehe unten) |
| `pruefung_umsatz`, `pruefung_bon`, `pruefung_wareneinsatz`, `pruefung_uebersicht` | Gegenrechnungen gegen LINAs Aggregate |
| `sync_status`, `backfill_fortschritt` | Läuft der Import? |
| `regelwerk` | Auswahlliste für den Regelwerk-Dropdown |

### `manual` — was von Hand gepflegt wird (8)

Das einzige Schema, in das **geschrieben** wird. Muss sichtbar bleiben, weil hier erfasst
und nicht nur gelesen wird.

| Tabelle | Wofür |
|---|---|
| `massnahme` | Maßnahmen-Tracking, ersetzt das Excel-Blatt |
| `ursache`, `ursache_katalog` | Die 21 Ursachen aus dem Dropdown und ihre Zuordnung |
| `om_einschaetzung` | Vor-Ort-Score des Operations Managers, 1–5 |
| `online_bewertung` | Aus YEXT, eigener Sync-Rhythmus |
| `betrieb_standort` | Adresse und Koordinaten für die Karte — **derzeit leer**, siehe [`befunde-datenlage.md`](befunde-datenlage.md) Befund 8 |
| `betrieb_hauptkonzept` | Auflösung mehrdeutiger Markenzuordnungen |
| `betrieb_fremd_id` | Brücke zu YEXT, später OpenTable und Bounti |

### `ampel` — das Regelwerk (3)

Klein, fachlich lesbar, und bewusst **Daten statt Code**, damit sich Schwellen ändern lassen,
ohne dass jemand deployen muss.

`regelwerk` (global vs. betriebsindividuell) · `regel` (Schwellen je Bereich) ·
`beschriftung` (die Emoji-Zuordnung)

### `core` — nichts mehr (0)

Anfangs blieb `core.betrieb` sichtbar, weil drei BWA-Karten direkt darauf jointen, um den
Betriebsnamen an `mart.kennzahlen_aktuell` zu hängen. Das war nach dem Grundsatz keine
Ausnahme, sondern eine **Lücke in `mart`** — `kennzahlen_aktuell` war die einzige
`mart`-Sicht ohne Namen.

Migration `0009_kennzahlen_namen.sql` schließt sie mit **`mart.bwa_kennzahl`**: dieselben
Daten plus `betrieb`, `stadt`, `konzept` und `gebucht`. Seither greift keine der 98 Karten
mehr auf `core` zu, und das Schema ist vollständig versteckt.

---

## Nur in Detailansichten (29) — ganz `core`

Alle 29 sind in `mart` aufbereitet. **Wer sie direkt abfragt, stolpert über eine der stillen
Fallen** — genau die, die `mart` ausräumt:

| Tabelle | In `mart` als | Die Falle beim Direktzugriff |
|---|---|---|
| `umsatzbericht_tag` | `umsatz_tag` + `umsatz_tag_sparte` | Enthält Gesamt- **und** Hauptspartenzeilen. Eine Summe über alles ergibt den **doppelten Umsatz** |
| `kennzahlen_monat` | `kennzahlen_aktuell` | Append-only mit `abgerufen_am` im Schlüssel. Ohne `DISTINCT ON` zählt jede Nachbuchung mit |
| `artikelverkauf_tag` | `artikelverkauf` | Ohne die Zeitraum-Sichten rechnet man die Vergangenheit mit **heutiger** Kalkulation |
| `artikel` | `artikelverkauf` | Ist der Verkaufs**katalog**, nicht die Verkäufe — die ähnlichen Namen stehen im Verzeichnis direkt untereinander |
| `artikel_stand`, `artikel_stand_zeitraum` | ebd. | Momentaufnahmen; `fixer_we` ist der **heutige** Ansatz |
| `artikel_warengruppe_stand`, `_zeitraum` | ebd. | Warengruppe gilt rückwirkend, der Wareneinsatzansatz nicht |
| `betrieb_konzept` | `konzept_zuordnung` | Ist n:m — ein Markenschnitt darüber zählt mehrfach zugeordnete Betriebe **mehrfach** |
| `konzept` | ebd. | Derzeit leer; alle Betriebe laufen als „(nicht zugeordnet)" |
| `personalkosten` | `mart.personalkosten` | Posten decken Zeiträume ab, die sich überlappen können — Summieren zählt doppelt |
| `zeitzonenbericht_stunde`, `_zone` | `umsatz_stunde`, `umsatz_zeitzone` | Geschäftstag läuft 08:00–07:59; Stunden 0–7 gehören ans **Ende** |
| `einkaufspreis_stand` | `preisentwicklung_ware` | Ohne Vormonatsvergleich schwer zu lesen |
| `ware`, `ware_stand`, `warengruppe`, `einheit`, `lieferant` | `preisentwicklung_ware`, `deckungsbeitrag_warengruppe` | Reine Dimensionen, in den Sichten schon aufgelöst |
| `hauptsparte`, `feinsparte`, `verkaufsstelle`, `zeitzone` | in allen Umsatzsichten | Dimensionen mit Namen — in `mart` bereits gejoint |
| `bwa_buchungsstand` | `datenstand` | Sagt allein nicht, ob ein Monat gebucht **oder** leer ist |
| `schwellenwert_betrieb` | `round_table_vergleich()` | Betriebsindividuelle Schwellen; ohne Regelwerk-Kontext irreführend |
| `bestellung`, `bestellposten`, `inventurtermin` | — | Noch nicht ausgewertet, Struktur steht |
| `betrieb` | `mart.betrieb`, `mart.bwa_kennzahl`, jede `mart`-Sicht | Trägt die BWA-Brücke `lina_betrieb_id`; in `mart` überall schon aufgelöst |

---

## Nicht synchronisiert (42)

Schema-Filter auf der Datenbankverbindung: `core, manual, ampel, mart`.

| Schema | Objekte | Warum nicht |
|---|---|---|
| `part` | 36 | Ausschließlich Partitionskinder — `artikelverkauf_tag_2026_03` und ähnlich. Werden nie direkt abgefragt; die Elterntabelle in `core` liest sie mit |
| `sync` | 5 | Betriebszustand des Importers. Was man davon sehen will, steht in `mart.sync_status` und `mart.backfill_fortschritt` |
| `raw` | 1 | Die Versicherung: JSONB-Blobs, für Auswertungen wertlos, im Umfang das Größte, was hier liegt |

Ohne diese Einschränkung zeigt Metabase rund 110 Tabellen, davon etwa 70 ohne jede
fachliche Bedeutung.

---

## Wieder ändern

**Der ganze Satz auf einmal** — die Regel steht in `metabase/sichtbarkeit.ts`:

```bash
bun run metabase/sichtbarkeit.ts     # startet auf :8898
# dann http://localhost:8898/ öffnen und „Anwenden" klicken
```

Dort stehen zwei Mengen: `SICHTBAR` (`mart`, `manual`, `ampel`) und `VERSTECKT` (`core`).
Ein zweiter Lauf ändert nichts, was schon stimmt, und meldet je Schema, wie viele Tabellen
sichtbar bzw. versteckt sind. **Nach jeder Migration, die eine Tabelle ergänzt, einmal
laufen lassen** — neue Tabellen sind in Metabase zunächst sichtbar.

Der Umweg über einen eigenen Port hat denselben Grund wie bei den Dashboards: Metabases
`connect-src 'self'` lässt kein Skript im Metabase-Tab von außen laden. Siehe
[`dashboards.md`](dashboards.md).

**Einzelne Tabelle von Hand:** Admin → Tabellenmetadaten → Schema wählen → Sichtbarkeit.

**Ganzes Schema:** Admin → Datenbanken → *LINA* → Schemata. Achtung: eine Änderung dort
löst einen Re-Sync aus. Tabellen, die aus dem Filter fallen, werden **deaktiviert, nicht
gelöscht** — ihre Metadaten und die Sichtbarkeitseinstellung bleiben erhalten und gelten
wieder, sobald das Schema zurückkommt.

**Nach einer neuen Migration:** Admin → Datenbanken → *LINA* → „Datenbank jetzt
synchronisieren", danach `bun run metabase/sichtbarkeit.ts`. Neue Tabellen sind zunächst
**sichtbar** — das Skript setzt sie auf den Stand, der in `SICHTBAR`/`VERSTECKT` steht.
