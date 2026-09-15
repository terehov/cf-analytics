/**
 * Tests für den Rezeptabzug.
 *
 * Geprüft wird, was ohne FoodNotify prüfbar ist und still falsch werden
 * könnte: dass nur freigegebene GETs hinausgehen, dass keine Seite verloren
 * geht (der Fehler von Wilma Wunder und den Inventurpositionen), dass eine
 * Sperre den Lauf beendet statt ihn weiterlaufen zu lassen, dass die
 * Kassenzuordnung beim richtigen Rezept landet, dass verwiesene Rezepte ohne
 * Listeneintrag gefunden werden — und dass das Session-Cookie nicht mit einem
 * Bild zu einem fremden Speicher reist.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { FnSession } from './foodnotify/auth'
import {
  Abbruch, alleSeiten, argumente, bildBasis, bildEndung, bildFreigegeben, bildquellen,
  fehlendeVerweise, FnLeser, gesamtSeiten, HttpFehler, kassenzuordnung, pfadFreigegeben,
  rezeptDateiname, vollstaendig, zeilen, type Kassenartikel, type Leser,
} from './rezepte'

describe('Freigabe', () => {
  test('lässt die Pfade des Abzugs durch', () => {
    for (const p of [
      '/api/recipes?page=3', '/api/recipes/4711', '/api/recipes/4711/ingredients',
      '/api/recipes/4711/meta', '/api/recipes/4711/steps', '/api/recipes/4711/ingredients?page=2',
      '/api/pos/locations', '/api/pos/mapping/1095/articles', '/api/pos/mapping/1095/articles?page=2',
    ]) expect(() => pfadFreigegeben(p)).not.toThrow()
  })

  test('sperrt alles andere', () => {
    for (const p of [
      '/api/recipes/batch', '/api/recipes/tags', '/api/recipes/4711/delete', '/api/pos/mapping/1095/suggest',
      '/api/recipes/../user', '/api/recipes/4711?page=1&x=1', '/api/profile',
    ]) expect(() => pfadFreigegeben(p)).toThrow()
  })

  test('Bildadressen: nur http(s), auf FoodNotify nichts zum Löschen oder Konto', () => {
    const fn = (p: string) => new URL(p, 'https://my.foodnotify.com')
    expect(() => bildFreigegeben(fn('/i/r/34f0c12c.png'), true)).not.toThrow()
    expect(() => bildFreigegeben(new URL('https://bucket.s3.amazonaws.com/delete/x.jpg'), false)).not.toThrow()
    expect(() => bildFreigegeben(fn('/api/recipes/4711/image/delete'), true)).toThrow()
    expect(() => bildFreigegeben(fn('/api/user/logout'), true)).toThrow()
    expect(() => bildFreigegeben(new URL('file:///etc/passwd'), false)).toThrow()
  })
})

describe('Hüllen und Seiten', () => {
  const rezeptSeite = (n: number, von: number) => ({
    data: [{ id: n * 10 + 1 }, { id: n * 10 + 2 }],
    pagination: { currentPage: n, perPage: 25, totalItems: 6, totalPages: von },
  })

  test('liest die Seitenzahl aus der recipes-Hülle', () => {
    expect(gesamtSeiten(rezeptSeite(1, 3))).toBe(3)
    expect(zeilen(rezeptSeite(1, 3))).toHaveLength(2)
  })

  test('liest {items, pagination}, die Form des POS-Mappings', () => {
    const roh = { items: [{ plu: '1' }], pagination: { totalPages: 2 } }
    expect(gesamtSeiten(roh)).toBe(2)
    expect(zeilen(roh)).toEqual([{ plu: '1' }])
  })

  test('findet die Standorte in der erp-Hülle', () => {
    const roh = { errors: [], code: 200, isError: false, payload: { userId: 1, locations: [{ restaurantId: 10399 }] } }
    expect(zeilen(roh)).toEqual([{ restaurantId: 10399 }])
    expect(gesamtSeiten(roh)).toBe(1)
  })

  /*
   * DER TEURE FALL. Wer nur Seite 1 holt, bekommt eine Antwort, die nach
   * „vollständig" aussieht — bei den Inventurpositionen fehlten so 936 Zeilen.
   */
  test('alleSeiten holt jede Seite und setzt sie zusammen', async () => {
    const geholt: string[] = []
    const leser: Leser = {
      async json(pfad) {
        geholt.push(pfad)
        const s = Number(new URL(pfad, 'https://x').searchParams.get('page') ?? 1)
        return rezeptSeite(s, 3)
      },
    }
    const alle = await alleSeiten(leser, '/api/recipes/4711/ingredients')
    expect(geholt).toEqual([
      '/api/recipes/4711/ingredients', '/api/recipes/4711/ingredients?page=2', '/api/recipes/4711/ingredients?page=3',
    ])
    expect(alle).toHaveLength(6)
  })

  test('ein einzelnes Objekt bleibt ein Objekt', async () => {
    const leser: Leser = { async json() { return { data: { id: 4711, weight: 350 } } } }
    expect(await alleSeiten(leser, '/api/recipes/4711/meta')).toEqual({ id: 4711, weight: 350 })
  })
})

describe('Bilder finden', () => {
  test('findet die gemessenen Fundstellen: imagePath und Schrittfotos', () => {
    const q = bildquellen({
      liste: { id: 1, imagePath: '/i/r/aaa.png' },
      kopf: { id: 1, imagePath: '/i/r/aaa.png' },
      schritte: [{ id: 7, images: [{ id: 67210, url: '/i/rs/bbb.jpg' }, { id: 67211, url: '/i/rs/ccc.jpg' }] }],
    })
    expect(q).toEqual([
      { fundstelle: 'liste.imagePath', url: '/i/r/aaa.png' },
      { fundstelle: 'schritte[0].images[0].url', url: '/i/rs/bbb.jpg' },
      { fundstelle: 'schritte[0].images[1].url', url: '/i/rs/ccc.jpg' },
    ])
  })

  test('findet auch verschachtelte Bildobjekte', () => {
    const q = bildquellen({
      kopf: { imageId: 99, media: [{ type: 'image', url: 'https://cdn.example/1.png' }] },
      schritte: [{ picture: { src: 'https://cdn.example/s1.webp' } }],
    })
    expect(q.map(b => b.fundstelle)).toEqual(['kopf.media[0].url', 'schritte[0].picture.src'])
  })

  test('Vorschaubilder zählen nur ohne großes Bild', () => {
    expect(bildquellen({ liste: { image: 'https://c/1.jpg', thumbnail: 'https://c/1-t.jpg' } }).map(b => b.url))
      .toEqual(['https://c/1.jpg'])
    expect(bildquellen({ liste: { thumbnail: 'https://c/1-t.jpg' } }).map(b => b.url)).toEqual(['https://c/1-t.jpg'])
  })

  test('Zahlen, Typangaben und Texte sind keine Bilder', () => {
    expect(bildquellen({ kopf: { imageId: 5, mediaType: 'image/jpeg', hasImage: true, name: 'https://c/x.jpg' } }))
      .toEqual([])
  })

  /*
   * `<id>.jpg` ist immer das Rezeptbild. Hat ein Rezept keins, darf das erste
   * Schrittfoto nicht diesen Namen bekommen.
   */
  test('Dateiname: Rezeptbild als ID, Schrittfotos mit Schritt, Endung aus dem Typ', () => {
    expect(bildBasis('4711', 'liste.imagePath', 0)).toBe('4711')
    expect(bildBasis('4711', 'kopf.imagePath', 1)).toBe('4711_2')
    expect(bildBasis('4711', 'schritte[0].images[0].url', 0)).toBe('4711_schritt1_1')
    expect(bildBasis('4711', 'schritte[2].images[1].url', 1)).toBe('4711_schritt3_2')
    expect(bildBasis('4711', 'schritte[4].picture.src', 0)).toBe('4711_schritt5_1')
    expect(bildEndung('image/jpeg', 'https://c/x')).toBe('jpg')
    expect(bildEndung('application/octet-stream', 'https://c/x.PNG?v=2')).toBe('png')
    expect(bildEndung('', 'https://c/x')).toBe('bin')
  })

  /*
   * Rezepte aus dem ersten Lauf tragen noch kein `bilder`. Sie gelten nicht
   * als fertig — sonst bekämen genau sie nie ein Bild.
   */
  test('fertig erst mit bilder und allen Bilddateien', () => {
    const da = new Set(['4711.jpg'])
    expect(vollstaendig({ id: 4711 }, da)).toBe(false)
    expect(vollstaendig({ bilder: [] }, da)).toBe(true)
    expect(vollstaendig({ bilder: [{ datei: 'img/4711.jpg' }] }, da)).toBe(true)
    expect(vollstaendig({ bilder: [{ datei: 'img/4711.jpg' }, { datei: 'img/4711_2.png' }] }, da)).toBe(false)
    expect(vollstaendig({ bilder: [{ fehler: 'HTTP 404' }] }, da)).toBe(false)
  })
})

describe('Nachholen', () => {
  /*
   * Der Befund vom 14.09.2026: die Liste verrutscht beim Blättern, und 52 IDs,
   * auf die Unterrezepte oder Kassenartikel zeigen, stehen nicht darin.
   */
  test('findet Unterrezepte und Kassenrezepte, die nicht in der Liste stehen', () => {
    const rezepte = [
      { id: 1, zutaten: [{ subRecipeId: 2 }, { subRecipeId: 99 }, { subRecipeId: null }] },
      { id: 3, zutaten: [{ subRecipeId: 99 }, { subRecipeId: 98 }] },
    ]
    const kasse = [{ plu: '715003', name: 'Don Julio', recipeId: 97 }, { plu: '1', name: 'Kölsch', recipeId: 2 }, { plu: '2', recipeId: null }]
    const m = fehlendeVerweise(rezepte, kasse, new Set(['1', '2', '3']))
    expect([...m.keys()].sort()).toEqual(['97', '98', '99'])
    expect(m.get('99')).toEqual({ unterrezept_in: [1, 3], kasse: [] })
    expect(m.get('97')).toEqual({ unterrezept_in: [], kasse: [{ plu: '715003', name: 'Don Julio' }] })
  })

  test('ein Rezept, das mehrfach auf dasselbe zeigt, steht einmal da', () => {
    const m = fehlendeVerweise([{ id: 1, zutaten: [{ subRecipeId: 9 }, { subRecipeId: 9 }] }], [], new Set())
    expect(m.get('9')?.unterrezept_in).toEqual([1])
  })

  test('nichts fehlt, nichts gemeldet', () => {
    expect(fehlendeVerweise([{ id: 1, zutaten: [{ subRecipeId: 2 }] }], [{ recipeId: 1 }], new Set(['1', '2'])).size).toBe(0)
  })
})

describe('Ablage', () => {
  test('Dateiname trägt id und lesbaren Namen ohne Pfadzeichen', () => {
    expect(rezeptDateiname({ id: 4711, name: 'Burrito Chili / scharf' })).toBe('4711__Burrito_Chili_scharf.json')
    expect(rezeptDateiname({ id: 4711, title: 'Salsa' })).toBe('4711__Salsa.json')
    expect(rezeptDateiname({ id: 4711 })).toBe('4711__ohne_namen.json')
  })

  test('ein Rezept ohne id bricht ab, statt eine Datei zu überschreiben', () => {
    expect(() => rezeptDateiname({ name: 'Salsa' })).toThrow()
    expect(() => rezeptDateiname({ id: '../x', name: 'Salsa' })).toThrow()
  })

  test('Kassenartikel landen beim Rezept, Artikel ohne Rezept fallen heraus', () => {
    const a = (plu: string, recipeId: unknown) =>
      ({ connectionId: 1095, kostenstelle: 'Küche', plu, recipeId }) as Kassenartikel
    const m = kassenzuordnung([a('10', 4711), a('11', 4711), a('12', null), a('13', '815')])
    expect(m.get('4711')?.map(x => x.plu)).toEqual(['10', '11'])
    expect(m.get('815')).toHaveLength(1)
    expect(m.size).toBe(2)
  })

  test('Aufruf wird geprüft', () => {
    expect(argumente(['enchilada', '10399', '/tmp/r', '--ziehen'])).toEqual({ marke: 'enchilada', restaurant: 10399, ziel: '/tmp/r' })
    expect(() => argumente(['enchilada', 'Köln', '/tmp/r'])).toThrow()
    expect(() => argumente(['enchilada', '10399'])).toThrow()
  })
})

describe('Sperre', () => {
  let status = 429
  let rumpf = '{"data": []}'
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response(rumpf, { status, headers: { 'content-type': 'application/json' } }),
  })
  afterAll(() => server.stop(true))
  const leser = () => new FnLeser(
    new FnSession({ schluessel: 'enchilada', user: 'x', password: 'x' }), 0, `http://localhost:${server.port}`)

  /*
   * 429 und 403 sind Aussagen über den Zugang. Als Fehlschlag eines Rezepts
   * liefe der Lauf zehnmal dagegen, bevor die Serie greift.
   */
  test('429 und 403 beenden den Lauf sofort', async () => {
    for (const s of [429, 403]) {
      status = s
      await expect(leser().json('/api/recipes?page=1')).rejects.toBeInstanceOf(Abbruch)
    }
  })

  /*
   * Beim Nachholen gilt ein 403 womöglich nur diesem Rezept (fremde Marke).
   * 429 bleibt ein Abbruch — zu schnell ist zu schnell.
   */
  test('beim Einzelabruf ist 403 ein Fehler dieses Rezepts, 429 weiter ein Abbruch', async () => {
    status = 403
    const fehler: any = await leser().json('/api/recipes/4711', false).catch(e => e)
    expect(fehler).toBeInstanceOf(HttpFehler)
    expect(fehler.status).toBe(403)
    status = 429
    await expect(leser().json('/api/recipes/4711', false)).rejects.toBeInstanceOf(Abbruch)
  })

  test('404 kommt mit Status an, damit Nachholen „gelöscht" erkennt', async () => {
    status = 404
    const fehler: any = await leser().json('/api/recipes/983609').catch(e => e)
    expect(fehler).toBeInstanceOf(HttpFehler)
    expect(fehler.status).toBe(404)
  })

  test('ein Hüllenfehler bei HTTP 200 wird nicht als Rezept gespeichert', async () => {
    status = 200
    rumpf = '{"errors":["kaputt"],"code":500,"isError":true,"payload":null}'
    await expect(leser().json('/api/recipes/4711')).rejects.toThrow(/Hüllenfehler/)
  })

  test('ein nicht freigegebener Pfad geht gar nicht erst hinaus', async () => {
    await expect(leser().json('/api/profile')).rejects.toThrow(/nicht freigegeben/)
  })
})

describe('Bilder laden', () => {
  let cookieBeimSpeicher: string | null = 'nicht angefragt'
  const speicher = Bun.serve({
    port: 0,
    fetch(req) {
      cookieBeimSpeicher = req.headers.get('cookie')
      const p = new URL(req.url).pathname
      if (p === '/verboten.png') return new Response('nein', { status: 403 })
      if (p === '/seite') return new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } })
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { 'content-type': 'image/png' } })
    },
  })
  const foodnotify = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname
      if (p === '/media/1.jpg') return Response.redirect(`http://localhost:${speicher.port}/1.png`, 302)
      if (p === '/media/gesperrt.jpg') return new Response('nein', { status: 403 })
      return new Response('fehlt', { status: 404 })
    },
  })
  afterAll(() => { speicher.stop(true); foodnotify.stop(true) })

  const leser = () => {
    const s = new FnSession({ schluessel: 'enchilada', user: 'x', password: 'x' })
    s.cookiesUebernehmen(new Response(null, { headers: { 'set-cookie': 'PHPSESSID=geheim; Path=/' } }))
    return new FnLeser(s, 0, `http://localhost:${foodnotify.port}`)
  }

  test('die Weiterleitung zum Bildspeicher nimmt das Session-Cookie nicht mit', async () => {
    const { bytes, typ } = await leser().bild('/media/1.jpg')
    expect(typ).toBe('image/png')
    expect(bytes.length).toBe(4)
    expect(cookieBeimSpeicher).toBeNull()
  })

  test('eine HTML-Seite mit HTTP 200 wird nicht als Bild gespeichert', async () => {
    await expect(leser().bild(`http://localhost:${speicher.port}/seite`)).rejects.toThrow(/kein Bild/)
  })

  /*
   * Ein einzelnes gesperrtes Bild — beim Speicher oder bei FoodNotify — ist
   * kein gesperrter Zugang. Beendete es den Lauf, bräche jeder neue Start am
   * selben Bild wieder ab.
   */
  test('403 für ein Bild ist ein Fehler dieses Bildes, kein Abbruch', async () => {
    for (const quelle of [`http://localhost:${speicher.port}/verboten.png`, '/media/gesperrt.jpg']) {
      const fehler = await leser().bild(quelle).catch(e => e)
      expect(fehler).toBeInstanceOf(HttpFehler)
      expect(fehler).not.toBeInstanceOf(Abbruch)
    }
  })
})
