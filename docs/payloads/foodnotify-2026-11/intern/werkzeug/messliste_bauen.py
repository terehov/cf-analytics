#!/usr/bin/env python3
# messliste_bauen.py -- baut messliste-token.csv aus den drei Inventaren (nur Lesen von CSV, kein Netz).
#
# Aufruf:  python3 -I -B messliste_bauen.py <foodnotify-2026-11-Ordner> <ausgabe.csv>
#   Eingabe: intern/brew-aufrufe.csv, intern/panel-aufrufe.csv, openapi/operationen.csv  (nur Zeilen mit Methode GET)
#
# Die Einteilung in Klassen ist HANDARBEIT mit Beleg im Code der Bundles (siehe messliste-token.md);
# sie steht hier als Tabellen (ZUSTAND, PERSON, DOWNLOAD, UNKLAR), damit ein neuer Lauf dieselben Ergebnisse liefert
# und eine neue Zeile, die in keiner Tabelle steht, als "lesend" landet -- also GENAU DANN pruefen, wenn sich die
# Inventare aendern (Ausgabe "NEU gegenueber letzter Einteilung" beachten).
import csv, re, sys, collections, os

base, out = sys.argv[1], sys.argv[2]

def key(p):
    return re.sub(r'\{[^}]*\}', '{}', p.split('?')[0]).rstrip('/').lower()

SRC = [('brew', 'intern/brew-aufrufe.csv', 'path_template'),
       ('panel', 'intern/panel-aufrufe.csv', 'path_template'),
       ('offiziell', 'openapi/operationen.csv', 'path')]
SRC_ORDER = ['offiziell', 'brew', 'panel']          # Vorrang fuer Schreibweise und Parameternamen
CONF_RANK = {'named': 0, 'named(callers)': 1, 'inferred': 2, 'positional': 3, 'keine_parameter': 0, 'none': 0}

G = {}
for src, f, pk in SRC:
    for r in csv.DictReader(open(os.path.join(base, f), encoding='utf-8')):
        if r['method'] != 'GET':
            continue
        p = r[pk]
        g = G.setdefault(key(p), {'srcs': set(), 'rows': []})
        g['srcs'].add(src)
        g['rows'].append((src, p, r.get('param_confidence', 'named') or 'named', r))

# ------------------------------------------------------------------ Parameter -> Art der Befuellung
KIND = {'erpid': 'erpId', 'costcenterid': 'costCenterId', 'restaurantid': 'restaurantId', 'userid': 'userId',
        'connectionid': 'connectionId', 'accountid': 'connectionId', 'accountidentifier': 'connectionId'}
# Von Hand bestaetigte Faelle (Name nur abgeleitet, aber Bedeutung belegt):
FORCE_KIND = {
    # brew-methode.md: "mappingId" ist hier die POS-Konto-Kennung (an anderer Stelle accountId)
    ('/api/pos/mapping/{}/jobs/active', 0): 'connectionId',
    ('/api/pos/mapping/{}/jobs/{}', 0): 'connectionId',
    ('/api/pos/mapping/{}/link-targets', 0): 'connectionId',
    # offizielle Beschreibung: "/pos/{id}" = "Get one account" (gleiche Kennung wie accounts/{accountIdentifier})
    ('/api/1.0/pos/{}', 0): 'connectionId',
    ('/api/1.0/pos/{}/invoices', 0): 'connectionId',
    ('/api/1.0/pos/{}/productgroups', 0): 'connectionId',
    ('/api/1.0/pos/{}/products', 0): 'connectionId',
    ('/api/1.0/user/restaurants/{}', 0): 'restaurantId',
    # Pfadsegment "costcenter/" davor, Name aus den Aufrufern der Dienstmethode
    ('/api/eventcatering/eventorder/costcenter/{}/carts', 0): 'costCenterId',
}
FORCE_NAME = {
    ('/api/1.0/pos/{}', 0): 'accountId', ('/api/1.0/pos/{}/invoices', 0): 'accountId',
    ('/api/1.0/pos/{}/productgroups', 0): 'accountId', ('/api/1.0/pos/{}/products', 0): 'accountId',
    ('/api/1.0/user/restaurants/{}', 0): 'restaurantId',
}

def name_rank(n):
    if re.fullmatch(r'p\d+', n): return 3
    if n in ('id', '_id'): return 2
    return 0

def best_names(k, rows):
    """je Platzhalter-Position: (Name, Art, Hinweis)"""
    pos = collections.defaultdict(list)
    for src, p, conf, _ in rows:
        for i, m in enumerate(re.findall(r'\{([^}]*)\}', p)):
            pos[i].append((m, src, conf))
    res = []
    for i in sorted(pos):
        cands = sorted(pos[i], key=lambda c: (name_rank(c[0]), CONF_RANK.get(c[2], 3), SRC_ORDER.index(c[1])))
        name = cands[0][0]
        kind = None
        # Art: ein Kandidat mit bekanntem Namen, belastbar wenn gelesen (named) oder an erster Stelle von /api/{erpId}/...
        for n, s, c in cands:
            kk = KIND.get(re.sub(r'[^a-z]', '', n.lower()))
            if not kk:
                continue
            if c == 'named':
                kind, name = kk, n; break
            if i == 0 and kk == 'erpId' and k.startswith('/api/{}/'):
                kind, name = kk, n; break
        if (k, i) in FORCE_KIND:
            kind = FORCE_KIND[(k, i)]
            name = FORCE_NAME.get((k, i), name if KIND.get(re.sub(r'[^a-z]', '', name.lower())) else
                                   next((n for n, s, c in cands if KIND.get(re.sub(r'[^a-z]', '', n.lower()))), name))
        hint = ''
        if kind is None and re.sub(r'[^a-z]', '', name.lower()) == 'masteruserid':
            hint = 'masterUserId (Hauptkonto) ist nicht userId aus unseren Daten, ungeprueft'
        res.append((name, kind or 'unbekannt', hint))
    return res

def query_needed(rows):
    names = []
    for src, p, conf, r in rows:
        q = r.get('query_params', '') or ''
        if src == 'offiziell':
            for part in q.split(';'):
                part = part.strip()
                if not part: continue
                bits = part.split(':')
                if len(bits) >= 3 and bits[-1] == 'ja' and bits[0] not in names:
                    names.append(bits[0])
        else:
            for n in re.split(r'[,;]', q):
                n = n.strip()
                if not n or n.endswith('*') or n.endswith('?') or n.startswith('...') or n.startswith('('):
                    continue
                if n not in names: names.append(n)
    return names

# ------------------------------------------------------------------ Klassen (Handarbeit, Beleg in messliste-token.md)
ZUSTAND = {
    '/app/lang': 'setLanguage (brew) / panel main: onLangChange setzt die Sprache des Benutzers per GET',
    '/app/switch-design-mode': 'setTheme (brew) / panel main: updateDesignModeForUser speichert die Darstellung des Benutzers',
    '/api/security_logout': 'panel main: logout() -- beendet die Sitzung',
    '/api/erp/last-used/{}': 'erpSetLastUsed (brew) / panel setLastUsed: merkt den zuletzt benutzten Betrieb am Server',
    '/api/pos/connection/unlink/{}': 'panel 742: unlinkConnection, Knopf "unlink" im Dialog, danach Weiterleitung',
    '/api/pos/product/unlink/all/{}': 'panel 742: unlinkAll, Knopf "unlinkExistingForLocation" loest alle Produktverknuepfungen',
    '/api/pos/sync/reload/{}': 'posReloadInventory (brew) / panel 742: reloadFromPos, Klick-Handler "Reload from POS"',
    '/api/pos/ikentoo/businessdata/{}/{}': 'panel 742: storeBusinessLocation, Aufruf aus selectBusinessLocation (speichert die Auswahl)',
    '/api/{}/sales/{}/finish': 'panel 592/167: finish, Aufruf aus clickFinish() -- schliesst den Verkauf ab',
    '/api/menucreator/{}/generate-embedded-url': 'panel 283: generateEmbeddedUrl, Klick auf Symbol, erzeugt eine Einbettungs-URL',
    '/shops/private/cancel-import': 'panel 488: cancelProductImport, bricht einen laufenden Produktimport ab',
    '/shops/private/{}/edited_file/upload': 'panel 488: productImport, Aufruf aus startImporting() -- startet den Import',
    '/shops/private/{}/product/{}/image/remove': 'panel 488: removeProductImage mit _confirmed=1, nach Loesch-Bestaetigung',
    '/shops/private/{}/product/{}/image/remove/{}': 'panel 488: removeProductImage mit _confirmed=1, nach Loesch-Bestaetigung',
}

PERSON = [
    (r'subuser', 'Unterkonten (Personen bzw. deren Rollen/Rechte)'),
    (r'^/api/users$', 'Benutzerliste'),
    (r'^/api/user/auth/users', 'Sicherheitsrichtlinie / Anmeldestatus je Benutzer'),
    (r'^/api/user/email-change$', 'E-Mail-Wechsel eines Benutzers'),
    (r'^/api/user/api-tokens$', 'Kontosicherheit: Liste der API-Token des Kontos'),
    (r'customer-success', 'Betreuungszuordnung / Benutzersuche'),
    (r'analytics/management/users', 'Benutzerverwaltung Analytics'),
    (r'billing/management/users', 'Abrechnungskonten je Benutzer'),
    (r'^/api/supplier/onboardings$', 'Lieferanten-Onboarding mit Kontaktdaten'),
    (r'^/api/supplier/onboardings/\{\}/emails$', 'E-Mail-Adressen der Lieferanten-Onboardings'),
    (r'^/api/supplier/invitations', 'Einladung an eine Person (E-Mail)'),
    (r'^/api/supplier/intake', 'Lieferanten-Erfassung mit Kontaktdaten'),
    (r'order-reminder/subscriptions/users', 'Erinnerungs-Abonnement je Benutzer'),
    (r'^/api/profile$', 'Profil'),
    (r'^/api/erp/profile$', 'Profil'),
    (r'invoice-email', 'Rechnungs-E-Mail-Adresse'),
    (r'catering/customers', 'Kunden (Personen) des Caterings'),
    (r'catering/staff(/|$)', 'Personal des Caterings'),
    (r'eventcustomer', 'Kunden (Personen) einer Veranstaltung'),
    (r'images/eventstaff', 'Bild einer Person (Personal)'),
    (r'eventstaff/(event|currenteventuser|\{\})', 'Personal einer Veranstaltung'),
    (r'eventdrink/event/\{\}/eventstaff', 'Personalbezogener Ausdruck'),
    (r'eventmeal/event/\{\}/eventstaff', 'Personalbezogener Ausdruck'),
    (r'eventrecipe/staff/', 'Personalbezogener Ausdruck'),
]
DOWNLOAD = [
    (r'export\.pdf$', 'liefert PDF'), (r'\.xlsx$', 'liefert Excel-Datei'), (r'/product/download$', 'Produktexport als Datei'),
    (r'^/api/eventcatering/eventdocument/\{\}$', 'getDocument: Antwort als Blob (Dokument zum Herunterladen)'),
    (r'/supplier/errors$', 'downloadFileWithErrors: Fehlerdatei'), (r'/product/template$', 'downloadExcelTemplate: Vorlage'),
]
UNKLAR = {
    '/api/pos/export/{}': 'Gegenstueck /export/without_reload deutet an, dass dieser Aufruf aus dem Kassensystem nachlaedt; Wirkung nicht belegt',
    '/api/pos/ikentoo/businessdata/{}': 'Teil des Verbindungsassistenten, ruft vermutlich den Kassenanbieter ab; Wirkung am Server nicht belegt',
    '/pos/sellpick/stores': 'ruft mit frei eingegebenem clientName einen Drittanbieter ab',
    '/api/v2/analytics/token': 'stellt ein Einbettungs-Token (Tableau) aus; keine bleibende Aenderung belegt, aber ein neues Zugangsdatum',
    '/api/user/oauth/consent-context': 'Teil des OAuth-Einwilligungsablaufs (braucht clientId), nicht fuer Direktaufruf gedacht',
    '/api/{}/stocktaking/{}/print': 'Name "print": liefert Druckansicht oder Datei, Antwort nicht belegt',
}
UNKLAR_RE = [(r'/create$', 'geerbte CRUD-Zeile "create": Vorlage oder Entwurf, am Server nicht belegt; Nutzung durch die Oberflaeche nicht belegt'),
             (r'/new$', 'GET "new": Vorlage oder Anlage, am Server nicht belegt')]

MEASURED = {
    '/api/2.0/pos/accounts/{}/products': 'bereits gemessen: 200', '/api/2.0/pos/accounts/{}/product-groups': 'bereits gemessen: 200',
    '/api/2.0/pos/accounts/{}/invoices': 'bereits gemessen: 200', '/api/v2/analytics': 'bereits gemessen: 200',
    '/api/2.0/erp/stock/aggregate': 'bereits gemessen: 403', '/api/2.0/erp/stock/balances': 'bereits gemessen: 403',
    '/api/2.0/erp/stock/movements': 'bereits gemessen: 403', '/api/erp/all': 'bereits gemessen: 403',
    '/api/pos/locations': 'bereits gemessen: 403', '/api/erp/stocktakings': 'bereits gemessen: 403',
    '/api/profile': 'bereits gemessen: 403',
}

def classify(k):
    if k in ZUSTAND: return 'zustandsaendernd', ZUSTAND[k]
    for rx, why in PERSON:
        if re.search(rx, k): return 'personenbezogen', why
    for rx, why in DOWNLOAD:
        if re.search(rx, k): return 'download', why
    if k in UNKLAR: return 'unklar', UNKLAR[k]
    for rx, why in UNKLAR_RE:
        if re.search(rx, k): return 'unklar', why
    return 'lesend', ''

# Schutz gegen "neue Zeile landet still als lesend": existiert die Ausgabedatei schon, gelten nur ihre Pfade als geprueft;
# jeder weitere GET-Pfad wird "unklar" und messen=nein, bis ein Mensch ihn im Code angesehen und eine Tabelle oben ergaenzt hat.
GEPRUEFT = None
if os.path.exists(out):
    GEPRUEFT = {key(r['pfad']) for r in csv.DictReader(open(out, encoding='utf-8'))}
neu = []

rows_out = []
for k, g in G.items():
    rows = g['rows']
    # Schreibweise: erster Treffer der Rangfolge der Quellen
    first = sorted(rows, key=lambda x: SRC_ORDER.index(x[0]))[0]
    names = best_names(k, rows)
    tmpl = first[1].split('?')[0].rstrip('/')
    it = iter(names)
    tmpl = re.sub(r'\{[^}]*\}', lambda m: '{' + next(it)[0] + '}', tmpl)
    quellen = ','.join(s for s in ('brew', 'panel', 'offiziell') if s in g['srcs'])
    klasse, why = classify(k)
    if GEPRUEFT is not None and k not in GEPRUEFT and klasse == 'lesend':
        klasse, why = 'unklar', 'NEU seit der letzten Einteilung, Code nicht angesehen (messliste_bauen.py: Tabellen ergaenzen)'
        neu.append(k)
    nur_geerbt = ('brew' not in g['srcs'] and 'offiziell' not in g['srcs'] and
                  all('geerbt: CRUD-Basisklasse' in (r.get('note') or '') for sr, _, _, r in rows if sr == 'panel'))
    param_names = [n for n, _, _ in names]
    param_src = '; '.join('%s=%s' % (n, kind) for n, kind, _ in names)
    unbekannt = [n for n, kind, _ in names if kind == 'unbekannt']
    qn = query_needed(rows)
    if klasse == 'lesend':
        messen = 'ja' if not unbekannt else 'nein'
        if messen == 'ja':
            note = []
            if k in MEASURED: note.append(MEASURED[k])
            elif k.startswith('/api/1.0/'): note.append('Familie /api/1.0/* bereits getestet: 403 (nicht jeder Pfad einzeln)')
            if qn: note.append('Query vom Client stets gesetzt: ' + ','.join(qn))
            if nur_geerbt: note.append('nur geerbte CRUD-Zeile, Nutzung durch die Oberflaeche nicht belegt')
            grund = '; '.join(note)
        else:
            parts = ['Parameter unbekannt: ' + ', '.join(unbekannt)]
            h = [x for _, _, x in names if x]
            if h: parts.append(h[0])
            if k in MEASURED: parts.append(MEASURED[k])
            if nur_geerbt: parts.append('nur geerbte CRUD-Zeile, Nutzung durch die Oberflaeche nicht belegt')
            grund = '; '.join(parts)
    else:
        messen = 'nein'
        grund = {'zustandsaendernd': 'GET mit Seiteneffekt: ', 'personenbezogen': 'Personenbezug: ',
                 'download': 'Datei-Antwort: ', 'unklar': 'unklar: '}[klasse] + why
        if k in MEASURED: grund += '; ' + MEASURED[k]
        if nur_geerbt: grund += '; nur geerbte CRUD-Zeile, Nutzung durch die Oberflaeche nicht belegt'
    rows_out.append({'pfad': tmpl, 'quellen': quellen, 'parameter': ';'.join(param_names), 'parameter_quelle': param_src,
                     'query_noetig': ';'.join(qn), 'klasse': klasse, 'messen': messen, 'grund': grund, '_k': k})

def segs(p):
    s = [x for x in p.split('/') if x]
    return [x.lower() for x in s[:3]]
rows_out.sort(key=lambda r: (0 if r['messen'] == 'ja' else 1, segs(r['pfad']), r['pfad'].lower()))
cols = ['pfad', 'quellen', 'parameter', 'parameter_quelle', 'query_noetig', 'klasse', 'messen', 'grund']
with open(out, 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore', lineterminator='\n')
    w.writeheader(); w.writerows(rows_out)

c = collections.Counter(r['klasse'] for r in rows_out)
print(len(rows_out), dict(c), 'messen ja:', sum(r['messen'] == 'ja' for r in rows_out))
if neu: print('NEU gegenueber letzter Einteilung (als unklar eingestellt):', len(neu)); [print('  ', k) for k in neu]
