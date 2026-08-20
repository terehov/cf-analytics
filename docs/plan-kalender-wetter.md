# Plan: was Feiertage, Ferien und Wetter am Umsatz bewegen

Stand 14.08.2026.

**Der Anlass ist eine Frage, auf die es keine Antwort gab.** Feiertage und Schulferien
liegen seit Migration `0051` in der Datenbank, seit `0079` zieht der Nachtlauf sie selbst
nach — 1.127 Feiertage, 591 Ferienzeiträume, zehn Bundesländer. Ausgewertet wird davon
**nichts**. `mart.vergleichstag` rechnet zwar jeden Tag gegen seine vier Vorgänger, aber
keine einzige der elf Kartendateien in `metabase/` greift die Sicht auf. Geladen, gerechnet,
nie gezeigt.

Dieser Plan schließt das und nimmt das Wetter gleich mit — es ist am selben Vergleichstag
der letzte offene Punkt und braucht denselben Unterbau.

**Alle Zahlen hier sind gemessen, nicht geschätzt.** Grundlage ist die lokale Datenbank am
14.08.2026. Sie ist für das Belegarchiv ein Torso (`docs/backfill.md`), für die hier
benutzten Tabellen aber vollständig: `mart.umsatz_tag` trägt 443.304 Tageszeilen vom
01.01.2018 bis 12.08.2026 über alle 141 Betriebe.

---

## 1. Ausgangslage

| | Stand | |
|---|---|---|
| `manual.feiertag` | 1.127 Zeilen bis 26.12.2027 | wird von `0079` nachgezogen |
| `manual.schulferien` | 591 Zeilen bis 11.01.2028 | wird von `0079` nachgezogen |
| `manual.marktindex` | 101 Monate bis 05/2026 | keine Karte |
| `mart.vergleichstag` | Sicht, nicht materialisiert | **keine Karte** |
| `mart.betrieb_kalender` | Sicht | **keine Karte** |
| `mart.markt_vergleich` | Sicht | **keine Karte** |
| Wetter | — | existiert nicht |
| Aggregation „was bringt ein Feiertag" | — | existiert nicht |

**Die Abdeckung ist der wunde Punkt und bleibt es auch nach diesem Plan.** Der Kalender
hängt an PLZ → Bundesland, das Wetter an Koordinaten; beides steht in
`manual.betrieb_standort`, und dort stehen **60 von 141 Betrieben** (48 verschiedene
Koordinaten). Neun der fehlenden 81 haben laufenden Umsatz 2026: zusammen **15,1 Mio € von
68,7 Mio €, also 22 %**, angeführt vom umsatzstärksten Betrieb der Gruppe. Die Liste steht
in `mart.kalender_fehlend`.

**Entschieden am 14.08.2026: die Lücke wird hier nicht geschlossen** — Eugene pflegt die
Standorte später nach. Der Plan muss sie deshalb **sichtbar** machen, in Prüfzeile und
Dashboard, sonst liest sich jede Kachel wie eine Aussage über die ganze Gruppe (Regel 10).
Sobald die Standorte da sind, wachsen die Sichten von selbst mit; kein Codeeingriff.

---

## 2. Der Befund, der den Plan trägt

`mart.vergleichstag` ist nicht nur „nicht materialisiert" — sie ist **so nicht
materialisierbar**.

Die Sicht holt je Zeile über `LEFT JOIN LATERAL … ORDER BY geschaeftstag DESC LIMIT 4` ihre
vier Nachbartage. Für einen Betrieb und einen Monat ist das sofort da. Über den ganzen
Bestand nicht:

| Variante | Aufbau von 188.640 Zeilen |
|---|---|
| heutige `LATERAL`-Fassung | **nach 10 Minuten abgebrochen** |
| Umbau auf Fensterfunktion + Kumulierung | **16,1 s** |

Der Umbau ist keine Näherung. Gegenprobe über einen Betrieb, 222 Tage in 2026, gegen die
Originalsicht: **null Abweichung** in `umsatz_vergleich`, `vergleichstage`,
`ferien_abweichung` und `vergleich_von`.

**Warum der Trick funktioniert.** Der Vergleichsvorrat (kein Feiertag, Umsatz > 0) bekommt je
Betrieb und Wochentag eine laufende Nummer und eine kumulierte Summe. Der Schnitt der letzten
vier Vorrats-Tage vor einem beliebigen Tag ist dann eine Differenz zweier kumulierter Werte
statt einer eigenen Suche — zwei Gleichheits-Joins statt 188.640 Unterabfragen. Feiertage
bleiben dabei außerhalb des Vorrats, bekommen aber weiterhin einen Vergleichswert; genau die
Eigenschaft, um die es fachlich geht.

Ohne diesen Umbau gibt es keine Kachel über alle Betriebe. Deshalb steht er in Phase 1 und
nicht später.

---

## 3. Was die Zahlen sagen werden

Prototypisch gerechnet, lokal, ab 2023, nur saubere Fälle (vier volle Vergleichstage).
Median der Abweichung gegen die letzten vier gleichen Wochentage:

| Feiertag | Tage | Betriebe | Median |
|---|---:|---:|---:|
| Christi Himmelfahrt | 190 | 52 | **+68,4 %** |
| Pfingstmontag | 190 | 52 | +52,4 % |
| Fronleichnam | 175 | 48 | +35,1 % |
| Tag der Deutschen Einheit | 141 | 49 | +34,9 % |
| Ostermontag | 188 | 52 | +32,7 % |
| Tag der Arbeit | 189 | 52 | +16,8 % |
| 2. Weihnachtsfeiertag | 143 | 50 | +1,9 % |
| 1. Weihnachtsfeiertag | 143 | 50 | −0,4 % |
| Allerheiligen | 126 | 44 | −0,6 % |
| Mariä Himmelfahrt | 45 | 15 | −4,2 % |
| Friedensfest | 57 | 15 | −12,0 % |
| Heilige Drei Könige | 123 | 32 | −17,7 % |
| Karfreitag | 188 | 51 | **−32,1 %** |
| Neujahr | 186 | 50 | **−68,7 %** |

Die Spanne geht über **137 Prozentpunkte**. Ein Betrieb, der Christi Himmelfahrt mit einem
gewöhnlichen Donnerstag verglichen bekommt, sieht ein Wunder; an Neujahr sieht er eine
Katastrophe. Beides ist der Kalender.

Die Ferien fallen dagegen ab, und das gehört genauso ins Ergebnis:

| Lage | Tage | Median |
|---|---:|---:|
| Tag in den Ferien, Vergleichstage nicht | 5.756 | −0,2 % |
| Tag außerhalb, Vergleichstage in den Ferien | 1.005 | −5,7 % |

**Über die Gruppe gemittelt sind Schulferien fast wirkungslos.** Die Aussage taugt trotzdem
— aber je Betrieb, nicht als Gruppenzahl: ein Stadtbetrieb im Pendlergeschäft und ein
Ausflugslokal liegen hier mit umgekehrten Vorzeichen. Genau dafür ist die Aufteilung nach
Betrieb und Marke da.

**Was diese Zahlen nicht sind: eine Kausalaussage.** Der Vergleich gegen dieselben vier
Wochentage nimmt Saison, Preisniveau und Betriebsgröße heraus — mehr nicht. Der Plan baut
eine Messung, kein Modell.

---

## 4. Phasen

> **Migrationsnummern vor dem Anlegen prüfen** (`ls migrations/`). Höchste vergebene Nummer
> ist heute `0081`; an diesem Repo arbeitet eine zweite Session. Angewendete Dateien nie
> ändern.

### Phase 1 — Der Unterbau (`0082_vergleichstag_materialisiert.sql`)

**`mart.vergleichstag_basis`** als materialisierte Sicht, gebaut nach dem in Abschnitt 2
gemessenen Muster:

```sql
WITH basis AS (            -- Kalender × Umsatz, je Betrieb und Geschäftstag
  SELECT k.betrieb_key, k.betrieb, k.geschaeftstag, k.wochentag_nr, k.wochentag,
         k.feiertag, k.ist_feiertag, k.ist_schulferien, u.umsatz_netto, u.gaeste
    FROM mart.betrieb_kalender k
    JOIN mart.umsatz_tag u USING (betrieb_key, geschaeftstag)
), markiert AS (           -- wie viele Vorrats-Tage liegen VOR diesem Tag?
  SELECT b.*, count(*) FILTER (WHERE NOT b.ist_feiertag AND b.umsatz_netto > 0)
           OVER (PARTITION BY b.betrieb_key, b.wochentag_nr ORDER BY b.geschaeftstag
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS vorher
    FROM basis b
), vorrat AS (             -- der Vergleichsvorrat, durchnummeriert
  SELECT …, row_number() OVER (PARTITION BY betrieb_key, wochentag_nr
                               ORDER BY geschaeftstag) AS rang
    FROM basis WHERE NOT ist_feiertag AND umsatz_netto > 0
), kum AS (                -- kumulierte Summen über den Vorrat
  SELECT …, sum(umsatz_netto) OVER w AS ku, …
    FROM vorrat WINDOW w AS (PARTITION BY betrieb_key, wochentag_nr ORDER BY rang)
)
SELECT …, round((a.ku - coalesce(v.ku,0)) / least(m.vorher,4), 2) AS umsatz_vergleich, …
  FROM markiert m
  LEFT JOIN kum a ON … AND a.rang = m.vorher        -- obere Kante
  LEFT JOIN kum v ON … AND v.rang = m.vorher - 4    -- untere Kante
  LEFT JOIN kum c ON … AND c.rang = greatest(m.vorher - 3, 1)   -- vergleich_von
```

Dazu:

* **Ruhetage bleiben drin**, mit `vergleichstage = 0` und leerem Vergleichswert. Ein
  Betrieb, der montags schließt, verschwindet sonst montags aus jeder Tagesliste — und eine
  Liste, in der Tage fehlen, ohne dass es dasteht, ist die Fehlerklasse aus Regel 10.
* **Zwei neue Spalten**, weil sie hier fast nichts kosten und fachlich zählen:
  `vortag_feiertag` und `folgetag_feiertag` (`lag`/`lead` über den Kalender). Der Abend vor
  einem Feiertag ist in der Gastronomie ein eigenes Geschäft, und ein Brückentag erklärt
  einen schwachen Freitag besser als jede Wetterlage.
* **`UNIQUE INDEX` auf `(betrieb_key, geschaeftstag)`** — Voraussetzung für
  `REFRESH … CONCURRENTLY`, wie bei `round_table_monat` in `0039`. Dazu ein Index auf
  `geschaeftstag` und einer auf `(feiertag)`.
* **`mart.vergleichstag` bleibt bestehen**, als dünne Sicht über die Materialisierung, mit
  denselben Spaltennamen. Die Sichtkommentare aus `0051` und alles, was darauf verweist,
  bleiben gültig; später kommen dort die Wetterspalten dazu (Phase 3).

**`src/sync/vergleichstag.ts`** nach dem Vorbild von `src/sync/round_table.ts`: eigene
Verbindung, `statement_timeout`, `REFRESH … CONCURRENTLY`, Merker in `sync.merker`, **wirft
nie**. Verdrahtet in `src/sync.ts` direkt neben `roundTableNachlauf()` — also nach dem
Import und nach `pflegeNachlauf()`, denn der schreibt die Feiertage, aus denen die Sicht
liest. Andersherum trüge die Materialisierung den Kalenderstand vom Vortag; dieselbe Falle,
die Yext bis zum 14.08.2026 hatte.

Erwartete Laufzeit nach heutiger Messung: **rund 16 s**, bei geschlossener Standortlücke
etwa das 2,4-Fache der Zeilen, also unter einer Minute. Das ist neben den zwei Minuten des
Artikel-Refresh (`0068`) unauffällig.

### Phase 2 — Die Effektsichten (`0083_kalendereffekt.sql`)

**`mart.kalendereffekt`** — je Betrieb, Kategorie und Ausprägung: `tage`, `median_pct`,
`p25_pct`, `p75_pct`, `letzter_termin`. Kategorien: `feiertag`, `ferienlage`, `wochentag`,
`brueckentag`. Nur Zeilen mit `vergleichstage = 4`; ein Vergleich aus einem Tag ist keiner.

Zwei Entwurfsentscheidungen, die man der Sicht sonst nicht ansieht:

1. **Median statt Mittelwert.** Ein einzelner Betriebsausfall oder eine Großveranstaltung
   kippt einen Mittelwert über 45 Beobachtungen. `p25`/`p75` stehen daneben, damit eine
   breite Streuung nicht wie ein präziser Wert aussieht.
2. **Ein Median lässt sich nicht weiter aggregieren.** Der Median über „alle Betriebe der
   Marke" ist nicht der Median der Betriebs-Mediane. Deshalb rechnen die Karten mit
   Marken- oder Zeitraumfilter **direkt auf `mart.vergleichstag_basis`** mit
   `percentile_cont`, statt `mart.kalendereffekt` weiterzuverdichten. Die Sicht ist die
   Betriebsebene und der Drill-Down; sie ist nicht die Zwischenstufe für Gruppenzahlen.
   Das gehört als Kommentar in die Migration, sonst baut es der Nächste falsch.

Dazu **`mart.feiertag_kalender`**: welche Feiertage stehen in den nächsten 90 Tagen an,
welcher Betrieb ist betroffen, und was war es beim letzten Mal. Das ist die einzige Sicht in
diesem Plan, die nach vorn schaut — und der Grund, warum jemand das Dashboard zweimal
öffnet.

### Phase 3 — Wetter laden (`0084_wetter.sql`, `src/wetter/`)

**Quelle: Bright Sky auf DWD-Messdaten** (`api.brightsky.dev`). Begründung in Abschnitt 5,
Entscheidung E1. Am 14.08.2026 nachgemessen: ein Aufruf liefert ein volles Jahr
(8.737 Stundenwerte für 2018, **keine Lücke**), die nächste Station lag 6 km vom Betrieb.

**`manual.wetter_stunde`** — Stundenwerte je Gitterpunkt: Temperatur, Niederschlag,
Sonnenschein, Wind, Bewölkung, Zustand, dazu `station_id` und `distanz_m` als Herkunft.
Schlüssel ist die **auf zwei Nachkommastellen gerundete Koordinate** (~1,1 km, weit unter
dem Stationsabstand) statt einer eigenen Orts-ID: 48 Gitterpunkte für 60 Betriebe, keine
ID-Verwaltung, und zwei Betriebe an derselben Adresse bekommen bauartbedingt dasselbe
Wetter.

**Warum stündlich und nicht gleich der Tageswert.** 48 × 3.145 Tage × 24 h sind rund
3,6 Mio Zeilen — neben 27,7 Mio Artikelzeilen und 10,6 Mio Stundenzeilen im
Zeitzonenbericht nichts. Dafür ist die Frage „wie war das Wetter zur Mittagszeit" später
ohne 432 neue Aufrufe beantwortbar, und `manual.zeitfenster` aus `0052` steht schon bereit,
um Wetter gegen `mart.umsatz_zeitzone` zu stellen. Ein Gewitter um 4 Uhr räumt keine
Terrasse; ein Kalendertages-Maximum weiß das nicht.

**`mart.wetter_tag`** verdichtet daraus zwei Sätze je Ort und Tag: über den **Kalendertag**
und über das **Gastro-Fenster 11–22 Uhr** (Mittagszeit bis Aktionszeit aus
`manual.zeitfenster`). Beides, damit die Wahl des Fensters überprüfbar bleibt statt
verdrahtet zu sein.

**`src/wetter/quelle.ts`** kapselt den Abruf hinter einer Schnittstelle
(`hole(koordinate, von, bis) → Stundenwerte`). Ein Quellenwechsel — Open-Meteo, DWD direkt —
berührt dann diese eine Datei. Das ist die Antwort auf das Lizenzrisiko aus E1, nicht eine
Vorratsabstraktion.

**`src/wetter/nachlauf.ts`**, verdrahtet vor `vergleichstagNachlauf()`:

* **Rollierendes Fenster:** die letzten 14 Tage werden jede Nacht neu geholt, nicht nur die
  neuen. DWD-Stationen melden nach und korrigieren. 48 Aufrufe.
* **Backfill als Obergrenze, nicht als Handbefehl** — die Entscheidung vom 14.08.2026.
  `WETTER_BACKFILL_ORTE_PRO_NACHT` (Vorgabe 10) arbeitet 48 Orte × 9 Jahre = 432 Aufrufe in
  gut einer Woche ab, neueste Jahre zuerst. Kein Schalter, den jemand vergessen kann.
* **Wirft nie.** Ein fehlender Wetterwert ist eine leere Spalte, kein verlorener Umsatz.
* Ein neuer Eintrag in `sync.quelle` (Register aus `0076`), damit eine stumme Wetterquelle
  im Lauf auffällt und nicht still altert.

`mart.vergleichstag` bekommt in dieser Migration die Wetterspalten — die dünne Sicht aus
Phase 1 wird ersetzt, die Materialisierung bleibt unangetastet.

### Phase 4 — Wettereffekt (`0084`, zweiter Teil)

**`manual.wetter_klasse`** — die Klassengrenzen als **Daten, nicht als Code**, wie das
Ampel-Regelwerk im Schema `ampel`. Eine Grenze zu verschieben ist dann eine Zeile in
`pflege/`, keine Migration. Vorschlag als Startbelegung (Entscheidung E3):

| Kategorie | Klassen |
|---|---|
| Temperatur (Fenster 11–22, Maximum) | < 5 °C, 5–15, 15–22, 22–28, > 28 |
| Niederschlag (Fenster, Summe) | trocken (0), leicht (≤ 2 mm), Regen (> 2 mm) |
| Sonne (Fenster, Anteil) | trüb (< 25 %), gemischt, sonnig (> 60 %) |

**`mart.wetter_effekt`** rechnet je Betrieb und Klasse denselben Median wie
`mart.kalendereffekt` — dieselbe Bauart, dieselben Fallstricke, derselbe Kommentar zur
Nicht-Aggregierbarkeit.

**Warum das trotz Saisonkonfundierung trägt:** heiße Tage sind Sommertage, und Sommer ist
Ferien und Terrassenzeit. Ein roher Zusammenhang zwischen Temperatur und Umsatz misst
deshalb vor allem die Jahreszeit. Der Vergleichstag nimmt genau das heraus — verglichen wird
gegen dieselben vier Wochentage zwei bis vier Wochen zuvor, also gegen ähnliche Saison.
Übrig bleibt das **Wetter gegenüber dem, was in diesen Wochen normal war**. Das ist die
Aussage, die ein Betriebsleiter meint, wenn er „das Wetter war schuld" sagt. Der Satz gehört
in den Sichtkommentar, sonst rechnet der Nächste die rohe Korrelation und wundert sich.

### Phase 5 — Dashboards (`metabase/karten-kalender.ts`, `metabase/dashboards.ts`)

**Neues Dashboard `db_kalender` — „⑫ Feiertage, Ferien, Wetter"**, Sammlung `Betrieb`,
Filter: Betrieb, Marke, Zeitraum. Vier Reiter:

| Reiter | Karten |
|---|---|
| **Feiertage** | `kw_kachel_bester_feiertag` / `kw_kachel_schlechtester` (scalar) · `kw_feiertag_tabelle` (Feiertag, Tage, Median, p25/p75 — klickbar) · `kw_feiertag_marke` (bar) · `kw_naechste_feiertage` (Tabelle aus `mart.feiertag_kalender`) |
| **Ferien & Wochentage** | `kw_ferien_lage` (bar) · `kw_ferien_bundesland` (bar) · `kw_wochentag` (row) · `kw_brueckentag` (scalar) |
| **Wetter** | `kw_temperatur` (bar über Klassen) · `kw_regen` (bar) · `kw_sonne` (bar) · `kw_streuung` (scatter: Temperatur × Abweichung, ein Punkt je Tag) |
| **Tagesliste** | `kw_tagesliste` — Tag, Wochentag, Feiertag, Ferien, Wetter, Umsatz, Vergleich, Abweichung. Das Ziel jedes Drill-Downs von oben |

**Erweiterungen an bestehenden Dashboards** — der Punkt, an dem die Sache im Alltag ankommt
statt in einem eigenen Dashboard zu warten:

* **`dd_betrieb` (③ Betrieb)**, neue Reihe *„War das ein guter Tag?"*: Zeitreihe der
  Abweichung gegen Vergleichstag, dazu bester und schlechtester Tag des Monats mit
  Begründung (Feiertag / Ferienlage / Wetterklasse). Klick führt auf die Tagesliste.
* **`db_umsatz`**: eine Kachel Feiertagseffekt, Klick auf `db_kalender`.
* **`db_datenqualitaet`**: Kachel **„ohne Kalender und Wetter: 9 Betriebe, 15,1 Mio €
  (22 %)"** mit der Liste aus `mart.kalender_fehlend`. Die Zahl steht im Dashboard, weil
  eine Kachel, die 78 % der Gruppe zeigt und wie 100 % aussieht, schlimmer ist als keine.

Drill-Down-Verdrahtung in `metabase/karten-drilldown.ts`, Auswahllisten unverändert
(Betrieb und Marke gibt es schon).

### Phase 6 — Prüfzeilen, Tests, Doku

**Prüfzeilen** in `mart.pruefung_uebersicht` (`0071`-Hygiene: eine Zeile, die nie auf null
geht, liest niemand — deshalb steht die Erwartung dabei):

| Prüfung | Erwartung |
|---|---|
| Vergleichstag: Materialisierung älter als der letzte Lauf | **0** |
| Vergleichstag: Betrieb mit Umsatz, aber ohne Bundesland | **konstant 9**, bis die Standorte gepflegt sind |
| Wetter: Gitterpunkt ohne Messwert für gestern | **0** |
| Wetter: Backfill-Rückstand in Ortsjahren | **fällt**, erreicht 0 nach ~9 Nächten |

**Tests** (`bun test`, Muster aus `src/pflege/tabellen.test.ts` — App-Pool benutzen, kein
`pool.end()`):

* `src/wetter/quelle.test.ts` gegen eine Attrappe: Stunden→Tag-Verdichtung, Zeitzonen an der
  Sommerzeitgrenze, Umgang mit Lücken.
* `src/sync/vergleichstag.test.ts`: die Gegenprobe aus Abschnitt 2 als Test — Fenstervariante
  gegen die `LATERAL`-Fassung auf einem kleinen Bestand, Abweichung muss null sein. Das ist
  die einzige Prüfung, die den Umbau wirklich absichert.
* `src/sync/e2e.test.ts` um die neuen Prüfzeilen ergänzen. **Achtung:** frisch geklonte
  Datenbanken haben unbefüllte materialisierte Sichten (PG 55000) — Prüfzeilen dürfen nicht
  aus `mart.vergleichstag_basis` zählen, sondern aus der Basis darunter. Derselbe Fehler wie
  bei `0080`.

**Doku** (Regel 9, vor dem Commit): `docs/dashboards.md` (neues Dashboard und die drei
Erweiterungen), `docs/datenherkunft.md` (Bright Sky/DWD als vierte externe Quelle),
`docs/entscheidungen.md` (E1–E3 unten), `docs/importer.md` (der Wetter-Nachlauf),
`AGENTS.md` (Migrationstabelle), `docs/offene-punkte.md` (`d4` streichen, siehe unten).

---

## 5. Entscheidungen, die ein Mensch trifft

**E1 — Wetterquelle. Empfehlung: Bright Sky auf DWD-Daten.**
Open-Meteo wäre der bequemere Weg (fertige Tageswerte, ein Aufruf je Ort), scheidet aber
aus: der kostenlose Zugang ist **ausdrücklich auf nicht-gewerbliche Nutzung beschränkt**,
und das hier ist gewerblich. Die *Daten* stehen unter CC-BY 4.0, der *Zugang* nicht — für
eine Auswertung der Concept Family bräuchte es einen kostenpflichtigen Tarif (Preise stehen
nicht auf der Preisseite, wären zu erfragen). Bright Sky liefert DWD-Messdaten, ohne
Schlüssel, ohne Anmeldung, und DWD-Daten sind unter GeoNutzV auch gewerblich frei — mit
Namensnennung, die ins Dashboard gehört. Der Abruf liegt hinter `src/wetter/quelle.ts`;
falls doch Open-Meteo gewünscht ist, ist es eine Datei.

**E2 — Zeitfenster.** Vorschlag 11–22 Uhr nach `manual.zeitfenster`. Beide Verdichtungen
werden gespeichert, die Wahl ist also umkehrbar — aber die Karten zeigen eine davon.

**E3 — Klassengrenzen** aus Phase 4. Der Vorschlag ist geraten, nicht gemessen; nach dem
ersten Lauf gegen die Verteilung nachschärfen. Sie stehen in `manual.wetter_klasse`, also in
`pflege/`, also ohne Migration änderbar.

**E4 — `d4` entfällt.** Der Messaufruf in `src/messen.ts` prüft, ob LINAs
`/finanzen/stat/umsatzwetter` das Wetter je Betrieb und Tag liefert. Zwei der drei möglichen
Antworten führen ohnehin zur externen Quelle, und die dritte wäre bei Betrieben von Dresden
bis Freiburg unbrauchbar. Empfehlung: streichen statt messen; die Zeile in
`docs/offene-punkte.md` entsprechend auflösen.

---

## 6. Was der Plan bewusst nicht tut

* **Die Standortlücke schließen.** 81 Betriebe ohne Koordinate, davon 9 mit Umsatz (22 %).
  Auf Wunsch später von Hand; hier nur sichtbar gemacht. Die Sichten wachsen ohne Codeeingriff
  mit.
* **Events.** Stadtfest, Heimspiel, Baustelle, Konzert — keine automatisierbare Quelle. Bleibt
  das manuelle Freifeld aus der Round-Table-Map.
* **Ein Modell.** Kein Regressionsansatz, keine Wirkungszerlegung zwischen Feiertag, Ferien
  und Wetter. Die drei Effekte werden **nebeneinander** ausgewiesen, nicht gegeneinander
  verrechnet. Wer sie addiert, zählt doppelt — auch das gehört in den Sichtkommentar.
* **Den Marktindex.** `mart.markt_vergleich` hat ebenfalls keine Karte. Eigener, kleiner
  Vorgang; hier nur vermerkt, damit er nicht wieder untergeht.

---

## 7. Reihenfolge

| | Phase | Ergebnis |
|---|---|---|
| 1 | Unterbau `0082` + Nachlauf + Test | Kacheln über alle Betriebe werden überhaupt möglich |
| 2 | Effektsichten `0083` | die Zahlen aus Abschnitt 3, je Betrieb abrufbar |
| 3 | Wetter laden `0084` + `src/wetter/` | Backfill läuft nachts an |
| 4 | Wettereffekt | Wetter steht neben Feiertag und Ferien |
| 5 | Dashboards | der Fachbereich sieht es |
| 6 | Prüfzeilen, Tests, Doku, Commit | |

Nach Phase 2 steht die fachliche Aussage bereits — Phase 3 und 4 sind additiv und blockieren
nichts. Wer abbrechen will, bricht sinnvoll nach Phase 2 oder nach Phase 5 ab.

**Produktion steht auf `0074`; `0075`–`0081` liegen committet und unveröffentlicht.** Die
Migrationen dieses Plans setzen darauf auf und gehen im selben Aufwasch mit.

---

## 8. Umsetzungsstand (20.08.2026)

**Phase 1 und 2 stehen und sind angewendet.** Migrationsnummern sind gegenüber
dem Plan verschoben: `0082` und `0083` waren inzwischen von einer zweiten
Session vergeben.

| Plan | tatsächlich | Stand |
|---|---|---|
| `0082_vergleichstag_materialisiert` | **`0084`** | angewendet |
| `0083_kalendereffekt` | **`0085`** | angewendet |
| `0084_wetter` | **`0086`** | offen |

**Sechs Stellen, an denen der Plan korrigiert werden musste.** Alle sechs sind
gemessen, nicht vermutet; die Belege stehen in `befunde-datenlage.md` und
`fehlerkatalog.md`.

1. **Die Laufzeit stimmt nicht.** Der Plan nennt 16,1 s für 188.640 Zeilen.
   Gemessen: **33,1 s kalt, 35,2 s warm**, und **40,9 s** für den
   `REFRESH CONCURRENTLY` über die 443.304 Zeilen aller 141 Betriebe. An der
   Folgerung ändert das nichts.
2. **Die Gegenprobe der Vorarbeit war nicht tragfähig.** Sie lief über einen
   Betrieb und 222 Tage in 2026 und konnte zwei Fehler nicht sehen: ein
   `WHERE vorher > 0` verlor die Zeilen am Anfang der Historie, und
   `ferien_abweichung` muss bei `vergleichstage = 0` **0** sein und nicht
   `NULL` (1.661 von 9.432 Zeilen, 17,6 %). Beides ist behoben; die Gegenprobe
   ist jetzt ein Test über die volle Historie dreier Betriebe.
3. **Der Plan hätte 81 Betriebe stumm verloren.** `mart.betrieb_kalender`
   kannte nur die 60 mit gepflegter PLZ — die Materialisierung hätte für die
   übrigen keine einzige Zeile gehabt, auch nicht für den reinen
   Wochentagsvergleich. Gelöst über die bundesweiten Feiertage als Rückfall,
   sichtbar in `kalender_quelle` (Entscheidung E5).
4. **Feiertagsnamen wechselten 2020 die Schreibweise.** Eine Gruppierung nach
   Namen hätte vier Feiertage in je zwei Zeilen gespalten, darunter Neujahr —
   den Extremwert. Behoben über `manual.feiertag_alias`.
5. **Der Nullpunkt liegt bei −3,5 %, nicht bei 0.** Ein Tag wird gegen den
   *Mittelwert* von vier Tagen gestellt; bei rechtsschiefen Tagesumsätzen liegt
   der darüber. Ohne diese Korrektur läse jede Kachel die halbe Gruppe als
   schwach.
6. **Die Ferienlage braucht drei Klassen, nicht zwei.** „Vergleichstage nicht"
   ist nur wahr, wenn *alle vier* anders liegen; die Mischfälle (1–3) sind mit
   27.675 Tagen die größte Gruppe und bekommen eine eigene Zeile.

**Die Zahlen aus Abschnitt 3 reproduzieren sich** — die Feiertagstabelle auf
die Stelle genau. Bei den Ferien weicht eine Zeile ab (6.430 Tage / −1,3 %
gemessen gegen 5.756 / −0,2 % im Plan); die Gegenrichtung stimmt exakt. Das
Prototyp-SQL ist nicht erhalten, die fachliche Aussage trägt beide Werte.

**Neu und im Plan nicht enthalten:** der Brückentag ist messbar und deutlich.
Der Tag **vor** einem Feiertag liegt bei **+20,9 pp** gegen den gewöhnlichen
Tag (1.918 Tage), der Tag danach bei −4,7 pp. Das ist mehr als die Hälfte der
Feiertage selbst wert.

## 9. Phase 3 und 4 (20.08.2026)

Migrationen `0086` (Wetter laden), `0087` (Wettereffekt) und `0088`
(Kalender-Ausführungsplan) sind angewendet. Entscheidungen: **E1 Bright
Sky/DWD**, **E2 Fenster 08–24 Uhr** (Eugene, abweichend vom Planvorschlag
11–22), **E3 gemessen statt geraten**, **E4 gestrichen**.

**Fünf weitere Stellen, an denen der Plan nicht trug:**

1. **Die Sonnenklasse maß die Jahreszeit.** „Trüb unter 25 % Anteil" traf im
   Januar 71,2 % der Tage und im Juni 19,6 % — im Fenster 08–24 sind im Winter
   acht von sechzehn Stunden dunkel. Sie rechnet jetzt relativ gegen die
   letzten 28 Tage am selben Ort.
2. **Der Geschäftstag beginnt um 08:00**, nicht um Mitternacht
   (`core.geschaeftstag()`). Der Plan sprach vom „Kalendertag"; wer den nimmt,
   verschiebt das Wetter um acht Stunden gegen den Umsatz.
3. **`last_date` bei Bright Sky liefert nur die Stunde 00:00** dieses Tages —
   8.737 statt 8.760 Werten im Jahr. Ohne Korrektur fehlte in jedem Jahr der
   Silvesterabend.
4. **`WETTER_BACKFILL_ORTE_PRO_NACHT` begrenzt die falsche Größe.** Ein Ort
   trägt neun Jahre, also neun Aufrufe. Die Obergrenze zählt jetzt Ortsjahre,
   also Aufrufe: `WETTER_BACKFILL_JE_LAUF`.
5. **Der Kalender-Ausführungsplan kippte**, als eine zweite Session den
   Kalender-Nachlauf reparierte und aus 10 Bundesländern 16 wurden. Refresh:
   40,9 s → Zeitlimit nach 1.075 s → **92,6 s** nach `0088`. Ursache war ein
   Join auf `geschaeftstag + 1`.

**Gemessene Laufzeiten**

| | |
|---|---|
| `mart.betrieb_kalender` über 141 Betriebe | 22,0 s |
| `REFRESH CONCURRENTLY mart.vergleichstag_basis` | **92,6 s** (443.304 Zeilen) |
| Wetter-Nachlauf, 48 + 66 Aufrufe | 1.024 s, 596.032 Zeilen |
| Bright Sky, ein Ortsjahr 2025 | wenige Sekunden |
| Bright Sky, ein Ortsjahr 2024 | **108 s** — Zeitlimit steht jetzt auf 180 s |

**Offen:** der Wetter-Backfill steht bei 121 von 432 Ortsjahren (2026 und 2025
vollständig, 2024 zu 20/48). Der Rest kommt in den nächsten Nächten von selbst
nach — `mart.wetter_rueckstand` führt die Zahl.

**Phase 5 (Dashboards) ist noch nicht begonnen.** Grund steht im Bericht: drei
der vier zu ändernden Dateien in `metabase/` tragen unversionierte Änderungen
einer zweiten Session.

## 10. Phase 5 und 6 (20.08.2026) — der Plan ist umgesetzt

**`metabase/karten-kalender.ts` mit 16 Karten**, das Dashboard
`db_kalender` („⑫ Feiertage, Ferien, Wetter", Sammlung *Betrieb*, vier
Reiter) und zwei Karten auf bestehenden Seiten. Begründung jeder Darstellung in
`docs/dashboards.md`.

**Abweichungen vom Plan, alle begründet:**

* **Kein Monatsfilter** auf `db_kalender`, nur Zeitraum/Betrieb/Marke. Ein
  Stichmonat ließe von 190 Christi-Himmelfahrt-Tagen einen übrig.
* **Jede Karte rechnet auf der Tagesebene**, keine auf `mart.kalendereffekt` —
  ein Median lässt sich nicht weiterverdichten. Die Effektsicht bleibt der
  Drill-Down auf Betriebsebene.
* **Überall „Punkte gegen einen normalen Tag"** statt roher Prozente, mit
  mitgerechnetem Basiswert unter denselben Filtern.
* Die Reihe *„War das ein guter Tag?"* auf `dd_betrieb` hat eine zweite Session
  gebaut (`dd_betrieb_tagesart`, `dd_betrieb_effektivitaet`) — sie liest
  `mart.vergleichstag`, also die Materialisierung aus `0084`.
* **`0090`**: 2018/2019 bleiben ohne Feiertage und werden nicht nachgezogen
  (entschieden). Die Prüfzeile zählt nur noch Jahre, die der Kalender abzudecken
  behauptet; sichtbar bleiben sie mit `zustand = 'vor Kalenderbeginn'`.

**Die sieben Prüfzeilen stehen** und melden, was sie sollen — Erwartung 0 außer
bei zwei bewusst offenen Zahlen: 9 Betriebe ohne Standort (konstant, bis Eugene
sie pflegt) und der Wetter-Backfill-Rückstand (fällt von Nacht zu Nacht).

**Damit ist der Plan abgearbeitet.** Was er ausdrücklich nicht tut, tut er
weiterhin nicht: die Standortlücke schließen, Events erfassen, ein Modell
bauen, den Marktindex anfassen.
