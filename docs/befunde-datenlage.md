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
Beteiligungsgesellschaften (`Aposto Beteiligungs GmbH`), geschlossene Häuser
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
| Wie viel machen die stärksten 20 % **der 62 aktiven Betriebe** (also 12 Häuser)? | **42,6 %** |
| Wie viel machen die stärksten 28 Betriebe, also 20 % **der 141 geführten**? | **70,4 %** |
| Wie viel machen die **Top 10**? | **37,4 %** |

Die erste ist die ehrliche Antwort auf „wie konzentriert ist das Geschäft" — die zweite
zählt Karteileichen in den Nenner und übertreibt dadurch die Konzentration.

**Was daraus folgte:** Die Karte *Umsatzkonzentration* und die *Konzentrationskurve* auf
Dashboard ⑥ filtern auf `sum(umsatz_netto) > 0`. Der Dashboard-Text nennt die Bezugsgröße
ausdrücklich, weil sonst die verlockendere Zahl zitiert wird.

Auch mit dem ehrlichen Nenner gilt: **zehn Häuser tragen über ein Drittel.** Ein
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

Vor jeder Zahl, die das Haus verlässt:

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
38,3 · 35,6 · 34,2 · 43,4 · 36,4 · 39,1 · 35,1 %. Grün waren genau zwei Häuser (24,8 % und
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
