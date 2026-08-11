# Yext Analytics — was der Zugang kann und was davon ins Dashboard gehört

Gemessen am 10.08.2026 gegen das Produktivkonto (`accountId 1559219539920412896`), ausschließlich
lesend. Anlass: wir importieren bisher nur die Note. Gesucht war die **Klusterung** — woran genau
liegt es, wenn ein Haus abrutscht.

Kurzfassung: die Klusterung gibt es, sie heißt `REVIEW_LABELS`, sie hat fünf Themen und reicht nur
bis April 2026 zurück. Die eigentliche Sentiment-Auswertung von Yext ist für unsere Daten
unbrauchbar. Dahinter liegen aber **75 Metriken**, nach denen niemand gefragt hat — darunter das
Antwortverhalten der Betriebe, der Pflegezustand der Portaleinträge und ein Wettbewerbsvergleich.

> **Zur Entstehung:** die erste Fassung dieses Dokuments beruhte auf geratenen Metriknamen, weil
> `docs.yext.com` beim ersten Versuch nicht erreichbar war. Über die Doku kam dann
> `GET /analytics/catalog` ans Licht — der Endpunkt, der das Vokabular selbst ausgibt. Statt 13
> geratener Metriken sind es 75 echte. Alles unten ist gegen den Katalog geprüft.

---

## 1. Der Zugang

Vier Endpunkte, alle lesend:

| | |
|---|---|
| `GET /v2/accounts/me/analytics/catalog` | **alle Metriken + je Metrik das Datum, bis zu dem Daten vollständig sind** |
| `GET /v2/accounts/me/analytics/maxdates` | globaler Datenstand |
| `POST /v2/accounts/me/analytics/reports` | die eigentliche Abfrage |
| `.../analytics/reportstatus` | Status asynchroner Reports (404 ohne Report-ID) |

**Nebenbemerkung, gehört in `entscheidungen.md`:** `docs/yext-anbindung.md` §2.2 hat die
Analytics-API ausdrücklich *abbestellt* („Ausdrücklich nicht benötigt — bitte diese Rechte nicht
vergeben: … Analytics-API"). Vergeben wurde sie trotzdem, und zwar recht großzügig. Das ist kein
Schaden, aber der zweite Fall nach der fehlenden Mandantentrennung, in dem die Rechte weiter sind
als beantragt.

### Der Report-Körper

```json
{ "metrics": [...], "dimensions": [...], "filters": {...} }
```

| Feld | |
|---|---|
| `metrics` | Pflicht, **höchstens 10** je Report |
| `dimensions` | Pflicht, höchstens 10 — davon nur **eine Zeitdimension** und **eine Ortsdimension** |
| `filters` | `entityIds`, `folderIds`, `publishers`, `reviewLabels`, `ratings`, `awaitingResponse`, `startDate`, `endDate` |

**Kein** `limit`, `offset`, `sortBy`, `orderBy`. Die Antwort kommt vollständig und unsortiert —
Top-N wird bei uns gerechnet. Für große Auswertungen gibt es `?async=true` mit Callback-URL; für
unsere Größenordnung nicht nötig.

### Die Mandantenfalle gilt hier genauso

Ohne `filters.entityIds` liefert **jeder** Report das ganze Konto, also auch my Indigo, Pommes
Freunde, Gimme Gelato und Soulkitchen. Gegenprobe, Mai–10.08., Thema „Food": unsere 60 Betriebe
1.952 Bewertungen (ø 4,35), ganzes Konto 2.868 (ø 4,23). Also dieselbe Regel wie im Importer:
**immer über `manual.betrieb_fremd_id` filtern.** Die 60 IDs passen in einen Aufruf.

---

## 2. Datenfrische — der Grund, warum es `catalog` gibt

`maxdates` meldet `standardMaxDate: 2026-06-30`, der Katalog nennt je Metrik ein eigenes
`completedDate`. Beides ist wichtig, weil der Report-Endpunkt **trotzdem Zahlen für Juli und
August liefert** — nur eben unvollständige, ohne jeden Hinweis darauf.

| Metrik | vollständig bis |
|---|---|
| `LISTINGS_GOOGLE_SEARCH_TERM_IMPRESSIONS` | **2026-06-30** ← der Ausreißer, den `standardMaxDate` meint |
| `TOTAL_LISTINGS_IMPRESSIONS` | 2026-08-02 |
| `GOOGLE_LISTINGS_*`, `TOTAL_LISTINGS_ACTIONS` | 2026-08-03 |
| `APPLE_*` | 2026-08-04 |
| `FACEBOOK_*`, `PROFILE_VIEWS` | 2026-08-05 |
| `SEARCHES`, `POWERLISTINGS_LIVE` | 2026-08-07 |
| `NEW_REVIEWS`, `AVERAGE_RATING`, `RESPONSE_*`, `KEYWORD_*`, `LISTINGS_ACCURACY` | 2026-08-09 |

**Konsequenz fürs Dashboard:** Bewertungs- und Antwortkennzahlen sind tagesaktuell, die
Sichtbarkeitszahlen hinken bis zu einer Woche hinterher, und die Google-Suchbegriffe stehen sechs
Wochen still. Eine Karte „Datenstand" gehört dazu, sonst erklärt irgendwann jemand einen
Wochenendabfall zum Trend. Der Katalog ist ein Aufruf und liefert das frei Haus.

---

## 3. Das Vokabular

**75 Metriken** im Katalog, **alle 75** vom Report-Endpunkt angenommen. Die fürs Dashboard
relevanten Gruppen:

| Gruppe | Metriken |
|---|---|
| Bewertungen | `NEW_REVIEWS`, `AVERAGE_RATING` |
| Antwortverhalten | `RESPONSE_RATE`, `RESPONSE_COUNT`, `RESPONSE_TIME`, `REVIEW_RESPONSE_TIME_REVIEW_TIMESTAMP_BASED` |
| Stichworte | `KEYWORD_MENTIONS`, `KEYWORD_SENTIMENT` |
| Sichtbarkeit | `TOTAL_LISTINGS_IMPRESSIONS`, `GOOGLE_LISTINGS_IMPRESSIONS`, `TOTAL_LISTINGS_ACTIONS`, `GOOGLE_LISTINGS_ACTIONS`, `SEARCHES`, `BING_SEARCHES`, `PROFILE_VIEWS`, `CLICK_COUNT` |
| **Wettbewerbsvergleich** | `*_BENCHMARK_LOWER` / `_MEDIAN` / `_UPPER` zu Google- und Gesamt-Impressions und -Aktionen (12 Stück) |
| Pflegezustand | `LISTINGS_ACCURACY`, `LISTINGS_LIVE`, `POWERLISTINGS_LIVE`, `LISTINGS_UPDATED`, `PROFILE_UPDATES`, `PUBLISHER_SUGGESTIONS`, `SUGGESTION_COUNT`, `UNAVAILABLE_REASON_COUNT`, `RESOLVED_UNAVAILABLE_REASON_COUNT`, `DUPLICATES_DETECTED`, `DUPLICATES_SUPPRESSED` |
| Soziale Netze | 16 × `FACEBOOK_*` / `FB_PAGE_*`, `INSTAGRAM_PAGE_ACTIONS`, `SOCIAL_ACTIVITIES` |
| Apple | `APPLE_LISTINGS_ACTIONS`, `APPLE_PLACE_CARD_VIEWS`, `APPLE_SEARCH_TAPS`, `APPLE_SHOWCASE_TAPS` |
| Sonstiges | `GOOGLE_USER_PHOTOS`, `CONVERSION_COUNT`, `TOTAL_CONVERSION_VALUE`, `WIDGETS_REVIEWS_VIEWS`, `FEATURED_MESSAGE_CLICKS` |

**27 Dimensionen** (es gibt keinen Katalog dafür, das ist erprobt):

| Gruppe | |
|---|---|
| Ort | `ENTITY_IDS`, `LOCATION_IDS`, `LOCATION_NAMES`, `FOLDERS`, `FOLDER_IDS`, `ENTITY_LABELS`, `ENTITY_TYPES` |
| Zeit | `DAYS`, `WEEKS`, `MONTHS`, `QUARTERS` |
| Portal | `PUBLISHERS`, `PARTNERS`, `REVIEW_PUBLISHER_TYPE` |
| **Inhalt** | **`REVIEW_LABELS`**, `REVIEW_TOPICS`, `REVIEW_CONTENT`, `RATINGS` |
| Bearbeitung | `AWAITING_RESPONSE`, `RESPONSE_TIME`, `RESPONSE_SOURCE`, `REVIEW_STATUS`, `USER_NAME`, `SUGGESTION_STATUS` |
| Sonstige | `DEVICE` |
| **Kaputt / leer** | `REVIEW_TRENDS` (HTTP 500, reproduzierbar), `STATE` (liefert zu keiner Metrik etwas) |

Es gibt **keine** `SEARCH_TERMS`-Dimension — die Suchbegriffe hinter
`LISTINGS_GOOGLE_SEARCH_TERM_IMPRESSIONS` sind über diese API nicht aufschlüsselbar.

---

## 4. Die Klusterung: `REVIEW_LABELS`

Fünf Themen, unsere 60 Betriebe, Mai–10.08.2026:

| Thema | Bewertungen | ø Note |
|---|---:|---:|
| Service and Staff | 2.033 | 4,23 |
| Food | 1.952 | **4,35** |
| Speed of Service | 446 | 3,47 |
| **Order** | 215 | **2,50** |
| Restaurant Cleanliness | 112 | 3,83 |

Das ist die gesuchte Antwort, und sie trägt: **Küche und Service halten die Note, „Order" und
„Speed of Service" ziehen sie herunter.** „Order" bei ø 2,50 gegen einen Gesamtschnitt von 4,23
ist der deutlichste Ausschlag im ganzen Datensatz.

Auf Betriebsebene genauso (A_02): Food 4,56 · Service 4,44 · Speed of Service 3,50 ·
Restaurant Cleanliness 2,67 · Order 2,50.

### Drei Einschränkungen, die mit ins Dashboard müssen

**a) Die Labels beginnen im April 2026.** Über Januar 2025 bis März 2026 null bis zwei Treffer je
Monat, dann 1.201 (April) · 2.064 (Mai) · 2.089 (Juni) · 2.195 (Juli). Kein Vorjahresvergleich vor
April 2027. Bis dahin: Verlauf zeigen, nicht bewerten.

**b) Eine Bewertung trägt mehrere Labels.** Im Mai stehen 2.064 Label-Treffer gegen 2.019
Bewertungen. Die Summe über die Themen ist **nicht** die Zahl der Bewertungen. Anteile immer gegen
ein separates `NEW_REVIEWS` ohne Label-Dimension rechnen — sonst ergeben die Prozente in Summe
mehr als 100 und niemand findet den Fehler wieder.

**c) Nur Bewertungen mit Text** bekommen ein Label. Reine Sterne-Bewertungen fallen heraus.

---

## 5. Was ausdrücklich *nicht* funktioniert

**`KEYWORD_SENTIMENT` ist für unsere Daten tot.** Skala −0,9 bis +0,9, aber von 5.119 Stichworten
stehen **4.362 auf exakt 0** — und zwar genau die großen: essen 0, bedienung 0, personal 0,
getränke 0, preis 0. Auf Label-Ebene liegt alles zwischen −0,01 und +0,05, während `AVERAGE_RATING`
dieselben fünf Labels sauber von 2,50 bis 4,35 auseinanderzieht. **Die Note ist das bessere
Sentiment.**

**`REVIEW_TOPICS` ist Rohmaterial, kein Thema.** 5.119 Werte, die Spitze ist Wortsalat:
essen 1153 · service 863 · **ein 725** · **eine 487** · bedienung 372 · ambiente 360 ·
**einen 329** · **alles 308** · personal 305. Dazu Zahlen („12,90 €"), Emoji und Hashtags. Nur 151
Werte kommen auf ≥ 20 Nennungen. Brauchbar erst mit Stoppwortliste und Mindestschwelle.

**`REVIEW_CONTENT` als Dimension** liefert den vollständigen Rezensionstext als
Gruppierungsschlüssel. Wir haben die Texte bereits in `core.bewertung`, sauber begründet und
begrenzt. Über die Analytics-Schiene dasselbe noch einmal zu ziehen, wäre ein Umweg um die eigene
Entscheidung.

---

## 6. Der Fund daneben: Antwortverhalten

Danach war nicht gefragt, aber es ist der operativ schärfste Teil. Mai–10.08., nach Antwortquote:

| Entität | Betrieb | Antwortquote | Bewertungen | ø |
|---|---|---:|---:|---:|
| EK_12 | Badischer Hof Ettlingen | **0 %** | 54 | 3,76 |
| EK_13 | Wirtshaus Im Jagdgrund | **0 %** | 9 | 4,00 |
| EK_08 | Ratskeller Augsburg | 1 % | 125 | 4,63 |
| EK_09 | Ratskeller Ludwigsburg | 7 % | 14 | 3,86 |
| E_24 | Enchilada Münster | 21 % | 29 | 4,34 |
| E_13 | Enchilada Hamm | 26 % | 27 | 4,30 |

Andere Häuser liegen über 90 %; der Konzernschnitt im Juni war 0,91. Das ist heute in keinem
Dashboard sichtbar, kostet nichts und ist sofort adressierbar.

Die Reaktionszeit korreliert sichtbar mit der Note:

| Reaktionszeit | Bewertungen | ø |
|---|---:|---:|
| binnen Stunde | 105 | 4,23 |
| Stunde bis Tag | 2.201 | **4,52** |
| Tag bis Woche | 1.768 | 4,28 |
| Woche bis Monat | 86 | **3,20** |

Als Zahl gibt es sie doppelt und mit unterschiedlicher Definition: `RESPONSE_TIME` = 100,54 Stunden
im Juni, `REVIEW_RESPONSE_TIME_REVIEW_TIMESTAMP_BASED` = 49,39 Stunden. Vor der Verwendung klären,
welche gemeint ist.

`RESPONSE_SOURCE` zeigt, **wer** antwortet: von 4.192 Antworten sind 1.202 „Generative", also
KI-erzeugt (ø 3,96), gegen 2.587 „Platform" (ø 4,61). Keine Kennzahl, aber eine Information, die
man haben will, bevor jemand die hohe Antwortquote als Verdienst verkauft.

---

## 7. Der Fund daneben, zweiter Teil: Sichtbarkeit und Wettbewerbsvergleich

Eine eigene Datenquelle, unabhängig von Bewertungen. Unsere 60 Betriebe, Juni 2026:

| | |
|---|---:|
| Impressions gesamt (alle Portale) | 1.968.357 |
| davon Google | 1.302.862 |
| Aktionen gesamt | 164.947 |
| Klicks | 160.528 |
| Suchen | 73.629 |
| Profilaufrufe | 20.365 |
| Google-Nutzerfotos | 102.313 |
| Bing-Suchen | 13.075 |

Dazu `DEVICE`: 4,33 Mio mobil gegen 263k Desktop — **94 % mobil**.

### Der Benchmark-Block

Yext liefert zu jedem Betrieb den **Median vergleichbarer Betriebe** (`_BENCHMARK_MEDIAN`, dazu
`_LOWER` und `_UPPER`). Je Betrieb ist das Verhältnis ist/Median aussagekräftig — Juni 2026:

| Entität | Betrieb | Google-Impressions | Median | Faktor |
|---|---|---:|---:|---:|
| W_09 | Wilma Wunder Hannover *(geschlossen)* | 328 | 1.937 | 0,17× |
| A_15 | Aposto Wuppertal Alte Papierfabrik | 3.056 | 5.759 | **0,53×** |
| A_13 | Aposto Schwetzingen | 7.147 | 9.243 | 0,77× |
| A_14 | Aposto Wuppertal | 4.548 | 5.721 | 0,79× |
| A_04 | Aposto Aschaffenburg | 6.774 | 7.978 | 0,85× |
| A_02 | Aposto Aalen | 7.980 | 9.255 | 0,86× |

Dass die sechs schwächsten (nach dem geschlossenen Haus) **allesamt Aposto** sind, ist ein Befund
für sich.

**Vorsicht bei der Aggregation:** der Median ist nicht summierbar. Über alle 60 aufaddiert kommt
147.173 gegen 1,3 Mio heraus — eine Zahl, die nach Faktor 9 aussieht und nichts bedeutet. Dazu
steht der Median bei einem Teil der Betriebe auf 0 (u. a. allen Enchiladas), die fallen aus dem
Vergleich heraus. Also **nur je Betrieb und nur wo Median > 0.**

---

## 8. Der Fund daneben, dritter Teil: Pflegezustand der Einträge

`LISTINGS_ACCURACY` — wie viel Prozent der Portaleinträge mit unseren Stammdaten übereinstimmen.
Konzern 0,95 im Juni, je Betrieb zwischen 0,85 und 1,00:

| | |
|---|---|
| unter 0,90 | A_15 (0,85) · E_05 (0,87) · EK_07 (0,89) |
| 0,90–0,93 | W_12 · W_13 · EK_10 · EK_09 · E_25 · E_32 · W_09 · W_11 · W_04 |

Dazu im Juni: **328 Einträge mit `UNAVAILABLE_REASON_COUNT`**, 13 offene `SUGGESTION_COUNT`,
14 `PUBLISHER_SUGGESTIONS`, 3.189 aktive Einträge über alle Betriebe (~53 je Haus). Duplikate:
null erkannt, null unterdrückt.

Das ist eine Arbeitsliste für das Marketing, keine Kennzahl für den Round Table — aber es ist die
Antwort auf „warum findet uns bei Aposto Wuppertal keiner".

---

## 9. Portalstruktur (Konto gesamt, 226.119 Bewertungen)

| Portal | Bewertungen | ø |
|---|---:|---:|
| GOOGLEMYBUSINESS | 183.602 | 4,27 |
| OPENTABLE | 24.259 | 4,21 |
| TRIPADVISORREVIEWS | 12.940 | **3,69** |
| FACEBOOK | 4.468 | **0** |
| GOLOCAL | 401 | 4,02 |
| FOURSQUARE | 395 | **0** |

Bestätigt §10 der Anbindung: Facebook und Foursquare führen keine Noten. Neu ist, dass
**TripAdvisor 0,58 Punkte unter Google liegt** — bei knapp 13.000 Bewertungen kein Rauschen.

Die Notenverteilung ist als Ampelgrundlage robuster als der Schnitt (unsere Betriebe, Mai–10.08.):
1★ 296 · 2★ 158 · 3★ 287 · 4★ 736 · 5★ 3.279. Der Anteil 1–2★ liegt bei 9,5 % und reagiert
schneller als ein Schnitt über zehntausende Altbewertungen.

---

## 10. Drei Fallen

1. **`LISTINGS_IMPRESSIONS` steht nicht im Katalog, wird aber angenommen** — und liefert exakt die
   Google-Zahl (1.302.862), nicht die Gesamtzahl (1.968.357). Ein Name, der nach „alle Portale"
   klingt und Google meint. Immer `TOTAL_LISTINGS_IMPRESSIONS` oder `GOOGLE_LISTINGS_IMPRESSIONS`
   schreiben, nie die Kurzform.
2. **Die Antwortnamen weichen von den Metriknamen ab** und kollidieren: `GOOGLE_LISTINGS_IMPRESSIONS`
   kommt als `LISTINGS_IMPRESSIONS` zurück, `GOOGLE_LISTINGS_ACTIONS` als `LISTINGS_ACTIONS`,
   `NEW_REVIEWS` als `Reviews`, `LISTINGS_LIVE` als `Active Listings Live`. Der Import muss auf die
   Antwortnamen abbilden, und zwar je Abfrage — nicht global.
3. **Unvollständige Monate sehen vollständig aus.** Siehe §2.

---

## 11. Die Liste — was ins Dashboard soll

### A — sofort, hoher Wert

| # | Thema | Abfrage | Wohin |
|---|---|---|---|
| 1 | **Themenprofil je Betrieb** | `REVIEW_LABELS × ENTITY_IDS`, `NEW_REVIEWS` + `AVERAGE_RATING` | Betriebsblatt — beantwortet endlich „woran liegt es" |
| 2 | **Themenverlauf** | `REVIEW_LABELS × MONTHS` | Marke und Konzern — sieht „Order" kippen, bevor der Schnitt es zeigt |
| 3 | **Antwortquote je Betrieb** | `RESPONSE_RATE × ENTITY_IDS` | Round Table / Betriebsblatt — heute unsichtbar, sofort adressierbar |
| 4 | **Offene 1–2★-Kritiken** | `AWAITING_RESPONSE × ENTITY_IDS`, `filters.ratings [1,2]` | Betriebsblatt als **Arbeitsliste**, nicht als Kennzahl |
| 5 | **Anteil 1–2★** | `RATINGS × MONTHS` | zweite Ampel neben dem Schnitt, reagiert schneller |
| 6 | **Datenstand** | `GET /analytics/catalog` | kleine Karte, verhindert Fehldeutungen (§2) |

### B — sinnvoll, etwas Vorarbeit

| # | Thema | Hinweis |
|---|---|---|
| 7 | **Sichtbarkeit vs. Wettbewerb** | `GOOGLE_LISTINGS_IMPRESSIONS` gegen `_BENCHMARK_MEDIAN`, **je Betrieb**, nur wo Median > 0 |
| 8 | **Pflegezustand** | `LISTINGS_ACCURACY × ENTITY_IDS` + `UNAVAILABLE_REASON_COUNT` — Arbeitsliste Marketing |
| 9 | **Sichtbarkeitstrichter** | `TOTAL_LISTINGS_IMPRESSIONS` → `SEARCHES` → `PROFILE_VIEWS` → `CLICK_COUNT`, eigener Reiter |
| 10 | **Portalvergleich** | `PUBLISHERS` — Facebook und Foursquare ausschließen, sonst zieht ø 0 alles herunter |
| 11 | **Reaktionszeit** | `RESPONSE_TIME`-Dimension (5 Klassen); vorher klären, welche der beiden Stundenmetriken gilt |
| 12 | **Top-Stichworte** | `REVIEW_TOPICS`, nur mit Stoppwortliste und Schwelle ≥ 20 Nennungen |

### C — nicht bauen

`KEYWORD_SENTIMENT` (85 % Nullen) · `REVIEW_TOPICS` roh · `REVIEW_TRENDS` (HTTP 500) ·
`STATE` (leer) · `REVIEW_CONTENT` als Dimension ·
`CONVERSION_*` (im Konto nicht konfiguriert, alles 0) · `FB_PAGE_*` (16 Metriken, alle 0 — Facebook
ist nicht angebunden) · Apple- und Instagram-Metriken (dreistellige Werte, kein Steuerungsnutzen)

**`USER_NAME` (Yext-Bearbeiter) steht seit dem 11.08.2026 nicht mehr auf dieser Liste.** Der
Ausschluss beruhte allein auf dem Personenbezug, und der zählt nicht mehr
(`entscheidungen.md`). Ob die Dimension gebaut wird, ist jetzt eine fachliche Frage: sie zeigt,
**wer** auf Bewertungen antwortet, und ist damit die einzige Spur zum Antwortverhalten je
Person statt je Betrieb. Achtung bei der Auswertung — im Konto liegen auch die Bearbeiter der
43 Fremdkunden der Family & Friends Marketing (§13).

---

## 12. Was das kostet

**Fast nichts.** Ein Report ist ein Aufruf, unabhängig von der Zeilenzahl: Themenprofil für alle
60 Betriebe über vier Monate, aufgeschlüsselt nach Betrieb, Thema und Monat = **790 Zeilen in
einem einzigen Aufruf.**

Völlig andere Kostenlage als die Bewertungsstände (dort rund 3.300 Aufrufe für den Backfill, weil
je Betrieb, Monat und Portal einzeln gefragt werden muss). Der komplette Block A+B liegt bei
**etwa zwölf Aufrufen je Tag** — die 10-Metriken-Grenze zwingt nur zu ein paar mehr Aufrufen, nicht
zu mehr Daten. Das Stundenlimit von 5.000 ist kein Thema.

---

## 13. Offene Fragen an Family & Friends Marketing

1. **Wer pflegt die `REVIEW_LABELS`-Regeln?** Sie gelten kontoweit, also auch für die Fremdkunden.
   Ändert dort jemand eine Regel, verschiebt sich unsere Themenkennzahl still. Die
   Reviews-API hat dafür `GET /v2/accounts/me/workflowRules` — unser Schlüssel bekommt dort **403**.
   Wir können die Labels also auswerten, aber nicht sehen, wer sie vergibt.
   Und: können wir eigene Labels bekommen — Reservierung, Preis-Leistung, Lautstärke?

2. **Warum beginnen die Labels im April 2026** und lassen sie sich rückwirkend anwenden? Von
   226.000 Bewertungen im Konto sind rund 8.300 klassifiziert. Ein Backfill würde den
   Vorjahresvergleich sofort statt in acht Monaten ermöglichen.

3. **Welche Betriebe stehen im Benchmark-Vergleich auf Median 0** und warum (u. a. alle
   Enchiladas)? Ohne Antwort ist der Vergleich nur für einen Teil der Häuser nutzbar.
