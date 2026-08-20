/**
 * EIN Importweg für alle handgepflegten Tabellen (Plan Phase 6).
 *
 * WAS ER ERSETZT. Sechs Tabellen, sechs Wege — und fünf davon führten durch
 * eine Migration. `manual.om_einschaetzung` trägt 23 Noten, die in Migration
 * `0044` fest im Quelltext stehen, auf einen verdrahteten Monat. Folge: ab Juli
 * 2026 ist `ampel_om` für alle 141 Betriebe leer, und das Round-Table-Urteil
 * wird **grün, wenn ein Signal wegfällt**.
 *
 * DER KANAL IST DAS REPOSITORY, und das ist keine Notlösung. Eine Datei in
 * `pflege/` wird committet, gepusht, mit dem Container ausgerollt und vom
 * nächsten nächtlichen Lauf eingelesen. Damit hat die Handpflege ohne einen
 * einzigen neuen Server-Handgriff genau das, was ihr fehlte:
 *
 *   * eine Historie (wer hat wann welche Note geändert — `git log`),
 *   * eine Überprüfung vor dem Wirksamwerden (der Commit ist lesbar),
 *   * und einen Weg zurück (`git revert`).
 *
 * Eine hochgeladene Datei auf dem Server hätte nichts davon, und ein
 * Web-Formular wäre ein zweites System.
 *
 * NUR UPSERT, NIE LÖSCHEN. Eine Zeile, die aus der Datei verschwindet, bleibt
 * in der Tabelle. Das ist Absicht: eine versehentlich halb gespeicherte
 * Excel-Datei würde sonst Monate an Noten entfernen, und der Verlust sähe aus
 * wie ein Betrieb ohne Bewertung. Wer wirklich löschen will, tut das in
 * Postico — bewusst und mit einer WHERE-Klausel.
 *
 * UND KEINE ZEILE VERSCHWINDET STILL. Ein unbekannter Spaltenname, ein
 * unauflösbarer Betriebsname, eine kaputte Zahl: die ganze Datei wird
 * abgewiesen und der Grund steht in `sync.pflege_import`. Eine Datei, die zu
 * 90 % durchläuft, ist die schlechteste aller Möglichkeiten — sie sieht aus
 * wie ein Erfolg.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { query } from '../db/pool'
import { log } from '../lib/log'

/**
 * Das Register: welche Datei füllt welche Tabelle.
 *
 * `spalten` ist eine **Erlaubnisliste** und keine Dokumentation. Alles, was
 * hier nicht steht, führt zur Abweisung der Datei — die Alternative wäre, einen
 * Spaltennamen aus einer CSV in SQL einzusetzen, und das ist keine.
 */
export type Ziel = {
  datei: string
  tabelle: string
  /** Spalten des Primärschlüssels — das `ON CONFLICT`. */
  schluessel: string[]
  /** Erlaubte Spalten, Schlüssel eingeschlossen. */
  spalten: string[]
  /** Muss in der Kopfzeile stehen, sonst ist es die falsche Datei. */
  pflicht: string[]
  zweck: string
}

export const ZIELE: readonly Ziel[] = [
  /**
   * Konzepte, die aus der Kalender- und Wetterauswertung herausfallen
   * (Migration `0093`).
   *
   * Angefragt am 21.08.2026: „Enchi-Gruppe geschlossene ausschliessen" — ein
   * Sammelposten aus 34 geschlossenen und insolventen Betrieben, keiner davon
   * mit laufendem Umsatz. Drei weitere Konzepte tragen dieselbe Signatur und
   * sind eine Zeile hier entfernt; welche, sagt
   * `mart.kalender_ausschluss_kandidaten`.
   *
   * ACHTUNG: der Ausschluss wirkt NUR in der Auswertungsschicht.
   * `mart.vergleichstag_basis` bleibt vollständig — wer einen geschlossenen
   * Betrieb nachsehen will, kann das weiterhin.
   */
  {
    datei: 'kalender_ausschluss.csv',
    tabelle: 'manual.kalender_ausschluss',
    schluessel: ['hauptkonzept'],
    spalten: ['hauptkonzept', 'grund'],
    pflicht: ['hauptkonzept', 'grund'],
    zweck: 'Konzepte ohne laufenden Betrieb aus ⑫ heraushalten',
  },
  /**
   * Die Klassengrenzen des Wettereffekts (Migration `0087`).
   *
   * WARUM DAS HIER STEHT UND NICHT IM QUELLTEXT: die Grenzen sind eine
   * fachliche Festlegung, keine Konstante. Der erste Satz ist gemessen
   * (20.08.2026, 4.735 Tage an 48 Orten), aber „ab wann ist es zu heiß" ist
   * eine Frage an den Betrieb und nicht an die Verteilung. Eine Verschiebung
   * ist damit eine Zeile hier — nicht eine Migration.
   *
   * ACHTUNG: `von` ist einschließlich, `bis` ist ausschließlich, leer heißt
   * offen. Wer eine Grenze verschiebt, muss die Nachbarklasse mitziehen —
   * sonst entsteht eine Lücke, und Tage verschwinden lautlos aus den
   * Kacheln. `mart.wetter_klasse_pruefung` rechnet genau das nach und steht
   * als Prüfzeile in `mart.pruefung_uebersicht`.
   */
  {
    datei: 'wetter_klasse.csv',
    tabelle: 'manual.wetter_klasse',
    schluessel: ['kategorie', 'klasse'],
    spalten: ['kategorie', 'klasse', 'reihenfolge', 'von', 'bis'],
    pflicht: ['kategorie', 'klasse', 'reihenfolge'],
    zweck: 'Klassengrenzen fuer den Wettereffekt (Temperatur, Niederschlag, Sonne)',
  },
  {
    datei: 'om_einschaetzung.csv',
    tabelle: 'manual.om_einschaetzung',
    schluessel: ['betrieb_key', 'monat'],
    spalten: ['betrieb_key', 'monat', 'om_score', 'erfasst_von', 'notiz'],
    pflicht: ['monat', 'om_score'],
    zweck: 'Vor-Ort-Einschaetzung des Operations Managers, eine Note je Betrieb und Monat',
  },
  {
    datei: 'gfgh_betrieb.csv',
    tabelle: 'manual.gfgh_betrieb',
    schluessel: ['betrieb_key'],
    spalten: ['betrieb_key', 'dach_name', 'roh_eintrag', 'gebunden', 'verraeumt',
              'gilt_ab', 'quelle', 'notiz'],
    pflicht: ['dach_name'],
    zweck: 'Getraenkefachgrosshaendler je Betrieb — entscheidet ueber "freigegeben"',
  },
  {
    datei: 'lieferant_freigabe.csv',
    tabelle: 'manual.lieferant_freigabe',
    schluessel: ['dach_name'],
    spalten: ['dach_name', 'warengruppe', 'freigegeben', 'gilt_ab', 'quelle', 'notiz'],
    pflicht: ['dach_name', 'freigegeben'],
    zweck: 'Konzernfreigabe je Lieferant',
  },
  {
    datei: 'bwa_zeile.csv',
    tabelle: 'manual.bwa_zeile',
    schluessel: ['zeile'],
    spalten: ['zeile', 'reihenfolge', 'block', 'summenzeile', 'vorzeichen_kosten',
              'kennzahl_bezug', 'notiz'],
    pflicht: ['zeile'],
    zweck: 'Gliederung der BWA — laesst mart.bwa_quellen_vergleich sonst auf null Zeilen laufen',
  },
  {
    datei: 'sachkonto.csv',
    tabelle: 'manual.sachkonto',
    schluessel: ['kontonummer'],
    spalten: ['kontonummer', 'bezeichnung', 'block', 'ist_wareneinsatz', 'notiz'],
    pflicht: ['kontonummer'],
    zweck: 'Sachkontenrahmen — welche Konten Wareneinsatz sind',
  },
  {
    datei: 'marktindex.csv',
    tabelle: 'manual.marktindex',
    schluessel: ['monat'],
    spalten: ['monat', 'index_nominal', 'index_real', 'basis', 'quelle', 'stand'],
    pflicht: ['monat'],
    zweck: 'Gastronomie-Marktindex (Destatis) als Vergleichsgroesse',
  },
] as const

/** Wo die Dateien liegen. Repo-Wurzel, damit sie im Container mit ausgerollt werden. */
export const PFLEGE_ORDNER = join(import.meta.dir, '..', '..', 'pflege')

/**
 * CSV lesen. Trennzeichen wird an der Kopfzeile erkannt — deutsche
 * Excel-Exporte nehmen das Semikolon, alles andere das Komma.
 *
 * ANFÜHRUNGSZEICHEN WERDEN RICHTIG BEHANDELT, und zwar aus einem gemessenen
 * Grund: die erste exportierte Notiz lautete
 * `"…, Blatt Eingabe; Zuordnung ueber Stadt ""Köln"""` — ein Semikolon UND
 * doppelte Anführungszeichen im Feld. Ein Zerlegen per `split(';')` hätte
 * daraus zwei Spalten gemacht, die Datei wäre abgewiesen worden, und der
 * Grund („unbekannte Spalte") hätte in die Irre geführt.
 *
 * Was bewusst NICHT unterstützt wird: Zeilenumbrüche innerhalb eines Feldes.
 * Sie machen jede Fehlermeldung unlesbar („Zeile 47" stimmt dann nicht mehr),
 * und in einer von Hand gepflegten Notenliste haben sie nichts verloren.
 */
export function csvLesen(text: string): { kopf: string[]; zeilen: string[][] } {
  const roh = text.replace(/^﻿/, '').split(/\r?\n/).filter(z => z.trim() !== '')
  if (roh.length === 0) return { kopf: [], zeilen: [] }
  const trenner = (roh[0]!.split(';').length > roh[0]!.split(',').length) ? ';' : ','

  const zerlegen = (z: string): string[] => {
    const felder: string[] = []
    let feld = ''
    let inAnfuehrung = false
    for (let i = 0; i < z.length; i++) {
      const c = z[i]!
      if (inAnfuehrung) {
        // "" innerhalb eines Feldes ist ein einzelnes Anfuehrungszeichen.
        if (c === '"' && z[i + 1] === '"') { feld += '"'; i++ }
        else if (c === '"') inAnfuehrung = false
        else feld += c
      } else if (c === '"' && feld.trim() === '') { inAnfuehrung = true; feld = '' }
      else if (c === trenner) { felder.push(feld.trim()); feld = '' }
      else feld += c
    }
    felder.push(feld.trim())
    return felder
  }

  return { kopf: zerlegen(roh[0]!).map(s => s.toLowerCase()), zeilen: roh.slice(1).map(zerlegen) }
}

export type Importbericht = {
  datei: string
  zeilen: number
  geschrieben: number
  fehler: string | null
}

/**
 * Eine Datei einlesen. Wirft nie — der Fehler steht im Bericht und in
 * `sync.pflege_import`, damit ihn jemand SIEHT statt ihn im Log zu suchen.
 */
export async function dateiEinlesen(ziel: Ziel, text: string): Promise<Importbericht> {
  const bericht: Importbericht = { datei: ziel.datei, zeilen: 0, geschrieben: 0, fehler: null }
  try {
    const { kopf, zeilen } = csvLesen(text)
    bericht.zeilen = zeilen.length
    if (kopf.length === 0) throw new Error('leere Datei')

    /*
     * DER BETRIEB DARF ALS NAME STEHEN. Niemand pflegt eine Note gegen
     * `betrieb_key = 87`. Aufgeloest wird ueber den exakten Namen aus
     * core.betrieb — und wenn einer nicht passt, faellt die GANZE Datei
     * durch, statt die Zeile stillschweigend zu verlieren.
     */
    const nameSpalte = kopf.indexOf('betrieb')
    const braucht = ziel.schluessel.includes('betrieb_key')
    if (braucht && nameSpalte < 0 && !kopf.includes('betrieb_key')) {
      throw new Error('weder Spalte "betrieb" noch "betrieb_key" in der Kopfzeile')
    }

    const unbekannt = kopf.filter(s => s !== 'betrieb' && !ziel.spalten.includes(s))
    if (unbekannt.length) throw new Error(`unbekannte Spalte(n): ${unbekannt.join(', ')}`)
    const fehlt = ziel.pflicht.filter(s => !kopf.includes(s))
    if (fehlt.length) throw new Error(`Pflichtspalte(n) fehlen: ${fehlt.join(', ')}`)

    let namen = new Map<string, number>()
    if (nameSpalte >= 0) {
      const b = await query<{ betrieb_key: number; name: string }>(
        `SELECT betrieb_key, name FROM core.betrieb`)
      namen = new Map(b.map(x => [x.name.trim().toLowerCase(), x.betrieb_key]))
      const offen = [...new Set(zeilen.map(z => (z[nameSpalte] ?? '').trim().toLowerCase()))]
        .filter(n => n !== '' && !namen.has(n))
      if (offen.length) {
        throw new Error(`Betriebsname(n) nicht gefunden: ${offen.slice(0, 5).join(', ')}`
                      + (offen.length > 5 ? ` (und ${offen.length - 5} weitere)` : ''))
      }
    }

    // Zielspalten in fester Reihenfolge — aus dem Register, nie aus der Datei.
    const zielSpalten = ziel.spalten.filter(s =>
      kopf.includes(s) || (s === 'betrieb_key' && nameSpalte >= 0))
    if (zielSpalten.length === 0) throw new Error('keine bekannte Spalte in der Kopfzeile')

    const werte: (string | null)[][] = zielSpalten.map(() => [])
    for (const z of zeilen) {
      zielSpalten.forEach((s, i) => {
        if (s === 'betrieb_key' && !kopf.includes('betrieb_key')) {
          werte[i]!.push(String(namen.get((z[nameSpalte] ?? '').trim().toLowerCase()) ?? ''))
        } else {
          const v = z[kopf.indexOf(s)] ?? ''
          werte[i]!.push(v === '' ? null : v)
        }
      })
    }

    /*
     * DIE TYPEN KOMMEN AUS DEM KATALOG, nicht aus dem Register.
     *
     * Alles aus einer CSV ist Text; `manual.om_einschaetzung.om_score` ist
     * `smallint`, `monat` ist `date`, `gebunden` ist `boolean`. Ohne Cast
     * scheitert der INSERT mit „is of type integer but expression is of type
     * text" — was zwar sauber abweist, aber niemandem sagt, was zu tun ist.
     *
     * Die Typen hier nachzuschlagen statt sie im Register zu wiederholen,
     * hält die eine Wahrheit in der Datenbank: eine Spalte, die ihren Typ
     * ändert, ändert ihn damit auch hier. Ein zweiter Ort für dieselbe Sache
     * ist immer der veraltete.
     *
     * Die Spaltennamen stammen weiterhin AUSSCHLIESSLICH aus dem Register
     * oben — sonst wäre die Kopfzeile einer CSV eine Eingabe in SQL. Die
     * Werte gehen als Parameter; eine kaputte Zahl lässt den Cast werfen und
     * weist damit die ganze Datei ab.
     */
    const [schema, name] = ziel.tabelle.split('.')
    const typen = new Map((await query<{ column_name: string; udt_name: string }>(
      `SELECT column_name, udt_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2`, [schema, name]))
      .map(z => [z.column_name, z.udt_name]))

    const unbekannterTyp = zielSpalten.filter(s => !typen.has(s))
    if (unbekannterTyp.length) {
      throw new Error(`Spalte(n) gibt es in ${ziel.tabelle} nicht: ${unbekannterTyp.join(', ')}`)
    }

    const platz = zielSpalten.map((_, i) => `$${i + 1}::text[]`).join(', ')
    const felder = zielSpalten.join(', ')
    const gecastet = zielSpalten.map(s => `x.${s}::${typen.get(s)}`).join(', ')
    const setzen = zielSpalten.filter(s => !ziel.schluessel.includes(s))
      .map(s => `${s} = excluded.${s}`).join(', ')

    const r = await query(
      `INSERT INTO ${ziel.tabelle} (${felder})
       SELECT ${gecastet} FROM unnest(${platz}) AS x(${felder})
       ON CONFLICT (${ziel.schluessel.join(', ')})
       ${setzen ? `DO UPDATE SET ${setzen}` : 'DO NOTHING'}
       RETURNING 1`, werte)
    bericht.geschrieben = r.length
  } catch (e) {
    bericht.fehler = String((e as Error).message ?? e).slice(0, 400)
  }
  return bericht
}

/**
 * Alle Dateien in `pflege/` einlesen und den Stand festhalten.
 *
 * Der Ordner darf fehlen — dann gibt es nichts zu pflegen, und das ist kein
 * Fehler. Er steht trotzdem in `sync.pflege_import`, damit „noch nie eine
 * Datei da gewesen" von „seit Monaten nicht mehr aktualisiert" unterscheidbar
 * bleibt.
 */
export async function pflegeEinlesen(): Promise<Importbericht[]> {
  const berichte: Importbericht[] = []
  if (!existsSync(PFLEGE_ORDNER)) {
    log.debug('kein pflege-Ordner — nichts einzulesen', { ordner: PFLEGE_ORDNER })
    return berichte
  }
  const vorhanden = new Set(readdirSync(PFLEGE_ORDNER))

  for (const ziel of ZIELE) {
    if (!vorhanden.has(ziel.datei)) continue
    const text = readFileSync(join(PFLEGE_ORDNER, ziel.datei), 'utf8')
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 16)
    const b = await dateiEinlesen(ziel, text)
    berichte.push(b)

    await query(
      `INSERT INTO sync.pflege_import (datei, tabelle, zeilen, geschrieben, inhalt_hash, fehler)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (datei) DO UPDATE SET
         tabelle = excluded.tabelle, zeilen = excluded.zeilen,
         geschrieben = excluded.geschrieben, inhalt_hash = excluded.inhalt_hash,
         fehler = excluded.fehler, importiert_am = now()`,
      [b.datei, ziel.tabelle, b.zeilen, b.geschrieben, hash, b.fehler])

    if (b.fehler) {
      log.error('pflege-datei abgewiesen — GAR NICHTS uebernommen', {
        datei: b.datei, fehler: b.fehler, sicht: 'mart.pflege_stand',
      })
    } else if (b.geschrieben > 0) {
      log.info('pflege-datei eingelesen', {
        datei: b.datei, tabelle: ziel.tabelle, zeilen: b.zeilen, geschrieben: b.geschrieben,
      })
    }
  }
  return berichte
}
