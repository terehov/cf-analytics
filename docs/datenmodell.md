# Datenmodell

Sechs Schemata statt eines großen `public`. In Postico sieht man damit sofort, ob man auf Rohdaten, abgeleitete Daten oder Handgepflegtes schaut, und Metabase-Berechtigungen lassen sich später pro Schema vergeben.

```
raw     unveränderte API-Antworten, append-only
core    Stammdaten und Bewegungsdaten, benannt nach den LINA-Berichten
manual  OM-Einschätzung, Ursachen, Maßnahmen, YEXT-Bewertungen
ampel   Regelwerke
sync    Betriebszustand des Importers
mart    Sichten für Metabase
```

## Die sieben Entscheidungen

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

## Partitionierung

`core.artikelverkauf_tag` (~20 Mio. Zeilen/Jahr) und `raw.api_antwort` sind monatlich partitioniert, BRIN auf der Zeitachse. `core.partition_anlegen()` legt fehlende Partitionen an — der Importer ruft das vor dem Schreiben auf, damit es keinen Wartungsjob gibt, den man vergessen kann.

**BRIN braucht `autosummarize = on`.** Ohne das bleiben frisch angehängte Blöcke bis zum nächsten VACUUM unsummiert — also genau die Zeilen, die eine Round-Table-Auswertung am häufigsten liest. Bei append-only-Tabellen ist das der Normalfall.
**Und:** Storage-Parameter lassen sich **nicht** auf dem partitionierten Index setzen (`This operation is not supported for partitioned indexes`), nur je Kindindex. Deshalb legt `partition_anlegen()` den BRIN gleich richtig an.

## Markenebene (Konzepte)

LINA kennt die Marken selbst — im Filter heißen sie **Konzepte**, in der API `gruppen`, 14 Stück (`id: 1 = Enchilada`). `getKennzahlen` liefert sogar dreistufig aus: Konzept → Betrieb → Kennzahl. Es muss also nichts aus Betriebsnamen geraten werden. Die Dimension liegt seit `0000` in `core.konzept` und `core.betrieb_konzept`.

**Erwartung: faktisch 1:n.** Ein Aposto ist ein Aposto. Die früher hier notierte Mehrfachzuordnung („Karlsruhe hängt in fünf Konzepten") war die richtige Beobachtung mit der falschen Schlussfolgerung: In `getKennzahlen` liefert die **Gruppe** die Marke, das **Kind** trägt nur die Stadt. Unter der Gruppe *Enchilada* heißt der Betrieb schlicht `Karlsruhe`. Der Name erscheint deshalb fünfmal — das sind fünf Restaurants in einer Stadt, nicht ein Restaurant in fünf Marken. Die Gegenprobe aus den Zahlen stützt das: der verifizierte Juniumsatz von „Karlsruhe" unter Enchilada beträgt 136.612,46 € und stimmt auf den Cent mit der Excel-Zeile *Enchilada Karlsruhe*; ein über fünf Marken geteilter Betrieb müsste ein Vielfaches ausweisen.

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
