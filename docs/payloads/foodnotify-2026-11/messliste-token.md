# Messliste für das Scope-Token (nur Liste, nichts gemessen)

Erstellt am 18.11.2026, **ohne einen Aufruf gegen FoodNotify**. Die Liste `messliste-token.csv` sagt, welche GET-Pfade man dem Token (`Authorization: Bearer`, Scopes `recipe:read menu:read catering-card:read user-ingredient:read shop:read erp-product:read stocktaking:read order:read catering:read analytics:read pos:read user:read`) überhaupt vorlegen darf. Sie beantwortet **nicht**, welche Pfade das Token annimmt.

**Wer diese Liste benutzt, liest zuerst Abschnitt 4.** Er führt die GETs auf, die etwas verändern, und ist als Sicherheitsdokument für spätere Agenten gedacht: *diese GETs nie automatisch aufrufen*.

## 1. Wie die Liste entstand

* Eingang: alle Zeilen mit Methode `GET` aus `intern/brew-aufrufe.csv` (213), `intern/panel-aufrufe.csv` (346, Stand nach dem Nachtrag zu Chunk 592) und `openapi/operationen.csv` (107) — zusammen 666 Zeilen.
* **Eindeutig gemacht** wird über den kleingeschriebenen Pfad, in dem jeder `{Platzhalter}` zu `{}` wird. Ergebnis: **574 Pfadvorlagen**. Je Vorlage steht in `quellen`, wo sie vorkommt (`brew`, `panel`, `offiziell`). Die Schreibweise und die Parameternamen kommen aus der besten Quelle (offiziell vor brew vor panel; ein gelesener Name vor einem abgeleiteten, `{id}`/`{p1}` zuletzt).
* **Parameter und Herkunft.** `parameter` nennt die Pfadparameter, `parameter_quelle` je Parameter `name=Art` mit Art = `connectionId`, `erpId`, `costCenterId`, `restaurantId`, `userId` (aus unseren Daten bekannt) oder `unbekannt`. Eine Art wird nur vergeben, wenn der Name im Code **gelesen** ist (`param_confidence = named`), oder bei `/api/{erpId}/…` an erster Stelle (kommt aus `getSelectedErpId()`). Von Hand festgelegt, mit Beleg im Skript: POS-Konto-Kennung bei `/api/pos/mapping/{mappingId}/…` (brew-methode.md), `/api/1.0/pos/{id}` = „Get one account“, `/api/1.0/user/restaurants/{id}`, `costCenterId` bei `/api/eventCatering/eventOrder/costCenter/{id}/carts`. `masterUserId` zählt **nicht** als `userId` (22 Pfade) — vermutlich dasselbe, aber nicht belegt. Wer das klärt, gewinnt 21 weitere messbare Pfade.
* `query_noetig`: Query-Parameter, die der Client **immer** mitschickt (brew/panel) bzw. die die Spezifikation als Pflicht ausweist. Das ist kein Beleg, dass der Server sie braucht.
* **Klassen** sind Handarbeit mit Beleg im Bundle-Code (Abschnitt 4 für die gefährlichen). Sie stehen als Tabellen in `intern/werkzeug/messliste_bauen.py`:

  ```
  python3 -I -B intern/werkzeug/messliste_bauen.py . messliste-token.csv     (aus diesem Ordner)
  ```

  Existiert die Ausgabedatei schon, gelten nur deren Pfade als geprüft; **jeder neue GET-Pfad wird `unklar`/`nein` ausgegeben** und gemeldet, bis jemand ihn im Code angesehen und eine Tabelle ergänzt hat. Eine neue Zeile soll nie still als `lesend` landen.
* Sortierung: `messen = ja` zuerst, dann nach den ersten drei Pfadsegmenten.

## 2. Klassen

| Klasse | Bedeutung | messen |
|---|---|---|
| `lesend` | liest, im Code aus einer Abfrage/einem Laden gerufen oder durch den Namen als Lesen ausgewiesen | `ja`, **wenn** alle Pfadparameter aus den bekannten Arten füllbar sind oder keine existieren; sonst `nein` (Grund: „Parameter unbekannt: …“) |
| `download` | liefert eine Datei (xlsx, pdf, Export, Blob) | `nein` |
| `zustandsaendernd` | GET, dessen Name oder umgebender Code eine Wirkung zeigt (Abmelden, Verknüpfung lösen, Import, Neuladen aus dem Kassensystem …) | `nein` |
| `personenbezogen` | Benutzer, Unterkonten, Personal, Kunden, Profil, Sicherheitsrichtlinie, Token-Verwaltung, Kontaktadressen | `nein` |
| `unklar` | Wirkung oder Antwort aus dem Code nicht eindeutig; dazu alle geerbten `…/create` und `…/new` | `nein` |

Im Zweifel steht `unklar` oder `zustandsaendernd`, nicht `lesend`.

## 3. Zahlen (Stand 18.11.2026)

**574 Pfadvorlagen.** Je Klasse: `lesend` 484, `personenbezogen` 39, `unklar` 30, `zustandsaendernd` 14, `download` 7.

Je Quelle (ein Pfad kann in mehreren stehen; exklusiv: brew 125, panel 254, offiziell 107, brew und panel 88):

| Quelle | Pfade | lesend | personenbezogen | unklar | zustandsaendernd | download |
|---|---|---|---|---|---|---|
| brew | 213 | 172 | 24 | 5 | 8 | 4 |
| panel | 342 | 284 | 10 | 28 | 14 | 6 |
| offiziell | 107 | 102 | 5 | 0 | 0 | 0 |

(Die 22 geerbten `…/create` und die 2 `…/new` sind `unklar` und stehen nur im Panel.)

**`messen = ja`: 226** — **123 ohne** Pfadparameter, **103 mit** füllbaren (82 `erpId`, 16 `connectionId`, 2 `restaurantId`, 2 `costCenterId`, 1 `userId`). Nach Quelle: panel 138, brew 92, offiziell 40 (mit Überschneidung).
Davon sind **42 schon gemessen oder durch die Familie abgedeckt** (Spalte `grund`): 32 aus `/api/1.0/*` (Familie getestet: 403, nicht jeder Pfad einzeln), 4 mit 200 (`/api/2.0/pos/accounts/{id}/products|product-groups|invoices`, `/api/v2/analytics`), 6 mit 403 (`/api/2.0/erp/stock/*` ×3, `/api/erp/all`, `/api/pos/locations`, `/api/erp/stocktakings`). **Neu zu messen: 184.** 53 der 226 sind nur geerbte CRUD-Zeilen des Panels (Basisklasse `55964`); ob die Oberfläche sie überhaupt ruft, ist nicht belegt — ein 404 ist dort kein Befund über das Token.

`messen = nein` (348): lesend mit unbekanntem Parameter 258, personenbezogen 39, unklar 30, zustandsaendernd 14, download 7.

## 4. Sicherheitsdokument: GETs, die etwas verändern

**Diese GETs nie automatisch aufrufen — weder in einer Messschleife noch „nur zum Testen“, weder mit Token noch mit Sitzung.** Der Name ist bei FoodNotify kein Hinweis auf die Methode: Die alte Oberfläche (Angular, „Panel“) schickt Aktionen oft als GET. Fundstelle ist der Chunk der alten Oberfläche (`belege/foodnotify-inventur-2026-11-18/panel/<chunk>.<hash>.js`) bzw. die neue (`…/brew/<datei>.js`); die Auszüge sind gekürzt.

| # | GET-Pfad | Fundstelle und Auszug |
|---|---|---|
| 1 | `/app/lang` | `main`: `d.onLangChange.subscribe(A=>{…K.push("lang"),K.put("lang",A.lang),O.get(K.serialize()).subscribe({next:()=>{q.lang=A.lang…` — setzt die Sprache des Benutzers. brew: Registerschlüssel `setLanguage` |
| 2 | `/app/switch-design-mode` | `main`: `updateDesignModeForUser(i,…){…u.push("switch-design-mode"),u.put("designMode",i),…requestService.get(…)}`, gerufen aus `switch(r,n){…this.navbarService.updateDesignModeForUser(r,()=>{})}` — speichert die Darstellung. brew: `setTheme` |
| 3 | `/api/security_logout` | `main`: `logout(){…g.push("security_logout"),this.requestService.get(g.serialize()).pipe((0,f.U)(()=>{t.Z.clearIdentity()})…` — beendet die Sitzung |
| 4 | `/api/erp/last-used/{id}` | `main`: `setLastUsed(t,…){…e.push("erp"),e.push("last-used"),e.push(t),…requestService.get(…)}`; `239`: `….setLastUsed(n.id,()=>{this.rememberRecent(t),this.erpSelectedStateService.select(n)},r=>console.error("Switching the location failed"`. brew `index-lKBZAT8Z`: `erpSetLastUsed:e=>\`/api/erp/last-used/${e}\`` — merkt den zuletzt benutzten Betrieb am Server |
| 5 | `/api/pos/connection/unlink/{connectionId}` | `742`: `unlinkConnection(e,…){…c.push("pos"),c.push("connection"),c.push("unlink"),c.push(e),…requestService.get(…)}`, Aufrufer `unlink(){this.unlinking=!0,this.subs.add(this.posConfigService.unlinkConnection(this.editData.connectionId,e=>{…location.href="/panel/settings/pos/locations"` — löst die Kassenverbindung |
| 6 | `/api/pos/product/unlink/all/{connectionId}` | `742`: `unlinkAll(e,…){…c.push("product"),c.push("unlink"),c.push("all"),c.push(e)…requestService.get(…)}`, Aufrufer `unlinkExistingForLocation(e){…this.posSyncService.unlinkAll(e.connectionId,o=>{e.posItems.forEach(i=>{i.posItemId=null,i.posItemName=null…` — löst **alle** Produktverknüpfungen |
| 7 | `/api/pos/sync/reload/{connectionId}` | `742`: `reloadFromPos(e,…){…c.push("sync"),c.push("reload"),c.push(e),…requestService.get(…)}`, Aufrufer ein Klick-Handler (`t.KtG(s.reloadFromPos(i))`) und `reloadFromPos(e){this.reloadingPos=!0,…}`. brew `index-DoHMxaL6`: `static async reloadInventory(a){await ee.get(W.posReloadInventory(a))}` — lädt den Bestand aus dem Kassensystem nach |
| 8 | `/api/pos/ikentoo/businessData/{connectionId}/{blId}` | `742`: `storeBusinessLocation(e,o,i,s,c){…a.push("businessData"),a.push(e),a.push(o),…requestService.get(…)}`, Aufrufer `selectBusinessLocation(e,o){…this.posService.storeBusinessLocation(o.connectionId,e.blId,i=>{this.selectingBusinessLocation=!0,…` — **speichert** die gewählte Betriebsstätte (der GET ohne `{blId}` ist nur die Liste, aber `unklar`) |
| 9 | `/api/{erpId}/sales/{id}/finish` | `592` (`common`): `finish(h,s,_,l){const n=this.getPreUrl();return n.path.push(h),n.path.push("finish"),…this.requestService.get(n.serialize())…}`; `167`: `clickFinish(){this.service.finish(this.data.id,t=>{window.history.length>1?this.location.back():this.router.navigate(["/panel/erp/sale"])})}`; brew `sheet-chrome-DM6kbuiB`: ``U=(e,t)=>i(`/api/${e}/sales/${t}/finish`)`` — schließt einen Verkauf ab. Das Vermerks-Muster des Inventars (`GET mit Namen einer Zustandsaenderung`) erkennt `finish` nicht |
| 10 | `/api/menucreator/{id}/generate-embedded-url` | `283`: ``generateEmbeddedUrl(e){this.httpClient.get(`/api/menucreator/${e}/generate-embedded-url`).subscribe(t=>{window.open(t.url,"_blank")})}``, Klick-Handler `t.generateEmbeddedUrl(t.menu.id)` — erzeugt eine Einbettungs-URL |
| 11 | `/shops/private/cancel-import` | `488`: `cancelProductImport(){…r.push("shops"),r.push("private"),r.push("cancel-import"),this.http.get(r.serialize(),{withCredentials:!0})…` — bricht einen Produktimport ab (Aufrufer nicht gefunden; aus Name und Pfad geschlossen) |
| 12 | `/shops/private/{shopId}/edited_file/upload` | `488`: `productImport(r){…i.push("edited_file"),i.push("upload"),this.http.get(i.serialize(),{withCredentials:!0,reportProgress:!0,observe:"events"})…}`, Aufrufer `startImporting(){this.importStep++,this.productImportEmitter=this.supplierProductsImportService.productImport(this.selectedUserShop.shopId).subscribe(…continue_upload_url…` — **startet** den Import |
| 13 | `/shops/private/{shopId}/product/{productId}/image/remove` | `488`: `removeProductImage(r,i,o,a,c,s){…l.push("image"),l.push("remove"),null!=s&&l.push(s),l.put("_confirmed",1),…requestService.get(…)}`, Aufrufer hinter `showDeleteCancelModal("supplier.productDetails.removeImageConfirm")` — löscht ein Produktbild |
| 14 | `/shops/private/{shopId}/product/{productId}/image/remove/{p6}` | wie 13 (zweites Segment `s` = zusätzliche Kennung) |

**Kein GET-Aufruf im Inventar, aber im Bundle:** `userLoginAs:"/recipes?_switch_user={email}"` in `brew/legacy-system-url-DtY5iCT3.js` (Verwaltungsbereich `admin`). Das ist ein **Link auf eine Seite** (Anmelden als anderer Benutzer, Symfony-`_switch_user`), kein API-Aufruf, und steht deshalb nicht in der CSV. Es gilt dasselbe: nie aufrufen.

**Namensverdächtig, im Code aber als Lesen belegt** (klasse `lesend`; die Beobachtung gilt für den Aufrufer, nicht für eine Garantie des Servers):

* `/api/pos/sync/locations`, `/api/pos/sync/user/distinct_categories` — `getLocationsData()`/`getDistinctCategories()` füllen beim Öffnen eines Dialogs Listen; die Aktionen daneben (`syncAllProductsControl`, `productSyncControl`) sind POST.
* `/api/pos/export/without_reload/{id}` — das Gegenstück zu `/api/pos/export/{id}`, das **nicht** freigegeben ist (`unklar`: der Name nennt „ohne Nachladen“).
* `/api/pos/mapping/{id}/jobs/active` und `…/jobs/{jobId}`, `/api/recipe/ingredients/erp-copy-jobs/{id}`, `/api/shop/shopping-list/copy-to-cost-center/jobs/{id}` — Abfragen des Zustands eines Jobs (`getActiveBulkJob` liefert 204 ohne Job; `getBulkJobStatus` mit `sinceTs`). Gestartet werden die Jobs per POST. `/api/erp/stock-transfer/{id}/status`: `pollStockTransferStatus`.
* `/api/erp/stock-transfer/notifications/{id}` — `queryKey: ["stock-transfer-main-indicator",…]`, `refetchInterval: 3e4` (Anzeige im Menü).
* `/api/recipes/settings/{id}/recipes/deletion-request` — `queryFn` lädt die Zähler; die Anfrage zum Löschen ist ein POST (`requestRecipeDeletion`). Ebenso `…/deletability`, `check-delivery-notice-number`, `shoppinglistproductsavailability` (`checkIfProductIsAvailable`).
* `/api/{erpId}/stocktaking/{id}/stocktaking-change` (`…Automatic`) — `loadData()`, nur Lesen.
* `/api/erp/stock-transfer/{id}` — wird auch aus `updateStockTransferStatus` gerufen, aber nur im Rückfallzweig *ohne* Statuswechsel (`finish`/`reject`/`cancel` sind POST); als Lesen eingestuft.

**Nachtrag 18.11.2026 — Seiten lösen diese GETs selbst aus.** Beim Menü-Durchgang hat das bloße Öffnen der Seite `/brew/erp/7984` den GET Nr. 4 (`/api/erp/last-used/7984`) abgesetzt; das Konto Wilma Wunder führt seitdem 7984 statt 11035 als zuletzt benutzten Betrieb. Diese Liste schützt vor **direkten** Aufrufen, nicht vor Seiten, die solche Aufrufe beim Laden absetzen. Die Route `/erp/{erpId}` ohne Unterseite nie automatisch öffnen; vor jedem Seitendurchgang die Seiten gegen diese Liste prüfen (`menue-durchgang-2026-11-18.md`, `docs/foodnotify-api-inventar-intern-2026-11.md` §6, `docs/fehlerkatalog.md`).

## 5. Zeilen, bei denen die Einstufung unsicher ist

* **`unklar` mit Grund in der CSV:** `/api/pos/export/{id}` (lädt vermutlich aus dem Kassensystem nach), `/api/pos/ikentoo/businessData/{id}` (Verbindungsassistent), `/pos/sellpick/stores` (gibt `clientName` an einen Drittanbieter), `/api/v2/analytics/token` (stellt ein Tableau-Token aus), `/api/user/oauth/consent-context`, `/api/{erpId}/stocktaking/{id}/print`, `…/menu_card/new`, `…/eventStaff/new` und 22 geerbte `…/create`.
* **Eher konservativ als personenbezogen eingestuft:** `/api/core/business/{id}/invoice-email`, `/api/user/api-tokens` (Liste der Token des eigenen Kontos), `/api/subuser-roles`, `/api/subuser-permissions`, `/api/erp/profile`, `/api/profile`, alle Veranstaltungs-Pfade mit `staff`/`customer`. `/api/1.0/user` („Get Current User“) steht als `lesend`, weil nur das eigene Konto.
* **`masterUserId`** (22 Pfade, 21 lesend) ist mit `userId` vermutlich identisch; nicht belegt, deshalb `unbekannt`.
* **Parameternamen aus dem Panel** (`{p1}`, `{id}`) sind abgeleitet; die Art ist nur dort vergeben, wo ein Name gelesen wurde. `{erpId}` an erster Stelle ist über `getSelectedErpId()` belegt.
* Alles hier stammt aus statischem Lesen; **kein einziger Pfad wurde aufgerufen**.
