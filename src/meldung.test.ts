import { describe, expect, test } from 'bun:test'
import { nachrichtBauen, type LaufKopf } from './meldung'
import type { Statusbericht } from './status'

const lauf: LaufKopf = {
  laufId: '190',
  status: 'teilweise',
  gestartetAm: new Date('2026-11-05T03:00:30Z'),   // 04:00 Berlin
  beendetAm: new Date('2026-11-05T06:05:26Z'),
  ableitungenBis: new Date('2026-11-05T05:34:47Z'),
  aufgabenOk: 4049,
  aufgabenFehler: 2,
}

const bericht = (stufen: Record<string, 'ok' | 'warnung' | 'stoerung'>): Statusbericht => ({
  status: Object.values(stufen).includes('stoerung') ? 'stoerung'
    : Object.values(stufen).includes('warnung') ? 'warnung' : 'ok',
  geprueft_am: '2026-11-05T06:06:00Z',
  pruefungen: Object.entries(stufen).map(([name, stufe]) => ({
    name, stufe,
    meldung: stufe === 'ok' ? 'ok' : `${name} | auffällig`,
    naechster_schritt: stufe === 'ok' ? undefined : `SELECT * FROM mart.${name};`,
  })),
})

describe('nachrichtBauen', () => {
  test('alles ok: kurze Nachricht, keine Tabelle', () => {
    const t = nachrichtBauen({ lauf, bericht: { ...bericht({ zugang: 'ok', zulauf: 'ok' }) }, vorher: [] })
    expect(t).toContain('#### ✅ Nachtlauf 190 · alles in Ordnung')
    expect(t).toContain('04:00–07:05 Uhr (3 h 05 min)')
    expect(t).toContain('Dashboards aktuell seit 06:34 Uhr')
    expect(t).toContain('4.049 Abrufe erfolgreich')
    expect(t).not.toContain('| Bereich |')
    expect(t).toContain('✅ LINA-Zugang · Zulauf der Quellen')
  })

  test('Befunde: Störung zuerst, neu markiert, SQL als Code, keine | in Zellen', () => {
    const t = nachrichtBauen({
      lauf, bericht: bericht({ zugang: 'ok', yext: 'warnung', zulauf: 'stoerung' }), vorher: ['yext:warnung'],
    })
    expect(t).toContain('#### 🔴 Nachtlauf 190 · Störung, bitte ansehen')
    const zeilen = t.split('\n')
    const z = zeilen.findIndex(l => l.includes('**Zulauf der Quellen**'))
    const y = zeilen.findIndex(l => l.includes('**Bewertungen (Yext)**'))
    expect(z).toBeLessThan(y)
    expect(zeilen[z]).toContain('🔴 🆕')
    expect(zeilen[y]).not.toContain('🆕')
    expect(zeilen[y]).toContain('yext / auffällig')
    expect(t).toContain('- **Bewertungen (Yext):** `SELECT * FROM mart.yext;`')
    expect(t).toContain('2 fehlgeschlagen')
  })

  test('Abbruch: Titel und Fehlertext, auch ohne Laufkopf', () => {
    const t = nachrichtBauen({ lauf: null, bericht: bericht({ zugang: 'ok' }), vorher: [], fehler: 'Error: boom' })
    expect(t).toContain('🔴 Nachtlauf abgebrochen')
    expect(t).toContain('`Error: boom`')
  })

  test('Testnachricht ist gekennzeichnet', () => {
    const t = nachrichtBauen({ lauf, bericht: bericht({ zugang: 'ok' }), vorher: [], test: true })
    expect(t).toContain('_Testnachricht, von Hand ausgelöst._')
  })
})
