-- =====================================================================
-- 0164 — Die Nachtmeldung sagt nur noch, was stimmt
--
-- Anlass: die Statusmeldungen der Laeufe 209 bis 213 (21.–25.11.2026)
-- standen jede Nacht auf Warnung, und drei der Gruende waren keine:
--
--   A. „10 Posten endgueltig aufgegeben — diese Zeitraeume fehlen
--      dauerhaft". Alle zehn sind fn:bestellpositionen der Kostenstelle
--      10262 vom 06.09.2026 — und alle zehn Bestellungen HABEN ihre
--      Positionen: geholt am 24./25.08.2026, Fingerabdruck von Liste und
--      Detail bis heute gleich (in Produktion nachgesehen am 25.11.2026).
--      Gescheitert war ein spaeterer Nachabruf, die Daten sind da.
--      → zustand 'ueberholt' in mart.posten_aufgegeben.
--
--   B. 218 Posten „werden erneut versucht", jede Nacht neu: neun
--      FoodNotify-Kostenstellen antworten seit dem 12./13.11.2026 (13131
--      seit dem 20.11.) mit HTTP 200 und der Huelle „No Erp Found!" —
--      Aposto Augsburg Kueche/Bar (geschlossen), Aposto Aachen Alte Post,
--      Riegele Wirtshaus, Aposto Muenster, Service Enchilada Rosenheim.
--      Bis dahin lieferten alle neun normal. Sie waeren in drei Naechten
--      „endgueltig" geworden. Dazu kippte jede von ihnen beim Warenstamm das
--      Token der ganzen Marke auf die Sitzung (403 „This endpoint does not
--      support scope-limited tokens"), sichtbar als falsches „Token
--      pruefen" in mart.fn_zugang_stand.
--      → core.kostenstelle.erp_fehlt_seit / erp_fehlt_zuletzt, Ergebnis
--        'erp_fehlt', Sicht mart.kostenstelle_ohne_erp, Zustand 'erp fehlt'
--        in mart.warenstamm_stand. Der Importer fragt eine solche
--        Kostenstelle nur noch einmal je FN_ERP_FEHLT_PROBE_TAGE (7) ab;
--        liefert sie wieder, ist die Markierung weg (src/sync/worker.ts).
--      → Rueckfallgrund 'ressource' fuer genau dieses 403: es gilt der
--        Kostenstelle, nicht dem Token (src/foodnotify/client.ts).
--
--   C. Schemaabweichungen getReport:96 „Summe der Bons = balanceSumBrutto":
--      fuenf offen, drei davon (134, 461, 474) DIESELBE Woche desselben
--      Betriebs mit denselben Zahlen, je Neuabruf eine neue Zeile. Am
--      21.11.2026 entschieden: die Abweichungen bleiben stehen (zu klein,
--      LINAs Summe). Sie hielten die Meldung trotzdem jede Nacht gelb.
--      → hier quittiert; der Lader meldet dieselbe Abweichung nicht
--        wieder (src/sync/betriebsbericht_laden.ts).
--
-- raw bleibt unberuehrt. Geschlossen werden nur Posten in
-- sync.warteschlange, deren letzter Fehler „No Erp Found" war.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Kostenstelle ohne Warenwirtschaft
-- ---------------------------------------------------------------------

ALTER TABLE core.kostenstelle
    ADD COLUMN IF NOT EXISTS erp_fehlt_seit    timestamptz,
    ADD COLUMN IF NOT EXISTS erp_fehlt_zuletzt timestamptz;

COMMENT ON COLUMN core.kostenstelle.erp_fehlt_seit IS
'Seit wann FoodNotify fuer diese erpId mit „No Erp Found!" antwortet (HTTP 200, Huellenfehler; 0164). Gesetzt
vom Worker beim ersten solchen Fehler, geloescht beim ersten erfolgreichen Abruf mit dieser erpId. Solange
gesetzt, reiht der Importer Bestellungen, Inventuren und Warenstamm nur einmal je FN_ERP_FEHLT_PROBE_TAGE ein.
Sichtbar in mart.kostenstelle_ohne_erp. NULL = Warenwirtschaft antwortet.';
COMMENT ON COLUMN core.kostenstelle.erp_fehlt_zuletzt IS
'Letzte Antwort „No Erp Found!" fuer diese erpId (0164). Ab hier zaehlt die Frist bis zur naechsten Probe.';

-- Nachtrag aus dem Protokoll: die erste „No Erp Found"-Antwort nach dem
-- letzten erfolgreichen Abruf derselben erpId (60 Tage reichen — alle neun
-- begannen am 12./13. bzw. 20.11.2026).
WITH f AS (
    SELECT a.marke_key, (a.parameter->>'erpId')::int AS erp_id, a.beendet_am, a.status,
           coalesce(a.fehler, '') LIKE '%No Erp Found%' AS ohne_erp
      FROM sync.aufgabe a
     WHERE a.endpunkt LIKE 'fn:%'
       AND a.parameter ? 'erpId'
       AND a.parameter->>'erpId' ~ '^[0-9]+$'
       AND a.beendet_am > now() - interval '60 days'
), ok AS (
    SELECT marke_key, erp_id, max(beendet_am) AS ok_am FROM f WHERE status = 'ok' GROUP BY 1, 2
), fehlt AS (
    SELECT f.marke_key, f.erp_id, min(f.beendet_am) AS seit, max(f.beendet_am) AS zuletzt
      FROM f LEFT JOIN ok USING (marke_key, erp_id)
     WHERE f.ohne_erp AND (ok.ok_am IS NULL OR f.beendet_am > ok.ok_am)
     GROUP BY 1, 2
)
UPDATE core.kostenstelle k
   SET erp_fehlt_seit = fehlt.seit, erp_fehlt_zuletzt = fehlt.zuletzt
  FROM fehlt
 WHERE k.marke_key = fehlt.marke_key AND k.erp_id = fehlt.erp_id;


-- ---------------------------------------------------------------------
-- 2. Ergebnis 'erp_fehlt' und Rueckfallgrund 'ressource'
-- ---------------------------------------------------------------------

ALTER TABLE sync.warteschlange DROP CONSTRAINT IF EXISTS warteschlange_ergebnis_check;
ALTER TABLE sync.warteschlange ADD CONSTRAINT warteschlange_ergebnis_check
    CHECK (ergebnis IN ('ok', 'keine_daten', 'aufgegeben', 'kein_zugriff',
                        'fenster_zu_gross', 'abgeschaltet', 'nicht_gefunden', 'ersatzweg',
                        'ladefehler', 'erp_fehlt'));

COMMENT ON CONSTRAINT warteschlange_ergebnis_check ON sync.warteschlange IS
'erp_fehlt (0164): FoodNotify antwortet fuer die erpId mit „No Erp Found!" — die Kostenstelle hat keine
Warenwirtschaft mehr. Beantwortet, nicht gescheitert: nicht wiederbelebt, nicht in mart.posten_aufgegeben;
zu sehen in mart.kostenstelle_ohne_erp. ersatzweg (0135): der Posten ist gescheitert, aber seine Daten kamen
ueber einen anderen Weg (fn:bestellpositionen → fn:bestellansicht).';

ALTER TABLE sync.aufgabe DROP CONSTRAINT IF EXISTS aufgabe_zugang_check;
ALTER TABLE sync.aufgabe ADD CONSTRAINT aufgabe_zugang_check
    CHECK ((zugang IS NULL OR zugang IN ('sitzung', 'token'))
           AND (zugang_bevorzugt IS NULL OR zugang_bevorzugt IN ('sitzung', 'token'))
           AND (zugang_rueckfall IS NULL OR zugang_rueckfall IN ('kein_token', 'abgewiesen', 'ausfall', 'ressource'))) NOT VALID;

COMMENT ON COLUMN sync.aufgabe.zugang_rueckfall IS
'Warum dieser Aufruf nicht ueber das bevorzugte Token ging: kein_token (fuer die Marke keins in
FN_API_TOKENS — ein Zustand, kein Fehler), abgewiesen (401/403; der Lauf fragt diesen Eintrag der Marke
danach nicht mehr mit Token), ausfall (Netz, Zeitgrenze, 429, 5xx, unlesbare oder fremde Antwort; nach drei
Ausfaellen in Folge laeuft die Marke fuer den Rest des Laufs ueber die Sitzung), ressource (0164: 403 „This
endpoint does not support scope-limited tokens" — gemessen nur an Kostenstellen ohne Warenwirtschaft; gilt
der einen Ressource, das Token bleibt fuer den Rest der Marke). NULL = kein Rueckfall.';

-- Offene und aufgegebene Posten der neun Kostenstellen schliessen. Nur, wo
-- der letzte Fehler genau das war — alles andere bleibt, wie es ist.
UPDATE sync.warteschlange w
   SET ergebnis = 'erp_fehlt', erledigt_am = coalesce(w.erledigt_am, now()), in_arbeit_seit = NULL
  FROM core.kostenstelle k
 WHERE k.erp_fehlt_seit IS NOT NULL
   AND w.marke_key = k.marke_key
   AND w.parameter->>'erpId' = k.erp_id::text
   AND w.letzter_fehler LIKE '%No Erp Found%'
   AND (w.ergebnis = 'aufgegeben' OR w.erledigt_am IS NULL);


-- ---------------------------------------------------------------------
-- 3. mart.posten_aufgegeben: 'ueberholt'
--
-- Ueberholt ist ein aufgegebener Posten, dessen Daten trotzdem da sind:
--   * derselbe Posten (Endpunkt, Marke, Betrieb, Parameter, Zeitraum) ist
--     SPAETER gelungen, oder
--   * fn:bestellung / fn:bestellpositionen: die Bestellung steht in core,
--     ihr Detail passt zum juengsten Listeneintrag (Fingerabdruck gleich,
--     0098) und — bei den Positionen — sie hat Positionen.
-- Die Zeile bleibt sichtbar; sie ist nur nicht mehr „endgueltig".
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.posten_aufgegeben AS
SELECT w.posten_id,
       w.endpunkt,
       m.schluessel AS marke,
       w.zeitraum_von,
       w.parameter,
       w.versuche,
       w.wiederbelebt,
       w.erledigt_am AS zuletzt_aufgegeben,
       left(w.letzter_fehler, 200) AS fehler,
       CASE
           WHEN EXISTS (SELECT 1
                          FROM sync.warteschlange w2
                         WHERE w2.endpunkt = w.endpunkt
                           AND w2.zeitraum_von = w.zeitraum_von
                           AND w2.zeitraum_bis = w.zeitraum_bis
                           AND w2.marke_key IS NOT DISTINCT FROM w.marke_key
                           AND w2.betrieb_enc_id IS NOT DISTINCT FROM w.betrieb_enc_id
                           AND w2.parameter IS NOT DISTINCT FROM w.parameter
                           AND w2.ergebnis IN ('ok', 'keine_daten', 'ersatzweg')
                           AND w2.erledigt_am > w.erledigt_am)
             OR (w.endpunkt IN ('fn:bestellung', 'fn:bestellpositionen')
                 AND EXISTS (SELECT 1
                               FROM core.kostenstelle k
                               JOIN core.bestellung b ON b.kostenstelle_key = k.kostenstelle_key
                              WHERE k.marke_key = w.marke_key
                                AND k.erp_id::text = w.parameter->>'erpId'
                                AND b.fn_id = w.parameter->>'orderId'
                                AND b.detail_fingerabdruck IS NOT NULL
                                AND b.detail_fingerabdruck = b.listen_fingerabdruck
                                AND (w.endpunkt = 'fn:bestellung'
                                     OR EXISTS (SELECT 1 FROM core.bestellposition p
                                                 WHERE p.bestellung_key = b.bestellung_key))))
           THEN 'ueberholt'
           WHEN w.ergebnis = 'ladefehler' OR w.wiederbelebt >= 3 THEN 'endgueltig'
           ELSE 'wird erneut versucht'
       END AS zustand,
       (EXISTS (SELECT 1
                  FROM sync.aufgabe a
                 WHERE a.endpunkt = w.endpunkt
                   AND a.status = 'ok'
                   AND a.beendet_am > now() - interval '24 hours')) AS quelle_antwortet
  FROM sync.warteschlange w
  LEFT JOIN core.marke m ON m.marke_key = w.marke_key
 WHERE w.ergebnis IN ('aufgegeben', 'ladefehler')
 ORDER BY w.wiederbelebt DESC, w.erledigt_am DESC;

COMMENT ON VIEW mart.posten_aufgegeben IS
'Posten, die der Worker aufgegeben hat. ERWARTUNG: leer, oder nur Zeilen mit
zustand = endgueltig und einer Begruendung, die jemand gelesen hat.

  wird erneut versucht  der naechtliche Lauf holt ihn zurueck, solange
                        quelle_antwortet true ist. Hoechstens dreimal.
  endgueltig            der Vorrat ist aufgebraucht — oder das Laden ist
                        LADEFEHLER_MAX_VERSUCHE mal gescheitert (0136): die
                        Antwort kam, aber sie liess sich nicht nach core
                        schreiben. Die Antwort steht in raw.api_antwort
                        (ladefehler). Das ist ein Baufehler oder Unsinn in der
                        Quelle, und er gehoert geprueft, nicht ignoriert.
  ueberholt (0164)      aufgegeben, aber die Daten sind da: derselbe Posten ist
                        spaeter gelungen, oder (fn:bestellung/-positionen) die
                        Bestellung steht in core und ihr Detail passt zum
                        juengsten Listeneintrag. Kein Befund. Anlass: zehn
                        Positionsabrufe von 10262 vom 06.09.2026 meldeten
                        bis 25.11.2026 jede Nacht „fehlen dauerhaft", obwohl
                        alle zehn Bestellungen vollstaendig in core standen.

DIE 3 STEHT HIER FEST VERDRAHTET UND MUSS ZU config.MAX_WIEDERBELEBUNGEN PASSEN.
Eine Sicht kann keine Umgebungsvariable lesen; eine Einstellungstabelle waere mehr
Bau, als das Problem verdient. Wer MAX_WIEDERBELEBUNGEN aendert, aendert damit still
die Bedeutung dieser Spalte — und die von src/status.ts, das seit 0164 diese Sicht
liest. Deshalb haelt src/config.test.ts den Vorgabewert auf 3 fest: der rote Test
fuehrt zu dieser Zeile. Geaendert wird also beides oder keines.

Am 13.08.2026 standen hier 275 Zeilen, ausnahmslos fn:bestellpositionen mit HTTP 500
aus dem Backfill vom 02. bis 04.08.2026 — und mit ihnen 322 Bestellungen ueber
686.535,93 EUR, die einen Kopf hatten und keine einzige Position. Nach dem ersten Lauf
mit der Wiederbelebung (0070) waren es 0 von 66.966; die Bestellungen ohne Position
sind auf 47 gefallen.

wiederbelebt ist NICHT versuche: versuche zaehlt die Anlaeufe innerhalb eines Lebens
und faengt nach dem Wiederbeleben bei 0 an, wiederbelebt zaehlt die Leben.';


-- ---------------------------------------------------------------------
-- 4. mart.kostenstelle_ohne_erp — Regel 10: still gelegt heisst sichtbar
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.kostenstelle_ohne_erp AS
SELECT m.name                                   AS marke,
       k.kostenstelle_key,
       k.kostenstelle_id,
       k.name                                   AS kostenstelle,
       k.erp_id,
       k.betrieb_key,
       b.name                                   AS betrieb,
       k.erp_fehlt_seit,
       k.erp_fehlt_zuletzt,
       (k.erp_fehlt_zuletzt + make_interval(days => 7))::date AS naechste_probe_ab,
       (SELECT max(bs.bestellt_am) FROM core.bestellung bs
         WHERE bs.kostenstelle_key = k.kostenstelle_key)       AS letzte_bestellung
  FROM core.kostenstelle k
  JOIN core.marke m ON m.marke_key = k.marke_key
  LEFT JOIN core.betrieb b ON b.betrieb_key = k.betrieb_key
 WHERE k.erp_fehlt_seit IS NOT NULL;

COMMENT ON VIEW mart.kostenstelle_ohne_erp IS
'FoodNotify-Kostenstellen, deren Warenwirtschaft verschwunden ist: jede Anfrage mit ihrer erpId kommt mit
„No Erp Found!" zurueck (0164). Der Importer fragt sie nur noch einmal je FN_ERP_FEHLT_PROBE_TAGE (7) ab —
Bestellungen, Inventuren, Warenstamm; naechste_probe_ab ist geschaetzt aus dieser Frist. Liefert eine Probe
wieder, verschwindet die Zeile von selbst. Erwartung: geschlossene oder abgegebene Betriebe, Testkostenstellen.
Steht hier ein laufender Betrieb, fehlen dessen Einkauf und Warenstamm — eine Frage an FoodNotify bzw. an den
Betrieb, kein Importfehler. Am 25.11.2026: neun Kostenstellen (Aposto Augsburg, Aposto Aachen Alte Post,
Riegele Wirtshaus, Aposto Muenster, Service Enchilada Rosenheim).';


-- ---------------------------------------------------------------------
-- 5. mart.warenstamm_stand: Zustand 'erp fehlt'
--
-- Unveraendert bis auf ks.erp_fehlt_seit und die eine WHEN-Zeile. Die
-- Pruefzeile in mart.pruefung_uebersicht zaehlt nur nie geladen /
-- unvollstaendig / veraltet / leer als auffaellig — 'erp fehlt' faellt
-- damit heraus, ohne dass sie angefasst wird.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.warenstamm_stand AS
WITH aktiv AS (
    SELECT (merker.wert -> 'marken'::text) AS marken
      FROM sync.merker
     WHERE merker.schluessel = 'warenstamm_marken'::text
), ks AS (
    SELECT k_1.kostenstelle_key,
           k_1.marke_key,
           m.name AS marke,
           k_1.betrieb_key,
           b.name AS betrieb,
           k_1.kostenstelle_id,
           k_1.name AS kostenstelle,
           k_1.art AS kostenstelle_art,
           k_1.erp_id,
           k_1.erp_fehlt_seit,
           COALESCE((SELECT (a_1.marken ? m.schluessel) FROM aktiv a_1), false) AS marke_aktiv
      FROM core.kostenstelle k_1
      JOIN core.marke m ON m.marke_key = k_1.marke_key
      LEFT JOIN core.betrieb b ON b.betrieb_key = k_1.betrieb_key
     WHERE k_1.erp_id IS NOT NULL
), zugriff AS (
    SELECT DISTINCT ON (w.marke_key, (w.parameter ->> 'erpId'::text)) w.marke_key,
           (w.parameter ->> 'erpId'::text) AS erp_id,
           w.ergebnis
      FROM sync.warteschlange w
     WHERE w.endpunkt = 'fn:warenstamm'::text AND w.erledigt_am IS NOT NULL
     ORDER BY w.marke_key, (w.parameter ->> 'erpId'::text), w.erledigt_am DESC
), produkte AS (
    SELECT ware_stand.kostenstelle_key,
           count(*) FILTER (WHERE ware_stand.fehlt_seit IS NULL) AS produkte,
           count(*) FILTER (WHERE ware_stand.fehlt_seit IS NOT NULL) AS nicht_mehr_geliefert,
           count(*) FILTER (WHERE ware_stand.fehlt_seit IS NULL AND COALESCE(ware_stand.listenpreis, 0::numeric) = 0::numeric) AS ohne_preis,
           count(*) FILTER (WHERE ware_stand.fehlt_seit IS NULL AND ware_stand.artikelnummer IS NULL AND ware_stand.rezept_fn_id IS NULL) AS ohne_artikelnummer,
           count(*) FILTER (WHERE ware_stand.fehlt_seit IS NULL AND ware_stand.rezept_fn_id IS NOT NULL) AS eigenproduktion,
           count(*) FILTER (WHERE ware_stand.fehlt_seit IS NULL AND ware_stand.katalogpreis > 0::numeric) AS mit_katalogpreis
      FROM core.ware_stand
     GROUP BY ware_stand.kostenstelle_key
), verlauf AS (
    SELECT listenpreis_beobachtung.kostenstelle_key,
           min(listenpreis_beobachtung.gueltig_ab) AS reihe_ab
      FROM core.listenpreis_beobachtung
     GROUP BY listenpreis_beobachtung.kostenstelle_key
), aenderung AS (
    SELECT a_1.kostenstelle_key,
           count(*) FILTER (WHERE a_1.preisart = 'listenpreis'::text) AS preisaenderungen_30_tage,
           count(*) FILTER (WHERE a_1.preisart = 'katalogpreis'::text) AS katalogaenderungen_30_tage
      FROM mart.listenpreis_aenderung a_1
     WHERE a_1.gueltig_ab >= (CURRENT_DATE - 30) AND a_1.vergleichbar
     GROUP BY a_1.kostenstelle_key
)
SELECT k.marke,
       k.marke_aktiv,
       k.betrieb_key,
       k.betrieb,
       k.kostenstelle_id,
       k.kostenstelle,
       k.kostenstelle_art,
       k.erp_id,
       CASE
           WHEN NOT k.marke_aktiv THEN 'marke nicht aktiv'::text
           WHEN z.ergebnis = 'kein_zugriff'::text THEN 'kein zugriff'::text
           WHEN k.erp_fehlt_seit IS NOT NULL THEN 'erp fehlt'::text
           WHEN ab.kostenstelle_key IS NULL THEN 'nie geladen'::text
           WHEN ab.befund IS NOT NULL THEN 'unvollstaendig'::text
           WHEN ab.vollstaendig_am IS NULL OR ab.vollstaendig_am < (now() - '36:00:00'::interval) THEN 'veraltet'::text
           WHEN COALESCE(p.produkte, 0::bigint) = 0 THEN 'leer'::text
           WHEN k.betrieb_key IS NULL THEN 'ohne betrieb'::text
           ELSE 'ok'::text
       END AS zustand,
       ab.letzter_abruf_am,
       ab.vollstaendig_am,
       ab.abzug_tag,
       ab.seiten_gesamt AS seiten,
       ab.produkte_gemeldet,
       COALESCE(p.produkte, 0::bigint)::integer AS produkte,
       COALESCE(p.nicht_mehr_geliefert, 0::bigint)::integer AS nicht_mehr_geliefert,
       COALESCE(p.ohne_preis, 0::bigint)::integer AS ohne_preis,
       COALESCE(p.ohne_artikelnummer, 0::bigint)::integer AS ohne_artikelnummer,
       COALESCE(p.eigenproduktion, 0::bigint)::integer AS eigenproduktion,
       COALESCE(p.mit_katalogpreis, 0::bigint)::integer AS mit_katalogpreis,
       v.reihe_ab,
       COALESCE(a.preisaenderungen_30_tage, 0::bigint)::integer AS preisaenderungen_30_tage,
       COALESCE(a.katalogaenderungen_30_tage, 0::bigint)::integer AS katalogaenderungen_30_tage,
       ab.befund
  FROM ks k
  LEFT JOIN core.ware_stand_abruf ab ON ab.kostenstelle_key = k.kostenstelle_key
  LEFT JOIN zugriff z ON z.marke_key = k.marke_key AND z.erp_id = k.erp_id::text
  LEFT JOIN produkte p ON p.kostenstelle_key = k.kostenstelle_key
  LEFT JOIN verlauf v ON v.kostenstelle_key = k.kostenstelle_key
  LEFT JOIN aenderung a ON a.kostenstelle_key = k.kostenstelle_key;

COMMENT ON VIEW mart.warenstamm_stand IS
'Je Kostenstelle mit Warenwirtschaft (erpId): kommt der Warenstamm an (0157, Regel 10)? zustand: ok / marke nicht
aktiv (nicht in WARENSTAMM_MARKEN) / kein zugriff (FoodNotify verweigert die Kostenstelle dauerhaft, 0075) /
erp fehlt (0164: FoodNotify kennt die Warenwirtschaft der Kostenstelle nicht mehr, „No Erp Found!" — siehe
mart.kostenstelle_ohne_erp) / nie geladen / unvollstaendig (eine Folgeseite meldete eine andere Gesamtzahl) /
veraltet (letzter VOLLSTAENDIGER Abzug aelter als 36 h) / leer / ohne betrieb (Kostenstelle keinem Betrieb
zugeordnet — darunter die Testkostenstellen "AAA Testrestaurant", "… TESTBETRIEB", die mit geladen werden).
Dazu die Zahl der Produkte der letzten Antwort, ohne Preis, ohne Artikelnummer, Eigenproduktion, und reihe_ab:
ab diesem Tag gibt es fuer die Kostenstelle eine Preisreihe — davor nicht.';


-- ---------------------------------------------------------------------
-- 6. Die Bon-Summen-Abweichungen von Bericht 96 quittieren
--
-- Entscheidung 21.11.2026: stehen lassen. Quittiert wird nur genau diese
-- Pruefung; jede andere offene Abweichung bleibt offen.
-- ---------------------------------------------------------------------

UPDATE sync.schema_abweichung
   SET quittiert_am = now()
 WHERE quittiert_am IS NULL
   AND endpunkt = 'getReport:96'
   AND erwartet->>'hinweis' = 'Summe der Bons = balanceSumBrutto';


-- ---------------------------------------------------------------------
-- 7. MCP-Katalog (Pflicht seit 0129, vergessen in 0161/0162 — 0163)
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.kostenstelle_ohne_erp',
     'FoodNotify-Kostenstelle ohne Warenwirtschaft („No Erp Found") — seit wann, letzte Bestellung, naechste Probe',
     'einkauf', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

DO $pruefen$
DECLARE
    v_fehlt int;
    v_offen int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM mcp.sicht WHERE sicht = 'mart.kostenstelle_ohne_erp' AND koernung IS NOT NULL) THEN
        RAISE EXCEPTION '0164: mart.kostenstelle_ohne_erp steht nicht mit Koernung in mcp.sicht';
    END IF;
    IF EXISTS (SELECT 1
                 FROM unnest(ARRAY['posten_aufgegeben', 'warenstamm_stand', 'kostenstelle_ohne_erp']) AS t(relname)
                 JOIN pg_class c ON c.relname = t.relname AND c.relnamespace = 'mart'::regnamespace
                WHERE coalesce(obj_description(c.oid, 'pg_class'), '') NOT LIKE '%Koernung:%') THEN
        RAISE EXCEPTION '0164: mindestens eine der drei Sichten traegt keinen Koernungsanhang im Kommentar';
    END IF;
    -- Kein „No Erp Found"-Posten darf offen oder aufgegeben bleiben, dessen
    -- Kostenstelle markiert ist.
    SELECT count(*) INTO v_offen
      FROM sync.warteschlange w
      JOIN core.kostenstelle k ON k.marke_key = w.marke_key AND w.parameter->>'erpId' = k.erp_id::text
     WHERE k.erp_fehlt_seit IS NOT NULL
       AND w.letzter_fehler LIKE '%No Erp Found%'
       AND (w.ergebnis = 'aufgegeben' OR w.erledigt_am IS NULL);
    IF v_offen > 0 THEN
        RAISE EXCEPTION '0164: % „No Erp Found"-Posten sind noch offen oder aufgegeben', v_offen;
    END IF;
    SELECT count(*) INTO v_fehlt FROM core.kostenstelle WHERE erp_fehlt_seit IS NOT NULL;
    RAISE NOTICE '0164: % Kostenstellen ohne Warenwirtschaft markiert', v_fehlt;
END $pruefen$;


-- Rechte und die Gegenprobe als Leserolle (Pflicht seit 0110)

SELECT mcp.rechte_auffrischen();

DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
    v_rechte  int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0164 ist uebersprungen';
        RETURN;
    END IF;

    SELECT count(*) INTO v_rechte FROM mart.mcp_rechte_pruefung;
    IF v_rechte > 0 THEN
        RAISE EXCEPTION '0164: mart.mcp_rechte_pruefung ist nicht leer (% Zeilen)', v_rechte;
    END IF;

    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0164 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.kostenstelle_ohne_erp LIMIT 1',
        'SELECT * FROM mart.posten_aufgegeben LIMIT 1',
        'SELECT * FROM mart.warenstamm_stand LIMIT 1']
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
        RAISE EXCEPTION '0164 hat sein Ziel nicht erreicht — fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
