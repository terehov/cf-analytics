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

// --- Stammdaten-Momentaufnahmen ----------------------------------------
//
// Alle Felder am 25.07.2026 an den echten Antworten abgelesen, nicht geraten.
// Tolerant wie oben: unbekannte Felder sind erlaubt, fehlende Pflichtfelder
// nicht. Die Zahlenfelder sind durchweg nachsichtig, weil LINA in denselben
// Feldern mal Zahl und mal String liefert — das hat bei pekThreshold schon
// einmal einen Fehlalarm je Posten erzeugt.

/** Zahl ODER Zahl-als-String. LINA nimmt es damit nicht genau. */
const zahlOderText = z.union([z.number(), z.string()]).nullable().optional()

/**
 * `/wawi/rezept/articleApi?franchise=1`
 * Die Sätze liegen unter `articles`, nicht auf oberster Ebene.
 * `mec`/`detailcat`/`grosscat` sind Strings der Form "Weine (2900)".
 */
export const ArticleApiSchema = z.object({
  articles: z.array(z.object({
    id: z.number(),
    name: z.string(),
    artnr: zahlOderText,
    mec: z.string().nullable().optional(),
    detailcat: z.string().nullable().optional(),
    grosscat: z.string().nullable().optional(),
    encId: z.string().optional(),
  })),
})

/** `/intranet/api/analyticsFilterOptions` */
export const FilterOptionenSchema = z.object({
  gruppen: z.array(z.object({ id: z.number(), name: z.string() })).optional(),
  betriebe: z.array(z.object({ id: z.number(), name: z.string() })).optional(),
  hauptsparten: z.array(z.object({
    posId: z.number(), number: zahlOderText, name: z.string(),
  })).optional(),
  feinsparten: z.array(z.object({
    id: z.number(), number: zahlOderText, name: z.string(),
  })),
  verkaufsstellen: z.array(z.object({ number: zahlOderText, name: z.string() })).optional(),
})

/**
 * `/wawi/api/items?archive=0`
 * `prices` ist ein OBJEKT, dessen Schlüssel die Preis-ID ist — kein Array.
 */
export const WawiPreisSchema = z.object({
  id: z.number(),
  active: zahlOderText,
  ware_id: z.number().nullable().optional(),
  unit_id: z.number().nullable().optional(),
  seller_id: z.number().nullable().optional(),
  seller_sku: z.string().nullable().optional(),
  ordertype: z.string().nullable().optional(),
  updated: zahlOderText,
  qty: zahlOderText,
  bulk_qty: zahlOderText,
  price: zahlOderText,
  base_unit_mult: zahlOderText,
})

export const WawiItemsSchema = z.array(z.object({
  id: z.number(),
  name: z.string(),
  number: z.string().nullable().optional(),
  aktiv: z.boolean().nullable().optional(),
  groupId: z.number().nullable().optional(),
  groupName: z.string().nullable().optional(),
  price: zahlOderText,
  supplierId: z.number().nullable().optional(),
  unitId: z.number().nullable().optional(),
  unitName: z.string().nullable().optional(),
  ve: zahlOderText,
  ve_unit: z.string().nullable().optional(),
  /**
   * Objekt ODER leeres Array — PHPs `json_encode` macht aus einem leeren
   * Array `[]` und erst aus einem gefüllten assoziativen Array `{}`.
   *
   * Am 25.07.2026 nachgemessen: 594 Waren mit Objekt, 304 mit `[]`, und
   * **kein einziger** Array-Fall war nicht leer. Ohne diesen Zweig hätte
   * jede Momentaufnahme eine Schemaabweichung gemeldet.
   */
  prices: z.union([
    z.record(z.string(), WawiPreisSchema),
    z.array(z.never()),
  ]).nullable().optional(),
}))

/**
 * `/wawi/api/suppliers`
 * Geprüft werden nur die Felder, die wir auch speichern — der Rest der
 * 28 Felder (ustid, hrb, kreditor, gegenkonto*, tel, email, Anschrift) ist
 * bewusst nicht Teil des Schemas. Was nicht im Schema steht, wird auch nicht
 * aus Versehen weitergereicht.
 */
export const WawiSuppliersSchema = z.array(z.object({
  ID: z.number(),
  name: z.string().nullable().optional(),
  aktiv: zahlOderText,
  min_order_value: zahlOderText,
  dow: z.string().nullable().optional(),
}))

/** `/wawi/api/units` */
export const WawiUnitsSchema = z.array(z.object({
  ID: z.number(),
  name: z.string(),
  abk: z.string().nullable().optional(),
  parent: zahlOderText,
  factor: zahlOderText,
  baseUnit: z.boolean().nullable().optional(),
}))

/** `/wawi/api/orders` — Zeitfelder sind Unix-Sekunden. */
export const WawiOrdersSchema = z.array(z.object({
  bestellid: z.number(),
  lieferant: z.number().nullable().optional(),
  created: zahlOderText,
  bestellt_am: zahlOderText,
  liefertermin: zahlOderText,
  geliefert: zahlOderText,
  status: zahlOderText,
  articleCount: zahlOderText,
  articleSum: zahlOderText,
  posten: z.array(z.object({
    ware: z.number().nullable().optional(),
    unit_id: z.number().nullable().optional(),
    menge: zahlOderText,
    wareName: z.string().nullable().optional(),
    unitPrice: zahlOderText,
  })).nullable().optional(),
}))

/** `/wawi/inventory/inventory` — Hüllenformat, Sätze unter `data`. */
export const WawiInventorySchema = z.object({
  success: z.boolean().optional(),
  data: z.array(z.object({
    date: zahlOderText,
    isEditable: z.boolean().nullable().optional(),
  })),
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

  'articleApi:franchise':             ArticleApiSchema,
  'analyticsFilterOptions':           FilterOptionenSchema,
  'wawi:items':                       WawiItemsSchema,
  'wawi:suppliers':                   WawiSuppliersSchema,
  'wawi:units':                       WawiUnitsSchema,
  'wawi:orders':                      WawiOrdersSchema,
  'wawi:inventory':                   WawiInventorySchema,
}

export function schemaFuer(key: string): z.ZodTypeAny | null {
  if (SCHEMATA[key]) return SCHEMATA[key]
  if (key.startsWith('getReport:')) return BetriebsReportSchema
  return null
}
