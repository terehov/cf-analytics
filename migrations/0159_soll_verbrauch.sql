-- =====================================================================
-- 0159 Soll-Verbrauch aus Kasse x Rezept (Entscheidung Eugene, 19.11.2026)
--
-- ANLASS. FoodNotifys eigene Verkaeufe taugen nicht als Quelle fuer den
-- Soll-Verbrauch (docs/payloads/foodnotify-2026-11/fn-probe-2026-11-19-
-- warenkorb-verkaeufe.md, docs/entscheidungen.md 19.11.2026): Einzelbons mit
-- einem Detailabruf je Bon, Historie erst ab der Anbindung (Aug./Sept. 2026),
-- Bar und Kueche tragen dieselben Bons, die Position traegt keine PLU. Statt
-- dessen rechnen wir selbst:
--
--     LINA-Artikelverkauf  x  core.pos_artikel (Kassenartikel -> Rezept)
--                          x  aufgeloestes Rezept (Zutaten je Portion)
--
-- WAS DIESE MIGRATION ANLEGT
--   1. core.einheit_metrisch()            — g/kg/cl/ml/l -> kg oder l
--   2. mart.rezept_stueckliste_basis      — MATERIALISIERT: je Rezept die
--      mart.rezept_stueckliste              Waren ueber alle Unterrezept-Ebenen,
--                                           Menge je verkaufter Portion,
--                                           belastbar ja/nein mit Grund
--   3. mart.soll_rezept_zuordnung         — Betrieb x LINA-Artikel -> EIN Rezept
--                                           (Regel fuer Bar/Kueche)
--   4. mart.soll_artikel_monat            — Betrieb x Monat x Artikel: verkauft,
--                                           Rezept, soll_zustand
--   5. mart.soll_verbrauch_abdeckung      — Betrieb x Monat: welcher Anteil von
--                                           Umsatz und Menge eingeht (PFLICHT)
--   6. mart.soll_verbrauch_monat          — Betrieb x Monat x Ware: Soll-Menge
--   7. mart.soll_verbrauch_tag            — Betrieb x Tag x Ware: Soll-Menge
--   8. mart.soll_ist_monat                — Soll neben Einkauf, KEIN Schwund
--   9. Verankerung in mart.materialisierung_stand (Einkaufs-Nachlauf)
--  10. MCP-Katalog, Fallstricke, Rechte, Leseprobe als mcp_leser
--
-- DIE UMRECHNUNG UEBER UNTERREZEPTE (warum docs/plan-rezepturen.md §4 hier
-- nicht mehr gilt). 0132 multiplizierte bewusst nicht, weil Einheiten frei
-- sind und die Ausbeute des Halbfabrikats unbekannt schien. Am echten
-- Enchilada-Einzelabzug (2.111 Rezepte, belege/coyacan/rezepte, 19.11.2026
-- nachgemessen) gilt:
--   * meta.weight.total ist die Summe der metrischen Zutatenmengen mit
--     DICHTE 1 (1 cl = 10 g, 1 ml = 1 g): 1.064 von 1.069 rein metrischen
--     Rezepten, 585 von 590 mit Volumenzutaten.
--   * Der Anteil "Menge der Unterrezept-Zeile in g / weight.total des
--     Unterrezepts" reproduziert FoodNotifys eigene Kosten der Zeile auf
--     2 % genau: g 82 % (884 von 1.077), cl 87 %, ml/kg/l 100 %, Einheit
--     "Portion" mit weight.perPerson 98,5 % (134 von 136).
--   * "Stück" (265 Zeilen) trifft als Portion nur in 114 Faellen,
--     "Portionierer ..." (rund 280 Zeilen) nie — FoodNotify rechnet dort mit
--     einem Gewicht, das die Schnittstelle nicht liefert. Diese Zeilen werden
--     NICHT geraten, sondern als nicht umrechenbar gekennzeichnet; alles
--     darunter bleibt sichtbar (Ware und Pfad), aber ohne Menge.
--   * Die Kassenrezepte selbst sind eine Portion: 124 von 124 geladenen
--     Kassenrezepten von Enchilada Koeln haben weight.total = perPerson.
--
-- GEBAUT gegen den Klon lina_mgmt -> 0159 mit dem echten Enchilada-
-- Einzelabzug (Rezepte vom 14./15.09.2026, Kassenartikel der Koelner
-- Kuechenkasse) ueber den echten Lader, und gegen synthetische Rezepte in
-- src/foodnotify/soll_verbrauch_db.test.ts. In Produktion NICHT gelaufen:
-- dort ist core.pos_artikel erst nach dem Deploy von 0155 gefuellt, und
-- vorerst nur fuer Wilma Wunder (POS_ARTIKEL_MARKEN).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. core.einheit_metrisch — eine Einheit in kg oder l
--
-- Nur, was eindeutig ist. "Portionierer Silber (60g)" bleibt unbekannt:
-- die 60 g im Namen trafen FoodNotifys eigene Kosten in keiner von 63
-- Zeilen (19.11.2026). Freitext wird nicht ausgelegt.
-- ---------------------------------------------------------------------

CREATE FUNCTION core.einheit_metrisch(p_einheit text, OUT basis text, OUT faktor numeric)
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN e IN ('g', 'gr', 'gramm', 'kg', 'mg') THEN 'kg'
                WHEN e IN ('ml', 'cl', 'dl', 'l', 'ltr', 'liter') THEN 'l' END,
           CASE e WHEN 'g' THEN 0.001 WHEN 'gr' THEN 0.001 WHEN 'gramm' THEN 0.001
                  WHEN 'kg' THEN 1 WHEN 'mg' THEN 0.000001
                  WHEN 'ml' THEN 0.001 WHEN 'cl' THEN 0.01 WHEN 'dl' THEN 0.1
                  WHEN 'l' THEN 1 WHEN 'ltr' THEN 1 WHEN 'liter' THEN 1 END
      FROM (SELECT lower(btrim(p_einheit)) AS e) x
$$;

COMMENT ON FUNCTION core.einheit_metrisch(text) IS
'Rezept- oder Basiseinheit -> (basis, faktor): basis kg fuer g/gr/gramm/kg/mg, l fuer ml/cl/dl/l/ltr/liter,
faktor = wie viel kg bzw. l EINE Einheit ist (g -> 0.001). Alles andere (Stueck, Portionierer, Scheibe,
Freitext) -> (NULL, NULL): nicht umrechenbar, wird nicht geraten (0159).';


-- ---------------------------------------------------------------------
-- 2. mart.rezept_stueckliste_basis — das aufgeloeste Rezept
--
-- Eine Zeile je Rezept (Wurzel) und Weg zu einer Ware, ueber alle Ebenen.
-- menge_je_portion ist die Menge der Ware fuer EINE verkaufte Portion des
-- Wurzelrezepts, in einheit_soll (kg/l, wo metrisch, sonst die Einheit des
-- Rezepts, z. B. "Stück").
--
-- FAKTOR. Wurzel: weight.perPerson / weight.total (die Portion; bei allen
-- 124 gemessenen Kassenrezepten 1). Ohne Gewicht: 1 = das ganze Rezept ist
-- eine verkaufte Einheit (portion_regel sagt es). Je Unterrezept-Ebene mal
-- dem Teil, den die Zeile vom Unterrezept nimmt:
--   metrische Einheit   Menge in g (Dichte 1, wie FoodNotify) / weight.total
--   "Portion(en)"       Menge x perPerson / total
--   baseQuantity        basis_menge in g / total — wo FoodNotify die freie
--                       Einheit selbst umrechnet. Auf Unterrezept-Zeilen NIE
--                       GEMESSEN (im Einzelabzug fehlt das Feld noch), daher
--                       ueber_basismenge als eigene Spalte
--   sonst               NULL -> belastbar = false, grund nennt die Einheit
-- Ist ein Faktor NULL, sind alle Waren darunter ohne Menge, aber mit Pfad
-- sichtbar: was nicht umgerechnet werden kann, faellt nicht still weg.
--
-- LUECKEN als eigene Zeilen (art = 'luecke', belastbar = false):
--   rezept ohne zutaten / zutaten nicht geladen    — die Wurzel selbst
--   unterrezept unbekannt                          — Verweis, Rezept fehlt
--   unterrezept ohne zutaten                       — Halbfabrikat leer
--   zyklus / tiefe ueberschritten                  — Schutz wie in 0132
--
-- verlust_roh (meta.weight.loss) geht NICHT ein: seine Bedeutung ist offen
-- (0132), und die Kostengegenprobe oben trifft ohne ihn.
--
-- MATERIALISIERT: die Rekursion laeuft ueber alle Rezepte (Produktion rund
-- 17.700), und eine Sicht darueber koennte keinen Filter nach innen geben —
-- jede Karte rechnete alle Rezepte aller Marken neu. Am Klon 2.111 Rezepte
-- -> 16.476 Zeilen in 0,14 s; in Produktionsgroesse (14.777 Rezepte,
-- synthetisch vervielfacht) 115.332 Zeilen in 1,5 s. Aufgefrischt im Einkaufs-Nachlauf (Phase B,
-- src/sync/einkauf_sichten.ts): Rezepte kommen in Phase A (Tagesgeschaeft)
-- und Phase C (Nachladen) — was Phase C nachlaedt, steht ab dem naechsten
-- Lauf in der Stueckliste.
-- ---------------------------------------------------------------------

CREATE MATERIALIZED VIEW mart.rezept_stueckliste_basis AS
WITH RECURSIVE knoten AS (
    SELECT r.rezept_key                       AS wurzel_key,
           r.marke_key,
           r.rezept_key,
           1                                  AS ebene,
           CASE WHEN r.gewicht_gesamt > 0 AND r.gewicht_person > 0
                THEN least(r.gewicht_person / r.gewicht_gesamt, 1) ELSE 1 END::numeric AS faktor,
           NULL::text                         AS grund,
           false                              AS ueber_basismenge,
           ARRAY[r.rezept_key]                AS kette,
           ARRAY[]::integer[]                 AS weg,
           r.name                             AS pfad
      FROM core.rezept r
    UNION ALL
    SELECT k.wurzel_key, k.marke_key, u.rezept_key, k.ebene + 1,
           k.faktor * t.teil,
           coalesce(k.grund, t.grund),
           k.ueber_basismenge OR t.basismenge,
           k.kette || u.rezept_key,
           k.weg || z.position,
           k.pfad || ' → ' || u.name
      FROM knoten k
      JOIN core.zutat z  ON z.rezept_key = k.rezept_key AND z.art = 'sub_recipe'
      JOIN core.rezept u ON u.marke_key = k.marke_key AND u.fn_id = z.sub_rezept_fn_id
      CROSS JOIN LATERAL (
            SELECT e.basis AS e_basis, e.faktor AS e_faktor, b.basis AS b_basis, b.faktor AS b_faktor,
                   coalesce(lower(btrim(z.einheit)), '') AS e_text
              FROM core.einheit_metrisch(z.einheit) e, core.einheit_metrisch(z.basis_einheit) b) m
      CROSS JOIN LATERAL (
            SELECT CASE
                     WHEN NOT coalesce(u.gewicht_gesamt > 0, false) OR z.menge IS NULL THEN NULL
                     WHEN m.e_basis IS NOT NULL THEN z.menge * m.e_faktor * 1000 / u.gewicht_gesamt
                     WHEN m.e_text IN ('portion', 'portionen') AND u.gewicht_person > 0
                          THEN z.menge * u.gewicht_person / u.gewicht_gesamt
                     WHEN z.basis_menge > 0 AND m.b_basis IS NOT NULL
                          THEN z.basis_menge * m.b_faktor * 1000 / u.gewicht_gesamt
                   END AS teil,
                   CASE
                     WHEN z.menge IS NULL THEN 'unterrezept ohne menge'
                     WHEN NOT coalesce(u.gewicht_gesamt > 0, false) THEN 'unterrezept ohne gewicht'
                     WHEN m.e_basis IS NOT NULL THEN NULL
                     WHEN m.e_text IN ('portion', 'portionen') AND u.gewicht_person > 0 THEN NULL
                     WHEN z.basis_menge > 0 AND m.b_basis IS NOT NULL THEN NULL
                     ELSE 'einheit nicht umrechenbar: ' || coalesce(nullif(btrim(z.einheit), ''), '(leer)')
                   END AS grund,
                   (m.e_basis IS NULL AND m.e_text NOT IN ('portion', 'portionen')
                    AND coalesce(z.basis_menge > 0, false) AND m.b_basis IS NOT NULL) AS basismenge) t
     WHERE u.rezept_key <> ALL (k.kette)
       AND k.ebene < 12
       AND EXISTS (SELECT 1 FROM core.zutat zz WHERE zz.rezept_key = u.rezept_key)
),
zeile AS (
    -- Ware (ingredient, product_group)
    SELECT k.wurzel_key, k.marke_key, k.ebene, k.pfad, k.weg || z.position AS weg,
           z.rezept_key AS direkt_key, z.position, z.art, z.artikelnummer, z.name AS ware,
           z.lieferant_name AS lieferant, z.lieferant_fn_id,
           z.menge AS menge_im_rezept, z.einheit, z.basis_menge, z.basis_einheit, z.kosten,
           k.faktor,
           coalesce(k.grund, CASE WHEN z.menge IS NULL THEN 'zutat ohne menge' END) AS grund,
           k.ueber_basismenge,
           e.basis AS e_basis, e.faktor AS e_faktor, b.basis AS b_basis, b.faktor AS b_faktor
      FROM knoten k
      JOIN core.zutat z ON z.rezept_key = k.rezept_key AND z.art <> 'sub_recipe'
      CROSS JOIN LATERAL core.einheit_metrisch(z.einheit) e
      CROSS JOIN LATERAL core.einheit_metrisch(z.basis_einheit) b
    UNION ALL
    -- Luecke: ein Unterrezept, das nicht aufgeloest werden kann
    SELECT k.wurzel_key, k.marke_key, k.ebene, k.pfad, k.weg || z.position,
           z.rezept_key, z.position, 'luecke', NULL, z.name, NULL, NULL,
           z.menge, z.einheit, z.basis_menge, z.basis_einheit, z.kosten,
           NULL::numeric,
           CASE WHEN u.rezept_key IS NULL THEN 'unterrezept unbekannt'
                WHEN u.rezept_key = ANY (k.kette) THEN 'zyklus'
                WHEN k.ebene >= 12 THEN 'tiefe ueberschritten'
                ELSE 'unterrezept ohne zutaten' END,
           k.ueber_basismenge, NULL, NULL, NULL, NULL
      FROM knoten k
      JOIN core.zutat z ON z.rezept_key = k.rezept_key AND z.art = 'sub_recipe'
      LEFT JOIN core.rezept u ON u.marke_key = k.marke_key AND u.fn_id = z.sub_rezept_fn_id
     WHERE u.rezept_key IS NULL
        OR u.rezept_key = ANY (k.kette)
        OR k.ebene >= 12
        OR NOT EXISTS (SELECT 1 FROM core.zutat zz WHERE zz.rezept_key = u.rezept_key)
    UNION ALL
    -- Luecke: das Rezept selbst hat keine Zutaten
    SELECT k.wurzel_key, k.marke_key, 1, k.pfad, ARRAY[0], k.rezept_key, 0, 'luecke', NULL,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           CASE WHEN r.zutaten_geholt_am IS NULL THEN 'zutaten nicht geladen' ELSE 'rezept ohne zutaten' END,
           false, NULL, NULL, NULL, NULL
      FROM knoten k
      JOIN core.rezept r ON r.rezept_key = k.rezept_key
     WHERE k.ebene = 1
       AND NOT EXISTS (SELECT 1 FROM core.zutat zz WHERE zz.rezept_key = k.rezept_key)
)
SELECT z.wurzel_key AS rezept_key,
       z.marke_key,
       z.ebene,
       z.weg,
       z.pfad,
       z.direkt_key,
       z.position,
       z.art,
       z.artikelnummer,
       z.ware,
       z.lieferant,
       z.lieferant_fn_id,
       z.menge_im_rezept,
       z.einheit,
       z.basis_menge,
       z.basis_einheit,
       z.faktor,
       CASE WHEN z.art = 'luecke' THEN NULL
            ELSE coalesce(z.e_basis, CASE WHEN z.basis_menge > 0 THEN z.b_basis END, nullif(btrim(z.einheit), ''))
       END AS einheit_soll,
       CASE WHEN z.grund IS NULL AND z.art <> 'luecke'
            THEN z.faktor * CASE WHEN z.e_basis IS NOT NULL THEN z.menge_im_rezept * z.e_faktor
                                 WHEN z.basis_menge > 0 AND z.b_basis IS NOT NULL THEN z.basis_menge * z.b_faktor
                                 ELSE z.menge_im_rezept END
       END AS menge_je_portion,
       CASE WHEN z.grund IS NULL AND z.art <> 'luecke' THEN z.faktor * z.kosten END AS kosten_je_portion,
       (z.grund IS NULL AND z.art <> 'luecke') AS belastbar,
       z.grund,
       (z.ueber_basismenge OR (z.e_basis IS NULL AND coalesce(z.basis_menge > 0, false) AND z.b_basis IS NOT NULL))
                                                                        AS ueber_basismenge,
       count(*) OVER w                                                  AS rezept_zeilen,
       count(*) FILTER (WHERE z.grund IS NULL AND z.art <> 'luecke') OVER w AS rezept_zeilen_belastbar
  FROM zeile z
WINDOW w AS (PARTITION BY z.wurzel_key);

-- CONCURRENTLY braucht einen eindeutigen Index: der Weg (Positionen der
-- Unterrezept-Zeilen, dann die der Ware) ist je Wurzel eindeutig — auch wenn
-- dasselbe Halbfabrikat zweimal im Rezept steht.
CREATE UNIQUE INDEX rezept_stueckliste_basis_pk ON mart.rezept_stueckliste_basis (rezept_key, weg);
CREATE INDEX rezept_stueckliste_basis_nr ON mart.rezept_stueckliste_basis (artikelnummer);

COMMENT ON MATERIALIZED VIEW mart.rezept_stueckliste_basis IS
'Koernung: Rezept (Wurzel) × Weg zu einer Ware ueber alle Unterrezept-Ebenen — Zwischenstufe von
mart.rezept_stueckliste (0159), aufgefrischt im Einkaufs-Nachlauf. Wie alt: mart.materialisierung_stand.';

CREATE VIEW mart.rezept_stueckliste AS
SELECT m.schluessel                                   AS marke,
       s.marke_key,
       s.rezept_key,
       r.fn_id                                        AS rezept_fn_id,
       r.name                                         AS rezept,
       r.archiviert                                   AS rezept_archiviert,
       r.fehlt_seit                                   AS rezept_fehlt_seit,
       r.zutaten_geholt_am,
       CASE WHEN r.gewicht_gesamt > 0 AND r.gewicht_person > 0 AND r.gewicht_person >= r.gewicht_gesamt
                 THEN 'eine portion'
            WHEN r.gewicht_gesamt > 0 AND r.gewicht_person > 0 THEN 'teil des rezepts'
            ELSE 'ganzes rezept (ohne gewicht)' END   AS portion_regel,
       s.ebene,
       s.pfad,
       d.fn_id                                        AS direkt_rezept_fn_id,
       d.name                                         AS direkt_rezept,
       s.position,
       s.art,
       s.artikelnummer,
       s.ware,
       s.lieferant,
       s.lieferant_fn_id,
       s.menge_im_rezept,
       s.einheit,
       s.basis_menge,
       s.basis_einheit,
       s.faktor,
       s.einheit_soll,
       s.menge_je_portion,
       s.kosten_je_portion,
       s.belastbar,
       s.grund,
       s.ueber_basismenge,
       s.rezept_zeilen,
       s.rezept_zeilen_belastbar,
       (s.rezept_zeilen = s.rezept_zeilen_belastbar)  AS rezept_belastbar,
       s.weg
  FROM mart.rezept_stueckliste_basis s
  JOIN core.marke m       ON m.marke_key = s.marke_key
  JOIN core.rezept r      ON r.rezept_key = s.rezept_key
  LEFT JOIN core.rezept d ON d.rezept_key = s.direkt_key;

COMMENT ON VIEW mart.rezept_stueckliste IS
'Woraus besteht EINE verkaufte Portion von Rezept X? Je Rezept (je Marke, nicht je Betrieb) die Waren ueber
alle Unterrezept-Ebenen, mit der Menge je Portion (0159). menge_je_portion ist ueber die Ebenen
multipliziert: Menge im Halbfabrikat × Anteil des Halbfabrikats (Menge in g / Gesamtgewicht, Dichte 1 wie
FoodNotify) × Portion des Rezepts. einheit_soll ist kg oder l, wo die Einheit metrisch ist, sonst die
Rezepteinheit ("Stück"). belastbar = false heisst: KEINE Menge, weil eine Einheit auf dem Weg nicht
umrechenbar ist ("Portionierer", "Stück" eines Halbfabrikats), ein Halbfabrikat fehlt oder leer ist, oder ein
Zyklus — der Grund steht in grund, nichts wird geraten. art = luecke: eine Zeile fuer das, was nicht
aufgeloest werden kann. kosten_je_portion ist FoodNotifys eigene Kalkulation (cost der Zeile × Faktor), kein
bezahlter Preis. Rezeptnamen sind nicht eindeutig: nach rezept_fn_id filtern. Mengen nur je einheit_soll
summieren und nur mit belastbar.';
COMMENT ON COLUMN mart.rezept_stueckliste.menge_je_portion IS
'Menge der Ware fuer EINE verkaufte Portion des Rezepts, in einheit_soll (kg, l oder Rezepteinheit). NULL, wenn
belastbar = false. Ueber Ebenen multipliziert — anders als mart.artikel_in_rezept.menge.';
COMMENT ON COLUMN mart.rezept_stueckliste.faktor IS
'Produkt aus Portion (perPerson/total) und den Anteilen der Halbfabrikate auf dem Weg. NULL = nicht umrechenbar.';
COMMENT ON COLUMN mart.rezept_stueckliste.grund IS
'Warum belastbar = false: einheit nicht umrechenbar: <Einheit> / unterrezept ohne gewicht / unterrezept ohne
menge / zutat ohne menge / unterrezept unbekannt / unterrezept ohne zutaten / rezept ohne zutaten / zutaten
nicht geladen / zyklus / tiefe ueberschritten. Der erste Grund auf dem Weg.';
COMMENT ON COLUMN mart.rezept_stueckliste.portion_regel IS
'eine portion (perPerson = total, bei allen gemessenen Kassenrezepten) / teil des rezepts (perPerson < total) /
ganzes rezept (ohne gewicht): FoodNotify liefert kein Gewicht, eine verkaufte Einheit = das ganze Rezept.';
COMMENT ON COLUMN mart.rezept_stueckliste.ueber_basismenge IS
'Mindestens ein Schritt rechnet ueber baseQuantity (FoodNotifys Umrechnung einer freien Einheit). Auf
Unterrezept-Zeilen nicht gemessen — die Zeile ist belastbar, aber am wenigsten geprueft.';
COMMENT ON COLUMN mart.rezept_stueckliste.kosten_je_portion IS
'cost der Zeile (FoodNotify, Euro fuer die Zeilenmenge) × faktor. FoodNotifys Kalkulation zum Preisstand des
Rezeptabrufs, kein bezahlter Preis. Summierbar je Rezept (nur belastbare Zeilen).';
COMMENT ON COLUMN mart.rezept_stueckliste.artikelnummer IS
'Lieferanten-Artikelnummer der Ware (= core.bestellposition.lieferanten_nr), nicht die Artikelnummer der Kasse.';


-- ---------------------------------------------------------------------
-- 3. mart.soll_rezept_zuordnung — je Betrieb und LINA-Artikel EIN Rezept
--
-- Bar und Kueche eines Betriebs sind zwei Kassenanbindungen mit
-- ueberlappenden Artikellisten (0155). Damit kein Verkauf doppelt zaehlt,
-- bekommt jeder LINA-Artikel je Betrieb hoechstens EIN Rezept:
--   1. Kandidaten: Zeilen mit Rezept, nicht ignoriert, amadeus (PLU-Bruecke)
--      — "Rezept in irgendeiner Anbindung", wie mart.pos_artikel_abdeckung_betrieb.
--   2. Bei mehreren: zuerst die Zeile der letzten Antwort (fehlt_seit IS
--      NULL), dann die, die die Kasse noch meldet (abwesend_seit IS NULL),
--      dann die zuletzt geaenderte (geaendert_am), dann die kleinere
--      kostenstelle_key. Begruendung: die zuletzt gepflegte Zuordnung ist
--      das beste Zeichen fuer den heutigen Stand; ein Mehrheitsentscheid
--      gibt es bei zwei Anbindungen nicht.
--   3. rezept_uneindeutig = true, wenn die Kandidaten auf VERSCHIEDENE
--      Rezepte zeigen — sichtbar, nicht still entschieden.
-- ---------------------------------------------------------------------

CREATE VIEW mart.soll_rezept_zuordnung AS
WITH kandidat AS (
    SELECT ks.betrieb_key,
           ks.marke_key,
           a.artikel_key,
           a.artikelnummer,
           pa.rezept_fn_id,
           pa.kostenstelle_key,
           ks.art                                       AS kostenstelle_art,
           pa.fehlt_seit,
           pa.abwesend_seit,
           pa.geaendert_am
      FROM core.pos_artikel pa
      JOIN core.kostenstelle ks ON ks.kostenstelle_key = pa.kostenstelle_key
      JOIN core.artikel a       ON a.artikelnummer = pa.plu_zahl
     WHERE ks.kassensystem = 'amadeus'
       AND ks.betrieb_key IS NOT NULL
       AND pa.rezept_fn_id IS NOT NULL
       AND NOT pa.ist_ignoriert
),
-- DISTINCT ON statt row_number() = 1: den Filter auf die Fensterspalte
-- schaetzt der Planer auf eine Handvoll Zeilen und waehlt dahinter
-- Nested Loops mit Join-Filter (am Klon in Produktionsgroesse 2,7 s fuer
-- einen Monat Abdeckung). DISTINCT ON schaetzt er ueber die Zahl der Paare.
gewinner AS (
    SELECT DISTINCT ON (betrieb_key, artikel_key) *
      FROM kandidat
     ORDER BY betrieb_key, artikel_key, (fehlt_seit IS NULL) DESC, (abwesend_seit IS NULL) DESC,
              geaendert_am DESC, kostenstelle_key
),
alle AS (
    SELECT betrieb_key, artikel_key,
           count(*)::int                                          AS kandidaten,
           array_agg(DISTINCT rezept_fn_id ORDER BY rezept_fn_id) AS rezept_fn_ids
      FROM kandidat
     GROUP BY betrieb_key, artikel_key
)
SELECT m.schluessel                              AS marke,
       g.marke_key,
       g.betrieb_key,
       b.name                                    AS betrieb,
       g.artikel_key,
       g.artikelnummer,
       g.rezept_fn_id,
       r.rezept_key,
       r.name                                    AS rezept,
       g.kostenstelle_key,
       g.kostenstelle_art,
       (g.fehlt_seit IS NULL)                    AS zuordnung_aktuell,
       v.kandidaten,
       v.rezept_fn_ids,
       (cardinality(v.rezept_fn_ids) > 1)        AS rezept_uneindeutig,
       st.zeilen                                 AS rezept_zeilen,
       st.zeilen_belastbar                       AS rezept_zeilen_belastbar,
       CASE WHEN r.rezept_key IS NULL            THEN 'rezept nicht geladen'
            WHEN st.ohne_zutaten                 THEN 'rezept ohne zutaten'
            WHEN st.zeilen_belastbar = 0         THEN 'nicht umrechenbar'
            WHEN st.zeilen_belastbar < st.zeilen THEN 'teilweise'
            ELSE 'vollstaendig' END              AS rezept_zustand,
       st.kosten_je_portion                      AS rezept_kosten_je_portion
  FROM gewinner g
  JOIN alle v         ON v.betrieb_key = g.betrieb_key AND v.artikel_key = g.artikel_key
  JOIN core.marke m   ON m.marke_key = g.marke_key
  JOIN core.betrieb b ON b.betrieb_key = g.betrieb_key
  LEFT JOIN core.rezept r ON r.marke_key = g.marke_key AND r.fn_id = g.rezept_fn_id
  -- Je Rezept einmal, ueber den eindeutigen Index (rezept_key, weg) — nicht
  -- je Verkaufszeile.
  LEFT JOIN LATERAL (
        SELECT max(s.rezept_zeilen)                                     AS zeilen,
               max(s.rezept_zeilen_belastbar)                           AS zeilen_belastbar,
               bool_or(s.art = 'luecke' AND s.grund IN ('rezept ohne zutaten', 'zutaten nicht geladen'))
                                                                        AS ohne_zutaten,
               sum(s.kosten_je_portion)                                 AS kosten_je_portion
          FROM mart.rezept_stueckliste_basis s
         WHERE s.rezept_key = r.rezept_key) st ON true;

COMMENT ON VIEW mart.soll_rezept_zuordnung IS
'Welches Rezept rechnet der Soll-Verbrauch fuer LINA-Artikel X in Betrieb Y? Eine Zeile je Betrieb und
LINA-Artikel mit Rezept (0159). Quelle ist FoodNotifys Kassenzuordnung (mart.pos_artikel_rezept), nur bei
amadeus-Kassen (PLU = LINA-Artikelnummer). Fuehren Bar und Kueche den Artikel mit verschiedenen Rezepten,
gewinnt die Zeile der letzten Antwort, dann die, die die Kasse noch meldet, dann die zuletzt geaenderte —
rezept_uneindeutig = true und rezept_fn_ids nennen alle Kandidaten. rezept_key NULL: das Rezept ist (noch)
nicht geladen. Die Zuordnung ist der HEUTIGE Stand; FoodNotify fuehrt keine Historie.';
COMMENT ON COLUMN mart.soll_rezept_zuordnung.rezept_uneindeutig IS
'Die Anbindungen des Betriebs ordnen diesem Artikel verschiedene Rezepte zu; gerechnet wird mit rezept_fn_id,
die Alternativen stehen in rezept_fn_ids.';
COMMENT ON COLUMN mart.soll_rezept_zuordnung.rezept_zustand IS
'rezept nicht geladen / rezept ohne zutaten / nicht umrechenbar (keine Zeile der Stueckliste mit Menge) / teilweise
/ vollstaendig — aus mart.rezept_stueckliste.';
COMMENT ON COLUMN mart.soll_rezept_zuordnung.rezept_kosten_je_portion IS
'Summe kosten_je_portion der belastbaren Stuecklistenzeilen: FoodNotifys Kalkulation je Portion, kein bezahlter Preis.
Vollstaendig nur bei rezept_zustand = vollstaendig.';
COMMENT ON COLUMN mart.soll_rezept_zuordnung.kandidaten IS
'Kassenartikel-Zeilen mit Rezept fuer diesen Betrieb und LINA-Artikel (eine je Anbindung, mehr bei doppelter PLU).';


-- ---------------------------------------------------------------------
-- 4. mart.soll_artikel_monat — Betrieb × Monat × Artikel
--
-- ZEITRAUM: die letzten 13 vollen Monate und der laufende. Rezept und
-- Kassenzuordnung sind ein HEUTIGER Stand ohne Historie (FoodNotify fuehrt
-- keine Fassungen); je weiter zurueck, desto wahrscheinlicher war die Karte
-- eine andere. 13 Monate erlauben den Vergleich mit dem Vorjahresmonat.
-- Entscheidung in docs/entscheidungen.md (19.11.2026).
--
-- Betriebe: jeder mit einer amadeus-Kassenanbindung. Ob deren
-- Kassenartikel geladen sind, sagt mart.soll_verbrauch_abdeckung (zustand).
-- ---------------------------------------------------------------------

CREATE VIEW mart.soll_artikel_monat AS
WITH betrieb AS (
    SELECT ks.betrieb_key, min(m.schluessel) AS marke, min(ks.marke_key) AS marke_key
      FROM core.kostenstelle ks
      JOIN core.marke m ON m.marke_key = ks.marke_key
     WHERE ks.connection_id IS NOT NULL AND ks.kassensystem = 'amadeus' AND ks.betrieb_key IS NOT NULL
     GROUP BY ks.betrieb_key
)
SELECT b.marke,
       b.marke_key,
       am.betrieb_key,
       am.betrieb,
       am.monat,
       am.artikel_key,
       la.artikelnummer,
       am.artikel,
       am.warengruppe,
       am.menge                                                   AS menge_verkauft,
       am.umsatz_netto,
       EXISTS (SELECT 1 FROM core.pos_artikel pa
                 JOIN core.kostenstelle ks ON ks.kostenstelle_key = pa.kostenstelle_key
                WHERE ks.betrieb_key = am.betrieb_key AND ks.kassensystem = 'amadeus'
                  AND pa.plu_zahl = la.artikelnummer)              AS im_feed,
       z.rezept_fn_id,
       z.rezept_key,
       z.rezept,
       coalesce(z.rezept_uneindeutig, false)                      AS rezept_uneindeutig,
       z.rezept_zeilen,
       z.rezept_zeilen_belastbar,
       coalesce(z.rezept_zustand, 'kein rezept')                  AS soll_zustand,
       CASE WHEN z.rezept_zustand = 'vollstaendig'
            THEN am.menge * z.rezept_kosten_je_portion END        AS soll_wert_fn_eur
  FROM mart.artikel_monat_basis am
  JOIN betrieb b              ON b.betrieb_key = am.betrieb_key
  LEFT JOIN core.artikel la   ON la.artikel_key = am.artikel_key
  LEFT JOIN mart.soll_rezept_zuordnung z ON z.betrieb_key = am.betrieb_key AND z.artikel_key = am.artikel_key
 WHERE am.monat >= (date_trunc('month', current_date) - interval '13 months')::date;

COMMENT ON VIEW mart.soll_artikel_monat IS
'Je Betrieb (mit amadeus-Kasse), Monat und verkauftem LINA-Artikel: Menge, Umsatz, das Rezept laut
Kassenzuordnung und ob es in den Soll-Verbrauch eingeht (0159). soll_zustand: kein rezept / rezept nicht
geladen / rezept ohne zutaten / nicht umrechenbar (keine Zeile mit Menge) / teilweise (ein Teil der Waren ohne
Menge — die belastbaren gehen ein) / vollstaendig. im_feed = false: die Artikelnummer steht in keiner
Kassenanbindung des Betriebs (Bar ohne Anbindung, vor dem ersten Abruf gestrichen). Nur die letzten 13 vollen
Monate und der laufende: Rezept und Zuordnung sind der HEUTIGE Stand, auf fruehere Monate angewendet.
soll_wert_fn_eur nur bei vollstaendig: Menge × FoodNotifys Rezeptkalkulation, kein bezahlter Wareneinsatz.';
COMMENT ON COLUMN mart.soll_artikel_monat.soll_zustand IS
'kein rezept / rezept nicht geladen / rezept ohne zutaten / nicht umrechenbar / teilweise / vollstaendig — siehe
Kommentar der Sicht. Nur vollstaendig und die belastbaren Zeilen von teilweise gehen in die Soll-Menge ein.';
COMMENT ON COLUMN mart.soll_artikel_monat.soll_wert_fn_eur IS
'menge_verkauft × Summe kosten_je_portion des Rezepts — FoodNotifys Kalkulation zum Preisstand des
Rezeptabrufs, nur bei soll_zustand = vollstaendig. Kein bezahlter Wareneinsatz und nicht durch den
Gesamtumsatz teilen (die Abdeckung fehlt im Nenner).';


-- ---------------------------------------------------------------------
-- 5. mart.soll_verbrauch_abdeckung — die Pflichtsicht: wie viel geht ein
-- ---------------------------------------------------------------------

CREATE VIEW mart.soll_verbrauch_abdeckung AS
WITH aktiv AS (
    SELECT wert->'marken' AS marken FROM sync.merker WHERE schluessel = 'pos_artikel_marken'
),
bruecke AS (
    SELECT ks.betrieb_key,
           count(*)::int                              AS anbindungen,
           count(ab.kostenstelle_key)::int            AS anbindungen_geladen,
           min(ab.abgerufen_am)                       AS aeltester_abruf_am,
           coalesce(bool_or((SELECT a.marken ? m.schluessel FROM aktiv a)), false) AS marke_aktiv
      FROM core.kostenstelle ks
      JOIN core.marke m ON m.marke_key = ks.marke_key
      LEFT JOIN core.pos_artikel_abruf ab ON ab.kostenstelle_key = ks.kostenstelle_key
     WHERE ks.connection_id IS NOT NULL AND ks.kassensystem = 'amadeus' AND ks.betrieb_key IS NOT NULL
     GROUP BY ks.betrieb_key
),
summe AS (
    SELECT marke, betrieb_key, betrieb, monat,
           count(*)::int                                                         AS artikel_verkauft,
           sum(menge_verkauft)                                                   AS menge_verkauft,
           sum(umsatz_netto)                                                     AS umsatz_netto,
           sum(umsatz_netto) FILTER (WHERE soll_zustand = 'vollstaendig')         AS umsatz_vollstaendig,
           sum(umsatz_netto) FILTER (WHERE soll_zustand = 'teilweise')            AS umsatz_teilweise,
           sum(umsatz_netto) FILTER (WHERE soll_zustand = 'nicht umrechenbar')    AS umsatz_nicht_umrechenbar,
           sum(umsatz_netto) FILTER (WHERE soll_zustand = 'rezept ohne zutaten')  AS umsatz_rezept_ohne_zutaten,
           sum(umsatz_netto) FILTER (WHERE soll_zustand = 'rezept nicht geladen') AS umsatz_rezept_nicht_geladen,
           sum(umsatz_netto) FILTER (WHERE soll_zustand = 'kein rezept')          AS umsatz_kein_rezept,
           sum(umsatz_netto) FILTER (WHERE soll_zustand = 'kein rezept' AND NOT im_feed) AS umsatz_nicht_im_feed,
           sum(menge_verkauft) FILTER (WHERE soll_zustand = 'vollstaendig')       AS menge_vollstaendig,
           sum(menge_verkauft) FILTER (WHERE soll_zustand IN ('vollstaendig', 'teilweise')) AS menge_eingehend,
           sum(umsatz_netto) FILTER (WHERE soll_zustand <> 'kein rezept')         AS umsatz_mit_rezept,
           (count(*) FILTER (WHERE rezept_uneindeutig))::int                      AS artikel_rezept_uneindeutig
      FROM mart.soll_artikel_monat
     GROUP BY marke, betrieb_key, betrieb, monat
)
SELECT s.marke,
       s.betrieb_key,
       s.betrieb,
       s.monat,
       CASE WHEN NOT b.marke_aktiv               THEN 'marke nicht aktiv'
            WHEN b.anbindungen_geladen = 0       THEN 'bruecke nicht geladen'
            WHEN b.anbindungen_geladen < b.anbindungen THEN 'bruecke teilweise geladen'
            ELSE 'ok' END                                                        AS zustand,
       b.marke_aktiv,
       b.anbindungen,
       b.anbindungen_geladen,
       b.aeltester_abruf_am,
       s.artikel_verkauft,
       s.menge_verkauft,
       s.umsatz_netto,
       coalesce(s.umsatz_vollstaendig, 0)                                         AS umsatz_vollstaendig,
       coalesce(s.umsatz_teilweise, 0)                                            AS umsatz_teilweise,
       coalesce(s.umsatz_nicht_umrechenbar, 0)                                    AS umsatz_nicht_umrechenbar,
       coalesce(s.umsatz_rezept_ohne_zutaten, 0)                                  AS umsatz_rezept_ohne_zutaten,
       coalesce(s.umsatz_rezept_nicht_geladen, 0)                                 AS umsatz_rezept_nicht_geladen,
       coalesce(s.umsatz_kein_rezept, 0)                                          AS umsatz_kein_rezept,
       coalesce(s.umsatz_nicht_im_feed, 0)                                        AS umsatz_nicht_im_feed,
       coalesce(s.menge_vollstaendig, 0)                                          AS menge_vollstaendig,
       coalesce(s.menge_eingehend, 0)                                             AS menge_eingehend,
       -- Ohne geladene Kassenzuordnung keine Prozentzahl, nicht null Prozent:
       -- 0 % hiesse "kein Artikel hat ein Rezept", gemeint waere "nicht gefragt".
       CASE WHEN b.marke_aktiv AND b.anbindungen_geladen > 0 THEN
       round(100.0 * coalesce(s.umsatz_vollstaendig, 0) / nullif(s.umsatz_netto, 0), 1) END AS abdeckung_umsatz_pct,
       CASE WHEN b.marke_aktiv AND b.anbindungen_geladen > 0 THEN
       round(100.0 * coalesce(s.menge_vollstaendig, 0) / nullif(s.menge_verkauft, 0), 1) END AS abdeckung_menge_pct,
       CASE WHEN b.marke_aktiv AND b.anbindungen_geladen > 0 THEN
       round(100.0 * coalesce(s.umsatz_mit_rezept, 0) / nullif(s.umsatz_netto, 0), 1) END   AS rezept_umsatz_pct,
       s.artikel_rezept_uneindeutig
  FROM summe s
  JOIN bruecke b ON b.betrieb_key = s.betrieb_key;

COMMENT ON VIEW mart.soll_verbrauch_abdeckung IS
'Wie viel des Verkaufs steckt im Soll-Verbrauch? Je Betrieb mit amadeus-Kasse und Monat (letzte 13 volle
und der laufende), aufgeteilt nach soll_zustand (0159). abdeckung_umsatz_pct = Umsatz der Artikel mit
VOLLSTAENDIG umrechenbarem Rezept / Artikelumsatz, Prozentzahl. Die Soll-Mengen in mart.soll_verbrauch_monat
umfassen zusaetzlich die belastbaren Zeilen der Artikel mit soll_zustand teilweise — sie sind also eine
Untergrenze, nie der ganze Verbrauch. rezept_umsatz_pct ist die Reichweite der Kassenzuordnung (Rezept
zugeordnet, egal ob umrechenbar). zustand: ok / bruecke teilweise geladen / bruecke nicht geladen / marke
nicht aktiv (POS_ARTIKEL_MARKEN, vorerst nur Wilma Wunder). Bei marke nicht aktiv und bruecke nicht geladen
sind die Prozentzahlen NULL (keine Zahl, nicht null Prozent); bei bruecke teilweise geladen fehlt eine
Anbindung, die Zahl ist zu niedrig. Ueber Betriebe oder Monate nicht mitteln, sondern aus den Euro-Summen neu
rechnen.';
COMMENT ON COLUMN mart.soll_verbrauch_abdeckung.abdeckung_umsatz_pct IS
'Umsatz mit vollstaendig umrechenbarem Rezept / Artikelumsatz, Prozentzahl (42.5, nicht 0.425). Nicht mitteln:
fuer mehrere Betriebe oder Monate sum(umsatz_vollstaendig) / sum(umsatz_netto).';
COMMENT ON COLUMN mart.soll_verbrauch_abdeckung.abdeckung_menge_pct IS
'Verkaufte Menge mit vollstaendig umrechenbarem Rezept / verkaufte Menge, Prozentzahl. Nicht mitteln.';
COMMENT ON COLUMN mart.soll_verbrauch_abdeckung.rezept_umsatz_pct IS
'Umsatz der Artikel mit zugeordnetem Rezept (umrechenbar oder nicht) / Artikelumsatz, Prozentzahl.';
COMMENT ON COLUMN mart.soll_verbrauch_abdeckung.umsatz_nicht_im_feed IS
'Teil von umsatz_kein_rezept: die Artikelnummer steht in keiner Kassenanbindung des Betriebs (Bar ohne
Anbindung, Artikel vor dem ersten Abruf gestrichen) — kein Pflegefehler im Rezept, sondern fehlende Bruecke.';


-- ---------------------------------------------------------------------
-- 6. mart.soll_verbrauch_monat — Betrieb × Monat × Ware
-- ---------------------------------------------------------------------

CREATE VIEW mart.soll_verbrauch_monat AS
WITH soll AS (
    SELECT sa.marke, sa.marke_key, sa.betrieb_key, sa.betrieb, sa.monat,
           s.artikelnummer,
           CASE WHEN s.artikelnummer IS NULL THEN s.ware END   AS ware_ohne_nummer,
           s.ware,
           s.einheit_soll,
           s.lieferant,
           s.belastbar,
           sa.artikel_key,
           sa.rezept_key,
           sa.menge_verkauft * s.menge_je_portion              AS soll_menge,
           sa.menge_verkauft * s.kosten_je_portion             AS soll_wert_fn,
           CASE WHEN NOT s.belastbar THEN sa.menge_verkauft END AS portionen_offen
      FROM mart.soll_artikel_monat sa
      JOIN mart.rezept_stueckliste_basis s ON s.rezept_key = sa.rezept_key AND s.art <> 'luecke'
     WHERE sa.soll_zustand IN ('vollstaendig', 'teilweise', 'nicht umrechenbar')
)
SELECT so.marke,
       so.marke_key,
       so.betrieb_key,
       so.betrieb,
       so.monat,
       nullif(btrim(so.artikelnummer), '')                                 AS artikelnummer,
       mode() WITHIN GROUP (ORDER BY so.ware)                              AS ware,
       so.einheit_soll                                                     AS einheit,
       sum(so.soll_menge) FILTER (WHERE so.belastbar)                      AS soll_menge,
       sum(so.soll_wert_fn) FILTER (WHERE so.belastbar)                    AS soll_wert_fn_eur,
       (count(DISTINCT so.artikel_key) FILTER (WHERE so.belastbar))::int   AS artikel,
       (count(DISTINCT so.rezept_key))::int                                AS rezepte,
       coalesce(sum(so.portionen_offen), 0)                                AS portionen_nicht_umrechenbar,
       (count(*) FILTER (WHERE NOT so.belastbar) > 0)                      AS soll_unvollstaendig,
       string_agg(DISTINCT so.lieferant, ', ')                             AS lieferanten,
       ab.abdeckung_umsatz_pct,
       ab.abdeckung_menge_pct,
       ab.zustand                                                          AS abdeckung_zustand
  FROM soll so
  JOIN mart.soll_verbrauch_abdeckung ab ON ab.betrieb_key = so.betrieb_key AND ab.monat = so.monat
 GROUP BY so.marke, so.marke_key, so.betrieb_key, so.betrieb, so.monat, nullif(btrim(so.artikelnummer), ''),
          so.ware_ohne_nummer, so.einheit_soll, ab.abdeckung_umsatz_pct, ab.abdeckung_menge_pct, ab.zustand;

COMMENT ON VIEW mart.soll_verbrauch_monat IS
'Wie viel einer Ware haette ein Betrieb im Monat laut Rezept verbraucht? Je Betrieb, Monat, Ware
(Lieferanten-Artikelnummer) und Einheit: verkaufte Portionen (LINA) × Menge je Portion
(mart.rezept_stueckliste), summiert ueber alle Rezepte, in denen die Ware steckt (0159). DIE ZAHL IST EINE
UNTERGRENZE: sie umfasst nur Artikel mit zugeordnetem und umrechenbarem Rezept — abdeckung_umsatz_pct steht in
jeder Zeile und muss mitgenannt werden. soll_unvollstaendig = true: die Ware steckt auch in Rezeptzeilen ohne
Menge (portionen_nicht_umrechenbar Portionen). einheit ist kg oder l, wo metrisch, sonst die Rezepteinheit —
Mengen nur je Ware UND Einheit summieren. Freitextzutaten ohne Nummer stehen mit artikelnummer NULL je Name.
soll_wert_fn_eur ist FoodNotifys Rezeptkalkulation, kein bezahlter Preis (bezahlt: mart.soll_ist_monat).
Rezept und Zuordnung sind der heutige Stand. Einkauf daneben: mart.soll_ist_monat.';
COMMENT ON COLUMN mart.soll_verbrauch_monat.soll_menge IS
'Soll-Menge im Monat in einheit (kg, l oder Rezepteinheit), nur aus belastbaren Rezeptzeilen. Summierbar ueber
Monate und Betriebe JE WARE UND EINHEIT, nie ueber Waren oder Einheiten hinweg.';
COMMENT ON COLUMN mart.soll_verbrauch_monat.abdeckung_umsatz_pct IS
'Abdeckung des Betriebs im Monat (mart.soll_verbrauch_abdeckung): Anteil des Artikelumsatzes mit vollstaendig
umrechenbarem Rezept, Prozentzahl. Gehoert zu jeder Soll-Zahl dazu.';
COMMENT ON COLUMN mart.soll_verbrauch_monat.portionen_nicht_umrechenbar IS
'Verkaufte Portionen von Rezepten, in denen die Ware auf einem nicht umrechenbaren Weg steckt — ihre Menge fehlt
in soll_menge.';


-- ---------------------------------------------------------------------
-- 7. mart.soll_verbrauch_tag — Betrieb × Geschaeftstag × Ware
--
-- Dieselbe Rechnung auf core.artikelverkauf_tag. Nicht materialisiert: mit
-- Filter auf geschaeftstag und betrieb_key greift die Partitionierung.
-- verkauf ist NOT MATERIALIZED: er wird zweimal gelesen, und als
-- materialisierter CTE gab er den Tagesfilter nicht nach innen — ein
-- Betrieb, ein Monat 7,2 s statt 0,2 s (Klon in Produktionsgroesse,
-- docs/metabase.md).
-- ---------------------------------------------------------------------

CREATE VIEW mart.soll_verbrauch_tag AS
WITH verkauf AS NOT MATERIALIZED (
    SELECT av.geschaeftstag, av.betrieb_key, av.artikel_key, av.menge, av.umsatz_netto,
           z.rezept_key, z.marke, z.marke_key, z.betrieb, z.rezept_zustand
      FROM core.artikelverkauf_tag av
      JOIN mart.soll_rezept_zuordnung z ON z.betrieb_key = av.betrieb_key AND z.artikel_key = av.artikel_key
     WHERE av.geschaeftstag >= (date_trunc('month', current_date) - interval '13 months')::date
),
tag_gesamt AS (
    SELECT av.geschaeftstag, av.betrieb_key, sum(av.umsatz_netto) AS umsatz_netto
      FROM core.artikelverkauf_tag av
     WHERE av.geschaeftstag >= (date_trunc('month', current_date) - interval '13 months')::date
       AND av.betrieb_key IN (SELECT betrieb_key FROM core.kostenstelle
                               WHERE connection_id IS NOT NULL AND kassensystem = 'amadeus')
     GROUP BY av.geschaeftstag, av.betrieb_key
),
tag_vollstaendig AS (
    SELECT geschaeftstag, betrieb_key,
           sum(umsatz_netto) FILTER (WHERE rezept_zustand = 'vollstaendig') AS umsatz_vollstaendig
      FROM verkauf
     GROUP BY geschaeftstag, betrieb_key
)
SELECT v.marke,
       v.marke_key,
       v.betrieb_key,
       v.betrieb,
       v.geschaeftstag,
       nullif(btrim(s.artikelnummer), '')                                   AS artikelnummer,
       mode() WITHIN GROUP (ORDER BY s.ware)                                AS ware,
       s.einheit_soll                                                       AS einheit,
       sum(v.menge * s.menge_je_portion) FILTER (WHERE s.belastbar)         AS soll_menge,
       sum(v.menge * s.kosten_je_portion) FILTER (WHERE s.belastbar)        AS soll_wert_fn_eur,
       (count(DISTINCT v.artikel_key) FILTER (WHERE s.belastbar))::int      AS artikel,
       coalesce(sum(v.menge) FILTER (WHERE NOT s.belastbar), 0)             AS portionen_nicht_umrechenbar,
       (count(*) FILTER (WHERE NOT s.belastbar) > 0)                        AS soll_unvollstaendig,
       round(100.0 * coalesce(tv.umsatz_vollstaendig, 0) / nullif(tg.umsatz_netto, 0), 1) AS abdeckung_umsatz_pct
  FROM verkauf v
  JOIN mart.rezept_stueckliste_basis s ON s.rezept_key = v.rezept_key AND s.art <> 'luecke'
  JOIN tag_gesamt tg       ON tg.geschaeftstag = v.geschaeftstag AND tg.betrieb_key = v.betrieb_key
  JOIN tag_vollstaendig tv ON tv.geschaeftstag = v.geschaeftstag AND tv.betrieb_key = v.betrieb_key
 GROUP BY v.marke, v.marke_key, v.betrieb_key, v.betrieb, v.geschaeftstag, nullif(btrim(s.artikelnummer), ''),
          CASE WHEN s.artikelnummer IS NULL THEN s.ware END, s.einheit_soll,
          tv.umsatz_vollstaendig, tg.umsatz_netto;

COMMENT ON VIEW mart.soll_verbrauch_tag IS
'Wie mart.soll_verbrauch_monat, je Geschaeftstag (0159): Soll-Menge einer Ware je Betrieb und Tag aus
LINA-Artikelverkauf × Rezept. Eine UNTERGRENZE — abdeckung_umsatz_pct (Anteil des Tagesumsatzes mit
vollstaendig umrechenbarem Rezept) gehoert zu jeder Zahl. Immer nach geschaeftstag (und betrieb_key) filtern:
ohne Filter rechnet die Sicht 13 Monate aller Betriebe. Nur die letzten 13 vollen Monate und der laufende.';


-- ---------------------------------------------------------------------
-- 8. mart.soll_ist_monat — Soll neben Einkauf, KEIN Schwund-Urteil
--
-- Einkauf ist nicht Verbrauch: die Lagerveraenderung fehlt (Inventuren gibt
-- es fast nur bei Wilma Wunder, 0044), und das Soll ist eine Untergrenze
-- (Abdeckung). Eine Differenz "Einkauf - Soll" ist deshalb kein Schwund und
-- wird nicht als Spalte angeboten; einkauf_zu_soll_pct steht nur, wo die
-- Einheiten zusammenpassen.
--
-- EINKAUF wie in den Preissichten (0043, 0157): ohne Stornos, Monat des
-- Bestellzeitpunkts in Berlin, beide Kostenstellen des Betriebs, Schluessel
-- lieferanten_nr. MENGE nur aus Positionen in kg oder l mit belastbarer
-- Gesamtmenge (NOT menge_unstimmig, gesamt_menge > 0, 0040/0061); baseUnit
-- traegt keine brauchbare Gesamtmenge (Karton 6 × 0,75 l als 27.000).
--
-- PREIS (soll_wert_eur): die gepruefte Groesse preis_je_einheit aus 0042,
-- je kg bzw. l, mengengewichtet — zuerst aus den eigenen Bestellungen des
-- Betriebs im Monat, sonst aus allen Bestellungen der Marke in den zwoelf
-- Monaten bis Monatsende. preis_quelle sagt, welcher.
-- ---------------------------------------------------------------------

CREATE VIEW mart.soll_ist_monat AS
WITH einkauf AS (
    SELECT ks.betrieb_key,
           date_trunc('month', b.bestellt_am AT TIME ZONE 'Europe/Berlin')::date            AS monat,
           bp.lieferanten_nr,
           count(*)::int                                                                    AS positionen,
           count(DISTINCT b.lieferant_key)::int                                             AS lieferanten,
           sum(bp.summe_preis)                                                              AS ausgaben,
           sum(bp.gesamt_menge) FILTER (WHERE bp.einheit = 'kg' AND NOT bp.menge_unstimmig AND bp.gesamt_menge > 0) AS menge_kg,
           sum(bp.gesamt_menge) FILTER (WHERE bp.einheit = 'l'  AND NOT bp.menge_unstimmig AND bp.gesamt_menge > 0) AS menge_l,
           (count(*) FILTER (WHERE NOT (bp.einheit IN ('kg', 'l') AND NOT bp.menge_unstimmig
                                        AND bp.gesamt_menge > 0)))::int                     AS positionen_ohne_menge,
           sum(bp.preis_je_einheit * bp.gesamt_menge) FILTER (WHERE bp.einheit = 'kg' AND NOT bp.menge_unstimmig
                                        AND bp.gesamt_menge > 0 AND bp.preis_je_einheit IS NOT NULL) AS wert_kg,
           sum(bp.gesamt_menge) FILTER (WHERE bp.einheit = 'kg' AND NOT bp.menge_unstimmig
                                        AND bp.gesamt_menge > 0 AND bp.preis_je_einheit IS NOT NULL) AS menge_kg_bepreist,
           sum(bp.preis_je_einheit * bp.gesamt_menge) FILTER (WHERE bp.einheit = 'l' AND NOT bp.menge_unstimmig
                                        AND bp.gesamt_menge > 0 AND bp.preis_je_einheit IS NOT NULL) AS wert_l,
           sum(bp.gesamt_menge) FILTER (WHERE bp.einheit = 'l' AND NOT bp.menge_unstimmig
                                        AND bp.gesamt_menge > 0 AND bp.preis_je_einheit IS NOT NULL) AS menge_l_bepreist
      FROM core.bestellposition bp
      JOIN core.bestellung b    ON b.bestellung_key = bp.bestellung_key
      JOIN core.kostenstelle ks ON ks.kostenstelle_key = b.kostenstelle_key
     WHERE b.status IS DISTINCT FROM 'canceled'
       AND b.bestellt_am IS NOT NULL
       AND b.bestellt_am >= (date_trunc('month', current_date) - interval '14 months')
       AND ks.betrieb_key IS NOT NULL
       AND bp.lieferanten_nr IS NOT NULL AND bp.lieferanten_nr <> ''
     GROUP BY ks.betrieb_key, date_trunc('month', b.bestellt_am AT TIME ZONE 'Europe/Berlin')::date, bp.lieferanten_nr
),
paar AS (
    SELECT s.*,
           e.positionen, e.lieferanten AS einkauf_lieferanten, e.ausgaben, e.positionen_ohne_menge,
           e.menge_kg, e.menge_l,
           CASE s.einheit WHEN 'kg' THEN e.menge_kg WHEN 'l' THEN e.menge_l END              AS eingekauft_menge,
           CASE s.einheit WHEN 'kg' THEN e.menge_l WHEN 'l' THEN e.menge_kg END              AS menge_andere_einheit,
           CASE s.einheit WHEN 'kg' THEN e.wert_kg / nullif(e.menge_kg_bepreist, 0)
                          WHEN 'l'  THEN e.wert_l / nullif(e.menge_l_bepreist, 0) END        AS preis_betrieb
      FROM mart.soll_verbrauch_monat s
      LEFT JOIN einkauf e ON e.betrieb_key = s.betrieb_key AND e.monat = s.monat
                         AND e.lieferanten_nr = s.artikelnummer
     WHERE s.artikelnummer IS NOT NULL
)
SELECT p.marke,
       p.marke_key,
       p.betrieb_key,
       p.betrieb,
       p.monat,
       p.artikelnummer,
       p.ware,
       p.einheit,
       p.soll_menge,
       p.soll_unvollstaendig,
       p.abdeckung_umsatz_pct,
       p.abdeckung_zustand,
       coalesce(p.positionen, 0)                                                  AS positionen,
       p.einkauf_lieferanten,
       p.ausgaben,
       p.eingekauft_menge,
       p.positionen_ohne_menge,
       -- Erst die Soll-Seite, dann der Einkauf: ein unvollstaendiges Soll ist
       -- auch mit passendem Einkauf kein Vergleich.
       CASE WHEN p.einheit NOT IN ('kg', 'l')                       THEN 'soll nicht in kg oder l'
            WHEN p.soll_unvollstaendig                              THEN 'soll unvollstaendig'
            WHEN NOT coalesce(p.soll_menge > 0, false)              THEN 'soll null'
            WHEN p.positionen IS NULL                               THEN 'kein einkauf im monat'
            WHEN p.eingekauft_menge IS NULL                         THEN 'einkauf in anderer einheit'
            WHEN p.positionen_ohne_menge > 0 OR p.menge_andere_einheit > 0 THEN 'einkauf teilweise ohne menge'
            ELSE 'vergleichbar' END                                             AS vergleich,
       (p.einheit IN ('kg', 'l') AND p.positionen IS NOT NULL AND p.eingekauft_menge IS NOT NULL
        AND coalesce(p.positionen_ohne_menge, 0) = 0 AND coalesce(p.menge_andere_einheit, 0) = 0
        AND NOT p.soll_unvollstaendig AND p.soll_menge > 0)                       AS vergleichbar,
       CASE WHEN p.einheit IN ('kg', 'l') AND p.eingekauft_menge IS NOT NULL
             AND coalesce(p.positionen_ohne_menge, 0) = 0 AND coalesce(p.menge_andere_einheit, 0) = 0
             AND NOT p.soll_unvollstaendig AND p.soll_menge > 0
            THEN round(100.0 * p.eingekauft_menge / p.soll_menge, 1) END           AS einkauf_zu_soll_pct,
       round(coalesce(p.preis_betrieb, f.preis), 4)                               AS preis_eur_je_einheit,
       CASE WHEN p.preis_betrieb IS NOT NULL THEN 'bezahlt, betrieb im monat'
            WHEN f.preis IS NOT NULL         THEN 'bezahlt, marke 12 monate'
            WHEN p.einheit NOT IN ('kg', 'l') THEN 'soll nicht in kg oder l'
            ELSE 'kein preis' END                                                 AS preis_quelle,
       round(p.soll_menge * coalesce(p.preis_betrieb, f.preis), 2)                AS soll_wert_eur,
       p.soll_wert_fn_eur
  FROM paar p
  LEFT JOIN LATERAL (
        SELECT sum(bp.preis_je_einheit * bp.gesamt_menge) / nullif(sum(bp.gesamt_menge), 0) AS preis
          FROM core.bestellposition bp
          JOIN core.bestellung b    ON b.bestellung_key = bp.bestellung_key
          JOIN core.kostenstelle ks ON ks.kostenstelle_key = b.kostenstelle_key
         WHERE p.preis_betrieb IS NULL
           AND p.einheit IN ('kg', 'l')
           AND bp.lieferanten_nr = p.artikelnummer
           AND ks.marke_key = p.marke_key
           AND bp.einheit = p.einheit
           AND NOT bp.menge_unstimmig AND bp.gesamt_menge > 0 AND bp.preis_je_einheit IS NOT NULL
           AND b.status IS DISTINCT FROM 'canceled'
           AND b.bestellt_am >= (p.monat - interval '11 months')
           AND b.bestellt_am <  (p.monat + interval '1 month')) f ON true;

COMMENT ON VIEW mart.soll_ist_monat IS
'Soll-Verbrauch neben dem Einkauf, je Betrieb, Monat und Ware (Lieferanten-Artikelnummer) — KEIN
Schwund-Urteil (0159). Einkauf ist nicht Verbrauch: die Lagerveraenderung fehlt (Inventuren fast nur bei Wilma
Wunder), und das Soll ist eine Untergrenze (abdeckung_umsatz_pct) — einkauf_zu_soll_pct liegt deshalb auch bei
korrekter Pflege meist ueber 100. Einkauf ohne Stornos, Monat der Bestellung (Berlin), beide Kostenstellen des
Betriebs, Menge nur aus Positionen in kg/l mit belastbarer Gesamtmenge. vergleich sagt, warum ein Vergleich
nicht geht (soll nicht in kg oder l / kein einkauf im monat / einkauf in anderer einheit / einkauf teilweise
ohne menge / soll unvollstaendig / soll null — zuerst die Soll-Seite); einkauf_zu_soll_pct nur bei vergleichbar. soll_wert_eur =
soll_menge × bezahlter Preis je kg/l (preis_quelle); soll_wert_fn_eur = FoodNotifys Rezeptkalkulation.';
COMMENT ON COLUMN mart.soll_ist_monat.einkauf_zu_soll_pct IS
'Eingekaufte Menge / Soll-Menge, Prozentzahl, nur bei vergleichbar. KEIN Schwund: Lager und Abdeckung fehlen —
ueber 100 ist der Normalfall, solange die Abdeckung unter 100 liegt. Nicht mitteln.';
COMMENT ON COLUMN mart.soll_ist_monat.vergleichbar IS
'Soll in kg oder l, Einkauf im Monat in derselben Einheit mit belastbarer Menge, keine Position ohne Menge, Soll
ohne nicht umrechenbare Anteile. Sagt nichts ueber die Abdeckung des Betriebs (abdeckung_umsatz_pct).';
COMMENT ON COLUMN mart.soll_ist_monat.soll_wert_eur IS
'soll_menge × preis_eur_je_einheit (bezahlt, je kg/l, aus core.bestellposition.preis_je_einheit). NULL ohne
Preis oder ausserhalb kg/l. Ein Soll-Wareneinsatz nur dieser Ware und nur des abgedeckten Verkaufs — nicht durch
den Gesamtumsatz teilen.';
COMMENT ON COLUMN mart.soll_ist_monat.preis_quelle IS
'bezahlt, betrieb im monat / bezahlt, marke 12 monate (eigene Bestellungen fehlen im Monat) / kein preis / soll
nicht in kg oder l.';


-- ---------------------------------------------------------------------
-- 9. In mart.materialisierung_stand verankern (0091) — angehaengt, nicht
--    abgeschrieben (wie 0142, 0157). Nachlauf: einkauf_sichten.ts.
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def  text;
    v_neu  text;
BEGIN
    SELECT pg_get_viewdef('mart.materialisierung_stand'::regclass, true) INTO v_def;
    IF v_def LIKE '%rezept_stueckliste_basis%' THEN RETURN; END IF;
    v_neu := regexp_replace(v_def,
        '(''mart\.einkaufspreis_artikel_monat_basis''::text\s*,\s*''einkauf_sichten_refresh''::text\s*,\s*''src/sync/einkauf_sichten\.ts''::text\s*\))',
        '\1, (''mart.rezept_stueckliste_basis''::text, ''einkauf_sichten_refresh''::text, '
        '''src/sync/einkauf_sichten.ts''::text)');
    IF v_neu = v_def THEN
        RAISE EXCEPTION '0159: Verankerung in mart.materialisierung_stand nicht gefunden — die Sicht '
                        'wurde umgebaut. mart.rezept_stueckliste_basis von Hand eintragen.';
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW mart.materialisierung_stand AS ' || v_neu;
END $aussen$;


-- ---------------------------------------------------------------------
-- 10. MCP-Katalog: Koernung, Thema, Summierbarkeit, Kennzahlen, Fallstricke
--
-- Nur Regelarten, die mcp/src/pruefen.ts kennt (deutung, filter_noetig,
-- zeitraum_noetig) — eine unbekannte liesse den Server nicht starten
-- (AGENTS.md, mcp-Regel 1). mcp.kennzahl gilt je SPALTENNAME ueber alle
-- Sichten; nachgesehen am 19.11.2026: keine andere Sicht fuehrt eine der
-- Spalten unten (deshalb menge_verkauft statt menge, das in
-- mart.artikel_nachlass_monat summe heisst).
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.rezept_stueckliste',
     'Rezept × Weg zu einer Ware ueber alle Unterrezept-Ebenen — Menge je EINER verkauften Portion; je Marke, nicht je Betrieb',
     'rezept', false),
    ('mart.rezept_stueckliste_basis',
     'Rezept × Weg zu einer Ware (Zwischenstufe von mart.rezept_stueckliste, ohne Namen)',
     'rezept', false),
    ('mart.soll_rezept_zuordnung',
     'Betrieb × LINA-Artikel mit Rezept — das EINE Rezept, mit dem der Soll-Verbrauch rechnet',
     'rezept', false),
    ('mart.soll_artikel_monat',
     'Betrieb (amadeus-Kasse) × Monat × verkaufter LINA-Artikel — letzte 13 volle Monate und der laufende',
     'rezept', true),
    ('mart.soll_verbrauch_abdeckung',
     'Betrieb (amadeus-Kasse) × Monat — Anteil des Verkaufs, der in den Soll-Verbrauch eingeht',
     'rezept', true),
    ('mart.soll_verbrauch_monat',
     'Betrieb × Monat × Ware (Lieferanten-Artikelnummer) × Einheit — Soll-Menge aus Verkauf × Rezept, Untergrenze',
     'rezept', true),
    ('mart.soll_verbrauch_tag',
     'Betrieb × Geschaeftstag × Ware × Einheit — Soll-Menge aus Verkauf × Rezept, Untergrenze',
     'rezept', true),
    ('mart.soll_ist_monat',
     'Betrieb × Monat × Ware (Lieferanten-Artikelnummer) — Soll-Menge neben eingekaufter Menge, kein Schwund',
     'rezept', true)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

INSERT INTO mcp.kennzahl (sicht, spalte, regel, einheit, hinweis) VALUES
  ('mart.rezept_stueckliste', 'menge_je_portion', 'nicht_aggregieren', NULL,
   'Menge je verkaufter Portion in einheit_soll, je Zeile nennen. Nicht summieren: ein Rezept mischt kg, l und '
   'Rezepteinheiten, und nicht belastbare Zeilen haben keine Menge. Fuer Mengen ueber Verkaeufe mart.soll_verbrauch_monat.'),
  ('mart.rezept_stueckliste', 'kosten_je_portion', 'summe', 'euro',
   'FoodNotifys Kalkulation je Portion; je Rezept summierbar (nur belastbar), kein bezahlter Preis.'),
  ('mart.rezept_stueckliste', 'faktor', 'nicht_aggregieren', NULL, NULL),
  ('mart.soll_artikel_monat', 'menge_verkauft', 'summe', 'anzahl', NULL),
  ('mart.soll_artikel_monat', 'soll_wert_fn_eur', 'summe', 'euro',
   'FoodNotifys Rezeptkalkulation, nur fuer abgedeckte Artikel. Nicht durch den Gesamtumsatz teilen.'),
  ('mart.soll_verbrauch_abdeckung', 'abdeckung_umsatz_pct', 'nicht_aggregieren', 'prozentzahl',
   'Je Betrieb und Monat. Fuer mehrere: sum(umsatz_vollstaendig) / sum(umsatz_netto).'),
  ('mart.soll_verbrauch_abdeckung', 'abdeckung_menge_pct', 'nicht_aggregieren', 'prozentzahl',
   'Je Betrieb und Monat. Fuer mehrere: sum(menge_vollstaendig) / sum(menge_verkauft).'),
  ('mart.soll_verbrauch_abdeckung', 'rezept_umsatz_pct', 'nicht_aggregieren', 'prozentzahl',
   'Je Betrieb und Monat. Fuer mehrere: Euro-Summen neu rechnen.'),
  ('mart.soll_verbrauch_abdeckung', 'umsatz_vollstaendig', 'summe', 'euro', NULL),
  ('mart.soll_verbrauch_abdeckung', 'umsatz_kein_rezept', 'summe', 'euro', NULL),
  ('mart.soll_verbrauch_monat', 'soll_menge', 'summe', NULL,
   'Nur je Ware (artikelnummer) UND einheit summieren — nie ueber Waren oder Einheiten. Untergrenze: '
   'abdeckung_umsatz_pct mitnennen.'),
  ('mart.soll_verbrauch_monat', 'soll_wert_fn_eur', 'summe', 'euro',
   'FoodNotifys Rezeptkalkulation, nur abgedeckter Verkauf.'),
  ('mart.soll_verbrauch_monat', 'portionen_nicht_umrechenbar', 'nicht_aggregieren', 'anzahl',
   'Je Ware; ueber Waren summiert zaehlt dieselbe Portion mehrfach.'),
  ('mart.soll_ist_monat', 'eingekauft_menge', 'summe', NULL,
   'In der Einheit der Zeile (kg oder l); nur je Ware summieren.'),
  ('mart.soll_ist_monat', 'einkauf_zu_soll_pct', 'nicht_aggregieren', 'prozentzahl',
   'Nur bei vergleichbar; kein Schwund, ueber 100 ist bei unvollstaendiger Abdeckung der Normalfall.'),
  ('mart.soll_ist_monat', 'soll_wert_eur', 'summe', 'euro',
   'Soll-Menge × bezahlter Preis je kg/l; nicht durch den Gesamtumsatz teilen.'),
  ('mart.soll_ist_monat', 'preis_eur_je_einheit', 'nicht_aggregieren', 'euro', 'Je kg bzw. l.')
ON CONFLICT (sicht, spalte) DO UPDATE
   SET regel = excluded.regel, einheit = excluded.einheit, hinweis = excluded.hinweis;

INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle) VALUES
  ('soll_verbrauch_untergrenze', 'deutung', 'warnung', 'mart.soll_verbrauch_monat', '{}',
   'Der Soll-Verbrauch umfasst nur verkaufte Artikel mit zugeordnetem UND umrechenbarem Rezept — eine '
   'Untergrenze, nie der ganze Verbrauch. Wie viel eingeht, steht in abdeckung_umsatz_pct (oft deutlich unter '
   '100). Rezepteinheiten wie "Portionierer" oder "Stück" eines Halbfabrikats sind nicht umrechenbar und fehlen. '
   'Vorerst nur Wilma Wunder (Kassenzuordnung). Rezept und Zuordnung sind der heutige Stand.',
   'Jede Soll-Zahl mit abdeckung_umsatz_pct nennen ("deckt X % des Artikelumsatzes ab"); soll_menge nur je Ware '
   'und Einheit summieren; nie als Gesamtverbrauch oder Wareneinsatzquote ausgeben.',
   '0159'),
  ('soll_verbrauch_tag_untergrenze', 'deutung', 'warnung', 'mart.soll_verbrauch_tag', '{}',
   'Wie mart.soll_verbrauch_monat: eine Untergrenze, nur abgedeckte Artikel. abdeckung_umsatz_pct gilt fuer den '
   'Betrieb und Tag.',
   'Mit abdeckung_umsatz_pct nennen; soll_menge nur je Ware und Einheit summieren.',
   '0159'),
  ('soll_verbrauch_tag_zeitraum', 'zeitraum_noetig', 'warnung', 'mart.soll_verbrauch_tag',
   '{"spalte": "geschaeftstag"}',
   'Ohne Filter auf geschaeftstag rechnet die Sicht 13 Monate Artikelverkauf aller Betriebe gegen die Rezepte.',
   'WHERE geschaeftstag BETWEEN ... setzen, am besten auch betrieb_key; fuer Monate mart.soll_verbrauch_monat.',
   '0159'),
  ('soll_ist_kein_schwund', 'deutung', 'warnung', 'mart.soll_ist_monat', '{}',
   'Einkauf ist nicht Verbrauch: die Lagerveraenderung fehlt (Inventuren fast nur bei Wilma Wunder), und das '
   'Soll ist eine Untergrenze (abdeckung_umsatz_pct). Mehr Einkauf als Soll ist deshalb der Normalfall und KEIN '
   'Schwund, kein Diebstahl, keine Verschwendung. Bestellmonat ist nicht Liefer- oder Verbrauchsmonat.',
   'Als "eingekauft X kg, laut Rezept mindestens Y kg verbraucht (Abdeckung Z %)" nennen; kein Schwund-, '
   'Verlust- oder Effizienzurteil; mehrere Monate zusammen betrachten.',
   '0159'),
  ('soll_ist_vergleichbar', 'filter_noetig', 'warnung', 'mart.soll_ist_monat',
   '{"spalte": "vergleichbar", "wert": true}',
   'Ohne vergleichbar = true stehen Zeilen dabei, deren Einheiten nicht zusammenpassen (Soll in Stueck, Einkauf '
   'in l, Positionen ohne belastbare Menge) oder deren Soll unvollstaendig ist — dort ist eingekauft_menge '
   'neben soll_menge kein Vergleich.',
   'WHERE vergleichbar setzen oder vergleich mitnennen; einkauf_zu_soll_pct ist ausserhalb ohnehin NULL.',
   '0159'),
  ('soll_rezeptstand_heute', 'deutung', 'warnung', 'mart.soll_artikel_monat', '{}',
   'Kassenzuordnung und Rezept sind der HEUTIGE Stand und werden auf fruehere Monate angewendet (FoodNotify '
   'fuehrt keine Historie). Fuehren Bar und Kueche einen Artikel mit verschiedenen Rezepten, rechnet die Sicht '
   'mit einem (rezept_uneindeutig). soll_wert_fn_eur ist FoodNotifys Kalkulation, kein bezahlter Wareneinsatz.',
   'Den Rezeptstand nennen; fuer weit zurueckliegende Monate vorsichtig formulieren; rezept_uneindeutig zeigen.',
   '0159'),
  ('rezept_stueckliste_belastbar', 'filter_noetig', 'warnung', 'mart.rezept_stueckliste',
   '{"spalte": "belastbar", "wert": true}',
   'Zeilen mit belastbar = false haben keine Menge (Einheit nicht umrechenbar, Halbfabrikat fehlt oder leer, '
   'Zyklus). Eine Summe ueber menge_je_portion ohne den Filter laesst sie still weg und sieht vollstaendig aus.',
   'Fuer Mengen WHERE belastbar setzen und rezept_belastbar bzw. die Zahl der nicht belastbaren Zeilen nennen; '
   'fuer "woraus besteht das Rezept" alle Zeilen mit grund zeigen.',
   '0159')
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

-- Der Fallstrick aus 0155 sagte "Ein Wareneinsatz aus Rezepten ist nicht gebaut." — jetzt gibt es einen
-- Soll-Verbrauch, und der Verweis gehoert dorthin.
UPDATE mcp.fallstrick
   SET hinweis =
       'Die Abdeckung sagt, welcher Umsatzanteil ein Rezept TRAEGT — nicht, was die Ware gekostet hat, und nicht, '
       'ob das Rezept stimmt. Den Soll-Verbrauch aus Rezepten rechnen mart.soll_verbrauch_monat und '
       'mart.soll_ist_monat (seit 0159), mit eigener Abdeckung (mart.soll_verbrauch_abdeckung).',
       berichtigung =
       'Als Reichweite der Kassenzuordnung nennen, nicht als Wareneinsatzquote; fuer Mengen den Soll-Verbrauch nehmen.',
       quelle = '0155, 0159'
 WHERE schluessel = 'pos_artikel_kein_wareneinsatz';

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

DO $$
DECLARE
    v_kz int;
    v_fs int;
BEGIN
    SELECT count(*) INTO v_kz FROM mcp.kennzahl WHERE sicht IN
        ('mart.rezept_stueckliste', 'mart.soll_artikel_monat', 'mart.soll_verbrauch_abdeckung',
         'mart.soll_verbrauch_monat', 'mart.soll_ist_monat');
    SELECT count(*) INTO v_fs FROM mcp.fallstrick WHERE aktiv AND quelle = '0159';
    IF v_kz <> 17 OR v_fs <> 7 THEN
        RAISE EXCEPTION '0159: % von 17 Kennzahlen und % von 7 Fallstricken eingetragen', v_kz, v_fs;
    END IF;
END $$;


-- ---------------------------------------------------------------------
-- 11. Rechte und die Gegenprobe als Leserolle (Pflicht seit 0110)
--
-- Seit 0153 vergibt mcp.rechte_auffrischen() im Schema mcp nur den Katalog
-- (docs/fehlerkatalog.md, 12.11.2026) — kein eigener GRANT-Block hier, kein
-- kopierter Rechteblock aus einer aelteren Migration. Danach muss
-- mart.mcp_rechte_pruefung leer sein, und als mcp_leser muessen die neuen
-- Sichten lesbar und mcp.zugriff unlesbar sein. core.einheit_metrisch liest
-- keine Tabelle; die Sichten rufen sie mit den Rechten des Eigentuemers.
-- ---------------------------------------------------------------------

SELECT mcp.rechte_auffrischen();

DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
    v_rechte  int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0159 ist uebersprungen';
        RETURN;
    END IF;

    SELECT count(*) INTO v_rechte FROM mart.mcp_rechte_pruefung;
    IF v_rechte > 0 THEN
        RAISE EXCEPTION '0159: mart.mcp_rechte_pruefung ist nicht leer (% Zeilen)', v_rechte;
    END IF;

    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0159 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.rezept_stueckliste LIMIT 1',
        'SELECT * FROM mart.rezept_stueckliste_basis LIMIT 1',
        'SELECT * FROM mart.soll_rezept_zuordnung LIMIT 1',
        'SELECT * FROM mart.soll_artikel_monat LIMIT 1',
        'SELECT * FROM mart.soll_verbrauch_abdeckung LIMIT 1',
        'SELECT * FROM mart.soll_verbrauch_monat LIMIT 1',
        'SELECT * FROM mart.soll_verbrauch_tag WHERE geschaeftstag = current_date - 1 LIMIT 1',
        'SELECT * FROM mart.soll_ist_monat LIMIT 1',
        'SELECT * FROM mart.materialisierung_stand WHERE sicht = ''mart.rezept_stueckliste_basis''']
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
        RAISE EXCEPTION '0159 hat sein Ziel nicht erreicht — fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
