-- =====================================================================
-- 0137 Umsatz je Stunde UND Sparte — die Spartenkreuzung des Stundenberichts
--
-- ANLASS (23.10.2026). Der Fachbereich (Wilma Wunder) wollte das Abendgeschaeft
-- je Betrieb, Januar bis September 2026, Fenster 18-20 Uhr und ab 20 Uhr,
-- getrennt nach Speisen und Getraenken. Mit dem Bestand war das nicht zu
-- beantworten, und zwar aus zwei Gruenden (docs/befunde-datenlage.md):
--
--   * Bericht 76 (mart.zeitzone_hauptsparte_monat) trennt Speisen und
--     Getraenke, aber nur in den Zonen, die LINA je Betrieb eingerichtet hat.
--     Kein Wilma-Betrieb bricht um 20 Uhr; sechs von dreizehn haben gar keine
--     Zonen und liefern nur Kopfzeilen.
--   * Der Konzern-Stundenbericht (core.zeitzonenbericht_stunde, 10,6 Mio.
--     Zeilen, alle 141 Betriebe, lueckenlos seit 2018) kann jedes Fenster auf
--     volle Stunden schneiden — aber ohne Sparte.
--
-- MESSFRAGE d5, gemessen am 23.10.2026 (docs/lina-api-inventar.md): der
-- Parameter `hauptsparten` greift auch im Stundenbericht. Bei 44 von 44
-- Betrieben mit Speisenumsatz traf die gefilterte Stundensumme den
-- Speisenumsatz des Umsatzberichts exakt — geteilt durch die offenen Tage,
-- denn ein MEHRTAEGIGER Aufruf liefert dort den Durchschnitt je offenem Tag,
-- keine Summe (der Sync holt tagweise und ist davon nicht betroffen; beim
-- ersten Vergleich sah es nach einem Siebtel aus). Zwei Konzernaufrufe je Tag (posId
-- 10001 Speisen, 10002 Getraenke) liefern also Stunde × Sparte fuer alle
-- Betriebe, rund 700 Aufrufe im Jahr; die Historie seit 2018 kostet ~6.400
-- Aufrufe und laeuft ueber HISTORIE_JE_LAUF in drei bis vier Naechten,
-- neueste zuerst.
--
-- WARUM EINE EIGENE TABELLE und keine Spalte an core.zeitzonenbericht_stunde:
-- die Tabelle hat 10,6 Mio. Zeilen und einen Primaerschluessel ueber
-- (betrieb_key, geschaeftstag, stunde). Eine hauptsparte_key mit NULL fuer
-- "gesamt" passt in keinen Primaerschluessel; der Umweg des Umsatzberichts
-- (UNIQUE NULLS NOT DISTINCT statt PK) haette den Schluessel einer Tabelle
-- dieser Groesse beim Deploy neu gebaut und jede Sicht darauf angefasst. Die
-- Gesamtzeile bleibt, wo sie ist; die Spartenzeilen stehen daneben. Dass
-- beide nicht zusammen summiert werden duerfen, sagt ein Fallstrick dem
-- MCP-Pruefer (unten). docs/entscheidungen.md, 23.10.2026.
--
-- WAS DIESE MIGRATION ANLEGT
--   1. core.zeitzonenbericht_stunde_sparte  — Betrieb × Geschaeftstag × Stunde × Hauptsparte
--   2. mart.umsatz_stunde_sparte            — dasselbe lesbar, mit Namen
--   3. mart.umsatz_zeitfenster_sparte       — eigene Fenster (manual.zeitfenster) × Sparte
--   4. mart.umsatz_stunde_sparte_pruefung   — Gegenprobe gegen den Umsatzbericht,
--                                             und was noch nicht geladen ist
--   5. zwei Zeilen in mart.pruefung_uebersicht
--   6. MCP-Katalog: Koernung, Fallstricke, Rechte, Leseprobe
--
-- Die Endpunkte, der Lader und das Zulaufregister stehen im selben Commit in
-- src/lina/endpunkte.ts, src/sync/laden.ts und src/sync/quellen.ts.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Tabelle
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.zeitzonenbericht_stunde_sparte (
    betrieb_key      integer  NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag    date     NOT NULL,
    stunde           smallint NOT NULL CHECK (stunde BETWEEN 0 AND 23),
    hauptsparte_key  integer  NOT NULL REFERENCES core.hauptsparte(hauptsparte_key),
    umsatz_netto     numeric(14,2),
    raw_id           bigint,
    geladen_am       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, geschaeftstag, stunde, hauptsparte_key)
);

CREATE INDEX IF NOT EXISTS zeitzonenbericht_stunde_sparte_geschaeftstag_brin
    ON core.zeitzonenbericht_stunde_sparte USING brin (geschaeftstag) WITH (autosummarize = on);

COMMENT ON TABLE core.zeitzonenbericht_stunde_sparte IS
'Aus getZeitzonenbericht mit hauptsparten=<posId> (0137): Umsatz je Betrieb, Geschaeftstag, Stunde
UND Hauptsparte. Geholt werden Speisen (10001) und Getraenke (10002); die Summe beider ist deshalb
kleiner als die Gesamtzeile in core.zeitzonenbericht_stunde (Gutscheine, Pfand, Trinkgeld fehlen).
Der Geschaeftstag laeuft 08:00 bis 07:59 des Folgetags, die Stunden 0-7 gehoeren zum Vortag;
geschaeftstag ist bereits umgerechnet. NICHT mit core.zeitzonenbericht_stunde addieren — das ist
derselbe Umsatz, einmal gesamt und einmal nach Sparte.';

COMMENT ON COLUMN core.zeitzonenbericht_stunde_sparte.hauptsparte_key IS
'Aus dem Parameter hauptsparten des Postens nachgeschlagen (core.hauptsparte.pos_id), nicht aus dem
Endpunktschluessel — der Parameter ist, was LINA bekommen hat.';


-- ---------------------------------------------------------------------
-- 2. Lesbar: Stunde × Sparte
--
-- Gleicher Schnitt wie mart.umsatz_stunde (0006), plus hauptsparte. Die
-- Sortierfalle gilt hier genauso: nach stunde sortiert ergibt keinen
-- zeitlichen Verlauf, dafuer nach ((stunde + 16) % 24).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.umsatz_stunde_sparte AS
SELECT z.geschaeftstag,
       date_trunc('month', z.geschaeftstag)::date AS monat,
       b.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       hs.name         AS hauptsparte,
       z.stunde,
       z.umsatz_netto
  FROM core.zeitzonenbericht_stunde_sparte z
  JOIN core.betrieb b                 ON b.betrieb_key = z.betrieb_key
  JOIN core.hauptsparte hs            ON hs.hauptsparte_key = z.hauptsparte_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = z.betrieb_key;

COMMENT ON VIEW mart.umsatz_stunde_sparte IS
'Umsatz je Betrieb, Geschaeftstag, Stunde und Hauptsparte (Speisen, Getraenke) — die
Spartenkreuzung zu mart.umsatz_stunde (0137). Nur die aufgeteilten Zeilen; der Gesamtwert steht in
mart.umsatz_stunde und ist hier bewusst NICHT enthalten, damit eine Summe nicht doppelt zaehlt.
Speisen + Getraenke ist weniger als der Gesamtumsatz (Gutscheine, Pfand, Trinkgeld fehlen).
Tagesgrenze wie ueberall: der Geschaeftstag laeuft 08:00 bis 07:59, Stunden 0-7 gehoeren ans Ende —
fuer den Verlauf nach ((stunde + 16) % 24) sortieren. Geladen ab Oktober 2026, die Historie seit
2018 laeuft im Nachtlauf nach, neueste zuerst; welcher Tag fehlt, sagt
mart.umsatz_stunde_sparte_pruefung.';


-- ---------------------------------------------------------------------
-- 3. Eigene Fenster × Sparte
--
-- Spiegel von mart.umsatz_zeitfenster (0052) mit Hauptsparte. Dieselbe
-- Fensterdefinition (manual.zeitfenster), derselbe Bereichsvergleich — eine
-- geaenderte Fenstergrenze gilt sofort fuer beide Sichten. Fenster ueber
-- Mitternacht (stunde_bis <= stunde_von) werden ueber OR geschnitten, nicht
-- ueber BETWEEN; wer das vergisst, verliert die Stunden nach 24 Uhr.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.umsatz_zeitfenster_sparte AS
SELECT s.betrieb_key,
       b.name         AS betrieb,
       s.geschaeftstag,
       hs.name        AS hauptsparte,
       f.fenster_key,
       f.name         AS fenster,
       f.reihenfolge,
       (f.stunde_bis <= f.stunde_von) AS ueber_mitternacht,
       sum(s.umsatz_netto) AS umsatz_netto
  FROM core.zeitzonenbericht_stunde_sparte s
  JOIN core.betrieb b      ON b.betrieb_key = s.betrieb_key
  JOIN core.hauptsparte hs ON hs.hauptsparte_key = s.hauptsparte_key
  JOIN manual.zeitfenster f
    ON f.aktiv
   AND CASE WHEN f.stunde_bis > f.stunde_von
            THEN s.stunde >= f.stunde_von AND s.stunde < f.stunde_bis
            ELSE s.stunde >= f.stunde_von OR  s.stunde < f.stunde_bis
       END
 GROUP BY s.betrieb_key, b.name, s.geschaeftstag, hs.name, f.fenster_key, f.name, f.reihenfolge,
          (f.stunde_bis <= f.stunde_von);

COMMENT ON VIEW mart.umsatz_zeitfenster_sparte IS
'Umsatz je Betrieb, Geschaeftstag, Hauptsparte und selbst geschnittenem Zeitfenster
(manual.zeitfenster), aus dem Stundenbericht mit Spartenfilter (0137). Die Fenster sind dieselben
wie in mart.umsatz_zeitfenster; wer andere Grenzen braucht (etwa 18-20 und ab 20 Uhr), schneidet
sie direkt in mart.umsatz_stunde_sparte ueber stunde. NICHT mit mart.umsatz_zeitfenster addieren —
dort steht derselbe Umsatz ohne Sparte.';


-- ---------------------------------------------------------------------
-- 4. Die Gegenprobe
--
-- Je Betrieb, Geschaeftstag und Sparte: die Stundensumme gegen den Wert des
-- Umsatzberichts fuer dieselbe Sparte (core.umsatzbericht_tag, Gesamtbetrieb).
-- Die Messung vom 23.10.2026 hat die Gleichheit fuer eine Woche gezeigt; diese
-- Sicht haelt sie fuer jeden geladenen Tag fest. Dazu, was noch fehlt: ein
-- Tag mit Gesamtstunden, aber ohne Spartenstunden, ist noch nicht geladen —
-- in der Historie erwartet, im Nachzueglerfenster ein Fehler.
--
-- Nur Betriebe mit laufendem Geschaeft und nur Tage, an denen der
-- Umsatzbericht fuer die Sparte etwas fuehrt: bei Fremdkassen liefert der
-- Spartenfilter 0,00 (nachgemessen), und 0 gegen NULL ist keine Abweichung,
-- sondern ein Betrieb ohne Spartentrennung.
--
-- ABGEGEBENE BETRIEBE (0133) BLEIBEN DRAUSSEN. Die d5-Antwort vom 23.10.2026
-- fuehrt 140 Betriebe; der einzige, der fehlt, ist Wirtshaus Lautenschlager
-- (abgegeben am 15.10.2026) — LINA laesst ihn auch fuer vergangene Tage weg,
-- obwohl der Gesamt-Stundenbericht ihn bis zum 14.10. kennt (101.839 EUR in
-- der Messwoche). Ohne diesen Ausschluss stuende er in der Pruefzeile fuer
-- immer auf 'nicht geladen' — eine Zeile, die nie auf null geht. Review-Befund
-- vom 23.10.2026.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.umsatz_stunde_sparte_pruefung AS
WITH tage AS (
    -- Alle Betrieb-Tage, fuer die der Gesamt-Stundenbericht Umsatz kennt
    SELECT s.betrieb_key, s.geschaeftstag, sum(s.umsatz_netto) AS stunden_gesamt
      FROM core.zeitzonenbericht_stunde s
     GROUP BY s.betrieb_key, s.geschaeftstag
    HAVING sum(s.umsatz_netto) <> 0
),
sparten AS (
    SELECT z.betrieb_key, z.geschaeftstag, z.hauptsparte_key, sum(z.umsatz_netto) AS stunden_sparte
      FROM core.zeitzonenbericht_stunde_sparte z
     GROUP BY z.betrieb_key, z.geschaeftstag, z.hauptsparte_key
),
bericht AS (
    SELECT u.betrieb_key, u.geschaeftstag, u.hauptsparte_key, u.umsatz_netto AS bericht_sparte
      FROM core.umsatzbericht_tag u
     WHERE u.hauptsparte_key IS NOT NULL
       AND u.verkaufsstelle_key IS NULL
)
SELECT t.betrieb_key,
       b.name                                   AS betrieb,
       t.geschaeftstag,
       hs.name                                  AS hauptsparte,
       sp.stunden_sparte,
       br.bericht_sparte,
       round(sp.stunden_sparte - br.bericht_sparte, 2) AS abweichung,
       CASE WHEN sp.stunden_sparte IS NULL THEN 'nicht geladen'
            WHEN br.bericht_sparte IS NULL  THEN 'ohne Vergleichswert'
            WHEN abs(sp.stunden_sparte - br.bericht_sparte) <= 0.05 THEN 'ok'
            ELSE 'weicht ab' END              AS befund
  FROM tage t
  JOIN core.betrieb b ON b.betrieb_key = t.betrieb_key
  JOIN mart.betrieb_status bs ON bs.betrieb_key = t.betrieb_key
                             AND bs.status IN ('operativ', 'inaktiv')
  LEFT JOIN manual.betrieb_schliessung sch ON sch.betrieb_key = t.betrieb_key
  CROSS JOIN (SELECT hauptsparte_key, name FROM core.hauptsparte WHERE pos_id IN (10001, 10002)) hs
  LEFT JOIN sparten sp ON sp.betrieb_key = t.betrieb_key AND sp.geschaeftstag = t.geschaeftstag
                      AND sp.hauptsparte_key = hs.hauptsparte_key
  LEFT JOIN bericht br ON br.betrieb_key = t.betrieb_key AND br.geschaeftstag = t.geschaeftstag
                      AND br.hauptsparte_key = hs.hauptsparte_key
 WHERE NOT coalesce(sch.abgegeben, false);

COMMENT ON VIEW mart.umsatz_stunde_sparte_pruefung IS
'Pruefsicht (0137): je Betrieb, Geschaeftstag und Sparte die Stundensumme des Spartenfilters gegen den
Spartenwert des Umsatzberichts. befund: ok | weicht ab (mehr als 5 Cent) | nicht geladen (der
Gesamt-Stundenbericht kennt den Tag, der Spartenfilter noch nicht — in der Historie der Normalfall,
bis der Nachtlauf sie geholt hat) | ohne Vergleichswert (der Umsatzbericht fuehrt die Sparte an
diesem Tag nicht; Betriebe ohne Spartentrennung an der Kasse). Immer nach geschaeftstag filtern —
die Sicht rechnet sonst ueber die ganze Historie. Nur Betriebe mit laufendem oder zuletzt laufendem
Geschaeft; abgegebene Betriebe (manual.betrieb_schliessung.abgegeben, 0133) fehlen, weil LINA sie
auch rueckwirkend nicht mehr liefert. Der 5-Cent-Rahmen deckt die Rundung von 24 Stundenwerten auf Cent.';


-- ---------------------------------------------------------------------
-- 5. Pruefuebersicht: zwei Zeilen, auch wenn sie null sind (wie 0127, 0136)
--
-- Beide ueber die letzten 60 Tage: die Historie ist bewusst nicht drin, sie
-- laeuft ueber Naechte nach und wuerde die Zeile monatelang auf Hunderte
-- stellen — eine Zeile, die nie auf null geht, liest niemand mehr (0071).
-- Der Nachzuegler-Rand ist ausgespart: LINA fuellt den Stundenbericht erst
-- nach einigen Tagen, und das Nachzueglerfenster holt ihn so oft nach.
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%umsatz_stunde_sparte_pruefung%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'Stunde x Sparte: Tag weicht vom Umsatzbericht ab (60 Tage)'::text AS pruefung,
               count(*) FILTER (WHERE p.befund IN ('ok', 'weicht ab'))::bigint AS geprueft,
               count(*) FILTER (WHERE p.befund = 'weicht ab')::bigint          AS auffaellig,
               'mart.umsatz_stunde_sparte_pruefung'::text AS sicht
          FROM mart.umsatz_stunde_sparte_pruefung p
         WHERE p.geschaeftstag >= current_date - 60
           AND p.geschaeftstag <  current_date - 8
        $zweig$,
        $zweig$
        SELECT 'Stunde x Sparte: Tag mit Stundenbericht, aber ohne Spartenstunden (60 Tage)'::text AS pruefung,
               count(*)::bigint                                               AS geprueft,
               count(*) FILTER (WHERE p.befund = 'nicht geladen')::bigint     AS auffaellig,
               'mart.umsatz_stunde_sparte_pruefung'::text AS sicht
          FROM mart.umsatz_stunde_sparte_pruefung p
         WHERE p.geschaeftstag >= current_date - 60
           AND p.geschaeftstag <  current_date - 8
        $zweig$);
END $aussen$;


-- ---------------------------------------------------------------------
-- 6. MCP-Katalog: Koernung, Fallstricke, Rechte, Leseprobe
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.umsatz_stunde_sparte',
     'Betrieb × Geschaeftstag × Stunde × Hauptsparte (Speisen, Getraenke) — Spartenkreuzung zu mart.umsatz_stunde',
     'umsatz', true),
    ('mart.umsatz_zeitfenster_sparte',
     'Betrieb × Geschaeftstag × Hauptsparte × eigenes Zeitfenster (manual.zeitfenster)',
     'umsatz', true),
    ('mart.umsatz_stunde_sparte_pruefung',
     'Betrieb × Geschaeftstag × Hauptsparte — Stundensumme gegen Umsatzbericht; immer nach geschaeftstag filtern',
     'import', false),
    -- Nachtrag zu 0135 und 0136: beide Sichten kamen ohne Koernung in den Katalog
    -- (aufgefallen beim Katalogabzug am 23.10.2026 — der MCP-Test verlangt eine).
    ('mart.bestellansicht_stand',
     'eine Marke — Bestellungen, deren Positionen ueber die Bestellansicht statt die Schnittstelle kamen (0135)',
     'import', false),
    ('mart.finanzweg_fehleingabe',
     'Betrieb × Geschaeftstag × Quellbericht × Finanzweg — erkannte Kassen-Fehleingaben (0136); die Zahlarten dieses Tages fehlen in mart.finanzweg_tag',
     'kasse', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht
   AND (s.koernung IS NULL OR s.sicht LIKE 'mart.umsatz_%_sparte%');

-- Nur Regelarten, die mcp/src/pruefen.ts kennt (sichten_mischen seit 0118,
-- deutung seit 0103) — eine unbekannte liesse den Server nicht starten.
INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle) VALUES
  ('stunde_gesamt_plus_sparte', 'sichten_mischen', 'warnung', NULL,
   '{"a":["mart.umsatz_stunde","mart.umsatz_zeitfenster"],"b":["mart.umsatz_stunde_sparte","mart.umsatz_zeitfenster_sparte"]}',
   'Die Stundensichten ohne Sparte fuehren den GESAMTEN Umsatz, die mit Sparte denselben Umsatz '
   'noch einmal nach Speisen und Getraenken. Eine Summe ueber beide zaehlt doppelt.',
   'Eine der beiden nehmen. Anteile (Speisen am Gesamt) als Verhaeltnis rechnen, nicht addieren.',
   '0137'),
  ('stunde_sparte_unvollstaendig', 'deutung', 'warnung', 'mart.umsatz_stunde_sparte', '{}',
   'Speisen + Getraenke ist NICHT der Gesamtumsatz: Gutscheine, Pfand, Trinkgeld und Sonstiges '
   'fehlen hier. Und: die Historie wird nachts rueckwaerts nachgeladen — ein Tag ohne Zeile ist '
   'bis dahin nicht null, sondern nicht geladen (mart.umsatz_stunde_sparte_pruefung, befund).',
   'Gesamtumsatz aus mart.umsatz_stunde oder mart.umsatz_tag. Vor einer Zeitreihe den Ladestand '
   'in mart.umsatz_stunde_sparte_pruefung fuer den Zeitraum ansehen.',
   '0137'),
  ('stunde_sparte_tagesgrenze', 'deutung', 'warnung', 'mart.umsatz_stunde_sparte', '{}',
   'Der Geschaeftstag laeuft 08:00 bis 07:59 des Folgetags. Die Stunden 0 bis 7 gehoeren ans ENDE '
   'des Tages, nicht an den Anfang; "ab 20 Uhr" ist stunde >= 20 OR stunde < 8, und nach stunde '
   'sortiert ergibt keinen Verlauf.',
   'Fuer den Verlauf nach ((stunde + 16) % 24) sortieren; Fenster ueber Mitternacht mit OR schneiden.',
   '0137')
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
    v_sicht  text;
    v_liegen text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0137 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0137 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_sicht IN ARRAY ARRAY[
        'mart.umsatz_stunde_sparte', 'mart.umsatz_zeitfenster_sparte',
        'mart.umsatz_stunde_sparte_pruefung']
    LOOP
        BEGIN
            EXECUTE format('SELECT * FROM %s WHERE geschaeftstag >= current_date - 1 LIMIT 1', v_sicht);
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_sicht, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0137 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
