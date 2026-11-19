# FoodNotify — die interne Schnittstelle der beiden Oberflächen (Inventar 18.11.2026)

**Stand 18.11.2026.** Aus den ausgelieferten JavaScript-Bundles beider Weboberflächen gelesen, **ohne einen Aufruf gegen FoodNotify**. Die einzige Messung gegen den Server ist die mit dem Scope-Token am selben Tag; sie steht in `docs/foodnotify-api-inventar-offiziell.md` (Abschnitt „Messung mit Token") und ist hier nur je Thema mitgezählt.

Dieses Dokument **ergänzt** `docs/foodnotify-api-inventar.md` (27.07.2026, 126 Pfade aus Netzwerkmitschnitt und Bundles), es ersetzt es nicht: Antwortfelder, Mengen je Marke und die Befunde zu Daten stehen nur dort. Hier steht, **welche Pfade es gibt**, wer sie ruft und wie die Oberflächen sich anmelden.

## Kurzfassung

* **1.053 verschiedene Paare aus Methode und Pfad** in beiden Oberflächen zusammen (475 in der neuen, 770 in der alten nach Vereinheitlichung der Platzhalter, 192 in beiden). Davon 467 GET. Das alte Inventar kannte 126.
* **Zwei Oberflächen, eine Schnittstelle ohne Versionsnummer.** Die alte (`/panel`, Angular 15) und die neue (`/brew`, React) rufen beide `/api/…` auf demselben Host. Die öffentlichen Pfade `/api/1.0/…` und `/api/2.0/…` kommen in **keiner** der beiden vor.
* **Beide melden sich per Cookie an**, keine schickt einen `Authorization`-Header. API-Token gibt es nur für Fremdprogramme (Profil → „API-Tokens", OAuth-Ablauf, Recht `externalApi`).
* **14 GET-Aufrufe verändern etwas** — Abmelden, Kassenverbindung lösen, Bestand aus der Kasse nachladen, Verkauf abschließen. Drei davon stehen im alten Inventar als gewöhnliche Lesepfade. Liste in Abschnitt 6: **nie automatisch aufrufen.**
* **Sechs der 14 Pfade, die der Importer heute benutzt, stehen in keinem der beiden Bundles**: die vier Rezeptpfade `/api/recipes…`, die Inventurpositionen `/api/erp/stocktakings/{uuid}/items` und die Bestellansicht (HTML). Wer sie ruft — das Altsystem `/recipes`, die mobile App —, ist nicht erhoben.
* **Die alte Oberfläche bettet Sentry mit Sitzungsaufzeichnung ohne Textmaskierung ein und meldet jeden Benutzer mit E-Mail und Namen an Gleap.** Das betrifft jede Browserarbeit in FoodNotify (Abschnitt 4).

## 1. Methode

### Eingang

| | |
|---|---|
| Neue Oberfläche `/brew` | 340 JavaScript-Dateien, 8,5 MB, Einstieg `index-lKBZAT8Z.js`, `build-time` 17.11.2026 16:02 UTC |
| Alte Oberfläche `/panel` | 46 JavaScript-Dateien (`main`, `vendor`, `runtime`, `polyfills`, 42 Lazy-Chunks, alle aus der Chunk-Tabelle der `runtime`) und 3 HTML-Seiten. Der gemeinsame Chunk `592` (`common.30034b8ec64a4d94.js`) fehlte im ersten Lauf und ist nachgeladen (`intern/panel-methode.md` §7) |
| Hilfeseiten | 13 HTML-Seiten und `sitemap.xml` von `help.foodnotify.com` |
| Ablage | `belege/foodnotify-inventur-2026-11-18/{brew,panel,hilfe}` — **nur lokal**, über `.gitignore` ausgeschlossen (Fremdcode, Fremdtexte) |

Die Bundles sind aus der ausgelieferten Oberfläche mitgeschnitten, ausschließlich lesend (Browserarbeit nur lesend, Entscheidung Eugene 18.11.2026). Sie wurden **nie ausgeführt** — kein `node bundle.js`, kein `eval`, kein Browser. Gelesen wurde als Text bzw. als Syntaxbaum (`typescript` nur als Parser).

### Belege im Repo

Alles unter `docs/payloads/foodnotify-2026-11/`:

| Datei | Inhalt |
|---|---|
| `intern/brew-aufrufe.csv` | eine Zeile je (Methode, Pfadvorlage) der neuen Oberfläche: 475. Spalten `method, path_template, query_params, body_fields, chunks, routes, param_confidence, note` |
| `intern/brew-routen.csv` | 162 Zeilen: 105 Routen der Oberfläche und 57 Links ins Altsystem |
| `intern/brew-hosts.csv`, `brew-hosts-noise.csv` | 27 externe Hosts und Einbettungen; Bibliotheksrauschen getrennt (94 Zeilen) |
| `intern/brew-auth.md`, `brew-rechte.json` | Anmeldung, 2FA, API-Token, OAuth, Rechte und Rollen mit Fundort |
| `intern/brew-methode.md`, `brew-statistik.json` | Verfahren, Zahlen, Lücken |
| `intern/panel-aufrufe.csv` | 781 Zeilen der alten Oberfläche, dazu Spalte `in_altem_inventar` |
| `intern/panel-routen.csv` | 182 Zeilen: 142 Routen, 40 Weiterleitungen nach `/brew` |
| `intern/panel-hosts.csv`, `panel-hosts-rauschen.csv` | 30 Zeilen externe Hosts; 33 Rauschhosts |
| `intern/panel-auth.md`, `panel-methode.md` | Anmeldung, Guards, Speicher, Konfiguration; Verfahren und Lücken |
| `messliste-token.csv`, `messliste-token.md` | 574 GET-Vorlagen aus beiden Oberflächen und der Spezifikation, eingestuft nach Wirkung — **mit der Sicherheitsliste** |
| `messung-token-2026-11-18.csv` | Ergebnis der Token-Messung |
| `openapi/` | die neun öffentlichen Spezifikationen (`docs/foodnotify-api-inventar-offiziell.md`) |
| `intern/werkzeug/` | alle Skripte |

### Wiederholen

Gegen ein späteres Bundle, aus `docs/payloads/foodnotify-2026-11/intern/werkzeug/`:

```
# neue Oberfläche (reines Python, ~5 s)
python3 -I -B brew_extract.py <Bundle-Ordner brew> <Ausgabe-Ordner>

# alte Oberfläche
B=../../../../../belege/foodnotify-inventur-2026-11-18/panel
node panel_extrahieren.mjs $B <tmp>/panel-roh.json
python3 -I panel_auswerten.py $B <tmp>/panel-roh.json ../../../../foodnotify-api-inventar.md ..
node panel_fehlende_module.mjs $B <tmp>/panel-fehlend.json      # Erwartung: nur Modul 73

# Messliste (aus docs/payloads/foodnotify-2026-11/)
python3 -I -B intern/werkzeug/messliste_bauen.py . messliste-token.csv
```

Drei Dinge, die bei einem neuen Bundle **still** brechen können (dann die Zahlen in `brew-statistik.json` und `panel-methode.md` §3 gegenlesen):

* `brew_extract.py` findet den Einstieg über den Anker `isAuthenticated:"/app/is-authenticated"` und die HTTP-Klasse über ihre minifizierten Namen `ot`/`UM` (`brew-methode.md` §1). Neue Namen → null Treffer.
* `panel_extrahieren.mjs` erkennt Webpack-Module über „numerischer Name, Funktion mit ≥ 2 Parametern". Module mit weniger Parametern sieht es nicht (so galten im ersten Lauf 13 Module fälschlich als fehlend).
* `messliste_bauen.py` stuft **jeden neuen** GET-Pfad als `unklar`/`nein` ein, bis jemand ihn im Code gelesen und eine Tabelle im Skript ergänzt hat. Eine neue Zeile landet nie still als `lesend` — so gewollt.

### Gegenproben

* Neue Oberfläche: jede Zeichenkette `"/api/…"` (und `/pos/`, `/app/`, `/shop/`, `/shops/`, `/recipes/`, `/oauth/`) im Bundle gegen die CSV — 437 Formen, 50 fehlten, alle Oberflächenrouten oder Altsystem-Links bis auf einen Download-Pfad, der nachgetragen ist. 249 der 252 Einträge der Endpunkt-Tabelle sind benutzt.
* Alte Oberfläche: 642 Aufrufstellen per Textsuche gezählt, das Werkzeug fand je Stelle genau einen Aufruf, Chunk für Chunk.

## 2. Zwei Oberflächen, vier Arten von Pfaden

| | `/panel` (alt) | `/brew` (neu) |
|---|---|---|
| Technik | Angular 15.2.10, Webpack (`fn-client-webapp`) | React, Vite, TanStack Router/Query, axios |
| Rolle heute | der ältere Client; viele Routen leiten per Guard auf `/brew` um (40 Weiterleitungen, `brewPath`) | seit dem Umbau vom 09.11.2026 („Das neue FoodNotify") die Hauptoberfläche |
| Aufrufe | 781 Zeilen (346 GET, 229 POST, 132 PUT, 73 DELETE, 1 PATCH) | 475 Zeilen (213 GET, 128 POST, 87 PUT, 41 DELETE, 3 PATCH, 3 Methode unbekannt) |
| davon nur geerbt | 187 Zeilen entstehen nur aus der CRUD-Basisklasse (`/api/{erpId}/<ressource>` mit `index/show/edit/create/store/update/delete/search/paginate`); ob die Oberfläche sie ruft, ist nicht belegt | — |
| Antworthüllen im Code | `{payload: …}` und nackte Objekte | Problem-Details (`title`, `detail`) für neue Pfade; eine eigene Schicht `legacy-http` für die alten mit `{isError, payload, errors}` |

Eine dritte Oberfläche ist **nicht** erfasst: das klassisch gerenderte Altsystem unter `/recipes` (57 Links aus `/brew` zeigen dorthin). Eine vierte ebenso wenig: die mobile App (Flutter), die die neue Oberfläche als WebView einbettet (`window.FlutterBridge`).

Die Pfade fallen in vier Arten:

1. **Klassische Serverrouten ohne `/api`** — `/signin_check`, `/signout`, `/shops/private/…` (Lieferantenportal), `/shop/{id}/cart/…`, `/pos/…`, `/recipes/…`, `/oauth/v2/auth`. Antworten sind teils HTML.
2. **`/api/…` ohne Version** — die eigentliche interne Schnittstelle. In der alten Oberfläche überwiegend die CRUD-Familie `/api/{erpId}/<ressource>`, in der neuen eine eigene Endpunkt-Tabelle mit 252 Einträgen (`/api/recipes/cost-calculation/…`, `/api/recipe-viewer/…`, `/api/pos/mapping/…`, `/api/erp/core/…`).
3. **`/api/v2/…`** — nur in der neuen Oberfläche: Analytics (`/api/v2/analytics`, `/token`) und Verwaltung (`/api/v2/…/management/…`, nur mit `ROLE_ADMIN`).
4. **`/api/1.0/…`, `/api/2.0/…`** — die öffentliche Schnittstelle. **Kein Treffer** in beiden Bundles (Suche nach `api/1.0`, `api/2.0`, `api3`, `Bearer`).

## 3. Anmeldung und Rechte

### Alte Oberfläche (`intern/panel-auth.md`)

* **Cookie-Sitzung**, kein Token im Code oder im Browserspeicher. Anmelden mit `POST /signin_check` (Symfony-Formular: `_username`, `_password`, `_remember_me`), Abmelden mit `GET /api/security_logout` — **ein GET mit Wirkung**.
* Benutzer aus `GET /app/is-authenticated`: `roles`, `allowedModules` (`analytics`, `catering`, `erp`, `menucreator`), `erpPermissions` (14 Namen, u. a. `orders`, `stocktaking`, `stocktransferApproves`), Catering-Rechte.
* **Kein 2FA, kein OAuth** in dieser Oberfläche. Rechte werden im Client geprüft (Guards); ob der Server dasselbe erzwingt, sagt der Code nicht.
* Lieferantenportal (Chunk `488`): „Angemeldet bleiben" schreibt **E-Mail und Passwort im Klartext** nach `localStorage` (`foodnotify.email`, `foodnotify.password`). Betrifft nur Lieferantenkonten, nicht die Markenzugänge.

### Neue Oberfläche (`intern/brew-auth.md`)

* **Cookie-Sitzung** (`withCredentials`), Kopfzeile `X-Client-Type: react`, kein `Authorization`. Anmelden mit `POST /api/user/auth/signin_check` (`email, password, rememberMe`), Antworttyp `LoginSuccess` / `LoginChallenge` / `LoginSetup`.
* **2FA** mit `totp` und `email`, „Gerät merken", Sicherheitsrichtlinie je Benutzer.
* Benutzerobjekt mit `isMasterUser`, `allowedModules`, `masterPermissions`, `erpPermissions`, `shopPermissions`, `subuserPerms`, `posPermissions`, `hasRecipeViewerAccess`. Gelesene Rechte: Hauptkonto `externalApi`, `erpGlobalSettings`, `gesoca`; Module `recipes`, `erp`, `catering`, `analytics`, `insights`; 22 Unterbenutzerrechte; Rollen `ROLE_ADMIN`, `ROLE_SUPER_ADMIN`, `ROLE_SUBUSER_ADMIN`, `ROLE_DISPLAY`, drei `ROLE_EDU_*`, `ROLE_ERP_CATALOG_SYNC_ADMIN`, `IS_IMPERSONATOR`.
* **FoodNotify-Mitarbeiter können sich als Kunde anmelden** (`IS_IMPERSONATOR`, Link `/recipes?_switch_user={email}`).
* **API-Token** (Reiter „API-Tokens", nur mit `master("externalApi")`): `GET/POST/DELETE /api/user/api-tokens`, `GET …/grantable-scopes`, `POST …/exchange`. Der Code kennt nur einen Scope-Namen, `full-access`; alle anderen kommen vom Server. Ablauf, Scopes und Messung: `docs/foodnotify-api-inventar-offiziell.md`, „Wie ein Token entsteht".
* **OAuth-Zustimmungsseite** `/brew/oauth/authorize` → Formular `POST /oauth/v2/auth` (Pfad des Symfony-Pakets FOSOAuthServer, geschlossen). Eine Registrierung fremder Clients gibt es in der Oberfläche nicht.
* **Analytics ist Tableau:** `/api/v2/analytics` liefert Host, Site und Ansichten, `/api/v2/analytics/token` ein JWT für die Einbettung. Die alte Oberfläche nutzt stattdessen das Ticket-Verfahren über `/api/analytics`.

### Der Umbau vom 09.11.2026 hat die Anmeldung nicht verändert

Frage Eugene, 18.11.2026. Am Authorization-Konzept der Oberfläche hat sich nichts Radikales geändert: Sie arbeitet weiter mit Cookie-Sitzung gegen dieselbe interne Schnittstelle.

* **Gleiche Schnittstelle.** Die React-Oberfläche ruft die unversionierten `/api/…`-Pfade auf `my.foodnotify.com` auf — dieselbe Familie, die der Importer nutzt. Die öffentliche API (`/api/1.0`, `/api/2.0`, `api3`) kommt in ihrem Code nicht vor.
* **Gleiche Anmeldung.** Cookie-Sitzung, kein `Authorization`-Header. Den Login-Weg des Importers (`POST /api/user/auth/signin_check`) hat dieses Projekt schon am 02.08.2026 aus dem Login-Chunk dieser React-Oberfläche gelesen (`src/foodnotify/auth.ts`); es gab sie also vor dem Umbau.
* **Neu ist nur etwas Zusätzliches:** ein OAuth-Server und die Scope-Tokens für Fremdprogramme, die über `api3.foodnotify.com` laufen. Die Oberfläche selbst nutzt sie nicht.

**Was davon gemessen ist:** am 18.11.2026 im Browser mit der Sitzung von Wilma Wunder zwei Pfade (`/api/pos/locations`, `/api/erp/available`, beide 200). Alles Übrige ist aus dem Code gelesen. **Nicht nachgesehen:** ob der Importer seit dem 09.11.2026 fehlerfrei durchläuft — das zeigt `mart.quelle_zulauf`.

Nachtrag desselben Tages: Die Sitzungsmessung (`payloads/foodnotify-2026-11/messung-sitzung-2026-11-18.md`) hat danach 204 + 55 Pfade mit der Sitzung gemessen; alle Pfade des Registers antworten weiter (die Bestellansicht nicht gemessen).

## 4. Hosts und Drittdienste

| Host / Dienst | Wo | Was |
|---|---|---|
| derselbe Ursprung (`my.foodnotify.com`) | beide | alle API-Aufrufe; `VITE_API_DOMAIN` = `window.location.origin` |
| `api3.foodnotify.com` | keine der beiden | öffentliche Schnittstelle und Token-Zugang; nimmt auch interne Pfade mit Token an (Messung) |
| `help.foodnotify.com` | beide | Hilfe, Tickets, Neuigkeiten |
| `beam.foodnotify.com` | beide | Menüpunkt „Lab", öffnet extern. Zweck nicht erhoben |
| Tableau | `/panel`: Skript `public.tableau.com/…/tableau-2.9.2.min.js`; `/brew`: `<tableau-viz>` | Analytics-Einbettung. Der Tableau-Host kommt zur Laufzeit aus `/api/v2/analytics` (`tableauUrl`) und steht nicht im Bundle |
| Sentry (`o4506841913491456.ingest.us.sentry.io`) | `/panel` `main` | Fehlerberichte **mit Sitzungsaufzeichnung**: 10 % aller Sitzungen, 100 % bei Fehlern, `maskAllText: false`, `blockAllMedia: false` — Bildschirminhalte gehen unmaskiert an einen US-Endpunkt. In `/brew` kein Sentry gefunden (Suche über alle 340 Dateien, 18.11.2026) |
| Gleap (`api.gleap.io`, `wss://ws.gleap.io`, `messenger-app.gleap.io`, …) | `/panel` `main`, `vendor` | Rückmelde- und Tracking-Werkzeug, **aktiv**: nach jeder Anmeldung `Gleap.identify(<Benutzer-Id>, {email, name})`, Ereignisse aus Lieferantenseite, Warenkorb, Smartlisten. In `/brew` nicht gefunden |
| Google Maps (`maps.googleapis.com/maps/api/js`) | `/panel` HTML, `/brew` Einstieg | Browserschlüssel im Klartext ausgeliefert (hier nicht wiedergegeben) |
| OAuth-Server `/oauth/v2/auth` | `/brew` | Zustimmung für Token und Fremd-Clients, siehe oben |
| Flutter-Bridge (`window.FlutterBridge.postMessage`) | `/brew` | die Oberfläche läuft auch in der mobilen App |
| CDN-Rückfälle (`unpkg.com`, `cdn.jsdelivr.net`), Google Fonts, App-Store-Links | beide | Bibliotheken, keine Daten |
| `https://*****-***.assd.com/api/foodNotify/ep/` | `/panel` Chunk `742`, `/brew` `index-ayCVcund.js` | **Platzhaltertext** im Feld `endpointUrl` beim Kassentyp `assd` — kein FoodNotify-Pfad (erledigt offenen Punkt 8 des alten Inventars) |

Für uns folgt daraus: **Wer in der alten Oberfläche arbeitet, wird aufgezeichnet** (Sentry-Stichprobe) und namentlich an Gleap gemeldet. Das spricht nicht gegen Browserarbeit, aber dafür, dort keine Daten anzuzeigen, die nicht zu FoodNotify gehören.

## 5. Die Pfade nach Thema

Zeilen je Oberfläche aus den CSV, „gesamt" = verschiedene (Methode, Pfad) nach Vereinheitlichung der Platzhalter. Die letzte Spalte zählt das Ergebnis der Token-Messung vom 18.11.2026 für die GET-Pfade dieses Themas, die gemessen werden durften. Nachgezählt am 18.11.2026.

| Thema | `/brew` Zeilen (GET) | `/panel` Zeilen (GET) | gesamt | Token: 2xx / 403 / 405 / sonst |
|---|---|---|---|---|
| Warenwirtschaft (`/api/{erpId}/<ressource>`, `/api/erp/…`, `/api/erpSettings`, Dashboard) | 141 (62) | 294 (172) | 339 | 5 / 55 / 29 / 3 × 500 |
| Catering (`/api/eventCatering/…`) | 0 | 246 (54) | 240 | 0 / 15 / 0 / 1 nicht gemessen |
| Einkauf (`/api/{erpId}/shop-order…`, `/api/shop…`, `/shop/…`, `/shops/…`, Warenkorb) | 83 (34) | 111 (58) | 139 | 3 / 13 / 10 / 1 nicht gemessen |
| Konto, Anmeldung, Benutzer (`/api/user/…`, `/api/core/…`, `/api/subuser…`, `/app/…`) | 78 (31) | 10 (6) | 83 | 1 / 2 / 1 |
| Rezepte (`/api/recipes/…`, `/api/recipe/…`, `/api/recipe-viewer/…`, `/recipes/…`) | 62 (35) | 7 (7) | 67 | 15 / 2 / 0 / 1 × 404 (Validierung) |
| Kasse (`/api/pos/…`, `/pos/…`) | 54 (23) | 41 (17) | 56 | 6 / 2 / 0 / 3 nicht gemessen |
| Speisekarten, Tagesmenü | 2 (1) | 44 (18) | 46 | 0 / 5 / 0 |
| Lieferantenportal (`/api/supplier/…`) | 14 (5) | 26 (12) | 40 | 0 / 1 / 0 |
| Analytics (`/api/analytics/…`, `/api/v2/analytics…`) | 25 (16) | 1 (1) | 26 | 8 / 2 / 0 |
| Verwaltung FoodNotify (`/api/v2/…/management`, Customer Success) | 16 (6) | 0 | 16 | 0 / 2 / 0 |
| Sonstiges (`/assets/i18n`) | 0 | 1 (1) | 1 | — |
| **Summe** | **475 (213)** | **781 (346)** | **1.053** | **38 / 99 / 40 / 9** |

Dazu aus der Spezifikation: 3 × 200 (`/api/2.0/pos/accounts/…`), 3 × 403 (`/api/2.0/erp/stock/*`), 2 × 500 (fn-recipe) und 32 nicht einzeln gemessene `/api/1.0/…`. Wer einen bestimmten Pfad sucht: `grep` in `brew-aufrufe.csv` und `panel-aufrufe.csv`, die Wirkungsklasse in `messliste-token.csv`, das Token-Ergebnis in `messung-token-2026-11-18.csv`.

**Mit der Cookie-Sitzung** (Hauptagent, 18.11.2026, `messung-sitzung-2026-11-18.md`) antworteten 129 von 204 Pfaden und 45 von 55 Detailpfaden mit 200/204 — gegen 41 von 189 mit dem Token. Je Thema ist die Sitzungsmessung nicht ausgezählt; die Rohdateien (`fn-cookie-messung-1.json`, `-2.json`) gehören nach `belege/foodnotify-inventur-2026-11-18/` und liegen dort noch nicht.

**Welche Seite welche Abrufe auslöst**, steht für 68 Seiten der neuen Oberfläche in `payloads/foodnotify-2026-11/menue-durchgang-2026-11-18.md` (nur Öffnen, nichts angeklickt; Rohdatei `fn-menue-durchgang.json` noch nicht im Repo). Die fünf Abrufe, die der Durchgang zum Abgleich vorgemerkt hat (`completion/{…}/overall`, `erp/stocktakings/validation/{…}`, `erp/stock-transfer/notifications/{…}`, `recipes/dashboard-mix/{…}/items`, `shop/order-reminder/subscription/{…}`), **stehen alle in `brew-aufrufe.csv`** — nur mit geschlossenen Parameternamen (`completionId`, `validationId`, `notificationId`, `dashboardMixId`, `subscriptionId`), nachgezählt am 18.11.2026. Neu sind sie nicht. Der Durchgang schreibt an `core/languages/{…}/business`, `core/business/{…}/company` und `…/cost-centers` die Benutzer-ID; die Messliste führt dort `masterUserId` als unbekannt — das spricht dafür, dass beide dasselbe sind (geschlossen aus der Schreibweise des Durchgangs, nicht gemessen).

Was je Thema für uns zählt:

* **Warenwirtschaft.** Die alte Oberfläche führt 20 CRUD-Ressourcen unter `/api/{erpId}/…` (`product`, `stock`, `stocktaking`, `storage`, `category`, `sales`, `resets`, `statistics` …), die neue vor allem `/api/erp/…` (Lagerumbuchung `stock-transfer`, `food-waste-alpha`, Katalog `commodity-groups`, `concrete-products`) und `/api/erp/core/{userId}/erps`. Von den 53 gemessenen geerbten CRUD-Zeilen gibt es 37 für GET gar nicht (405) — **die geerbten Zeilen sind überwiegend keine echten Pfade.** Inventurliste, -kopf und -positionen antworten nur mit der Sitzung; daneben lebt die alte Familie `/api/{erpId}/stocktaking` (ganzzahlige IDs) weiter.
* **Einkauf.** `/api/{erpId}/shop-order/paginate`, `/{id}`, `/{id}/change` stehen in beiden Oberflächen; dazu Warenkorb, Smartlisten, Bestellerinnerungen, Mehrkostenstellenbestellung. Mit Token antwortet ~~nur die Liste (Detailpfade nicht gemessen)~~ die Liste und der Bestellkopf; die Positionen (`/change`) sind abgewiesen (Detailmessung 18.11.2026, `foodnotify-api-inventar-offiziell.md`). Mit der Sitzung antworten alle drei; `markedShopOrder.products[]` im Kopf trägt nur `price` und `productId` und ersetzt `/change` nicht.
* **Rezepte.** Die neue Oberfläche liest Rezepte über `/api/recipe-viewer/recipes` (Liste, `/{id}`, `/ingredients`, `/meta`, `/steps`, `/batch`), rechnet über `/api/recipes/cost-calculation/…`, `/cogs-corridors/…`, `/dashboard-mix/…` und verwaltet Zutaten über `/api/recipe/ingredients…`. **Der Pfad des Importers `/api/recipes?page=N` mit `/{id}`, `/ingredients`, `/meta` kommt in keiner der beiden Oberflächen vor** (Abschnitt 8). Mit Token: Liste 403, Einzelrezept, `/ingredients` und `/meta` 200 (Detailmessung 18.11.2026). Mit der Sitzung liefern `/api/recipes` und `/api/recipe-viewer/recipes` **dieselbe Antwort** (gleiche Felder, gleiche Größe), ebenso die Einzelrezepte — der Importer-Pfad ist offenbar ein zweiter Name desselben Endpunkts (geschlossen).
* **Kasse.** `/api/pos/mapping/{connectionId}/…` (Artikel, Verkäufe, Verknüpfungsziele, Jobs) gehört der neuen Oberfläche; die Verbindungsverwaltung `/api/pos/connection/…`, `/api/pos/locations`, Kassenassistenten (ikentoo, lightspeed, sellpick) beiden. Hier liegen drei der 14 GETs mit Wirkung.
* **Catering und Speisekarten** sind für Concept Family ohne Bedeutung und mit Token durchweg abgewiesen.

## 6. Sicherheitsliste: GETs, die etwas verändern

**Diese GETs nie automatisch aufrufen** — weder in einer Messschleife noch „nur zum Testen", weder mit Token noch mit Sitzung. Bei FoodNotify sagt die Methode nichts über die Wirkung: die alte Oberfläche schickt Aktionen oft als GET. Belegt im Code; Fundstelle und Auszug je Zeile in `messliste-token.md` §4. In `messliste-token.csv` stehen sie als `zustandsaendernd`, `messen = nein`.

| # | GET-Pfad | Wirkung | Fundstelle |
|---|---|---|---|
| 1 | `/app/lang` | setzt die Sprache des Benutzers | `/panel` `main`; `/brew` `setLanguage` |
| 2 | `/app/switch-design-mode` | speichert die Darstellung | `/panel` `main`; `/brew` `setTheme` |
| 3 | `/api/security_logout` | beendet die Sitzung | `/panel` `main` |
| 4 | `/api/erp/last-used/{id}` | merkt am Server den zuletzt gewählten Betrieb | `/panel` `main`, `239`; `/brew` `erpSetLastUsed` |
| 5 | `/api/pos/connection/unlink/{connectionId}` | **löst die Kassenverbindung** | `/panel` `742` |
| 6 | `/api/pos/product/unlink/all/{connectionId}` | **löst alle Produktverknüpfungen einer Kasse** | `/panel` `742` |
| 7 | `/api/pos/sync/reload/{connectionId}` | lädt den Bestand aus dem Kassensystem nach | `/panel` `742`; `/brew` `reloadInventory` |
| 8 | `/api/pos/ikentoo/businessData/{connectionId}/{blId}` | speichert die gewählte Betriebsstätte | `/panel` `742` |
| 9 | `/api/{erpId}/sales/{id}/finish` | schließt einen Verkauf ab | `/panel` `592`, `167`; `/brew` `sheet-chrome-…` |
| 10 | `/api/menucreator/{id}/generate-embedded-url` | erzeugt eine Einbettungs-URL | `/panel` `283` |
| 11 | `/shops/private/cancel-import` | bricht einen Produktimport ab (aus Name und Pfad geschlossen) | `/panel` `488` |
| 12 | `/shops/private/{shopId}/edited_file/upload` | startet einen Produktimport | `/panel` `488` |
| 13 | `/shops/private/{shopId}/product/{productId}/image/remove` | löscht ein Produktbild | `/panel` `488` |
| 14 | `/shops/private/{shopId}/product/{productId}/image/remove/{p6}` | wie 13 | `/panel` `488` |

Dazu, kein API-Aufruf, aber gleich zu behandeln: der Link `/recipes?_switch_user={email}` (Anmelden als anderer Benutzer, nur für FoodNotify-Mitarbeiter).

**Vorfall 18.11.2026 — eine Seite hat einen dieser GETs selbst ausgelöst.** Beim Menü-Durchgang (`payloads/foodnotify-2026-11/menue-durchgang-2026-11-18.md`) hat das bloße Öffnen der Seite `/brew/erp/7984` den GET `/api/erp/last-used/7984` (Nr. 4) abgesetzt. Folge: Das Konto Wilma Wunder führt seitdem 7984 statt 11035 als zuletzt benutzten Betrieb — dieselbe Wirkung wie ein Klick eines Benutzers, sonst keine Änderung. Ursache: Diese Liste deckte **direkte Aufrufe** ab, nicht **Seiten, die solche Aufrufe beim Laden selbst absetzen**. Daraus folgt für jeden künftigen Seitendurchgang:

* Die Route `/erp/{erpId}` **ohne Unterseite nie automatisch öffnen**; die Unterseiten (`/erp/{erpId}/order` usw.) lösen den Aufruf laut Durchgang nicht aus. Auch `/erp` (leitet auf `/erp/{zuletzt benutzt}/…`) und `/dashboard` beim ersten Laden zeigen `erp/last-used/{erpId}` in der Abrufliste des Durchgangs.
* **Vor einem Seitendurchgang die Seiten gegen diese Liste prüfen**, nicht nur die direkten Aufrufe: welche Abrufe die Seite beim Öffnen auslöst, steht im Menü-Durchgang; für ungeöffnete Seiten aus `brew-routen.csv` und den Chunks der Route.
* Eintrag in `docs/fehlerkatalog.md` (18.11.2026).

**Drei davon führt das alte Inventar als gewöhnliche Lesepfade:** `GET /api/erp/last-used/{id}` (§4), `GET /api/pos/sync/reload/{id}` (§5) und `GET /api/menucreator/{id}/generate-embedded-url` (§8). Wer das alte Inventar als Liste zum Abrufen benutzt, ruft sie mit auf.

Als Lesen belegt, obwohl der Name anders klingt: `/api/pos/sync/locations`, `/api/pos/sync/user/distinct_categories`, die Job-Abfragen `…/jobs/active`, `…/jobs/{jobId}`, `/api/recipes/settings/{id}/recipes/deletion-request` (Zähler; das Löschen selbst ist POST). Begründung je Pfad in `messliste-token.md` §4. Die Token-Messung hat `pos/sync/*` und `pos/export/*` trotzdem ausgelassen.

## 7. Abgleich mit dem alten Inventar (27.07.2026)

**Was stimmt** (und heute im Importer steckt):

* Die drei Schlüsselebenen `restaurant.id` / `costCenter.id` / `erpId` und die Benutzer-ID als Parameter von `/api/core/business/{id}/restaurants`.
* Die Bestellpfade `/api/{erpId}/shop-order/paginate`, `/{id}`, `/{id}/change` — in beiden Bundles vorhanden.
* Die Kostenanalyse (`/api/analytics/reports/cost-analysis/…`) und die Mapping-Pfade unter `/api/pos/mapping/…` — vorhanden, mit Token sogar erreichbar.
* Drei Oberflächen (`/panel`, `/brew`, `/recipes`).
* Die auskunftsfreudigen Fehlerseiten (§11) — mit Token wieder gesehen: zwei 500er mit PostgreSQL-Fehlertext.

**Was fehlte:**

* Der Umfang: 126 Pfade gegen heute 1.053 Paare. Der Mitschnitt sah nur, was die angeklickten Seiten luden.
* Die Rezeptschicht der neuen Oberfläche (`/api/recipe-viewer/…`, `/api/recipes/cost-calculation/…`, `/cogs-corridors/…`, `/dashboard-mix/…`) und `/api/erp/core/{userId}/erps`.
* API-Token, OAuth-Server, Rechtemodell der neuen Oberfläche, Sentry-Aufzeichnung, Gleap.
* Die Wirkung von GETs: §4, §5 und §8 führen drei zustandsändernde GETs als Lesepfade (Abschnitt 6).

**Was überholt ist:**

* §7: `GET /api/v2/analytics → {"token": "<JWT>"}`. Am 18.11.2026 liefert der Pfad `{tableauUrl, siteContentUrl, analyticsId, views[28]}`; das JWT kommt aus `/api/v2/analytics/token`.
* §1, Login: `POST /api/user/auth/signin_check` gilt für die neue Oberfläche; die alte meldet sich mit `POST /signin_check` an. 2FA gibt es nur in der neuen.
* §10 Punkt 8 (`/api/foodNotify/ep/`): **geklärt** — Platzhaltertext eines Eingabefelds beim Kassentyp `assd` (Abschnitt 4), kein Pfad.
* §10 Punkt 1 (POS-Account-ID): seit dem Nachtrag 01.08.2026 geklärt (`connectionId`), in der Liste aber nicht durchgestrichen.

## 8. Lücken

Gelesen ist, was im Code steht. Alles hier ist **nicht** belegt:

* **Keine Antwortformen aus den Bundles.** Der Code trägt keine Typen; Felder sind nur dort bekannt, wo die Oberfläche sie liest. Antwortformen gibt es nur für die 41 Pfade, die dem Token geantwortet haben (`messung-token-2026-11-18.csv`, Spalte `form`), ~~und aus dem alten Inventar~~ aus dem alten Inventar und seit der Sitzungsmessung für 129 + 45 Pfade — aber nur in den Rohdateien, die noch nicht im Repo liegen; der Bericht `messung-sitzung-2026-11-18.md` nennt die Formen nur für die Befunde.
* **Geerbte CRUD-Zeilen sind unbewiesen.** 187 Zeilen der alten Oberfläche entstehen nur aus der Basisklasse. Von 53 gemessenen gab es 37 für GET nicht (405).
* **Parameternamen** sind in der neuen Oberfläche in 167 Zeilen aus dem Pfad geschlossen (`inferred`), in der alten in 179 Zeilen nur Positionen (`{p1}`). `/api/pos/mapping/{mappingId}/…` heißt dort `mappingId`, gemeint ist die `connectionId`. `masterUserId` (22 Pfade) ist vermutlich die Benutzer-ID — nicht belegt.
* **Körperfelder** fehlen bei vielen schreibenden Zeilen; leer heißt nicht „kein Körper".
* **Nur ein Bestand.** Die Bundles stammen aus einer Sitzung am 18.11.2026 (Build der neuen Oberfläche vom 17.11.2026). Ob andere Konten andere Chunks oder Menüs sehen, ist nicht geprüft; **die drei anderen Marken sind nicht geprüft**, weder statisch noch mit Token.
* **Nicht erfasst:** das Altsystem `/recipes` (eigene Seiten, eigenes JavaScript), die mobile App, die Übersetzungsdateien (`/assets/i18n`, 33 Dateien).
* **Nicht durchgegangen:** die alte Oberfläche `/panel` (Catering, Tagesmenü, Menükarten, Lieferantenportal) und die klassischen Seiten (`/recipes/db`, `/menucreator`, `/users`, `/account/subscription`). Der Menü-Durchgang hat nur die neue Oberfläche geöffnet, nur Öffnen, keine Detailseiten mit Bestell-, Rezept- oder Inventur-ID, keine Filter, Reiter oder Dialoge.
* **258 lesende Pfadvorlagen** mit Parametern, die sich aus keiner Antwort ergeben (vor allem Catering, Menükarten, Lieferantenportal, Verwaltung), sind weder mit Token noch mit Sitzung gemessen.
* **Sechs Pfade des Importers stehen in keinem Bundle:** `/api/recipes?page=N`, `/api/recipes/{id}`, `/ingredients`, `/meta`, `/api/erp/stocktakings/{uuid}/items` und die HTML-Seite `/shop/{shopId}/orders/{nr}`. Gerufen werden sie vermutlich aus `/recipes`, aus der App oder serverseitig. Mit der Sitzung liefern `/api/recipes` und `/api/recipe-viewer/recipes` dieselbe Antwort — für die Rezepte ist das Risiko damit kleiner (zweiter Name desselben Endpunkts, geschlossen), für `/items` nicht. Am 18.11.2026 antworteten `/api/recipes/{id}`, `/ingredients` und `/meta` noch (mit Token, je einmal). Dass sie heute noch antworten, zeigt nur der Nachtlauf (`mart.quelle_zulauf`) — wenn die Oberfläche sie nicht mehr braucht, kann FoodNotify sie ohne Ankündigung abschalten. Das ist das größte Risiko für den bestehenden Importer, das dieses Inventar sichtbar macht.
* **Serverseitiges ist unsichtbar:** Rechteprüfung auf dem Server, Drosselung, Cookie-Eigenschaften, ~~der Host des MCP-Servers,~~ welche Dienste hinter `api3` und `my` stehen. (Der MCP-Server ist gefunden: `https://my.foodnotify.com/mcp`, `docs/foodnotify-mcp-server.md`.)
* **Lieferkonditionen (19.11.2026, nur aus den Bundles gelesen):** Mindestbestellwert, Liefertage und Bestellfrist stehen am Warenkorb-GET `/api/shop/{shopId}/cart/{type}/{cartId}` (`minimalOrderSum`, `deliveryDates`, `preorderDays`), **nicht** im `POST /api/shop/{shopId}/info`; ungemessen. Einzelheiten und Muster einer lesenden Probe: `payloads/foodnotify-2026-11/lieferkonditionen-bundle-2026-11-19.md`.
* **Bedingungen je Aufruf** (nur mit Modul X, nur für Hauptkonto) sind nur für die Rechte erhoben, nicht je Zeile.

## 9. Technische Auffälligkeiten

Zusammengeführt aus der Sitzungsmessung (`messung-sitzung-2026-11-18.md`, „S") und dem Menü-Durchgang (`menue-durchgang-2026-11-18.md`, „M"), ohne Doppelungen; Einzelheiten dort. Alles am 18.11.2026, Konto Wilma Wunder.

1. **Eine Seite schreibt beim Öffnen** (M1): `/erp/{erpId}` setzt `GET /api/erp/last-used/{erpId}` ab — einmal ausgelöst, Vorfall in §6.
2. **Fehlermeldungen geben Interna preis** (S1, auch mit Token gesehen): Klassen- und Dateipfade mit Zeilennummer, `SQLSTATE`-Fehler im Klartext, fehlende Dienste im Container, PHP-Fehler. Dasselbe hat das alte Inventar am 27.07.2026 notiert (§11). **Alles dazu, mit Lesetabelle „Meldung → fehlender Parameter“ und der Liste der Pfade, bei denen `paginate`/`search` als ID gelesen werden: `docs/foodnotify-interna-aus-fehlermeldungen.md`.**
3. **Fehlerbilder statt 404:** `paginate` und `search` landen bei mehreren Ressourcen als ID im Detail-Controller und enden in Typ- oder SQL-Fehlern (S2 — die geerbten Zeilen der Basisklasse, es gibt diese Pfade nicht). Fehlende Pflichtparameter kommen als 404, 422 oder 500 zurück, je nach Endpunkt (S3).
4. **405 mit `Allow`** (S4): `OPTIONS` allein heißt „für GET nicht vorhanden", `PUT`/`DELETE` heißt „nur schreibend". **Diese Pfade nie mit einer anderen Methode nachprobieren.** `/api/pub/version` (im alten Bundle als GET geführt) antwortet ebenfalls 405 (S6).
5. **Verwaltung ist für das Kundenkonto geroutet, nicht gesperrt:** vier `/api/v2/…/management`- bzw. Onboarding-Pfade antworten 403 „ROLE_ADMIN" (S5); fünf `/brew/admin/*`-Seiten leiten auf `/analytics` oder bleiben leer stehen (M6). Beim Umleiten über 50-mal „Minified React error #185" — kann am Seitenwechsel per `pushState` liegen, **nicht** als Fehler der Oberfläche belegt.
6. **Eine Testseite in der Produktion:** `/brew/erp/{erpId}/test` lädt `erpSettings/restaurants/shared` (4,1 s) und zeigt nichts (M2).
7. **Große Antworten ohne Seiten, langsame Abrufe** (S8, M3, M4): `link-targets` alle rund 13.250 Rezepte in einer Antwort, rund 11 s, ohne Seitensteuerung; `article-sales` 11,3 s; `cost-analysis/ingredients/by-product` 1,4 MB; `erpSettings/restaurants/shared` 0,7 MB. Die Größe von `link-targets` steht verschieden da: 3,06 MB in der Sitzungsmessung, 551 KB im Durchgang — vermutlich ausgepackt gegen komprimiert übertragen (geschlossen, nicht geprüft).
8. **Vier Benennungen der Seitensteuerung in einer Oberfläche** (M8): `page_size`/`order_by`, `pageSize`, `perPage`, `limit` — zusätzlich zu den fünf Varianten der öffentlichen Spezifikation (`foodnotify-api-inventar-offiziell.md`).
9. **Zwei Tableau-Wege nebeneinander** (S7): `/api/analytics` gibt ein kurzlebiges `ticket` heraus, `/api/v2/analytics` nur Host und Ansichten. **Antworten von `/api/analytics` nicht ablegen** — das Ticket ist ein Zugangsmerkmal.
10. **Personenbezogenes in Lesepfaden** (S9): `createdByUser`/`updatedByUser` mit Vor- und Nachname an Bestellungen und Positionen, `signature.signer.name` an Inventuren, `subusers` mit Name, E-Mail und 2FA-Status, `company` mit Ansprechperson. Nie nach `mart`. Dazu M5: Beim Öffnen der Betriebsseite unter Einstellungen geht die Adresse des Betriebs als Suchtext an Google (Geocoding).
11. **Fremde Hosts beim Öffnen** (M5): `cdn.jsdelivr.net` (WebAssembly für Animationen, 479 KB, Warenwirtschafts-Startseite), `maps.googleapis.com`, `maps.gstatic.com`, `fonts.googleapis.com` (nur Betriebsseiten; der Browser-Schlüssel steht in der Abruf-URL). **Kein** Sentry, kein Gleap, kein Tableau beim bloßen Öffnen der neuen Oberfläche — passt zu §4 (Sentry und Gleap nur in `/panel`).
12. **`/app/is-authenticated`** liefert das vollständige Rechteobjekt des Kontos (S10) — die schnellste Probe, was ein Konto darf.
13. **Zwei Seiten ohne Abruf beim Wechsel per `pushState`:** `/settings/pos/configure/{id}` und `/settings/pos/export/{id}` zeigten den Inhalt der vorigen Seite (M7). Ob sie beim echten Laden etwas holen, ist nicht gemessen; `pos/export/…` steht in der Messliste als `unklar`.

## Was das für den Importer heißt

Steht in `docs/foodnotify-api-inventar-offiziell.md`, Abschnitt „Was das für den Importer heißt": je Registereintrag, ob es mit dem Token einen Weg gibt, und welche Daten erreichbar, aber nicht geladen sind.
