/**
 * zod-Schemata je Endpunkt.
 *
 * LINAs API ist undokumentiert und unversioniert. Jede Antwort wird deshalb
 * geprüft — nicht um sie abzulehnen, sondern damit eine Strukturänderung als
 * Eintrag in sync.schema_abweichung auffällt, statt still falsch interpretiert
 * zu werden.
 *
 * Bewusst tolerant: unbekannte Felder sind erlaubt (LINA darf etwas ergänzen),
 * fehlende Pflichtfelder sind es nicht. Zahlenfelder sind nullable, weil LINA
 * bei fehlenden Vergleichszeiträumen null liefert.
 */
import { z } from 'zod'

const zahl = z.number().nullable().optional()

export const UmsatzberichtSchema = z.object({
  timeframe: z.string(),
  vergleichTimeframe: z.string().nullable().optional(),
  hasVergleich: z.boolean().optional(),
  brutto: z.boolean().optional(),
  stores: z.array(z.object({
    name: z.string(),
    encId: z.string(),
    umsatzNetto: zahl,
    umsatzBrutto: zahl,
    bills: zahl,
    guests: zahl,
    avgTicket: zahl,
    avgGuest: zahl,
    umsatzNettoV: zahl,
    umsatzBruttoV: zahl,
    diff: zahl,
  })),
  totals: z.object({}).passthrough().optional(),
})

export const PersonalkostenSchema = z.object({
  timeframe: z.string(),
  stores: z.array(z.object({
    name: z.string(),
    encId: z.string(),
    effService: zahl, effBar: zahl, effKueche: zahl, effGesamt: zahl,
    pekService: zahl, pekBar: zahl, pekKueche: zahl, pekGesamt: zahl,
    /**
     * [grün, orange, rot]. **LINA mischt hier Strings und Zahlen.**
     *
     * Die Exploration sah nur Strings (`["80","100","150"]`) — allerdings nur
     * bei 2 von 141 Betrieben. Der erste echte Lauf am 25.07.2026 lieferte für
     * andere Betriebe Zahlen an denselben Stellen und löste prompt den
     * Schemawächter aus.
     *
     * Fachlich harmlos: die Transformation normalisiert beides über `Number()`,
     * die Werte landen korrekt in `core.schwellenwert_betrieb` (geprüft). Das
     * Schema war schlicht strenger als LINA. Es hier zu weiten ist kein
     * Aufweichen, sondern eine Korrektur — sonst meldet jeder einzelne
     * Backfill-Posten eine Abweichung, und die eine echte geht darin unter.
     */
    pekThreshold: z.array(z.union([z.string(), z.number()])).nullable().optional(),
    thresholds: z.record(z.string(), z.array(z.union([z.string(), z.number()])))
      .nullable().optional(),
    persoogBwa: zahl,
  })),
})

/** Drei Ebenen: Konzept > Betrieb > 5 feste Kennzahlen. */
const KennzahlZeile = z.object({
  name: z.string(),
  jan: zahl, feb: zahl, mar: zahl, apr: zahl, may: zahl, jun: zahl,
  jul: zahl, aug: zahl, sep: zahl, oct: zahl, nov: zahl, dec: zahl,
  kum: zahl,
})

export const KennzahlenSchema = z.object({
  year: z.string(),
  groups: z.array(z.object({
    key: z.string(),
    data: KennzahlZeile,
    children: z.array(z.object({
      key: z.string(),
      data: KennzahlZeile,
      children: z.array(z.object({ data: KennzahlZeile })).optional(),
    })).optional(),
  })),
})

export const ZeitzonenberichtSchema = z.object({
  timeframe: z.string(),
  hours: z.array(z.number()),
  stores: z.array(z.object({
    name: z.string(),
    encId: z.string(),
    hours: z.record(z.string(), z.number().nullable()),
  })),
})

export const VordefinierteZeitzonenSchema = z.object({
  timeframe: z.string(),
  zeitzonen: z.array(z.object({
    id: z.number(), name: z.string(),
    time_from: z.number(), time_to: z.number(),
  })),
  stores: z.array(z.object({
    name: z.string(), encId: z.string(),
    values: z.record(z.string(), z.number().nullable()),
  })),
})

export const ArtikelverkaufSchema = z.object({
  timeframe: z.string(),
  columns: z.array(z.object({
    artnr: z.number(),
    name: z.string(),
    fixed_we: zahl,
  })),
  rows: z.array(z.object({
    name: z.string(),
    encId: z.string(),
    counts: z.record(z.string(), z.number().nullable()).optional(),
    netto:  z.record(z.string(), z.number().nullable()).optional(),
    brutto: z.record(z.string(), z.number().nullable()).optional(),
    prices: z.record(z.string(), z.number().nullable()).optional(),
  })),
})

export const AktionsberichtSchema = z.object({
  timeframe: z.string(),
  aktionen: z.array(z.object({ id: z.number(), name: z.string() })).optional(),
  rows: z.array(z.object({
    name: z.string(), encId: z.string(),
    cells: z.record(z.string(), z.number().nullable()).optional(),
  })),
})

/** Einheitliche Hülle aller 72 Betriebs-Reports. */
export const BetriebsReportSchema = z.object({
  title: z.string(),
  timeframe: z.string(),
  from: z.number().optional(),
  to: z.number().optional(),
  errors: z.string().nullable().optional(),
  nBillsGesamt: zahl,
  tableHead: z.array(z.array(z.object({
    id: z.number(), field: z.string(), header: z.string(),
  }))),
  table: z.array(z.record(z.string(), z.unknown())),
})

export const SCHEMATA: Record<string, z.ZodTypeAny> = {
  'getUmsatzbericht':                 UmsatzberichtSchema,
  'getUmsatzbericht:speisen':         UmsatzberichtSchema,
  'getUmsatzbericht:getraenke':       UmsatzberichtSchema,
  'getPersonalkosten':                PersonalkostenSchema,
  'getKennzahlen:absolut':            KennzahlenSchema,
  'getKennzahlen:relativ':            KennzahlenSchema,
  'getZeitzonenbericht':              ZeitzonenberichtSchema,
  'getVordefinierteZeitzonenBericht': VordefinierteZeitzonenSchema,
  'getArtikelverkaufsbericht':        ArtikelverkaufSchema,
  'getAktionsbericht':                AktionsberichtSchema,
}

export function schemaFuer(key: string): z.ZodTypeAny | null {
  if (SCHEMATA[key]) return SCHEMATA[key]
  if (key.startsWith('getReport:')) return BetriebsReportSchema
  return null
}
