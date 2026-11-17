# Architektur — getrennt von Analytics

Stand 17.11.2026. Abschnitte 1–3 sind entschieden (Eugene, 17.11.2026). Abschnitt 5 nennt
Optionen und Empfehlungen, **keine Entscheidungen**.

## 1. Die Entscheidung

- **Eine eigene Datenbank.** Kein Schema in der Analytics-Datenbank.
- **Ein eigener MCP-Server, eigene Rollen, eigene Nutzerverwaltung.** Nichts davon teilt sich etwas
  mit dem Analytics-MCP (`mcp/`, Rollen `mcp_leser` und `mcp_anmeldung`, Tabelle `mcp.nutzer`).
- **Daten fließen nur in eine Richtung:** Die Vertragsdatenbank liest aus Analytics. Analytics liest
  nie aus der Vertragsdatenbank.
- Dieses Repo trägt vorerst nur die Doku. Wo der Code liegt, ist offen (Abschnitt 5).

## 2. Warum

**Im Analytics-MCP sieht jeder Nutzer alles in `mart`.** Das ist dort Absicht: `mcp_leser` darf
`mart`, `manual` und `ampel` lesen, ohne Unterschied nach Person (`docs/plan-skybridge.md`,
Abschnitt 6.1). Vertragsdaten, Stundungen und offene Posten sind vertraulich und sollen je Marke
berechtigt werden — Geschäftsführer der Management-GmbHs nur für ihre Marken
(`anforderungen.md`, Abschnitt 2).

**Eine Trennung über Rechte in derselben Datenbank hinge an jeder künftigen Migration.** Analytics
hat zweimal erlebt, wie ein Recht, das entzogen war, zurückkam:

- `0102` vergab `SELECT` auf das ganze Schema `mcp`, `0104` entzog die Anmeldetabellen, und ein
  Aufruf von `mcp.rechte_auffrischen()` gab der Leserolle den privaten Signierschlüssel zurück.
  Im Review vor dem Ausrollen gefunden (`docs/fehlerkatalog.md`).
- `0148` entzog `mcp_leser` am 06.11.2026 das Zugriffsprotokoll. Der Rumpf von
  `mcp.rechte_auffrischen()` stammte aus `0110` und vergab es weiter; `0149`, `0150` und `0151` riefen
  die Funktion auf. In Produktion am 12.11.2026 nachgemessen: Die Leserolle durfte das Protokoll
  wieder lesen. Behoben mit `0153` (`docs/fehlerkatalog.md`, Eintrag vom 12.11.2026).

Beide Male lag die Ursache in einer Migration, die mit dem betroffenen Recht nichts zu tun hatte.
Bei Vertragsdaten wäre derselbe Fehler eine Offenlegung von Stundungen und offenen Posten an alle
MCP-Nutzer. Eine eigene Datenbank hat keine Rolle `mcp_leser`, der etwas zurückgegeben werden kann.

## 3. Datenfluss

```text
Analytics (PostgreSQL, mart)                 Vertragsdatenbank
  Nettoumsatz je Betrieb und Monat   ──────▶   Monatsrechnung, Gegenüberstellung
  BWA-Zeile Franchisegebühr          ──────▶
  Betriebsliste                      ──────▶   Zuordnung Einheit ↔ LINA-Betrieb
                                     ◀── nie ──
Finance (Eingabe, Vier-Augen)        ──────▶   Verträge, Konditionen, Stundungen …
DATEV (offene Posten, Export)        ──────▶   Schritt 4, Format offen
```

Die Zuordnung einer Einheit zum LINA-Betrieb trägt Eugene ein. Sie muss über den Schlüssel des
Betriebs laufen, nicht über den Namen: In Analytics heißen fünf Betriebe „Karlsruhe" (`AGENTS.md`).

Der Vertragsordner der LINA-Ladenakte (Vertragsdatum, Vertragsende, Kündigungsfrist, Datei) wird
**bewusst nicht importiert**: Dieselbe Seite enthält je Vertrag einen Lösch-Link, der per GET
auslöst (`docs/lina-api-inventar-ladenakte.md`, Abschnitt 5).

## 4. Was Analytics schon liefert

Zahlen aus der Vorgabe vom 17.11.2026; die Umsatzprobe stand zuerst in der Mail vom 04.11.2026.

**Nettoumsatz je Betrieb und Monat** aus `mart.umsatz_tag`. Probe Januar 2026, Enchilada, gegen
das Gebührenblatt von Finance — auf den Cent gleich:

| Betrieb | Nettoumsatz Januar 2026 |
|---|---|
| Aalen | 75.786,17 € |
| Aschaffenburg | 104.672,63 € |
| Augsburg | 114.006,29 € |
| Bayreuth | 74.288,91 € |
| Freiburg | 116.530,98 € |
| Wilsdruffer Straße | 126.047,15 € |
| Kurhaus Freudenstadt | 2.752,42 € — eigene Verkaufsstelle „Kurhaus_old" des Betriebs Enchilada Freudenstadt, Satz 3 % statt 5 %, `mart.verkaufsstelle_monat` |

Zwei Abweichungen:

- **Bremen:** Finance 74.012,00 €, Analytics 73.974,57 €. Der Wert bei Finance wurde von Hand aus
  Sell & Pick gezogen (Andreas, 11.11.2026). Sell & Pick ist gekündigt, Finance hat keinen Zugriff
  mehr (Eugene, 17.11.2026) — diese Quelle entfällt.
- **Freudenstadt ohne Kurhaus:** Finance 69.778,06 €, Analytics 71.419,20 €, davon Außer Haus
  1.168,29 € und Gesamtbetrieb 70.250,89 € (die beiden Teile ergeben 71.419,18 €; die 2 Cent sind
  nicht geklärt). Differenz 1.641,14 €, liegt bei Kristina Stokic.

**BWA-Zeile „Franchisegebühr"** je Betrieb und Monat aus `mart.bwa_longterm`. Januar 2026:

| Betrieb | BWA | Rechnung | Befund |
|---|---|---|---|
| Freiburg | 5.826,55 € | 5.826,55 € | gleich |
| Bayreuth | 2.951,59 € | 2.971,56 € | 19,97 € Unterschied, Ursache offen (Andreas vermutet einen Zahlendreher beim Betrieb) |
| Aalen | 0 € | 3.789,31 € (Gebührenblatt, Screenshot vom 29.10.2026) | Aufhebungsvertrag zum 31.07.2026; warum die BWA im Januar null zeigt, ist nicht geklärt |

Dazu die Zeilen „sonst. Franchisekost" (vermutlich Marketing und Kampagne) und „Franchisekosten"
(Summe).

**Erlöskonten bei Finance:** 840020 Franchisegebühr, 840028 Marketinggebühr 1 % vom Umsatz, 840038
Kampagnenbudget 500 €.

**Betriebszahl:** Analytics führt 56 operative Betriebe in den genannten Marken (Aposto 8,
Enchilada 21, Wilma Wunder 13, Schlager Cafe 1, Deutsche Konzepte 13), mit Sonstigen und
Kooperationspartnern 60. Die „ca. 70 Betriebe" von Finance sind damit nicht gedeckt — Liste
anfordern (`offene-punkte.md`).

## 5. Offen auf der technischen Seite (Eugene entscheidet)

Die Empfehlungen stammen aus der Vorgabe vom 17.11.2026. **Empfehlung, nicht entschieden.**

| Frage | Optionen | Empfehlung |
|---|---|---|
| Wo läuft die Datenbank? | eigene Postgres-Instanz in Dokploy auf demselben Server · eigener Server | eigene Instanz, eigener Backup-Lauf |
| Wie kommt der Umsatz herüber? | eigene Leserolle in Analytics, beschränkt auf wenige `mart`-Sichten · nächtlicher Abzug in die Vertragsdatenbank | nächtlicher Abzug: Die Vertragsdatenbank hängt zur Laufzeit nicht an Analytics, und jede Gebührenrechnung steht auf einem festgehaltenen Umsatzstand |
| Rechte je Marke im neuen MCP | Row-Level-Security in der Datenbank · Prüfung im MCP-Server | Row-Level-Security in der Datenbank, nicht im Prüfer |
| Eingabeoberfläche | Technik, Anmeldung, Vier-Augen-Freigabe, Änderungsprotokoll | keine |
| Wo liegt der Code? | eigenes Repo · Unterordner in diesem Repo | keine |

Zur Leserolle in Analytics: Sie wäre eine weitere Rolle, deren Rechte jede Analytics-Migration
berühren kann — derselbe Mechanismus wie in Abschnitt 2, nur in die andere Richtung.
