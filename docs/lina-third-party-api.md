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
  heißt hier *Köpfe*, nicht €/h wie in der Kachel „Effektivität" im Tagesverlauf. **Und Köpfe
  heißt Köpfe:** nachgemessen am 09.11.2026 über 36.586 Stunden ist `eff` immer ganzzahlig — eine
  Person, die 15 Minuten der Stunde arbeitet, zählt 1. Die Tagessumme liegt im Median 26 % über
  den Personenstunden, die LINAs eigener Personalkostenbericht zugrunde legt (`Umsatz /
  eff_gesamt`), `kost` ist genauso verteilt (Monatssumme +27 % gegen `pek_gesamt`). Als Besetzung
  exakt, als Arbeitszeit eine Obergrenze (`0150`).
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
200, aber **leer** (`eff`/`kost` ohne Stunden, Tagesbericht `[]`). ~~Ob der Betrieb am 08.11.
(Sonntag) zu hatte oder seine Schichten nicht in LINA plant, ist offen~~ **Geklärt am 09.11.2026
(Lauf 195):** werktags liefert er (Mo 26.10.: 69 Kopfzahlstunden, 17 besetzte Stunden,
903,81 EUR), sonntags ist er zu. Der leere Sonntag war ein geschlossener Tag, kein fehlender
Dienstplan. Personal ist auch bei BS Bier & Speisen lizenziert; nicht lizenziert ist es einzig
bei Aposto Wuppertal Alte Papierfabrik.

Folge für den Importer: der Umfang je Schlüssel ergibt sich aus der Buchung. Ein 403
„not licensed" ist ein Zustand des Betriebs, kein Fehler — er gehört sichtbar in die Tabelle
der Zugänge (Entscheidung 09.11.2026), nicht in eine Wiederholung.

## Ist-Stand 09.11.2026: Stufe 1 gebaut

`personalkostenprostunde` wird seit Migration `0149` im Nachtlauf geholt (Plan, Entscheidungen
D1–D8 und Abweichungen: `plan-tpapi.md`; Importer: `importer.md`, Abschnitt „TPAPI-Dienst";
Tabellen: `datenmodell.md`; Sichten: `metabase.md`). ~~**Gebaut und gegen die Attrappe getestet, aber
noch nicht gegen das echte LINA gelaufen** (Regel 7a) — der erste echte Lauf ist der Nachtlauf nach
dem Deploy, die Messungen danach stehen in Plan §5.~~ **Erster echter Lauf am 09.11.2026 (Lauf 195,
manuell):** 2.560 Betrieb-Tage für 40 Betriebe, kein 429, kein `abgewiesen`; die Messungen und die
zwei Befunde daraus (Kopfzahl, Schlüssel ohne Schichten → `0150`) stehen in Plan §9.1.

| Endpunkt | Genutzt |
|---|---|
| `personal/personalkostenprostunde` | **seit `0149`** — Fenster 14 Tage plus Backfill bis 365 Tage; **seit `0153` (Stufe 2b) bis zur Tiefe von `listdays`**, der Rest im Nachladen von Phase C (`TPAPI_STUNDE_NACHLADEN`) |
| `personal/personalkostenprotag` | ~~nein — Zeilen je Person ohne Kennung, Frage an Eugene (`offene-punkte.md`)~~ **seit `0151` (Stufe 2a)** — vor `raw` zur Summe je Betrieb und Tag verdichtet (S5), Fenster 3 Tage plus Rückstand; **seit `0153` in `core.personalkosten_tag`**, ohne Horizont |
| `revenue/listdays` | **seit `0151`** — die Arbeitsliste, einmal je Betrieb und Nacht (`core.tpapi_geschaeftstag`) |
| `revenue/journal`, `revenue/journaltables` | **seit `0151`** — roh gesichert (Fenster 3 Tage, Rückstand in Phase C); ~~kein `core` vor der Formprobe (Schritt 2b)~~ **seit `0153` in `core.kassenjournal` und `core.kassenbon`**, die letzten 24 Monate (`TPAPI_CORE_MONATE`), der Rest bleibt roh |
| `merchandiseman/*` (13 lesende Listen) | **seit `0151`** — wöchentlich je Betrieb, roh (`core.tpapi_stammabzug`); **seit `0153`** der jüngste Abzug je Betrieb in `core.tpapi_artikel` & Co. (`prices` und `attributes` nur roh) |
| `revenue/getforecastperday` | ~~im Register, `aktiv: false` — Schreibweise von `from`/`to` ungemessen~~ **seit `0153` aktiv** (`from`/`to` als `dd.mm.yyyy`, Formprobe 12.11.2026): Fenster um heute in Phase A, Monate der Historie in Phase C → `core.umsatzprognose_tag` |
| ~~`revenue/*`, `merchandiseman/*`, `bwa/*`~~ `bwa/*` | nein (BWA nicht lizenziert) |
| `revenue/store`, `revenue/getlimit` | nur in Probe und Formprobe, nicht im Nachtlauf |
| `personal/acceptedworkingtimes`, `userdataperday`, `userdataperdaydelta`, `getPersonalData` | **bewusst nie** (Plan Stufe 2, S4) |

**Stufe 2a und 2b sind gebaut und gegen die Attrappe getestet, aber nie gegen das echte LINA als
Nachtlauf gelaufen** (Regel 7a). Nichts in der Tabelle ist damit am echten Zugang gemessen, was über
die Messungen vom 07. und 09.11.2026 und die Formprobe vom 12.11.2026 hinausgeht. Plan und
Abweichungen: `plan-tpapi-stufe2.md`.

Was der Client anders macht als der Scraper-Client: ein Schlüssel je Betrieb statt einer Sitzung,
kein Retry für keinen Ausgang, 429 beendet nur den Betrieb, „not licensed" ist ein Zustand
(`sync.tpapi_zugang`). Die Lohnkosten je Person (`kostUser`) werden nirgends gespeichert.

## Die Formprobe (`bun run tpapi-formprobe`, `src/tpapi_formprobe.ts`, Stufe 2, 12.11.2026)

**Noch nicht gelaufen.** Sie ist das Messskript vor Schritt 2b: die Werte der TPAPI-Felder sind
nicht gemessen (Typ, Datumsformat, Vorzeichen, Leerwert), und ohne sie lassen sich die Lader für
Journal, Bons, Personal und Artikelstamm nicht bauen. Gebaut gegen die Attrappe; das Ergebnis
gehört danach in diese Datei und in Plan Stufe 2 (§3, §8).

Nur GET, nur Pfade aus einer Erlaubtliste (jeder Aufruf wird dagegen geprüft), keine Datenbank, keine
Rohantwort in Datei oder Konsole, kein Wiederholen, der Schlüssel erscheint nie. Läuft **nur im
Importer-Container** (Schlüssel an die IPv4 des Servers gebunden, Regel 7a — **durch Eugene**):

```bash
ssh root@178.104.197.120
docker exec $(docker ps --format '{{.Names}}' | grep cf-analytics-sync) bun run tpapi-formprobe --tag 09.11.2026
docker exec ... bun run tpapi-formprobe --alle          # zusätzlich listdays je Schlüssel
# weitere Schalter: --laden <encId> (mehrfach), --aus <datei> = Ausgabedatei (Vorgabe
#   tpapi-formprobe.json); ohne --tag der Tag vor drei Tagen
```

Je Feld ein Profil (Typ, Anteil leer, Zahl verschiedener Werte, Min/Max bzw. Länge, bis zu fünf
Beispielwerte) für Journal, Bons und die Artikellisten; für `debitor_text`, `addinfo`, `zip_code`,
`kellnernr`, `masterkellnernr` **keine Beispielwerte**; `personalkostenprotag` nur Zeilenzahl und
Feldtypen, `kostUser` wird nicht ausgewertet. Dazu die Fragen, an denen das Datenmodell hängt:
Journal-Summen je Finanzweg, die Geschäftstagsgrenze, der Schlüssel zwischen Journal und Bons, die
Tiefe des Verlaufs, ein Alterstest für `personalkostenprostunde`, `personalkostenprotag` und
`journal` (ältester Tag aus `listdays` und ein Tag vor 400 Tagen), `getforecastperday` in den
Schreibweisen der Postman-Doku, und mit `--alle` `listdays` je Schlüssel (ältester und jüngster Tag,
Zahl der Tage — die Rechnung für den Rückstand). Ausgabe als Text und als JSON-Datei.

**Aufrufe und Tempo** (Kopfkommentar des Skripts): 28 bis 29 Aufrufe je Betrieb, Abbruch bei 55, eine
Pause von mindestens einer Sekunde — rund 35 Sekunden je Betrieb, zwei Betriebe etwa anderthalb
Minuten, mit `--alle` bei 41 Schlüsseln knapp eine Minute mehr. Die Grenze ist dokumentiert mit 100
je Laden und 15 Minuten; andere Anbieter lesen am selben Laden mit.

## Formprobe, 12.11.2026 (im Importer-Container, Tag 09.11.2026, 41 Schlüssel)

Vollständige Ausgabe: `docs/payloads/tpapi-formprobe-2026-11-12.txt` (Feldprofile je Endpunkt für
zwei Betriebe, ohne Beispielwerte für Kellner, Debitor, Freitext, Postleitzahl; Personal je Tag nur
als Summen). 29 Aufrufe je Betrieb, kein 429.

**Tiefe der Historie (`listdays` je Schlüssel).** 35 Betriebe führen Geschäftstage, zusammen
**92.686 Betrieb-Tage**. Ältester Tag 12.07.2014; 23 Betriebe reichen vor 2020 zurück; fünf haben
ein Jahr oder weniger (345, 365, 253, 167 Tage und einer mit 631). Ein Schlüssel liefert 200 mit
null Tagen, einer endet am 12.01.2026, drei antworten `Module 'Revenue' not licensed`.
~~„Die Historie reicht rund ein Jahr zurück" (Zweite Messung, Nürnberg)~~ — das galt für Betriebe,
die erst seit einem Jahr an dieser Kasse sind, nicht für die Schnittstelle.

**Auch Personal reicht so weit.** Aposto Aalen, ältester Tag 23.10.2019: `personalkostenprostunde`
17 Stunden, `personalkostenprotag` 18 Zeilen, `journal` 2.143 Zeilen; vor 400 Tagen ebenso. Beim
zweiten Betrieb (Kassenstart 04.11.2025) liefert der Tag vor 400 Tagen überall 200 mit null Zeilen.
Der Horizont von 365 Tagen aus Stufe 1 (`0149`) ist damit zu kurz — Schritt 2b hängt Personal je
Stunde an dieselbe Arbeitsliste (Plan S3). **Seit `0153` gebaut** (`mart.personal_rueckstand` reicht bis
zur Tiefe von `listdays`, Phase C holt den Rest); noch nicht gelaufen.

**`businessdate` ist Berliner Mitternacht**: `1571781600` = 22.10.2019 22:00 UTC = 23.10.2019
00:00 Berlin. Die Annahme in `src/tpapi/verdichtung.ts` stimmt; ~~„Aalen ab 22.10.2019"~~ (Erste
Messung, über UTC gelesen) war einen Tag zu früh. `refdate` im Journal ist ebenfalls Berliner
Mitternacht des Geschäftstags.

**Journal (1.182 bzw. 1.034 Zeilen, 1,2 bzw. 1,05 MB).** Alle Zahlen sind JSON-Zahlen, `tisch`,
`ust`, `buchungsnr`, `art`, `addinfo` Text. `ID` und `am_id` sind eindeutig; `datum` sind
Unix-Sekunden je Position, **keine Zeile liegt außerhalb des Geschäftstags 08:00–07:59**;
Summe `balance` = 0; `preis` = `balance` in beiden Proben (keine Zeile mit `preis = 0` und
`balance ≠ 0` — anders als am 01.11. gemessen, also nicht darauf bauen). `zahl` −1..3;
`situation` 0/1/2; `site` 0/1; `rabatt_id ≠ 0` an 27 Zeilen; `parentid ≠ 0` an 311 (Beilagen,
Zusätze); `artnr` an 967 Zeilen (237 verschiedene), Sonderzeilen mit `artnr` ≤ 0. Sieben Felder
sind durchgehend `null` (`event_number`, `menucard_id`, `price_per_unit`,
`financeextendedinfo_id`, `provision_free`, `course_price_print`, `coursedefentry_id`). `addinfo`
ist zu 98 % leer, sonst bis 1.466 Zeichen lang.

**Bons (`journaltables`, 190 bzw. 161 Zeilen).** `tableheader_id` eindeutig; jeder Bon des
Journals steht darin (164/164), 26 Einträge ohne Journalzeilen haben `accounting_type = EMPTY`.
`documentdate` Unix-Sekunden; Gäste in `number_adults`/`number_kids` (245 + 1). In beiden Proben
leer oder null: `debitor_text`, `zip_code`, `debitor_id`, `reservation_id`, `vat1sum`–`vat3sum`,
`finanzweg`, `zahl`.

**Personal je Tag.** Sechs Felder, alle JSON-Zahlen; 09.11.2026 Aalen: 15 Personen, 106,21 Stunden,
14,38 Zuschlagsstunden 25 %, Brutto 1.641,91, Lohnkosten 2.050,48.

**Prognose.** `revenue/getforecastperday?from=05.11.2026&to=11.11.2026` (`dd.mm.yyyy`) liefert
sieben Zeilen `datum` (Unix-Sekunden, Berliner Mitternacht) und `forecast` (netto, EUR).

**Artikelstamm.** `merchandiseman/recipe`: 10.041 bzw. 4.070 Artikel, **31,6 bzw. 11,9 MB** je
Betrieb, mit `number` (Artikelnummer), `name`, `active`, `function`, `detailcategory`, `meccode`,
**`fixedwe`** (Wareneinsatz je Artikel, 0..204 — der Kandidat für die Herkunft von
`core.artikel.fixer_we`, Regel 5), `prices` und `attributes` als Listen. Dazu `financetype`
(208 Finanzwege mit Namen und Kategorie), `financecategory`, `meccode`, `meccodegroup`,
`category`, `detailcategory`, `grosscategory`, `vat`, `pricelevel`, `site`, `operationprofile`,
`attributes` (Allergene, Zusatzstoffe).

**Limit.** `getlimit` stand bei beiden Betrieben **vor unserem ersten Aufruf auf 50 von 100** und
nach 29 Aufrufen auf 75 bzw. 67. Andere Anbieter lesen am selben Laden mit; die eigene gleitende
Grenze ist deshalb von 60 auf 40 gesenkt (`TPAPI_GRENZE_JE_BETRIEB`).

**Rechnung für den Rückstand.** 92.686 Tage × drei Tagesendpunkte ≈ 278.000 Aufrufe, dazu Personal
je Stunde für die Jahre vor dem bisherigen Horizont (≈ 65.000). Bei einem Aufruf je Sekunde und
`TPAPI_NACHLADEN_JE_LAUF = 10.000` rund fünf Wochen, bei 25.000 rund zwei.

## Ist-Stand 12.11.2026: Stufe 2b gebaut (`0153`)

Der Lader raw → core steht (`src/tpapi/core_laden.ts`): Journal, Bons, Personal je Tag, Prognose und
Kassenstamm. **Gebaut und gegen die Attrappe getestet, nie gegen das echte LINA gelaufen** — die
Attrappe bildet die Form der Formprobe nach, echte Journalzeilen gibt es lokal nicht. Plan:
`plan-tpapi-stufe2.md` §5 (B1–B16) und §8; Tabellen `datenmodell.md`, Quellenlage `datenherkunft.md`,
Sichten `metabase.md`.

**Was die Formprobe für den Bau entschieden hat:** die sieben in beiden Proben leeren Journalfelder
sind keine Spalten (sie landen mit Wert in `zusatz`); `geschaeftstag` kommt aus der Abrufzeile und wird
nicht umgerechnet (keine Zeile außerhalb 08:00–07:59); die Prognose ist ein Bereichsabruf mit
`dd.mm.yyyy`; Personal je Stunde und Tag reichen so weit wie `listdays`; `grosscategory` hat doppelte
`id`s (68 Einträge, 61 ids — deshalb Position als Schlüssel); `recipe` ist je Betrieb 12–32 MB, fast nur
Preise und Allergene (deshalb nur ein Teil der Felder nach `core`).

**Was ungemessen bleibt** (Plan §8, „Offen nach 2b"; nach dem ersten echten Lauf an den
Abgleichsichten zu lesen): ob die Deutung „was ist Umsatz im Journal“ den Umsatzbericht trifft
(`mart.kassenjournal_abgleich_monat`); ob `artnr` die Kassenartikelnummer und `finanzweg` die Nummer
(nicht die id) ist (`mart.kassenjournal_stamm_pruefung`, `mart.kassenjournal_finanzweg_stamm`); ob eine
Rabattzeile der Nachlassbetrag oder die rabattierte Position ist; ob ein Sofortstorno doppelt zählt;
was `h_brutto` ist; ob LINA Prognosen für Zukunftstage liefert und nachträglich ändert. Für diese
Betriebe gelten die Betriebsberichte des Scrapers weiter (S10).
