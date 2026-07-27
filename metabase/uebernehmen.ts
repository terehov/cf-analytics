// =====================================================================
// Traegt die Definitionen in Metabase ein.
//
// Der Umweg ueber einen Proxy hat einen Grund. Metabase schickt
//   Content-Security-Policy: ... connect-src 'self' ...
// mit, seine eigene Seite darf also keine Anfragen nach aussen stellen.
// Ein Skript, das im Metabase-Tab laeuft, kann die Definitionen nicht
// abholen.
//
// Umgekehrt geht es: dieser Server liefert unter / eine Seite aus, die
// alles erledigt, und reicht /api/* an Metabase weiter. Fuer die Seite ist
// das gleichursprünglich, also weder CSP noch CORS im Weg. Die Anmeldung
// kommt vom Browser selbst — Cookies gelten je Host und ignorieren den
// Port, das Sitzungs-Cookie fuer localhost geht deshalb auch an :8899 und
// wird von hier unveraendert weitergereicht. Es wird nirgends gespeichert.
//
//   bun run metabase/uebernehmen.ts
//   danach im Browser http://localhost:8899/ oeffnen
//
// Ein zweiter Lauf legt nichts doppelt an: jede Karte und jedes Dashboard
// traegt seinen Schluessel als [key:...] in der Beschreibung, und danach
// wird zuerst gesucht.
// =====================================================================

import { karten as kartenRoundTable } from './karten-round-table'
import { karten as kartenFach } from './karten-fach'
import { karten as kartenDrilldown } from './karten-drilldown'
import { karten as kartenPortfolio } from './karten-portfolio'
import { karten as kartenImport } from './karten-import'
import { karten as kartenStandort } from './karten-standort'
import { dashboards } from './dashboards'
import { auslegen, MINDESTHOEHE } from './layout'
import type { Karte, Kachel } from './typen'

const DB_ID = 2
const PORT = 8899
const METABASE = 'http://localhost:3000'

const alleKarten: Karte[] = [
  ...kartenDrilldown, ...kartenPortfolio, ...kartenRoundTable, ...kartenFach, ...kartenImport, ...kartenStandort,
]

// Reihen in Kacheln umrechnen — EINMAL, damit Pruefung und Ausgabe
// dieselben Zahlen sehen.
const typVon = (s: string) => alleKarten.find(k => k.schluessel === s)?.anzeige
const layoutVon = new Map<string, Kachel[]>(
  dashboards.map(d => [d.schluessel, auslegen(d.reihen, typVon)]))

// --- Plausibilitaet, bevor irgendetwas angelegt wird -------------------
const gesehen = new Set<string>()
for (const k of alleKarten) {
  if (gesehen.has(k.schluessel)) throw new Error(`Doppelter Kartenschluessel: ${k.schluessel}`)
  gesehen.add(k.schluessel)
}
for (const d of dashboards) {
  for (const r of d.reihen) {
    for (const teil of r.teile) {
      if (teil.text === undefined && !gesehen.has(teil.karte!)) {
        throw new Error(`Dashboard ${d.schluessel} verweist auf unbekannte Karte: ${teil.karte}`)
      }
    }
  }
}

// ---------------------------------------------------------------------
// Filterpruefung.
//
// Am 27.07.2026 gemeldet: "Der Markenfilter im Round Table tut nichts."
// Nachgemessen: 10 von 11 Karten dieser Seite lasen ihn nicht. Der Filter
// stand oben, liess sich bedienen, und zehn Kacheln blieben stehen.
//
// Das ist die gefaehrlichste Sorte Fehler, die dieses System kennt --
// gefaehrlicher als eine Fehlermeldung: Wer "Enchilada" waehlt und eine
// Zahl abliest, haelt sie fuer die Zahl dieser Marke. Sie ist die Zahl
// aller Betriebe. Nichts daran sieht falsch aus.
//
// Zwei Richtungen, beide sind Fehler:
//   TOT   Kein einziges Kartenfeld liest den Filter -> er tut gar nichts.
//   TAUB  Nur ein Teil der Karten liest ihn -> die Seite antwortet
//         halb. Das ist schlimmer als tot, weil es funktioniert aussieht.
//
// Ausnahmen gehoeren dokumentiert, nicht stillschweigend geduldet:
// FILTER_AUSNAHME nennt Karte und Grund.
// ---------------------------------------------------------------------

/**
 * Karten, die einen Filter ihres Dashboards bewusst NICHT lesen.
 * Jeder Eintrag braucht einen fachlichen Grund.
 */
const FILTER_AUSNAHME: Record<string, Record<string, string>> = {
  // --- Zeitreihen: der Monatsfilter waehlt einen Stichmonat, und genau den
  // --- darf eine Verlaufskurve nicht haben. Sonst bleibt ein Punkt uebrig.
  dd_marken_verlauf:      { monat: 'Verlauf ueber alle Monate — ein Stichmonat ergaebe einen Punkt.' },
  pf_marken_umsatzanteil: { monat: 'Verlauf ueber alle Monate.' },
  dd_betrieb_verlauf:     { monat: 'Verlauf ueber alle Monate.' },
  dd_betrieb_ampelverlauf:{ monat: 'Verlauf ueber alle Monate.' },
  dd_betrieb_sparte:      { monat: 'Verlauf ueber alle Monate.' },
  vg_ort_umsatz:          { monat: 'Verlauf ueber alle Monate.' },
  rt_historie:            { monat: 'Die Ampelhistorie IST der Verlauf ueber alle Monate.' },
  rt_historie_bereich:    { monat: 'Historie je Bereich ueber alle Monate.' },
  rt_ursachen_verlauf:    { monat: 'Ursachen im Zeitverlauf — ueber alle Monate.',
                            marke: 'mart.ursachen_analyse ist ueber alle Betriebe verdichtet '
                                 + 'und fuehrt keine Marke.' },
  um_verlauf_tag:         { monat: 'Tagesverlauf; eingegrenzt wird ueber den Zeitraumfilter.' },
  um_verlauf_monat:       { monat: 'Monatsverlauf mit Vorjahr — ueber alle Monate.',
                            zeitraum: 'Aggregiert je Monat, nicht je Tag.' },
  um_verlauf_delta:       { monat: 'Monatsverlauf — ueber alle Monate.',
                            zeitraum: 'Aggregiert je Monat, nicht je Tag.' },
  pe_verlauf:             { monat: 'Quotenverlauf ueber alle Monate.' },
  bwa_kennzahlen:         { monat: 'BWA-Verlauf ueber alle gebuchten Monate.' },
  im_puls:                { monat: 'Puls der letzten drei Tage, fest gefenstert.' },

  // --- Kacheln des laufenden Monats: bewusst "jetzt", nicht "gewaehlter Monat".
  um_kachel_monat:  { monat: 'Kachel zeigt ausdruecklich den LAUFENDEN Monat.',
                      zeitraum: 'ebenso.' },
  um_kachel_gaeste: { monat: 'Kachel zeigt ausdruecklich den LAUFENDEN Monat.',
                      zeitraum: 'ebenso.' },
  um_kachel_bon:    { monat: 'Kachel zeigt ausdruecklich den LAUFENDEN Monat.',
                      zeitraum: 'ebenso.' },
  pf_kachel_aktiv:  { monat: 'Zaehlt Betriebe mit Umsatz ueber die GESAMTE Historie — '
                           + 'ein Monatsfilter wuerde die Aussage veraendern.' },

  // --- Bestandsaufnahmen ueber die ganze Historie ---------------------------
  pf_konzentration:       { monat: 'Umsatzkonzentration ueber die gesamte Historie.' },
  pf_konzentration_kurve: { monat: 'ebenso.' },
  pf_karteileichen:       { monat: 'Betriebe OHNE jeden Umsatz — ueber die gesamte Historie, '
                                 + 'sonst zaehlte ein einzelner leerer Monat mit.' },
  pf_wochentag_marke:     { betrieb: 'Vergleicht MARKEN, nicht Betriebe.' },
  pf_gaeste_bon:          { betrieb: 'Vergleicht Betriebe untereinander — ein Betriebsfilter '
                                   + 'liesse genau einen Punkt uebrig.' },
  pf_stabilitaet:         { betrieb: 'Rangliste ueber alle Betriebe.' },
  um_wochentag:           { monat: 'Wochenrhythmus ueber die gesamte Historie.',
                            zeitraum: 'ebenso.' },
  um_bon_gast:            { monat: 'Monatsverlauf von Bon und Umsatz je Gast — ueber alle Monate.',
                            zeitraum: 'Aggregiert je Monat, nicht je Tag.' },
  um_rangliste:           { zeitraum: 'Rangliste zum Stichmonat, nicht zum Tageszeitraum.' },
  st_sparte:              { monat: 'Verlauf ueber alle Monate.' },
  st_verkaufsstelle:      { monat: 'Verlauf ueber alle Monate.' },
  st_stunde:              { monat: 'Tagesprofil ueber die gesamte Historie.' },
  st_zeitzone:            { monat: 'Tagesprofil ueber die gesamte Historie.' },
  pe_bereich:             { monat: 'Alle Zeitraeume je Betrieb, absichtlich ungefiltert.' },
  pe_effektivitaet:       { monat: 'Alle Zeitraeume je Betrieb, absichtlich ungefiltert.' },
  vg_ort_profil:          { monat: 'Tagesprofil ueber die gesamte Historie.' },
  dd_betrieb_zeitzone:    { monat: 'Tagesprofil ueber die gesamte Historie.' },
  dd_betrieb_stunde:      { monat: 'Tagesprofil ueber die gesamte Historie.' },
  dd_betrieb_personal:    { monat: 'Alle Zeitraeume dieses Betriebs.' },
  dd_betrieb_bwa:         { monat: 'BWA-Verlauf ueber alle gebuchten Monate.' },
  dd_betrieb_massnahmen:  { monat: 'Offene Massnahmen unabhaengig vom Stichmonat.' },
  dd_betrieb_datenstand:  { monat: 'Datenstand ist der Stand JETZT, kein Monatswert.' },
  bwa_buchungsstand:      { monat: 'Buchungsstand ist der Stand JETZT, kein Monatswert.' },
  rt_massnahmen_offen:    { monat: 'Offene Massnahmen unabhaengig vom Stichmonat.' },
  rt_massnahmen_status:   { monat: 'Verteilung ueber alle Massnahmen.' },
  wa_we_pruefung:         { zeitraum: 'Vergleich je Monat gegen die BWA, nicht je Tag.' },

  dd_filialen_metrikvergleich: {
    ampel: 'Zaehlt Ampeln JE BEREICH (Umsatz, Personal, WE Bar ...). Ein Filter auf '
         + 'die Gesamtampel waere zirkulaer: die Karte soll ja zeigen, woraus sich '
         + 'das Gesamturteil zusammensetzt.',
  },

  // --- Strukturell ohne die Dimension --------------------------------------
  so_fehlend: {
    monat: 'Wer gar keine Koordinaten hat, fehlt in JEDEM Monat — die Liste ist '
         + 'zeitlos und wuerde durch einen Monatsfilter nur scheinbar kleiner.',
    marke: 'Bewusst ueber alle Marken: die Liste ist eine Arbeitsvorlage zum '
         + 'Nachtragen der Adressen, und die soll vollstaendig bleiben.',
  },
  wa_preise: {
    betrieb: 'Einkaufspreise gelten je Lieferant fuer die Gruppe, nicht je Betrieb — '
           + 'mart.preisentwicklung_ware hat gar keine Betriebsspalte.',
    zeitraum: 'Preise liegen nur je Monat vor; ein Tageszeitraum waere irrefuehrend.',
  },
  dq_backfill: { betrieb: 'Importfortschritt je Endpunkt, nicht je Betrieb.' },
  im_bericht:  { betrieb: 'Importzustand je Bericht, nicht je Betrieb.' },
}

/** Welche Variablen eine Karte tatsaechlich liest — inklusive der aus den
 *  gemeinsamen CTE-Bausteinen geerbten. Genau die wurden bei der ersten
 *  Pruefung uebersehen, weshalb `monat` faelschlich ueberall als tot galt. */
function variablenVon(karte: Karte): Set<string> {
  const v = new Set<string>()
  for (const m of karte.sql.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) v.add(m[1]!)
  return v
}

const filterFehler: string[] = []
for (const d of dashboards) {
  const karten = d.reihen.flatMap(r => r.teile)
    .filter(t => t.text === undefined)
    .map(t => alleKarten.find(k => k.schluessel === t.karte)!)
  if (karten.length === 0) continue

  for (const f of d.filter ?? []) {
    const slug = f.name
    const liest = karten.filter(k => variablenVon(k).has(slug))
    const taub = karten.filter(k => !variablenVon(k).has(slug)
                                 && !FILTER_AUSNAHME[k.schluessel]?.[slug])

    if (liest.length === 0) {
      filterFehler.push(
        `${d.schluessel}: Filter "${slug}" ist TOT — keine der ${karten.length} Karten liest ihn.`)
    } else if (taub.length > 0) {
      filterFehler.push(
        `${d.schluessel}: Filter "${slug}" wirkt nur auf ${liest.length} von ${karten.length} Karten. ` +
        `Ohne Wirkung: ${taub.map(k => k.schluessel).join(', ')}. ` +
        `Entweder Klausel ergaenzen oder in FILTER_AUSNAHME begruenden.`)
    }
  }
}
if (filterFehler.length > 0) {
  throw new Error('Filter ohne Wirkung:\n  ' + filterFehler.join('\n  '))
}

// ---------------------------------------------------------------------
// Klickpruefung: fuehrt jeder Drill-Down irgendwohin, wo der uebergebene
// Wert auch ankommt?
//
// Ein Klick, dessen Ziel den Parameter nicht kennt, oeffnet das
// Zieldashboard UNGEFILTERT. Man landet auf "③ Betrieb" und sieht
// irgendeinen Betrieb -- meist den zuletzt gewaehlten. Das ist schlimmer
// als ein toter Klick, weil man die falsche Zeile fuer die richtige haelt.
// ---------------------------------------------------------------------
const klickFehler: string[] = []
for (const d of dashboards) {
  for (const r of d.reihen) {
    for (const teil of r.teile) {
      for (const k of teil.klick ?? []) {
        const ziel = dashboards.find(x => x.schluessel === k.ziel)
        if (!ziel) {
          klickFehler.push(`${d.schluessel}/${teil.karte}: Klickziel "${k.ziel}" gibt es nicht.`)
          continue
        }
        for (const slug of Object.keys(k.uebergabe)) {
          if (!(ziel.filter ?? []).some(f => f.name === slug)) {
            klickFehler.push(
              `${d.schluessel}/${teil.karte}: uebergibt "${slug}" an ${k.ziel}, ` +
              `aber dort gibt es diesen Filter nicht — der Klick landet ungefiltert.`)
          }
        }
      }
    }
  }
}
if (klickFehler.length > 0) {
  throw new Error('Drill-Down ohne Wirkung:\n  ' + klickFehler.join('\n  '))
}

// ---------------------------------------------------------------------
// Layoutpruefung.
//
// Metabase nimmt ueberlappende Kacheln klaglos entgegen und schiebt sie
// beim Rendern uebereinander — der Fehler faellt erst im Browser auf, und
// dort sieht er aus wie ein Darstellungsproblem statt wie eine falsche
// Zahl in der Definition. Deshalb hier, wo er noch billig ist.
//
// Ebenso die Mindesthoehen: eine Tabelle auf vier Rastereinheiten zeigt
// Kopfzeile und zwei Datenzeilen, den Rest schneidet sie ab.
// ---------------------------------------------------------------------
for (const d of dashboards) {
  const belegt = layoutVon.get(d.schluessel)!.map(k => ({
    name: k.text !== undefined ? 'Text' : k.karte,
    x: k.x, y: k.y, b: k.breite, h: k.hoehe,
  }))

  for (const k of belegt) {
    if (k.x + k.b > 24) {
      throw new Error(`${d.schluessel}: Kachel ${k.name} ragt aus dem Raster (x=${k.x} + breite=${k.b} > 24)`)
    }
  }

  for (let i = 0; i < belegt.length; i++) {
    for (let j = i + 1; j < belegt.length; j++) {
      const a = belegt[i]!, b = belegt[j]!
      if (a.x < b.x + b.b && b.x < a.x + a.b && a.y < b.y + b.h && b.y < a.y + a.h) {
        throw new Error(
          `${d.schluessel}: ${a.name} und ${b.name} ueberlappen sich ` +
          `(${a.x},${a.y} ${a.b}x${a.h} gegen ${b.x},${b.y} ${b.b}x${b.h})`)
      }
    }
  }

  for (const k of layoutVon.get(d.schluessel)!) {
    if (k.text !== undefined) continue
    const typ = typVon(k.karte) ?? 'bar'
    const noetig = MINDESTHOEHE[typ] ?? 8
    if (k.hoehe < noetig) {
      throw new Error(
        `${d.schluessel}: Kachel ${k.karte} ist zu niedrig (hoehe=${k.hoehe}, ` +
        `noetig fuer ${typ}: ${noetig})`)
    }
  }
}

function templateTags(karte: Karte) {
  const tags: Record<string, unknown> = {}
  const namen = new Set<string>()
  for (const t of karte.sql.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) namen.add(t[1]!)

  for (const name of namen) {
    const p = karte.parameter?.find(x => x.name === name)
    const dim = karte.template_tag_dimension?.[name]
    if (dim) {
      tags[name] = {
        id: `tag-${karte.schluessel}-${name}`,
        name,
        'display-name': p?.['display-name'] ?? name,
        type: 'dimension',
        'widget-type': 'date/all-options',
        // Platzhalter, wird in der Seite gegen die echte Feld-ID getauscht.
        dimension: ['field', { __feld: dim }, null],
        default: null,
      }
    } else {
      tags[name] = {
        id: `tag-${karte.schluessel}-${name}`,
        name,
        'display-name': p?.['display-name'] ?? name,
        type: p?.type?.startsWith('date') ? 'date' : 'text',
        required: p?.required ?? false,
        default: p?.default ?? null,
      }
    }
  }
  return tags
}

const definitionen = {
  db_id: DB_ID,
  karten: alleKarten.map(karte => ({
    schluessel: karte.schluessel,
    hat_feldfilter: !!karte.template_tag_dimension,
    payload: {
      name: karte.name,
      description: `${karte.beschreibung}\n\n[key:${karte.schluessel}]`,
      display: karte.anzeige,
      visualization_settings: karte.visualisierung ?? {},
      dataset_query: {
        type: 'native',
        database: DB_ID,
        native: { query: karte.sql.trim(), 'template-tags': templateTags(karte) },
      },
      parameters: (karte.parameter ?? []).map(p => ({
        id: p.id,
        name: p.name,
        slug: p.name,
        type: p.type,
        target: karte.template_tag_dimension?.[p.name]
          ? ['dimension', ['template-tag', p.name]]
          : ['variable', ['template-tag', p.name]],
      })),
    },
  })),
  dashboards: dashboards.map(d => ({
    schluessel: d.schluessel,
    sammlung: d.sammlung,
    payload: {
      name: d.name,
      description: `${d.beschreibung}\n\n[key:${d.schluessel}]`,
    },
    parameter: (d.filter ?? []).map(p => ({
      id: p.id,
      name: p['display-name'],
      slug: p.name,
      type: p.type,
      sectionId: p.type.startsWith('date') ? 'date' : 'string',
      // Auswahlliste statt Freitext. Das Feld wird erst in der Seite zur
      // Feld-ID aufgeloest, weil die IDs je Metabase-Installation andere
      // sind und hier nicht fest stehen duerfen.
      ...(p.werteliste ? { werteliste: p.werteliste } : {}),
      ...(p.festeWerte ? { festeWerte: p.festeWerte } : {}),
    })),
    kacheln: layoutVon.get(d.schluessel)!,
  })),
  sammlungen: [
    {
      name: 'Drill-Down',
      beschreibung:
        'Die Kette Marke → Filiale → Betrieb, dazu der Vergleich von Zeiträumen und Standorten. Hier fängt man an; ein Klick führt jeweils eine Ebene tiefer.',
    },
    {
      name: 'Round Table',
      beschreibung:
        'Alles für den monatlichen Round Table: Übersicht und Betriebstabelle, Trend und Historie, Ursachen und Maßnahmen.',
    },
    {
      name: 'Technik',
      beschreibung:
        'Läuft der Datenimport? Die Seite, die man aufschlägt, wenn Zahlen fehlen — und die einzige, die sagt, woran es liegt.',
    },
    {
      name: 'Betrieb',
      beschreibung:
        'Die Detailauswertungen: Umsatz, Struktur, Personal, Warenwirtschaft und BWA — dazu die Seite, auf der man prüft, ob man den übrigen glauben darf.',
    },
  ],
}

// =====================================================================
// Die Seite, die die Arbeit macht.
// =====================================================================
const SEITE = String.raw`<!doctype html>
<meta charset="utf-8">
<title>Dashboards übernehmen</title>
<style>
  body { font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
         max-width: 60rem; margin: 3rem auto; padding: 0 1.5rem;
         color: #2b2b2b; background: #fbfbfa; }
  h1 { font-size: 1.4rem; }
  #log { white-space: pre-wrap; border-left: 3px solid #ddd; padding-left: 1rem; }
  .ok { color: #2d7a2d; } .neu { color: #1a6ba8; } .fehler { color: #b03030; font-weight: bold; }
  button { font: inherit; padding: .6rem 1.2rem; cursor: pointer; }
</style>
<h1>Dashboards nach Metabase übernehmen</h1>
<p>Legt Sammlungen, Karten und Dashboards an. Ein zweiter Lauf aktualisiert, was schon da ist,
   statt es zu verdoppeln.</p>
<button id="los">Übernehmen</button>
<pre id="log"></pre>
<script>
const log = (t, k='') => {
  const s = document.createElement('span');
  s.className = k; s.textContent = t + '\n';
  document.getElementById('log').append(s);
};

async function mb(pfad, methode='GET', koerper) {
  const r = await fetch('/api' + pfad, {
    method: methode,
    headers: {'Content-Type':'application/json'},
    body: koerper ? JSON.stringify(koerper) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(methode + ' ' + pfad + ' → ' + r.status + ' ' + text.slice(0, 400));
  return text ? JSON.parse(text) : null;
}

async function uebernehmen() {
  const def = await (await fetch('/definitionen.json')).json();

  // --- Feld-IDs für die Feldfilter --------------------------------
  const felder = {};
  for (const f of await mb('/database/' + def.db_id + '/fields')) {
    felder[f.schema + '.' + f.table_name + '.' + f.name] = f.id;
  }
  log('Feldkatalog: ' + Object.keys(felder).length + ' Felder');

  // --- Sammlungen ---------------------------------------------------
  const vorhandeneSammlungen = await mb('/collection');
  const sammlungId = {};
  for (const s of def.sammlungen) {
    const da = vorhandeneSammlungen.find(x => x.name === s.name && !x.archived);
    if (da) { sammlungId[s.name] = da.id; log('Sammlung ' + s.name + ' — vorhanden', 'ok'); }
    else {
      const neu = await mb('/collection', 'POST', {name: s.name, description: s.beschreibung});
      sammlungId[s.name] = neu.id; log('Sammlung ' + s.name + ' — angelegt', 'neu');
    }
  }

  // --- Karten -------------------------------------------------------
  // Gesucht wird über [key:...] in der Beschreibung, nicht über den Namen:
  // Namen darf jemand in der Oberfläche ändern, ohne dass hier eine Kopie
  // entstehen soll.
  const suche = await mb('/search?models=card&archived=false&limit=1000');
  const nachSchluessel = {};
  for (const c of (suche.data || [])) {
    const m = (c.description || '').match(/\[key:([a-z0-9_]+)\]/);
    if (m) nachSchluessel[m[1]] = c.id;
  }

  const karteId = {};
  for (const k of def.karten) {
    const p = JSON.parse(JSON.stringify(k.payload));
    // Feldfilter-Platzhalter gegen echte IDs tauschen.
    for (const tag of Object.values(p.dataset_query.native['template-tags'])) {
      if (tag.dimension && tag.dimension[1] && tag.dimension[1].__feld) {
        const schluessel = tag.dimension[1].__feld.join('.');
        const id = felder[schluessel];
        if (!id) throw new Error('Feld nicht gefunden: ' + schluessel + ' (Karte ' + k.schluessel + ')');
        tag.dimension = ['field', id, null];
      }
    }
    p.collection_id = sammlungId[
      k.schluessel.startsWith('rt_') ? 'Round Table'
      : (k.schluessel.startsWith('dd_') || k.schluessel.startsWith('vg_')
         || k.schluessel.startsWith('pf_')) ? 'Drill-Down'
      : 'Betrieb'];

    const da = nachSchluessel[k.schluessel];
    try {
      if (da) { await mb('/card/' + da, 'PUT', p); karteId[k.schluessel] = da; log('  Karte ' + k.schluessel + ' — aktualisiert', 'ok'); }
      else { const neu = await mb('/card', 'POST', p); karteId[k.schluessel] = neu.id; log('  Karte ' + k.schluessel + ' — angelegt', 'neu'); }
    } catch (e) { log('  Karte ' + k.schluessel + ' — FEHLER: ' + e.message, 'fehler'); }
  }

  // --- Dashboards ---------------------------------------------------
  // Zwei Durchgaenge. Der erste legt alle Dashboards an, damit im zweiten
  // die Ziel-IDs fuer das Klickverhalten bekannt sind — ein Drill-Down
  // zeigt fast immer auf ein Dashboard, das es beim Anlegen noch nicht gab.
  const dsuche = await mb('/search?models=dashboard&archived=false&limit=1000');
  const dashNachSchluessel = {};
  for (const d of (dsuche.data || [])) {
    const m = (d.description || '').match(/\[key:([a-z0-9_]+)\]/);
    if (m) dashNachSchluessel[m[1]] = d.id;
  }

  const dashId = {};
  for (const d of def.dashboards) {
    const grund = {...d.payload, collection_id: sammlungId[d.sammlung]};
    let id = dashNachSchluessel[d.schluessel];
    if (id) { await mb('/dashboard/' + id, 'PUT', grund); log('Dashboard ' + d.payload.name + ' — vorhanden', 'ok'); }
    else { const neu = await mb('/dashboard', 'POST', grund); id = neu.id; log('Dashboard ' + d.payload.name + ' — angelegt', 'neu'); }
    dashId[d.schluessel] = id;
  }

  // Die Werte fuer eine Auswahlliste holen. Ueber Metabases eigene
  // Abfrage-Schnittstelle, damit hier keine zweite Datenbankverbindung
  // noetig ist. Wird je Liste nur einmal gelesen und danach gemerkt.
  const listenSpeicher = {};
  async function werteHolen(feld) {
    const schluessel = feld.join('.');
    if (listenSpeicher[schluessel]) return listenSpeicher[schluessel];
    const [schema, tabelle, spalte] = feld;
    const antwort = await mb('/dataset', 'POST', {
      type: 'native',
      database: def.db_id,
      native: {query:
        'SELECT DISTINCT "' + spalte + '" FROM "' + schema + '"."' + tabelle + '" ' +
        'WHERE "' + spalte + '" IS NOT NULL ORDER BY 1'},
    });
    const werte = (antwort.data?.rows || []).map(r => r[0]).filter(v => v !== null && v !== '');
    listenSpeicher[schluessel] = werte;
    log('  Auswahlliste ' + schluessel + ': ' + werte.length + ' Werte');
    return werte;
  }

  // Klickverhalten einer Kachel in Metabases Struktur uebersetzen.
  // parameterMapping bildet einen Parameter des ZIELS auf eine Spalte der
  // QUELLE ab; ohne diese Abbildung oeffnet der Klick das Zieldashboard
  // ungefiltert, was schlimmer ist als kein Klick.
  function klickVerhalten(k, zielDashboard) {
    // FESTER WERT -> eigene URL.
    //
    // Eine Zaehlkachel hat keine Spalte, aus der sich etwas mitgeben
    // liesse -- sie weiss aber, was sie zaehlt. Der erste Versuch setzte
    // dafuer parameterMapping mit source: null und einem value-Feld. Das
    // speichert Metabase klaglos und IGNORIERT es dann: die Kachel war im
    // Browser gar nicht anklickbar, gemeldet am 27.07.2026.
    //
    // Metabase erwartet in parameterMapping.source immer eine echte
    // Spalte. Fuer feste Werte ist der vorgesehene Weg eine Ziel-URL mit
    // dem Filter in der Abfragezeichenfolge -- genau das, was die
    // Oberflaeche selbst erzeugt, wenn man "Benutzerdefinierte URL" waehlt.
    if (k.fest) {
      const paare = Object.entries(k.uebergabe)
        .map(([slug, wert]) => encodeURIComponent(slug) + '=' + encodeURIComponent(wert));
      return {
        type: 'link',
        linkType: 'url',
        linkTemplate: '/dashboard/' + zielDashboard + (paare.length ? '?' + paare.join('&') : ''),
      };
    }

    const parameterMapping = {};
    for (const [zielSlug, quellSpalte] of Object.entries(k.uebergabe)) {
      const zielDef = def.dashboards.find(x => x.schluessel === k.ziel);
      const zp = (zielDef.parameter || []).find(p => p.slug === zielSlug);
      if (!zp) { log('  Klickziel ' + k.ziel + ' hat keinen Filter ' + zielSlug, 'fehler'); continue; }
      parameterMapping[zp.id] = {
        id: zp.id,
        source: {type: 'column', id: quellSpalte, name: quellSpalte},
        target: {type: 'parameter', id: zp.id},
      };
    }
    return {type: 'link', linkType: 'dashboard', targetId: zielDashboard, parameterMapping};
  }

  for (const d of def.dashboards) {
    let id = dashId[d.schluessel];
    try {
      // Kacheln. Jede Karte, die einen gleichnamigen Parameter hat, wird
      // an den Dashboard-Filter verdrahtet — sonst bliebe der Filter oben
      // stehen und täte nichts.
      const dashcards = [];
      let lauf = -1;
      for (const kachel of d.kacheln) {
        lauf -= 1;
        if (kachel.text) {
          dashcards.push({
            id: lauf, card_id: null, row: kachel.y, col: kachel.x,
            size_x: kachel.breite, size_y: kachel.hoehe,
            visualization_settings: {virtual_card: {name: null, display: 'text',
              visualization_settings: {}, dataset_query: {}, archived: false},
              text: kachel.text, 'text.align_vertical': 'middle'},
            parameter_mappings: [],
          });
          continue;
        }
        const cid = karteId[kachel.karte];
        if (!cid) { log('  Kachel ohne Karte übersprungen: ' + kachel.karte, 'fehler'); continue; }
        const kdef = def.karten.find(x => x.schluessel === kachel.karte);
        const tags = kdef.payload.dataset_query.native['template-tags'];
        const mappings = [];
        for (const p of d.parameter) {
          if (!tags[p.slug]) continue;
          mappings.push({
            parameter_id: p.id, card_id: cid,
            target: tags[p.slug].type === 'dimension'
              ? ['dimension', ['template-tag', p.slug]]
              : ['variable', ['template-tag', p.slug]],
          });
        }
        // Klickverhalten: ohne spalte fuer die ganze Karte, mit
        // spalte nur fuer diese eine Tabellenspalte.
        const vis = {};
        for (const k of (kachel.klick || [])) {
          const ziel = dashId[k.ziel];
          if (!ziel) { log('  Klickziel unbekannt: ' + k.ziel, 'fehler'); continue; }
          if (k.spalte) {
            vis.column_settings = vis.column_settings || {};
            const schluessel = JSON.stringify(['name', k.spalte]);
            vis.column_settings[schluessel] = {
              ...(vis.column_settings[schluessel] || {}),
              click_behavior: klickVerhalten(k, ziel),
            };
          } else {
            vis.click_behavior = klickVerhalten(k, ziel);
          }
        }
        // Spaltenformate der Karte beibehalten, Klickverhalten ergaenzen.
        const kdefVis = kdef.payload.visualization_settings || {};
        if (kdefVis.column_settings && vis.column_settings) {
          vis.column_settings = {...kdefVis.column_settings, ...vis.column_settings};
          for (const sp of Object.keys(vis.column_settings)) {
            if (kdefVis.column_settings[sp]) {
              vis.column_settings[sp] = {...kdefVis.column_settings[sp], ...vis.column_settings[sp]};
            }
          }
        }
        dashcards.push({
          id: lauf, card_id: cid, row: kachel.y, col: kachel.x,
          size_x: kachel.breite, size_y: kachel.hoehe,
          parameter_mappings: mappings, visualization_settings: vis,
        });
      }

      // Auswahllisten setzen. Ohne sie zeigt Metabase ein Freitextfeld:
      // wer "Enchilada Bremen" nicht auf den Buchstaben genau trifft, sieht
      // ein leeres Dashboard und keinen Hinweis, dass der Filter schuld ist.
      //
      // Bewusst eine FESTE Liste und kein Verweis auf ein Feld: die Karten
      // sind natives SQL, ihre Filter haengen deshalb an einer Variablen und
      // nicht an einer Spalte. Metabase bietet ein Feld-Dropdown nur dort an,
      // wo es die Spalte kennt — bei einer Variablen bleibt es beim
      // Freitextfeld, egal was in values_source_config steht.
      const parameter = [];
      for (const p of d.parameter) {
        // Feste Liste: Werte stehen in der Definition, nicht in der
        // Datenbank -- etwa die Bewertung, deren 'ohne' fuer NULL steht.
        if (p.festeWerte) {
          const {festeWerte, werteliste: _w, ...rest} = p;
          parameter.push({
            ...rest,
            values_query_type: 'list',
            values_source_type: 'static-list',
            values_source_config: {values: festeWerte},
          });
          continue;
        }
        if (!p.werteliste) { parameter.push(p); continue; }
        const {werteliste, ...rest} = p;
        const werte = await werteHolen(werteliste);
        if (!werte.length) {
          log('  Werteliste ' + werteliste.join('.') + ' leer', 'fehler');
          parameter.push(rest); continue;
        }
        parameter.push({
          ...rest,
          values_query_type: 'list',
          values_source_type: 'static-list',
          values_source_config: {values: werte},
        });
      }

      await mb('/dashboard/' + id, 'PUT', {parameters: parameter, dashcards});
      log('  ' + dashcards.length + ' Kacheln gesetzt', 'ok');
    } catch (e) { log('Dashboard ' + d.payload.name + ' — FEHLER: ' + e.message, 'fehler'); }
  }

  log('\nFertig.');
}

document.getElementById('los').onclick = async () => {
  document.getElementById('los').disabled = true;
  try { await uebernehmen(); } catch (e) { log('ABBRUCH: ' + e.message, 'fehler'); }
};
</script>`

// =====================================================================
// Server: Seite, Definitionen, und alles unter /api an Metabase weiter.
// =====================================================================
const server = Bun.serve({
  port: PORT,
  hostname: 'localhost',
  idleTimeout: 240,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/') {
      return new Response(SEITE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname === '/definitionen.json') {
      return new Response(JSON.stringify(definitionen), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }
    if (url.pathname.startsWith('/api/')) {
      // Unveraendert weiterreichen, samt Cookie. Der Browser schickt es
      // von selbst mit, weil Cookies je Host und nicht je Port gelten.
      const ziel = METABASE + url.pathname + url.search
      const kopf = new Headers(req.headers)
      kopf.set('host', 'localhost:3000')
      kopf.delete('origin')
      kopf.delete('referer')
      const antwort = await fetch(ziel, {
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
console.log(`  ${definitionen.karten.length} Karten, ${definitionen.dashboards.length} Dashboards`)
