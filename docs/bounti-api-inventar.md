# Bounti — API-Inventar und Anbindung

**Stand 24.08.2026.** Grundlage ist die OpenAPI-3.0-Spezifikation, gezogen von
`https://api.bounti.co/external/v1/docs/openapi.json` (113 KB, 29 Pfade).

> ⚠️ **Die Abschnitte 1 bis 7 sind aus der Spezifikation gelesen, nicht gemessen** — beim Bau
> lag noch kein Token vor. **Abschnitt 8 trägt die Messwerte des ersten echten Laufs vom
> 24.08.2026.** Wo beides auseinandergeht, gilt Abschnitt 8.
>
> Die Unterscheidung bleibt stehen, statt alles zu überschreiben: dieses Projekt hat mehrfach
> erlebt, dass eine Spezifikation und eine API zwei verschiedene Dinge sind (siehe
> `lina-api-korrekturen.md`, `foodnotify-api-inventar.md`) — und wer nicht sieht, welche
> Aussage woher stammt, kann sie nicht prüfen.

---

**Was Bounti beantwortet — und was nicht.** Von den beiden Berichten, die in diesem
Zusammenhang immer zusammen genannt werden, gehört nur einer hierher:

| Bericht | Quelle | Stand |
|---|---|---|
| E-Learning erfolgreiche Kurse | **Bounti** | angebunden |
| Fluktuationsraten | **LINA**, Team > Mitarbeiter > Stammdaten | **nicht** aus Bounti — und hier auch nicht genähert. `bun run lina-fragen d10` klärt den Weg, siehe §4 b) |

---

## 1. Zugang

| | |
|---|---|
| Grundadresse | `https://api.bounti.co` |
| Anmeldung | **Bearer-Token** im `Authorization`-Kopf. Kein Benutzer, kein Passwort, kein Ablauf, keine Erneuerung zur Laufzeit |
| Herkunft des Tokens | Bountis Kundenservice vergibt es. Es gibt keinen Selbstbedienungsweg |
| Limit | **3.000 Anfragen je Stunde**, ausgeschrieben in der Doku |
| Rückmeldung dazu | `RateLimit-Limit`, `RateLimit-Policy`, `RateLimit-Remaining`, `RateLimit-Reset` in **jeder** Antwort |

Bounti ist damit der erste Dienst dieses Projekts, der seinen eigenen Stand mitliefert. Bei
LINA wird ein Mensch nachgeahmt und das Tempo geraten (`AGENTS.md` Regel 3), bei FoodNotify
und Yext wird gegen ein dokumentiertes Limit gerechnet — hier wird **gelesen**:
`src/bounti/client.ts` wertet `RateLimit-Remaining` aus und beendet den Lauf geordnet, bevor
das Kontingent leer ist. Der Grund ist nicht Höflichkeit: hängt die App der Mitarbeitenden am
selben Schlüssel, sperrt ein leergeräumtes Kontingent sie für den Rest der Stunde aus.

**Ein 403 `INVALID_API_KEY` wird nie wiederholt.** Regel 7 gilt hier wie bei LINA — ein
abgelehnter Schlüssel wird beim zweiten Mal genauso abgelehnt.

---

## 2. Die 29 Pfade — sieben davon werden gelesen

### Gelesen

| Methode | Pfad | Wofür | Takt |
|---|---|---|---|
| GET | `/external/v1/locations` | Standorte → `core.bounti_standort` | täglich |
| GET | `/external/v1/locations/progress` | Kursfortschritt je Standort, **ein Aufruf für alle** | täglich |
| GET | `/external/v1/employees` | Mitarbeitende, **zweimal**: `status=active` und `status=archived` | täglich |
| GET | `/external/v1/roles` | Rollen — der **Bereich** der Anforderung | täglich |
| GET | `/external/v1/courses`, `/paths` | Lernkatalog | täglich |
| GET | `/external/v1/{courses\|paths}/{id}/assignments` | Zuweisungen je Person | **Rotation**, s. u. |
| GET | `/external/v1/audits`, `/external/v1/audits/reports` | Audits und ihre Berichte | täglich, Berichte inkrementell |

### Nicht gelesen

| Pfad | Warum nicht |
|---|---|
| `GET .../reports/{reportId}` | Die Einzelantworten je Auditfrage (Abschnitte, Punkte, Bilder). **Ein Aufruf je Bericht** statt einer je Seite, und keine Kennzahl liest sie. Der Weg steht hier, falls sich das ändert |
| `GET .../schedules`, `/schedules/{id}` | Auditpläne. Interessant wäre `completionStatus` (geplant/erledigt/überfällig je Intervall) — das ist aber eine **Soll-Ist-Frage**, die erst Sinn hat, wenn der Fachbereich Auditpflichten festgelegt hat |
| `GET .../schedules/{id}/reports` | Von Bounti selbst als *deprecated* markiert, mit Verweis auf `/audits/reports` |
| **die übrigen 22** | **Sie schreiben.** `POST /employees`, `DELETE /employees/{id}`, `POST /employees/{id}/archive`, `POST /courseAssignments`, `PATCH /company`, `POST /notifications` (Push an Mitarbeitende), `POST /auth/employee/token/*` (fremde Sitzungen erzeugen) |

`src/bounti/client.ts` kennt **keine andere Methode als GET**. Das ist keine Konvention,
sondern fehlender Code: es gibt keinen Parameter, über den versehentlich ein POST entstehen
könnte. Ein Schreibzugriff wäre hier nicht eine falsche Zahl, sondern eine Push-Nachricht auf
hundert Telefonen.

---

## 3. Antwortformen und die vier Fallen

**Die Hülle.** Jede Liste antwortet `{ next, rows }`. `next` ist laut Doku *„ID of the first
item on the next page"* und wird als `cursor` zurückgegeben; `null` heißt Ende.

**Falle 1 — `/roles` hat keine Hülle.** Der einzige Listenendpunkt, der ein blankes Array
zurückgibt. Wer ihn durch den Seitenlauf schickt, bekommt `undefined.rows` und damit null
Rollen — lautlos.

**Falle 2 — zwei Skalen für dasselbe.**

| Feld | Skala | Beispiel der Doku |
|---|---|---|
| `assessmentScore` (Kurszuweisung) | **Bruch** | *„The score of the assessment as a percentage (0.8 is 80%)"* |
| `achievedPercentage` (Auditbericht) | **Prozentzahl** | `85` |

`AGENTS.md` Regel 6 verlangt Prozentzahlen. `alsProzent()` in `src/bounti/laden.ts`
multipliziert deshalb den Bruch — und **prüft dabei**: kommt ein Wert über 1, hat Bounti die
Skala gewechselt, und dann wäre die Multiplikation der Fehler. Eine Erfüllungsquote von 0,8 %
statt 80 % sieht schlecht aus, aber nicht falsch; das ist die Sorte Fehler, die ein Jahr lang
mitläuft.

**Falle 3 — `limit` ist nur an einer Stelle ausgeschrieben.** Die Voreinstellung ist überall
20; eine Obergrenze („1-100") nennt die Spezifikation **nur** bei den Auditplänen. Dass 100
überall geht, ist eine Annahme. Der Client probiert sie einmal und fällt bei einem HTTP 400
zu `limit` dauerhaft auf 20 zurück — dasselbe Vorgehen wie bei Yext mit den zwei
Anmeldewegen.

**Falle 4 — der Cursor, der sich nicht bewegt.** Wiederholt eine API denselben `next`-Wert,
dreht ein unbeaufsichtigter Nachtlauf bis zum Morgen und räumt das Stundenkontingent leer.
`bountiSeiten()` merkt sich die gesehenen Cursor und bricht ab; dazu eine Seitenobergrenze als
Rückhalt. Beides ist in `src/bounti/client.test.ts` geprüft.

### Was inkrementell geht — und was nicht

**Nur ein einziger Endpunkt der ganzen Schnittstelle kennt einen Zeitfilter:**
`/audits/reports` mit `after`/`before`. Alles andere liefert immer den ganzen Bestand.

Für die **Zuweisungen** ist das die teuerste Eigenschaft der Anbindung: es gibt weder `after`
noch einen Änderungszeitstempel, also muss je Kurs die ganze Liste geholt werden. Deshalb
**Rotation mit Obergrenze statt Handbefehl** (Entscheidung vom 14.08.2026, siehe
`entscheidungen.md`): `BOUNTI_LERNEINHEITEN_JE_LAUF` (Vorgabe 40) arbeitet je Nacht die am
längsten nicht geholten ab. Der Rückstand steht in `mart.bounti_zuweisung_stand` und **muss
von Nacht zu Nacht fallen** — die Zahl, die Regel 10 hier verlangt.

Die Auditberichte werden mit **sieben Tagen Überlappung** geholt, nicht scharf ab
`max(erstellt_am)`: ein Bericht entsteht beim Beginn des Audits und wird Tage später
abgeschlossen. Wer scharf schneidet, sieht den Abschluss nie und trägt dauerhaft eine zu
niedrige Erfüllungszahl mit sich.

---

## 4. Die Anforderung — und was davon ankommt

Die Anforderung steht an vier Stellen im Projekt, und sie ist enger, als der Umfang der API
vermuten lässt:

| Quelle | Wortlaut |
|---|---|
| `examples/Umsetzung Berichte (1).xlsx`, Ebene *Laden* | **„E-Learning erfolgreiche Kurse"** (Prio 3, *Status Bericht* 0) — **und getrennt davon** „Fluktuationsraten" (Prio 3, *Status Bericht* **1**), die **nicht** aus Bounti kommt, siehe Kasten unten |
| `examples/Projektbeschreibung (1).docx` | *„Die Mitarbeiterqualifikation muss durch Bounti übergeben werden."* Dazu in der Quellentabelle: *„Mitarbeiterdaten Details inkl. Quali — LINA, Bounti"*, Ebene Betrieb |
| `docs/datenlage-round-table.html`, Abschnitt *Fremde Systeme* | *„Für Kapitel 4.1 und 4.2 brauchen wir **Mitarbeiterstamm, Betriebszuordnung mit stabilem Schlüssel, Bereich, Kurskatalog mit Pflichtkennzeichen und Frist, Kursstatus je Mitarbeitendem**. Der Bereich ist der wichtigste Punkt: welchem Bereich ein Mitarbeitender zugeordnet ist, weiß sonst kein System."* |
| `docs/kennzahlen-mapping.md` | Zeile *„Fluktuationsraten, E-Learning \| Team / Bounti \| 🔴"* |

Punkt für Punkt gegen die Spezifikation gehalten:

| Verlangt | Liefert Bounti | Stand |
|---|---|---|
| **Mitarbeiterstamm** | `GET /employees`, aktiv **und** archiviert | ✅ |
| **Betriebszuordnung mit stabilem Schlüssel** | `locations[]` je Person, mit ID — kein Namensabgleich nötig. Nur *Bounti-Standort → LINA-Betrieb* ist einmal zu entscheiden | ✅ |
| **Bereich** | `roles[]` je Person, dazu `GET /roles` | ⚠️ **technisch da, fachlich ungeprüft** — ob dort Küche/Service/Bar gepflegt ist oder nur Rechte-Rollen („Admin", „Trainer"), sagt erst der echte Zugang. `bun run bounti:pruefen` gibt die Liste aus |
| **Kurskatalog** | `GET /courses`, `GET /paths` | ✅ |
| **… mit Pflichtkennzeichen** | **nichts.** `/courses` liefert ausschließlich `{id, name}` | 🔴 **Lücke** |
| **… mit Frist** | keine Frist am Kurs — nur `dueAt` je **Zuweisung** | 🟡 **Ersatzweg**, s. u. |
| **Kursstatus je Mitarbeitendem** | `completedAt`, `dueAt`, `assessmentScore` je Zuweisung | ✅ |
| **Fluktuationsrate** | *gehört nicht hierher* — Bounti liest die Personaldaten selbst aus LINA | 🔴 **LINA-Kennzahl**, hier bewusst nicht genähert, s. Kasten |

### Die drei Einschränkungen im Klartext

**a) Pflichtkennzeichen gibt es nicht.** Die API kennt keinen Weg, eine Pflichtschulung von
einer freiwilligen zu unterscheiden. Der Ersatzweg ist `dueAt`: eine Zuweisung **mit Frist**
ist verbindlich gemeint, eine ohne nicht. Das ist eine Annahme über die Arbeitsweise, keine
Zusage der Schnittstelle — deshalb weist `mart.bounti_schulung_betrieb_monat` die Zuweisungen
ohne Frist als eigene Spalte `ohne_frist` aus, statt sie stillschweigend mitzuzählen. Ist der
Anteil groß, ist die Kennzahl „überfällig" wertlos, und das sieht man dann auch.

**b) Die Fluktuationsrate ist keine Bounti-Kennzahl — und wird hier auch nicht genähert.**

> **Korrektur 24.08.2026, noch am Tag der Anbindung.** ~~Bounti beantwortet „Fluktuationsraten"~~
> — falsch. `kennzahlen-mapping.md` führte beide Berichte in **einer** Zeile
> („Fluktuationsraten, E-Learning | Team / Bounti"); die Quellen gehören dabei **paarweise**
> zu den Kennzahlen: Fluktuation → *Team* (LINA), E-Learning → *Bounti*. In der Berichtsliste
> sind es zwei getrennte Zeilen, und die eine trägt *Status Bericht = **1***: **den
> Fluktuationsbericht gibt es in LINA bereits.**

**Der Befund, der es entscheidet**, steht seit dem 11.08.2026 im Haus, nur an anderer Stelle
— `lina-api-inventar-ladenakte.md` §4 e): **Bounti hält einen LINA-API-Schlüssel mit dem Scope
*Personalstammdaten und Kosten*.** Bounti *liest* die Personaldaten also aus LINA. Die
Fluktuation aus Bounti zurückzurechnen hieße, **eine Kopie gegen ihr Original zu messen** —
und zwar eine mit Verzug: wer ausscheidet, verschwindet dort erst, wenn jemand das Konto
archiviert.

~~Eine frühe Fassung dieser Anbindung schrieb deshalb `core.bounti_mitarbeiter_stand` fort und
rechnete darauf `mart.bounti_personal_monat`.~~ **Beides ist wieder entfernt**, bevor die
Migration irgendwo angewendet war. Eine Zahl, die *fast* richtig aussieht, ist in diesem
Projekt teurer als eine, die fehlt: die fehlende fällt auf, die fast richtige wird verwendet.
Dieselbe Linie wie bei `mart.pruefung_wareneinsatz` (`0029`, stillgelegt statt „ungefähr
gelassen").

**Was stattdessen offen ist — und wie es geschlossen wird:** `/personal/mitarbeiter/manageusers`
meldete am 25.07.2026 `access: false`, **aber auf Konzernebene**. Dieselbe Ebene antwortet auch
für BWA und Belege mit HTTP 500, während die Ladenakte je Betrieb beides anstandslos
herausgibt (Weg A). Ob es hier ebenso ist, ist **nie gemessen worden**. Genau dafür gibt es
seit dem 24.08.2026 eine Messung:

```
bun run lina-fragen d10
```

Ein lesender Aufruf, im Terminal des Nutzers oder im Container (Regel 7a). Er entscheidet, ob
die Kennzahl eine Aufwandsfrage ist oder eine Rechtefrage — und die ginge dann an **Concept
Family**, deren Administrator die API-Schlüssel selbst anlegt, nicht an LINA.

**c) Kapitel 4.2 bleibt halb.** *Kurswirkung* heißt: Kursabschluss gegen Durchschnittsbon und
Zusatzverkäufe **je Person**. Bounti liefert seine Hälfte vollständig — die andere fehlt
weiterhin an LINA: die Mitarbeiterstammdaten sind für unseren Zugang gesperrt, das
Kassenjournal ebenfalls (`offene-punkte.md`). Ohne einen Schlüssel, den beide Systeme kennen,
gibt es keinen Join.

**Ein möglicher Ersatzweg steht in `customFields`.** `GET /employees` liefert frei
konfigurierbare Felder mit; Bountis eigenes Beispiel nennt `employee_id` und `cost_center`.
Wäre dort eine Personalnummer gepflegt, die auch LINA führt, wäre die Brücke da. Ob es sie
gibt, weiß vorher niemand — deshalb schreibt der Lader **nur die Feldnamen und ihre
Belegungszahl** nach `core.bounti_feldname`, nie die Werte. Die Frage ist damit beim ersten
echten Lauf beantwortet, ohne dass unbesehen personenbezogene Freitextfelder importiert
werden.

### Was über die Anforderung hinaus dabei ist

**Audits.** In keinem der vier Anforderungsdokumente steht ein Wort davon, und die
Schnittstelle führt sie mit Punktzahl, Auditor, Ziel und Zeitpunkt:
`LOCATION_AUDIT` ist eine **bewertete Begehung eines Betriebs**. Damit gäbe es erstmals eine
objektive Betriebsnote aus einem Fachsystem — und `manual.om_einschaetzung`, die subjektive
Note des Operations Managers, ist seit Juli 2026 leer (Migration `0079`).

Der Zusammenhang liegt nahe genug, dass er hier stehen muss, **und er ist bewusst nicht
gebaut**: `ampel.gesamt()` bleibt unberührt, `mart.bounti_audit_betrieb_monat` steht daneben.
Ob eine Auditnote die OM-Einschätzung ersetzt, ist eine fachliche Entscheidung und keine
technische — sie steht in `offene-punkte.md`. Eine Ampel, deren Bedeutung sich still ändert,
ist schlimmer als eine graue.

---

## 5. Personenbezug — was gespeichert wird und was nicht

| Feld | gespeichert | Begründung |
|---|---|---|
| `id` | ✅ | der Schlüssel, ohne den nichts geht |
| `name`, `surname` | ✅ | Eine überfällige Pflichtschulung ohne Namen ist eine Zahl, mit der niemand etwas tun kann. Gedeckt durch die Entscheidung vom 13.08.2026 (`entscheidungen.md`): mit der Round-Table-Map gibt es den Zweck, den es vorher nicht gab, und Kapitel 4.2 verlangt die Zuordnung *je Mitarbeiter* |
| `locations`, `roles` | ✅ | Betrieb und Bereich — der Kern der Auswertung |
| `email`, `phone` | ❌ | Für keine Kennzahl nötig. Die Person ist hier ein Schlüssel, kein Adressbuch |
| `customFields` (Werte) | ❌ | s. o. — nur Feldnamen und Belegungszahl |
| Auditor je Bericht | nur `id` | Name und Vorname der auditierenden Person werden verworfen |

Dieselbe Linie wie bei `core.bewertung`, wo `authorName` gespeichert wird und `authorEmail`
bewusst fehlt: **was nicht im Typ steht, kann niemand versehentlich in ein INSERT schreiben.**

---

## 6. Was der Nachtlauf kostet

Alles gerechnet, nichts gemessen — die Mengen sind unbekannt, bis der Zugang steht.

| | Aufrufe |
|---|---|
| Standorte, Rollen, Kurse, Pfade, Audits, Fortschritt | ~10 |
| Mitarbeitende, aktiv und archiviert, 100 je Seite | ~2 je 100 Personen |
| Auditberichte, inkrementell | ~5 |
| Zuweisungen: **1 bis n je Lerneinheit**, 40 Lerneinheiten je Nacht | 40 – 200 |

Zusammen deutlich unter dem Budget von `BOUNTI_AUFRUFE_MAX` (1.200) und weit unter Bountis
3.000 je Stunde. Der Nachlauf läuft höchstens alle 20 Stunden.

---

## 7. Offen, bis der Zugang steht

Alles, was `bun run bounti:pruefen` beantwortet:

1. **Sind Rollen als Bereich gepflegt?** Der wichtigste Punkt der Anforderung. Stehen dort
   nur „Admin" und „Trainer", ist die Auswertung je Bereich nicht möglich — und das ist eine
   Meldung an den Fachbereich, keine Codeänderung.
2. **Nimmt Bounti `limit=100`?**
3. **Gibt es ein Personalnummernfeld in `customFields`?** Entscheidet, ob Kapitel 4.2 je
   Person überhaupt erreichbar wird.
4. **Ist `assessmentScore` wirklich ein Bruch?**
5. **Wie viele Kurse, Pfade und Zuweisungen gibt es?** Davon hängt ab, ob 40 Lerneinheiten je
   Nacht passen.
6. **Tragen die Zuweisungen Fristen?** Ohne sie ist „überfällig" nicht berechenbar.
7. **Wie viele Standorte führt Bounti, und wie heißen sie?** Davon hängt ab, wie viel von der
   Zuordnung der Automat schafft und wie viel nach `VON_HAND` in `src/bounti/zuordnen.ts`
   gehört.

Und eine, die **nicht** hier beantwortet wird, weil sie nicht hierher gehört:

8. **Woher kommt die Fluktuationsrate?** → `bun run lina-fragen d10`, siehe §4 b).

---

## 8. Nachtrag: der erste echte Lauf (24.08.2026)

Der Zugang steht. Alles oberhalb dieser Zeile war aus der Spezifikation gelesen — hier stehen
**Messwerte**. Wo beides auseinandergeht, gilt dieser Abschnitt.

### Was der Zugang sieht

| | |
|---|---|
| Standorte | **88** |
| Rollen | **28** — und es sind echte **Bereiche**: Bar, Küche, Service, Spülküche, Biergarten, Catering, Fahrer, Lieferdienst, Manager, Operation Manager … |
| Mitarbeitende | **2.373 aktiv, 2.423 archiviert** |
| davon ohne Standort | 26 aktive (zählen in **keinem** Betrieb mit) |
| davon an mehreren Standorten | 27 (zählen in **jedem** ihrer Betriebe mit) |
| davon ohne Rolle | 42 |
| Lernkatalog | **441 Kurse, 29 Pfade** = 470 Lerneinheiten |
| Audits | **66**, davon 63 auf Standortebene |
| Auditberichte | **133**, alle abgeschlossen, Schnitt **39,1 %** |
| Kosten des Vorlaufs | 68 Aufrufe, danach 2.864 von 3.000 übrig |

**Die wichtigste offene Frage ist damit beantwortet: der „Bereich" ist gepflegt.** 28 Rollen,
und sie tragen die Namen, die der Round Table braucht. Die Auswertung je Bereich ist möglich.

### Die vier Annahmen aus §7, gegengeprüft

| Annahme | Ergebnis |
|---|---|
| `limit=100` wird akzeptiert | ✅ kein Rückfall auf 20 |
| Antwortform `{next, rows}`, `/roles` ohne Hülle | ✅ genau so |
| `assessmentScore` ist ein Bruch | ⚠️ **keine Werte in der Stichprobe** — die Skalenprüfung in `alsProzent()` bleibt scharf |
| Zuweisungen tragen Fristen | ✅ Stichprobe: **203 von 207** mit `dueAt`. „Überfällig" ist berechenbar |
| `customFields` als Brücke zu LINA | 🔴 **null Felder konfiguriert.** Es gibt keinen gemeinsamen Schlüssel mit LINA |

### Was der erste Ladelauf gebracht hat

392 Aufrufe, rund zweieinhalb Minuten. In der Datenbank: 88 Standorte, 28 Rollen, 4.796
Mitarbeitende, 470 Lerneinheiten, **15.804 Zuweisungen** aus den ersten 120 Lerneinheiten, 82
Fortschrittszeilen, 66 Audits, 133 Auditberichte.

**Der Katalog ist größer als angenommen**, und das hat eine Vorgabe verschoben:
`BOUNTI_LERNEINHEITEN_JE_LAUF` stand auf 40 — bei 470 Lerneinheiten wären das **zwölf Nächte**
bis zum ersten vollständigen Bestand, und zwölf Nächte lang zeigt jede Erfüllungsquote zu
wenig, ohne dass man es ihr ansieht. Jetzt **120**: vier Nächte, rund 360 Aufrufe je Nacht.

### Zwei Befunde, die man den Zahlen nicht ansieht

**1. Die Auditauswertung ist leer — und das ist kein Fehler.** `mart.bounti_audit_betrieb_monat`
lieferte null Zeilen bei 133 geladenen Berichten. Der Grund: **alle 133 hängen an genau drei
Standorten**, und keiner der drei hat einen Betrieb.

| Bounti-Standort | Berichte | Schnitt |
|---|---|---|
| Wirtshaus am Münzplatz | 110 | 39,1 % |
| Wirtshaus im Park Mönchengladbach | 22 | 36,4 % |
| Würzburger Augustiner | 1 | 100 % |

Das Auditmodul wird also von **drei Häusern** benutzt, nicht von 88 — und solange die drei
nicht zugeordnet sind, ist die ganze Auditstrecke wertlos. Die Prüfzeile *„Bounti:
Auditbericht ohne Betrieb"* macht genau das sichtbar (133 von 133); die Zeile *„Standort ohne
Betrieb"* sah es nicht, weil sie 26 unzugeordnete Standorte zählt, von denen die meisten gar
keine Audits haben. Dieselbe Signatur wie bei Migration `0092`: eine Sicht, die fehlerfrei,
schnell und leer läuft.

**2. Die Namen der drei sagen etwas.** Es sind Einzelkonzepte — dieselbe Gruppe, die auch bei
Yext offen ist. Wer die drei zuordnet, schaltet 133 bewertete Begehungen frei.

### Zuordnung Standort → Betrieb

**62 von 88 automatisch**, davon 6 über den Namen und 7 aus einer bereits für Yext getroffenen
Entscheidung (nachvollziehbar in `src/bounti/zuordnen.ts`, jede Zeile mit ihrer Yext-Entität
als Beleg). **26 bleiben offen** und stehen in `mart.bounti_ohne_betrieb`:

* **9 Einzelkonzepte/Wirtshäuser** — darunter die drei auditierten
* **7 Berliner Standorte** (Zoo Berlin, Tierpark Berlin, BRLO, Schoenwetter Mauerpark, Park am
  Gleisdreieck ×2, Norddeich Strand) — in LINA gibt es dazu **nichts**. Was das ist, weiß nur
  der Fachbereich
* **5 Fälle, die auch bei Yext ausdrücklich offen sind** (Besitos Würzburg, Carls Brauhaus,
  Riegele Augsburg, Würzburger Hofbräukeller, Lehners Pforzheim)
* **4 Nicht-Betriebe** (LINA TEST, Concept Family, Concept Family Intern, Ops Enchilada) —
  als `null` eingetragen, damit der Automat sie nicht doch noch irgendwo hinsortiert
* **1 mehrdeutiger** (Schlager Cafe: drei gleichnamige Gesellschaften in LINA)

Umgekehrt: **8 operative Betriebe mit Umsatz haben keinen Bounti-Standort.**

---

## 9. Die Auswertungsschicht (Migration `0097`, 24.08.2026)

`0096` hat die Daten geholt und neun Sichten gebaut, die beantworten, **ob die
Anbindung stimmt** — Zuordnungslücken, Rückstand des Zuweisungsabgleichs,
Gegenprobe gegen Bountis eigene Aggregation. Das ist Betriebsüberwachung, keine
Auswertung.

`0097` liefert die andere Hälfte: **was die Daten über die Betriebe sagen.** Neun
Sichten auf dem vorhandenen Bestand, keine neue Tabelle, kein neuer Abruf.

| Sicht | Ebene | Wofür |
|---|---|---|
| `mart.bounti_schulung_person` | eine Zeile je **Zuweisung** | die Grundlage aller anderen; vier Zustände statt zwei |
| `mart.bounti_person_stand` | je **Person** | die Arbeitsliste — wer muss was nachholen |
| `mart.bounti_betrieb_stand` | je **Betrieb** | die Leitsicht, Stand heute |
| `mart.bounti_schulung_verlauf` | je Betrieb und **Monat** | die einzige Zeitachse |
| `mart.bounti_lerneinheit_betrieb` | je **Lerneinheit** | die andere Leserichtung |
| `mart.bounti_auditbericht_liste` | je **Auditbericht** | einschließlich der ohne Betrieb |
| `mart.bounti_rolle_betrieb` | je **Rolle** | die einzige Strukturaussage ohne LINA |
| `mart.bounti_standort_offen` | je **unzugeordnetem Standort** | die Arbeitsliste der Zuordnung, nach Gewicht |
| `mart.bounti_abdeckung` | je **Gegenstand** | wie viel überhaupt bei einem Betrieb ankommt |

### Drei Festlegungen, die man den Sichten sonst nicht ansieht

**Stand heute, nicht Stichmonat.** `bounti_betrieb_stand` kennt keinen Monat.
„Überfällig" ist eine Aussage über heute; in den Monat der Zuweisung
zurückgerechnet stünde eine täglich steigende Zahl unter einem abgeschlossenen
Monat. Den Verlauf gibt es daneben, und dort ist der Monat der der **Zuweisung** —
dieselbe Festlegung wie in `0096`, aus demselben Grund: sonst fällt die nie
erledigte Pflichtschulung aus der Statistik.

**Alle Betriebe, auch die ohne Bounti.** `bounti_betrieb_stand` geht von
`core.betrieb` aus und hängt Bounti links an, nicht umgekehrt. Ein Betrieb ohne
Standort steht damit **mit leeren Zahlen** in derselben Tabelle statt gar nicht.
Die Spalte `in_bounti` ist der Unterschied zwischen „keine überfällige Schulung"
und „wir wissen es nicht" — und sie betrifft **79 der 141 Betriebe**, acht davon
operativ mit Umsatz.

**`operativ` steht am Ende jeder Spaltenliste.** Nicht aus Nachlässigkeit:
`CREATE OR REPLACE VIEW` kann Spalten nur anhängen, nicht einschieben. Ein
mittig eingefügtes Feld quittiert Postgres mit `42P16` — und zwar erst beim
zweiten Lauf der Migration, also auf dem Zielsystem und nicht beim Entwickeln.

### Gemessene Zahlen (24.08.2026)

| | gesamt | in einer Betriebsauswertung | fällt heraus |
|---|--:|--:|--:|
| Standorte | 88 | 62 | 26 |
| aktive Personen | 2.346 | 1.754 | **592** |
| Zuweisungen | 74.683 | 64.314 | 10.369 |
| Auditberichte | 133 | **0** | 133 |
| Betriebe | 141 | 62 | 79 |
| davon operativ | 57 | 49 | 8 |

Von den 64.314 zugeordneten Zuweisungen hängen weitere **6.330 an nicht
operativen Betrieben** (geschlossen, verwaltend, ohne Umsatz). Die Auswertungen
filtern sie heraus — dieselbe Linie wie Migration `0039` für die Ampeln.

**Zuweisungen ohne Frist: 29.513 von 74.683.** Sie können nie überfällig werden.
Solange die Zahl so groß ist, misst die Erfüllungsquote weniger, als sie zu
messen scheint: ohne Frist ist „noch nicht gemacht" von „zu spät" nicht zu
unterscheiden.

**Archivierte Konten sind kein Problem.** Von den überfälligen Zuweisungen in
operativen Betrieben hängt **genau eine** an einem archivierten Konto — Bounti
schließt beim Archivieren offenbar mit. Die Annahme, hier läge eine große
Karteileiche, war falsch; die Arbeitslisten filtern trotzdem, weil ein
stillgelegtes Konto nichts nachholt.
