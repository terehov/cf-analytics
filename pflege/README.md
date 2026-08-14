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
