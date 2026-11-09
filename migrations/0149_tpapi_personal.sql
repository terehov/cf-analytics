-- =====================================================================
-- 0149 Personal je Stunde aus LINAs offizieller Schnittstelle (TPAPI)
--
-- ANLASS (09.11.2026). Melanies Frage — wie viele Leute stehen sonntags ab
-- 18 Uhr bei Wilma Wunder, und was setzen sie je Person um — war mit dem
-- Bestand nur ueber eine Ableitung aus Umsatz und Effektivitaet zu
-- beantworten. LINAs Third-Party-API liefert je Betrieb und Geschaeftstag
-- Personen und Lohnkosten JE STUNDE (personalkostenprostunde). Plan,
-- Entscheidungen D1-D8 und Messungen: docs/plan-tpapi.md; die Quelle:
-- docs/lina-third-party-api.md.
--
-- WAS DIESE MIGRATION ANLEGT
--   1. core.personalkosten_stunde         — Betrieb × Geschaeftstag × Stunde
--   2. core.personalkosten_stunde_abruf   — was gefragt wurde, auch leere Tage (D5)
--   3. sync.tpapi_zugang                  — welcher Betrieb einen Schluessel hat und
--                                            wie der letzte Aufruf ausging (D7)
--   4. sync.quelle.system kennt 'tpapi'
--   5. sechs Sichten in mart (Stunde, Zeitfenster, Tag, Rueckstand, Pruefung, Zugang)
--   6. drei Zeilen in mart.pruefung_uebersicht
--   7. MCP-Katalog: Koernung, Fallstricke, Rechte, Leseprobe
--
-- Der Importer (src/tpapi/), der Registereintrag tpapi:personalkosten_stunde
-- (src/sync/quellen.ts) und die Konfiguration (TPAPI_*, src/config.ts) stehen
-- im selben Commit.
--
-- DER GESCHAEFTSTAG. businessdate ist LINAs Geschaeftstag (08:00 bis 07:59
-- des Folgetags); die Stunden 0-7 der Antwort fuer Tag D gehoeren zu D, wie
-- im Stundenbericht seit 0138. Der Lader rechnet nichts um. Ob das stimmt,
-- misst mart.personal_stunde_pruefung (befund_stunden).
--
-- ALLES LIVE (D8). Rund 41 Betriebe × 365 Tage × 24 Stunden sind gut
-- 360.000 Zeilen im Jahr; der Primaerschluessel reicht. Materialisiert wird
-- erst, wenn eine Messung es verlangt (0142 als Vorbild).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Fakten
-- ---------------------------------------------------------------------

CREATE TABLE core.personalkosten_stunde (
    betrieb_key     integer       NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag   date          NOT NULL,
    stunde          smallint      NOT NULL CHECK (stunde BETWEEN 0 AND 23),
    personen        numeric(6,2),
    personalkosten  numeric(10,2),
    raw_id          bigint,
    geladen_am      timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, geschaeftstag, stunde)
);

CREATE INDEX personalkosten_stunde_geschaeftstag_brin
    ON core.personalkosten_stunde USING brin (geschaeftstag) WITH (autosummarize = on);

COMMENT ON TABLE core.personalkosten_stunde IS
'Aus LINAs Third-Party-API, GET /extern/personal/personalkostenprostunde (0149): Personen und
Lohnkosten je Betrieb, Geschaeftstag und Stunde, wie die Personalplanung in LINA sie fuehrt. Nur
Betriebe mit TPAPI-Schluessel (sync.tpapi_zugang). Eine Stunde, die LINA nicht liefert, hat KEINE
Zeile — nicht 0; ob der Tag ueberhaupt gefragt wurde, steht in core.personalkosten_stunde_abruf.
Ein erneuter Abruf ersetzt den Tag vollstaendig. Die Lohnkosten je Person (kostUser) werden bewusst
nicht gespeichert, auch nicht in raw. Der Geschaeftstag laeuft 08:00 bis 07:59, die Stunden 0-7
gehoeren ans ENDE des Tages. Nicht dasselbe wie die Personalkosten der BWA.';

COMMENT ON COLUMN core.personalkosten_stunde.geschaeftstag IS
'LINAs businessdate, unveraendert uebernommen (08:00 bis 07:59 des Folgetags).';
COMMENT ON COLUMN core.personalkosten_stunde.stunde IS
'Stundenschluessel der Antwort (0-23). 0-7 sind die Nachtstunden am Ende des Geschaeftstags; fuer
den Verlauf nach ((stunde + 16) % 24) sortieren.';
COMMENT ON COLUMN core.personalkosten_stunde.personen IS
'eff[stunde]: Personen, die in dieser Stunde eingeplant bzw. eingestempelt sind. Bisher ganzzahlig
gemessen; numeric fuer halbe Stunden. NULL, wenn LINA die Stunde nur in kost fuehrt.';
COMMENT ON COLUMN core.personalkosten_stunde.personalkosten IS
'kost[stunde]: Lohnkosten der Stunde in EUR, auf Cent gerundet. NULL, wenn LINA die Stunde nur in
eff fuehrt.';


-- ---------------------------------------------------------------------
-- 2. Was gefragt wurde
--
-- Ohne diese Tabelle waere ein leerer Tag nicht von einem nie gefragten zu
-- unterscheiden, und der Backfill zoege leere Tage in alle Ewigkeit (D5).
-- ---------------------------------------------------------------------

CREATE TABLE core.personalkosten_stunde_abruf (
    betrieb_key      integer       NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag    date          NOT NULL,
    stunden          smallint      NOT NULL CHECK (stunden BETWEEN 0 AND 24),
    personenstunden  numeric(8,2),
    personalkosten   numeric(12,2),
    raw_id           bigint,
    abgerufen_am     timestamptz   NOT NULL DEFAULT now(),
    abrufe           smallint      NOT NULL DEFAULT 1 CHECK (abrufe > 0),
    PRIMARY KEY (betrieb_key, geschaeftstag)
);

COMMENT ON TABLE core.personalkosten_stunde_abruf IS
'Eine Zeile je Betrieb und Geschaeftstag, der bei der TPAPI erfolgreich (HTTP 200) gefragt wurde
(0149) — auch wenn die Antwort leer war. Ein leerer Tag gilt damit als erledigt und faellt aus
mart.personal_rueckstand; im rollierenden Fenster wird er trotzdem neu gefragt. stunden = 0 heisst:
LINA hat fuer diesen Tag keine Schichten gefuehrt, nicht "niemand da".';

COMMENT ON COLUMN core.personalkosten_stunde_abruf.stunden IS
'Zahl der gelieferten Stunden (Zeilen in core.personalkosten_stunde); 0 = leere Antwort.';
COMMENT ON COLUMN core.personalkosten_stunde_abruf.personenstunden IS
'Summe personen ueber die gelieferten Stunden, zum Zeitpunkt des Abrufs.';
COMMENT ON COLUMN core.personalkosten_stunde_abruf.personalkosten IS
'Summe personalkosten ueber die gelieferten Stunden in EUR, zum Zeitpunkt des Abrufs.';
COMMENT ON COLUMN core.personalkosten_stunde_abruf.abgerufen_am IS
'Letzter erfolgreicher Abruf dieses Tages — der Datenstand der Zeilen in core.personalkosten_stunde.';
COMMENT ON COLUMN core.personalkosten_stunde_abruf.abrufe IS
'Wie oft der Tag geholt wurde (Fenster und Backfill zusammen).';


-- ---------------------------------------------------------------------
-- 3. Wer kann was
--
-- Der Importer spiegelt zu Beginn jedes Laufs die Schluessel aus der
-- Umgebung (LINA_API_SCHLUESSEL) hierher — die enc_id, nie den Schluessel.
-- 403 "not licensed" ist ein ZUSTAND, kein Fehler (D7): ein Alarm, der jede
-- Nacht schlaegt, wird abgeschaltet; ein Betrieb, der still verschwindet,
-- faellt nicht auf. Beides vermeidet diese Tabelle.
-- ---------------------------------------------------------------------

CREATE TABLE sync.tpapi_zugang (
    betrieb_key           integer     NOT NULL REFERENCES core.betrieb(betrieb_key),
    modul                 text        NOT NULL CHECK (modul IN ('personal', 'revenue', 'artikel')),
    enc_id                text        NOT NULL,
    schluessel_vorhanden  boolean     NOT NULL DEFAULT false,
    zustand               text        NOT NULL DEFAULT 'ok'
                          CHECK (zustand IN ('ok', 'nicht_lizenziert', 'abgewiesen', 'gebremst',
                                             'fehler', 'ohne_schluessel')),
    zuletzt_gefragt_am    timestamptz,
    zuletzt_erfolg_am     timestamptz,
    letzter_http          integer,
    letzter_fehler        text,
    aktualisiert_am       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, modul)
);

COMMENT ON TABLE sync.tpapi_zugang IS
'TPAPI-Zugang je Betrieb und Modul (0149). Der Importer legt je Schluessel aus LINA_API_SCHLUESSEL
eine Zeile an (Betrieb ueber core.betrieb.enc_id) und haelt den Ausgang des letzten Aufrufs fest.
Ein Schluessel gilt fuer genau einen Betrieb. Verschwindet er aus der Umgebung, steht
schluessel_vorhanden = false und zustand = ohne_schluessel. Lesbar fuer alle in mart.tpapi_zugang.';

COMMENT ON COLUMN sync.tpapi_zugang.modul IS
'personal in Stufe 1 (personalkostenprostunde); revenue und artikel sind fuer Stufe 2 vorgesehen.';
COMMENT ON COLUMN sync.tpapi_zugang.enc_id IS
'Die enc_id des Betriebs, unter der der Schluessel in der Umgebung steht — nie der Schluessel selbst.';
COMMENT ON COLUMN sync.tpapi_zugang.schluessel_vorhanden IS
'Steht die enc_id derzeit in LINA_API_SCHLUESSEL? Nur solche Betriebe stehen in mart.personal_rueckstand.';
COMMENT ON COLUMN sync.tpapi_zugang.zustand IS
'Ausgang des letzten Aufrufs: ok | nicht_lizenziert (403 "Module ... not licensed": Modul nicht
gebucht, sieben Tage nicht erneut gefragt) | abgewiesen (401/403 sonst, in diesem Lauf nicht
wiederholt) | gebremst (429, Betrieb fuer diesen Lauf aus) | fehler (5xx oder Netz, naechste Nacht
wieder) | ohne_schluessel (Schluessel aus der Umgebung verschwunden).';
COMMENT ON COLUMN sync.tpapi_zugang.zuletzt_gefragt_am IS
'Letzter Aufruf, egal mit welchem Ausgang.';
COMMENT ON COLUMN sync.tpapi_zugang.zuletzt_erfolg_am IS
'Letzte Antwort mit HTTP 200 — daran misst mart.tpapi_zugang den Zulauf (48 h).';
COMMENT ON COLUMN sync.tpapi_zugang.letzter_fehler IS
'Gekuerzte Fehlermeldung des letzten nicht erfolgreichen Aufrufs; enthaelt nie den Schluessel.';


-- ---------------------------------------------------------------------
-- 4. Das Quellenregister kennt die TPAPI
--
-- Der Eintrag tpapi:personalkosten_stunde selbst kommt aus
-- src/sync/quellen.ts; hier nur der erlaubte Systemname. Die Liste ist der
-- Stand seit 0096 plus 'tpapi'.
-- ---------------------------------------------------------------------

ALTER TABLE sync.quelle DROP CONSTRAINT IF EXISTS quelle_system_check;
ALTER TABLE sync.quelle ADD CONSTRAINT quelle_system_check
  CHECK (system = ANY (ARRAY['lina', 'ladenakte', 'foodnotify', 'yext', 'intern', 'wetter',
                             'bounti', 'tpapi']));


-- ---------------------------------------------------------------------
-- 5a. Lesbar: Personal je Stunde, mit dem Umsatz derselben Stunde
--
-- Der Umsatz kommt aus core.zeitzonenbericht_stunde (Konzern-Stundenbericht,
-- seit 0138 mit der Nacht am richtigen Tag) — derselbe Geschaeftstag,
-- dieselbe Stunde. Getrieben von den Personalzeilen: eine Stunde mit Umsatz,
-- aber ohne Personalzeile steht hier nicht; den vollen Stundenumsatz hat
-- mart.umsatz_stunde.
-- ---------------------------------------------------------------------

CREATE VIEW mart.personal_stunde AS
SELECT p.betrieb_key,
       b.name                                       AS betrieb,
       kz.hauptkonzept                              AS konzept,
       p.geschaeftstag,
       date_trunc('month', p.geschaeftstag)::date   AS monat,
       (ARRAY['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'])
           [extract(isodow FROM p.geschaeftstag)::int] AS wochentag,
       p.stunde,
       p.personen,
       p.personalkosten,
       z.umsatz_netto,
       CASE WHEN p.personen > 0
            THEN round(z.umsatz_netto / p.personen, 2) END                 AS umsatz_je_person,
       CASE WHEN z.umsatz_netto > 0
            THEN round(p.personalkosten / z.umsatz_netto * 100, 2) END     AS personalkostenquote_pct,
       extract(isodow FROM p.geschaeftstag)::int    AS wochentag_nr,
       ((p.stunde + 16) % 24)::int                  AS stunde_folge
  FROM core.personalkosten_stunde p
  JOIN core.betrieb b                    ON b.betrieb_key = p.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz    ON kz.betrieb_key = p.betrieb_key
  LEFT JOIN core.zeitzonenbericht_stunde z
         ON z.betrieb_key = p.betrieb_key
        AND z.geschaeftstag = p.geschaeftstag
        AND z.stunde = p.stunde;

COMMENT ON VIEW mart.personal_stunde IS
'Personen und Lohnkosten je Betrieb, Geschaeftstag und Stunde aus LINAs Personalplanung (TPAPI,
0149), daneben der Nettoumsatz derselben Stunde. Nur Betriebe mit TPAPI-Schluessel — wer fehlt und
warum, sagt mart.tpapi_zugang; ein fehlender Betrieb hat nicht null Personal. Eine Stunde ohne
Zeile ist keine Stunde mit null Personen, sondern eine, die LINA nicht fuehrt. Der Geschaeftstag
laeuft 08:00 bis 07:59: "ab 18 Uhr" ist stunde >= 18 OR stunde < 8, fuer den Verlauf nach
stunde_folge sortieren. LINA liefert rund ein Jahr zurueck. Die Lohnkosten sind die der
Personalplanung, NICHT die Personalkosten der BWA — Quoten nicht gegen die BWA vergleichen.';

COMMENT ON COLUMN mart.personal_stunde.wochentag IS
'Deutscher Name des Wochentags des Geschaeftstags; die Nachtstunden 0-7 gehoeren zum Wochentag des
Geschaeftstags, nicht des Kalendertags. Zahl (ISO, Montag = 1) in wochentag_nr.';
COMMENT ON COLUMN mart.personal_stunde.personen IS
'Personen in dieser Stunde laut LINA (eff).';
COMMENT ON COLUMN mart.personal_stunde.personalkosten IS
'Lohnkosten dieser Stunde in EUR laut Personalplanung (kost) — nicht BWA.';
COMMENT ON COLUMN mart.personal_stunde.umsatz_netto IS
'Nettoumsatz derselben Stunde aus dem Konzern-Stundenbericht; NULL, wenn der Stundenbericht die
Stunde nicht fuehrt.';
COMMENT ON COLUMN mart.personal_stunde.umsatz_je_person IS
'Nettoumsatz der Stunde geteilt durch die Personen der Stunde, EUR; NULL bei 0 Personen. Ueber
mehrere Stunden NICHT mitteln, sondern Summe Umsatz durch Summe Personen rechnen.';
COMMENT ON COLUMN mart.personal_stunde.personalkostenquote_pct IS
'Lohnkosten der Stunde in Prozent des Nettoumsatzes der Stunde (Prozentzahl, 23.64 = 23,64 %); NULL
ohne positiven Umsatz. Ueber mehrere Stunden NICHT mitteln, sondern aus den Summen neu rechnen.';
COMMENT ON COLUMN mart.personal_stunde.wochentag_nr IS
'ISO-Wochentag des Geschaeftstags, Montag = 1 … Sonntag = 7.';
COMMENT ON COLUMN mart.personal_stunde.stunde_folge IS
'Position der Stunde im Geschaeftstag (8 Uhr = 0 … 7 Uhr = 23) — danach sortieren, nicht nach stunde.';


-- ---------------------------------------------------------------------
-- 5b. Eigene Fenster (manual.zeitfenster)
--
-- Dieselbe Fensterdefinition und derselbe Bereichsvergleich wie
-- mart.umsatz_zeitfenster (0052): Fenster ueber Mitternacht
-- (stunde_bis <= stunde_von) werden ueber OR geschnitten, nicht ueber
-- BETWEEN. Getrieben von den ABGERUFENEN Tagen, nicht von den Stunden: so
-- steht der Umsatz des ganzen Fensters da, auch Stunden ohne Personalzeile,
-- und ein Fenster ohne Personal erscheint mit stunden_besetzt = 0 statt zu
-- fehlen. Beide Seiten als LATERAL, damit auch ein Filter auf Marke statt
-- auf Betrieb ueber die Primaerschluessel liest und nie die 10,6 Mio.
-- Stundenzeilen gruppiert.
-- ---------------------------------------------------------------------

CREATE VIEW mart.personal_zeitfenster AS
SELECT a.betrieb_key,
       b.name                                       AS betrieb,
       kz.hauptkonzept                              AS konzept,
       a.geschaeftstag,
       date_trunc('month', a.geschaeftstag)::date   AS monat,
       (ARRAY['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'])
           [extract(isodow FROM a.geschaeftstag)::int] AS wochentag,
       f.fenster_key,
       f.name                                       AS fenster,
       f.reihenfolge,
       (f.stunde_bis <= f.stunde_von)               AS ueber_mitternacht,
       ps.personenstunden,
       ps.personalkosten,
       us.umsatz_netto,
       CASE WHEN ps.personenstunden > 0
            THEN round(us.umsatz_netto / ps.personenstunden, 2) END        AS umsatz_je_personenstunde,
       CASE WHEN us.umsatz_netto > 0
            THEN round(ps.personalkosten / us.umsatz_netto * 100, 2) END   AS personalkostenquote_pct,
       coalesce(ps.stunden_besetzt, 0)              AS stunden_besetzt,
       extract(isodow FROM a.geschaeftstag)::int    AS wochentag_nr
  FROM core.personalkosten_stunde_abruf a
  JOIN core.betrieb b                 ON b.betrieb_key = a.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = a.betrieb_key
  JOIN manual.zeitfenster f           ON f.aktiv
  LEFT JOIN LATERAL (
        SELECT sum(p.personen)                         AS personenstunden,
               sum(p.personalkosten)                   AS personalkosten,
               count(*) FILTER (WHERE p.personen > 0)::int AS stunden_besetzt
          FROM core.personalkosten_stunde p
         WHERE p.betrieb_key = a.betrieb_key
           AND p.geschaeftstag = a.geschaeftstag
           AND CASE WHEN f.stunde_bis > f.stunde_von
                    THEN p.stunde >= f.stunde_von AND p.stunde < f.stunde_bis
                    ELSE p.stunde >= f.stunde_von OR  p.stunde < f.stunde_bis
               END
       ) ps ON true
  LEFT JOIN LATERAL (
        SELECT sum(z.umsatz_netto) AS umsatz_netto
          FROM core.zeitzonenbericht_stunde z
         WHERE z.betrieb_key = a.betrieb_key
           AND z.geschaeftstag = a.geschaeftstag
           AND CASE WHEN f.stunde_bis > f.stunde_von
                    THEN z.stunde >= f.stunde_von AND z.stunde < f.stunde_bis
                    ELSE z.stunde >= f.stunde_von OR  z.stunde < f.stunde_bis
               END
       ) us ON true;

COMMENT ON VIEW mart.personal_zeitfenster IS
'Personenstunden, Lohnkosten und Nettoumsatz je Betrieb, Geschaeftstag und eigenem Zeitfenster
(manual.zeitfenster, dieselben Fenster wie mart.umsatz_zeitfenster) — aus LINAs Personalplanung
(TPAPI, 0149). Eine Zeile je abgerufenem Tag und aktivem Fenster, auch wenn im Fenster niemand
eingeplant war (stunden_besetzt = 0). Nur Betriebe mit TPAPI-Schluessel, siehe mart.tpapi_zugang.
Wer andere Grenzen braucht (etwa ab 18 Uhr), schneidet sie in mart.personal_stunde ueber stunde:
der Geschaeftstag laeuft 08:00 bis 07:59, "ab 18 Uhr" ist stunde >= 18 OR stunde < 8. Lohnkosten
der Personalplanung, nicht der BWA.';

COMMENT ON COLUMN mart.personal_zeitfenster.personenstunden IS
'Summe der Personen ueber die Stunden des Fensters = Personenstunden; NULL, wenn LINA im Fenster
keine Stunde fuehrt.';
COMMENT ON COLUMN mart.personal_zeitfenster.umsatz_netto IS
'Nettoumsatz aller Stunden des Fensters aus dem Konzern-Stundenbericht — unabhaengig davon, ob fuer
die Stunde eine Personalzeile vorliegt.';
COMMENT ON COLUMN mart.personal_zeitfenster.umsatz_je_personenstunde IS
'Nettoumsatz des Fensters je Personenstunde, EUR; NULL ohne Personenstunden. Ueber Tage oder
Betriebe aus den Summen neu rechnen, nicht mitteln.';
COMMENT ON COLUMN mart.personal_zeitfenster.personalkostenquote_pct IS
'Lohnkosten des Fensters in Prozent des Nettoumsatzes (Prozentzahl); NULL ohne positiven Umsatz.';
COMMENT ON COLUMN mart.personal_zeitfenster.stunden_besetzt IS
'Stunden des Fensters mit mindestens einer Person. 0 heisst: LINA fuehrt dort niemanden — nicht
unbedingt, dass niemand da war (Personalplanung nicht in LINA).';
COMMENT ON COLUMN mart.personal_zeitfenster.ueber_mitternacht IS
'Das Fenster reicht ueber 24 Uhr hinaus (stunde_bis <= stunde_von), seine Nachtstunden gehoeren
zum selben Geschaeftstag.';


-- ---------------------------------------------------------------------
-- 5c. Der Tag
--
-- Der Umsatz kommt hier aus dem Umsatzbericht (Gesamtzeile:
-- hauptsparte_key und verkaufsstelle_key NULL, wie mart.betrieb_status),
-- nicht aus der Stundensumme: das ist die Zahl, die ueberall sonst als
-- Tagesumsatz steht.
-- ---------------------------------------------------------------------

CREATE VIEW mart.personal_tag AS
SELECT a.betrieb_key,
       b.name                                       AS betrieb,
       kz.hauptkonzept                              AS konzept,
       a.geschaeftstag,
       date_trunc('month', a.geschaeftstag)::date   AS monat,
       (ARRAY['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'])
           [extract(isodow FROM a.geschaeftstag)::int] AS wochentag,
       ps.personenstunden,
       ps.personalkosten,
       coalesce(ps.stunden_besetzt, 0)              AS stunden_besetzt,
       ps.erste_stunde,
       ps.letzte_stunde,
       u.umsatz_netto,
       CASE WHEN ps.personenstunden > 0
            THEN round(u.umsatz_netto / ps.personenstunden, 2) END         AS umsatz_je_personenstunde,
       CASE WHEN u.umsatz_netto > 0
            THEN round(ps.personalkosten / u.umsatz_netto * 100, 2) END    AS personalkostenquote_pct,
       extract(isodow FROM a.geschaeftstag)::int    AS wochentag_nr,
       a.stunden                                    AS stunden_geliefert,
       a.abgerufen_am
  FROM core.personalkosten_stunde_abruf a
  JOIN core.betrieb b                 ON b.betrieb_key = a.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = a.betrieb_key
  LEFT JOIN LATERAL (
        SELECT sum(p.personen)                              AS personenstunden,
               sum(p.personalkosten)                        AS personalkosten,
               count(*) FILTER (WHERE p.personen > 0)::int  AS stunden_besetzt,
               ((min((p.stunde + 16) % 24) FILTER (WHERE p.personen > 0) + 8) % 24)::int AS erste_stunde,
               ((max((p.stunde + 16) % 24) FILTER (WHERE p.personen > 0) + 8) % 24)::int AS letzte_stunde
          FROM core.personalkosten_stunde p
         WHERE p.betrieb_key = a.betrieb_key
           AND p.geschaeftstag = a.geschaeftstag
       ) ps ON true
  LEFT JOIN core.umsatzbericht_tag u
         ON u.betrieb_key = a.betrieb_key
        AND u.geschaeftstag = a.geschaeftstag
        AND u.hauptsparte_key IS NULL
        AND u.verkaufsstelle_key IS NULL;

COMMENT ON VIEW mart.personal_tag IS
'Personal je Betrieb und Geschaeftstag aus LINAs Personalplanung (TPAPI, 0149): Personenstunden,
Lohnkosten, besetzte Stunden, erste und letzte besetzte Stunde, dazu der Tagesumsatz aus dem
Umsatzbericht. Eine Zeile je abgerufenem Tag — auch leere Tage (stunden_geliefert = 0): dort fuehrt
LINA keine Schichten, das heisst nicht "niemand da". Nur Betriebe mit TPAPI-Schluessel, siehe
mart.tpapi_zugang. Lohnkosten der Personalplanung, nicht der BWA.';

COMMENT ON COLUMN mart.personal_tag.personenstunden IS
'Summe der Personen ueber alle Stunden des Geschaeftstags = Personenstunden.';
COMMENT ON COLUMN mart.personal_tag.stunden_besetzt IS
'Stunden mit mindestens einer Person.';
COMMENT ON COLUMN mart.personal_tag.erste_stunde IS
'Erste besetzte Stunde in der Reihenfolge des Geschaeftstags (08:00 zuerst, 07:00 zuletzt).';
COMMENT ON COLUMN mart.personal_tag.letzte_stunde IS
'Letzte besetzte Stunde in der Reihenfolge des Geschaeftstags — 2 heisst 02:00 der Nacht danach,
nicht frueh am Morgen dieses Tages.';
COMMENT ON COLUMN mart.personal_tag.umsatz_netto IS
'Nettoumsatz des Tages aus dem Umsatzbericht (Gesamtzeile).';
COMMENT ON COLUMN mart.personal_tag.umsatz_je_personenstunde IS
'Nettoumsatz je Personenstunde, EUR; NULL ohne Personenstunden. Ueber Tage aus den Summen neu
rechnen, nicht mitteln.';
COMMENT ON COLUMN mart.personal_tag.personalkostenquote_pct IS
'Lohnkosten in Prozent des Tagesumsatzes (Prozentzahl); NULL ohne positiven Umsatz. Nicht die
Personalquote der BWA.';
COMMENT ON COLUMN mart.personal_tag.stunden_geliefert IS
'Zahl der Stunden, die LINA fuer den Tag geliefert hat; 0 = leere Antwort.';
COMMENT ON COLUMN mart.personal_tag.abgerufen_am IS
'Wann der Tag zuletzt bei der TPAPI geholt wurde — der Datenstand dieser Zeile.';


-- ---------------------------------------------------------------------
-- 5d. Der Rueckstand des Backfills — sichtbar, nicht im Log (Regel 10)
--
-- Vorbild mart.wetter_rueckstand (0086): eine Nachfuellung, die nachts von
-- selbst laeuft, braucht eine Zahl, die FAELLT. Die 365 ist der Horizont
-- der TPAPI (LINA liefert rund ein Jahr, listdays 03.11.2025-08.11.2026);
-- sie steht hier als Konstante, weil eine Sicht keine Umgebung kennt, und
-- muss zusammen mit TPAPI_HISTORIE_TAGE in src/config.ts geaendert werden.
--
-- Betriebe mit zustand = nicht_lizenziert stehen NICHT darin: ihr Rueckstand
-- ist nicht abzuarbeiten, die Zahl ginge nie auf null (0071). Sie bleiben in
-- mart.tpapi_zugang sichtbar und kehren zurueck, sobald ein Aufruf wieder
-- gelingt (zustand = ok).
-- ---------------------------------------------------------------------

CREATE VIEW mart.personal_rueckstand AS
SELECT z.betrieb_key,
       z.enc_id,
       b.name              AS betrieb,
       d.tag::date         AS geschaeftstag,
       z.zustand           AS zugang_zustand
  FROM sync.tpapi_zugang z
  JOIN core.betrieb b ON b.betrieb_key = z.betrieb_key
  CROSS JOIN LATERAL generate_series(current_date - 365, current_date - 1, interval '1 day') AS d(tag)
 WHERE z.modul = 'personal'
   AND z.schluessel_vorhanden
   AND z.zustand <> 'nicht_lizenziert'
   AND NOT EXISTS (SELECT 1
                     FROM core.personalkosten_stunde_abruf a
                    WHERE a.betrieb_key = z.betrieb_key
                      AND a.geschaeftstag = d.tag::date);

COMMENT ON VIEW mart.personal_rueckstand IS
'Arbeitsliste des TPAPI-Backfills (0149): je Betrieb mit Schluessel die Geschaeftstage der letzten
365 Tage (bis gestern), die noch nie erfolgreich geholt wurden. Ein leerer Tag zaehlt als erledigt.
Die Zeilenzahl MUSS von Nacht zu Nacht fallen und 0 erreichen; tut sie das nicht, laeuft der
Backfill nicht mehr. Die 365 ist der Horizont der TPAPI (LINA liefert rund ein Jahr) und muss
zusammen mit TPAPI_HISTORIE_TAGE in src/config.ts geaendert werden. Betriebe, deren Modul nicht
lizenziert ist, fehlen hier — sie stehen in mart.tpapi_zugang.';

COMMENT ON COLUMN mart.personal_rueckstand.zugang_zustand IS
'Ausgang des letzten Aufrufs fuer diesen Betrieb (sync.tpapi_zugang.zustand) — gebremst oder fehler
erklaeren, warum ein Betrieb hier stehen bleibt.';


-- ---------------------------------------------------------------------
-- 5e. Die Pruefung
--
-- ABWEICHUNG VOM PLAN (docs/plan-tpapi.md 3.5). Der Plan rechnet
-- personalkosten_aus_quote = pek_gesamt / 100 × Tagesumsatz und vergleicht
-- das mit den TPAPI-Kosten DES TAGES. Das waere an fast jedem Tag
-- 'weicht ab': je Tag abgerufen laeuft der Zaehler von pek_gesamt seit
-- Monatsanfang auf, der Nenner ist der Tag (docs/fehlerkatalog.md,
-- "core.personalkosten.pek_* ist auf Tagesebene keine Quote"). Nachgemessen
-- am 09.11.2026 auf einem Klon (Daten bis 12.08.2026), Median von
-- pek_gesamt × umsatz_netto / 100 ueber alle Betriebe seit November 2025
-- nach Monatstag: Tag 1 2.053, Tag 2 3.022, Tag 8 9.610, Tag 15 16.664,
-- Tag 22 25.540, Tag 28 31.831 EUR. Das sind die AUFGELAUFENEN Kosten des
-- Monats. Verglichen wird deshalb die TPAPI-Summe vom Monatsersten bis zum
-- Tag; der befund verlangt, dass jeder Tag davor geholt ist.
--
-- Diese Monatssumme ist fuer die Nachtfrage stumpf: eine Nacht am falschen
-- Tag verschiebt sie nur um die Nachtstunden des letzten Tages. Die scharfe
-- Probe ist befund_stunden — Personenstunden des Tages gegen Umsatz
-- geteilt durch eff_gesamt (Umsatz je Personalstunde). eff_* ist je Tag
-- abgerufen nicht aufgelaufen (fehlerkatalog.md: "eff_* bleibt flach").
--
-- Zwei Dinge, die eine Abweichung erklaeren koennen, ohne dass etwas falsch
-- ist: der Scraper holt getPersonalkosten 21 Tage nach und einmal im Monat
-- 62 Tage zurueck, die TPAPI nur 14 Tage — Schichten, die spaeter
-- korrigiert werden, stehen in beiden zu verschiedenen Staenden. Und ob
-- LINA in pek und eff denselben Nettoumsatz meint, ist nicht gemessen.
-- ---------------------------------------------------------------------

CREATE VIEW mart.personal_stunde_pruefung AS
WITH tag AS (
    SELECT a.betrieb_key,
           a.geschaeftstag,
           a.stunden                          AS stunden_geliefert,
           ps.personalkosten,
           ps.personenstunden
      FROM core.personalkosten_stunde_abruf a
      LEFT JOIN LATERAL (
            SELECT sum(p.personalkosten) AS personalkosten,
                   sum(p.personen)       AS personenstunden
              FROM core.personalkosten_stunde p
             WHERE p.betrieb_key = a.betrieb_key
               AND p.geschaeftstag = a.geschaeftstag
           ) ps ON true
),
kumuliert AS (
    SELECT t.*,
           sum(coalesce(t.personalkosten, 0)) OVER w AS personalkosten_monat,
           count(*) OVER w                           AS tage_geholt_monat
      FROM tag t
    WINDOW w AS (PARTITION BY t.betrieb_key, date_trunc('month', t.geschaeftstag)
                 ORDER BY t.geschaeftstag)
),
scraper AS (
    SELECT k.*,
           u.umsatz_netto,
           pk.pek_gesamt,
           pk.eff_gesamt,
           CASE WHEN u.umsatz_netto > 0 AND pk.pek_gesamt > 0
                THEN round(pk.pek_gesamt / 100 * u.umsatz_netto, 2) END AS aus_quote,
           CASE WHEN u.umsatz_netto > 0 AND pk.eff_gesamt > 0
                THEN round(u.umsatz_netto / pk.eff_gesamt, 2) END       AS aus_eff
      FROM kumuliert k
      LEFT JOIN core.umsatzbericht_tag u
             ON u.betrieb_key = k.betrieb_key
            AND u.geschaeftstag = k.geschaeftstag
            AND u.hauptsparte_key IS NULL
            AND u.verkaufsstelle_key IS NULL
      LEFT JOIN core.personalkosten pk
             ON pk.betrieb_key = k.betrieb_key
            AND pk.zeitraum_von = k.geschaeftstag
            AND pk.zeitraum_bis = k.geschaeftstag
)
SELECT s.betrieb_key,
       b.name                                       AS betrieb,
       kz.hauptkonzept                              AS konzept,
       s.geschaeftstag,
       s.personalkosten                             AS personalkosten_tpapi,
       s.personalkosten_monat                       AS personalkosten_tpapi_monat,
       s.aus_quote                                  AS personalkosten_aus_quote,
       CASE WHEN s.aus_quote > 0
            THEN round((s.personalkosten_monat - s.aus_quote) / s.aus_quote * 100, 2) END
                                                    AS abweichung_pct,
       CASE WHEN s.stunden_geliefert = 0                                       THEN 'leer'
            WHEN s.aus_quote IS NULL                                           THEN 'ohne vergleich'
            WHEN s.tage_geholt_monat < extract(day FROM s.geschaeftstag)       THEN 'monat unvollstaendig'
            WHEN abs(s.personalkosten_monat - s.aus_quote) <= 0.05 * s.aus_quote THEN 'ok'
            ELSE 'weicht ab' END                    AS befund,
       s.umsatz_netto,
       s.pek_gesamt,
       s.tage_geholt_monat::int                     AS tage_geholt_monat,
       s.personenstunden                            AS personenstunden_tpapi,
       s.aus_eff                                    AS personenstunden_aus_effektivitaet,
       CASE WHEN s.aus_eff > 0
            THEN round((s.personenstunden - s.aus_eff) / s.aus_eff * 100, 2) END
                                                    AS abweichung_stunden_pct,
       CASE WHEN s.stunden_geliefert = 0                                       THEN 'leer'
            WHEN s.aus_eff IS NULL                                             THEN 'ohne vergleich'
            WHEN abs(s.personenstunden - s.aus_eff) <= 0.05 * s.aus_eff        THEN 'ok'
            ELSE 'weicht ab' END                    AS befund_stunden
  FROM scraper s
  JOIN core.betrieb b                 ON b.betrieb_key = s.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = s.betrieb_key;

COMMENT ON VIEW mart.personal_stunde_pruefung IS
'Pruefsicht (0149): je Betrieb und abgerufenem Geschaeftstag die TPAPI-Personaldaten gegen LINAs
Personalkostenbericht (Scraper, core.personalkosten). Zwei Proben: befund vergleicht die
TPAPI-Lohnkosten vom Monatsersten bis zu diesem Tag mit pek_gesamt × Tagesumsatz — LINAs pek je Tag
ist kein Tageswert, sondern seit Monatsanfang aufgelaufen. befund_stunden vergleicht die
Personenstunden des Tages mit Tagesumsatz / eff_gesamt und ist die Probe, ob die Nachtstunden 0-7
am richtigen Tag stehen: weicht sie bei Betrieben mit Nachtgeschaeft systematisch ab, ordnet LINA
die Nacht anders zu. Werte: ok (hoechstens 5 % Abweichung) | weicht ab | ohne vergleich (kein
Scraperwert oder kein positiver Umsatz) | leer (TPAPI lieferte keine Stunden) | monat
unvollstaendig (nur befund: ein Tag davor im Monat ist noch nicht geholt). Immer nach
geschaeftstag filtern.';

COMMENT ON COLUMN mart.personal_stunde_pruefung.personalkosten_tpapi IS
'Lohnkosten dieses Tages laut TPAPI, EUR.';
COMMENT ON COLUMN mart.personal_stunde_pruefung.personalkosten_tpapi_monat IS
'Lohnkosten laut TPAPI vom Monatsersten bis einschliesslich dieses Tages, EUR — die Vergleichszahl
zu personalkosten_aus_quote.';
COMMENT ON COLUMN mart.personal_stunde_pruefung.personalkosten_aus_quote IS
'pek_gesamt / 100 × Tagesumsatz (Umsatzbericht, Gesamtzeile). Weil LINA den Zaehler von pek je Tag
seit Monatsanfang auflaufen laesst, sind das die AUFGELAUFENEN Lohnkosten des Monats bis zu diesem
Tag, nicht die des Tages.';
COMMENT ON COLUMN mart.personal_stunde_pruefung.abweichung_pct IS
'(personalkosten_tpapi_monat - personalkosten_aus_quote) in Prozent von personalkosten_aus_quote
(Prozentzahl).';
COMMENT ON COLUMN mart.personal_stunde_pruefung.tage_geholt_monat IS
'Wie viele Tage dieses Monats bis einschliesslich dieses Tages bei der TPAPI geholt sind; kleiner
als der Monatstag heisst: die Monatssumme ist unvollstaendig.';
COMMENT ON COLUMN mart.personal_stunde_pruefung.personenstunden_aus_effektivitaet IS
'Tagesumsatz / eff_gesamt aus LINAs Personalkostenbericht (eff = Umsatz je Personalstunde, je Tag
nicht aufgelaufen) — die Personenstunden, die LINA selbst zugrunde legt.';
COMMENT ON COLUMN mart.personal_stunde_pruefung.abweichung_stunden_pct IS
'(personenstunden_tpapi - personenstunden_aus_effektivitaet) in Prozent der letzteren (Prozentzahl).';
COMMENT ON COLUMN mart.personal_stunde_pruefung.befund_stunden IS
'ok | weicht ab | ohne vergleich | leer — die Tagesprobe auf die Personenstunden; die Nachtprobe.';


-- ---------------------------------------------------------------------
-- 5f. Der Zugang — alle Betriebe, nicht nur die mit Schluessel
--
-- Wer keinen Schluessel hat, bekommt keine Personaldaten; das darf nicht
-- aussehen wie "kein Personal". Deshalb steht hier jeder Betrieb mit
-- seinem Status (mart.betrieb_status), und befund sagt, ob das Fehlen ein
-- Problem ist.
-- ---------------------------------------------------------------------

CREATE VIEW mart.tpapi_zugang AS
SELECT bs.betrieb_key,
       bs.betrieb,
       bs.konzept,
       bs.status,
       coalesce(z.schluessel_vorhanden, false)      AS schluessel,
       z.zustand,
       z.zuletzt_gefragt_am                         AS zuletzt_gefragt,
       z.zuletzt_erfolg_am                          AS zuletzt_erfolg,
       z.letzter_fehler,
       coalesce(ab.tage_geladen, 0)                 AS tage_geladen,
       ab.aeltester_tag,
       ab.juengster_tag,
       coalesce(rs.rueckstand_tage, 0)              AS rueckstand_tage,
       CASE WHEN coalesce(z.schluessel_vorhanden, false) THEN
                CASE WHEN z.zustand = 'nicht_lizenziert' THEN 'nicht lizenziert'
                     WHEN z.zustand = 'abgewiesen'       THEN 'abgewiesen'
                     WHEN z.zustand = 'gebremst'         THEN 'gebremst'
                     WHEN z.zuletzt_erfolg_am IS NULL
                       OR z.zuletzt_erfolg_am < now() - interval '48 hours'
                                                         THEN 'Schluessel ohne Zulauf'
                     ELSE 'ok' END
            WHEN bs.status = 'operativ'                  THEN 'operativ ohne Schluessel'
            ELSE 'nicht operativ' END               AS befund,
       z.letzter_http
  FROM mart.betrieb_status bs
  LEFT JOIN sync.tpapi_zugang z
         ON z.betrieb_key = bs.betrieb_key
        AND z.modul = 'personal'
  LEFT JOIN LATERAL (
        SELECT count(*)::int          AS tage_geladen,
               min(a.geschaeftstag)   AS aeltester_tag,
               max(a.geschaeftstag)   AS juengster_tag
          FROM core.personalkosten_stunde_abruf a
         WHERE a.betrieb_key = bs.betrieb_key
       ) ab ON true
  LEFT JOIN LATERAL (
        SELECT count(*)::int AS rueckstand_tage
          FROM mart.personal_rueckstand r
         WHERE r.betrieb_key = bs.betrieb_key
       ) rs ON true;

COMMENT ON VIEW mart.tpapi_zugang IS
'TPAPI-Zugang je Betrieb, alle Betriebe (0149): hat er einen Schluessel fuer das Personalmodul, wie
ging der letzte Aufruf aus, wie viele Tage sind geladen und wie viele fehlen noch. befund: ok |
Schluessel ohne Zulauf (seit 48 h keine erfolgreiche Antwort) | nicht lizenziert (Modul fuer den
Betrieb nicht gebucht — ein Zustand, kein Fehler) | abgewiesen (Schluessel abgelehnt) | gebremst
(Anfragelimit erreicht) | operativ ohne Schluessel (laufender Betrieb, fuer den es keine
Personaldaten gibt) | nicht operativ (kein Schluessel, kein laufendes Geschaeft). Wer in den
Personalsichten fehlt, steht hier mit Grund.';

COMMENT ON COLUMN mart.tpapi_zugang.status IS
'Betriebsstatus aus mart.betrieb_status (operativ, inaktiv, geschlossen, fremdkasse …).';
COMMENT ON COLUMN mart.tpapi_zugang.schluessel IS
'Steht fuer den Betrieb ein TPAPI-Schluessel in der Umgebung des Importers?';
COMMENT ON COLUMN mart.tpapi_zugang.zustand IS
'Ausgang des letzten Aufrufs (sync.tpapi_zugang.zustand); NULL ohne Schluessel.';
COMMENT ON COLUMN mart.tpapi_zugang.tage_geladen IS
'Geschaeftstage, die fuer den Betrieb erfolgreich geholt sind, leere Tage eingeschlossen.';
COMMENT ON COLUMN mart.tpapi_zugang.rueckstand_tage IS
'Tage im Horizont (365), die noch fehlen — Zeilen in mart.personal_rueckstand.';


-- ---------------------------------------------------------------------
-- 6. Pruefuebersicht: drei Zeilen, auch wenn sie null sind (wie 0137)
--
-- Zeile 1 geht erst auf null, wenn jeder laufende Betrieb das Personalmodul
-- gebucht hat; das ist offen (docs/offene-punkte.md) und soll sichtbar
-- bleiben. Zeile 3 ueber 60 Tage ohne den Rand der letzten acht: der Scraper
-- holt getPersonalkosten 21 Tage nach, frische Tage sind in beiden Quellen
-- noch in Bewegung.
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%tpapi_zugang%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s UNION ALL %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'TPAPI: operativer Betrieb ohne Schluessel'::text AS pruefung,
               count(*) FILTER (WHERE t.status = 'operativ')::bigint                  AS geprueft,
               count(*) FILTER (WHERE t.status = 'operativ' AND NOT t.schluessel)::bigint AS auffaellig,
               'mart.tpapi_zugang'::text AS sicht
          FROM mart.tpapi_zugang t
        $zweig$,
        $zweig$
        SELECT 'TPAPI: Schluessel ohne Zulauf (48 h)'::text AS pruefung,
               count(*) FILTER (WHERE t.schluessel)::bigint AS geprueft,
               count(*) FILTER (WHERE t.schluessel
                                  AND t.zustand IS DISTINCT FROM 'nicht_lizenziert'
                                  AND (t.zuletzt_erfolg IS NULL
                                       OR t.zuletzt_erfolg < now() - interval '48 hours'))::bigint AS auffaellig,
               'mart.tpapi_zugang'::text AS sicht
          FROM mart.tpapi_zugang t
        $zweig$,
        $zweig$
        SELECT 'Personal je Stunde: Tageskosten weichen von LINAs Quote ab (60 Tage)'::text AS pruefung,
               count(*) FILTER (WHERE p.befund IN ('ok', 'weicht ab'))::bigint AS geprueft,
               count(*) FILTER (WHERE p.befund = 'weicht ab')::bigint          AS auffaellig,
               'mart.personal_stunde_pruefung'::text AS sicht
          FROM mart.personal_stunde_pruefung p
         WHERE p.geschaeftstag >= current_date - 60
           AND p.geschaeftstag <  current_date - 8
        $zweig$);
END $aussen$;


-- ---------------------------------------------------------------------
-- 7. MCP-Katalog: Koernung, Fallstricke, Rechte, Leseprobe
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.personal_stunde',
     'Betrieb × Geschaeftstag × Stunde — Personen und Lohnkosten aus LINAs Personalplanung (TPAPI), nur Betriebe mit Schluessel',
     'personal', true),
    ('mart.personal_zeitfenster',
     'Betrieb × Geschaeftstag × eigenes Zeitfenster (manual.zeitfenster) — Personenstunden, Lohnkosten, Umsatz',
     'personal', true),
    ('mart.personal_tag',
     'Betrieb × Geschaeftstag — Personenstunden, Lohnkosten, besetzte Stunden, Tagesumsatz',
     'personal', true),
    ('mart.personal_rueckstand',
     'Betrieb × fehlender Geschaeftstag — Arbeitsliste des TPAPI-Backfills, muss auf 0 fallen',
     'import', false),
    ('mart.personal_stunde_pruefung',
     'Betrieb × Geschaeftstag — TPAPI gegen LINAs Personalkostenbericht; immer nach geschaeftstag filtern',
     'import', false),
    ('mart.tpapi_zugang',
     'Betrieb (alle) — TPAPI-Schluessel, letzter Aufruf, geladene und fehlende Tage',
     'import', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

-- Nur Regelarten, die mcp/src/pruefen.ts kennt (deutung, sichten_mischen) —
-- eine unbekannte liesse den Server nicht starten. 'deutung' gilt fuer genau
-- eine Sicht (mcp.fallstrick.sicht), deshalb je Sicht eine Zeile mit
-- Endung, wie nachlass_menge_deutung_monat/_tag. Schwere nur sperre oder
-- warnung (CHECK fallstrick_schwere); der Plan nannte fuer die Historie
-- "hinweis", das laesst die Tabelle nicht zu.
INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle)
SELECT 'personal_nur_mit_schluessel_' || v.endung, 'deutung', 'warnung', v.sicht, '{}'::jsonb,
       'Personaldaten je Stunde gibt es nur fuer Betriebe mit TPAPI-Schluessel — wie viele das '
       'gerade sind, sagt mart.tpapi_zugang (schluessel). Ein Betrieb, der hier fehlt, hat nicht '
       'null Personal — er ist nicht angebunden.',
       'Vor einem Vergleich zwischen Betrieben oder Marken in mart.tpapi_zugang nachsehen, wer '
       'fehlt und warum (befund). Fehlende Betriebe nennen, nicht als null zaehlen.',
       '0149'
  FROM (VALUES ('stunde', 'mart.personal_stunde'),
               ('zeitfenster', 'mart.personal_zeitfenster'),
               ('tag', 'mart.personal_tag')) AS v(endung, sicht)
UNION ALL
SELECT 'personal_leer_ist_nicht_null_' || v.endung, 'deutung', 'warnung', v.sicht, '{}'::jsonb,
       'Ein Tag oder eine Stunde ohne Personal heisst: LINA fuehrt dort keine Schichten (etwa bei '
       'Betrieben, die ihre Personalplanung nicht in LINA machen), nicht "niemand da". Fehlende '
       'Stunden fehlen, sie sind nicht 0.',
       'Erst stunden_besetzt bzw. mart.personal_tag (stunden_geliefert) ansehen; Tage ohne '
       'besetzte Stunde aus Durchschnitten herausnehmen und ihre Zahl nennen.',
       '0149'
  FROM (VALUES ('stunde', 'mart.personal_stunde'),
               ('zeitfenster', 'mart.personal_zeitfenster'),
               ('tag', 'mart.personal_tag')) AS v(endung, sicht)
UNION ALL
SELECT 'personal_tpapi_gegen_bwa', 'sichten_mischen', 'warnung', NULL,
       '{"a":["mart.personal_stunde","mart.personal_zeitfenster","mart.personal_tag"],"b":["mart.personal_bereich_monat","mart.round_table_monat"]}'::jsonb,
       'Die Lohnkosten je Stunde stammen aus LINAs Personalplanung, die Personalkosten der BWA und '
       'des Round Table aus der Buchhaltung — andere Basis (ohne GF, Verwaltung, Abgrenzungen), '
       'anderer Zeitpunkt. Gegeneinander gerechnet entsteht eine Zahl ohne Bedeutung.',
       'Nicht gegeneinander rechnen, Quoten nicht vergleichen. Fuer die Personalquote '
       'mart.personal_bereich_monat bzw. mart.round_table_monat nehmen; die Stundensichten fuer '
       'Besetzung und Umsatz je Person.',
       '0149'
UNION ALL
SELECT 'personal_historie_ein_jahr_' || v.endung, 'deutung', 'warnung', v.sicht, '{}'::jsonb,
       'LINAs Schnittstelle liefert rund ein Jahr zurueck; vor November 2025 gibt es keine '
       'Personaldaten je Stunde. Der Backfill laeuft seit der ersten Nacht nach 0149 rueckwaerts — '
       'bis er durch ist, fehlen aeltere Tage, sie sind nicht null.',
       'Vor einer Zeitreihe oder einem Vorjahresvergleich in mart.personal_rueckstand und '
       'mart.tpapi_zugang (aeltester_tag, rueckstand_tage) nachsehen, ab wann die Daten vollstaendig sind.',
       '0149'
  FROM (VALUES ('stunde', 'mart.personal_stunde'),
               ('tag', 'mart.personal_tag')) AS v(endung, sicht)
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

SELECT mcp.rechte_auffrischen();

-- Die Gegenprobe als Leserolle (Pflicht seit 0110): SELECT * … LIMIT 1, nicht
-- count(*) — der wertet die Spaltenausdruecke nicht aus.
DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0149 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0149 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.personal_stunde WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.personal_zeitfenster WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.personal_tag WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.personal_rueckstand LIMIT 1',
        'SELECT * FROM mart.personal_stunde_pruefung WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.tpapi_zugang LIMIT 1',
        'SELECT * FROM mart.pruefung_uebersicht WHERE sicht IN (''mart.tpapi_zugang'', ''mart.personal_stunde_pruefung'')']
    LOOP
        BEGIN
            EXECUTE v_abfrage;
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_abfrage, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0149 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
