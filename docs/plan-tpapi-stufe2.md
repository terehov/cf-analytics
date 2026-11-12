# Plan: TPAPI Stufe 2 — alles, was LINAs offizielle Schnittstelle hergibt

**Stand:** 12.11.2026 · **Auftrag:** Eugene („alles laden, was uns fehlt, so weit zurück wie möglich,
für so viele Betriebe wie möglich") · **Vorgänger:** `plan-tpapi.md` (Stufe 1, Personal je Stunde,
`0149`/`0150`) · **Quelle und Messungen:** `lina-third-party-api.md`

Dieses Dokument ist der Vertrag für den Bau. Wer davon abweicht, schreibt die Abweichung in §8.

---

## 1. Was gemessen ist und was nicht

Gemessen (07.11. und 09.11.2026, Aposto Aalen und Wilma Wunder Nürnberg):

| Endpunkt | Form | Größe je Betrieb und Tag |
|---|---|---|
| `revenue/listdays` | Liste `{businessdate: <Unix-Sekunden>}` | Aalen 2.507 Tage (ab 22.10.2019), Nürnberg 362 (ab 03.11.2025) — **die Tiefe ist je Betrieb verschieden** |
| `revenue/journal?businessdate=` | Liste, 37 Felder: `ID, datum, refdate, art, artnr, preis, zahl, tisch, ust, vat_id, kellnernr, finanzweg, buchungsnr, tableheader_id, am_id, balance, terminal, masterkellnernr, teamnr, zcount, parentid, site, situation, sortorder, addinfo, rabatt_id, pricelevel_id, operationprofile_id, cancellationreason, captivesupplyreason, event_number, menucard_id, price_per_unit, financeextendedinfo_id, provision_free, course_price_print, coursedefentry_id` | 1.834 bzw. 2.329 Zeilen. Buchungsliste mit Saldo null; Betrag in `balance`; je Finanzweg auf den Cent gleich Bericht 97 |
| `revenue/journaltables?businessdate=` | Liste, 27 Felder: `tableheader_id, old_id, table_type, table_number, refdate, documentdate, transaction_number, accounting_type, debitor_id, parent_id, archiveparent_id, debitor_text, reservation_id, zcount, number_adults, number_kids, number_infants, renum, vat1sum, vat2sum, vat3sum, finanzweg, zahl, kellnernr, is_archive, zip_code, tablearea_id` | 240 bzw. 307 Bons |
| `personal/personalkostenprotag?businessdate=` | Liste, eine Zeile **je Person** ohne Kennung: `h_brutto, h_zuschl_25, h_zuschl_40, h_zuschl_50, brutto, lohnkosten` | 18–19 Zeilen |
| `merchandiseman/grosscategory` | Liste `id, number, name` | 62–68 Zeilen |

**Nicht gemessen** — und deshalb vor dem Bau der Lader zu messen (§3, Formprobe): die **Werte** der
Felder (Typ, Datumsformat, Vorzeichen, Leerwert), die übrigen zwölf `merchandiseman`-Listen,
`revenue/getforecastperday`, ob `personalkostenprostunde` und `personalkostenprotag` Tage liefern,
die älter als ein Jahr sind, und wie tief `listdays` bei jedem der 41 Betriebe reicht.

## 2. Entscheidungen

| # | Entscheidung | Begründung |
|---|---|---|
| S1 | **Zwei Schritte: 2a holt und sichert roh, 2b lädt nach `core`.** Der Abruf schreibt `raw.api_antwort` und eine Abrufzeile; ein getrennter Lader baut `core` aus `raw` — auch für Tage, die schon geholt sind | Die Feldwerte sind nicht gemessen. Mit dem Rohsatz geht kein Tag verloren, während die Lader entstehen (bei Betrieben mit einem Jahr Tiefe fällt jeden Tag einer hinten heraus). Regel 4: `core` ist aus `raw` neu aufbaubar — hier wird das der normale Weg, nicht der Notfall. Ein Lader, der sich irrt, kostet einen Neuaufbau, keinen zweiten Abruf |
| S2 | **Die Arbeitsliste ist `listdays`**, einmal je Betrieb und Nacht geholt → `core.tpapi_geschaeftstag`. Geholt wird jeder Tag daraus, den es für einen Endpunkt noch nicht gibt, neueste zuerst | „So weit zurück wie möglich" ist je Betrieb eine andere Zahl; LINA sagt sie selbst. Kein fester Horizont wie die 365 aus Stufe 1 |
| S3 | **Endpunkte:** `revenue/journal`, `revenue/journaltables`, `personal/personalkostenprotag`, `revenue/getforecastperday`, die dreizehn lesenden `merchandiseman/*`. `personalkostenprostunde` bekommt dieselbe Arbeitsliste, falls die Formprobe ältere Tage findet | Alles Lesende, was gebucht ist |
| S4 | **Nicht geholt:** `personal/acceptedworkingtimes`, `userdataperday`, `userdataperdaydelta`, `getPersonalData` | Zeilen je Person mit Arbeitszeiten und Stundenlohn. Dafür gibt es keinen Auftrag und keinen Zweck in den Auswertungen; `raw` ist append-only. Wer sie will, entscheidet das eigens |
| S5 | **`personalkostenprotag` wird vor `raw` verdichtet:** eine Zeile je Betrieb und Tag (Personenzahl, Summen der sechs Felder). Die Einzelzeilen kommen nirgends an | Ohne Namen, aber in kleinen Teams rückführbar (Stufe 1, D3). Die Summe ist die Zahl, die gebraucht wird: echte Stunden und Zuschläge neben den Personen je Stunde |
| S6 | **Journal und Bons gehen vollständig nach `raw` und `core`**, mit `kellnernr`, `debitor_text`, `addinfo`, `zip_code`. In `mart` (und damit im MCP-Zugang und in Karten) erscheinen `debitor_text`, `addinfo` und `zip_code` **nicht** | Kellnernummer und Debitor führen die Betriebsberichte 57/60/86 schon; neu ist nur der Weg. Freitext und Postleitzahlen von Gästen gehören nicht in eine Schicht, die Nutzereingaben als SQL ausführt |
| S7 | **Fenster (Tagesgeschäft, Phase A):** die letzten 3 Geschäftstage je Tagesendpunkt neu, Stunde bleibt bei 14. **Rückstand (Phase C, Nachladen):** alles Übrige, mit Obergrenze `TPAPI_NACHLADEN_JE_LAUF` und der Zeitgrenze des Nachladens | Ein abgeschlossener Kassentag ändert sich kaum (zu messen über `payload_hash`, `abrufe`); Schichten schon. Ein Rückstand von über 100.000 Aufrufen in Phase A hielte Phase B auf — dieselbe Lehre wie `0116` |
| S8 | **Tempo:** seriell, ein Aufruf je Sekunde, Tag außen, Betrieb innen; dazu eine **gleitende Grenze je Betrieb** (höchstens 60 Aufrufe in 15 Minuten) statt der festen 80 je Lauf | Dokumentiert sind 100 je Laden und 15 Minuten, Bounti und Sell & Pick lesen am selben Laden. Die feste Grenze je Lauf würde den Rückstand auf 80 Aufrufe je Betrieb und Nacht deckeln |
| S9 | **Zustand je Modul** in `sync.tpapi_zugang` (`personal`, `revenue`, `artikel` — die Spalte gibt es seit `0149`). „Not licensed" für ein Modul schaltet nur dieses Modul ab | Saarbrücken und BS Bier & Speisen haben nur Team Data; ihr 403 auf `revenue/*` ist ein Zustand, kein Fehler (D7) |
| S10 | **Die Betriebsberichte des Scrapers bleiben**, bis der Abgleich steht: Journal gegen Bericht 97 (Finanzwege), 96 (Bons), 92 (Rabatt), 39 (Storno), Umsatzbericht — je Betrieb und Tag als Prüfsicht. Erst danach wird über das Abschalten einzelner Berichte entschieden | Der Scraper deckt alle Betriebe und reicht bis 2018; die TPAPI 41 Betriebe. Zwei Quellen für dieselbe Zahl sind eine Gegenprobe, solange nicht beide in dieselbe Sicht laufen |
| S11 | **Artikelstamm als Momentaufnahme**, wöchentlich je Betrieb, vollständig roh; `core` erst nach der Formprobe | Stammdaten ohne Tagesbezug; ob die TPAPI mehr weiß als `articleApi:franchise` (Wareneinsatz je Artikel, `fixer_we`), sagt die Probe |

## 3. Die Formprobe (`bun run tpapi-formprobe`) — vor Schritt 2b

Ein lesendes Skript für das Terminal im Importer-Container (Regel 7a, IP-Bindung), keine Datenbank,
kein Wiederholen. Für zwei Betriebe (`--laden`, Vorgabe: die ersten zwei mit Journal) und einen Tag:

* je Endpunkt aus §1 und S3: HTTP-Status, Zeilenzahl, Bytes, und **je Feld** Typ(en), Anteil leer,
  Zahl verschiedener Werte, kleinster/größter Wert bzw. kürzeste/längste Länge, bis zu fünf
  Beispielwerte. Für `debitor_text`, `addinfo`, `zip_code`, `kellnernr`, `masterkellnernr` **keine
  Beispielwerte**, nur Typ, Länge und Füllgrad;
* `personalkostenprotag`: nur Zeilenzahl und Feldtypen, keine Werte je Zeile — die Summen;
* Alterstest: `personalkostenprostunde`, `personalkostenprotag` und `journal` für den ältesten Tag
  aus `listdays` und für einen Tag vor 400 Tagen;
* `getforecastperday` mit `from`/`to` in den Schreibweisen der Postman-Doku;
* mit `--alle`: `listdays` für jeden Schlüssel (ein Aufruf je Betrieb) — ältester und jüngster Tag,
  Zahl der Tage. Das ist die Rechnung für den Rückstand.

Ausgabe als Text auf die Konsole und als JSON-Datei; der Schlüssel erscheint nie.

## 4. Schritt 2a — holen und roh sichern (Migration `0151`)

* `core.tpapi_geschaeftstag (betrieb_key, geschaeftstag, gesehen_am)` aus `listdays`.
* `core.tpapi_abruf (betrieb_key, endpunkt, geschaeftstag, http_status, zeilen, payload_bytes,
  payload_hash, raw_id, abgerufen_am, abrufe, geaendert_am, core_stand)` — Primärschlüssel
  `(betrieb_key, endpunkt, geschaeftstag)`. `core_stand` ist die Version des Laders, mit der der
  Rohsatz nach `core` kam; `NULL` = noch nicht geladen. `geaendert_am` wird nur gesetzt, wenn sich
  der Hash ändert — die Messung für S7.
* `core.tpapi_stammabzug` für die tagfreien Listen (Artikelstamm, Prognose): Betrieb, Endpunkt,
  Abrufzeit, Zeilen, Hash, `raw_id`.
* `mart.tpapi_rueckstand` (Betrieb × Endpunkt: Tage laut `listdays`, geholt, fehlend, ältester
  geholter Tag), `mart.tpapi_abruf_stand` (je Endpunkt: geholt, nach `core` geladen, Bytes),
  `mart.tpapi_zugang` um die Module erweitert. Prüfzeilen: Rückstand fällt nicht mehr; Rohsätze ohne
  `core` älter als 48 h (erst ab 2b scharf).
* `sync.quelle`: je Endpunkt ein Eintrag (Regel 10).
* Importer: ein Endpunktregister in `src/tpapi/` (Pfad, Modul, Art Tag/Stamm, Fenstertage,
  Verdichtung vor `raw`); der Nachlauf in Phase A holt `listdays` und die Fenster, ein zweiter
  Einstieg in Phase C den Rückstand. Stufe 1 bleibt, wie sie ist.

## 5. Schritt 2b — `core`, `mart`, Katalog, Karten (nach der Formprobe)

`core.kassenjournal` (partitioniert nach Geschäftstag), `core.kassenbon`,
`core.personalkosten_tag`, `core.umsatzprognose_tag`, Artikelstamm; Lader `raw → core` über
`core_stand`; Abgleichsichten nach S10; `mart`-Sichten (Stunde × Artikel × Sparte, Gäste je Bon,
Kellner, Storno und Nachlass je Position, Arbeitsstunden und Zuschläge je Tag), Fallstricke, Karten.
Die Einzelheiten werden festgelegt, wenn die Formprobe vorliegt — vorher wären sie geraten.

## 6. Was der Bau nicht erreichen kann

* **Mehr Betriebe** gibt es nur über Buchungen und Schlüssel, nicht über Code: 22 laufende Betriebe
  ohne Daten-API (Daniel zieht die ISP nach; danach `bun run tpapi-schluessel --anlegen`).
  Geschlossene und insolvente Betriebe mit Buchung (Besitos MG, Enchilada Bruchsal) überspringt das
  Schlüsselskript bisher — ihre Historie wäre mit einem Schlüssel zu haben.
* **BWA und SuSa** brauchen die nicht gebuchte *BWA Data API*.
* **Vor dem Kassenstart** eines Betriebs in LINA gibt es nichts; dort bleibt der Scraper mit
  Kassenblatt und Konzernberichten.

## 7. Abnahme

Schritt 2a: Migration auf einem Klon von `0150`, Leseprobe als `mcp_leser`; Tests gegen die Attrappe
(Fenster, Rückstand, Grenze je Betrieb, 403 je Modul, 429, Verdichtung von `personalkostenprotag`
vor `raw`); `src/sync/phasen.test.ts` grün; Typecheck; kein Schlüssel in Log, `raw` oder Fehlertext.

## 8. Abweichungen und Ist-Stand

*(wird beim Bau gefüllt)*
