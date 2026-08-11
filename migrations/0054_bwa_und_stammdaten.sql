-- =====================================================================
-- 0054 BWA-Longterm und Ladenstamm — die Historie seit 2009, der Plan,
--      die Sitzplaetze
--
-- ANLASS (11.08.2026, docs/lina-api-inventar-ladenakte.md, Abschnitt 3):
-- "longterm liefert in einer einzigen Antwort 207 Monatsspalten, 06/2009
-- bis 08/2026, und 103 Zeilen (77 davon mit Inhalt). Das ist die mit
-- Abstand guenstigste Datenquelle im ganzen Projekt — guenstiger noch als
-- getKennzahlen mit zwei Aufrufen je Jahr, und sie reicht sechs Jahre
-- weiter zurueck."
--
-- Dazu aus Abschnitt 4: "Ermoeglicht Umsatz je Sitzplatz und Umsatz je
-- qm. Beides stand auf der Round-Table-Wunschliste und galt als nicht
-- verfuegbar." Und: "Plan gegen Ist wird damit rechenbar, auf derselben
-- Zeilenstruktur wie BWA-Longterm."
--
-- ---------------------------------------------------------------------
-- WOHER DIE DATEN KOMMEN — UND WOHER NICHT
--
-- HER:  GET /finanzen/bwa/longterm?module=franchise&laden=<hash>
--       HTML, 0,14 bis 1,21 MB je Betrieb, eine Anfrage fuer die ganze
--       Historie. 131 Anfragen, rund 120 MB.
--       GET /intranet/ladenakte/ladenstamm/laden/<hash>/admin/1/
--       HTML, rund 317 KB. Darin Kapazitaet, Plan-BWA und Tagesbudget.
--       GET /intranet/ladenakte/getplanbwa/?laden=<hash>&monat=&jahr=
--       fuer weitere Planjahre.
--
-- NICHT: Vertraege. Ausdrueckliche Entscheidung des Nutzers vom
--       11.08.2026 — aus den Stammdaten kommen drei Tabellen
--       (Kapazitaet, Plan-BWA, Tagesbudget), Vertraege nicht. Dazu
--       kommt die Loeschfalle: auf der Vertraege-Seite ist LOESCHEN EIN
--       GEWOEHNLICHER GET-LINK
--       (.../vertraege/laden/<hash>/vertragid/<id>/delete/1). Ein
--       Parser, der Links verfolgt, loescht Vertraege. Deshalb im Code:
--       keine Linkverfolgung, nur zusammengesetzte URLs aus einer
--       Positivliste, und delete/edit/upload/add/set als Pfadsegmente
--       hart gesperrt.
--
-- NICHT: Gesellschafter und Anteile, Geschaeftsfuehrer, API-Keys. Die
--       Schluesselwerte sind Zugangsdaten (Regel 2) und stehen bewusst
--       nirgends im Repository.
--
-- NICHT: eine feste Spaltenzahl. Gemessen an 10 Betrieben am 11.08.2026:
--       20 bis 224 Monatsspalten, frueheste Spalte 06/2009. Ratskeller
--       Augsburg 224 Spalten mit Werten 01/12 bis 06/26, Schlager Cafe
--       Duesseldorf 20 Spalten 01/25 bis 03/26, CONCEPT FAMILY
--       Franchise AG 80 Spalten und NULL Werte. Deshalb LANG statt
--       breit: eine Zeile je Betrieb, Monat und BWA-Zeile.
--
-- ---------------------------------------------------------------------
-- DIE FALLEN, DURCHNUMMERIERT
--
-- 1. STRUKTUR IST NICHT DASSELBE WIE WERT. Die CONCEPT FAMILY
--    Franchise AG liefert 80 Spalten und keinen einzigen Wert. Wer aus
--    "Tabelle vorhanden" auf "Daten vorhanden" schliesst, importiert
--    Nullen und meldet ok — derselbe leise Ausfalltyp wie bei
--    getKennzahlen. DESHALB WERDEN LEERE ZELLEN GESCHRIEBEN, mit
--    betrag NULL. Damit gilt im Fakt selbst:
--
--      Zeile vorhanden, betrag NULL  = Spalte existierte, nicht gebucht
--      keine Zeile                   = dieser Betrieb ist nicht abgerufen
--      betrag = 0,00                 = gebucht, null Euro
--
--    Das kostet rund 0,5 Mio zusaetzliche Zeilen (Erwartung 1,64 Mio
--    statt 1,10 Mio) und spart eine Protokolltabelle daneben, die vom
--    Fakt abdriften koennte. NIE 0 FUER EINE LEERE ZELLE: 0,00 ist ein
--    gebuchter Wert, leer ist keiner. Das ist die direkte Lehre aus
--    0009 — dort kamen ungebuchte Monate als 0,00 an, und "niedriger
--    ist besser" machte daraus vier gruene Monate fuer alle 131
--    Betriebe.
--    Preis, den man kennen muss: count(*) zaehlt Monate MIT UND OHNE
--    Wert, count(betrag) nur die gebuchten. Wer den Unterschied nicht
--    kennt, meldet dem Park Cafe Muenchen 212 Monate statt 162.
--    mart.bwa_longterm_stand liefert beide Zahlen nebeneinander.
--
-- 2. DIE ABGESCHNITTENE BESCHRIFTUNG IST DER SCHLUESSEL. LINA liefert
--    im Longterm-HTML keine Zeilen-ID; die Zeile wird ueber ihre
--    Beschriftung getroffen, nie ueber den Index (ausdrueckliche
--    Vorgabe der Erhebung). Die Beschriftungen sind teils serverseitig
--    gekuerzt: "Freiwillige soz. Auf", "Abschluss-/Pruefungsk". Sie
--    werden WOERTLICH uebernommen und NICHT repariert — die
--    Auffuellung waere eine Vermutung, und schriebe LINA morgen
--    "Freiwillige soz. Aufw", entstuende still eine zweite Kennzahl,
--    waehrend die erste einfach aufhoert. Kein Fehler, sondern eine
--    Zeitreihe, die abreisst.
--    Die Deutung liegt eine Ebene hoeher in manual.bwa_zeile, per LEFT
--    JOIN und AUSDRUECKLICH OHNE Fremdschluessel: eine unbekannte
--    Beschriftung darf den Import nicht abbrechen, sie soll auffallen.
--    Die Arbeitsliste ist mart.bwa_zeile_ungepflegt, nach Volumen
--    sortiert; danach ist dieselbe Sicht der Waechter gegen eine
--    geaenderte Abschneidelaenge. Sie gehoert deshalb in die zehnte
--    Pruefung von src/status.ts und nicht nur auf ein Dashboard.
--
-- 3. zeile_nr IST EIN ATTRIBUT, KEIN SCHLUESSEL. Die Position in der
--    gerenderten Tabelle (1 bis 103) wird mitgefuehrt, damit die
--    Reihenfolge rekonstruierbar bleibt und ein Umbau der Tabelle
--    auffaellt. Waere sie Teil des Schluessels, liesse eine
--    eingeschobene Gliederungsleerzeile beim naechsten Lauf jede Zeile
--    darunter als neuen Datensatz erscheinen.
--
-- 4. PLAN UND IST BLEIBEN ZWEI TABELLEN, obwohl die Koernung identisch
--    ist. Eine gemeinsame Tabelle mit art IN (''ist'',''plan'') waere
--    eleganter und machte den Vergleich zum Self-Join — aber jede
--    vergessene WHERE-Bedingung verdoppelte dann jede Summe, und das
--    meldet sich nie. Zwei Wertspalten in einer Zeile scheitern am
--    zweiten Grund: zwei Ladewege schrieben dieselbe Zeile, und raw_id
--    koennte nicht mehr sagen, woher der Wert stammt. Die drei
--    Schluesselspalten sind bewusst gleich benannt, damit der Vergleich
--    ein Join ueber drei gleichnamige Spalten ist.
--
-- 5. ZWEI BWA-WAHRHEITEN, UND DIESE MIGRATION ENTSCHEIDET SIE NICHT.
--    core.bwa_position (Longterm, 77 Zeilen, ab 2009) ueberschneidet
--    sich mit core.kennzahlen_monat und mart.bwa_kennzahl
--    (getKennzahlen, fuenf Kennzahlen, kuerzere Historie). Die
--    Beschriftungen passen nicht aufeinander: dort Umsatz, EBIT, WE
--    Bar, WE Kueche, Personalkosten ohne GF — hier Gesamtleistung,
--    Erg.v Zins/Tax(EBIT), WE Getraenke, WE Speisen, Personalkosten
--    o.G. Zwei Zahlen fuer dieselbe Kennzahl sind schlimmer als eine
--    unvollstaendige. mart.bwa_quellen_vergleich macht die Differenz je
--    Betrieb und Monat sichtbar; die Vorrangregel ist eine fachliche
--    Festlegung und gehoert nach docs/entscheidungen.md, BEVOR eine
--    Round-Table-Karte von mart.bwa_kennzahl auf die neue Quelle
--    umgestellt wird. Faellt sie zugunsten von Longterm, haengen
--    mart.round_table_basis, mart.bwa_rueckstand und
--    core.bwa_buchungsstand mit daran.
--
-- 6. KEINE SNAPSHOT-DIMENSION IM SCHLUESSEL — ANDERS ALS 0003, UND MIT
--    GRUND. core.kennzahlen_monat traegt abgerufen_am im
--    Primaerschluessel, weil der Steuerberater rueckwirkend korrigiert.
--    Dieselbe Bauform hier waere ruinoes, und zwar wegen der KOERNUNG:
--    getKennzahlen liefert fuenf Kennzahlen je Betrieb und Jahr,
--    longterm liefert die GANZE Historie in einer Antwort. Ein Vollzug
--    sind rund 1,6 Mio Zeilen; mit abgerufen_am im Schluessel kostete
--    jeder monatliche Nachlauf weitere 1,6 Mio, also gut 19 Mio Zeilen
--    im Jahr, fuer eine Information, die zu ueber 99 Prozent
--    unveraendert ist. Der Stand des letzten Abrufs steht deshalb als
--    ATTRIBUT in abgerufen_am; die vollstaendige Snapshot-Historie
--    liegt in raw.api_antwort.payload_text, wo jede der 131 Antworten
--    mit ihrem abgerufen_am steht. Wer den Stand vom Mai braucht,
--    parst raw neu. Dass das geht, ist belegt: 0043 hat 13.254
--    Positionen aus raw neu gerechnet, ohne einen einzigen erneuten
--    Abruf.
--
-- 7. KAPAZITAET HAT KEIN GUELTIGKEITSDATUM IN DER QUELLE. Plaetze,
--    Tische und Flaeche sind ein heutiger Stand; die Quelle sagt nicht,
--    seit wann er gilt. Umsatz je Sitzplatz fuer 2019 mit der
--    Bestuhlung von 2026 zu rechnen ist genau die Sorte plausibel
--    falscher Zahl, die dieses Projekt mehrfach getroffen hat. Deshalb
--    ist core.betrieb_kapazitaet eine MONATSMOMENTAUFNAHME mit monat im
--    Schluessel — wie core.artikel_stand —, und mart.umsatz_je_sitzplatz
--    nimmt per LATERAL den JUENGSTEN Stand bis zum Auswertungsmonat,
--    NICHT den Stand desselben Monats. Ein Join auf Monatsgleichheit
--    liesse die Kennzahl fuer elf von zwoelf Monaten leer, und das saehe
--    aus wie fehlender Umsatz. Genau dieser Fehler steht im
--    Fehlerkatalog unter "Der Wareneinsatzansatz wurde nie gefunden".
--
-- 8. DIE KAPAZITAETSBEREICHE SIND UNGEPFLEGT UND SUMMIEREN SICH NICHT
--    AUF GESAMT. Karlsruhe am 11.08.2026: Zeile Gesamt 632 Plaetze und
--    339 qm, daneben Biergarten 1 mit 250, "Umsatz 19%" mit 304 (das
--    ist kein Bereich, das ist ein Steuersatz) und Theke mit 32 —
--    zusammen 586 gegen 632. Wer ueber alle Zeilen summiert, zaehlt
--    zusaetzlich die Gesamtzeile mit und liegt doppelt daneben.
--    DESHALB drei Vorkehrungen: kein CHECK auf dem Bereichsnamen, ein
--    partieller UNIQUE-Index, der hoechstens EINE Gesamtzeile je
--    Betrieb und Monat zulaesst (damit mart.umsatz_je_sitzplatz nicht
--    still Fan-out erzeugt und den Umsatz vervielfacht), und
--    mart.betrieb_kapazitaet als einzige erlaubte Zugriffsstelle mit
--    den Kennzeichen ohne_gesamtzeile und summe_weicht_ab.
--    Findet sich keine Gesamtzeile, bleiben plaetze und flaeche_qm
--    NULL — kein Ersatzwert, keine Summe, keine geratene Zahl.
--
-- 9. DER SCHLUESSEL DER KAPAZITAET IST zeile_nr UND NICHT DER
--    BEREICHSNAME. Zwei gleichnamige Bereichszeilen — zwei Biergaerten
--    mit je 125 Plaetzen — verschmelzen bei einem Namensschluessel im
--    Upsert lautlos zu einer: aus 250 werden 125, und der Verlust steht
--    nirgends ausser in raw. Der Zeilenindex verschmilzt nichts.
--
-- 10. GESCHAEFTSTAG ODER KALENDERTAG IST BEIM TAGESBUDGET NICHT
--    GEMESSEN. LINA nennt die Spalte im Stammdatenblatt schlicht
--    "Datum". Unser Geschaeftstag laeuft 08:00 bis 07:59. Die Spalte
--    heisst deshalb bewusst datum und nicht geschaeftstag: der Name
--    wuerde eine Tagesgrenze behaupten, die niemand geprueft hat, und
--    ein Plan-Ist-Vergleich kann um einen Tag verschoben sein, ohne
--    dass die Groessenordnung stutzig macht. Die Uebersetzung passiert
--    sichtbar in mart.tagesbudget. Gegenprobe vor der ersten
--    Auswertung: einen Sonntag mit hohem Nachtanteil Plan gegen Ist
--    halten.
--    (Nebenbei richtiggestellt, weil es im Umlauf war:
--    core.partition_anlegen() springt NICHT von selbst auf einen
--    Spaltennamen an — sie nimmt die Tabelle als Parameter und muss
--    gerufen werden. Sie kennt allerdings nur die Datumsspaltennamen
--    abgerufen_am und geschaeftstag, und wer sie hier je riefe, bekaeme
--    einen BRIN auf eine nicht existierende Spalte. Hier wird nicht
--    partitioniert.)
--
-- 11. 366 ZEILEN JE JAHR, AUCH IN NICHTSCHALTJAHREN. Die Quelle liefert
--    das Tagesbudget mit fester Zeilenzahl. Eine Zeile zum 29.02. eines
--    Nichtschaltjahrs scheitert beim Einlesen als Datum und muss im
--    Lader abgefangen werden, statt die Transaktion zu kippen.
--
-- 12. PLAN UND TAGESBUDGET SIND OHNE HISTORIE. Beide werden per Upsert
--    ueberschrieben. Wird ein Plan im Maerz revidiert, ist der
--    urspruengliche Plan aus core weg, und "Plantreue" misst danach
--    gegen den nachtraeglich angepassten Plan — der Fehler faellt nie
--    auf, weil das Ergebnis immer besser aussieht. Solange die
--    raw-Monatspartitionen leben, ist der alte Plan aus dem HTML
--    rekonstruierbar; genau deshalb haengt Punkt 14 daran. Soll
--    Plantreue je eine Kennzahl werden, muss stand_am VORHER in den
--    Schluessel — rueckwirkend ist es nicht nachholbar.
--
-- 13. MIGRATIONSNUMMERN UND PARALLELSESSION. Der Runner sortiert
--    alphabetisch und merkt sich Dateinamen, nicht Nummern: zwei
--    Dateien mit derselben Nummer laufen beide. Genau das ist bei 0009
--    und 0039 passiert, beide Male durch parallel arbeitende Sessions.
--    0051 und 0052 sind im Git ungetrackt. Vor dem Anlegen erneut
--    ls migrations/ und
--    SELECT filename FROM public.schema_migration ORDER BY
--    angewendet_am DESC LIMIT 5.
--
-- 14. AUFBEWAHRUNGSFRIST FUER raw ENTSCHEIDEN, BEVOR DER ZWEITE
--    DURCHGANG LAEUFT. Ein voller BWA-Durchgang sind 131 Antworten mit
--    zusammen rund 120 MB; bei monatlichem Nachlauf rund 1,4 GB im
--    Jahr. raw.api_antwort ist monatlich nach abgerufen_am
--    partitioniert, genau damit sich ein Zeitraum als Ganzes wegwerfen
--    laesst (COMMENT in 0003). Die Frist ist damit eine Entscheidung
--    und kein Aufraeumproblem — aber eine Versicherung, deren Police
--    still ablaeuft, ist keine, und an ihr haengen die Snapshot-
--    Historie (Falle 6) und die Planhistorie (Falle 12).
--
-- ---------------------------------------------------------------------
-- ENTSCHIEDENE WIDERSPRUECHE
--
-- (a) betrag_vorher UND geaendert_am AN core.bwa_position (von einem der
--     drei Urteile ausdruecklich empfohlen) WERDEN NICHT UEBERNOMMEN.
--     Zwei Gruende, beide durchschlagend. Erstens sind sie ABGELEITETER
--     LAUFZUSTAND und damit das Einzige in diesem Schema, das sich nicht
--     aus raw rekonstruieren liesse, sobald eine Monatspartition
--     entsorgt ist (Falle 14). Zweitens widersprechen sie der
--     Ladervorschrift unten: ein Loeschen und Neuschreiben je Betrieb
--     vernichtet betrag_vorher und setzt geaendert_am fuer alle Zellen
--     auf now(). Der Aenderungsmelder meldete dann entweder alles oder
--     nichts, und zwar still. Was er leisten sollte — "der
--     Steuerberater hat Maerz nachgebucht" —, leistet raw.api_antwort:
--     payload_hash je Antwort, und gleicher Hash heisst fachlich nichts
--     geaendert.
--
-- (b) mart.bwa_position ALS NAME FUER DIE PLAN-IST-SICHT. Verworfen.
--     Eine Sicht mit Plan und Ist, die genauso heisst wie die
--     Ist-Tabelle darunter, erzeugt eine falsche Antwort ohne
--     Fehlermeldung: wer in Metabase core.bwa_position anklickt oder in
--     einer Abfrage das Schema vergisst, bekommt eine Auswertung ohne
--     Plan und merkt nichts. Die Sicht heisst mart.bwa_plan_ist, die
--     lesbare Ist-Reihe heisst mart.bwa_longterm.
--
-- (c) EIGENE TABELLE core.bwa_longterm_stand FUER DIE GEOMETRIE. Nicht
--     gebaut. Sie waere eine Nebenbuchhaltung neben dem Fakt, die von
--     ihm abdriften kann; seit leere Zellen geschrieben werden (Falle
--     1), steht dieselbe Auskunft im Fakt selbst und
--     mart.bwa_longterm_stand rechnet sie daraus.
--
-- ---------------------------------------------------------------------
-- WAS DER LADER TUN MUSS, WAS DAS SCHEMA NICHT ERZWINGEN KANN
--
--  * core.bwa_position JE BETRIEB LOESCHEN UND NEU SCHREIBEN, nicht nur
--    upserten. Verschwindet eine Zeile aus LINAs Tabelle oder aendert
--    sich ihre Beschriftung, bliebe die alte sonst als Karteileiche
--    stehen und fiele in jede Summe ueber die Zeilen eines Blocks.
--    Gehoert in einen e2e-Test, der EINEN Betrieb zweimal mit
--    unterschiedlicher Zeilenzahl laedt und danach zaehlt.
--  * raw.api_antwort.betrieb_enc_id MITSCHREIBEN, und zwar
--    core.betrieb.enc_id — nicht den je Anfrage neu gesalzenen
--    laden-Parameter (84 hex). Nur ueber den Index (betrieb_enc_id,
--    endpunkt, abgerufen_am DESC) aus 0003 ist die Rohantwort eines
--    Betriebs spaeter wiederzufinden; ohne ihn ist eine Neuableitung
--    ein Full Scan ueber 120 MB HTML.
--  * DEN GESALZENEN laden-TOKEN AUS parameter MASKIEREN, die
--    Ordnungsschluessel behalten.
--  * NUR ZELLEN MIT WERT bekommen einen Betrag; leere Zellen bekommen
--    eine Zeile mit betrag NULL. Niemals 0 (Falle 1).
--  * Das ALTER TABLE unten nimmt ACCESS EXCLUSIVE auf raw.api_antwort
--    UND auf jedes Partitionskind, und weil die ganze Migration eine
--    einzige Transaktion ist, wird die Sperre bis COMMIT gehalten. Bei
--    rund 14 Monatspartitionen ist das ein Wimpernschlag — aber nicht
--    neben einem laufenden Importer. DIESE MIGRATION GEHOERT VOR DEN
--    LAUFSTART, nicht daneben.
-- =====================================================================


-- ---------------------------------------------------------------------
-- raw bekommt eine Textspalte — die eine Entscheidung, die vor dem
-- ersten HTML-Abruf fallen muss
--
-- raw ist append-only (AGENTS.md Regel 4). Eine spaeter nachgeschobene
-- Migration kann falsch abgelegte Zeilen nicht reparieren; sie duerfte
-- sie nicht einmal anfassen. Nach dem ersten BWA-Lauf liegen 120 MB in
-- der einmal gewaehlten Form. Von den beiden Wegen ist also der zu
-- waehlen, der in zwei Jahren noch lesbar ist, nicht der, der heute
-- keine Migration braucht.
--
-- VERWORFEN: JSON.stringify(html) als JSON-Skalar in payload. Braucht
-- keine Migration und ist deshalb verfuehrerisch. Vier Gruende dagegen:
--   1. Es mischt zwei Bedeutungen in eine Spalte. payload hiesse dann
--      "die geparste Antwort ODER eine Zeichenkette, die das ganze
--      Dokument ist", und jede spaetere Auswertung des Rohbestands
--      muesste wissen oder per jsonb_typeof pruefen, welcher Fall
--      vorliegt — genau die Sorte stilles Wissen, die dieses Projekt
--      sonst in COMMENTs zwingt.
--   2. Jeder Lesezugriff wuerde zu payload #>> '{}'. Unbequem genug,
--      dass jemand ihn beim naechsten Mal vermeidet und lieber neu
--      abruft. Genau das soll raw verhindern.
--   3. jsonb normalisiert und escapet. Ein 1,2-MB-HTML mit tausenden
--      Anfuehrungszeichen und Backslashes wird groesser, und die
--      Binaerform bringt fuer einen Skalar keinen Gegenwert: kein
--      Pfadzugriff, keine Indizierbarkeit, nur Umbau.
--   4. Der Weg hierher ist billig: eine nullable Spalte ohne DEFAULT
--      ist in Postgres ein Katalogeintrag und kein Rewrite, und sie
--      propagiert auf alle Partitionskinder in part.
--
-- KEIN CHECK ueber die beiden Spalten. Ein "genau eine der beiden ist
-- gefuellt" muesste den gesamten Bestand aus 14 Monaten validieren und
-- koennte an einer einzigen Altzeile mit payload IS NULL scheitern —
-- und die sind der Normalfall, weil LINA fuer Betriebe ohne Daten HTTP
-- 500 mit leerem Body liefert (COMMENT in 0003). Die Zusicherung ist
-- eine Lader-Eigenschaft und gehoert in den zod-Test des GEPARSTEN
-- Ergebnisses, nicht in eine Zwangsbedingung auf einer append-only
-- Tabelle.
-- ---------------------------------------------------------------------
ALTER TABLE raw.api_antwort ADD COLUMN IF NOT EXISTS payload_text text;

COMMENT ON COLUMN raw.api_antwort.payload_text IS
'Der unveraenderte Antworttext bei HTML-Endpunkten. Genau eine der beiden Nutzlastspalten
ist gefuellt: payload bei JSON, payload_text bei HTML — bei HTML bleibt payload NULL und
nicht ''null''::jsonb, das waere ein Wert. Erzwungen wird das im Importer, NICHT per CHECK;
die Begruendung steht im Kopfblock dieser Migration.
Gemessen am 11.08.2026: BWA-Longterm liefert je Betrieb 0,14 bis 1,21 MB, ein voller
Durchgang ueber 131 Betriebe rund 120 MB. Bei monatlichem Nachlauf rund 1,4 GB im Jahr —
die Aufbewahrungsfrist der Monatspartitionen ist deshalb zu entscheiden, BEVOR der zweite
Durchgang laeuft.
payload_hash und payload_bytes werden weiterhin aus dem ROHTEXT gerechnet und bleiben
dadurch unveraendert gueltig. Gleicher Hash heisst fachlich nichts geaendert — bei 131
monatlichen BWA-Antworten ist das die billigste Aenderungserkennung, die es gibt, und sie
ersetzt eine Snapshot-Dimension in core.bwa_position.
Kein Index: 120 MB HTML werden gelesen, nicht durchsucht.';

COMMENT ON COLUMN raw.api_antwort.parameter IS
'Die gesendeten Query-Parameter. Macht jeden Aufruf reproduzierbar — MIT EINER AB 0053/0054
GELTENDEN AUSNAHME: die je Anfrage neu gesalzenen Token der Ladenakte (storeId 86 hex,
laden 84 hex) werden durch den Platzhalter <gesalzen> ersetzt. Sie machen den Aufruf nicht
reproduzierbar, sondern nur unvergleichbar, und 3.800 Zugangstoken in einer append-only
Tabelle sind das Gegenteil von Regel 2. Alles, was den Aufruf identifiziert
(linaBetriebId, typeId, start, length, monat, jahr), bleibt stehen — dass das reicht, ist
belegt: 0043 hat 13.254 Positionen ueber parameter->>''orderId'' aus raw neu gerechnet.';


-- ---------------------------------------------------------------------
-- Die BWA-Historie, lang
-- ---------------------------------------------------------------------
CREATE TABLE core.bwa_position (
    betrieb_key   integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat         date         NOT NULL,
    zeile         text         NOT NULL,
    zeile_id      text         NOT NULL,
    zeile_nr      smallint,
    betrag        numeric(14,2),
    abgerufen_am  timestamptz  NOT NULL,
    raw_id        bigint,
    geladen_am    timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile),
    -- Zweiter Schluessel auf derselben Zeile. Nicht redundant: er ist der
    -- BELASTBARE, waehrend der PK der LESBARE ist. Begruendung am Spaltenkommentar.
    CONSTRAINT bwa_position_zeile_id_uq UNIQUE (betrieb_key, monat, zeile_id),
    CONSTRAINT bwa_position_monatserster CHECK (monat = date_trunc('month', monat)::date)
);

COMMENT ON TABLE core.bwa_position IS
'BWA-Ist aus /finanzen/bwa/longterm, eine Zeile je Betrieb, Monat und BWA-Zeile.
Die groesste Einzelfundstelle des Projekts: 77 Zeilen mit Inhalt statt der fuenf aus
getKennzahlen, darunter Miete, Mietnebenkosten, Energiekosten, Franchisegebuehr, Bruch,
Skonto/Boni, Krankheit, Urlaub, davon Delivery, EBIT, EBT und EBITDA — Bloecke, die im
Bestand bisher ueberhaupt nicht vorkommen. Reicht zurueck bis 06/2009, also sechs Jahre
weiter als getKennzahlen.
KEINE FESTE SPALTENZAHL: gemessen an 10 Betrieben am 11.08.2026 zwischen 20 und 224
Monatsspalten. Erwartete Groesse (ERWARTUNG, nicht gemessen): rund 1,64 Mio Zeilen, davon
rund 1,10 Mio mit Betrag; rechnerische Obergrenze 131 x 224 x 77 = 2.259.488.
LEERE ZELLEN WERDEN GESCHRIEBEN. Zeile vorhanden und betrag NULL heisst "die Spalte gab
es, der Monat ist nicht gebucht"; keine Zeile heisst "dieser Betrieb wurde nicht
abgerufen"; betrag 0,00 heisst "gebucht, null Euro". Die drei zu verwechseln ist der
teuerste Fehler in dieser Tabelle. count(*) zaehlt Monate mit und ohne Wert,
count(betrag) nur die gebuchten — mart.bwa_longterm_stand liefert beide.
NICHT PARTITIONIERT und ohne Snapshot-Dimension; die Begruendung fuer den Unterschied zu
core.kennzahlen_monat steht im Kopfblock unter Falle 6.
Die 26 Gliederungsleerzeilen der 103 werden nicht geschrieben: sie tragen keine
Beschriftung und waeren damit nicht schluesselbar.';

COMMENT ON COLUMN core.bwa_position.zeile IS
'Die Beschriftung WOERTLICH wie geliefert, einschliesslich Abschneidung ("Freiwillige soz.
Auf", "Abschluss-/Pruefungsk"). Nicht normalisiert, nicht aufgefuellt, nicht repariert: die
Auffuellung waere eine Vermutung. Sie ist der PRIMAERSCHLUESSEL, weil sie lesbar ist und
weil manual.bwa_zeile die Deutung daran haengt — aber sie ist NICHT der verlaessliche
Schluessel. Der ist zeile_id. Die Arbeitsliste steht in mart.bwa_zeile_ungepflegt.';
COMMENT ON COLUMN core.bwa_position.zeile_id IS
'Die stabile Nummer der BWA-Zeile, 82 bis 162. HIER STAND ZUERST, DAS LONGTERM-HTML LIEFERE
KEINE ZEILEN-ID — das war falsch, und die Berichtigung ist der Grund fuer diese Spalte.
Jede Datenzeile traegt in ihrem Diagramm-Link ein /img/<nr>/, und das ist die Nummer.
Am 11.08.2026 an zwei sehr verschiedenen Betrieben gemessen — Schlager Cafe Duesseldorf mit
20 Monatsspalten und voller Buchung, CONCEPT FAMILY Franchise AG mit 80 Spalten und keinem
einzigen Wert: beide Male dieselben 77 Nummern in derselben Reihenfolge. Dieselben 77 fuehrt
das Stammdatenblatt in der Spalte ID der Plan-BWA.
WARUM DAS ZAEHLT: Plan und Ist kommen aus ZWEI VERSCHIEDENEN Seiten. Ein Join ueber die
Beschriftung setzt voraus, dass LINA denselben abgeschnittenen Text an beiden Stellen gleich
rendert. Am 11.08.2026 tat es das (77 von 77 gemessen) — aber es ist eine Zusicherung, die
niemand gegeben hat, und ein nicht getroffener Join meldet keinen Fehler, sondern liefert
eine leere Zeile. mart.bwa_plan_ist joint deshalb ueber zeile_id.
Die Nummer trennt ausserdem Daten von Layout: die 26 Gliederungsleerzeilen der 103 tragen
keine Nummer und werden gar nicht erst geschrieben.';
COMMENT ON COLUMN core.bwa_position.zeile_nr IS
'Position in der gerenderten Tabelle, 1 bis 103. NUR Anzeigereihenfolge und Driftmelder,
NIE Schluessel: Zeilen werden ueber die Beschriftung getroffen, nie ueber den Index
(ausdrueckliche Vorgabe der Erhebung vom 11.08.2026). Steht dieselbe Beschriftung je
Betrieb unter verschiedenen Nummern, hat LINA die Tabelle umgebaut — mart.bwa_pruefung
meldet das.';
COMMENT ON COLUMN core.bwa_position.betrag IS
'NULL heisst: die Spalte existierte, der Monat ist NICHT GEBUCHT. NIEMALS 0 dafuer
schreiben — 0,00 ist ein gebuchter Wert. Lehre aus 0009: ungebuchte Monate kamen dort als
0,00 an, und "niedriger ist besser" machte daraus vier gruene Monate fuer alle 131
Betriebe.';
COMMENT ON COLUMN core.bwa_position.abgerufen_am IS
'Zeitpunkt der Antwort, aus der dieser Stand stammt. Steht hier als eigene Spalte und nicht
nur als raw_id, weil raw.api_antwort partitioniert ist und PK (id, abgerufen_am) traegt:
ein Join allein ueber raw_id scannt jede Partition, mit beiden Spalten greift die
Partitionsauswahl.';

CREATE INDEX ON core.bwa_position (zeile, monat);
-- Fuer den Konzernblick auf EINE Kennzahl ("Mietaufwand aller Haeuser ueber
-- die Zeit"). Ohne ihn scannt genau diese, eigentlich neue Frage die ganze
-- Tabelle; der Primaerschluessel hilft dort nicht, weil betrieb_key fehlt.


-- ---------------------------------------------------------------------
-- Die Plan-BWA — dieselbe Zeilenstruktur, eigene Tabelle
-- ---------------------------------------------------------------------
CREATE TABLE core.bwa_plan (
    betrieb_key   integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat         date         NOT NULL,
    zeile         text         NOT NULL,
    -- NOT NULL, seit die Nummer auch auf der Ist-Seite steht: mart.bwa_plan_ist
    -- joint darueber, und ein NULL hier hiesse "diese Planzeile findet ihr Ist nie".
    zeile_id      text         NOT NULL,
    zeile_nr      smallint,
    betrag        numeric(14,2),
    abgerufen_am  timestamptz  NOT NULL,
    raw_id        bigint,
    geladen_am    timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile),
    CONSTRAINT bwa_plan_zeile_id_uq UNIQUE (betrieb_key, monat, zeile_id),
    CONSTRAINT bwa_plan_monatserster CHECK (monat = date_trunc('month', monat)::date)
);

COMMENT ON TABLE core.bwa_plan IS
'Plan-BWA aus dem Stammdatenblatt und /intranet/ladenakte/getplanbwa, in DERSELBEN
Koernung wie core.bwa_position und damit direkt dagegen rechenbar. 77 Zeilen mal 12 Monate
je Betrieb und Planjahr.
DAS IST DIE EINZIGE PLANUNGSGROESSE, DIE DAS PROJEKT UEBERHAUPT KENNT — Plan gegen Ist war
bisher nicht moeglich. Der Vergleich steht in mart.bwa_plan_ist.
Getrennt von core.bwa_position, weil zwei Ladewege niemals dieselbe Zeile beschreiben
duerfen und weil ein vergessenes WHERE bei einer gemeinsamen Tabelle jede Summe
verdoppelte (Kopfblock, Falle 4).
UPSERT OHNE HISTORIE: ein revidierter Plan ueberschreibt den alten. Bewusste Auslassung,
siehe Falle 12 — soll Plantreue je eine Kennzahl werden, muss stand_am VORHER in den
Schluessel.
Obergrenze 121.044 Zeilen je Planjahr (131 x 77 x 12), realistisch deutlich weniger: wie
viele Betriebe eine Plan-BWA pflegen, ist UNGEMESSEN. Gesehen wurde sie am 11.08.2026 an
genau einem Betrieb (Enchilada Karlsruhe, Planjahr 2025).';
COMMENT ON COLUMN core.bwa_plan.zeile IS
'Dieselbe Beschriftung wie in core.bwa_position, wortgleich. Genau darauf beruht die
Verbindbarkeit der beiden Tabellen; weicht sie ab, meldet es mart.bwa_pruefung.';
COMMENT ON COLUMN core.bwa_plan.zeile_id IS
'Die Spalte ID der Plan-BWA-Tabelle — LINAs EIGENE Zeilennummer, die es im Longterm-HTML
nicht gibt. Als text, weil Fremd-ID. Sie ist eine unabhaengige GEGENPROBE der
Beschriftungszuordnung und ausdruecklich NICHT der Schluessel: der bleibt die Beschriftung,
damit Plan und Ist ueber dieselbe Spalte finden. Ob Longterm dieselbe Numerierung benutzt,
ist ungemessen.';

CREATE INDEX ON core.bwa_plan (monat);


-- ---------------------------------------------------------------------
-- Die Deutung der BWA-Zeile — Pflege, keine Quelle
--
-- Wird LEER angelegt. Die 77 Beschriftungen sind nicht woertlich
-- erhoben: die Erhebung nennt sie in Prosa und teils normalisiert
-- ("Freiwillige soz. Auf." mit Punkt, "Abschluss/Pruefung" statt
-- "Abschluss-/Pruefungsk"). Ein Seed daraus waere eine zweite Wahrheit,
-- die vom ersten Tag an nicht trifft — und 77 geratene Zuordnungen zu
-- abgeschnittenen Beschriftungen waeren derselbe Fehler eine Ebene
-- hoeher. Die Pflege erfolgt nach dem ersten echten Parse; die
-- Arbeitsliste dafuer ist mart.bwa_zeile_ungepflegt.
--
-- Kein Fremdschluessel von den Fakten hierher: eine unbekannte
-- Beschriftung darf nichts blockieren, sie soll auffallen.
-- Geschluesselt ueber den TEXT und nicht ueber einen Surrogatschluessel
-- aus einer Importtabelle — ein Neuaufbau aus raw vergaebe Surrogate neu
-- und verzeigerte die Handarbeit lautlos falsch.
-- ---------------------------------------------------------------------
CREATE TABLE manual.bwa_zeile (
    zeile             text PRIMARY KEY,
    reihenfolge       smallint,
    block             text,
    summenzeile       boolean NOT NULL DEFAULT false,
    vorzeichen_kosten boolean NOT NULL DEFAULT false,
    kennzahl_bezug    text,
    notiz             text,
    gepflegt_am       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manual.bwa_zeile IS
'Die einzige Stelle, an der steht, was eine BWA-Zeile fachlich IST: zu welchem Block sie
gehoert, ob sie eine SUMME ist, ob eine Steigerung gut oder schlecht ist, und welcher
Kennzahl aus core.kennzahlen_monat sie entspricht.
WIRD LEER ANGELEGT, erwartet werden 77 Zeilen nach der Erstpflege. Bis dahin hat
mart.bwa_longterm keine Bloecke und kein Summenzeilen-Kennzeichen, und niemand hindert eine
Metabase-Karte daran, Gesamtleistung und ihre Bestandteile zu addieren. Die Pflege ist ein
benannter Folgeschritt nach dem ersten echten Parse, kein Nebenprodukt.
Eine reine Pflegetabelle: kein Importlauf schreibt hier je hinein, also kann hier auch
nichts still falsch werden. Geschluesselt ueber den Beschriftungstext, damit ein Neuaufbau
der Fakten aus raw die Pflege nicht entwertet.';
COMMENT ON COLUMN manual.bwa_zeile.zeile IS
'Exakt die Beschriftung aus core.bwa_position.zeile, abgeschnitten wie geliefert. Wer sie
hier "richtig" ausschreibt, trifft nichts mehr.';
COMMENT ON COLUMN manual.bwa_zeile.summenzeile IS
'true fuer Gesamtleistung, Wareneinsatz, Rohmarge, Op. Betriebsergebnis, Betriebsergebnis,
EBIT, EBT, Vorlaeufiges Ergebnis und EBITDA. Diese Zeilen duerfen NIE mit ihren
Bestandteilen addiert werden — wer es tut, zaehlt den Umsatz doppelt, und das Ergebnis
sieht plausibel aus.';
COMMENT ON COLUMN manual.bwa_zeile.vorzeichen_kosten IS
'Ob die Zeile eine Aufwandsposition ist. Entscheidet, ob eine Steigerung gut oder schlecht
ist; ohne diese Angabe zeigt jede Ampel bei "Energiekosten plus 12 Prozent" gruen.
Ungemessen und deshalb Pflege statt Ableitung.';
COMMENT ON COLUMN manual.bwa_zeile.kennzahl_bezug IS
'Die Bruecke zu core.kennzahlen_monat.kennzahl: Umsatz, EBIT, WE Bar, WE Kueche,
Personalkosten ohne GF — wortwoertlich wie dort einzutragen, und LINA schreibt WE Kueche
dort MIT UMLAUT. Ein transliterierter Eintrag trifft nichts.
NULL, wo es keine Entsprechung gibt. Das ist die einzige Stelle, an der die zwei
BWA-Wahrheiten ueberhaupt verknuepft sind; sie traegt mart.bwa_quellen_vergleich und
entscheidet die Vorrangfrage NICHT.';
COMMENT ON COLUMN manual.bwa_zeile.block IS
'Erloese, Wareneinsatz, Personal, Verbrauch, Vertrieb, Betrieb, Verwaltung, Abgaben,
Beratung, Miete, Kapital, Franchise, Ergebnis. Freier Text, KEIN CHECK — der Blockschnitt
ist eine fachliche Festlegung und wird sich aendern.';


-- ---------------------------------------------------------------------
-- Kapazitaet je Bereich — als Monatsmomentaufnahme
-- ---------------------------------------------------------------------
CREATE TABLE core.betrieb_kapazitaet (
    betrieb_key   integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat         date         NOT NULL,
    zeile_nr      smallint     NOT NULL,
    bereich       text         NOT NULL,
    ist_gesamt    boolean      NOT NULL DEFAULT false,
    plaetze       integer,
    tische        integer,
    flaeche_qm    numeric(10,2),
    abgerufen_am  timestamptz  NOT NULL,
    raw_id        bigint,
    geladen_am    timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile_nr),
    CONSTRAINT betrieb_kapazitaet_monatserster CHECK (monat = date_trunc('month', monat)::date)
);

COMMENT ON TABLE core.betrieb_kapazitaet IS
'Plaetze, Tische und Flaeche je Bereich aus dem Stammdatenblatt der Ladenakte. Macht Umsatz
je Sitzplatz und Umsatz je Quadratmeter rechenbar — beides stand auf der
Round-Table-Wunschliste und galt als nicht verfuegbar.
MONATSMOMENTAUFNAHME wie core.artikel_stand: die Quelle nennt KEIN Gueltigkeitsdatum, nur
einen heutigen Stand. Ein stilles Ueberschreiben verschoebe rueckwirkend jede vergangene
Kennzahl. monat ist der Monat des Abrufs, kein Gueltigkeitszeitraum.
DER SCHLUESSEL IST zeile_nr UND NICHT DER BEREICHSNAME. Zwei gleichnamige Bereichszeilen —
zwei Biergaerten mit je 125 Plaetzen — verschmelzen bei einem Namensschluessel im Upsert
lautlos zu einer: aus 250 werden 125.
DIE BEREICHE SUMMIEREN SICH NICHT AUF GESAMT. Karlsruhe am 11.08.2026: Gesamt 632 Plaetze
und 339 qm, dazu Biergarten 1 mit 250, "Umsatz 19%" mit 304 und Theke mit 32 — die drei
Bereichszeilen ergeben 586 gegen 632. Wer ueber alle Zeilen summiert, zaehlt zusaetzlich
die Gesamtzeile mit.
Lesen ausschliesslich ueber mart.betrieb_kapazitaet. Erwartete Groesse (ERWARTUNG, nicht
gemessen): rund 400 bis 700 Zeilen je Monatsstand; gemessen ist bisher ein Betrieb mit
vier Zeilen.';
COMMENT ON COLUMN core.betrieb_kapazitaet.bereich IS
'Wie geliefert und UNGEPFLEGT: Gesamt, Biergarten 1, Theke — aber auch "Umsatz 19%", und
das ist kein Bereich, sondern ein Steuersatz. KEIN CHECK und keine Normalisierung; der
Rohwert ist der Beleg. Taugt zur Anzeige, nicht als Kategorie.';
COMMENT ON COLUMN core.betrieb_kapazitaet.ist_gesamt IS
'Beim Laden aus dem Bereichsnamen abgeleitet (getrimmt und kleingeschrieben gegen "gesamt"
vergleichen — schriebe LINA "Gesamt " mit Leerzeichen, waere das Kennzeichen sonst nirgends
true, plaetze_gesamt fuer alle 131 Betriebe NULL und die Kennzahl lautlos verschwunden).
Der partielle UNIQUE-Index laesst hoechstens EINE Gesamtzeile je Betrieb und Monat zu:
zwei wuerden in mart.umsatz_je_sitzplatz Fan-out erzeugen und den Umsatz vervielfachen. Ein
Datenfehler in der Kapazitaet soll den Import abbrechen, nicht den Umsatz verdoppeln.
Findet sich GAR KEINE Gesamtzeile, meldet mart.betrieb_kapazitaet das als
ohne_gesamtzeile — der Index schuetzt gegen zu viel, nicht gegen null.';
COMMENT ON COLUMN core.betrieb_kapazitaet.tische IS
'Bei Karlsruhe durchgehend 0. Ob das "keine Tische" oder "nicht gepflegt" heisst, ist
NICHT gemessen.';
COMMENT ON COLUMN core.betrieb_kapazitaet.abgerufen_am IS
'Der ABRUFZEITPUNKT, nicht der Stichtag der Angabe. Die Quelle sagt nicht, seit wann die
Bestuhlung gilt — Umsatz je Sitzplatz fuer 2019 mit den Plaetzen von 2026 zu rechnen ist
plausibel und falsch.';

CREATE UNIQUE INDEX betrieb_kapazitaet_gesamt_uq
    ON core.betrieb_kapazitaet (betrieb_key, monat) WHERE ist_gesamt;


-- ---------------------------------------------------------------------
-- Tagesbudget — die erste Planungsgroesse je Tag
-- ---------------------------------------------------------------------
CREATE TABLE core.tagesbudget (
    betrieb_key      integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    datum            date         NOT NULL,
    umsatz_netto     numeric(14,2),
    stunden_service  numeric(8,2),
    stunden_bar      numeric(8,2),
    stunden_kueche   numeric(8,2),
    abgerufen_am     timestamptz  NOT NULL,
    raw_id           bigint,
    geladen_am       timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, datum)
);

COMMENT ON TABLE core.tagesbudget IS
'Geplanter Nettoumsatz und geplante Stunden je Tag und Bereich, aus dem Stammdatenblatt der
Ladenakte. 366 Zeilen je Jahr und Betrieb.
Unser Bestand kennt bisher nur Effektivitaeten aus core.personalkosten und vergleicht gegen
den Vormonat. Damit wird erstmals gegen eine PLANUNG gemessen.
NICHT ZU VERWECHSELN mit TAGESBUDGET in src/config.ts — das ist das taegliche
LINA-Anfragekontingent. Hier ist der Fachbegriff aus LINAs Stammdatenblatt gemeint; die
Namenskonvention (Fachbegriffe kommen aus LINA und bleiben deutsch) wiegt schwerer als die
Verwechslungsgefahr, aber sie gehoert benannt.
UPSERT OHNE HISTORIE, wie core.bwa_plan — siehe Falle 12 im Kopfblock.
Obergrenze 47.946 Zeilen je Planjahr (131 x 366); wie viele Betriebe ein Tagesbudget
pflegen, ist UNGEMESSEN (ERWARTUNG: deutlich weniger).
NICHT PARTITIONIERT, und die Datumsspalte heisst absichtlich nicht geschaeftstag.';
COMMENT ON COLUMN core.tagesbudget.datum IS
'LINA nennt die Spalte im Stammdatenblatt schlicht "Datum". OB DAMIT DER GESCHAEFTSTAG
(08:00 bis 07:59) ODER DER KALENDERTAG GEMEINT IST, IST AM 11.08.2026 NICHT GEMESSEN.
Die Spalte heisst deshalb datum und nicht geschaeftstag: der Name wuerde die Tagesgrenze
behaupten. mart.tagesbudget setzt beide gleich und sagt im Kommentar, dass sie es tut —
der Fehler waere klein (der Nachtanteil, Groessenordnung 0,2 bis 0,5 Prozent) und
systematisch, also genau die Sorte, die niemand bemerkt.
Die Quelle liefert 366 Zeilen auch in Nichtschaltjahren; eine Zeile zum 29.02. eines
Nichtschaltjahrs faengt der Lader ab, statt die Transaktion zu kippen.';
COMMENT ON COLUMN core.tagesbudget.umsatz_netto IS
'Der GEPLANTE Nettoumsatz. NULL heisst "kein Plan" und nicht "null Euro geplant".';

CREATE INDEX ON core.tagesbudget (datum);


-- =====================================================================
-- SICHTEN
-- =====================================================================


-- ---------------------------------------------------------------------
-- Die BWA-Zeitreihe fuer Metabase
--
-- LEFT JOIN auf manual.bwa_zeile, damit eine ungepflegte Beschriftung
-- SICHTBAR bleibt statt aus der Sicht zu fallen. Der umgekehrte Fehler
-- waere still.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.bwa_longterm AS
SELECT p.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       p.monat,
       p.zeile,
       p.zeile_nr,
       z.block,
       z.reihenfolge,
       z.summenzeile,
       z.vorzeichen_kosten,
       z.kennzahl_bezug,
       (z.zeile IS NULL) AS zeile_ungepflegt,
       p.betrag,
       p.abgerufen_am
  FROM core.bwa_position p
  JOIN core.betrieb b                 ON b.betrieb_key  = p.betrieb_key
  LEFT JOIN manual.bwa_zeile z        ON z.zeile        = p.zeile
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = p.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = p.betrieb_key;

COMMENT ON VIEW mart.bwa_longterm IS
'Die BWA-Ist-Zeitreihe je Betrieb, Monat und Zeile, mit aufgeloesten Namen und der Deutung
aus manual.bwa_zeile. Reicht zurueck bis 06/2009 und traegt 77 Zeilen statt der fuenf aus
mart.bwa_kennzahl.
betrag IS NULL HEISST "Spalte vorhanden, Monat nicht gebucht" und NICHT "null Euro".
count(*) zaehlt beide Faelle, count(betrag) nur die gebuchten.
UEBER VERSCHIEDENE zeile ZU SUMMIEREN IST IMMER FALSCH: Erloese, Kosten und fertige
Summenzeilen (Gesamtleistung, Wareneinsatz, EBIT, EBITDA) stehen in derselben Spalte.
Dafuer ist summenzeile da — solange manual.bwa_zeile nicht gepflegt ist, ist sie NULL und
schuetzt niemanden.
zeile_ungepflegt = true heisst, die Beschriftung ist in manual.bwa_zeile nicht eingetragen.
Solche Zeilen bleiben absichtlich in der Sicht; die Arbeitsliste ist
mart.bwa_zeile_ungepflegt.
ZWEI BWA-WAHRHEITEN: diese Sicht ueberschneidet sich mit mart.bwa_kennzahl aus
getKennzahlen. Welche Vorrang hat, ist NICHT entschieden — mart.bwa_quellen_vergleich zeigt
die Differenz.';


-- ---------------------------------------------------------------------
-- Plan gegen Ist
--
-- FULL OUTER JOIN, und das ist keine Vorsicht, sondern der Normalfall:
-- der Plan fuer 2026 existiert, bevor der Steuerberater den Monat bucht.
-- Ein LEFT JOIN von Ist auf Plan liesse genau das unsichtbar werden, ein
-- LEFT JOIN von Plan auf Ist verloere die ganze Historie ab 2009, fuer
-- die es nie einen Plan gab.
--
-- HEISST BEWUSST NICHT mart.bwa_position: eine Sicht mit Plan und Ist
-- unter dem Namen der Ist-Tabelle liefert eine falsche Antwort ohne
-- Fehlermeldung, sobald jemand das Schema vergisst.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.bwa_plan_ist AS
SELECT coalesce(i.betrieb_key, pl.betrieb_key) AS betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       coalesce(i.monat, pl.monat) AS monat,
       coalesce(i.zeile, pl.zeile) AS zeile,
       z.block,
       z.summenzeile,
       z.vorzeichen_kosten,
       i.betrag  AS betrag_ist,
       pl.betrag AS betrag_plan,
       i.betrag - pl.betrag AS abweichung,
       round(100 * (i.betrag - pl.betrag) / nullif(pl.betrag, 0), 2) AS abweichung_prozent
  FROM core.bwa_position i
  FULL OUTER JOIN core.bwa_plan pl
    ON  pl.betrieb_key = i.betrieb_key
    AND pl.monat       = i.monat
    /*
     * ueber die NUMMER, nicht ueber den Text. Plan und Ist stammen aus zwei
     * verschiedenen Seiten; ein Textjoin verlaesst sich darauf, dass LINA
     * dieselbe Abschneidung zweimal gleich rendert. Am 11.08.2026 traf das zu
     * (77 von 77), aber ein danebengehender Join liefert hier keine
     * Fehlermeldung, sondern eine leere Plan-Spalte neben einem gefuellten Ist
     * — und das liest sich wie "kein Budget gepflegt".
     */
    AND pl.zeile_id    = i.zeile_id
  JOIN core.betrieb b ON b.betrieb_key = coalesce(i.betrieb_key, pl.betrieb_key)
  LEFT JOIN manual.bwa_zeile z        ON z.zeile        = coalesce(i.zeile, pl.zeile)
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = coalesce(i.betrieb_key, pl.betrieb_key)
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = coalesce(i.betrieb_key, pl.betrieb_key);

COMMENT ON VIEW mart.bwa_plan_ist IS
'Plan gegen Ist je Betrieb, Monat und BWA-Zeile — die Grundlage jeder Abweichungsanalyse
und der Grund, warum Plan und Ist dieselbe Zeilenstruktur behalten mussten.
abweichung_prozent ist eine PROZENTZAHL (23.64, nie 0.2364), Nenner ist der Plan.
FULL OUTER JOIN: ein Monat mit Plan und ohne Ist bleibt sichtbar (der Normalfall fuer das
laufende Jahr), und die Historie ab 2009 ohne Plan ebenso.
betrag_ist IS NULL bei vorhandener Zeile heisst "Spalte existiert, Monat nicht gebucht" und
nicht "null Euro"; betrag_plan IS NULL heisst "kein Plan gepflegt".
Der PLAN IST OHNE HISTORIE (Upsert). Wird ein Plan unterjaehrig revidiert, misst diese
Sicht danach gegen den angepassten Plan — das Ergebnis sieht dann immer besser aus, und der
Fehler faellt nie auf. Wer Plantreue als Kennzahl will, liest zuerst Falle 12 im Kopfblock
von 0054.';


-- ---------------------------------------------------------------------
-- Reichweite je Betrieb — die Prueffrage, die auf WERTE geht
--
-- Die Franchisegebergesellschaft liefert 80 Spalten und keinen einzigen
-- Wert. Ein Importer, der "Struktur da" mit "Daten da" verwechselt,
-- meldet ok und schreibt nichts. Nur hier ist dieser Fall von einem
-- nicht abgerufenen Betrieb unterscheidbar.
--
-- Zweiter Nutzen umsonst: wert_bis IST der BWA-Rueckstand und laesst
-- sich gegen mart.bwa_rueckstand und core.bwa_buchungsstand halten —
-- zwei unabhaengige Quellen fuer dieselbe Aussage.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.bwa_longterm_stand AS
WITH s AS (
  SELECT p.betrieb_key,
         count(DISTINCT p.monat)                                        AS spalten,
         count(DISTINCT p.monat) FILTER (WHERE p.betrag IS NOT NULL)    AS monate_mit_wert,
         min(p.monat)                                                   AS spalte_von,
         max(p.monat)                                                   AS spalte_bis,
         min(p.monat) FILTER (WHERE p.betrag IS NOT NULL)               AS wert_von,
         max(p.monat) FILTER (WHERE p.betrag IS NOT NULL)               AS wert_bis,
         count(DISTINCT p.zeile)                                        AS zeilen,
         count(*)                                                       AS zellen,
         count(p.betrag)                                                AS zellen_mit_wert,
         max(p.abgerufen_am)                                            AS abgerufen_am,
         (array_agg(p.raw_id ORDER BY p.abgerufen_am DESC NULLS LAST))[1] AS raw_id,
         max(p.geladen_am)                                              AS geladen_am
    FROM core.bwa_position p
   GROUP BY p.betrieb_key
)
SELECT b.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       stt.status      AS betrieb_status,
       (stt.status = 'operativ') AS operativ,
       coalesce(s.spalten, 0)         AS spalten,
       s.spalte_von,
       s.spalte_bis,
       coalesce(s.monate_mit_wert, 0) AS monate_mit_wert,
       s.wert_von,
       s.wert_bis,
       coalesce(s.zeilen, 0)          AS zeilen,
       coalesce(s.zellen, 0)          AS zellen,
       coalesce(s.zellen_mit_wert, 0) AS zellen_mit_wert,
       coalesce(u.zeilen_ungepflegt, 0) AS zeilen_ungepflegt,
       r.payload_bytes                AS antwort_bytes,
       s.abgerufen_am,
       s.geladen_am,
       CASE WHEN s.betrieb_key IS NULL              THEN 'nie abgerufen'
            WHEN coalesce(s.zellen_mit_wert, 0) = 0 THEN 'Struktur ohne Werte'
            ELSE 'gefuellt'
       END AS zustand
  FROM core.betrieb b
  LEFT JOIN s                          ON s.betrieb_key   = b.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz  ON kz.betrieb_key  = b.betrieb_key
  LEFT JOIN mart.betrieb_status    stt ON stt.betrieb_key = b.betrieb_key
  LEFT JOIN LATERAL (
        SELECT count(DISTINCT p.zeile) AS zeilen_ungepflegt
          FROM core.bwa_position p
          LEFT JOIN manual.bwa_zeile mz ON mz.zeile = p.zeile
         WHERE p.betrieb_key = b.betrieb_key AND mz.zeile IS NULL) u ON true
  LEFT JOIN LATERAL (
        SELECT ra.payload_bytes
          FROM raw.api_antwort ra
         WHERE ra.id = s.raw_id AND ra.abgerufen_am = s.abgerufen_am) r ON true;

COMMENT ON VIEW mart.bwa_longterm_stand IS
'Ab wann und wie weit die BWA je Betrieb belastbar ist — und der einzige Ort, an dem
"Struktur vorhanden, aber leer" von "nie abgerufen" unterscheidbar ist.
zustand kennt drei Werte: nie abgerufen (keine Zeile in core.bwa_position), Struktur ohne
Werte (Zeilen da, kein einziger Betrag) und gefuellt. Der mittlere Fall ist am 11.08.2026
belegt: die CONCEPT FAMILY Franchise AG liefert 80 Spalten und 0 Werte. Ein Importer, der
"Tabelle vorhanden" mit "Daten vorhanden" verwechselt, meldet dort ok.
spalten zaehlt gelieferte Monatsspalten (gemessen 20 bis 224), monate_mit_wert nur die
gebuchten. Der Unterschied ist der Punkt der ganzen Sicht.
wert_bis IST DER BWA-RUECKSTAND und damit eine kostenlose Gegenprobe zu mart.bwa_rueckstand
und core.bwa_buchungsstand — am 11.08.2026 endete Park Cafe Muenchen bei 12/25, waehrend
andere bis 06/26 liefen.
antwort_bytes kommt aus raw.api_antwort und ordnet ein, ob eine leere Struktur eine kleine
oder eine grosse Antwort war (gemessen 0,14 bis 1,21 MB, die leere Franchisegesellschaft
0,44 MB).';


-- ---------------------------------------------------------------------
-- Arbeitsliste: welche Beschriftung ist noch nicht eingeordnet
--
-- Nach Volumen sortiert, damit die teuersten Faelle oben stehen. Nach
-- der Erstpflege ist sie der Waechter: eine neue Zeile hier heisst
-- entweder "LINA hat etwas ergaenzt" oder "LINA hat eine Beschriftung
-- geaendert" — beides muss ein Mensch entscheiden, und das zweite laesst
-- sonst eine Zeitreihe mitten im Verlauf abreissen, ohne dass irgendwo
-- etwas rot wird.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.bwa_zeile_ungepflegt AS
WITH vorkommen AS (
  SELECT betrieb_key, monat, zeile, betrag, 'ist'::text AS quelle FROM core.bwa_position
  UNION ALL
  SELECT betrieb_key, monat, zeile, betrag, 'plan'       FROM core.bwa_plan
)
SELECT v.zeile,
       count(DISTINCT v.betrieb_key)          AS betriebe,
       count(DISTINCT v.monat)                AS monate,
       count(*)                               AS zellen,
       count(v.betrag)                        AS zellen_mit_wert,
       sum(abs(v.betrag))                     AS volumen,
       min(v.monat)                           AS von,
       max(v.monat)                           AS bis,
       bool_or(v.quelle = 'plan')             AS auch_im_plan,
       bool_or(v.quelle = 'ist')              AS auch_im_ist
  FROM vorkommen v
  LEFT JOIN manual.bwa_zeile z ON z.zeile = v.zeile
 WHERE z.zeile IS NULL
 GROUP BY v.zeile
 ORDER BY sum(abs(v.betrag)) DESC NULLS LAST;

COMMENT ON VIEW mart.bwa_zeile_ungepflegt IS
'BWA-Beschriftungen aus core.bwa_position oder core.bwa_plan ohne Eintrag in
manual.bwa_zeile, nach Volumen absteigend — die Arbeitsliste der Erstpflege und danach der
Waechter gegen eine geaenderte Abschneidelaenge.
ERWARTUNG NACH DER PFLEGE: LEER. Erwartet werden vorher 77 Zeilen.
Die Beschriftungen sind serverseitig gekuerzt ("Freiwillige soz. Auf",
"Abschluss-/Pruefungsk"). Aendert LINA die Kuerzung, entsteht hier eine neue Zeile,
waehrend die alte Zeitreihe in mart.bwa_longterm einfach aufhoert — kein Fehler, keine
Meldung, nur ein Bruch. Deshalb gehoert diese Sicht in die zehnte Pruefung von
src/status.ts und nicht nur auf ein Dashboard.
Eine automatische Aehnlichkeitszuordnung waere schlimmer als das Problem.';


-- ---------------------------------------------------------------------
-- Die zwei BWA-Wahrheiten nebeneinander
--
-- Entscheidet nichts. Misst, was bisher niemand gemessen hat.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.bwa_quellen_vergleich AS
SELECT p.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       p.monat,
       p.zeile,
       z.kennzahl_bezug        AS kennzahl,
       p.betrag                AS longterm,
       k.wert_absolut          AS getkennzahlen,
       p.betrag - k.wert_absolut AS abweichung,
       round(100 * (p.betrag - k.wert_absolut) / nullif(k.wert_absolut, 0), 2)
         AS abweichung_prozent
  FROM core.bwa_position p
  JOIN manual.bwa_zeile z ON z.zeile = p.zeile AND z.kennzahl_bezug IS NOT NULL
  JOIN core.betrieb b     ON b.betrieb_key = p.betrieb_key
  LEFT JOIN mart.kennzahlen_aktuell k
         ON k.betrieb_key = p.betrieb_key
        AND k.monat       = p.monat
        AND k.kennzahl    = z.kennzahl_bezug
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = p.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = p.betrieb_key
 WHERE p.betrag IS NOT NULL;

COMMENT ON VIEW mart.bwa_quellen_vergleich IS
'BWA-Longterm gegen getKennzahlen, je Betrieb, Monat und Kennzahl, mit Differenz absolut
und in Prozent.
DIESE SICHT ENTSCHEIDET DIE VORRANGFRAGE NICHT, sie macht sie messbar. Zwei Zahlen fuer
dieselbe Kennzahl sind schlimmer als eine unvollstaendige; welche Quelle gewinnt, ist eine
fachliche Festlegung fuer docs/entscheidungen.md und muss stehen, BEVOR eine
Round-Table-Karte von mart.bwa_kennzahl umgestellt wird. Daran haengen
mart.round_table_basis, mart.bwa_rueckstand und core.bwa_buchungsstand.
Die Zuordnung der Beschriftungen laeuft ueber manual.bwa_zeile.kennzahl_bezug, ist also
pflegbar und nicht in der Sicht festgeschrieben. Solange dort nichts steht, ist die Sicht
LEER — das ist kein Befund, sondern fehlende Pflege.
getkennzahlen IS NULL heisst: getKennzahlen kennt diesen Monat nicht. Das ist der
Normalfall vor 2012, weil Longterm sechs Jahre weiter zurueckreicht.';


-- ---------------------------------------------------------------------
-- Selbstpruefung BWA — Erwartung: leer, bis auf den benannten Bekanntfall
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.bwa_pruefung AS
-- 1. Struktur ohne Werte. Bekannter Fall: die Franchisegebergesellschaften.
SELECT 'Spalten geliefert, aber kein einziger Wert'::text AS befund,
       s.betrieb_key,
       s.betrieb,
       NULL::date AS monat,
       NULL::text AS zeile,
       s.spalten::numeric AS zahl_a,
       s.zellen::numeric  AS zahl_b
  FROM mart.bwa_longterm_stand s
 WHERE s.zustand = 'Struktur ohne Werte'
UNION ALL
-- 2. Ein Parser, der eine Kopfzelle als Monat liest, produziert genau das.
SELECT 'Monat ausserhalb 06/2009 bis heute',
       p.betrieb_key, b.name, p.monat, NULL,
       count(*)::numeric, NULL
  FROM core.bwa_position p
  JOIN core.betrieb b ON b.betrieb_key = p.betrieb_key
 WHERE p.monat < DATE '2009-06-01'
    OR p.monat > date_trunc('month', current_date)::date
 GROUP BY p.betrieb_key, b.name, p.monat
UNION ALL
-- 3. Dieselbe Beschriftung unter wechselnder Position: LINA hat die
--    Tabelle umgebaut, und die Reihenfolge stimmt nicht mehr.
SELECT 'Beschriftung steht unter wechselnder Zeilennummer',
       p.betrieb_key, b.name, NULL, p.zeile,
       count(DISTINCT p.zeile_nr)::numeric, NULL
  FROM core.bwa_position p
  JOIN core.betrieb b ON b.betrieb_key = p.betrieb_key
 WHERE p.zeile_nr IS NOT NULL
 GROUP BY p.betrieb_key, b.name, p.zeile
HAVING count(DISTINCT p.zeile_nr) > 1
UNION ALL
-- 4. Plan ohne jedes Ist: entweder fehlt der Longterm-Abzug, oder die
--    Beschriftungen der beiden Quellen passen nicht mehr aufeinander.
SELECT 'Betrieb mit Plan, aber ohne eine einzige Istzeile',
       pl.betrieb_key, b.name, NULL, NULL,
       count(*)::numeric, NULL
  FROM core.bwa_plan pl
  JOIN core.betrieb b ON b.betrieb_key = pl.betrieb_key
 WHERE NOT EXISTS (SELECT 1 FROM core.bwa_position p
                    WHERE p.betrieb_key = pl.betrieb_key)
 GROUP BY pl.betrieb_key, b.name
UNION ALL
-- 5. Die Verbindbarkeit von Plan und Ist haengt an der wortgleichen
--    Beschriftung. Reisst sie, ist mart.bwa_plan_ist still halb leer.
SELECT 'Planbeschriftung kommt im Ist nicht vor',
       pl.betrieb_key, b.name, NULL, pl.zeile,
       count(*)::numeric, NULL
  FROM core.bwa_plan pl
  JOIN core.betrieb b ON b.betrieb_key = pl.betrieb_key
 WHERE EXISTS (SELECT 1 FROM core.bwa_position p WHERE p.betrieb_key = pl.betrieb_key)
   AND NOT EXISTS (SELECT 1 FROM core.bwa_position p
                    WHERE p.betrieb_key = pl.betrieb_key AND p.zeile = pl.zeile)
 GROUP BY pl.betrieb_key, b.name, pl.zeile
UNION ALL
-- 6. Die zwei BWA-Wahrheiten, ab einem Prozent Abstand.
SELECT 'Longterm weicht von getKennzahlen ab',
       v.betrieb_key, v.betrieb, v.monat, v.kennzahl,
       v.longterm, v.getkennzahlen
  FROM mart.bwa_quellen_vergleich v
 WHERE v.getkennzahlen IS NOT NULL
   AND abs(v.abweichung_prozent) > 1;

COMMENT ON VIEW mart.bwa_pruefung IS
'Selbstpruefung der BWA-Historie, ERWARTUNG: LEER — mit einer benannten Ausnahme.
BEFUND 1 IST FUER DIE FRANCHISEGEBERGESELLSCHAFTEN DER BEKANNTE NORMALFALL: die CONCEPT
FAMILY Franchise AG liefert am 11.08.2026 80 Spalten und keinen einzigen Wert. Steht dort
ein operativer Betrieb, ist es ein Befund.
Befund 3 faengt einen Umbau der LINA-Tabelle ab, Befund 5 den Bruch zwischen Plan- und
Ist-Beschriftung — beide wuerden sonst als stille Luecke in mart.bwa_plan_ist erscheinen.
Befund 6 misst die zwei BWA-Wahrheiten gegeneinander und entscheidet nichts; er ist erst
gefuellt, wenn manual.bwa_zeile.kennzahl_bezug gepflegt ist.
Gehoert zusammen mit mart.bwa_zeile_ungepflegt in die zehnte Pruefung von src/status.ts.';


-- ---------------------------------------------------------------------
-- Kapazitaet, lesbar — die einzige erlaubte Zugriffsstelle
--
-- Die Auswahl der Gesamtzeile faellt GENAU EINMAL, hier, und nicht in
-- jeder Karte: wer die Bereichszeilen Karlsruhes summiert, bekommt 1.218
-- Plaetze statt 632 (Gesamt 632 plus Biergarten 250 plus "Umsatz 19%"
-- 304 plus Theke 32) und rechnet damit einen halbierten Umsatz je
-- Sitzplatz aus — plausibel aussehend und falsch.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.betrieb_kapazitaet AS
WITH juengster AS (
  SELECT betrieb_key, max(monat) AS monat
    FROM core.betrieb_kapazitaet
   GROUP BY betrieb_key
), stand AS (
  SELECT k.betrieb_key,
         k.monat,
         max(k.plaetze)    FILTER (WHERE k.ist_gesamt)     AS plaetze_gesamt,
         max(k.tische)     FILTER (WHERE k.ist_gesamt)     AS tische_gesamt,
         max(k.flaeche_qm) FILTER (WHERE k.ist_gesamt)     AS flaeche_qm_gesamt,
         count(*)          FILTER (WHERE k.ist_gesamt)     AS gesamtzeilen,
         count(*)          FILTER (WHERE NOT k.ist_gesamt) AS bereiche,
         sum(k.plaetze)    FILTER (WHERE NOT k.ist_gesamt) AS plaetze_bereiche,
         sum(k.flaeche_qm) FILTER (WHERE NOT k.ist_gesamt) AS flaeche_qm_bereiche,
         max(k.abgerufen_am)                               AS abgerufen_am
    FROM core.betrieb_kapazitaet k
    JOIN juengster j ON j.betrieb_key = k.betrieb_key AND j.monat = k.monat
   GROUP BY k.betrieb_key, k.monat
)
SELECT b.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       s.monat AS stand_monat,
       s.abgerufen_am,
       s.plaetze_gesamt,
       s.tische_gesamt,
       s.flaeche_qm_gesamt,
       s.bereiche,
       s.plaetze_bereiche,
       s.flaeche_qm_bereiche,
       (s.gesamtzeilen = 0) AS ohne_gesamtzeile,
       (s.plaetze_gesamt IS NOT NULL
        AND s.plaetze_bereiche IS NOT NULL
        AND s.plaetze_gesamt <> s.plaetze_bereiche) AS summe_weicht_ab
  FROM stand s
  JOIN core.betrieb b                 ON b.betrieb_key  = s.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = s.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = s.betrieb_key;

COMMENT ON VIEW mart.betrieb_kapazitaet IS
'Genau eine Zeile je Betrieb mit dem JUENGSTEN Kapazitaetsstand: Plaetze, Tische und
Flaeche aus der Zeile Gesamt, daneben die Summe der Bereichszeilen und zwei Kennzeichen.
DIE BEREICHE SUMMIEREN SICH NICHT AUF GESAMT. Karlsruhe am 11.08.2026: Gesamt 632 Plaetze
gegen 586 aus den drei Bereichszeilen, und eine davon heisst "Umsatz 19%" und ist kein
Bereich. summe_weicht_ab macht das sichtbar, statt es zu gluetten.
ohne_gesamtzeile = true heisst: plaetze_gesamt und flaeche_qm_gesamt sind NULL, und das ist
eine LEERSTELLE und keine Null. Kein Ersatzwert, keine Summe der Bereiche, keine geratene
Zahl.
stand_monat sagt, aus welchem Abrufmonat der Stand stammt. Die QUELLE NENNT KEIN
GUELTIGKEITSDATUM — wer diese Zahlen gegen alte Umsaetze haelt, liest zuerst
mart.umsatz_je_sitzplatz.';


-- ---------------------------------------------------------------------
-- Umsatz je Sitzplatz und je Quadratmeter
--
-- Der Join auf die Kapazitaet ist ein LATERAL auf den JUENGSTEN Stand
-- BIS ZUM Auswertungsmonat und ausdruecklich KEIN Join auf
-- Monatsgleichheit. Die Kapazitaet entsteht nur, wenn jemand die
-- Stammdatenseite abruft; bei einem Abruf im Jahr gaebe es genau einen
-- Monatsstand, und ein Gleichheitsjoin liesse die Kennzahl fuer elf von
-- zwoelf Monaten leer — das saehe aus wie fehlender Umsatz. Genau dieser
-- Fehler steht im Fehlerkatalog.
--
-- EINE ERGAENZUNG GEGEN DIE REINE LESART, mit Grund: der erste
-- Kapazitaetsabruf liegt HINTER der gesamten Umsatzhistorie. Ein rein
-- rueckwaerts gerichtetes LATERAL liesse damit jeden Monat vor dem
-- ersten Abruf leer — also praktisch alles, und wieder saehe ein leeres
-- Dashboard aus wie fehlender Umsatz. Deshalb wird der naechstgelegene
-- Stand genommen, bei Gleichstand der aeltere; die Vorrangregel bleibt
-- also "juengster Stand bis zum Monat", und erst wenn es gar keinen
-- frueheren gibt, greift der frueheste spaetere.
-- Sichtbar gemacht wird das in kapazitaet_monate_entfernt: positiv heisst
-- "der Stand ist aelter als der Auswertungsmonat", NEGATIV heisst "der
-- Stand stammt aus der Zukunft dieses Monats". Wer das nicht sehen will,
-- filtert auf kapazitaet_monate_entfernt >= 0.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.umsatz_je_sitzplatz AS
WITH umsatz AS (
  SELECT betrieb_key, monat, sum(umsatz_netto) AS umsatz_netto
    FROM mart.umsatz_tag
   GROUP BY betrieb_key, monat
)
SELECT u.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       u.monat,
       u.umsatz_netto,
       k.plaetze,
       k.flaeche_qm,
       k.stand_monat AS kapazitaet_stand_monat,
       ((date_part('year',  u.monat) - date_part('year',  k.stand_monat)) * 12
      + (date_part('month', u.monat) - date_part('month', k.stand_monat)))::int
         AS kapazitaet_monate_entfernt,
       round(u.umsatz_netto / nullif(k.plaetze, 0), 2)    AS umsatz_je_platz,
       round(u.umsatz_netto / nullif(k.flaeche_qm, 0), 2) AS umsatz_je_qm
  FROM umsatz u
  JOIN core.betrieb b                 ON b.betrieb_key  = u.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = u.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = u.betrieb_key
  LEFT JOIN LATERAL (
        SELECT c.monat AS stand_monat, c.plaetze, c.flaeche_qm
          FROM core.betrieb_kapazitaet c
         WHERE c.betrieb_key = u.betrieb_key
           AND c.ist_gesamt
         ORDER BY (c.monat > u.monat), abs(c.monat - u.monat)
         LIMIT 1) k ON true;

COMMENT ON VIEW mart.umsatz_je_sitzplatz IS
'Monatsumsatz je Sitzplatz und je Quadratmeter — zwei Posten von der Round-Table-Wunschliste,
die als nicht verfuegbar galten.
DIE KAPAZITAET IST UNDATIERT IN DER QUELLE. Genommen wird per LATERAL der naechstgelegene
Kapazitaetsstand, bei Gleichstand der aeltere — also der juengste Stand BIS ZUM
Auswertungsmonat, und nur wenn es gar keinen frueheren gibt, der frueheste spaetere. Nicht
der Stand desselben Monats: ein Gleichheitsjoin liesse die Kennzahl fuer elf von zwoelf
Monaten leer.
kapazitaet_monate_entfernt SAGT, WORAUF MAN SIEHT: positiv heisst, der Stand ist aelter als
der Auswertungsmonat; NEGATIV heisst, er stammt aus dessen Zukunft — und das ist fuer die
ganze Historie vor dem ersten Abruf der Normalfall. Ein grosser Abstand heisst nicht, dass
die Zahl falsch ist; er heisst, dass niemand weiss, ob die Bestuhlung damals dieselbe war.
Umsatz je Sitzplatz fuer 2019 mit den Plaetzen von 2026 ist genau die Sorte plausibel
falscher Zahl, die dieses Projekt mehrfach getroffen hat. Wer nur belegte Staende will,
filtert auf kapazitaet_monate_entfernt >= 0.
Betriebe ohne gepflegte Gesamtzeile erscheinen mit NULL, nicht mit 0 — eine Leerstelle, kein
Nullwert.
Fan-out ist ausgeschlossen: der partielle UNIQUE-Index auf core.betrieb_kapazitaet laesst
hoechstens eine Gesamtzeile je Betrieb und Monat zu.';


-- ---------------------------------------------------------------------
-- Tagesbudget gegen Ist
--
-- LEFT JOIN vom Budget auf den Umsatz, damit ein Plantag ohne Umsatz
-- sichtbar bleibt — Ruhetag oder fehlender Import, und beides will man
-- sehen.
--
-- DIE IST-STUNDEN FEHLEN BEWUSST. core.personalkosten fuehrt keine
-- Stunden, sondern Effektivitaeten und Quoten je Zeitraum. Ein Join
-- ueber zwei verschiedene Raster waere die Sorte Verknuepfung, die stumm
-- daneben liegt. Der Vergleich Plan-Stunden gegen Ist-Stunden ist ein
-- eigener, benannter Folgeschritt und keine Nebenwirkung dieser Sicht.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.tagesbudget AS
SELECT t.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       t.datum,
       date_trunc('month', t.datum)::date AS monat,
       t.umsatz_netto      AS umsatz_plan,
       u.umsatz_netto      AS umsatz_ist,
       u.umsatz_netto - t.umsatz_netto AS abweichung,
       round(100 * (u.umsatz_netto - t.umsatz_netto) / nullif(t.umsatz_netto, 0), 2)
         AS abweichung_prozent,
       t.stunden_service,
       t.stunden_bar,
       t.stunden_kueche,
       t.abgerufen_am
  FROM core.tagesbudget t
  JOIN core.betrieb b                 ON b.betrieb_key  = t.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = t.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = t.betrieb_key
  LEFT JOIN mart.umsatz_tag u         ON u.betrieb_key  = t.betrieb_key
                                     AND u.geschaeftstag = t.datum;

COMMENT ON VIEW mart.tagesbudget IS
'Geplanter gegen tatsaechlichen Nettoumsatz je Betrieb und Tag, dazu die geplanten Stunden
je Bereich. abweichung_prozent ist eine Prozentzahl, Nenner ist der Plan.
HIER WIRD DER PLANTAG MIT DEM GESCHAEFTSTAG GLEICHGESETZT, UND DAS IST EINE ANNAHME. LINA
nennt die Spalte im Stammdatenblatt nur "Datum"; unser Geschaeftstag laeuft 08:00 bis 07:59.
Liegt die Planung auf dem Kalendertag, ist der Vergleich um einen Tag verschoben — der
Fehler waere klein (der Nachtanteil, Groessenordnung 0,2 bis 0,5 Prozent) und systematisch,
also genau die Sorte, die niemand bemerkt. Gegenprobe: einen Sonntag mit hohem Nachtanteil
Plan gegen Ist halten.
umsatz_ist IS NULL heisst Ruhetag ODER fehlender Import — die Sicht unterscheidet das nicht,
mart.umsatz_lochtag schon.
DIE IST-STUNDEN FEHLEN ABSICHTLICH: core.personalkosten fuehrt Effektivitaeten und Quoten,
keine Stunden. Ein Vergleich Plan-Stunden gegen Ist-Stunden braucht eine eigene Quelle und
ist ein benannter Folgeschritt.
Die Quelle liefert 366 Zeilen je Jahr, auch in Nichtschaltjahren.';


-- ---------------------------------------------------------------------
-- Selbstpruefung Stammdaten — Erwartung: leer
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.ladenstamm_pruefung AS
-- 1. Ohne Gesamtzeile ist die Sitzplatzkennzahl fuer diesen Betrieb NULL,
--    und das sieht aus wie fehlender Umsatz.
SELECT 'Kapazitaet ohne Zeile Gesamt'::text AS befund,
       k.betrieb_key,
       k.betrieb,
       NULL::date    AS datum,
       k.bereiche::numeric AS zahl_a,
       NULL::numeric AS zahl_b
  FROM mart.betrieb_kapazitaet k
 WHERE k.ohne_gesamtzeile
UNION ALL
-- 2. Bereichssumme gegen Gesamtzeile. Am 11.08.2026 ein bekannter Fall
--    (Karlsruhe 586 gegen 632), aber jeder weitere gehoert angesehen.
SELECT 'Bereichssumme weicht von der Gesamtzeile ab',
       k.betrieb_key, k.betrieb, NULL,
       k.plaetze_gesamt::numeric, k.plaetze_bereiche::numeric
  FROM mart.betrieb_kapazitaet k
 WHERE k.summe_weicht_ab
UNION ALL
-- 3. Ein Planjahr mit weniger als zwoelf Monaten ist ein halber Abruf.
SELECT 'Planjahr mit weniger als zwoelf Monaten',
       pl.betrieb_key, b.name,
       make_date(date_part('year', pl.monat)::int, 1, 1),
       count(DISTINCT pl.monat)::numeric, NULL
  FROM core.bwa_plan pl
  JOIN core.betrieb b ON b.betrieb_key = pl.betrieb_key
 GROUP BY pl.betrieb_key, b.name, date_part('year', pl.monat)
HAVING count(DISTINCT pl.monat) < 12
UNION ALL
-- 4. Ein Tagesbudgetjahr mit weniger als 365 Zeilen ebenso.
SELECT 'Tagesbudgetjahr mit weniger als 365 Tagen',
       t.betrieb_key, b.name,
       make_date(date_part('year', t.datum)::int, 1, 1),
       count(*)::numeric, NULL
  FROM core.tagesbudget t
  JOIN core.betrieb b ON b.betrieb_key = t.betrieb_key
 GROUP BY t.betrieb_key, b.name, date_part('year', t.datum)
HAVING count(*) < 365
UNION ALL
-- 5. Eine Tagesbudgetzeile ganz ohne Wert ist eine geparste Leerzeile.
SELECT 'Tagesbudgetzeile ohne jeden Wert',
       t.betrieb_key, b.name, min(t.datum),
       count(*)::numeric, NULL
  FROM core.tagesbudget t
  JOIN core.betrieb b ON b.betrieb_key = t.betrieb_key
 WHERE t.umsatz_netto IS NULL
   AND t.stunden_service IS NULL
   AND t.stunden_bar IS NULL
   AND t.stunden_kueche IS NULL
 GROUP BY t.betrieb_key, b.name;

COMMENT ON VIEW mart.ladenstamm_pruefung IS
'Selbstpruefung der Stammdaten aus der Ladenakte, ERWARTUNG: LEER — mit einer benannten
Ausnahme.
BEFUND 2 IST FUER ENCHILADA KARLSRUHE DER BEKANNTE FALL: Gesamt 632 Plaetze gegen 586 aus
den Bereichszeilen, gemessen am 11.08.2026. Die Bereichsnamen sind ungepflegt, eine Zeile
heisst "Umsatz 19%". Jeder WEITERE Betrieb hier gehoert angesehen, bevor jemand
Bereichszahlen summiert.
Befund 1 ist der gefaehrlichere: ohne Gesamtzeile ist mart.umsatz_je_sitzplatz fuer diesen
Betrieb NULL, und ein leeres Dashboard sieht aus wie "keine Kapazitaet gepflegt" statt wie
"der Parser hat die Zeile nicht getroffen".
Befund 4 und 5 fangen einen halb geparsten Tagesbudget-Abruf ab. Die Quelle liefert 366
Zeilen je Jahr; weniger als 365 heisst, dass etwas fehlt.';
