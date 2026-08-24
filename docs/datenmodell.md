# Datenmodell

Sieben Schemata statt eines großen `public`. In Postico sieht man damit sofort, ob man auf Rohdaten, abgeleitete Daten oder Handgepflegtes schaut, und Metabase bekommt nur die vier zu sehen, die etwas bedeuten.

```
raw     unveränderte API-Antworten, append-only          nicht in Metabase
part    ausschließlich Partitionskinder                  nicht in Metabase
core    Stammdaten und Bewegungsdaten, benannt nach den LINA-Berichten
manual  OM-Einschätzung, Ursachen, Maßnahmen, YEXT-Bewertungen
ampel   Regelwerke
sync    Betriebszustand des Importers                    nicht in Metabase
mart    Sichten für Metabase — hier fängt jede Frage an
```

Welche Schemata Metabase synchronisieren soll und warum: `metabase.md`.
Woher die Daten kommen und ueber welche Schluessel die Tabellen zusammenfinden: `datenherkunft.md`.
Welche Fehler beim Bauen dieses Modells gemacht wurden: `fehlerkatalog.md`.

## Die acht Entscheidungen

**1. `raw.api_antwort` speichert die komplette Antwort als JSONB, append-only.**
LINAs API ist undokumentiert und unversioniert. Ändert sich eine Struktur oder war eine Semantik falsch verstanden — was in Phase 1 dreimal passiert ist — muss rückwirkend neu transformiert werden können, ohne 141 Betriebe × Jahre neu zu ziehen. Kostet wenig: die Konzern-Endpunkte packen alle 141 Betriebe in *eine* Antwort. `payload_hash` erkennt unveränderte Antworten und macht BWA-Nachbuchungen sichtbar.

**2. `core.kennzahlen_monat` ist append-only mit `abgerufen_am` im Schlüssel.** Siehe `architektur.md`, Abschnitt Time Travel.

**3. Beide BWA-Modi in einer Zeile: `wert_absolut` und `wert_prozent`.**
`mode=absolut` liefert Euro, `mode=relativ` die fertigen Prozentwerte — zwei Aufrufe je Jahr. Der Spaltenkommentar warnt explizit davor, `wert_prozent` selbst aus den POS-Hauptsparten zu rechnen: das ergibt nachweislich falsche Werte (45,90 statt 23,64).

**4. Prozentwerte durchgängig als Prozentzahl, nie als Bruch.**
Das Excel speichert `0,2364`, LINA liefert `23.64`. Solche Uneinheitlichkeiten produzieren stille Faktor-100-Fehler.

**5. Ampel-Regelwerke als Daten, nicht als Code.**
`ampel.regelwerk` + `ampel.regel`. Eine Regel hat eine `richtung` (`hoeher_ist_besser` für Umsatz, Bewertung, OM; `niedriger_ist_besser` für Personal und Wareneinsatz) und eine `schwellenquelle`:

- `fest` → Schwellen aus dem Excel-Blatt „Regeln"
- `lina_betrieb` → betriebsindividuelle Schwellen aus `core.schwellenwert_betrieb`, die LINA in `getPersonalkosten.pekThreshold` mitliefert

Umschalten ist ein Funktionsargument, kein Deploy. In Metabase wird daraus ein Dropdown mit `mart.regelwerk` als Werteliste. `mart.round_table_vergleich()` zeigt beide nebeneinander plus `weicht_ab` — die fachlich interessantere Sicht, weil sie zeigt, **wo die Wahl der Schwellen überhaupt ein anderes Urteil ergibt**.

**6. Der BWA-Versatz wird sichtbar gemacht, nicht versteckt.**
`mart.round_table()` nimmt den Umsatz aus dem POS für den Berichtsmonat und für Personal und Wareneinsatz **den jüngsten verfügbaren BWA-Monat bis einschließlich des Berichtsmonats — je Betrieb einzeln**. `bwa_monat` weist aus, welcher das war. Im Excel steckt derselbe Versatz (Juni-Umsatz, Mai-BWA), aber nur als Kopfzeile erkennbar. Weil der Buchungsstand je Betrieb unterschiedlich ist (Juni 2026: am 25.07. erst 22 von 131 gebucht), ist die Angabe pro Betrieb nötig.

**7. `sync` ist bewusst flach und in Postico lesbar.**
Der gesamte Zustand des Importers liegt in der Datenbank, nicht im Container — ein Absturz kostet damit nichts, und „warum fehlen Betrieb 47 die Junidaten?" beantwortet ein `SELECT`.

**8. Stände werden über Zeiträume aufgelöst, nicht über Monatsgleichheit.**
Die `*_stand`-Tabellen bekommen nur bei einer **Änderung** eine Zeile — ein unveränderter Artikel braucht keine 60 identischen Einträge. Wer daraufhin `stand.monat = date_trunc('month', tag)` schreibt, bekommt für die meisten Monate `NULL` und merkt es nicht: ein theoretischer Wareneinsatz von `NULL` sieht aus wie „kein Ansatz hinterlegt", nicht wie „falsch verknüpft". Genau dieser Fehler steckte in der ersten Fassung von `mart.deckungsbeitrag_warengruppe`. `core.artikel_stand_zeitraum` und `core.artikel_warengruppe_zeitraum` übersetzen die Punktfolge einmal in Gültigkeitszeiträume; danach ist der Join ein Bereichsvergleich und kann nicht mehr danebengehen.

Ein bewusster Unterschied zwischen den beiden: die **Warengruppe** gilt rückwirkend bis `-infinity`, der **Wareneinsatzansatz** nicht. Die Warengruppenmomentaufnahme läuft nur vorwärts, LINA führt keine Historie — ohne Rückgriff hätte die gesamte Vergangenheit gar keine Warengruppe. Eine Einordnung ändert sich selten, und die älteste bekannte ist die beste verfügbare Schätzung; `mart.artikelverkauf.warengruppe_geschaetzt` weist aus, wo geschätzt wurde. Ein Preis dagegen ist eine konkrete Zahl, und ein Preis von heute auf 2023 angewandt ist eine konkret falsche.

## Partitionierung

`core.artikelverkauf_tag` (~20 Mio. Zeilen/Jahr) und `raw.api_antwort` sind monatlich partitioniert, BRIN auf der Zeitachse. `core.partition_anlegen()` legt fehlende Partitionen an — der Importer ruft das vor dem Schreiben auf, damit es keinen Wartungsjob gibt, den man vergessen kann.

**Die Kinder liegen im Schema `part`, nicht neben der Elterntabelle.** Postgres legt sie standardmäßig daneben; bei monatlicher Partitionierung über acht Jahre stehen dann rund hundert Tabellen namens `artikelverkauf_tag_2023_07` in `core` und die fünf, um die es geht, gehen darin unter. Am 26.07.2026 waren es 84 von 110 Tabellen. In Postico ist das lästig, in Metabase unbenutzbar. Ein Test in `src/sync/e2e.test.ts` hält die Regel fest, weil sie bei der nächsten Änderung an `partition_anlegen()` lautlos kaputtginge.

**Was bewusst *nicht* partitioniert ist.** `core.aktionsumsatz_tag` ist ebenfalls eine Tagesfaktentabelle, bleibt aber eine einzige Tabelle: 141 Betriebe × drei Aktionen, und davon ist fast alles leer — am 25.07.2026 waren *alle* 423 Zellen `null`. Eine Partitionierung wäre hier reine Verwaltung ohne Gegenwert, und jede Partition, die niemand braucht, ist genau die Tabelle zu viel, um die es beim Aufräumen von `core` ging.

**BRIN braucht `autosummarize = on`.** Ohne das bleiben frisch angehängte Blöcke bis zum nächsten VACUUM unsummiert — also genau die Zeilen, die eine Round-Table-Auswertung am häufigsten liest. Bei append-only-Tabellen ist das der Normalfall.
**Und:** Storage-Parameter lassen sich **nicht** auf dem partitionierten Index setzen (`This operation is not supported for partitioned indexes`), nur je Kindindex. Deshalb legt `partition_anlegen()` den BRIN gleich richtig an.

**Seit `0083` verträgt `partition_anlegen()` zwei gleichzeitige Anrufer** (`CREATE TABLE IF NOT EXISTS` plus `EXCEPTION WHEN duplicate_table OR duplicate_object OR unique_violation`). Nötig geworden mit `0082`: seither laufen zwei Importschleifen nebenläufig, und beide rufen die Funktion als erste Handlung ihrer Ladetransaktion. Am letzten Tag jedes Monats trafen sie sich im Fenster zwischen Prüfung und `CREATE`, und die Verliererin brach ihre ganze Transaktion ab — nachgestellt auf PostgreSQL 18.4, Einzelheiten in `fehlerkatalog.md`. Der BRIN-Index bekommt seither seinen Namen ausgeschrieben (`<tabelle>_<spalte>_idx`, genau der, den Postgres selbst vergeben hätte), weil es ohne Namen kein `IF NOT EXISTS` gibt und sonst ein zweiter BRIN auf derselben Spalte entstünde.

`sync.posten_holen()` heißt seit `0082` `posten_holen(lauf, anbieter)` — `'lina'` (`marke_key IS NULL`), `'fn'` (`marke_key IS NOT NULL`), `NULL` = alles. Ein unbekannter Wert **wirft**, statt still die ganze Schlange zu liefern: der Filter ist die Drosselung, nicht eine Optimierung. Dazu zwei Teilindizes (`warteschlange_naechster_lina` / `_fn`) mit derselben Spaltenfolge wie die Sortierung — ein Prädikat auf `marke_key` allein filterte erst nach dem Indexscan, und der LINA-Zweig scannte quer durch den weit größeren FoodNotify-Block.

## Markenebene (Konzepte)

LINA kennt die Marken selbst — im Filter heißen sie **Konzepte**, in der API `gruppen`, 14 Stück (`id: 1 = Enchilada`). `getKennzahlen` liefert sogar dreistufig aus: Konzept → Betrieb → Kennzahl. Es muss also nichts aus Betriebsnamen geraten werden. Die Dimension liegt seit `0000` in `core.konzept` und `core.betrieb_konzept`.

**Erwartung: faktisch 1:n.** Ein Aposto ist ein Aposto. Die früher hier notierte Mehrfachzuordnung („Karlsruhe hängt in fünf Konzepten") war die richtige Beobachtung mit der falschen Schlussfolgerung: In `getKennzahlen` liefert die **Gruppe** die Marke, das **Kind** trägt nur die Stadt. Unter der Gruppe *Enchilada* heißt der Betrieb schlicht `Karlsruhe`. Der Name erscheint deshalb fünfmal — das sind fünf Restaurants in einer Stadt, nicht ein Restaurant in fünf Marken. Die Gegenprobe aus den Zahlen stützt das: der verifizierte Juniumsatz von „Karlsruhe" unter Enchilada beträgt 136.612,46 € und stimmt auf den Cent mit der Excel-Zeile *Enchilada Karlsruhe*; ein über fünf Marken geteilter Betrieb müsste ein Vielfaches ausweisen.

**Am 26.07.2026 an echten Daten bestätigt:** 131 Zuordnungen auf 131 Betriebe, **keiner in mehreren Gruppen**. Die Prüfabfrage unten meldet für alle `anzahl_konzepte = 1`. Geladen wird die Zuordnung aus `getKennzahlen` (`groups[].key = 'group_4'` → `children[].key`), die Markenliste aus `analyticsFilterOptions.gruppen` — verbunden über Zahlen, nicht über Namen. Bis dahin war die Ebene **gar nicht geladen**: Schema, Sichten und Dashboard standen, die Tabellen waren leer (siehe `fehlerkatalog.md`).

**Trotzdem als n:m modelliert.** Erstens ist es endgültig erst mit echten Daten prüfbar — die anonymisierten Fixtures enthalten nur eine Gruppe. Zweitens gibt es mit *Eat Tasty* mindestens einen Fall, bei dem eine Mehrfachzuordnung fachlich plausibel ist. Eine n:m-Tabelle mit lauter 1:1-Zeilen kostet nichts; eine 1:n-Spalte, die einen echten Mehrfachfall nicht abbilden kann, kostet eine Migration unter Zeitdruck. Das Hauptkonzept aus `0004` füllt sich im 1:n-Fall vollständig von selbst.

Prüfung, sobald Betriebe geladen sind — eine einzige Zeile mit `anzahl_konzepte = 1` bestätigt die Annahme:

```sql
SELECT anzahl_konzepte, count(*) AS betriebe
  FROM mart.konzept_zuordnung GROUP BY 1 ORDER BY 1;
```

**Praktische Folge, unabhängig vom Ausgang: der Betriebsname ist nicht eindeutig.** Fünf Betriebe heißen „Karlsruhe". Joins laufen deshalb ausschließlich über `core.betrieb.enc_id`; für die Anzeige gehören Konzept und Name zusammen. Genau dafür führt `mart.round_table()` seit `0004` die Spalte `konzept` mit — im Excel steht dort „Enchilada Karlsruhe", in LINAs Rohdaten nur „Karlsruhe".

Deshalb der Umweg über ein **Hauptkonzept** — eine saubere 1:1-Sicht (`0004`):

| Fall | Hauptkonzept | `herkunft` |
|---|---|---|
| genau ein Konzept in LINA | automatisch dieses | `aus LINA eindeutig` |
| mehrere Konzepte | keins, bis jemand entscheidet | `mehrdeutig - Entscheidung fehlt` |
| Eintrag in `manual.betrieb_hauptkonzept` | dieser, immer | `manuell gesetzt` |
| gar kein Konzept | keins | `LINA kennt kein Konzept` |

Die Mehrdeutigen verschwinden nicht, sie laufen als `(nicht zugeordnet)` mit. `mart.konzept_zuordnung` ist die Arbeitsliste dazu. Das ist Absicht: eine stillschweigend geratene Markenzuordnung wäre schlimmer als eine sichtbare Lücke, weil sie in jeder Auswertung mitfährt, ohne sich zu zeigen.

**Median statt Mittelwert** in `mart.konzept_schnitt()` und `mart.round_table_marke()`. Bei 141 Betrieben reicht ein einzelner Ausreißer — ein Neubau im Anlaufjahr, ein Betrieb im Umbau — um einen Mittelwert so zu verziehen, dass die halbe Marke unterdurchschnittlich aussieht. Nur `umsatz_ist` ist eine echte Summe.

`mart.round_table_marke()` stellt beide Maßstäbe nebeneinander: Abweichung zum Median **aller** Betriebe und zum Median der **eigenen Marke**. Damit ist unterscheidbar, ob ein Betrieb schwach ist oder ob seine ganze Marke schwächelt — der Fall, in dem eine Maßnahme beim einzelnen Betrieb ins Leere läuft.

Vorsicht beim Vorzeichen: bei Umsatz ist mehr besser, bei Personal- und Wareneinsatzquoten weniger. Ein positiver Abweichungswert ist also nicht automatisch ein guter.

## FoodNotify: Inventuren (`0044`, 04.08.2026)

`core.inventur` und `core.inventurposition` — der letzte Baustein aus `docs/plan-foodnotify.md` (B1, Stufe 4). Schlüssel und Modellierung folgen bewusst `core.bestellung`/`core.bestellposition` (`0030`), nicht einem neuen Muster:

- **Hängt an `core.kostenstelle`, nicht direkt an `core.marke`.** Wie bei Bestellungen ergibt sich die Marke über `kostenstelle.marke_key` — eine zusätzliche Mandantenspalte auf `core.inventur` wäre eine redundante zweite Wahrheit.
- **`fn_uuid` ist `text`, nicht `uuid`.** FoodNotify liefert hier laut Inventar UUIDv7, trotzdem der konservativere Typ: derselbe Grundsatz wie bei `core.zutat.ware_fn_id` — ein einzelner Wert außerhalb des erwarteten Formats soll keine Transaktion abbrechen. Die Eindeutigkeit trägt der `UNIQUE`-Index, nicht der Spaltentyp.
- **`art` und `status` ohne `CHECK`-Constraint.** Das Vokabular (`signed | counting | canceled`) steht nur im Inventar, nicht an einer echten Antwort gemessen — der Endpunkt wurde nie gegen das echte FoodNotify abgefragt (harte Regel: nie gegen das echte FoodNotify laufen, siehe `AGENTS.md`). Ein `CHECK`, der ein fünftes Wort nicht kennt, ließe die ganze Transaktion scheitern; das ist genau der Fehler, den `core.bestellung.status` schon einmal (`0043`) mit einem zu engen *Parser* gemacht hat, hier vorsorglich auch im Schema vermieden.
- **`core.inventurposition.ware_key` zeigt über `shopArticleId` auf `core.ware` mit `quelle = 'lieferant'`.** Die Falle steht wörtlich in `docs/plan-foodnotify.md` (Zeile 146): `shopArticleId` ist eine Lieferanten-Artikelnummer, keine FoodNotify-eigene Warennummer, und erst recht keine `core.artikel.artikelnummer`. Derselbe Nummernraum wie `core.zutat.ware_fn_id` und `core.bestellposition.lieferanten_nr` — deshalb dieselbe `quelle`-Markierung (`0042`) statt eines neuen Felds.
- **Ersetzen statt Upsert bei den Positionen.** Wie `core.bestellposition`: die Antwort ist der vollständige Stand der Zählung, `DELETE`+`INSERT` je Inventur in einer Transaktion verhindert einen halb sichtbaren Zwischenstand.
- **Kein Eintrag in `sync/nachfuellen.ts`.** Anders als Bestellungen bleibt der Import ein reiner, manueller Backfill (`bun run einreihen --foodnotify-inventuren`) — Begründung mit Zahlen in `docs/entscheidungen.md`.

Unverifiziert bleibt die Antworthülle von `/api/erp/stocktakings` selbst — abgeleitet aus dem Pfadmuster `/api/erp/*`, nie am echten Endpunkt gemessen (`docs/foodnotify-api-inventar.md` §1). Der erste echte Abruf gehört von Hand geprüft.

## Verifikation

`migrations/pruefung.sql` rechnet `mart.round_table()` gegen die Zeile „Enchilada Bayreuth" aus `JULI_Round_Table_Ampelsystem.xlsx` nach. Alle zehn Werte stimmen:

| | berechnet | Excel |
|---|---|---|
| BWA-Monat | 2026-05-01 | Mai (Kopfzeile) |
| Umsatz % | −6,29 | −6,29 |
| Personal / Ampel | 24,79 · grün | 0,2479 · 🟢 |
| WE Bar / Ampel | 23,64 · orange | 0,2364 · 🟠 |
| WE Küche / Ampel | 31,08 · rot | 0,3108 · 🔴 |
| Bewertung / OM | 4,00 · orange / 3 · orange | 🟠 / 🟠 |
| Gesamt / Intensität | rot / Sofort eskalieren | 🔴 / Sofort eskalieren |
| Maßnahme / Priorität | Ja / Hoch | Ja / Hoch |

---

## Kalender, Marktindex und Zeitfenster (Migrationen 0051 / 0052, 11.08.2026)

Fünf Tabellen im `manual`-Schema. Alle fünf tragen **Referenzdaten von außen**, keine
importierten Bewegungsdaten — deshalb `manual` und nicht `core`: der Sync fasst sie nicht an,
und ein Backfill kann sie nicht überschreiben.

| Tabelle | Schlüssel | Warum so |
|---|---|---|
| `manual.plz_bundesland` | `plz` | Die Zuordnung hängt an der PLZ, nicht am Betrieb. Zieht ein Betrieb um, folgt das Bundesland von selbst |
| `manual.feiertag` | `(kuerzel, datum, name)` | Der Name gehört in den Schlüssel: an einem Datum können in einem Land zwei Feiertage zusammenfallen |
| `manual.schulferien` | `(kuerzel, von, name)` | Als **Zeitraum** geführt, wie die Quelle es liefert — ein Zeitraum lässt sich nicht versehentlich halb laden |
| `manual.marktindex` | `monat` | Zwei Reihen nebeneinander (`index_nominal`, `index_real`), plus `stand`: die Reihe wird rückwirkend revidiert |
| `manual.zeitfenster` | `name` | Stammdaten, kein `CASE` in einer Sicht. Eine Fenstergrenze zu ändern ist Pflege, keine Migration |

**Warum `manual.plz_bundesland` und keine Spalte an `manual.betrieb_standort`.** Eine Spalte
am Betrieb müsste bei jedem neuen Standort erneut gefüllt werden und wäre bei zwei Betrieben
in derselben Stadt zweimal gepflegt — mit der Möglichkeit, dass sie sich widersprechen.

**Warum `stand` in `manual.marktindex` Pflicht ist.** Statistikreihen werden nachträglich
revidiert. Ohne Abrufdatum ist nicht nachvollziehbar, gegen welche Fassung ein alter Report
gerechnet hat, und ein Zahlenunterschied sieht dann aus wie ein Fehler.

**Warum `manual.zeitfenster.stunde_bis` ausschließlich ist.** 11 bis 14 sind die Stunden 11,
12, 13. Läuft `stunde_bis <= stunde_von`, geht das Fenster über Mitternacht (22 bis 1 =
Stunden 22, 23, 0) — der Geschäftstag endet um 07:59, Late Night gehört noch dazu.
`mart.zeitfenster_pruefung` findet Löcher und Überlappungen in der Definition; Erwartung leer.

## Lieferantenfreigabe und GFGH (Migration 0055, 12.08.2026)

Zwei Tabellen, und sie liegen aus demselben Grund in `manual` wie die fünf aus `0051`/`0052`:
was eingekauft werden **darf**, steht in keinem Quellsystem. Das ist eine
Einkaufsentscheidung, kein Bericht — der Sync fasst sie nicht an, ein Backfill kann sie nicht
überschreiben. Anlass, Rücklaufzahlen der Erhebung und die Wirkung auf die Auswertung stehen
in `befunde-datenlage.md` und `entscheidungen.md`; hier steht nur, warum das Schema so
aussieht.

| Tabelle | Schlüssel | Warum so |
|---|---|---|
| `manual.lieferant_freigabe` | `dach_name` | Freigegeben wird eine **Firma**, kein Datensatz eines Quellsystems |
| `manual.gfgh_betrieb` | `betrieb_key` | Der Getränkefachgroßhandel ist je Betrieb ein anderer, und die Erhebung fragt nach genau einem |

Beide Tabellen kennen **drei** Zustände, weil keine Zeile erzwungen wird: freigegeben,
ausdrücklich gesperrt (`freigegeben = false`) und — die Abwesenheit einer Zeile — nicht
eingeordnet. Ein `DEFAULT false` wäre hier kein Bequemlichkeitsdetail, sondern eine Behauptung
über Firmen, die nie jemand angesehen hat; die Begründung mit Zahlen in `entscheidungen.md`.

**Warum der Schlüssel `dach_name` ist und kein Surrogat auf `core.lieferant`.**
Ein `lieferant_key` gilt je FoodNotify-Mandant — Distra steht dort viermal, weil vier Mandanten
bei derselben Firma bestellen. Entscheidender ist aber die andere Richtung: die Freigabe soll
auch für Rechnungen gelten, die **nie durch FoodNotify liefen**, und genau die sind der
interessante Fall. Nachgemessen am 12.08.2026: FoodNotify deckt in den letzten zwölf Monaten 51
der 141 Betriebe ab; ein Fremdschlüssel auf `core.lieferant` könnte über den Rest gar nichts
sagen, weil es die Zeile dort nicht gibt. Der Schlüssel ist deshalb dieselbe Textachse wie
`mart.kreditor_konzern` (`0053`): gepflegter Dachname aus `manual.kreditor_gruppe`, ersatzweise
`core.kreditor_name_norm(Verkäufername)`. Die tragen beide Quellen, FoodNotify wie Belegarchiv.

Kein `FOREIGN KEY` auf `manual.kreditor_gruppe.dach_name`: der Dachname ist dort kein Schlüssel,
sondern ein **Zielwert** — 18 Namensvarianten zeigen auf ihn (nachgemessen am 12.08.2026) —, und
eine Freigabe darf vor der ersten Rechnung eines Lieferanten stehen. Der Preis dafür ist ein
Tippfehler, der nichts trifft und sich nicht von selbst meldet; `mart.lieferant_freigabe_stand`
weist ihn als `trifft_nichts` aus, statt ihn zu verhindern.

**Warum der `CHECK` `'getraenke'` verbietet.**
`warengruppe IN ('food', 'nonfood', 'kaffee_tee', 'sonstiges')` — die Lücke in der Aufzählung
ist der Zweck, nicht ein Vergessen. Eine Zeile in `manual.lieferant_freigabe` gilt konzernweit,
ein GFGH aber ist konzernweit weder erlaubt noch verboten. Ohne die Sperre landet der erste
eingetragene Getränkehändler in der konzernweiten Tabelle und ist damit in Aalen freigegeben,
obwohl er nach Heilbronn liefert. Nachgemessen am 12.08.2026: die 13 Zeilen in
`manual.gfgh_betrieb` nennen **zehn verschiedene** Händler — bei einem konzernweiten Schlüssel
hätten neun davon den zehnten überschrieben oder wären am Primärschlüssel gescheitert.

**Warum `gebunden` und `verräumt` dreiwertig sind.**
Beide sind `boolean` ohne `NOT NULL` und ohne `DEFAULT`. Die Erhebung fragt „Bist du am GFGH
gebunden?" und „verräumt der GFGH?"; 44 der 88 Betriebsspalten haben dazu nichts gesagt
(nachgemessen am 12.08.2026 an der Datei selbst). Ein `DEFAULT false` hätte aus „nicht
beantwortet" ein „nicht gebunden" gemacht und damit eine Verhandlungsposition behauptet, die
niemand geprüft hat — und zwar genau falsch herum, denn eine Bindung ist der Grund, warum ein
Preisvergleich folgenlos bleibt. Dasselbe Muster wie beim Hauptkonzept weiter oben: eine
sichtbare Lücke ist besser als ein geratener Wert, der in jeder Auswertung stumm mitfährt.
Nachgemessen am 12.08.2026: in den 13 gesäten Zeilen ist keine der beiden Spalten `NULL` (3 ×
gebunden, 9 × verräumt) — die Dreiwertigkeit ist bisher unbenutzt und steht für die
unbeantworteten Spalten bereit, für die es noch gar keine Zeile gibt.

**Warum `roh_eintrag` neben `dach_name` steht und nicht darunter.**
`roh_eintrag` ist der Zellinhalt verbatim, `dach_name` unsere Deutung davon — zwei Spalten
nebeneinander, kein Feld, das beim Auflösen ersetzt wird. Grund: die Deutung wird besser, die
Aussage des Betriebs nicht. Nachgemessen am 12.08.2026: 13 Zeilen tragen einen Rohtext, **5
davon einen `dach_name`**. Zwei der acht unaufgelösten nennen zwei Händler in einer Zelle
(„Getränke Staude / Team Bev.", „Trinkkartell/Tucher") und sind gar nicht eindeutig auflösbar;
von allen acht trifft nur bei zweien der normalisierte Rohtext überhaupt einen Lieferanten im
Bestand (`Getränke Keller`, `Getränke Weidlich`), die übrigen sechs liefern auf Rechnungen, die
das System noch nicht kennt. Läge der Rohtext unter dem Dachnamen, wären das acht verlorene
Betriebsaussagen und die einzige Spur, an der sich später weiterarbeiten lässt. Dieselbe
Trennung wie bei `core.buchungsbeleg.netto_split_roh` (`0053`). `NULL` in `dach_name` ist damit
ein **zulässiger Endzustand**, keine halbfertige Zeile.

**Die eine harte Bindung: `betrieb_key REFERENCES core.betrieb`.** Die Saat schreibt keine
Schlüsselzahl hinein, sondern löst den Betrieb über `core.betrieb.name` auf — eine falsche Zahl
lädt klaglos und zeigt danach auf den falschen Betrieb. Nachgemessen am 12.08.2026: der `JOIN` in
der Saat ist ein `INNER JOIN` und lässt einen unbekannten Namen ebenso still fallen (14
`VALUES`-Zeilen mit einem absichtlich falschen Namen ergaben 13 Zeilen, keine Meldung). Die
Absicherung, die der Migrationskommentar an dieser Stelle behauptet („bricht am `NOT NULL` des
Primärschlüssels laut ab"), gibt es also nicht; bei einem abweichenden Betriebsnamen fehlt der
GFGH lautlos, und `mart.fremdeinkauf` ordnet dessen Getränke dauerhaft als „nicht eingeordnet"
ein.

### Welcher Preis verglichen wird (Migration 0056, 12.08.2026)

Dieselbe Erhebung, die `0055` ausgelöst hat, wollte je Betrieb und Produkt einen Preis. `0056`
liefert ihn als `mart.einkaufspreis_betrieb` — **keine Schemaänderung, nur eine Sicht**. Sie
steht trotzdem hier, weil sie eine Modellfrage entscheidet: welche Größe „der Preis" ist.

**Zwei Sichten, zwei Preisbasen, und das ist Absicht.** `mart.einkaufspreis_monat` (`0041`)
rechnet `summe_preis / menge` — den **Gebindepreis**. Dort wird eine Ware über die Zeit
verglichen, und derselbe Besteller bucht dieselbe Gebindeeinheit; der Kartonpreis ist die Zahl,
in der ein Einkäufer denkt. `mart.einkaufspreis_betrieb` rechnet `summe_preis / gesamt_menge` —
den Preis je **Basiseinheit**. Hier wird über *Betriebe* verglichen, und dort bucht der eine Betrieb
einen Karton als `menge = 1` und das andere sechs Flaschen als `menge = 6`: dieselbe Ware,
dasselbe Geld, Faktor 6 im Gebindepreis. Die erste Fassung der Sicht rechnete mit dem Gebinde
und meldete genau das als Befund („Grana Padano" 147,90 gegen 14,79, Faktor 10,00).

**Der Beleg für den Wechsel trägt nur im jungen `bar`-Bestand.** Der Migrationskopf begründet
ihn damit, dass die Basiseinheit am Rand enger streut (979 Waren, über Faktor 3: 119 Gebinde
gegen 67 Basis — gemessen über `bar`-Positionen der letzten zwölf Monate). Nachgemessen am
12.08.2026 über die Grundgesamtheit, die die Sicht **tatsächlich** verwendet (alle Bereiche,
ohne Zeitfilter): 2.182 Waren mit mindestens vier Betrieben, Median der Spanne 1,06 gegen 1,07,
über Faktor 3 streuen **286 Waren beim Gebindepreis und 337 bei der Basiseinheit**. Nach dem
eigenen Maßstab der Migration ist die Basiseinheit dort die *schlechtere* Wahl. Die
Entscheidung bleibt richtig — über Betriebe hinweg ist der Gebindepreis schlicht keine
vergleichbare Größe —, aber nicht mit dieser Begründung.

**Was das über `gesamt_menge` sagt: die Basiseinheit ist nicht die saubere Größe, nur eine
andere schmutzige.** Alle Zahlen nachgemessen am 12.08.2026 auf `localhost/lina`:

| gemessen | Zahl |
|---|---|
| Positionen, in denen `gesamt_menge = menge × gebinde_menge` gilt | 162.477 von 634.175 (**25,6 %**) |
| Positionen in der Basis der Sicht | 603.941 |
| davon als `menge_unstimmig` markiert (`0042`) | 5.466 |
| davon ohne `preis_je_einheit` aus `0042` (dort bewusst `NULL`) | 4.985 |
| davon mit abweichendem `preis_je_einheit` (> 0,005) | 7.346 |

Woher die Abweichung kommt, ist ungeklärt; gefüllt ist die Spalte praktisch immer (4 Positionen
mit `gesamt_menge = 0`, keine `NULL`). Genau dafür hat `0042` die Spalte
`core.bestellposition.preis_je_einheit` gebaut und setzt dort `NULL`, wo die Gesamtmenge nicht
belastbar ist — „eine fehlende Zahl ist besser als eine erfundene". `0056` rechnet sie neu und
ungeprüft und umgeht damit die einzige Stelle, an der die Prüfung steht. Folge: der
48.400-EUR-Kaffee aus dem Kopf von `0042` steht wieder in einer Auswertung — `Idee
Entkoffeiniert 50 Pouches A 7G` mit `preis` = 48.400,0000 EUR/kg, im Februar 2026 sogar mit
`vergleichbar = true` und 0,0 Prozent Abweichung, weil alle drei beteiligten Betriebe dasselbe
Artefakt tragen.

**Und die Verpackung ist damit nicht wegnormalisiert, sondern nur verschoben.** Buchen einige
Betriebe die Gesamtmenge in Kartons und andere in Litern, spaltet sich der Preis je Basiseinheit
in zwei Cluster. „Captain Morgan Dark Rum 40% 1l Karton 12x1l": **jeder Betrieb zahlt exakt 147,84
EUR je Gebinde**, die Sicht meldet +84,6 Prozent für die einen und −84,6 Prozent für die
anderen, `vergleichbar = true`. Die Heuristik `einheit_verdaechtig` greift nicht, weil der
Median (6,6733) zwischen den Clustern liegt und kein Quotient ganzzahlig wird. Nachgemessen am
12.08.2026 für Monate ab 2026-04: 78 Gruppen mit auf 0,001 ganzzahliger Spreizung, 643 Zeilen,
davon **311 trotzdem vergleichbar**, geflaggt nur 34 — aus ihnen stammen **45.045 der 55.282
EUR** negativer `mehrkosten` der ganzen Sicht (81 Prozent der gemeldeten „Ersparnis").

Die Regel, die daraus folgt: **die belastbare Preisgröße liegt in `core` (`0042`), nicht in der
Sicht.** Solange `mart.einkaufspreis_betrieb` `summe_preis / gesamt_menge` selbst bildet, gibt
es für dieselbe Ware zwei Preise je Basiseinheit — den geprüften in `core.bestellposition` und
den ungeprüften in der Sicht. Der nächste Eingriff dort ersetzt die eigene Formel durch
`preis_je_einheit` und lässt die unstimmigen Positionen fallen, statt sie mitzurechnen.


### Nachtrag 12.08.2026: zwei Änderungen vor dem Commit

**`mart.fremdeinkauf`:** zwei Zustände statt drei, Standard `nicht freigegeben`. Die
Unterscheidung, die der dritte Zustand trug, steht in der Spalte `grund`. Begründung in
[`entscheidungen.md`](entscheidungen.md).

**`mart.einkaufspreis_betrieb`:** die Sicht rechnet den Preis je Basiseinheit **nicht mehr
selbst**, sondern nimmt `core.bestellposition.preis_je_einheit` aus `0042`. Der oben
beschriebene Befund — 5.466 als `menge_unstimmig` markierte Positionen liefen mit, und der
48.400-EUR-Kaffee war zurück — ist damit behoben. Die Regel dahinter ist allgemein und
gehört hierher: **wer eine geprüfte Größe nachrechnet, verliert die Prüfung.** `0042` hat
`preis_je_einheit` genau dafür gebaut und setzt sie auf NULL, wo die Gesamtmenge nicht
belastbar ist; eine Sicht, die die Formel wiederholt, umgeht diesen NULL-Wert.

---

## Belegarchiv-Zulauf (Migration `0069`, 13.08.2026)

Zwei Spalten und zwei Sichten. Der Anlass steht in `docs/fehlerkatalog.md`, die Mechanik in
`docs/importer.md` — hier die Schemaentscheidungen und ihre Begründung.

### `core.belegart.inhalt_holen` — die Freigabe steht in der Datenbank, nicht im Code

Ob der **Inhalt** eines Ordners geholt wird, ist eine fachliche Frage. Für sechs der
vierzehn Belegarten (16, 3968, 3969, 3971, 3972, 3976) ist sie offen und gehört Eugene
(Punkt 3 in Abschnitt 4 von `docs/plan-datenvollstaendigkeit.md`). Stünde sie als Konstante
im Quelltext, wäre das Umschalten ein Commit, ein Build und ein Deployment; so ist es ein
`UPDATE` auf eine Zeile.

**Gezählt werden alle vierzehn**, auch die nicht freigegebenen. Das ist kein Widerspruch,
sondern die Entscheidungsgrundlage: erst die Zählung sagt, ob dort überhaupt etwas liegt,
das die Aufrufe lohnt. Was dabei herauskommt, steht in `mart.belegarchiv_zulauf` als
Zustand `gezaehlt, nicht freigegeben` — sichtbar statt still.

Gesetzt wird die Spalte **aus der Zählung abgeleitet** (`WHERE EXISTS … belegarchiv_soll`)
und nicht als Liste hingeschrieben. Eine hingeschriebene Liste kann von dem abweichen, was
tatsächlich geholt ist; eine abgeleitete nicht.

### `core.belegarchiv_bestand.quelle` — Zählung und Abzug auseinanderhalten

`zaehlung` kommt täglich, `abzug` nur bei Abweichung. Ohne die Trennung wäre die Tabelle nach
wenigen Tagen überwiegend voll mit Zählungen, und niemand könnte mehr sagen, wann ein Ordner
zuletzt wirklich **geholt** wurde. Die 621 vorhandenen Zeilen vom 12.08.2026 stammen
ausnahmslos aus vollen Abzügen und bekommen deshalb den Vorgabewert `abzug`.

Die Tabelle bleibt eine Zeitreihe (`gemessen_am` im Primärschlüssel). Das kostet 1.834 Zeilen
am Tag und ist genau das, was Phase 4 des Plans für den Zulauf-Wächter braucht: eine
tagesgenaue Kurve je Ordner. Der Index `(betrieb_key, typ_id, quelle, gemessen_am DESC)`
trägt die Frage „letzter Abzug", die der Index aus `0053` ohne `quelle` nicht beantwortet.

### Warum `manual.belegarchiv_soll` stehen bleibt

Sie ist als Tor abgesetzt, aber nicht gelöscht: `mart.belegarchiv_fehlend` führt sie als
dritte Zahl neben Bestand und Ist, und **wer nur zwei davon hat, kann „LINA hat weniger"
nicht von „wir haben weniger geholt" unterscheiden**. Als Handzählung vom 11.08.2026 bleibt
sie außerdem der einzige Beleg dafür, wie der Bestand vor dem ersten Abzug aussah.

### Die Bedingung ist `<>`, nicht `<`

Nachgemessen am 13.08.2026 in Produktion: für **alle 621** abgezogenen Ordner stimmten
`count(*)` aus `core.buchungsbeleg` und `records_total` auf den Beleg genau überein, kein
einziger Ausreißer. Die Gleichheit ist damit eine belastbare Invariante — und Ungleichheit
fängt drei Fälle, die ein „ist er gewachsen?" durchließe: den abgebrochenen Abzug, den in
LINA gelöschten Beleg und den nie geholten Ordner.

## Wiederbelebung aufgegebener Posten (Migration `0070`, 13.08.2026)

### `sync.warteschlange.wiederbelebt` — die Leben, nicht die Versuche

Zwei Zähler nebeneinander, und sie zu verwechseln wäre teuer:

| Spalte | zählt | wird zurückgesetzt |
|---|---|---|
| `versuche` | Anläufe **innerhalb** eines Lebens, Grenze `MAX_VERSUCHE` (4) | beim Wiederbeleben auf 0 |
| `wiederbelebt` | die **Leben**, Grenze `MAX_WIEDERBELEBUNGEN` (3) | nie |

Ohne den zweiten Zähler gäbe es keine Obergrenze: `versuche` fängt bei jedem Rückholen neu
an, ein dauerhaft kaputter Posten liefe also unbegrenzt weiter. Genau das tut der 403-Zweig
in `src/sync/worker.ts` heute — `posten_holen()` zählt hoch, der Zweig zählt herunter, netto
±0 seit neun Tagen. Ein zweiter Zähler ist die kleinste Änderung, die das ausschließt.

`smallint`, nicht `integer`: der Wertebereich ist 0 bis 3.

**Der Index ist partiell** (`WHERE ergebnis = 'aufgegeben'`). Am 13.08.2026 sind das 275 von
168.725 erledigten Zeilen — ein vollständiger Index wäre hier 600-mal so groß wie nötig, und
die Tabelle wächst mit jedem Lauf.

### Warum die Inventuren keine Schemaänderung brauchten

Sie haben ihre Invariante schon: `core.inventur.anzahl_positionen` kommt aus FoodNotifys
`totalNumberOfItems` und sagt, wie viele Positionen die Zählung hat. Ein Zähler wie
`wiederbelebt` wäre dort überflüssig — die Quelle sagt selbst, wann es reicht.

`core.bestellung` hat kein Gegenstück dazu (nachgesehen am 13.08.2026: die Spalte existiert
schlicht nicht). Deshalb der Unterschied in der Behandlung, und nicht aus Laune.

## Prüfsichten-Hygiene (Migration `0071`, 13.08.2026)

**Keine Schemaänderung an einer Tabelle.** 0071 ändert drei Sichten (`metabase.md`) und legt
genau einen Index an.

### `aufgabe_belegzahl_betrieb` — der Zugriffspfad für „war die letzte Zählung keine_daten?"

```sql
CREATE INDEX aufgabe_belegzahl_betrieb
    ON sync.aufgabe ((parameter->>'linaBetriebId'), beendet_am DESC)
 WHERE endpunkt = 'la:belegzahl';
```

`mart.belegarchiv_zulauf` muss je Betrieb die jüngste `la:belegzahl`-Aufgabe finden. Der
vorhandene Index aus 0005 — `(endpunkt, betrieb_enc_id, beendet_am DESC)` — trägt die Frage
nicht: `betrieb_enc_id` ist bei allen `la:`-Zeilen NULL, der Betrieb steckt im
`parameter`-JSON.

**Partiell auf den einen Endpunkt**, weil das die einzige Frage ist, die diesen Pfad braucht —
und weil `sync.aufgabe` seit 0069 um 1.834 Zeilen am Tag wächst, rund 670.000 im Jahr. Ein
voller Index wäre hier deutlich größer als nötig. Es ist derselbe Grund wie bei
`warteschlange_aufgegeben` in 0070.

## Bestelldetails altern nach (Migration `0072`, 13.08.2026)

### `core.bestellung.detail_geholt_am` — warum eine Spalte und keine Abfrage

„Wann wurde diese Bestellung zuletzt im Detail geholt?" ließe sich aus `sync.aufgabe`
beantworten. Das wäre aber je Nacht eine Gruppierung über 66.966 `orderId`-Parameter in einer
Tabelle, die seit 0069 um 1.834 Zeilen am Tag wächst. Die Spalte beantwortet dieselbe Frage
mit einem Indexzugriff — und sie steht dort, wo auch die Bestellung steht, also sieht sie
jeder, der die Zeile ansieht.

**`NULL` heißt „seit Einführung dieser Spalte nicht geholt", nicht „nie".** Alle 66.966
vorhandenen Zeilen starten auf NULL, und genau das ist gewollt: sie **sind** der eingefrorene
Altbestand, den der Nachholauf abarbeitet. Die Spalte braucht keinen Backfill, weil ihr
Anfangswert die Wahrheit sagt.

**Gestempelt wird nur von `fn:bestellung`**, nicht vom Listen-Upsert bei `fn:bestellungen` —
der frischt allein den Status auf. Sonst sähe eine Bestellung, deren Status sich änderte, aus
wie eine, deren Liefermenge frisch ist.

### `bestellung_detail_faellig` — partiell auf die nicht-finalen

```sql
CREATE INDEX bestellung_detail_faellig
    ON core.bestellung (bestellt_am DESC)
 WHERE coalesce(status, '') NOT IN ('canceled', 'finished');
```

`canceled` und `finished` sind 3.362 von 66.966, und um die geht es nie — sie ändern sich
nicht mehr. Derselbe Grund wie bei `warteschlange_aufgegeben` (0070) und
`aufgabe_belegzahl_betrieb` (0071).

## `core.name_norm()`: Apostrophe werden gelöscht (Migration `0073`, 13.08.2026)

Die Funktion faltet Umlaute (`ü` → `ue`) und Akzente (`é` → `e`), damit LINA und FoodNotify
denselben Namen gleich schreiben. Die Apostroph-Zeichen `´`, `` ` `` und `'` standen dabei mit
je einem **Leerzeichen** als Ziel in `translate()`, das typografische `’` fehlte ganz.

```
vorher:  name_norm('Lehner´s Wirtshaus Rastatt GmbH') → 'lehner s wirtshaus rastatt'
         name_norm('Lehners Wirtshaus Rastatt GmbH')  → 'lehners wirtshaus rastatt'
nachher: beide → 'lehners wirtshaus rastatt'
```

`translate()` löscht jedes Quellzeichen ohne Zielzeichen — die fünf Apostroph-Varianten stehen
deshalb am Ende der Quellzeichenkette und haben in der Zielkette keine Entsprechung mehr.

**Gemessen über alle 79 Restaurants × 141 Betriebe:** 59 exakte Treffer vorher, 60 nachher,
**0 verloren**, keine neue Kollision. Apostrophe tragen nur 6 der 79 Restaurantnamen und
keiner der 141 Betriebsnamen. Genau ein Betrieb hing daran.

## Der Vergleichstag als Materialisierung (`0084`)

**Warum die Sicht aus `0051` so nicht materialisierbar war.** Sie holte je
Zeile über `LEFT JOIN LATERAL … ORDER BY geschaeftstag DESC LIMIT 4` ihre vier
Nachbartage. Über den ganzen Bestand wurde der Aufbau **nach zehn Minuten
abgebrochen**; die Fassung mit Fensterfunktion und Kumulierung braucht 33,1 s
kalt und 35,2 s warm (188.640 Zeilen), beziehungsweise 39 s für die
443.304 Zeilen aller 141 Betriebe.

**Wie der Umbau funktioniert.** Der Vergleichsvorrat — kein Feiertag, Umsatz
> 0 — bekommt je Betrieb und Wochentag eine laufende Nummer (`row_number`) und
eine kumulierte Summe. Der Schnitt der letzten vier Vorrats-Tage vor einem
beliebigen Tag ist dann eine **Differenz zweier kumulierter Werte** statt einer
eigenen Suche: zwei Gleichheits-Joins gegen 188.640 Unterabfragen. Feiertage
bleiben außerhalb des Vorrats, bekommen aber weiterhin einen Vergleichswert —
genau die Eigenschaft, um die es fachlich geht.

**Dass das keine Näherung ist, ist ein Test und keine Messung.**
`src/sync/vergleichstag.test.ts` stellt die Logik aus `0051` wörtlich gegen
das, was in der Materialisierung steht, und besteht nur bei null Abweichung in
acht Spalten. Am 20.08.2026 über 9.432 Zeilen, drei Betriebe, volle Historie
2018–2026, 352 Feiertage darin: null.

**Der Kalender deckt seit `0084` alle 141 Betriebe**, nicht mehr nur die 60 mit
gepflegter PLZ. Wer keinen Standort hat, bekommt die neun **bundesweiten**
Feiertage und **keine** Schulferien — `ist_schulferien` ist dort `NULL` und
nicht `false`, weil zwischen Bayern und Bremen sechs Wochen Sommerferien
liegen. `NULL` heißt unbekannt, `false` hieße nachgesehen. Die Herkunft steht
in `kalender_quelle`.

**Zwei Nachschlagewege wurden dabei ersetzt.** Die alte Sicht holte Feiertag
und Ferien je Zeile per `LATERAL … LIMIT 1`; bei 141 Betrieben und vier
Nachschlagen (Feiertag, Ferien, Vortag, Folgetag) wären das 1,8 Mio
Unterabfragen. Stattdessen werden beide einmal auf `(kuerzel, datum)`
vorverdichtet — Schulferien über `generate_series` auf Tageszeilen — und per
Gleichheits-Join angehängt. `min(name)` statt `LIMIT 1`: dieselbe Absicht,
deterministisch.

**Vor- und Folgetag über `datum ± 1`, nicht über `lag`/`lead`.** Die Tagesachse
ist der Bestand selbst, und der ist nicht lückenlos: 3.144 verschiedene
Geschäftstage in 3.146 Kalendertagen (20.08.2026). `lag` spränge über die
beiden Lücken hinweg und behauptete eine Nachbarschaft, die es nicht gibt.

## Feiertagsnamen werden beim Lesen vereinheitlicht (`0084`)

`manual.feiertag_alias` (Tabelle, in `pflege/` erweiterbar) ordnet
Schreibweisen einander zu; `mart.feiertag_normiert` wendet sie an und behält
den Rohwert in `name_roh`. **Normiert wird beim Lesen, nicht beim Import** —
dieselbe Haltung wie bei `raw.api_antwort`: die Rohzeilen bleiben, wie die
Quelle sie geliefert hat. Anlass und Messwerte in `befunde-datenlage.md`.

## Wetter (`0086`, `0087`)

**Der Schlüssel ist die gerundete Koordinate, keine Orts-ID.** Zwei
Nachkommastellen sind rund 1,1 km und damit weit unter dem Stationsabstand
(im Test 5,2 km). 48 Gitterpunkte für 60 Betriebe, keine ID-Verwaltung, und
zwei Betriebe an derselben Adresse bekommen bauartbedingt dasselbe Wetter. Wer
einen Standort nachträgt, bringt seinen Gitterpunkt ohne Codeeingriff mit —
`mart.wetter_ort` ist abgeleitet, nicht gepflegt.

**`manual.wetter_stunde.zeitpunkt` ist `timestamptz` und damit UTC-verankert,
nicht Ortszeit.** In der Nacht zur Winterzeit gibt es 02:00 Ortszeit zweimal;
ein Schlüssel auf der Ortszeit kollidiert dort. Geschäftstag und Stunde werden
beim Lesen über `core.geschaeftstag()` abgeleitet — und der schneidet um 08:00
Berliner Zeit. Wer naiv auf den Kalendertag verdichtet, verschiebt das Wetter
um acht Stunden gegen den Umsatz.

**Stündlich und nicht gleich der Tageswert.** 48 Gitterpunkte × 3.144 Tage ×
24 h sind rund 3,6 Mio Zeilen — neben 27,7 Mio Artikelzeilen nichts. Dafür ist
„wie war das Wetter zur Mittagszeit" später ohne neuen Abruf beantwortbar. Ein
Gewitter um 4 Uhr räumt keine Terrasse; ein Tagesmaximum weiß das nicht.

**Die Klassengrenzen sind Daten, nicht Code** (`manual.wetter_klasse`, gepflegt
über `pflege/wetter_klasse.csv`) — dieselbe Bauart wie das Ampel-Regelwerk.
`von` einschließlich, `bis` ausschließlich, `NULL` offen; jede Kategorie ist
nach unten **und** oben offen, damit ein 42-Grad-Tag in der Randklasse landet
statt herauszufallen. `mart.wetter_klasse_pruefung` findet Lücken und
Überlappungen.

---

## Pflichtartikel (Migration `0094`)

Drei handgepflegte Tabellen und drei Materialisierungen. Die Vorgaben kommen vom
Fachbereich, die Bewegungsdaten aus FoodNotify.

### Die drei `manual`-Tabellen

| Tabelle | Schlüssel | Inhalt |
|---|---|---|
| `manual.pflichtartikel_liste` | Konzept + Bereich + `gueltig_von` | Kopfzeile je Liste: Laufzeit, Quelle |
| `manual.pflichtartikel` | dazu Artikelnummer + Bezeichnung | die 765 Positionen |
| `manual.pflichtartikel_alias` | Konzept + Artikelnummer | Nachfolgenummern |

**`gueltig_von` steht im Schlüssel**, damit eine Folgeliste neben der bisherigen
stehen kann statt sie zu überschreiben. Die Wilma-Wunder-Liste ist eine
Sommerkarte mit Laufzeit bis 04.10.2026; die Winterkarte ist damit absehbar und
soll ein Commit in `pflege/` sein, keine Migration.

**`UNIQUE NULLS NOT DISTINCT` auf `manual.pflichtartikel`.** 112 der 765
Positionen haben keine Artikelnummer — bei GFGH-Getränken hat jeder Betrieb
einen eigenen Nummernkreis. Ohne `NULLS NOT DISTINCT` ließe Postgres beliebig
viele „Pepsi Cola ohne Nummer" nebeneinander zu, und der Pflege-Upsert hätte
keinen Angriffspunkt.

### `core.artikel_name_norm()` — und warum nicht `core.name_norm()`

Eine zweite Normalisierungsfunktion neben der aus `0073`, und das ist kein
Versehen. `core.name_norm()` ist für **Betriebsnamen** gebaut und streicht am
Wortende Rechtsformen — darunter `kg`, weil das dort *Kommanditgesellschaft*
heißt. In einem Artikelnamen ist „2,5Kg" eine **Mengenangabe**, und ein
Vergleich, der sie wegwirft, trifft das falsche Gebinde. Hergang im
`fehlerkatalog.md`.

`core.artikel_name_norm()` faltet Umlaute und Akzente, **löscht** Apostrophe
(der nachgemessene Befund aus `0073`: „Bailey's" → „baileys"), schneidet
FoodNotifys Gebindewiederholung ab dem ersten Doppelpunkt ab
(`"… 2,5Kg:karton 4 X 2,5Kg"`) und macht aus allem Übrigen ein Leerzeichen.
Letzteres hat eine beabsichtigte Nebenwirkung: `LIKE`-Platzhalter können den
Namensvergleich nicht erreichen.

### Der Schlüssel zwischen Liste und Einkauf

**`core.bestellposition.lieferanten_nr`, nicht `core.ware.fn_id`.** Letztere
führt je nach `core.ware.quelle` zwei verschiedene Nummernkreise in derselben
Spalte; über sie gemessen trafen 10,1 % der Aposto-Listennummern, über
`lieferanten_nr` 100 %. Die Spalte ist zu 99,8 % gefüllt. Begründung mit
Messwerten im Kopf von `0094` und im `fehlerkatalog.md`.

**Der Bereich (Küche/Bar) ist beschreibend, nie eine Joinbedingung.** Die
Betriebe buchen Küchenware über die Bar-Kostenstelle und umgekehrt; geprüft wird
je Konzept gegen die Vereinigung beider Listen.

### Die drei Materialisierungen

| Sicht | Korn | Trägt |
|---|---|---|
| `mart.pflichtartikel_klassifikation_basis` | Konzept × Fenster × Artikel | den Zustand je Artikel |
| `mart.pflichtartikel_einkauf_basis` | + Betrieb × Monat × Zustand | Kacheln, Verlauf, Rangliste |
| `mart.pflichtartikel_artikel_basis` | Konzept × Fenster × Betrieb × Artikel | beide Drilldowns |

**Die Klassifikation läuft über Artikel, nicht über Positionen.** Im
Zwölfmonatsfenster stehen 6.852 verschiedene Artikel gegen rund 600.000
Positionen, und der Namensabgleich ist ein Präfixvergleich gegen bis zu 765
Listeneinträge. Über die Positionen gerechnet lief er in einen Zeitausfall
(> 2 min, abgebrochen), über die Artikel sind es Sekunden.

**Die Reihenfolge beim Auffrischen ist bindend**: die beiden unteren lesen die
obere. Steht in `src/sync/pflichtartikel_sichten.ts`, registriert in
`mart.materialisierung_stand` unter dem Merker `pflichtartikel_refresh`.


## Bounti: Schulung und Audits (Migrationen `0096`, `0097`)

Elf Tabellen in `core`, achtzehn Sichten in `mart`. Der Aufbau und jede
gemessene Zahl stehen in [`bounti-api-inventar.md`](bounti-api-inventar.md) —
§ 9 beschreibt die Auswertungsschicht, die Dashboards darauf stehen in
[`dashboards.md`](dashboards.md).

Drei Eigenheiten, die hier festgehalten gehören, weil sie beim Lesen der Sichten
sonst als Fehler erscheinen:

**Eine Person kann an mehreren Standorten stehen.** Jede über Personen
aggregierte Betriebszahl zählt sie mehrfach; die Summe über alle Betriebe ist
deshalb größer als die Kopfzahl des Unternehmens.
`mart.bounti_mehrfachzuordnung` ist keine Fehlerliste, sondern die Erklärung
dafür.

**Die Zuordnung Person → Standort ist die von heute.** Bounti führt dazu keine
Historie. Wer den Betrieb gewechselt hat, bringt seine alten Zuweisungen mit —
weit zurückliegende Monate in `mart.bounti_schulung_verlauf` sind deshalb eine
Annäherung und keine Messung.

**`assessmentScore` ist ein Bruch, `achievedPercentage` nicht.** Bountis eigene
Doku sagt „0.8 is 80%" für das eine und liefert das andere bereits als
Prozentzahl. Beide landen nach Regel 6 als Prozentzahl in der Datenbank; die
Umrechnung passiert in `src/bounti/laden.ts` und warnt, wenn sich die Skala
ändert.

## `core.bestellung`: zwei Fingerabdrücke (Migration `0098`)

| Spalte | Bedeutung |
|---|---|
| `listen_fingerabdruck` | md5 über den kanonisch sortierten Eintrag aus `fn:bestellungen`, bei jedem Listenabruf neu gesetzt |
| `detail_fingerabdruck` | für welchen Listenstand `fn:bestellung` zuletzt geholt wurde |

`listen_fingerabdruck IS DISTINCT FROM detail_fingerabdruck` heißt: das Detail
ist nicht auf dem Stand der Liste, also gibt es Arbeit. Das ersetzt das
rollierende 45-Tage-Fenster, das jede Bestellung vierzehnmal holte, obwohl sie
sich im Schnitt einmal ändert.

**Warum aus der Liste und nicht aus dem Detail.** `raw.payload_hash` auf
`fn:bestellpositionen` ist als Änderungsmerkmal unbrauchbar: 81 % der
Änderungen dort sind `concreteProduct.stock` (der aktuelle Lagerbestand des
Artikels) und `timeModified` des Artikelstamms. Gemessen am 25.08.2026: in 400
Bestellungen über zwölf Tage änderte sich **kein einziges Mal** etwas am Inhalt
der Bestellung, während 322 der 400 Rohantworten verschieden waren. Der
Listeneintrag trägt diese Felder nicht.

**NULL in beiden Spalten** ist der Bestand aus der Zeit vor `0098`. Er gilt
nicht als veraltet — `NULL IS DISTINCT FROM NULL` ist falsch — und bekommt
seinen Vergleichswert, sobald sein Listeneintrag das nächste Mal gelesen wird.
