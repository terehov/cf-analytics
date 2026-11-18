# FoodNotify "/brew": wie die Inventur entstanden ist

Stand 18.11.2026. Eingabe: 340 minifizierte JS-Dateien der neuen FoodNotify-Oberfläche (`belege/foodnotify-inventur-2026-11-18/brew/`, 8,5 MB, nur `.js`, keine CSS). Alles **offline und nur als Text gelesen**, keine Datei wurde ausgeführt, kein Netzwerkzugriff.

Ergebnisdateien in diesem Ordner:

| Datei | Inhalt |
|---|---|
| `brew-aufrufe.csv` | eine Zeile je verschiedenem (Methode, Pfadvorlage) |
| `brew-routen.csv` | alle Routen der Oberfläche + Links ins Altsystem |
| `brew-hosts.csv` / `brew-hosts-noise.csv` | externe Hosts, Einbettungen; Bibliotheks-URLs getrennt |
| `brew-auth.md` | Anmeldung, API-Token, OAuth, Rechte |
| `brew-rechte.json` | Rechte- und Rollennamen mit Fundort (Rohdaten zu `brew-auth.md`) |
| `brew-statistik.json` | die Zahlen dieses Laufs |
| `werkzeug/` | die Skripte, zum Wiederholen gegen ein späteres Bundle |

## 1. Wiederholen

```
python3 -I -B werkzeug/brew_extract.py <Bundle-Ordner> <Ausgabe-Ordner>
```

`-I` (isoliert) trägt das Skriptverzeichnis **nicht** in `sys.path` ein, deshalb trägt `brew_extract.py` sein **eigenes** Verzeichnis dort ein (die Hilfsmodule liegen daneben). Der Bundle-Ordner kommt nie in `sys.path`. `-B` verhindert, dass `__pycache__` im Ordner `werkzeug/` entsteht. Laufzeit rund 5 Sekunden, reines Python 3 ohne Fremdpakete.

Annahmen, die bei einem neuen Bundle **brechen können** (dann ändert sich die Ausgabe still oder das Skript meldet 0 Treffer, bitte die Statistikzahlen gegenlesen):

* Der Einstiegs-Chunk wird über den Anker `isAuthenticated:"/app/is-authenticated"` gefunden (`ANKER` in `brew_extract.py`). Der Anker ist der erste Eintrag der Endpunkt-Tabelle; ändert er sich, schlägt `find_registry` fehl.
* Die HTTP-Hilfsklasse `ot` und die axios-Instanz `UM` werden über ihre **Namen im Einstiegs-Chunk** erkannt (Minifizierer vergibt diese Namen neu, wenn sich der Code ändert; sie sind in `extract_calls.py` als `'ot'`/`'UM'` hinterlegt und müssen dann nachgezogen werden). Die Namen **in den übrigen Chunks** werden dagegen über den Import-/Export-Graphen aufgelöst und sind unkritisch.
* Routen werden als `X=de("<id>")({…component:he(Y,"component")…})` und `.update({id,path,getParentRoute})` gelesen (TanStack Router, dateibasiert).

## 2. Wie die Oberfläche HTTP spricht (Schritt 1)

Technik: **axios** (eine Instanz) + **TanStack Query** (`queryKey`/`queryFn`/`useMutation({mutationFn})`) + **TanStack Router** (dateibasiert, lazy Chunks) + TanStack Form, zod, i18next (en, de, fr; cs, pl, da nur für Anmeldung/Land/Lieferant), react-cookie, nuqs. Kein RTK Query, kein `ky`, kein SWR. `fetch` kommt nur in Bibliotheken vor (Tableau-Einbettung, WASM-Lader, PDF-Schrift), nicht für Backend-Aufrufe.

Drei Schichten, alle **gelesen**:

1. **Neue Schicht** (340 Aufrufstellen): Endpunkt-Tabelle `nt` (252 Einträge `name: "/api/…"` oder `name: e=>\`/api/…${e}…\``) und die Klasse `ot` mit `get/put/patch/post/delete`, dahinter die axios-Instanz. Auszüge aus `index-lKBZAT8Z.js`:

   ```
   UM=Qt.create({baseURL:Hm.VITE_API_DOMAIN,timeout:12e4,headers:{"X-Client-Type":"react"},withCredentials:!0})
   class ot{static async get(t,n){return await this.perform({method:"get",url:t,...n})} … static async post(t,n,r){…data:n…}
   static locationVatDefaults(t,n){const r=new URLSearchParams({country:n});return ot.get(`${nt.coreLocationVatDefaults(t)}?${r}`)}
   ```

   In anderen Chunks stehen `ot`, `nt` und die Instanz unter Einbuchstaben-Namen (`H`, `A`, `da` …), zum Beispiel `import{H as e,A as a}from"./index-lKBZAT8Z.js"` in `erp-api-service-BqIkiAnJ.js`.
2. **Altsystem-Schicht** (`legacy-http-CfXkuvQ-.js`, 97 + 92 Stellen): drei Funktionen, Antworthülle `{isError,payload,errors}`. GET-JSON `m(url, params)`, GET-Blob `g(url, params)`, allgemein `h(method, url, data, {params,form,xhr})`. Die Funktionen werden in den Chunks unter beliebigen Namen importiert und mit **den vollen Pfaden** aufgerufen (`/api/{erpId}/shop-order/…`, `/pos/…`, `/shop/…`): `n(\`/api/${t}/category/paginate\`,e)`, `a("PUT","/api/dashboard/updateLayout",e)`.
3. **Lokale Hüllen** (20 Stellen, `locations-tones-CIUmbmUn.js`) und rohes axios (2 Stellen, `use-error-toast-CqzE9-UG.js`): Funktionen, die genau eine Zeile der Schicht 2 weiterreichen.

Dazu Aufrufe, die **keine** XHR sind: `<a href>` auf Download-Pfade (`/api/shop/shopping-list/{id}/export.pdf`, `…/excel.xlsx`, `…/ingest-issues/export.xlsx`) und ein HTML-Formular `POST /oauth/v2/auth`.

## 3. Was das Skript tut (Schritte 2 bis 4)

| Modul | Aufgabe |
|---|---|
| `jsscan.py` | Mini-Leser für minifiziertes JS: überspringt Strings, Template-Literale (verschachtelt), Regex-Literale, Kommentare; findet passende Klammern; zerlegt Argumentlisten; liest Schlüssel von Objektliteralen (bedingte Spreads `...c?{a:1}:{}` werden zu `a?`, also "optional") |
| `bundle.py` | lädt alle Dateien, baut den Import-/Export-Graphen und löst jeden lokalen Namen bis zur Ursprungsdefinition auf (`resolve`) |
| `aufrufe.py` | liest die Endpunkt-Tabelle (`find_registry`/`parse_registry`) und indiziert Funktionen je Datei (Pfeil-, benannte, statische, anonyme Funktionen; Parameter, Rumpfgrenzen) |
| `extract_calls.py` | findet Aufrufstellen, löst Pfade, Query, Body und Parameternamen auf (Einzelheiten unten) |
| `ausgabe.py` | verdichtet Stellen zu Zeilen je (Methode, Pfadform), vergibt Parameternamen per Abstimmung |
| `routen.py` | Routentabelle, Elternbeziehungen, Chunk → Route |
| `brew_extract.py` | Ablauf, CSV-Ausgabe, Hosts, Rechte, Statistik |

**Aufrufstellen finden.** Für jede Datei werden die lokalen Namen bestimmt, die (über Importe) auf `ot`, die axios-Instanz oder die drei Altsystem-Funktionen zeigen; dazu **Wrapper**: lokale Funktionen, deren Rumpf eine dieser Funktionen mit einem **Parameter als URL** aufruft (bis zum Fixpunkt, höchstens drei Runden). Ein Aufruf zählt nur, wenn das Ergebnis wie ein Backend-Pfad aussieht (beginnt mit `/` oder `http`); bei Wrappern mit Einbuchstaben-Namen zusätzlich nur, wenn die URL lesbar ist (sonst wäre jedes lokale `a(e,t)` ein Treffer).

**Pfad auflösen.** Literal, Template-Literal, Aufruf der Tabelle (`nt.key(args)`, die Vorlage wird eingesetzt), Verkettung `"a"+x`, Bedingungsausdruck (`c?A:B` → zwei Stellen, Notiz "einer von 2 Zweigen") und Hilfsfunktionen, die einen Pfad zurückgeben (eine Ebene tief). `?`-Anteile im Pfad und `URLSearchParams`-Variablen liefern Query-Namen.

**Query-Namen.** Objektliteral im Argument `params:`/zweiten Argument; sonst lokale Definition (Objektliteral, `new URLSearchParams`) im Umfeld; sonst Aufrufer der umgebenden Funktion.

**Body-Felder** (nur POST/PUT/PATCH/DELETE): Objektliteral; lokal definiertes Objekt oder `FormData` (dann `[FormData] <name>`, aus `.append("name")`); Parameter der umgebenden Funktion → **Aufrufer** der Funktion (Klassenmethode über die Importe der Klasse, benannte Funktion über Importe, eine Ebene); `mutationFn: e=>…` → die `mutate()`/`mutateAsync()`-Aufrufe derselben Datei; Funktionsaufruf `f(x)` mit lesbarem Objekt im Rumpf von `f`. `...x` in der Liste heißt: ein Spread eines anderen Objekts, Felder unbekannt; `name?` heißt: nur bedingt gesetzt.

**Parameternamen** (Spalte `param_confidence`):

* `named` = Name an der Aufrufstelle **gelesen**: Destrukturierung `{erpId:e}` oder `e=x.erpId` im Umfeld (nur der äußeren umgebenden Funktion, höchstens 7000 Zeichen zurück) oder Name der Aufrufer-Argumente. Nur Namen, die auf `Id`, `Ids`, `Name`, `Slug`, `Key`, `Uid`, `Nr`, `Number`, `Code` enden, werden angenommen; mehrdeutige Treffer (mehrere verschiedene Namen für dieselbe Einbuchstaben-Variable) werden **verworfen**. Der Treffer bleibt dennoch ein Rateergebnis: der Minifizierer benutzt dieselben Buchstaben in vielen Funktionen. Bei der Prüfung fielen zuvor `{url}`, `{country}`, `{min}`, `{position}`, `{params}`, `{onError}` auf: das war genau diese Verwechslung, deshalb die Namensliste und die Mehrdeutigkeitsregel.
* `inferred` = **geschlossen** aus dem Pfadsegment vor dem Platzhalter (`/stock-transfer/{…}` → `stockTransferId`, Plural wird verkürzt). Das ist eine Lesehilfe, **kein** Name aus dem Code. Beispiel für eine Falle: `/api/pos/mapping/{…}/articles` heißt in der CSV `mappingId`, gemeint ist die POS-Konto-Kennung (an anderer Stelle des Codes `accountId`).
* `positional` = nichts ableitbar, `{p1}`, `{p2}`.
* `keine_parameter` = Pfad ohne Platzhalter.
* Je Zeile gilt der **schlechteste** Wert über alle Stellen der Zeile. Je (Methode, Pfadform) gibt es genau eine Zeile; unterscheiden sich die Namen zwischen Stellen, steht die häufigste Schreibweise im Pfad und die übrigen in der Notiz ("weitere Namensvarianten").

**Routen.** TanStack-Router-IDs (`/_user/erp/$erpId/(reskin)/storage/…`) werden in die öffentliche URL umgesetzt: führender Unterstrich = pfadloses Layout (`_user`, `_guest`) fällt weg, `(gruppe)` fällt weg, ein angehängter Unterstrich (`shop_`) ist die TanStack-Schreibweise für "nicht verschachtelt" und wird gestrichen, `$name` wird `{name}`, Basis `/brew`. Layout-Routen (haben Unterrouten, ID ohne Schrägstrich am Ende) tragen den Zusatz `/* (Layout)` in der Zeilenspalte `routes`; die `route_id` steht ungekürzt in `brew-routen.csv`. Jede Routenzeile nennt den Chunk der Routenkomponente (aus `component: he(lazyFn,"component")`, die lazy-Funktion nennt die Datei), Elternroute, Suchparameter (`validateSearch`), `beforeLoad` und die Zahl der vorgeladenen Chunks (aus `__vite__mapDeps`).

**Chunk → Routen** (Spalte `routes` in `brew-aufrufe.csv`): ab der Komponentendatei jeder Route wird der statische und dynamische Importgraph **höchstens drei Schritte** tief durchlaufen; **Hub-Dateien** (von mehr als 40 Dateien importiert, zum Beispiel Symbole, Dropdown, `legacy-http`) werden nicht als Zwischenstation benutzt. Zeilen, deren Stelle in einer Hub- oder der Einstiegs-Datei liegt (`index-lKBZAT8Z.js` enthält Dienstklassen), gehen **über die Aufrufer** der umgebenden Funktion in Nicht-Hub-Dateien.

**Hosts.** Reguläre Ausdrücke für `https?://` und `wss?://` über alle Dateien; Hosts aus Bibliothekshinweisen (`www.w3.org`, `schemas.*`, `purl.org`, `react.dev`, …) kommen in `brew-hosts-noise.csv` (94 Zeilen, 23 verschiedene Hosts). Dazu Suchmuster für Mechanismen ohne feste URL (WebSocket, EventSource, `sendBeacon`, Skript-Nachladen, Flutter-Bridge, `<tableau-viz>`, Fehlertracking, Analysedienste, Chat-Widgets, Schalterdienste) und Build-Konstanten `VITE_*` (~~Werte maskiert~~ Werte ausgeschrieben, Entscheidung Eugene 18.11.2026).

**Rechte.** Muster für `.master("x")`, `.hasModule("x")`, `.erp(…)`, `.shop(…)`, `.hasSubuserPermission(…)`, `.hasRole("x")`, `roles.includes("x")` sowie Zugriffe auf `allowedModules`, `*Permissions`, `subuserPerms`; Rollen als `"ROLE_…"`/`"IS_…"`-Literale. Ergebnis mit Fundorten in `brew-rechte.json`.

**Von Hand ergänzt** (im Skript als `MANUELL` mit Beleg vermerkt): Körper von `POST /api/user/api-tokens` (`name, scopes, lifetime`), weil er über einen Prop-Callback (`onSubmit`) läuft, dem das Skript nicht folgt. Alles andere in `brew-auth.md` ist per Hand gegen den Quelltext der genannten Chunks gelesen.

## 4. Zahlen dieses Laufs (nachgemessen 18.11.2026)

| Größe | Wert |
|---|---|
| Dateien im Bundle | 340 |
| Einträge der Endpunkt-Tabelle | 252, davon 249 irgendwo benutzt |
| Aufrufstellen mit erkanntem XHR | 551 (Schicht neu `ot` 340, Altsystem-GET 97, Altsystem-allgemein 92, lokale Hüllen 20, rohes axios 2) |
| weitere Stellen (Formular/Link/URL-Baustein) | 4 |
| **verschiedene (Methode, Pfadvorlage)** | **475** |
| davon GET / POST / PUT / DELETE / PATCH / Methode unbekannt | 213 / 128 / 87 / 41 / 3 / 3 |
| schreibende Zeilen (POST, PUT, PATCH, DELETE) | 259, davon 143 mit gelesenen Körperfeldern |
| `param_confidence` | `keine_parameter` 144, `named` 156, `inferred` 167, `positional` 8 |
| Routen der Oberfläche | 105 TanStack-Routen (2 ohne eigenen Chunk, nur `beforeLoad`), dazu 57 Links ins Altsystem |
| Hosts (ohne Rauschen) | 27 Zeilen (12 `foodnotify.com`, 5 soziale Netze in E-Mail-Vorlage, 2 CDN-Rückfälle, Google Maps, Platzhalter eines Kassenanbieters, Tableau-Einbettung, Flutter-Bridge, `VITE_*`-Konstante, API-Basis) |
| Hosts Rauschen | 94 Zeilen / 23 Hosts |

**Gegenprobe.** (a) Jede Zeichenkette `"/api/…"` (und `/pos/`, `/app/`, `/shop/`, `/shops/`, `/recipes/`, `/oauth/`), die im Bundle steht, wurde gegen die Pfadformen der CSV abgeglichen: von 437 verschiedenen Formen fehlten 50, **alle** davon sind Oberflächen-Routen oder Links ins Altsystem, ausgenommen `/api/erp/stocktakings/{}/excel.xlsx`, das daraufhin als URL-Baustein aufgenommen wurde. (b) Registertabelle gegen Verwendung: 249 von 252 Schlüsseln kommen in einer Aufrufstelle oder Referenz vor; `costAnalysisIngredients`, `costAnalysisConcreteProducts` und `stockTransferGetStatus` sind definiert und nirgends benutzt (Zeilen mit Methode `?`).

## 5. Was **nicht** wiederhergestellt werden konnte oder unsicher ist

Gelesen = im Code; alles hier ist eine Lücke.

1. **Antworten.** Es wird keine Antwortstruktur extrahiert, nur wo `brew-auth.md` sie aus der Verwendung erwähnt. Paginierung, Fehlertexte, Statuscodes: nicht erhoben.
2. **Parameternamen** sind in 167 Zeilen aus dem Pfad **geschlossen** (`inferred`) und in 156 Zeilen als `named` markiert, aber auch das ist eine Heuristik über Einbuchstaben-Variablen (siehe Abschnitt 3). Verlässlich sind nur die Routen-Parameter in `brew-routen.csv` (kommen aus den Routen-IDs).
3. **Körperfelder fehlen** bei 116 der 259 schreibenden Zeilen. Teils zu Recht (reine Aktionen ohne Körper, zum Beispiel `…/ship`, `…/cancel`, DELETE), teils nicht: bei **33 Zeilen** steht in der Notiz `Body nicht lesbar`: Körper läuft über Formularwerte, Prop-Callbacks (`onSubmit`) oder `mutate(werte)` aus anderen Dateien, dem folgt das Skript nicht. Zod-Schemata der Formulare sind **nicht** den Aufrufen zugeordnet, obwohl sie die Feldnamen enthalten würden (eine Zuordnung wäre Spekulation). `...x` in `body_fields` = Spread unbekannter Felder. Verschachtelte Objekte werden nur auf der ersten Ebene gelesen.
4. **Query-Namen** fehlen in 8 Zeilen sichtbar (`Query … nicht lesbar`) und wahrscheinlich in weiteren, in denen `params` als Variable durchgereicht wird, ohne dass ein Aufrufer lesbar ist (zum Beispiel `…/shop-order/paginate/all`, nur `...r,orderView`). Bei Zeilen mit `...x` im Query ist die Liste unvollständig.
5. **Methode bei Nicht-XHR-Stellen** (Link, Formular, URL-Baustein) ist aus dem Umfeld geschätzt (`href` → GET, `method:"POST"` → POST). Drei Registerzeilen bleiben `?`.
6. **Dynamische Ziele** sind nicht lesbar: die `authorizeUrl` aus `POST /api/user/api-tokens`, der Tableau-Host (`tableauUrl`), jede Url, die aus einer Antwort kommt.
7. **Routen-Zuordnung der Chunks** ist eine Näherung: 20 Zeilen in `brew-aufrufe.csv` tragen "Einstiegs-/Hilfs-Chunk: Aufrufer nicht eindeutig einer Route zuzuordnen", 3 Zeilen haben gar keine Route. Aufrufer innerhalb der Einstiegsdatei (React-Hooks) werden bewusst nicht ausgewertet, sonst stünde jede Route in der Liste. Die Grenze von drei Schritten und der Hub-Wert 40 sind gewählt, nicht gemessen; ein Dienst-Chunk, der von einer Route nur über mehr als drei Importe erreicht wird, bekommt keine Route.
8. **Zustandsändernde Aufrufe, die wie Lesen aussehen**: `GET /app/lang`, `GET /app/switch-design-mode`, `GET …/unlink/{clientName}`, `GET …/finish` (`/api/{erpId}/sales/{id}/finish`). Die Methode ist **gelesen**, die Wirkung **geschlossen** aus dem Namen. Wer diese Pfade je anfasst, braucht Rückfrage.
9. **Bedingungen** (zum Beispiel "nur mit Modul X") sind nur für die Rechte in `brew-auth.md` erfasst, nicht je Aufruf.
10. **Zwei Versionen von Chunks** gleicher Funktion (drei Dateien `use-error-toast-*.js`, zwei `sheet-chrome-*.js` …) werden als getrennte Stellen gelesen; der Zusammenhang (alte/neue Seite desselben Moduls) ist nicht erhoben. Mehrere dieser Dateien heißen nach etwas ganz anderem, als sie enthalten (`use-error-toast-asaa02w0.js` führt Bestellungen, Produkte und Lager des Altsystems): der Dateiname ist eine Minifizierer-Vergabe und keine Auskunft.
11. **Nicht untersucht**: die Verzeichnisse `hilfe/` (Hilfeseiten als HTML) und `panel/` (50 `*.js`-Dateien der Altoberfläche) neben `brew/`, CSS, Bilder, Übersetzungstexte außerhalb der Anmelde-/OAuth-/Token-Texte, und alles zur Laufzeit (Antwortformen, tatsächliche Scope-Liste, Cookie-Namen).
12. **Nicht belegbar aus dem Bundle**: ob Aufrufe serverseitig Anmeldung verlangen (insbesondere die Gast-Seiten), welche Drosselung der Server hat, ob eine bestimmte Zeile heute noch antwortet.
