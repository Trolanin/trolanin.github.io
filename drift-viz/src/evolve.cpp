// The evolving genome behind the visuals, and its mapping to shader parameters.
#include "evolve.h"
#include "params.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace {
// lo..hi is the full range, reached at complexity 1. calmLo..calmHi is the range at
// complexity 0, or right when the gene's layer comes in. The gate column is no longer used
// directly: each species draws its own thresholds (see kFeatures and newGates).
// Integer genes don't drift; scene changes pick a new whole number.
struct GeneDef { const wchar_t* name; float lo, hi, calmLo, calmHi, gate; bool drift; int group; bool math, integer; };
const bool M = true, INTG = true;
const GeneDef kGenes[G_COUNT] = {
  { L"zoom",            0.985f, 1.045f, 1.000f, 1.012f, 0.00f, true, GR_MOTION },
  { L"rotation",       -0.030f, 0.030f, -0.004f, 0.004f, 0.00f, true, GR_MOTION },
  { L"swirl",          -0.035f, 0.035f, -0.006f, 0.006f, 0.20f, true, GR_MOTION },
  { L"warp",            0.000f, 0.008f, 0.0005f, 0.002f, 0.00f, true, GR_MOTION },
  { L"warp size",       2.0f,   14.0f,  3.0f,   7.0f,   0.00f, true, GR_MOTION },
  { L"warp speed",      0.2f,   3.0f,   0.3f,   1.0f,   0.00f, true, GR_MOTION },
  { L"drift",          -0.004f, 0.004f, -0.0008f, 0.0008f, 0.30f, true, GR_MOTION },
  { L"drift",          -0.004f, 0.004f, -0.0008f, 0.0008f, 0.30f, true, GR_MOTION },
  { L"trails",          0.90f,  0.985f, 0.93f,  0.965f, 0.00f, true, GR_MOTION },
  { L"colour drift",   -0.030f, 0.030f, -0.006f, 0.006f, 0.15f, true, GR_COLOUR },
  { L"wave size",       0.12f,  0.42f,  0.20f,  0.30f,  0.00f, true, GR_SHAPE },
  { L"wave gain",       0.10f,  0.80f,  0.15f,  0.40f,  0.00f, true, GR_SHAPE },
  { L"wave thickness",  0.0015f, 0.008f, 0.002f, 0.004f, 0.00f, true, GR_SHAPE },
  { L"wave spin",      -1.2f,   1.2f,  -0.3f,   0.3f,   0.00f, true, GR_SHAPE },
  { L"wave brightness", 0.25f,  1.0f,   0.45f,  0.8f,   0.00f, true, GR_SHAPE },
  { L"petals",          2.0f,   7.0f,   2.0f,   5.0f,   0.00f, false, GR_SHAPE, false, INTG },
  { L"spectrum ring",   0.0f,   1.0f,   0.4f,   0.8f,   0.15f, true, GR_LAYERS },
  { L"ring radius",     0.05f,  0.40f,  0.15f,  0.30f,  0.00f, true, GR_LAYERS },
  { L"tunnel rings",    0.0f,   1.0f,   0.5f,   0.9f,   0.30f, true, GR_LAYERS },
  { L"sparkles",        0.0f,   1.0f,   0.4f,   0.8f,   0.45f, true, GR_LAYERS },
  { L"orbs",            0.0f,   1.0f,   0.4f,   0.8f,   0.55f, true, GR_LAYERS },
  { L"palette",         0.3f,   1.6f,   0.5f,   1.1f,   0.00f, true, GR_COLOUR },
  { L"palette",         0.3f,   1.6f,   0.5f,   1.1f,   0.00f, true, GR_COLOUR },
  { L"palette",         0.3f,   1.6f,   0.5f,   1.1f,   0.00f, true, GR_COLOUR },
  { L"palette",         0.0f,   1.0f,   0.0f,   1.0f,   0.00f, true, GR_COLOUR },
  { L"palette",         0.0f,   1.0f,   0.0f,   1.0f,   0.00f, true, GR_COLOUR },
  { L"palette",         0.0f,   1.0f,   0.0f,   1.0f,   0.00f, true, GR_COLOUR },
  { L"colour cycling", -0.25f,  0.25f, -0.06f,  0.06f,  0.00f, true, GR_COLOUR },
  { L"colour spread",   0.2f,   3.0f,   0.3f,   1.2f,   0.00f, true, GR_COLOUR },
  { L"kaleidoscope spin", -0.6f, 0.6f, -0.1f,   0.1f,   0.00f, true, GR_SYMMETRY },
  { L"chromatic split", 0.0f,   0.030f, 0.004f, 0.010f, 0.40f, true, GR_LAYERS },
  { L"echo",            0.0f,   0.6f,   0.2f,   0.4f,   0.50f, true, GR_LAYERS },
  { L"echo zoom",       0.5f,   2.0f,   0.8f,   1.3f,   0.00f, true, GR_LAYERS },
  { L"echo spin",      -0.5f,   0.5f,  -0.1f,   0.1f,   0.00f, true, GR_LAYERS },
  { L"bass zoom",       0.0f,   0.030f, 0.0f,   0.010f, 0.00f, true, GR_MOTION },
  { L"beat kick",       0.0f,   1.0f,   0.0f,   0.4f,   0.00f, true, GR_MOTION },
  { L"beat flash",      0.0f,   0.25f,  0.02f,  0.08f,  0.35f, true, GR_LAYERS },
  // math space
  { L"flame warp",      0.0f,   0.05f,  0.006f, 0.02f,  0.00f, true, GR_SPACE, M },
  { L"flame blend",     0.0f,   1.0f,   0.0f,   0.5f,   0.10f, true, GR_SPACE, M },
  { L"flame turn",     -3.1416f, 3.1416f, -0.5f, 0.5f,  0.00f, true, GR_SPACE, M },
  { L"flame scale",     0.6f,   1.5f,   0.85f,  1.15f,  0.00f, true, GR_SPACE, M },
  { L"flame shear",    -0.6f,   0.6f,  -0.15f,  0.15f,  0.00f, true, GR_SPACE, M },
  { L"flame shift",    -0.4f,   0.4f,  -0.1f,   0.1f,   0.00f, true, GR_SPACE, M },
  { L"flame shift",    -0.4f,   0.4f,  -0.1f,   0.1f,   0.00f, true, GR_SPACE, M },
  { L"flame shape",     0.0f,   1.0f,   0.2f,   0.8f,   0.00f, true, GR_SPACE, M },
  { L"flame shape",     0.0f,   1.0f,   0.2f,   0.8f,   0.00f, true, GR_SPACE, M },
  { L"curl flow",       0.0f,   0.006f, 0.0006f, 0.002f, 0.05f, true, GR_SPACE, M },
  { L"flow size",       1.5f,   9.0f,   2.0f,   5.0f,   0.00f, true, GR_SPACE, M },
  { L"flow speed",      0.05f,  0.8f,   0.1f,   0.3f,   0.00f, true, GR_SPACE, M },
  { L"complex lens",    0.0f,   1.0f,   0.35f,  0.75f,  0.15f, true, GR_SPACE, M },
  { L"lens shape",      0.0f,   1.0f,   0.2f,   0.8f,   0.00f, true, GR_SPACE, M },
  { L"lens shape",      0.0f,   1.0f,   0.2f,   0.8f,   0.00f, true, GR_SPACE, M },
  { L"lens drift",     -0.4f,   0.4f,  -0.1f,   0.1f,   0.00f, true, GR_SPACE, M },
  { L"wallpaper",       0.0f,   1.0f,   0.5f,   0.85f,  0.30f, true, GR_SYMMETRY, M },
  { L"tile size",       1.2f,   4.0f,   1.5f,   2.5f,   0.00f, true, GR_SYMMETRY, M },
  { L"superformula",    2.0f,   12.0f,  3.0f,   7.0f,   0.00f, false, GR_SHAPE, false, INTG },
  { L"superformula",    0.3f,   3.0f,   0.6f,   2.0f,   0.00f, true, GR_SHAPE },
  { L"superformula",    0.3f,   3.0f,   0.6f,   2.0f,   0.00f, true, GR_SHAPE },
  { L"superformula",    0.3f,   3.0f,   0.6f,   2.0f,   0.00f, true, GR_SHAPE },
  { L"lissajous",       1.0f,   5.0f,   1.0f,   4.0f,   0.00f, false, GR_SHAPE, false, INTG },
  { L"lissajous",       1.0f,   6.0f,   2.0f,   5.0f,   0.00f, false, GR_SHAPE, false, INTG },
  { L"lissajous turn", -0.6f,   0.6f,  -0.2f,   0.2f,   0.00f, true, GR_SHAPE },
  { L"strange attractor", 0.0f, 1.0f,   0.4f,   0.8f,   0.20f, true, GR_LAYERS, M },
  { L"attractor",      -2.4f,   2.4f,  -1.8f,   1.8f,   0.00f, true, GR_SPACE, M },
  { L"attractor",      -2.4f,   2.4f,  -1.8f,   1.8f,   0.00f, true, GR_SPACE, M },
  { L"attractor",      -1.5f,   1.5f,  -1.0f,   1.0f,   0.00f, true, GR_SPACE, M },
  { L"attractor",      -1.5f,   1.5f,  -1.0f,   1.0f,   0.00f, true, GR_SPACE, M },
  { L"attractor size",  0.10f,  0.20f,  0.13f,  0.17f,  0.00f, true, GR_LAYERS, M },
  { L"attractor spin", -0.3f,   0.3f,  -0.08f,  0.08f,  0.00f, true, GR_LAYERS, M },
};

// Genes that switch a layer or effect on (its amount). Each species draws its own threshold
// for each row, so what shows up, and in what order, differs every time. Every other gene is
// always live (it only matters while its layer is on). Genes in one row share a threshold.
const int kFeatures[][2] = {
  { G_SWIRL, -1 }, { G_HUE, -1 }, { G_DRIFT_X, G_DRIFT_Y }, { G_SPEC_RING, -1 }, { G_TUNNEL, -1 }, { G_SPARKLE, -1 },
  { G_ORBS, -1 }, { G_CHROMA, -1 }, { G_ECHO, -1 }, { G_BEAT_FLASH, -1 },
  { G_FLAME, -1 }, { G_FLAME_MIX, -1 }, { G_FLOW, -1 }, { G_VIEW, -1 }, { G_TILE, -1 }, { G_ATTR, -1 },
};

// Options whose bit is set in mathMask count their threshold from the species' math threshold.
// noneFirst: option 0 means "off" and stays available at any complexity.
struct ChoiceDef {
  const wchar_t* name; int n; float val[MAX_OPT]; float gate[MAX_OPT]; const wchar_t* label[MAX_OPT]; int group; unsigned mathMask;
  bool noneFirst;
};
const unsigned ALL_BUT_0 = ~1u;
const ChoiceDef kChoices[C_COUNT] = {
  { L"wave shape", 7, { 0, 1, 2, 3, 4, 5, 6 }, { 0, 0, 0.10f, 0.25f, 0.35f, 0.0f, 0.10f },
    { L"circle", L"line", L"scope", L"spiral", L"rose", L"superformula", L"lissajous" }, GR_SHAPE, (1u << 5) | (1u << 6) },
  { L"copies", 5, { 1, 2, 3, 4, 6 }, { 0, 0.20f, 0.30f, 0.45f, 0.60f }, { L"×1", L"×2", L"×3", L"×4", L"×6" }, GR_SHAPE, 0 },
  { L"kaleidoscope", 7, { 1, 3, 4, 5, 6, 8, 12 }, { 0, 0.30f, 0.30f, 0.40f, 0.40f, 0.55f, 0.70f },
    { L"off", L"3", L"4", L"5", L"6", L"8", L"12" }, GR_SYMMETRY, 0, true },
  { L"mirror", 4, { 0, 1, 2, 3 }, { 0, 0.35f, 0.45f, 0.60f }, { L"none", L"left-right", L"top-bottom", L"four-way" }, GR_SYMMETRY, 0, true },
  { L"echo flip", 4, { 0, 1, 2, 3 }, { 0, 0, 0, 0 }, { L"none", L"flip X", L"flip Y", L"flip XY" }, GR_LAYERS, 0, true },
  { L"tunnel shape", 4, { 0, 3, 4, 6 }, { 0, 0, 0, 0 }, { L"circles", L"triangles", L"squares", L"hexagons" }, GR_LAYERS, 0 },
  { L"flame", 24, { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23 },
    { 0, 0, 0, 0, .02f, .02f, .04f, .04f, .06f, .06f, .08f, .08f, .1f, .1f, .12f, .12f, .15f, .15f, .18f, .18f, .2f, .22f, .25f, .28f },
    { L"linear", L"sinusoidal", L"spherical", L"swirl", L"horseshoe", L"polar", L"handkerchief", L"heart", L"disc", L"spiral",
      L"hyperbolic", L"diamond", L"fisheye", L"bubble", L"waves", L"power", L"exponential", L"sine", L"Möbius", L"Joukowski",
      L"log-polar", L"tangent", L"cross", L"pdj" }, GR_SPACE, ALL_BUT_0 },
  { L"flame", 24, { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23 },
    { 0, 0, 0, 0, .02f, .02f, .04f, .04f, .06f, .06f, .08f, .08f, .1f, .1f, .12f, .12f, .15f, .15f, .18f, .18f, .2f, .22f, .25f, .28f },
    { L"linear", L"sinusoidal", L"spherical", L"swirl", L"horseshoe", L"polar", L"handkerchief", L"heart", L"disc", L"spiral",
      L"hyperbolic", L"diamond", L"fisheye", L"bubble", L"waves", L"power", L"exponential", L"sine", L"Möbius", L"Joukowski",
      L"log-polar", L"tangent", L"cross", L"pdj" }, GR_SPACE, ALL_BUT_0 },
  { L"lens", 12, { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 }, { 0, 0, .05f, .05f, .1f, .1f, .15f, .15f, .2f, .25f, .25f, .3f },
    { L"none", L"power", L"inversion", L"Möbius", L"Droste", L"tunnel", L"hyperbolic", L"twist", L"barrel", L"complex sine",
      L"Joukowski", L"unwrap" }, GR_SPACE, ALL_BUT_0, true },
  { L"tiling", 6, { 0, 1, 2, 3, 4, 5 }, { 0, .30f, .30f, .35f, .40f, .45f }, { L"none", L"p4m", L"p6m", L"p3m1", L"bricks", L"pinwheel" },
    GR_SYMMETRY, ALL_BUT_0, true },
  { L"attractor", 4, { 0, 1, 2, 3 }, { 0, .05f, .1f, .15f }, { L"Clifford", L"de Jong", L"Svensson", L"dream" }, GR_SPACE, ALL_BUT_0 },
};

// Version 1 favourites (before the math space) had 37 genes and 6 choices.
const int kFavFloats = 1 + G_COUNT + C_COUNT, kOldGenes = 37, kOldChoices = 6, kOldFavFloats = 1 + kOldGenes + kOldChoices;

struct TriggerDef { int AudioFrame::*counter; int amount, target; const wchar_t* name; };
const TriggerDef kTriggers[9] = {
  { &AudioFrame::sections, XF_T_SECTION, XI_T_SECTION, L"The music changed" },
  { &AudioFrame::drops, XF_T_DROP, XI_T_DROP, L"Bass drop" },
  { &AudioFrame::builds, XF_T_BUILD, XI_T_BUILD, L"Build-up" },
  { &AudioFrame::breaks, XF_T_BREAK, XI_T_BREAK, L"Breakdown" },
  { &AudioFrame::toneShifts, XF_T_BRIGHT, XI_T_BRIGHT, L"Tone shift" },
  { &AudioFrame::hatRushes, XF_T_HATS, XI_T_HATS, L"Hi-hats picked up" },
  { &AudioFrame::vocals, XF_T_VOCAL, XI_T_VOCAL, L"Vocals / lead came in" },
  { &AudioFrame::tempoChanges, XF_T_TEMPO, XI_T_TEMPO, L"Tempo changed" },
  { &AudioFrame::hits, XF_T_HIT, XI_T_HIT, L"Big hit" },
};
const wchar_t* const kTargetShort[] = { L"everything", L"motion", L"colour", L"shape", L"layers", L"math space", L"symmetry", L"new species" };

// The two strongest options of a cross-fading choice, and how far the second one is mixed in.
void top2(const float* w, int n, int& a, int& b, float& mix) {
  a = 0;
  for (int o = 1; o < n; o++) if (w[o] > w[a]) a = o;
  b = -1;
  for (int o = 0; o < n; o++) if (o != a && (b < 0 || w[o] > w[b])) b = o;
  float wa = w[a], wb = b >= 0 ? w[b] : 0.f;
  if (b < 0) b = a;
  mix = wb / std::max(wa + wb, 1e-4f);
}
}  // namespace

float Evolver::optionValue(int c, int opt) { return kChoices[c].val[opt]; }
int Evolver::optionCount(int c) { return kChoices[c].n; }
const wchar_t* Evolver::optionLabel(int c, int opt) { return kChoices[c].label[opt]; }

// The species' math threshold: the "Math threshold" option plus this species' own offset.
float Evolver::spMath() const { return std::clamp(mathGate + mathJit, 0.f, 0.9f); }
float Evolver::gateOf(int i) const {
  float r = relGate[i];
  return r < 0 ? 0.f : r + (kGenes[i].math ? spMath() : 0.f);
}
float Evolver::optGate(int c, int o) const {
  float r = relOpt[c][o];
  return r < 0 ? 0.f : r + ((kChoices[c].mathMask >> o & 1u) ? spMath() : 0.f);
}

void Evolver::range(int i, float& lo, float& hi) const {
  const GeneDef& d = kGenes[i];
  float gate = gateOf(i);
  if (complexity < gate) { lo = hi = 0.f; return; }
  float f = std::clamp((complexity - gate) / std::max(1.f - gate, 1e-3f), 0.f, 1.f);
  lo = d.calmLo + (d.lo - d.calmLo) * f;
  hi = d.calmHi + (d.hi - d.calmHi) * f;
}

void Evolver::pickChoice(int c, bool mustChange) {
  const ChoiceDef& d = kChoices[c];
  int opts[MAX_OPT], n = 0;
  for (int o = 0; o < d.n; o++)
    if (optGate(c, o) <= complexity && !(mustChange && o == choice[c])) opts[n++] = o;
  if (!n) return;
  // "Off" keeps a fair share, or every look would end up kaleidoscoped, mirrored and tiled.
  int o = d.noneFirst && opts[0] == 0 && n > 1 ? (uni() < 0.35f ? 0 : opts[1 + pick(n - 1)]) : opts[pick(n)];
  if (o != choice[c]) fadeMul[c] = uni(0.35f, 2.f);   // some switches snap, some melt
  choice[c] = o;
}

// Each species gets its own thresholds: a feature comes in from the start (15%), never
// appears in this species (15%), or comes in at a random complexity. Same for each option.
void Evolver::newGates() {
  mathJit = uni(-0.3f, 0.3f);
  for (float& r : relGate) r = -1.f;
  for (auto& f : kFeatures) {
    float r = uni();
    float gate = r < 0.15f ? 0.f : r < 0.30f ? 9.f : kGenes[f[0]].math ? uni(0.f, 0.3f) : uni(0.f, 0.75f);
    for (int j : f) if (j >= 0) relGate[j] = gate;
  }
  for (int c = 0; c < C_COUNT; c++) {
    const ChoiceDef& d = kChoices[c];
    bool gated = d.mathMask != 0;
    for (int o = 0; o < d.n; o++) gated |= d.gate[o] > 0;
    for (int o = 0; o < MAX_OPT; o++)
      relOpt[c][o] = !gated || o >= d.n ? -1.f : (d.mathMask >> o & 1u) ? uni(0.f, 0.3f) : uni(0.f, 0.8f);
    relOpt[c][d.noneFirst ? 0 : pick(d.n)] = -1.f;   // at least one option is always available
  }
}

// How fast things settle and how long scenes last, so changes don't all share one rhythm.
void Evolver::newPacing() {
  for (float& v : easeMul) v = uni(0.5f, 1.6f);
  for (float& v : fadeMul) v = uni(0.5f, 1.6f);
  sceneFrac = uni(0.35f, 1.f);
  cxTimer = 0;
}

float Evolver::startComplexity() {
  float lo = set.x[XF_START_CX];
  return uni(lo, std::max(lo, 0.85f * set.complexityCap));
}

void Evolver::randomize() {
  for (int i = 0; i < G_COUNT; i++) {
    float lo, hi;
    range(i, lo, hi);
    tgt[i] = kGenes[i].integer ? std::round(uni(lo, hi)) : uni(lo, hi);
    vel[i] = 0;
  }
  for (int c = 0; c < C_COUNT; c++) pickChoice(c, false);
}

void Evolver::newLoadings() {
  std::memset(loadL, 0, sizeof loadL);
  std::memset(loadZ, 0, sizeof loadZ);
  for (int i = 0; i < G_COUNT; i++) {
    if (kGenes[i].integer) continue;
    auto sgn = [&] { return uni() < 0.5f ? -1.f : 1.f; };
    loadL[i][pick(LATENT)] = sgn() * uni(0.5f, 1.f);
    if (uni() < 0.4f) loadL[i][pick(LATENT)] += sgn() * uni(0.3f, 0.8f);
    if (uni() < 0.35f) loadZ[i][pick(3)] = sgn() * uni(0.5f, 1.f);
  }
  for (float& v : z) v = gauss();
  lor[0] = uni(-8.f, 8.f); lor[1] = uni(-8.f, 8.f); lor[2] = uni(15.f, 30.f);
}

void Evolver::init(unsigned seed, const std::wstring& path, const Settings& s) {
  rng.seed(seed);
  set = s;
  mathGate = s.x[XF_M_GATE];
  favPath = path;
  loadFavs();
  newGates();
  newPacing();
  complexity = prevComplexity = startComplexity();
  for (int c = 0; c < C_COUNT; c++) choice[c] = 0;
  randomize();
  newLoadings();
  for (int i = 0; i < G_COUNT; i++) g[i] = base[i] = tgt[i];
  for (int c = 0; c < C_COUNT; c++)
    for (int o = 0; o < MAX_OPT; o++) w[c][o] = o == choice[c] ? 1.f : 0.f;
  lastEvent = L"Started from a fresh random look";
}

void Evolver::mutateScene(float strength, const std::wstring& why, unsigned groups) {
  scene++;
  sceneTime = 0;
  // Candidates: genes and choices of the requested groups that can move right now. If none can
  // (say, math space below its threshold), the whole genome is fair game.
  std::vector<int> genes, chs;
  for (int pass = 0; pass < 2 && (genes.empty() || chs.empty()); pass++) {
    unsigned gm = pass ? GM_ALL : groups;
    if (genes.empty())
      for (int i = 0; i < G_COUNT; i++) {
        float lo, hi;
        range(i, lo, hi);
        if ((gm >> kGenes[i].group & 1u) && hi > lo) genes.push_back(i);
      }
    if (chs.empty())
      for (int c = 0; c < C_COUNT; c++) {
        if (!(gm >> kChoices[c].group & 1u)) continue;
        int open = 0;
        for (int o = 0; o < kChoices[c].n; o++) open += optGate(c, o) <= complexity;
        if (open > 1) chs.push_back(c);
      }
  }
  int k = std::max(1, int(std::lround(set.x[XF_GENES_PER_SCENE] * (0.33f + 1.33f * strength))));
  for (int i = 0; i < k && !genes.empty(); i++) {
    int gi = genes[pick(int(genes.size()))];
    float lo, hi;
    range(gi, lo, hi);
    if (kGenes[gi].integer) { tgt[gi] = std::round(uni(lo, hi)); continue; }
    float mix = 0.5f + 0.5f * strength;
    tgt[gi] += (uni(lo, hi) - tgt[gi]) * mix;
    easeMul[gi] = uni(0.35f, 2.f);
  }
  // Always change at least one discrete gene so a scene change is visible.
  std::wstring changed;
  int nc = 1, extra = int(std::lround(set.x[XF_CHOICES_PER_SCENE]));
  for (int j = 1; j <= extra; j++) nc += uni() < strength / float(j) ? 1 : 0;
  for (int i = 0; i < nc && !chs.empty(); i++) {
    int j = pick(int(chs.size())), c = chs[j];
    chs[j] = chs.back();   // each switch changes at most once per scene
    chs.pop_back();
    int before = choice[c];
    pickChoice(c, true);
    if (choice[c] != before) {
      if (!changed.empty()) changed += L", ";
      changed += kChoices[c].name;
      changed += L" → ";
      changed += kChoices[c].label[choice[c]];
    }
  }
  boost = std::max(boost, uni(0.15f, 1.2f));
  sceneFrac = uni(0.35f, 1.f);
  lastEvent = why + (changed.empty() ? L"" : L": " + changed);
}

void Evolver::newSpecies(const wchar_t* why) {
  generation++;
  scene = 1;
  sceneTime = 0;
  newLoadings();
  newGates();
  newPacing();
  if (!favs.empty() && uni() < set.x[XF_BREED]) {
    const auto& A = favs[pick(int(favs.size()))];
    const auto& B = favs[pick(int(favs.size()))];
    complexity = std::max(set.x[XF_START_CX], 0.5f * (A[0] + B[0]) * 0.8f);
    for (int i = 0; i < G_COUNT; i++) {
      float v = (uni() < 0.5f ? A : B)[1 + i];
      if (std::isnan(v)) v = (uni() < 0.5f ? B : A)[1 + i];
      // A layer the parent had stays in this species whatever its drawn threshold.
      if (!std::isnan(v) && relGate[i] >= 0 && std::fabs(v) > 0.05f * (kGenes[i].hi - kGenes[i].lo)) relGate[i] = -1.f;
      float lo, hi;
      range(i, lo, hi);
      if (std::isnan(v)) v = uni(lo, hi);   // a look kept before this gene existed
      else if (!kGenes[i].integer) v += gauss() * set.x[XF_BREED_JITTER] * (hi - lo);
      tgt[i] = v;
      vel[i] = 0;
    }
    for (int c = 0; c < C_COUNT; c++) {
      int o = int((uni() < 0.5f ? A : B)[1 + G_COUNT + c]);
      choice[c] = std::clamp(o, 0, kChoices[c].n - 1);
      relOpt[c][choice[c]] = -1.f;
    }
    lastEvent = std::wstring(why) + L": bred from two of your kept looks";
  } else {
    complexity = startComplexity();
    randomize();
    lastEvent = std::wstring(why) + L": a fresh random look";
  }
  prevComplexity = complexity;
  boost = 2.0f;
}

void Evolver::update(float dt, const AudioFrame& a, const Settings& s) {
  set = s;
  mathGate = s.x[XF_M_GATE];
  const float* X = s.x;
  if (lastBeats < 0) lastBeats = a.beats;
  bool beat = a.beats != lastBeats;
  lastBeats = a.beats;

  // Which audio events happened since last frame; the one with the largest amount wins.
  int best = -1;
  float bestAmt = 0.005f;
  for (int i = 0; i < 9; i++) {
    int c = a.*kTriggers[i].counter;
    if (countsInit && c != lastCount[i] && X[kTriggers[i].amount] > bestAmt) { best = i; bestAmt = X[kTriggers[i].amount]; }
    lastCount[i] = c;
  }
  countsInit = true;
  if (a.silent) phraseBeats = 0;
  else if (beat && ++phraseBeats >= kPhraseBeats[std::clamp(s.xi[XI_PHRASE_LEN], 0, 3)]) {
    phraseBeats = 0;
    if (X[XF_T_PHRASE] > bestAmt) { best = 9; bestAmt = X[XF_T_PHRASE]; }
  }
  sinceEvent += dt;

  // Audio steering: each group's drift speed follows one feature of the music.
  {
    float fv[8] = { 0.5f, a.level, std::clamp((a.bass - 0.6f) / 1.4f, 0.f, 1.f), std::clamp((a.mid - 0.6f) / 1.4f, 0.f, 1.f),
                    std::clamp((a.treb - 0.6f) / 1.4f, 0.f, 1.f), a.bright, a.beatDensity, std::clamp(a.novelty / 6.f, 0.f, 1.f) };
    float kf = 1.f - std::exp(-dt * 1.5f);
    for (int gr = 0; gr < GR_COUNT; gr++) {
      int st = std::clamp(s.xi[XI_ST_MOTION + gr], 0, 7);
      feat[gr] += (fv[st] - feat[gr]) * kf;
      steerMul[gr] = st == ST_OFF ? 1.f : 1.f + (0.2f + 2.2f * feat[gr] - 1.f) * X[XF_STEER];
    }
  }

  if (!s.freeze) {
    sceneTime += dt;
    // Complexity wanders while music plays: it heads for a target that is redrawn at random
    // moments, so the look gets busier or calmer in no fixed order. It drains during silence.
    if (a.silent) {
      silentTime += dt;
      if (silentTime > 2.f) complexity = std::max(0.f, complexity - dt * X[XF_DRAIN]);
    } else {
      if (silentTime > X[XF_NEWSONG]) newSpecies(L"New song");
      silentTime = 0;
      float swing = std::max(6.f, s.buildMin * 60.f);
      cxTimer -= dt;
      if (cxTimer <= 0) { cxTarget = uni(0.1f, 1.f); cxTimer = swing * uni(0.15f, 0.6f); }
      float step = dt / swing, want = cxTarget * s.complexityCap;
      complexity += std::clamp(want - complexity, -step, step);
    }
    if (complexity > s.complexityCap) complexity = std::max(s.complexityCap, complexity - dt * 0.1f);

    // A layer whose threshold complexity just rose past fades in from a calm setting.
    for (int i = 0; i < G_COUNT; i++) {
      const GeneDef& d = kGenes[i];
      float gate = gateOf(i);
      if (gate > 0 && prevComplexity < gate && complexity >= gate)
        tgt[i] = d.integer ? std::round(uni(d.calmLo, d.calmHi)) : uni(d.calmLo, d.calmHi);
    }
    prevComplexity = complexity;

    // Slow drift: each gene's target wanders (a damped random walk) inside its allowed range.
    float sq = std::sqrt(std::max(dt, 1e-4f)), damp = std::exp(-dt * X[XF_DAMPING]);
    for (int i = 0; i < G_COUNT; i++) {
      float lo, hi;
      range(i, lo, hi);
      if (kGenes[i].drift && hi > lo) {
        vel[i] = vel[i] * damp + gauss() * sq * 0.8f;
        tgt[i] += vel[i] * dt * 0.04f * s.evoSpeed * steerMul[kGenes[i].group] * (hi - lo);
      }
      if (tgt[i] < lo) { tgt[i] = lo + std::min(lo - tgt[i], hi - lo); vel[i] = std::fabs(vel[i]); }
      if (tgt[i] > hi) { tgt[i] = hi - std::min(tgt[i] - hi, hi - lo); vel[i] = -std::fabs(vel[i]); }
      tgt[i] = std::clamp(tgt[i], lo, hi);
    }

    // Shared drift: latent factors (Ornstein-Uhlenbeck, unit variance) and the Lorenz system.
    float th = 0.12f * s.evoSpeed, sd = std::sqrt(2.f * th * std::max(dt, 1e-4f));
    for (float& v : z) v += -v * th * dt + sd * gauss();
    float hl = dt * 0.15f * s.evoSpeed;
    int steps = std::max(1, int(std::ceil(hl / 0.004f)));
    hl /= float(steps);
    for (int k = 0; k < steps; k++) {
      float dx = 10.f * (lor[1] - lor[0]), dy = lor[0] * (28.f - lor[2]) - lor[1], dz = lor[0] * lor[1] - 8.f / 3.f * lor[2];
      lor[0] += dx * hl; lor[1] += dy * hl; lor[2] += dz * hl;
    }

    // Small nudges on some beats.
    if (beat && uni() < X[XF_NUDGE_CHANCE] * s.evoSpeed) {
      int gi = pick(G_COUNT);
      if (kGenes[gi].drift) {
        float lo, hi;
        range(gi, lo, hi);
        tgt[gi] += (uni(lo, hi) - tgt[gi]) * X[XF_NUDGE_SIZE] * (0.4f + 1.2f * s.mutation);
      }
    }

    // Scene changes: an audio event (each with its own target), or the scene ran its length.
    if (best >= 0 && sinceEvent >= X[XF_T_COOLDOWN]) {
      int tg = std::clamp(best == 9 ? s.xi[XI_T_PHRASE] : s.xi[kTriggers[best].target], 0, 7);
      const wchar_t* name = best == 9 ? L"New phrase" : kTriggers[best].name;
      sinceEvent = 0;
      if (tg == TGT_SPECIES) newSpecies(name);
      else
        mutateScene(std::min(1.f, bestAmt * (0.4f + 0.6f * s.mutation) * uni(0.6f, 1.4f)),
                    std::wstring(name) + L" (" + kTargetShort[tg] + L")", tg == TGT_ALL ? GM_ALL : 1u << (tg - 1));
    } else if (sceneTime > s.sceneLen * sceneFrac) {
      // The timer picks a random strength and a random handful of groups (sometimes all).
      unsigned gm = GM_ALL;
      if (uni() < 0.75f) {
        gm = 0;
        for (int j = 1 + pick(3); j > 0; j--) gm |= 1u << pick(GR_COUNT);
      }
      mutateScene(std::clamp((0.25f + 0.5f * s.mutation) * uni(0.4f, 1.6f), 0.05f, 1.f), L"Scene timer", gm);
    }

    // Options out of reach again (complexity fell) get replaced.
    for (int c = 0; c < C_COUNT; c++)
      if (optGate(c, choice[c]) > complexity) pickChoice(c, false);
  }

  // Ease toward the targets (faster right after a new species), then add the shared drift.
  const float ln[3] = { lor[0] / 18.f, lor[1] / 24.f, (lor[2] - 24.f) / 18.f };
  for (int i = 0; i < G_COUNT; i++) {
    float k = 1.f - std::exp(-dt * (0.6f + boost) * X[XF_EASE] * easeMul[i]);
    base[i] += (tgt[i] - base[i]) * k;
    float lo, hi;
    range(i, lo, hi);
    if (kGenes[i].integer || hi <= lo) { g[i] = base[i]; continue; }
    float off = 0;
    for (int f = 0; f < LATENT; f++) off += loadL[i][f] * z[f] * 0.25f * X[XF_LATENT];
    for (int j = 0; j < 3; j++) off += loadZ[i][j] * ln[j] * 0.3f * X[XF_LORENZ];
    g[i] = std::clamp(base[i] + off * (hi - lo), lo, hi);
  }
  for (int c = 0; c < C_COUNT; c++) {
    float kc = 1.f - std::exp(-dt * (0.8f + boost) * X[XF_FADE] * fadeMul[c]);
    for (int o = 0; o < MAX_OPT; o++) w[c][o] += ((o == choice[c] ? 1.f : 0.f) - w[c][o]) * kc;
  }
  boost = std::max(0.f, boost - dt * 1.5f);
}

std::wstring Evolver::describe() const {
  auto L = [&](int c) { return std::wstring(kChoices[c].label[choice[c]]); };
  std::wstring s = L(C_SHAPE);
  if (choice[C_COPIES] > 0) s += L" " + L(C_COPIES);
  if (choice[C_KALEIDO] > 0) s += L" · kaleidoscope " + L(C_KALEIDO);
  if (choice[C_MIRROR] > 0) s += L" · mirror " + L(C_MIRROR);
  struct { int gene; float min; const wchar_t* name; } layers[] = {
    { G_SPEC_RING, 0.1f, L"spectrum ring" }, { G_TUNNEL, 0.1f, L"tunnel" }, { G_SPARKLE, 0.1f, L"sparkles" },
    { G_ORBS, 0.1f, L"orbs" }, { G_ECHO, 0.08f, L"echo" }, { G_CHROMA, 0.004f, L"chroma split" }, { G_FLOW, 0.0004f, L"curl flow" },
  };
  for (auto& l : layers)
    if (tgt[l.gene] > l.min) s += std::wstring(L" · ") + l.name;
  if (tgt[G_FLAME] > 0.002f) s += L" · flame " + L(C_FLAME_A) + (tgt[G_FLAME_MIX] > 0.3f ? L"+" + L(C_FLAME_B) : L"");
  if (tgt[G_VIEW] > 0.1f && choice[C_VIEW] > 0) s += L" · " + L(C_VIEW) + L" lens";
  if (tgt[G_TILE] > 0.1f && choice[C_TILE] > 0) s += L" · " + L(C_TILE) + L" tiling";
  if (tgt[G_ATTR] > 0.1f) s += L" · " + L(C_ATTR) + L" attractor";
  return s;
}

std::wstring Evolver::heard(const AudioFrame& a) const {
  wchar_t b[256];
  wchar_t bpm[24] = L"tempo not locked";
  if (a.bpm > 0) swprintf(bpm, 24, L"%.0f BPM", a.bpm);
  swprintf(b, 256, L"Heard so far: %d changes · %d drops · %d build-ups · %d breakdowns · %d tone shifts · %d hat rushes · "
                   L"%d vocal entries · %d tempo changes · %d big hits · %s",
           a.sections, a.drops, a.builds, a.breaks, a.toneShifts, a.hatRushes, a.vocals, a.tempoChanges, a.hits, bpm);
  return b;
}

/* ------------------------------ favourites ------------------------------ */
void Evolver::like() {
  std::vector<float> f(kFavFloats);
  f[0] = complexity;
  for (int i = 0; i < G_COUNT; i++) f[1 + i] = g[i];
  for (int c = 0; c < C_COUNT; c++) f[1 + G_COUNT + c] = float(choice[c]);
  favs.push_back(f);
  if (favs.size() > 50) favs.erase(favs.begin());
  saveFavs();
  lastEvent = L"Kept this look; new songs may be bred from it";
}

void Evolver::loadFavs() {
  favs.clear();
  if (favPath.empty()) return;
  FILE* fp = _wfopen(favPath.c_str(), L"r");
  if (!fp) return;
  char line[8192];
  while (fgets(line, sizeof line, fp)) {
    std::vector<float> f;
    for (char* tok = strtok(line, " \t\r\n"); tok; tok = strtok(nullptr, " \t\r\n")) {
      if (_strnicmp(tok, "nan", 3) == 0 || _strnicmp(tok, "-nan", 4) == 0) { f.push_back(NAN); continue; }
      char* e;
      float v = strtof(tok, &e);
      if (e == tok) break;
      f.push_back(v);
    }
    if (int(f.size()) == kFavFloats) favs.push_back(f);
    else if (int(f.size()) == kOldFavFloats) {
      // Kept before the math space existed: the new genes are filled in when bred.
      std::vector<float> v(kFavFloats, NAN);
      v[0] = f[0];
      for (int i = 0; i < kOldGenes; i++) v[1 + i] = f[1 + i];
      for (int c = 0; c < C_COUNT; c++) v[1 + G_COUNT + c] = c < kOldChoices ? f[1 + kOldGenes + c] : 0.f;
      favs.push_back(v);
    }
  }
  fclose(fp);
}

void Evolver::saveFavs() const {
  if (favPath.empty()) return;
  FILE* fp = _wfopen(favPath.c_str(), L"w");
  if (!fp) return;
  for (auto& f : favs) {
    for (size_t i = 0; i < f.size(); i++) {
      if (i) fputc(' ', fp);
      if (std::isnan(f[i])) fputs("nan", fp);
      else fprintf(fp, "%.6g", f[i]);
    }
    fputc('\n', fp);
  }
  fclose(fp);
}

/* ------------------------------ shader parameters ------------------------------ */
void Visuals::seed(unsigned s) {
  std::mt19937 r(s);
  auto u = [&](float hi) { return std::uniform_real_distribution<float>(0.f, hi)(r); };
  const float TAU = 6.2831853f;
  time = u(500.f);
  warpPhase = u(100.f); palPhase = u(10.f); flowPhase = u(100.f); viewPhase = u(100.f); lissPhase = u(100.f); orbPhase = u(100.f);
  waveAngle = u(TAU); kSpin = u(TAU); echoAngle = u(TAU); attrAngle = u(TAU);
}

void Visuals::build(float* P, const Evolver& e, const AudioFrame& a, const Settings& s, float dt, int w, int h,
                    float gripX, float gripY, float gripR, float gripOp, float meanLum, DrawInfo& out) {
  std::fill(P, P + P_FLOATS, 0.f);
  const float* g = e.g;
  const float* X = s.x;
  time += dt;
  frame++;
  const float ms = X[XF_MOTION_SPEED];
  float f60 = std::min(dt * 60.f, 3.f), fm = f60 * ms, R = s.reactivity;
  float k = 1.f - std::exp(-dt * 15.f);
  bass += (a.bass - bass) * k; mid += (a.mid - mid) * k; treb += (a.treb - treb) * k;
  bool beat = lastBeats >= 0 && a.beats != lastBeats;
  lastBeats = a.beats;
  if (beat) pulse = 1.f;
  pulse *= std::exp(-dt * 6.f);
  float bassX = std::min(std::max(0.f, bass - 1.f) * R, 2.f), midX = std::min(std::max(0.f, mid - 1.f) * R, 2.f);

  P[S_RES_X] = float(w); P[S_RES_Y] = float(h); P[S_ASPECT] = float(w) / float(h); P[S_TIME] = time;

  // Brightness control. Stacked layers and long trails can fill the whole buffer and wash the
  // picture out to white, so when the average climbs past the target: shorten the trails,
  // lower the exposure, pull the black level down and push saturation back up.
  const float target = X[XF_EXPO_TARGET];
  if (meanLum >= 0) {
    float over = std::clamp((meanLum * (1.f + g[G_ECHO] * X[XF_L_ECHO]) - target) / target, 0.f, 3.f);
    fill += (over - fill) * (1.f - std::exp(-dt * (over > fill ? 2.f : 0.7f)));
  }
  float fl = fill * X[XF_EXPO_AUTO];

  // Feedback motion.
  float zoom = g[G_ZOOM] + X[XF_ZOOM_BIAS] * 0.01f + g[G_BASS_ZOOM] * bassX + g[G_BEAT_KICK] * pulse * 0.012f * R;
  P[S_ZOOM] = std::pow(std::max(zoom, 0.5f), fm);
  P[S_ROT] = (g[G_ROT] + X[XF_ROT_BIAS] * 0.01f + g[G_BEAT_KICK] * pulse * 0.008f * R * (g[G_ROT] >= 0 ? 1.f : -1.f)) * fm;
  P[S_SWIRL] = g[G_SWIRL] * fm;
  P[S_WARP] = g[G_WARP] * (1.f + 0.6f * midX) * fm;
  P[S_WARP_FREQ] = g[G_WARP_FREQ];
  warpPhase += g[G_WARP_SPEED] * dt * (1.f + 0.3f * R * a.level) * ms;
  P[S_WARP_PHASE] = warpPhase;
  P[S_DRIFT_X] = g[G_DRIFT_X] * fm;
  P[S_DRIFT_Y] = g[G_DRIFT_Y] * fm;
  P[S_DECAY] = std::pow(std::clamp(g[G_DECAY] + s.trails * 0.035f - 0.025f * std::min(fl, 1.5f), 0.8f, 0.995f), f60);
  P[S_HUE] = g[G_HUE] * f60 * X[XF_HUE_SPEED];
  const float* mw = e.w[C_MIRROR];
  P[S_MIRROR_X] = (mw[1] + mw[3]) * X[XF_L_MIRROR];
  P[S_MIRROR_Y] = (mw[2] + mw[3]) * X[XF_L_MIRROR];

  // Flame warp: an affine map followed by up to four blended variations.
  {
    int a1, a2, b1, b2;
    float ma, mb;
    top2(e.w[C_FLAME_A], Evolver::optionCount(C_FLAME_A), a1, a2, ma);
    top2(e.w[C_FLAME_B], Evolver::optionCount(C_FLAME_B), b1, b2, mb);
    float fb = std::clamp(g[G_FLAME_MIX], 0.f, 1.f);
    float vw[4] = { (1 - ma) * (1 - fb), ma * (1 - fb), (1 - mb) * fb, mb * fb };
    int vi[4] = { a1, a2, b1, b2 };
    for (int i = 0; i < 4; i++) { P[S_VAR_IDX + i] = float(vi[i]); P[S_VAR_W + i] = vw[i]; }
    P[S_FLAME] = std::clamp(g[G_FLAME] * X[XF_M_FLAME] * (1.f + 0.5f * pulse * R) * fm, 0.f, 0.3f);
    P[S_AFF_ROT] = g[G_AFF_ROT]; P[S_AFF_SCALE] = g[G_AFF_SCALE]; P[S_AFF_SHEAR] = g[G_AFF_SHEAR];
    P[S_AFF_X] = g[G_AFF_X]; P[S_AFF_Y] = g[G_AFF_Y]; P[S_VAR_P1] = g[G_VAR_P1]; P[S_VAR_P2] = g[G_VAR_P2];
  }
  P[S_FLOW] = g[G_FLOW] * X[XF_M_FLOW] * (1.f + 0.5f * midX) * fm;
  P[S_FLOW_SCALE] = g[G_FLOW_SCALE];
  flowPhase += g[G_FLOW_SPEED] * dt * ms;
  P[S_FLOW_PHASE] = flowPhase;
  P[S_VIGNETTE] = X[XF_VIGNETTE];

  // Complex lens and wallpaper tiling (composite).
  {
    int a1, a2;
    float m;
    top2(e.w[C_VIEW], Evolver::optionCount(C_VIEW), a1, a2, m);
    P[S_VIEW_A] = float(a1); P[S_VIEW_B] = float(a2); P[S_VIEW_MIX] = m;
    P[S_VIEW_AMT] = g[G_VIEW] * X[XF_M_VIEW];
    P[S_VIEW_P1] = g[G_VIEW_P1]; P[S_VIEW_P2] = g[G_VIEW_P2];
    viewPhase += g[G_VIEW_SPEED] * dt * ms;
    P[S_VIEW_PHASE] = viewPhase;
    top2(e.w[C_TILE], Evolver::optionCount(C_TILE), a1, a2, m);
    P[S_TILE_A] = float(a1); P[S_TILE_B] = float(a2); P[S_TILE_MIX] = m;
    P[S_TILE_AMT] = g[G_TILE] * X[XF_M_TILE];
    P[S_TILE_SCALE] = std::max(g[G_TILE_SCALE], 0.5f);
  }
  P[S_KAMT] = X[XF_L_KALEIDO];
  P[S_USER_SAT] = X[XF_SATURATION];

  // Palette.
  for (int i = 0; i < 3; i++) { P[S_PAL_C + i] = g[G_PAL_C0 + i]; P[S_PAL_D + i] = g[G_PAL_D0 + i]; }
  palPhase += g[G_PAL_SPEED] * dt * X[XF_PAL_SPEED];
  P[S_PAL_PHASE] = palPhase;
  P[S_PAL_SPREAD] = g[G_PAL_SPREAD];

  // Layers.
  P[S_SPEC_RING] = g[G_SPEC_RING] * X[XF_L_SPEC];
  P[S_SPEC_RADIUS] = g[G_SPEC_RADIUS];
  P[S_TUNNEL] = g[G_TUNNEL] * X[XF_L_TUNNEL];
  P[S_TUNNEL_SIDES] = Evolver::optionValue(C_TUNNEL_SIDES, e.choice[C_TUNNEL_SIDES]);
  P[S_SPARKLE] = g[G_SPARKLE] * X[XF_L_SPARKLE];
  P[S_ORBS] = g[G_ORBS] * X[XF_L_ORBS];
  P[S_BASS] = bass; P[S_MID] = mid; P[S_TREB] = treb; P[S_LEVEL] = a.level;
  P[S_ADD] = f60;
  orbPhase += dt * (0.4f + 0.8f * a.level * R) * ms;
  P[S_ORB_PHASE] = orbPhase;

  // Waveform. The math shapes can be turned down; their weight then goes to the circle.
  const float* sw = e.w[C_SHAPE];
  for (int i = 0; i < 5; i++) P[S_W_CIRCLE + i] = sw[i];
  float mshape = X[XF_M_SHAPES];
  P[S_W_SUPER] = sw[5] * mshape;
  P[S_W_LISS] = sw[6] * mshape;
  P[S_W_CIRCLE] += (sw[5] + sw[6]) * (1.f - mshape);
  P[S_SF_M] = g[G_SF_M]; P[S_SF_N1] = std::max(g[G_SF_N1], 0.2f); P[S_SF_N2] = g[G_SF_N2]; P[S_SF_N3] = g[G_SF_N3];
  P[S_LISS_A] = g[G_LISS_A]; P[S_LISS_B] = g[G_LISS_B];
  lissPhase += g[G_LISS_SPEED] * dt;
  P[S_LISS_PHASE] = lissPhase;
  P[S_WAVE_SCALE] = g[G_WAVE_SCALE] * (1.f + 0.12f * pulse * R);
  P[S_WAVE_GAIN] = g[G_WAVE_GAIN] * (0.3f + 0.7f * R);
  P[S_WAVE_THICK] = g[G_WAVE_THICK] * X[XF_WAVE_THICK];
  waveAngle += g[G_WAVE_SPIN] * dt;
  P[S_WAVE_ANGLE] = waveAngle;
  P[S_WAVE_BRIGHT] = g[G_WAVE_BRIGHT] * (0.35f + 0.9f * a.level) * X[XF_L_WAVE];
  P[S_ROSE_K] = g[G_ROSE_K];
  float eff = 0, alpha[6] = {};
  for (int o = 0; o < Evolver::optionCount(C_COPIES); o++) {
    float n = Evolver::optionValue(C_COPIES, o), wt = e.w[C_COPIES][o];
    eff += wt * n;
    for (int c = 0; c < 6; c++) if (c < n) alpha[c] += wt;
  }
  P[S_COPIES] = std::max(eff, 1.f);
  out.copies = 1;
  for (int c = 0; c < 6; c++) {
    P[S_COPY_ALPHA + c] = alpha[c];
    if (alpha[c] > 0.002f) out.copies = c + 1;
  }

  // Strange attractor: thousands of points iterated through a 2-D map, added to the feedback.
  {
    float amt = g[G_ATTR] * X[XF_L_ATTR];
    int pts = std::clamp(int(X[XF_ATTR_POINTS] * 1000.f), 1000, 200000);
    out.attrPoints = amt > 0.002f ? pts : 0;
    float size = X[XF_ATTR_SIZE] * std::max(1.f, float(h) / 1080.f);
    P[S_ATTR_A] = g[G_ATTR_A] + 0.06f * bassX;
    P[S_ATTR_A + 1] = g[G_ATTR_B] - 0.04f * midX;
    P[S_ATTR_A + 2] = g[G_ATTR_C];
    P[S_ATTR_A + 3] = g[G_ATTR_D];
    int a1, a2;
    float m;
    top2(e.w[C_ATTR], Evolver::optionCount(C_ATTR), a1, a2, m);
    P[S_ATTR_FAM_A] = float(a1); P[S_ATTR_FAM_B] = float(a2); P[S_ATTR_MIX] = m;
    // Keep the added light per pixel about the same whatever the point count, dot size and window size.
    float norm = (float(w) * float(h) / 1.44e6f) * (40000.f / float(pts)) * (1.44f / (size * size));
    P[S_ATTR_BRIGHT] = std::min(amt * 0.04f * norm * f60 * (0.5f + 0.8f * a.level * R), 2.f);
    P[S_ATTR_SCALE] = g[G_ATTR_SCALE] * (1.f + 0.08f * pulse * R);
    attrAngle += g[G_ATTR_SPIN] * dt * ms;
    P[S_ATTR_SPIN] = attrAngle;
    P[S_ATTR_SIZE] = size;
    P[S_ATTR_ITER] = std::round(X[XF_ATTR_ITER]);
    P[S_ATTR_SEED] = float(frame % 65536u);
  }

  // Composite: blend the two strongest kaleidoscope options.
  {
    int a1, a2;
    float m;
    top2(e.w[C_KALEIDO], Evolver::optionCount(C_KALEIDO), a1, a2, m);
    P[S_KA] = Evolver::optionValue(C_KALEIDO, a1);
    P[S_KB] = Evolver::optionValue(C_KALEIDO, a2);
    P[S_KMIX] = m;
  }
  kSpin += g[G_KSPIN] * dt;
  P[S_KSPIN] = kSpin;
  P[S_CHROMA] = g[G_CHROMA] * (1.f + pulse * R) * X[XF_L_CHROMA];
  P[S_ECHO] = g[G_ECHO] * X[XF_L_ECHO];
  P[S_ECHO_ZOOM] = std::max(g[G_ECHO_ZOOM], 0.2f);
  echoAngle += g[G_ECHO_SPIN] * dt;
  P[S_ECHO_ANGLE] = echoAngle;
  const float* ew = e.w[C_ECHO_FLIP];
  P[S_ECHO_FLIP_X] = ew[1] + ew[3];
  P[S_ECHO_FLIP_Y] = ew[2] + ew[3];
  P[S_BRIGHT] = s.brightness * 1.3f / (1.f + 0.6f * fl);
  P[S_BLACK] = std::clamp(meanLum, 0.f, 2.f) * std::min(fl, 1.f) * 0.45f;
  P[S_SAT] = 0.35f * std::min(fl, 1.f);
  P[S_FLASH] = g[G_BEAT_FLASH] * pulse * pulse * R * 0.5f * X[XF_L_FLASH];
  P[S_GRIP_X] = gripX; P[S_GRIP_Y] = gripY; P[S_GRIP_R] = gripR; P[S_GRIP_OP] = gripOp;

  // Tunnel rings: born on beats, expand and fade.
  if (beat && g[G_TUNNEL] > 0.02f) {
    for (int i = 7; i > 0; i--) { rings[i][0] = rings[i - 1][0]; rings[i][1] = rings[i - 1][1]; }
    rings[0][0] = 0.02f;
    rings[0][1] = 0.5f + 0.5f * std::min(bassX, 1.f);
  }
  for (int i = 0; i < 8; i++) {
    if (rings[i][1] <= 0) continue;
    rings[i][0] += dt * (0.3f + 0.3f * a.level) * ms;
    rings[i][1] *= std::exp(-dt * 0.7f);
    if (rings[i][0] > 1.6f || rings[i][1] < 0.01f) rings[i][1] = 0;
    P[S_RINGS + i * 2] = rings[i][0];
    P[S_RINGS + i * 2 + 1] = rings[i][1];
  }
}
