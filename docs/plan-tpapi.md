# Plan: Personal je Stunde aus LINAs Third-Party-API (TPAPI)

Stand 09.11.2026. Entscheidungen D1–D8 von Eugene am 09.11.2026 freigegeben („Lege mit der
Implementierung los“). Umsetzung mit Migration `0149` und `src/tpapi/`; der Ist-Stand steht in
Abschnitt 9, sobald er gemessen ist.

Ziel: Melanies Frage — *wie viele Leute stehen sonntags ab 18 Uhr bei Wilma Wunder, und was
setzen sie je Person um* — aus der Datenbank beantworten, mit **gemessenen Personen und
Lohnkosten je Stunde** statt einer Ableitung aus Umsatz und Effektivität. Quelle ist die
offizielle Schnittstelle (`docs/lina-third-party-api.md`), nicht der Scraper.

## 1. Was die Quelle liefert (gemessen, nicht angenommen)

Gemessen am 07. und 09.11.2026 im Importer-Container (`bun run tpapi-probe`), Aposto Aalen und
Wilma Wunder Nürnberg, dazu Ratskeller Saarbrücken als Betrieb mit nur Team Data API.

| Endpunkt | Antwort | Befund |
|---|---|---|
| `GET /extern/personal/personalkostenprostunde?businessdate=dd.mm.yyyy` | `{ eff: {"8": 6, "9": 12, …}, kost: {"8": 65.18, …}, kostUser: {…} }` | `eff` = Personen in der Stunde, `kost` = Lohnkosten in EUR (Gleitkomma, `161.42000000000002`). **`kostUser` ist je Person** und wird nicht gespeichert — auch nicht in `raw`. Stundenschlüssel 0–23 als Text; fehlende Stunden fehlen, sind nicht 0 |
| `GET /extern/personal/personalkostenprotag?businessdate=…` | Liste je Person: `h_brutto`, `h_zuschl_25/40/50`, `brutto`, `lohnkosten` — ohne Namen | **Nicht in Stufe 1** (Abschnitt 7): Zeilen je Person ohne Kennung sind in kleinen Teams rückführbar; ob sie aggregiert in `raw` dürfen, entscheidet Eugene |
| `GET /extern/revenue/store` | Name, Ort, Schlüsseldaten des Betriebs | Nur mit Sales Data API; sonst **403 `Module 'Revenue' not licensed`** — auch `getlimit` |
| Ohne Buchung eines Moduls | HTTP 403 `{"status":"error","message":"Module '…' not licensed"}` | **Zustand des Betriebs, kein Fehler.** Nicht wiederholen, sichtbar machen |
| Limit | dokumentiert 100 Anfragen je Laden und 15 Minuten, HTTP 429 darüber | `getlimit` stand bei Nürnberg vor unserem zweiten Aufruf auf 7 — **das Limit zählt womöglich alle Anbieter des Ladens** (Bounti, Sell & Pick haben dort Schlüssel). Nicht entschieden; der Importer verlässt sich nicht auf `getlimit` |
| Historie | `listdays`: 03.11.2025–08.11.2026 | **Rund ein Jahr.** Jeder Tag, den wir nicht holen, geht verloren — der Rückstand ist deshalb kein Komfort, sondern eine Frist |

**Ein Schlüssel gilt für genau einen Betrieb** (`docs/lina-third-party-api.md`, „Erste Messung“).
41 Schlüssel stehen seit 09.11.2026 in `LINA_API_SCHLUESSEL` (JSON `encId → Schlüssel`, nur in
Dokploy und in Eugenes lokaler `.env`, Entscheidung 09.11.2026 in `entscheidungen.md`). Betriebe
ohne Buchung (sieben laufende Enchilada, Schlager Cafe, die meisten Deutschen Konzepte) haben
keinen Schlüssel und bekommen **keine** Personaldaten — Daniel zieht die ISP nach
(`offene-punkte.md`).

**Der Geschäftstag.** `businessdate` ist LINAs Geschäftstag (08:00 bis 07:59 des Folgetags).
Die Stunden 0–7 der Antwort für Tag D gehören zu D — genau wie im Stundenbericht seit
`0138` (KORREKTUR 11). Der Lader rechnet **nichts** um; die Gegenprobe in Abschnitt 5 misst,
ob das stimmt.

## 2. Entscheidungen

| Nr. | Entscheidung | Begründung |
|---|---|---|
| **D1** | Stufe 1 holt **nur `personalkostenprostunde`**. Journal, Tische und Tagesbericht je Person sind Stufe 2 (Abschnitt 7) | Melanies Frage braucht genau diesen Endpunkt. Journal und Tische überschneiden sich mit den Betriebsberichten 96/97 — vor dem Bau gehört der Abgleich, sonst holen wir dieselben Zahlen zweimal |
| **D2** | Die TPAPI ist ein **eigener Dienst in Phase A** (~~sechster~~ fünfter Eintrag in `dienste`, `src/sync.ts`), mit eigenem Client und eigenem Takt | Anderer Host (`api.lina.de`), eigener Zugang je Betrieb mit dokumentiertem Limit, keine Sitzung des Scrapers. Die Ladenakte bekam keine eigene Spur, weil sie **derselbe** Zugang ist — das hier ist ein anderer. Regel 3 gilt trotzdem: Takt, Verteilung über die Betriebe, Stopp bei 429 |
| **D3** | Jede Antwort geht nach **`raw.api_antwort`** (`quelle = 'tpapi'`), **ohne `kostUser`** | Regel 4: `core` muss aus `raw` neu aufbaubar sein. `kostUser` sind Lohnkosten je Person — personenbezogen; `raw` ist append-only, was hineinkommt, bleibt. Vorbild: die Schlüsseltabelle des Stammdatenblatts wird vor `raw` entfernt (`src/ladenakte/laden.ts`) |
| **D4** | **Rollierendes Fenster** (`TPAPI_FENSTER_TAGE`, 14) jede Nacht **und** Backfill mit Obergrenze (`TPAPI_BACKFILL_JE_LAUF`, 2.000 Betrieb-Tage, neueste zuerst) bis `TPAPI_HISTORIE_TAGE` (365). **Kein Handbefehl** | Schichten werden nach dem Tag noch genehmigt und korrigiert — ein einmal geholter Tag ist nicht endgültig. Der Backfill hat eine Frist (ein Jahr Historie); 41 × 365 ≈ 15.000 Abrufe sind in acht Nächten durch |
| **D5** | **Ein leerer Tag wird als geholt vermerkt** (`core.personalkosten_stunde_abruf`), nicht jede Nacht neu geholt | Sonst zöge der Backfill Saarbrückens leere Tage bis in alle Ewigkeit. Im Fenster wird er trotzdem neu gefragt — dort kann noch etwas kommen |
| **D6** | **Takt und Verteilung statt `getlimit`:** `TPAPI_TAKT_MS` (1.000) zwischen zwei Aufrufen, Backfill **tagweise über alle Betriebe** (äußere Schleife Tag, innere Betrieb), höchstens `TPAPI_AUFRUFE_JE_BETRIEB` (80) je Betrieb und Lauf. **HTTP 429 beendet den Betrieb für diesen Lauf** (`zustand = 'gebremst'`), nicht den Dienst | `getlimit` ist bei Team-only-Betrieben nicht aufrufbar (403) und zählt womöglich fremde Anbieter mit. Bei 41 Betrieben trifft die innere Schleife jeden Betrieb etwa alle 41 s — rund 22 Aufrufe je 15 Minuten, weit unter 100, selbst wenn Bounti und Sell & Pick mitzählen |
| **D7** | **403 „not licensed“ ist ein Zustand, kein Fehler:** `sync.tpapi_zugang.zustand = 'nicht_lizenziert'`, sieben Tage nicht erneut gefragt, sichtbar in `mart.tpapi_zugang`. 401/403 ohne „not licensed“ → `'abgewiesen'`, in diesem Lauf nicht wiederholt (Regel 7) | Ein Alarm, der jede Nacht schlägt, wird abgeschaltet; ein Betrieb, der still verschwindet, fällt nicht auf. Beides vermeidet die Tabelle |
| **D8** | Alle Sichten **live**, keine Materialisierung | 41 Betriebe × 365 Tage × 24 Stunden ≈ 360.000 Zeilen je Jahr — ein Primärschlüssel-Index reicht. Materialisiert wird erst, wenn eine Messung es verlangt (`0142` als Vorbild) |

## 3. Datenmodell (Migration `0149_tpapi_personal.sql`)

Namen nach der Konvention: LINA-Tabellen heißen nach dem Bericht bzw. Endpunkt.
`core.personalkosten` (Scraper, `getPersonalkosten`) gibt es schon; die neuen Tabellen stellen
sich daneben.

### 3.1 `core.personalkosten_stunde` — die Fakten

| Spalte | Typ | Bedeutung |
|---|---|---|
| `betrieb_key` | integer FK `core.betrieb` | |
| `geschaeftstag` | date | LINAs `businessdate`, **unverändert** (Abschnitt 1) |
| `stunde` | smallint 0–23 | Schlüssel aus `eff`/`kost` |
| `personen` | numeric(6,2) | `eff[stunde]`; bisher ganzzahlig gemessen, numeric für den Fall halber Stunden |
| `personalkosten` | numeric(10,2) | `kost[stunde]`, **auf Cent gerundet** (`161.42000000000002` → `161.42`) |
| `raw_id` | bigint | |
| `geladen_am` | timestamptz NOT NULL DEFAULT now() | Zeitspalte für `sync.quelle` |

PK `(betrieb_key, geschaeftstag, stunde)`. Eine Stunde, die in der Antwort fehlt, hat **keine
Zeile** (nicht 0): der Unterschied zwischen „niemand eingeplant“ und „nicht gefragt“ steht in
der Abruf-Tabelle. Steht eine Stunde nur in `kost`, nicht in `eff` (oder umgekehrt), wird die
fehlende Seite NULL — nicht erfunden. Ein erneuter Abruf **ersetzt** den Tag vollständig
(DELETE je Betrieb und Tag, dann INSERT): eine Stunde, die LINA heute nicht mehr liefert,
darf nicht aus dem Vorabruf stehen bleiben.

### 3.2 `core.personalkosten_stunde_abruf` — was gefragt wurde

| Spalte | Typ | Bedeutung |
|---|---|---|
| `betrieb_key`, `geschaeftstag` | PK | |
| `stunden` | smallint | Zahl der gelieferten Stunden (0 = leer) |
| `personenstunden` | numeric(8,2) | Σ personen |
| `personalkosten` | numeric(12,2) | Σ personalkosten |
| `raw_id` | bigint | |
| `abgerufen_am` | timestamptz | letzter Abruf |
| `abrufe` | smallint | wie oft geholt |

Die Arbeitsliste des Backfills (`mart.personal_rueckstand`) ist „Betrieb mit Schlüssel × Tag
im Horizont **ohne** Abrufzeile“. Ein leerer Tag zählt als erledigt (D5).

### 3.3 `sync.tpapi_zugang` — wer kann was

| Spalte | Typ | Bedeutung |
|---|---|---|
| `betrieb_key` | integer FK | |
| `modul` | text | `'personal'` in Stufe 1; Stufe 2 bringt `'revenue'`, `'artikel'` |
| `enc_id` | text | der Schlüssel der Umgebung, nie der Wert |
| `schluessel_vorhanden` | boolean | steht die `enc_id` in `LINA_API_SCHLUESSEL`? |
| `zustand` | text CHECK | `ok` · `nicht_lizenziert` · `abgewiesen` · `gebremst` · `fehler` · `ohne_schluessel` |
| `zuletzt_gefragt_am` | timestamptz | letzter Aufruf, egal mit welchem Ausgang |
| `zuletzt_erfolg_am` | timestamptz | letzte 200er-Antwort |
| `letzter_http` | integer | |
| `letzter_fehler` | text | gekürzte Meldung, nie der Schlüssel |
| `aktualisiert_am` | timestamptz | |

PK `(betrieb_key, modul)`. Der Nachlauf legt zu Beginn je Schlüssel eine Zeile an (Betrieb über
`core.betrieb.enc_id`); eine `enc_id` ohne Betrieb wird geloggt. Verschwindet ein Schlüssel aus
der Umgebung, wird `schluessel_vorhanden = false`, `zustand = 'ohne_schluessel'`.

### 3.4 `sync.quelle`

Eintrag `tpapi:personalkosten_stunde` in `src/sync/quellen.ts` (System `'tpapi'` — den Typ
`Quelle.system` **und** einen etwaigen CHECK auf `sync.quelle.system` erweitern), gemessen an
`core.personalkosten_stunde.geladen_am`, Merker `tpapi_personal`, Kadenz 48 h,
`erwartet: Object.keys(config.TPAPI_SCHLUESSEL).length > 0`. Der Merker trägt wie bei
`yext_analytics` (`0130`) `{ ok, fehler, beendet_am, betriebe, abrufe }`.

### 3.5 Sichten in `mart` (alle für `mcp_leser` lesbar, Leseprobe in der Migration)

| Sicht | Körnung | Spalten (mindestens) |
|---|---|---|
| `mart.personal_stunde` | Betrieb × Geschäftstag × Stunde | `betrieb_key, betrieb, konzept, geschaeftstag, monat, wochentag, stunde, personen, personalkosten, umsatz_netto` (LEFT JOIN `core.zeitzonenbericht_stunde`), `umsatz_je_person` (NULL bei 0 Personen), `personalkostenquote_pct` (NULL bei 0 Umsatz, **Prozentzahl**) |
| `mart.personal_zeitfenster` | Betrieb × Geschäftstag × Fenster (`manual.zeitfenster`, wie `mart.umsatz_zeitfenster`) | `fenster, reihenfolge, ueber_mitternacht, personenstunden, personalkosten, umsatz_netto, umsatz_je_personenstunde, personalkostenquote_pct, stunden_besetzt` |
| `mart.personal_tag` | Betrieb × Geschäftstag | `personenstunden, personalkosten, stunden_besetzt, erste_stunde, letzte_stunde` (in Geschäftstag-Reihenfolge, `(stunde + 16) % 24`), `umsatz_netto` (aus `core.umsatzbericht_tag`, Gesamtzeile), `umsatz_je_personenstunde, personalkostenquote_pct` |
| `mart.personal_rueckstand` | Betrieb × fehlender Tag | `betrieb_key, enc_id, betrieb, geschaeftstag, zugang_zustand` — nur Betriebe mit `schluessel_vorhanden` und `zustand <> 'nicht_lizenziert'` (ihr Rückstand ist nicht abzuarbeiten, die Zahl ginge nie auf 0), nur Tage `current_date - 365 … current_date - 1` ohne Abrufzeile (365 als Konstante in der Sicht, zusammen mit `TPAPI_HISTORIE_TAGE` zu ändern). **Die Zahl muss von Nacht zu Nacht fallen** |
| `mart.personal_stunde_pruefung` | Betrieb × Geschäftstag | **Zwei Proben.** `befund`: `personalkosten_tpapi_monat` (TPAPI-Summe vom Monatsersten bis zum Tag) gegen `personalkosten_aus_quote` = `core.personalkosten.pek_gesamt / 100 × Tagesumsatz` — ~~Tageskosten~~ **LINAs `pek` je Tag ist seit Monatsanfang aufgelaufen** (`fehlerkatalog.md`; nachgemessen 09.11.2026 auf dem Klon: Median Tag 1 2.053 €, Tag 15 16.664 €, Tag 28 31.831 €), deshalb der Monatsvergleich und der Wert `monat unvollstaendig`, wenn ein Tag davor fehlt. `befund_stunden`: `personenstunden_tpapi` gegen `Tagesumsatz / eff_gesamt` — **das ist die Nachtprobe**, ob die Stunden 0–7 am richtigen Tag stehen (`eff` ist je Tag nicht aufgelaufen). Werte je Probe: `ok` ≤ 5 %, `weicht ab`, `ohne vergleich`, `leer` |
| `mart.tpapi_zugang` | Betrieb (alle 141) | `betrieb, konzept, status` (aus `mart.betrieb_status`), `schluessel` (bool), `zustand, zuletzt_gefragt, zuletzt_erfolg, letzter_fehler, tage_geladen, aeltester_tag, juengster_tag, rueckstand_tage, befund`: `ok` · `operativ ohne Schluessel` · `Schluessel ohne Zulauf` (48 h) · `nicht lizenziert` · `abgewiesen` · `gebremst` · `nicht operativ` |

Drei Zeilen in `mart.pruefung_uebersicht` (Muster: DO-Block mit `pg_get_viewdef`, `0137` §5):

1. `TPAPI: operativer Betrieb ohne Schluessel` — geprüft = operative Betriebe, auffällig = ohne Schlüssel
2. `TPAPI: Schluessel ohne Zulauf (48 h)` — geprüft = Betriebe mit Schlüssel, auffällig = `zuletzt_erfolg` älter als 48 h oder NULL, **außer** `nicht_lizenziert`
3. `Personal je Stunde: Tageskosten weichen von LINAs Quote ab (60 Tage)` — aus `mart.personal_stunde_pruefung`, `geschaeftstag >= current_date - 60 AND < current_date - 8`

### 3.6 MCP-Katalog

`SELECT mcp.achsen_ableiten()`, Körnung je Sicht (`UPDATE mcp.sicht … koernung, thema, summen_erlaubt`;
Thema `personal`, Prüfsichten `import`, `summen_erlaubt = false` für Prüfsichten und Zugang),
`mcp.koernung_in_kommentare()`, `mcp.rechte_auffrischen()`, Leseprobe als `mcp_leser`.

Fallstricke (nur Regelarten, die `mcp/src/pruefen.ts` kennt: `deutung`, `sichten_mischen`):

| Schlüssel | Art | Schwere | Sicht(en) | Hinweis (Kern) |
|---|---|---|---|---|
| `personal_nur_mit_schluessel_{stunde,zeitfenster,tag}` (eine `deutung`-Zeile gilt für genau eine Sicht) | deutung | warnung | `mart.personal_stunde`, `mart.personal_zeitfenster`, `mart.personal_tag` | Personaldaten gibt es nur für Betriebe mit TPAPI-Schlüssel (41 am 09.11.2026). Ein Betrieb, der fehlt, hat nicht null Personal — `mart.tpapi_zugang` sagt, wer fehlt und warum |
| `personal_leer_ist_nicht_null_{stunde,zeitfenster,tag}` | deutung | warnung | dieselben drei | Ein Tag ohne Stunden heißt: keine Schichten in LINA geplant (z. B. Betriebe, die nur die Team Data API gebucht haben), nicht „niemand da“. Erst `stunden_besetzt`/`mart.personal_tag` ansehen |
| `personal_tpapi_gegen_bwa` | sichten_mischen | warnung | a: die drei Personal-Sichten; b: `mart.personal_bereich_monat`, `mart.round_table_monat` | Lohnkosten aus der Personalplanung je Stunde sind nicht die Personalkosten der BWA — andere Basis, anderer Zeitpunkt. Nicht gegeneinander rechnen, Quoten nicht vergleichen |
| `personal_historie_ein_jahr_{stunde,tag}` | deutung | ~~hinweis~~ warnung (`mcp.fallstrick.schwere` kennt nur `sperre`/`warnung`) | `mart.personal_stunde`, `mart.personal_tag` | LINA liefert rund ein Jahr zurück; vor November 2025 gibt es nichts, und der Backfill läuft seit 10.11.2026 (`mart.personal_rueckstand`) |

## 4. Importer (`src/tpapi/`)

```
src/tpapi/client.ts     TpapiClient: Schlüssel je enc_id aus config.TPAPI_SCHLUESSEL, Header apikey,
                        Takt, Klassifikation (ok / nicht_lizenziert / abgewiesen / gebremst / fehler),
                        Schlüssel nie in Fehlermeldungen (sauber())
src/tpapi/laden.ts      Antwort → raw (ohne kostUser) → core.personalkosten_stunde (+ _abruf), Rundung
src/tpapi/nachlauf.ts   tpapiNachlauf(): Zugang spiegeln, Fenster, Backfill, Merker; wirft nie,
                        gibt 'ok' | 'teilweise' | 'uebersprungen' zurück
src/tpapi/mock.ts       Attrappe (Bun.serve) für die Tests: 200 mit eff/kost/kostUser, 403 not licensed,
                        401 bei fremdem Schlüssel, 429 einmal, leerer Tag
```

Ablauf von `tpapiNachlauf()`:

1. Ohne Schlüssel in der Umgebung: `log.info('tpapi nicht eingerichtet')`, zurück `'uebersprungen'`.
   (`sync.quelle` führt die Quelle dann als `nicht erwartet`.)
2. `sync.tpapi_zugang` spiegeln: je Schlüssel eine Zeile, Betrieb über `core.betrieb.enc_id`;
   fehlende Betriebe loggen; weggefallene Schlüssel auf `ohne_schluessel`.
3. **Fenster:** für jeden Tag `current_date - 1 … current_date - TPAPI_FENSTER_TAGE`, für jeden
   Betrieb mit Schlüssel und `zustand <> 'nicht_lizenziert'` (oder älter als 7 Tage): holen, laden.
4. **Backfill:** `mart.personal_rueckstand`, sortiert `geschaeftstag DESC, betrieb_key`, höchstens
   `TPAPI_BACKFILL_JE_LAUF` Zeilen; dieselbe innere Reihenfolge (Tag außen, Betrieb innen).
5. Je Aufruf: `TPAPI_TAKT_MS` warten; 429 → Betrieb für diesen Lauf aus, `gebremst`; 403 „not
   licensed“ → `nicht_lizenziert`, Betrieb aus; 401/403 sonst → `abgewiesen`, Betrieb aus, kein
   zweiter Versuch; 5xx/Netz → `fehler`, Betrieb aus (nächste Nacht wieder); mehr als
   `TPAPI_AUFRUFE_JE_BETRIEB` → Betrieb aus, kein Zustand.
6. Merker `tpapi_personal` schreiben: `{ ok, fehler, beendet_am, betriebe, abrufe, geladen, leer }`.
   `ok = false` nur, wenn **kein** Betrieb erfolgreich war.
7. Rückgabe `'teilweise'`, wenn mindestens ein Betrieb mit Schlüssel nicht `ok` endete.

`raw.api_antwort`: `quelle = 'tpapi'`, `endpunkt = 'tpapi:personalkostenprostunde'`,
`betrieb_enc_id`, `zeitraum_von = zeitraum_bis = businessdate`, `parameter = {businessdate}`,
`payload` ohne `kostUser`, `lauf_id` = der laufende Lauf (`SELECT max(lauf_id) FROM sync.lauf
WHERE status = 'laeuft'`, sonst NULL). Auch 403/429 werden roh gesichert (kleine Antworten,
und sie sind der Beleg für den Zustand).

Konfiguration (`src/config.ts`, geprüft beim Start):

| Variable | Vorgabe | Bedeutung |
|---|---|---|
| `LINA_API_SCHLUESSEL` | – | JSON `{ "<encId>": "<Schlüssel>" }`; Schlüssel 40 Hex, Werte nicht leer; ungültiges JSON bricht den Start ab. Im Code als `config.TPAPI_SCHLUESSEL: Record<string, string>` (leer, wenn nicht gesetzt). **Nie loggen** — `konfigZumLoggen` nennt nur die Anzahl |
| `LINA_API_BASIS` | `https://api.lina.de` | |
| `TPAPI_FENSTER_TAGE` | 14 | rollierendes Fenster |
| `TPAPI_BACKFILL_JE_LAUF` | 2000 | Betrieb-Tage je Nacht, 0 schaltet den Backfill ab |
| `TPAPI_HISTORIE_TAGE` | 365 | Horizont des Rückstands |
| `TPAPI_TAKT_MS` | 1000 | Pause zwischen zwei Aufrufen |
| `TPAPI_AUFRUFE_JE_BETRIEB` | 80 | Obergrenze je Betrieb und Lauf |

`src/sync.ts`: `['tpapi', tpapiNachlauf()]` als ~~sechster~~ fünfter Dienst in `dienste`;
`src/sync/phasen.test.ts` bekommt den Eintrag. (Zählung: Import plus fünf Dienste; siehe §9.) `src/tpapi_probe.ts` bleibt, wie sie ist.

## 5. Was nach der ersten Nacht zu messen ist (10.11.2026)

1. `SELECT befund, count(*) FROM mart.tpapi_zugang GROUP BY 1` — Erwartung: 41 × `ok` oder
   `nicht lizenziert` (BS Bier & Speisen, Saarbrücken: Personal ist lizenziert, also `ok`),
   die übrigen `operativ ohne Schluessel` oder `nicht operativ`.
2. `SELECT befund_stunden, count(*) FROM mart.personal_stunde_pruefung WHERE geschaeftstag >= current_date - 14 GROUP BY 1`
   — **die Nachtprobe.** Liegt `weicht ab` systematisch bei Betrieben mit Nachtgeschäft, stehen
   die Stunden 0–7 am falschen Tag; dann KORREKTUR in `lina-api-korrekturen.md`, nicht raten.
   Dazu `befund` (Monatssumme gegen die aufgelaufene Quote) — erst aussagekräftig, wenn der
   Monat vollständig geholt ist (`monat unvollstaendig` verschwindet mit dem Backfill).
3. `SELECT count(*) FROM mart.personal_rueckstand` — muss jede Nacht um ~2.000 fallen; nach acht
   Nächten 0.
4. Saarbrücken an einem Werktag: liefert `eff` Stunden? Sonst „plant seine Schichten nicht in
   LINA“ in `offene-punkte.md`.
5. `SELECT * FROM mart.quelle_zulauf WHERE quelle LIKE 'tpapi%'` — `ok`.
6. Melanies Frage: `SELECT * FROM mart.personal_zeitfenster WHERE konzept = 'Wilma Wunder' AND extract(isodow FROM geschaeftstag) = 7 AND geschaeftstag >= current_date - 30` — und die Antwort an Melanie und Daniel nachziehen.

## 6. Dokumentationspflicht (im selben Commit)

`datenherkunft.md` (neue Quelle, Körnung, was sie nicht sagt), `datenmodell.md` (3.1–3.3),
`importer.md` (sechster Dienst, Takt, Zustände), `metabase.md` (Sichten, Fallen),
`metabase-sichtbarkeit.md` (neue `core`-Tabellen nur in Detailansichten), `entscheidungen.md`
(D1–D8), `lina-third-party-api.md` (Ist-Stand), `offene-punkte.md` (Stufe 2, `personalkostenprotag`,
`getlimit`-Frage, Saarbrücken), `AGENTS.md` (Docs-Tabelle, Migrationstabelle, `src/`-Baum,
Phase A „sechs Dienste“). Nach dem Deploy und der ersten vollen Nacht: MCP-Katalogabzug neu
ziehen (`cd mcp && bun run katalog:abzug` gegen die Produktion, Weg wie am 29.10.2026).

## 7. Stufe 2 — nicht gebaut, bewusst

| Was | Warum nicht jetzt | Was vorher zu klären ist |
|---|---|---|
| `personalkostenprotag` (Stunden, Zuschläge, Brutto, Lohnkosten je Person und Tag) | Zeilen je Person ohne Kennung — in kleinen Teams rückführbar. `raw` ist append-only | Eugene: dürfen die Zeilen **aggregiert** (eine Zeile je Betrieb und Tag) in `raw`? Dann `core.personalkosten_tag` mit Zuschlagsstunden — die Zahl, die die Lohnbuchhaltung meint |
| `revenue/journal`, `journaltables` (Bons, Positionen, Gäste je Tisch) | Überschneidung mit Betriebsberichten 96/97/113; 2.329 Zeilen je Betrieb und Tag | Abgleich Journal gegen `core.bon`/`core.finanzweg_tag` an drei Betrieben; dann entscheiden, ob die TPAPI den Scraper dort **ersetzt** |
| Artikelstamm (`merchandiseman/*`) | `core.artikel` kommt aus dem Artikelverkaufsbericht und `articleApi:franchise`; beide laufen | Ob die TPAPI mehr weiß (Warengruppenhistorie?) — eine Probe |
| BWA (`bwa/*`) | Nicht lizenziert (403 bei allen) | Buchung durch die Gruppe — Daniel |

## 8. Abnahme (Fable, vor dem Commit)

- `bun run typecheck` grün; `bun test` ohne neue Fehler (Vergleich gegen den Stand vor der Änderung);
  `src/sync/phasen.test.ts` kennt den sechsten Dienst.
- Migration `0149` läuft auf einem Klon mit Stand `0148` durch, inklusive Leseprobe als `mcp_leser`;
  `SELECT count(*) FROM mart.personal_rueckstand` liefert auf dem Klon 0 (keine Schlüssel) und mit
  einem gesetzten Test-Schlüssel `365 × Betriebe`.
- Gegen die Attrappe: ein Lauf holt Fenster und Backfill, schreibt `raw` ohne `kostUser`, rundet auf
  Cent, vermerkt leere Tage, stoppt einen Betrieb bei 429 und bei 403 „not licensed“, loggt nie
  einen Schlüssel.
- `mcp/test` grün (`cd mcp && bun test`); jede neue Sicht hat eine Körnung.
- Kein Aufruf gegen das echte LINA aus der Agentenumgebung (Regel 7a); der erste echte Lauf ist
  der Nachtlauf nach dem Deploy.

## 9. Ist-Stand

**Gebaut am 09.11.2026, noch nicht deployt, nie gegen das echte LINA gelaufen** (Regel 7a). Migration
`0149`, `src/tpapi/` (`client`, `form`, `laden`, `nachlauf`, `mock`), Eintrag
`tpapi:personalkosten_stunde` in `src/sync/quellen.ts`, die `TPAPI_*`-Variablen in `src/config.ts`,
`metabase/karten-personal.ts` und der Reiter „Besetzung je Stunde" in `db_personal`. Getestet
(nachgemessen 09.11.2026): Migration auf dem Klon `lina_tpapi_1109` (Stand `0148` → `0149`) im
ersten Versuch durch, Leseprobe als `mcp_leser` eingeschlossen; Karten-Tests 616 pass;
TPAPI-Tests gegen die Attrappe mit Datenbank 29 pass.

**Abweichungen vom Plan, die der Plan nicht kannte** (Begründungen: `entscheidungen.md`, Eintrag
vom 09.11.2026 „Personal je Stunde aus der TPAPI"):

1. **Die Prüfsicht vergleicht den Monat, nicht den Tag** — `pek_gesamt` im Tagesabruf ist seit
   Monatsanfang aufgelaufen (§3.5, `fehlerkatalog.md`). `befund` setzt die TPAPI-Monatssumme gegen
   die aufgelaufene Quote (Wert `monat unvollstaendig`, solange ein Tag davor fehlt); die
   eigentliche Nachtprobe ist `befund_stunden` (Personenstunden gegen `Umsatz / eff_gesamt`).
2. **Der Dienst ist der fünfte Eintrag in `dienste`, nicht der sechste** — `yext`, `bounti`,
   `wetter`, `handpflege`, `tpapi`. „Sechs" stimmt nur, wenn man den Import mitzählt. Der Pool
   (`max: 8`) trägt jetzt zwei Worker-Spuren plus fünf Dienste = sieben.
3. **Der MCP-Katalog kennt kein `hinweis`** — `mcp.fallstrick.schwere` erlaubt `sperre`/`warnung`;
   `deutung` gilt je Sicht, daher Schlüssel mit Endung `_stunde`/`_zeitfenster`/`_tag`.
   `mart.personal_rueckstand` lässt `nicht_lizenziert` weg und hat `zugang_zustand`;
   `mart.personal_zeitfenster` geht von den abgerufenen Tagen aus (Fenster ohne Personal stehen
   mit `stunden_besetzt = 0` da).

**Was nach der ersten Nacht zu messen ist:** Abschnitt 5, unverändert. Dazu die Frage, ob die
Lastmessung hält (synthetisches Jahr, 41 Betriebe, 284.335 Stunden, 09.11.2026:
`mart.personal_stunde` je Betrieb und Monat 3,4 ms, Melanies Filter auf `personal_zeitfenster`
5 ms, `personal_stunde_pruefung` seit Juli 89 ms, `tpapi_zugang` 33 ms) mit echten Daten gilt.
Danach den MCP-Katalogabzug neu ziehen (`AGENTS.md`, Dokumentationspflicht).

