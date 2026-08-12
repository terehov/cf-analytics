# Der Systemschnitt — was in ein System gehört

**Zweck:** Die Frage hinter den beiden Ablöse-Dossiers
([abloese-lina.md](abloese-lina.md), [abloese-foodnotify.md](abloese-foodnotify.md)):
Ist der heutige Schnitt — Kasse/BWA/Belegarchiv in LINA, Bestellwesen/Rezepturen/
Inventur in FoodNotify — überhaupt sinnvoll? Und wenn nicht: was muss bei einer
Neuauswahl zwingend in **einem** System liegen? **Stand:** 12.08.2026.

Die These vorweg, weil alle Messungen darauf zulaufen: **Der Schnitt selbst ist
der teuerste Einzelbefund des Projekts — teurer als jeder Mangel innerhalb eines
der beiden Systeme.** Er verläuft mitten durch drei Geschäftsprozesse, die
fachlich eine Kette sind.

---

## 1. Wo der Schnitt messbar wehtut

### Dieselbe Rechnung existiert zweimal, ohne gemeinsamen Schlüssel

Was über FoodNotify bestellt und in LINA gebucht wurde, steht in beiden
Systemen — als Bestellung dort, als Beleg hier, ohne jede Verknüpfung. Jede
Auswertung muss die Regel „nie über `quelle` summieren" kennen; ein einziger
Verstoß zählt fast den ganzen Einkauf doppelt, und die Zahl sähe plausibel aus.
Die Abstimmung der beiden Welten läuft über **normierte Namenstexte**
(`core.kreditor_name_norm`, `manual.kreditor_gruppe`) — die erste Fassung
ordnete 19,1 Mio € eines freigegebenen Lieferanten als Fremdeinkauf ein, weil
die Schreibweisen nicht zusammenfanden.

### Einkaufskontrolle ist im Bestellsystem prinzipiell unmöglich

Fremdeinkauf sichtbar in FoodNotify: **300.750 €**. Im Belegarchiv:
**7.930.024 €**. Das ist kein Qualitätsunterschied, sondern Bauart: wer am
Bestellsystem vorbei kauft, erzeugt dort keine Zeile — die Kontrolle muss
zwingend an der Rechnung ansetzen. Die Rechnungen liegen aber im anderen
System, als OCR-Text ohne Artikelpositionen. Ergebnis: die Frage „durfte dort
gekauft werden?" ist beantwortbar, die Frage „zu welchem Preis, verglichen mit
dem Vertrag?" für 14 Betriebe (30 % des Umsatzes) prinzipiell nicht.

### Schwund ist nicht messbar, weil die Buchungskette am Schnitt abreißt

Verkäufe entstehen in LINA (Kasse), der Bestand lebt in FoodNotify. Der
Verbrauch wird nie gegen den Bestand gebucht — FoodNotifys eigene
Verkaufsverarbeitung ist zudem defekt (`root_recipe_id`, 100 % der Stichproben).
Der theoretische Bestand wächst deshalb mit jeder Lieferung: 971.750 g
Pizzateig Soll gegen 138.000 g gezählt. **Kein System hat hier einen Fehler im
eigenen Zuständigkeitsbereich — die Kennzahl stirbt an der Schnittstelle.**
Dasselbe gilt für den Soll-Wareneinsatz: LINA-Verkäufe × FoodNotify-
Rezepturkosten funktioniert nur über die selbst gefundene PLU-Brücke, die an
Kassensystem „amadeus" hängt — Reichweite 33,9 % des Umsatzes, zusammen mit dem
LINA-Weg ~63 %. Deutsche Konzepte (34,3 %) erreicht keiner der beiden Wege.

### Drei Stammdatenwelten, von Hand verklebt

- **Betriebe:** kein gemeinsamer Schlüssel. ~150 Handzuordnungen in
  `manual.betrieb_fremd_id`/`betrieb_zuordnung`; Namensmatching scheitert
  messbar („Enchilada Halle" → falsches „Enchilada Hamm"). 25 von 152
  Kostenstellen hängen an keinem Betrieb — 1,13 Mio €, die je nach Sicht
  auftauchen oder fehlen.
- **Marken:** zwei Begriffe mit demselben Namen — der FoodNotify-Mandant und
  das Round-Table-Konzept. Zwei Dashboards tragen beide einen Filter `marke`
  mit verschiedenen Wertemengen; eine falsch verdrahtete Karte bleibt dauerhaft
  leer, ohne Fehlermeldung.
- **Artikel/Waren:** LINA-Artikel (verkauft) und FoodNotify-Waren (eingekauft)
  verbindet nur die Rezeptur — je Betrieb eigene Waren-IDs, Brücke über
  Namenstexte.
- **Lieferanten:** je FoodNotify-Mandant ein eigener Vertrag, im Belegarchiv
  OCR-Schreibweisen — der Konzern sieht seinen größten Lieferanten (Distra,
  22,5 Mio €) erst nach manueller Zusammenführung.
- **Zeit:** LINA rechnet Geschäftstage 08:00–07:59 Berlin, FoodNotify führt
  Wiener Zeitzone und zeitzonenlose Etiketten.

### Keiner fühlt sich zuständig — Historie und Preis fallen durch

Eine Einkaufspreis-Historie führt **keines** der beiden Systeme (LINA: nur
aktueller Stand; FoodNotify: nur aktueller Stand). Beide überschreiben Stammdaten. Alles Historische an diesem Projekt
— `<ding>_stand`-Momentaufnahmen, append-only Raw-Layer — existiert, weil beide
Quellen vergessen.

### Der Integrationspreis ist dieses Projekt

Der Schnitt wird heute durch eine dritte Software geheilt: 65+ Migrationen,
ein mart-Schema mit über 50 Sichten, Namensnormierung, Gebinde-Vereinheitlichung,
Sperrwerke, Materialisierungen, getrennte Drossel- und Budgetregime je Anbieter,
zwei Login-Reverse-Engineerings. Ein erheblicher Teil davon ist keine
Analytik, sondern **Klebstoff zwischen zwei Systemen, die nicht voneinander
wissen.** Bei jeder Neuauswahl gilt: dieser Aufwand wandert mit, wenn der
Schnitt mitwandert.

---

## 2. Was zusammengehört: die drei Ketten

Aus den Befunden ergibt sich, welche Prozessketten **nicht** geschnitten werden
dürfen, weil an jeder bisherigen Schnittstelle eine Kennzahl gestorben ist:

**Procure-to-Pay — Bestellung → Wareneingang → Rechnung → Zahlung.**
In einem System, mit Artikelebene auf der Rechnung. Dann gibt es keine doppelte
Rechnung in zwei Welten, Fremdeinkauf ist eine Abfrage statt einer
OCR-Archäologie, und die Freigabeliste ist ein Workflow im Einkauf statt einer
nachgerüsteten `manual.*`-Tabelle.

**Sell-to-Consume — Verkauf → Rezeptur → Bestandsbuchung.**
Kasse und Warenwirtschaft müssen denselben Bestand sehen. Erst dann sind
Soll-Wareneinsatz, theoretischer Bestand und Schwund echte Zahlen statt der
heutigen Näherungen mit `soll_je_gezaehlt`-Warnschild.

**Ein Stammdatenraum — Betrieb, Lieferant, Artikel, Marke.**
Konzernweit eindeutige Schlüssel, Status als Feld (nicht „GESCHLOSSEN" im
Namen), Marken als Dimension, Historisierung mit Gültigkeitszeiträumen. Jede
Handzuordnungstabelle in `manual.*` ist heute ein Beleg dafür, dass dieser Raum
fehlt.

## 3. Was getrennt bleiben darf

Nicht alles gehört in ein System — an diesen Schnitten ist im Projekt nichts
gestorben:

- **Steuerberater/DATEV:** Die BWA entsteht extern und läuft nach; das ist ein
  Prozess-, kein Systemproblem. Ein Standard-Export (DATEV-Schnittstelle) reicht
  — solange ungebuchte Monate als „fehlt" ankommen statt als 0,00.
- **Lohn/HR:** eigene Rechtswelt (Art.-9-Daten), gehört ohnehin getrennt
  berechtigt — heute liegt sie gefährlich **im selben** Belegarchiv.
- **Reputation (Yext), Marktdaten, Kalender:** externe Realität, sauber als
  eigene Quellen führbar.
- **Analytics selbst:** Eine eigene Auswertungsdatenbank neben den
  operativen Systemen ist kein Fehler — sie muss nur gegen dokumentierte APIs
  laufen statt gegen gescrapte Oberflächen. Der Schaden entsteht nicht durch
  die Schattendatenbank, sondern durch die Qualität dessen, was hineinfließt.

## 4. Konsequenz für die Auswahl

1. **Ein System für Gastronomie-Betrieb** — Kasse, Warenwirtschaft, Einkauf,
   Rezepturen, Inventur in einem Datenmodell — ist der Zielzustand, an dem
   Kandidaten zu messen sind. Jeder verbleibende Schnitt ist an den drei Ketten
   aus Abschnitt 2 zu prüfen: *Welche Kennzahl stirbt an dieser Naht?*
2. Wo ein Kandidat doch aus Modulen besteht: **gemeinsame Stammdaten und
   gemeinsame Schlüssel sind das K.-o.-Kriterium**, nicht der Funktionsumfang
   der Einzelmodule. Vier Mandanten mit vier ID-Räumen sind bereits einmal
   gescheitert — messbar.
3. **Exportfähigkeit und API-Vertrag von Tag eins** (siehe Anforderungslisten
   in beiden Dossiers): Die heutige Lage — Historie nur per Scraping rettbar —
   darf sich nicht wiederholen. Die Daten gehören dem Konzern, nicht dem
   Anbieter.
4. **Die eigene Arbeit bleibt:** Stammdatenpflege (Freigabelisten, GFGH je
   Betrieb, Standorte, Warengruppen) und Erfassungsdisziplin (Inventuren,
   Gebinde) verschwinden mit keinem Systemwechsel. Ein neues System kann sie
   erzwingen helfen (Pflichtfelder, Validierung, Workflows) — erledigen kann
   es sie nicht. Wer den Wechsel plant, plant diese Pflege mit, sonst misst
   das neue System dieselben Lücken wie das alte.
