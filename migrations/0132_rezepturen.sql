-- =====================================================================
-- 0132 — Rezepturen aus FoodNotify: core.rezept/core.zutat befuellbar,
--        vier mart-Sichten, Pruefzeilen, MCP-Katalog
--
-- ANLASS (15.10.2026): „In welchen Rezepten steckt Artikelnummer X?" war
-- aus der Datenbank nicht zu beantworten. core.rezept und core.zutat stehen
-- seit 0030 im Schema und waren leer — kein Endpunkt, kein Schreiber
-- (sync.quelle fuehrte core:rezept deshalb seit 0076 als erwartet = false).
-- Plan und Entscheidungen A–D: docs/plan-rezepturen.md.
--
-- WAS DIESE MIGRATION TUT:
--
--   core.zutat   art laesst 'product_group' zu (1.855 echte Zeilen bei
--                Enchilada haette der alte CHECK abgewiesen); ware_fn_id
--                heisst jetzt artikelnummer — die Spalte haelt die
--                LIEFERANTEN-Artikelnummer und NICHT core.ware.fn_id, und
--                der alte Name lud genau zu diesem falschen Join ein
--                (866 IDs auf 428 Namen, 10,1 % Treffer in 0094).
--                Neu: lieferant_fn_id, gruppe, sub_rezept_fn_id;
--                menge ohne feste Nachkommastellen.
--   core.rezept  gewicht_gesamt, gewicht_person, portion, portion_einheit,
--                verlust_roh, in_liste, zutaten_geholt_am, meta_geholt_am.
--   core.rezept  dazu fehlt_seit: FoodNotify antwortete mit HTTP 404.
--   sync         Warteschlangen-Ergebnis 'nicht_gefunden' (404 auf einen
--                Rezeptabruf) — NICHT 'aufgegeben', das wuerde dreimal
--                wiederbelebt und stuende fuer immer in mart.posten_aufgegeben.
--   mart         rezept_position, artikel_in_rezept, rezept_stand,
--                rezept_zuordnung_pruefung; zwei Spalten in
--                mart.datenstand, zwei Zeilen in mart.pruefung_uebersicht.
--
-- Bestehende Kennzahlen (deckungsbeitrag_warengruppe, round_table, fixer_we)
-- bleiben unberuehrt: dieser Schritt ergaenzt nur.
--
-- Beide Tabellen sind leer (0 Zeilen, in Produktion am 14.08.2026 gezaehlt,
-- lokal am 15.10.2026), die Typaenderungen kosten also nichts.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. core.zutat
-- ---------------------------------------------------------------------

ALTER TABLE core.zutat DROP CONSTRAINT IF EXISTS zutat_art_check;
ALTER TABLE core.zutat ADD CONSTRAINT zutat_art_check
    CHECK (art IN ('ingredient', 'sub_recipe', 'product_group'));

ALTER TABLE core.zutat RENAME COLUMN ware_fn_id TO artikelnummer;
ALTER INDEX core.zutat_ware RENAME TO zutat_artikelnummer;

ALTER TABLE core.zutat
    ALTER COLUMN menge TYPE numeric,
    ADD COLUMN lieferant_fn_id  integer,
    ADD COLUMN gruppe           text,
    ADD COLUMN sub_rezept_fn_id integer;

CREATE INDEX zutat_sub_rezept_fn ON core.zutat (sub_rezept_fn_id) WHERE sub_rezept_fn_id IS NOT NULL;

COMMENT ON COLUMN core.zutat.art IS
'kind aus /api/recipes/{id}/ingredients: ingredient (Ware), sub_recipe
(Verweis auf ein eigenes Rezept, ein Halbfabrikat) oder product_group.
product_group traegt wie ingredient artikelId und supplier, die Namen enden
auf "(EN)" -- Bedeutung in FoodNotify ungeklaert, fachlich wie eine Ware
behandelt. Gemessen am Enchilada-Abzug 14./15.09.2026: 3.614 / 1.983 / 1.855.
Ein vierter Wert scheitert am CHECK -- laut, nicht still (0132).';
COMMENT ON COLUMN core.zutat.artikelnummer IS
'Lieferanten-Artikelnummer: artikelId aus der Antwort. Dieselbe Nummer wie
core.bestellposition.lieferanten_nr (je Marke) und wie SellerAssignedID in
ZUGFeRD-Rechnungen. NICHT core.ware.fn_id (FoodNotifys interne Warennummer,
866 IDs auf 428 Namen) und NICHT core.artikel.artikelnummer (LINA, das, was
verkauft wird). Text, weil FoodNotify einen String liefert. Leer bei allen
Unterrezepten und bei Freitextzutaten. Bis 0132 hiess die Spalte ware_fn_id.';
COMMENT ON COLUMN core.zutat.lieferant_fn_id IS
'supplier.id -- FoodNotifys Lieferanten-ID, standortbezogen benannt ("DISTRA
Enchilada_Coyacan" = 6421). Mitgefuehrt, weil dieselbe Artikelnummer bei zwei
Lieferanten zwei Waren sein kann (gemessen bei 715, 200004, 10956). Ob sie mit
core.lieferant.fn_id zusammenfindet, ist NICHT gemessen.';
COMMENT ON COLUMN core.zutat.gruppe IS
'group aus der Antwort -- selten gefuellt (409 von 7.452 bei Enchilada), z. B. "Main".';
COMMENT ON COLUMN core.zutat.sub_rezept_fn_id IS
'subRecipeId -- das Rezept, auf das ein sub_recipe zeigt. Die Aufloesung in
mart.artikel_in_rezept laeuft ueber (marke_key, sub_rezept_fn_id), NICHT ueber
sub_rezept_key: das Unterrezept kann spaeter geladen werden als der Verweis
(56 Enchilada-Rezepte stehen in keiner Listenseite und kommen nur ueber den
Verweis). sub_rezept_key wird nachgezogen, sobald das Rezept da ist.';
COMMENT ON COLUMN core.zutat.menge IS
'quantity -- in der Einheit der Zeile (einheit). Einheiten sind Freitext
("cl", "g", "Limetten 8tel", "Portionierer Silber (60g)"): Mengen sind NUR
innerhalb derselben Einheit vergleichbar und ueber Rezeptebenen NICHT
multiplizierbar (docs/plan-rezepturen.md §4).';


-- ---------------------------------------------------------------------
-- 2. core.rezept
-- ---------------------------------------------------------------------

ALTER TABLE core.rezept
    ADD COLUMN gewicht_gesamt    numeric,
    ADD COLUMN gewicht_person    numeric,
    ADD COLUMN portion           numeric,
    ADD COLUMN portion_einheit   text,
    ADD COLUMN verlust_roh       numeric,
    ADD COLUMN in_liste          boolean NOT NULL DEFAULT false,
    ADD COLUMN zutaten_geholt_am timestamptz,
    ADD COLUMN meta_geholt_am    timestamptz,
    ADD COLUMN fehlt_seit        timestamptz;

CREATE INDEX rezept_umlauf ON core.rezept (zutaten_geholt_am NULLS FIRST, marke_key);

COMMENT ON TABLE core.rezept IS
'Rezepte aus /api/recipes. JE MARKE GETRENNT gepflegt (ein FoodNotify-Mandant
je Marke) -- deshalb marke_key im Schluessel, sonst kollidieren die fn_id beim
zweiten Mandanten. Befuellt seit 0132 (fn:rezepte, fn:rezept,
fn:rezept_zutaten, fn:rezept_meta). FoodNotify fuehrt kein Aenderungsdatum,
keinen Status und keine Fassungen: was im Rezept stand, ist erst ab dem ersten
Abruf beantwortbar, und Gueltigkeit gibt es nur als beobachteten Zeitraum
(erstmals_am / zuletzt_am).';
COMMENT ON COLUMN core.rezept.erstellt_am IS
'createdAt aus FoodNotify -- wann das Rezept in FoodNotify angelegt wurde,
NICHT wann wir es geladen haben (dafuer erstmals_am / zuletzt_am).';
COMMENT ON COLUMN core.rezept.zuletzt_am IS
'Zuletzt in einer Listenseite oder ueber /api/recipes/{id} gesehen. Bleibt ein
Rezept aus der Liste weg, bleibt dieser Stempel stehen -- mart.rezept_stand
zaehlt das als aus_liste_verschwunden.';
COMMENT ON COLUMN core.rezept.in_liste IS
'true = mindestens einmal auf einer Seite von /api/recipes?page=N gesehen.
false = nur ueber einen Verweis (subRecipeId) gefunden und einzeln ueber
/api/recipes/{id} geholt. Die Liste ist keine vollstaendige Aufzaehlung:
56 Enchilada-Rezepte waren nur ueber Verweise erreichbar (foodnotify-api-inventar.md §3).';
COMMENT ON COLUMN core.rezept.verlust_roh IS
'meta.weight.loss UNGEDEUTET. Gemessen: 0 bei 1.163 Rezepten, 100 bei 476,
sonst krumm (1,1038 ...). Ob Prozent, Faktor oder Ausbeute, ist offen --
NICHT damit rechnen.';
COMMENT ON COLUMN core.rezept.gewicht_gesamt IS 'meta.weight.total.';
COMMENT ON COLUMN core.rezept.gewicht_person IS 'meta.weight.perPerson.';
COMMENT ON COLUMN core.rezept.portion IS 'meta.weight.portionSize, in portion_einheit.';
COMMENT ON COLUMN core.rezept.zutaten_geholt_am IS
'Letzter erfolgreicher Abruf von /ingredients. NULL = noch nie. Daran haengt der
Umlauf (REZEPT_UMLAUF_TAGE): FoodNotify hat kein Aenderungsdatum, also wird
jedes Rezept spaetestens nach N Tagen neu gelesen.';
COMMENT ON COLUMN core.rezept.meta_geholt_am IS 'Letzter erfolgreicher Abruf von /meta.';
COMMENT ON COLUMN core.rezept.fehlt_seit IS
'Seit wann FoodNotify auf einen Abruf dieses Rezepts (Kopf, Zutaten, Meta) mit
HTTP 404 antwortet -- vermutlich geloescht. NULL = zuletzt gefunden. Ein
spaeterer erfolgreicher Abruf setzt es zurueck. Die Zutaten bleiben auf dem
letzten gelesenen Stand stehen; der Umlauf fragt hoechstens einmal je
REZEPT_UMLAUF_TAGE nach.';


-- ---------------------------------------------------------------------
-- 2a. Warteschlange: Ergebnis 'nicht_gefunden'
--
-- Ein Rezept, das mit 404 antwortet, ist kein Fehler des Abrufs, sondern
-- eine Aussage ueber das Rezept. Als 'aufgegeben' holte
-- aufgegebeneWiederbeleben() den Posten dreimal zurueck (bis zu acht
-- Aufrufe je Umlauf), und er stuende dauerhaft in mart.posten_aufgegeben —
-- eine Pruefzeile, die nie auf null geht. Dieselbe Ueberlegung wie bei
-- 'kein_zugriff' (0075) und 'abgeschaltet' (0119). Sichtbar bleibt es am
-- Rezept: core.rezept.fehlt_seit, mart.rezept_stand.nicht_gefunden.
-- ---------------------------------------------------------------------

ALTER TABLE sync.warteschlange DROP CONSTRAINT IF EXISTS warteschlange_ergebnis_check;
ALTER TABLE sync.warteschlange ADD CONSTRAINT warteschlange_ergebnis_check
    CHECK (ergebnis IN ('ok', 'keine_daten', 'aufgegeben', 'kein_zugriff',
                        'fenster_zu_gross', 'abgeschaltet', 'nicht_gefunden'));


-- ---------------------------------------------------------------------
-- 3. Index fuer die Zuordnung Zutat -> Einkauf
--
-- core.bestellposition hatte keinen Index auf lieferanten_nr; mart.rezept_position
-- fragt je Zutat "gibt es eine Bestellposition derselben Marke mit dieser
-- Nummer?". Ohne Index ein Vollscan ueber 634.175 Positionen je Abfrage.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS bestellposition_lieferanten_nr
    ON core.bestellposition (lieferanten_nr) WHERE lieferanten_nr IS NOT NULL;


-- ---------------------------------------------------------------------
-- 4. mart.rezept_position — eine Zeile je Rezept und Zutatenposition
-- ---------------------------------------------------------------------

CREATE VIEW mart.rezept_position AS
SELECT m.name                    AS marke,
       r.marke_key,
       r.rezept_key,
       r.fn_id                   AS rezept_fn_id,
       r.name                    AS rezept,
       z.position,
       z.art,
       z.artikelnummer,
       z.name                    AS ware,
       z.lieferant_name          AS lieferant,
       z.lieferant_fn_id,
       z.menge,
       z.einheit,
       z.kosten,
       z.gruppe,
       z.sub_rezept_fn_id,
       u.name                    AS unterrezept,
       CASE
           WHEN z.art = 'sub_recipe' THEN 'unterrezept'
           WHEN nullif(btrim(z.artikelnummer), '') IS NULL THEN 'ohne nummer'
           WHEN EXISTS (
                SELECT 1
                  FROM core.bestellposition bp
                  JOIN core.bestellung b    ON b.bestellung_key = bp.bestellung_key
                  JOIN core.kostenstelle ks ON ks.kostenstelle_key = b.kostenstelle_key
                 WHERE bp.lieferanten_nr = z.artikelnummer
                   AND ks.marke_key = r.marke_key) THEN 'eingekauft'
           ELSE 'nummer ohne einkauf'
       END                       AS zuordnung,
       r.in_liste,
       r.zutaten_geholt_am,
       r.fehlt_seit,
       (z.art = 'sub_recipe' AND u.rezept_key IS NULL) AS unterrezept_unbekannt
  FROM core.zutat z
  JOIN core.rezept r ON r.rezept_key = z.rezept_key
  JOIN core.marke m  ON m.marke_key = r.marke_key
  LEFT JOIN core.rezept u ON u.marke_key = r.marke_key AND u.fn_id = z.sub_rezept_fn_id;

COMMENT ON VIEW mart.rezept_position IS
'Eine Zeile je Rezept und Zutatenposition, so wie FoodNotify sie fuehrt (je Marke,
nicht je Betrieb). artikelnummer ist die LIEFERANTEN-Artikelnummer -- nicht die
LINA-Artikelnummer der Kasse. zuordnung sagt, ob die Nummer im Einkauf derselben
Marke vorkommt: eingekauft / nummer ohne einkauf / ohne nummer / unterrezept.
kosten ist FoodNotifys Wert und nicht aus Unterrezepten nachrechenbar; bei
Unterrezept-Zeilen steht dort oft 0. Mengen nur innerhalb einer Einheit
vergleichen.';
COMMENT ON COLUMN mart.rezept_position.artikelnummer IS
'Lieferanten-Artikelnummer (artikelId in FoodNotify). Dieselbe Nummer wie im
Einkauf (Bestellposition) -- nicht die Artikelnummer der Kasse.';
COMMENT ON COLUMN mart.rezept_position.zuordnung IS
'eingekauft: die Nummer steht in einer Bestellung derselben Marke.
nummer ohne einkauf: Nummer da, aber nie bestellt (Altnummer, anderer Lieferant, Tippfehler).
ohne nummer: Freitextzutat ohne Artikelnummer.
unterrezept: Verweis auf ein Halbfabrikat -- keine Ware.';
COMMENT ON COLUMN mart.rezept_position.fehlt_seit IS
'Gesetzt, wenn FoodNotify das Rezept nicht mehr findet (HTTP 404) -- vermutlich geloescht.
Die Zeilen zeigen den letzten gelesenen Stand.';
COMMENT ON COLUMN mart.rezept_position.unterrezept_unbekannt IS
'Unterrezept-Zeile, deren Halbfabrikat wir nicht kennen (noch nicht geholt oder bei
FoodNotify nicht gefunden). Was darin steckt, fehlt in mart.artikel_in_rezept.';


-- ---------------------------------------------------------------------
-- 5. mart.artikel_in_rezept — Ware x Rezept x Weg, rekursiv
--
-- "300203 steckt in Pizza X ueber Teig Y": ebene 1 = die Ware steht direkt
-- im Rezept, ebene 2 = ueber ein Halbfabrikat, ebene 3 = ueber eines, das
-- selbst eines enthaelt.
--
-- MENGEN WERDEN UEBER EBENEN NICHT MULTIPLIZIERT. menge/einheit ist die Menge
-- der Ware im Rezept, in dem sie DIREKT steht (direkt_rezept); via_menge/
-- via_einheit ist, wie viel vom Halbfabrikat im Rezept steht. Eine
-- Effektivmenge braeuchte Einheitenumrechnung und die Ausbeute des
-- Halbfabrikats -- beides liefert FoodNotify nicht verlaesslich.
--
-- ZYKLUSSCHUTZ: kette haelt die Rezepte des Wegs; ein Rezept, das schon im
-- Weg steht, wird nicht noch einmal betreten. Dazu eine harte Tiefengrenze
-- (12), damit auch ein Fehler im Schutz terminiert.
-- ---------------------------------------------------------------------

CREATE VIEW mart.artikel_in_rezept AS
WITH RECURSIVE kante AS (
    -- Rezept eltern enthaelt das Halbfabrikat kind (in derselben Marke).
    SELECT z.rezept_key AS eltern_key,
           k.rezept_key AS kind_key,
           z.position   AS via_position,
           z.menge      AS via_menge,
           z.einheit    AS via_einheit
      FROM core.zutat z
      JOIN core.rezept p ON p.rezept_key = z.rezept_key
      JOIN core.rezept k ON k.marke_key = p.marke_key AND k.fn_id = z.sub_rezept_fn_id
     WHERE z.art = 'sub_recipe'
), weg AS (
    SELECT rp.marke, rp.marke_key, rp.artikelnummer, rp.ware, rp.lieferant,
           rp.lieferant_fn_id, rp.zuordnung, rp.art,
           rp.rezept_key        AS direkt_key,
           rp.rezept            AS direkt_rezept,
           rp.position,
           rp.menge, rp.einheit, rp.kosten,
           rp.rezept_key        AS rezept_key,
           1                    AS ebene,
           NULL::integer        AS via_key,
           NULL::integer        AS via_position,
           NULL::numeric        AS via_menge,
           NULL::text           AS via_einheit,
           ARRAY[rp.rezept_key] AS kette,
           rp.rezept            AS pfad
      FROM mart.rezept_position rp
     WHERE rp.art <> 'sub_recipe'
    UNION ALL
    SELECT w.marke, w.marke_key, w.artikelnummer, w.ware, w.lieferant,
           w.lieferant_fn_id, w.zuordnung, w.art,
           w.direkt_key, w.direkt_rezept, w.position,
           w.menge, w.einheit, w.kosten,
           k.eltern_key,
           w.ebene + 1,
           k.kind_key,
           k.via_position,
           k.via_menge,
           k.via_einheit,
           k.eltern_key || w.kette,
           e.name || ' → ' || w.pfad
      FROM weg w
      JOIN kante k       ON k.kind_key = w.rezept_key
      JOIN core.rezept e ON e.rezept_key = k.eltern_key
     WHERE k.eltern_key <> ALL (w.kette)
       AND w.ebene < 12
)
SELECT w.marke,
       w.marke_key,
       w.artikelnummer,
       w.ware,
       w.lieferant,
       w.lieferant_fn_id,
       w.zuordnung,
       r.name            AS rezept,
       r.fn_id           AS rezept_fn_id,
       w.rezept_key,
       w.ebene,
       v.name            AS via_rezept,
       v.fn_id           AS via_rezept_fn_id,
       w.via_position,
       w.via_menge,
       w.via_einheit,
       w.direkt_rezept,
       w.direkt_key,
       w.position,
       w.menge,
       w.einheit,
       w.kosten,
       w.pfad,
       w.art,
       r.fehlt_seit AS rezept_fehlt_seit
  FROM weg w
  JOIN core.rezept r      ON r.rezept_key = w.rezept_key
  LEFT JOIN core.rezept v ON v.rezept_key = w.via_key;

COMMENT ON VIEW mart.artikel_in_rezept IS
'In welchen Rezepten steckt eine Ware -- direkt (ebene 1) oder ueber Halbfabrikate
(ebene 2, 3, ...). Eine Zeile je Ware, Rezept und Weg. via_rezept ist das
Halbfabrikat, ueber das die Ware in das Rezept kommt; pfad zeigt den ganzen Weg
vom Rezept bis zum Halbfabrikat, in dem die Ware direkt steht. menge/einheit ist
die Menge im Rezept, in dem die Ware DIREKT steht (direkt_rezept) -- Mengen werden
ueber Ebenen NICHT multipliziert und sind ueber Einheiten nicht summierbar.
Filtern ueber artikelnummer (Lieferanten-Artikelnummer).';
COMMENT ON COLUMN mart.artikel_in_rezept.menge IS
'Menge der Ware im Rezept, in dem sie direkt steht (direkt_rezept) -- NICHT die
Menge im Rezept dieser Zeile, sobald ebene > 1. Nicht ueber Ebenen multiplizieren.';
COMMENT ON COLUMN mart.artikel_in_rezept.via_menge IS
'Wie viel vom Halbfabrikat (via_rezept) im Rezept dieser Zeile steht, in via_einheit.';
COMMENT ON COLUMN mart.artikel_in_rezept.pfad IS
'Rezept → Halbfabrikat → ... → Rezept, in dem die Ware direkt steht. Bei ebene 1 nur das Rezept.';
COMMENT ON COLUMN mart.artikel_in_rezept.artikelnummer IS
'Lieferanten-Artikelnummer (artikelId in FoodNotify) -- nicht die Artikelnummer der Kasse.';


-- ---------------------------------------------------------------------
-- 6. mart.rezept_stand — je Marke, wie weit die Rezepte geladen sind
--
-- REGEL 10: eine Marke ohne Rezeptzulauf muss SICHTBAR werden, nicht nur
-- im Log. mart.quelle_zulauf misst je Quelle ueber alle Marken; faellt EINE
-- Marke aus (Rechte entzogen, Hülle geaendert), bliebe die Quelle wegen der
-- anderen drei gruen. Deshalb hier je Marke, mit Zustand, und eine
-- Pruefzeile in mart.pruefung_uebersicht.
-- ---------------------------------------------------------------------

CREATE VIEW mart.rezept_stand AS
WITH r AS (
    SELECT marke_key,
           count(*)::int                                         AS rezepte,
           count(*) FILTER (WHERE in_liste)::int                 AS in_liste,
           count(*) FILTER (WHERE NOT in_liste)::int             AS nur_ueber_verweis,
           count(*) FILTER (WHERE zutaten_geholt_am IS NOT NULL)::int AS mit_zutaten,
           count(*) FILTER (WHERE zutaten_geholt_am IS NULL)::int     AS ohne_zutaten,
           min(zutaten_geholt_am)                                AS aeltester_zutatenabruf,
           max(zutaten_geholt_am)                                AS juengster_zutatenabruf,
           max(zuletzt_am)                                       AS zuletzt_gesehen,
           count(*) FILTER (WHERE fehlt_seit IS NOT NULL)::int   AS nicht_gefunden
      FROM core.rezept
     GROUP BY marke_key
), weg AS (
    -- In der Liste gewesen, aber seit mehr als drei Tagen nicht mehr gesehen,
    -- waehrend die Liste der Marke weiter geholt wurde. Drei Tage, weil die
    -- Liste instabil sortiert ist und an Seitengrenzen einzelne Rezepte an
    -- einem Tag verschluckt (foodnotify-api-inventar.md §3).
    SELECT x.marke_key, count(*)::int AS aus_liste_verschwunden
      FROM core.rezept x
      JOIN r ON r.marke_key = x.marke_key
     WHERE x.in_liste AND x.zuletzt_am < r.zuletzt_gesehen - interval '3 days'
     GROUP BY x.marke_key
), z AS (
    SELECT r2.marke_key, count(*)::int AS zutatenzeilen
      FROM core.zutat zz JOIN core.rezept r2 ON r2.rezept_key = zz.rezept_key
     GROUP BY r2.marke_key
), verweis AS (
    -- Unterrezept-Verweise, deren Rezept wir nicht kennen (noch nicht geholt
    -- oder 404). Zaehlt verschiedene Rezept-IDs.
    SELECT p.marke_key, count(DISTINCT zz.sub_rezept_fn_id)::int AS verweise_ohne_rezept
      FROM core.zutat zz
      JOIN core.rezept p ON p.rezept_key = zz.rezept_key
     WHERE zz.sub_rezept_fn_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM core.rezept u
                        WHERE u.marke_key = p.marke_key AND u.fn_id = zz.sub_rezept_fn_id)
     GROUP BY p.marke_key
), liste AS (
    SELECT a.marke_key, max(a.beendet_am) AS letzte_liste
      FROM sync.aufgabe a
     WHERE a.endpunkt = 'fn:rezepte' AND a.status = 'ok'
     GROUP BY a.marke_key
), fn AS (
    -- Hat die Marke ueberhaupt FoodNotify-Zulauf? Ohne Zugang (keine
    -- FN_*_USER) ist "keine Rezepte" kein Befund, sondern Konfiguration.
    SELECT a.marke_key, max(a.beendet_am) AS letzter_fn_abruf
      FROM sync.aufgabe a
     WHERE a.endpunkt IN ('fn:profil', 'fn:kostenstellen') AND a.beendet_am > now() - interval '7 days'
     GROUP BY a.marke_key
)
SELECT m.marke_key,
       m.name                               AS marke,
       coalesce(r.rezepte, 0)               AS rezepte,
       coalesce(r.in_liste, 0)              AS in_liste,
       coalesce(r.nur_ueber_verweis, 0)     AS nur_ueber_verweis,
       coalesce(r.mit_zutaten, 0)           AS mit_zutaten,
       coalesce(r.ohne_zutaten, 0)          AS ohne_zutaten,
       coalesce(z.zutatenzeilen, 0)         AS zutatenzeilen,
       coalesce(weg.aus_liste_verschwunden, 0) AS aus_liste_verschwunden,
       r.aeltester_zutatenabruf,
       r.juengster_zutatenabruf,
       (current_date - r.aeltester_zutatenabruf::date) AS tage_seit_aeltestem_abruf,
       liste.letzte_liste,
       fn.letzter_fn_abruf,
       CASE
           WHEN fn.letzter_fn_abruf IS NULL THEN 'kein FoodNotify-Zulauf'
           WHEN liste.letzte_liste IS NULL THEN 'liste nie geholt'
           WHEN liste.letzte_liste < now() - interval '36 hours' THEN 'liste veraltet'
           WHEN coalesce(r.rezepte, 0) = 0 THEN 'keine rezepte'
           -- Zutaten wurden abgerufen, aber KEINE einzige Zeile kam an: eine
           -- Antwortform, die der Lader nicht als Fehler erkannt hat.
           WHEN r.mit_zutaten > 0 AND coalesce(z.zutatenzeilen, 0) = 0 THEN 'zutaten leer'
           WHEN r.ohne_zutaten > 0 THEN 'zutaten ausstehend'
           ELSE 'ok'
       END                                  AS zustand,
       coalesce(r.nicht_gefunden, 0)        AS nicht_gefunden,
       coalesce(verweis.verweise_ohne_rezept, 0) AS verweise_ohne_rezept
  FROM core.marke m
  LEFT JOIN r     ON r.marke_key = m.marke_key
  LEFT JOIN z     ON z.marke_key = m.marke_key
  LEFT JOIN weg   ON weg.marke_key = m.marke_key
  LEFT JOIN liste ON liste.marke_key = m.marke_key
  LEFT JOIN fn    ON fn.marke_key = m.marke_key
  LEFT JOIN verweis ON verweis.marke_key = m.marke_key;

COMMENT ON VIEW mart.rezept_stand IS
'Je Marke: wie viele Rezepte geladen sind, wie viele nur ueber einen Verweis
gefunden wurden, wie viele noch ohne Zutaten sind, und wann die Rezeptliste
zuletzt geholt wurde. zustand: ok / zutaten ausstehend (Backfill laeuft) /
zutaten leer, keine rezepte, liste veraltet, liste nie geholt (Fehler, Regel 10) /
kein FoodNotify-Zulauf (Marke ohne Zugang, kein Befund). nicht_gefunden: Rezepte,
auf die FoodNotify mit 404 antwortet (vermutlich geloescht). verweise_ohne_rezept:
Halbfabrikate, auf die ein Rezept zeigt, die wir aber nicht kennen.';


-- ---------------------------------------------------------------------
-- 7. mart.rezept_zuordnung_pruefung — je Marke und Zuordnung, in Prozentzahlen
-- ---------------------------------------------------------------------

CREATE VIEW mart.rezept_zuordnung_pruefung AS
SELECT rp.marke,
       rp.marke_key,
       rp.zuordnung,
       count(*)::int AS positionen,
       count(DISTINCT rp.rezept_key)::int AS rezepte,
       count(DISTINCT rp.artikelnummer)::int AS artikelnummern,
       round(100.0 * count(*) / sum(count(*)) OVER (PARTITION BY rp.marke_key), 2)
           AS zuordnung_anteil_pct
  FROM mart.rezept_position rp
 GROUP BY rp.marke, rp.marke_key, rp.zuordnung;

COMMENT ON VIEW mart.rezept_zuordnung_pruefung IS
'Je Marke: wie viele Zutatenpositionen eine Artikelnummer tragen, die im Einkauf
derselben Marke vorkommt. zuordnung_anteil_pct ist eine Prozentzahl (23.64, nicht
0.2364) und summiert sich je Marke zu 100. "nummer ohne einkauf" ist die Zahl,
auf die man sieht: Altnummern, andere Lieferanten, Tippfehler.';
COMMENT ON COLUMN mart.rezept_zuordnung_pruefung.zuordnung_anteil_pct IS
'Anteil der Zutatenpositionen der Marke mit dieser Zuordnung, in Prozent (23.64).';


-- ---------------------------------------------------------------------
-- 8. mart.datenstand — zwei Spalten am Ende
--
-- Definition am 15.10.2026 frisch aus der Datenbank gezogen (pg_get_viewdef,
-- Stand nach 0131), nicht aus 0128 abgeschrieben. Die Rezepte gelten je
-- Marke; der Betrieb findet seine Marke ueber core.kostenstelle (gemessen:
-- kein Betrieb mit Kostenstellen in zwei Marken). Beide Zusaetze sind
-- Gleichheitsjoins auf kleinen Tabellen (Kostenstelle mit Index je Betrieb,
-- core.rezept einmal je Marke gruppiert) -- die Laufzeit aus 0128 bleibt.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.datenstand AS
 SELECT b.name AS betrieb,
    b.stadt,
    kz.hauptkonzept AS konzept,
    b.aktiv,
    b.hat_bwa,
    b.lina_betrieb_id IS NOT NULL AS bwa_bruecke,
    u.erster_tag,
    u.letzter_tag,
    u.tage AS umsatztage,
    CURRENT_DATE - u.letzter_tag AS umsatz_alter_tage,
    k.letzter_gebuchter_monat AS bwa_monat,
        CASE
            WHEN k.letzter_gebuchter_monat IS NOT NULL THEN (date_part('year'::text, age(date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date::timestamp with time zone, k.letzter_gebuchter_monat::timestamp with time zone)) * 12::double precision + date_part('month'::text, age(date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date::timestamp with time zone, k.letzter_gebuchter_monat::timestamp with time zone)))::integer
            ELSE NULL::integer
        END AS bwa_verzug_monate,
    COALESCE(a.artikeltage, 0) AS artikeltage,
    a.letzter_artikeltag,
    p.letzter_personaltag,
        CASE
            WHEN bs.status = ANY (ARRAY['geschlossen'::text, 'verwaltend'::text, 'test'::text, 'ohne_geschaeft'::text]) THEN 'kein laufender Betrieb'::text
            WHEN bs.status = 'fremdkasse'::text THEN
            CASE
                WHEN k.letzter_gebuchter_monat IS NULL THEN 'keine BWA gebucht'::text
                ELSE 'fremde Kasse'::text
            END
            WHEN u.letzter_tag IS NULL THEN 'kein Umsatz geladen'::text
            WHEN (CURRENT_DATE - u.letzter_tag) > 8 THEN 'Umsatz veraltet'::text
            WHEN k.letzter_gebuchter_monat IS NULL THEN 'keine BWA gebucht'::text
            WHEN COALESCE(a.artikeltage, 0) = 0 THEN 'keine Artikeldaten'::text
            ELSE 'vollstaendig'::text
        END AS befund,
    b.betrieb_key,
    u.letzter_geladener_tag,
    bs.status,
    COALESCE(rz.rezepte, 0) AS rezepte_marke,
    rz.aeltester_zutatenabruf AS rezepte_zutaten_seit
   FROM core.betrieb b
     LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
     LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = b.betrieb_key
     CROSS JOIN LATERAL ( SELECT ( SELECT t.geschaeftstag
                   FROM core.umsatzbericht_tag t
                  WHERE t.betrieb_key = b.betrieb_key AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL AND t.umsatz_netto > 0::numeric
                  ORDER BY t.geschaeftstag
                 LIMIT 1) AS erster_tag,
            ( SELECT t.geschaeftstag
                   FROM core.umsatzbericht_tag t
                  WHERE t.betrieb_key = b.betrieb_key AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL AND t.umsatz_netto > 0::numeric
                  ORDER BY t.geschaeftstag DESC
                 LIMIT 1) AS letzter_tag,
            ( SELECT count(*)::integer AS count
                   FROM core.umsatzbericht_tag t
                  WHERE t.betrieb_key = b.betrieb_key AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL AND t.umsatz_netto > 0::numeric) AS tage,
            ( SELECT t.geschaeftstag
                   FROM core.umsatzbericht_tag t
                  WHERE t.betrieb_key = b.betrieb_key AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL
                  ORDER BY t.geschaeftstag DESC
                 LIMIT 1) AS letzter_geladener_tag) u
     LEFT JOIN LATERAL ( WITH RECURSIVE kandidat(monat) AS (
                 SELECT max(km.monat) AS max
                   FROM core.kennzahlen_monat km
                  WHERE km.betrieb_key = b.betrieb_key AND km.wert_absolut <> 0::numeric
                UNION ALL
                 SELECT ( SELECT max(km.monat) AS max
                           FROM core.kennzahlen_monat km
                          WHERE km.betrieb_key = b.betrieb_key AND km.wert_absolut <> 0::numeric AND km.monat < kandidat_1.monat) AS max
                   FROM kandidat kandidat_1
                  WHERE kandidat_1.monat IS NOT NULL
                )
         SELECT kandidat.monat AS letzter_gebuchter_monat
           FROM kandidat
          WHERE kandidat.monat IS NOT NULL AND (EXISTS ( SELECT 1
                   FROM ( SELECT DISTINCT ON (km.kennzahl) km.wert_absolut
                           FROM core.kennzahlen_monat km
                          WHERE km.betrieb_key = b.betrieb_key AND km.monat = kandidat.monat AND km.wert_absolut IS NOT NULL
                          ORDER BY km.kennzahl, km.abgerufen_am DESC) juengster
                  WHERE juengster.wert_absolut <> 0::numeric))
         LIMIT 1) k ON true
     LEFT JOIN mart.artikeltage_basis a ON a.betrieb_key = b.betrieb_key
     LEFT JOIN LATERAL ( SELECT max(pk.zeitraum_bis) AS letzter_personaltag
           FROM core.personalkosten pk
          WHERE pk.betrieb_key = b.betrieb_key) p ON true
     LEFT JOIN LATERAL ( SELECT ks.marke_key
           FROM core.kostenstelle ks
          WHERE ks.betrieb_key = b.betrieb_key
          GROUP BY ks.marke_key
          ORDER BY count(*) DESC, ks.marke_key
         LIMIT 1) km ON true
     LEFT JOIN ( SELECT r.marke_key, count(*)::integer AS rezepte, min(r.zutaten_geholt_am) AS aeltester_zutatenabruf
           FROM core.rezept r
          GROUP BY r.marke_key) rz ON rz.marke_key = km.marke_key;

COMMENT ON COLUMN mart.datenstand.rezepte_marke IS
'Rezepte der FoodNotify-Marke dieses Betriebs (Rezepte gelten je Marke, nicht je
Betrieb). 0 = Betrieb ohne FoodNotify-Kostenstelle oder Marke noch ohne Rezepte;
Einzelheiten in mart.rezept_stand.';
COMMENT ON COLUMN mart.datenstand.rezepte_zutaten_seit IS
'Aeltester Zutatenabruf der Marke: die Rezeptinhalte sind mindestens so frisch.
NULL = mindestens ein Rezept der Marke hat noch keine Zutaten (oder keine Rezepte).';


-- ---------------------------------------------------------------------
-- 9. mart.pruefung_uebersicht — zwei Zeilen am Ende
--
-- Die Definition wird beim Anwenden aus der Zieldatenbank gelesen
-- (pg_get_viewdef) und nur ergaenzt — die bestehenden Zeilen bleiben, wie sie
-- dort stehen; neu sind nur die beiden letzten UNION-ALL-Glieder.
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text := pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true);
BEGIN
    -- Die Definition wird NICHT abgeschrieben, sondern aus der laufenden
    -- Datenbank genommen und ergaenzt: 288 Zeilen von Hand nachzuschreiben
    -- hiesse, eine fremde Aenderung der anderen Session still zu ueberschreiben
    -- (docs/fehlerkatalog.md, parallele Sessions).
    v_def := rtrim(v_def, E'; \n');
    EXECUTE 'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS ' || v_def || $zweig$
UNION ALL
 SELECT 'Rezepte: Marke mit FoodNotify-Zulauf, aber ohne frische Rezeptliste oder ohne Zutaten'::text AS pruefung,
    count(*) FILTER (WHERE rs.zustand <> 'kein FoodNotify-Zulauf') AS geprueft,
    count(*) FILTER (WHERE rs.zustand IN ('liste nie geholt', 'liste veraltet', 'keine rezepte', 'zutaten leer')) AS auffaellig,
    'mart.rezept_stand'::text AS sicht
   FROM mart.rezept_stand rs
UNION ALL
 SELECT 'Rezepte: Zutat mit Artikelnummer, die im Einkauf der Marke nie vorkommt'::text AS pruefung,
    count(*) FILTER (WHERE rp.zuordnung IN ('eingekauft', 'nummer ohne einkauf')) AS geprueft,
    count(*) FILTER (WHERE rp.zuordnung = 'nummer ohne einkauf') AS auffaellig,
    'mart.rezept_zuordnung_pruefung'::text AS sicht
   FROM mart.rezept_position rp
$zweig$;
END $aussen$;


-- ---------------------------------------------------------------------
-- 10. MCP-Katalog: Koernung, Thema, Summierbarkeit, Kennzahlen, Fallstricke
--
-- KEINE Kennzahlregel auf menge, einheit oder kosten: mcp.kennzahl gilt im
-- Pruefer fuer den SPALTENNAMEN ueber alle Sichten (die strengste gewinnt,
-- 0117). "menge" ist in mart.artikel_nachlass_monat ausdruecklich summierbar.
-- Die Ebenenfalle steht deshalb als Fallstrick (deutung) und ueber
-- summen_erlaubt = false.
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.rezept_position',
     'Marke × Rezept × Zutatenposition — eine Zeile je Position, wie FoodNotify sie fuehrt',
     'rezept', false),
    ('mart.artikel_in_rezept',
     'Marke × Ware (Lieferanten-Artikelnummer) × Rezept × Weg ueber Halbfabrikate — dieselbe Ware steht je Ebene erneut',
     'rezept', false),
    ('mart.rezept_stand',
     'eine Marke — Ladestand der Rezepte',
     'import', false),
    ('mart.rezept_zuordnung_pruefung',
     'Marke × Zuordnung (eingekauft / nummer ohne einkauf / ohne nummer / unterrezept)',
     'pruefung', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

INSERT INTO mcp.kennzahl (sicht, spalte, regel, einheit, hinweis) VALUES
  ('mart.rezept_zuordnung_pruefung', 'zuordnung_anteil_pct', 'nicht_aggregieren', 'prozentzahl',
   'Anteil je Marke, summiert sich je Marke zu 100. Ueber Marken aus positionen neu rechnen.'),
  ('mart.artikel_in_rezept', 'via_menge', 'nicht_aggregieren', NULL,
   'Menge des Halbfabrikats im Rezept, in via_einheit (Freitext). Nicht ueber Einheiten oder Ebenen summieren.'),
  ('mart.rezept_stand', 'tage_seit_aeltestem_abruf', 'nicht_aggregieren', 'tage', NULL)
ON CONFLICT (sicht, spalte) DO UPDATE
   SET regel = excluded.regel, einheit = excluded.einheit, hinweis = excluded.hinweis;

-- Nur Regelarten, die mcp/src/pruefen.ts kennt (deutung, join_ueber_name) —
-- eine unbekannte liesse den Server nicht starten (AGENTS.md, mcp-Regel 1).
INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle) VALUES
  ('rezept_ebenen_menge', 'deutung', 'warnung', 'mart.artikel_in_rezept', '{}',
   'menge/einheit ist die Menge der Ware im Rezept, in dem sie DIREKT steht (direkt_rezept), '
   'nicht im Rezept der Zeile. Ueber Ebenen wird nicht multipliziert, und Einheiten sind Freitext '
   '("cl", "g", "Limetten 8tel"). Eine Summe ueber menge ohne Filter auf ebene und einheit zaehlt '
   'dieselbe Zutat mehrfach und mischt Einheiten.',
   'Fuer "wie viel steckt direkt drin" auf ebene = 1 filtern und je einheit gruppieren. Indirekte '
   'Verwendung ueber via_rezept und pfad zeigen, nicht verrechnen.',
   '0132'),
  ('rezept_artikelnummer_lieferant', 'deutung', 'warnung', 'mart.rezept_position', '{}',
   'artikelnummer ist die Artikelnummer des LIEFERANTEN (wie im Einkauf), nicht die der Kasse. '
   'Rezepte gelten je Marke, nicht je Betrieb. kosten ist FoodNotifys Wert; Unterrezept-Zeilen '
   'tragen oft 0, die Summe der Zeilen ist deshalb nicht die Rezeptkosten.',
   'Ueber artikelnummer gegen den Einkauf (mart.einkauf_position) verbinden, nie gegen Kassenartikel. '
   'Fuer einen Betrieb die Marke des Betriebs nehmen.',
   '0132'),
  ('rezept_join_ueber_name', 'join_ueber_name', 'warnung', 'mart.artikel_in_rezept',
   '{"spalte": "rezept", "statt": "rezept_key"}',
   'Rezeptnamen sind nicht eindeutig ("Sweet & Sour Mix 20 L" gibt es bei Enchilada mehrfach, '
   'aeltere Fassungen bleiben stehen).',
   'Ueber rezept_key verbinden.',
   '0132')
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


-- ---------------------------------------------------------------------
-- 11. Rechte und die Gegenprobe als Leserolle (Pflicht seit 0110)
-- ---------------------------------------------------------------------

SELECT mcp.rechte_auffrischen();

DO $probe$
DECLARE
    v_sicht  text;
    v_liegen text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0132 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0132 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_sicht IN ARRAY ARRAY[
        'mart.rezept_position', 'mart.artikel_in_rezept', 'mart.rezept_stand',
        'mart.rezept_zuordnung_pruefung', 'mart.datenstand', 'mart.pruefung_uebersicht']
    LOOP
        BEGIN
            EXECUTE format('SELECT * FROM %s LIMIT 1', v_sicht);
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_sicht, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0132 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
