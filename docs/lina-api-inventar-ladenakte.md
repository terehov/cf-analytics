# LINA API Inventar — Ladenakte, Belegarchiv, BWA-Longterm

**Erhebungsdatum:** 11.08.2026
**Bereich:** `Stores → Administration → Ladenakte`, `/intranet/ladenakte/index?admin=1`
**Erhebungsmethode:** Lesen in der **angemeldeten Browser-Sitzung des Nutzers** (Playwright-MCP).
Ausschließlich `GET`. Nichts angelegt, geändert, hochgeladen oder gelöscht.
**Verhältnis zu 1a/1b/1c:** Ergänzung, kein Widerspruch. Die dort beschriebenen
Report-Center-Endpunkte bleiben unverändert gültig.

> **Warum das hier ein eigenes Dokument ist.** Die Ladenakte ist keine weitere
> Berichtsseite, sondern das **Dokumentenarchiv des Konzerns**: rund eine halbe
> Million Belege, die vollständige BWA-Historie seit 2009 und die Stammdaten,
> die im Report Center schlicht nicht vorkommen (Sitzplätze, Fläche,
> Gesellschafter, Plan-BWA, Tagesbudget). Nichts davon ist über die sieben
> Konzern-Berichte erreichbar.

---

## 1. Adressierung: der Baum

Die Ladenakte lädt ihre Struktur über **einen** Endpunkt nach, Knoten für Knoten:

```
GET /intranet/ladenakte/baum/admin/1?id=<knoten>
```

| `id` | liefert |
|---|---|
| `root` | 11 Konzepte |
| `konzept_<n>` | die Betriebe des Konzepts |
| `laden_<n>` | die 9 Rubriken eines Betriebs |
| `belegarchiv_<n>` | 14 Belegordner |
| `bwa_<n>` | 3 BWA-Sichten |
| `report_<n>` | 14 Berichte |
| `forms_<n>` | Formulargruppen |

`<n>` ist die **numerische LINA-Betriebs-ID** — dieselbe, die in
`core.betrieb.lina_betrieb_id` steht. Antwort ist JSON, ausgeliefert mit
`Content-Type: text/html` (nicht auf den Header verlassen, direkt parsen).

**Bestand am 11.08.2026: 131 Einträge in 11 Konzepten.** Das sind mehr als die
Betriebe, die das Report Center kennt — enthalten sind auch geschlossene und
insolvente Gesellschaften (34), Franchisegebergesellschaften (17) und
Testläden. Für Auswertungen ist das eine Chance und eine Falle zugleich:
Historie geschlossener Betriebe wird hier greifbar, darf aber niemals
kommentarlos in eine Betriebsvergleichs-Kennzahl laufen.

### 1.1 Zwei Token-Arten — der Unterschied ist wichtig

| Art | Länge | Verhalten | Vorkommen |
|---|---|---|---|
| **Laden-Hash** | 40 hex | **stabil**, über Aufrufe hinweg gleich | `/intranet/report/…`, `fileaccess`, `vertragedit`, `getplanbwa` |
| **`storeId`-Token** | 86 hex | **je Anfrage neu gesalzen** | `showBelegarchivFolder`, `beleglist`, `getBeleg` |
| **`laden=`-Parameter (BWA)** | 84 hex | **je Anfrage neu gesalzen** | `/finanzen/bwa/…`, `/finanzen/stat/…` |

Daraus folgt für jeden Importer: **gesalzene Token sind nicht speicherbar.**
Der Baum muss vor jedem Lauf frisch gegangen werden, und ein Token, der beim
Blättern durch 12.000 Belege abläuft, muss neu geholt werden können.

Gemessen: ein `storeId`-Token kodiert **nur den Laden, nicht den Ordner** —
derselbe Token funktioniert für alle 14 `typeId`. Das spart beim Zählen 13
Anfragen je Betrieb.

---

## 2. Die 9 Rubriken eines Betriebs

Gemessen an `laden_15` (Enchilada Karlsruhe GmbH) und `laden_196` (GSF Gastro GmbH).

| Rubrik | Ziel | Ergiebigkeit |
|---|---|---|
| Stammdaten | `/intranet/ladenakte/ladenstamm/laden/<hash>/admin/1/` | **hoch** — Abschnitt 4 |
| Buchhaltung | `/intranet/report/buhaexport/laden/<hash>/admin/1/` | mittel — Abschnitt 6 |
| Formulare | `/intranet/formular/showforms/laden/<hash>/group/<n>/admin/1/` | mittel — QS-Checks |
| Forum | `/intranet/ladenakte/forum/laden/<hash>/admin/1/` | **gering** — 1 Thema |
| Verträge | `/intranet/ladenakte/vertraege/laden/<hash>/admin/1/` | **hoch** — Abschnitt 5 |
| BWAs | 3 Sichten unter `/finanzen/bwa/…` | **sehr hoch** — Abschnitt 3 |
| Reports | 14 Berichte, s. u. | gering–mittel |
| Belegarchiv | 14 Ordner | **sehr hoch** — Abschnitt 7 |
| Franchise Services | `/intranet/franchise-services/service-invoices/<hash>` | **gering** — leer |

Die 14 Reports: Verkaufszahlen, Budget, Personalkosten, Umsatzentwicklung,
Wareneinsätze, Superkennzahl, Inventurstände, Gutscheinkonten, Kassenblatt/ZE,
Die letzten Tage, Die letzten Jahre, Ranking, Managementreport, Zeitzonenreport.
Sie sind **Darstellungen über denselben Daten**, die das Report Center als JSON
liefert — für den Importer uninteressant, mit zwei Ausnahmen (Budget,
Inventurstände), die aus dem Stammdatenblatt bzw. der Warenwirtschaft stammen.

Gegenprobe Inventurstände Karlsruhe: nur 01/2026–05/2026, drei Zeilen,
überwiegend leer. **Regel 5 aus `AGENTS.md` bleibt hier gültig** — LINAs
Warenwirtschaft trägt keine belastbaren Inventurdaten. Gegenprobe im Buy-Modul
(`/wawi/inventory/inventory`, Betrieb 62): 11 Inventurstichtage, **jüngster
08.02.2017**. Das Modul ist seit neun Jahren tot.

---

## 3. BWA-Longterm — die größte Einzelfundstelle

```
GET /finanzen/bwa/longterm?module=franchise&laden=<gesalzener-hash>
GET /finanzen/bwa/auswertung?module=franchise&laden=<hash>        (Jahr)
GET /finanzen/bwa/auswertungsingle?module=franchise&laden=<hash>  (Monat)
```

`longterm` liefert **in einer einzigen Antwort** (≈ 1,2 MB HTML):

* **207 Monatsspalten, 06/2009 bis 08/2026**
* **103 Zeilen** (77 davon mit Inhalt, der Rest sind Gliederungsleerzeilen)

Für Enchilada Karlsruhe tragen die Spalten **ab 01/2012** Werte, zuletzt
**05/2026** (Gesamtleistung 01/2012 = 139.046,95 €, 05/2026 = 155.732,67 €).

Die Zeilen gehen weit über das hinaus, was `getKennzahlen` liefert:

| Block | Zeilen |
|---|---|
| Erlöse | Erlöse Getränke, Erlöse Speisen, sonstige Erlöse, Gesamtleistung, **davon Delivery** |
| Wareneinsatz | **WE Getränke, WE Speisen, Bruch, Skonto/Boni/BezugsNK**, Wareneinsatz, Rohmarge |
| Personal | Personalkosten o.G., **Krankheit, Urlaub**, Geschäftsführung, Freiwillige soz. Auf., Beiträge BGN, Fremdarbeiten |
| Verbrauch | Verpackungsmaterial, Küchen/Servicebedarf, Hygiene-/Reinigungsmittel |
| Vertrieb | Provisionen/Gebühren, Werbekosten, Nebenkosten Geldverkehr |
| Betrieb | Reinigung, Schädlingsbekämpfung, **Energiekosten**, Abfallbeseitigung, Reparatur/Instandhaltung |
| Verwaltung | Reise/Bewirtung, Fortbildung, Fuhrpark, Bürobedarf, Telekommunikation |
| Abgaben | Versicherung, Verspätungszuschlag, Beiträge, Sonstige Abgaben, Sonst. betr. Steuern |
| Beratung | Buchführung, Abschluss/Prüfung, Rechts-/Beratungskosten |
| Miete | **Mietaufwand, Untervermietung, Mietnebenkosten** |
| Kapital | Abschreibungen, Leasing&sonst. Mieten |
| Franchise | **Franchisegebühr**, sonst. Franchisekosten |
| Ergebnis | Op. Betriebsergebnis, Betriebsergebnis, Neutraler Ertrag/Aufwand, **EBIT**, Zinsergebnis, **EBT**, Steuern, Vorläufiges Ergebnis, **EBITDA** |

**Was das schließt.** Der offene Round-Table-Posten A11 („Rendite" ohne
Definition, Wilma-Wunder-Report fehlt) ist damit erledigt: EBIT, EBITDA, EBT
und das vorläufige Ergebnis stehen je Betrieb und Monat seit 2012 zur
Verfügung. Ebenso Miete, Energie und Franchisegebühr — drei Kostenblöcke, die
in unserem Bestand bisher überhaupt nicht vorkommen.

### 3.1 Reichweite je Betrieb (10 Betriebe gemessen)

Die Spaltenzahl ist **nicht fest** — die Tabelle beginnt bei der Eröffnung des
Betriebs und endet beim zuletzt gebuchten Monat:

| Betrieb | Spalten | Werte von | bis | Monate mit Wert | MB |
|---|---|---|---|---|---|
| Ratskeller Augsburg | 224 | 01/12 | 06/26 | 170 | 1,21 |
| Enchilada Bayreuth | 212 | 01/12 | 06/26 | 174 | 1,15 |
| Park Cafe München | 212 | 01/12 | **12/25** | 162 | 1,16 |
| INSOLVENT Enchilada Pforzheim | 212 | 01/13 | 12/24 | 138 | 1,14 |
| GESCHLOSSEN Enchilada München | 212 | 01/12 | 12/15 | 48 | 1,12 |
| Enchilada Karlsruhe | 207 | 01/12 | 05/26 | 172 | 1,13 |
| Aposto Augsburg | 140 | 06/15 | 06/26 | 133 | 0,78 |
| Wilma Wunder Köln | 109 | 10/19 | 06/26 | 80 | 0,61 |
| Schlager Cafe Düsseldorf | 20 | 01/25 | 03/26 | 15 | 0,14 |
| CONCEPT FAMILY Franchise AG | 80 | — | — | **0** | 0,44 |

Drei Beobachtungen, die für den Importer zählen:

1. **Geschlossene und insolvente Betriebe tragen ihre volle Historie.** München
   endet sauber 12/15, Pforzheim 12/24. Für Zeitreihen ist das ein Gewinn.
2. **Der Endmonat ist der BWA-Rückstand.** Park Cafe München endet 12/25 —
   für 2026 ist dort nichts gebucht, während andere bis 06/26 laufen. Das
   deckt sich mit `mart.bwa_rueckstand` und ist eine kostenlose Gegenprobe.
3. **Die Franchisegebergesellschaft hat 80 Spalten und keinen einzigen Wert.**
   Wer aus „Tabelle vorhanden" auf „Daten vorhanden" schließt, importiert
   Nullen. Die Prüfung muss auf *Werte* gehen, nicht auf *Struktur* — genau der
   Silent-Failure-Typ, vor dem `lina-api-inventar.md` bei `getKennzahlen` warnt.

**Aufwand:** eine Anfrage je Betrieb für die gesamte Historie, 0,1–1,2 MB.
Für alle 131 Betriebe rund **120 MB in 131 Anfragen**. Das ist die mit Abstand
günstigste Datenquelle im ganzen Projekt — günstiger noch als `getKennzahlen`
mit zwei Aufrufen je Jahr, und sie reicht sechs Jahre weiter zurück.

**Fallstrick:** die Antwort ist HTML, keine JSON-Schnittstelle. Die Tabelle ist
serverseitig gerendert (keine PrimeVue-Virtualisierung), das Parsen ist damit
stabil — aber es bleibt DOM-Auswertung und braucht eine Schemaprüfung: Zeilen
über die **Beschriftung** treffen, nie über den Index.

---

## 4. Stammdaten — vier Tabellen, die es sonst nirgends gibt

`/intranet/ladenakte/ladenstamm/laden/<hash>/admin/1/` (≈ 317 KB).

**a) Kapazität je Bereich** — `Bereich | Plätze | Tische | Fläche [qm]`
Karlsruhe: Gesamt 632 Plätze / 339 qm, Biergarten 250, Theke 32.
→ Ermöglicht **Umsatz je Sitzplatz** und **Umsatz je qm**. Beides stand auf der
Round-Table-Wunschliste und galt als nicht verfügbar.

**b) Gesellschafter mit Anteilen** — Karlsruhe: Condukto AG 20 %,
Christian Veit 20 %, Thorsten Jablonka 40 %, Miroslav Subotic 20 %.
Dazu Geschäftsführer und stellv. Geschäftsführer namentlich.

**c) Plan-BWA** — `ID | BWA-Zeile | 1/2025 … 12/2025`, **77 Zeilen × 12 Monate**.
Nachladbar über `/intranet/ladenakte/getplanbwa/?laden=<hash>&monat=<m>&jahr=<j>`.
→ **Plan gegen Ist** wird damit rechenbar, auf derselben Zeilenstruktur wie
BWA-Longterm. Das ist die Grundlage jeder Abweichungsanalyse.

**d) Tagesbudget** — `Datum | Umsatz netto | Stunden Service | Stunden Bar | Stunden Küche`,
**366 Zeilen je Jahr**.
→ **Plan-Stunden je Tag und Bereich.** Unser Bestand kennt bisher nur die
Ist-Stunden aus `core.personalkosten`. Damit wird die Personaleffizienz erstmals
gegen eine Planung messbar statt nur gegen den Vormonat.

**e) API-Keys** — `Name | API-Key | IP-Adressen | Drittanbieter | Läuft ab | Rechte (Scopes) | Erzeugt von | Ebene`

> **Der wichtigste strategische Befund des Tages.** LINA hat eine
> **offizielle Third-Party-API mit vergebenen Schlüsseln und Scopes**, und
> Concept Family nutzt sie bereits: eingetragen sind **„Sell & Pick"**
> (Scope u. a. *Artikelstammdaten schreiben*) und **„Bounti"**
> (Scope *Personalstammdaten und Kosten*), beide auf Ebene *Franchise*,
> angelegt von Tobias Lindemann, jeweils auf eine feste IP gebunden.
>
> Zwei Konsequenzen. Erstens: **Bounti ist entgegen der Lückenanalyse vom
> 10.08.2026 nicht unangebunden** — es gibt einen produktiven Schlüssel mit
> Personalkosten-Scope. Zweitens: für unseren Importer existiert damit ein
> **sanktionierter Weg**, der das Scraping und das ganze Anmeldeproblem aus
> `docs/protokoll-anmeldeverfahren.md` (Regel 7a) ersetzen könnte — ein eigener
> Schlüssel mit lesenden Scopes, gebunden auf die Hetzner-IP.
> **Das ist eine Frage an LINA und an Tobias Lindemann, keine technische.**

Die Schlüsselwerte selbst sind Zugangsdaten. Sie wurden gelesen, aber
**bewusst nicht in dieses Repository geschrieben** — Regel 2.

---

## 5. Verträge — und eine ernste Falle

`/intranet/ladenakte/vertraege/laden/<hash>/admin/1/`
Karlsruhe: **92 Verträge**, GSF Gastro: 108.

Spalten: `Bezeichnung | Kategorie | Ablagedatum | Vertragsdatum | Vertragsende |
Kündigungsfrist | Kommentar | Mail | Datei`.
Kategorien u. a. *notarielle Urkunden*, *Gründung*.
Download: `/intranet/ladenakte/fileaccess/laden/<hash>/ordner/vertraege/datei/<dateiid>`

→ **Vertragsende und Kündigungsfrist** je Betrieb maschinell auswertbar:
Fristenkalender, Mietvertragslaufzeiten, Auslaufrisiken.

> ### ⚠ Löschen geschieht per GET
>
> Dieselbe Seite enthält je Vertrag eine Zeile
> `…/vertraege/laden/<hash>/vertragid/<id>/delete/1`.
> Das ist **kein POST und kein Formular** — ein gewöhnlicher Link. Ein Crawler,
> der Links folgt, oder ein Prefetch im Browser **löscht damit Verträge**.
>
> Für jeden Importer gilt deshalb: **niemals Links folgen.** Nur explizit
> zusammengesetzte URLs aus einer Positivliste aufrufen. `delete`, `edit`,
> `upload`, `add`, `set` sind im gesamten Ladenakte-Baum als Pfadsegmente
> verboten. Das gehört in den Code als harte Sperre, nicht in einen Kommentar.

---

## 6. Buchhaltung — Exportformate

`/intranet/report/buhaexport/laden/<hash>/admin/1/` ist eine Verteilerseite auf
fertige Exporte:

```
/intranet/report/export/format/<fmt>/laden/<hash>
```

| `<fmt>` | Inhalt |
|---|---|
| `stammlohnugehalt`, `stammlodas`, `stammlohnag` | **Personalstammdaten** → DATEV Lohn&Gehalt / LODAS / Lohn AG |
| `lohnugehalt`, `lodas`, `lohnag`, `veda` | **Bewegungsdaten** → dieselben Systeme + VEDA |
| `datevformat` | DATEV-Buchungsstapel |

Dazu `/intranet/report/stundenzettelpdf/uid/0/laden/<hash>/` und
`/intranet/report/monatabpdf/laden/<hash>/`.

→ Für eine **Datensicherung** ist `datevformat` interessanter als jedes
Einzeldokument: es ist der strukturierte Buchungsstapel statt eines PDF-Stapels.
Noch nicht abgerufen — Format und Umfang sind ungeprüft.

---

## 7. Belegarchiv — rund eine halbe Million Dokumente

### 7.1 Ordner (`typeId`)

Je Betrieb 14 Ordner. Die konzernweite Systematik hat 330 Knoten in 4 Wurzeln
(`GET /finanzen/document/belegartTree`):

| Wurzel | Arten |
|---|---|
| **Posteingang** | Posteingang (3987), Posteingang Lohn (3988) |
| **Lohn** | 30 Arten, u. a. Arbeitsverträge (9), Krankmeldungen (13), **Lohnabrechnung (3959)**, Meldebescheinigungen SV (3960), Lohnsteuerbescheinigung (3961), Personalbogen (3978), Kündigungen (3979), **Ausweisdokumente (3980)**, Aufenthalts-/Arbeitserlaubnis (3981), **Pfändungen (3986)**, **Geburtsurkunde (4004)** — 3959/3960/3961 zusätzlich nach **Jahr und Monat** gegliedert (2019–2026) |
| **FiBu** | Eingangsrechnungen und Avise (1), Ausgangsrechnung (2), Inventur und Bruchlisten (3), Kassenbeleg (5), Gastrechnungen (6), Cateringrechnungen (7), sonstige Dokumente (16), Avise (3967), sonstige Auswertungen (3968), USt-Voranmeldungen (3969), Lieferscheine (3970), Mahnungen (3971), Steuerunterlagen (3972), Verträge (3973), **BWA (3974)**, Susa (3975), OPOS-Listen (3976), Kontoauszüge (3977) |
| **Sonstige** | Dokumentation (4000) |

Im Ladenakte-Baum erscheinen davon 14 (die FiBu-Arten plus BWA/Susa/OPOS).
Die **Lohn-Arten sind über die Ladenakte nicht sichtbar** — sie liegen im
zentralen Belegarchiv unter `Finance → Belegarchiv`.

### 7.2 Liste und Download

**Weg A — je Betrieb, ohne Mandantenwechsel (für den Bulk-Lauf der richtige):**

```
GET /intranet/ladenakte/showBelegarchivFolder?storeId=<tok>&typeId=<n>&admin=1
    -> HTML, darin  var getFilesUrl = '…'  und  var getBelegUrl = '…'
GET /intranet/ladenakte/beleglist?admin=1&storeId=<tok>&typeId=<n>
    &draw=1&start=0&length=200&order[0][column]=6&order[0][dir]=desc
GET /intranet/ladenakte/getBeleg?admin=1&storeId=<tok>&id=<encryptedId>
```

DataTables serverseitig, Antwort `{data, recordsTotal, recordsFiltered}`.
`length=200` verifiziert. Zusätzlich `showArchived` für archivierte Belege.

**Weg B — zentral, aber nur für den aktiven Mandanten:**

```
GET /finanzen/document/belegartTree
GET /finanzen/document/filelistByBelegart?typeId=<n>&start=0&length=200
    &archived[value]=false&archived[matchMode]=equals
    &belegarts[value][0]=<n>&belegarts[matchMode]=contains
GET /finanzen/document/getEmployeeList
```

Weg B liefert **mehr Felder** (s. u.), ist aber an den im Kopf gewählten
Mandanten gebunden — gemessen an Betrieb 62: 12.064 Eingangsrechnungen, alle
mit Präfix `62_`. Für 131 Betriebe hieße das 131 Mandantenwechsel. **Weg A
gewinnt für den Bulk-Lauf, Weg B für die Feldtiefe.**

### 7.3 Felder je Beleg

```
id, encryptedId, belegDatum(+Time), leistungsDatum(+Time), reNumber,
nettoBetrag, nettoBetragTax "netto/7/0", taxItems {0,7,19},
belegart, belegartName, zuordnungFibu (0 sonstiges | 1 Bar | 2 Küche),
seller_name, seller_id, kreditor_account,
cost_account, cost_account7, cost_account0,
datev_guid, parashift_status, parashift_id "<ladenid>_<belegid>",
uploadedBy(+Name), uploadedOn(+Time), zuordnungMa(+Name), downloadedOn,
uploadedFromArea, archived, downloadFilename, extension
```

Nur über Weg B zusätzlich: `netto`, `nettoTaxItems`, `globalDiscount`,
`seller_ustid`, **`lineItems`, `lineItemsSum`, `lineItemsSumAccount`,
`lineItemsVat`, `lineItemsVatAssigned`**, `exported`, `InvoiceSumsValid`,
`is_xrechnung`, `is_gutschrift`, `ust14_valid`, `ust14_errors`.

**Das ist strukturierte Buchhaltung, kein PDF-Haufen.** Die Belege sind per OCR
(`parashift_status: done`) erschlossen, tragen Lieferant, Kreditorenkonto,
Sachkonto, MwSt-Aufteilung und DATEV-GUID. Für Auswertungen heißt das: **die
Metadaten allein sind auswertbar, ohne eine einzige PDF-Datei zu laden.**

Besonders `zuordnungFibu` (Bar / Küche / sonstiges): das ist der
**Wareneinsatz-Split an der Rechnung selbst**, unabhängig von Artikelpflege und
PLU-Nummernraum. Der offene Posten C1 ist damit über eine dritte, unabhängige
Quelle angreifbar — und diese dritte deckt auch **Deutsche Konzepte** ab, die
Marke ohne Soll-Wareneinsatz, bei der die beiden anderen Wege dünn sind.

Zur Einordnung der Deckung, gemessen in [`befunde-datenlage.md`](befunde-datenlage.md):
`fixer_we` deckt **31,3 %** des Umsatzes, die Amadeus/FoodNotify-Obergrenze liegt
bei **33,9 %**; die oft zitierten **63 %** sind erst die *Summe beider Wege auf
Markenebene* und gehören nicht zu einem der beiden allein.

### 7.4 Mengengerüst — vollzählig gemessen, nicht hochgerechnet

**Alle 131 Betriebe gezählt, 0 Fehler. 109 tragen Dokumente, 22 sind leer.**
Die leeren sind Testläden (`A Testladen Concept Family`, `Tobi Enchi Testladen
Zwei`), Neueröffnungen (`Wilma Wunder Bochum`, `Aposto Wuppertal – Alte
Papierfabrik`) und Ghost-Kitchen-Hüllen (`EatTasty Speisekarte`).

| Belegart | `typeId` | Anzahl |
|---|---|---|
| Eingangsrechnungen und Avise | 1 | **394.552** |
| Kassenbelege | 5 | 149.748 |
| Ausgangsrechnungen | 2 | 20.755 |
| Kontoauszüge / Saldenbestätigungen | 3977 | 13.494 |
| Inventur und Bruchlisten | 3 | 7.279 |
| Susa | 3975 | 4.049 |
| BWA | 3974 | 2.895 |
| Lieferscheine | 3970 | 542 |
| **Summe über alle 131 Betriebe** | | **593.314** |

> **Diese Zahl ist eine Untergrenze, keine Gesamtzahl.** Gezählt wurden **acht der
> vierzehn** Belegarten. Nicht gezählt sind: sonstige Dokumente (16), sonstige
> Auswertungen (3968), USt-Voranmeldungen (3969), Mahnungen (3971), Steuerunterlagen
> (3972) und OPOS-Listen (3976). Der Abzug holt alle vierzehn — der tatsächliche
> Bestand liegt also über 593.314. Wer die Zahl weitergibt, sagt „mindestens" dazu.

Die Einzelwerte je Betrieb stehen in [`ladenakte-bestand.csv`](ladenakte-bestand.csv)
— 131 Zeilen, Schlüssel ist `lina_betrieb_id` (= `core.betrieb.lina_betrieb_id`).
Damit lässt sich der Abzug betriebsweise planen und hinterher gegenprüfen.

Je Konzept: Deutsche Konzepte 163.946 (16 Betriebe), Enchilada 133.607 (22),
Wilma Wunder 110.703 (14), Aposto 82.834 (11), Enchi-Gruppe geschlossene 42.413
(34), Franchisegebergesellschaften 27.609 (17), Sonstige Enchilada Gruppe 10.947
(9), Ghost Kitchen 6.435 (3), Besitos 6.429 (2), Kooperationspartner 4.662 (2),
Schlager Cafe 3.729 (1).

Die zehn größten Einzelbestände: Aposto Mainz 19.835, Wilma Wunder Dresden
18.574, Wilma Wunder Köln 17.352, Alter Kranen 15.888, Park Cafe München 15.705,
Wirtshaus Lautenschlager 14.669, Wilma Wunder Stuttgart 14.388, Wilma Wunder
Karlsruhe 13.852, CONCEPT FAMILY Franchise AG 13.473, Aposto Bamberg 13.309.

Bemerkenswert: **die 34 geschlossenen und insolventen Betriebe tragen zusammen
42.413 Belege.** Deren Historie ist vollständig erhalten — für Zeitreihen ein
Gewinn, für Betriebsvergleiche eine Falle.

Der Ordner **Lieferscheine ist praktisch leer (542 Stück konzernweit, bei
394.552 Eingangsrechnungen)** — die Hoffnung, darüber an Liefermengen zu
kommen, trägt nicht.

### 7.5 Die Struktur ist konzernweit identisch

Alle 131 Betriebe wurden nicht nur gezählt, sondern auch strukturell geprüft
(Rubrikenliste und Ordnerliste je Betrieb einzeln abgefragt):

* **Eine einzige Rubrik-Kombination** — alle 131 haben dieselben 9 Rubriken.
* **Eine einzige Ordner-Kombination** — alle 131 haben dieselben 14 `typeId`.
* Keine unbekannte Rubrik, kein unbekannter Ordnertyp, kein Fehlschlag.

Das ist die Zusage, die ein Importer braucht: **das Schema ist uniform.** Kein
Sonderfall je Marke, kein abweichender Ordner bei geschlossenen Betrieben. Wer
einen Betrieb korrekt liest, liest alle korrekt. Unterschiede gibt es nur in
der Befüllung, nie in der Struktur.

---

## 8. Was das für einen Abzug bedeutet

Zwei Vorhaben, die sauber getrennt gehören:

**(1) Metadaten-Abzug — klein, schnell, sofort auswertbar.**
Bei `length=200` sind 456.000 Belege rund **2.300 Listenaufrufe**, plus 131
Baum- und Ordneraufrufe. Bei der projektüblichen Drosselung (1,5–4 s) sind das
**etwa 2 Stunden**. Ergebnis: eine vollständige Kreditoren-, Lieferanten- und
Kostenkontentabelle mit MwSt-Aufteilung — ohne eine einzige Datei.
**Das ist der Schritt, der den analytischen Nutzen bringt.**

**(2) Dateien-Abzug — groß, langsam, ein Archivprojekt.**
500.000 PDFs. Bei 200 kB im Schnitt sind das **rund 100 GB**, bei 2 s Abstand
**gut elf Tage Laufzeit**. Das ist kein Analyse-, sondern ein
Datensicherungsvorhaben und braucht eine eigene Entscheidung über Zweck,
Speicherort, Aufbewahrungsfrist und Löschkonzept.

Beides gehört **nicht** in den bestehenden `sync`-Lauf: andere Frequenz, andere
Fehlerbehandlung, andere Rechtsgrundlage.

### Was der Importer können muss

1. **Token-Erneuerung im Lauf.** Gesalzene `storeId`-Token; bei 12.000 Belegen
   in 60 Seiten darf ein Ablauf den Betrieb nicht abbrechen.
2. **Positivliste statt Linkverfolgung.** Siehe die Löschfalle in Abschnitt 5.
3. **Betriebe klassifizieren.** Geschlossen / insolvent / Franchisegeber /
   Testladen dürfen nicht in Betriebsvergleiche laufen. Die Konzeptnamen tragen
   die Information bereits (`GESCHLOSSEN`, `INSOLVENT`, `Testladen`).
4. **Raw-Layer zuerst.** Die Listenantworten 1:1 als JSONB, wie bei allen
   anderen Quellen (Regel 4).

---

## 9. Personenbezug — bitte bewusst entscheiden

Die Sperre gegen personenbezogene Daten wurde am 11.08.2026 aufgehoben
(Commit `589e6d0`), und für die Belegmetadaten ist das unproblematisch:
`uploadedByName` und `zuordnungMaName` sind Beschäftigtennamen im
betrieblichen Kontext.

**Der Lohn-Zweig des Belegarchivs ist eine andere Größenordnung.** Dort liegen
**Ausweisdokumente (3980), Geburtsurkunden (4004), Krankmeldungen (13),
Pfändungen (3986), Aufenthalts-/Arbeitserlaubnisse (3981)** und
Lohnabrechnungen. Krankmeldungen sind Gesundheitsdaten (Art. 9 DSGVO);
Ausweisdokumente und Pfändungen sind für keine denkbare Umsatzauswertung
erforderlich.

Das ist **keine Weigerung** — es ist der Hinweis, dass „Personenbezug ist okay"
für Rechnungsmetadaten etwas anderes bedeutet als für einen Massenabzug von
Personalakten. Empfehlung: **den Lohn-Zweig (`root_lohn`, alle Arten 9–15 und
3958–4004) vom Abzug ausnehmen**, bis es dafür einen benannten Zweck und eine
Freigabe gibt. Technisch ist es eine Zeile Positivliste.

---

## 10. Offen

| Punkt | Warum es zählt |
|---|---|
| `/finanzen/stb/export` (Datenexport Steuerberater) | Könnte den Belegabzug als **Sammelexport** überflüssig machen. Nicht aufgerufen. |
| `datevformat`-Buchungsstapel | Strukturierte Buchungen statt PDFs. Format ungeprüft. |
| `lineItems` je Rechnung | Nur die Anzahl ist im Listensatz. Der Positionsabruf wurde nicht gefunden — er wäre der **Artikelwareneinsatz aus der Rechnung**. |
| BWA-Reichweite der übrigen 121 Betriebe | 10 gemessen (Abschnitt 3.1). Der Rest folgt beim Import — die Prüfung muss auf *Werte* gehen, nicht auf Struktur. |
| Offizieller API-Key | Der sanktionierte Weg an Regel 7a vorbei. Frage an LINA / Tobias Lindemann. |

---

## 11. Erhebungsumfang

Damit der nächste Agent weiß, was belegt ist und was nicht:

| geprüft | Umfang |
|---|---|
| Betriebe im Baum | **131 / 131** |
| Belegzählung über 8 Belegarten | **131 / 131**, 0 Fehler |
| Rubrikenliste je Betrieb | **131 / 131** — eine einzige Kombination |
| Ordnerliste je Betrieb | **131 / 131** — eine einzige Kombination |
| Alle 9 Rubriken inhaltlich geöffnet | 1 Betrieb (Enchilada Karlsruhe), Belegarchiv zusätzlich bei GSF Gastro |
| BWA-Longterm Reichweite | 10 Betriebe |
| Zentrales Belegarchiv (`/finanzen/document/…`) | 1 Mandant (62) |

Nicht angefasst: Formularinhalte, Foren-Beiträge, `stb/export`, `datevformat`,
und **keine einzige Belegdatei heruntergeladen**.
