-- =====================================================================
-- Verifikation gegen den echten JULI-Round-Table
-- Erwartung: JULI_Round_Table_Ampelsystem.xlsx, Blatt "Eingabe", Zeile 9
-- (Enchilada Bayreuth). Zahlen aus getUmsatzbericht und getKennzahlen.
-- =====================================================================

INSERT INTO core.betrieb (enc_id, lina_betrieb_id, name, stadt, hat_bwa)
VALUES ('ENCID_BAYREUTH', 4, 'Enchilada Bayreuth GmbH', 'Bayreuth', true);

-- Umsatz Juni 2026 und Juni 2025
INSERT INTO core.umsatzbericht_tag (betrieb_key, geschaeftstag, umsatz_netto)
SELECT betrieb_key, DATE '2026-06-15', 69886.44 FROM core.betrieb WHERE enc_id='ENCID_BAYREUTH';
INSERT INTO core.umsatzbericht_tag (betrieb_key, geschaeftstag, umsatz_netto)
SELECT betrieb_key, DATE '2025-06-15', 74580.67 FROM core.betrieb WHERE enc_id='ENCID_BAYREUTH';

-- BWA MAI 2026 (Juni war am 25.07. noch nicht gebucht), getKennzahlen mode=absolut+relativ
INSERT INTO core.kennzahlen_monat (betrieb_key, monat, kennzahl, wert_absolut, wert_prozent, abgerufen_am)
SELECT betrieb_key, DATE '2026-05-01', k.kennzahl, k.abs, k.pct, now()
  FROM core.betrieb, (VALUES
        ('Umsatz',                  92030.31, 100.00),
        ('WE Bar',                  11994.34,  23.64),
        ('WE Küche',                12755.92,  31.08),
        ('Personalkosten ohne GF',  22812.56,  24.79)
      ) AS k(kennzahl, abs, pct)
 WHERE enc_id='ENCID_BAYREUTH';

-- Handgepflegte Werte (Juni)
INSERT INTO manual.online_bewertung (betrieb_key, monat, bewertung)
SELECT betrieb_key, DATE '2026-06-01', 4.00 FROM core.betrieb WHERE enc_id='ENCID_BAYREUTH';
INSERT INTO manual.om_einschaetzung (betrieb_key, monat, om_score)
SELECT betrieb_key, DATE '2026-06-01', 3 FROM core.betrieb WHERE enc_id='ENCID_BAYREUTH';

-- Betriebsindividuelle Schwelle, um das zweite Regelwerk zu pruefen
INSERT INTO core.schwellenwert_betrieb (betrieb_key, gueltig_ab, bereich, schwelle_gruen, schwelle_orange, schwelle_rot)
SELECT betrieb_key, DATE '2026-01-01', 'personal', 22.00, 24.00, 50.00
  FROM core.betrieb WHERE enc_id='ENCID_BAYREUTH';

\echo ''
\echo '=== Regelwerk: round_table_global (Standard) ==='
SELECT betrieb, bwa_monat, umsatz_pct, personalkosten_ogf_pct, we_bar_pct, we_kueche_pct,
       online_bewertung, om_score,
       ampel_umsatz, ampel_personal, ampel_we_bar, ampel_we_kueche, ampel_bewertung, ampel_om,
       gesamt, intensitaet, massnahme, prioritaet
  FROM mart.round_table(DATE '2026-06-01');

\echo ''
\echo '=== Soll laut Excel ==='
\echo 'bwa_monat=2026-05-01 | umsatz_pct=-6,29 | Personal 24,79 gruen | WE Bar 23,64 orange'
\echo 'WE Kueche 31,08 rot | Bewertung 4,0 orange | OM 3 orange'
\echo 'gesamt=rot | intensitaet=Sofort eskalieren | massnahme=Ja | prioritaet=Hoch'

\echo ''
\echo '=== Beide Regelwerke nebeneinander ==='
SELECT betrieb, bwa_monat, personalkosten_ogf_pct,
       ampel_personal_global, gesamt_global,
       ampel_personal_betrieb, gesamt_betrieb,
       weicht_ab, abweichung
  FROM mart.round_table_vergleich(DATE '2026-06-01');
\echo 'Soll: Personal 24,79 gegen betriebsindividuell 22/24 -> rot statt gruen.'
\echo 'Gesamt bleibt beide Male rot (Umsatz und WE Kueche sind ohnehin rot) -> weicht_ab = false.'

\echo ''
\echo '=== Zeitfunktionen ==='
SELECT core.geschaefts_zeitzone()                                              AS zeitzone,
       core.geschaeftstag('2026-06-02 01:00:00+00'::timestamptz)               AS "02.06. 03:00 Berlin (Sommerzeit)",
       core.geschaeftstag('2026-01-15 02:00:00+00'::timestamptz)               AS "15.01. 03:00 Berlin (Winterzeit)",
       (to_timestamp(1780264800) AT TIME ZONE core.geschaefts_zeitzone())::text AS "LINA-Epoch 1780264800",
       core.pruefe_lina_epoch(1780264800, DATE '2026-06-01')                   AS "Pruefung korrekt",
       core.pruefe_lina_epoch(1780264800, DATE '2026-06-02')                   AS "Pruefung falsch";
\echo 'Soll: 2026-06-01 | 2026-01-14 | 2026-06-01 00:00:00 | t | f'
