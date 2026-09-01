-- ---------------------------------------------------------------------
-- 0099: Die Pruefzeile der Belegzaehlung misst je Freigabe, nicht pauschal.
--
-- ANLASS. Die Belegzaehlung verlaesst den Kalendertakt (Code-Aenderung im
-- selben Commit, src/sync/nachfuellen.ts): gezaehlt wird taeglich nur noch,
-- was sich bewegt oder vom gehaltenen Bestand abweicht; stille Ordner
-- rollieren woechentlich, und die sechs Belegarten mit inhalt_holen = false
-- — fuer die nie ein Abzug folgt — monatlich. Gemessen an Lauf 109
-- (31.08.2026): 1.974 Zaehlungen je Nacht, 6,68 von 7,18 Stunden Laufzeit,
-- 1,37 % davon mit veraendertem Stand; 846 der 1.974 gehoeren zu nie
-- geladenen Belegarten und kosten 2 h 52 ohne jeden Folgeschritt.
--
-- Die Pruefzeile "Belegarchiv: seit ueber 36 h nicht gezaehlt" zaehlt je
-- Betrieb und Ordner. Unter dem neuen Takt stuenden ~1.800 Zeilen dauerhaft
-- auffaellig — ein Alarm, der immer schlaegt, ist keiner (Regel 10, und
-- exakt der Fall "Ampel misst etwas anderes als sie sagt" aus 0098).
--
-- DER NEUE MASSSTAB, an den Takt gebunden:
--   inhalt_holen = true   10 Tage. Das taegliche Auffangnetz greift nach
--                         8 Tagen (ein verpasster Wochen-Bucket wird am
--                         Folgetag repariert); 10 laesst eine Abbruchnacht
--                         Karenz, bevor die Zeile rot wird.
--   inhalt_holen = false  36 Tage. Das Auffangnetz greift nach 32 Tagen
--                         (Monats-Bucket + verpasste Nacht), 36 laesst
--                         dieselbe Karenz.
--
-- DAS LABEL WIRD UMBENANNT, NICHT WIEDERVERWENDET. "seit ueber 36 h" saegte
-- unter dem neuen Takt an der eigenen Aussage — ein Prueflabel, das etwas
-- anderes sagt als es misst, ist schlimmer als eine fehlende Zeile (0098).
--
-- VERFAHREN: Textersetzung an der Sichtdefinition, dasselbe wie in 0098 —
-- die Uebersicht ist ueber ein Dutzend Migrationen gewachsen, sie neu zu
-- schreiben wuerde alles Juengere verlieren. Der LIKE-Schutz macht den
-- Block wiederholbar.
-- ---------------------------------------------------------------------
DO $$
DECLARE d text; neu text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO d;
    IF d LIKE '%seit ueber 36 h nicht gezaehlt%' THEN
        neu := regexp_replace(
            d,
            'SELECT ''Belegarchiv: seit ueber 36 h nicht gezaehlt''.*?FROM mart\.belegarchiv_zulauf',
            $neu$SELECT 'Belegarchiv: Zaehlung ueberfaellig (Takt je Freigabe)'::text AS pruefung,
    count(*) FILTER (WHERE zustand <> 'kein belegarchiv'::text) AS geprueft,
    count(*) FILTER (WHERE zustand <> 'kein belegarchiv'::text
                       AND (zuletzt_gezaehlt IS NULL
                         OR zuletzt_gezaehlt < now() - CASE WHEN inhalt_holen
                              THEN '10 days'::interval ELSE '36 days'::interval END)) AS auffaellig,
    'mart.belegarchiv_zulauf'::text AS sicht
   FROM mart.belegarchiv_zulauf$neu$,
            'gs');
        IF neu = d THEN
            RAISE EXCEPTION 'Die 36-h-Zeile wurde nicht getroffen — Definition von Hand pruefen';
        END IF;
        EXECUTE 'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS ' || rtrim(btrim(neu), ';');
    END IF;
END $$;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0099', to_jsonb(
        'Die Belegzaehlung verlaesst den Kalendertakt (bewegte Ordner taeglich, '
        'stille woechentlich, nie geladene Belegarten monatlich — Begruendung in '
        'docs/entscheidungen.md, 01.09.2026). Die Pruefzeile "seit ueber 36 h nicht '
        'gezaehlt" mass unter dem neuen Takt Unsinn und heisst jetzt "Zaehlung '
        'ueberfaellig (Takt je Freigabe)": 10 Tage fuer freigegebene Belegarten, '
        '36 Tage fuer nie geladene.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert, gesetzt_am = now();
