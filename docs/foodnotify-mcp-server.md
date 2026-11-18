# FoodNotify: der MCP-Server

Stand 18.11.2026. Ziel dieser Datei: wo der MCP-Server liegt, wie man sich anmeldet, was er kann und was wir nicht wissen. Es gab **keinen Token** und **keine Anmeldung**. Alles hier stammt aus öffentlichen Seiten und öffentlichen Metadaten.

**Schreibweise.** Drei Stufen, nie vermischt:

* **aus der Hilfe gelesen** = steht auf einer öffentlichen FoodNotify-Seite.
* **abgerufen** = am 18.11.2026 selbst per GET gemessen, Rohdaten in `docs/payloads/foodnotify-2026-11/mcp/`.
* **geschlossen** = Schluss aus dem Gelesenen oder Abgerufenen, nicht belegt.

## 1. Kurzfassung

| Frage | Antwort | Stufe |
|---|---|---|
| Adresse des MCP-Servers | `https://my.foodnotify.com/mcp` | abgerufen |
| Gleiche Metadaten auch unter | `https://api3.foodnotify.com/mcp` und `https://connect.foodnotify.com/mcp` | abgerufen (Metadaten); ob die Server selbst gleich antworten, nicht geprüft |
| Anmeldung | OAuth 2 mit Autorisierungscode, **PKCE (S256) Pflicht**, öffentlicher Client (`none`) | abgerufen |
| Client-Registrierung | **Keine dynamische Registrierung**, dafür „Client ID Metadata Document" | abgerufen |
| Scopes | `recipe:read`, `recipe:write`, `erp-product:write`, `user:read`, `account:switch` | abgerufen |
| Tools | **Keine Liste veröffentlicht.** Die Werbeseite nennt `search_recipes`, `get_recipe_cost`, `get_recipe_allergens` als Beispiele | aus der Hilfe gelesen |
| Veröffentlichte Anleitung zum Verbinden | **Keine gefunden** | aus der Hilfe gelesen (fehlt) |

## 2. Was FoodNotify öffentlich sagt (aus der Hilfe gelesen)

### 2.1 Werbeseite KI

Quellen: `https://www.foodnotify.com/de/ki` (Kopie `belege/foodnotify-inventur-2026-11-18/hilfe/art_ki.html`), englisch `https://www.foodnotify.com/en/ai`, französisch `https://www.foodnotify.com/fr/ia`.

* Abschnitt „MCP-Server für Claude und ChatGPT": „Verbinden Sie FoodNotify einmal mit Ihrem KI-Assistenten und fragen Sie Ihre eigenen Daten in normaler Sprache ab. Der Assistent ruft dabei unsere Werkzeuge auf und bekommt echte Werte zurück, keine Schätzung."
* „Mit Ihren Rechten. Heute im Schwerpunkt die Rezeptdaten: Zutaten, Mengen, Kalkulation, Allergene und Nährwerte."
* „In Claude bearbeitet der Assistent auch Ihre Rezepte: Zubereitungsschritte, Zutaten, Portionen und mehr, in allen Sprachen." Von ChatGPT steht das Bearbeiten nicht da.
* Fußnote: „Der Assistent sieht und ändert nur, wofür Ihr Zugang Rechte hat. Ändern kann er nur Rezepte. Das Umschalten zwischen mehreren Accounts ist derzeit im Test."
* Grenzen: „Der MCP-Server liest nur, was Ihr Zugang sehen darf. Ändern kann der Assistent nur Rezepte, und nur mit Ihren Rechten." Kein Training mit Kundendaten, Daten liegen bei Hetzner in Deutschland.
* Die Seite sagt „Alles produktiv, nichts in Planung."
* **Die Tool-Namen stehen nur in der Beispielanimation** der Seite (Skript, Feld `t`), zu erfundenen Beispielfragen mit Beispielzahlen. Gefunden: `search_recipes`, `get_recipe_cost`, `get_recipe_allergens`, dazu die Zusätze `simulate` und `diff` (`get_recipe_cost · simulate`, `get_recipe_cost · diff`). Das sind **Anzeigetexte einer Werbeanimation**, keine Werkzeugdefinition. Ob die Namen so im Server stehen, ist offen.
* Die Seite nennt **keine Adresse, keine Schritte zum Verbinden, keine Scopes**.

### 2.2 Neuerungen November 2026

Quelle: `https://help.foodnotify.com/neu-im-november-2026` (Kopie `art_neu-im-november-2026.html`), Eintrag vom 09.11.2026 „Rezepte mit Claude bearbeiten":

* „Ist FoodNotify mit Claude verbunden, kann Claude deine Rezepte jetzt nicht nur lesen, sondern auch bearbeiten: Zubereitungsschritte und Schrittfotos, Kommentar, Zutatenzeilen, Tags, Bilder, Portionen und Betriebe, in allen Rezeptsprachen. Lieferantenartikel findet Claude über den Namen oder die Artikelnummer."
* „So übernimmst du auch große Mengen auf einmal, zum Beispiel die Zubereitungsschritte vieler Rezepte. Solche Importe kannst du gefahrlos mehrmals ausführen." (Hinweis auf wiederholbare, idempotente Sammelschreibvorgänge.)
* So geht's: „Beschreib Claude in normaler Sprache, was es ändern soll … Prüf das Ergebnis danach im Rezept. Mehr zum MCP-Server: KI in FoodNotify" (Verweis auf die Werbeseite, **nicht** auf eine Hilfeseite).

### 2.3 Was in der Hilfe nicht steht

Alle 333 Adressen der Sitemap `help.foodnotify.com` (Kopie `sitemap.xml`) einzeln durchgesehen: **kein Artikel** zu MCP, KI-Assistent, Claude, ChatGPT oder Connector. Die einzigen nahen Artikel:

* `profil-und-einstellungen` (Profil): Reiter **API-Tokens** — „Neues Token", Name, Scopes mit Lesen oder Schreiben, Laufzeit 1 Tag bis 10 Jahre (Standard 1 Jahr), Token wird nur einmal angezeigt, Widerruf per Papierkorb. Das ist der **andere** Weg (statisches Token für Skripte), nicht der MCP-Weg.
* `anbindungen-zu-ihren-drittsystemen` und `gibt-es-schnittstellen-zu-anderen-systemen`: nur Kassen, Lieferanten, API-Token.
* Suche nach MCP, Claude, ChatGPT, OAuth, Token, Assistent in allen acht gesicherten Hilfeseiten: Treffer nur in den drei Stellen oben.

Öffentliche Websuche (18.11.2026, drei Anfragen): nichts zu FoodNotify und MCP. Kein Eintrag in den gängigen MCP-Verzeichnissen gefunden, kein GitHub-Treffer.

## 3. Was am 18.11.2026 abgerufen wurde

Je GET, ohne Anmeldung, generische Kennung, Abstand 1,5 s. Rohdateien und `abrufe.csv` in `docs/payloads/foodnotify-2026-11/mcp/`. 13 Aufrufe auf FoodNotify-Hosts, `my.foodnotify.com/mcp` davon zweimal (zwei weitere Namen lösten nicht auf, dort ging nichts über das Netz). Dazu eine Abfrage der Zertifikatsprotokolle bei crt.sh.

### 3.1 Geschützte Ressource

`GET https://my.foodnotify.com/.well-known/oauth-protected-resource` (200, `application/json`):

```json
{"resource":"https://my.foodnotify.com/mcp",
 "authorization_servers":["https://my.foodnotify.com"],
 "scopes_supported":["recipe:read","recipe:write","erp-product:write","user:read","account:switch"],
 "bearer_methods_supported":["header"]}
```

Der MCP-Server hat damit die Ressourcenkennung `https://my.foodnotify.com/mcp`. Der Token geht im Kopf `Authorization: Bearer …` mit.

`GET https://my.foodnotify.com/mcp` ohne Token: **401**, Kopf
`WWW-Authenticate: Bearer resource_metadata="https://my.foodnotify.com/.well-known/oauth-protected-resource", scope="recipe:read"`.
Das ist der Einstieg, den MCP-Clients folgen. Er verlangt als Mindestscope `recipe:read`.

Die Pfadvariante `/.well-known/oauth-protected-resource/mcp` gibt 404 (HTML). Clients, die dem `resource_metadata`-Verweis folgen, brauchen sie nicht.

### 3.2 Autorisierungsserver

`GET https://my.foodnotify.com/.well-known/oauth-authorization-server` (200):

```json
{"issuer":"https://my.foodnotify.com",
 "authorization_endpoint":"https://my.foodnotify.com/mcp/oauth/authorize",
 "token_endpoint":"https://my.foodnotify.com/mcp/oauth/token",
 "client_id_metadata_document_supported":true,
 "scopes_supported":["recipe:read","recipe:write","erp-product:write","user:read","account:switch"],
 "response_types_supported":["code"],
 "grant_types_supported":["authorization_code","refresh_token"],
 "code_challenge_methods_supported":["S256"],
 "token_endpoint_auth_methods_supported":["none"]}
```

Gelesen daraus:

* **Autorisierungscode mit PKCE S256**, Auffrischtoken (`refresh_token`) vorgesehen.
* **Öffentlicher Client** (`none`): kein Client-Geheimnis.
* **Kein `registration_endpoint`**: dynamische Registrierung (RFC 7591) wird **nicht** angeboten. Stattdessen `client_id_metadata_document_supported: true`: der Client benennt sich mit einer URL als `client_id`, unter der sein Metadatendokument liegt. Ein Client, der nur dynamische Registrierung kann und keine solche URL-Kennung, kommt hier nicht an. Ob Claude und ChatGPT das jeweils können, ist **nicht gemessen** (siehe Abschnitt 6).
* Kein `userinfo`-, `revocation`- oder `jwks_uri`-Eintrag.
* `/.well-known/openid-configuration` gibt 200, ist aber nur die HTML-Startseite der Oberfläche, **kein** OIDC-Dokument.

### 3.3 Drei Hosts, gleiche Metadaten

`api3.foodnotify.com` und `connect.foodnotify.com` liefern **dieselben zwei Dokumente**, nur mit eigenem Host in `resource` und `issuer` (`https://api3.foodnotify.com/mcp`, `https://connect.foodnotify.com/mcp`). Gleiche Scopes, gleiche Endpunkte (`/mcp/oauth/authorize`, `/mcp/oauth/token` je Host).

`GET /mcp` an beiden: **401**, JSON (`"Full authentication is required to access this resource."`), **ohne** `WWW-Authenticate`-Kopf. Der Kopf mit Verweis auf die Metadaten kommt nur von `my.foodnotify.com`.

Beobachtung: Der Auftraggeber hatte am 18.11.2026 früher **403 „Forbidden: Invalid Host header."** auf `api3/mcp` und `connect/mcp` gemessen. Heute, mit `Accept: application/json, text/event-stream`, kam 401. Ursache der Abweichung offen (Aufrufart, Kopf, Zeitpunkt).

### 3.4 Namen, die es nicht gibt

`mcp.foodnotify.com` und `ai.foodnotify.com` lösen nicht auf (kein DNS-Eintrag). In den Zertifikatstransparenzprotokollen (crt.sh, 64 Namen) steht **kein** Name mit „mcp" oder „ai", außer `api.demo-ai`, `demo-ai` und dem Wildcard `*.demo-ai.foodnotify.com`. Da `*.foodnotify.com` ein Wildcard-Zertifikat ist, **würde ein MCP-Host dort ohnehin nicht einzeln auftauchen** — die Suche beweist nichts. Die Metadaten zeigen den MCP-Pfad auf bekannten Hosts, ein eigener Host ist nicht nötig.

## 4. Anmeldung und Rechte

* **Abgerufen:** OAuth 2 mit Autorisierungscode und PKCE, Bearer-Token im Kopf, Scopes siehe 3.2.
* **Aus der Hilfe gelesen:** der Server arbeitet „mit Ihren Rechten" — er sieht und ändert nur, was das Konto des Anmeldenden darf.
* **Geschlossen:** Der Zugriff hängt an einer **Person**, nicht an einem Dienstkonto. Es gibt keinen Weg, einen MCP-Zugang ohne FoodNotify-Konto mit Rezeptrechten zu betreiben. Für unseren Zweck (Auswertung ohne Anmeldung einer Person) taugt er deshalb nicht ohne eigenen Dienstbenutzer.
* **Aus der Oberfläche gelesen** (Bundle `/brew`, `belege/foodnotify-inventur-2026-11-18/brew/`, Chunk `index-nrT8yg1O.js` und Übersetzungsschlüssel `oauthConsent`): Die Oberfläche enthält eine **Zustimmungsseite** für OAuth. Texte (englisch, deutsch, französisch): „<App> möchte auf Ihr FoodNotify-Konto zugreifen", „Angemeldet als {email}", „Wählen Sie die Berechtigungen aus, die Sie gewähren möchten, und autorisieren Sie dann.", je Ressource Lesen / Schreiben, Scopes, die das Konto nicht gewähren darf, ausgegraut mit „Sie haben keine Berechtigung, {scope} zu gewähren.", „Nach der Autorisierung werden Sie zu {host} weitergeleitet.", „Sie können diesen Zugriff jederzeit unter Profil → API-Tokens widerrufen." Die Knöpfe heißen „Autorisieren" und „Ablehnen". Details in `docs/payloads/foodnotify-2026-11/intern/brew-auth.md`.
  **Wichtig:** Diese Seite gehört zum Pfad `/oauth/v2/auth` (Token für Fremdprogramme, Abschnitt 3 dort). Der MCP-Server nennt einen **anderen** Pfad: `/mcp/oauth/authorize`. Ob beide dieselbe Seite zeigen, ist nicht belegt.
* **Geschlossen:** Widerrufen wird ein MCP-Zugang vermutlich im Profil, Reiter API-Tokens (steht so im Hinweis der Zustimmungsseite). Nicht geprüft, ob MCP-Zugänge dort überhaupt erscheinen.
* **Zum Vergleich, nicht verwechseln:** Die API-Tokens aus dem Profil (Reiter „API-Tokens") haben **andere** Scopes — für Wilma Wunder 22 (`recipe`, `menu`, `catering-card`, `user-ingredient`, `shop`, `erp-product`, `stocktaking`, `order`, `catering`, `pos` je `:read`/`:write`, dazu `analytics:read`, `user:read`), gemessen am 18.11.2026 über `/api/user/api-tokens/grantable-scopes`. `account:switch` steht dort nicht, `erp-product:write` schon. Sie werden über `/oauth/v2/auth` ausgestellt und wirken auf `api3.foodnotify.com`, nicht auf `my.foodnotify.com/api/…` (`docs/foodnotify-api-inventar-offiziell.md`).

## 5. Verbinden — was ein angemeldeter Nutzer wohl tut

**Geschlossen, nicht aus einer FoodNotify-Anleitung** (es gibt keine). Nach dem üblichen Ablauf für einen entfernten MCP-Server:

1. In Claude oder ChatGPT einen eigenen Connector („Benutzerdefinierter Connector" / „Custom connector") hinzufügen. Adresse: `https://my.foodnotify.com/mcp`. Transport vermutlich Streamable HTTP (nicht abgerufen; ohne `initialize` nicht prüfbar).
2. Der Client ruft die Adresse ab, bekommt 401 mit Verweis auf die Metadaten, liest sie und öffnet **den Browser auf `https://my.foodnotify.com/mcp/oauth/authorize`**.
3. Man meldet sich bei FoodNotify an (mit 2FA, wenn eingerichtet) und bestätigt die Berechtigungen.
4. Der Client bekommt Zugangs- und Auffrischtoken und kann die Werkzeuge aufrufen.

Voraussetzung ist ein FoodNotify-Konto **mit Rezeptrechten**. Der Zugriff ist so breit wie das Konto. Ob die Anbieter einen Client dieser Art ohne dynamische Registrierung annehmen, kann hier nicht belegt werden. FoodNotify behauptet öffentlich, dass es mit Claude und ChatGPT läuft.

## 6. Nicht geklärt

* **Welche Werkzeuge der Server wirklich anbietet.** Ohne Anmeldung kommt keine Liste (`tools/list` braucht ein Token). Nur drei bis vier Namen stehen in einer Werbeanimation, die auch die Scopes `erp-product:write` und `account:switch` nicht erklärt.
* **Welche Daten über Rezepte hinaus lesbar sind.** Werbeseite: „heute im Schwerpunkt die Rezeptdaten". Scopes für Einkauf, Lager, Verkäufe (`order`, `stocktaking`, `pos`, `analytics:read`) stehen **nicht** in der Liste des MCP-Servers. Für unsere Zwecke (Einkauf, Inventur, Verkäufe) heißt das nach dem, was sichtbar ist: **nicht abrufbar**. Das ist geschlossen.
* **Widerspruch Werbeseite gegen Metadaten.** Die Seite sagt „Ändern kann er nur Rezepte", die Metadaten führen `erp-product:write` (Produkt im Warenwirtschaftsteil). Was dieser Scope ändert, ist unbekannt. Möglich: Lieferantenartikel in Zutatenzeilen finden („über den Namen oder die Artikelnummer", Hilfe 09.11.2026), ohne etwas zu schreiben; nicht belegt.
* **`account:switch`.** Passt zur Aussage „Umschalten zwischen mehreren Accounts ist derzeit im Test". Was es für unsere vier Marken (vier Konten, `docs/foodnotify-api-inventar.md`) bedeutet — ob ein Anmeldender mehrere Konten ansprechen kann —, ist unbekannt. Bis dahin ein Konto je Anmeldung.
* **Transport und Protokollversion.** Nie ein `initialize` gesendet (ohne Token abgewiesen, und nicht erlaubt). Ob Streamable HTTP oder SSE, welche MCP-Version: offen.
* **Ob Claude und ChatGPT sich ohne dynamische Registrierung anmelden.** Der Server bietet nur URL-basierte Client-Kennung (CIMD). Das ist belegt; ob die beiden Anbieter es heute so nutzen, nicht. FoodNotify behauptet, dass beide laufen.
* **Warum `api3` und `connect` früher 403 „Invalid Host header" gaben** und heute 401, und ob dort überhaupt derselbe Server hinter dem Pfad `/mcp` läuft wie unter `my.foodnotify.com`. Nur `my.foodnotify.com` setzt den `WWW-Authenticate`-Kopf. Nur dieser Host ist in den Metadaten **und** im Kopf als Ressource genannt — **maßgeblich ist `my.foodnotify.com`**.
* **Ob die Zustimmungsseite des MCP-Wegs dieselbe ist wie die in `/brew`.** Nicht angesehen (Abruf der Seite brauchte eine Anmeldung und war nicht erlaubt).
* **Ob der Zugang je Rolle/Person unterschiedlich viel zeigt.** Nur die Hilfe: „mit Ihren Rechten".
* **Preis, Lizenz, Freischaltung.** Nichts veröffentlicht; ob der MCP-Server für jeden Kunden offen ist oder gebucht werden muss, unbekannt. Frage an FoodNotify, **nicht** vom Importer aus.

## 7. Folgen für uns

* **Kein Ersatz für den Import.** Der MCP-Server liefert Rezeptdaten für eine angemeldete Person im Chat, keine Massendaten für `raw`/`core`. Unser Rezeptzulauf (`docs/plan-rezepturen.md`) läuft weiter über die Schnittstelle und die Konten, die der Importer schon hat.
* **Kein Zugang zu Einkauf, Inventur, Verkäufen** über diesen Weg nach den sichtbaren Scopes.
* **Chance:** Wer bei Concept Family ein FoodNotify-Konto hat, kann Rezepte in Claude lesen und (in Claude) ändern — dann auf **eigene Verantwortung des Nutzers**: es **schreibt** in FoodNotify. Unsere Regel 1 (in LINA nur lesen) gilt für LINA; für FoodNotify gilt, dass der Importer nur liest. Ein Nutzer, der Claude Rezepte ändern lässt, ändert die Wahrheit, aus der `core.rezept` und `core.zutat` gespeist werden (`0132`).
* **Nichts verbunden, nichts getestet.** Wer es einrichtet, tut das mit dem **eigenen** Konto und eigenem Risiko, nicht mit den Zugangsdaten des Importers (Regel 2).

## 8. Quellen

* `https://www.foodnotify.com/de/ki`, `/en/ai`, `/fr/ia` (abgerufen 18.11.2026, Kopie der deutschen Seite in `belege/foodnotify-inventur-2026-11-18/hilfe/art_ki.html`)
* `https://help.foodnotify.com/neu-im-november-2026` (Kopie `art_neu-im-november-2026.html`)
* `https://help.foodnotify.com/profil-und-einstellungen` (Kopie `art_profil.html`)
* `https://my.foodnotify.com/.well-known/oauth-protected-resource` und `…/oauth-authorization-server` (abgerufen 18.11.2026)
* `docs/payloads/foodnotify-2026-11/mcp/` — Rohdokumente und `abrufe.csv`
* `docs/payloads/foodnotify-2026-11/intern/brew-auth.md` — Zustimmungsseite der Oberfläche
* `docs/foodnotify-api-inventar-offiziell.md` — API-Tokens, ihre Scopes und was sie erreichen; `docs/foodnotify-api-inventar-intern-2026-11.md` — die interne Schnittstelle
