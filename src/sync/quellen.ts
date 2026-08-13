/**
 * Das Register der Zulauferwartungen — die eine Stelle, an der steht, welche
 * Quelle in welchem Takt Zeilen liefern MUSS.
 *
 * WOZU DAS DA IST. Dieses Projekt hat zweimal Tage verloren, beide Male mit
 * derselben Signatur: der Lauf meldete „ok" und tat nichts.
 *
 *   02.08.2026  LINA stand acht Tage still, weil das Einreihen ein eigener
 *               Zeitplan war und ausfiel.
 *   12.08.2026  Das Belegarchiv fror ein, weil seine Einreihbedingung die
 *               eines einmaligen Abzugs war. Die Läufe 85 bis 88 meldeten
 *               269 von 269 Aufgaben „ok" und holten null Belege.
 *
 * Beide Male gab es die Zahl, die es verraten hätte — sie stand nur nirgends.
 * **Eine Erwartung, die niemand aufschreibt, ist im Kopf dessen, der zuletzt
 * hingesehen hat.** Hier steht sie.
 *
 * WARUM IN TYPESCRIPT UND NICHT ALS SEED IN DER MIGRATION. Weil sie neben die
 * Endpunkte gehört, die sie beschreibt, und weil `waechter.test.ts` sie ohne
 * Datenbank gegen `AKTIVE_ENDPUNKTE` prüfen kann: **kein aktiver Endpunkt darf
 * ohne Eintrag durchkommen.** Ein Register in einer Migration wäre ein zweiter
 * Ort für dieselbe Sache — und der zweite Ort ist immer der veraltete.
 *
 * WIE DIE KADENZ GEWÄHLT IST. Großzügig, und je Quelle begründet. Eine
 * Schwelle, die bei jedem normalen Schwanken ausschlägt, wird abgeschaltet;
 * eine, die nie ausschlägt, wird nicht gelesen. Beides ist derselbe Fehler.
 */
import { query } from '../db/pool'
import { log } from '../lib/log'

export type Quelle = {
  /** Schlüssel. Bei Endpunkten deren `key`, sonst ein sprechender Name. */
  quelle: string
  bezeichnung: string
  system: 'lina' | 'ladenakte' | 'foodnotify' | 'yext' | 'intern'
  /** Gemessen über `sync.aufgabe`. Schließt `tabelle` aus. */
  endpunkt?: string
  /** Gemessen direkt an der Zieltabelle. Für Nachläufe ohne `sync.aufgabe`. */
  tabelle?: { schema: string; name: string; zeitspalte: string }
  kadenz_stunden: number
  /** `false` = liefert bewusst nichts. Zählt in keiner Prüfzeile mit. */
  erwartet?: boolean
  bemerkung?: string
}

/** Ein Kalendertag plus Reserve für einen ausgefallenen Lauf. */
const TAEGLICH = 36
/** Eine Woche plus Reserve. Für alles, was nur bei Bedarf Zeilen liefert. */
const WOECHENTLICH = 8 * 24
/** Ein Kalendermonat plus Reserve. Für Momentaufnahmen. */
const MONATLICH = 35 * 24

export const QUELLEN: readonly Quelle[] = [
  // --- LINA, Konzern-Tagesberichte -------------------------------------
  // Alle acht laufen in jedem Lauf über das Nachzügler-Fenster. Bleibt
  // einer aus, fehlt ein Geschäftstag — und eine Lücke in den Daten sieht
  // aus wie ein Tag ohne Umsatz.
  { quelle: 'getUmsatzbericht', bezeichnung: 'Umsatz je Betrieb und Tag',
    system: 'lina', endpunkt: 'getUmsatzbericht', kadenz_stunden: TAEGLICH },
  { quelle: 'getUmsatzbericht:speisen', bezeichnung: 'Umsatz Hauptsparte Speisen',
    system: 'lina', endpunkt: 'getUmsatzbericht:speisen', kadenz_stunden: TAEGLICH },
  { quelle: 'getUmsatzbericht:getraenke', bezeichnung: 'Umsatz Hauptsparte Getraenke',
    system: 'lina', endpunkt: 'getUmsatzbericht:getraenke', kadenz_stunden: TAEGLICH },
  { quelle: 'getPersonalkosten', bezeichnung: 'Personalkosten je Betrieb und Tag',
    system: 'lina', endpunkt: 'getPersonalkosten', kadenz_stunden: TAEGLICH },
  { quelle: 'getZeitzonenbericht', bezeichnung: 'Umsatz je Stunde',
    system: 'lina', endpunkt: 'getZeitzonenbericht', kadenz_stunden: TAEGLICH },
  { quelle: 'getVordefinierteZeitzonenBericht', bezeichnung: 'Umsatz je vordefinierter Zeitzone',
    system: 'lina', endpunkt: 'getVordefinierteZeitzonenBericht', kadenz_stunden: TAEGLICH },
  { quelle: 'getArtikelverkaufsbericht', bezeichnung: 'Verkaufszahlen je Artikel',
    system: 'lina', endpunkt: 'getArtikelverkaufsbericht', kadenz_stunden: TAEGLICH },
  /*
   * Der Aktionsbericht liefert deutlich weniger Zeilen als die anderen
   * (2.114 in sieben Tagen gegen 1,6 Mio. beim Artikelbericht) — aber
   * jeden Tag welche. Dieselbe Kadenz, kein Sonderfall.
   */
  { quelle: 'getAktionsbericht', bezeichnung: 'Umsatz je Aktion',
    system: 'lina', endpunkt: 'getAktionsbericht', kadenz_stunden: TAEGLICH },

  // --- LINA, BWA und Brücke --------------------------------------------
  { quelle: 'getKennzahlen:absolut', bezeichnung: 'BWA, absolute Werte',
    system: 'lina', endpunkt: 'getKennzahlen:absolut', kadenz_stunden: TAEGLICH },
  { quelle: 'getKennzahlen:relativ', bezeichnung: 'BWA, Prozentwerte',
    system: 'lina', endpunkt: 'getKennzahlen:relativ', kadenz_stunden: TAEGLICH },
  /*
   * Seit dem 13.08.2026 im Wochentakt (Migration 0073). Acht Tage sind
   * deshalb die Kadenz und nicht sieben: der Posten hängt am Montag der
   * Woche, und ein ausgefallener Lauf darf nicht sofort Alarm auslösen.
   *
   * Diese Quelle ist die stillste Abhängigkeit im ganzen Register: sie
   * ist die EINZIGE Herkunft von core.betrieb.lina_betrieb_id, und daran
   * hängen die BWA und die tägliche Belegarchiv-Zählung. Am 26.07.2026
   * sind daran 7.860 BWA-Zeilen durchgefallen, ohne dass etwas rot wurde.
   */
  { quelle: 'analyticsFilterOptions', bezeichnung: 'Bruecke Betrieb → numerische LINA-ID',
    system: 'lina', endpunkt: 'analyticsFilterOptions', kadenz_stunden: WOECHENTLICH },
  { quelle: 'articleApi:franchise', bezeichnung: 'Warengruppen je Artikel',
    system: 'lina', endpunkt: 'articleApi:franchise', kadenz_stunden: MONATLICH,
    bemerkung: 'Momentaufnahme, monatlich. LINA fuehrt keine Warengruppenhistorie.' },

  // --- Ladenakte --------------------------------------------------------
  /*
   * Die tägliche Zählung ist seit 0069 der Torwächter des Belegarchivs.
   * Fällt sie aus, friert das Archiv ein — genau der 12.08.2026.
   */
  { quelle: 'la:belegzahl', bezeichnung: 'Taegliche Zaehlung des Belegarchivs',
    system: 'ladenakte', endpunkt: 'la:belegzahl', kadenz_stunden: TAEGLICH },
  /*
   * Der Abzug läuft NUR, wenn die Zählung eine Abweichung meldet. An
   * einem Tag ohne Uploads gibt es legitim null Aufgaben — deshalb eine
   * Woche und nicht ein Tag. Die scharfe Prüfung dazu ist
   * `mart.belegarchiv_zulauf`; diese Zeile ist der Rückhalt darunter.
   */
  { quelle: 'la:belegliste', bezeichnung: 'Abzug der Belegordner',
    system: 'ladenakte', endpunkt: 'la:belegliste', kadenz_stunden: WOECHENTLICH },
  { quelle: 'la:bwa_longterm', bezeichnung: 'BWA-Historie seit 2009',
    system: 'ladenakte', endpunkt: 'la:bwa_longterm', kadenz_stunden: MONATLICH,
    bemerkung: 'Momentaufnahme je Betrieb und Kalendermonat (einreihenJeMonat).' },
  { quelle: 'la:stammdaten', bezeichnung: 'Sitzplaetze, Flaeche, Plan-BWA, Tagesbudget',
    system: 'ladenakte', endpunkt: 'la:stammdaten', kadenz_stunden: MONATLICH,
    bemerkung: 'Momentaufnahme je Betrieb und Kalendermonat (einreihenJeMonat).' },

  // --- FoodNotify -------------------------------------------------------
  { quelle: 'fn:bestellungen', bezeichnung: 'Bestellliste je Kostenstelle',
    system: 'foodnotify', endpunkt: 'fn:bestellungen', kadenz_stunden: TAEGLICH },
  { quelle: 'fn:bestellung', bezeichnung: 'Bestellkopf im Detail',
    system: 'foodnotify', endpunkt: 'fn:bestellung', kadenz_stunden: TAEGLICH,
    bemerkung: 'Seit 0072 taeglich, weil Bestelldetails nachaltern.' },
  { quelle: 'fn:bestellpositionen', bezeichnung: 'Bestellpositionen',
    system: 'foodnotify', endpunkt: 'fn:bestellpositionen', kadenz_stunden: TAEGLICH },
  /*
   * War bis zum 14.08.2026 ein Einmalposten: vier Aufgaben, alle vom
   * 02.08.2026. Es liefert die Benutzer-ID, aus der alle anderen
   * FoodNotify-Pfade gebaut werden — ändert sie sich, laufen die anderen
   * Endpunkte geschlossen ins Leere. Seitdem täglich mit den übrigen
   * Stammdaten.
   */
  { quelle: 'fn:profil', bezeichnung: 'FoodNotify-Benutzerprofil',
    system: 'foodnotify', endpunkt: 'fn:profil', kadenz_stunden: TAEGLICH },
  { quelle: 'fn:betriebe', bezeichnung: 'FoodNotify-Betriebe',
    system: 'foodnotify', endpunkt: 'fn:betriebe', kadenz_stunden: TAEGLICH },
  { quelle: 'fn:kostenstellen', bezeichnung: 'Kostenstellen',
    system: 'foodnotify', endpunkt: 'fn:kostenstellen', kadenz_stunden: TAEGLICH },
  { quelle: 'fn:pos_standorte', bezeichnung: 'POS-Standorte und Kassensystem',
    system: 'foodnotify', endpunkt: 'fn:pos_standorte', kadenz_stunden: TAEGLICH },
  /*
   * Inventuren entstehen nicht täglich. Der Lauf zieht bei jedem Lauf die
   * jeweils letzte Seite nach; ob dabei Zeilen anfallen, hängt am Betrieb.
   * Eine Woche ist die Grenze, ab der „gar keine Inventur mehr" eine
   * Aussage wird.
   */
  { quelle: 'fn:inventuren', bezeichnung: 'Inventurliste',
    system: 'foodnotify', endpunkt: 'fn:inventuren', kadenz_stunden: WOECHENTLICH },
  { quelle: 'fn:inventurpositionen', bezeichnung: 'Inventurpositionen',
    system: 'foodnotify', endpunkt: 'fn:inventurpositionen', kadenz_stunden: WOECHENTLICH },

  // --- Yext: gemessen an der Tabelle ------------------------------------
  /*
   * Der Yext-Nachlauf schreibt KEINE `sync.aufgabe` — er hängt an der Uhr
   * und nicht an der Warteschlange. Gemessen wird deshalb direkt an den
   * Zieltabellen, und das ist hier ohnehin die schärfere Prüfung: am
   * 10.08.2026 lief der Nachlauf täglich sauber, der Merker war frisch,
   * und `core.bewertung_thema` stand auf null Zeilen. Ein frischer
   * Zeitstempel neben leeren Tabellen ist der irreführendste Zustand,
   * den dieses System kennt.
   */
  { quelle: 'yext:bewertung_stand', bezeichnung: 'Bewertungsstand je Betrieb und Monat',
    system: 'yext', tabelle: { schema: 'core', name: 'bewertung_stand', zeitspalte: 'geladen_am' },
    kadenz_stunden: 48 },
  { quelle: 'yext:bewertung', bezeichnung: 'Einzelbewertungen mit Text',
    system: 'yext', tabelle: { schema: 'core', name: 'bewertung', zeitspalte: 'geladen_am' },
    kadenz_stunden: 48 },
  { quelle: 'yext:bewertung_thema', bezeichnung: 'Themen aus den Bewertungen',
    system: 'yext', tabelle: { schema: 'core', name: 'bewertung_thema', zeitspalte: 'geladen_am' },
    kadenz_stunden: 48 },
  { quelle: 'yext:betrieb_sichtbarkeit', bezeichnung: 'Sichtbarkeit je Betrieb',
    system: 'yext', tabelle: { schema: 'core', name: 'betrieb_sichtbarkeit', zeitspalte: 'geladen_am' },
    kadenz_stunden: 48 },

  // --- Bewusst still: sie stehen hier, damit sie sichtbar sind ----------
  /*
   * LINAs Warenwirtschaft ist Demodaten (AGENTS.md Regel 5). Die fünf
   * `wawi:*`-Posten wurden am 26.07.2026 einmal geholt und danach nie
   * wieder, und das ist richtig so. Ohne Eintrag wären sie in dieser
   * Sicht schlicht nicht vorhanden — und die nächste Person hielte das
   * für eine Lücke.
   */
  { quelle: 'wawi:items', bezeichnung: 'LINAs Warenwirtschaft (stellvertretend)',
    system: 'lina', endpunkt: 'wawi:items',
    kadenz_stunden: MONATLICH, erwartet: false,
    bemerkung: 'Demodaten (Regel 5). Die fuenf wawi:*-Posten wurden am 26.07.2026 einmal '
             + 'erhoben, seither bewusst nicht mehr. Einkauf und Waren kommen aus FoodNotify.' },
  /*
   * DREI CORE-TABELLEN MIT NULL ZEILEN UND KEINEM SCHREIBER — am
   * 14.08.2026 in Produktion nachgezählt und im Repo gegengeprüft:
   * `core.rezept`, `core.pos_artikel` und `core.ware_stand` haben
   * keinerlei `INSERT` in `src/`, und FoodNotify hat für Rezepte keinen
   * Endpunkt (`src/foodnotify/endpunkte.ts` führt neun, keiner davon).
   *
   * `core.pos_artikel` ist dabei der unangenehmste Fall: `AGENTS.md`
   * beschreibt ihn als die Brücke zwischen LINA-Artikel und
   * FoodNotify-Rezept (`plu = core.artikel.artikelnummer`) — als
   * bestünde sie. Sie besteht nicht.
   *
   * Sie stehen hier als `erwartet: false`, weil ein Alarm ohne
   * Handlungsmöglichkeit nur die Prüfzeile entwertet. Was daraus folgt,
   * steht in `docs/offene-punkte.md`.
   */
  { quelle: 'core:rezept', bezeichnung: 'Rezepte (FoodNotify)',
    system: 'foodnotify', tabelle: { schema: 'core', name: 'rezept', zeitspalte: 'erstellt_am' },
    kadenz_stunden: MONATLICH, erwartet: false,
    bemerkung: 'Kein Endpunkt und kein Schreiber, Stand 14.08.2026. 0 Zeilen. '
             + 'Siehe docs/offene-punkte.md.' },
  { quelle: 'core:pos_artikel', bezeichnung: 'Bruecke LINA-Artikel → FoodNotify-Rezept',
    system: 'foodnotify', tabelle: { schema: 'core', name: 'pos_artikel', zeitspalte: 'geladen_am' },
    kadenz_stunden: MONATLICH, erwartet: false,
    bemerkung: 'Kein Schreiber im Repo, 0 Zeilen. AGENTS.md beschreibt den Join, '
             + 'als gaebe es ihn. Siehe docs/offene-punkte.md.' },
  { quelle: 'core:ware_stand', bezeichnung: 'Warenhistorie (FoodNotify)',
    system: 'foodnotify', tabelle: { schema: 'core', name: 'ware_stand', zeitspalte: 'geladen_am' },
    kadenz_stunden: MONATLICH, erwartet: false,
    bemerkung: 'Kein Schreiber im Repo, 0 Zeilen. core.ware selbst hat 43.271.' },
] as const

/**
 * Das Register in `sync.quelle` spiegeln — bei jedem Lauf.
 *
 * Vollabgleich statt Upsert-und-liegenlassen: eine Quelle, die hier
 * verschwindet, verschwindet auch aus der Sicht. Sonst bliebe ein
 * abgeschalteter Endpunkt für immer als „stumm" stehen und färbte die
 * Prüfzeile — bis jemand die Zeile nicht mehr liest.
 *
 * Wirft nie. Das Register ist die Beobachtung über die Arbeit, nicht die
 * Arbeit.
 */
export async function quellenSpiegeln(): Promise<number> {
  try {
    await query(
      `INSERT INTO sync.quelle
         (quelle, bezeichnung, system, endpunkt, schema_name, tabelle, zeitspalte,
          kadenz_stunden, erwartet, bemerkung)
       SELECT q->>'quelle', q->>'bezeichnung', q->>'system', q->>'endpunkt',
              q->>'schema_name', q->>'tabelle', q->>'zeitspalte',
              (q->>'kadenz_stunden')::int, (q->>'erwartet')::boolean, q->>'bemerkung'
         FROM jsonb_array_elements($1::jsonb) AS q
       ON CONFLICT (quelle) DO UPDATE
          SET bezeichnung = excluded.bezeichnung, system = excluded.system,
              endpunkt = excluded.endpunkt, schema_name = excluded.schema_name,
              tabelle = excluded.tabelle, zeitspalte = excluded.zeitspalte,
              kadenz_stunden = excluded.kadenz_stunden, erwartet = excluded.erwartet,
              bemerkung = excluded.bemerkung`,
      [JSON.stringify(QUELLEN.map(q => ({
        quelle: q.quelle, bezeichnung: q.bezeichnung, system: q.system,
        endpunkt: q.endpunkt ?? null,
        schema_name: q.tabelle?.schema ?? null,
        tabelle: q.tabelle?.name ?? null,
        zeitspalte: q.tabelle?.zeitspalte ?? null,
        kadenz_stunden: q.kadenz_stunden,
        erwartet: q.erwartet ?? true,
        bemerkung: q.bemerkung ?? null,
      })))])

    const weg = await query<{ quelle: string }>(
      `DELETE FROM sync.quelle WHERE quelle <> ALL($1::text[]) RETURNING quelle`,
      [QUELLEN.map(q => q.quelle)])
    if (weg.length > 0) {
      log.info('quellen aus dem register entfernt', { quellen: weg.map(w => w.quelle) })
    }
    return QUELLEN.length
  } catch (e) {
    log.error('quellenregister nicht gespiegelt — der Lauf geht weiter',
      { fehler: String(e).slice(0, 300) })
    return 0
  }
}
