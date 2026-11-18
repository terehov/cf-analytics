#!/usr/bin/env python3
# panel_auswerten.py -- macht aus der JSON-Ausgabe von panel_extrahieren.mjs die vier CSV-Dateien.
#
# Aufruf:  python3 -I panel_auswerten.py <bundle-verzeichnis> <roh.json> <altes-inventar.md> <ausgabe-verzeichnis>
# Nur Lesen von Textdateien, kein Netz, keine Ausfuehrung der Bundles.
import csv, collections, glob, json, os, re, sys

bundle, rohfile, altdoc, outdir = sys.argv[1:5]
raw = json.load(open(rohfile))
os.makedirs(outdir, exist_ok=True)

mods = {m['id']: m for m in raw['modules']}

def chunk_name(fn):
    # Chunk 592 liegt als common.<hash>.js (runtime: 592===e?"common":e)
    b = os.path.basename(fn).split('.')[0]
    return '592' if b == 'common' else b

# ------------------------------------------------------------------ altes Inventar -> normalisierte Pfade
def norm(p):
    p = p.strip().split('?')[0]
    p = re.sub(r'^https?://[^/]+', '', p)
    p = '/' + p.strip('/')
    p = re.sub(r'\{[^}]*\}', '*', p)
    p = re.sub(r':[A-Za-z_]\w*', '*', p)
    p = re.sub(r'\[\]', '', p)
    p = re.sub(r'/(\d{3,}|[0-9a-f]{8}-[0-9a-f-]{27,})(?=/|$)', '/*', p)
    return p.lower()

alt = set()
alt_roots = set()
doc = open(altdoc, encoding='utf-8').read()
for m in re.finditer(r'(?<![\w.])(/api/[A-Za-z0-9_\-/{}:.\[\]=?&,*]+)', doc):
    t = m.group(1).rstrip('.,;)`')
    alt.add(norm(t))
# Kurzschreibweise: "GET /api/x    + /{id} /products /status" -> Basis + jeder Suffix (auch hinter /{id})
for line in doc.splitlines():
    mm = re.match(r'\s*(?:GET|POST|PUT|DELETE|PATCH)\s+(/api/\S+)\s+(.*)$', line)
    if not mm:
        continue
    base = mm.group(1)
    rest = mm.group(2).replace('+', ' ')
    sufs = [s for s in rest.split() if s.startswith('/')]
    for s in sufs:
        alt.add(norm(base + s))
        alt.add(norm(base + '/{id}' + s))
        # "/{id}/products" ist selbst schon ein Suffix mit Parameter
for p in list(alt):
    alt_roots.add('/'.join(p.split('/')[:4]))

# ------------------------------------------------------------------ Aufrufer-Hinweise zur Parameter-Benennung
GENERIC = set('''show edit update delete store create index search paginate get post put patch remove add save load open close
 submit init run next set reset toggle select click change handle process refresh reload download upload export import
 print navigate record getItem setItem getAll find findAll findOne list view clear'''.split())

def infer_name(meth, pos):
    """Name eines Parameters aus den Aufrufstellen; nur fuer nicht-generische Methodennamen."""
    if meth in GENERIC:
        return None
    arr = raw['callerArgs'].get(meth)
    if not arr or pos - 1 >= len(arr) or not arr[pos - 1]:
        return None
    c = collections.Counter()
    tot = 0
    for d in arr[pos - 1]:
        if not d:
            continue
        tot += 1
        if d['k'] in ('member', 'getter'):
            c[d['n']] += 1
    if not c:
        return None
    n, k = c.most_common(1)[0]
    if k >= 1 and k / tot >= 0.5 and re.match(r'^[A-Za-z_]\w*$', n):
        return n
    return None

def infer_body(meth, pos):
    """Koerperfelder aus Aufrufstellen (Objektliterale)."""
    if meth in GENERIC:
        return None
    arr = raw['callerArgs'].get(meth)
    if not arr or pos - 1 >= len(arr) or not arr[pos - 1]:
        return None
    keys = []
    other = collections.Counter()
    for d in arr[pos - 1]:
        if not d:
            continue
        if d['k'] == 'obj':
            for k in d.get('keys', []):
                if k not in keys:
                    keys.append(k)
        else:
            other[d['k'] + ':' + d['n'][:30]] += 1
    return keys, other

# ------------------------------------------------------------------ Routen
arrs = {a['module']: a for a in raw['routeArrays']}
routes = []  # dict(path, chunk(arraychunk), r, parent_module)

def route_node_text(r):
    return r

def expand(modid, prefix, seen):
    a = arrs.get(modid)
    if not a:
        return
    def w(rs, pre):
        for r in rs:
            p = ((pre + '/' + r['path']) if r['path'] else pre).replace('//', '/')
            routes.append(dict(path='/' + p.strip('/'), chunk=a['chunk'], r=r, module=modid))
            if r['lazy'] and r['lazy']['module'] and r['lazy']['module'] not in seen:
                expand(r['lazy']['module'], p, seen | {modid})
            w(r['children'], p)
    w(a['routes'], prefix)

expand('45366', '', set())

# Modul-Tiefen von jedem Lazy-Ziel aus (Importgraph)
def depths(m):
    d = {m: 0}
    q = collections.deque([m])
    while q:
        x = q.popleft()
        for y in mods.get(x, {}).get('deps', []):
            if y in mods and y not in d:
                d[y] = d[x] + 1
                q.append(y)
    return d

lazy = [(rt['path'], rt['r']['lazy']['module']) for rt in routes if rt['r']['lazy'] and rt['r']['lazy']['module']]
DEP = {}
for p, m in lazy:
    DEP.setdefault(p + '|' + m, depths(m))
LAZYKEYS = list(DEP.keys())

def routes_for(module):
    best = None
    rs = []
    for key in LAZYKEYS:
        d = DEP[key]
        if module in d:
            if best is None or d[module] < best:
                best, rs = d[module], [key.split('|')[0]]
            elif d[module] == best:
                rs.append(key.split('|')[0])
    return best, sorted(set(rs))

GUARD_TEXT = {
    ('45366', 'J'): "canActivate J (gelesen): Wurzelroute '/': eingeloggt per GET app/is-authenticated, dann Weiterleitung auf die gemerkte Zielroute",
    ('45366', 'F'): "canActivate F (gelesen): Host mit 'supplier' -> nur Rolle ROLE_SUPPLIER (sonst /supplier/login|register); sonst /login und /reset-password offen, eingeloggt nur /panel, alles andere -> /forbidden; Anmeldung per GET app/is-authenticated",
    ('22239', 'wt'): "canActivate wt (gelesen): ist ein Benutzer geladen, muss data.role (falls gesetzt) in user.roles stehen; sonst GET app/is-authenticated",
    ('22239', 'Le'): "canActivate Le (gelesen): user.allowedModules.{analytics|catering|erp|menucreator} je Pfadpraefix /panel/<modul>; fehlt es -> /panel/module-not-allowed (shop, shopping-list, settings, dashboard: keine Modulpruefung im Code)",
    ('81330', 'So'): "canActivate So (gelesen): permissionsService.hasCateringViewAllEventDetailsPermissions(user), sonst Warnfenster und Weiterleitung /catering",
    ('54116', 'I'): "canActivate I (gelesen): data.permission == StocktransferApproving UND (erpPermissions.all ODER erpPermissions.stocktransferApproves)",
    ('30488', 'Cf'): "canActivate Cf (gelesen): user.roles enthaelt 'ROLE_SUPPLIER'",
    ('2742', 'Ys'): "canActivate Ys (gelesen): gibt immer true zurueck",
    ('283', 'fn'): "canDeactivate fn (gelesen): confirm() bei ungespeicherten Aenderungen der Menuekarte",
}
BREW_GUARD = "canActivate <alias>.F aus Modul 13596 (Chunk 592, gelesen am 18.11.2026): setzt window.location.href auf <reactFrontendDomain>/brew/<data.brewPath mit :param aus der Route> (+ Query) und gibt false zurueck -> Weiterleitung auf die neue Oberflaeche, kein Aufruf der API"

def guard_desc(rt):
    r = rt['r']
    out = []
    for kind, src in r['guards']:
        found = False
        for (mid, ident), txt in GUARD_TEXT.items():
            if mid == rt['module'] and re.search(r'(?<![\w$.])' + re.escape(ident) + r'(?![\w$])', src):
                out.append(txt)
                found = True
        if not found:
            if re.search(r'\b\w+\.F\b', src) and r['data'] and 'brewPath' in r['data']:
                out.append(BREW_GUARD)
            elif kind == 'resolve':
                out.append('resolve ' + src[:80] + ' (Resolver, nicht ausgewertet)')
            else:
                out.append(kind + ' ' + src[:80] + ' (nicht aufgeloest)')
    if r['data']:
        d = r['data']
        if 'permission' in d or 'role' in d or 'brewPath' in d:
            out.append('data ' + d[:120])
    return ' | '.join(out)

# ------------------------------------------------------------------ Aufrufe
def token_rename(path, meth, params_hint):
    """ersetzt {pN} durch abgeleitete Namen, soweit die Aufrufer eindeutig sind"""
    named = []
    def rep(m):
        n = int(m.group(1))
        nm = infer_name(meth, n)
        if nm:
            named.append(nm)
            return '{' + nm + '}'
        return m.group(0)
    return re.sub(r'\{p(\d+)\}', rep, path), named

def clean_path(p):
    if p.startswith('/'):
        p = p[1:]
    return '/' + p

def is_wrapper(p):
    q = p.strip('/')
    return q in ('?', 'api', 'app', '') or re.fullmatch(r'\{[^}]*\}', q) is not None or q.startswith('{load}')

rows = collections.OrderedDict()   # (method, path) -> dict
dropped = []

def add_row(method, path, e, query, body_fields, routes_, note_parts, named_conf, kind):
    key = (method, path)
    r = rows.get(key)
    if not r:
        r = rows[key] = dict(method=method, path=path, query=[], body=[], chunks=set(), routes=set(), notes=[], conf=set(), modules=set(), kinds=set(), inherited=False, direct=False, fns=set(), insts=set())
    for q in query:
        if q not in r['query']:
            r['query'].append(q)
    for b in body_fields:
        if b not in r['body']:
            r['body'].append(b)
    r['chunks'].add(e['chunk'])
    if e.get('inherited') and e.get('instChunk'):
        r['chunks'].add(e['instChunk'])
    r['routes'].update(routes_)
    for n in note_parts:
        if n not in r['notes']:
            r['notes'].append(n)
    r['conf'].add(named_conf)
    r['kinds'].add(kind)
    r['fns'].add(e.get('fn', ''))
    if e.get('inherited'):
        r['inherited'] = True
        r['insts'].add(e.get('inst') or '')
    else:
        r['direct'] = True

for e in raw['emissions']:
    for v in e['variants']:
        p = v['path']
        if is_wrapper(p):
            dropped.append((e['chunk'], e['fn'], e['verb'], p, e['text'][:100]))
            continue
        if '{prefix}' in p and '{suffix}' in p:
            p = '/assets/i18n/{bereich}/{lang}.json'
            note0 = 'statisches Asset (ngx-translate-Lader in main): Praefixe /assets/i18n/ plus dashboard, menu-creator, analytics, daily-menu, event-catering, production-plan, erp, sidebar, supplier, settings; Query v=<Hash aus Tabelle in main>'
            add_row('GET', p, e, ['v'], [], [], [note0], 'named', 'asset')
            continue
        p = clean_path(p).replace('{erp.selectedErp}', '{erpId}')
        p, named_from_callers = token_rename(p, e['fn'], None)
        # Konfidenz
        toks = re.findall(r'\{([^}]*)\}', p)
        if not toks:
            conf = 'none'
        elif any(re.fullmatch(r'p\d+', t) or t.startswith('?') for t in toks):
            conf = 'positional'
        elif named_from_callers:
            conf = 'named(callers)'
        else:
            conf = 'named'
        # Query
        q = list(v['query'])
        # Body
        bf = []
        note = []
        b = e.get('body')
        if b:
            if b.get('fields'):
                bf = [x if not re.match(r'^[{?]', x) else '(dyn)' for x in b['fields']]
                if b.get('form'):
                    bf = ['FormData:' + x for x in bf]
            elif b.get('note') == 'param' and b.get('param'):
                inf = infer_body(e['fn'], b['param'])
                if inf and inf[0]:
                    bf = ['(Aufrufer) ' + x for x in inf[0]]
                elif inf is not None or e['fn'] in GENERIC:
                    note.append('Body nicht aus Dienst ableitbar (Parameter %d von %s)' % (b['param'], e['fn']))
                else:
                    note.append('Body nicht ableitbar (Parameter %d)' % b['param'])
            elif b.get('note'):
                note.append('Body: %s' % (b.get('src') or '')[:50])
            elif b.get('src') in ('{}',):
                note.append('leerer Body {}')
            else:
                note.append('Body-Quelle: ' + (b.get('src') or '')[:40])
        if e.get('inherited'):
            note.append('geerbt: CRUD-Basisklasse (Modul %s), Instanz %s - ob die Oberflaeche diesen Pfad nutzt, ist nicht belegt' % (e['module'], e.get('inst')))
        if v.get('conditional'):
            note.append('Pfad nur unter Bedingung')
        if '|' in p:
            note.append('Pfadsegment mit Alternativen {a|b}')
        if not p.startswith('/api/') and p != '/api':
            note.append('Pfad ohne /api-Praefix (baseUrl bzw. Literal): klassische serverseitige Route')
        segs = p.strip('/').split('/')
        for i, sg in enumerate(segs):
            mm = re.fullmatch(r'\{(p\d+)\}', sg)
            if mm and i > 0:
                note.append('%s folgt auf Segment "%s"' % (mm.group(1), segs[i - 1]))
        # Routen
        code_mod = e['instModule'] if e.get('inherited') else e['module']
        rts = []
        depth, rts = routes_for(code_mod)
        if e['chunk'] == 'main' and not e.get('inherited'):
            note.append('Dienst-Code in main' + ('' if rts else ' (von keinem Lazy-Modul importiert: global/Wurzelkomponente)'))
        if depth is None:
            if e['chunk'] != 'main':
                note.append('keiner Route zuordenbar')
        elif depth >= 2:
            note.append('Routen nur ueber Modulkette (Tiefe %d)' % depth)
        # Methode
        meth = e['verb'].upper()
        if meth == 'GET' and re.search(r'(?i)(unlink|remove|delete|cancel|accept|confirm|clear|logout|signout|archive|reedit|close|duplicate|clone|publish|approve|decline|reject|restore)', p):
            note.append('GET mit Namen einer Zustandsaenderung (nach Namen vermutet, nicht belegt)')
        add_row(meth, p, e, q, bf, rts, note, conf, 'http')
        if e.get('opts') and ('blob' in e['opts'] or 'arraybuffer' in e['opts']):
            rows[(meth, p)]['notes'].append('Antwort als Datei (blob/arraybuffer)')

# Links (nicht HttpClient): nur /api/-Pfade
ui_links = collections.OrderedDict()
for l in raw['links']:
    p = l['path']
    if not p.strip():
        continue
    if re.match(r'^/?api/', p):
        pp = clean_path(p.split('?')[0])
        q = [x.split('=')[0] for x in p.split('?')[1].split('&')] if '?' in p else l.get('query', []) if isinstance(l.get('query'), list) else []
        key = ('GET', pp)
        if key in rows:
            continue  # schon als HttpClient-Aufruf erfasst
        if re.match(r'^this\.[\w$]+=', l['parentText'] or ''):
            continue  # Klassenfeld mit Basis-Literal (wird als Basis fuer echte Aufrufe benutzt), kein eigener Aufruf
        if any(norm(pp) == norm(k[1]) for k in rows if k[0] == 'GET'):
            continue
        e = dict(chunk=l['chunk'], fn=l['fn'], module=l['module'], instModule=l['module'])
        depth, rts = routes_for(l['module']) if l['chunk'] != 'main' else (None, [])
        add_row('GET', pp, e, q, [], rts, ['Link/Download/Literal, kein HttpClient-Aufruf (%s)' % (l['parentText'][:60].replace('\n', ' '))], 'named' if '{' in pp else 'none', 'link')
    else:
        ui_links.setdefault(p.split('?')[0], set()).add(l['chunk'])

# postImage (URL-Parameter, URL als Literal in anderer Komponente) -- von Hand verknuepft, im Quelltext gelesen
extra_notes = {}
def manual_row(method, path, chunk, note, body=None, conf='none'):
    e = dict(chunk=chunk, fn='(manuell verknuepft)', module='', instModule='')
    add_row(method, path, e, [], body or [], [], [note], conf, 'manuell')

# Pruefen, ob postImage-Literal im Material steht
if any(l['path'] == '/api/menu_creator/mc_image/upload' for l in raw['links']):
    key = ('POST', '/api/menu_creator/mc_image/upload')
    if key not in rows:
        manual_row('POST', '/api/menu_creator/mc_image/upload', '283',
                   'Methode und Body aus Dienst postImage(url,file,type) gelesen (FormData), URL als Literal this.imageUrl in einer Komponente - Verknuepfung von Hand gelesen, nicht automatisch', ['FormData:imageFile', 'FormData:imageType'])

# Zeilen -> CSV
def fmt_routes(rs):
    rs = sorted(rs)
    if not rs:
        return ''
    if len(rs) > 6:
        return '%d Routen (geteilter Dienst): %s ...' % (len(rs), ' ; '.join(rs[:4]))
    return ' ; '.join(rs)

def in_alt(path):
    n = norm(path)
    if n in alt:
        return 'ja'
    return 'nein'

out_rows = []
for (meth, path), r in rows.items():
    ia = in_alt(path)
    notes = list(r['notes'])
    if ia == 'nein':
        root = '/'.join(norm(path).split('/')[:4])
        if root in alt_roots:
            notes.append('Familie im alten Inventar genannt (%s), dieser Pfad nicht' % root)
    if r['inherited'] and not r['direct']:
        pass
    conf = sorted(r['conf'])
    if 'positional' in conf:
        c = 'positional'
    elif 'named(callers)' in conf:
        c = 'named(callers)'
    elif 'named' in conf:
        c = 'named'
    else:
        c = 'none'
    out_rows.append([meth, path, ','.join(r['query']), ','.join(r['body']), ','.join(sorted(r['chunks'], key=lambda x: (not x.isdigit(), int(x) if x.isdigit() else 0, x))), fmt_routes(r['routes']), c, ia, ' | '.join(notes)[:700]])

out_rows.sort(key=lambda x: (x[1], x[0]))
with open(os.path.join(outdir, 'panel-aufrufe.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['method', 'path_template', 'query_params', 'body_fields', 'chunks', 'routes', 'param_confidence', 'in_altem_inventar', 'note'])
    w.writerows(out_rows)

# ------------------------------------------------------------------ Routen-CSV
rt_rows = []
for rt in routes:
    r = rt['r']
    note = []
    if r['lazy']:
        note.append('loadChildren -> Chunks %s, Modul %s%s' % (','.join(r['lazy']['chunks']), r['lazy']['module'], (' (' + r['lazy']['exportName'] + ')') if r['lazy'].get('exportName') else ''))
    if r['redirectTo']:
        note.append('redirectTo ' + r['redirectTo'])
    if r['component']:
        comp = r['component']
        if len(comp) < 12:
            note.append('component ' + comp + ' (minifiziert)')
        else:
            note.append('component: Inline-Klasse')
    if r['pathMatch']:
        note.append('pathMatch ' + r['pathMatch'])
    if r['data'] and not re.search(r'permission|role|brewPath', r['data']):
        note.append('data ' + r['data'][:100])
    if r['other'].get('title'):
        note.append('title ' + r['other']['title'])
    rt_rows.append([rt['path'], rt['chunk'], guard_desc(rt), ' ; '.join(note)])
# Verweise auf die neue Oberflaeche
brew = collections.defaultdict(set)
for fn in sorted(glob.glob(os.path.join(bundle, '*.js'))):
    b = chunk_name(fn)
    if b in ('vendor', 'polyfills', 'runtime'):
        continue
    s = open(fn, errors='replace').read()
    for m in re.finditer(r'["`\']((?:/)?brew/[^"`\'\s]*)["`\']', s):
        brew[m.group(1)].add(b)
for k, v in sorted(brew.items()):
    rt_rows.append([('/' + k.lstrip('/')), ','.join(sorted(v)), '', 'Verweis/Weiterleitung auf die NEUE Oberflaeche (/brew, React), keine Route dieser App'])
with open(os.path.join(outdir, 'panel-routen.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['route_path', 'chunk', 'guard_or_permission', 'note'])
    w.writerows(rt_rows)

# ------------------------------------------------------------------ Hosts
NOISE_HOSTS = set('''www.w3.org github.com angular.io schemas.openxmlformats.org schemas.microsoft.com www.dalelotts.com purl.org momentjs.com
openoffice.org ns.adobe.com tools.ietf.org sheetjs.com feross.org purl.oclc.org docs.oasis-open.org www.chartjs.org docs.sentry.io
html2canvas.hertzen.com hertzen.com macVmlSchemaUri sheetjs.openxmlformats.org pdfmake.org www.aiim.org mths.be mindmup.github.io
praleska.pro id.wikisource.org jv.wikipedia.org fast.fonts.net use.typekit.net f.fontdeck.com g.co www.example.com'''.split())
KIND = {
    'public.tableau.com': 'Tableau (Skript, Einbettung der Analytics)',
    'maps.googleapis.com': 'Google Maps JS (mit API-Key, im HTML)',
    'fonts.googleapis.com': 'Schriften (CDN)',
    'cdn.jsdelivr.net': 'CDN (Bibliothek)',
    'my.foodnotify.com': 'eigener Host (Basis fuer Links/Bilder)',
    'beam.foodnotify.com': 'eigener Host (Menue-Eintrag "lab", extern)',
    'help.foodnotify.com': 'eigener Host (Hilfe/Ticket)',
    'www.foodnotify.com': 'eigener Host (Webseite, Meta-Bild)',
    'app.gleap.io': 'Gleap (Feedback-/Tracking-SDK in vendor, in main AKTIV initialisiert: initialize(<Schluessel luccHM\u2026>) + identify(Benutzer-Id, E-Mail, Name))',
    'api.gleap.io': 'Gleap API (SDK-Standard, Gleap ist in main initialisiert)',
    'ws.gleap.io': 'Gleap WebSocket (SDK-Standard, Gleap ist in main initialisiert)',
    'messenger-app.gleap.io': 'Gleap Widget-Frame (Bibliothek)',
    'outboundmedia.gleap.io': 'Gleap Medien (Bibliothek)',
    'js.gleap.io': 'Gleap Skript (Bibliothek)',
    'jsadminhelper.gleap.io': 'Gleap Admin-Helfer (Bibliothek)',
    'apps.apple.com': 'App-Store-Link (Mobile App)',
    'play.google.com': 'Play-Store-Link (Mobile App)',
}
rx = re.compile(r'(?:https?|wss?)://[A-Za-z0-9_.\-]+(?::\d+)?(?:/[^\s"\'`\\<>)]*)?')
host_rows = []
noise = collections.defaultdict(lambda: collections.defaultdict(int))
seenkey = set()
for fn in sorted(glob.glob(os.path.join(bundle, '*'))):
    b = chunk_name(fn)
    s = open(fn, errors='replace').read()
    for m in rx.finditer(s):
        u = m.group(0)
        h = re.match(r'(?:https?|wss?)://([^/:]+)', u).group(1)
        if re.fullmatch(r'[0-9a-f]{32}', h):
            # Sentry-DSN: Schluessel nur gekuerzt ausgeben, Rest der DSN aus dem Text lesen
            mm = re.match(r'https://([0-9a-f]{32})@([\w.\-]+)/(\d+)', s[m.start():m.start() + 160])
            if mm:
                u = 'https://%s\u2026@%s/%s' % (mm.group(1)[:6], mm.group(2), mm.group(3))
                h = mm.group(2)
        if h in NOISE_HOSTS:
            noise[h][b] += 1
            continue
        key = (u[:100], b)
        if key in seenkey:
            continue
        seenkey.add(key)
        ctx = s[max(0, m.start() - 70):m.end() + 60].replace('\n', ' ')
        kind = KIND.get(h, 'unbekannt')
        if h.endswith('.sentry.io') or h.startswith('625f77'):
            kind = 'Sentry (Fehlerverfolgung, DSN in main)'
            # DSN-Schluessel nicht ausschreiben
            ctx = re.sub(r'(https://)([0-9a-f]{6})[0-9a-f]+@', '\\1\\2\u2026@', ctx)
        if 'AIza' in u or 'AIza' in ctx:
            u = re.sub(r'(AIzaSy)[0-9A-Za-z_\-]+', '\\1\u2026', u)
            ctx = re.sub(r'(AIzaSy)[0-9A-Za-z_\-]+', '\\1\u2026', ctx)
        host_rows.append([u, kind, b, ctx[:170]])
# Hosts ohne Schema in Anfuehrungszeichen, die auf eigene Domains zeigen (Kontrolle)
for fn in sorted(glob.glob(os.path.join(bundle, '*.js'))):
    b = chunk_name(fn)
    if b in ('vendor', 'polyfills', 'runtime'):
        continue
    s = open(fn, errors='replace').read()
    for m in re.finditer(r'["\'`]((?:www\.)?[a-z0-9\-]+\.(?:foodnotify|gleap)\.[a-z]+[^"\'`\s]*)["\'`]', s):
        host_rows.append([m.group(1), 'Domain ohne Schema', b, s[max(0, m.start() - 60):m.end() + 40].replace('\n', ' ')[:170]])
# Skripte/Hosts aus den HTML-Seiten sind oben bereits erfasst (Dateien _panel_*.html, _brew_.html)
with open(os.path.join(outdir, 'panel-hosts.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['host_or_url', 'kind', 'chunk', 'context'])
    w.writerows(host_rows)
with open(os.path.join(outdir, 'panel-hosts-rauschen.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['host', 'chunks', 'fundstellen', 'kind'])
    for h, c in sorted(noise.items(), key=lambda x: -sum(x[1].values())):
        w.writerow([h, ','.join(sorted(c)), sum(c.values()), 'Bibliotheks-/Standard-Rauschen (Doku-Links, XML-Namensraeume, Lizenzkopf)'])

# ------------------------------------------------------------------ Kennzahlen fuer den Bericht
stat = collections.OrderedDict()
stat['aufrufe_rows'] = len(out_rows)
stat['http_rows'] = sum(1 for r in out_rows if r[0] == 'GET')
stat['write_rows'] = sum(1 for r in out_rows if r[0] != 'GET')
stat['by_method'] = collections.Counter(r[0] for r in out_rows)
stat['not_in_old'] = sum(1 for r in out_rows if r[7] == 'nein')
stat['in_old'] = sum(1 for r in out_rows if r[7] == 'ja')
stat['routes'] = len(rt_rows)
stat['routes_app'] = len(routes)
stat['hosts_rows'] = len(host_rows)
stat['noise_hosts'] = len(noise)
stat['dropped_wrapper'] = len(dropped)
stat['inherited_only'] = sum(1 for (k, r) in rows.items() if r['inherited'] and not r['direct'])
stat['raw_emissions'] = len(raw['emissions'])
stat['conf'] = collections.Counter(r[6] for r in out_rows)
if os.environ.get('PANEL_DEBUG'):
    json.dump(stat, open(os.path.join(outdir, '_stat.json'), 'w'), indent=1, default=dict)
    json.dump({'dropped': dropped, 'ui_links': {k: sorted(v) for k, v in ui_links.items()}}, open(os.path.join(outdir, '_dropped.json'), 'w'), indent=1)
print(json.dumps(stat, indent=1, default=dict))
