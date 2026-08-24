/**
 * Der Bounti-Lader: von der Schnittstelle in die Datenbank.
 *
 * WAS HIER MEHR PASSIERT ALS SPEICHERN, und warum:
 *
 *   1. KEIN PERSONALSTAND. Bounti liefert zu einer Person kein Eintritts-
 *      und kein Austrittsdatum; man koennte den Bestand monatlich
 *      mitschreiben und daraus Zu- und Abgaenge rechnen. Genau das ist am
 *      24.08.2026 wieder ausgebaut worden: es haette die Fluktuationsrate
 *      der Berichtsliste angedeutet und Konten im Schulungssystem gezaehlt
 *      statt Anstellungen. Die Kennzahl gehoert zu LINA — Begruendung in
 *      migrations/0096_bounti.sql, Abschnitt 2.
 *
   2. DIE SKALENPRUEFUNG. `assessmentScore` ist laut Bountis eigener Doku
 *      ein Bruch ("0.8 is 80%"), `achievedPercentage` der Auditberichte
 *      dagegen bereits eine Prozentzahl. Zwei Skalen in einer Schnittstelle
 *      sind die Sorte Falle, die genau einmal auffaellt und dann nie wieder:
 *      eine Erfuellungsquote von 0,8 % statt 80 % sieht schlecht aus, aber
 *      nicht falsch. `alsProzent()` unten rechnet nicht blind mal 100,
 *      sondern prueft und meldet, wenn Bounti die Skala wechselt.
 *
 *   3. DIE FELDNAMEN OHNE WERTE. `customFields` kann eine Personalnummer
 *      tragen — und das waere die Bruecke, an der Kapitel 4.2 der
 *      Round-Table-Map heute scheitert. Gespeichert werden ausschliesslich
 *      die Schluessel und wie oft sie belegt sind, nie der Inhalt.
 *
 * WIRFT. Der Aufrufer in nachlauf.ts faengt alles ab; ein Fehler hier soll
 * im Terminal des Vorschaubefehls sichtbar sein.
 */
import { query, eine } from '../db/pool'
import { log } from '../lib/log'
import { config } from '../config'
import {
  BountiBudget, bountiZaehler,
  standorteHolen, rollenHolen, mitarbeiterHolen,
  kurseHolen, pfadeHolen, kurszuweisungenHolen, pfadzuweisungenHolen,
  fortschrittHolen, auditsHolen, auditberichteHolen,
  type BMitarbeiter, type BZuweisung,
} from './client'

export type Stammdatenergebnis = {
  standorte: number
  rollen: number
  aktiv: number
  archiviert: number
  ohne_standort: number
}

/**
 * Doppelte Schluessel aus einem Seitenlauf entfernen.
 *
 * WARUM DAS SEIN MUSS, und zwar vor jedem Sammel-INSERT: PostgreSQL bricht
 * eine Anweisung mit `ON CONFLICT DO UPDATE` ab, sobald sie DIESELBE Zeile
 * zweimal treffen wuerde — SQLSTATE 21000, "cannot affect row a second time".
 * Nicht die doppelte Zeile faellt dann aus, sondern der GANZE INSERT.
 *
 * Und ein Doppel ist bei dieser Schnittstelle kein Sonderfall: Bountis
 * Cursor zeigt auf die ID des ersten Elements der naechsten Seite. Kommt
 * waehrend des Blaetterns ein Datensatz dazu oder faellt einer weg,
 * verschiebt sich das Fenster und eine Zeile erscheint auf zwei Seiten.
 * Bei 4.796 Mitarbeitenden ueber 48 Seiten ist das kein theoretischer Fall.
 *
 * Der HAUSPRAEZEDENZFALL steht in docs/fehlerkatalog.md und in
 * src/pflege/kalender.ts (`einmalig()`): dieselbe Falle, dieselbe Antwort.
 *
 * Der ERSTE Treffer gewinnt. Bei Bounti sind spaetere Seiten nicht
 * "neuer" — es gibt keine Sortierung nach Aenderungszeit —, also ist die
 * Wahl beliebig, aber sie muss getroffen werden.
 */
export function ohneDoppel<T>(zeilen: T[], schluessel: (z: T) => string): T[] {
  const gesehen = new Set<string>()
  const raus: T[] = []
  let doppel = 0
  for (const z of zeilen) {
    const k = schluessel(z)
    if (gesehen.has(k)) { doppel++; continue }
    gesehen.add(k)
    raus.push(z)
  }
  if (doppel > 0) {
    log.warn('bounti lieferte dieselbe Zeile mehrfach — Doppel entfernt', {
      doppel, behalten: raus.length,
      grund: 'Cursor-Fenster verschiebt sich, wenn waehrend des Blaetterns Daten wechseln',
    })
  }
  return raus
}

/** Einmal je Prozess, damit die Meldung nicht je Kurs erneut kommt. */
let skalaGemeldet = false

/**
 * Aus Bountis Bewertung eine Prozentzahl machen (AGENTS.md Regel 6).
 *
 * Der Regelfall ist ein Bruch: 0.8 wird zu 80,00. Kommt ein Wert ueber 1,
 * hat Bounti die Skala gewechselt — dann waere eine Multiplikation der
 * Fehler, und der Wert wird unveraendert uebernommen und gemeldet. Ueber
 * 100 kann nichts mehr gedeutet werden; solche Werte werden verworfen,
 * nicht gekappt: eine gekappte Zahl sieht gueltig aus.
 */
export function alsProzent(score: number | null | undefined): number | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null
  if (score < 0) return null
  if (score <= 1) return Math.round(score * 10_000) / 100
  if (score <= 100) {
    if (!skalaGemeldet) {
      skalaGemeldet = true
      log.warn('bounti liefert assessmentScore ueber 1 — Skala offenbar gewechselt', {
        beispiel: score,
        folge: 'Wert wird als Prozentzahl uebernommen, NICHT mit 100 multipliziert',
        pruefen: 'docs/bounti-api-inventar.md, Abschnitt Skalen',
      })
    }
    return Math.round(score * 100) / 100
  }
  log.warn('bounti liefert einen unbrauchbaren assessmentScore — verworfen', { wert: score })
  return null
}

// =====================================================================
// 1. Stammdaten: Standorte, Rollen, Mitarbeitende, Momentaufnahme
// =====================================================================

export async function stammdatenLaden(heute: Date = new Date()): Promise<Stammdatenergebnis> {
  const standorte = ohneDoppel(await standorteHolen(), s => s.id)

  /*
   * EINE LEERE STANDORTLISTE IST NIE EIN GUELTIGER ZUSTAND — und sie ist
   * gefaehrlicher als ein Fehler, weil das Aufraeumen weiter unten daraus
   * ein DELETE ohne Gegenstueck macht: keine bekannten Standorte heisst
   * keine Zuordnungen heisst "alles loeschen".
   *
   * Am 24.08.2026 in der Vorab-Pruefung dieses Changesets nachgestellt: mit
   * einer Antwort ohne `rows`-Huelle blieben 6 Standorte in der Tabelle
   * stehen und core.bounti_mitarbeiter_standort war LEER — der Lauf meldete
   * dabei "fertig". Danach ist jede Betriebskachel leer, bis ein gesunder
   * Lauf durchgeht.
   *
   * Deshalb wird hier abgebrochen statt weitergemacht. Der Nachlauf faengt
   * das ab, setzt seinen Merker NICHT, und /status meldet den Stillstand
   * nach 48 Stunden. Ein Abbruch ist sichtbar, ein leergeraeumter Bestand
   * nicht.
   */
  if (standorte.length === 0) {
    throw new Error(
      'Bounti liefert keine Standorte. Das ist kein gueltiger Zustand — der Lauf bricht ab, '
      + 'bevor das Aufraeumen die vorhandenen Zuordnungen loescht. '
      + 'Antwortform pruefen: bun run bounti:pruefen')
  }

  if (standorte.length > 0) {
    await query(
      `INSERT INTO core.bounti_standort (bounti_id, name)
       SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (bounti_id) DO UPDATE SET
         name = excluded.name, zuletzt_gesehen_am = current_date, geladen_am = now()`,
      [standorte.map(s => s.id), standorte.map(s => s.name)])
  }

  const rollen = ohneDoppel(await rollenHolen(), r => r.id)
  if (rollen.length > 0) {
    await query(
      `INSERT INTO core.bounti_rolle (bounti_id, name)
       SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (bounti_id) DO UPDATE SET name = excluded.name, geladen_am = now()`,
      [rollen.map(r => r.id), rollen.map(r => r.name)])
  }

  /*
   * BEIDE LISTEN. Ohne die archivierten waere jedes Ausscheiden ein
   * spurloses Verschwinden, und die Abgangszahl bestuende nur aus der
   * Differenz zweier Kopfzahlen — also aus nichts.
   */
  const aktiv = await mitarbeiterHolen(false)
  const archiviert = await mitarbeiterHolen(true)
  /*
   * Entdoppelt ueber BEIDE Listen zusammen: eine Person kann in `active`
   * und in `archived` stehen, wenn sie zwischen den zwei Aufrufen
   * archiviert wird. Der erste Treffer gewinnt, und das ist hier die
   * aktive Fassung — im Zweifel jemanden als aktiv zu fuehren ist die
   * harmlosere Richtung.
   */
  const alle: { m: BMitarbeiter; archiviert: boolean }[] = ohneDoppel([
    ...aktiv.map(m => ({ m, archiviert: false })),
    ...archiviert.map(m => ({ m, archiviert: true })),
  ], a => a.m.id)

  if (alle.length > 0) {
    await query(
      `INSERT INTO core.bounti_mitarbeiter (bounti_id, vorname, nachname, archiviert)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[])
       ON CONFLICT (bounti_id) DO UPDATE SET
         vorname = excluded.vorname, nachname = excluded.nachname,
         archiviert = excluded.archiviert,
         zuletzt_gesehen_am = current_date, geladen_am = now()`,
      [alle.map(a => a.m.id), alle.map(a => a.m.name ?? null),
       alle.map(a => a.m.surname ?? null), alle.map(a => a.archiviert)])
  }

  /*
   * Standorte und Rollen je Person: erst schreiben, dann aufraeumen.
   *
   * Das Aufraeumen ist der Teil, den man vergisst. Wer den Betrieb
   * wechselt, behaelt sonst beide Zuordnungen — und zaehlt fortan in
   * zwei Betrieben. Geloescht wird ausschliesslich bei Personen, die
   * gerade geladen wurden; wer in Bounti nicht mehr steht, behaelt seine
   * Historie.
   */
  const msM: string[] = [], msS: string[] = []
  const mrM: string[] = [], mrR: string[] = []
  const bekannteStandorte = new Set(standorte.map(s => s.id))
  const bekannteRollen = new Set(rollen.map(r => r.id))
  let fremdeStandorte = 0
  for (const { m } of alle) {
    for (const s of m.locations ?? []) {
      // Ein Standort, den die Standortliste nicht kennt, wuerde am
      // Fremdschluessel scheitern und die ganze Anweisung mitnehmen.
      if (!bekannteStandorte.has(s.id)) { fremdeStandorte++; continue }
      msM.push(m.id); msS.push(s.id)
    }
    for (const r of m.roles ?? []) {
      if (!bekannteRollen.has(r.id)) continue
      mrM.push(m.id); mrR.push(r.id)
    }
  }
  if (fremdeStandorte > 0) {
    log.warn('bounti nennt Standorte, die die Standortliste nicht fuehrt', {
      faelle: fremdeStandorte,
      folge: 'diese Zuordnungen fehlen — die Personen zaehlen in keinem Betrieb',
    })
  }

  const alleIds = alle.map(a => a.m.id)
  if (msM.length > 0) {
    await query(
      `INSERT INTO core.bounti_mitarbeiter_standort (mitarbeiter_id, standort_id)
       SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (mitarbeiter_id, standort_id) DO UPDATE SET geladen_am = now()`,
      [msM, msS])
  }
  /*
   * DASSELBE `if` WIE BEIM INSERT DARUEBER, und das ist der Kern.
   *
   * Hier stand `if (alleIds.length > 0)` — und damit hing das Loeschen an
   * einer ANDEREN Bedingung als das Schreiben. Ist `msM` leer, liefert
   * `unnest('{}','{}')` null Zeilen, `NOT EXISTS` ist fuer JEDE Zeile wahr,
   * und die Anweisung raeumt saemtliche Zuordnungen aller geladenen
   * Personen ab. Nachgemessen: 5 von 5 Zeilen getroffen.
   *
   * Zwei unabhaengige Quellen fuer zwei Bedingungen — `alleIds` aus der
   * Mitarbeiterliste, `msM` aus der Kreuzung mit den bekannten Standorten —
   * heisst: "viele Personen, null Zuordnungen" ist erreichbar. Genau dann
   * greift der Fehler.
   */
  if (msM.length > 0) {
    await query(
      `DELETE FROM core.bounti_mitarbeiter_standort ms
        WHERE ms.mitarbeiter_id = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM unnest($2::text[], $3::text[]) AS n(m, s)
             WHERE n.m = ms.mitarbeiter_id AND n.s = ms.standort_id)`,
      [alleIds, msM, msS])
  }
  if (mrM.length > 0) {
    await query(
      `INSERT INTO core.bounti_mitarbeiter_rolle (mitarbeiter_id, rolle_id)
       SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (mitarbeiter_id, rolle_id) DO UPDATE SET geladen_am = now()`,
      [mrM, mrR])
  }
  // Gleiche Begruendung wie beim Standort-DELETE darueber.
  if (mrM.length > 0) {
    await query(
      `DELETE FROM core.bounti_mitarbeiter_rolle mr
        WHERE mr.mitarbeiter_id = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM unnest($2::text[], $3::text[]) AS n(m, r)
             WHERE n.m = mr.mitarbeiter_id AND n.r = mr.rolle_id)`,
      [alleIds, mrM, mrR])
  }

  /*
   * HIER STAND DIE MOMENTAUFNAHME DES PERSONALSTANDS, und hier steht sie
   * nicht mehr (24.08.2026). Sie haette je Person und Monat fortgeschrieben,
   * was Bounti gerade zeigt — und daraus liesse sich eine Quote rechnen, die
   * wie die Fluktuationsrate aussieht und Konten zaehlt. Die Kennzahl kommt
   * aus LINA; die Begruendung steht in migrations/0096_bounti.sql, Abschnitt 2.
   *
   * `ohne_standort` bleibt trotzdem gezaehlt: wer in Bounti keinen Standort
   * hat, faellt aus JEDER Betriebszahl heraus — auch aus der Schulungsquote.
   * Das gehoert in die Protokollzeile, nicht in eine stille Null.
   */
  const ohneStandort = alle.filter(
    a => (a.m.locations ?? []).filter(s => bekannteStandorte.has(s.id)).length === 0).length

  // --- Die Feldnamen, ohne Werte ---------------------------------------
  const belegt = new Map<string, number>()
  for (const { m } of alle) {
    for (const [k, v] of Object.entries(m.customFields ?? {})) {
      const da = v !== null && v !== undefined && String(v).trim() !== ''
      belegt.set(k, (belegt.get(k) ?? 0) + (da ? 1 : 0))
    }
  }
  if (belegt.size > 0) {
    await query(
      `INSERT INTO core.bounti_feldname (schluessel, belegt, mitarbeiter_gesamt)
       SELECT * FROM unnest($1::text[], $2::int[], $3::int[])
       ON CONFLICT (schluessel) DO UPDATE SET
         belegt = excluded.belegt, mitarbeiter_gesamt = excluded.mitarbeiter_gesamt,
         zuletzt_gesehen_am = current_date`,
      [[...belegt.keys()], [...belegt.values()], [...belegt.keys()].map(() => alle.length)])
  }

  return {
    standorte: standorte.length,
    rollen: rollen.length,
    aktiv: aktiv.length,
    archiviert: archiviert.length,
    ohne_standort: ohneStandort,
  }
}

// =====================================================================
// 2. Lernkatalog und Zuweisungen
// =====================================================================

export async function lerneinheitenLaden(): Promise<{ kurse: number; pfade: number }> {
  const kurse = await kurseHolen()
  const pfade = await pfadeHolen()
  const ids = [...kurse.map(k => k.id), ...pfade.map(p => p.id)]
  const arten = [...kurse.map(() => 'kurs'), ...pfade.map(() => 'pfad')]
  const namen = [...kurse.map(k => k.name), ...pfade.map(p => p.name)]
  if (ids.length > 0) {
    await query(
      `INSERT INTO core.bounti_lerneinheit (bounti_id, art, name)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
       ON CONFLICT (bounti_id, art) DO UPDATE SET
         name = excluded.name, zuletzt_gesehen_am = current_date, geladen_am = now()`,
      [ids, arten, namen])
  }
  return { kurse: kurse.length, pfade: pfade.length }
}

export type Zuweisungsergebnis = {
  lerneinheiten: number
  zeilen: number
  offen: number
  budget_erschoepft: boolean
  fehler: string[]
}

/**
 * Die Zuweisungen, in Rotation.
 *
 * NIE GEHOLTE ZUERST, dann die aeltesten — dieselbe Reihenfolge wie beim
 * Wetter-Backfill und aus demselben Grund: bricht der Lauf ab, fehlt das
 * Aelteste und nicht das Neueste. Der Rueckstand baut sich von selbst ab
 * und steht sichtbar in mart.bounti_zuweisung_stand.
 *
 * WARUM ROTATION UND NICHT INKREMENTELL: der Endpunkt kennt keinen
 * Zeitfilter. `/audits/reports` ist der einzige der Schnittstelle mit
 * `after` — hier gibt es nur "alle, seitenweise".
 */
export async function zuweisungenLaden(
  grenze = config.BOUNTI_LERNEINHEITEN_JE_LAUF,
): Promise<Zuweisungsergebnis> {
  const raus: Zuweisungsergebnis = {
    lerneinheiten: 0, zeilen: 0, offen: 0, budget_erschoepft: false, fehler: [],
  }
  if (grenze <= 0) return raus

  const dran = await query<{ bounti_id: string; art: string; name: string }>(
    `SELECT bounti_id, art, name FROM core.bounti_lerneinheit
      ORDER BY zuweisungen_geholt_am ASC NULLS FIRST, name
      LIMIT $1`, [grenze])

  for (const l of dran) {
    let zeilen: BZuweisung[]
    try {
      zeilen = l.art === 'kurs'
        ? await kurszuweisungenHolen(l.bounti_id)
        : await pfadzuweisungenHolen(l.bounti_id)
    } catch (e) {
      if (e instanceof BountiBudget) {
        // Kein Fehler, sondern das Ende der Arbeit fuer heute.
        raus.budget_erschoepft = true
        break
      }
      raus.fehler.push(`${l.art} ${l.name}: ${String((e as Error).message ?? e).slice(0, 140)}`)
      continue
    }
    zeilen = ohneDoppel(zeilen, z => z.id)

    /*
     * Der Schreibvorgang gehoert IN den try — er stand darunter.
     *
     * Ein Datenbankfehler an einer einzelnen Lerneinheit (ein doppelter
     * Schluessel, ein Constraint, ein Verbindungsabriss) haette sonst die
     * ganze Schleife beendet und die uebrigen 119 Lerneinheiten dieser
     * Nacht mitgenommen — obwohl der Rest fehlerfrei ist. Der Abbruch
     * gehoert auf die Lerneinheit, nicht auf den Lauf.
     */
    try {
    if (zeilen.length > 0) {
      await query(
        `INSERT INTO core.bounti_zuweisung
           (bounti_id, lerneinheit_id, art, mitarbeiter_id,
            erstellt_am, faellig_am, abgeschlossen_am, ergebnis_pct)
         SELECT n.id, $2, $3, n.mitarbeiter, n.erstellt, n.faellig, n.fertig, n.ergebnis
           FROM unnest($1::text[], $4::text[], $5::timestamptz[], $6::timestamptz[],
                       $7::timestamptz[], $8::numeric[])
             AS n(id, mitarbeiter, erstellt, faellig, fertig, ergebnis)
         ON CONFLICT (bounti_id) DO UPDATE SET
           faellig_am = excluded.faellig_am,
           abgeschlossen_am = excluded.abgeschlossen_am,
           ergebnis_pct = excluded.ergebnis_pct,
           geladen_am = now()`,
        [zeilen.map(z => z.id), l.bounti_id, l.art,
         zeilen.map(z => z.employeeId),
         zeilen.map(z => z.createdAt ?? null),
         zeilen.map(z => z.dueAt ?? null),
         zeilen.map(z => z.completedAt ?? null),
         zeilen.map(z => alsProzent(z.assessmentScore))])
    }

    /*
     * Der Zeitstempel wird AUCH bei null Zeilen gesetzt. Ein Kurs ohne
     * Zuweisungen ist ein gueltiger Zustand, und wer ihn als "nie geholt"
     * stehen liesse, holte ihn jede Nacht erneut — und verdraengte damit
     * dauerhaft die Lerneinheiten dahinter aus der Rotation.
     */
    await query(
      `UPDATE core.bounti_lerneinheit SET zuweisungen_geholt_am = now()
        WHERE bounti_id = $1 AND art = $2`, [l.bounti_id, l.art])

    raus.lerneinheiten++
    raus.zeilen += zeilen.length
    } catch (e) {
      raus.fehler.push(
        `${l.art} ${l.name} (schreiben): ${String((e as Error).message ?? e).slice(0, 140)}`)
    }
  }

  const [offen] = await query<{ offen: number }>(
    `SELECT count(*)::int AS offen FROM mart.bounti_zuweisung_stand WHERE zustand = 'nie'`)
  raus.offen = offen?.offen ?? 0
  return raus
}

// =====================================================================
// 3. Fortschritt, Audits, Auditberichte
// =====================================================================

export async function fortschrittLaden(heute: Date = new Date()): Promise<number> {
  const zeilen = ohneDoppel(await fortschrittHolen(), z => z.id)
  if (zeilen.length === 0) return 0
  const stichtag = heute.toISOString().slice(0, 10)

  /*
   * Nur Standorte, die die Standortliste kennt — sonst scheitert der
   * Fremdschluessel und nimmt die ganze Anweisung mit. Ein unbekannter
   * Standort im Fortschritt hiesse, dass beide Listen auseinanderlaufen;
   * das gehoert gemeldet und nicht verschluckt.
   */
  const bekannt = await query<{ bounti_id: string }>(
    `SELECT bounti_id FROM core.bounti_standort`)
  const menge = new Set(bekannt.map(b => b.bounti_id))
  const gute = zeilen.filter(z => menge.has(z.id))
  if (gute.length < zeilen.length) {
    log.warn('bounti-Fortschritt nennt unbekannte Standorte', {
      unbekannt: zeilen.length - gute.length,
      folge: 'diese Zeilen fehlen — Standortliste und Fortschritt laufen auseinander',
    })
  }
  if (gute.length === 0) return 0

  await query(
    `INSERT INTO core.bounti_standort_fortschritt
       (standort_id, stichtag, kurse_gesamt, kurse_abgeschlossen)
     SELECT n.id, $2::date, n.gesamt, n.fertig
       FROM unnest($1::text[], $3::int[], $4::int[]) AS n(id, gesamt, fertig)
     ON CONFLICT (standort_id, stichtag) DO UPDATE SET
       kurse_gesamt = excluded.kurse_gesamt,
       kurse_abgeschlossen = excluded.kurse_abgeschlossen,
       geladen_am = now()`,
    [gute.map(z => z.id), stichtag,
     gute.map(z => z.courses?.total ?? 0), gute.map(z => z.courses?.completed ?? 0)])
  return gute.length
}

export async function auditsLaden(): Promise<number> {
  const audits = ohneDoppel(await auditsHolen(), a => a.id)
  if (audits.length === 0) return 0
  await query(
    `INSERT INTO core.bounti_audit
       (bounti_id, name, beschreibung, art, erstellt_am, geaendert_am)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[],
                          $5::timestamptz[], $6::timestamptz[])
     ON CONFLICT (bounti_id) DO UPDATE SET
       name = excluded.name, beschreibung = excluded.beschreibung,
       art = excluded.art, geaendert_am = excluded.geaendert_am, geladen_am = now()`,
    [audits.map(a => a.id), audits.map(a => a.name),
     audits.map(a => a.description ?? null), audits.map(a => a.type),
     audits.map(a => a.createdAt ?? null), audits.map(a => a.updatedAt ?? null)])
  return audits.length
}

/**
 * Auditberichte — inkrementell, mit Ueberlappung.
 *
 * SIEBEN TAGE ZURUECK statt genau ab dem letzten Stand: ein Bericht wird
 * angelegt, wenn das Audit beginnt, und Tage spaeter abgeschlossen. Wer
 * scharf ab `max(erstellt_am)` holt, sieht den Abschluss nie — der Bericht
 * bliebe fuer immer als "begonnen" stehen und faehrt eine dauerhaft zu
 * niedrige Erfuellungszahl mit sich.
 *
 * Beim ersten Lauf ohne Bestand wird ALLES geholt.
 */
export async function auditberichteLaden(): Promise<{ zeilen: number; ab: string | null }> {
  /*
   * VOLLES ISO-8601 MIT ZEIT UND ZONE, nicht nur der Kalendertag.
   *
   * Am 24.08.2026 im zweiten Lauf gelernt: `after=2026-08-16` quittiert
   * Bounti mit HTTP 400 und einem Zod-Fehler ("invalid_format", format
   * "datetime"). Der ERSTE Lauf konnte das nicht zeigen — ohne Bestand gibt
   * es kein `after`, der Parameter entfaellt, und der Aufruf gelingt.
   *
   * Das ist die unangenehmste Sorte Fehler dieser Anbindung: er tritt erst
   * auf, wenn schon Daten da sind, also nie beim Ausprobieren und immer im
   * Betrieb. Und er waere teuer geworden — der Nachlauf setzt seinen Merker
   * erst am Ende, ein Abbruch hier haette ihn also nie gesetzt, und jeder
   * folgende Sync-Lauf haette Bounti erneut abgefragt statt einmal am Tag.
   *
   * (Hier stand "der stuendliche Sync-Lauf … JEDE Stunde". Der Zeitplan
   * ist taeglich, nachgemessen am 24.08.2026 — siehe bounti/nachlauf.ts.
   * Der Schaden waere also kleiner gewesen als hier behauptet: ein
   * zusaetzlicher Lauf je Tag, nicht 24. Die Trennung der Audits in ein
   * eigenes `try` bleibt trotzdem richtig, denn der eigentliche Grund ist
   * ein anderer — die Audits sind der kleinste Teil dieser Quelle und
   * duerfen die Schulungsdaten nicht mitnehmen.)
   */
  const stand = await eine<{ ab: Date | null }>(
    `SELECT max(erstellt_am) - interval '7 days' AS ab FROM core.bounti_auditbericht`)
  const ab = stand?.ab ? new Date(stand.ab).toISOString() : undefined

  const berichte = ohneDoppel(await auditberichteHolen(ab), b => b.id)
  if (berichte.length === 0) return { zeilen: 0, ab: ab ?? null }

  // Berichte zu Audits, die wir nicht kennen, wuerden am Fremdschluessel
  // scheitern — sie kommen beim naechsten Lauf mit, wenn auditsLaden()
  // das Audit gesehen hat.
  const bekannt = new Set((await query<{ bounti_id: string }>(
    `SELECT bounti_id FROM core.bounti_audit`)).map(a => a.bounti_id))
  const gute = berichte.filter(b => bekannt.has(b.auditId))
  if (gute.length < berichte.length) {
    log.warn('bounti-Auditberichte zu unbekannten Audits', {
      uebersprungen: berichte.length - gute.length,
    })
  }
  if (gute.length === 0) return { zeilen: 0, ab: ab ?? null }

  await query(
    `INSERT INTO core.bounti_auditbericht
       (bounti_id, audit_id, plan_id, erstellt_am, begonnen_am, abgeschlossen_am,
        punkte_gesamt, punkte_erreicht, prozent, auditor_id, ziel_art, ziel_id)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[],
                          $5::timestamptz[], $6::timestamptz[], $7::numeric[],
                          $8::numeric[], $9::numeric[], $10::text[], $11::text[], $12::text[])
     ON CONFLICT (bounti_id) DO UPDATE SET
       begonnen_am = excluded.begonnen_am,
       abgeschlossen_am = excluded.abgeschlossen_am,
       punkte_gesamt = excluded.punkte_gesamt,
       punkte_erreicht = excluded.punkte_erreicht,
       prozent = excluded.prozent,
       geladen_am = now()`,
    [gute.map(b => b.id), gute.map(b => b.auditId), gute.map(b => b.scheduleId ?? null),
     gute.map(b => b.createdAt), gute.map(b => b.startedAt ?? null),
     gute.map(b => b.completedAt ?? null),
     gute.map(b => b.totalPoints ?? null), gute.map(b => b.achievedPoints ?? null),
     // NICHT mal 100: achievedPercentage ist bereits eine Prozentzahl.
     gute.map(b => b.achievedPercentage ?? null),
     gute.map(b => b.auditor?.id ?? null),
     gute.map(b => b.assignedEntity?.type ?? null),
     gute.map(b => b.assignedEntity?.id ?? null)])

  return { zeilen: gute.length, ab: ab ?? null }
}

/** Was der Lauf verbraucht hat — fuer die Protokollzeile. */
export const verbrauch = bountiZaehler
