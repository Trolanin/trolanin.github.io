/* LED simulator runtime — Arduino core + FastLED + Adafruit_NeoPixel subset.
   This whole function is stringified into a Web Worker by app.js, so it must be
   fully self-contained. `host` is { post(msg), onmessage }. The transpiled sketch
   is evaluated with a direct eval inside this scope, so every name declared here
   is visible to the sketch. */
function LED_RUNTIME(host) {
  /* ======================= virtual clock & pacing ======================= */
  const _now = () => performance.now();
  let vt = 0, speed = 1, paused = false, anchorReal = _now(), anchorVt = 0, lastYield = _now(), pauseSim = 0, stopAt = Infinity;
  let advCount = 0, showCount = 0, loopCount = 0, lastBeat = 0;
  const resumeWaiters = [];
  const simNow = () => anchorVt + (_now() - anchorReal) * speed;
  const reanchor = (to) => { anchorVt = to === undefined ? vt : to; anchorReal = _now(); };
  const _mc = new MessageChannel();
  let _mcRes = null;
  _mc.port1.onmessage = () => { const r = _mcRes; _mcRes = null; if (r) r(); };
  const _tick = () => new Promise(r => { _mcRes = r; _mc.port2.postMessage(0); });
  const _sleep = ms => new Promise(r => setTimeout(r, ms));
  class StopSignal {}

  async function pace() {
    flush();
    for (;;) {
      if (vt >= stopAt) throw new StopSignal();
      if (paused) { await new Promise(r => resumeWaiters.push(r)); continue; }
      const t = _now();
      if (t - lastBeat > 200) { lastBeat = t; host.post({ type: 'stats', vt, shows: showCount, loops: loopCount }); }
      const ahead = (vt - (anchorVt + (t - anchorReal) * speed)) / speed;
      if (ahead > 1.5) { await _sleep(Math.min(ahead, 40)); lastYield = _now(); flush(); continue; }
      if (ahead < -200) reanchor();
      if (t - lastYield > 10) { await _tick(); lastYield = _now(); continue; }
      return;
    }
  }
  function advance(ms) {
    vt += ms; advCount++;
    if (!paused && vt < stopAt) {
      const t = _now();
      const ahead = vt - (anchorVt + (t - anchorReal) * speed);
      if (ahead <= 1.5 * speed && ahead > -200 && t - lastYield <= 10) return undefined;
    }
    return pace();
  }
  /* The clock is purely virtual: it only moves when the sketch waits, shows, or reads it
     (each read costs 1 us, so busy-wait loops on millis() still terminate). Pacing against
     real time happens at the next delay()/show(), which keeps timing deterministic. */
  function millis() { vt += 0.001; return Math.floor(vt) >>> 0; }
  function micros() { vt += 0.001; return Math.floor(vt * 1000) >>> 0; }
  function delay(ms) { return advance(Math.max(0, +ms || 0)); }
  function delayMicroseconds(us) { return advance(Math.max(0, +us || 0) / 1000); }
  function yield$() { return advance(0); }
  function vTaskDelay(ticks) { return advance(Math.max(0, +ticks || 0)); }
  const pdMS_TO_TICKS = ms => ms, portTICK_PERIOD_MS = 1;

  /* ============================ frame output ============================ */
  const strips = [];
  let total = 0, frameDirty = false, configDirty = false, lastPost = -1000, serialBuf = '';
  let fpsT0 = 0, fpsN0 = 0, fpsVal = 0;
  function registerStrip(n, label) {
    const s = { n, shown: new Uint8Array(n * 3), label };
    strips.push(s); total += n; configDirty = true;
    return s;
  }
  function present() {
    showCount++; frameDirty = true;
    if (vt - fpsT0 >= 500) { fpsVal = Math.round((showCount - fpsN0) * 1000 / (vt - fpsT0)); fpsT0 = vt; fpsN0 = showCount; }
    const t = _now();
    if (t - lastPost >= 7) flush(t);
    return advance(total * 0.03 + 0.3); // WS2812 timing: 30 us per pixel + latch
  }
  function flush(t) {
    if (serialBuf) { host.post({ type: 'serial', text: serialBuf }); serialBuf = ''; }
    if (configDirty) { configDirty = false; host.post({ type: 'config', strips: strips.map(s => ({ n: s.n, label: s.label })) }); }
    if (!frameDirty) return;
    frameDirty = false; lastPost = t || _now();
    const buf = new Uint8Array(total * 3);
    let o = 0, sum = 0;
    for (const s of strips) { buf.set(s.shown, o); o += s.shown.length; }
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    host.post({ type: 'frame', buf, n: total, vt, shows: showCount, mA: sum / 255 * 20 + total });
  }
  const _warned = new Set();
  function warn(msg) { if (_warned.has(msg)) return; _warned.add(msg); host.post({ type: 'warn', message: msg }); }

  /* ============================== 8-bit math ============================== */
  const scale8 = (i, s) => ((i & 255) * (1 + (s & 255))) >> 8;
  const scale8_video = (i, s) => { i &= 255; s &= 255; return ((i * s) >> 8) + ((i && s) ? 1 : 0); };
  const scale16 = (i, s) => Math.floor(((i & 65535) * (1 + (s & 65535))) / 65536);
  const scale16by8 = (i, s) => ((i & 65535) * (1 + (s & 255))) >> 8;
  const qadd8 = (a, b) => { const t = (a & 255) + (b & 255); return t > 255 ? 255 : t; };
  const qsub8 = (a, b) => { const t = (a & 255) - (b & 255); return t < 0 ? 0 : t; };
  const qmul8 = (a, b) => { const t = (a & 255) * (b & 255); return t > 255 ? 255 : t; };
  const qadd7 = (a, b) => Math.max(-128, Math.min(127, a + b));
  const add8 = (a, b) => (a + b) & 255, sub8 = (a, b) => (a - b) & 255, mul8 = (a, b) => (a * b) & 255;
  const avg8 = (a, b) => ((a & 255) + (b & 255)) >> 1, avg16 = (a, b) => ((a & 65535) + (b & 65535)) >> 1, avg7 = (a, b) => (a >> 1) + (b >> 1) + (a & 1);
  const mod8 = (a, m) => (a & 255) % m, addmod8 = (a, b, m) => ((a & 255) + (b & 255)) % m, submod8 = (a, b, m) => (((a & 255) - (b & 255)) % m + m) % m;
  const abs8 = a => Math.abs(a);
  const sqrt16 = x => Math.floor(Math.sqrt(x & 65535));
  const blend8 = (a, b, amt) => { a &= 255; b &= 255; amt &= 255; return ((a << 8 | b) + b * amt - a * amt) >> 8; };
  const dim8_raw = x => scale8(x, x), dim8_video = x => scale8_video(x, x), dim8_lin = x => { x &= 255; return (x & 0x80) ? scale8(x, x) : (x + 1) >> 1; };
  const brighten8_raw = x => 255 - dim8_raw(255 - x), brighten8_video = x => 255 - dim8_video(255 - x), brighten8_lin = x => 255 - dim8_lin(255 - x);
  const sin8 = t => { const v = Math.round(Math.sin((t & 255) * Math.PI / 128) * 127.5 + 127.5); return v > 255 ? 255 : v; };
  const cos8 = t => sin8(t + 64);
  const sin16 = t => Math.round(Math.sin((t & 65535) * Math.PI / 32768) * 32767);
  const cos16 = t => sin16(t + 16384);
  const triwave8 = x => { x &= 255; if (x & 0x80) x = 255 - x; return (x << 1) & 255; };
  const ease8InOutQuad = i => { i &= 255; let j = i; if (j & 0x80) j = 255 - j; let jj2 = scale8(j, j) << 1; if (i & 0x80) jj2 = 255 - jj2; return jj2 & 255; };
  const ease8InOutCubic = i => { const ii = scale8(i, i), iii = scale8(ii, i); const r = 3 * ii - 2 * iii; return r > 255 ? 255 : r < 0 ? 0 : r; };
  const ease8InOutApprox = ease8InOutCubic;
  const ease16InOutQuad = i => { i &= 65535; let j = i; if (j & 0x8000) j = 65535 - j; let jj2 = scale16(j, j) * 2; if (i & 0x8000) jj2 = 65535 - jj2; return jj2 & 65535; };
  const quadwave8 = x => ease8InOutQuad(triwave8(x));
  const cubicwave8 = x => ease8InOutCubic(triwave8(x));
  const squarewave8 = (x, pw = 128) => ((x & 255) < pw || pw === 255) ? 255 : 0;
  const lerp8by8 = (a, b, f) => b > a ? a + scale8(b - a, f) : a - scale8(a - b, f);
  const lerp16by16 = (a, b, f) => b > a ? a + scale16(b - a, f) : a - scale16(a - b, f);
  const lerp16by8 = (a, b, f) => b > a ? a + scale16by8(b - a, f) : a - scale16by8(a - b, f);
  const lerp15by8 = lerp16by8, lerp15by16 = lerp16by16;
  const map8 = (x, lo, hi) => { const out = lo + scale8(x, hi - lo + 1); return (x === 255 && hi > lo) ? hi : out; };

  let _rs = 1337;
  const _rnext = () => { _rs = (_rs * 2053 + 13849) & 0xFFFF; return _rs; };
  function random16(a, b) {
    const r = _rnext();
    if (a === undefined) return r;
    if (b === undefined) return (r * (a & 65535)) >>> 16;
    return ((r * ((b - a) & 65535)) >>> 16) + a;
  }
  function random8(a, b) {
    const s = _rnext();
    const r = ((s & 255) + (s >> 8)) & 255;
    if (a === undefined) return r;
    if (b === undefined) return (r * (a & 255)) >> 8;
    return ((r * ((b - a) & 255)) >> 8) + a;
  }
  const random16_set_seed = s => { _rs = s & 0xFFFF; };
  const random16_get_seed = () => _rs;
  const random16_add_entropy = e => { _rs = (_rs + e) & 0xFFFF; };

  const beat88 = (bpm88, timebase = 0) => (Math.imul((millis() - timebase) >>> 0, (bpm88 * 280) >>> 0) >>> 16) & 0xFFFF;
  const beat16 = (bpm, timebase = 0) => beat88(bpm < 256 ? bpm << 8 : bpm, timebase);
  const beat8 = (bpm, timebase = 0) => beat16(bpm, timebase) >> 8;
  const beatsin8 = (bpm, lo = 0, hi = 255, timebase = 0, phase = 0) => (lo + scale8(sin8(beat8(bpm, timebase) + phase), hi - lo)) & 255;
  const beatsin16 = (bpm, lo = 0, hi = 65535, timebase = 0, phase = 0) => (lo + scale16((sin16(beat16(bpm, timebase) + phase) + 32768) & 65535, hi - lo)) & 65535;
  const beatsin88 = (bpm88, lo = 0, hi = 65535, timebase = 0, phase = 0) => (lo + scale16((sin16(beat88(bpm88, timebase) + phase) + 32768) & 65535, hi - lo)) & 65535;

  /* Perlin noise (not bit-exact with FastLED, same character) */
  const _P = new Uint8Array(512);
  (function () {
    const p = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = 1234567;
    for (let i = 255; i > 0; i--) { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; const j = s % (i + 1); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) _P[i] = p[i & 255];
  })();
  const _fade = t => t * t * t * (t * (t * 6 - 15) + 10), _lerp = (t, a, b) => a + t * (b - a);
  function _pg(h, x, y, z) { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14) ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); }
  function _perlin(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = _fade(x), v = _fade(y), w = _fade(z);
    const A = _P[X] + Y, AA = _P[A] + Z, AB = _P[A + 1] + Z, B = _P[X + 1] + Y, BA = _P[B] + Z, BB = _P[B + 1] + Z;
    return _lerp(w,
      _lerp(v, _lerp(u, _pg(_P[AA], x, y, z), _pg(_P[BA], x - 1, y, z)), _lerp(u, _pg(_P[AB], x, y - 1, z), _pg(_P[BB], x - 1, y - 1, z))),
      _lerp(v, _lerp(u, _pg(_P[AA + 1], x, y, z - 1), _pg(_P[BA + 1], x - 1, y, z - 1)), _lerp(u, _pg(_P[AB + 1], x, y - 1, z - 1), _pg(_P[BB + 1], x - 1, y - 1, z - 1))));
  }
  const inoise8 = (x, y = 0, z = 0) => { const v = Math.round((_perlin(x / 256 + 0.37, y / 256 + 0.71, z / 256 + 0.13) * 0.9 + 0.5) * 255); return v < 0 ? 0 : v > 255 ? 255 : v; };
  const inoise16 = (x, y = 0, z = 0) => { const v = Math.round((_perlin(x / 65536 + 0.37, y / 65536 + 0.71, z / 65536 + 0.13) * 0.9 + 0.5) * 65535); return v < 0 ? 0 : v > 65535 ? 65535 : v; };

  /* ================================ colors ================================ */
  function hsv2rgb_rainbow(h, s, v, out) {
    h &= 255; s &= 255; v &= 255;
    const offset8 = (h & 0x1F) << 3;
    const third = scale8(offset8, 85);
    let r, g, b;
    if (!(h & 0x80)) {
      if (!(h & 0x40)) {
        if (!(h & 0x20)) { r = 255 - third; g = third; b = 0; }
        else { r = 171; g = 85 + third; b = 0; }
      } else if (!(h & 0x20)) { const two = scale8(offset8, 170); r = 171 - two; g = 170 + third; b = 0; }
      else { r = 0; g = 255 - third; b = third; }
    } else if (!(h & 0x40)) {
      if (!(h & 0x20)) { const two = scale8(offset8, 170); r = 0; g = 171 - two; b = 85 + two; }
      else { r = third; g = 0; b = 255 - third; }
    } else if (!(h & 0x20)) { r = 85 + third; g = 0; b = 171 - third; }
    else { r = 170 + third; g = 0; b = 85 - third; }
    if (s !== 255) {
      if (s === 0) { r = g = b = 255; }
      else {
        const desat = 255 - s, floor = scale8_video(desat, desat), sc = 255 - floor;
        r = scale8(r, sc) + floor; g = scale8(g, sc) + floor; b = scale8(b, sc) + floor;
      }
    }
    if (v !== 255) {
      const val = scale8_video(v, v);
      if (val === 0) { r = g = b = 0; } else { r = scale8(r, val); g = scale8(g, val); b = scale8(b, val); }
    }
    out.r = r > 255 ? 255 : r; out.g = g > 255 ? 255 : g; out.b = b > 255 ? 255 : b;
    return out;
  }
  function hsv2rgb_spectrum(h, s, v, out) {
    h = scale8(h & 255, 191); s &= 255; v &= 255;
    const floor = scale8(255 - s, v), amp = v - floor;
    const sect = (h / 64) | 0, off = h & 63;
    const up = Math.floor(off * 4 * amp / 256) + floor, down = Math.floor((255 - off * 4) * amp / 256) + floor;
    if (sect === 0) { out.r = down; out.g = up; out.b = floor; }
    else if (sect === 1) { out.r = floor; out.g = down; out.b = up; }
    else { out.r = up; out.g = floor; out.b = down; }
    return out;
  }

  class CHSV {
    constructor(h, s, v) {
      if (s !== undefined) { this.h = h & 255; this.s = s & 255; this.v = v & 255; }
      else { this.h = 0; this.s = 0; this.v = 0; if (h !== undefined) this.__set(h); }
    }
    __set(o) {
      if (o instanceof CHSV) { this.h = o.h; this.s = o.s; this.v = o.v; }
      else if (Array.isArray(o)) { this.h = o[0] & 255; this.s = o[1] & 255; this.v = o[2] & 255; }
      else if (o instanceof CRGB) this.__set(rgb2hsv_approximate(o));
      else throw new Error('cannot assign that value to a CHSV');
      return this;
    }
    static __from(v) { return new CHSV().__set(v); }
    setHSV(h, s, v) { this.h = h & 255; this.s = s & 255; this.v = v & 255; return this; }
    toString() { return `CHSV(${this.h}, ${this.s}, ${this.v})`; }
  }
  for (const [alias, key] of [['hue', 'h'], ['sat', 's'], ['saturation', 's'], ['val', 'v'], ['value', 'v']]) {
    Object.defineProperty(CHSV.prototype, alias, { get() { return this[key]; }, set(x) { this[key] = x & 255; } });
  }

  class CRGB {
    constructor(r, g, b) {
      if (g !== undefined) { this.r = r & 255; this.g = g & 255; this.b = b & 255; }
      else { this.r = 0; this.g = 0; this.b = 0; if (r !== undefined) this.__set(r); }
    }
    __set(v) {
      if (typeof v === 'number') { this.r = (v >>> 16) & 255; this.g = (v >>> 8) & 255; this.b = v & 255; }
      else if (v instanceof CRGB) { this.r = v.r; this.g = v.g; this.b = v.b; }
      else if (v instanceof CHSV) hsv2rgb_rainbow(v.h, v.s, v.v, this);
      else if (Array.isArray(v)) { this.r = v[0] & 255; this.g = v[1] & 255; this.b = v[2] & 255; }
      else if (typeof v === 'boolean') { this.r = 0; this.g = 0; this.b = v ? 1 : 0; }
      else throw new TypeError(v === undefined ? 'assigned undefined to a CRGB' : 'cannot assign that value to a CRGB');
      return this;
    }
    static __from(v) { return new CRGB().__set(v); }
    valueOf() { return ((this.r << 16) | (this.g << 8) | this.b) >>> 0; }
    toString() { return `CRGB(${this.r}, ${this.g}, ${this.b})`; }
    setRGB(r, g, b) { this.r = r & 255; this.g = g & 255; this.b = b & 255; return this; }
    setHSV(h, s, v) { return hsv2rgb_rainbow(h, s, v, this); }
    setHue(h) { return hsv2rgb_rainbow(h, 255, 255, this); }
    setColorCode(c) { return this.__set(c >>> 0); }
    nscale8(s) {
      if (s instanceof CRGB) { this.r = scale8(this.r, s.r); this.g = scale8(this.g, s.g); this.b = scale8(this.b, s.b); }
      else { this.r = scale8(this.r, s); this.g = scale8(this.g, s); this.b = scale8(this.b, s); }
      return this;
    }
    nscale8_video(s) { this.r = scale8_video(this.r, s); this.g = scale8_video(this.g, s); this.b = scale8_video(this.b, s); return this; }
    scale8(s) { return new CRGB(this.r, this.g, this.b).nscale8(s); }
    fadeToBlackBy(a) { return this.nscale8(255 - (a & 255)); }
    fadeLightBy(a) { return this.nscale8_video(255 - (a & 255)); }
    addToRGB(d) { this.r = qadd8(this.r, d); this.g = qadd8(this.g, d); this.b = qadd8(this.b, d); return this; }
    subtractFromRGB(d) { this.r = qsub8(this.r, d); this.g = qsub8(this.g, d); this.b = qsub8(this.b, d); return this; }
    maximizeBrightness(limit = 255) {
      const m = Math.max(this.r, this.g, this.b);
      if (m > 0) { const f = limit / m; this.r = Math.min(255, Math.round(this.r * f)); this.g = Math.min(255, Math.round(this.g * f)); this.b = Math.min(255, Math.round(this.b * f)); }
      return this;
    }
    getLuma() { return (this.r * 54 + this.g * 183 + this.b * 18) >> 8; }
    getAverageLight() { return Math.floor((this.r + this.g + this.b) / 3); }
    lerp8(o, f) { return new CRGB(lerp8by8(this.r, o.r, f), lerp8by8(this.g, o.g, f), lerp8by8(this.b, o.b, f)); }
    lerp16(o, f) { return this.lerp8(o, f >> 8); }
  }
  for (const [alias, key] of [['red', 'r'], ['green', 'g'], ['blue', 'b'], ['0', 'r'], ['1', 'g'], ['2', 'b']]) {
    Object.defineProperty(CRGB.prototype, alias, { get() { return this[key]; }, set(x) { this[key] = x & 255; } });
  }
  ('AliceBlue:F0F8FF Amethyst:9966CC AntiqueWhite:FAEBD7 Aqua:00FFFF Aquamarine:7FFFD4 Azure:F0FFFF Beige:F5F5DC Bisque:FFE4C4 Black:000000 BlanchedAlmond:FFEBCD ' +
   'Blue:0000FF BlueViolet:8A2BE2 Brown:A52A2A BurlyWood:DEB887 CadetBlue:5F9EA0 Chartreuse:7FFF00 Chocolate:D2691E Coral:FF7F50 CornflowerBlue:6495ED Cornsilk:FFF8DC ' +
   'Crimson:DC143C Cyan:00FFFF DarkBlue:00008B DarkCyan:008B8B DarkGoldenrod:B8860B DarkGray:A9A9A9 DarkGrey:A9A9A9 DarkGreen:006400 DarkKhaki:BDB76B DarkMagenta:8B008B ' +
   'DarkOliveGreen:556B2F DarkOrange:FF8C00 DarkOrchid:9932CC DarkRed:8B0000 DarkSalmon:E9967A DarkSeaGreen:8FBC8F DarkSlateBlue:483D8B DarkSlateGray:2F4F4F DarkSlateGrey:2F4F4F ' +
   'DarkTurquoise:00CED1 DarkViolet:9400D3 DeepPink:FF1493 DeepSkyBlue:00BFFF DimGray:696969 DimGrey:696969 DodgerBlue:1E90FF FireBrick:B22222 FloralWhite:FFFAF0 ForestGreen:228B22 ' +
   'Fuchsia:FF00FF Gainsboro:DCDCDC GhostWhite:F8F8FF Gold:FFD700 Goldenrod:DAA520 Gray:808080 Grey:808080 Green:008000 GreenYellow:ADFF2F Honeydew:F0FFF0 HotPink:FF69B4 ' +
   'IndianRed:CD5C5C Indigo:4B0082 Ivory:FFFFF0 Khaki:F0E68C Lavender:E6E6FA LavenderBlush:FFF0F5 LawnGreen:7CFC00 LemonChiffon:FFFACD LightBlue:ADD8E6 LightCoral:F08080 ' +
   'LightCyan:E0FFFF LightGoldenrodYellow:FAFAD2 LightGreen:90EE90 LightGrey:D3D3D3 LightPink:FFB6C1 LightSalmon:FFA07A LightSeaGreen:20B2AA LightSkyBlue:87CEFA ' +
   'LightSlateGray:778899 LightSlateGrey:778899 LightSteelBlue:B0C4DE LightYellow:FFFFE0 Lime:00FF00 LimeGreen:32CD32 Linen:FAF0E6 Magenta:FF00FF Maroon:800000 ' +
   'MediumAquamarine:66CDAA MediumBlue:0000CD MediumOrchid:BA55D3 MediumPurple:9370DB MediumSeaGreen:3CB371 MediumSlateBlue:7B68EE MediumSpringGreen:00FA9A MediumTurquoise:48D1CC ' +
   'MediumVioletRed:C71585 MidnightBlue:191970 MintCream:F5FFFA MistyRose:FFE4E1 Moccasin:FFE4B5 NavajoWhite:FFDEAD Navy:000080 OldLace:FDF5E6 Olive:808000 OliveDrab:6B8E23 ' +
   'Orange:FFA500 OrangeRed:FF4500 Orchid:DA70D6 PaleGoldenrod:EEE8AA PaleGreen:98FB98 PaleTurquoise:AFEEEE PaleVioletRed:DB7093 PapayaWhip:FFEFD5 PeachPuff:FFDAB9 Peru:CD853F ' +
   'Pink:FFC0CB Plaid:CC5533 Plum:DDA0DD PowderBlue:B0E0E6 Purple:800080 Red:FF0000 RosyBrown:BC8F8F RoyalBlue:4169E1 SaddleBrown:8B4513 Salmon:FA8072 SandyBrown:F4A460 ' +
   'SeaGreen:2E8B57 Seashell:FFF5EE Sienna:A0522D Silver:C0C0C0 SkyBlue:87CEEB SlateBlue:6A5ACD SlateGray:708090 SlateGrey:708090 Snow:FFFAFA SpringGreen:00FF7F SteelBlue:4682B4 ' +
   'Tan:D2B48C Teal:008080 Thistle:D8BFD8 Tomato:FF6347 Turquoise:40E0D0 Violet:EE82EE Wheat:F5DEB3 White:FFFFFF WhiteSmoke:F5F5F5 Yellow:FFFF00 YellowGreen:9ACD32 ' +
   'FairyLight:FFE42D FairyLightNCC:FF9D2A').split(' ').forEach(e => { const [n, h] = e.split(':'); CRGB[n] = new CRGB(parseInt(h, 16)); });

  function rgb2hsv_approximate(c) {
    const r = c.r, g = c.g, b = c.b, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) { if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; }
    return new CHSV(Math.round(h * 256 / 6) & 255, mx ? Math.round(d * 255 / mx) : 0, mx);
  }

  const _isColor = v => v instanceof CRGB || v instanceof CHSV;
  const _rgb = v => v instanceof CRGB ? v : CRGB.__from(v);
  function _prim(op, a, b) {
    switch (op) {
      case '+': return a + b; case '-': return a - b; case '*': return a * b;
      case '/': return (Number.isInteger(a) && Number.isInteger(b)) ? __idiv(a, b) : a / b;
      case '%': return (Number.isInteger(a) && Number.isInteger(b)) ? __imod(a, b) : a % b;
      case '&': return a & b; case '|': return a | b; case '^': return a ^ b; case '<<': return a << b; case '>>': return a >> b;
      case '==': return a == b; case '!=': return a != b; case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
    }
    throw new Error(`unsupported operator ${op}`);
  }
  function __bin(op, a, b) {
    const ac = _isColor(a), bc = _isColor(b);
    if (!ac && !bc) {
      if (typeof a === 'string' || typeof b === 'string') return op === '+' ? String(a) + String(b) : _prim(op, a, b);
      if ((a !== null && typeof a === 'object') || (b !== null && typeof b === 'object')) {
        if (op === '==') return a === b;
        if (op === '!=') return a !== b;
      }
      return _prim(op, a, b);
    }
    if (op === '==' || op === '!=') {
      let eq;
      if (a instanceof CHSV && b instanceof CHSV) eq = a.h === b.h && a.s === b.s && a.v === b.v;
      else { const x = _rgb(a), y = _rgb(b); eq = x.r === y.r && x.g === y.g && x.b === y.b; }
      return op === '==' ? eq : !eq;
    }
    if (op === '<' || op === '>' || op === '<=' || op === '>=') { const x = _rgb(a), y = _rgb(b); return _prim(op, x.r + x.g + x.b, y.r + y.g + y.b); }
    if ((ac && bc) || op === '+' || op === '-') {
      const x = _rgb(a), y = _rgb(b);
      switch (op) {
        case '+': return new CRGB(qadd8(x.r, y.r), qadd8(x.g, y.g), qadd8(x.b, y.b));
        case '-': return new CRGB(qsub8(x.r, y.r), qsub8(x.g, y.g), qsub8(x.b, y.b));
        case '|': return new CRGB(Math.max(x.r, y.r), Math.max(x.g, y.g), Math.max(x.b, y.b));
        case '&': return new CRGB(Math.min(x.r, y.r), Math.min(x.g, y.g), Math.min(x.b, y.b));
      }
      throw new Error(`operator ${op} is not defined between two colors`);
    }
    const c = _rgb(ac ? a : b), d = +(ac ? b : a);
    switch (op) {
      case '*': return new CRGB(qmul8(c.r, d), qmul8(c.g, d), qmul8(c.b, d));
      case '/': return new CRGB(Math.trunc(c.r / d), Math.trunc(c.g / d), Math.trunc(c.b / d));
      case '%': return new CRGB(c.r, c.g, c.b).nscale8_video(d);
      case '|': return new CRGB(Math.max(c.r, d), Math.max(c.g, d), Math.max(c.b, d));
      case '&': return new CRGB(Math.min(c.r, d), Math.min(c.g, d), Math.min(c.b, d));
      case '>>': return new CRGB(c.r >> d, c.g >> d, c.b >> d);
    }
    throw new Error(`operator ${op} is not defined for a color and a number`);
  }
  function __cas(op, t, v) {
    if (Array.isArray(t)) { for (const e of t) __cas(op, e, v); return t; }
    if (t && t.__set) return t.__set(__bin(op, t, v));
    throw new TypeError(t === undefined ? 'compound assignment to undefined' : 'compound assignment on an unsupported value');
  }
  function __un(op, x) { if (x instanceof CRGB) return new CRGB(255 - x.r, 255 - x.g, 255 - x.b); return -x; }
  function __truthy(x) { if (x instanceof CRGB) return !!(x.r | x.g | x.b); return !!x; }
  let _divWarned = false;
  function _divZero() { if (!_divWarned) { _divWarned = true; warn('Integer division by zero — a real ESP32 would crash and reboot here.'); } return 0; }
  function __idiv(a, b) { return b === 0 ? _divZero() : Math.trunc(a / b); }
  function __imod(a, b) { return b === 0 ? _divZero() : a % b; }
  function __deref(v) { return (Array.isArray(v) || ArrayBuffer.isView(v)) ? v[0] : v; }
  function __padd(a, k) {
    k |= 0;
    if (k === 0 || a == null) return a;
    if (ArrayBuffer.isView(a)) return a.subarray(k);
    if (Array.isArray(a)) return a.slice(k);
    return a;
  }
  function __ta(TA, n, items) { const t = new TA(n); t.set(items.slice(0, n)); return t; }
  function __init(C, v) { return typeof C.__from === 'function' ? C.__from(v) : v; }
  function __carr(C, n, items) {
    const a = C === CRGB ? new CRGBSet() : [];
    for (let i = 0; i < n; i++) a.push(items && i < items.length ? __init(C, items[i]) : new C());
    return a;
  }
  function __fcopy(dst, src) {
    if (dst && typeof dst.__set === 'function') return dst.__set(src);
    if (ArrayBuffer.isView(dst) && src && src.length !== undefined) { dst.set(Array.from(src).slice(0, dst.length)); return dst; }
    if (Array.isArray(dst) && Array.isArray(src)) { for (let i = 0; i < dst.length && i < src.length; i++) dst[i] = __fcopy(dst[i], src[i]); return dst; }
    return src;
  }
  function __agg(obj, fields, args) { for (let i = 0; i < args.length && i < fields.length; i++) obj[fields[i]] = __fcopy(obj[fields[i]], args[i]); }
  function __construct(obj, C, a) {
    const m = C.prototype['__c' + a.length];
    if (m) m.apply(obj, a);
    else if (a.length) __agg(obj, C.__fields, a);
  }
  function __sizeof(x, hint) {
    if (typeof x === 'string') return x.length + 1;
    if (x && x.length !== undefined) return x.length * (hint || x.BYTES_PER_ELEMENT || 4);
    return hint || 4;
  }
  const _everyT = [];
  function __every(id, ms) {
    const t = millis(), last = _everyT[id];
    if (last === undefined) { _everyT[id] = t; return false; }
    if (t - last >= ms) { _everyT[id] = t; return true; }
    return false;
  }

  class CRGBSet extends Array {
    __set(v) {
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') { for (let i = 0; i < this.length && i < v.length; i++) this[i].__set(v[i]); }
      else for (let i = 0; i < this.length; i++) this[i].__set(v);
      return this;
    }
    size() { return this.length; }
    fill_solid(c) { fill_solid(this, this.length, c); return this; }
    fill_rainbow(h, d = 5) { fill_rainbow(this, this.length, h, d); return this; }
    fill_gradient_RGB(a, b) { fill_gradient_RGB(this, 0, a, this.length - 1, b); return this; }
    fadeToBlackBy(a) { fadeToBlackBy(this, this.length, a); return this; }
    fadeLightBy(a) { fadeLightBy(this, this.length, a); return this; }
    nscale8(s) { nscale8(this, this.length, s); return this; }
    nscale8_video(s) { nscale8_video(this, this.length, s); return this; }
    blur1d(a) { blur1d(this, this.length, a); return this; }
    addToRGB(d) { for (const c of this) c.addToRGB(d); return this; }
    subtractFromRGB(d) { for (const c of this) c.subtractFromRGB(d); return this; }
  }
  function __sub(arr, a, b) {
    const out = new CRGBSet();
    if (a <= b) { for (let i = a; i <= b; i++) if (arr[i]) out.push(arr[i]); }
    else for (let i = a; i >= b; i--) if (arr[i]) out.push(arr[i]);
    return out;
  }

  function _px(leds, i, what) {
    const c = leds[i];
    if (c === undefined) throw new TypeError(`${what}: index ${i} is past the end of the LED array (length ${leds.length})`);
    return c;
  }
  function fill_solid(leds, n, color) { color = CRGB.__from(color); for (let i = 0; i < n; i++) _px(leds, i, 'fill_solid').__set(color); }
  function fill_rainbow(leds, n, hue, delta = 5) { hue &= 255; for (let i = 0; i < n; i++) { hsv2rgb_rainbow(hue, 240, 255, _px(leds, i, 'fill_rainbow')); hue = (hue + delta) & 255; } }
  function fill_rainbow_circular(leds, n, hue, reversed) { const d = 65535 / n; let h16 = (hue & 255) << 8; for (let i = 0; i < n; i++) { hsv2rgb_rainbow(h16 >> 8, 240, 255, _px(leds, i, 'fill_rainbow_circular')); h16 = (h16 + (reversed ? -d : d)) & 65535; } }
  function _gradRGB(leds, sp, sc, ep, ec) {
    if (ep < sp) { let t = ep; ep = sp; sp = t; t = ec; ec = sc; sc = t; }
    const d = ep - sp || 1;
    for (let i = sp; i <= ep; i++) {
      const f = (i - sp) / d, c = leds[i];
      if (!c) continue;
      c.r = Math.round(sc.r + (ec.r - sc.r) * f); c.g = Math.round(sc.g + (ec.g - sc.g) * f); c.b = Math.round(sc.b + (ec.b - sc.b) * f);
    }
  }
  function fill_gradient_RGB(leds, a, b, c, d, e) {
    if (_isColor(b) || typeof c !== 'number') { // (leds, n, c1, c2 [, c3 [, c4]])
      const n = a, cols = [b, c, d, e].filter(x => x !== undefined).map(_rgb), last = n - 1;
      if (cols.length === 2) _gradRGB(leds, 0, cols[0], last, cols[1]);
      else if (cols.length === 3) { const h = last >> 1; _gradRGB(leds, 0, cols[0], h, cols[1]); _gradRGB(leds, h, cols[1], last, cols[2]); }
      else { const o = Math.floor(last / 3), t = Math.floor(last * 2 / 3); _gradRGB(leds, 0, cols[0], o, cols[1]); _gradRGB(leds, o, cols[1], t, cols[2]); _gradRGB(leds, t, cols[2], last, cols[3]); }
    } else _gradRGB(leds, a, _rgb(b), c, _rgb(d));
  }
  function _gradHSV(leds, sp, sc, ep, ec, dir) {
    if (ep < sp) { let t = ep; ep = sp; sp = t; t = ec; ec = sc; sc = t; }
    const d = ep - sp || 1;
    let dh = ((ec.h - sc.h) & 255);
    if (dir === BACKWARD_HUES) dh -= 256;
    else if (dir === LONGEST_HUES) { if (dh < 128) dh -= 256; }
    else if (dir !== FORWARD_HUES && dh > 127) dh -= 256;
    for (let i = sp; i <= ep; i++) {
      const f = (i - sp) / d;
      if (leds[i]) hsv2rgb_rainbow(Math.round(sc.h + dh * f) & 255, Math.round(sc.s + (ec.s - sc.s) * f), Math.round(sc.v + (ec.v - sc.v) * f), leds[i]);
    }
  }
  function fill_gradient(leds, a, b, c, d, e) {
    const hsv = x => x instanceof CHSV ? x : rgb2hsv_approximate(_rgb(x));
    if (typeof c === 'number') return _gradHSV(leds, a, hsv(b), c, hsv(d), e); // (leds, start, c1, end, c2, dir)
    const n = a, last = n - 1;
    if (d === undefined || typeof d === 'number') return _gradHSV(leds, 0, hsv(b), last, hsv(c), d);
    const h = last >> 1;
    _gradHSV(leds, 0, hsv(b), h, hsv(c)); _gradHSV(leds, h, hsv(c), last, hsv(d));
  }
  function nscale8(leds, n, s) { for (let i = 0; i < n; i++) _px(leds, i, 'nscale8').nscale8(s); }
  function nscale8_video(leds, n, s) { for (let i = 0; i < n; i++) _px(leds, i, 'nscale8_video').nscale8_video(s); }
  function fadeToBlackBy(leds, n, a) { nscale8(leds, n, 255 - (a & 255)); }
  function fadeLightBy(leds, n, a) { nscale8_video(leds, n, 255 - (a & 255)); }
  const fade_raw = fadeToBlackBy, fade_video = fadeLightBy;
  function fadeUsingColor(leds, n, c) { c = _rgb(c); for (let i = 0; i < n; i++) _px(leds, i, 'fadeUsingColor').nscale8(c); }
  function blur1d(leds, n, amount) {
    const keep = 255 - (amount & 255), seep = (amount & 255) >> 1;
    let cr = 0, cg = 0, cb = 0;
    for (let i = 0; i < n; i++) {
      const c = _px(leds, i, 'blur1d');
      const pr = scale8(c.r, seep), pg = scale8(c.g, seep), pb = scale8(c.b, seep);
      c.r = qadd8(scale8(c.r, keep), cr); c.g = qadd8(scale8(c.g, keep), cg); c.b = qadd8(scale8(c.b, keep), cb);
      if (i) { const p = leds[i - 1]; p.r = qadd8(p.r, pr); p.g = qadd8(p.g, pg); p.b = qadd8(p.b, pb); }
      cr = pr; cg = pg; cb = pb;
    }
  }
  function nblend(a, b, c, d) {
    if (Array.isArray(a)) { for (let i = 0; i < c; i++) nblend(a[i], b[i], d); return a; }
    const o = _rgb(b), amt = c & 255;
    if (amt === 0) return a;
    if (amt === 255) return a.__set(o);
    a.r = blend8(a.r, o.r, amt); a.g = blend8(a.g, o.g, amt); a.b = blend8(a.b, o.b, amt);
    return a;
  }
  function blend(a, b, c, d, e) {
    if (Array.isArray(a)) { for (let i = 0; i < d; i++) c[i].__set(blend(a[i], b[i], e)); return c; }
    return nblend(CRGB.__from(a), b, c);
  }
  function HeatColor(t) {
    const t192 = scale8_video(t, 191), ramp = (t192 & 0x3F) << 2;
    if (t192 & 0x80) return new CRGB(255, 255, ramp);
    if (t192 & 0x40) return new CRGB(255, ramp, 0);
    return new CRGB(ramp, 0, 0);
  }
  const napplyGamma_video = (c, g) => { c.r = Math.round(Math.pow(c.r / 255, g) * 255); c.g = Math.round(Math.pow(c.g / 255, g) * 255); c.b = Math.round(Math.pow(c.b / 255, g) * 255); return c; };
  const applyGamma_video = (c, g) => typeof c === 'number' ? Math.round(Math.pow(c / 255, g) * 255) : napplyGamma_video(CRGB.__from(c), g);

  /* ---- palettes ---- */
  class GradientPalette { constructor(bytes) { this.bytes = bytes; } }
  const __gradpal = list => new GradientPalette(Uint8Array.from(list));
  class CRGBPalette16 {
    constructor(...a) {
      for (let i = 0; i < 16; i++) this[i] = new CRGB();
      if (a.length) this.__load(a);
    }
    __load(a) {
      if (a.length === 1) {
        const v = a[0];
        if (v instanceof CRGBPalette16) { for (let i = 0; i < 16; i++) this[i].__set(v[i]); return; }
        if (v instanceof GradientPalette) {
          const b = v.bytes, stops = [];
          for (let i = 0; i + 3 < b.length; i += 4) stops.push([b[i], b[i + 1], b[i + 2], b[i + 3]]);
          if (!stops.length) return;
          for (let i = 0; i < 16; i++) {
            const p = i * 255 / 15;
            let k = 0;
            while (k < stops.length - 2 && p > stops[k + 1][0]) k++;
            const s = stops[k], e = stops[Math.min(k + 1, stops.length - 1)];
            const f = e[0] === s[0] ? 0 : Math.max(0, Math.min(1, (p - s[0]) / (e[0] - s[0])));
            this[i].setRGB(Math.round(s[1] + (e[1] - s[1]) * f), Math.round(s[2] + (e[2] - s[2]) * f), Math.round(s[3] + (e[3] - s[3]) * f));
          }
          return;
        }
        if (Array.isArray(v) || ArrayBuffer.isView(v)) {
          if (v.length >= 16) { for (let i = 0; i < 16; i++) this[i].__set(v[i]); } else this.__load(Array.from(v));
          return;
        }
        for (let i = 0; i < 16; i++) this[i].__set(v);
        return;
      }
      if (a.length >= 16) { for (let i = 0; i < 16; i++) this[i].__set(a[i]); return; }
      const c = a.map(x => CRGB.__from(x));
      if (c.length === 2) _gradRGB(this, 0, c[0], 15, c[1]);
      else if (c.length === 3) { _gradRGB(this, 0, c[0], 7, c[1]); _gradRGB(this, 8, c[1], 15, c[2]); }
      else { _gradRGB(this, 0, c[0], 5, c[1]); _gradRGB(this, 5, c[1], 10, c[2]); _gradRGB(this, 10, c[2], 15, c[3]); }
    }
    __set(v) { this.__load([v]); return this; }
    static __from(v) { return (Array.isArray(v) && v.length < 16) ? new CRGBPalette16(...v) : new CRGBPalette16(v); }
  }
  const _hexPal = s => new CRGBPalette16(s.split(' ').map(h => parseInt(h, 16)));
  const _namePal = s => new CRGBPalette16(s.split(' ').map(n => CRGB[n]));
  const RainbowColors_p = _hexPal('FF0000 D52A00 AB5500 AB7F00 ABAB00 56D500 00FF00 00D52A 00AB55 0056AA 0000FF 2A00D5 5500AB 7F0081 AB0055 D5002B');
  const RainbowStripeColors_p = _hexPal('FF0000 000000 AB5500 000000 ABAB00 000000 00FF00 000000 00AB55 000000 0000FF 000000 5500AB 000000 AB0055 000000');
  const PartyColors_p = _hexPal('5500AB 84007C B5004B E5001B E81700 B84700 AB7700 ABAB00 AB5500 DD2200 F2000E C2003E 8F0071 5F00A1 2F00D0 0007F9');
  const HeatColors_p = _hexPal('000000 330000 660000 990000 CC0000 FF0000 FF3300 FF6600 FF9900 FFCC00 FFFF00 FFFF33 FFFF66 FFFF99 FFFFCC FFFFFF');
  const CloudColors_p = _namePal('Blue DarkBlue DarkBlue DarkBlue DarkBlue DarkBlue DarkBlue DarkBlue Blue DarkBlue SkyBlue SkyBlue LightBlue White LightBlue SkyBlue');
  const LavaColors_p = _namePal('Black Maroon Black Maroon DarkRed Maroon DarkRed DarkRed DarkRed DarkRed Red Orange White Orange Red DarkRed');
  const OceanColors_p = _namePal('MidnightBlue DarkBlue MidnightBlue Navy DarkBlue MediumBlue SeaGreen Teal CadetBlue Blue DarkCyan CornflowerBlue Aquamarine SeaGreen Aqua LightSkyBlue');
  const ForestColors_p = _namePal('DarkGreen DarkGreen DarkOliveGreen DarkGreen Green ForestGreen OliveDrab Green SeaGreen MediumAquamarine LimeGreen YellowGreen LightGreen LawnGreen MediumAquamarine ForestGreen');
  const _palCache = new WeakMap();
  function _pal(p) {
    if (p instanceof CRGBPalette16) return p;
    if (p && typeof p === 'object') { let c = _palCache.get(p); if (!c) { c = new CRGBPalette16(p); _palCache.set(p, c); } return c; }
    throw new TypeError('ColorFromPalette: not a palette');
  }
  function ColorFromPalette(pal, index, brightness = 255, blendType = 1) {
    pal = _pal(pal); index &= 255; brightness &= 255;
    const hi4 = index >> 4, lo4 = index & 15, e = pal[hi4];
    let r = e.r, g = e.g, b = e.b;
    if (blendType && lo4) {
      const nx = pal[(hi4 + 1) & 15], f2 = lo4 << 4, f1 = 255 - f2;
      r = scale8(r, f1) + scale8(nx.r, f2); g = scale8(g, f1) + scale8(nx.g, f2); b = scale8(b, f1) + scale8(nx.b, f2);
    }
    if (brightness !== 255) { r = scale8_video(r, brightness); g = scale8_video(g, brightness); b = scale8_video(b, brightness); }
    return new CRGB(r, g, b);
  }
  function fill_palette(leds, n, startIndex, incIndex, pal, brightness = 255, blendType = 1) {
    let idx = startIndex;
    for (let i = 0; i < n; i++) { _px(leds, i, 'fill_palette').__set(ColorFromPalette(pal, idx, brightness, blendType)); idx += incIndex; }
  }
  function nblendPaletteTowardPalette(cur, target, maxChanges = 24) {
    let changes = 0;
    for (let i = 0; i < 16; i++) for (const ch of ['r', 'g', 'b']) {
      const c = cur[i], t = target[i];
      if (c[ch] === t[ch]) continue;
      if (c[ch] < t[ch]) c[ch]++; else { c[ch]--; if (c[ch] > t[ch]) c[ch]--; }
      if (++changes >= maxChanges) return;
    }
  }
  const LINEARBLEND = 1, NOBLEND = 0, LINEARBLEND_NOWRAP = 2;
  const FORWARD_HUES = 0, BACKWARD_HUES = 1, SHORTEST_HUES = 2, LONGEST_HUES = 3;
  const HUE_RED = 0, HUE_ORANGE = 32, HUE_YELLOW = 64, HUE_GREEN = 96, HUE_AQUA = 128, HUE_BLUE = 160, HUE_PURPLE = 192, HUE_PINK = 224;
  const RGB = 0o012, RBG = 0o021, GRB = 0o102, GBR = 0o120, BRG = 0o201, BGR = 0o210;
  const TypicalSMD5050 = 0xFFB0F0, TypicalLEDStrip = 0xFFB0F0, Typical8mmPixel = 0xFFE08C, TypicalPixelString = 0xFFE08C, UncorrectedColor = 0xFFFFFF;
  const Candle = 0xFF9329, Tungsten40W = 0xFFC58F, Tungsten100W = 0xFFD6AA, Halogen = 0xFFF1E0, CarbonArc = 0xFFFAF4, HighNoonSun = 0xFFFFFB, DirectSunlight = 0xFFFFFF,
    OvercastSky = 0xC9E2FF, ClearBlueSky = 0x409CFF, WarmFluorescent = 0xFFF4E5, StandardFluorescent = 0xF4FFFA, CoolWhiteFluorescent = 0xD4EBFF, UncorrectedTemperature = 0xFFFFFF;
  const DISABLE_DITHER = 0, BINARY_DITHER = 1;

  /* ---- FastLED controller ---- */
  class CLEDController {
    constructor(arr, off, n, strip) { this._arr = arr; this._off = off; this._n = n; this._strip = strip; }
    _render(bri) {
      const s = this._strip.shown, a = this._arr, k = bri + 1;
      for (let i = 0; i < this._n; i++) {
        const c = a[this._off + i], o = i * 3;
        if (!c) { warn('addLeds() was given more LEDs than the array holds.'); s[o] = s[o + 1] = s[o + 2] = 0; continue; }
        s[o] = (c.r * k) >> 8; s[o + 1] = (c.g * k) >> 8; s[o + 2] = (c.b * k) >> 8;
      }
    }
    _mA() { const s = this._strip.shown; let t = 0; for (let i = 0; i < s.length; i++) t += s[i]; return t / 255 * 20 + this._n; }
    setCorrection() { return this; } setTemperature() { return this; } setDither() { return this; }
    size() { return this._n; } leds() { return this._arr; }
    clearLedData() { for (let i = 0; i < this._n; i++) this._arr[this._off + i].__set(0); return this; }
    showLeds(b = 255) { this._render(b & 255); return present(); }
    showColor(c, b = 255) { const col = _rgb(c), s = this._strip.shown, k = (b & 255) + 1; for (let i = 0; i < this._n; i++) { s[i * 3] = (col.r * k) >> 8; s[i * 3 + 1] = (col.g * k) >> 8; s[i * 3 + 2] = (col.b * k) >> 8; } return present(); }
  }
  class CFastLED {
    constructor() { this._ctl = []; this._bri = 255; this._maxmA = 0; }
    addLeds(tpl, arr, a, b) {
      if (!Array.isArray(tpl) || typeof tpl[0] !== 'string') { b = a; a = arr; arr = tpl; tpl = ['LED', '?']; }
      if (!Array.isArray(arr)) throw new TypeError('FastLED.addLeds: the first argument must be a CRGB array');
      let off = 0, n = a;
      if (b !== undefined) { off = a | 0; n = b; }
      n |= 0;
      const c = new CLEDController(arr, off, n, registerStrip(n, `${tpl[0]} · GPIO ${tpl[1]}`));
      this._ctl.push(c);
      return c;
    }
    _renderAll(bri) {
      for (const c of this._ctl) c._render(bri);
      if (this._maxmA > 0) {
        let est = 0;
        for (const c of this._ctl) est += c._mA();
        if (est > this._maxmA) { const b2 = Math.floor(bri * this._maxmA / est); for (const c of this._ctl) c._render(b2); }
      }
    }
    show(scale) { if (!this._ctl.length) warn('FastLED.show() was called before FastLED.addLeds().'); this._renderAll(scale === undefined ? this._bri : scale & 255); return present(); }
    delay(ms) { const p = this.show(); return p ? p.then(() => advance(Math.max(0, +ms || 0))) : advance(Math.max(0, +ms || 0)); }
    showColor(c, scale) {
      const col = _rgb(c), k = (scale === undefined ? this._bri : scale & 255) + 1;
      for (const ctl of this._ctl) { const s = ctl._strip.shown; for (let i = 0; i < ctl._n; i++) { s[i * 3] = (col.r * k) >> 8; s[i * 3 + 1] = (col.g * k) >> 8; s[i * 3 + 2] = (col.b * k) >> 8; } }
      return present();
    }
    clearData() { for (const c of this._ctl) c.clearLedData(); }
    clear(write) { this.clearData(); if (write) return this.show(); }
    setBrightness(b) { this._bri = b & 255; }
    getBrightness() { return this._bri; }
    setMaxPowerInVoltsAndMilliamps(v, ma) { this._maxmA = ma * v / 5; }
    setMaxPowerInMilliWatts(mw) { this._maxmA = mw / 5; }
    setCorrection() { return this; } setTemperature() { return this; } setDither() { return this; } setMaxRefreshRate() { return this; }
    countFPS() {} getFPS() { return fpsVal; }
    size() { return this._ctl.reduce((t, c) => t + c._n, 0); }
    count() { return this._ctl.length; }
    leds() { return this._ctl.length ? this._ctl[0]._arr : null; }
  }
  const FastLED = new CFastLED(), LEDS = FastLED;

  /* ---- Adafruit_NeoPixel ---- */
  const NEO_RGB = 0x06, NEO_RBG = 0x09, NEO_GRB = 0x52, NEO_GBR = 0xA1, NEO_BRG = 0x58, NEO_BGR = 0xA4;
  const NEO_WRGB = 0x1B, NEO_WGRB = 0x4E, NEO_RGBW = 0xC6, NEO_GRBW = 0xD2, NEO_BRGW = 0xD8, NEO_KHZ800 = 0x0000, NEO_KHZ400 = 0x0100;
  const _gamma8 = new Uint8Array(256);
  for (let i = 0; i < 256; i++) _gamma8[i] = Math.round(Math.pow(i / 255, 2.6) * 255);
  class Adafruit_NeoPixel {
    constructor(n = 0, pin = -1, type = NEO_GRB + NEO_KHZ800) {
      this._n = Math.max(0, n | 0); this._pin = pin; this._type = type;
      this._px = new Uint32Array(this._n); this._bri = 255; this._strip = null;
    }
    get _hasW() { return ((this._type >> 6) & 3) !== ((this._type >> 4) & 3); }
    begin() { if (!this._strip) this._strip = registerStrip(this._n, `NeoPixel · GPIO ${this._pin}`); }
    updateLength(n) { if (this._strip) { warn('updateLength() after begin() is not supported by the simulator.'); return; } this._n = n | 0; this._px = new Uint32Array(this._n); }
    updateType(t) { this._type = t; }
    setPin(p) { this._pin = p; }
    getPin() { return this._pin; }
    numPixels() { return this._n; }
    canShow() { return true; }
    setBrightness(b) { this._bri = b & 255; }
    getBrightness() { return this._bri; }
    setPixelColor(i, r, g, b, w) {
      if (!(i >= 0 && i < this._n)) return;
      this._px[i | 0] = g === undefined ? (+r >>> 0) : ((((w || 0) & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0;
    }
    getPixelColor(i) { return (i >= 0 && i < this._n) ? this._px[i | 0] : 0; }
    fill(c = 0, first = 0, count = 0) {
      const end = count ? Math.min(this._n, first + count) : this._n;
      for (let i = first; i < end; i++) this._px[i] = +c >>> 0;
    }
    clear() { this._px.fill(0); }
    rainbow(firstHue = 0, reps = 1, sat = 255, bri = 255, gammify = true) {
      for (let i = 0; i < this._n; i++) {
        const c = Adafruit_NeoPixel.ColorHSV((firstHue + Math.floor(i * reps * 65536 / this._n)) & 65535, sat, bri);
        this._px[i] = gammify ? Adafruit_NeoPixel.gamma32(c) : c;
      }
    }
    show() {
      if (!this._strip) this.begin();
      const s = this._strip.shown, k = this._bri + 1, hasW = this._hasW;
      for (let i = 0; i < this._n; i++) {
        const c = this._px[i];
        let r = (c >>> 16) & 255, g = (c >>> 8) & 255, b = c & 255;
        if (hasW) { const w = c >>> 24; if (w) { r = Math.min(255, r + w); g = Math.min(255, g + ((w * 220) >> 8)); b = Math.min(255, b + ((w * 170) >> 8)); } }
        s[i * 3] = (r * k) >> 8; s[i * 3 + 1] = (g * k) >> 8; s[i * 3 + 2] = (b * k) >> 8;
      }
      return present();
    }
    static Color(r, g, b, w = 0) { return (((w & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0; }
    static ColorHSV(hue, sat = 255, val = 255) {
      let r, g, b;
      hue = Math.floor(((hue & 65535) * 1530 + 32768) / 65536);
      if (hue < 510) { b = 0; if (hue < 255) { r = 255; g = hue; } else { r = 510 - hue; g = 255; } }
      else if (hue < 1020) { r = 0; if (hue < 765) { g = 255; b = hue - 510; } else { g = 1020 - hue; b = 255; } }
      else if (hue < 1530) { g = 0; if (hue < 1275) { r = hue - 1020; b = 255; } else { r = 255; b = 1530 - hue; } }
      else { r = 255; g = b = 0; }
      const v1 = 1 + (val & 255), s1 = 1 + (sat & 255), s2 = 255 - (sat & 255);
      return ((((((r * s1) >> 8) + s2) * v1) & 0xff00) << 8 | (((((g * s1) >> 8) + s2) * v1) & 0xff00) | (((((b * s1) >> 8) + s2) * v1) >> 8)) >>> 0;
    }
    static gamma8(x) { return _gamma8[x & 255]; }
    static gamma32(c) { return ((_gamma8[c >>> 24] << 24) | (_gamma8[(c >>> 16) & 255] << 16) | (_gamma8[(c >>> 8) & 255] << 8) | _gamma8[c & 255]) >>> 0; }
    static sine8(x) { return sin8(x); }
  }
  for (const m of ['Color', 'ColorHSV', 'gamma8', 'gamma32', 'sine8']) Adafruit_NeoPixel.prototype[m] = Adafruit_NeoPixel[m];

  /* ============================ Arduino core ============================ */
  const HIGH = 1, LOW = 0, INPUT = 1, OUTPUT = 3, INPUT_PULLUP = 5, INPUT_PULLDOWN = 9, LED_BUILTIN = 2;
  const DEC = 10, HEX = 16, OCT = 8, BIN = 2, RISING = 1, FALLING = 2, CHANGE = 3;
  const PI = Math.PI, TWO_PI = Math.PI * 2, HALF_PI = Math.PI / 2, M_PI = Math.PI, DEG_TO_RAD = Math.PI / 180, RAD_TO_DEG = 180 / Math.PI, EULER = Math.E;
  const A0 = 36, A3 = 39, A4 = 32, A5 = 33, A6 = 34, A7 = 35;
  const { sin, cos, tan, asin, acos, atan, atan2, sqrt, pow, exp, log, log10, log2, floor, ceil, round, hypot } = Math;
  const fabs = Math.abs, sinf = sin, cosf = cos, tanf = tan, sqrtf = sqrt, powf = pow, fabsf = Math.abs, floorf = floor, ceilf = ceil, roundf = round, expf = exp, logf = log, atan2f = atan2;
  const fmod = (a, b) => a % b, fmodf = fmod;
  const isnan = Number.isNaN, isinf = x => !Number.isFinite(x) && !Number.isNaN(x);
  const min = (a, b) => a < b ? a : b, max = (a, b) => a > b ? a : b;
  const abs = x => x < 0 ? -x : x, sq = x => x * x;
  const constrain = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;
  const radians = d => d * DEG_TO_RAD, degrees = r => r * RAD_TO_DEG;
  function map(x, a, b, c, d) { if (b === a) { _divZero(); return c; } return Math.trunc((x - a) * (d - c) / (b - a)) + c; }
  const lowByte = x => x & 255, highByte = x => (x >> 8) & 255;
  const bitRead = (v, b) => (v >> b) & 1, bit = b => (1 << b) >>> 0;
  const bitSet = (v, b) => v | (1 << b), bitClear = (v, b) => v & ~(1 << b), bitWrite = (v, b, x) => x ? v | (1 << b) : v & ~(1 << b);
  let _rng = null;
  function _rnd() {
    if (_rng === null) return Math.random();
    _rng = (_rng + 0x6D2B79F5) | 0;
    let t = Math.imul(_rng ^ (_rng >>> 15), 1 | _rng);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function random(a, b) {
    if (a === undefined) return Math.floor(_rnd() * 2147483648);
    if (b === undefined) { b = a; a = 0; }
    a = Math.trunc(a); b = Math.trunc(b);
    return b <= a ? a : a + Math.floor(_rnd() * (b - a));
  }
  const randomSeed = s => { _rng = s | 0; };
  const esp_random = () => Math.floor(Math.random() * 4294967296);
  const ESP = { getFreeHeap: () => 262144, getHeapSize: () => 327680, getCpuFreqMHz: () => 240, getChipModel: () => 'ESP32-SIM', getSdkVersion: () => 'sim', restart() { throw new Error('ESP.restart() was called'); } };

  function memset(dst, v, bytes) {
    if (ArrayBuffer.isView(dst)) dst.fill(v, 0, Math.min(dst.length, Math.floor(bytes / dst.BYTES_PER_ELEMENT)));
    else if (Array.isArray(dst)) { const n = Math.min(dst.length, Math.floor(bytes / 3)); for (let i = 0; i < n; i++) { if (dst[i] && dst[i].__set) dst[i].__set(v ? ((v & 255) * 0x010101) : 0); else dst[i] = v; } }
    return dst;
  }
  function memcpy(dst, src, bytes) {
    if (ArrayBuffer.isView(dst)) { const n = Math.min(dst.length, src.length, Math.floor(bytes / dst.BYTES_PER_ELEMENT)); const tmp = Array.from(src).slice(0, n); dst.set(tmp); }
    else if (Array.isArray(dst)) {
      const n = Math.min(dst.length, src.length, Math.floor(bytes / 3));
      const tmp = [];
      for (let i = 0; i < n; i++) tmp.push(src[i] && src[i].__set ? CRGB.__from(src[i]) : src[i]);
      for (let i = 0; i < n; i++) dst[i] = __fcopy(dst[i], tmp[i]);
    }
    return dst;
  }
  const memmove = memcpy, memmove8 = memcpy, memcpy8 = memcpy, memset8 = memset;
  const memcpy_P = memcpy;

  /* ---- Serial ---- */
  function sprintf$(fmt, ...a) {
    let i = 0;
    return String(fmt).replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?(?:hh|h|ll|l|z)?([diuxXofFeEgGcs%])/g, (m, flags, w, prec, conv) => {
      if (conv === '%') return '%';
      const v = a[i++];
      let s;
      switch (conv) {
        case 'd': case 'i': s = String(Math.trunc(+v)); if (flags.includes('+') && +v >= 0) s = '+' + s; break;
        case 'u': s = String(Math.trunc(+v) >>> 0); break;
        case 'x': s = (Math.trunc(+v) >>> 0).toString(16); break;
        case 'X': s = (Math.trunc(+v) >>> 0).toString(16).toUpperCase(); break;
        case 'o': s = (Math.trunc(+v) >>> 0).toString(8); break;
        case 'f': case 'F': s = (+v).toFixed(prec === undefined ? 6 : +prec); break;
        case 'e': case 'E': s = (+v).toExponential(prec === undefined ? 6 : +prec); break;
        case 'g': case 'G': s = String(+v); break;
        case 'c': s = typeof v === 'number' ? String.fromCharCode(v) : String(v).charAt(0); break;
        default: s = String(v); if (prec !== undefined) s = s.slice(0, +prec);
      }
      if (w !== undefined && s.length < +w) s = flags.includes('-') ? s.padEnd(+w) : s.padStart(+w, flags.includes('0') && conv !== 's' && conv !== 'c' ? '0' : ' ');
      return s;
    });
  }
  function _fmt(v, f) {
    if (typeof v === 'number') {
      if (f === undefined) return Number.isInteger(v) ? String(v) : v.toFixed(2);
      if (Number.isInteger(v) && (f === 16 || f === 8 || f === 2)) return (v >>> 0).toString(f).toUpperCase();
      if (f === 10 && Number.isInteger(v)) return String(v);
      return v.toFixed(Math.max(0, Math.min(20, f | 0)));
    }
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v === undefined) return '';
    return String(v);
  }
  const __f = (v, digits) => (+v).toFixed(Math.max(0, Math.min(20, digits | 0)));
  function _serialWrite(s) { serialBuf += s; if (serialBuf.length > 4096) flush(); }
  // RX side: bytes from the host (audio bridge or typed input). Default ESP32 RX buffer is 256 bytes; overflow drops new bytes like the real UART.
  let rxCap = 256, rx = new Uint8Array(rxCap), rxHead = 0, rxLen = 0, rxDropped = 0;
  function _rxPush(bytes) {
    for (let i = 0; i < bytes.length; i++) {
      if (rxLen >= rxCap) { rxDropped++; continue; }
      rx[(rxHead + rxLen) % rxCap] = bytes[i]; rxLen++;
    }
  }
  function _rxRead() { if (!rxLen) return -1; const b = rx[rxHead]; rxHead = (rxHead + 1) % rxCap; rxLen--; return b; }
  const Serial = {
    begin() {}, end() {}, flush() {}, setTimeout() {}, setDebugOutput() {},
    setRxBufferSize(n) { rxCap = Math.max(1, n | 0); rx = new Uint8Array(rxCap); rxHead = 0; rxLen = 0; return rxCap; },
    print(v, f) { _serialWrite(_fmt(v, f)); },
    println(v, f) { _serialWrite(_fmt(v, f) + '\n'); },
    printf(fmt, ...a) { _serialWrite(sprintf$(fmt, ...a)); },
    write(v) { _serialWrite(typeof v === 'number' ? String.fromCharCode(v) : String(v)); return 1; },
    available() { vt += 0.001; return rxLen; },
    read() { return _rxRead(); },
    peek() { return rxLen ? rx[rxHead] : -1; },
    readBytes(buf, n) { let k = 0; n |= 0; while (k < n && rxLen) buf[k++] = _rxRead(); return k; },
    readString() { let s = ''; while (rxLen) s += String.fromCharCode(_rxRead()); return s; },
    readStringUntil(t) { const tc = typeof t === 'number' ? t : String(t).charCodeAt(0); let s = ''; while (rxLen) { const b = _rxRead(); if (b === tc) break; s += String.fromCharCode(b); } return s; },
    parseInt() { let s = ''; while (rxLen && !/[-\d]/.test(String.fromCharCode(rx[rxHead]))) _rxRead(); while (rxLen && /[-\d]/.test(String.fromCharCode(rx[rxHead]))) s += String.fromCharCode(_rxRead()); return parseInt(s, 10) || 0; },
  };
  const Serial1 = Serial, Serial2 = Serial;

  /* ---- GPIO ---- */
  const pins = new Map();
  function _pin(pin, kind, pull) {
    pin |= 0;
    let p = pins.get(pin);
    if (!p) { p = { kind: null, pull: 0, value: undefined, out: undefined, isr: null, isrMode: 0 }; pins.set(pin, p); }
    if (kind && (p.kind !== kind || (pull !== undefined && p.pull !== pull))) {
      p.kind = kind;
      if (pull !== undefined) p.pull = pull;
      host.post({ type: 'pin', pin, kind, pull: p.pull });
    }
    return p;
  }
  function pinMode(pin, mode) {
    if (mode === OUTPUT) _pin(pin, 'out');
    else _pin(pin, 'in', mode === INPUT_PULLUP ? 1 : 0);
  }
  function digitalRead(pin) {
    let p = pins.get(pin | 0);
    if (!p || !p.kind) p = _pin(pin, 'in', 0);
    if (p.kind === 'out') return p.out ? 1 : 0;
    return p.value !== undefined ? (p.value ? 1 : 0) : p.pull;
  }
  function digitalWrite(pin, v) {
    const p = _pin(pin, 'out');
    v = v ? 1 : 0;
    if (p.out !== v) { p.out = v; host.post({ type: 'pinout', pin: pin | 0, value: v, pwm: false }); }
  }
  function analogRead(pin) {
    let p = pins.get(pin | 0);
    if (!p || p.kind !== 'analog') p = _pin(pin, 'analog');
    return p.value !== undefined ? p.value | 0 : 0;
  }
  function touchRead(pin) {
    let p = pins.get(pin | 0);
    if (!p || p.kind !== 'touch') p = _pin(pin, 'touch');
    return p.value ? 12 : 70;
  }
  function analogWrite(pin, v) {
    const p = _pin(pin, 'out');
    if (p.out !== v) { p.out = v; host.post({ type: 'pinout', pin: pin | 0, value: v | 0, pwm: true }); }
  }
  const ledcWrite = analogWrite, dacWrite = analogWrite;
  const ledcSetup = () => 0, ledcAttachPin = () => {}, ledcAttach = () => true, ledcDetachPin = () => {}, ledcWriteTone = () => 0;
  const analogReadResolution = () => {}, analogSetAttenuation = () => {}, analogSetPinAttenuation = () => {}, analogWriteResolution = () => {}, setCpuFrequencyMhz = () => true;
  const digitalPinToInterrupt = p => p, noInterrupts = () => {}, interrupts = () => {}, cli = () => {}, sei = () => {};
  function attachInterrupt(pin, fn, mode) { const p = _pin(pin, undefined); p.isr = fn; p.isrMode = mode; if (!p.kind) _pin(pin, 'in', 0); }
  function detachInterrupt(pin) { const p = pins.get(pin | 0); if (p) p.isr = null; }
  function _input(pin, value) {
    const p = pins.get(pin);
    if (!p) return;
    const before = p.kind === 'in' ? (p.value !== undefined ? (p.value ? 1 : 0) : p.pull) : 0;
    p.value = value;
    if (p.isr && p.kind === 'in') {
      const after = value ? 1 : 0;
      if (after !== before && (p.isrMode === CHANGE || (p.isrMode === RISING && after) || (p.isrMode === FALLING && !after))) {
        try { p.isr(); } catch (e) { fail(e); }
      }
    }
  }

  /* ============================== run loop ============================== */
  let failed = false;
  function fail(e) {
    if (failed) return;
    failed = true;
    try { flush(); } catch (x) { /* ignore */ }
    if (e instanceof StopSignal) { host.post({ type: 'done', vt }); return; }
    let line = 0;
    const m = /sketch\.ino:(\d+)/.exec(String((e && e.stack) || ''));
    if (m) line = +m[1];
    let msg = (e && e.message) ? e.message : String(e);
    if (e instanceof ReferenceError) {
      const id = /^(\S+) is not defined/.exec(msg);
      if (id) msg = `'${id[1].replace(/\$$/, '')}' is not available in the simulator (unsupported library or function, or a typo)`;
    } else if (e instanceof SyntaxError) msg = 'The simulator could not translate this sketch: ' + msg;
    else if (e instanceof TypeError && /properties of undefined|assigned undefined|assignment to undefined/.test(msg)) msg = 'Array index out of range: this line touches an element past the end of an array. A real ESP32 would not stop here — it would silently corrupt memory.';
    else if (e instanceof TypeError && /not a function/.test(msg)) msg += ' — this method or function is not supported by the simulator';
    else if (e instanceof RangeError && /call stack/i.test(msg)) msg = 'Stack overflow (runaway recursion?)';
    host.post({ type: 'error', message: msg, line, vt });
  }
  async function _run(code) {
    let api;
    try { api = eval(code)(); } catch (e) { fail(e); return; }
    try {
      if (api.setup) await api.setup();
      flush();
      if (!api.loop) { host.post({ type: 'done', vt }); return; }
      for (;;) {
        const a = advCount;
        await api.loop();
        loopCount++;
        if (advCount === a) { const p = advance(0.2); if (p) await p; }
      }
    } catch (e) { fail(e); }
  }
  host.onmessage = (m) => {
    switch (m.type) {
      case 'run':
        speed = m.speed || 1; stopAt = m.stopAt || Infinity;
        vt = 0; reanchor(0); lastYield = _now();
        _run(m.code);
        break;
      case 'pause':
        if (!paused) { pauseSim = simNow(); paused = true; }
        break;
      case 'resume':
        if (paused) { paused = false; reanchor(Math.min(pauseSim, vt)); lastYield = _now(); resumeWaiters.splice(0).forEach(r => r()); }
        break;
      case 'speed': {
        const s = paused ? pauseSim : Math.min(simNow(), vt);
        speed = m.speed || 1;
        if (!paused) reanchor(s);
        break;
      }
      case 'input': _input(m.pin, m.value); break;
      case 'rx': _rxPush(m.bytes); break;
    }
  };
}
