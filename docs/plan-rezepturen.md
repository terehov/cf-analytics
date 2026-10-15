# Plan: Rezepturen aus FoodNotify

Stand 15.10.2026, **Entwurf — wartet auf Eugenes Entscheidung zu den offenen Fragen unten.**

Ziel: die Frage „In welchen Rezepten steckt Artikelnummer X (z. B. 300203)?" aus der Datenbank
beantworten, auch indirekt über Halbfabrikate („300203 steckt in Pizza X über Teig Y"). Quelle ist
**FoodNotify**, nicht LINA (harte Regel 5). Bestehende Kennzahlen (`mart.deckungsbeitrag_warengruppe`,
Round Table, `fixer_we`) bleiben unberührt — dieser Schritt ergänzt nur.

## 1. Was die Quelle liefert (belegt, nicht angenommen)

Belegt an 2.111 Enchilada-Rezepten aus dem Einzelabzug vom 14./15.09.2026 (`src/rezepte.ts`,
`belege/coyacan/rezepte/`, lokal) und `docs/foodnotify-api-inventar.md` §3.

| Pfad | Inhalt |
|---|---|
| `GET /api/recipes?page=N` | Liste, 25 je Seite fest, `{data, pagination}`. **Nicht stabil sortiert** (`createdAt`-Gleichstände: 21 Doppelte an Seitengrenzen) und **keine vollständige Aufzählung** (56 Rezepte nur über Verweise gefunden) |
| `GET /api/recipes/{id}` | Kopf: `id`, `name`, `createdAt`, `groups[]`, `tags[]`. Kein Änderungsdatum, kein Status |
| `GET /api/recipes/{id}/ingredients` | Zutaten (Felder unten) |
| `GET /api/recipes/{id}/meta` | `weight.total`, `perPerson`, `portionSize`, `portionSizeUnit`, `loss`, Allergene, Nährwerte |

Zutatenposition:

| Feld | Bedeutung | Messung (7.452 Zeilen) |
|---|---|---|
| `kind` | `ingredient` / `sub_recipe` / `product_group` | 3.614 / 1.983 / 1.855 |
| `artikelId` | **Lieferanten-Artikelnummer** (String) | leer bei allen Unterrezepten, 219 Freitextzutaten, 17 Warengruppen |
| `supplier` | `{id, name}` | |
| `subRecipeId` | Verweis auf ein eigenes Rezept (Halbfabrikat) | 947 von 2.111 Rezepten enthalten eines |
| `quantity`, `unit` | Menge, Einheit — Einheiten frei („cl", „g", „Limetten 8tel", „Portionierer Silber (60g)") | |
| `cost` | Euro laut FoodNotify, nicht aus Unterrezepten nachrechenbar | |
| `group` | Warengruppe, selten gefüllt | 409 |

**Gibt es nicht**, an allen 2.111 Dateien geprüft: Gültig-von/bis, Status/gelöscht,
Halbfabrikat-Kennzeichen, Ausbeute als eigene Zahl. Diese Spalten werden **nicht erfunden**:
Gültigkeit wird als beobachteter Zeitraum (`erstmals_am`/`zuletzt_am`) geführt, „Halbfabrikat"
als abgeleitete Eigenschaft (wird von einem anderen Rezept als `sub_recipe` verwendet).
`meta.weight.loss` steht roh in der Tabelle, seine Bedeutung ist offen (0, 100, null, 1,1038 …).

**Rezepte gelten je Marke** (ein FoodNotify-Mandant je Marke), nicht je Betrieb. Den Bezug zum
Betrieb gibt es nur über die Kassenzuordnung (`/api/pos/mapping/…`, `core.pos_artikel`). Die ist
nicht Teil dieses Schritts.

## 2. Die Artikelnummer

`artikelId` in der Zutat ist die **Artikelnummer des Lieferanten**: dieselbe Nummer wie
`core.bestellposition.lieferanten_nr` und wie `SellerAssignedID` in ZUGFeRD-Rechnungen.
Mit `core.artikel.artikelnummer` (LINA, das, was verkauft wird) hat sie **nichts** zu tun.

Für 300203 nachgesehen (lokale DB, 15.10.2026): Ware der Marke **Wilma Wunder**,
„Erdbeersauce Tk Karton 3 Flaschen", Lieferant Distra. Sie steht in 10 Bestellpositionen, von
Wilma Wunder und einmal Aposto (Distra Aposto), und hängt an drei verschiedenen
`concrete_product`-IDs. **In den Enchilada-Rezepten kommt sie nicht vor.** Abnahmekriterium 3
lässt sich deshalb erst prüfen, wenn die Rezepte von Wilma Wunder geladen sind.

### Warum nicht über `core.ware.fn_id` joinen

Der Fallstrick „866 IDs auf 428 Namen" betrifft FoodNotifys interne Warennummer
(`core.ware.quelle = 'concrete_product'`): dieselbe Ware hat dort viele IDs. Über `ware.fn_id` trafen
in `0094` nur 10,1 %, über `lieferanten_nr` 100 %. Deshalb läuft die Brücke über
**(Marke, Lieferanten-Artikelnummer)** und nicht über die Waren-ID. Der Warenname kommt aus der Zutat
selbst. Eine Aliastabelle (`manual.ware_alias`) braucht diese Brücke nicht, solange die Nummer
trägt. Was sie nicht trägt, wird **ausgewiesen**:

| `zuordnung` | Bedeutung |
|---|---|
| `eingekauft` | Nummer trifft eine Bestellposition derselben Marke |
| `nummer ohne einkauf` | Nummer vorhanden, aber nie bestellt (Altnummer, anderer Lieferant, Tippfehler) |
| `ohne nummer` | Freitext oder Warengruppe ohne `artikelId` |
| `unterrezept` | Verweis auf ein Halbfabrikat und damit keine Ware |

Dieselbe Nummer kann bei zwei Lieferanten zwei Waren bedeuten (gemessen bei 715, 200004, 10956).
Deshalb wird `supplier.id` mitgeführt. Der Join auf den Lieferanten bleibt ein zweiter Schritt,
sobald eine Messung zeigt, dass Lieferant-ID und Bestelllieferant zusammenfinden.

## 3. Tabellen

Vorschlag (siehe Frage B/C):

- **raw:** `raw.api_antwort` wie jeder FoodNotify-Endpunkt, mit den Endpunkten `fn:rezepte` (Listenseite),
  `fn:rezept` (Kopf, nur für Verweise, die nicht in der Liste stehen), `fn:rezept_zutaten` und
  `fn:rezept_meta`. Abrufzeitpunkt, Marke und Quell-ID stehen dort schon. Getrennte Tabellen
  `raw.foodnotify_rezept*` hätten eine zweite Wahrheit neben dem Raw-Layer (Regel 4) erzeugt.
- **core:** die vorhandenen `core.rezept` und `core.zutat` aus `0030` (beide leer), erweitert in Migration
  `0132`:
  - `core.zutat.art` lässt `product_group` zu. Der heutige CHECK würde 1.855 Zeilen abweisen.
  - neu `lieferant_fn_id` und `gruppe`.
  - `core.rezept`: neu `gewicht_gesamt`, `portion`, `portion_einheit`, `verlust_roh`, `in_liste`
    (false = nur über einen Verweis gefunden), `zutaten_geholt_am`.
- **Upsert** auf `(marke_key, fn_id)` beim Rezept. Die Zutaten werden je Rezept in derselben
  Transaktion ersetzt (`DELETE … WHERE rezept_key` + `INSERT`). Das betrifft `core` und nicht `raw`,
  ist damit aus `raw` jederzeit neu aufbaubar und wiederholbar ohne Duplikate.

## 4. mart-Sichten (lesbar für `mcp_leser`)

| Sicht | Körnung |
|---|---|
| `mart.rezept_position` | eine Zeile je Rezept und Zutatenposition: Marke, Rezept, `artikelnummer` (Lieferantennummer), Warenname, Lieferant, Menge, Einheit, Kosten, `zuordnung` |
| `mart.artikel_in_rezept` | eine Zeile je Ware × Rezept × Weg: `ebene` (1 = direkt), `via_rezept` (das Halbfabrikat, durch das sie hineinkommt), `pfad`, Menge und Einheit **auf ihrer eigenen Ebene**. Aufgelöst mit `WITH RECURSIVE`, mit Zyklusschutz |
| `mart.rezept_stand` | je Marke: Rezepte, Zutaten, ältester Zutatenabruf, nur über Verweis gefunden. Dazu eine Zeile in `mart.datenstand` |
| `mart.rezept_zuordnung_pruefung` | je Marke: Anteil Zutatenpositionen je `zuordnung`, in Prozentzahlen. Dazu eine Zeile in `mart.pruefung_uebersicht` |

**Mengen werden über Ebenen nicht multipliziert.** Für eine Effektivmenge („wie viel Gramm Mehl in
einer Pizza") bräuchte es Einheitenumrechnung und die Ausbeute des Halbfabrikats. Beides liefert
FoodNotify nicht verlässlich („Portionierer Silber (60g)", `loss` ohne geklärte Bedeutung).
Fallstrick im MCP-Katalog: keine Summe über `menge` ohne Filter auf `ebene`, keine Summe über
Einheiten hinweg.

## 5. Sync

- Einreihen in `nachfuellen.ts`, abgearbeitet von der FoodNotify-Spur in Phase A, mit demselben Client
  und demselben Takt (`FN_TAKT_*`).
- **Kein Handbefehl** (AGENTS.md, Abschnitt *Betrieb*): Der Backfill ist eine Obergrenze je Nacht
  (`REZEPTE_JE_LAUF`). Die Listenseiten werden täglich geholt. Die Zutaten werden für neue Rezepte
  sofort geholt, für bekannte reihum, sodass jedes Rezept spätestens nach N Tagen neu gelesen ist.
  Ein Änderungsdatum gibt es nicht, also bleibt nur der Umlauf.
- Verweise auf Rezepte, die nicht in der Liste stehen, werden als Folgeposten einzeln nachgeholt.
- `sync.quelle`: `core:rezept` kippt auf `erwartet: true`. Eine stumme Rezeptquelle meldet den Lauf
  dann als `teilweise` (Regel 10).
- `bun run einreihen --rezepte --dry-run` zählt nur, was eingereiht würde.

Aufwand: zwei Aufrufe je Rezept plus Listenseiten. Für Enchilada sind das gut 4.300 Aufrufe für den
Vollabzug (`src/rezepte.ts` brauchte mit Schritten und Bildern 8.304). Die Rezeptzahlen von Wilma
Wunder und Deutsche Konzepte sind nicht gemessen.

## 6. Abnahme

1. Laden zweimal hintereinander ergibt dieselben Zeilenzahlen (Test gegen die Attrappe und
   gegen die Datenbank).
2. Stichprobe von fünf Rezepten gegen die Rohantwort von FoodNotify: Enchilada gegen den Einzelabzug,
   Wilma Wunder nach dem ersten Lauf.
3. `select rezept, marke, menge, einheit, ebene, via_rezept from mart.artikel_in_rezept where
   artikelnummer = '300203'`, sobald Wilma Wunder geladen ist.
4. `mart.rezept_zuordnung_pruefung`.
5. Tests, MCP-Katalogabzug, `datenmodell.md`, `importer.md`, `datenherkunft.md`, `metabase.md`.
   Bei `offene-punkte.md` die Frage „gibt es einen Rezept-Endpunkt?" schließen.

## 7. Offene Fragen an Eugene

- **A — Marken:** alle vier, oder zuerst Wilma Wunder (dort steckt 300203)?
- **B — raw:** `raw.api_antwort` (Vorschlag) statt eigener `raw.foodnotify_rezept*`-Tabellen?
- **C — core:** die vorhandenen `core.rezept`/`core.zutat` erweitern (Vorschlag) statt eines neuen
  `core.rezept_position`? Der Name `mart.rezept_position` bleibt in jedem Fall.
- **D — Takt:** Obergrenze je Nacht und Umlaufdauer für die Neulesung.

Ausdrücklich **nicht** in diesem Schritt: die Kassenzuordnung (`core.pos_artikel`, Betriebsbezug),
ein theoretischer Wareneinsatz aus Rezepten und die Historie von Rezeptfassungen (FoodNotify führt
keine Versionen; „was stand im März im Rezept" lässt sich erst ab dem ersten Abruf beantworten).
