#!/usr/bin/env python3
"""Statische Inventur einer Vite/React-SPA (FoodNotify "/brew"): HTTP-Aufrufe, Routen, Hosts, Rechte.

Aufruf:  python3 -I brew_extract.py <bundle-verzeichnis> <ausgabe-verzeichnis>

Liest die minifizierten JS-Dateien NUR als Text. Es wird nichts ausgefuehrt, nichts geladen,
kein Netzwerkzugriff. Das Verzeichnis dieses Skripts (mit den Hilfsmodulen) wird selbst in
sys.path eingetragen, weil `-I` das Skriptverzeichnis sonst nicht aufnimmt; das Bundle-
Verzeichnis kommt NIE in sys.path.
"""
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bundle import Bundle                       # noqa: E402
from extract_calls import Extractor              # noqa: E402
from ausgabe import build, assemble, shape_of  # noqa: E402
from routen import parse_routes, public_path, chunk_routes, map_deps  # noqa: E402
from jsscan import find_close                    # noqa: E402

ANKER = 'isAuthenticated:"/app/is-authenticated"'


def find_entry(bundle):
    """Der Einstiegs-Chunk: enthaelt das Endpunkt-Register (Anker) und ist der groesste."""
    cands = [f for f, s in bundle.files.items() if ANKER in s]
    if not cands:
        cands = [max(bundle.files, key=lambda f: len(bundle.files[f]))]
    return max(cands, key=lambda f: len(bundle.files[f]))


def route_label(rid, all_ids):
    if rid == '__hub__':
        return '(Einstiegs-/Hilfs-Chunk: Aufrufer nicht eindeutig einer Route zuzuordnen)'
    """Oeffentlicher Pfad der Route; Layout-Routen (haben Kinder, kein Slash am Ende) als 'name/*'."""
    p = public_path(rid)
    p = re.sub(r'\$(\w+)', r'{\1}', p)
    if rid != '/' and not rid.endswith('/'):
        if any(o != rid and o.startswith(rid + '/') for o in all_ids):
            return p.rstrip('/') + '/* (Layout)'
    return p


def fmt_routes(rids, all_ids, limit=6):
    labels = sorted(set(route_label(r, all_ids) for r in rids))
    if len(labels) > limit:
        return ' | '.join(labels[:limit]) + ' | (+%d weitere)' % (len(labels) - limit)
    return ' | '.join(labels)


def guess_method_from_context(s, pos, end):
    pre = s[max(0, pos - 160):pos]
    post = s[end:end + 120]
    if re.search(r'method:"POST"[^}]*$', pre) or re.search(r'method:"POST"', pre[-80:]):
        return 'POST', 'HTML-Formular (method=POST), kein XHR'
    if re.search(r'href:\s*[`$]?\{?\$?\{?[^,]*$', pre[-60:]) or 'href:' in pre[-40:]:
        return 'GET', 'Link/Download (href), kein XHR'
    if 'window.open' in pre[-40:] or 'location' in pre[-40:]:
        return 'GET', 'Navigation/Download (window.open/location), kein XHR'
    return '?', 'Registereintrag referenziert, Aufrufart nicht erkannt'


def main(bundle_dir, out_dir):
    b = Bundle(bundle_dir)
    entry = find_entry(b)
    es = b.files[entry]
    x = Extractor(b, entry)
    x.run()
    sites = x.sites

    # ------------------------------------------------------------ Register-Referenzen ausserhalb von Aufrufen
    covered = defaultdict(list)
    for st in sites:
        covered[st['file']].append(st['span'])
    extra = []
    used_in_calls = set(k for st in sites for k in st['url'].get('regkeys', []))
    for f, s in b.files.items():
        for loc in x.nt_aliases(f):
            for m in re.finditer(r'(?<![\w$.])%s\.([A-Za-z_$][\w$]*)(\()?' % re.escape(loc), s):
                key = m.group(1)
                if key not in x.registry or key in used_in_calls:
                    continue
                pos = m.start()
                if any(a <= pos <= bb for a, bb in covered[f]):
                    continue
                end = m.end()
                if m.group(2):
                    from jsscan import args_of
                    args, close = args_of(s, m.end() - 1)
                    end = close + 1
                    argtexts = args
                else:
                    argtexts = []
                # Referenz innerhalb der Registerdefinition selbst ueberspringen
                if f == entry and x.registry and pos < x_reg_end(es, x):
                    continue
                url = x.resolve_url(f, s, {loc}, s[pos:end], pos, None)
                if not url or url['dynamic']:
                    continue
                meth, note = guess_method_from_context(s, pos, end)
                from extract_calls import enclosing_fn
                fn = enclosing_fn(x.fns[f], pos)
                extra.append(dict(file=f, pos=pos, callee='nt', calltype='ref', method=meth, url=url, query=list(url.get('query', [])),
                                  body=[], notes=url.get('notes', []) + [note], form=False, blob=False,
                                  names=x._guess_names(s, url, pos, f, fn), span=(pos, end), fn=fn))
    # ---- /api/-Literale ausserhalb jedes erkannten Aufrufs (URL-Bausteine fuer Links/Downloads u. a.)
    from extract_calls import enclosing_fn as _enc
    regs, rege = es.find(ANKER), x_reg_end(es, x)
    for f, s in b.files.items():
        if f.startswith('react-pdf') or f.startswith('index-VDd8otri'):
            continue
        allspans = [sp for st in (sites + extra) if st['file'] == f for sp in [st['span']]]
        for m in re.finditer(r'(["`])(/api/[^"`\n]*)\1', s):
            pos = m.start()
            if f == entry and regs - 3000 < pos < rege:
                continue
            if any(a <= pos <= bb for a, bb in allspans):
                continue
            lit = s[m.start():m.end()]
            url = x.resolve_url(f, s, set(), lit, pos, None)
            if not url or url['dynamic']:
                continue
            fn = _enc(x.fns[f], pos)
            extra.append(dict(file=f, pos=pos, callee='literal', calltype='literal', method='GET',
                              url=url, query=list(url.get('query', [])), body=[],
                              notes=url.get('notes', []) + ['URL-Baustein ohne erkannten XHR-Aufruf (Link/Download-Helfer o. ae.)'],
                              form=False, blob=False, names=x._guess_names(s, url, pos, f, fn),
                              span=(pos, m.end()), fn=fn))
    # Registereintraege, die nirgends referenziert werden
    used = set()
    for st in sites + extra:
        for k in st['url'].get('regkeys', []):
            used.add(k)
    unreferenced = [k for k in x.registry if k not in used]

    all_sites = sites + extra
    rows = build(all_sites)

    # ------------------------------------------------------------ Routen
    routes, upd, lazy = parse_routes(es)
    all_ids = [r['id'] for r in routes.values()]
    comp_to_routes, near, indeg = chunk_routes(b, routes, upd)
    HUB = 40

    def routes_of_site(st):
        f = st['file']
        is_hub = (indeg.get(f, 0) > HUB) or f == entry
        if not is_hub:
            return set(near.get(f, set()))
        # Hilfsmodul / Einstiegs-Chunk: ueber die Aufrufer der umgebenden Funktion gehen,
        # aber nur ueber Aufrufer in NICHT-Hub-Dateien (sonst steht jede Route da)
        out = set()
        fn = st.get('fn')
        if fn and fn['name'] != '<anon>':
            for g, gs, cpos, cargs, gfn in x._callers(f, fn):
                if g == entry or indeg.get(g, 0) > HUB:
                    continue
                out |= near.get(g, set())
        if not out:
            out = {'__hub__'}
        return out

    for r in rows.values():
        r['routes'] = set()
    key_of = {}
    for st in all_sites:
        parts = st['asm']
        if st['url']['dynamic'] and not parts:
            shape = '<dynamisch: %s>' % st['url'].get('expr', '?')[:60]
        else:
            shape = shape_of(parts)
        rows[(st['method'], shape)]['routes'] |= routes_of_site(st)

    # ------------------------------------------------------------ brew-aufrufe.csv
    os.makedirs(out_dir, exist_ok=True)
    rank = {'named': 0, 'keine_parameter': 1, 'inferred': 2, 'positional': 3}
    out_rows = []
    for (method, shape), r in rows.items():
        # beste Schablone: erst Konfidenz, dann Haeufigkeit
        best_t = None
        t_all = list(r['templates'].items())
        best_t = sorted(t_all, key=lambda kv: (-kv[1], kv[0]))[0][0]
        conf = 'keine_parameter'
        if r['conf']:
            cs = set(r['conf'])
            if 'positional' in cs:
                conf = 'positional'
            elif 'inferred' in cs:
                conf = 'inferred'
            elif 'named' in cs:
                conf = 'named'
            else:
                conf = 'keine_parameter'
        # beste Schablone bevorzugt eine mit weniger Platzhalter-Unsicherheit
        alt = sorted(set(t for t, _ in t_all if t != best_t))
        notes = []
        if r['layers']:
            notes.append('Schicht: ' + ', '.join('%s x%d' % (k, v) for k, v in sorted(r['layers'].items())))
        if r['regkeys']:
            notes.append('Registerschluessel: ' + ','.join(r['regkeys']))
        if r['encodings']:
            notes.append('Kodierung: ' + '/'.join(sorted(r['encodings'])))
        if r['blob']:
            notes.append('Antwort als Blob (Download)')
        if alt:
            notes.append('weitere Namensvarianten: ' + ' ; '.join(alt[:3]))
        for n in r['notes']:
            if n not in notes:
                notes.append(n)
        notes.append('%d Stelle(n)' % r['sites'])
        out_rows.append(dict(
            method=method, path_template=best_t,
            query_params=','.join(r['query']),
            body_fields=','.join(r['body']),
            chunks=';'.join(sorted(r['chunks'])),
            routes=fmt_routes(r['routes'], all_ids) if r['routes'] else '',
            param_confidence=conf,
            note=' | '.join(notes)))
    # Registereintraege ohne jede Referenz
    for k in unreferenced:
        ent = x.registry[k]
        from extract_calls import path_name
        tmpl = ''
        prev = ''
        for p_ in ent['parts']:
            if p_[0] == 'lit':
                tmpl += p_[1]
                prev = p_[1]
            else:
                tmpl += '{%s}' % (path_name(prev) or 'p')
        out_rows.append(dict(method='?', path_template=tmpl, query_params='', body_fields='', chunks=entry, routes='',
                             param_confidence='inferred' if ent['params'] else 'keine_parameter',
                             note='nur im Endpunkt-Register definiert (Schluessel %s), im Bundle nirgends aufgerufen/referenziert' % k))
    # Von Hand gelesene Ergaenzungen (Skript kann den Weg ueber Prop-Callbacks nicht folgen). Jede steht hier mit Beleg.
    MANUELL = {
        ('POST', '/api/user/api-tokens'): ('name,scopes,lifetime',
            'MANUELL gelesen: Dialog mt() in index-C_S_dUhD.js ruft onSubmit({name, scopes:[...], lifetime}); Antwort enthaelt authorizeUrl (Browser wird dorthin geleitet)'),
    }
    for r in out_rows:
        ov = MANUELL.get((r['method'], r['path_template']))
        if ov and not r['body_fields']:
            r['body_fields'] = ov[0]
            r['note'] = ov[1] + ' | ' + r['note']
    out_rows.sort(key=lambda r: (r['path_template'], r['method']))
    cols = ['method', 'path_template', 'query_params', 'body_fields', 'chunks', 'routes', 'param_confidence', 'note']
    with open(os.path.join(out_dir, 'brew-aufrufe.csv'), 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in out_rows:
            w.writerow(r)

    # ------------------------------------------------------------ brew-routen.csv
    var_of_id = {}
    parent_of = {}
    for var, u in upd.items():
        base = u['base']
        if base in routes:
            var_of_id[routes[base]['id']] = var
            parent_of[routes[base]['id']] = u['parent']
    var_to_id = {}
    for var, u in upd.items():
        if u['base'] in routes:
            var_to_id[var] = routes[u['base']]['id']
    route_rows = []
    for var, r in routes.items():
        rid = r['id']
        pvar = parent_of.get(rid)
        parent_id = var_to_id.get(pvar, '(Wurzel)') if pvar else ''
        note = ['TanStack-Route-ID: %s' % rid]
        if parent_id:
            note.append('Eltern: %s' % parent_id)
        if r['search']:
            note.append('Suchparameter: %s' % r['search'])
        if r['beforeload']:
            note.append('beforeLoad (Weiterleitung/Pruefung)')
        if r['loader']:
            note.append('loader')
        if rid.rstrip('/') in ('/_user', '/_guest') or (rid != '/' and not rid.endswith('/') and any(o != rid and o.startswith(rid + '/') for o in all_ids)):
            note.append('Layout-Route mit Unterrouten')
        note.append('vorgeladene Chunks: %d' % len(r['deps']))
        route_rows.append(dict(route_path=re.sub(r'\$(\w+)', r'{\1}', public_path(rid)), chunk=r['chunk'] or '(kein eigener Chunk)',
                               note=' | '.join(note), route_id=rid))
    # Links ins Altsystem
    legacy_map = {}
    for f, s in b.files.items():
        if f.startswith('legacy-system-url'):
            for m in re.finditer(r'(\w+):"(/(?:panel|recipes|profile|users|account|menucreator|displays|certificates|signout|login|cmcalc|settings)[^"]*)"', s):
                legacy_map[m.group(2)] = f
    for path, f in sorted(legacy_map.items()):
        route_rows.append(dict(route_path=path, chunk=f, note='Link ins Altsystem (gleicher Ursprung, VITE_BASE_DOMAIN; Pfad ausserhalb /brew), keine Route dieser SPA', route_id=''))
    route_rows.sort(key=lambda r: (r['route_path']))
    with open(os.path.join(out_dir, 'brew-routen.csv'), 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=['route_path', 'chunk', 'note', 'route_id'])
        w.writeheader()
        for r in route_rows:
            w.writerow(r)

    # ------------------------------------------------------------ Hosts
    host_rows, noise_rows = scan_hosts(b)
    with open(os.path.join(out_dir, 'brew-hosts.csv'), 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=['host_or_url', 'kind', 'chunk', 'context'])
        w.writeheader()
        for r in host_rows:
            w.writerow(r)
    with open(os.path.join(out_dir, 'brew-hosts-noise.csv'), 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=['host_or_url', 'kind', 'chunk', 'context'])
        w.writeheader()
        for r in noise_rows:
            w.writerow(r)

    # ------------------------------------------------------------ Rechte / Feature-Gating
    perms = scan_permissions(b)
    with open(os.path.join(out_dir, 'brew-rechte.json'), 'w', encoding='utf-8') as fh:
        json.dump(perms, fh, indent=1, ensure_ascii=False, sort_keys=True)

    # ------------------------------------------------------------ Zahlen
    stats = dict(
        entry=entry, dateien=len(b.files), registry_eintraege=len(x.registry),
        stellen_axios=len(sites), stellen_ref=len(extra),
        distinct_method_path=len(out_rows),
        methoden=dict(Counter(r['method'] for r in out_rows)),
        konfidenz=dict(Counter(r['param_confidence'] for r in out_rows)),
        body_vorhanden_nicht_get=sum(1 for r in out_rows if r['method'] not in ('GET', '?') and r['body_fields']),
        nicht_get=sum(1 for r in out_rows if r['method'] not in ('GET', '?')),
        routen=len([r for r in route_rows if r['route_id']]), altsystem_links=len(legacy_map),
        hosts=len(host_rows), hosts_noise=len(noise_rows),
        ohne_referenz=unreferenced,
        wrapper=[(f, n, sp['type'], sp.get('method')) for f, n, sp in x.wrapper_defs],
        schichten=dict(Counter(st['calltype'] for st in sites)),
        dynamisch=len(x.dynamic),
        body_nicht_lesbar=sum(1 for r in out_rows if 'nicht lesbar' in r['note'] and r['method'] not in ('GET', '?')),
    )
    with open(os.path.join(out_dir, 'brew-statistik.json'), 'w', encoding='utf-8') as fh:
        json.dump(stats, fh, indent=1, ensure_ascii=False)
    print(json.dumps(stats, indent=1, ensure_ascii=False))


def x_reg_end(es, x):
    i = es.find(ANKER)
    start = es.rfind('{', 0, i)
    return find_close(es, start)


NOISE_HOSTS = ('www.w3.org', 'schemas.openxmlformats.org', 'schemas.microsoft.com', 'purl.org', 'openoffice.org',
               'react.dev', 'reactjs.org', 'www.example.com', 'tools.ietf.org', 'json-schema.org', 'bit.ly',
               'github.com', 'purl.oclc.org', 'docs.oasis-open.org', 'www.aiim.org', 'ns.adobe.com', 'redux.js.org',
               'redux-toolkit.js.org', 'tanstack.com', 'www.i18next.com', 'nuqs.dev', 'localhost', 'macVmlSchemaUri',
               'www.sitemaps.org', 'www.ecma-international.org', 'mozilla.org', 'developer.mozilla.org')

KIND = [
    (r'(?:^|\.)foodnotify\.com$', 'erstanbieter'),
    (r'googleapis\.com$', 'karten'),
    (r'(?:^|\.)(unpkg\.com|cdn\.jsdelivr\.net)$', 'cdn (Rueckfall fuer WASM)'),
    (r'(facebook|twitter|youtube|instagram|linkedin)\.com$', 'social (nur Link in E-Mail-Vorlage)'),
    (r'assd\.com', 'Kassen-Anbieter (Platzhalter in Eingabefeld)'),
]


def scan_hosts(b):
    rows = []
    noise = []
    seen = set()
    for f, s in sorted(b.files.items()):
        for m in re.finditer(r'(?:https?|wss?)://[^\s"\'`)\\<>,;]+', s):
            u = m.group(0).rstrip('.')
            hm = re.match(r'\w+://([^/:?#]+)', u)
            host = hm.group(1) if hm else u
            ctx = s[max(0, m.start() - 70):m.end() + 70].replace('\n', ' ')
            if host.startswith('[') or host.startswith('$'):
                continue
            key = (u, f)
            if key in seen:
                continue
            seen.add(key)
            if host in NOISE_HOSTS:
                noise.append(dict(host_or_url=u[:200], kind='noise', chunk=f, context=ctx[:200]))
                continue
            kind = 'unbekannt'
            for rx, k in KIND:
                if re.search(rx, host):
                    kind = k
                    break
            rows.append(dict(host_or_url=u[:200], kind=kind, chunk=f, context=ctx[:200]))
    # eingebettete Build-Konstanten (VITE_*), Werte ungekuerzt (Entscheidung Eugene, 18.11.2026: alle Funde ausschreiben)
    for f, s in sorted(b.files.items()):
        for m in re.finditer(r'(VITE_[A-Z_]+):"([^"]{4,200})"', s):
            v = m.group(2)
            rows.append(dict(host_or_url='%s=%s' % (m.group(1), v), kind='build-konstante (im Bundle eingebettet)',
                             chunk=f, context='Browser-seitiger Schluessel/Konstante im ausgelieferten Bundle; Laenge %d' % len(v)))
        if 'VITE_API_DOMAIN:t' in s and 'window.location.origin' in s:
            rows.append(dict(host_or_url='(gleicher Ursprung: window.location.origin)', kind='backend (API-Basis)', chunk=f,
                             context='VITE_API_DOMAIN, VITE_BASE_DOMAIN und VITE_IMAGE_DOMAIN werden zur Laufzeit auf window.location.origin gesetzt'))
            break
    # dynamische Ziele / Skripte / Frames
    for f, s in sorted(b.files.items()):
        if f.startswith('react-pdf') or f.startswith('index-VDd8otri'):
            continue
        for rx, kind, label in [
            (r'new WebSocket\(', 'websocket', 'WebSocket'),
            (r'new EventSource\(', 'sse', 'EventSource'),
            (r'navigator\.sendBeacon\(', 'beacon', 'sendBeacon'),
            (r'document\.createElement\("script"\)', 'skriptnachladen', 'Skript dynamisch eingehaengt'),
            (r'FlutterBridge', 'flutter-bridge', 'window.FlutterBridge.postMessage'),
            (r'tableau-viz', 'bi-einbettung', 'Tableau-Embedding (<tableau-viz>), Host kommt zur Laufzeit aus der API (tableauUrl)'),
            (r'sentry\.io|@sentry|Sentry\.init|bugsnag|rollbar\.com|honeybadger|logrocket', 'fehlertracking', 'Fehlertracking'),
            (r'posthog\.|mixpanel\.|googletagmanager\.com|google-analytics\.com|gtag\(|segment\.com|hotjar\.com|clarity\.ms|plausible\.io|matomo|datadoghq|fullstory\.com', 'analytics', 'Analytics-/Tracking-Bezug'),
            (r'intercom\.io|widget\.intercom|crisp\.chat|zendesk\.com|hubspot\.com|freshchat|drift\.com|tawk\.to', 'chat-widget', 'Chat-Widget'),
            (r'launchdarkly|growthbook|unleash|flagsmith', 'feature-flags', 'Feature-Flag-Dienst'),
        ]:
            ms = list(re.finditer(rx, s))
            if ms:
                m = ms[0]
                rows.append(dict(host_or_url='(%s)' % label, kind=kind, chunk=f,
                                 context=s[max(0, m.start() - 70):m.end() + 90].replace('\n', ' ')[:200]))
    return rows, noise


def scan_permissions(b):
    res = defaultdict(lambda: defaultdict(set))
    pats = {
        'master': r'\.master\(\s*"([^"]+)"',
        'hasModule': r'\.hasModule\(\s*"([^"]+)"',
        'erp': r'(?<![\w$])\w+\.erp\(\s*((?:"[^"]+"\s*,?\s*)+)\)',
        'shop': r'(?<![\w$])\w+\.shop\(\s*((?:"[^"]+"\s*,?\s*)+)\)',
        'hasSubuserPermission': r'\.hasSubuserPermission\(\s*((?:"[^"]+"\s*,?\s*)+)\)',
        'hasRole': r'\.hasRole\(\s*"([^"]+)"',
        'roles.includes': r'roles\??\.includes\(\s*"([^"]+)"',
        'allowedModules': r'allowedModules(?:\?\.|\.)([A-Za-z_]+)|allowedModules\[\s*"([^"]+)"',
        'posPermissions': r'posPermissions\??\.([A-Za-z_]+)',
        'erpPermissions': r'erpPermissions\??\.([A-Za-z_]+)|erpPermissions\[\s*"([^"]+)"',
        'shopPermissions': r'shopPermissions\??\.([A-Za-z_]+)|shopPermissions\[\s*"([^"]+)"',
        'subuserPerms': r'subuserPerms\??\.([A-Za-z_]+)|subuserPerms\[\s*"([^"]+)"',
        'masterPermissions': r'masterPermissions\??\.([A-Za-z_]+)|masterPermissions\[\s*"([^"]+)"',
        'ROLE_/IS_-Literale': r'"((?:ROLE|IS)_[A-Z_]+)"',
    }
    for f, s in sorted(b.files.items()):
        for k, p in pats.items():
            for m in re.finditer(p, s):
                for g in [x for x in m.groups() if x]:
                    names = re.findall(r'"([^"]+)"', g) if '"' in g else [g]
                    for n in names:
                        res[k][n].add(f)
    return {k: {n: sorted(fs) for n, fs in v.items()} for k, v in res.items()}


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
