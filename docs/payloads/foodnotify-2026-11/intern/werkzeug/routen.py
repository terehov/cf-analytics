"""Routentabelle (TanStack Router, dateibasiert) und Chunk -> Route."""
import re
from collections import defaultdict, deque
from jsscan import find_close, split_top, args_of, object_entries, object_keys
from aufrufe import index_functions, IDENT


def map_deps(entry_src):
    m = re.search(r'__vite__mapDeps=\(i,m=__vite__mapDeps,d=\(m\.f\|\|\(m\.f=\[', entry_src)
    if not m:
        return []
    a = m.end() - 1
    close = find_close(entry_src, a)
    return re.findall(r'"brew-assets/([^"]+)"', entry_src[a:close])


def parse_routes(entry_src):
    deps = map_deps(entry_src)
    lazy = {}   # var -> (chunk, [dep chunks])
    for m in re.finditer(r'(%s)=\(\)=>(%s)\(\(\)=>import\("\./([^"]+)"\)(?:,(?:__vite__mapDeps\(\[([\d,]*)\]\)|\[\]))?\)' % (IDENT, IDENT), entry_src):
        idxs = [int(x) for x in (m.group(4) or '').split(',') if x != '']
        lazy[m.group(1)] = (m.group(3), [deps[i] for i in idxs if i < len(deps)])
    fns = index_functions(entry_src)
    fn_by_name = {}
    for f in fns:
        fn_by_name.setdefault(f['name'], f)
    routes = {}   # var -> dict(id, comp_var, chunk, deps, opts)
    for m in re.finditer(r'(?<![\w$.])(%s)=(%s)\("([^"]+)"\)\(\{' % (IDENT, IDENT), entry_src):
        var, rid = m.group(1), m.group(3)
        ob = m.end() - 1
        close = find_close(entry_src, ob)
        ent = object_entries(entry_src[ob:close + 1]) or []
        entd = dict(ent)
        chunk = None
        cdeps = []
        comp = entd.get('component')
        if comp:
            mm = re.match(r'%s\((%s),"component"\)' % (IDENT, IDENT), comp)
            if mm and mm.group(1) in lazy:
                chunk, cdeps = lazy[mm.group(1)]
            else:
                chunk = None
        opts = [k for k, _ in ent]
        search = None
        vs = entd.get('validateSearch')
        if vs:
            search = vs
            fdef = None
            if re.fullmatch(IDENT, vs) and vs in fn_by_name:
                fdef = fn_by_name[vs]
                a, e = fdef['body']
                src = entry_src[fdef['start']:e]
            else:
                src = vs
            m1 = re.match(r'(?:\(\s*)?(%s)\s*(?:\)\s*)?=>' % IDENT, src) or re.match(r'%s\s*=\s*(?:\(\s*)?(%s)' % (IDENT, IDENT), src)
            names = []
            if m1:
                pn = m1.group(1)
                names = sorted(set(re.findall(r'(?<![\w$])%s\.([A-Za-z_$][\w$]*)' % re.escape(pn), src)) | set(re.findall(r'(?<![\w$])%s\?\.([A-Za-z_$][\w$]*)' % re.escape(pn), src)))
            if not names and vs == 'invitation':
                names = []
            search = ','.join(names) if names else vs[:60]
        routes[var] = dict(id=rid, chunk=chunk, deps=cdeps, opts=opts, search=search,
                           beforeload=('beforeLoad' in entd), loader=('loader' in entd))
    # .update({id, path, getParentRoute})
    upd = {}
    for m in re.finditer(r'(?<![\w$.])(%s)=(%s)\.update\(\{' % (IDENT, IDENT), entry_src):
        ob = m.end() - 1
        close = find_close(entry_src, ob)
        ent = dict(object_entries(entry_src[ob:close + 1]) or [])
        pm = re.search(r'=>(%s)' % IDENT, ent.get('getParentRoute', ''))
        upd[m.group(1)] = dict(base=m.group(2), id=(ent.get('id') or '').strip('"'),
                               path=(ent.get('path') or '').strip('"') if ent.get('path') else None,
                               parent=pm.group(1) if pm else None)
    return routes, upd, lazy


def public_path(route_id, base='/brew'):
    segs = [x for x in route_id.split('/') if x]
    keep = []
    for sg in segs:
        if sg.startswith('_') and not sg.startswith('__'):
            continue      # pfadloses Layout (_user, _guest)
        if sg.startswith('(') and sg.endswith(')'):
            continue      # Gruppe (reskin)
        if sg.endswith('_') and len(sg) > 1:
            sg = sg[:-1]  # TanStack: 'shop_' = nicht verschachtelt, URL-Segment ist 'shop'
        keep.append(sg)
    p = '/' + '/'.join(keep)
    return (base + p) if p != '/' else base + '/'


def chunk_routes(bundle, routes, upd):
    """chunk -> Liste Routen, die ihn laden. Zwei Mengen:
    own   = Routenkomponente ist dieser Chunk
    near  = Chunk wird von der Routenkomponente direkt oder ueber hoechstens eine Zwischenstation statisch importiert
    """
    comp_to_routes = defaultdict(list)
    for v, r in routes.items():
        if r['chunk']:
            comp_to_routes[r['chunk']].append(r['id'])
    # Hubs: Chunks, die von sehr vielen importiert werden, tragen nicht zur Zuordnung bei
    indeg = defaultdict(int)
    for f, ds in bundle.static_deps.items():
        for d in ds:
            indeg[d] += 1
    HUB = 40
    near = defaultdict(set)
    for chunk, rids in comp_to_routes.items():
        seen = {chunk: 0}
        dq = deque([chunk])
        while dq:
            c = dq.popleft()
            d0 = seen[c]
            if d0 >= 3:
                continue
            for nx in (bundle.static_deps.get(c, set()) | bundle.dyn_deps.get(c, set())):
                if nx in seen:
                    continue
                seen[nx] = d0 + 1
                if indeg.get(nx, 0) <= HUB:
                    dq.append(nx)
        for c in seen:
            for rid in rids:
                near[c].add(rid)
    return comp_to_routes, near, indeg
