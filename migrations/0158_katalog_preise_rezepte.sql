-- =====================================================================
-- 0158 MCP-Katalog zu 0155–0157 nachgeschaerft
--
-- ANLASS (19.11.2026, Auftrag Eugene "MCP und die ganzen Karten bauen").
-- Die drei Migrationen sind committet, aber nirgends angewendet; Korrekturen
-- trotzdem nur hier, damit lokale Klone anderer nicht auseinanderlaufen.
-- Beim Bau der Karten (metabase/karten-einkaufspreis.ts, karten-rezept.ts)
-- und der Fallenfragen (mcp/test/fallen_preise_rezepte.test.ts) fiel auf,
-- was der Katalog nicht abfaengt:
--
--   1. ARTIKELZAHLEN JE ANBINDUNG ODER BETRIEB SUMMIEREN. Bar und Kueche
--      eines Betriebs fuehren viele Kassenartikel doppelt (0155). Eine
--      Summe von artikel_mit_rezept ueber die Anbindungen eines Betriebs
--      zaehlt diese Artikel zweimal; ueber Betriebe zaehlt sie denselben
--      LINA-Artikel je Betrieb. Bisher lief das mit einer allgemeinen
--      Warnung durch (summe_ungeprueft), und der Hinweis an
--      rezept_anteil_pct empfahl sogar, den Anteil "ueber Anbindungen aus
--      artikel_mit_rezept und artikel_gesamt neu" zu rechnen — genau diese
--      Summe. Jetzt: nicht_aggregieren, mit dem Weg ueber
--      mart.pos_artikel_rezept.
--
--   2. QUANTILE DER LIEFERKONDITIONEN MITTELN. bestellwert_*_netto und
--      vorlauf_*_tage sind Minimum, 5-%-Quantil, Median und Modus je
--      Kostenstelle und Lieferant (0156). avg(bestellwert_median_netto)
--      ueber Betriebe ist keine Zahl, die irgendwer gemessen hat.
--
--   3. ZEILEN MIT UNTER ZEHN BESTELLUNGEN. Der Fallstrick aus 0156 warnt
--      bei jeder Abfrage gleich ("beobachtet, nicht vereinbart"); dass
--      belastbar = false dabei ist, sah er nicht. Jetzt eine eigene Warnung,
--      solange nicht auf belastbar gefiltert wird.
--
--   4. PREISAENDERUNGEN OHNE preisart ZAEHLEN. Eine Aenderung von Listen-
--      UND Katalogpreis steht zweimal in mart.listenpreis_aenderung (0157).
--      Der Kommentar sagte "immer nach preisart filtern", der Katalog nicht.
--
--   5. "-100 %" BEI PREIS 0. Ein Wechsel auf 0 ist kein Preis, sondern "kein
--      preis mehr" (0157); aenderung_pct ist dann NULL. Wer selbst
--      (preis_neu - preis_alt) / preis_alt rechnet, bekommt -100 % und eine
--      Ware, die "gratis" wurde. Warnung, solange nicht auf vergleichbar
--      gefiltert wird.
--
--   6. DIE LISTENPREISAENDERUNG ALS BEZAHLTE TEUERUNG LESEN. Der Fallstrick
--      listenpreis_ist_nicht_bezahlt haengt an mart.listenpreis_aktuell; wer
--      mart.listenpreis_aenderung fragt, bekam nur "die Reihe beginnt spaet".
--      Der Hinweis dort nennt jetzt auch die Preisbasis.
--
--   7. DIE ZWISCHENSTUFE mart.einkaufspreis_artikel_monat_basis fuehrt weder
--      verdaechtig noch veraenderung_pct noch die Namen. Wer daraus
--      Teuerung rechnet, umgeht die Gebindepruefung aus 0062.
--
-- Nur Regelarten, die mcp/src/pruefen.ts kennt (filter_noetig, deutung) —
-- eine unbekannte liesse den Server nicht starten (AGENTS.md, mcp-Regel 1).
-- Keine neue Sicht, keine neue Tabelle, deshalb kein Rechteblock.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1./2. Kennzahlen
--
-- mcp.kennzahl gilt im Pruefer je SPALTENNAME ueber alle Sichten (die
-- strengere Regel gewinnt, mcp/src/katalog.ts). Nachgesehen am 19.11.2026:
-- keine andere Sicht fuehrt eine dieser Spalten.
-- ---------------------------------------------------------------------

INSERT INTO mcp.kennzahl (sicht, spalte, regel, einheit, hinweis) VALUES
  ('mart.pos_artikel_abdeckung', 'artikel_gesamt', 'nicht_aggregieren', 'anzahl',
   'Kassenartikel je Anbindung. Bar und Kueche eines Betriebs fuehren viele Artikel doppelt — eine Summe '
   'zaehlt sie zweimal. Fuer einen Betrieb count(DISTINCT artikel_key) in mart.pos_artikel_rezept '
   '(fehlt_seit IS NULL).'),
  ('mart.pos_artikel_abdeckung', 'artikel_mit_rezept', 'nicht_aggregieren', 'anzahl',
   'Je Anbindung, wie artikel_gesamt. Fuer einen Betrieb count(DISTINCT artikel_key) FILTER (WHERE hat_rezept) '
   'in mart.pos_artikel_rezept; fuer den Umsatzanteil mart.pos_artikel_abdeckung_betrieb.'),
  ('mart.pos_artikel_abdeckung', 'rezept_anteil_pct', 'nicht_aggregieren', 'prozentzahl',
   'Anteil je Anbindung, nicht mitteln und nicht aus Anbindungssummen neu rechnen (Artikel stehen in Bar und '
   'Kueche doppelt). Fuer einen Betrieb aus mart.pos_artikel_rezept zaehlen.'),
  ('mart.pos_artikel_abdeckung_betrieb', 'artikel_verkauft', 'nicht_aggregieren', 'anzahl',
   'Verschiedene LINA-Artikel je Betrieb; ueber Betriebe summiert zaehlt derselbe Artikel je Betrieb einmal.'),
  ('mart.pos_artikel_abdeckung_betrieb', 'artikel_verkauft_mit_rezept', 'nicht_aggregieren', 'anzahl',
   'Wie artikel_verkauft. Fuer mehrere Betriebe die Euro-Summen nehmen (umsatz_mit_rezept_3m / umsatz_netto_3m).'),
  ('mart.lieferkondition_beobachtet', 'bestellwert_min_netto', 'nicht_aggregieren', 'euro',
   'Kleinster beobachteter Bestellwert je Kostenstelle und Lieferant — nicht der Mindestbestellwert, nicht mitteln.'),
  ('mart.lieferkondition_beobachtet', 'bestellwert_p05_netto', 'nicht_aggregieren', 'euro',
   '5-%-Quantil je Kostenstelle und Lieferant — nicht der Mindestbestellwert, ein Quantil laesst sich nicht mitteln.'),
  ('mart.lieferkondition_beobachtet', 'bestellwert_median_netto', 'nicht_aggregieren', 'euro',
   'Median je Kostenstelle und Lieferant. Ueber Betriebe nicht mitteln; je Zeile nennen.'),
  ('mart.lieferkondition_beobachtet', 'vorlauf_min_tage', 'nicht_aggregieren', 'tage',
   'Kuerzester beobachteter Vorlauf — keine Bestellfrist, nicht mitteln.'),
  ('mart.lieferkondition_beobachtet', 'vorlauf_median_tage', 'nicht_aggregieren', 'tage',
   'Median je Kostenstelle und Lieferant, nicht mitteln.'),
  ('mart.lieferkondition_beobachtet', 'vorlauf_typisch_tage', 'nicht_aggregieren', 'tage',
   'Haeufigster Vorlauf je Kostenstelle und Lieferant, nicht mitteln.')
ON CONFLICT (sicht, spalte) DO UPDATE
   SET regel = excluded.regel, einheit = excluded.einheit, hinweis = excluded.hinweis;

COMMENT ON COLUMN mart.pos_artikel_abdeckung.rezept_anteil_pct IS
'Artikel mit Rezept (nicht ignoriert) / Artikel der letzten Antwort, Prozentzahl (49.4, nicht 0.494), JE ANBINDUNG.
Nicht mitteln und nicht aus Summen ueber Anbindungen neu rechnen: Bar und Kueche eines Betriebs fuehren viele
Artikel doppelt. Fuer einen Betrieb aus mart.pos_artikel_rezept zaehlen (count DISTINCT artikel_key), fuer den
Umsatzanteil mart.pos_artikel_abdeckung_betrieb. (Bis 0158 empfahl dieser Kommentar die Summe ueber Anbindungen.)';
COMMENT ON COLUMN mart.pos_artikel_abdeckung.artikel_gesamt IS
'Kassenartikel der letzten Antwort dieser Anbindung (fehlt_seit IS NULL). Nicht ueber Anbindungen summieren —
Bar und Kueche fuehren viele Artikel doppelt.';
COMMENT ON COLUMN mart.pos_artikel_abdeckung.artikel_mit_rezept IS
'Davon mit Rezept (zugeordnet und nicht ignoriert). Nicht ueber Anbindungen summieren.';


-- ---------------------------------------------------------------------
-- 3.–7. Fallstricke
-- ---------------------------------------------------------------------

INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle) VALUES
  ('lieferkondition_nur_belastbar', 'filter_noetig', 'warnung', 'mart.lieferkondition_beobachtet',
   '{"spalte": "belastbar", "wert": true}',
   'Ohne belastbar = true stehen Paare aus Kostenstelle und Lieferant mit weniger als zehn Bestellungen in zwoelf '
   'Monaten dabei. Ihre Liefertage, Vorlaeufe und Bestellwerte beruhen auf ein paar Bestellungen — ein Zufall sieht '
   'dort aus wie ein Tourenplan.',
   'WHERE belastbar setzen, oder die duennen Zeilen ausdruecklich als Anhaltspunkt kennzeichnen und bestellungen '
   'mitnennen.',
   '0158'),
  ('listenpreis_aenderung_preisart', 'filter_noetig', 'warnung', 'mart.listenpreis_aenderung',
   '{"spalte": "preisart"}',
   'mart.listenpreis_aenderung fuehrt zwei Preisarten: listenpreis (Warenstamm, folgt der letzten Bestellung) und '
   'katalogpreis (Lieferantenkatalog). Aendern sich beide, steht die Ware zweimal da; eine Zaehlung oder ein '
   'Mittel ueber beide zaehlt doppelt und mischt zwei Bedeutungen.',
   'Auf preisart = ''listenpreis'' oder ''katalogpreis'' filtern, oder nach preisart gruppieren und beide Zahlen '
   'getrennt nennen.',
   '0158'),
  ('listenpreis_aenderung_vergleichbar', 'filter_noetig', 'warnung', 'mart.listenpreis_aenderung',
   '{"spalte": "vergleichbar", "wert": true}',
   'Nur vergleichbar = true ist eine reine Preisaenderung. Ein Wechsel auf oder von 0 heisst "kein preis mehr" bzw. '
   '"preis neu" (Ware faellt aus dem Katalog oder kommt hinein) und hat kein aenderung_pct — wer selbst '
   '(preis_neu - preis_alt) / preis_alt rechnet, bekommt -100 % und eine Ware, die scheinbar gratis wurde. Aendern '
   'sich Einheit, Inhalt, Gebinde, Artikelnummer oder Lieferant mit (auch_geaendert), vergleicht der Prozentwert '
   'Ungleiches.',
   'WHERE vergleichbar setzen und aenderung_pct aus der Sicht nehmen; Wechsel auf oder von 0 als '
   '"kein Preis mehr" / "Preis neu" nennen, nie als Senkung um 100 %.',
   '0158'),
  ('einkaufspreis_artikel_basis_zwischenstufe', 'deutung', 'warnung', 'mart.einkaufspreis_artikel_monat_basis', '{}',
   'mart.einkaufspreis_artikel_monat_basis ist die materialisierte Zwischenstufe: ohne Marken- und Lieferantennamen, '
   'ohne veraenderung_pct und ohne verdaechtig. Wer daraus eine Teuerung rechnet, zaehlt Gebinde- und '
   'Einheitenwechsel als Preisaenderung.',
   'mart.einkaufspreis_artikel_monat nehmen — dieselben Zeilen, mit Namen, Vergleich und Gebindekennzeichen.',
   '0158')
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

-- 6. Der Hinweis an mart.listenpreis_aenderung nennt jetzt auch die Preisbasis.
UPDATE mcp.fallstrick
   SET hinweis =
       'Die Listenpreis-Reihe beginnt mit dem ersten Abzug des Warenstamms (0157); FoodNotify fuehrt keine '
       'Preishistorie. Vor diesem Tag gibt es keine Aenderungen, auch wenn es welche gab. Der Tag einer Aenderung ist '
       'der Tag, an dem wir sie sahen. Beide Preisarten gelten je kg/l und sind KEINE bezahlten Preise: eine '
       'Listenpreisaenderung heisst meist "es wurde zu einem neuen Preis bestellt", eine Katalogpreisaenderung '
       '"der Lieferant hat den Katalog geaendert".',
       berichtigung =
       'Bei Fragen vor reihe_ab (mart.warenstamm_stand) und fuer bezahlte Teuerung auf '
       'mart.einkaufspreis_artikel_monat ausweichen; Aenderungen nur mit vergleichbar = true und immer je preisart '
       '(listenpreis oder katalogpreis) zaehlen.',
       quelle = '0157, 0158'
 WHERE schluessel = 'listenpreis_reihe_beginnt_spaet';


-- ---------------------------------------------------------------------
-- Waechter: alles angekommen? Eine Migration, die still weniger eintraegt,
-- als sie behauptet, waere genau der Ausfall, gegen den dieser Katalog steht.
-- ---------------------------------------------------------------------

DO $$
DECLARE
    v_kz int;
    v_fs int;
BEGIN
    SELECT count(*) INTO v_kz FROM mcp.kennzahl
     WHERE (sicht, spalte) IN (('mart.pos_artikel_abdeckung', 'artikel_gesamt'),
                               ('mart.pos_artikel_abdeckung', 'artikel_mit_rezept'),
                               ('mart.pos_artikel_abdeckung_betrieb', 'artikel_verkauft'),
                               ('mart.pos_artikel_abdeckung_betrieb', 'artikel_verkauft_mit_rezept'),
                               ('mart.lieferkondition_beobachtet', 'bestellwert_min_netto'),
                               ('mart.lieferkondition_beobachtet', 'bestellwert_p05_netto'),
                               ('mart.lieferkondition_beobachtet', 'bestellwert_median_netto'),
                               ('mart.lieferkondition_beobachtet', 'vorlauf_min_tage'),
                               ('mart.lieferkondition_beobachtet', 'vorlauf_median_tage'),
                               ('mart.lieferkondition_beobachtet', 'vorlauf_typisch_tage'));
    SELECT count(*) INTO v_fs FROM mcp.fallstrick
     WHERE aktiv AND schluessel IN ('lieferkondition_nur_belastbar', 'listenpreis_aenderung_preisart',
                                    'listenpreis_aenderung_vergleichbar', 'einkaufspreis_artikel_basis_zwischenstufe');
    IF v_kz <> 10 OR v_fs <> 4 THEN
        RAISE EXCEPTION '0158: % von 10 Kennzahlen und % von 4 Fallstricken eingetragen', v_kz, v_fs;
    END IF;
    IF EXISTS (SELECT 1 FROM mcp.kennzahl WHERE sicht = 'mart.pos_artikel_abdeckung'
                AND spalte = 'rezept_anteil_pct' AND hinweis ILIKE '%aus artikel_mit_rezept und artikel_gesamt neu%') THEN
        RAISE EXCEPTION '0158: der Hinweis an rezept_anteil_pct empfiehlt noch die Summe ueber Anbindungen';
    END IF;
END $$;
