# Plan: der Vollabzug aus LINA — alles, was wir noch holen können

**Stand:** 22.09.2026 · **Status:** ~~Plan, nichts davon gebaut.~~ **Importer gebaut (M0, M1-Mechanik, M3, M4-Einreihweg, Stufe B ohne Karten), offline abgenommen, noch nie gegen LINA gelaufen** — Migrationen `0112`–`0115`, `importer.md` Abschnitt „Betriebsberichte".
**Vorgänger:** [`plan-lina-kassendaten.md`](plan-lina-kassendaten.md) — dieser Plan erweitert ihn
von der Glücksrad-Frage auf den ganzen Berichtskatalog. Wo beide etwas sagen, gilt der
Kassendaten-Plan für die Berichte 92/88/96 und dieser für alles Übrige; die Entscheidungen aus
dessen Abschnitt 4 bleiben unberührt.

> **Welcher Erhebungsstand diesem Plan zugrunde liegt.** Eine zweite Sitzung vermisst parallel
> die übrigen rund 40 Betriebsberichte (Spalten, Zeilen, Bytes, Tiefe) und hängt das Ergebnis als
> Abschnitt *„Vermessung aller Betriebsberichte"* an
> [`lina-api-inventar-1d.md`](lina-api-inventar-1d.md). **Beim Schreiben dieses Plans (22.09.2026,
> 15:0x) existierte dieser Abschnitt noch nicht** — nachgesehen mit `grep` in der Datei.
> Der Katalog in Abschnitt 3 nennt deshalb für jeden noch nicht einzeln gemessenen Bericht
> *„Spalten: siehe Vermessung in `lina-api-inventar-1d.md`"*, und seine Kostenangabe ist **allein
> aus der Körnung gerechnet** (ein Aufruf je Betrieb-Tag bzw. je Betrieb-Monat), nicht aus
> gemessenen Zeilen- oder Bytezahlen. Wer den Plan nach dem Eintreffen der Vermessung liest:
> die Kostenspalte bleibt richtig, die Spalte *„was es beantwortet"* ist dann zu schärfen, und
> Berichte, die sich als leer erweisen, wandern nach Stufe C.

---

## 1. Ziel und Rahmen

**Eugene, 22.09.2026:** *„Wir wollen letztendlich so viele Informationen wie möglich zu
Analysezwecken aus LINA laden. Mach einen Plan, was wir alles noch aus LINA bekommen können,
damit Fragen wie die zum Glücksrad künftig im Haus beantwortet werden — ohne einen Agenten zu
beauftragen. Mit meinem Nutzer müssen alle Betriebe erreichbar sein; ein Mandantenwechsel ist
dafür nicht nötig."*

Das ist nicht dieselbe Anforderung wie „mehr Daten". Es sind zwei:

1. **Vollständigkeit der Quelle** — was LINA hergibt, liegt bei uns, solange LINA erreichbar ist
   ([`datensicherung.md`](datensicherung.md): der Optionswert schlägt die Speicherkosten).
2. **Selbstbedienung** — die nächste Glücksrad-Frage beantwortet Daniel selbst, im Chat oder im
   BI-Tool. Ein Plan, der bei einer gefüllten Tabelle endet, hat die Hälfte der Anforderung
   erfüllt. Deshalb endet dieser bei einem Bericht in `metabase/karten-*.ts`, den
   `bericht_ausfuehren` aus ChatGPT, Claude oder Copilot ausführt
   ([`plan-skybridge.md`](plan-skybridge.md), §4).

### Das Zugangsmodell — und warum kein Mandantenwechsel nötig ist

```
GET /intranet/storeanalytics/reportList?laden=<encId>          → 72 Berichte
GET /intranet/storeanalytics/getReport
    ?report=<id>&von=1.8.2026&bis=31.8.2026&reltime=custom&interval=8&laden=<encId>
```

`laden` **ist** die `encId` aus `getUmsatzbericht.stores[].encId`, die wir für alle 141 Betriebe
haben. Ein Aufruf je Betrieb und Zeitraum, keine Sitzungsumstellung, kein Impersonation-Mechanismus
([`lina-api-korrekturen.md`](lina-api-korrekturen.md), KORREKTUR 7). Der bis zum 22.09.2026
dokumentierte Weg `/finanzen/analytics/getReport?storeId=` ist **falsch**: er antwortet mit `200`
und leeren Gerüsten, für jeden Betrieb und jeden Zeitraum. Die vier inaktiven `getReport:*`-Einträge
in `src/lina/endpunkte.ts` (38, 107, 23, 97) tragen ihn noch — das ist der erste Handgriff in
Abschnitt 5.

Die Antworthülle ist für alle 72 Berichte dieselbe (`BetriebsReportSchema` in
`src/lina/schemas.ts`), die Spalten stehen dynamisch in `tableHead[].field`. **Ein Fetcher, ein
Parser, 72 Berichte** ([`lina-api-inventar-1b.md`](lina-api-inventar-1b.md), §1.1).

### Was ausdrücklich NICHT in den Umfang gehört

| Ausgeschlossen | Grund | Beleg |
|---|---|---|
| **LINAs Warenwirtschaft und Einkauf** (`/wawi/*` außer `articleApi`, `units`) | Demodaten. Waren, Lieferanten, Bestellungen und Inventuren kommen aus FoodNotify | AGENTS.md Regel 5, [`plan-foodnotify.md`](plan-foodnotify.md) |
| **Rezepturen-HTML** (`/wawi/rezept/recipeedit`) | Scraping über 1.428 Artikel; `fixed_we` liefert das Ergebnis bereits als JSON | `lina-api-korrekturen.md`, „Neu: Rezepturen" |
| **Stornoberichte 38 / 39 / 58** | *„Storno wird nicht gebaut"* — entschieden | [`entscheidungen.md`](entscheidungen.md). **Mit einem Vorbehalt, siehe Abschnitt 7, Entscheidung E3** |
| **Gesperrte Berichte 2, 3, 7, 8, 9, 23, 24, 107, 118** | HTTP 500 mit leerem Body, auch auf Betriebsebene mit `storeId`, für drei Zeiträume gegengeprüft. Rechte- oder Lizenzfrage, nicht unsere | `endpunkte.ts`, `hinweis` an `getReport:107`; `lina-api-inventar-1b.md` §1.3. **Zu prüfen ist, ob die 500er Artefakte von KORREKTUR 7 waren — siehe E4** |
| **Kassenjournal (`getJournalData`) und Rechnungsdetail (`billitems`)** | Sitzungsgebunden an einen Betrieb, der über keinen Parameter umschaltbar ist; im Quelltext (`KassenjournalView_*.js`) existiert kein `storeId`/`laden`. Zwei Sitzungen haben es erfolglos versucht | `lina-api-inventar-1d.md`, A4 und beide Nachträge |
| **Eigener API-Schlüssel bei LINA** | *„wird nicht angefragt"*, politisch entschieden | [`offene-punkte.md`](offene-punkte.md), Round-Table-Map |
| **Wetteranalyse (Bericht 104)** | LINA liefert bestenfalls eine Tages-Wetterlage; Bright Sky auf DWD-Messdaten kann Stundenraster und Historie ab 2018 | `entscheidungen.md`, E4 vom 20.08.2026 |
| **Lohn-Zweig der Ladenakte** | Ausweisdokumente, Krankmeldungen, Pfändungen — bis Zweck und Freigabe benannt sind | `lina-api-inventar-ladenakte.md` |
| **Zugangsdaten jeder Art** (`db_pass`, IBAN, API-Schlüssel im Stammdatenblatt) | AGENTS.md Regel 2, unverändert gültig auch nach dem Wegfall der Personenbezugssperre | `entscheidungen.md`, 11.08.2026 |

**Personenbezug ist seit dem 11.08.2026 kein Ausschlussgrund mehr.** Kellnernamen, Mitarbeiter-
zuordnungen und Bearbeiternamen dürfen geholt werden, wenn sie eine Kennzahl der Round-Table-Map
tragen. Das betrifft in diesem Plan die Kellnerberichte 53–61 (`entscheidungen.md`,
*„Personenbezogene Daten: die Sperre fällt"*).

**Die Bonebene mit Artikeln ist je Betrieb nicht erreichbar.** Das ist gemessen, nicht vermutet:
keine der acht geprüften Quellen kreuzt Bon × Artikel × Nachlass-Finanzweg und ist zugleich über
`laden=` adressierbar (`lina-api-inventar-1d.md`, Nachtrag „Bonebene … nicht erreichbar"). Dieser
Plan plant **um sie herum**, nicht auf sie hin. Was daraus folgt, steht in Abschnitt 2 in der
Spalte *„was es NICHT beantwortet"* — an vier Stellen.

---

## 2. Der Fragenkatalog — wofür das alles da ist

Die Tabelle ist der Kern dieses Plans. Sie sagt für jede wiederkehrende Frage des Fachbereichs,
**welcher Bericht sie beantwortet, in welcher Körnung, was er nicht kann, und wo die Antwort am
Ende steht**. Ohne die letzten beiden Spalten ist ein Import nur ein Import.

Spalte *Quelle*: Berichtsnummer aus dem Katalog (`lina-api-inventar-1d.md`, A1).
Spalte *Stufe*: A = täglich holen, B = monatlich, C = einmalig/selten/gar nicht (Abschnitt 3).

| # | Frage des Fachbereichs | Quelle | Stufe | Körnung | was es **nicht** beantwortet | `core` | `mart` | Karte / MCP-Bericht |
|---|---|---|---|---|---|---|---|---|
| **F1** | *„Wie viel Durchstarter lief über 50 % Glücksrad, je Standort?"* — Aktionsauswertung je Artikel und Nachlass | **92** Rabattbericht | A | Betrieb × Tag × Finanzweg × Artikel**name** | **Kein Bonbezug.** Der Nachlass gilt für den ganzen Bon (327 Artikel trugen ihn im August, auch Getränke) — „Menge dieses Artikels je Finanzweg" ist damit die Nachlassmenge, nicht die Verkaufsmenge | `core.rabatt_artikel_tag` | `mart.artikel_nachlass_monat` | `db_artikelaktion` (neuer Reiter), MCP `aa_nachlass` |
| **F2** | *„Was kosten uns die Nachlässe insgesamt, je Betrieb und Monat?"* | ~~**88** Finanzwege~~ **97** Tagesabschluss (Finanzwegblock je Tag; 88 abgeschaltet 23.09.2026) | A | Betrieb × Tag × Finanzweg | Welche Artikel — dafür F1 | `core.finanzweg_tag`, `core.finanzweg` | `mart.finanzweg_tag`, `mart.nachlass_monat` | neue Karte auf ③ Betrieb |
| **F3** | *„Karte gegen bar, Trinkgeld, Lieferdienste — wie zahlen unsere Gäste?"* | ~~**88** (Summen)~~ **97** (Summen je Tag; 88 abgeschaltet 23.09.2026), **96** (je Bon), **99** (je Betriebsstelle) | A / B | 88: Betrieb × Tag × Finanzweg; 96: je Bon | 88 kennt keine Bon-Zuordnung; 96 führt in `Finanzwege` **nur Zahlarten**, keine Hausbon-/Rabattwege (nachgemessen am 15.08.2026: 32 Glücksrad-Vorgänge in 88, null in 96) | `core.finanzweg_tag`, `core.bon` | `mart.zahlart_monat` | neue Karte, MCP `zahlart_*` |
| **F4** | *„Personalverzehr und Bruch — wie viel und woran?"* | **92** (Gruppen `100% intern`, `Bruch`, `50% Perso`), **114** Kost-Sach-Bezug | A / B | 92: Tag × Artikel; 114: Monat | 114 war für Wilma Wunder Düsseldorf/August **echt leer** (0 Buchungen, kein Endpunktfehler) — die Zahl steckt bei CF offenbar in 92 | `core.rabatt_artikel_tag`, `core.personalverzehr_monat` | `mart.eigenverbrauch_monat` | Reiter auf ⑥ Wareneinsatz |
| **F5** | *„Gutscheine: verkauft, eingelöst, im Umlauf"* | **82** Transaktionen, **81** im Umlauf, **12** Gutscheinumsatz | B | 82: Betrieb × Monat × Transaktion; 81: Bestand **heute** | 81 ist ein **Bestand**, keine Historie — rückwirkend nicht holbar, deshalb Momentaufnahme ab sofort (`datensicherung.md`, Grundsatz) | `core.gutschein_transaktion`, `core.gutschein_umlauf_stand` | `mart.gutschein_monat` | neue Karte |
| **F6** | *„Wer verkauft mit, wer nicht?"* — Kellnerleistung, Zusatzverkauf (Map 4.2) | **60** Umsatz pro Kellner, **61** je Tag, **53** Artikel je Kellner, **56** Finanzwege je Kellner, **57** Gutschriften | B | Betrieb × Monat × Kellner**name** | **Keine Personen-ID gemessen**, nur Namen — eine Zuordnung zu Bounti-Konten ist damit unsicher. Und: ein Bon kann mehreren Kellnern zugeschlagen werden (Ø-Bon in 60 weicht deshalb vom Betriebs-Ø ab) | `core.kellner_umsatz_monat`, `core.kellner_artikel_monat` | `mart.kellner_monat` | neue Karte; Verzahnung mit `mart.bounti_schulung_person` erst nach E5 |
| **F7** | *„Welche Betriebsstellen, Tische, Verkaufsstellen tragen den Umsatz?"* | **68** / **69** Betriebsstellen, **70** Tische, **112** / **71** Verkaufsstelle | B | Betrieb × Monat × Stelle | Keine Uhrzeit, keine Verweildauer (die kommt aus OpenTable, nicht aus LINA) | `core.betriebsstelle_umsatz_monat`, `core.tisch_umsatz_monat`, `core.verkaufsstelle_umsatz_monat` | `mart.betriebsstelle_monat` | Reiter auf ③ |
| **F8** | *„Wann verdienen wir das Geld — und womit?"* — Zeitzonen je Sparte | **75** / **76** Zeitzonen × Fein-/Hauptsparte | B | Betrieb × Monat × Zone × Sparte | **73 / 74 sind redundant**: `core.zeitzonenbericht_stunde` hat 10.618.992 Zeilen, alle 24 Stunden besetzt, ab 31.12.2017, alle 141 Betriebe — aus einem Konzernaufruf je Tag. Nur die **Spartenkreuzung** fehlt dort (das ist Messfrage `d5`) | `core.zeitzone_sparte_monat` | `mart.umsatz_zeitfenster_sparte` | Ergänzung auf ⑪ Zeitfenster |
| **F9** | *„Wie groß ist ein Bon, wie viele Bons am Tag, wie viele Gutschriften?"* | **96** Rechnungsausgangsbuch | A | **eine Zeile je Bon** | **Keine Uhrzeit** (`Datum` ist `format: day`), keine Artikelzeilen, keine Nachlässe. Damit keine Wartezeiten und kein „Ø Bon mit vs. ohne Aktion" (Map 5.1) | `core.bon` | `mart.bon_tag`, `mart.bongroesse_verteilung` | neue Karte, MCP `bon_*` |
| **F10** | *„Debitoren: wer kauft auf Rechnung, und wie viel?"* | **86** Debitorenauswertung, **96** (Spalten `Debitor`) | B | Betrieb × Monat × Debitor | — | `core.debitor_umsatz_monat` | `mart.debitor_monat` | neue Karte |
| **F11** | *„Wie ist der Tag abgeschlossen worden?"* — Z-Bon, Kassendifferenzen | **97** Tagesabschluss | A | **Betrieb × Tag** — und das aus **einem Monatsaufruf** (`possibleIntervals` = `[{3, "pro Tag"}]`) | Spalten noch nicht abgeschrieben | `core.tagesabschluss_tag` | `mart.tagesabschluss` | Prüfsicht, keine eigene Karte |
| **F12** | *„Reservierungen und Vorlauf"* (Map 1.3) | **13** Reservierungen (`vue:Resdashboard`), `reservation-summary` | C | unbekannt | Eigener Endpunkt, im Zentralkontext einmal leer; Messaufruf `d3` ist **nie gelaufen** | — | — | erst nach `d3` |
| **F13** | *„Wie liefen unsere Kampagnen?"* | **64** Aktionsreport (Betrieb) | C | unbekannt | Der Konzernbericht `getAktionsbericht` liefert Aktionen bereits je Betrieb und Tag (`core.aktionsumsatz_tag`). **Zu messen, ob 64 etwas hinzufügt** (Aktion × Artikel wäre neu) | ggf. `core.aktion_artikel_monat` | — | ggf. `db_artikelaktion` |
| **F14** | *„Wie viele Stornos, und warum?"* | 38 / 39 / 58 | C | — | **Entschieden: wird nicht gebaut.** Der Vorbehalt steht in E3 | — | — | — |
| **F15** | *„Umsatz je Verkaufsstelle"* (Konzernebene) | `getUmsatzbericht` mit `verkaufsstellen=` | A | Betrieb × Tag × Verkaufsstelle, **ein Konzernaufruf je Tag und Stelle** | — | `core.umsatzbericht_tag.verkaufsstelle_key` | vorhanden | vorhanden — **siehe Nebenbefund unten** |

### Nebenbefund zu F15: eine Spalte, die niemand füllt

`core.umsatzbericht_tag.verkaufsstelle_key` existiert seit `0003`, wird von einem Dutzend
`mart`-Sichten mitgeführt (`WHERE … AND verkaufsstelle_key IS NULL`) und ist **nie gefüllt worden**.
Am 22.09.2026 im Quelltext nachgesehen:

* kein Eintrag in `src/lina/endpunkte.ts` sendet den Parameter `verkaufsstellen` — gefunden werden
  nur die zehn `hauptsparten`-Varianten (`grep -n "verkaufsstellen" src/lina/endpunkte.ts` → leer);
* `src/sync/laden.ts:229` schreibt beim Umsatzbericht hart `verkaufsstelle_key: null`;
* `kennzahlen-mapping.md`, Zeile 68 führt *„Umsatz pro Verkaufsstelle"* trotzdem als ✅.

Das ist **keine große Arbeit**: 7 Verkaufsstellen × 1 Konzernaufruf je Tag = 7 Aufrufe täglich,
derselbe Mechanismus wie bei den zehn Hauptsparten aus `0077`, samt Eintrag in `sync.quelle`.
Es gehört in diesen Plan, weil es dieselbe Signatur hat wie Regel 10: eine Spalte, die aussieht,
als wäre sie versorgt. Meilenstein **M0** in Abschnitt 7 — es ist die billigste Zeile im ganzen Plan.

---

## 3. Quellen nach Wert und Kosten

### Die Rechengrößen

Alle am 22.09.2026 gemessen (`core.umsatzbericht_tag`, nur Tage mit Umsatz; die ersten drei stehen
so in `plan-lina-kassendaten.md`, §2):

| Größe | Wert |
|---|---|
| Betrieb-Tage mit Umsatz seit 2018 | **152.840** |
| Betrieb-Monate mit Umsatz seit 2018 | **5.115** |
| Bons insgesamt seit 2018 | **30,3 Mio.** |
| Betriebe mit laufendem Umsatz (von 141) | **62** ([`befunde-datenlage.md`](befunde-datenlage.md)) |
| Tagesbudget LINA (`.env`, Produktion) | **10.500** Aufrufe |
| davon heute belegt: Tagesberichte | ~184 |
| davon heute belegt: Ladenakte | ~2.200 **(Stand vor `0099`; seit dem Takt-Umbau erwartet ~330 Zählproben + Abzüge — nachzumessen)** |
| davon heute belegt: Historie (`HISTORIE_JE_LAUF`) | bis 2.000 |
| **entschieden für die Betriebsberichte** | **4.000 je Nacht**, zusätzlich (`plan-lina-kassendaten.md`, §4.3) |

**Das Tempo ändert sich nicht.** `TAKT_MIN_MS`/`TAKT_MAX_MS` bleiben, wie sie sind; die 4.000 sind
**mehr Volumen, kein höheres Tempo** (AGENTS.md Regel 3). Der Takt in der Produktion ist
**nachgemessen rund 5,3 s je Aufruf** (`importer.md`, Verteilung einer Nacht: 1.990 Historienaufrufe
in 2 h 57; die lokale `.env` steht auf 4–6 s, der Code-Standard wäre 10–20 s). 4.000 Aufrufe sind
damit **rund sechs Stunden**, die ganze Nacht mit ~8.400 Aufrufen rund zwölf Stunden ab 05:02 —
das passt in den Tag, aber der Lauf endet dann am Nachmittag. *(Seit dem 23.09.2026, `0116`, ist
das für die Dashboards gleichgültig: die Historie lädt in Phase C, NACH den Auswertungen; Phase B
ist gerechnet gegen 07:20–08:00 fertig — `importer.md`, „Drei Phasen".)* Wer den Takt je auf den
Code-Standard setzt, halbiert damit die Zahl der Aufrufe, die ein Tag überhaupt schafft
(~3.800 bei 10–20 s) — dann ist die Grenze zu senken, nicht der Takt zu erhöhen.

### Die Körnungsfrage entscheidet über Faktor 30

`possibleIntervals` ist **berichtsspezifisch** (`lina-api-inventar-1d.md`, A7). Daraus folgen drei
Kostenklassen, und der Unterschied zwischen ihnen ist größer als jede andere Stellschraube:

| Klasse | Bedingung | Kosten Historie je Bericht |
|---|---|---|
| **T** — Tagesaufruf nötig | `possibleIntervals` = `[8 Kumuliert]` **und** keine Datumsspalte in `tableHead` | **152.840** |
| **M-Tag** — Monatsaufruf, Tageszeilen | `possibleIntervals` enthält `3 „pro Tag"` (z. B. 97) **oder** die Tabelle führt eine `Datum`-Spalte je Zeile (z. B. 96, 90) | **5.115**, Körnung trotzdem Tag |
| **M** — Monatsaufruf, Monatszeile | alles Übrige | **5.115** |
| **W** — Wochenaufruf, Zeile je Bon *(neu, 22.09.2026)* | Monatsaufruf läuft in `504 Gateway Timeout`, sieben Tage laufen durch (96, vermutlich 86 und 113) | **≈ 22.000** (152.840 / 7) |

~~**Bericht 96 ist der wichtigste Kandidat für M-Tag und noch nicht gemessen.**~~ **Gemessen am
22.09.2026 (M2): weder M-Tag noch T, sondern W.** Monats- und Januar-2022-Aufruf enden nach rund
einer Minute in `504 Gateway Timeout` (970.059 Byte Fehlerseite, kein JSON). Sieben Tage
(10.–16.08.2026, Wilma Wunder Düsseldorf) liefern in 2,9 s 2.658 Bons mit Datum, der 15.08. darin
mit genau den 519 Zeilen des Tagesaufrufs; drei Tage 1,3 s; vierzehn Tage 31,9 s und 6.430 Zeilen —
schon an der Kante. **Also Wochenfenster, nie länger.** Bei umsatzstärkeren Betrieben ist die
Laufzeit im Importer zu beobachten; wird sie knapp, halbieren. Der alte Text:
 Gemessen ist nur ein
**Ein-Tages**-Aufruf (15.08.2026, 519 Zeilen, 185.990 Byte), und dessen Tabelle trägt je Zeile eine
`Datum`-Spalte (`format: day`). Ob ein Monatsaufruf alle Bons des Monats mit ihrem Datum liefert
oder abschneidet, ist **zu messen** (Meilenstein M2). Der Unterschied: **5.115 statt 152.840
Aufrufe** und rund 5,8 MB je Antwort statt 186 kB. Solange es ungemessen ist, steht 96 in der
Tabelle unten mit beiden Zahlen.

### Stufe A — täglich holen, rückwärts bis 2018

| # | Bericht | Klasse | Aufrufe Historie | je Nacht laufend | warum Stufe A |
|---|---|---|---|---|---|
| **92** | Rabattbericht | T | **152.840** | 62 (+62 Nachlauf) | Die einzige Quelle für Nachlass × Artikel. Aktionen halten sich nicht an Monatsgrenzen (`plan-lina-kassendaten.md`, §4.5) |
| ~~**88**~~ | ~~Finanzwege~~ | ~~T~~ | ~~**152.840**~~ | ~~62 (+62)~~ | ~~Trägt die Gegenprobe (`balanceSumBrutto` trifft `getUmsatzbericht` auf den Cent) und die Finanzweg-Stammdaten, die es sonst nirgends gibt~~ **Abgeschaltet 23.09.2026** (Migration `0119`): 97 liefert dieselbe Finanzwegtabelle je Tag aus einem Monatsaufruf — drei Stichproben identisch, zuletzt Januar 2019 (`lina-api-inventar-1d.md`, Nachtrag 23.09.2026). Stamm und Gegenprobe trägt jetzt 97 |
| **96** | Rechnungsausgangsbuch | **W** (gemessen 22.09.2026) | **≈ 22.000** | 62/Woche ≈ 9 | Bonebene, so weit sie erreichbar ist: Bongröße, Zahlartenmix je Bon, Gutschriftenquote |
| **97** | Tagesabschluss | M-Tag (gesichert) | **5.115** | 62/Monat ≈ 2 | Tageszeilen aus einem Monatsaufruf — der billigste Tagesbericht im Katalog. ~~Gegenprobe der Zahlarten~~ **Seit 23.09.2026 die einzige Quelle der Finanzwege** (Stamm, Zahlarten, Nachlässe) |
| **F15** | `getUmsatzbericht`+`verkaufsstellen` | Konzern | 7 × Kalendertage ≈ **22.000** | **7** | Konzernebene: ein Aufruf deckt alle 141 Betriebe |

**Summe Stufe A, Historie: rund 180.000 Aufrufe** (96 als W, ohne 88). ~~332.800 mit 88 im Tagesraster~~ (bis 23.09.2026), ~~315.910 (mit 96 als M-Tag) bzw. 463.635 (mit 96 als T)~~.
Ohne F15, das über `HISTORIE_JE_LAUF` läuft und nicht über das neue Kontingent.

### Was in 4.000 Aufrufe je Nacht passt — die ehrliche Rechnung

| Zusammenstellung | Aufrufe | Nächte bei 4.000 | Dauer |
|---|---|---|---|
| ~~92 + 88, Tagesraster~~ | ~~305.680~~ | ~~77~~ | ~~rund 11 Wochen~~ |
| **92 allein, Tagesraster** (88 abgeschaltet 23.09.2026) | 152.840 | 38 | **rund 5,5 Wochen** |
| + 96 als **W** (gemessen), + 97 | ≈ 180.000 ~~332.800~~ | 45 ~~83~~ | rund 6,4 ~~11,9~~ Wochen |
| **ein dritter Bericht im Tagesraster** | +152.840 | +38 | **+5,5 Wochen** |
| Stufe B vollständig (13 Berichte × 5.115) | 66.495 | 17 | 2,4 Wochen |
| **A + B zusammen, 96 als W** | **≈ 246.500** ~~399.300~~ | **62** ~~100~~ | **rund 8,8** ~~14,3~~ **Wochen** |

Die Spalte „Nächte bei 4.000" ist seit E8 (22.09.2026) nur noch eine Obergrenze der Dauer: die
feste 4.000er-Grenze ist gefallen, Betriebsberichte bekommen, was vom Tagesbudget übrig ist.

**Die Antwort auf die Frage, ob mehr als drei Berichte im Tagesraster passen, lautet nein.** Zwei
Berichte im Tagesraster belegen das Kontingent elf Wochen lang vollständig. Jeder weitere kostet
fünfeinhalb Wochen, in denen alles andere wartet. Die Reihenfolge ist deshalb:

1. ~~**92 und 88 im Tagesraster** (entschieden, §4.5 des Vorgängerplans) — 11 Wochen.~~
   **92 im Tagesraster** — 5,5 Wochen. 88 ist seit dem 23.09.2026 abgeschaltet; seine Zahlen
   kommen aus 97 (siehe „Revidiert am 23.09.2026" unten).
2. **97 und 96 als Monatsaufrufe mit Tageszeilen** — 2,5 Wochen, laufen **parallel** mit, weil sie
   zusammen nur 10.230 Aufrufe sind: sie sind nach zwei bis drei Nächten durch und verzögern
   ~~92/88~~ 92 um weniger als einen Prozentpunkt.
3. **Stufe B danach**, in der Reihenfolge des Fragenkatalogs (F5 Gutscheine, F6 Kellner, F7 Stellen,
   F10 Debitoren, F4 Personalverzehr, F8 Zeitzonen×Sparte).
4. **Stufe C nur nach einer Messung**, nie auf Verdacht.

**Neueste zuerst, über alle Betriebe gemeinsam nach Datum** — nicht Betrieb für Betrieb. Bricht der
Zugang ab, fehlt das Unwichtigste; und nach der ersten Nacht ist der letzte Monat für **alle**
Betriebe vollständig, nicht ein Betrieb für alle Jahre. `historieNachziehen()` arbeitet schon so
(`ORDER BY tag DESC`, `nachfuellen.ts:240`); der neue Einreihweg muss es übernehmen, und ein Test
prüft es (Abschnitt 5).

### Stufe B — monatlich, 5.115 Aufrufe Historie je Bericht, ~2 je Nacht laufend

| # | Bericht | beantwortet | Anmerkung |
|---|---|---|---|
| **60** | Umsatz pro Kellner | F6 | Kopftabelle bestätigt 12.186 Rechnungen und Ø-Bon 27,09 € gegen 88 — geprüft |
| **61** | Umsatz pro Kellner pro Tag | F6 | Kandidat für M-Tag, zu messen |
| **53** | Artikelbericht pro Kellner | F6 | Zusatzverkauf: welcher Kellner verkauft welche Artikel |
| **56** | Finanzwege pro Kellner | F6, F3 | Trinkgeld je Kellner |
| **57** | Gutschriften pro Kellner | F6 | |
| **114** | Kost-Sach-Bezug | F4 | Für Düsseldorf/August **echt leer** (1.539 Byte, nur Kopfzeile). Vor dem Backfill an drei weiteren Betrieben prüfen, sonst 5.115 Aufrufe für Leerzeilen |
| **82** | Gutscheintransaktionen | F5 | |
| **81** | Gutscheine im Umlauf | F5 | **Bestand, kein Zeitraum** → Momentaufnahme monatlich, kein Backfill (`istMomentaufnahme`) |
| **86** | Debitorenauswertung | F10 | |
| **68 / 69** | Umsatz nach Betriebsstellen (± Hauptsparte) | F7 | |
| **70** | Umsatz nach Tischen | F7 | |
| **112 / 71** | Umsatz nach Verkaufsstelle (± Hauptsparte) | F7, F15 | **Prüfen, ob F15 es billiger liefert**: der Konzernweg kostet 7 Aufrufe je Tag für alle 141 Betriebe, dieser 141 je Monat |
| **99** | Unbare Zahlungen nach Betriebsstelle | F3 | **2.117.042 Byte je Betrieb-Monat** gemessen — 5.115 × 2,1 MB ≈ **10,8 GB** im Raw-Layer. Erst nach E6 |
| **90** | Monatsaufstellung Tag für Tag | F3, F11 | Kandidat für M-Tag |
| **108** | Verkaufszahlen | — | `date_select: month`. Zu messen, was er über `getArtikelverkaufsbericht` hinaus sagt |
| **75 / 76** | Zeitzonen × Fein-/Hauptsparte | F8 | Nur diese beiden, nicht 73/74 |

### Stufe C — einmalig, selten oder gar nicht

| # | Bericht | Entscheidung | Grund |
|---|---|---|---|
| **73 / 74** | Zeitzonenberichte | **nicht laden** | `core.zeitzonenbericht_stunde`: 10,6 Mio. Zeilen, alle 24 Stunden, ab 31.12.2017, alle 141 Betriebe, **ein** Konzernaufruf je Tag. 141 Aufrufe je Monat für dieselbe Aussage wären Verschwendung |
| **27, 29–34, 42–49, 105, 110** | Artikelverkauf in 16 Schnitten | **nicht laden** | `core.artikelverkauf_tag` + `core.artikel_warengruppe_stand` erlauben jeden dieser Schnitte in SQL. **Ausnahme prüfen: 34 und 110** tragen die Verkaufsstelle, die uns fehlt (F15) — falls F15 scheitert, ist 34 der Rückfall |
| **55** | Finanzwege artikelgenau | **nicht laden** | Gemessen: kreuzt Artikel mit Bon-**Ereignissen** (`„Bar gegebenRückgeld"`), nicht mit Zahlarten. In 6.685 Zeilen kein einziges „Glücksrad". Beantwortet F1 **nicht**, trotz des Namens |
| **111** | Finanzwege pro Terminal | später | Terminalebene beantwortet keine Frage des Katalogs |
| **113 / 59** | Tischtransfer, Tischübergabe | später | |
| **87** | Erweiterter Tagesabschluss | **nur nach E7** | **Liefert HTML, kein JSON** (992.434 Byte). Braucht einen eigenen Parser mit harten Strukturprüfungen, wie der Ladenakte-Parser |
| **2, 3, 7, 8, 9, 23, 24, 107, 118** | BWA-, Personal-, Wareneinsatzgruppe | **gesperrt** | HTTP 500, leerer Body. **Aber: mit dem falschen Endpunkt gemessen** — siehe E4 |
| **102, 117, 20, 103, 104, 116, 5, 6, 18, 12, 13** | `vue:*` und Sonderrouten | **eigene Endpunkte** | Über `getReport` antwortet 103 mit 500 und leerem Body; die Vue-Berichte laden über eigene Abrufe. Je einer wäre eine eigene Erkundung |
| **38 / 39 / 58** | Storno | **entschieden: nein** | `entscheidungen.md`. Vorbehalt in E3 |
| **64** | Aktionsreport | **erst messen** | F13 |

---

## 4. Datenmodell — Vorschlag, offene Entscheidungen markiert

Grundsätze wie überall: **`raw.api_antwort` append-only** (Regel 4), Partitionierung nach
`geschaeftstag` wie `core.artikelverkauf_tag` (`migrations/0003_bewegungsdaten.sql:110–146`),
deutsche Spaltennamen, `COMMENT ON` mit der Körnung (die Regel aus `metabase.md`, ohne die der
MCP-Katalog nicht befüllbar ist).

### 4.1 Finanzwege — der Stamm, der nur aus den Berichten selbst entsteht

```
core.finanzweg          nummer PK, name, finanzgruppe, art, prozentsatz,
                        erstmals_gesehen date, zuletzt_gesehen date
core.finanzweg_stand    nummer, monat, name, finanzgruppe   -- Namenshistorie, append-only
core.finanzweg_tag      betrieb_key, geschaeftstag, finanzweg_nummer,
                        umsatz_brutto, anzahl, raw_id       -- PARTITION BY geschaeftstag
```

**Drei Dinge, die man dem Schema ansehen muss:**

1. **Die Zuordnung „ist das Glücksrad" läuft über den NAMEN, nie über eine Nummernliste.** Es gibt
   zwei Finanzwege „25 % Glücksrad": `3501` (mit Apostroph im Namen) und `3168` (ohne). Für Wilma
   Wunder Düsseldorf/August liefen 31 Vorgänge über `3168` und 66 über `3501` — wer nach
   `3500/3501/3502` filtert, verliert 31 stillschweigend (`lina-api-inventar-1d.md`, A2).
   `art` und `prozentsatz` werden aus dem Namen abgeleitet und sind **abgeleitet, nicht Quelle**;
   das gehört in den Spaltenkommentar.
2. **Es gibt keine Stammdatenquelle.** `/wawi/badata/fintyp` führt 34 System-Finanzwege mit Nummern
   von −10 bis 91; die vierstelligen (3168, 3500–3502) stehen **nicht** darin. Der Stamm entsteht
   aus den Antworten von 88 (`Nummer`/`Finanzweg`/`Finanzgruppe`) — deshalb `erstmals_gesehen`
   statt `gueltig_ab`.
3. **`Anzahl` bedeutet in 88 und 92 Verschiedenes** und ist erwartet verschieden: in 88 Vorgänge
   (600 bei 50 % Glücksrad), in 92 Artikel (712). Beide Spalten heißen `anzahl`; der Kommentar muss
   es sagen, sonst addiert sie jemand.

### 4.2 Nachlass je Artikel — der Name ist der Schlüssel, und das ist die Bruchstelle

```
core.rabatt_artikel_tag  betrieb_key, geschaeftstag, finanzweg_nummer,
                         artikel_name text, artikel_key int NULL,
                         anzahl, brutto, netto, raw_id     -- PARTITION BY geschaeftstag
```

`brutto`/`netto` sind der **gewährte Nachlass** (negativ), nicht der Verkaufspreis. Die
Artikelzeilen von 92 tragen **nur den Namen, keine Artikelnummer** — `artikel_key` ist deshalb
**abgeleitet und darf NULL sein**. Der Abgleich:

* über `core.artikel_name_norm()` aus Migration `0094` — nicht `core.name_norm()`, die am Wortende
  `kg` streicht (dort Kommanditgesellschaft, im Artikelnamen eine Mengenangabe);
* **nur gegen Artikel, die dieser Betrieb im selben Zeitraum verkauft hat** (`core.artikelverkauf_tag`),
  nicht gegen den ganzen Katalog: Artikelnummern sind je Konzept vergeben, und derselbe Name kommt
  in mehreren Konzepten vor;
* **mit einer Prüfsicht**: `mart.rabatt_artikel_unaufgeloest` nennt jeden Namen ohne Treffer, mit
  Betrieb, Monat und Nachlasssumme. Ohne sie wäre die Auflösungsquote ein Gerücht. Anhaltspunkt aus
  der einen Messung: von 51 Aktionsartikeln fanden sich **50 per Name** wieder.

**Und ein Befund, der jede Auswertung darauf rahmt:** der Glücksrad-Nachlass gilt für den **ganzen
Bon**. 327 verschiedene Artikel trugen ihn im August, auch Getränke. Eine Zahl „Menge Durchstarter
über 50 % Glücksrad" ist deshalb *„Menge Durchstarter auf Bons, die einen 50-%-Nachlass trugen"*.
Das gehört als Fallstrick in `mcp.fallstrick` und in den Kartentext, nicht in eine Fußnote.

### 4.3 Bonebene aus 96 — eine Zeile je Bon, und warum das die richtige Wahl ist

```
core.bon   betrieb_key, geschaeftstag, rechnungsnummer,
           art text,            -- Rechnung | Stornierte Rechnung | Gutschrift
           anzahl_artikel int, finanzwege text[], brutto numeric(12,2),
           debitor text NULL, raw_id
           PRIMARY KEY (geschaeftstag, betrieb_key, rechnungsnummer)
           PARTITION BY RANGE (geschaeftstag)
```

**Die Entscheidung, die der Auftrag verlangt: je Bon eine Zeile, nicht ein Tagesaggregat.**
Begründung mit der gemessenen Zahl, nicht mit der geschätzten:

* **30,3 Mio. Bons seit 2018** (gemessen, `plan-lina-kassendaten.md` §2) — nicht 80 Mio. Zum
  Vergleich: `core.artikelverkauf_tag` trägt 27,5 Mio. Zeilen in 108 Partitionen und belegt 3,8 GB
  (`metabase.md`, „Tempo"). Die Bonebene ist damit **eine Größenordnung kleiner als befürchtet und
  vergleichbar mit einer Tabelle, die wir seit einem Jahr problemlos betreiben.**
* Ein Tagesaggregat plus Histogramm beantwortet **nicht**: „wie viele Bons trugen Karte *und*
  Trinkgeld", „wie verteilt sich die Bongröße im 90. Perzentil", „welcher Anteil des Umsatzes läuft
  über Debitoren". Alles drei sind Fragen aus F3, F9 und F10.
* Der Verdichtungsweg ist einseitig: aus Bons lässt sich ein Tagesaggregat jederzeit rechnen, aus
  einem Aggregat kein Bon.

**`finanzwege` als `text[]` und nicht als Kindtabelle.** LINA liefert sie kommagetrennt
(`„Trinkgeld,VISA"`). Eine normalisierte `core.bon_zahlweg` verdoppelte die Zeilenzahl auf rund
60 Mio. für eine Frage — „Bons mit Zahlart X" —, die ein GIN-Index auf dem Array genauso beantwortet.
**Offen (E2):** ob der Fachbereich Beträge je Zahlart am Bon braucht. Die liefert 96 **nicht**; sie
stünden nur in der Bonebene, die nicht erreichbar ist. Solange das so ist, ist die Kindtabelle
ohnehin nicht füllbar.

**Was 96 nicht kann und was deshalb nicht versprochen wird:** keine Uhrzeit (`Datum` ist
`format: day`), keine Artikelzeilen, **keine Nachlass-Finanzwege**. Am 15.08.2026 nachgemessen:
Bericht 88 zeigt für denselben Tag 32 Glücksrad-Vorgänge, in 96 trägt keiner der 519 Bons
„Glücksrad". Map 5.1 („Bons mit Aktion", „Ø Bon mit vs. ohne Aktion") bleibt damit **unerfüllbar**.

### 4.4 Die übrigen Tabellen

| Tabelle | Quelle | Körnung | Anmerkung |
|---|---|---|---|
| `core.tagesabschluss_tag` | 97 | Betrieb × Tag | partitioniert; aus Monatsaufrufen gefüllt |
| `core.personalverzehr_monat` | 114 | Betrieb × Monat × Konto | |
| `core.kellner_umsatz_monat` | 60, 61, 56, 57 | Betrieb × Monat × Kellner**name** | **Kein Personenschlüssel gemessen.** Ein `kellner_key` wäre erfunden; es bleibt der Name plus Betrieb, und eine Zuordnung zu Bounti ist ein eigenes Vorhaben (E5) |
| `core.kellner_artikel_monat` | 53 | + Artikel | |
| `core.gutschein_transaktion` | 82 | Betrieb × Monat × Transaktion | |
| `core.gutschein_umlauf_stand` | 81 | Betrieb × **Monatserster** | Bestand, append-only, kein Backfill |
| `core.debitor_umsatz_monat` | 86 | Betrieb × Monat × Debitor | |
| `core.betriebsstelle_umsatz_monat` | 68, 69 | Betrieb × Monat × Stelle (× Hauptsparte) | |
| `core.tisch_umsatz_monat` | 70 | Betrieb × Monat × Tisch | |
| `core.verkaufsstelle_umsatz_monat` | 112, 71 | Betrieb × Monat × Verkaufsstelle | entfällt, falls F15 trägt |
| `core.zeitzone_sparte_monat` | 75, 76 | Betrieb × Monat × Zone × Sparte | |
| `core.bericht_hinweis` | **alle** | Bericht × Betrieb × Zeitraum | **Das `errors`-Feld.** LINA liefert dort fachliche Hinweise („Doppelte Artikelnummern, unbedingt korrigieren:"). Es ist ein Datenqualitätskanal, kein technischer Fehler (`lina-api-inventar-1b.md` §1.3), und gehört sichtbar in `mart.bericht_hinweis` — nicht in ein Log |

### 4.5 Was das Schema zusätzlich braucht

* **`sync.warteschlange.betrieb_enc_id`** existiert bereits und wird vom Worker gelesen
  (`worker.ts`), ist aber nie befüllt worden — der Producer ist Abschnitt 5, nicht das Schema.
* **`sync.quelle`-Zeilen mit `erwartet = true`** je aktiviertem Bericht (`0076`). Ohne sie meldet
  der Lauf `ok`, wenn ein Bericht stumm wird.
* **Eine Prüfzeile in `mart.pruefung_uebersicht`** je Stufe-A-Bericht: „Betrieb-Tage mit Umsatz,
  für die Bericht X fehlt". Das ist die Regel-10-Zeile zu Abschnitt 5.

---

## 5. Importer — was gebaut werden muss

Heute ist **jeder** Betriebsendpunkt gesperrt: `endpunkteZusichern()` in `src/sync/waechter.ts`
wirft `RegisterVerletzt`, sobald ein Endpunkt mit `ebene: 'betrieb'` auf `aktiv: true` steht. Das
ist Absicht und bleibt es — der Wächter fällt nicht weg, er wird **erfüllt**.

### 5.1 Die drei Lücken, die der Wächter benennt

| # | Lücke | Vorlage | Datei |
|---|---|---|---|
| 1 | **Kein Producer für `betrieb_enc_id`** — kein `INSERT` im Repo setzt die Spalte (nachgesehen 13.08.2026, unverändert am 22.09.2026) | `einreihenJeMonat()` mit `parameter jsonb` (`nachfuellen.ts:1104`) | `src/sync/nachfuellen.ts` |
| 2 | **Kein Einreihzweig für `monat`** und keiner für „je Betrieb und Tag" — `linaNachfuellen()` kennt nur `tag`, `jahr`, Momentaufnahme | dieselbe | `src/sync/nachfuellen.ts`, `EINREIHBARE_SCHRITTWEITEN` in `waechter.ts` |
| 3 | **Kein `laden.ts`-Fall** je Bericht; der `switch` hat ein stilles `default:` (Zeile 778) | die vorhandenen Fälle | `src/sync/laden.ts`, `TRANSFORMIERTE_ENDPUNKTE` |

### 5.2 Der Einreihweg — und die Falle darin

**Treiber ist „Betrieb-Tag mit Umsatz".** 141 Betriebe × Kalendertage wären 435.000 Betrieb-Tage
seit 2018; mit Umsatz sind es 152.840. Die Ersparnis ist **65 %**, und nebenbei entfallen die
HTTP-500-Antworten von Betrieben ohne Daten.

> **Die Falle, und sie ist eine Regel-10-Falle:** *ein Tag, den der Umsatzbericht nicht kennt, wird
> damit nie gefragt.* Und genau solche Tage gibt es nachweislich — dafür existieren seit `0100` und
> `0101` `mart.umsatztag_luecke` (Artikelverkauf kennt Umsatz, Umsatzbericht steht null) und
> `mart.umsatz_lochtag` (beide Berichte leer). Der 22.07.2026 stand sieben Wochen bei allen 141
> Betrieben auf null.
>
> **Zwei Konsequenzen, beide zwingend:**
> 1. Der Treiber ist `core.umsatzbericht_tag` **ODER** `core.artikelverkauf_tag` — die Vereinigung,
>    nicht der Umsatzbericht allein.
> 2. Eine eigene Prüfzeile: „Betrieb-Tage mit Umsatz ohne Bericht X". Erwartung ist **nicht null**,
>    sondern das laufende Backfill-Volumen — eine Kachel, die nie auf null geht, liest niemand
>    (`0071`). Sie zählt deshalb nur Tage **außerhalb** des offenen Backfill-Fensters.

**Reihenfolge: neueste zuerst, über alle Betriebe gemeinsam nach Datum.** `ORDER BY tag DESC,
betrieb_key` — nicht `ORDER BY betrieb_key, tag`. Ein Test prüft es am erzeugten SQL bzw. an der
eingereihten Folge; die Begründung steht in `plan-lina-kassendaten.md` §4.2 und in
`historieNachziehen()`.

**Eine eigene Obergrenze, nicht `HISTORIE_JE_LAUF`.** Vorschlag `BETRIEBSBERICHT_JE_LAUF`,
Voreinstellung **4.000**, auf `0` gesetzt hört das Nachholen auf. Zwei getrennte Zahlen, weil sonst
die Betriebsberichte die Konzern-Historie verdrängen oder umgekehrt — und weil eine Zahl, die zwei
Dinge steuert, bei der ersten Anpassung das falsche trifft. **Kein Handbefehl** (AGENTS.md, *Betrieb
ohne Handbefehl*).

**Erstabruf frühestens Tag + 7.** LINAs Berichte füllen sich über fünf bis sieben Tage
(`backfill.md`). Ein Betrieb-Tag, der zu früh geholt wird, liefert eine plausible zu kleine Zahl —
und der Posten gilt danach als erledigt. Der Nachlauf (5.3) fängt den Rest.

### 5.3 Die Gegenprobe — sie entscheidet, ob ein Bericht als geladen gilt

Das ist die Lehre aus dem 22.09.2026 ([`fehlerkatalog.md`](fehlerkatalog.md), *„Der
Betriebsbericht-Endpunkt lieferte zwei Monate lang leere Gerüste"*):

```
balanceSumNetto(Antwort)  ==  Nettoumsatz aus core.umsatzbericht_tag
                              für denselben Betrieb und Zeitraum
```

* Trifft es: Posten `ok`.
* Trifft es nicht, und der Betrieb hat laut Umsatzbericht Umsatz: **Fehler, nicht `keine_daten`.**
  Der Posten wird erneut eingereiht (höchstens dreimal, wie die Nulltage), danach steht er sichtbar
  in einer Prüfsicht.
* `nBillsGesamt: 0` bei einem Betrieb mit Umsatz ist derselbe Fall.

**Die Größe einer Antwort ist kein Beleg für Inhalt.** Report 97 lieferte über den falschen Endpunkt
für zwei Betriebe und zwei Monate byte-genau 65.830 Byte — 62 Tageszeilen mit lauter Nullen. Wer
eine Bytezahl als Erfolgsmerkmal einbaut, baut denselben Fehler nach.

### 5.4 Weitere Regeln für den Lader

| Regel | Grund |
|---|---|
| **`500` + leerer Body ⇒ `keine_daten`, kein Retry** | `lina-api-inventar-1b.md` §1.3; entspricht dem bestehenden Verhalten von `sync.aufgabe.status = 'keine_daten'` |
| **HTML-Erkennung vor dem JSON-Parsen** | Bericht 87 liefert HTML (992.434 Byte) über dieselbe `getReport`-Route. Ein `Content-Type`/Präfix-Test, der laut scheitert, statt einer zod-Fehlermeldung über 1 MB Text |
| **zod prüft je Bericht die erwarteten `tableHead[].field`** | Die Hülle ist gleich, die Spalten sind es nicht. Eine Spaltenumbenennung muss in `sync.schema_abweichung` landen und darf nicht als NULL durchrutschen |
| **`errors` wird gespeichert** | Datenqualitätskanal, siehe 4.4 |
| **`interval` wird aus `possibleIntervals` der Antwort gelesen, nicht gesetzt** | Ein nicht unterstütztes `interval` wird **still ignoriert** (getestet: `interval=3` gegen 88 → identische Bytes, `defaultInterval: 8`). Wer daraus Tageszeilen erwartet, bekommt Monatszeilen, die wie Tageszeilen aussehen |
| **`von`/`bis` ohne führende Null** (`1.8.2026`) | Betriebsebene, anders als Konzernebene (`01.08.2026`). `zuLinaDatum(…, 'short')` kann es bereits |
| **Betrieb↔Marke nie über den Namen** | Wilma Wunder Markt Mainz heißt in LINA `Gastronomie am Markt Mainz GmbH`. Eine Namenssuche findet 13 von 14. `core.betrieb_konzept` ist der Weg |

### 5.5 Dateicheckliste

| Datei | Arbeit |
|---|---|
| `src/lina/endpunkte.ts` | **Pfad der vier inaktiven `getReport:*` korrigieren** (`/intranet/storeanalytics/getReport`, `laden=` statt `storeId=`), neue Einträge je Bericht, neue `schrittweite` für „je Betrieb und Tag" |
| `src/sync/nachfuellen.ts` | Producer für `betrieb_enc_id`; Einreihzweig je Betrieb-Tag (Treiber: Vereinigung Umsatz-/Artikelbericht, `ORDER BY tag DESC`); Einreihzweig `monat` je Betrieb; eigene Obergrenze |
| `src/sync/waechter.ts` | `EINREIHBARE_SCHRITTWEITEN` erweitern; die `ebene: 'betrieb'`-Zusicherung von „immer Verstoß" auf „Verstoß, wenn kein Producer" umbauen — **nicht ersatzlos entfernen** |
| `src/sync/laden.ts` | Fall je Bericht + `TRANSFORMIERTE_ENDPUNKTE`; die Gegenprobe aus 5.3 |
| `src/lina/schemas.ts` | je Bericht die erwarteten Felder über `BetriebsReportSchema` hinaus |
| `src/sync/quellen.ts` | je aktiviertem Bericht eine Zeile mit `erwartet: true` und begründeter Kadenz |
| `src/transform/index.ts` | reine Transformationen je Bericht |
| `src/lina/mock.ts` | Attrappe je Bericht, gespeist aus `docs/payloads/` — **echte anonymisierte Antworten**, keine erfundenen |
| `migrations/NNNN_betriebsberichte.sql` | Tabellen aus Abschnitt 4, Partitionen, `mart`-Sichten, Prüfzeilen. **Vor dem Anlegen `ls migrations/`** — die Nummer muss frei sein |
| `src/config.ts` | `BETRIEBSBERICHT_JE_LAUF` |
| Tests | Reihenfolge (neueste zuerst), Gegenprobe, 500-ohne-Body, HTML-Erkennung, `waechter.test.ts` (kein aktiver Endpunkt ohne `sync.quelle`-Zeile), `phasen.test.ts` (kein Dienst fällt heraus) |

---

## 6. Auswertung und Selbstbedienung

**Das ist die Hälfte des Auftrags, nicht das Nachwort.**

### 6.1 `mart`-Sichten

| Sicht | Körnung | trägt |
|---|---|---|
| `mart.finanzweg_tag` | Betrieb × Tag × Finanzweg | Umsatz, Anzahl, Finanzgruppe, `ist_nachlass` |
| `mart.nachlass_monat` | Betrieb × Monat | Nachlasssumme je Gruppe, Anteil am Bruttoumsatz |
| `mart.artikel_nachlass_monat` | Betrieb × Monat × Artikel × Finanzweg | **die Glücksrad-Tabelle.** Mit `artikel_key` wo aufgelöst, sonst Name |
| `mart.rabatt_artikel_unaufgeloest` | Name × Monat | Prüfsicht zur Namensauflösung |
| `mart.bon_tag` | Betrieb × Tag | Bons, Ø-Bon, Gutschriftenquote, Debitorenanteil |
| `mart.bongroesse_verteilung` | Betrieb × Monat × Klasse | p25/Median/p75/p90 |
| `mart.zahlart_monat` | Betrieb × Monat × Zahlart | |
| `mart.kellner_monat` | Betrieb × Monat × Kellner | |
| `mart.gutschein_monat`, `mart.debitor_monat`, `mart.betriebsstelle_monat` | Betrieb × Monat × … | |

Regeln dafür stehen in `metabase.md`, *„Wer eine `mart`-Sicht ergänzt"* — insbesondere: Zeitfilter
auf der partitionierten Spalte der Basissicht, nicht in einer Unterabfrage (8,4 s gegen 0,6 s).
**Und die Körnung gehört in den Tabellenkommentar**, sonst ist die Sicht für den MCP-Katalog nicht
beschreibbar.

### 6.2 Das Dashboard bekommt den Filter, der die Anfrage erübrigt

`db_artikelaktion` (`metabase/karten-artikelaktion.ts`, sechs Karten: `aa_kopf`, `aa_betrieb`,
`aa_verlauf_nachlass`, `aa_verlauf_menge`, `aa_artikel`, `aa_liste_pruefung`) rechnet den Nachlass
heute **indirekt**: `1 − umsatz_brutto / (menge × verkaufspreis)`. Das war der einzige Weg, solange
92 nicht geladen war, und es misst **alle** Rabatte zusammen.

Mit `core.rabatt_artikel_tag` wird daraus eine Messung statt einer Ableitung:

* ein **Finanzweg-Filter** (Auswahlliste aus `core.finanzweg`, nicht Freitext — die 51 Artikelnummern
  bleiben Freitext, die Finanzwege sind eine kurze Liste);
* eine Karte „Nachlass je Finanzweg und Artikel", die F1 direkt beantwortet;
* der Kopftext sagt, dass der Nachlass für den **ganzen Bon** gilt.

Der bestehende indirekte Nachlass bleibt **daneben stehen**, nicht ersetzt: er enthält auch
Nachlässe, die nicht als Finanzweg gebucht werden, und die Differenz beider Zahlen ist selbst eine
Aussage.

### 6.3 Der MCP-Weg — hier endet der Plan

Ziel war *„ohne einen Agenten zu beauftragen"*. Der Weg dahin ist gebaut: Skybridge führt die Karten
aus `metabase/karten-*.ts` als Berichte aus (`bericht_ausfuehren`), und Daniel fragt in ChatGPT,
Claude oder Copilot. Damit die neue Frage dort ankommt, braucht es **drei** Dinge, nicht eins:

1. **Neue Karten in `metabase/karten-*.ts`** — sie sind zugleich BI-Karte und MCP-Bericht. Eine
   Karte, die nur in der Metabase-Oberfläche existiert, ist für den MCP-Server unsichtbar.
   Zielbild: *„Menge je Artikel und Nachlass für die Betriebe X im Zeitraum Y"* ist ein
   `bericht_ausfuehren('aa_nachlass', {betriebe, von, bis})`.
2. **Einträge in `mcp.fallstrick`** — **und jede Regelart braucht eine Umsetzung in
   `mcp/src/pruefen.ts`, sonst startet der Server nicht.** Das ist der Preis, und er ist Absicht:

   | Fallstrick | Schwere | Grund |
   |---|---|---|
   | Filter auf `finanzweg_nummer IN (3500,3501,3502)` | **sperre** | Es gibt **zwei** „25 % Glücksrad" (3501 **und** 3168). Über den Namen filtern |
   | Join `core.rabatt_artikel_tag` ↔ `core.artikel` über `artikel_name` | **warnung** — umgesetzt als `nachlass_join_artikelname` auf `mart.artikel_nachlass_monat` | Namensschlüssel; die Auflösungsquote steht in `mart.rabatt_artikel_unaufgeloest` |
   | `sum(anzahl)` über 88 und 92 gemeinsam | ~~**sperre**~~ **warnung** (`0118`, `entscheidungen.md` 23.09.2026: die Spalten heißen seit `0117` verschieden, und „Artikel je Vorgang" ist eine legitime Frage) | In 88 Vorgänge, in 92 Artikel |
   | `mart.bon_*` für „Bons mit Aktion" / Ø-Bon mit vs. ohne Aktion | **sperre**, umgesetzt als Suche nach Nachlass-Namen in `mart.bon_zahlart_tag` (`bon_ohne_nachlass`), dazu eine Deutung auf `mart.bon_tag` | 96 trägt **keine** Nachlass-Finanzwege — gemessen |
   | Uhrzeit oder Wartezeit aus `core.bon` | **sperre** — keine eigene Regel nötig: `mart.bon_*` hat keine Uhrzeitspalte, `core` ist gesperrt; dazu die Deutung `bon_deutung` | `Datum` ist `format: day` |
   | `mart.artikel_nachlass_monat` als „Verkaufsmenge" gelesen | **warnung** | Es ist die Nachlassmenge; der Nachlass gilt für den ganzen Bon |

3. **Katalogabzug neu ziehen**, sobald eine `mart`-Sicht dazukommt:
   `cd mcp && MCP_DATABASE_URL=… bun run katalog:abzug`, gegen eine **vollständige** Datenbank.
   `mcp.achsen_ableiten()` nimmt neue Sichten selbst auf, die Abzugsdatei **nicht** — am 20.09.2026
   war sie 37 Sichten weit gedriftet.

---

## 7. Reihenfolge und Meilensteine

Jeder Meilenstein hat etwas, das danach **nachprüfbar** ist. Ein Meilenstein ohne Prüfung ist eine
Absichtserklärung.

| | Meilenstein | fertig, wenn |
|---|---|---|
| **M0** | ~~**Verkaufsstellen im Umsatzbericht**~~ **gebaut 22.09.2026 (Migration `0112`), Abnahme nach der ersten Nacht offen** (F15, Nebenbefund). Sieben Registereinträge nach dem Muster der zehn Hauptsparten aus `0077`, `sync.quelle`-Zeilen dazu. `mart.hauptsparte_abdeckung` hätte die neuen Zeilen doppelt gezählt und ist mit repariert; der Parameter ist ungeprüft, Gegenprobe `mart.verkaufsstelle_abdeckung` | `SELECT count(*) FROM core.umsatzbericht_tag WHERE verkaufsstelle_key IS NOT NULL` ist > 0, und `kennzahlen-mapping.md` Zeile 68 stimmt zum ersten Mal. **Kostet 7 Aufrufe je Tag** (im Nachzügler-Fenster 70 je Nacht) |
| **M1** | ~~**Importer lernt Betriebsberichte**~~ **gebaut 22.09.2026, Abnahme offline bestanden** (`src/transform/betriebsbericht.test.ts`, und durch `laden()` in die Datenbank in `src/sync/betriebsbericht.test.ts` — exakt 149 / 1.413 / 7.335, Durchstarter 12 / 107 / 432). Die „5.183" (alle Durchstarter) kommen aus dem Artikelverkauf und sind nicht Teil des Tests. Aktiviert ist nicht 92 allein, sondern Stufe A und B zusammen (Abschnitt 5); abgenommen an **August 2026**, **14 Wilma-Wunder-Betriebe** | **Der Abnahmetest:** die Sicht reproduziert die Zahlen aus `docs/gluecksrad-august-2026-finanzwege.xlsx` — **10 %: 149 Stück, 25 % (beide Nummern): 1.413, 50 %: 7.335**, Durchstarter 12 / 107 / 432 = **551 von 5.183**. Trifft es nicht, ist der Lader falsch, nicht die Excel |
| **M2** | ~~**Körnungsmessung 96 und 90**~~ **erledigt 22.09.2026** (90 M-Tag, 96 W) — (M-Tag oder T): je ein Monatsaufruf gegen einen Betrieb, Zeilenzahl und Datumsverteilung gegen die Tagesaufrufe | Die Kostentabelle in Abschnitt 3 steht mit einer Zahl statt zweien. **Das entscheidet über 5,5 Wochen Backfill** |
| **M3** | ~~**88 und 96 dazu**, Gegenprobe aus 5.3 aktiv, `sync.quelle`-Zeilen gesetzt~~ **gebaut 22.09.2026 (`0114`); Abnahme nach der ersten Nacht offen.** Die Gegenprobe holt nach, statt den Posten scheitern zu lassen (`entscheidungen.md`, 22.09.2026 Punkt 2) | `mart.quelle_zulauf WHERE erwartet AND zustand <> 'ok'` ist leer, und `mart.pruefung_uebersicht` trägt die neue Zeile „Betrieb-Tage ohne Bericht X" |
| **M4** | **Backfill Stufe A** ~~mit `BETRIEBSBERICHT_JE_LAUF = 4.000`~~ (E8: Vorgabe = Tagesbudget, verschränkt), neueste zuerst — **Einreihweg und Verschränkung gebaut 22.09.2026; der Backfill beginnt mit der ersten Nacht nach dem Deploy.** Gemessen am Klon: 455.919 Posten für die ganze Historie | Nach der ersten Nacht ist der **letzte Monat für alle 62 operativen Betriebe** vollständig — nicht ein Betrieb für alle Jahre. Nach ~11 Wochen steht 2018. `mart.backfill_fortschritt` zeigt es |
| **M5** | ~~**Auswertung und Selbstbedienung** (Abschnitt 6): `mart`-Sichten, Filter auf `db_artikelaktion`, Karten, `mcp.fallstrick` + `pruefen.ts`, Katalogabzug~~ **gebaut 23.09.2026 (`0117`/`0118`), offline abgenommen; die Abnahme in ChatGPT/Claude steht nach Deploy und Backfill aus.** 31 Sichten (jede Tabelle aus `0112`–`0115` hat eine), 14 Karten auf zwei neuen Seiten und `aa_nachlass` mit Nachlass-Filter, 14 Fallstricke mit drei neuen Regelarten, Ladestand an jeder Antwort, Katalogabzug neu. Als `mcp_leser` über den MCP-Weg am Klon: **149 / 1.413 / 7.335, Durchstarter 12 / 107 / 432**. In Produktionsgröße gemessen: alle typischen MCP-Abfragen unter 1 s (`metabase.md`) | *„Menge je Artikel und Nachlass für Wilma Wunder im August"* wird in ChatGPT beantwortet, ohne dass jemand SQL schreibt. **Das ist der Punkt, an dem der Auftrag erfüllt ist** |
| **M6** | **Stufe B**, Bericht für Bericht: erst eine Messung an drei Betrieben, dann Registereintrag, dann Backfill — **Registereintrag, Tabelle und `sync.quelle` für 16 Berichte gebaut 22.09.2026 (`0115`), gemessen an EINEM Betrieb; `mart`-Sicht und Karte fehlen (M5)** | Je Bericht: `sync.quelle`-Zeile, `mart`-Sicht mit Körnungskommentar, eine Karte. Kein Bericht ohne alle drei |
| **M7** | **Stufe C nach Bedarf** | — |

### Was Eugene entscheiden muss

| | Entscheidung | Warum sie ansteht |
|---|---|---|
| **E1** | **Tagesraster nur für 92 und 88?** Zwei Berichte kosten 11 Wochen Backfill; jeder weitere +5,5 Wochen, in denen alles andere wartet | Die Alternative wäre Monatsraster für 92 (Aktionen halten sich nicht an Monatsgrenzen — deshalb wurde Tagesraster gewählt) |
| **E2** | **Bonebene aus 96: eine Zeile je Bon (30,3 Mio. Zeilen) oder Tagesaggregat?** Empfehlung: je Bon, Begründung in 4.3 | Aus Bons folgt das Aggregat, umgekehrt nicht |
| **E3** | **Storno 38/39 einmal neu messen?** Die Entscheidung *„Storno wird nicht gebaut"* stützte sich auf zwei Dinge: die Stornogründe sind Schwundgründe (**gilt weiter**) und „jeder geprüfte Betrieb lieferte `nBillsGesamt = 0`" (**das war ein Artefakt des falschen Endpunkts**, KORREKTUR 7). Ein einzelner lesender Aufruf klärt es | Eine Entscheidung, deren halbe Grundlage widerlegt ist, gehört einmal angesehen — nicht automatisch umgestoßen |
| **E4** | **Dasselbe für die neun „gesperrten" Berichte** (2, 3, 7, 8, 9, 23, 24, 107, 118). Die 500er wurden am 25.07.2026 über `/finanzen/analytics/getReport?storeId=` gemessen — also über den Weg, der grundsätzlich nichts liefert. **Es ist unbekannt, ob sie über `laden=` antworten.** Neun lesende Aufrufe klären es | Betrifft 107 (Gearbeitete Stunden) und 118 (Wareneinsatz/Deckungsbeitrag) — zwei Berichte, an denen mehrere Kennzahlen hängen |
| **E5** | **Kellnernamen (F6) auswerten?** Gedeckt durch die Entscheidung vom 11.08.2026, aber es ist die erste Quelle, die **Personen namentlich** in `core` bringt. Ohne Personen-ID ist die Verzahnung mit Bounti unsicher | |
| **E6** | **Bericht 99 laden?** 2,1 MB je Betrieb-Monat = rund 10,8 GB im Raw-Layer für eine Aufschlüsselung, die 88 gröber schon liefert | |
| **E7** | **Bericht 87 (HTML) parsen?** Braucht einen eigenen Parser mit harten Strukturprüfungen | |
| **E8** | **Startwert `BETRIEBSBERICHT_JE_LAUF`.** 4.000 ist entschieden — zu bestätigen ist, ob die Ersparnis aus `0099` (Ladenakte von ~1.974 auf ~330 Zählproben) angerechnet wird oder als Reserve stehen bleibt | Bei nachgemessenen ~5,3 s je Aufruf dauern 4.000 Aufrufe rund sechs Stunden; die ganze Nacht endet damit am Nachmittag. Beim Code-Standard von 10–20 s wären 4.000 nicht mehr erreichbar (Abschnitt 3) |

### Entschieden am 22.09.2026 (Eugene)

| | Entscheid | Folge für den Bau |
|---|---|---|
| **E1** | **Nur 92 und 88 im Tagesraster**, alles andere monatlich. **Für 88 revidiert am 23.09.2026** (unten) | Kostentabelle Abschnitt 3 gilt wie gerechnet — ~~mit 88~~ seit 23.09.2026 ohne 88 |
| **E2** | **Eine Zeile je Bon** aus 96 | `core.bon` wie in 4.3, Aggregate als `mart`-Sicht |
| **E3** | **Storno 38/39 neu messen** über `laden=` | Teil der Vermessung; danach neu entscheiden, ob gebaut wird |
| **E4** | **Die neun „gesperrten" Berichte neu messen** über `laden=` | Teil der Vermessung; antworten 107/118, wandern sie in Stufe B |
| **E5** | **Kellnerberichte mit Namen laden** | Erste Quelle mit Personennamen in `core` — Metabase-Sichtbarkeit und `mcp_leser`-Rechte beim Bau eigens festlegen |
| **E6** | **Bericht 99 laden** (~10,8 GB Raw) | Monatsraster, Stufe B; Plattenplatz vor dem Backfill prüfen |
| **E7** | **87 erst inhaltlich prüfen**, dann entscheiden | Teil der Vermessung: was steht in 87, das kein JSON-Bericht hat? |
| **E8** | **Keine feste 4.000er-Grenze.** Die 4.000 stammten aus der ersten Rückfrage dieses Vorhabens (Budgetwahl, nicht gemessen). Eugene: *„Es kann gerne auch länger laden, solange wir das System nicht zuballern und sich über alle API-Aufrufe des gleichen Systems verteilen."* | Der Takt bleibt unverändert (Regel 3), `TAGESBUDGET` bleibt die Obergrenze für **alle** LINA-Aufrufe zusammen. Betriebsberichte bekommen, was nach dem Tagesgeschäft übrig bleibt, und werden **mit den übrigen LINA-Posten verschränkt** statt als Block am Stück — die Nacht wird länger, nicht dichter. `BETRIEBSBERICHT_JE_LAUF` bleibt als Notbremse (0 = aus). **Ergänzt am 23.09.2026 (`0116`):** das Nachladen läuft NACH den Auswertungen (Phase C); vor ihnen nur die laufenden Tages- und Wochenberichte der letzten 21 Tage |

### Revidiert am 23.09.2026 (Eugene): 88 ist abgeschaltet

Wörtlich: *„Wenn du dir sicher bist, dass 97 die Werte genauso liefert, dann schalte 88 ganz ab."*

| | Entscheid | Folge für den Bau |
|---|---|---|
| **E1 für 88** | **88 wird nicht mehr geholt**, weder laufend noch als Historie. Die Finanzwege kommen nur aus **97** (Tagesabschluss, M-Tag, `interval=3`). Nachweis: drei Stichproben, jede identisch — Düsseldorf August 2026 (34/34), Markt Mainz 15.08.2026 (25/25), Düsseldorf Januar 2019 (22/22, `balanceSumBrutto` 315.456,17) | Migration `0119`: `aktiv: false` im Register, `sync.quelle` `erwartet = false` mit Begründung, offene 88-Posten mit dem neuen Ergebnis `abgeschaltet` geschlossen. Lader und Rohantworten bleiben (Regel 4); `mart.finanzweg_tag` nimmt 97 vor 88, die schon geladenen 88-Tage bleiben Rückfall. **Ersparnis ≈ 153.000 Aufrufe Historie** (am Klon 153.363) plus 62 (+62) je Nacht |

**Der Preis:** 97 ist ein Monatsbericht. Die Finanzwege (Nachlässe, Zahlarten) eines Monats stehen
erst ab Monatsende + 7 Tagen da, nicht mehr sieben Tage nach jedem Tag; ebenso lange trägt der
Rabattbericht (92) keine Finanzwegnummer. Wer eine Aktion im laufenden Monat auswerten will,
nimmt dafür 92 über `aktion`/`prozentsatz` — der braucht die Nummer nicht. Begründung in
`entscheidungen.md`, 23.09.2026.

### Ergebnis der Vermessung vom 22.09.2026

Rund 155 lesende Aufrufe gegen Wilma Wunder Düsseldorf, Einzelwerte in
`lina-api-inventar-1d.md`, Abschnitt „Vermessung aller Betriebsberichte". Was davon den Plan ändert:

| | Befund | Folge |
|---|---|---|
| **M2** | **90** ist M-Tag (Monatsaufruf: 31 Tageszeilen, deckungsgleich mit dem Tagesaufruf). **96** ist **W**: Monat → `504`, sieben Tage laufen in 2,9 s | Kostentabelle Abschnitt 3 korrigiert: 96 kostet ≈ 22.000 statt 5.115 oder 152.840 Aufrufe |
| **86, 113** | Debitorenauswertung und Tischtransfer verhalten sich wie 96: Monat und 2022 → `504`, Tag → 200 (je rund 520 Zeilen, eine je Bon) | Nur in Wochenfenstern holen; Wochenaufruf vor dem Registereintrag an einem Betrieb bestätigen |
| **E3** | **Storno liefert echte Daten.** 38/39 August 2026: 487 bzw. 533 Zeilen je Artikel × Stornotyp (× Grund), beide mit derselben Summe, Summe −3.313 Stück, −20.538,06 € brutto. Die alte Grundlage „`nBillsGesamt = 0`" ist damit endgültig widerlegt — `nBillsGesamt` ist ohnehin die Bonzahl des Betriebs, keine Stornozahl | **Neu entschieden 22.09.2026 (Eugene): 39 wird geladen**, monatlich, Stufe B (~5.115 Aufrufe). 39 enthält 38 vollständig plus den Stornogrund; 38 wird nicht geladen. ~~„Storno wird nicht gebaut"~~ |
| **E4** | **Alle neun antworten auch über `laden=` mit 500 und leerem Body** (2, 3, 7, 8, 9, 23, 24, 107, 118). Dasselbe Muster wie „keine Daten" (auch 18 und 12 liefern es in allen drei Zeiträumen) | Nicht unterscheidbar, ob gesperrt oder leer. Bis zu einem UI-Gegenbeweis im Report Center bleiben sie draußen |
| **E5** | **Die Kellnerberichte liefern keine Namen.** 60: `Kellnernummer` gefüllt, `Kellner` durchweg `null`; 53/54 gruppieren nach Kellner, Kopfzeilen ohne Namen; 61 führt kein Kellnerfeld | Die Namensfrage aus E5 stellt sich praktisch nicht — geladen wird die Kellnernummer. Die Verzahnung mit Bounti bleibt damit offen |
| **E7** | **87 liefert JSON, nicht HTML** (405.778 Byte, vier Tabellen: Artikel, Artikel × Hauptsparte, Betriebsstellen, Stunden). Nichts davon ist neu gegenüber 29/45/68/73. Die alte Angabe „HTML" stammte vermutlich vom falschen Endpunkt | Kein Parser nötig, und 87 wird nicht geladen — reiner Sammelbericht |
| **64** | Aktionsreport: in allen Zeiträumen nur eine Summenzeile | Bestätigt: Aktionen laufen über 92, nicht über 64 |
| **81, 82** | Gutscheine: 200 mit 0 Zeilen (Düsseldorf verkauft keine LINA-Gutscheine) | An einem Betrieb mit Gutscheinumsatz nachmessen, bevor F5 verworfen wird |

---

## 8. Offene Punkte und Risiken

1. **Sitzungsgebundene Endpunkte bleiben zu.** Kassenjournal, `billitems`, Store-Dashboard und die
   Monatsübersicht hängen an einem Betrieb, den kein Parameter umschaltet. Zwei Sitzungen haben es
   erfolglos versucht; im Hauptbundle ist die Kopf-Combobox an `currentStore` gebunden, der Klick
   darauf wurde nicht ausgeführt (Regel 4). **Dieser Plan setzt nichts darauf.** Ändert sich das,
   werden 92/88/96 zu Gegenproben statt Hauptquellen — so, wie heute der Umsatzbericht gegen den
   Artikelverkauf steht.
2. **Namensschlüssel bei den Artikeln (92).** Die Auflösungsquote ist an **einem** Betrieb und
   **einem** Monat gemessen (50 von 51). Über 141 Betriebe und acht Jahre ist sie **unbekannt**.
   `mart.rabatt_artikel_unaufgeloest` macht sie sichtbar; wer vorher eine Zahl nennt, rät.
3. **Historische Tiefe der Betriebsberichte ist an einem Betrieb gemessen.** Düsseldorf: Januar 2018
   leer, Januar 2020 und 2022 voll. Ob das die Eröffnung ist oder eine generelle Tiefenbegrenzung,
   ist **nicht unterscheidbar**. Beim Rückwärts-Backfill grenzt es sich je Betrieb selbst ein — aber
   der Fortschrittszähler muss **„keine Daten mehr"** von **„Zugriff verweigert"** unterscheiden
   (`0075`, `mart.posten_ohne_zugriff`), sonst sieht ein Rechteproblem aus wie ein Historienende.
4. **Berichte, die für viele Betriebe leer sind.** 114 war für Düsseldorf/August echt leer. Vor
   jedem Backfill: **drei Betriebe, ein Monat**. 5.115 Aufrufe für Leerzeilen sind anderthalb
   Nächte, die niemandem etwas bringen — und sie sähen im Lauf aus wie Arbeit.
5. **LINA ändert sich ohne Ankündigung.** Der Endpunkt hat sich zwischen Juli und September
   geändert (oder war nie richtig dokumentiert), die Schnellwahl-Buttons sind für `month`-Berichte
   defekt, und `interval` wird still ignoriert. Die zod-Prüfung je Bericht und
   `sync.schema_abweichung` sind die Gegenmaßnahme; die Gegenprobe aus 5.3 ist die zweite.
6. **Budget.** Stufe A+B belegt in der Backfill-Phase rund 4.000 der 10.500 Aufrufe je Nacht,
   zusätzlich zu ~184 Tagesberichten, der Ladenakte und bis zu 2.000 Konzern-Historie. Das ist
   rechnerisch gedeckt, aber **die Laufzeit ist zu beobachten**: bei nachgemessenen ~5,3 s je
   Aufruf dauert eine Nacht mit ~8.400 Aufrufen rund zwölf Stunden. Läuft der Lauf regelmäßig in den
   nächsten Start um 05:02 hinein, wird die Grenze gesenkt — **nicht der Takt erhöht** (Regel 3).
   Seit `0116` (23.09.2026) verspätet die Laufdauer die Dashboards nicht mehr: die Historie lädt
   nach den Auswertungen (Phase C). Die Grenze gegen den nächsten Start bleibt.
7. **Regel 7a gilt unverändert.** Kein Lauf gegen das echte LINA aus der Agentenumgebung. Jede
   Messung in diesem Plan ist entweder ein Browser-Schritt im Terminal des Nutzers oder
   `bun run lina-fragen`.
8. **Kein Push auf `main`, solange ein Lauf aktiv ist** — der Containerwechsel beendet den per
   `docker exec` gestarteten Sync ohne Signal. Beim ersten Backfill dieser Größe ist das keine
   theoretische Gefahr: `SELECT lauf_id, status FROM sync.lauf ORDER BY lauf_id DESC LIMIT 1`.
