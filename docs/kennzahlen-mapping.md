# Mapping-Tabelle: Excel-Kennzahl → LINA-Quelle

**Zieldefinition** aus `examples/`. Die Excel-Dateien sind die verbindliche Anforderung; LINA ist die Quelle, aus der jede Kennzahl kommen muss.

Legende Status: ✅ direkt verfügbar · 🟡 ableitbar (Berechnung nötig) · 🔴 nicht in LINA gefunden

---

## Teil A — `JULI_Round_Table_Ampelsystem.xlsx`, Blatt `Eingabe`

Granularität: **1 Zeile je Betrieb, 1 Monat**, 22 Betriebe (Konzept Enchilada).

| # | Excel-Spalte | Formel im Excel | LINA-Endpunkt | Feld(er) | Transformation | Status |
|---|---|---|---|---|---|---|
| A | Betrieb | — | `getUmsatzbericht` | `stores[].name` | Mapping auf `dim_store` | ✅ |
| B | Stadt/Region | — | `analyticsFilterOptions` / `getStoreData` | `betriebe[].name`, `stadt` | aus Stammdaten | ✅ |
| C | Umsatz Ist | Eingabe | `getUmsatzbericht` | `umsatzNetto` | `von`/`bis` = Monat, `brutto=0` | ✅ |
| D | Umsatz VJ | Eingabe | `getUmsatzbericht` | `umsatzNettoV` | `vergleichTyp=vorjahr` | ✅ |
| E | Umsatz % | `=(C-D)/D` | `getUmsatzbericht` | `diff` | LINA liefert **Prozent** (`10.6`), Excel **Dezimalbruch** (`0.106`) → `/100` | ✅ |
| F | Ampel Umsatz | `IF(E>=10%,Grün,IF(E>=0%,Orange,Rot))` | — | — | Regel aus `Regeln!B2/C2`, in SQL/TS abbilden | 🟡 |
| G | Umsatz YTD | Eingabe | `getUmsatzbericht` | `umsatzNetto` | zweiter Call: `von=01.01.JJJJ`, `bis=Monatsende` | ✅ |
| H | Umsatz YTD Vorjahr | Eingabe | `getUmsatzbericht` | `umsatzNettoV` | selber Call, `vergleichTyp=vorjahr` | ✅ |
| I | Umsatz kum. % | `=IF(H=0,"",(G-H)/H)` | `getUmsatzbericht` | `diff` (YTD-Call) | `/100` | ✅ |
| J | Personalkosten o. GF % | Eingabe | `getPersonalkosten` | **`persoogBwa`** | direkt in % | ✅ |
| J*| *Alternative* | | `getKennzahlen` | `Personalkosten ohne GF` / `Umsatz` | absolut EUR → `/ Umsatz × 100` | 🟡 |
| K | Ampel Personal | `IF(J<=Regeln!B3,Grün,IF(J<=Regeln!C3,Orange,Rot))` (28 % / 32 %) | `getPersonalkosten` | `pekThreshold` | **Konflikt:** LINA liefert betriebsindividuelle Schwellen (z. B. 29/35, 30/34). Entscheidung nötig. | 🟡 |
| L | WE Bar % | Eingabe | `getKennzahlen` + `getUmsatzbericht` | `WE Bar` (EUR) ÷ `umsatzNetto(hauptsparten=10002)` | zwei Calls; Nenner = **Getränke-Umsatz**, nicht Gesamtumsatz | 🟡 |
| M | Ampel WE Bar | `<=23 % Grün, <=26 % Orange, sonst Rot` (`Regeln!B4/C4`) | — | — | fixe Vorgabe lt. `Regeln` | 🟡 |
| N | WE Küche % | Eingabe | `getKennzahlen` + `getUmsatzbericht` | `WE Küche` (EUR) ÷ `umsatzNetto(hauptsparten=10001)` | Nenner = **Speisen-Umsatz** | 🟡 |
| O | Ampel WE Küche | `<=25 % Grün, <=30 % Orange, sonst Rot` (`Regeln!B5/C5`) | — | — | fixe Vorgabe | 🟡 |
| P | Wareneinsatz gesamt | Eingabe | `getKennzahlen` | `WE Bar + WE Küche` | ÷ `umsatzNetto` gesamt | 🟡 |
| Q | Online Bewertung | Eingabe | **nicht in LINA** | — | Quelle laut `BUCHHALTUNG!Datenquellen`: **YEXT**. Aktuell manuell. | 🔴 |
| R | Ampel Bewertung | `>=4,4 Grün, >=4,0 Orange` (`Regeln!B6/C6`) | — | — | — | 🟡 |
| S | OM Score | Eingabe (1–5) | **nicht in LINA** | — | Subjektive Vor-Ort-Einschätzung des Operations Managers → manuelle Eingabe | 🔴 |
| T | Ampel OM | `>=4 Grün, >=3 Orange` (`Regeln!B7/C7`) | — | — | — | 🟡 |
| U–X | Ursache Umsatz/Personal/WE Bar/WE Küche | Dropdown aus `Regeln!G2:G22` (21 Ursachen) | **nicht in LINA** | — | manuelle Klassifikation | 🔴 |
| Z | Gesamtstatus | `IF(COUNTIF(F:T,"Rot")>0,Rot, IF(COUNTIF(F:T,"Orange")>0,Orange, Grün))` | — | — | reine Aggregationslogik | 🟡 |
| AA | Intensität | `>=2 Rot → "Sofort eskalieren"; =1 Rot → "Sofort handeln"; >=2 Orange → "Nachforschung"; sonst "Beobachten/OK"` | — | — | reine Logik | 🟡 |
| AB | Rot-/Orange-Ursachen | `TEXTJOIN` über U–X | — | — | Textaggregation | 🟡 |
| AC | Maßnahme? | `IF(OR(Z="Rot",AA="Nachforschung"),"Ja","Nein")` | — | — | Logik | 🟡 |
| AE | Priorität | `IF(Z="Rot","Hoch",IF(AA="Nachforschung","Mittel","Niedrig"))` | — | — | Logik | 🟡 |

### Abgeleitete Blätter (reine Excel-Logik, kein LINA-Bezug)

| Blatt | Inhalt | Umsetzung in Metabase |
|---|---|---|
| `00_Dashboard` | Zähler (Rote/Orange/Grüne Betriebe, offene Maßnahmen, Ø Online-Bewertung), Rot-Treiber je Bereich, Betriebstabelle | Übersichts-Dashboard mit Drill-Down |
| `Trend_2Monate` | 3-Monats-Trend je Betrieb/Bereich mit Sparklines, `↗ besser/gleich` vs. `↘ schlechter` | Zeitreihe direkt aus dem Mart — im Excel mussten Vormonate manuell nachgetragen werden, hier entfällt das |
| `Ursachenanalyse` | `COUNTIFS` je Ursache × Bereich, Priorität `>=3 Hoch, =2 Mittel, sonst Niedrig` | Aggregation über manuelle Ursachen-Tabelle |
| `Massnahmen` | Maßnahmen-Tracking (Erstellt am, Monat, Betrieb, Bereich, Ursache, Maßnahme, Verantwortlich, Fällig, Status, Priorität, Fortschritt, Notizen) | **Eigene Tabelle im Postgres** — Metabase kann das nicht schreiben, braucht ein kleines Eingabe-UI oder bleibt in Excel/Notion |
| `Ampelhistorie` | Monatliche Historie, im Excel durch „Werte kopieren und als Werte einfügen" gepflegt | Fällt weg — im Postgres ist die Historie automatisch da (append-only) |

### Bekannte Fehler in der aktuellen Excel-Datei
Die vorliegende `JULI_Round_Table_Ampelsystem.xlsx` enthält kaputte Referenzen, die die Pipeline mit heilt:
`00_Dashboard!B3 = Eingabe!#REF!` · `Ampelhistorie!A6/E6 = Eingabe!#REF!` · `Eingabe!AB6` referenziert `#REF!` statt der Personal-Ampel · `Eingabe!K6` prüft `J7` statt `J6` (Zeilenversatz!) · `Eingabe!Z20` mit `#REF!` · `#NAME?` durch `_xludf.TEXTJOIN` (LibreOffice-Inkompatibilität).
→ **Der Zeilenversatz in `K6` bedeutet, dass die Personal-Ampel im JULI-Report um eine Zeile verschoben ist.** Bitte prüfen, ob die Juli-Auswertung bereits auf dieser Basis kommuniziert wurde.

---

## Teil B — `Umsetzung Berichte (1).xlsx` (Roadmap-Abgleich)

`Status Bericht` / `Status Live` = 0 / 0,5 / 1.

### Ebene „Laden" — Prio 1

| Bericht | Live | LINA-Quelle | Status |
|---|---|---|---|
| Umsatz pro Verkaufsstelle | 1 | `getUmsatzbericht` + `verkaufsstellen` | ✅ |
| Personalkosten/Effektivität | 1 | `getPersonalkosten` (`pekGesamt`, `effGesamt`) | ✅ |
| Personalkosten/Effektivität pro Bereich | 1 | `getPersonalkosten` (`…Service/Bar/Kueche`) | ✅ |
| Wareneinsatz | 0,2 | `getKennzahlen` (`WE Bar`, `WE Küche`) | 🟡 nur monatlich, BWA-Lag |
| Rendite | 0,2 | `getKennzahlen` (`EBIT`) | 🟡 |
| Abverkaufszahlen pro Artikel | 1 | `getArtikelverkaufsbericht` (`counts`) | ✅ |
| Durchschnittsbon, Umsatz pro Kopf | 1 | `getUmsatzbericht` (`avgTicket`, `avgGuest`) | ✅ |
| Lohnniveau, Krankenstand | 0,5 | Team > Zeitkonten | 🔴 nicht erschlossen |
| Theoretische WE vs. BWA | 0 | `getArtikelverkaufsbericht.columns[].fixed_we` × `counts` vs. `getKennzahlen` | 🟡 **rechnerisch möglich** |
| Umsatzentwicklung | 1 | `getUmsatzbericht` über Zeitachse | ✅ |
| Umsatzentwicklung nach Sparte/Artikel/Tageszeit | 0 | `hauptsparten`/`feinsparten` + `getZeitzonenbericht` | 🟡 **möglich** |
| Effektivitäten | 1 | `getPersonalkosten` (`eff*`) | ✅ |
| MA-Kosten pro Stunde | 1 | Team > Zeitkonten | 🔴 |
| WE und DB pro Artikel | 1 | `fixed_we` + `prices` + `netto` | 🟡 **möglich** |

### Ebene „Laden" — Prio 2/3 (Auswahl)

| Bericht | LINA-Quelle | Status |
|---|---|---|
| Auswertung Gäste | `getUmsatzbericht.guests` | 🟡 nur Anzahl, keine Struktur |
| Einkaufsartikel Verbrauch | Buy-Bereich | 🔴 |
| Stornobericht | im Report Center **nicht** vorhanden | 🔴 offene Frage |
| Gutscheinverkauf und Einlösung | `hauptsparten` 10003/95 + Voucher-Bereich | 🟡 |
| Wareneinsatz nach Sparte / Verkaufsstelle / Zeitzone | Filter-Kombinationen vorhanden, aber WE nur monatlich aus BWA | 🟡 eingeschränkt |
| Verkaufspreise – Optimierungsvorschlag | `getArtikelverkaufsbericht.prices` | 🟡 Datenbasis da |
| Verweildauer am Tisch | — | 🔴 (OpenTable) |
| E-Learning erfolgreiche Kurse | **Bounti** | 🟢 **angebunden 24.08.2026** — `mart.bounti_schulung_betrieb_monat`. Einschränkung: die API kennt **kein Pflichtkennzeichen** am Kurs, Ersatz ist die Frist der Zuweisung. Siehe `bounti-api-inventar.md` |
| Fluktuationsraten | **LINA, Team > Mitarbeiter > Stammdaten** (`/personal/mitarbeiter/manageusers`) | 🔴 **`access:false`** für den genutzten Zugang — Rechtefrage, kein Datenmangel. Eintritt und Austritt stehen dort; die Berichtsliste führt den Bericht mit *Status Bericht = 1*, in LINA gibt es ihn also bereits. **Nicht** aus Bounti — Bounti liest die Personaldaten selbst aus LINA (eigener API-Schlüssel, Scope *Personalstammdaten und Kosten*). Eine Näherung aus Bounti-Konten stand kurz im Entwurf und ist wieder entfernt. Nächster Schritt: `bun run lina-fragen d10` |

> **Korrektur 24.08.2026.** Bis heute standen diese beiden Berichte in **einer** Zeile
> („Fluktuationsraten, E-Learning | Team / Bounti"). Die Quellen gehörten dabei paarweise zu
> den Kennzahlen — Fluktuation zu *Team*, E-Learning zu *Bounti* —, und beim Anbinden von
> Bounti ist beides zunächst falsch zusammengezogen worden. Die Zeile ist deshalb geteilt:
> zwei Kennzahlen, zwei Quellen, zwei Zustände. In `examples/Umsetzung Berichte (1).xlsx`
> stehen sie ohnehin als getrennte Berichte.

### Ebene „Franchise" (Konzept)

| Bericht | LINA-Quelle | Status |
|---|---|---|
| Umsatzentwicklung | `getUmsatzbericht` + `konzepte` | ✅ |
| Zeitzonenbericht | `getZeitzonenbericht` | ✅ |
| Zeitzonenbericht vordefinierte Zeitzonen | `getVordefinierteZeitzonenBericht` | ✅ |
| Umsatz nach Karte (Sparte/Feinsparte) | `hauptsparten` / `feinsparten` | ✅ |
| Verkaufszahlen (pro Produkt und Laden) | `getArtikelverkaufsbericht` | ✅ |
| Effektivitäten | `getPersonalkosten` | ✅ |
| Umsatz Marketingaktion | `getAktionsbericht` | ✅ |

### Ebene „Holding"

Darlehen, Verbindlichkeiten, Budgetierung, Jahresplanung, Eigenkapitalkonsolidierung — **alle 🔴**. Im Report Center nicht vorhanden; laut `Projektbeschreibung` muss diese Auswertungsebene in LINA erst geschaffen werden. Für unsere Pipeline: entweder aus dem Finance/BWA-Bereich ziehen oder als externe Quelle modellieren.

---

## Teil C — Zusammenfassung der Lücken

| Lücke | Betroffene Kennzahlen | Vorschlag |
|---|---|---|
| **BWA-Rechte fehlen** | WE Bar, WE Küche, Personalkosten o. GF, EBIT, Rendite | Service-Account mit vollen Finance-Rechten anfordern (**blockierend für Phase 3**) |
| **BWA-Lag 1–2 Monate** | alle Kennzahlen aus `getKennzahlen` | `data_asof` je Kennzahl im Mart; Dashboards zeigen Stand explizit an |
| **WE-% braucht Sparten-Nenner** | WE Bar %, WE Küche % | zwei zusätzliche `getUmsatzbericht`-Calls je Periode (`hauptsparten=10001/10002`) |
| **Online-Bewertung** | Ampel Bewertung | YEXT anbinden (Phase 3+) oder manuelle Tabelle |
| **OM-Score, Ursachen, Maßnahmen** | Ursachenanalyse, Maßnahmen-Tracking | manuelle Eingabetabellen im Postgres + kleines Eingabe-UI |
| **Zeiterfassung/Schichten** | Lohnniveau, Krankenstand, MA-Kosten/Std, nichtproduktive Kosten | Bereich Team erschließen (Phase 1b) |
| **Storno-/Trainingsbuchungen** | Stornobericht | in LINA vorhanden (`Status Bericht=1`), nicht im Report Center → Phase 1b |
| **Einkauf/WAWI** | Einkaufsartikel Verbrauch, Lieferanten | Bereich Buy erschließen (Phase 1b) |
| **Holding-Ebene** | Darlehen, Budget, EK-Konsolidierung | existiert in LINA noch nicht |
