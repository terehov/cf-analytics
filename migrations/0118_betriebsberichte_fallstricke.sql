-- =====================================================================
-- 0118 Die Fallen der Betriebsberichte im MCP-Pruefer (M5, Plan 6.3 Punkt 2)
--
-- 0117 raeumt die Fallen in den Sichten aus, soweit eine Sicht das kann.
-- Was bleibt, ist, was ein Modell mit diesen Sichten FALSCH FRAGEN kann —
-- und das steht hier, als Daten fuer mcp/src/pruefen.ts. Drei Regelarten
-- sind neu und im selben Commit dort umgesetzt; ein Server ohne sie startet
-- nicht (regelartenPruefen, AGENTS.md mcp/ Regel 1):
--
--   filter_ueber_spalte  eine Spalte gegen FESTE Werte gefiltert (=, IN)
--   wert_muster          eine Spalte gegen einen Text, der auf ein Muster passt
--   sichten_mischen      zwei Gruppen von Sichten in EINER Abfrage mit Aggregat
--
-- Die Schwere folgt dem Plan (6.3) mit einer begruendeten Abweichung: "sum
-- ueber 88 und 92 gemeinsam" steht dort als Sperre. Hier ist es eine Warnung,
-- weil die Spalten seit 0117 verschieden heissen (menge gegen
-- anzahl_vorgaenge) und ein Verhaeltnis beider — Artikel je Nachlassvorgang —
-- eine legitime Frage ist, die eine Sperre verbauen wuerde (entscheidungen.md,
-- 23.09.2026).
--
-- Die Doppelzaehlung 88/97 selbst braucht keinen Fallstrick: mcp_leser sieht
-- core nicht (Sperre schema_gesperrt), mart.finanzweg_tag nimmt je Tag eine
-- Quelle, und die Pruefsicht mit beiden Zahlen nebeneinander ist ueber
-- mcp.kennzahl gegen sum() gesperrt (0117).
-- =====================================================================

INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle) VALUES

  -- --- Aktion ueber eine Nummernliste --------------------------------
  ('nachlass_nummernliste_tag', 'filter_ueber_spalte', 'sperre', 'mart.artikel_nachlass_tag',
   '{"spalte":"finanzweg_nummer"}',
   'Filter ueber finanzweg_nummer verliert still Zeilen. Eine Aktion laeuft oft ueber MEHRERE '
   'Finanzwege: die 25-%-Stufe des Gluecksrads ueber 3501 ("25% Gluecksrad''") UND 3168 ("25% '
   'Gluecksrad") — wer nach 3500/3501/3502 filterte, verlor in einem Betrieb 31 Vorgaenge. Dazu ist '
   'die Nummer im Rabattbericht NULL, solange 88/97 fuer den Tag fehlt.',
   'Ueber aktion und prozentsatz filtern: WHERE aktion = ''Glücksrad'' (optional AND prozentsatz = 25). '
   'Welche Aktionen es gibt, steht in mart.finanzweg (Spalte aktion).',
   'docs/metabase.md, Abschnitt zu 0117'),
  ('nachlass_nummernliste_monat', 'filter_ueber_spalte', 'sperre', 'mart.artikel_nachlass_monat',
   '{"spalte":"finanzweg_nummer"}',
   'Filter ueber finanzweg_nummer verliert still Zeilen. Eine Aktion laeuft oft ueber MEHRERE '
   'Finanzwege: die 25-%-Stufe des Gluecksrads ueber 3501 ("25% Gluecksrad''") UND 3168 ("25% '
   'Gluecksrad") — wer nach 3500/3501/3502 filterte, verlor in einem Betrieb 31 Vorgaenge. Dazu ist '
   'die Nummer im Rabattbericht NULL, solange 88/97 fuer den Tag fehlt.',
   'Ueber aktion und prozentsatz filtern: WHERE aktion = ''Glücksrad'' (optional AND prozentsatz = 25). '
   'Welche Aktionen es gibt, steht in mart.finanzweg (Spalte aktion).',
   'docs/metabase.md, Abschnitt zu 0117'),
  ('finanzweg_nummernliste_tag', 'filter_ueber_spalte', 'warnung', 'mart.finanzweg_tag',
   '{"spalte":"finanzweg_nummer"}',
   'Filter ueber finanzweg_nummer: fuer eine Zahlart meist richtig, fuer eine AKTION nicht — sie kann '
   'ueber mehrere Nummern laufen (Gluecksrad 25 %: 3501 und 3168).',
   'Fuer Nachlaesse ueber aktion und prozentsatz filtern, oder gleich mart.nachlass_monat nehmen '
   '(dort sind die Finanzwege einer Aktion schon zusammengefasst).',
   'docs/metabase.md, Abschnitt zu 0117'),
  ('finanzweg_nummernliste_monat', 'filter_ueber_spalte', 'warnung', 'mart.finanzweg_monat',
   '{"spalte":"finanzweg_nummer"}',
   'Filter ueber finanzweg_nummer: fuer eine Zahlart meist richtig, fuer eine AKTION nicht — sie kann '
   'ueber mehrere Nummern laufen (Gluecksrad 25 %: 3501 und 3168).',
   'Fuer Nachlaesse ueber aktion und prozentsatz filtern, oder gleich mart.nachlass_monat nehmen '
   '(dort sind die Finanzwege einer Aktion schon zusammengefasst).',
   'docs/metabase.md, Abschnitt zu 0117'),

  -- --- Aktion ueber einen exakten Namen ------------------------------
  ('finanzweg_name_exakt', 'filter_ueber_spalte', 'warnung', NULL,
   '{"spalte":"finanzweg_name"}',
   'Ein Finanzwegname exakt verglichen trifft nur EINEN Weg. Die beiden 25-%-Wege des Gluecksrads '
   'unterscheiden sich an einem Apostroph ("25% Gluecksrad''" und "25% Gluecksrad"), und derselbe '
   'Name kommt je Betrieb in anderer Schreibweise vor.',
   'Fuer eine Aktion: WHERE aktion = ''Glücksrad'' AND prozentsatz = 25. Die Spalte aktion ist der Name '
   'ohne Prozentzahl und ohne Apostroph.',
   'docs/metabase.md, Abschnitt zu 0117'),

  -- --- Nachlassmenge ist keine Verkaufsmenge -------------------------
  ('nachlass_menge_deutung_tag', 'deutung', 'warnung', 'mart.artikel_nachlass_tag', '{}',
   'menge ist die Zahl der Artikel auf Bons, auf die dieser Nachlass gebucht wurde — NICHT die '
   'Verkaufsmenge und NICHT die Zahl der Nachlassvorgaenge: der Nachlass gilt fuer den ganzen Bon '
   '(im August 2026 trugen 327 Artikel einen Gluecksrad-Nachlass, auch Getraenke). Nur Zeilen MIT '
   'Artikelnamen (die Gruppenkoepfe des Berichts sind nie geladen, 28 von 8.533 Zeilen ohne Namen '
   'fehlen bewusst) — fuer den vollstaendigen Nachlassbetrag je Aktion ist mart.nachlass_monat da.',
   'Verkaufsmengen stehen in mart.artikel_monat, Vorgaenge und Betraege je Aktion in mart.nachlass_monat.',
   'docs/metabase.md, Abschnitt zu 0117'),
  ('nachlass_menge_deutung_monat', 'deutung', 'warnung', 'mart.artikel_nachlass_monat', '{}',
   'menge ist die Zahl der Artikel auf Bons, auf die dieser Nachlass gebucht wurde — NICHT die '
   'Verkaufsmenge und NICHT die Zahl der Nachlassvorgaenge: der Nachlass gilt fuer den ganzen Bon '
   '(im August 2026 trugen 327 Artikel einen Gluecksrad-Nachlass, auch Getraenke). Nur Zeilen MIT '
   'Artikelnamen (die Gruppenkoepfe des Berichts sind nie geladen, 28 von 8.533 Zeilen ohne Namen '
   'fehlen bewusst) — fuer den vollstaendigen Nachlassbetrag je Aktion ist mart.nachlass_monat da.',
   'Verkaufsmengen stehen in mart.artikel_monat, Vorgaenge und Betraege je Aktion in mart.nachlass_monat.',
   'docs/metabase.md, Abschnitt zu 0117'),

  -- --- Artikel (92) und Vorgaenge (88/97) in einer Summe --------------
  ('artikel_gegen_vorgaenge', 'sichten_mischen', 'warnung', NULL,
   '{"a":["mart.artikel_nachlass_tag","mart.artikel_nachlass_monat"],"b":["mart.finanzweg_tag","mart.finanzweg_monat","mart.nachlass_monat"]}',
   'Der Rabattbericht (92) zaehlt ARTIKEL auf Nachlass-Bons, 88/97 zaehlen VORGAENGE (50 % '
   'Gluecksrad in Duesseldorf, August 2026: 712 Artikel gegen 600 Vorgaenge). Eine Summe ueber beide '
   'ist keine Zahl; ein Verhaeltnis (Artikel je Vorgang) ist dagegen zulaessig.',
   'Nie menge und anzahl_vorgaenge addieren. Betraege: mart.nachlass_monat ist vollstaendig, der '
   'Rabattbericht verteilt sie auf Artikel und laesst namenlose Zeilen weg.',
   'docs/metabase.md, Abschnitt zu 0117'),

  -- --- Bons (96) tragen keine Nachlaesse -----------------------------
  ('bon_ohne_nachlass', 'wert_muster', 'sperre', 'mart.bon_zahlart_tag',
   '{"spalte":"zahlart","muster":"gl(ü|ue|u)cksrad|rabatt|hausbon|nachlass"}',
   'Das Rechnungsausgangsbuch (96) fuehrt in den Finanzwegen eines Bons NUR Zahlarten — keine '
   'Nachlass- oder Hausbon-Wege (gemessen: 32 Gluecksrad-Vorgaenge in 88, null in 96). Eine solche '
   'Abfrage liefert null Zeilen und liest sich wie "kein Gluecksrad".',
   'Nachlaesse je Betrieb und Tag: mart.finanzweg_tag bzw. mart.nachlass_monat. "Bons mit Aktion" und '
   '"Durchschnittsbon mit gegen ohne Aktion" sind aus den vorhandenen Berichten NICHT beantwortbar.',
   'docs/metabase.md, Abschnitt zu 0117'),
  ('bon_deutung', 'deutung', 'warnung', 'mart.bon_tag', '{}',
   'Bons aus dem Rechnungsausgangsbuch (96): keine Uhrzeit (Wartezeiten, Stundenprofile gehen nicht), '
   'keine Artikel und keine Nachlass-Finanzwege. bon_durchschnitt und bon_median sind Tageswerte — ueber '
   'mehrere Tage aus sum(bons_brutto) / sum(bons) neu rechnen, nicht mitteln.',
   'Stundenprofile: mart.umsatz_zeitzone. Nachlaesse: mart.nachlass_monat.',
   'docs/metabase.md, Abschnitt zu 0117'),

  -- --- Die Pruefsicht 88/97 ist keine Summenquelle -------------------
  ('finanzweg_88_97_pruefsicht', 'deutung', 'warnung', 'mart.finanzweg_88_97_abgleich', '{}',
   'Pruefsicht: dieselbe Finanzwegzahl aus ZWEI Berichten (88 und 97) nebeneinander. Wer daraus '
   'summiert, zaehlt doppelt.',
   'Finanzwege summieren: mart.finanzweg_tag bzw. mart.finanzweg_monat (je Betrieb und Tag genau eine '
   'Quelle).',
   'migrations/0114_betriebsberichte_stufe_a.sql'),

  -- --- Zwei Gliederungen desselben Umsatzes --------------------------
  ('zeitzone_ebenen_mischen', 'sichten_mischen', 'warnung', NULL,
   '{"a":["mart.zeitzone_hauptsparte_monat"],"b":["mart.zeitzone_feinsparte_monat"]}',
   'Haupt- und Feinsparten gliedern DENSELBEN Umsatz zweimal. Eine Summe ueber beide Sichten ist '
   'doppelt.',
   'Eine der beiden Sichten nehmen.',
   'docs/metabase.md, Abschnitt zu 0117'),
  ('verkaufsstelle_plus_gesamt', 'sichten_mischen', 'warnung', NULL,
   '{"a":["mart.verkaufsstelle_tag"],"b":["mart.umsatz_tag"]}',
   'Die Verkaufsstellen sind ein TEIL des Gesamtumsatzes (Gesamtbetrieb + Ausser Haus = Umsatz). Eine '
   'Summe ueber mart.verkaufsstelle_tag und mart.umsatz_tag zaehlt doppelt.',
   'Anteile rechnen, nicht addieren. Solange mart.verkaufsstelle_abdeckung nicht "ok" meldet, ist '
   'mart.verkaufsstelle_monat die belastbare Zahl.',
   'docs/metabase.md, Abschnitt zu 0112')
ON CONFLICT (schluessel) DO UPDATE SET
   art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
   parameter = excluded.parameter, hinweis = excluded.hinweis,
   berichtigung = excluded.berichtigung, quelle = excluded.quelle, aktiv = true;
