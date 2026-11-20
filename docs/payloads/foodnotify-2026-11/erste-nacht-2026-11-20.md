# Erste Nacht nach dem Deploy von `0155`–`0159` (Lauf 208, 20.11.2026)

Nachgemessen am 20.11.2026 zwischen 08:50 und 09:10 Uhr, nur lesend, gegen Produktion über die Metabase-API
(`/api/dataset`) und den Statusbericht des Importers. Lauf 208 stand dabei noch auf `laeuft` (Phase C);
Tagesgeschäft bis 07:36, Ableitungen bis 07:46.

## Lauf und Migrationen

* `0155`–`0159` stehen in `public.schema_migration`, angewendet am 19.11.2026 zwischen 18:53 und 18:55 Uhr.
  `0156` lief durch (beide Wächter haben nicht abgebrochen).
* Lauf 207 (19.11.) war **`uebersprungen`**: Lauf 206 lief bis 19.11. 04:30 Uhr (Phase C bis `NACHLADEN_BIS`),
  der Start um 04:00 Uhr traf auf den laufenden Vorgänger. Das erklärt die Meldung vom 19.11. abends
  („28 Quellen werden gar nicht mehr abgefragt", 36 Stunden ohne Fortschritt). Nach Lauf 208:
  `mart.quelle_zulauf WHERE erwartet AND zustand <> 'ok'` → **0 Zeilen**.
  Offen bleibt die Ursache: ein Lauf, der bis 04:30 nachlädt, und ein Start um 04:00 schließen sich aus —
  `docs/offene-punkte.md`.

## `0155` Kassenartikel → Rezept

`mart.pos_artikel_abdeckung`: 30 Anbindungen `ok`, 2 `ohne betrieb` (AAA Testrestaurant Bar/Küche), 58
`marke nicht aktiv`. Alle 32 Anbindungen von Wilma Wunder in einer Nacht geladen (04:02:59 bis 04:03:12 —
rund eine halbe Sekunde je Anbindung, **nicht** die 19–39 s der Probe vom 19.11.).

* Artikel mit Rezept je Anbindung: 35 % (Markt Mainz) bis 87 % (Bochum).
* **Umsatz mit Rezept (drei volle Monate, Aug.–Okt. 2026): 68,5 % (Bar Köln) bis 95,2 % (Bochum).**
  Umsatz im Feed 91,6–96,4 %.
* **Zwei Anbindungen ohne ein einziges Rezept:** 2057 „Ballplatz Mainz – Biergarten" (895 Artikel, 0 mit
  Rezept) und 2050 „Bar Düsseldorf" (798 Artikel, 0). Die jeweils andere Anbindung desselben Betriebs trägt
  Rezepte (Ballplatz 49–51 %, Küche Düsseldorf 57,6 %). Zustand der Pflege bei FoodNotify, kein Ladefehler.
* Bar und Küche eines Betriebs führen dieselbe Artikelzahl (z. B. 895/895, 1.171/1.171) — die bekannte
  Überlappung; nie über Anbindungen summieren.

## `0157` Warenstamm

`mart.warenstamm_stand`: 31 `ok`, 2 `ohne betrieb` (Testrestaurant 11035/12066), **2 `leer`** (11757 „DISTRA
TESTBETRIEB", 12601 „CF GASTRO TESTBETRIEB" — Testkostenstellen ohne Produkte, erwartbar), 118 `marke nicht
aktiv`. `core.ware_stand`: 16.419 Zeilen an 33 Kostenstellen, alle mit Listenpreis, 5.956 mit Katalogpreis;
`core.listenpreis_beobachtung` 16.419 Zeilen (erste Sichtung, die Reihe beginnt am 20.11.2026).

Nebenbeobachtung, nicht geklärt: `abzug_tag` steht auf 19.11.2026, `reihe_ab` auf 20.11.2026 bei einem Abruf
um 04:04 Uhr am 20.11.

## `0156` Lieferdatum und Lieferkonditionen

* `core.bestellung`: 73.373 Bestellungen, alle mit Liefertermin; 151 am Bestelltag, 6 vor der Bestellung.
* Wochentag der Lieferung, letzte 365 Tage: Mo 3.815, Di 5.301, Mi 3.824, Do 4.053, Fr 5.176, Sa 1.583,
  **So 36** — die Verschiebung um einen Tag ist weg.
* `mart.lieferkondition_beobachtet`: 549 Zeilen, 340 `belastbar`.

## `0159` Soll-Verbrauch

Abdeckung Oktober 2026 (`mart.soll_verbrauch_abdeckung`), 13 Betriebe von Wilma Wunder, alle `zustand = 'ok'`:

| Betrieb | Abdeckung Umsatz | Umsatz mit Rezept |
|---|---|---|
| Köln | 70,1 % | 75,2 % |
| Ballplatz Mainz | 72,9 % | 78,5 % |
| Düsseldorf | 82,7 % | 84,4 % |
| Markt Mainz | 84,5 % | 87,8 % |
| Karlsruhe | 84,8 % | 87,2 % |
| Passau | 86,4 % | 91,7 % |
| Stuttgart | 87,7 % | 89,6 % |
| Freudenstadt | 91,0 % | 95,1 % |
| Bochum | 91,7 % | 98,1 % |
| Speyer | 91,8 % | 96,8 % |
| Dresden | 95,3 % | 98,5 % |
| Nürnberg | 96,0 % | 97,1 % |
| Viernheim | 96,8 % | 98,4 % |

Die anderen drei Marken stehen auf `marke nicht aktiv` (Schalter, kein Fehler).

Wohin der Umsatz der 13 Betriebe im Oktober fällt (2.613.112 EUR netto):

| | EUR | Anteil |
|---|---|---|
| vollständig umgerechnet | 2.273.624 | 87,0 % |
| **kein Rezept zugeordnet** | 253.697 | 9,7 % |
| teilweise umgerechnet | 52.691 | 2,0 % |
| nicht im Feed | 20.182 | 0,8 % |
| Rezept nicht geladen | 19.251 | 0,7 % |
| Rezept ohne Zutaten | 12.029 | 0,5 % |
| nicht umrechenbar | 1.820 | 0,1 % |

**Wiedervorlage „Portionierer/Stück schätzen?"** (Punkt 5 der Liste in `offene-punkte.md`). Umsatz der
verkauften Rezepte, die mindestens eine nicht umrechenbare Zeile tragen (Oktober 2026, Wilma Wunder):

| Grund | Rezepte verkauft | Umsatz | Anteil |
|---|---|---|---|
| `einheit nicht umrechenbar: ru_16` | 94 | 38.692 EUR | 1,5 % |
| `unterrezept ohne gewicht` | 21 | 10.807 EUR | 0,4 % |
| `einheit nicht umrechenbar: ru_66` | 5 | 3.337 EUR | 0,1 % |
| `einheit nicht umrechenbar: Stück` | 2 | 3.167 EUR | 0,1 % |

Zusammen rund 2 % des Umsatzes, und diese Rezepte gehen überwiegend **teilweise** ein (nur die betroffene
Zeile fehlt). Die Einheit heißt bei Wilma Wunder nicht „Portionierer", sondern kommt als unübersetzter
Schlüssel `ru_16` bzw. `ru_66` (553 und 20 Zeilen in `mart.rezept_stueckliste`). Der größere Hebel ist die
fehlende Rezeptzuordnung (9,7 %), und die ist Pflege bei FoodNotify, keine Rechenfrage.

Weitere Messpunkte:

* `mart.soll_rezept_zuordnung`: 25 von 8.323 Zuordnungen `rezept_uneindeutig` (0,3 %; 16 davon Viernheim).
* Refresh `mart.rezept_stueckliste_basis` im Einkaufs-Nachlauf: zusammen mit den anderen Einkaufssichten 64,9 s.
* **`SELECT count(*) FROM mart.soll_verbrauch_tag WHERE geschaeftstag = current_date - 1`: 82,2 s** (am Klon
  0,05 s) — für eine Karte oder den MCP-Zugang (Grenze 45 s) zu langsam. `mart.soll_ist_monat` für einen
  Monat: 1,1 s. Die Auswertung je Grund oben: 24 s.

## Speicher und Status

* `mart.speicher_stand` zeigt noch die Messung vom Ende des Laufs 206 (`hochskalieren`, 77,8 GB frei,
  2,88 GB je Tag, Warnschwelle 03.12.2026, voll 11.12.2026); die neue Messung kommt mit dem Ende von Lauf 208.
* Statusbericht 07:47 Uhr: `zulauf` wieder in Ordnung; unverändert `speicher` (Störung) und die bekannten
  Warnungen (aufgegebene Posten, Schemaabweichungen, Yext `A_03`, Bounti).
* `mart.materialisierung_stand`: alle 22 Sichten `aktuell`.

## Nicht geprüft

* `mart.pruefung_uebersicht` als Ganzes (läuft über die Metabase-API in die Zwei-Minuten-Grenze).
* Stichprobe `geliefert_am` gegen einzelne Rohsätze — nur die Wochentagsverteilung.
* Inhaltliche Plausibilität des Soll-Verbrauchs an einzelnen Waren (Punkt 2 der Liste).
