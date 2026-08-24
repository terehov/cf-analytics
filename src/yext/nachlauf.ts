/**
 * Holt die Online-Bewertungen — als Nachlauf jedes Sync-Laufs, hoechstens
 * einmal am Tag.
 *
 * WARUM DAS HIER STEHT UND NICHT IN EINEM EIGENEN ZEITPLAN
 *
 * Dieselbe Ueberlegung wie bei den Auswahllisten und dem Deckungsbeitrag
 * nebenan — und diesmal eine, die schon Geld gekostet hat. Bis zum 02.08.2026
 * war das Einreihen ein zweiter Schedule Job. Er fiel aus, der Sync-Lauf lief
 * trotzdem, meldete „ok" und tat nichts: LINA stand acht Tage still, waehrend
 * der Importer fehlerfrei durchlief. **Ein Importer ohne Arbeit sieht genauso
 * aus wie einer, der fertig ist.**
 *
 * Ein eigener Zeitplan fuer Yext waere genau dieselbe Falle noch einmal.
 * Hier angehaengt passiert es von selbst, und es gibt weiterhin einen
 * Ausfallpunkt statt zwei.
 *
 * DIE DREI REGELN, WIE NEBENAN
 *
 *   1. Das hier darf einen Sync-Lauf NIEMALS scheitern lassen. Der Import aus
 *      LINA und FoodNotify ist die Arbeit; eine fehlende Bewertung bedeutet
 *      eine graue Ampel, kein verlorenes Datum. Diese Funktion faengt alles
 *      und wirft nie.
 *   2. ~~Sie laeuft NACH dem Import.~~ Seit dem 24.08.2026 laeuft sie
 *      NEBEN ihm, in Phase A von sync.ts. Yext ist ein eigener Dienst mit
 *      eigenem Stundenlimit und teilt sich mit LINA und FoodNotify nichts
 *      ausser der Datenbank — es gab keinen Grund, zehn Stunden zu warten,
 *      um dann zwanzig Minuten zu arbeiten. Die Bedingung, die WIRKLICH
 *      gilt, ist eine andere und bleibt erfuellt: dieser Nachlauf schreibt
 *      eine Round-Table-Kennzahl und muss deshalb VOR
 *      `roundTableNachlauf()` fertig sein. Phase A endet, bevor Phase B
 *      beginnt — strenger als vorher, nicht lockerer.
 *
 *      DER PREIS: der monatliche Zuordnungsabgleich unten sieht
 *      `core.betrieb` jetzt im Stand des Laufbeginns statt nach dem Import.
 *      Ein Betrieb, der in dieser Nacht zuerst auftaucht, bekaeme seine
 *      Yext-Zuordnung erst beim naechsten Monatsabgleich. Gemessen: seit
 *      Juli 2026 kam kein neuer Betrieb dazu, und der Fall stuende die
 *      ganze Zeit in `mart.betrieb_ohne_yext`.
 *   3. Sie laeuft HOECHSTENS EINMAL AM TAG. ~~Der Sync-Lauf ist
 *      stuendlich~~ — er ist TAEGLICH (nachgemessen 24.08.2026: ein Lauf je
 *      Tag um 05:05, keine einzige uebersprungene Zeile in sync.lauf, wo bei
 *      stuendlichem Takt neun je Tag stuenden). Die Sperre schuetzt deshalb
 *      gegen einen von Hand ausgeloesten ZWEITEN Lauf desselben Tages, nicht
 *      gegen 24. Bewertungen tropfen ueber Wochen ein; zweimal am Tag zu
 *      fragen brachte nichts.
 *
 *      NICHT BETROFFEN: der Zuordnungsabgleich weiter unten. Der laeuft seit
 *      dem 25.08.2026 in JEDEM Lauf, weil er idempotent ist — siehe dort.
 *
 * Was geholt wird, sind drei Monate (der laufende, der Vormonat und einer als
 * Reserve). Aeltere Staende sind kumuliert und aendern sich nicht mehr — dafuer
 * gibt es `bun run yext --voll`, das die ganze Reihe geradezieht.
 *
 * DAZU DIE ANALYTICS-BERICHTE (seit 10.08.2026)
 *
 * Themen, Antwortverhalten, Notenverteilung und Sichtbarkeit kamen mit
 * Migration `0050` dazu — geladen aber nur von `bun run yext`, dem Befehl von
 * Hand. Kein automatischer Lauf ruehrte sie an. Nachgemessen am 10.08.2026 auf
 * der Produktivdatenbank: `core.bewertung_thema`, `core.bewertung_antwort` und
 * `core.bewertung_note` standen auf **null Zeilen**, waehrend `core.bewertung`
 * 174.115 Zeilen fuehrte und taeglich wuchs.
 *
 * Das ist exakt die Falle aus dem Absatz oben, nur eine Ebene tiefer: die
 * Karten haetten nach einem einmaligen Handlauf Zahlen gezeigt und diese Zahlen
 * behalten, waehrend die Bewertungen daneben weiterliefen. Ein eingefrorener
 * Wert sieht aus wie ein gepflegter.
 */
import { log } from '../lib/log'
import { query, eine } from '../db/pool'
import { config } from '../config'
import { yextKonfiguriert } from './client'
import { staendeLaden, bewertungenLaden, kennzahlFuellen, laufMerken } from './laden'
import { analyticsLaden } from './analytics'
import { zuordnungAbgleichen } from './zuordnen'

/**
 * Ist eine monatliche Aufgabe faellig?
 *
 * DER TAKT HAENGT AN EINEM MERKER UND NICHT AM KALENDERTAG — anders als bei
 * den Momentaufnahmen im Importer, wo der Zeitraum des Postens den Takt
 * traegt. Hier gibt es keinen Posten: der Yext-Nachlauf haengt an der Uhr.
 * Ein „am Monatsersten"-Takt haette den Ausfall genau eines Laufs zum
 * Ausfall eines ganzen Monats gemacht.
 */
async function vollabgleichFaellig(schluessel: string): Promise<boolean> {
  const r = await eine<{ faellig: boolean }>(
    `SELECT coalesce((wert->>'am')::timestamptz < now() - ($2 || ' days')::interval, true)
              AS faellig
       FROM sync.merker WHERE schluessel = $1`,
    [schluessel, config.YEXT_VOLLABGLEICH_TAGE])
  // Keine Zeile = noch nie gelaufen = faellig.
  return r === null || r.faellig === true
}

async function merkerSetzen(schluessel: string): Promise<void> {
  await query(
    `INSERT INTO sync.merker (schluessel, wert)
     VALUES ($1, jsonb_build_object('am', now()))
     ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert, gesetzt_am = now()`,
    [schluessel])
}

/** Drei Monate: der laufende, der Vormonat (Portale liefern verzoegert), einer Reserve. */
const MONATE = 3

/**
 * Das volle Fenster fuer den Vollabgleich — dieselben 25 Monate wie
 * `bun run yext --voll`.
 *
 * 25 statt 24 ist kein Vertippen: der aelteste geladene Monat hat keinen
 * Vormonat und damit keinen Monatswert (`mart.bewertung_verlauf`). Ein Monat
 * Vorlauf macht die berichteten 24 vollstaendig.
 */
const VOLL_MONATE = 25

/**
 * Fuer die Analytics dagegen das volle Fenster, und das ist kein Widerspruch.
 *
 * Die Staende kosten einen Aufruf JE BETRIEB UND MONAT — drei Monate sind dort
 * rund 400 Aufrufe, 25 Monate waeren 3.300. Die Analytics-Berichte sind
 * Aggregate ueber alle Betriebe und Monate zugleich: **sechs Aufrufe, ganz
 * gleich wie lang das Fenster ist** (siehe Kopf von analytics.ts). Ein kurzes
 * Fenster spart hier also nichts und wuerde die Historie nie vollstaendig
 * machen — Yext liefert Themen und Stimmung erst ab April 2026, und diese
 * Reihe soll ganz dastehen.
 */
const ANALYTICS_MONATE = 25

/** Nach so vielen Stunden ist ein neuer Lauf faellig. 20 statt 24, damit er */
/** nicht taeglich eine Stunde spaeter rutscht und irgendwann ganz ausfaellt. */
const ABSTAND_STUNDEN = 20

export async function yextNachlauf(): Promise<void> {
  try {
    if (!yextKonfiguriert()) {
      // Kein Fehler: Yext ist optional, und wer keinen Schluessel hat, soll
      // keinen Fehler im Log finden, der keiner ist.
      log.debug('yext-nachlauf uebersprungen — kein YEXT_API_KEY')
      return
    }

    const r = await query<{ faellig: boolean; zuletzt: string | null }>(
      `SELECT coalesce(
                (wert->>'beendet_am')::timestamptz < now() - ($1 || ' hours')::interval,
                true) AS faellig,
              wert->>'beendet_am' AS zuletzt
         FROM sync.merker WHERE schluessel = 'yext_letzter_lauf'`, [ABSTAND_STUNDEN])

    // Keine Zeile = noch nie gelaufen = faellig.
    const zeile = r[0]
    if (zeile && !zeile.faellig) {
      log.debug('yext-nachlauf noch nicht faellig', { zuletzt: zeile.zuletzt })
      return
    }

    /**
     * ERST DIE ZUORDNUNG, DANN DIE STAENDE (seit 14.08.2026).
     *
     * `staendeLaden()` fragt Yext je ZUGEORDNETEM Betrieb. Ein Betrieb ohne
     * Eintrag in `manual.betrieb_fremd_id` wird schlicht nicht geholt — kein
     * Fehler, keine leere Zeile, gar nichts. Lief die Zuordnung dahinter,
     * bekaeme ein neuer Betrieb seine erste Bewertung einen Monat spaeter.
     *
     * WARUM SIE UEBERHAUPT HIER STEHT. Bis heute war der Abgleich
     * ausschliesslich ein Handbefehl (`bun run yext:zuordnen --schreiben`).
     * Gemessen am 14.08.2026: **sieben operative Betriebe** hatten keine
     * Yext-Zuordnung und fehlten damit in jeder Bewertungstabelle. Eine
     * Reparatur, die ein Mensch anstossen muss, ist keine Reparatur, sondern
     * eine Verabredung — dieselbe Lehre wie beim Belegarchiv am 12.08.2026.
     *
     * ~~MONATLICH UND NICHT TAEGLICH~~ — SEIT DEM 25.08.2026 TAEGLICH.
     *
     * Die alte Begruendung lautete: "die Namensheuristik entscheidet dabei,
     * und eine Entscheidung, die sich taeglich neu faellt, ist keine." Der
     * Satz stimmt — nur war die Antwort darauf falsch. Seltener zu
     * entscheiden macht eine Entscheidung nicht haltbarer, es verlaengert
     * nur das Fenster, in dem ein neuer Betrieb aus jeder Bewertungstabelle
     * faellt: bis zu 30 Tage.
     *
     * Die richtige Antwort steht jetzt in zuordnen.ts: **einmal
     * Entschiedenes wird nicht neu verhandelt.** Der Abgleich liest
     * `manual.betrieb_fremd_id`, meldet bestehende Zuordnungen als
     * `bereits zugeordnet` und laesst sie unberuehrt; die Heuristik greift
     * nur noch fuer Entitaeten, die NOCH KEINE Zuordnung haben. Damit ist
     * der taegliche Lauf idempotent — er kann nichts kippen, was schon
     * steht, und schliesst eine Luecke am Tag ihres Entstehens statt bis zu
     * einem Monat spaeter.
     *
     * WAS ER KOSTET: zwei Aufrufe (Entitaeten und Ordner) je Nacht, gegen
     * ein Stundenlimit von 5.000. Das ist der Preis fuer eine Zuordnung,
     * die nie aelter als einen Tag ist.
     *
     * DER MERKER BLEIBT, obwohl er nicht mehr taktet: `mart.yext_abgleich`
     * (Migration 0078) liest ihn und zeigt, wann der Abgleich zuletzt lief.
     * Ohne ihn stuende dort dauerhaft "nie" — und eine Sicht, die einen
     * laufenden Abgleich als ausgefallen meldet, wird abgeschaltet.
     *
     * Eigenes `try`: ein Fehler hier darf die Staende nicht mitnehmen. Die
     * Zuordnung von gestern ist besser als keine.
     */
    try {
      const z = await zuordnungAbgleichen({ schreiben: true })
      await merkerSetzen('yext_letzte_zuordnung')
      log.info('yext-zuordnung abgeglichen', {
        zugeordnet: z.zugeordnet, geschrieben: z.geschrieben, offen: z.offen,
        bereits: z.treffer.filter(t => t.art === 'bereits zugeordnet').length,
        neu: z.treffer.filter(t => t.art !== 'bereits zugeordnet' && t.art !== 'von Hand').length,
        offeneNamen: z.offene_namen.map(o => `${o.id} ${o.name}`),
        sicht: 'mart.betrieb_ohne_yext',
      })
    } catch (e) {
      log.warn('yext-zuordnung fehlgeschlagen — die Staende laufen trotzdem',
        { fehler: String((e as Error).message ?? e).slice(0, 300) })
    }

    /**
     * DAS FENSTER: drei Monate im Regelfall, 25 einmal im Monat.
     *
     * Ein Stand ist kumuliert — der Maerz aendert sich nicht mehr, wenn im
     * August eine Bewertung dazukommt. GELOESCHTE Bewertungen aendern
     * allerdings auch alte Staende, und dafuer war bisher `bun run yext
     * --voll` da: ein Handbefehl, der zuletzt am 03.08.2026 lief. Alle
     * Staende vor Mai 2026 trugen deshalb am 14.08.2026 denselben
     * `geladen_am` — sie altern still.
     *
     * Der Vollabgleich kostet rund 3.300 Aufrufe statt 400. Das
     * Stundenlimit der Management API liegt bei 5.000, und er laeuft einmal
     * im Monat — die Rechnung geht auf, ohne die Drosselung anzufassen.
     */
    const vollFaellig = await vollabgleichFaellig('yext_letzter_vollabgleich')
    const fenster = vollFaellig ? VOLL_MONATE : MONATE
    if (vollFaellig) {
      log.info('yext-vollabgleich faellig — 25 Monate statt 3', {
        grund: 'geloeschte Bewertungen aendern auch alte Staende',
      })
    }

    const erg = await staendeLaden({ monateAnzahl: fenster })
    if (vollFaellig && erg.betriebe > 0) await merkerSetzen('yext_letzter_vollabgleich')
    const kennzahl = erg.betriebe > 0 ? await kennzahlFuellen() : 0

    // Die einzelnen Bewertungen hinterher und inkrementell: sie sind die
    // Begruendung zur Kennzahl, nicht die Kennzahl. Ein Fehler hier soll
    // den schon eingetragenen Stand nicht entwerten -- deshalb danach.
    const texte = await bewertungenLaden()
    erg.aufrufe += texte.aufrufe
    erg.fehler.push(...texte.fehler)

    await laufMerken(erg, kennzahl, 'GOOGLEMYBUSINESS')

    log.info('yext-nachlauf fertig', {
      betriebe: erg.betriebe, aufrufe: erg.aufrufe,
      kennzahlZeilen: kennzahl, fehler: erg.fehler.length,
    })

    /**
     * Die Analytics-Berichte — in EIGENEM try und NACH laufMerken.
     *
     * Beides hat denselben Grund: analytics.ts faengt einen Fehler
     * ausdruecklich NICHT je Betrieb ab, weil dort alle Betriebe in einem
     * Aufruf stecken — es gibt kein Teilergebnis, entweder der Bericht kommt
     * oder nicht. Ohne eigenes try risse ein solcher Fehler den Merker mit,
     * und der naechste Lauf holte die rund 400 Stand-Aufrufe noch einmal, die
     * gerade erfolgreich waren.
     *
     * Umgekehrt darf ein Fehler hier auch nicht folgenlos bleiben: er wird
     * geloggt, und `/status` sieht ihn an den leeren Tabellen (Pruefung
     * "yext" in src/status.ts). Der naechste Nachlauf versucht es in 20
     * Stunden erneut — bei sechs Aufrufen ist das billig.
     */
    try {
      const a = await analyticsLaden({ monateAnzahl: ANALYTICS_MONATE })
      log.info('yext-analytics fertig', {
        aufrufe: a.aufrufe, themen: a.themen, antworten: a.antworten,
        noten: a.noten, sichtbarkeit: a.sichtbarkeit,
      })
    } catch (e) {
      log.warn('yext-analytics fehlgeschlagen — Staende und Texte stehen bereits',
        { fehler: String((e as Error).message ?? e).slice(0, 300) })
    }
  } catch (e) {
    // Regel 1. Ein Standort ohne Antwort, ein abgelaufener Schluessel, ein
    // Netzhaenger — nichts davon darf den Import mitnehmen.
    log.warn('yext-nachlauf fehlgeschlagen — der Sync-Lauf bleibt davon unberuehrt',
      { fehler: String((e as Error).message ?? e).slice(0, 300) })
  }
}
