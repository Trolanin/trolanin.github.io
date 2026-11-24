// Puts the visualizer over the YouTube player: a canvas on top of the video (the controls, captions
// and menus stay on top of it), fed by the player's own sound. With "Save data" on, the player is
// held at its lowest quality (144p) while the visualizer covers it.
"use strict";

const STORE_KEY = "drift";
const DEFAULTS = {
  enabled: true, saveData: true,
  reactivity: 1, evoSpeed: 1, mutation: 0.5, sceneLen: 30, buildMin: 3, complexityCap: 1, trails: 0, brightness: 1,
};
const MAX_PIXELS = 1920 * 1080;   // internal resolution cap; the canvas is scaled up past this

const state = {
  opts: { ...DEFAULTS },
  settings: defaultSettings(),
  canvas: null, note: null, renderer: null, evo: null, vis: null, tap: new AudioTap(),
  P: new Float32Array(P_FLOATS),
  active: false, raf: 0, last: 0,
  fps: 0, frames: 0, fpsT: 0,
  qualityLocked: false, lastQualitySet: 0,
  waitingClick: false,
};

function applyOpts() {
  const o = state.opts, s = state.settings;
  for (const k of ["reactivity", "evoSpeed", "mutation", "sceneLen", "buildMin", "complexityCap", "trails", "brightness"])
    if (typeof o[k] === "number" && Number.isFinite(o[k])) s[k] = o[k];
  state.tap.setParams(s.x);
}

/* ------------------------------ player ------------------------------ */
function player() { return document.getElementById("movie_player"); }
function playerVideo(p) { return p && p.querySelector("video.html5-main-video"); }
function pageApi(p) { return p && p.wrappedJSObject; }   // the page's own player methods

function lockQuality(on) {
  const api = pageApi(player());
  if (!api || typeof api.setPlaybackQualityRange !== "function") return;
  try {
    if (on) {
      const now = performance.now();
      if (api.getPlaybackQuality() !== "tiny" && now - state.lastQualitySet > 3000) {
        const levels = Array.from(api.getAvailableQualityLevels() || []);
        if (levels.includes("tiny")) {
          api.setPlaybackQualityRange("tiny", "tiny");
          state.lastQualitySet = now;
        }
      }
      state.qualityLocked = true;
    } else if (state.qualityLocked) {
      api.setPlaybackQualityRange("auto", "auto");
      state.qualityLocked = false;
    }
  } catch (e) { /* the player API changed: leave the quality alone */ }
}

/* ------------------------------ overlay ------------------------------ */
function ensureOverlay(p) {
  if (state.canvas && state.canvas.isConnected && state.canvas.parentNode === p) return true;
  if (!state.canvas) {
    const c = document.createElement("canvas");
    c.id = "drift-viz-overlay";
    c.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;z-index:11;pointer-events:none;background:#000;display:block";
    c.addEventListener("webglcontextlost", (e) => { e.preventDefault(); stopLoop(); });
    c.addEventListener("webglcontextrestored", () => { state.renderer = null; });
    const n = document.createElement("div");
    n.id = "drift-viz-note";
    n.style.cssText = "position:absolute;left:12px;top:12px;z-index:12;pointer-events:none;display:none;" +
      "font:500 13px/1.4 Roboto,Arial,sans-serif;color:#e8e6f2;background:rgba(24,24,30,.82);" +
      "border:1px solid rgba(116,102,206,.8);border-radius:8px;padding:6px 10px;max-width:70%";
    state.canvas = c;
    state.note = n;
  }
  const vc = p.querySelector(".html5-video-container");
  if (vc) vc.after(state.canvas); else p.prepend(state.canvas);
  state.canvas.after(state.note);
  return true;
}

function showNote(text) {
  if (!state.note) return;
  state.note.textContent = text;
  state.note.style.display = text ? "block" : "none";
}

function onUserGesture() {
  document.removeEventListener("pointerdown", onUserGesture, true);
  document.removeEventListener("keydown", onUserGesture, true);
  state.waitingClick = false;
  connectSound();
}

async function connectSound() {
  const v = playerVideo(player());
  if (!v || state.connecting) return;
  if (state.tap.video === v && state.tap.source) { state.tap.start(); showNote(""); return; }
  state.connecting = true;
  const ok = await state.tap.attach(v);
  state.connecting = false;
  if (ok) { showNote(""); return; }
  if (!state.tap.source && /click/.test(state.tap.error)) {
    showNote("Drift: click anywhere on the page once to connect the visualizer to the sound.");
    if (!state.waitingClick) {
      state.waitingClick = true;
      document.addEventListener("pointerdown", onUserGesture, true);
      document.addEventListener("keydown", onUserGesture, true);
    }
  } else if (state.tap.error) showNote("Drift: " + state.tap.error);
}

/* ------------------------------ frame loop ------------------------------ */
function startLoop() {
  if (state.raf) return;
  state.last = performance.now();
  state.raf = requestAnimationFrame(frame);
}
function stopLoop() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
}

function frame(now) {
  state.raf = requestAnimationFrame(frame);
  try {
    draw(now);
  } catch (e) {
    // Keep the page usable: stop drawing and say why (shown in the popup).
    state.lastError = String(e && e.stack || e);
    stopLoop();
    showNote("Drift stopped: " + (e && e.message));
  }
}

function draw(now) {
  const c = state.canvas;
  if (!state.active || !c) return;
  if (!state.renderer || !state.renderer.ok()) {
    if (state.renderer && state.renderer.error) return;
    state.renderer = new Renderer(c);
    if (state.renderer.error) { showNote("Drift can't draw here: " + state.renderer.error); return; }
  }
  const dt = Math.min((now - state.last) / 1000, 0.1);
  state.last = now;
  const r = c.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return;
  const dpr = window.devicePixelRatio || 1;
  let w = r.width * dpr, h = r.height * dpr;
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
  w = Math.max(16, Math.round(w * k));
  h = Math.max(16, Math.round(h * k));
  const s = state.settings, af = state.tap.frame;
  if (!state.evo) { state.evo = new Evolver(s); state.vis = new Visuals(); }
  state.evo.update(dt, af, s);
  state.renderer.resize(w, h);
  const di = state.vis.build(state.P, state.evo, af, s, dt, w, h, state.renderer.meanLum);
  state.renderer.render(state.P, af, di);

  state.frames++;
  if (now - state.fpsT >= 1000) {
    state.fps = (state.frames * 1000) / (now - state.fpsT);
    state.frames = 0;
    state.fpsT = now;
  }
}

function status() {
  const e = state.evo, a = state.tap.frame, api = pageApi(player());
  let quality = "";
  try { quality = api && api.getPlaybackQuality ? String(api.getPlaybackQuality()) : ""; } catch (err) { /* ignore */ }
  return {
    active: state.active, fps: Math.round(state.fps), connected: !!state.tap.source, tapError: state.tap.error,
    level: +a.level.toFixed(2), dbfs: Math.round(a.dbfs), silent: a.silent, beats: a.beats, bpm: Math.round(a.bpm),
    generation: e ? e.generation : 0, scene: e ? e.scene : 0, complexity: e ? Math.round(e.complexity * 100) : 0,
    look: e ? e.describe() : "", event: e ? e.lastEvent : "", quality, saveData: state.opts.saveData,
    meanLum: state.renderer ? +state.renderer.meanLum.toFixed(2) : -1, size: state.canvas ? `${state.canvas.width}x${state.canvas.height}` : "",
    renderError: state.renderer ? state.renderer.error : "", lastError: state.lastError || "",
  };
}

/* ------------------------------ on / off ------------------------------ */
// Runs twice a second: YouTube swaps pages without reloading, so this follows it around.
function tick() {
  const p = player(), v = playerVideo(p);
  const want = state.opts.enabled && location.pathname === "/watch" && !!p && !!v;
  if (want) {
    ensureOverlay(p);
    state.canvas.style.display = "block";
    if (!state.active) { state.active = true; startLoop(); }
    if (!state.waitingClick && (!state.tap.running || state.tap.video !== v)) connectSound();
    lockQuality(state.opts.saveData);
  } else if (state.active || state.qualityLocked) {
    state.active = false;
    stopLoop();
    state.tap.stop();
    if (state.canvas) state.canvas.style.display = "none";
    showNote("");
    lockQuality(false);
  }
  if (state.active && !state.opts.saveData) lockQuality(false);
  if (state.canvas) state.canvas.dataset.status = JSON.stringify(status());
}

browser.storage.local.get(STORE_KEY).then((r) => {
  state.opts = { ...DEFAULTS, ...(r[STORE_KEY] || {}) };
  applyOpts();
  tick();
  setInterval(tick, 500);
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORE_KEY]) return;
  state.opts = { ...DEFAULTS, ...(changes[STORE_KEY].newValue || {}) };
  applyOpts();
  tick();
});

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg.cmd !== "string") return undefined;
  if (msg.cmd === "status") return Promise.resolve(status());
  if (!state.evo) return Promise.resolve(status());
  if (msg.cmd === "newSpecies") state.evo.newSpecies("New look by hand");
  else if (msg.cmd === "mutate") state.evo.mutateScene(1, "Mutated by hand");
  return Promise.resolve(status());
});
