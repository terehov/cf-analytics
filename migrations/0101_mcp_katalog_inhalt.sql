-- =====================================================================
-- Inhalt des semantischen Katalogs: Achsen, Koernung, Kennzahlregeln,
-- Fallstricke.  Plan: docs/plan-skybridge.md, Abschnitt 5.
--
-- Getrennt von 0100, weil das eine das Geruest ist und das andere Pflege:
-- diese Datei waechst mit jeder neuen Sicht und jedem neuen Befund weiter,
-- die Tabellen darunter nicht.
--
-- DIE KOERNUNG IST HANDARBEIT UND BLEIBT ES. Was hier fehlt, steht in
-- mcp.koernung_fehlend und wird zur Laufzeit als Warnung gemeldet — eine
-- Luecke, die sich zeigt, ist besser als eine geratene Angabe, die sich
-- nicht zeigt (harte Regel 10).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Die Achsen
--
-- Mit `ziel_sicht` sind es die beiden, die metabase/beziehungen.ts schon
-- als Fremdschluessel verdrahtet — jetzt von hier gelesen statt aus einer
-- Konstante im Skript.
--
-- ABSICHTLICH OHNE ZIEL, obwohl es verlockend waere: artikel_key,
-- bestellung_key und bestellposition_key. Es gibt keine Dimensionssicht
-- mart.artikel bzw. mart.bestellung; ein Verweis dorthin waere ein Sprung
-- ins Leere. Wenn diese Sichten gebraucht werden, ist das eine Migration,
-- keine Katalogfrage (dieselbe Begruendung wie in beziehungen.ts).
-- ---------------------------------------------------------------------
INSERT INTO mcp.achse (achse, bezeichnung, art, ziel_sicht, ziel_spalte, anzeige_spalte, hinweis) VALUES
  ('betrieb_key', 'Betrieb', 'schluessel', 'mart.betrieb', 'betrieb_key', 'betrieb',
   'Die einzige belastbare Verbindung zwischen Sichten auf Betriebsebene. NIE ueber den '
   'Namen verbinden: fuenf Betriebe heissen "Karlsruhe" (datenmodell.md, Markenebene).'),
  ('aktion_key', 'Marketingaktion', 'schluessel', 'mart.aktion', 'aktion_key', 'aktion', NULL),
  ('monat', 'Monat', 'zeit', NULL, NULL, NULL,
   'Immer der Monatserste als date. Der BWA-Monat ist JE BETRIEB ein anderer — wer Umsatz '
   'und BWA nebeneinanderstellt, liest bwa_monat mit (datenmodell.md, Entscheidung 6).'),
  ('geschaeftstag', 'Geschaeftstag', 'zeit', NULL, NULL, NULL,
   'Der Geschaeftstag laeuft 08:00-07:59 Europe/Berlin, nicht Mitternacht bis Mitternacht '
   '(core.business_date()). Nicht mit dem Kalendertag verwechseln.'),
  ('konzept', 'Marke (Konzept)', 'merkmal', NULL, NULL, NULL,
   'In LINA heissen die Marken Konzepte. Faktisch 1:n — 131 Betriebe, keiner in mehreren '
   'Gruppen (nachgemessen 26.07.2026). Mehrdeutige laufen als "(nicht zugeordnet)" mit.'),
  ('hauptkonzept', 'Hauptmarke', 'merkmal', NULL, NULL, NULL,
   'Die 1:1-Aufloesung von konzept. Wo sie leer ist, fehlt eine Entscheidung — siehe '
   'mart.konzept_zuordnung.'),
  ('marke', 'Marke (FoodNotify-Mandant)', 'merkmal', NULL, NULL, NULL,
   'Der FoodNotify-Mandant, NICHT dasselbe wie konzept. Einkauf haengt hier, Umsatz an konzept.'),
  ('kostenstelle', 'Kostenstelle (FoodNotify)', 'merkmal', NULL, NULL, NULL,
   'Die FoodNotify-Achse. Die Marke ergibt sich ueber kostenstelle.marke_key, nicht ueber '
   'eine zweite Mandantenspalte (datenmodell.md, FoodNotify).'),
  ('bundesland', 'Bundesland', 'merkmal', NULL, NULL, NULL,
   'Haengt an der PLZ aus manual.betrieb_standort — gepflegt fuer 60 von 141 Betrieben. '
   'Wer danach gruppiert, sieht nur diese 60. Die Luecke steht in mart.kalender_fehlend.'),
  ('ort', 'Ort', 'merkmal', NULL, NULL, NULL,
   'Die EINZIGE belastbare Stadtangabe, gespeist aus manual.betrieb_standort. Die Spalte '
   '"stadt" ist etwas anderes und ueberall NULL.'),
  ('lieferant', 'Lieferant', 'merkmal', NULL, NULL, NULL, NULL),
  ('kreditor', 'Kreditor', 'merkmal', NULL, NULL, NULL, NULL),
  ('ware', 'Ware', 'merkmal', NULL, NULL, NULL,
   'FoodNotify-Rohware, NICHT core.artikel (was verkauft wird). Ueber den NAMEN gruppieren, '
   'nicht ueber die Waren-ID: dieselbe Ware wird unter mehreren IDs gefuehrt (866 Saetze, '
   '428 Namen — fehlerkatalog.md).'),
  ('warengruppe', 'Warengruppe', 'merkmal', NULL, NULL, NULL, NULL),
  ('hauptsparte', 'Hauptsparte', 'merkmal', NULL, NULL, NULL,
   'Speisen/Getraenke. Im LINA-Umsatzbericht stehen Gesamt- UND Hauptspartenzeilen in '
   'derselben Tabelle — in mart ist das getrennt, in core nicht.'),
  ('bereich', 'Bereich', 'merkmal', NULL, NULL, NULL,
   'Die sechs Round-Table-Bereiche (Umsatz, Personal, WE Bar, WE Kueche, Bewertung, OM).'),
  ('artikel_key', 'Artikel (POS)', 'schluessel', NULL, NULL, NULL,
   'Was verkauft wird — die Position auf dem Bon. Nicht core.ware (was eingekauft wird).'),
  ('endpunkt', 'API-Endpunkt', 'merkmal', NULL, NULL, NULL, NULL),
  ('mitarbeiter_id', 'Mitarbeiter (Bounti)', 'schluessel', NULL, NULL, NULL,
   'Menschen koennen an mehreren Standorten haengen und zaehlen dann in jedem Betrieb mit '
   '(mart.bounti_mehrfachzuordnung).')
ON CONFLICT (achse) DO UPDATE
   SET bezeichnung = excluded.bezeichnung, art = excluded.art,
       ziel_sicht = excluded.ziel_sicht, ziel_spalte = excluded.ziel_spalte,
       anzeige_spalte = excluded.anzeige_spalte, hinweis = excluded.hinweis;

-- Sichten aufnehmen und Achsen ableiten, damit die Koernung unten auf
-- vorhandene Zeilen trifft.
SELECT mcp.achsen_ableiten();

-- ---------------------------------------------------------------------
-- 2. Koernung, Thema, Summierbarkeit
--
-- `summen_erlaubt = false` heisst: eine Summe ueber die Kennzahlen dieser
-- Sicht ist falsch — weil es Prozentwerte oder Mediane sind, oder weil eine
-- Achse im GROUP BY fehlen wuerde und doppelt gezaehlt wird.
--
-- Eingefuegt statt aktualisiert: eine Sicht, die es in dieser Datenbank
-- (noch) nicht gibt, soll ihre gepflegte Koernung trotzdem behalten.
-- achsen_ableiten() markiert sie danach als entfallen.
-- ---------------------------------------------------------------------
INSERT INTO mcp.sicht (sicht, koernung, thema, summen_erlaubt) VALUES
  -- Round Table und Ampeln -------------------------------------------
  ('mart.round_table_monat',      'Betrieb und Monat, fertig bewertet mit dem Standardregelwerk', 'round_table', false),
  ('mart.round_table_basis',      'aktivem Betrieb und Monat, ohne Ampelbewertung', 'round_table', false),
  ('mart.round_table_trend',      'Betrieb, Bereich und Monat, mit den beiden Vormonaten daneben', 'round_table', false),
  ('mart.round_table_unvollstaendig', 'Betrieb und Monat, dem mindestens eine Ampel fehlt', 'round_table', false),
  ('mart.round_table_gesamt_wechsel', 'Betrieb und Monat, in dem die Gesamtampel gewechselt hat', 'round_table', false),
  ('mart.ampel_bereich',          'Betrieb, Monat und Bereich — die sechs Ampeln im Langformat', 'round_table', false),
  ('mart.konzept_schnitt_monat',  'Marke und Monat; die Prozentwerte sind MEDIANE, die Ampeln gezaehlt', 'round_table', false),
  ('mart.stadt_schnitt_monat',    'Ort und Monat, nur Orte mit mehr als einem laufenden Betrieb', 'round_table', false),
  ('mart.marke_vergleich',        'Betrieb, Monat und Kennzahl, mit Markenmedian, Abstand und Rang', 'round_table', false),
  ('mart.stadt_vergleich',        'Betrieb, Monat und Kennzahl, gemessen an den Nachbarbetrieben am Ort', 'round_table', false),
  ('mart.ursachen_analyse',       'Monat und Ursache, aufgeschluesselt nach Bereich', 'round_table', false),
  ('mart.massnahme',              'Massnahme', 'round_table', false),
  ('mart.regelwerk',              'Ampelregelwerk — die Auswahlliste fuer den Dropdown', 'stammdaten', false),

  -- Umsatz ------------------------------------------------------------
  ('mart.umsatz_tag',             'Betrieb und Geschaeftstag — diese Sicht darf man bedenkenlos summieren', 'umsatz', true),
  ('mart.umsatz_tag_sparte',      'Betrieb, Geschaeftstag, Hauptsparte und Verkaufsstelle', 'umsatz', true),
  ('mart.umsatz_stunde',          'Betrieb, Geschaeftstag und Stunde', 'umsatz', true),
  ('mart.umsatz_zeitzone',        'Betrieb, Geschaeftstag und vordefinierter Zeitzone aus LINA', 'umsatz', true),
  ('mart.umsatz_zeitfenster',     'Betrieb, Geschaeftstag und Zeitfenster aus manual.zeitfenster', 'umsatz', true),
  ('mart.umsatz_ytd',             'Betrieb und Monat, mit Vorjahr und kumulierten Werten daneben', 'umsatz', false),
  ('mart.umsatz_je_sitzplatz',    'Betrieb und Monat, bezogen auf die Sitzplaetze aus der Ladenakte', 'umsatz', false),
  ('mart.umsatz_lochtag',         'Betrieb und fehlendem Geschaeftstag — eine Luecke, kein Umsatz', 'pruefung', false),
  ('mart.artikelverkauf',         'Betrieb, Geschaeftstag und Artikel, mit dem Wareneinsatzansatz DES TAGES', 'umsatz', true),
  ('mart.artikel_monat',          'Betrieb, Monat und Artikel', 'umsatz', true),
  ('mart.deckungsbeitrag_warengruppe', 'Betrieb, Monat und Warengruppe', 'umsatz', true),
  ('mart.deckungsbeitrag_stand',  'materialisierter Deckungsbeitragssicht: wie alt ihre Zahlen sind', 'betrieb', false),
  ('mart.aktion',                 'Marketingaktion, mit hinterlegter und tatsaechlicher Laufzeit', 'aktion', false),
  ('mart.aktionsumsatz',          'Betrieb, Geschaeftstag und Aktion', 'aktion', true),
  ('mart.aktionsumsatz_monat',    'Betrieb, Monat und Aktion, mit Anteil am Gesamtumsatz', 'aktion', false),
  ('mart.tagesbudget',            'Betrieb und Geschaeftstag, Budget gegen Ist', 'umsatz', false),
  ('mart.vergleichstag',          'Betrieb und Geschaeftstag, gegen seine vier Vorgaenger gerechnet', 'kalender', false),
  ('mart.vergleichstag_basis',    'Betrieb und Geschaeftstag — die materialisierte Grundlage', 'kalender', false),

  -- Personal und BWA ---------------------------------------------------
  ('mart.personalkosten',         'Betrieb und Abrechnungszeitraum (TAGESzeilen) — die Quoten haben den '
                                  'Tagesumsatz im Nenner und sind nur als Median und mit Plausibilitaetsfilter zu gebrauchen', 'personal', false),
  ('mart.kennzahlen_aktuell',     'Betrieb, Monat und BWA-Kennzahl, im juengsten abgerufenen Stand', 'bwa', false),
  ('mart.bwa_kennzahl',           'BWA-Kennzahl — die Stammliste', 'bwa', false),
  ('mart.bwa_longterm',           'Betrieb, Monat und BWA-Zeile aus der Langzeitreihe seit 2009', 'bwa', false),
  ('mart.bwa_longterm_stand',     'Betrieb: wie weit die Langzeitreihe reicht', 'bwa', false),
  ('mart.bwa_plan_ist',           'Betrieb, Monat und BWA-Zeile, Plan gegen Ist', 'bwa', false),
  ('mart.bwa_rueckstand',         'Betrieb — "nie gebucht" ist kein Rueckstand', 'bwa', false),
  ('mart.bwa_rueckbuchung',       'Abstand in Monaten zwischen Buchung und Berichtsmonat', 'bwa', false),
  ('mart.bwa_pruefung',           'Pruefzeile zur BWA', 'pruefung', false),
  ('mart.bwa_quellen_vergleich',  'Betrieb, Monat und Kennzahl, BWA-Quellen gegeneinander', 'bwa', false),
  ('mart.bwa_prozent_unplausibel','Betrieb, Monat und Kennzahl mit unplausiblem Prozentwert', 'pruefung', false),
  ('mart.bwa_zeile_ungepflegt',   'BWA-Zeile ohne Pflege', 'bwa', false),
  ('mart.sachkonto_monat',        'Betrieb, Monat und Sachkonto', 'bwa', true),
  ('mart.sachkonto_fehlend',      'Sachkonto ohne Zuordnung', 'bwa', false),
  ('mart.wareneinsatz_beleg_monat','Betrieb und Monat, Wareneinsatz aus Belegen', 'bwa', true),
  ('mart.wareneinsatz_quellen',   'Betrieb und Monat, die Wareneinsatzquellen nebeneinander', 'bwa', false),
  ('mart.buchungsbeleg',          'Buchungsbeleg', 'beleg', false),
  ('mart.buchungsbeleg_monat',    'Betrieb, Monat und Belegtyp', 'beleg', true),
  ('mart.buchungsbeleg_konto',    'Buchungsbeleg mit gefuelltem Sachkonto', 'beleg', false),
  ('mart.buchungsbeleg_zusatzfelder','Zusatzfeld der Buchungsbelege', 'beleg', false),

  -- Einkauf ------------------------------------------------------------
  ('mart.einkauf_beleg',          'Bestellung (Belegkopf), nicht je Position; storniert kennzeichnet statt auszublenden', 'einkauf', true),
  ('mart.einkauf_position',       'Bestellposition', 'einkauf', true),
  ('mart.einkauf_betrieb_monat',  'Betrieb und Monat', 'einkauf', true),
  ('mart.einkauf_kreditor_monat', 'Betrieb, Monat und Kreditor', 'einkauf', true),
  ('mart.einkauf_ladestand',      'Marke: wie weit der Bestellimport gekommen ist', 'einkauf', false),
  ('mart.einkauf_pruefung',       'Pruefzeile zum Einkauf', 'pruefung', false),
  ('mart.einkaufspreis_monat',    'Ware, Marke, Einheit und Monat — echte Belegpreise aus FoodNotify', 'einkauf', false),
  ('mart.einkaufspreis_betrieb',  'Betrieb, Ware und Monat; NUR mit vergleichbar = true lesen', 'einkauf', false),
  ('mart.einkaufspreis_veraenderung','Ware, Marke und Monat, mit dem Vormonatsvergleich', 'einkauf', false),
  ('mart.preisentwicklung_ware',  'Ware und Monat — abgeloest durch mart.einkaufspreis_monat', 'einkauf', false),
  ('mart.fremdeinkauf',           'Betrieb, Monat, Lieferant UND Quelle — ohne Filter auf genau eine Quelle wird doppelt gezaehlt', 'einkauf', true),
  ('mart.lieferant_freigabe_stand','Lieferant — die Arbeitsliste der Einordnung', 'einkauf', false),
  ('mart.kreditor_betrieb_monat', 'Betrieb, Monat und Kreditor', 'einkauf', true),
  ('mart.kreditor_konzern',       'Kreditor ueber den ganzen Konzern', 'einkauf', true),
  ('mart.inventur',               'Inventur (Zaehlung), mit bewertetem Bestand', 'inventur', false),
  ('mart.inventur_schwund',       'Betrieb und Monat, bewerteter Schwund', 'inventur', true),
  ('mart.inventurposition',       'gezaehlter Ware je Inventur', 'inventur', true),
  ('mart.inventur_abgeschnitten', 'Inventur, deren Positionsliste abgeschnitten wirkt', 'pruefung', false),
  ('mart.pflichtartikel_stand',   'Pflichtartikelliste: Laufzeit, Umfang und ungepflegte Positionen', 'pflichtartikel', false),
  ('mart.pflichtartikel_betrieb', 'Betrieb und Pflichtartikel', 'pflichtartikel', false),
  ('mart.pflichtartikel_abdeckung','Betrieb und Pflichtartikel mit Nummer', 'pflichtartikel', false),
  ('mart.pflichtartikel_einkauf', 'Betrieb, Pflichtartikel und Monat', 'pflichtartikel', true),
  ('mart.pflichtartikel_abseits',  'Betrieb und gekauftem Artikel, der auf keiner Pflichtartikelliste '
                                   'seines Konzepts steht', 'pflichtartikel', true),
  ('mart.pflichtartikel_nicht_pruefbar', 'Pflichtartikel ohne Artikelnummer — ueberwiegend '
                                   'GFGH-Getraenke mit betriebseigenen Nummernkreisen', 'pflichtartikel', false),
  ('mart.pflichtartikel_regional', 'regionalem Pflichtartikel und Betrieb, auf den er aufgeloest wird',
                                   'pflichtartikel', false),
  ('mart.pflichtartikel_regional_offen', 'regionalem Pflichtartikel, dessen Ort keinem Betrieb '
                                   'zugeordnet werden konnte', 'pflichtartikel', false),
  ('mart.pflichtartikel_ueberlappung', 'Artikel, der auf mehr als einer Pflichtartikelliste steht',
                                   'pflichtartikel', false),
  ('mart.pflichtartikel_verdacht', 'Verdachtsfall: gekaufter Artikel, der einem Pflichtartikel '
                                   'aehnelt, ohne ihn zu sein', 'pflichtartikel', false),
  ('mart.pflichtartikel_klassifikation', 'Pflichtartikel mit seiner Einordnung', 'pflichtartikel', false),
  ('mart.pruefung_pflichtartikel', 'Pruefzeile zu den Pflichtartikeln', 'pruefung', false),
  ('mart.zeitfenster_pruefung',   'Pruefzeile je Zeitfenster', 'pruefung', false),
  ('mart.historie_stand',         'Quelle: wie weit die Historie zurueckreicht', 'import', false),

  -- Die *_basis-Sichten sind Zwischenstufen, auf denen eine materialisierte
  -- Sicht aufsetzt. Sie tragen dieselbe Koernung wie ihr Gegenstueck, stehen
  -- aber nicht im Katalog fuer Fragen — wer sie direkt liest, umgeht die
  -- Materialisierung und bekommt dieselben Zahlen langsamer.
  ('mart.artikel_monat_basis',        'Betrieb, Monat und Artikel (Zwischenstufe von mart.artikel_monat)', 'umsatz', true),
  ('mart.einkauf_betrieb_monat_basis','Betrieb und Monat (Zwischenstufe von mart.einkauf_betrieb_monat)', 'einkauf', true),
  ('mart.einkauf_pruefung_basis',     'Pruefzeile (Zwischenstufe von mart.einkauf_pruefung)', 'pruefung', false),
  ('mart.pflichtartikel_artikel_basis','Pflichtartikel und Artikel (Zwischenstufe)', 'pflichtartikel', false),
  ('mart.pflichtartikel_einkauf_basis','Betrieb, Pflichtartikel und Monat (Zwischenstufe)', 'pflichtartikel', true),
  ('mart.pflichtartikel_klassifikation_basis','Pflichtartikel mit Einordnung (Zwischenstufe)', 'pflichtartikel', false),
  ('mart.einkaufspreis_monat_basis',  'Ware, Marke, Einheit und Monat (Zwischenstufe von mart.einkaufspreis_monat)', 'einkauf', false),
  ('mart.einkaufspreis_betrieb_basis','Betrieb, Ware und Monat (Zwischenstufe von mart.einkaufspreis_betrieb)', 'einkauf', false),
  ('mart.vergleichstag_stand',    'materialisierter Vergleichstagssicht: wie alt ihre Zahlen sind', 'import', false),

  -- Bewertungen --------------------------------------------------------
  ('mart.bewertung_verlauf',      'Betrieb, Monat, Quelle und Publisher; schnitt_stand ist KUMULIERT, '
                                  'schnitt_monat nur der Monat — die beiden nicht verwechseln', 'bewertung', false),
  ('mart.bewertung_note',         'Betrieb und Monat', 'bewertung', false),
  ('mart.bewertung_einzel',       'einzelner Bewertung', 'bewertung', false),
  ('mart.bewertung_antwort',      'Antwort auf eine Bewertung', 'bewertung', false),
  ('mart.bewertung_thema',        'Bewertung und erkanntem Thema', 'bewertung', false),
  ('mart.bewertung_thema_monat',  'Monat, Thema und Marke', 'bewertung', true),
  ('mart.bewertung_ladestand',    'Quelle und Publisher: Abdeckung und letzter Lauf des Yext-Importers', 'bewertung', false),
  ('mart.betrieb_ohne_yext',      'Betrieb ohne Yext-Zuordnung', 'bewertung', false),
  ('mart.yext_abgleich',          'Betrieb mit seiner Yext-Entsprechung', 'bewertung', false),

  -- Bounti (Schulung, Personalstand, Audits) ---------------------------
  ('mart.bounti_schulung_betrieb_monat','Betrieb, Monat und Schulungsart', 'schulung', false),
  ('mart.bounti_schulung_person', 'Zuweisung und Standort — die unterste Ebene', 'schulung', false),
  ('mart.bounti_schulung_verlauf','Betrieb', 'schulung', false),
  ('mart.bounti_lerneinheit_betrieb','Betrieb und Lerneinheit', 'schulung', false),
  ('mart.bounti_person_stand',    'Person und Standort', 'schulung', false),
  ('mart.bounti_rolle_betrieb',   'Betrieb und Rolle', 'schulung', false),
  ('mart.bounti_audit_betrieb_monat','Betrieb und Monat', 'schulung', false),
  ('mart.bounti_mehrfachzuordnung','Person, die an mehreren Standorten haengt und in jedem mitzaehlt', 'schulung', false),
  ('mart.bounti_abdeckung',       'Betrieb: was Bounti von ihm kennt', 'schulung', false),

  -- Stammdaten und Standorte -------------------------------------------
  ('mart.betrieb',                'Betrieb', 'stammdaten', false),
  ('mart.betrieb_status',         'Betrieb, mit der Unterscheidung laufendes Geschaeft / kein Geschaeft', 'stammdaten', false),
  ('mart.betrieb_kapazitaet',     'Betrieb, im juengsten Kapazitaetsstand', 'stammdaten', false),
  ('mart.betrieb_bundesland',     'Betrieb mit gepflegter PLZ', 'stammdaten', false),
  ('mart.betrieb_ohne_lina_id',   'Betrieb ohne BWA-Bruecke — Erwartung: leer', 'pruefung', false),
  ('mart.konzept_zuordnung',      'Betrieb, mit der Zahl seiner Konzepte — die Arbeitsliste der Mehrdeutigen', 'stammdaten', false),
  ('mart.nachbarschaft',          'Betrieb mit gepflegtem Ort — die einzige belastbare Stadtangabe', 'stammdaten', false),
  ('mart.nachbarschaft_fehlend',  'Betrieb ohne gepflegten Ort', 'pruefung', false),
  ('mart.standort',               'Betrieb UND Monat — in Metabase immer nach Monat filtern', 'stammdaten', false),
  ('mart.standort_fehlend',       'Betrieb ohne Koordinaten', 'pruefung', false),
  ('mart.datenstand',             'Betrieb: bis wann Umsatz, bis wann BWA. Vor jeder Auswertung lesen', 'betrieb', false),

  -- Kalender und Wetter -------------------------------------------------
  ('mart.feiertag_kalender',      'Feiertag und Bundesland', 'kalender', false),
  ('mart.feiertag_normiert',      'Feiertag, Datum und Bundesland, Namen vereinheitlicht', 'kalender', false),
  ('mart.feiertag_bundesweit',    'Datum, das in allen Bundeslaendern Feiertag ist', 'kalender', false),
  ('mart.feiertag_vorausschau',   'kommendem Feiertag', 'kalender', false),
  ('mart.betrieb_kalender',       'Betrieb und Geschaeftstag, mit Feiertag und Ferienlage', 'kalender', false),
  ('mart.kalendertag_lage',       'Geschaeftstag und Bundesland', 'kalender', false),
  ('mart.kalendereffekt',         'Betrieb und Kalenderlage — was ein Feiertag am Umsatz bewegt', 'kalender', false),
  ('mart.kalendereffekt_gruppe',  'Marke und Kalenderlage', 'kalender', false),
  ('mart.kalender_fehlend',       'Betrieb ohne gepflegten Standort — die Abdeckungsluecke', 'pruefung', false),
  ('mart.kalender_abdeckung',     'Bundesland: wie weit Feiertage und Ferien reichen', 'kalender', false),
  ('mart.wetter_tag',             'Gitterpunkt und Tag', 'wetter', false),
  ('mart.betrieb_wetter_tag',     'Betrieb und Geschaeftstag', 'wetter', false),
  ('mart.wetter_effekt',          'Betrieb und Wetterklasse', 'wetter', false),
  ('mart.wetter_effekt_gruppe',   'Marke und Wetterklasse', 'wetter', false),
  ('mart.wetter_ort',             'Gitterpunkt mit den Betrieben, die daran haengen', 'wetter', false),
  ('mart.wetter_rueckstand',      'Gitterpunkt und Jahr — die Arbeitsliste des Wetter-Backfills', 'pruefung', false),
  ('mart.markt_vergleich',        'Monat: der Marktindex gegen den eigenen Umsatz', 'kalender', false),

  -- Import und Pruefung --------------------------------------------------
  ('mart.sync_status',            'Quelle: laeuft der Import', 'import', false),
  ('mart.import_gesamt',          'Lauf insgesamt — eine einzige Zeile', 'import', false),
  ('mart.import_naechste',        'offenem Posten in Abarbeitungsreihenfolge', 'import', false),
  ('mart.import_fehler',          'Fehlermuster der letzten 24 Stunden', 'import', false),
  ('mart.import_bericht',         'Bericht: Fortschritt, Aktualitaet, Gesundheit', 'import', false),
  ('mart.import_betrieb',         'Betrieb: was fehlt, wie weit die Daten reichen', 'import', false),
  ('mart.import_lauf',            'Importlauf', 'import', false),
  ('mart.import_puls',            'Stunde der letzten drei Tage', 'import', false),
  ('mart.import_sperre',          'Zugangssperre, aktive zuerst', 'import', false),
  ('mart.import_strukturaenderung','erkannter Strukturaenderung — Erwartung: leer', 'pruefung', false),
  ('mart.backfill_fortschritt',   'Endpunkt', 'import', false),
  ('mart.quelle_zulauf',          'Quelle und Endpunkt: kommt ueberhaupt etwas an', 'import', false),
  ('mart.materialisierung_stand', 'materialisierter Sicht: wann sie zuletzt aufgefrischt wurde', 'import', false),
  ('mart.pruefung_uebersicht',    'Pruefung: stimmen die Zahlen', 'pruefung', false),
  ('mart.pruefung_umsatz',        'Betrieb und Monat, gegengerechnet gegen LINAs Aggregate', 'pruefung', false),
  ('mart.pruefung_bon',           'Betrieb und Monat', 'pruefung', false),
  ('mart.posten_aufgegeben',      'endgueltig aufgegebenem Posten', 'import', false),
  ('mart.zugangssperre',          'Zugangssperre', 'import', false),
  ('mart.mcp_nutzung',            'Tag und Werkzeug des MCP-Zugangs', 'import', false),
  ('mart.mcp_wiederholte_fragen', 'normalisierter freier Abfrage', 'import', false)
ON CONFLICT (sicht) DO UPDATE
   SET koernung = excluded.koernung, thema = excluded.thema,
       summen_erlaubt = excluded.summen_erlaubt;

-- ---------------------------------------------------------------------
-- 3. Kennzahlregeln
--
-- Nur dort, wo eine naive Aggregation nachweislich falsch ist. Eine Spalte
-- ohne Zeile hier ist nicht "erlaubt", sondern "nicht entschieden" — der
-- Server warnt dann ueber die Koernung der Sicht.
-- ---------------------------------------------------------------------
INSERT INTO mcp.kennzahl (sicht, spalte, regel, einheit, hinweis) VALUES
  ('mart.umsatz_tag', 'umsatz_netto', 'summe', 'euro', NULL),
  ('mart.umsatz_tag', 'umsatz_brutto', 'summe', 'euro', NULL),
  ('mart.umsatz_tag', 'gaeste', 'summe', 'anzahl', NULL),
  ('mart.umsatz_tag', 'rechnungen', 'summe', 'anzahl', NULL),
  ('mart.umsatz_tag', 'durchschnittsbon', 'mittel', 'euro',
   'Ein Quotient. Ueber mehrere Tage nicht mitteln, sondern Umsatz durch Rechnungen neu rechnen.'),
  ('mart.umsatz_ytd', 'umsatz_pct', 'nicht_aggregieren', 'prozentzahl',
   'Veraenderung zum Vorjahr. Ueber Betriebe hinweg weder summieren noch mitteln.'),
  ('mart.umsatz_ytd', 'umsatz_ytd_pct', 'nicht_aggregieren', 'prozentzahl', NULL),
  ('mart.round_table_monat', 'umsatz_pct', 'median', 'prozentzahl',
   'Median statt Mittelwert: ein einzelner Ausreisser verzieht sonst die ganze Marke.'),
  ('mart.round_table_monat', 'personalkosten_ogf_pct', 'median', 'prozentzahl',
   'Reicht bis 1132 % (befunde-datenlage.md). Median, und nur mit Plausibilitaetsfilter.'),
  ('mart.round_table_monat', 'we_bar_pct', 'median', 'prozentzahl', NULL),
  ('mart.round_table_monat', 'we_kueche_pct', 'median', 'prozentzahl', NULL),
  ('mart.round_table_monat', 'online_bewertung', 'mittel', 'note', NULL),
  ('mart.round_table_monat', 'umsatz_ist', 'summe', 'euro',
   'Die einzige echte Summe dieser Sicht.'),
  ('mart.round_table_monat', 'gesamt', 'nicht_aggregieren', 'text',
   'Eine Ampel. Der Mittelwert zweier Ampeln ist keine Ampel — zaehlen statt mitteln.'),
  ('mart.ampel_bereich', 'ampel', 'nicht_aggregieren', 'text', 'Ampeln zaehlen, nicht mitteln.'),
  ('mart.personalkosten', 'pek_gesamt', 'median', 'prozentzahl',
   'TAGESzeile mit dem Tagesumsatz im Nenner. An einem Tag mit 6,05 EUR Umsatz ergibt das '
   '316.576 %. Median UND Filter pek_gesamt > 0 AND pek_gesamt <= 200 (so macht es jede Karte).'),
  ('mart.personalkosten', 'pek_service', 'median', 'prozentzahl', NULL),
  ('mart.personalkosten', 'pek_bar', 'median', 'prozentzahl', NULL),
  ('mart.personalkosten', 'pek_kueche', 'median', 'prozentzahl', NULL),
  ('mart.kennzahlen_aktuell', 'wert_prozent', 'nicht_aggregieren', 'prozentzahl',
   'Kommt fertig aus LINA (mode=relativ). Selbst aus den Hauptsparten gerechnet ergibt das '
   'nachweislich falsche Werte — 45,90 statt 23,64 (datenmodell.md, Entscheidung 3).'),
  ('mart.kennzahlen_aktuell', 'wert_absolut', 'summe', 'euro', NULL),
  ('mart.bewertung_verlauf', 'schnitt_stand', 'nicht_aggregieren', 'note',
   'KUMULIERTER Stand bis zu diesem Monat. Ueber Monate hinweg nicht mitteln — dafuer ist '
   'schnitt_monat da.'),
  ('mart.bewertung_verlauf', 'schnitt_monat', 'mittel', 'note', NULL),
  ('mart.bewertung_verlauf', 'anzahl_monat', 'summe', 'anzahl', NULL),
  ('mart.bewertung_verlauf', 'anzahl_stand', 'letzter_stand', 'anzahl', NULL),
  ('mart.einkaufspreis_monat', 'preis_je_gebinde', 'nicht_aggregieren', 'euro',
   'Ein Preis je Gebinde. Ueber verschiedene Gebindegroessen hinweg nicht vergleichbar — '
   'dafuer preis_je_einheit_median.'),
  ('mart.einkaufspreis_monat', 'preis_je_einheit_median', 'median', 'euro', NULL),
  ('mart.einkaufspreis_monat', 'ausgaben', 'summe', 'euro', NULL),
  ('mart.fremdeinkauf', 'netto', 'summe', 'euro',
   'Nur mit Filter auf genau eine quelle summieren, sonst Doppelzaehlung.'),
  ('mart.datenstand', 'umsatz_alter_tage', 'nicht_aggregieren', 'tage', NULL),
  ('mart.datenstand', 'bwa_verzug_monate', 'nicht_aggregieren', 'anzahl', NULL)
ON CONFLICT (sicht, spalte) DO UPDATE
   SET regel = excluded.regel, einheit = excluded.einheit, hinweis = excluded.hinweis;

-- ---------------------------------------------------------------------
-- 4. Fallstricke
--
-- Jede Zeile hier hat einen Beleg. `quelle` nennt ihn, damit niemand eine
-- Regel entfernt, weil sie ihm im Weg steht, ohne nachzusehen, warum sie
-- da ist.
-- ---------------------------------------------------------------------
INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle) VALUES
  ('stadt_immer_null', 'spalte_immer_null', 'sperre', NULL,
   '{"spalte":"stadt"}',
   'Die Spalte "stadt" ist bei ALLEN 141 Betrieben NULL — LINA liefert fuer Betriebe keine '
   'Adresse (nachgemessen 26.07.2026, erneut 10.08.2026). Wer danach gruppiert, bekommt keine '
   'Fehlermeldung, sondern EINE Gruppe mit allen Betrieben darin.',
   'Die gepflegte Stadt steht in mart.nachbarschaft.ort. Statt mart.<sicht>.stadt also ueber '
   'betrieb_key auf mart.nachbarschaft verbinden und nach ort gruppieren.',
   'docs/metabase.md, Abschnitt "Die Spalte stadt ist ueberall NULL"'),

  ('fremdeinkauf_quelle', 'filter_noetig', 'sperre', 'mart.fremdeinkauf',
   '{"spalte":"quelle"}',
   'mart.fremdeinkauf fuehrt je Betrieb und Monat mehrere Zeilen — eine je Quelle. Ohne Filter '
   'auf genau eine Quelle wird jeder Betrag doppelt gezaehlt.',
   'WHERE quelle = ''...'' ergaenzen (eine Quelle, nicht mehrere).',
   'Tabellenkommentar mart.fremdeinkauf'),

  ('einkaufspreis_vergleichbar', 'filter_noetig', 'sperre', 'mart.einkaufspreis_betrieb',
   '{"spalte":"vergleichbar","wert":true}',
   'mart.einkaufspreis_betrieb ist nur mit vergleichbar = true zu lesen. Ohne den Filter '
   'vergleicht die Abfrage verschiedene Gebindegroessen und Einheiten miteinander; ein Betrieb '
   'sieht dann teuer aus, weil er anders einkauft.',
   'WHERE vergleichbar = true ergaenzen. Und den Tabellenkommentar dieser einen Sicht NICHT '
   'als Erklaerung nehmen — er beschreibt an drei Stellen eine andere Sicht als die gebaute '
   '(Befund 12.08.2026).',
   'docs/metabase.md, Abschnitt zu Migration 0056'),

  ('join_ueber_betriebsname', 'join_ueber_name', 'sperre', NULL,
   '{"spalte":"betrieb","statt":"betrieb_key"}',
   'Verbindung ueber den Betriebsnamen. Der Name ist NICHT eindeutig: fuenf Betriebe heissen '
   '"Karlsruhe" (fuenf Restaurants in einer Stadt, kein Restaurant in fuenf Marken). Ein Join '
   'darueber mischt sie zusammen.',
   'Ueber betrieb_key verbinden. Fuer die Anzeige gehoeren Konzept und Name zusammen.',
   'docs/datenmodell.md, Abschnitt Markenebene'),

  ('nenner_ohne_geschaeft', 'nenner_unvollstaendig', 'warnung', NULL, '{}',
   'Nur 62 der 141 gefuehrten Betriebe machen ueberhaupt Umsatz. Die uebrigen 79 sind '
   'Beteiligungsgesellschaften, geschlossene oder noch nicht eroeffnete Standorte und '
   'Testeintraege — sie liefern Umsatzberichte ueber 0 EUR, und core.betrieb.aktiv steht bei '
   'allen 141 auf true. Jeder Mittelwert ueber "alle Betriebe" ist damit um mehr als die '
   'Haelfte verduennt, jede Zaehlung hat einen Nenner, der zu 56 % aus Zeilen besteht, die '
   'gar kein Geschaeft beschreiben.',
   'Ueber mart.betrieb_status auf Betriebe mit laufendem Geschaeft einschraenken.',
   'docs/befunde-datenlage.md, Befund 1'),

  ('prozent_skaliert', 'prozent_skaliert', 'warnung', NULL, '{}',
   'Prozentwerte sind in diesem Schema durchgaengig PROZENTZAHLEN (23.64), nie Brueche '
   '(0.2364). Das Excel macht es andersherum — das ist die haeufigste Fehlerquelle des '
   'Projekts. Eine Multiplikation mit 100 ergibt hier den Faktor-100-Fehler.',
   'Den Faktor weglassen.',
   'AGENTS.md, harte Regel 6'),

  ('personalquote_ungefiltert', 'filter_noetig', 'warnung', 'mart.personalkosten',
   '{"spalte":"pek_gesamt","beispiel":"pek_gesamt > 0 AND pek_gesamt <= 200"}',
   'mart.personalkosten fuehrt TAGESzeilen, und die Quoten darin haben den Tagesumsatz im '
   'Nenner. An einem Tag mit 6,05 EUR Umsatz ergibt das 316.576 Prozent; ueber alle Tageswerte '
   'liegt der Median bei 383 Prozent. Ohne Plausibilitaetsfilter ist jede Zusammenfassung Unsinn.',
   'WHERE pek_gesamt > 0 AND pek_gesamt <= 200 ergaenzen und den MEDIAN nehmen, nicht den '
   'Mittelwert — genau so macht es jede Metabase-Karte.',
   'metabase/karten-drilldown.ts, Konstante PLAUSIBEL'),

  ('bundesland_luecke', 'abdeckung_luecke', 'warnung', NULL,
   '{"achse":"bundesland","gepflegt":60,"gesamt":141}',
   'Das Bundesland haengt an der PLZ aus manual.betrieb_standort, und die ist fuer 60 von 141 '
   'Betrieben gepflegt. Neun der fehlenden haben laufenden Umsatz 2026: zusammen 15,1 Mio EUR '
   'von 68,7 Mio EUR, also 22 %, angefuehrt vom umsatzstaerksten Betrieb der Gruppe. Eine '
   'Auswertung nach Bundesland ist damit eine Aussage ueber einen Teil, nicht ueber die Gruppe.',
   'mart.kalender_fehlend danebenstellen, damit die Luecke sichtbar bleibt.',
   'docs/plan-kalender-wetter.md, Abschnitt 1'),

  ('ort_luecke', 'abdeckung_luecke', 'warnung', NULL,
   '{"achse":"ort","gepflegt":60,"gesamt":141}',
   'Der Ort kommt aus manual.betrieb_standort und ist fuer 60 von 141 Betrieben gepflegt. '
   'mart.nachbarschaft_fehlend nennt die uebrigen.',
   NULL,
   'docs/metabase.md'),

  ('wareneinsatz_ansatz', 'deutung', 'warnung', 'mart.deckungsbeitrag_warengruppe',
   '{}',
   'Der theoretische Wareneinsatz dieser Sicht steht auf core.artikel.fixer_we, dessen Herkunft '
   'ungeklaert ist. Als Umsatzgliederung brauchbar, ALS MARGENAUSSAGE NICHT. Vor jeder Ableitung '
   'auf abdeckung_pct sehen.',
   NULL,
   'AGENTS.md, harte Regel 5'),

  ('bwa_versatz', 'deutung', 'warnung', NULL, '{"spalten":["bwa_monat"]}',
   'Umsatz und BWA stehen NICHT im selben Monat: der Round Table nimmt den Umsatz des '
   'Berichtsmonats und die BWA des juengsten verfuegbaren Monats bis dahin — je Betrieb einzeln. '
   'Im Juni 2026 waren am 25.07. erst 22 von 131 Betrieben gebucht. Welcher Monat es je Betrieb '
   'war, steht in bwa_monat.',
   'bwa_monat mit ausgeben, wenn Personal- oder Wareneinsatzzahlen gezeigt werden.',
   'docs/datenmodell.md, Entscheidung 6'),

  ('ware_ueber_id', 'gruppierung_falsch', 'warnung', NULL,
   '{"spalte":"ware_fn_id","statt":"ware"}',
   'Dieselbe Ware wird in FoodNotify unter mehreren IDs gefuehrt — 866 Saetze auf 428 Namen. '
   'Wer ueber die ID gruppiert, zersplittert eine Preisreihe in Einzelpunkte.',
   'Ueber den Warennamen gruppieren.',
   'docs/fehlerkatalog.md'),

  ('grosse_tabelle_ohne_zeitraum', 'zeitraum_noetig', 'warnung', 'mart.artikelverkauf',
   '{"spalte":"geschaeftstag"}',
   'mart.artikelverkauf liegt auf einer partitionierten Tabelle mit rund 20 Mio. Zeilen je Jahr. '
   'Ohne Einschraenkung auf einen Zeitraum liest die Abfrage quer durch alle Partitionen.',
   'WHERE geschaeftstag >= ... ergaenzen.',
   'docs/datenmodell.md, Abschnitt Partitionierung'),

  ('umsatz_tag_ohne_zeitraum', 'zeitraum_noetig', 'warnung', 'mart.umsatz_tag',
   '{"spalte":"geschaeftstag"}',
   'mart.umsatz_tag fuehrt 443.304 Tageszeilen ab 01.01.2018. Ohne Zeitraum ist das Ergebnis '
   'gross und die Antwort langsam.',
   'WHERE geschaeftstag >= ... ergaenzen.',
   'docs/plan-kalender-wetter.md')
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

-- Entfallene Sichten markieren (die Koernung oben hat auch Sichten
-- angelegt, die es in dieser Datenbank nicht gibt) und die Koernung in die
-- Tabellenkommentare tragen, damit Metabase und Postico sie ebenfalls zeigen.
SELECT mcp.achsen_ableiten();
SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt FROM mcp.koernung_in_kommentare();
