# Anforderungen

Stand 17.11.2026. Quelle sind die beiden Mails in `examples/emails/management board/` und die
Entscheidungen von Eugene vom 17.11.2026.

## 1. Was Finance will

Aus der Mail vom 29.10.2026 (Andreas Heinz, nach Abstimmung mit Tobias Wirth):

- Finance pflegt die Daten selbst: Anpassung der Franchisegebühren, Stundungen, Überführung in ein
  Darlehen, neue Franchisepartner, Kündigungen von Bestandsverträgen, fortlaufende Nachträge.
- Liquiditätsberechnung aus Vertragslaufzeiten und hinterlegten Sonderfaktoren.
- Die offenen Posten einlesen und mit den Bankumsätzen fortschreiben (als Frage gestellt).
- In einer späteren Ausbaustufe OCR der gescannten Verträge auf einem festgelegten SharePoint.

Der Anlass laut Andreas: Der heutige Freitext lässt sich „aufgrund von Abkürzungen und fehlendem
Kontext" schlecht durch eine KI einlesen.

## 2. Festlegungen vom 11.11.2026

Antworten von Andreas auf die zehn Fragen aus der Mail vom 04.11.2026, abgestimmt mit Tobias Wirth.
Drei Punkte hat er an Kristina Stokic weitergegeben; sie stehen in `offene-punkte.md`.

| Thema | Festlegung | Wortlaut der Antwort, wo er etwas einschränkt |
|---|---|---|
| Bemessungsgrundlage | in 90–95 % der Verträge der volle Nettoumsatz; sonst individuelle Regel je Vertrag | „unterschiedlich je Vertrag → i. d. R. nicht" |
| Umsatzstaffel | je Kalenderjahr; der niedrigere Satz gilt ab Erreichen der Schwelle für den gesamten Umsatz | ab welchem Monat, ist offen (`offene-punkte.md`) |
| Kampagnenbudget | fester Monatsbetrag (Standard 500 €), ganz oder gar nicht, keine anteiligen Werte | „nach Klärung mit Tobi" |
| „DL" | Darlehen; offene Forderungen werden in ein Darlehen überführt | |
| Offene Posten | DATEV ist führend, die Excel-Liste ist die interne Kopie mit Vermerken. Export aus DATEV wird geprüft, Lesezugang klärt Andreas mit dem Steuerberater | „warte auf Rückruf" |
| Bankumsätze | Export oder Schnittstelle, in Klärung. Kein eigener Bankabgleich, wenn DATEV den Ausgleich schon führt | |
| Pflege | ausschließlich Finance, Erfassung im Vier-Augen-Prinzip | „Datenerfassung im 4-Augen-Prinzip sehr sinnvoll" |
| Lesen | Vorstand, Aufsichtsrat, Finance; Geschäftsführer der Management-GmbHs nur für ihre Marken | „ggf. Geschäftsführer …", „Details müssen wir dann noch mit Daniel abstimmen" |
| Umfang | Aposto, Enchilada, Wilma Wunder, Schlager Café und die Einzelkonzepte, „ca. 70 Betriebe" | „im ersten Step" |
| Vertragsgebiet | Liste von Postleitzahlen; ein Radius oder Landkreis wird bei der Erfassung in PLZ umgewandelt | Ziel: Verknüpfung mit Kaufkraftdaten |
| Mahnstatus | ja/nein reicht | Forderungsmanagement in DATEV ist noch nicht aktiviert |

Ebenfalls am 11.11.2026 bestätigt:

- Die neue Struktur (Vertrag, Konditionen mit Gültigkeitszeitraum, Staffeln, Stundungen,
  Ereignisse, Zuordnung Vertrag ↔ Betrieb): „Dein Vorschlag ist für uns OK".
- Vermerke zu offenen Posten (Stundung, Rücklastschrift, nicht einziehen) werden als eigene Felder
  gepflegt, der Stand der offenen Posten kommt aus DATEV.
- OCR am Ende, wenn klar ist, welche Felder befüllt werden.
- Die Reihenfolge der fünf Schritte (`README.md`).

## 3. Mailverlauf

| Datum | Von → an | Inhalt |
|---|---|---|
| 29.10.2026 | Andreas → Eugene, Kopie Tobias | Muster-Tabelle `ENTWURF_Datenstruktur_Stammdaten.xlsx` mit vier Enchilada-Beispielen, Screenshots von Gebührenblatt und OP-Liste, Wunschliste (Abschnitt 1) |
| 04.11.2026 | Eugene → Andreas, Kopie Tobias | Umsatzprobe Januar 2026 gegen das Gebührenblatt (sechs Betriebe und Kurhaus auf den Cent, Bremen und Freudenstadt weichen ab), Vorschlag der neuen Struktur, Weg über den DATEV-Export statt der OP-Liste, zehn Fragen, Vorgehen in vier Schritten |
| 05.11.2026 | Andreas → Eugene, Tobias | Eingangsbestätigung, gebündelte Antwort nach Abstimmung mit Tobias und Kristina angekündigt |
| 11.11.2026 | Andreas → Eugene, Tobias, Kristina; Kopie Karsten Rüdiger | Antworten zu allen zehn Fragen (Abschnitt 2), drei Punkte an Kristina weitergegeben, Vorgehen freigegeben |
| 17.11.2026 | Eugene → Andreas, Tobias, Kristina; Kopie Karsten Rüdiger | Vorlage `Vorlage_Vertragsdaten.xlsx` verschickt; drei Rückfragen (Staffel im Monat des Überschreitens, Darlehen, Liste der Betriebe); Hinweis auf die eigene Datenbank. Gesendeter Text: `examples/emails/management board/2026-11-17 Antwort an Andreas (gesendet).txt` |

Dateien:

- `examples/emails/management board/Datenstruktur für die (neue) Stammdaten-Datenbank.eml` —
  29.10.2026, mit Anhängen.
- `examples/emails/management board/AW_ Datenstruktur für die (neue) Stammdaten-Datenbank.eml` —
  11.11.2026, enthält die Mails vom 29.10., 04.11. und 05.11. als Zitat. Andreas' Antworten stehen
  dort hinter `-->` (im Original blau).

Beide Dateien sind MIME mit base64. Lesbar mit Pythons `email`-Modul (`policy.default`, Teil
`text/plain`).

## 4. Der heutige Zustand

Aus den Screenshots der Mail vom 29.10.2026 und der Muster-Tabelle.

**Gebührenblatt je Marke (Excel).** Eine Zeile je Betrieb mit Eröffnung, SEPA ja/nein, Laufzeit,
Geschäftsführer, Franchisenehmer. Je Monat ein Spaltenblock: FG in %, Umsatz netto, FG in € netto
(Erlöskonto 840020), Marketinggebühr 1 % vom Umsatz (840028), Kampagnenbudget 500 € (840038),
Datum der Rechnung oder Gutschrift.

**Freitextspalte.** Alles, was vom Standard abweicht, steht farbig hinter dem Betriebsnamen, zum
Beispiel bei Aalen „Aufhebungsvertrag zum 31.07.2026, danach neuer FV über Management-Firma", bei
Bayreuth „Dauerhafte Reduzierung FG ab 11/2022 auf 4 % lt. Nachtrag-Nr. 4". Wann eine Kondition
galt, lässt sich nur aus dem Text lesen.

**OP-Liste (Excel-Kopie neben DATEV).** Je Betrieb eine Summenzeile, darunter je Rechnung eine Zeile
mit Rechnungsnummer, Datum, Text, Betrag. Der Status steht als Freitext daneben („RLS vom
10.09.2026, keine Kontodeckung…", „bitte nicht einziehen", „per Überweisung, da aktuell
zahlungsunfähig"). Beim Einlesen müssen die Summenzeilen erkannt und übersprungen werden.

**Kaputte Datumszelle.** Bei Enchilada Rosenheim steht in der Datumsspalte einer Rechnung
„0,822060185" — ein Bruchteil eines Tages, also eine Uhrzeit, kein Datum. Das war einer der Gründe,
statt der Liste den OP-Export aus DATEV vorzuschlagen.

**Muster-Tabelle.** Eine Zeile je Vertrag, je Gebühr nur ein Feldsatz „reduziert / von / bis /
Grund", die Staffel als Text („ab 2,5 Mio. Jahresumsatz 4,50 %"), Prozentwerte als Brüche
(`0.04`). Beim zweiten Nachtrag wird ein Wert überschrieben, und der Verlauf ist weg. Deshalb die
Aufteilung in `datenmodell.md`.
