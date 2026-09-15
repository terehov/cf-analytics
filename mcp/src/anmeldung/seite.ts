/**
 * Die Anmeldeseite.
 *
 * Das einzige Stueck Oberflaeche, das dieser Server einem Menschen zeigt.
 * Bewusst eine einzelne HTML-Seite ohne Skript und ohne Abhaengigkeit: sie
 * nimmt zwei Felder entgegen und schickt sie ab. Was hier an Bibliothek
 * hinzukaeme, waere Angriffsflaeche fuer nichts.
 */

const fluchten = (s: string) =>
  s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function anmeldeseite(o: {
  formulartoken: string
  clientName: string | null
  fehler?: string | null
  email?: string | null
}): string {
  const fehler = o.fehler
    ? `<p class="fehler" role="alert">${fluchten(o.fehler)}</p>`
    : ''
  const wer = o.clientName
    ? `<p class="wer">${fluchten(o.clientName)} moechte auf die Auswertungen zugreifen.</p>`
    : ''

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Anmeldung — Concept Family Analytics</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 15px/1.5 system-ui, -apple-system, sans-serif;
         background: Canvas; color: CanvasText; padding: 24px; }
  main { width: 100%; max-width: 22rem; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .wer { margin: 0 0 1.5rem; opacity: .75; font-size: .9rem; }
  label { display: block; font-size: .85rem; margin-bottom: .3rem; opacity: .85; }
  input { width: 100%; box-sizing: border-box; padding: .6rem .7rem; font: inherit;
          border: 1px solid color-mix(in srgb, CanvasText 30%, transparent);
          border-radius: 6px; background: Canvas; color: CanvasText; margin-bottom: 1rem; }
  input:focus { outline: 2px solid Highlight; outline-offset: 1px; }
  button { width: 100%; padding: .65rem; font: inherit; font-weight: 600; cursor: pointer;
           border: 0; border-radius: 6px; background: CanvasText; color: Canvas; }
  .fehler { background: color-mix(in srgb, #c82828 12%, transparent);
            border-left: 3px solid #c82828; padding: .6rem .7rem; border-radius: 4px;
            margin: 0 0 1rem; font-size: .9rem; }
  footer { margin-top: 1.5rem; font-size: .78rem; opacity: .6; }
</style>
</head>
<body>
<main>
  <h1>Concept Family Analytics</h1>
  ${wer}
  ${fehler}
  <form method="post" action="/anmelden" autocomplete="on">
    <input type="hidden" name="anfrage" value="${fluchten(o.formulartoken)}">
    <label for="email">E-Mail</label>
    <input id="email" name="email" type="email" required autofocus
           autocomplete="username" value="${fluchten(o.email ?? '')}">
    <label for="passwort">Passwort</label>
    <input id="passwort" name="passwort" type="password" required
           autocomplete="current-password">
    <button type="submit">Anmelden</button>
  </form>
  <footer>Zugang nur fuer freigeschaltete Konten. Jede Anmeldung wird protokolliert.</footer>
</main>
</body>
</html>`
}

/** Eine schlichte Seite fuer Faelle, in denen es nicht weitergeht. */
export function fehlerseite(titel: string, text: string): string {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fluchten(titel)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         font:15px/1.6 system-ui,sans-serif; background:Canvas; color:CanvasText; }
  main { max-width: 30rem; }
  h1 { font-size:1.1rem; margin:0 0 .5rem; }
  p { margin:0; opacity:.85; }
</style></head>
<body><main><h1>${fluchten(titel)}</h1><p>${fluchten(text)}</p></main></body></html>`
}
