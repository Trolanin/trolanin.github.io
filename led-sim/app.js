/* LED simulator UI: editor, worker lifecycle, LED rendering, serial monitor, pins. */
(function () {
'use strict';
const $ = id => document.getElementById(id);
// Embedded as the designer's preview: the parent page supplies code and audio bytes.
const EMBED = new URLSearchParams(location.hash.slice(1)).has('embed');
const store = {
  get(k, d) { try { const v = localStorage.getItem('ledsim.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ledsim.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};

/* ============================ worker plumbing ============================ */
const workerUrl = URL.createObjectURL(new Blob([
  '(' + LED_RUNTIME.toString() + ')((function () { const h = { post: function (m) { self.postMessage(m); }, onmessage: null };' +
  ' self.onmessage = function (e) { if (h.onmessage) h.onmessage(e.data); }; return h; })());',
], { type: 'text/javascript' }));

let worker = null, state = 'idle', lastMsg = 0;
let frame = null, nLeds = 60, dirty = true;
let statPrev = null, fps = null;
const pinEls = new Map();
let audioWs = null;

function setState(s, label) {
  state = s;
  const el = $('st-state');
  el.dataset.s = s;
  el.textContent = label || { idle: 'Idle', running: 'Running', paused: 'Paused', error: 'Error', done: 'Finished', busy: 'Busy' }[s];
  $('pause').disabled = !(s === 'running' || s === 'paused' || s === 'busy');
  $('stop').disabled = !(s === 'running' || s === 'paused' || s === 'busy');
  $('pause').textContent = s === 'paused' ? 'Resume' : 'Pause';
  $('run').textContent = (s === 'idle' || s === 'error' || s === 'done') ? '▶ Run' : '↻ Restart';
}
function kill() { if (worker) { worker.terminate(); worker = null; } }
// The audio bridge sends the exact bytes it would write to a real ESP32's USB serial port.
function connectAudio() {
  const el = $('st-audio');
  audioWs = new WebSocket('ws://localhost:8000');
  audioWs.binaryType = 'arraybuffer';
  audioWs.onopen = () => { el.dataset.s = 'running'; el.textContent = 'Connected'; };
  audioWs.onmessage = (e) => {
    if (worker && state !== 'paused' && e.data instanceof ArrayBuffer) worker.postMessage({ type: 'rx', bytes: new Uint8Array(e.data) });
  };
  audioWs.onclose = () => { el.dataset.s = 'idle'; el.textContent = 'Offline'; audioWs = null; setTimeout(connectAudio, 2000); };
}

function showError(msg, line) {
  $('error').hidden = false;
  $('error-where').textContent = line ? 'Line ' + line : 'Error';
  $('error-msg').textContent = msg;
  $('error').dataset.line = line || '';
  errLine = line || 0;
  placeErrLine();
  if (EMBED) window.parent.postMessage({ type: 'error', message: msg, line: line || 0 }, '*');
}
function clearError() { $('error').hidden = true; errLine = 0; placeErrLine(); if (EMBED) window.parent.postMessage({ type: 'error', message: null }, '*'); }

function run() {
  kill();
  clearError();
  let js;
  try { js = LEDSim.compile(code.value).js; }
  catch (e) {
    setState('error', 'Compile error');
    showError(e.message, e.line);
    if (!(e instanceof LEDSim.SketchError)) console.error(e);
    return;
  }
  frame = null; statPrev = null; fps = null; dirty = true;
  resetPins();
  if (serial.textContent) appendSerial('\n— restart —\n');
  $('st-time').textContent = '0.0 s'; $('st-fps').textContent = '–'; $('st-power').textContent = '–';
  worker = new Worker(workerUrl);
  worker.onmessage = onWorker;
  worker.onerror = (e) => { setState('error'); showError(e.message || 'Worker failed'); };
  worker.postMessage({ type: 'run', code: js + '\n//# sourceURL=sketch.ino', speed: +$('speed').value });
  lastMsg = performance.now();
  setState('running');
}
function stop() { kill(); setState('idle'); }

function onWorker(e) {
  const m = e.data;
  lastMsg = performance.now();
  if (state === 'busy') setState('running');
  switch (m.type) {
    case 'frame':
      frame = m.buf;
      if (m.n !== nLeds) { nLeds = m.n; $('st-leds').textContent = nLeds; relayout(); }
      dirty = true;
      updateStats(m);
      $('st-power').textContent = (m.mA / 1000).toFixed(2) + ' A · ' + (m.mA * 5 / 1000).toFixed(1) + ' W';
      break;
    case 'stats': updateStats(m); break;
    case 'config': $('strips').textContent = m.strips.map(s => `${s.label} × ${s.n}`).join('   '); break;
    case 'serial': appendSerial(m.text); break;
    case 'warn': appendSerial('\n[simulator] ' + m.message + '\n'); break;
    case 'pin': addPin(m); break;
    case 'pinout': setPinOut(m); break;
    case 'error': setState('error'); showError(m.message, m.line); kill(); break;
    case 'done': setState('done'); kill(); break;
  }
}
function updateStats(m) {
  $('st-time').textContent = (m.vt / 1000).toFixed(1) + ' s';
  if (!statPrev) { statPrev = { vt: m.vt, shows: m.shows }; return; }
  const dv = m.vt - statPrev.vt;
  if (dv >= 400) {
    fps = (m.shows - statPrev.shows) * 1000 / dv;
    statPrev = { vt: m.vt, shows: m.shows };
    $('st-fps').textContent = fps >= 100 ? Math.round(fps) + ' fps' : fps.toFixed(1) + ' fps';
  }
}
setInterval(() => {
  if (state === 'running' && performance.now() - lastMsg > 2500) setState('busy', 'Busy — tight loop?');
}, 1000);

/* ================================ serial ================================ */
const serial = $('serial');
function appendSerial(text) {
  const stick = serial.scrollTop + serial.clientHeight >= serial.scrollHeight - 30;
  let t = serial.textContent + text;
  if (t.length > 60000) t = t.slice(t.length - 50000);
  serial.textContent = t;
  if (stick) serial.scrollTop = serial.scrollHeight;
}
$('serial-clear').onclick = () => { serial.textContent = ''; };

/* ================================= pins ================================= */
const EMPTY_PINS = $('inputs').innerHTML;
function resetPins() { pinEls.clear(); $('inputs').innerHTML = EMPTY_PINS; }
function sendInput(pin, value) { if (worker) worker.postMessage({ type: 'input', pin, value }); }
function addPin(m) {
  const box = $('inputs');
  if (!pinEls.size) box.innerHTML = '';
  let row = pinEls.get(m.pin);
  if (row) row.remove();
  row = document.createElement('div');
  row.className = 'pin';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = 'GPIO ' + m.pin;
  row.appendChild(name);
  if (m.kind === 'analog') {
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = 0; slider.max = 4095; slider.value = 0;
    slider.setAttribute('aria-label', 'analog value for GPIO ' + m.pin);
    const val = document.createElement('span');
    val.className = 'val'; val.textContent = '0';
    slider.oninput = () => { val.textContent = slider.value; sendInput(m.pin, +slider.value); };
    row.append(slider, val);
  } else if (m.kind === 'in' || m.kind === 'touch') {
    const activeLow = m.kind === 'in' && m.pull === 1;
    const wrap = document.createElement('span');
    wrap.style.display = 'flex'; wrap.style.gap = '10px'; wrap.style.alignItems = 'center';
    const btn = document.createElement('button');
    btn.className = 'btn press'; btn.textContent = m.kind === 'touch' ? 'Touch' : 'Press';
    const hold = document.createElement('label');
    hold.className = 'opt';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    hold.append(cb, 'hold');
    const val = document.createElement('span');
    val.className = 'val';
    let down = false;
    const apply = (pressed) => {
      down = pressed;
      btn.classList.toggle('down', pressed);
      const level = m.kind === 'touch' ? (pressed ? 1 : 0) : (pressed !== activeLow ? 1 : 0);
      val.textContent = m.kind === 'touch' ? (pressed ? 'touched' : '—') : (level ? 'HIGH' : 'LOW');
      sendInput(m.pin, level);
    };
    btn.onpointerdown = (e) => { btn.setPointerCapture(e.pointerId); apply(true); };
    btn.onpointerup = btn.onpointercancel = () => { if (!cb.checked) apply(false); };
    btn.onkeydown = (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) apply(true); };
    btn.onkeyup = (e) => { if ((e.key === ' ' || e.key === 'Enter') && !cb.checked) apply(false); };
    cb.onchange = () => { if (!cb.checked && down) apply(false); };
    val.textContent = m.kind === 'touch' ? '—' : (activeLow ? 'HIGH' : 'LOW');
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = m.kind === 'touch' ? 'touch pad' : activeLow ? 'pull-up, pressed = LOW' : 'pressed = HIGH';
    wrap.append(btn, hold, hint);
    row.append(wrap, val);
  } else {
    const lamp = document.createElement('span');
    lamp.className = 'lamp';
    const val = document.createElement('span');
    val.className = 'val'; val.textContent = '—';
    row.append(lamp, val);
  }
  pinEls.set(m.pin, row);
  const after = [...pinEls.keys()].filter(p => p > m.pin).sort((a, b) => a - b)[0];
  box.insertBefore(row, after === undefined ? null : pinEls.get(after));
}
function setPinOut(m) {
  const row = pinEls.get(m.pin);
  if (!row) return;
  const lamp = row.querySelector('.lamp'), val = row.querySelector('.val');
  if (lamp) lamp.classList.toggle('on', !!m.value);
  if (val) val.textContent = m.pwm ? String(m.value) : (m.value ? 'HIGH' : 'LOW');
}

/* =============================== rendering =============================== */
const canvas = $('leds'), wrap = $('wrap'), ctx = canvas.getContext('2d'), tip = $('tip');
let layout = store.get('layout', 'strip');
let L = null; // { W, H, pitch, pts, rows|ring|rect }
const GAMMA = new Uint8Array(256), LINEAR = new Uint8Array(256);
for (let i = 0; i < 256; i++) { GAMMA[i] = Math.round(Math.pow(i / 255, 1 / 2.2) * 255); LINEAR[i] = i; }

// Closed outlines, starting at the top and running clockwise (y points down).
const SHAPES = {
  square: () => [[0, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]],
  triangle: () => [[0, -1], [0.866, 0.5], [-0.866, 0.5]],
  hexagon: () => Array.from({ length: 6 }, (_, k) => { const a = -Math.PI / 2 + k * Math.PI / 3; return [Math.cos(a), Math.sin(a)]; }),
  star: () => Array.from({ length: 10 }, (_, k) => { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 0.42 : 1; return [r * Math.cos(a), r * Math.sin(a)]; }),
  heart: () => Array.from({ length: 240 }, (_, k) => { const t = k / 240 * 2 * Math.PI; return [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]; }),
};
// Tallest a shape may draw. Embedded, it fills whatever height the designer gives the frame.
const maxH = () => EMBED ? Math.max(100, window.innerHeight - wrap.getBoundingClientRect().top - 2) : 520;

function relayout() {
  const W = Math.max(200, wrap.clientWidth), n = Math.max(1, nLeds), pad = 22;
  const pts = new Float32Array(n * 2);
  const out = { W, n, pts, kind: layout };
  if (SHAPES[layout]) {
    const size = Math.min(W, maxH()), box = size - (size < 220 ? 44 : 76);
    const raw = SHAPES[layout]();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of raw) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const k = box / Math.max(x1 - x0, y1 - y0), cx = W / 2, cy = size / 2;
    const poly = raw.map(([x, y]) => [cx + (x - (x0 + x1) / 2) * k, cy + (y - (y0 + y1) / 2) * k]);
    const segs = poly.map((p, i) => { const q = poly[(i + 1) % poly.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
    const total = segs.reduce((a, b) => a + b, 0);
    let seg = 0, acc = 0;
    for (let i = 0; i < n; i++) {
      const s = i * total / n;
      while (acc + segs[seg] < s) { acc += segs[seg]; seg++; }
      const p = poly[seg], q = poly[(seg + 1) % poly.length], f = (s - acc) / segs[seg];
      pts[i * 2] = p[0] + (q[0] - p[0]) * f; pts[i * 2 + 1] = p[1] + (q[1] - p[1]) * f;
    }
    out.outline = poly; out.cx = cx; out.cy = cy; out.H = size; out.pitch = Math.min(total / n, 34);
  } else if (layout === 'ring') {
    const size = Math.min(W, maxH()), R = size / 2 - (size < 220 ? 30 : 50);
    out.H = size; out.pitch = Math.min(2 * Math.PI * R / n, 34); out.R = R; out.cx = W / 2; out.cy = size / 2;
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i / n * 2 * Math.PI; pts[i * 2] = out.cx + R * Math.cos(a); pts[i * 2 + 1] = out.cy + R * Math.sin(a); }
  } else if (layout === 'matrix') {
    const cols = Math.max(1, Math.min(n, +$('cols').value || 10)), rows = Math.ceil(n / cols), serp = $('serp').checked;
    const pitch = Math.min((W - 2 * pad) / cols, 40, ((EMBED ? maxH() : 900) - 2 * pad) / rows);
    out.pitch = pitch; out.H = rows * pitch + 2 * pad;
    const x0 = (W - cols * pitch) / 2 + pitch / 2;
    out.rect = { x: x0 - pitch / 2, y: pad, w: cols * pitch, h: rows * pitch };
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      let c = i % cols;
      if (serp && r % 2) c = cols - 1 - c;
      pts[i * 2] = x0 + c * pitch; pts[i * 2 + 1] = pad + pitch / 2 + r * pitch;
    }
  } else {
    const avail = W - 2 * pad, minPitch = 15;
    let perRow = n;
    if (avail / n < minPitch) perRow = Math.ceil(n / Math.ceil(n * minPitch / avail));
    const pitch = Math.min(avail / perRow, 30), rows = Math.ceil(n / perRow), gap = pitch * 2.7;
    const x0 = (W - perRow * pitch) / 2 + pitch / 2, y0 = pad + pitch * 0.9;
    out.pitch = pitch; out.H = y0 + (rows - 1) * gap + pitch * 0.9 + 30; out.rows = [];
    for (let r = 0; r < rows; r++) {
      const count = Math.min(perRow, n - r * perRow);
      out.rows.push({ x: x0 - pitch / 2, y: y0 + r * gap, w: count * pitch, first: r * perRow, count });
    }
    for (let i = 0; i < n; i++) { pts[i * 2] = x0 + (i % perRow) * pitch; pts[i * 2 + 1] = y0 + Math.floor(i / perRow) * gap; }
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.style.height = out.H + 'px';
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(out.H * dpr);
  out.dpr = dpr;
  L = out;
  dirty = true;
}

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function outlinePath() {
  ctx.beginPath();
  L.outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}
// Outline strips are drawn as a thick stroke; this paints (or masks) that band.
function strokeOutline(scale, style) {
  outlinePath();
  ctx.lineWidth = L.pitch * scale; ctx.lineJoin = 'round';
  ctx.strokeStyle = style; ctx.stroke();
}
function bodyPath(scale) { // the PCB / diffuser outline for the current layout
  const p = L.pitch, h = p * scale;
  ctx.beginPath();
  if (L.kind === 'ring') {
    ctx.arc(L.cx, L.cy, L.R + h / 2, 0, Math.PI * 2);
    ctx.moveTo(L.cx + L.R - h / 2, L.cy);
    ctx.arc(L.cx, L.cy, Math.max(1, L.R - h / 2), 0, Math.PI * 2, true);
  } else if (L.kind === 'matrix') {
    const r = L.rect, m = p * (scale - 1) / 2;
    ctx.rect(r.x - m, r.y - m, r.w + 2 * m, r.h + 2 * m);
  } else {
    for (const row of L.rows) {
      const x = row.x - 3, y = row.y - h / 2, w = row.w + 6, r = Math.min(6, h / 2);
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    }
  }
}

function draw() {
  if (!L) return;
  const { W, H, n, pts, pitch } = L;
  const diffuse = $('diffuse').checked, lut = $('gamma').checked ? GAMMA : LINEAR;
  ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  // board
  if (L.outline) {
    strokeOutline((diffuse ? 1.3 : 1.24) + 0.08, '#232730');
    strokeOutline(diffuse ? 1.3 : 1.24, diffuse ? '#0e1014' : '#13151a');
  } else {
    bodyPath(diffuse ? 1.3 : 1.24);
    ctx.fillStyle = diffuse ? '#0e1014' : '#13151a';
    ctx.fill('evenodd');
    ctx.strokeStyle = '#232730'; ctx.lineWidth = 1;
    ctx.stroke();
  }

  const s = pitch * 0.72, lens = s * 0.37;
  if (!diffuse) {
    // solder pads between pixels (strip only) and the 5050 packages
    if (L.kind === 'strip') {
      ctx.fillStyle = '#5a4a26';
      for (const row of L.rows) for (let k = 1; k < row.count; k++) {
        const x = row.x + k * pitch;
        ctx.fillRect(x - 0.75, row.y - pitch * 0.36, 1.5, pitch * 0.2);
        ctx.fillRect(x - 0.75, row.y + pitch * 0.16, 1.5, pitch * 0.2);
      }
    }
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2], y = pts[i * 2 + 1];
      rr(x - s / 2, y - s / 2, s, s, s * 0.16);
      ctx.fillStyle = '#2a2d35'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, lens, 0, Math.PI * 2);
      ctx.fillStyle = '#15171c'; ctx.fill();
    }
  }

  if (frame) {
    const count = Math.min(n, frame.length / 3);
    if (diffuse && !L.outline) { ctx.save(); bodyPath(1.3); ctx.clip('evenodd'); }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const r = lut[frame[i * 3]], g = lut[frame[i * 3 + 1]], b = lut[frame[i * 3 + 2]];
      const I = Math.max(r, g, b) / 255;
      if (I < 0.006) continue;
      const x = pts[i * 2], y = pts[i * 2 + 1];
      const R = diffuse ? pitch * 1.9 : pitch * (0.8 + 1.7 * I);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, R);
      if (diffuse) {
        // neighbours overlap and add up, so each pixel contributes well under full intensity
        const k = L.kind === 'matrix' ? 0.55 : 1;
        gr.addColorStop(0, `rgba(${r},${g},${b},${0.52 * k})`); gr.addColorStop(0.45, `rgba(${r},${g},${b},${0.2 * k})`);
      } else {
        gr.addColorStop(0, `rgba(${r},${g},${b},${(0.5 * I + 0.06).toFixed(3)})`); gr.addColorStop(0.35, `rgba(${r},${g},${b},${(0.17 * I).toFixed(3)})`);
      }
      gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(x - R, y - R, R * 2, R * 2);
    }
    if (diffuse && L.outline) {
      // keep only the light that falls inside the diffuser band
      ctx.globalCompositeOperation = 'destination-in';
      strokeOutline(1.3, '#000');
    } else if (diffuse) ctx.restore();
    if (!diffuse) {
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < count; i++) {
        const r = lut[frame[i * 3]], g = lut[frame[i * 3 + 1]], b = lut[frame[i * 3 + 2]];
        const I = Math.max(r, g, b) / 255;
        if (I < 0.006) continue;
        const x = pts[i * 2], y = pts[i * 2 + 1], wm = 0.62 * I * I;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, lens);
        gr.addColorStop(0, `rgb(${Math.round(r + (255 - r) * wm)},${Math.round(g + (255 - g) * wm)},${Math.round(b + (255 - b) * wm)})`);
        gr.addColorStop(1, `rgb(${r},${g},${b})`);
        ctx.beginPath(); ctx.arc(x, y, lens, 0, Math.PI * 2);
        ctx.fillStyle = gr; ctx.fill();
      }
    }
  }

  // index labels
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#586071';
  ctx.font = '10px "Cascadia Code", Consolas, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (L.kind === 'strip') {
    for (let i = 0; i < n; i++) if (i % 10 === 0 || i === n - 1) ctx.fillText(String(i), pts[i * 2], pts[i * 2 + 1] + pitch * 0.62 + 13);
  } else if (L.outline) {
    const every = n <= 40 ? 5 : 10;
    for (let i = 0; i < n; i += every) {
      const x = pts[i * 2], y = pts[i * 2 + 1], dx = x - L.cx, dy = y - L.cy, d = Math.hypot(dx, dy) || 1, o = pitch * 0.65 + 13;
      ctx.fillText(String(i), x + dx / d * o, y + dy / d * o);
    }
  } else if (L.kind === 'ring') {
    for (let i = 0; i < n; i += 5) {
      const a = -Math.PI / 2 + i / n * 2 * Math.PI, d = L.R + pitch * 0.65 + 15;
      ctx.fillText(String(i), L.cx + d * Math.cos(a), L.cy + d * Math.sin(a));
    }
  }
}
function loop() {
  if (dirty) { dirty = false; draw(); }
  requestAnimationFrame(loop);
}

canvas.addEventListener('mousemove', (e) => {
  if (!L) return;
  const b = canvas.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top;
  let best = -1, bd = (L.pitch * 0.65) ** 2;
  for (let i = 0; i < L.n; i++) { const d = (L.pts[i * 2] - mx) ** 2 + (L.pts[i * 2 + 1] - my) ** 2; if (d < bd) { bd = d; best = i; } }
  if (best < 0) { tip.style.display = 'none'; return; }
  const r = frame ? frame[best * 3] || 0 : 0, g = frame ? frame[best * 3 + 1] || 0 : 0, bl = frame ? frame[best * 3 + 2] || 0 : 0;
  const hex = '#' + [r, g, bl].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  tip.innerHTML = '';
  const sw = document.createElement('i');
  sw.style.background = hex;
  tip.append(sw, `LED ${best} · ${r}, ${g}, ${bl} · ${hex}`);
  tip.style.display = 'block';
  tip.style.left = Math.max(90, Math.min(L.W - 90, L.pts[best * 2])) + 'px';
  tip.style.top = Math.max(34, L.pts[best * 2 + 1]) + 'px';
});
canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

function setLayout(v) {
  if (![...$('layout').options].some(o => o.value === v)) v = 'strip';
  layout = v;
  if (!EMBED) store.set('layout', v);
  $('layout').value = v;
  $('matrix-opts').hidden = v !== 'matrix';
  relayout();
}
$('layout').addEventListener('change', () => setLayout($('layout').value));
for (const id of ['cols', 'serp', 'diffuse', 'gamma']) {
  const el = $(id), isBox = el.type === 'checkbox';
  const saved = store.get(id, null);
  if (saved !== null) { if (isBox) el.checked = saved; else el.value = saved; }
  el.addEventListener('input', () => { store.set(id, isBox ? el.checked : el.value); relayout(); });
}
new ResizeObserver(() => relayout()).observe(wrap);

/* ================================ editor ================================ */
const code = $('code'), hl = $('hl'), gutter = $('gutter'), errEl = $('errline');
let errLine = 0, lineCount = 0;
const LH = 20, PAD = 10;
const KW = new Set('void int float double bool boolean char unsigned signed long short const static volatile struct class enum typedef public private protected if else for while do switch case default break continue return true false sizeof auto extern inline virtual new delete this nullptr NULL using union'.split(' '));
const TY = new Set('uint8_t int8_t uint16_t int16_t uint32_t int32_t uint64_t int64_t byte word size_t String CRGB CHSV CRGBPalette16 CHSVPalette16 CRGBArray CRGBSet Adafruit_NeoPixel TBlendType TProgmemPalette16 fract8 FastLED Serial'.split(' '));
const RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(^[ \t]*#[ \t]*\w+)|\b(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?[uUlLfF]*)\b|\b([A-Za-z_]\w*)\b/gm;
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function highlight(src) {
  let out = '', last = 0, m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src))) {
    if (m[0] === '') { RE.lastIndex++; continue; }
    out += esc(src.slice(last, m.index));
    last = m.index + m[0].length;
    let c = null;
    if (m[1]) c = 'c'; else if (m[2]) c = 's'; else if (m[3]) c = 'p'; else if (m[4]) c = 'n';
    else if (KW.has(m[5])) c = 'k';
    else if (TY.has(m[5])) c = 't';
    else if (/^\s*\(/.test(src.slice(last, last + 8))) c = 'f';
    else if (/^[A-Z][A-Z0-9_]+$/.test(m[5])) c = 'd';
    out += c ? `<span class="tk-${c}">${esc(m[0])}</span>` : esc(m[0]);
  }
  return out + esc(src.slice(last)) + '\n';
}
function refresh() {
  const src = code.value;
  hl.innerHTML = highlight(src);
  const n = src.split('\n').length;
  if (n !== lineCount) {
    lineCount = n;
    let g = '';
    for (let i = 1; i <= n; i++) g += i + '\n';
    gutter.textContent = g;
  }
  syncScroll();
}
function syncScroll() {
  hl.scrollTop = code.scrollTop; hl.scrollLeft = code.scrollLeft;
  gutter.scrollTop = code.scrollTop;
  placeErrLine();
}
function placeErrLine() {
  if (!errLine) { errEl.style.display = 'none'; return; }
  errEl.style.display = 'block';
  errEl.style.top = (PAD + (errLine - 1) * LH - code.scrollTop) + 'px';
}
function gotoLine(line) {
  const lines = code.value.split('\n');
  let pos = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  code.focus();
  code.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
  code.scrollTop = Math.max(0, (line - 1) * LH - code.clientHeight / 2);
  syncScroll();
}
function insert(text) {
  if (!document.execCommand || !document.execCommand('insertText', false, text)) code.setRangeText(text, code.selectionStart, code.selectionEnd, 'end');
}
code.addEventListener('input', () => { refresh(); store.set('code', code.value); if (errLine) { errLine = 0; placeErrLine(); } });
code.addEventListener('scroll', syncScroll);
code.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); return; }
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); insert('  '); refresh(); return; }
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
    const before = code.value.slice(0, code.selectionStart);
    const cur = before.slice(before.lastIndexOf('\n') + 1);
    const indent = /^[ \t]*/.exec(cur)[0] + (/\{\s*$/.test(cur) ? '  ' : '');
    e.preventDefault();
    insert('\n' + indent);
    refresh();
  }
});
$('error').addEventListener('click', () => { const l = +$('error').dataset.line; if (l) gotoLine(l); });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target !== code) { e.preventDefault(); run(); } });

function setCode(text) { code.value = text.replace(/\r\n?/g, '\n'); code.scrollTop = 0; refresh(); if (!EMBED) store.set('code', code.value); }

/* ============================== file / examples ============================== */
const exSel = $('examples');
exSel.append(new Option('Examples…', ''));
LED_EXAMPLES.forEach((ex, i) => exSel.append(new Option(ex.name, String(i))));
exSel.onchange = () => {
  const ex = LED_EXAMPLES[+exSel.value];
  exSel.value = '';
  if (!ex) return;
  const mine = code.value.trim();
  if (mine && !LED_EXAMPLES.some(x => x.code.trim() === mine) && !confirm('Replace the sketch in the editor with this example?')) return;
  setCode(ex.code);
  if (ex.layout) setLayout(ex.layout);
  run();
};
function loadFile(f) {
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { setCode(String(r.result)); run(); };
  r.readAsText(f);
}
$('open').onclick = () => $('file').click();
$('file').onchange = () => { loadFile($('file').files[0]); $('file').value = ''; };
$('save').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([code.value], { type: 'text/plain' }));
  a.download = 'sketch.ino';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('drop'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drop'); } });
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('drop'); loadFile(e.dataTransfer.files[0]); });

/* ================================ controls ================================ */
$('run').onclick = run;
$('stop').onclick = stop;
$('pause').onclick = () => {
  if (!worker) return;
  if (state === 'paused') { worker.postMessage({ type: 'resume' }); lastMsg = performance.now(); setState('running'); }
  else { worker.postMessage({ type: 'pause' }); setState('paused'); }
};
$('speed').value = String(store.get('speed', 1));
if (!$('speed').value) $('speed').value = '1';
$('speed').onchange = () => { store.set('speed', +$('speed').value); statPrev = null; if (worker) worker.postMessage({ type: 'speed', speed: +$('speed').value }); };

/* ================================= boot ================================= */
const hash = new URLSearchParams(location.hash.slice(1));
const bootEx = hash.has('example') ? LED_EXAMPLES[+hash.get('example')] : null;
if (hash.has('diffuse')) $('diffuse').checked = hash.get('diffuse') === '1';
if (bootEx) { setCode(bootEx.code); layout = bootEx.layout || layout; }
else setCode(store.get('code', LED_EXAMPLES[0].code));
if (hash.has('layout')) layout = hash.get('layout');
setLayout(layout);
setState('idle');
requestAnimationFrame(loop);
if (EMBED) {
  document.body.classList.add('embed');
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const m = e.data || {};
    if (m.type === 'load') { setCode(String(m.code)); run(); }
    else if (m.type === 'rx' && worker && state !== 'paused') worker.postMessage({ type: 'rx', bytes: m.bytes });
    else if (m.type === 'layout') { if (m.cols) $('cols').value = m.cols; $('serp').checked = m.serp !== false; setLayout(m.layout); }
    else if (m.type === 'view') { $('diffuse').checked = !!m.diffuse; dirty = true; }
  });
  window.addEventListener('resize', relayout);
  new ResizeObserver(() => window.parent.postMessage({ type: 'height', h: Math.ceil(document.body.getBoundingClientRect().height) }, '*')).observe(document.body);
  window.parent.postMessage({ type: 'ready' }, '*');
} else {
  connectAudio();
  run();
}
})();
