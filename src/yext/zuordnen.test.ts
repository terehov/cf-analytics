/**
 * Die Yext-Zuordnung, seit sie TÄGLICH läuft (25.08.2026).
 *
 * WAS DIESER TEST SCHÜTZT, UND WARUM ES IHN VORHER NICHT GAB.
 *
 * Bis zum 24.08.2026 lief der Abgleich einmal im Monat, mit dieser
 * Begründung im Nachlauf: *„die Namensheuristik entscheidet dabei — und eine
 * Entscheidung, die sich täglich neu fällt, ist keine."* Der Satz stimmt. Die
 * Antwort darauf war trotzdem falsch: seltener zu entscheiden macht eine
 * Entscheidung nicht haltbarer, es verlängert nur das Fenster, in dem ein
 * neuer Betrieb aus jeder Bewertungstabelle fällt — bis zu 30 Tage.
 *
 * Haltbar wird sie dadurch, dass **einmal Entschiedenes nicht neu verhandelt
 * wird**. Genau das prüfen die Tests hier. Vorher war es nicht prüfbar: die
 * Rechnung steckte zwischen zwei Schnittstellenaufrufen und einem
 * Schreibvorgang in `zuordnungAbgleichen()`. Sie ist deshalb als reine
 * Funktion herausgelöst — dieselbe Bauart wie in `bounti/zuordnen.ts`, wo
 * derselbe Fehler am 24.08.2026 einen Lauf lang „offen: 81" gemeldet hat, wo
 * nichts offen war.
 */

import { describe, expect, test } from 'bun:test'
import { zuordnungRechnen } from './zuordnen'

/** Eine Yext-Entität, so weit die Rechnung sie braucht. */
const ent = (id: string, name: string) =>
  ({ meta: { id }, name }) as any

const BETRIEBE = [
  { betrieb_key: 1, name: 'Enchilada Aalen GmbH' },
  { betrieb_key: 2, name: 'Aposto Karlsruhe GmbH' },
  { betrieb_key: 3, name: 'Wilma Wunder Freudenstadt GmbH' },
]

describe('Yext-Zuordnung: was einmal entschieden ist, bleibt', () => {
  test('eine bestehende Zuordnung wird nicht neu verhandelt', () => {
    /*
     * DER FALL, DER DEN TÄGLICHEN LAUF GEFÄHRLICH MACHTE. Die Entität heißt
     * inzwischen anders als der Betrieb — die Heuristik fände sie nicht mehr
     * oder fände etwas anderes. Die Entscheidung steht aber schon in
     * manual.betrieb_fremd_id, und sie hat Vorrang.
     */
    const entitaeten = [ent('E_1', 'Völlig anderer Name')]
    const bestehend = new Map([['E_1', 1]])

    const r = zuordnungRechnen(entitaeten, BETRIEBE, bestehend, {})

    expect(r.treffer).toHaveLength(1)
    expect(r.treffer[0]!.betriebKey).toBe(1)
    expect(r.treffer[0]!.art).toBe('bereits zugeordnet')
    expect(r.offen).toHaveLength(0)
  })

  test('zwei Läufe hintereinander liefern dasselbe Ergebnis', () => {
    // Der eigentliche Punkt: Idempotenz. Was der erste Lauf schreibt, ist
    // für den zweiten Bestand — und darf ihn nicht zu einer anderen
    // Entscheidung bringen.
    const entitaeten = [
      ent('E_1', 'Enchilada Aalen'),
      ent('E_2', 'Aposto Karlsruhe'),
    ]

    const erst = zuordnungRechnen(entitaeten, BETRIEBE, new Map(), {})
    expect(erst.treffer.map(t => t.betriebKey).sort()).toEqual([1, 2])

    // So sähe manual.betrieb_fremd_id nach dem ersten Lauf aus.
    const bestehend = new Map(erst.treffer.map(t => [t.entitaetsId, t.betriebKey]))
    const zweit = zuordnungRechnen(entitaeten, BETRIEBE, bestehend, {})

    expect(zweit.treffer.map(t => [t.entitaetsId, t.betriebKey]).sort())
      .toEqual(erst.treffer.map(t => [t.entitaetsId, t.betriebKey]).sort())
    expect(zweit.offen).toHaveLength(0)
    // Und alle sind jetzt „bereits zugeordnet", keiner neu entschieden.
    expect(zweit.treffer.every(t => t.art === 'bereits zugeordnet')).toBe(true)
  })

  test('ein belegter Betrieb wird nicht ein zweites Mal vergeben', () => {
    /*
     * Ohne `bestehend` in `belegt` griffe sich die Heuristik einen Betrieb,
     * der schon einer anderen Entität gehört — die Zuordnung wanderte, und
     * zwar über Nacht und ohne Fehlermeldung.
     */
    const entitaeten = [
      ent('E_1', 'Enchilada Aalen'),          // schon zugeordnet auf 1
      ent('E_2', 'Enchilada Aalen GmbH'),     // würde sonst auch auf 1 treffen
    ]
    const bestehend = new Map([['E_1', 1]])

    const r = zuordnungRechnen(entitaeten, BETRIEBE, bestehend, {})

    expect(r.treffer.filter(t => t.betriebKey === 1)).toHaveLength(1)
    expect(r.offen.map(e => String(e.meta?.id))).toEqual(['E_2'])
  })

  test('eine neue Entität wird trotz Bestand noch zugeordnet', () => {
    // Die Gegenprobe: der Bestand darf die Zuordnung nicht einfrieren.
    // Sonst wäre der tägliche Lauf zwar idempotent und nutzlos.
    const entitaeten = [
      ent('E_1', 'Enchilada Aalen'),
      ent('E_3', 'Wilma Wunder Freudenstadt'),
    ]
    const bestehend = new Map([['E_1', 1]])

    const r = zuordnungRechnen(entitaeten, BETRIEBE, bestehend, {})

    const neu = r.treffer.find(t => t.entitaetsId === 'E_3')
    expect(neu?.betriebKey).toBe(3)
    expect(neu?.art).not.toBe('bereits zugeordnet')
  })

  test('von Hand schlägt Bestand nicht, aber Heuristik', () => {
    /*
     * VON_HAND läuft vor der Schleife und belegt den Betrieb zuerst. Steht
     * für dieselbe Entität ein Bestand, gewinnt VON_HAND — es ist die
     * ausdrückliche Entscheidung eines Menschen und damit die jüngere.
     */
    const entitaeten = [ent('E_1', 'Enchilada Aalen')]
    const bestehend = new Map([['E_1', 1]])

    const r = zuordnungRechnen(entitaeten, BETRIEBE, bestehend, { E_1: 2 })

    expect(r.treffer).toHaveLength(1)
    expect(r.treffer[0]!.betriebKey).toBe(2)
    expect(r.treffer[0]!.art).toBe('von Hand')
  })

  test('ausdrücklich offen bleibt offen', () => {
    // `null` in der Handliste heißt: geprüft und bewusst nicht zugeordnet.
    // Diese Zeilen müssen als offen gezählt werden, sonst verschwindet die
    // Frage aus der Arbeitsliste.
    const entitaeten = [ent('EK_06', 'Carls Brauhaus')]
    const r = zuordnungRechnen(entitaeten, BETRIEBE, new Map(), { EK_06: null })

    expect(r.treffer).toHaveLength(0)
    expect(r.ausdruecklichOffen).toEqual(['EK_06'])
  })
})
