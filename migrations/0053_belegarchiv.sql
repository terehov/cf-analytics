-- =====================================================================
-- 0053 Belegarchiv — strukturierte Buchhaltung ohne eine einzige PDF-Datei
--
-- ANLASS (11.08.2026, aus der Erhebung docs/lina-api-inventar-ladenakte.md):
-- "Das ist strukturierte Buchhaltung, kein PDF-Haufen. Die Belege sind per
-- OCR erschlossen, tragen Lieferant, Kreditorenkonto, Sachkonto,
-- MwSt-Aufteilung und DATEV-GUID. Fuer Auswertungen heisst das: die
-- Metadaten allein sind auswertbar, ohne eine einzige PDF-Datei zu laden."
--
-- Vollzaehlig gemessen am 11.08.2026 ueber alle 131 Betriebe der Ladenakte,
-- 0 Fehler: 593.314 Belege in acht gezaehlten Ordnern. 109 Betriebe tragen
-- Dokumente, 22 sind leer (Testlaeden, Neueroeffnungen, Ghost-Kitchen-
-- Huellen). Groesster Einzelbestand Aposto Mainz mit 19.835.
--
-- ---------------------------------------------------------------------
-- WOHER DIE DATEN KOMMEN — UND WOHER NICHT
--
-- HER:  GET /intranet/ladenakte/beleglist?admin=1&storeId=<tok>&typeId=<n>
--       &draw=1&start=0&length=200 — DataTables-JSON, also
--       {data, recordsTotal, recordsFiltered}. Weg A der Erhebung: je
--       Betrieb, OHNE Mandantenwechsel. 131 Betriebe x 14 Ordner.
--
-- NICHT: Weg B (/finanzen/document/filelistByBelegart) liefert mehr Felder
--       — lineItems, lineItemsSum, seller_ustid, is_xrechnung, exported,
--       ust14_valid. Er ist an den im Kopf gewaehlten Mandanten gebunden
--       und kostete 131 Mandantenwechsel. Entscheidung des Nutzers vom
--       11.08.2026: Weg A. Diese Felder stehen also NICHT zur Verfuegung,
--       und keine Spalte hier tut so, als gaebe es sie.
--
-- NICHT: der LOHN-ZWEIG des Belegarchivs (Ausweisdokumente 3980,
--       Geburtsurkunden 4004, Krankmeldungen 13, Pfaendungen 3986,
--       Aufenthaltserlaubnisse 3981, Lohnabrechnungen 3959-3961). Kein
--       Platz im Schema, und core.belegart kennt keine einzige Zeile
--       dafuer — siehe Falle 1.
--
-- NICHT: die Dateien selbst. Rund 500.000 PDFs, etwa 100 GB, gut elf Tage
--       Laufzeit. encrypted_id haelt den Weg dorthin offen, ohne ihn zu
--       bauen; ob der Schluessel ueberhaupt stabil ist, ist ungemessen
--       (Falle 4).
--
-- ---------------------------------------------------------------------
-- DIE FALLEN, DURCHNUMMERIERT
--
-- 1. DER LOHN-ZWEIG DARF NICHT AUS VERSEHEN HEREINLAUFEN. Eine
--    Positivliste im Code ist eine Zeile, die jemand aendern kann, ohne
--    dass es auffaellt. Deshalb steht die Grenze IM SCHEMA:
--    core.belegart traegt genau die 14 FiBu-Ordner, alle mit
--    zweig = 'fibu', und core.buchungsbeleg.typ_id ist ein NOT-NULL-
--    Fremdschluessel darauf. Ein Lohn-typeId hat dort keine Zeile und
--    bricht den Insert LAUT ab, statt still Personalakten anzulegen.
--    Das ist die einzige Stelle dieser Migration, an der ein Quellwert
--    ueberhaupt gegen eine Tabelle geprueft wird — vertretbar, weil der
--    Wertevorrat geschlossen, geseedet und an allen 131 Betrieben
--    identisch gemessen ist (Erhebung 7.5: eine einzige
--    Ordner-Kombination, kein Fehlschlag).
--
-- 2. 593.314 IST EINE UNTERGRENZE, KEIN SOLLBESTAND. Die Erhebung hat
--    ACHT der vierzehn typeId gezaehlt (1, 2, 3, 5, 3970, 3974, 3975,
--    3977). Fuer die sechs uebrigen — 16 sonstige Dokumente, 3968
--    sonstige Auswertungen, 3969 USt-Voranmeldungen, 3971 Mahnungen,
--    3972 Steuerunterlagen, 3976 OPOS-Listen — gibt es KEINEN Sollwert.
--    Nachgerechnet am 11.08.2026: 1.048 von 1.834 (Betrieb, typeId)-
--    Paaren sind gezaehlt, davon 621 groesser null und 427 nachweislich
--    leer. Genau deshalb liegt manual.belegarchiv_soll LANG und nicht
--    breit: nur so ist "nicht gezaehlt" als FEHLENDE ZEILE ausdrueckbar
--    und von "gezaehlt und leer" (Zeile mit 0) unterscheidbar. Breit
--    stuende dort entweder eine 0, die etwas behauptet, oder eine
--    Spalte, die es nicht gibt. Die Zahl 593.314 steht in AGENTS.md und
--    in drei docs-Dateien als GESAMTZAHL — das gehoert nach
--    docs/lina-api-korrekturen.md.
--
-- 3. DIE BEDEUTUNG VON taxItems UND nettoBetragTax IST NICHT GEMESSEN.
--    Die Erhebung nennt nettoBetragTax an einer Stelle "netto/7/0"
--    (Abschnitt 7.3), die Messung zeigt "183.53/0.00/0.00" neben einem
--    nettoBetrag von "183,50" — drei Cent, die niemand erklaert hat. Ob
--    taxItems Nettobetraege je Satz oder Steuerbetraege enthaelt, ist
--    offen. DESHALB heisst die Spalte in core.buchungsbeleg_steuer
--    schlicht betrag und nicht steuer oder netto_je_satz: der
--    Spaltenname waere die Deutung, und eine falsche Deutung im
--    Spaltennamen ueberlebt jede Refaktorierung. nettoBetragTax bleibt
--    daneben als netto_split_roh unzerlegt stehen.
--    Aus demselben Grund werden cost_account, cost_account7 und
--    cost_account0 FLACH als sachkonto, sachkonto_7 und sachkonto_0
--    uebernommen und NICHT zeilenweise mit einem Steuersatz gepaart.
--    Dass die unbenannte Hauptspalte 19 Prozent meint, ist plausibel
--    und ungemessen; eine Paarung waere eine Vermutung in 600.000 bis
--    900.000 Zeilen. Die Vermutung steht stattdessen in
--    mart.buchungsbeleg_konto, wo sie eine Zeile Sicht kostet und
--    keine Migration. Die Gegenprobe (Summe der Saetze gegen netto)
--    laeuft in mart.belegarchiv_pruefung mit und beantwortet die Frage
--    nach dem ersten Lauf von selbst.
--
-- 4. encrypted_id KOENNTE JE ANFRAGE NEU GESALZEN SEIN. Die Ladenakte
--    fuehrt drei Tokenarten, zwei davon je Anfrage neu gesalzen
--    (storeId 86 hex, laden 84 hex). Ob encryptedId dazugehoert, ist
--    NICHT gemessen. Deshalb kein UNIQUE darauf: waere er gesalzen,
--    braechte ein UNIQUE den Backfill mittendrin zum Abbruch, und ein
--    Upsert darauf legte bei jedem Lauf 593.314 neue Zeilen an. Vor der
--    Planung von Stufe 2 (Dateien) messen: dieselbe Seite zweimal holen
--    und die beiden encryptedId vergleichen.
--
-- 5. DIE LINA-ID KOENNTE NUR JE MANDANT EINDEUTIG SEIN. parashift_id hat
--    die Form "<ladenid>_<belegid>" — man setzt keinen Praefix vor eine
--    bereits eindeutige Zahl. Der Upsert-Schluessel ist deshalb
--    (betrieb_key, lina_id) und nicht (lina_id). Ein globaler
--    Schluessel scheiterte im Zweifel LEISE: ein ON CONFLICT DO UPDATE
--    ueberschriebe den Beleg eines fremden Betriebs, und das Ergebnis
--    saehe plausibel aus. typ_id gehoert AUSDRUECKLICH NICHT in den
--    Schluessel — ein in einen anderen Ordner umgelegter Beleg wuerde
--    sonst dupliziert. Ob die id doch global eindeutig ist, misst
--    mart.belegarchiv_pruefung nach dem ersten vollen Lauf.
--
-- 6. WER DIE DEUTSCHE ZAHL NICHT LESEN KANN, SCHREIBT NULL — NIE 0.
--    nettoBetrag kommt als Text ("183,50"). Ein Parser, der bei einem
--    unerwarteten Format 0 schreibt, erzeugt eine Rechnung ueber null
--    Euro, und die summiert sich klaglos mit. NULL summiert sich nicht.
--    mart.belegarchiv_pruefung zaehlt netto IS NULL bei
--    parashift_status = 'done' — dort ist NULL der Verdachtsfall,
--    ueberall sonst der Normalfall.
--
-- 7. IST UND SOLL KOENNTEN VERSCHIEDENES ZAEHLEN. Die Belegliste kennt
--    showArchived. Ob die Zaehlung vom 11.08.2026 mit oder ohne
--    archivierte Belege lief, steht nirgends. Laeuft der Abzug anders
--    als die Zaehlung, weicht mart.belegarchiv_fehlend systematisch ab
--    — und zwar plausibel, niemand sieht einer Differenz von drei
--    Prozent an, dass sie eine Flagge ist. Deshalb traegt
--    core.belegarchiv_bestand die Spalte archivierte_enthalten und
--    core.buchungsbeleg die Spalte archiviert. Der Sollwert selbst
--    traegt die Angabe nicht; das bleibt offen.
--
-- 8. DER BESTAND WAECHST WAEHREND DES ABZUGS. Gemessen ist
--    order[0][dir]=desc. Absteigend sortiert verschiebt jeder waehrend
--    des Laufs hochgeladene Beleg das gesamte Seitenraster um eine
--    Position — das erzeugt LUECKEN, nicht nur Dubletten. Der Upsert
--    ist idempotent, core.belegarchiv_bestand haelt jede Zaehlung mit
--    ihrem gemessen_am, und mart.belegarchiv_fehlend zeigt die
--    Differenz. Vollstaendigkeit sichert aber erst eine AUFSTEIGENDE
--    Sortierung, und welche column-Nummer aufsteigend nach ID sortiert,
--    ist nicht gemessen. Das gehoert vor den ersten Abzug gemessen.
--
-- 9. ZWEI BEDEUTUNGEN VON BELEG. mart.einkauf_beleg ist seit 0045 der
--    FoodNotify-Bestellkopf mit Rechnung; core.buchungsbeleg ist ein
--    DOKUMENT im LINA-Belegarchiv. Beide tragen Lieferant und Betrag,
--    beide heissen Beleg, und beide stehen in Metabase nebeneinander.
--    Dieselbe Falle wie Artikel/Rezept/Ware in AGENTS.md, dieselbe
--    Behandlung: ein COMMENT an beiden Tabellen, der auf die andere
--    zeigt, und eine Zeile in der Namenskonvention.
--
-- 10. VERKAEUFER IST NICHT GLEICH LIEFERANT. seller_name ist auf einer
--    Eingangsrechnung (typ_id 1) der Lieferant, auf einer
--    Ausgangsrechnung (typ_id 2) der eigene Betrieb. Die Spalte heisst
--    deshalb verkaeufer_name. Zusaetzlich kommt der Name aus der OCR
--    und ist freier Text — dieselbe Firma steht dort in mehreren
--    Schreibweisen. Wer je Betrieb gruppieren will, gruppiert nach
--    kreditor_konto; konzernweit geht das NICHT, weil
--    kreditor_account eine DATEV-Kreditorennummer je Buchungskreis ist
--    und 70001 in Mainz etwas anderes bedeutet als in Karlsruhe. Der
--    konzernweite Weg laeuft ueber manual.kreditor_gruppe.
--
-- 11. DER BELEGWARENEINSATZ IST RECHNUNGSVOLUMEN, NICHT VERBRAUCH. Weg A
--    liefert kein Brutto und keine lineItems. Bestandsveraenderungen,
--    Bruch und Schwund fehlen, Skonti und Boni stehen auf eigenen
--    Konten. Er ist damit NICHT dasselbe wie die BWA-Zeile
--    "Wareneinsatz" und darf in keiner Karte so beschriftet werden.
--    Der Satz steht im Kommentar von mart.wareneinsatz_beleg_monat;
--    wer die Zahl weitergibt, gibt den Satz mit.
--
-- 12. GESCHLOSSENE UND VERWALTENDE HAEUSER TRAGEN VOLLE HISTORIE. 34
--    geschlossene und insolvente Gesellschaften mit zusammen 42.413
--    Belegen, 17 Franchisegebergesellschaften mit 27.609. Fuer
--    Zeitreihen ein Gewinn, fuer jeden Betriebsvergleich und jeden
--    Mittelwert eine Falle. Jede Sicht hier traegt deshalb
--    betrieb_status und operativ aus mart.betrieb_status und filtert
--    NICHT selbst — dieselbe Bauform wie mart.bewertung_thema.
--
-- 13. PERSONENBEZUG. hochgeladen_von_name (uploadedByName) und
--    zuordnung_ma_name (zuordnungMaName) sind Klarnamen von
--    Beschaeftigten, ueber 593.314 Belege hinweg mit Zeitstempel. Die
--    Sperre wurde am 11.08.2026 aufgehoben (Commit 589e6d0), und fuer
--    Rechnungsmetadaten ist das unproblematisch. Eine mart-Sicht, die
--    nach diesen Spalten GRUPPIERT und zaehlt, waere aber eine
--    Leistungsauswertung. Keine der Sichten hier tut das; in
--    mart.buchungsbeleg stehen sie als Attribut der Einzelzeile. Wer
--    das aendert, fragt vorher. Dieselben Namen stehen zusaetzlich in
--    raw.api_antwort, die append-only ist — eine Loeschauskunft waere
--    dort nur durch Wegwerfen einer ganzen Monatspartition zu
--    bedienen. Gehoert nach docs/entscheidungen.md, BEVOR der Abzug
--    laeuft.
--
-- 14. DIE UMKEHRUNG, DIE BENANNT WERDEN MUSS. migrations/0002_stammdaten
--    .sql nimmt bei core.lieferant die Felder kreditor, gegenkonto,
--    gegenkonto7 und gegenkonto0 unter der Ueberschrift "HIER GILT
--    DATENMINIMIERUNG" bewusst NICHT auf. Genau diese vier Felder
--    werden hier importiert. Das ist keine Aufweichung der Regel,
--    sondern ein anderer Zweck: dort waren es Kontaktdaten von 540
--    Geschaeftspartnern ohne Verwendung, hier sind sie die Buchungs-
--    achse der Kostenkontenauswertung. Die alte Begruendung gilt
--    weiter, wo sie gilt. Gehoert nach docs/entscheidungen.md.
--
-- ---------------------------------------------------------------------
-- ENTSCHIEDENE WIDERSPRUECHE (die drei Urteile waren sich uneins)
--
-- (a) STEUER UND SACHKONTO IN EINER KINDZEILE (Entwurf 2) gegen FLACHE
--     SPALTEN PLUS EIGENER STEUERTABELLE (Entwurf 1/3). Entschieden fuer
--     flach plus getrennte Steuertabelle. Die Paarung Satz-zu-Konto ist
--     ungemessen (Falle 3); sie als Koernung einer Faktentabelle
--     festzuschreiben, macht aus einer Vermutung eine Struktur, und eine
--     Zeile daraus sieht in sich vollstaendig stimmig aus. Der Preis ist
--     die schlechtere Abfragbarkeit der Kostenkonten — den bezahlt
--     mart.buchungsbeleg_konto, wo dieselbe Vermutung korrigierbar ist.
--
-- (b) BELEGART ALS DIMENSION (Entwurf 2) gegen NUR EIN TEXTFELD
--     (Entwurf 3). Entschieden fuer beides: core.belegart existiert als
--     geseedete 14-Zeilen-Dimension und traegt die Lohn-Sperre, aber der
--     Fremdschluessel laeuft ueber typ_id text und nicht ueber einen
--     Surrogatschluessel. Damit gibt es keine Aufloesung im Ladeweg, die
--     ein Neuaufbau aus raw anders vergeben koennte, und der Ordnerfilter
--     kostet in keiner Abfrage einen Join.
--
-- (c) SOLLBESTAND BREIT WIE DIE CSV gegen LANG. Entschieden fuer BEIDES,
--     weil die beiden Formen Verschiedenes koennen:
--     manual.belegarchiv_zaehlung ist die CSV 1:1 mit dem CHECK auf die
--     Summenspalte (131 literal geseedete Zeilen, am 11.08.2026 in allen
--     131 gegengerechnet), manual.belegarchiv_soll ist die lange Form,
--     die "nicht gezaehlt" als fehlende Zeile ausdruecken kann. Die lange
--     wird IN DIESER MIGRATION aus der breiten abgeleitet — die Zuordnung
--     Spalte-zu-typeId steht damit genau einmal und sichtbar hier, statt
--     als CASE in jeder Sicht.
--
-- ---------------------------------------------------------------------
-- WAS DER LADER TUN MUSS, WAS DAS SCHEMA NICHT ERZWINGEN KANN
--
--  * raw.api_antwort.betrieb_enc_id MITSCHREIBEN, und zwar
--    core.betrieb.enc_id — NICHT den gesalzenen storeId-Token. Der Index
--    (betrieb_enc_id, endpunkt, abgerufen_am DESC) aus 0003 ist der
--    einzige Weg, die Rohantworten eines Betriebs spaeter wiederzufinden.
--    Ohne diese Zuweisung ist "ohne erneuten Abruf reparieren" ein Full
--    Scan.
--  * DEN GESALZENEN TOKEN AUS parameter MASKIEREN. storeId ist 86 hex und
--    je Anfrage neu gesalzen: er macht den Aufruf nicht reproduzierbar,
--    nur unvergleichbar, und 3.800 Zugangstoken in einer append-only
--    Tabelle sind das Gegenteil von Regel 2. Geschrieben wird
--    {"linaBetriebId":"15","typeId":"1","start":"0","length":"200",
--    "storeId":"<gesalzen>"}. Das ist eine Abweichung vom bestehenden
--    COMMENT an raw.api_antwort.parameter ("Macht jeden Aufruf
--    reproduzierbar") und gehoert nach docs/entscheidungen.md. Belegt,
--    dass die Ordnungsschluessel reichen: 0043 hat 13.254 Positionen
--    ueber parameter->>'orderId' aus raw neu gerechnet.
--  * zusatz DURCH LOESCHEN der gemappten Schluessel bilden, nicht durch
--    Auswahl einer Restliste. Sonst verschwindet ein neues LINA-Feld
--    still.
--  * netto: nicht parsebar -> NULL, niemals 0 (Falle 6).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Die 14 FiBu-Ordner — und die Grenze des Vorhabens im Schema
--
-- Die Dimension ist der Grund, warum ein Lohn-typeId hier nicht
-- hereinlaufen kann (Falle 1). Sie traegt zugleich die Bruecke zur
-- Zaehlung: csv_spalte und hat_soll sagen, fuer welche acht Ordner es
-- ueberhaupt einen Sollwert gibt.
--
-- Der PK ist ein Surrogat, weil die Hausregel es so will; GEJOINT WIRD
-- ABER UEBER typ_id. Das ist Absicht: ein Neuaufbau der Tabelle vergaebe
-- andere Surrogate, waehrend typ_id LINAs eigener, stabiler Code bleibt.
-- ---------------------------------------------------------------------
CREATE TABLE core.belegart (
    belegart_key  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    typ_id        text        NOT NULL UNIQUE,
    name          text        NOT NULL,
    zweig         text        NOT NULL DEFAULT 'fibu',
    csv_spalte    text,
    hat_soll      boolean     NOT NULL DEFAULT false,
    reihenfolge   smallint    NOT NULL,
    angelegt_am   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.belegart IS
'Die 14 Belegordner, die die Ladenakte je Betrieb fuehrt — LINAs typeId als Dimension.
Strukturell gemessen am 11.08.2026: alle 131 Betriebe haben dieselben 14 Ordner, keine
Ausnahme, kein Fehlschlag (Erhebung 7.5).
DIESE TABELLE IST DIE SPERRE GEGEN DEN LOHN-ZWEIG. Ausweisdokumente (3980),
Geburtsurkunden (4004), Krankmeldungen (13), Pfaendungen (3986) und Lohnabrechnungen
(3959-3961) haben hier KEINE Zeile; core.buchungsbeleg.typ_id ist ein NOT-NULL-
Fremdschluessel darauf und bricht bei einem Lohn-typeId laut ab. Wer den Lohn-Zweig
importieren will, braucht dafuer eine eigene Entscheidung ueber Zweck, Rechtsgrundlage
und Aufbewahrung — und muss diese Zeile bewusst hinzufuegen.';

COMMENT ON COLUMN core.belegart.typ_id IS
'LINAs typeId als text und nicht als Zahl (Fremd-ID-Regel, Begruendung in 0044). Der
tragende Schluessel: alle Fakten und Sichten joinen hierueber, nicht ueber belegart_key.';
COMMENT ON COLUMN core.belegart.zweig IS
'Bei allen 14 Zeilen ''fibu''. Kein CHECK — der Wert dokumentiert die Positivliste, er
erzwingt sie nicht; das tut die Abwesenheit der Lohn-Zeilen.';
COMMENT ON COLUMN core.belegart.hat_soll IS
'true bei genau acht der vierzehn. Fuer die sechs anderen hat die Erhebung vom 11.08.2026
nicht gezaehlt — dort gibt es in manual.belegarchiv_soll keine Zeile, und
mart.belegarchiv_fehlend weist das als soll_bekannt = false aus statt als Vollstaendigkeit.';

INSERT INTO core.belegart (typ_id, name, csv_spalte, hat_soll, reihenfolge) VALUES
  ('1',    'Eingangsrechnungen und Avise',            'eingangsrechnungen',   true,  1),
  ('5',    'Kassenbelege',                            'kassenbelege',         true,  2),
  ('2',    'Ausgangsrechnungen',                      'ausgangsrechnungen',   true,  3),
  ('3977', 'Kontoauszüge / Saldenbestätigungen',      'kontoauszuege',        true,  4),
  ('3',    'Inventur und Bruchlisten',                'inventur_bruchlisten', true,  5),
  ('3975', 'Susa',                                    'susa',                 true,  6),
  ('3974', 'BWA',                                     'bwa',                  true,  7),
  ('3970', 'Lieferscheine',                           'lieferscheine',        true,  8),
  ('16',   'sonstige Dokumente',                      NULL,                   false, 9),
  ('3968', 'sonstige Auswertungen',                   NULL,                   false, 10),
  ('3969', 'USt-Voranmeldungen',                      NULL,                   false, 11),
  ('3971', 'Mahnungen',                               NULL,                   false, 12),
  ('3972', 'Steuerunterlagen',                        NULL,                   false, 13),
  ('3976', 'OPOS-Listen',                             NULL,                   false, 14);


-- ---------------------------------------------------------------------
-- Der Beleg selbst
--
-- Eine Zeile je Dokument. Jedes Feld der DataTables-Antwort, das wir
-- kennen, bekommt genau eine Spalte; alles Uebrige faellt nach zusatz.
-- Nichts wird beim Laden zusammengefasst, umgerechnet oder auf einen
-- Wertevorrat festgenagelt.
--
-- Der einzige Fremdschluessel auf einen ABGELEITETEN Wert waere die
-- Betriebszuordnung — und die steht fest, BEVOR die Anfrage gestellt
-- wird, weil betriebsweise geblaettert wird. Es gibt in diesem Ladeweg
-- keine Stelle, an der ein Quellwert erst zu einem Schluessel aufgeloest
-- werden muss; genau dort haengen sonst 12.000 Belege still am falschen
-- Objekt.
-- ---------------------------------------------------------------------
CREATE TABLE core.buchungsbeleg (
    buchungsbeleg_key      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    betrieb_key            integer     NOT NULL REFERENCES core.betrieb(betrieb_key),
    lina_betrieb_id        integer     NOT NULL,
    typ_id                 text        NOT NULL REFERENCES core.belegart(typ_id),
    lina_id                text        NOT NULL,
    encrypted_id           text,
    beleg_datum            date,
    leistungs_datum        date,
    re_nummer              text,
    netto                  numeric(14,2),
    netto_split_roh        text,
    belegart_roh           text,
    belegart_name          text,
    zuordnung_fibu         smallint,
    verkaeufer_name        text,
    verkaeufer_id          text,
    kreditor_konto         text,
    sachkonto              text,
    sachkonto_7            text,
    sachkonto_0            text,
    datev_guid             text,
    parashift_status       text,
    parashift_id           text,
    hochgeladen_von_hash   text,
    hochgeladen_von_name   text,
    hochgeladen_am         timestamptz,
    zuordnung_ma           text,
    zuordnung_ma_name      text,
    heruntergeladen_am     timestamptz,
    hochgeladen_aus_bereich text,
    archiviert             boolean     NOT NULL DEFAULT false,
    datei_name             text,
    dateiendung            text,
    zusatz                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
    raw_id                 bigint,
    erstmals_am            timestamptz NOT NULL DEFAULT now(),
    zuletzt_am             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT buchungsbeleg_uq UNIQUE (betrieb_key, lina_id)
);

COMMENT ON TABLE core.buchungsbeleg IS
'Belegmetadaten aus dem FiBu-Zweig der LINA-Ladenakte, eine Zeile je Dokument
(GET /intranet/ladenakte/beleglist, Weg A). Traegt Lieferant, Kreditorenkonto,
Sachkonto, MwSt-Aufteilung, DATEV-GUID und den Bar/Kueche-Split AN DER RECHNUNG —
damit ist die Buchhaltung auswertbar, ohne eine einzige PDF-Datei zu laden.

MENGE: 593.314 Belege, vollzaehlig gezaehlt am 11.08.2026 ueber alle 131 Betriebe,
0 Fehler. Das ist eine UNTERGRENZE: gezaehlt wurden acht der vierzehn Ordner.
Verteilung der gezaehlten: Eingangsrechnungen 394.552, Kassenbelege 149.748,
Ausgangsrechnungen 20.755, Kontoauszuege 13.494, Inventur/Bruchlisten 7.279,
Susa 4.049, BWA 2.895, Lieferscheine 542.

NICHT VERWECHSELN MIT mart.einkauf_beleg (Migration 0045): das ist der
FoodNotify-Bestellkopf mit Rechnung. Hier steht ein DOKUMENT aus LINAs Archiv.
Beide tragen Lieferant und Betrag und stehen in Metabase nebeneinander.

DER LOHN-ZWEIG IST AUSGENOMMEN und kann ueber den Fremdschluessel auf
core.belegart auch nicht hereinlaufen.

NICHT PARTITIONIERT: 593.314 Zeilen sind fuer Postgres klein, und
core.partition_anlegen() kennt nur die Datumsspalten abgerufen_am und
geschaeftstag — eine Tabelle mit beleg_datum bekaeme still einen BRIN auf eine
nicht existierende Spalte.

Lesen ueber mart.buchungsbeleg; dort sind die Namen aufgeloest und die leeren
Zeichenketten zu NULL normalisiert.';

COMMENT ON COLUMN core.buchungsbeleg.buchungsbeleg_key IS
'bigint und nicht integer: jeder ON-CONFLICT-Versuch verbraucht einen Identity-Wert,
auch wenn er die Zeile nur aktualisiert — bei jedem Vollabzug also 593.314 Stueck.
Vorbild core.bestellposition (0030).';
COMMENT ON COLUMN core.buchungsbeleg.lina_betrieb_id IS
'BEWUSST REDUNDANT zu betrieb_key. Zwei Gruende: es ist der Anfrageparameter, und es ist
die Gegenprobe zu split_part(parashift_id, ''_'', 1) — damit prueft LINAs eigene
ID-Zusammensetzung unsere Betriebszuordnung und nicht umgekehrt. Die Probe laeuft in
mart.belegarchiv_pruefung. Kostet rund 2,4 MB.';
COMMENT ON COLUMN core.buchungsbeleg.typ_id IS
'Der ANGEFORDERTE Ordner, nicht das Feld belegart des Satzes. Fremdschluessel auf
core.belegart — die Sperre gegen den Lohn-Zweig. Ob beide uebereinstimmen, vergleicht
mart.belegarchiv_pruefung.';
COMMENT ON COLUMN core.buchungsbeleg.lina_id IS
'LINAs interne id, als text und nicht als Zahl (Fremd-ID-Regel, Begruendung in 0044:
ein Ausreisser soll nicht die ganze Transaktion abbrechen). Zusammen mit betrieb_key der
Upsert-Schluessel; typ_id gehoert bewusst NICHT dazu, sonst dupliziert ein in einen
anderen Ordner umgelegter Beleg.';
COMMENT ON COLUMN core.buchungsbeleg.encrypted_id IS
'Downloadschluessel fuer GET /intranet/ladenakte/getBeleg — der Weg zu Stufe 2 (Dateien).
OB ER STABIL IST, IST AM 11.08.2026 NICHT GEMESSEN: zwei der drei Tokenarten der Ladenakte
sind je Anfrage neu gesalzen. Deshalb KEIN UNIQUE und kein Upsert darauf. Vor Stufe 2
messen, sonst ist der Metadatenabzug als Downloadvorbereitung wertlos.';
COMMENT ON COLUMN core.buchungsbeleg.re_nummer IS
'reNumber, haeufig LEERE ZEICHENKETTE und nicht NULL. In core absichtlich nicht
normalisiert (der Rohwert ist der Beleg); IS NULL findet sie deshalb nicht.
mart.buchungsbeleg macht daraus mit nullif() ein NULL.';
COMMENT ON COLUMN core.buchungsbeleg.netto IS
'Aus der deutschen Zahl "183,50". NULL heisst "nicht lesbar oder nicht vorhanden" und
NIEMALS 0 — eine 0-Euro-Rechnung summiert sich klaglos mit, eine NULL nicht. Verdachtsfall
ist NULL bei parashift_status = ''done''; mart.belegarchiv_pruefung zaehlt genau das.';
COMMENT ON COLUMN core.buchungsbeleg.netto_split_roh IS
'nettoBetragTax VERBATIM und unzerlegt, gemessen "183.53/0.00/0.00". Welcher Teil zu
welchem Steuersatz gehoert, ist am 11.08.2026 NICHT gemessen — die Doku nennt es
"netto/7/0", die Messung zeigt drei Cent Abstand zum nettoBetrag "183,50", den niemand
erklaert hat. Drei benannte Spalten daraus zu machen hiesse, den Spaltennamen zur Deutung
zu machen; eine falsche Deutung im Spaltennamen ueberlebt jede Refaktorierung.';
COMMENT ON COLUMN core.buchungsbeleg.belegart_roh IS
'Das Feld belegart AM SATZ, nicht der Ordner. Als text, kein CHECK. Existiert allein fuer
die Gegenprobe gegen typ_id in mart.belegarchiv_pruefung.';
COMMENT ON COLUMN core.buchungsbeleg.zuordnung_fibu IS
'0 sonstiges, 1 Bar, 2 Kueche — der Wareneinsatz-Split AN DER RECHNUNG, unabhaengig von
Artikelpflege und PLU-Nummernraum. Damit ist der offene Posten C1 ueber eine dritte,
von FoodNotify und fixer_we unabhaengige Quelle angreifbar. KEIN CHECK: 0/1/2 sind
gemessen, ein kuenftiger Code 3 waere es nicht, und ein CHECK braechte dann 12.000 Belege
eines Betriebs zum Abbruch. Das Klartextlabel baut mart.buchungsbeleg.';
COMMENT ON COLUMN core.buchungsbeleg.verkaeufer_name IS
'seller_name. NICHT Lieferant nennen: auf einer Ausgangsrechnung (typ_id 2) ist das der
eigene Betrieb. Kommt aus der OCR und ist freier Text — dieselbe Firma steht in mehreren
Schreibweisen. Fuer eine Gruppierung je Betrieb kreditor_konto nehmen, konzernweit
mart.kreditor_konzern.';
COMMENT ON COLUMN core.buchungsbeleg.verkaeufer_id IS
'seller_id als text. MANDANTENGEBUNDEN, soweit gemessen: ob LINA sie konzernweit oder je
Laden vergibt, ist am 11.08.2026 NICHT geprueft. Ueber Betriebe hinweg deshalb NICHT
gruppieren — dieselbe id kann in zwei Haeusern zwei Firmen meinen.';
COMMENT ON COLUMN core.buchungsbeleg.kreditor_konto IS
'kreditor_account, als text wegen fuehrender Nullen. Eine DATEV-Kreditorennummer gilt JE
BUCHUNGSKREIS: 70001 bedeutet in Mainz etwas anderes als in Karlsruhe. Der belastbare
Gruppierungsschluessel INNERHALB eines Betriebs, konzernweit unbrauchbar.';
COMMENT ON COLUMN core.buchungsbeleg.sachkonto IS
'cost_account, ohne Steuersatz im Namen. Dass die unbenannte Hauptspalte 19 Prozent meint,
ist plausibel und UNGEMESSEN — deshalb steht die Vermutung in mart.buchungsbeleg_konto
und nicht hier. Die Bezeichnung zur Nummer pflegt manual.sachkonto.';
COMMENT ON COLUMN core.buchungsbeleg.sachkonto_7 IS
'cost_account7. Die Ziffer ist LINAs eigener Feldname, keine Zusicherung von uns.';
COMMENT ON COLUMN core.buchungsbeleg.sachkonto_0 IS
'cost_account0. Die Ziffer ist LINAs eigener Feldname, keine Zusicherung von uns.';
COMMENT ON COLUMN core.buchungsbeleg.parashift_status IS
'Der OCR-Stand (gemessen u.a. ''done''). Entscheidet, ob netto, Verkaeufer und Konten
ueberhaupt belastbar sind. Freier Text, KEIN CHECK — bei core.bestellung.status ist genau
das danebengegangen ("[object Object]" ueber 44.271 Bestellungen, 0043).';
COMMENT ON COLUMN core.buchungsbeleg.parashift_id IS
'Form "<ladenid>_<belegid>". Traegt die einzige Gegenprobe, die von der QUELLE kommt:
split_part(parashift_id, ''_'', 1) gegen lina_betrieb_id.';
COMMENT ON COLUMN core.buchungsbeleg.hochgeladen_von_name IS
'uploadedByName — KLARNAME einer beschaeftigten Person. Zulaessig seit 11.08.2026 (Commit
589e6d0) und fuer Rechnungsmetadaten unproblematisch. Eine Auswertung, die nach dieser
Spalte GRUPPIERT und zaehlt, ist eine Leistungsauswertung; keine mart-Sicht tut das.';
COMMENT ON COLUMN core.buchungsbeleg.zuordnung_ma_name IS
'zuordnungMaName — KLARNAME. Es gilt derselbe Satz wie bei hochgeladen_von_name.';
COMMENT ON COLUMN core.buchungsbeleg.heruntergeladen_am IS
'NULL heisst: nie heruntergeladen. Das ist eine Aussage, kein fehlender Wert.';
COMMENT ON COLUMN core.buchungsbeleg.archiviert IS
'Aus archived (0/1). Faktisch dauerhaft false, solange der Abzug ohne showArchived laeuft
— und ob LINAs recordsTotal die archivierten mitzaehlt, ist NICHT gemessen. Genau daran
haengt Falle 7: eine Dauerdifferenz in mart.belegarchiv_fehlend, die kein Fehler ist und
der nach zwei Wochen niemand mehr glaubt.';
COMMENT ON COLUMN core.buchungsbeleg.zusatz IS
'Alle Felder des Quellsatzes, die dieser Lader nicht kennt: die *Time-Zwillinge der
Datumsfelder, zuordnungFibuName, downloadedOnTime und was LINA kuenftig ergaenzt.
GEBILDET DURCH LOESCHEN der gemappten Schluessel aus dem Quellsatz, NICHT durch Auswahl
einer Restliste — nur so landet ein NEUES Feld automatisch hier, statt still zu
verschwinden. Auch taxItems wird geloescht: es steht in core.buchungsbeleg_steuer.
Welche Schluessel wie oft vorkommen, zaehlt mart.buchungsbeleg_zusatzfelder; ein neuer
Schluessel heisst "LINA hat ergaenzt", ein verschwundener heisst "das Feld ist weg".';
COMMENT ON COLUMN core.buchungsbeleg.raw_id IS
'Ohne Fremdschluessel: raw.api_antwort ist partitioniert und hat PK (id, abgerufen_am).';

CREATE INDEX ON core.buchungsbeleg (betrieb_key, typ_id, beleg_datum);
CREATE INDEX ON core.buchungsbeleg (betrieb_key, kreditor_konto) WHERE kreditor_konto IS NOT NULL;
CREATE INDEX ON core.buchungsbeleg (datev_guid) WHERE datev_guid IS NOT NULL;
CREATE INDEX ON core.buchungsbeleg USING brin (beleg_datum) WITH (autosummarize = on);

-- Der BRIN steht hier MIT VORBEHALT. Das Merkblatt empfiehlt ihn; er lebt
-- aber von physischer Korrelation, und geschrieben wird BETRIEBSWEISE ueber
-- je vierzehn Jahre Historie. Ueber die Tabelle hinweg ist die Korrelation
-- damit nahe null. Er kostet unter 100 kB und bleibt drin — planen sollte
-- niemand auf ihn, der tragende Index ist (betrieb_key, typ_id, beleg_datum).


-- ---------------------------------------------------------------------
-- taxItems, lang statt breit
--
-- Getrennte Tabelle und keine drei Spalten: der Bestand reicht bis 2009
-- zurueck, und von Juli bis Dezember 2020 galten in Deutschland 16 und 5
-- Prozent. Ein festes Schema {0, 7, 19} — ob als Spalten oder als jsonb
-- mit erwarteten Schluesseln — wuerde genau diese Belege still verlieren.
-- Deshalb ein CHECK auf den WERTEBEREICH und nicht auf eine Aufzaehlung.
-- ---------------------------------------------------------------------
CREATE TABLE core.buchungsbeleg_steuer (
    buchungsbeleg_key bigint       NOT NULL REFERENCES core.buchungsbeleg(buchungsbeleg_key) ON DELETE CASCADE,
    satz              numeric(5,2) NOT NULL,
    betrag            numeric(14,2),
    PRIMARY KEY (buchungsbeleg_key, satz),
    CONSTRAINT buchungsbeleg_steuer_satz_bereich CHECK (satz BETWEEN 0 AND 100)
);

COMMENT ON TABLE core.buchungsbeleg_steuer IS
'taxItems je Beleg, eine Zeile je Steuersatz. Gemessen am 11.08.2026 sind die Schluessel
0, 7 und 19 — der CHECK prueft trotzdem nur den WERTEBEREICH 0 bis 100 und keine
Aufzaehlung: der Bestand reicht bis 2009 zurueck, und von Juli bis Dezember 2020 galten
16 und 5 Prozent.
Geschrieben werden nur Saetze, die im Satz vorkommen. Erwartete Groessenordnung
(ERWARTUNG, nicht gemessen): 0,6 bis 1,2 Mio Zeilen, Obergrenze 1,78 Mio.
Kein eigener Identity-Schluessel: die Zeile hat ausserhalb ihres Belegs keine Bedeutung,
und ON DELETE CASCADE haengt sie sauber daran.';
COMMENT ON COLUMN core.buchungsbeleg_steuer.betrag IS
'OB DAS DER NETTOBETRAG JE SATZ ODER DIE STEUER IST, IST AM 11.08.2026 NICHT GEMESSEN.
Der Spaltenname behauptet deshalb nichts. mart.belegarchiv_pruefung rechnet die Summe
gegen core.buchungsbeleg.netto und beantwortet die Frage nach dem ersten Lauf von selbst.
Bis dahin darf niemand daraus eine Umsatzsteuer-Auswertung bauen.';

CREATE INDEX ON core.buchungsbeleg_steuer (satz);


-- ---------------------------------------------------------------------
-- Was LINA selbst als Bestand meldet
--
-- Die mittlere von drei Zahlen. Ohne sie laesst sich "LINA hat weniger"
-- nicht von "wir haben weniger geholt" unterscheiden:
--
--   soll     manual.belegarchiv_soll  die eingefrorene Zaehlung 11.08.2026
--   bestand  diese Tabelle            LINAs recordsTotal von heute
--   ist      core.buchungsbeleg       was wir tatsaechlich geschrieben haben
--
-- APPEND-ONLY mit gemessen_am IM SCHLUESSEL. Ein Upsert waere billiger,
-- wuerde aber genau das wegwerfen, was bei einem mehrtaegigen Abzug
-- gebraucht wird: das Wachstum waehrend des Laufs. Nur daran laesst sich
-- ein Zuwachs von einer Luecke unterscheiden (Falle 8). 22.000 Zeilen im
-- Jahr kosten nichts.
-- ---------------------------------------------------------------------
CREATE TABLE core.belegarchiv_bestand (
    betrieb_key            integer     NOT NULL REFERENCES core.betrieb(betrieb_key),
    lina_betrieb_id        integer     NOT NULL,
    typ_id                 text        NOT NULL REFERENCES core.belegart(typ_id),
    gemessen_am            timestamptz NOT NULL,
    records_total          integer     NOT NULL,
    records_filtered       integer,
    seitengroesse          integer     NOT NULL,
    archivierte_enthalten  boolean     NOT NULL DEFAULT false,
    raw_id                 bigint,
    geladen_am             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, typ_id, gemessen_am)
);

COMMENT ON TABLE core.belegarchiv_bestand IS
'recordsTotal aus der DataTables-Huelle, je Betrieb und Ordner, mit dem Zeitpunkt der
Zaehlung. Zwei Aufgaben: die Seitenarithmetik des Backfills (Seite 1 liest records_total
und reiht ceil(records_total/seitengroesse) - 1 Folgeseiten ein) und die einzige
Gegenprobe, die von der QUELLE selbst kommt und nicht aus unserer CSV.
APPEND-ONLY: gemessen_am steht im Schluessel, damit das Wachstum waehrend eines
mehrtaegigen Abzugs sichtbar bleibt. Ein vollstaendiger Durchgang sind 1.834 Zeilen
(131 Betriebe x 14 Ordner).
Auch Nullstaende werden geschrieben — "nachweislich leer" ist eine Aussage, "keine Zeile"
ist keine.';
COMMENT ON COLUMN core.belegarchiv_bestand.records_filtered IS
'Weicht sie von records_total ab, war ein Filter aktiv — und dann ist unsere
Seitenarithmetik falsch. Erwartung: gleich.';
COMMENT ON COLUMN core.belegarchiv_bestand.seitengroesse IS
'Das gesendete length, gemessen 200 (verifiziert 11.08.2026). Aendert LINA es, aendert
sich die Zahl der Folgeseiten — deshalb steht der tatsaechlich verwendete Wert hier und
nicht als Konstante im Code.';
COMMENT ON COLUMN core.belegarchiv_bestand.archivierte_enthalten IS
'Ob showArchived mitgeschickt wurde. OHNE DIESE SPALTE IST SOLL GEGEN IST NICHT
VERGLEICHBAR: ob die Zaehlung vom 11.08.2026 archivierte Belege enthielt, steht nirgends
(Falle 7).';

CREATE INDEX ON core.belegarchiv_bestand (betrieb_key, typ_id, gemessen_am DESC);


-- ---------------------------------------------------------------------
-- Die Zaehlung vom 11.08.2026 — die CSV 1:1
--
-- 131 Zeilen, acht Mengenspalten und LINAs eigene Summenspalte. Breit,
-- weil docs/ladenakte-bestand.csv breit ist und weil nur so der CHECK auf
-- die Summe moeglich ist: hier sind die Zeilen literal geseedet, also ist
-- ein CHECK kein Risiko fuer einen laufenden Import, sondern eine
-- Absicherung gegen einen Uebertragungsfehler in dieser Datei.
-- Gegengerechnet am 11.08.2026: er trifft in allen 131 Zeilen.
--
-- KEIN FREMDSCHLUESSEL auf core.betrieb: core.betrieb.lina_betrieb_id ist
-- nullable und traegt keinen UNIQUE (nachgesehen in 0002_stammdaten.sql),
-- ein FK ist damit technisch nicht moeglich. Fehlt ein Betrieb, soll das
-- die Pruefsicht melden und nicht die Migration verhindern.
-- ---------------------------------------------------------------------
CREATE TABLE manual.belegarchiv_zaehlung (
    lina_betrieb_id       integer PRIMARY KEY,
    konzept               text    NOT NULL,
    betrieb               text    NOT NULL,
    eingangsrechnungen    integer NOT NULL,
    ausgangsrechnungen    integer NOT NULL,
    inventur_bruchlisten  integer NOT NULL,
    kassenbelege          integer NOT NULL,
    lieferscheine         integer NOT NULL,
    bwa                   integer NOT NULL,
    susa                  integer NOT NULL,
    kontoauszuege         integer NOT NULL,
    summe                 integer NOT NULL,
    gemessen_am           date    NOT NULL DEFAULT DATE '2026-08-11',
    CONSTRAINT belegarchiv_zaehlung_summe CHECK (
        summe = eingangsrechnungen + ausgangsrechnungen + inventur_bruchlisten
              + kassenbelege + lieferscheine + bwa + susa + kontoauszuege)
);

COMMENT ON TABLE manual.belegarchiv_zaehlung IS
'docs/ladenakte-bestand.csv 1:1 — die vollzaehlige Zaehlung vom 11.08.2026 ueber alle 131
Betriebe der Ladenakte, 0 Fehler, Gesamtsumme 593.314. Sie deckt ACHT der vierzehn Ordner
ab; die uebrigen sechs wurden nicht gezaehlt.
Diese Tabelle ist die Belegform, manual.belegarchiv_soll die Arbeitsform. Der CHECK auf
summe traegt hier, weil die Zeilen literal geseedet sind.
konzept ist LINAs Ladenakte-Konzeptbaum mit 11 Konzepten — NICHT dasselbe wie
mart.konzept_zuordnung.hauptkonzept, das aus LINAs 14 Konzepten der Report-Filter kommt.
betrieb ist der Name ZUM ZEITPUNKT DER ZAEHLUNG und absichtlich mitgefuehrt: er ist die
einzige Handhabe, wenn eine lina_betrieb_id in core.betrieb nicht vorkommt.';
COMMENT ON COLUMN manual.belegarchiv_zaehlung.lieferscheine IS
'typeId 3970. Konzernweit 542 Stueck bei 394.552 Eingangsrechnungen — die Hoffnung, ueber
diesen Ordner an Liefermengen zu kommen, traegt nicht.';

INSERT INTO manual.belegarchiv_zaehlung
  (lina_betrieb_id, konzept, betrieb,
   eingangsrechnungen, ausgangsrechnungen, inventur_bruchlisten, kassenbelege,
   lieferscheine, bwa, susa, kontoauszuege, summe) VALUES
  (831, 'Aposto', 'Aposto Aalen GmbH', 6186, 312, 129, 316, 1, 52, 69, 352, 7417),
  (3410, 'Aposto', 'Aposto Aschaffenburg GmbH', 5377, 161, 24, 288, 0, 27, 41, 139, 6057),
  (203, 'Aposto', 'Aposto Augsburg', 4795, 43, 100, 2521, 0, 21, 59, 135, 7674),
  (64, 'Aposto', 'Aposto Bamberg GmbH', 6604, 61, 216, 6150, 0, 31, 51, 196, 13309),
  (188, 'Aposto', 'Aposto Gera GmbH', 6997, 177, 159, 1858, 7, 82, 70, 85, 9435),
  (10, 'Aposto', 'Aposto Karlsruhe GmbH', 7009, 314, 6, 4388, 1, 80, 67, 91, 11956),
  (97, 'Aposto', 'Aposto Mainz GmbH', 6299, 238, 339, 12639, 1, 61, 71, 187, 19835),
  (48, 'Aposto', 'Aposto Schweinfurt GmbH', 4135, 307, 8, 848, 20, 38, 63, 160, 5579),
  (154, 'Aposto', 'Aposto Schwetzingen GmbH', 1463, 0, 31, 1, 0, 60, 16, 1, 1572),
  (5782, 'Aposto', 'Aposto Wuppertal - Alter Papierfabrik', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (1080, 'Aposto', 'Aposto Wuppertal GmbH', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (4469, 'Besitos', 'A Testladen Concept Family', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (196, 'Besitos', 'GSF Gastro GmbH', 3776, 23, 289, 1791, 12, 75, 70, 393, 6429),
  (75, 'Deutsche Konzepte', 'Alter Kranen GmbH', 7935, 2, 444, 7008, 0, 39, 73, 387, 15888),
  (6, 'Deutsche Konzepte', 'B+L Pforzheim GmbH', 4959, 2, 116, 1028, 0, 21, 59, 126, 6311),
  (3352, 'Deutsche Konzepte', 'Badischer Hof Ettlingen GmbH', 4051, 314, 5, 3487, 0, 82, 69, 57, 8065),
  (90, 'Deutsche Konzepte', 'BS Bier & Speisen Gastro GmbH', 10670, 53, 3, 220, 0, 32, 55, 16, 11049),
  (37, 'Deutsche Konzepte', 'Lehners HN Gaststättenbetriebs GmbH', 6633, 12, 130, 1766, 2, 68, 74, 265, 8950),
  (38, 'Deutsche Konzepte', 'Lehners Karlsruhe', 10082, 416, 161, 962, 0, 3, 53, 82, 11759),
  (40, 'Deutsche Konzepte', 'Lehners Wirtshaus Rastatt GmbH', 4478, 8, 115, 5081, 0, 34, 65, 355, 10136),
  (13, 'Deutsche Konzepte', 'Park Cafe München GmbH', 12515, 2295, 58, 559, 0, 57, 62, 159, 15705),
  (3, 'Deutsche Konzepte', 'Ratskeller Augsburg GmbH', 6633, 872, 8, 4580, 0, 45, 68, 61, 12267),
  (72, 'Deutsche Konzepte', 'Ratskeller Ludwigsburg GmbH', 7031, 1161, 233, 555, 0, 44, 74, 186, 9284),
  (57, 'Deutsche Konzepte', 'Ratskeller Saarbrücken GmbH', 3812, 610, 143, 2119, 2, 60, 65, 224, 7035),
  (4762, 'Deutsche Konzepte', 'WHK Gastronomie GmbH', 3758, 47, 39, 881, 0, 0, 19, 46, 4790),
  (182, 'Deutsche Konzepte', 'Wirtshaus am Schlossplatz GmbH', 7575, 1171, 124, 3335, 0, 28, 65, 520, 12818),
  (4340, 'Deutsche Konzepte', 'Wirtshaus Im Jagdgrund GmbH', 1390, 129, 4, 1744, 0, 0, 35, 28, 3330),
  (861, 'Deutsche Konzepte', 'Wirtshaus Lautenschlager GmbH', 8518, 1766, 33, 4195, 0, 68, 66, 23, 14669),
  (3516, 'Deutsche Konzepte', 'Zenz Wirtshaus GmbH', 7373, 680, 198, 3409, 0, 60, 71, 99, 11890),
  (573, 'Enchi-Gruppe geschlossene', 'Alte Post Aachen Gaststättenbetriebs GmbH', 14, 0, 0, 0, 0, 0, 0, 0, 14),
  (250, 'Enchi-Gruppe geschlossene', 'Aposto Dresden', 7711, 54, 58, 1534, 0, 89, 64, 85, 9595),
  (33, 'Enchi-Gruppe geschlossene', 'Enchilada Stuttgart GmbH', 4085, 89, 124, 279, 0, 56, 57, 91, 4781),
  (160, 'Enchi-Gruppe geschlossene', 'Enchilada Wuppertal', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (267, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN - Aposto Frankfurt GmbH', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (41, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Alte Post Aachen GmbH', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (9, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Aposto Pforzheim', 0, 0, 0, 0, 0, 2, 0, 0, 2),
  (43, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Besitos Hannover GmbH', 51, 0, 0, 0, 0, 0, 0, 0, 51),
  (44, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Besitos Karlsruhe GmbH', 1565, 14, 28, 943, 0, 20, 23, 31, 2624),
  (7, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Besitos Mainz GmbH', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (8, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Besitos Stuttgart GmbH', 1, 0, 0, 0, 0, 0, 0, 0, 1),
  (47, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Besitos Ulm', 5, 0, 0, 1, 0, 0, 0, 23, 29),
  (49, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Big Easy München GmbH', 28, 0, 0, 0, 0, 0, 0, 11, 39),
  (456, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Enchilada Dresden GmbH', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (52, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Enchilada Gronau GmbH', 16, 0, 0, 0, 0, 0, 0, 49, 65),
  (21, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Enchilada Halle Gaststättenbetriebs Gm', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (555, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Enchilada Kaiserslautern GmbH ', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (24, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Enchilada Kassel', 333, 0, 0, 1, 0, 24, 9, 0, 367),
  (25, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Enchilada Koblenz', 1151, 84, 65, 470, 0, 36, 29, 58, 1893),
  (27, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Enchilada Mannheim GmbH', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (28, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Enchilada München', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (109, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Enchilada Schweinfurt', 0, 10, 0, 0, 0, 0, 0, 0, 10),
  (104, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Enchilada Wiesbaden GmbH', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (11, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Enchilada Zwickau', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (39, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Lehners München', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (770, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN LUX Oldenburg GmbH', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (246, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Restless München GmbH - Aposto München', 62, 1, 0, 0, 0, 0, 0, 59, 122),
  (4361, 'Enchi-Gruppe geschlossene', 'Geschlossen Wilma Wunder Hannover GmbH', 2967, 265, 33, 183, 0, 26, 31, 86, 3591),
  (730, 'Enchi-Gruppe geschlossene', 'GESCHLOSSEN Wilma Wunder Heilbronn GmbH', 62, 1, 0, 0, 0, 0, 1, 30, 94),
  (1043, 'Enchi-Gruppe geschlossene', 'INSOLVENT - Besitos MG GmbH', 3732, 66, 112, 153, 1, 10, 34, 70, 4178),
  (123, 'Enchi-Gruppe geschlossene', 'INSOLVENT - Enchilada Bruchsal', 3625, 513, 85, 2316, 0, 28, 46, 191, 6804),
  (132, 'Enchi-Gruppe geschlossene', 'INSOLVENT - Enchilada Gießen', 1206, 0, 74, 224, 11, 51, 34, 151, 1751),
  (4, 'Enchi-Gruppe geschlossene', 'INSOLVENT - Enchilada Pforzheim GmbH', 2076, 42, 66, 599, 0, 18, 37, 172, 3010),
  (937, 'Enchi-Gruppe geschlossene', 'INSOLVENT - Enchilada Uniring GmbH', 2514, 35, 48, 588, 2, 29, 39, 137, 3392),
  (1025, 'Enchilada', 'COYACAN GmbH', 5931, 123, 147, 3428, 0, 34, 67, 173, 9903),
  (17, 'Enchilada', 'Enchilada Aalen GmbH', 4344, 244, 98, 639, 0, 100, 68, 481, 5974),
  (177, 'Enchilada', 'Enchilada Aschaffenburg GmbH', 4547, 82, 82, 1882, 0, 19, 46, 168, 6826),
  (2, 'Enchilada', 'Enchilada Augsburg', 6029, 43, 60, 37, 0, 13, 52, 98, 6332),
  (1, 'Enchilada', 'Enchilada Bayreuth GmbH', 4388, 87, 42, 1248, 0, 40, 67, 72, 5944),
  (18, 'Enchilada', 'Enchilada Bremen', 29, 0, 0, 0, 1, 1, 0, 0, 31),
  (20, 'Enchilada', 'Enchilada Freiburg GmbH', 5770, 70, 109, 490, 0, 38, 65, 220, 6762),
  (63, 'Enchilada', 'Enchilada Freudenstadt GmbH ', 4717, 26, 1, 412, 0, 23, 56, 85, 5320),
  (22, 'Enchilada', 'Enchilada Hamm', 3661, 9, 0, 2350, 0, 20, 56, 875, 6971),
  (36, 'Enchilada', 'Enchilada Hannover GmbH', 6335, 183, 144, 1548, 0, 76, 73, 183, 8542),
  (23, 'Enchilada', 'Enchilada Heilbronn GmbH', 4696, 121, 187, 644, 0, 44, 69, 259, 6020),
  (15, 'Enchilada', 'Enchilada Karlsruhe GmbH', 8383, 48, 164, 343, 0, 49, 72, 82, 9141),
  (819, 'Enchilada', 'Enchilada Kempten GmbH', 4939, 14, 145, 308, 0, 19, 51, 118, 5594),
  (26, 'Enchilada', 'Enchilada Leipzig GmbH', 0, 0, 0, 0, 1, 0, 0, 0, 1),
  (189, 'Enchilada', 'Enchilada Marburg GmbH', 2663, 93, 168, 397, 0, 15, 65, 100, 3501),
  (29, 'Enchilada', 'Enchilada Minden GmbH', 5750, 280, 68, 147, 0, 26, 66, 81, 6418),
  (30, 'Enchilada', 'Enchilada Münster GmbH', 4465, 324, 0, 2603, 0, 20, 51, 120, 7583),
  (31, 'Enchilada', 'Enchilada Nürnberg GmbH', 5474, 88, 123, 1140, 0, 60, 71, 105, 7061),
  (32, 'Enchilada', 'Enchilada Rosenheim GmbH', 16, 0, 0, 524, 0, 0, 0, 0, 540),
  (34, 'Enchilada', 'Enchilada Ulm GmbH', 4129, 1, 61, 2078, 0, 36, 65, 237, 6607),
  (14, 'Enchilada', 'Enchilada Würzburg GmbH', 3913, 41, 99, 1140, 1, 48, 68, 239, 5549),
  (998, 'Enchilada', 'Gastronomie Wilsdruffer Straße GmbH', 4985, 215, 111, 7439, 0, 51, 68, 118, 12987),
  (5653, 'Franchisegebergesellschaften', 'Aposto Management GmbH', 143, 0, 0, 0, 0, 0, 0, 33, 176),
  (5666, 'Franchisegebergesellschaften', 'Burrito Company Franchise GmbH', 129, 1, 0, 0, 0, 0, 0, 9, 139),
  (62, 'Franchisegebergesellschaften', 'CONCEPT FAMILY Franchise AG', 12064, 352, 0, 18, 0, 20, 10, 1009, 13473),
  (120, 'Franchisegebergesellschaften', 'Condukto AG', 577, 19, 0, 0, 0, 24, 19, 135, 774),
  (5741, 'Franchisegebergesellschaften', 'Condukto Franchise GmbH', 79, 13, 0, 0, 0, 10, 9, 28, 139),
  (4620, 'Franchisegebergesellschaften', 'Condukto Service GmbH', 260, 122, 0, 0, 0, 1, 19, 41, 443),
  (4095, 'Franchisegebergesellschaften', 'Eat Tasty Franchise AG', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (3513, 'Franchisegebergesellschaften', 'Enchilada Beteiligungs GmbH', 174, 3, 0, 0, 0, 10, 6, 61, 254),
  (5651, 'Franchisegebergesellschaften', 'Enchilada Management GmbH', 191, 0, 0, 0, 0, 0, 0, 34, 225),
  (1093, 'Franchisegebergesellschaften', 'Family & Friends Gastro Service AG', 437, 23, 0, 0, 0, 20, 20, 60, 560),
  (1091, 'Franchisegebergesellschaften', 'Family & Friends Marketing GmbH', 4883, 215, 0, 0, 0, 14, 7, 344, 5463),
  (95, 'Franchisegebergesellschaften', 'Gastro Experts GmbH', 2907, 1277, 0, 45, 0, 87, 62, 554, 4932),
  (5891, 'Franchisegebergesellschaften', 'Riviera Calling AG', 60, 1, 0, 2, 0, 0, 4, 8, 75),
  (4671, 'Franchisegebergesellschaften', 'Schlager Cafe Beteiligungs AG', 61, 0, 0, 0, 0, 0, 1, 24, 86),
  (4643, 'Franchisegebergesellschaften', 'Schlager Cafe Franchise AG', 302, 6, 0, 1, 0, 0, 2, 50, 361),
  (3353, 'Franchisegebergesellschaften', 'Wilma Wunder Beteiligungs AG', 142, 9, 0, 0, 0, 16, 9, 56, 232),
  (5652, 'Franchisegebergesellschaften', 'Wilma Wunder Management GmbH', 244, 0, 0, 0, 0, 0, 0, 33, 277),
  (4309, 'Ghost Kitchen', 'EatTasty Speisekarte', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (4639, 'Ghost Kitchen', 'Geschlossen - Eat Tasty Gräfelfing', 2442, 0, 0, 141, 0, 0, 7, 5, 2595),
  (4067, 'Ghost Kitchen', 'Geschlossen - Eat Tasty Mainz GmbH', 3621, 2, 37, 112, 0, 0, 7, 61, 3840),
  (4210, 'Kooperationspartner', 'Heidis Braustüberl GmbH', 2254, 93, 9, 113, 1, 0, 44, 64, 2578),
  (5660, 'Kooperationspartner', 'SCHAFFERONE GmbH', 2048, 0, 1, 16, 0, 0, 17, 2, 2084),
  (4640, 'Schlager Cafe', 'Schlager Cafe Düsseldorf GmbH', 2941, 290, 0, 441, 0, 1, 12, 44, 3729),
  (4410, 'Sonstige Enchilada Gruppe', 'Alpenhotel Dahoam', 31, 0, 0, 0, 0, 0, 0, 0, 31),
  (3511, 'Sonstige Enchilada Gruppe', 'Aposto Beteiligungs GmbH', 195, 1, 0, 0, 0, 8, 5, 60, 269),
  (3512, 'Sonstige Enchilada Gruppe', 'Burgerheart Beteiligungs GmbH', 138, 0, 0, 0, 0, 9, 5, 56, 208),
  (199, 'Sonstige Enchilada Gruppe', 'Domhof GmbH', 6243, 1130, 310, 431, 0, 8, 63, 89, 8274),
  (805, 'Sonstige Enchilada Gruppe', 'Enchilada Lernwelt', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (1008, 'Sonstige Enchilada Gruppe', 'Gastwirtschaft Bavariaring 5 GmbH', 1556, 90, 26, 172, 0, 44, 24, 16, 1928),
  (4055, 'Sonstige Enchilada Gruppe', 'KUZ - Wilma Wunder Ballplatz Mainz GmbH', 98, 0, 92, 47, 0, 0, 0, 0, 237),
  (4298, 'Sonstige Enchilada Gruppe', 'Tobi Enchi Testladen Zwei', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (4034, 'Sonstige Enchilada Gruppe', 'Tobi Enchi ZAV Test', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (396, 'Wilma Wunder', 'Gastronomie am Markt Mainz GmbH', 10423, 471, 111, 1841, 0, 60, 66, 255, 13227),
  (833, 'Wilma Wunder', 'Wilma Wunder Ballplatz Mainz GmbH', 5976, 753, 303, 1734, 0, 53, 77, 127, 9023),
  (5721, 'Wilma Wunder', 'Wilma Wunder Bochum GmbH', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  (867, 'Wilma Wunder', 'Wilma Wunder Dresden GmbH', 6388, 0, 228, 11785, 0, 95, 78, 0, 18574),
  (868, 'Wilma Wunder', 'Wilma Wunder Düsseldorf GmbH', 6377, 550, 8, 4167, 0, 33, 63, 186, 11384),
  (5611, 'Wilma Wunder', 'Wilma Wunder Freudenstadt GmbH', 714, 1, 0, 56, 0, 0, 13, 0, 784),
  (4316, 'Wilma Wunder', 'Wilma Wunder Karlsruhe GmbH', 6154, 44, 108, 7350, 74, 0, 39, 83, 13852),
  (1024, 'Wilma Wunder', 'Wilma Wunder Köln GmbH', 11324, 443, 230, 5015, 0, 30, 64, 246, 17352),
  (4556, 'Wilma Wunder', 'Wilma Wunder Nürnberg GmbH', 1589, 0, 18, 470, 0, 0, 15, 33, 2125),
  (4176, 'Wilma Wunder', 'Wilma Wunder Passau GmbH', 36, 0, 0, 27, 0, 0, 0, 0, 63),
  (4617, 'Wilma Wunder', 'Wilma Wunder Recklinghausen GmbH', 2892, 12, 6, 2619, 0, 1, 21, 5, 5556),
  (4646, 'Wilma Wunder', 'Wilma Wunder Speyer GmbH', 2492, 76, 9, 534, 0, 0, 19, 63, 3193),
  (1068, 'Wilma Wunder', 'Wilma Wunder Stuttgart GmbH', 8375, 318, 164, 4793, 404, 62, 88, 184, 14388),
  (5769, 'Wilma Wunder', 'Wilma Wunder Viernheim GmbH', 1170, 0, 2, 1, 0, 0, 4, 5, 1182);


-- ---------------------------------------------------------------------
-- Derselbe Sollbestand, lang — die Arbeitsform
--
-- Die Zuordnung CSV-Spalte zu typeId ist eine DEUTUNG. Sie steht deshalb
-- genau einmal und sichtbar hier, statt als CASE-Ausdruck in jeder Sicht
-- wiederholt zu werden — dort waere sie die eine Stelle, an der ein
-- Sollwert still dem falschen Ordner zugeschlagen wird.
--
-- Fuer die sechs nie gezaehlten typeId gibt es hier KEINE ZEILE. Das ist
-- die Form, in der sich "nicht gezaehlt" von "gezaehlt und leer" (Zeile
-- mit 0) unterscheidet. Beides als 0 zu fuehren hiesse, sechs Ordner je
-- Betrieb dauerhaft als vollstaendig zu melden, die nie geprueft wurden.
-- ---------------------------------------------------------------------
CREATE TABLE manual.belegarchiv_soll (
    lina_betrieb_id integer NOT NULL,
    typ_id          text    NOT NULL REFERENCES core.belegart(typ_id),
    soll_anzahl     integer NOT NULL CHECK (soll_anzahl >= 0),
    gemessen_am     date    NOT NULL DEFAULT DATE '2026-08-11',
    PRIMARY KEY (lina_betrieb_id, typ_id)
);

COMMENT ON TABLE manual.belegarchiv_soll IS
'Der Sollbestand je Betrieb und Ordner, abgeleitet aus manual.belegarchiv_zaehlung.
1.048 Zeilen (131 Betriebe x 8 gezaehlte Ordner), davon 621 groesser null und 427
nachweislich leer — nachgerechnet am 11.08.2026.
DIE FEHLENDE ZEILE IST DIE AUSSAGE: fuer die typeId 16, 3968, 3969, 3971, 3972 und 3976
gibt es keinen Sollwert, weil die Erhebung sie nicht gezaehlt hat. In
mart.belegarchiv_fehlend erscheint das als soll_bekannt = false und ausdruecklich NICHT
als Vollstaendigkeit.
Diese Tabelle traegt die einzige Pruefung des ganzen Vorhabens, die OHNE einen einzigen
LINA-Aufruf laeuft: der Abgleich der 131 lina_betrieb_id gegen core.betrieb. Sie gehoert
VOR den ersten Abzug — hinterher kostet sie 3.000 Anfragen.';

INSERT INTO manual.belegarchiv_soll (lina_betrieb_id, typ_id, soll_anzahl)
SELECT z.lina_betrieb_id, v.typ_id, v.anzahl
  FROM manual.belegarchiv_zaehlung z
  CROSS JOIN LATERAL (VALUES
        ('1',    z.eingangsrechnungen),
        ('2',    z.ausgangsrechnungen),
        ('3',    z.inventur_bruchlisten),
        ('5',    z.kassenbelege),
        ('3970', z.lieferscheine),
        ('3974', z.bwa),
        ('3975', z.susa),
        ('3977', z.kontoauszuege)
      ) AS v(typ_id, anzahl);


-- ---------------------------------------------------------------------
-- Pflegetabellen: Kontobezeichnung und Dachlieferant
--
-- Beide werden LEER angelegt und von keinem Importlauf beschrieben. Was
-- kein Import schreibt, kann auch nicht still falsch werden — und beide
-- sind ueber TEXT geschluesselt und nicht ueber einen Surrogatschluessel
-- aus einer Importtabelle. Das ist Absicht: ein Neuaufbau aus raw wuerde
-- Surrogate neu vergeben und die Handarbeit lautlos falsch verzeigern.
-- ---------------------------------------------------------------------
CREATE TABLE manual.sachkonto (
    kontonummer     text    PRIMARY KEY,
    bezeichnung     text    NOT NULL,
    block           text,
    ist_wareneinsatz boolean NOT NULL DEFAULT false,
    notiz           text,
    gepflegt_am     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manual.sachkonto IS
'Kontonummer auf Bezeichnung und Kostenblock. LINA liefert am Beleg NUR die Nummer; ohne
diese Pflege ist jede Kostenkontenauswertung eine Liste vierstelliger Zahlen.
WIRD LEER ANGELEGT. Die Arbeitsliste ist mart.sachkonto_fehlend, nach Volumen sortiert,
damit die teuersten Konten zuerst benannt werden. Erwartung nach dem ersten Abzug
(ERWARTUNG, nicht gemessen): 200 bis 800 unterschiedliche Konten.
OFFEN UND UNGEMESSEN: der PK ist die Kontonummer ALLEIN und setzt damit EINEN Kontenrahmen
fuer alle 131 Gesellschaften voraus. Fahren zwei Gesellschaften SKR03 und SKR04, traegt
dieselbe Nummer zwei Bedeutungen und die Bezeichnung ist fuer eine von beiden falsch —
ohne Fehlermeldung. Gegenprobe nach dem ersten Abzug: streuen die Wareneinsatzkonten der
Betriebe um einen gemeinsamen Nummernbereich oder um zwei?';
COMMENT ON COLUMN manual.sachkonto.block IS
'Wareneinsatz, Personal, Miete, Energie und so weiter. Freier Text, KEIN CHECK: der
Blockschnitt ist eine fachliche Festlegung und wird sich aendern.';

CREATE TABLE manual.kreditor_gruppe (
    name_norm    text PRIMARY KEY,
    dach_name    text NOT NULL,
    notiz        text,
    gepflegt_am  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manual.kreditor_gruppe IS
'Der Dachlieferant: bildet die je Betrieb getrennt gefuehrten Verkaeufernamen auf einen
konzernweiten Namen ab, damit "METRO Deutschland GmbH" und "Metro AG" ein Eintrag werden.
Nur so ist Lieferantenkonzentration ueber alle 131 Haeuser EINE Zahl und nicht 131.
BEWUSST PFLEGE UND NICHT AUTOMATIK: eine Namensaehnlichkeit darf ein Vorschlag sein, nie
eine Zuordnung — "Getraenke Hoffmann GmbH" und "Getraenke Hofmann e.K." sind zwei Firmen,
"METRO AG" und "METRO Deutschland GmbH" sind eine. Das entscheidet kein regexp_replace.
Dieselbe Regel wie bei core.kostenstelle.betrieb_key (0030).
WIRD LEER ANGELEGT. Was nicht gepflegt ist, faellt in mart.kreditor_konzern auf name_norm
zurueck: die Rangliste ist dann feiner aufgeteilt, aber nicht falsch verschmolzen. Die
Spalte gepflegt dort sagt je Zeile, welcher Fall vorliegt.';
COMMENT ON COLUMN manual.kreditor_gruppe.name_norm IS
'Trifft core.kreditor_name_norm(verkaeufer_name). Die Normalisierung faltet nur
Grossschreibung, Umlaute, Satzzeichen und Mehrfachleerzeichen — sie entfernt AUSDRUECKLICH
keine Rechtsformen, weil "Mueller GmbH" und "Mueller KG" zwei Gesellschaften sein koennen.';


-- ---------------------------------------------------------------------
-- Die Normalisierung des Verkaeufernamens
--
-- Als Funktion und nicht als Ausdruck in zwei Sichten: sonst laufen die
-- beiden Fassungen beim ersten Nachbessern auseinander, und die Bruecke
-- nach manual.kreditor_gruppe trifft dann in der einen Sicht und in der
-- anderen nicht.
--
-- Sie wird BEIM LESEN gerechnet und nicht beim Laden gespeichert. Damit
-- gibt es im Ladeweg keine abgeleitete Spalte, die ein Neuaufbau anders
-- fuellen koennte, und eine Verbesserung der Normalisierung wirkt sofort
-- und rueckwirkend.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.kreditor_name_norm(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT nullif(
           btrim(
             regexp_replace(
               regexp_replace(
                 replace(replace(replace(replace(replace(
                   lower(coalesce(p_name, '')),
                   'ä','ae'), 'ö','oe'), 'ü','ue'), 'ß','ss'), '&',' und '),
                 '[^a-z0-9]+', ' ', 'g'),
               ' +', ' ', 'g')
           ), '')
$$;

COMMENT ON FUNCTION core.kreditor_name_norm IS
'Faltet einen Verkaeufernamen aus der OCR auf eine vergleichbare Form: Kleinschreibung,
Umlaute nach ae/oe/ue/ss, kaufmaennisches Und ausgeschrieben, alles uebrige Nicht-Alphanumerische
zu einem Leerzeichen.
ENTFERNT KEINE RECHTSFORMEN. Das waere bequemer und faellt bewusst weg: "Mueller GmbH" und
"Mueller KG" koennen zwei Gesellschaften sein, und eine falsche Verschmelzung meldet sich nie.
Die Zusammenfuehrung ist deshalb Pflege in manual.kreditor_gruppe, und diese Funktion liefert
nur den Schluessel dafuer. Ergebnis NULL bei leerem Namen — NULL gruppiert nicht mit.';


-- =====================================================================
-- SICHTEN
--
-- Jede traegt betrieb_status und operativ und filtert NICHT selbst
-- (Falle 12). Keine gruppiert nach einem Klarnamen (Falle 13).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Die lesbare Belegzeile — der einzige vorgesehene Leseweg
--
-- Hier faellt die Uebersetzung, die in core bewusst unterblieben ist:
-- 0/1/2 wird zu bar/kueche/sonstige (dasselbe Vokabular wie
-- core.kostenstelle.art, damit sich die Wareneinsatzquellen vergleichen
-- lassen), die leeren Zeichenketten werden zu NULL, der Ordner bekommt
-- seinen Namen. Ein CHECK in core haette dieselbe Uebersetzung erzwungen
-- und bei einem kuenftigen Code 3 zwoelftausend Belege eines Betriebs zum
-- Abbruch gebracht; hier steht er einfach als "unbekannt (3)" da.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.buchungsbeleg AS
SELECT bl.buchungsbeleg_key,
       bl.betrieb_key,
       b.name                                     AS betrieb,
       kz.hauptkonzept                            AS konzept,
       st.status                                  AS betrieb_status,
       (st.status = 'operativ')                   AS operativ,
       bl.typ_id,
       a.name                                     AS ordner,
       bl.beleg_datum,
       date_trunc('month', bl.beleg_datum)::date  AS monat,
       bl.leistungs_datum,
       nullif(btrim(bl.re_nummer), '')            AS re_nummer,
       bl.netto,
       bl.netto_split_roh,
       CASE WHEN bl.zuordnung_fibu IS NULL THEN NULL
            WHEN bl.zuordnung_fibu = 0     THEN 'sonstige'
            WHEN bl.zuordnung_fibu = 1     THEN 'bar'
            WHEN bl.zuordnung_fibu = 2     THEN 'kueche'
            ELSE 'unbekannt (' || bl.zuordnung_fibu::text || ')'
       END                                        AS bereich,
       bl.verkaeufer_name,
       core.kreditor_name_norm(bl.verkaeufer_name) AS verkaeufer_name_norm,
       nullif(btrim(bl.kreditor_konto), '')       AS kreditor_konto,
       nullif(btrim(bl.sachkonto), '')            AS sachkonto,
       nullif(btrim(bl.sachkonto_7), '')          AS sachkonto_7,
       nullif(btrim(bl.sachkonto_0), '')          AS sachkonto_0,
       nullif(btrim(bl.datev_guid), '')           AS datev_guid,
       bl.parashift_status,
       bl.archiviert,
       bl.hochgeladen_am,
       bl.hochgeladen_von_name,
       bl.zuordnung_ma_name,
       bl.datei_name,
       bl.dateiendung,
       bl.encrypted_id,
       bl.zuletzt_am
  FROM core.buchungsbeleg bl
  JOIN core.betrieb  b               ON b.betrieb_key  = bl.betrieb_key
  JOIN core.belegart a               ON a.typ_id       = bl.typ_id
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = bl.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = bl.betrieb_key;

COMMENT ON VIEW mart.buchungsbeleg IS
'Die Belegmetadaten mit aufgeloesten Namen — hier faengt jede Frage an, nicht bei
core.buchungsbeleg. Am 11.08.2026 gezaehlt: 593.314 Belege ueber 131 Betriebe, und das ist
eine Untergrenze (acht der vierzehn Ordner gezaehlt).
DIES IST DIE BEWEISSICHT: archivierte Belege und Belege ohne OCR stehen mit drin und sind
an Spalten erkennbar. Wer summiert, filtert selbst — dieselbe Bauform wie mart.einkauf_beleg.
34 geschlossene und insolvente Haeuser tragen zusammen 42.413 Belege, 17
Franchisegebergesellschaften 27.609. Fuer Zeitreihen ein Gewinn, fuer jeden
Betriebsvergleich eine Falle; dafuer sind betrieb_status und operativ da.
NICHT VERWECHSELN MIT mart.einkauf_beleg — das ist der FoodNotify-Bestellkopf.
hochgeladen_von_name und zuordnung_ma_name sind Klarnamen von Beschaeftigten. Sie stehen
hier als Attribut der Einzelzeile; nach ihnen zu GRUPPIEREN waere eine Leistungsauswertung.';
COMMENT ON COLUMN mart.buchungsbeleg.bereich IS
'zuordnungFibu als Klartext, gleiches Vokabular wie core.kostenstelle.art (bar | kueche |
sonstige). Das ist der Wareneinsatz-Split AN DER RECHNUNG. Ein unbekannter Code erscheint
als "unbekannt (n)" statt die Zeile verschwinden zu lassen.';
COMMENT ON COLUMN mart.buchungsbeleg.monat IS
'date_trunc auf das BELEGDATUM. Bewusst nicht auf coalesce(leistungs_datum, beleg_datum):
wie oft leistungs_datum leer ist, ist am 11.08.2026 NICHT gemessen, und eine Rechnung vom
03.07. fuer Juni-Lieferungen faellt je nach Wahl in einen anderen Monat als in der BWA.
Wer die Leistungsachse braucht, nimmt leistungs_datum ausdruecklich und weiss dann, dass er
es tut.';


-- ---------------------------------------------------------------------
-- Der analytische Ertrag ohne eine einzige PDF-Datei
--
-- Verdichtet, damit die haeufigste Frage die 593.314 Zeilen gar nicht
-- erst anfasst. Aus core und nicht aus mart.buchungsbeleg, damit die
-- Namensaufloesung nur einmal je Gruppe passiert.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.buchungsbeleg_monat AS
SELECT bl.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       bl.typ_id,
       a.name          AS ordner,
       date_trunc('month', bl.beleg_datum)::date AS monat,
       CASE WHEN bl.zuordnung_fibu IS NULL THEN NULL
            WHEN bl.zuordnung_fibu = 0     THEN 'sonstige'
            WHEN bl.zuordnung_fibu = 1     THEN 'bar'
            WHEN bl.zuordnung_fibu = 2     THEN 'kueche'
            ELSE 'unbekannt (' || bl.zuordnung_fibu::text || ')'
       END             AS bereich,
       count(*)                                              AS belege,
       count(*) FILTER (WHERE bl.archiviert)                 AS belege_archiviert,
       sum(bl.netto)                                         AS netto,
       count(*) FILTER (WHERE bl.netto IS NULL)              AS ohne_netto
  FROM core.buchungsbeleg bl
  JOIN core.betrieb  b                ON b.betrieb_key  = bl.betrieb_key
  JOIN core.belegart a                ON a.typ_id       = bl.typ_id
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = bl.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = bl.betrieb_key
 WHERE bl.beleg_datum IS NOT NULL
 GROUP BY bl.betrieb_key, b.name, kz.hauptkonzept, st.status, bl.typ_id, a.name,
          date_trunc('month', bl.beleg_datum), bl.zuordnung_fibu;

COMMENT ON VIEW mart.buchungsbeleg_monat IS
'Anzahl und Nettosumme je Betrieb, Monat, Ordner und Bereich (Bar/Kueche/sonstige) —
Belegdatum als Monatsachse.
ACHTUNG BEIM SUMMIEREN UEBER ORDNER: Ausgangsrechnungen (typ_id 2) sind Forderungen, keine
Kosten. Sie mit Eingangsrechnungen (typ_id 1) in eine Summe zu werfen ergibt eine Zahl, die
nichts bedeutet — im Kopf des Lesers haben sie ein anderes Vorzeichen, in der Spalte netto
nicht.
Belege ohne beleg_datum fallen heraus; wie viele das sind, meldet mart.belegarchiv_pruefung.';


-- ---------------------------------------------------------------------
-- Die Kontostellen eines Belegs — mit der Vermutung, benannt als solche
--
-- HIER liegt die Zuordnung Sachkonto zu Steuersatz, und NICHT in einer
-- Faktentabelle. Der Grund steht im Kopfblock unter Falle 3: dass
-- cost_account zu 19 Prozent, cost_account7 zu 7 und cost_account0 zu 0
-- gehoert, ist plausibel und am 11.08.2026 NICHT gemessen. Als Koernung
-- einer Tabelle mit 600.000 bis 900.000 Zeilen waere aus der Vermutung
-- eine Struktur geworden, und eine Zeile daraus saehe in sich
-- vollstaendig stimmig aus. Als Sicht kostet ihre Korrektur eine Zeile.
--
-- NIEMALS gegen mart.buchungsbeleg joinen und dort netto summieren: ein
-- Beleg erscheint hier bis zu dreimal, und die Kopfsumme vervielfacht
-- sich mit der Zahl seiner Kontostellen.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.buchungsbeleg_konto AS
SELECT bl.buchungsbeleg_key,
       bl.betrieb_key,
       b.name AS betrieb,
       bl.typ_id,
       bl.beleg_datum,
       date_trunc('month', bl.beleg_datum)::date AS monat,
       k.kontostelle,
       k.kontonummer,
       k.satz_vermutet,
       s.betrag AS steuer_betrag,
       mk.bezeichnung,
       mk.block,
       mk.ist_wareneinsatz
  FROM core.buchungsbeleg bl
  JOIN core.betrieb b ON b.betrieb_key = bl.betrieb_key
  CROSS JOIN LATERAL (VALUES
        ('haupt',  nullif(btrim(bl.sachkonto),   ''), 19.00::numeric(5,2)),
        ('satz_7', nullif(btrim(bl.sachkonto_7), ''),  7.00::numeric(5,2)),
        ('satz_0', nullif(btrim(bl.sachkonto_0), ''),  0.00::numeric(5,2))
      ) AS k(kontostelle, kontonummer, satz_vermutet)
  LEFT JOIN core.buchungsbeleg_steuer s
         ON s.buchungsbeleg_key = bl.buchungsbeleg_key
        AND s.satz = k.satz_vermutet
  LEFT JOIN manual.sachkonto mk ON mk.kontonummer = k.kontonummer
 WHERE k.kontonummer IS NOT NULL;

COMMENT ON VIEW mart.buchungsbeleg_konto IS
'Die Kontostellen eines Belegs, eine Zeile je gefuelltem Sachkonto, mit Bezeichnung aus
manual.sachkonto und dem passenden taxItems-Betrag.
KEINE SUMMIERBARE SICHT AUF BELEGEBENE: ein Beleg steht hier bis zu dreimal. Wer sie gegen
mart.buchungsbeleg joint und dort netto summiert, vervielfacht die Kopfsumme.
satz_vermutet IST EINE VERMUTUNG, keine Messung — siehe Spaltenkommentar.';
COMMENT ON COLUMN mart.buchungsbeleg_konto.satz_vermutet IS
'Die Zuordnung cost_account zu 19 Prozent, cost_account7 zu 7 und cost_account0 zu 0 ist am
11.08.2026 NICHT GEMESSEN. Sie steht deshalb hier in einer Sicht und nicht als Spalte in
core.buchungsbeleg: eine Messung korrigiert sie mit einer Zeile statt mit einer Migration
auf einer gefuellten Tabelle. Wer eine Umsatzsteuer-Auswertung darauf baut, misst vorher.';
COMMENT ON COLUMN mart.buchungsbeleg_konto.steuer_betrag IS
'Der taxItems-Wert zum vermuteten Satz. OB DAS NETTO ODER STEUER IST, IST UNGEMESSEN
(siehe core.buchungsbeleg_steuer.betrag).';


-- ---------------------------------------------------------------------
-- Kostenkontenentwicklung
--
-- Bewusst NUR ueber das Hauptkonto (cost_account) mit dem Kopf-Netto —
-- damit ist die Sicht fanout-frei und jede Summe stimmt. Ein Beleg mit
-- 7-Prozent-Anteil steht hier vollstaendig auf seinem Hauptkonto; den
-- Betrag auf drei Konten zu verteilen waere die ungemessene Vermutung
-- aus Falle 3, und zwar in einer Zahl, die jemand weitergibt.
-- Die Nebenkonten sind ueber mart.buchungsbeleg_konto und
-- mart.sachkonto_fehlend sichtbar.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.sachkonto_monat AS
SELECT bl.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       date_trunc('month', bl.beleg_datum)::date AS monat,
       nullif(btrim(bl.sachkonto), '') AS kontonummer,
       mk.bezeichnung,
       mk.block,
       mk.ist_wareneinsatz,
       count(*)      AS belege,
       sum(bl.netto) AS netto
  FROM core.buchungsbeleg bl
  JOIN core.betrieb b                 ON b.betrieb_key  = bl.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = bl.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = bl.betrieb_key
  LEFT JOIN manual.sachkonto       mk ON mk.kontonummer = nullif(btrim(bl.sachkonto), '')
 WHERE bl.beleg_datum IS NOT NULL
   AND nullif(btrim(bl.sachkonto), '') IS NOT NULL
 GROUP BY bl.betrieb_key, b.name, kz.hauptkonzept, st.status,
          date_trunc('month', bl.beleg_datum), nullif(btrim(bl.sachkonto), ''),
          mk.bezeichnung, mk.block, mk.ist_wareneinsatz;

COMMENT ON VIEW mart.sachkonto_monat IS
'Nettovolumen je Betrieb, Hauptsachkonto und Monat — die Sicht fuer die Frage, welches
Kostenkonto weglaeuft. Fanout-frei: jeder Beleg zaehlt genau einmal, auf seinem Hauptkonto.
Belege mit einem Split auf 7 oder 0 Prozent stehen deshalb hier VOLLSTAENDIG auf dem
Hauptkonto — die Aufteilung waere eine am 11.08.2026 ungemessene Vermutung. Sobald die
Bedeutung von taxItems gemessen ist, kann diese Sicht sie nachziehen.
bezeichnung und block sind NULL, solange manual.sachkonto nicht gepflegt ist; die
Arbeitsliste dafuer ist mart.sachkonto_fehlend.';


-- ---------------------------------------------------------------------
-- Arbeitsliste: welches Konto hat noch keinen Namen
--
-- Nach Volumen sortiert, damit die teuersten Faelle oben stehen — Muster
-- mart.kalender_fehlend.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.sachkonto_fehlend AS
WITH konto AS (
  SELECT k.kontonummer,
         count(*)                        AS belege,
         count(DISTINCT bl.betrieb_key)  AS betriebe,
         sum(bl.netto)                   AS beleg_volumen,
         max(bl.beleg_datum)             AS letzter_beleg,
         count(*) FILTER (WHERE k.kontostelle <> 'haupt') AS davon_nebenkonto
    FROM core.buchungsbeleg bl
    CROSS JOIN LATERAL (VALUES
          ('haupt',  nullif(btrim(bl.sachkonto),   '')),
          ('satz_7', nullif(btrim(bl.sachkonto_7), '')),
          ('satz_0', nullif(btrim(bl.sachkonto_0), ''))
        ) AS k(kontostelle, kontonummer)
   WHERE k.kontonummer IS NOT NULL
     AND bl.beleg_datum >= current_date - 365
   GROUP BY k.kontonummer
)
SELECT k.kontonummer, k.belege, k.betriebe, k.beleg_volumen, k.davon_nebenkonto,
       k.letzter_beleg
  FROM konto k
  LEFT JOIN manual.sachkonto m ON m.kontonummer = k.kontonummer
 WHERE m.kontonummer IS NULL
 ORDER BY k.beleg_volumen DESC NULLS LAST;

COMMENT ON VIEW mart.sachkonto_fehlend IS
'Sachkonten der letzten zwoelf Monate ohne Eintrag in manual.sachkonto, nach Volumen
absteigend — die Arbeitsliste fuer die Kontenpflege.
beleg_volumen ist eine REIHENFOLGE, KEINE SUMME: es ist das Nettovolumen der BELEGE, in
denen das Konto vorkommt, und ein Beleg mit Split zaehlt bei jedem seiner Konten voll mit.
Die Spalten liegen bewusst so, weil die Aufteilung des Belegbetrags auf die Kontostellen
ungemessen ist (Falle 3).';


-- ---------------------------------------------------------------------
-- Welche Felder liefert LINA, die wir nicht kennen
--
-- Die Gegenprobe zur Bildungsregel von zusatz. Ein NEUER Schluessel
-- heisst "LINA hat ein Feld ergaenzt", ein VERSCHWUNDENER heisst "das
-- Feld ist weg". Ohne diese Zaehlung faellt beides erst in einer
-- Auswertung auf, und dann als Zahl, nicht als Meldung.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.buchungsbeleg_zusatzfelder AS
SELECT k.schluessel,
       count(*)                       AS belege,
       count(DISTINCT bl.betrieb_key) AS betriebe,
       count(DISTINCT bl.typ_id)      AS ordner,
       min(bl.erstmals_am)            AS erstmals_gesehen,
       max(bl.zuletzt_am)             AS zuletzt_gesehen
  FROM core.buchungsbeleg bl
  CROSS JOIN LATERAL jsonb_object_keys(bl.zusatz) AS k(schluessel)
 GROUP BY k.schluessel
 ORDER BY count(*) DESC;

COMMENT ON VIEW mart.buchungsbeleg_zusatzfelder IS
'Bestandsaufnahme, KEINE Fehlermeldung: welche Felder des Quellsatzes dieser Lader nicht
kennt, mit Haeufigkeit. core.buchungsbeleg.zusatz wird gebildet, indem der Lader die
gemappten Schluessel aus dem Quellsatz LOESCHT — deshalb landet ein neues LINA-Feld
automatisch hier, statt still zu verschwinden.
Erwartet sind die *Time-Zwillinge der Datumsfelder und zuordnungFibuName. Alles andere ist
eine Aenderung an LINAs Antwort und gehoert angesehen.
Die Sicht liest jsonb ueber alle Belege und ist entsprechend teuer — sie ist ein
Diagnosewerkzeug, keine Dashboard-Karte.';


-- ---------------------------------------------------------------------
-- Lieferantenkonzentration je Betrieb
--
-- Gruppiert nach kreditor_konto und NICHT nach dem Namen: der Name kommt
-- aus der OCR und steht in mehreren Schreibweisen da. schreibweisen
-- zaehlt genau das mit — steht dort eine 5, ist der Name als
-- Gruppierungsachse widerlegt.
-- Nur Eingangsrechnungen, damit das Wort Lieferant ueberhaupt trifft.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.kreditor_betrieb_monat AS
SELECT bl.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       date_trunc('month', bl.beleg_datum)::date AS monat,
       nullif(btrim(bl.kreditor_konto), '') AS kreditor_konto,
       mode() WITHIN GROUP (ORDER BY bl.verkaeufer_name) AS verkaeufer_name,
       count(DISTINCT core.kreditor_name_norm(bl.verkaeufer_name)) AS schreibweisen,
       count(*)      AS belege,
       sum(bl.netto) AS netto,
       min(bl.beleg_datum) AS erster_beleg,
       max(bl.beleg_datum) AS letzter_beleg
  FROM core.buchungsbeleg bl
  JOIN core.betrieb b                 ON b.betrieb_key  = bl.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = bl.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = bl.betrieb_key
 WHERE bl.typ_id = '1'
   AND bl.beleg_datum IS NOT NULL
   AND nullif(btrim(bl.kreditor_konto), '') IS NOT NULL
 GROUP BY bl.betrieb_key, b.name, kz.hauptkonzept, st.status,
          date_trunc('month', bl.beleg_datum), nullif(btrim(bl.kreditor_konto), '');

COMMENT ON VIEW mart.kreditor_betrieb_monat IS
'Eingangsrechnungsvolumen je Betrieb, Kreditorenkonto und Monat.
DIE GRUPPIERUNG UEBER KREDITOR_KONTO GILT NUR INNERHALB EINES BETRIEBS: kreditor_account
ist eine DATEV-Kreditorennummer und damit buchungskreisbezogen — 70001 bedeutet in Mainz
etwas anderes als in Karlsruhe. Konzernweit ist mart.kreditor_konzern zustaendig.
schreibweisen ist die Zahl unterschiedlicher normalisierter Verkaeufernamen unter demselben
Konto. Sie belegt, warum hier nicht nach dem Namen gruppiert wird.';


-- ---------------------------------------------------------------------
-- Lieferantenkonzentration konzernweit
--
-- Je Kalenderjahr, weil das die tatsaechlich gestellte Frage ist — ein
-- fest eingebautes rollierendes Zwoelfmonatsfenster haette "Konzern 2025"
-- gerade NICHT beantwortet und je nach Abfragetag anders geendet.
-- Rang und kumulierter Anteil sind fertig gerechnet, damit niemand eine
-- Fensterfunktion in eine Metabase-Karte schreiben muss.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.kreditor_konzern AS
WITH basis AS (
  SELECT date_part('year', bl.beleg_datum)::int AS jahr,
         coalesce(g.dach_name, core.kreditor_name_norm(bl.verkaeufer_name)) AS lieferant,
         bool_or(g.name_norm IS NOT NULL)       AS gepflegt,
         count(DISTINCT bl.betrieb_key)         AS betriebe,
         count(DISTINCT core.kreditor_name_norm(bl.verkaeufer_name)) AS schreibweisen,
         count(*)                               AS belege,
         sum(bl.netto)                          AS netto
    FROM core.buchungsbeleg bl
    LEFT JOIN manual.kreditor_gruppe g
           ON g.name_norm = core.kreditor_name_norm(bl.verkaeufer_name)
   WHERE bl.typ_id = '1'
     AND bl.beleg_datum IS NOT NULL
     AND core.kreditor_name_norm(bl.verkaeufer_name) IS NOT NULL
   GROUP BY date_part('year', bl.beleg_datum)::int,
            coalesce(g.dach_name, core.kreditor_name_norm(bl.verkaeufer_name))
)
SELECT jahr, lieferant, gepflegt, betriebe, schreibweisen, belege, netto,
       rank() OVER (PARTITION BY jahr ORDER BY netto DESC NULLS LAST) AS rang,
       round(100 * netto / nullif(sum(netto) OVER (PARTITION BY jahr), 0), 2)
         AS anteil_prozent,
       round(100 * sum(netto) OVER (PARTITION BY jahr ORDER BY netto DESC NULLS LAST
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
             / nullif(sum(netto) OVER (PARTITION BY jahr), 0), 2)
         AS anteil_kumuliert_prozent
  FROM basis;

COMMENT ON VIEW mart.kreditor_konzern IS
'Lieferantenkonzentration ueber alle Betriebe, je Kalenderjahr, mit Rang, Anteil und
kumuliertem Anteil — die ABC-Analyse fertig gerechnet. Anteile sind Prozentzahlen (23.64,
nie 0.2364).
DIE GRUPPIERUNGSACHSE IST EINE PFLEGEENTSCHEIDUNG: coalesce(Dachname aus
manual.kreditor_gruppe, normalisierter Verkaeufername). Was nicht gepflegt ist, faellt auf
den normalisierten Namen zurueck — die Rangliste ist dann FEINER aufgeteilt als sie sein
sollte, aber nie falsch verschmolzen. Die Spalte gepflegt sagt je Zeile, welcher Fall
vorliegt; der Anteil ungepflegter Zeilen ganz oben ist das Mass fuer die noch offene Arbeit.
Nur Eingangsrechnungen (typ_id 1). Der Name kommt aus der OCR.';


-- ---------------------------------------------------------------------
-- Wareneinsatz an der Rechnung — die dritte, unabhaengige Quelle
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.wareneinsatz_beleg_monat AS
SELECT bl.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       date_trunc('month', bl.beleg_datum)::date AS monat,
       CASE WHEN bl.zuordnung_fibu IS NULL THEN NULL
            WHEN bl.zuordnung_fibu = 0     THEN 'sonstige'
            WHEN bl.zuordnung_fibu = 1     THEN 'bar'
            WHEN bl.zuordnung_fibu = 2     THEN 'kueche'
            ELSE 'unbekannt (' || bl.zuordnung_fibu::text || ')'
       END             AS bereich,
       count(*)        AS belege,
       sum(bl.netto)   AS netto
  FROM core.buchungsbeleg bl
  JOIN core.betrieb b                 ON b.betrieb_key  = bl.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = bl.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = bl.betrieb_key
 WHERE bl.typ_id = '1'
   AND bl.beleg_datum IS NOT NULL
 GROUP BY bl.betrieb_key, b.name, kz.hauptkonzept, st.status,
          date_trunc('month', bl.beleg_datum), bl.zuordnung_fibu;

COMMENT ON VIEW mart.wareneinsatz_beleg_monat IS
'Eingangsrechnungen je Betrieb, Monat und Bereich — der Bar/Kueche-Split AN DER RECHNUNG
SELBST, unabhaengig von Artikelpflege und PLU-Nummernraum. Damit ist der offene Posten C1
ueber eine dritte Quelle angreifbar, und diese dritte deckt auch Deutsche Konzepte ab, wo
die beiden anderen duenn sind.
DAS IST RECHNUNGSVOLUMEN, NICHT VERBRAUCH. Weg A liefert kein Brutto und keine lineItems;
Bestandsveraenderungen, Bruch und Schwund fehlen, Skonti und Boni stehen auf eigenen
Konten. Diese Zahl ist deshalb NICHT dasselbe wie die BWA-Zeile "Wareneinsatz" und darf in
keiner Karte so beschriftet werden. Wer sie weitergibt, gibt diesen Satz mit.
Die Gegenueberstellung mit den beiden anderen Quellen steht in mart.wareneinsatz_quellen.';


-- ---------------------------------------------------------------------
-- Drei Wareneinsatzquellen nebeneinander
--
-- Diese Sicht ENTSCHEIDET NICHT, welche gewinnt. Sie macht sichtbar, wo
-- sie auseinanderlaufen. Genau das ist bei mart.pruefung_wareneinsatz
-- (0029) und bei core.artikel.fixer_we einmal schiefgegangen: eine Zahl,
-- die aussieht wie eine Antwort. Die Vorrangregel ist eine fachliche
-- Festlegung und gehoert nach docs/entscheidungen.md.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.wareneinsatz_quellen AS
WITH beleg AS (
  SELECT betrieb_key,
         date_trunc('month', beleg_datum)::date AS monat,
         sum(netto) FILTER (WHERE zuordnung_fibu = 1) AS bar,
         sum(netto) FILTER (WHERE zuordnung_fibu = 2) AS kueche,
         sum(netto)                                   AS gesamt
    FROM core.buchungsbeleg
   WHERE typ_id = '1' AND beleg_datum IS NOT NULL
   GROUP BY betrieb_key, date_trunc('month', beleg_datum)
), fn AS (
  SELECT betrieb_key, monat,
         sum(einkauf_netto) FILTER (WHERE bereich = 'bar')    AS bar,
         sum(einkauf_netto) FILTER (WHERE bereich = 'kueche') AS kueche,
         sum(einkauf_netto)                                   AS gesamt
    FROM mart.einkauf_betrieb_monat
   GROUP BY betrieb_key, monat
), bwa AS (
  SELECT betrieb_key, monat,
         max(wert_absolut) FILTER (WHERE kennzahl = 'WE Bar')   AS bar,
         max(wert_absolut) FILTER (WHERE kennzahl = 'WE Küche') AS kueche
    FROM mart.kennzahlen_aktuell
   WHERE kennzahl IN ('WE Bar', 'WE Küche')
   GROUP BY betrieb_key, monat
), umsatz AS (
  SELECT betrieb_key, monat, sum(umsatz_netto) AS umsatz
    FROM mart.umsatz_tag
   GROUP BY betrieb_key, monat
), spine AS (
  SELECT betrieb_key, monat FROM beleg
  UNION
  SELECT betrieb_key, monat FROM fn
  UNION
  SELECT betrieb_key, monat FROM bwa
)
SELECT s.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       stt.status      AS betrieb_status,
       (stt.status = 'operativ') AS operativ,
       s.monat,
       u.umsatz,
       be.bar    AS beleg_bar,   be.kueche AS beleg_kueche,   be.gesamt AS beleg_gesamt,
       f.bar     AS fn_bar,      f.kueche  AS fn_kueche,      f.gesamt  AS fn_gesamt,
       w.bar     AS bwa_bar,     w.kueche  AS bwa_kueche,
       /*
        * KEIN coalesce(...,0) auf die BWA-Werte — und das ist der Kern dieser
        * Sicht, nicht eine Feinheit.
        *
        * Hier stand zuerst coalesce(w.bar,0) + coalesce(w.kueche,0). Damit
        * wurde aus "die BWA liefert fuer diesen Monat nichts" die Aussage
        * "der Wareneinsatz betrug 0,00 EUR" — und beleg_minus_bwa zeigte dann
        * den vollen Belegbetrag als Abweichung, bwa_quote_prozent eine glatte
        * 0,00 %. Beides sieht aus wie ein Befund und ist keiner.
        *
        * Genau dieser Fehler steht schon zweimal im Fehlerkatalog: ungebuchte
        * Monate als 0,00 ergaben vier gruene Monate fuer 131 Betriebe, und
        * 0 % Personalkosten galt als "niedriger ist besser" und damit als
        * gruen. Eine fehlende Zahl ist NULL. NULL pflanzt sich durch die
        * Rechnung fort und faellt auf; eine erfundene 0 tut das nicht.
        *
        * Wer die Summe auch dann will, wenn nur eine der beiden Haelften
        * gebucht ist, nimmt bwa_bar und bwa_kueche einzeln — sie stehen
        * darueber.
        */
       w.bar + w.kueche AS bwa_gesamt,
       be.gesamt - f.gesamt AS beleg_minus_foodnotify,
       be.gesamt - (w.bar + w.kueche) AS beleg_minus_bwa,
       round(100 * be.gesamt / nullif(u.umsatz, 0), 2) AS beleg_quote_prozent,
       round(100 * (w.bar + w.kueche) / nullif(u.umsatz, 0), 2)
         AS bwa_quote_prozent
  FROM spine s
  JOIN core.betrieb b                  ON b.betrieb_key  = s.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz  ON kz.betrieb_key = s.betrieb_key
  LEFT JOIN mart.betrieb_status    stt ON stt.betrieb_key = s.betrieb_key
  LEFT JOIN beleg  be ON be.betrieb_key = s.betrieb_key AND be.monat = s.monat
  LEFT JOIN fn     f  ON f.betrieb_key  = s.betrieb_key AND f.monat  = s.monat
  LEFT JOIN bwa    w  ON w.betrieb_key  = s.betrieb_key AND w.monat  = s.monat
  LEFT JOIN umsatz u  ON u.betrieb_key  = s.betrieb_key AND u.monat  = s.monat;

COMMENT ON VIEW mart.wareneinsatz_quellen IS
'Die drei Wareneinsatzquellen je Betrieb und Monat nebeneinander: Beleg (Eingangsrechnungen
aus der Ladenakte), FoodNotify (mart.einkauf_betrieb_monat) und BWA (getKennzahlen, die
Kennzahlen WE Bar und WE Kueche — LINA schreibt die zweite mit Umlaut), mit Differenz und
Quote gegen den Umsatz.
SIE ENTSCHEIDET NICHTS. Zwei Zahlen fuer dieselbe Kennzahl sind schlimmer als eine
unvollstaendige, und genau deshalb steht hier keine Vorrangregel: die ist eine fachliche
Festlegung fuer docs/entscheidungen.md.
Die drei messen ohnehin Verschiedenes. Beleg ist RECHNUNGSVOLUMEN ohne
Bestandsveraenderung, FoodNotify ist BESTELLVOLUMEN, BWA ist der gebuchte Aufwand. Wo sie
weit auseinanderlaufen, ist das ein Hinweis und kein Fehler — aber ein Hinweis, den bisher
niemand sehen konnte.
Eine Zeile ohne Belegwerte heisst nicht "kein Wareneinsatz", sondern "fuer diesen Monat ist
der Belegabzug noch nicht durch"; mart.belegarchiv_fehlend sagt, wie weit er ist.
DASSELBE GILT FUER DIE BWA-SPALTEN, UND ZWAR BUCHSTAeBLICH: bwa_gesamt,
beleg_minus_bwa und bwa_quote_prozent sind NULL, sobald eine der beiden BWA-Haelften fehlt.
Das ist Absicht. Eine 0 an dieser Stelle waere die Behauptung "Wareneinsatz null" statt der
Wahrheit "nicht gebucht" — derselbe stille Fehler, der schon einmal vier gruene Monate fuer
131 Betriebe erzeugt hat. Wer filtern will, nimmt WHERE bwa_gesamt IS NOT NULL.';


-- ---------------------------------------------------------------------
-- Der Fortschritt des Abzugs, in Belegen gemessen
--
-- Drei Zahlen nebeneinander, weil sie drei verschiedene Dinge bedeuten:
-- soll (die eingefrorene Zaehlung vom 11.08.2026), bestand (was LINA
-- beim letzten Blaettern selbst meldete) und ist (was wir geschrieben
-- haben). Wer nur zwei davon fuehrt, kann "LINA hat weniger" nicht von
-- "wir haben weniger geholt" unterscheiden.
--
-- Ausgangspunkt ist das Kreuzprodukt aus den 131 gezaehlten Betrieben und
-- den 14 Ordnern, damit ein nie abgerufener Ordner als ZEILE erscheint
-- statt zu fehlen.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.belegarchiv_fehlend AS
WITH ist AS (
  SELECT betrieb_key, typ_id, count(*) AS ist
    FROM core.buchungsbeleg
   GROUP BY betrieb_key, typ_id
), bestand AS (
  SELECT DISTINCT ON (betrieb_key, typ_id)
         betrieb_key, typ_id, records_total, records_filtered,
         archivierte_enthalten, gemessen_am
    FROM core.belegarchiv_bestand
   ORDER BY betrieb_key, typ_id, gemessen_am DESC
)
SELECT z.lina_betrieb_id,
       b.betrieb_key,
       coalesce(b.name, z.betrieb) AS betrieb,
       z.konzept                   AS konzept_ladenakte,
       stt.status                  AS betrieb_status,
       (stt.status = 'operativ')   AS operativ,
       a.typ_id,
       a.name                      AS ordner,
       a.reihenfolge,
       s.soll_anzahl               AS soll,
       (s.lina_betrieb_id IS NOT NULL) AS soll_bekannt,
       t.records_total,
       t.archivierte_enthalten,
       t.gemessen_am               AS letzte_zaehlung,
       coalesce(i.ist, 0)          AS ist,
       coalesce(t.records_total, s.soll_anzahl) - coalesce(i.ist, 0) AS fehlend,
       round(100.0 * coalesce(i.ist, 0)
             / nullif(coalesce(t.records_total, s.soll_anzahl), 0), 1) AS fortschritt_prozent
  FROM manual.belegarchiv_zaehlung z
  CROSS JOIN core.belegart a
  LEFT JOIN core.betrieb b            ON b.lina_betrieb_id = z.lina_betrieb_id
  LEFT JOIN mart.betrieb_status stt   ON stt.betrieb_key   = b.betrieb_key
  LEFT JOIN manual.belegarchiv_soll s ON s.lina_betrieb_id = z.lina_betrieb_id
                                     AND s.typ_id          = a.typ_id
  LEFT JOIN ist i                     ON i.betrieb_key     = b.betrieb_key
                                     AND i.typ_id          = a.typ_id
  LEFT JOIN bestand t                 ON t.betrieb_key     = b.betrieb_key
                                     AND t.typ_id          = a.typ_id
 ORDER BY (coalesce(t.records_total, s.soll_anzahl) - coalesce(i.ist, 0)) DESC NULLS LAST;

COMMENT ON VIEW mart.belegarchiv_fehlend IS
'Soll gegen Bestand gegen Ist, je Betrieb und Ordner — die Arbeitsliste und der
Fortschrittsbalken des Backfills, nach Fehlmenge sortiert. 1.834 Zeilen (131 gezaehlte
Betriebe x 14 Ordner).
soll_bekannt = false heisst "dieser Ordner wurde am 11.08.2026 nie gezaehlt" und ist
AUSDRUECKLICH KEIN FEHLER — das betrifft die typeId 16, 3968, 3969, 3971, 3972 und 3976,
also 786 der 1.834 Zeilen. Ohne diese Spalte meldete die Sicht dort dauerhaft
Vollstaendigkeit, die nie geprueft wurde.
fehlend rechnet gegen records_total, wenn LINA schon gezaehlt hat, sonst gegen den
Sollwert. Eine NEGATIVE Fehlmenge ist ein Befund und kein Rundungsfehler; sie steht in
mart.belegarchiv_pruefung.
archivierte_enthalten sagt, ob der Bestand mit showArchived gezaehlt wurde. Ob die
Erhebung vom 11.08.2026 das tat, ist NICHT bekannt — eine systematische Dauerdifferenz
kann daher rein methodisch sein.';


-- ---------------------------------------------------------------------
-- Selbstpruefung — Erwartung: leer
--
-- Ein UNION ALL ueber Befunde mit einheitlichem Spaltenschnitt, Muster
-- mart.zeitfenster_pruefung. Zwei der Befunde beantworten offene
-- Messfragen von selbst, sobald der erste volle Lauf durch ist: ob LINAs
-- id global eindeutig ist, und ob taxItems Netto oder Steuer enthaelt.
--
-- Befund 1 und 2 brauchen KEINEN einzigen LINA-Aufruf und muessen deshalb
-- VOR dem ersten Abzug leer sein — hinterher kosten sie 3.000 Anfragen.
--
-- Die Sicht liest mehrfach ueber die ganze Tabelle. Sie ist ein
-- Diagnosewerkzeug und gehoert in src/status.ts als zehnte Pruefung,
-- nicht auf eine Dashboard-Kachel mit Autorefresh.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.belegarchiv_pruefung AS
WITH ist AS (
  SELECT betrieb_key, typ_id, count(*) AS c
    FROM core.buchungsbeleg GROUP BY betrieb_key, typ_id
), bestand AS (
  SELECT DISTINCT ON (betrieb_key, typ_id) betrieb_key, typ_id, records_total
    FROM core.belegarchiv_bestand
   ORDER BY betrieb_key, typ_id, gemessen_am DESC
), soll_summe AS (
  SELECT lina_betrieb_id, sum(soll_anzahl) AS summe
    FROM manual.belegarchiv_soll GROUP BY lina_betrieb_id
)
-- 1. Laeuft ohne LINA: kennt core.betrieb alle 131 gezaehlten Betriebe?
SELECT 'Gezaehlter Betrieb fehlt in core.betrieb'::text AS befund,
       z.lina_betrieb_id, z.betrieb, NULL::text AS typ_id,
       z.summe::numeric AS zahl_a, NULL::numeric AS zahl_b,
       z.konzept AS beispiel
  FROM manual.belegarchiv_zaehlung z
  LEFT JOIN core.betrieb b ON b.lina_betrieb_id = z.lina_betrieb_id
 WHERE b.betrieb_key IS NULL
UNION ALL
-- 2. Laeuft ohne LINA: ist lina_betrieb_id in core.betrieb eindeutig?
SELECT 'lina_betrieb_id mehrfach in core.betrieb',
       b.lina_betrieb_id, string_agg(b.name, ' | ' ORDER BY b.name), NULL,
       count(*)::numeric, NULL, NULL
  FROM core.betrieb b
 WHERE b.lina_betrieb_id IS NOT NULL
 GROUP BY b.lina_betrieb_id
HAVING count(*) > 1
UNION ALL
-- 3. Beantwortet nach dem ersten Lauf, ob LINAs id global eindeutig ist.
SELECT 'lina_id kommt in mehreren Betrieben vor',
       NULL, NULL, NULL,
       count(DISTINCT bl.betrieb_key)::numeric, count(*)::numeric, bl.lina_id
  FROM core.buchungsbeleg bl
 GROUP BY bl.lina_id
HAVING count(DISTINCT bl.betrieb_key) > 1
UNION ALL
-- 4. Die Quelle prueft unsere Betriebszuordnung, nicht wir.
SELECT 'parashift_id nennt einen anderen Betrieb',
       bl.lina_betrieb_id, b.name, bl.typ_id,
       count(*)::numeric, NULL, min(bl.parashift_id)
  FROM core.buchungsbeleg bl
  JOIN core.betrieb b ON b.betrieb_key = bl.betrieb_key
 WHERE bl.parashift_id IS NOT NULL
   AND split_part(bl.parashift_id, '_', 1) <> bl.lina_betrieb_id::text
 GROUP BY bl.lina_betrieb_id, b.name, bl.typ_id
UNION ALL
-- 5. Steht der Beleg im Ordner, den sein eigenes Feld belegart nennt?
SELECT 'belegart am Satz weicht vom Ordner ab',
       bl.lina_betrieb_id, b.name, bl.typ_id,
       count(*)::numeric, NULL, bl.belegart_roh
  FROM core.buchungsbeleg bl
  JOIN core.betrieb b ON b.betrieb_key = bl.betrieb_key
 WHERE bl.belegart_roh IS NOT NULL
   AND btrim(bl.belegart_roh) <> bl.typ_id
 GROUP BY bl.lina_betrieb_id, b.name, bl.typ_id, bl.belegart_roh
UNION ALL
-- 6. Ohne Datum faellt der Beleg aus jeder Monatsauswertung.
SELECT 'Beleg ohne Belegdatum',
       bl.lina_betrieb_id, b.name, bl.typ_id,
       count(*)::numeric, NULL, min(bl.lina_id)
  FROM core.buchungsbeleg bl
  JOIN core.betrieb b ON b.betrieb_key = bl.betrieb_key
 WHERE bl.beleg_datum IS NULL
 GROUP BY bl.lina_betrieb_id, b.name, bl.typ_id
UNION ALL
-- 7. Der Verdacht auf einen Parsefehler bei der deutschen Zahl.
SELECT 'netto fehlt trotz abgeschlossener OCR',
       bl.lina_betrieb_id, b.name, bl.typ_id,
       count(*)::numeric, NULL, min(bl.lina_id)
  FROM core.buchungsbeleg bl
  JOIN core.betrieb b ON b.betrieb_key = bl.betrieb_key
 WHERE bl.netto IS NULL AND bl.parashift_status = 'done'
 GROUP BY bl.lina_betrieb_id, b.name, bl.typ_id
UNION ALL
-- 8. Beantwortet, ob taxItems Netto oder Steuer enthaelt.
SELECT 'Summe taxItems weicht von netto ab',
       bl.lina_betrieb_id, b.name, bl.typ_id,
       count(*)::numeric, round(avg(x.s - bl.netto), 2), min(bl.lina_id)
  FROM core.buchungsbeleg bl
  JOIN core.betrieb b ON b.betrieb_key = bl.betrieb_key
  JOIN LATERAL (SELECT sum(st.betrag) AS s
                  FROM core.buchungsbeleg_steuer st
                 WHERE st.buchungsbeleg_key = bl.buchungsbeleg_key) x ON true
 WHERE bl.netto IS NOT NULL AND x.s IS NOT NULL
   AND abs(x.s - bl.netto) > 0.02
 GROUP BY bl.lina_betrieb_id, b.name, bl.typ_id
UNION ALL
-- 9. Ist encryptedId ein Schluessel oder eine Momentaufnahme?
SELECT 'encrypted_id mehrfach vergeben',
       NULL, NULL, NULL,
       count(*)::numeric, NULL, bl.encrypted_id
  FROM core.buchungsbeleg bl
 WHERE bl.encrypted_id IS NOT NULL
 GROUP BY bl.encrypted_id
HAVING count(*) > 1
UNION ALL
-- 10. Mehr geladen als die Quelle meldet — dann stimmt die Zaehlung nicht.
SELECT 'Mehr Belege geladen als LINA meldet',
       b.lina_betrieb_id, b.name, i.typ_id,
       i.c::numeric, t.records_total::numeric, NULL
  FROM ist i
  JOIN bestand t   ON t.betrieb_key = i.betrieb_key AND t.typ_id = i.typ_id
  JOIN core.betrieb b ON b.betrieb_key = i.betrieb_key
 WHERE i.c > t.records_total
UNION ALL
-- 11. Sollbestand vorhanden, aber nicht eine einzige Zeile geladen.
SELECT 'Betrieb mit Sollbestand, aber ohne jeden Beleg',
       z.lina_betrieb_id, coalesce(b.name, z.betrieb), NULL,
       z.summe::numeric, NULL, NULL
  FROM manual.belegarchiv_zaehlung z
  LEFT JOIN core.betrieb b ON b.lina_betrieb_id = z.lina_betrieb_id
 WHERE z.summe > 0
   AND b.betrieb_key IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM core.buchungsbeleg bl
                    WHERE bl.betrieb_key = b.betrieb_key)
UNION ALL
-- 12. Die Summenprobe der Zaehlung — der CHECK der breiten Form,
--     nachgebaut fuer die lange. Faengt einen Uebertragungsfehler
--     zwischen den beiden Tabellen ab.
SELECT 'Lange und breite Zaehlung weichen ab',
       z.lina_betrieb_id, z.betrieb, NULL,
       z.summe::numeric, s.summe, NULL
  FROM manual.belegarchiv_zaehlung z
  LEFT JOIN soll_summe s ON s.lina_betrieb_id = z.lina_betrieb_id
 WHERE coalesce(s.summe, -1) <> z.summe;

COMMENT ON VIEW mart.belegarchiv_pruefung IS
'Selbstpruefung des Belegarchivs, ERWARTUNG: LEER. Ein UNION ALL ueber zwoelf Befunde mit
einheitlichem Spaltenschnitt (befund, lina_betrieb_id, betrieb, typ_id, zahl_a, zahl_b,
beispiel).
BEFUND 1 UND 2 LAUFEN OHNE EINEN EINZIGEN LINA-AUFRUF und muessen VOR dem ersten Abzug leer
sein: core.betrieb fuehrt 141 Zeilen mit nullable lina_betrieb_id, die Ladenakte kennt 131
Einheiten, und core.buchungsbeleg.betrieb_key ist NOT NULL mit Fremdschluessel. Fehlt ein
Betrieb, bricht der Posten laut ab — richtige Richtung, aber teuer nach 3.000 Anfragen.
Befund 2 verhindert zusaetzlich stillen Fan-out in mart.belegarchiv_fehlend.
ZWEI BEFUNDE BEANTWORTEN OFFENE MESSFRAGEN: Befund 3 sagt nach dem ersten vollen Lauf, ob
LINAs id global oder nur je Mandant eindeutig ist — bleibt er leer, ist der zusammengesetzte
Schluessel belegt und ein zusaetzliches UNIQUE eine Zeile Migration. Befund 8 sagt, ob
taxItems Nettobetraege oder Steuerbetraege enthaelt; zahl_b traegt die mittlere Abweichung.
Befund 9 sagt, ob encryptedId ein speicherbarer Downloadschluessel ist oder eine
Momentaufnahme — davon haengt die Planung von Stufe 2 ab.
Gehoert als zehnte Pruefung nach src/status.ts.';
