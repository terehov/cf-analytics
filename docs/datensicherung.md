# Was wir sichern sollten, solange wir noch Zugriff haben

Die Leitfrage ist nicht „was brauchen wir für den Round Table", sondern: **was können wir in fünf Jahren nicht mehr rekonstruieren, wenn LINA weg ist?**

Der Round Table braucht sechs Kennzahlen. Für „wie haben sich unsere Margen über die Jahre entwickelt", „welche Artikel tragen den Deckungsbeitrag", „wie effizient war welcher Betrieb wann" braucht es deutlich mehr — und das meiste davon kostet erstaunlich wenige Anfragen.

Der entscheidende Unterschied ist nicht Umsatz gegen Kosten, sondern **Bewegungsdaten gegen Stammdaten**:

- **Bewegungsdaten** (Umsätze, Verkäufe, Stunden) sind viel, aber jeder Tag ist ein abgeschlossener Fakt. Verpasst man sie, verpasst man einen Zeitraum.
- **Stammdaten** (Artikel, Rezepturen, Preise, Lieferanten, Sparten) sind wenig — und sie werden **überschrieben**. Wer sie nicht versioniert, hat später Bewegungsdaten, die er nicht mehr interpretieren kann. Eine Verkaufsmenge ohne den Preis und die Rezeptur, die damals galten, ist eine Zahl ohne Bedeutung.

Genau dieser Fehler steckte bis `0007` im eigenen Schema: `core.artikel` wurde per UPSERT gepflegt und überschrieb `fixer_we` bei jedem Lauf. Der theoretische Wareneinsatz für Juni 2023 wäre mit der heutigen Kalkulation gerechnet worden — plausibel aussehend und still falsch. `core.artikel_stand` hält das jetzt je Monat fest.

---

## Klasse A — unersetzlich, fast kostenlos

Ein bis wenige Aufrufe. Sollten **monatlich als Momentaufnahme** laufen, nicht einmalig: Ihr Wert entsteht erst durch die Veränderung über die Zeit.

| Quelle | Status | Warum es später zählt |
|---|---|---|
| `/wawi/rezept/recipe` — **Rezepturen** | 🔴 **nie geprüft** | Die wichtigste offene Position. Artikel → Zutaten → Mengen. Damit lässt sich der Wareneinsatz für **jeden** historischen Zeitraum neu rechnen und mit heutigen Preisen neu bewerten. Ohne sie ist `fixer_we` eine Zahl, deren Zustandekommen niemand mehr nachvollziehen kann. |
| `/wawi/api/...` — **Lieferanten, Bestellungen, Einkaufspreise** | ✅ vollständige JSON-API | Die Einkaufsseite der Marge. Verkaufspreise haben wir über den Artikelbericht; ohne Einkaufspreise über die Zeit ist „wie hat sich die Marge entwickelt" **nicht beantwortbar**. Das ist die Lücke, die deine Frage direkt trifft. |
| `/wawi/api/units` — 32 Einheiten mit Umrechnungsfaktoren | ✅ | Ohne die Faktoren sind Mengen in Bestellungen und Rezepturen nicht vergleichbar. Ein einziger Aufruf. |
| `/wawi/inventory/inventory` — **Inventur** | ✅ | Schließt die Lücke zwischen Einkauf und Verbrauch. Ohne Inventur ist jede Schwundrechnung eine Schätzung. |
| `analyticsFilterOptions` — **334 Feinsparten**, 10 Hauptsparten, 7 Verkaufsstellen, 14 Konzepte | ✅, **Feinsparten bisher nicht gespeichert** | Die Dimensionstabellen. Wir speichern derzeit nur Hauptsparten und Verkaufsstellen. Die 334 Feinsparten sind die feinste Gliederung, die LINA kennt — ein Aufruf, und ohne sie ist jede Sortimentsanalyse auf grobem Niveau eingefroren. |
| Betriebsstammdaten (`getStoreData`) | ✅, mit Vorbehalt | Öffnungszeiten, Sitzplätze, Fläche, Eröffnungsdatum — die Bezugsgrößen für „Umsatz je Sitzplatz", „je Quadratmeter". Achtung: derselbe Endpunkt liefert Datenbankzugangsdaten im Klartext mit. Nur die fachlichen Felder übernehmen, nichts anderes. |

---

## Klasse B — Bewegungsdaten mit sehr gutem Verhältnis

Bereits im Register, laufen mit dem Backfill zurück.

| Quelle | Kosten | Was drinsteckt |
|---|---|---|
| `getKennzahlen` (absolut + relativ) | **2 Aufrufe je Jahr** | Die günstigste Historie im ganzen Projekt. Umsatz, EBIT, WE Bar, WE Küche, Personalkosten — je Betrieb und Monat, zurück so weit LINA reicht. Das ist die Margenentwicklung auf BWA-Ebene. |
| `getArtikelverkaufsbericht` | 1 Aufruf je Tag, alle Betriebe | Die feinste Ebene, die wir bekommen: Menge, Preis, Umsatz je Artikel. Zusammen mit `core.artikel_stand` die Grundlage für Deckungsbeitrag je Artikel über die Jahre. |
| `getUmsatzbericht` (+ Speisen/Getränke) | 3 Aufrufe je Tag | Umsatz, Rechnungen, Gäste, Durchschnittsbon. |
| `getZeitzonenbericht` | 1 je Tag | Umsatz je Stunde — die Basis für jede Personaleinsatzoptimierung. |

---

## Klasse C — teuer, aber inhaltlich zentral

Betriebs-Reports: **eine Anfrage je Betrieb und Zeitraum**, also ×141.

| Bericht | Status | Wert |
|---|---|---|
| **107 Gearbeitete Stunden** | ✅ aktiv seit heute, Antwortstruktur unbekannt | Die Rohdaten hinter den Effektivitäten. Ohne sie ist keine von LINAs Personalkennzahlen nachrechenbar. In Phase 1b kam HTTP 500 — aber auf Konzernebene, wo die Holding keine eigenen Daten hat. Auf Betriebsebene ungetestet. |
| **118 Wareneinsatz und Deckungsbeitrag** | 🟡 nicht im Register | Dem Namen nach genau die Margenrechnung, die du suchst — auf LINAs eigener Logik. Sollte geprüft werden, sobald 107 zeigt, ob Betriebs-Reports überhaupt liefern. |
| 8 Personalkosten (Jahr), 9 Urlaubsverteilung, 23 Personalkostenschätzung | 🟡 eingetragen bzw. bekannt | Geschwister von 107. Erst aktivieren, wenn 107 Daten liefert. |
| 92 Rabattbericht, Gutscheinumsatz, Personalverzehr | 🟡 bekannt, nicht eingetragen | Erklären einen Teil der Lücke zwischen Soll- und Ist-Wareneinsatz. |
| Reservierungen (`reservation-summary`) | ✅ JSON | Auslastung und Vorlauf — der Frühindikator, den der Umsatz nicht liefert. |
| `/finanzen/stat/umsatzwetter` | 🟡 ungeprüft | Wetter als Erklärvariable. Fürs Round-Table-Gespräch „war das der Betrieb oder der Regen" der Unterschied zwischen Vermutung und Zahl. |

---

## Klasse D — bewusst nicht verfolgen

| Quelle | Warum nicht |
|---|---|
| **Stundenzettel** je Mitarbeiter | Nur HTML, editierbares Formular. Personenbezogen, fragil, und man tippt auf einer Eingabemaske herum. Die aggregierten Berichte (107, 23, 8) beantworten dieselben Fragen ohne Personenbezug. |
| **Kassenjournal / Bon-Rohdaten** | Ungeprüft, vermutlich HTML. Um Größenordnungen umfangreicher als alles andere, und personenbezogen (Kellner, Zeitstempel). Für Ops-Analysen bringt die Bonebene wenig, was Artikel- plus Stundenebene nicht schon hergeben. Falls doch: erst Zweck definieren, dann Datenminimierung, dann holen. |
| Mitarbeiter-Stammdaten | `access: false` für den genutzten Account. |

---

## Was ich daraus als Reihenfolge vorschlagen würde

1. **`/wawi/rezept/recipe` prüfen.** Ein einziger lesender Aufruf. Wenn dort JSON liegt, ist das der größte einzelne Gewinn in dieser ganzen Liste — und der einzige Punkt, bei dem ein „später" wirklich weh tut.
2. **WAWI-Einkaufspreise und Einheiten sichern**, als monatliche Momentaufnahme. Ohne sie bleibt die Margenfrage unbeantwortbar, egal wie viele Umsatzdaten wir haben.
3. **Feinsparten mitnehmen**, ein Aufruf.
4. **107 auf Betriebsebene testen** (steht an), danach über 118 entscheiden.
5. Alles Weitere nach Backfill-Fortschritt.

Die Punkte 1 bis 3 kosten zusammen eine Handvoll Anfragen. Verglichen mit den rund 8.500, die allein Bericht 107 über fünf Jahre kostet, ist das Rundungsfehler — bei deutlich höherem Wert für genau die Fragen, die du gestellt hast.

---

## Grundsatz für alles davon

**Momentaufnahmen von Stammdaten gehören append-only in den Raw-Layer, mit Abrufzeitpunkt.** Nicht überschreiben. Der Speicherplatz ist belanglos, die Rekonstruierbarkeit nicht. `core.kennzahlen_monat` macht es so, `core.artikel_stand` macht es seit `0007` so — Rezepturen, Einkaufspreise und Betriebsstammdaten sollten es genauso machen.

Und: der Raw-Layer nützt nur für das, was wir **auch abrufen**. Für nie geholte Daten hilft keine Zeitreise.
