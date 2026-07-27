# Yext-Anbindung — Anforderung an den API-Zugang

Dieses Dokument beschreibt, welchen Zugriff wir auf die Yext-API benötigen, wofür die Daten
verwendet werden und was wir bewusst **nicht** anfragen. Es ist so geschrieben, dass es
unverändert an den Yext-Support weitergegeben werden kann.

Stand: 27.07.2026

---

## 1. Kontext

**Wichtig zur Ausgangslage:** Yext ist nicht von Concept Family lizenziert, sondern von der
Schwestergesellschaft **Family & Friends Marketing**, die im selben Konto auch andere,
externe Kunden betreut. Der Zugang muss deshalb **technisch auf die Concept-Family-Standorte
begrenzt** sein — ein Filter, den unser Importer selbst setzt, genügt dafür nicht. Das ist
die wichtigste Anforderung dieses Dokuments; siehe Frage 1 in Abschnitt 8.

Concept Family betreibt **141 aktive Betriebe** in 11 Marken (Enchilada, Wilma Wunder,
Aposto, Besitos, Ghost Kitchen, Deutsche Konzepte u. a.).

Wir bauen derzeit ein internes Berichtswesen auf: die Kassen- und Buchhaltungsdaten aus
unserem Warenwirtschaftssystem laufen in eine PostgreSQL-Datenbank, ausgewertet wird mit
Metabase. Das Ganze ersetzt eine Excel-Tabelle, die bisher monatlich von Hand gepflegt wurde.

**Die Online-Bewertung ist eine von sechs Kennzahlen in diesem Bericht.** Sie ist die
einzige, die nicht aus unseren eigenen Systemen kommt — heute wird sie manuell abgetippt,
und genau das soll die Anbindung ablösen.

---

## 2. Welchen Zugang wir brauchen

### 2.1 Developer Console

Zunächst organisatorisch: In unserem Konto ist die **Developer Console nicht sichtbar**.
Wir bitten um Auskunft, welche Benutzerrolle bzw. Berechtigung dafür nötig ist und wer in
unserem Konto sie vergeben kann.

### 2.2 App und Berechtigungen

Wir benötigen eine App in der Developer Console mit **ausschließlich lesenden**
Berechtigungen auf zwei Endpunktgruppen:

| Endpunkt | Zugriff | Wozu |
|---|---|---|
| `GET /v2/accounts/{accountId}/reviews` | **Read-only** | Die Bewertungen selbst |
| `GET /v2/accounts/{accountId}/entities` | **Read-only** | Einmalige Zuordnung Entity ↔ Betrieb |

**Ausdrücklich nicht benötigt** — bitte diese Rechte nicht vergeben:

- Schreibrechte jeder Art (`POST`, `PUT`, `DELETE`)
- Antworten auf Bewertungen erstellen oder verwalten
- Listings, Öffnungszeiten, Stammdaten ändern
- Analytics-API
- Account Settings, Benutzer- und Rollenverwaltung

Wenn Ihre Rechtestruktur eine feinere Aufteilung erlaubt, nehmen wir gerne die engste
Variante, die die beiden obigen Aufrufe abdeckt.

### 2.3 Authentifizierung

API-Key oder OAuth (Client Credentials) — beides ist für uns umsetzbar. Wir bevorzugen
**OAuth**, weil sich Zugangsdaten damit rotieren lassen, ohne dass etwas neu ausgerollt
werden muss.

Der Schlüssel wird ausschließlich serverseitig gehalten (Umgebungsvariable, nicht im
Repository, nicht im Browser).

---

## 3. Welche Felder wir verarbeiten

Aus der Reviews-Antwort brauchen wir für den regulären Betrieb **fünf Felder**:

| Feld | Wozu |
|---|---|
| `entityId` | Zuordnung zum Betrieb |
| `rating` | Der Wert, der in die Kennzahl eingeht |
| `publisherId` | Trennung nach Quelle (Google, Facebook, …) — siehe Frage 5 unten |
| `publisherDate` | Zuordnung zum Berichtsmonat |
| `status` | Nur `LIVE` fließt ein; `QUARANTINED` / `REMOVED` werden verworfen |

Aus der Entities-Antwort brauchen wir **einmalig** `entityId`, Name und Adresse, um die
Zuordnung zu unseren 141 Betrieben herzustellen (siehe Abschnitt 6).

### Was wir bewusst nicht verarbeiten

`authorName`, `authorEmail` und der Bewertungstext (`content`, `comments`) werden **nicht
gespeichert**. Für eine Monatskennzahl sind sie nicht nötig, und personenbezogene Daten
ohne Zweck zu speichern wollen wir vermeiden.

Sollte später eine Textauswertung gewünscht sein, käme das als eigener Antrag mit eigener
datenschutzrechtlicher Prüfung — nicht durch die Hintertür dieses Zugangs.

---

## 4. Zielstruktur bei uns

Die Daten landen in einer einzigen Tabelle, **aggregiert je Betrieb und Monat**:

```sql
manual.online_bewertung (
    betrieb_key  integer,        -- unser Betrieb
    monat        date,           -- Monatserster
    bewertung    numeric(3,2),   -- Durchschnitt, Skala 1–5
    anzahl       integer,        -- Anzahl Bewertungen im Monat
    quelle       text,           -- 'yext'
    PRIMARY KEY (betrieb_key, monat, quelle)
)
```

Wir speichern also **keine Einzelbewertungen** in der Auswertungsschicht — nur Mittelwert
und Anzahl je Monat. Die Rohantworten der API werden für Nachvollziehbarkeit revisionssicher
abgelegt, aber nicht ausgewertet.

---

## 5. Abrufvolumen und Rhythmus

| | |
|---|---|
| Entities | 141 |
| Erstbefüllung | rückwirkend 24 Monate, einmalig |
| Laufender Betrieb | **einmal täglich**, inkrementell über `minPublisherDate` |
| Seitengröße | `limit=100`, Blättern über `pageToken` |

Bei einer Erstbefüllung erwarten wir je nach Bestand in der Größenordnung **einiger hundert
bis wenige tausend Aufrufe, einmalig und verteilt**. Im laufenden Betrieb sind es wenige
Aufrufe pro Tag.

Das liegt deutlich unter dem dokumentierten Limit der Management API von 5.000 Aufrufen pro
Stunde. Unser Importer respektiert das aktiv: fester Mindestabstand zwischen Aufrufen und
exponentielles Zurückweichen bei `429`. Falls Sie für die Erstbefüllung ein anderes Fenster
oder eine andere Vorgehensweise bevorzugen, richten wir uns danach.

---

## 6. Zuordnung Entity ↔ Betrieb

Unsere Betriebsnamen und die Yext-Entity-Namen stimmen erfahrungsgemäß nicht zuverlässig
überein (Schreibweisen, Zusätze, mehrere Standorte einer Stadt). Wir pflegen die Zuordnung
deshalb **einmalig und explizit** in einer eigenen Tabelle, statt sie zu raten.

**Bitte:** Falls es einen einfachen Weg gibt, die Entity-Liste unseres Kontos als CSV zu
exportieren (`entityId`, Name, Straße, PLZ, Ort), wäre uns das sehr geholfen — dann ist die
Zuordnung eine Stunde Arbeit statt eines Nachmittags.

---

## 7. Wofür die Zahlen verwendet werden

Drei konkrete Auswertungen, alle intern, keine öffentliche Anzeige, keine Weitergabe an
Dritte.

### Round Table (Monatsbericht)

Das zentrale Steuerungsinstrument. Eine Zeile je Betrieb und Monat mit sechs Kennzahlen,
jede mit einer Ampel hinterlegt:

| Kennzahl | Herkunft | Grün | Orange |
|---|---|---|---|
| Umsatzentwicklung ggü. Vorjahr | eigene Kasse | ≥ +10 % | ≥ 0 % |
| Personalkosten ohne GF | eigene BWA | ≤ 28 % | ≤ 32 % |
| Wareneinsatz Bar | eigene BWA | ≤ 23 % | ≤ 26 % |
| Wareneinsatz Küche | eigene BWA | ≤ 25 % | ≤ 30 % |
| **Online-Bewertung** | **Yext** | **≥ 4,40** | **≥ 4,00** |
| Vor-Ort-Einschätzung | Operations Manager | ≥ 4,0 | ≥ 3,0 |

Ein Rot färbt die Gesamtampel des Betriebs rot. Zwei Rot lösen die Eskalationsstufe
„sofort eskalieren" aus. Die Online-Bewertung ist damit **eine von zwei Kennzahlen, die
die Gästesicht abbilden** — ohne sie misst der Bericht nur die Innensicht.

### Drill-Down Marken → Filialen → Betrieb

Eine Klickkette über drei Ebenen. Auf jeder Ebene wird die Bewertung mitgeführt: als
Markendurchschnitt, als Vergleich der Betriebe einer Marke, und im Betriebsblatt als
Verlauf über die Monate.

### Standort- und Zeitraumvergleich

Mehrere Betriebe bzw. zwei Zeiträume nebeneinander. Hier dient die Bewertung als Kontext
zu den Umsatzzahlen — die Frage dahinter ist regelmäßig, ob ein Umsatzrückgang mit einem
Qualitätsproblem einhergeht oder nicht.

---

## 8. Fragen an Sie

1. **Welche Benutzerrolle** benötigen wir für den Zugang zur Developer Console, und wer in
   unserem Konto kann sie vergeben?

2. **Ist unser Konto ein eigenständiges Konto oder ein Unterkonto** unter einer Agentur?
   Falls Letzteres: müssen API-Zugang und Schlüssel vom übergeordneten Konto kommen?
   Wie lautet unsere `accountId`?

3. **Ist der Reviews-Zugriff in unserem Vertrag enthalten**, oder ist dafür ein zusätzliches
   Produkt bzw. eine Erweiterung nötig?

4. **Gibt es einen aggregierten Endpunkt** (Durchschnittsbewertung und Anzahl je Entity und
   Zeitraum)? Wir brauchen keine Einzelbewertungen — wenn Yext die Aggregation liefert,
   sparen wir beiden Seiten den Großteil der Aufrufe und speichern noch weniger Daten.

5. **Wie verhalten sich die Skalen der verschiedenen Publisher?** Google liefert 1–5.
   Facebook arbeitete zeitweise binär („empfohlen / nicht empfohlen") und Ihre API kennt
   dafür ein eigenes Feld `recommendation`. Ein naiver Mittelwert über alle Publisher wäre
   damit falsch. Gibt es eine dokumentierte Normalisierung, oder empfehlen Sie, die
   Kennzahl auf `publisherId = GOOGLE` zu beschränken?

6. **Gibt es eine Sandbox**, in der wir die Anbindung testen können, ohne das
   Produktivkonto zu berühren?

---

## 9. Zusammenfassung in einem Satz

Wir bitten um einen **lesenden API-Zugang zu Reviews und Entities** für 141 Standorte, um
die monatliche Durchschnittsbewertung automatisiert in unser internes Berichtswesen zu
übernehmen — dort ersetzt sie eine bislang von Hand gepflegte Zahl.
