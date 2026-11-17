# Datenmodell — sieben Tabellen

Stand 17.11.2026. Die Struktur hat Andreas am 11.11.2026 bestätigt; die Excel-Vorlage
(`Vorlage_Vertragsdaten.xlsx`) hat je Tabelle ein Blatt.

**Grundsatz: nichts wird überschrieben.** Jede Änderung einer Kondition ist eine neue Zeile mit
Gültigkeitszeitraum. So lässt sich für jeden Monat sagen, was galt. Schlüssel aller Blätter ist die
Vertrags-Nr.

## Die Tabellen

### 1. Vertrag — eine Zeile je Vertrag

Vertrags-Nr. (laufend) · Marke · Vertragspartner (Gesellschaft) · abweichende Firmenbezeichnung ·
Franchisegeber-Gesellschaft · Vertragsbeginn · Vertragsende · Verlängerungsoption (Text) ·
Kündigungsfrist in Monaten · Kündigung zum (Jahresende / Vertragsende / Monatsende) · Status (aktiv /
gekündigt / aufgehoben / beendet / insolvent) · Einstiegsgebühr € · Bemessungsgrundlage (voller
Nettoumsatz / abweichend) · abweichende Regel (Text, nur wenn abweichend) · SEPA-Lastschrift
(ja/nein) · Mahnstatus (ja/nein) · Besonderheiten · Hinweise

Warum so: Was sich während der Laufzeit nicht ändert, steht hier; was sich ändert, steht in eigenen
Tabellen. Die Kündigungsfrist ist in Zahl und Stichtag getrennt, weil die Muster-Tabelle beides in
einem Text führt („12 Monate zum Jahresende").

### 2. Betriebe — eine Zeile je Abrechnungseinheit eines Vertrags

Vertrags-Nr. · Einheit (z. B. „Enchilada Freudenstadt" und „Kurhaus") · Ort · Eröffnung ·
Umsatzquelle (LINA-Kasse / Kassenblatt / Meldung des Betriebs) · Geschäftsführer · Bemerkung

Warum so: Ein Vertrag kann mehrere Einheiten mit verschiedenem Satz haben — Freudenstadt 5 %, das
Kurhaus 3 %. Die Zuordnung zum LINA-Betrieb trägt Eugene nach, nicht Finance.

### 3. Konditionen — eine Zeile je Gebühr und Gültigkeitszeitraum

Vertrags-Nr. · Einheit (leer = gilt für alle Einheiten) · Gebührenart (Franchisegebühr /
Marketinggebühr / Kampagnenbudget) · Berechnung (Prozent vom Umsatz / Festbetrag je Monat) · Satz
in % · Betrag in € · gültig von · gültig bis (leer = bis auf Weiteres) · Grund (Standard laut Vertrag
/ zeitweise Reduzierung / dauerhafte Reduzierung / Aussetzung / Umwandlung in Darlehen / Sonstiges)
· Nachtrag-Nr. · Bemerkung

Warum so: Das ist die Tabelle, die den Verlauf hält. Ein Nachtrag fügt eine Zeile an, statt das
Feld „reduziert" der Muster-Tabelle zu überschreiben.

### 4. Staffeln — nur bei Verträgen mit Umsatzstaffel

Vertrags-Nr. · Gebührenart · ab Jahresumsatz netto in € · Satz in % · gültig von · gültig bis

Warum so: Schwelle und Satz als Zahlen statt als Text, damit die Rechnung sie lesen kann.

### 5. Stundungen und Darlehen

Vertrags-Nr. · Art (Stundung / Ratenzahlung / Darlehen) · Vereinbarung vom · Betrag € · betrifft
(Zeitraum oder Rechnungsnummern) · Zinssatz % · Anzahl Raten · Rate € · erste Rate fällig am ·
Rhythmus (monatlich / vierteljährlich / einmalig) · Status (läuft / erledigt / in Verzug) ·
Bemerkung

Warum so: Die Liquiditätsplanung braucht Fälligkeiten. Die offenen Posten selbst stehen hier nicht,
sie kommen aus DATEV (Schritt 4).

### 6. Ereignisse — Chronik je Vertrag

Vertrags-Nr. · Datum · Art (Vertragsabschluss / Nachtrag / Verlängerung / Kündigung / Aufhebung /
Inhaberwechsel / Insolvenz / Sonstiges) · Nachtrag-Nr. · wirksam ab · Beschreibung · Dokument
(Dateiname oder Link)

Warum so: Jede Konditionszeile mit Nachtrag-Nr. lässt sich auf ein Ereignis und ein Dokument
zurückführen. Die Spalte Dokument ist auch der Anknüpfungspunkt für die OCR in Schritt 5.

### 7. Vertragsgebiet — eine Zeile je Postleitzahl

Vertrags-Nr. · PLZ · Ort · exklusiv (ja/nein) · Bemerkung

Warum so: Festlegung vom 11.11.2026 — Gebiete als PLZ-Liste, damit sie sich mit Kaufkraftdaten
verknüpfen lassen. Ein Radius wird bei der Erfassung in PLZ umgewandelt.

## Die vier Beispiele aus der Muster-Tabelle (29.10.2026), umgesetzt

Die Muster-Tabelle nennt die Verträge „ENCHILADA Betrieb 1" bis „4". Es sind Beispiele, nicht die
Konditionen der genannten Orte: Das Gebührenblatt im selben Mailverlauf zeigt für Januar 2026
Augsburg mit 4,5 % und Bremen mit 4,0 %. Alle vier: Marke Enchilada, Einstiegsgebühr 0, Mahnstatus
nein. Das Muster nennt für die Standardkonditionen keinen Zeitraum; sie beginnen hier mit dem
Vertragsbeginn. **Zeiträume derselben Gebührenart überschneiden sich nie** (Festlegung Eugene,
17.11.2026): eine befristete Reduzierung teilt die Standardzeile in ein Davor und ein Danach. So
steht es auch in der Vorlage.

**Vertrag 1 — Augsburg.** Vertragspartner „ENCHILADA Betrieb 1", abweichende Firmenbezeichnung
Feel Good Mexican Food GmbH. Franchisegeber CONCEPT FAMILY Franchise AG, Teilbetrieb Enchilada.
01.01.2022–31.12.2031, 12 Monate zum Jahresende, aktiv. Gebiet: 86152 Augsburg.

| Gebührenart | Berechnung | Wert | gültig von | gültig bis | Grund |
|---|---|---|---|---|---|
| Franchisegebühr | Prozent | 4 % | 01.01.2022 | | Standard |
| Marketinggebühr | Prozent | 1,5 % | 01.01.2022 | | Standard |
| Kampagnenbudget | Festbetrag | 500 € | 01.01.2022 | | Standard |

**Vertrag 2 — Mainz.** Franchisegeber ENCHILADA Management GmbH. 01.08.2018–31.07.2028, 12 Monate
zum Jahresende, aktiv. Hinweis: „sollte ab 08/2026 wieder bezahlen – noch kein Zahlungseingang".

| Gebührenart | Berechnung | Wert | gültig von | gültig bis | Grund |
|---|---|---|---|---|---|
| Franchisegebühr | Prozent | 5 % | 01.08.2018 | 31.03.2026 | Standard |
| Franchisegebühr | Prozent | 2,5 % | 01.04.2026 | 31.12.2026 | zeitweise Reduzierung |
| Franchisegebühr | Prozent | 5 % | 01.01.2027 | | Standard |
| Marketinggebühr | Prozent | 1,5 % | 01.08.2018 | 31.03.2026 | Standard |
| Marketinggebühr | Prozent | 0,5 % | 01.04.2026 | 31.12.2026 | zeitweise Reduzierung |
| Marketinggebühr | Prozent | 1,5 % | 01.01.2027 | | Standard |
| Kampagnenbudget | Festbetrag | 500 € | 01.08.2018 | 31.03.2026 | Standard |
| Kampagnenbudget | Festbetrag | 0 € | 01.04.2026 | 31.12.2026 | zeitweise Reduzierung, Bemerkung „bitte prüfen" |
| Kampagnenbudget | Festbetrag | 500 € | 01.01.2027 | | Standard |

Das Muster sagt beim Kampagnenbudget „0,5"; nach „ganz oder gar nicht" als 0 € eingetragen.
Stundungen: „Ratenstundung für KJ 2025", betrifft Kalenderjahr 2025 — Art (Stundung oder
Ratenzahlung), Betrag, Raten und Zins stehen nicht im Muster. Offene Posten 17.900 € (aus DATEV).

**Vertrag 3 — Bremen.** Franchisegeber CONCEPT FAMILY Franchise AG, Teilbetrieb Enchilada.
01.11.2018–31.10.2028, 6 Monate zum Jahresende, aktiv. Konditionen: Franchisegebühr 5 %,
Marketinggebühr 1 %, Kampagnenbudget 500 €, alle Standard ab 01.11.2018.

| Staffeln: Gebührenart | ab Jahresumsatz netto | Satz | gültig von |
|---|---|---|---|
| Franchisegebühr | 2.500.000 € | 4,5 % | 01.11.2018 |
| Franchisegebühr | 5.000.000 € | 3,5 % | 01.11.2018 |

**Vertrag 4 — Köln.** Franchisegeber CONCEPT FAMILY Franchise AG, Teilbetrieb Enchilada.
01.01.2017–31.12.2026, 6 Monate zum Jahresende, Status gekündigt.

| Gebührenart | Berechnung | Wert | gültig von | gültig bis | Grund |
|---|---|---|---|---|---|
| Franchisegebühr | Prozent | 4 % | 01.01.2017 | 31.12.2025 | Standard |
| Franchisegebühr | Prozent | 0 % | 01.01.2026 | 31.12.2026 | Umwandlung in Darlehen |
| Marketinggebühr | Prozent | 1,75 % | 01.01.2017 | | Standard |
| Kampagnenbudget | Festbetrag | 500 € | 01.01.2017 | | Standard |

Stundungen und Darlehen: eine Zeile Art Darlehen; Betrag, Zins und Tilgung sind offen. Ereignis
Kündigung: Datum steht nicht im Muster. Offene Posten 20.000 € (aus DATEV).

## Wie daraus die Monatsrechnung wird (Schritt 3)

Je Vertrag, Einheit, Gebührenart und Monat:

1. **Kondition des Monats suchen.** Die Zeile in Konditionen, deren Zeitraum den Monat enthält.
   Zeiträume derselben Gebührenart und Einheit überschneiden sich nicht (oben); zwei Treffer sind
   ein Erfassungsfehler und werden gemeldet, nicht aufgelöst. Eine Zeile für eine Einheit geht der
   Zeile für alle Einheiten vor. In den vier Beispielen liegen alle Wechsel auf Monatsgrenzen; was
   bei einem Wechsel im Monat gilt, ist **nicht festgelegt**.
2. **Prozent vom Umsatz.** Nettoumsatz der Einheit im Monat × Satz. Quelle ist die Umsatzquelle der
   Einheit, bei LINA-Kasse und Kassenblatt der Wert aus Analytics. Bei Bemessungsgrundlage
   „abweichend" steht die Regel als Text da; der Monat wird ausgewiesen, nicht automatisch
   gerechnet.
3. **Staffel je Kalenderjahr.** Gibt es Staffelzeilen, wird der Jahresumsatz netto ab 1. Januar
   aufsummiert. Nach Erreichen einer Schwelle gilt deren Satz für den gesamten Umsatz (Festlegung
   11.11.2026). **Offen ist, ab wann:** für den ganzen Monat des Überschreitens, erst ab dem
   Folgemonat oder rückwirkend fürs ganze Jahr mit Gutschrift. Bis Andreas das klärt, wird keine
   Variante gebaut.
4. **Festbetrag.** Betrag der Kondition, ganz oder gar nicht; 0 € bei Aussetzung oder Reduzierung
   auf null.
5. **Gegenüberstellung.** Soll laut Vertrag neben dem von Finance berechneten Betrag und der
   BWA-Zeile „Franchisegebühr" des Betriebs (`architektur.md`, Abschnitt 4).

Die Prozentwerte stehen in der Datenbank als Prozentzahl (`4.5`), nie als Bruch.
