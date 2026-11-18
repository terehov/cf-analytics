# FoodNotify `/panel` (Angular, 18.11.2026) — Anmeldung, Sitzung, Rechte, Konfiguration

Quelle: die 45 JavaScript-Dateien und 3 HTML-Seiten unter `belege/foodnotify-inventur-2026-11-18/panel/`,
nur als Text gelesen, nie ausgeführt. Chunk-Namen sind die Dateipräfixe (`main` = `main.e1808370….js`).
**Gelesen** heißt: steht so im Quelltext. **Geschlossen** heißt: aus dem Gelesenen abgeleitet, nicht belegt.
Wie extrahiert wurde: `panel-methode.md`. Chunk `592` (`common.30034b8e….js`) lag im ersten Lauf nicht bei und wurde am 18.11.2026 nachgeladen (`panel-methode.md` §7); er enthält keine Rechte- oder Speicherzugriffe, nur den `brewPath`-Guard (siehe §4).

## 1. Kurzfassung

* **Sitzung per Cookie, kein Token im Client.** Es gibt in der ganzen App keinen `Authorization`-Header, kein `Bearer`, kein
  Token im `localStorage`. Anmeldung ist ein klassisches Symfony-Formular (`POST /signin_check`). Gelesen, `main`/`330`/`283`/`488`.
* **Genau ein HTTP-Interceptor** (`main`), und der behandelt nur Fehler (401/403/409/422). Er setzt keinen Header.
* **Kein 2FA, kein OAuth, kein `api/1.0`/`api/2.0`/`api3`, kein `mcp` im Code dieser App.** Die Treffer für `2fa`, `jwt`, `SSO`
  in `545` und `848` sind Base64- und Bibliotheksrauschen (Tabellenfunktionen, Schriftdaten); `apiToken` und `scope` kommen nur als
  Formularfeld bzw. Bibliothekswort vor (siehe 6).
* **Die App ist der ältere Client.** Sie leitet viele Bereiche auf die neue React-Oberfläche `/brew` um (siehe `panel-routen.csv`).
  Die `2FA`-/`signin_check`-Beschreibung aus `docs/foodnotify-api-inventar.md` §1 (`POST /api/user/auth/signin_check`, 2FA vollständig vorhanden)
  stammt also aus dem `/brew`-Client oder aus dem Netzwerkmitschnitt, nicht aus diesem Bundle: hier lautet der Pfad **`/signin_check`**
  (ohne `/api`), siehe 2.

## 2. Anmeldung und Sitzung (gelesen)

URL-Bauer (`main`, Modul 27930/64942): `baseUrl` = leer (relativ zu `<base href="/">`), `baseApiUrl` = `api`, `baseAppUrl` = `app`.
Es gibt keine Basis-URL einer anderen Domäne; alle Aufrufe gehen gegen den Ursprung, von dem die App geladen wurde.

| Zweck | Aufruf | Beleg |
|---|---|---|
| Anmelden (Hauptformular) | `POST /signin_check`, Body `application/x-www-form-urlencoded`: `_username`, `_password`, optional `_remember_me` | `main` (`AuthenticationService.authenticate`, über `requestService.auth`, `withCredentials: true`) |
| Anmelden (erneut, Menükarten-Editor) | `POST /signin_check`, `FormData` aus dem Formularwert, `_remember_me` = `"on"` oder entfernt, Header `X-Requested-With: XMLHttpRequest` | `283` |
| Anmelden (Catering) | `POST /signin_check` über `loginUser(body)` | `330` |
| Anmelden (Lieferantenportal) | `POST /signin_check`, `FormData` `_username`, `_password`, `_remember_me=on`, `withCredentials`, `X-Requested-With` | `488` |
| Sitzung prüfen / Benutzer holen | `GET /app/is-authenticated` → Benutzerobjekt (`roles`, `allowedModules`, `erpPermissions`, `lang`, `id`, `email`, `firstName`, `lastName`) | `main` (`checkServerAuthentication`) |
| Abmelden | `GET /api/security_logout` | `main` |
| Abmelden (Lieferantenportal) | `POST /signout` (mit `localStorage.clear()` davor) | `488` |
| Passwort zurücksetzen | `POST /api/password/reset/save` mit Body `{_username}`, JSON | `main` |
| Passwort zurücksetzen (Catering-Verwaltung) | `POST /password/reset/save?do=1&_username=…` | `330` |
| Version | `GET /api/pub/version` → `{version, gitBranchName, gitHash}` (Pfadteil `pub`; ob ohne Anmeldung erreichbar, steht nicht im Code) | `main` (Klasse mit `refresh()`) |

Geschlossen: das Sitzungsmerkmal ist ein Cookie (`withCredentials`, kein Token im Speicher, `signin_check` ist der Symfony-Standardname).
Die Cookie-Eigenschaften (HttpOnly, SameSite) stehen nicht im Bundle; `docs/foodnotify-api-inventar.md` (Nachtrag 01.08.2026) hat
HttpOnly aus dem Mitschnitt belegt.

Antwortverarbeitung (gelesen, `main`): nach `signin_check` setzt die App `authUser` auf die Antwort und löst `$authenticationSuccess` aus;
danach `loadNavbar()`, `Ne.syncFromUser(A)`, Sprache aus `A.lang`.

## 3. Der Interceptor (gelesen, `main`)

Registriert als `{provide: HTTP_INTERCEPTORS, useClass: De, multi: true}` im Root-Modul. Er setzt **keinen** Header und kein Token. Er fängt Fehler ab:

* **401** → Navigation nach `/login` (bzw. `/supplier/login`, wenn `location.host` den Text `supplier` enthält).
* **403** → Fehlerfenster, **außer** die Anfrage-URL ist genau `signin_check` (dann kein Fenster).
* **409 und 422** → Fehlerfenster, Fehler wird weitergereicht.
* sonstige Fehler → `console.error`.

Zusätzliche, aufrufbezogene Header (gelesen):

| Header | Wo | Wert |
|---|---|---|
| `Content-Type` | `main` (RequestService), `607` (`He`) | `application/json; charset=utf-8` |
| `Content-Type` | `main` (`authenticate`) | `application/x-www-form-urlencoded` |
| `X-Requested-With` | `283`, `435`, `488`, `658` | `XMLHttpRequest` |
| `X-Accept-Error` | `742` (`POST /pos/lightspeed-g/pending/{id}/confirm`) | `application/problem+json` |

`withCredentials: true` ist an den meisten Dienstaufrufen explizit gesetzt (`main` Dashboard-Dienst, `607`, `733`, `283`); Same-Origin schickt das Cookie ohnehin.

## 4. Routenschutz und Rechte (gelesen)

Der Benutzer (`GET /app/is-authenticated`) trägt:

* **`roles`**: Zeichenketten. Im Code vorkommende Rollen: `ROLE_SUPPLIER` (`main`, `488`), `ROLE_ADMIN` (`742`), `ROLE_SUBUSER` (`330`), `ROLE_RECIPE_EXPORT` (`239`), `ROLE_EDU_STUDENT` (`239`).
* **`allowedModules`**: `analytics`, `catering`, `erp`, `menucreator` (`239`, Guard `Le`: `/panel/<modul>` ohne Freigabe → `/panel/module-not-allowed`). `shop`, `shopping-list`, `settings`, `dashboard` werden dort **nicht** geprüft.
* **`erpPermissions`**: `all`, `categories`, `confirmCancelOrder`, `createConfirmStocktaking`, `editProductStock`, `editProducts`, `orders`, `sales`, `stocktaking`, `stocktransferAccepts`, `stocktransferAddProducts`, `stocktransferApproves`, `storage`, `uncancelOrder`.
* **Catering-Rechte** (`330`, `permissionsService`): `hasCateringCanAddToCartPermissions`, `…CreateEventPermissions`, `…DeletePermissions`, `…EditAllEventsPermissions`, `…SettingsPermissions`, `…ViewAllEventDetailsPermissions`, `…ViewAllEventsPermissions`, `…ViewAndEditPermissions`, `…ViewButNotEditPermissions`, `…ViewOwnEventsPermissions`.

Guards (Klartext je Route in `panel-routen.csv`):

| Guard | Chunk | Verhalten |
|---|---|---|
| `J` | `main` | Wurzel `/`: Sitzung per `GET app/is-authenticated`, dann Weiterleitung auf die gemerkte Zielroute |
| `F` | `main` | `supplier` im Host → nur `ROLE_SUPPLIER` (sonst `/supplier/login`, `/supplier/register`); sonst `/login`, `/reset-password` offen, eingeloggt nur `/panel`, alles andere → `/forbidden` |
| `wt` | `239` | Benutzer geladen: `data.role` (falls gesetzt) muss in `roles` stehen; sonst `GET app/is-authenticated` |
| `Le` | `239` | `allowedModules` je Pfadpräfix (siehe oben) |
| `So` | `330` | `hasCateringViewAllEventDetailsPermissions`, sonst Warnfenster und `/catering` |
| `I` | `545` | `data.permission == StocktransferApproving` **und** (`erpPermissions.all` oder `stocktransferApproves`) |
| `Cf` | `488` | `roles` enthält `ROLE_SUPPLIER` |
| `Ys` | `742` | immer erlaubt |
| `<Alias>.F` aus Modul `13596` | `607`, `658`, `742` | **gelesen am 18.11.2026** (Chunk `592`): setzt `window.location.href = <reactFrontendDomain>/brew/<data.brewPath mit :param aus der Route>(?query)` und gibt `false` zurück — Weiterleitung auf die neue Oberfläche, **keine** Berechtigungsprüfung. Alle diese Routen tragen `data: {brewPath: …}` (~~vorher: nicht gelesen, aus dem Namen geschlossen~~) |

Hinweis auf eine gemessene Lücke der Client-Prüfung (gelesen, kein Befund über den Server): Die Modulprüfung sitzt im Client; ob der Server dieselben `allowedModules` erzwingt, sagt das Bundle nicht.

## 5. Browserspeicher (gelesen)

`AppLocalStorageService` (`main`, Modul 57809): Präfix **`foodnotify.`** vor jedem Schlüssel; ohne Browser eine Attrappe, die immer `"en"` liefert.
Schlüssel (Auswahl, alle ohne Präfix): `language`, `viewMode`, `erp.selectedErp`, `erp.selectedCostCenter`, `erp.user`, `layout.state`,
`openSidebar`, `general-settings.view-options`, `pos.connecting`, `pos.userId`, `pos.locations.*`, `pos.sync.*`, `startDate`, `endDate`, `restartFilters`, `print-html`, `changeCostCenterWarned`.
**Kein Token, kein Sitzungsschlüssel.** Zwei Ausnahmen im Lieferantenportal (`488`): `user` (JSON des Benutzers), `selectedUserShop`.

**Bemerkenswert (gelesen, `488`):** Die Funktion `rememberMeFun()` schreibt bei „Angemeldet bleiben“ **E-Mail und Passwort im Klartext** nach `localStorage`
(`foodnotify.email`, `foodnotify.password`, jeweils `JSON.stringify`). Das betrifft nur das Lieferantenportal, nicht die Marken-Zugänge.

## 6. Treffer für gesuchte Wörter

| Suche | Ergebnis |
|---|---|
| `Authorization`, `Bearer`, `api/1.0`, `api/2.0`, `api3`, `mcp` | **kein** Treffer in `main` und den Lazy-Chunks |
| `apiToken` | nur Formularfeld und Übersetzungsschlüssel `settings.locations.connection.apiToken` (`742`, POS-Verbindung) und `apiToken` als Feld einer POS-Variante (`snspwtcb`); **kein** Zugangstoken für FoodNotify selbst |
| `scope` | HTML-Attribut `scope="row"` (`313`), Chart.js (`703`), Lightspeed-Fehlertext `lightspeed_missing_scopes` (`742`) |
| `2fa`, `totp`, `jwt`, `trusted device` | nur Bibliotheksrauschen (`545`, `848`) — **keine** 2FA-Endpunkte in dieser App |
| `csrf`/`xsrf` | ein Treffer `XSRF` in `545` (Bibliothek) |
| `signin_check` | `main`, `283`, `330`, `488` (siehe 2) |

## 7. Tableau: Ticket-Verfahren (gelesen, `605`)

`GET /api/analytics` liefert `payload.{ticket, siteId, analyticsId, views[], tableauUrl}`. Die App baut daraus
`${tableauUrl}/trusted/${ticket}/views/<contentUrl>` und lädt es in `new tableau.Viz(…)` (Skript `tableau-2.9.2.min.js` von
`public.tableau.com`, im HTML). Views mit „hide“ im Namen werden ausgeblendet. Das ist **das Ticket-Verfahren (trusted tickets)**,
nicht der JWT-Weg `GET /api/v2/analytics` aus `docs/foodnotify-api-inventar.md` §7 (Scope `tableau:views:embed`). Ob beide parallel bestehen,
sagt das Bundle nicht; der JWT-Weg gehört vermutlich zum `/brew`-Client (geschlossen).

## 8. Eingebaute Konfiguration (`main`, Modul 92340)

```
{ production: true,
  sentry: { dsn: "https://625f77…@o4506841913491456.ingest.us.sentry.io/4507145965862912" },
  reactFrontendDomain: null }
```

* `production`, `sentry.dsn`, `reactFrontendDomain` sind die drei Schlüssel. Der DSN-Schlüsselteil (hier nur die ersten sechs Zeichen) ist ein **Sentry-Projektschlüssel** für Fehlerberichte; er steht bewusst im Client.
* `reactFrontendDomain: null` → die Umleitung auf die neue Oberfläche (`brew/**`) baut eine **relative** URL (`brew/<pfad>?<query>`), also dieselbe Domäne.
* **Sentry mit Sitzungsaufzeichnung** (gelesen, `main`): `replaysOnErrorSampleRate: 1`, `replaysSessionSampleRate: 0.1`, Replay-Integration mit `maskAllText: false`, `blockAllMedia: false`. Nur in `production`.
* **Gleap** (Rückmelde-/Tracking-SDK, Modul 33722 in `vendor`): `main` ruft nach jeder erfolgreichen Anmeldung `Gleap.initialize("luccHM…")` (Projektschlüssel, 32 Zeichen, hier nur sechs gezeigt) und `Gleap.identify(<Benutzer-Id>, {email, name})`. Ereignisse über `trackEvent("…")` in `239`, `658`, `88` (Lieferantenseite, Warenkorb, Smartlisten). **Gleap ist also aktiv, kein totes SDK.** Dienste: `api.gleap.io`, `wss://ws.gleap.io`, `messenger-app.gleap.io`, `outboundmedia.gleap.io`.
* **Google Maps** (HTML `_panel_.html`, `_panel_catering.html`): `maps.googleapis.com/maps/api/js?key=AIzaSy…` — ein Browserschlüssel, im HTML im Klartext; Zweck: Karten (vermutlich Standortwahl im Catering, geschlossen).
* **Übersetzungen** (`main`): `/assets/i18n/<bereich>/<sprache>.json?v=<Hash>`, 33 Dateien (de, en, fr; Bereiche analytics, daily-menu, dashboard, erp, event-catering, menu-creator, production-plan, settings, sidebar, supplier).

## 9. Was dieses Bundle über die Auth nicht sagt

* Cookie-Name, Laufzeit, SameSite: nicht im Code.
* Die Berechtigungsfreigabe auf dem Server (ob die Client-Prüfungen erzwungen werden): nicht im Code.
* ~~Modul `13596` (`brewPath`-Guard) und alle anderen Module aus Chunk `592`: nicht im Bestand~~ — seit 18.11.2026 im Bestand, nichts davon betrifft die Anmeldung (`panel-methode.md` §6.1).
* Wie der `/brew`-Client anmeldet (React): nicht Gegenstand dieses Bundles.
