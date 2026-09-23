/**
 * LINA-Attrappe für den Ende-zu-Ende-Test.
 *
 * Bildet die Eigenheiten nach, die in Phase 1 beobachtet wurden — nicht ein
 * ideales API, sondern das echte Verhalten:
 *   * Formular-Login mit den drei Eigenheiten aus `/js/common/login.js`:
 *     POST auf `/common/index/dologin` (nicht auf `/login`), Passwort als
 *     MD5-Hex, und ein `secret` aus der Loginseite, das je Aufruf neu
 *     vergeben und nur einmal akzeptiert wird
 *   * `dologin` antwortet IMMER mit 200 und JSON, auch im Fehlerfall:
 *     `{"status":"SUCCESS","url":...}` bzw. `{"status":"ERROR","message":...}`.
 *     Entschieden wird an `status`, nie am Statuscode.
 *   * Session als Cookie
 *   * abgelaufene Session -> HTML statt JSON
 *   * HTTP 500 mit LEEREM Body, wenn ein Betrieb keine Daten hat
 *   * Konzern-Endpunkte liefern alle Betriebe je Antwort
 *
 * Die Attrappe ist absichtlich streng: sie lehnt ab, was das echte LINA
 * ablehnt. Sonst würde der Ende-zu-Ende-Test einen Anmeldeablauf grün melden,
 * den es so nicht gibt — genau der Fall, der beim ersten echten Lauf auf
 * "Login 200, Probe 302" hinauslief.
 *
 * Nur für Tests. Läuft nie im Container mit.
 */
import { createHash } from 'node:crypto'

import { readFileSync } from 'node:fs'

const fixture = (name: string) => require(`../transform/fixtures/${name}.json`)
/** HTML-Fixtures: echte Antworten, nicht nachgebaut. Synchron gelesen, weil die
 *  Attrappe innerhalb eines Request-Handlers ohne await auskommen muss. */
const fixtureText = (datei: string) =>
  readFileSync(new URL(`../transform/fixtures/${datei}`, import.meta.url), 'utf8')

const md5 = (s: string) => createHash('md5').update(s).digest('hex')

/** Wie LINAs Loginseite: `window.secret` als 64 Hex-Zeichen im Seitenkopf. */
function loginSeite(secret: string): string {
  return `<!doctype html><html><head>
<script>window.secret = '${secret}';</script>
<script src="/js/common/md5.js"></script>
</head><body>
<form id="loginform"><input name="username"><input name="password" type="password">
<input type="hidden" name="system" value="a360"></form>
</body></html>`
}

/** Muss mit LOGIN_ZIEL in auth.ts übereinstimmen — bewusst hier gespiegelt. */
const LOGIN_ZIEL = '/common/index/dologin'

export type MockOptionen = {
  port?: number
  /**
   * Kuenstliche Antwortverzoegerung in Millisekunden, fuer JEDEN Datenaufruf.
   *
   * Gebraucht seit Migration 0082, um Nebenlaeufigkeit ueberhaupt PRUEFBAR zu
   * machen. Im Test stehen beide Takte auf 0 ms — ohne Verzoegerung ist die
   * FoodNotify-Schlange abgearbeitet, bevor LINAs erster Posten zurueck ist,
   * und ein Lauf mit zwei Schleifen sieht in `sync.aufgabe` genauso aus wie
   * einer mit einer. Der Test waere gruen, ohne irgendetwas zu zeigen.
   *
   * Die Anmeldung bleibt absichtlich schnell: verzoegert wird die ARBEIT,
   * nicht der Aufbau der Sitzung.
   */
  langsamMs?: number
  /** Nach so vielen Aufrufen die Session einmal für ungültig erklären. */
  sessionAblaufNach?: number
  /** Endpunkte, die 500 mit leerem Body liefern (der "keine Daten"-Fall). */
  keineDatenFuer?: string[]
  benutzer?: string
  /** Klartext; die Attrappe erwartet auf der Leitung den MD5-Hex davon. */
  passwort?: string
  system?: string
  /**
   * Ab dem wievielten Datenaufruf gesperrt wird — der Fall, den man nicht
   * proben kann, ohne ihn zu bauen.
   *
   * `sperreArt` entscheidet, wie: `429` und `403` als Statuscode,
   * `challenge` als HTML-Abwehrseite mit 200, `anmeldung` lässt schon die
   * Anmeldung scheitern.
   */
  sperreAb?: number
  sperreArt?: 429 | 403 | 'challenge' | 'anmeldung'
  /** Sekundenwert für den Retry-After-Header, falls gesetzt. */
  retryAfter?: number
  /**
   * LINA-Betriebs-IDs, deren Baumknoten `belegarchiv_<id>` KEINE Ordner
   * führt. Das ist kein Fehler, sondern eine Antwort — die Ladenakte kennt
   * Betriebe ohne Belegarchiv (drei geschlossene, sechs ohne Geschäft, einer
   * Test, gemessen 13.08.2026). `belegToken()` wirft dafür `KeinBelegarchiv`,
   * der Client macht `keine_daten` daraus, und `mart.belegarchiv_zulauf`
   * führt sie seit 0071 als eigenen Zustand statt für immer als „nie
   * gezählt".
   */
  ohneBelegarchiv?: string[]
  /**
   * Betriebsberichte (`/intranet/storeanalytics/getReport`, seit 0113). Die
   * Attrappe antwortet aus ECHTEN, anonymisierten Antworten vom 22.09.2026
   * (src/transform/fixtures/betriebsbericht/) und bildet LINAs gemessene
   * Eigenheiten nach:
   *   * `leer`: Berichtsnummern, die mit 500 und leerem Rumpf antworten
   *     (der „keine Daten"-Fall, und die neun „gesperrten").
   *   * `zuGrossAbTagen`: ab wie vielen Tagen Zeitraum LINA mit 504 und einer
   *     großen HTML-Fehlerseite antwortet (96: ein Monat, gemessen ~60 s).
   *   * `doppeltKodiert`: die Hülle als JSON-String im JSON. Vorgabe true.
   * Der alte Weg `/finanzen/analytics/getReport?storeId=` liefert — wie das
   * echte LINA — 200 und ein leeres Gerüst (KORREKTUR 7).
   */
  betriebsberichte?: {
    leer?: number[]
    zuGrossAbTagen?: Record<number, number>
    doppeltKodiert?: boolean
  }
}

/**
 * Wie viele Belege je Ordner in LINA „gelöscht" wurden — typeId auf Anzahl.
 *
 * Der Fall, den man nicht proben kann, ohne ihn zu bauen: LINA räumt auf.
 * Danach zählt der Ordner weniger, als wir halten, und der Abzug muss
 * schrumpfen können. Bis zum 13.08.2026 konnte er das nicht (reiner Upsert),
 * und die Folge war ein Ordner, der jede Nacht ganz neu geholt wurde, ohne
 * je zu konvergieren. Die Attrappe lässt die Belege vom ENDE der Liste
 * verschwinden und zieht `recordsTotal` mit — wie LINA es täte.
 */
export type Geloescht = Record<string, number>

/** „1.8.2026" → „2026-08-01". */
function deIso(s: string | null): string | null {
  const m = s ? /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s) : null
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null
}

/** Berliner Mitternacht eines ISO-Tags als Unix-Sekunden — so trägt LINA `Datum`. */
function berlinMitternacht(iso: string): number {
  // Grob genug für die Attrappe: Sommerzeit (UTC+2) von April bis Oktober.
  const monat = Number(iso.slice(5, 7))
  const versatz = monat >= 4 && monat <= 10 ? 2 : 1
  return Date.parse(`${iso}T00:00:00Z`) / 1000 - versatz * 3600
}

const bbFixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../transform/fixtures/betriebsbericht/${name}`, import.meta.url), 'utf8'))

/**
 * Die Antwort eines Betriebsberichts aus den echten Fixtures. 92 wählt den
 * Betrieb nach `laden` (wilma-01 … wilma-15), alle anderen liefern Wilma Wunder
 * Düsseldorf. 96/86/113 bekommen ihr Datum auf den ersten angefragten Tag
 * gesetzt — sonst lägen die Bons außerhalb des Fensters, und der Lader lehnte
 * sie zu Recht ab.
 */
function betriebsberichtAntwort(report: number, laden: string, von: string, bis: string = von): unknown | null {
  if (report === 92) {
    const f = bbFixture('report92-wilma-2026-08.json') as { betriebe: { encId: string; antwort: unknown }[] }
    return (f.betriebe.find(b => b.encId === laden) ?? f.betriebe[1]!).antwort
  }
  const datei: Record<number, string> = {
    88: 'report88-duesseldorf-2026-08.json', 97: 'report97-duesseldorf-2026-08.json',
    96: 'report96-duesseldorf-2026-08-15.json', 99: 'report99-duesseldorf-2026-08-gekuerzt.json',
  }
  let antwort: any
  if (datei[report]) antwort = bbFixture(datei[report]!).antwort
  else {
    const st = bbFixture('stufe-b-stichproben.json') as { berichte: Record<string, { antwort: unknown }> }
    antwort = st.berichte[`getReport:${report}`]?.antwort
  }
  if (!antwort) return null
  /*
   * 97 liefert je Tag einen Block mit seinem Datum — und nur Tage im
   * angefragten Zeitraum (0120: der laufende Monat wird als Teilmonat
   * 1.–Vortag geholt). Die Fixture ist der ganze August; hier wird sie auf
   * von..bis geschnitten, wie LINA es täte.
   */
  if (report === 97) {
    const neu = structuredClone(antwort)
    const iso = (d: string) => d.split('.').reverse().join('-')
    neu.table = neu.table.filter((b: any) => {
      const tag = iso(String(b.businessDate ?? ''))
      return tag >= von && tag <= bis
    })
    return neu
  }
  if (report === 96 || report === 86 || report === 113) {
    const neu = structuredClone(antwort)
    for (const b of neu.table) {
      for (const [k, z] of Object.entries(b as Record<string, any>)) {
        if (/^\d+$/.test(k) && z?.Datum?.value) z.Datum.value = berlinMitternacht(von)
      }
    }
    return neu
  }
  return antwort
}

export function mockStarten(opt: MockOptionen = {}) {
  /** Veränderbar zur Laufzeit: der Test lässt Belege zwischen zwei Läufen verschwinden. */
  const geloescht: Geloescht = {}
  /** Jeder `laden`-Wert, den ein Betriebsbericht bekam — in Reihenfolge. */
  const ladenGesehen: string[] = []
  const gueltigeSessions = new Set<string>()
  /** Ausgegebene, noch nicht eingelöste secrets — je Aufruf eins, einmal gültig. */
  const offeneSecrets = new Set<string>()
  let secretZaehler = 0
  let aufrufe = 0
  let anmeldungen = 0
  let abgelaufen = false
  /** Wie oft die Attrappe eine Sperre geliefert hat -- der Test misst daran das Nachfassen. */
  let gesperrteAufrufe = 0
  const zaehler: Record<string, number> = {}
  let letzteHeader: Record<string, string> = {}
  const passwortHash = md5(opt.passwort ?? 'geheim')

  const server = Bun.serve({
    port: opt.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url)
      const pfad = url.pathname
      letzteHeader = Object.fromEntries(req.headers)
      const cookie = req.headers.get('cookie') ?? ''
      const sid = /LINASESS=([^;]+)/.exec(cookie)?.[1]

      if (pfad === '/login' && req.method === 'GET') {
        // 64 Hex-Zeichen wie im Original, aber deterministisch: Math.random()
        // hier würde den Test von Zufall abhängig machen.
        const secret = md5(`secret-${++secretZaehler}`) + md5(`salt-${secretZaehler}`)
        offeneSecrets.add(secret)
        return new Response(loginSeite(secret), {
          headers: { 'content-type': 'text/html', 'set-cookie': 'LINASESS=vorlaeufig; Path=/; HttpOnly' },
        })
      }

      if (pfad === LOGIN_ZIEL && req.method === 'POST') {
        anmeldungen++
        const body = new URLSearchParams(await req.text())
        const secret = body.get('secret') ?? ''

        // LINA antwortet auf `dologin` IMMER mit 200 und JSON — auch im
        // Fehlerfall. Entschieden wird an `status`, nie am Statuscode.
        // `login.js` zeigt `message` dem Nutzer wörtlich an.
        //
        // Am 25.07.2026 gegen das echte LINA abgelesen; der Fehlerfall lautet
        // dort wörtlich:
        //   {"status":"ERROR","message":"Benutzername oder Passwort ist falsch!"}
        // Die Attrappe hatte hier vorher HTML bzw. eine 302 stehen — beides
        // hat das echte LINA nie geschickt.
        const fehlschlag = (message: string) =>
          Response.json({ status: 'ERROR', message }, { status: 200 })

        if (!offeneSecrets.delete(secret)) return fehlschlag('Ihre Sitzung ist abgelaufen!')
        if (opt.sperreArt === 'anmeldung' && opt.sperreAb !== undefined) {
          return fehlschlag('Benutzername oder Passwort ist falsch!')
        }
        if (body.get('username') !== (opt.benutzer ?? 'testuser')) {
          return fehlschlag('Benutzername oder Passwort ist falsch!')
        }
        // Erwartet wird der Hash, nicht das Klartextpasswort.
        if (body.get('password') !== passwortHash) {
          return fehlschlag('Benutzername oder Passwort ist falsch!')
        }
        if (body.get('system') !== (opt.system ?? 'a360')) {
          return fehlschlag('Benutzername oder Passwort ist falsch!')
        }

        const neu = `sess-${anmeldungen}-${secretZaehler}`
        gueltigeSessions.add(neu)
        abgelaufen = false
        aufrufe = 0
        return Response.json(
          { status: 'SUCCESS', url: '/common/dashboard/index' },
          { status: 200, headers: { 'set-cookie': `LINASESS=${neu}; Path=/; HttpOnly` } })
      }

      const angemeldet = sid !== undefined && gueltigeSessions.has(sid) && !abgelaufen
      if (!angemeldet) {
        // Genau wie LINA: HTML statt JSON, kein 401.
        return new Response(loginSeite('0'.repeat(64)),
          { status: 200, headers: { 'content-type': 'text/html' } })
      }

      if (pfad === '/common/api/account') {
        return Response.json({ user: { vorname: 'Test', nachname: 'Nutzer' } })
      }

      aufrufe++
      if (opt.sessionAblaufNach && aufrufe > opt.sessionAblaufNach) abgelaufen = true

      // Ab hier gilt die kuenstliche Verzoegerung: die Arbeit wird langsam,
      // die Anmeldung darueber bleibt schnell.
      if (opt.langsamMs) await Bun.sleep(opt.langsamMs)

      // Sperre — der Fall, den man nicht proben kann, ohne ihn zu bauen.
      if (opt.sperreAb && aufrufe >= opt.sperreAb && opt.sperreArt !== 'anmeldung') {
        gesperrteAufrufe++
        const kopf = opt.retryAfter ? { 'retry-after': String(opt.retryAfter) } : undefined
        if (opt.sperreArt === 'challenge') {
          return new Response(
            '<!doctype html><html><head><title>Attention Required</title></head>' +
            '<body><h1>Access denied</h1><p>Please complete the captcha.</p></body></html>',
            { status: 200, headers: { 'content-type': 'text/html', ...kopf } })
        }
        return new Response('', { status: opt.sperreArt ?? 429, headers: kopf })
      }

      /**
       * Ladenakte. Bildet das GEMESSENE Verhalten nach, nicht ein sauberes API:
       * der Baum liefert JSON mit Content-Type text/html, die Token sind je
       * Aufruf verschieden, und die Ordnerseite traegt den Token nur im
       * eingebetteten getFilesUrl.
       */
      if (pfad === '/intranet/ladenakte/baum/admin/1') {
        zaehler['la_baum'] = (zaehler['la_baum'] ?? 0) + 1
        const id = url.searchParams.get('id') ?? ''
        const salz = `${Math.random().toString(16).slice(2)}${'0'.repeat(40)}`.slice(0, 86)
        if (id.startsWith('belegarchiv_')) {
          // Ein Betrieb ohne einen einzigen Ordner: leere Kinderliste, HTTP 200.
          // Genau so sieht es aus — kein Fehler, nur nichts da.
          if ((opt.ohneBelegarchiv ?? []).includes(id.slice('belegarchiv_'.length))) {
            return new Response('[]', { headers: { 'content-type': 'text/html' } })
          }
          return new Response(JSON.stringify([{
            text: 'Eingangsrechnungen und Avise',
            a_attr: { 'data-link': `/intranet/ladenakte/showBelegarchivFolder?storeId=${salz}&typeId=1&admin=1` },
          }]), { headers: { 'content-type': 'text/html' } })
        }
        if (id.startsWith('bwa_')) {
          return new Response(JSON.stringify({ children: [{
            text: 'Longterm',
            a_attr: { 'data-link': `/finanzen/bwa/longterm?module=franchise&laden=${salz.slice(0, 84)}` },
          }] }), { headers: { 'content-type': 'text/html' } })
        }
        if (id.startsWith('laden_')) {
          return new Response(JSON.stringify({ children: [{
            text: 'Stammdaten',
            a_attr: { 'data-link': `/intranet/ladenakte/ladenstamm/laden/${'a'.repeat(40)}/admin/1/` },
          }] }), { headers: { 'content-type': 'text/html' } })
        }
        return new Response('unbekannter Baumknoten', { status: 404 })
      }

      if (pfad === '/intranet/ladenakte/showBelegarchivFolder') {
        zaehler['la_ordnerseite'] = (zaehler['la_ordnerseite'] ?? 0) + 1
        const tok = url.searchParams.get('storeId') ?? ''
        // Der Token fuer die Belegliste ist ein ANDERER als der der Ordnerseite.
        return new Response(
          `<div>Belegarchiv</div><script>var getFilesUrl = `
          + `'/intranet/ladenakte/beleglist?admin=1&storeId=L${tok.slice(1)}&typeId=1';</script>`,
          { headers: { 'content-type': 'text/html' } })
      }

      /**
       * Belegliste UND Zaehlung — derselbe Pfad, unterschieden nur durch
       * `length`. Genau so ist es auch bei LINA: `la:belegzahl` ruft mit
       * length=1 auf, `la:belegliste` mit 100.000.
       *
       * DIE ATTRAPPE BEACHTET length SEIT DEM 13.08.2026. Vorher gab sie
       * immer alle 61 Zeilen zurueck, gleich was angefragt war — damit haette
       * eine Zaehlung im Test 61 Belege geliefert und der Unterschied
       * zwischen beiden Endpunkten waere unpruefbar geblieben. `recordsTotal`
       * bleibt dabei die VOLLE Zahl, denn genau das ist die Aussage, auf der
       * der Zulaufabgleich beruht: wie viele es insgesamt sind, unabhaengig
       * davon, wie viele geliefert wurden.
       */
      if (pfad === '/intranet/ladenakte/beleglist') {
        const laenge = Number(url.searchParams.get('length') ?? 0)
        zaehler[laenge === 1 ? 'la_belegzahl' : 'la_belegliste'] =
          (zaehler[laenge === 1 ? 'la_belegzahl' : 'la_belegliste'] ?? 0) + 1
        if (!url.searchParams.get('storeId')) {
          return new Response('storeId fehlt', { status: 400 })
        }
        const f = fixture('ladenakte_beleglist') as { data: Record<string, unknown>[] }
        const start = Number(url.searchParams.get('start') ?? 0)

        /**
         * JEDER ORDNER HAT EIGENE BELEGE — sonst prueft der Test sich selbst.
         *
         * Der Upsert-Schluessel von core.buchungsbeleg ist (betrieb_key,
         * lina_id), typ_id gehoert ausdruecklich NICHT dazu (Migration 0053,
         * Falle 5): ein in einen anderen Ordner umgelegter Beleg soll nicht
         * dupliziert werden. Lieferte die Attrappe fuer alle vierzehn typeId
         * dieselben 61 lina_id, verschoebe jeder Abzug also nur die typ_id
         * derselben 61 Zeilen — und der Zulaufabgleich saehe fuer dreizehn
         * Ordner dauerhaft "null gehalten, 61 gezaehlt".
         *
         * Ordner 1 behaelt die echten 61 Eingangsrechnungen der Schlager Cafe
         * Beteiligungs AG, an denen die Feldpruefungen haengen. Die uebrigen
         * bekommen zwei Zeilen mit eigenen IDs — so wie in Wirklichkeit, wo
         * die Erhebung vom 11.08.2026 pro Betrieb sehr unterschiedlich volle
         * und 427 von 1.048 nachweislich leere Ordner gezaehlt hat.
         */
        const typ = url.searchParams.get('typeId') ?? '1'
        const vorhanden = typ === '1' ? f.data : f.data.slice(0, 2).map((z, i) => ({
          ...z, id: `${typ}00${i}`, encryptedId: `enc-${typ}-${i}`,
        }))

        /**
         * GELÖSCHTE BELEGE FALLEN VOM ENDE WEG, UND recordsTotal FÄLLT MIT.
         *
         * Beides gehört zusammen: eine Zählung, die weiter die alte Zahl
         * meldet, wäre der Fall „abgebrochener Abzug" und nicht der Fall
         * „LINA hat gelöscht". Nur wenn die Zahl mitsinkt, prüft der Test
         * wirklich, ob unser Bestand schrumpfen kann.
         */
        const weg = geloescht[typ] ?? 0
        const alle = weg > 0 ? vorhanden.slice(0, Math.max(0, vorhanden.length - weg)) : vorhanden

        return Response.json({
          ...f,
          recordsTotal: alle.length,
          recordsFiltered: alle.length,
          data: laenge > 0 ? alle.slice(start, start + laenge) : alle,
        })
      }

      if (pfad === '/finanzen/bwa/longterm') {
        zaehler['la_bwa'] = (zaehler['la_bwa'] ?? 0) + 1
        if (!url.searchParams.get('laden')) return new Response('laden fehlt', { status: 400 })
        return new Response(fixtureText('bwa_longterm_klein.html'),
          { headers: { 'content-type': 'text/html' } })
      }

      if (/^\/intranet\/ladenakte\/ladenstamm\//.test(pfad)) {
        zaehler['la_stammdaten'] = (zaehler['la_stammdaten'] ?? 0) + 1
        return new Response(fixtureText('ladenakte_stammdaten.html'),
          { headers: { 'content-type': 'text/html' } })
      }

      /**
       * Betriebsberichte (0113). `laden` ist Pflicht — ohne Betrieb kennt LINA
       * den Bericht nicht; die Attrappe lehnt ab, statt still den
       * Sitzungsbetrieb zu liefern.
       */
      if (pfad === '/intranet/storeanalytics/getReport') {
        const report = Number(url.searchParams.get('report'))
        const laden = url.searchParams.get('laden')
        zaehler[`getReport:${report}`] = (zaehler[`getReport:${report}`] ?? 0) + 1
        ladenGesehen.push(laden ?? '')
        if (!laden) return new Response('laden fehlt', { status: 400 })
        const opt2 = opt.betriebsberichte ?? {}
        if (opt2.leer?.includes(report)) return new Response('', { status: 500 })
        const von = deIso(url.searchParams.get('von'))
        const bis = deIso(url.searchParams.get('bis'))
        if (!von || !bis) return new Response('von/bis fehlen', { status: 400 })
        const tage = Math.round((Date.parse(bis) - Date.parse(von)) / 86_400_000) + 1
        const grenze = opt2.zuGrossAbTagen?.[report]
        if (grenze !== undefined && tage > grenze) {
          return new Response(`<!DOCTYPE html><html lang="de-DE"><head><title>504</title></head><body>${'x'.repeat(5000)}</body></html>`,
            { status: 504, headers: { 'content-type': 'text/html; charset=UTF-8' } })
        }
        const antwort = betriebsberichtAntwort(report, laden, von, bis)
        if (!antwort) return new Response('', { status: 500 })
        const text = JSON.stringify(antwort)
        return new Response(opt2.doppeltKodiert === false ? text : JSON.stringify(text),
          { headers: { 'content-type': 'application/json' } })
      }
      if (pfad === '/finanzen/analytics/getReport') {
        // Der falsche Weg: 200, plausible Hülle, keine Daten — für jeden Betrieb.
        zaehler['falscher_weg'] = (zaehler['falscher_weg'] ?? 0) + 1
        return Response.json({
          title: 'Rabattbericht', timeframe: '', nBillsGesamt: 0, balanceSumBrutto: 0,
          tableHead: [[]], table: [{ businessDate: '' }],
        })
      }

      const map: Record<string, string> = {
        '/intranet/analytics/getUmsatzbericht': 'getUmsatzbericht',
        '/intranet/analytics/getPersonalkosten': 'getPersonalkosten',
        '/intranet/analytics/getKennzahlen': 'getKennzahlen',
        '/intranet/analytics/getZeitzonenbericht': 'getZeitzonenbericht',
        '/intranet/analytics/getVordefinierteZeitzonenBericht': 'getVordefinierteZeitzonenBericht',
        '/intranet/analytics/getArtikelverkaufsbericht': 'getArtikelverkaufsbericht',
        '/intranet/analytics/getAktionsbericht': 'getAktionsbericht',

        // Stammdaten-Momentaufnahmen. Die Fixtures sind anonymisiert, bilden
        // aber die Eigenheiten des Originals nach — insbesondere prices als
        // Objekt UND als leeres Array, und Inventurtermine, die denselben Tag
        // mehrfach nennen.
        '/wawi/rezept/articleApi': 'articleApi',
        '/intranet/api/analyticsFilterOptions': 'analyticsFilterOptions',
        '/wawi/api/items': 'wawiItems',
        '/wawi/api/suppliers': 'wawiSuppliers',
        '/wawi/api/units': 'wawiUnits',
        '/wawi/api/orders': 'wawiOrders',
        '/wawi/inventory/inventory': 'wawiInventory',
      }
      const name = map[pfad]
      if (!name) return new Response('nicht gefunden', { status: 404 })

      // Momentaufnahmen dürfen KEINE Datumsparameter bekommen. Die Attrappe
      // lehnt das ab, statt es zu schlucken: LINA kennt hier keinen Zeitraum,
      // und ein Backfill über diese Endpunkte wäre ein teurer Denkfehler.
      if (pfad.startsWith('/wawi/') || pfad === '/intranet/api/analyticsFilterOptions') {
        if (url.searchParams.has('von') || url.searchParams.has('bis')
            || url.searchParams.has('reltime')) {
          return new Response('Momentaufnahmen kennen keinen Zeitraum', { status: 400 })
        }
      }

      zaehler[name] = (zaehler[name] ?? 0) + 1

      if (opt.keineDatenFuer?.includes(name)) {
        // Der Phase-1-Sonderfall: 500 mit leerem Body ist KEIN Fehler.
        return new Response('', { status: 500 })
      }
      return Response.json(fixture(name))
    },
  })

  return {
    url: `http://localhost:${server.port}`,
    zaehler,
    /** Wie oft angemeldet wurde. Der Test prüft damit auf Login-Schleifen. */
    get anmeldungen() { return anmeldungen },
    /** Wie oft die Attrappe gesperrt geantwortet hat. Erwartung nach einer Sperre: 1. */
    get gesperrteAufrufe() { return gesperrteAufrufe },
    /** Header des letzten Aufrufs — damit prüfbar ist, wie wir uns ausgeben. */
    get letzteHeader() { return letzteHeader },
    /** Die `laden`-Werte aller Betriebsbericht-Aufrufe, in Reihenfolge. */
    get ladenGesehen() { return ladenGesehen },
    sessionErzwingenAblaufen: () => { abgelaufen = true },
    /**
     * Belege in LINA „löschen" — die letzten `anzahl` eines Ordners
     * verschwinden aus Liste UND Zählung. `0` macht es rückgängig.
     */
    belegeLoeschen: (typId: string, anzahl: number) => { geloescht[typId] = anzahl },
    stop: () => server.stop(true),
  }
}
