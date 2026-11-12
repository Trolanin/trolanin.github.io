/* LED Audio Designer — design model and Arduino code generator.
   The generated sketch is plain FastLED C++ for a real ESP32; the designer previews
   exactly this code in the simulator. */
(function () {
'use strict';

const BAND_LO_HZ = Array.from({ length: 17 }, (_, b) => 40 * Math.pow(400, b / 16));
const fmtHz = f => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + ' kHz' : Math.round(f) + ' Hz';

const EFFECTS = {
  pulse: 'Pulse — whole segment glows',
  meter: 'Level meter (VU)',
  spectrum: 'Spectrum bars',
  ripple: 'Ripples on trigger',
  sparkle: 'Sparkles',
  scroll: 'Scrolling history',
  comet: 'Comet — speed follows audio',
  fire: 'Fire — audio feeds the flames',
  colorshift: 'Colour change — steps through your palette',
  intensity: 'Intensity pattern — your brightness levels',
  palmood: 'Palette change — matches the mood',
};
const SOURCES = { bands: 'Frequency range', level: 'Overall loudness', beat: 'Beats only' };
const CURVES = { linear: 'Linear', punchy: 'Punchy (quiet drops out)', gentle: 'Gentle (lifts quiet parts)' };
const COLORS = { solid: 'Single colour', gradient: 'Gradient along strip', value: 'Colour shifts with loudness', rainbow: 'Moving rainbow', palette: 'Palette' };
const PALETTES = { RainbowColors_p: 'Rainbow', PartyColors_p: 'Party', HeatColors_p: 'Heat', LavaColors_p: 'Lava', OceanColors_p: 'Ocean', ForestColors_p: 'Forest', CloudColors_p: 'Cloud', custom: 'Custom (your colours)' };
const SEQ_MODES = { beat: 'Step on beats', flow: 'Flow continuously', level: 'Loudness picks it' };
const LED_TYPES = ['WS2812B', 'WS2812', 'WS2811', 'WS2813', 'WS2815', 'SK6812', 'APA106'];
const ORDERS = ['GRB', 'RGB', 'BRG', 'RBG', 'GBR', 'BGR'];
const IDLE = { off: 'Off', breathe: 'Dim blue breathing', rainbow: 'Dim rainbow' };

// FastLED's built-in palettes, 16 entries each (named colours resolved to hex).
const hexList = s => s.split(' ').map(h => '#' + h.toLowerCase());
const PALETTE_HEX = {
  RainbowColors_p: hexList('FF0000 D52A00 AB5500 AB7F00 ABAB00 56D500 00FF00 00D52A 00AB55 0056AA 0000FF 2A00D5 5500AB 7F0081 AB0055 D5002B'),
  PartyColors_p: hexList('5500AB 84007C B5004B E5001B E81700 B84700 AB7700 ABAB00 AB5500 DD2200 F2000E C2003E 8F0071 5F00A1 2F00D0 0007F9'),
  HeatColors_p: hexList('000000 330000 660000 990000 CC0000 FF0000 FF3300 FF6600 FF9900 FFCC00 FFFF00 FFFF33 FFFF66 FFFF99 FFFFCC FFFFFF'),
  LavaColors_p: hexList('000000 800000 000000 800000 8B0000 800000 8B0000 8B0000 8B0000 8B0000 FF0000 FFA500 FFFFFF FFA500 FF0000 8B0000'),
  OceanColors_p: hexList('191970 00008B 191970 000080 00008B 0000CD 2E8B57 008080 5F9EA0 0000FF 008B8B 6495ED 7FFFD4 2E8B57 00FFFF 87CEFA'),
  ForestColors_p: hexList('006400 006400 556B2F 006400 008000 228B22 6B8E23 008000 2E8B57 66CDAA 32CD32 9ACD32 90EE90 7CFC00 66CDAA 228B22'),
  CloudColors_p: hexList('0000FF 00008B 00008B 00008B 00008B 00008B 00008B 00008B 0000FF 00008B 87CEEB 87CEEB ADD8E6 FFFFFF ADD8E6 87CEEB'),
};
const DEFAULT_PAL = ['#ff0040', '#ff7a00', '#ffd500', '#30e070', '#00b4ff', '#5a3cff', '#d02cff'];

const RAND_GROUPS = {
  effect: 'Effect', listen: 'What it listens to', response: 'Response (gate, gain, curve, attack, release)', settings: 'Effect settings',
  color: 'Colour', palette: 'Palette colours', intensity: 'Brightness pattern', placement: 'Mirror / reverse',
};
const RAND_DEFAULT = { effect: true, listen: true, response: true, settings: true, color: true, palette: true, intensity: true, placement: false };

function newMood(pal, cond) {
  return Object.assign({ pal, colors: DEFAULT_PAL.slice(), bpm: [0, 300], bass: [0, 255], treble: [0, 255], loud: [0, 255] }, cond || {});
}
function newLayer(over) {
  return Object.assign({
    name: 'Layer', enabled: true, effect: 'pulse',
    source: 'bands', lo: 0, hi: 3, reduce: 'avg', trigger: 'beat', threshold: 160,
    gate: 20, gain: 1, curve: 'linear', attack: 0, release: 150,
    color: 'solid', hue1: 0, hue2: 160, sat: 240, palette: 'RainbowColors_p', spread: 4, opacity: 255,
    customPal: DEFAULT_PAL.slice(), hardSteps: false,
    start: 0, length: 60, mirror: false, reverse: false,
    peakHold: true, peakFall: 20, speed: 60, width: 2, rate: 120, decay: 300, tail: 8, baseSpeed: 10, boost: 120,
    cooling: 55, sparkBase: 20, sparkBoost: 160,
    seqMode: 'beat', seqEvery: 1, seqStep: 1, seqFade: 150, seqBase: 1, seqBoost: 4, palSpread: 0, briFollow: false,
    intOn: false, intLevels: [255, 60], intMode: 'beat', intEvery: 1, intStep: 1, intFade: 0, intBase: 2, intBoost: 6,
    moods: [newMood('OceanColors_p', { bpm: [0, 105] }), newMood('PartyColors_p', { bpm: [105, 300] })],
    moodAvg: 3000, moodHold: 4, moodFade: 1500,
    rand: { on: true, groups: { ...RAND_DEFAULT } },
  }, over || {});
}
function newDesign() {
  return {
    name: 'my_audio_leds',
    global: { numLeds: 60, dataPin: 5, ledType: 'WS2812B', colorOrder: 'GRB', brightness: 180, maxMilliamps: 2000, fps: 100, trailMs: 0, hueSpeed: 20, idle: 'breathe', baud: 115200, shape: 'strip', cols: 10 },
    layers: [newLayer({ name: 'Bass pulse' })],
  };
}

const PRESETS = {
  'Bass pulse + treble sparkles': () => ({ ...newDesign(), name: 'bass_pulse_sparkle', layers: [
    newLayer({ name: 'Bass pulse', effect: 'pulse', lo: 0, hi: 3, gate: 30, gain: 1.2, curve: 'punchy', release: 180, color: 'gradient', hue1: 200, hue2: 250, mirror: true }),
    newLayer({ name: 'Hi-hat sparkles', effect: 'sparkle', lo: 12, hi: 15, reduce: 'peak', gate: 40, gain: 1.5, rate: 250, decay: 250, color: 'solid', hue1: 40, sat: 60 }),
  ] }),
  'Mirrored spectrum': () => ({ ...newDesign(), name: 'mirrored_spectrum', layers: [
    newLayer({ name: 'Spectrum', effect: 'spectrum', lo: 0, hi: 15, gate: 15, release: 120, color: 'gradient', hue1: 0, hue2: 210, mirror: true }),
  ] }),
  'VU meter from centre': () => ({ ...newDesign(), name: 'vu_center', global: { ...newDesign().global, trailMs: 60 }, layers: [
    newLayer({ name: 'Loudness meter', effect: 'meter', source: 'level', gate: 10, release: 200, color: 'gradient', hue1: 96, hue2: 0, mirror: true, peakHold: true, peakFall: 25 }),
  ] }),
  'Beat ripples': () => ({ ...newDesign(), name: 'beat_ripples', layers: [
    newLayer({ name: 'Kick ripples', effect: 'ripple', lo: 0, hi: 3, trigger: 'beat', speed: 90, width: 2, color: 'rainbow', spread: 3, mirror: true }),
    newLayer({ name: 'Bass glow', effect: 'pulse', lo: 0, hi: 2, gate: 40, curve: 'punchy', release: 250, hue1: 170, opacity: 70 }),
  ] }),
  'Fire roars with the bass': () => ({ ...newDesign(), name: 'audio_fire', layers: [
    newLayer({ name: 'Fire', effect: 'fire', lo: 0, hi: 4, gate: 20, gain: 1.3, release: 80, cooling: 60, sparkBase: 15, sparkBoost: 200, mirror: true, reverse: true }),
  ] }),
  'Waterfall history': () => ({ ...newDesign(), name: 'waterfall', layers: [
    newLayer({ name: 'Low end', effect: 'scroll', lo: 0, hi: 4, gate: 25, speed: 50, color: 'value', hue1: 160, hue2: 0, mirror: true }),
  ] }),
  'Party mix': () => ({ ...newDesign(), name: 'party_mix', global: { ...newDesign().global, trailMs: 40, hueSpeed: 35 }, layers: [
    newLayer({ name: 'Spectrum base', effect: 'spectrum', lo: 2, hi: 13, gate: 25, release: 150, color: 'palette', palette: 'PartyColors_p', opacity: 150, mirror: true }),
    newLayer({ name: 'Kick ripples', effect: 'ripple', trigger: 'beat', speed: 120, width: 1, color: 'solid', hue1: 0, sat: 0, opacity: 200, mirror: true }),
    newLayer({ name: 'Treble comet', effect: 'comet', lo: 11, hi: 15, gate: 30, baseSpeed: 8, boost: 160, tail: 10, color: 'rainbow', spread: 6 }),
  ] }),
  'Colour wash on the beat': () => ({ ...newDesign(), name: 'colour_wash', layers: [
    newLayer({ name: 'Beat colour wash', effect: 'colorshift', palette: 'custom', customPal: ['#ff004c', '#ff8a00', '#ffe600', '#00e676', '#00b0ff', '#7c4dff'], seqMode: 'beat', seqFade: 220, palSpread: 1, opacity: 200, mirror: true }),
    newLayer({ name: 'Kick flash', effect: 'pulse', source: 'beat', release: 140, color: 'solid', sat: 0, opacity: 110 }),
  ] }),
  'Mood: chill vs party': () => ({ ...newDesign(), name: 'mood_chill_party', layers: [
    newLayer({ name: 'Mood palette', effect: 'palmood', lo: 0, hi: 4, gate: 15, release: 250, briFollow: true, palSpread: 2, mirror: true, moods: [
      newMood('PartyColors_p', { bpm: [118, 300], bass: [110, 255] }),
      newMood('CloudColors_p', { treble: [80, 255] }),
      newMood('OceanColors_p', { bpm: [0, 104] }),
      newMood('custom', { colors: ['#ff6a00', '#ff2d55', '#ffb300', '#c2185b'] }),
    ] }),
  ] }),
  'Bass drop flips palette': () => ({ ...newDesign(), name: 'bass_drop_palette', layers: [
    newLayer({ name: 'Drop palette', effect: 'palmood', source: 'level', gate: 10, release: 200, briFollow: true, palSpread: 3, moodAvg: 1200, moodHold: 2, moodFade: 600, moods: [
      newMood('LavaColors_p', { bass: [140, 255] }),
      newMood('OceanColors_p'),
    ] }),
  ] }),
  'Beat-gated spectrum': () => ({ ...newDesign(), name: 'gated_spectrum', layers: [
    newLayer({ name: 'Gated spectrum', effect: 'spectrum', lo: 0, hi: 15, gate: 15, release: 120, color: 'palette', palette: 'custom', customPal: ['#00e5ff', '#2979ff', '#d500f9', '#ff1744'], mirror: true,
      intOn: true, intLevels: [255, 120, 60, 120], intMode: 'beat', intFade: 60 }),
  ] }),
};

/* ------------------------------- generator ------------------------------- */
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, +v || 0));
const flt = v => { const s = String(+(+v).toFixed(3)); return s.includes('.') || s.includes('e') ? s : s + '.0'; };
const ident = s => (String(s || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'sketch').slice(0, 40);
const HEX = /^#?[0-9a-f]{6}$/i;
const cleanCols = (a, fb) => {
  const c = (Array.isArray(a) ? a : []).filter(x => HEX.test(String(x))).map(x => '#' + String(x).replace('#', '').toLowerCase()).slice(0, 16);
  return c.length ? c : fb.slice();
};
const cleanLevels = a => {
  const l = (Array.isArray(a) ? a : []).filter(x => Number.isFinite(+x)).map(x => int(x, 0, 255)).slice(0, 16);
  return l.length ? l : [255, 60];
};
const span2 = (r, max) => { const a = int(r && r[0], 0, max), b = int(r && r[1] !== undefined ? r[1] : max, 0, max); return [Math.min(a, b), Math.max(a, b)]; };
const hex0x = c => '0x' + c.slice(1).toUpperCase();
const rgbOf = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const toHex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

// N colours -> FastLED's 16 palette entries, cycling round (blended, or in hard blocks).
function expandPal(cols, hard) {
  const rgb = cols.map(rgbOf), N = rgb.length;
  return Array.from({ length: 16 }, (_, e) => {
    const x = e * N / 16, i = Math.floor(x), f = hard ? 0 : x - i, a = rgb[i % N], b = rgb[(i + 1) % N];
    return toHex(a.map((v, j) => v + (b[j] - v) * f));
  });
}
const layerCols = L => L.palette === 'custom' ? L.customPal : PALETTE_HEX[L.palette] || PALETTE_HEX.RainbowColors_p;
const palName = (L, k) => L.palette === 'custom' ? `pal${k}` : L.palette;
const palInit = cols => `{ ${cols.map(hex0x).join(', ')} }`;
const usesPal = L => L.color === 'palette';

// Clamps a design to sane values so the generated C++ is always valid.
function normalize(d) {
  const g = d.global, n = int(g.numLeds, 1, 1000);
  const G = {
    numLeds: n, dataPin: int(g.dataPin, 0, 48), ledType: LED_TYPES.includes(g.ledType) ? g.ledType : 'WS2812B',
    colorOrder: ORDERS.includes(g.colorOrder) ? g.colorOrder : 'GRB', brightness: int(g.brightness, 1, 255),
    maxMilliamps: int(g.maxMilliamps, 100, 20000), fps: int(g.fps, 20, 200), trailMs: int(g.trailMs, 0, 2000),
    hueSpeed: num(g.hueSpeed, -200, 200), idle: IDLE[g.idle] ? g.idle : 'breathe', baud: int(g.baud, 9600, 2000000),
  };
  const layers = d.layers.map(l => {
    const L = { ...newLayer(), ...l };
    if (!EFFECTS[L.effect]) L.effect = 'pulse';
    if (!PALETTES[L.palette]) L.palette = 'RainbowColors_p';
    L.start = int(L.start, 0, n - 1);
    L.length = int(L.length, 1, n - L.start);
    L.lo = int(L.lo, 0, 15); L.hi = int(L.hi, L.lo, 15);
    if (L.effect === 'spectrum') L.source = 'bands';
    L.customPal = cleanCols(L.customPal, DEFAULT_PAL);
    L.intLevels = cleanLevels(L.intLevels);
    if (!SEQ_MODES[L.seqMode]) L.seqMode = 'beat';
    if (!SEQ_MODES[L.intMode]) L.intMode = 'beat';
    const ms = (Array.isArray(L.moods) && L.moods.length ? L.moods : newLayer().moods).slice(0, 8);
    L.moods = ms.map(m => ({
      pal: PALETTES[m && m.pal] ? m.pal : 'RainbowColors_p', colors: cleanCols(m && m.colors, DEFAULT_PAL),
      bpm: span2(m && m.bpm, 300), bass: span2(m && m.bass, 255), treble: span2(m && m.treble, 255), loud: span2(m && m.loud, 255),
    }));
    return L;
  });
  return { name: d.name, global: G, layers };
}

function colorExpr(L, span, k) {
  const sat = int(L.sat, 0, 255), h1 = int(L.hue1, 0, 255), dh = int(L.hue2, 0, 255) - h1;
  switch (L.color) {
    case 'gradient': return `CHSV((uint8_t)(${h1} + ${dh} * p / ${Math.max(1, span - 1)}), ${sat}, 255)`;
    case 'value': return `CHSV((uint8_t)(${h1} + ${dh} * v / 255), ${sat}, 255)`;
    case 'rainbow': return `CHSV((uint8_t)((int)gHue + p * ${int(L.spread, 0, 64)}), ${sat}, 255)`;
    case 'palette': return `ColorFromPalette(${palName(L, k)}, (uint8_t)(p * ${Math.max(1, Math.round(255 / span))} + (int)gHue), 255, ${L.hardSteps ? 'NOBLEND' : 'LINEARBLEND'})`;
    default: return `CHSV(${h1}, ${sat}, 255)`;
  }
}

// A position that steps on triggers, flows over time, or follows loudness, over `slots` entries.
function seqCode(id, c, slots, inV, trig) {
  const decl = [`float ${id}Pos = 0, ${id}Tgt = 0;`, `int ${id}Cnt = 0;`];
  let upd;
  if (c.mode === 'flow') upd = [
    `    ${id}Pos += (${flt(num(c.base, 0, 100))} + ${flt(num(c.boost, 0, 200))} * ${inV} / 255.0) * dt / 1000.0;   // steps per second`,
    `    while (${id}Pos >= ${slots}) ${id}Pos -= ${slots};`];
  else if (c.mode === 'level') upd = [`    ${id}Pos = ${inV} * ${slots - 1} / 255.0;`];
  else upd = [
    `    if (${trig} && ++${id}Cnt >= ${int(c.every, 1, 64)}) { ${id}Cnt = 0; ${id}Tgt += ${flt(num(c.step, 0.1, 16))}; }`,
    `    ${id}Pos = follow(${id}Pos, ${id}Tgt, dt, ${flt(num(c.fade, 0, 10000))}, 0);`,
    `    if (${id}Pos >= ${slots} && ${id}Tgt >= ${slots}) { ${id}Pos -= ${slots}; ${id}Tgt -= ${slots}; }`];
  return { decl, upd };
}
const seqOf = L => ({ mode: L.seqMode, every: L.seqEvery, step: L.seqStep, fade: L.seqFade, base: L.seqBase, boost: L.seqBoost });
const intSeqOf = L => ({ mode: L.intMode, every: L.intEvery, step: L.intStep, fade: L.intFade, base: L.intBase, boost: L.intBoost });
const modOn = L => L.intOn && L.effect !== 'intensity';

function moodCond(e, k) {
  const parts = [];
  const add = (name, r, max) => { if (r[0] > 0) parts.push(`${name} >= ${r[0]}`); if (r[1] < max) parts.push(`${name} <= ${r[1]}`); };
  add(`moodBpm${k}`, e.bpm, 300); add(`moodBass${k}`, e.bass, 255); add(`moodTreb${k}`, e.treble, 255); add(`moodLoud${k}`, e.loud, 255);
  return parts.join(' && ') || 'true';
}

function moodCode(L, k) {
  const avg = flt(num(L.moodAvg, 100, 60000)), hold = flt(num(L.moodHold, 0, 600) * 1000), fade = flt(Math.max(1, num(L.moodFade, 0, 20000)));
  const out = [
    `float moodBass${k} = 0, moodTreb${k} = 0, moodLoud${k} = 0, moodBpm${k} = 0, moodHeld${k} = 0, moodFadeT${k} = 0;`,
    `unsigned long moodBeatMs${k} = 0;`,
    `int moodCur${k} = -1;`,
    `CRGBPalette16 moodPal${k};`,
    `CRGBPalette16 moodFrom${k};`,
    `CRGBPalette16 moodTo${k};`,
  ];
  L.moods.forEach((e, j) => { if (e.pal === 'custom') out.push(`CRGBPalette16 moodCustom${k}_${j} = ${palInit(expandPal(e.colors, L.hardSteps))};`); });
  out.push('', `void moodSet${k}(int j) {`, `  switch (j) {`);
  L.moods.forEach((e, j) => out.push(`    case ${j}: moodTo${k} = ${e.pal === 'custom' ? `moodCustom${k}_${j}` : e.pal}; break;`));
  out.push(`  }`, `}`, '');
  out.push(
    `// Mood readings (smoothed over ~${avg} ms) pick the first palette whose conditions all match.`,
    `void moodUpdate${k}(float dt) {`,
    `  float mk = dt / (dt + ${avg});`,
    `  moodBass${k} += (bandRange(0, 3, false) - moodBass${k}) * mk;`,
    `  moodTreb${k} += (bandRange(11, 15, false) - moodTreb${k}) * mk;`,
    `  moodLoud${k} += (level - moodLoud${k}) * mk;`,
    `  if (beat) {`,
    `    unsigned long now = millis(), iv = now - moodBeatMs${k};`,
    `    moodBeatMs${k} = now;`,
    `    if (iv >= 250 && iv <= 1500) moodBpm${k} = moodBpm${k} <= 0 ? 60000.0 / iv : moodBpm${k} + (60000.0 / iv - moodBpm${k}) * 0.25;`,
    `  }`,
    `  moodHeld${k} += dt;`,
    `  int want = -1;`);
  L.moods.forEach((e, j) => out.push(`  ${j ? 'else if' : 'if'} (${moodCond(e, k)}) want = ${j};`));
  out.push(
    `  if (moodCur${k} < 0) {`,
    `    moodCur${k} = want < 0 ? 0 : want;`,
    `    moodSet${k}(moodCur${k});`,
    `    moodPal${k} = moodTo${k};`,
    `    moodFadeT${k} = ${fade};`,
    `  } else if (want >= 0 && want != moodCur${k} && moodHeld${k} >= ${hold}) {`,
    `    moodFrom${k} = moodPal${k};`,
    `    moodSet${k}(want);`,
    `    moodCur${k} = want;`,
    `    moodHeld${k} = 0;`,
    `    moodFadeT${k} = 0;`,
    `  }`,
    `  if (moodFadeT${k} < ${fade}) {`,
    `    moodFadeT${k} += dt;`,
    `    uint8_t a = moodFadeT${k} >= ${fade} ? 255 : (uint8_t)(moodFadeT${k} * 255 / ${fade});`,
    `    for (int i = 0; i < 16; i++) moodPal${k}[i] = blend(moodFrom${k}[i], moodTo${k}[i], a);`,
    `  }`,
    `}`);
  return out;
}

function layerCode(L, k) {
  const span = L.mirror ? Math.ceil(L.length / 2) : L.length;
  const S = `SEG${k}`, N = `SPAN${k}`, op = int(L.opacity, 0, 255);
  const out = [];
  out.push(`// ---- Layer ${k}: ${String(L.name).replace(/[\r\n]/g, ' ')} (${EFFECTS[L.effect].split(' —')[0]})`);
  out.push(`#define ${S} ${L.start}, ${L.length}, ${L.mirror}, ${L.reverse}   // start, length, mirror, reverse`);
  out.push(`#define ${N} ${span}`);
  out.push(`float in${k} = 0;`);
  if (L.trigger === 'threshold' && needsTrig(L)) out.push(`float last${k} = 0;`);
  if (L.effect === 'spectrum') out.push(`float spec${k}[NUM_BANDS];`);
  if (L.palette === 'custom' && usesPal(L)) out.push(`CRGBPalette16 pal${k} = ${palInit(expandPal(L.customPal, L.hardSteps))};`);
  if (L.effect === 'colorshift') {
    out.push(...seqCode(`sq${k}`, seqOf(L), layerCols(L).length, `in${k}`, '').decl);
  }
  if (L.effect === 'intensity') out.push(...seqCode(`sq${k}`, seqOf(L), L.intLevels.length, `in${k}`, '').decl);
  if (modOn(L)) out.push(...seqCode(`is${k}`, intSeqOf(L), L.intLevels.length, `in${k}`, '').decl);
  if (L.effect === 'intensity' || modOn(L)) {
    const n = L.intLevels.length;
    out.push(
      `const uint8_t ilev${k}[${n}] = { ${L.intLevels.join(', ')} };   // brightness pattern`,
      `uint8_t levelAt${k}(float x) {`,
      `  int i = (int)x % ${n};`,
      `  float f = x - (int)x;`,
      `  int a = ilev${k}[i], b = ilev${k}[(i + 1) % ${n}];`,
      `  return (uint8_t)(a + (b - a) * f);`,
      `}`);
  }
  if (L.effect === 'colorshift') {
    const cols = layerCols(L), n = cols.length;
    out.push(
      `const uint32_t cols${k}[${n}] = { ${cols.map(hex0x).join(', ')} };`,
      `CRGB colAt${k}(float x) {   // x counts colours; between two colours it ${L.hardSteps ? 'snaps' : 'blends'}`,
      `  while (x >= ${n}) x -= ${n};`,
      `  int i = (int)x;`,
      L.hardSteps ? `  return CRGB(cols${k}[i]);` : `  return blend(CRGB(cols${k}[i]), CRGB(cols${k}[(i + 1) % ${n}]), (uint8_t)((x - i) * 255));`,
      `}`);
  }
  if (L.effect === 'palmood') out.push(...moodCode(L, k));
  out.push('');
  out.push(`CRGB color${k}(int p, uint8_t v, uint8_t bri) {`);
  out.push(`  CRGB c = ${colorExpr(L, span, k)};`);
  out.push(`  c.nscale8(scale8(bri, ${op}));`);
  out.push(`  return c;`);
  out.push(`}`);
  out.push('');
  const body = [];
  switch (L.effect) {
    case 'meter':
      out.push(`float peak${k} = 0;`);
      body.push(
        `  uint32_t f = (uint32_t)v * ${N};`,
        `  int full = f / 255;`,
        `  uint8_t part = f % 255;`,
        `  for (int p = 0; p < full && p < ${N}; p++) paint(${S}, p, color${k}(p, v, 255));`,
        `  if (full < ${N} && part) paint(${S}, full, color${k}(full, v, part));`);
      if (L.peakHold) body.push(
        `  float lit = f / 255.0;`,
        `  if (lit > peak${k}) peak${k} = lit;`,
        `  else peak${k} -= ${flt(num(L.peakFall, 1, 200))} * dt / 1000.0;   // peak dot falls, LEDs per second`,
        `  if (peak${k} < 0) peak${k} = 0;`,
        `  int pk = (int)peak${k};`,
        `  if (pk > 0) paint(${S}, pk, color${k}(pk, 255, 255));`);
      break;
    case 'spectrum':
      body.push(
        `  for (int p = 0; p < ${N}; p++) {`,
        `    int b = ${L.lo} + p * ${L.hi - L.lo + 1} / ${N};`,
        `    uint8_t bv = (uint8_t)spec${k}[b];`,
        `    paint(${S}, p, color${k}(p, bv, bv));`,
        `  }`);
      break;
    case 'ripple':
      out.push(`float ripPos${k}[8];`, `uint8_t ripBri${k}[8];   // 0 = unused slot`);
      body.push(
        `  if (trig) {`,
        `    for (int i = 0; i < 8; i++) {`,
        `      if (ripBri${k}[i] == 0) { ripPos${k}[i] = 0; ripBri${k}[i] = v > 96 ? v : 96; break; }`,
        `    }`,
        `  }`,
        `  for (int i = 0; i < 8; i++) {`,
        `    if (ripBri${k}[i] == 0) continue;`,
        `    ripPos${k}[i] += ${flt(num(L.speed, 1, 500))} * dt / 1000.0;   // LEDs per second`,
        `    if (ripPos${k}[i] >= ${N} + ${int(L.width, 0, 10)}) { ripBri${k}[i] = 0; continue; }`,
        `    uint8_t fade = 255 - (uint8_t)(ripPos${k}[i] * 255 / (${N} + ${int(L.width, 0, 10)} + 1));`,
        `    for (int w = -${int(L.width, 0, 10)}; w <= ${int(L.width, 0, 10)}; w++) {`,
        `      int p = (int)ripPos${k}[i] + w;`,
        `      uint8_t edge = 255 - abs(w) * 255 / ${int(L.width, 0, 10) + 1};`,
        `      paint(${S}, p, color${k}(p, ripBri${k}[i], scale8(scale8(ripBri${k}[i], fade), edge)));`,
        `    }`,
        `  }`);
      break;
    case 'sparkle':
      out.push(`int sparkPos${k}[48];`, `float sparkBri${k}[48];`, `float sparkAcc${k} = 0;`);
      body.push(
        `  sparkAcc${k} += v / 255.0 * ${flt(num(L.rate, 1, 2000))} * dt / 1000.0;   // sparkles per second at full volume`,
        `  while (sparkAcc${k} >= 1) {`,
        `    sparkAcc${k} -= 1;`,
        `    for (int i = 0; i < 48; i++) {`,
        `      if (sparkBri${k}[i] <= 0) { sparkPos${k}[i] = random16(${N}); sparkBri${k}[i] = 255; break; }`,
        `    }`,
        `  }`,
        `  for (int i = 0; i < 48; i++) {`,
        `    if (sparkBri${k}[i] <= 0) continue;`,
        `    paint(${S}, sparkPos${k}[i], color${k}(sparkPos${k}[i], v, (uint8_t)sparkBri${k}[i]));`,
        `    sparkBri${k}[i] -= 255.0 * dt / ${flt(num(L.decay, 10, 5000))};   // fade time, ms`,
        `  }`);
      break;
    case 'scroll':
      out.push(`CRGB hist${k}[${N}];`, `float scrollAcc${k} = 0;`);
      body.push(
        `  scrollAcc${k} += ${flt(num(L.speed, 1, 500))} * dt / 1000.0;   // LEDs per second`,
        `  if (scrollAcc${k} > ${N}) scrollAcc${k} = ${N};`,
        `  while (scrollAcc${k} >= 1) {`,
        `    scrollAcc${k} -= 1;`,
        `    for (int p = ${N} - 1; p > 0; p--) hist${k}[p] = hist${k}[p - 1];`,
        `    hist${k}[0] = color${k}(0, v, v);`,
        `  }`,
        `  for (int p = 0; p < ${N}; p++) paint(${S}, p, hist${k}[p]);`);
      break;
    case 'comet':
      out.push(`float comet${k} = 0;`);
      body.push(
        `  comet${k} += (${flt(num(L.baseSpeed, 0, 500))} + ${flt(num(L.boost, 0, 1000))} * v / 255.0) * dt / 1000.0;   // LEDs per second`,
        `  while (comet${k} >= ${N}) comet${k} -= ${N};`,
        `  for (int t = 0; t < ${int(L.tail, 1, 100)}; t++) {`,
        `    int p = ((int)comet${k} - t + ${N} * 100) % ${N};`,
        `    uint8_t b = 255 - t * 255 / ${int(L.tail, 1, 100)};`,
        `    paint(${S}, p, color${k}(p, v, scale8(b, 128 + v / 2)));`,
        `  }`);
      break;
    case 'fire':
      out.push(`uint8_t heat${k}[${N}];`);
      body.push(
        `  for (int i = 0; i < ${N}; i++) heat${k}[i] = qsub8(heat${k}[i], random8(0, ${Math.min(255, Math.round(int(L.cooling, 10, 150) * 10 / span) + 2)}));`,
        `  for (int i = ${N} - 1; i >= 2; i--) heat${k}[i] = (heat${k}[i - 1] + heat${k}[i - 2] + heat${k}[i - 2]) / 3;`,
        `  uint8_t sparking = qadd8(${int(L.sparkBase, 0, 255)}, scale8(v, ${int(L.sparkBoost, 0, 255)}));`,
        `  if (random8() < sparking) {`,
        `    int y = random8(${Math.min(7, span)});`,
        `    heat${k}[y] = qadd8(heat${k}[y], random8(160, 255));`,
        `  }`,
        `  for (int p = 0; p < ${N}; p++) {`,
        L.color === 'palette'
          ? `    CRGB c = ColorFromPalette(${palName(L, k)}, scale8(heat${k}[p], 240));`
          : `    CRGB c = HeatColor(heat${k}[p]);`,
        `    c.nscale8(${op});`,
        `    paint(${S}, p, c);`,
        `  }`);
      break;
    case 'colorshift': {
      const n = layerCols(L).length;
      body.push(
        `  uint8_t bri = scale8(${L.briFollow ? 'v' : '255'}, ${op});`,
        `  for (int p = 0; p < ${N}; p++) {`,
        `    CRGB c = colAt${k}(sq${k}Pos + p * ${flt(num(L.palSpread, 0, 16) % n)} / ${N});   // spread: colours across the segment`,
        `    c.nscale8(bri);`,
        `    paint(${S}, p, c);`,
        `  }`);
      break;
    }
    case 'intensity':
      body.push(
        `  uint8_t lv = levelAt${k}(sq${k}Pos);`,
        `  for (int p = 0; p < ${N}; p++) paint(${S}, p, color${k}(p, lv, lv));`);
      break;
    case 'palmood':
      body.push(
        `  uint8_t bri = scale8(${L.briFollow ? 'v' : '255'}, ${op});`,
        `  for (int p = 0; p < ${N}; p++) {`,
        `    CRGB c = ColorFromPalette(moodPal${k}, (uint8_t)((int)gHue + p * ${int(num(L.palSpread, 0, 16) * 16, 0, 256)} / ${N}), 255, ${L.hardSteps ? 'NOBLEND' : 'LINEARBLEND'});`,
        `    c.nscale8(bri);`,
        `    paint(${S}, p, c);`,
        `  }`);
      break;
    default: // pulse
      body.push(`  for (int p = 0; p < ${N}; p++) paint(${S}, p, color${k}(p, v, v));`);
  }
  out.push('');
  out.push(`void layer${k}(uint8_t v, bool trig, float dt) {`);
  out.push(...body);
  out.push(`}`);
  return out.join('\n');
}

const needsTrig = L => ['ripple', 'colorshift', 'intensity'].includes(L.effect) || modOn(L);

// Per-frame input processing for one layer (inside loop()).
function layerInput(L, k) {
  const shp = raw => `shape(${raw}, ${int(L.gate, 0, 254)}, ${flt(num(L.gain, 0, 16))}, ${{ linear: 0, punchy: 1, gentle: 2 }[L.curve] || 0})`;
  const A = flt(num(L.attack, 0, 5000)), R = flt(num(L.release, 0, 10000));
  const lines = [`    // Layer ${k}: ${String(L.name).replace(/[\r\n]/g, ' ')}`];
  if (L.effect === 'spectrum') {
    lines.push(`    for (int b = ${L.lo}; b <= ${L.hi}; b++) spec${k}[b] = follow(spec${k}[b], ${shp('bands[b]')}, dt, ${A}, ${R});`);
  }
  if (L.source === 'beat') lines.push(`    in${k} = follow(in${k}, beat ? 255 : 0, dt, ${A}, ${R});`);
  else if (L.source === 'level') lines.push(`    in${k} = follow(in${k}, ${shp('level')}, dt, ${A}, ${R});`);
  else lines.push(`    in${k} = follow(in${k}, ${shp(`bandRange(${L.lo}, ${L.hi}, ${L.reduce === 'peak'})`)}, dt, ${A}, ${R});`);
  let trig = 'beat';
  if (L.trigger === 'threshold' && needsTrig(L)) {
    const th = int(L.threshold, 1, 254);
    lines.push(`    bool trig${k} = in${k} >= ${th} && last${k} < ${th};`, `    last${k} = in${k};`);
    trig = `trig${k}`;
  }
  if (L.effect === 'colorshift') lines.push(...seqCode(`sq${k}`, seqOf(L), layerCols(L).length, `in${k}`, trig).upd);
  if (L.effect === 'intensity') lines.push(...seqCode(`sq${k}`, seqOf(L), L.intLevels.length, `in${k}`, trig).upd);
  if (L.effect === 'palmood') lines.push(`    moodUpdate${k}(dt);`);
  if (modOn(L)) {
    lines.push(...seqCode(`is${k}`, intSeqOf(L), L.intLevels.length, `in${k}`, trig).upd);
    lines.push(`    layerScale = levelAt${k}(is${k}Pos);   // brightness pattern`);
  }
  lines.push(`    layer${k}((uint8_t)in${k}, ${trig}, dt);`);
  if (modOn(L)) lines.push(`    layerScale = 255;`);
  return lines.join('\n');
}

function generate(design) {
  const d = normalize(design), g = d.global, layers = d.layers.filter(l => l.enabled);
  const json = JSON.stringify(design);
  const idle = {
    off: '  fill_solid(leds, NUM_LEDS, CRGB::Black);',
    breathe: '  fill_solid(leds, NUM_LEDS, CHSV(160, 255, beatsin8(12, 4, 40)));',
    rainbow: '  for (int i = 0; i < NUM_LEDS; i++) leds[i] = CHSV((uint8_t)((int)gHue + i * 4), 255, 50);',
  }[g.idle];
  const combine = g.trailMs > 0
    ? [`    // Trails: old light fades out over ~${g.trailMs} ms; new light wins where brighter.`,
       `    fadeToBlackBy(leds, NUM_LEDS, 255 - (uint8_t)(255 * exp(-dt / ${flt(g.trailMs)})));`,
       `    for (int i = 0; i < NUM_LEDS; i++) leds[i] |= layerBuf[i];`]
    : [`    for (int i = 0; i < NUM_LEDS; i++) leds[i] = layerBuf[i];`];
  return `// ${ident(d.name)}.ino — generated by LED Audio Designer (led-sim/designer.html)
// Music-reactive FastLED sketch for ESP32. Audio frames come over USB serial from led-audio.exe:
//   led-audio.exe --port COMx --baud ${g.baud}
// The line below stores the design; import this .ino back into the designer to keep editing.
// LEDDESIGN ${json}
#include <FastLED.h>

#define DATA_PIN      ${g.dataPin}
#define NUM_LEDS      ${g.numLeds}
#define LED_TYPE      ${g.ledType}
#define COLOR_ORDER   ${g.colorOrder}
#define BRIGHTNESS    ${g.brightness}
#define MAX_MILLIAMPS ${g.maxMilliamps}
#define FRAME_MS      ${Math.round(1000 / g.fps)}   // ~${g.fps} fps
#define HUE_SPEED     ${flt(g.hueSpeed)}   // colour drift, hue steps per second
#define BAUD          ${g.baud}

#define NUM_BANDS 16
#define FRAME_LEN (2 + NUM_BANDS)   // bytes after the 0xFF start marker

CRGB leds[NUM_LEDS];
CRGB layerBuf[NUM_LEDS];   // this frame's layers, added together

/* ---------------- audio link: frames from led-audio.exe ----------------
   0xFF, level, beat counter, 16 bands (40 Hz .. 16 kHz, bass first). Values 0-254. */
uint8_t level = 0, beatCount = 0, bands[NUM_BANDS];
uint8_t frame[FRAME_LEN];
uint8_t got = 0;
bool inFrame = false;
bool beat = false;   // true for one frame after each detected beat
unsigned long lastFrameMs = 0;

void readAudio() {
  while (Serial.available()) {
    int b = Serial.read();
    if (b == 0xFF) { inFrame = true; got = 0; continue; }
    if (!inFrame) continue;
    frame[got++] = b;
    if (got == FRAME_LEN) {
      inFrame = false;
      level = frame[0];
      if (frame[1] != beatCount) beat = true;
      beatCount = frame[1];
      for (int i = 0; i < NUM_BANDS; i++) bands[i] = frame[2 + i];
      lastFrameMs = millis();
    }
  }
}

/* ---------------- signal shaping ---------------- */
// Average (or loudest) of bands lo..hi.
uint8_t bandRange(int lo, int hi, bool usePeak) {
  int sum = 0, mx = 0;
  for (int i = lo; i <= hi; i++) { sum += bands[i]; if (bands[i] > mx) mx = bands[i]; }
  return usePeak ? mx : sum / (hi - lo + 1);
}

// Noise gate, gain, then response curve (0 linear, 1 punchy, 2 gentle).
uint8_t shape(uint8_t v, uint8_t gate, float gain, int curve) {
  if (v <= gate) return 0;
  float x = (v - gate) * 255.0 / (255 - gate) * gain;
  if (x > 255) x = 255;
  if (curve == 1) x = x * x / 255;
  else if (curve == 2) x = sqrt(x * 255);
  return (uint8_t)x;
}

// Attack/release smoothing with time constants in ms (0 = instant).
float follow(float cur, float target, float dt, float attackMs, float releaseMs) {
  float tau = target > cur ? attackMs : releaseMs;
  if (tau <= 0) return target;
  return cur + (target - cur) * dt / (dt + tau);
}

uint8_t layerScale = 255;   // brightness pattern of the layer being drawn (255 = none)

// Adds colour c at position p of a segment. Mirrored segments grow from the centre out
// (reverse: from the ends in); plain segments run start -> end (reverse: end -> start).
void paint(int start, int len, bool mirror, bool reverse, int p, CRGB c) {
  if (layerScale < 255) c.nscale8(layerScale);
  if (mirror) {
    int half = (len + 1) / 2;
    if (p < 0 || p >= half) return;
    if (reverse) p = half - 1 - p;
    int a = start + half - 1 - p, b = start + len - half + p;
    layerBuf[a] += c;
    if (b != a) layerBuf[b] += c;
  } else {
    if (p < 0 || p >= len) return;
    if (reverse) p = len - 1 - p;
    layerBuf[start + p] += c;
  }
}

float gHue = 0;   // slowly drifting base hue

${layers.map(layerCode).join('\n\n')}

/* ---------------- main ---------------- */
unsigned long lastMs = 0;

void setup() {
  Serial.begin(BAUD);
  FastLED.addLeds<LED_TYPE, DATA_PIN, COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(BRIGHTNESS);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, MAX_MILLIAMPS);
}

void loop() {
  unsigned long frameStart = millis();
  float dt = frameStart - lastMs;
  if (dt > 100) dt = 100;
  lastMs = frameStart;

  beat = false;
  readAudio();
  gHue += HUE_SPEED * dt / 1000.0;
  while (gHue >= 256) gHue -= 256;
  while (gHue < 0) gHue += 256;

  if (frameStart - lastFrameMs > 1000) {
    // No audio frames for a second (led-audio.exe not running?)
  ${idle}
  } else {
    fill_solid(layerBuf, NUM_LEDS, CRGB::Black);
${layers.map(layerInput).join('\n') || '    // (no layers enabled)'}
${combine.join('\n')}
  }
  FastLED.show();

  unsigned long spent = millis() - frameStart;
  if (spent < FRAME_MS) delay(FRAME_MS - spent);
}
`;
}

// Pulls a design back out of a generated .ino (or a .json export).
function parseDesign(text) {
  const m = /^\/\/ LEDDESIGN (.+)$/m.exec(text);
  const d = JSON.parse(m ? m[1] : text);
  if (!d || !d.global || !Array.isArray(d.layers)) throw new Error('not a designer file');
  const base = newDesign();
  return {
    name: d.name || base.name, global: { ...base.global, ...d.global },
    layers: d.layers.map(l => { const L = newLayer(l); L.rand = { on: !(l.rand && l.rand.on === false), groups: { ...RAND_DEFAULT, ...(l.rand && l.rand.groups) } }; return L; }),
  };
}

/* ------------------------------ randomizer ------------------------------ */
function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hsvHex(h, s, v) {   // h in degrees, s/v 0..1
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return toHex([f(5), f(3), f(1)].map(x => x * 255));
}
// A harmonious palette: analogous, complementary or triad hues around a random base.
function randomPalette(rng, n) {
  const R = (a, b) => a + rng() * (b - a);
  n = n || (rng() < 0.2 ? 9 + Math.floor(rng() * 8) : 3 + Math.floor(rng() * 6));
  const base = R(0, 360), scheme = Math.floor(rng() * 3), offs = [[0], [0, 180], [0, 120, 240]][scheme];
  return Array.from({ length: n }, (_, i) => {
    const h = scheme === 0 ? base - 35 + 70 * i / Math.max(1, n - 1) : base + offs[i % offs.length] + R(-15, 15);
    return hsvHex(((h % 360) + 360) % 360, R(0.65, 1), R(0.55, 1));
  });
}
// Re-rolls the ticked groups of a layer's settings; name, start, length and on/off are never touched.
function randomizeLayer(src, rng, groups) {
  const g = { ...RAND_DEFAULT, ...(groups || {}) }, L = JSON.parse(JSON.stringify(src));
  const R = (a, b) => a + rng() * (b - a), I = (a, b) => Math.floor(R(a, b + 1)), pick = a => a[Math.floor(rng() * a.length)];
  const chance = p => rng() < p, step = (v, s) => Math.round(v / s) * s;
  if (g.effect) L.effect = pick(Object.keys(EFFECTS));
  if (g.listen) {
    L.source = chance(0.6) ? 'bands' : chance(0.5) ? 'level' : 'beat';
    const reg = pick([[0, 4], [4, 10], [10, 15], [0, 15]]);
    L.lo = I(reg[0], reg[1] - 1); L.hi = I(L.lo + 1, reg[1]);
    L.reduce = chance(0.6) ? 'avg' : 'peak';
    L.trigger = chance(0.75) ? 'beat' : 'threshold';
    L.threshold = I(90, 200);
  }
  if (L.effect === 'spectrum' && (g.effect || g.listen) && L.hi - L.lo < 3) { L.lo = Math.max(0, L.lo - 2); L.hi = Math.min(15, L.hi + 2); }
  if (g.response) {
    L.gate = I(10, 60); L.gain = step(R(0.8, 2), 0.05); L.curve = pick(Object.keys(CURVES));
    L.attack = chance(0.7) ? 0 : step(R(5, 40), 5); L.release = step(R(60, 600), 10);
  }
  if (g.settings) {
    Object.assign(L, {
      peakHold: chance(0.7), peakFall: I(5, 60), speed: I(20, 200), width: I(0, 4), rate: step(R(30, 400), 5), decay: step(R(80, 800), 10),
      tail: I(4, 24), baseSpeed: I(0, 40), boost: step(R(40, 300), 5), cooling: I(30, 100), sparkBase: I(0, 60), sparkBoost: I(80, 255),
      seqMode: pick(Object.keys(SEQ_MODES)), seqEvery: pick([1, 1, 2, 4]), seqStep: pick([1, 1, 2]), seqFade: step(R(0, 600), 10),
      seqBase: step(R(0.2, 3), 0.1), seqBoost: step(R(0, 8), 0.5), palSpread: step(R(0, 4), 0.5), briFollow: chance(0.5), hardSteps: chance(0.3),
      moodAvg: step(R(1000, 6000), 100), moodHold: I(2, 10), moodFade: step(R(300, 3000), 100),
    });
  }
  if (g.color) {
    Object.assign(L, { color: pick(Object.keys(COLORS)), hue1: I(0, 255), hue2: I(0, 255), sat: I(180, 255), spread: I(1, 12), opacity: I(160, 255) });
  }
  if (g.palette) {
    const rp = () => chance(0.45) ? 'custom' : pick(Object.keys(PALETTE_HEX));
    L.palette = rp();
    L.customPal = randomPalette(rng);
    L.moods = (L.moods || []).map(m => ({ ...m, pal: rp(), colors: randomPalette(rng) }));
  }
  if (g.intensity) {
    L.intOn = L.effect !== 'intensity' && chance(0.35);
    L.intLevels = pick([[255, 0], [255, 120, 60, 120], [255, 0, 0, 0], [255, 60], null]) || Array.from({ length: I(2, 8) }, () => I(0, 255));
    Object.assign(L, { intMode: pick(Object.keys(SEQ_MODES)), intEvery: pick([1, 1, 2, 4]), intStep: 1, intFade: chance(0.5) ? 0 : step(R(20, 300), 10), intBase: step(R(0.5, 6), 0.5), intBoost: step(R(0, 10), 0.5) });
  }
  if (g.placement) { L.mirror = chance(0.5); L.reverse = chance(0.25); }
  return L;
}

// Synthetic 120 BPM groove in led-audio's frame format, for designing without music playing.
function testFrame(t) {
  const beatLen = 0.5, ph = t % beatLen, bar = t % 2;
  const kick = Math.exp(-ph / 0.07);
  const snareT = (t + beatLen) % 1, snare = Math.exp(-snareT / 0.1);
  const hat = Math.exp(-(t % 0.25) / 0.03);
  const melodyC = 7 + 3 * Math.sin(t * 0.9), melody = 0.55 + 0.45 * Math.sin(t * 2.3);
  const f = new Uint8Array(19);
  let sum = 0;
  for (let b = 0; b < 16; b++) {
    let v = kick * Math.max(0, 250 - b * 40) + snare * (b >= 5 && b <= 12 ? 150 : 30) + hat * (b >= 12 ? 210 : 0);
    v += melody * 140 * Math.exp(-((b - melodyC) ** 2) / 3) + 12 + 10 * Math.sin(t * 7 + b * 1.7);
    v *= bar > 1.75 ? 0.4 : 1;   // small dip at the end of each bar
    f[3 + b] = Math.max(0, Math.min(254, Math.round(v)));
    sum += f[3 + b];
  }
  f[0] = 0xFF;
  f[1] = Math.min(254, Math.round(sum / 16 * 1.6));
  f[2] = Math.floor(t / beatLen) % 255;
  return f;
}

window.LEDDesigner = {
  testFrame, BAND_LO_HZ, fmtHz, EFFECTS, SOURCES, CURVES, COLORS, PALETTES, PALETTE_HEX, SEQ_MODES, LED_TYPES, ORDERS, IDLE, PRESETS,
  RAND_GROUPS, RAND_DEFAULT, DEFAULT_PAL, newLayer, newMood, newDesign, normalize, generate, parseDesign, ident, expandPal, layerCols,
  randomPalette, randomizeLayer, mulberry32,
};
})();
