-- =====================================================================
-- 0160 FoodNotify: Rezepte, Kassenartikel und Warenstamm ueber das
--      Scope-Token, die Sitzung als dauerhafter Rueckfall — und sichtbar,
--      welcher Zugang jede Antwort geholt hat (Entscheidung Eugene,
--      19.11.2026: gemischter Betrieb)
--
-- ANLASS. FoodNotifys Scope-Token (Bearer, nur api3.foodnotify.com) traegt
-- bei allen vier Marken die Rezeptliste (ueber /api/recipe-viewer/recipes),
-- Rezeptkopf, Zutaten, Meta, die Kassenartikel und den Warenstamm — NICHT
-- Bestellpositionen und Inventuren (docs/payloads/foodnotify-2026-11/
-- fn-token-probe-2026-11-19.md). Am 19.11.2026 19:03 UTC verglichen
-- (fn-token-probe --vergleich): 23 von 24 Abrufpaaren antwortgleich mit der
-- Sitzung; das 24. (Warenstamm Deutsche Konzepte) wich nur in
-- cartProductQuantity EINER Ware ab — der Menge im laufenden Warenkorb, die
-- der Lader nicht liest.
--
-- Deshalb laufen fn:rezepte, fn:rezept, fn:rezept_zutaten, fn:rezept_meta,
-- fn:pos_artikel und fn:warenstamm zuerst ueber das Token. Der Rueckfall auf
-- die Sitzung bleibt IMMER eingebaut (Eugene, 19.11.2026, woertlich:
-- „Behalte immer den Fallback, falls es mal mit einem Token nicht klappen
-- sollte oder ein Token fehlen sollte.") und greift je Posten bei
--   kein_token  — fuer die Marke steht kein Token in FN_API_TOKENS
--   abgewiesen  — 401/403; danach fragt der Lauf diese Marke und diesen
--                 Eintrag nicht mehr mit Token
--   ausfall     — Netzfehler, Zeitgrenze, 429, 5xx, unlesbare oder fremde
--                 Antwort; nach drei Ausfaellen in Folge laeuft die Marke
--                 fuer den Rest des Laufs ueber die Sitzung
-- Ein fachlicher 404 (Rezept geloescht) ist eine Antwort, kein Ausfall.
-- Der Code steht in src/foodnotify/client.ts; das Register sagt, wer was
-- bevorzugt (`token` in src/foodnotify/endpunkte.ts).
--
-- WARUM DAS IN DIE DATENBANK MUSS (Regel 10). Ein Rueckfall, der nur im Log
-- steht, sieht aus wie ein gelungener Lauf: die Daten kommen ja an. Faellt
-- das Token still weg (abgelaufen, Scope entzogen, nie in Dokploy gesetzt),
-- liefe der Importer auf Dauer ueber die Sitzung — mit den 19-39-s-Antworten
-- der Kassenartikel, die 0155 gemessen hat — und niemand merkte es. Deshalb:
--
-- WAS DIESE MIGRATION ANLEGT
--   1. sync.aufgabe: zugang, zugang_bevorzugt, zugang_rueckfall,
--      zugang_rueckfall_grund — je Aufruf, wie er ging und warum. Hier und
--      nicht in einer eigenen Tabelle, weil sync.aufgabe schon die eine
--      Zeile je Posten und Lauf ist, die alle Pruefsichten lesen; eine
--      zweite Tabelle muesste denselben Schluessel noch einmal fuehren.
--   2. raw.api_antwort.zugang — ueber welchen Zugang die gesicherte Antwort
--      kam. Nur eine neue, leere Spalte (kein UPDATE alter Zeilen, Regel 4):
--      NULL heisst LINA oder vor 0160, und vor 0160 war es immer die Sitzung.
--   3. mart.fn_zugang_stand — je Marke und Token-Eintrag: bevorzugter
--      Zugang, tatsaechlich benutzter im letzten Lauf, Anzahl, letzter
--      Rueckfallgrund, befund.
--   4. eine Zeile in mart.pruefung_uebersicht — nur abgewiesen und ausfall.
--      „Kein Token hinterlegt" ist ein sichtbarer Zustand (befund in der
--      Sicht), kein Fehler, und stuende sonst dauerhaft auf vier.
--   5. MCP-Katalog, Rechte ueber mcp.rechte_auffrischen(), Leseprobe.
--
-- Die Liste der sechs Eintraege steht unten in der Sicht ein zweites Mal
-- (eine Sicht kann den Code nicht lesen). src/foodnotify/zugang.test.ts haelt
-- sie gegen FN_TOKEN_ENDPUNKTE aus dem Register zusammen.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. sync.aufgabe — der Zugang je Aufruf
--
-- CHECK als NOT VALID: alte Zeilen sind alle NULL und erfuellen die
-- Bedingung ohnehin; die Pruefung der Bestandszeilen waere ein Vollscan
-- ueber das ganze Protokoll ohne Erkenntnis. Neue Zeilen werden geprueft.
-- ---------------------------------------------------------------------

ALTER TABLE sync.aufgabe
    ADD COLUMN IF NOT EXISTS zugang                 text,
    ADD COLUMN IF NOT EXISTS zugang_bevorzugt       text,
    ADD COLUMN IF NOT EXISTS zugang_rueckfall       text,
    ADD COLUMN IF NOT EXISTS zugang_rueckfall_grund text;

ALTER TABLE sync.aufgabe DROP CONSTRAINT IF EXISTS aufgabe_zugang_check;
ALTER TABLE sync.aufgabe ADD CONSTRAINT aufgabe_zugang_check
    CHECK ((zugang IS NULL OR zugang IN ('sitzung', 'token'))
           AND (zugang_bevorzugt IS NULL OR zugang_bevorzugt IN ('sitzung', 'token'))
           AND (zugang_rueckfall IS NULL OR zugang_rueckfall IN ('kein_token', 'abgewiesen', 'ausfall'))) NOT VALID;

COMMENT ON COLUMN sync.aufgabe.zugang IS
'FoodNotify (0160): ueber welchen Zugang dieser Aufruf ging — token (Bearer gegen api3) oder sitzung
(Cookie, my.foodnotify.com). NULL bei LINA und bei FoodNotify-Aufgaben vor 0160 (damals immer sitzung).
Bei einem Rueckfall steht hier sitzung und in zugang_rueckfall der Grund.';
COMMENT ON COLUMN sync.aufgabe.zugang_bevorzugt IS
'Was das Register fuer diesen Eintrag bevorzugt (token bei fn:rezepte, fn:rezept, fn:rezept_zutaten,
fn:rezept_meta, fn:pos_artikel, fn:warenstamm; sonst sitzung). Bevorzugt token und zugang = sitzung heisst:
zurueckgefallen.';
COMMENT ON COLUMN sync.aufgabe.zugang_rueckfall IS
'Warum dieser Aufruf nicht ueber das bevorzugte Token ging: kein_token (fuer die Marke keins in
FN_API_TOKENS — ein Zustand, kein Fehler), abgewiesen (401/403; der Lauf fragt diesen Eintrag der Marke
danach nicht mehr mit Token), ausfall (Netz, Zeitgrenze, 429, 5xx, unlesbare oder fremde Antwort; nach drei
Ausfaellen in Folge laeuft die Marke fuer den Rest des Laufs ueber die Sitzung). NULL = kein Rueckfall.';
COMMENT ON COLUMN sync.aufgabe.zugang_rueckfall_grund IS
'Kurztext zum Rueckfall (Status und Meldung, z. B. „HTTP 403 — This endpoint does not support
scope-limited tokens."). Enthaelt nie einen Tokenwert.';

-- Der Suchpfad von mart.fn_zugang_stand: nur Aufgaben seit 0160 mit
-- bevorzugtem Zugang, je Marke und Eintrag, neueste zuerst.
CREATE INDEX IF NOT EXISTS aufgabe_fn_zugang
    ON sync.aufgabe (marke_key, endpunkt, lauf_id DESC)
 WHERE zugang_bevorzugt IS NOT NULL;


-- ---------------------------------------------------------------------
-- 2. raw.api_antwort.zugang
-- ---------------------------------------------------------------------

ALTER TABLE raw.api_antwort
    ADD COLUMN IF NOT EXISTS zugang text;

COMMENT ON COLUMN raw.api_antwort.zugang IS
'FoodNotify (0160): ueber welchen Zugang diese Antwort kam — token oder sitzung. NULL bei LINA und bei
FoodNotify-Antworten vor 0160 (damals immer sitzung). Am 19.11.2026 lieferten beide Zugaenge dieselben
Zeilen (fn-token-probe --vergleich); die Spalte macht trotzdem nachpruefbar, aus welchem Weg eine Zahl stammt.';


-- ---------------------------------------------------------------------
-- 3. mart.fn_zugang_stand
--
-- Eine Zeile je Marke × Token-Eintrag (4 × 6), auch wo nie gefragt wurde:
-- „nicht gefragt" ist eine Aussage (z. B. Warenstamm bei einer Marke, die
-- nicht in WARENSTAMM_MARKEN steht), keine fehlende Zeile.
--
-- „Letzter Lauf" = der juengste Lauf, in dem fuer Marke und Eintrag
-- ueberhaupt eine Aufgabe mit Zugangsangabe steht. Gezaehlt wird nur in
-- diesem Lauf: ein Rueckfall von vor einer Woche ist erledigt, wenn der
-- letzte Lauf ueber das Token ging (letzter_rueckfall_am bleibt sichtbar).
--
-- befund, in dieser Rangfolge:
--   nie gefragt              keine Aufgabe seit 0160
--   nicht gefragt seit 48 h  der letzte Lauf mit dieser Kombination ist alt
--   rueckfall abgewiesen     im letzten Lauf mindestens ein 401/403
--   rueckfall ausfall        im letzten Lauf mindestens ein technischer Ausfall
--   rueckfall kein token     im letzten Lauf kein Token hinterlegt
--   ok                       alles im letzten Lauf ueber das Token
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.fn_zugang_stand AS
WITH eintrag(endpunkt, folge) AS (
    VALUES ('fn:rezepte', 1), ('fn:rezept', 2), ('fn:rezept_zutaten', 3), ('fn:rezept_meta', 4),
           ('fn:pos_artikel', 5), ('fn:warenstamm', 6)
),
paar AS (
    SELECT m.marke_key, m.schluessel AS marke, e.endpunkt, e.folge
      FROM core.marke m CROSS JOIN eintrag e
),
letzter AS (
    SELECT a.marke_key, a.endpunkt, max(a.lauf_id) AS lauf_id
      FROM sync.aufgabe a
     WHERE a.zugang_bevorzugt IS NOT NULL
       AND a.endpunkt IN (SELECT endpunkt FROM eintrag)
     GROUP BY a.marke_key, a.endpunkt
),
im_lauf AS (
    SELECT a.marke_key, a.endpunkt,
           max(a.zugang_bevorzugt)                                        AS zugang_bevorzugt,
           max(a.beendet_am)                                              AS letzter_abruf_am,
           count(*)                                                       AS abrufe,
           count(*) FILTER (WHERE a.zugang = 'token')                     AS ueber_token,
           count(*) FILTER (WHERE a.zugang = 'sitzung')                   AS ueber_sitzung,
           count(*) FILTER (WHERE a.zugang_rueckfall = 'kein_token')      AS rueckfall_kein_token,
           count(*) FILTER (WHERE a.zugang_rueckfall = 'abgewiesen')      AS rueckfall_abgewiesen,
           count(*) FILTER (WHERE a.zugang_rueckfall = 'ausfall')         AS rueckfall_ausfall,
           count(*) FILTER (WHERE a.status IN ('ok', 'keine_daten'))      AS erfolgreich
      FROM sync.aufgabe a
      JOIN letzter l ON l.marke_key = a.marke_key AND l.endpunkt = a.endpunkt AND l.lauf_id = a.lauf_id
     WHERE a.zugang_bevorzugt IS NOT NULL
     GROUP BY a.marke_key, a.endpunkt
),
rueckfall_zuletzt AS (
    SELECT DISTINCT ON (a.marke_key, a.endpunkt)
           a.marke_key, a.endpunkt, a.beendet_am AS letzter_rueckfall_am, a.lauf_id AS letzter_rueckfall_lauf,
           a.zugang_rueckfall AS letzter_rueckfall, a.zugang_rueckfall_grund AS letzter_rueckfall_grund
      FROM sync.aufgabe a
     WHERE a.zugang_bevorzugt IS NOT NULL AND a.zugang_rueckfall IS NOT NULL
       AND a.endpunkt IN (SELECT endpunkt FROM eintrag)
     ORDER BY a.marke_key, a.endpunkt, a.lauf_id DESC, a.aufgabe_id DESC
)
SELECT p.marke,
       p.marke_key,
       p.endpunkt,
       coalesce(i.zugang_bevorzugt, 'token')                         AS zugang_bevorzugt,
       CASE WHEN i.abrufe IS NULL THEN NULL
            WHEN i.ueber_sitzung = 0 THEN 'token'
            WHEN i.ueber_token = 0 THEN 'sitzung'
            ELSE 'gemischt' END                                      AS zugang_letzter_lauf,
       l.lauf_id                                                     AS letzter_lauf_id,
       i.letzter_abruf_am,
       coalesce(i.abrufe, 0)::int                                    AS abrufe,
       coalesce(i.ueber_token, 0)::int                               AS ueber_token,
       coalesce(i.ueber_sitzung, 0)::int                             AS ueber_sitzung,
       coalesce(i.rueckfall_kein_token, 0)::int                      AS rueckfall_kein_token,
       coalesce(i.rueckfall_abgewiesen, 0)::int                      AS rueckfall_abgewiesen,
       coalesce(i.rueckfall_ausfall, 0)::int                         AS rueckfall_ausfall,
       coalesce(i.erfolgreich, 0)::int                               AS erfolgreich,
       CASE WHEN r.letzter_rueckfall_lauf = l.lauf_id THEN r.letzter_rueckfall END       AS rueckfall_letzter_lauf,
       CASE WHEN r.letzter_rueckfall_lauf = l.lauf_id THEN r.letzter_rueckfall_grund END AS rueckfall_grund_letzter_lauf,
       r.letzter_rueckfall_am,
       r.letzter_rueckfall,
       CASE WHEN i.abrufe IS NULL                                     THEN 'nie gefragt'
            WHEN i.letzter_abruf_am < now() - interval '48 hours'     THEN 'nicht gefragt seit 48 h'
            WHEN i.rueckfall_abgewiesen > 0                           THEN 'rueckfall abgewiesen'
            WHEN i.rueckfall_ausfall > 0                              THEN 'rueckfall ausfall'
            WHEN i.rueckfall_kein_token > 0                           THEN 'rueckfall kein token'
            ELSE 'ok' END                                            AS befund,
       CASE WHEN i.abrufe IS NULL
                 THEN 'Seit 0160 nie gefragt — bei Kassenartikeln und Warenstamm: Marke nicht im Schalter (POS_ARTIKEL_MARKEN, WARENSTAMM_MARKEN).'
            WHEN i.letzter_abruf_am < now() - interval '48 hours'
                 THEN 'Seit ueber 48 h nicht gefragt — ob die Daten ankommen, sagt mart.quelle_zulauf.'
            WHEN i.rueckfall_abgewiesen > 0
                 THEN 'Das Token wurde abgewiesen (401/403); der Eintrag lief ueber die Sitzung. Token in FoodNotify pruefen (Scopes, abgelaufen?).'
            WHEN i.rueckfall_ausfall > 0
                 THEN 'Der Token-Weg fiel technisch aus; die betroffenen Posten liefen ueber die Sitzung. Grund in rueckfall_grund_letzter_lauf.'
            WHEN i.rueckfall_kein_token > 0
                 THEN 'Kein Token fuer die Marke hinterlegt (FN_API_TOKENS) — alles ueber die Sitzung. Ein Zustand, kein Fehler.'
            ELSE 'Alles im letzten Lauf ueber das Token.' END        AS befund_text
  FROM paar p
  LEFT JOIN letzter l           ON l.marke_key = p.marke_key AND l.endpunkt = p.endpunkt
  LEFT JOIN im_lauf i           ON i.marke_key = p.marke_key AND i.endpunkt = p.endpunkt
  LEFT JOIN rueckfall_zuletzt r ON r.marke_key = p.marke_key AND r.endpunkt = p.endpunkt
 ORDER BY p.marke, p.folge;

COMMENT ON VIEW mart.fn_zugang_stand IS
'Je FoodNotify-Marke und Eintrag, der das Scope-Token bevorzugt (Rezeptliste, Rezeptkopf, Zutaten, Meta,
Kassenartikel, Warenstamm): ueber welchen Zugang lief der letzte Lauf, und fiel er auf die Sitzung zurueck
(0160, Regel 10)? befund: ok / rueckfall kein token (Zustand, kein Fehler) / rueckfall abgewiesen (401/403)
/ rueckfall ausfall (Netz, Zeitgrenze, 429, 5xx, fremde Antwort) / nicht gefragt seit 48 h / nie gefragt.
Ein Rueckfall verliert keine Daten — die Sitzung liefert dieselben Zeilen (gemessen 19.11.2026) —, aber er
heisst, dass der Token-Weg nicht traegt. Ob Daten ankommen, sagt mart.quelle_zulauf, nicht diese Sicht.';
COMMENT ON COLUMN mart.fn_zugang_stand.zugang_letzter_lauf IS
'token = alle Aufrufe des letzten Laufs ueber das Token; sitzung = alle ueber die Sitzung; gemischt = beides
(typisch: ein Ausfall, danach weiter mit Token, oder Abweisung mitten im Lauf).';
COMMENT ON COLUMN mart.fn_zugang_stand.abrufe IS
'Aufgaben (Posten) dieser Marke und dieses Eintrags im letzten Lauf. Ein Rueckfall ist EINE Aufgabe mit zwei
Aufrufen (Token, dann Sitzung). Ueber Zeilen nicht summieren, um Aufrufe zu zaehlen.';
COMMENT ON COLUMN mart.fn_zugang_stand.erfolgreich IS
'Davon mit Ergebnis ok oder keine_daten — gleich welcher Zugang.';
COMMENT ON COLUMN mart.fn_zugang_stand.letzter_rueckfall_am IS
'Zeitpunkt des juengsten Rueckfalls ueberhaupt (auch aus aelteren Laeufen); letzter_rueckfall sagt die Art.';


-- ---------------------------------------------------------------------
-- 4. mart.pruefung_uebersicht — eine Zeile am Ende
--
-- Wie 0155/0157: die Definition aus der Zieldatenbank gelesen und
-- ergaenzt. Erwartung 0. Gezaehlt werden nur Abweisung und Ausfall im
-- letzten Lauf — kein Token ist ein Zustand und stuende sonst auf Dauer da.
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%fn_zugang_stand%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'FoodNotify: Token abgewiesen oder ausgefallen, laeuft ueber die Sitzung (letzter Lauf)'::text AS pruefung,
               count(*) FILTER (WHERE z.befund NOT IN ('nie gefragt', 'nicht gefragt seit 48 h'))::bigint AS geprueft,
               count(*) FILTER (WHERE z.befund IN ('rueckfall abgewiesen', 'rueckfall ausfall'))::bigint    AS auffaellig,
               'mart.fn_zugang_stand'::text AS sicht
          FROM mart.fn_zugang_stand z
        $zweig$);

    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def NOT LIKE '%FoodNotify: Token abgewiesen oder ausgefallen%' THEN
        RAISE EXCEPTION '0160: mart.pruefung_uebersicht traegt nach dem Umbau nicht die erwartete Zeile';
    END IF;
END $aussen$;


-- ---------------------------------------------------------------------
-- 5. MCP-Katalog
--
-- Nur Koernung, Thema, Summierbarkeit und eine Kennzahlregel — keine neue
-- Regelart (AGENTS.md, mcp-Regel 1).
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.fn_zugang_stand',
     'FoodNotify-Marke × Registereintrag mit Token-Weg (Rezepte, Kassenartikel, Warenstamm) — Zugang im letzten Lauf',
     'pruefung', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

INSERT INTO mcp.kennzahl (sicht, spalte, regel, einheit, hinweis) VALUES
  ('mart.fn_zugang_stand', 'abrufe', 'nicht_aggregieren', 'anzahl',
   'Aufgaben im letzten Lauf je Marke und Eintrag; die Laeufe der Zeilen koennen verschieden sein.')
ON CONFLICT (sicht, spalte) DO UPDATE
   SET regel = excluded.regel, einheit = excluded.einheit, hinweis = excluded.hinweis;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


-- ---------------------------------------------------------------------
-- 6. Rechte und die Gegenprobe als Leserolle (Pflicht seit 0110)
--
-- mcp.rechte_auffrischen() vergibt die Rechte (seit 0153 ohne das
-- Zugriffsprotokoll) — kein eigener GRANT-Block hier. Danach muss
-- mart.mcp_rechte_pruefung leer sein, die neue Sicht als mcp_leser lesbar
-- und mcp.zugriff unlesbar.
-- ---------------------------------------------------------------------

SELECT mcp.rechte_auffrischen();

DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
    v_rechte  int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0160 ist uebersprungen';
        RETURN;
    END IF;

    SELECT count(*) INTO v_rechte FROM mart.mcp_rechte_pruefung;
    IF v_rechte > 0 THEN
        RAISE EXCEPTION '0160: mart.mcp_rechte_pruefung ist nicht leer (% Zeilen)', v_rechte;
    END IF;

    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0160 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.fn_zugang_stand LIMIT 1',
        'SELECT * FROM mart.pruefung_uebersicht WHERE sicht = ''mart.fn_zugang_stand''']
    LOOP
        BEGIN
            EXECUTE v_abfrage;
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_abfrage, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    BEGIN
        EXECUTE 'SELECT * FROM mcp.zugriff LIMIT 1';
        v_liegen := v_liegen || 'mcp.zugriff ist fuer mcp_leser lesbar'::text;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0160 hat sein Ziel nicht erreicht — fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
