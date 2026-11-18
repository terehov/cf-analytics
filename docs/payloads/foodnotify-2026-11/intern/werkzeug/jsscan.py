#!/usr/bin/env python3
"""Kleine, bewusst dumme JS-Lesehilfe fuer minifizierte Vite-Bundles.

Nur Text, nichts wird ausgefuehrt. Kann: Strings/Templates/Regex ueberspringen,
passende Klammer finden, Argumentlisten und Objektliteral-Schluessel zerlegen.
"""
import re

_REGEX_PREV = set('(,=:[!&|?{};+-*%<>~^')
_KEYWORDS_BEFORE_REGEX = ('return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new')


def skip_string(s, i):
    q = s[i]
    n = len(s)
    i += 1
    if q == '`':
        while i < n:
            c = s[i]
            if c == '\\':
                i += 2
                continue
            if c == '`':
                return i + 1
            if c == '$' and s[i + 1:i + 2] == '{':
                i = find_close(s, i + 1) + 1
                continue
            i += 1
        return n
    while i < n:
        c = s[i]
        if c == '\\':
            i += 2
            continue
        if c == q:
            return i + 1
        i += 1
    return n


def _prev_sig(s, i):
    j = i - 1
    while j >= 0 and s[j] in ' \t\r\n':
        j -= 1
    return j


def _regex_allowed(s, i):
    j = _prev_sig(s, i)
    if j < 0:
        return True
    c = s[j]
    if c in _REGEX_PREV:
        return True
    if c.isalpha():
        k = j
        while k >= 0 and (s[k].isalnum() or s[k] in '_$'):
            k -= 1
        w = s[k + 1:j + 1]
        return w in _KEYWORDS_BEFORE_REGEX
    return False


def skip_regex(s, i):
    n = len(s)
    i += 1
    incls = False
    while i < n:
        c = s[i]
        if c == '\\':
            i += 2
            continue
        if c == '[':
            incls = True
        elif c == ']':
            incls = False
        elif c == '/' and not incls:
            i += 1
            while i < n and (s[i].isalpha()):
                i += 1
            return i
        elif c == '\n':
            return i
        i += 1
    return n


_CLOSE = {'(': ')', '[': ']', '{': '}'}


def find_close(s, i):
    """s[i] ist ( [ oder {; liefert Index der passenden Klammer."""
    n = len(s)
    stack = [s[i]]
    j = i + 1
    while j < n:
        c = s[j]
        if c in '"\'`':
            j = skip_string(s, j)
            continue
        if c == '/':
            nx = s[j + 1:j + 2]
            if nx == '/':
                k = s.find('\n', j)
                j = n if k < 0 else k
                continue
            if nx == '*':
                k = s.find('*/', j + 2)
                j = n if k < 0 else k + 2
                continue
            if _regex_allowed(s, j):
                j = skip_regex(s, j)
                continue
        elif c in '([{':
            stack.append(c)
        elif c in ')]}':
            stack.pop()
            if not stack:
                return j
        j += 1
    return n - 1


def split_top(s, a, b, sep=','):
    """Zerlegt s[a:b] an Top-Level-Trennzeichen; liefert Liste (start, end)."""
    out = []
    start = a
    j = a
    while j < b:
        c = s[j]
        if c in '"\'`':
            j = skip_string(s, j)
            continue
        if c == '/':
            nx = s[j + 1:j + 2]
            if nx in ('/', '*'):
                pass
            elif _regex_allowed(s, j):
                j = skip_regex(s, j)
                continue
        if c in '([{':
            j = find_close(s, j) + 1
            continue
        if c == sep:
            out.append((start, j))
            start = j + 1
        j += 1
    out.append((start, b))
    return [(x, y) for x, y in out if s[x:y].strip() != '' or True]


def args_of(s, i_open):
    """s[i_open] == '('. Liefert (Liste Argument-Texte, Index der schliessenden Klammer)."""
    close = find_close(s, i_open)
    spans = split_top(s, i_open + 1, close)
    args = [s[x:y].strip() for x, y in spans]
    if len(args) == 1 and args[0] == '':
        args = []
    return args, close


def expr_end(s, i):
    """Ende eines Ausdrucks ab i auf Top-Level (bis , ; ) ] })."""
    n = len(s)
    j = i
    while j < n:
        c = s[j]
        if c in '"\'`':
            j = skip_string(s, j)
            continue
        if c == '/':
            nx = s[j + 1:j + 2]
            if nx in ('/', '*'):
                pass
            elif _regex_allowed(s, j):
                j = skip_regex(s, j)
                continue
        if c in '([{':
            j = find_close(s, j) + 1
            continue
        if c in ',;)]}':
            return j
        j += 1
    return n


def parse_template(t):
    """t ist ein Template-Literal inkl. Backticks. -> [('lit',text) | ('expr',text)]"""
    assert t[0] == '`' and t[-1] == '`', t[:20]
    parts = []
    i = 1
    end = len(t) - 1
    buf = []
    while i < end:
        c = t[i]
        if c == '\\':
            buf.append(t[i + 1:i + 2])
            i += 2
            continue
        if c == '$' and t[i + 1:i + 2] == '{':
            if buf:
                parts.append(('lit', ''.join(buf)))
                buf = []
            k = find_close(t, i + 1)
            parts.append(('expr', t[i + 2:k]))
            i = k + 1
            continue
        buf.append(c)
        i += 1
    if buf:
        parts.append(('lit', ''.join(buf)))
    return parts


def string_value(t):
    """Wert eines einfachen String-Literals (' oder ") oder None."""
    t = t.strip()
    if len(t) >= 2 and t[0] in '"\'' and t[-1] == t[0] and skip_string(t, 0) == len(t):
        body = t[1:-1]
        return re.sub(r'\\(.)', r'\1', body)
    return None


def _spread_keys(expr):
    """...cond?{a:1}:{}  ->  ['a?'] (optional); ...x -> ['...x']"""
    found = []
    j = 0
    n = len(expr)
    while j < n:
        c = expr[j]
        if c in '"\'`':
            j = skip_string(expr, j)
            continue
        if c == '{':
            close = find_close(expr, j)
            ks = object_keys(expr[j:close + 1]) or []
            found += [k + '?' if not k.startswith(('...', '?')) else k for k in ks]
            j = close + 1
            continue
        if c in '([':
            j = find_close(expr, j) + 1
            continue
        j += 1
    if found:
        return found
    return ['...' + expr[:30]]


def object_keys(s_obj):
    """s_obj ist ein Objektliteral {...}. Liefert Liste der Top-Level-Schluessel (Spread als '...x')."""
    s_obj = s_obj.strip()
    if not s_obj.startswith('{'):
        return None
    close = find_close(s_obj, 0)
    keys = []
    for a, b in split_top(s_obj, 1, close):
        item = s_obj[a:b].strip()
        if not item:
            continue
        if item.startswith('...'):
            keys.extend(_spread_keys(item[3:].strip()))
            continue
        m = re.match(r'(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*(?::|\(|$)', item)
        if m:
            keys.append(m.group(1))
            continue
        m = re.match(r'"([^"]*)"\s*:', item) or re.match(r"'([^']*)'\s*:", item)
        if m:
            keys.append(m.group(1))
            continue
        m = re.match(r'\[([^\]]*)\]\s*:', item)
        if m:
            keys.append('[' + m.group(1)[:30] + ']')
            continue
        m = re.match(r'([A-Za-z_$][\w$]*)$', item)
        if m:
            keys.append(m.group(1))
            continue
        keys.append('?' + item[:20])
    return keys


def object_entries(s_obj):
    """Wie object_keys, aber (key, value_text)."""
    s_obj = s_obj.strip()
    if not s_obj.startswith('{'):
        return None
    close = find_close(s_obj, 0)
    out = []
    for a, b in split_top(s_obj, 1, close):
        item = s_obj[a:b].strip()
        if not item:
            continue
        if item.startswith('...'):
            out.append(('...', item[3:]))
            continue
        # key: value
        m = re.match(r'([A-Za-z_$][\w$]*|"[^"]*"|\'[^\']*\')\s*:', item)
        if m:
            k = m.group(1).strip('"\'')
            out.append((k, item[m.end():].strip()))
            continue
        m = re.match(r'([A-Za-z_$][\w$]*)$', item)
        if m:
            out.append((m.group(1), m.group(1)))
            continue
        out.append(('?', item))
    return out
