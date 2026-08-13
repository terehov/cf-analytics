/**
 * Der Statusbericht — die Frage „muss jemand hinsehen?".
 *
 * Bewusst getrennt von `/health`. Die beiden beantworten verschiedene Fragen,
 * und sie zu vermischen wäre gefährlich:
 *
 *   /health   Lebt der Container? Ist die Datenbank erreichbar?
 *             Das ist der Container-Health-Check. Er darf NUR dann rot werden,
 *             wenn ein Neustart hilft — sonst dreht Dokploy den Container im
 *             Kreis. Eine Zugangssperre ist genau so ein Fall, in dem ein
 *             Neustart nichts löst und alles schlimmer macht.
 *
 *   /status   Läuft der Import noch, wie er soll?
 *             Das ist der Endpunkt fürs Monitoring (Uptime Kuma, Better
 *             Stack, Dokploy-Benachrichtigung). Er wird rot, wenn ein Mensch
 *             hinsehen sollte — und niemand startet daraufhin etwas neu.
 *
 * Jede Prüfung sagt selbst, was sie gefunden hat und was daraus folgt. Ein
 * Alarm ohne Handlungsanweisung kostet nur Zeit.
 */
import { config } from './config'
import { eine, query } from './db/pool'
import { zulaufStand } from './sync/zulauf'

export type Stufe = 'ok' | 'warnung' | 'stoerung'

export type Pruefung = {
  name: string
  stufe: Stufe
  meldung: string
  /** Was zu tun ist. Leer, solange nichts zu tun ist. */
  naechster_schritt?: string
  werte?: Record<string, unknown>
}

export type Statusbericht = {
  status: Stufe
  geprueft_am: string
  pruefungen: Pruefung[]
}

/** Die schlechteste Stufe gewinnt — wie bei der Ampel. */
function schlimmste(stufen: Stufe[]): Stufe {
  if (stufen.includes('stoerung')) return 'stoerung'
  if (stufen.includes('warnung')) return 'warnung'
  return 'ok'
}

export async function statusErheben(): Promise<Statusbericht> {
  const p: Pruefung[] = []

  // --- 1. Ruht der Zugang? ------------------------------------------------
  //
  // Die wichtigste Meldung, und die einzige, bei der wirklich nichts läuft.
  // Kein Grund zur Panik: die Sperre läuft von selbst ab, der Importer kommt
  // ohne Zutun zurück. Aber wissen sollte man es.
  const sperre = await eine<any>(
    `SELECT art, pausiert_bis, hinweis,
            round(EXTRACT(epoch FROM (pausiert_bis - now())) / 3600, 1) AS stunden
       FROM sync.sperre_aktiv()`)
  const gesperrt = Boolean(sperre?.pausiert_bis)
  if (gesperrt) {
    p.push({
      name: 'zugang',
      // Der Anmeldefall ist der schwerere: er kann ein gesperrtes Konto
      // bedeuten, und davon gibt es genau eines.
      stufe: sperre.art === 'anmeldung' ? 'stoerung' : 'warnung',
      meldung: `LINA-Zugang ruht (${sperre.art}), noch ${sperre.stunden} h`,
      naechster_schritt:
        'Die Sperre läuft von selbst ab, es ist nichts zu tun. Wer es abkürzen will: ' +
        "im Browser anmelden und prüfen, dann SELECT sync.sperre_aufheben('name');",
      werte: { art: sperre.art, pausiertBis: sperre.pausiert_bis, hinweis: sperre.hinweis },
    })
  } else {
    p.push({ name: 'zugang', stufe: 'ok', meldung: 'Zugang frei' })
  }

  // --- 2. Kommt der Import voran? -----------------------------------------
  //
  // Nur dann ein Problem, wenn es auch etwas zu tun GAB. Eine leere
  // Warteschlange ist kein Stillstand, sondern Feierabend. Und wenn der
  // Zugang ruht, ist der Stillstand erklärt — zwei Alarme für eine Ursache
  // sind einer zu viel.
  const faellig = await eine<{ n: number }>(
    `SELECT count(*)::int AS n FROM sync.warteschlange
      WHERE erledigt_am IS NULL AND in_arbeit_seit IS NULL AND faellig_ab <= now()`)
  const letzter = await eine<{ stunden: number | null }>(
    `SELECT round(EXTRACT(epoch FROM (now() - max(erledigt_am))) / 3600, 1) AS stunden
       FROM sync.warteschlange WHERE erledigt_am IS NOT NULL`)
  const stillStunden = letzter?.stunden === null ? null : Number(letzter?.stunden)
  const steht = !gesperrt
    && Number(faellig?.n ?? 0) > 0
    && stillStunden !== null && stillStunden > config.STATUS_STILLSTAND_STUNDEN
  p.push(steht
    ? {
        name: 'fortschritt',
        stufe: 'stoerung',
        meldung: `seit ${stillStunden} h kein Posten erledigt, obwohl ${faellig!.n} fällig sind`,
        naechster_schritt:
          'Läuft der Zeitplan? Hängt ein Lauf? SELECT * FROM mart.sync_status LIMIT 5; ' +
          'und im Container: pgrep -f "bun run src/sync.ts"',
        werte: { faellig: faellig?.n, stundenOhneFortschritt: stillStunden },
      }
    : {
        name: 'fortschritt',
        stufe: 'ok',
        meldung: Number(faellig?.n ?? 0) === 0
          ? 'nichts fällig'
          : `${faellig!.n} fällig, zuletzt vor ${stillStunden ?? '?'} h etwas erledigt`,
        werte: { faellig: faellig?.n, stundenOhneFortschritt: stillStunden },
      })

  // --- 3. Scheitern die Läufe? --------------------------------------------
  //
  // Ein einzelner abgebrochener Lauf ist Alltag (Signal, Budget, Fensterende).
  // Drei gescheiterte in Folge sind es nicht.
  const laeufe = await query<{ status: string }>(
    `SELECT status FROM sync.lauf WHERE beendet_am IS NOT NULL ORDER BY lauf_id DESC LIMIT 3`)
  const alleGescheitert = laeufe.length === 3 && laeufe.every(l => l.status === 'fehlgeschlagen')
  p.push(alleGescheitert
    ? {
        name: 'laeufe',
        stufe: 'stoerung',
        meldung: 'die letzten drei Läufe sind fehlgeschlagen',
        naechster_schritt: 'SELECT * FROM mart.sync_status LIMIT 5;',
      }
    : { name: 'laeufe', stufe: 'ok', meldung: 'letzte Läufe unauffällig' })

  // --- 4. Wurde etwas aufgegeben? -----------------------------------------
  //
  /**
   * Ein aufgegebener Posten ist ein Zeitraum, den niemand mehr holt. Keine
   * Störung — aber ohne diese Zeile fällt es nie auf, weil eine Lücke in den
   * Daten aussieht wie ein Tag ohne Umsatz.
   *
   * GEZÄHLT WIRD SEIT DEM 13.08.2026 NUR NOCH DAS ENDGÜLTIGE. Vorher stand
   * hier „diese Zeiträume fehlen dauerhaft" über allem, was auf `aufgegeben`
   * stand. Seit Migration 0070 holt der nächtliche Lauf jeden Posten bis zu
   * MAX_WIEDERBELEBUNGEN mal zurück — für die ist der Satz schlicht falsch,
   * und eine Warnung, die zu viel behauptet, wird genauso ignoriert wie eine,
   * die nie ausschlägt.
   */
  const aufgegeben = await eine<{ endgueltig: number; offen: number }>(
    `SELECT count(*) FILTER (WHERE wiederbelebt >= $1)::int AS endgueltig,
            count(*) FILTER (WHERE wiederbelebt <  $1)::int AS offen
       FROM sync.warteschlange WHERE ergebnis = 'aufgegeben'`,
    [config.MAX_WIEDERBELEBUNGEN])
  const endgueltig = Number(aufgegeben?.endgueltig ?? 0)
  const nochOffen = Number(aufgegeben?.offen ?? 0)
  p.push(endgueltig > 0
    ? {
        name: 'aufgegebene_posten',
        stufe: 'warnung',
        meldung: `${endgueltig} Posten endgültig aufgegeben — diese Zeiträume fehlen dauerhaft`
               + (nochOffen > 0 ? `, ${nochOffen} weitere werden noch erneut versucht` : ''),
        naechster_schritt:
          "SELECT * FROM mart.posten_aufgegeben WHERE zustand = 'endgueltig';",
        werte: { endgueltig, wird_erneut_versucht: nochOffen },
      }
    : {
        name: 'aufgegebene_posten', stufe: 'ok',
        meldung: nochOffen > 0
          ? `nichts endgültig aufgegeben (${nochOffen} werden erneut versucht)`
          : 'nichts aufgegeben',
        werte: { endgueltig: 0, wird_erneut_versucht: nochOffen },
      })

  // --- 4b. Bekommt jede Quelle noch Zulauf? -------------------------------
  //
  /**
   * Die Prüfung zu AGENTS.md Regel 10, und die einzige hier, die etwas
   * findet, das gar keine Spur hinterlässt.
   *
   * Alle Prüfungen darüber setzen voraus, dass etwas SCHIEFGEHT: ein Posten
   * scheitert, ein Lauf bricht ab, eine Struktur weicht ab. Der teuerste
   * Fehler dieses Projekts hat nichts davon getan. Am 12.08.2026 fror das
   * Belegarchiv ein, die Läufe 85 bis 88 meldeten 269 von 269 Aufgaben „ok",
   * und `core.buchungsbeleg` bekam zwei Tage lang keinen einzigen Beleg. Es
   * gab nichts zu finden, weil nichts passierte.
   *
   * ZWEI STUFEN, WEIL ES ZWEI AUSFALLARTEN GIBT — dieselbe Unterscheidung wie
   * bei Yext darunter:
   *
   *   stumm, wird aber noch gefragt  → die Quelle liefert nichts. Ein Befund,
   *                                    vielleicht ein richtiger (Betriebsferien,
   *                                    keine Inventuren). Warnung.
   *   wird gar nicht mehr gefragt    → wir haben aufgehört zu fragen. Ein
   *                                    Baufehler, und der bekannte. Störung.
   */
  const zulauf = await zulaufStand()
  if (zulauf === null || Number(zulauf.erwartet) === 0) {
    // Vor dem ersten Lauf mit dieser Version ist das Register leer. Kein
    // Fehler, aber es soll dastehen — sonst hält jemand die fehlende Zeile
    // für ein „alles gut".
    p.push({
      name: 'zulauf', stufe: 'ok',
      meldung: 'Quellenregister noch nicht gefüllt — der nächste Lauf tut das',
      naechster_schritt: 'Bleibt es dabei, ist quellenSpiegeln() nicht gelaufen: '
                       + 'SELECT count(*) FROM sync.quelle;',
    })
  } else {
    const stumm = Number(zulauf.stumm)
    const ungefragt = Number(zulauf.ungefragt)
    p.push(stumm === 0
      ? {
          name: 'zulauf', stufe: 'ok',
          meldung: `alle ${zulauf.erwartet} erwarteten Quellen haben Zulauf`,
          werte: { erwartet: Number(zulauf.erwartet) },
        }
      : {
          name: 'zulauf',
          stufe: ungefragt > 0 ? 'stoerung' : 'warnung',
          meldung: ungefragt > 0
            ? `${ungefragt} Quelle(n) werden gar nicht mehr abgefragt: ${zulauf.namen.join(', ')}`
            : `${stumm} Quelle(n) ohne Zulauf: ${zulauf.namen.join(', ')}`,
          naechster_schritt:
            "SELECT * FROM mart.quelle_zulauf WHERE zustand <> 'ok'; " +
            'Auf wird_noch_gefragt sehen: false heisst, die Einreihbedingung ist kaputt ' +
            '(so wie am 12.08.2026 beim Belegarchiv), true heisst, die Quelle liefert nichts.',
          werte: { erwartet: Number(zulauf.erwartet), stumm, ungefragt, quellen: zulauf.namen },
        })
  }

  // --- 5. Hat sich LINAs Antwortstruktur geändert? ------------------------
  const abweichung = await eine<{ n: number }>(
    `SELECT count(*)::int AS n FROM sync.schema_abweichung WHERE quittiert_am IS NULL`)
  p.push(Number(abweichung?.n ?? 0) > 0
    ? {
        name: 'schema',
        stufe: 'warnung',
        meldung: `${abweichung!.n} offene Schemaabweichungen — LINA liefert etwas anderes als erwartet`,
        naechster_schritt:
          'SELECT * FROM sync.schema_abweichung WHERE quittiert_am IS NULL ORDER BY erkannt_am DESC;',
        werte: { anzahl: abweichung!.n },
      }
    : { name: 'schema', stufe: 'ok', meldung: 'Antwortstrukturen wie erwartet' })

  // --- 6. Findet die BWA ihre Betriebe? -----------------------------------
  //
  // Der Ausfall, der am 26.07.2026 7.860 Zeilen gekostet hat, ohne dass
  // irgendetwas rot wurde. Seitdem steht er hier.
  const ohneId = await eine<{ n: number }>(
    `SELECT count(*)::int AS n FROM core.betrieb WHERE lina_betrieb_id IS NULL AND aktiv`)
  p.push(Number(ohneId?.n ?? 0) > 0
    ? {
        name: 'bwa_bruecke',
        stufe: 'warnung',
        meldung: `${ohneId!.n} aktive Betriebe ohne LINA-ID — sie tauchen in keiner BWA-Auswertung auf`,
        naechster_schritt:
          'SELECT * FROM mart.betrieb_ohne_lina_id; danach analyticsFilterOptions einreihen.',
        werte: { anzahl: ohneId!.n },
      }
    : { name: 'bwa_bruecke', stufe: 'ok', meldung: 'alle aktiven Betriebe haben ihre LINA-ID' })

  // --- 7. Rückt die BWA überhaupt noch vor? -------------------------------
  //
  // Der Ausfall, den docs/lina-api-inventar.md beschreibt: ohne volle
  // BWA-Rechte liefert getKennzahlen stillschweigend Nullen statt eines
  // Fehlers. Jeder Posten meldet `ok`, jede Zahl ist 0, und niemand merkt es.
  //
  // Gemessen wird die SPITZE — der jüngste Monat, den irgendein Betrieb
  // gebucht hat. Nicht, wie viele Betriebe hinterherhängen: das ist
  // Normalzustand (26.07.2026: 62 von 141 nie gebucht, 38 der 69 buchenden
  // einen Monat hinter der Spitze) und würde die Ampel dauerhaft gelb färben.
  // Wer hinterherhängt, steht in mart.bwa_rueckstand.
  const bwa = await eine<{ spitze: string | null; monate: number | null }>(
    `SELECT max(letzter_monat) AS spitze,
            (EXTRACT(year  FROM age(date_trunc('month', now())::date, max(letzter_monat))) * 12
           + EXTRACT(month FROM age(date_trunc('month', now())::date, max(letzter_monat))))::int
              AS monate
       FROM core.bwa_buchungsstand`)
  const monate = bwa?.spitze === null || bwa?.spitze === undefined ? null : Number(bwa.monate)
  p.push(monate !== null && monate > config.STATUS_BWA_RUECKSTAND_MONATE
    ? {
        name: 'bwa_fortschritt',
        stufe: 'warnung',
        meldung: `jüngster gebuchter BWA-Monat ist ${bwa!.spitze} — ${monate} Monate zurück`,
        naechster_schritt:
          'Hat der Importer-Account noch volle BWA-Rechte? Ohne sie liefert getKennzahlen ' +
          'kommentarlos Nullen. Gegenprobe: SELECT * FROM mart.bwa_rueckstand ORDER BY letzter_monat;',
        werte: { spitze: bwa!.spitze, monateZurueck: monate },
      }
    : {
        name: 'bwa_fortschritt',
        stufe: 'ok',
        meldung: monate === null
          ? 'noch kein BWA-Buchungsstand erhoben'
          : `BWA gebucht bis ${bwa!.spitze}`,
        werte: { spitze: bwa?.spitze ?? null, monateZurueck: monate },
      })

  // --- 7. Kennen die Dashboard-Filter alle Betriebe? ----------------------
  //
  // Die Filter "Betrieb" und "Marke" in Metabase sind feste Wertelisten --
  // technisch unvermeidbar, weil die Karten natives SQL sind (siehe
  // docs/dashboards.md). Fest heisst: eine Momentaufnahme. Kommt ein Betrieb
  // dazu, fehlt er in der Auswahl.
  //
  // Das ist die gefaehrlichste Sorte Fehler, die dieses System kennt: das
  // Dashboard sieht vollstaendig richtig aus. Es fehlt nur ein Betrieb, und
  // niemand vermisst, was er nicht sieht. Deshalb wird hier nachgezaehlt.
  //
  // Behoben mit: bun run metabase/auswahllisten.ts --setzen
  const filterStand = await eine<{ betriebe: number }>(
    `SELECT count(*)::int AS betriebe FROM mart.betrieb
      WHERE betrieb IS NOT NULL AND betrieb <> ''`)
  const betriebeGesamt = Number(filterStand?.betriebe ?? 0)

  // Die Filterlisten stehen in Metabases eigener Datenbank. Sie liegt in
  // derselben Postgres-Instanz, ist aber eine ANDERE Datenbank -- ein Join
  // ist deshalb nicht moeglich, und ein zweiter Verbindungspool nur fuer
  // diese Pruefung waere zu teuer. Stattdessen liest die Pruefung den Wert,
  // den das Sync-Skript zuletzt hinterlassen hat.
  const filterSync = await eine<{ stand: number | null; alter_stunden: number | null }>(
    `SELECT (wert->>'anzahl_betriebe')::int AS stand,
            round(EXTRACT(epoch FROM (now() - gesetzt_am)) / 3600, 1)::float AS alter_stunden
       FROM sync.merker WHERE schluessel = 'metabase_auswahllisten'`)

  if (filterSync?.stand === null || filterSync?.stand === undefined) {
    p.push({
      name: 'dashboard_filter',
      stufe: 'ok',
      meldung: 'Auswahllisten noch nie abgeglichen',
      naechster_schritt:
        'Einmal "bun run metabase/auswahllisten.ts --setzen" laufen lassen, danach taeglich per Cron.',
      werte: { betriebe: betriebeGesamt, inFilter: null },
    })
  } else {
    const stand = Number(filterSync.stand)
    const fehlend = betriebeGesamt - stand
    p.push(fehlend !== 0
      ? {
          name: 'dashboard_filter',
          stufe: 'warnung',
          meldung: fehlend > 0
            ? `${fehlend} Betrieb(e) fehlen in der Filterauswahl der Dashboards`
            : `Filterauswahl kennt ${-fehlend} Betrieb(e), die es nicht mehr gibt`,
          naechster_schritt:
            'bun run metabase/auswahllisten.ts --setzen — laeuft der taegliche Cron-Auftrag noch?',
          werte: { betriebe: betriebeGesamt, inFilter: stand, alterStunden: filterSync.alter_stunden },
        }
      : {
          name: 'dashboard_filter',
          stufe: 'ok',
          meldung: `Filterauswahl kennt alle ${betriebeGesamt} Betriebe`,
          werte: { betriebe: betriebeGesamt, inFilter: stand, alterStunden: filterSync.alter_stunden },
        })
  }

  // --- Yext: laeuft der Nachlauf, und kommen die Analytics mit? -----------
  //
  // Bis zum 10.08.2026 gab es hier gar nichts. Yext konnte still stehen — ein
  // abgelaufener Schluessel, eine geaenderte Antwortstruktur, ein Konto ohne
  // Rechte — und der einzige Hinweis waere eine Bewertungsampel gewesen, die
  // sich nicht mehr bewegt. Das faellt niemandem auf, weil sie sich ohnehin
  // traege bewegt.
  //
  // ZWEI SIGNALE, WEIL ES ZWEI AUSFALLARTEN GIBT:
  //
  //   1. Der Nachlauf haengt   -> der Merker veraltet. Faelligkeit sind 20 h,
  //      48 h Toleranz decken einen ausgefallenen Sync-Lauf ab, ohne bei jeder
  //      Verzoegerung Alarm zu schlagen.
  //   2. Die Analytics fehlen  -> der Merker ist frisch, aber die drei
  //      Tabellen sind leer. Genau dieser Zustand bestand am 10.08.2026: der
  //      Nachlauf lief taeglich sauber, `analyticsLaden` hing an keinem
  //      automatischen Pfad. Ein frischer Zeitstempel neben leeren Tabellen
  //      ist der irrefuehrendste Zustand von beiden.
  // Die Schluesselpruefung steht VOR der Abfrage: ohne Yext gibt es nichts zu
  // messen, und eine Instanz ohne Schluessel soll dafuer auch keine Zaehlung
  // ueber drei Tabellen fahren.
  if (!config.YEXT_API_KEY) {
    // Kein Schluessel ist kein Fehler: Yext ist optional. Aber es soll
    // dastehen, damit niemand leere Bewertungskarten fuer einen Defekt haelt.
    p.push({
      name: 'yext', stufe: 'ok',
      meldung: 'Yext nicht eingerichtet (kein Schlüssel) — Bewertungskarten bleiben leer',
    })
  } else {
    const yext = await eine<{
      alter_stunden: number | null; themen: number; antworten: number; noten: number
    }>(
      `SELECT round(EXTRACT(epoch FROM (now() - (m.wert->>'beendet_am')::timestamptz)) / 3600, 1)
                AS alter_stunden,
              (SELECT count(*) FROM core.bewertung_thema)   AS themen,
              (SELECT count(*) FROM core.bewertung_antwort) AS antworten,
              (SELECT count(*) FROM core.bewertung_note)    AS noten
         FROM (SELECT 1) x
         LEFT JOIN sync.merker m ON m.schluessel = 'yext_letzter_lauf'`)

    const leer = Number(yext?.themen) === 0
              && Number(yext?.antworten) === 0
              && Number(yext?.noten) === 0

    if (yext?.alter_stunden == null) {
      p.push({
        name: 'yext', stufe: 'warnung',
        meldung: 'Yext-Nachlauf ist noch nie gelaufen',
        naechster_schritt:
          'Einmal "bun run yext" im Container laufen lassen; danach fährt der Sync ihn selbst mit.',
      })
    } else if (yext.alter_stunden > 48) {
      p.push({
        name: 'yext', stufe: 'warnung',
        meldung: `Yext-Nachlauf seit ${yext.alter_stunden} h nicht gelaufen`,
        naechster_schritt: 'Läuft der Sync noch? Der Nachlauf hängt an ihm — siehe Prüfung "laeufe".',
        werte: { alterStunden: yext.alter_stunden },
      })
    } else if (leer) {
      // Der irrefuehrendste der drei Zustaende: frischer Zeitstempel neben
      // leeren Tabellen. Genau so stand es am 10.08.2026 da, und genau
      // deshalb gibt es diese Pruefung.
      p.push({
        name: 'yext', stufe: 'warnung',
        meldung: 'Yext läuft, aber die Analytics-Tabellen sind leer (Themen, Antwortverhalten, Noten)',
        naechster_schritt:
          'Erwartet nur vor dem ersten Lauf mit dieser Version. Bleibt es dabei, hat analyticsLaden '
          + 'gemeldet — im Log nach "yext-analytics fehlgeschlagen" suchen.',
        werte: { alterStunden: yext.alter_stunden, themen: 0, antworten: 0, noten: 0 },
      })
    } else {
      p.push({
        name: 'yext', stufe: 'ok',
        meldung: `Yext aktuell (vor ${yext.alter_stunden} h), Analytics gefüllt`,
        werte: {
          alterStunden: yext.alter_stunden, themen: Number(yext.themen),
          antworten: Number(yext.antworten), noten: Number(yext.noten),
        },
      })
    }
  }

  return {
    status: schlimmste(p.map(x => x.stufe)),
    geprueft_am: new Date().toISOString(),
    pruefungen: p,
  }
}
