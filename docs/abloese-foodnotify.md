# Ablöse-Dossier FoodNotify

**Zweck:** Faktengrundlage für die mittelfristige Entscheidung, FoodNotify zu
ersetzen. **Stand:** 12.08.2026.

**Grundlage:** Dieselbe systematische Auswertung wie im Schwesterdokument
[abloese-lina.md](abloese-lina.md): 483 Einzelbefunde aus `docs/`,
Migrationsköpfen und `src/`, davon **109 zu FoodNotify**. Alle Zahlen gemessen.
Die übergreifende Architekturfrage steht in [systemschnitt.md](systemschnitt.md).

**Fairness-Regel:** Was Erfassungspraxis der Betriebe, Rollout-Lücke oder eigene
Entscheidung ist, steht getrennt in Abschnitt 7 und wird FoodNotify nicht
angelastet.

---

## Was FoodNotify heute liefert — der Ersetzungsumfang

| Bereich | Inhalt | Umfang |
|---|---|---|
| Bestellungen | Kopf, Lieferant, Positionen mit echten Belegpreisen | ~67.000 Bestellungen, 876.611 Positionen (Aposto ab 10/2021) |
| Rezepturen | Zutaten mit Mengen und Kosten, je Marke gepflegt | Aposto 672, Enchilada 1.846 |
| Inventuren | Zählungen mit Soll/Ist je Position | 358 Inventuren, ~81.000 Positionen (fast nur Wilma Wunder) |
| POS-Mapping | Artikel→Rezept-Zuordnung (Brücke zu LINA) | nur Kassensystem „amadeus" |

Das ist der einzige Ort im Konzern, an dem Einkaufspreise auf Artikelebene und
Rezepturkosten als Daten existieren — LINA kann beides nicht. Genau deshalb
wiegen die folgenden Mängel schwer: es gibt keine Ausweichquelle.

---

## 1. Kernfunktionen des Produkts sind nachweislich defekt

Nicht nur die API ist unbequem, das
**Produkt selbst rechnet falsch** — sichtbar für jeden Nutzer der Oberfläche:

- **Die Verkaufsverarbeitung ist kaputt.** Jeder geprüfte Verkaufsdatensatz
  steht auf `saleStatus: init` mit `sumPrice: 0` und trägt in `finishError`
  einen Datenbankfehler des Herstellers: `SQLSTATE[42703] column
  t0.root_recipe_id does not exist`. Stichproben: Wilma Wunder 127.757
  Verkäufe, Aposto 20.157 — **100 % fehlerhaft**. Die Kette
  Verkauf → Rezeptur → Warenverbrauch bricht damit produktseitig ab.
- **Die Kostenanalyse zeigt Phantasiewerte ohne Warnung:** Aposto
  −10.036.635 € Ist-Wareneinsatz bei 762.455 € Umsatz (**−2667 %**); in keiner
  der vier Marken belastbar. Selbst die plausibelste Marke (Deutsche Konzepte,
  5,36 %) liegt Faktor fünf unter branchenüblichen Quoten.$

Q: foodnotify-api-inventar.md §2/§7/§8, entscheidungen.md „Kein Support-Kontakt"

## 2. Das Datenmodell kennt keinen Konzern

FoodNotify ist als Einzelbetriebs-Software gebaut; die Konzernsicht muss
vollständig außerhalb rekonstruiert werden:

- **Vier Mandanten, vier Konten, vier ID-Räume.** Kein Markenwechsel möglich;
  der Aposto-Zugang sieht nur die 14 Aposto-Betriebe. Rezepturen werden je
  Marke getrennt gepflegt.
- **Derselbe Lieferant existiert je Mandant als eigener Vertrag:** Distra
  viermal („DISTRA Enchilada_Coyacan", „Distra Aposto", …). Erst die manuelle
  Zusammenführung machte sichtbar, dass Distra mit 22,5 Mio € über 56 Betriebe
  der größte Lieferant des Konzerns ist — vorher vier unauffällige Zeilen.
- **Jeder Betrieb hat eigene Waren-IDs:** derselbe Kaffee trägt acht
  Warennummern, 866 Warensätze tragen nur 428 Namen. Der Warenname ist die
  einzige Brücke — und der ist kryptisch abgekürzt
  („Blumenk.i.backt10,2G Tk Veg7Kg") und schreibweisenempfindlich
  („12x1l" ≠ „12X1L").
- **`einheit` und `basis_einheit` sind am Warenstamm bei allen 866 Sätzen leer**
  — die Einheit existiert nur an der Bestellposition.
- **Die POS-Zuordnung (Artikel→Rezept) wird nicht historisiert** — welcher
  Stand im März galt, ist aus der API nicht rekonstruierbar.
- **162 `lieferant_key` verteilen sich auf 132 Klarnamen** — Gruppierung über
  den Klarnamen führt still zusammen, was getrennt gehört (Falle 13).

## 3. Mengen und Gebinde: die teuerste Baustelle des Projekts

Die Bestellposition ist die Kernressource — und ihre Mengenfelder sind in
einem Zustand, der jede Preisauswertung ohne massives eigenes Regelwerk
unbrauchbar macht:

- **`unitQuantity` schwankt für dieselbe Ware um Faktor 140.000** (0,00035 bis
  50 bei „Idee Entkoffeiniert 50 Pouches à 7G"), während der Gebindepreis
  stabil bleibt. Ergebnis in der ersten Karte: **48.400 €/kg für Kaffee.**
  Beide falschen Zeilen sind in sich stimmig und einzeln nicht widerlegbar.
- **`gesamt_menge` = `menge` × `gebinde_menge` gilt nur in 26 %** der 634.175
  Positionen. Woher die Abweichung kommt, ist ungeklärt.
- **`amount` ist in echten Antworten immer 0** — die Menge steht in
  `adjustedQuantity` (13.126 Positionen ohne eine Ausnahme). `isSubstituted`
  ist immer null. Beides steht so in keiner Doku.
- **Float-Artefakte als Mengen:** `4.4408920985006262e-16` statt 0 — die
  Division riss per numeric overflow vier komplette Bestellungen mit.
- **Die Packungsgröße steht teils im falschen Feld** (gebinde_menge 432.000):
  zwei Zeilen brachten den Einkaufspreis-Nachlauf drei Läufe lang zum Absturz
  (Migrationen 0060/0061).
- **Zwei Buchungsstile nebeneinander** (Karton als menge=1 vs. sechs Flaschen
  als menge=6; Grana Padano 8,82 € bei Gebinde 1 neben 17,64 € bei Gebinde 2 im
  selben Monat): 41 von 200 Zeilen der Teuerungs-Karte waren **exakt +100,0 %**
  — Gebindewechsel, keine Teuerung. Bei „Captain Morgan 12x1l" zahlt jeder
  Betrieb exakt 147,84 € je Karton, gemeldet wurden ±84,6 % — 81 % der
  ausgewiesenen „Ersparnis" (45.045 von 55.282 €) waren Artefakt.
- **Echte Falschbuchungen bleiben stehen:** 1.002.250 € für eine Packung
  Falthandtücher; 710 von 251.580 Zeilen sind Preisausreißer.

**Der Preisvergleich zwischen Betrieben brauchte deshalb ein eigenes Sperrwerk**
(vier Sperren, `vergleichbar`-Flag, Median statt Mittelwert, Ausreißer-Nachlauf
je Sync) — und bleibt trotzdem nur im einstelligen bis niedrig zweistelligen
Prozentbereich belastbar.

Q: 0040–0042, 0056–0062, fehlerkatalog.md, metabase.md

## 4. API-Design und Stabilität

- **Drei bis vier verschiedene Antworthüllen** je nach Endpunktfamilie (flach
  mit `total_count`, `payload`-Hülle mit `isError`, nur-`data`, nackte Arrays).
  Die Seitenzahl steht mal in `payload.pagination.totalPages`, mal im flachen
  `page_count`. **Der Fehler beim falschen Auspacken ist lautlos** (HTTP 200,
  leer) — so wurden bei Wilma Wunder 275 Inventuren und 19,7 Mio € Umsatz
  übersehen.
- **Fehler kommen auch mit HTTP 200** (`isError: true` bzw. `errors[]`).
- **Deterministische HTTP 500:** 282 Bestellungen liefern bei jedem Versuch
  500 (gemessen: 4.092 Abrufe über 6 h, 0 Erfolge nach Wiederholung, kein
  einziges 429). ~1 % aller Bestellungen haben dadurch Kopf und Summe, aber
  keine einzige Position; der Fehlerkörper enthält nichts Verwertbares.
- **N+1-Lastprofil:** Die Bestellliste liefert nur Nummer und Datum; Kopf und
  Positionen je Bestellung einzeln — der Backfill kostete ~90.000 Aufrufe.
  `perPage` wird bei /api/recipes ignoriert (fest 25).
- **Undokumentierte ID-Namensräume:** Das POS-Mapping hängt an der
  `connectionId`, die in keinem der drei ohnehin verwechselbaren ID-Räume
  (restaurant.id / costCenter.id / erpId) liegt; sieben plausible IDs lieferten
  404. `zutat.artikelId` und `shopArticleId` sind Lieferanten-Artikelnummern,
  keine Warennummern — die Benennung führt in die Irre.
- **Statusfelder als Objekte:** `shopOrderStatus` kommt als `{"name":"canceled"}`
  — naive Verarbeitung schrieb „[object Object]" in 44.271 Bestellungen; 1.561
  Stornos über 2,49 Mio € zählten dadurch als Einkauf.
- **403 bedeutet „diese Ressource", nicht „dieser Zugang"** — FoodNotify
  betreibt im selben Mandanten auch fremde Betriebe. Zwei 403 legten einmal
  584 Posten einer Marke für 24 h still.
- **Zeitparameter der Cost-Analysis werden ignoriert**; 29 Enchilada-Betriebe
  stehen auf Zeitzone Europe/Vienna.
- **Fehlerseiten liefern komplette Symfony-Stacktraces** mit Serverpfaden.

## 5. Inventuren: das Soll ist bauartbedingt wertlos

- **Der theoretische Bestand wächst mit jeder Lieferung**, wenn Verbrauch nicht
  gegen den Bestand gebucht wird — und das ist der Normalzustand, weil die
  Verkaufsverarbeitung defekt ist (Abschnitt 1): 971.750 g Pizzateig Soll gegen
  138.000 g gezählt; Sollmengen bis **6.002.002.000** (sechs Milliarden
  Zuckersticks); Positionswerte bis 80 Mio €.
- **Eine ehrlich mit 0 gezählte Position ist von einer nie gezählten nicht
  unterscheidbar** — beides kommt als 0.
- **Testdaten in Produktion zählen mit:** 61 von 358 Inventuren tragen „Test"
  im Namen; „Test Inventur" bei Aposto Gera ist **signiert**, mit 285
  Positionen.
- **Teilinventuren stehen ununterscheidbar neben Vollinventuren:** 42,6 % aller
  Positionen tragen ein Soll ohne jede Zählung.
- Dieselbe Ware führt Basiseinheit `g` und `mpce` nebeneinander; der Import
  scheiterte anfangs an numeric overflow (Migrationen 0046/0047).

Ergebnis: Die Schwundrechnung war vor der eigenen Korrektur (0062) Unsinn
(87,9 % „Schwund", real −3,8 %) und ist auch danach nur dort belastbar, wo
`soll_je_gezaehlt` nahe 1 liegt — das System selbst liefert keine belastbare
Schwundzahl.

## 6. Abdeckung

FoodNotify sieht nur, was über FoodNotify bestellt wird:

- **14 der 57 operativen Betriebe (30,0 % des operativen Umsatzes) nutzen es
  gar nicht** — zehn davon Deutsche Konzepte, der blinde Fleck ist fast eine
  ganze Marke.
- **Für Fremdeinkauf ist es strukturell blind** (300.750 € sichtbar gegen
  7,93 Mio € im Belegarchiv) — wer am System vorbei bestellt, erzeugt keine
  Zeile. Ein Bestellsystem kann Einkaufskontrolle prinzipbedingt nicht leisten.
- 15.893 Bestellungen über 13,2 Mio € stehen seit 2020 auf `pending` — nie
  weitergeschaltet, fachlich ungeklärt. 50.063 von 50.072 Belegen haben keine
  Belegnummer.

## 7. Was NICHT FoodNotify anzulasten ist

- **Die Rollout-Lücke** (14 Betriebe ohne Nutzung) ist eine
  Einführungsentscheidung von Concept Family, kein Softwaremangel.
- **Die Erfassungspraxis** (Karton vs. Flaschen, Test-Inventuren, nie
  weitergeschaltete Bestellungen) liegt bei den Betrieben — ein besseres System
  kann sie erschweren (Validierung, Pflichtfelder), aber nicht ersetzen.
- **Kein Support-Kontakt ist eine eigene Entscheidung** — der
  `root_recipe_id`-Defekt und die 282 kaputten Bestellungen wurden nie
  gemeldet; die vorbereitete Fehlermeldung liegt in `docs/foodnotify-http500.md`.
- Die Inventurdisziplin (nur Wilma Wunder zählt regelmäßig) ist Organisations-,
  nicht Systemsache.

## 8. Was für FoodNotify spricht (Positivbefunde)

- **Technisch das Gegenteil von LINA:** echtes REST, durchgehend JSON,
  paginiert, ~58 ms Antwortzeit, bezahlter Dienst — zügiger Takt ist
  bestimmungsgemäße Nutzung (Tagesbudget 140.000 statt 10.500).
- **Echte Belegpreise auf Artikelebene** — die einzige solche Quelle im
  Konzern, Basis der gesamten Einkaufspreis-Auswertung.
- **Rezepturen mit Mengen und Kosten als Daten** (LINA: nur HTML).
- **Subuser-Fähigkeit vorhanden** (`/api/subusers`) — ein lesender Zugang wäre
  möglich.
- Getrennte Kostenstellen (Bar/Küche) je Betrieb — der Split, den LINA nie
  liefern konnte.

## 9. Anforderungen an einen Nachfolger

1. **Konzernfähigkeit:** ein Mandant mit Betriebshierarchie, konzernweite
   Lieferanten- und Artikelstämme mit einem ID-Raum; Marken als Dimension,
   nicht als Silo.
2. **Validierte Mengenerfassung:** Gebinde/Basiseinheit als Pflichtmodell mit
   Plausibilitätsprüfung bei der Eingabe — nicht erst in der Auswertung.
3. **Funktionierende Verbrauchsbuchung:** Verkauf → Rezeptur → Bestand als
   gelebte Kette, damit Soll-Bestand und Schwund echte Zahlen sind. Das ist
   zugleich das stärkste Argument gegen einen erneuten Systemschnitt an dieser
   Stelle → [systemschnitt.md](systemschnitt.md).
4. **Preishistorie im Kernprodukt**, nicht in einem Beta-Nebenprodukt.
5. **Eine API-Konvention:** eine Antworthülle, eine Paginierung, Fehler nur als
   Fehlercodes, dokumentierte ID-Räume, Bulk-Endpunkte (keine N+1-Pflicht),
   Status als Werte statt Objekte.
6. **Test-/Übungsdaten getrennt** von Produktionsdaten (Sandbox oder Flag, das
   in jeder API-Antwort steht).
7. **Inventuren mit Zählstatus je Position** (gezählt-mit-0 ≠ nicht gezählt),
   Voll-/Teilinventur als Feld.
8. **Analytics als Daten-API**, nicht als BI-Einbettung.
