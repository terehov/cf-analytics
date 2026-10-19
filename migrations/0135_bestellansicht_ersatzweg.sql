-- =====================================================================
-- 0135 — Bestellpositionen ueber die Bestellansicht, wenn die Schnittstelle bricht
--
-- ANLASS. Seit dem 31.08.2026 antwortet der Positionsabruf
-- /api/10262/shop-order/{id}/change (Bar Enchilada Augsburg, DISTRA) fuer
-- jede Bestellung mit dem Artikel "Pickled Onions Gelb 3Kg Eimer" (500081)
-- mit HTTP 500 NonUniqueResultException — 14 von 17 Bestellungen, rund
-- 25.000 EUR Bar-Einkauf ohne eine einzige Position. Die Oberflaeche zeigt
-- dieselben Bestellungen vollstaendig. Melden geht nicht, ohne die Nutzung
-- der internen Schnittstelle offenzulegen (Eugene, 19.10.2026). Also liest
-- der Importer in diesem Fall die Seite /shop/{shopId}/orders/{nr}.
-- Hergang und Messung: docs/foodnotify-http500.md, Nachtrag 19.10.2026.
--
-- WAS DIE SEITE HERGIBT UND WAS NICHT. An Bestellung 450 Position fuer
-- Position verglichen: Artikelnummer, Menge, Gebinde und Summe in 53 von 53
-- gleich. Es fehlen der Inhalt je Gebindestueck und die Basiseinheit, also
-- Gesamtmenge und Preis je Kilo/Liter. Der Lader uebernimmt beides aus der
-- juengsten Schnittstellen-Position derselben Marke, Artikelnummer und
-- Gebindegroesse (inhalt_entlehnt); gibt es keine, bleibt die Menge
-- unstimmig — wie bei jeder Position, deren Menge sich nicht belegen laesst.
--
-- DIE SCHNITTSTELLE BLEIBT DER ERSTE WEG. Die Ansicht wird nur eingereiht,
-- wenn der letzte Positionsabruf einer Bestellung mit HTTP 500 endete und
-- die Bestellung keine Schnittstellen-Positionen hat. Kommt die
-- Schnittstelle spaeter doch durch, ersetzt sie die Ansicht-Zeilen (der
-- Lader loescht je Bestellung und schreibt neu).
-- =====================================================================

-- 1. Der Bestellkopf merkt sich, was die Ansicht braucht
ALTER TABLE core.bestellung
    ADD COLUMN IF NOT EXISTS ansicht_nr            text,
    ADD COLUMN IF NOT EXISTS artikel_anzahl        integer,
    ADD COLUMN IF NOT EXISTS ansicht_fingerabdruck text;

COMMENT ON COLUMN core.bestellung.ansicht_nr IS
'Die Bestellnummer der FoodNotify-Oberflaeche (markedShopOrder.orderId), NICHT fn_id: Bestellnummer 451 '
'ist fn_id 638090 und in der Oberflaeche 645599. Dort steht sie als "Bestellung#". Pfad der Ansicht: '
'/shop/{lieferant.fn_id}/orders/{ansicht_nr}.';
COMMENT ON COLUMN core.bestellung.artikel_anzahl IS
'Artikel laut Bestellkopf (markedShopOrder.products). Die Bestellansicht muss genau so viele Zeilen haben, '
'sonst laedt der Lader nichts (0135) — die Seitensumme taugt als Gegenprobe nicht, sie enthaelt Pfand.';
COMMENT ON COLUMN core.bestellung.ansicht_fingerabdruck IS
'Fuer welchen Listenstand (listen_fingerabdruck) die Positionen aus der Bestellansicht stammen. Weicht er ab, '
'wird die Ansicht erneut geholt — dieselbe Logik wie detail_fingerabdruck (0098).';


-- 2. Jede Position sagt, woher sie kommt
ALTER TABLE core.bestellposition
    ADD COLUMN IF NOT EXISTS quelle          text    NOT NULL DEFAULT 'schnittstelle',
    ADD COLUMN IF NOT EXISTS inhalt_entlehnt boolean NOT NULL DEFAULT false;

ALTER TABLE core.bestellposition DROP CONSTRAINT IF EXISTS bestellposition_quelle_check;
ALTER TABLE core.bestellposition ADD CONSTRAINT bestellposition_quelle_check
    CHECK (quelle IN ('schnittstelle', 'ansicht'));

COMMENT ON COLUMN core.bestellposition.quelle IS
'schnittstelle: /change, der normale Weg. ansicht: die HTML-Bestellansicht, nur wenn /change mit HTTP 500 '
'scheitert (0135). Menge, Gebinde, Summe und Artikelnummer sind gleich belastbar; fn_id ist bei ansicht leer.';
COMMENT ON COLUMN core.bestellposition.inhalt_entlehnt IS
'Nur bei quelle = ansicht: Basiseinheit und Inhalt je Gebindestueck stammen aus der juengsten '
'Schnittstellen-Position derselben Marke, Artikelnummer und Gebindegroesse — die Ansicht nennt sie nicht. '
'false bei ansicht heisst: kein Vorbild gefunden, Gesamtmenge leer, menge_unstimmig.';


-- 3. Ein Positionsabruf, den die Ansicht ersetzt hat, ist kein offener Fehler
ALTER TABLE sync.warteschlange DROP CONSTRAINT IF EXISTS warteschlange_ergebnis_check;
ALTER TABLE sync.warteschlange ADD CONSTRAINT warteschlange_ergebnis_check
    CHECK (ergebnis IN ('ok', 'keine_daten', 'aufgegeben', 'kein_zugriff',
                        'fenster_zu_gross', 'abgeschaltet', 'nicht_gefunden', 'ersatzweg'));

COMMENT ON CONSTRAINT warteschlange_ergebnis_check ON sync.warteschlange IS
'ersatzweg (0135): der Posten ist gescheitert, aber seine Daten kamen ueber einen anderen Weg '
'(fn:bestellpositionen → fn:bestellansicht). Nicht wiederbelebt, nicht in mart.posten_aufgegeben; '
'zu sehen in mart.bestellansicht_stand.';


-- 4. Wie viel ueber den Ersatzweg kommt (Regel 10)
CREATE OR REPLACE VIEW mart.bestellansicht_stand AS
WITH pos AS (
    SELECT p.bestellung_key,
           count(*) FILTER (WHERE p.quelle = 'ansicht')                        AS ansicht,
           count(*) FILTER (WHERE p.quelle = 'ansicht' AND p.inhalt_entlehnt)  AS entlehnt,
           count(*) FILTER (WHERE p.quelle = 'schnittstelle')                  AS schnittstelle,
           sum(p.summe_preis) FILTER (WHERE p.quelle = 'ansicht')              AS summe_ansicht
      FROM core.bestellposition p
     GROUP BY 1
), fehlschlag AS (
    -- Bestellungen, deren letzter Positionsabruf mit HTTP 500 endete
    SELECT DISTINCT w.marke_key, w.parameter->>'erpId' AS erp_id, w.parameter->>'orderId' AS order_id
      FROM sync.warteschlange w
     WHERE w.endpunkt = 'fn:bestellpositionen'
       AND w.letzter_fehler LIKE 'HTTP 500%'
       AND coalesce(w.ergebnis, '') <> 'ok'
)
SELECT m.schluessel                                                   AS marke,
       ks.name                                                        AS kostenstelle,
       count(*)                                                       AS bestellungen_mit_500,
       count(*) FILTER (WHERE coalesce(p.ansicht, 0) > 0)             AS ueber_ansicht_geladen,
       count(*) FILTER (WHERE coalesce(p.schnittstelle, 0) > 0)       AS mit_aelteren_schnittstellen_positionen,
       count(*) FILTER (WHERE coalesce(p.ansicht, 0) = 0
                          AND coalesce(p.schnittstelle, 0) = 0)       AS ohne_positionen,
       count(*) FILTER (WHERE b.ansicht_nr IS NULL)                   AS ohne_ansicht_nr,
       coalesce(sum(p.ansicht), 0)::int                               AS positionen_ansicht,
       coalesce(sum(p.entlehnt), 0)::int                              AS davon_inhalt_entlehnt,
       round(coalesce(sum(p.summe_ansicht), 0), 2)                    AS summe_ansicht,
       min(b.bestellt_am)::date                                       AS erste_bestellung,
       max(b.bestellt_am)::date                                       AS letzte_bestellung
  FROM fehlschlag f
  JOIN core.kostenstelle ks ON ks.marke_key = f.marke_key AND ks.erp_id::text = f.erp_id
  JOIN core.marke m         ON m.marke_key = ks.marke_key
  JOIN core.bestellung b    ON b.kostenstelle_key = ks.kostenstelle_key AND b.fn_id = f.order_id
  LEFT JOIN pos p           ON p.bestellung_key = b.bestellung_key
 GROUP BY 1, 2
 ORDER BY 3 DESC;

COMMENT ON VIEW mart.bestellansicht_stand IS
'Je Kostenstelle: Bestellungen, deren Positionsabruf mit HTTP 500 scheitert, und wie viele davon ueber die '
'Bestellansicht geladen sind (0135). ERWARTUNG: ohne_positionen = 0 nach einer Nacht. ohne_ansicht_nr > 0 '
'heisst: der Bestellkopf ist noch nicht neu geholt — der Nachtlauf reiht ihn selbst ein. '
'mit_aelteren_schnittstellen_positionen: frueher geladen, nur der Nachabruf scheitert — bleibt so.';
