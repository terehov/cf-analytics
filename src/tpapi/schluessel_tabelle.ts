/**
 * Die Tabelle „API-Keys" aus dem Stammdatenblatt der Ladenakte — reine Funktionen,
 * ohne Netz, damit sie gegen das Fixture pruefbar sind (`schluessel_tabelle.test.ts`).
 * Benutzt von `src/tpapi_schluessel.ts`.
 */

export type SchluesselZeile = {
  name: string
  /** Der Schluessel selbst. NIE ausgeben. */
  key: string
  ip: string
  drittanbieter: string
  scopes: string
  erzeugtVon: string
  ebene: string
  /** Die Kennung des Schluessels aus dem Knopf „Löschen" (`deleteAPiKey(laden, id)`); null, wenn der Knopf fehlt. */
  id: string | null
}

const text = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim()

/** Spalten wie in der Oberflaeche: Name, Key, IP, Drittanbieter, Laeuft ab, Rechte, Erzeugt von, Ebene, Aktion. */
export function schluesselTabelle(html: string): SchluesselZeile[] {
  const tabelle = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(m => m[0]).find(t => /API - Key/.test(t))
  if (!tabelle) return []
  return [...tabelle.matchAll(/<tr[\s\S]*?<\/tr>/g)]
    .map(m => ({
      zellen: [...m[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(z => text(z[1])),
      id: m[0].match(/deleteAPiKey\('[0-9a-f]{40}'\s*,\s*'([0-9a-f]{40})'\)/)?.[1] ?? null,
    }))
    .filter(z => z.zellen.length >= 8)
    .map(({ zellen: z, id }) => ({
      name: z[0], key: z[1], ip: z[2], drittanbieter: z[3], scopes: z[5], erzeugtVon: z[6], ebene: z[7], id,
    }))
}

/** „Sell & Pick", „sell&pick", „Sell &amp; Pick" → „sellpick". */
export const anbieterNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Was an einer Zeile zu Sell & Pick gehoert.
 *   'loeschen' — Drittanbieter ist sell&pick UND der Schluessel heisst so: der Schluessel des Anbieters.
 *   'ansehen'  — nur eines von beiden passt: nicht anfassen, melden.
 *   null       — hat mit Sell & Pick nichts zu tun.
 * BEIDES muss passen. Der Drittanbieter ist ein Pflichtfeld ohne neutralen Eintrag — wer einen
 * eigenen Schluessel anlegt, waehlt irgendeinen (wir: Foodnotify). Trockenlauf 17.11.2026: bei
 * COYACAN liegt „Kaoix" (angelegt von Daniel, nur Journal lesen) unter sell&pick, im Testladen
 * „TestRosi". Die Regel „nur der Drittanbieter zaehlt" haette Kaoix geloescht.
 */
export function sellPickUrteil(z: SchluesselZeile): 'loeschen' | 'ansehen' | null {
  const anbieter = anbieterNorm(z.drittanbieter) === 'sellpick'
  const name = anbieterNorm(z.name) === 'sellpick'
  if (anbieter && name) return 'loeschen'
  if (anbieter || anbieterNorm(z.name).includes('sellpick')) return 'ansehen'
  return null
}
