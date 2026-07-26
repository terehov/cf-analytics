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
  // Ein aufgegebener Posten ist ein Zeitraum, den niemand mehr holt. Keine
  // Störung — aber ohne diese Zeile fällt es nie auf, weil eine Lücke in den
  // Daten aussieht wie ein Tag ohne Umsatz.
  const aufgegeben = await eine<{ n: number }>(
    `SELECT count(*)::int AS n FROM sync.warteschlange
      WHERE ergebnis = 'aufgegeben' AND erledigt_am > now() - interval '24 hours'`)
  p.push(Number(aufgegeben?.n ?? 0) > 0
    ? {
        name: 'aufgegebene_posten',
        stufe: 'warnung',
        meldung: `${aufgegeben!.n} Posten in 24 h aufgegeben — diese Zeiträume fehlen dauerhaft`,
        naechster_schritt:
          "SELECT endpunkt, zeitraum_von, letzter_fehler FROM sync.warteschlange " +
          "WHERE ergebnis = 'aufgegeben' ORDER BY erledigt_am DESC LIMIT 20;",
        werte: { anzahl: aufgegeben!.n },
      }
    : { name: 'aufgegebene_posten', stufe: 'ok', meldung: 'nichts aufgegeben' })

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

  return {
    status: schlimmste(p.map(x => x.stufe)),
    geprueft_am: new Date().toISOString(),
    pruefungen: p,
  }
}
