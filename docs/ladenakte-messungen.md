# Ladenakte — die Messungen, auf denen der Importer aufsetzt

**Erhoben am 11.08.2026** in der angemeldeten Browser-Sitzung des Nutzers, ausschliesslich
lesend. Diese Datei hält die Zahlen fest, die den Bauplan bestimmen. Wer eine davon ändert,
ändert den Importer.

---

## 1. Die Belegliste kennt keine Seitengrenze

Gemessen an Enchilada Karlsruhe (`laden_15`), Ordner Eingangsrechnungen, 8.384 Belege:

| `length` | geliefert | gedeckelt |
|---|---|---|
| 200 | 200 | nein |
| 500 | 500 | nein |
| 1.000 | 1.000 | nein |
| 2.000 | 2.000 | nein |
| 5.000 | 5.000 | nein |
| 10.000 | **8.384 — alles** | nein |
| 20.000 | 8.384 | nein |

**Ein Aufruf holt einen ganzen Ordner.** 8,22 MB, 11,9 s, aufsteigend nach ID sortiert,
`recordsTotal` gleich der Zeilenzahl.

### Was daraus folgt

**Es wird nicht geblättert.** Ein Aufruf je (Betrieb, Belegart) — und damit fällt die
gesamte Fehlerklasse weg, die das Blättern mitbringt: kein verschobenes Seitenraster, wenn
während des Laufs ein Beleg hochgeladen wird, keine Überschneidung, keine Lücke, kein
Sortierstreit. Der Ordner ist entweder ganz da oder gar nicht.

Zum Vergleich, bei 4–6 s Takt:

| Zuschnitt | Aufrufe | Laufzeit |
|---|---|---|
| 200 je Seite | 3.366 + 131 | ca. 4,9 h |
| 1.000 je Seite | 1.099 + 131 | ca. 1,9 h |
| **ganzer Ordner** | **621 + 131** | **ca. 1,3 h** |

Die 621 sind die nicht-leeren (Betrieb, Belegart)-Paare aus
[`ladenakte-bestand.csv`](ladenakte-bestand.csv); 427 der 1.048 Paare sind leer und werden
gar nicht erst aufgerufen.

**Grenzwerte für die Auslegung.** Grösster Ordner: Aposto Mainz, 12.639 Kassenbelege —
hochgerechnet ca. 12,4 MB und ca. 18 s. `ANFRAGE_TIMEOUT_MS` steht auf 60.000, das reicht
mit Abstand. Rohdaten insgesamt: **rund 582 MB**, die in `raw.api_antwort` landen.

> **Die Falle dabei:** `recordsTotal` ist die einzige Zusicherung, dass der Ordner
> vollständig ist. Der Lader muss `data.length === recordsTotal` prüfen und bei Abweichung
> laut scheitern. Ohne diese Prüfung sieht eine stillschweigend gekürzte Antwort aus wie
> ein kleiner Ordner — und das ist genau der Ausfalltyp, an dem dieses Projekt schon
> mehrfach vorbeigelaufen ist.

---

## 2. Die BWA-Zeilen haben eine stabile Nummer

Im Longterm-HTML trägt jede Datenzeile in ihrem Diagramm-Link eine Nummer:

```html
<td class="indent-1">Erlöse Getränke
  <a href="javascript:load_image('/finanzen/bwa/longterm?...&laden=<hash>...
     /img/82/per/0/comp/0/short/0')"> … </a></td>
<td align="right">15.020,68</td> …
```

`/img/82/` → **BWA-Zeile 82 = Erlöse Getränke**. Gemessen an zwei Betrieben:

| | Schlager Cafe Düsseldorf | CF Franchise AG |
|---|---|---|
| Zeilen gesamt | 103 | 103 |
| davon mit Nummer | **77** | **77** |
| Gliederungszeilen ohne Nummer | 26 | 26 |
| Nummernbereich | **82–162** | **82–162** |
| Nummern eindeutig | ja | ja |
| Monatsspalten | 20 (01/25–08/26) | 80 (01/20–08/26) |
| Zellen mit Wert ≠ 0 | 847 | **0** |

**Und dieselben 77 Nummern stehen in der Plan-BWA** des Stammdatenblatts, dort sogar in
einer eigenen Spalte `ID`: 82, 83, 84, 85, 86, 87, 88, 162, …

### Was daraus folgt

**Plan und Ist joinen über die Zeilennummer, nicht über die Beschriftung.** Das ist der
Unterschied zwischen belastbar und geraten: die Beschriftungen sind teils abgeschnitten
(„Freiwillige soz. Auf", „Abschluss-/Pruefungsk"), enthalten Umlaute und können sich bei
jeder LINA-Änderung verschieben. Die Nummer ist ein Schlüssel.

**Die Nummer trennt auch Daten von Layout.** Die 26 Zeilen ohne Nummer sind Leerzeilen zur
Gliederung — sie haben keine Zellen und werden übersprungen. Kein Ratespiel darüber, ob
eine Zeile eine Summe, eine Position oder eine Lücke ist.

**Die Einrückung ist zusätzlich da:** `class="indent-1"` bzw. `indent-2` gibt die Ebene.
Summenzeilen wie `Gesamtleistung` (85) tragen keine Einrückung.

---

## 3. Der Leerfall ist echt und muss abgefangen werden

Die CONCEPT FAMILY Franchise AG liefert **80 Monatsspalten, 77 Zeilen und null Werte**.
Struktur vollständig, Inhalt leer.

Ein Lader, der „Tabelle geparst" mit „Daten vorhanden" verwechselt, schreibt 6.160
Nullzeilen und meldet Erfolg. Deshalb: **die Prüfung geht auf die Zahl der Zellen mit
Wert**, nicht auf die Zahl der Zeilen. Bei null Werten wird nichts geschrieben und der
Betrieb als „ohne BWA" vermerkt — nicht als Fehler, denn eine Holdinggesellschaft ohne
operative BWA ist der Normalfall, nicht die Störung.

Das Fixture `bwa_longterm_leer.html` hält diesen Fall fest.

---

## 4. Das Stammdatenblatt: sieben Tabellen, drei davon wollen wir

| # | Kopfzeile | Zeilen | Verwendung |
|---|---|---|---|
| 0 | Zentrale, Geschäftsführer, Adresse | 13 | nicht importiert |
| 1 | `Bereich \| Plätze \| Tische \| Fläche [qm]` | 6 | **Kapazität** |
| 2 | `ID \| BWA-Zeile \| 1/2025 … 12/2025` | 78 | **Plan-BWA** |
| 3 | `Datum \| Umsatz netto \| Stunden Service \| Stunden Bar \| Stunden Küche` | 366 | **Tagesbudget** |
| 4 | Wechselgeldbestand | 19 | nicht importiert |
| 5 | `Name \| API - Key \| IP-Adressen \| …` | 3 | **niemals** — s. u. |
| 6 | Formular „neuer API-Schlüssel" | 6 | nicht importiert |

Die Tabellen werden **über ihre Kopfzeile** angesprochen, nicht über ihre Position. Ändert
LINA die Reihenfolge, findet der Parser nichts und scheitert laut — statt still die falsche
Tabelle zu lesen.

> ### ⚠ Tabelle 5 enthält Zugangsdaten
>
> Dort stehen die vergebenen API-Schlüssel im Klartext, mit IP-Bindung und Scopes. Der
> Parser muss diese Tabelle **ausdrücklich überspringen**, und zwar als Positivliste
> („lies genau diese drei Kopfzeilen"), nicht als Ausschlussliste. Sonst wandern
> Zugangsdaten in `raw.api_antwort` — eine append-only-Tabelle, aus der sie nicht mehr
> zu entfernen sind, ohne die Versicherung des ganzen Projekts anzufassen.
>
> Das gilt auch für die Rohablage: **das Stammdaten-HTML darf nicht ungefiltert nach
> `raw`.** Entweder vor dem Ablegen die Schlüsselspalte schwärzen, oder von dieser einen
> Quelle gar kein Roh-HTML aufheben. Zu entscheiden und in `entscheidungen.md` festhalten.

---

## 5. Der `storeId`-Token hält mindestens drei Minuten

Gemessen: ein Token war nach **172 s** noch gültig. Er kodiert nur den Betrieb und gilt für
alle 14 Belegarten desselben Betriebs.

Ein Betrieb hat im Schnitt 4,7 nicht-leere Ordner. Bei einem Aufruf je Ordner und 4–6 s
Takt plus Antwortzeit sind das rund 60–90 s je Betrieb — innerhalb der gemessenen
Haltbarkeit. **Ein Token je Betrieb reicht.**

Verlassen darf sich der Lader darauf trotzdem nicht: die tatsächliche Lebensdauer ist
unbekannt, gemessen ist nur eine Untergrenze. Deshalb **Token neu holen und den Aufruf
genau einmal wiederholen**, wenn eine Antwort kein JSON ist oder `recordsTotal` fehlt.
Das kostet im Normalfall nichts und rettet den Betrieb im Ausnahmefall.

Offen geblieben: die Obergrenze. `bun run lina-fragen d9` misst sie über sieben Minuten.

---

## 6. Die Fixtures

Aus echten Antworten, nicht nachgebaut:

| Datei | Inhalt | Grösse |
|---|---|---|
| `src/transform/fixtures/ladenakte_beleglist.json` | Karlsruhe, Ordner BWA, 49 Belege, 38 Felder je Zeile | 61 KB |
| `src/transform/fixtures/bwa_longterm_klein.html` | Schlager Cafe Düsseldorf, 20 Monate, 847 Werte | 147 KB |
| `src/transform/fixtures/bwa_longterm_leer.html` | CF Franchise AG, 80 Monate, **0 Werte** | 454 KB |
| `src/transform/fixtures/ladenakte_stammdaten.html` | Karlsruhe, alle sieben Tabellen | 309 KB |

### Das Stammdaten-Fixture ist geschwärzt — und warum das die richtige Wahl ist

Beim Abspeichern lag die API-Schlüssel-Tabelle mit **echten, gültigen Schlüsseln im
Klartext** in der Datei. Ein Fixture ist eine Datei im Repository; sie zu committen hätte
Zugangsdaten in die Git-Historie geschrieben, wo man sie nicht mehr sauber entfernt. Das
ist genau der Fall, den harte Regel 2 verbietet.

Geschwärzt sind deshalb die beiden Schlüsselwerte (`GESCHWAERZT-SCHLUESSEL`) und die beiden
gebundenen IP-Adressen (`0.0.0.0`). **Die Tabellenstruktur bleibt vollständig erhalten** —
Kopfzeile, Zeilenzahl, alle übrigen Spalten. Der Test kann damit unverändert prüfen, dass
der Parser diese Tabelle überspringt; er prüft die Regel und nicht ein bereinigtes Abbild.

Nebenbei hat die Schwärzung die Scope-Liste sichtbar gemacht, und die ist ein Befund für
sich. Der Schlüssel „Sell & Pick" trägt:

* Artikelstammdaten **schreiben**
* Journaldaten Kasse **lesen**
* Personalstammdaten und Kosten **lesen**
* BWAs und SuSas **lesen**

Die offizielle Schnittstelle kann also genau das, wofür wir gerade HTML parsen — BWAs, SuSas
und Kassenjournal. Das stärkt den offenen Punkt „eigener API-Schlüssel" erheblich: es geht
nicht um eine hypothetische Schnittstelle, sondern um Scopes, die es nachweislich gibt und
die LINA an Dritte bereits vergeben hat.
