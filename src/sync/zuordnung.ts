/**
 * Nachlauf: Kostenstelle → Betrieb zuordnen.
 *
 * DIE FUNKTIONEN GAB ES SEIT MIGRATION 0034 — UND NIEMAND HAT SIE GERUFEN.
 * `manual.betrieb_vorschlaege_berechnen()` und
 * `manual.betrieb_zuordnung_anwenden()` sind vollständig gebaut, kommentiert
 * und getestet. In Produktion wurden sie am 13.08.2026 nachweislich **nie**
 * aufgerufen: der einzige Aufrufer im ganzen Repo war `zuordnung.test.ts`.
 *
 * Gemessene Folge: 25 von 152 Kostenstellen ohne `betrieb_key`, darunter
 * „Aposto Aachen - Alte Post" mit 458 und „Aposto Wuppertal II" mit 246
 * Bestellungen. Ihr Einkauf fällt aus jeder betriebsbezogenen Sicht heraus —
 * und zwar so, dass man es keiner Zahl ansieht: die Summen stimmen, sie
 * stehen nur nirgends.
 *
 * WARUM BEI JEDEM LAUF UND NICHT EINMALIG. Neue Kostenstellen entstehen
 * laufend, und seit dem 13.08.2026 werden die FoodNotify-Stammdaten täglich
 * geholt statt monatlich. Ein einmaliger Aufruf hätte denselben Fehler wie
 * `manual.belegarchiv_soll`: er wäre die Bedingung eines Erstabzugs, und
 * jeder danach angelegte Betrieb fiele stumm heraus.
 *
 * REIHENFOLGE ZWINGEND: erst berechnen, dann anwenden. `anwenden()` arbeitet
 * auf dem, was `berechnen()` schreibt.
 *
 * WAS ER AUSDRÜCKLICH NICHT TUT: raten. `anwenden()` trägt nur exakte
 * Treffer, bekannte Varianten und von Menschen entschiedene Fälle ein.
 * „unsicher" und „kein_treffer" bleiben NULL — offen ist besser als falsch,
 * und bei „Aposto Wuppertal II" gegen zwei gleichnamige LINA-Gesellschaften
 * hinge an einem geratenen Treffer ein sechsstelliger Einkaufsbetrag. Die
 * offenen Fälle stehen in `mart.kostenstelle_ohne_betrieb` und als eigene
 * Zeile in `mart.pruefung_uebersicht`.
 *
 * WIRFT NIE. Wie die übrigen Nachläufe: ein Fehler hier darf den Lauf nicht
 * nachträglich zum Fehlschlag machen — die Daten sind zu dem Zeitpunkt schon
 * geladen. Gemeldet wird er trotzdem.
 */
import { eine } from '../db/pool'
import { log } from '../lib/log'

export async function zuordnungNachlauf(): Promise<void> {
  try {
    const vorschlaege = await eine<{ n: number }>(
      `SELECT manual.betrieb_vorschlaege_berechnen() AS n`)
    const angewendet = await eine<{ n: number }>(
      `SELECT manual.betrieb_zuordnung_anwenden() AS n`)

    const offen = await eine<{ n: number }>(
      `SELECT count(*)::int AS n FROM mart.kostenstelle_ohne_betrieb
        WHERE NOT testbetrieb AND bestellungen > 0`)

    /**
     * Immer melden, auch bei null Änderungen — und die OFFENEN mit. Eine
     * Zeile „0 zugeordnet" allein liest sich wie „nichts zu tun"; erst mit
     * der Zahl daneben steht da, ob wirklich nichts zu tun ist oder ob
     * jemand entscheiden muss.
     */
    log.info('kostenstellen zugeordnet', {
      vorschlaege: Number(vorschlaege?.n ?? 0),
      zugeordnet: Number(angewendet?.n ?? 0),
      offen_mit_bestellungen: Number(offen?.n ?? 0),
    })
  } catch (e) {
    log.error('zuordnungs-nachlauf gescheitert — der Lauf bleibt gültig', { fehler: String(e) })
  }
}
