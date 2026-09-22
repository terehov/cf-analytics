# Screenshots — Phase 0 Kassendaten-Erkundung, 22.09.2026

Erhoben im Browser (Claude, nur lesend), Auftrag [`plan-lina-kassendaten.md`](../../plan-lina-kassendaten.md),
Phase 0. Details und Rohdaten in [`lina-api-inventar-1d.md`](../lina-api-inventar-1d.md).

**Nachtrag 22.09.2026 (zweite Sitzung):** breite Erkundung fortgesetzt — sechs weitere
Betriebsberichte für Wilma Wunder Düsseldorf (August 2026), das Konzern-Management-Dashboard,
und je eine Stichprobe aus Finance/Voucher/Team. Die Suche nach einem Weg, den
Kassenjournal-Betrieb umzuschalten, blieb **ergebnislos** — siehe Abschnitt „Sitzungsbindung"
unten, der jetzt auch den einzigen gefundenen Kandidaten und seine Blockade beschreibt.

| Datei | Seite | URL-Pfad | Betrieb | Zeitraum | Hinweis |
|---|---|---|---|---|---|
| `gruppe-umsatzbericht-2026-08.png` | Konzern-Umsatzbericht (Report Center Konzernebene) | `/intranet/analytics/reportcenter` | alle 141 Betriebe | August 2026 | aus einer vorherigen Sitzung übernommen, Referenzwerte für den Abgleich mit den Betriebsberichten |
| `betrieb-report-020-tagesverlauf-wilma-wunder-duesseldorf-2026-08.png` | Betriebsbericht „Tagesverlauf" (id 20) | `/intranet/analytics/storereportcenter?storeId=<encId>` | Wilma Wunder Düsseldorf GmbH | August 2026 | erster erfolgreich in der UI gerenderter Betriebsbericht mit echten Zahlen über den korrigierten Endpunkt (`laden=`, siehe `lina-api-korrekturen.md` KORREKTUR 7) |
| `finanzwege-stammdaten.png` | POS-Stammdaten „Finanzwege" | `/wawi/badata/fintyp` | global (Stammdaten, nicht betriebsbezogen) | Stand 22.09.2026 | 34 System-Finanzwege; die Glücksrad-Finanzwege (3168, 3500–3502) stehen NICHT in dieser Liste |
| `kassenjournal.png` | Kassen-Journal | `/finanzen/report/kassenjournal` | sitzungsgebundener „Home"-Betrieb (nicht Wilma Wunder Düsseldorf, nicht per Parameter umschaltbar) | 22.09.2026 | leer (0 Zeilen) — siehe A4 im Inventar, kann Mitarbeiternamen zeigen sobald befüllt |
| `rechnungen-posbills.png` | Rechnungen (Debitoren-Rechnungsliste) | `/finanzen/document/posBills` | sitzungsgebundener „Home"-Betrieb | 22.09.2026 | keine Bonebene, sondern Debitorenrechnungen — enthält Firmenname eines Debitors (Gastro-MIS GmbH), keine Mitarbeiternamen |
| `dashboard.png` | Store-Dashboard | `/common/dashboard/storeDashboard` | sitzungsgebundener „Home"-Betrieb | September 2026 | alle Kennzahlen 0 €, dieselbe Sitzungsbindung wie Kassenjournal; **kann Mitarbeiternamen zeigen** (Bereich „Deine Aufgaben" / Geburtstage / Urlaubsanträge) |
| `hauptmenue-pos-geoeffnet.png` | Hauptmenü, Gruppe „POS" aufgeklappt | (Seitenleiste, beliebige Seite) | — | — | zeigt die Stammdaten-Unterpunkte unter POS, u. a. den Pfad zu „Finanzwege" |
| `betrieb-report-088-finanzwege-wilma-duesseldorf-2026-08.png` | Betriebsbericht „Finanzwege" (id 88) | `/intranet/analytics/storereportcenter?storeId=<encId>` | Wilma Wunder Düsseldorf GmbH | August 2026 | zeigt die vier Glücksrad-Finanzwege in der Kopftabelle; Gesamtumsatz 369.841,09 € netto 330.080,34 €, 12.186 Rechnungen — deckt sich mit `getUmsatzbericht` |
| `betrieb-report-092-rabattbericht-wilma-duesseldorf-2026-08.png` | Betriebsbericht „Rabattbericht" (id 92) | `/intranet/analytics/storereportcenter?storeId=<encId>` | Wilma Wunder Düsseldorf GmbH | August 2026 | Artikel × Finanzweg-Kreuzung, siehe A3a im Inventar |
| `betrieb-report-027-artikelverkaufsbericht-wilma-duesseldorf-2026-08.png` | Betriebsbericht „Artikelverkaufsbericht" (id 27) | `/intranet/analytics/storereportcenter?storeId=<encId>` | Wilma Wunder Düsseldorf GmbH | August 2026 | Kopfzahlen zur Gegenprobe |
| `betrieb-report-060-umsatz-pro-kellner-wilma-duesseldorf-2026-08.png` | Betriebsbericht „Umsatz pro Kellner" (id 60) | `/intranet/analytics/storereportcenter?storeId=<encId>` | Wilma Wunder Düsseldorf GmbH | August 2026 | **zeigt Kellnernamen** in der Tabelle unterhalb der Kopfzahlen |
| `betrieb-report-097-tagesabschluss-wilma-duesseldorf-2026-08.png` | Betriebsbericht „Tagesabschluss" (id 97) | `/intranet/analytics/storereportcenter?storeId=<encId>` | Wilma Wunder Düsseldorf GmbH | August 2026 | Zeilen je Tag, Zahlarten und Z-Bon-Summen |
| `betrieb-report-068-umsatz-nach-betriebsstellen-wilma-duesseldorf-2026-08.png` | Betriebsbericht „Umsatz nach Betriebsstellen" (id 68) | `/intranet/analytics/storereportcenter?storeId=<encId>` | Wilma Wunder Düsseldorf GmbH | August 2026 | „Bericht anzeigen" blieb nach dem Schnellfilter deaktiviert, obwohl die Daten bereits geladen waren (kein Fehler, nur eine UI-Eigenheit) |
| `gruppe-management-dashboard-2026-08.png` | Management-Dashboard (Konzernebene) | `/intranet/index/madashboard` | alle Betriebe | August 2026 | Umsatz pro Betrieb, Umsatzbringer Top 30, Effektivität, Management-Bericht je Betrieb — kein Mitarbeiterbezug |
| `finance-monatsuebersicht-sitzungsbetrieb-2026-09.png` | Monatsübersicht | `/finanzen/abrechnung/monatueb` | sitzungsgebundener „Home"-Betrieb | September 2026 | alle Werte 0 € — dieselbe Sitzungsbindung wie Kassenjournal/Kassenbuch; enthält Monat/Jahr-Auswahl bis 2011 zurück, aber immer für denselben Betrieb |
| `voucher-alte-gutscheine-sitzungsbetrieb.png` | Alte Gutscheine | `/finanzen/token/legacy-token` | sitzungsgebundener „Home"-Betrieb | Stand 22.09.2026 | Liste, keine Mitarbeiternamen erkennbar |
| `team-dienstplan-sitzungsbetrieb-2026-09.png` | Dienstpläne | `/personal/dienstplan/dienstplan` | sitzungsgebundener „Home"-Betrieb | September 2026 | **zeigt Mitarbeiternamen** im Schichtplan |

Nicht geschafft (Budget/Blockaden dieser Sitzung, siehe unten): POS-Stammdaten „Artikel" (führt
auf `/wawi/rezept/recipe` — WAWI, laut AGENTS.md Regel 5 Demodaten, deshalb bewusst nicht
dokumentiert), Warengruppen/Terminals/Kellner-Übersicht, Pay, CRM-Detailseiten, Table ›
Reservierungen (Klick markierte den Menüpunkt als aktiv, der Seiteninhalt wechselte aber nicht —
vermutlich dieselbe „leer im Zentralkontext"-Eigenheit wie in `lina-api-inventar-1b.md`
vermerkt), sowie der volle Katalog der 72 Betriebsberichte (nur 6 von 63 offenen probiert).

## Kurz zur Sitzungsbindung

Kassenjournal, Rechnungen/posBills, Store-Dashboard, Kassenbuch und jetzt auch Monatsübersicht
hängen an einem **sitzungsgebundenen aktiven Betrieb**, der sich nicht über `laden=`/`storeId=`
in der URL ansteuern lässt (getestet, ohne Wirkung — auch nicht per URL-Parameter direkt an
`/intranet/analytics/storereportcenter?report=…&von=…&bis=…`, der UI-Zustand ignoriert diese
Parameter komplett und bleibt bei „Bitte Bericht auswählen"). Welcher Betrieb das genau ist,
wurde nicht ermittelt.

**Nachtrag 22.09.2026 (zweite Sitzung):** gezielt nach einem Umschalter gesucht, mit folgendem
Ergebnis:

- Der Store-Auswahl-Button im Report Center (neben „Wilma Wunder Düsseldorf GmbH") wechselt nur
  zwischen `storereportcenter` und `storeanalyticsdashboard` **für denselben Betrieb** — kein
  Umschalter.
- Unter „Stores" im Hauptmenü, „Management" (`/intranet/index/madashboard`) und „Administration"
  gibt es keine Betriebsauswahl, nur Filter nach Konzept/Zeitraum auf Konzernebene.
- Im ausgelieferten Vue-Bundle (`index_EmlX5sfy.js`) ist die Combobox oben links — die als
  „CONCEPT FAMILY Franchise AG" beschriftet ist — im Code an `currentStore` aus dem
  Account-Store gebunden (`l.value = g.currentStore.encryptedId`, gesetzt beim Seitenaufbau
  nach `g.getAccount()`). LINAs Datenmodell scheint „Betrieb" und den obersten Mandanten unter
  demselben `store`-Begriff zu führen — das ist ein **starkes Indiz**, dass genau diese Combobox
  der gesuchte Umschalter ist, aber **nicht bewiesen**.
- Der Versuch, diese Combobox anzuklicken, wurde von der Agentenumgebung selbst mit einer
  Berechtigungssperre („Permission Grant" erforderlich) abgelehnt — unabhängig von der
  Aufgaben-Autorisierung. Da genau dieselbe Combobox im Code mit dem ausdrücklich verbotenen
  Mandantenwechsel verwoben zu sein scheint, wurde der Versuch **nicht** wiederholt oder über
  andere Mittel (z. B. `evaluate` + direkter DOM-Klick) umgangen — das hätte gegen Regel 4
  verstoßen können, wenn die Combobox tatsächlich (auch) den Mandanten wechselt.
- **Ergebnis: Der Kassenjournal-Betrieb konnte in dieser Sitzung nicht umgestellt werden.**
  Task 1 aus dem Auftrag (Kassenjournal für Wilma Wunder Düsseldorf mit echten Bondaten) ist
  damit weiterhin offen. `kassenjournal.png` zeigt nach wie vor den leeren sitzungsgebundenen
  Default-Betrieb, nicht Wilma Wunder Düsseldorf.
