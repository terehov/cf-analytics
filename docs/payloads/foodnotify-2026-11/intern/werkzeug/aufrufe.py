"""Aufrufstellen (HTTP) aus dem Bundle lesen."""
import re
from collections import defaultdict, Counter
from jsscan import (find_close, split_top, args_of, expr_end, parse_template, string_value,
                    object_keys, object_entries)


KEYWORDS = {'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'with', 'else', 'do', 'new', 'await', 'import'}
IDENT = r'[A-Za-z_$][\w$]*'


# ---------------------------------------------------------------- Registry
def parse_registry(entry_src, start):
    """start = Index von '{' des Registerobjekts. -> {key: dict(params, parts, raw)}"""
    close = find_close(entry_src, start)
    out = {}
    for a, b in split_top(entry_src, start + 1, close):
        item = entry_src[a:b].strip()
        m = re.match(r'(%s):' % IDENT, item)
        if not m:
            continue
        key = m.group(1)
        val = item[m.end():].strip()
        params = []
        body = val
        m2 = re.match(r'\(([^)]*)\)=>(.*)$', val, re.S) or re.match(r'(%s)=>(.*)$' % IDENT, val, re.S)
        if m2:
            params = [p.strip() for p in m2.group(1).split(',') if p.strip()]
            body = m2.group(2).strip()
        if body.startswith('`'):
            parts = parse_template(body)
        else:
            sv = string_value(body)
            if sv is None:
                continue
            parts = [('lit', sv)]
        out[key] = dict(params=params, parts=parts, raw=val)
    return out


def find_registry(entry_src):
    """Findet das Registerobjekt (Endpunkt-Tabelle) ueber den Anker isAuthenticated:"/app/is-authenticated"."""
    # einfachster robuster Weg: das Literal ab 'isAuthenticated:"/app/is-authenticated"'
    i = entry_src.find('isAuthenticated:"/app/is-authenticated"')
    if i < 0:
        return None, None, None
    start = entry_src.rfind('{', 0, i)
    name_m = re.search(r'(%s)\s*=\s*$' % IDENT, entry_src[max(0, start - 60):start])
    name = name_m.group(1) if name_m else None
    return name, start, parse_registry(entry_src, start)


# ---------------------------------------------------------------- Funktionsindex
FN_PATTERNS = [
    ('arrow_paren', re.compile(r'(?<![\w$.])(%s)\s*=\s*(async\s*)?\(([^()]*)\)\s*=>' % IDENT)),
    ('arrow_single', re.compile(r'(?<![\w$.])(%s)\s*=\s*(async\s+)?(%s)\s*=>' % (IDENT, IDENT))),
    ('function', re.compile(r'function\s*\*?\s*(%s)\s*\(([^()]*)\)\s*\{' % IDENT)),
    ('static', re.compile(r'static\s+(async\s+)?(%s)\s*\(([^()]*)\)\s*\{' % IDENT)),
    ('method', re.compile(r'(?<=[{};,])\s*(async\s+)?(%s)\s*\(([^()]*)\)\s*\{' % IDENT)),
    ('anon', re.compile(r'(?<=[:(,?&|])\s*(async\s+)?(?:\(([^()]*)\)|(%s))\s*=>' % IDENT)),
]


def index_functions(s):
    fns = []
    for kind, rx in FN_PATTERNS:
        for m in rx.finditer(s):
            if kind == 'arrow_paren':
                name, params_s, bstart = m.group(1), m.group(3), m.end()
            elif kind == 'arrow_single':
                name, params_s, bstart = m.group(1), m.group(3), m.end()
            elif kind == 'function':
                name, params_s, bstart = m.group(1), m.group(2), m.end() - 1
            elif kind == 'anon':
                name, params_s, bstart = '<anon>', (m.group(2) if m.group(2) is not None else m.group(3)), m.end()
            elif kind == 'static':
                name, params_s, bstart = m.group(2), m.group(3), m.end() - 1
            else:
                name, params_s, bstart = m.group(2), m.group(3), m.end() - 1
                if name in KEYWORDS:
                    continue
            # Body
            if kind.startswith('arrow') or kind == 'anon':
                j = bstart
                while j < len(s) and s[j] in ' \t':
                    j += 1
                if j < len(s) and s[j] == '{':
                    bend = find_close(s, j) + 1
                    bs = j
                else:
                    bs = j
                    bend = expr_end(s, j)
            else:
                bs = bstart
                bend = find_close(s, bstart) + 1
            params = [p.strip() for p in split_params(params_s)]
            fns.append(dict(name=name, kind=kind, params=params, start=m.start(), body=(bs, bend)))
    fns.sort(key=lambda f: f['start'])
    return fns


def split_params(ps):
    ps = ps.strip()
    if not ps:
        return []
    return [ps[a:b] for a, b in split_top(ps, 0, len(ps))]


def param_names(params):
    """['e','t=1','{a:b}'] -> ['e','t','{..}']"""
    out = []
    for p in params:
        m = re.match(r'(%s)' % IDENT, p)
        out.append(m.group(1) if m else '{..}')
    return out


def enclosing_fn(fns, pos):
    best = None
    for f in fns:
        a, b = f['body']
        if a <= pos < b and f['start'] <= pos:
            if best is None or (b - a) < (best['body'][1] - best['body'][0]):
                best = f
    return best

