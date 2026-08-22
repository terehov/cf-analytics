# `pflege/` — die handgepflegten Tabellen

Was hier liegt, liest der **nächtliche Lauf** von selbst ein. Kein Befehl auf
dem Server, kein Skript, keine Migration.

**Der Weg ist: Datei ändern → committen → pushen.** Der nächste Lauf übernimmt
es. Damit hat die Handpflege genau das, was ihr bisher fehlte — eine Historie
(`git log`), eine Überprüfung vor dem Wirksamwerden (der Commit ist lesbar),
und einen Weg zurück (`git revert`).

---

## Die Regeln

**Nur ergänzt und überschrieben, nie gelöscht.** Eine Zeile, die aus der Datei
verschwindet, bleibt in der Tabelle stehen. Das ist Absicht: eine versehentlich
halb gespeicherte Excel-Datei würde sonst Monate an Noten entfernen, und der
Verlust sähe aus wie ein Betrieb ohne Bewertung. Wer wirklich löschen will, tut
das in Postico — bewusst und mit einer `WHERE`-Klausel.

**Entweder ganz oder gar nicht.** Ein unbekannter Spaltenname, ein
Betriebsname, den es nicht gibt, eine Zahl, die keine ist: die **ganze Datei**
wird abgewiesen, und der Grund steht in `mart.pflege_stand`. Eine Datei, die zu
90 % durchläuft, ist die schlechteste aller Möglichkeiten — sie sieht aus wie
ein Erfolg.

**Der Betrieb darf als Name stehen.** Statt `betrieb_key` genügt eine Spalte
`betrieb` mit dem Namen aus `core.betrieb` (exakt, Groß-/Kleinschreibung egal).
Passt einer nicht, sagt die Fehlermeldung welcher.

**Format.** Kopfzeile mit den Spaltennamen, `;` oder `,` als Trennzeichen (wird
erkannt), Anführungszeichen wie in Excel. Kein Zeilenumbruch innerhalb eines
Feldes.

---

## Die Dateien

| Datei | Tabelle | Schlüssel | Wozu |
|---|---|---|---|
| `om_einschaetzung.csv` | `manual.om_einschaetzung` | Betrieb + Monat | Vor-Ort-Note des Operations Managers — eine der sechs Round-Table-Kennzahlen |
| `gfgh_betrieb.csv` | `manual.gfgh_betrieb` | Betrieb | Getränkefachgroßhändler je Betrieb |
| `lieferant_freigabe.csv` | `manual.lieferant_freigabe` | Dachname | Konzernfreigabe je Lieferant |
| `bwa_zeile.csv` | `manual.bwa_zeile` | Zeile | Gliederung der BWA |
| `sachkonto.csv` | `manual.sachkonto` | Kontonummer | Welche Sachkonten Wareneinsatz sind |
| `marktindex.csv` | `manual.marktindex` | Monat | Gastronomie-Marktindex (Destatis) |
| `pflichtartikel_liste.csv` | `manual.pflichtartikel_liste` | Konzept + Bereich + gültig ab | Kopfzeile je Pflichtartikelliste: Laufzeit und Quelle |
| `pflichtartikel.csv` | `manual.pflichtartikel` | dazu Artikelnummer + Bezeichnung | die einzelnen Pflichtartikel |
| `pflichtartikel_alias.csv` | `manual.pflichtartikel_alias` | Konzept + Artikelnummer | Nachfolgenummern: welche bestellte Nummer erfüllt welche Listenposition |

Die erlaubten Spalten je Datei stehen in `src/pflege/tabellen.ts` — dort und
nur dort. Ein Spaltenname aus einer CSV wird nie in SQL eingesetzt.

**Feiertage und Schulferien stehen nicht in dieser Liste.** Sie holt der Lauf
einmal im Monat selbst von `openholidaysapi.org` — derselben Quelle, die schon
in `manual.feiertag.quelle` steht.

---

## Was man danach ansieht

```sql
-- Ist jede Datei durchgelaufen? ERWARTUNG: fehler IS NULL ueberall.
SELECT * FROM mart.pflege_stand;

-- Und die Frage dahinter: reicht die Pflege noch bis heute?
SELECT * FROM mart.pruefung_uebersicht WHERE pruefung LIKE 'Handpflege%';
```

---

## Warum `om_einschaetzung.csv` schon hier liegt

Die 22 Noten darin standen bis zum 14.08.2026 **fest im Quelltext** von
Migration `0044`, auf einen verdrahteten Monat. Folge: ab Juli 2026 war
`ampel_om` für alle 141 Betriebe leer, und das Round-Table-Gesamturteil wurde
**grün, wenn ein Signal wegfiel**.

Sie stehen jetzt hier, damit die nächste Note ein Commit ist und keine
Migration. Wer Juli und August nachträgt, hängt zwei Blöcke Zeilen an — mehr
ist es nicht.


---

## Die drei Pflichtartikel-Dateien

**Die Reihenfolge zählt.** `pflichtartikel.csv` hängt per Fremdschlüssel an
`pflichtartikel_liste.csv` — steht die Kopfzeile einer Liste noch nicht, wird
die ganze Positionsdatei abgewiesen. Beide zusammen ändern und committen.

### Eine neue Liste eintragen (z. B. die Winterkarte)

Die Wilma-Wunder-Liste ist eine **Sommerkarte** und läuft am 04.10.2026 aus.
Danach misst `db_pflichtartikel` für die Marke nichts mehr — fehlerfrei und
leer. Die Nachfolgeliste ist zwei Schritte:

1. In `pflichtartikel_liste.csv` je Bereich eine Zeile mit dem neuen
   `gueltig_von`. Die alte Zeile **bleibt stehen** und bekommt ihr
   `gueltig_bis` — die Historie ist die halbe Auswertung.
2. In `pflichtartikel.csv` die Positionen mit demselben `gueltig_von`.

`gueltig_von` steht im Schlüssel, damit beide Listen nebeneinander stehen statt
sich zu überschreiben. Jede Bestellung wird gegen die Liste geprüft, die **am
Bestelltag** galt.

> Überlappen zwei Listen desselben Konzepts mit **verschiedenen** Grenzen, zählt
> jede Bestellposition im überlappenden Zeitraum doppelt.
> `mart.pflichtartikel_ueberlappung` meldet das — Erwartung: leer.

### Eine Nachfolgenummer bestätigen

Lieferanten vergeben neue Artikelnummern, während die Liste stehen bleibt:
„Cheddar / Gouda Mix" lief bis 13.11.2025 unter Distra `268` und seit dem
15.11.2025 unter `500096`. Ohne Eintrag zählen solche Einkäufe als „abseits der
Liste" — 105.194 € bei 20 Betrieben allein in diesem Fall.

Die Kandidaten stehen in `mart.pflichtartikel_verdacht` (auf der Seite: Reiter
„Listenpflege"). Bestätigt wird mit einer Zeile in `pflichtartikel_alias.csv`:

```csv
konzept;artikelnummer;gilt_fuer;grund;gilt_ab
Enchilada;500096;268;Distra hat Cheddar/Gouda Mix umnummeriert;2025-11-15
```

`artikelnummer` ist die **bestellte** Nummer, `gilt_fuer` die Nummer **auf der
Liste**. Ab dem nächsten nächtlichen Lauf zählt der Artikel als Pflichtartikel.

**Je mehr Betriebe dieselbe abweichende Nummer bestellen, desto sicherer ist es
eine Nachfolgenummer und kein Verhalten.** Bei einem einzelnen Betrieb lohnt der
Blick in die Bestellung, bevor die Zeile geschrieben wird.

### Eine fehlende Artikelnummer nachtragen

112 der 765 Positionen haben keine Nummer — überwiegend Getränke, weil jeder
Betrieb seinen eigenen Getränkefachgroßhandel mit eigenem Nummernkreis hat. Für
sie greift nur der Namensabgleich. Wer die Nummer kennt, trägt sie in
`pflichtartikel.csv` nach.

> **Achtung, hier greift „nie löschen".** Die Nummer gehört in den Schlüssel:
> eine Zeile mit nachgetragener Nummer ist für den Import eine **neue** Zeile,
> die alte ohne Nummer bleibt stehen. Wer sie loswerden will, löscht sie in
> Postico — bewusst und mit `WHERE`.
