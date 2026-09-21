/**
 * DIE GEGENPROBE ZU MIGRATION 0111 — das Wetter je Geschäftstag liegt seit
 * dem 21.09.2026 in einer materialisierten Sicht.
 *
 * WARUM DER UMBAU NÖTIG WAR. `mart.wetter_tag` gruppierte bei JEDER Abfrage
 * alle 3,42 Mio. Zeilen von `manual.wetter_stunde` nach
 * `core.geschaeftstag(zeitpunkt)`. Ein Funktionswert als Gruppenschlüssel
 * nimmt keinen Index an und lässt keinen Datumsfilter vor die Aggregation:
 * gemessen in Produktion am 21.09.2026 kostete EIN Tag aus
 * `mart.betrieb_wetter_tag` 7,4 s und ein ganzes Jahr ebenfalls 7,4 s.
 *
 * WAS DIESER TEST ABSICHERT, und es sind zwei verschiedene Dinge:
 *
 *   1. DIE HÜLLE IST KEINE ÄNDERUNG. `mart.wetter_tag` ist jetzt ein
 *      `SELECT ... FROM mart.wetter_tag_basis` — dieselben 28 Spalten, in
 *      derselben Reihenfolge, mit denselben Typen. Daran hängen sechs
 *      Sichten (`mart.betrieb_wetter_tag`, darüber `mart.vergleichstag` und
 *      `mart.wettertag_lage`, darüber `mart.wetter_effekt` und
 *      `mart.wetter_effekt_gruppe`). Eine umsortierte oder umgetypte Spalte
 *      merkt niemand, bis eine Karte falsche Zahlen zeigt.
 *
 *   2. DIE VERDICHTUNG RECHNET WEITER RICHTIG. Eine Stichprobe — ein
 *      Gitterpunkt, ein Tag — wird gegen eine direkte Aggregation über
 *      `manual.wetter_stunde` gestellt. Die Referenz leitet den
 *      Geschäftstag ABSICHTLICH selbst ab (Berliner Ortszeit minus acht
 *      Stunden) statt `core.geschaeftstag()` zu rufen: der Geschäftstag ist
 *      genau die Stelle, an der ein naiver Umbau das Wetter um acht Stunden
 *      gegen den Umsatz verschiebt, ohne dass es auffällt.
 *
 *   3. DER REFRESH LÄUFT AUF LEERER UND AUF BEFÜLLTER SICHT. Eine
 *      Datenbank aus einem Schema-Abzug hat ausnahmslos unbefüllte
 *      Materialisierungen, und `REFRESH ... CONCURRENTLY` braucht einen
 *      alten Stand, gegen den es abgleicht — ohne ihn bricht es ab. Genau
 *      daran ist der Ende-zu-Ende-Test nach 0080 hängengeblieben; neun von
 *      zehn Sichten scheiterten, als es am 20.08.2026 nachgestellt wurde.
 *
 *      DIESER TEST HAT DABEI EINEN ZWEITEN FEHLER GEFUNDEN, am 21.09.2026:
 *      `sync/auffrischen.ts` fing den Fall an SQLSTATE 55000 ab, und den
 *      wirft `REFRESH ... CONCURRENTLY` nicht. Es ist 0A000; 55000 kommt
 *      erst beim LESEN einer unbefüllten Sicht. Der Fallback hat damit seit
 *      dem 20.08.2026 nie gegriffen — unbemerkt, weil die Nachläufe jeden
 *      Fehler fangen. Berichtigt in derselben Sitzung.
 *
 * Braucht eine Datenbank mit angewandter 0111 und Wetterdaten; ohne wird
 * übersprungen statt rot.
 */
import { describe, expect, test } from 'bun:test'
import { query } from '../db/pool'
import { wetterMaterialisierungAuffrischen } from './nachlauf'

/**
 * ZWEI VORPRÜFUNGEN, und die Trennung ist der Punkt.
 *
 * `vorhanden()` will nur die Sicht und Wetterdaten — das reicht für den
 * Refresh, und zwar ausdrücklich AUCH im unbefüllten Zustand: genau den prüft
 * der zweite Block. `bereit()` verlangt zusätzlich, dass sie befüllt ist,
 * denn ein Wertvergleich gegen eine leere Tabelle vergleicht nichts.
 *
 * Übersprungen statt rot, dieselbe Haltung wie in sync/vergleichstag.test.ts:
 * ein roter Test, der „keine Daten" bedeutet, sagt nichts über den Code.
 */
async function vorhanden(): Promise<string | null> {
  try {
    const [r] = await query<{ befuellt: boolean; stunden: number; entfernt: boolean }>(`
      SELECT c.relispopulated AS befuellt,
             (SELECT count(*)::int FROM manual.wetter_stunde) AS stunden,
             (inet_server_addr() IS NOT NULL
              AND host(inet_server_addr()) NOT IN ('127.0.0.1', '::1')) AS entfernt
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'mart' AND c.relname = 'wetter_tag_basis'`)
    if (!r) return 'mart.wetter_tag_basis gibt es nicht (Migration 0111 nicht angewendet)'
    if (r.stunden === 0) return 'manual.wetter_stunde ist leer'
    /*
     * NOTBREMSE. Der zweite Block unten leert die Materialisierung mit
     * REFRESH ... WITH NO DATA, und an ihr haengen sechs Sichten: bis zum
     * Refresh danach waeren sie alle unlesbar — in Produktion fuer die Dauer
     * eines vollen Neuaufbaus ueber 3,4 Mio. Stundenwerte, vor jedem
     * Dashboard und jedem MCP-Zugriff. Ein Test, der das gegen eine entfernte
     * Datenbank tut, tut es nie mit Absicht. Deshalb: nur gegen einen
     * Postgres auf dieser Maschine (Unix-Socket oder Loopback).
     */
    if (r.entfernt) return 'DATABASE_URL zeigt auf einen entfernten Server — kein Schreibtest'
    return null
  } catch (e) {
    return `keine Datenbank: ${String(e).slice(0, 120)}`
  }
}

async function bereit(): Promise<string | null> {
  const grund = await vorhanden()
  if (grund) return grund
  return (await befuellt())
    ? null
    : 'mart.wetter_tag_basis ist nicht befuellt (frischer Klon)'
}

/** Ist die Materialisierung befüllt? Ein SELECT darauf wäre PG 55000. */
async function befuellt(): Promise<boolean> {
  const [r] = await query<{ befuellt: boolean }>(`
    SELECT c.relispopulated AS befuellt
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'mart' AND c.relname = 'wetter_tag_basis'`)
  return r?.befuellt === true
}

/**
 * pg_attribute und NICHT information_schema.columns — das ist die Lehre aus
 * 0108: materialisierte Sichten stehen im information_schema überhaupt nicht,
 * der SQL-Standard kennt sie nicht. Die Abfrage hätte für die Basis eine
 * leere Menge geliefert, und der Vergleich wäre lautlos durchgelaufen.
 */
const SPALTEN = `
  SELECT a.attnum, a.attname AS spalte, format_type(a.atttypid, a.atttypmod) AS typ
    FROM pg_attribute a
   WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
   ORDER BY a.attnum`

type Spalte = { attnum: number; spalte: string; typ: string }

describe('Wetter je Geschaeftstag: die Huelle deckt die Materialisierung', () => {
  test('dieselben Spalten in derselben Reihenfolge mit denselben Typen', async () => {
    const grund = await bereit()
    if (grund) { console.log(`uebersprungen — ${grund}`); return }

    const huelle = await query<Spalte>(SPALTEN, ['mart.wetter_tag'])
    const basis  = await query<Spalte>(SPALTEN, ['mart.wetter_tag_basis'])

    // Erst die Liste als Ganzes: so steht bei einem Fehlschlag die
    // abweichende Spalte samt Typ im Protokoll und nicht nur eine Zahl.
    expect(huelle.map(s => `${s.spalte} ${s.typ}`))
      .toEqual(basis.map(s => `${s.spalte} ${s.typ}`))
    // Und die Zahl selbst, damit ein gleichzeitiges Streichen auf beiden
    // Seiten auffällt: 28 Spalten sind der Stand seit 0087.
    expect(huelle).toHaveLength(28)
  }, 60_000)

  /**
   * Die Stichprobe. EIN Gitterpunkt, EIN Tag — und zwar ein Tag mit allen 24
   * Stunden, damit die Referenz nicht an einer Lücke im Bestand hängt. Der
   * jüngste solche Tag, weil er am ehesten aus dem rollierenden Fenster
   * kommt und damit aus der Schreibbahn des Nachlaufs.
   */
  test('eine Stichprobe stimmt mit der direkten Aggregation ueberein', async () => {
    const grund = await bereit()
    if (grund) { console.log(`uebersprungen — ${grund}`); return }

    const [probe] = await query<{ breite: string; laenge: string; geschaeftstag: string }>(`
      SELECT breite, laenge, geschaeftstag::text
        FROM mart.wetter_tag_basis
       WHERE stunden_ganztags = 24 AND stunden_fenster = 16
       ORDER BY geschaeftstag DESC, breite, laenge
       LIMIT 1`)
    if (!probe) { console.log('uebersprungen — kein vollstaendiger Tag im Bestand'); return }

    /*
     * Die Referenz. Der Geschäftstag wird hier AUSGESCHRIEBEN und nicht über
     * core.geschaeftstag() geholt: Berliner Ortszeit minus acht Stunden. Wer
     * die Funktion in beiden Fassungen ruft, prüft nur, dass sie mit sich
     * selbst übereinstimmt — und der Geschäftstag ist genau die Stelle, an
     * der ein Umbau das Wetter um acht Stunden verschiebt.
     */
    const [r] = await query<Record<string, string | number | null>>(`
      WITH stunde AS (
        SELECT ((zeitpunkt AT TIME ZONE 'Europe/Berlin') - interval '8 hours')::date AS geschaeftstag,
               extract(hour FROM zeitpunkt AT TIME ZONE 'Europe/Berlin')::int AS stunde,
               temperatur, niederschlag, sonnenschein, wind, bewoelkung, zustand, distanz_m
          FROM manual.wetter_stunde
         WHERE breite = $1::numeric AND laenge = $2::numeric
      ), referenz AS (
        SELECT count(*)::int AS stunden_ganztags,
               count(*) FILTER (WHERE stunde >= 8)::int AS stunden_fenster,
               min(distanz_m) AS distanz_m,
               round(max(temperatur)   FILTER (WHERE stunde >= 8), 1) AS fenster_temp_max,
               round(min(temperatur)   FILTER (WHERE stunde >= 8), 1) AS fenster_temp_min,
               round(avg(temperatur)   FILTER (WHERE stunde >= 8), 1) AS fenster_temp_schnitt,
               round(sum(niederschlag) FILTER (WHERE stunde >= 8), 2) AS fenster_niederschlag,
               round(max(wind)         FILTER (WHERE stunde >= 8), 1) AS fenster_wind_max,
               round(avg(bewoelkung)   FILTER (WHERE stunde >= 8), 0) AS fenster_bewoelkung,
               round(100.0 * sum(sonnenschein) FILTER (WHERE stunde >= 8)
                     / nullif(60.0 * count(sonnenschein) FILTER (WHERE stunde >= 8), 0), 1)
                                                                      AS fenster_sonne_pct,
               count(sonnenschein) FILTER (WHERE stunde >= 8)::int    AS fenster_sonne_stunden,
               round(max(temperatur), 1)   AS tag_temp_max,
               round(min(temperatur), 1)   AS tag_temp_min,
               round(avg(temperatur), 1)   AS tag_temp_schnitt,
               round(sum(niederschlag), 2) AS tag_niederschlag,
               round(max(wind), 1)         AS tag_wind_max,
               round(avg(bewoelkung), 0)   AS tag_bewoelkung,
               round(100.0 * sum(sonnenschein) / nullif(60.0 * count(sonnenschein), 0), 1)
                                           AS tag_sonne_pct
          FROM stunde WHERE geschaeftstag = $3::date
      )
      SELECT to_jsonb(referenz) AS referenz,
             to_jsonb(basis)    AS gespeichert
        FROM referenz,
             LATERAL (SELECT stunden_ganztags, stunden_fenster, distanz_m,
                             fenster_temp_max, fenster_temp_min, fenster_temp_schnitt,
                             fenster_niederschlag, fenster_wind_max, fenster_bewoelkung,
                             fenster_sonne_pct, fenster_sonne_stunden,
                             tag_temp_max, tag_temp_min, tag_temp_schnitt,
                             tag_niederschlag, tag_wind_max, tag_bewoelkung, tag_sonne_pct
                        FROM mart.wetter_tag_basis
                       WHERE breite = $1::numeric AND laenge = $2::numeric
                         AND geschaeftstag = $3::date) basis`,
      [probe.breite, probe.laenge, probe.geschaeftstag])

    expect(r).toBeDefined()
    expect(r!.gespeichert).toEqual(r!.referenz)
  }, 120_000)

  /**
   * Die beiden Zustandsspalten bleiben aus dem Vergleich oben heraus, und das
   * ist Absicht: `mode() WITHIN GROUP` wählt bei GLEICHSTAND einen der
   * häufigsten Werte, ohne dass die Reihenfolge zugesichert wäre. Ein
   * Gleichstand ist an einem Tag mit zwei Wetterlagen der Normalfall — ein
   * strenger Vergleich wäre ein Test, der gelegentlich rot wird, ohne dass
   * etwas kaputt ist. Geprüft wird deshalb das, was zugesichert IST: der
   * Wert muss in den Stunden vorkommen, aus denen er stammt.
   */
  test('fenster_zustand kommt aus den Fensterstunden dieses Tages', async () => {
    const grund = await bereit()
    if (grund) { console.log(`uebersprungen — ${grund}`); return }

    const [r] = await query<{ geprueft: number; fremd: number }>(`
      SELECT count(*)::int AS geprueft,
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM manual.wetter_stunde s
                WHERE s.breite = w.breite AND s.laenge = w.laenge
                  AND core.geschaeftstag(s.zeitpunkt) = w.geschaeftstag
                  AND extract(hour FROM s.zeitpunkt AT TIME ZONE 'Europe/Berlin')::int >= 8
                  AND s.zustand = w.fenster_zustand))::int AS fremd
        FROM mart.wetter_tag_basis w
       WHERE w.fenster_zustand IS NOT NULL
         AND w.geschaeftstag >= current_date - 60`)
    expect(r!.fremd).toBe(0)
    expect(r!.geprueft).toBeGreaterThan(0)
  }, 120_000)
})

/**
 * Der Refresh-Schritt des Wetter-Nachlaufs.
 *
 * WIRFT NIE ist die Zusage im Kopf von wetter/nachlauf.ts, und sie gilt für
 * beide Zustände, in denen die Sicht vorliegen kann. `REFRESH ... WITH NO
 * DATA` stellt den Zustand „nie befüllt" her — dasselbe, was ein
 * Schema-Abzug hinterlässt — und `relispopulated` sagt danach false. Ein
 * `REFRESH ... CONCURRENTLY` endet dann in PG 0A000 (ein `SELECT` wäre 55000 —
 * zwei verschiedene Meldungen, siehe sync/auffrischen.ts); der Fallback dort
 * füllt einmal ohne CONCURRENTLY, danach greift der nebenläufige Weg.
 *
 * DIESER TEST SCHREIBT, und zwar genau das, was der Nachtlauf ohnehin
 * schreibt: dieselbe Sicht, denselben Merker. Er hinterlässt die
 * Materialisierung befüllt — der letzte Schritt ist ein gelungener Refresh.
 * Bricht er vorher ab, holt die nächste Nacht sie ein.
 */
describe('Wetter-Nachlauf: der Refresh laeuft in beiden Zustaenden durch', () => {
  test('auf leerer Sicht: einmal ohne CONCURRENTLY, ohne zu werfen', async () => {
    // vorhanden() und NICHT bereit(): eine unbefuellte Sicht ist hier der
    // Prueffall und kein Grund zu ueberspringen.
    const grund = await vorhanden()
    if (grund) { console.log(`uebersprungen — ${grund}`); return }

    await query(`REFRESH MATERIALIZED VIEW mart.wetter_tag_basis WITH NO DATA`)
    expect(await befuellt()).toBe(false)

    const a = await wetterMaterialisierungAuffrischen()
    expect(a.status).toBe('aufgefrischt')
    // Der Fall „nie befüllt": CONCURRENTLY scheitert (0A000), der Fallback trägt.
    expect(a.nebenlaeufig).toBe(false)
    expect(await befuellt()).toBe(true)
  }, 600_000)

  test('auf befuellter Sicht: nebenlaeufig, und der Merker wird gesetzt', async () => {
    const grund = await vorhanden()
    if (grund) { console.log(`uebersprungen — ${grund}`); return }
    // Laeuft die Datei ganz durch, hat der Test davor sie befuellt. Einzeln
    // gestartet kann sie es nicht sein — dann erst einmal befuellen, damit
    // hier wirklich der nebenlaeufige Weg geprueft wird und nicht der Fallback.
    if (!(await befuellt())) await wetterMaterialisierungAuffrischen()

    const a = await wetterMaterialisierungAuffrischen()
    expect(a.status).toBe('aufgefrischt')
    expect(a.nebenlaeufig).toBe(true)
    expect(a.dauerS).toBeGreaterThanOrEqual(0)

    // Der Merker ist die einzige Spur, die mart.materialisierung_stand liest
    // (0091/0111). Ohne ihn stünde die Sicht dort auf "nie aufgefrischt",
    // während sie in Wahrheit jede Nacht frisch wird.
    const [m] = await query<{ dauer_s: string; nebenlaeufig: boolean; alt_s: number }>(`
      SELECT (wert ->> 'dauer_s') AS dauer_s,
             (wert ->> 'nebenlaeufig')::boolean AS nebenlaeufig,
             extract(epoch FROM now() - gesetzt_am)::int AS alt_s
        FROM sync.merker WHERE schluessel = 'wetter_tag_refresh'`)
    expect(m).toBeDefined()
    expect(m!.nebenlaeufig).toBe(true)
    expect(m!.alt_s).toBeLessThan(600)

    // Und der Stand, wie /status ihn liest: die Sicht steht in der Zuordnung
    // und nicht als "ohne Refresh" da.
    const [s] = await query<{ schluessel: string; nachlauf: string; zustand: string }>(`
      SELECT schluessel, nachlauf, zustand FROM mart.materialisierung_stand
       WHERE sicht = 'mart.wetter_tag_basis'`)
    expect(s?.schluessel).toBe('wetter_tag_refresh')
    expect(s?.nachlauf).toBe('src/wetter/nachlauf.ts')
    expect(s?.zustand).not.toBe('ohne Refresh')
  }, 600_000)
})
