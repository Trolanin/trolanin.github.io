"use strict";
const KEY = "drift";
const DEFAULTS = {
  enabled: true, saveData: true,
  reactivity: 1, evoSpeed: 1, mutation: 0.5, sceneLen: 30, buildMin: 3, complexityCap: 1, trails: 0, brightness: 1,
};
const pct = (v) => Math.round(v * 100) + "%";
const SLIDERS = [
  ["reactivity", "Reactivity", 0, 2, 0.01, pct,
    "How hard the music pushes the picture around. Higher: bigger zoom kicks, spins and flashes on beats."],
  ["evoSpeed", "Evolution speed", 0, 3, 0.01, pct,
    "How fast the look slowly morphs on its own between scene changes. 0: it only changes when a scene mutates."],
  ["mutation", "Mutation strength", 0, 1, 0.01, pct,
    "How big a jump each scene change makes. Low: subtle tweaks. High: the picture can become something quite different at once."],
  ["sceneLen", "Max scene length", 8, 120, 1, (v) => Math.round(v) + " s",
    "The longest the picture goes without a scene change when the music doesn't trigger one."],
  ["buildMin", "Complexity swing", 0.5, 10, 0.1, (v) => v.toFixed(1) + " min",
    "How many minutes it takes to go from a calm, sparse picture to a busy, layered one, and back."],
  ["complexityCap", "Max complexity", 0, 1, 0.01, pct,
    "Caps how busy the picture can get. Lower: fewer stacked layers and math effects, a cleaner picture."],
  ["trails", "Trails", -1, 1, 0.01, (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.round(Math.abs(v) * 100) + "%",
    "How long the ghostly smear behind moving things lasts. +: long, smoky trails. −: crisp, short-lived shapes."],
  ["brightness", "Brightness", 0.3, 2, 0.01, pct,
    "Overall exposure. The picture still dims itself if stacked layers start to wash out to white."],
];

let opts = { ...DEFAULTS };
const $ = (id) => document.getElementById(id);

function save() { return browser.storage.local.set({ [KEY]: opts }); }

function buildSliders() {
  const box = $("sliders");
  for (const [key, label, lo, hi, step, fmt, tip] of SLIDERS) {
    const row = document.createElement("div");
    row.className = "row";
    row.title = tip;
    const l = document.createElement("label");
    l.textContent = label;
    l.htmlFor = "s_" + key;
    const out = document.createElement("output");
    const inp = document.createElement("input");
    Object.assign(inp, { type: "range", id: "s_" + key, min: lo, max: hi, step });
    inp.value = opts[key];
    out.textContent = fmt(+inp.value);
    inp.addEventListener("input", () => {
      opts[key] = +inp.value;
      out.textContent = fmt(+inp.value);
      save();
    });
    row.append(l, out, inp);
    box.append(row);
  }
}

function refreshInputs() {
  $("enabled").checked = !!opts.enabled;
  $("saveData").checked = !!opts.saveData;
  for (const [key, , , , , fmt] of SLIDERS) {
    const inp = $("s_" + key);
    inp.value = opts[key];
    inp.previousElementSibling.textContent = fmt(+inp.value);
  }
}

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab && /^https?:\/\/www\.youtube\.com\//.test(tab.url || "") ? tab : null;
}

async function send(cmd) {
  const tab = await activeTab();
  if (!tab) return null;
  try { return await browser.tabs.sendMessage(tab.id, { cmd }); } catch (e) { return null; }
}

const QUALITY = { tiny: "144p", small: "240p", medium: "360p", large: "480p", hd720: "720p", hd1080: "1080p", hd1440: "1440p", hd2160: "4K" };

function showStatus(s) {
  const box = $("status");
  box.textContent = "";
  if (!s) { box.textContent = "Open a YouTube video to see the visualizer."; return; }
  if (!s.active) { box.textContent = opts.enabled ? "Open a video to see the visualizer." : "The visualizer is off."; return; }
  const line = (text, bold) => {
    const d = document.createElement("div");
    if (bold) { const b = document.createElement("b"); b.textContent = text; d.append(b); } else d.textContent = text;
    box.append(d);
  };
  line(`Generation ${s.generation} · scene ${s.scene} · complexity ${s.complexity}% · ${s.fps} fps`, true);
  if (s.look) line(s.look);
  if (s.event) line(s.event);
  const sound = s.renderError ? "Can't draw: " + s.renderError
    : !s.connected ? (s.tapError ? "Sound: " + s.tapError : "Connecting to the sound…")
    : s.silent ? "Sound: silent (paused?)" : `Sound: connected${s.bpm ? " · " + s.bpm + " BPM" : ""}`;
  const q = s.quality ? ` · video ${QUALITY[s.quality] || s.quality}` : "";
  line(sound + q);
}

async function poll() { showStatus(await send("status")); }

browser.storage.local.get(KEY).then((r) => {
  opts = { ...DEFAULTS, ...(r[KEY] || {}) };
  buildSliders();
  refreshInputs();
  $("enabled").addEventListener("change", (e) => { opts.enabled = e.target.checked; save().then(() => setTimeout(poll, 300)); });
  $("saveData").addEventListener("change", (e) => { opts.saveData = e.target.checked; save(); });
  $("newSpecies").addEventListener("click", async () => showStatus(await send("newSpecies")));
  $("mutate").addEventListener("click", async () => showStatus(await send("mutate")));
  $("reset").addEventListener("click", () => {
    for (const [key] of SLIDERS) opts[key] = DEFAULTS[key];
    refreshInputs();
    save();
  });
  poll();
  setInterval(poll, 1000);
});
