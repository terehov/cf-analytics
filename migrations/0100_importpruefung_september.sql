-- =====================================================================
-- 0100 — Vier Befunde der Importpruefung vom 10.09.2026 (Laeufe 112–120)
--
-- 1. sync.quelle bekommt das konfigurierte Nachzuegler-Fenster, und
--    mart.nachzuegler_tiefe misst den Rand daran statt am groessten je
--    beobachteten Abstand. Der war 60 — Lauf 1 (26.07.2026) hatte Tage mit
--    Abstand 23–60 einmalig geholt —, und die Pruefzeile "Aenderungen am
--    Rand des Fensters" konnte fuer keinen LINA-Bericht je anschlagen.
--    Gemessen 10.09.2026: getUmsatzbericht 3 von 63 Abrufen an Tag 10
--    noch geaendert, getPersonalkosten 24 von 30 an Tag 22.
--
-- 2. mart.umsatztag_luecke: Geschaeftstage, an denen der Artikelverkaufs-
--    bericht (Fenster 21 Tage) Umsatz kennt, der Umsatzbericht (Fenster
--    10 Tage) aber null steht. Das ist die Spur eines Kassenausfalls, dessen
--    Nachlieferung LINA erst nach dem Ende des kurzen Fensters erreichte.
--    Gemessen 10.09.2026: Aposto Schwetzingen 04.–14.08. (45.486 EUR netto
--    im Artikelverkauf, 0 im Umsatzbericht) und Enchilada Aschaffenburg
--    31.07.–10.08. (37.570 EUR). Kein Mechanismus holte jenseits des
--    Fensters nach — historieNachziehen() prueft nur, ob ein Posten je
--    existierte. nulltageNachziehen() in src/sync/nachfuellen.ts liest diese
--    Sicht und reiht die Tage neu ein; die Pruefuebersicht zaehlt, was nach
--    drei Anlaeufen immer noch null steht.
--
-- 3. mart.pflichtartikel_klassifikation_basis wird seit dem 25.08.2026 nicht
--    mehr aufgefrischt: REFRESH CONCURRENTLY scheiterte am Unique-Index
--    (konzept, gueltig_von, nr, nm), weil das CTE `ist` den Rohnamen im
--    DISTINCT fuehrte und "Rapsöl 10L" / "Rapsoel 10L" denselben
--    normalisierten Namen ergeben (6 Dubletten am 10.09.2026). Eine
--    materialisierte Sicht laesst sich nicht aendern, nur neu anlegen —
--    deshalb fallen und entstehen hier auch die elf abhaengigen Sichten,
--    unveraendert bis auf die neue Pruefzeile aus Punkt 2.
--
-- 4. Fuenf Zeilen in sync.schema_abweichung vom 29.07./01.08.2026 werden
--    quittiert: es sind die dokumentierten int4-Ueberlaeufe (guests, counts),
--    deren Wert der Lader verwirft und hier ablegt (fehlerkatalog.md,
--    "Ein Datentyp-Ueberlauf ist eine Frage, keine Antwort"). Die Abfrage
--    `WHERE quittiert_am IS NULL` aus AGENTS.md soll wieder leer sein.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Das Fenster steht im Register, und der Rand misst sich daran
-- ---------------------------------------------------------------------
ALTER TABLE sync.quelle ADD COLUMN IF NOT EXISTS nachzuegler_tage integer
    CHECK (nachzuegler_tage IS NULL OR nachzuegler_tage > 0);

COMMENT ON COLUMN sync.quelle.nachzuegler_tage IS
'Konfiguriertes Rueckschaufenster des Tagesberichts in Tagen (endpunkte.ts
nachzuegler_tage, sonst NACHZUEGLER_TAGE). NULL fuer alles, was kein
Tagesbericht ist. Schreibt quellenSpiegeln() bei jedem Lauf; bis zum ersten
Lauf nach 0100 steht hier NULL, und mart.nachzuegler_tiefe faellt auf den
groessten beobachteten Abstand zurueck.';

CREATE OR REPLACE VIEW mart.nachzuegler_tiefe AS
WITH abrufe AS (
  SELECT endpunkt,
         zeitraum_von,
         abgerufen_am,
         payload_hash,
         (abgerufen_am::date - zeitraum_von) AS abstand_tage,
         lag(payload_hash) OVER (PARTITION BY endpunkt, zeitraum_von
                                 ORDER BY abgerufen_am) AS vorher
    FROM raw.api_antwort
   WHERE quelle = 'lina'
     AND zeitraum_von = zeitraum_bis          -- nur Tagesberichte
     AND zeitraum_von > current_date - 180
), je_abstand AS (
  SELECT endpunkt,
         abstand_tage,
         count(*)                                                       AS abrufe,
         count(*) FILTER (WHERE vorher IS NOT NULL
                            AND payload_hash IS DISTINCT FROM vorher)   AS aenderungen
    FROM abrufe
   WHERE abstand_tage BETWEEN 0 AND 60
   GROUP BY endpunkt, abstand_tage
), rand AS (
  -- Der Rand ist das KONFIGURIERTE Fenster. Der groesste beobachtete
  -- Abstand war es bis 0100 — und der stand bei 60, weil Lauf 1 am
  -- 26.07.2026 Tage mit Abstand 23–60 einmalig holte. Ein Rand, der aus
  -- einem einmaligen Abruf entsteht, misst nichts: die Pruefzeile war fuer
  -- jeden LINA-Bericht dauerhaft gruen. Rueckfall auf den beobachteten
  -- Abstand nur, solange sync.quelle das Fenster noch nicht kennt.
  SELECT j.endpunkt,
         coalesce(q.nachzuegler_tage, max(j.abstand_tage)) AS rand,
         q.nachzuegler_tage IS NOT NULL                    AS konfiguriert
    FROM je_abstand j
    LEFT JOIN sync.quelle q ON q.quelle = j.endpunkt
   GROUP BY j.endpunkt, q.nachzuegler_tage
)
SELECT j.endpunkt,
       j.abstand_tage,
       j.abrufe,
       j.aenderungen,
       r.rand,
       -- Am Rand (die letzten beiden Tage des Fensters) aendert sich noch
       -- mehr als jeder zehnte Abruf. Der Schwellwert ist eine Setzung:
       -- getUmsatzbericht lag am 10.09.2026 bei 4,8 % (die zwei Kassen-
       -- ausfaelle, die mart.umsatztag_luecke seither auffaengt),
       -- getPersonalkosten bei 80 % — das eine ist Restrauschen, das andere
       -- ein zu kurzes Fenster. Ohne Schwelle stuende die Zeile fuer jeden
       -- Bericht dauerhaft rot, und eine Zeile, die nie auf null geht,
       -- liest niemand mehr.
       (j.abstand_tage BETWEEN r.rand - 1 AND r.rand
        AND j.aenderungen * 10 > j.abrufe)                              AS am_rand_noch_aenderungen,
       r.konfiguriert                                                   AS rand_konfiguriert,
       round(100.0 * j.aenderungen / nullif(j.abrufe, 0), 1)           AS aenderungen_pct
  FROM je_abstand j
  JOIN rand r USING (endpunkt)
 ORDER BY j.endpunkt, j.abstand_tage;

COMMENT ON VIEW mart.nachzuegler_tiefe IS
'Wie lange bucht LINA einen Geschaeftstag nach? Eine Zeile je Endpunkt und Abstand
in Tagen, gezaehlt an Aenderungen des payload_hash zwischen zwei Abrufen desselben
Tages. raw.api_antwort ist append-only, die Frage also beantwortbar, ohne etwas
mitzuschreiben.

rand ist seit 0100 das KONFIGURIERTE Fenster (sync.quelle.nachzuegler_tage, vorher
der groesste beobachtete Abstand — der stand wegen eines einmaligen Abrufs in
Lauf 1 bei 60, und die Pruefzeile schlug nie an). am_rand_noch_aenderungen: an den
letzten beiden Tagen des Fensters aendert sich noch mehr als jeder zehnte Abruf —
dann ist das Fenster zu kurz, und was dahinter liegt, sehen wir nicht.

ZWEI VORBEHALTE BEIM LESEN. Erstens zaehlt getArtikelverkaufsbericht bis zum
10.09.2026 fast jeden Abruf als Aenderung, weil LINA das Feld columns in
zufaelliger Reihenfolge liefert (2.466 von 3.414 Positionen vertauscht, Inhalt
gleich); seit dem 10.09.2026 hasht der Client eine kanonische Form (sortierte
Schluessel, columns nach artnr), und die Kurve wird erst mit neuen Abrufen
aussagekraeftig. Zweitens meldet ein Tagesbericht, dessen Betrieb erst nach dem
Fenster nachliefert, hier nur ein leises Signal (4,8 % bei getUmsatzbericht am
10.09.2026) — diesen Fall faengt mart.umsatztag_luecke direkt.';

-- ---------------------------------------------------------------------
-- 2. Nulltage, die keine sind
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.umsatztag_luecke AS
WITH fenster AS (
  SELECT coalesce(max(nachzuegler_tage), 10) AS tage
    FROM sync.quelle WHERE quelle = 'getUmsatzbericht'
), artikel AS (
  SELECT betrieb_key, geschaeftstag, sum(umsatz_netto) AS artikel_netto
    FROM core.artikelverkauf_tag
   WHERE geschaeftstag BETWEEN current_date - 120 AND current_date - 1
   GROUP BY 1, 2
), umsatz AS (
  SELECT betrieb_key, geschaeftstag, umsatz_netto
    FROM core.umsatzbericht_tag
   WHERE hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
     AND geschaeftstag BETWEEN current_date - 120 AND current_date - 1
), luecke AS (
  SELECT a.betrieb_key, a.geschaeftstag, a.artikel_netto,
         coalesce(u.umsatz_netto, 0)        AS umsatz_netto,
         (current_date - a.geschaeftstag)   AS alter_tage
    FROM artikel a
    LEFT JOIN umsatz u USING (betrieb_key, geschaeftstag)
   WHERE a.artikel_netto > 0
     AND coalesce(u.umsatz_netto, 0) = 0
), nachholung AS (
  -- Posten fuer getUmsatzbericht, die NACH dem Ende des Fensters angelegt
  -- wurden — also nicht vom taeglichen Nachzuegler-Fenster stammen, sondern
  -- von nulltageNachziehen(). Ein Tag ist ein Konzernbericht: ein Posten
  -- holt ihn fuer alle Betriebe.
  SELECT w.zeitraum_von AS geschaeftstag,
         count(*) FILTER (WHERE w.erledigt_am IS NOT NULL) AS nachgeholt,
         bool_or(w.erledigt_am IS NULL)                     AS offen,
         max(w.erstellt_am)                                 AS zuletzt_eingereiht
    FROM sync.warteschlange w, fenster f
   WHERE w.endpunkt = 'getUmsatzbericht'
     AND w.erstellt_am::date > w.zeitraum_von + f.tage + 1
   GROUP BY 1
)
SELECT b.name                                   AS betrieb,
       l.betrieb_key,
       l.geschaeftstag,
       l.alter_tage,
       l.artikel_netto,
       l.umsatz_netto,
       coalesce(n.nachgeholt, 0)                AS nachgeholt,
       coalesce(n.offen, false)                 AS offen,
       n.zuletzt_eingereiht,
       CASE WHEN l.alter_tage <= f.tage                     THEN 'im Fenster'
            WHEN coalesce(n.offen, false)                    THEN 'eingereiht'
            WHEN coalesce(n.nachgeholt, 0) >= 3              THEN 'aufgegeben'
            WHEN n.zuletzt_eingereiht > now() - interval '7 days' THEN 'wartet'
            ELSE 'faellig' END                  AS zustand
  FROM luecke l
  JOIN core.betrieb b USING (betrieb_key)
  LEFT JOIN nachholung n USING (geschaeftstag)
  CROSS JOIN fenster f
 ORDER BY l.geschaeftstag DESC, b.name;

COMMENT ON VIEW mart.umsatztag_luecke IS
'Geschaeftstage, an denen der Artikelverkaufsbericht Umsatz kennt, der Umsatzbericht
aber null steht — je Betrieb, die letzten 120 Tage. Das ist die Spur eines
Kassenausfalls: die Kasse liefert nach, LINA fuellt beide Berichte, aber der
Umsatzbericht wird nur NACHZUEGLER_TAGE (10) lang erneut geholt, der Artikelverkauf
21 Tage. Gemessen 10.09.2026: Aposto Schwetzingen 04.–14.08. (45.486 EUR) und
Enchilada Aschaffenburg 31.07.–10.08. (37.570 EUR) standen so im Round Table auf null.

zustand: im Fenster = holt der taegliche Lauf ohnehin · faellig = nulltageNachziehen()
reiht den Tag beim naechsten Lauf fuer alle Tagesberichte mit kurzem Fenster ein ·
eingereiht = Posten offen · wartet = zuletzt vor weniger als 7 Tagen nachgeholt, noch
null · aufgegeben = dreimal nachgeholt, immer noch null — DAS ist der Befund, den die
Pruefuebersicht zaehlt. Erwartung: leer, spaetestens eine Woche nach einem Ausfall.

Was die Sicht nicht sieht: einen Ausfall, der laenger dauert als das Fenster des
Artikelverkaufsberichts (21 Tage) — dann stehen beide auf null.';

-- ---------------------------------------------------------------------
-- 3. Die Klassifikation der Pflichtartikel, ohne den Rohnamen im Korn
--
-- Unveraendert gegenueber 0094 bis auf EINE Zeile: `ist` gruppiert auf
-- (konzept, gueltig_von, gueltig_bis, nr, nm) und nimmt den Rohnamen als
-- min(). Zwei Schreibweisen desselben Artikels ("Rapsöl 10L", "Rapsoel 10L")
-- sind EIN Artikel — so rechnen einkauf_basis und artikel_basis ohnehin,
-- die auf (nr, nm) joinen; mit zwei Klassifikationszeilen haetten sie die
-- Ausgaben doppelt gezaehlt.
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mart.pflichtartikel_klassifikation_basis CASCADE;

CREATE MATERIALIZED VIEW mart.pflichtartikel_klassifikation_basis AS
WITH fenster AS (
    SELECT DISTINCT konzept, gueltig_von, gueltig_bis
      FROM manual.pflichtartikel_liste
), soll AS (
    SELECT f.konzept, f.gueltig_von, f.gueltig_bis,
           p.artikelnummer, p.bezeichnung, p.lieferant, p.bereich,
           p.optional, p.nur_betriebe,
           core.artikel_name_norm(p.bezeichnung) AS bez_norm
      FROM fenster f
      JOIN manual.pflichtartikel p
        ON p.konzept = f.konzept AND p.gueltig_von = f.gueltig_von
), ist AS (
    -- Korn = (Konzept, Fenster, Nummer, normalisierter Name). Der Rohname
    -- ist Anzeige, nicht Schluessel: min() statt DISTINCT ueber ihn.
    SELECT f.konzept, f.gueltig_von, f.gueltig_bis,
           coalesce(bp.lieferanten_nr, '')      AS nr,
           core.artikel_name_norm(bp.name)      AS nm,
           min(bp.name)                         AS name_roh
      FROM core.bestellposition bp
      JOIN core.bestellung   b USING (bestellung_key)
      JOIN core.kostenstelle k USING (kostenstelle_key)
      JOIN core.marke        m ON m.marke_key = k.marke_key
      JOIN fenster f ON f.konzept = m.name
       AND b.bestellt_am::date >= f.gueltig_von
       AND b.bestellt_am::date <= coalesce(f.gueltig_bis, 'infinity'::date)
     WHERE b.status IS DISTINCT FROM 'canceled'
       AND k.betrieb_key IS NOT NULL
     GROUP BY 1, 2, 3, 4, 5
)
SELECT i.konzept, i.gueltig_von, i.gueltig_bis, i.nr, i.nm, i.name_roh,
       CASE WHEN dn.bezeichnung  IS NOT NULL THEN 'pflicht'
            WHEN al.gilt_fuer    IS NOT NULL THEN 'alias'
            WHEN no.bezeichnung  IS NOT NULL THEN 'pflicht_namentlich'
            WHEN mi.bezeichnung  IS NOT NULL THEN 'namensgleich'
            ELSE 'abseits' END AS zustand,
       coalesce(dn.bezeichnung, al.bezeichnung, no.bezeichnung, mi.bezeichnung) AS liste_bezeichnung,
       coalesce(dn.artikelnummer, al.gilt_fuer, mi.artikelnummer)               AS liste_nummer,
       coalesce(dn.lieferant, al.lieferant, no.lieferant, mi.lieferant)         AS liste_lieferant,
       coalesce(dn.bereich, al.bereich, no.bereich, mi.bereich)                 AS liste_bereich,
       coalesce(dn.optional, al.optional, no.optional, mi.optional, false)      AS optional,
       coalesce(dn.nur_betriebe, al.nur_betriebe, no.nur_betriebe, mi.nur_betriebe) AS nur_betriebe
  FROM ist i
  LEFT JOIN LATERAL (
      SELECT s.* FROM soll s
       WHERE s.konzept = i.konzept AND s.gueltig_von = i.gueltig_von
         AND s.artikelnummer = i.nr
       LIMIT 1) dn ON true
  LEFT JOIN LATERAL (
      SELECT s.*, a.gilt_fuer
        FROM manual.pflichtartikel_alias a
        JOIN soll s ON s.konzept = i.konzept AND s.gueltig_von = i.gueltig_von
                   AND s.artikelnummer = a.gilt_fuer
       WHERE a.konzept = i.konzept AND a.artikelnummer = i.nr
         AND (a.gilt_ab IS NULL OR a.gilt_ab <= i.gueltig_bis
              OR i.gueltig_bis IS NULL)
       LIMIT 1) al ON true
  LEFT JOIN LATERAL (
      SELECT s.* FROM soll s
       WHERE s.konzept = i.konzept AND s.gueltig_von = i.gueltig_von
         AND s.artikelnummer IS NULL
         AND length(s.bez_norm) >= 6
         AND (i.nm = s.bez_norm OR i.nm LIKE s.bez_norm || ' %')
       ORDER BY length(s.bez_norm) DESC
       LIMIT 1) no ON true
  LEFT JOIN LATERAL (
      SELECT s.* FROM soll s
       WHERE s.konzept = i.konzept AND s.gueltig_von = i.gueltig_von
         AND s.artikelnummer IS NOT NULL
         AND length(s.bez_norm) >= 6
         AND (i.nm = s.bez_norm OR i.nm LIKE s.bez_norm || ' %')
       ORDER BY length(s.bez_norm) DESC
       LIMIT 1) mi ON true;

CREATE UNIQUE INDEX pflichtartikel_klassifikation_korn
    ON mart.pflichtartikel_klassifikation_basis (konzept, gueltig_von, nr, nm);

COMMENT ON MATERIALIZED VIEW mart.pflichtartikel_klassifikation_basis IS
'Rechenstand: ein bestellter Artikel je Konzept und Gueltigkeitsfenster, mit
seinem Zustand gegen die Pflichtartikelliste. NICHT direkt abfragen — die Sicht
mart.pflichtartikel_klassifikation darueber traegt die Erklaerung.
Korn (konzept, gueltig_von, nr, nm); name_roh ist seit 0100 min() ueber alle
Schreibweisen — zwei Rohnamen desselben Artikels liessen den CONCURRENTLY-Refresh
vom 25.08. bis 10.09.2026 jede Nacht am Unique-Index scheitern.';

-- Die elf abhaengigen Sichten, wortgleich mit dem Stand nach 0099
-- (aus pg_get_viewdef der Datenbank gezogen, deshalb Postgres-Formatierung).
-- Einzige Aenderung: mart.pruefung_uebersicht traegt die Zeile zu Punkt 2.

-- ---- mart.pflichtartikel_artikel_basis (materialisiert, Abhaengigkeitstiefe 1) ----
CREATE MATERIALIZED VIEW mart.pflichtartikel_artikel_basis AS
 SELECT kl.konzept,
    kl.gueltig_von,
    k.betrieb_key,
    kl.nr,
    kl.nm,
    min(kl.name_roh) AS artikel,
    min(kl.zustand) AS zustand,
    min(kl.liste_bezeichnung) AS liste_bezeichnung,
    min(kl.liste_nummer) AS liste_nummer,
    min(kl.liste_lieferant) AS liste_lieferant,
    string_agg(DISTINCT l.name, ', '::text) AS lieferanten,
    count(*) AS positionen,
    sum(bp.summe_preis) AS ausgaben,
    min(b.bestellt_am)::date AS erste_bestellung,
    max(b.bestellt_am)::date AS letzte_bestellung
   FROM core.bestellposition bp
     JOIN core.bestellung b USING (bestellung_key)
     JOIN core.kostenstelle k USING (kostenstelle_key)
     JOIN core.marke m ON m.marke_key = k.marke_key
     LEFT JOIN core.lieferant l ON l.lieferant_key = b.lieferant_key
     JOIN mart.pflichtartikel_klassifikation_basis kl ON kl.konzept = m.name AND kl.nr = COALESCE(bp.lieferanten_nr, ''::text) AND kl.nm = core.artikel_name_norm(bp.name) AND b.bestellt_am::date >= kl.gueltig_von AND b.bestellt_am::date <= COALESCE(kl.gueltig_bis, 'infinity'::date)
  WHERE b.status IS DISTINCT FROM 'canceled'::text AND k.betrieb_key IS NOT NULL
  GROUP BY kl.konzept, kl.gueltig_von, k.betrieb_key, kl.nr, kl.nm;
CREATE UNIQUE INDEX pflichtartikel_artikel_korn ON mart.pflichtartikel_artikel_basis USING btree (konzept, gueltig_von, betrieb_key, nr, nm);
COMMENT ON MATERIALIZED VIEW mart.pflichtartikel_artikel_basis IS 'Rechenstand: ein Artikel je Betrieb im Fenster, mit Zustand und Ausgaben.
Traegt sowohl mart.pflichtartikel_abseits als auch mart.pflichtartikel_abdeckung.
NICHT direkt abfragen.';

-- ---- mart.pflichtartikel_einkauf_basis (materialisiert, Abhaengigkeitstiefe 1) ----
CREATE MATERIALIZED VIEW mart.pflichtartikel_einkauf_basis AS
 SELECT kl.konzept,
    kl.gueltig_von,
    k.betrieb_key,
    date_trunc('month'::text, b.bestellt_am)::date AS monat,
    kl.zustand,
    count(*) AS positionen,
    count(DISTINCT b.bestellung_key) AS bestellungen,
    count(DISTINCT (kl.nr || '|'::text) || kl.nm) AS artikel,
    sum(bp.summe_preis) AS ausgaben
   FROM core.bestellposition bp
     JOIN core.bestellung b USING (bestellung_key)
     JOIN core.kostenstelle k USING (kostenstelle_key)
     JOIN core.marke m ON m.marke_key = k.marke_key
     JOIN mart.pflichtartikel_klassifikation_basis kl ON kl.konzept = m.name AND kl.nr = COALESCE(bp.lieferanten_nr, ''::text) AND kl.nm = core.artikel_name_norm(bp.name) AND b.bestellt_am::date >= kl.gueltig_von AND b.bestellt_am::date <= COALESCE(kl.gueltig_bis, 'infinity'::date)
  WHERE b.status IS DISTINCT FROM 'canceled'::text AND k.betrieb_key IS NOT NULL
  GROUP BY kl.konzept, kl.gueltig_von, k.betrieb_key, (date_trunc('month'::text, b.bestellt_am)::date), kl.zustand;
CREATE UNIQUE INDEX pflichtartikel_einkauf_korn ON mart.pflichtartikel_einkauf_basis USING btree (konzept, gueltig_von, betrieb_key, monat, zustand);
COMMENT ON MATERIALIZED VIEW mart.pflichtartikel_einkauf_basis IS 'Rechenstand fuer mart.pflichtartikel_einkauf. NICHT direkt abfragen.';

-- ---- mart.pflichtartikel_klassifikation (Sicht, Abhaengigkeitstiefe 1) ----
CREATE OR REPLACE VIEW mart.pflichtartikel_klassifikation AS
 SELECT konzept,
    gueltig_von,
    gueltig_bis,
    NULLIF(nr, ''::text) AS artikelnummer,
    name_roh AS artikel,
    zustand,
    liste_bezeichnung,
    liste_nummer,
    liste_lieferant,
    liste_bereich,
    optional,
    nur_betriebe
   FROM mart.pflichtartikel_klassifikation_basis;
COMMENT ON VIEW mart.pflichtartikel_klassifikation IS 'Je bestelltem Artikel: steht er auf der Pflichtartikelliste des Konzepts?
Fuenf Zustaende. pflicht = Nummer steht auf der Liste. alias = Nummer wurde von
Hand einer Listennummer zugeordnet (Nachfolgenummer). pflicht_namentlich = die
Listenposition hat gar keine Nummer (GFGH-Getraenke), der Name trifft — das ist
dort der einzige moegliche Nachweis. namensgleich = der Name trifft eine
Listenposition, die Nummer weicht ab; das ist ein VERDACHT auf eine
Nachfolgenummer und zaehlt NICHT als erfuellt. abseits = nichts davon.';

-- ---- mart.pflichtartikel_abdeckung (Sicht, Abhaengigkeitstiefe 2) ----
CREATE OR REPLACE VIEW mart.pflichtartikel_abdeckung AS
 WITH betriebe AS (
         SELECT DISTINCT m.name AS konzept,
            k.betrieb_key
           FROM core.kostenstelle k
             JOIN core.marke m USING (marke_key)
          WHERE k.betrieb_key IS NOT NULL
        ), soll AS (
         SELECT l.konzept,
            l.gueltig_von,
            l.gueltig_bis,
            p.bereich,
            p.artikelnummer,
            p.bezeichnung,
            p.lieferant,
            p.optional,
            p.nur_betriebe
           FROM manual.pflichtartikel p
             JOIN manual.pflichtartikel_liste l ON l.konzept = p.konzept AND l.bereich = p.bereich AND l.gueltig_von = p.gueltig_von
          WHERE p.artikelnummer IS NOT NULL
        )
 SELECT s.konzept,
    bt.name AS betrieb,
    b.betrieb_key,
    s.gueltig_von,
    s.gueltig_bis,
    s.bereich,
    s.lieferant,
    s.artikelnummer,
    s.bezeichnung,
    s.optional,
    s.nur_betriebe,
    a.nr IS NOT NULL AS bezogen,
    COALESCE(a.positionen, 0::bigint) AS positionen,
    round(COALESCE(a.ausgaben, 0::numeric), 2) AS ausgaben,
    a.letzte_bestellung,
        CASE
            WHEN COALESCE(pb.bestellungen, 0::numeric) = 0::numeric THEN 'keine Bestellung'::text
            WHEN pb.bestellungen < 10::numeric OR pb.ausgaben < 5000::numeric THEN 'duenn'::text
            ELSE 'belastbar'::text
        END AS datenbasis
   FROM soll s
     JOIN betriebe b ON b.konzept = s.konzept
     JOIN core.betrieb bt ON bt.betrieb_key = b.betrieb_key
     LEFT JOIN mart.pflichtartikel_artikel_basis a ON a.konzept = s.konzept AND a.gueltig_von = s.gueltig_von AND a.betrieb_key = b.betrieb_key AND (a.nr = s.artikelnummer OR a.liste_nummer = s.artikelnummer)
     LEFT JOIN LATERAL ( SELECT sum(e.bestellungen) AS bestellungen,
            sum(e.ausgaben) AS ausgaben
           FROM mart.pflichtartikel_einkauf_basis e
          WHERE e.konzept = s.konzept AND e.betrieb_key = b.betrieb_key AND e.gueltig_von = s.gueltig_von) pb ON true
  WHERE s.nur_betriebe IS NULL OR (EXISTS ( SELECT 1
           FROM mart.pflichtartikel_regional r
          WHERE r.konzept = s.konzept AND r.bezeichnung = s.bezeichnung AND r.betrieb_key = b.betrieb_key)) OR (EXISTS ( SELECT 1
           FROM mart.pflichtartikel_regional_offen o
          WHERE o.konzept = s.konzept AND o.bezeichnung = s.bezeichnung));
COMMENT ON VIEW mart.pflichtartikel_abdeckung IS 'Eine Zeile je Betrieb und Pflichtartikel mit Nummer: wurde er im
Gueltigkeitszeitraum bezogen? bezogen = false ist der fehlende Artikel.

IMMER ZUSAMMEN MIT datenbasis LESEN. "keine Bestellung" heisst, dass der Betrieb
im Laufzeitraum gar nichts bestellt hat — fuer ihn fehlt zwangslaeufig JEDER
Pflichtartikel, und das ist keine Aussage ueber sein Sortiment. Am 22.08.2026
stammten 1.503 von 4.669 Fehlmeldungen aus sieben solchen Betrieben.

Positionen ohne Artikelnummer fehlen hier bewusst — sie sind ueber die Nummer
nicht pruefbar und stehen in mart.pflichtartikel_nicht_pruefbar.

Regionale Gerichte gelten nur an den Standorten, die die Vorlage nennt
(mart.pflichtartikel_regional). Laesst sich die Ortsangabe nicht aufloesen,
gilt der Artikel vorsorglich fuer alle — sichtbar in
mart.pflichtartikel_regional_offen.

Wer nach einem Artikel sucht, den KEIN Betrieb fuehrt, gruppiert nach
bezeichnung UND klammert datenbasis = ''keine Bestellung'' aus: das ist dann
kein Betriebsproblem, sondern eine veraltete Liste.';
COMMENT ON COLUMN mart.pflichtartikel_abdeckung.datenbasis IS 'belastbar = mindestens zehn Bestellungen und 5.000 EUR im Laufzeitraum.
duenn = weniger. keine Bestellung = der Betrieb hat im Laufzeitraum gar nichts
bestellt; seine Fehlmeldungen sind keine Aussage.';

-- ---- mart.pflichtartikel_abseits (Sicht, Abhaengigkeitstiefe 2) ----
CREATE OR REPLACE VIEW mart.pflichtartikel_abseits AS
 SELECT a.konzept,
    bt.name AS betrieb,
    a.betrieb_key,
    NULLIF(a.nr, ''::text) AS artikelnummer,
    a.artikel,
    a.lieferanten AS lieferant,
    a.positionen,
    round(a.ausgaben, 2) AS ausgaben,
    a.erste_bestellung,
    a.letzte_bestellung
   FROM mart.pflichtartikel_artikel_basis a
     JOIN core.betrieb bt USING (betrieb_key)
  WHERE a.zustand = 'abseits'::text;
COMMENT ON VIEW mart.pflichtartikel_abseits IS 'Was ein Betrieb gekauft hat, das auf keiner Pflichtartikelliste seines
Konzepts steht — nach Ausgaben die Arbeitsliste hinter der Quote.

Zum Lesen gehoert die Gegenprobe: die Listen fuehren keinen Reinigungs- und
Verpackungsbedarf und keine Weine ausser den genannten. Steht so etwas oben,
ist es kein Verstoss, sondern eine Luecke der Liste.';

-- ---- mart.pflichtartikel_betrieb (Sicht, Abhaengigkeitstiefe 2) ----
CREATE OR REPLACE VIEW mart.pflichtartikel_betrieb AS
 WITH je_betrieb AS (
         SELECT e.konzept,
            e.betrieb_key,
            e.gueltig_von,
            min(e.monat) AS von_monat,
            max(e.monat) AS bis_monat,
            sum(e.ausgaben) AS ausgaben,
            sum(e.bestellungen) AS bestellungen,
            sum(e.ausgaben) FILTER (WHERE e.zustand = ANY (ARRAY['pflicht'::text, 'alias'::text, 'pflicht_namentlich'::text])) AS ausgaben_pflicht,
            sum(e.ausgaben) FILTER (WHERE e.zustand = 'namensgleich'::text) AS ausgaben_namensgleich,
            sum(e.ausgaben) FILTER (WHERE e.zustand = 'abseits'::text) AS ausgaben_abseits
           FROM mart.pflichtartikel_einkauf_basis e
          GROUP BY e.konzept, e.betrieb_key, e.gueltig_von
        )
 SELECT j.konzept,
    bt.name AS betrieb,
    j.betrieb_key,
    j.von_monat,
    j.bis_monat,
    j.bestellungen,
    round(j.ausgaben, 2) AS ausgaben,
    round(COALESCE(j.ausgaben_pflicht, 0::numeric), 2) AS ausgaben_pflicht,
    round(COALESCE(j.ausgaben_abseits, 0::numeric), 2) AS ausgaben_abseits,
    round(100.0 * COALESCE(j.ausgaben_pflicht, 0::numeric) / NULLIF(j.ausgaben, 0::numeric), 1) AS pflicht_pct,
    round(100.0 * COALESCE(j.ausgaben_namensgleich, 0::numeric) / NULLIF(j.ausgaben, 0::numeric), 1) AS namensgleich_pct,
    round(100.0 * COALESCE(j.ausgaben_abseits, 0::numeric) / NULLIF(j.ausgaben, 0::numeric), 1) AS abseits_pct,
    rank() OVER (PARTITION BY j.konzept ORDER BY (COALESCE(j.ausgaben_abseits, 0::numeric) / NULLIF(j.ausgaben, 0::numeric)) DESC NULLS LAST) AS rang_im_konzept,
        CASE
            WHEN j.bestellungen IS NULL OR j.bestellungen = 0::numeric THEN 'keine Bestellung'::text
            WHEN j.bestellungen < 10::numeric OR j.ausgaben < 5000::numeric THEN 'duenn'::text
            ELSE 'belastbar'::text
        END AS datenbasis
   FROM je_betrieb j
     JOIN core.betrieb bt USING (betrieb_key);
COMMENT ON VIEW mart.pflichtartikel_betrieb IS 'Die Rangliste: welcher Anteil des Einkaufs laeuft an der Pflichtartikelliste
vorbei. abseits_pct ist die Leitzahl, gerechnet auf die AUSGABEN und nicht auf
die Artikelzahl.

Immer zusammen mit datenbasis lesen: "duenn" heisst weniger als zehn
Bestellungen oder weniger als 5.000 EUR im Fenster — dort ist der Prozentwert
richtig gerechnet und trotzdem keine Aussage.

namensgleich_pct ist die Unschaerfe: Artikel, deren Name auf der Liste steht
und deren Nummer nicht. Solange diese Zahl gross ist, ist abseits_pct eine
Obergrenze. Was dahintersteckt, zeigt mart.pflichtartikel_verdacht.';

-- ---- mart.pflichtartikel_einkauf (Sicht, Abhaengigkeitstiefe 2) ----
CREATE OR REPLACE VIEW mart.pflichtartikel_einkauf AS
 SELECT e.konzept,
    bt.name AS betrieb,
    e.betrieb_key,
    e.monat,
    e.zustand,
    e.positionen,
    e.bestellungen,
    e.artikel,
    round(e.ausgaben, 2) AS ausgaben
   FROM mart.pflichtartikel_einkauf_basis e
     JOIN core.betrieb bt USING (betrieb_key);
COMMENT ON VIEW mart.pflichtartikel_einkauf IS 'Einkauf je Betrieb und Monat, aufgeteilt nach dem Zustand gegen die
Pflichtartikelliste. Nur Monate innerhalb der Listenlaufzeit — eine Bestellung
wird gegen die Liste geprueft, die am Bestelltag galt.';

-- ---- mart.pflichtartikel_nicht_pruefbar (Sicht, Abhaengigkeitstiefe 2) ----
CREATE OR REPLACE VIEW mart.pflichtartikel_nicht_pruefbar AS
 SELECT p.konzept,
    p.bereich,
    p.lieferant,
    p.bezeichnung,
    p.rubrik,
    length(core.artikel_name_norm(p.bezeichnung)) >= 6 AS namensabgleich_moeglich,
    COALESCE(t.betriebe, 0::bigint) AS betriebe_mit_treffer,
    round(COALESCE(t.ausgaben, 0::numeric), 2) AS ausgaben,
        CASE
            WHEN length(core.artikel_name_norm(p.bezeichnung)) < 6 THEN 'Name zu kurz fuer den Abgleich'::text
            WHEN COALESCE(t.betriebe, 0::bigint) = 0 THEN 'kein Treffer — Nummer nachtragen'::text
            ELSE 'ueber den Namen erkannt'::text
        END AS zustand
   FROM manual.pflichtartikel p
     LEFT JOIN LATERAL ( SELECT count(DISTINCT a.betrieb_key) AS betriebe,
            sum(a.ausgaben) AS ausgaben
           FROM mart.pflichtartikel_artikel_basis a
          WHERE a.konzept = p.konzept AND a.zustand = 'pflicht_namentlich'::text AND a.liste_bezeichnung = p.bezeichnung) t ON true
  WHERE p.artikelnummer IS NULL;
COMMENT ON VIEW mart.pflichtartikel_nicht_pruefbar IS 'Pflichtartikel ohne Artikelnummer — ueberwiegend GFGH-Getraenke, bei denen
jeder Betrieb einen eigenen Nummernkreis hat. Fuer sie ist der Namensabgleich
der einzige Nachweis.

"kein Treffer" heisst NICHT "wird nicht gefuehrt": es kann ebenso gut heissen,
dass der Haendler den Artikel anders schreibt. Erst die nachgetragene Nummer in
pflege/pflichtartikel.csv macht daraus eine Messung.';

-- ---- mart.pflichtartikel_verdacht (Sicht, Abhaengigkeitstiefe 2) ----
CREATE OR REPLACE VIEW mart.pflichtartikel_verdacht AS
 SELECT konzept,
    NULLIF(nr, ''::text) AS bestellte_nummer,
    artikel AS bestellter_artikel,
    liste_nummer AS nummer_auf_liste,
    liste_bezeichnung AS bezeichnung_auf_liste,
    liste_lieferant AS lieferant_auf_liste,
    count(DISTINCT betrieb_key) AS betriebe,
    sum(positionen) AS positionen,
    round(sum(ausgaben), 2) AS ausgaben,
    max(letzte_bestellung) AS letzte_bestellung
   FROM mart.pflichtartikel_artikel_basis a
  WHERE zustand = 'namensgleich'::text
  GROUP BY konzept, (NULLIF(nr, ''::text)), artikel, liste_nummer, liste_bezeichnung, liste_lieferant;
COMMENT ON VIEW mart.pflichtartikel_verdacht IS 'Artikel, deren NAME eine Listenposition trifft, deren NUMMER aber abweicht —
der Verdacht auf eine Nachfolgenummer. Zaehlt bewusst NICHT als erfuellt.

Wer eine Zeile bestaetigt, traegt sie in pflege/pflichtartikel_alias.csv ein;
ab dem naechsten Lauf zaehlt der Artikel als Pflichtartikel. Anlass war Distra
268 "Cheddar / Gouda Mix", seit 15.11.2025 unter 500096 gefuehrt.';

-- ---- mart.pruefung_pflichtartikel (Sicht, Abhaengigkeitstiefe 3) ----
CREATE OR REPLACE VIEW mart.pruefung_pflichtartikel AS
 SELECT 'Pflichtartikel: ueberlappende Listen'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM manual.pflichtartikel_liste) AS geprueft,
    count(*) AS auffaellig,
    'mart.pflichtartikel_ueberlappung'::text AS sicht
   FROM mart.pflichtartikel_ueberlappung
UNION ALL
 SELECT 'Pflichtartikel: regionale Angabe ohne Betrieb'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM manual.pflichtartikel
          WHERE pflichtartikel.nur_betriebe IS NOT NULL) AS geprueft,
    count(*) AS auffaellig,
    'mart.pflichtartikel_regional_offen'::text AS sicht
   FROM mart.pflichtartikel_regional_offen
UNION ALL
 SELECT 'Pflichtartikel: Liste laeuft in weniger als 30 Tagen aus'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE pflichtartikel_liste.gueltig_bis IS NOT NULL AND pflichtartikel_liste.gueltig_bis < (CURRENT_DATE + 30)) AS auffaellig,
    'mart.pflichtartikel_stand'::text AS sicht
   FROM manual.pflichtartikel_liste
UNION ALL
 SELECT 'Pflichtartikel: Nachfolgenummer unbestaetigt (ueber 10.000 EUR)'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM mart.pflichtartikel_verdacht pflichtartikel_verdacht_1) AS geprueft,
    count(*) FILTER (WHERE pflichtartikel_verdacht.ausgaben > 10000::numeric) AS auffaellig,
    'mart.pflichtartikel_verdacht'::text AS sicht
   FROM mart.pflichtartikel_verdacht;
COMMENT ON VIEW mart.pruefung_pflichtartikel IS 'Vier Pruefzeilen zur Pflichtartikelauswertung. Die dritte ist die stille: eine
ausgelaufene Liste erzeugt keinen Fehler, sondern eine leere Seite — und die
sieht aus wie "nichts zu beanstanden".';

-- ---- mart.pruefung_uebersicht (Sicht, Abhaengigkeitstiefe 4) ----
CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS
 SELECT 'Umsatz: Artikelsumme vs. Umsatzbericht'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE pruefung_umsatz.auffaellig) AS auffaellig,
    'mart.pruefung_umsatz'::text AS sicht
   FROM mart.pruefung_umsatz
UNION ALL
 SELECT 'Bon: avgTicket vs. Umsatz/Rechnungen'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE pruefung_bon.auffaellig) AS auffaellig,
    'mart.pruefung_bon'::text AS sicht
   FROM mart.pruefung_bon
UNION ALL
 SELECT 'Zulauf: Quelle ohne Zulauf in ihrer Kadenz'::text AS pruefung,
    count(*) FILTER (WHERE quelle_zulauf.erwartet) AS geprueft,
    count(*) FILTER (WHERE quelle_zulauf.erwartet AND (quelle_zulauf.zustand = ANY (ARRAY['stumm'::text, 'nie'::text]))) AS auffaellig,
    'mart.quelle_zulauf'::text AS sicht
   FROM mart.quelle_zulauf
UNION ALL
 SELECT 'Zulauf: Quelle wird nicht mehr abgefragt'::text AS pruefung,
    count(*) FILTER (WHERE quelle_zulauf.erwartet) AS geprueft,
    count(*) FILTER (WHERE quelle_zulauf.erwartet AND NOT quelle_zulauf.wird_noch_gefragt) AS auffaellig,
    'mart.quelle_zulauf'::text AS sicht
   FROM mart.quelle_zulauf
UNION ALL
 SELECT 'Belegarchiv: Ordner ohne den faelligen Abzug'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand = 'abzug fehlt'::text) AS auffaellig,
    'mart.belegarchiv_zulauf'::text AS sicht
   FROM mart.belegarchiv_zulauf
UNION ALL
 SELECT 'Belegarchiv: Zaehlung ueberfaellig (Takt je Freigabe)'::text AS pruefung,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand <> 'kein belegarchiv'::text) AS geprueft,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand <> 'kein belegarchiv'::text AND (belegarchiv_zulauf.zuletzt_gezaehlt IS NULL OR belegarchiv_zulauf.zuletzt_gezaehlt < (now() -
        CASE
            WHEN belegarchiv_zulauf.inhalt_holen THEN '10 days'::interval
            ELSE '36 days'::interval
        END))) AS auffaellig,
    'mart.belegarchiv_zulauf'::text AS sicht
   FROM mart.belegarchiv_zulauf
UNION ALL
 SELECT 'Belegarchiv: Betrieb ohne Belegarchiv'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand = 'kein belegarchiv'::text) AS auffaellig,
    'mart.belegarchiv_zulauf'::text AS sicht
   FROM mart.belegarchiv_zulauf
UNION ALL
 SELECT 'Belegarchiv: Belegdatum spaeter als der eigene Upload'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM core.buchungsbeleg) AS geprueft,
    count(*) AS auffaellig,
    'mart.belegdatum_ausreisser'::text AS sicht
   FROM mart.belegdatum_ausreisser
UNION ALL
 SELECT 'Inventur: Zaehlung abgeschnitten'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM core.inventur
          WHERE inventur.anzahl_positionen IS NOT NULL) AS geprueft,
    count(*) AS auffaellig,
    'mart.inventur_abgeschnitten'::text AS sicht
   FROM mart.inventur_abgeschnitten
UNION ALL
 SELECT 'Inventur: Position ueber 50.000 EUR (aus dem Schwund genommen)'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM core.inventurposition) AS geprueft,
    COALESCE(sum(inventur_schwund.positionen_unplausibel), 0::numeric)::bigint AS auffaellig,
    'mart.inventur_schwund'::text AS sicht
   FROM mart.inventur_schwund
UNION ALL
 SELECT 'Bestellung: Kopf ohne eine einzige Position'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE NOT (EXISTS ( SELECT 1
           FROM core.bestellposition p
          WHERE p.bestellung_key = b.bestellung_key))) AS auffaellig,
    'core.bestellung'::text AS sicht
   FROM core.bestellung b
UNION ALL
 SELECT 'Einkauf: Kostenstelle ohne Betrieb, mit Bestellungen'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE NOT kostenstelle_ohne_betrieb.testbetrieb AND kostenstelle_ohne_betrieb.bestellungen > 0) AS auffaellig,
    'mart.kostenstelle_ohne_betrieb'::text AS sicht
   FROM mart.kostenstelle_ohne_betrieb
UNION ALL
 SELECT 'Nachzuegler: Aenderungen am Rand des Fensters'::text AS pruefung,
    count(DISTINCT nachzuegler_tiefe.endpunkt) AS geprueft,
    count(DISTINCT nachzuegler_tiefe.endpunkt) FILTER (WHERE nachzuegler_tiefe.am_rand_noch_aenderungen) AS auffaellig,
    'mart.nachzuegler_tiefe'::text AS sicht
   FROM mart.nachzuegler_tiefe
UNION ALL
 SELECT 'Einkauf: Bestellseiten aus einem frueheren Lauf offen'::text AS pruefung,
    count(DISTINCT einkauf_ladestand.marke) AS geprueft,
    count(DISTINCT einkauf_ladestand.marke) FILTER (WHERE einkauf_ladestand.seiten_rueckstand > 0) AS auffaellig,
    'mart.einkauf_ladestand'::text AS sicht
   FROM mart.einkauf_ladestand
UNION ALL
 SELECT 'Einkauf: 403 auf einem EIGENEN Betrieb'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE posten_ohne_zugriff.eigener_betrieb) AS auffaellig,
    'mart.posten_ohne_zugriff'::text AS sicht
   FROM mart.posten_ohne_zugriff
UNION ALL
 SELECT 'Umsatz: Monat mit mehr als 10 % nicht aufteilbarem Umsatz'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE hauptsparte_abdeckung.nicht_aufteilbar_pct > 10::numeric) AS auffaellig,
    'mart.hauptsparte_abdeckung'::text AS sicht
   FROM mart.hauptsparte_abdeckung
UNION ALL
 SELECT 'Yext: operativer Betrieb mit Umsatz, aber ohne Zuordnung'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM mart.betrieb_status
          WHERE betrieb_status.status = 'operativ'::text) AS geprueft,
    count(*) FILTER (WHERE betrieb_ohne_yext.status = 'operativ'::text AND betrieb_ohne_yext.macht_umsatz) AS auffaellig,
    'mart.betrieb_ohne_yext'::text AS sicht
   FROM mart.betrieb_ohne_yext
UNION ALL
 SELECT 'Yext: Vollabgleich aelter als 45 Tage'::text AS pruefung,
    count(*) FILTER (WHERE yext_abgleich.schluessel = 'yext_letzter_vollabgleich'::text) AS geprueft,
    count(*) FILTER (WHERE yext_abgleich.schluessel = 'yext_letzter_vollabgleich'::text AND yext_abgleich.tage_her > 45::numeric) AS auffaellig,
    'mart.yext_abgleich'::text AS sicht
   FROM mart.yext_abgleich
UNION ALL
 SELECT 'Yext: Sichtbarkeitszeile ohne eintraege_live'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE betrieb_sichtbarkeit.eintraege_live IS NULL) AS auffaellig,
    'core.betrieb_sichtbarkeit'::text AS sicht
   FROM core.betrieb_sichtbarkeit
UNION ALL
 SELECT 'Handpflege: Datei abgewiesen'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM sync.pflege_import) AS geprueft,
    count(*) FILTER (WHERE pflege_stand.zustand = 'abgewiesen'::text) AS auffaellig,
    'mart.pflege_stand'::text AS sicht
   FROM mart.pflege_stand
UNION ALL
 SELECT 'Handpflege: Tabelle veraltet oder laeuft aus'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE pflege_stand.zustand = ANY (ARRAY['veraltet'::text, 'laeuft bald aus'::text])) AS auffaellig,
    'mart.pflege_stand'::text AS sicht
   FROM mart.pflege_stand
UNION ALL
 SELECT 'Round Table: operativer Betrieb ohne vollstaendige Signale (Vorvormonat)'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM mart.round_table_basis
          WHERE round_table_basis.operativ AND round_table_basis.monat = (date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) - '2 mons'::interval)::date) AS geprueft,
    count(*) FILTER (WHERE round_table_unvollstaendig.operativ AND round_table_unvollstaendig.monat = (date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) - '2 mons'::interval)::date) AS auffaellig,
    'mart.round_table_unvollstaendig'::text AS sicht
   FROM mart.round_table_unvollstaendig
UNION ALL
 SELECT 'Warteschlange: endgueltig aufgegeben'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE posten_aufgegeben.zustand = 'endgueltig'::text) AS auffaellig,
    'mart.posten_aufgegeben'::text AS sicht
   FROM mart.posten_aufgegeben
UNION ALL
 SELECT pruefung_kalender.pruefung,
    pruefung_kalender.geprueft,
    pruefung_kalender.auffaellig,
    pruefung_kalender.sicht
   FROM mart.pruefung_kalender
UNION ALL
 SELECT pruefung_materialisierung.pruefung,
    pruefung_materialisierung.geprueft,
    pruefung_materialisierung.auffaellig,
    pruefung_materialisierung.sicht
   FROM mart.pruefung_materialisierung
UNION ALL
 SELECT pruefung_pflichtartikel.pruefung,
    pruefung_pflichtartikel.geprueft,
    pruefung_pflichtartikel.auffaellig,
    pruefung_pflichtartikel.sicht
   FROM mart.pruefung_pflichtartikel
UNION ALL
 SELECT pruefung_bounti.pruefung,
    pruefung_bounti.geprueft,
    pruefung_bounti.auffaellig,
    pruefung_bounti.sicht
   FROM mart.pruefung_bounti
UNION ALL
 SELECT pruefung_bestelldetail.pruefung,
    pruefung_bestelldetail.geprueft,
    pruefung_bestelldetail.auffaellig,
    pruefung_bestelldetail.sicht
   FROM mart.pruefung_bestelldetail
UNION ALL
 SELECT 'Umsatz: Nulltag mit Artikelverkauf ausserhalb des Fensters (3x nachgeholt, bleibt null)'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE umsatztag_luecke.zustand = 'aufgegeben') AS auffaellig,
    'mart.umsatztag_luecke'::text AS sicht
   FROM mart.umsatztag_luecke;
COMMENT ON VIEW mart.pruefung_uebersicht IS 'Erste Abfrage nach jedem groesseren Backfill: SELECT * FROM mart.pruefung_uebersicht;
Die Spalte auffaellig ist eine Arbeitsliste, kein Alarm.

Am 13.08.2026 sind sechs Zulaufpruefungen dazugekommen, alle aus demselben Anlass: eine
Quelle ohne Zulauf ist ein Fehler und kein Normalzustand, und der Lauf hat sie zweimal als
"ok" gemeldet (AGENTS.md Regel 10). Was sie beim Anlegen zeigten:

  Belegarchiv: Ordner ohne den faelligen Abzug       0 von 1.974
  Belegarchiv: seit ueber 36 h nicht gezaehlt        0 von 1.974 (nach dem fertigen Lauf 89)
  Belegarchiv: Betrieb ohne Belegarchiv              0 von 1.974 — alle 141 Betriebe haben
                                                     eines; die Zeile ist vorbeugend
  Inventur: Zaehlung abgeschnitten                   0 von 358 (vor 0069: 9)
  Bestellung: Kopf ohne eine einzige Position       47 von 66.966 (vor 0070: 322)
  Bestellung: Details im Fenster aelter als 48 h  2.981 von 2.981 — beim Anlegen ist das
                                                     der GANZE Bestand des Fensters, weil
                                                     bis dahin keine Bestellung je erneut
                                                     geholt wurde. Nach dem ersten Lauf mit
                                                     0072 muss die Zahl 0 sein
  Warteschlange: endgueltig aufgegeben               0 von 0 (vor 0070: 275 aufgegeben)

ZWEI ZEILEN LESEN SICH ANDERS ALS DIE UEBRIGEN.

"Betrieb ohne Belegarchiv" erwartet KONSTANZ, nicht null. Die Zahl ist eine Eigenschaft des
Bestands, kein Rueckstand; interessant ist allein, wenn sie sich aendert.

"Warteschlange: endgueltig aufgegeben" zaehlt AUSDRUECKLICH nur die endgueltigen. Ein
aufgegebener Posten, den der Lauf noch dreimal zurueckholt, ist Betrieb und kein Befund — wer
beides in eine Zahl wirft, bekommt eine Kachel, die immer rot ist und die deshalb niemand
mehr ansieht.

Die Zeile "Wareneinsatz: Abdeckung unter 90 %" ist am 01.08.2026 entfallen (Migration 0029).
Sie hat nie ausgeloest, weil ihr Filter auf IS NOT NULL prueft und fixer_we nie NULL ist,
sondern 0. Ein Waechter, der immer gruen zeigt, ist schlimmer als keiner.';

-- ---------------------------------------------------------------------
-- 4. Fuenf dokumentierte Ueberlaeufe quittieren
-- ---------------------------------------------------------------------
UPDATE sync.schema_abweichung
   SET quittiert_am = now()
 WHERE quittiert_am IS NULL
   AND erkannt_am < DATE '2026-08-02'
   AND endpunkt IN ('getUmsatzbericht', 'getArtikelverkaufsbericht')
   AND tatsaechlich ? 'verworfen';
