// The evolving genome behind the visuals, and its mapping to shader parameters.
// A port of src/evolve.cpp; see that file for the longer explanations.
"use strict";

const G_NAMES = [
  "ZOOM", "ROT", "SWIRL", "WARP", "WARP_FREQ", "WARP_SPEED", "DRIFT_X", "DRIFT_Y", "DECAY", "HUE",
  "WAVE_SCALE", "WAVE_GAIN", "WAVE_THICK", "WAVE_SPIN", "WAVE_BRIGHT", "ROSE_K",
  "SPEC_RING", "SPEC_RADIUS", "TUNNEL", "SPARKLE", "ORBS",
  "PAL_C0", "PAL_C1", "PAL_C2", "PAL_D0", "PAL_D1", "PAL_D2", "PAL_SPEED", "PAL_SPREAD",
  "KSPIN", "CHROMA", "ECHO", "ECHO_ZOOM", "ECHO_SPIN",
  "BASS_ZOOM", "BEAT_KICK", "BEAT_FLASH",
  "FLAME", "FLAME_MIX", "AFF_ROT", "AFF_SCALE", "AFF_SHEAR", "AFF_X", "AFF_Y", "VAR_P1", "VAR_P2",
  "FLOW", "FLOW_SCALE", "FLOW_SPEED",
  "VIEW", "VIEW_P1", "VIEW_P2", "VIEW_SPEED",
  "TILE", "TILE_SCALE",
  "SF_M", "SF_N1", "SF_N2", "SF_N3", "LISS_A", "LISS_B", "LISS_SPEED",
  "ATTR", "ATTR_A", "ATTR_B", "ATTR_C", "ATTR_D", "ATTR_SCALE", "ATTR_SPIN",
];
const G = {};
G_NAMES.forEach((k, i) => (G[k] = i));
const G_COUNT = G_NAMES.length;

const C_NAMES = ["SHAPE", "COPIES", "KALEIDO", "MIRROR", "ECHO_FLIP", "TUNNEL_SIDES", "FLAME_A", "FLAME_B", "VIEW", "TILE", "ATTR"];
const C = {};
C_NAMES.forEach((k, i) => (C[k] = i));
const C_COUNT = C_NAMES.length;
const MAX_OPT = 24;

const GR_MOTION = 0, GR_COLOUR = 1, GR_SHAPE = 2, GR_LAYERS = 3, GR_SPACE = 4, GR_SYMMETRY = 5, GR_COUNT = 6;
const GM_ALL = (1 << GR_COUNT) - 1;

// name, lo, hi, calmLo, calmHi, gate, drift, group, math, integer
const M = true, INTG = true;
const GENES = [
  ["zoom", 0.985, 1.045, 1.0, 1.012, 0, true, GR_MOTION],
  ["rotation", -0.03, 0.03, -0.004, 0.004, 0, true, GR_MOTION],
  ["swirl", -0.035, 0.035, -0.006, 0.006, 0.2, true, GR_MOTION],
  ["warp", 0, 0.008, 0.0005, 0.002, 0, true, GR_MOTION],
  ["warp size", 2, 14, 3, 7, 0, true, GR_MOTION],
  ["warp speed", 0.2, 3, 0.3, 1, 0, true, GR_MOTION],
  ["drift", -0.004, 0.004, -0.0008, 0.0008, 0.3, true, GR_MOTION],
  ["drift", -0.004, 0.004, -0.0008, 0.0008, 0.3, true, GR_MOTION],
  ["trails", 0.9, 0.985, 0.93, 0.965, 0, true, GR_MOTION],
  ["colour drift", -0.03, 0.03, -0.006, 0.006, 0.15, true, GR_COLOUR],
  ["wave size", 0.12, 0.42, 0.2, 0.3, 0, true, GR_SHAPE],
  ["wave gain", 0.1, 0.8, 0.15, 0.4, 0, true, GR_SHAPE],
  ["wave thickness", 0.0015, 0.008, 0.002, 0.004, 0, true, GR_SHAPE],
  ["wave spin", -1.2, 1.2, -0.3, 0.3, 0, true, GR_SHAPE],
  ["wave brightness", 0.25, 1, 0.45, 0.8, 0, true, GR_SHAPE],
  ["petals", 2, 7, 2, 5, 0, false, GR_SHAPE, false, INTG],
  ["spectrum ring", 0, 1, 0.4, 0.8, 0.15, true, GR_LAYERS],
  ["ring radius", 0.05, 0.4, 0.15, 0.3, 0, true, GR_LAYERS],
  ["tunnel rings", 0, 1, 0.5, 0.9, 0.3, true, GR_LAYERS],
  ["sparkles", 0, 1, 0.4, 0.8, 0.45, true, GR_LAYERS],
  ["orbs", 0, 1, 0.4, 0.8, 0.55, true, GR_LAYERS],
  ["palette", 0.3, 1.6, 0.5, 1.1, 0, true, GR_COLOUR],
  ["palette", 0.3, 1.6, 0.5, 1.1, 0, true, GR_COLOUR],
  ["palette", 0.3, 1.6, 0.5, 1.1, 0, true, GR_COLOUR],
  ["palette", 0, 1, 0, 1, 0, true, GR_COLOUR],
  ["palette", 0, 1, 0, 1, 0, true, GR_COLOUR],
  ["palette", 0, 1, 0, 1, 0, true, GR_COLOUR],
  ["colour cycling", -0.25, 0.25, -0.06, 0.06, 0, true, GR_COLOUR],
  ["colour spread", 0.2, 3, 0.3, 1.2, 0, true, GR_COLOUR],
  ["kaleidoscope spin", -0.6, 0.6, -0.1, 0.1, 0, true, GR_SYMMETRY],
  ["chromatic split", 0, 0.03, 0.004, 0.01, 0.4, true, GR_LAYERS],
  ["echo", 0, 0.6, 0.2, 0.4, 0.5, true, GR_LAYERS],
  ["echo zoom", 0.5, 2, 0.8, 1.3, 0, true, GR_LAYERS],
  ["echo spin", -0.5, 0.5, -0.1, 0.1, 0, true, GR_LAYERS],
  ["bass zoom", 0, 0.03, 0, 0.01, 0, true, GR_MOTION],
  ["beat kick", 0, 1, 0, 0.4, 0, true, GR_MOTION],
  ["beat flash", 0, 0.25, 0.02, 0.08, 0.35, true, GR_LAYERS],
  ["flame warp", 0, 0.05, 0.006, 0.02, 0, true, GR_SPACE, M],
  ["flame blend", 0, 1, 0, 0.5, 0.1, true, GR_SPACE, M],
  ["flame turn", -3.1416, 3.1416, -0.5, 0.5, 0, true, GR_SPACE, M],
  ["flame scale", 0.6, 1.5, 0.85, 1.15, 0, true, GR_SPACE, M],
  ["flame shear", -0.6, 0.6, -0.15, 0.15, 0, true, GR_SPACE, M],
  ["flame shift", -0.4, 0.4, -0.1, 0.1, 0, true, GR_SPACE, M],
  ["flame shift", -0.4, 0.4, -0.1, 0.1, 0, true, GR_SPACE, M],
  ["flame shape", 0, 1, 0.2, 0.8, 0, true, GR_SPACE, M],
  ["flame shape", 0, 1, 0.2, 0.8, 0, true, GR_SPACE, M],
  ["curl flow", 0, 0.006, 0.0006, 0.002, 0.05, true, GR_SPACE, M],
  ["flow size", 1.5, 9, 2, 5, 0, true, GR_SPACE, M],
  ["flow speed", 0.05, 0.8, 0.1, 0.3, 0, true, GR_SPACE, M],
  ["complex lens", 0, 1, 0.35, 0.75, 0.15, true, GR_SPACE, M],
  ["lens shape", 0, 1, 0.2, 0.8, 0, true, GR_SPACE, M],
  ["lens shape", 0, 1, 0.2, 0.8, 0, true, GR_SPACE, M],
  ["lens drift", -0.4, 0.4, -0.1, 0.1, 0, true, GR_SPACE, M],
  ["wallpaper", 0, 1, 0.5, 0.85, 0.3, true, GR_SYMMETRY, M],
  ["tile size", 1.2, 4, 1.5, 2.5, 0, true, GR_SYMMETRY, M],
  ["superformula", 2, 12, 3, 7, 0, false, GR_SHAPE, false, INTG],
  ["superformula", 0.3, 3, 0.6, 2, 0, true, GR_SHAPE],
  ["superformula", 0.3, 3, 0.6, 2, 0, true, GR_SHAPE],
  ["superformula", 0.3, 3, 0.6, 2, 0, true, GR_SHAPE],
  ["lissajous", 1, 5, 1, 4, 0, false, GR_SHAPE, false, INTG],
  ["lissajous", 1, 6, 2, 5, 0, false, GR_SHAPE, false, INTG],
  ["lissajous turn", -0.6, 0.6, -0.2, 0.2, 0, true, GR_SHAPE],
  ["strange attractor", 0, 1, 0.4, 0.8, 0.2, true, GR_LAYERS, M],
  ["attractor", -2.4, 2.4, -1.8, 1.8, 0, true, GR_SPACE, M],
  ["attractor", -2.4, 2.4, -1.8, 1.8, 0, true, GR_SPACE, M],
  ["attractor", -1.5, 1.5, -1.0, 1.0, 0, true, GR_SPACE, M],
  ["attractor", -1.5, 1.5, -1.0, 1.0, 0, true, GR_SPACE, M],
  ["attractor size", 0.1, 0.2, 0.13, 0.17, 0, true, GR_LAYERS, M],
  ["attractor spin", -0.3, 0.3, -0.08, 0.08, 0, true, GR_LAYERS, M],
].map(([name, lo, hi, calmLo, calmHi, gate, drift, group, math = false, integer = false]) =>
  ({ name, lo, hi, calmLo, calmHi, gate, drift, group, math, integer }));
if (GENES.length !== G_COUNT) throw new Error("drift: gene table size");

// Genes that switch a layer or effect on. Genes in one row share a threshold.
const FEATURES = [
  [G.SWIRL], [G.HUE], [G.DRIFT_X, G.DRIFT_Y], [G.SPEC_RING], [G.TUNNEL], [G.SPARKLE],
  [G.ORBS], [G.CHROMA], [G.ECHO], [G.BEAT_FLASH],
  [G.FLAME], [G.FLAME_MIX], [G.FLOW], [G.VIEW], [G.TILE], [G.ATTR],
];

const ALL_BUT_0 = ~1 >>> 0;
const FLAMES = ["linear", "sinusoidal", "spherical", "swirl", "horseshoe", "polar", "handkerchief", "heart", "disc", "spiral",
  "hyperbolic", "diamond", "fisheye", "bubble", "waves", "power", "exponential", "sine", "Möbius", "Joukowski",
  "log-polar", "tangent", "cross", "pdj"];
const FLAME_GATES = [0, 0, 0, 0, .02, .02, .04, .04, .06, .06, .08, .08, .1, .1, .12, .12, .15, .15, .18, .18, .2, .22, .25, .28];
const range24 = Array.from({ length: 24 }, (_, i) => i);
const CHOICES = [
  { name: "wave shape", val: [0, 1, 2, 3, 4, 5, 6], gate: [0, 0, 0.1, 0.25, 0.35, 0, 0.1],
    label: ["circle", "line", "scope", "spiral", "rose", "superformula", "lissajous"], group: GR_SHAPE, mathMask: (1 << 5) | (1 << 6) },
  { name: "copies", val: [1, 2, 3, 4, 6], gate: [0, 0.2, 0.3, 0.45, 0.6], label: ["×1", "×2", "×3", "×4", "×6"], group: GR_SHAPE, mathMask: 0 },
  { name: "kaleidoscope", val: [1, 3, 4, 5, 6, 8, 12], gate: [0, 0.3, 0.3, 0.4, 0.4, 0.55, 0.7],
    label: ["off", "3", "4", "5", "6", "8", "12"], group: GR_SYMMETRY, mathMask: 0, noneFirst: true },
  { name: "mirror", val: [0, 1, 2, 3], gate: [0, 0.35, 0.45, 0.6], label: ["none", "left-right", "top-bottom", "four-way"],
    group: GR_SYMMETRY, mathMask: 0, noneFirst: true },
  { name: "echo flip", val: [0, 1, 2, 3], gate: [0, 0, 0, 0], label: ["none", "flip X", "flip Y", "flip XY"], group: GR_LAYERS, mathMask: 0, noneFirst: true },
  { name: "tunnel shape", val: [0, 3, 4, 6], gate: [0, 0, 0, 0], label: ["circles", "triangles", "squares", "hexagons"], group: GR_LAYERS, mathMask: 0 },
  { name: "flame", val: range24, gate: FLAME_GATES, label: FLAMES, group: GR_SPACE, mathMask: ALL_BUT_0 },
  { name: "flame", val: range24, gate: FLAME_GATES, label: FLAMES, group: GR_SPACE, mathMask: ALL_BUT_0 },
  { name: "lens", val: range24.slice(0, 12), gate: [0, 0, .05, .05, .1, .1, .15, .15, .2, .25, .25, .3],
    label: ["none", "power", "inversion", "Möbius", "Droste", "tunnel", "hyperbolic", "twist", "barrel", "complex sine", "Joukowski", "unwrap"],
    group: GR_SPACE, mathMask: ALL_BUT_0, noneFirst: true },
  { name: "tiling", val: [0, 1, 2, 3, 4, 5], gate: [0, .3, .3, .35, .4, .45], label: ["none", "p4m", "p6m", "p3m1", "bricks", "pinwheel"],
    group: GR_SYMMETRY, mathMask: ALL_BUT_0, noneFirst: true },
  { name: "attractor", val: [0, 1, 2, 3], gate: [0, .05, .1, .15], label: ["Clifford", "de Jong", "Svensson", "dream"], group: GR_SPACE, mathMask: ALL_BUT_0 },
].map((c) => ({ noneFirst: false, ...c, n: c.val.length }));

const TRIGGERS = [
  ["sections", XF.T_SECTION, XI.T_SECTION, "The music changed"],
  ["drops", XF.T_DROP, XI.T_DROP, "Bass drop"],
  ["builds", XF.T_BUILD, XI.T_BUILD, "Build-up"],
  ["breaks", XF.T_BREAK, XI.T_BREAK, "Breakdown"],
  ["toneShifts", XF.T_BRIGHT, XI.T_BRIGHT, "Tone shift"],
  ["hatRushes", XF.T_HATS, XI.T_HATS, "Hi-hats picked up"],
  ["vocals", XF.T_VOCAL, XI.T_VOCAL, "Vocals / lead came in"],
  ["tempoChanges", XF.T_TEMPO, XI.T_TEMPO, "Tempo changed"],
  ["hits", XF.T_HIT, XI.T_HIT, "Big hit"],
];
const TARGET_SHORT = ["everything", "motion", "colour", "shape", "layers", "math space", "symmetry", "new species"];

// The two strongest options of a cross-fading choice, and how far the second one is mixed in.
function top2(w, n) {
  let a = 0;
  for (let o = 1; o < n; o++) if (w[o] > w[a]) a = o;
  let b = -1;
  for (let o = 0; o < n; o++) if (o !== a && (b < 0 || w[o] > w[b])) b = o;
  const wa = w[a], wb = b >= 0 ? w[b] : 0;
  if (b < 0) b = a;
  return [a, b, wb / Math.max(wa + wb, 1e-4)];
}

// Small fast PRNG (sfc32) seeded from the browser's entropy, so every page load differs.
function makeRng() {
  const s = new Uint32Array(4);
  crypto.getRandomValues(s);
  let [a, b, c, d] = s;
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

class Evolver {
  constructor(settings) {
    this.rnd = makeRng();
    this.g = new Float32Array(G_COUNT);
    this.w = Array.from({ length: C_COUNT }, () => new Float32Array(MAX_OPT));
    this.choice = new Int32Array(C_COUNT);
    this.complexity = 0;
    this.generation = 1;
    this.scene = 1;
    this.lastEvent = "";
    this.LATENT = 6;
    this.base = new Float32Array(G_COUNT);
    this.tgt = new Float32Array(G_COUNT);
    this.vel = new Float32Array(G_COUNT);
    this.loadL = Array.from({ length: G_COUNT }, () => new Float32Array(this.LATENT));
    this.loadZ = Array.from({ length: G_COUNT }, () => new Float32Array(3));
    this.z = new Float32Array(this.LATENT);
    this.lor = [1, 1, 20];
    this.steerMul = new Float32Array(GR_COUNT).fill(1);
    this.feat = new Float32Array(GR_COUNT);
    this.relGate = new Float32Array(G_COUNT);
    this.relOpt = Array.from({ length: C_COUNT }, () => new Float32Array(MAX_OPT));
    this.mathJit = 0;
    this.easeMul = new Float32Array(G_COUNT);
    this.fadeMul = new Float32Array(C_COUNT);
    this.cxTarget = 0.5; this.cxTimer = 0; this.sceneFrac = 1;
    this.set = settings;
    this.sceneTime = 0; this.silentTime = 0; this.boost = 0; this.prevComplexity = 0; this.sinceEvent = 100;
    this.mathGate = settings.x[XF.M_GATE];
    this.lastBeats = -1; this.phraseBeats = 0;
    this.lastCount = new Int32Array(9);
    this.countsInit = false;
    this.favs = [];   // kept looks: [complexity, ...genes, ...choices]

    this.newGates();
    this.newPacing();
    this.complexity = this.prevComplexity = this.startComplexity();
    this.randomize();
    this.newLoadings();
    for (let i = 0; i < G_COUNT; i++) this.g[i] = this.base[i] = this.tgt[i];
    for (let c = 0; c < C_COUNT; c++) for (let o = 0; o < MAX_OPT; o++) this.w[c][o] = o === this.choice[c] ? 1 : 0;
    this.lastEvent = "Started from a fresh random look";
  }

  uni(a = 0, b = 1) { return a + (b - a) * this.rnd(); }
  gauss() {
    const u = Math.max(this.rnd(), 1e-12), v = this.rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  pick(n) { return Math.min(n - 1, Math.floor(this.rnd() * n)); }

  spMath() { return clamp(this.mathGate + this.mathJit, 0, 0.9); }
  gateOf(i) { const r = this.relGate[i]; return r < 0 ? 0 : r + (GENES[i].math ? this.spMath() : 0); }
  optGate(c, o) { const r = this.relOpt[c][o]; return r < 0 ? 0 : r + ((CHOICES[c].mathMask >>> o) & 1 ? this.spMath() : 0); }

  range(i) {
    const d = GENES[i], gate = this.gateOf(i);
    if (this.complexity < gate) return [0, 0];
    const f = clamp((this.complexity - gate) / Math.max(1 - gate, 1e-3), 0, 1);
    return [d.calmLo + (d.lo - d.calmLo) * f, d.calmHi + (d.hi - d.calmHi) * f];
  }

  pickChoice(c, mustChange) {
    const d = CHOICES[c], opts = [];
    for (let o = 0; o < d.n; o++) if (this.optGate(c, o) <= this.complexity && !(mustChange && o === this.choice[c])) opts.push(o);
    const n = opts.length;
    if (!n) return;
    // "Off" keeps a fair share, or every look would end up kaleidoscoped, mirrored and tiled.
    const o = d.noneFirst && opts[0] === 0 && n > 1 ? (this.uni() < 0.35 ? 0 : opts[1 + this.pick(n - 1)]) : opts[this.pick(n)];
    if (o !== this.choice[c]) this.fadeMul[c] = this.uni(0.35, 2);
    this.choice[c] = o;
  }

  newGates() {
    this.mathJit = this.uni(-0.3, 0.3);
    this.relGate.fill(-1);
    for (const f of FEATURES) {
      const r = this.uni();
      const gate = r < 0.15 ? 0 : r < 0.3 ? 9 : GENES[f[0]].math ? this.uni(0, 0.3) : this.uni(0, 0.75);
      for (const j of f) this.relGate[j] = gate;
    }
    for (let c = 0; c < C_COUNT; c++) {
      const d = CHOICES[c];
      let gated = d.mathMask !== 0;
      for (let o = 0; o < d.n; o++) gated = gated || d.gate[o] > 0;
      for (let o = 0; o < MAX_OPT; o++)
        this.relOpt[c][o] = !gated || o >= d.n ? -1 : (d.mathMask >>> o) & 1 ? this.uni(0, 0.3) : this.uni(0, 0.8);
      this.relOpt[c][d.noneFirst ? 0 : this.pick(d.n)] = -1;
    }
  }

  newPacing() {
    for (let i = 0; i < G_COUNT; i++) this.easeMul[i] = this.uni(0.5, 1.6);
    for (let c = 0; c < C_COUNT; c++) this.fadeMul[c] = this.uni(0.5, 1.6);
    this.sceneFrac = this.uni(0.35, 1);
    this.cxTimer = 0;
  }

  startComplexity() {
    const lo = this.set.x[XF.START_CX];
    return this.uni(lo, Math.max(lo, 0.85 * this.set.complexityCap));
  }

  randomize() {
    for (let i = 0; i < G_COUNT; i++) {
      const [lo, hi] = this.range(i);
      this.tgt[i] = GENES[i].integer ? Math.round(this.uni(lo, hi)) : this.uni(lo, hi);
      this.vel[i] = 0;
    }
    for (let c = 0; c < C_COUNT; c++) this.pickChoice(c, false);
  }

  newLoadings() {
    for (let i = 0; i < G_COUNT; i++) {
      this.loadL[i].fill(0);
      this.loadZ[i].fill(0);
      if (GENES[i].integer) continue;
      const sgn = () => (this.uni() < 0.5 ? -1 : 1);
      this.loadL[i][this.pick(this.LATENT)] = sgn() * this.uni(0.5, 1);
      if (this.uni() < 0.4) this.loadL[i][this.pick(this.LATENT)] += sgn() * this.uni(0.3, 0.8);
      if (this.uni() < 0.35) this.loadZ[i][this.pick(3)] = sgn() * this.uni(0.5, 1);
    }
    for (let f = 0; f < this.LATENT; f++) this.z[f] = this.gauss();
    this.lor = [this.uni(-8, 8), this.uni(-8, 8), this.uni(15, 30)];
  }

  mutateScene(strength, why, groups = GM_ALL) {
    this.scene++;
    this.sceneTime = 0;
    let genes = [], chs = [];
    for (let pass = 0; pass < 2 && (!genes.length || !chs.length); pass++) {
      const gm = pass ? GM_ALL : groups;
      if (!genes.length)
        for (let i = 0; i < G_COUNT; i++) {
          const [lo, hi] = this.range(i);
          if ((gm >>> GENES[i].group) & 1 && hi > lo) genes.push(i);
        }
      if (!chs.length)
        for (let c = 0; c < C_COUNT; c++) {
          if (!((gm >>> CHOICES[c].group) & 1)) continue;
          let open = 0;
          for (let o = 0; o < CHOICES[c].n; o++) open += this.optGate(c, o) <= this.complexity ? 1 : 0;
          if (open > 1) chs.push(c);
        }
    }
    const k = Math.max(1, Math.round(this.set.x[XF.GENES_PER_SCENE] * (0.33 + 1.33 * strength)));
    for (let i = 0; i < k && genes.length; i++) {
      const gi = genes[this.pick(genes.length)];
      const [lo, hi] = this.range(gi);
      if (GENES[gi].integer) { this.tgt[gi] = Math.round(this.uni(lo, hi)); continue; }
      const mix = 0.5 + 0.5 * strength;
      this.tgt[gi] += (this.uni(lo, hi) - this.tgt[gi]) * mix;
      this.easeMul[gi] = this.uni(0.35, 2);
    }
    // Always change at least one discrete gene so a scene change is visible.
    const changed = [];
    let nc = 1;
    const extra = Math.round(this.set.x[XF.CHOICES_PER_SCENE]);
    for (let j = 1; j <= extra; j++) nc += this.uni() < strength / j ? 1 : 0;
    for (let i = 0; i < nc && chs.length; i++) {
      const j = this.pick(chs.length), c = chs[j];
      chs[j] = chs[chs.length - 1];
      chs.pop();
      const before = this.choice[c];
      this.pickChoice(c, true);
      if (this.choice[c] !== before) changed.push(`${CHOICES[c].name} → ${CHOICES[c].label[this.choice[c]]}`);
    }
    this.boost = Math.max(this.boost, this.uni(0.15, 1.2));
    this.sceneFrac = this.uni(0.35, 1);
    this.lastEvent = why + (changed.length ? ": " + changed.join(", ") : "");
  }

  newSpecies(why) {
    this.generation++;
    this.scene = 1;
    this.sceneTime = 0;
    this.newLoadings();
    this.newGates();
    this.newPacing();
    const X = this.set.x;
    if (this.favs.length && this.uni() < X[XF.BREED]) {
      const A = this.favs[this.pick(this.favs.length)], B = this.favs[this.pick(this.favs.length)];
      this.complexity = Math.max(X[XF.START_CX], 0.5 * (A[0] + B[0]) * 0.8);
      for (let i = 0; i < G_COUNT; i++) {
        let v = (this.uni() < 0.5 ? A : B)[1 + i];
        if (Number.isNaN(v)) v = (this.uni() < 0.5 ? B : A)[1 + i];
        if (!Number.isNaN(v) && this.relGate[i] >= 0 && Math.abs(v) > 0.05 * (GENES[i].hi - GENES[i].lo)) this.relGate[i] = -1;
        const [lo, hi] = this.range(i);
        if (Number.isNaN(v)) v = this.uni(lo, hi);
        else if (!GENES[i].integer) v += this.gauss() * X[XF.BREED_JITTER] * (hi - lo);
        this.tgt[i] = v;
        this.vel[i] = 0;
      }
      for (let c = 0; c < C_COUNT; c++) {
        this.choice[c] = clamp(Math.trunc((this.uni() < 0.5 ? A : B)[1 + G_COUNT + c]), 0, CHOICES[c].n - 1);
        this.relOpt[c][this.choice[c]] = -1;
      }
      this.lastEvent = why + ": bred from two of your kept looks";
    } else {
      this.complexity = this.startComplexity();
      this.randomize();
      this.lastEvent = why + ": a fresh random look";
    }
    this.prevComplexity = this.complexity;
    this.boost = 2;
  }

  update(dt, a, s) {
    this.set = s;
    this.mathGate = s.x[XF.M_GATE];
    const X = s.x;
    if (this.lastBeats < 0) this.lastBeats = a.beats;
    const beat = a.beats !== this.lastBeats;
    this.lastBeats = a.beats;

    // Which audio events happened since last frame; the one with the largest amount wins.
    let best = -1, bestAmt = 0.005;
    for (let i = 0; i < 9; i++) {
      const c = a[TRIGGERS[i][0]];
      if (this.countsInit && c !== this.lastCount[i] && X[TRIGGERS[i][1]] > bestAmt) { best = i; bestAmt = X[TRIGGERS[i][1]]; }
      this.lastCount[i] = c;
    }
    this.countsInit = true;
    if (a.silent) this.phraseBeats = 0;
    else if (beat && ++this.phraseBeats >= PHRASE_BEATS[clamp(s.xi[XI.PHRASE_LEN], 0, 3)]) {
      this.phraseBeats = 0;
      if (X[XF.T_PHRASE] > bestAmt) { best = 9; bestAmt = X[XF.T_PHRASE]; }
    }
    this.sinceEvent += dt;

    // Audio steering: each group's drift speed follows one feature of the music.
    {
      const fv = [0.5, a.level, clamp((a.bass - 0.6) / 1.4, 0, 1), clamp((a.mid - 0.6) / 1.4, 0, 1),
        clamp((a.treb - 0.6) / 1.4, 0, 1), a.bright, a.beatDensity, clamp(a.novelty / 6, 0, 1)];
      const kf = 1 - Math.exp(-dt * 1.5);
      for (let gr = 0; gr < GR_COUNT; gr++) {
        const st = clamp(s.xi[XI.ST_MOTION + gr], 0, 7);
        this.feat[gr] += (fv[st] - this.feat[gr]) * kf;
        this.steerMul[gr] = st === ST_OFF ? 1 : 1 + (0.2 + 2.2 * this.feat[gr] - 1) * X[XF.STEER];
      }
    }

    if (!s.freeze) {
      this.sceneTime += dt;
      if (a.silent) {
        this.silentTime += dt;
        if (this.silentTime > 2) this.complexity = Math.max(0, this.complexity - dt * X[XF.DRAIN]);
      } else {
        if (this.silentTime > X[XF.NEWSONG]) this.newSpecies("New song");
        this.silentTime = 0;
        const swing = Math.max(6, s.buildMin * 60);
        this.cxTimer -= dt;
        if (this.cxTimer <= 0) { this.cxTarget = this.uni(0.1, 1); this.cxTimer = swing * this.uni(0.15, 0.6); }
        const step = dt / swing, want = this.cxTarget * s.complexityCap;
        this.complexity += clamp(want - this.complexity, -step, step);
      }
      if (this.complexity > s.complexityCap) this.complexity = Math.max(s.complexityCap, this.complexity - dt * 0.1);

      for (let i = 0; i < G_COUNT; i++) {
        const d = GENES[i], gate = this.gateOf(i);
        if (gate > 0 && this.prevComplexity < gate && this.complexity >= gate)
          this.tgt[i] = d.integer ? Math.round(this.uni(d.calmLo, d.calmHi)) : this.uni(d.calmLo, d.calmHi);
      }
      this.prevComplexity = this.complexity;

      // Slow drift: each gene's target wanders (a damped random walk) inside its allowed range.
      const sq = Math.sqrt(Math.max(dt, 1e-4)), damp = Math.exp(-dt * X[XF.DAMPING]);
      for (let i = 0; i < G_COUNT; i++) {
        const [lo, hi] = this.range(i);
        if (GENES[i].drift && hi > lo) {
          this.vel[i] = this.vel[i] * damp + this.gauss() * sq * 0.8;
          this.tgt[i] += this.vel[i] * dt * 0.04 * s.evoSpeed * this.steerMul[GENES[i].group] * (hi - lo);
        }
        if (this.tgt[i] < lo) { this.tgt[i] = lo + Math.min(lo - this.tgt[i], hi - lo); this.vel[i] = Math.abs(this.vel[i]); }
        if (this.tgt[i] > hi) { this.tgt[i] = hi - Math.min(this.tgt[i] - hi, hi - lo); this.vel[i] = -Math.abs(this.vel[i]); }
        this.tgt[i] = clamp(this.tgt[i], lo, hi);
      }

      // Shared drift: latent factors (Ornstein-Uhlenbeck, unit variance) and the Lorenz system.
      const th = 0.12 * s.evoSpeed, sd = Math.sqrt(2 * th * Math.max(dt, 1e-4));
      for (let f = 0; f < this.LATENT; f++) this.z[f] += -this.z[f] * th * dt + sd * this.gauss();
      let hl = dt * 0.15 * s.evoSpeed;
      const steps = Math.max(1, Math.ceil(hl / 0.004));
      hl /= steps;
      const L = this.lor;
      for (let k = 0; k < steps; k++) {
        const dx = 10 * (L[1] - L[0]), dy = L[0] * (28 - L[2]) - L[1], dz = L[0] * L[1] - (8 / 3) * L[2];
        L[0] += dx * hl; L[1] += dy * hl; L[2] += dz * hl;
      }

      if (beat && this.uni() < X[XF.NUDGE_CHANCE] * s.evoSpeed) {
        const gi = this.pick(G_COUNT);
        if (GENES[gi].drift) {
          const [lo, hi] = this.range(gi);
          this.tgt[gi] += (this.uni(lo, hi) - this.tgt[gi]) * X[XF.NUDGE_SIZE] * (0.4 + 1.2 * s.mutation);
        }
      }

      // Scene changes: an audio event (each with its own target), or the scene ran its length.
      if (best >= 0 && this.sinceEvent >= X[XF.T_COOLDOWN]) {
        const tg = clamp(best === 9 ? s.xi[XI.T_PHRASE] : s.xi[TRIGGERS[best][2]], 0, 7);
        const name = best === 9 ? "New phrase" : TRIGGERS[best][3];
        this.sinceEvent = 0;
        if (tg === TGT_SPECIES) this.newSpecies(name);
        else
          this.mutateScene(Math.min(1, bestAmt * (0.4 + 0.6 * s.mutation) * this.uni(0.6, 1.4)),
            `${name} (${TARGET_SHORT[tg]})`, tg === TGT_ALL ? GM_ALL : 1 << (tg - 1));
      } else if (this.sceneTime > s.sceneLen * this.sceneFrac) {
        let gm = GM_ALL;
        if (this.uni() < 0.75) {
          gm = 0;
          for (let j = 1 + this.pick(3); j > 0; j--) gm |= 1 << this.pick(GR_COUNT);
        }
        this.mutateScene(clamp((0.25 + 0.5 * s.mutation) * this.uni(0.4, 1.6), 0.05, 1), "Scene timer", gm);
      }

      for (let c = 0; c < C_COUNT; c++) if (this.optGate(c, this.choice[c]) > this.complexity) this.pickChoice(c, false);
    }

    // Ease toward the targets (faster right after a new species), then add the shared drift.
    const L = this.lor, ln = [L[0] / 18, L[1] / 24, (L[2] - 24) / 18];
    for (let i = 0; i < G_COUNT; i++) {
      const k = 1 - Math.exp(-dt * (0.6 + this.boost) * X[XF.EASE] * this.easeMul[i]);
      this.base[i] += (this.tgt[i] - this.base[i]) * k;
      const [lo, hi] = this.range(i);
      if (GENES[i].integer || hi <= lo) { this.g[i] = this.base[i]; continue; }
      let off = 0;
      for (let f = 0; f < this.LATENT; f++) off += this.loadL[i][f] * this.z[f] * 0.25 * X[XF.LATENT];
      for (let j = 0; j < 3; j++) off += this.loadZ[i][j] * ln[j] * 0.3 * X[XF.LORENZ];
      this.g[i] = clamp(this.base[i] + off * (hi - lo), lo, hi);
    }
    for (let c = 0; c < C_COUNT; c++) {
      const kc = 1 - Math.exp(-dt * (0.8 + this.boost) * X[XF.FADE] * this.fadeMul[c]);
      const w = this.w[c];
      for (let o = 0; o < MAX_OPT; o++) w[o] += ((o === this.choice[c] ? 1 : 0) - w[o]) * kc;
    }
    this.boost = Math.max(0, this.boost - dt * 1.5);
  }

  describe() {
    const tgt = this.tgt, ch = this.choice;
    const L = (c) => CHOICES[c].label[clamp(ch[c], 0, CHOICES[c].n - 1)];
    let s = L(C.SHAPE);
    if (ch[C.COPIES] > 0) s += " " + L(C.COPIES);
    if (ch[C.KALEIDO] > 0) s += " · kaleidoscope " + L(C.KALEIDO);
    if (ch[C.MIRROR] > 0) s += " · mirror " + L(C.MIRROR);
    const layers = [[G.SPEC_RING, 0.1, "spectrum ring"], [G.TUNNEL, 0.1, "tunnel"], [G.SPARKLE, 0.1, "sparkles"],
      [G.ORBS, 0.1, "orbs"], [G.ECHO, 0.08, "echo"], [G.CHROMA, 0.004, "chroma split"], [G.FLOW, 0.0004, "curl flow"]];
    for (const [g, min, name] of layers) if (tgt[g] > min) s += " · " + name;
    if (tgt[G.FLAME] > 0.002) s += " · flame " + L(C.FLAME_A) + (tgt[G.FLAME_MIX] > 0.3 ? "+" + L(C.FLAME_B) : "");
    if (tgt[G.VIEW] > 0.1 && ch[C.VIEW] > 0) s += ` · ${L(C.VIEW)} lens`;
    if (tgt[G.TILE] > 0.1 && ch[C.TILE] > 0) s += ` · ${L(C.TILE)} tiling`;
    if (tgt[G.ATTR] > 0.1) s += ` · ${L(C.ATTR)} attractor`;
    return s;
  }
}

/* ------------------------------ shader parameters ------------------------------ */
class Visuals {
  constructor() {
    const r = Math.random, TAU = 6.2831853;
    this.time = r() * 500;
    this.warpPhase = r() * 100; this.palPhase = r() * 10; this.flowPhase = r() * 100; this.viewPhase = r() * 100;
    this.lissPhase = r() * 100; this.orbPhase = r() * 100;
    this.waveAngle = r() * TAU; this.kSpin = r() * TAU; this.echoAngle = r() * TAU; this.attrAngle = r() * TAU;
    this.pulse = 0; this.bass = 1; this.mid = 1; this.treb = 1;
    this.lastBeats = -1;
    this.frame = 0;
    this.rings = Array.from({ length: 8 }, () => [0, 0]);
    this.fill = 0;
  }

  // Fills P (Float32Array(160)) and returns { copies, attrPoints }.
  build(P, e, a, s, dt, w, h, meanLum) {
    P.fill(0);
    const g = e.g, X = s.x, S = PARAMS;
    this.time += dt;
    this.frame++;
    const ms = X[XF.MOTION_SPEED];
    const f60 = Math.min(dt * 60, 3), fm = f60 * ms, R = s.reactivity;
    const k = 1 - Math.exp(-dt * 15);
    this.bass += (a.bass - this.bass) * k; this.mid += (a.mid - this.mid) * k; this.treb += (a.treb - this.treb) * k;
    const beat = this.lastBeats >= 0 && a.beats !== this.lastBeats;
    this.lastBeats = a.beats;
    if (beat) this.pulse = 1;
    this.pulse *= Math.exp(-dt * 6);
    const pulse = this.pulse;
    const bassX = Math.min(Math.max(0, this.bass - 1) * R, 2), midX = Math.min(Math.max(0, this.mid - 1) * R, 2);

    P[S.S_RES_X] = w; P[S.S_RES_Y] = h; P[S.S_ASPECT] = w / h; P[S.S_TIME] = this.time;

    // Brightness control (see evolve.cpp).
    const target = X[XF.EXPO_TARGET];
    if (meanLum >= 0) {
      const over = clamp((meanLum * (1 + g[G.ECHO] * X[XF.L_ECHO]) - target) / target, 0, 3);
      this.fill += (over - this.fill) * (1 - Math.exp(-dt * (over > this.fill ? 2 : 0.7)));
    }
    const fl = this.fill * X[XF.EXPO_AUTO];

    const zoom = g[G.ZOOM] + X[XF.ZOOM_BIAS] * 0.01 + g[G.BASS_ZOOM] * bassX + g[G.BEAT_KICK] * pulse * 0.012 * R;
    P[S.S_ZOOM] = Math.pow(Math.max(zoom, 0.5), fm);
    P[S.S_ROT] = (g[G.ROT] + X[XF.ROT_BIAS] * 0.01 + g[G.BEAT_KICK] * pulse * 0.008 * R * (g[G.ROT] >= 0 ? 1 : -1)) * fm;
    P[S.S_SWIRL] = g[G.SWIRL] * fm;
    P[S.S_WARP] = g[G.WARP] * (1 + 0.6 * midX) * fm;
    P[S.S_WARP_FREQ] = g[G.WARP_FREQ];
    this.warpPhase += g[G.WARP_SPEED] * dt * (1 + 0.3 * R * a.level) * ms;
    P[S.S_WARP_PHASE] = this.warpPhase;
    P[S.S_DRIFT_X] = g[G.DRIFT_X] * fm;
    P[S.S_DRIFT_Y] = g[G.DRIFT_Y] * fm;
    P[S.S_DECAY] = Math.pow(clamp(g[G.DECAY] + s.trails * 0.035 - 0.025 * Math.min(fl, 1.5), 0.8, 0.995), f60);
    P[S.S_HUE] = g[G.HUE] * f60 * X[XF.HUE_SPEED];
    const mw = e.w[C.MIRROR];
    P[S.S_MIRROR_X] = (mw[1] + mw[3]) * X[XF.L_MIRROR];
    P[S.S_MIRROR_Y] = (mw[2] + mw[3]) * X[XF.L_MIRROR];

    {
      const [a1, a2, ma] = top2(e.w[C.FLAME_A], CHOICES[C.FLAME_A].n);
      const [b1, b2, mb] = top2(e.w[C.FLAME_B], CHOICES[C.FLAME_B].n);
      const fb = clamp(g[G.FLAME_MIX], 0, 1);
      const vw = [(1 - ma) * (1 - fb), ma * (1 - fb), (1 - mb) * fb, mb * fb], vi = [a1, a2, b1, b2];
      for (let i = 0; i < 4; i++) { P[S.S_VAR_IDX + i] = vi[i]; P[S.S_VAR_W + i] = vw[i]; }
      P[S.S_FLAME] = clamp(g[G.FLAME] * X[XF.M_FLAME] * (1 + 0.5 * pulse * R) * fm, 0, 0.3);
      P[S.S_AFF_ROT] = g[G.AFF_ROT]; P[S.S_AFF_SCALE] = g[G.AFF_SCALE]; P[S.S_AFF_SHEAR] = g[G.AFF_SHEAR];
      P[S.S_AFF_X] = g[G.AFF_X]; P[S.S_AFF_Y] = g[G.AFF_Y]; P[S.S_VAR_P1] = g[G.VAR_P1]; P[S.S_VAR_P2] = g[G.VAR_P2];
    }
    P[S.S_FLOW] = g[G.FLOW] * X[XF.M_FLOW] * (1 + 0.5 * midX) * fm;
    P[S.S_FLOW_SCALE] = g[G.FLOW_SCALE];
    this.flowPhase += g[G.FLOW_SPEED] * dt * ms;
    P[S.S_FLOW_PHASE] = this.flowPhase;
    P[S.S_VIGNETTE] = X[XF.VIGNETTE];

    {
      let [a1, a2, m] = top2(e.w[C.VIEW], CHOICES[C.VIEW].n);
      P[S.S_VIEW_A] = a1; P[S.S_VIEW_B] = a2; P[S.S_VIEW_MIX] = m;
      P[S.S_VIEW_AMT] = g[G.VIEW] * X[XF.M_VIEW];
      P[S.S_VIEW_P1] = g[G.VIEW_P1]; P[S.S_VIEW_P2] = g[G.VIEW_P2];
      this.viewPhase += g[G.VIEW_SPEED] * dt * ms;
      P[S.S_VIEW_PHASE] = this.viewPhase;
      [a1, a2, m] = top2(e.w[C.TILE], CHOICES[C.TILE].n);
      P[S.S_TILE_A] = a1; P[S.S_TILE_B] = a2; P[S.S_TILE_MIX] = m;
      P[S.S_TILE_AMT] = g[G.TILE] * X[XF.M_TILE];
      P[S.S_TILE_SCALE] = Math.max(g[G.TILE_SCALE], 0.5);
    }
    P[S.S_KAMT] = X[XF.L_KALEIDO];
    P[S.S_USER_SAT] = X[XF.SATURATION];

    for (let i = 0; i < 3; i++) { P[S.S_PAL_C + i] = g[G.PAL_C0 + i]; P[S.S_PAL_D + i] = g[G.PAL_D0 + i]; }
    this.palPhase += g[G.PAL_SPEED] * dt * X[XF.PAL_SPEED];
    P[S.S_PAL_PHASE] = this.palPhase;
    P[S.S_PAL_SPREAD] = g[G.PAL_SPREAD];

    P[S.S_SPEC_RING] = g[G.SPEC_RING] * X[XF.L_SPEC];
    P[S.S_SPEC_RADIUS] = g[G.SPEC_RADIUS];
    P[S.S_TUNNEL] = g[G.TUNNEL] * X[XF.L_TUNNEL];
    P[S.S_TUNNEL_SIDES] = CHOICES[C.TUNNEL_SIDES].val[e.choice[C.TUNNEL_SIDES]];
    P[S.S_SPARKLE] = g[G.SPARKLE] * X[XF.L_SPARKLE];
    P[S.S_ORBS] = g[G.ORBS] * X[XF.L_ORBS];
    P[S.S_BASS] = this.bass; P[S.S_MID] = this.mid; P[S.S_TREB] = this.treb; P[S.S_LEVEL] = a.level;
    P[S.S_ADD] = f60;
    this.orbPhase += dt * (0.4 + 0.8 * a.level * R) * ms;
    P[S.S_ORB_PHASE] = this.orbPhase;

    const sw = e.w[C.SHAPE];
    for (let i = 0; i < 5; i++) P[S.S_W_CIRCLE + i] = sw[i];
    const mshape = X[XF.M_SHAPES];
    P[S.S_W_SUPER] = sw[5] * mshape;
    P[S.S_W_LISS] = sw[6] * mshape;
    P[S.S_W_CIRCLE] += (sw[5] + sw[6]) * (1 - mshape);
    P[S.S_SF_M] = g[G.SF_M]; P[S.S_SF_N1] = Math.max(g[G.SF_N1], 0.2); P[S.S_SF_N2] = g[G.SF_N2]; P[S.S_SF_N3] = g[G.SF_N3];
    P[S.S_LISS_A] = g[G.LISS_A]; P[S.S_LISS_B] = g[G.LISS_B];
    this.lissPhase += g[G.LISS_SPEED] * dt;
    P[S.S_LISS_PHASE] = this.lissPhase;
    P[S.S_WAVE_SCALE] = g[G.WAVE_SCALE] * (1 + 0.12 * pulse * R);
    P[S.S_WAVE_GAIN] = g[G.WAVE_GAIN] * (0.3 + 0.7 * R);
    P[S.S_WAVE_THICK] = g[G.WAVE_THICK] * X[XF.WAVE_THICK];
    this.waveAngle += g[G.WAVE_SPIN] * dt;
    P[S.S_WAVE_ANGLE] = this.waveAngle;
    P[S.S_WAVE_BRIGHT] = g[G.WAVE_BRIGHT] * (0.35 + 0.9 * a.level) * X[XF.L_WAVE];
    P[S.S_ROSE_K] = g[G.ROSE_K];
    let eff = 0;
    const alpha = [0, 0, 0, 0, 0, 0];
    const cw = e.w[C.COPIES], cv = CHOICES[C.COPIES].val;
    for (let o = 0; o < cv.length; o++) {
      eff += cw[o] * cv[o];
      for (let c = 0; c < 6; c++) if (c < cv[o]) alpha[c] += cw[o];
    }
    P[S.S_COPIES] = Math.max(eff, 1);
    let copies = 1;
    for (let c = 0; c < 6; c++) {
      P[S.S_COPY_ALPHA + c] = alpha[c];
      if (alpha[c] > 0.002) copies = c + 1;
    }

    let attrPoints;
    {
      const amt = g[G.ATTR] * X[XF.L_ATTR];
      const pts = clamp(Math.trunc(X[XF.ATTR_POINTS] * 1000), 1000, 200000);
      attrPoints = amt > 0.002 ? pts : 0;
      const size = X[XF.ATTR_SIZE] * Math.max(1, h / 1080);
      P[S.S_ATTR_A] = g[G.ATTR_A] + 0.06 * bassX;
      P[S.S_ATTR_A + 1] = g[G.ATTR_B] - 0.04 * midX;
      P[S.S_ATTR_A + 2] = g[G.ATTR_C];
      P[S.S_ATTR_A + 3] = g[G.ATTR_D];
      const [a1, a2, m] = top2(e.w[C.ATTR], CHOICES[C.ATTR].n);
      P[S.S_ATTR_FAM_A] = a1; P[S.S_ATTR_FAM_B] = a2; P[S.S_ATTR_MIX] = m;
      const norm = ((w * h) / 1.44e6) * (40000 / pts) * (1.44 / (size * size));
      P[S.S_ATTR_BRIGHT] = Math.min(amt * 0.04 * norm * f60 * (0.5 + 0.8 * a.level * R), 2);
      P[S.S_ATTR_SCALE] = g[G.ATTR_SCALE] * (1 + 0.08 * pulse * R);
      this.attrAngle += g[G.ATTR_SPIN] * dt * ms;
      P[S.S_ATTR_SPIN] = this.attrAngle;
      P[S.S_ATTR_SIZE] = size;
      P[S.S_ATTR_ITER] = Math.round(X[XF.ATTR_ITER]);
      P[S.S_ATTR_SEED] = this.frame % 65536;
    }

    {
      const [a1, a2, m] = top2(e.w[C.KALEIDO], CHOICES[C.KALEIDO].n);
      P[S.S_KA] = CHOICES[C.KALEIDO].val[a1];
      P[S.S_KB] = CHOICES[C.KALEIDO].val[a2];
      P[S.S_KMIX] = m;
    }
    this.kSpin += g[G.KSPIN] * dt;
    P[S.S_KSPIN] = this.kSpin;
    P[S.S_CHROMA] = g[G.CHROMA] * (1 + pulse * R) * X[XF.L_CHROMA];
    P[S.S_ECHO] = g[G.ECHO] * X[XF.L_ECHO];
    P[S.S_ECHO_ZOOM] = Math.max(g[G.ECHO_ZOOM], 0.2);
    this.echoAngle += g[G.ECHO_SPIN] * dt;
    P[S.S_ECHO_ANGLE] = this.echoAngle;
    const ew = e.w[C.ECHO_FLIP];
    P[S.S_ECHO_FLIP_X] = ew[1] + ew[3];
    P[S.S_ECHO_FLIP_Y] = ew[2] + ew[3];
    P[S.S_BRIGHT] = (s.brightness * 1.3) / (1 + 0.6 * fl);
    P[S.S_BLACK] = clamp(meanLum, 0, 2) * Math.min(fl, 1) * 0.45;
    P[S.S_SAT] = 0.35 * Math.min(fl, 1);
    P[S.S_FLASH] = g[G.BEAT_FLASH] * pulse * pulse * R * 0.5 * X[XF.L_FLASH];

    // Tunnel rings: born on beats, expand and fade.
    const rings = this.rings;
    if (beat && g[G.TUNNEL] > 0.02) {
      for (let i = 7; i > 0; i--) { rings[i][0] = rings[i - 1][0]; rings[i][1] = rings[i - 1][1]; }
      rings[0][0] = 0.02;
      rings[0][1] = 0.5 + 0.5 * Math.min(bassX, 1);
    }
    for (let i = 0; i < 8; i++) {
      if (rings[i][1] <= 0) continue;
      rings[i][0] += dt * (0.3 + 0.3 * a.level) * ms;
      rings[i][1] *= Math.exp(-dt * 0.7);
      if (rings[i][0] > 1.6 || rings[i][1] < 0.01) rings[i][1] = 0;
      P[S.S_RINGS + i * 2] = rings[i][0];
      P[S.S_RINGS + i * 2 + 1] = rings[i][1];
    }
    return { copies, attrPoints };
  }
}
