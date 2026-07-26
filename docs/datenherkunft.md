# Datenherkunft

Wo jede Zahl herkommt und **wie die Tabellen zusammenfinden**. Die Frage „woher kommt dieser
Wert" beantwortet man hier von oben nach unten, die Frage „wie verbinde ich zwei Tabellen" im
Abschnitt *Die Schlüssel*.

Ergänzt drei Dateien, ersetzt keine davon:
`lina-api-inventar.md` beschreibt die **Endpunkte** im Detail, `datenmodell.md` die
**Schema-Entscheidungen**, `kennzahlen-mapping.md` die Zuordnung **Excel-Kennzahl → LINA-Feld**.

---

## Die Kette

```
LINA (app.lina.de)  →  raw.api_antwort  →  core.*  →  mart.*  →  Metabase
                       append-only         Upsert     Sichten
                       die Versicherung    ableitbar  hier fängt jede Frage an
```

**`raw` ist die einzige Schicht, die nicht neu erzeugbar ist.** Alles in `core` darf jederzeit aus
`raw` neu aufgebaut werden — deshalb ist `raw` append-only und vollständig, und deshalb hat
Priorität, es tief zu füllen, nicht `core` schön zu machen.

---

## Was aktiv geholt wird

Zehn Berichte und sieben Momentaufnahmen. Das Register steht in `src/lina/endpunkte.ts`; ein
neuer Bericht ist dort ein Eintrag.

### Berichte — abgeschlossene Fakten, rückwirkend holbar

Alle auf **Konzernebene**: eine Antwort enthält alle 141 Betriebe. Das ist der Grund, warum der
Backfill so billig ist — acht Aufrufe je Kalendertag, nicht 8 × 141.

| Endpunkt | Pfad | Takt | landet in |
|---|---|---|---|
| `getUmsatzbericht` | `/intranet/analytics/getUmsatzbericht` | Tag | `core.umsatzbericht_tag` (Gesamtwert) |
| `getUmsatzbericht:speisen` | derselbe, `hauptsparten=10001` | Tag | `core.umsatzbericht_tag` (Hauptsparte) |
| `getUmsatzbericht:getraenke` | derselbe, `hauptsparten=10002` | Tag | `core.umsatzbericht_tag` (Hauptsparte) |
| `getZeitzonenbericht` | `/intranet/analytics/getZeitzonenbericht` | Tag | `core.zeitzonenbericht_stunde` |
| `getVordefinierteZeitzonenBericht` | `/intranet/analytics/getVordefinierteZeitzonenBericht` | Tag | `core.zeitzonenbericht_zone` |
| `getArtikelverkaufsbericht` | `/intranet/analytics/getArtikelverkaufsbericht` | Tag | `core.artikelverkauf_tag` **+ `core.artikel` + `core.artikel_stand`** |
| `getPersonalkosten` | `/intranet/analytics/getPersonalkosten` | Tag | `core.personalkosten` **+ `core.schwellenwert_betrieb`** |
| `getAktionsbericht` | `/intranet/analytics/getAktionsbericht` | Tag | — noch keine Transformation, nur `raw` |
| `getKennzahlen:absolut` | `/intranet/analytics/getKennzahlen`, `mode=absolut` | **Jahr** | `core.kennzahlen_monat.wert_absolut` |
| `getKennzahlen:relativ` | derselbe, `mode=relativ` | **Jahr** | `core.kennzahlen_monat.wert_prozent` |

**`getKennzahlen` ist zwei Aufrufe je Jahr, nicht je Tag.** Euro und Prozent kommen getrennt und
landen als **zwei Zeilen** mit unterschiedlichem `abgerufen_am`, jede mit genau einer gefüllten
Spalte. Wer sie zusammenführt, nimmt `mart.kennzahlen_aktuell` — nicht `DISTINCT ON`, siehe
`fehlerkatalog.md`.

**`hauptsparten` erwartet `posId`, nicht `nummer`.** 10001 = Speisen, 10002 = Getränke. Mit
`nummer` kommt kommentarlos 0 € zurück.

### Momentaufnahmen — nur „jetzt", kein Backfill

LINA **überschreibt** Stammdaten. Es gibt keine Preishistorie; `prices[].updated` verrät nur, wann
zuletzt geändert wurde, nicht was vorher galt. Ein Aufruf liefert immer den heutigen Stand — 100
Backfill-Posten dafür würden hundertmal dasselbe holen. Deshalb: **eine je Kalendermonat**, auf den
Monatsersten gesetzt, `--historie` überspringt sie.

| Endpunkt | Pfad | landet in |
|---|---|---|
| `analyticsFilterOptions` | `/intranet/api/analyticsFilterOptions` | `core.feinsparte` **+ `core.betrieb.lina_betrieb_id`** |
| `articleApi:franchise` | `/wawi/rezept/articleApi?franchise=1` | `core.warengruppe`, `core.artikel_warengruppe_stand` |
| `wawi:units` | `/wawi/api/units` | `core.einheit` |
| `wawi:suppliers` | `/wawi/api/suppliers` | `core.lieferant` — **Datenminimierung, siehe unten** |
| `wawi:items` | `/wawi/api/items?archive=0` | `core.ware`, `core.ware_stand`, `core.einkaufspreis_stand` |
| `wawi:orders` | `/wawi/api/orders` | `core.bestellung`, `core.bestellposten` |
| `wawi:inventory` | `/wawi/inventory/inventory` | `core.inventurtermin` |

**Was hier fehlt, ist dauerhaft weg.** Jeder Monat ohne Momentaufnahme ist eine Lücke in der
Margenbetrachtung, die sich nicht nachholen lässt.

### Was bewusst nicht geholt wird

| | Warum |
|---|---|
| Betriebs-Reports (`getReport:*`, 72 Stück) | im Register als `aktiv: false`. Kosten 141 Aufrufe je Zeitraum statt einem. |
| Kassenjournal | ungeprüft, vermutlich HTML statt JSON, um Größenordnungen umfangreicher und **personenbezogen** (Kellner, Zeitstempel). |
| Personalberichte | im Browser verifiziert gesperrt. |
| Storno | wird bei Concept Family offenbar nicht genutzt. Begründung in `entscheidungen.md`. |

### Was aus LINA gar nicht kommt

`manual.*` — Online-Bewertungen (YEXT, eigener Sync), OM-Einschätzung, Ursachen, Maßnahmen, und
die Auflösung mehrdeutiger Markenzuordnungen.

**Dazu Adressen und Koordinaten der Betriebe.** Am 26.07.2026 wurden alle 489 archivierten
API-Antworten rekursiv nach Adress- und Geofeldern durchsucht — kein einziger Treffer für
Betriebe. `analyticsFilterOptions` liefert `{id, name}`, die Berichtsendpunkte
`{name, encId}` plus Kennzahlen. `core.betrieb.stadt` existiert im Schema und bleibt bei
allen 141 Betrieben `NULL`.

Bemerkenswert: **für Lieferanten liefert LINA sehr wohl Adressen** (`wawi:suppliers` mit
`strasse`, `plz`, `ort`). Das Konzept ist also da, es wird für Betriebe nur nicht geführt.

Deshalb `manual.betrieb_standort` (Migration `0008`) mit ausgewiesener `herkunft`. **Nicht
aus dem Betriebsnamen ableiten** — „Aposto Aalen GmbH" trägt die Stadt, „Alter Kranen GmbH"
nicht, und fünf Betriebe heißen nach derselben Stadt, ohne dieselbe zu sein. Ein Betrieb an
der falschen Stelle auf einer Karte wird nicht hinterfragt, ein fehlender schon.

---

## Die Schlüssel

**Das hier ist der Abschnitt, der schon einmal 7.860 Zeilen gekostet hat.** LINA benutzt für
dieselbe Sache je nach Endpunkt verschiedene Schlüssel, und keiner davon ist überall vorhanden.

### Betrieb — zwei Identitäten, eine Brücke

| Schlüssel | Wo er vorkommt | Wo nicht |
|---|---|---|
| `encId` (40 Hex-Zeichen) | **alle** Berichte; zugleich der `storeId`-Parameter der Betriebs-Reports | `getKennzahlen`, `analyticsFilterOptions` |
| numerische LINA-ID | `getKennzahlen` (`children[].key`), `analyticsFilterOptions.betriebe[].id` | alle Berichte |

Die beiden treffen sich **nirgends in einer einzigen Antwort**. Verbunden werden sie über den
**Namen**, und zwar genau einmal, beim Laden von `analyticsFilterOptions`:

```
Bericht  ──encId──▶  core.betrieb.enc_id
                              │
                     Name (141 von 141 eindeutig, nachgemessen)
                              │
analyticsFilterOptions ──id──▶ core.betrieb.lina_betrieb_id
                              │
getKennzahlen ────────key─────┘
```

Daraus folgt die Reihenfolge im Import: **erst ein Tagesbericht** (legt die Betriebe an), **dann
`analyticsFilterOptions`** (heftet die ID an), **dann `getKennzahlen`**. Kodiert in
`einreihPrioritaet()`, siehe `importer.md`.

**Im eigenen Schema wird ausschließlich über `betrieb_key` gejoint.** `enc_id` und
`lina_betrieb_id` sind Außengrenzen-Schlüssel und haben in einer Auswertung nichts verloren.

> **Der Betriebsname ist NICHT eindeutig.** In `getKennzahlen` liefert die *Gruppe* die Marke, das
> *Kind* nur die Stadt — unter der Gruppe „Enchilada" heißt der Betrieb schlicht „Karlsruhe". Der
> Name erscheint fünfmal. Das sind fünf Restaurants in einer Stadt, nicht ein Restaurant in fünf
> Marken; gegengeprüft am Juniumsatz, der auf den Cent zur Excel-Zeile „Enchilada Karlsruhe" passt.
> Die Namensbrücke oben ist trotzdem tragfähig, weil sie auf den **vollen** Namen aus
> `analyticsFilterOptions` geht, nicht auf den verkürzten aus `getKennzahlen`.

### Artikel und Ware — zwei verschiedene Dinge

| | ist | Schlüssel von LINA | Tabelle |
|---|---|---|---|
| **Artikel** | was **verkauft** wird (6.451) | `artnr` | `core.artikel.artikelnummer` |
| **Ware** | was **eingekauft** wird (898) | `id` | `core.ware.lina_id` |

**`articleApi` verknüpft über `artnr`, nicht über `id`.** Am 25.07.2026 gemessen: `artnr` trifft
die Artikelnummern des Verkaufsberichts, `id` trifft **keine einzige**. Der teuerste denkbare
Fehler an dieser Stelle — es gibt einen eigenen Test dagegen.

Zwischen Artikel und Ware gibt es **keine** Verbindung in den Daten. Die Brücke wäre die Rezeptur;
statt sie aufzulösen, benutzen wir LINAs fertigen `fixed_we` je Artikel.

### Die Stände — über Zeiträume, nie über Monatsgleichheit

`core.artikel_stand` und `core.artikel_warengruppe_stand` bekommen **nur bei Änderung** eine Zeile.
Ein Join über `stand.monat = date_trunc('month', tag)` findet deshalb für die meisten Monate
nichts — und liefert `NULL`, was wie „kein Ansatz hinterlegt" aussieht statt wie „falsch
verknüpft".

Richtig sind die Zeitraumsichten:

```sql
JOIN core.artikel_stand_zeitraum z
  ON z.artikel_key = av.artikel_key
 AND av.geschaeftstag >= z.gilt_ab
 AND (z.gilt_bis IS NULL OR av.geschaeftstag < z.gilt_bis)
```

Ein bewusster Unterschied zwischen den beiden Sichten:

| | rückwirkend gültig? | Warum |
|---|---|---|
| `artikel_stand_zeitraum` (Wareneinsatzansatz) | **nein** | Ein Preis von heute auf 2023 angewandt ist eine konkret falsche Zahl. |
| `artikel_warengruppe_zeitraum` (Einordnung) | **ja**, bis `-infinity` | Die Momentaufnahme läuft nur vorwärts; ohne Rückgriff hätte die gesamte Historie keine Warengruppe. Eine Einordnung ändert sich selten, die älteste bekannte ist die beste Schätzung. Ausgewiesen als `mart.artikelverkauf.warengruppe_geschaetzt`. |

### Die übrigen Fremdschlüssel

Alle Stammdatentabellen tragen `lina_id` als Außengrenzen-Schlüssel und einen eigenen
`*_key` als Primärschlüssel. **Die Verweise zwischen ihnen sind absichtlich `NULLABLE`:**
Einheiten, Lieferanten und Waren kommen als getrennte Posten in beliebiger Reihenfolge an. Wer
zuerst da ist, wird ohne Verweis gespeichert; die nächste Momentaufnahme hat alles beisammen. Ein
Satz ohne Verweis ist besser als ein gescheiterter Posten, der 20 Minuten später erneut gegen LINA
läuft.

---

## Zwei Zeitbegriffe, die nicht vermischt werden dürfen

| | Typ | Bedeutung |
|---|---|---|
| **Zeitpunkt** | `timestamptz`, intern UTC | `abgerufen_am`, LINAs `from`/`to` als Unix-Epoch. Ein echter Moment. |
| **Geschäftsdatum** | `date`, ohne Zeitzone | `geschaeftstag`, `monat`, LINAs `DD.MM.YYYY`-Parameter. Ein zeitzonenloses Etikett für einen Berliner Abrechnungszeitraum. |

„1. Juni" im Round Table nach UTC umzurechnen wäre ein Kategorienfehler — der Wert hat keine
Uhrzeit.

**Der Geschäftstag läuft 08:00 bis 07:59 des Folgetags.** Belegt durch das `hours`-Array des
Zeitzonenberichts (`8,9,…,23,0,…,7`). Die Stunden 0–7 gehören fachlich zum **Vortag**;
`core.zeitzonenbericht_stunde.geschaeftstag` ist bereits umgerechnet. Nach `stunde` zu sortieren
ergibt deshalb keinen zeitlichen Verlauf.

`Europe/Berlin` steht an genau **zwei** Stellen: `core.geschaefts_zeitzone()` und
`src/lib/time.ts`. Die Umgebungszeitzone ist bewusst nicht tragend. `core.pruefe_lina_epoch()`
prüft laufend, ob LINA noch in Berliner Zeit rechnet, und schreibt Abweichungen nach
`sync.schema_abweichung`.

---

## Was die Zahlen nicht sagen

Vier Eigenheiten, die jede Auswertung betreffen — alle nachgemessen, nicht vermutet.

**Die letzten fünf bis sechs Tage sind unvollständig.** LINAs Konzernberichte füllen sich
nachträglich. Am 26.07.2026: die letzten vier Tage komplett leer, der fünfte zu einem Sechstel.
Deshalb holt der tägliche Lauf ein Fenster von zehn Tagen. Messreihe in `importer.md`.

**Die BWA hinkt ein bis zwei Monate nach** und wird **rückwirkend korrigiert**. Deshalb ist
`core.kennzahlen_monat` append-only mit `abgerufen_am` im Schlüssel, und deshalb weist jede
Round-Table-Zeile mit `bwa_monat` aus, aus welchem Monat ihre Personal- und Wareneinsatzwerte
stammen. Der Buchungsstand ist **je Betrieb verschieden**: am 25.07.2026 waren für Juni erst 22
von 131 Betrieben gebucht, für Mai 59.

**Ungebuchte Monate liefert LINA als `0,00`, nicht als `NULL`.** Wer nur auf `IS NOT NULL` filtert,
holt sie sich als „jüngsten Stand" zurück — und 0 % Personalkosten ist grün.

**Der POS-Artikelumsatz ist NICHT das BWA-Umsatzkonto.** Die beiden weichen systematisch ab. Wer
sie vergleicht, liest vorher den Kommentar an `mart.pruefung_wareneinsatz`.

---

## Datenminimierung bei Lieferanten

`/wawi/api/suppliers` liefert 28 Felder für 540 Geschäftspartner. Übernommen werden **fünf**:
`lina_id`, `name`, `aktiv`, `mindestbestellwert`, `liefertage`.

Bewusst **nicht** gespeichert: `ustid`, `hrb`, `kreditor`, `gegenkonto*`, `tel`, `Fax`, `email`,
`ort`, `strasse`, `hnr`, `plz`, `kdnr`, `partner`, `netz`, `re_def`, `id_general`, `api`,
`einzelp`, `dh_supplier_id`. Steuer-, Bank- und Kontaktdaten, für jede geplante Auswertung ohne
Nutzen — und ein Datenbestand, den man nicht hat, kann auch nicht abfließen.

Die Transformation hat eine **explizite Whitelist**, und ein Test weist die Abwesenheit dieser
Spalten in der Datenbank nach. Wer hier eine Spalte ergänzt, begründet das im Ticket.

Dasselbe gilt für `getStoreData`: die Antwort enthält `db_name`, `db_user` und `db_pass` im
Klartext sowie IBAN, BIC und Steuernummer. **Wird nicht gelesen und nicht gespeichert.**

---

## Wo man nachsieht, ob die Herkunft noch stimmt

```sql
SELECT * FROM mart.pruefung_uebersicht;      -- rechnet LINAs Aggregate gegen die feinere Ebene
SELECT * FROM mart.betrieb_ohne_lina_id;     -- Betriebe ohne BWA-Brücke, Erwartung: leer
SELECT * FROM sync.schema_abweichung WHERE quittiert_am IS NULL;
SELECT * FROM mart.backfill_fortschritt;     -- welcher Zeitraum ist je Endpunkt abgedeckt
```

Die Prüfsichten kosten **keinen einzigen zusätzlichen LINA-Aufruf** — sie rechnen aus Daten, die
ohnehin da sind. Grundsatz: nichts korrigieren, nur sichtbar machen. Wer automatisch „korrigiert",
verschiebt den Fehler nur dorthin, wo ihn keiner sucht.
