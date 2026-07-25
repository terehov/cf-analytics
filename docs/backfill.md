# Backfill

## Entscheidung

**Maximale Tiefe überall**, nicht nach Kosten gestaffelt. Begründung von Eugene: wenn LINA weg ist, gibt es keinen Zugriff mehr — die Daten können später Goldwert sein. Der Optionswert schlägt die Speicherkosten.

## Die Rechnung, die das entspannt

Der Engpass sind **nicht die Requests**: Die Konzern-Endpunkte liefern alle 141 Betriebe in *einer* Antwort. Ein Backfill-Tag sind acht Aufrufe (Umsatz gesamt/Speisen/Getränke, beide Zeitzonenberichte, Artikelverkauf, Personalkosten, Aktionsbericht). `getKennzahlen` sind **zwei Aufrufe pro Jahr**.

| Takt | Requests/Tag | Historie je Kalendertag |
|---|---|---|
| alle 20 s (7–23 Uhr) | 2.880 | **~1 Jahr** |
| alle 60 s | 960 | ~1 Jahr in 3 Tagen |

Ein Jahr Historie ≈ 2.900 Aufrufe. Selbst bei einer Anfrage pro Minute sind acht Jahre in gut drei Wochen durch. **Höflich sein kostet hier praktisch nichts.**

Zeilen pro Jahr: Artikelverkauf ~20 Mio. (dominiert), Zeitzonen ~1,24 Mio., Umsatzbericht ~150 k, Personalkosten ~51 k, Kennzahlen ~8 k.

## Erst einsammeln, dann auswerten

Die Versicherung ist der **Raw-Layer**, nicht der Mart. Priorität ist, `raw.api_antwort` so tief wie möglich zu füllen; die Transformation nach `core` kann jederzeit danach passieren, auch in Jahren, weil raw append-only und vollständig ist. Über die Mart-Tiefe muss deshalb heute nicht entschieden werden.

`core.partition_anlegen()` legt Partitionen bei Bedarf an — beliebige historische Tiefe funktioniert ohne Schemaänderung.

## Reihenfolge

Den Backfill **nach dem ersten erfolgreichen Lauf** starten, nicht davor — erst wissen, dass die Strecke steht. Dann:

1. **BWA/Kennzahlen** zuerst: zwei Aufrufe je Jahr, höchste analytische Ausbeute pro Byte, am ehesten von Nachbuchungen betroffen.
2. **Umsatz, Personalkosten, Zeitzonen**.
3. **Artikelverkauf** zuletzt — am ehesten unterbrechbar, am wenigsten schmerzhaft bei Abbruch.

```bash
bun run einreihen --historie --von 2018-01-01 --bis 2026-07-24
```

Reiht rückwärts ein, der jüngste Zeitraum zuerst. Fortschritt: `SELECT * FROM mart.warteschlange_stand;`

## Noch zu messen

Wie weit LINA tatsächlich zurückreicht, ist ungeklärt. Ein paar lesende Aufrufe (`getKennzahlen` für 2019/2020/2021, `getUmsatzbericht` für einen frühen Tag) klären das. Bis dahin ist `2018-01-01` eine Annahme — Zeiträume ohne Daten quittiert der Importer sauber als `keine_daten`, das schadet also nichts außer ein paar Aufrufen.
