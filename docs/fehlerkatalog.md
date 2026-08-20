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

---

## Filter, die oben stehen und nichts tun

**Symptom, vom Nutzer gemeldet (27.07.2026).** „Der Drill-Down vom Round Table funktioniert
nicht. Ebenso scheint der Markenfilter dort nicht zu funktionieren."

**Befund, weit größer als die Meldung.** Nachgemessen über alle 18 Dashboards:

| | |
|---|---|
| Dashboards mit Drill-Down | **5 von 18** — die gesamte Round-Table-Sammlung und alle Fachseiten hatten keinen |
| Filter, die nur teilweise wirkten | **21 Fälle** |
| Schlimmster Fall | *Round Table — Übersicht*, Markenfilter: **10 von 11 Karten** lasen ihn nicht |

**Warum das die gefährlichste Fehlerklasse dieses Systems ist.** Ein Filter, der nichts tut,
meldet sich nicht. Er steht oben, lässt sich bedienen, die Seite lädt neu — und zeigt dieselben
Zahlen. Wer „Aposto" wählt und **9 rote Betriebe** abliest, hält das für die Zahl dieser Marke.
Tatsächlich stand dort vorher **70** — die Zahl aller 141 Betriebe. Nichts daran sieht falsch
aus.

Gegenprobe nach der Reparatur, gegen die Datenbank gehalten:

| | rot | ohne Urteil | Betriebe |
|---|---|---|---|
| alle Marken | 70 | 64 | 141 |
| nur Aposto | **9** | **2** | **11** |

**Zwei Ursachen.**

1. **Namensspaltung.** Das Round-Table-Dashboard führte den Filter als `konzept`, die Karten
   lasen `marke`. Zwei Namen für dieselbe Sache — der Filter fand nie einen Abnehmer.
   Vereinheitlicht auf `marke`.
2. **Nie vollständig verdrahtet.** Bei den übrigen Karten fehlte schlicht die
   `[[AND … = {{…}}]]`-Klausel. Sie liefen korrekt, nur eben ungefiltert.

**Behoben:** 30 SQL-Klauseln ergänzt, 15 Drill-Down-Klicks gesetzt (Round Table, Trend,
Ursachen, Regelwerk, Umsatz, Struktur, Personal, BWA, Portfolio, Muster).

### Die eigentliche Lehre: zwei Prüfungen im Provisionieren

Beide Fehler waren **statisch erkennbar** — es hätte nie ein Nutzer melden müssen. Deshalb
scheitert `uebernehmen.ts` jetzt, bevor irgendetwas angelegt wird:

**Filterprüfung.** Für jedes Dashboard: liest jede Karte jeden Filter?
- *tot* — keine einzige Karte liest ihn
- *taub* — nur ein Teil liest ihn. **Das ist schlimmer als tot**, weil die Seite halb antwortet
  und dadurch funktionierend aussieht.

**Klickprüfung.** Führt jeder Drill-Down zu einem Dashboard, das den übergebenen Parameter
kennt? Ein Klick auf ein Ziel ohne passenden Filter öffnet die Seite **ungefiltert** — man
landet auf ③ Betrieb und sieht irgendeinen Betrieb, meist den zuletzt gewählten.

**Ausnahmen werden begründet, nicht geduldet.** `FILTER_AUSNAHME` in `uebernehmen.ts` nennt je
Karte und Filter den fachlichen Grund — etwa: eine Verlaufskurve darf keinen Stichmonat haben,
sonst bleibt ein Punkt übrig. Wer eine Karte ergänzt, die einen Filter ignoriert, muss diese
Entscheidung hinschreiben.

**Regel.** Ein Filter am Dashboard ist ein Versprechen. Wird es nur von der Hälfte der Karten
eingelöst, ist das kein halber Erfolg, sondern eine falsche Auskunft.

## Die Punktkarte kann nicht nach Ampel färben — nachgemessen, nicht vermutet

**Symptom.** Gemeldet am 27.07.2026: „Die Marker sind alle blau, da sollten ja die Ampeln hin."

**Was gemessen wurde.** Metabase v0.63.1.6 kennt für `map.type: pin` genau drei
Ausprägungen von `map.pin_type` — abgelesen am Auswahlfeld der Oberfläche:
`tiles`, `markers`, `grid`. Keine davon nimmt eine Farbdimension entgegen.

- **`markers`** zeichnet jeden Punkt als `<img src="app/assets/img/pin.png">` — eine
  statische PNG-Datei. 48 Marker, 48-mal dasselbe Bild. Es gibt nichts einzufärben.
- **`tiles`** rendert serverseitig. Die ausgelieferten Kacheln wurden Pixel für Pixel
  ausgezählt: **zwei Farben**, weiß für den Rand und `rgb(76,157,230)` für alle Punkte.
  Ebenfalls keine Dimension.
- **`grid`** verdichtet zu Flächen und verliert den einzelnen Standort.

**Nebenbefund.** `map.metric_column` stand auf der Karte gesetzt, wirkte aber nie: das Feld
ist ausgeblendet, solange `pin_type` nicht `heat` oder `grid` ist. Eine Einstellung, die
gespeichert wird und nichts tut — dieselbe Sorte Falle wie `table.column_formatting` auf
Zahlkacheln und `parameterMapping` mit `source: null`.

**Regel.** Bei Metabase-Visualisierungseinstellungen gilt: gespeichert heißt nicht gewirkt.
Was nicht im Browser nachgemessen ist, ist nicht belegt. Die drei bisher gefundenen Fälle
haben alle klaglos angenommen und stillschweigend ignoriert.

## 37 Betriebe mit Umsatz fehlen auf der Karte

**Symptom.** Gemeldet am 27.07.2026: „Lehners in Karlsruhe fehlt. Aposto, Enchilada und
Wilma Wunder sind da."

**Ursache.** Kein Kartenfehler. `manual.betrieb_standort` hat 48 Zeilen, alle mit
Koordinaten — sie stammen aus dem Yext-Abgleich. Wer keinen Yext-Eintrag hat, hat auch
keine Adresse, und Lehners Karlsruhe ist so ein Fall.

**Warum das mehr ist als eine Lücke.** Von den 93 Betrieben ohne Koordinaten machen **37
Umsatz**. Die Marke „Deutsche Konzepte" ist praktisch vollständig unsichtbar, obwohl sie die
umsatzstärksten Betriebe der Gruppe stellt — Wirtshaus am Schlossplatz (61 Mio. €), Alter
Kranen (23 Mio. €), Lehners Heilbronn (22 Mio. €), Lehners Karlsruhe (22 Mio. €).

**Warum das gefährlich ist.** Die Karte zeigt 48 Punkte und sieht vollständig aus. Wer die
räumliche Verteilung der Gruppe daraus abliest, liest die Verteilung der Yext-Kunden ab.
Deshalb steht die Liste `mart.standort_fehlend` unter der Karte und nicht in einem Anhang.

## Klick auf einen Balken führte zu „We're experiencing server issues"

**Symptom.** Gemeldet am 27.07.2026: ein Klick auf die Balken des Round Table landete auf
`/question/46-ampeln-nach-bereich?monat=2026-05&marke=Enchilada` und zeigte dort statt eines
Diagramms die Meldung „We're experiencing server issues. Try refreshing the page after waiting
a minute or two."

**Warum die Meldung in die Irre führt.** Sie liest sich wie ein überlasteter Server und legt
nahe, es später nochmal zu versuchen. Der Server war in Ordnung; dieselbe Karte lief auf dem
Dashboard einwandfrei. Was tatsächlich zurückkam, stand nur im Netzwerkprotokoll:

> `Invalid parameter value type :date/month-year for parameter "monat" with widget type :date.
> Parameter value must be one of: :category, :date, :date/single`

**Ursache.** Eine Variable in nativem SQL ist für Metabase vom Typ `date` — feiner geht es
nicht. Die Karte meldete ihren Parameter aber als `date/month-year`, weil dort derselbe Typ
stand wie beim Dashboardfilter.

Auf einem **Dashboard** fällt das nie auf: dort gleicht Metabase Filter und Karte ab. Wird die
Karte **allein** ausgeführt — und genau das tut jeder Klick auf einen Balken —, prüft Metabase
streng und lehnt ab.

**Nachgemessen**, indem alle vier Varianten gegen dieselbe Karte geschickt wurden:

| Typ im Aufruf | Antwort |
|---|---|
| `date/single` | 202, 6 Zeilen |
| `date` | 202, 6 Zeilen |
| `category` | 202, 6 Zeilen |
| `date/month-year` | **500** |

**Behoben.** `kartenParameterTyp()` in `uebernehmen.ts` bildet Datumstypen auf das ab, was
Metabase durchlässt. Feldfilter (`dimension`) sind ausgenommen — sie hängen an einer echten
Spalte statt an einer Variablen und vertragen `date/range`; auch das nachgemessen (202, 50
Zeilen). Das Bedienfeld bleibt unverändert, weil dafür `widget-type` am template-tag zuständig
ist und dort weiterhin `date/month-year` steht.

**Betroffen waren 50 der 120 Karten** — praktisch jede mit Monatsfilter. Der Fehler war die
ganze Zeit da und fiel nur nicht auf, weil Karten fast immer über ein Dashboard geöffnet werden.

**Regel.** Was auf dem Dashboard läuft, muss auch allein laufen. Jeder Drill-Down auf eine
Diagrammfläche öffnet die Karte einzeln, und dieser Weg wird beim Bauen nie getestet.

## Ein Klick auf ein Balkensegment kann die Farbe nur mitgeben, wenn sie ein Wert ist

**Symptom.** Gemeldet am 27.07.2026: „Wenn ich bei Ampeln nach Bereich auf Umsatz grün klicke,
möchte ich alle Filialen sehen, in denen der Umsatz grün ist — nicht die Balken nochmals in groß."

**Erster Versuch, und warum er zur Hälfte scheiterte.** Der Klick gab den Bereich mit
(`bereich=Umsatz`), die Farbe blieb leer (`ampel=`). Man landete auf allen 22 Umsatzzeilen
statt auf den 4 grünen — und die Liste begann mit den roten.

**Ursache: die Form der Abfrage.** Die Karte stand in der **Breitform**:

```sql
SELECT bereich_name AS "Bereich",
       count(*) FILTER (WHERE ampel = 'rot')   AS "Rot",
       count(*) FILTER (WHERE ampel = 'gruen') AS "Grün", ...
```

Damit ist die Ampel ein **Spaltenname**, kein Wert. Metabase kann beim Klick nur den Inhalt
einer Spalte weitergeben, nicht ihren Namen — die Farbe des angeklickten Segments ist für die
Übergabe schlicht nicht vorhanden. Nachgeprüft an der gespeicherten `result_metadata`: die
Karte kennt die Spalten `Bereich, Rot, Orange, Grün, Keine Daten`, und keine davon enthält
„grün" als Wert.

**Behoben durch die Langform** — eine Zeile je Bereich UND Ampel:

```sql
SELECT bereich_name              AS "Bereich",
       coalesce(b.bezeichnung, 'Keine Daten') AS "Bewertung",
       count(*)                  AS "Betriebe",
       coalesce(a.ampel, 'ohne') AS "Ampelwert"   -- technischer Wert für den Klick
```

Das Diagramm sieht unverändert aus (`graph.dimensions: ['Bereich', 'Bewertung']` stapelt
genauso), aber jetzt trägt jede Zeile beide Angaben. Der Klick gibt `bereich=Umsatz` **und**
`ampel=gruen` weiter.

**Zwei Spalten für dasselbe, mit Absicht.** „Bewertung" trägt die lesbare Beschriftung für die
Legende, „Ampelwert" den technischen Wert (`rot`, `gruen`, `ohne`) für den Filter. Die
Zielseite filtert auf `gruen`, nicht auf `🟢 Grün`.

**Betroffen und umgestellt:** `rt_treiber`, `dd_filialen_metrikvergleich`, `rt_historie`.

**Die Zielkarte fehlte ganz.** Ein Balkensegment meint eine EINZELAMPEL, die große
Filialtabelle filtert aber auf die GESAMTAMPEL — und das sind verschiedene Mengen, weil die
Gesamtampel ein Oder über alle sechs Bereiche ist. Wer das verwechselt, landet bei 43 statt 19
Betrieben. Deshalb `dd_filialen_bereich` auf `mart.ampel_bereich`, die je Betrieb und Bereich
eine Zeile führt — genau die Körnung eines Segments.

**Regel.** Was ein Klick weitergeben soll, muss als **Wert** in einer Spalte stehen. Eine
Kennzahl, die zur Spaltenüberschrift geworden ist, lässt sich nicht mehr filtern.

## Relative Datumsvorgaben wirken bei SQL-Variablen nicht

**Anlass.** Gewünscht am 27.07.2026: „standardmäßig soll der letzte Monat ausgewählt sein".

**Der naheliegende Weg — und warum er falsch ist.** Metabase kennt relative Vorgaben wie
`thismonth` oder `past1months`. Gesetzt, gespeichert, Status 200. Im Browser meldeten daraufhin
**alle 15 Kacheln** „There was a problem displaying this chart".

Nachgemessen an einer einzelnen Karte:

| Wert im Aufruf | Antwort |
|---|---|
| `2026-07` | 202, 16 Zeilen |
| `thismonth` | **500** — `Text 'thismonth' could not be parsed, unparsed text found at index 1` |

Der Grund ist derselbe wie beim Parametertyp weiter oben: Eine Variable in nativem SQL bekommt
den Wert **unverändert** eingesetzt, und `'thismonth'::date` ist kein gültiges Datum. Relative
Vorgaben funktionieren nur bei Feldfiltern, die an einer echten Spalte hängen und deren Klausel
Metabase selbst baut.

**Gelöst über einen berechneten festen Wert.** Der voreingestellte Monat wird beim
Provisionieren aus `mart.round_table_monat` gelesen — der jüngste Monat mit einem Urteil — und
als `default` eingetragen. Ein fester Wert veraltet am Monatsersten, deshalb setzt
`src/sync/auswahllisten.ts` ihn nach **jedem Import** neu. Was von selbst aktuell bleibt, kann
nicht vergessen werden.

**Warum überhaupt eine Vorgabe.** Ohne sie zeigte das Dashboard trotzdem Zahlen: `MONAT_CTE`
fällt auf denselben Monat zurück. Richtig gerechnet, aber unsichtbar — der Filter stand leer,
und niemand konnte sehen, welcher Monat da beantwortet wird.

**Nebenbei aufgeräumt.** Metabases mitgeliefertes Beispiel-Dashboard „E-commerce Insights"
(Sammlung „Examples", erfundene Verkaufszahlen) wird jetzt mitarchiviert. Es belegt die
Dashboard-ID 1 — deshalb heißt der Round Table `/dashboard/2-round-table` und nicht `1-`. Die
Nummer ist Metabases Datenbank-ID, kein Titel; sie wird nie neu vergeben und lässt sich ohne
Neuaufsetzen der Metabase-Datenbank nicht ändern.

## Eine Vorgabe für alle Seiten leerte die EBIT-Karte

**Symptom.** Gemeldet am 27.07.2026: „Warum ist EBIT je Betrieb auf dem BWA-Dashboard leer?"
Die URL zeigte es: `/dashboard/10-bwa-kennzahlen-und-buchungsstand?betrieb=Aposto+Augsburg&monat=2026-07`.

**Ursache — selbst verursacht, eine Stunde zuvor.** Der neu eingeführte Vorgabemonat setzte
überall denselben Wert: den jüngsten Monat mit einem Round-Table-Urteil, also Juli 2026. Für
Juli hat der Steuerberater aber **noch nichts gebucht** — 0 von 131 EBIT-Zeilen.

Der Kommentar an `MONAT_CTE_BWA` beschreibt genau diesen Fall, seit dem 26.07.2026:

> *„Wer hier den Round-Table-Rückfall nimmt, landet auf Juli und bekommt eine leere Karte …
> Eine leere Karte neben gefüllten liest sich als ‚kein EBIT', nicht als ‚noch nicht gebucht',
> und das ist der teurere der beiden Irrtümer."*

Der Rückfall im SQL war richtig; die Dashboard-Vorgabe hat ihn überschrieben. Und der Irrtum
trat genau so ein wie vorhergesagt — die Verlaufskarte darüber zeigte Zahlen bis Juni, die
EBIT-Karte darunter blieb leer.

**Behoben mit zwei Vorgaben:**

| Seiten | Vorgabe | Wert am 27.07.2026 |
|---|---|---|
| alle übrigen | jüngster Monat mit Urteil | 2026-07 |
| BWA | jüngster **gebuchter** Monat | 2026-06 |

**Welche Seite welche bekommt, wird abgeleitet, nicht gepflegt.** Kriterium: benutzen *alle*
Monatskarten der Seite den BWA-Rückfall (erkennbar an `kennzahlen_aktuell` mit
`wert_absolut <> 0`)? Eine Namensliste wäre beim nächsten Umbau still veraltet, und der Fehler
sähe wieder aus wie fehlende Daten. Nachgemessen trifft es genau ein Dashboard.

Bewusst streng — nur wenn *alle* Karten daran hängen. Eine gemischte Seite bekommt die
Standardvorgabe: eine einzelne leere BWA-Karte ist der kleinere Schaden als eine ganze Seite,
die einen Monat zu weit zurückliegt.

**Regel.** Ein Vorgabewert ist eine Behauptung darüber, welcher Ausschnitt sinnvoll ist. Wo
verschiedene Datenquellen verschieden weit reichen, gibt es diese eine Antwort nicht.

## Eine Ausnahme, die das Filtern verhinderte

**Symptom.** Gemeldet am 28.07.2026: „Wenn ich auf dem Round Table nach einer Marke filtere,
wird der Markenbereich nicht gefiltert."

**Ursache — falsch herum gedacht.** Beim Verschieben der Markenkarten in den Round Table hatte
ich sie als Filterausnahme eingetragen, mit der Begründung: *„Eine Zeile JE MARKE — der Filter
ließe genau eine übrig."* Das stimmt, ist aber kein Argument gegen den Filter, sondern seine
Funktion. Wer Enchilada wählt, will Enchilada sehen.

Behoben durch Zurücknehmen der Ausnahme und `[[AND konzept = {{marke}}]]` in den drei Karten.

**Regel.** Eine Ausnahme braucht einen Grund, warum der Filter *nicht wirken kann* — keine
fehlende Spalte, keine Kreisbezüge. „Es bliebe wenig übrig" ist der Zweck des Filterns.

## Die Warenwirtschaft lud ohne Eingrenzung 14 Millionen Zeilen

**Symptom.** Gemeldet am 28.07.2026: „Wenn ich mich per Drill-Down bis zur Warenwirtschaft
durchklicke, werden keine Filter übernommen, sodass sie nicht lädt."

**Nachgemessen.** `mart.artikelverkauf` hat **14.024.161 Zeilen** über dreieinhalb Jahre; ein
bloßes `count(*)` darauf braucht **20 Sekunden**. Die Seite hatte keinen Vorgabezeitraum und
keinen Markenfilter — wer über den Drill-Down dorthin kam, sah eine hängende Seite.

**Zwei Änderungen:**

1. **Markenfilter ergänzt.** Vier der fünf Karten lesen ihn jetzt; `mart.artikelverkauf` und
   `mart.deckungsbeitrag_warengruppe` führen `konzept` direkt, `mart.pruefung_wareneinsatz`
   bekommt es über `mart.konzept_zuordnung` — dieselbe Quelle, aus der die Auswahlliste stammt.
   `wa_preise` bleibt ausgenommen: der Einkauf läuft über die Gruppe, nicht je Konzept.

2. **Vorgabezeitraum „letzte 3 Monate".** Nachgemessen: 50 Zeilen in **2 Sekunden** statt 20+.

**Warum hier ein relativer Wert geht und beim Monat nicht.** `zeitraum` ist ein **Feldfilter** —
er hängt an `mart.artikelverkauf.geschaeftstag`, und Metabase baut die WHERE-Klausel selbst,
inklusive Auflösung von `past3months`. Der Monatsfilter ist dagegen eine SQL-Variable; dort käme
das Wort unverändert an und `'past3months'::date` scheiterte. Beide Fälle nachgemessen.

**Es ist eine Vorgabe, keine Grenze.** Wer weiter zurück will, stellt den Filter um.

## Ohne Betriebsfilter stapelten sechs Karten anonyme Zeilen

**Symptom.** Gemeldet am 28.07.2026: „Wenn ich den Betriebs-Filter entferne, weiß ich nicht,
welche Betriebe gemeint sind in ‚Betrieb — Kennzahlen des Monats'."

**Nachgemessen — es war schlimmer als eine fehlende Beschriftung.** Die Karte ist für EINEN
Betrieb gedacht: sechs Zeilen, je eine Kennzahl. Ohne Filter liefert dieselbe Abfrage **846
Zeilen** — 141 Betriebe mal sechs Bereiche, unaggregiert und ohne jede Kennung. Man sah
sechsmal „Umsatz" untereinander mit verschiedenen Werten und hielt es für die Kennzahlen eines
Betriebs.

**Sechs Karten auf ③ Betrieb hatten dieselbe Schwäche**, gefunden über eine Prüfung: liest die
Karte den Betriebsfilter, gibt sie ihn aber weder als Spalte aus noch aggregiert sie über
alle Betriebe?

| Karte | Behoben durch |
|---|---|
| `dd_betrieb_kopf` | Spalte „Betrieb" + Sortierung nach Handlungsdruck |
| `dd_betrieb_personal` | Spalte „Betrieb" |
| `dd_betrieb_massnahmen` | Spalte „Betrieb" |
| `dd_betrieb_datenstand` | Spalte „Betrieb" |
| `dd_betrieb_ampelverlauf` | Median je Monat und Bereich |
| `dd_betrieb_verlauf` | war bereits summiert — in Ordnung |

**Warum beim Ampelverlauf ein Median und keine Spalte.** Es ist ein Liniendiagramm; eine
Betriebsspalte ergäbe 91 Linien. Ohne Filter lagen dort 10.746 Punkte übereinander, die
Metabase zu einem unlesbaren Knäuel verband. Der Median statt der Summe, weil es
**Prozentwerte** sind: die Summe zweier Personalquoten ist keine Personalquote. Bei einem
gewählten Betrieb ändert der Median nichts — ein Wert je Gruppe bleibt er selbst; nachgemessen
an Aposto Augsburg (32,64 → 32,6).

**Regel.** Eine Karte, die für eine Einheit gedacht ist, muss auch ohne Filter lesbar bleiben —
entweder sagt sie, von wem jede Zeile stammt, oder sie fasst ehrlich zusammen. Was sie nicht
darf: mehrere Einheiten so stapeln, dass es wie eine aussieht.

## Tabellen scrollten waagerecht, und die erste Prüfung dagegen mass nichts

**Symptom.** Gemeldet am 28.07.2026: „Viele Tabellen sind zu eng und brauchen viel
horizontales Scrollen." Genannt wurde „Betrieb — Kennzahlen des Monats" auf ③ Betrieb: neun
Spalten auf sechzehn Rastereinheiten, daneben die Standortkarte.

**Warum das mehr ist als ein Schönheitsfehler.** Wer scrollen muss, um die dritte Spalte zu
sehen, vergleicht sie nicht mehr mit der ersten — und Vergleichen ist der Zweck einer Tabelle.
Auf ② Filialen standen zwanzig Spalten auf fünfzehn Einheiten; sechs Ampeln lagen außerhalb
des Bildes.

**Drei Fehlversuche, bis die Messung stimmte.** Der Reihe nach, weil jeder etwas anderes
falsch machte:

| Ansatz | Warum er scheiterte |
|---|---|
| `LIMIT 0`, Spalten aus `Object.keys(zeile[0])` | Bei null Zeilen gibt es keine erste Zeile — überall NULL Spalten gemessen und **„alle Tabellen haben genug Breite"** gemeldet, während vier zu schmal waren |
| Spalten **zählen** | „Datenstand" hat zehn Spalten und braucht 368 Zeichen, „Maßnahmen" hat elf und braucht 83. Was scrollt, ist die Summe der Inhalte |
| Zeichen linear in Pixel | Metabase gibt jeder Spalte eine **Mindestbreite** von rund 70 Pixeln. Tabellen mit vielen kurzen Spalten wurden dadurch unterschätzt und gingen durch |

Die vierte Fassung rechnet in Pixeln mit Mindestbreite je Spalte, Aufschlag je Zeichen und
Obergrenze — alle drei Werte am gerenderten Ergebnis abgelesen, nicht hergeleitet.

**Eine Prüfung, die durchgeht, weil sie nichts gemessen hat, ist schlimmer als gar keine.**
Sie meldet Entwarnung. Deshalb wirft `tabellenbreite.ts` jetzt, wenn eine Karte null Spalten
oder der Lauf null Kacheln meldet.

**Ein Messfehler sah aus wie ein Kartenfehler.** Der `pg`-Treiber macht aus einem `date` ein
JavaScript-`Date`; `String()` daraus ist `2022-09-07T00:00:00.000Z` — 62 Zeichen für einen Tag,
den Metabase als `2022-09-07` zeigt. Ein `::date` im SQL sah dadurch wirkungslos aus, obwohl es
genau richtig war. Erst ein `setTypeParser`, der Datumswerte als Text liefert, mass das, was
im Browser steht.

**Zwei Hebel, in dieser Reihenfolge:** erst die breitesten Spalten schmaler machen — ein
Zeitstempel mit Mikrosekunden, wo ein Datum genügt, kostet 50 Pixel ohne Aussage —, dann die
Kachel breiter legen. Umgesetzt: `dd_betrieb_kopf`, `dd_filialen_tabelle`, `rt_marke`,
`rt_massnahmen_offen`, `dq_konzept`, `pf_konzentration`, `pf_marken_matrix`,
`dq_umsatz_abweichung`, `dq_pruefung`, `wa_renner`/`wa_penner` und
`dd_betrieb_artikel`/`dd_betrieb_bwa` auf volle Breite; Standortkarte auf ③ und ② jeweils
neben eine Karte gerückt, die keine waagerechte Ausdehnung braucht. Bei `dq_konzept` half
keine Breite: `string_agg` schrieb **131 Betriebsnamen und 3.693 Zeichen in EINE Zelle** —
gekürzt auf Anzahl plus Stichprobe.

## „Zeitraum" fehlte, also hörten die Verläufe auf gar keine Zeit

**Symptom.** Gemeldet am 28.07.2026: „Wenn ich bei Betrieb oben einen Monat auswähle, erwarte
ich, dass die Karten im Bereich Struktur auch nur die ausgewählte Periode anzeigen."

**Die Ursache war eine falsche Antwort auf eine richtige Beobachtung — meine.** ③ Betrieb
führte nur einen **Monatsfilter**. Der wählt einen Stichmonat, und den kann ein Verlauf nicht
lesen: es bliebe ein Punkt übrig. Genau deshalb standen „Speisen und Getränke", Zeitzonen und
Tagesverlauf in `FILTER_AUSNAHME`, begründet mit „über die gesamte Historie". Fachlich
vertretbar, praktisch falsch: wer oben einen Monat einstellt, erwartet darunter nicht
dreieinhalb Jahre.

**Die Lösung ist nicht, dem Verlauf einen Stichmonat aufzuzwingen, sondern der Seite einen
Zeitraum zu geben, den ein Verlauf lesen kann.** ③ Betrieb, Personal, BWA und ⑤ Standorte
vergleichen führen jetzt beide: **Monat** für die Ampeln und Stichmonatstabellen, **Zeitraum**
für die Verläufe darunter. Der Unterschied steht im Kopftext der Seite.

Nachgemessen an der Zeitzonen-Karte von Aposto Augsburg: **9,6 Mio. €** ohne Zeitraum,
**1,06 Mio. €** für den 1.1.–30.6.2026 — und dieser Wert stimmt auf den Euro mit der
YTD-Kachel derselben Seite überein.

**Wo ein Zeitraum wirklich nicht passt, steht es begründet in `FILTER_AUSNAHME`** — bei
Kennzahlkacheln eines Monats, bei „bis wann hat der Steuerberater gebucht" (eine Frage an die
Gegenwart) und bei offenen Maßnahmen (eine fällige Maßnahme aus dem März verschwindet nicht
dadurch, dass man auf den Juni schaut).

## Ein Feldfilter auf eine Tabelle mit Alias scheitert erst, wenn jemand ihn setzt

**Symptom.** Nach dem Einbau des Zeitraumfilters zeigten „Betrieb — Umsatz je Tag" und
„Betrieb — BWA im Verlauf" auf dem Dashboard *There was a problem displaying this chart* —
während beide Karten einzeln aufgerufen tadellos liefen.

**Ursache.** Metabase baut die Klausel eines Feldfilters aus dem **Tabellennamen**:

```
bwa_kennzahl.monat BETWEEN … AND …
```

Steht die Tabelle im SQL unter einem Alias (`FROM mart.bwa_kennzahl k`), ist dieser Name an
der Stelle nicht mehr gültig:

```
ERROR: invalid reference to FROM-clause entry for table "bwa_kennzahl"
  Hint: Perhaps you meant to reference the table alias "k".
```

**Warum es so spät auffällt.** Ohne gesetzten Wert fällt der optionale Block `[[…]]` weg und
die Abfrage läuft. Der Fehler erscheint erst, wenn jemand den Filter **wirklich benutzt** —
also genau dann, wenn niemand mehr mit einem Einbaufehler rechnet.

**Vier Karten an einem Nachmittag.** Zwei fielen im Browser auf; die anderen beiden fand eine
Regel: *hat eine Karte einen Feldfilter auf eine Tabelle, die im SQL einen Alias trägt?* Sie
steht jetzt als Prüfung in `uebernehmen.ts` und bricht das Übernehmen ab — geprüft, indem ein
Alias absichtlich wieder eingesetzt wurde.

**Derselbe Fehler in einer Unterabfrage.** `dd_betrieb_verlauf` referenzierte `{{zeitraum}}`
ein zweites Mal in einer Unterabfrage über die CTE `tage`, wo `umsatz_tag` nicht mehr in
Reichweite ist. Die Eingrenzung steht jetzt nur noch in der CTE.

**Und ein Fehler, der ohne Fehlermeldung ausgegangen wäre.** `vg_ort_profil` rechnet Anteile
am Tagesumsatz. Der Nenner kam aus einer LATERAL-Unterabfrage über die **gesamte** Historie.
Hätte man dort nur den Filter ergänzt, wäre der Zähler auf drei Monate geschrumpft und der
Nenner nicht: die Anteile hätten sich statt auf 100 % auf **5,55 %** summiert — flachere
Kurven, keine Fehlermeldung. Nachgemessen, bevor es passieren konnte; der Nenner rechnet
jetzt als Fenster über genau die Zeilen, die der Filter übrig lässt.

## Metabase lässt Achsenbeschriftungen weg, ohne es zu sagen

**Symptom.** Gemeldet am 28.07.2026: „Beim ‚Betrieb — Tagesverlauf' sieht man keine Stunden auf
der x-Skala."

**Nachgemessen im Browser.** Das Diagramm enthielt **acht** Textelemente: den Achsentitel
„Stunde", sieben Werte der y-Achse — und **keine einzige Uhrzeit**. Die Kachel war 345 Pixel
breit, das Diagramm hat vierundzwanzig Balken; das sind rund 14 Pixel je Balken, und eine
Beschriftung wie „08:00" braucht mit Abstand etwa 40. Metabase lässt sie dann weg. Ohne
Hinweis, ohne Fehlermeldung, einfach ohne Text unter den Balken.

**Das ist schlimmer als eine fehlende Achse**, denn der Achsentitel bleibt stehen. Man sieht
ein Muster, liest darüber „Stunde" und kann keinen einzigen Balken einer Tageszeit zuordnen.

**Der Unterschied zur Zeitachse ist wesentlich.** Bei 103 Monaten auf einer Linie setzt
Metabase jede fünfte Beschriftung, und die Kurve bleibt lesbar — eine ausgelassene Jahreszahl
kostet nichts. Bei einer **kategorialen** Achse ist jede ausgelassene Beschriftung ein Balken,
den man nicht mehr zuordnen kann. Die Prüfung unterscheidet deshalb nach Achsentyp.

**Vier Diagramme betroffen**, drei davon gefunden, bevor jemand sie meldete:

| Diagramm | vorher | jetzt |
|---|---|---|
| `dd_betrieb_stunde` | 24 Stunden auf 8 Einheiten (14 px) | volle Breite (44 px) |
| `vg_ort_profil` | 24 Stunden auf 12 Einheiten (22 px) | volle Breite |
| `st_stunde` | 24 Stunden auf 14 Einheiten (26 px) | volle Breite |
| `im_wartezeit` | 19 Stunden auf 10 Einheiten (23 px) | volle Breite |
| `dq_backfill_balken` | 17 Endpunkte auf 14 Einheiten (36 px) | volle Breite |

Nachgemessen nach der Änderung: **24 von 24 Uhrzeiten** stehen an der Achse, in der Reihenfolge
des Geschäftstags von 08:00 bis 07:00.

**Die Prüfung steht jetzt in `tabellenbreite.ts`** neben der Spaltenbreite — dasselbe Muster:
die Kachel ist zu schmal für ihren Inhalt, und Metabase löst das, indem es still etwas
weglässt. Ausnahmen brauchen einen Grund; die Lorenzkurve auf dem Portfolio-Dashboard hat
einen (ihre Aussage steckt in der Krümmung, nicht in einzelnen Punkten).

## „Personal %" zeigte Werte über 1.000, und es waren tatsächlich Prozent

**Symptom.** Gemeldet am 28.07.2026 zur Tabelle „Betrieb — Personal je Bereich": „einzeltage
sind nicht so aussagekräftig und warum wird da ein zeitraum angezeigt, wenn es nur ein tag
ist?" Im Screenshot standen unter „Personal %" die Werte 777, 908, 1.262 — daneben in
derselben Zeile „o. GF %" mit 32,6.

**Beides zutreffend, und dahinter lag ein größerer Fehler.**

`mart.personalkosten` führt **ausschließlich Tageszeilen** — 233.778 Stück, alle mit
`zeitraum_bis = zeitraum_von`. Die Karte zeigte sie roh: 91 Zeilen für einen Betrieb, jede
mit einer „Von–Bis"-Spanne über genau einen Tag. Die Spanne war meine Änderung vom selben
Vormittag; ich hatte zwei Datumsspalten zu einer zusammengefasst, ohne zu prüfen, was die
Zeilen eigentlich sind.

**Der eigentliche Fehler stand seit Monaten im Kommentar der Sicht.** Diese Quoten haben den
**Umsatz im Nenner**, und der geht bei einem Tag ohne Geschäft gegen null:

> Gemessen am 26.07.2026: `pek_gesamt` bis 316.576,50 Prozent — Enchilada Würzburg am
> 15.06.2026 bei 6,05 EUR Tagesumsatz. Das ist keine Anomalie in den Daten, sondern die
> Bauart der Kennzahl.
>
> Für Auswertungen deshalb: den **Median** nehmen **und** Betriebe ohne Umsatz ausschließen.

Die Karte tat weder das eine noch das andere. Über alle Tageswerte liegt der Median bei
383 Prozent; in der Tabelle standen solche Zahlen unter der Überschrift „Personal %" neben
einem BWA-Wert von 32,6. **Wer die vergleicht, vergleicht Unvergleichbares** — und nichts an
der Darstellung sagte, dass man das nicht darf.

**Jetzt eine Zeile je Monat**, mit dem belastbaren BWA-Wert zuerst, dem Median der plausiblen
Tageswerte dahinter und der Zahl dieser Tage daneben. Bei Aposto Augsburg sind das 7 bis 11
von 30 — und diese Ehrlichkeit gehört in die Tabelle: steht dort eine kleine Zahl, ist der
Median wenig wert.

**Regel.** Wo eine Sicht in ihrem Kommentar vorschreibt, wie ihre Werte zu lesen sind, ist das
keine Empfehlung. `PLAUSIBEL` und `MEDIAN` stehen deshalb als gemeinsame Bausteine in
`karten-drilldown.ts` — damit keine Karte nur die Hälfte der Vorschrift befolgt.

## Ein Zeitfilter in einer Unterabfrage sieht aus wie ein Zeitfilter und wirkt nicht

**Symptom.** Gemeldet am 01.08.2026, nach dem abgeschlossenen Lina-Import: „Metabase ist auf
einzelnen Dashboards langsam." Verdacht des Melders war die Datenmenge — die Historie reicht
weiter zurück, als irgendjemand abfragt.

**Nachgemessen, und zuerst gegen den Verdacht.** Der Round Table (Dashboard 2), auf den die
Meldung verwies, war **nicht** betroffen: alle 17 Karten zusammen 3,9 s mit Markenfilter,
5,3 s ohne — und Metabase lädt sie parallel. Betroffen war die Seite **Warenwirtschaft**, mit
ihrer eigenen Voreinstellung „letzte 3 Monate":

| Karte | vorher | nachher |
|---|---|---|
| `wa_db_warengruppe` | **>120 s (Abbruch)** | 2,0 s |
| `wa_we_pruefung` | **63,2 s** | 0,2 s |
| `pf_karteileichen` | 23,9 s | unverändert |
| `wa_renner` | 7,0 s | 2,4 s |

**Ursache 1 — der Filter, der nur innen wirkt.** In `wa_db_warengruppe` stand:

```sql
FROM mart.deckungsbeitrag_warengruppe d
WHERE d.monat IN (SELECT DISTINCT monat FROM mart.artikelverkauf WHERE {{zeitraum}})
```

Das ist rechnerisch richtig und liefert die richtigen Zahlen — deshalb ist es nie aufgefallen.
Nur wirkt der Zeitraum ausschließlich in der **inneren** Abfrage. Die äußere Sicht aggregiert
vorher die gesamte Historie und filtert erst danach: **111 Partitionsscans** auf
`core.artikelverkauf_tag` statt der drei gebrauchten. Genau die Falle, vor der der Kommentar
an `mart.artikelverkauf` seit jeher warnt („in Metabase immer nach `geschaeftstag` filtern,
dann greift das Partition Pruning").

Behoben, indem der Zeitraum direkt auf `geschaeftstag` liegt und die Aggregation je
Warengruppe in der Karte passiert. Gegengeprüft über alle 194 Warengruppen: Menge, Umsatz und
Abdeckung stimmen auf die Stelle überein.

**Ursache 2 — ein Aggregat, das gar nicht filtern kann.** `wa_we_pruefung` war noch langsamer
und hat **keinen Zeitraumfilter**: `mart.pruefung_wareneinsatz` stellt Monate absichtlich
nebeneinander. Pruning ist dort grundsätzlich unerreichbar — die Sicht las bei jedem Aufruf
alle 27,5 Mio. Zeilen.

Dagegen hilft kein Filter, sondern nur, das Ergebnis **einmal** zu rechnen:
`mart.deckungsbeitrag_warengruppe` ist seit Migration `0027` materialisiert, und
`pruefung_wareneinsatz` summiert seit `0028` darauf auf statt auf die Rohsicht. Das gesuchte
Aggregat (Betrieb × Monat) ist eine Stufe gröber als das materialisierte
(Betrieb × Monat × Warengruppe), lässt sich also exakt daraus ableiten. Gegengeprüft über alle
**5.068 Zeilen: null Abweichungen.**

**Eine Falle dabei, die fast durchgerutscht wäre.** `abdeckung_pct` ist ein **Prozentwert** und
damit nicht wieder aufsummierbar — aus Prozenten lässt sich der zugrunde liegende Betrag nicht
zurückrechnen. Deshalb führt die materialisierte Sicht `umsatz_mit_we` als eigene Summenspalte.
Dass die Werte im aktuellen Bestand zufällig nur `NULL` oder `100` sind (139.823 zu 34.129,
kein einziger Teilwert), hätte die Rückrechnung heute funktionieren lassen und beim ersten
teilweise hinterlegten Monat still falsche Zahlen ergeben.

**Zwei Regeln.**

1. **Ein Zeitfilter muss auf der partitionierten Spalte liegen.** Steht er in einer
   Unterabfrage, ist er Dekoration. Ob er wirkt, sagt nicht das Ergebnis, sondern
   `EXPLAIN` — die Zahl der Partitionsscans.
2. **Wo kein Zeitfilter möglich ist, hilft nur Materialisieren.** Eine Aggregation über
   Millionen Zeilen, die sich einmal je Import ändert, gehört nicht in jeden Kartenaufruf.
   Der Preis ist ein Stand statt Echtzeit — deshalb `mart.deckungsbeitrag_stand`, damit
   „wie alt ist das?" beantwortbar bleibt.

**Offen geblieben.** `pf_karteileichen` (23,9 s) auf der Portfolio-Seite ist unverändert. Sie
lag außerhalb dessen, was hier beauftragt war.

---

## Ein Filter auf `IS NOT NULL`, wo die Quelle `0` liefert (01.08.2026)

**Der Wächter, der nie ausgelöst hat.**

`mart.pruefung_wareneinsatz` trug seit `0006` eine ausdrückliche Warnung in ihrem
Kommentar: *„abdeckung_pct sagt, welcher Anteil des Artikelumsatzes überhaupt einen
hinterlegten Ansatz hat. UNTER ETWA 90 PROZENT IST DER VERGLEICH NICHT
AUSSAGEKRÄFTIG."* Die Übersichtssicht zählte die Fälle darunter als Arbeitsliste.

Gemessen am 01.08.2026: **5.068 Zeilen, davon 0 unter 90 %, Durchschnitt 100,0.**

Kein einziger Fall — über Jahre. Der Grund stand in der Aggregation:

```sql
sum(umsatz_netto) FILTER (WHERE fixer_we IS NOT NULL)
```

**`fixer_we` ist nie `NULL`.** LINA liefert `0.0000`. In `core.artikel_stand`:
591.464 Zeilen, davon **0 mit `NULL`**, 574.254 mit dem Wert `0` (97,1 %), nur
17.210 positiv. Der Filter griff also nie, `umsatz_mit_we` war identisch mit
`umsatz_netto_pos`, und `abdeckung_pct` stand per Konstruktion auf 100.

**Was das anrichtete.** 2.590 der 5.364 Betrieb-Monat-Kombinationen (48 %) haben
einen theoretischen Wareneinsatz von exakt null. Die Sicht wies deren Lücke in
voller Höhe des BWA-Wareneinsatzes aus — und meldete daneben 100 % Abdeckung:

```
BS Bier & Speisen Gastro GmbH   2023-05   Lücke 235.900,27 €   Abdeckung 100 %
Wirtshaus am Schlossplatz GmbH  2023-12   Lücke 197.452,41 €   Abdeckung 100 %
```

Das sind keine Schwundwerte. Das ist ein **fehlender Ansatz, der als Schwund
gelesen wird** — genau der Fehler, vor dem der Kommentar warnte. Unbemerkt, weil
der Wächter selbst defekt war.

**Der Befund lag schon im Katalog, ungedeutet.** Der Eintrag darüber notiert, die
Werte seien „zufällig nur `NULL` oder `100`, kein einziger Teilwert". Das war kein
Zufall, sondern die Signatur des Fehlers — eine Verteilung ohne Zwischenwerte
entsteht nicht durch Daten, sondern durch eine Bedingung, die immer oder nie
greift. Die Beobachtung war da; sie wurde als Kuriosität abgelegt statt als Frage.

**Behoben in `0029`:** `FILTER (WHERE fixer_we > 0)`. Seither meldet
`mart.deckungsbeitrag_warengruppe` bei 173.952 Zeilen **25.608 unter 90 %** und
109.565 ganz ohne Ansatz, Durchschnitt 79,0 %. `mart.pruefung_wareneinsatz` ist
im selben Zug stillgelegt (Stufe 0.3 aus `docs/plan-foodnotify.md`) — reparieren
allein hätte sie nur ehrlich schweigen lassen, die Herkunft von `fixer_we` bleibt
ungeklärt.

**Drei Regeln.**

1. **`IS NOT NULL` ist keine Prüfung auf „vorhanden".** Fremdsysteme liefern
   Abwesenheit als `0`, `''`, `'-'` oder `1970-01-01`. Wer auf `NULL` filtert,
   muss belegen, dass die Quelle `NULL` überhaupt schreibt — sonst prüft er nichts.
   Ein `count(*) FILTER (WHERE x IS NULL)` gegen die Rohtabelle kostet Sekunden.
2. **Ein Wächter, der immer grün zeigt, ist schlimmer als keiner.** Er erzeugt
   Vertrauen statt Aufmerksamkeit. **Jede Warnschwelle braucht einen Testfall, der
   sie auslöst** — sonst ist unbewiesen, dass sie überhaupt auslösen kann.
   Der Test in `e2e.test.ts` prüft deshalb die Ursache, nicht das Symptom:
   solange `fixer_we` nie `NULL` ist, darf keine Sicht auf `IS NOT NULL` filtern.
3. **Eine Verteilung ohne Zwischenwerte ist ein Befund, keine Kuriosität.** Nur
   `NULL` und `100`, nie `73` — das ist kein Datenmuster, sondern eine Bedingung,
   die nicht diskriminiert. Wer so etwas notiert, hat den Fehler schon gesehen und
   muss ihn nur noch als solchen lesen.

## Ein Spalten-Default beschriftet fremde Daten mit dem falschen Absender (02.08.2026)

**Symptom.** In `raw.api_antwort` standen 232 FoodNotify-Antworten mit
`quelle = 'lina'`. Wer nach Quelle filterte, sah: FoodNotify liefert nichts —
dabei lief der Backfill seit Stunden fehlerfrei.

**Ursache.** Die Spalte hat `DEFAULT 'lina'`, gesetzt zu einer Zeit, als es nur
eine Quelle gab. Das Insert in `fnLaden` zählte die Spalte nicht auf — der
Default griff stillschweigend und beschriftete jede FoodNotify-Antwort als LINA.

**Behebung.** Insert nennt `quelle` jetzt explizit (`'foodnotify'`); die
Bestandszeilen wurden am Präfix `fn:` erkannt und umetikettiert — eine Reparatur
der eigenen Metadaten, die Payloads blieben unangetastet. Der e2e-Test prüft
seither, dass jede `fn:`-Zeile `quelle = 'foodnotify'` trägt.

**Regel.** Ein `DEFAULT`, der einen konkreten Absender benennt, ist eine
Falle für jede spätere zweite Quelle. Defaults dürfen Unwissen ausdrücken
(`NULL`, `now()`), aber keine Herkunft behaupten. Beim Anschluss einer neuen
Quelle gehört jede Spalte mit Default auf die Prüfliste: Wer setzt sie — ich
oder die Tabelle?

## Namensvergleich: die beste Ähnlichkeit ist nicht der richtige Betrieb (02.08.2026)

**Aufgabe.** 79 FoodNotify-Restaurants auf 141 LINA-Betriebe abbilden. Es gibt
keinen gemeinsamen Schlüssel, nur Namen. Ohne die Brücke ist keine gemeinsame
Kennzahl möglich: Wareneinsatz kommt von FoodNotify, Umsatz von LINA.

**Drei Fallen, alle gemessen — keine hypothetisch.**

1. **Trigramm allein ordnet falsch zu.** `Enchilada Halle` ist nach reiner
   Trigramm-Ähnlichkeit dem **falschen** Betrieb `Enchilada Hamm` ähnlicher
   (0,63) als dem richtigen (0,53). Behoben durch doppelt gewichtete
   Wortüberschneidung: gemeinsame ganze Wörter wiegen bei Ortsnamen schwerer
   als gemeinsame Buchstabenfolgen.

2. **Der beste Name ist ein schon vergebener Betrieb.** `Aposto Wuppertal II`
   passt namentlich am besten auf `Aposto Wuppertal GmbH` — belegt durch
   `Aposto Wuppertal`. Daneben steht der Zweitstandort `Alter Papierfabrik`.
   Kein Ähnlichkeitsmaß bemerkt das, denn es vergleicht **Paare, nicht die
   Gesamtverteilung**. Wer den schwächeren Treffer auf einen belegten Betrieb
   hat, wird deshalb `unsicher`.

3. **Zwei Normalisierungsfehler, die still danebengreifen.**
   * Rechtsformen *stapeln* sich: `Alte Post Aachen Gaststättenbetriebs GmbH`
     trägt zwei. Ein einzelner Durchlauf entfernt nur `GmbH` — der **aktive**
     Betrieb verlor dadurch 0,4 zu 0,8 gegen `GESCHLOSSEN Alte Post Aachen
     GmbH`, also gegen die stillgelegte Gesellschaft.
   * `translate()` faltet `ü` auf **ein** Zeichen: aus `Münster` wird
     `munster`, aus LINAs `Muenster` bleibt `muenster` — die beiden treffen
     sich nicht. Umlaute müssen **zweistellig** gefaltet werden (ae, oe, ue).

**Regeln.**

1. **Eine falsche Zuordnung ist schlimmer als gar keine.** Sie rechnet den
   Wareneinsatz eines Betriebs gegen den Umsatz eines anderen, und niemand
   sieht es der Kennzahl an. Ein NULL-Wert meldet sich; eine stille
   Fehlzuordnung nicht. Deshalb: der Automat **schlägt vor**, der Mensch
   entscheidet, und `unsicher` bleibt sichtbar offen statt geraten.
2. **„Kein Gegenstück" und „noch nicht angeschaut" brauchen verschiedene
   Felder.** `NULL` kann beides heißen — und dieser Unterschied entscheidet,
   ob eine Lücke eine Aufgabe ist oder ein Ergebnis.
3. **Trefferquoten sind kein Qualitätsmaß.** Eine Quote steigt auch, wenn man
   falscher wird. Getestet werden deshalb die benannten Fallen
   (`src/foodnotify/zuordnung.test.ts`), nicht die Prozentzahl.

## Eine Priorität, die eine Warteschlange in zwei Hälften teilt (02.08.2026)

**Symptom.** Nach Stunden Backfill standen 17.077 Bestellungen in
`core.bestellung` — und **null Positionen**. Kein Lieferant, keine Summe,
kein einziger Preis. Die Abrufe liefen fehlerfrei durch, der Fortschritt
sah gesund aus.

**Ursache.** `sync.posten_holen` sortiert primär nach `prioritaet`. Die
Bestellseiten hatten 90, die Detailabrufe (Kopf und Positionen) 91. Das
heißt nicht „etwas später", sondern **danach** — alle ~30.000 Seiten aller
vier Marken hätten abgearbeitet sein müssen, bevor die erste Bestellung im
Detail geholt worden wäre. Die Liste liefert nur Nummer und Datum; der
gesamte Zweck der Anbindung — Einkaufspreise — steckt im Detail.

**Behebung.** Details auf 89, also **vor** weitere Seiten. Eine Seite bringt
25 Bestellungen, die vollständig geladen werden, dann folgt die nächste.
Bereits eingereihte Posten wurden mit umgestellt.

**Regeln.**

1. **Eine Priorität ist keine Reihenfolge, sondern eine Sperre.** Solange
   ein Posten niedrigerer Zahl offen ist, kommt kein höherer dran. Wer
   zwei Sorten Posten in dieselbe Schlange legt, entscheidet damit nicht
   „erst A, dann B", sondern „B **nie**, solange A nachwächst" — und
   selbsterzeugende Ketten wachsen nach.
2. **Ein fehlerfreier Fortschritt ist kein vollständiger Fortschritt.**
   17.077 Zeilen ohne Inhalt zählen in jeder Fortschrittsanzeige als
   Erfolg. Nach dem Start eines Backfills gehört geprüft, ob die Felder
   gefüllt sind, die den Zweck tragen — nicht nur, ob Zeilen entstehen.

## `tsconfig.json` prüfte ein ganzes Verzeichnis nie (02.08.2026)

**Symptom.** `bun run typecheck` meldete „grün", während in
`metabase/karten-fach.ts` eine doppelte Klammer stand — ein Syntaxfehler,
der die Datei unlesbar machte. Erst ein Test, der die Datei importierte,
brachte ihn ans Licht.

**Ursache.** `"include": ["src"]`. Das Verzeichnis `metabase/` mit 220
Kartendefinitionen und der gesamten Dashboard-Provisionierung lag außerhalb
und wurde nie geprüft. Dabei kamen zwei echte Typfehler zum Vorschein, die
seit Längerem dort standen (`'scatter'` fehlte im Typ `Anzeige`, obwohl die
Anzeige benutzt wird).

**Behebung.** `"include": ["src", "metabase"]`, `Anzeige` um `'scatter'`
ergänzt. Zusätzlich `metabase/karten.test.ts`: jede Kartenabfrage läuft
einmal per `EXPLAIN` gegen die Datenbank — einmal ohne Filter und einmal
**mit** gesetztem Filter, denn der optionale Block `[[...]]` fällt ohne
Wert weg und verbirgt genau die Fehler, die den Benutzer treffen.

**Regeln.**

1. **Ein grüner Typcheck sagt nur etwas über das, was er ansieht.** Bei
   jeder Prüfung gehört die Frage dazu, welchen Teil des Projekts sie
   überhaupt erfasst. `include`/`exclude` sind Teil des Prüfergebnisses,
   nicht Konfigurationsdetail.
2. **Was der Benutzer erst durch Klicken auslöst, muss der Test auslösen.**
   Ein optionaler Filterblock ist im Ruhezustand unsichtbar; geprüft
   werden muss der gesetzte Zustand.

## Ein Importer ohne Arbeit sieht aus wie einer, der fertig ist (02.08.2026)

**Symptom.** Der Importer lief stündlich, fehlerfrei, ohne eine einzige
Fehlermeldung. LINAs Umsatzdaten endeten trotzdem am 25.07. — acht Tage
Rückstand, während im Log alles grün war.

**Ursache.** Einreihen und Abarbeiten waren zwei getrennte Zeitpläne:
`einreihen --taeglich` füllte die Warteschlange, `sync` leerte sie. Der
erste lief seit dem 01.08. nicht mehr. Der zweite lief weiter, fand nichts
zu tun und meldete genau das, was er immer meldet, wenn er fertig ist.

**Aufgefallen ist es nur, weil jemand fragte**, ob auch LINA weiterläuft.
Kein Wächter hätte angeschlagen: die Anzahl der Fehler war null, die
Laufzeit normal, die Warteschlange leer — leer ist im Erfolgsfall genau
das, was man sehen will.

**Behebung.** `sync` füllt die Warteschlange jetzt zu Beginn jedes Laufs
selbst (`src/sync/nachfuellen.ts`). Ein Zeitplan statt zweier, ein
Ausfallpunkt statt zweier. Das Nachfüllen wirft nie — ein Fehler dabei darf
das Abarbeiten nicht verhindern.

**Regeln.**

1. **Zwei Zeitpläne, die voneinander abhängen, sind ein Ausfall, der sich
   als Erfolg meldet.** Wo der eine den anderen mit Arbeit versorgt,
   gehören sie in denselben Prozess. Wer sie trennt, braucht einen
   Wächter auf *Datenaktualität* — nicht auf Fehlerfreiheit.
2. **„Nichts zu tun" und „nichts bekommen" sehen im Log identisch aus.**
   Eine leere Warteschlange ist erst dann ein gutes Zeichen, wenn jemand
   nachweislich versucht hat, sie zu füllen.
3. **Was bei jedem Lauf passiert, muss idempotent sein — und zwar gegen
   ERLEDIGTE Posten.** Der partielle Eindeutigkeitsindex greift nur bei
   offenen. Momentaufnahmen prüfen deshalb ausdrücklich gegen alle Posten
   des Zeitraums; Nachzügler-Tage sollen umgekehrt gerade nachwachsen.
   Beide Fälle haben je einen Test, der genau das festhält.

## Die Attrappe bildete ein plausibleres Schema nach als die echte API (02.08.2026)

**Symptom.** 13.027 Bestellpositionen in `core.bestellposition`, alle mit
Namen, Menge in der Rohantwort, Summe — und **ausnahmslos
`einzelpreis = NULL`**. Damit war die Sicht `mart.einkaufspreis_monat`,
also der ganze Zweck der FoodNotify-Anbindung, ohne Inhalt.

**Ursache.** Die Transformation las die Menge aus `amount`. Dieses Feld ist
in FoodNotifys echten Antworten **immer 0** — die tatsächliche Menge steht
in `adjustedQuantity` (an 13.126 Positionen ohne eine einzige Ausnahme
gemessen). Der Stückpreis ist Summe je Menge; die Division durch 0 wurde
sauber abgefangen und lieferte `NULL`. Nichts fiel um, es fehlte nur alles.

**Warum kein Test das fand.** Die Attrappe in `mock.ts` füllte `amount`,
weil das Feld im API-Inventar so notiert war. Sie bildete damit ein
Schema nach, das plausibler ist als das echte — und prüfte gegen die
eigene Annahme statt gegen das fremde System. Alle Tests waren grün,
während im Bestand jeder Preis fehlte.

Gleiches Muster beim zweiten Feld: `isSubstituted` ist in allen 13.155
Positionen `null`. Was tatsächlich unterscheidet, ist `status`
(`'not arrived'`).

**Behebung.** `adjustedQuantity` mit `amount` als Rückfall; `ersetzt` aus
`status`. Die Attrappe trägt jetzt `amount: 0`, so wie das Original.
**Die 13.254 bestehenden Positionen wurden aus `raw.api_antwort` neu
gerechnet** — ohne einen einzigen erneuten Abruf bei FoodNotify. Genau
dafür ist der Raw-Layer da (AGENTS.md Regel 4).

**Regeln.**

1. **Eine Attrappe, die man aus der Dokumentation baut, prüft die
   Dokumentation.** Fixtures gehören aus einer echten Antwort abgeleitet —
   notfalls aus `raw.api_antwort`, das genau dafür jede Antwort aufbewahrt.
2. **Ein Feld, das es gibt, ist kein Feld, das gefüllt ist.** `amount`
   existiert in jeder Antwort und ist überall 0. Vor dem Verlassen auf ein
   Feld gehört ein `count(*) FILTER (WHERE feld > 0)` gegen den Rohbestand.
3. **Eine sauber abgefangene Division durch 0 verbirgt den Fehler, statt
   ihn zu melden.** `NULL` ist hier kein Schutz, sondern eine stille
   Niederlage: die Zeile entsteht, die Zahl fehlt, niemand merkt es. Wo
   ein Wert IMMER berechenbar sein muss, gehört das geprüft — nicht
   umgangen.

## Eine Grenze, die für zwei Anbieter gleichzeitig gilt (02.08.2026)

**Lage.** Der Importer spricht mit zwei Firmen: LINA und FoodNotify. Beide
Clients lasen dieselbe Drosselung (`TAKT_MIN_MS`/`TAKT_MAX_MS`) und —
schwerwiegender — dasselbe `TAGESBUDGET`, gezählt über **alle** Zeilen in
`sync.aufgabe`, gleich von welchem Anbieter.

**Was daraus folgte.** Ein FoodNotify-Backfill mit 36.000 Posten hätte das
gemeinsame Budget aufgebraucht und LINAs Tagesdaten mit gedeckelt. Im
Worker stand zudem `if (budgetLina === 0 || budgetFn === 0) break` — ein
erschöpftes Budget beendete den **ganzen** Lauf, auch für den Anbieter,
dessen Grenze unberührt war.

Das ist kein Fehler, den man an einer falschen Zahl erkennt: beide Grenzen
waren korrekt eingehalten. Falsch war, dass sie überhaupt eine gemeinsame
Grenze waren.

**Behebung.** `FN_TAKT_MIN_MS` / `FN_TAKT_MAX_MS` / `FN_TAGESBUDGET`, ohne
Angabe auf die LINA-Werte zurückfallend. Die Zähler filtern jetzt auf
`endpunkt LIKE 'fn:%'` beziehungsweise `NOT LIKE`. Der Worker bricht erst
ab, wenn **beide** Budgets leer sind; Posten des erschöpften Anbieters
werden zurückgelegt und auf den Folgetag vertagt — ohne Fehlereintrag, denn
eine Budgetgrenze ist eine gewollte Entscheidung und kein Zwischenfall.

**Regeln.**

1. **Eine Ratenbegrenzung gehört dem Gegenüber, nicht dem eigenen
   Prozess.** Wer zwei Fremdsysteme anspricht, braucht zwei Zähler. Eine
   geteilte Grenze bedeutet, dass ein Anbieter den Zugang zu einem anderen
   verbrauchen kann.
2. **Ein Standardwert darf nie riskanter sein als der Rückfall.** Wer
   `FN_*` nicht setzt, bekommt LINAs vorsichtige Werte — nicht den
   schnelleren Takt, nur weil FoodNotify ihn verträgt.
3. **Bei zusammengesetzten Grenzen auf den EFFEKTIVEN Werten prüfen.** Ein
   einzeln gesetztes `FN_TAKT_MIN_MS` muss gegen den *geerbten* Höchstwert
   geprüft werden, sonst entsteht still eine Spanne, die es nicht gibt.

## Ein Test, der bei Misserfolg die Umgebung kaputt hinterlässt (02.08.2026)

**Symptom.** Nach einem fehlgeschlagenen Testlauf scheiterte plötzlich
**jede** Suite gegen die Testdatenbank mit `relation "sync.warteschlange"
does not exist` — auch die, die zuvor grün waren.

**Ursache.** Ein Test prüfte, dass ein Fehler beim Nachfüllen den Lauf
nicht abbricht. Er erzeugte den Fehler über
`ALTER TABLE sync.warteschlange RENAME TO warteschlange_weg` und benannte
im `finally` zurück. Schlug eine Zusicherung davor fehl, brach der Test ab
— und je nach Ablauf blieb die Tabelle umbenannt zurück. Ab da war die
Datenbank für alle folgenden Läufe unbrauchbar, und die Fehlermeldungen
zeigten auf Stellen, die nichts damit zu tun hatten.

**Behebung.** Der Fehler wird jetzt über eine `CHECK`-Bedingung erzeugt,
die jedes INSERT zurückweist. Selbst wenn das Aufräumen misslingt, bleibt
nur eine Regel zurück statt einer fehlenden Tabelle — reparierbar, ohne
dass man erst herausfinden muss, welcher Test wann was umbenannt hat.

**Regeln.**

1. **Ein Test darf keine Struktur verändern, deren Wiederherstellung er
   selbst garantieren muss.** `finally` läuft nicht, wenn der Prozess
   stirbt. Was die Umgebung für andere Tests zerstören kann, gehört in
   eine Transaktion mit `ROLLBACK` oder in eine Form, deren Rückstand
   harmlos ist.
2. **Fehlermeldungen nach einem beschädigten Testlauf zeigen auf die
   Symptome, nicht auf die Ursache.** Wenn plötzlich viele Suiten
   scheitern, die nichts gemeinsam haben außer der Datenbank, ist die
   erste Frage nicht „was ist am Code kaputt", sondern „was hat der letzte
   Lauf hinterlassen".

## Eine Restlaufzeit, die Arbeit mitzählt, die dieser Lauf nicht anfassen kann (03.08.2026)

**Symptom.** Ein Lauf meldete eine Viertelstunde lang „rest: 4 h 06 min", die Zahl bewegte
sich kaum — und dann endete er schlagartig nach elf Minuten mit `status: 'ok'`, `ok: 82`,
`notiz: 'Schlange leer'`. Beides stimmte. Nur beschrieben sie nicht dasselbe.

**Ursache — zwei Fehler übereinander.**

1. `offen` zählte **alle** unerledigten Posten. `sync.posten_holen()` nimmt aber nur, was
   `faellig_ab <= now()` erfüllt (Migration 0021). An dem Abend lagen 1.778
   FoodNotify-Posten auf den Folgetag vertagt, weil deren Tagesbudget schon **vor** dem
   Start erschöpft war (40.003 von 40.000). Dieser Lauf konnte sie per Definition nicht
   anfassen — die Schätzung rechnete sie trotzdem mit.
2. Die Budgetgrenze war `config.TAGESBUDGET`, also **LINAs**. Seit dem 02.08.2026 hat jeder
   Anbieter sein eigenes (10.500 gegen 40.000). Die „4 h 06 min" waren exakt
   `1.795 / 10.500 × 24 h`: FoodNotify-Posten, geteilt durch LINAs Tagesbudget. Eine Zahl
   über zwei Systeme, von denen keines so arbeitet.

Weil der Budget-Term den Tempo-Term überstieg, hing die Anzeige allein an einer Zahl, die
sich je Posten um eins verringerte — daher die Unbeweglichkeit. Real zu tun hatte der Lauf
82 LINA-Posten; nach elf Minuten war er fertig.

**Und derselbe Fehler noch einmal, eine Ebene tiefer.** Nach dem Fix stand da wieder
„4 h 05 min" — diesmal aus dem **Tempo**-Term. Der maß **ein** gemitteltes Tempo für beide
Anbieter: die ersten 50 Posten des Laufs waren LINA (8 s je Posten, die Personalkosten
allein 20 s), und diese Zahl wurde auf eine Schlange angewandt, die zu 98 % aus FoodNotify
bestand — dort sind es 1,2 s. Ein Sechstel der Wahrheit, mit derselben Selbstsicherheit
vorgetragen. Dass die Zahl beide Male fast gleich herauskam, ist Zufall und war das
Verwirrendste daran.

**Und ein drittes Mal, im Fix selbst.** Die erste Fassung des getrennten Tempos lieh einem
Anbieter ohne eigene Messung das Tempo des anderen — „eine geliehene Zahl ist besser als
keine". Der nächste Lauf führte es sofort vor: wieder elf Minuten „4 h 06 min", weil
FoodNotify **1.794 der 1.809 fälligen Posten** stellte und noch keinen einzigen gemessen
hatte. Eine geliehene Zahl ist eben keine Messung. Hat ein Anbieter fällige Arbeit, aber
keine eigene Messung, gibt es jetzt **gar keine** Schätzung — dieselbe Entscheidung, die
schon für den allerersten Posten galt.

**Behebung.** `fortschritt` zählt jetzt getrennt nach Anbieter und **nur Fälliges**
(`marke_key IS NULL` = LINA, wie in der Schleife). Der Budget-Term nimmt je Anbieter seine
eigene Grenze und den langsameren von beiden — sie teilen sich eine Schleife. Der
Tempo-Term misst ebenfalls je Anbieter und rechnet als Summe: LINA-Posten mal LINA-Tempo
plus FoodNotify-Posten mal dessen Tempo. Was vertagt ist, steht als eigenes Feld `vertagt` daneben: die
Zahl ist richtig, sie ist nur keine Restlaufzeit.

Dazu heißt „Schlange leer" nur noch dann so, wenn die Schlange leer ist. Liegt Arbeit
vertagt herum, sagt die Notiz das mit Anzahl und Datum.

**Regeln.**

1. **Eine Fortschrittsanzeige muss dieselbe Auswahl treffen wie der Arbeiter.** Wer
   `faellig_ab` beim Holen filtert und beim Zählen nicht, zählt Arbeit, die es für diesen
   Lauf nicht gibt. Der Filter gehört an beide Stellen oder an keine.
2. **Getrennte Grenzen brauchen getrennte Rechnungen.** Als LINA und FoodNotify sich ein
   Budget teilten, war eine Zahl richtig. Seit sie es nicht mehr tun, ist dieselbe Zahl
   eine Vermischung — und sie fällt nicht auf, weil sie plausibel aussieht. Das gilt für
   jede Grenze, die sich getrennt hat: Budget **und** Takt. Wer nur die eine nachzieht,
   hat den Fehler halb behoben und merkt es an einer Zahl, die sich kaum bewegt hat.
3. **Eine geliehene Zahl ist keine Messung.** Ein Rückfall auf einen fremden Messwert ist
   dort vertretbar, wo er eine Kleinigkeit überbrückt — nicht dort, wo der ungemessene Teil
   die Mehrheit stellt. Dann ist er eine Erfindung mit Nachkommastelle. Lieber kein Wert:
   ein fehlendes Feld liest sich als „weiß ich noch nicht", eine falsche Zahl nicht.
4. **Ein Lauf, der nichts Fälliges findet, ist nicht fertig.** „Leer" und „nichts fällig"
   sehen im Log gleich aus und bedeuten das Gegenteil: einmal ist die Arbeit getan, einmal
   liegt sie noch da. Wer den Unterschied nicht schreibt, sucht am nächsten Tag nach
   verlorenen Daten.

## 4,44e-16 ist keine Menge — und riss eine ganze Bestellung mit (03.08.2026)

**Symptom.** Vier `fn:bestellpositionen`-Posten hingen mit bis zu **neun** Versuchen im
Backoff, HTTP-Status 200, Fehlertext `error: numeric field overflow`. Die Antwort war in
Ordnung, das Schreiben nicht.

**Ursache.** FoodNotify bildet `adjustedQuantity` offenbar als Differenz zweier
Fließkommazahlen. Kommt glatt null heraus, steht in der Antwort nicht `0`, sondern der Rest
der Rundung: `4.4408920985006262e-16`. In JavaScript ist dieser Wert **truthy** — er rutschte
durch die `menge &&`-Prüfung des Stückpreises. Danach: `156,44 / 4,44e-16 = 3,5 · 10^17`.
`numeric(14,6)` trägt acht Vorkommastellen, Postgres bricht ab.

Und es fiel nicht die Position um, sondern die **ganze Bestellung samt Kopf** — Laden ist
eine Transaktion. Eine einzelne Zahl aus dem Rundungsrauschen kostete vier vollständige
Bestellungen.

Ein zweiter Weg in denselben Überlauf lag daneben: aus derselben Menge wurde
`menge × Gebinde × Inhalt` gerechnet, und war das Ergebnis knapp über null, galt es als
Gesamtmenge — dann wäre auch `preis_je_einheit` explodiert.

**Behebung.** Beträge unter `1e-6` gelten beim Lesen der Menge als null (`nullFalls0`);
darunter liegt keine Bestellmenge, die jemand aufgibt, und so weit rundet die Datei ohnehin.
Zweite Verteidigungslinie ist `jeEinheit()`: ein Quotient, der nicht in `numeric(14,6)`
passt, wird **nicht geschrieben**. Eine fehlende Zahl ist besser als ein abgebrochener
Import, und die Position steht mit ihrer Menge weiterhin da.

**Regeln.**

1. **`x &&` prüft nicht auf „ungleich null", sondern auf „truthy".** Jede Zahl aus einer
   fremden Fließkommarechnung kann numerisch null sein und trotzdem durchkommen. Wer damit
   dividiert, braucht eine Schranke, keine Wahrheitsprüfung.
2. **Ein Ausreißer darf nur seine eigene Zeile kosten.** Steht das Laden in einer
   Transaktion, nimmt ein Spaltenüberlauf alles mit, was daneben stand. Was nicht in die
   Spalte passt, gehört vorher abgefangen — im Transformer, nicht in Postgres.
3. **Die Spaltenbreite ist eine Zusicherung, die der Transformer einhalten muss.**
   `numeric(14,6)` heißt „unter 10^8". Wer das nur in der Migration weiß und nicht im Code,
   erfährt es beim ersten echten Beleg.

## Ein 403 auf einer Kostenstelle legte eine ganze Marke still (03.08.2026)

**Symptom.** 584 offene FoodNotify-Posten der Marke Enchilada lagen 24 Stunden auf
Wiedervorlage. Auslöser: **zwei** Aufrufe mit HTTP 403.

**Ursache.** Der Client stuft 403 wie 429 als Sperre ein, und der Worker vertagt bei einer
Sperre **alle** offenen Posten der Marke. Das ist für 429 richtig („zu schnell" gilt für den
Zugang) und für 403 falsch: nachgemessen am 03.08.2026 antwortet Kostenstelle 11805 dem
Enchilada-Zugang mit 403, während **dieselbe Anmeldung** 10059 und 10064 unmittelbar danach
fehlerfrei liefert. FoodNotify betreibt in einem Mandanten auch Betriebe, die uns nicht
gehören — 403 heißt dort „diese Kostenstelle nicht", nicht „dieser Zugang nicht".

Ein einzelner fehlender Anspruch hielt damit einen ganzen Backfill an.

**Behebung.** Ein 403 vertagt nur noch **seinen** Posten (24 h, nicht aufgeben: ein Anspruch
kann nachgetragen werden, und ein Aufruf am Tag kostet nichts). Die Marke arbeitet weiter.
Die Gegenprobe ist `fehlerInFolge++`: sagt der Zugang wirklich überall nein, stoppt der Lauf
nach `ABBRUCH_NACH_FEHLERN` — dann liegt es am Konto und nicht an einer Kostenstelle.
429 und Anmeldefehler bleiben marken-weit.

**Regeln.**

1. **403 und 429 sind verschiedene Antworten.** „Du darfst das nicht" gilt für eine
   Ressource, „du bist zu schnell" für den Zugang. Wer beide gleich behandelt, macht aus
   einer fehlenden Berechtigung einen Betriebsausfall.
2. **Bevor eine Sperre auf viele Posten wirkt, muss die Gegenprobe im Code stehen.** Ob der
   Zugang oder die Ressource gemeint ist, entscheidet der nächste Aufruf auf eine andere
   Ressource — nicht die Vermutung beim Schreiben der Fehlerbehandlung.

## Eine Zeile, die in sich stimmt und trotzdem falsch ist (03.08.2026)

**Symptom.** Die Karte „Einkaufspreise im Verlauf" zeigte **48.400 €/kg
für Kaffee**. Nicht als Ausreißer weit unten, sondern ganz oben, wo man
zuerst hinsieht.

**Erste Ursache, behoben.** `totalUnitQuantity` entspricht normalerweise
`menge × packagingQuantity × unitQuantity` — an 310.032 von 310.761
Positionen bestätigt. Bei 2.116 von 20.750 Waren weicht es ab. Die
Transformation rechnet die Menge seither selbst und verweigert den Preis,
wo beides sich widerspricht.

**Zweite Ursache, die schwerere.** Das reichte nicht. FoodNotify liefert
für dieselbe Ware *beide* Felder falsch — und dann ist die Zeile **in sich
stimmig**:

```
packagingQuantity 50, unitQuantity 0,007    →  0,35 kg  →     38 €/kg
packagingQuantity  1, unitQuantity 0,00035  →  0,00035 kg → 48.400 €/kg
```

`1 × 1 × 0,00035 = 0,00035`. Die Rechnung geht auf. Für sich betrachtet
ist keine der beiden Zeilen widerlegbar — erst **nebeneinander**: dieselbe
Ware, derselbe Lieferant, Faktor 1.275 im Preis.

**Warum auch das nicht reichte.** Der Vergleich muss über den *Namen*
laufen, nicht über die Warennummer: derselbe Kaffee trägt acht
verschiedene `ware_key`, und innerhalb einer Nummer ist der Fehler
konsistent — alle elf Zeilen bei 48.400 €/kg, der Median genauso hoch,
nichts fällt auf. Und selbst dann bleibt ein Rest: „Entcoffeiniert" gegen
„Ent**k**offeiniert" sind zwei Namen, und in der kleineren Gruppe ist der
Fehler durchgängig.

**Die Lösung war, die Kennzahl zu wechseln.** Der Preis **je Gebinde**
braucht nur `sumPrice` und `adjustedQuantity` — beide sauber. Median
14,36 € über 310.496 Positionen, dreizehn Werte über 1.000 €. Der Preis je
Kilo hängt an einer Stammdatenangabe, die der Lieferant pflegt und
niemand prüft; der Gebindepreis hängt an dem, was auf der Rechnung steht.

**Regeln.**

1. **Eine Zeile, die in sich stimmt, kann trotzdem falsch sein.** Wo alle
   Felder zueinander passen, aber gegen ihresgleichen nicht, hilft keine
   Zeilenprüfung — nur der Vergleich mit der Verteilung.
2. **Die Prüfung gehört dorthin, wo der Vergleich möglich ist.** Beim
   Laden einer einzelnen Position ist die Verteilung noch nicht bekannt.
   Deshalb Nachlauf (`src/sync/einkaufspreis.ts`), nicht Ladepfad.
3. **Wenn eine Kennzahl an einem unzuverlässigen Feld hängt, wechsle die
   Kennzahl — nicht den Filter.** Man kann lange an Schwellen feilen. Die
   bessere Frage ist, ob es eine Zahl gibt, die dasselbe beantwortet und
   weniger fremde Annahmen braucht. „Was kostet ein Karton?" ist ohnehin
   die Frage, die im Einkauf gestellt wird.
4. **Was ausgeschlossen wird, muss sichtbar bleiben.**
   `mart.einkauf_pruefung` zeigt jede verworfene Position mit Grund und
   dem üblichen Preis daneben. Eine stille Kürzung liest sich wie
   Vollständigkeit.

## 320 Bestellungen mit Kopf und ohne eine einzige Position (03.08.2026)

**Symptom.** Ab 21:00 UTC stieg der Anteil HTTP 500 bei `fn:bestellpositionen` von 0 auf
30 %, im Log lief „posten aufgegeben" im Minutentakt. Nach vier Versuchen gibt der Worker
einen Posten endgültig auf — 266 Stück, und in `core.bestellung` stehen jetzt **320 von
28.047 Bestellungen (1,1 %) mit Kopf, aber ohne eine einzige Position**.

**Ursache — und die falsche Fährte zuerst.** Der Anstieg sah nach Überlastung aus: er kam
plötzlich, mitten in einem Backfill, der seit Stunden lief. Die naheliegende Reaktion wäre
gewesen, den Takt zu drosseln. Nachgemessen ist es das Gegenteil einer Lastfrage:

| in 6 Stunden gemessen | |
|---|---|
| Bestellungen, die nach einem 500 doch noch geladen wurden | **0** |
| Bestellungen, die bei allen vier Versuchen 500 lieferten | **271** |
| Bestellungen ohne einen einzigen 500 | 3.821 |

Ein 500 ist hier **bestellungsbezogen und deterministisch**. Bestimmte Bestellungen bringen
FoodNotifys `/change`-Endpunkt zu Fall, gleich wie langsam man fragt. Der Sprung um 21:00
war kein Lastsignal, sondern eine Zeitregion der Historie mit vielen solcher Bestellungen —
der Backfill läuft rückwärts durch die Jahre, und 2023 und 2025 sind besonders betroffen
(74 und 88 Fälle, fast alle bei Enchilada).

**Was daraus folgt.** Zwei Dinge, die sich widersprechen könnten und es nicht tun:

1. Der Takt darf schneller werden — das Fehlerbild sagt nichts über Belastbarkeit.
2. Die 266 Bestellungen sind **endgültig weg**, und zwar leise: `core.bestellung` trägt
   Nummer, Datum, Lieferant und Summe, nur die Positionen fehlen. Eine Auswertung über
   Warenpreise sieht 27.727 Bestellungen und merkt nicht, dass 320 fehlen.

**Offen.** Ein erneuter Versuch kostet vier Aufrufe je Bestellung und liefert nach heutigem
Stand nichts — deshalb bleiben sie aufgegeben. Was fehlt, ist eine **Prüfsicht**, die
Bestellungen ohne Positionen sichtbar macht, statt sie nur im Log zu haben. Ohne die ist es
genau der Fehler, vor dem dieser Katalog oben warnt: eine Zahl, die plausibel aussieht und
unvollständig ist.

**Regeln.**

1. **Bevor man wegen einer Fehlerhäufung drosselt, prüft man, ob der Fehler wiederholbar
   ist.** „Klappt beim zweiten Versuch" und „klappt nie" sehen in einer Fehlerquote gleich
   aus und bedeuten das Gegenteil. Eine Quote je Zeit misst Last, eine Quote je *Objekt*
   misst Daten.
2. **Ein aufgegebener Posten ist ein Datenverlust und gehört nicht nur ins Log.** Der Lauf
   meldet danach weiterhin „ok" — die Lücke steht in einer Tabelle, die niemand ansieht.

## Von Grund auf migriert bricht die Kette — obwohl der laufende Server sauber ist (04.08.2026)

**Symptom.** Bei der Arbeit an Migration `0044` sollte der Ende-zu-Ende-Test einmal gegen
eine wirklich frische Datenbank laufen, nicht gegen den laufenden Entwicklungsserver.
`createdb` plus `bun run migrate` bricht ab:

```
error: column p.gebinde does not exist
Migration 0039_betriebsstatus_und_plausibilitaet.sql fehlgeschlagen
```

**Ursache.** `migrations/0039_betriebsstatus_und_plausibilitaet.sql` liest eine Spalte
`gebinde`, die erst `migrations/0041_einkaufspreis_gebinde.sql` einführt — numerisch
SPÄTER, aber der Migrations-Runner wendet Dateien in alphabetischer Namensreihenfolge an
(`db/migrate.ts`, dieselbe Regel, die AGENTS.md schon für die `0009`-Kollision
dokumentiert). Auf einer leeren Datenbank angewendet, sieht `0039` also eine Spalte, die es
in dieser Reihenfolge noch nicht gibt.

Der laufende Entwicklungsserver (`lina`) ist davon **nicht betroffen** — dort wurden beide
Dateien seinerzeit in der Reihenfolge angewendet, in der sie tatsächlich entstanden sind
(vermutlich nicht die heutige alphabetische), und `public.schema_migration` merkt sich nur
„angewendet ja/nein" je Dateiname, nicht die Reihenfolge. Der Fehler zeigt sich ausschließlich
beim **Nachspielen der ganzen Historie auf einer leeren Datenbank** — also genau bei einem
Restore, einem neuen Dokploy-Deployment oder einer neuen CI-Datenbank.

**Wie diese Migration trotzdem verifiziert wurde.** Nicht durch Reparatur der alten Kette
(„Bereits angewendete Dateien nie ändern", AGENTS.md) — stattdessen ein `pg_dump
--schema-only` vom laufenden `lina`-Server in eine Wegwerf-Datenbank, `schema_migration`
kopiert, `bun run migrate` meldet „aktuell", der Ende-zu-Ende-Test läuft grün. Das prüft die
NEUE Migration `0044` gegen den echten Zielzustand, umgeht aber bewusst das eigentliche
Problem.

**Was offen bleibt.** Ein `dropdb && createdb && bun run migrate` — der Weg, den ein echter
Restore oder ein frischer Server nehmen würde — funktioniert heute nicht. Das betrifft direkt
den Punkt „Restore testen, nicht nur das Backup" in `docs/offene-punkte.md`. Reparieren
hieße entweder die betroffenen Dateien inhaltlich zusammenlegen (wie am 26.07.2026 schon
einmal für zehn ältere Migrationen gemacht) oder eine der beiden 0039-Dateien so
umzunummerieren, dass die alphabetische und die tatsächliche Abhängigkeitsreihenfolge wieder
übereinstimmen — beides nur mit Blick auf `public.schema_migration` der echten Datenbank,
nicht blind.

## Ein Befehl, der laut Dokumentation nur einen Server startet, schrieb sofort nach Produktion (10.08.2026)

**Symptom.** Ein Agent rief `bun run metabase/uebernehmen.ts` auf, um die neu gebauten
Kartendefinitionen prüfen zu lassen — die Prüfungen (Überlappung, Mindesthöhe, tote und
taube Filter, Klickziele) laufen ganz am Anfang und werfen, bevor irgendetwas angelegt wird.
Erwartet wurde nach `docs/dashboards.md` ein Server auf `:8899` und ein Browserschritt.
Stattdessen meldete die erste Zeile:

```text
Übernahme direkt gegen https://cf-analytics.brainfood.technology als importer@brain.food
```

Der Lauf schrieb rund vierzig Karten in die Produktivinstanz, bevor er abgebrochen wurde.

**Ursache.** `uebernehmen.ts` hat seit einer späteren Änderung zwei Betriebsarten: sind
`METABASE_USER` und `METABASE_PASSWORD` gesetzt, meldet sich das Skript selbst an und
überträgt ohne Browser; nur ohne diese Variablen startet es den Server auf `:8899`. In
`.env` sind beide gesetzt. `docs/dashboards.md`, `docs/metabase.md` und `AGENTS.md`
beschrieben ausschließlich den älteren Weg.

**Warum es folgenlos blieb — und warum das kein Verdienst ist.** Die Übertragung ist
idempotent (jede Karte wird über ihren `[key:...]` gefunden und überschrieben), und die
vierzig betroffenen Karten hatten sich nicht geändert: sie wurden mit ihrer eigenen
Definition überschrieben. Ein abgebrochener Lauf hinterlässt deshalb keinen kaputten Stand,
sondern einen unvollständigen — der nächste vollständige Lauf stellt ihn her. Wäre in
derselben Änderung eine bestehende Karte umgebaut worden, stünde die Produktivinstanz jetzt
halb auf dem alten und halb auf dem neuen Stand.

**Was ihn künftig verhindert.** Die Warnung steht jetzt an beiden Stellen, an denen der
Befehl dokumentiert ist (`docs/dashboards.md`, `docs/metabase.md`), und `AGENTS.md` nennt
`uebernehmen.ts` nicht mehr „braucht Browser". Wer nur die Definitionen prüfen will, nimmt
`bun test metabase/karten.test.ts` — der lässt Postgres über jede Karte urteilen, einmal
ohne und einmal mit gesetzten Filtern, und fasst Metabase nicht an.

**Die allgemeine Lehre.** Ein Befehl, dessen Dokumentation einen Zwischenschritt verspricht
(„dann im Browser klicken"), wird als ungefährlich gelesen. Fällt der Zwischenschritt später
weg, ist die veraltete Zeile in der Dokumentation nicht nur ungenau — sie ist eine
Einladung.

## Ein Importer, der die Hälfte des Imports nicht kennt (10.08.2026)

**Symptom.** Keins. Der Sync-Lauf meldete „ok", die Bewertungen waren tagesaktuell, der
Container lief. Aufgefallen ist es nur, weil jemand fragte, ob der Sync die neuen
Yext-Auswertungen synchron hält.

Nachgemessen auf der Produktivdatenbank:

| Tabelle | Zeilen |
|---|---|
| `core.bewertung` | 174.115 |
| `core.bewertung_stand` | 2.819 |
| `core.bewertung_thema` | **0** |
| `core.bewertung_antwort` | **0** |
| `core.bewertung_note` | **0** |

**Ursache.** Migration `0050` brachte den Analytics-Import (Themen, Antwortverhalten,
Notenverteilung, Sichtbarkeit). `analyticsLaden` wurde in `src/yext.ts` eingehängt — dem
Befehl von Hand — und nirgends sonst. `src/yext/nachlauf.ts`, das der Sync ausführt, kannte
die Funktion nicht. Es gab damit keinen Pfad, auf dem diese vier Auswertungen jemals von
selbst geladen worden wären.

**Warum es niemandem auffiel.** Die Karten dazu waren gerade erst provisioniert; eine leere
Karte kurz nach dem Bau liest sich als „läuft noch an". Und der Zeitstempel des Yext-Laufs
war frisch — der Nachlauf lief ja, er lud nur die Hälfte.

**Der teurere Fall wäre der gewesen, der beinahe eintrat.** Hätte jemand `bun run yext`
einmal von Hand ausgeführt, stünden dort Zahlen — und sie wären dort stehen geblieben,
während die Bewertungen daneben weiterliefen. **Ein eingefrorener Wert sieht aus wie ein
gepflegter.** Eine leere Tabelle stellt wenigstens eine Frage.

**Was ihn künftig verhindert.** Drei Dinge, weil eines zu wenig ist:

1. `analyticsLaden` hängt jetzt am Nachlauf — in eigenem `try` und nach `laufMerken`, damit
   ein Fehler dort nicht die rund 400 bereits erfolgreichen Stand-Aufrufe entwertet.
2. `src/yext/nachlauf.test.ts` prüft **statisch**, dass jede exportierte `*Laden`- oder
   `*Fuellen`-Funktion aus `laden.ts` und `analytics.ts` im Nachlauf vorkommt — und dass der
   Nachlauf selbst in `sync.ts` aufgerufen wird. Gegen den Stand vor der Reparatur
   ausprobiert: der Test wäre rot gewesen und hätte `analyticsLaden` beim Namen genannt.
3. `/status` hat eine Prüfung `yext` bekommt. Vorher meldete sie zu Yext **gar nichts** — ein
   abgelaufener Schlüssel oder eine geänderte Antwortstruktur hätte sich nur durch eine
   Bewertungsampel gezeigt, die sich nicht mehr bewegt. Die bewegt sich ohnehin träge.

**Die allgemeine Lehre — es ist dieselbe wie am 02.08.2026, eine Ebene tiefer.** Damals war
es ein zweiter Zeitplan, der ausfiel und LINA acht Tage stillstehen ließ. Diesmal ein
zweiter *Einstiegspunkt*: ein Importer mit einem Weg für Menschen und einem für die
Automatik, und neue Arbeit landete nur auf dem ersten. **Ein Importer ohne Arbeit sieht
genauso aus wie einer, der fertig ist** — und ein Importer, der nur die Hälfte seiner Arbeit
kennt, ebenfalls.

---

## 11.08.2026 — drei Fallen, die beim Nachmessen der Round-Table-Lücken auffielen

Alle drei haben eines gemeinsam: sie melden sich nicht. Es gibt keinen Stacktrace, nur eine
Zahl, die plausibel aussieht.

### `sum(umsatz_netto)` auf `core.umsatzbericht_tag` zählt doppelt

**Symptom.** Zurückgerechnete Arbeitsstunden waren rund doppelt so hoch wie plausibel; der
daraus abgeleitete Stundenlohn lag bei 10,93 € — unter dem Mindestlohn. Die Zahl sah nur
*etwas* zu niedrig aus, nicht offensichtlich falsch.

**Ursache.** Die Tabelle führt je Betrieb und Tag **drei** Zeilen: die Gesamtzeile
(`hauptsparte_key IS NULL`) und je eine für Speisen und Getränke. Ein `sum()` über die
Tabelle addiert den Tag zu sich selbst.

```sql
SELECT CASE WHEN hauptsparte_key IS NULL THEN 'GESAMT' ELSE 'Sparte' END, count(*), sum(umsatz_netto)
  FROM core.umsatzbericht_tag WHERE geschaeftstag >= DATE '2026-01-01' GROUP BY 1;
-- GESAMT  30456  66.950.204
-- Sparte  60771  46.971.209   <- addiert sich mit dazu
```

**Was ihn verhindert.** `mart.umsatz_tag` filtert `hauptsparte_key IS NULL AND
verkaufsstelle_key IS NULL` und ist dafür da. **Für Umsatzsummen immer die `mart`-Sicht
nehmen, nie die `core`-Tabelle.** Nach der Korrektur lag der implizite Stundenlohn bei
21,12 € im Median.

**Verschärfend:** Speisen + Getränke ergeben *nicht* den Gesamtumsatz — 2026 fehlen 29,8 %,
weil 4.088 Artikel keiner Warengruppe zugeordnet sind. Beide Fallen zusammen können sich
gegenseitig verdecken.

### `core.personalkosten.pek_*` ist auf Tagesebene keine Quote

**Symptom.** `pek_gesamt` erreicht Werte bis 717 — als Prozentsatz sinnlos, aber die
Spalte heißt wie eine Quote und die zugehörigen Schwellen (29/35/50) sind Prozentwerte.

**Ursache.** Wir fragen `getPersonalkosten` je Tag ab. LINA bildet den Zähler
(Personalkosten) offenbar **seit Monatsanfang kumuliert**, den Nenner aber aus dem
angefragten Tag. Damit wächst der Wert linear mit dem Monatstag:

| Monatstag | Median `pek_gesamt` | Median `eff_gesamt` |
|---:|---:|---:|
| 1 | 43,8 | 55,7 |
| 15 | 422,8 | 52,3 |
| 31 | 717,6 | 60,1 |

`eff_*` bleibt flach — das ist die Kontrolle, die zeigt, dass nicht der ganze Abruf kaputt
ist, sondern genau dieses Feld.

**Was ihn verhindert.** Für die Personalquote **`persoog_bwa`** nehmen: er stimmt mit dem
BWA-Prozentwert exakt überein (Median-Abweichung 0,000 pp). `pek_*` je Tag nur benutzen, wer
die Kumulation ausdrücklich mitrechnet — `pek(d)/100 × Umsatz(d)` ergibt die aufgelaufenen
Personalkosten des Monats, mit rund 15 % Streuung gegen die BWA. `eff_*` ist von alldem
nicht betroffen und trägt die Stundenrechnung.

### Vierzehn Gästezahlen sind keine Gästezahlen

**Symptom.** „Umsatz je Gast" und jede Bewertungsquote lagen konzernweit um Größenordnungen
daneben, während die Mediane je Betrieb stimmten.

**Ursache.** Einzelne Zeilen tragen im Feld `gaeste` einen Betrag statt einer Anzahl:

```sql
SELECT b.name, u.geschaeftstag, u.gaeste, round(u.umsatz_netto), u.rechnungen
  FROM mart.umsatz_tag u JOIN core.betrieb b USING (betrieb_key)
 WHERE u.geschaeftstag >= DATE '2026-01-01' AND u.gaeste > 100000;
-- Aposto Aalen, 27.07.2026: 46.126.263 Gaeste bei 331 Rechnungen
```

Vierzehn Zeilen 2026, sieben Betriebe. Es sind zu wenige, um in einer Zählung aufzufallen,
und sie zerstören jede Summe.

**Was ihn verhindert.** Bei jeder Gästeauswertung `gaeste BETWEEN 1 AND 10000` filtern und
den Ausschluss benennen. Ein Median hätte den Fehler nie gezeigt — deshalb bei
Gästekennzahlen **immer auch die Summe gegenrechnen**.

---

## 11.08.2026 — fünf Fallen aus dem Bau des Ladenakte-Imports

Vier davon hat erst das Testen gezeigt, eine hat mich beim Arbeiten selbst erwischt.

### `bun run migrate` liest `DATABASE_URL` — auch wenn `TEST_DATABASE_URL` davorsteht

**Symptom.** `TEST_DATABASE_URL=postgresql://…/lina_test bun run migrate` meldete
„apply 0053, apply 0054". Angewendet wurden sie auf **`lina`**, die Produktivdatenbank.

**Ursache.** Der Migrationsrunner liest `config.DATABASE_URL`. `TEST_DATABASE_URL` kennt
nur die e2e-Testdatei. Eine Umgebungsvariable davorzuschreiben, die niemand liest, sieht
aus wie eine Absicherung und ist keine.

**Folgen hier: keine.** Beide Migrationen legen nur an. Der Bestand war unverändert
(1.327.233 Umsatzzeilen, 141 Betriebe), die neuen Tabellen leer, `payload_text` überall
NULL. Es war genau das, was der Deploy ohnehin getan hätte — aber es war nicht die Absicht,
und bei einer Migration mit `UPDATE` oder `DROP` wäre es teuer geworden.

**Was ihn verhindert.** Wer eine Migration gegen eine andere Datenbank fahren will, setzt
`DATABASE_URL` — nichts anderes wirkt:

```bash
DATABASE_URL=postgresql://postgres@localhost/lina_test bun run migrate
```

Und vorher hinsehen, wohin es geht: `psql -tAd <db> -c "select current_database()"`.

### Eine leere Testdatenbank ist nicht dasselbe wie ein Schema-Klon

**Symptom.** `createdb lina_test && bun run migrate` bricht ab. Danach: sechs e2e-Tests
scheitern, obwohl der Code stimmt.

**Ursache, zwei Schichten.** Erstens lassen sich die Migrationen auf einer leeren Datenbank
nicht abspielen (bekannt seit `0039`). Der Ausweg ist ein Schema-Klon:

```bash
dropdb --if-exists lina_test && createdb lina_test
pg_dump --schema-only --no-owner --no-privileges lina | psql -q -d lina_test -v ON_ERROR_STOP=1
```

Zweitens — und das ist die eigentliche Falle — bringt `--schema-only` die **Seed-Zeilen der
Migrationen nicht mit**. `core.marke` hat in der Produktivdatenbank vier Zeilen und im Klon
null; dasselbe gilt für `core.belegart` und `manual.belegarchiv_soll`. Tests, die auf
Stammdaten aufsetzen, scheitern dann an der Umgebung und sehen aus wie Codefehler.

**Was ihn verhindert.** Ein Test, der Stammdaten braucht, **legt sie selbst an**, statt sie
in der Datenbank vorauszusetzen — so macht es die Ladenakte-Suite mit `core.belegart`.
Und wer sechs rote Tests sieht, prüft zuerst gegen den unveränderten Stand
(`git stash`), bevor er den eigenen Code verdächtigt.

### Die zweite Attrappe in derselben Testdatei redet ins Leere

**Symptom.** Vier Ladenakte-Tests liefen einzeln grün und meldeten im Dateilauf drei Fehler.

**Ursache.** `config` wird beim **ersten** Import eingefroren; im Dateilauf ist das die
Attrappe der ersten Suite. Eine spätere Suite startet ihre eigene auf einem anderen Port,
der Client zeigt aber weiter auf den alten. Alle Aufrufe laufen ins Leere — und weil sie
als gewöhnliche Postenfehler ankommen, sieht es nach einem kaputten Lader aus.

**Was ihn verhindert.** Jede Suite, die eine eigene Attrappe startet, zieht die Basis-URL
ausdrücklich nach:

```ts
;(config as { LINA_BASE_URL: string }).LINA_BASE_URL = mock.url
```

Dieselbe Wurzel wie die bekannte `-t`-Falle weiter oben: **eine eingefrorene Konfiguration
und mehrere Testdateien in einem Prozess.**

### LINA schreibt „nicht zugeordnet" auf zwei Arten in dasselbe Feld

**Symptom.** `kreditor_konto IS NOT NULL` zählte 61 von 61 Belegen — obwohl nur 20 ein
Kreditorenkonto haben.

**Ursache.** `kreditor_account` kommt **im selben Ordner gemischt** als leere Zeichenkette
und als Zahl `0`: 33-mal Text, 28-mal Zahl. Dasselbe bei `seller_id`, `cost_account`,
`cost_account7` und `cost_account0`. Wer nur auf `null` prüft, speichert `""` und `"0"` als
Werte.

**Warum das teuer wäre.** `"0"` ist ein Konto, das es nicht gibt. Jede Gruppierung nach
Kreditor bekäme einen erfundenen Sammelposten, der bei 394.552 Eingangsrechnungen der
grösste von allen wäre — und völlig plausibel aussähe.

**Was ihn verhindert.** `kontoZuNull()` in `src/ladenakte/laden.ts`: leer, `-` und `0`
werden NULL. Der e2e-Test prüft die Zahl (20), nicht bloss „nicht leer".

### Ein Tausenderpunkt zu viel, und die Zahl ist um Faktor 1000 daneben

**Symptom.** Im eigenen Test aufgefallen, bevor etwas lief: `deutscheZahl('1.234.56')`
lieferte `123456`.

**Ursache.** Das erste Muster war `^-?[\d.]+(,\d+)?$` — es akzeptiert beliebig viele Punkte
und wirft sie beim Umwandeln weg. Aus einer verstümmelten Zahl wird so eine plausible.

**Was ihn verhindert.** Tausenderpunkte müssen echte Dreiergruppen sein:
`^-?(\d{1,3}(\.\d{3})*|\d+)(,\d+)?$`. Was nicht passt, wird **NULL statt geraten** — und
NULL fällt in einer Geldspalte auf, eine falsche Zahl nicht.

## 12.08.2026 — drei Fehler, die der erste Ladenakte-Lauf ans Licht brachte

Der Erstlauf im Container (Lauf 83, 03:02–05:16 Uhr) meldete 1240 erledigte Posten und
17 Fehler. Alle drei Ursachen lagen im eigenen Code. Zwei davon standen im Protokoll, die
dritte nicht — sie hätte sich erst im September gezeigt, und dann als Zahl, die stehen
bleibt.

### Ein einziges NUL-Zeichen nimmt einen ganzen Belegordner mit

**Symptom.** 14-mal `la:belegliste` mit `error: unsupported Unicode escape sequence`.
Nicht ein Beleg dieser Ordner ist angekommen.

**Wie viele Ordner das sind, weiss niemand.** Vierzehn Fehlerzeilen sind nicht vierzehn
Ordner: der Fehlerweg setzt `faellig_ab` auf 2,5 bis 7,5 Minuten, und der Lauf dauerte
2 h 14 min — derselbe Ordner ist also mehrfach drangekommen. `src/sync/worker.ts:576`
loggt als einzige der drei Fehlerzeilen weder `postenId` noch `versuche`, deshalb ist die
Zahl aus dem Protokoll nicht zu gewinnen. Sie steht in der Warteschlange des Containers
(Abschnitt 3 von `docs/ladenakte-lauf-pruefen.sql`). **Was hier zunaechst als „14 Ordner"
formuliert war, ist eine Obergrenze und vermutlich deutlich zu hoch.**

**Ursache.** PostgreSQL nimmt U+0000 weder in `text` noch in `jsonb`. Irgendwo in diesen
Ordnern trägt ein Beleg ein NUL im Namen oder in einem Textfeld. Weil `laLaden()` einen
Ordner in **einer Transaktion** schreibt — erst `raw.api_antwort`, dann `core` —, reisst
dieses eine Zeichen den ganzen Ordner mit.

**Warum es kein Ladenakte-Problem ist.** `raw.api_antwort.payload` ist `jsonb`, und dort
landet **jede** JSON-Antwort dieses Projekts. LINA, FoodNotify und Yext hatten dieselbe
Falle; getreten hat sie bisher nur die Ladenakte, weil dort zum ersten Mal Dateinamen aus
eingescannten Belegen durchlaufen. Der wahrscheinlichste NUL-Träger im ganzen Projekt ist
aber ein anderer: Google-Rezensionen über `src/yext/client.ts` — Text, den Fremde tippen und
durch fremde Systeme schicken.

**Was ihn verhindert — und was ihn im ersten Anlauf NICHT verhindert hat.** Es gibt zwei
Wege, auf denen ein NUL in einer JSON-Antwort steckt, und sie verlangen verschiedene
Gegenmittel. Der erste Anlauf hat nur den falschen der beiden behandelt; das steht als
eigener Abschnitt weiter unten, weil es die lehrreichere Hälfte ist.

Heute greifen beide, in `src/lib/text.ts`:

| Weg | im Antworttext steht | PostgreSQL meldet | gefangen von |
|---|---|---|---|
| rohes Byte | `0x00` | `invalid byte sequence for encoding "UTF8": 0x00` | `ohneNullzeichen()` |
| Escape-Folge | die sechs Zeichen `\u0000` | `unsupported Unicode escape sequence` | `jsonOhneNullzeichen()` |

Entfernt wird **ausschliesslich U+0000**: andere Steuerzeichen sind in PostgreSQL zulässig,
und was hier mehr wegputzt als nötig, verfälscht Daten, die hinterher niemand mehr nachsehen
kann (`raw` ist append-only, Regel 4). Und es wird geloggt — eine stille Bereinigung findet
man ein halbes Jahr später in keiner Zahl wieder.

**Nachzuholen ist nichts von Hand.** Auf dem Fehlerweg in `src/sync/worker.ts` bleibt
`erledigt_am` NULL und es greift keine Versuchsgrenze; die Posten stehen mit Wiedervorlage
in der Schlange und werden nach dem Deploy von selbst geholt.

### Die Löschsperre stolperte über einen Hash, der zufällig `add` enthielt

**Symptom.** Dreimal `la:stammdaten` mit
`VerbotenerPfad: … Segment "<85 Hexzeichen, darin irgendwo add>" sieht schreibend aus`.
Drei Betriebe ohne Stammdatenblatt.

**Ursache.** `pfadPruefen()` verglich jedes Pfadsegment per `includes()` gegen
`VERBOTENE_SEGMENTE`. Der Laden-Hash im Stammdatenpfad ist **Hex**, und `add` besteht
ausschliesslich aus Hexziffern. In 85 Hexstellen taucht die Folge mit rund zwei Prozent
Wahrscheinlichkeit auf — bei 131 Betrieben rechnerisch dreimal. Es waren exakt drei.

**Die Ironie steht im selben File.** Der Kommentar über `ERLAUBTE_PFADE` begründet die
Positivliste damit, dass sich eine Sperrliste nicht dicht bekommen lässt — und nennt als
Beispiel `addgesell` gegen `addresse`. Die Sperrliste blieb trotzdem als zweiter Gürtel
stehen, mit derselben Teilstring-Prüfung, und hat als Einzige noch Schaden angerichtet.

**Was ihn verhindert.** Verglichen wird auf **Gleichheit des ganzen Segments**. Das
verliert nichts: der einzige variable Teil eines erlaubten Pfades ist der Hex-Hash, und der
kann kein Schreibsegment *sein*. Dazu ein Test, der jedes Verbotswort, das aus Hexziffern
besteht, in einen Hash einbettet und durchlässt — wer künftig `dead`, `beef` oder `face`
auf die Liste setzt, bekommt sofort einen roten Test statt in acht Monaten drei fehlende
Betriebe.

### Die Monatsauffrischung, die nie wiedergekommen wäre

**Symptom.** Keines. Das ist der Punkt.

**Ursache.** `einreihenWennNeu()` prüfte `NOT EXISTS (… endpunkt = $1 AND parameter = $4)`
ohne jeden Zustandsvergleich. Ein einziger erledigter Posten sperrte damit seinen Platz für
immer. BWA-Historie und Stammdatenblatt sind aber Momentaufnahmen, die
`ladenakteNachfuellen()` ausdrücklich einmal im Kalendermonat erneuern will — die Prüfung
`schonDiesenMonat` steht extra dafür da.

**Was passiert wäre.** Ab September hätte `schonDiesenMonat` korrekt „diesen Monat noch
nicht geholt" gesagt, und das Einreihen wäre wortlos ins Leere gelaufen. Der Lauf hätte
weiter „ok" gemeldet, die Warteschlange wäre leer geblieben, kein Fehler, keine
Schema-Abweichung — und die BWA-Zahlen wären auf dem Stand vom 12.08.2026 eingefroren.
Genau die Sorte Ausfall, die dieses Projekt schon zweimal hatte: ein Lauf, der „ok" meldet
und nichts tut.

**Nachgespielt statt hergeleitet**, in `BEGIN … ROLLBACK` gegen die lokale Datenbank: alter
Code 0 neu eingereihte Posten, korrigierter Code 1.

**Was ihn verhindert.** Drei Zustände, drei Antworten — offen: nicht noch einmal, er kommt
ohnehin dran. `aufgegeben`: nicht noch einmal, sonst wächst die Schlange jede Nacht um
denselben kaputten Posten. `ok` und `keine_daten`: wieder einreihen, wenn der Aufrufer
fragt. Ob überhaupt gefragt wird, entscheidet weiterhin der Aufrufer — beim Belegarchiv
`core.belegarchiv_bestand`, bei den Momentaufnahmen `schonDiesenMonat`.

**Die allgemeine Lehre.** Eine Existenzprüfung ohne Zustandsvergleich ist bei allem, was
sich wiederholen soll, ein stiller Totalausfall auf Zeit. Wer „schon mal dagewesen" prüft,
wo „gerade offen" gemeint ist, baut eine Sperre, die erst nach dem ersten Erfolg zuschnappt
— also dann, wenn niemand mehr hinsieht.


### Nachtrag vom selben Tag: die Korrektur sass an der falschen Stelle

**Symptom.** Keines. Typecheck grün, 586 Tests grün, committet. Erst eine adversarische
Nachprüfung hat gezeigt, dass die Bereinigung den Fall aus dem Protokoll gar nicht berührt.

**Ursache.** Zwei verschiedene Dinge heissen „ein NUL in der Antwort", und ich habe das
falsche behandelt. `ohneNullzeichen()` prüfte den Rohtext auf ein echtes `0x00`. Der Rohtext
enthielt aber keines: LINA liefert die sechs gewöhnlichen ASCII-Zeichen `\u0000`, und erst
`JSON.parse` macht daraus ein U+0000. `JSON.stringify` schreibt es anschliessend wieder als
Escape-Folge — genau die, die PostgreSQL ablehnt.

Nachgemessen, in dieser Reihenfolge:

```
Rohtext enthaelt echtes NUL?      false     ← die Reinigung greift nicht
nach JSON.parse echtes NUL?       true
JSON.stringify erzeugt wieder:    {"name":"Rechnung\u0000.pdf"}
```

**Was der Beleg war, dass es nicht das rohe Byte sein KANN.** Ein rohes `0x00` im JSON-Rumpf
lässt `JSON.parse` scheitern („Unterminated string"). Der Client fängt das ab und meldet
„Antwort ist kein JSON" — der Lader bekommt die Daten nie zu sehen, und die Meldung im
Protokoll wäre eine ganz andere gewesen. Die beobachtete Meldung konnte also nur aus der
Escape-Folge kommen. Die zwei PostgreSQL-Meldungen auseinanderzuhalten war der ganze
Schlüssel; sie stehen in der Tabelle weiter oben.

**Was ihn verhindert.** `jsonOhneNullzeichen()` liest das JSON mit einem Reviver, der die
Zeichenketten beim Parsen säubert. Wichtiger als die Funktion ist der Test:
`src/lib/text.test.ts` prüft nicht „die Funktion tut etwas", sondern die Eigenschaft, auf die
es ankommt — **nach der Reinigung enthält `JSON.stringify` des Ergebnisses kein `\u0000`
mehr**. Gegengeprüft per Mutation: schaltet man die Reinigung aus, fallen vier Tests um.

**Die eigentliche Lehre.** Der erste Anlauf war nicht falsch, weil ich zu wenig nachgedacht
hätte, sondern weil er nirgends widerlegbar war: im ganzen Repository kam kein einziges NUL
vor, also war jede Fassung grün — auch eine, die nichts tut. Ein Fix ohne Test, der ohne ihn
rot wäre, ist eine Vermutung mit Commit-Nachricht. Und schlimmer als wirkungslos war er
beinahe irreführend: die WARN-Zeile „NUL-Zeichen entfernt" wäre nie erschienen, und wer nach
der Wirkung gesucht hätte, hätte Stille gefunden und daraus geschlossen, es habe keine NUL
gegeben.

### Und die Korrektur daneben zog einen neuen Fehler nach

**Symptom.** Ebenfalls keines, ebenfalls erst in der Nachprüfung aufgefallen.

**Ursache.** Die Lockerung an `einreihenWennNeu()` liess ab sofort jeden Posten wieder
einreihen, der weder offen noch aufgegeben war. Der Monatstakt hing aber weiterhin an einer
Prüfung auf `status = 'ok'`. Ein Posten, der mit `keine_daten` endet — bei LINA der
dokumentierte Normalfall, HTTP 500 mit leerem Rumpf —, fiel damit durch beide Netze: er galt
als „diesen Monat noch nicht geholt" und wurde in **jeder** Nacht neu eingereiht. 365 Aufrufe
im Jahr statt zwölf, und in der Statistik sieht es aus wie eine monatliche Momentaufnahme.

**Was ihn verhindert.** Der Wiederholtakt hängt jetzt am **Zeitraum** des Postens und nicht
an seinem Ausgang (`einreihenJeMonat()`) — derselbe Bau, den die LINA-Momentaufnahmen seit
dem 02.08.2026 verwenden. Ein Zeitraum kennt das Problem nicht, weil er nichts über den
Ausgang weiss; er deckt nebenbei auch `aufgegeben` ab, das sonst dauerhaft gesperrt hätte.

**Die allgemeine Lehre, und es ist dieselbe wie eine Ebene höher.** Ein Wiederholtakt, der an
einem Ergebniswert hängt, kennt immer einen Ausgang, an den niemand gedacht hat. Erst war es
„erledigt", dann `keine_daten`, beim nächsten Mal wäre es `aufgegeben` gewesen. Die Frage
„wann ist das wieder fällig?" beantwortet ein Kalender, kein Statusfeld.

---

## 13.08.2026 — drei Quellen ohne Zulauf, und alle drei meldeten „ok"

Gefunden beim Audit zu `docs/plan-datenvollstaendigkeit.md`, alle Zahlen in Produktion
nachgemessen. Die drei Fehler haben nichts miteinander zu tun außer der Form: **keiner
davon hat sich gemeldet.** Kein Stacktrace, kein Fehlerzähler, kein roter Lauf. Lauf 88
meldete am 13.08. um 05:07 genau 269 von 269 Aufgaben erledigt, null Fehler — während
zwei Quellen still standen und eine still abschnitt.

### Das Belegarchiv fror ein, als der Abzug fertig war

**Symptom.** `core.buchungsbeleg` bekam am 12. und 13.08.2026 **null** neue Belege. Die 28
Tage davor lagen im Mittel bei 331 am Tag (Minimum 43, Maximum 702). Der Anteil des
Belegarchivs in `mart.fremdeinkauf` — der Sicht an 18 Kartenstellen — fiel von stabil 76–82 %
auf 52,3 % im August. Fehlende Fremdrechnungen sehen dort aus wie gesunkener Fremdeinkauf.

**Ursache.** `ladenakteNachfuellen()` reihte `la:belegliste` nur für solche Paare aus Betrieb
und Ordner ein, für die es **noch keinen** Bestandssatz mit `records_total > 0` gab. Das ist
die Bedingung eines EINMALIGEN Abzugs, nicht die eines laufenden Abgleichs. Der Abzug lief am
12.08. um 13:25 fertig — von da an lieferte die Bedingung 0 Zeilen. Nachgemessen: die Läufe
85 bis 88 hatten je **null** `la:*`-Aufgaben, alle 621 Posten standen auf „ok".

Torwächter war `manual.belegarchiv_soll`: 1.048 Zeilen, `gemessen_am` durchgehend
2026-08-11, einmal von Hand aus `docs/ladenakte-bestand.csv` in Migration `0053` geschrieben
und seither **von keinem Code fortgeschrieben**. Daraus folgten zwei weitere Lücken, die
niemand als Lücke sah: 6 der 14 Belegarten hatten null Soll-Zeilen und konnten bauartbedingt
nie geholt werden, und 10 Betriebe hatten überhaupt keine Soll-Zeile.

**Was ihn verhindert.** Der Torwächter ist jetzt die **Messung** und keine Liste. Ein neuer
Endpunkt `la:belegzahl` zählt täglich jeden Ordner mit `length=1` — eine Zeile statt bis zu
8,2 MB —, und `laLaden()` reiht den vollen Abzug nach, sobald `records_total` von dem
abweicht, was `core.buchungsbeleg` für dieses Paar hält. Die Menge entsteht als Kreuzprodukt
aus `core.betrieb` und `core.belegart`, beide live gelesen: neue Betriebe und neue Ordner
kommen von selbst dazu.

Geprüft wird auf **ungleich**, nicht auf **gewachsen**. Das ist keine Vorsicht, sondern
gemessen: für alle 621 abgezogenen Ordner stimmten `count(*)` und `records_total` am
13.08.2026 auf den Beleg genau überein, kein einziger Ausreißer. Damit fängt dieselbe
Bedingung auch den mittendrin abgebrochenen Abzug und den in LINA gelöschten Beleg.

**Warum kein Delta-Fenster (`start=<bekannt>`).** Naheliegend und falsch: `start` ist eine
Zeilennummer, keine Beleg-ID. Wird in der Mitte eines Ordners einer gelöscht und einer
angehängt, bleibt `recordsTotal` gleich, das Fenster verschiebt sich, und der neue Beleg
fehlt für immer. Die Gegenprobe dazu ist gemessen: `lina_id` läuft innerhalb eines Ordners
nicht verlässlich mit der Uploadzeit (Korrelation im Mittel 0,991, aber acht Ordner unter
0,9, kleinster Wert 0,779). Die Annahme trägt nicht.

**Die allgemeine Lehre.** Ein Zustand, der „einmal fertig" bedeutet, darf nicht die Bedingung
für „läuft weiter" sein. Der Unterschied fällt genau an dem Tag auf, an dem es fertig wird —
und dann sieht Stillstand aus wie Erfolg.

### Jede Inventur endete bei genau 800 Positionen

**Symptom.** Keines. HTTP 200, kein Fehler, kein Log. Nur: keine der 358 Inventuren in
Produktion hatte mehr als 800 Positionen, und das Maximum war **exakt** 800.

**Ursache.** `/api/erp/stocktakings/{uuid}/items` ist paginiert und sagt es auch —
`{perPage: 800, totalItems: 817, totalPages: 2}`. Der Pfadbau in
`src/foodnotify/endpunkte.ts` kannte keinen `page`-Parameter, und beim Laden gab es keine
Folgeseiten-Kette wie bei `fn:bestellungen`. `auspacken()` las die Seitenangabe die ganze
Zeit korrekt aus; `inventurpositionen()` warf sie im Rückgabewert weg.

**Was gefehlt hat.** Neun Inventuren, zusammen **936 Positionen**, vom 02.02. bis 03.08.2026.
Betroffen waren die größten Inventuren, also die mit dem höchsten Warenwert —
`mart.inventur_schwund` rechnete für sie einen zu kleinen Bestand. Der Kopf wusste es besser
als die Zeilen: `core.inventur.anzahl_positionen` geht bis 1.426.

**Was ihn verhindert.** Der Pfad trägt `page` als **Pflichtparameter** (kein stiller Rückfall
auf 1 — das wäre der alte Zustand mit einem Parameter davor), `inventurpositionen()` gibt die
Seitenangabe mit zurück, und Seite 1 reiht die Folgeseiten rückwärts ein, genauso gebaut wie
bei `fn:bestellungen` und `fn:inventuren`. Dazu `mart.inventur_abgeschnitten` mit der
Erwartung „leer".

**Und was die 936 zurückholt, ohne dass jemand etwas tippt.**
`inventurpositionenNachziehen()` läuft bei jedem Sync-Lauf und vergleicht
`core.inventur.anzahl_positionen` mit den geladenen Zeilen — dieselbe Bauart wie beim
Belegarchiv, eine gemessene Invariante statt einer Liste. Sie ist belastbar: 349 der 358
Inventuren stimmen auf die Position genau überein, neun sind abgeschnitten, **null** andere
Ausreißer, keine einzige Inventur ohne Positionen. Die Bedingung feuert also für genau die
neun und danach für keine mehr.

**Die Falle in der Reparatur, und sie wäre teurer gewesen als der Fehler.** Das Laden ersetzt
die Zählung einer Inventur vollständig (`DELETE`, dann `INSERT`) — richtig, solange eine
Antwort der ganze Stand ist. Sobald geblättert wird, ist sie das nicht mehr: ein `DELETE` je
Seite ließe am Ende nur die LETZTE Seite stehen. Bei der 817er-Inventur wären das 17 statt
817 Positionen, und es sähe aus wie eine sehr kleine Inventur. Gelöscht wird deshalb nur auf
Seite 1, in derselben Transaktion, in der die Folgeseiten eingereiht werden.

**Was die Attrappe nicht konnte.** Sie lieferte für `/items` eine nackte Liste ohne
Seitenangabe. Eine Attrappe, die den Fehlerfall nicht herstellen kann, beweist nichts —
`inv-1` hat jetzt zwei Seiten zu je einer Position.

### 275 aufgegebene Posten, die niemand je wieder ansieht

**Symptom.** 322 Bestellungen über **686.535,93 €** standen mit Kopf, aber ohne eine einzige
Position in der Datenbank. Sie zählen in `mart.einkauf_beleg` voll mit und fehlen in jeder
Positions- und Preissicht.

**Ursache.** `ergebnis = 'aufgegeben'` setzt `erledigt_am`. Der Posten gilt damit als
erledigt, und **kein Code sieht ihn je wieder an** — weder das Nachfüllen noch der Worker.
Gemessen: 275 Posten, ausnahmslos `fn:bestellpositionen`, alle mit HTTP 500 nach vier
Versuchen zwischen dem 02. und 04.08.2026, also im großen Backfill. 1.100 Versuche insgesamt,
keine einzige Rohantwort gespeichert. Die restlichen 47 der 322 sind mit `ok` geladene,
tatsächlich leere Bestellungen — das ist kein Fehler.

**Was ihn verhindert.** `aufgegebeneWiederbeleben()` läuft bei jedem Sync-Lauf und holt
aufgegebene Posten zurück (`versuche = 0`, `erledigt_am = NULL`) — höchstens
`MAX_WIEDERBELEBUNGEN` mal, mitgezählt in `sync.warteschlange.wiederbelebt`, und nur, wenn
derselbe Endpunkt in den letzten 24 Stunden mindestens einmal `ok` geliefert hat. Was danach
noch steht, ist eine Grenze der Quelle und steht als `endgueltig` in
`mart.posten_aufgegeben`; `mart.pruefung_uebersicht` zählt genau diese. Vorher standen sie
nur in `src/status.ts`, das niemand liest, wenn nichts weh tut.

**Warum Wiedervorlage und nicht „Quellengrenze".** HTTP 500 ist eine Aussage über den Server,
nicht über die Bestellung: derselbe Endpunkt hat für 66.000 andere Bestellungen geliefert,
und die Fehler ballen sich auf zwei Tage schwerer Backfill-Last. Eine Quellengrenze sähe
anders aus — 404 oder 403, gleichmäßig verteilt. Zu FoodNotify gibt es keinen Kontakt, die
Frage lässt sich also nur durch einen erneuten Versuch beantworten.

**Warum mit Obergrenze und nicht einfach immer wieder.** Ohne sie wäre der nächtliche
Rücklauf derselbe Bau wie der 403-Zweig in `src/sync/worker.ts`, der seit neun Tagen bei
netto ±0 Versuchen steht: ein dauerhaft kaputter Posten kostete jede Nacht `MAX_VERSUCHE`
Aufrufe und käme nie zur Ruhe.

**Nachtrag vom selben Tag.** Zuerst stand hier ein Handbefehl
(`bun run einreihen --aufgegebene`) mit genau dieser Begründung. Der Einwand stimmte, die
Schlussfolgerung nicht: nicht „dann eben von Hand", sondern „dann eben mit Obergrenze". Ein
Handbefehl ist keine Reparatur, sondern eine Verabredung — und die beiden teuersten Ausfälle
dieses Projekts (02.08. und 12.08.2026) waren ausgefallene Verabredungen. Entscheidung
Eugene, 13.08.2026: kein Befehl auf dem Server.

## 13.08.2026 (abends) — das Review der Reparatur findet die Fehler der Reparatur

Phase 1 lief, war deployt und gemessen (0069/0070 in Produktion, Lauf 89 bestätigte die
Wirkung: 0 abgeschnittene Inventuren, Bestellungen ohne Position von 322 auf 47, 0 endgültig
aufgegebene Posten). Ein unabhängiges Review derselben Implementierung fand trotzdem drei
Fehler — und alle drei sind **von der Reparatur selbst mitgebracht** worden. Das ist die
eigentliche Lehre dieses Abschnitts: eine Reparatur ist neuer Code und verdient dieselbe
Skepsis wie der Code, den sie ersetzt.

### Die Folgeseiten-Sperre hätte die zweite Inventur-Reparatur verhungern lassen

**Symptom.** Keines — noch nicht. Der Fehler war gestellt und hätte beim nächsten Auslöser
zugeschlagen, lautlos wie sein Vorgänger.

**Ursache.** `inventurpositionenNachziehen()` sperrt richtig nur gegen OFFENE Posten. Die
Folgeseiten ab 2 laufen aber über `folgepostenEinreihen()`, und das sperrte gegen ALLE
Posten, erledigte eingeschlossen. `sync.warteschlange` wird nie aufgeräumt — die Sperre ist
also dauerhaft. Beim ZWEITEN Reparaturzyklus einer Inventur mit mehr als 800 Positionen
hätte Seite 1 den ganzen Bestand gelöscht, 800 zurückgeschrieben, und Seite 2 wäre nie wieder
eingereiht worden: der erledigte Zwilling `{uuid, seite:'2'}` aus dem ersten Zyklus blockiert.

**Wie weit es gestellt war.** Am 13.08.2026 in Produktion gemessen: 9 Inventuren über 800
Positionen (Maximum 1.426) — und für **alle neun** stand der erledigte Seite-2-Posten schon
in der Warteschlange. Der zweite Zyklus hätte exakt die **936 Positionen** wieder verloren,
die der erste gerade zurückgeholt hatte, und der Lauf hätte Seite 1 danach jede Nacht neu
gelöscht und geladen. Ausgelöst hätte ihn jede Kopfänderung in FoodNotify — eine ergänzte
oder gelöschte Position genügt.

**Warum der erste Zyklus gut ging.** Reiner Zufall: die alten Posten trugen `{uuid}`, die
neuen `{uuid, seite}`. Der Formatwechsel machte sie zu verschiedenen Idempotenzschlüsseln,
also griff die Sperre einmalig nicht. Ein einmaliger Umstand, kein Schutz — und genau so
etwas liest sich hinterher wie Absicht.

**Was ihn verhindert.** `folgepostenEinreihen()` hat einen Sperrmodus: `'alle'` (Vorgabe, wie
bisher — die Sperre eines EINMALIGEN Abrufs) und `'offen'` (die Sperre eines WIEDERHOLBAREN).
Die Folgeseiten von `fn:inventurpositionen` nutzen `'offen'`; das reicht, weil Seite 1 sie in
DERSELBEN Transaktion einreiht, in der sie löscht. Alles andere bleibt bei `'alle'`. Dazu ein
Test, der den zweiten Zyklus wirklich fährt (`e2e.test.ts`, „der ZWEITE Reparaturzyklus holt
die Folgeseiten wieder mit") — ohne den Fix ist er rot, nachgeprüft.

### Ein in LINA gelöschter Beleg machte den Ordner unheilbar

**Symptom.** Keines im Bestand — aber ein Ordner, der jede Nacht ganz neu geholt wird, ohne
dass sich je etwas ändert.

**Ursache.** Die Abzugsbedingung aus 0069 prüft bewusst auf UNGLEICH und nicht auf KLEINER,
damit sie auch den abgebrochenen Abzug fängt. Nur konnte der Abzug einen geschrumpften Ordner
gar nicht reparieren: `belegeSchreiben()` war ein reiner Upsert, in LINA gelöschte Belege
blieben bei uns stehen. Ab dem ersten gelöschten Beleg galt damit dauerhaft
`gehalten > gezaehlt`, und `mart.belegarchiv_zulauf` pendelte zwischen „abzug eingereiht" und
„abzug fehlt" — Letzteres sagte dabei das Falsche: der Abzug fehlte nicht, er war wirkungslos.

**Gemessen.** Unter 1.645 fertig gezählten Paaren am 13.08.2026 noch **kein einziger Fall**.
Eine Frage der Zeit, kein Akutproblem — LINA löscht selten, aber es kommt vor, und 0069 nennt
den Fall selbst als Auslöser. Der größte freigegebene Ordner hält 12.668 Belege; ein einziger
dort gelöschter Beleg hätte diese Menge jede Nacht neu über die Leitung geschickt.

**Was ihn verhindert.** `verschwundeneEntfernen()` löscht nach einem vollen Abzug die Belege
des Paars `(betrieb_key, typ_id)`, deren `lina_id` nicht in der Antwort steht — in derselben
Transaktion wie der Upsert. Dieselbe Logik wie bei `core.bestellposition` und
`core.inventurposition`: ersetzen statt ewig anhäufen. Sicher ist das, weil die Antwort der
VOLLSTÄNDIGE Ordner ist (`length=100000`, und die Prüfung `zeilen.length === recordsTotal`
lässt nichts anderes durch); archivierte Belege stehen mit in der Liste. Ohne `recordsTotal`
wird nichts gelöscht — aus „unbekannt" darf kein Löschbefehl werden.

**Die Schranke, und warum sie zwei Teile hat.** Mehr als **5 %** eines Ordners UND mehr als
**10 Belege** in einer Nacht sind keine Pflege mehr, sondern ein Befund: dann wirft der Abzug,
die Transaktion läuft zurück, und es wird nichts gelöscht. Der Anteil allein wäre bei kleinen
Ordnern eine Dauerwarnung (Belegart 3970 führt 17 Ordner mit im Schnitt 32 Belegen — dort ist
ein gelöschter Beleg schon über 3 %); die absolute Zahl allein wäre bei den großen blind. Was
die Schranke abfangen soll, ist nicht die Pflege, sondern der Ausfall — LINA räumt einen
Ordner ab, oder die Antwort war trotz `recordsTotal` unvollständig. Im zweiten Fall wäre
unser Löschen der eigentliche Datenverlust.

### „Seit über 36 h nicht gezählt" zählte Betriebe mit, die gar kein Belegarchiv haben

**Symptom.** Eine Kachel, die nie auf null geht — und die deshalb niemand mehr ansieht. Das
ist derselbe Verlust wie eine Kachel, die immer grün ist, nur langsamer.

**Ursache.** Die Ladenakte kennt Betriebe, deren Baumknoten keinen einzigen Ordner führt.
`belegToken()` wirft dafür `KeinBelegarchiv`, der Client macht `keine_daten` daraus — gefragt,
nichts da, kein Retry. Richtig so. Nur bekommen sie damit **nie** eine Zeile in
`core.belegarchiv_bestand`, standen also für immer auf „nie gezaehlt" und für immer in der
Prüfzeile.

**Gemessen — und die erste Messung war zu früh.** Mitten in Lauf 89 (1.645 von 1.974 Paaren)
war kein einziges `keine_daten` dabei. ~~Die ausstehenden 329 Paare gehören zu den 23 noch
nicht gezählten Betrieben — und darunter sind genau die zehn, die die Vollzählung vom
11.08.2026 nicht kannte (drei geschlossene, sechs ohne Geschäft, einer Test). Dort werden sie
auftauchen.~~

**Nach dem fertigen Lauf 89 (18:02) ist das widerlegt:** 1.974 von 1.974 Zählungen, alle 141
Betriebe, **alle mit Status `ok`** — und die 36-h-Zeile steht bei 0. Auch die zehn
Unbekannten haben ein Belegarchiv. Es gibt heute **keinen** Betrieb, der in diese Zeile
fällt.

**Die Reparatur bleibt trotzdem, aber sie ist vorbeugend und nicht heilend.** Der Zweig
existiert im Code und ist erreichbar: ein neu eröffneter Betrieb, oder einer, dessen Ladenakte
noch nicht eingerichtet ist, läuft genau hier hinein, und seine vierzehn Paare stünden dann
für immer in der 36-h-Zeile. Das ist dieselbe Bauform, die 0069 für die Ordner gelöst hat,
eine Ebene höher. Der Unterschied zu 0069 gehört dazugesagt: **dort war der Schaden gemessen,
hier ist er nur möglich.** Wer diesen Eintrag später liest, soll daraus keine Dringlichkeit
ableiten, die die Messung nicht hergibt.

**Was ihn verhindert.** Migration `0071`. `mart.belegarchiv_zulauf` bekommt den Zustand
`kein belegarchiv` und die Spalte `zaehlung_status`; die 36-h-Zeile klammert ihn aus und
führt ihn als eigene Zeile „Belegarchiv: Betrieb ohne Belegarchiv" — Erwartung dort ist
**konstant**, nicht null. Der Zustand ist eng gefasst: nur wo wir auch nichts halten und nie
etwas gezählt haben. Ein Betrieb, der sein Belegarchiv VERLIERT, steht weiter auf „abzug
fehlt" und gehört angesehen.

**Warum die Ausklammerung ein Zeitfenster hat (7 Tage).** Sie stützt sich auf einen Befund,
und ein Befund veraltet. Ohne Fenster nähme ein einziges `keine_daten` aus dem März einen
Betrieb für immer aus der Überwachung — und fiele die Zählung ganz aus, wäre ausgerechnet die
Zeile still, die den Ausfall melden soll. Mit Fenster altert die Ausnahme heraus und der
Betrieb fällt zurück in die 36-h-Zeile. **Eine Ausnahme darf ihren Beleg nicht überleben.**

### Jede Bestellung wurde genau einmal im Detail geholt — und nie wieder

**Symptom.** Keines. In den Einkaufssichten standen Bestellmengen, wo Liefermengen stehen
sollten, und niemand konnte das an der Zahl sehen.

**Ursache.** Dieselbe wie bei allen Befunden dieses Plans: die Detailposten
(`fn:bestellung`, `fn:bestellpositionen`) entstehen aus der Bestellliste über
`folgepostenEinreihen()` — mit der Sperre gegen ALLE Posten, also der Sperre eines
**einmaligen** Abrufs. Für den Backfill war das richtig. Als laufender Abgleich ist es falsch,
und niemand hat den Übergang bemerkt.

**Gemessen am 13.08.2026 in Produktion:**

```sql
SELECT count(*), count(DISTINCT parameter->>'orderId')
  FROM sync.aufgabe WHERE endpunkt = 'fn:bestellung' AND status = 'ok';
-- 66.966 | 66.966   → mehrfach geholt: 0
```

**66.966 Bestellungen, 66.966 verschiedene `orderId`, null Wiederholungen.** 32.812 der
Abrufe stammen vom 04.08.2026 und 6.942 vom 05.08. — das war der Backfill. Danach kam nur
noch dazu, was neu war. Der Bestand: `imported` 47.340, `pending` 16.203, `canceled` 3.350,
`accepted` 61, `finished` 12.

**Was daran hing.** Liefermenge (`adjustedQuantity`), Lieferdatum, Belegnummer und alle
Preisstände kommen aus dem Detail. Der Listen-Upsert frischt nur `status` auf — und auch das
nur, solange die Bestellung auf der **letzten** Seite ihrer Kostenstelle steht. Der Transform
liest `adjustedQuantity` längst korrekt (`transform.ts`); es fehlte allein der erneute Abruf.

**Was ihn verhindert.** `bestelldetailsAuffrischen()` läuft bei jedem Sync-Lauf und reiht
nicht-finale Bestellungen neu ein — an der Alle-Posten-Sperre vorbei, weil die genau das
Problem ist. Der Wiederholtakt hängt stattdessen an
`core.bestellung.detail_geholt_am`, also an einer gemessenen Eigenschaft der Bestellung und
nicht an einem Zustand der Warteschlange. Das ist dieselbe Lehre wie am 12.08.2026: **ein
Wiederholtakt gehört an eine Tatsache, nicht an einen Warteschlangenzustand.**

**Der Nachholauf ist kein Befehl.** Der Nachtrag sah ihn als Handbefehl neben dem Nachtlauf
vor, wie `--historie` und `--foodnotify`. Die Entscheidung vom 13.08.2026 gilt aber weiter
und ist stärker: kein Befehl auf dem Server. Der Nachholauf ist deshalb nur eine
**Obergrenze** (`BESTELLDETAIL_JE_LAUF`, 11.000) im normalen Lauf, **jüngste zuerst**. Damit
ist das rollierende Fenster immer zuerst bedient, der Altbestand arbeitet sich über zwei
Nächte ab, und der Verbrauch fällt danach von selbst auf das Fenster zurück — es muss nichts
abgeschaltet werden.

**Sichtbar, nicht nur getan.** `mart.bestelldetail_stand.nie_aufgefrischt` ist der Rest des
Nachholaufs und muss jede Nacht fallen; `mart.pruefung_uebersicht` führt „Bestellung: Details
im Fenster aelter als 48 h" mit der Erwartung 0. Ohne beides sähe ein stiller Ausfall des
neuen Einreihens wieder genauso aus wie „nichts zu tun".

**Was der Nachholauf nebenbei beantwortet.** Ob `imported` als final gelten darf, weiß
niemand — zu FoodNotify gibt es keinen Kontakt. Bis dahin gilt es als **nicht** final
(konservativ). Der Nachholauf holt diese Bestellungen einmal neu, und der Vergleich vorher
gegen nachher sagt, ob sich alte Bestellungen überhaupt noch ändern. Erst danach lässt sich
entscheiden, ob der lange Schwanz jenseits von 45 Tagen einen Wochentakt braucht oder Ruhe
hat.

### Drei Wege, einen Endpunkt zu aktivieren, ohne dass etwas passiert

**Symptom.** Keines — bisher. Alle drei sind gestellt und noch nicht ausgelöst, weil die
betroffenen Endpunkte auf `aktiv: false` stehen.

**Die drei Lücken** (alle am 13.08.2026 am Code nachgesehen):

1. **`linaNachfuellen()` hat keinen Zweig für `schrittweite: 'monat'`.** Es kennt `tag`,
   `jahr` und Momentaufnahmen. Alle vier `getReport`-Endpunkte tragen `monat`. Wer einen davon
   auf `aktiv: true` setzt, reiht **null** Posten ein und bekommt keinen Fehler.
2. **Der Dispatch in `laden.ts` hat einen stillen `default: break`.** Was dort durchrutscht,
   schreibt raw, meldet „ok" und transformiert nichts.
3. **`sync.warteschlange.betrieb_enc_id` hat keinen Producer.** Der Worker liest die Spalte,
   um daraus `storeId` zu setzen (`worker.ts`) — aber **kein einziger `INSERT` im ganzen Repo
   schreibt sie**. Ein aktivierter Betriebs-Endpunkt liefe ohne `storeId` los, ohne Fehler.

**Warum das zusammengehört.** Es sind drei verschiedene Dateien, aber ein Fehler: das Register
sagt „aktiv", und der Code drumherum hat davon nichts mitbekommen. Wer nur eine der drei
Lücken schließt, steht bei der nächsten wieder da.

**Was ihn verhindert.** `endpunkteZusichern()` prüft alle drei beim Start jedes Laufs und
wirft — mit einer Meldung je Verstoß, nicht nur der ersten. Gegengeprüft: `getReport:97` auf
`aktiv: true` gesetzt liefert alle drei Meldungen auf einmal. Details in `importer.md`.

### Die Ladestandskarte meldete an jedem Abend „… lädt" — für alles

**Symptom.** `mart.einkauf_ladestand.liste_vollstaendig` stand am 14.08.2026 um 00:16 in
**allen 251 Monatszeilen aller vier Marken** auf falsch. Die Karte „Wie vollständig sind die
Einkaufsdaten?" ist als Vertrauensanker deklariert und sagte damit über den gesamten Bestand
seit 2021: unvollständig.

| Marke | Monatszeilen | davon „… lädt" |
|---|---|---|
| Aposto | 60 | 60 |
| Deutsche Konzepte | 56 | 56 |
| Enchilada | 60 | 60 |
| Wilma Wunder | 75 | 75 |

**Ursache.** Die Spalte zählte offene `fn:bestellungen`-Posten je Marke — einen **momentanen
Warteschlangenzustand** — und behauptete damit etwas über die **Daten**. Der nächtliche Lauf
reiht je Kostenstelle die letzte Bestellseite ein; solange die abgearbeitet wird, ist „offene
Seite" der Regelzustand.

**Der Plan hatte hier etwas anderes gemessen** und nannte 60 Enchilada-Zeilen, verursacht vom
hängenden Posten 28629. Das war eine Messung ohne laufenden Lauf. Beide Zahlen stimmen, sie
beschreiben verschiedene Momente — und die schlechtere ist der Normalfall.

**Was ihn verhindert.** Seit Migration `0075` unterscheidet die Sicht nicht mehr „offen oder
nicht", sondern „hat ein ganzer Lauf sie nicht weggearbeitet": `erstellt_am` gegen den Beginn
des letzten beendeten Laufs. Das ist ein Fakt an der Sache statt eines Zustands an der
Schlange — dieselbe Lehre wie bei `detail_geholt_am` (`0072`) und der täglichen Zählung
(`0069`). Ein Test in `src/foodnotify/mart_einkauf.test.ts` hält alle drei Zustände fest.

### Der 403-Zweig hatte kein Ende

**Symptom.** Posten 28629 (`fn:bestellungen`, Enchilada, `erpId` 11805, „Layer-Chemie
Testbetrieb") lag vom 02.08. bis zum 14.08.2026 in der Warteschlange und stand nach zwölf
Tagen immer noch auf `versuche = 0`. Er kostete einen Aufruf am Tag und färbte die
Ladestandskarte.

**Ursache.** `sync.posten_holen()` zählt `versuche` hoch, der 403-Zweig in `worker.ts` zählt
mit `greatest(0, versuche - 1)` wieder herunter und springt per `continue` am Aufgeben-Zweig
vorbei. Netto ±0 pro Tag. Das ist **bewusst so gebaut** — ein fehlender Anspruch kann
nachgetragen werden — hatte aber keine Obergrenze.

**Was ihn verhindert.** `sync.warteschlange.gesperrt_seit` (Migration `0075`) hält den Fakt
fest, der fehlte: seit wann sagt die Quelle nein. Nach `SPERRE_AUFGEBEN_TAGE` (14) wird der
Posten mit `ergebnis = 'kein_zugriff'` geschlossen — **nicht** mit `aufgegeben`, sonst holte
ihn `aufgegebeneWiederbeleben()` dreimal zurück, um dreimal dasselbe 403 zu bekommen.

**Die Gegenprobe gehört dazu:** geschlossen wird nur, wenn derselbe Endpunkt derselben Marke
in den letzten 24 Stunden irgendwo ein `ok` hatte. Sagt der Zugang überall nein, ist es das
Konto und keine Ressourcengrenze — dann bleibt der Posten liegen. Ohne diese Bedingung
räumte ein abgelaufenes Passwort nach vierzehn Tagen den halben Bestand als „Quellengrenze"
weg. Der Ende-zu-Ende-Test prüft beide Ausgänge.

### Eine Tabelle mit vier Lesern und keinem Schreiber

**Symptom.** `sync.fortschritt` stand seit Migration `0005` (26.07.2026) auf **0 Zeilen**.
`src/health.ts` liest daraus `pausierteKombinationen` und meldete strukturbedingt für immer
„null pausierte Endpunkte". Ebenso `mart.sync_status` und zwei Sichten aus `0019`/`0039`.

**Ursache.** Kein einziger `INSERT` im Repo schrieb sie. Der Name kollidiert dabei mit einer
lokalen Hilfsfunktion `fortschritt()` in `worker.ts`, die nur ins Log schreibt — wer danach
greppt, findet Treffer und hört auf zu suchen.

**Warum das die gefährlichste Sorte Prüfung ist.** Sie schlägt nie aus. Eine Prüfung, die
nicht ausschlagen kann, wird nicht hinterfragt, sondern geglaubt.

**Was ihn verhindert.** `standSchreiben()` in `worker.ts` (Migration `0075`) schreibt sie bei
jedem Ausgang fort: Erfolg, `keine_daten`, Wiedervorlage, Aufgeben. `pausiert_bis` trägt dabei
genau die Wiedervorlage, die der Worker gerade gesetzt hat — die Selbstdrosselung sitzt seit
langem als `faellig_ab` am Posten und nicht als Pause an der Kombination. Ein Ende-zu-Ende-Test
prüft nach einem echten Lauf, dass alle sechs Endpunkte dastehen.

### Der Schwund rechnete mit dem, was er selbst unplausibel nennt

**Symptom.** `mart.inventur_schwund` wies für den Februar 2026 **minus 2,97 Mio €**
aus — aus einer einzigen Zeile.

**Ursache.** `mart.inventurposition` kennzeichnet seit Migration `0062` jede
Position über 50.000 € als `unplausibel`. `mart.inventur_schwund` liest dieselbe
Basistabelle, hat das Kennzeichen aber nie ausgewertet. Am 14.08.2026 in
Produktion: **123 von 82.126 Positionen**, verteilt auf 53 Inventuren.

**Die allgemeine Form:** eine Kennzeichnung, die nur eine von zwei Sichten
kennt, ist keine. Sie beruhigt an der einen Stelle und wirkt an der anderen
weiter.

**Was ihn verhindert.** Seit `0077` filtert `mart.inventur_schwund` genauso —
und nennt in `positionen_unplausibel` und `wert_unplausibel`, was dabei
herausfiel. Ein Ende-zu-Ende-Test baut den Fall nach: zwei normale Positionen
(1.100 € Soll, 100 € Schwund) und eine über 3 Mio €; erwartet werden 1.100 und
100, nicht 3.001.100.

### Ein Beleg aus 2038 machte vier Frischeangaben unbrauchbar

**Symptom.** `max(monat)` stand in `mart.einkauf_kreditor_monat`,
`mart.fremdeinkauf`, `mart.buchungsbeleg_monat` und
`mart.wareneinsatz_beleg_monat` auf **2038-01**. 20 Lieferanten trugen ein
Zukunftsdatum als „letzter Beleg".

**Ursache.** 13 von 605.835 Belegen tragen ein Belegdatum, das mehr als ein Jahr
NACH ihrem eigenen Hochladedatum liegt — vier davon auf 2038-01-19, hochgeladen
2025. Ein Erfassungsfehler in LINA, und dorthin reicht niemand von uns.

**Was ihn verhindert.** `belegDatum()` in `src/ladenakte/laden.ts` setzt
`beleg_datum` in diesem Fall auf NULL und hebt den Rohwert nach
`beleg_datum_roh` — dieselbe Behandlung wie bei unglaubhaften Beträgen (`0058`).
Alle vier Sichten filtern ohnehin auf `beleg_datum IS NOT NULL`; die Zeilen
fallen also von selbst heraus, ohne dass eine Sicht geändert werden musste.

**Die Grenze hängt am Upload und nicht an einer Jahreszahl.** Eine feste
Schranke („nach 2030 ist falsch") veraltet still und wird irgendwann selbst zum
Fehler. Ein Jahr Toleranz, weil Voraus- und Dauerrechnungen regulär in der
Zukunft liegen: 39 Belege liegen mehr als 30 Tage voraus, aber nur 13 mehr als
ein Jahr. Rückwärts wird nicht gefiltert — 6.802 Belege datieren mehr als zehn
Jahre vor ihrem Upload, das sind nachgereichte Altbelege.

**Und was verworfen wird, bleibt lesbar:** `mart.belegdatum_ausreisser`. Eine
Bereinigung ohne eigene Anzeige wäre derselbe stille Zweig wie der Fehler davor.

### `eintraege_live` war vier Monate leer — ein Wort daneben

**Symptom.** `core.betrieb_sichtbarkeit.eintraege_live` stand in **allen 1.497
Zeilen** auf NULL, während die neun übrigen Metriken derselben Antwort gefüllt
waren (`impressionen_google` 1497, `klicks` 1497, `genauigkeit` 1497). Die
Spalte hängt an 6 Kartenstellen und zeigte dort eine dauerhaft leere Spalte
hinter einer grünen Statusampel.

**Ursache.** Angefordert wird `POWERLISTINGS_LIVE`, gelesen wurde
`LISTINGS_LIVE` (`src/yext/analytics.ts`). `zahl()` liefert für eine unbekannte
Metrik `null` statt zu werfen — richtig so, denn Yext lässt Metriken für
einzelne Betriebe weg. **Genau diese Nachsicht hat den Tippfehler getragen.**

**Der Plan hatte hier die falsche Frage gestellt:** „erst prüfen, ob Yext das
Feld überhaupt liefert — wenn nicht, gehört die Spalte aus der Karte". Yext
liefert es. Die Spalte bleibt.

**Was ihn verhindert.** Ein Test in `src/yext/nachlauf.test.ts` vergleicht, was
`bericht(...)` **anfordert**, mit dem, was `zahl()`/`text()` **liest** — ein
Name auf nur einer der beiden Seiten ist der Fehler. Gegengeprüft: mit
`LISTINGS_LIVE` fällt er sofort mit genau diesem Namen aus.

### Zwei Handbefehle, die zuletzt am 03.08.2026 liefen

**Symptom.** Zwei Zustände, die man den Daten nicht ansieht:

* Alle `core.bewertung_stand`-Zeilen vor Mai 2026 tragen denselben
  `geladen_am` — den 03.08.2026. Der Bestand sieht vollständig aus (25 Monate,
  2.819 Zeilen, 60 Betriebe) und altert still: **gelöschte** Bewertungen ändern
  auch alte Stände, und die sieht das Drei-Monats-Fenster des täglichen Laufs
  nie.
* **Sieben operative Betriebe** haben keine Yext-Zuordnung: B+L Pforzheim,
  BS Bier & Speisen, Gastronomie Wilsdruffer Straße, SCHAFFERONE,
  WHK Gastronomie, Wirtshaus am Schlossplatz, Wirtshaus Lautenschlager. Sie
  fehlen in jeder Bewertungstabelle — und zwar lautlos: `staendeLaden()` fragt
  je zugeordnetem Betrieb, ein nicht zugeordneter erzeugt keine leere Zeile,
  sondern gar keine.

**Ursache.** Beides hing an `bun run yext --voll` bzw.
`bun run yext:zuordnen --schreiben`. Dieselbe Signatur wie überall in diesem
Projekt: **eine Reparatur, die ein Mensch anstoßen muss, ist keine Reparatur,
sondern eine Verabredung.**

**Was ihn verhindert.** Beides läuft seit dem 14.08.2026 im nächtlichen Lauf,
alle `YEXT_VOLLABGLEICH_TAGE` (30). Der Takt hängt an einem Merker und nicht am
Monatsersten — sonst machte der Ausfall eines einzigen Laufs den Ausfall eines
ganzen Monats. Sichtbar in `mart.yext_abgleich` und `mart.betrieb_ohne_yext`,
mit je einer Prüfzeile.

### Die Bewertungsnote in der Ampel war einen Tag alt

**Symptom.** Zwei Betriebe trugen im Round Table dauerhaft eine Bewertungsnote
aus dem Vortag.

**Ursache.** `yextNachlauf()` war der **letzte** Nachlauf in `src/sync.ts`,
hinter `roundTableNachlauf()` — und `mart.round_table_monat` ist seit Migration
`0039` materialisiert. Die Note kam an, nachdem die Sicht schon aufgefrischt war.

**Die allgemeine Form:** ein Nachlauf, der hinter seinem eigenen Leser steht,
ist einen Tag alt, ohne dass es jemandem auffällt. Dieselbe Falle wie bei
`zuordnungNachlauf()`, die am 13.08.2026 dieselbe Antwort bekommen hat.

**Was ihn verhindert.** `yextNachlauf()` steht jetzt als zweiter Nachlauf, vor
allem Materialisierten. Ein Test in `src/yext/nachlauf.test.ts` vergleicht die
beiden Positionen in `sync.ts`.

---

## 14.08.2026 — der übersprungene Lauf sah aus wie ein erfolgreicher

**Symptom.** Der 05:00-Start füllte die Warteschlange, übersprang den Import (Lauf 90
hielt die Laufsperre bis zu seinem Abbruch um 08:00) und lief danach 15 Minuten
Nachläufe und Yext. In Dokploy: grün, flott, unauffällig. Genau so wurde er gelesen —
als durchgelaufener Sync. Dass kein einziger Posten importiert wurde, stand in einer
einzigen Logzeile (`lauf übersprungen — es läuft bereits einer`) und sonst nirgends;
in `sync.lauf` fehlte der Start komplett.

**Warum das mehr ist als ein Schönheitsfehler.** Es ist zum dritten Mal dieselbe
Signatur (02.08.: Einreihen als eigener Zeitplan fiel aus; 12.08.: Belegarchiv fror
hinter „269 von 269 ok" ein): ein Zweig, der „nichts zu tun" bedeutet, war nur im Log
sichtbar — und Logs liest niemand (AGENTS.md Regel 10). Eine Kette übersprungener
Starts während eines langen Backfills sieht in der Lauf-Historie aus wie ein Loch im
Zeitplan.

**Fix (`0081`, `worker.ts`).** Jeder Start, der nicht arbeitet, hinterlässt eine
sofort beendete Zeile in `sync.lauf`: `uebersprungen` (Notiz nennt den blockierenden
Lauf) oder `gesperrt` (Notiz nennt Art und Ablauf der Zugangssperre). Sichtbar in
`mart.sync_status` und `mart.import_lauf`.

**Die Falle im Fix.** Zwei Leser meinen „letzter echter Lauf" und müssen die neuen
Zustände ausklammern, sonst kippt der Fix ins Gegenteil: `status.ts` prüft die letzten
drei beendeten Läufe auf „alle fehlgeschlagen" — drei Skips verdeckten drei echte
Fehlschläge; `health.ts` misst „veraltet" am jüngsten `beendet_am` — ein Tag voller
Skips hielte `/health` ewig frisch, während der Import steht. Beide filtern jetzt,
beide Tests dazu in `e2e.test.ts` („Sperre gegen parallele Worker").

---

## 19.08.2026 — was der Umbau auf zwei Schleifen ans Licht brachte

Drei Befunde. Der erste bestand schon, der zweite entstand durch den Umbau
und wurde vorher behoben, der dritte ist die Sorte, die man dreimal sucht.

### 1. Ein Kommentar behauptete das Gegenteil dessen, was der Code tat

**Symptom.** In `src/sync/worker.ts` stand über dem FoodNotify-Client:
„Eigener Takt (anderes Zielsystem), **aber dasselbe Tagesbudget aus derselben
Zählung** — der eine Worker bleibt die eine Bremse."

**Befund.** Falsch seit dem 02.08.2026. Der Satz kam am 04.08.2026 herein und
beschrieb den Stand davor. `src/foodnotify/client.ts` zählt seither
`endpunkt LIKE 'fn:%'` gegen `FN_TAGESBUDGET` — zwei Budgets, nicht eines.

**Warum das teuer war.** Der Satz war das einzige geschriebene Argument gegen
genau den Umbau, der jetzt gemacht wurde. Wer ihn las, hielt die Serialität
für eine tragende Entscheidung. Sie war ein Überbleibsel.

**Was ihn verhindert.** Der Kommentar steht jetzt durchgestrichen mit Datum
darüber, nicht gelöscht — sonst stellt der Nächste dieselbe Annahme neu auf.
Das ist der dritte Fall dieser Klasse in diesem Projekt.

### 2. `core.partition_anlegen` vertrug keine zwei gleichzeitigen Anrufer

**Symptom (nachgestellt, PostgreSQL 18.4).** Zwei gleichzeitige Aufrufe für
dieselbe noch fehlende Partition, mit einem `pg_sleep` im Fenster zwischen
`IF NOT EXISTS` und `EXECUTE`:

```
[B] COMMIT
[A] ERROR:  relation "p_2026_10" already exists
[A] CONTEXT: SQL statement "CREATE TABLE part.p_2026_10 PARTITION OF ..."
```

Das reißt die ganze Ladetransaktion mit.

**Wann es aufgetreten wäre.** Alle drei Ladepfade rufen `partition_anlegen`
als erste Handlung ihrer Transaktion, mit
`unnest(ARRAY[current_date, current_date + 1])`. Das Fenster ist also der
**letzte Tag jedes Monats**, beim ersten gleichzeitigen Ladepaar. Ein Fehler,
der an einem Tag im Monat auftritt, wie ein zufälliger Ladefehler aussieht und
danach durch die Wiedervorlage verschwindet.

**Behebung.** Migration `0083`: `CREATE TABLE IF NOT EXISTS` **plus**
`EXCEPTION WHEN duplicate_table OR duplicate_object OR unique_violation THEN
NULL`. Zwei Gürtel, weil `IF NOT EXISTS` das Fenster nicht vollständig
schließt. Der BRIN-Index bekommt dabei seinen Namen ausgeschrieben — ohne
Namen gibt es kein `IF NOT EXISTS`, und der Fall „CREATE TABLE hat
übersprungen" legte sonst einen **zweiten** BRIN-Index auf dieselbe Spalte an:
erlaubt, still, und dauerhaft doppelte Schreiblast.

**Bleibt offen:** `CREATE TABLE ... PARTITION OF` hält eine
`AccessExclusiveLock` auf die *Eltern*tabelle bis zum COMMIT. Solange eine
Ladetransaktion offen ist, warten die INSERTs der anderen Schleife in
`raw.api_antwort`. Einmal im Monat, Dauer einer Ladetransaktion. Siehe
`offene-punkte.md`.

### 3. Ein Test, der grün war, ohne etwas zu zeigen

**Symptom.** Der erste Entwurf des Tests „beide Schleifen arbeiten
verschränkt" zählte die Herkunftswechsel in `sync.aufgabe` und verlangte
`> 1`. Er war grün — **auch gegen den alten, seriellen Worker**, gemessen in
einem Arbeitsbaum auf `HEAD`.

**Ursache.** Der Aufbau benutzte die vier FoodNotify-A1-Posten, die mitten im
Lauf Folgeposten mit anderer Priorität nachreihen. Auch seriell entstanden so
zwei Blöcke und damit zwei Wechsel. Der Test maß die Priorisierung, nicht die
Nebenläufigkeit.

**Behebung.** Der Aufbau ist jetzt der Test: beide Anbieter auf derselben
Priorität, FoodNotify auf `current_date`, LINA im Juni 2026 — eine Schleife
arbeitet damit erst den einen, dann den anderen Block ab, also genau **ein**
Wechsel. Dazu eine künstliche Antwortverzögerung in beiden Attrappen
(`langsamMs` bzw. `fnMock.langsam()`), weil bei Takt 0 sonst die eine Schlange
fertig ist, bevor die andere ihre erste Antwort hat. Gegengeprüft: rot auf
`HEAD`, grün nach dem Umbau.

**Die Lehre, und sie ist die alte.** Ein neuer Test muss gegen den
zurückgebauten Fix **rot** sein. Sonst ist er die Sorte Prüfung, die nie
ausschlägt und deshalb nie hinterfragt wird — dieselbe Klasse wie „grün hieß
nichts gefunden, nicht geprüft".

## Eine Gegenprobe, die den ganzen Bestand nicht gesehen hat (20.08.2026)

**Symptom.** Der Umbau von `mart.vergleichstag` von `LATERAL`-je-Zeile auf
Fensterfunktionen war am 14.08.2026 mit „null Abweichung" gegengeprüft worden.
Der Entwurf verlor trotzdem Zeilen, und eine Spalte war falsch.

**Ursache.** Die Gegenprobe lief über **einen Betrieb und 222 Tage in 2026**.
In diesem Ausschnitt kommen beide Fehler nicht vor:

1. `WHERE vorher > 0` im Entwurf warf die Zeilen am **Anfang der Historie**
   weg — dort gibt es noch keinen vergleichbaren Vortag. Die `LATERAL`-Fassung
   behält sie mit `vergleichstage = 0`. In 2026 gibt es keine solche Zeile.
2. `ferien_abweichung` ist bei `vergleichstage = 0` eine Zählung über die
   **leere Menge**, also `0` und nicht `NULL`. Der Entwurf lieferte `NULL`.
   Betroffen: **1.661 von 9.432 Zeilen (17,6 %)** — weit überwiegend
   dauerhafte Ruhetage, denn ein Betrieb, der montags schließt, hat für jeden
   Montag einen leeren Vorrat. In einem Ausschnitt aus 2026 über einen Betrieb,
   der täglich öffnet: null Fälle.

**Was ihn heute verhindert.** `src/sync/vergleichstag.test.ts` schneidet über
**Betriebe** zu, nicht über den Zeitraum: drei Betriebe mit *voller* Historie,
rund 9.400 Zeilen. Zwei Zusicherungen im Test sorgen dafür, dass ein leeres
oder verkürztes Ergebnis nicht als „null Abweichung" durchgeht — die Probe muss
mehr als 1.000 Zeilen haben **und** mindestens eine mit `vergleichstage = 0`.

**Die Lehre.** Bei einer Rechnung, die je Betrieb und Wochentag über die
gesamte Historie läuft, ist ein Zeitausschnitt keine Stichprobe, sondern eine
andere Rechnung. Zuschneiden über die Entität, nie über die Zeitachse.

## Ein Filter, der nicht durchgereicht wird (20.08.2026)

**Symptom.** `SELECT * FROM mart.vergleichstag WHERE betrieb_key = 42` sah nach
einer billigen Abfrage aus. Eine Gegenprobe über sechs Betriebe lief nach
zwanzig Minuten noch, und ein `pkill` auf den `psql`-Client beendete den
Serverprozess nicht — die Abfrage hielt weiter eine Sperre, an der die nächste
Migration hängenblieb.

**Ursache.** Die Sicht referenziert ihre CTE `basis` **zweimal** (als `b` und
als `r2` in der `LATERAL`). Postgres inlined nur **einfach** referenzierte
CTEs; `basis` wird also materialisiert, und der Filter auf `betrieb_key` wird
nicht hineingereicht. Die Sicht baute für jede Abfrage alle 188.640 Zeilen auf
und scannte sie je Ergebniszeile erneut.

**Was ihn heute verhindert.** Die Sicht liest seit `0084` eine
Materialisierung; der Filter trifft einen Index. Für Gegenproben wird die
**Basis** klein gemacht, nicht das Ergebnis gefiltert.

**Zwei Lehren.** Ein `WHERE` auf einer Sicht ist keine Zusicherung, dass
weniger gerechnet wird — bei mehrfach referenzierten CTEs ist es das Gegenteil.
Und: `pkill` beendet den Client, nicht die Abfrage. Wer eine lange Abfrage
loswerden will, braucht `pg_terminate_backend`, sonst arbeitet sie weiter und
sperrt.

## Der Nullpunkt lag nicht bei null (20.08.2026)

**Symptom.** In der ersten Fassung der Effektsichten sah fast jede Kategorie
leicht negativ aus. Ein *gewöhnlicher* Tag stand bei −3,5 %, und damit hätten
die Kacheln der Reihe nach gemeldet, die Gruppe liege unter ihrem eigenen
Schnitt.

**Ursache.** Kein Fehler in den Daten, sondern die Bauart des Vergleichs: ein
einzelner Tag wird gegen den **Mittelwert** von vier Tagen gestellt.
Tagesumsätze sind rechtsschief — ein paar sehr starke Tage, viele mittlere —,
und bei einer rechtsschiefen Verteilung liegt der Mittelwert über dem Median.
Der typische Tag liegt also unter dem Schnitt seiner vier Vorgänger, ohne dass
irgendetwas schiefgelaufen wäre.

**Was ihn heute verhindert.** `mart.kalendereffekt` und
`mart.kalendereffekt_gruppe` führen `basis_pct` (der gewöhnliche Tag dieses
Betriebs) und `median_gegen_basis_pp` (die Zahl, die man eigentlich meint). Die
Kategorie `brueckentag` enthält dafür ausdrücklich eine Zeile *gewöhnlicher
Tag*, und die Kategorie `wochentag` bleibt stehen, obwohl sie bauartbedingt
nichts misst — beide sind der Maßstab, an dem man einen echten Effekt erkennt.

**Die Lehre.** Wenn eine Kennzahl einen impliziten Nullpunkt hat, muss er
gemessen und danebengestellt werden. Sonst liest jeder gegen die Null, und die
ist hier um dreieinhalb Punkte verschoben.

## Ein Etikett, das für die Hälfte der Zeilen falsch war (20.08.2026)

**Symptom.** Die Zeile „Tag in den Ferien, Vergleichstage nicht" zählte 12.494
Tage. Nachgerechnet waren es 6.430.

**Ursache.** Die Einordnung fragte nur `ferien_abweichung <> 0` — also *irgendein*
Unterschied unter den vier Vergleichstagen. Die Beschriftung behauptet aber
etwas Stärkeres: dass **alle vier** anders liegen. 6.064 Tage mit ein bis drei
abweichenden Vergleichstagen liefen unter einem Etikett, das für sie nicht galt,
und zogen den Median mit.

**Was ihn heute verhindert.** `mart.kalendertag_lage` verlangt
`ferien_abweichung = 4` für die beiden klaren Lagen und führt die Mischfälle als
eigene Zeile *gemischte Ferienlage*.

**Die Lehre.** Eine Klassengrenze, die weicher ist als ihre Beschriftung, ist
eine falsche Zahl mit einer richtigen Überschrift — und niemand liest die
Definition nach, wenn die Überschrift plausibel klingt.

## Ein Join auf einem Ausdruck, und der Plan kippte bei mehr Daten (20.08.2026)

**Symptom.** Der Refresh von `mart.vergleichstag_basis` brauchte 40,9 s. Ohne
jeden Codeeingriff lief er am selben Tag **ins Zeitlimit** — Abbruch nach
1.075 s.

**Ursache.** Dazwischen hatte eine zweite Session den Kalender-Nachlauf
repariert. Der Bestand wurde vollständiger: 10 Bundesländer wurden 16, 1.127
Feiertagszeilen wurden 1.760, 591 Ferienzeiträume wurden 1.268. Damit kippte
der Ausführungsplan von `mart.betrieb_kalender`:

```
Merge Cond:  (p.kuerzel = ftf.kuerzel)
Join Filter: (ftf.datum = (u.geschaeftstag + 1))
```

Vor- und Folgetag wurden als **Ausdruck** im Join gesucht
(`t.geschaeftstag + 1`). Postgres nahm nur das Bundesland als
Verbundbedingung und prüfte das Datum je Zeile als Filter — also für jede der
443.304 Zeilen alle Feiertage dieses Landes, dreimal. Bei zehn Ländern ging das
gerade noch durch.

**Was ihn heute verhindert.** Migration `0088`: Vor- und Folgetag sind Spalten
der Tagesachse statt Ausdrücke im Join, damit ist es eine Gleichheit auf zwei
Spalten und Postgres darf hashen. Die kleinen Verbundtabellen stehen zusätzlich
auf `MATERIALIZED`. Gemessen: **22,0 s** für die Sicht über alle 141 Betriebe,
Wertgleichheit gegen die alte Fassung über 15.720 Zeilen mit null Abweichung
geprüft.

**Die Lehre, und sie ist die teure.** Eine Sicht, die mit dem heutigen Bestand
schnell ist, ist damit nicht schnell. Dieser Plan kippte, weil eine **andere
Baustelle Daten vervollständigte** — die Reparatur war richtig, und trotzdem
war die Folge ein Ausfall. Ein Join auf einem Ausdruck ist die Stelle, an der
so etwas zuerst nachgibt.

## Ein `w.*` in einer Sicht wächst nicht mit (20.08.2026)

**Symptom.** `mart.betrieb_wetter_tag` war als `SELECT s.betrieb_key, b.name,
w.*` gebaut. Nachdem `mart.wetter_tag` in `0087` fünf Spalten dazubekam, fehlten
sie in der Sicht darüber — ohne Fehlermeldung.

**Ursache.** Postgres schreibt die Spaltenliste eines `*` beim Anlegen der
Sicht fest. Was danach in der Quelltabelle entsteht, kommt nie an. Das `*`
sieht mitwachsend aus und ist das Gegenteil.

**Was ihn heute verhindert.** Die Sicht schreibt ihre Spalten aus. Wer eine
`mart`-Sicht auf einer anderen aufbaut, die noch wachsen wird, nennt die
Spalten — oder erzeugt sie in derselben Migration neu.

## Sechzig Sekunden waren zu wenig für ein altes Jahr (20.08.2026)

**Symptom.** Ein Wetter-Backfill über 96 Ortsjahre schrieb 596.032 Zeilen und
meldete **30 Fehler** — alle in den Jahren 2024 und älter, keiner in 2025/2026.

**Ursache.** Nicht die Quelle, sondern das Zeitlimit im Client. Nachgestellt
braucht ein Bright-Sky-Aufruf für 2024 **108 Sekunden**, während die jüngsten
Jahrgänge in wenigen Sekunden kommen; das Archiv wird für alte Jahre spürbar
langsamer. Das Limit stand auf 60 s.

**Was ihn heute verhindert.** Das Limit steht auf 180 s, mit der Messung als
Begründung daneben. Wichtiger noch: ein gescheitertes Ortsjahr ist kein
Verlust — `mart.wetter_rueckstand` führt es weiter als `fehlt`, und die nächste
Nacht holt es erneut. Genau dafür ist der Rückstand eine Zahl, die fallen muss
(Regel 10).

**Nebenbefund, gleicher Tag:** die erste Fassung des Schreibers stapelte 500
Zeilen je `INSERT` und brauchte damit 18 Rundreisen für ein Ortsjahr. Bei 60
Ortsjahren je Nacht wäre der Nachlauf allein eine Stunde gelaufen — für Daten,
die in einer einzigen Antwort ankommen. Jetzt ein `unnest` über zwölf Arrays,
ein Aufruf.

## Ein Test, der die Frische maß statt der Logik (20.08.2026)

**Symptom.** `src/sync/vergleichstag.test.ts` wurde rot, ohne dass jemand die
Logik angefasst hatte.

**Ursache.** Er stellte die `LATERAL`-Fassung gegen die **Materialisierung**.
Als die zweite Session den Feiertagsbestand austauschte, rechnete die eine
Seite mit dem neuen Kalender und die andere mit dem alten. Der Test maß damit
die Frische der Sicht, nicht die Gleichwertigkeit des Umbaus — und schlug für
etwas an, wofür er nicht zuständig ist.

**Was ihn heute verhindert.** Zwei getrennte Zusicherungen: *Ist der Umbau
wertgleich?* prüft der Test live gegen live. *Ist die Sicht frisch?* prüft die
Zeile über `mart.vergleichstag_stand` in `mart.pruefung_uebersicht`. Ein dritter
Test hält Materialisierung und Fensterfassung gegeneinander — aber erst, nachdem
er nachgesehen hat, ob der Kalender überhaupt derselbe ist; sonst sagt er es
laut und prüft nicht.

**Die Lehre.** Ein Test, der zwei Eigenschaften gleichzeitig prüft, schlägt bei
der einen an und meint die andere. Wer ihn dann „repariert", repariert die
falsche.

## Die Sicht, die nach vorn schaut, schaute auf eine Achse ohne Zukunft (20.08.2026)

**Symptom.** `mart.feiertag_kalender` — laut Plan „die einzige Sicht, die nach
vorn schaut, und der Grund, warum jemand das Dashboard zweimal öffnet" —
lieferte **null Zeilen**. Fehlerfrei, schnell, leer. Seit ihrer Entstehung in
`0085`.

**Ursache.** Sie baute auf `mart.betrieb_kalender`, und dessen Tagesachse ist
`SELECT DISTINCT geschaeftstag FROM mart.umsatz_tag` — also ausschließlich
Tage, an denen es bereits Umsatz **gab**. Ein `WHERE geschaeftstag >
current_date` darauf kann nichts finden.

**Wie es aufgefallen ist, und das ist der eigentliche Punkt.** Weder der
Kartentest noch die Prüfsichten haben angeschlagen: das SQL war gültig, die
Sicht existierte, die Karte lief. Gefunden wurde es erst, als **jede einzelne
Karte gegen die Produktivinstanz ausgeführt und ihre Zeilenzahl angesehen**
wurde. 15 von 16 trugen Daten oder waren erklärbar leer (Wetter-Backfill läuft
noch); diese eine war es nicht.

**Was ihn heute verhindert.** `0092`: die Tagesachse kommt aus
`manual.feiertag`, nicht aus dem Umsatz. Dazu `mart.feiertag_vorausschau` als
Prüfzeile — eine Vorausschau, die still leer läuft, sieht aus wie „keine
Feiertage in Sicht" und ist von „kaputt" nicht zu unterscheiden.

**Die Lehre.** „Läuft ohne Fehler" ist bei einer Auswertung keine Aussage. Eine
Karte, die null Zeilen liefert, ist von einer richtigen nur durch **Hinsehen**
zu unterscheiden — und zwar auf dem Bestand, für den sie gebaut wurde. Nach
jeder Übernahme jede neue Karte einmal ausführen und die Zeilenzahl lesen.

## Ein Feldfilter auf eine Tabelle mit Alias, zum zweiten Mal (20.08.2026)

**Symptom.** `uebernehmen.ts` brach ab: zwölf der sechzehn neuen Karten trugen
einen Feldfilter `{{zeitraum}}` auf `mart.kalendertag_lage` bzw.
`mart.wettertag_lage`, führten die Tabelle im SQL aber unter dem Alias `l`
beziehungsweise `w`.

**Ursache.** Dieselbe wie am 28.07.2026: Metabase erzeugt aus einem Feldfilter
`WHERE mart.kalendertag_lage.geschaeftstag BETWEEN …` mit dem **Tabellennamen**.
Steht die Tabelle unter einem Alias, findet Postgres die Referenz nicht — und
zwar erst, wenn jemand den Filter setzt.

**Warum der Kartentest es nicht fand.** `metabase/karten.test.ts` ersetzt den
Platzhalter durch eine einfache Bedingung, nicht durch die
tabellenqualifizierte Form, die Metabase generiert. Der statische Prüfer in
`uebernehmen.ts` fand es dagegen sofort — und **vor** dem ersten Schreibzugriff.

**Ein dritter Fall im selben Durchgang, den der Prüfer nicht sehen konnte:**
`kw_tagesliste` ließ den Feldfilter auf `mart.vergleichstag_basis` zeigen,
während das SQL aus `mart.vergleichstag` las. Die Tabelle kam im SQL gar nicht
vor, also gab es auch keinen Alias zu bemängeln. Wer einen Feldfilter setzt,
prüft **beides**: dass die Tabelle im SQL vorkommt, und dass sie ohne Alias
dasteht.
