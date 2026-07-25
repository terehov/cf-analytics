# Offene Punkte

## Blockierend für den ersten echten Lauf

*(nichts mehr — der Login war der letzte Punkt hier und ist geklärt)*

### Erledigt: Login-Flow

Der erste echte Lauf scheiterte mit `Login 200, Probe 302`. Ursache waren drei falsche Annahmen, die aus dem sichtbaren Formular abgeleitet waren; `/js/common/login.js` sagt es anders: POST geht auf `/common/index/dologin`, das Passwort als **MD5-Hex**, und ein per Aufruf neu vergebenes **`secret`** aus der Loginseite muss mit. Umgesetzt in `src/lina/auth.ts`, nachgebildet in `src/lina/mock.ts`, abgedeckt in `src/lina/auth.test.ts`. Details in `docs/importer.md`, Abschnitt „Session".

Damit ist der Ablauf gegen die Attrappe grün, **gegen das echte LINA aber noch nicht gelaufen**. Beim ersten Versuch gilt: `MAX_POSTEN_PRO_LAUF=1`, und bei einem Fehlschlag **nicht wiederholen**, sondern die Meldung lesen — sie nennt die Prüfreihenfolge. Wiederholte Fehlanmeldungen sind der schnellste Weg zu einer Kontosperre.

## Rohdaten, die noch zu holen sind

Vollständige Liste mit Bewertung in `docs/datensicherung.md`. Die drei dringendsten, weil billig und unersetzlich:

**`/wawi/rezept/recipe` — Rezepturen. Nie geprüft.** Ein einziger lesender Aufruf klärt, ob dort JSON liegt. Wenn ja, ist das der größte Einzelgewinn im ganzen Projekt: damit lässt sich der Wareneinsatz für jeden historischen Zeitraum neu rechnen, statt `fixer_we` glauben zu müssen.

**WAWI-Einkaufspreise.** Verkaufspreise haben wir, Einkaufspreise nicht. Ohne sie ist die Frage „wie hat sich unsere Marge über die Jahre entwickelt" nicht beantwortbar — egal wie viele Umsatzdaten wir sammeln.

**334 Feinsparten aus `analyticsFilterOptions`.** Wir speichern nur Haupt­sparten und Verkaufsstellen. Ein Aufruf, und ohne sie ist jede Sortimentsanalyse dauerhaft auf grobem Niveau.

**Bericht 107 „Gearbeitete Stunden"** ist seit heute aktiv, aber die Antwortstruktur ist unbekannt und der 500er aus Phase 1b nie auf Betriebsebene gegengeprüft. Bleibt es auch mit `storeId` bei 500, ist es ein Rechteproblem → `aktiv: false` setzen und hier vermerken, **nicht** wiederholen lassen.

## Fachlich

**Ist die Konzeptzuordnung wirklich 1:n?** Erwartung ja — ein Aposto ist ein Aposto. Die frühere Notiz „Karlsruhe hängt in fünf Konzepten" beruhte darauf, dass in `getKennzahlen` die Gruppe die Marke liefert und das Kind nur die Stadt; der *Name* erscheint fünfmal, die *Schlüssel* sind höchstwahrscheinlich fünf verschiedene. Offen bleibt der Fall *Eat Tasty*, der laut Eugene mehrere Marken hatte.
→ Prüfung, sobald Betriebe geladen sind: `SELECT anzahl_konzepte, count(*) FROM mart.konzept_zuordnung GROUP BY 1;` — nur die Zeile `1` bedeutet 1:n. Alles darüber ist die Arbeitsliste für `manual.betrieb_hauptkonzept`.

**Umsatzabweichung Bayreuth und Freiburg.** Karlsruhe stimmt exakt zwischen API und Excel (136.612,46 € vs. 136.612,47 €), Bayreuth (52.712,58 vs. 69.886,44) und Freiburg (125.926,89 vs. 142.090,80) nicht. Vermutlich wurden diese Zeilen manuell aus einer anderen Quelle oder Periode gepflegt. **Vor dem ersten Round Table aus der neuen Datenbank klären**, sonst diskutiert jemand über Zahlen, die aus zwei Welten stammen.

**Fehler im bestehenden Excel.** `Eingabe!K6` referenziert `J7` statt `J6` — die Personal-Ampel ist im JULI-Report um eine Zeile verschoben. Dazu mehrere `#REF!` und `#NAME?` (`_xludf.TEXTJOIN`, LibreOffice-Inkompatibilität). Falls der Juli-Report so kommuniziert wurde, lohnt ein Blick.

**Backfill-Tiefe unbekannt.** Wie weit LINA zurückreicht, ist nicht gemessen. Ein paar lesende Aufrufe klären es.

**`Stornotyp`-Ausprägungen** bleiben unverifiziert, weil kein Betrieb Stornodaten liefert. Struktur ist dokumentiert, Bericht deaktiviert.

## Strategisch

**Amadeus 360 ist das führende System, nicht LINA.** Die Oberfläche sagt es selbst („Die Daten sind nur eingeschränkt änderbar, weil Amadeus 360 nicht führendes System ist"), dazu passen `a360isMaster`, `isSynced` und `syncGroups` im Code. Ein Teil dessen, was wir aus LINA ziehen, ist dort selbst nur eine Kopie. Falls die Datenqualitätsprobleme — Stichwort „Doppelte Artikelnummern, unbedingt korrigieren" aus dem `errors`-Feld — aus dieser Synchronisation stammen, wäre das Vorsystem der bessere Anknüpfungspunkt.
→ **Frage an Concept Family:** Welches System ist führend, und gibt es dorthin direkteren Zugang?

## Sicherheitsbefund (an Concept Family melden)

`GET /einstellungen/api/getStoreData` liefert die Stammdaten des aktiven Betriebs — darunter **`db_name`, `db_user`, `db_pass` im Klartext**, dazu IBAN, BIC und Steuernummer. Die Werte wurden bewusst nicht ausgelesen oder gespeichert. Der Endpunkt ist trotzdem als Stammdatenquelle interessant (Adresse, Öffnungszeiten, Geokoordinaten) — dann aber mit strikter Feld-Whitelist.

## Betrieb

- **Restore testen**, nicht nur das Backup. Dokploys Testfunktion prüft nur den Upload.
- **Plausibilitätsprüfung** muss „Betrieb hat nie BWA" von „Monat noch nicht gebucht" unterscheiden (`core.bwa_buchungsstand`). Sonst schlägt sie jeden Monatsanfang grundlos Alarm: Juni 2026 war am 25.07. erst bei 22 von 131 Betrieben gebucht.
- **Postgres nicht ins Internet exponieren** — Postico über SSH-Tunnel.

## Phase 4

Metabase: zweistufig (Übersicht über alle Marken → Drill-Down je Betrieb), rollenbasierte Rechte über Metabase-Sandboxing plus Postgres-RLS. Der Round-Table-Regelwerk-Schalter wird ein Dropdown mit `mart.regelwerk` als Werteliste.
