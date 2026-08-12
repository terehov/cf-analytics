/**
 * 0058 — Der Belegarchiv-Zweig wird benutzbar: Zuordnung, Abgrenzung, Zahlenfehler
 *
 * ANLASS (12.08.2026). Der Erstlauf des Belegarchivs ist durch, 593.353 Belege
 * stehen in core.buchungsbeleg. Damit lief mart.fremdeinkauf zum ersten Mal mit
 * beiden Zweigen — und meldete 8.164 nicht freigegebene Lieferanten mit
 * 14.024.387.689.386 EUR. Beides ist kein Befund, sondern drei Maengel.
 * Gemessen auf der Serverbank, Reihenfolge nach Hebel.
 *
 * ---------------------------------------------------------------------
 * 1. DIE ZUORDNUNG KENNT DIE SCHREIBWEISEN DES BELEGARCHIVS NICHT
 *
 * manual.kreditor_gruppe wurde aus FoodNotify-Namen gebaut. Das Belegarchiv
 * schreibt anders, und dadurch landen FREIGEGEBENE Lieferanten im Fremdeinkauf:
 *
 *   distra handels gmbh                            19.141.334 EUR
 *   chefs culinar wir leben foodservice             5.817.306 EUR
 *   chefs culinar sued gmbh und co kg tel 08291 ..  2.682.527 EUR
 *   layer chemie gmbh                               1.091.133 EUR
 *
 * Allein Chefs Culinar steht in ZWOELF Schreibweisen da — die Belegliste
 * uebernimmt den Briefkopf mitsamt Telefonnummer und Postfach. Das ist der
 * groesste Hebel: er verwandelt eine Verdachtsliste in eine Arbeitsliste.
 *
 * WAS HIER BEWUSST NICHT ZUGEORDNET WIRD. Die Tabelle traegt seit 0053 die
 * Regel "eine Namensaehnlichkeit darf ein Vorschlag sein, nie eine Zuordnung".
 * Deshalb bleibt "cf" (245.551 EUR, 13 Betriebe) unzugeordnet: es kann CF Gastro
 * sein (Wareneinkauf) oder Concept Family (Konzern), und das entscheidet kein
 * Praefix. Ebenso "knapp gmbh", "quadrat p", "schweinfurt", "lermer", "sat",
 * "w" und die OCR-Truemmer wie "comis9 shemalessignal iduna gruppe".
 *
 * ---------------------------------------------------------------------
 * 2. DAS BELEGARCHIV ENTHAELT ALLE RECHNUNGEN, NICHT NUR WARENEINKAUF
 *
 * Unter den groessten "Lieferanten" stehen visa (1.596.603), pay one
 * (1.260.471), concept family franchise ag (7.499.249) und family und friends
 * marketing gmbh (2.224.204). Zahlungsdienstleister, Konzerninnenumsatz,
 * Marketing. Ohne Abgrenzung zaehlt jede Versicherungsrechnung als
 * Fremdeinkauf.
 *
 * WARUM NICHT UEBER DAS SACHKONTO, das dafuer da waere: es ist auf 3.354 von
 * 103.656 nutzbaren Rechnungen gefuellt — 3,2 Prozent. kreditor_konto steht bei
 * 52,9 Prozent. Beides traegt keine Abgrenzung. Es bleibt die Pflegeliste.
 *
 * WARUM art NULL SEIN DARF, und warum das NICHT der am 12.08. verworfene dritte
 * Zustand ist: verworfen wurde ein drittes FREIGABE-Urteil ("nicht eingeordnet"
 * neben freigegeben und nicht freigegeben). Hier geht es um eine andere Achse —
 * ob die Rechnung ueberhaupt Wareneinkauf ist. Wer das nicht weiss, darf es
 * nicht raten: "wareneinkauf = false" wuerde echten Fremdeinkauf verstecken,
 * "true" wuerde die Stadtwerke dazuzaehlen. NULL heisst hier "noch nicht
 * eingeordnet" und ist die Arbeitsliste, nicht das Ergebnis.
 *
 * ---------------------------------------------------------------------
 * 3. DER ZAHLENFEHLER KOMMT VON LINA, NICHT VON UNS
 *
 * Nachgesehen in raw.api_antwort: das Rohfeld nettoBetrag enthaelt selbst
 * "117982000000,00". deutscheZahl() (src/ladenakte/html.ts:74) hat korrekt
 * geparst, was geliefert wurde. Das Muster ist Cent mal 10^6:
 *
 *   netto_split_roh              gespeichert        gemeint
 *   7.847,11/0,00/7.847,11       784.712.000.000    7.847,12
 *   5.541,71/0,00/5.541,71       554.172.000.000    5.541,72
 *
 * 124 Belege liegen ueber 1 Mio EUR, 105 davon ueber 100 Mio, 84 sind exakte
 * Millionen-Vielfache. Daneben stehen 111.069 Rechnungen unter 100.000 EUR;
 * das 99. Perzentil liegt bei 6.292 EUR. Eine Einzelrechnung ueber 1 Mio EUR
 * ist in diesem Geschaeft nicht glaubhaft.
 *
 * DIE 124 WERDEN AUF NULL GESETZT, NICHT KORRIGIERT. Der wahre Betrag ist nicht
 * herleitbar: netto und die Steueraufteilung stimmen auch dort nicht ueberein,
 * wo beide plausibel aussehen (Beleg 16752: netto 1.179,82 gegen Splitsumme
 * 1.267,47). Wer durch 10^8 teilt, erfindet eine Zahl. NULL heisst unbekannt —
 * dieselbe Regel wie in laden.ts:218 ("Bei unlesbarem Betrag NULL, nicht 0 —
 * sonst wird aus unbekannt ein Wert"). Der Rohwert bleibt in raw.api_antwort
 * erhalten (AGENTS.md Regel 4), die Reparatur ist also jederzeit umkehrbar.
 *
 * Die Grenze steht ZUSAETZLICH im Lader (src/ladenakte/laden.ts), sonst holt
 * das naechste ON CONFLICT DO UPDATE die Werte zurueck.
 *
 * ---------------------------------------------------------------------
 * WAS DIESE MIGRATION NICHT LOEST
 *
 * Der fehlende Betrag bei 71,8 Prozent der Rechnungen. Bei 269.514 von 283.303
 * liefert LINAs Belegliste gar keinen — kein Rohfeld, nichts zu parsen. Das ist
 * eine Grenze von Weg A und hier nicht zu heilen. 3.219 haben einen Rohwert in
 * netto_split_roh, waehrend nettoBetrag auf 0 steht; ob deren Steuersumme als
 * Ersatz taugt, ist ungeklaert und steht in docs/offene-punkte.md.
 */


-- ---------------------------------------------------------------------
-- Was fuer eine Art Rechnung ist das ueberhaupt?
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual.lieferant_art (
    dach_name    text PRIMARY KEY,
    art          text NOT NULL,
    notiz        text,
    gepflegt_am  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT lieferant_art_art_check CHECK (art IN (
        'wareneinkauf',        -- Speisen, Getraenke, Hygiene, Kaffee
        'zahlungsdienst',      -- Kartenterminals, Acquirer, Wallets
        'bank_leasing',        -- Kontofuehrung, Darlehen, Fahrzeugleasing
        'konzern',             -- Innenumsatz zwischen Gesellschaften der Gruppe
        'energie',             -- Strom, Gas, Wasser, Stadtwerke
        'handwerk_bau',        -- Bau, Malerei, Elektro, Haustechnik
        'behoerde',            -- Finanzamt, Umsatzsteuer, Krankenkassen
        'marketing_plattform', -- Werbung, Druck, Lieferplattformen
        'dienstleistung',      -- Steuerberatung, Reinigung, Sicherheit
        'miete'                -- Pacht und Immobilien
    ))
);

COMMENT ON TABLE manual.lieferant_art IS
'Ist diese Rechnung Wareneinkauf? Das Belegarchiv fuehrt ALLE Eingangsrechnungen,
auch Strom, Leasing, Finanzamt und Kartengebuehren. Ohne diese Abgrenzung zaehlt
mart.fremdeinkauf jede Versicherung als Fremdeinkauf.
GEPFLEGT UND NICHT ABGELEITET: das Sachkonto waere der richtige Weg, steht aber
nur auf 3,2 Prozent der nutzbaren Rechnungen (gemessen 12.08.2026).
Der Schluessel ist der DACHNAME, also das, was in mart.fremdeinkauf.lieferant
steht — bei gepflegten Lieferanten der Dachname aus manual.kreditor_gruppe, sonst
der normierte Verkaeufername. Beides ist zulaessig; wer einen Namen spaeter
zusammenfasst, zieht den art-Eintrag mit um.
WER NICHT DRINSTEHT, IST NICHT "kein Wareneinkauf", sondern nicht eingeordnet.
mart.fremdeinkauf.wareneinkauf ist dann NULL. Das ist Absicht — siehe Kopf 0058.';

COMMENT ON COLUMN manual.lieferant_art.dach_name IS
'Muss auf mart.fremdeinkauf.lieferant passen, nicht auf den Rohnamen der Rechnung.';


-- ---------------------------------------------------------------------
-- 1. Die Schreibweisen des Belegarchivs auf die bestehenden Dachnamen
--
-- Nur woertlich erkennbare Faelle. Chefs Culinar steht mit Briefkopf,
-- Telefonnummer, Postfach und Niederlassung in der Liste — dasselbe
-- Unternehmen, zwoelfmal verschieden abgetippt.
-- ---------------------------------------------------------------------
INSERT INTO manual.kreditor_gruppe (name_norm, dach_name, notiz) VALUES
    ('distra handels gmbh', 'Distra',
     'Belegarchiv-Schreibweise, 19,1 Mio EUR ueber 70 Betriebe'),

    ('chefs culinar wir leben foodservice',                        'Chefs Culinar', 'Briefkopf-Slogan mitgelesen'),
    ('chefs culinar sued gmbh und co kg tel 08291 851 0',          'Chefs Culinar', 'Telefonnummer mitgelesen'),
    ('chefs culinar sued gmbh und co kg tel 08291 851',            'Chefs Culinar', 'Telefonnummer mitgelesen'),
    ('chefs culinar sued gmbh und co kg',                          'Chefs Culinar', NULL),
    ('chefs culinar sued gmbh und co k',                           'Chefs Culinar', 'abgeschnitten'),
    ('chefs culinar west gmbh und co',                             'Chefs Culinar', 'abgeschnitten'),
    ('chefs culinar west gmbh und co kg niederlassung woellstein', 'Chefs Culinar', NULL),
    ('chefs culinar west gmbh und co kg grosshandel nl',           'Chefs Culinar', NULL),
    ('chefs culinar west gmbh und co kg grosshandel nl weeze',     'Chefs Culinar', NULL),
    ('chefs culinar west gmbh und co kg postfach 1012 14',         'Chefs Culinar', 'Postfach mitgelesen'),
    ('chefs culinar ost gmbh und co kg tel 034441 95 5 fax 6000',  'Chefs Culinar', 'Telefon und Fax mitgelesen'),
    ('chefs culinar ost gmbh und co kg tel 034441 95 5 fax',       'Chefs Culinar', 'Telefon und Fax mitgelesen'),

    ('layer chemie gmbh',      'Layer-Chemie', 'Belegarchiv-Schreibweise'),
    ('j j darboven seit 1866', 'J.J. Darboven', 'Briefkopf-Slogan mitgelesen'),

    ('cf customized foodservice',                                        'CF Gastro', 'Belegarchiv-Schreibweise'),
    ('cf customized cf gastro service gmbh und co kg beusselstrasse',    'CF Gastro', 'Anschrift mitgelesen'),

    ('glh getraenke gmbh', 'GLH Getränke Logistik Heilbronn',
     'GLH plus Getraenke — dieselbe Firma wie glh und glh getraenke logistik heilbronn'),

    -- Neue Dachnamen. Sie stehen NICHT auf der Freigabeliste; sie werden hier
    -- nur zusammengefasst, damit die Verdachtsliste eine Zeile je Firma zeigt.
    ('transgourmet deutschland gmbh', 'Transgourmet', NULL),
    ('transgourmet',                  'Transgourmet', 'abgeschnitten'),

    ('dinkelacker schwabenbraeu gmbh',              'Dinkelacker-Schwaben Bräu', NULL),
    ('dinkelacker schwaben braeu cd gmbh und co kg','Dinkelacker-Schwaben Bräu', NULL),

    ('erfrischungs getraenke union k g gmbh pf 1860',      'Erfrischungs-Getränke-Union', 'Postfach mitgelesen'),
    ('erfrischungs getraenke union k',                     'Erfrischungs-Getränke-Union', 'abgeschnitten'),
    ('erfrischungs getraenke union kulmbacher gruppe gmbh','Erfrischungs-Getränke-Union', NULL),
    ('erfrischungs keb getraenke union',                   'Erfrischungs-Getränke-Union', 'Zeichendreher im Briefkopf'),

    ('egt',                          'EGT Energievertrieb', NULL),
    ('egt energievertrieb gmbh',     'EGT Energievertrieb', NULL),
    ('egt energievertrieb gmbh egt', 'EGT Energievertrieb', 'Name doppelt gelesen'),
    ('egt energievertrieb gmbh egt p','EGT Energievertrieb', 'Name doppelt gelesen'),

    ('telecash fiserv',        'TeleCash', NULL),
    ('telecash from f serv',   'TeleCash', 'Fiserv verlesen'),
    ('1cs first cash solution','First Cash Solution', NULL),
    ('first cash solution',    'First Cash Solution', NULL),
    ('commerzbank globalpayments', 'Global Payments', NULL),
    ('globalpayments',             'Global Payments', NULL)
ON CONFLICT (name_norm) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2. Was davon ist Wareneinkauf?
--
-- Nur die Namen aus den oberen Raengen nach Volumen. Der Rest bleibt
-- uneingeordnet und faellt in mart.fremdeinkauf mit wareneinkauf = NULL auf.
-- ---------------------------------------------------------------------
INSERT INTO manual.lieferant_art (dach_name, art, notiz) VALUES
    -- Wareneinkauf: freigegeben
    ('Distra',                       'wareneinkauf', 'Food, Konzernfreigabe'),
    ('Chefs Culinar',                'wareneinkauf', 'Food, Konzernfreigabe'),
    ('CF Gastro',                    'wareneinkauf', 'Food, Konzernfreigabe'),
    ('Layer-Chemie',                 'wareneinkauf', 'Hygiene, Konzernfreigabe'),
    ('J.J. Darboven',                'wareneinkauf', 'Kaffee und Tee, Konzernfreigabe'),
    ('GLH Getränke Logistik Heilbronn','wareneinkauf','GFGH'),
    ('WIGEM Getränke',               'wareneinkauf', 'GFGH'),
    ('FFD Frisch Fruchtig Delp',     'wareneinkauf', 'Obst und Gemuese'),
    ('Pentz',                        'wareneinkauf', NULL),
    ('Splendid Drinks',              'wareneinkauf', NULL),

    -- Wareneinkauf: nicht freigegeben, aber unstrittig Ware
    ('Transgourmet',                 'wareneinkauf', 'Foodservice-Grosshandel'),
    ('Erfrischungs-Getränke-Union',  'wareneinkauf', 'Getraenke, Kulmbacher Gruppe'),
    ('Dinkelacker-Schwaben Bräu',    'wareneinkauf', 'Brauerei'),
    ('gastro mis gmbh',              'wareneinkauf', 'Gastronomiebedarf'),
    ('riegele kg schoenes leben hier','wareneinkauf', 'Brauerei Augsburg'),
    ('radeberger gruppe deutsche bierkultur', 'wareneinkauf', 'Brauereigruppe'),
    ('staatliches hofbraeuhaus',     'wareneinkauf', 'Brauerei'),
    ('wuerzburger hofbraeu seit 1643','wareneinkauf', 'Brauerei'),
    ('brauhaus pforzheim',           'wareneinkauf', 'Brauerei'),
    ('hoepfner',                     'wareneinkauf', 'Brauerei Karlsruhe'),
    ('trinkkontor gmbh',             'wareneinkauf', 'Getraenkehandel'),
    ('g w getraenke weidlich',       'wareneinkauf', 'Getraenkehandel'),
    ('w gem getraenke',              'wareneinkauf', 'Getraenkehandel'),
    ('fritz bierhalter getraenke fac','wareneinkauf', 'Getraenkefachgrosshandel'),
    ('bs bier und speisen gastro gmb','wareneinkauf', 'Getraenke und Speisen'),
    ('metzger schneider gmbh',       'wareneinkauf', 'Fleisch'),
    ('landmetzgerei ichtl',          'wareneinkauf', 'Fleisch'),
    ('karl guenther gmbh und co kg', 'wareneinkauf', 'Lebensmittelgrosshandel'),
    ('manss gmbh frischeservice',    'wareneinkauf', 'Frischeservice'),
    ('fruchthof nagel gmbh',         'wareneinkauf', 'Obst und Gemuese'),
    ('ffd handels gmbh',             'wareneinkauf', 'Obst und Gemuese'),
    ('omega sorg',                   'wareneinkauf', 'Lebensmittelgrosshandel'),
    ('siller und laar',              'wareneinkauf', 'Lebensmittel'),
    ('lieferant der gastronomie seo fisch nelkenstrasse 13 90439', 'wareneinkauf', 'Fisch'),
    ('segafredo zanetti',            'wareneinkauf', 'Kaffee — steht neben der Darboven-Freigabe'),

    -- Zahlungsdienstleister
    ('visa',              'zahlungsdienst', NULL),
    ('pay one',           'zahlungsdienst', NULL),
    ('american express',  'zahlungsdienst', NULL),
    ('unzer',             'zahlungsdienst', NULL),
    ('TeleCash',          'zahlungsdienst', NULL),
    ('First Cash Solution','zahlungsdienst', NULL),
    ('Global Payments',   'zahlungsdienst', NULL),

    -- Banken, Darlehen, Leasing
    ('volksbank stuttgart eg',        'bank_leasing', NULL),
    ('volksbank eg die gestalterbank','bank_leasing', NULL),
    ('sparkasse karlsruhe',           'bank_leasing', NULL),
    ('stadtsparkasse augsburg',       'bank_leasing', NULL),
    ('muenchner bank eg',             'bank_leasing', NULL),
    ('volkswagen bank gmbh',          'bank_leasing', NULL),
    ('volkswagen leasing gmbh',       'bank_leasing', NULL),
    ('uvw leasing',                   'bank_leasing', NULL),

    -- Konzerninnenumsatz
    ('concept family franchise ag',      'konzern', NULL),
    ('family und friends marketing gmbh','konzern', NULL),
    ('family und friends immo services', 'konzern', NULL),
    ('enchilada management gmbh',        'konzern', NULL),
    ('wilma wunder management gmbh',     'konzern', NULL),
    ('aposto management gmbh',           'konzern', NULL),
    ('aposto augsburg gmbh',             'konzern', NULL),
    ('wilma wunder dresden gmbh',        'konzern', NULL),
    ('wilma wunder recklinghausen gm',   'konzern', 'abgeschnitten'),
    ('wilma wunder w essen trinken',     'konzern', NULL),
    ('condukto franchise gmbh',          'konzern', NULL),
    ('condukto service gmbh',            'konzern', NULL),
    ('gastro experts',                   'konzern', 'Marke der Gruppe'),

    -- Energie und Versorger
    ('EGT Energievertrieb',                          'energie', NULL),
    ('enbw ostwuerttemberg donauries ag postfach 1353','energie', NULL),
    ('e on energie deutschland gmbh',                'energie', NULL),
    ('stadtwerke muenchen sw m',                     'energie', NULL),
    ('wvv',                                          'energie', 'Wuerzburger Versorgungs- und Verkehrsbetriebe'),

    -- Bau und Handwerk
    ('hinsche gastrobau gmbh',        'handwerk_bau', NULL),
    ('malerfachbetrieb cirillo und soh','handwerk_bau', 'abgeschnitten'),
    ('cirillo sohn und',              'handwerk_bau', 'abgeschnitten'),
    ('elektro peters',                'handwerk_bau', NULL),
    ('aci haustechnik',               'handwerk_bau', NULL),
    ('y e yuecelektro',               'handwerk_bau', NULL),
    ('lindemann wohnkultur',          'handwerk_bau', 'Einrichtung'),

    -- Behoerden
    ('ust',                            'behoerde', 'Umsatzsteuer'),
    ('finanzamt koeln mitte veranlagu','behoerde', 'abgeschnitten'),
    ('aok niedersachsen',              'behoerde', 'Krankenkasse'),

    -- Werbung, Druck, Plattformen
    ('meta',        'marketing_plattform', 'Werbung'),
    ('flyeralarm',  'marketing_plattform', 'Druck'),
    ('wolt',        'marketing_plattform', 'Lieferplattform'),

    -- Dienstleistung
    ('schroeder und schroeder steuer','dienstleistung', 'Steuerberatung, abgeschnitten'),
    ('rds clean',                     'dienstleistung', 'Reinigung'),
    ('s soylu dienstleistungen',      'dienstleistung', NULL),

    -- Miete und Pacht
    ('aalener immobiliengesellschaft','miete', NULL)
ON CONFLICT (dach_name) DO NOTHING;


-- ---------------------------------------------------------------------
-- 3. Die 124 unglaubhaften Betraege auf unbekannt setzen
--
-- Kein DELETE: der Beleg existiert, nur sein Betrag ist unlesbar. Der Rohwert
-- steht unveraendert in raw.api_antwort.
-- ---------------------------------------------------------------------
UPDATE core.buchungsbeleg
   SET netto = NULL
 WHERE netto IS NOT NULL
   AND abs(netto) >= 1000000;


-- ---------------------------------------------------------------------
-- mart.fremdeinkauf: dieselbe Sicht, zwei Spalten mehr
--
-- Ersetzt die Fassung aus 0055. Geaendert sind nur der Join auf
-- manual.lieferant_art und die zwei Spalten art und wareneinkauf; die
-- Einordnungslogik ist unveraendert.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.fremdeinkauf AS
WITH zeilen AS (
  SELECT 'foodnotify'::text                            AS quelle,
         k.betrieb_key,
         date_trunc('month', b.bestellt_am)::date      AS monat,
         coalesce(g.dach_name, core.kreditor_name_norm(l.name)) AS dach_name,
         l.name                                        AS name_quelle,
         k.art                                         AS bereich,
         count(DISTINCT b.bestellung_key)              AS belege,
         sum(b.summe)                                  AS netto
    FROM core.bestellung b
    JOIN core.lieferant   l ON l.lieferant_key = b.lieferant_key
    JOIN core.kostenstelle k USING (kostenstelle_key)
    LEFT JOIN manual.kreditor_gruppe g
           ON g.name_norm = core.kreditor_name_norm(l.name)
   WHERE b.status IS DISTINCT FROM 'canceled'
     AND b.bestellt_am IS NOT NULL
     AND k.betrieb_key IS NOT NULL
     AND core.kreditor_name_norm(l.name) IS NOT NULL
   GROUP BY k.betrieb_key, date_trunc('month', b.bestellt_am),
            coalesce(g.dach_name, core.kreditor_name_norm(l.name)), l.name, k.art
  UNION ALL
  SELECT 'belegarchiv',
         bl.betrieb_key,
         date_trunc('month', bl.beleg_datum)::date,
         coalesce(g.dach_name, core.kreditor_name_norm(bl.verkaeufer_name)),
         bl.verkaeufer_name,
         CASE WHEN bl.zuordnung_fibu = 1 THEN 'bar'
              WHEN bl.zuordnung_fibu = 2 THEN 'kueche'
              WHEN bl.zuordnung_fibu = 0 THEN 'sonstige'
              ELSE NULL
         END,
         count(*),
         sum(bl.netto)
    FROM core.buchungsbeleg bl
    LEFT JOIN manual.kreditor_gruppe g
           ON g.name_norm = core.kreditor_name_norm(bl.verkaeufer_name)
   WHERE bl.typ_id = '1'
     AND bl.beleg_datum IS NOT NULL
     AND core.kreditor_name_norm(bl.verkaeufer_name) IS NOT NULL
   GROUP BY bl.betrieb_key, date_trunc('month', bl.beleg_datum),
            coalesce(g.dach_name, core.kreditor_name_norm(bl.verkaeufer_name)),
            bl.verkaeufer_name, bl.zuordnung_fibu
)
SELECT z.quelle,
       z.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       z.monat,
       z.dach_name     AS lieferant,
       z.name_quelle,
       z.bereich,
       coalesce(f.warengruppe,
                CASE WHEN h.dach_name IS NOT NULL THEN 'getraenke' END)
                       AS warengruppe,
       /*
        * ZWEI ZUSTAENDE, UND DER STANDARD IST "NICHT FREIGEGEBEN".
        *
        * Hier standen zuerst drei Zustaende, mit "nicht eingeordnet" als
        * Standard. Die Begruendung war, ein Standardwert wuerde 112 Firmen
        * auf einen Schlag zu Fremdeinkauf erklaeren, darunter Brauereien
        * mit Liefervertrag und Winzer.
        *
        * Der Nutzer hat das am 12.08.2026 verworfen, und zwar zu Recht:
        * dass eine Brauerei mit Liefervertrag berechtigt ist, ist kein
        * Grund fuer einen dritten Zustand, sondern ein Grund, sie in
        * manual.lieferant_freigabe EINZUTRAGEN. Dafuer ist die Liste da.
        *
        * WAS DER DRITTE ZUSTAND WERT WAR, steht in der Spalte grund: sie
        * unterscheidet "ausdruecklich gesperrt" von "steht nicht auf der
        * Liste". Fuer den Befund macht das keinen Unterschied, fuer die
        * Arbeitsplanung schon.
        *
        * DAVON ZU TRENNEN IST wareneinkauf weiter unten. Das ist keine
        * Freigabe, sondern die Frage, ob die Rechnung ueberhaupt Ware
        * betrifft — siehe Kopf 0058.
        */
       CASE
         WHEN f.freigegeben IS TRUE
              AND (f.gilt_ab IS NULL OR z.monat >= date_trunc('month', f.gilt_ab)::date)
           THEN 'freigegeben'
         WHEN gb.dach_name IS NOT NULL
           THEN 'freigegeben'
         ELSE 'nicht freigegeben'
       END             AS einordnung,
       CASE
         WHEN f.freigegeben IS TRUE
              AND (f.gilt_ab IS NULL OR z.monat >= date_trunc('month', f.gilt_ab)::date)
           THEN 'konzernfreigabe'
         WHEN gb.dach_name IS NOT NULL
           THEN 'gfgh des hauses'
         WHEN f.freigegeben IS FALSE
              AND (f.gilt_ab IS NULL OR z.monat >= date_trunc('month', f.gilt_ab)::date)
           THEN 'ausdruecklich gesperrt'
         WHEN h.dach_name IS NOT NULL
              AND gb_haus.dach_name IS NOT NULL
              AND gb_haus.dach_name IS DISTINCT FROM z.dach_name
           THEN 'fremder getraenkehaendler'
         WHEN f.freigegeben IS TRUE AND z.monat < date_trunc('month', f.gilt_ab)::date
           THEN 'freigabe galt damals noch nicht'
         ELSE 'steht nicht auf der liste'
       END             AS grund,
       -- Der hinterlegte GFGH des Hauses, IMMER wenn es einen gibt — nicht
       -- nur im Befundfall. Zuerst stand hier gb_fremd.dach_name; die Spalte
       -- war damit in 9.078 von 9.078 Zeilen NULL und log ueber ihren Namen.
       gb_haus.dach_name AS gfgh_des_betriebs,
       z.belege,
       z.netto,
       /*
        * Ist das ueberhaupt Wareneinkauf? NULL heisst "noch nicht eingeordnet"
        * und ist die Arbeitsliste. Wer Fremdeinkauf auswertet, filtert auf
        * wareneinkauf IS TRUE — sonst zaehlen Strom, Leasing und Finanzamt mit.
        *
        * STEHT AM ENDE, obwohl es fachlich neben einordnung gehoert:
        * CREATE OR REPLACE VIEW darf Spalten nur anhaengen. Ein DROP mit
        * CASCADE haette die Metabase-Karten mitgenommen — das ist der Preis
        * fuer eine Sicht, die schon in Benutzung ist.
        */
       la.art          AS lieferant_art,
       (la.art = 'wareneinkauf') AS wareneinkauf
  FROM zeilen z
  JOIN core.betrieb b                 ON b.betrieb_key  = z.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = z.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = z.betrieb_key
  LEFT JOIN manual.lieferant_freigabe f ON f.dach_name  = z.dach_name
  LEFT JOIN manual.lieferant_art     la ON la.dach_name = z.dach_name
  -- Ist dieser Lieferant ueberhaupt ein Getraenkehaendler?
  LEFT JOIN manual.gfgh_haendler   h  ON h.dach_name    = z.dach_name
  -- Der GFGH DIESES Betriebs, und nur wenn er es ist:
  LEFT JOIN manual.gfgh_betrieb gb
         ON gb.betrieb_key = z.betrieb_key AND gb.dach_name = z.dach_name
  -- Welchen GFGH hat dieses Haus hinterlegt? Ohne Bezug zum Lieferanten der
  -- Zeile — dadurch ist die Spalte gfgh_des_betriebs immer gefuellt, und die
  -- Einordnung haengt nicht mehr an der Pflegearbeit FREMDER Betriebe.
  LEFT JOIN manual.gfgh_betrieb gb_haus
         ON gb_haus.betrieb_key = z.betrieb_key;

COMMENT ON VIEW mart.fremdeinkauf IS
'Einkaufsvolumen je Betrieb, Monat und Lieferant, mit der Einordnung daneben —
die Grundlage fuer Fremdeinkauf, Lieferantenkonzentration und Volumen je Haus.

DREI FILTER GEHOEREN IMMER DAZU, sonst steht Unsinn im Bericht:
  1. quelle: NIE darueber summieren. FoodNotify und Belegarchiv fuehren dieselbe
     Rechnung doppelt. Immer nach quelle gruppieren oder eine Quelle waehlen.
  2. wareneinkauf IS TRUE: das Belegarchiv fuehrt ALLE Eingangsrechnungen. Ohne
     diesen Filter zaehlen visa, pay one, Stadtwerke und Finanzamt als
     Fremdeinkauf. NULL heisst "noch nicht eingeordnet" (manual.lieferant_art),
     nicht "kein Wareneinkauf" — es ist die Arbeitsliste.
  3. einordnung = ''nicht freigegeben'' liefert die Verdachtsliste.

ZWEI ZUSTAENDE BEI DER FREIGABE, UND DER STANDARD IST "nicht freigegeben". Wer
nicht auf der Freigabeliste steht und nicht der GFGH seines Hauses ist, ist
Fremdeinkauf. Die Spalte grund sagt, warum — und trennt "ausdruecklich gesperrt"
von "steht nicht auf der liste".

WARENEINKAUF IST EINE ANDERE ACHSE ALS FREIGABE. Die eine fragt, ob eingekauft
werden durfte, die andere, ob es ueberhaupt Ware war. Ein Stromvertrag ist weder
freigegeben noch Fremdeinkauf — er gehoert nicht in diese Auswertung.';

COMMENT ON COLUMN mart.fremdeinkauf.wareneinkauf IS
'true = Ware (Speisen, Getraenke, Hygiene, Kaffee). false = Strom, Leasing,
Finanzamt, Kartengebuehren, Konzerninnenumsatz. NULL = noch nicht eingeordnet.
Gepflegt in manual.lieferant_art. Ohne Filter auf true ist jede Fremdeinkaufszahl
zu hoch.';

COMMENT ON COLUMN mart.fremdeinkauf.lieferant_art IS
'Warum eine Rechnung kein Wareneinkauf ist: zahlungsdienst, bank_leasing,
konzern, energie, handwerk_bau, behoerde, marketing_plattform, dienstleistung,
miete. NULL = noch nicht eingeordnet.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0058', to_jsonb(
        'Belegarchiv nutzbar gemacht: 37 Schreibweisen auf Dachnamen (allein '
        'Chefs Culinar zwoelfmal), manual.lieferant_art trennt Wareneinkauf von '
        'Strom/Leasing/Finanzamt, 124 unglaubhafte Betraege ueber 1 Mio EUR auf '
        'NULL. Der Zahlenfehler kam von LINA: nettoBetrag liefert Cent mal 10^6.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
