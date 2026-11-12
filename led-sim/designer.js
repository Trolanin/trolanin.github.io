/* LED Audio Designer UI: settings forms, layer stack, live preview, audio monitor, export. */
(function () {
'use strict';
const D = LEDDesigner;
const $ = id => document.getElementById(id);
const preview = $('preview');
const store = {
  get(k, d) { try { const v = localStorage.getItem('ledsim.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ledsim.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const el = (tag, props, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) { if (k.includes('-')) e.setAttribute(k, v); else e[k] = v; }
  for (const k of kids) if (k != null) e.append(k);
  return e;
};

let design = (() => { try { return D.parseDesign(JSON.stringify(store.get('designer', null))); } catch (e) { return D.PRESETS['Bass pulse + treble sparkles'](); } })();
let focus = 0;
let solo = null;   // layer shown alone in the preview; never part of the design or the download
const open = new WeakSet();
if (design.layers[0]) open.add(design.layers[0]);

/* ------------------------------ field specs ------------------------------ */
const HUE_RGB = [[255, 0, 0], [171, 85, 0], [171, 171, 0], [0, 255, 0], [0, 171, 85], [0, 0, 255], [85, 0, 171], [171, 0, 85], [255, 0, 0]];
function hueCss(h, s) {
  const x = (h & 255) / 32, i = Math.floor(x), f = x - i, a = HUE_RGB[i], b = HUE_RGB[i + 1], k = (s === undefined ? 255 : s) / 255;
  const c = a.map((v, j) => Math.round((v + (b[j] - v) * f) * k + 210 * (1 - k)));
  return `rgb(${c.join(',')})`;
}
const HUE_CSS = 'linear-gradient(90deg, #f00 0%, #ab5500 12.5%, #abab00 25%, #0f0 37.5%, #00ab55 50%, #00f 62.5%, #5500ab 75%, #ab0055 87.5%, #f00 100%)';
const stops = (...c) => `linear-gradient(90deg, ${c.join(', ')})`;
const PALETTE_CSS = Object.fromEntries(Object.entries(D.PALETTE_HEX).map(([k, v]) => [k, stops(...v)]));
const colsCss = c => c.length === 1 ? c[0] : stops(...c);
const palCss = (p, custom) => p === 'custom' ? colsCss(custom || D.DEFAULT_PAL) : PALETTE_CSS[p] || HUE_CSS;
function layerCss(L) {
  if (L.effect === 'palmood') return colsCss((L.moods || []).map(m => m.pal === 'custom' ? (m.colors || [])[0] || '#000' : (D.PALETTE_HEX[m.pal] || D.PALETTE_HEX.RainbowColors_p)[4]));
  if (L.color === 'palette' || L.effect === 'colorshift') return palCss(L.palette, L.customPal);
  if (L.effect === 'fire') return PALETTE_CSS.HeatColors_p;
  if (L.color === 'rainbow') return HUE_CSS;
  if (L.color === 'solid') return hueCss(L.hue1, L.sat);
  return stops(...[0, 1, 2, 3, 4].map(j => hueCss(L.hue1 + (L.hue2 - L.hue1) * j / 4, L.sat)));
}
const effectName = L => D.EFFECTS[L.effect].split(' —')[0].replace(' (VU)', '');
const rangeText = L => {
  const a = D.fmtHz(D.BAND_LO_HZ[L.lo]), b = D.fmtHz(D.BAND_LO_HZ[L.hi + 1]);
  return (a.slice(-3) === b.slice(-3) ? a.replace(/ k?Hz$/, '') : a) + '–' + b;
};
const hearsText = L => L.effect === 'spectrum' || L.source === 'bands' ? rangeText(L) : L.source === 'level' ? 'overall loudness' : 'beats';
const notBeat = L => L.effect === 'spectrum' || L.source !== 'beat';
const is = (...e) => L => e.includes(L.effect);

const GLOBAL_FIELDS = [
  { k: 'numLeds', label: 'LEDs', type: 'number', min: 1, max: 1000 },
  { k: 'dataPin', label: 'Data pin (GPIO)', type: 'number', min: 0, max: 48, tip: 'The ESP32 pin wired to the strip\'s data input (DIN).' },
  { k: 'ledType', label: 'LED chip', type: 'select', options: D.LED_TYPES },
  { k: 'colorOrder', label: 'Colour order', type: 'select', options: D.ORDERS, tip: 'If red and green look swapped on the real strip, change this. The preview is not affected.' },
  { k: 'brightness', label: 'Master brightness', type: 'range', min: 1, max: 255, tip: 'Overall brightness of the whole strip, 1-255.' },
  { k: 'maxMilliamps', label: 'Power limit', type: 'range', min: 100, max: 10000, step: 100, unit: 'mA', hardMax: 20000, tip: 'The strip is dimmed automatically so it never draws more than this. Set it to what your power supply can deliver (1000 mA = 1 A).' },
  { k: 'fps', label: 'Frame rate', type: 'range', min: 20, max: 200, step: 5, unit: 'fps', tip: 'How many times per second the strip is redrawn. 100 is smooth; very long strips may need less.' },
  { k: 'trailMs', label: 'Trails', type: 'range', min: 0, max: 1000, step: 10, unit: 'ms', hardMax: 2000, hint: v => +v ? '' : 'off', tip: 'Old light fades out over this time instead of vanishing, leaving streaks behind moving effects. 0 = off.' },
  { k: 'hueSpeed', label: 'Colour drift', type: 'range', min: -100, max: 100, unit: '/s', hardMin: -200, hardMax: 200, tip: 'How fast rainbow and palette colours rotate over time. Negative runs backwards, 0 holds still.' },
  { k: 'idle', label: 'When no audio', type: 'select', options: D.IDLE, tip: 'What the strip shows when led-audio.exe is not sending anything.' },
  { k: 'baud', label: 'Serial baud', type: 'select', options: [115200, 230400, 460800, 921600], note: () => 'led-audio.exe must use the same --baud.' },
];

const seqFx = is('colorshift', 'intensity');
const beatSeq = L => seqFx(L) && L.seqMode === 'beat';
const flowSeq = L => seqFx(L) && L.seqMode === 'flow';
const patOn = L => L.intOn && L.effect !== 'intensity';
const usesTrigger = L => L.effect === 'ripple' || beatSeq(L) || (patOn(L) && L.intMode === 'beat');
const plainColour = L => L.effect !== 'colorshift' && L.effect !== 'palmood';
const stepUnit = L => L.effect === 'intensity' ? 'levels' : 'colours';
const instant = v => +v ? '' : 'instant';
const SEQ_TIP = 'Step on beats: move on to the next one on each trigger. Flow continuously: keep cycling, faster when louder. Loudness picks it: quiet = first, loud = last.';

const LAYER_FIELDS = [
  { sec: 'What it reacts to' },
  { k: 'effect', label: 'Effect', type: 'select', options: D.EFFECTS },
  { k: 'source', label: 'Listen to', type: 'select', options: D.SOURCES, when: L => L.effect !== 'spectrum' },
  { k: 'bands', label: L => L.effect === 'spectrum' ? 'Bands shown' : 'Frequencies', type: 'bands', when: L => L.effect === 'spectrum' || L.source === 'bands' },
  { k: 'reduce', label: 'Read range as', type: 'select', options: { avg: 'Average of the range', peak: 'Loudest band in range' }, tip: 'Average reacts to the whole range together; Loudest reacts if any single band in it is loud (better for wide ranges).', when: L => L.effect !== 'spectrum' && L.source === 'bands' },
  { k: 'trigger', label: L => L.effect === 'ripple' ? 'New ripple on' : 'Step on', type: 'select', options: { beat: 'Each detected beat', threshold: 'Signal crossing threshold' }, when: usesTrigger },
  { k: 'threshold', label: 'Threshold', type: 'range', min: 1, max: 254, tip: 'Triggers each time the signal rises past this level (0-255, compare with the "after response" meter).', when: L => usesTrigger(L) && L.trigger === 'threshold' },
  { sec: 'How it responds' },
  { k: 'gate', label: 'Noise gate', type: 'range', min: 0, max: 200, hardMax: 254, when: notBeat, tip: 'Anything quieter than this is ignored, so hiss and background noise keep the layer dark. It is the red line in the monitor - you can drag it there.' },
  { k: 'gain', label: 'Gain', type: 'range', min: 0.25, max: 4, step: 0.05, unit: '×', hardMin: 0, hardMax: 16, when: notBeat, tip: 'How strongly the layer reacts. Above 1× makes quiet music brighter; below 1× calms it down.' },
  { k: 'curve', label: 'Curve', type: 'select', options: D.CURVES, when: notBeat, tip: 'How brightness follows loudness. Punchy keeps quiet parts dark so hits stand out; Gentle lifts quiet parts.' },
  { k: 'attack', label: 'Attack', type: 'range', min: 0, max: 500, step: 5, unit: 'ms', hardMax: 5000, hint: instant, tip: 'How quickly the layer brightens when the sound gets louder. 0 is instant and snappy; higher values fade in softly.' },
  { k: 'release', label: 'Release', type: 'range', min: 0, max: 2000, step: 10, unit: 'ms', hardMax: 10000, hint: instant, tip: 'How slowly the layer fades after the sound drops. Higher values leave a longer afterglow.' },
  { sec: 'Effect settings', when: L => L.effect !== 'pulse' && L.effect !== 'spectrum' },
  { k: 'peakHold', label: 'Peak dot', type: 'check', text: 'Hold and drop the peak', when: is('meter') },
  { k: 'peakFall', label: 'Peak fall speed', type: 'range', min: 2, max: 100, unit: 'LED/s', hardMax: 200, when: L => L.effect === 'meter' && L.peakHold },
  { k: 'speed', label: 'Ripple speed', type: 'range', min: 10, max: 300, unit: 'LED/s', hardMin: 1, hardMax: 500, when: is('ripple') },
  { k: 'width', label: 'Ripple width', type: 'range', min: 0, max: 6, unit: 'LED', hardMax: 10, tip: 'LEDs lit on each side of the ripple centre (0 = a single LED).', when: is('ripple') },
  { k: 'rate', label: 'Sparkle rate', type: 'range', min: 5, max: 600, step: 5, unit: '/s', hardMin: 1, hardMax: 2000, when: is('sparkle'), note: () => 'At full volume.' },
  { k: 'decay', label: 'Sparkle fade', type: 'range', min: 30, max: 1500, step: 10, unit: 'ms', hardMin: 10, hardMax: 5000, when: is('sparkle') },
  { k: 'speed', label: 'Scroll speed', type: 'range', min: 5, max: 200, unit: 'LED/s', hardMin: 1, hardMax: 500, when: is('scroll') },
  { k: 'baseSpeed', label: 'Idle speed', type: 'range', min: 0, max: 100, unit: 'LED/s', hardMax: 500, when: is('comet') },
  { k: 'boost', label: 'Audio boost', type: 'range', min: 0, max: 400, step: 5, unit: 'LED/s', hardMax: 1000, when: is('comet') },
  { k: 'tail', label: 'Tail length', type: 'range', min: 2, max: 40, unit: 'LED', hardMin: 1, hardMax: 100, when: is('comet') },
  { k: 'cooling', label: 'Cooling', type: 'range', min: 20, max: 120, hardMin: 10, hardMax: 150, when: is('fire'), note: () => 'Higher = shorter flames.' },
  { k: 'sparkBase', label: 'Idle sparks', type: 'range', min: 0, max: 150, hardMax: 255, when: is('fire') },
  { k: 'sparkBoost', label: 'Audio sparks', type: 'range', min: 0, max: 255, when: is('fire') },
  { k: 'seqMode', label: L => L.effect === 'intensity' ? 'Levels change' : 'Colours change', type: 'select', options: D.SEQ_MODES, when: seqFx, tip: SEQ_TIP },
  { k: 'seqEvery', label: 'Every', type: 'range', min: 1, max: 16, unit: 'triggers', hardMax: 64, when: beatSeq },
  { k: 'seqStep', label: 'Step size', type: 'range', min: 1, max: 8, unit: stepUnit, hardMin: 0.1, hardMax: 16, when: beatSeq },
  { k: 'seqFade', label: 'Crossfade', type: 'range', min: 0, max: 2000, step: 10, unit: 'ms', hardMax: 10000, hint: instant, when: beatSeq },
  { k: 'seqBase', label: 'Idle speed', type: 'range', min: 0, max: 10, step: 0.1, unit: L => stepUnit(L) + '/s', hardMax: 100, when: flowSeq },
  { k: 'seqBoost', label: 'Audio boost', type: 'range', min: 0, max: 20, step: 0.5, unit: L => stepUnit(L) + '/s', hardMax: 200, when: flowSeq },
  { k: 'intLevels', label: 'Brightness levels', type: 'levels', when: is('intensity') },
  { k: 'palSpread', label: 'Colours across strip', type: 'range', min: 0, max: 8, step: 0.5, hardMax: 16, when: is('colorshift', 'palmood'), tip: '0 = the whole segment shows one colour at a time; 2 = two colours of the palette spread along it.' },
  { k: 'briFollow', label: 'Brightness', type: 'check', text: 'Follows the music (otherwise always full)', when: is('colorshift', 'palmood') },
  { k: 'moodAvg', label: 'Mood averaging', type: 'range', min: 500, max: 10000, step: 100, unit: 'ms', hardMin: 100, hardMax: 60000, when: is('palmood'), tip: 'Bass, treble and loudness are averaged over about this long before being compared, so one loud hit does not flip the palette.' },
  { k: 'moodHold', label: 'Hold at least', type: 'range', min: 0, max: 30, unit: 's', hardMax: 600, when: is('palmood'), tip: 'After switching, stay on the new palette at least this long.' },
  { k: 'moodFade', label: 'Crossfade', type: 'range', min: 0, max: 5000, step: 50, unit: 'ms', hardMax: 20000, hint: instant, when: is('palmood') },
  { k: 'moods', label: 'Palettes', type: 'moods', when: is('palmood') },
  { sec: 'Colour' },
  { k: 'color', label: 'Colour', type: 'select', options: D.COLORS, when: plainColour, note: L => L.effect === 'fire' ? 'Fire uses heat colours unless this is Palette.' : '' },
  { k: 'hue1', label: L => ({ gradient: 'From hue', value: 'Quiet hue' })[L.color] || 'Hue', type: 'hue', when: L => plainColour(L) && L.effect !== 'fire' && ['solid', 'gradient', 'value'].includes(L.color) },
  { k: 'hue2', label: L => L.color === 'value' ? 'Loud hue' : 'To hue', type: 'hue', when: L => plainColour(L) && L.effect !== 'fire' && ['gradient', 'value'].includes(L.color) },
  { k: 'spread', label: 'Rainbow spread', type: 'range', min: 0, max: 32, hardMax: 64, tip: 'How much the colour changes from one LED to the next. 0 = whole segment one colour.', when: L => plainColour(L) && L.effect !== 'fire' && L.color === 'rainbow' },
  { k: 'palette', label: 'Palette', type: 'select', options: D.PALETTES, swatch: L => palCss(L.palette, L.customPal), when: L => L.effect === 'colorshift' || (plainColour(L) && L.color === 'palette') },
  { k: 'customPal', label: 'Your colours', type: 'palette16', when: L => L.palette === 'custom' && (L.effect === 'colorshift' || (plainColour(L) && L.color === 'palette')) },
  { k: 'hardSteps', label: 'Blending', type: 'check', text: 'Hard steps between colours (no blending)', when: L => !plainColour(L) || L.color === 'palette' },
  { k: 'sat', label: 'Saturation', type: 'range', min: 0, max: 255, tip: '0 is white, 255 is full colour.', when: L => plainColour(L) && L.effect !== 'fire' && L.color !== 'palette' },
  { k: 'opacity', label: 'Layer brightness', type: 'range', min: 0, max: 255, tip: 'How much this layer adds to the mix. Lower it to keep a background layer subtle.' },
  { sec: 'Brightness pattern', when: L => L.effect !== 'intensity' },
  { k: 'intOn', label: 'Pattern', type: 'check', text: 'Step this layer through brightness levels', when: L => L.effect !== 'intensity', tip: 'Multiplies this layer\'s brightness by a sequence of levels you draw (e.g. 255, 0 = strobe on the beat).' },
  { k: 'intLevels', label: 'Levels', type: 'levels', when: patOn },
  { k: 'intMode', label: 'Levels change', type: 'select', options: D.SEQ_MODES, when: patOn, tip: SEQ_TIP },
  { k: 'intEvery', label: 'Every', type: 'range', min: 1, max: 16, unit: 'triggers', hardMax: 64, when: L => patOn(L) && L.intMode === 'beat' },
  { k: 'intStep', label: 'Step size', type: 'range', min: 1, max: 8, unit: 'levels', hardMin: 0.1, hardMax: 16, when: L => patOn(L) && L.intMode === 'beat' },
  { k: 'intFade', label: 'Crossfade', type: 'range', min: 0, max: 2000, step: 10, unit: 'ms', hardMax: 10000, hint: instant, when: L => patOn(L) && L.intMode === 'beat' },
  { k: 'intBase', label: 'Idle speed', type: 'range', min: 0, max: 20, step: 0.5, unit: 'levels/s', hardMax: 100, when: L => patOn(L) && L.intMode === 'flow' },
  { k: 'intBoost', label: 'Audio boost', type: 'range', min: 0, max: 40, step: 0.5, unit: 'levels/s', hardMax: 200, when: L => patOn(L) && L.intMode === 'flow' },
  { sec: 'Where on the strip' },
  { k: 'start', label: 'First LED', type: 'number', min: 0, max: () => design.global.numLeds - 1 },
  { k: 'length', label: 'Number of LEDs', type: 'number', min: 1, max: L => design.global.numLeds - L.start },
  { k: 'mirror', label: 'Mirror', type: 'check', text: 'Grow from the centre outwards' },
  { k: 'reverse', label: 'Reverse', type: 'check', text: 'Run the other way' },
];

/* -------------------------------- forms -------------------------------- */
const resolve = (x, obj) => typeof x === 'function' ? x(obj) : x;

function renderForm(box, fields, obj, onStructural, onLive) {
  const defaults = obj === design.global ? D.newDesign().global : D.newLayer();
  box.innerHTML = '';
  for (const f of fields) {
    if (f.when && !f.when(obj)) continue;
    if (f.sec) { box.append(el('div', { className: 'sec', textContent: f.sec })); continue; }
    box.append(field(f, obj, onStructural, onLive, defaults[f.k]));
    const note = f.note && f.note(obj);
    if (note) box.append(el('div', { className: 'note', textContent: note }));
  }
}

function field(f, obj, onStructural, onLive, def) {
  const id = 'f' + Math.random().toString(36).slice(2);
  const label = el('label', { htmlFor: id, textContent: resolve(f.label, obj) });
  if (f.tip) label.title = f.tip;
  const row = el('div', { className: 'row' });
  const changed = () => { onStructural(); };
  if (f.type === 'select') {
    const opts = Array.isArray(f.options) ? Object.fromEntries(f.options.map(o => [o, String(o)])) : f.options;
    const s = el('select', { id });
    for (const [v, t] of Object.entries(opts)) s.append(el('option', { value: v, textContent: t }));
    s.value = String(obj[f.k]);
    s.onchange = () => { obj[f.k] = typeof obj[f.k] === 'number' ? +s.value : s.value; changed(); };
    row.className = 'row wide';
    const sw = f.swatch && f.swatch(obj);
    row.append(label, sw ? el('div', { className: 'pair' }, s, el('span', { className: 'palbar', style: 'background:' + sw })) : s);
  } else if (f.type === 'range' || f.type === 'hue') {
    const lo = f.type === 'hue' ? 0 : f.min, hi = f.type === 'hue' ? 255 : f.max, step = f.step || 1;
    const hardLo = f.hardMin !== undefined ? f.hardMin : lo, hardHi = f.hardMax !== undefined ? f.hardMax : hi;
    const r = el('input', { id, type: 'range', min: lo, max: hi, step, value: obj[f.k] });
    // The box takes exact values, including ones beyond the slider's reach (up to hardMin/hardMax).
    const box = el('input', { type: 'number', className: 'num', min: hardLo, max: hardHi, step: 'any', value: obj[f.k], 'aria-label': resolve(f.label, obj) + ' value' });
    const unit = el('span', { className: 'unit' });
    const show = () => {
      const v = obj[f.k];
      if (document.activeElement !== box) box.value = v;
      unit.innerHTML = '';
      if (f.type === 'hue') unit.append(el('span', { className: 'swatch', style: `background:${hueCss(v, obj.sat)}` }));
      else unit.textContent = (f.hint && f.hint(v)) || resolve(f.unit, obj) || '';
    };
    if (f.type === 'hue') r.className = 'hue';
    r.oninput = () => { obj[f.k] = +r.value; show(); update(id); if (onLive) onLive(); };
    box.onchange = () => {
      const v = parseFloat(box.value);
      if (!Number.isFinite(v)) { box.value = obj[f.k]; return; }
      obj[f.k] = +Math.max(hardLo, Math.min(hardHi, v)).toFixed(3);
      r.value = obj[f.k]; box.value = obj[f.k];
      show(); update(); if (onLive) onLive();
    };
    box.onkeydown = (e) => { if (e.key === 'Enter') box.blur(); };
    if (def !== undefined) {
      r.title = 'Double-click to reset to ' + def;
      r.ondblclick = () => { r.value = def; r.oninput(); };
    }
    show();
    row.append(label, r, el('span', { className: 'val' }, box, unit));
  } else if (f.type === 'palette16') {
    row.className = 'row block';
    row.append(label, paletteEditor(obj, f.k, onLive));
  } else if (f.type === 'levels') {
    row.className = 'row block';
    row.append(label, levelsEditor(obj, f.k, onLive));
  } else if (f.type === 'moods') {
    row.className = 'row block';
    row.append(label, moodsEditor(obj, onStructural));
  } else if (f.type === 'number') {
    const n = el('input', { id, type: 'number', min: resolve(f.min, obj), max: resolve(f.max, obj), value: obj[f.k] });
    n.onchange = () => {
      const lo = resolve(f.min, obj), hi = resolve(f.max, obj);
      const v = Math.max(lo, Math.min(hi, Math.round(+n.value || 0)));
      const old = obj[f.k];
      obj[f.k] = v;
      if (obj === design.global && f.k === 'numLeds') fitLayers(old, v);
      changed();
    };
    row.className = 'row wide'; row.append(label, n);
  } else if (f.type === 'check') {
    const c = el('input', { id, type: 'checkbox', checked: !!obj[f.k] });
    c.onchange = () => { obj[f.k] = c.checked; changed(); };
    row.className = 'row wide';
    row.append(label, el('label', { className: 'hint', style: 'display:flex;gap:8px;align-items:center;color:var(--text)' }, c, f.text || ''));
  } else if (f.type === 'bands') {
    const lo = el('select', { id, 'aria-label': 'lowest band' }), hi = el('select', { 'aria-label': 'highest band' });
    for (let b = 0; b < 16; b++) {
      lo.append(el('option', { value: b, textContent: 'from ' + D.fmtHz(D.BAND_LO_HZ[b]) }));
      hi.append(el('option', { value: b, textContent: 'to ' + D.fmtHz(D.BAND_LO_HZ[b + 1]) }));
    }
    lo.value = obj.lo; hi.value = obj.hi;
    lo.onchange = () => { obj.lo = +lo.value; if (obj.hi < obj.lo) obj.hi = obj.lo; changed(); };
    hi.onchange = () => { obj.hi = +hi.value; if (obj.lo > obj.hi) obj.lo = obj.hi; changed(); };
    row.className = 'row wide'; row.append(label, el('div', { className: 'pair' }, lo, hi));
  }
  return row;
}

// Keep layers that covered the whole strip covering it after the LED count changes.
function fitLayers(oldN, newN) {
  for (const L of design.layers) {
    if (L.start === 0 && L.length === oldN) L.length = newN;
    L.start = Math.min(L.start, newN - 1);
    L.length = Math.max(1, Math.min(L.length, newN - L.start));
  }
}

/* --------------------------- colour helpers --------------------------- */
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function hexHsv(h) {
  const [r, g, b] = hexRgb(h).map(v => v / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  let hue = 0;
  if (d) hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hue * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
function hsvHex(h, s, v) {
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return rgbHex([f(5), f(3), f(1)].map(x => x * 255));
}
let dragSeq = 0;
const palSel = new WeakMap();   // selected colour per palette owner (layer or mood entry)

// 1-16 colour chips + colour wheel + brightness + hex; edits obj[key] (an array of '#rrggbb').
function paletteEditor(obj, key, onLive) {
  const cols = () => obj[key];
  let sel = Math.min(palSel.get(obj) || 0, cols().length - 1), hs = null, dragging = false, tag = '';
  const chips = el('div', { className: 'pal-sw' });
  const count = el('span', { className: 'hint' });
  const wheel = el('canvas', { className: 'wheel', width: 280, height: 280, title: 'Click or drag to set the selected colour', 'aria-label': 'colour wheel' });
  const vRange = el('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'colour brightness' });
  const vBox = el('input', { type: 'number', className: 'num', min: 0, max: 100, step: 1, 'aria-label': 'colour brightness percent' });
  const hex = el('input', { type: 'text', className: 'hex', maxLength: 7, spellcheck: false, 'aria-label': 'hex colour' });
  const fill = el('select', { 'aria-label': 'fill from a built-in palette' }, el('option', { value: '', textContent: 'Fill from…' }),
    ...Object.keys(D.PALETTE_HEX).map(k => el('option', { value: k, textContent: D.PALETTES[k] })));
  const grad = el('button', { className: 'btn small', textContent: 'Gradient', title: 'Blend evenly from the first colour to the last' });
  const dice = el('button', { className: 'btn small', textContent: '🎲', title: 'Random matching colours (same number of colours)' });
  const changed = (t) => { if (onLive) onLive(); update(t); };
  const select = (i) => { sel = i; palSel.set(obj, i); hs = null; paint(); };
  const setCol = (c, t) => { obj[key][sel] = c; paint(); changed(t); };

  function paint() {
    chips.innerHTML = '';
    cols().forEach((c, i) => {
      const b = el('button', { className: 'pal-chip' + (i === sel ? ' sel' : ''), title: `Colour ${i + 1}: ${c} (drag to reorder)`, draggable: true, 'aria-label': `colour ${i + 1}, ${c}` });
      b.style.background = c;
      b.onclick = () => select(i);
      b.ondragstart = (e) => e.dataTransfer.setData('text/plain', String(i));
      b.ondragover = (e) => e.preventDefault();
      b.ondrop = (e) => {
        e.preventDefault();
        const from = +e.dataTransfer.getData('text/plain');
        if (!Number.isInteger(from) || from === i) return;
        const a = cols(), [moved] = a.splice(from, 1);
        a.splice(i, 0, moved);
        select(i); changed();
      };
      chips.append(b);
    });
    const add = el('button', { className: 'btn icon', textContent: '+', title: 'Add a colour after the selected one (up to 16)', disabled: cols().length >= 16 });
    add.onclick = () => { const a = cols(), [h, s, v] = hexHsv(a[sel]); a.splice(sel + 1, 0, hsvHex((h + 30) % 360, s, v || 1)); select(sel + 1); changed(); };
    const del = el('button', { className: 'btn icon', textContent: '×', title: 'Remove the selected colour', disabled: cols().length <= 1 });
    del.onclick = () => { const a = cols(); a.splice(sel, 1); select(Math.min(sel, a.length - 1)); changed(); };
    chips.append(add, del, count);
    count.textContent = cols().length + ' / 16';
    const c = cols()[sel], [h, s, v] = hexHsv(c);
    if (v > 0.02 && !hs) hs = [h, s];
    vRange.value = Math.round(v * 100);
    if (document.activeElement !== vBox) vBox.value = Math.round(v * 100);
    if (document.activeElement !== hex) hex.value = c;
    drawWheel(v);
  }
  let discV = -1, disc = null;
  function drawWheel(v) {
    const g = wheel.getContext('2d'), W = wheel.width, R = W / 2 - 4;
    if (discV !== v) {
      disc = g.createImageData(W, W);
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const dx = x - W / 2, dy = y - W / 2, r = Math.hypot(dx, dy) / R, o = (y * W + x) * 4;
        if (r > 1) continue;
        const [cr, cg, cb] = hexRgb(hsvHex((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, r, Math.max(v, 0.08)));
        disc.data[o] = cr; disc.data[o + 1] = cg; disc.data[o + 2] = cb; disc.data[o + 3] = r > 0.985 ? 255 * (1 - r) / 0.015 : 255;
      }
      discV = v;
    }
    g.putImageData(disc, 0, 0);
    cols().forEach((c, i) => {
      const [h, s] = i === sel && hs ? hs : hexHsv(c), a = h * Math.PI / 180;
      g.beginPath(); g.arc(W / 2 + Math.cos(a) * s * R, W / 2 + Math.sin(a) * s * R, i === sel ? 11 : 6, 0, Math.PI * 2);
      g.fillStyle = c; g.fill(); g.lineWidth = i === sel ? 4 : 2; g.strokeStyle = i === sel ? '#fff' : '#000a'; g.stroke();
    });
  }
  const pick = (e) => {
    const b = wheel.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * 2 - 1, y = (e.clientY - b.top) / b.height * 2 - 1;
    const s = Math.min(1, Math.hypot(x, y) / (1 - 8 / wheel.width)), h = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    hs = [h, s];
    const v = vRange.value / 100;
    setCol(hsvHex(h, s, v < 0.05 ? 1 : v), tag);
  };
  wheel.onpointerdown = (e) => { e.preventDefault(); try { wheel.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } dragging = true; tag = 'wheel' + (++dragSeq); pick(e); };
  wheel.onpointermove = (e) => { if (dragging) pick(e); };
  wheel.onpointerup = wheel.onpointercancel = () => { dragging = false; };
  const setV = (pct, t) => {
    const [h, s] = hs || hexHsv(cols()[sel]);
    setCol(hsvHex(h, s, Math.max(0, Math.min(100, pct)) / 100), t);
  };
  vRange.oninput = () => setV(+vRange.value, 'val' + sel);
  vBox.onchange = () => { if (Number.isFinite(+vBox.value)) setV(+vBox.value); };
  hex.onchange = () => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.value.trim());
    if (!m) { hex.value = cols()[sel]; return; }
    hs = null; setCol('#' + m[1].toLowerCase());
  };
  for (const inp of [vBox, hex]) inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
  fill.onchange = () => { if (!fill.value) return; obj[key] = D.PALETTE_HEX[fill.value].slice(); fill.value = ''; select(0); changed(); };
  grad.onclick = () => {
    const a = cols();
    if (a.length < 3) { toast('Add at least three colours, then Gradient fills the ones between the first and last'); return; }
    const p = hexRgb(a[0]), q = hexRgb(a[a.length - 1]);
    for (let i = 1; i < a.length - 1; i++) a[i] = rgbHex(p.map((v, j) => v + (q[j] - v) * i / (a.length - 1)));
    paint(); changed();
  };
  dice.onclick = () => { obj[key] = D.randomPalette(Math.random, cols().length > 1 ? cols().length : undefined); select(0); changed(); };
  paint();
  return el('div', { className: 'paled' }, chips,
    el('div', { className: 'pal-body' }, wheel,
      el('div', { className: 'pal-side' },
        el('label', { className: 'line' }, el('span', { className: 'hint', textContent: 'Brightness' }), vRange, vBox, el('span', { className: 'unit', textContent: '%' })),
        el('label', { className: 'line' }, el('span', { className: 'hint', textContent: 'Hex' }), hex),
        el('div', { className: 'line' }, fill, grad, dice))));
}

const LEVEL_PRESETS = { 'Strobe': [255, 0], 'Pulse 4': [255, 120, 60, 120], 'Chase': [255, 0, 0, 0], 'Ramp up': [40, 100, 170, 255], 'Breathe': [60, 140, 255, 140], 'Accent every 4th': [255, 90, 90, 90] };

// Bar chart of 1-16 brightness levels; drag a bar (or across bars) to set them.
function levelsEditor(obj, key, onLive) {
  const lv = () => obj[key];
  let sel = 0, dragging = false, tag = '';
  const cv = el('canvas', { className: 'levels', title: 'Drag bars up or down to set each brightness level', 'aria-label': 'brightness levels' });
  const box = el('input', { type: 'number', className: 'num', min: 0, max: 255, step: 1, 'aria-label': 'selected level value' });
  const which = el('span', { className: 'hint' });
  const presets = el('select', { 'aria-label': 'level presets' }, el('option', { value: '', textContent: 'Patterns…' }),
    ...Object.keys(LEVEL_PRESETS).map(k => el('option', { value: k, textContent: `${k} (${LEVEL_PRESETS[k].join(', ')})` })));
  const add = el('button', { className: 'btn icon', textContent: '+', title: 'Add a level after the selected one (up to 16)' });
  const del = el('button', { className: 'btn icon', textContent: '×', title: 'Remove the selected level' });
  const changed = (t) => { if (onLive) onLive(); update(t); };
  function draw() {
    const W = Math.max(60, cv.clientWidth), H = cv.clientHeight || 72, dpr = window.devicePixelRatio || 1, a = lv(), n = a.length, bw = W / n;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = '10px ' + getComputedStyle(document.documentElement).getPropertyValue('--mono');
    g.textAlign = 'center';
    // Bars live between y=14 (255) and H-6 (0); the bottom strip snaps to 0.
    g.fillStyle = '#2a2f3b'; g.fillRect(0, H - 6, W, 1);
    a.forEach((v, i) => {
      const h = (H - 20) * v / 255;
      g.fillStyle = i === sel ? '#35d6a4' : '#4a5266';
      g.fillRect(i * bw + 2, H - 6 - h, bw - 4, h);
      g.fillStyle = '#aab3c5';
      if (bw > 18) g.fillText(String(v), i * bw + bw / 2, Math.max(10, H - 6 - h - 3));
    });
    add.disabled = n >= 16; del.disabled = n <= 1;
    which.textContent = `Level ${sel + 1} of ${n}`;
    if (document.activeElement !== box) box.value = a[sel];
  }
  const at = (e) => {
    const b = cv.getBoundingClientRect(), a = lv();
    const i = Math.max(0, Math.min(a.length - 1, Math.floor((e.clientX - b.left) / b.width * a.length)));
    const v = Math.round(Math.max(0, Math.min(1, 1 - (e.clientY - b.top - 14) / (b.height - 20))) * 255);
    sel = i; a[i] = v; draw(); changed(tag);
  };
  cv.onpointerdown = (e) => { e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } dragging = true; tag = 'lev' + (++dragSeq); at(e); };
  cv.onpointermove = (e) => { if (dragging) at(e); };
  cv.onpointerup = cv.onpointercancel = () => { dragging = false; };
  box.onchange = () => { const v = Math.round(+box.value); if (!Number.isFinite(v)) { draw(); return; } lv()[sel] = Math.max(0, Math.min(255, v)); draw(); changed(); };
  box.onkeydown = (e) => { if (e.key === 'Enter') box.blur(); };
  add.onclick = () => { const a = lv(); if (a.length >= 16) return; a.splice(sel + 1, 0, a[sel]); sel++; draw(); changed(); };
  del.onclick = () => { const a = lv(); if (a.length <= 1) return; a.splice(sel, 1); sel = Math.min(sel, a.length - 1); draw(); changed(); };
  presets.onchange = () => { if (!presets.value) return; obj[key] = LEVEL_PRESETS[presets.value].slice(); presets.value = ''; sel = 0; draw(); changed(); };
  new ResizeObserver(draw).observe(cv);
  return el('div', { className: 'leveled' }, cv,
    el('div', { className: 'line' }, which, box, el('span', { className: 'unit', textContent: '/ 255' }), add, del, presets));
}

/* ---------------- mood palettes: live readings mirror the sketch's maths ---------------- */
const moodState = new WeakMap();
const inRange = (v, r, max) => (r[0] <= 0 || v >= r[0]) && (r[1] >= max || v <= r[1]);
function moodStep(L, f, dt, beat) {
  let s = moodState.get(L);
  if (!s) { s = { bass: 0, treb: 0, loud: 0, bpm: 0, beatT: 0, cur: -1, held: 0 }; moodState.set(L, s); }
  const k = dt / (dt + Math.max(100, +L.moodAvg || 3000));
  s.bass += (rangeOf(f, 0, 3, false) - s.bass) * k;
  s.treb += (rangeOf(f, 11, 15, false) - s.treb) * k;
  s.loud += (f[1] - s.loud) * k;
  if (beat) {
    const now = performance.now(), iv = now - s.beatT;
    s.beatT = now;
    if (iv >= 250 && iv <= 1500) s.bpm = s.bpm <= 0 ? 60000 / iv : s.bpm + (60000 / iv - s.bpm) * 0.25;
  }
  s.held += dt;
  const want = L.moods.findIndex(m => inRange(s.bpm, m.bpm, 300) && inRange(s.bass, m.bass, 255) && inRange(s.treb, m.treble, 255) && inRange(s.loud, m.loud, 255));
  if (s.cur < 0 || s.cur >= L.moods.length) { s.cur = want < 0 ? 0 : want; s.held = 0; }
  else if (want >= 0 && want !== s.cur && s.held >= (+L.moodHold || 0) * 1000) { s.cur = want; s.held = 0; }
}
const MOOD_KEYS = [['bpm', 'BPM', 300, 'bpm'], ['bass', 'Bass', 255, 'bass'], ['treble', 'Treble', 255, 'treb'], ['loud', 'Loudness', 255, 'loud']];
const moodLive = [];   // { L, j, card, now: { key: el } } for open mood editors

function moodsEditor(L, onStructural) {
  const wrap = el('div', { className: 'moods' });
  wrap.append(el('div', { className: 'note', textContent: 'From the top, the first palette whose conditions all match the music is shown. A full range (BPM 0–300, others 0–255) means "any". Green numbers are the music right now.' }));
  L.moods.forEach((m, j) => {
    const pal = el('select', { 'aria-label': `palette ${j + 1}` }, ...Object.entries(D.PALETTES).map(([k, t]) => el('option', { value: k, textContent: t })));
    pal.value = m.pal;
    pal.onchange = () => { m.pal = pal.value; if (!Array.isArray(m.colors) || !m.colors.length) m.colors = D.DEFAULT_PAL.slice(); onStructural(); };
    const bar = el('span', { className: 'palbar', style: 'background:' + palCss(m.pal, m.colors) });
    const mini = (t, title, fn, dis) => { const b = el('button', { className: 'btn icon', textContent: t, title, 'aria-label': title, disabled: !!dis }); b.onclick = fn; return b; };
    const card = el('div', { className: 'mood' });
    card.append(el('div', { className: 'mood-head' }, el('b', { textContent: (j + 1) + '.' }), pal, bar,
      mini('↑', 'Check this palette earlier', () => { [L.moods[j - 1], L.moods[j]] = [L.moods[j], L.moods[j - 1]]; onStructural(); }, j === 0),
      mini('↓', 'Check this palette later', () => { [L.moods[j + 1], L.moods[j]] = [L.moods[j], L.moods[j + 1]]; onStructural(); }, j === L.moods.length - 1),
      mini('✕', 'Remove this palette', () => { L.moods.splice(j, 1); onStructural(); }, L.moods.length <= 1)));
    if (m.pal === 'custom') card.append(paletteEditor(m, 'colors', () => { bar.style.background = palCss(m.pal, m.colors); }));
    const now = {};
    for (const [k, name, max] of MOOD_KEYS) {
      const r = m[k] = Array.isArray(m[k]) ? m[k] : [0, max];
      const lo = el('input', { type: 'number', min: 0, max, step: 1, value: r[0], 'aria-label': `${name} minimum` });
      const hi = el('input', { type: 'number', min: 0, max, step: 1, value: r[1], 'aria-label': `${name} maximum` });
      const set = () => {
        let a = Math.round(+lo.value), b = Math.round(+hi.value);
        a = Number.isFinite(a) ? Math.max(0, Math.min(max, a)) : 0; b = Number.isFinite(b) ? Math.max(0, Math.min(max, b)) : max;
        m[k] = [Math.min(a, b), Math.max(a, b)]; lo.value = m[k][0]; hi.value = m[k][1]; update();
      };
      lo.onchange = hi.onchange = set;
      for (const inp of [lo, hi]) inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
      now[k] = el('span', { className: 'now' });
      card.append(el('div', { className: 'cond' }, el('span', { textContent: name }), lo, el('span', { textContent: 'to' }), hi, now[k]));
    }
    moodLive.push({ L, j, card, now });
    wrap.append(card);
  });
  const add = el('button', { className: 'btn small', textContent: '+ Add palette', disabled: L.moods.length >= 8 });
  add.onclick = () => { L.moods.push(D.newMood('RainbowColors_p')); onStructural(); };
  wrap.append(add);
  return wrap;
}
setInterval(() => {
  for (let i = moodLive.length - 1; i >= 0; i--) {
    const e = moodLive[i];
    if (!e.card.isConnected) { moodLive.splice(i, 1); continue; }
    const s = moodState.get(e.L);
    if (!s) continue;
    e.card.classList.toggle('active', s.cur === e.j);
    for (const [k, , , sk] of MOOD_KEYS) e.now[k].textContent = 'now ' + Math.round(s[sk]);
  }
}, 250);

/* -------------------------------- layers -------------------------------- */
function renderLayers() {
  const box = $('layers');
  box.innerHTML = '';
  if (!design.layers.length) {
    const pick = el('button', { className: 'btn small', textContent: 'Start from a preset' });
    pick.onclick = () => { const p = $('preset'); p.focus(); try { p.showPicker(); } catch (e) { /* older browser: focus is enough */ } };
    const add = el('button', { className: 'btn small', textContent: '+ Add a layer' });
    add.onclick = addLayer;
    box.append(el('div', { className: 'empty' },
      el('div', { textContent: 'No layers yet, so the strip stays dark. A layer is one effect reacting to one part of the music.' }),
      el('div', { className: 'empty-acts' }, add, pick)));
  }
  design.layers.forEach((L, i) => box.append(layerCard(L, i)));
}

function setFocus(i) {
  if (focus === i) return;
  focus = i;
  for (const [j, c] of [...$('layers').querySelectorAll('.layer')].entries()) c.classList.toggle('focus', j === i);
}

function layerCard(L, i) {
  const card = el('div', { className: 'layer' + (i === focus ? ' focus' : '') + (L.enabled ? '' : ' off') + (solo === L ? ' solo' : '') });
  const on = el('input', { type: 'checkbox', checked: L.enabled, title: 'Layer on/off (off layers are left out of the sketch)', 'aria-label': 'layer on' });
  on.onchange = () => { L.enabled = on.checked; renderLayers(); update(); };
  const name = el('input', { type: 'text', value: L.name, spellcheck: false, 'aria-label': 'layer name' });
  name.oninput = () => { L.name = name.value; update('name' + i); };
  const btn = (txt, title, fn) => { const b = el('button', { className: 'btn icon', textContent: txt, title, 'aria-label': title }); b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };
  const move = d => { const j = i + d; if (j < 0 || j >= design.layers.length) return; [design.layers[i], design.layers[j]] = [design.layers[j], design.layers[i]]; focus = j; renderLayers(); update(); };
  const sum = el('span', { className: 'sum' });
  const refreshHead = () => {
    sum.innerHTML = '';
    sum.append(el('span', { className: 'swatch', style: 'background:' + layerCss(L) }), effectName(L) + ' · ' + hearsText(L));
    sum.title = `${effectName(L)}, reacting to ${hearsText(L)}`;
  };
  refreshHead();
  const soloBtn = btn('Solo', 'Solo: preview only this layer (the downloaded sketch is not affected)', () => { solo = solo === L ? null : L; focus = i; renderLayers(); regen(); });
  soloBtn.classList.add('solo-btn');
  soloBtn.setAttribute('aria-pressed', String(solo === L));
  const toggle = () => { if (open.has(L)) open.delete(L); else open.add(L); focus = i; noteUI(); renderLayers(); };
  const chev = btn(open.has(L) ? '▾' : '▸', 'Show / hide settings', () => toggle());
  chev.setAttribute('aria-expanded', String(open.has(L)));
  const locked = !(L.rand && L.rand.on);
  const dice = btn('🎲', locked ? 'Randomizing is disabled for this layer (change it in ▾)' : 'Randomize this layer\'s settings (choose which in ▾)', () => randomize(L));
  dice.classList.add('dice');
  dice.classList.toggle('locked', locked);
  const more = btn('▾', 'Randomize options', () => randDrop(L, i, more));
  more.classList.add('rand-more');
  const head = el('div', { className: 'lhead' },
    on, name, sum,
    el('span', { className: 'acts' },
      soloBtn,
      btn('↑', 'Move up (drawn earlier)', () => move(-1)),
      btn('↓', 'Move down', () => move(1)),
      btn('⧉', 'Duplicate', () => { const c = D.newLayer(JSON.parse(JSON.stringify(L))); c.name += ' copy'; design.layers.splice(i + 1, 0, c); open.add(c); focus = i + 1; renderLayers(); update(); }),
      btn('✕', 'Delete', () => {
        design.layers.splice(i, 1);
        focus = Math.max(0, Math.min(focus > i ? focus - 1 : focus, design.layers.length - 1));
        renderLayers(); update();
        toast(`Deleted layer "${L.name}"`, true);
      })),
    el('span', { className: 'randbox' }, dice, more),
    chev);
  head.onclick = (e) => { if (e.target === head || e.target.closest('.sum')) toggle(); };
  card.addEventListener('pointerdown', () => setFocus(i));
  card.addEventListener('focusin', () => setFocus(i));
  card.append(head);
  if (open.has(L)) {
    const form = el('div', { className: 'form' });
    const rerender = () => { renderForm(form, LAYER_FIELDS, L, rerender, refreshHead); refreshHead(); update(); };
    renderForm(form, LAYER_FIELDS, L, rerender, refreshHead);
    card.append(form);
  }
  return card;
}

/* ----------------------------- randomize ----------------------------- */
const randOf = L => (L.rand = L.rand && typeof L.rand === 'object' ? L.rand : { on: true, groups: { ...D.RAND_DEFAULT } });
function randomize(L) {
  const r = randOf(L);
  if (!r.on) { toast(`Randomizing is disabled for "${L.name}". Enable it in the ▾ menu next to 🎲.`); return; }
  if (!Object.values({ ...D.RAND_DEFAULT, ...r.groups }).some(Boolean)) { toast('Tick at least one group in the ▾ menu to randomize.'); return; }
  Object.assign(L, D.randomizeLayer(L, Math.random, r.groups));
  renderLayers(); update();
  toast(`Randomized "${L.name}"`, true);
}
let openDrop = null;
function closeDrop() { if (openDrop) { openDrop.remove(); openDrop = null; } }
document.addEventListener('pointerdown', (e) => { if (openDrop && !openDrop.contains(e.target) && !e.target.closest('.rand-more')) closeDrop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrop(); });
function randDrop(L, i, anchor) {
  if (openDrop && openDrop.dataset.layer === String(i)) { closeDrop(); return; }
  closeDrop();
  const r = randOf(L);
  r.groups = { ...D.RAND_DEFAULT, ...r.groups };
  const box = el('div', { className: 'rand-drop', role: 'dialog', 'aria-label': `Randomize options for ${L.name}` });
  box.dataset.layer = String(i);
  const master = el('select', { 'aria-label': 'randomizing enabled' },
    el('option', { value: 'on', textContent: 'Enabled' }), el('option', { value: 'off', textContent: 'Disabled (safeguard)' }));
  master.value = r.on ? 'on' : 'off';
  const checks = [];
  const sync = () => { for (const [c, lab] of checks) { c.disabled = !r.on; lab.classList.toggle('dis', !r.on); } go.disabled = !r.on; };
  const go = el('button', { className: 'btn small primary', textContent: '🎲 Randomize now' });
  go.onclick = () => randomize(L);
  master.onchange = () => { r.on = master.value === 'on'; sync(); renderLayers(); update(); };
  box.append(el('div', { className: 'rd-row' }, el('b', { textContent: 'Randomize' }), master),
    el('div', { className: 'hint', textContent: 'Settings 🎲 may change (unticked ones stay exactly as they are):' }));
  for (const [k, t] of Object.entries(D.RAND_GROUPS)) {
    const c = el('input', { type: 'checkbox', checked: !!r.groups[k] });
    const lab = el('label', {}, c, t);
    c.onchange = () => { r.groups[k] = c.checked; update(); };
    checks.push([c, lab]);
    box.append(lab);
  }
  box.append(el('div', { className: 'hint', textContent: 'Name, first LED and length are never changed.' }), go);
  sync();
  document.body.append(box);
  const ar = anchor.getBoundingClientRect();
  if (ar.top < 60 || ar.bottom > window.innerHeight - 300) anchor.scrollIntoView({ block: 'center' });
  const b = anchor.getBoundingClientRect();
  box.style.left = window.scrollX + Math.max(8, Math.min(window.innerWidth - box.offsetWidth - 8, b.right - box.offsetWidth)) + 'px';
  box.style.top = window.scrollY + b.bottom + 4 + 'px';
  openDrop = box;
}

function renderGlobal() {
  const rerender = () => { renderGlobal(); renderLayers(); update(); };
  renderForm($('global'), GLOBAL_FIELDS, design.global, rerender);
  syncBar();
}

/* ------------------------- preview bar: shape + count ------------------------- */
function syncBar() {
  const g = design.global;
  $('shape').value = g.shape; $('cols').value = g.cols; $('cols-wrap').hidden = g.shape !== 'matrix';
  if (document.activeElement !== $('nled')) $('nled').value = g.numLeds;
  $('nled-r').value = Math.min(300, g.numLeds);
}
function sendLayout() {
  if (preview.contentWindow) preview.contentWindow.postMessage({ type: 'layout', layout: design.global.shape, cols: design.global.cols }, '*');
  fitPreview();
}
function setCount(v) {
  const g = design.global, n = Math.max(1, Math.min(1000, Math.round(+v) || 1));
  if (n === g.numLeds) return;
  fitLayers(g.numLeds, n);
  g.numLeds = n;
  renderGlobal(); renderLayers(); update('numLeds');
}
$('shape').onchange = () => { design.global.shape = $('shape').value; syncBar(); sendLayout(); update(); };
$('cols').onchange = () => { design.global.cols = Math.max(1, Math.min(120, Math.round(+$('cols').value) || 10)); syncBar(); sendLayout(); update(); };
$('nled-r').oninput = () => setCount($('nled-r').value);
$('nled').onchange = () => setCount($('nled').value);

const header = document.querySelector('.top');
new ResizeObserver(() => document.documentElement.style.setProperty('--hdr', header.offsetHeight + 'px')).observe(header);

/* --------------------- workspace: collapse, resize, pin --------------------- */
const ui = store.get('designerUI', {});
const saveUI = () => store.set('designerUI', ui);
ui.collapsed = ui.collapsed || {};

for (const card of document.querySelectorAll('.card[data-key]')) {
  const key = card.dataset.key, h2 = card.querySelector('.bar h2');
  const chev = el('button', { className: 'chev', title: 'Collapse / expand' });
  h2.before(chev);
  const apply = () => {
    const c = !!ui.collapsed[key];
    card.classList.toggle('collapsed', c);
    chev.textContent = c ? '▸' : '▾';
    chev.setAttribute('aria-expanded', String(!c));
  };
  chev.onclick = h2.onclick = () => { ui.collapsed[key] = !ui.collapsed[key]; saveUI(); apply(); };
  apply();
}

function grip(id, key, def, min, target, onReset) {
  const g = $(id), set = h => { target.style.height = h + 'px'; };
  set(ui[key] || def);
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { g.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    g.classList.add('drag');
    preview.style.pointerEvents = 'none';   // the iframe would swallow the drag otherwise
    const y0 = e.clientY, h0 = Math.round(target.getBoundingClientRect().height);
    let h = h0, moved = false;
    const move = (ev) => { moved = true; h = Math.round(Math.max(min, Math.min(window.innerHeight * 0.85, h0 + ev.clientY - y0))); set(h); };
    const up = () => {
      g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up);
      g.classList.remove('drag'); preview.style.pointerEvents = '';
      if (moved) { ui[key] = h; saveUI(); }
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
  });
  g.ondblclick = () => { delete ui[key]; saveUI(); set(def); if (onReset) onReset(); };
}
grip('grip-preview', 'previewH', 300, 90, preview, () => fitPreview());
grip('grip-mon', 'monH', 200, 70, $('mon'));

// Until the preview is resized by hand, a straight strip gets just the height it needs.
let previewContentH = 0;
function fitPreview(h) {
  if (h) previewContentH = h;
  if (ui.previewH) return;
  const strip = design.global.shape === 'strip' && previewContentH;
  preview.style.height = (strip ? Math.min(previewContentH, Math.round(window.innerHeight * 0.6)) : 300) + 'px';
}

const stick = document.querySelector('.stick');
$('pin').checked = ui.pinned !== false;
stick.classList.toggle('unpinned', !$('pin').checked);
$('pin').onchange = () => { ui.pinned = $('pin').checked; saveUI(); stick.classList.toggle('unpinned', !ui.pinned); };

$('diffuse').checked = !!ui.diffuse;
function sendView() { if (preview.contentWindow) preview.contentWindow.postMessage({ type: 'view', diffuse: !!ui.diffuse }, '*'); }
$('diffuse').onchange = () => { ui.diffuse = $('diffuse').checked; saveUI(); sendView(); };

function addLayer() {
  const L = D.newLayer({ name: 'Layer ' + (design.layers.length + 1), length: design.global.numLeds });
  design.layers.push(L); open.add(L); focus = design.layers.length - 1;
  renderLayers(); update();
}
$('add').onclick = addLayer;

/* ------------------------------- undo / redo ------------------------------- */
const hist = [];
let hpos = -1, lastTag = null, lastT = 0;
function noteUI() { if (hist[hpos]) { hist[hpos].open = design.layers.map(L => open.has(L)); hist[hpos].focus = focus; } }
// Edits sharing a tag (one slider drag, typing in one box) collapse into a single undo step.
function record(tag) {
  const json = JSON.stringify(design), now = Date.now();
  if (hpos >= 0 && hist[hpos].json === json) return;
  if (tag && tag === lastTag && now - lastT < 1200) hist[hpos].json = json;
  else {
    hist.length = hpos + 1;
    hist.push({ json });
    if (hist.length > 200) hist.shift();
    hpos = hist.length - 1;
  }
  lastTag = tag || null; lastT = now;
  noteUI(); syncUndo();
}
function syncUndo() { $('undo').disabled = hpos <= 0; $('redo').disabled = hpos >= hist.length - 1; }
function travel(step) {
  const e = hist[hpos + step];
  if (!e) return;
  const was = design.layers.map(L => open.has(L)), soloIdx = design.layers.indexOf(solo);
  design = D.parseDesign(e.json);
  hpos += step; lastTag = null;
  const same = was.length === design.layers.length, flags = same ? was : e.open || [];
  design.layers.forEach((L, j) => { if (flags[j]) open.add(L); });
  if (!same && e.focus !== undefined) focus = e.focus;
  focus = Math.max(0, Math.min(focus, design.layers.length - 1));
  solo = same && soloIdx >= 0 ? design.layers[soloIdx] : null;
  $('dname').value = design.name;
  renderGlobal(); renderLayers(); regen(); sendLayout(); syncUndo();
  toast(step < 0 ? 'Undone' : 'Redone');
}
$('undo').onclick = () => travel(-1);
$('redo').onclick = () => travel(1);
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  const t = e.target;
  if (t && t.tagName === 'INPUT' && (t.type === 'text' || t.type === 'number')) return;   // text boxes keep their own undo
  e.preventDefault();
  travel(k === 'y' || e.shiftKey ? 1 : -1);
});

/* ------------------------- code + preview plumbing ------------------------- */
let code = '', pvCode = '', previewTimer = 0, lastSent = '';

function update(tag) { record(tag); regen(); }

function regen() {
  store.set('designer', design);
  code = D.generate(design);
  if (!design.layers.includes(solo)) solo = null;
  pvCode = solo ? D.generate({ ...design, layers: design.layers.map(L => ({ ...L, enabled: L === solo })) }) : code;
  $('solo-note').hidden = !solo;
  if (solo) $('solo-text').textContent = `Preview only: showing just "${solo.name}". Your download still has every layer.`;
  $('code').textContent = code;
  const n = design.layers.filter(l => l.enabled).length;
  $('code-info').textContent = `${code.split('\n').length} lines · ${n} layer${n === 1 ? '' : 's'} on`;
  const g = design.global;
  $('flash-cmd').textContent = 'led-audio.exe --port COM5' + (+g.baud !== 115200 ? ' --baud ' + g.baud : '');
  clearTimeout(previewTimer);
  previewTimer = setTimeout(sendPreview, 250);
}

function sendPreview(force) {
  // Edits that only change the stored design line (names, randomize options) don't need a restart.
  const body = pvCode.replace(/^\/\/ LEDDESIGN .*$/m, '');
  if (body === lastSent && !force) return;
  try { LEDSim.compile(pvCode); }
  catch (e) { showErr(e.line ? 'Line ' + e.line : 'Compile', e.message); return; }
  showErr(null);
  lastSent = body;
  preview.contentWindow.postMessage({ type: 'load', code: pvCode }, '*');
}
function showErr(where, msg) {
  $('err').hidden = !where;
  if (where) { $('err-where').textContent = where; $('err-msg').textContent = msg; }
}
$('solo-off').onclick = () => { solo = null; renderLayers(); regen(); };
window.addEventListener('message', (e) => {
  if (e.source !== preview.contentWindow) return;
  const m = e.data || {};
  if (m.type === 'ready') { sendLayout(); sendView(); sendPreview(true); }
  else if (m.type === 'height') fitPreview(m.h);
  else if (m.type === 'error') showErr(m.message ? (m.line ? 'Line ' + m.line : 'Error') : null, m.message);
});

/* -------------------------------- audio -------------------------------- */
let ws = null, wsOpen = false, srcMode = store.get('designerSrc', 'auto');
let frame = new Uint8Array(19), lastBeatCount = -1, beatFlash = 0, lastFrameT = 0, lastLoudT = 0, frameKind = 'idle';
const mon = { raw: 0, shaped: 0, env: 0, beat: false };
$('src').value = srcMode;
$('src').onchange = () => { srcMode = $('src').value; store.set('designerSrc', srcMode); };

function connect() {
  ws = new WebSocket('ws://localhost:8000');
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { wsOpen = true; };
  ws.onmessage = (e) => { if (usingLive() && e.data instanceof ArrayBuffer) onFrame(new Uint8Array(e.data), 'live'); };
  ws.onclose = () => { wsOpen = false; ws = null; setTimeout(connect, 2000); };
}
const usingLive = () => srcMode === 'live' || (srcMode === 'auto' && wsOpen);
setInterval(() => { if (!usingLive()) onFrame(D.testFrame(performance.now() / 1000), 'test'); }, 10);
setInterval(() => {
  const pill = $('src-state');
  const fresh = performance.now() - lastFrameT < 500;
  const s = !fresh ? 'idle' : frameKind === 'live' && performance.now() - lastLoudT > 3000 ? 'quiet' : frameKind;
  pill.dataset.s = s;
  pill.textContent = s === 'live' ? 'Live: your PC\'s sound' : s === 'quiet' ? 'Live, but silent: play some music' : s === 'test' ? (srcMode === 'auto' ? 'Test beat (led-audio.exe not running)' : 'Test beat') : srcMode === 'live' ? 'Waiting for led-audio.exe…' : 'No audio';
  pill.title = s === 'test' && srcMode === 'auto' ? 'Start led-audio.exe and the lights will follow whatever your PC is playing.' : s === 'idle' && srcMode === 'live' ? 'Start led-audio.exe, or switch Audio to Test beat.' : '';
}, 250);

// Mirrors the sketch's gate/gain/curve/smoothing so you can see what the focused layer receives.
function shapeJS(v, gate, gain, curve) {
  if (v <= gate) return 0;
  let x = Math.min(255, (v - gate) * 255 / (255 - gate) * gain);
  if (curve === 'punchy') x = x * x / 255; else if (curve === 'gentle') x = Math.sqrt(x * 255);
  return Math.floor(x);
}
function followJS(cur, target, dt, a, r) { const tau = target > cur ? a : r; return tau <= 0 ? target : cur + (target - cur) * dt / (dt + tau); }
function rangeOf(f, lo, hi, peak) { let s = 0, m = 0; for (let b = lo; b <= hi; b++) { s += f[3 + b]; m = Math.max(m, f[3 + b]); } return peak ? m : Math.floor(s / (hi - lo + 1)); }

function onFrame(f, kind) {
  const t = performance.now(), dt = Math.min(100, t - lastFrameT || 10);
  lastFrameT = t; frameKind = kind; frame = f;
  if (f[1] > 2) lastLoudT = t;
  const beat = lastBeatCount >= 0 && f[2] !== lastBeatCount;
  lastBeatCount = f[2];
  if (beat) beatFlash = 1;
  if (preview.contentWindow) preview.contentWindow.postMessage({ type: 'rx', bytes: f }, '*');
  for (const M of design.layers) if (M.effect === 'palmood') moodStep(M, f, dt, beat);
  const L = design.layers[focus];
  if (!L) return;
  const spec = L.effect === 'spectrum';
  const src = spec ? 'bands' : L.source;
  if (src === 'beat') { mon.raw = beat ? 255 : 0; mon.shaped = mon.raw; }
  else { mon.raw = src === 'level' ? f[1] : rangeOf(f, L.lo, L.hi, !spec && L.reduce === 'peak'); mon.shaped = shapeJS(mon.raw, L.gate, L.gain, L.curve); }
  mon.env = followJS(mon.env, mon.shaped, dt, L.attack, L.release);
}

/* ----------------------------- monitor drawing ----------------------------- */
const cv = $('mon'), cx = cv.getContext('2d');
// Shared by drawing and pointer hit-testing. Short monitor: bars only; tall enough: plus the focused layer's meters.
function monGeom() {
  const W = cv.clientWidth, H = cv.clientHeight, meters = H >= 170;
  const x0 = 14, x1 = W - 92, y0 = 10, y1 = meters ? H - 108 : H - 22, gap = 3;
  return { W, H, meters, x0, x1, y0, y1, gap, bw: (x1 - x0) / 16 - gap, lx: W - 76, my: y1 + 44, mx: x0 + 150, mw: W - x0 - 150 - 14 };
}
let monHover = null;
function draw() {
  requestAnimationFrame(draw);
  const dpr = window.devicePixelRatio || 1, { W, H, meters, x0, y0, y1, gap, bw, lx, my, mx, mw } = monGeom();
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim(), faint = css.getPropertyValue('--faint').trim(), muted = css.getPropertyValue('--muted').trim();
  const L = design.layers[focus];
  const spec = L && L.effect === 'spectrum', src = L ? (spec ? 'bands' : L.source) : null;
  cx.font = '11px ' + css.getPropertyValue('--mono');
  cx.textAlign = 'center';
  for (let b = 0; b < 16; b++) {
    const v = frame[3 + b] / 254, x = x0 + b * (bw + gap);
    const hot = L && src === 'bands' && b >= L.lo && b <= L.hi;
    cx.fillStyle = monHover && monHover.kind === 'band' && monHover.b === b ? '#2b3140' : '#20242f'; cx.fillRect(x, y0, bw, y1 - y0);
    cx.fillStyle = hot ? accent : '#4a5266';
    cx.fillRect(x, y1 - v * (y1 - y0), bw, v * (y1 - y0));
    if (bw > 30 || b % 2 === 0) { cx.fillStyle = hot ? accent : faint; cx.fillText(D.fmtHz(D.BAND_LO_HZ[b]).replace(' ', ''), x + bw / 2, y1 + 14); }
  }
  if (L && src === 'bands') {
    cx.fillStyle = accent;
    cx.fillRect(x0 + L.lo * (bw + gap), y1 + 1, (L.hi - L.lo + 1) * (bw + gap) - gap, 2);
  }
  // level + beat
  cx.fillStyle = '#20242f'; cx.fillRect(lx, y0, 22, y1 - y0);
  cx.fillStyle = src === 'level' ? accent : '#6cb6ff';
  cx.fillRect(lx, y1 - frame[1] / 254 * (y1 - y0), 22, frame[1] / 254 * (y1 - y0));
  cx.fillStyle = src === 'level' ? accent : faint; cx.fillText('level', lx + 11, y1 + 14);
  beatFlash *= 0.9;
  cx.beginPath(); cx.arc(W - 28, (y0 + y1) / 2, Math.max(2, Math.min(13, (y1 - y0) / 2)), 0, Math.PI * 2);
  cx.fillStyle = `rgba(255,180,84,${0.12 + 0.88 * beatFlash})`; cx.fill();
  if (src === 'beat') { cx.strokeStyle = accent; cx.lineWidth = 2; cx.stroke(); }
  cx.fillStyle = src === 'beat' ? accent : faint; cx.fillText('beat', W - 28, y1 + 14);
  // focused layer input
  cx.textAlign = 'left';
  if (!meters) return;
  cx.fillStyle = muted;
  cx.fillText(L ? `"${L.name}" hears ${hearsText(L)}` : 'No layer selected. Click a layer to see what it hears.', x0, my - 6);
  if (!L) return;
  if (W > 620) { cx.textAlign = 'right'; cx.fillStyle = faint; cx.fillText('drag across the bars to change', mx + mw, my - 6); cx.textAlign = 'left'; }
  const meter = (y, v, color, label, mark) => {
    cx.fillStyle = faint; cx.fillText(label, x0, y + 11);
    cx.fillStyle = '#20242f'; cx.fillRect(mx, y, mw, 14);
    cx.fillStyle = color; cx.fillRect(mx, y, mw * Math.min(1, v / 255), 14);
    if (mark !== undefined) {
      const gx = mx + mw * mark / 255;
      cx.fillStyle = '#ff6b6b'; cx.fillRect(gx - 1, y - 3, 2, 20);
      cx.beginPath(); cx.arc(gx, y - 4, monHover && monHover.kind === 'gate' ? 5 : 3.5, 0, Math.PI * 2); cx.fill();
    }
  };
  meter(my + 4, mon.raw, '#4a5266', 'raw input', src === 'beat' ? undefined : L.gate);
  meter(my + 26, mon.env, accent, 'after response');
  cx.fillStyle = faint;
  const ms = L.effect === 'palmood' && moodState.get(L);
  if (ms) {
    const m = L.moods[ms.cur];
    cx.fillStyle = accent;
    cx.fillText(`mood now: ${Math.round(ms.bpm)} BPM · bass ${Math.round(ms.bass)} · treble ${Math.round(ms.treb)} · loudness ${Math.round(ms.loud)}  →  palette ${ms.cur + 1}${m ? ' (' + D.PALETTES[m.pal] + ')' : ''}`, x0, my + 58);
  } else cx.fillText(src === 'beat' ? 'beats are on/off, so there is no noise gate' : 'red line = noise gate (drag it): quieter than this is ignored', mx, my + 58);
}
requestAnimationFrame(draw);

/* ---------- monitor direct manipulation: pick what the focused layer hears, drag its gate ---------- */
function monHit(e) {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, g = monGeom();
  if (g.meters && y >= g.my - 6 && y <= g.my + 24 && x >= g.mx - 8 && x <= g.mx + g.mw + 8) return { kind: 'gate' };
  if (y < g.y0 || y > g.y1 + 18) return null;
  if (x >= g.x0 && x <= g.x1) return { kind: 'band', b: Math.max(0, Math.min(15, Math.floor((x - g.x0) / (g.bw + g.gap)))) };
  if (x >= g.lx - 4 && x <= g.lx + 26) return { kind: 'level' };
  if (x >= g.W - 46) return { kind: 'beat' };
  return null;
}
let monDrag = null, monSeq = 0;
function monApply(e) {
  const L = design.layers[focus];
  if (!L || !monDrag) return;
  const r = cv.getBoundingClientRect(), g = monGeom(), x = e.clientX - r.left;
  const before = JSON.stringify(L);
  if (monDrag.kind === 'gate') L.gate = Math.max(0, Math.min(200, Math.round((x - g.mx) / g.mw * 255)));
  else {
    const b = Math.max(0, Math.min(15, Math.floor((x - g.x0) / (g.bw + g.gap))));
    L.lo = Math.min(monDrag.b0, b); L.hi = Math.max(monDrag.b0, b);
    if (L.effect !== 'spectrum') L.source = 'bands';
  }
  if (JSON.stringify(L) !== before) { renderLayers(); update('mon' + monSeq); }
}
cv.addEventListener('pointerdown', (e) => {
  const L = design.layers[focus], h = monHit(e);
  if (!L || !h || e.button) return;
  e.preventDefault();
  if (h.kind === 'level' || h.kind === 'beat') {
    if (L.effect === 'spectrum') { toast('Spectrum bars always listen to a frequency range'); return; }
    if (L.source !== h.kind) { L.source = h.kind; renderLayers(); update(); }
    return;
  }
  if (h.kind === 'gate' && !notBeat(L)) return;
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  monSeq++;
  monDrag = h.kind === 'gate' ? { kind: 'gate' } : { kind: 'band', b0: h.b };
  monApply(e);
});
cv.addEventListener('pointermove', (e) => {
  if (monDrag) { monApply(e); return; }
  const L = design.layers[focus], h = L ? monHit(e) : null;
  monHover = h && (h.kind !== 'gate' || notBeat(L)) ? h : null;
  const k = monHover && monHover.kind;
  cv.style.cursor = k === 'gate' ? 'ew-resize' : k === 'band' ? 'col-resize' : k ? 'pointer' : '';
  cv.title = !k ? '' : k === 'gate' ? 'Drag to set the noise gate' : k === 'band' ? 'Drag across the bars to choose the frequencies this layer listens to'
    : k === 'level' ? 'Click: make this layer follow overall loudness' : 'Click: make this layer follow beats only';
});
const monEnd = () => { monDrag = null; };
cv.addEventListener('pointerup', monEnd);
cv.addEventListener('pointercancel', monEnd);
cv.addEventListener('pointerleave', () => { if (!monDrag) monHover = null; });

/* ---------------------------- header actions ---------------------------- */
function toast(msg, undoable) {
  const t = $('toast');
  t.textContent = msg;
  if (undoable && hpos > 0) { const b = el('button', { className: 'btn small', textContent: 'Undo' }); b.onclick = () => travel(-1); t.append(b); }
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), undoable ? 7000 : 1800);
}
function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function copyCode() {
  try { await navigator.clipboard.writeText(code); }
  catch (e) { const t = el('textarea', { value: code }); document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast('Sketch copied');
}
const fname = () => D.ident(design.name);

$('dname').value = design.name;
$('dname').oninput = () => { design.name = $('dname').value; update('dname'); };
$('download').onclick = () => download(fname() + '.ino', code, 'text/plain');
$('copy').onclick = $('copy2').onclick = copyCode;
$('export').onclick = () => download(fname() + '.json', JSON.stringify(design, null, 2), 'application/json');
$('open-sim').onclick = () => { store.set('code', code); window.open('index.html', '_blank'); };
$('import').onclick = () => $('file').click();
$('file').onchange = () => {
  const f = $('file').files[0];
  $('file').value = '';
  if (!f) return;
  f.text().then(t => {
    let d;
    try { d = D.parseDesign(t); }
    catch (e) { alert('That file has no designer data in it (it needs the LEDDESIGN line or a design .json).'); return; }
    loadDesign(d);
    toast('Imported ' + f.name, true);
  });
};

function presetOptions() {
  const sel = $('preset');
  sel.innerHTML = '';
  sel.append(el('option', { value: '', textContent: 'Presets…' }));
  const built = el('optgroup', { label: 'Built in' });
  for (const n of Object.keys(D.PRESETS)) built.append(el('option', { value: 'b:' + n, textContent: n }));
  sel.append(built);
  const mine = store.get('designerPresets', {});
  if (Object.keys(mine).length) {
    const g = el('optgroup', { label: 'Saved' });
    for (const n of Object.keys(mine)) g.append(el('option', { value: 'u:' + n, textContent: n }));
    sel.append(g);
  }
}
$('preset').onchange = () => {
  const v = $('preset').value;
  $('preset').value = '';
  if (!v) return;
  const n = v.slice(2);
  loadDesign(v[0] === 'b' ? D.PRESETS[n]() : D.parseDesign(JSON.stringify(store.get('designerPresets', {})[n])));
  toast(`Loaded "${n}"`, true);
};
$('save-preset').onclick = () => {
  const n = prompt('Preset name:', design.name);
  if (!n) return;
  const mine = store.get('designerPresets', {});
  mine[n] = JSON.parse(JSON.stringify(design));
  store.set('designerPresets', mine);
  presetOptions();
  toast('Saved preset "' + n + '"');
};

function loadDesign(d) {
  design = d; focus = 0; solo = null;
  if (design.layers[0]) open.add(design.layers[0]);
  $('dname').value = design.name;
  renderGlobal(); renderLayers(); update(); sendLayout();
}

presetOptions();
renderGlobal();
renderLayers();
update();
connect();
})();
