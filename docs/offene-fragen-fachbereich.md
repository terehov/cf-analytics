# Offene Fragen an den Fachbereich

Stand 27.07.2026. Jede Zeile: was auffällt, was wir schon wissen, wen es zu fragen gilt.
Technische Punkte stehen in [offene-punkte.md](offene-punkte.md).

---

## 1 · Sieben Standorte melden 0 € Umsatz

Alle sieben haben eine aktive Yext-Entität, sind also in Betrieb. LINA liefert 30 Tage —
aber jeder Tag steht auf null. Keine Importlücke.

| Betrieb | Yext |
|---|---|
| Aposto Wuppertal GmbH | `A_14` |
| Aposto Wuppertal - Alter Papierfabrik | `A_15` |
| Enchilada Aschaffenburg GmbH | `E_02` |
| Enchilada Bremen | `E_05` |
| Enchilada Leipzig GmbH | `E_21` |
| Enchilada Minden GmbH | `E_23` |
| Enchilada Dresden (in LINA „GESCHLOSSEN") | `E_08` |

Im Juli-Excel standen für Aschaffenburg 89.258 €, Leipzig 127.232 €, Minden 69.144 €.
Die Zahlen existieren also — nur nicht in LINA.

**Vermutung (Eugene):** dort läuft eine andere Kasse.

> **Zu klären:** Welches Kassensystem nutzt jeder dieser sieben? Gibt es einen Export?
> Und: Ist Dresden geschlossen oder nicht — LINA sagt ja, Yext sagt nein.
>
> **Wen fragen:** Betriebsleitung / IT Concept Family.

---

## 2 · Zwei Standorte melden zu wenig

| Betrieb | LINA Juni | Excel | Differenz |
|---|---|---|---|
| Enchilada Bayreuth | 52.713 € | 69.886 € | −25 % |
| Enchilada Freiburg | 125.927 € | 142.091 € | −11 % |

Kein einheitlicher Faktor, also nicht netto/brutto.

**Vermutung (Eugene):** Freiburg macht Liefergeschäft, das anders abgerechnet wird.

> **Zu klären:** Läuft Lieferung über einen eigenen Kanal (Lieferando, eigener Shop)?
> Fließt der Umsatz in LINA ein? Wenn nein — brauchen wir ihn im Bericht?
>
> **Wen fragen:** Betriebsleitung Bayreuth und Freiburg.

---

## 3 · Personalkosten-Schwelle 28 % / 32 %

Reale Werte: Median **37,7 %**, Spanne 22,5–48,9 %. Damit sind 38 von 48 Standorten rot.

Das ist **kein Fehler** — im Juli-Excel standen 20 von 22 Betrieben rot, bei denselben
Größenordnungen. Das Blatt `Regeln` nennt 28/32 ausdrücklich einen *„Default … bei Bedarf
Werte anpassen"*, im Gegensatz zu Wareneinsatz (*„Fix nach Vorgabe"*).

Zum Vergleich: LINA pflegt eigene Schwellen je Betrieb (Median 27 grün / 35 orange).
Damit wären 28 statt 38 rot.

| Schwelle | grün | orange | rot |
|---|---|---|---|
| 28 / 32 (heute) | 2 | 2 | 37 |
| 32 / 38 | 4 | 17 | 20 |
| 35 / 42 | 12 | 18 | 11 |

> **Zu entscheiden:** Bleibt es bei 28/32 als Zielwert, oder soll die Ampel nach
> erreichbaren Schwellen färben? Alternativ: LINAs betriebsindividuelle Schwellen nutzen.
>
> **Wen fragen:** Geschäftsführung / Controlling. **Ich ändere hier nichts von allein.**

---

## 4 · Umsatzampel — Regel widersprüchlich

Im Blatt `Regeln` stehen für Umsatz die Werte **1** und **0,95** (also Ist/Ziel), der
Hinweistext daneben sagt aber *„Grün ab 10 %, Orange 0 % bis <0 %"* (also Vorjahresvergleich).
Beides schließt sich aus. Wir haben den **Hinweistext** umgesetzt: Veränderung zum Vorjahr,
10 % / 0 %.

> **Zu klären:** Vorjahresvergleich oder Zielerreichung? Falls Ziel — woher kommt das Ziel?
>
> **Wen fragen:** wer das Excel gebaut hat.

---

## 5 · Online-Bewertungen fehlen komplett

`manual.online_bewertung` ist leer. Die Zuordnung zu Yext steht (48 Standorte), es fehlt
nur der API-Zugang.

> **Zu klären:** Lizenznehmer ist Family & Friends Marketing, im selben Konto liegen
> andere Kunden. Zugang muss technisch auf unsere Entitäten begrenzt sein.
> Anforderung liegt fertig in [yext-anbindung.md](yext-anbindung.md).
>
> **Wen fragen:** Christoph (F&F) → Yext Support.

---

## 6 · BWA: 62 Betriebe ohne jede Buchung

62 von 141 haben **nie** eine gebuchte BWA, 10 weitere tauchen in `getKennzahlen` gar nicht
auf. 46 hinken der Spitze hinterher, 8 davon mehr als einen Monat.

Betrifft direkt Personal- und Wareneinsatzampel — ohne BWA keine Bewertung.
Namen in `mart.bwa_rueckstand`.

> **Zu klären:** Ist das normal (Franchise, Holdings ohne eigene BWA) oder fehlen
> Buchungen? Bis wann liefert der Steuerberater üblicherweise?
>
> **Wen fragen:** Buchhaltung.

---

## 7 · OM-Einschätzung und Ursachen/Maßnahmen

Die OM-Noten aus dem Juli-Excel sind nachgetragen (22 Betriebe, Juni 2026). Für alle
weiteren Monate und Betriebe gibt es **keinen Weg zur Eingabe** — Metabase kann nicht
schreiben. Ebenso leer: `manual.ursache`, `manual.massnahme`.

> **Nächster Schritt:** Eingabemaske. Bis dahin bleibt der Round Table an dieser Stelle
> unvollständig — es sind die beiden einzigen Kennzahlen, die den Finanzampeln
> widersprechen können.

---

## 8 · Kleinigkeiten

| Punkt | Status |
|---|---|
| `W_01` Wilma Wunder Mainz Ballplatz → [123] oder [105] „KUZ - …"? | angenommen [123] |
| Excel-Formel `K7` liest `J8` — Zeilenversatz im Original | nur Excel, uns egal |
| Vier Tage Oktober 2018 mit unmöglichen Gästezahlen | behoben, verworfen + protokolliert |
