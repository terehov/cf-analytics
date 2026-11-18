"""Laden des Bundles, Import-/Export-Graph, Aliasaufloesung."""
import os
import re
import glob
from jsscan import find_close, split_top

IMPORT_RE = re.compile(
    r'import\s*(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\}|\*\s*as\s+([A-Za-z_$][\w$]*))?\s*from\s*"\./([^"]+)"')
BARE_IMPORT_RE = re.compile(r'import\s*"\./([^"]+)"')
DYN_IMPORT_RE = re.compile(r'import\("\./([^"]+)"\)')


class Bundle:
    def __init__(self, d):
        self.dir = d
        self.files = {}
        for p in sorted(glob.glob(os.path.join(d, '*.js'))):
            with open(p, encoding='utf-8', errors='replace') as f:
                self.files[os.path.basename(p)] = f.read()
        self.imports = {}   # file -> {local: (src, exportname)}
        self.static_deps = {}  # file -> set(src)
        self.dyn_deps = {}
        self.exports = {}   # file -> {exportname: local}
        for name, s in self.files.items():
            imp = {}
            deps = set()
            for m in IMPORT_RE.finditer(s):
                src = m.group(4)
                deps.add(src)
                if m.group(2):
                    for part in m.group(2).split(','):
                        part = part.strip()
                        if not part:
                            continue
                        mm = re.match(r'([\w$]+)\s+as\s+([\w$]+)$', part)
                        if mm:
                            imp[mm.group(2)] = (src, mm.group(1))
                        else:
                            imp[part] = (src, part)
                if m.group(1):
                    imp[m.group(1)] = (src, 'default')
            for m in BARE_IMPORT_RE.finditer(s):
                deps.add(m.group(1))
            self.imports[name] = imp
            self.static_deps[name] = deps
            self.dyn_deps[name] = set(m.group(1) for m in DYN_IMPORT_RE.finditer(s))
            ex = {}
            for m in re.finditer(r'export\s*\{', s):
                # nur der letzte Export-Block am Dateiende interessiert; alle mitnehmen
                close = find_close(s, m.end() - 1)
                for part in s[m.end():close].split(','):
                    part = part.strip()
                    if not part:
                        continue
                    mm = re.match(r'([\w$]+)\s+as\s+([\w$]+)$', part)
                    if mm:
                        ex[mm.group(2)] = mm.group(1)
                    else:
                        ex[part] = part
            self.exports[name] = ex

    def resolve(self, file, local, depth=0):
        """local in file -> (ursprungsdatei, ursprungsname)"""
        if depth > 8:
            return (file, local)
        imp = self.imports.get(file, {})
        if local in imp:
            src, exp = imp[local]
            if src in self.exports and exp in self.exports[src]:
                return self.resolve(src, self.exports[src][exp], depth + 1)
            return (src, exp)
        return (file, local)

    def route_of_import_closure(self):
        pass
