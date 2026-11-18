# FoodNotify "/brew": Anmeldung, API-Token, OAuth, Rechte

Statische Lesung der 340 Bundle-Dateien vom 18.11.2026 (`belege/foodnotify-inventur-2026-11-18/brew/`).
Nichts wurde ausgeführt, kein Aufruf gegen FoodNotify. Verfahren und Grenzen: `brew-methode.md`.

Kennzeichnung: **gelesen** = steht so im Code, Chunk-Datei als Beleg. **geschlossen** = Folgerung aus dem Gelesenen, kann falsch sein.

---

## 1. Wie die Oberfläche sich dem Backend gegenüber ausweist

Alle Angaben **gelesen** in `index-lKBZAT8Z.js` (Einstiegs-Chunk), soweit nicht anders vermerkt.

| Punkt | Befund |
|---|---|
| HTTP-Schicht | axios-Instanz mit `baseURL = VITE_API_DOMAIN`, `timeout = 120000`, `withCredentials = true`, Standard-Header `X-Client-Type: react`. Darüber die Klasse `ot` (`get/put/patch/post/delete`), die `Accept: application/json` und, außer bei `FormData`, `Content-Type: application/json` setzt. |
| API-Basis | `VITE_API_DOMAIN`, `VITE_BASE_DOMAIN`, `VITE_IMAGE_DOMAIN` werden zur Laufzeit auf `window.location.origin` gesetzt. Die Oberfläche spricht also **denselben Ursprung** an, von dem sie ausgeliefert wird. Es gibt keinen eigenen API-Host im Bundle. |
| Sitzung | Cookie (`withCredentials`). Name des Cookies steht nicht im Bundle. Es gibt **keinen** `Authorization`-Header und kein Token im Browser-Code (Suche: `Bearer`, `bearer`, `Authorization`, `x-api-key`: keine Treffer außerhalb von axios selbst). |
| 401 | Antwort-Interceptor: bei 401 Weiterleitung auf `/brew/login?redirect=<aktueller Pfad>`, **außer** die Antwort trägt `type` = `LoginSetup`, `LoginChallenge` oder `LoginSuccess`, oder der Aufruf ist `/app/is-authenticated`. |
| Fehlerform | Interceptor liest `response.data.title` und `detail`/`message` (Problem-Details-Form). Einzelne Aufrufe setzen `X-Accept-Error: application/problem+json` (`problem-json-CwR0LPd6.js`, `locations-tones-CIUmbmUn.js`). Beispiel für einen Problemtyp: `urn:foodnotify:problem:email-not-confirmed` (`login-CnPqt-Ro.js`). |
| Altsystem-Aufrufe | `legacy-http-CfXkuvQ-.js`: Antworten in der Hülle `{isError, payload, errors}` (bei `isError` wird geworfen, sonst `payload` ausgegeben); Query-Parameter als `URLSearchParams`, Arrays als `name[]`; optional Header `X-Requested-With: XMLHttpRequest` und Formular-Kodierung (`FormData`). Einzelner Aufruf mit `responseType: "text"` + `X-Requested-With` in `use-error-toast-CqzE9-UG.js` (liefert HTML-Fragment). |
| CSRF | Für die XHR-Aufrufe ist **kein** CSRF-Header im Bundle. Ein CSRF-Token gibt es nur im OAuth-Zustimmungsformular (Abschnitt 3): Feld `_token`, Wert aus `consent-context` (`index-nrT8yg1O.js`). Ob der Server die XHR-Aufrufe anders schützt (SameSite, `X-Client-Type`), ist hier nicht ablesbar. |
| Wiederholrate | `retry-after`-Header wird nur beim POS-Massenjob gelesen (`startBulkJob`, `index-DoHMxaL6.js`); sonst keine Drosselung im Client sichtbar. |

### Anmeldung und Zwei-Faktor (alle gelesen, Zeilen in `brew-aufrufe.csv`)

| Aufruf | Körper | Beleg |
|---|---|---|
| `GET /app/is-authenticated` | – (liefert den Benutzer, siehe Abschnitt 4) | `authenticated-DRWpnZ1I.js`, `route-CJcc_hgD.js`, `confirm-C5QnbFKf.js` |
| `POST /api/user/auth/signin_check` | `email, password, rememberMe`; Antwort `type` = `LoginSuccess` / `LoginChallenge` / `LoginSetup` | `login-CnPqt-Ro.js` |
| `POST /api/user/auth/2fa/check` | `authCode, provider, trustedDevice` | `authenticated-DRWpnZ1I.js` |
| `GET /api/user/auth/users/{userId}` | Übersicht der 2FA-Anbieter (`availableProviders`) | `authenticated-DRWpnZ1I.js` |
| `POST /api/user/auth/users/{userId}/2fa/totp/setup`, `PUT …/2fa/totp/setup` | PUT: `secret, authCode` | `authenticated-DRWpnZ1I.js` |
| `POST …/2fa/email/send`, `PUT …/2fa/email/setup` | PUT: `authCode` | `authenticated-DRWpnZ1I.js` |
| `DELETE …/2fa/totp`, `DELETE …/2fa/email`, `POST …/2fa/trusted-devices/invalidate`, `POST …/2fa/reset` | – | `user-form-page-DsP1o75V.js`, `index-C_S_dUhD.js` |
| `GET/PUT /api/user/auth/users/{userId}/security-policy` | PUT: `policy` | `index-D3MzMQrv.js` |
| `POST /api/user/auth/email-confirmation/resend` | `email`; 429 wird als "zu oft angefragt" behandelt | `login-CnPqt-Ro.js` |
| `POST /api/password/reset/save` | `_username` | `index-D36wIzdN.js` |
| `POST /signout` | – (Fehler werden ignoriert, danach Weiterleitung) | `utils-6-7npBjb.js` |
| `GET /app/lang?lang=…`, `GET /app/switch-design-mode?designMode=…` | – (Registernamen `setLanguage`, `setTheme`; per GET aufgerufen. **Geschlossen:** verändern die Benutzereinstellung, also eine Zustandsänderung per GET) | `route-CJcc_hgD.js` |

Zwei Anbieter für den zweiten Faktor: `totp` und `email` (gelesen). Beim Einloggen gibt es "dieses Gerät merken" (`trustedDevice`).

Administratoren mit `IS_IMPERSONATOR` können sich als Kunde anmelden: Link `/recipes?_switch_user={email}` im Altsystem (`legacy-system-url-DtY5iCT3.js`), Rückweg über `user.additionalHeaderRouting.switchBack` (`route-CJcc_hgD.js`). Beim Ändern der E-Mail-Adresse verlangt die Oberfläche in diesem Fall das **eigene** Passwort des Administrators, nicht das des Kunden (Text `impersonatorDescription`, `order-reminder-tab-DPqKB8lq.js`).

---

## 2. API-Token (Profil, Reiter "API Tokens")

Alles **gelesen** in `index-C_S_dUhD.js`, Route `/brew/settings/profile?tab=api-tokens`.

**Sichtbar nur, wenn** `master("externalApi")` am Benutzer wahr ist (sonst fällt der Reiter auf "personal" zurück). Das ist ein Recht des **Hauptkontos** (`masterPermissions`), kein Unterbenutzerrecht.

| Aufruf | Körper / Antwort (aus der Verwendung gelesen) |
|---|---|
| `GET /api/user/api-tokens` | Antwort `{ tokens: [ {id, name, scopes: [..], expiresAt} ] }`. Ein Token mit dem Scope `full-access` wird rot als "Full access — unrestricted" markiert; `expiresAt` leer = "No expiry". |
| `GET /api/user/api-tokens/grantable-scopes` | Antwort `{ scopes: [ {value, resource, write} ], lifetimes: [..], defaultLifetime }`. **Hier kommen die Scope-Namen her, zur Laufzeit.** Geladen erst, wenn der Dialog "Create API token" geöffnet wird. |
| `POST /api/user/api-tokens` | Körper `{ name, scopes: [..], lifetime }` (**von Hand gelesen**, Dialog `mt()`; das Skript folgt dem Prop-Callback nicht). Name höchstens 255 Zeichen, mindestens ein Scope Pflicht. Antwort enthält `authorizeUrl`; der Browser springt per `window.location.href` dorthin. |
| `POST /api/user/api-tokens/exchange` | Körper `{ clientId: Number(state), code }`. Wird beim Zurückkehren auf `?tab=api-tokens&code=…&state=…` ausgelöst. Antwort `{ token, … }`; das Token wird **einmal** angezeigt ("for security it will not be shown again"). |
| `DELETE /api/user/api-tokens/{apiTokenId}` | – ("Revoke"; Text: jede Integration, die es nutzt, hört auf zu funktionieren) |

**Lebensdauern** (gelesen, Übersetzungsschlüssel `lifetime` in `index-lKBZAT8Z.js`): `P1D` = 1 Tag, `P1W` = 1 Woche, `P1M` = 1 Monat, `P1Y` = 1 Jahr, `P10Y` = 10 Jahre. Standard laut Text "one year"; der tatsächliche Standard kommt als `defaultLifetime` vom Server.

**Auswahl der Scopes** (gelesen): gruppiert nach `resource` (Bindestriche werden für die Anzeige zu Leerzeichen), je Ressource ein Kästchen "Read" bzw. "Write" (`write: true/false`); `title` = der Scope-Wert selbst. Hinweis im Dialog: "Grant only the scopes this integration actually needs — avoid selecting everything."

### Vollständige Liste der Scope-Namen im Bundle

**Genau ein Name steht im Code: `full-access`** (`index-C_S_dUhD.js`). Alle anderen Scope-Namen sind **nicht im Bundle**, sie kommen aus `GET /api/user/api-tokens/grantable-scopes` und hängen am angemeldeten Konto. Eine Suche nach `recipe:read`, `pos:read` und dem Muster `<name>:read|write` über alle 340 Dateien findet nichts. Die Form `<resource>:<read|write>` ist **geschlossen**, nicht gelesen: das Bundle zeigt nur das Paar `resource` + `write`, nicht wie der Server daraus den Wert bildet.

Bekannt aus der offiziellen Spezifikation (nicht aus diesem Bundle, siehe `docs/foodnotify-api-inventar-offiziell.md`): `pos:read`. Ob das Bundle-Paar `resource=pos, write=false` diesem Wert entspricht, ist offen.

Um die echte Liste zu bekommen, genügt ein **lesender** Aufruf mit angemeldeter Sitzung eines Hauptkontos mit Recht `externalApi`. Hier **nicht** ausgeführt (offline, kein Zugang).

---

## 3. OAuth: FoodNotify als Autorisierungsserver

Die Oberfläche enthält eine vollständige Zustimmungsseite. Route `/brew/oauth/authorize` (Chunk `index-nrT8yg1O.js`), alles **gelesen**.

* **Suchparameter** der Route (`validateSearch` in `index-lKBZAT8Z.js`): `client_id`, `redirect_uri`, `response_type`, `scope`, `state`.
* `GET /api/user/oauth/consent-context?clientId=…&scope=…` liefert `appName`, `scopes: [ {resource, value, write, grantable} ]`, `formName`, `csrfToken`. Unbekannter Client oder Fehler: "This authorization request is invalid or the application is unknown."
* Die Seite zeigt "<appName> wants to access your FoodNotify account", "Signed in as {email}", die Scopes je Ressource (Read/Write), **nicht gewährbare** Scopes ausgegraut mit "You do not have permission to grant {scope}." und den Host der `redirect_uri` ("After authorizing you will be redirected to {host}.").
* Die Zustimmung ist ein **HTML-Formular** (kein XHR): `POST /oauth/v2/auth` mit den versteckten Feldern `<formName>[client_id]`, `[response_type]`, `[redirect_uri]`, `[state]`, `[scope]` (die gewählten Scopes, **durch Leerzeichen getrennt**), `[_token]` (= `csrfToken`), und Schaltflächen `accepted=1` bzw. `rejected=1`.
* Fußzeile: "You can revoke this access at any time in Profile → API Tokens."

**Geschlossen:** `/oauth/v2/auth` ist der Standardpfad des Symfony-Pakets FOSOAuthServer; die Seite ist ein normaler OAuth-2-Code-Flow mit Zustimmungsbildschirm. Die API-Token aus Abschnitt 2 entstehen offenbar über **denselben** Server: `POST /api/user/api-tokens` legt einen Client an (`state` = `clientId`), der Browser durchläuft die Zustimmung, `exchange` tauscht `code` gegen das Token. Ob Dritte (zum Beispiel ein MCP-Client) eigene Clients registrieren können, ist aus dem Bundle **nicht** ablesbar: die Oberfläche hat dafür keine Registrierung, nur die Zustimmung zu bereits bekannten `client_id`.

**Nicht gefunden** (Suche über alle Dateien, Stand 18.11.2026): `mcp`/`MCP` (nur ein Zufallstreffer in der Tableau-Bibliothek), `api/doc`, `api/1.0`, `api/2.0`, `api3`, `connect.`, `swagger`, `scope-limited`, `Bearer`, `api.foodnotify`. Die offiziellen Pfade `/api/1.0/…` und `/api/2.0/…` kommen im Bundle **nicht** vor; die Oberfläche benutzt eine eigene, nicht versionierte Schnittstelle unter `/api/…` (475 verschiedene Methode+Pfad-Paare, `brew-aufrufe.csv`).

---

## 4. Benutzerobjekt, Rechte, Rollen

Quelle: `GET /app/is-authenticated` (Antwort wird im Zustand `w_` in `index-lKBZAT8Z.js` gehalten). **Gelesen** sind nur die Felder, auf die der Code zugreift; die Antwort selbst wurde nie gesehen.

Felder am Benutzer (gelesen): `id`, `parentUid`, `impersonatorId`, `email`, `roles[]`, `isMasterUser`, `allowedModules{}`, `masterPermissions{}`, `erpPermissions{}` (inkl. `all`), `shopPermissions{}`, `subuserPerms{}`, `posPermissions{}`, `hasRecipeViewerAccess`, `lang`, `designMode`, `navigation` (mit `massOrdering`) und `additionalHeaderRouting` (mit `admin`, `switchBack`, beides Links); die Felder stehen am `user`-Objekt aus dem Zustand (`const{user:a}=Te()` in `route-CJcc_hgD.js`).

Zugriffsfunktionen (`HM()` in `index-lKBZAT8Z.js`): `master(x)`, `hasModule(x)`, `erp(…x)`, `shop(…x)`, `hasSubuserPermission(…x)`, `hasRole(x)`; Hauptkonto sieht alles ("isMasterUser" gilt für `erp`/`hasSubuserPermission` als Freibrief).

| Art | Namen (alle gelesen) | Hauptfundort |
|---|---|---|
| Hauptkonto-Rechte `master()` | `externalApi` (API-Token-Reiter, `index-C_S_dUhD.js`), `erpGlobalSettings` (Einstellungen für Warengruppen/Lagerorte, `route-CJcc_hgD.js`), `gesoca` (`index-B1IQSXRQ.js`) | |
| Module `hasModule()` | `recipes`, `erp`, `catering`, `analytics`, `insights` (sperren den Menüpunkt, `locked`) | `route-CJcc_hgD.js` |
| Unterbenutzer-Rechte `hasSubuserPermission()` | `add_subusers`, `analytics_view`, `analytics_view_budget_information`, `analytics_edit_budget_information`, `erp_orders`, `erp_sales`, `erp_stocktaking`, `erp_create_confirm_stocktaking`, `erp_can_delete_stocktaking`, `erp_storage`, `erp_categories`, `erp_edit_commodity_groups`, `erp_edit_product_groups`, `erp_edit_storage_groups`, `other_settings`, `recipe_view`, `recipe_groups_add`, `recipe_groups_edit`, `recipe_corridor_edit`, `shops_orders_send`, `user_ingredients_view`; außerdem `settings_manage_units` (über `subuserPerms`) | `route-CJcc_hgD.js`, `index-B1IQSXRQ.js`, `index-C_S_dUhD.js` |
| ERP-Rechte `erp()` / `erpPermissions` | `orders`, `confirmCancelOrder`, `all` | `index-VDd8otri.js`, `use-legacy-url-generator-CX-7Kk4T.js` |
| POS-Rechte `posPermissions` | `configurationPage`, `synchronisationPage` | `index-ayCVcund.js`, `_id-CwA9RmXO.js` |
| Rollen | `ROLE_ADMIN`, `ROLE_SUPER_ADMIN`, `ROLE_SUBUSER_ADMIN`, `ROLE_DISPLAY`, `ROLE_EDU_ADMIN`, `ROLE_EDU_TEACHER`, `ROLE_EDU_STUDENT`, `ROLE_ERP_CATALOG_SYNC_ADMIN`, `IS_IMPERSONATOR` (`IS_POSSIBLE` in `use-intake-sections-CO4w_idd.js` ist vermutlich ein Statuswert und keine Rolle) | |

Zuordnung Bereich → Bedingung (gelesen in `route-CJcc_hgD.js` und `route-l_G0T8q_.js`):

* Analytics-Menü: `analytics_view` oder System-Administrator. System-Administrator heißt `ROLE_ADMIN` **und nicht** `IS_IMPERSONATOR` (`isSystemAdmin`, `index-lKBZAT8Z.js`).
* "Mass ordering": `user.navigation.massOrdering === true`.
* Benutzerverwaltung: `ROLE_SUBUSER_ADMIN` oder Hauptkonto.
* Admin- und "Switch back"-Menüpunkt: nur wenn `user.additionalHeaderRouting.admin` bzw. `.switchBack` gesetzt ist (Link kommt vom Server). Die Hilfsfunktion `canAccessCustomerSuccess` (`ROLE_ADMIN` oder `IS_IMPERSONATOR`) ist im Bundle **definiert, aber nirgends aufgerufen**.
* Unterpunkte im Admin-Bereich (`route-l_G0T8q_.js`): "Customer Success" immer; "Supplier onboarding" für System-Administratoren; "ERP Sync" (`/admin/erp-catalog-sync`) nur für System-Administratoren **mit** `ROLE_ERP_CATALOG_SYNC_ADMIN`, sonst Weiterleitung auf `/admin/analytics` (`index-C-BcOx_r.js`).
* `ROLE_ADMIN`/`ROLE_SUPER_ADMIN` bestimmen ferner `f` im Menü (`route-CJcc_hgD.js`); `ROLE_DISPLAY` wird dort ebenfalls geprüft (Zweck nicht verfolgt).
* Die Oberfläche kennt eine eigene Edu-Variante: Hostname beginnt mit `edu.` (`window.location.hostname.startsWith("edu.")`, `route-CJcc_hgD.js`); Rollen `ROLE_EDU_ADMIN/TEACHER/STUDENT` blenden Bildungsmenüs ein.

Unterbenutzer und Rollen werden über die Schnittstelle verwaltet: `/api/subusers`, `/api/subuser-roles`, `/api/subuser-permissions` (Liste der vergebbaren Rechte kommt vom Server; die Namen oben sind nur die, die das Bundle selbst prüft).

### Feature-Schalter

Es gibt **keinen** externen Schalterdienst im Bundle (Suche: `launchdarkly`, `growthbook`, `unleash`, `flagsmith`, `featureFlag`: keine Treffer). Schalter sind Felder am Benutzerobjekt (`allowedModules`, `navigation.massOrdering`, `hasRecipeViewerAccess`), dazu das Cookie `foodnotify_embedded` (Wert `true`/`1`/`"1"`/`"true"`) für die eingebettete Ansicht und `localStorage.debug`.

---

## 5. Sonstiges, das für Anmeldung/Zugang wichtig ist

* **Analytics ist Tableau.** `_id-DgAxC9ZA.js` bindet `<tableau-viz>` ein; `GET /api/v2/analytics/token` liefert ein JWT (`.data.token`), der Browser meldet sich damit per `POST <tableauUrl>/vizportal/api/web/v1/auth/embed/signin` (`{siteName, jwt}`, `credentials: include`) an. Der Filter `Uid` wird auf `parentUid` des Benutzers gesetzt. Tableau-Host (`tableauUrl`) und Site (`siteContentUrl`) kommen zur Laufzeit aus `GET /api/v2/analytics` (`analytics-context-provider-JCcMbEnL.js`), **stehen nicht im Bundle**. Dieselbe Antwort liefert die Ansichten (`views[].name`, `contentUrl`); das Bundle übersetzt 38 Ansichtsnamen, darunter `CostOfSales`, `InventoryTurnover`, `Purchasing`, `PriceTracking`, `ProductTracking`, `BudgetVsKosten`, `SalesMeals`, `SalesDrinks` sowie kundenbezogene wie `RubyLilly`, `AllRuby`, `CosmoBurger`.
* **Verwaltungs-Schnittstellen unter `/api/v2/…/management/…`** (nur Admin-Routen): Analytics-Benutzer, -Gruppen, -Lizenzen (`/api/v2/analytics/management/…`), Abrechnungskonten mit `apiKey` im Körper (`/api/v2/billing/management/users/{userId}/accounts`, `_userId-CqmU6LV4.js`), Katalogabgleich (`/api/v2/erp/catalog-sync/management/syncs`, Körper enthält `currentPassword`).
* **Erneute Passwortabfrage** beim Ändern des Profils (`currentPassword` in `PUT /api/profile`) und beim Katalogabgleich.
* **Öffentliche Seiten ohne Anmeldung** (Gast-Routen im Einstiegs-Chunk): `/brew/supplier-registration`, `/brew/supplier-registration/decline`, `/brew/forgot-password`, `/brew/register`, `/brew/login`, `/brew/email-change/confirm`. Ob die dahinterliegenden Aufrufe (`/api/supplier/invitations/{invitationId}`, `/api/supplier/intake`, `/api/user/email-change/confirm`) serverseitig ohne Sitzung laufen, ist hier nicht ablesbar.
* **Browser-Schlüssel im Bundle:** `VITE_GOOGLE_MAPS_API_KEY` ist als Wert in `index-lKBZAT8Z.js` eingebettet (39 Zeichen: `AIzaSyDCSpcTV-pNdz_yLMz1sfSRArAtpYY7ZS8`); es ist ein Google-Maps-Browserschlüssel für `maps.googleapis.com/maps/api/js`. Ob er auf Referrer beschränkt ist, ist offen.
* **Flutter-Einbettung:** `window.FlutterBridge.postMessage` (Nachrichten `EXPORT_PDF`, `GET_PLATFORM`, `flutter:platform`; `use-flutter-bridge-DxSPJGZ3.js`, `index-BI4o5ePt.js`, `export-minirecipe-card-pdf-DeS7uVQv.js`): die Oberfläche läuft auch in der mobilen App als WebView.
