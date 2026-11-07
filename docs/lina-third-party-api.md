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

Zehn GET-Aufrufe, keine Datenbank, kein Wiederholen, der Schlüssel aus `LINA_API_KEY` wird nie
ausgegeben, `kostUser` (je Person) ebenfalls nicht. Läuft **nur im Importer-Container**:

```bash
ssh root@178.104.197.120
docker exec $(docker ps --format '{{.Names}}' | grep cf-analytics-sync) bun run tpapi-probe --tag 01.11.2026
# optional --laden <encId>, falls der Franchise-Schlüssel einen Betrieb wählen muss
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
