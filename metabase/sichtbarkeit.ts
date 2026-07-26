// =====================================================================
// Welche Tabellen Metabase zeigt.
//
// Der Grundsatz aus docs/metabase.md: "Metabase soll nur mart sehen
// muessen." Alles in core ist in mart aufbereitet, und jede core-Tabelle
// birgt mindestens eine stille Falle -- der Umsatzbericht etwa fuehrt
// Gesamt- UND Hauptspartenzeilen in derselben Tabelle, eine Summe darueber
// ergibt den doppelten Umsatz.
//
// WARUM VERSTECKEN UND NICHT AUS DEM SCHEMA-FILTER NEHMEN: core bleibt
// synchronisiert, weil Metabase die Fremdschluessel aus dem Katalog liest
// und daraufhin von selbst Spruenge anbietet (Artikelverkauf -> Betrieb ->
// Artikel). Ohne core waeren diese Beziehungen weg. Versteckt heisst bei
// Metabase visibility_type = 'technical': aus Suche und Abfrage-Editor
// verschwunden, ueber einen Fremdschluessel weiterhin erreichbar.
//
// Ausgefuehrt wird das ueber denselben Proxy wie die Dashboards, aus
// demselben Grund -- siehe Kopf von uebernehmen.ts.
//
//   bun run metabase/sichtbarkeit.ts
//   danach http://localhost:8898/ oeffnen und "Anwenden" klicken
// =====================================================================

const PORT = 8898
const METABASE = 'http://localhost:3000'
const DB_ID = 2

/**
 * Schemata, die vollstaendig sichtbar bleiben.
 *
 *   mart    die Auswertungsschicht -- dafuer ist sie da
 *   manual  das einzige Schema, in das geschrieben wird
 *   ampel   das Regelwerk, bewusst als Daten statt als Code
 */
const SICHTBAR = new Set(['mart', 'manual', 'ampel'])

/**
 * Schemata, die vollstaendig versteckt werden.
 *
 * Seit Migration 0009 (mart.bwa_kennzahl) greift keine der 98 Karten mehr
 * auf core zu. Vorher blieb core.betrieb als Ausnahme sichtbar, weil drei
 * BWA-Karten den Betriebsnamen von dort holten -- das war nach dem
 * Grundsatz keine Ausnahme, sondern eine Luecke in mart.
 */
const VERSTECKT = new Set(['core'])

const SEITE = String.raw`<!doctype html>
<meta charset="utf-8">
<title>Tabellensichtbarkeit</title>
<style>
  body { font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
         max-width: 60rem; margin: 3rem auto; padding: 0 1.5rem;
         color: #2b2b2b; background: #fbfbfa; }
  h1 { font-size: 1.4rem; }
  #log { white-space: pre-wrap; border-left: 3px solid #ddd; padding-left: 1rem; }
  .ok { color: #2d7a2d; } .neu { color: #1a6ba8; } .fehler { color: #b03030; font-weight: bold; }
  button { font: inherit; padding: .6rem 1.2rem; cursor: pointer; }
</style>
<h1>Tabellensichtbarkeit setzen</h1>
<p><code>mart</code>, <code>manual</code> und <code>ampel</code> sichtbar · <code>core</code>
   nur in Detailansichten. Ein zweiter Lauf ändert nichts, was schon stimmt.</p>
<button id="los">Anwenden</button>
<pre id="log"></pre>
<script>
const log = (t, k='') => {
  const s = document.createElement('span');
  s.className = k; s.textContent = t + '\n';
  document.getElementById('log').append(s);
};

document.getElementById('los').onclick = async () => {
  document.getElementById('los').disabled = true;
  try {
    const cfg = await (await fetch('/regeln.json')).json();
    const md = await (await fetch('/api/database/' + cfg.db_id + '/metadata?include_hidden=true')).json();
    const tabellen = md.tables || [];
    log(tabellen.length + ' Tabellen im Katalog\n');

    let geaendert = 0, unveraendert = 0;
    const zusammenfassung = {};

    for (const t of tabellen) {
      const ziel = cfg.versteckt.includes(t.schema) ? 'technical' : null;
      const ist = t.visibility_type || null;
      zusammenfassung[t.schema] = zusammenfassung[t.schema] || {sichtbar: 0, versteckt: 0};
      zusammenfassung[t.schema][ziel ? 'versteckt' : 'sichtbar']++;

      if (ist === ziel) { unveraendert++; continue; }
      const r = await fetch('/api/table/' + t.id, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({visibility_type: ziel}),
      });
      if (r.ok) { geaendert++; log('  ' + t.schema + '.' + t.name + ' → ' + (ziel || 'sichtbar'), 'neu'); }
      else { log('  ' + t.schema + '.' + t.name + ' FEHLER ' + r.status, 'fehler'); }
    }

    log('\n' + geaendert + ' geändert, ' + unveraendert + ' schon richtig\n');
    for (const [schema, z] of Object.entries(zusammenfassung)) {
      log('  ' + schema.padEnd(8) + ' ' + z.sichtbar + ' sichtbar, ' + z.versteckt + ' versteckt', 'ok');
    }
    log('\nFertig.');
  } catch (e) { log('ABBRUCH: ' + e.message, 'fehler'); }
};
</script>`

const server = Bun.serve({
  port: PORT,
  hostname: 'localhost',
  idleTimeout: 240,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/') {
      return new Response(SEITE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname === '/regeln.json') {
      return new Response(JSON.stringify({
        db_id: DB_ID,
        sichtbar: [...SICHTBAR],
        versteckt: [...VERSTECKT],
      }), { headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname.startsWith('/api/')) {
      const kopf = new Headers(req.headers)
      kopf.set('host', 'localhost:3000')
      kopf.delete('origin'); kopf.delete('referer')
      const antwort = await fetch(METABASE + url.pathname + url.search, {
        method: req.method,
        headers: kopf,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
        redirect: 'manual',
      })
      const raus = new Headers(antwort.headers)
      raus.delete('content-security-policy')
      raus.delete('content-encoding')
      raus.delete('content-length')
      return new Response(await antwort.arrayBuffer(), { status: antwort.status, headers: raus })
    }
    return new Response('nichts hier', { status: 404 })
  },
})

console.log(`Bereit auf http://localhost:${server.port}/`)
console.log(`  sichtbar: ${[...SICHTBAR].join(', ')}`)
console.log(`  versteckt: ${[...VERSTECKT].join(', ')}`)
