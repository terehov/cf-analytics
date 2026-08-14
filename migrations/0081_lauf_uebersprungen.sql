-- =====================================================================
-- 0081 Ein uebersprungener Lauf hinterlaesst jetzt eine Zeile
--
-- ANLASS (14.08.2026, morgens). Der Zeitplanlauf um 05:00 fuellte die
-- Warteschlange, uebersprang den Import ("lauf uebersprungen — es laeuft
-- bereits einer", Lauf 90 hielt die Sperre bis zu seinem Abbruch um
-- 08:00) und lief dann 15 Minuten Nachlaeufe und Yext. In Dokploy sah
-- das aus wie ein flotter, erfolgreicher Sync — und genau so wurde es
-- gelesen: als "durchgelaufen". Dass kein einziger Posten importiert
-- wurde, stand in einer einzigen Logzeile und sonst nirgends. In
-- sync.lauf fehlte der Lauf komplett.
--
-- Das ist zum dritten Mal dieselbe Signatur (02.08.: Einreihen als
-- eigener Zeitplan fiel aus; 12.08.: Belegarchiv fror hinter "269 von
-- 269 ok" ein): ein Zweig, der "nichts zu tun" bedeutet, war nur im Log
-- sichtbar. AGENTS.md Regel 10 sagt, wo der Unterschied stehen muss —
-- in der Datenbank, nicht im Kopf dessen, der zuletzt hingesehen hat.
--
-- WAS SICH AENDERT. Der Worker schreibt fuer jeden Start, der NICHT
-- arbeitet, eine abgeschlossene Zeile nach sync.lauf:
--
--   uebersprungen  die Laufsperre war belegt — ein anderer Lauf lief
--                  noch. Die Notiz nennt ihn. Normalfall waehrend eines
--                  langen Backfills, kein Befund; aber ein UNSICHTBARER
--                  Normalfall war zweimal ein tagelanger Befund.
--   gesperrt       der Zugang ruht (sync.zugangssperre). Die Notiz
--                  nennt Art und Ablauf. Auch hier: der Versuch selbst
--                  soll in der Historie stehen, nicht nur die Sperre.
--
-- mart.sync_status und mart.import_lauf zeigen die Zeilen ohne Umbau —
-- sie lesen sync.lauf ungefiltert, und dass diese Zeilen dort AUFTAUCHEN,
-- ist der ganze Zweck. Zwei Leser muessen sie dagegen AUSKLAMMERN, sonst
-- kippt der Fix ins Gegenteil:
--
--   src/status.ts   prueft die letzten drei BEENDETEN Laeufe auf
--                   "alle fehlgeschlagen". Uebersprungene Zeilen haben
--                   beendet_am gesetzt und wuerden das Fenster
--                   verduennen — drei Skips verdeckten drei echte
--                   Fehlschlaege.
--   src/health.ts   misst "veraltet" am juengsten beendet_am. Ein Tag
--                   voller Skips hielte /health ewig frisch, waehrend
--                   der Import steht — exakt der Fehler, den diese
--                   Migration beheben soll, nur eine Ebene hoeher.
--
-- Beide Filter stehen im Code neben dieser Begruendung; der Test dazu in
-- src/sync/e2e.test.ts ("Sperre gegen parallele Worker").
--
-- KEINE NEUE PRUEFZEILE: den Takt bewacht seit 0076 der Zulauf-Waechter
-- (sync.quelle misst zuletzt_gefragt/zuletzt_zulauf je Quelle). Stehen
-- die Laeufe einen Tag, schlagen dessen Zeilen an — diese Migration
-- sorgt dafuer, dass man dann in mart.sync_status auch SIEHT, warum:
-- eine Kette uebersprungener Starts statt eines Lochs in der Historie.
--
-- BUDGET: keins. Ein INSERT je uebersprungenem Start.
-- =====================================================================

ALTER TABLE sync.lauf DROP CONSTRAINT lauf_status_check;
ALTER TABLE sync.lauf ADD CONSTRAINT lauf_status_check
    CHECK (status IN ('laeuft','ok','teilweise','fehlgeschlagen','abgebrochen',
                      'uebersprungen','gesperrt'));

COMMENT ON COLUMN sync.lauf.status IS
'laeuft/ok/teilweise/fehlgeschlagen/abgebrochen wie gehabt. Seit 0081 zusaetzlich zwei
Zustaende fuer Starts, die NICHT gearbeitet haben: uebersprungen (Laufsperre war belegt,
die Notiz nennt den blockierenden Lauf) und gesperrt (Zugang ruht, sync.zugangssperre).
Beide Zeilen sind sofort beendet und haben 0 Aufgaben. Wer "letzter echter Lauf" meint,
muss beide ausklammern — so wie src/status.ts (Drei-Laeufe-Fenster) und src/health.ts
(veraltet-Messung) es tun. Anlass: am 14.08.2026 wurde ein uebersprungener 05:00-Start
als erfolgreicher 15-Minuten-Lauf gelesen; seine einzige Spur war eine Logzeile.';

COMMENT ON VIEW mart.sync_status IS
'Gesundheit der letzten Laeufe, juengster zuerst. Erste Anlaufstelle, wenn Zahlen fehlen.
Seit 0081 stehen hier auch Starts, die nicht gearbeitet haben: status uebersprungen
(Laufsperre belegt, Notiz nennt den blockierenden Lauf) und gesperrt (Zugang ruht).
0 Aufgaben ist bei diesen Zeilen keine Auffaelligkeit, sondern ihre Aussage.';

COMMENT ON VIEW mart.import_lauf IS
'Die Importlaeufe, juengster zuerst. status = "abgebrochen" mit einer Notiz ueber SIGTERM ist
der Normalfall bei einem Lauf mit Zeitfrist -- der naechste macht weiter, wo dieser aufhoerte.
Der Zustand liegt in der Datenbank, nicht im Prozess. Seit 0081 erscheinen auch
uebersprungene und gesperrte Starts als eigene Zeilen mit 0 Aufgaben — eine Kette davon
erklaert ein Loch im Zulauf, das vorher wie ein fehlender Zeitplan aussah.';

INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0081', to_jsonb(
        'sync.lauf kennt uebersprungen und gesperrt: jeder Start, der nicht arbeitet, '
        'hinterlaesst eine abgeschlossene Zeile mit Notiz. Anlass: der uebersprungene '
        '05:00-Start vom 14.08.2026 sah in Dokploy aus wie ein erfolgreicher Lauf; '
        'seine einzige Spur war eine Logzeile. status.ts und health.ts klammern die '
        'neuen Zustaende aus, sonst verduennten Skips das Fehlerfenster und hielten '
        '/health kuenstlich frisch.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
