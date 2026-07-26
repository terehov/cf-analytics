# Entwurf: Datenbereitstellung nach EU Data Act

> **Vor dem Versand:** Das ist ein Entwurf, kein juristisches Schreiben. Lass die
> Verordnungsverweise und die Fristsetzung von einem IT-Rechtsanwalt gegenlesen —
> insbesondere, ob euer Vertragsverhältnis unter Kapitel II (Zugang zu Daten aus
> vernetzten Produkten und verbundenen Diensten) oder unter Kapitel VI (Wechsel
> zwischen Datenverarbeitungsdiensten) fällt oder unter beides. Der Anspruch besteht
> in der Sache nach beiden Wegen, aber die richtige Anspruchsgrundlage macht den
> Unterschied, wenn LINA ablehnt.
>
> Das Schreiben geht von der **Concept Family AG als Vertragspartnerin** aus,
> unterzeichnet von dir in deiner Funktion — nicht als persönliche Anfrage.

---

**Betreff:** Bereitstellung unserer Betriebsdaten — Anfrage nach Verordnung (EU) 2023/2854 (Data Act)

Sehr geehrte Damen und Herren,

wir nutzen LINA TeamCloud als Kassen- und Verwaltungssystem für derzeit rund 110 Standorte der Concept Family AG. Für unsere interne Steuerung — insbesondere die monatliche Betriebsauswertung über alle Konzepte hinweg — benötigen wir einen strukturierten Zugang zu den Daten, die durch unsere Nutzung des Systems entstehen.

Die in der Verwaltungsoberfläche verfügbaren Auswertungen reichen dafür nicht aus. Kennzahlen werden bei uns derzeit manuell übertragen, was fehleranfällig und nicht skalierbar ist. Wir möchten diese Auswertungen künftig in einer eigenen Umgebung aufbauen.

Wir bitten Sie daher um Bereitstellung der uns betreffenden Daten. Nach der seit dem 12. September 2025 anwendbaren Verordnung (EU) 2023/2854 (Data Act) sind Nutzerinnen und Nutzern die durch ihre Nutzung entstehenden Daten in einem umfassenden, strukturierten, gängigen und maschinenlesbaren Format bereitzustellen — und zwar unentgeltlich, ohne ungebührliche Verzögerung und, soweit technisch möglich, fortlaufend.

## Um welche Daten es geht

Wir bitten um einen vollständigen Export für **alle unsere Betriebe** und den **gesamten verfügbaren Zeitraum**:

**Umsatz und Verkauf**
- Tagesumsätze je Betrieb, Hauptsparte, Feinsparte und Verkaufsstelle (netto und brutto), Rechnungs- und Gästezahlen
- Umsätze je Stunde und je Zeitzone
- Artikelverkäufe je Betrieb und Tag: Menge, Umsatz, Verkaufspreis
- Aktions- und Rabattbuchungen, Gutscheinverkauf und -einlösung, Stornobuchungen

**Artikel- und Sortimentsstamm**
- Artikelstamm mit Warengruppenzuordnung (Großkategorie, MEC, Detailkategorie)
- Hinterlegte Wareneinsätze je Artikel, **einschließlich der historischen Stände**
- Rezepturen: Artikel, Zutaten, Mengen, Einheiten

**Warenwirtschaft**
- Warenstamm mit Einheiten und Umrechnungsfaktoren
- Lieferantenstamm
- Einkaufspreise je Ware und Lieferant, **einschließlich Preishistorie**
- Bestellungen und Bestellpositionen
- Inventuren und Inventurergebnisse

**Personal**
- Gearbeitete Stunden je Betrieb und Zeitraum
- Personalkosten und Effektivitäten je Bereich
- Dienstplan-Soll-Stunden

**Betriebswirtschaft und Stammdaten**
- BWA-Daten je Betrieb und Monat, mit dem jeweiligen Buchungs- bzw. Importstand
- Betriebsstammdaten: Adresse, Öffnungszeiten, Sitzplätze, Zuordnung zu Konzepten

Sollten einzelne Positionen aus Ihrer Sicht nicht unter die Bereitstellungspflicht fallen, bitten wir um eine kurze Begründung je Position, damit wir das prüfen können.

## Format und Bereitstellungsweg

Bevorzugt: **fortlaufender Zugang über eine dokumentierte Schnittstelle** (API) mit Authentifizierung über einen technischen Zugang, damit wir die Daten regelmäßig und automatisiert abrufen können.

Alternativ: **vollständiger Erstexport** (CSV, JSON oder Datenbankauszug) zuzüglich regelmäßiger Deltalieferungen.

Bitte teilen Sie uns mit:

1. In welchem Format und über welchen Weg Sie die Daten bereitstellen können
2. Welchen Zeitraum die Historie umfasst
3. Bis wann die Bereitstellung erfolgen kann
4. Ob eine dokumentierte Schnittstelle existiert und wie ein technischer Zugang eingerichtet wird
5. Falls Sie Entgelte geltend machen: deren Grundlage und Höhe

## Zwei Punkte, die sich kurzfristig klären lassen

Unabhängig vom Gesamtexport bitten wir um Prüfung zweier Punkte, die vermutlich mit einer Rechteanpassung erledigt sind:

**Erstens** sind die Berichte **„Gearbeitete Stunden" (107)** und **„Wareneinsatz und Deckungsbeitrag" (118)** — ebenso wie 7, 8, 9, 23 und 24 — für unseren Zugang nicht abrufbar; sie liefern durchgängig einen Serverfehler, während andere Berichte für dieselben Betriebe und Zeiträume einwandfrei funktionieren. Bitte prüfen Sie, ob diese Berichte für unseren Vertrag freigeschaltet werden können.

**Zweitens** sind die Warenwirtschaftsdaten — Einkaufspreise, Lieferanten, Bestellungen — offenbar an den jeweils gewählten Betriebskontext gebunden. Bitte teilen Sie uns mit, wie sich dieser Kontext wechseln lässt, damit wir die Daten aller Betriebe erfassen können.

## Rückmeldung

Wir bitten um eine erste Rückmeldung **bis zum [Datum, ca. 14 Tage]**, gerne auch mit einem Terminvorschlag für ein Gespräch. Uns geht es ausdrücklich um eine praktikable, gemeinsame Lösung.

Ergänzend weisen wir auf einen sicherheitsrelevanten Befund hin, der uns bei der Arbeit mit der Oberfläche aufgefallen ist und den wir Ihnen gesondert und vertraulich zukommen lassen möchten. Bitte nennen Sie uns einen Ansprechpartner.

Mit freundlichen Grüßen

Evgenij Terehov
Chief Technology Officer
Concept Family AG

---

## Hinweise zum Entwurf

**Der Ton ist bewusst kooperativ.** Ihr seid operativ auf LINA angewiesen; ein Anwaltsschreiben als Erstkontakt verschlechtert eure Lage, ohne etwas zu gewinnen. Die Verordnung ist genannt — das reicht als Signal.

**Der Sicherheitsbefund ist bewusst nur angedeutet.** `getStoreData` liefert Datenbankzugangsdaten im Klartext aus. Das gehört gemeldet, aber nicht in dieselbe Mail wie eine Forderung — sonst liest es sich als Druckmittel. Separater Kanal, separates Schreiben.

**Die Punkte 107/118 und der Betriebskontext sind Absicht.** Sie geben LINA eine billige Möglichkeit, einen Teil der Anfrage sofort zu erfüllen. Wer eine Forderung nur ablehnen oder ganz erfüllen kann, lehnt ab; wer einen Teil billig erfüllen kann, tut es meistens — und ist danach im Gespräch.

**Was ihr durch das Schreiben gewinnt, selbst bei einer Ablehnung:** eine dokumentierte Ablehnung eines Data-Act-Anspruchs. Das verändert eure Position grundlegend, falls die Frage automatisierter Abrufe je aufkommt. Ihr habt dann gefragt, und zwar zuerst.

**Was noch fehlt:** Prüfung von Vertrag und AGB. Möglicherweise schuldet LINA einen Datenexport schon vertraglich — dann ist das der einfachere Weg, und die Verordnung ist nur das Argument im Hintergrund.
