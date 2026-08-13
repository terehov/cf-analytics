# Befunde zur Datenlage

Was beim Bauen der Dashboards in den echten Daten aufgefallen ist. **Nachgemessen am
26.07.2026**, während der Historien-Backfill noch lief.

Diese Datei ist kein Statusbericht — der steht in
[`backfill.md`](backfill.md) und in `mart.backfill_fortschritt`. Hier stehen die Befunde,
die **ändern, wie jede andere Zahl zu lesen ist**. Wer eine Auswertung baut oder eine Zahl
weitergibt, sollte sie kennen.

---

## 1. Nur 62 der 141 geführten Betriebe machen überhaupt Umsatz

```sql
SELECT count(*) FILTER (WHERE u.umsatz > 0) AS mit_umsatz, count(*) AS gesamt
  FROM mart.datenstand d
  LEFT JOIN LATERAL (SELECT sum(umsatz_netto) AS umsatz
                       FROM mart.umsatz_tag t WHERE t.betrieb_key = d.betrieb_key) u ON true;
-- 62 von 141
```

Die übrigen **79 liefern über 200 Tage lang Umsatzberichte über 0 €**. Das ist ausdrücklich
*keine* Datenlücke: die Berichte kommen an, sie sind leer. Dahinter stehen
Beteiligungsgesellschaften (`Aposto Beteiligungs GmbH`), geschlossene Betriebe
(`INSOLVENT - Enchilada Pforzheim GmbH`), noch nicht eröffnete Standorte und Testeinträge
(`A Testladen Concept Family`).

**Folge:** Jeder Mittelwert über „alle Betriebe" ist um mehr als die Hälfte verdünnt. Jede
Zählung („wie viele Betriebe sind rot") hat einen Nenner, der zu 56 % aus Zeilen besteht,
die gar kein Geschäft beschreiben.

**Was daraus folgte:** `core.betrieb.aktiv` ist für alle 141 auf `true` — das Feld trägt die
Unterscheidung also nicht. Die Arbeitsliste steht als Karte *Betriebe ohne laufendes
Geschäft* auf Dashboard ⑥. Sie gehört an Concept Family gemeldet, damit die Betriebe
stillgelegt werden; siehe [`offene-punkte.md`](offene-punkte.md).

---

## 2. Die Personalquote reicht bis 1132 %

```sql
SELECT min(personalkosten_ogf_pct), max(personalkosten_ogf_pct)
  FROM mart.round_table_monat WHERE personalkosten_ogf_pct IS NOT NULL;
-- 0.0 bis 1132.5, Median 37.6
```

Der Extremwert ist **`Enchilada Bremen`: 1109 % Personalkosten bei 0 € Umsatz** — eine
Division durch fast nichts. Die Ampel meldet das als Rot, also als dringenden
Handlungsbedarf, obwohl dort schlicht kein Betrieb läuft.

**Was daraus folgte:** Alle Markenschnitte und Vergleichsmaßstäbe rechnen mit **Medianen**,
nicht mit Mittelwerten (`mart.konzept_schnitt`, `mart.round_table_marke`, Dashboard ①). Ein
einzelner solcher Wert verzieht einen Mittelwert so, dass eine ganze Marke
unterdurchschnittlich aussieht. Der Median hält still.

Die Karte *Potenzial bis zum Median* schließt Betriebe ohne Umsatz ausdrücklich aus — sonst
dominiert der Unsinn die Liste.

---

## 3. Umsatzkonzentration: 42,6 % — oder 70,4 %, je nach Nenner

Beide Zahlen sind richtig und beantworten verschiedene Fragen:

| Frage | Antwort |
|---|---|
| Wie viel machen die stärksten 20 % **der 62 aktiven Betriebe** (also 12 Betriebe)? | **42,6 %** |
| Wie viel machen die stärksten 28 Betriebe, also 20 % **der 141 geführten**? | **70,4 %** |
| Wie viel machen die **Top 10**? | **37,4 %** |

Die erste ist die ehrliche Antwort auf „wie konzentriert ist das Geschäft" — die zweite
zählt Karteileichen in den Nenner und übertreibt dadurch die Konzentration.

**Was daraus folgte:** Die Karte *Umsatzkonzentration* und die *Konzentrationskurve* auf
Dashboard ⑥ filtern auf `sum(umsatz_netto) > 0`. Der Dashboard-Text nennt die Bezugsgröße
ausdrücklich, weil sonst die verlockendere Zahl zitiert wird.

Auch mit dem ehrlichen Nenner gilt: **zehn Betriebe tragen über ein Drittel.** Ein
Prozentpunkt dort wiegt mehr als eine ganze Sanierung im langen Schwanz — das gehört in
jede Priorisierung.

---

## 4. Über die Hälfte der Betriebe hat kein Round-Table-Urteil

Im jüngsten bewerteten Monat (Juli 2026):

| | Betriebe |
|---|---|
| 🔴 Rot | 60 |
| 🟠 Orange | 3 |
| 🟢 Grün | 6 |
| **Ohne Urteil** | **72** |

Ursache ist die fehlende BWA: nur 69 Betriebe haben überhaupt gebuchte Kennzahlen.

**Was daraus folgte:** Die Kachel **„Ohne Urteil"** auf dem Round-Table-Dashboard. Im Excel
gab es sie nicht — dort fiel ein Betrieb ohne BWA unsichtbar unter den Tisch und sah aus wie
ein Betrieb ohne Befund. In den Tabellen steht `⚪` für „keine Daten", nie ein leeres Feld.

---

## 5. Die Umsatz-Ampel ist vollständig leer

`umsatz_pct` ist für **alle** Betriebe und Monate `NULL`, weil der Vorjahresumsatz fehlt: die
Historie reicht (Stand 26.07.2026, Backfill läuft) bis 01.01.2026 zurück, nicht bis 2025.

Das ist fehlende Vergangenheit, kein Nullumsatz — und es löst sich mit dem Backfill von
selbst. Bis dahin beruht der Gesamtstatus nur auf Personal- und Wareneinsatzquoten, also auf
**drei statt sechs** Ampeln.

---

## 6. `core.konzept` ist leer — alle Marken laufen als „(nicht zugeordnet)"

```sql
SELECT count(*) FROM core.konzept;          -- 0
SELECT count(*) FROM core.betrieb_konzept;  -- 0
```

`mart.konzept_zuordnung.herkunft` steht für alle 141 Betriebe auf *„LINA kennt kein
Konzept"*.

**Folge:** Die gesamte Markenebene der Drill-Down-Kette (Dashboard ①) hat genau **eine
Zeile**, und der erste Klick der Kette ist wirkungslos. Die Struktur ist fertig und füllt
sich, sobald der Konzept-Import läuft — funktionsfähig ist sie heute nicht.

---

## 7. Weitere Lücken, die still aussehen

| Befund | Wirkung |
|---|---|
| `core.betrieb.stadt` ist bei **allen 141** `NULL` | Die Spalte „Stadt" ist überall leer. Der Excel-Filter „Städte/Regionen" hat keine Entsprechung. |
| `core.betrieb.hat_bwa` ist bei allen `false` | Das Feld trägt keine Information; die BWA-Brücke hängt an `lina_betrieb_id`. |
| `mart.umsatz_tag_sparte` summiert sich auf **0 €** | Speisen- und Getränkezeilen existieren (282), tragen aber keine Beträge. Alle Spartenauswertungen sind damit leer. |
| Verkaufsstellen-Zeilen: **0** | „Umsatz pro Verkaufsstelle" (Prio 1 laut `Umsetzung Berichte`) ist ohne Datenbasis. |
| `core.artikel` und `core.artikelverkauf_tag`: **0 Zeilen** | Renner/Penner, Deckungsbeitrag, theoretischer Wareneinsatz und die Umsatz-Gegenrechnung sind alle leer. |
| `core.personalkosten`: 141 Zeilen, alle für den **25.07.2026**, alle Werte `0.00` | Effektivitäten und Bereichsquoten sind vorhanden, aber inhaltlich leer. |

Von 98 Karten liefern deshalb **13 keine Zeile** — sämtlich aus Datenmangel, keine wegen
eines Fehlers. Welche das sind, zeigt die Karte *Befunde* auf dem Dashboard
*Datenqualität und Import*.

---

## 8. LINA liefert für Betriebe keine Adresse und keine Koordinaten

Nachgemessen am 26.07.2026 über **alle 489 archivierten API-Antworten**, rekursiv auf jeder
Verschachtelungsebene durchsucht (`payload` in `raw.api_antwort`, Muster
`addr|street|strasse|plz|zip|postal|city|stadt|ort|geo|lat|lng|coord|location`).

**Für Betriebe: kein einziger Treffer.**

| Endpunkt | Felder je Betrieb |
|---|---|
| `analyticsFilterOptions` | `id`, `name` |
| `getUmsatzbericht` | `name`, `encId` + Kennzahlen |
| `getPersonalkosten` | `name`, `encId` + Kennzahlen |
| `getZeitzonenbericht` | `name`, `encId` + Stunden |
| `getKennzahlen` | `key`, `data.name` + Monatswerte |

**Für Lieferanten dagegen schon:** `wawi:suppliers` liefert `strasse`, `plz`, `ort`
(z. B. „Elgendorfer Str", „56410", „Montabaur").

### `getStoreData` hat Koordinaten — aber nur für einen Betrieb

**Am 26.07.2026 direkt gemessen**, nicht aus dem Inventar übernommen.

`GET /einstellungen/api/getStoreData` (≈ 371 kB, 23.786 Felder) führt tatsächlich alles,
was eine Karte braucht:

```text
data.storeDetails.strasse      = "Lohenstr. 8"
data.storeDetails.plz          = "82166"
data.storeDetails.stadt        = "Gräfelfing"
data.storeDetails.geo_lat_ort  = "48.1203625"
data.storeDetails.geo_long_ort = "11.4471795"
```

Dazu `settings_long.flaeche`, `.plaetze`, `.tische` — die Bezugsgrößen für „Umsatz je
Sitzplatz" und „je Quadratmeter".

**Der Haken: es sind die Daten der Konzernzentrale, nicht eines Betriebs.** Der Endpunkt
liefert immer den Betrieb, in dem die Session gerade steht. Neun Parametervarianten
durchprobiert — `storeId`, `store`, `id`, `encId`, `laden`, jeweils mit `enc_id` und mit
numerischer LINA-ID, dazu ohne Parameter:

| Parameter | Antwort |
|---|---|
| *(ohne)* | CONCEPT FAMILY Franchise AG, Gräfelfing, 48.1203625 |
| `storeId=<encId>` | dieselbe |
| `store=`, `id=`, `encId=`, `laden=` | dieselbe |
| dieselben mit numerischer ID | dieselbe |

**Auch `storeList` hilft nicht.** `/common/api/account` führt sie, aber mit genau zwei
Einträgen — *CONCEPT FAMILY Franchise AG* und *Gastro Experts GmbH* — und je Eintrag nur
`name` und `encryptedId`. Keine Geofelder, und nicht annähernd die 141 Betriebe.

**Was daraus folgt.** Die Standorte sind über die bekannten Endpunkte **nicht** je Betrieb
holbar. Der einzige Weg wäre ein Wechsel des aktiven Betriebs in der Session — und der
verändert LINA-Zustand, was Regel 1 in `AGENTS.md` ausschließt („In LINA wird ausschließlich
gelesen"). Ob es dafür einen lesenden Weg gibt, ist ungeklärt und steht in
[`offene-punkte.md`](offene-punkte.md).

**Was gebaut ist:** `manual.betrieb_standort` (Migration `0008`) nimmt Koordinaten mit
ausgewiesener `herkunft` entgegen, `mart.standort` verbindet sie mit der Ampel, und die
Karte zeigt genau die Betriebe, die darin stehen. Gefüllt wird sie **nicht durch Raten aus
Betriebsnamen** — siehe [`dashboards.md`](dashboards.md), Abschnitt *Die Karte*.

### Nachtrag 10.08.2026: die Standortliste ist inzwischen zu zwei Dritteln gefüllt

`core.betrieb.stadt` ist unverändert bei **0 von 141** Betrieben gefüllt. `manual.betrieb_standort`
dagegen ist gepflegt worden — nachgemessen am 10.08.2026:

| Größe | Zahl |
|---|---|
| Betriebe mit Ortsangabe **und** Koordinate | 60 von 141 |
| davon im letzten bewerteten Monat operativ | 49 von 56 |
| operative Betriebe **ohne** Ortsangabe | 7 |
| Städte mit mindestens zwei laufenden Betrieben | 10 |

Damit ist ein Vergleich innerhalb einer Stadt erstmals möglich. Die zehn Gruppen:

| Stadt | laufende Betriebe | Marken |
|---|---|---|
| Karlsruhe | 4 | Aposto, Enchilada, Deutsche Konzepte, Wilma Wunder |
| Mainz | 4 | Aposto, Deutsche Konzepte, Wilma Wunder |
| Aalen, Augsburg, Düsseldorf, Freudenstadt, Heilbronn, Köln, Nürnberg, Würzburg | je 2 | je 2 |

In Karlsruhe steht zusätzlich ein fünfter geführter Betrieb (Wirtshaus Im Jagdgrund) ohne
laufenden Umsatz. **Deshalb führen die Sichten beide Zahlen getrennt:**
`mart.nachbarschaft.betriebe_am_ort` zählt geführte Betriebe, `mart.stadt_schnitt_monat.betriebe`
die im Monat operativen. Wer beide verwechselt, zählt einen stillgelegten Betrieb mit −100 %
Umsatz in einen Stadtdurchschnitt.

**Die sieben fehlenden sind der wunde Punkt.** Ein Betrieb ohne Ortsangabe fehlt in seiner
Stadt, und **dort fällt es nicht auf** — die Stadt sieht dann einfach so aus, als stünde er
nicht darin. Arbeitsliste: `mart.nachbarschaft_fehlend`, sichtbar am Fuß des Dashboards
⑩ Betrieb gegen die Stadt.

---

## 9. Der Wochenrhythmus ist ausgeprägt

Durchschnittlicher Tagesumsatz aller Betriebe:

| Tag | Ø Umsatz |
|---|---|
| Montag | 207.000 € |
| Dienstag | 215.000 € |
| Mittwoch | 225.000 € |
| Donnerstag | 250.000 € |
| Freitag | 383.000 € |
| **Samstag** | **546.000 €** |
| Sonntag | 285.000 € |

**Samstag trägt das Zweieinhalbfache des Montags.** Jede Diskussion über Öffnungszeiten,
Dienstpläne und Ruhetage fängt bei diesem Verhältnis an — deshalb Dashboard ⑦.

Die Streuung zwischen Betrieben ist groß: der Variationskoeffizient des Tagesumsatzes
reicht bis über 100 % (`Schlager Cafe Düsseldorf GmbH`: 107 %). Ein hoher Wert heißt
Abhängigkeit von Wochenenden, Events oder Wetter — und macht Personalplanung teuer.

---

## Was das für eine Auswertung bedeutet

Vor jeder Zahl, die den Betrieb verlässt:

1. **`mart.datenstand` aufmachen.** Sie sagt je Betrieb, bis wann Umsatz geladen und bis wann
   die BWA gebucht ist. Ohne das ist jede Schlussfolgerung eine Vermutung.
2. **Den Nenner nennen.** „62 Betriebe mit Umsatz" ist etwas anderes als „141 geführte
   Betriebe", und der Unterschied verdoppelt manche Prozentzahl.
3. **Median statt Mittelwert**, solange Betriebe ohne Umsatz in der Grundgesamtheit stehen.
4. **Leer heißt nicht null.** Eine leere Karte kann „nicht importiert", „nicht gebucht" oder
   „nicht erfasst" heißen — drei verschiedene Dinge mit drei verschiedenen Adressaten.

---

## Warum 43 von 44 Standorten rot sind — und warum das kein Datenfehler ist

**27.07.2026.** Auf der Standortkarte (Juni 2026) stand fast alles auf Rot. Naheliegender
Verdacht: ein Importfehler wie bei `numeric(6,2)`. Nachgeprüft — es ist keiner.

**Welche Kennzahl treibt das?** Von 48 Standorten im Juni:

| Teilampel | rot |
|---|---|
| Personal | **38** |
| Umsatz ggü. Vorjahr | 17 |
| Wareneinsatz Küche | 7 |
| Wareneinsatz Bar | 1 |
| Online-Bewertung | 0 (keine Daten) |
| OM-Score | 0 (keine Daten) |

**Sind die Personalzahlen echt?** LINA liefert die Personalquote auf zwei unabhängigen Wegen:
`getPersonalkosten.persoogBwa` als fertigen Prozentwert, und `getKennzahlen` als zwei
Absolutbeträge, aus denen man selbst teilen kann. Beide verglichen:

| Betrieb | aus `getKennzahlen` | aus `getPersonalkosten` |
|---|---|---|
| Gastronomie am Markt Mainz | 38,1 % | 38,1 % |
| Wilma Wunder Dresden | 35,3 % | 35,3 % |
| Wilma Wunder Köln | 44,2 % | 44,2 % |
| Ratskeller Augsburg | 47,5 % | 47,6 % |

Sie stimmen überein. Abweichungen von ein bis zwei Punkten erklären sich durch den
BWA-Versatz — `getKennzahlen` rechnet auf den Kalendermonat, `persoogBwa` auf den gebuchten
BWA-Monat. **Die Zahl ist richtig.**

**Die Schwelle passt nicht zur Zahl.** Verteilung über die 41 bewerteten Standorte:

| Schwelle grün / orange | grün | orange | rot |
|---|---|---|---|
| **28 / 32** (aus dem Excel-Blatt „Regeln") | 2 | 2 | **37** |
| 32 / 38 | 4 | 17 | 20 |
| 35 / 42 | 12 | 18 | 11 |

Median der tatsächlichen Werte: **37,7 %**, Spanne 22,5 % bis 48,9 %.

LINA pflegt eigene Schwellen je Betrieb (`core.schwellenwert_betrieb`, Median 27 grün /
35 orange). Auch damit bleiben 28 von 48 rot — die betriebsindividuellen Schwellen sind
nicht die Lösung, nur eine mildere Fassung desselben Problems.

**Der Konflikt war bekannt.** `docs/kennzahlen-mapping.md` Zeile K hält seit Phase 1 fest:
*„LINA liefert betriebsindividuelle Schwellen (z. B. 29/35, 30/34). Entscheidung nötig."*
Die Entscheidung steht bis heute aus, und ihr Fehlen ist genau das, was man auf der Karte
sieht.

**Das Excel berichtete genauso.** Nachgeschlagen in `JULI_Round_Table_Ampelsystem.xlsx`,
Blatt `Eingabe`, 22 Betriebe:

| | Excel Juli | unser Juni |
|---|---|---|
| Ampel Personal rot | 16 von 18 mit Daten | 38 von 48 |
| Gesamtstatus rot | **20 von 22** | 43 von 48 |
| grün | 1 | 0 |

Die dort eingetragenen Personalquoten: 34,2 · 35,9 · 36,0 · 43,9 · 40,6 · 34,7 · 38,6 · 45,0 ·
38,3 · 35,6 · 34,2 · 43,4 · 36,4 · 39,1 · 35,1 %. Grün waren genau zwei Betriebe (24,8 % und
26,9 %).

**Damit ist die Frage beantwortet: unsere Umsetzung ist dem Original treu.** Die rote Wand ist
kein Artefakt der Migration nach Postgres. Sie sah im Excel genauso aus, Monat für Monat, und
der Fachbereich hat damit gearbeitet.

**Was daraus folgt — und was nicht.** Es folgt NICHT, dass die Schwelle hochgesetzt werden
soll, damit die Karte grüner aussieht. Möglicherweise hat die Gruppe wirklich ein
Personalkostenproblem; 37,7 % im Median ist in der Systemgastronomie kein guter Wert, und
eine Ampel hat nicht die Aufgabe, hübsch auszusehen.

Es folgt aber: **eine Ampel, bei der 43 von 44 rot leuchten, kann nicht mehr steuern.** Sie
beantwortet die Frage „wo zuerst hinsehen?" nicht. Wer alles gleich schlimm anzeigt, zeigt
nichts an.

**Wie das Excel damit umging — und das ist die eigentliche Lehre.** Es hat nicht gemittelt.
Das Blatt `00_Dashboard` zeigt nebeneinander:

* **Gesamtstatus** (ein Rot färbt alles rot) — die grobe Sortierung
* **Intensität** (`Sofort eskalieren` / `Sofort handeln` / `Nachforschung` / `Beobachten/OK`)
  — die feine. Sie zählt, statt zu verodern, und trennt die rote Wand in 11 Eskalationen
  gegen 9 Handlungsfälle.
* **alle sechs Einzelampeln** in derselben Zeile
* einen Block „**Rot-Treiber nach Bereich**": je Bereich ein `COUNTIF(…,"🔴 Rot")`

Der Gesamtstatus war also nie als alleinige Anzeige gedacht. Er war die Überschrift, und
daneben stand immer, *warum*.

**Regel.** Wenn eine Ampel fast einfarbig ist, sind drei Dinge zu trennen: *stimmt die Zahl*
(hier ja), *entspricht es der Quelle* (hier ja, das Excel zeigte dasselbe) und *ist der Maßstab
noch der richtige* (offen). Nur die ersten beiden sind technische Fragen. Die dritte gehört dem
Fachbereich und darf nicht dadurch beantwortet werden, dass jemand still eine Konstante ändert.

Und: Bevor man eine Anzeige „verbessert", nachsehen, wie das abgelöste System berichtet hat.
Das Excel hatte den Rot-Treiber-Block bereits — die Antwort auf „warum ist alles rot" lag die
ganze Zeit in `examples/`.

---

# Nachgemessen am 11.08.2026: was für die Round-Table-Map wirklich fehlt

**Anlass.** Für die Round-Table-Map stand eine Liste von Punkten im Raum, die an Concept
Family gehen sollten. Diese Messreihe hat jeden davon in der Produktivdatenbank nachgerechnet,
bevor er weitergegeben wurde. Ergebnis: **ein großer Teil war keine Lücke, sondern eine
ungeprüfte Annahme.** Die Befunde unten stehen in der Reihenfolge ihrer Wirkung; der Stand
für den Fachbereich ist `docs/datenlage-round-table.html`.

## 1. Der Soll-Wareneinsatz: 5,3 % der Artikel sind 31,3 % des Umsatzes

Die bisher zitierte Zahl — *457 von 8.683 verkauften Artikeln haben einen `fixer_we`* — ist
richtig und **misst das Falsche**. Sie ist ein Artikelanteil. Für Kapitel 6.2 zählt der
Umsatzanteil, denn gewichtet wird nach Verkaufsmix.

```sql
WITH v AS (
  SELECT a.artikel_key, a.fixer_we, sum(av.umsatz_netto) AS umsatz
    FROM core.artikelverkauf_tag av JOIN core.artikel a USING (artikel_key)
   WHERE av.geschaeftstag >= DATE '2026-01-01' GROUP BY 1,2)
SELECT round(100.0*count(*) FILTER (WHERE fixer_we>0)/count(*),1)                    AS artikelanteil,
       round(100.0*sum(umsatz) FILTER (WHERE fixer_we>0)/sum(umsatz),1)              AS umsatzanteil
  FROM v;
-- 5.3 | 31.3
```

**Der Unterschied ist Faktor sechs.** Gepflegt ist offenbar, was verkauft wird.

Und der Konzernwert verdeckt, dass die Pflege **je Marke fast alles oder fast nichts** ist:

| Marke | Umsatz 2026 | Umsatzanteil mit Soll-WE |
|---|---:|---:|
| Enchilada | 14,43 Mio. € | **84,4 %** |
| Aposto | 10,89 Mio. € | **67,0 %** |
| Wilma Wunder | 17,13 Mio. € | 6,7 % |
| Schlager Cafe | 0,57 Mio. € | 5,5 % |
| Deutsche Konzepte | 23,06 Mio. € | 1,8 % |
| Besitos | 0,17 Mio. € | 0,1 % |

Je Betrieb: **15 Betriebe über 80 %, 13 zwischen 50 und 80 %.** Diese 28 tragen
24,58 Mio. € = **36,5 % des Artikelumsatzes 2026**.

**Was daraus folgt:** Kapitel 6.2 ist **für Enchilada und Aposto heute lieferbar**, nicht
„nicht lieferbar". Der Satz „ohne Nachpflege ist 6.2 nicht lieferbar" war eine
Konzernaussage über eine Größe, die es nicht als Konzernwert gibt. Die Nachpflege ist eine
Aufgabe für **Deutsche Konzepte und Wilma Wunder**, und für Wilma Wunder gibt es dafür einen
zweiten Weg (siehe Befund 8).

**Nebenbefund, gleiche Abfrage:** 4.088 Artikel mit 19,9 Mio. € Umsatz (29,6 %) haben
**überhaupt keine Warengruppe**. Fast alles davon Deutsche Konzepte (78,2 % ihres Umsatzes)
und Besitos (99,9 %). Deshalb summieren sich Speisen (26,95 Mio.) und Getränke (20,02 Mio.)
2026 auf 46,97 Mio. — der Gesamtumsatz ist 66,95 Mio. **Die Sparten-Trennung deckt 70 % des
Umsatzes ab, nicht 100 %.** Wer Speisen und Getränke addiert und das für den Umsatz hält,
verliert ein knappes Drittel.

## 2. Die Arbeitsstunden liegen vor — sie heißen nur nicht so

Das Dokument sagte: *„LINA liefert Personalkosten nur als Quote, keine einzige
Arbeitsstunde."* **Das ist widerlegt.**

`core.personalkosten.eff_*` ist **Umsatz je Arbeitsstunde** — also genau eine der beiden
Kennzahlen aus Kapitel 2.1, täglich, für 141 Betriebe, seit 01.01.2018 (442.599 Zeilen).
Aus ihr fallen die Stunden durch Division heraus. Die Zuordnung, welcher Umsatz zu welchem
Bereich gehört, ist **nicht geraten, sondern nachgerechnet** — sie schließt als Identität:

```
Stunden_Service = Umsatz_gesamt    / eff_service
Stunden_Bar     = Umsatz_Getränke  / eff_bar
Stunden_Küche   = Umsatz_Speisen   / eff_kueche
                                                  Summe = Umsatz_gesamt / eff_gesamt
```

Über 16.110 Betriebstage mit vollständiger Spartenaufteilung: **Median des Verhältnisses
0,99995**, exakt auf 0,5 % bei 73 % der Tage. Beispiel Enchilada Augsburg, 03.06.2026:
26,0 + 19,5 + 27,6 = 73,1 Stunden gegen 73,1 aus `eff_gesamt`.

**Gegenprobe gegen die BWA** — die entscheidende, weil sie eine unabhängige Quelle benutzt:

```sql
-- BWA-Personalkosten (EUR) geteilt durch die zurueckgerechneten Stunden
-- = impliziter Stundenlohn. 838 Betriebsmonate, 53 Betriebe, ab 2025.
```

| | €/Stunde |
|---|---:|
| p10 | 18,37 |
| Median | **21,12** |
| p90 | 25,21 |
| im Band 14–32 €/h | **97,7 %** |

Ein voll belasteter Stundensatz von 21 € ist für die Systemgastronomie plausibel. Dazu
**86 Stunden je Öffnungstag im Median** (p10 53, p90 165) bei 4.139 € Tagesumsatz.

**Was daraus folgt:** Kapitel 2.1 (Personalkosten je Umsatzstunde, Umsatz je Arbeitsstunde)
und „Gäste je Arbeitsstunde" sind **ohne Bericht 107 rechenbar**. Offen bleiben nur
Personalstunden je *Zeitzone* (die Stunden liegen je Tag vor, nicht je Stunde) und der
Plan-Ist-Vergleich, der Soll-Stunden braucht.

⚠️ **Die Abdeckung ist echt, nicht wie `fixer_we` mit Nullen getarnt.** 48 der 62 Betriebe
mit Umsatz haben an ≥95 % ihrer Umsatztage einen Wert, konzernweit rund 87 % der Umsatztage.
Zehn Betriebe haben gar keinen.

## 3. `pek_*` ist auf Tagesebene KEINE Quote

Beim Prüfen von Befund 2 aufgefallen und in [`fehlerkatalog.md`](fehlerkatalog.md)
ausführlich: `pek_service/bar/kueche/gesamt` wächst innerhalb eines Monats linear mit dem
Monatstag, während `eff_*` flach bleibt.

| Monatstag | Median `pek_gesamt` | Median `eff_gesamt` |
|---:|---:|---:|
| 1 | 43,8 | 55,7 |
| 15 | 422,8 | 52,3 |
| 31 | 717,6 | 60,1 |

Der Zähler ist **seit Monatsanfang kumuliert**, der Nenner ist der Tagesumsatz. Als Prozent
gelesen ist der Wert ab dem zweiten Tag des Monats falsch. Verlässlich ist allein
`persoog_bwa`: er stimmt mit dem BWA-Prozentwert exakt überein (Median-Abweichung 0,000 pp,
76,5 % der Fälle unter 0,15 pp).

## 4. Eigene Zeitfenster gehen — auf vollen Stunden

`core.zeitzonenbericht_stunde`: **10.618.992 Zeilen, Stunden 0–23 vollständig besetzt,
31.12.2017 bis 07.08.2026, alle 141 Betriebe.** Damit ist jedes Zeitfenster frei
schneidbar. `mart.umsatz_zeitfenster` (Migration `0052`) trifft die Stundensumme auf
**100,00 % von 30.597 Betriebstagen exakt**, inklusive Late Night über Mitternacht.

**Die Grenze:** LINAs eigene Zonen brechen bei 11:30 und 17:30, und das ist aus
Stundenwerten nicht nachbaubar. Mittagszeit 11:30–14:00 gegen eigenen Schnitt 11–14 ergibt
**+8,4 %**, gegen 12–14 **−8,4 %**; in Stunde 17 allein liegen 9,7 % des Tagesumsatzes.
Eigene Fenster und LINA-Zonen dürfen deshalb nicht gegeneinander gehalten werden.

„LINA kennt nur 6 feste Zonen" ist damit kein Mangel mehr. Was bleibt, ist eine
**fachliche Festlegung**: welche sieben Fenster die Map meint — auf vollen Stunden.

## 5. Der Aktionsstamm, sortiert

Alle zwölf Einträge mit ihren tatsächlichen Umsatzdaten. **Drei sind Kampagnen.**

| Eintrag | Betriebe | Tage | Umsatz | Einordnung |
|---|---:|---:|---:|---|
| Feinsparten 2025 | 12 | 365 | 10.375.393 € | Sortimentsauswertung, volles Jahr |
| Enchilada Happy Hour 22:30–23:00 | 19 | 365 | 836.337 € | Zeitfenster, täglich |
| Sekt alkoholfrei | 14 | 1.906 | 778.290 € | Dauersortiment seit 2020 |
| Auswertung HH Enchi ab 22:30 | 19 | 196 | 432.198 € | Zeitfenster, Dublette der Zeile 2 |
| Auswertung Frühstück | 13 | 34 | 392.469 € | Zeitfensterauswertung |
| Sarti Aktion | 13 | 1.655 | 216.766 € | läuft seit 28.05.2018 — Dauersortiment |
| **Sommermärchen 2025** | 10 | 89 | 70.847 € | **Kampagne** |
| Dessert | 13 | 35 | 48.856 € | Sortimentsauswertung |
| Test | 1 | 4 | 47.500 € | **Testeintrag mit echtem Umsatz** |
| **Mexican Summer** | 18 | 59 | 32.958 € | **Kampagne** |
| **Sonnenhut Aktion 2026** | 14 | 7 | 26.781 € | **Kampagne** |
| Happy Hour Enchilada KG3 | 0 | 0 | — | leer, stillzulegen |

Der Eintrag *Test* trägt 47.500 € an vier Tagen in einem Betrieb (Median 10.808 €/Tag) —
mehr als zwei der drei echten Kampagnen. Wer über „Aktionen" summiert, ohne zu trennen,
zählt ihn mit.

## 6. Aktionsartikel lassen sich NICHT aus den Verkaufsdaten erschließen

Versucht, und zwar mit Prüfmöglichkeit: LINA liefert den Aktionsumsatz je Betrieb und Tag,
also ist jede Kandidatenliste gegen eine bekannte Summe messbar. Methode: Artikel, die im
Aktionsfenster in teilnehmenden Betrieben neu auftauchen oder deren Tagesabsatz mehr als das
Dreifache des Zeitraums ±4 Wochen erreicht.

| Aktion | Kandidatenumsatz | LINA-Aktionsumsatz | Treffer |
|---|---:|---:|---:|
| Mexican Summer | 34.135 € | 32.958 € | 104 % |
| Sommermärchen 2025 | 253.512 € | 70.847 € | **358 %** |
| Sonnenhut Aktion 2026 | 16.470 € | 26.781 € | **61 %** |

**Die Spanne −39 % bis +258 % macht die Zuordnung unbrauchbar.** Das Verfahren findet
zwar Richtiges — bei *Sonnenhut* steht „Aperol Sommerhut" mit Lift 8,2 in der Liste —, kann
es aber nicht von zufälligen Ausschlägen trennen: darüber stehen „Speisenpauschale_"
(10.385 €) und „Raummiete" (3.336 €), also Bankettgeschäft. Dazu bestehen die „neu im
Fenster"-Artikel überwiegend aus Bonzusätzen ohne Umsatz („o. Brot", „extra Heiß").

**Was daraus folgt:** Die Zuordnung bleibt bei Concept Family. Aber die Kandidatenlisten
liegen vor und verkürzen die Arbeit auf Bestätigen statt Suchen. Eine **geratene Zuordnung
wird nicht übernommen** — sie führe in jede Deckungsbeitrags- und
Kannibalisierungsrechnung ein, ohne sich je wieder zu melden.

## 7. Die Historie ist vollständig — die Grundgesamtheit nicht

Fehlende **Kalendertage** zwischen 01.01.2018 und 07.08.2026: Umsatz 3, Zeitzonen 2,
Artikelverkauf 3 — und das sind ausschließlich die letzten Sync-Tage (04.–06.08.2026, dazu
22.07.2026 beim Artikelverkauf). **Es gibt keine Löcher in der Historie.**

Was es gibt, ist Wachstum der Gruppe:

| Jahr | Betriebe mit Umsatz | mit Vorjahresvergleich |
|---|---:|---:|
| 2018 | 36 | — |
| 2020 | 55 | 48 |
| 2023 | 66 | 61 |
| 2026 | 61 | **59** |

„Historie vollständig ab 01.01.2018" stimmt für die Datenkette. Ein Konzern-Vorjahresvergleich
2018 gegen 2026 stellt aber 36 Betriebe gegen 62. **Für 59 Betriebe ist der
Vorjahresvergleich sauber**, und nur so gehört er gerechnet.

## 8. FoodNotify und LINA sind komplementär, nicht redundant

Der zweite Weg zum Soll-Wareneinsatz führt über FoodNotify-Rezepturen. Sein Deckel steht
fest: der PLU-Join gilt nur bei `core.kostenstelle.kassensystem = 'amadeus'`
(`docs/foodnotify-0-1-nummernraum.md`). Gemessen: **42 Kostenstellen in 21 Betrieben, die
33,9 % des Umsatzes 2026 tragen.**

**Davon gehören 31 zu Wilma Wunder** — der Marke, deren `fixer_we`-Abdeckung bei 6,7 %
liegt. Die beiden Wege überlappen sich also kaum, sie ergänzen sich:

| Weg | Marken | Umsatzanteil 2026 |
|---|---|---:|
| LINA `fixer_we` | Enchilada + Aposto | 37,5 % |
| FoodNotify-Rezepturen | Wilma Wunder | 25,4 % |
| **zusammen** | | **≈ 63 %** |

Offen bliebe danach **Deutsche Konzepte (34,3 %)** — die Marke ohne Soll-WE, ohne
Warengruppen und mit vier der neun fehlenden Standorte.

**Nachtrag 11.08.2026, nachmittags: es gibt einen dritten Weg.** Die Ladenakte-Erhebung
(KORREKTUR 5) hat im Belegarchiv **394.552 Eingangsrechnungen** gefunden (Vollzählung über
alle 131 Betriebe; die zuerst genannten 308.387 stammten aus 99 gezählten), OCR-erschlossen,
jede mit `zuordnungFibu` ∈ {Bar, Küche, sonstiges} — der **Wareneinsatz-Split an der
Rechnung selbst**, unabhängig von Artikelpflege und PLU-Nummernraum. Er deckt damit auch
Deutsche Konzepte ab.

⚠️ **Zahlendreher in KORREKTUR 5 beachten:** dort steht „FoodNotify-PLU (~34 %) und
`fixer_we` (~63 %)". Richtig ist nach der Messung oben: **`fixer_we` = 31,3 %** des
Umsatzes, **Amadeus/FoodNotify-Obergrenze = 33,9 %**, und die **63 %** sind erst die
Summe beider Wege auf Markenebene. Die 63 % gehören nicht zu `fixer_we` allein.

**Nachtrag 12.08.2026: „komplementär" gilt für Rezepturen, nicht für Einkaufsvolumen.** Als
Quelle für den *Fremdeinkauf* ist FoodNotify nicht die eine Hälfte eines Paars, sondern die
schwächere Quelle — und zwar bauartbedingt. Siehe den Block *Nachgemessen am 12.08.2026*
weiter unten, Befund 4.

## 9. Bewertungstexte: 112.598, nicht 173.823

`core.bewertung` hat 173.823 Zeilen, aber **nur 112.598 tragen einen Text** (64,8 %);
106.539 haben mindestens 20 Zeichen. Die im Dokument genannte Zahl „173.823 Einzelbewertungen
mit Text" war der Gesamtbestand.

**Machbarkeitsprobe eigener Themenklassifikation**, 300 zufällige Bewertungen ab 2024,
von Hand gegen die elf Cluster der Map gelesen. Alle elf kommen vor; die sieben, die Yext
nicht kennt, sind gut belegt:

| Cluster | Treffer in 300 |
|---|---:|
| Atmosphäre / Ambiente | 95 |
| Getränke | 72 |
| Wiederbesuchsabsicht | 65 |
| Preis-Leistung | 37 |
| Reservierung / Empfang | 22 |
| Musik / Lautstärke | 14 |
| Aktion (positiv/negativ) | 14 |
| *Sauberkeit (kennt Yext)* | *6* |

Zum Vergleich: Yext hat seit April 2026 insgesamt **5.640 Themennennungen** vergeben, über
alle fünf Labels und alle 60 Betriebe. Dem stehen 106.539 auswertbare Texte gegenüber.

**Vier Grenzfälle, die ein Klassifikator abkönnen muss:**

* **Mehrsprachigkeit.** Rund 8 % englisch, dazu Italienisch, Französisch, Spanisch,
  Niederländisch, Norwegisch, Russisch (99 kyrillisch), Japanisch (33 CJK).
* **Sterne widersprechen dem Text.** 10,9 % der Fünf-Sterne-Bewertungen enthalten ein
  Negativwort („Service leider so gut wie nicht da" bei 5,0). Die Note taugt **nicht** als
  Sentiment-Etikett je Cluster; das muss aus dem Text kommen.
* **Fremde Objekte.** Einzelne Texte bewerten etwas anderes als den Betrieb (ein Hotelbad).
* **Dubletten.** 173 Texte kommen mehrfach vor (353 Zeilen, 0,36 %), 142 davon über
  mehrere Publisher.

**Nebenbefund mit eigener Wirkung:** rund 7 % der Texte **nennen Mitarbeitende beim Namen**
(„Lina", „Umut", „Tim", „Selin"). Damit ist ein Teil von Kapitel 4.2 — Wirkung auf
Personenebene — aus vorhandenen Daten greifbar, ohne Bounti. Der Notendurchschnitt bleibt
unverändert Yexts Zahl.

## 10. Kleinere Korrekturen an bisher genannten Zahlen

| Bisher | Gemessen 11.08.2026 |
|---|---|
| „17 Betriebe zählen lückenhaft, 2 nie" | **16 lückenhaft, 2 nie** (43 durchgängig) |
| „7 operative Betriebe ohne Standort" | **9 Betriebe mit Umsatz 2026** ohne Standort |
| „173.823 Einzelbewertungen mit Text" | 173.823 gesamt, **112.598 mit Text** |
| „5,3 % des Sortiments" | richtig, aber **31,3 % des Umsatzes** |

**Die Lücken in der Gästezählung sind meist kein Defekt, sondern ein Rollout.** Enchilada
Nürnberg zählt Januar bis Juni an 0 von 182 Tagen, im Juli an 27 von 29. Dasselbe Muster bei
den meisten der 16: sie stehen bei 13–14 %, also rund einem von sieben Monaten. **Wer das
als Rückgang liest, liest eine Einführung.**

Die neun Betriebe ohne Standort, nach Umsatz 2026 (`mart.kalender_fehlend`):

| Betrieb | Umsatz 2026 |
|---|---:|
| Wirtshaus am Schlossplatz GmbH | 5.528.220 € |
| Wirtshaus Lautenschlager GmbH | 2.510.525 € |
| WHK Gastronomie GmbH | 2.089.719 € |
| BS Bier & Speisen Gastro GmbH | 1.836.054 € |
| Gastronomie Wilsdruffer Straße GmbH | 1.025.991 € |
| SCHAFFERONE GmbH | 853.678 € |
| B+L Pforzheim GmbH | 650.443 € |
| GSF Gastro GmbH | 182.115 € |
| A Testladen Concept Family | 230 € |

Der erste ist **das umsatzstärkste Betrieb der Gruppe.** Er fehlt in jeder Stadt-, Feiertags-
und Vergleichstagsauswertung, und dort fällt es nicht auf.

## 11. Bewertungsquote und BWA-Takt

**Bewertungsquote** (Kapitel 3), nur die 39 Betriebe mit verlässlicher Gästezählung und ohne
die 14 Ausreißerzeilen: **27,9 Bewertungen je 10.000 Gäste im Median** (p10 16,4, p90 55,9),
Gruppenwert 31,4. Also rund **eine Bewertung je 320 Gäste**.

**BWA-Takt.** Stand 04.08.2026 gebuchte EBIT-Werte: April 65 Betriebe, Mai 63, Juni 41,
Juli 0. Der **Buchungsverzug ist noch nicht messbar**: `core.kennzahlen_monat` führt erst
Momentaufnahmen vom 26.07. bis 04.08.2026, also acht Tage. In diesen acht Tagen stieg Juni
von 23 auf 41 Betriebe. Wer den Verzug aus `min(abgerufen_am)` rechnet, misst den Beginn
unseres Imports, nicht die Arbeit der Buchhaltung. **Nach drei Monaten Momentaufnahmen ist
die Frage beantwortbar** — sie braucht keine Anfrage, nur Zeit.

## 12. Rendite: eine Definition, und sie ist LINAs

`wert_prozent` zu EBIT entspricht exakt `EBIT_absolut / Umsatz_absolut` — bei **100 % von
6.289 Betriebsmonaten** innerhalb von 0,05 pp, Median-Abweichung 0,003 pp. `Umsatz` steht
dabei durchgehend auf 100,0 %, alle Prozentwerte sind also „in % vom Umsatz".

~~Der geplante Abgleich gegen die „Betriebsergebnis-Rendite" des Wilma-Wunder-Reports
konnte nicht durchgeführt werden: dieser Report liegt nicht im Repository. Offen bleibt
damit genau eine Frage, und sie ist fachlich: Ist Concept Familys Betriebsergebnis
derselbe Zähler wie LINAs EBIT?~~

**Überholt am selben Tag** durch die Ladenakte-Erhebung, siehe
[`lina-api-korrekturen.md`](lina-api-korrekturen.md) KORREKTUR 5 und
[`lina-api-inventar-ladenakte.md`](lina-api-inventar-ladenakte.md). Die Langfrist-BWA
(`/finanzen/bwa/longterm`) führt **fünf Ergebniszeilen nebeneinander**: Operatives
Betriebsergebnis, Betriebsergebnis, EBIT, EBT und EBITDA — je Betrieb und Monat seit 2009,
in **einer** Anfrage.

Die Frage ist damit keine Datenfrage mehr, sondern eine Auswahl: **welche der fünf Zeilen
ist „die Rendite" des Round Table?** Für einen Betriebsvergleich spricht viel für das
operative Betriebsergebnis — Zinsen und Steuern sagen nichts über die Führung eines Betriebs.
Das entscheidet der Fachbereich.

## 13. Standort und Yext fehlen bei denselben neun Betrieben

Zwei getrennt geführte Arbeitslisten sind dieselbe Liste:

```sql
-- operative Betriebe ohne Yext-Zuordnung
SELECT b.name FROM core.betrieb b
  JOIN mart.umsatz_tag t ON t.betrieb_key = b.betrieb_key AND t.geschaeftstag >= DATE '2026-01-01'
  LEFT JOIN manual.betrieb_fremd_id f ON f.betrieb_key = b.betrieb_key AND f.system = 'yext'
 WHERE f.betrieb_key IS NULL GROUP BY 1 HAVING sum(t.umsatz_netto) > 0;
```

liefert **exakt dieselben neun Betriebe** wie `mart.kalender_fehlend`. Beide Tabellen —
`manual.betrieb_standort` und `manual.betrieb_fremd_id` — führen dieselben 60 Betriebe.

**Was daraus folgt:** ein Arbeitsgang schließt beide Lücken. Und die Betriebe fehlen
gleichzeitig in der Standortkarte, im Stadtvergleich, in der Feiertagsrechnung, im
Vergleichstag **und** in jeder Bewertungsauswertung — angeführt vom umsatzstärksten Betrieb der
Gruppe.

## 14. `mart.betrieb_status` beantwortet die Stilllegungsfrage bereits

Die Frage „welche der Betriebe ohne Umsatz sind Beteiligung, insolvent, Test oder nie
eröffnet" ist nicht offen — die Sicht gibt es:

| Status | Betriebe |
|---|---:|
| operativ | 57 |
| geschlossen | 39 |
| ohne Geschäft | 18 |
| verwaltend | 17 |
| inaktiv | 6 |
| Test | 4 |

**57 von 141 sind operativ.** Die bisher zitierten „79 ohne Umsatz" beruhten auf einem
anderen Schnitt (jemals Umsatz gegen Umsatz im letzten bewerteten Monat). Beide Zahlen sind
richtig und beantworten verschiedene Fragen — beim Weitergeben gehört der Nenner dazu.

---

# Nachgemessen am 12.08.2026: der Fremdeinkauf — und warum FoodNotify ihn nicht sieht

**Anlass.** Die Erhebung *GFGH Q2 2026.xlsx* (Getränkefachgroßhandel je Betrieb, 79
Produktpreise) kam fast leer zurück. Entschieden wurde, die fehlenden Angaben **nicht
nachzufordern, sondern aus den Rechnungen abzuleiten** — Migration `0055`, Begründung in
[`entscheidungen.md`](entscheidungen.md), Tabellenaufbau in
[`datenmodell.md`](datenmodell.md). Diese Messreihe prüft, was die neuen Sichten
`mart.fremdeinkauf` und `mart.lieferant_freigabe_stand` tatsächlich hergeben. Alle Zahlen
unten sind am 12.08.2026 auf `localhost/lina` gemessen.

## 1. Der Rücklauf trägt 8,7 % der gefragten Preise

Ausgezählt in der Rücklaufdatei: **88 Betriebsspalten × 79 Produktzeilen = 6.952 Preiszellen,
davon 607 gefüllt (8,7 %).** **44 Spalten sind ganz ohne Angabe**, und den Namen des eigenen
Getränkefachgroßhändlers nennen **14 von 88** Betrieben.

Das ist keine dünne Datenlage, das ist keine. Eine Preiserhebung, die neun von zehn Feldern
leer zurückbekommt, trägt keinen Betriebsvergleich — auch nicht für die 8,7 %, denn welche
Betriebe antworten, ist nicht zufällig.

**Was daraus folgt:** Jede Aussage über Getränkepreise stammt ab hier aus Rechnungsdaten. Was
die tragen und was nicht, steht in den Befunden 4 und 5 — und der Preis dafür ist, dass der
Weg über die Belege **keine Artikel und keine Einzelpreise** liefert (Weg A der Erhebung vom
11.08.2026, siehe [`lina-api-korrekturen.md`](lina-api-korrekturen.md)). Die Erhebung war im
Kern eine *Preis*erhebung; genau das kann der Ersatzweg heute nicht.

## 2. Distra ist ein Lieferant, nicht vier

In FoodNotify steht derselbe Großhändler unter vier Schreibweisen — `distra gmbh`,
`distra aposto`, `distra deutsche`, `distra enchilada coyacan`. Zusammengeführt über
`manual.kreditor_gruppe`:

```sql
SELECT count(DISTINCT betrieb_key) AS betriebe, round(sum(netto)) AS netto
  FROM mart.fremdeinkauf WHERE quelle='foodnotify' AND lieferant='Distra';
-- 56 | 21.666.348
```

**21,67 Mio. € über 56 Betriebe, gesamte Historie** — vorher vier Zeilen, von denen keine
groß genug aussah, um die Frage nach Konditionen zu stellen. Sechs Dachnamen fassen heute
mehrere Schreibweisen zusammen (Distra vier, FFD, GLH, Pentz, Splendid Drinks, WIGEM je
zwei).

⚠️ **Über alle Kostenstellen gerechnet sind es 22.475.163 €.** Die Differenz von 808.815 €
fehlt in der Sicht, weil sie auf Kostenstellen ohne Betrieb liegt — Befund 5. Wer Distra
gegenüber verhandelt, sollte die größere Zahl kennen.

## 3. Drei Zustände, und die Verdachtsliste ist heute leer

Die Sicht unterscheidet *freigegeben* / *nicht freigegeben* / *nicht eingeordnet*; warum
Abwesenheit einer Freigabe nicht „nicht freigegeben" heißen darf, steht in
[`entscheidungen.md`](entscheidungen.md). Gemessen wurde hier nur, was heute herauskommt:

| Einordnung, `quelle='foodnotify'`, ab 01.08.2025 | Netto | Betriebe | Lieferanten |
|---|---:|---:|---:|
| freigegeben | 12.303.849 € | 51 | 7 |
| nicht eingeordnet | 1.116.877 € | 33 | **71** |
| nicht freigegeben | **0 €** | 0 | 0 |

**`einordnung = 'nicht freigegeben'` trifft 0 von 9.078 Zeilen — über die gesamte Historie.**
Der Zustand feuert nur, wenn ein Betrieb einen aufgelösten GFGH hat *und* bei einem anderen
kauft, der irgendwo als GFGH gepflegt ist. Gepflegt sind 13 Zeilen in
`manual.gfgh_betrieb`, davon **5 mit Namen** — also zwei Firmen, WIGEM und GLH. **47 der 51
Betriebe mit Einkaufsvolumen der letzten 12 Monate haben keinen aufgelösten GFGH**, und für
sie kann der Befund gar nicht auslösen. Wer die Verdachtsliste heute öffnet und sie leer
findet, hat *nichts gemessen*, nicht *nichts gefunden*.

Was die zwei gepflegten Firmen zeigen, ist trotzdem der Fall, um den es geht:

| Lieferant | Betriebe | Netto | Einordnung |
|---|---:|---:|---|
| WIGEM Getränke | 3 mit WIGEM als hinterlegtem GFGH | 487.425 € | freigegeben |
| WIGEM Getränke | 1 ohne GFGH-Eintrag | 171.434 € | nicht eingeordnet |
| GLH Getränke Logistik Heilbronn | 1 mit GLH als hinterlegtem GFGH | 56.584 € | freigegeben |
| GLH Getränke Logistik Heilbronn | 3 ohne GFGH-Eintrag | 175.843 € | nicht eingeordnet |

Vier Betriebe kaufen bei GLH, **eines** hat GLH hinterlegt. Die anderen drei stehen nicht
deshalb auf „nicht eingeordnet", weil an ihrem Einkauf nichts wäre, sondern weil niemand
ihren GFGH eingetragen hat. **Die Arbeitsliste ist die Pflege, nicht der Einkauf.**

Nach Volumen führt sie `mart.lieferant_freigabe_stand` an — größter Posten
**Transgourmet mit 2.654.937 € über 27 Betriebe, letzter Beleg aber 09.01.2025**, also
vermutlich abgelöst. Die Spalte `fn_letzter_beleg` gehört deshalb neben jedes Volumen: ein
großer Posten ohne frischen Beleg ist Vergangenheit, kein Handlungsbedarf.

## 4. FoodNotify ist für den Fremdeinkauf strukturell blind

Das ist der Befund, der alle Zahlen dieses Blocks relativiert. **Wer am System vorbei
bestellt, erzeugt in FoodNotify keine Zeile.** Fremdeinkauf ist definitionsgemäß der Einkauf,
der die vorgesehenen Wege verlässt — die Quelle unterschätzt ihn also **genau dort, wo er am
größten ist**, und zwar bauartbedingt, nicht wegen einer Lücke im Import. Kein Nachladen
behebt das.

Die Reichweite dazu:

```sql
WITH fn AS (SELECT k.betrieb_key FROM core.bestellung b JOIN core.kostenstelle k USING (kostenstelle_key)
             WHERE b.status IS DISTINCT FROM 'canceled' AND b.bestellt_am >= date '2025-08-01'
               AND k.betrieb_key IS NOT NULL GROUP BY 1),
     u AS (SELECT betrieb_key, sum(umsatz_netto) AS umsatz FROM core.umsatzbericht_tag
            WHERE geschaeftstag >= date '2025-08-01'
              AND hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL GROUP BY 1)
SELECT CASE WHEN f.betrieb_key IS NOT NULL THEN 'mit FoodNotify' ELSE 'ohne FoodNotify' END AS gruppe,
       count(*) AS betriebe, round(sum(u.umsatz)) AS umsatz_12m,
       round(100.0*sum(u.umsatz)/sum(sum(u.umsatz)) OVER (),1) AS pct
  FROM mart.betrieb_status s
  LEFT JOIN fn f ON f.betrieb_key = s.betrieb_key
  LEFT JOIN u ON u.betrieb_key = s.betrieb_key
 WHERE s.status='operativ' GROUP BY 1;
```

| Operative Betriebe | Betriebe | Umsatz 12 M | Anteil |
|---|---:|---:|---:|
| mit FoodNotify | 43 (75,4 %) | 78.337.191 € | 70,0 % |
| **ohne FoodNotify** | **14 (24,6 %)** | **33.530.901 €** | **30,0 %** |

**Der blinde Fleck ist ein Viertel der Betriebe, aber 30 % des Umsatzes** — er trifft die
großen. Und er ist keine Streuung: **zehn der 14 sind Deutsche Konzepte**, dazu zwei
Enchilada, ein Schlager Cafe, ein Kooperationspartner. Es fehlt fast eine ganze Marke —
dieselbe, die schon bei `fixer_we` (Befund 1 vom 11.08.) und bei den Warengruppen fehlt.

**Der Nenner „51 von 141" ist irreführend** und sollte so nicht weitergegeben werden. Richtig
ist: **62** Betriebe haben jemals über FoodNotify bestellt, **51** in den letzten 12 Monaten,
und die einzige Zahl, die etwas besagt, ist **43 von 57 operativen**. In den 141 stecken 39
geschlossene, 18 ohne Geschäft, 17 verwaltende, 6 inaktive und 4 Testbetriebe (Befund 14 vom
11.08.).

**Was daraus folgt:** Aus FoodNotify allein darf **kein Fremdeinkaufsanteil** berichtet
werden — weder je Konzern noch je Marke. Zulässig ist die Aussage „bei diesen Lieferanten,
in diesen Betrieben, mindestens dieses Volumen". Die Gegenprobe kann nur das Belegarchiv
liefern, weil dort jede *gebuchte* Rechnung steht, unabhängig vom Bestellweg.

⚠️ **Diese Gegenprobe fehlt heute noch.** `core.buchungsbeleg` steht am 12.08.2026 auf
**0 Zeilen**; `quelle='belegarchiv'` liefert also keine einzige Zeile. Erwartet werden laut
`manual.belegarchiv_soll` **1.048 Betrieb/Belegart-Paare, 621 davon nicht leer, 593.314
Belege — darunter 394.552 Eingangsrechnungen.** Der Abzug startet beim nächsten Sync-Lauf von
selbst. Bis dahin ist jede Fremdeinkaufszahl eine Untergrenze aus der schwächeren Quelle.

## 5. 25 Kostenstellen ohne Betrieb — 1,13 Mio. €, und zwei Sichten mit verschiedenen Summen

```sql
SELECT count(*) FILTER (WHERE betrieb_key IS NULL) AS ohne, count(*) AS gesamt
  FROM core.kostenstelle;                                            -- 25 | 152
```

**25 von 152 Kostenstellen (16,4 %) haben keinen `betrieb_key`**, 18 davon tragen
Bestellungen: **951 Bestellungen über 1.127.133 €** (3,1 % des Bestellvolumens; in den
letzten 12 Monaten 313.770 €). Weil `mart.fremdeinkauf` auf `betrieb_key IS NOT NULL`
filtert, fällt das **vollständig aus der Sicht**.

Betroffen sind **echte Betriebe, keine Testeinträge**: 1.095.156 € entfallen auf sieben
laufende oder ehemals laufende Betriebe, nur 31.977 € auf vier Testbetriebe. Und es fehlen
**immer ganze Betriebe, nie einzelne Bar- oder Küchenkostenstellen** eines sonst zugeordneten
Betriebs — für alle 15 betroffenen Restaurantnamen gilt: keine einzige ihrer Kostenstellen
ist zugeordnet. Beim Gegenprüfen gegen `core.betrieb` zerfällt das in drei verschiedene
Fehler:

| Fall | Beispiele | Was fehlt |
|---|---|---|
| Zuordnungslücke | Lehners Karlsruhe (107), Lehners Wirtshaus Rastatt (108) | Betrieb existiert und ist operativ, hat aber **null** Kostenstellen |
| Betrieb fehlt ganz | Riegele Wirtshaus, Zum Augustiner Rosenheim, Enchilada Darmstadt | keine Zeile in `core.betrieb` |
| Status widerspricht dem Einkauf | Aposto Wuppertal II bestellt bis 02.08.2026 | plausibler Betrieb 18 steht auf `ohne_geschaeft` |

Für den GFGH-Befund heißt das konkret: **GLH hat 84.336 € auf nicht zugeordneten gegen
89.442 € auf zugeordneten Kostenstellen** — knapp die Hälfte des GLH-Volumens fällt aus
`mart.fremdeinkauf` heraus. Drei Lieferanten sind darin **komplett unsichtbar**, weil kein
einziger ihrer Euros auf einer zugeordneten Kostenstelle liegt (abels fruechtewelt
145.391 €, intergast deutschland 307 €, „test 1" 3 €).

⚠️ **Dieselbe Migration nennt für denselben Bestand zwei Summen.**
`mart.lieferant_freigabe_stand` filtert nicht auf `betrieb_key IS NOT NULL`,
`mart.fremdeinkauf` schon:

```sql
SELECT round(sum(fn_netto)) FROM mart.lieferant_freigabe_stand;                      -- 35.894.104
SELECT round(sum(netto))    FROM mart.fremdeinkauf WHERE quelle='foodnotify';        -- 34.766.971
```

Die Differenz ist exakt die 1.127.133 € von oben. **Beide Zahlen sind richtig und
beantworten verschiedene Fragen** — die Arbeitsliste soll das Volumen eines Lieferanten
vollständig zeigen, die Betriebssicht nur, was einem Betrieb zurechenbar ist. Steht das nicht
daneben, sieht es wie ein Rechenfehler aus. Ein Nebeneffekt derselben Bauart:
`fn_betriebe = 0` bei vollem `fn_netto` ist kein Defekt, sondern genau dieser Fall —
`count(DISTINCT betrieb_key)` überspringt NULL.

Die Arbeitsliste zum Schließen der Lücke gehört an Concept Family; sie steht in
[`offene-punkte.md`](offene-punkte.md).


## Nachtrag 12.08.2026: die Zahlen zum Fremdeinkauf gelten für zwei Zustände

Der Block oben rechnet mit drei Zuständen und nennt die Verdachtsliste leer. **Das gilt
nicht mehr:** `mart.fremdeinkauf` führt seit dem 12.08.2026 zwei Zustände mit dem Standard
`nicht freigegeben`. Gemessen über die letzten zwölf Monate, Quelle FoodNotify:

| Einordnung | Grund | Betriebe | Lieferanten | Netto EUR |
|---|---|---|---|---|
| freigegeben | Konzernfreigabe | 51 | 5 | 12.158.163 |
| freigegeben | GFGH des Betriebs | 4 | 2 | 145.686 |
| **nicht freigegeben** | steht nicht auf der Liste | **33** | **71** | **1.116.877** |

Grösste Posten: Trinkkontor 141.753 EUR (3 Betriebe), Getränke Keller 134.626 (2),
GLH Getränke Logistik Heilbronn 99.531 (3), Hubauer 82.484 (1), Würzburger Hofbräu 64.310
(1), FFD Frisch Fruchtig Delp 48.847 (8), Segafredo Zanetti 32.153 (7).

**GLH ist der lehrreiche Fall.** Bei Wilma Wunder Stuttgart und Wirtshaus Lautenschlager ist
GLH der hinterlegte GFGH und damit freigegeben; an drei weitere Betriebe liefert dieselbe
Firma ohne Hinterlegung. Derselbe Lieferant steht also in beiden Spalten — genau die
Unterscheidung, die die GFGH-Erhebung treffen wollte.

Betriebe mit dem höchsten Fremdanteil: B+L Pforzheim 54 Prozent, Wilma Wunder Köln 28,
Speyer und Passau je 26, Düsseldorf 25.

**Diese Liste enthält berechtigte Fälle** — Brauereien mit Liefervertrag und rund ein
Dutzend Winzer. Sie gehören in `manual.lieferant_freigabe` eingetragen, nicht in einen
dritten Zustand. Die Liste schrumpft, während sie abgearbeitet wird.

---

## Ein entzogener Preis kommt zurück: `menge_unstimmig` ohne NULL (gemessen 12.08.2026)

Migration 0042 entzieht `core.bestellposition.preis_je_einheit` dort, wo die Gesamtmenge
nicht belastbar ist, und setzt `menge_unstimmig`. Wer eine geprüfte Grösse will, prüft
deshalb auf `preis_je_einheit IS NOT NULL` — so stand es bis heute auch in 0056.

**Das reicht nicht.** Gemessen auf dem lokalen Bestand:

| Bedingung | Positionen |
|---|---|
| `menge_unstimmig` gesetzt | 6.296 |
| davon **mit** einem Preis je Einheit | **561** |
| dieselbe Zahl nach einem weiteren Nachlauf | **613** |

Die Ursache ist die Reihenfolge im Nachlauf (`src/sync/einkaufspreis.ts:37-40`):

1. `core.gebinde_vereinheitlichen()` läuft zuerst und schreibt `preis_je_einheit` neu —
   ohne bereits markierte Zeilen auszunehmen (`0040:77-82`).
2. `core.preis_ausreisser_markieren()` läuft danach und fasst genau diese Zeilen nicht mehr
   an, denn es filtert `AND NOT p.menge_unstimmig` (`0040:135`).

Jeder Lauf gibt also einigen verworfenen Zeilen ihren Preis zurück, und der Markierer darf
ihn nicht mehr nehmen. Die Zahl wächst mit jedem Lauf.

**Regel daraus: `NULL` heisst „geprüft und verworfen", `NOT NULL` heisst nicht „geprüft und
bestanden".** Das Urteil steht in `menge_unstimmig`, nicht in der Anwesenheit des Wertes.
`mart.einkaufspreis_betrieb` filtert seit **Migration 0057** auf beides — nicht als
Korrektur in 0056, weil die auf dem Server bereits angewendet war und der Runner sie
überspringt. Kosten: 255 Zeilen weniger,
erfundene Ersparnis 17.512 → 17.453 EUR. Darunter acht Positionen „Idee Entkoffeiniert
50 Pouches A 7G" zu 42.350 EUR je Kilogramm — dieselbe Ware, deretwegen 0042 gebaut wurde,
auf einem zweiten Weg zurück in der Auswertung.

**Ob `gebinde_vereinheitlichen()` die Markierung löschen dürfte**, wenn es die Menge
korrigiert, ist eine Frage an den Eigentümer dieser Logik und hier bewusst nicht
entschieden: die Funktion korrigiert `gesamt_menge` tatsächlich, ein danach gerechneter
Preis kann also stimmen. Geändert wurde nur der Konsument.

### Was auch danach drinbleibt, ohne zu lügen

Ein Preis, der in **allen** Betrieben gleich falsch ist, überlebt beide Prüfungen: 0040
vergleicht gegen den Median derselben Ware, und wenn der genauso hoch liegt, widerspricht
nichts. „Idee Entkoffeiniert" steht im Februar 2026 in drei Betrieben bei 48.400 EUR je
Kilogramm und ist `vergleichbar = true`.

Ein falscher Befund entsteht daraus trotzdem nicht: alle drei zahlen dasselbe, also ist
`abweichung_pct` = 0,0 und `mehrkosten` = 0. Die Spalte `preis` ist Unsinn, die Aussage der
Sicht ist keine. **Die Sicht prüft Abweichungen, nicht absolute Plausibilität** — wo alle
gleich falsch buchen, gibt es keine Referenz. Wer absolute Einkaufspreise lesen will, nimmt
nicht diese Sicht.

Die einzige Zeile dieser Ware, die ein Befund geworden wäre — Speyer mit 48,40 gegen einen
Median von 24.224 — ist von allen drei Sperren gleichzeitig geblockt.

---

## Der Belegarchiv-Zweig, zum ersten Mal an echten Daten (gemessen 12.08.2026)

Der Erstlauf ist durch: **593.353 Belege** stehen in `core.buchungsbeleg`, gegen ein Soll
von 593.314 — vollständig. Damit lief `mart.fremdeinkauf` zum ersten Mal mit beiden
Zweigen. **Der Belegarchiv-Zweig trägt noch nicht.** Vier Mängel, gemessen auf der
Produktionsdatenbank über den SSH-Tunnel, rein lesend.

| Grösse | Zeilen | Anteil |
|---|---|---|
| Belege gesamt | 593.353 | |
| davon Rechnungen (`typ_id = '1'`) | 394.575 | 100 % |
| mit Lieferantennamen | 124.310 | **31,5 %** |
| mit Betrag ≠ 0 | 111.272 | 28,2 % |
| **mit beidem — die nutzbare Menge** | **103.846** | **26,3 %** |

### 1. Der Betrag fehlt bei 71,8 Prozent, und das ist grösstenteils kein Fehler

283.303 Rechnungen tragen `netto = 0`. Davon haben **269.514 auch kein Rohfeld** —
LINAs Belegliste (Weg A) liefert für sie schlicht keinen Betrag. Das ist eine Grenze der
Quelle, nicht der Verarbeitung, und über Weg A nicht zu heilen.

**3.219 sind dagegen ein echter Parserfehler:** `netto_split_roh` enthält Werte, `netto`
steht auf 0. Beispiele: `3,50/0,00/783,46`, `-10,50/1.014,61/0,00`, `0,00/983,77/0,00`.
Diese Belege sind rückholbar.

### 2. Achtundachtzig Zeilen sind Faktor 10⁸ zu gross

Die Summe des Zweigs meldete **14.024.387.689.386 EUR**. Vierzehn Billionen sind kein
Befund, sondern ein Rechenfehler in 88 Zeilen:

| `netto_split_roh` | gespeichert | richtig |
|---|---|---|
| `7.847,11/0,00/7.847,11` | 784.712.000.000 | 7.847,12 |
| `5.541,71/0,00/5.541,71` | 554.172.000.000 | 5.541,72 |

Das Muster ist konstant: **Cent × 10⁶**. Grenzt man auf `abs(netto) <= 100.000` ein,
bleiben **114.036.715 EUR** — eine plausible Grössenordnung und rund das 2,7-fache des
FoodNotify-Zweigs (42,3 Mio.).

### 3. Die Kreditor-Zuordnung kennt die Schreibweisen des Belegarchivs nicht

Das ist der teuerste Mangel, weil er wie ein Befund aussieht. `manual.kreditor_gruppe`
wurde aus FoodNotify-Namen gebaut. Das Belegarchiv schreibt anders — und **freigegebene
Lieferanten landen dadurch im Fremdeinkauf**:

| normierter Name | Netto | eingeordnet als |
|---|---|---|
| `distra handels gmbh` | 19.141.334 | *nicht freigegeben* |
| `chefs culinar wir leben foodservice` | 5.593.503 | *nicht freigegeben* |
| `chefs culinar sued gmbh und co kg tel 08291` | 3.670.576 | *nicht freigegeben* |
| `layer chemie gmbh` | 1.091.133 | *nicht freigegeben* |
| `Chefs Culinar` | 866.030 | freigegeben ✓ |

Daher die **8.164 „nicht freigegebenen Lieferanten"** aus der ersten Auswertung: es sind
8.395 normierte Schreibweisen, und getroffen wird fast keine. Die Zahl ist ein
Zuordnungsproblem, kein Einkaufsproblem.

### 4. Das Belegarchiv enthält alle Rechnungen, nicht nur Wareneinkauf

Unter den grössten „Lieferanten" stehen `visa` (1.285.805), `pay one` (1.260.471),
`concept family franchise ag` (7.499.249) und `family und friends marketing gmbh`
(2.224.204). Zahlungsdienstleister, Konzerninnenumsatz, Marketing. Ohne Abgrenzung auf
Wareneinkauf zählt jede Versicherungsrechnung als Fremdeinkauf. `manual.sachkonto` und
`manual.kreditor_gruppe` aus 0053 sind dafür da und noch nicht bestückt.

### Was daraus folgt

Die Reihenfolge ist nicht beliebig: **erst 3, dann 4, dann 2, dann 1.** Die Zuordnung ist
der grösste Hebel — sie verwandelt 8.164 Verdachtsfälle in eine Liste, die ein Mensch
abarbeiten kann. Die Abgrenzung auf Wareneinkauf entfernt die Zahlungsdienstleister. Erst
danach lohnt der Zahlenfehler, und der Nullbetrag ist zu zwei Dritteln gar nicht heilbar.

**Bis dahin gilt für jede Auswertung des Zweigs:** `abs(netto) <= 100000` filtern und die
Einordnung nicht als Ergebnis lesen. Und weiterhin nie über `quelle` summieren — jetzt, wo
beide Zweige Daten führen, steht dieselbe Rechnung erstmals wirklich doppelt da.

### Was Migration 0058 daraus macht (gemessen 12.08.2026, Produktionsdatenbank)

Die drei Mängel oben sind behoben, soweit sie zu beheben sind. Gemessen wurde, indem die
Seeds schreibgeschützt gegen den Produktivbestand durchgespielt wurden — 0058 selbst ist
zum Zeitpunkt der Messung dort noch nicht angewendet.

**Die Abgrenzung trägt sofort.** Vom plausiblen Belegarchiv-Volumen (126,6 Mio EUR bei der
neuen Grenze von 1 Mio je Beleg):

| Art | Lieferanten | Netto | Anteil |
|---|---|---|---|
| **wareneinkauf** | 34 | **52.353.623** | 41,4 % |
| *nicht eingeordnet* | 8.292 | 44.062.259 | 34,8 % |
| konzern | 13 | 14.380.916 | 11,4 % |
| zahlungsdienst | 7 | 5.382.182 | 4,3 % |
| energie | 5 | 2.580.684 | 2,0 % |
| handwerk_bau | 7 | 2.510.987 | 2,0 % |
| bank_leasing | 8 | 2.449.787 | 1,9 % |
| marketing_plattform | 3 | 1.110.648 | 0,9 % |
| behoerde | 3 | 784.505 | 0,6 % |
| dienstleistung | 3 | 562.647 | 0,4 % |
| miete | 1 | 425.951 | 0,3 % |

**Fast ein Viertel des Volumens (29,8 Mio EUR) ist gar kein Wareneinkauf** und hätte ohne
diese Abgrenzung als Fremdeinkauf gezählt — allein 14,4 Mio Konzerninnenumsatz und 5,4 Mio
Kartengebühren.

**Der Befund, der übrig bleibt**, auf den eingeordneten Wareneinkauf gerechnet:

| | Lieferanten | Betriebe | Netto |
|---|---|---|---|
| freigegeben (Konzernfreigabe) | 5 | 70 | 34.900.401 |
| **nicht freigegeben** | **29** | **83** | **17.453.222** |

Aus 8.164 Verdachtsfällen und 14 Billionen sind **29 Lieferanten und 17,5 Mio EUR**
geworden. Der GFGH je Betrieb ist hier noch nicht gegengerechnet — die Sicht tut das, also
liegt die echte Zahl darunter.

**Was offen bleibt: 44 Mio EUR auf 8.292 uneingeordneten Namen.** Das ist die Arbeitsliste,
und sie ist nach Volumen sortiert abzuarbeiten. Die 34 eingeordneten Warenlieferanten
decken bereits 41 Prozent; die Namen darunter werden schnell klein und OCR-verrauscht
("comis9 shemalessignal iduna gruppe"). Bewusst nicht zugeordnet bleibt `cf`
(245.551 EUR, 13 Betriebe): das kann CF Gastro sein oder Concept Family, Wareneinkauf oder
Konzerninnenumsatz — und das entscheidet kein Präfix.

---

## Drei Befunde aus der Dashboard-Durchsicht (Fachbereich, 12.08.2026)

Der Fachbereich hat das Dashboard „Einkauf — Preise, Lieferanten, Volumen" durchgesehen und
drei Dinge gemeldet: viele Preise verdoppeln sich exakt, der Verlauf sagt wenig aus, der
Schwund wirkt zu hoch. **Alle drei trafen zu, zwei waren schlimmer als gemeldet.**

### 1. Die Verdopplungen sind Gebindewechsel

**41 von 200 Zeilen** der Karte „Was ist teurer geworden?" standen auf exakt +100,0 %,
**39 davon exakt auf dem Doppelten** des Vormonats. Weil die Karte nach Sprunggrösse
sortiert, standen sie **alle ganz oben** — die ersten zehn Zeilen ausnahmslos.

Ursache, an „Grana Padano Pdo Gehobelt 32% 500G" im **selben** Monat gemessen:

| menge | gebinde_menge | Preis je Gebinde | Zeilen (Juni 2026) |
|---|---|---|---|
| 1 | 1 | 8,82 | 19 |
| 1 | 2 | 17,64 | 5 |

Zwei Buchungsstile nebeneinander; der Monatsmedian kippt zwischen ihnen. Dieselbe Krankheit,
gegen die 0056 die Sperre `gebinde_uneinheitlich` hat — `einkaufspreis_monat` kannte sie nicht.

**Zwei Fehler im Filter dazu.** `verdaechtig` prüfte auf Sprünge **über** ±100 %, exakt 100,0
rutschte durch — also genau der häufigste Fall. Und schwerer: **die Prozentskala ist
asymmetrisch.** Eine Verdopplung sind +100 %, eine Halbierung nur −50, ein Sturz auf ein
Hundertstel −99. Nach unten konnte die Grenze **nie** greifen; „Karotten Standart (10 Kg)"
stand mit 62,90 → 0,63 als unverdächtig in der Liste.

Behoben in **0062**: `gebinde_typisch` (Modus) in `einkaufspreis_monat`, `verdaechtig` bei
Gebindewechsel oder mehreren Gebindegrössen im Monat, und die Grenze rechnet als
**Verhältnis** (Faktor 2 in beide Richtungen) statt in Prozent. Ergebnis: exakte
Verdopplungen von 39 auf 0, Spanne der Karte jetzt +100,0 bis −50,0.

### 2. „Im Verlauf" zeigte keinen Verlauf

Schlimmer als gemeldet: die 500 Zeilen deckten **genau einen Monat** ab (August 2026) mit
**441 verschiedenen Waren**. `ORDER BY monat DESC, ausgaben DESC LIMIT 500` schnitt ab,
bevor ein zweiter Monat kam. Die Sicht darunter hat 9.887 Waren über 75 Monate.

Behoben in der Karte: erst die Waren nach Volumen ranken, dann von den zwanzig grössten die
ganze Historie zeigen. Dazu ein **Warenfilter mit Werteliste** (9.887 Namen der Sorte
„Blumenk.i.backt10,2G Tk Veg7Kg" tippt niemand fehlerfrei) und eine neue Linienkarte
`wa_preis_verlauf`.

### 3. Der Schwund war nicht zu hoch, sondern unbrauchbar

Drei Fehler übereinander:

| | |
|---|---|
| **Testinventuren zählten mit** | 61 von 358 tragen „Test" im Namen; „Test Inventur" bei Aposto Gera steht auf `signed` mit 285 Positionen |
| **Teilinventuren gegen Vollsortiment** | 155 Inventuren nennen einen Teilbereich („Inventur Bar Juni"); konzernweit tragen **27.395 von 67.219 Positionen (42,6 %)** ein Soll ohne jede Zählung |
| **Der Sollbestand selbst ist aufgebläht** | 971.750 g Pizzateig gegen 138.000 g gezählt |

Die ersten beiden sind in **0062** behoben. Der dritte **bleibt** — er ist ein
FoodNotify-Datenproblem: wird der Verbrauch nicht gegen den Bestand gebucht, wächst das Soll
mit jeder Lieferung. Statt ihn zu verstecken, macht ihn die neue Spalte `soll_je_gezaehlt`
sichtbar. Wirkung auf der Produktionsdatenbank:

| Betrieb | alt | neu | Soll/Gezählt |
|---|---|---|---|
| Wilma Wunder Recklinghausen | 87,9 % | **−3,8 %** | **0,96** |
| Wilma Wunder Karlsruhe | 99,7 % | 55,8 % | 2,26 |
| Aposto Gera | 97,2 % | 62,8 % | 2,69 |
| Wilma Wunder Köln | 60,0 % | 28,8 % | 1,41 |

**Recklinghausen zeigt, dass die Korrektur greift:** ein Betrieb, der sauber zählt
(Soll/Gezählt 0,96), hat gar keinen Schwund — die 87,9 % waren vollständig Tests und
ungezählte Positionen. Bei allen anderen sagt `soll_je_gezaehlt`, dass die Zahl daneben weiterhin nicht
belastbar ist.

**Regel für die Karte:** zuerst auf `Soll je Gezählt` sehen. Weit über 1 heisst, der
Prozentwert daneben ist wertlos.

---

## Die Einkaufsseiten waren nicht langsam, sie waren blockiert (gemessen 12.08.2026)

Gemeldet vom Fachbereich: „die meisten Karten laden hier viel zu lange"
(Dashboard 26, Fremdeinkauf). Nachgesehen auf der Produktionsdatenbank, während
die Seite offen war:

```sql
SELECT count(*) FILTER (WHERE state='active') AS aktiv,
       max(now()-query_start) FILTER (WHERE state='active') AS aelteste
  FROM pg_stat_activity WHERE pid <> pg_backend_pid();
-- 17 aktiv, älteste 1h57min
```

Siebzehn gleichzeitige Abfragen, die Karten **einer** Seite, die ältesten neun
Minuten alt und noch nicht fertig.

**Die Ursache ist Bauart, nicht Last.** `mart.fremdeinkauf` war eine Sicht. Jede
ihrer zwölf Karten las damit 394.575 Buchungsbelege und 66.926 Bestellungen von
vorn, normierte dabei jeden Kreditorennamen über zwei `regexp_replace` in
`core.kreditor_name_norm` und aggregierte das Ergebnis. Zwölf Karten sind zwölf
vollständige Durchläufe derselben Rechnung, gleichzeitig gestartet, um dieselben
Kerne konkurrierend. `mart.einkaufspreis_monat` und `mart.einkaufspreis_betrieb`
machen dasselbe mit 876.611 Bestellpositionen, je zwei `percentile_cont` und
einem `mode()` obendrauf.

**Gemessen lokal (634.175 Positionen, leere Maschine, vorher/nachher):**

| Sicht | vorher | nachher | Faktor |
|---|---|---|---|
| `mart.einkaufspreis_betrieb` | 1.697 ms | 8,9 ms | 190 |
| `mart.einkaufspreis_monat` | 1.218 ms | 10,7 ms | 114 |
| `mart.fremdeinkauf` (**ohne** Belegarchiv) | 133 ms | 3,9 ms | 34 |
| `mart.lieferant_freigabe_stand` | 387 ms | 30,8 ms | 12 |
| `mart.einkaufspreis_veraenderung` | 1.438 ms | 74 ms | 19 |

Die lokale Datenbank führt **keine** Buchungsbelege — auf der
Produktionsdatenbank liegt der Faktor bei `fremdeinkauf` deutlich höher, weil
dort die 394.575 Belege den Aufwand tragen. **Dort gemessen, auf leerem Server:
60,4 Sekunden für die Summenabfrage EINER Kachel.** Zwölf davon gleichzeitig sind
die gemeldeten Minuten; nach dem Umbau zahlt diese Minute der Refresh, einmal je
Sync-Lauf, statt jede Karte bei jedem Aufruf. Refresh-Kosten lokal: 6,9 s für alle
drei materialisierten Sichten zusammen, einmal je Sync-Lauf.

**Die Trennlinie läuft an der Pflegearbeit entlang, nicht am Rechenaufwand.**
`manual.lieferant_art` und `manual.lieferant_freigabe` sind die Arbeitsliste des
Einkaufs: wer dort einträgt, muss das Ergebnis sofort sehen. In der
Materialisierung liegt deshalb nur, was aus LINA und FoodNotify kommt; jede
Einordnung wird bei jedem Kartenaufruf frisch dazugejoint — die Pflegetabellen
haben 5 bis 85 Zeilen, das kostet nichts.

**Gegenprobe vor dem Commit:** alle fünf Sichten liefern nach Migration 0063
zeichengleiche Ergebnisse wie davor (CSV-Vergleich über 452.940 Zeilen, `diff`
ohne Ausgabe). Der Belegarchiv-Zweig von `mart.fremdeinkauf` ist lokal nicht
prüfbar und wurde deshalb **read-only auf der Produktionsdatenbank** gegengeprüft: die neue
Bauart als eine Abfrage geschrieben, gegen die laufende Sicht gehalten, beide im
selben Lauf. Vier Zeilen, vier gleiche Zahlen — 19.979.323 / 7.930.024 /
14.502.623 / 300.750 €.

**Nebenbefund:** die älteste der siebzehn Abfragen lief seit 1h57min und war eine
verwaiste `psql`-Sitzung aus der Diagnose vom selben Vormittag — der Client war
weg, der Server rechnete weiter. Ein `pkill` auf den Client beendet die Abfrage
nicht; sie stirbt erst, wenn Postgres beim Senden merkt, dass niemand mehr
zuhört. **Regel:** eine lange Abfrage nicht wegkillen, sondern mit
`pg_cancel_backend(pid)` abbrechen.

### Nachgemessen an der fertigen Seite (12.08.2026, nach 0063)

Alle Karten eines Dashboards gleichzeitig gestartet, wie es der Browser tut:

| Dashboard | Karten | vorher | nachher |
|---|---|---|---|
| 26 Fremdeinkauf | 12 | über 9 min, nicht fertig | **2,7 s** |
| 16 Einkauf | 10 | — | **5,8 s** |
| 27 Sperren (neu) | 2 | — | 0,5 s |

Auf 16 trugen zwei Karten diese 5,8 s praktisch allein: „Einkaufsvolumen je
Betrieb" (5.789 ms, `mart.einkauf_betrieb_monat`) und „Auffällige
Einkaufspositionen" (4.973 ms, `mart.einkauf_pruefung`) — beide lesen wieder
876.611 Positionen von vorn, die zweite bildet dabei je Ware einen Median über
21.338 Warennamen. Alle übrigen acht Karten liegen zwischen 128 und 2.234 ms.
**Migration 0064** zieht die beiden nach; lokal 965 ms → 2,4 ms und
(Produktionsdatenbank) 3,0 s → wenige ms, Refresh-Kosten 0,9 s.

---

## Die 7,93 Mio € „Fremdeinkauf" messen zum größten Teil eine leere Liste (12.08.2026)

Gemeldet vom Fachbereich: „hört sich viel zu viel an." Nachgemessen — die Zahl
ist richtig gerechnet, aber sie beantwortet eine andere Frage, als ihre
Überschrift stellte.

**Kein einziger Euro ist ein entschiedener Fall.** Alle 26 Lieferanten hinter der
Summe tragen den Grund `steht nicht auf der liste`. `ausdruecklich gesperrt`:
null.

**Die drei Listen, aus denen die Einordnung kommt, sind fast leer:**

| Liste | Einträge | Bezugsgröße |
|---|---|---|
| `manual.lieferant_freigabe` | **5** (CF Gastro, Chefs Culinar, Distra, J.J. Darboven, Layer-Chemie) | 32 Lieferanten mit Wareneinkauf |
| `manual.gfgh_betrieb` | **13** | 57 operative Betriebe |
| `manual.gfgh_haendler` | **2** | — |

**6,92 der 7,93 Mio € entfallen auf 48 Betriebe, für die kein GFGH hinterlegt
ist.** Für diese Betriebe zählt jede Getränkelieferung als Fremdeinkauf, weil
niemand eingetragen hat, wer ihr Getränkefachgroßhändler ist.

**Und die Namen sagen dasselbe.** Nach Volumen:

| Lieferant | netto | Betriebe | was es ist |
|---|---|---|---|
| gastro mis gmbh | 1.887.870 | **53 von 57** | konzernweiter Lieferant, offensichtlich vertraglich |
| Riegele, Dinkelacker, EGU, Würzburger Hofbräu, Brauhaus Pforzheim, Höpfner, Radeberger | zusammen ~3,3 Mio | 1–14 | regionale Brauereien |
| GLH, Trinkkontor, W-GEM, Weidlich, Bierhalter, WIGEM | zusammen ~1,1 Mio | 1–11 | Getränkefachgroßhändler |
| Metzger Schneider, Landmetzgerei Ichtl | 524.250 | 2 | Fleisch, regional |
| FFD, Fruchthof Nagel, Manss | 660.558 | 1–17 | Obst und Gemüse |

Das ist der Lieferantenstamm eines Gastronomiebetriebs, nicht ein Befund.

**Was daraus folgt.** Die Kachel heißt jetzt „Einkauf ohne Freigabe", die Seite
„Einkauf außerhalb der Freigabeliste", und der Befund steht in einer eigenen
Kachel: `grund IN ('ausdruecklich gesperrt', 'fremder getraenkehaendler')` — nur
dort hat jemand entschieden. Eine neue Karte „Woran die Zahl oben hängt" zeigt den
Stand der drei Listen. **Die Zahl selbst bleibt unverändert**: eine Freigabe
erfindet man nicht, indem man die Auswertung anders rechnet. Sie wird kleiner,
wenn der Einkauf die Listen pflegt — und genau das soll sie.

**Sachkonto hilft dabei nicht.** Naheliegend wäre, statt der Lieferantennamen die
Buchungskonten zu nehmen. Gemessen: von 71.780 Eingangsrechnungen der letzten
zwölf Monate tragen **1.816** ein Sachkonto (2,5 %), verteilt auf 32
verschiedene. `kreditor_konto` steht bei 37.818. Als Grundlage für eine
Abgrenzung reicht beides nicht.

---

## Der Zulauf, den niemand vermisst hat (gemessen 13.08.2026)

Alle Zahlen über die Metabase-API gegen Produktion, lesend.

### Das Belegarchiv wächst um rund 331 Belege am Tag — und um 0 an zweien

```sql
SELECT hochgeladen_am::date AS tag, count(*) AS belege
  FROM core.buchungsbeleg
 WHERE hochgeladen_am >= current_date - 14
 GROUP BY 1 ORDER BY 1;
```

| Tag | Belege |
|---|---|
| 07.08. | 533 |
| 08.08. | 89 |
| 09.08. | 187 |
| 10.08. | 659 |
| 11.08. | 488 |
| **12.08.** | **keine Zeile** |
| **13.08.** | **keine Zeile** |

Mittel der 28 Tage davor: **331** am Tag, Minimum 43, Maximum 702. Die Streuung ist groß —
ein einzelner schwacher Tag ist deshalb kein Befund, zwei leere sind einer.

**Wo der Zulauf herkommt.** Zwei Belegarten tragen 93 %:

| `typ_id` | Ordner | Belege/Tag |
|---|---|---|
| 1 | Eingangsrechnungen und Avise | 222,2 |
| 5 | Kassenbelege | 86,8 |
| 2 | Ausgangsrechnungen | 10,4 |
| 3977 | Kontoauszüge | 6,0 |
| 3 | Inventur und Bruchlisten | 3,3 |
| 3975 | Susa | 1,6 |
| 3974 | BWA | 0,3 |
| 3970 | Lieferscheine | 0,0 |

Das ist **kein** Argument dafür, nur die beiden zu zählen. Nur 296 der 1.834 Paare aus
Betrieb und Ordner hatten in 28 Tagen überhaupt Zulauf — welche 296 das morgen sind, weiß
niemand vorher, und genau diese Sorte Abkürzung hat den Stillstand verursacht.

**Wie groß ein Tagesdelta ist:** im Mittel 8,1 Belege je Ordner und Tag, 95. Perzentil 36,
Maximum 161. Klein genug, dass ein voller Ordnerabzug bei Abweichung vertretbar ist.

### `lina_id` ist innerhalb eines Ordners fast, aber nicht ganz monoton

```sql
SELECT corr(lina_id::numeric, extract(epoch FROM hochgeladen_am)), count(*)
  FROM core.buchungsbeleg
 WHERE hochgeladen_am IS NOT NULL AND lina_id ~ '^[0-9]+$'
 GROUP BY betrieb_key, typ_id HAVING count(*) >= 50;
```

410 Ordner mit mindestens 50 Belegen: Korrelation im Mittel **0,991**, aber nur 53 davon über
0,999, **acht unter 0,9**, kleinster Wert **0,779**. Über alle Betriebe eines `typ_id`
zusammen fällt sie auf 0,15 bis 0,92 — dort mischen sich verschiedene ID-Bereiche.

**Warum das zählt:** „fast monoton" trägt keine Delta-Abfrage. Wer `start=<bekannter Stand>`
setzt, verlässt sich auf ein stabiles Zeilenraster, und acht Ordner sagen, dass es das nicht
ist. Diese Messung ist der Grund für die Zählung statt des Delta-Fensters.

### Die Invariante, auf der der neue Abgleich steht

```sql
WITH letzte AS (SELECT DISTINCT ON (betrieb_key, typ_id) betrieb_key, typ_id, records_total
                  FROM core.belegarchiv_bestand ORDER BY betrieb_key, typ_id, gemessen_am DESC),
     gehalten AS (SELECT betrieb_key, typ_id, count(*) AS n FROM core.buchungsbeleg GROUP BY 1,2)
SELECT count(*) FILTER (WHERE coalesce(g.n,0) = l.records_total) AS stimmt,
       count(*) FILTER (WHERE coalesce(g.n,0) <> l.records_total) AS weicht_ab
  FROM letzte l LEFT JOIN gehalten g USING (betrieb_key, typ_id);
```

**621 von 621 stimmen überein, null Abweichungen.** Das macht `count(*) <> records_total` zu
einer brauchbaren Bedingung und nicht zu einer Wette.

### Neun Inventuren enden bei exakt 800

358 Inventuren, Maximum der geladenen Positionen **exakt 800**, Maximum laut Kopf **1.426**.
Neun Inventuren fehlen zusammen **936 Positionen**, die größte allein 626. Alle neun stammen
aus Großküchen — es sind die Inventuren mit dem höchsten Warenwert.

Aus derselben Quelle, und **nicht** dasselbe: **28,7 %** aller 81.190 Inventurpositionen
(23.315) tragen keine gezählte Menge. Das ist eine Eigenschaft der Zählung, keine Lücke im
Abruf, und die Paginierung ändert daran nichts.

### 322 Bestellungen ohne eine einzige Position — aber nur 275 sind ein Fehler

686.535,93 € Bestellsumme ohne Positionen. Aufgeschlüsselt:

| Zustand des Positions-Postens | Bestellungen |
|---|---|
| `aufgegeben` (HTTP 500, 4 Versuche) | **275** |
| `ok` — die Bestellung ist wirklich leer | 47 |

Die 275 verteilen sich auf Enchilada (271), Aposto (2) und Wilma Wunder (2) und fallen
ausnahmslos in den 02. bis 04.08.2026, also in den großen Backfill. 1.100 Versuche insgesamt,
keine einzige Rohantwort gespeichert. **Die 47 sind kein Befund** — wer sie mitzählt,
repariert etwas, das in Ordnung ist.

### Korrektur 13.08.2026: 1.974 statt 1.834 Paare aus Betrieb und Ordner

Nach dem Deployment von `0069` gemessen: `mart.belegarchiv_zulauf` führt **1.974** Zeilen,
nicht die 1.834, mit denen Migration `0053` und der Plan rechnen.

```sql
SELECT count(*) FILTER (WHERE lina_betrieb_id IS NOT NULL) FROM core.betrieb;  -- 141
SELECT count(DISTINCT lina_betrieb_id) FROM manual.belegarchiv_soll;           -- 131
```

141 × 14 = 1.974. Die Differenz sind zehn Betriebe, die die Vollzählung vom 11.08.2026 nicht
erfasst hat: drei geschlossene, sechs ohne Geschäft, ein Testbetrieb — alle mit **null**
Belegen. Sie sind kein Fehler der neuen Sicht, sondern genau der Grund für sie: unter dem
alten Torwächter (`manual.belegarchiv_soll`) waren sie unerreichbar, und ein neu eröffneter
Betrieb wäre denselben Weg gegangen.

**Erreichbar sind sie:** `la:bwa_longterm` und `la:stammdaten` liefen für alle 141 mit `ok`,
also auch für diese zehn. Ob ihr Belegarchiv-Baumknoten Ordner führt, sagt erst der erste
Lauf mit `la:belegzahl` (offener Punkt 6 in `docs/offene-punkte.md`).

Die Aufrufrechnung ändert sich entsprechend: **1.974 Zählungen + 282 Token-Aufrufe + 82
Tagesberichte ≈ 2.338 von 10.500** statt der 2.238, die in der Commit-Nachricht zu `0069`
stehen. Am Ergebnis ändert das nichts — 22 % statt 21 %.
