"""Alle HTTP-Aufrufstellen des Bundles: Methode, Pfadvorlage, Query, Body, Chunk.

Lesen = steht so im Code. Schliessen = Heuristik; jede Heuristik ist in `note`
oder `param_confidence` sichtbar gemacht.
"""
import re
from collections import defaultdict, Counter
from jsscan import (find_close, split_top, args_of, expr_end, parse_template, string_value,
                    object_keys, object_entries)
from aufrufe import (index_functions, param_names, enclosing_fn, find_registry, IDENT, KEYWORDS)

HTTP_MEMBERS = ('get', 'post', 'put', 'patch', 'delete', 'request')
GENERIC_NAMES = {'id', 'data', 'value', 'key', 'item', 'row', 'e', 't', 'n', 'r', 'o', 'name', 'type'}


def kebab_to_camel(seg):
    parts = re.split(r'[-_]', seg)
    return parts[0] + ''.join(p[:1].upper() + p[1:] for p in parts[1:])


def singular(w):
    if w.endswith('ies'):
        return w[:-3] + 'y'
    if w.endswith('sses') or w.endswith('ss'):
        return w
    if w.endswith('s') and len(w) > 3:
        return w[:-1]
    return w


def path_name(prev_literal):
    """Name aus dem Pfadsegment vor dem Platzhalter ('inferred')."""
    segs = [x for x in prev_literal.split('/') if x]
    if not segs:
        return None
    last = segs[-1]
    if '?' in last or '=' in last:
        return None
    if last == 'api':
        return None
    w = kebab_to_camel(last)
    return singular(w) + 'Id'


def split_ternary(expr):
    """cond?a:b auf Top-Level -> (cond,a,b) oder None"""
    from jsscan import skip_string, find_close
    j = 0
    n = len(expr)
    q = None
    while j < n:
        c = expr[j]
        if c in '"\'`':
            j = skip_string(expr, j)
            continue
        if c in '([{':
            j = find_close(expr, j) + 1
            continue
        if c == '?' and expr[j + 1:j + 2] not in ('.', '?') and expr[j - 1:j] != '?':
            q = j
            break
        j += 1
    if q is None:
        return None
    j = q + 1
    depth_q = 0
    while j < n:
        c = expr[j]
        if c in '"\'`':
            j = skip_string(expr, j)
            continue
        if c in '([{':
            j = find_close(expr, j) + 1
            continue
        if c == '?' and expr[j + 1:j + 2] not in ('.', '?'):
            depth_q += 1
        elif c == ':':
            if depth_q == 0:
                return expr[:q].strip(), expr[q + 1:j].strip(), expr[j + 1:].strip()
            depth_q -= 1
        j += 1
    return None


class Extractor:
    def __init__(self, bundle, entry_file):
        self.b = bundle
        self.entry = entry_file
        es = bundle.files[entry_file]
        self.nt_name, _, self.registry = find_registry(es)
        self.fns = {f: index_functions(s) for f, s in bundle.files.items()}
        self.legacy = self._classify_legacy()
        self.sites = []
        self.dynamic = []
        self.wrapper_defs = []     # nur fuer die Doku
        self._caller_cache = {}

    # ------------------------------------------------------------ Legacy-Primitive
    def _classify_legacy(self):
        """Liest legacy-http: welcher Export ist GET-JSON, GET-Blob, Request(method,url,data,opts)."""
        out = {}
        for f, s in self.b.files.items():
            if not f.startswith('legacy-http'):
                continue
            for fn in index_functions(s):
                a, e = fn['body']
                body = s[a:e]
                if fn['kind'] not in ('function', 'arrow_paren', 'arrow_single'):
                    continue
                if '.request(' in body:
                    out[(f, fn['name'])] = dict(type='req', method_idx=0, url_idx=1, data_idx=2, opts_idx=3, blob=False)
                elif 'responseType:"blob"' in body:
                    out[(f, fn['name'])] = dict(type='get', method='GET', url_idx=0, params_idx=1, blob=True)
                elif '.get(' in body and 'params:' in body:
                    out[(f, fn['name'])] = dict(type='get', method='GET', url_idx=0, params_idx=1, blob=False)
        return out

    # ------------------------------------------------------------ Aliase
    def aliases(self, f):
        """Alias -> Spezifikation. Spezifikationen: dict(type=...)."""
        b = self.b
        spec = {}
        if f == self.entry:
            spec['ot'] = dict(type='ot')
            spec['UM'] = dict(type='raw')
        for loc in b.imports[f]:
            o = b.resolve(f, loc)
            if o == (self.entry, 'ot'):
                spec[loc] = dict(type='ot')
            elif o == (self.entry, 'UM'):
                spec[loc] = dict(type='raw')
            elif o in self.legacy:
                spec[loc] = dict(self.legacy[o])
        return spec

    def nt_aliases(self, f):
        if f == self.entry:
            return {self.nt_name}
        out = set()
        for loc in self.b.imports[f]:
            if self.b.resolve(f, loc) == (self.entry, self.nt_name):
                out.add(loc)
        return out

    # ------------------------------------------------------------ Hauptlauf
    def run(self):
        for f, s in self.b.files.items():
            if f.startswith('legacy-http'):
                continue
            spec = self.aliases(f)
            nts = self.nt_aliases(f)
            fns = self.fns[f]
            callees = dict(spec)  # name -> spec
            # lokale Wrapper (bis zum Fixpunkt)
            for _ in range(3):
                added = self._find_wrappers(f, s, fns, callees, nts)
                if not added:
                    break
            self._scan_calls(f, s, fns, callees, nts)

    # ------------------------------------------------------------ Wrapper-Erkennung
    def _find_wrappers(self, f, s, fns, callees, nts):
        added = 0
        for fn in fns:
            name = fn['name']
            if name in callees or fn['kind'] == 'method':
                continue
            if fn['kind'] == 'static':
                continue
            a, e = fn['body']
            if e - a > 1500:
                continue
            body = s[a:e]
            pnames = param_names(fn['params'])
            if not pnames:
                continue
            for cname, cspec in list(callees.items()):
                for call in self._calls_in(body, cname, cspec):
                    args = call['args']
                    ui = call['url_idx']
                    if ui is None or ui >= len(args):
                        continue
                    uexpr = args[ui].strip()
                    if uexpr in pnames:
                        new = dict(type='wrap', inner=cspec, method=call.get('method'),
                                   url_idx=pnames.index(uexpr), form=False)
                        # Daten- und Query-Parameter
                        di = call.get('data_idx')
                        if di is not None and di < len(args):
                            idents = re.findall(IDENT, args[di])
                            for x in idents:
                                if x in pnames:
                                    new['data_idx'] = pnames.index(x)
                                    break
                            if 'form:!0' in body or 'form:true' in body:
                                new['form'] = True
                        pi = call.get('params_expr')
                        if pi:
                            for x in re.findall(IDENT, pi):
                                if x in pnames:
                                    new['params_idx'] = pnames.index(x)
                                    break
                        mi = call.get('method_expr')
                        if mi and mi in pnames:
                            new['method_idx'] = pnames.index(mi)
                        callees[name] = new
                        self.wrapper_defs.append((f, name, new))
                        added += 1
                        break
                if name in callees:
                    break
        return added

    def _calls_in(self, text, cname, cspec):
        """Aufrufe von cname in text -> Liste dict(args, url_idx, method, data_idx, params_expr)"""
        out = []
        t = cspec['type']
        if t in ('ot', 'raw'):
            rx = re.compile(r'(?<![\w$.])%s\s*\.\s*(%s)\s*\(' % (re.escape(cname), '|'.join(HTTP_MEMBERS)))
        else:
            rx = re.compile(r'(?<![\w$.])%s\s*\(' % re.escape(cname))
        for m in rx.finditer(text):
            op = m.end() - 1
            args, close = args_of(text, op)
            rec = dict(args=args, pos=m.start(), end=close)
            if t in ('ot', 'raw'):
                member = m.group(1)
                if member == 'request':
                    # axios.request({method,url,data,params})
                    if args and args[0].startswith('{'):
                        ent = dict(object_entries(args[0]) or [])
                        rec['obj_cfg'] = ent
                    rec['url_idx'] = None
                    rec['method'] = None
                    continue_flag = True
                else:
                    rec['method'] = member.upper()
                    rec['url_idx'] = 0
                    ci = 1 if member in ('get', 'delete') else 2
                    rec['data_idx'] = None if member in ('get', 'delete') else 1
                    cfg = args[ci] if len(args) > ci else None
                    pe = None
                    if cfg and cfg.startswith('{'):
                        pe = dict(object_entries(cfg) or []).get('params')
                    rec['params_expr'] = pe
                    rec['cfg_expr'] = cfg
            elif t == 'get':
                rec['method'] = 'GET'
                rec['url_idx'] = cspec['url_idx']
                rec['params_expr'] = args[cspec['params_idx']] if len(args) > cspec['params_idx'] else None
                rec['data_idx'] = None
            elif t == 'req':
                rec['method_expr'] = args[0] if args else None
                sv = string_value(args[0]) if args else None
                rec['method'] = sv.upper() if sv else None
                rec['url_idx'] = cspec['url_idx']
                rec['data_idx'] = cspec['data_idx']
                rec['opts_expr'] = args[cspec['opts_idx']] if len(args) > cspec['opts_idx'] else None
                pe = None
                if rec['opts_expr'] and rec['opts_expr'].startswith('{'):
                    ent = dict(object_entries(rec['opts_expr']) or [])
                    pe = ent.get('params')
                rec['params_expr'] = pe
            elif t == 'wrap':
                rec['method'] = cspec.get('method')
                if rec['method'] is None and cspec.get('method_idx') is not None and cspec['method_idx'] < len(args):
                    sv = string_value(args[cspec['method_idx']])
                    rec['method'] = sv.upper() if sv else None
                if rec['method'] is None and cspec.get('inner', {}).get('type') == 'req':
                    pass
                rec['url_idx'] = cspec['url_idx']
                rec['data_idx'] = cspec.get('data_idx')
                pi = cspec.get('params_idx')
                rec['params_expr'] = args[pi] if (pi is not None and pi < len(args)) else None
            out.append(rec)
        return out

    # ------------------------------------------------------------ Aufrufe sammeln
    def _scan_calls(self, f, s, fns, callees, nts):
        for cname, cspec in callees.items():
            if cspec['type'] == 'wrap' and False:
                continue
            for rec in self._calls_in(s, cname, cspec):
                self._handle(f, s, fns, callees, nts, cname, cspec, rec)

    def _handle(self, f, s, fns, callees, nts, cname, cspec, rec):
        args = rec['args']
        pos = rec['pos']
        fn = enclosing_fn(fns, pos)
        pnames = param_names(fn['params']) if fn else []
        method = rec.get('method')
        # axios.request({...})
        if 'obj_cfg' in rec:
            cfg = rec['obj_cfg']
            uexpr = cfg.get('url')
            mv = string_value(cfg.get('method', '')) if cfg.get('method') else None
            method = mv.upper() if mv else None
            rec['data_expr'] = cfg.get('data')
            rec['params_expr'] = cfg.get('params')
            if uexpr is None:
                return
        else:
            ui = rec.get('url_idx')
            if ui is None or ui >= len(args):
                return
            uexpr = args[ui]
            di = rec.get('data_idx')
            rec['data_expr'] = args[di] if (di is not None and di < len(args)) else None
        uexpr = uexpr.strip()
        # Durchreichen innerhalb eines Wrappers ueberspringen (die Wrapper selbst sind keine Stelle)
        if fn and uexpr in pnames and fn['name'] in callees and callees[fn['name']].get('type') == 'wrap':
            return
        urls = self.resolve_url_multi(f, s, nts, uexpr, pos, fn)
        if len(urls) > 1:
            for u in urls:
                u['notes'] = u.get('notes', []) + ['einer von %d Zweigen (Bedingung/Hilfsfunktion)' % len(urls)]
        for url in urls:
            self._handle_one(f, s, fns, callees, nts, cname, cspec, rec, args, pos, fn, method, url)

    def resolve_url_multi(self, f, s, nts, expr, pos, fn, depth=0):
        expr = expr.strip()
        tern = split_ternary(expr)
        if tern and depth < 3:
            out = []
            for br in (tern[1], tern[2]):
                out += self.resolve_url_multi(f, s, nts, br, pos, fn, depth + 1)
            return out
        u = self.resolve_url(f, s, nts, expr, pos, fn)
        if u is not None and u['dynamic'] and depth < 3:
            m = re.fullmatch(r'(%s)\((.*)\)' % IDENT, expr, re.S)
            if m:
                for g in self.fns[f]:
                    if g['name'] == m.group(1) and g['kind'].startswith('arrow') or (g['name'] == m.group(1) and g['kind'] == 'function'):
                        a, e = g['body']
                        body = s[a:e].strip()
                        if body.startswith('{'):
                            mm = re.search(r'return\s+(.*?);?\}$', body, re.S)
                            body = mm.group(1) if mm else ''
                        if body:
                            sub = self.resolve_url_multi(f, s, nts, body, pos, fn, depth + 1)
                            for x in sub:
                                x['notes'] = x.get('notes', []) + ['Url ueber Hilfsfunktion %s()' % m.group(1)]
                            if sub:
                                return sub
                        break
        return [u] if u is not None else [None]

    def _handle_one(self, f, s, fns, callees, nts, cname, cspec, rec, args, pos, fn, method, url):
        short = len(cname) <= 2 and cspec['type'] in ('get', 'req', 'wrap')
        if url is None:
            # nicht aufloesbar
            uexpr = args[rec['url_idx']] if rec.get('url_idx') is not None and rec['url_idx'] < len(args) else ''
            if cspec['type'] in ('ot', 'raw') or not short:
                self.dynamic.append(dict(file=f, pos=pos, callee=cname, method=method, expr=uexpr[:160], ctx=s[max(0, pos - 80):pos + 140]))
            return
        if url['dynamic'] and short:
            # kurzer Name, Url nicht lesbar -> vermutlich fremde Funktion gleichen Namens
            return
        # Query
        q = list(url.get('query', []))
        pe = rec.get('params_expr')
        qnote = []
        if pe:
            ks = self.resolve_keys(f, s, pe, pos, fn, qnote)
            if ks:
                q += ks
        # Body
        body = []
        bnote = []
        de = rec.get('data_expr')
        if de and de not in ('null', 'void 0', 'undefined', '!0', '""', "''"):
            ks = self.resolve_keys(f, s, de, pos, fn, bnote, body_mode=True)
            if ks is not None:
                body += ks
        if method is None and cspec['type'] == 'wrap':
            method = '?'
        site = dict(file=f, pos=pos, callee=cname, calltype=cspec['type'], method=method or '?',
                    url=url, query=q, body=body, notes=url.get('notes', []) + qnote + bnote,
                    form=bool(cspec.get('form')), blob=bool(cspec.get('blob')),
                    names=self._guess_names(s, url, pos, f, fn), span=(pos, rec.get('end', pos)), fn=fn)
        self.sites.append(site)

    # ------------------------------------------------------------ URL-Aufloesung
    NTREF = None

    def resolve_url(self, f, s, nts, expr, pos, fn, depth=0):
        """-> dict(parts=[('lit',t)|('slot',origin,idx,argexpr)], query=[..], dynamic=bool, notes=[..])"""
        expr = expr.strip()
        notes = []
        query = []
        parts = []
        dynamic = False
        regkeys = []

        def add_registry(key, argtexts):
            ent = self.registry.get(key)
            if ent is None:
                return False
            regkeys.append(key)
            pn = ent['params']
            for kind, val in ent['parts']:
                if kind == 'lit':
                    parts.append(('lit', val))
                else:
                    v = val.strip()
                    m = re.match(r'encodeURIComponent\((%s)\)$' % IDENT, v)
                    v = m.group(1) if m else v
                    if v in pn:
                        i = pn.index(v)
                        parts.append(('slot', 'reg:' + key, i, argtexts[i] if i < len(argtexts) else None))
                    else:
                        parts.append(('slot', 'reg:' + key, -1, None))
            return True

        def handle_expr_text(t):
            nonlocal dynamic
            t = t.strip()
            m = re.match(r'(%s)\.(%s)(?:\((.*)\))?$' % (IDENT, IDENT), t, re.S)
            if m and m.group(1) in nts:
                key = m.group(2)
                args = []
                if m.group(3) is not None:
                    a, _ = args_of('(' + m.group(3) + ')', 0)
                    args = a
                if add_registry(key, args):
                    return True
                notes.append('Registerschluessel unbekannt: ' + key)
            return False

        if expr.startswith('`'):
            tparts = parse_template(expr)
            for kind, val in tparts:
                if kind == 'lit':
                    parts.append(('lit', val))
                else:
                    if handle_expr_text(val):
                        continue
                    v = val.strip()
                    m = re.match(r'encodeURIComponent\((.+)\)$', v, re.S)
                    arg = m.group(1).strip() if m else v
                    parts.append(('slot', 'lit', None, arg))
        elif string_value(expr) is not None:
            parts.append(('lit', string_value(expr)))
        elif handle_expr_text(expr):
            pass
        else:
            # Konkatenation "a"+x+"b"
            segs = split_top(expr, 0, len(expr), sep='+')
            if len(segs) > 1:
                ok = False
                for a, b in segs:
                    seg = expr[a:b].strip()
                    sv = string_value(seg)
                    if sv is not None:
                        parts.append(('lit', sv)); ok = True
                    elif handle_expr_text(seg):
                        ok = True
                    else:
                        parts.append(('slot', 'lit', None, seg))
                if not ok:
                    return None
            else:
                # identifier -> lokale Konstante?
                if re.fullmatch(IDENT, expr):
                    src = self._local_const(s, expr, pos)
                    if src and depth < 2:
                        r = self.resolve_url(f, s, nts, src, pos, fn, depth + 1)
                        if r:
                            r['notes'].append('Url ueber lokale Variable %s' % expr)
                            return r
                return dict(parts=[], query=[], dynamic=True, notes=['Ausdruck: ' + expr[:100]], expr=expr)
        # fuehrendes Literal muss wie ein Pfad aussehen, sonst ist es keine Backend-Url
        first = parts[0] if parts else None
        if first is None:
            return None
        if first[0] == 'lit':
            if not first[1].startswith('/') and not first[1].startswith('http'):
                return None
        else:
            # Url beginnt mit Slot: nur akzeptieren wenn dahinter ein Pfadliteral kommt
            if len(parts) < 2 or parts[1][0] != 'lit' or not parts[1][1].startswith('/'):
                return dict(parts=[], query=[], dynamic=True, notes=['Url beginnt mit Variable'], expr=expr)
        # Query aus Literal ?a=b&c=d bzw. ?${x}
        newparts = []
        i = 0
        qslot = None
        while i < len(parts):
            p = parts[i]
            if p[0] == 'lit' and '?' in p[1]:
                pre, post = p[1].split('?', 1)
                if pre:
                    newparts.append(('lit', pre))
                for kv in post.split('&'):
                    k = kv.split('=')[0]
                    if k:
                        query.append(k)
                if i + 1 < len(parts) and parts[i + 1][0] == 'slot' and post == '':
                    qslot = parts[i + 1][3]
                    notes.append('Query als Variable: ' + str(qslot))
                    i += 2
                    # Rest ignorieren
                    break
                # alles danach ist Query
                for q in parts[i + 1:]:
                    if q[0] == 'lit':
                        for kv in q[1].split('&'):
                            k = kv.split('=')[0]
                            if k:
                                query.append(k)
                    else:
                        notes.append('Query-Teil dynamisch: ' + str(q[3])[:40])
                break
            newparts.append(p)
            i += 1
        if qslot:
            ks = self._urlsearchparams_keys(s, qslot, pos)
            if ks is not None:
                query += ks
        return dict(parts=newparts, query=query, dynamic=dynamic, notes=notes, regkeys=regkeys)

    def _local_const(self, s, ident, pos):
        w = s[max(0, pos - 800):pos]
        ms = list(re.finditer(r'(?<![\w$.])%s\s*=\s*' % re.escape(ident), w))
        if not ms:
            return None
        m = ms[-1]
        st = max(0, pos - 800) + m.end()
        return s[st:expr_end(s, st)]

    def _urlsearchparams_keys(self, s, ident, pos):
        w0 = max(0, pos - 1500)
        w = s[w0:pos]
        ms = list(re.finditer(r'(?<![\w$.])%s\s*=\s*new URLSearchParams\(' % re.escape(ident), w))
        if not ms:
            return None
        m = ms[-1]
        a, close = args_of(s, w0 + m.end() - 1)
        keys = []
        if a and a[0].startswith('{'):
            keys += object_keys(a[0]) or []
        # spaeter .set("k") / .append("k")
        tail = s[w0 + close:pos]
        for mm in re.finditer(r'(?<![\w$.])%s\s*\.\s*(?:set|append)\(\s*"([^"]+)"' % re.escape(ident), tail):
            keys.append(mm.group(1))
        return keys

    # ------------------------------------------------------------ Schluessel (Query/Body)
    def resolve_keys(self, f, s, expr, pos, fn, notes, body_mode=False, depth=0):
        expr = expr.strip()
        if not expr:
            return None
        if expr.startswith('{'):
            ks = object_keys(expr)
            # params:{...} verschachtelt? (bei cfg-Objekten)
            return ks
        m = re.match(r'(?:\(\s*)?\{', expr)
        m = re.match(r'new FormData', expr)
        if m:
            notes.append('multipart/FormData')
            return []
        # Identifier
        if re.fullmatch(IDENT, expr):
            # 1) lokale Definition
            w0 = max(0, pos - 2500)
            w = s[w0:pos]
            ms = list(re.finditer(r'(?<![\w$.])%s\s*=\s*' % re.escape(expr), w))
            if ms:
                m2 = ms[-1]
                st = w0 + m2.end()
                rhs = s[st:expr_end(s, st)]
                if rhs.startswith('{'):
                    notes.append('Schluessel aus lokalem Objektliteral %s' % expr)
                    return object_keys(rhs)
                if rhs.startswith('new FormData'):
                    notes.append('multipart/FormData (append: %s)' % ','.join(self._formdata_keys(s, expr, st, pos)))
                    return ['[FormData] ' + k for k in self._formdata_keys(s, expr, st, pos)]
                if rhs.startswith('new URLSearchParams'):
                    ks = self._urlsearchparams_keys(s, expr, pos)
                    return ks
            # 2) Parameter der umgebenden Funktion -> Aufrufer
            if fn:
                pn = param_names(fn['params'])
                if expr in pn and fn['name'] == '<anon>' and depth < 3:
                    ks = self._mutation_keys(f, s, fn, pn.index(expr), depth + 1)
                    if ks is not None:
                        notes.append('Schluessel aus mutate()/mutateAsync()-Aufrufen gelesen')
                        return ks
                if expr in pn and fn['name'] != '<anon>' and depth < 2:
                    ks = self._callers_keys(f, fn, pn.index(expr), depth + 1)
                    if ks is not None:
                        notes.append('Schluessel aus Aufrufern von %s() gelesen' % fn['name'])
                        return ks
            notes.append('%s nicht lesbar: %s' % ('Body' if body_mode else 'Query', expr[:40]))
            return None
        # Aufruf f(x) mit lokaler/importierter Definition die ein Objektliteral liefert
        m = re.match(r'(%s)\(' % IDENT, expr)
        if m and depth < 2:
            ks = self._factory_keys(f, m.group(1))
            if ks is not None:
                notes.append('Schluessel aus Funktion %s() gelesen' % m.group(1))
                return ks
        m = re.match(r'(\{.*\})\s*$', expr, re.S)
        notes.append('%s Ausdruck nicht lesbar: %s' % ('Body' if body_mode else 'Query', expr[:50]))
        return None

    def _formdata_keys(self, s, ident, st, pos):
        seg = s[st:pos + 400]
        return re.findall(r'(?<![\w$.])%s\.append\(\s*"([^"]+)"' % re.escape(ident), seg)

    def _factory_keys(self, f, name):
        s = self.b.files[f]
        origin = self.b.resolve(f, name)
        of, oname = origin
        os_ = self.b.files.get(of)
        if os_ is None:
            return None
        for fn in self.fns[of]:
            if fn['name'] == oname:
                a, e = fn['body']
                body = os_[a:e].strip()
                if body.startswith('(') and body.endswith(')'):
                    body = body[1:-1].strip()
                if body.startswith('{') and not body.startswith('{return'):
                    k = object_keys(body)
                    # Block-Rumpf wird nicht als Objekt gelesen
                    if k and not any(x.startswith('?') for x in k):
                        return k
                m = re.search(r'return\s*(\{)', body)
                if m:
                    return object_keys(body[m.start(1):])
        return None

    def _mutation_keys(self, f, s, fn, idx, depth):
        """mutationFn:async e=>... -> Argumente der mutate()/mutateAsync()-Aufrufe derselben Datei."""
        pre = s[max(0, fn['start'] - 700):fn['start']]
        if not re.search(r'mutationFn:\s*(?:async\s*)?$', pre):
            return None
        ms = list(re.finditer(r'([\w$]+)\s*=\s*[\w$.]+\(\{', pre))
        if not ms:
            return None
        var = ms[-1].group(1)
        keys = []
        found = False
        for m in re.finditer(r'(?<![\w$.])%s\s*\.\s*(?:mutate|mutateAsync)\(' % re.escape(var), s):
            a, close = args_of(s, m.end() - 1)
            if idx >= len(a):
                continue
            found = True
            notes = []
            gfn = enclosing_fn(self.fns[f], m.start())
            ks = self.resolve_keys(f, s, a[idx], m.start(), gfn, notes, body_mode=True, depth=depth)
            if ks:
                keys += ks
        if not found:
            return None
        seen = []
        for k in keys:
            if k not in seen:
                seen.append(k)
        return seen if seen else None

    def _callers(self, f, fn):
        """Aufrufer der Funktion fn aus Datei f: Liste (datei, text, pos, args, umgebende_funktion)"""
        keyc = ('callers', f, fn['name'], fn['start'])
        if keyc in self._caller_cache:
            return self._caller_cache[keyc]
        s = self.b.files[f]
        cls = None
        if fn['kind'] in ('static', 'method'):
            for m in re.finditer(r'class\s+(%s)\b[^{]*\{' % IDENT, s[:fn['start']]):
                cls = m.group(1)
        name = fn['name']
        targets = []
        if cls:
            for g in self.b.files:
                locs = ([cls] if g == f else []) + [l for l in self.b.imports[g] if self.b.resolve(g, l) == (f, cls)]
                for loc in locs:
                    targets.append((g, re.compile(r'(?<![\w$.])%s\s*\.\s*%s\s*\(' % (re.escape(loc), re.escape(name)))))
        elif fn['kind'] in ('function', 'arrow_paren', 'arrow_single'):
            targets.append((f, re.compile(r'(?<![\w$.])%s\s*\(' % re.escape(name))))
            for g in self.b.files:
                if g == f:
                    continue
                for loc in self.b.imports[g]:
                    if self.b.resolve(g, loc) == (f, name):
                        targets.append((g, re.compile(r'(?<![\w$.])%s\s*\(' % re.escape(loc))))
        out = []
        for g, rx in targets:
            gs = self.b.files[g]
            for m in rx.finditer(gs):
                if g == f and fn['start'] <= m.start() < fn['body'][1]:
                    continue
                a, close = args_of(gs, m.end() - 1)
                out.append((g, gs, m.start(), a, enclosing_fn(self.fns[g], m.start())))
        self._caller_cache[keyc] = out
        return out

    def _callers_keys(self, f, fn, idx, depth):
        """Schluessel des idx-ten Arguments in Aufrufern der Funktion fn (Datei f)."""
        keys = []
        found = False
        for g, gs, pos, a, gfn in self._callers(f, fn):
            if idx >= len(a):
                continue
            found = True
            notes = []
            ks = self.resolve_keys(g, gs, a[idx], pos, gfn, notes, body_mode=True, depth=depth)
            if ks:
                keys += ks
        if not found:
            return None
        seen = []
        for k in keys:
            if k not in seen:
                seen.append(k)
        return seen if seen else None

    # ------------------------------------------------------------ Parameter-Namen
    NAME_OK = re.compile(r'^[a-z][A-Za-z0-9]*(Id|Ids|Name|Slug|Key|Uid|Nr|Number|Code)$')

    def _guess_names(self, s, url, pos, f=None, fn=None):
        """je Slot: Name aus dem Code, falls lesbar -> dict(slot_index -> name). Nur 'sprechende' Namen (Id/Name/...)."""
        names = {}
        k = 0
        pn = param_names(fn['params']) if fn else []
        for p in url['parts']:
            if p[0] != 'slot':
                continue
            arg = p[3]
            nm = None
            if arg:
                a = arg.strip()
                nm = self._name_from_expr(s, pos, a, f)
                if nm is None and fn is not None and a in pn and f is not None:
                    # Parameter einer Hilfsfunktion: Namen bei den Aufrufern suchen
                    cnt = Counter()
                    for g, gs, cpos, cargs, gfn in self._callers(f, fn):
                        idx = pn.index(a)
                        if idx < len(cargs):
                            n2 = self._name_from_expr(gs, cpos, cargs[idx].strip(), g)
                            if n2:
                                cnt[n2] += 1
                    if cnt:
                        nm = cnt.most_common(1)[0][0]
            names[k] = nm
            k += 1
        return names

    def _name_from_expr(self, s, pos, a, f=None):
        m = re.match(r'(?:%s)(?:\?\.|\.)(%s)$' % (IDENT, IDENT), a)
        if m:
            return m.group(1) if self.NAME_OK.match(m.group(1)) else None
        if re.fullmatch(IDENT, a):
            nm = self._name_of_ident(s, pos, a, f)
            return nm if nm and self.NAME_OK.match(nm) else None
        return None

    def _window_start(self, f, pos):
        """Beginn der aeussersten umgebenden Funktion (max. 7000 Zeichen zurueck)."""
        lo = max(0, pos - 7000)
        if f is None:
            return max(0, pos - 2500)
        best = None
        for fn in self.fns[f]:
            a, b = fn['body']
            if a <= pos < b and fn['start'] <= pos:
                if best is None or fn['start'] < best:
                    best = fn['start']
        return max(lo, best) if best is not None else max(0, pos - 2500)

    def _name_of_ident(self, s, pos, ident, f=None):
        w0 = self._window_start(f, pos)
        w = s[w0:pos]
        cands = []
        for m in re.finditer(r'[{,]\s*(%s)\s*:\s*%s\s*(?=[,}=)])' % (IDENT, re.escape(ident)), w):
            cands.append((m.start(), m.group(1)))
        for m in re.finditer(r'(?<![\w$.])%s\s*=\s*[\w$]+(?:\?\.|\.)(%s)\s*(?=[;,)])' % (re.escape(ident), IDENT), w):
            cands.append((m.start(), m.group(1)))
        cands = [c for c in cands if c[1] not in GENERIC_NAMES and len(c[1]) >= 3]
        names = set(c[1] for c in cands)
        if len(names) != 1:
            return None     # keine oder uneindeutig (Minifizierung nutzt Einbuchstaben-Namen mehrfach)
        return names.pop()
