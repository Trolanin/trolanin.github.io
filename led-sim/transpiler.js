/* LED simulator — Arduino-flavoured C++ subset -> JavaScript transpiler.
   Exposes window.LEDSim = { compile(src) -> { js }, SketchError }.
   Output keeps every statement on its original source line so runtime
   stack traces map straight back to the sketch. */
(function (root) {
'use strict';

class SketchError extends Error {
  constructor(msg, line) { super(msg); this.name = 'SketchError'; this.line = line || 0; }
}

/* ============================== lexer ============================== */

const PUNCT3 = new Set(['<<=', '>>=', '...']);
const PUNCT2 = new Set(['->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::']);
const ESC = { n: '\n', t: '\t', r: '\r', 0: '\0', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b' };

function stripComments(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; }
    else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i += 2; out += ' ';
    } else if (c === '"' || c === "'") {
      out += c; i++;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n) out += src[i++];
        out += src[i++];
      }
      if (src[i] === c) { out += c; i++; }
    } else { out += c; i++; }
  }
  return out;
}

function readQuoted(text, i, q) {
  let s = '';
  i++;
  while (i < text.length && text[i] !== q && text[i] !== '\n') {
    let c = text[i];
    if (c === '\\') {
      c = text[++i];
      if (c === 'x') {
        let h = '';
        while (h.length < 2 && /[0-9a-fA-F]/.test(text[i + 1] || '')) h += text[++i];
        s += String.fromCharCode(parseInt(h || '0', 16));
      } else s += (c in ESC) ? ESC[c] : c;
      i++;
    } else { s += c; i++; }
  }
  return [s, i + 1];
}

const RE_ID0 = /[A-Za-z_$]/, RE_ID = /[A-Za-z0-9_$]/, RE_DIG = /[0-9]/;
const RE_NUM = /^(?:0[xX][0-9a-fA-F']+|0[bB][01']+|(?:\d[\d']*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/;

function lex(text, line0) {
  const toks = [];
  let i = 0, line = line0 || 1;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (RE_ID0.test(c)) {
      let j = i + 1;
      while (j < n && RE_ID.test(text[j])) j++;
      toks.push({ t: 'id', v: text.slice(i, j), line });
      i = j; continue;
    }
    if (RE_DIG.test(c) || (c === '.' && RE_DIG.test(text[i + 1] || ''))) {
      const m = RE_NUM.exec(text.slice(i, i + 80));
      const raw = m[0].replace(/'/g, '');
      i += m[0].length;
      const sm = /^[uUlLfF]*/.exec(text.slice(i, i + 4));
      const suf = sm[0].toLowerCase();
      i += sm[0].length;
      const hex = /^0[xX]/.test(raw), bin = /^0[bB]/.test(raw);
      const isFloat = !hex && !bin && (/[.eE]/.test(raw) || suf.includes('f'));
      let val, ty;
      if (isFloat) { val = parseFloat(raw); ty = 'float'; }
      else {
        val = hex ? parseInt(raw, 16) : bin ? parseInt(raw.slice(2), 2) : /^0[0-7]+$/.test(raw) ? parseInt(raw, 8) : parseInt(raw, 10);
        ty = (suf.includes('ll') || val > 0xFFFFFFFF) ? 'i64' : (suf.includes('u') || val > 0x7FFFFFFF) ? 'u32' : 'i32';
      }
      toks.push({ t: 'num', v: String(val), ty, val, line });
      continue;
    }
    if (c === '"') { const [s, j] = readQuoted(text, i, '"'); toks.push({ t: 'str', v: s, line }); i = j; continue; }
    if (c === "'") { const [s, j] = readQuoted(text, i, "'"); toks.push({ t: 'chr', v: s.length ? s.charCodeAt(0) : 0, line }); i = j; continue; }
    const p3 = text.substr(i, 3), p2 = text.substr(i, 2);
    if (PUNCT3.has(p3)) { toks.push({ t: 'p', v: p3, line }); i += 3; continue; }
    if (PUNCT2.has(p2)) { toks.push({ t: 'p', v: p2, line }); i += 2; continue; }
    toks.push({ t: 'p', v: c, line });
    i++;
  }
  return toks;
}

/* =========================== preprocessor =========================== */

function expand(toks, macros, hide) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const m = t.t === 'id' ? macros.get(t.v) : undefined;
    if (!m || (hide && hide.has(t.v))) { out.push(t); continue; }
    let body;
    if (m.params) {
      const nx = toks[i + 1];
      if (!(nx && nx.t === 'p' && nx.v === '(')) { out.push(t); continue; }
      let j = i + 2, depth = 0, cur = [];
      const args = [];
      for (; j < toks.length; j++) {
        const u = toks[j];
        if (u.t === 'p') {
          if (u.v === '(' || u.v === '[' || u.v === '{') depth++;
          else if (u.v === ')' || u.v === ']' || u.v === '}') { if (depth === 0) break; depth--; }
          else if (u.v === ',' && depth === 0) { args.push(cur); cur = []; continue; }
        }
        cur.push(u);
      }
      if (cur.length || args.length) args.push(cur);
      i = j;
      body = [];
      for (const b of m.body) {
        const k = b.t === 'id' ? m.params.indexOf(b.v) : -1;
        if (k >= 0) body.push(...(args[k] || [])); else body.push(b);
      }
    } else body = m.body;
    const h = new Set(hide);
    h.add(t.v);
    for (const b of expand(body, macros, h)) out.push(Object.assign({}, b, { line: t.line }));
  }
  return out;
}

function evalCond(expr, macros) {
  const s = expr.replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (_, a, b) => macros.has(a || b) ? '1' : '0');
  const toks = expand(lex(s, 0), macros);
  const js = toks.map(t => t.t === 'id' ? (t.v === 'true' ? '1' : '0') : t.t === 'num' ? t.v : t.t === 'p' ? t.v : '0').join(' ');
  try { return !!Function('return (' + js + ')')(); } catch (e) { return false; }
}

function preprocess(src) {
  src = stripComments(src.replace(/\r\n?/g, '\n'));
  const raw = src.split('\n'), lines = [];
  for (let i = 0; i < raw.length; i++) {
    let l = raw[i], extra = 0;
    while (/\\\s*$/.test(l) && i + 1 < raw.length) { l = l.replace(/\\\s*$/, ' ') + raw[++i]; extra++; }
    lines.push(l);
    while (extra-- > 0) lines.push('');
  }
  const macros = new Map();
  const def = (name, params, body) => macros.set(name, { params, body: lex(body, 0) });
  def('ESP32', null, '1'); def('ARDUINO', null, '10819'); def('ARDUINO_ARCH_ESP32', null, '1'); def('LED_SIMULATOR', null, '1');
  def('ARRAY_SIZE', ['A'], '(sizeof(A) / sizeof((A)[0]))');
  def('_BV', ['b'], '(1UL << (b))');
  def('FASTLED_USING_NAMESPACE', null, ''); def('FASTLED_VERSION', null, '3007000'); def('GET_MILLIS', null, 'millis');
  const stack = [];
  const active = () => stack.every(s => s.active);
  const out = [];
  lines.forEach((l, idx) => {
    const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(l);
    if (!m) { out.push(active() ? l : ''); return; }
    out.push('');
    const dir = m[1], rest = m[2].trim(), top = stack[stack.length - 1];
    switch (dir) {
      case 'ifdef': case 'ifndef': {
        const d = macros.has(rest.split(/\s/)[0]);
        const a = dir === 'ifdef' ? d : !d;
        stack.push({ active: a, taken: a }); break;
      }
      case 'if': { const a = active() && evalCond(rest, macros); stack.push({ active: a, taken: a }); break; }
      case 'elif':
        if (!top) throw new SketchError('#elif without #if', idx + 1);
        if (top.taken) top.active = false; else { top.active = evalCond(rest, macros); top.taken = top.active; }
        break;
      case 'else':
        if (!top) throw new SketchError('#else without #if', idx + 1);
        top.active = !top.taken; top.taken = true; break;
      case 'endif':
        if (!top) throw new SketchError('#endif without #if', idx + 1);
        stack.pop(); break;
      case 'define':
        if (active()) {
          const dm = /^(\w+)(\(([^)]*)\))?\s*(.*)$/.exec(rest);
          if (dm) macros.set(dm[1], {
            params: dm[2] ? dm[3].split(',').map(s => s.trim()).filter(Boolean) : null,
            body: lex(dm[4], idx + 1),
          });
        }
        break;
      case 'undef': if (active()) macros.delete(rest); break;
      default: break; // include, pragma, error, warning...
    }
  });
  return { text: out.join('\n'), macros };
}

/* ============================== types ============================== */

const CLS = new Map();
function cls(name) { let c = CLS.get(name); if (!c) { c = { cls: name }; CLS.set(name, c); } return c; }

const NUM = new Set(['u8', 'i8', 'u16', 'i16', 'i32', 'u32', 'i64', 'u64', 'float', 'bool']);
const isNum = t => typeof t === 'string' && NUM.has(t);
const isCls = t => !!t && typeof t === 'object' && 'cls' in t;
const isArr = t => !!t && typeof t === 'object' && 'arr' in t;
const isPtr = t => !!t && typeof t === 'object' && 'ptr' in t;
const is64 = t => t === 'i64' || t === 'u64';
const TYPED = { u8: 'Uint8Array', i8: 'Int8Array', u16: 'Uint16Array', i16: 'Int16Array', i32: 'Int32Array', u32: 'Uint32Array', float: 'Float64Array', bool: 'Uint8Array', i64: 'Float64Array', u64: 'Float64Array' };
const SIZES = { u8: 1, i8: 1, bool: 1, u16: 2, i16: 2, i32: 4, u32: 4, float: 4, i64: 8, u64: 8 };
const RANGE = { u8: [0, 255], i8: [-128, 127], u16: [0, 65535], i16: [-32768, 32767], i32: [-2147483648, 2147483647], u32: [0, 4294967295] };
const FITS = {
  u8: ['bool'], i8: [], u16: ['u8', 'bool'], i16: ['u8', 'i8', 'bool'],
  i32: ['u8', 'i8', 'u16', 'i16', 'bool'], u32: ['u8', 'u16', 'bool'],
  i64: ['u8', 'i8', 'u16', 'i16', 'i32', 'u32', 'u64', 'bool'], u64: ['u8', 'i8', 'u16', 'i16', 'i32', 'u32', 'i64', 'bool'],
};
/* classes that behave like C++ values (copied on assignment / pass-by-value) */
const VALUE_CLASSES = new Set(['CRGB', 'CHSV', 'CRGBPalette16', 'CRGBSet']);

function elemOf(t) {
  if (isArr(t)) return t.arr;
  if (isPtr(t)) return t.ptr;
  if (isCls(t)) {
    if (t.cls === 'CRGBSet' || t.cls === 'CRGBPalette16') return cls('CRGB');
    if (t.cls === 'CRGB' || t.cls === 'CHSV') return 'u8';
  }
  return 'any';
}

function defaultTypes() {
  const m = new Map(Object.entries({
    uint8_t: 'u8', int8_t: 'i8', uint16_t: 'u16', int16_t: 'i16', uint32_t: 'u32', int32_t: 'i32', uint64_t: 'u64', int64_t: 'i64',
    byte: 'u8', word: 'u32', size_t: 'u32', ssize_t: 'i32', boolean: 'bool', uint: 'u32', uint_fast8_t: 'u8', uint_fast16_t: 'u32', uint_fast32_t: 'u32',
    fract8: 'u8', sfract7: 'i8', fract16: 'u16', sfract15: 'i16', accum88: 'u16', saccum78: 'i16', accum1616: 'u32',
    TBlendType: 'i32', EOrder: 'i32', LEDColorCorrection: 'i32', ColorTemperature: 'i32', TGradientDirectionCode: 'i32',
    TickType_t: 'u32', neoPixelType: 'u16', String: 'str', TDynamicRGBGradientPalette_byte: 'u8', TProgmemRGBGradientPalette_byte: 'u8',
    CRGBArray: 'TEMPLATE_CRGBArray',
  }));
  for (const c of ['CRGB', 'CHSV', 'CRGBPalette16', 'CRGBSet', 'Adafruit_NeoPixel', 'CLEDController', 'CFastLED', 'GradientPalette']) m.set(c, cls(c));
  for (const c of ['CHSVPalette16', 'CRGBPalette32', 'CRGBPalette256', 'TProgmemPalette16', 'TProgmemRGBPalette16', 'TProgmemHSVPalette16']) m.set(c, cls('CRGBPalette16'));
  m.set('CPixelView', cls('CRGBSet'));
  m.set('TProgmemRGBGradientPalettePtr', cls('GradientPalette'));
  return m;
}

const QUALS = new Set(['const', 'volatile', 'inline', 'constexpr', 'register', 'mutable', 'virtual', 'explicit', 'friend', 'typename', 'IRAM_ATTR', 'PROGMEM', 'FL_PROGMEM', 'ICACHE_RAM_ATTR', 'RTC_DATA_ATTR', 'DRAM_ATTR']);
const WORDS = new Set(['unsigned', 'signed', 'long', 'short', 'int', 'char', 'float', 'double', 'bool', 'void']);

function wordsType(w) {
  const has = x => w.includes(x);
  if (has('float') || has('double')) return 'float';
  if (has('bool')) return 'bool';
  if (has('void')) return 'void';
  const u = has('unsigned');
  if (has('char')) return u ? 'u8' : 'i8';
  if (has('short')) return u ? 'u16' : 'i16';
  if (w.filter(x => x === 'long').length >= 2) return u ? 'u64' : 'i64';
  return u ? 'u32' : 'i32';
}

/* ============================== parser ============================== */

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
const PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
const EVERY_MULT = { MILLISECONDS: 1, MILLIS: 1, SECONDS: 1000, MINUTES: 60000, HOURS: 3600000 };

class Parser {
  constructor(toks, types) {
    this.toks = toks; this.p = 0; this.types = types;
    this.enums = new Set(); this.varNames = new Set(); this.anon = 0;
    this.EOF = { t: 'eof', v: 'end of file', line: toks.length ? toks[toks.length - 1].line : 1 };
  }
  get tok() { return this.toks[this.p] || this.EOF; }
  peek(k) { return this.toks[this.p + k] || this.EOF; }
  isP(v, k) { const t = this.toks[this.p + (k || 0)]; return !!t && t.t === 'p' && t.v === v; }
  isId(v, k) { const t = this.toks[this.p + (k || 0)]; return !!t && t.t === 'id' && (v === undefined || t.v === v); }
  next() { return this.toks[this.p++] || this.EOF; }
  err(msg, t) { throw new SketchError(msg, (t || this.tok).line); }
  expectP(v) { if (!this.isP(v)) this.err(`expected '${v}' but found '${this.tok.v}'`); return this.next(); }
  expectId() { if (this.tok.t !== 'id') this.err(`expected a name but found '${this.tok.v}'`); return this.next(); }
  acceptP(v) { if (this.isP(v)) { this.p++; return true; } return false; }
  skipTo(v) { while (!this.isP(v) && this.tok.t !== 'eof') this.next(); this.expectP(v); }
  matching(i, open, close) {
    let d = 0;
    for (; i < this.toks.length; i++) {
      const t = this.toks[i];
      if (t.t !== 'p') continue;
      if (t.v === open) d++; else if (t.v === close && --d === 0) return i;
    }
    return -1;
  }
  skipBalanced(open, close) {
    const j = this.matching(this.p, open, close);
    if (j < 0) this.err(`missing '${close}'`);
    this.p = j + 1;
  }

  /* ---- types & declarators ---- */
  tryType() {
    const save = this.p;
    const q = { static: false, extern: false, isConst: false };
    const words = [];
    let named = null;
    for (;;) {
      const t = this.tok;
      if (t.t !== 'id') break;
      const v = t.v;
      if (QUALS.has(v)) { if (v === 'const' || v === 'constexpr') q.isConst = true; this.p++; continue; }
      if (v === 'static') { q.static = true; this.p++; continue; }
      if (v === 'extern') { q.extern = true; this.p++; continue; }
      if (v === 'std' && this.isP('::', 1)) { this.p += 2; continue; }
      if ((v === 'struct' || v === 'class' || v === 'enum' || v === 'union') && named === null && this.isId(undefined, 1) &&
          this.types.has(this.peek(1).v) && !this.isP('{', 2) && !this.isP(':', 2) && !this.isP(';', 2)) { this.p++; continue; }
      if (named === null && WORDS.has(v)) { words.push(v); this.p++; continue; }
      if (named === null && !words.length) {
        if (v === 'auto') { named = 'auto'; this.p++; continue; }
        if (this.types.has(v)) {
          named = this.types.get(v); this.p++;
          if (named === 'TEMPLATE_CRGBArray') {
            const a = this.templateArgs();
            named = { arr: cls('CRGB'), n: this.subExpr(a[0] || []) };
          } else if (this.isP('<') && isCls(named)) this.templateArgs();
          continue;
        }
      }
      break;
    }
    if (named === null && !words.length) { this.p = save; return null; }
    return { type: words.length ? wordsType(words) : named, static: q.static, extern: q.extern, isConst: q.isConst };
  }
  templateArgs() {
    this.expectP('<');
    const args = [];
    let cur = [], depth = 0;
    for (;;) {
      const t = this.next();
      if (t.t === 'eof') this.err('unterminated template arguments');
      if (t.t === 'p') {
        if (t.v === '<' || t.v === '(') depth++;
        else if (t.v === ')') depth--;
        else if (t.v === '>') { if (depth === 0) break; depth--; }
        else if (t.v === ',' && depth === 0) { args.push(cur); cur = []; continue; }
      }
      cur.push(t);
    }
    if (cur.length) args.push(cur);
    return args;
  }
  subExpr(toks) {
    const sp = new Parser(toks, this.types);
    sp.enums = this.enums; sp.varNames = this.varNames;
    return sp.parseExpr();
  }
  dims() {
    const d = [];
    while (this.acceptP('[')) {
      let n = null;
      if (!this.isP(']')) n = this.parseExpr();
      this.expectP(']');
      d.push(n);
    }
    return d;
  }
  declarator(base, optName) {
    let type = base, ref = false;
    const line = this.tok.line;
    for (;;) {
      if (this.acceptP('*')) type = { ptr: type };
      else if (this.acceptP('&') || this.acceptP('&&')) ref = true;
      else if (this.isId() && QUALS.has(this.tok.v)) this.next();
      else break;
    }
    if (this.isP('(') && this.isP('*', 1)) { // function pointer: ret (*name[N])(params)
      this.p += 2;
      let name = null;
      if (this.isId()) name = this.next().v;
      const dims = this.dims();
      this.expectP(')');
      if (this.isP('(')) this.skipBalanced('(', ')');
      let t = { fn: type };
      for (let i = dims.length - 1; i >= 0; i--) t = { arr: t, n: dims[i] };
      return { name, type: t, ref: false, line, isFnPtr: true, qual: null };
    }
    let name = null, qual = null;
    if (this.isId()) {
      name = this.next().v;
      while (this.isP('::') && this.isId(undefined, 1)) { this.next(); qual = name; name = this.next().v; }
    } else if (!optName) this.err(`expected a name but found '${this.tok.v}'`);
    const dims = this.dims();
    for (let i = dims.length - 1; i >= 0; i--) type = { arr: type, n: dims[i] };
    while (this.isId('PROGMEM') || this.isId('FL_PROGMEM')) this.next();
    return { name, qual, type, ref, line, isFnPtr: false };
  }

  /* ---- top level ---- */
  parseProgram() {
    const items = [];
    while (this.tok.t !== 'eof') {
      const r = this.external();
      if (Array.isArray(r)) items.push(...r.filter(Boolean)); else if (r) items.push(r);
    }
    return items;
  }
  isClassDefAhead() {
    return this.isP('{', 1) || (this.isId(undefined, 1) && (this.isP('{', 2) || this.isP(':', 2)));
  }
  isEnumDefAhead() {
    let j = 1;
    if (this.isId('class', j) || this.isId('struct', j)) j++;
    if (this.isId(undefined, j)) j++;
    return this.isP('{', j) || this.isP(':', j);
  }
  external() {
    const t = this.tok;
    if (this.acceptP(';')) return null;
    if (t.t === 'id') {
      switch (t.v) {
        case 'typedef': return this.typedef();
        case 'using':
          this.next();
          if (this.isId() && this.isP('=', 1)) {
            const name = this.next().v;
            this.next();
            const ty = this.tryType();
            if (!ty) this.err('unsupported using-declaration');
            let type = ty.type;
            while (this.acceptP('*')) type = { ptr: type };
            this.types.set(name, type);
          }
          this.skipTo(';');
          return null;
        case 'template': this.err('C++ templates are not supported by the simulator');
        case 'namespace': this.err('namespaces are not supported by the simulator');
        case 'struct': case 'class': case 'union':
          if (this.isId(undefined, 1) && this.isP(';', 2)) { this.types.set(this.peek(1).v, cls(this.peek(1).v)); this.p += 3; return null; }
          if (this.isClassDefAhead()) {
            const r = this.classDef();
            if (!this.isP(';')) r.nodes.push(this.declRest({ type: cls(r.name), static: false, extern: false, isConst: false }, t.line));
            else this.next();
            return r.nodes;
          }
          break;
        case 'enum':
          if (this.isEnumDefAhead()) {
            const e = this.enumDef();
            const nodes = [e];
            if (!this.isP(';')) nodes.push(this.declRest({ type: 'i32', static: false, extern: false, isConst: false }, t.line));
            else this.next();
            return nodes;
          }
          break;
        case 'DEFINE_GRADIENT_PALETTE': {
          this.next(); this.expectP('(');
          const name = this.expectId().v;
          this.expectP(')');
          const init = this.initList();
          this.acceptP(';');
          this.varNames.add(name);
          return { k: 'decl', decls: [{ name, type: cls('GradientPalette'), ref: false, init, args: null, line: t.line }], static: false, line: t.line };
        }
        case 'DECLARE_GRADIENT_PALETTE': this.skipTo(';'); return null;
        case 'static_assert': this.skipTo(';'); return null;
      }
      // out-of-class constructor / destructor:  Name::Name(...) / Name::~Name()
      if (this.types.has(t.v) && this.isP('::', 1)) {
        if (this.isP('~', 2)) { this.p += 4; this.skipBalanced('(', ')'); if (this.isP('{')) this.skipBalanced('{', '}'); else this.expectP(';'); return null; }
        if (this.isId(t.v, 2) && this.isP('(', 3)) { this.p += 2; const c = this.ctor(t.v); if (c) c.outside = true; return c; }
      }
    }
    return this.declaration();
  }
  typedef() {
    const line = this.next().line;
    if ((this.isId('struct') || this.isId('class') || this.isId('union')) && this.isClassDefAhead()) {
      let forced = null;
      if (this.isP('{', 1)) { // anonymous: borrow the typedef name
        const j = this.matching(this.p + 1, '{', '}');
        const a = this.toks[j + 1];
        if (j > 0 && a && a.t === 'id') forced = a.v;
      }
      const r = this.classDef(forced);
      do {
        let t = cls(r.name);
        while (this.acceptP('*')) t = { ptr: t };
        const alias = this.expectId().v;
        if (alias !== r.name) this.types.set(alias, t);
      } while (this.acceptP(','));
      this.expectP(';');
      return r.nodes;
    }
    if (this.isId('enum') && this.isEnumDefAhead()) {
      const e = this.enumDef();
      const alias = this.expectId().v;
      this.types.set(alias, 'i32'); this.enums.add(alias);
      if (!e.name) e.name = alias;
      this.expectP(';');
      return [e];
    }
    const ty = this.tryType();
    if (!ty) this.err('unsupported typedef', { line });
    do {
      const d = this.declarator(ty.type);
      if (d.name) this.types.set(d.name, d.type);
    } while (this.acceptP(','));
    this.expectP(';');
    return null;
  }
  enumDef() {
    const line = this.next().line;
    let scoped = false, name = null;
    if (this.isId('class') || this.isId('struct')) { this.next(); scoped = true; }
    if (this.isId()) name = this.next().v;
    if (this.acceptP(':')) { if (!this.tryType()) this.err('bad enum base type'); }
    this.expectP('{');
    const items = [];
    while (!this.isP('}')) {
      const n = this.expectId();
      let v = null;
      if (this.acceptP('=')) v = this.parseTernary();
      items.push({ name: n.v, value: v });
      if (!this.acceptP(',')) break;
    }
    this.expectP('}');
    if (name) { this.types.set(name, 'i32'); this.enums.add(name); }
    return { k: 'enum', name, scoped, items, line };
  }
  classDef(forcedName) {
    const line = this.tok.line;
    const kw = this.next().v;
    let name = this.isId() ? this.next().v : (forcedName || '__anon' + (++this.anon));
    this.types.set(name, cls(name));
    let base = null;
    if (this.acceptP(':')) {
      do {
        while (this.isId('public') || this.isId('private') || this.isId('protected') || this.isId('virtual')) this.next();
        const b = this.expectId().v;
        if (!base) base = b;
      } while (this.acceptP(','));
    }
    this.expectP('{');
    const def = { k: 'class', name, base, fields: [], methods: [], ctors: [], line };
    const pre = [];
    while (!this.isP('}')) {
      if (this.tok.t === 'eof') this.err(`missing '}' for ${kw} ${name}`, { line });
      if (this.acceptP(';')) continue;
      if (this.isId() && (this.tok.v === 'public' || this.tok.v === 'private' || this.tok.v === 'protected') && this.isP(':', 1)) { this.p += 2; continue; }
      if (this.isId('explicit') || this.isId('virtual') && this.isP('~', 1)) { this.next(); continue; }
      if (this.isP('~')) { this.next(); this.expectId(); this.skipBalanced('(', ')'); if (this.isP('{')) this.skipBalanced('{', '}'); else this.skipTo(';'); continue; }
      if (this.isId(name) && this.isP('(', 1)) { const c = this.ctor(name); if (c) def.ctors.push(c); continue; }
      if (this.isId('enum') && this.isEnumDefAhead()) { pre.push(this.enumDef()); this.expectP(';'); continue; }
      if ((this.isId('struct') || this.isId('class')) && this.isClassDefAhead()) { const r = this.classDef(); pre.push(...r.nodes); this.expectP(';'); continue; }
      if (this.isId('typedef')) { this.typedef(); continue; }
      if (this.isId('using') || this.isId('friend')) { this.skipTo(';'); continue; }
      const ty = this.tryType();
      if (!ty) this.err(`unexpected '${this.tok.v}' in ${kw} ${name}`);
      for (;;) {
        const d = this.declarator(ty.type);
        if (this.isP('(') && !d.isFnPtr) {
          const fn = this.funcRest(d, ty);
          if (fn) def.methods.push(fn);
          break;
        }
        let init = null;
        if (this.acceptP(':')) this.parseTernary(); // bit-field width
        if (this.acceptP('=')) init = this.initializer(); else if (this.isP('{')) init = this.initList();
        def.fields.push({ name: d.name, type: d.type, init, static: ty.static, line: d.line });
        this.varNames.add(d.name);
        if (this.acceptP(',')) continue;
        this.expectP(';');
        break;
      }
    }
    this.expectP('}');
    return { nodes: [...pre, def], name };
  }
  ctor(name) {
    const line = this.next().line;
    const params = this.params();
    const inits = [];
    if (this.acceptP(':')) {
      do {
        const n = this.expectId().v;
        inits.push({ name: n, args: this.isP('{') ? this.initList().items : this.args() });
      } while (this.acceptP(','));
    }
    if (this.acceptP(';')) return null;
    if (this.acceptP('=')) { this.skipTo(';'); return null; }
    return { k: 'ctor', cls: name, name, params, inits, body: this.block(), line, ret: 'void', async: false };
  }
  params() {
    this.expectP('(');
    const ps = [];
    if (this.isId('void') && this.isP(')', 1)) this.next();
    while (!this.isP(')')) {
      if (this.acceptP('...')) continue;
      const ty = this.tryType();
      if (!ty) this.err(`expected a parameter type but found '${this.tok.v}'`);
      const d = this.declarator(ty.type, true);
      let def = null;
      if (this.acceptP('=')) def = this.parseAssign();
      ps.push({ name: d.name, type: d.type, ref: d.ref, def, line: d.line });
      if (d.name) this.varNames.add(d.name);
      if (!this.acceptP(',')) break;
    }
    this.expectP(')');
    return ps;
  }
  funcRest(d, ty) {
    const params = this.params();
    while (this.isId('const') || this.isId('override') || this.isId('noexcept') || this.isId('final')) this.next();
    if (this.acceptP(';')) return null;
    if (this.acceptP('=')) { this.skipTo(';'); return null; }
    return { k: 'fn', name: d.name, qual: d.qual, ret: d.type, params, body: this.block(), line: d.line, static: ty.static, async: false };
  }
  unknownTypeCheck() { // "Foo x" / "Foo *x" where Foo is not a type we know
    if (this.isId() && (this.isId(undefined, 1) || ((this.isP('*', 1) || this.isP('&', 1)) && this.isId(undefined, 2) && (this.isP('=', 3) || this.isP(';', 3))))) {
      this.err(`unknown type '${this.tok.v}' — the simulator does not provide this library or type`);
    }
  }
  looksLikeParams() {
    if (this.isP(')', 1)) return true;
    const save = this.p;
    this.p++;
    const ty = this.tryType();
    const ok = !!ty && !this.isP('(') && !this.isP('::') && !this.isP('{');
    this.p = save;
    return ok;
  }
  declaration() {
    const line = this.tok.line;
    const ty = this.tryType();
    if (!ty) { this.unknownTypeCheck(); this.err(`unexpected '${this.tok.v}'`); }
    if (this.acceptP(';')) return null;
    const first = this.declarator(ty.type);
    if (!first.isFnPtr && this.isP('(') && this.looksLikeParams()) return this.funcRest(first, ty);
    const node = this.declRest(ty, line, first);
    if (ty.extern && !node.decls.some(d => d.init || d.args)) return null;
    return node;
  }
  declRest(ty, line, first) {
    const decls = [];
    let d = first || this.declarator(ty.type);
    for (;;) {
      const item = { name: d.name, qual: d.qual, type: d.type, ref: d.ref, init: null, args: null, line: d.line };
      if (this.acceptP('=')) item.init = this.initializer();
      else if (this.isP('(')) item.args = this.args();
      else if (this.isP('{')) item.init = this.initList();
      this.varNames.add(d.name);
      decls.push(item);
      if (!this.acceptP(',')) break;
      d = this.declarator(ty.type);
    }
    this.expectP(';');
    return { k: 'decl', decls, static: ty.static, line };
  }
  initializer() { return this.isP('{') ? this.initList() : this.parseAssign(); }
  initList() {
    const line = this.tok.line;
    this.expectP('{');
    const items = [];
    while (!this.isP('}')) {
      if (this.isP('.') && this.isId(undefined, 1) && this.isP('=', 2)) this.p += 3; // designated -> positional
      items.push(this.initializer());
      if (!this.acceptP(',')) break;
    }
    this.expectP('}');
    return { k: 'init', items, line };
  }
  args() {
    this.expectP('(');
    const a = [];
    while (!this.isP(')')) {
      a.push(this.initializer());
      if (!this.acceptP(',')) break;
    }
    this.expectP(')');
    return a;
  }

  /* ---- statements ---- */
  block() {
    const open = this.tok;
    this.expectP('{');
    const body = [];
    while (!this.isP('}')) {
      if (this.tok.t === 'eof') this.err("missing '}' for the block opened here", open);
      body.push(this.statement());
    }
    this.next();
    return { k: 'block', body, line: open.line };
  }
  statement() {
    const t = this.tok, line = t.line;
    if (t.t === 'p') {
      if (t.v === '{') return this.block();
      if (t.v === ';') { this.next(); return { k: 'empty', line }; }
    }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.next(); this.expectP('(');
          const c = this.parseExpr();
          this.expectP(')');
          const a = this.statement();
          let b = null;
          if (this.isId('else')) { this.next(); b = this.statement(); }
          return { k: 'if', c, a, b, line };
        }
        case 'while': {
          this.next(); this.expectP('(');
          const c = this.parseExpr();
          this.expectP(')');
          return { k: 'while', c, body: this.statement(), line };
        }
        case 'do': {
          this.next();
          const body = this.statement();
          if (!this.isId('while')) this.err("expected 'while' after the do-body");
          this.next(); this.expectP('(');
          const c = this.parseExpr();
          this.expectP(')'); this.expectP(';');
          return { k: 'do', body, c, line };
        }
        case 'for': {
          this.next(); this.expectP('(');
          const save = this.p;
          const ty = this.tryType();
          if (ty && (this.isId() || this.isP('&') || this.isP('*') || this.isP('&&'))) {
            let d = null;
            try { d = this.declarator(ty.type); } catch (e) { d = null; }
            if (d && this.acceptP(':')) {
              const range = this.parseExpr();
              this.expectP(')');
              this.varNames.add(d.name);
              return { k: 'forof', name: d.name, type: d.type, ref: d.ref, range, body: this.statement(), line };
            }
          }
          this.p = save;
          let init = null, c = null, u = null;
          if (!this.acceptP(';')) init = this.simpleStatement();
          if (!this.isP(';')) c = this.parseExpr();
          this.expectP(';');
          if (!this.isP(')')) u = this.parseExpr();
          this.expectP(')');
          return { k: 'for', init, c, u, body: this.statement(), line };
        }
        case 'switch': {
          this.next(); this.expectP('(');
          const e = this.parseExpr();
          this.expectP(')'); this.expectP('{');
          const cases = [];
          let cur = null;
          while (!this.isP('}')) {
            if (this.tok.t === 'eof') this.err("missing '}' for switch", { line });
            if (this.isId('case')) { const cl = this.next().line; const v = this.parseTernary(); this.expectP(':'); cur = { v, body: [], line: cl }; cases.push(cur); continue; }
            if (this.isId('default') && this.isP(':', 1)) { cur = { v: null, body: [], line: this.tok.line }; this.p += 2; cases.push(cur); continue; }
            if (!cur) this.err('statement before the first case label');
            cur.body.push(this.statement());
          }
          this.next();
          return { k: 'switch', e, cases, line };
        }
        case 'return': {
          this.next();
          let e = null;
          if (!this.isP(';')) e = this.isP('{') ? this.initList() : this.parseExpr();
          this.expectP(';');
          return { k: 'return', e, line };
        }
        case 'break': case 'continue': this.next(); this.expectP(';'); return { k: t.v, line };
        case 'goto': this.err('goto is not supported by the simulator');
        case 'typedef': this.typedef(); return { k: 'empty', line };
        case 'else': this.err("'else' without a matching 'if'");
      }
      const m = /^EVERY_N_(MILLISECONDS|MILLIS|SECONDS|MINUTES|HOURS)(_I)?$/.exec(t.v);
      if (m && this.isP('(', 1)) {
        this.next();
        const a = this.args();
        if (!a.length) this.err(`${t.v} needs a period`, t);
        return { k: 'every', mult: EVERY_MULT[m[1]], n: a[a.length - 1], body: this.statement(), line };
      }
    }
    return this.simpleStatement();
  }
  simpleStatement() {
    const line = this.tok.line, save = this.p;
    const ty = this.tryType();
    if (ty) {
      let j = 0;
      while (this.isP('*', j) || this.isP('&', j) || (this.isId(undefined, j) && QUALS.has(this.peek(j).v))) j++;
      if (this.isId(undefined, j) || (this.isP('(', j) && this.isP('*', j + 1))) return this.declRest(ty, line);
      this.p = save;
    } else if (this.isId() && this.isId(undefined, 1)) this.unknownTypeCheck();
    const e = this.parseExpr();
    this.expectP(';');
    return { k: 'expr', e, line };
  }

  /* ---- expressions ---- */
  parseExpr() {
    let e = this.parseAssign();
    while (this.isP(',')) { const line = this.next().line; e = { k: 'seq', a: e, b: this.parseAssign(), line }; }
    return e;
  }
  parseAssign() {
    const l = this.parseTernary();
    const t = this.tok;
    if (t.t === 'p' && ASSIGN_OPS.has(t.v)) {
      this.next();
      const r = this.isP('{') ? this.initList() : this.parseAssign();
      return { k: 'assign', op: t.v, l, r, line: t.line };
    }
    return l;
  }
  parseTernary() {
    const c = this.parseBin(1);
    if (this.isP('?')) {
      const line = this.next().line;
      const a = this.parseExpr();
      this.expectP(':');
      const b = this.parseAssign();
      return { k: 'cond', c, a, b, line };
    }
    return c;
  }
  parseBin(min) {
    let l = this.parseUnary();
    for (;;) {
      const t = this.tok;
      const pr = t.t === 'p' ? PREC[t.v] : undefined;
      if (!pr || pr < min) return l;
      this.next();
      const r = this.parseBin(pr + 1);
      l = { k: 'bin', op: t.v, l, r, line: t.line };
    }
  }
  castType() { // after '(' or '<' : type with pointer decorations, or null
    const ty = this.tryType();
    if (!ty) return null;
    let type = ty.type;
    for (;;) {
      if (this.acceptP('*')) type = { ptr: type };
      else if (this.acceptP('&')) { /* reference cast */ }
      else if (this.isId('const')) this.next();
      else break;
    }
    return type;
  }
  parseUnary() {
    const t = this.tok, line = t.line;
    if (t.t === 'p') {
      switch (t.v) {
        case '!': case '~': case '-': case '+': case '*': case '&':
          this.next();
          return { k: 'un', op: t.v, e: this.parseUnary(), line };
        case '++': case '--':
          this.next();
          return { k: 'inc', op: t.v, prefix: true, e: this.parseUnary(), line };
        case '(': {
          const save = this.p;
          this.next();
          const type = this.castType();
          if (type && this.acceptP(')')) {
            if (this.isP('{')) return this.postfixOps({ k: 'construct', type, args: this.initList().items, line });
            return { k: 'cast', type, e: this.parseUnary(), line };
          }
          this.p = save;
          break;
        }
      }
    } else if (t.t === 'id') {
      if (t.v === 'sizeof') {
        this.next();
        if (this.isP('(')) {
          const save = this.p;
          this.next();
          const type = this.castType();
          if (type && this.acceptP(')')) return { k: 'sizeof', type, e: null, line };
          this.p = save;
        }
        return { k: 'sizeof', type: null, e: this.parseUnary(), line };
      }
      if (t.v === 'new') {
        this.next();
        const ty = this.tryType();
        if (!ty) this.err("unsupported 'new' expression");
        if (this.acceptP('[')) { const n = this.parseExpr(); this.expectP(']'); return { k: 'newarr', type: { arr: ty.type, n }, line }; }
        return { k: 'construct', type: ty.type, args: this.isP('(') ? this.args() : [], line };
      }
      if (t.v === 'delete') {
        this.next();
        if (this.acceptP('[')) this.expectP(']');
        this.parseUnary();
        return { k: 'num', v: '0', ty: 'i32', val: 0, line };
      }
      if ((t.v === 'static_cast' || t.v === 'reinterpret_cast' || t.v === 'const_cast' || t.v === 'dynamic_cast') && this.isP('<', 1)) {
        this.p += 2;
        const type = this.castType();
        if (!type) this.err('bad cast type');
        this.expectP('>'); this.expectP('(');
        const e = this.parseExpr();
        this.expectP(')');
        return this.postfixOps({ k: 'cast', type, e, line });
      }
    }
    return this.postfixOps(this.parsePrimary());
  }
  postfixOps(e) {
    for (;;) {
      const t = this.tok;
      if (t.t !== 'p') return e;
      const line = t.line;
      if (t.v === '(') e = { k: 'call', f: e, args: this.args(), line };
      else if (t.v === '[') { this.next(); const i = this.parseExpr(); this.expectP(']'); e = { k: 'index', o: e, i, line }; }
      else if (t.v === '.' || t.v === '->') {
        this.next();
        if (this.isId('template')) this.next();
        const name = this.expectId().v;
        const mem = { k: 'member', o: e, name, arrow: t.v === '->', line };
        if (name === 'addLeds' && this.isP('<')) {
          const tpl = this.templateArgs().map(a => a.map(x => x.t === 'str' ? JSON.stringify(x.v) : String(x.v)).join(''));
          e = { k: 'call', f: mem, tpl, args: this.args(), line };
        } else e = mem;
      } else if (t.v === '++' || t.v === '--') { this.next(); e = { k: 'inc', op: t.v, prefix: false, e, line }; }
      else return e;
    }
  }
  parsePrimary() {
    const t = this.tok, line = t.line;
    switch (t.t) {
      case 'num': this.next(); return { k: 'num', v: t.v, ty: t.ty, val: t.val, line };
      case 'chr': this.next(); return { k: 'num', v: String(t.v), ty: 'i8', val: t.v, chr: true, line };
      case 'str': { let s = ''; while (this.tok.t === 'str') s += this.next().v; return { k: 'str', v: s, line }; }
      case 'p':
        if (t.v === '(') { this.next(); const e = this.parseExpr(); this.expectP(')'); return e; }
        if (t.v === '{') return this.initList();
        if (t.v === '[') this.err('lambdas are not supported by the simulator');
        if (t.v === '::') { this.next(); return this.parsePrimary(); }
        break;
      case 'id': {
        switch (t.v) {
          case 'true': case 'false': this.next(); return { k: 'bool', v: t.v, line };
          case 'nullptr': case 'NULL': this.next(); return { k: 'null', line };
          case 'this': this.next(); return { k: 'this', line };
        }
        if (t.v === 'std' && this.isP('::', 1)) { this.p += 2; return this.parsePrimary(); }
        if (this.types.has(t.v) || WORDS.has(t.v)) {
          const ty = this.tryType();
          if (ty) {
            if (this.isP('(')) return { k: 'construct', type: ty.type, args: this.args(), line };
            if (this.isP('{')) return { k: 'construct', type: ty.type, args: this.initList().items, line };
            if (this.isP('::')) { this.next(); return { k: 'scope', left: t.v, type: ty.type, name: this.expectId().v, line }; }
          }
          this.err(`unexpected type name '${t.v}' in an expression`, t);
        }
        this.next();
        if (this.isP('::') && this.isId(undefined, 1)) { this.next(); return { k: 'scope', left: t.v, type: null, name: this.next().v, line }; }
        return { k: 'id', v: t.v, line };
      }
    }
    this.err(`unexpected '${t.v}'`);
  }
}

/* ============================ generator ============================ */

const JS_RESERVED = new Set(['let', 'var', 'function', 'in', 'typeof', 'instanceof', 'with', 'yield', 'await', 'export', 'import', 'super', 'null', 'arguments', 'eval', 'debugger', 'finally', 'implements', 'interface', 'package', 'extends', 'undefined', 'of', 'async']);
const jsId = n => JS_RESERVED.has(n) ? n + '$' : n;

const BLOCKING = new Set(['delay', 'delayMicroseconds', 'yield', 'vTaskDelay']);
const BLOCK_METHODS = new Set(['show', 'delay', 'showColor', 'showLeds']);
const CMP = new Set(['==', '!=', '<', '>', '<=', '>=']);
const GENERIC = new Set(['min', 'max', 'constrain', 'abs', 'sq']);

const FN_RET = {};
(function () {
  const add = (t, names) => names.split(' ').forEach(n => { FN_RET[n] = t; });
  add('u8', 'random8 sin8 cos8 scale8 scale8_video qadd8 qsub8 qmul8 triwave8 quadwave8 cubicwave8 squarewave8 ease8InOutQuad ease8InOutCubic ease8InOutApprox beat8 beatsin8 inoise8 lerp8by8 map8 dim8_raw dim8_video dim8_lin brighten8_raw brighten8_video brighten8_lin blend8 sqrt16 add8 sub8 mul8 avg8 mod8 addmod8 submod8 lowByte highByte');
  add('i8', 'avg7 abs8 qadd7');
  add('u16', 'random16 scale16 scale16by8 beat16 beat88 beatsin16 beatsin88 inoise16 lerp16by16 lerp16by8 ease16InOutQuad avg16');
  add('i16', 'sin16 cos16 lerp15by8 lerp15by16');
  add('u32', 'millis micros esp_random pulseIn');
  add('i32', 'random map digitalRead analogRead touchRead bitRead bit');
  add('float', 'sin cos tan asin acos atan atan2 sqrt pow exp log log10 log2 floor ceil round fabs fmod radians degrees sinf cosf tanf sqrtf powf fabsf floorf ceilf roundf fmodf expf logf atan2f hypot');
})();
const FN_CLS = { ColorFromPalette: 'CRGB', blend: 'CRGB', HeatColor: 'CRGB', rgb2hsv_approximate: 'CHSV' };
const METHOD_RET = {
  Color: 'u32', ColorHSV: 'u32', getPixelColor: 'u32', gamma32: 'u32', gamma8: 'u8', sine8: 'u8', numPixels: 'i32',
  getBrightness: 'u8', getLuma: 'u8', getAverageLight: 'u8', getFPS: 'i32', size: 'i32', available: 'i32', read: 'i32',
  getFreeHeap: 'u32', getHeapSize: 'u32', getCpuFreqMHz: 'u32',
};
const METHOD_CLS = { nscale8: 'CRGB', nscale8_video: 'CRGB', fadeToBlackBy: 'CRGB', fadeLightBy: 'CRGB', lerp8: 'CRGB', lerp16: 'CRGB', setRGB: 'CRGB', setHSV: 'CRGB', setHue: 'CRGB', maximizeBrightness: 'CRGB', addToRGB: 'CRGB', subtractFromRGB: 'CRGB' };
const BUILTIN_VARS = {};
'HIGH LOW INPUT OUTPUT INPUT_PULLUP INPUT_PULLDOWN LED_BUILTIN DEC HEX OCT BIN RISING FALLING CHANGE LINEARBLEND NOBLEND NEO_RGB NEO_RBG NEO_GRB NEO_GBR NEO_BRG NEO_BGR NEO_RGBW NEO_GRBW NEO_WRGB NEO_KHZ800 NEO_KHZ400 HUE_RED HUE_ORANGE HUE_YELLOW HUE_GREEN HUE_AQUA HUE_BLUE HUE_PURPLE HUE_PINK portTICK_PERIOD_MS'
  .split(' ').forEach(n => { BUILTIN_VARS[n] = 'i32'; });
'PI TWO_PI HALF_PI DEG_TO_RAD RAD_TO_DEG M_PI EULER'.split(' ').forEach(n => { BUILTIN_VARS[n] = 'float'; });
'RainbowColors_p RainbowStripeColors_p PartyColors_p CloudColors_p LavaColors_p OceanColors_p ForestColors_p HeatColors_p'
  .split(' ').forEach(n => { BUILTIN_VARS[n] = cls('CRGBPalette16'); });
const BUILTIN_FIELDS = {
  CRGB: { r: 'u8', g: 'u8', b: 'u8', red: 'u8', green: 'u8', blue: 'u8' },
  CHSV: { h: 'u8', s: 'u8', v: 'u8', hue: 'u8', sat: 'u8', val: 'u8' },
};

function arith(a, b) {
  if (a === 'float' || b === 'float') return 'float';
  if (is64(a) || is64(b)) return 'i64';
  if (a === 'u32' || b === 'u32') return 'u32';
  return 'i32';
}

function strip(c) {
  if (c[0] !== '(' || c[c.length - 1] !== ')') return c;
  let d = 0, q = false;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (q) { if (ch === '\\') i++; else if (ch === '"') q = false; continue; }
    if (ch === '"') { q = true; continue; }
    if (ch === '(' || ch === '[' || ch === '{') d++;
    else if (ch === ')' || ch === ']' || ch === '}') { d--; if (d === 0 && i < c.length - 1) return c; }
    else if (ch === ',' && d === 1) return c;
  }
  return c.slice(1, -1);
}

class Gen {
  constructor(items, parser) {
    this.items = items; this.parser = parser; this.varNames = parser.varNames;
    this.out = []; this.line = 1;
    this.scopes = [new Map()];
    this.fns = new Map(); this.classes = new Map();
    this.curFn = null; this.curClass = null;
    this.hoists = []; this.uid = 0; this.everyId = 0;
  }
  w(s) { this.out.push(s); }
  sync(line) { while (this.line < line) { this.out.push('\n'); this.line++; } }
  push() { this.scopes.push(new Map()); }
  pop() { this.scopes.pop(); }
  declare(name, t, js) { this.scopes[this.scopes.length - 1].set(name, { t, js: js || jsId(name) }); }
  lookupLocal(name) {
    for (let i = this.scopes.length - 1; i >= 1; i--) { const v = this.scopes[i].get(name); if (v) return v; }
    return null;
  }
  err(msg, n) { throw new SketchError(msg, n && n.line); }

  /* ---- class helpers ---- */
  fieldInfo(cname, name) {
    for (let c = this.classes.get(cname); c; c = this.classes.get(c.base)) { const f = c.fields.get(name); if (f) return f; }
    return null;
  }
  fieldType(cname, name) {
    const b = BUILTIN_FIELDS[cname];
    if (b && b[name]) return b[name];
    const f = this.fieldInfo(cname, name);
    return f ? f.type : 'any';
  }
  methodDefs(cname, name) {
    for (let c = this.classes.get(cname); c; c = this.classes.get(c.base)) { const m = c.methods.get(name); if (m) return m; }
    return null;
  }
  isMethodName(name) { for (const c of this.classes.values()) if (c.methods.has(name)) return true; return false; }
  asyncMethod(name) { for (const c of this.classes.values()) { const m = c.methods.get(name); if (m && m.some(d => d.async)) return true; } return false; }
  isValueClass(t) { return isCls(t) && (VALUE_CLASSES.has(t.cls) || this.classes.has(t.cls)); }
  staticSize(t) {
    if (isNum(t)) return SIZES[t];
    if (isCls(t)) {
      if (t.cls === 'CRGB' || t.cls === 'CHSV') return 3;
      const c = this.classes.get(t.cls);
      if (!c) return 4;
      let s = 0;
      for (const f of c.fields.values()) s += this.staticSize(f.type) || 4;
      return s || 1;
    }
    if (isArr(t)) return null;
    return 4;
  }

  /* ---- analysis: which functions must be async ---- */
  analyze() {
    const all = [];
    for (const it of this.items) {
      if (it.k === 'class') {
        const info = { name: it.name, base: it.base, fields: new Map(), methods: new Map(), ctors: [], def: it };
        for (const f of it.fields) info.fields.set(f.name, f);
        for (const m of it.methods) { if (!info.methods.has(m.name)) info.methods.set(m.name, []); info.methods.get(m.name).push(m); all.push(m); }
        this.classes.set(it.name, info);
      }
    }
    for (const it of this.items) {
      if (it.k !== 'fn') continue;
      all.push(it);
      if (it.qual) {
        const c = this.classes.get(it.qual);
        if (!c) this.err(`'${it.qual}' is not a known class`, it);
        if (!c.methods.has(it.name)) c.methods.set(it.name, []);
        c.methods.get(it.name).push(it);
      } else {
        if (!this.fns.has(it.name)) this.fns.set(it.name, []);
        this.fns.get(it.name).push(it);
      }
    }
    for (const defs of this.fns.values()) {
      defs.forEach(d => { d.js = defs.length > 1 ? `${jsId(d.name)}$${d.params.length}` : jsId(d.name); });
    }
    const info = new Map();
    for (const d of all) {
      const r = { block: false, deps: new Set(), mdeps: new Set() };
      this.scan(d.body, r);
      this.scan(d.params.map(p => p.def), r);
      info.set(d, r);
      d.async = r.block;
    }
    for (let changed = true; changed;) {
      changed = false;
      for (const d of all) {
        if (d.async) continue;
        const r = info.get(d);
        for (const n of r.deps) if ((this.fns.get(n) || []).some(f => f.async)) d.async = true;
        if (!d.async) for (const n of r.mdeps) if (this.asyncMethod(n)) d.async = true;
        if (d.async) changed = true;
      }
    }
  }
  scan(n, r) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const x of n) this.scan(x, r); return; }
    if (n.k === 'call') {
      const f = n.f;
      if (f.k === 'id') {
        if (BLOCKING.has(f.v)) r.block = true;
        else if (this.fns.has(f.v)) r.deps.add(f.v);
        else if (this.varNames.has(f.v)) r.block = true;
        else r.mdeps.add(f.v);
      } else if (f.k === 'member') {
        if (BLOCK_METHODS.has(f.name) || (this.varNames.has(f.name) && !this.isMethodName(f.name))) r.block = true;
        else r.mdeps.add(f.name);
      } else if (f.k !== 'scope') r.block = true;
    }
    for (const key in n) {
      if (key === 'type' || key === 'ret' || key === 'line') continue;
      const v = n[key];
      if (v && typeof v === 'object') this.scan(v, r);
    }
  }
  needsAwait(n) {
    const f = n.f;
    if (f.k === 'id') {
      if (BLOCKING.has(f.v)) return true;
      if (this.fns.has(f.v)) return this.fns.get(f.v).some(d => d.async);
      if (this.varNames.has(f.v)) return true;
      return this.asyncMethod(f.v);
    }
    if (f.k === 'member') return BLOCK_METHODS.has(f.name) || this.asyncMethod(f.name) || (this.varNames.has(f.name) && !this.isMethodName(f.name));
    return f.k !== 'scope';
  }
  aw(n, code) { return (this.curFn && this.curFn.async && this.needsAwait(n)) ? `(await ${code})` : code; }

  /* ---- program ---- */
  run() {
    this.analyze();
    for (const it of this.items) this.top(it);
    this.w(' ' + this.hoists.join(' '));
    return this.out.join('');
  }
  top(it) {
    switch (it.k) {
      case 'fn':
        if (it.qual) {
          const prev = this.curClass;
          this.curClass = this.classes.get(it.qual);
          this.emitFn(it, 'proto');
          this.curClass = prev;
        } else this.emitFn(it, 'fn');
        break;
      case 'ctor': {
        const prev = this.curClass;
        this.curClass = this.classes.get(it.cls);
        if (!this.curClass) this.err(`'${it.cls}' is not a known class`, it);
        this.emitCtor(it, true);
        this.curClass = prev;
        break;
      }
      case 'class': this.classDecl(it); break;
      case 'enum': this.enumDecl(it); break;
      case 'decl': { this.sync(it.line); const c = this.declCode(it); if (c) this.w(c + '; '); break; }
    }
  }
  enumDecl(def) {
    this.sync(def.line);
    const consts = [], props = [];
    let prevLit = -1, prevCode = null;
    for (const it of def.items) {
      let code, lit;
      if (it.value) { const x = this.expr(it.value); code = strip(x.c); lit = x.lit; }
      else if (prevLit !== undefined) { lit = prevLit + 1; code = String(lit); }
      else code = `${prevCode} + 1`;
      prevLit = lit;
      if (def.scoped) { props.push(`${it.name}: ${code}`); prevCode = `(${code})`; }
      else {
        const js = jsId(it.name);
        consts.push(`${js} = ${code}`); props.push(`${it.name}: ${js}`); prevCode = js;
        this.scopes[0].set(it.name, { t: 'i32', js });
      }
    }
    if (consts.length) this.w(`const ${consts.join(', ')}; `);
    if (def.name) this.w(`const ${def.name} = { ${props.join(', ')} }; `);
  }
  classDecl(def) {
    const info = this.classes.get(def.name);
    this.sync(def.line);
    const prevC = this.curClass, prevF = this.curFn;
    this.curClass = info; this.curFn = null;
    this.w(`class ${def.name}${def.base ? ' extends ' + def.base : ''} { `);
    const inst = def.fields.filter(f => !f.static);
    for (const f of def.fields) if (f.static) this.w(`static ${jsId(f.name)} = ${this.initCode(f.type, f.init, null)}; `);
    this.w(`static __fields = ${JSON.stringify(inst.map(f => jsId(f.name)))}; `);
    this.w(`constructor(...__a) { ${def.base ? 'super(); ' : ''}`);
    for (const f of inst) { this.sync(f.line); this.w(`this.${jsId(f.name)} = ${this.initCode(f.type, f.init, null)}; `); }
    this.w(`if (new.target === ${def.name}) __construct(this, ${def.name}, __a); } `);
    const copies = inst.map(f => {
      const n = jsId(f.name);
      return (isCls(f.type) || isArr(f.type)) ? `this.${n} = __fcopy(this.${n}, o.${n});` : `this.${n} = o.${n};`;
    });
    this.w(`__set(o) { ${def.base ? 'super.__set(o); ' : ''}${copies.join(' ')} return this; } `);
    this.w(`static __from(v) { return v instanceof ${def.name} ? new ${def.name}().__set(v) : Array.isArray(v) ? new ${def.name}(...v) : new ${def.name}(v); } `);
    for (const c of def.ctors) this.emitCtor(c, false);
    for (const m of def.methods) this.emitFn(m, 'method');
    this.w('} ');
    this.curClass = prevC; this.curFn = prevF;
  }
  paramList(def) {
    return def.params.map((p, i) => {
      const js = p.name ? jsId(p.name) : `_p${i}`;
      const code = p.def ? `${js} = ${strip(this.expr(p.def).c)}` : js;
      if (p.name) this.declare(p.name, p.type, js);
      return code;
    }).join(', ');
  }
  prologue(def) {
    for (const p of def.params) {
      if (!p.name || p.ref) continue;
      const js = jsId(p.name);
      if (this.isValueClass(p.type)) this.w(`${js} = __init(${p.type.cls}, ${js}); `);
      else if (isNum(p.type) && p.type !== 'float' && p.type !== 'bool' && !is64(p.type)) this.w(`${js} = ${strip(this.conv({ c: js, t: 'any' }, p.type))}; `);
    }
  }
  emitCtor(c, outside) {
    this.sync(c.line);
    const prevFn = this.curFn;
    this.curFn = c;
    this.push();
    const ps = this.paramList(c);
    const n = c.params.length, req = c.params.filter(p => !p.def).length;
    const C = this.curClass;
    this.w(outside ? `${C.name}.prototype.__c${n} = function (${ps}) { ` : `__c${n}(${ps}) { `);
    this.prologue(c);
    for (const it of c.inits) {
      const f = this.fieldInfo(C.name, it.name);
      if (f) {
        const tgt = `this.${jsId(it.name)}`;
        if (!it.args.length) continue;
        if (isCls(f.type) && it.args.length > 1) this.w(`${tgt} = new ${f.type.cls}(${this.argList(it.args)}); `);
        else if (isCls(f.type) || isArr(f.type)) this.w(`${tgt} = __fcopy(${tgt}, ${this.expr(it.args[0]).c}); `);
        else this.w(`${tgt} = ${this.conv(this.expr(it.args[0]), f.type)}; `);
      } else if (this.classes.has(it.name)) this.w(`__construct(this, ${it.name}, [${this.argList(it.args)}]); `);
    }
    for (const s of c.body.body) this.stmt(s);
    this.pop();
    this.curFn = prevFn;
    this.w(outside ? '}; ' : '} ');
    for (let k = req; k < n; k++) {
      this.w(outside ? `${C.name}.prototype.__c${k} = function (...a) { return this.__c${n}(...a); }; ` : `__c${k}(...a) { return this.__c${n}(...a); } `);
    }
  }
  emitFn(def, kind) {
    this.sync(def.line);
    const prevFn = this.curFn;
    this.curFn = def;
    this.push();
    const ps = this.paramList(def);
    const a = def.async ? 'async ' : '';
    if (kind === 'fn') this.w(`${a}function ${def.js}(${ps}) { `);
    else if (kind === 'method') this.w(`${def.static ? 'static ' : ''}${a}${jsId(def.name)}(${ps}) { `);
    else this.w(`${def.qual}.prototype.${jsId(def.name)} = ${a}function (${ps}) { `);
    this.prologue(def);
    for (const s of def.body.body) this.stmt(s);
    this.pop();
    this.curFn = prevFn;
    this.w(kind === 'proto' ? '}; ' : '} ');
  }

  /* ---- declarations ---- */
  argList(args) { return args.map(a => strip(this.expr(a).c)).join(', '); }
  itemList(init) { return init.items.map(e => strip(this.expr(e).c)).join(', '); }
  arrInit(type, init) {
    const el = type.arr;
    const n = type.n ? strip(this.expr(type.n).c) : null;
    if (init && init.k !== 'init') return this.expr(init).c;
    if (isNum(el)) {
      const TA = TYPED[el];
      if (init) return n ? `__ta(${TA}, ${n}, [${this.itemList(init)}])` : `${TA}.from([${this.itemList(init)}])`;
      return `new ${TA}(${n || 0})`;
    }
    if (isCls(el)) return `__carr(${el.cls}, ${n || (init ? init.items.length : 0)}${init ? `, [${this.itemList(init)}]` : ''})`;
    if (isArr(el)) {
      if (init) return `[${init.items.map(it => this.arrInit(el, it)).join(', ')}]`;
      return `Array.from({ length: ${n || 0} }, () => ${this.arrInit(el, null)})`;
    }
    if (init) return `[${this.itemList(init)}]`;
    return `new Array(${n || 0}).fill(${el === 'str' ? '""' : 'null'})`;
  }
  initCode(type, init, args) {
    if (isArr(type)) return this.arrInit(type, init);
    if (isCls(type)) {
      const C = type.cls;
      if (C === 'GradientPalette' && init && init.k === 'init') return `__gradpal([${this.itemList(init)}])`;
      if (args) return `new ${C}(${this.argList(args)})`;
      if (!init) return `new ${C}()`;
      if (init.k === 'init') return `__init(${C}, [${this.itemList(init)}])`;
      const x = this.expr(init);
      if (init.k === 'construct' && x.t === type) return x.c;
      return this.isValueClass(type) ? `__init(${C}, ${x.c})` : x.c;
    }
    if (isNum(type)) {
      let e = init;
      if (e && e.k === 'init') e = e.items[0];
      if (!e && args && args.length) e = args[0];
      if (!e) return type === 'bool' ? 'false' : '0';
      return this.conv(this.expr(e), type);
    }
    if (type === 'str') {
      if (!init) return args && args.length ? `String(${this.argList(args)})` : '""';
      return this.expr(init).c;
    }
    if (!init) return args && args.length ? this.expr(args[0]).c : 'null';
    return this.expr(init).c;
  }
  declCode(n) {
    const parts = [];
    for (const d of n.decls) {
      let type = d.type, code;
      if (type === 'auto') {
        const x = d.init ? this.expr(d.init) : { c: '0', t: 'any' };
        type = x.t;
        code = (this.isValueClass(type) && !d.ref) ? `__init(${type.cls}, ${x.c})` : x.c;
      } else if (d.ref && d.init && d.init.k !== 'init') code = this.expr(d.init).c;
      else code = this.initCode(type, d.init, d.args);
      code = strip(code);
      if (d.qual) { parts.push(`${d.qual}.${jsId(d.name)} = ${code}`); continue; }
      if (n.static && this.curFn) {
        const js = `${this.curFn.name}$${d.name}$${this.uid++}`;
        this.hoists.push(`let ${js} = ${code};`);
        this.declare(d.name, type, js);
        continue;
      }
      const js = jsId(d.name);
      this.declare(d.name, type, js);
      parts.push(`${js} = ${code}`);
    }
    if (!parts.length) return '';
    return (n.decls[0].qual ? '' : 'let ') + parts.join(', ');
  }

  /* ---- statements ---- */
  cond(e) {
    const x = this.expr(e);
    return isCls(x.t) ? `__truthy(${x.c})` : strip(x.c);
  }
  sub(body) {
    this.w('{ ');
    this.push();
    if (body.k === 'block') for (const s of body.body) this.stmt(s); else this.stmt(body);
    this.pop();
    this.w('} ');
  }
  stmt(n) {
    switch (n.k) {
      case 'empty': return;
      case 'block': this.sub(n); return;
      case 'decl': { this.sync(n.line); const c = this.declCode(n); if (c) this.w(c + '; '); return; }
      case 'expr': this.sync(n.line); this.w(strip(this.expr(n.e, true).c) + '; '); return;
      case 'if':
        this.sync(n.line);
        this.w(`if (${this.cond(n.c)}) `);
        this.sub(n.a);
        if (n.b) { this.w('else '); this.sub(n.b); }
        return;
      case 'while': this.sync(n.line); this.w(`while (${this.cond(n.c)}) `); this.sub(n.body); return;
      case 'do': this.sync(n.line); this.w('do '); this.sub(n.body); this.w(`while (${this.cond(n.c)}); `); return;
      case 'for': {
        this.sync(n.line);
        this.push();
        let init = '';
        if (n.init) init = n.init.k === 'decl' ? this.declCode(n.init) : strip(this.expr(n.init.e, true).c);
        const c = n.c ? this.cond(n.c) : '';
        const u = n.u ? strip(this.expr(n.u, true).c) : '';
        this.w(`for (${init}; ${c}; ${u}) `);
        this.sub(n.body);
        this.pop();
        return;
      }
      case 'forof': {
        this.sync(n.line);
        const r = this.expr(n.range);
        this.push();
        const t = n.type === 'auto' ? elemOf(r.t) : n.type;
        this.declare(n.name, t);
        this.w(`for (let ${jsId(n.name)} of ${r.c}) `);
        this.sub(n.body);
        this.pop();
        return;
      }
      case 'switch':
        this.sync(n.line);
        this.w(`switch (${strip(this.expr(n.e).c)}) { `);
        for (const c of n.cases) {
          this.sync(c.line);
          this.w(c.v ? `case ${strip(this.expr(c.v).c)}: ` : 'default: ');
          this.w('{ ');
          this.push();
          for (const s of c.body) this.stmt(s);
          this.pop();
          this.w('} ');
        }
        this.w('} ');
        return;
      case 'return': {
        this.sync(n.line);
        if (!n.e) { this.w('return; '); return; }
        const rt = this.curFn ? this.curFn.ret : 'any';
        const x = this.expr(n.e);
        let code;
        if (this.isValueClass(rt)) code = (x.t === rt && n.e.k !== 'init') ? x.c : `__init(${rt.cls}, ${x.c})`;
        else code = this.conv(x, rt);
        this.w(`return ${strip(code)}; `);
        return;
      }
      case 'break': case 'continue': this.sync(n.line); this.w(n.k + '; '); return;
      case 'every':
        this.sync(n.line);
        this.w(`if (__every(${this.everyId++}, ${this.expr(n.n).c} * ${n.mult})) `);
        this.sub(n.body);
        return;
    }
    this.err('internal: unknown statement ' + n.k, n);
  }

  /* ---- expressions ---- */
  conv(x, to) {
    const from = x.t;
    if (to === 'float') return x.c;
    if (!isNum(to)) return x.c;
    if (to === 'bool') return from === 'bool' ? x.c : isCls(from) ? `__truthy(${x.c})` : `(!!${x.c})`;
    if (x.lit !== undefined && Number.isInteger(x.lit) && RANGE[to] && x.lit >= RANGE[to][0] && x.lit <= RANGE[to][1]) return x.c;
    if (from === to || (FITS[to] && FITS[to].includes(from))) return x.c;
    switch (to) {
      case 'u8': return `(${x.c} & 255)`;
      case 'i8': return `(${x.c} << 24 >> 24)`;
      case 'u16': return `(${x.c} & 65535)`;
      case 'i16': return `(${x.c} << 16 >> 16)`;
      case 'i32': return `(${x.c} | 0)`;
      case 'u32': return `(${x.c} >>> 0)`;
      default: return `Math.trunc(${x.c})`;
    }
  }
  truthy(x) { return x.t === 'bool' ? x.c : isCls(x.t) ? `__truthy(${x.c})` : `(!!${x.c})`; }
  binop(op, a, b) {
    const ta = a.t, tb = b.t;
    if (op === '&&' || op === '||') return { c: `(${this.truthy(a)} ${op} ${this.truthy(b)})`, t: 'bool' };
    if (!(isNum(ta) && isNum(tb))) {
      const ca = isCls(ta), cb = isCls(tb);
      if (ca || cb) return { c: `__bin("${op}", ${a.c}, ${b.c})`, t: CMP.has(op) ? 'bool' : (ca ? ta : tb) };
      if ((op === '+' || op === '-') && (isArr(ta) || isPtr(ta)) && isNum(tb)) return { c: `__padd(${a.c}, ${op === '-' ? '-' : ''}${b.c})`, t: { ptr: elemOf(ta) } };
      if (CMP.has(op)) return { c: `(${a.c} ${op} ${b.c})`, t: 'bool' };
      return { c: `__bin("${op}", ${a.c}, ${b.c})`, t: (ta === 'str' || tb === 'str') ? 'str' : 'any' };
    }
    if (CMP.has(op)) return { c: `(${a.c} ${op} ${b.c})`, t: 'bool' };
    const t = arith(ta, tb);
    const flt = t === 'float' || t === 'i64';
    switch (op) {
      case '+': case '-':
        return { c: flt ? `(${a.c} ${op} ${b.c})` : t === 'u32' ? `(${a.c} ${op} ${b.c} >>> 0)` : `(${a.c} ${op} ${b.c} | 0)`, t };
      case '*':
        return { c: flt ? `(${a.c} * ${b.c})` : t === 'u32' ? `(Math.imul(${a.c}, ${b.c}) >>> 0)` : `Math.imul(${a.c}, ${b.c})`, t };
      case '/': return { c: t === 'float' ? `(${a.c} / ${b.c})` : `__idiv(${a.c}, ${b.c})`, t };
      case '%': return { c: t === 'float' ? `(${a.c} % ${b.c})` : `__imod(${a.c}, ${b.c})`, t };
      case '<<': { const u = ta === 'u32'; return { c: u ? `(${a.c} << ${b.c} >>> 0)` : `(${a.c} << ${b.c})`, t: u ? 'u32' : 'i32' }; }
      case '>>': { const u = ta === 'u32'; return { c: u ? `(${a.c} >>> ${b.c})` : `(${a.c} >> ${b.c})`, t: u ? 'u32' : 'i32' }; }
      default: { // & | ^
        const u = t === 'u32';
        return { c: u ? `((${a.c} ${op} ${b.c}) >>> 0)` : `(${a.c} ${op} ${b.c})`, t: u ? 'u32' : 'i32' };
      }
    }
  }
  assign(n) {
    const L = this.expr(n.l), R = this.expr(n.r);
    const op = n.op === '=' ? null : n.op.slice(0, -1);
    if (this.isValueClass(L.t)) {
      if (!op) return { c: `${L.c}.__set(${strip(R.c)})`, t: L.t };
      return { c: `__cas("${op}", ${L.c}, ${strip(R.c)})`, t: L.t };
    }
    if (!op) return { c: `(${L.c} = ${strip(this.conv(R, L.t))})`, t: L.t };
    if (!isNum(L.t)) {
      if ((isPtr(L.t) || isArr(L.t)) && (op === '+' || op === '-')) return { c: `(${L.c} = __padd(${L.c}, ${op === '-' ? '-' : ''}${R.c}))`, t: L.t };
      return { c: `(${L.c} = __bin("${op}", ${L.c}, ${R.c}))`, t: L.t };
    }
    if (isNum(R.t)) {
      if (L.t === 'float' && '+-*/'.includes(op)) return { c: `(${L.c} ${op}= ${strip(R.c)})`, t: L.t };
      if (n.l.k === 'index' && '+-*&|^'.includes(op)) return { c: `(${L.c} ${op}= ${strip(R.c)})`, t: L.t };
    }
    const B = this.binop(op, L, R);
    return { c: `(${L.c} = ${strip(this.conv(B, L.t))})`, t: L.t };
  }
  incdec(n, discard) {
    const L = this.expr(n.e), op = n.op[0];
    if (this.isValueClass(L.t)) return { c: `__cas("${op}", ${L.c}, 1)`, t: L.t };
    if (isPtr(L.t) || isArr(L.t)) return { c: `(${L.c} = __padd(${L.c}, ${op === '-' ? -1 : 1}))`, t: L.t };
    const narrow = (L.t === 'u8' || L.t === 'i8' || L.t === 'u16' || L.t === 'i16') && n.e.k !== 'index';
    if (!narrow) return { c: n.prefix ? `(${n.op}${L.c})` : `(${L.c}${n.op})`, t: L.t };
    const upd = `(${L.c} = ${this.conv(this.binop(op, L, { c: '1', t: 'i32' }), L.t)})`;
    if (n.prefix || discard) return { c: upd, t: L.t };
    return { c: this.conv({ c: `(${upd} ${op === '+' ? '-' : '+'} 1)`, t: 'i32' }, L.t), t: L.t };
  }
  ident(n) {
    const name = n.v;
    const v = this.lookupLocal(name);
    if (v) return { c: v.js, t: v.t };
    if (this.curClass) {
      const f = this.fieldInfo(this.curClass.name, name);
      if (f) return { c: (f.static ? this.curClass.name : 'this') + '.' + jsId(name), t: f.type };
      if (this.methodDefs(this.curClass.name, name)) return { c: `this.${jsId(name)}.bind(this)`, t: 'any' };
    }
    const g = this.scopes[0].get(name);
    if (g) return { c: g.js, t: g.t };
    const fn = this.fns.get(name);
    if (fn) return { c: fn[0].js, t: { fn: fn[0].ret } };
    if (name in BUILTIN_VARS) return { c: name, t: BUILTIN_VARS[name] };
    return { c: jsId(name), t: 'any' };
  }
  lookupVar(name) {
    const v = this.lookupLocal(name);
    if (v) return v;
    if (this.curClass && this.fieldInfo(this.curClass.name, name)) { const f = this.fieldInfo(this.curClass.name, name); return { js: 'this.' + jsId(name), t: f.type }; }
    return this.scopes[0].get(name) || null;
  }
  call(n) {
    const f = n.f;
    if (f.k === 'id') {
      const name = f.v;
      const v = this.lookupVar(name);
      if (v) {
        if ((isArr(v.t) && isCls(v.t.arr) && v.t.arr.cls === 'CRGB') || (isCls(v.t) && v.t.cls === 'CRGBSet')) return { c: `__sub(${v.js}, ${this.argList(n.args)})`, t: cls('CRGBSet') };
        return { c: this.aw(n, `${v.js}(${this.argList(n.args)})`), t: (v.t && v.t.fn) || 'any' };
      }
      if (this.curClass) {
        const md = this.methodDefs(this.curClass.name, name);
        if (md) return { c: this.aw(n, `${md[0].static ? this.curClass.name : 'this'}.${jsId(name)}(${this.argList(n.args)})`), t: md[0].ret };
      }
      const defs = this.fns.get(name);
      if (defs) {
        const argc = n.args.length;
        const d = defs.find(x => argc <= x.params.length && argc >= x.params.filter(p => !p.def).length) || defs[0];
        return { c: this.aw(n, `${d.js}(${this.argList(n.args)})`), t: d.ret };
      }
      if (name === 'F' && n.args.length === 1) return this.expr(n.args[0]);
      if (/^pgm_read_/.test(name) && n.args.length === 1) { const a = this.expr(n.args[0]); return { c: `__deref(${a.c})`, t: elemOf(a.t) }; }
      const args = n.args.map(a => this.expr(a));
      const code = `${jsId(name)}(${args.map(a => strip(a.c)).join(', ')})`;
      if (GENERIC.has(name)) {
        let t = 'i32';
        for (const a of args) { if (!isNum(a.t)) { t = 'any'; break; } t = arith(t, a.t); }
        return { c: code, t };
      }
      return { c: this.aw(n, code), t: FN_RET[name] || (FN_CLS[name] ? cls(FN_CLS[name]) : 'any') };
    }
    if (f.k === 'member') {
      const o = this.expr(f.o);
      let base = o.c, ct = o.t;
      if (f.o.k === 'this') base = 'this';
      else if (f.arrow) { if (isPtr(ct) || isArr(ct)) ct = elemOf(ct); base = isCls(o.t) ? o.c : `__deref(${o.c})`; }
      const name = f.name;
      if (n.tpl) return { c: `${base}.addLeds([${n.tpl.map(s => JSON.stringify(s)).join(', ')}], ${this.argList(n.args)})`, t: cls('CLEDController') };
      let args = this.argList(n.args);
      if ((name === 'print' || name === 'println') && n.args.length >= 1) {
        // C++ picks the overload by type; JS can't, so resolve chars and floats here.
        const a = n.args[0];
        if (a.k === 'num' && a.chr && n.args.length === 1) args = JSON.stringify(String.fromCharCode(a.val));
        else if (this.expr(a).t === 'float') args = `__f(${strip(this.expr(a).c)}, ${n.args.length > 1 ? strip(this.expr(n.args[1]).c) : 2})`;
      }
      let t = 'any';
      const md = isCls(ct) ? this.methodDefs(ct.cls, name) : null;
      if (md) t = md[0].ret;
      else if (METHOD_RET[name]) t = METHOD_RET[name];
      else if (METHOD_CLS[name] && isCls(ct) && ct.cls === 'CRGB') t = ct;
      return { c: this.aw(n, `${base}.${jsId(name)}(${args})`), t };
    }
    if (f.k === 'scope') return { c: `${this.expr(f).c}(${this.argList(n.args)})`, t: METHOD_RET[f.name] || 'any' };
    return { c: this.aw(n, `${this.expr(f).c}(${this.argList(n.args)})`), t: 'any' };
  }
  castTo(x, T) {
    if (isCls(T)) return { c: this.isValueClass(T) ? `__init(${T.cls}, ${x.c})` : x.c, t: T };
    if (isNum(T)) { const c = this.conv(x, T); return { c, t: T, lit: c === x.c ? x.lit : undefined }; }
    return { c: x.c, t: T === 'void' ? 'any' : T };
  }
  expr(n, discard) {
    switch (n.k) {
      case 'num': return { c: n.v, t: n.ty, lit: n.val };
      case 'str': return { c: JSON.stringify(n.v), t: 'str' };
      case 'bool': return { c: n.v, t: 'bool' };
      case 'null': return { c: 'null', t: 'any' };
      case 'this': return { c: 'this', t: this.curClass ? cls(this.curClass.name) : 'any' };
      case 'id': return this.ident(n);
      case 'seq': { const a = this.expr(n.a, discard), b = this.expr(n.b, discard); return { c: `(${strip(a.c)}, ${strip(b.c)})`, t: b.t }; }
      case 'init': return { c: `[${this.itemList(n)}]`, t: 'any' };
      case 'bin': return this.binop(n.op, this.expr(n.l), this.expr(n.r));
      case 'assign': return this.assign(n);
      case 'inc': return this.incdec(n, discard);
      case 'call': return this.call(n);
      case 'cond': {
        const c = this.cond(n.c), a = this.expr(n.a), b = this.expr(n.b);
        let t;
        if (a.t === b.t) t = a.t;
        else if (isNum(a.t) && isNum(b.t)) t = arith(a.t, b.t);
        else if (isCls(a.t)) t = a.t;
        else if (isCls(b.t)) t = b.t;
        else t = 'any';
        return { c: `(${c} ? ${a.c} : ${b.c})`, t };
      }
      case 'un': {
        if (n.op === '&') {
          if (n.e.k === 'index') { const o = this.expr(n.e.o), i = this.expr(n.e.i); return { c: `__padd(${o.c}, ${strip(i.c)})`, t: { ptr: elemOf(o.t) } }; }
          const x = this.expr(n.e);
          return { c: x.c, t: isCls(x.t) ? { ptr: x.t } : x.t };
        }
        const x = this.expr(n.e);
        switch (n.op) {
          case '+': return x;
          case '*': {
            const et = elemOf(x.t);
            if (isNum(et) && (isPtr(x.t) || isArr(x.t))) return { c: `${x.c}[0]`, t: et };
            return { c: `__deref(${x.c})`, t: et };
          }
          case '!': return { c: isCls(x.t) ? `(!__truthy(${x.c}))` : `(!${x.c})`, t: 'bool' };
          case '~': return { c: x.t === 'u32' ? `(~${x.c} >>> 0)` : `(~${x.c})`, t: x.t === 'u32' ? 'u32' : 'i32' };
          case '-':
            if (x.lit !== undefined) return { c: '-' + x.c, t: x.t === 'u32' ? 'i32' : x.t, lit: -x.lit };
            if (isCls(x.t)) return { c: `__un("-", ${x.c})`, t: x.t };
            if (!isNum(x.t) || x.t === 'float' || is64(x.t)) return { c: `(-${x.c})`, t: x.t };
            return x.t === 'u32' ? { c: `(-${x.c} >>> 0)`, t: 'u32' } : { c: `(-${x.c} | 0)`, t: 'i32' };
        }
        break;
      }
      case 'index': {
        const o = this.expr(n.o), i = this.expr(n.i);
        const idx = (isNum(i.t) && i.t !== 'float') ? strip(i.c) : `${i.c} | 0`;
        return { c: `${o.c}[${idx}]`, t: elemOf(o.t) };
      }
      case 'member': {
        if (n.o.k === 'this') return { c: `this.${jsId(n.name)}`, t: this.curClass ? this.fieldType(this.curClass.name, n.name) : 'any' };
        const o = this.expr(n.o);
        let base = o.c, ct = o.t;
        if (n.arrow) { if (isPtr(ct) || isArr(ct)) ct = elemOf(ct); base = isCls(o.t) ? o.c : `__deref(${o.c})`; }
        return { c: `${base}.${jsId(n.name)}`, t: isCls(ct) ? this.fieldType(ct.cls, n.name) : 'any' };
      }
      case 'scope': {
        if (isCls(n.type)) {
          const C = n.type.cls;
          const f = this.fieldInfo(C, n.name);
          return { c: `${C}.${jsId(n.name)}`, t: f ? f.type : (C === 'CRGB' ? n.type : 'any') };
        }
        return { c: `${jsId(n.left)}.${n.name}`, t: this.parser.enums.has(n.left) ? 'i32' : 'any' };
      }
      case 'cast': return this.castTo(this.expr(n.e), n.type);
      case 'construct': {
        const T = n.type;
        if (isCls(T)) return { c: `new ${T.cls}(${this.argList(n.args)})`, t: T };
        if (T === 'str') return { c: `String(${this.argList(n.args)})`, t: 'str' };
        if (!n.args.length) return { c: '0', t: isNum(T) ? T : 'any', lit: 0 };
        return this.castTo(this.expr(n.args[0]), T);
      }
      case 'newarr': return { c: this.arrInit(n.type, null), t: { ptr: n.type.arr } };
      case 'sizeof': {
        if (n.type) { const s = this.staticSize(n.type); return { c: String(s || 4), t: 'u32', lit: s || 4 }; }
        const x = this.expr(n.e);
        if (isArr(x.t) || (isCls(x.t) && x.t.cls === 'CRGBSet')) return { c: `__sizeof(${x.c}, ${this.staticSize(elemOf(x.t)) || 4})`, t: 'u32' };
        if (x.t === 'any' || x.t === 'str' || isPtr(x.t)) return { c: `__sizeof(${x.c}, 0)`, t: 'u32' };
        const s = this.staticSize(x.t) || 4;
        return { c: String(s), t: 'u32', lit: s };
      }
    }
    this.err('internal: unknown expression ' + n.k, n);
  }
}

/* ============================== driver ============================== */

function compile(src) {
  const pp = preprocess(String(src));
  const toks = expand(lex(pp.text, 1), pp.macros);
  const parser = new Parser(toks, defaultTypes());
  const items = parser.parseProgram();
  const gen = new Gen(items, parser);
  const body = gen.run();
  if (!gen.fns.has('setup') && !gen.fns.has('loop')) throw new SketchError('The sketch needs a setup() and/or loop() function', 1);
  const js = '(function () { "use strict"; ' + body +
    '\nreturn { setup: typeof setup === "function" ? setup : null, loop: typeof loop === "function" ? loop : null }; })';
  return { js };
}

root.LEDSim = { compile, SketchError };
})(typeof window !== 'undefined' ? window : globalThis);
