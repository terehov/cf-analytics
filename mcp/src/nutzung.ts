/**
 * Die Nutzungsauswertung — wer den Zugang wie nutzt. Nur fuer Konten mit
 * `mcp.nutzer.darf_nutzung` (0148).
 *
 * ENTSCHIEDEN 06.11.2026 (Eugene): ein Nutzer sieht keine anderen Nutzer und
 * kann die Nutzung auch nicht als Zahl abfragen. Bis dahin konnte er das —
 * `SELECT anzeige, sql FROM mcp.zugriff` lief unter `mcp_leser` durch
 * (docs/fehlerkatalog.md). Eugene und Daniel bekommen dafuer dieses Werkzeug.
 *
 * WARUM EIN EIGENES WERKZEUG UND KEINE FREIE ABFRAGE. Die freie Abfrage
 * laeuft als `mcp_leser`, und die Rolle darf das Protokoll nicht lesen —
 * fuer niemanden, auch nicht fuer die zwei, die es duerfen. Postgres kennt
 * nur Rollen, keine Konten; eine Ausnahme fuer zwei Konten waere eine
 * Ausnahme fuer alle. Hier laufen deshalb FESTE Abfragen ueber die
 * Verwaltungsrolle `mcp_anmeldung`, mit gebundenen Werten. Die Werte des
 * Modells werden nie SQL.
 *
 * DIE ANSICHTEN sind die, mit denen am 06.11.2026 die erste Auswertung von
 * Hand gemacht wurde: je Konto, im Verlauf, je Werkzeug, nach Tageszeit,
 * die Fehler — und die einzelnen Aufrufe mit ihrem SQL, fuer die Frage
 * „was genau hat X gefragt" (dieselbe, mit der am 16.09.2026 ein Widerspruch
 * in einer ChatGPT-Antwort auf einen abgetippten Artikel zurueckging).
 */
import { anmeldungPool } from './anmeldung/db'
import { nutzerNachSubject } from './anmeldung/speicher'
import { subjektAus } from './auth'

export const NUTZUNG_WERKZEUG = 'nutzung_auswerten'

export const ANSICHTEN = ['konten', 'verlauf', 'werkzeuge', 'tageszeit', 'fehler', 'aufrufe'] as const
export type Ansicht = typeof ANSICHTEN[number]

export const RASTER = ['tag', 'woche', 'monat'] as const
export type Raster = typeof RASTER[number]

export type Auswahl = {
  ansicht: Ansicht
  von?: string | null
  bis?: string | null
  konto?: string | null
  raster?: Raster | null
  grenze?: number | null
}

/** Hoechstens so viele Zeilen bei Fehlern und Einzelaufrufen — die anderen Ansichten sind von Natur klein. */
export const GRENZE_MAX = 500
const GRENZE_STANDARD = 100

const DATUM = /^\d{4}-\d{2}-\d{2}$/

/** Deutsche Zeit, wie der Fachbereich sie liest; das Protokoll steht in UTC. */
const ORTSZEIT = `(z.zeitpunkt AT TIME ZONE 'Europe/Berlin')`
const FORMAT_ZEIT = `'YYYY-MM-DD HH24:MI'`

/**
 * Das gefilterte Protokoll, auf das jede Ansicht aufsetzt. $1 von, $2 bis
 * (je deutscher Kalendertag, beide einschliesslich), $3 Konto (Teil von
 * Name oder Mailadresse, gross/klein egal).
 */
const GEFILTERT = `
  z AS (
    SELECT z.*, ${ORTSZEIT} AS ortszeit,
           coalesce(n.anzeige, z.anzeige, z.subject) AS konto, n.email
      FROM mcp.zugriff z
      LEFT JOIN mcp.nutzer n ON n.subject = z.subject
     WHERE ($1::date IS NULL OR ${ORTSZEIT}::date >= $1::date)
       AND ($2::date IS NULL OR ${ORTSZEIT}::date <= $2::date)
       AND ($3::text IS NULL
            OR coalesce(n.anzeige, z.anzeige, '') ILIKE '%' || $3 || '%'
            OR coalesce(n.email, '') ILIKE '%' || $3 || '%')
  )`

const RASTER_SQL: Record<Raster, { trunc: string; format: string }> = {
  tag:   { trunc: 'day',   format: `'YYYY-MM-DD'` },
  woche: { trunc: 'week',  format: `'YYYY-MM-DD'` },
  monat: { trunc: 'month', format: `'YYYY-MM'` },
}

/** Fest je Ansicht. `$4` ist die Zeilengrenze, wo es eine gibt. */
function abfrage(a: Ansicht, raster: Raster): string {
  switch (a) {
    // Eine Zeile je Konto — auch fuer Konten ohne einen einzigen Aufruf im
    // Zeitraum: „hat den Zugang nie benutzt" ist ein Befund (Regel 10).
    case 'konten': return `
      WITH ${GEFILTERT}
      SELECT coalesce(n.anzeige, min(z.konto))                         AS konto,
             n.email, n.stufe, n.aktiv,
             to_char(n.angelegt_am AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS angelegt,
             count(z.zugriff_id)::int                                  AS aufrufe,
             count(DISTINCT z.ortszeit::date)::int                     AS aktive_tage,
             count(*) FILTER (WHERE z.werkzeug = 'abfrage_ausfuehren')::int AS freie_abfragen,
             count(*) FILTER (WHERE z.werkzeug LIKE 'bericht%')::int   AS berichte,
             count(*) FILTER (WHERE z.gesperrt)::int                   AS gesperrt,
             count(z.fehler)::int                                      AS fehler,
             round(avg(z.dauer_ms))::int                               AS dauer_ms_schnitt,
             max(z.dauer_ms)                                           AS dauer_ms_max,
             to_char(min(z.ortszeit), ${FORMAT_ZEIT})                  AS erstmals,
             to_char(max(z.ortszeit), ${FORMAT_ZEIT})                  AS zuletzt
        FROM mcp.nutzer n
        FULL JOIN z ON z.subject = n.subject
       WHERE $3::text IS NULL
          OR coalesce(n.anzeige, z.konto, '') ILIKE '%' || $3 || '%'
          OR coalesce(n.email, '') ILIKE '%' || $3 || '%'
       GROUP BY coalesce(n.subject, z.subject), n.anzeige, n.email, n.stufe, n.aktiv, n.angelegt_am
       ORDER BY aufrufe DESC, konto`

    case 'verlauf': {
      const r = RASTER_SQL[raster]
      return `
      WITH ${GEFILTERT}
      SELECT to_char(date_trunc('${r.trunc}', ortszeit), ${r.format}) AS zeitraum,
             count(*)::int                              AS aufrufe,
             count(DISTINCT subject)::int               AS konten,
             count(DISTINCT ortszeit::date)::int        AS aktive_tage,
             count(*) FILTER (WHERE werkzeug = 'abfrage_ausfuehren')::int AS freie_abfragen,
             count(*) FILTER (WHERE gesperrt)::int      AS gesperrt,
             count(fehler)::int                         AS fehler
        FROM z
       GROUP BY 1 ORDER BY 1`
    }

    case 'werkzeuge': return `
      WITH ${GEFILTERT}
      SELECT werkzeug,
             count(*)::int                              AS aufrufe,
             count(DISTINCT subject)::int               AS konten,
             count(*) FILTER (WHERE gesperrt)::int      AS gesperrt,
             count(fehler)::int                         AS fehler,
             round(avg(dauer_ms))::int                  AS dauer_ms_schnitt,
             max(dauer_ms)                              AS dauer_ms_max
        FROM z
       GROUP BY 1 ORDER BY 2 DESC, 1`

    case 'tageszeit': return `
      WITH ${GEFILTERT}
      SELECT extract(isodow FROM ortszeit)::int         AS wochentag_nr,
             (ARRAY['Mo','Di','Mi','Do','Fr','Sa','So'])[extract(isodow FROM ortszeit)::int] AS wochentag,
             extract(hour FROM ortszeit)::int           AS stunde,
             count(*)::int                              AS aufrufe,
             count(DISTINCT subject)::int               AS konten
        FROM z
       GROUP BY 1, 2, 3 ORDER BY 1, 3`

    // Gruppiert nach Meldung. Bei einer Sperre ist die Meldung der Schluessel
    // der Regel, die zugeschnappt ist — das ist die Anforderungsliste fuer
    // die naechsten mart-Sichten.
    case 'fehler': return `
      WITH ${GEFILTERT}
      SELECT CASE WHEN gesperrt THEN 'gesperrt' ELSE 'fehler' END AS art,
             left(regexp_replace(coalesce(fehler,
                    (SELECT h ->> 'schluessel' FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(hinweise) = 'array' THEN hinweise ELSE '[]'::jsonb END) h
                      WHERE h ->> 'schwere' = 'sperre' LIMIT 1),
                    '(ohne Meldung)'), '\\s+', ' ', 'g'), 160) AS meldung,
             count(*)::int                              AS anzahl,
             count(DISTINCT subject)::int               AS konten,
             string_agg(DISTINCT konto, ', ')           AS wer,
             string_agg(DISTINCT werkzeug, ', ')        AS werkzeuge,
             to_char(max(ortszeit), ${FORMAT_ZEIT})     AS zuletzt
        FROM z
       WHERE fehler IS NOT NULL OR gesperrt
       GROUP BY 1, 2 ORDER BY anzahl DESC, zuletzt DESC
       LIMIT $4`

    case 'aufrufe': return `
      WITH ${GEFILTERT}
      SELECT to_char(ortszeit, 'YYYY-MM-DD HH24:MI:SS') AS zeitpunkt,
             konto, werkzeug, gesperrt, zeilen, dauer_ms,
             left(fehler, 300)                          AS fehler,
             coalesce(sql, parameter::text)             AS abfrage
        FROM z
       ORDER BY z.zeitpunkt DESC
       LIMIT $4`
  }
}

export class AuswahlFehler extends Error {
  constructor(meldung: string) { super(meldung); this.name = 'AuswahlFehler' }
}

/** Die Werte pruefen und in Bindungen uebersetzen — ohne Datenbank, damit es testbar ist. */
export function bindungen(a: Auswahl): { sql: string; werte: unknown[] } {
  if (!ANSICHTEN.includes(a.ansicht)) {
    throw new AuswahlFehler(`Unbekannte Ansicht "${a.ansicht}". Moeglich: ${ANSICHTEN.join(', ')}.`)
  }
  for (const [name, wert] of [['von', a.von], ['bis', a.bis]] as const) {
    if (wert && !DATUM.test(wert)) {
      throw new AuswahlFehler(`"${name}" muss ein Datum wie 2026-11-01 sein, nicht "${wert}".`)
    }
  }
  const raster = a.raster ?? 'woche'
  if (!RASTER.includes(raster)) {
    throw new AuswahlFehler(`Unbekanntes Raster "${raster}". Moeglich: ${RASTER.join(', ')}.`)
  }
  const grenze = Math.min(Math.max(Math.trunc(a.grenze ?? GRENZE_STANDARD), 1), GRENZE_MAX)
  const konto = a.konto?.trim() || null
  const werte: unknown[] = [a.von || null, a.bis || null, konto]
  if (a.ansicht === 'fehler' || a.ansicht === 'aufrufe') werte.push(grenze)
  return { sql: abfrage(a.ansicht, raster), werte }
}

/** Mit den Spaltennamen aus Postgres — eine leere Ansicht soll ihre Spalten trotzdem nennen. */
export async function nutzungAuswerten(a: Auswahl): Promise<{ spalten: string[]; zeilen: Record<string, unknown>[] }> {
  const { sql, werte } = bindungen(a)
  const r = await anmeldungPool.query(sql, werte)
  return { spalten: r.fields.map(f => f.name), zeilen: r.rows as Record<string, unknown>[] }
}

/**
 * Darf das anfragende Konto die Nutzung sehen? Fuer `tools/list`, wo es kein
 * `anmelden()` gibt. Im Zweifel nein — wer hier faelschlich nein bekommt,
 * sieht ein Werkzeug nicht; wer faelschlich ja bekaeme, saehe es nur, denn
 * das Werkzeug prueft selbst noch einmal (auth.ts, nutzungDuerfen).
 */
export async function darfNutzungSehen(extra: unknown): Promise<boolean> {
  const subject = subjektAus(extra)
  if (!subject) return false
  try {
    const n = await nutzerNachSubject(subject)
    return Boolean(n && n.aktiv && n.stufe !== 'gesperrt' && n.darf_nutzung)
  } catch {
    return false
  }
}

/**
 * `tools/list` ohne das Werkzeug fuer alle, die es nicht nutzen duerfen.
 *
 * Nicht die Sperre, sondern dass ein Modell nicht anbietet, was es nicht
 * kann — und dass die anderen 14 Konten bei zehn Werkzeugen bleiben
 * (server.ts, ZEHN WERKZEUGE). Die Sperre ist nutzungDuerfen() im Werkzeug.
 */
export async function nutzungAusblenden<T>(_anfrage: unknown, extra: unknown, next: () => Promise<T>): Promise<T> {
  const ergebnis = await next() as any
  if (!Array.isArray(ergebnis?.tools)) return ergebnis
  if (await darfNutzungSehen(extra)) return ergebnis
  return { ...ergebnis, tools: ergebnis.tools.filter((t: { name?: string }) => t.name !== NUTZUNG_WERKZEUG) } as T
}

