# LINA Third-Party-API (TPAPI) — die offizielle Schnittstelle

Erhoben am 06.11.2026 aus der öffentlichen Postman-Dokumentation von Gastro-MIS und den
Support-Artikeln. **Nichts davon ist gegen das echte LINA gelaufen** — es gibt noch keinen
Schlüssel für uns. Anlass: Daniel zeigte im Marktplatz eines Betriebs, dass *Article Data
API*, *Sales Data API* und *Team Data API* gebucht sind (je 8 €/Monat, seit 01.06.2026),
dazu *LINA API (Webkassen-API)* seit 02.11.2026. *BWA Data API* und *Taxonomie-Import* sind
nicht gebucht. Im Rechtekatalog des Clients gibt es laut Daniel das Recht **„Schichten und
Zeiterfassung"**.

Dass es die TPAPI gibt, stand schon in KORREKTUR 5 b (`lina-api-korrekturen.md`, 11.08.2026:
Bounti und Sell & Pick haben Schlüssel). Neu ist, **was sie liefert** — insbesondere die
Besetzung je Stunde, die uns für die Öffnungszeitenfrage fehlt (KORREKTUR 10 f).

## Quellen

- Postman: <https://documenter.getpostman.com/view/12285766/TzkyML8s> — als JSON:
  `https://documenter.gw.postman.com/api/collections/12285766/TzkyML8s?segregateAuth=true&versionTag=latest`
- Leitfaden: <https://support.gastro-mis.de/support/solutions/articles/36000377866>
- Einrichtung beim Kunden: <https://support.gastro-mis.de/support/solutions/articles/36000449514>
- Endpunkte und Scopes: <https://support.gastro-mis.de/support/solutions/articles/36000389860>
- Ordner „Third Party API": <https://support.gastro-mis.de/support/solutions/folders/36000195467>

## Zugang

- Basis `https://api.lina.de/` (alt: `https://app.lina.de/extern/...`), alle Pfade unter `/extern/`.
- **Zwei Verfahren.** OAuth2 (Authorization Code, danach Bearer-Token; Client je Laden unter
  *Config > Schnittstellen > Third-Party-API*) oder **API-Key mit fester IPv4-Bindung**. Den
  API-Key lässt das **Gruppenmodul (Franchise) zentral** erzeugen — so sind Bounti und
  Sell & Pick angelegt. Für uns wäre das der Weg: ein Schlüssel, gebunden an die Hetzner-IP,
  ohne Anmeldung, ohne Session, ohne Regel 7a.
- **Rechte je Endpunkt** (Scope) und **Lizenz je Endpunkt** im Marktplatz des Ladens. Die
  Rechte müssen laut Doku in jedem Laden einzeln eingestellt werden.
- **Dokumentiertes Limit: 100 Anfragen je Laden in 15 Minuten** (gleitend), darüber HTTP 429
  „API-Calls exhausted". Anmeldungen zählen nicht. Erstmals ein Limit, das LINA selbst nennt
  — unsere Drosselung (Regel 3) ist für die Oberfläche gebaut, nicht für diesen Weg.
- `GET /extern/revenue/getlimit` liefert das verbleibende Kontingent, `/extern/revenue/store`
  den verbundenen Laden.

## Endpunkte (nur die lesenden sind für uns relevant)

| Gruppe | Scope (Doku) | Lesend | Schreibend — nie benutzen |
|---|---|---|---|
| Bewegungsdaten Umsatz („Sales Data") | `revenuejournal_read` | `revenue/listdays`, `revenue/journal?businessdate=`, `revenue/journaltables?businessdate=`, `revenue/getforecastperday?from=&to=` | — |
| Personal („Team Data") | `personal_read` | `personal/personalkostenprostunde?businessdate=`, `personal/personalkostenprotag?businessdate=`, `personal/acceptedworkingtimes?businessdate=`, `personal/userdataperday?businessdate=`, `personal/userdataperdaydelta?updatedSince=`, `personal/getPersonalData` | `personal/saveShift`, `addUserCert`, `registerWebhook` |
| Artikelstammdaten („Article Data") | `merchandisemanagement` | `merchandiseman/recipe`, `attributes`, `meccode`, `vat`, `financetype`, `financecategory`, `pricelevel`, `site`, `operationprofile`, `meccodegroup`, `category`, `detailcategory`, `grosscategory` | `PUT/POST merchandiseman/recipe/...` |
| BWA („BWA Data", **nicht gebucht**) | `bwa_read` | `bwa/bwa?month=&year=&schema=`, `bwa/susa?month=&year=`, `bwa/schemas` | — |
| Webkasse | `webcashregister` | `ping`, `tableStatus` | `command`, `placeorder`, `sendBooking` — bucht an der Kasse |

~~Welche Scopes sich hinter den Namen im LINA-Rechtekatalog verbergen, ist nicht gemessen.
„Personalstammdaten und Kosten lesen" ist nach Doku `personal_read`; was „Schichten und
Zeiterfassung" umfasst, steht nirgends — möglicherweise auch `saveShift`, also schreibend.~~

**Rechteliste gesehen am 06.11.2026** (Bildschirmfreigabe Daniel, Ladenakte der Franchise,
`/intranet/ladenakte/index?admin=1&tab=apikey`). Das Formular hat die Felder *Bezeichnung*,
*Drittanbieter* (Auswahl), *IP-Adresse*, *Rechte (Scopes)* (Mehrfachauswahl) und *Gültig für
Tage* (leer = unbegrenzt), Knopf *API-Key erzeugen*. **Den Schlüssel kann Concept Family selbst
anlegen**, ohne LINA. Die Rechte, wie sie an den bestehenden Schlüsseln stehen:

| Recht in LINA | Lesend? | Für uns |
|---|---|---|
| Lesen der Benutze… (abgeschnitten, erster Eintrag der Liste) | ja | unklar, erst Volltext lesen |
| Artikelstammdaten lesen | ja | ja |
| Artikelstammdaten schreiben | **nein** | nie |
| Journaldaten Kasse lesen | ja | ja |
| Personalstammdaten und Kosten lesen | ja | **ja — Personen und Kosten je Stunde** |
| BWAs und SuSas lesen | ja | ja (ob ohne gebuchte *BWA Data API* etwas kommt, ist offen) |
| Import von Jomosoft-Umsatzdaten | **nein** | nie |
| Kommunikation mit Webkasse | **nein** (bucht an der Kasse) | nie |
| Schichten und Zertifikate schreiben | **nein** (`saveShift`, `addUserCert`) | nie |

**Angelegt am 07.11.2026** von Eugene (Ladenakte → Aposto Aalen GmbH → Stammdaten → Reiter
*API-Keys*, Mandant *CONCEPT FAMILY Franchise AG*): Name *Concept Family Analytics*, IP
178.104.197.120, **ohne Ablauf**, Scopes `merchandisemanagement_read`, `revenuejournal_read`,
`personal_read`, `bwa_read` — **Ebene Franchise**, ~~also für alle Betriebe, nicht je Standort oder
Marke. Der Betrieb im Baum ist nur der Einstieg; die Ebene ergibt sich aus dem Mandanten.~~
**Widerlegt am 07.11.2026: der Schlüssel gilt nur für Aposto Aalen** (Abschnitt „Erste Messung").
~~Der Schlüssel liegt nur in Dokploy (`LINA_API_KEY`).~~ Seit 09.11.2026 stehen alle Schlüssel in
`LINA_API_SCHLUESSEL` (Abschnitt „Ein Schlüssel je Betrieb"); `LINA_API_KEY` entfällt.

Zwei Dinge, die das Formular nicht sagt:

* **Drittanbieter ist Pflicht.** Ohne Auswahl schickt das Formular `operator=Bitte wählen` an
  `POST /intranet/ladenakte/apikeyadd`, der Server antwortet mit einem Fehler, und die Seite zeigt
  nur „Verbindung nicht erfolgreich" — kein Hinweis aufs Feld. Einen neutralen Eintrag gibt es
  nicht (Foodnotify, sell&pick, SimplyDelivery, paywithdango, sizzly, Elitmind, Luca, billplease,
  Masero, Apicbase, JOMOsoft, SO'USE, Bounti, Yoordi). Gewählt: **Foodnotify**, weil wir mit
  Foodnotify ohnehin arbeiten; beim API-Key-Verfahren ist der Anbieter dem Augenschein nach nur
  Beschriftung, Rechte und IP stehen am Schlüssel. Wer die Liste liest: *dieser* Foodnotify-Eintrag
  gehört Concept Family Analytics, nicht Foodnotify.
* Die Rechteliste ist eine Mehrfachauswahl; ein einfacher Klick hebt alle anderen Markierungen auf.

Das Recht, das im Gespräch „Schichten und Zeiterfassung" hieß, heißt in LINA **„Schichten und
Zertifikate schreiben"** — ein Schreibrecht, das wir nicht brauchen. Die Arbeitszeiten kommen
über „Personalstammdaten und Kosten lesen".

Bestehende Schlüssel: *Sell & Pick* (IP 35.233.74.117) und *Bounti* (IP 51.15.69.173), beide von
Tobias Lindemann, ohne Ablauf — und **beide mit Schreibrechten**, die sie dem Augenschein nach
nicht brauchen (Bounti: Webkasse, Jomosoft-Import, Schichten schreiben). Das ist ein Befund für
den Fachbereich, nicht für uns (`offene-punkte.md`).

**IP-Bindung und IPv6.** `api.lina.de` liegt hinter Cloudflare und hat AAAA-Einträge. Bindet der
Schlüssel an die IPv4 des Servers (178.104.197.120), ~~muss der Client IPv4 erzwingen~~ —
**nachgemessen am 07.11.2026: der Importer-Container geht nur über IPv4 hinaus**
(`api64.ipify.org` aus dem Container: 178.104.197.120; Docker-Netz ohne IPv6). Der **Host**
selbst hat IPv6 (2a01:4f8:c0c:60ea::1) und würde bevorzugt darüber gehen — ein Aufruf direkt
auf dem Host, nicht im Container, würde also abgewiesen. Wird im Docker-Netz je IPv6
eingeschaltet, gilt das auch für den Container.

## Die Probe (`bun run tpapi-probe`, `src/tpapi_probe.ts`)

Zehn GET-Aufrufe, keine Datenbank, kein Wiederholen, der Schlüssel aus `LINA_API_SCHLUESSEL` (~~`LINA_API_KEY`~~) wird nie
ausgegeben, `kostUser` (je Person) ebenfalls nicht. Läuft **nur im Importer-Container**:

```bash
ssh root@178.104.197.120
docker exec $(docker ps --format '{{.Names}}' | grep cf-analytics-sync) bun run tpapi-probe --tag 01.11.2026
# ~~optional --laden <encId>, falls der Franchise-Schlüssel einen Betrieb wählen muss~~
#   (wählt nichts aus, gemessen 07.11.2026). Seit 09.11.2026 heißt --laden <encId>: den
#   Schlüssel dieses Betriebs aus LINA_API_SCHLUESSEL nehmen; ohne --laden der erste der Liste
```

Beantwortet: Ausgangsadresse, welcher Laden verbunden ist, ob sich das Limit mit anderen
Schnittstellen teilt (`getlimit` vorher/nachher), Personen und Kosten je Stunde, Journal mit
Brutto-Summe, Finanzweg-, Rabatt- und Stornozählung, Gästezahl aus `journaltables`, BWA ohne
Buchung, Artikelstamm. Ergebnis gehört danach in diese Datei.

## Was die Personal-Endpunkte liefern (Beispielantworten aus Postman)

- **`personalkostenprostunde`** je Geschäftstag: `eff` = **Personen je Stunde** (Schlüssel
  0–23), `kost` = **Personalkosten je Stunde in €**, `kostUser` = dieselben Kosten je Person
  als Liste. Genau die Zahl, die Melanies Auswertung angenommen hat („3 MA"). Achtung: `eff`
  heißt hier *Köpfe*, nicht €/h wie in der Kachel „Effektivität" im Tagesverlauf.
- **`personalkostenprotag`**: `h_brutto`, `h_zuschl_25/40/50`, `brutto`, `lohnkosten`.
- **`acceptedworkingtimes`**: genehmigte Zeiten je Person (`von`, `bis`, `von2`, `bis2`,
  `pause`, `bereich`).
- **`userdataperday`**: dasselbe plus Stunden, Zuschläge, Kosten und `stundenkosten` je Stunde
  — **personenbezogen**. Wir brauchen nur die Verdichtung je Betrieb und Stunde;
  `personalkostenprostunde` reicht dafür, ohne Personen zu speichern.

Offen: ob die Antworten die Zeiterfassung (Ist) oder den Dienstplan meinen. Der Dienstplan
steht bei allen Wilma-Betrieben auf 0 (KORREKTUR 10 f), die Zeiterfassung bei 7 von 13 am
05.11. ebenfalls — die API kann nicht mehr liefern, als in LINA gestempelt wird.

## Was daraus folgt

- **Besetzung und Kosten je Stunde** wären ein Aufruf je Betrieb und Tag, ohne die Ableitung
  Umsatz ÷ Effektivität und ohne deren Rundungsproblem am späten Abend.
- **Das Kassenjournal je Bon** (`revenue/journal`) mit Artikel, Finanzweg, Rabatt-ID, Kellner,
  Tisch und Storno-Grund — die Bonebene aus `plan-lina-vollabzug.md` über einen offiziellen Weg.
- **BWA und SuSa** wären per Buchung (*BWA Data API*) ebenfalls offiziell zu haben.
- Belegarchiv, Langfrist-BWA, Stammdatenblatt und Kassenblatt bleiben HTML in der Ladenakte;
  die TPAPI ersetzt den Scraper also nicht ganz.

## Was die TPAPI vom Scraper ablösen könnte (Abgleich 07.11.2026, nur am Papier)

Alles hier ist aus den Postman-Beispielen abgeleitet, **nicht gemessen**. Die Beispielantworten
sind alt (2019–2023) und klein; ob echte Antworten dieselben Felder tragen, sagt erst der
erste Aufruf.

**Anmeldung:** Header `apikey: <Schlüssel>`. **Wie ein Franchise-Schlüssel den Betrieb wählt,
steht nirgends** — die Doku kennt nur „den verbundenen Laden" (`revenue/store`). Bounti liest
mit *einem* Franchise-Schlüssel viele Standorte, es muss also einen Weg geben. Das ist die
erste Messfrage, und von ihr hängt alles Folgende ab. Ebenso offen: gilt das Limit von
100 / 15 min je Laden oder je Schlüssel.

**Der Kern ist `revenue/journal?businessdate=`** — eine Zeile je Bonposition mit `art`,
`artnr`, `preis`, `zahl`, `ust`, `datum` (Zeitstempel), `tisch`, `kellnernr`, `finanzweg`,
`rabatt_id`, `cancellationreason`, `site`, `terminal`, `pricelevel_id`,
`operationprofile_id`, `tableheader_id`. Dazu `revenue/journaltables?businessdate=` je Bon mit
`accounting_type`, `debitor_*`, `number_adults/kids/infants` (Gäste), `renum`, MwSt-Summen.
Ein Aufruf je Betrieb und Tag. Daraus ließe sich **rechnen**, was wir heute je Bericht holen:

| Heute gecrawlt | Kosten heute | Aus der TPAPI |
|---|---|---|
| 92 Rabatt (Tag) | 152.840 Aufrufe Historie, ~5,5 Wochen | `journal`: `rabatt_id`/`finanzweg` je Position — ob der Nachlassbetrag in der Position steht, offen |
| 97 Tagesabschluss / Finanzwege | Monat | `journal`: `finanzweg` je Position; ob Zahlungen eigene Zeilen sind, offen |
| 96, 86, 113 Bons, Debitoren, Tische (Woche, 504 bei Monat) | je ≈ 22.000 | `journaltables`: je Bon, mit Debitor, Tisch, **Gästezahl** (haben wir nirgends) |
| 39 Storno mit Grund | Monat | `journal`: `cancellationreason` |
| 60, 61, 53, 57 Kellner | Monat | `journal`: `kellnernr` — **die Nummer, die 53/61 nicht liefern** |
| 68, 69, 112, 71 Betriebs-/Verkaufsstellen | Monat | `journal`: `site`, `terminal` — Zuordnung zu den Stellen offen |
| 75, 76 Zeitzonen; `getZeitzonenbericht` (+ `:speisen`/`:getraenke`, `0137`) | Tag × 3 | `journal`: `datum` je Position → **Stunde × Artikel × Sparte frei**, ohne Tagesdurchschnitt-Falle und ohne die Nacht-Verschiebung aus `0138` |
| 90, 108 Monatsaufstellung, Verkaufszahlen | Monat | Summe über `journal` |
| `getArtikelverkaufsbericht` (Konzern, Tag) | Tag | Summe über `journal` |
| `getUmsatzbericht` + zehn Sparten-Varianten | Tag × 11 | Summe über `journal` mit Sparte aus dem Artikelstamm — **als Gegenprobe behalten**, nicht ersetzen |
| `getPersonalkosten` (Tag), `:monat` | Tag | `personal/personalkostenprotag` — und neu `personalkostenprostunde` |
| `articleApi:franchise` | — | `merchandiseman/recipe` mit `we` — **möglicherweise die Herkunft von `fixer_we`** (Regel 5, `0029`) |
| BWA (Kennzahlen, Ladenakte-Longterm) | — | `bwa/bwa`, `bwa/susa` — braucht die nicht gebuchte *BWA Data API* |
| — | — | neu: `revenue/getforecastperday` (LINAs Umsatzprognose je Tag) |

**Bleibt beim Scraper:** Kassenblatt/Fremdkasse (`0141`, keine LINA-Kasse, kein Journal),
Belegarchiv, Langfrist-BWA seit 2009, Stammdatenblatt (Adresse, Sitzplätze, Tagesbudget),
Verträge, Konzept-/Gruppenzuordnung, Dienstplan.

**Rechnung:** 24 Monate × ~62 Betriebe mit Kasse ≈ 45.000 Betrieb-Tage; `journal` +
`journaltables` + `personalkostenprostunde` ≈ 135.000 Aufrufe. Bei 100 / 15 min **je Laden**
und parallelen Läden wären das rund zwei Tage statt der Wochen aus `plan-lina-vollabzug.md` —
gilt das Limit je Schlüssel, sind es ~14 Tage. Regel 3 gilt für die Oberfläche; für die TPAPI
ist das Tempo von LINA vorgegeben und damit eine Messgröße, keine Tarnung.

**Volumen:** die Bonebene hat 30,3 Mio. Bons seit 2018 (`plan-lina-vollabzug.md`), die
Positionen ein Vielfaches. Partitionierung wie `core.artikelverkauf_tag`.

## Erste Messung, 07.11.2026 (Probe im Importer-Container, Tag 01.11.2026)

**Der Schlüssel trägt.** Ausgang 178.104.197.120 (IPv4, auch bevorzugt), jeder Aufruf HTTP 200.
`revenue/getlimit` liefert `{"limit": <verbraucht>, "rateLimit": 100}` — der Zähler stand vor
der Probe auf 1 (nur unser eigener Aufruf davor) und danach auf 8, später 12. **Er zählt nur
unsere Aufrufe**; Bounti und Sell & Pick erscheinen darin nicht.

**~~Ein Schlüssel für alle Betriebe~~ — widerlegt am selben Tag. Ein Schlüssel gilt für genau
EINEN Betrieb**, den, in dessen Ladenakte er angelegt wurde. `revenue/store` meldet *Aposto
Aalen GmbH*, und `laden=`, `storeId=` und `store=` mit der encId von Wilma Wunder Nürnberg
ändern daran nichts. Gegenprobe in der Oberfläche: unser Schlüssel steht nur in der Ladenakte
von Aposto Aalen, nicht bei Enchilada Aalen oder Wilma Wunder Nürnberg. Bounti und Sell & Pick
stehen dagegen bei allen dreien — mit leicht verschiedenen Namen („Sell & Pick" / „Sell&Pick"),
also **je Betrieb ein eigener Schlüssel**. „Ebene: Franchise" heißt nur: auf Franchise-Ebene
angelegt, nicht: für alle Betriebe gültig.

**Personal je Stunde** (`personalkostenprostunde`): Aposto Aalen, Sonntag 01.11.2026 —
Personen und Kosten je Stunde von 8 bis 3 Uhr, z. B. 18 Uhr 12 Personen / 215,30 €, 20 Uhr 10 /
166,04 €, 22 Uhr 8 / 87,02 €, 23 Uhr 3 / 29,78 €. Die Kosten sind Gleitkomma mit Rundungsrest
(`16.799999999999997`) — beim Laden auf Cent runden. `personalkostenprotag` liefert **eine Zeile
je Person** (19), ohne Namen.

**Journal** (`revenue/journal`): 1.834 Zeilen, 37 Felder (mehr als die Postman-Beispiele, u. a.
`vat_id`, `menucard_id`, `price_per_unit`, `event_number`, `captivesupplyreason`). Das Journal
ist eine **Buchungsliste mit Saldo null**: `balance` über alle Zeilen = 0,00, Verkäufe positiv,
Zahlungen negativ. `preis` ist bei vielen Zeilen 0 — der Betrag steht in **`balance`**.
**Je Finanzweg trifft es Bericht 97 (Tagesabschluss) auf den Cent:** Boniert (1) 7.638,14,
Bar (20) −2.432,05, Girocard (48) −2.816,60, VISA (42) −1.040,90, MasterCard (43) −933,90,
Sofortstorno (10) −201,70, Trinkgeld (2700) 235,53, Tischübergabe/-übernahme (22/23) ±620,20,
Online-Gutschein (3020/3021), Pluxee (3113), Paypal (129), TGTG (3008), City Star (128),
Systembuchung (−10) — alle gleich. Die **Rabatte** (97: Bruch, 25 %, 10 %, zusammen 12 Vorgänge)
sind keine Finanzwege, sondern stehen an der Position: 12 Zeilen mit `rabatt_id ≠ 0`.
Boniert 7.638,14 gegen `getUmsatzbericht` brutto 7.291,64 (Summe der Sparten, ohne Gutschein-,
Storno- und Rabattzeilen) — die Überleitung steht noch aus.

**Bons** (`revenue/journaltables`): 240 Bons, 27 Felder, **408 Gäste** (`number_adults` +
`number_kids`).

**BWA:** `403 {"message":"Module 'BWA' not licensed"}` — wie erwartet ohne Buchung.
**Artikelstamm:** `merchandiseman/grosscategory` 68 Großkategorien.

`listdays`: 2.507 Geschäftstage, 22.10.2019 bis 06.11.2026 — die Historie reicht bis zum
Kassenstart des Betriebs zurück.

## Ein Schlüssel je Betrieb: `bun run tpapi-schluessel` (07.11.2026)

Entscheidung Eugene: die Schlüssel werden nicht von Hand in 60–140 Ladenakten angelegt,
sondern von einem Skript, das der Nutzer **in seinem Terminal** startet (`src/tpapi_schluessel.ts`).
Das ist der **einzige schreibende Aufruf gegen LINA im Repository** — eine bewusste Ausnahme von
Regel 1, eingegrenzt auf einen Pfad (`LinaClient.apiSchluesselAnlegen()`, nur
`POST /intranet/ladenakte/apikeyadd`) und auf genau die Felder, die der Knopf schickt.

Ablauf je Betrieb, über den Ladenakte-Baum (`root` → `konzept_<n>` → `laden_<n>`):

1. Stammdatenblatt lesen. Der Laden-Hash fürs Anlegen steht dort im Knopf
   (`generateAPiKey('<40 hex>')`, = `core.betrieb.enc_id`), nicht im gesalzenen Pfad.
2. Steht ein Schlüssel „Concept Family Analytics" schon in der Tabelle → einsammeln, weiter.
3. Marktplatz lesen (`/intranet/marketplace/show-transfers/storeId/<encId>?admin=1`, gemessen
   07.11.2026 für Aposto Aalen: Article, Sales, Team Data API „Ja", Webkassen-API, BWA Data API,
   Tax Import „Nein"). Ist keine der drei Daten-APIs gebucht → kein Schlüssel.
4. Nur mit `--anlegen`: anlegen, Stammdatenblatt neu lesen, prüfen, dass Name, IP und genau die
   vier Leserechte dastehen. Jede Abweichung und jeder Fehler bricht den ganzen Lauf ab.

Die Schlüssel werden nie ausgegeben; sie landen in `.lina-api-schluessel.json` (Rechte 600,
`.gitignore`) und von dort als `LINA_API_SCHLUESSEL` nach Dokploy. Reihenfolge: Trockenlauf,
dann `--anlegen --nur <encId>` für einen Betrieb, dann alle.

### Trockenlauf, 07.11.2026: wer die Daten-APIs gebucht hat

130 Betriebe im Baum, alle Marktplätze lesbar (nur mit `?admin=1` — ohne leitet LINA mit
HTTP 302 um). **43 haben mindestens eine Daten-API gebucht, 87 keine.**

| Bild | Betriebe |
|---|---|
| Sales + Team + Article | 39, darunter Aposto Aalen (schon mit Schlüssel): alle laufenden Aposto außer Augsburg, alle Wilma Wunder außer Recklinghausen, 15 von 22 Enchilada, Park Cafe München |
| nur Team | BS Bier & Speisen, Ratskeller Saarbrücken, INSOLVENT Besitos MG |
| nur Sales | INSOLVENT Enchilada Bruchsal |
| keine | alle Franchisegeber- und Beteiligungsgesellschaften, alle geschlossenen, Schlager Cafe Düsseldorf, 12 von 15 Deutsche Konzepte, und **sieben laufende Enchilada: Bremen, Hamm, Hannover, Karlsruhe, Leipzig, Minden, Münster** |

Was daraus folgt:

* **Die TPAPI deckt nicht alle laufenden Betriebe ab.** Für die sieben Enchilada ohne Buchung,
  das Schlager Cafe und die Deutschen Konzepte bleibt der Scraper die einzige Quelle — auch für
  Personal je Stunde gibt es dort nichts. Jede Auswertung aus der TPAPI muss sagen, für wen sie
  gilt; eine Lücke darf nicht als „kein Personal" erscheinen (Regel 10).
* Bei BS Bier & Speisen und Ratskeller Saarbrücken ist nur die Team Data API gebucht. Ob der
  Schlüssel mit allen vier Rechten dort Journal oder Artikel liefert oder 403 („not licensed",
  wie die BWA) — wird mit dem ersten Abruf gemessen, nicht angenommen.
* Geschlossene und insolvente Betriebe bekommen keinen Schlüssel, auch mit Buchung (betrifft
  Besitos MG und Enchilada Bruchsal). Damit legt `--anlegen` **40** Schlüssel an.
* ~~Warum die sieben Enchilada nicht gebucht haben, ist offen.~~ Ihnen fehlt die ISP (Daniel,
  09.11.2026); er zieht sie nach. Leipzig ist geschlossen. Stand in `docs/offene-punkte.md`.

### Angelegt, 09.11.2026

`bun run tpapi-schluessel --anlegen` im Terminal des Nutzers, 09:57–ca. 10:35, Takt 4–8 s:
**39 angelegt, 2 vorhanden (Aposto Aalen, Wilma Wunder Nürnberg — dieser als Einzeltest mit
`--nur`), 89 ohne Buchung oder geschlossen, 0 unklar, kein Abbruch.** Jeder neue Schlüssel wurde
danach in der Ladenakte gelesen und mit Name, IP und genau den vier Leserechten bestätigt.
Die 41 Schlüssel stehen als `LINA_API_SCHLUESSEL` in Dokploy, Sicherung in Eugenes lokaler `.env`
(Entscheidung 09.11.2026 in `entscheidungen.md`).

Abgedeckt: 10 Aposto, 15 Enchilada (mit COYACAN und Gastronomie Wilsdruffer Straße), 13 Wilma
Wunder (mit Gastronomie am Markt Mainz), Park Cafe München, BS Bier & Speisen, Ratskeller
Saarbrücken (die letzten beiden nur Team Data API gebucht).

### Zweite Messung, 09.11.2026 (nach dem Deploy mit `LINA_API_SCHLUESSEL`, Tag 08.11.2026)

**Wilma Wunder Nürnberg — alles wie bei Aalen.** `revenue/store` nennt Nürnberg, 362 Tage in
`listdays` (03.11.2025–08.11.2026 — die Historie reicht also rund ein Jahr zurück, nicht weiter),
Personal je Stunde 08–22 Uhr und 07 Uhr (6 bis 14 Personen), 18 Personen im Tagesbericht, Journal
2.329 Zeilen, `journaltables` 307 Tische mit 420 Gästen, Artikel 62 Großkategorien, BWA 403.

* **`getlimit` stand vor unserem ersten Aufruf nach `revenue/store` schon auf 7**, nach den
  sieben weiteren auf 14. Bei Aalen am 07.11. zählte es nur unsere Aufrufe. Möglich ist, dass
  das Limit je Laden über alle Schlüssel zählt (Nürnberg hat auch Bounti und Sell & Pick) — dann
  teilen wir uns die 100 je 15 Minuten mit anderen Anbietern. **Nicht entschieden**; der
  Importer muss `getlimit` vor jedem Block lesen, statt mitzuzählen.

**Ratskeller Saarbrücken (nur Team Data API gebucht).** Jeder Endpunkt außerhalb der Buchung
antwortet 403 mit `Module 'Revenue' not licensed` bzw. `'Artikelstammdaten'` / `'BWA'` —
**auch `revenue/store` und `revenue/getlimit`**. Das ist keine Abweisung des Schlüssels; die
Probe bricht seitdem nur noch bei einer echten Abweisung ab. Die Personal-Endpunkte antworten
200, aber **leer** (`eff`/`kost` ohne Stunden, Tagesbericht `[]`). Ob der Betrieb am 08.11.
(Sonntag) zu hatte oder seine Schichten nicht in LINA plant, ist offen — mit einem Werktag
nachmessen, bevor ein leerer Tag als „kein Personal" gelesen wird.

Folge für den Importer: der Umfang je Schlüssel ergibt sich aus der Buchung. Ein 403
„not licensed" ist ein Zustand des Betriebs, kein Fehler — er gehört sichtbar in die Tabelle
der Zugänge (Entscheidung 09.11.2026), nicht in eine Wiederholung.
