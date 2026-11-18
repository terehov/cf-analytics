# FoodNotify `/panel` — wie das Inventar entstand, Zahlen, Lücken

Erhoben am 18.11.2026, **ohne einen einzigen Aufruf gegen FoodNotify**: nur Textanalyse der mitgeschnittenen Bundles.

> **Nachtrag 18.11.2026 (zweiter Lauf):** Der gemeinsame Chunk `592` (`common.30034b8ec64a4d94.js`, 40 KB), der im ersten Lauf fehlte, wurde nachgeladen und ist eingearbeitet. Alle Zahlen unten sind die **neuen**; die alten stehen dort, wo sie sich geändert haben, durchgestrichen daneben. Vorher/nachher in Abschnitt 7. Der Bestand ist damit vollständig: alle 42 Lazy-Chunks der `runtime`-Tabelle liegen vor.
Die Bundles sind Fremddaten und wurden nie ausgeführt (kein `node bundle.js`, kein Browser, kein `eval`).

## 1. Eingang

* `belege/foodnotify-inventur-2026-11-18/panel/`: **46 JavaScript-Dateien** (`main`, `vendor`, `runtime`, `polyfills`, **42** Lazy-Chunks, davon `common.<hash>.js` = Chunk `592`; ~~45 Dateien / 41 Lazy-Chunks~~) und **3 HTML-Seiten** (`_panel_.html`, `_panel_catering.html` — byte-gleich —, `_brew_.html`).
* Prüfsumme über den Ordner: `shasum -a 256 * | shasum -a 256` = `3ca199f2faff2737bf74e84e620ced12097854206e888e9d9ee3c3d36bb2fa95` (mit `common.….js`; ~~`49a8aa1e…da039` ohne~~). Der Chunk `592` hat die Datei `common.30034b8ec64a4d94.js` (40.833 Zeichen), **nicht** `592.<hash>.js`: die `runtime` bildet den Namen mit `a.u=e=>(592===e?"common":e)+"."+{…,592:"30034b8ec64a4d94",…}`.
* Anwendung: Webpack/Angular (`fn-client-webapp`, Chunk-Variable `webpackChunkfn_client_webapp`), **Angular 15.2.10** (`new Version("15.2.10")` in `vendor`, Ivy-Ausgabe), `<base href="/">`.
* `runtime.c66b….js` führt die **Chunk-Tabelle**: 42 Lazy-Chunks, darunter **`592` → `common.30034b8ec64a4d94.js`**. ~~Genau diese Datei fehlt im Bestand (siehe 6).~~ Sie liegt seit dem 18.11.2026 bei (Abschnitt 6.1, Abschnitt 7).
* `_brew_.html` (React-Oberfläche) lädt `/brew/brew-assets/index-lKBZAT8Z.js`; diese Datei liegt **nicht** bei. `<meta name="build-time" content="2026-11-17T16:02:21.370Z">`.

## 2. Verfahren (wiederholbar)

Drei Skripte, Ablage `docs/payloads/foodnotify-2026-11/intern/werkzeug/`, jeweils mit `panel_`-Präfix:

```
cd docs/payloads/foodnotify-2026-11/intern/werkzeug
B=../../../../../belege/foodnotify-inventur-2026-11-18/panel
node panel_extrahieren.mjs $B /tmp/panel-roh.json                       # AST-Analyse -> JSON (liest auch common.*.js; Chunk-Name 592)
python3 -I panel_auswerten.py $B /tmp/panel-roh.json ../../../../foodnotify-api-inventar.md ..   # -> vier CSV (+ panel-hosts-rauschen.csv)
node panel_fehlende_module.mjs $B /tmp/panel-fehlend.json               # welche referenzierten Module liegen in keiner Datei? (Erwartung: nur Modul 73)
```

`panel_extrahieren.mjs` benutzt `typescript` aus `node_modules` **nur als Parser** (`ts.createSourceFile`, Syntaxbaum, keine Ausführung, kein Typprüfen). Der Pfad ist Argument 3.
**Änderung am Werkzeug am 18.11.2026:** `panel_extrahieren.mjs` und `panel_auswerten.py` setzen den Chunk-Namen aus dem Dateinamen (`<name>.<hash>.js` → `<name>`). Für `common.<hash>.js` ergab das `common`, die Lazy-Routen verweisen aber auf `592`; deshalb bildet `chunkOf`/`chunk_name` jetzt `common` auf `592` ab (die Schreibweise der `runtime`: `592===e?"common":e`). Ohne diese Abbildung hätte das Werkzeug die Datei gelesen, aber ihre Dienste an keine Route gehängt. `panel_fehlende_module.mjs` zählt Module mit einem oder keinem Parameter jetzt als „definiert“ (pdfmake, Node-Polyfills und Schriften in `545`/`vendor` — sie waren nie fehlend, nur vom Zwei-Parameter-Filter nicht erkannt).
Läuft der alte Bestand (ohne `common`) durch das geänderte Werkzeug, kommt **byte-gleich** die alte `panel-aufrufe.csv` heraus (`cmp` am 18.11.2026): die Änderung verschiebt nichts am Altbestand.
Der Stand der Arbeitskopie lief am 18.11.2026 so durch; ein zweiter Lauf aus dem Ablageordner heraus lieferte dieselben CSV (`diff -r` leer).

Schritte in `panel_extrahieren.mjs`:

1. **Module finden.** Jede Eigenschaft mit mindestens dreistelligem numerischem Namen, deren Wert eine Funktion mit ≥ 2 Parametern ist, gilt als Webpack-Modul. Ergebnis: **979 Einträge, 928 verschiedene Modul-Ids** (27 Ids stehen in mehr als einer Datei — Webpack dupliziert geteilte Module in Lazy-Chunks). Je Modul: `a(ID)`-Importe, `a.e(CHUNK)`, `a.bind(a, ID)`, Export-Tabelle `a.d(exports, {Name: () => x})`.
2. **URL-Bauer symbolisch ausführen.** Die App baut jede Adresse mit einer Hilfsklasse (Modul `64942` in `main`): `urlService.baseApiUrl` (`api`) / `baseUrl` (leer) / `baseAppUrl` (`app`), dann `.push(segment…)`, `.path.push(…)`, `.put(name, wert)`, `.putArray(name, liste)`, am Ende `.serialize()`. Das Werkzeug verfolgt diese Aufrufe in Quellreihenfolge, trägt für jeden Pfadteil seine Herkunft mit (Literal, Methodenparameter, Eigenschaft `x.id`, Speicherschlüssel `alss.getItem("erp.selectedErp")`, Getter `getSelectedErpId()`), und rechnet beim **Aufruf** (`requestService.get|post|put|patch|delete|getText|auth`, `this.http.*`, `this.httpClient.*`, `this.<wrapper>.get(builder)`) die URL aus. Es folgt dabei:
   * **Klassenvererbung** (`class X extends a.I`, `super(arg…)`): `/api/{erpId}/<ressource>` ist die **CRUD-Basisklasse** in Modul `55964` (Chunk `239`; Unterklassen u. a. in `592`: `salesService` `61857`, `stockTransferService` `56917`) mit `index/show/edit/create/store/update/delete/search/paginate`; der Ressourcenname (`"product"`, `"stock"` …) kommt aus dem `super(…)`-Aufruf der Unterklasse. Jede Unterklasse erzeugt eigene Zeilen.
   * **Hilfsmethoden** der eigenen Instanz (`this.getPreUrl()`, `this.getUrl()` mit `this.url = …`) und **Getter** (`get options()`).
   * **Bedingte Zweige** (`if`, `?:`, `&&`, `switch`): Pfadsegmente verzweigen in Varianten, Query-Parameter werden vereinigt; ein `*` am Namen heißt „nur manchmal gesetzt“.
   * **Wrapper-Aufrufe**: wird ein URL-Bauer an einen Dienst mit `get/post/put/delete` übergeben, zählt das als Aufruf.
3. **Links, die kein HttpClient sind.** Jede Zeichenkette, die mit `/api/` beginnt oder `/api/` enthält und nicht in einem HttpClient-Aufruf steckt (`href`, `window.open`, `bypassSecurityTrustUrl`, `this.imageUrl = "…"`), wird gesondert erfasst; nur `api/…`-Pfade kommen in die Aufrufliste.
4. **Routen.** Objektliterale mit Zeichenkettenpfad und `component|loadChildren|children|redirectTo`; `children` wird zum Baum, `loadChildren` (`Promise.all([a.e(…)…]).then(a.bind(a, MODUL))`) wird zur Wurzel des Lazy-Moduls und dessen Routentabelle (im Modul `MODUL`) hängt mit Präfix darunter. Guards (`canActivate` …) werden bis zur Klasse aufgelöst, soweit sie im Bestand liegen.
5. **Parameternamen aus Aufrufern.** Minifizierte Parameter heißen `t, r, n`. Wo möglich, wurde der Name aus den **Aufrufstellen** der Methode abgeleitet (`this.svc.getEventDrinks(this.eventId, …)` → `{eventId}`), nur für nicht-generische Methodennamen und nur, wenn mindestens die Hälfte der Aufrufer dieselbe Eigenschaft liefert. Das ist **abgeleitet, nicht gelesen** (`named(callers)`).
6. **Zuordnung zu Routen.** Ein Aufruf gehört zu den Lazy-Routen, deren Modulkette ihn **am kürzesten** erreicht (Importgraph, `a(ID)`). Tiefe 0/1 ist belastbar, Tiefe 2 ist als Hinweis in der Spalte `note` vermerkt. Geteilte Dienste hängen an vielen Routen; ab sieben wird abgekürzt. **Das ist eine Schlussfolgerung aus der Importkette, kein Beleg, dass die Seite den Aufruf wirklich auslöst.**

`panel_auswerten.py` macht daraus die CSV, vergleicht mit dem alten Inventar und maskiert Schlüsselwerte (sechs Zeichen, dann `…`).

**Vollständigkeitsprobe.** Textuelle Aufrufstellen (`requestService.<verb>(`, `this.http.<verb>(`, `this.httpClient.<verb>(`) per Regex gezählt: **642** (~~621~~; `592` bringt 21 dazu: 18 `requestService`, 3 `httpClient`). Das Werkzeug fand je Aufrufstelle genau einen Aufruf (Chunk für Chunk gleich: **592:21**, 88:16, 125:19, 167:5, 195:17, 239:55, 283:11, 313:6, 330:161, 435:1, 488:37, 545:1, 554:24, 569:7, 605:1, 607:74, 658:1, 733:15, 735:2, 742:41, main:127(+1 Wrapper-Aufruf mit Bauer)). Fehlende Aufrufarten gegengeprüft: `fetch(` und `sendBeacon` kommen im App-Code nicht vor; `XMLHttpRequest`, `EventSource`, `new WebSocket`, `new Worker` nur als Header-Wert bzw. in Bibliotheken (`vendor`, `polyfills`, `545`, `330`).

## 3. Zahlen

| Größe | Wert |
|---|---|
| Aufrufstellen (textuell) | **642** (~~621~~) |
| Aufrufe nach Auswertung (inkl. geerbte Instanzen je Unterklasse) | **884** (~~842~~) |
| davon als Wrapper verworfen (kein eigener Pfad, nur Durchreichen eines Parameters) | 13 (`main` RequestService ×7, Chunk `607` Hilfsklasse ×4, `283` `postImage` ×1, `658` `onMenuOpened` ×1) |
| **verschiedene (Methode, Pfadmuster)** in `panel-aufrufe.csv` | **781** (~~747~~) |
| davon `GET` / `POST` / `PUT` / `DELETE` / `PATCH` | **346 / 229 / 132 / 73 / 1** (~~332 / 217 / 127 / 70 / 1~~) |
| schreibend (POST+PUT+DELETE+PATCH) | **435** (~~415~~) |
| aus HttpClient-Aufrufen / aus Links / von Hand verknüpft / statisches Asset | **776** / 3 / 1 / 1 (~~742~~) |
| Zeilen, die nur durch **Vererbung** der CRUD-Basisklasse entstehen | **187** (~~172~~; nicht belegt, dass die Oberfläche sie nutzt) |
| nicht im alten Inventar (`in_altem_inventar = nein`) | **743** (~~718~~) |
| im alten Inventar (`ja`) | **38** (~~29~~) — die neuen Treffer kommen aus Lagerumbuchung und Verkauf (Chunk `592`), für die das alte Inventar schon Pfade trug |
| davon „Familie im alten Inventar genannt, dieser Pfad nicht“ | **101** (~~79~~) |
| Parameterkonfidenz: `named` / `named(callers)` / `positional` / `none` (keine Pfadparameter) | **169 / 245 / 179 / 188** (~~165 / 230 / 170 / 182~~) |
| Routeneinträge (Anwendung) / Verweise auf `/brew` / Zeilen gesamt in `panel-routen.csv` | 142 / **40** / **182** (~~39 / 181~~; neu: der Verweis `/brew/` aus dem Guard) |
| Lazy-Module (`loadChildren`) | 21 Einträge (`/panel/erp` kommt zweimal vor: `ErpModule` und dessen leere Wurzel `DashboardModule`) |
| externe Hosts (ohne Rauschen) / Zeilen in `panel-hosts.csv` | 18 / 30 |
| Rauschhosts (Doku-Links, XML-Namensräume, Lizenzköpfe) | 33 Hosts, 823 Fundstellen (`panel-hosts-rauschen.csv`) |

Verteilung der Pfadfamilien (Zeilen / schreibend / nicht im alten Inventar): `api/{erpId}/<ressource>` **280**/106/264 (~~270/103/256~~; neu: `sales` mit 10 Zeilen; 22 Pfadköpfe: 20 CRUD-Ressourcen plus `dashboard`, `getProducts`, jetzt auch `sales`),
`api/eventCatering` 246/192/246, `api/pos` 33/18/31, `api/supplier` 26/14/26, `api/erpSettings` 24/18/24, `api/shop` 24/16/23,
`api/menu_creator` 23/8/20, `api/dailyMenu` 19/17/19, `api/erp` **39/20/24** (~~18/6/10~~; neu: 21 Zeilen `api/erp/stock-transfer…`), klassische Pfade ohne `/api` (`/shops/private/…`, `/pos/…`, `/recipes/…`, `/signin_check`, `/signout`, `/password/reset/save`, `/app/…`, `/shop/{id}/cart/…`) **29** (~~27~~). (Die Familien sind die der alten Fassung, fortgeschrieben; der Rest bis 781 sind kleine Einzelfamilien wie `api/dashboard`, `api/cart`, `api/shops`.)

## 4. Lesart der Spalten

* **`path_template`**: `{name}` = Pfadparameter. `{pN}` = der N-te Methodenparameter, Name nicht rückgewinnbar; in der Spalte `note` steht, auf welches Segment er folgt. `{erp.selectedErp}` aus dem Browserspeicher wurde zu `{erpId}` vereinheitlicht. Pfade ohne `/api` sind **klassische serverseitige Routen** (`urlService.baseUrl`).
* **`query_params`**: gelesen aus `.put(name, …)`; `name[]` = Array (`putArray`); `name*` = bedingt gesetzt.
* **`body_fields`**: `a,b` = Objektliteral an der Aufrufstelle; `FormData:x` = `FormData.append("x", …)`; `(Aufrufer) x` = Feld eines Objektliterals an einer **Aufrufstelle** der Dienstmethode (abgeleitet, Vereinigung über Aufrufer); leer = nicht ableitbar (Wert aus Formular, Variable oder generischer Methode), dann steht ein Hinweis in `note`.
* **`chunks`**: Chunk, in dem der Code liegt; bei geerbten Zeilen auch der Chunk der Unterklasse. **`routes`**: siehe 2.6.
* **`param_confidence`**: `named` (Name aus dem Code an der Stelle), `named(callers)` (aus Aufrufern, abgeleitet), `positional` (mindestens ein `{pN}`), `none` (keine Pfadparameter).
* **`in_altem_inventar`**: Der Pfad kommt in `docs/foodnotify-api-inventar.md` vor, verglichen nach Normalisierung (Parameter → `*`, Kleinschreibung, ohne Query, mit der dortigen Kurzschreibweise „`+ /{id} /products`“ aufgelöst). `ja` ist streng — fehlt der exakte Pfad, steht `nein`, auch wenn die Familie dort steht (dann Vermerk in `note`).

## 5. Nicht-API-Verweise der App (nur Hinweis)

Serverseitig gerenderte Oberflächenseiten, aus denen die App Fenster öffnet (`window.open`): `recipes/view/{id}/{titel}`, `recipes/edit/{id}/{titel}`, `shop/{shopId}/{x}`, `shop/{shopId}/favorites`, `users/edit/{uid}`, `panel/catering/settings/templates`; Bilder `i/r/{pfad}` (Rezeptbilder, relativ zu `https://my.foodnotify.com`), `/api/eventCatering/images/EventStaff/{datei}`.
Den Pfad `recipes/ppaPrice/{id}/unit/{x}` (`167`, `313`) bildet die App nur in `console.log` — ein Aufruf entsteht dort nicht.

## 6. Was nicht rückgewinnbar ist (Lücken)

1. ~~**Chunk `592` (`common.30034b8ec64a4d94.js`) fehlt.** … **37 Modul-Ids** werden aus vorhandenen Chunks angesprochen, aber in keinem vorhandenen definiert … **Alle Endpunkte dieser Dienste fehlen im Inventar**~~ **Geschlossen am 18.11.2026.** Der Chunk liegt bei (`common.30034b8ec64a4d94.js`, 40.833 Zeichen) und wurde eingearbeitet. Er definiert **23 Webpack-Module** (`13596 86753 99165 91693 30435 97952 9058 67487 36872 79193 86108 88407 61857 56917 50704 29127 26553 91575 58253 90327 7923 75866 65459`). Die übrigen 14 der damals 37 „fehlenden“ Ids waren **nie fehlend**: `41660` (pdfmake), `50786` (Roboto-Schriften für pdfmake), `9964 64785 34097 38347 15366 2416 77199 72155 10884` (Node-Polyfills und Hilfsmodule: `process`, `events`, Brotli, `util`, …) liegen als Module mit **einem oder keinem Parameter** in `545`, `98772`/`62716` in `vendor`; der Zwei-Parameter-Filter der Modulsuche hat sie übersehen. Eine Id bleibt in `panel_fehlende_module.mjs` übrig: `73` (liegt in `vendor` als `(Xe,ge,y)=>…`, vom Werkzeug in einer größeren Tabelle nicht einzeln erkannt; sie liefert `h`, im Aufrufer `239` und `vendor` benutzt, kein HTTP).
   **Was in `592` steht (gelesen):**
   * `61857` **`salesService`** (Unterklasse der CRUD-Basisklasse, Ressource `sales`): `paginate`, `finish` (**`GET /api/{erpId}/sales/{id}/finish`** — siehe `messliste-token.md`), `paginateRelatedRecipeSales` (`GET …/sales/{id}/recipe-sale`) und die geerbten CRUD-Zeilen. 10 neue Zeilen.
   * `56917` **`stockTransferService`** (Ressource `stock-transfer`, **ohne** `{erpId}` im Pfad: `/api/erp/stock-transfer…`): `paginateStockTransfer`, `paginateStockTransferProducts`, `initStockTransfer` (`POST …/initiate`, Body `fromErpId,toErpId`), `addProductForStockTransfer`, `removeProductFromStockTransfer`, `updateStockTransferProduct`, `toggleStockTransferProductChecked`, `acceptStockTransfer`, `acceptStockTransferAll`/`acceptAllAndTransfer`/`waitForApproval` (`POST …/accept-all`), `updateStockTransferStatus` (`POST …/finish|reject|cancel`, sonst `GET …/{id}`). 21 neue Zeilen. Auffällig: Der Pfadparameter heißt im Code `stockTranferId` (Tippfehler im Quelltext, übernommen).
   * `50704` **`reorderService`** (Warenkorb): `POST /shop/{id}/cart/{id}/update` (Query `_confirmed`), `POST /shop/{id}/cart/{id}/update/{id}` (klassische Route, `httpClient`, `withCredentials`), `PUT /api/{id}/product/{id}/set-preferred-shop-unit`. 3 neue Zeilen.
   * `13596` **`brewPath`-Guard**: `window.location.href = <reactFrontendDomain>/brew/<data.brewPath, :param aus der Route ersetzt>(?query)`, danach `false` — eine **Weiterleitung auf die neue Oberfläche, kein API-Aufruf**. Bestätigt die Vermutung aus dem ersten Lauf („aus dem Namen geschlossen“). `panel-routen.csv` führt den Guard jetzt als gelesen.
   * `86753` Zähler-Komponente (Plus/Minus mit Entprellung), `99165 91693 30435 97952 9058 67487 36872 79193 86108 88407 90327 7923 75866 65459` (Komponenten, Pipes, Hilfsklassen — nach Form und Namen eingeordnet, nicht einzeln gelesen), `29127 91575 26553 58253` Zustandsdienste der Seitenleisten (Kategorie, Lager, Bestellung). **Kein** HTTP-Aufruf in diesen 20 Modulen; die 21 Aufrufstellen des Chunks liegen alle in den drei Diensten oben (21 Aufrufstellen insgesamt).
   Neu gefundene Aufrufe: Abschnitt 7. Der Chunk enthält **keine** Berechtigungs-, Rollen- oder Speicherzugriffe (`allowedModules`, `roles`, `localStorage` nicht vorhanden), `panel-auth.md` ändert sich deshalb nur beim Guard.
2. **Antwortformen.** Das Bundle trägt keine Typen; welche Felder eine Antwort hat, steht nur dort, wo die App sie liest (`payload.ticket`, `payload.data`, `payload.views`). Antwortzeilen sind **nicht** erfasst. Zwei Hüllen sind im Code sichtbar: `{payload: …}` (viele `payload`-Zugriffe in `607`, `605`, `735`) und nackte Objekte.
3. **Body-Felder** bei vielen schreibenden Aufrufen: der Dienst reicht einen Parameter durch, das Objekt entsteht in der Komponente oder kommt aus einem Formular (`formGroup.value`). Für 415 schreibende Zeilen sind Felder nur dort gelistet, wo ein Objektliteral an einer Aufrufstelle steht. **Leer heißt nicht „kein Body“.**
4. **170 Zeilen mit `{pN}`**: kein Name rückgewinnbar. Bei den CRUD-Pfaden (`show/update/delete`) ist `{p1}` nach dem Muster der Basisklasse die Datensatz-Id (geschlossen).
5. **Dynamische Ziele**: `658` `onMenuOpened` ruft `GET <n.load>` (Antwort als Text) auf — das Ziel kommt zur Laufzeit aus Menüdaten; `283` `postImage(url, …)` bekommt die URL als Parameter (von Hand verknüpft: `POST /api/menu_creator/mc_image/upload`, Body `FormData imageFile, imageType`, aus der Komponente `this.imageUrl`).
6. **Routenzuordnung** ist Importkette, nicht Ablaufbeleg (2.6). Aufrufe aus `main` (Dienste im Root) haben bei Tiefe > 1 keine eindeutige Route; die Spalte `routes` ist dann leer oder lang.
7. **Server-Rendered-Routen** (`/shops/private/…`, `/supplier/…`, `/recipes/…`): nur die Client-Seite des Aufrufs ist sichtbar; Antworten, Parameter der Gegenseite, Rechtegrenzen nicht.
8. **Zustand, ob ein Pfad heute noch existiert.** Nichts wurde aufgerufen. Besonders die 172 geerbten Zeilen sind Möglichkeiten der Basisklasse, keine nachgewiesenen Aufrufe.
9. **Übersetzungsdateien** (`/assets/i18n/**`, 33 Dateien) liegen nicht bei und wurden nicht gelesen; die Fachbegriffe der Oberfläche (z. B. Berechtigungsnamen) sind deshalb nur aus Schlüsselnamen sichtbar.
10. **Gleap-Zugriffsschlüssel, Cookie-Eigenschaften, serverseitige Rechteprüfung**: nicht im Code (`panel-auth.md` §9).
11. **Die React-Oberfläche `/brew`** (`index-lKBZAT8Z.js`) ist nicht Teil dieses Bestands; alle `/brew`-Verweise stehen nur als Verweise in `panel-routen.csv`.
12. **GET mit Zustandsänderung** ist **nach dem Namen** vermutet (Wörter wie `unlink`, `remove`, `cancel`, `delete`, `confirm` im Pfad), nicht belegt; 6 Zeilen tragen den Vermerk. **Kein** dieser Pfade wurde aufgerufen. **Die Namensliste ist zu eng:** `GET /api/{erpId}/sales/{id}/finish` (neu aus `592`) trägt den Vermerk nicht, weil `finish` nicht in der Liste steht. Die vollständige, am Code belegte Liste der zustandsändernden GETs (mit Fundstelle) steht in `messliste-token.md`; sie ersetzt diese Zeile.

## 7. Nachtrag 18.11.2026: Chunk 592 eingearbeitet (vorher / nachher)

Stand vom zweiten Lauf, wieder **ohne Aufruf gegen FoodNotify**. Der Vorher-Wert ist nachgemessen, nicht übernommen: das geänderte Werkzeug lief auch gegen den Bestand **ohne** `common.*.js` und lieferte die alte `panel-aufrufe.csv` byte-gleich.

| Größe | vorher (ohne 592) | nachher (mit 592) |
|---|---|---|
| JavaScript-Dateien im Bestand | 45 | 46 |
| Webpack-Module erkannt (Zwei-Parameter-Filter) | 979 Einträge / 928 Ids | 1.002 Einträge (+23 aus 592) |
| referenzierte, in keiner Datei gefundene Module | 37 | 1 (`73`, Werkzeug-Eigenheit, siehe 6.1) — von 37 waren 23 echt aus 592, 13 vom Filter übersehen |
| Aufrufstellen textuell | 621 | 642 |
| Aufrufe nach Auswertung | 842 | 884 |
| Zeilen `panel-aufrufe.csv` | 747 | **781** (+34, keine verloren, 2 Zeilen bekamen nur `592` in `chunks`) |
| GET / POST / PUT / DELETE / PATCH | 332/217/127/70/1 | 346/229/132/73/1 |
| schreibend | 415 | 435 |
| im alten Inventar `ja` / `nein` | 29 / 718 | 38 / 743 |
| nur geerbt (CRUD) | 172 | 187 |
| Zeilen `panel-routen.csv` | 181 | 182 (+ Verweis `/brew/`) |
| Hosts, Rauschhosts | 30, 33 | 30, 33 (unverändert) |

**Die 34 neuen Zeilen.** Alle `chunks` = `592` oder `239,592` (geerbt).

`stockTransferService` (`/api/erp/stock-transfer`, 21 Zeilen):
`GET …/stock-transfer` (Query `erpId,status*,page,limit`), `POST …/stock-transfer`, `GET …/create`, `POST …/initiate` (Body `fromErpId,toErpId`), `GET …/paginate`, `GET …/search`, `POST …/{id}/products`, `PUT …/{id}/products/{id}`, `DELETE …/{p1}`, `GET …/{p1}`, `PUT …/{p1}`, `POST …/{p1}/accept-all`, `GET …/{p1}/edit`, `GET …/{stockTranferId}`, `POST …/{stockTranferId}/accept`, `…/accept-all`, `…/cancel`, `…/finish`, `…/reject`, `DELETE …/{stockTranferId}/products/{id}`, `PUT …/{stockTranferId}/products/{id}/checked`.

`salesService` (`/api/{erpId}/sales`, 10 Zeilen):
`GET …/sales` (Query `page,page_size,order_by,order_direction,from*,to*,status*`), `POST …/sales`, `GET …/create`, `GET …/search`, **`GET …/{id}/finish`**, `GET …/{id}/recipe-sale` (Query `page,page_size,order_by*,order_direction*`), `DELETE …/{p1}`, `GET …/{p1}`, `PUT …/{p1}`, `GET …/{p1}/edit`.

`reorderService` (3 Zeilen): `PUT /api/{id}/product/{id}/set-preferred-shop-unit`, `POST /shop/{id}/cart/{id}/update` (Query `_confirmed`), `POST /shop/{id}/cart/{id}/update/{id}`.

Zwei bestehende Zeilen (`POST /api/erp/catalog/bulk-delete`, `PUT /api/{erpId}/product-group/{id}/removeProduct/{id}`) tragen nun `592` in `chunks`: die Unterklasse liegt dort, der Pfad war schon bekannt.

**Was zu bleibt / nicht geschlossen ist:** Lücken 6.2 bis 6.11 unverändert (Antwortformen, Body-Felder, `{pN}`, dynamische Ziele, Routenzuordnung als Importkette, Server-Rendered-Routen, Existenz, Übersetzungen, Auth-Serverseite, `/brew`). Mit `592` neu dazu: 9 der 21 Zeilen der Lagerumbuchung und 8 der 10 Zeilen `sales` tragen den Vermerk „geerbt“ (CRUD-Basisklasse) (Pfade, die die Oberfläche vielleicht nie ruft); belegt gerufen sind nur die in 6.1 genannten Methoden.
