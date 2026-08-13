/**
 * FoodNotify-Endpunktregister — das Gegenstück zu src/lina/endpunkte.ts.
 *
 * Alle Keys tragen das Präfix `fn:`. Daran erkennt der Worker den Mandanten-
 * pfad, und daran lassen sich FoodNotify-Aufgaben in sync.aufgabe von
 * LINA-Aufgaben unterscheiden, ohne eine weitere Spalte zu brauchen.
 *
 * Anders als bei LINA ist der Pfad eine FUNKTION: FoodNotify-Pfade tragen
 * ihre Parameter im Pfad selbst (/api/{erpId}/shop-order/{orderId}), nicht
 * in der Query. Fehlt ein Pflichtparameter, wirft der Bau des Pfads — ein
 * Posten ohne erpId ist ein Einreihungsfehler und soll wie einer aussehen,
 * nicht wie ein HTTP-Fehler.
 *
 * Aufgenommen ist, was Stufe 1 braucht (A1 Organisation, A2 Bestellungen —
 * docs/plan-foodnotify.md §4). Rezepte und Warenstamm folgen mit Stufe 2 als
 * weitere Einträge; genau dafür ist das Register da.
 */

export type FnEndpunkt = {
  key: `fn:${string}`
  zweck: string
  /**
   * Baut den Pfad samt Query. `p` sind die Zusatzparameter des Postens
   * (sync.warteschlange.parameter), `benutzerId` kommt aus der Session.
   */
  pfad: (p: Record<string, string>, benutzerId: number | null) => string
  /** Vorschlag beim Einreihen; dieselbe Skala wie bei LINA (klein gewinnt). */
  prioritaet: number
  hinweis?: string
}

/** Pflichtparameter holen oder werfen — mit dem Namen im Fehlertext. */
function pflicht(p: Record<string, string>, name: string): string {
  const wert = p[name]
  if (!wert) throw new Error(`Pflichtparameter "${name}" fehlt im Posten`)
  return String(wert)
}

export const FN_ENDPUNKTE: FnEndpunkt[] = [
  // --- A1 · Organisation — wenige Aufrufe je Marke ----------------------
  {
    key: 'fn:profil',
    zweck: 'Benutzer der Sitzung — sichert die Benutzer-ID im Raw-Layer',
    prioritaet: 5,
    pfad: () => '/api/profile',
    hinweis: 'Die Session holt die ID ohnehin nach der Anmeldung; dieser Posten '
      + 'dokumentiert sie zusätzlich in raw.api_antwort.',
  },
  {
    key: 'fn:betriebe',
    zweck: 'Betriebe der Marke mit Zeitzone',
    prioritaet: 5,
    pfad: (_p, benutzerId) => {
      if (!benutzerId) throw new Error('Benutzer-ID fehlt — /api/profile nach der Anmeldung gescheitert?')
      return `/api/core/business/${benutzerId}/restaurants`
    },
    hinweis: 'Der Pfadparameter ist die BENUTZER-ID aus /api/profile, nicht eine '
      + 'Restaurant- oder Kostenstellen-ID (Inventar §6).',
  },
  {
    key: 'fn:kostenstellen',
    zweck: 'Kostenstellen mit erpId — die drei Schlüsselebenen im Zusammenhang',
    prioritaet: 5,
    pfad: () => '/api/erp/all',
    hinweis: 'restaurant.id, costCenter.id und erpId nicht verwechseln — alle drei '
      + 'gehören ins Modell (core.kostenstelle).',
  },
  {
    key: 'fn:pos_standorte',
    zweck: 'Kassenanbindung je Kostenstelle — connectionId und Kassensystem',
    // 6, nicht 5: das Laden ist ein UPDATE auf core.kostenstelle und muss
    // NACH fn:kostenstellen laufen — sonst trifft es null Zeilen und die
    // Kassenanbindung ginge still verloren.
    prioritaet: 6,
    pfad: () => '/api/pos/locations',
    hinweis: 'connection.connectionId ist der Schlüssel für die POS-Zuordnung '
      + '(fn:pos_zuordnung, Stufe 2.3). deviceType.name entscheidet, ob die '
      + 'PLU-Brücke trägt — nur bei amadeus.',
  },

  // --- A2 · Bestellungen und Einkaufspreise — der eigentliche Gewinn ----
  {
    key: 'fn:bestellungen',
    zweck: 'Bestellliste einer Kostenstelle, seitenweise',
    prioritaet: 90,
    pfad: p => {
      const erpId = pflicht(p, 'erpId')
      const seite = pflicht(p, 'seite')
      // AUFSTEIGEND nach timeCreated: der Backfill läuft chronologisch von
      // 2021 vorwärts. Bricht er ab, ist alles vor dem Abbruch vollständig —
      // absteigend wäre nach jedem Abbruch unklar, wo die Lücke liegt.
      const q = new URLSearchParams({
        page: seite, page_size: '25',
        order_by: 'timeCreated', order_direction: 'ASC',
      })
      return `/api/${erpId}/shop-order/paginate?${q}`
    },
  },
  {
    key: 'fn:bestellung',
    zweck: 'Bestellkopf mit Lieferdatum, Summe und angehängten Rechnungen',
    prioritaet: 90,
    pfad: p => `/api/${pflicht(p, 'erpId')}/shop-order/${pflicht(p, 'orderId')}`,
  },
  {
    key: 'fn:bestellpositionen',
    zweck: 'Positionen einer Bestellung — Preis, Gebinde, Menge, Ware',
    prioritaet: 90,
    pfad: p => {
      const q = new URLSearchParams({ order_by: 'name' })
      return `/api/${pflicht(p, 'erpId')}/shop-order/${pflicht(p, 'orderId')}/change?${q}`
    },
    hinweis: 'shopOrderMappingProduct.concreteProduct.id ist die Ware — dieselbe '
      + 'Nummer wie zutat.artikelId. Echte Belegpreise, keine Katalogpreise.',
  },

  // --- B1 · Inventuren — lohnend fast nur bei Wilma Wunder (275) --------
  {
    key: 'fn:inventuren',
    zweck: 'Inventurköpfe ALLER Kostenstellen einer Marke in einem Aufruf, seitenweise',
    prioritaet: 95,
    pfad: p => {
      // erpIds[] ist ein ARRAY-Parameter — anders als fn:bestellungen läuft
      // dieser Endpunkt nicht je Kostenstelle, sondern EINMAL je Marke für
      // alle Kostenstellen zusammen (plan-foodnotify.md §4 B1). Die Liste
      // steht als kommagetrennter String im Posten (src/einreihen.ts baut
      // sie aus core.kostenstelle), hier nur wieder aufgeteilt.
      const erpIds = pflicht(p, 'erpIds').split(',').filter(Boolean)
      if (erpIds.length === 0) throw new Error('fn:inventuren: erpIds im Posten ist leer')
      const seite = pflicht(p, 'seite')
      const q = new URLSearchParams({ page: seite, order_by: 'timeCreated', order_direction: 'ASC' })
      for (const id of erpIds) q.append('erpIds[]', id)
      return `/api/erp/stocktakings?${q}`
    },
    hinweis: 'ACHTUNG PAGINATION: bei Wilma Wunder blieben beim ersten Auspacken 275 '
      + 'Inventuren unsichtbar — HTTP 200, leeres Ergebnis, keine Ausnahme (Inventar §1, '
      + 'plan-foodnotify.md Zeile 319). Die Hülle ist nach dem Pfadmuster /api/erp/* '
      + 'vermutlich {code,errors,isError,payload:{data,pagination}} — das ist aus dem '
      + 'Muster der übrigen /api/erp/*-Endpunkte abgeleitet, am echten stocktakings-Pfad '
      + 'selbst aber NICHT gemessen. Der erste echte Abruf gehört von Hand geprüft, bevor '
      + 'man den Zeilen traut (docs/foodnotify-api-inventar.md).',
  },
  {
    key: 'fn:inventurpositionen',
    zweck: 'Zählung einer Inventur — Sollbestand, gezählte Menge, Preis je Basiseinheit',
    prioritaet: 94,
    /**
     * DIESER ENDPUNKT IST PAGINIERT, UND ER SAGT ES AUCH.
     *
     * Bis zum 13.08.2026 fehlte hier der `page`-Parameter. Die Antwort trägt
     * `{pagination: {perPage: 800, totalItems: 817, totalPages: 2}}` — geholt
     * wurde immer nur Seite 1, also höchstens 800 Positionen. Der Fehler war
     * lautlos: HTTP 200, kein Fehler, kein Log, nur eine Inventur, die genau
     * bei 800 endet.
     *
     * In Produktion nachgemessen am 13.08.2026: keine der 358 Inventuren hat
     * mehr als 800 Positionen, das Maximum ist exakt 800. Neun stossen an,
     * ihnen fehlen zusammen 936 Positionen — und es sind die grössten, also
     * die mit dem höchsten Warenwert. `mart.inventur_schwund` rechnete für
     * sie einen zu kleinen Bestand.
     *
     * `page_size` wird BEWUSST NICHT gesetzt: 800 ist die Angabe des Servers
     * über sich selbst. Eine eigene Zahl wäre eine Annahme über fremdes
     * Verhalten — dieselbe Unterscheidung wie bei `page_count` in
     * nachfuellen.ts. Geblättert wird nach `totalPages` aus der Antwort.
     */
    pfad: p => {
      const q = new URLSearchParams({ page: pflicht(p, 'seite') })
      return `/api/erp/stocktakings/${pflicht(p, 'uuid')}/items?${q}`
    },
    hinweis: 'shopArticleId zeigt auf core.ware (quelle=lieferant), NICHT auf core.artikel — '
      + 'dieselbe Art Lieferanten-Artikelnummer wie zutat.artikelId (plan-foodnotify.md Zeile 146). '
      + 'PAGINIERT mit perPage 800; die Hülle ist {data, pagination} (die recipes-Form), '
      + 'nicht die erp-Form {payload:{data,pagination}} — am Rohbestand geprüft, 358 von 358.',
  },
]

const register = new Map(FN_ENDPUNKTE.map(e => [e.key, e]))

/** Endpunkt nachschlagen — wirft bei unbekanntem Key, wie das LINA-Pendant. */
export function fnEndpunkt(key: string): FnEndpunkt {
  const e = register.get(key as FnEndpunkt['key'])
  if (!e) throw new Error(`Unbekannter FoodNotify-Endpunkt: ${key}`)
  return e
}

/** Ist dieser Warteschlangen-Endpunkt ein FoodNotify-Posten? */
export const istFnEndpunkt = (key: string): boolean => key.startsWith('fn:')
