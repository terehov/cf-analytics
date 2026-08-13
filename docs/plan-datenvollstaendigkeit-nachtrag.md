# Nachtrag zum Plan Datenvollständigkeit — Befunde aus dem Review vom 13.08.2026

> **Stand 13.08.2026 abends: alles hier ist umgesetzt** — Phase 1c
> (`d948770`), 2.6 (`eca5a8a`), 2.5/2.7 (`def6a73`), 2.4/2.8/2.9 (`eb546e8`),
> 2.1–2.3 (`b8475e6`). Zwei Punkte hat die Messung dabei widerlegt: §2.8
> (`fn:betriebe` hält die fehlende Restaurantliste NICHT — es war ein
> Apostroph in `core.name_norm()`) und die Begründungszahlen von 2.1/2.3
> (beide Artefakte ihres eigenen Fensters). Und zwei Punkte sind bewusst
> anders gebaut als hier beschrieben: die Nachholäufe in 2.6 und 2.2 sind
> **keine Handbefehle** geworden, sondern Obergrenzen im Nachtlauf —
> Begründung in `entscheidungen.md`.

Ergänzt `docs/plan-datenvollstaendigkeit.md`, ersetzt ihn nicht. Anlass: ein
unabhängiges Review der Phase-1-Implementierung (Zählkette, Paginierung,
Wiederbelebung) plus zwei Kreuzproben — definierte Endpunkte gegen automatische
Einreihung, Metabase-Karten gegen laufenden Zulauf. Alle Zahlen am 13.08.2026
lesend in Produktion gemessen (Metabase-API), während Lauf 89 lief.

**Was das Review bestätigt hat:** die Phase-1-Mechanik wirkt. 0 abgeschnittene
Inventuren, Bestellungen ohne Position von 322 auf 47, 0 endgültig aufgegebene
Posten, Belegzulauf wiederhergestellt. Die drei Befunde unten sind kein
Rückbau, sondern Lücken, die die neue Mechanik selbst mitgebracht hat (N1, N2)
oder die erst durch die Messung sichtbar wurden (2.6).

---

## Phase 1c — Nachtrag zu Phase 1: zwei Konstruktionsfehler der neuen Mechanik

Beide klein, beide vor Phase 2, weil sie dieselbe Eigenschaft haben wie die
Phase-1-Befunde: sie verlieren Daten bzw. terminieren nie, und beides sieht
hinterher plausibel aus.

### N1 · Folgeseiten-Sperre macht die zweite Inventur-Reparatur verlustig

**Der Fehler.** `inventurpositionenNachziehen()` sperrt richtig nur gegen
OFFENE Posten (`nachfuellen.ts:275`). Die Folgeseiten ab 2 laufen aber über
`folgepostenEinreihen()`, das gegen ALLE Posten sperrt — auch erledigte
(`foodnotify/laden.ts:449`), und `sync.warteschlange` wird nie aufgeräumt, die
Sperre ist also dauerhaft. Beim ZWEITEN Reparaturzyklus einer Inventur mit
mehr als 800 Positionen löscht Seite 1 den ganzen Bestand, schreibt 800
zurück, und Seite 2 wird nie wieder eingereiht: der erledigte Zwilling
`{uuid, seite:'2'}` aus dem ersten Zyklus blockiert. Ergebnis: wir halten 800
statt z. B. 1.426, die Invariante bleibt ungleich, und der nächste Lauf
wiederholt Löschen und Neuladen von Seite 1 — jede Nacht, für immer.

Der erste Zyklus am 13.08.2026 ist nur deshalb gut gegangen, weil die alten
Posten `{uuid}` trugen und die neuen `{uuid, seite}` — ein einmaliger
Formatwechsel, kein Schutz.

**Exponiert:** genau die 9 Inventuren über 800 Positionen (Maximum 1.426,
gemessen). Jede Kopfänderung in FoodNotify (Position ergänzt oder gelöscht)
löst den Zyklus aus.

**Die Änderung.** `folgepostenEinreihen()` bekommt einen Sperrmodus:
`'alle'` (Standard, wie heute) oder `'offen'`. Die Folgeseiten von
`fn:inventurpositionen` nutzen `'offen'` — innerhalb eines Zyklus reicht das,
weil Seite 1 die Folgeseiten in DERSELBEN Transaktion einreiht und sie bis zur
Abarbeitung offen sind. Alles andere bleibt bei `'alle'`:
`fn:bestellungen`-Seiten und die Bestelldetails sperren absichtlich dauerhaft
(die Auffrischung der Details regelt 2.6 mit eigenem Takt, nicht diese Sperre).

**Test, der den Fehler künftig fängt:** zweiter Reparaturzyklus im Mock —
erledigte Posten `{uuid, seite:'2'}` vorbelegen, Kopfzahl ändern, Nachziehen
laufen lassen, danach MUSS ein frischer Seite-2-Posten stehen und der Bestand
wieder der Kopfzahl entsprechen.

**Budget:** keins. Folgeseiten entstehen nur in echten Reparaturzyklen
(ceil(n/800)−1 Aufrufe je reparierter Inventur).

**Kein Schema.** Sichtbarkeit gibt es schon: ein hängender Zyklus steht in
`mart.inventur_abgeschnitten` und der Prüfübersicht.

### N2 · Schrumpfende Belegordner konvergieren nie

**Der Fehler.** Die Abzugsbedingung ist bewusst UNGLEICH statt KLEINER — aber
der Abzug kann einen geschrumpften Ordner nicht reparieren: `belegeSchreiben()`
ist ein reiner Upsert, in LINA gelöschte Belege bleiben bei uns stehen. Ab dem
ersten in LINA gelöschten Beleg gilt dauerhaft `gehalten > gezaehlt`, und der
Lauf holt den vollen Ordner jede Nacht neu (bis 8,2 MB), ohne dass sich je
etwas ändert. Der Zustand pendelt zwischen „abzug eingereiht" und „abzug
fehlt" — Letzteres zählt als auffällig, sagt aber das Falsche: der Abzug fehlt
nicht, er ist wirkungslos.

**Gemessen:** unter den bis dahin fertig gezählten 878 Paaren noch kein Fall.
Das ist eine Frage der Zeit, kein Akutproblem — LINA löscht selten, aber es
kommt vor (die Migration 0069 nennt den Fall selbst als Auslöser).

**Die Änderung.** Nach einem vollen Abzug werden die Belege des Paars
`(betrieb_key, typ_id)` gelöscht, deren `lina_id` NICHT in der Antwort steht —
in derselben Transaktion wie der Upsert. Die Antwort IST der vollständige
Ordner (die `recordsTotal`-Prüfung garantiert das), dieselbe Logik wie bei
`core.bestellposition` und `core.inventurposition`: Ersetzen statt ewig
anhäufen. `core.buchungsbeleg_steuer` hängt per `ON DELETE CASCADE` dran
(0053), nichts bleibt verwaist.

Zwei Randfälle, beide geprüft:

* **Ein Beleg wechselt den Ordner.** Der Upsert-Schlüssel ist
  `(betrieb_key, lina_id)`; der Abzug des NEUEN Ordners setzt `typ_id` um,
  danach trifft ihn die Löschbedingung des alten Ordners nicht mehr. Läuft der
  alte Ordner zuerst, wird er dort gelöscht und vom neuen Abzug neu
  geschrieben — die Zählung des neuen Ordners reiht den nach. Konvergiert in
  höchstens zwei Nächten.
* **Archivierte Belege.** Die Liste enthält sie (Feld `archived` kommt in den
  Zeilen mit), die Gleichheit über alle 621 Ordner ist der Beweis. Sie werden
  also nicht fälschlich gelöscht.

**Sichtbar machen, nicht nur tun:** die Löschzahl wird geloggt UND als
Warnung gewertet, wenn sie groß ist — mehr als 5 % eines Ordners in einer
Nacht ist keine Pflege mehr, sondern ein Befund (LINA räumt auf, oder die
Antwort war doch unvollständig; dann lieber stehen lassen und werfen).
Konkreter Schwellwert im Code, mit dieser Begründung als Kommentar.

**Test:** zweiter Abzug desselben Ordners im Mock mit einer fehlenden
`lina_id` → Zeile weg, Steuerzeilen weg, Zählung konvergiert; und ein Abzug
mit >5 % Schwund → wirft, nichts gelöscht.

**Budget:** negativ — der Fix SPART Aufrufe (heute: unendlich viele
Nachtabzüge ab dem ersten gelöschten Beleg).

### N3 · Prüfsichten-Hygiene (eine Migration, 0071)

Drei kleine Unehrlichkeiten, zusammen eine Migration:

1. **„seit über 36 h nicht gezählt"** zählt auch Paare von Betrieben, deren
   Ladenakte gar kein Belegarchiv hat (`keine_daten`). Heute 0 solche Fälle
   unter 1.252 Zählungen — wenn der fertige Lauf 89 welche zeigt, blieben sie
   für immer rot, und eine Kachel, die immer rot ist, sieht niemand mehr an.
   Die Zeile klammert Paare aus, deren jüngste `la:belegzahl`-Aufgabe
   `keine_daten` war, und führt sie als eigene Zeile „Betrieb ohne
   Belegarchiv" (Erwartung: konstant, jede Änderung ist ein Befund).
2. **`mart.posten_aufgegeben`** verdrahtet `wiederbelebt >= 3`, `status.ts`
   liest `MAX_WIEDERBELEBUNGEN` aus der Umgebung. Beides auf die 3 festnageln:
   Kommentar an beiden Stellen aufeinander verweisen lassen und ein Test, der
   den config-Default gegen 3 prüft — wer den Wert ändert, findet über den
   roten Test die Sicht. (Eine Sicht kann keine Env lesen; die Alternative —
   eine Einstellungstabelle — wäre mehr Bau als das Problem verdient.)
3. **„abzug fehlt"** heißt nach N2 wieder, was es sagt. Der Sichtkommentar
   wird entsprechend geschärft (heute erklärt er den wirkungslosen Abzug
   nicht).

**Danach nachprüfbar (Phase 1c gesamt):** der Zweite-Zyklus-Test ist grün; ein
künstlich geschrumpfter Ordner konvergiert im Test in einem Abzug; die
Prüfübersicht zeigt nach dem Nachtlauf 0 in „Ordner ohne fälligen Abzug" UND
0 in „36 h" (statt heute 788 mitten im Lauf).

---

## Ergänzungen zu Phase 2 — Rückwirkung und Takt

Die bestehenden Punkte 2.1–2.5 bleiben. Neu bzw. geschärft:

### 2.6 · Bestelldetails altern nie nach (der größte neue Befund)

**Gemessen:** alle 66.966 Bestellungen wurden GENAU EINMAL im Detail geholt,
keine einzige je erneut (`sync.aufgabe`, `fn:bestellung`, distinct orderId:
66.966, mehrfach: 0). 15.478 stehen seit über 30 Tagen auf `pending`, 46.052
auf `imported`. Der Listen-Upsert frischt nur `status` auf — und nur, solange
die Bestellung auf der LETZTEN Seite ihrer Kostenstelle steht. Liefermengen
(`adjustedQuantity`), Lieferdatum und Preisstände sind auf dem Stand des
ersten Abrufs eingefroren. Der Transform liest `adjustedQuantity` bereits
korrekt (`transform.ts:324`) — es fehlt nur der erneute Abruf.

**Die Änderung, zweistufig:**

* **Rollierendes Fenster im Nachtlauf:** `foodnotifyNachfuellen()` reiht
  Details (`fn:bestellung` + `fn:bestellpositionen`) für alle Bestellungen
  der letzten 45 Tage mit nicht-finalem Status neu ein. Gemessen sind das
  2.989 Bestellungen → **~6.000 Aufrufe je Nacht** (von 140.000; heute
  verbraucht der Lauf ~200). Sperre wie bei der Wiederbelebung: kein offener
  Zwilling UND kein erledigter Posten derselben Parameter jünger als 20
  Stunden — NICHT die Alle-Posten-Sperre, die ist genau das Problem.
  Priorität 30: hinter LINAs Tagesdaten (10) und dem Stammdaten-Abgleich (20),
  vor dem Backfill (89/90). Die Positionslader ersetzen den Stand komplett
  (DELETE + INSERT), Auffrischen ist also von Haus aus idempotent.
* **Einmaliger Nachholauf** für den eingefrorenen Altbestand, neben dem
  Nachtlauf (wie die Phase-1-Backfills): 12 Monate zurück sind 22.581
  Bestellungen → **~45.200 Aufrufe**, auf zwei Nächte verteilt je ~23.000
  (16 % des Tagesbudgets). Der Nachholauf ist zugleich die MESSUNG für die
  offene Frage, wie oft sich alte Bestellungen überhaupt noch ändern: vorher
  Status-Verteilung sichern, nachher differenzieren — daraus ergibt sich, ob
  der lange Schwanz (45 Tage bis 12 Monate) einen Wochentakt braucht oder
  Ruhe hat.

**Sichtbar machen:** eine Prüfzeile „Bestellungen: Details älter als 48 h bei
nicht-finalem Status im Fenster" (Erwartung: 0 nach jedem Nachtlauf). Ohne sie
sähe ein stiller Ausfall der neuen Einreihung wieder genauso aus wie „nichts
zu tun".

**Entscheidung nötig (Eugene):** Tiefe des Nachholaufs — 12 Monate
(empfohlen, 45.200 Aufrufe) oder der ganze nicht-finale Bestand (63.604
Bestellungen, ~127.000 Aufrufe, über drei Nächte). Und: gilt `imported` als
final? Die Messung aus dem Nachholauf beantwortet das; bis dahin zählt es als
nicht-final (konservativ).

### 2.7 · Der Wächter aus 2.5, erweitert um zwei tote Pfade

Beim Review bestätigt, gleiche Bauart wie die `monat`-Falle:

* `sync.warteschlange.betrieb_enc_id` hat KEINEN Producer — der
  `storeId`-Zweig im Worker (`worker.ts:534`) ist toter Code. Ein aktivierter
  Betriebs-Endpunkt (`getReport:97`) liefe ohne `storeId` los, ohne Fehler.
* Der LINA-Dispatch (`sync/laden.ts:759`) hat einen stillen `default: break` —
  was durchrutscht, schreibt raw, meldet „ok" und transformiert nichts.

Der Wächter aus 2.5 prüft deshalb beim Nachfüllen DREI Invarianten statt
einer: jeder aktive Endpunkt hat (a) einen Einreihzweig für seine
Schrittweite, (b) einen Dispatch-Case, (c) falls `ebene: 'betrieb'`, einen
Producer für `betrieb_enc_id`. Verletzung wirft — beim Deploy, nicht nach
Monaten im Stillen.

### 2.8 · `fn:betriebe` erreicht core nie (schärft 2.4)

Monatlich geholt, aber im Loader fällt es in den `default:`-Zweig — nur raw.
Die Restaurantliste, die die 25 Kostenstellen ohne `betrieb_key` zuordnen
könnte, liegt seit Wochen ungenutzt in `raw.api_antwort`. 2.4 bekommt deshalb
einen dritten Satz: `fn:betriebe` einen echten Lader-Case geben, DANN die
beiden vorhandenen Zuordnungsfunktionen (`manual.betrieb_vorschlaege_berechnen`,
`betrieb_zuordnung_anwenden`) als Nachlauf anschließen. Reihenfolge zwingend —
die Funktionen arbeiten auf dem, was der Case schreibt.

### 2.9 · Neue Betriebe warten bis zu einen Monat auf ihre Zählung

`lina_betrieb_id` kommt ausschließlich aus der monatlichen
`analyticsFilterOptions`-Momentaufnahme (Namens-Join). Ein neu eröffneter
Betrieb steht also bis zu vier Wochen ohne Belegarchiv-Zählung da — genau der
Fall „neuer Betrieb fällt stumm heraus", den 0069 für die Ordner gelöst hat,
eine Ebene höher. Fix: den Endpunkt wöchentlich statt monatlich einreihen
(Kosten: +3 Aufrufe im Monat). Der Takt hängt wie überall am Zeitraum.

### Zu 2.1/2.2 (Kennzahlen), aus dem Review geschärft

Der Handbefehl repariert den Jahreswechsel NICHT: `sync.historie_einreihen()`
prüft gegen alle Posten, der erledigte Jahresposten `2026-01-01/…-12-31`
blockiert, `--historie` liefert 0. Der Weg an der Funktion vorbei (2.2) muss
also auch den JAHRES-Posten abdecken, nicht nur Monate. Das rollierende
Fenster in 2.1: laufendes Jahr immer, Vorjahr zusätzlich bis einschließlich
August (gemessene Rückbuchungstiefe: sieben Monate, plus ein Monat Reserve).

---

## Ergänzungen zu Phase 3 und 6 — nur Prioritäten, keine neuen Punkte

Die Karten-Kreuzprobe hat die Handpflege-Befunde (§1.9) mit Referenzzahlen
unterlegt; die Reihenfolge in Phase 6 ergibt sich daraus:

| Objekt | hängt an | Zulauf |
|---|---|---|
| `manual.om_einschaetzung` (endet Juni) | `round_table_monat` — 42 Referenzen, meistgenutzte Sicht | Excel-Skript auf Zuruf |
| `manual.betrieb_standort` / `betrieb_fremd_id` | 28 Artikelverkaufs-, 9 Standort-, 8 Nachbarschaftskarten | `bun yext:zuordnen` auf Zuruf |
| `manual.lieferant_freigabe` / `gfgh_betrieb` / `lieferant_art` | `mart.fremdeinkauf` — 18 Referenzen | Seeds aus 0055/0058 |
| `manual.ursache` / `massnahme` / `betrieb_hauptkonzept` | 13 + 5 + 4 Referenzen | **gar keiner** |
| `sync.fortschritt` | 2 Sichten + `health.ts` | **gar keiner** (Phase 3.4 bestätigt) |

OM-Einschätzung zuerst (Entscheidung 2 des Hauptplans), dann die
Yext-Zuordnung neuer Betriebe, dann der Rest über den einen Importweg aus
Phase 6.

---

## Reihenfolge und Abhängigkeiten

1. **Phase 1c** (N1, N2, N3) — klein, stoppt latenten Datenverlust, keine
   Entscheidungen nötig. Ein Deploy, Migration 0071, danach Nachher-Messung
   am nächsten Nachtlauf.
2. **Phase 2** wie im Hauptplan, plus 2.6–2.9. Vor 2.6 die eine Entscheidung
   (Tiefe des Nachholaufs). 2.6 zuerst innerhalb der Phase — es ist der
   einzige Punkt, an dem heute laufend falsche Zahlen in den Einkaufssichten
   stehen (Bestellmengen statt Liefermengen).
3. Phasen 3–6 unverändert, mit den Prioritäten oben.

## Entscheidungen (ergänzt die vier des Hauptplans)

5. **Nachholauf-Tiefe für Bestelldetails:** 12 Monate (~45.200 Aufrufe, zwei
   Nächte — Empfehlung) oder ganzer nicht-finaler Bestand (~127.000, drei
   Nächte)?
6. **Entscheidung 3 des Hauptplans, jetzt mit Zahlen** (Stand 63 % der
   Zählung): 308 Ordner, 17.301 Belege — sonstige Dokumente 6.028,
   USt-Voranmeldungen 3.469, sonstige Auswertungen 3.416, OPOS-Listen 3.382,
   Steuerunterlagen 692, Mahnungen 314. Wareneinkauf steckt da nach Namen
   nicht drin; Empfehlung unverändert: nicht holen, Zählung läuft ja weiter
   und meldet, wenn dort plötzlich Volumen entsteht.
