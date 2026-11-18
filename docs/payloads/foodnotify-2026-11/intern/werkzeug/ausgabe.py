"""Zeilen fuer brew-aufrufe.csv aus den Aufrufstellen bauen."""
import re
from collections import defaultdict, Counter
from extract_calls import path_name

ID_RE = re.compile(r'\{[^}]*\}')


def assemble(parts):
    """Benachbarte Literale verschmelzen -> Liste ('lit',t)|('slot',origin,idx,arg)"""
    out = []
    for p in parts:
        if p[0] == 'lit' and out and out[-1][0] == 'lit':
            out[-1] = ('lit', out[-1][1] + p[1])
        else:
            out.append(p)
    return out


def shape_of(parts):
    return ''.join(p[1] if p[0] == 'lit' else '{}' for p in parts)


def build(sites):
    # --- Slotnamen je Slot-Schluessel (Stimmen)
    votes = defaultdict(Counter)
    prevlit = {}
    for st in sites:
        parts = assemble(st['url']['parts'])
        st['asm'] = parts
        shape = shape_of(parts)
        k = 0
        prev = ''
        for p in parts:
            if p[0] == 'lit':
                prev = p[1]
                continue
            key = (p[1], p[2]) if p[1].startswith('reg:') else ('lit', st['file'], shape, k)
            st.setdefault('slotkeys', []).append(key)
            nm = st['names'].get(k)
            if nm:
                votes[key][nm] += 1
            prevlit.setdefault(key, prev)
            k += 1
            prev = ''
    chosen = {}
    for key, pl in prevlit.items():
        if votes.get(key):
            chosen[key] = (votes[key].most_common(1)[0][0], 'named')
        else:
            nm = path_name(pl)
            chosen[key] = (nm, 'inferred') if nm else (None, 'positional')
    # --- Zeilen
    rows = {}
    for st in sites:
        parts = st['asm']
        if st['url']['dynamic'] and not parts:
            shape = '<dynamisch: %s>' % st['url'].get('expr', '?')[:60]
            tmpl = shape
            conf = 'positional'
        else:
            names = []
            confs = []
            n_pos = 0
            for key in st.get('slotkeys', []):
                nm, cf = chosen[key]
                if nm is None:
                    n_pos += 1
                    nm = 'p%d' % n_pos
                names.append(nm)
                confs.append(cf)
            # doppelte Namen unterscheiden
            seen = Counter()
            fin = []
            for nm in names:
                seen[nm] += 1
                fin.append(nm if seen[nm] == 1 else '%s%d' % (nm, seen[nm]))
            it = iter(fin)
            tmpl = ''.join(p[1] if p[0] == 'lit' else '{%s}' % next(it) for p in parts)
            shape = shape_of(parts)
            if not confs:
                conf = 'keine_parameter'
            elif 'positional' in confs:
                conf = 'positional'
            elif 'inferred' in confs:
                conf = 'inferred'
            else:
                conf = 'named'
        key = (st['method'], shape)
        r = rows.setdefault(key, dict(method=st['method'], shape=shape, templates=Counter(), query=[], body=[],
                                       chunks=[], conf=Counter(), notes=[], sites=0, regkeys=[], layers=Counter(),
                                       encodings=set(), blob=False))
        r['templates'][tmpl] += 1
        r['sites'] += 1
        r['conf'][conf] += 1
        for q in st['query']:
            if q not in r['query']:
                r['query'].append(q)
        for q in st['body']:
            if q not in r['body']:
                r['body'].append(q)
        if st['file'] not in r['chunks']:
            r['chunks'].append(st['file'])
        for n in st['notes']:
            if n not in r['notes']:
                r['notes'].append(n)
        for k in st['url'].get('regkeys', []):
            if k not in r['regkeys']:
                r['regkeys'].append(k)
        r['layers'][st['calltype']] += 1
        if st['form']:
            r['encodings'].add('form-urlencoded')
        if st['blob']:
            r['blob'] = True
        if any(b.startswith('[FormData]') for b in st['body']):
            r['encodings'].add('multipart')
    return rows
