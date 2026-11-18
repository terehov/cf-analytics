// panel_fehlende_module.mjs -- welche Webpack-Module werden referenziert, liegen aber in keinem der vorhandenen Chunks
// (also im fehlenden Chunk 592 "common")? Was laesst sich aus den Verwendungsstellen ablesen?
// Aufruf: node panel_fehlende_module.mjs <bundle-verzeichnis> <ausgabe.json> [pfad/zu/typescript]
import {createRequire} from 'module';
import fs from 'fs';
import path from 'path';

const dir = process.argv[2];
const outFile = process.argv[3];
const tsPath = process.argv[4] || '/Users/eugene/Development/concept family/analytics/node_modules/typescript';
const ts = createRequire(import.meta.url)(tsPath);

const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
const defined = new Set();
const mods = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  (function find(n) {
    if (ts.isPropertyAssignment(n)) {
      const nm = n.name;
      const key = ts.isNumericLiteral(nm) ? nm.text : (ts.isStringLiteral(nm) ? nm.text : null);
      const init = n.initializer;
      if (key && /^\d{3,}$/.test(key) && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.parameters.length >= 2) {
        defined.add(key);
        mods.push({id: key, file: f, sf, fn: init, req: init.parameters[2] && init.parameters[2].name.getText(sf)});
        return;
      }
      // Module mit nur einem oder keinem Parameter (pdfmake, Node-Polyfills in 545/vendor) kommen nicht aus Chunk 592 und
      // enthalten keine Importe; sie zaehlen nur als "definiert". Kein return: darunter koennen echte Module liegen.
      if (key && /^\d{3,}$/.test(key) && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.parameters.length <= 1) defined.add(key);
    }
    ts.forEachChild(n, find);
  })(sf);
}

const usage = new Map(); // moduleId -> {importers:Set(chunk), props:Map(name->count), injected:Map(prop->Set(field))}
function u(id) { if (!usage.has(id)) usage.set(id, {importers: new Set(), props: new Map(), injected: new Map(), strings: new Set()}); return usage.get(id); }

for (const m of mods) {
  if (!m.req) continue;
  const alias = new Map();
  (function w(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer) && ts.isIdentifier(n.initializer.expression) && n.initializer.expression.text === m.req && n.initializer.arguments.length === 1 && ts.isNumericLiteral(n.initializer.arguments[0])) {
      alias.set(n.name.text, n.initializer.arguments[0].text);
    }
    ts.forEachChild(n, w);
  })(m.fn.body);
  // Zugriffe alias.Name
  (function w(n) {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && alias.has(n.expression.text)) {
      const id = alias.get(n.expression.text);
      if (!defined.has(id)) { const x = u(id); x.importers.add((m.file.startsWith('common.') ? '592' : m.file.split('.')[0])); x.props.set(n.name.text, (x.props.get(n.name.text) || 0) + 1); }
    }
    ts.forEachChild(n, w);
  })(m.fn.body);
  // Konstruktor-Injektion: class X { constructor(a,b){this.f=a,this.g=b} static #e = this.ɵfac = function(t){return new(t||X)(s.LFG(al.P), ...)} }
  (function w(n) {
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
      const ctor = n.members.find(x => ts.isConstructorDeclaration(x));
      let fac = null;
      for (const mem of n.members) {
        if (ts.isPropertyDeclaration(mem) && mem.initializer && /\\u0275fac/.test(mem.getText(m.sf).slice(0, 60))) fac = mem.initializer;
      }
      if (ctor && fac) {
        const params = ctor.parameters.map(p => p.name.getText(m.sf));
        const fields = new Map();
        (function f(x) {
          if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(x.left) && x.left.expression.kind === ts.SyntaxKind.ThisKeyword && ts.isIdentifier(x.right) && params.includes(x.right.text)) fields.set(x.right.text, x.left.name.text);
          ts.forEachChild(x, f);
        })(ctor.body);
        let call = null;
        (function f(x) { if (call) return; if (ts.isNewExpression(x) && x.arguments && x.arguments.length > 0) { call = x; return; } ts.forEachChild(x, f); })(fac);
        // new(t||X)(LFG(a.B), ...): Aufrufausdruck ist CallExpression, deren Callee die NewExpression ist -> Argumente der aeusseren Aufrufs
        let outer = null;
        (function f(x) { if (outer) return; if (ts.isCallExpression(x) && ts.isNewExpression(x.expression)) { outer = x; return; } ts.forEachChild(x, f); })(fac);
        const args = outer ? outer.arguments : (call && call.arguments) || [];
        args.forEach((a, i) => {
          if (ts.isCallExpression(a) && a.arguments[0] && ts.isPropertyAccessExpression(a.arguments[0]) && ts.isIdentifier(a.arguments[0].expression) && alias.has(a.arguments[0].expression.text)) {
            const id = alias.get(a.arguments[0].expression.text);
            if (!defined.has(id)) {
              const fld = fields.get(params[i]);
              if (fld) { const x = u(id); const pn = a.arguments[0].name.text; if (!x.injected.has(pn)) x.injected.set(pn, new Set()); x.injected.get(pn).add(fld); }
            }
          }
        });
      }
    }
    ts.forEachChild(n, w);
  })(m.fn.body);
}
const out = [...usage.entries()].map(([id, x]) => ({
  id,
  importers: [...x.importers].sort(),
  exports_used: [...x.props.entries()].map(([k, v]) => k + ':' + v),
  injected_as: [...x.injected.entries()].map(([k, v]) => k + '=' + [...v].join('/'))
})).sort((a, b) => b.importers.length - a.importers.length);
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({definierte_module: defined.size, fehlende_referenzierte_module: out.length}));
