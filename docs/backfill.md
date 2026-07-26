# Backfill

## Entscheidung

**Maximale Tiefe überall**, nicht nach Kosten gestaffelt. Begründung von Eugene: wenn LINA weg ist, gibt es keinen Zugriff mehr — die Daten können später Goldwert sein. Der Optionswert schlägt die Speicherkosten.

## Unterbrechen, umziehen, weitermachen

**Der Zustand liegt vollständig in `sync.warteschlange`, nicht im Prozess.** Daraus folgt alles Weitere:

| Was passiert | Was der Importer tut |
|---|---|
| Prozess neu gestartet | macht beim nächsten offenen Posten weiter |
| Container abgestürzt, Posten reserviert | `haengende_posten_freigeben()` löst ihn nach einer Stunde |
| `bun run sync` läuft schon | zweiter Lauf meldet `lauf übersprungen`, Exitcode 0 (Advisory-Sperre) |
| `einreihen --historie` erneut aufgerufen | reiht **nur echte Lücken** ein, nichts doppelt |
| Datenbank per `pg_dump` umgezogen | die Warteschlange zieht mit — der Importer am Zielort macht exakt dort weiter |
| Ein Posten erneut geholt | Upsert bzw. append-only, keine Dubletten |
| Ein Tag war beim Abruf noch leer | der tägliche Lauf holt ihn im Nachlauffenster erneut, siehe unten |

## Die letzten Tage sind noch nicht da

**LINAs Konzernberichte füllen sich über rund fünf bis sechs Tage.** Am 26.07.2026 gemessen: der 22. bis 25.07. lieferten für alle 141 Betriebe glatt null, der 21.07. für 21 Betriebe, ab dem 17.07. stabil für 56. Zahlen, keine Vermutung — die Messreihe steht in `importer.md`.

Für den Backfill ist das harmlos, er läuft ohnehin rückwärts in die fertige Vergangenheit. Für den täglichen Lauf war es ein stiller Datenverlust: „gestern" holen heißt Nullen holen, und der Posten gilt danach als erledigt. Deshalb reiht `--taeglich` seit dem 26.07.2026 die letzten `NACHZUEGLER_TAGE` (Voreinstellung 10) Tage ein statt nur einen.

**Praktische Folge für den Umzug nach Hetzner:** die jüngsten Tage vor dem `pg_dump` können auf null stehen. Sie korrigieren sich von selbst, sobald der tägliche Lauf am Zielort ein paar Mal gelaufen ist — nichts zu tun, aber gut zu wissen, bevor man sich über eine Delle in der Umsatzkurve wundert.

**Damit ist der geplante Ablauf gedeckt:** lokal das laufende Jahr holen, Dump nach Hetzner, dort `--historie --von 2018-01-01` — es werden nur die noch fehlenden Zeiträume eingereiht.

Bis zum 26.07.2026 galt das **nicht**: `historie_einreihen()` benutzte `ON CONFLICT DO NOTHING` und hing damit am Eindeutigkeitsindex, der **partiell** ist (`WHERE erledigt_am IS NULL`). Erledigte Posten blockierten nichts — nachgemessen: fünf Tage einreihen, erledigen, erneut einreihen ergab **zehn** Posten statt fünf. Genau beim Umzug auf den Server wäre das aufgeschlagen und hätte das ganze lokal geholte Jahr ein zweites Mal gegen LINA laufen lassen. Korrigiert in `migrations/0005_sync.sql`, `sync.historie_einreihen()`.

Fortschritt ansehen:

```sql
SELECT * FROM mart.backfill_fortschritt;
```

### Was ein Lauf aushält

Ein einzelner Posten darf scheitern, der Lauf nicht. Belegt durch einen Test, der dem laufenden Worker mitten im Betrieb die Postgres-Verbindungen abschießt (`pg_terminate_backend`): der Lauf erholt sich und arbeitet alle Posten ab.

* Transiente Verbindungsfehler werden dreimal wiederholt (250 ms, 500 ms). Nur Fälle, in denen die Anweisung den Server nachweislich nie erreicht hat — ein Constraint-Verstoß schlägt weiterhin durch.
* Jeder Posten ist einzeln gekapselt. Was durchrutscht, gibt die Reservierung frei und zählt als Fehler in Folge; nach `ABBRUCH_NACH_FEHLERN` (10) stoppt der Lauf bewusst.
* Wegbrechende Leerlaufverbindungen werden protokolliert statt den Prozess zu beenden — ein `error`-Ereignis ohne Zuhörer ist in Node ein Absturz.

Vorher war nur `laden()` geschützt. Am 26.07.2026 starb ein Lauf nach 16 erfolgreichen Posten an einem Verbindungsfehler beim Quittieren — bei zwölf Tagen Backfill wäre das ein täglicher Abbruch gewesen.

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

Reiht rückwärts ein, der jüngste Zeitraum zuerst. Fortschritt: `SELECT * FROM mart.backfill_fortschritt;`

## Noch zu messen

Wie weit LINA tatsächlich zurückreicht, ist ungeklärt. Ein paar lesende Aufrufe (`getKennzahlen` für 2019/2020/2021, `getUmsatzbericht` für einen frühen Tag) klären das. Bis dahin ist `2018-01-01` eine Annahme — Zeiträume ohne Daten quittiert der Importer sauber als `keine_daten`, das schadet also nichts außer ein paar Aufrufen.
