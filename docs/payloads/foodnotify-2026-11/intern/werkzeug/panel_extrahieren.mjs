// panel_extrahieren.mjs -- statische Analyse der minifizierten Angular-Bundles (nur lesen, nie ausfuehren).
//
// Aufruf:  node panel_extrahieren.mjs <bundle-verzeichnis> <ausgabe.json> [pfad/zu/typescript]
// Der Parser ist der von TypeScript (ts.createSourceFile) -- er baut nur einen Syntaxbaum, fuehrt nichts aus.
// Das Werkzeug "fuehrt" die URL-Bauer des Quelltexts symbolisch aus (push/put/serialize), nicht das Bundle.
import {createRequire} from 'module';
import fs from 'fs';
import path from 'path';

const dir = process.argv[2];
const outFile = process.argv[3];
const tsPath = process.argv[4] || '/Users/eugene/Development/concept family/analytics/node_modules/typescript';
const require = createRequire(import.meta.url);
const ts = require(tsPath);

const URL_BUILDER_MODULE = process.env.URL_BUILDER_MODULE || '64942'; // Klasse mit push/put/serialize (in main.js gefunden)
const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'getText', 'auth']);
const BASES = {baseApiUrl: ['api'], baseAppUrl: ['app'], baseUrl: []};

// ---------------------------------------------------------------- Einlesen
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
// runtime.*.js: a.u=e=>(592===e?"common":e)+"."+... -- Chunk 592 heisst auf der Platte common.<hash>.js (Fund 18.11.2026)
const chunkOf = f => { const c = f.split('.')[0]; return c === 'common' ? '592' : c; };

const modules = []; // {id, file, chunk, node(fn), reqName}
const parsed = {};
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  parsed[f] = {text, sf};
  (function find(n) {
    if (ts.isPropertyAssignment(n)) {
      const nm = n.name;
      const key = ts.isNumericLiteral(nm) ? nm.text : (ts.isStringLiteral(nm) ? nm.text : null);
      const init = n.initializer;
      if (key && /^\d{3,}$/.test(key) && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.parameters.length >= 2) {
        modules.push({id: key, file: f, chunk: chunkOf(f), node: init, reqName: init.parameters[2] && init.parameters[2].name.getText(sf), sf});
        return; // nicht in Module hineinsuchen
      }
    }
    ts.forEachChild(n, find);
  })(sf);
}
const moduleById = new Map(modules.map(m => [m.id, m]));

// ---------------------------------------------------------------- Modulgraph (a(ID) / a.e(CHUNK) / a.bind(a,ID))
for (const m of modules) {
  m.deps = new Set(); m.lazyChunks = new Set(); m.alias = new Map(); m.exportsMap = {};
  const rq = m.reqName; if (!rq) continue;
  (function walk(n) {
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c) && c.text === rq && n.arguments.length === 1 && ts.isNumericLiteral(n.arguments[0])) m.deps.add(n.arguments[0].text);
      if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === rq) {
        if (c.name.text === 'e' && n.arguments[0] && ts.isNumericLiteral(n.arguments[0])) m.lazyChunks.add(n.arguments[0].text);
        if (c.name.text === 'bind' && n.arguments[1] && ts.isNumericLiteral(n.arguments[1])) m.deps.add(n.arguments[1].text);
      }
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer)) {
      const c = n.initializer.expression;
      if (ts.isIdentifier(c) && c.text === rq && n.initializer.arguments.length === 1 && ts.isNumericLiteral(n.initializer.arguments[0])) m.alias.set(n.name.text, n.initializer.arguments[0].text);
    }
    ts.forEachChild(n, walk);
  })(m.node.body);
}

// exports: req.d(exportsParam, {Name: () => ident})
for (const m of modules) {
  (function walk(n) {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'd' && n.arguments.length === 2 && ts.isObjectLiteralExpression(n.arguments[1])) {
      for (const p of n.arguments[1].properties) {
        if (ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) {
          const b = p.initializer.body;
          if (ts.isIdentifier(b)) m.exportsMap[p.name.getText(m.sf)] = b.text;
          else if (ts.isBlock(b) && b.statements[0] && ts.isReturnStatement(b.statements[0]) && b.statements[0].expression && ts.isIdentifier(b.statements[0].expression)) m.exportsMap[p.name.getText(m.sf)] = b.statements[0].expression.text;
        }
      }
    }
    ts.forEachChild(n, walk);
  })(m.node.body);
}

// Klassen-Register: key = modul:pos
const classByKey = new Map();
const subclassCount = new Map();
function findClassByIdent(mod, ident) {
  if (mod._classIdx === undefined) {
    mod._classIdx = new Map();
    (function w(n) {
      if (ts.isClassDeclaration(n) && n.name) { if (!mod._classIdx.has(n.name.text)) mod._classIdx.set(n.name.text, n); }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        let found = null;
        (function f(x, depth) { if (found || depth > 6) return; if (ts.isClassDeclaration(x) || ts.isClassExpression(x)) { found = x; return; } ts.forEachChild(x, y => f(y, depth + 1)); })(n.initializer, 0);
        if (found && !mod._classIdx.has(n.name.text)) mod._classIdx.set(n.name.text, found);
      }
      ts.forEachChild(n, w);
    })(mod.node.body);
  }
  return mod._classIdx.get(ident) || null;
}
function superOf(cls, mod) {
  const h = (cls.heritageClauses || []).find(x => x.token === ts.SyntaxKind.ExtendsKeyword);
  if (!h) return null;
  const e = h.types[0].expression;
  if (ts.isIdentifier(e)) {
    const c = findClassByIdent(mod, e.text);
    return c ? {cls: c, mod, name: e.text} : null;
  }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
    const target = mod.alias.get(e.expression.text);
    const tm = target && moduleById.get(target);
    if (tm) {
      const id = tm.exportsMap[e.name.text];
      const c = id && findClassByIdent(tm, id);
      if (c) return {cls: c, mod: tm, name: e.name.text, ext: true};
    }
    return {unknown: true, text: e.getText(mod.sf)};
  }
  return null;
}
const clsKey = (mod, cls) => mod.id + ':' + cls.pos;
for (const m of modules) {
  (function w(n) {
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
      const so = superOf(n, m);
      if (so && so.cls) { const k = clsKey(so.mod, so.cls); subclassCount.set(k, (subclassCount.get(k) || 0) + 1); }
    }
    ts.forEachChild(n, w);
  })(m.node.body);
}

// ---------------------------------------------------------------- Auswerter fuer URL-Bauer
let uid = 0;
const emissions = [];
const links = [];        // /api/-Zeichenketten, die nicht an HttpClient gehen
const callerArgs = new Map(); // methodenname -> [ [argBeschreibung...] je Position ]
const diag = {unresolvedRequests: [], variantOverflow: 0};

const lit = s => ({l: s});
const dyn = (name, kind, extra) => ({d: name, k: kind, ...(extra || {})});
const S = (parts, extra) => ({t: 's', p: parts, ...(extra || {})});
const U = () => ({t: 'u'});

class Env {
  constructor(parent) { this.m = new Map(); this.parent = parent; }
  get(k) { for (let e = this; e; e = e.parent) if (e.m.has(k)) return e.m.get(k); return undefined; }
  has(k) { return this.get(k) !== undefined; }
  set(k, v) { this.m.set(k, v); }
}

function newBuilder(basePath) { return {path: basePath.map(s => ({parts: [lit(s)], cond: []})), params: []}; }

function classFieldAssignments(cls, name, sf) {
  // alle `this.<name> = <expr>` im Klassenkoerper (ohne verschachtelte Klassen)
  const out = [];
  (function w(n, top) {
    if (!top && (ts.isClassDeclaration(n) || ts.isClassExpression(n))) return;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && n.left.expression.kind === ts.SyntaxKind.ThisKeyword && n.left.name.text === name) out.push(n);
    ts.forEachChild(n, c => w(c, false));
  })(cls, true);
  return out;
}

function findMethod(cls, name) {
  for (const mem of cls.members) {
    if (ts.isMethodDeclaration(mem) && mem.name.getText() === name) return mem;
  }
  return null;
}

function renderPart(p) {
  if (p.l !== undefined) return p.l;
  if (p.alt) return '{' + p.alt.map(a => a.map(renderPart).join('')).join('|') + '}';
  return '{' + tokenName(p) + '}';
}
function tokenName(p) {
  if (p.k === 'param') return p.pos ? 'p' + p.pos : p.d;
  if (p.k === 'free' || p.k === 'local') return '?' + p.d;
  return p.d;
}

// Zerlegt Part[] mit Alternativen in Varianten (Cap 6)
function expandAlt(parts) {
  let variants = [[]];
  for (const p of parts) {
    if (p.alt) {
      const next = [];
      for (const v of variants) for (const a of p.alt) for (const av of expandAlt(a)) next.push(v.concat(av));
      variants = next.slice(0, 12);
    } else variants = variants.map(v => v.concat([p]));
  }
  return variants;
}

function condKey(c) { return c.map(x => x.join(':')).join('|'); }
// ist eine Mutation mit Bedingungsstapel `mc` im Kontext eines Aufrufs mit Stapel `ec` moeglich?
function consistent(mc, ec) {
  for (const [id, br] of mc) {
    for (const [id2, br2] of ec) if (id === id2 && br !== br2) return false;
  }
  return true;
}

// Rendert einen Bauer an dieser Stelle zu Varianten {path, query[]}.
// Pfadsegmente verzweigen (jede Bedingung kann ein Segment beitragen oder nicht); Query-Parameter werden vereinigt,
// bedingte tragen ein '*' (nur manchmal gesetzt).
function renderBuilder(b, ec) {
  const fixed = new Set(ec.map(x => x[0]));
  const pathItems = b.path.filter(s => consistent(s.cond, ec));
  const paramItems = b.params.filter(p => consistent(p.cond, ec));
  const groups = new Map();
  for (const it of pathItems) for (const [id, br] of it.cond) if (!fixed.has(id)) { if (!groups.has(id)) groups.set(id, new Set()); groups.get(id).add(br); }
  let combos = [[]];
  for (const id of groups.keys()) {
    const opts = [...groups.get(id)].map(br => [id, br]); opts.push([id, '__none']);
    const next = [];
    for (const c of combos) for (const o of opts) next.push(c.concat([o]));
    combos = next;
    if (combos.length > 24) { diag.variantOverflow++; combos = combos.slice(0, 24); break; }
  }
  const query = [];
  const seenQ = new Set();
  for (const p of paramItems) {
    const open = p.cond.some(([id]) => !fixed.has(id));
    const k = p.key.map(renderPart).join('') + (p.arr ? '[]' : '') + (open ? '*' : '');
    if (!seenQ.has(k)) { seenQ.add(k); query.push(k); }
  }
  const results = [];
  const seen = new Set();
  for (const combo of combos) {
    const sel = new Map(combo);
    const chosen = pathItems.filter(it => it.cond.every(([id, br]) => fixed.has(id) || sel.get(id) === br));
    let pv = [[]];
    for (const seg of chosen) {
      const exp = expandAlt(seg.parts);
      const nxt = [];
      for (const base of pv) for (const e of exp) nxt.push(base.concat([e]));
      pv = nxt.slice(0, 12);
    }
    for (const segList of pv) {
      const pathStr = segList.map(sp => sp.map(renderPart).join('')).join('/');
      if (seen.has(pathStr)) continue; seen.add(pathStr);
      const dyns = [];
      for (const sp of segList) for (const part of sp) if (part.d !== undefined) dyns.push(part);
      results.push({path: pathStr, query, dyns, conditional: combo.length > 0});
    }
  }
  return results;
}

function cloneBuilder(b) { return {path: b.path.map(x => ({...x})), params: b.params.map(x => ({...x}))}; }

function descArg(a, sf) {
  if (!a) return null;
  if (ts.isPropertyAccessExpression(a)) return {k: 'member', n: a.name.text};
  if (ts.isStringLiteral(a) || ts.isNumericLiteral(a)) return {k: 'lit', n: a.text};
  if (ts.isIdentifier(a)) return {k: 'id', n: a.text};
  if (ts.isCallExpression(a) && ts.isPropertyAccessExpression(a.expression) && /^(get|getItem)$/.test(a.expression.name.text) && a.arguments[0] && ts.isStringLiteral(a.arguments[0])) return {k: 'getter', n: a.arguments[0].text};
  if (ts.isPrefixUnaryExpression(a)) return descArg(a.operand, sf);
  return {k: 'expr', n: a.getText(sf).slice(0, 40)};
}

let condId = 0;
const fieldBusy = new Set();

function makeCtx(mod, cls, fnName, env, extra) {
  return {mod, cls, fnName, env, cond: [], depth: 0, quiet: false, params: [], fields: new Map(), ...(extra || {})};
}

function visit(n, ctx) {
  if (!n) return U();
  const sf = ctx.mod.sf;
  switch (n.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral: {
      const v = S([lit(n.text)]);
      if (n.text.length > 4 && n.text.indexOf('api') >= 0) noteLink(n, v, ctx);
      return v;
    }
    case ts.SyntaxKind.NumericLiteral:
      return S([lit(n.text)]);
    case ts.SyntaxKind.ParenthesizedExpression:
    case ts.SyntaxKind.AsExpression:
    case ts.SyntaxKind.NonNullExpression:
      return visit(n.expression, ctx);
    case ts.SyntaxKind.TemplateExpression: {
      const parts = [lit(n.head.text)];
      for (const sp of n.templateSpans) {
        const v = visit(sp.expression, ctx);
        parts.push(...strParts(v, sp.expression, sf));
        parts.push(lit(sp.literal.text));
      }
      const v = S(parts);
      noteLink(n, v, ctx);
      return v;
    }
    case ts.SyntaxKind.Identifier: {
      const v = ctx.env.get(n.text);
      if (v) return v;
      if (n.text === 'undefined') return U();
      return S([dyn(n.text, 'free')]);
    }
    case ts.SyntaxKind.ThisKeyword: return U();
    case ts.SyntaxKind.PropertyAccessExpression: return visitProp(n, ctx);
    case ts.SyntaxKind.ElementAccessExpression: {
      visit(n.expression, ctx); visit(n.argumentExpression, ctx);
      return S([dyn(n.argumentExpression.getText(sf).slice(0, 20), 'expr')]);
    }
    case ts.SyntaxKind.BinaryExpression: return visitBinary(n, ctx);
    case ts.SyntaxKind.PrefixUnaryExpression:
    case ts.SyntaxKind.TypeOfExpression:
    case ts.SyntaxKind.VoidExpression: {
      const v = visit(n.operand || n.expression, ctx);
      if (n.kind === ts.SyntaxKind.PrefixUnaryExpression && v.t === 's' && (n.operator === ts.SyntaxKind.PlusToken || n.operator === ts.SyntaxKind.MinusToken)) return v;
      if (n.kind === ts.SyntaxKind.PrefixUnaryExpression && n.operator === ts.SyntaxKind.ExclamationToken && ts.isNumericLiteral(n.operand)) return U();
      return U();
    }
    case ts.SyntaxKind.ConditionalExpression: {
      visit(n.condition, ctx);
      const id = ++condId;
      const a = withCond(ctx, id, 'a', () => visit(n.whenTrue, ctx));
      const b = withCond(ctx, id, 'b', () => visit(n.whenFalse, ctx));
      if (a.t === 's' && b.t === 's') return S([{alt: [a.p, b.p]}]);
      if (a.t === 'b') return a;
      if (b.t === 'b') return b;
      if (a.t === 'o') return a;
      return a.t === 's' ? a : b;
    }
    case ts.SyntaxKind.ObjectLiteralExpression: return visitObject(n, ctx);
    case ts.SyntaxKind.ArrayLiteralExpression: {
      const els = n.elements.map(e => visit(e, ctx));
      return {t: 'arr', els};
    }
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.FunctionExpression:
      return visitFunction(n, ctx, false);
    case ts.SyntaxKind.FunctionDeclaration:
      visitFunction(n, ctx, true); return U();
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.ClassExpression:
      visitClass(n, ctx); return U();
    case ts.SyntaxKind.NewExpression: return visitNew(n, ctx);
    case ts.SyntaxKind.CallExpression: return visitCall(n, ctx);
    case ts.SyntaxKind.VariableStatement:
      for (const d of n.declarationList.declarations) visitDecl(d, ctx);
      return U();
    case ts.SyntaxKind.VariableDeclarationList:
      for (const d of n.declarations) visitDecl(d, ctx);
      return U();
    case ts.SyntaxKind.ExpressionStatement: return visit(n.expression, ctx);
    case ts.SyntaxKind.ReturnStatement: {
      const v = n.expression ? visit(n.expression, ctx) : U();
      if (ctx.collectRet) ctx.ret = v;
      return v;
    }
    case ts.SyntaxKind.IfStatement: {
      visit(n.expression, ctx);
      const id = ++condId;
      withCond(ctx, id, 'then', () => visit(n.thenStatement, ctx));
      if (n.elseStatement) withCond(ctx, id, 'else', () => visit(n.elseStatement, ctx));
      return U();
    }
    case ts.SyntaxKind.SwitchStatement: {
      visit(n.expression, ctx);
      const id = ++condId;
      n.caseBlock.clauses.forEach((cl, i) => withCond(ctx, id, 'c' + i, () => { if (cl.expression) visit(cl.expression, ctx); cl.statements.forEach(s => visit(s, ctx)); }));
      return U();
    }
    case ts.SyntaxKind.Block:
      for (const s of n.statements) visit(s, ctx);
      return U();
    case ts.SyntaxKind.SpreadElement: visit(n.expression, ctx); return U();
    case ts.SyntaxKind.TaggedTemplateExpression: visit(n.template, ctx); return U();
    default: {
      let last = U();
      ts.forEachChild(n, c => { last = visit(c, ctx); });
      return U();
    }
  }
}

function withCond(ctx, id, br, fn) {
  ctx.cond.push([id, br]);
  try { return fn(); } finally { ctx.cond.pop(); }
}

function strParts(v, node, sf) {
  if (v && v.t === 's') return v.p;
  if (v && v.t === 'b') return [dyn('builder', 'expr')];
  return [dyn(node ? node.getText(sf).slice(0, 25) : '?', 'expr')];
}

function visitDecl(d, ctx) {
  if (d.initializer) {
    const v = visit(d.initializer, ctx);
    if (ts.isIdentifier(d.name)) {
      // Konstanten auf literal-/builder-/obj-Werte binden, Rest als lokale dyn
      if (v.t === 'u') ctx.env.set(d.name.text, S([dyn(d.name.text, 'local')]));
      else ctx.env.set(d.name.text, v);
    } else if (ts.isObjectBindingPattern(d.name) || ts.isArrayBindingPattern(d.name)) {
      for (const el of d.name.elements) if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) ctx.env.set(el.name.text, S([dyn(el.name.text, 'local')]));
    }
  } else if (ts.isIdentifier(d.name)) ctx.env.set(d.name.text, S([dyn(d.name.text, 'local')]));
}

function visitObject(n, ctx) {
  const keys = [];
  const vals = {};
  let spread = false;
  for (const p of n.properties) {
    if (ts.isPropertyAssignment(p)) {
      const k = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name) ? p.name.text : (p.name.getText(ctx.mod.sf));
      keys.push(k); vals[k] = visit(p.initializer, ctx);
    } else if (ts.isShorthandPropertyAssignment(p)) { keys.push(p.name.text); }
    else if (ts.isSpreadAssignment(p)) { spread = true; visit(p.expression, ctx); }
    else if (ts.isMethodDeclaration(p)) { keys.push(p.name.getText(ctx.mod.sf) + '()'); }
    else ts.forEachChild(p, c => visit(c, ctx));
  }
  return {t: 'o', keys, vals, spread};
}

function visitFunction(n, ctx, declare) {
  const env = new Env(ctx.env);
  for (const p of n.parameters) if (ts.isIdentifier(p.name)) env.set(p.name.text, S([dyn(p.name.text, 'local')]));
  const sub = {...ctx, env, cond: ctx.cond.slice(), collectRet: false};
  if (n.body) { if (ts.isBlock(n.body)) n.body.statements.forEach(s => visit(s, sub)); else visit(n.body, sub); }
  return U();
}

function ctorOf(cls) { return cls.members.find(x => ts.isConstructorDeclaration(x)) || null; }

// Instanzkette: [{cls, mod, bind: Map(paramName -> Value)}], abgeleitete Klasse zuerst
function classChain(cls, mod, argVals) {
  const ctor = ctorOf(cls);
  const bind = new Map();
  const params = ctor ? ctor.parameters.map(p => (ts.isIdentifier(p.name) ? p.name.text : null)) : [];
  params.forEach((nm, i) => { if (nm) bind.set(nm, argVals && argVals[i] && argVals[i].t !== 'u' ? argVals[i] : S([dyn(nm, 'param', {pos: i + 1})])); });
  const chain = [{cls, mod, bind}];
  const so = superOf(cls, mod);
  if (so && so.cls) {
    // super(...)-Argumente im Konstruktor auswerten
    let sup = [];
    if (ctor && ctor.body) {
      let call = null;
      (function w(n) { if (call) return; if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.SuperKeyword) { call = n; return; } ts.forEachChild(n, w); })(ctor.body);
      if (call) {
        const env = new Env(null);
        for (const [k, v] of bind) env.set(k, v);
        const c2 = makeCtx(mod, cls, 'super-args', env, {quiet: true});
        sup = call.arguments.map(a => visit(a, c2));
      }
    } else sup = argVals || [];
    if (!ctor) { /* impliziter Konstruktor: Argumente durchreichen */ }
    chain.push(...classChain(so.cls, so.mod, sup));
  } else if (so && so.unknown) { chain.unknownSuper = so.text; }
  return chain;
}

function visitClass(cls, ctx) {
  const mod = ctx.mod;
  const hasSub = (subclassCount.get(clsKey(mod, cls)) || 0) > 0;
  const chain = classChain(cls, mod, null);
  chain.main = cls;
  const covered = new Set();
  const first = chain[0];
  for (const link of chain) {
    for (const mem of link.cls.members) {
      let nm = null;
      if (ts.isConstructorDeclaration(mem)) nm = link === first ? 'constructor' : null;
      else if (ts.isMethodDeclaration(mem) || ts.isGetAccessor(mem) || ts.isSetAccessor(mem)) nm = mem.name.getText(link.mod.sf) + (ts.isGetAccessor(mem) ? '#get' : '');
      else if (ts.isPropertyDeclaration(mem) && mem.initializer && link === first) {
        const c2 = makeCtx(mod, cls, mem.name.getText(mod.sf), new Env(ctx.env), {inst: chain, linkIdx: 0, quiet: hasSub});
        visit(mem.initializer, c2);
        continue;
      }
      if (!nm || covered.has(nm)) continue;
      covered.add(nm);
      if (link !== first && !hasSub && false) continue;
      if (hasSub && link === first) { /* Basisklasse mit Unterklassen: nur in den Instanzen der Unterklassen */ }
      runRoot(mem, link.cls, nm.replace('#get', ''), ctx, chain, chain.indexOf(link), hasSub, link.mod);
    }
  }
}

function runRoot(fn, cls, name, parentCtx, chain, linkIdx, quiet, fnMod) {
  const env = new Env(parentCtx.env);
  const params = [];
  fn.parameters && fn.parameters.forEach((p, i) => {
    if (ts.isIdentifier(p.name)) { env.set(p.name.text, S([dyn(p.name.text, 'param', {pos: i + 1})])); params.push(p.name.text); }
  });
  const ctx = makeCtx(fnMod || parentCtx.mod, cls, name, env, {params, inst: chain, linkIdx: linkIdx || 0, quiet: !!quiet, instName: chain && chain.length ? chainName(chain) : null, inherited: chain && linkIdx > 0});
  if (fn.body) fn.body.statements ? fn.body.statements.forEach(s => visit(s, ctx)) : visit(fn.body, ctx);
}
function chainName(chain) {
  return chain[0].mod.id + ':' + (chain[0].cls.name ? chain[0].cls.name.text : chain[0].cls.pos);
}

function visitNew(n, ctx) {
  const sf = ctx.mod.sf;
  n.arguments && n.arguments.forEach(a => visit(a, ctx));
  const c = n.expression;
  if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression)) {
    const target = ctx.mod.alias.get(c.expression.text);
    if (target === URL_BUILDER_MODULE) return {t: 'b', b: newBuilder([])};
  }
  if (ts.isIdentifier(c) && c.text === 'FormData') return {t: 'o', keys: [], vals: {}, spread: false, form: true};
  if (ts.isIdentifier(c) && c.text === 'HttpParams') return {t: 'o', keys: [], vals: {}, spread: false};
  return U();
}

function visitProp(n, ctx) {
  const sf = ctx.mod.sf;
  const name = n.name.text;
  const rcv = n.expression;
  // Basis-URL-Bauer: <irgendwas>.urlService.baseApiUrl, aber nicht this.baseUrl als Klassenfeld
  if (Object.prototype.hasOwnProperty.call(BASES, name)) {
    const isThis = rcv.kind === ts.SyntaxKind.ThisKeyword;
    if (!isThis) { visit(rcv, ctx); return {t: 'b', b: newBuilder(BASES[name])}; }
  }
  if (rcv.kind === ts.SyntaxKind.ThisKeyword) {
    const local = ctx.fields.get(name);
    if (local) return local;
    const chain = ctx.inst || (ctx.cls ? [{cls: ctx.cls, mod: ctx.mod, bind: new Map()}] : []);
    for (const link of chain) {
      const as = classFieldAssignments(link.cls, name, link.mod.sf);
      const fkey = clsKey(link.mod, link.cls) + ':' + name + ':' + (chain[0] ? chain[0].cls.pos : 0);
      if (as.length && !fieldBusy.has(fkey)) {
        fieldBusy.add(fkey);
        try {
          const env = new Env(null);
          for (const [k, v] of link.bind) env.set(k, v);
          const c2 = makeCtx(link.mod, link.cls, 'field:' + name, env, {quiet: true, inst: chain, linkIdx: chain.indexOf(link)});
          const v = visit(as[0].right, c2);
          if (v.t === 'b') return {t: 'b', b: cloneBuilder(v.b)};
          if (v.t === 's') return v;
          if (v.t === 'o') return v;
        } finally { fieldBusy.delete(fkey); }
        break;
      }
    }
    // Getter in der Kette
    for (const link of chain) {
      const g = link.cls.members.find(x => ts.isGetAccessor(x) && x.name.getText(link.mod.sf) === name);
      if (g && g.body && ctx.depth < 4) {
        const c2 = makeCtx(link.mod, link.cls, ctx.fnName + '>get ' + name, new Env(null), {quiet: true, collectRet: true, depth: ctx.depth + 1, inst: chain, linkIdx: chain.indexOf(link), fields: ctx.fields});
        g.body.statements.forEach(st => visit(st, c2));
        if (c2.ret && c2.ret.t === 'b') return {t: 'b', b: cloneBuilder(c2.ret.b)};
        if (c2.ret && c2.ret.t === 's') return c2.ret;
        break;
      }
    }
    return S([dyn(name, 'member', {recv: 'this'})]);
  }
  const rv = visit(rcv, ctx);
  if (rv.t === 'o' && rv.vals && rv.vals[name]) return rv.vals[name];
  if (rv.t === 'b') return {t: 'u'};
  // generischer Zugriff e.id -> benannt nach der Eigenschaft
  return S([dyn(name, 'member', {recv: rcv.getText(sf).slice(0, 25)})]);
}

function visitBinary(n, ctx) {
  const sf = ctx.mod.sf;
  const op = n.operatorToken.kind;
  if (op === ts.SyntaxKind.EqualsToken) {
    const rv = visit(n.right, ctx);
    const L = n.left;
    if (ts.isIdentifier(L)) { if (rv.t !== 'u') ctx.env.set(L.text, rv); }
    else if (ts.isPropertyAccessExpression(L)) {
      if (L.expression.kind === ts.SyntaxKind.ThisKeyword) { if (rv.t !== 'u') ctx.fields.set(L.name.text, rv); }
      else {
        const base = visit(L.expression, ctx);
        if (base.t === 'o') { base.keys.push(L.name.text); base.vals[L.name.text] = rv; }
        if (rv.t === 'url') noteUrlValue(rv, n.right, ctx, 'assign:' + L.name.text);
      }
    } else visit(L, ctx);
    return rv;
  }
  if (op === ts.SyntaxKind.CommaToken) { visit(n.left, ctx); return visit(n.right, ctx); }
  if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
    visit(n.left, ctx);
    const id = ++condId;
    return withCond(ctx, id, 'and', () => visit(n.right, ctx));
  }
  if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
    const a = visit(n.left, ctx);
    const id = ++condId;
    const b = withCond(ctx, id, 'or', () => visit(n.right, ctx));
    return a.t === 'u' ? b : a;
  }
  if (op === ts.SyntaxKind.PlusToken) {
    const a = visit(n.left, ctx), b = visit(n.right, ctx);
    const parts = strParts(a, n.left, sf).concat(strParts(b, n.right, sf));
    const v = S(parts, {q: (a.q || []).concat(b.q || [])});
    // nur an der Wurzel einer + Kette als Link werten
    if (!(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) noteLink(n, v, ctx);
    return v;
  }
  visit(n.left, ctx); visit(n.right, ctx);
  return U();
}

function noteLink(n, v, ctx) {
  if (ctx.quiet) return;
  const first = v.p[0];
  if (!first || first.l === undefined) return;
  if (!/^\/?api(\/|$)/.test(first.l) && !/\/api\//.test(first.l)) return;
  if (ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken) return;
  links.push({pos: n.pos, end: n.end, module: ctx.mod.id, chunk: ctx.mod.chunk, fn: ctx.fnName, parts: v.p, cond: ctx.cond.length > 0, text: n.getText(ctx.mod.sf).slice(0, 200), parentText: n.parent ? n.parent.getText(ctx.mod.sf).slice(0, 160) : ''});
}

function bodyInfo(arg, ctx) {
  if (!arg) return null;
  const sf = ctx.mod.sf;
  const v = visit(arg, ctx);
  if (v.t === 'o') return {fields: v.keys.slice(), form: !!v.form, spread: !!v.spread, src: arg.getText(sf).slice(0, 100)};
  if (ts.isIdentifier(arg) && ctx.params.includes(arg.text)) return {fields: [], note: 'param', param: ctx.params.indexOf(arg.text) + 1, src: arg.getText(sf)};
  if (v.t === 's') return {fields: [], note: 'string/dyn', src: arg.getText(sf).slice(0, 100)};
  if (v.t === 'arr') return {fields: [], note: 'array', src: arg.getText(sf).slice(0, 100)};
  return {fields: null, src: arg.getText(sf).slice(0, 100)};
}

function visitCall(n, ctx) {
  const sf = ctx.mod.sf;
  const callee = n.expression;
  if (ts.isPropertyAccessExpression(callee)) {
    const name = callee.name.text;
    const rcv = callee.expression;
    const rcvText = rcv.getText(sf);
    // Builder-Mutation: b.push(..), b.path.push(..), b.put(k,v)
    if (name === 'push' || name === 'put' || name === 'putArray') {
      let target = null;
      if (name === 'push' && ts.isPropertyAccessExpression(rcv) && rcv.name.text === 'path') { const bv = visit(rcv.expression, ctx); if (bv.t === 'b') target = bv; }
      else { const bv = visit(rcv, ctx); if (bv.t === 'b') target = bv; }
      if (target) {
        const args = n.arguments.map(a => visit(a, ctx));
        const cond = ctx.cond.map(x => x.slice());
        if (name === 'push') args.forEach((v, i) => target.b.path.push({parts: strParts(v, n.arguments[i], sf), cond}));
        else {
          const isArr = name === 'putArray' || (args[1] && args[1].t === 'arr');
          target.b.params.push({key: strParts(args[0], n.arguments[0], sf), val: args[1] ? strParts(args[1], n.arguments[1], sf) : [], cond, arr: isArr});
        }
        return target;
      }
    }
    if (name === 'serialize' && n.arguments.length === 0) {
      const bv = visit(rcv, ctx);
      if (bv.t === 'b') {
        const variants = renderBuilder(bv.b, ctx.cond);
        // Ein Wert, der alle Varianten traegt; Einzelvariante -> Parts
        const v = {t: 'url', variants, node: n};
        return v;
      }
    }
    // FormData.append(k, v)
    if (name === 'append' && n.arguments.length >= 2) {
      const base = visit(rcv, ctx);
      n.arguments.forEach(a => visit(a, ctx));
      if (base.t === 'o') { const k = visit(n.arguments[0], ctx); if (k.t === 's') base.keys.push(renderParts(k.p)); }
      return U();
    }
    // Speicher-Getter: alss.getItem("k"), localStorage.getItem("k")
    if (name === 'getItem' && n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0])) {
      visit(rcv, ctx);
      return S([dyn(n.arguments[0].text, 'storage')]);
    }
    // Durchreicher
    if (/^(toString|trim|toLowerCase|toUpperCase|toFixed|replace)$/.test(name)) {
      const v = visit(rcv, ctx); n.arguments.forEach(a => visit(a, ctx)); return v.t === 's' ? v : U();
    }
    // HTTP-Aufruf
    if (VERBS.has(name) && /(requestService|\.http|httpClient)$|^(http|requestService|httpClient)$/.test(rcvText)) {
      visit(rcv, ctx);
      const urlArg = n.arguments[0];
      const uv = urlArg ? visit(urlArg, ctx) : U();
      const hasBody = name === 'post' || name === 'put' || name === 'patch';
      const body = hasBody ? bodyInfo(n.arguments[1], ctx) : null;
      const rest = n.arguments.slice(hasBody ? 2 : 1).map(a => visit(a, ctx));
      const optSrc = n.arguments.slice(hasBody ? 2 : 1).map(a => a.getText(sf).slice(0, 120)).join(' | ');
      if (name === 'delete' && n.arguments[1]) { /* optionen mit body evtl. */ }
      emit(name, uv, urlArg, n, ctx, body, optSrc);
      return U();
    }
    // Aufruf einer Methode der eigenen Instanz (this.) oder der Oberklasse (super.), die einen Bauer/URL zurueckgibt
    if ((rcv.kind === ts.SyntaxKind.ThisKeyword || rcv.kind === ts.SyntaxKind.SuperKeyword) && ctx.depth < 4) {
      const chain = ctx.inst || (ctx.cls ? [{cls: ctx.cls, mod: ctx.mod, bind: new Map()}] : []);
      const argv = n.arguments.map(a => visit(a, ctx));
      recordCaller(n, argv, ctx);
      const startIdx = rcv.kind === ts.SyntaxKind.SuperKeyword ? (ctx.linkIdx || 0) + 1 : 0;
      for (let li = startIdx; li < chain.length; li++) {
        const link = chain[li];
        const m = link.cls.members.find(x => ts.isMethodDeclaration(x) && x.name.getText(link.mod.sf) === name);
        if (!m) continue;
        if (m.body) {
          const env = new Env(null);
          m.parameters.forEach((p, i) => { if (ts.isIdentifier(p.name)) env.set(p.name.text, argv[i] && argv[i].t !== 'u' ? argv[i] : S([dyn(p.name.text, 'param', {pos: i + 1})])); });
          const c2 = makeCtx(link.mod, link.cls, ctx.fnName + '>' + name, env, {quiet: true, collectRet: true, depth: ctx.depth + 1, cond: ctx.cond.slice(), inst: chain, linkIdx: li, fields: ctx.fields});
          m.body.statements.forEach(st => visit(st, c2));
          if (c2.ret && (c2.ret.t === 'b' || c2.ret.t === 's' || c2.ret.t === 'url')) return c2.ret.t === 'b' ? {t: 'b', b: cloneBuilder(c2.ret.b)} : c2.ret;
        }
        break;
      }
      return U();
    }
  }
  // Rest: Kinder besuchen
  if (ts.isPropertyAccessExpression(callee)) visit(callee.expression, ctx); else visit(callee, ctx);
  const restArgs = n.arguments.map(a => visit(a, ctx));
  recordCaller(n, restArgs, ctx);
  if (ts.isPropertyAccessExpression(callee) && VERBS.has(callee.name.text) && restArgs[0] && restArgs[0].t === 'url') {
    // Wrapper-Dienst, dem ein URL-Bauer uebergeben wird (z.B. this.httpService.get(builder))
    const nm = callee.name.text;
    const hasBody = nm === 'post' || nm === 'put' || nm === 'patch';
    const body = hasBody ? bodyInfo(n.arguments[1], ctx) : null;
    emit(nm, restArgs[0], n.arguments[0], n, ctx, body, 'wrapper:' + callee.expression.getText(sf).slice(-30));
  } else {
    restArgs.forEach((v, i) => { if (v && v.t === 'url') noteUrlValue(v, n.arguments[i], ctx, 'arg:' + (ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText(sf).slice(0, 20))); });
  }
  if (ts.isIdentifier(callee) && /^(encodeURIComponent|String|Number|decodeURIComponent)$/.test(callee.text) && n.arguments[0]) return visit(n.arguments[0], ctx);
  if (ts.isPropertyAccessExpression(callee) && n.arguments.length === 0) {
    const mm = /^get(?:Selected|Current)?([A-Z]\w*)$/.exec(callee.name.text);
    if (mm) return S([dyn(mm[1][0].toLowerCase() + mm[1].slice(1), 'getter', {recv: callee.name.text})]);
  }
  return U();
}

function recordCaller(n, vals, ctx) {
  if (ctx.quiet) return;
  const sf = ctx.mod.sf;
  const callee = n.expression;
  if (!ts.isPropertyAccessExpression(callee)) return;
  const mn = callee.name.text;
  if (mn.length <= 3 || !/^[a-z]/i.test(mn)) return;
  let arr = callerArgs.get(mn); if (!arr) callerArgs.set(mn, arr = []);
  n.arguments.forEach((a, i) => {
    let d = descArg(a, sf);
    const v = vals[i];
    if (v && v.t === 'o' && d) d = {k: 'obj', n: '{' + v.keys.slice(0, 12).join(',') + '}', keys: v.keys.slice(0, 40), spread: !!v.spread};
    (arr[i] = arr[i] || []).push(d);
  });
}

function noteUrlValue(v, node, ctx, kind) {
  if (ctx.quiet) return;
  for (const vr of v.variants) links.push({pos: node.pos, end: node.end, module: ctx.mod.id, chunk: ctx.mod.chunk, fn: ctx.fnName, parts: [lit(vr.path)], cond: ctx.cond.length > 0, text: node.getText(ctx.mod.sf).slice(0, 200), parentText: kind, urlValue: true, query: vr.query});
}

function renderParts(parts) { return parts.map(renderPart).join(''); }

function emit(verb, uv, urlArg, node, ctx, body, optSrc) {
  if (ctx.quiet) return;
  const sf = ctx.mod.sf;
  let variants = [];
  if (uv.t === 'url') variants = uv.variants;
  else if (uv.t === 's') {
    const alts = expandAlt(uv.p);
    for (const a of alts) variants.push({path: renderParts(a), query: [], dyns: a.filter(p => p.d !== undefined), conditional: false});
  } else {
    variants = [{path: '?', query: [], dyns: [], conditional: false, unresolved: true}];
  }
  // String mit "?a=b" im Literal: Query abtrennen
  variants = variants.map(v => {
    const i = v.path.indexOf('?');
    if (i >= 0 && !v.unresolved) {
      const q = v.path.slice(i + 1).split('&').filter(Boolean).map(s => s.replace(/=.*$/, ''));
      return {...v, path: v.path.slice(0, i), query: v.query.concat(q), litquery: true};
    }
    return v;
  });
  const rec = {
    id: ++uid, module: ctx.mod.id, chunk: ctx.mod.chunk, instModule: ctx.inst ? ctx.inst[0].mod.id : ctx.mod.id, instChunk: ctx.inst ? ctx.inst[0].mod.chunk : ctx.mod.chunk, inst: ctx.instName || null, inherited: !!ctx.inherited, fn: ctx.fnName, verb: verb === 'getText' ? 'get' : (verb === 'auth' ? 'post' : verb), via: verb,
    variants, body, opts: optSrc, params: ctx.params, pos: node.pos, urlPos: urlArg ? [urlArg.pos, urlArg.end] : null,
    text: node.getText(sf).slice(0, 220), cond: ctx.cond.length > 0
  };
  if (variants.some(v => v.unresolved)) diag.unresolvedRequests.push({chunk: ctx.mod.chunk, fn: ctx.fnName, text: rec.text});
  emissions.push(rec);
}

// ---------------------------------------------------------------- Ausfuehren je Modul
for (const m of modules) {
  const env = new Env(null);
  const ctx = makeCtx(m, null, '<modul>', env);
  const body = m.node.body;
  if (ts.isBlock(body)) body.statements.forEach(s => visit(s, ctx)); else visit(body, ctx);
}

// Links, die in einem Request-URL-Argument stecken, entfernen
const consumed = emissions.filter(e => e.urlPos).map(e => ({chunk: e.chunk, module: e.module, a: e.urlPos[0], b: e.urlPos[1]}));
const looseLinks = links.filter(l => !consumed.some(c => c.chunk === l.chunk && c.module === l.module && l.pos >= c.a && l.end <= c.b));

// ---------------------------------------------------------------- Routen
const routeArrays = []; // {module, chunk, arr:[route], node}
function routeObj(n, sf) {
  if (!ts.isObjectLiteralExpression(n)) return null;
  const o = {};
  let hasPath = false;
  for (const p of n.properties) {
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue;
    const k = p.name.getText(sf);
    if (ts.isShorthandPropertyAssignment(p)) { o[k] = {src: k}; continue; }
    o[k] = {node: p.initializer, src: p.initializer.getText(sf)};
    if (k === 'path' && ts.isStringLiteral(p.initializer)) hasPath = true;
  }
  if (!hasPath) return null;
  if (!('component' in o || 'loadChildren' in o || 'children' in o || 'redirectTo' in o || 'loadComponent' in o)) return null;
  return o;
}
function buildRoutes(arrNode, sf, mod) {
  const out = [];
  for (const el of arrNode.elements) {
    const r = routeObj(el, sf);
    if (!r) continue;
    const item = {path: r.path.node.text, guards: [], data: null, redirectTo: r.redirectTo ? r.redirectTo.src : null, component: r.component ? r.component.src : null, pathMatch: r.pathMatch ? r.pathMatch.src : null, lazy: null, children: [], other: {}};
    for (const g of ['canActivate', 'canActivateChild', 'canDeactivate', 'canLoad', 'canMatch', 'resolve']) if (g in r) item.guards.push([g, r[g].src.slice(0, 160)]);
    if (r.data) item.data = r.data.src.slice(0, 300);
    if (r.title) item.other.title = r.title.src.slice(0, 80);
    if (r.loadChildren) {
      const lc = r.loadChildren.node;
      const chunks = []; let modId = null;
      (function w(x) {
        if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === 'e' && x.arguments[0] && ts.isNumericLiteral(x.arguments[0])) chunks.push(x.arguments[0].text);
        if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === 'bind' && x.arguments[1] && ts.isNumericLiteral(x.arguments[1])) modId = x.arguments[1].text;
        if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) === false && false) {}
        ts.forEachChild(x, w);
      })(lc);
      const em = /\.then\(\w+=>\w+\.(\w+)\)\s*$/.exec(r.loadChildren.src);
      item.lazy = {chunks, module: modId, exportName: em ? em[1] : null, src: r.loadChildren.src.slice(0, 200)};
    }
    if (r.loadComponent) item.other.loadComponent = r.loadComponent.src.slice(0, 160);
    if (r.children && ts.isArrayLiteralExpression(r.children.node)) item.children = buildRoutes(r.children.node, sf, mod);
    out.push(item);
  }
  return out;
}
for (const m of modules) {
  const sf = m.sf;
  (function find(n, insideRoute) {
    if (ts.isArrayLiteralExpression(n)) {
      const rs = n.elements.filter(e => routeObj(e, sf));
      if (rs.length) {
        // nur Wurzelfelder: Eltern ist keine `children`-Eigenschaft
        const p = n.parent;
        const isChildren = p && ts.isPropertyAssignment(p) && p.name.getText(sf) === 'children' && p.parent && routeObj(p.parent, sf);
        if (!isChildren) routeArrays.push({module: m.id, chunk: m.chunk, routes: buildRoutes(n, sf, m)});
        else return;
      }
    }
    ts.forEachChild(n, c => find(c, insideRoute));
  })(m.node.body);
}

// Guards aufloesen: Identifier -> Klasse mit canActivate/canMatch/canActivateChild -> Kurzfassung
function guardSummary(modId, ident) {
  const m = moduleById.get(modId); if (!m) return null;
  const sf = m.sf;
  let found = null;
  // `let <ident> = (()=>{ class X { canActivate(...) {...} } ... })()`
  (function w(n) {
    if (found) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ident && n.initializer) found = n.initializer;
    if (ts.isClassDeclaration(n) && n.name && n.name.text === ident) found = n;
    ts.forEachChild(n, w);
  })(m.node.body);
  if (!found) return null;
  const text = found.getText(sf);
  const mm = /(canActivate|canMatch|canActivateChild|canLoad|canDeactivate)\s*\(([^)]*)\)\s*\{/.exec(text);
  if (!mm) return text.slice(0, 120);
  // Funktionskoerper ab der Klammer, grob 400 Zeichen
  return text.slice(mm.index, mm.index + 420);
}
for (const ra of routeArrays) {
  (function g(rs) {
    for (const r of rs) {
      r.guardSummaries = [];
      for (const [kind, src] of r.guards) {
        const qual = [...src.matchAll(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)];
        const mm = moduleById.get(ra.module);
        for (const q of qual) {
          const tid = mm && mm.alias.get(q[1]);
          const tm = tid && moduleById.get(tid);
          const cid = tm && tm.exportsMap[q[2]];
          if (cid) {
            const s = guardSummary(tm.id, cid);
            if (s) r.guardSummaries.push({kind, ident: q[0], summary: s, module: tm.id});
          }
        }
        const plain = src.replace(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g, ' ');
        for (const id of plain.match(/[A-Za-z_$][\w$]*/g) || []) {
          const s = guardSummary(ra.module, id);
          if (s) r.guardSummaries.push({kind, ident: id, summary: s});
        }
      }
      g(r.children);
    }
  })(ra.routes);
}

const out = {
  files: files.length,
  modules: modules.map(m => ({id: m.id, chunk: m.chunk, deps: [...m.deps], lazyChunks: [...m.lazyChunks]})),
  emissions: emissions.map(e => ({...e})),
  links: looseLinks.map(l => ({chunk: l.chunk, module: l.module, fn: l.fn, path: l.parts.map(renderPart).join(''), cond: l.cond, text: l.text, parentText: l.parentText, dyns: l.parts.filter(p => p.d !== undefined)})),
  callerArgs: Object.fromEntries([...callerArgs].map(([k, v]) => [k, v])),
  routeArrays,
  diag
};
// emissions: dyns serialisieren (bereits plain)
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(JSON.stringify({files: files.length, modules: modules.length, emissions: emissions.length, links: looseLinks.length, routeArrays: routeArrays.length, unresolved: diag.unresolvedRequests.length, variantOverflow: diag.variantOverflow}));
