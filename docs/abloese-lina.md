# Ablöse-Dossier LINA

**Zweck:** Faktengrundlage für die mittelfristige Entscheidung, LINA (Gastro-MIS /
TeamCloud, Oberfläche „Amadeus 360") zu ersetzen. **Stand:** 12.08.2026.

**Grundlage:** Systematische Auswertung aller Projektbefunde — 29 Dokumente in
`docs/` (14.645 Zeilen), die Kommentarköpfe von 68 Migrationen und die
API-Clients in `src/`. Von 483 extrahierten Einzelbefunden betreffen **270 LINA**.
Jede Zahl hier ist gemessen und in der genannten Quelle belegt; nichts ist
geschätzt. Das Schwesterdokument ist [abloese-foodnotify.md](abloese-foodnotify.md),
die übergreifende Architekturfrage steht in [systemschnitt.md](systemschnitt.md).

**Fairness-Regel dieses Dokuments:** Was Concept Family selbst zu verantworten
hat (ungepflegte Stammdaten, Buchungsverzug der eigenen Buchhaltung, die
politische Entscheidung gegen den offiziellen API-Zugang), steht in einem
eigenen Abschnitt und wird LINA **nicht** angelastet. Ein Dossier, das das
vermischt, fällt bei der ersten Rückfrage um.

---

## Was LINA heute liefert — der Ersetzungsumfang

| Bereich | Inhalt | Tiefe |
|---|---|---|
| POS-Umsätze | Umsatz je Betrieb/Tag/Sparte, Stundenbericht, Gäste, Bons | seit 2018, 141 Betriebe |
| Artikelverkauf | Menge/Umsatz je Artikel und Tag | ~20 Mio. Zeilen/Jahr |
| BWA | 5 Kennzahlen (getKennzahlen) + Langfrist-BWA (77 Zeilen, seit 2009) | monatlich, vom Steuerberater importiert |
| Personalkosten | Quoten und Umsatz je Arbeitsstunde je Tag | seit 2018 |
| Belegarchiv (Ladenakte) | 593.353 Belege, davon 394.575 Eingangsrechnungen (OCR) | seit ~2009 |
| Stammdaten | Betriebe (nur ID+Name), Artikel, Warengruppen | ohne Historie |

Ein Nachfolger muss diesen Umfang decken — und zusätzlich die Lücken schließen,
die unten als „fehlende Funktionen" belegt sind.

---

## 1. Es gibt keinen benutzbaren Datenzugang

Der schwerwiegendste Befund ist nicht ein einzelner Fehler, sondern die
Zugangslage als solche:

- **Kein API-Vertrag im genutzten Pfad.** Die Integration läuft über die
  undokumentierte, unversionierte Oberflächen-API per Browser-Login — genau
  **ein** Konto, das sich sperren lässt, und eine Sperre wäre nicht rückgängig
  zu machen. Eine tatsächliche Zugangssperre wurde am 26.07.2026 beobachtet.
- **Kein Export.** Fällt der Zugang weg, gibt es keinen Weg mehr an die
  Historie. Der komplette Backfill (raw-Layer als Versicherung) existiert nur
  deshalb.
- **Das Tempo diktiert die Tarnung, nicht die Technik:** LINA antwortet im
  Mittel in 623 ms, gewartet wird 30.228 ms je Aufruf — **98 % Leerlauf**,
  selbst auferlegt, weil es weder dokumentierte Limits noch Rate-Limit-Header
  gibt und Cloudflare davor liegt. Tagesbudget 10.500 Aufrufe.
- **Sessions statt Token:** Formular-Login mit Einmal-`secret`, Cookie
  `PHPSESSID`, Sessionablauf wird nur indirekt gemeldet (Redirect auf /login).
  2FA würde den unbeaufsichtigten Betrieb sofort beenden.
- **Einordnung:** LINA *hat* eine offizielle Third-Party-API mit Keys, Scopes
  und IP-Bindung — Sell & Pick und Bounti nutzen sie, mit exakt den Scopes, die
  dieses Projekt braucht („BWAs und SuSas lesen", „Journaldaten Kasse lesen").
  Dass sie nicht genutzt wird, ist eine dokumentierte eigene Entscheidung
  (11.08.2026), kein LINA-Mangel. **Aber:** auch die offizielle API deckt nur
  einen Teil — Belegarchiv, Langfrist-BWA und Stammdatenblatt existieren
  ausschließlich als serverseitig gerendertes HTML.

Q: entscheidungen.md, importer.md, protokoll-anmeldeverfahren.md, lina-api-inventar.md

## 2. Stille Fehler sind das Systemprinzip

Das wiederkehrende Muster über alle Endpunkte: **LINA meldet Fehlzustände nicht,
sondern liefert plausible falsche Werte.** Jeder dieser Fälle hat im Projekt
mindestens einmal eine falsche Kennzahl erzeugt:

| Verhalten | Gemessene Folge |
|---|---|
| Ungebuchte BWA-Monate kommen als **0,00 statt NULL** | Round Table meldete Sept.–Dez. 2026 für alle 131 Betriebe grün (0 % Personalkosten = „besser") |
| Fehlende BWA-**Rechte** liefern kommentarlos Nullen | von fehlender Buchung nicht unterscheidbar; eigener Buchungsstand-Tracker nötig |
| „Keine Daten" = **HTTP 500 mit leerem Body** | Normalzustand als Fehlercode; Retry liefe endlos |
| Gesperrte Berichte = ebenfalls HTTP 500 | Rechteproblem von Serverfehler nicht unterscheidbar (Berichte 7, 8, 9, 23, 24, 107, 118) |
| Falscher Filterschlüssel (`number` statt `posId`) | kommentarlos 0,00 € statt Fehler |
| Dienstplan ohne Berechtigung | HTTP 200 mit leeren Daten — Rechteprüfung sitzt im Frontend |
| `fixer_we` fehlt → **0.0000 statt NULL** (591.464 Zeilen, kein einziges NULL) | Prüfsicht zeigte jahrelang 100 % Abdeckung, real hatten 48 % der Betriebsmonate keinen Ansatz |
| Struktur ohne Daten (BWA-HTML: 80 Spalten, 77 Zeilen, null Werte) | „geparst" ist nicht „vorhanden"; 6.160 Nullzeilen wären als Erfolg durchgegangen |

Ein Nachfolgesystem, das NULL von 0 und „keine Rechte" von „keine Daten"
unterscheidet, eliminiert eine ganze Klasse von Fehlern, gegen die hier ein
Dutzend Wächtersichten gebaut werden musste.

Q: fehlerkatalog.md Abschnitt 1, lina-api-inventar-1b/1c.md, datenherkunft.md

## 3. Datenqualität: gemessene Defekte in den Kernfeldern

- **Belegarchiv-Beträge sind teils Datenmüll aus der Quelle:** 124 Belege mit
  Beträgen nach dem Muster Cent×10⁶ (`117982000000,00` wo die Steuersumme
  1.267,47 € sagt) — bei einem 99. Perzentil von 6.292 €. Ungefiltert wies
  `mart.fremdeinkauf` **14.024.387.689.386 €** aus. Nicht korrigierbar, nur
  verwerfbar.
- **71,8 % der Eingangsrechnungen ohne Betrag:** 283.303 von 394.575 mit
  netto = 0, davon 269.514 ganz ohne Rohfeld — über den mandantenfreien Weg A
  nicht heilbar.
- **OCR-Lieferantennamen:** 8.395 normierte Schreibweisen, Chefs Culinar allein
  in zwölf Varianten, dazu Trümmer wie „comis9 shemalessignal iduna gruppe".
  Sachkonto nur auf 2,5 % der Rechnungen der letzten 12 Monate gefüllt (1.816
  von 71.780) — eine Kontenabgrenzung trägt nicht.
- **Unmögliche Gästezahlen:** 4 Tage im Oktober 2018 mit 3,0–3,9 **Milliarden**
  Gästen (uint32-ID-Muster); auch 2026 noch 14 Zeilen bei 7 Betrieben (Aposto
  Aalen: 46.126.263 Gäste bei 331 Rechnungen).
- **`pek_*` heißt Quote und ist keine:** Zähler kumuliert seit Monatsanfang über
  Tages-Nenner — Median steigt von 43,8 (Monatstag 1) auf 717,6 (Tag 31). Ab dem
  zweiten Monatstag ist der Wert als Prozent gelesen falsch.
- **`eff_*` war undokumentiert** und musste per Identitätsrechnung über 16.110
  Betriebstage verifiziert werden (Median 0,99995) — bis dahin galten
  Arbeitsstunden fälschlich als nicht verfügbar.
- **13.727 von 21.287 Artikeln** tragen nur einen Platzhalternamen
  („Artikel 12345") — alle mit echten Verkäufen.
- **Die Warenwirtschaft ist Demo in Produktion:** 898 Waren und 540 Lieferanten
  neben 4 Bestellungen und 11 Inventurterminen (jüngster 08.02.2017).
  `mart.preisentwicklung_ware` zeigte daraus 1.111 erfundene Einkaufspreise
  unmarkiert als echte. Die acht Tabellen wurden gelöscht (Migration 0030).

Q: 0058, fehlerkatalog.md, befunde-datenlage.md, plan-foodnotify.md §1

## 4. Fehlende Funktionen — was LINA strukturell nicht kann

- **Keine Historie, nirgends.** Stammdaten, Preise, Warengruppen, Plan-BWA:
  überall nur der heutige Stand, Änderungen überschreiben. Die BWA wird
  rückwirkend korrigiert, ohne dass ein alter Stand abrufbar bliebe. Das
  gesamte `<ding>_stand`-Historisierungsmuster des Projekts existiert nur,
  weil die Quelle vergisst.
- **Keine Adressen/Koordinaten für Betriebe** (489 archivierte API-Antworten
  rekursiv durchsucht: null Treffer; für **Lieferanten** liefert dieselbe API
  Adressen). `getStoreData` hätte alles, liefert aber nur den Session-Betrieb.
- **Keine Rezepturen als Daten:** nur 1,4 MB HTML je Rezept (~12 GB für alle),
  Lese-Endpunkt existiert nicht.
- **Keine Bon-Ebene** — nur Aggregate, obwohl intern StarRocks mit Bon-Ebene
  läuft. Keine Aktion-zu-Artikel-Zuordnung (Rekonstruktion gemessen
  unbrauchbar: 104 %, 358 %, 61 % Trefferquote).
- **Betriebs-Reports kosten 141 Aufrufe je Zeitraum** statt einem; die
  Personal-/Wareneinsatz-Berichtsgruppe ist gesperrt oder unlizenziert.
- **Zeitzonen brechen bei 11:30/17:30**, der Stundenbericht kennt nur volle
  Stunden — LINAs eigene Zonen sind aus LINAs eigenen Daten nicht nachbaubar
  (Fehler ±8,4 %). Stundenbericht liefert nur Umsatz, keine Gäste/Bons/Sparten.
- **Keine Rechnungspositionen im Belegarchiv** (Weg A): Belegkopf, Lieferant,
  Nettobetrag — aber kein Artikel, kein Einzelpreis. Der artikelgenaue Weg B
  hängt am Session-Mandanten (131 zustandsändernde Mandantenwechsel).
- **Keine Konzept-/Markenzuordnung als Datenfeld** — nur implizit aus
  String-Mustern (`group_4`) eines Berichts-Endpunkts parsebar.
- **Holding-Themen** (Darlehen, Budget, EK-Konsolidierung) existieren nicht.

## 5. Sicherheitsbefunde

Diese Punkte sind für die Ablöse-Entscheidung relevant, weil sie das Vertrauen
in den Hersteller betreffen:

- **Das Passwort wird als ungesalzenes MD5-Hex übertragen** — der Hash *ist*
  das Passwort (pass the hash). SHA-256 liegt im Frontend-Code nur
  auskommentiert bereit. Die Datei `/js/common/sha256.js` enthält MD5.
- **`getStoreData` liefert `db_name`, `db_user`, `db_pass` im Klartext** an den
  Browser, dazu IBAN, BIC, Steuernummer.
- **Vergebene API-Schlüssel stehen im Klartext** (samt IP-Bindung und Scopes)
  im Stammdatenblatt-HTML jeder Ladenakte.
- **Löschen ist ein GET-Link** (`…/vertragid/<id>/delete/1`) — ein Crawler, der
  Links folgt, löscht Verträge (92–108 je Betrieb, darunter notarielle Urkunden).
- **Personalakten im selben Archiv:** der Lohn-Zweig führt Ausweisdokumente,
  Geburtsurkunden, Krankmeldungen (Art. 9 DSGVO) und Pfändungen über denselben
  Zugang wie die FiBu-Belege.

Q: protokoll-anmeldeverfahren.md, lina-api-inventar.md §2, lina-api-inventar-ladenakte.md

## 6. Strategisches Risiko: LINA ist selbst nur eine Kopie

Die Oberfläche meldet „Die Daten sind nur eingeschränkt änderbar, weil
Amadeus 360 nicht führendes System ist"; im Code stehen `a360isMaster`,
`isSynced`, `syncGroups`. Ein Teil der abgezogenen Stammdaten ist in LINA
selbst nur eine synchronisierte Kopie eines Vorsystems — inklusive
Synchronisationsfehlern („Doppelte Artikelnummern, unbedingt korrigieren" als
Freitext im errors-Feld). Wer LINA ersetzt, sollte klären, **welches System
eigentlich führt** und was mit ihm passiert.

## 7. Was die Integration gekostet hat

Der laufende Preis des Status quo, als Größenordnung:

- Ein komplettes Tarn- und Drosselregime (Takt, Tagesbudget, persistierte
  Zugangssperren, Backoff bis 96 h, genau ein Anmeldeversuch je Lauf)
- Ein 10-Tage-Nachzügler-Fenster, weil sich Konzernberichte erst über 5–6 Tage
  füllen — „gestern" abrufen liefert verlässlich Nullen
- Drei HTML-Parser (Langfrist-BWA bis 224 Monatsspalten, Stammdatenblatt,
  Belegliste) mit Struktur-Wächtern, weil es kein JSON gibt
- Ein append-only Raw-Layer (~582 MB je Belegarchiv-Vollabzug) als einzige
  Versicherung gegen den Verlust des Zugangs
- Anteilig: 65+ Migrationen, ein mart-Schema mit über 50 Sichten, neun
  Import-Überwachungssichten — großteils Abwehr stiller Quellfehler

## 8. Was NICHT LINA anzulasten ist

Der Vollständigkeit halber, damit das Dossier hält:

- **79 der 141 geführten Betriebe machen keinen Umsatz** (Karteileichen,
  Beteiligungsgesellschaften, Insolvenzen) — Bestandspflege von Concept Family.
- **BWA-Buchungsverzug** (Juni 2026: am 25.07. erst 22 von 131 gebucht) — der
  Steuerberater bucht nach, LINA transportiert nur.
- **Sieben Standorte melden 0 € Umsatz**, obwohl sie laufen — dort ist eine
  andere Kasse im Einsatz; LINA kann nur zeigen, was hineinfließt.
- **Der Verzicht auf den offiziellen API-Zugang ist eine eigene, politische
  Entscheidung** (dokumentiert 11.08.2026). Ein Teil der Zugangsprobleme aus
  Abschnitt 1 wäre damit kleiner — aber nicht die HTML-only-Bereiche und keine
  der Datenqualitäts- und Funktionslücken.
- Leere Freigabelisten, fehlende Standort-Pflege, fehlende Warengruppen bei
  Deutsche Konzepte/Besitos: eigene Stammdatenarbeit.

## 9. Was für LINA spricht (Positivbefunde)

- **Die Historie ist lückenlos:** zwischen 01.01.2018 und 07.08.2026 fehlen
  je Bericht nur 2–3 Kalendertage — ausschließlich die letzten Sync-Tage.
- **Das Belegarchiv ist vollständig abziehbar:** 593.353 geladene Belege gegen
  ein Soll von 593.314, über 131 Betriebe, 0 Fehler.
- **Die Langfrist-BWA reicht bis 2009** und ist intern konsistent
  (EBIT/Umsatz-Gegenprobe: 100 % von 6.289 Betriebsmonaten innerhalb 0,05 pp).
- **Der Stundenbericht ist komplett:** 10.618.992 Zeilen, alle 141 Betriebe,
  Summenprobe 100,00 % über 30.597 Betriebstage.

Die Datensubstanz ist wertvoll — das Problem ist der Weg zu ihr und die
Verlässlichkeit der Felder, nicht die Existenz der Daten. **Für die Migration
heißt das: der Altbestand ist rettbar und sollte vor einer Abschaltung
vollständig gesichert sein** (der Raw-Layer dieses Projekts tut das bereits).

## 10. Anforderungen an einen Nachfolger

Direkt aus den Befunden abgeleitet — jede Zeile beantwortet einen konkreten
oben belegten Mangel:

1. **Vertraglicher API-Zugang** mit Doku, Versionierung, Changelog, Token-Auth,
   dokumentierten Limits und einem zweiten (lesenden) Zugang. Bulk-Export.
2. **NULL ≠ 0, Fehler ≠ leere Antwort:** maschinenlesbare Fehlercodes, Rechte-
   fehler als 401/403, „keine Daten" als leere 200.
3. **Historisierung als Grundeigenschaft:** Stammdaten, Preise, Zuordnungen und
   BWA-Stände mit Gültigkeitszeiträumen; rückwirkende Korrekturen versioniert.
4. **Bon-/Positionsebene** der Verkäufe zugänglich, nicht nur Aggregate.
5. **Rechnungen mit Artikelpositionen** (E-Rechnung/XRechnung statt OCR) —
   damit entfallen OCR-Namen, fehlende Beträge und die Weg-A/Weg-B-Zweiteilung.
6. **Betriebs-Stammdaten vollständig:** Adresse, Koordinaten, Status
   (offen/geschlossen als Feld, nicht im Namen), Konzern-/Markenzuordnung.
7. **Konzernabrufe** statt 141 Einzel-Sessions; keine Mandanten-Session-Bindung.
8. **Zeitgrößen sauber:** ISO-Timestamps mit Zeitzone, konsistente Formate,
   frei definierbare Zeitfenster.
9. **Sicherheit auf Stand:** kein MD5, keine Klartext-Credentials in Antworten,
   destruktive Aktionen nie als GET, Personaldokumente getrennt berechtigt.
10. **Klare Systemführerschaft:** entweder ist das System Master seiner Daten,
    oder die Synchronisation ist dokumentiert und überwachbar.
