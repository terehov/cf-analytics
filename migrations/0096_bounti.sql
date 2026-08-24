-- =====================================================================
-- 0096 — Bounti: Schulung und Audits
--
-- DIE FUENFTE QUELLE. Nach LINA (Kasse), FoodNotify (Einkauf), Yext
-- (Bewertungen) und Bright Sky (Wetter) ist Bounti das System, in dem
-- die Concept Family ihre Mitarbeitenden schult und ihre Betriebe
-- auditiert.
--
-- WAS BOUNTI IN DER BERICHTSLISTE BEANTWORTET — UND WAS NICHT.
-- docs/kennzahlen-mapping.md fuehrt eine Zeile "Fluktuationsraten,
-- E-Learning | Team / Bounti". Sie fasst ZWEI Berichte zusammen, und die
-- Quellen stehen in derselben Reihenfolge wie die Kennzahlen:
--
--   E-Learning erfolgreiche Kurse  ->  Bounti      (Status Bericht 0)
--   Fluktuationsraten              ->  LINA, Team  (Status Bericht 1)
--
-- Nur der erste gehoert hierher. Die Fluktuation ist eine LINA-Kennzahl:
-- Eintritt und Austritt stehen in Team > Mitarbeiter > Stammdaten
-- (/personal/mitarbeiter/manageusers), und der genutzte Zugang hat darauf
-- `access:false`. Das ist eine Rechtefrage und steht in
-- docs/offene-punkte.md — in der Berichtsliste steht der Bericht mit
-- Status Bericht = 1, es gibt ihn in LINA also bereits.
--
-- Die Fluktuation wird hier deshalb GAR NICHT gerechnet — auch nicht als
-- Naeherung aus den Bounti-Konten. Begruendung in Abschnitt 2.
--
-- WAS BOUNTI LIEFERT (api.bounti.co/external/v1, OpenAPI 3.0 am
-- 24.08.2026 gezogen, 29 Pfade). Gelesen werden GENAU SIEBEN davon:
--
--   GET /locations              Standorte
--   GET /locations/progress     Kursfortschritt je Standort (aggregiert)
--   GET /employees              Mitarbeitende, aktiv und archiviert
--   GET /roles                  Rollen
--   GET /courses, /paths        Kurse und Lernpfade
--   GET /{courses|paths}/{id}/assignments   Zuweisungen je Person
--   GET /audits, /audits/reports            Audits und ihre Berichte
--
-- DIE UEBRIGEN 22 PFADE SIND SCHREIBZUGRIFFE und werden von diesem
-- Projekt nicht angefasst — `POST /employees`, `DELETE /employees/{id}`,
-- `POST /notifications` (Push an alle Mitarbeitenden), `PATCH /company`.
-- Der Client in src/bounti/client.ts kennt deshalb keine Methode ausser
-- GET; das ist keine Konvention, sondern fehlt schlicht als Code.
--
-- ─────────────────────────────────────────────────────────────────────
-- DREI ENTSCHEIDUNGEN, DIE MAN DEM SCHEMA SONST NICHT ANSIEHT
--
-- 1. KEINE KONTAKTDATEN. `GET /employees` liefert `email`, `phone` und
--    `customFields` mit. Nichts davon steht in diesem Schema. Fuer jede
--    Kennzahl, die hier gebaut wird — Erfuellungsquote, Kopfzahl,
--    Kontenbewegung, Auditnote — braucht es die Person als SCHLUESSEL, nicht
--    als Adressbuch. Was nicht in der Tabelle steht, kann auch niemand
--    versehentlich exportieren (dieselbe Ueberlegung wie bei
--    core.bewertung, wo `authorEmail` bewusst fehlt).
--    Vor- und Nachname stehen dagegen drin: eine ueberfaellige
--    Pflichtschulung ohne Namen ist eine Zahl, mit der niemand etwas tun
--    kann, und es sind die eigenen Mitarbeitenden des Auftraggebers.
--
-- 2. PROZENT SIND PROZENTZAHLEN (AGENTS.md Regel 6). Bounti liefert
--    `assessmentScore` als BRUCH — die eigene Doku sagt "0.8 is 80%".
--    `achievedPercentage` der Auditberichte ist dagegen schon eine
--    Prozentzahl (Beispiel 85). Zwei Felder, zwei Skalen, ein Feldname
--    weit auseinander: der Lader rechnet `ergebnis_pct = score * 100`
--    und die Spalte heisst deshalb ueberall `*_pct`.
--
-- 3. KEIN FREMDSCHLUESSEL AUF DIE MITARBEITENDEN in bounti_zuweisung.
--    Zuweisungen kommen je Kurs, Mitarbeitende kommen aus einer eigenen
--    Liste — wer in Bounti geloescht wurde (`DELETE /employees`), taucht
--    in alten Zuweisungen weiter auf. Ein Fremdschluessel liesse den
--    Import daran scheitern und wuerde einen Befund in einen Ausfall
--    verwandeln. Die Waisen stehen stattdessen in
--    mart.bounti_zuweisung_ohne_mitarbeiter und sind damit sichtbar.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Stammdaten: Standorte, Rollen, Mitarbeitende
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.bounti_standort (
    bounti_id           text PRIMARY KEY,
    name                text NOT NULL,
    zuerst_gesehen_am   date NOT NULL DEFAULT current_date,
    zuletzt_gesehen_am  date NOT NULL DEFAULT current_date,
    geladen_am          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.bounti_standort IS
'Standorte aus Bounti. Die Bruecke zu unseren Betrieben ist NICHT der Name,
sondern manual.betrieb_fremd_id mit system = ''bounti'' — dieselbe Konstruktion
wie bei Yext, aus demselben Grund: LINA fuehrt die Rechtsform mit
("Enchilada Leipzig GmbH"), die Fachsysteme nicht ("Enchilada Leipzig").

zuletzt_gesehen_am sagt, ob der Standort in der letzten Abfrage noch dabei war.
Ein Standort, der verschwindet, wird NICHT geloescht: an ihm haengen Historie
und Auditberichte, und ein stiller DELETE waere die teuerste Art, eine
Zeitreihe zu verlieren.';

CREATE TABLE IF NOT EXISTS core.bounti_rolle (
    bounti_id   text PRIMARY KEY,
    name        text NOT NULL,
    geladen_am  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.bounti_rolle IS
'Rollen aus Bounti (Kueche, Service, Leitung, ...). Gebraucht, um eine
Erfuellungsquote nach Bereich zu lesen — eine Pflichtschulung trifft selten
alle.';

CREATE TABLE IF NOT EXISTS core.bounti_mitarbeiter (
    bounti_id           text PRIMARY KEY,
    vorname             text,
    nachname            text,
    /*
     * Bounti kennt zwei Zustaende, und nur einer davon ist ein Abgang:
     * `POST /employees/{id}/archive` archiviert (die Person bleibt mit
     * ihrer Lernhistorie stehen), `DELETE /employees/{id}` loescht.
     * Der Import fragt BEIDE Listen ab (status=active und status=archived),
     * weil eine Abgangszahl aus nur der aktiven Liste nichts anderes ist
     * als eine Kopfzahl.
     */
    archiviert          boolean NOT NULL DEFAULT false,
    zuerst_gesehen_am   date NOT NULL DEFAULT current_date,
    zuletzt_gesehen_am  date NOT NULL DEFAULT current_date,
    geladen_am          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.bounti_mitarbeiter IS
'Mitarbeitende aus Bounti — ohne E-Mail, ohne Telefonnummer, ohne customFields.
Die drei Felder liefert die Schnittstelle mit; sie stehen hier bewusst nicht
(Begruendung im Kopf von migrations/0096_bounti.sql). Fuer jede Kennzahl dieses
Projekts ist die Person ein Schluessel, kein Adressbuch.

zuletzt_gesehen_am ist die Grundlage jeder Abgangszahl: wer aus BEIDEN Listen
verschwindet, wurde in Bounti geloescht — das sieht man nur daran, dass der
Datensatz nicht mehr angefasst wird.';

/*
 * NUR DIE FELDNAMEN, KEINE WERTE — und das ist der Punkt.
 *
 * `GET /employees` liefert `customFields` als frei konfigurierbares
 * Schluessel-Wert-Paar; Bountis eigenes Beispiel nennt "employee_id" und
 * "cost_center". Waere dort eine PERSONALNUMMER gepflegt, die auch LINA
 * kennt, dann waere das die Bruecke, an der Kapitel 4.2 der Round-Table-Map
 * heute scheitert (Kursabschluss gegen Verkaufsverhalten je Person) — die
 * LINA-Mitarbeiterstammdaten sind fuer unseren Zugang gesperrt.
 *
 * Ob es sie gibt, weiss vorher niemand. Deshalb wird hier festgehalten,
 * WELCHE Felder konfiguriert sind und wie oft sie belegt sind — nie, was
 * darin steht. Das beantwortet die Frage, ohne unbesehen personenbezogene
 * Freitextfelder in die Datenbank zu holen.
 *
 * Und es steht in einer Tabelle statt in einem Log, weil Logs niemand liest
 * (Regel 10).
 */
CREATE TABLE IF NOT EXISTS core.bounti_feldname (
    schluessel          text PRIMARY KEY,
    belegt              integer NOT NULL DEFAULT 0,
    mitarbeiter_gesamt  integer NOT NULL DEFAULT 0,
    zuerst_gesehen_am   date NOT NULL DEFAULT current_date,
    zuletzt_gesehen_am  date NOT NULL DEFAULT current_date
);

COMMENT ON TABLE core.bounti_feldname IS
'Welche customFields in Bounti konfiguriert sind und wie oft sie belegt sind —
NUR die Feldnamen, nie die Werte.

WOFUER: Kapitel 4.2 der Round-Table-Map (Kursabschluss gegen Verkaufsverhalten
je Person) braucht einen Schluessel, der Bounti und LINA verbindet. LINAs
Mitarbeiterstammdaten sind fuer unseren Zugang gesperrt; ein Personalnummern-
Feld in Bounti waere der Ersatzweg. Diese Tabelle sagt beim ersten echten Lauf,
ob es eines gibt — ohne dafuer Freitextfelder unbesehen zu importieren.';

CREATE TABLE IF NOT EXISTS core.bounti_mitarbeiter_standort (
    mitarbeiter_id  text NOT NULL REFERENCES core.bounti_mitarbeiter(bounti_id) ON DELETE CASCADE,
    standort_id     text NOT NULL REFERENCES core.bounti_standort(bounti_id),
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (mitarbeiter_id, standort_id)
);

COMMENT ON TABLE core.bounti_mitarbeiter_standort IS
'Wer arbeitet wo. EINE PERSON KANN AN MEHREREN STANDORTEN STEHEN — Bounti
liefert `locations` als Liste, und die eigene Doku zu /locations/progress sagt
ausdruecklich, sie zaehle Mitarbeitende "in all their locations".

Das ist die wichtigste Falle dieser Anbindung: jede Zahl je Betrieb, die ueber
Personen aggregiert, zaehlt eine Person mit zwei Standorten ZWEIMAL. Die
Summe ueber alle Betriebe ist deshalb groesser als die Kopfzahl des
Unternehmens. mart.bounti_mehrfachzuordnung fuehrt die Faelle.';

CREATE TABLE IF NOT EXISTS core.bounti_mitarbeiter_rolle (
    mitarbeiter_id  text NOT NULL REFERENCES core.bounti_mitarbeiter(bounti_id) ON DELETE CASCADE,
    rolle_id        text NOT NULL REFERENCES core.bounti_rolle(bounti_id),
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (mitarbeiter_id, rolle_id)
);


-- ---------------------------------------------------------------------
-- 2. Was hier bewusst NICHT steht: der Personalstand
--
-- Eine fruehe Fassung dieser Migration fuehrte eine Tabelle
-- `core.bounti_mitarbeiter_stand` — eine Momentaufnahme je Person, Monat
-- und Standort — und darauf eine Sicht mit Zugang, Abgang und Quote. Sie
-- ist am 24.08.2026 wieder entfernt worden, noch bevor die Migration
-- irgendwo angewendet war.
--
-- WARUM. Sie haette die Fluktuationsrate der Berichtsliste ANGEDEUTET und
-- etwas anderes gezaehlt: Konten im Schulungssystem statt Anstellungen.
-- Wer ausscheidet, verschwindet dort erst, wenn jemand das Bounti-Konto
-- archiviert — Wochen spaeter oder nie. Eine Zahl, die fast richtig
-- aussieht, ist in diesem Projekt teurer als eine, die fehlt: die fehlende
-- faellt auf, die fast richtige wird verwendet.
--
-- Und sie waere ein zweiter Ort fuer dieselbe Sache gewesen. Der erste ist
-- LINA: dort liegen die Personalstammdaten mit Eintritt und Austritt, und
-- Bounti selbst LIEST sie von dort — der Ladenakte-Erhebung vom 11.08.2026
-- zufolge haelt Bounti einen LINA-API-Schluessel mit dem Scope
-- "Personalstammdaten und Kosten" (docs/lina-api-inventar-ladenakte.md
-- §4 e). Die Fluktuation aus Bounti zurueckzurechnen hiesse, eine Kopie
-- gegen ihr Original zu messen.
--
-- WO SIE STATTDESSEN HERKOMMT: aus LINA. Welcher Weg dorthin traegt, ist
-- offen und wird gemessen, nicht geraten — `bun run lina-fragen d10`.
-- Solange das nicht gelaufen ist, hat diese Kennzahl in diesem Schema
-- nichts zu suchen.
--
-- core.bounti_mitarbeiter bleibt: die Schulungsauswertung braucht die
-- Person als Schluessel und ihre Standortzuordnung. Nur die monatliche
-- Fortschreibung ist weg.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 3. Lernen: Kurse, Pfade, Zuweisungen
--
-- Kurse und Pfade stehen in EINER Tabelle mit einer Spalte `art`. Sie
-- unterscheiden sich fuer jede Auswertung dieses Projekts in nichts: beide
-- haben Namen, beide werden Personen zugewiesen, beide sind faellig oder
-- abgeschlossen. Zwei Tabellen haetten jede Sicht darueber verdoppelt.
--
-- Der Unterschied, den es trotzdem gibt: ein Pfad hat Schritte (mit
-- `delay`-Tagen), ein Kurs hat eine Bewertung (`assessmentScore`). Deshalb
-- ist `ergebnis_pct` bei Pfadzuweisungen immer NULL — die Schnittstelle
-- liefert dort schlicht kein Feld dafuer.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.bounti_lerneinheit (
    bounti_id             text NOT NULL,
    art                   text NOT NULL CHECK (art IN ('kurs', 'pfad')),
    name                  text NOT NULL,
    /*
     * DIE ZAHL, AN DER DER RUECKSTAND HAENGT. Zuweisungen lassen sich
     * NICHT inkrementell holen: `/courses/{id}/assignments` kennt weder
     * `after` noch `updatedAt`, es gibt nur "alle, seitenweise". Der Lauf
     * arbeitet deshalb je Nacht eine Obergrenze an Lerneinheiten ab, die
     * am laengsten nicht geholten zuerst.
     *
     * NULL heisst: noch nie geholt. mart.bounti_zuweisung_stand zaehlt
     * genau diese Zeilen, und die Zahl MUSS von Nacht zu Nacht fallen.
     */
    zuweisungen_geholt_am timestamptz,
    zuletzt_gesehen_am    date NOT NULL DEFAULT current_date,
    geladen_am            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (bounti_id, art)
);

COMMENT ON TABLE core.bounti_lerneinheit IS
'Kurse und Lernpfade in einer Tabelle, getrennt durch `art`. Die Auswertungen
behandeln beide gleich; der Schluessel ist zusammengesetzt, weil die IDs aus
zwei Nummernraeumen kommen und niemand geprueft hat, ob sie sich ueberschneiden
koennen — die Annahme "IDs sind global eindeutig" hat dieses Projekt schon
einmal Geld gekostet (docs/foodnotify-0-1-nummernraum.md).';

CREATE TABLE IF NOT EXISTS core.bounti_zuweisung (
    bounti_id         text PRIMARY KEY,
    lerneinheit_id    text NOT NULL,
    art               text NOT NULL CHECK (art IN ('kurs', 'pfad')),
    /* Ohne Fremdschluessel, siehe Kopf Punkt 3. */
    mitarbeiter_id    text NOT NULL,
    erstellt_am       timestamptz,
    faellig_am        timestamptz,
    abgeschlossen_am  timestamptz,
    /* PROZENTZAHL, nicht Bruch (Regel 6). Bounti liefert 0.8, hier steht 80.00. */
    ergebnis_pct      numeric(5,2) CHECK (ergebnis_pct BETWEEN 0 AND 100),
    geladen_am        timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (lerneinheit_id, art)
        REFERENCES core.bounti_lerneinheit(bounti_id, art) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS bounti_zuweisung_mitarbeiter
    ON core.bounti_zuweisung (mitarbeiter_id);
CREATE INDEX IF NOT EXISTS bounti_zuweisung_erstellt
    ON core.bounti_zuweisung (erstellt_am DESC);
CREATE INDEX IF NOT EXISTS bounti_zuweisung_geladen
    ON core.bounti_zuweisung (geladen_am DESC);
/*
 * Der Fremdschluessel selbst braucht einen Index, und zwar nicht aus
 * Eleganz: mart.bounti_zuweisung_stand zaehlt je Lerneinheit ihre
 * Zuweisungen (eine Unterabfrage je Zeile). Ohne diesen Index sind das
 * 470 sequentielle Scans ueber 15.804 Zeilen — je Aufruf der Sicht, und
 * die Sicht haengt in einer Pruefzeile, die bei jedem Lauf gelesen wird.
 * Postgres legt fuer Fremdschluessel KEINEN Index von selbst an.
 */
CREATE INDEX IF NOT EXISTS bounti_zuweisung_lerneinheit
    ON core.bounti_zuweisung (lerneinheit_id, art);

COMMENT ON COLUMN core.bounti_zuweisung.ergebnis_pct IS
'Ergebnis der Abschlusspruefung als PROZENTZAHL (Regel 6). Bounti liefert einen
Bruch — die eigene Doku sagt "0.8 is 80%" —, der Lader multipliziert mit 100.
Bei Pfaden immer NULL: dort gibt es das Feld nicht.';

/*
 * Die aggregierte Sicht der Schnittstelle, taeglich mitgeschrieben.
 *
 * WARUM BEIDES — diese Tabelle UND die Zuweisungen. `/locations/progress`
 * kostet EINEN Aufruf fuer alle Standorte und ist damit die einzige Zahl,
 * die auch dann steht, wenn der Zuweisungs-Rueckstand noch nicht
 * abgearbeitet ist. Sie ist die Gegenprobe: weichen die aus Zuweisungen
 * gerechnete Quote und diese hier voneinander ab, stimmt eine von beiden
 * nicht (mart.bounti_fortschritt_gegenprobe).
 */
CREATE TABLE IF NOT EXISTS core.bounti_standort_fortschritt (
    standort_id         text NOT NULL REFERENCES core.bounti_standort(bounti_id),
    stichtag            date NOT NULL,
    kurse_gesamt        integer NOT NULL,
    kurse_abgeschlossen integer NOT NULL,
    geladen_am          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (standort_id, stichtag)
);

COMMENT ON TABLE core.bounti_standort_fortschritt IS
'Kursfortschritt je Standort, wie Bounti ihn selbst aggregiert
(GET /locations/progress), taeglich mitgeschrieben. Ein Aufruf fuer alle
Standorte.

Bountis Doku zur Zaehlweise, woertlich: "Course progress uses the latest
assignment per employee per course, and counts employees in all their
locations." Beides weicht von einer naiven Zaehlung ab — die letzte Zuweisung
zaehlt, nicht alle, und Mehrfachzuordnungen zaehlen mehrfach.';


-- ---------------------------------------------------------------------
-- 4. Audits
--
-- Der zweite Teil von Bounti, und der fuer den Round Table
-- interessantere: `LOCATION_AUDIT` ist eine BEWERTETE BEGEHUNG eines
-- Betriebs mit Punktzahl. Damit gibt es erstmals eine objektive
-- Betriebsnote aus einem Fachsystem.
--
-- WAS HIER AUSDRUECKLICH NICHT PASSIERT: sie wird NICHT in ampel.gesamt()
-- verdrahtet. `manual.om_einschaetzung` ist seit Juli 2026 leer (0079),
-- und eine Auditnote saehe wie ein naheliegender Ersatz aus. Ob sie einer
-- ist, ist eine fachliche Frage an Eugene und steht in
-- docs/offene-punkte.md. Eine Ampel, deren Bedeutung sich still aendert,
-- ist schlimmer als eine graue.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.bounti_audit (
    bounti_id     text PRIMARY KEY,
    name          text NOT NULL,
    beschreibung  text,
    art           text NOT NULL CHECK (art IN ('EMPLOYEE_AUDIT', 'LOCATION_AUDIT')),
    erstellt_am   timestamptz,
    geaendert_am  timestamptz,
    geladen_am    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.bounti_auditbericht (
    bounti_id         text PRIMARY KEY,
    audit_id          text NOT NULL REFERENCES core.bounti_audit(bounti_id),
    plan_id           text,
    erstellt_am       timestamptz NOT NULL,
    begonnen_am       timestamptz,
    abgeschlossen_am  timestamptz,
    punkte_gesamt     numeric(10,2),
    punkte_erreicht   numeric(10,2),
    /* Schon von Bounti eine Prozentzahl (Beispiel 85) — hier NICHT skaliert. */
    prozent           numeric(5,2),
    auditor_id        text,
    ziel_art          text CHECK (ziel_art IN ('EMPLOYEE', 'LOCATION')),
    ziel_id           text,
    geladen_am        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bounti_auditbericht_erstellt
    ON core.bounti_auditbericht (erstellt_am DESC);
CREATE INDEX IF NOT EXISTS bounti_auditbericht_ziel
    ON core.bounti_auditbericht (ziel_art, ziel_id);
CREATE INDEX IF NOT EXISTS bounti_auditbericht_geladen
    ON core.bounti_auditbericht (geladen_am DESC);

COMMENT ON TABLE core.bounti_auditbericht IS
'Ein durchgefuehrtes Audit. `ziel_art` sagt, WORAUF es sich bezieht: LOCATION
auf einen Standort (und damit auf einen Betrieb), EMPLOYEE auf eine Person.
Nur die LOCATION-Berichte gehen in die Betriebsauswertung.

`prozent` ist eine PROZENTZAHL und wird NICHT umgerechnet — anders als
core.bounti_zuweisung.ergebnis_pct, wo Bounti einen Bruch liefert. Zwei Felder,
zwei Skalen, dieselbe Schnittstelle.

Die Einzelantworten je Frage (GET .../reports/{id}, Abschnitte und Punkte je
Frage) werden NICHT geholt: das ist ein Aufruf je Bericht statt einer je
Seite, und keine Kennzahl dieses Projekts liest sie. Der Endpunkt steht in
docs/bounti-api-inventar.md, falls sich das aendert.';


-- ---------------------------------------------------------------------
-- 5. Die Bruecke zum Betrieb
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_standort_betrieb AS
SELECT s.bounti_id          AS standort_id,
       s.name               AS standort,
       f.betrieb_key,
       b.name               AS betrieb,
       s.zuletzt_gesehen_am
  FROM core.bounti_standort s
  LEFT JOIN manual.betrieb_fremd_id f
         ON f.fremd_id = s.bounti_id AND f.system = 'bounti'
  LEFT JOIN core.betrieb b ON b.betrieb_key = f.betrieb_key;

COMMENT ON VIEW mart.bounti_standort_betrieb IS
'Standort aus Bounti → Betrieb. betrieb_key IS NULL heisst: nicht zugeordnet —
dieser Standort taucht in keiner Betriebsauswertung auf, lautlos.
mart.bounti_ohne_betrieb fuehrt beide Richtungen der Luecke.';

/*
 * Die Arbeitsliste, beide Richtungen — wie mart.betrieb_ohne_yext, nur
 * dass hier auch die Gegenrichtung zaehlt: ein Bounti-Standort ohne
 * Betrieb ist genauso unsichtbar wie ein Betrieb ohne Standort.
 */
CREATE OR REPLACE VIEW mart.bounti_ohne_betrieb AS
SELECT 'standort ohne betrieb'::text AS richtung,
       s.bounti_id                    AS schluessel,
       s.name                         AS bezeichnung,
       NULL::text                     AS status,
       NULL::boolean                  AS macht_umsatz
  FROM core.bounti_standort s
 WHERE NOT EXISTS (SELECT 1 FROM manual.betrieb_fremd_id f
                    WHERE f.system = 'bounti' AND f.fremd_id = s.bounti_id)
UNION ALL
SELECT 'betrieb ohne standort',
       b.betrieb_key::text,
       b.name,
       st.status,
       EXISTS (SELECT 1 FROM core.umsatzbericht_tag u
                WHERE u.betrieb_key = b.betrieb_key
                  AND u.geschaeftstag > current_date - 90
                  AND coalesce(u.umsatz_netto, 0) > 0)
  FROM core.betrieb b
  JOIN mart.betrieb_status st ON st.betrieb_key = b.betrieb_key
 WHERE NOT EXISTS (SELECT 1 FROM manual.betrieb_fremd_id f
                    WHERE f.system = 'bounti' AND f.betrieb_key = b.betrieb_key);

COMMENT ON VIEW mart.bounti_ohne_betrieb IS
'Die Arbeitsliste der Zuordnung, in BEIDEN Richtungen.

ERWARTUNG: keine Zeile mit richtung = ''betrieb ohne standort'', status =
operativ und macht_umsatz = true. Standorte ohne Betrieb sind dagegen normal,
solange Bounti auch Einheiten fuehrt, die keine Betriebe sind (Zentrale,
Schulungsraum) — sie stehen hier, damit jemand einmal hinsieht und entscheidet,
statt dass sie unbemerkt fehlen.

Zugeordnet wird nicht geraten: src/bounti/zuordnen.ts schlaegt ueber die Namen
vor, geschrieben wird nur, was eindeutig ist; der Rest bleibt hier stehen.';

CREATE OR REPLACE VIEW mart.bounti_mehrfachzuordnung AS
SELECT ms.mitarbeiter_id,
       m.vorname, m.nachname,
       count(*)                                    AS standorte,
       string_agg(s.name, ', ' ORDER BY s.name)    AS standortnamen
  FROM core.bounti_mitarbeiter_standort ms
  JOIN core.bounti_mitarbeiter m ON m.bounti_id = ms.mitarbeiter_id
  JOIN core.bounti_standort s    ON s.bounti_id = ms.standort_id
 WHERE NOT m.archiviert
 GROUP BY ms.mitarbeiter_id, m.vorname, m.nachname
HAVING count(*) > 1;

COMMENT ON VIEW mart.bounti_mehrfachzuordnung IS
'Personen an mehr als einem Standort. KEINE FEHLERLISTE, sondern die Erklaerung
fuer eine Abweichung: jede ueber Personen aggregierte Betriebszahl zaehlt diese
Personen mehrfach, die Summe ueber alle Betriebe ist deshalb groesser als die
Kopfzahl des Unternehmens. Wer beide Zahlen nebeneinander sieht und die
Differenz nicht erklaeren kann, sucht hier.';


-- ---------------------------------------------------------------------
-- 6. Schulung je Betrieb und Monat
--
-- DER MONAT IST DER DER ZUWEISUNG, nicht der des Abschlusses. Sonst
-- verschwaende eine nie erledigte Pflichtschulung aus der Statistik —
-- ausgerechnet der Fall, um den es geht.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_schulung_betrieb_monat AS
WITH zuweisung_betrieb AS (
    SELECT z.bounti_id,
           z.art,
           date_trunc('month', z.erstellt_am)::date AS monat,
           sb.betrieb_key,
           z.faellig_am,
           z.abgeschlossen_am,
           z.ergebnis_pct
      FROM core.bounti_zuweisung z
      JOIN core.bounti_mitarbeiter_standort ms ON ms.mitarbeiter_id = z.mitarbeiter_id
      JOIN mart.bounti_standort_betrieb sb     ON sb.standort_id = ms.standort_id
     WHERE sb.betrieb_key IS NOT NULL
       AND z.erstellt_am IS NOT NULL
)
SELECT betrieb_key,
       monat,
       art,
       count(*)::int                                                    AS zugewiesen,
       count(*) FILTER (WHERE abgeschlossen_am IS NOT NULL)::int        AS abgeschlossen,
       /*
        * Ueberfaellig heisst: Frist vorbei UND nicht abgeschlossen. Eine
        * Zuweisung ohne Frist kann nicht ueberfaellig werden — sie zaehlt
        * hier nicht mit und ist deshalb daneben ausgewiesen.
        */
       count(*) FILTER (WHERE faellig_am IS NOT NULL
                          AND faellig_am < now()
                          AND abgeschlossen_am IS NULL)::int            AS ueberfaellig,
       count(*) FILTER (WHERE faellig_am IS NULL)::int                  AS ohne_frist,
       round(100.0 * count(*) FILTER (WHERE abgeschlossen_am IS NOT NULL)
                   / nullif(count(*), 0), 2)                            AS erfuellung_pct,
       round(avg(ergebnis_pct) FILTER (WHERE ergebnis_pct IS NOT NULL), 2) AS ergebnis_schnitt_pct
  FROM zuweisung_betrieb
 GROUP BY betrieb_key, monat, art;

COMMENT ON VIEW mart.bounti_schulung_betrieb_monat IS
'Schulungserfuellung je Betrieb, Monat und Art (Kurs/Pfad). Der Monat ist der
der ZUWEISUNG, nicht der des Abschlusses — sonst faellt die nie erledigte
Pflichtschulung aus der Statistik, also genau der Fall, den sie zeigen soll.

DREI DINGE, DIE MAN WISSEN MUSS, BEVOR MAN DIE QUOTE DEUTET:

  1. Personen an mehreren Standorten zaehlen mehrfach
     (mart.bounti_mehrfachzuordnung).
  2. Die Zuordnung Person → Standort ist die von HEUTE. Bounti fuehrt keine
     Historie dazu; wer den Betrieb gewechselt hat, bringt seine alten
     Zuweisungen mit. Bei Monaten, die weit zurueckliegen, ist die Zahl
     deshalb eine Annaeherung.
  3. erfuellung_pct ist eine PROZENTZAHL (Regel 6), ergebnis_schnitt_pct
     ebenfalls — auch wenn Bounti letzteres als Bruch liefert.';

/*
 * Die Gegenprobe: unsere Rechnung gegen Bountis eigene Aggregation.
 *
 * Zwei Wege zur selben Zahl, und sie muessen nicht gleich sein — Bounti
 * zaehlt "latest assignment per employee per course", wir zaehlen alle.
 * Eine GROSSE Abweichung ist trotzdem ein Befund: sie heisst meistens,
 * dass der Zuweisungs-Rueckstand noch nicht abgearbeitet ist.
 */
CREATE OR REPLACE VIEW mart.bounti_fortschritt_gegenprobe AS
WITH bounti AS (
    SELECT DISTINCT ON (f.standort_id)
           f.standort_id, f.stichtag, f.kurse_gesamt, f.kurse_abgeschlossen
      FROM core.bounti_standort_fortschritt f
     ORDER BY f.standort_id, f.stichtag DESC
), unsere AS (
    SELECT ms.standort_id,
           count(*)::int                                             AS zuweisungen,
           count(*) FILTER (WHERE z.abgeschlossen_am IS NOT NULL)::int AS abgeschlossen
      FROM core.bounti_zuweisung z
      JOIN core.bounti_mitarbeiter_standort ms ON ms.mitarbeiter_id = z.mitarbeiter_id
     WHERE z.art = 'kurs'
     GROUP BY ms.standort_id
)
SELECT sb.standort_id,
       sb.standort,
       sb.betrieb_key,
       sb.betrieb,
       b.stichtag                          AS bounti_stichtag,
       b.kurse_gesamt                      AS bounti_gesamt,
       b.kurse_abgeschlossen               AS bounti_abgeschlossen,
       u.zuweisungen                       AS eigene_gesamt,
       u.abgeschlossen                     AS eigene_abgeschlossen,
       round(100.0 * b.kurse_abgeschlossen / nullif(b.kurse_gesamt, 0), 2)  AS bounti_pct,
       round(100.0 * u.abgeschlossen       / nullif(u.zuweisungen, 0), 2)   AS eigene_pct,
       CASE
         WHEN b.kurse_gesamt IS NULL           THEN 'kein Fortschritt geholt'
         WHEN u.zuweisungen IS NULL            THEN 'keine Zuweisungen geholt'
         WHEN abs(coalesce(u.zuweisungen, 0) - b.kurse_gesamt)
              > greatest(5, 0.2 * b.kurse_gesamt) THEN 'weicht ab'
         ELSE 'stimmig'
       END AS zustand
  FROM mart.bounti_standort_betrieb sb
  LEFT JOIN bounti b ON b.standort_id = sb.standort_id
  LEFT JOIN unsere u ON u.standort_id = sb.standort_id;

COMMENT ON VIEW mart.bounti_fortschritt_gegenprobe IS
'Bountis eigene Aggregation gegen unsere Rechnung aus den Zuweisungen.

ERWARTUNG NACH ABGEARBEITETEM RUECKSTAND: zustand = stimmig oder eine
erklaerbare Abweichung. "keine Zuweisungen geholt" ist waehrend des ersten
Backfills normal und danach ein Befund.

Die beiden Zahlen sind nicht per Konstruktion gleich: Bounti zaehlt je Person
und Kurs nur die LETZTE Zuweisung, wir zaehlen alle. Deshalb die grosszuegige
Schwelle (20 % oder 5 Zuweisungen) — eine Gegenprobe, die staendig ausschlaegt,
liest niemand.';


-- ---------------------------------------------------------------------
-- 7. Audits je Betrieb und Monat
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_audit_betrieb_monat AS
SELECT sb.betrieb_key,
       date_trunc('month', r.erstellt_am)::date AS monat,
       a.name                                   AS audit,
       count(*)::int                            AS berichte,
       count(*) FILTER (WHERE r.abgeschlossen_am IS NOT NULL)::int AS abgeschlossen,
       round(avg(r.prozent) FILTER (WHERE r.abgeschlossen_am IS NOT NULL), 2) AS schnitt_pct,
       min(r.prozent) FILTER (WHERE r.abgeschlossen_am IS NOT NULL)  AS min_pct,
       max(r.prozent) FILTER (WHERE r.abgeschlossen_am IS NOT NULL)  AS max_pct
  FROM core.bounti_auditbericht r
  JOIN core.bounti_audit a           ON a.bounti_id = r.audit_id
  JOIN mart.bounti_standort_betrieb sb ON sb.standort_id = r.ziel_id
 WHERE r.ziel_art = 'LOCATION'
   AND sb.betrieb_key IS NOT NULL
 GROUP BY sb.betrieb_key, date_trunc('month', r.erstellt_am)::date, a.name;

COMMENT ON VIEW mart.bounti_audit_betrieb_monat IS
'Auditnoten je Betrieb, Monat und Auditart — nur LOCATION_AUDIT, denn nur die
beziehen sich auf einen Betrieb. Der Schnitt zaehlt ausschliesslich
ABGESCHLOSSENE Berichte: ein angefangenes Audit hat null Punkte, und ein
Mittelwert daraus ist keine schlechte Note, sondern eine falsche.

NICHT IN DER AMPEL. Diese Note saehe wie ein Ersatz fuer die seit Juli 2026
leere manual.om_einschaetzung aus. Ob sie einer ist, entscheidet der
Fachbereich — siehe docs/offene-punkte.md. Eine Ampel, deren Bedeutung sich
still aendert, ist schlimmer als eine graue.';


-- ---------------------------------------------------------------------
-- 8. Was sichtbar bleiben muss (Regel 10)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_zuweisung_stand AS
SELECT l.bounti_id,
       l.art,
       l.name,
       l.zuweisungen_geholt_am,
       round(EXTRACT(epoch FROM (now() - l.zuweisungen_geholt_am)) / 86400, 1) AS tage_her,
       (SELECT count(*) FROM core.bounti_zuweisung z
         WHERE z.lerneinheit_id = l.bounti_id AND z.art = l.art)::int AS zuweisungen,
       CASE
         WHEN l.zuweisungen_geholt_am IS NULL                          THEN 'nie'
         WHEN l.zuweisungen_geholt_am < now() - interval '14 days'     THEN 'veraltet'
         ELSE 'aktuell'
       END AS zustand
  FROM core.bounti_lerneinheit l;

COMMENT ON VIEW mart.bounti_zuweisung_stand IS
'Eine Zeile je Kurs und Lernpfad — die Arbeitsliste des Zuweisungsabgleichs.

DIE ZAHL, DIE FALLEN MUSS: Zeilen mit zustand = nie. Zuweisungen lassen sich
nicht inkrementell holen (kein `after`, kein `updatedAt` an dem Endpunkt), der
Lauf arbeitet deshalb je Nacht BOUNTI_LERNEINHEITEN_JE_LAUF Stueck ab, die am
laengsten nicht geholten zuerst. Bleibt die Zahl stehen, laeuft der Nachlauf
nicht mehr — und ein eingefrorener Fortschritt sieht aus wie ein gepflegter.

zustand = veraltet heisst: laenger als 14 Tage nicht nachgezogen. Bei wenigen
Lerneinheiten kommt das nie vor, bei vielen ist es der Normalzustand des
Rotationsverfahrens.';

CREATE OR REPLACE VIEW mart.bounti_zuweisung_ohne_mitarbeiter AS
SELECT z.bounti_id, z.art, z.lerneinheit_id, z.mitarbeiter_id, z.erstellt_am
  FROM core.bounti_zuweisung z
 WHERE NOT EXISTS (SELECT 1 FROM core.bounti_mitarbeiter m
                    WHERE m.bounti_id = z.mitarbeiter_id);

COMMENT ON VIEW mart.bounti_zuweisung_ohne_mitarbeiter IS
'Zuweisungen an Personen, die in KEINER der beiden Mitarbeiterlisten stehen —
in Bounti geloescht (DELETE /employees), waehrend die Zuweisung blieb.

Sie fallen aus jeder Betriebszahl heraus, weil die Zuordnung zum Betrieb ueber
die Person laeuft. Eine kleine Zahl ist normal. Eine wachsende heisst, dass in
Bounti geloescht statt archiviert wird — und dann fehlt die halbe
Abgangszaehlung.';

CREATE OR REPLACE VIEW mart.pruefung_bounti AS
SELECT 'Bounti: operativer Betrieb ohne Standort'::text AS pruefung,
       count(*) FILTER (WHERE richtung = 'betrieb ohne standort')::int AS geprueft,
       count(*) FILTER (WHERE richtung = 'betrieb ohne standort'
                          AND status = 'operativ' AND macht_umsatz)::int AS auffaellig,
       'mart.bounti_ohne_betrieb'::text AS sicht
  FROM mart.bounti_ohne_betrieb
UNION ALL
/*
 * Hier standen geprueft und auffaellig auf demselben Ausdruck — die Zeile
 * haette also IMMER "alle auffaellig" gemeldet und waere damit die Sorte
 * Pruefzeile, die niemand mehr liest (dieselbe Ueberlegung wie in 0070,
 * 0071 und 0090). Gezaehlt wird jetzt gegen alle Standorte, und
 * auffaellig sind nur die ohne Betrieb.
 */
SELECT 'Bounti: Standort ohne Betrieb',
       (SELECT count(*)::int FROM core.bounti_standort),
       count(*) FILTER (WHERE richtung = 'standort ohne betrieb')::int,
       'mart.bounti_ohne_betrieb'
  FROM mart.bounti_ohne_betrieb
UNION ALL
-- ERWARTUNG: 0, sobald der erste Backfill durch ist. Steht sie still,
-- laeuft der Nachlauf nicht mehr.
SELECT 'Bounti: Lerneinheit ohne je geholte Zuweisungen',
       count(*)::int, count(*) FILTER (WHERE zustand = 'nie')::int,
       'mart.bounti_zuweisung_stand'
  FROM mart.bounti_zuweisung_stand
UNION ALL
SELECT 'Bounti: Zuweisung ohne Mitarbeitenden',
       (SELECT count(*)::int FROM core.bounti_zuweisung),
       count(*)::int, 'mart.bounti_zuweisung_ohne_mitarbeiter'
  FROM mart.bounti_zuweisung_ohne_mitarbeiter
UNION ALL
/*
 * DIE SCHAERFERE FRAGE ZU DEN AUDITS, und sie kommt aus dem ersten
 * echten Lauf am 24.08.2026: `mart.bounti_audit_betrieb_monat` lieferte
 * NULL Zeilen bei 133 geladenen Auditberichten. Kein Fehler in der
 * Sicht — die 133 Berichte haengen an GENAU DREI Standorten
 * (Wirtshaus am Muenzplatz 110, Wirtshaus im Park Moenchengladbach 22,
 * Wuerzburger Augustiner 1), und keiner der drei hat einen Betrieb.
 *
 * Die Zeile "Standort ohne Betrieb" darueber sieht das nicht: sie zaehlt
 * 26 unzugeordnete Standorte, von denen die meisten gar keine Audits
 * haben. Eine leere Auswertung neben einer unauffaelligen Pruefzeile ist
 * genau der Zustand, den Migration 0092 gekostet hat.
 */
SELECT 'Bounti: Auditbericht ohne Betrieb',
       (SELECT count(*)::int FROM core.bounti_auditbericht),
       (SELECT count(*)::int FROM core.bounti_auditbericht r
          WHERE r.ziel_art = 'LOCATION'
            AND NOT EXISTS (SELECT 1 FROM manual.betrieb_fremd_id f
                             WHERE f.system = 'bounti' AND f.fremd_id = r.ziel_id)),
       'mart.bounti_ohne_betrieb'
UNION ALL
SELECT 'Bounti: Fortschritt weicht von den Zuweisungen ab',
       count(*)::int,
       count(*) FILTER (WHERE betrieb_key IS NOT NULL
                          AND zustand IN ('weicht ab', 'keine Zuweisungen geholt'))::int,
       'mart.bounti_fortschritt_gegenprobe'
  FROM mart.bounti_fortschritt_gegenprobe;

COMMENT ON VIEW mart.pruefung_bounti IS
'Die Pruefzeilen der Bounti-Anbindung, gleiche Form wie
mart.pruefung_uebersicht und mart.pruefung_kalender: pruefung, geprueft,
auffaellig, sicht. Wird an mart.pruefung_uebersicht angehaengt (siehe unten) —
eine Pruefsicht, die niemand liest, ist keine.';


/*
 * ANHAENGEN STATT NEU SCHREIBEN — dasselbe Verfahren wie in 0094.
 *
 * WARUM ES SEIN MUSS: eine eigene Pruefsicht neben der Uebersicht wird
 * von nichts gelesen. mart.pruefung_uebersicht dagegen haengt an einer
 * Metabase-Karte (metabase/karten-fach.ts) und an den Ende-zu-Ende-Tests.
 * Ohne diesen Block waeren die sechs Bounti-Zeilen genau das, wovor Regel 10
 * warnt: eine Messung, die existiert und niemanden erreicht.
 *
 * WARUM NICHT NEU SETZEN: die Uebersicht ist ueber ein Dutzend Migrationen
 * gewachsen. Sie hier vollstaendig neu zu schreiben hiesse, den Stand von
 * heute festzuschreiben — arbeitet eine zweite Sitzung parallel an einer
 * Pruefzeile, waere sie danach spurlos weg.
 *
 * Der NOT LIKE-Schutz macht den Block wiederholbar.
 */
DO $$
DECLARE d text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO d;
    IF d NOT LIKE '%pruefung_bounti%' THEN
        EXECUTE 'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS '
             || rtrim(btrim(d), ';')
             || ' UNION ALL SELECT pruefung, geprueft, auffaellig, sicht'
             || ' FROM mart.pruefung_bounti';
    END IF;
END $$;


-- ---------------------------------------------------------------------
-- 9. Das Quellenregister kennt jetzt auch Bounti
--
-- Wie in 0086 fuer das Wetter: sync.quelle.system war auf sechs Werte
-- beschraenkt. Ohne diese Zeile scheitert `quellenSpiegeln()` an der
-- CHECK-Bedingung — und zwar fuer ALLE Quellen zugleich, weil das
-- Register in EINER Anweisung geschrieben wird.
-- ---------------------------------------------------------------------
ALTER TABLE sync.quelle DROP CONSTRAINT IF EXISTS quelle_system_check;
ALTER TABLE sync.quelle ADD CONSTRAINT quelle_system_check
  CHECK (system = ANY (ARRAY['lina', 'ladenakte', 'foodnotify', 'yext',
                             'intern', 'wetter', 'bounti']));


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0096', to_jsonb(
        'Bounti angebunden: Schulung (Kurse, Pfade, Zuweisungen je Person) '
        'und Audits je Standort. Sieben lesende '
        'Endpunkte von 29 — die uebrigen 22 schreiben und sind im Client nicht '
        'vorhanden. Zwei Fallen sind im Schema festgehalten: assessmentScore ist '
        'ein BRUCH (0.8 = 80 %) und wird zur Prozentzahl gerechnet, '
        'achievedPercentage ist bereits eine; und eine Person kann an mehreren '
        'Standorten stehen, womit jede Betriebssumme sie mehrfach zaehlt. '
        'NICHT beantwortet ist die Fluktuationsrate der Berichtsliste: sie '
        'gehoert zu LINA (Team > Mitarbeiter > Stammdaten) und wird hier '
        'bewusst auch nicht genaehert — eine fast richtige Zahl ist teurer '
        'als eine fehlende. Der Weg dorthin wird gemessen: lina-fragen d10.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
