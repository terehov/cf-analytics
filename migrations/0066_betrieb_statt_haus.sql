-- =====================================================================
-- Betrieb statt Haus — jetzt auch dort, wo Metabase das Wort herbekommt
--
-- 0065 hat eine Beschriftung geradegezogen und dabei zu kurz gegriffen.
-- Die Kartentexte liegen im Repo und sind eine Wortersetzung; die
-- Beschwerde vom 12.08.2026 lautet aber, dass in Metabase weiter
-- "Haeuser" steht. Sie hat recht, und zwar aus drei Gruenden, die
-- nichts miteinander zu tun haben:
--
--   1. EIN DATENWERT. mart.fremdeinkauf.grund traegt 'gfgh des hauses'
--      als Zeichenkette. Der Wert steht in der Spalte "Grund" der
--      Fremdeinkaufskarten — kein Kartentext, sondern Inhalt.
--
--   2. FUENF SPALTENNAMEN. Metabase macht aus einem Spaltennamen von
--      selbst eine Beschriftung: haeuser_am_ort wird zu "Haeuser Am
--      Ort", und zwar im Filterfeld, im Abfrage-Editor und in der
--      Datenreferenz. Kein Kartentext kann das ueberschreiben.
--
--   3. DIE KOMMENTARE. Metabase liest COMMENT ON beim Sync und zeigt
--      den Text als Beschreibung der Tabelle beziehungsweise Spalte an.
--      Was hier steht, lesen die Leute im Info-Fenster.
--
-- UND EINE FALLE, die beim Nachmessen aufgefallen ist: 0065 hat
-- mart.einkaufspreis_betrieb_basis mit CASCADE neu gebaut. Die
-- abhaengigen Sichten entstanden dabei neu — ohne ihre Kommentare.
-- Ein FEHLENDER Kommentar loescht in Metabase aber nichts: dort steht
-- weiter die Fassung vom letzten Sync, samt "Haus". Ein leerer
-- Kommentar ist deshalb keine stille Luecke, sondern eine Konserve.
-- Abschnitt 4 setzt die verlorenen Texte in der neuen Wortwahl zurueck.
--
-- WAS ABSICHTLICH STEHEN BLEIBT: Wirtshaus, Brauhaus und Hofbraeuhaus
-- sind Betriebsnamen, Recklinghausen ist eine Stadt, "hausgenau" ist
-- eine Angabe zur Adressgenauigkeit und "Ausser Haus" eine Sparte.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Der Wert in mart.fremdeinkauf.grund
--
-- Spalten, Reihenfolge und Logik unveraendert gegenueber 0063. Geaendert
-- sind zwei Woerter: der Wert 'gfgh des hauses' heisst jetzt 'gfgh des
-- betriebs', und der Join-Alias gb_haus heisst gb_betrieb. Der Alias ist
-- unsichtbar, steht aber in derselben Zeile — wer den einen liest und
-- den anderen stehen laesst, sucht beim naechsten Mal zweimal.
--
-- Keine Karte filtert auf den alten Wert (geprueft ueber alle Karten in
-- metabase/); die Fremdeinkaufskarten filtern auf einordnung sowie auf
-- 'ausdruecklich gesperrt' und 'fremder getraenkehaendler'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.fremdeinkauf AS
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
           THEN 'gfgh des betriebs'
         WHEN f.freigegeben IS FALSE
              AND (f.gilt_ab IS NULL OR z.monat >= date_trunc('month', f.gilt_ab)::date)
           THEN 'ausdruecklich gesperrt'
         WHEN h.dach_name IS NOT NULL
              AND gb_betrieb.dach_name IS NOT NULL
              AND gb_betrieb.dach_name IS DISTINCT FROM z.dach_name
           THEN 'fremder getraenkehaendler'
         WHEN f.freigegeben IS TRUE AND z.monat < date_trunc('month', f.gilt_ab)::date
           THEN 'freigabe galt damals noch nicht'
         ELSE 'steht nicht auf der liste'
       END             AS grund,
       gb_betrieb.dach_name AS gfgh_des_betriebs,
       z.belege,
       z.netto,
       la.art          AS lieferant_art,
       (la.art = 'wareneinkauf') AS wareneinkauf
  FROM mart.einkauf_kreditor_monat z
  -- Pflichtjoin wie bisher: eine Zeile ohne Betrieb hat in dieser Sicht
  -- nichts zu suchen. Sie steht in mart.lieferant_freigabe_stand als
  -- fn_netto_ohne_betrieb.
  JOIN core.betrieb b                 ON b.betrieb_key  = z.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = z.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = z.betrieb_key
  LEFT JOIN manual.lieferant_freigabe f ON f.dach_name  = z.dach_name
  LEFT JOIN manual.lieferant_art     la ON la.dach_name = z.dach_name
  LEFT JOIN manual.gfgh_haendler   h  ON h.dach_name    = z.dach_name
  LEFT JOIN manual.gfgh_betrieb gb
         ON gb.betrieb_key = z.betrieb_key AND gb.dach_name = z.dach_name
  LEFT JOIN manual.gfgh_betrieb gb_betrieb
         ON gb_betrieb.betrieb_key = z.betrieb_key;


-- ---------------------------------------------------------------------
-- 2. Die Spaltennamen
--
-- Alle fuenf liegen in Sichten aus 0049. Ein RENAME COLUMN auf einer
-- Sicht ist eine Katalogaenderung von Millisekunden: PostgreSQL fuehrt
-- abhaengige Sichten ueber die Spaltennummer, nicht ueber den Namen —
-- mart.stadt_vergleich liest weiter aus mart.nachbarschaft, ohne dass
-- die Sicht neu gebaut werden muesste. Die abgeleitete Spalte traegt
-- ihren eigenen Namen und wird deshalb einzeln umbenannt.
-- ---------------------------------------------------------------------
ALTER VIEW mart.nachbarschaft       RENAME COLUMN haeuser_am_ort TO betriebe_am_ort;
ALTER VIEW mart.stadt_vergleich     RENAME COLUMN haeuser_am_ort TO betriebe_am_ort;
ALTER VIEW mart.stadt_vergleich     RENAME COLUMN ort_haeuser    TO ort_betriebe;
ALTER VIEW mart.marke_vergleich     RENAME COLUMN marke_haeuser  TO marke_betriebe;
ALTER VIEW mart.stadt_schnitt_monat RENAME COLUMN haeuser        TO betriebe;


-- ---------------------------------------------------------------------
-- 3. Die Kommentare, die das Wort noch tragen
--
-- Wortgleich zum bisherigen Stand, bis auf die Wortwahl — und bis auf
-- das Geschlecht: "das Haus" wird "der Betrieb", und damit aendern sich
-- Artikel und Adjektivendungen mit.
-- ---------------------------------------------------------------------
COMMENT ON TABLE core.bewertung_antwort IS
'Wie ein Betrieb auf seine Bewertungen reagiert, je Monat (Quelle: Yext Analytics).
Neu am 10.08.2026 -- vorher war nirgends sichtbar, dass einzelne Betriebe gar nicht
antworten (Badischer Hof Ettlingen 0 Prozent bei 54 Bewertungen, Ratskeller Augsburg
1 Prozent bei 125, waehrend andere ueber 90 liegen).

bewertungen ist die Zahl DIESES Monats -- der kumulierte Stand steht in
core.bewertung_stand. Diese Spalte ist der richtige Nenner fuer Themen-Anteile.';

COMMENT ON TABLE manual.gfgh_betrieb IS
'Der Getraenkefachgrosshandel je Betrieb, aus der Erhebung "GFGH Q2 2026.xlsx".
GEFUELLT SIND 13 VON 141, davon 5 mit aufgeloestem Dachnamen — das ist keine Luecke im
Schema, sondern der Ruecklauf. Die Excel hatte 88 Spalten, 14 trugen einen Namen, einer
davon ("Carls Brauhaus") zeigt auf keinen Betrieb in core.betrieb. Alles Uebrige ist
offen und ueber mart.lieferant_freigabe_stand aus den Rechnungen nachziehbar.

WOFUER DAS DA IST: ein Getraenkehaendler ist konzernweit weder erlaubt noch verboten.
Erst diese Zeile sagt, WER den Betrieb beliefern darf.

EIN EINTRAG HIER IST EINE FREIGABE: der genannte Haendler darf diesen Betrieb beliefern und
erscheint in mart.fremdeinkauf mit grund = ''gfgh des betriebs''. Jeder andere Lieferant
dieses Betriebs gilt als Fremdeinkauf, solange er nicht konzernweit freigegeben ist.
Bleibt dach_name NULL — bei acht der 13 Zeilen der Fall —, gibt dieser Betrieb fuer NIEMANDEN
eine Getraenkefreigabe her. Beispiel Aposto Aalen: der Betrieb nennt "Getraenke Keller", der
Name ist nicht aufgeloest, und deshalb steht auch Getraenke Keller dort als Fremdeinkauf.
Das ist die richtige Anzeige — aufgeloest gehoert der Name trotzdem.';

COMMENT ON TABLE manual.gfgh_haendler IS
'Die Lieferanten, die ein Getraenkefachgrosshandel SIND — unabhaengig davon, wer bei ihnen
kaufen darf. Nur so kann mart.fremdeinkauf "liefert Getraenke an einen Betrieb mit anderem GFGH"
erkennen, ohne die Einordnung eines Betriebs von der Pflegearbeit eines anderen abhaengig
zu machen.
GESAT WIRD NUR, WAS BELEGT IST: die Dachnamen, die in manual.gfgh_betrieb als GFGH eines
Betriebs stehen. Das sind am 12.08.2026 ZWEI (WIGEM Getraenke, GLH Getraenke Logistik
Heilbronn) aus fuenf Zeilen — drei Betriebe nennen WIGEM, zwei GLH. Zwei Haendler sind eine
duenne Grundlage; jeder weitere Eintrag ist Pflege. Ein Name allein entscheidet es
nicht — "Getraenke Keller" klingt nach GFGH und koennte ein Einzelhandel sein; dieselbe
Regel wie bei manual.kreditor_gruppe.
SOLANGE DIESE LISTE DUENN IST, IST DIE VERDACHTSLISTE KURZ. Das ist kein Fehler der Sicht,
sondern der Stand der Pflege — mart.lieferant_freigabe_stand zeigt, was fehlt.';

COMMENT ON TABLE manual.kreditor_gruppe IS
'Der Dachlieferant: bildet die je Betrieb getrennt gefuehrten Verkaeufernamen auf einen
konzernweiten Namen ab, damit "METRO Deutschland GmbH" und "Metro AG" ein Eintrag werden.
Nur so ist Lieferantenkonzentration ueber alle 131 Betriebe EINE Zahl und nicht 131.
BEWUSST PFLEGE UND NICHT AUTOMATIK: eine Namensaehnlichkeit darf ein Vorschlag sein, nie
eine Zuordnung — "Getraenke Hoffmann GmbH" und "Getraenke Hofmann e.K." sind zwei Firmen,
"METRO AG" und "METRO Deutschland GmbH" sind eine. Das entscheidet kein regexp_replace.
Dieselbe Regel wie bei core.kostenstelle.betrieb_key (0030).
WIRD LEER ANGELEGT. Was nicht gepflegt ist, faellt in mart.kreditor_konzern auf name_norm
zurueck: die Rangliste ist dann feiner aufgeteilt, aber nicht falsch verschmolzen. Die
Spalte gepflegt dort sagt je Zeile, welcher Fall vorliegt.';

COMMENT ON VIEW mart.betrieb_sichtbarkeit IS
'Wie sichtbar ein Betrieb in den Portalen ist -- Impressionen, Suchen, Profilaufrufe,
Klicks -- und wie gepflegt seine Eintraege sind (genauigkeit).

faktor = impressionen_google geteilt durch den von Yext gelieferten Median
vergleichbarer Betriebe. Unter 1 heisst: dieser Betrieb wird seltener gesehen als
vergleichbare. NULL heisst, dass Yext fuer diesen Betrieb keinen Vergleich fuehrt --
das ist eine Leerstelle und kein schlechter Wert.

Der laufende Monat ist IMMER ein Teilmonat und liegt zusaetzlich hinter dem Datenstand
zurueck (core.yext_datenstand). Nicht gegen einen Vollmonat halten.';

COMMENT ON VIEW mart.bewertung_thema IS
'Yexts Klusterung der Bewertungstexte je Betrieb, Monat und Thema -- die Antwort auf
"woran liegt es", wenn die Note faellt.

ERST AB APRIL 2026 (siehe mart.bewertung_thema_start). Eine Kurve, die dort anspringt,
ist der Beginn der Erhebung und kein Ereignis.

anteil rechnet gegen die ECHTE Bewertungszahl des Monats, nicht gegen die Summe der
Themen -- eine Bewertung kann mehrere Themen tragen, die Anteile ergeben deshalb
zusammen MEHR als 100 Prozent. Das ist richtig so.

abstand ist die Themennote minus der mengengewichteten Themennote desselben Betriebs im
selben Monat. Negativ = dieses Thema zieht den Betrieb herunter.';

COMMENT ON VIEW mart.bewertung_thema_monat IS
'Die Themen je Monat und Marke, ueber die operativen Betriebe verdichtet. Der Schnitt
ist MENGENGEWICHTET (Summe der Notenpunkte durch Summe der Nennungen) -- ein Betrieb mit
zwei Nennungen soll nicht so schwer waehlen wie einer mit achtzig.

Fuer den Konzern ueber alle Marken hinweg noch einmal aggregieren, aber NICHT den
Schnitt mitteln -- dann waere die Gewichtung wieder weg.';

COMMENT ON VIEW mart.buchungsbeleg IS
'Die Belegmetadaten mit aufgeloesten Namen — hier faengt jede Frage an, nicht bei
core.buchungsbeleg. Am 11.08.2026 gezaehlt: 593.314 Belege ueber 131 Betriebe, und das ist
eine Untergrenze (acht der vierzehn Ordner gezaehlt).
DIES IST DIE BEWEISSICHT: archivierte Belege und Belege ohne OCR stehen mit drin und sind
an Spalten erkennbar. Wer summiert, filtert selbst — dieselbe Bauform wie mart.einkauf_beleg.
34 geschlossene und insolvente Betriebe tragen zusammen 42.413 Belege, 17
Franchisegebergesellschaften 27.609. Fuer Zeitreihen ein Gewinn, fuer jeden
Betriebsvergleich eine Falle; dafuer sind betrieb_status und operativ da.
NICHT VERWECHSELN MIT mart.einkauf_beleg — das ist der FoodNotify-Bestellkopf.
hochgeladen_von_name und zuordnung_ma_name sind Klarnamen von Beschaeftigten. Sie stehen
hier als Attribut der Einzelzeile; nach ihnen zu GRUPPIEREN waere eine Leistungsauswertung.';

COMMENT ON VIEW mart.import_fehler IS
'Fehlermuster der letzten 24 Stunden, nach Haeufigkeit. Zeitstempel und lange Zahlen sind im
Text durch <zeit> und <zahl> ersetzt, damit gleichartige Fehler zusammenfallen.

Hier stehen NUR echte Fehler. "keine_daten" ist keiner: LINA antwortet mit HTTP 500 und leerem
Body, wenn ein Betrieb fuer einen Bericht nichts hat -- ein geschlossener Betrieb oder ein
Bericht, den dieser Betrieb nicht fuehrt.';

COMMENT ON VIEW mart.kalender_fehlend IS
'Betriebe mit Umsatz im laufenden Jahr, fuer die kein Bundesland ableitbar ist — nach Umsatz sortiert, damit der teuerste Fall oben steht. Am 11.08.2026 sind es 9, angefuehrt vom umsatzstaerksten Betrieb der Gruppe. Sie fehlen damit in jeder Feiertags- und Vergleichstagsrechnung, ohne dass es auffaellt.';

COMMENT ON VIEW mart.marke_vergleich IS
'Der Betrieb gegen den Schnitt seiner Marke, je Monat und Bereich. Beantwortet die Frage
vor jeder Massnahme: schwaechelt dieser Betrieb, oder seine ganze Marke?

marke_median ist ein MEDIAN ueber die im Monat OPERATIVEN Betriebe der Marke -- ein
einzelner Ausreisser soll den Massstab nicht verziehen, und ein stillgelegter Betrieb steht
mit -100 Prozent Umsatz in den Daten. Der betrachtete Betrieb selbst darf still sein
(operativ = false); er zaehlt dann im Median und im Rang nicht mit.

vergleich sagt BESSER oder SCHLECHTER, nicht hoeher oder niedriger. Bei Personal und
Wareneinsatz ist weniger besser -- ein blosses Vorzeichen an der Abweichung waere hier
zweideutig. Die Richtung kommt aus dem Standardregelwerk (ampel.regel).

rang ist der Platz innerhalb der Marke, 1 = bester. Nur operative Betriebe mit Wert
bekommen einen Rang; marke_betriebe sagt, aus wie vielen.

BEI EINER MARKE MIT NUR EINEM OPERATIVEN BETRIEB bleiben marke_median, abweichung, vergleich,
rang und marke_betriebe LEER. Das ist Absicht: "Abweichung 0,00 -- gleich -- Rang 1 von 1"
waere ein Nichts, das wie ein Befund aussieht.';

COMMENT ON VIEW mart.nachbarschaft IS
'Welcher Betrieb steht in welcher Stadt, und wie viele Betriebe der Gruppe stehen dort
sonst noch. Die Quelle der Stadt ist manual.betrieb_standort -- von Hand gepflegt, weil
LINA fuer Betriebe keine Adresse liefert.

UNVOLLSTAENDIG, SOLANGE manual.betrieb_standort unvollstaendig ist. Wer fehlt, sagt
mart.nachbarschaft_fehlend. Ein fehlender Betrieb faellt hier nicht auf: seine Stadt
sieht dann einfach so aus, als stuende er nicht dort.

betriebe_am_ort zaehlt gefuehrte Betriebe, nicht in einem Monat operative -- diese Sicht
kennt keinen Monat. Fuer die monatsbezogene Zahl: mart.stadt_schnitt_monat.betriebe.';

COMMENT ON VIEW mart.nachbarschaft_fehlend IS
'Betriebe ohne Ortsangabe -- die Luecke im Stadtvergleich, nach zuletzt gemachtem Umsatz
lesbar. Jede Zeile hier ist ein Betrieb, der in seiner Stadt nicht mitverglichen wird, ohne
dass es dort auffiele.

ERWARTUNG: fuer alle Betriebe mit laufendem Umsatz leer. Gefuellt wird
manual.betrieb_standort von Hand oder aus einer Liste von Concept Family.';

COMMENT ON VIEW mart.stadt_schnitt_monat IS
'Die Stadt als eine Zeile je Monat -- das Gegenstueck zu mart.konzept_schnitt_monat, nur
nach Ort statt nach Marke gruppiert. Prozentwerte sind MEDIANE, umsatz_ist ist eine echte
Summe (Umsatz addiert sich, Quoten nicht).

Nur Staedte mit MINDESTENS ZWEI im Monat operativen Betrieben. Eine Vergleichsgruppe aus
einem Betrieb ist keine.

betriebe zaehlt die im Monat operativen; mart.nachbarschaft.betriebe_am_ort zaehlt die
gefuehrten. In Karlsruhe sind das fuenf gefuehrte und vier operative.

Quotenvergleiche zwischen den Betrieben einer Stadt sind mit Vorsicht zu lesen -- siehe
mart.stadt_vergleich.';

COMMENT ON VIEW mart.stadt_vergleich IS
'Der Betrieb gegen die anderen Betriebe seiner Stadt, je Monat und Bereich. Beantwortet:
liegt der Rueckgang am Betrieb oder am Standort? Wetter, Baustellen, Feiertagslage und
Kaufkraft treffen alle Betriebe einer Stadt gleichzeitig -- eine Marke ueber ganz
Deutschland dagegen nicht.

VORSICHT BEI ABSOLUTEN QUOTEN. Die Betriebe einer Stadt gehoeren verschiedenen Marken mit
verschiedenen Karten, Preisen und Personalstrukturen; eine Personalquote von 45 gegen 40
Prozent ist zwischen Lehners und Aposto keine Aussage. Belastbar ist die VERAENDERUNG
(Bereich umsatz = Prozent gegenueber Vorjahresmonat): die traegt jeder Betrieb in seiner
eigenen Einheit.

Enthaelt nur Betriebe mit gepflegter Ortsangabe. Wer fehlt: mart.nachbarschaft_fehlend.
Uebrige Semantik wie mart.marke_vergleich.

ZWEI GROESSENANGABEN, DIE NICHT DASSELBE SIND: betriebe_am_ort zaehlt die gefuehrten Betriebe
der STADT (unabhaengig von Monat und Kennzahl) -- danach filtert man, wenn man wissen will,
ob es hier ueberhaupt jemanden zum Vergleichen gibt. ort_betriebe zaehlt die Betriebe, die in
DIESEM Monat fuer DIESE Kennzahl einen Wert haben, und traegt den Rang. Wer die Zeilen nach
ort_betriebe filtert, verliert genau die, bei denen der NACHBAR keinen Wert hat -- und liest
das als fehlende Kennzahl im eigenen Betrieb.';

COMMENT ON VIEW mart.zeitfenster_pruefung IS
'Stunden, die in keinem oder in mehr als einem Fenster liegen, mit dem Umsatz, der daran haengt. Erwartung: die Stunden 1 bis 7 fallen bewusst heraus (dort liegen 0,2 % des Umsatzes, die Betriebe sind zu). Jede andere Zeile ist ein Definitionsfehler.';

COMMENT ON COLUMN core.betrieb_sichtbarkeit.benchmark_google IS
'Median vergleichbarer Betriebe bei Google, von Yext geliefert. NULL heisst: fuer
diesen Betrieb fuehrt Yext keinen Vergleich (betrifft u. a. alle Enchiladas) -- das ist
eine Leerstelle, keine Null. NICHT ADDIERBAR: die Summe von Medianen ist kein Median.
Nur je Betrieb gegen impressionen_google halten.';

COMMENT ON COLUMN core.buchungsbeleg.verkaeufer_id IS
'seller_id als text. MANDANTENGEBUNDEN, soweit gemessen: ob LINA sie konzernweit oder je
Laden vergibt, ist am 11.08.2026 NICHT geprueft. Ueber Betriebe hinweg deshalb NICHT
gruppieren — dieselbe id kann in zwei Betrieben zwei Firmen meinen.';

COMMENT ON COLUMN mart.betrieb_sichtbarkeit.faktor IS
'Unter 1 = seltener gesehen als vergleichbare Betriebe. Im Juni 2026 lagen die sechs
schwaechsten Betriebe (nach einem geschlossenen) allesamt bei Aposto.';


-- ---------------------------------------------------------------------
-- 4. Was der CASCADE aus 0065 mitgenommen hat
--
-- Diese Texte standen bis 0065 in der Datenbank und sind seither leer.
-- In Metabase stehen sie deshalb weiter in der Fassung vom letzten Sync
-- — mit "Haus" darin. Hier zurueck, in der neuen Wortwahl.
--
-- "Hausregel 6" heisst jetzt "Regel 6 in AGENTS.md": in einem
-- Metabase-Info-Fenster liest niemand eine Hausregel, und das Wort geht
-- ohnehin.
-- ---------------------------------------------------------------------
COMMENT ON VIEW mart.fremdeinkauf IS
'Einkaufsvolumen je Betrieb, Monat und Lieferant, mit der Einordnung daneben —
die Grundlage fuer Fremdeinkauf, Lieferantenkonzentration und Volumen je Betrieb.

DREI FILTER GEHOEREN IMMER DAZU, sonst steht Unsinn im Bericht:
  1. quelle: NIE darueber summieren. FoodNotify und Belegarchiv fuehren dieselbe
     Rechnung doppelt. Immer nach quelle gruppieren oder eine Quelle waehlen.
  2. wareneinkauf IS TRUE: das Belegarchiv fuehrt ALLE Eingangsrechnungen. Ohne
     diesen Filter zaehlen visa, pay one, Stadtwerke und Finanzamt als
     Fremdeinkauf. NULL heisst "noch nicht eingeordnet" (manual.lieferant_art),
     nicht "kein Wareneinkauf" — es ist die Arbeitsliste.
  3. einordnung = ''nicht freigegeben'' liefert die Verdachtsliste.

ZWEI ZUSTAENDE BEI DER FREIGABE, UND DER STANDARD IST "nicht freigegeben". Wer
nicht auf der Freigabeliste steht und nicht der GFGH seines Betriebs ist, ist
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

COMMENT ON VIEW mart.lieferant_freigabe_stand IS
'Die Arbeitsliste zur Lieferantenfreigabe: jeder Lieferant beider Quellen mit Volumen und
Einordnungsstand, absteigend nach dem groesseren der beiden Volumina. Bauart wie
mart.sachkonto_fehlend (0053).
STAND 12.08.2026: 119 Dachnamen, davon 112 nicht eingeordnet. Das ist die offene Arbeit.

VIER ZUSTAENDE in der Spalte einordnung: freigegeben, gesperrt, "GFGH je Betrieb"
(steht in manual.gfgh_betrieb und ist damit fuer bestimmte Betriebe erlaubt) und
"nicht eingeordnet". Der letzte ist KEIN Fremdeinkauf, sondern offene Pflege.

DIESE SICHT HAT KEINE BETRIEBSACHSE — eine Zeile ist ein Lieferant. betrieb_status waere
hier sinnlos, Falle 12 trifft sie aber trotzdem: fn_netto enthaelt geschlossene und
verwaltende Betriebe mit, nachgemessen am 12.08.2026 3.385.426 EUR oder 9,7 Prozent.
Deshalb steht neben jeder Summe fn_netto_operativ beziehungsweise beleg_netto_operativ.
Wer eine Zahl weitergibt, sagt dazu, welche der beiden er genommen hat.

fn_netto_ohne_betrieb IST DIE BRUECKE ZU mart.fremdeinkauf. Dort ist der Betrieb ein
Pflichtjoin, hier nicht — 25 der 152 Kostenstellen haben keinen betrieb_key, und ihr
Volumen von 1.127.133 EUR erscheint deshalb nur in dieser Sicht. Ohne diese Spalte nennen
zwei Sichten derselben Migration fuer denselben Bestand verschiedene Summen (35.894.104
gegen 34.766.971 EUR) und niemand findet den Grund.

trifft_nichts = true heisst: der Dachname steht in einer Pflegetabelle, hat aber keinen
einzigen Beleg. Entweder ist der Name falsch geschrieben, oder der Lieferant hat nie
geliefert. Beides gehoert angesehen, bevor jemand der Freigabeliste vertraut.

fn_netto und beleg_netto DUERFEN NICHT ADDIERT WERDEN. Dieselbe Rechnung steht in beiden,
wenn sie ueber FoodNotify bestellt und in LINA gebucht wurde. Die beiden Spalten stehen
nebeneinander, damit ihr Abstand sichtbar ist — er ist die eigentliche Aussage.';

COMMENT ON COLUMN mart.einkaufspreis_betrieb.preis IS
'Median der Preise JE BASISEINHEIT (Liter, Kilogramm, Stueck) dieses Betriebs fuer diese Ware
in diesem Monat, aus core.bestellposition.preis_je_einheit. Median und nicht Mittelwert:
eine einzelne Fehlbuchung soll den Betriebspreis nicht verschieben.';

COMMENT ON COLUMN mart.einkaufspreis_betrieb.preis_je_gebinde IS
'Was ein Karton gekostet hat — zum Lesen, nicht zum Vergleichen. Ueber Betriebe hinweg
traegt er nicht, weil der eine Betrieb einen Karton als menge=1 bucht und der andere sechs
Flaschen als menge=6.';

COMMENT ON COLUMN mart.einkaufspreis_betrieb.konzern_median IS
'Median ueber die Betriebspreise der OPERATIVEN Betriebe. NULL, wenn kein operativer Betrieb diese
Ware in diesem Monat gekauft hat — dann ist auch abweichung_pct NULL.';

COMMENT ON COLUMN mart.einkaufspreis_betrieb.abweichung_pct IS
'Prozentzahl (12.4 heisst zwoelf Komma vier Prozent teurer, nie 0.124 — Regel 6 in AGENTS.md).
Positiv heisst teurer. NULL, solange vergleichbar = false.';

COMMENT ON COLUMN mart.einkaufspreis_betrieb.menge_widerspruechlich IS
'true, wenn die Preise je Basiseinheit ueber die Betriebe deutlich weiter streuen als die
Gebindepreise. Dann liegt der Unterschied an der Mengenbuchung und nicht am Preis. Nie
NULL — coalesce ist Absicht, damit WHERE NOT menge_widerspruechlich keine Zeile still
verliert.';

COMMENT ON COLUMN mart.einkaufspreis_betrieb.vergleichbar IS
'true nur, wenn drei operative Betriebe dieselbe Ware im selben Monat gekauft haben UND
beide Mengensperren schweigen. Wer die Spalte ignoriert, vergleicht Buchungsgewohnheiten
statt Preise.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0066', to_jsonb(
        'Betrieb statt Haus in der Datenbank: der Wert mart.fremdeinkauf.grund '
        '(''gfgh des hauses'' -> ''gfgh des betriebs''), fuenf Spaltennamen '
        '(haeuser_am_ort, ort_haeuser, marke_haeuser, haeuser) und 19 Kommentare. '
        'Dazu die acht Kommentare zurueckgeholt, die 0065 mit DROP ... CASCADE '
        'verloren hat -- in Metabase stand dort weiter der Text vom letzten Sync.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
