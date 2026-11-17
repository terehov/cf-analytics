# Vertragsdatenbank — Franchiseverträge und -gebühren

Stand 17.11.2026. Es gibt noch keinen Code. Dieser Ordner hält die Anforderung, das Datenmodell und
die Architektur fest, bevor gebaut wird.

## Worum es geht

Finance führt die Franchiseverträge heute als Freitext in einer Excel-Spalte neben dem
Franchisenehmer: Konditionen, Reduzierungen, Stundungen, Kündigungen. Die offenen Posten stehen in
DATEV und zusätzlich in einer kommentierten Excel-Kopie. Ziel ist eine Datenbank, in der für jeden
Vertrag und jeden Monat feststeht, welche Kondition galt — als Grundlage für die Gebührenrechnung,
den Abgleich mit Rechnung und BWA und die Liquiditätsplanung.

In den Mails heißt das Vorhaben „Stammdaten-Datenbank". Gemeint ist dasselbe.

## Beteiligte

| Wer | Rolle |
|---|---|
| Andreas Heinz | Leitung Organisationsentwicklung, Auftraggeber; hat die Festlegungen vom 11.11.2026 gebündelt |
| Kristina Stokic | Finance; künftige Pflege, offene Fragen zu Freudenstadt, Außer Haus und Ablage der Verträge |
| Tobias Wirth | Marketing; hat die Muster-Tabelle mit erstellt, Festlegung zum Kampagnenbudget |
| Daniel | Vorstand; stimmt mit Andreas ab, wer je Marke lesen darf |
| Karsten Rüdiger | Vorsitzender des Aufsichtsrats; in Kopie der Mail vom 11.11.2026 |
| Eugene | Datenmodell, Umsetzung, technische Entscheidungen (in den Mails: Evgenij Terehov) |

## Die Trennung

Die Vertragsdatenbank ist eine eigene Datenbank mit eigenem MCP-Server, eigenen Rollen und eigener
Nutzerverwaltung; sie teilt nichts mit der Analytics-Datenbank und ihrem MCP (Entscheidung Eugene,
17.11.2026). Grund: Im Analytics-MCP sieht jeder Nutzer alles in `mart`, Vertragsdaten sollen je
Marke berechtigt werden, und eine Trennung über Rechte in derselben Datenbank hinge an jeder
künftigen Migration. Daten fließen nur von Analytics in die Vertragsdatenbank, nie zurück.

Finance arbeitet damit über ein Dashboard und den MCP-Zugang (Entscheidung Eugene, 17.11.2026). Dort
steht auch der Umsatz für die Abrechnung — die frühere Quelle Sell & Pick ist gekündigt.

Einzelheiten: `architektur.md`.

## Fahrplan

Reihenfolge von Andreas am 11.11.2026 freigegeben.

| Schritt | Inhalt | Stand 17.11.2026 |
|---|---|---|
| 1 | Vorlage in der neuen Struktur (Excel) | am 17.11.2026 an Finance verschickt — `Vorlage_Vertragsdaten.xlsx` in diesem Ordner |
| 2 | Finance trägt 5–10 echte Verträge ein, die schwierigen zuerst: Aalen, Bremen, Freudenstadt, Rosenheim, ein Betrieb mit Staffel | bei Finance |
| 3 | Monatliche Gegenüberstellung je Betrieb: Soll laut Vertrag / von Finance berechnet / in der BWA gebucht | wartet auf Schritt 2 |
| 4 | Eingabeoberfläche für Finance, offene Posten aus DATEV, Liquiditätsplanung | offen |
| 5 | OCR der gescannten Verträge aus SharePoint | zuletzt |

Die Vorlage wird getrennt von dieser Doku erzeugt. Ihre Blätter entsprechen den sieben Tabellen in
`datenmodell.md`.

## Welche Datei wofür

| Datei | Inhalt | Wann lesen |
|---|---|---|
| `README.md` | Einstieg, Beteiligte, Fahrplan | zuerst |
| `anforderungen.md` | Was Finance will, die Festlegungen vom 11.11.2026, Mailverlauf, heutiger Zustand | bevor du eine fachliche Regel baust |
| `datenmodell.md` | Die sieben Tabellen, die vier Beispiele aus der Muster-Tabelle, die Monatsrechnung | bevor du die Vorlage, das Schema oder die Gebührenrechnung anfasst |
| `architektur.md` | Trennung von Analytics, Datenfluss, was Analytics schon liefert, offene technische Punkte | bevor du eine Infrastruktur- oder Rechteentscheidung triffst |
| `offene-punkte.md` | Was ungeklärt ist, bei wem, Stand | bevor du etwas als geklärt weitergibst |
| `Vorlage_Vertragsdaten.xlsx` | Die Excel-Vorlage für Finance (Schritt 1) | wenn Finance Rückfragen zur Vorlage hat |

Quellen außerhalb dieses Ordners:

- `examples/emails/management board/Datenstruktur für die (neue) Stammdaten-Datenbank.eml` —
  Mail vom 29.10.2026 mit Muster-Tabelle (`ENTWURF_Datenstruktur_Stammdaten.xlsx`) und zwei
  Screenshots (Gebührenblatt Enchilada, OP-Liste).
- `examples/emails/management board/AW_ Datenstruktur für die (neue) Stammdaten-Datenbank.eml` —
  Antwort vom 11.11.2026 mit dem ganzen Verlauf und Andreas' Antworten.
- `docs/lina-api-inventar-ladenakte.md`, Abschnitt 5 — der Vertragsordner der LINA-Ladenakte.

## Regeln aus dem Analytics-Repo, die hier auch gelten

- Prozentwerte sind Prozentzahlen (`4.5`), nie Brüche (`0.045`). Die Muster-Tabelle von Finance
  speichert Brüche (`0.04`).
- Ein Befund gehört in diesen Ordner, bevor der Commit steht.
- Falsches wird durchgestrichen, nicht gelöscht.
