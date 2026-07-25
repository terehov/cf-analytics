-- =====================================================================
-- Partitionen, Ampellogik und Metabase-Sichten
-- =====================================================================

-- ---------------------------------------------------------------------
-- Partitionsverwaltung
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.partition_anlegen(p_tabelle regclass, p_monat date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_von     date := date_trunc('month', p_monat)::date;
    v_bis     date := (date_trunc('month', p_monat) + interval '1 month')::date;
    v_schema  text := split_part(p_tabelle::text, '.', 1);
    v_basis   text := split_part(p_tabelle::text, '.', 2);
    v_name    text := format('%s_%s', v_basis, to_char(v_von,'YYYY_MM'));
    v_datumsspalte text := CASE WHEN v_basis = 'api_antwort' THEN 'abgerufen_am' ELSE 'geschaeftstag' END;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE c.relname = v_name AND n.nspname = v_schema) THEN
        EXECUTE format('CREATE TABLE %I.%I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
                       v_schema, v_name, p_tabelle::text, v_von, v_bis);
        -- BRIN gleich mit autosummarize: ohne das bleiben frisch angehaengte
        -- Bloecke bis zum naechsten VACUUM unsummiert - also genau die Zeilen,
        -- die eine Round-Table-Auswertung am haeufigsten liest.
        EXECUTE format('CREATE INDEX ON %I.%I USING brin (%I) WITH (autosummarize = on)',
                       v_schema, v_name, v_datumsspalte);
    END IF;
END $$;

COMMENT ON FUNCTION core.partition_anlegen IS
'Legt bei Bedarf die Monatspartition an, inklusive BRIN-Index mit autosummarize.
Der Importer ruft das vor dem Schreiben auf - so gibt es keinen Wartungsjob, den man vergessen kann.
Hinweis: Storage-Parameter lassen sich NICHT auf dem partitionierten Index setzen
("This operation is not supported for partitioned indexes"), nur je Kindindex.';

-- Partitionen fuer Backfill ab 2021 plus Vorlauf
DO $$
DECLARE d date := date '2021-01-01';
BEGIN
    WHILE d < date '2028-01-01' LOOP
        PERFORM core.partition_anlegen('core.artikelverkauf_tag', d);
        PERFORM core.partition_anlegen('raw.api_antwort', d);
        d := (d + interval '1 month')::date;
    END LOOP;
END $$;

-- artikel_key ist hochkardinal und braucht einen eigenen Index
-- ("wie lief Artikel X ueber die Zeit"). betrieb_key nicht: dafuer greift
-- Skip Scan auf dem PK, siehe Kommentar an der Tabelle.
CREATE INDEX ON core.artikelverkauf_tag (artikel_key, geschaeftstag);


-- ---------------------------------------------------------------------
-- Ampellogik
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ampel.bewerte(
    p_wert          numeric,
    p_bereich       text,
    p_regelwerk     text    DEFAULT NULL,
    p_betrieb_key   integer DEFAULT NULL,
    p_stichtag      date    DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r           ampel.regel%ROWTYPE;
    v_regelwerk text;
    v_gruen     numeric;
    v_orange    numeric;
BEGIN
    IF p_wert IS NULL THEN RETURN NULL; END IF;

    v_regelwerk := COALESCE(p_regelwerk,
                            (SELECT regelwerk_key FROM ampel.regelwerk WHERE ist_standard LIMIT 1));

    SELECT * INTO r FROM ampel.regel
     WHERE regelwerk_key = v_regelwerk AND bereich = p_bereich;
    IF NOT FOUND THEN RETURN NULL; END IF;

    IF r.schwellenquelle = 'lina_betrieb' THEN
        SELECT s.schwelle_gruen, s.schwelle_orange INTO v_gruen, v_orange
          FROM core.schwellenwert_betrieb s
         WHERE s.betrieb_key = p_betrieb_key
           AND s.bereich     = p_bereich
           AND (p_stichtag IS NULL OR s.gueltig_ab <= p_stichtag)
         ORDER BY s.gueltig_ab DESC
         LIMIT 1;
    END IF;

    -- Rueckfall auf die festen Werte der Regel, wenn LINA nichts liefert
    v_gruen  := COALESCE(v_gruen,  r.schwelle_gruen);
    v_orange := COALESCE(v_orange, r.schwelle_orange);
    IF v_gruen IS NULL OR v_orange IS NULL THEN RETURN NULL; END IF;

    IF r.richtung = 'niedriger_ist_besser' THEN
        IF p_wert <= v_gruen  THEN RETURN 'gruen';  END IF;
        IF p_wert <= v_orange THEN RETURN 'orange'; END IF;
        RETURN 'rot';
    ELSE
        IF p_wert >= v_gruen  THEN RETURN 'gruen';  END IF;
        IF p_wert >= v_orange THEN RETURN 'orange'; END IF;
        RETURN 'rot';
    END IF;
END $$;

COMMENT ON FUNCTION ampel.bewerte IS
'Bewertet einen Wert gegen ein Regelwerk. Ohne p_regelwerk gilt das Standardregelwerk.
Bei schwellenquelle=lina_betrieb werden die betriebsindividuellen Schwellen gezogen,
mit Rueckfall auf die festen.';


-- Gesamtstatus wie im Excel: ein Rot faerbt alles rot.
CREATE OR REPLACE FUNCTION ampel.gesamt(p_status text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN cardinality(array_remove(p_status, NULL)) = 0 THEN NULL
        WHEN 'rot'    = ANY(p_status) THEN 'rot'
        WHEN 'orange' = ANY(p_status) THEN 'orange'
        ELSE 'gruen'
    END;
$$;

CREATE OR REPLACE FUNCTION ampel.intensitaet(p_status text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN cardinality(array_remove(p_status, NULL)) = 0 THEN NULL
        WHEN (SELECT count(*) FROM unnest(p_status) s WHERE s = 'rot')    >= 2 THEN 'Sofort eskalieren'
        WHEN (SELECT count(*) FROM unnest(p_status) s WHERE s = 'rot')    =  1 THEN 'Sofort handeln'
        WHEN (SELECT count(*) FROM unnest(p_status) s WHERE s = 'orange') >= 2 THEN 'Nachforschung'
        ELSE 'Beobachten/OK'
    END;
$$;

COMMENT ON FUNCTION ampel.intensitaet IS 'Eskalationsstufe wie im Excel: >=2 Rot eskalieren, 1 Rot handeln, >=2 Orange nachforschen, sonst beobachten.';


-- ---------------------------------------------------------------------
-- MART — Sichten fuer Metabase
-- ---------------------------------------------------------------------

-- Aktueller BWA-Stand je Betrieb/Monat/Kennzahl
CREATE VIEW mart.kennzahlen_aktuell AS
SELECT DISTINCT ON (betrieb_key, monat, kennzahl)
       betrieb_key, monat, kennzahl, wert_absolut, wert_prozent, abgerufen_am
  FROM core.kennzahlen_monat
 ORDER BY betrieb_key, monat, kennzahl, abgerufen_am DESC;

COMMENT ON VIEW mart.kennzahlen_aktuell IS
'Juengster bekannter BWA-Stand. Fuer "was wussten wir am Stichtag X" stattdessen direkt
core.kennzahlen_monat mit abgerufen_am <= X abfragen.';

-- Auswahlliste fuer den Metabase-Dropdown
CREATE VIEW mart.regelwerk AS
SELECT regelwerk_key, name, beschreibung, ist_standard
  FROM ampel.regelwerk
 ORDER BY ist_standard DESC, name;

COMMENT ON VIEW mart.regelwerk IS
'Auswahlliste der Regelwerke. In Metabase als Quelle fuer den Dropdown-Parameter der
Round-Table-Frage hinterlegen, dann ist das Umschalten ein Klick in der Oberflaeche.';

-- Betriebsuebersicht fuer das Drill-Down
CREATE VIEW mart.betrieb AS
SELECT b.betrieb_key, b.enc_id, b.name AS betrieb, b.stadt, b.aktiv, b.hat_bwa,
       string_agg(k.name, ', ' ORDER BY k.name) AS konzepte
  FROM core.betrieb b
  LEFT JOIN core.betrieb_konzept bk ON bk.betrieb_key = b.betrieb_key
  LEFT JOIN core.konzept k          ON k.konzept_key  = bk.konzept_key
 GROUP BY b.betrieb_key, b.enc_id, b.name, b.stadt, b.aktiv, b.hat_bwa;

-- Gesundheit des letzten Laufs — erste Anlaufstelle in Postico
CREATE VIEW mart.sync_status AS
SELECT l.lauf_id, l.gestartet_am, l.beendet_am, l.ausloeser, l.status,
       l.aufgaben_gesamt, l.aufgaben_ok, l.aufgaben_fehler, l.aufgaben_uebersprungen,
       round(EXTRACT(epoch FROM (l.beendet_am - l.gestartet_am))::numeric, 1) AS dauer_s,
       (SELECT count(*) FROM sync.schema_abweichung a
         WHERE a.erkannt_am >= l.gestartet_am AND a.quittiert_am IS NULL) AS offene_abweichungen,
       (SELECT count(*) FROM sync.fortschritt f WHERE f.pausiert_bis > now()) AS pausierte_kombinationen
  FROM sync.lauf l
 ORDER BY l.lauf_id DESC;


-- ---------------------------------------------------------------------
-- Round Table — ersetzt das Excel-Blatt "Eingabe"
-- Spaltennamen wie dort.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mart.round_table(
    p_monat     date,
    p_regelwerk text DEFAULT NULL
)
RETURNS TABLE (
    betrieb                 text,
    stadt                   text,
    bwa_monat               date,
    umsatz_ist              numeric,
    umsatz_vj               numeric,
    umsatz_pct              numeric,
    personalkosten_ogf_pct  numeric,
    we_bar_pct              numeric,
    we_kueche_pct           numeric,
    online_bewertung        numeric,
    om_score                smallint,
    ampel_umsatz            text,
    ampel_personal          text,
    ampel_we_bar            text,
    ampel_we_kueche         text,
    ampel_bewertung         text,
    ampel_om                text,
    gesamt                  text,
    intensitaet             text,
    massnahme               text,
    prioritaet              text
)
LANGUAGE sql STABLE AS $$
WITH grenzen AS (
    SELECT date_trunc('month', p_monat)::date AS m_von,
           (date_trunc('month', p_monat) + interval '1 month - 1 day')::date AS m_bis
),
umsatz AS (   -- POS: quasi live
    SELECT u.betrieb_key, sum(u.umsatz_netto) AS umsatz_ist
      FROM core.umsatzbericht_tag u, grenzen g
     WHERE u.geschaeftstag BETWEEN g.m_von AND g.m_bis
       AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
     GROUP BY u.betrieb_key
),
umsatz_vj AS (
    SELECT u.betrieb_key, sum(u.umsatz_netto) AS umsatz_vj
      FROM core.umsatzbericht_tag u, grenzen g
     WHERE u.geschaeftstag BETWEEN (g.m_von - interval '1 year')::date
                               AND (g.m_bis - interval '1 year')::date
       AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
     GROUP BY u.betrieb_key
),
bwa_stand AS (  -- juengster gebuchter BWA-Monat je Betrieb, hoechstens der Berichtsmonat
    SELECT k.betrieb_key, max(k.monat) AS bwa_monat
      FROM mart.kennzahlen_aktuell k, grenzen g
     WHERE k.monat <= g.m_von
       AND k.wert_prozent IS NOT NULL
     GROUP BY k.betrieb_key
),
bwa AS (
    SELECT s.betrieb_key, s.bwa_monat,
           max(k.wert_prozent) FILTER (WHERE k.kennzahl = 'Personalkosten ohne GF') AS personalkosten_ogf_pct,
           max(k.wert_prozent) FILTER (WHERE k.kennzahl = 'WE Bar')                 AS we_bar_pct,
           max(k.wert_prozent) FILTER (WHERE k.kennzahl = 'WE Küche')               AS we_kueche_pct
      FROM bwa_stand s
      JOIN mart.kennzahlen_aktuell k
        ON k.betrieb_key = s.betrieb_key AND k.monat = s.bwa_monat
     GROUP BY s.betrieb_key, s.bwa_monat
),
basis AS (
    SELECT b.betrieb_key, b.name AS betrieb, b.stadt,
           bwa.bwa_monat,
           u.umsatz_ist,
           v.umsatz_vj,
           CASE WHEN v.umsatz_vj > 0
                THEN round((u.umsatz_ist - v.umsatz_vj) / v.umsatz_vj * 100, 2)
           END AS umsatz_pct,
           bwa.personalkosten_ogf_pct, bwa.we_bar_pct, bwa.we_kueche_pct,
           ob.bewertung AS online_bewertung,
           om.om_score
      FROM core.betrieb b
      LEFT JOIN umsatz    u   ON u.betrieb_key   = b.betrieb_key
      LEFT JOIN umsatz_vj v   ON v.betrieb_key   = b.betrieb_key
      LEFT JOIN bwa           ON bwa.betrieb_key = b.betrieb_key
      LEFT JOIN manual.online_bewertung ob
             ON ob.betrieb_key = b.betrieb_key
            AND ob.monat = (SELECT m_von FROM grenzen)
      LEFT JOIN manual.om_einschaetzung om
             ON om.betrieb_key = b.betrieb_key
            AND om.monat = (SELECT m_von FROM grenzen)
     WHERE b.aktiv
),
bewertet AS (
    SELECT b.*,
           ampel.bewerte(b.umsatz_pct,             'umsatz',    p_regelwerk, b.betrieb_key, b.bwa_monat) AS a_umsatz,
           ampel.bewerte(b.personalkosten_ogf_pct, 'personal',  p_regelwerk, b.betrieb_key, b.bwa_monat) AS a_personal,
           ampel.bewerte(b.we_bar_pct,             'we_bar',    p_regelwerk, b.betrieb_key, b.bwa_monat) AS a_we_bar,
           ampel.bewerte(b.we_kueche_pct,          'we_kueche', p_regelwerk, b.betrieb_key, b.bwa_monat) AS a_we_kueche,
           ampel.bewerte(b.online_bewertung,       'bewertung', p_regelwerk, b.betrieb_key, b.bwa_monat) AS a_bewertung,
           ampel.bewerte(b.om_score,               'om',        p_regelwerk, b.betrieb_key, b.bwa_monat) AS a_om
      FROM basis b
)
SELECT betrieb, stadt, bwa_monat,
       umsatz_ist, umsatz_vj, umsatz_pct,
       personalkosten_ogf_pct, we_bar_pct, we_kueche_pct, online_bewertung, om_score,
       a_umsatz, a_personal, a_we_bar, a_we_kueche, a_bewertung, a_om,
       ampel.gesamt(st)      AS gesamt,
       ampel.intensitaet(st) AS intensitaet,
       CASE WHEN ampel.gesamt(st) = 'rot'
              OR ampel.intensitaet(st) = 'Nachforschung' THEN 'Ja' ELSE 'Nein' END AS massnahme,
       CASE WHEN ampel.gesamt(st) = 'rot'                 THEN 'Hoch'
            WHEN ampel.intensitaet(st) = 'Nachforschung'  THEN 'Mittel'
            ELSE 'Niedrig' END AS prioritaet
  FROM bewertet,
       LATERAL (SELECT ARRAY[a_umsatz,a_personal,a_we_bar,a_we_kueche,a_bewertung,a_om]) AS x(st)
 ORDER BY betrieb;
$$;

COMMENT ON FUNCTION mart.round_table IS
'Ersetzt das Excel-Blatt "Eingabe". Aufruf: SELECT * FROM mart.round_table(DATE ''2026-06-01'');
Zweites Argument waehlt das Regelwerk (round_table_global | lina_betrieb), NULL = Standard.
WICHTIG: bwa_monat weist aus, aus welchem Monat Personal- und Wareneinsatzwerte stammen.
Weil die BWA vom Steuerberater importiert wird und 1-2 Monate nachhinkt, ist das oft NICHT
der Berichtsmonat - im Excel wurde derselbe Versatz stillschweigend gepflegt (Juli-Report
mit Mai-Werten, erkennbar nur an einer Kopfzeile).';


-- Beide Regelwerke nebeneinander
CREATE OR REPLACE FUNCTION mart.round_table_vergleich(p_monat date)
RETURNS TABLE (
    betrieb                     text,
    stadt                       text,
    bwa_monat                   date,
    umsatz_pct                  numeric,
    personalkosten_ogf_pct      numeric,
    we_bar_pct                  numeric,
    we_kueche_pct               numeric,
    online_bewertung            numeric,
    om_score                    smallint,
    gesamt_global               text,
    intensitaet_global          text,
    ampel_personal_global       text,
    gesamt_betrieb              text,
    intensitaet_betrieb         text,
    ampel_personal_betrieb      text,
    weicht_ab                   boolean,
    abweichung                  text
)
LANGUAGE sql STABLE AS $$
SELECT g.betrieb, g.stadt, g.bwa_monat,
       g.umsatz_pct, g.personalkosten_ogf_pct, g.we_bar_pct, g.we_kueche_pct,
       g.online_bewertung, g.om_score,
       g.gesamt, g.intensitaet, g.ampel_personal,
       b.gesamt, b.intensitaet, b.ampel_personal,
       (g.gesamt IS DISTINCT FROM b.gesamt) AS weicht_ab,
       CASE WHEN g.gesamt IS DISTINCT FROM b.gesamt
            THEN format('global: %s / betriebsindividuell: %s',
                        coalesce(g.gesamt,'-'), coalesce(b.gesamt,'-'))
       END AS abweichung
  FROM mart.round_table(p_monat, 'round_table_global') g
  FULL JOIN mart.round_table(p_monat, 'lina_betrieb')  b USING (betrieb)
 ORDER BY (g.gesamt IS DISTINCT FROM b.gesamt) DESC, g.betrieb;
$$;

COMMENT ON FUNCTION mart.round_table_vergleich IS
'Beide Regelwerke nebeneinander, abweichende Betriebe zuerst.
Fuer den Round Table auf weicht_ab filtern - das sind die Faelle, in denen die Wahl der
Schwellen tatsaechlich ein anderes Urteil ergibt. Bei allen uebrigen eruebrigt sich die Diskussion.';
