# Fehlerkatalog

Jeder Fehler, der in diesem Projekt gefunden wurde — Symptom, Ursache, und was ihn heute
verhindert. Chronologie steht in `entscheidungen.md`; hier ist nach **Fehlerklasse** sortiert,
weil sich die Klassen wiederholen und die Ursache das ist, was man wiedererkennen können muss.

**Das durchgehende Muster: fast keiner dieser Fehler hat sich gemeldet.** Kein Stacktrace, keine
Warnung, kein roter Test. Nur eine Zahl, die plausibel aussieht und falsch ist, oder eine Tabelle,
die leer bleibt, während der Import „ok" meldet. Wer hier arbeitet, sollte diese Liste einmal
gelesen haben, bevor er einer Zahl glaubt.

> **Neuen Fehler gefunden? Er gehört hier hinein**, bevor der Fix committet wird. Ein Fehler,
> der nur in einer Commit-Nachricht steht, ist für den nächsten Agenten nicht auffindbar —
> genau deshalb gibt es diese Datei seit dem 26.07.2026 überhaupt.

---

## 1. Stille Datenverluste

Die gefährlichste Klasse. Der Posten meldet `ok`, die Zieltabelle bleibt leer oder falsch.

### Die BWA fand ihren Betrieb nicht — 7.860 Zeilen fielen durch

**Symptom.** Erster echter Import: `core.kennzahlen_monat` blieb leer, obwohl beide
`getKennzahlen`-Posten `status = 'ok'` meldeten.

**Ursache.** `getKennzahlen` kennt Betriebe nur über eine **numerische** LINA-ID, alle anderen
Endpunkte nur über `encId`. `core.betrieb.lina_betrieb_id` war bei allen 141 Betrieben `NULL` —
`betriebeSichern()` schreibt nur `enc_id` und `name`, gefüllt hat das Feld niemand. Der Filter
warf jede Zeile weg. Die Transformation selbst war einwandfrei: 7.860 Zeilen, 131 Betriebe,
korrekte Werte.

**Heute.** `analyticsFilterOptions` liefert die Brücke (`{id, name}` für alle 141, im selben
ID-Raum wie `getKennzahlen` — 131 von 131 Schnittmenge nachgemessen). Der Lader füllt
`lina_betrieb_id` beim Laden dieses Endpunkts. `mart.betrieb_ohne_lina_id` ist die Kontrollsicht,
Erwartung: leer. Und der Lader schreibt eine **`error`-Zeile mit Handlungsanweisung**, wenn keine
einzige Zeile zugeordnet werden konnte — die Reihenfolge soll stimmen, aber ihr Bruch darf nicht
mehr leise sein.

### Die Warengruppen liefen zu früh — und wären einen Monat lang weg gewesen

**Symptom.** `core.artikel_warengruppe_stand` war leer. `mart.artikelverkauf.warengruppe`
überall `NULL`, `mart.deckungsbeitrag_warengruppe` ohne Gruppierung.

**Ursache.** `articleApi:franchise` ordnet Warengruppen **nur Artikeln zu, die `core.artikel`
schon kennt** — und der Katalog wird vom Artikelverkaufsbericht gefüllt. Der Posten lief am
26.07.2026 um **10:21**, als `core.artikel` noch leer war: 0 von 9.132 Zuordnungen, Status `ok`.

Die Priorität war korrekt gesetzt (`nachlauf`, nach den Tagesberichten) — nur half sie nicht: der
Tagesbericht des Vortags war selbst leer, weil LINA die letzten Tage noch nicht gefüllt hatte. Die
Artikel kamen erst Stunden später aus dem **historischen** Backfill, und der läuft mit Priorität 90.

**Warum das teuer gewesen wäre.** `articleApi` ist eine **monatliche** Momentaufnahme. Der nächste
Versuch wäre der 1. August gewesen — ein ganzer Monat ohne Sortimentsdimension, und rückwirkend
gibt es dafür keine zweite Chance, weil LINA keine Warengruppenhistorie führt.

**Heute.** Der Lader schreibt eine `error`-Zeile mit Handlungsanweisung, wenn keine einzige
Zuordnung entsteht, und eine Warnung, wenn auffällig wenige entstehen. Nach dem erneuten
Einreihen: **4.170 Zuordnungen**, 68,6 % des Artikelumsatzes haben eine Warengruppe. Die
restlichen 31,4 % sind Artikel, die im heutigen Katalog nicht mehr stehen — dafür ist der
Rückgriff in `core.artikel_warengruppe_zeitraum` da.

> Eine Priorität sichert die Reihenfolge, nicht die Voraussetzung. „Läuft nach X" heißt nicht
> „X hat etwas geliefert".

### Ein Bericht fiel in den `default`-Zweig und landete nur in `raw`

**Symptom.** `getAktionsbericht` wird seit dem ersten Lauf geholt. Posten `ok`, `zeilen: 0`,
und in `core` nichts. Von den 206 Backfill-Posten war einer gelaufen — der auch nichts schrieb.

**Ursache.** Im `switch` über die Endpunkte in `src/sync/laden.ts` gab es keinen `case` dafür.
Der `default`-Zweig ist absichtlich still — „noch keine Transformation, der Raw-Layer hat die
Daten trotzdem" — und genau deshalb sah der Ausfall nach nichts aus.

**Kein Datenverlust.** Der Raw-Layer hatte alles. Nachträglich transformieren ging ohne einen
einzigen LINA-Aufruf: `core.aktion` wurde per SQL aus `raw.api_antwort` gefüllt. Das ist der
Zweck des Raw-Layers, einmal eingelöst.

**Heute.** `transform.aktionsbericht()` löst die Kreuztabelle auf, `core.aktion` +
`core.aktionsumsatz_tag`, drei `mart`-Sichten. Beim ersten Lauf standen 205 von 206 Tagen
noch in der Warteschlange — sie laufen jetzt gegen einen Ladepfad, der sie auch schreibt.

> „Der Raw-Layer hat es ja" ist eine Versicherung, keine Auswertung. Ein Endpunkt ohne
> `case` bleibt still, bis jemand die Tabellen zählt.

### …und die Transformation dafür war aus einer leeren Antwort geraten

**Symptom.** Beim Nachtransformieren aus `raw`: `cannot cast jsonb object to type numeric`.

**Ursache.** Die Transformation nahm an, eine Zelle sei eine Zahl. Sie ist ein Objekt:

```json
"cells": {"12": {"revenue": 798.15, "percent": 8.73}}
```

Gebaut war sie gegen die **einzige** Antwort, die zu dem Zeitpunkt im Bestand lag — den
25.07.2026, an dem alle 423 Zellen auf `null` standen. **Aus einer leeren Antwort lässt sich
die Struktur der gefüllten nicht ablesen.** `Number({…})` ist `NaN`, die Transformation hätte
also jede Zelle verworfen: null Zeilen für jeden gefüllten Tag, Status `ok`. Genau der
Ausfall, den der `case` beheben sollte, eine Ebene tiefer und mit einem grünen Test daneben.

**Die Strukturprüfung hatte recht.** `sync.schema_abweichung` bekam 26 Einträge, geschrieben
in derselben Viertelstunde — das Schema stand auf `z.number()`. Der Mechanismus hat den
Irrtum sofort gemeldet; angesehen hat sie in dem Moment niemand. Gefunden wurde er stattdessen
durch einen Postgres-Fehler beim Nachziehen.

**Nebenbei gewonnen.** LINA liefert den Anteil am Netto-**Tages**umsatz gleich mit. Über alle
946 gefüllten Zellen gegen `core.umsatzbericht_tag` geprüft: **0 Abweichungen**. Gespeichert
wird LINAs Wert, nicht der nachgerechnete — dieselbe Regel wie bei `durchschnittsbon` und
`kennzahlen_monat.wert_prozent`.

**Heute.** Migration `0017`, `anteil_pct` in `core.aktionsumsatz_tag`, das Schema kennt die
Objektform, und die Fixture trägt beide Formen. Aus `raw` nachgezogen: **946 Zeilen, 60.021 €
Aktionsumsatz über 27 Tage** — ohne einen einzigen LINA-Aufruf.

> Eine leere Antwort ist kein Muster. Wer die Struktur aus dem Fall ohne Daten ableitet,
> beschreibt die Verpackung und nicht den Inhalt.

### Eine Tabelle mit Kommentar, mit Zweck — und ohne einen einzigen Schreiber

**Symptom.** `core.bwa_buchungsstand`: 0 Zeilen. `grep -r bwa_buchungsstand src/` ohne Treffer.

**Ursache.** Die Tabelle steht seit `0003` im Schema, mit einem Kommentar, der genau erklärt,
wozu sie da ist, und `docs/lina-api-korrekturen.md` beschreibt seit Phase 1, warum es sie
braucht. Nur schrieb nie jemand hinein. Derselbe Befundtyp wie bei der Markenebene: Absicht
vollständig dokumentiert, Umsetzung fehlt.

**Warum sie gebraucht wird.** `getKennzahlen` liefert ohne volle BWA-Rechte **stillschweigend
Nullen statt eines Fehlers**. Die naheliegende Gegenprobe „Null-Quote über X % ⇒ Alarm" geht
nicht, weil eine hohe Null-Quote der Normalfall ist. Gemessen am 26.07.2026 über 141 Betriebe:

| Zustand | Betriebe |
|---|---|
| auf Höhe der Spitze (Juni 2026) | 23 |
| im Rückstand, davon 8 mehr als einen Monat | 46 |
| nie eine BWA gebucht | 62 |
| in keiner `getKennzahlen`-Antwort aufgetaucht | 10 |

**Beim Bauen selbst hineingetappt.** Die erste Fassung der Kommentare nannte „72 von 141 haben
nie eine BWA". Die Zahl stammte aus einer Abfrage mit `LEFT JOIN`, die NULL für „kam vor, nie
gebucht" **und** für „kam gar nicht vor" liefert — also genau die Unterscheidung nicht machte,
um die es in der Tabelle geht. Richtig sind 62 und 10. Korrigiert in Migration `0016`.

**Heute.** `src/sync/laden.ts` schreibt den Stand nach jedem `getKennzahlen`-Posten,
`mart.bwa_rueckstand` wertet ihn aus, und `/status` prüft die **Spitze** — nicht die Zahl der
Nachzügler. Ein Alarm auf Nachzügler wäre dauerhaft gelb, und eine dauerhaft gelbe Ampel liest
nach zwei Wochen niemand mehr.

> Wer drei Zustände in zwei Werte presst, misst am Ende seinen eigenen Filter. Genau der
> Fehler, den die Tabelle verhindern soll — und er ist beim Bauen dieser Tabelle passiert.

### Die Markenebene war vollständig gebaut — und wurde nie geladen

**Symptom.** `SELECT * FROM mart.konzept_zuordnung` meldete für **alle 141 Betriebe**
„LINA kennt kein Konzept". Jeder Markenschnitt leer, und das Marken-Dashboard ist der Einstieg
der ganzen Drill-Down-Kette.

**Ursache.** `core.konzept` und `core.betrieb_konzept` gibt es seit der ersten Migration, dazu
`mart.konzept_zuordnung`, `mart.konzept_schnitt()`, `mart.round_table_marke()` und ein eigener
Abschnitt in `datenmodell.md` über die n:m-Modellierung. Nur: **kein einziger Ladepfad schrieb je
in diese Tabellen.** Die Dimension war durchdacht, dokumentiert, mit Sichten versehen — und leer.

Die Daten lagen dabei längst da. Beide Endpunkte werden seit dem ersten Tag geholt:

| | liefert | Feld |
|---|---|---|
| `analyticsFilterOptions` | die 14 Marken | `gruppen[] = {id, name}` |
| `getKennzahlen` | **wer dazugehört** | dreistufig: `groups[].key = 'group_4'` → `children[].key` |

**Heute.** `transform.konzepte()` und `transform.betriebKonzepte()`, geladen aus genau diesen
beiden Antworten. Verbunden wird über **Zahlen, nicht über Namen**: `group_4` trägt dieselbe `id`,
die `analyticsFilterOptions` als 4 meldet — für alle 14 Gruppen gegengeprüft. Zeigt eine
Zuordnung ins Leere, wird das als Warnung protokolliert statt still gefiltert; dieselbe Lehre wie
bei der BWA-Brücke.

**Nebenbei beantwortet:** `datenmodell.md` führte seit `0005` die offene Frage, ob die Zuordnung
1:n oder wirklich n:m ist, samt Prüfabfrage „sobald Betriebe geladen sind". Die Messung an der
echten Antwort: **131 Zuordnungen auf 131 Betriebe, keiner in mehreren Gruppen.** Die Annahme
„faktisch 1:n" ist bestätigt. Die n:m-Tabelle bleibt trotzdem — sie kostet nichts, und eine
1:n-Spalte, die einen echten Mehrfachfall nicht abbilden kann, kostet eine Migration unter
Zeitdruck.

> Eine Tabelle, die niemand füllt, sieht genauso aus wie eine, für die es keine Daten gibt.
> Der Unterschied fällt erst auf, wenn jemand die Auswertung öffnet.

### Dieselbe Kette, zweiter Anlauf: die Reihenfolge war Zufall

**Symptom.** Beim ersten Lauf gegen die frisch aufgesetzte Datenbank lag `getKennzahlen` auf
Posten 9 und `analyticsFilterOptions` auf Posten 12 — die Brücke wäre wieder zu spät gekommen.

**Ursache.** Alle Posten hatten dieselbe Priorität, danach entscheidet die `posten_id`, also die
Einfügereihenfolge. Eine harte Abhängigkeit hing an einer Zufälligkeit.

**Zwischenfehler beim Beheben.** Der erste Fix zog `analyticsFilterOptions` ganz nach vorn — und
war damit auch falsch: auf einer leeren Datenbank gibt es noch keinen Betrieb, dem man eine ID
anheften könnte. Ergebnis in Zeile eins des Laufs: 334 Feinsparten geschrieben, **null**
Betriebszuordnungen. Die Kette ist dreistufig, nicht zweistufig.

**Heute.** `einreihPrioritaet()` in `src/lina/endpunkte.ts`, fünf Tests halten sie fest:

| Stufe | Endpunkt | braucht vorher |
|---|---|---|
| 10 | Tagesberichte | — legen die Betriebe an (`encId`) |
| 12 | `analyticsFilterOptions` | die Betriebe; liefert deren numerische ID |
| 14 | `getKennzahlen` | die numerische ID |
| 20 | übrige Momentaufnahmen | `core.artikel` (für `articleApi:franchise`) |

### Der Round Table gab Entwarnung, weil noch nichts gebucht war

**Symptom.** September bis Dezember 2026 standen für alle 131 Betriebe auf **grün**.

**Ursache.** `getKennzahlen` liefert immer das ganze Jahr, auch die Monate, die der Steuerberater
noch nicht gebucht hat. Die kommen mit `0,00` zurück — **nicht** als `NULL`. Der Filter
`wert_prozent IS NOT NULL` ließ sie durch, und weil sie die jüngsten sind, gewannen sie als
„jüngster BWA-Stand". 0 % Personalkosten ist „niedriger ist besser" und damit grün.

**Heute.** „Gebucht" heißt: irgendein Wert ist ungleich null.

```sql
HAVING count(*) FILTER (WHERE wert_absolut IS NOT NULL AND wert_absolut <> 0) > 0
```

### …und dieselben Monate standen trotzdem noch als Zeile da

**Symptom.** `mart.round_table_monat` lieferte August bis Dezember 2026 — 141 Betriebe je Monat,
ohne Umsatz, mit dem BWA-Stand vom Mai. Niemand sieht so einer Zeile an, dass sie in der Zukunft
liegt.

**Ursache.** Der Fix darüber verhinderte, dass diese Monate zum *Maßstab* werden, nicht dass sie
überhaupt erscheinen. Die Monatsliste kam ungefiltert aus `core.kennzahlen_monat`.

**Heute.** Die Monatsliste kommt aus POS-Umsatz und **gebuchten** BWA-Monaten. Bewusst kein
Vergleich gegen `current_date`: das wäre eine zweite Wahrheit neben den Daten und in einer per
`pg_dump` wiederhergestellten Datenbank sofort falsch — und genau dieser Weg ist für den Umzug
nach Hetzner geplant.

### `mart.kennzahlen_aktuell` warf alle Euro-Beträge weg

**Symptom.** 7.860 Zeilen, davon 7.860 mit Prozentwert und **null** mit Euro-Betrag.
`mart.pruefung_wareneinsatz` war damit still wirkungslos — sie rechnet mit Euro.

**Ursache.** LINA liefert Euro und Prozent aus zwei Aufrufen (`mode=absolut`, `mode=relativ`), die
als zwei Zeilen mit unterschiedlichem `abgerufen_am` ankommen, jede mit genau **einer** gefüllten
Spalte. `DISTINCT ON (…) ORDER BY abgerufen_am DESC` nahm davon nur eine, nämlich die später
geholte. `relativ` lief 35 Sekunden nach `absolut`.

**Heute.** Je Spalte der jüngste nicht-leere Wert. Die Rohtabelle bleibt unangetastet, die
Zeitreise über `abgerufen_am` also erhalten.

### Der Wareneinsatzansatz wurde nie gefunden

**Symptom.** `wareneinsatz_theoretisch` wäre für die allermeisten Monate `NULL` geblieben — und
ein `NULL` sieht dort aus wie „kein Ansatz hinterlegt", nicht wie „falsch verknüpft".

**Ursache.** `mart.deckungsbeitrag_warengruppe` suchte den Artikelstand mit
`stand.monat = date_trunc('month', tag)`. Geschrieben wird der Stand aber **nur bei Änderung** —
ein unveränderter Artikel braucht keine 60 identischen Zeilen.

**Heute.** `core.artikel_stand_zeitraum` und `core.artikel_warengruppe_zeitraum` übersetzen die
Punktfolge in Gültigkeitszeiträume. Der Join ist ein Bereichsvergleich und kann nicht mehr
danebengehen. Begründung und Join-Muster: `datenmodell.md`, Entscheidung 8.

### „Gestern" holen heißt Nullen holen

**Symptom.** Die letzten vier Geschäftstage lieferten für alle 141 Betriebe glatt 0 €.

**Ursache.** LINAs Konzernberichte füllen sich über rund fünf bis sechs Tage. Gemessen am
26.07.2026: 22.–25.07. leer, 21.07. für 21 Betriebe, ab 17.07. stabil für 56. `--taeglich` holte
genau einen Tag — gestern. Und weil der Posten danach als erledigt gilt und `historie_einreihen()`
bewusst nichts Erledigtes noch einmal einreiht, wäre dieser Tag **für immer** auf null geblieben.
In der Umsatzkurve ein dauerhafter Einbruch der letzten Woche, jeden Tag aufs Neue.

**Heute.** Gleitendes Fenster über `NACHZUEGLER_TAGE` (10). Die Zieltabellen sind Upserts, der
zweite Abruf korrigiert den ersten. Messreihe und Rechnung: `importer.md`.

---

### Ein Rückfallmonat für alle Karten zeigte leere EBIT-Zahlen

**Symptom.** Die EBIT-Karte blieb leer, während die Karten daneben Zahlen zeigten. Kein
Fehler, keine Meldung — nur „No results".

**Ursache.** Alle Karten fielen ohne gesetzten Filter auf denselben Monat zurück: den
jüngsten mit einem Round-Table-Urteil, also Juli. Der Round Table trägt aber den jüngsten
*gebuchten* BWA-Monat in spätere Berichtsmonate nach (`bwa_monat`) und hat deshalb für Juli
ein Urteil, obwohl der Steuerberater den Juli noch nicht gebucht hat. Eine EBIT-Karte kann
das nicht — sie zeigt den Monat selbst, und der endet im Juni.

**Warum das gefährlich ist.** Eine leere Karte neben gefüllten liest sich als **„kein
EBIT"**, nicht als „noch nicht gebucht". Der Unterschied entscheidet, ob jemand beim
Steuerberater nachfragt oder eine Zahl für bare Münze nimmt.

**Heute.** Vier getrennte Rückfälle in `metabase/gemeinsam.ts`, je nach Datenreihe:
`MONAT_CTE` (Round Table), `MONAT_CTE_UMSATZ`, `MONAT_CTE_BWA` (nur gebuchte Monate),
`MONAT_CTE_WECHSEL`. Jede Karte nimmt den, der zu ihrer Quelle passt.

---

## 2. Der partielle Eindeutigkeitsindex — drei Fehler, eine Wurzel

```sql
CREATE UNIQUE INDEX warteschlange_offen_uq
    ON sync.warteschlange (endpunkt, coalesce(betrieb_enc_id,''), zeitraum_von, zeitraum_bis)
 WHERE erledigt_am IS NULL;
```

**Das `WHERE` ist der Punkt: ein ERLEDIGTER Posten blockiert nichts.** Wer sich beim Einreihen auf
`ON CONFLICT DO NOTHING` verlässt, reiht damit alles Erledigte erneut ein. Das hat dreimal
zugeschlagen, jedes Mal mit anderem Vorzeichen:

| Fall | Folge | Richtig ist |
|---|---|---|
| **Momentaufnahmen** liefen täglich statt monatlich | 7 Endpunkte × 30 Tage statt 7 Aufrufe im Monat | `WHERE NOT EXISTS` gegen **alle** Posten |
| **`historie_einreihen()`** war nicht idempotent | beim Umzug nach Hetzner wären alle 1.650 bereits geholten Posten aus 2026 ein zweites Mal gegen LINA gelaufen | `WHERE NOT EXISTS` gegen **alle** Posten |
| **Nachlauffenster** des täglichen Laufs | — | `ON CONFLICT DO NOTHING` ist hier **genau richtig** |

Der dritte Fall sieht aus wie ein Widerspruch und ist keiner: Für das Nachlauffenster *soll* ein
erledigter Tag erneut geholt werden, ein noch offener aber nicht doppelt eingereiht. Genau das
leistet der partielle Index. Dieselbe Mechanik, entgegengesetzte Absicht — wer eine der beiden
Stellen anfasst, muss wissen, welche der beiden Absichten dort gilt.

Nachgemessen statt angenommen, beide Male: erste Einreihung 1, Wiederholung 0, **nach Erledigung
1** — das letzte hätte 0 sein müssen. Fünf Tage einreihen, erledigen, erneut einreihen ergab
**zehn** Posten statt fünf.

Beide Regressionstests stehen im Ende-zu-Ende-Test, weil sich der Fehler **nur an einem bereits
erledigten Posten** zeigt. Eine Prüfung gegen einen frischen Posten hätte ihn nie gefunden.

---

## 3. Der Lauf stirbt, statt weiterzumachen

Voraussetzung für einen unbeaufsichtigten Backfill: ein einzelner Posten darf scheitern, der Lauf
nicht.

### Ein stummer Server legte den Worker still

**Symptom.** `getUmsatzbericht:speisen` stand über zehn Minuten „in Arbeit", während der Posten
davor 614 ms gebraucht hatte.

**Ursache.** Vier ungeschützte `fetch`-Aufrufe. `fetch` wartet von sich aus **unbegrenzt**.
Besonders übel im Zusammenspiel mit der Laufsperre: der hängende Lauf hält sie, jeder folgende
wird abgewiesen, und `sync.haengende_posten_freigeben()` läuft nur beim **Start** eines Laufs —
der nie zustande kommt. Der Importer wäre dauerhaft still, ohne dass es jemand merkt.

**Heute.** `ANFRAGE_TIMEOUT_MS` (60 s) auf jedem Aufruf. Ein Abbruch ist ein wiederholbarer
Fehler, der Posten kommt mit Wiedervorlage zurück.

### Ein Verbindungsfehler beim Quittieren tötete den Lauf

**Symptom.** Nach 16 erfolgreichen Posten: `Connection terminated due to connection timeout`, Lauf
tot. Bei zwölf Tagen Backfill ein täglicher Abbruch.

**Ursache.** Geschützt war nur `laden()`. Jeder andere Datenbankzugriff — die Statusschreibungen,
`protokoll()`, sogar der Fehlerpfad selbst — konnte den ganzen Lauf beenden.

**Heute.** Vier Ebenen, jede einzeln nachgewiesen:

* `pool.ts` wiederholt **transiente** Verbindungsfehler dreimal (250/500 ms) — bewusst nur Fälle,
  in denen die Anweisung den Server nie erreicht hat. Ein Constraint-Verstoß muss durchschlagen,
  sonst wird aus einem klaren Fehler ein langsamer.
* In `inTransaktion` wird nur das **Holen** der Verbindung wiederholt, nie der Transaktionsinhalt:
  der könnte schon geschrieben haben, und ein zweiter Durchlauf machte daraus stille Dubletten.
* Jeder Posten ist einzeln gekapselt; nach `ABBRUCH_NACH_FEHLERN` (10) stoppt der Lauf bewusst.
* Auch `posten_holen` selbst darf scheitern, ohne den Lauf mitzunehmen.

Nachgewiesen durch einen Test, der dem laufenden Worker mitten im Betrieb die Verbindungen
abschießt (`pg_terminate_backend`).

### `numeric(6,2)` war für eine Quote zu schmal — und riss den Raw-Layer mit

**Symptom.** 33 Posten `getPersonalkosten` scheiterten mit `numeric field overflow`.

**Ursache.** Die Quotenspalten standen auf `numeric(6,2)`, fassen also höchstens 9.999,99. Das ist
keine Reserve, sondern eine falsche Annahme über die Kennzahl: eine Quote ist Kosten durch Umsatz,
und der Umsatz geht bei den Karteileichen im Bestand gegen null — **79 der 141 geführten Betriebe
machen überhaupt keinen Umsatz** (`befunde-datenlage.md`).

**Und beinahe wäre die Begründung selbst ein Zirkelschluss geworden.** Als Beleg stand zuerst
„höchster Wert 9.079,37" in der Migration — das war aber der höchste Wert der *überlebenden*
Zeilen, also genau der Auswahl, die nicht am Überlauf gescheitert war. Nachdem die reparierten
Posten durchgelaufen waren, lag der tatsächliche Höchstwert bei **316.576,50 %**: Enchilada
Würzburg am 15.06.2026 bei **6,05 € Umsatz**. Das 35-Fache der alten Spaltengrenze.

> Wer aus den Daten argumentiert, die den Fehler überlebt haben, misst den Fehler nicht — er
> misst seinen Filter.

**Warum das schlimmer ist, als es aussieht.** `laden()` schreibt Rohantwort und `core` in *einer*
Transaktion. Scheitert die Transformation, rollt der Raw-Layer mit zurück — die Versicherung greift
also ausgerechnet dann nicht, wenn man sie bräuchte. Der überzählige Wert ließ sich hinterher
nicht einmal mehr nachsehen.

Und der Posten geht in Wiedervorlage: nach `MAX_VERSUCHE` (4) wäre er `aufgegeben` gewesen — 33
Tage Personalkosten dauerhaft weg, ohne Alarm, nur eine Lücke. Rechtzeitig aufgefallen, alle 33
standen erst bei Versuch 1.

**Heute.** `numeric(12,2)` für alle `pek_*`, `persoog_bwa` und `eff_*`, dazu für die
betriebsindividuellen Schwellen aus derselben Antwort. Die 33 Posten wurden mit `versuche = 0`
zurückgestellt: sie sind an uns gescheitert, nicht an LINA.

> Der Raw-Layer ist die Versicherung — aber nur gegen Fehler, die *nach* dem Commit auffallen.
> Gegen einen Constraint-Verstoß in derselben Transaktion schützt er nicht.

### Ein Anmeldefehler lief in einer Schleife — direkt gegen harte Regel 6

**Der teuerste Fehler, den dieser Code machen konnte.** Gefunden am 26.07.2026 beim Bauen der
Sperrbehandlung, nicht im Betrieb — er ist nie ausgelöst worden.

**Ursache.** `client.holen()` fing `AnmeldungFehlgeschlagen` ab und gab einen *gewöhnlichen*
Fehler zurück. Der Worker verbuchte den Posten als aufgegeben und ging zum nächsten. Dort war
`session.istAngemeldet` immer noch `false`, also wurde **erneut angemeldet** — bis
`ABBRUCH_NACH_FEHLERN` (10) erreicht war. Und der stündliche Zeitplan begann von vorn.

Zehn falsche Anmeldungen in Folge, stündlich, gegen ein Konto, das sich sperren lässt — bei genau
einem Zugang, den Concept Family bewusst nicht offiziell bekommt. Regel 6 verbietet exakt das,
und der Code tat es trotzdem.

**Heute.** Ein gescheiterter Anmeldeversuch setzt `anmeldungGescheitert`; jeder weitere Aufruf im
selben Prozess gibt sofort `gesperrt` zurück, ohne das Netz anzufassen. Der Lauf endet, und die
Sperre wird mit 24 Stunden Basisdauer in `sync.zugangssperre` geschrieben — hier hilft kein
Abwarten, sondern nur ein Mensch, der sich im Browser anmeldet und nachsieht. Ein Test misst
`mock.anmeldungen === 1`.

### Eine Sperre kostete zehn Posten je Lauf

**Ursache.** HTTP 403 galt als „nicht wiederholbar", also wurde der Posten als **`aufgegeben`**
quittiert. Das ist eine Falschaussage über die Daten: mit dem Zeitraum ist nichts verkehrt, nur
mit dem Zugang. Zehn Posten pro Lauf waren so dauerhaft verloren, und der nächste Lauf eine
Stunde später schickte dieselben zehn Anfragen gegen ein System, das gerade „nein" gesagt hatte.

**Heute.** 429, 403 und HTML-Abwehrseiten sind eine eigene Ergebnisart. Der Posten bleibt offen,
sein verbrauchter Versuch wird zurückgegeben (`versuche - 1`), der Lauf endet sofort, und die
Pause steht in der **Datenbank** — sonst wäre sie beim stündlichen Neustart wieder weg.

### `istTransient` kannte die Abschiedsmeldung des Servers nicht

**Symptom.** Der Ausfalltest schlug plötzlich fehl, nachdem eine Abfrage im Lauf weiter nach vorn
gerückt war — mit `terminating connection due to administrator command`.

**Ursache.** Die Liste der wiederholbaren Fehler kannte `Connection terminated` (die Meldung des
*Treibers*), aber nicht `terminating connection due to …` (die Meldung des **Servers**, etwa nach
`pg_terminate_backend`). Aufgefallen ist das nie, weil der erste Datenbankzugriff eines Laufs
zufällig spät genug kam: der Pool hatte die tote Verbindung bis dahin selbst aussortiert.

**Heute.** `/terminating connection/i` ist mit in der Liste. Semantisch unbedenklich: wenn der
Server die Verbindung abräumt, lief die Anweisung nicht zu Ende, ein Commit kann es nicht gegeben
haben.

> Ein Test, der nur bei bestimmter Reihenfolge grün ist, hat nichts bewiesen.

### Ein `error`-Ereignis ohne Zuhörer ist in Node ein Absturz

**Ursache.** `pg.Pool` gibt `error` aus, wenn eine gerade **unbenutzte** Verbindung wegbricht —
Netzhänger, Datenbankneustart, ein `pg_terminate_backend` vom Administrator. Ohne Zuhörer beendet
das den Prozess, und zwar an einer Stelle, die mit dem gerade bearbeiteten Posten nichts zu tun hat.

**Heute.** Zuhörer auf dem Pool **und** auf der eigenen Verbindung der Laufsperre.

### Ein abgestürzter Lauf wurde als `ok` verbucht

**Ursache.** Die Zeile, die den Status auf `teilweise` hochstuft, wird beim Werfen übersprungen,
und das `finally` schrieb den Anfangswert weg. In `mart.sync_status` stand ein Lauf mit
`status = 'ok'` und `aufgaben_fehler = 1`, obwohl er an einem Datenbankfehler gestorben war.

**Heute.** `fehlgeschlagen` mit Grund.

### `workerLauf` war nur einmal je Prozess aufrufbar

**Ursache.** `pool.end()` stand im `finally` des Workers. Der zweite Aufruf lief gegen einen
geschlossenen Pool.

**Heute.** Der Pool gehört dem Prozess, nicht dem Lauf — `pool.end()` steht in `sync.ts`.

---

## 4. Werkzeugfallen

Fehler, die nicht in der Fachlichkeit liegen, sondern im Verhalten von Bun, Postgres oder
JavaScript. Alle haben echte Zeit gekostet.

### Bun expandiert `$` in der `.env` — auch in einfachen Anführungszeichen

**Symptom.** `Login 200, Probe 401`. Drei Fehlanmeldungen, bei genau einem Zugang, der sich sperren
lässt.

**Ursache.** Das Passwort enthält `$` und `#`. Bun expandiert `$name` **auch in einfachen
Anführungszeichen** und behandelt `#` als Kommentaranfang. Aus 25 Zeichen wurden stillschweigend
9, und LINA meldete völlig zu Recht „Benutzername oder Passwort ist falsch!".

Empirisch für alle vier Schreibweisen gemessen:

| Schreibweise | ankommende Länge |
|---|---|
| unquotiert | 8 |
| quotiert | 16 |
| unquotiert, `\$` maskiert | 17 |
| **quotiert UND `\$` maskiert** | **25 — richtig** |

**Heute.** `konfigZumLoggen()` meldet die **Länge** des Passworts (nie den Wert). Eine Länge, die
nicht zum tatsächlichen Passwort passt, zeigt das Problem sofort.

### Komma-Join bindet schwächer als `LEFT JOIN`

**Symptom.** `ERROR: invalid reference to FROM-clause entry for table "r"` in sechs
Dashboard-Karten gleichzeitig, nachdem eine gemeinsame CTE ergänzt wurde.

**Ursache.** Bei

```sql
FROM mart.round_table_monat r, gewaehlt g
LEFT JOIN ampel.beschriftung a ON a.status = r.gesamt
```

gehört das `LEFT JOIN` zu `gewaehlt`, nicht zur ganzen Liste davor — `r` ist in der
`ON`-Klausel unsichtbar. Der Komma-Join bindet schwächer als jeder explizite Join.

**Heute.** Alle Karten benutzen `CROSS JOIN gewaehlt g`; das bindet gleich stark. Der Fehler
ist laut, nicht still — er kostet trotzdem Zeit, weil die Meldung auf die falsche Stelle
zeigt.

### `percentile_cont` liefert `double precision`

**Symptom.** `ERROR: function round(double precision, integer) does not exist`.

**Ursache.** Postgres kennt `round(numeric, int)`, aber nicht `round(double, int)`.
`percentile_cont` gibt `double precision` zurück — anders als `avg` über `numeric`.

**Heute.** Vor jedem `round()` ein `::numeric`. Betrifft jeden Median in `mart`.

### Metabase nimmt überlappende Kacheln klaglos an

**Symptom.** Im Browser überlagerten sich Dashboard-Kacheln, Texte waren abgeschnitten. Die
API hatte jede einzelne Anfrage mit `200` quittiert.

**Ursache.** Von Hand gepflegte `y`-Koordinaten. Sie halten genau bis zur ersten
Höhenänderung weiter oben; danach schiebt sich alles darunter ineinander. Metabase prüft das
nicht.

**Warum das schlimmer ist als es aussieht.** Der Fehler erscheint als Darstellungsproblem,
nicht als falsche Definition — man sucht ihn im CSS statt in den Zahlen.

**Heute.** `metabase/layout.ts` rechnet die Positionen aus Reihen; `dashboards.ts` enthält
keine Koordinaten mehr. `uebernehmen.ts` bricht ab, wenn zwei Kacheln überlappen, eine über
das Raster hinausragt oder unter ihr Mindestmaß fällt. Die Prüfung fand beim ersten Lauf
sofort eine echte Überlappung.

### `Number(null)` ist `0` und damit endlich

**Symptom.** Ein Satz ohne ID wäre als „Betrieb 0" durchgerutscht und hätte den Namen eines echten
Betriebs beansprucht. Gefunden vom eigenen Test.

**Heute.** Geprüft wird auf `> 0`, nicht auf `Number.isFinite`. LINAs Betriebs-IDs beginnen bei 1
(beobachtet: 1 bis 5891).

### `ON CONFLICT DO UPDATE cannot affect row a second time`

**Ursache.** `wawi:inventory` lieferte 11 Zeilen für 4 Tage — mehrere Einträge je Kalendertag.
Postgres verbietet, dieselbe Zeile in **einer** Anweisung zweimal zu treffen.

**Heute.** Die Transformation dedupliziert je Tag („bearbeitbar, wenn irgendeiner es ist").

### Enum-Cast in einer `VALUES`-Liste

**Ursache.** In einem `VALUES` ohne explizite Typen hält Postgres die Parameter für `text` und
findet den Enum-Typ nicht.

**Heute.** `unnest($1::text[], $2::int[], …)` mit typisierten Arrays. Dasselbe Muster löst
nebenbei die Blockaufteilung.

### `pg` parst `DATE` in Ortszeit

**Ursache.** Ohne Eingriff baut `pg` aus `DATE` ein `Date`-Objekt in **Ortszeit**. Läuft der
Container westlich von UTC, kippt der Geschäftstag um einen Tag zurück.

**Heute.** Der Parser für OID 1082 ist in `src/db/pool.ts` abgeschaltet — `DATE` kommt als
`'YYYY-MM-DD'`-Text.

### Ein Test, der zu prüfen schien und nichts prüfte

**Ursache.** Die Datenminimierungs-Prüfung suchte heikle Feldnamen als **Teilzeichenkette**.
`"tel"` steckt in `"mindestbestellwert"` — der Test war grün, weil er falsch fragte.

**Heute.** Verglichen werden JSON-Schlüsselmengen, nicht Teilzeichenketten.

---

## 5. Im Betrieb selbst verursacht

### Die Produktivdatenbank wurde durch einen Testlauf geleert

**Was passiert ist.** `TEST_DATABASE_URL` zeigte auf `lina`. Der Ende-zu-Ende-Test macht
`TRUNCATE` über `core`, `raw` und `sync` — ein einziger Lauf kostete die Daten des ersten echten
LINA-Imports.

**Heute.** Zwei Notbremsen in `src/sync/e2e.test.ts`:

1. `TEST_DATABASE_URL` darf nicht gleich `DATABASE_URL` sein.
2. Die wichtigere: geprüft wird, wohin der Worker **tatsächlich** schreibt. `bun test` teilt die
   Modulregistrierung über Testdateien hinweg, `config` wird **einmal** geladen und friert die
   Umgebung der zuerst gelaufenen Datei ein. Im Gesamtlauf ist das die `.env` — dann trunkiert der
   Test die Testdatenbank, während der Worker in die Produktivdatenbank schreibt. Der Namensvergleich
   aus (1) greift dabei nicht, weil die URLs ja verschieden sind.

### Die Laufsperre verklemmte den Pool

**Ursache.** Die Advisory-Sperre lag auf einer **gepoolten** Verbindung. `pool.end()` wartet auf
ausgecheckte Verbindungen — der Testlauf lief in sein 60-Sekunden-Zeitlimit.

**Heute.** Eine eigene `pg.Client`-Verbindung, nicht aus dem Pool.

### Ein gesunder Lauf sah aus wie ein hängender

**Symptom.** Ein völlig intakter Lauf wurde für tot gehalten und abgebrochen. Dass er die ganze
Zeit gearbeitet hatte, zeigte erst ein Neustart mit `LOG_LEVEL=debug`.

**Ursache.** Erfolge gingen nach `debug`, und zwischen zwei Posten liegen 20 bis 40 Sekunden. Auf
`info` war ein Backfill stundenlang vollkommen still.

**Heute.** Eine Fortschrittszeile mit Position, offener Schlange und geschätzter Restdauer.
`FORTSCHRITT_ALLE`: am Terminal jede, im Container jede fünfzigste. Details in `importer.md`.

> Ein Betriebszustand, den man nur durch Neustart feststellen kann, ist keiner.

### Das Tagesbudget hat nie gebremst

**Symptom.** Keins — und das ist der Punkt. `TAGESBUDGET` ist als Notfallnetz gedacht, für den
Fall, dass ein Fehler das Tempo aushebelt. Es hat nie ausgelöst, weil es nie auslösen *konnte*.

**Ursache.** Der Zähler `heuteVerbraucht` lag im Arbeitsspeicher des Prozesses. Jeder Lauf ist
aber ein frisch startender Prozess (`docker exec … bun run sync`, stündlich per Zeitplan) — der
Zähler begann also stündlich wieder bei null. Bei 20–40 s Takt fiel das nicht auf: der Takt selbst
hält bei rund 2.880 Aufrufen am Tag, die Grenze von 3.000 wurde ohnehin nie erreicht. Die Bremse
war wirkungslos, solange sie nicht gebraucht wurde.

**Aufgefallen** beim Senken des Takts auf 5–12 s für den Backfill. Genau dann ist das Budget die
einzige Grenze, die überhaupt noch bliebe — und genau dann hätte es versagt.

**Heute.** `LinaClient.budgetLaden()` zählt beim Laufstart die heutigen Zeilen aus
`sync.aufgabe`. Damit gilt das Budget laufübergreifend und übersteht einen Neustart.

> Ein Sicherheitsnetz, das nie ausgelöst hat, ist nicht bewiesen — es ist ungeprüft.

### `core` war mit 84 Partitionen zugestellt

**Symptom.** 110 Tabellen in `core`, davon 84 namens `artikelverkauf_tag_2023_07`. In Postico
lästig, in Metabase unbenutzbar.

**Ursache.** Postgres legt Partitionskinder standardmäßig neben die Elterntabelle.

**Heute.** Alle Kinder liegen im Schema `part`, die Elterntabellen bleiben in `core` und `raw`.
Drei Tests halten das fest, weil es bei der nächsten Änderung an `partition_anlegen()` lautlos
kaputtginge.

---

## Was diese Liste über das Projekt sagt

Drei Muster, die sich durchziehen:

1. **Der partielle Index hat dreimal zugeschlagen.** Nicht weil er falsch wäre, sondern weil
   „blockiert Duplikate" und „blockiert *offene* Duplikate" beim Lesen gleich aussehen.
2. **Ein Kommentar ist kein Beweis.** Zweimal behauptete ein Kommentar das Gegenteil dessen, was
   der Code tat — beide Male hat erst eine Messung es aufgedeckt. Deshalb steht in diesem Projekt
   an vielen Stellen „nachgemessen am …" statt „sollte".
3. **Die Attrappe kann nicht alles.** Vier der schwersten Fehler (BWA-Brücke, ungebuchte Monate,
   Euro/Prozent, die leeren letzten Tage) brauchen genau die Konstellation, die nur echte Daten
   liefern. Nach jeder Schemaänderung gehört ein Blick in `mart.pruefung_uebersicht` und
   `mart.betrieb_ohne_lina_id` dazu.

---

## Freitextfilter statt Auswahlliste — der lautlose Leerbefund

**Symptom.** Der Filter „Betrieb" auf allen Dashboards war ein Freitextfeld.

**Warum das schlimmer ist als es klingt.** Ein Tippfehler oder eine abweichende
Schreibweise — „Enchilada Bremen" gegen „Enchilada Bremen GmbH" — führt nicht zu einer
Fehlermeldung, sondern zu einem **vollständig aufgebauten, leeren Dashboard**. Das ist optisch
nicht davon zu unterscheiden, dass dieser Betrieb kein Geschäft macht. Und da 79 der 141
Betriebe tatsächlich dauerhaft 0 € melden, ist der Leerbefund hier sogar plausibel.

**Erster, wirkungsloser Versuch.** `values_source_config` mit `value_field` auf die Feld-ID
von `mart.betrieb.betrieb` — im Browser nachgemessen: unverändert ein Freitextfeld. Grund:
die Karten sind natives SQL, ihre Filter hängen an einer *Variablen* statt an einer Spalte,
und ein Feld-Dropdown bietet Metabase nur an, wo es die Spalte kennt.

**Lösung.** `values_source_type: 'static-list'` mit den beim Übernehmen aus der Datenbank
gelesenen Werten. Nachgewiesen: 141 Einträge, alphabetisch, als Auswahlliste im Browser.

**Regel.** Ein Textfilter ohne hinterlegte Auswahlliste ist ein Fehler, keine Vereinfachung.

---

## Zwei Zeitfilter, die verschiedene Teile derselben Seite bewegen

**Symptom.** Auf *Warenwirtschaft* standen „Monat" und „Zeitraum" nebeneinander.

**Befund.** Sie waren nicht redundant, sondern **schlimmer**: der Zeitraum wirkte auf zwei
Karten, der Monat auf genau eine, und zwei weitere Karten lasen keinen von beiden. Wer den
Monat umstellte, sah drei von fünf Karten unverändert stehenbleiben — ohne Hinweis, warum.

**Lösung.** Eine Zeitangabe je Seite. Da der Deckungsbeitrag nur je Monat vorliegt, nimmt er
jetzt alle Monate, die der gewählte Zeitraum berührt; dass ein halber Monat ganz zählt, steht
im Kopftext.

**Prüfung, die das findet.** Karten-Variablen — einschließlich der aus `gemeinsam.ts`
geerbten, sonst meldet die Prüfung `monat` überall fälschlich als tot — gegen die Filterliste
des Dashboards halten.

---

## Division durch null bei einer Marke ohne Umsatz

**Symptom.** *Wochenprofil je Marke* scheiterte mit `ERROR: division by zero`.

**Ursache.** Der Wochenanteil wird als `umsatz / sum(umsatz) OVER (PARTITION BY konzept)`
gerechnet. Eine Marke, deren Betriebe durchgehend 0 € melden, hat eine Wochensumme von 0.

**Lösung.** `nullif(…, 0)` — die Marke erscheint ohne Linie, statt die ganze Karte scheitern
zu lassen.

**Warum das hier lauert.** Die 79 umsatzlosen Betriebe sind kein Sonderfall, sondern über die
Hälfte des Bestands. Jede Division durch eine Umsatzsumme braucht einen Schutz. Die übrigen
drei Stellen im Kartenbestand waren bereits über `HAVING sum(...) > 0` bzw. `CASE WHEN > 0`
abgesichert; nachgeprüft am 26.07.2026.

---

## JSONB doppelt kodiert — der Merker, der immer NULL war

**Symptom.** `sync.merker.wert` enthielt `"{\"anzahl_betriebe\":141}"` statt
`{"anzahl_betriebe": 141}`. `wert->>'anzahl_betriebe'` lieferte NULL.

**Ursache.** `${JSON.stringify(objekt)}::jsonb` — der Treiber reicht den JSON-String als
**String-Literal** weiter, und `::jsonb` macht daraus einen JSON-String statt eines Objekts.
Syntaktisch gültiges JSONB, nur eine Ebene zu tief.

**Warum das gefährlich ist.** Nichts schlägt fehl. Das `INSERT` läuft, der Wert steht da und
sieht in `psql` fast richtig aus. Erst der Lesezugriff liefert NULL — und die Prüfung in
`/status` hätte daraufhin **für immer** „noch nie abgeglichen" gemeldet, also genau die
Beruhigung ausgegeben, gegen die sie gebaut wurde.

**Lösung.** `jsonb_build_object('anzahl_betriebe', $1::int)` — die Struktur entsteht in
Postgres, nicht im JavaScript.

**Regel.** JSONB aus dem Code nie über `JSON.stringify` + Cast schreiben. Entweder
`jsonb_build_object` oder den Wert als typisierte Spalte führen. Und: **jede Prüfung, die
einen Wert liest, einmal gegen einen echten Datensatz gegenprüfen** — hier fiel es nur auf,
weil der Merker nach dem Schreiben nochmals gelesen wurde.

---

## Nachtrag zum Überlauf der Personalquoten: die Warnung stand im falschen Fenster

**Anlass.** Das neue Import-Dashboard zeigte am 26.07.2026 „33 × numeric field overflow bei
`getPersonalkosten`". Nachgegangen — und der Befund ist ein doppelter.

**Der Überlauf selbst war bereits behoben.** Migration `0010` hat die Quotenspalten von
`numeric(6,2)` auf `numeric(12,2)` geweitet, `0012` den Beleg dazu korrigiert. Zeitlich
nachgemessen:

| | |
|---|---|
| letzter Überlauf-Fehler | 26.07.2026 **16:46** |
| Migration 0010 angewendet | 26.07.2026 **17:22** |

36 Minuten nach dem letzten Fehler. Seither keiner mehr. Von den 33 betroffenen Tagen sind
**32 inzwischen geladen**, der 33. (15.07.2026) steht mit 0 Versuchen in der Warteschlange und
kommt beim nächsten Lauf. Nichts ist verloren gegangen.

**Bestätigt: 20 Zeilen tragen heute Werte, die die alte Spalte abgewiesen hätte**, Höchstwert
316.576,50 % — Enchilada Würzburg am 15.06.2026 bei **6,05 € Tagesumsatz**. Genau der Fall, den
`0010` vorhergesagt hatte.

**Der eigentliche Befund war der zweite.** `0012` hat die Warnung über die Größenordnung als
Kommentar an `core.personalkosten` geschrieben — mit der ausdrücklichen Begründung, dass
Metabase Tabellenkommentare als Beschreibung anzeigt und wer dort mittelt, die Warnung sehen
soll.

Nur ist `core` seit demselben Tag **vollständig ausgeblendet**. Sichtbar in Metabase ist
`mart.personalkosten`, und deren Kommentar erklärte sorgfältig, dass man nicht über Zeiträume
summieren darf — sagte aber nichts über die Größenordnung. Die Warnung existierte, sie stand
nur dort, wo sie niemand liest.

**Wie groß der Unterschied ist**, über alle Tageswerte mit Umsatz gemessen:

| Rechenweg | Ergebnis |
|---|---|
| Mittelwert ungefiltert | **610,7 %** |
| Median | **383,4 %** |
| Mittelwert bei `pek_gesamt <= 200` | **113,0 %** |

Bemerkenswert: **selbst der Median ist unbrauchbar.** Der übliche Rat „nimm den Median statt
des Mittelwerts" reicht hier nicht, weil über die Hälfte der geführten Betriebe keinen
nennenswerten Umsatz macht — der mittlere Wert liegt dann selbst schon im Unsinn. Es braucht
zusätzlich einen Umsatzfilter.

**Behoben** mit `0020_mart_personalkosten_warnung.sql`: die Warnung steht jetzt am Kommentar
der Sicht, die Metabase tatsächlich zeigt, samt der drei Zahlen oben.

**Regel.** Ein Kommentar, der eine Falle erklärt, gehört an das Objekt, das der Lesende
**sieht** — nicht an das, aus dem die Daten stammen. Nach jeder Änderung an der Sichtbarkeit
prüfen, ob eine Warnung dadurch unsichtbar geworden ist.

---

## Der Backfill lief endpunktweise — ein Abbruch hätte alles wertlos gemacht

**27.07.2026.** Frage von Eugene: „Wie weit ist er schon gekommen?" Die Antwort war
unangenehm:

| Endpunkt | erledigt | reicht zurück bis |
|---|---|---|
| `getUmsatzbericht` | 3.123 | **2018** — fertig |
| `getUmsatzbericht:speisen` | 969 | 2023-12 |
| sechs weitere | je ~205 | **nur 2026** |

Ein Endpunkt war acht Jahre weit, sechs andere kamen über das laufende Jahr nicht hinaus.

**Ursache.** `sync.posten_holen()` sortierte `ORDER BY prioritaet, faellig_ab, posten_id`.
Innerhalb einer Priorität entschied damit die **Einreihungsreihenfolge** — und eingereiht
wurde endpunktweise. Der erste Endpunkt lief komplett durch, bevor der zweite anfing.

**Warum das ein Risiko war und nicht nur unschön.** Es gibt genau einen Zugang, und eine
Sperre wäre nicht rückgängig zu machen. Bei einem Abbruch — Sperre, Vertragsende,
Abschaltung — wäre der Bestand ein vollständiger Endpunkt neben sieben leeren gewesen.
Damit lässt sich **kein einziger Monatsbericht rechnen**: der Round Table braucht Umsatz
UND Personal UND Ware. Acht Jahre Umsatzdaten ohne Personaldaten sind für den Zweck des
Projekts genau so wertlos wie gar keine Daten.

**Behoben** mit `0021_historie_datumsweise.sql`: `ORDER BY prioritaet, zeitraum_von DESC,
endpunkt, posten_id`. Alle Endpunkte arbeiten denselben Tag ab, bevor einer den nächsten
anfängt. `faellig_ab` bleibt als Filter für die Wiedervorlage, fällt aber als Sortierschlüssel
weg. Der Index wurde mitgezogen — sonst hätte Postgres die gesamte offene Warteschlange
sortiert.

Die Menge der Aufrufe ändert sich dadurch **nicht**. Nur ihre Reihenfolge.

**Sichtbar gemacht** in `mart.historie_stand`: je Endpunkt, wie weit er zurückreicht und wie
viele Tage er hinter dem tiefsten liegt. Ohne diese Sicht war die Schieflage nur mit einer
von Hand geschriebenen Abfrage zu sehen — und deshalb wochenlang niemandem aufgefallen.

**Regel.** Bei einem Backfill, der Wochen läuft und jederzeit enden kann, ist die Reihenfolge
eine fachliche Entscheidung, keine technische. Frage dabei immer: *Was ist da, wenn es morgen
aufhört?* Tiefe verlieren ist verschmerzbar, Breite verlieren nicht.

---

## Drei Milliarden Gäste — und beinahe ein `bigint`, das sie geschluckt hätte

**27.07.2026.** Vier Tage im Oktober 2018 scheiterten reproduzierbar:

```
2018-10-10   value "3010725105" is out of range for type integer
2018-10-12   value "3303587892" ...
2018-10-13   value "3875603054" ...
2018-10-14   value "3648014052" ...
```

**Die erste Diagnose war falsch, und zwar auf die gefährliche Art.** Sie lautete: die Werte
liegen knapp über 2^31, sehen nach IDs aus, die Spalte ist zu schmal — dieselbe Klasse wie
`numeric(6,2)` bei den Personalkosten, also eine Migration auf `bigint`.

Nachgesehen: die Werte landen in `rechnungen` und `gaeste`, gespeist aus LINAs `bills` und
`guests`. Das sind **Anzahlen**. Ein Betrieb hat an einem Tag keine drei Milliarden Gäste.

Die Werte liegen alle zwischen 3,0 und 3,9 Milliarden — im oberen Bereich von uint32, also im
Muster einer ID. Was LINA dort schickt, ist keine Anzahl, sondern Datenmüll.

**Warum `bigint` der schlechteste denkbare Fix gewesen wäre.** Der Wert hätte danach gepasst,
wäre als Gästezahl in `core.umsatzbericht_tag` gelandet und hätte jeden Durchschnitt in `mart`
über den Haufen geworfen — still, und rückwirkend kaum noch erkennbar. Die zu schmale Spalte
war nicht das Problem. Sie war der einzige Grund, warum es überhaupt aufgefallen ist.

**Behoben** im Transform: `anzahl()` nimmt nur ganze Zahlen von 0 bis 2.147.483.647. Alles
andere wird `null`, der verworfene Wert wandert nach `sync.schema_abweichung`. Der Umsatz des
Tages bleibt erhalten — ein kaputtes Feld kostet nicht den ganzen Tag.

**Regel.** Ein Datentyp-Überlauf ist eine Frage, keine Antwort. Sie lautet nicht „wie mache ich
die Spalte breiter", sondern **„kann dieser Wert überhaupt das sein, was die Spalte behauptet?"**
Bei `numeric(6,2)` und den Personalkosten war die Antwort ja — 316.576 % sind bei 6,05 €
Tagesumsatz rechnerisch korrekt. Hier ist sie nein. Dieselbe Fehlermeldung, entgegengesetzte
Reparatur.
