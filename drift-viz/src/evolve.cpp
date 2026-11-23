// The evolving genome behind the visuals, and its mapping to shader parameters.
#include "evolve.h"
#include "params.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace {
// lo..hi is the full range, reached at complexity 1. calmLo..calmHi is the range at
// complexity 0, or right when the gene unlocks. Genes with a gate are off (0) below it.
struct GeneDef { const wchar_t* name; float lo, hi, calmLo, calmHi, gate; bool drift; };
const GeneDef kGenes[G_COUNT] = {
  { L"zoom",            0.985f, 1.045f, 1.000f, 1.012f, 0.00f, true },
  { L"rotation",       -0.030f, 0.030f, -0.004f, 0.004f, 0.00f, true },
  { L"swirl",          -0.035f, 0.035f, -0.006f, 0.006f, 0.20f, true },
  { L"warp",            0.000f, 0.008f, 0.0005f, 0.002f, 0.00f, true },
  { L"warp size",       2.0f,   14.0f,  3.0f,   7.0f,   0.00f, true },
  { L"warp speed",      0.2f,   3.0f,   0.3f,   1.0f,   0.00f, true },
  { L"drift",          -0.004f, 0.004f, -0.0008f, 0.0008f, 0.30f, true },
  { L"drift",          -0.004f, 0.004f, -0.0008f, 0.0008f, 0.30f, true },
  { L"trails",          0.90f,  0.985f, 0.93f,  0.965f, 0.00f, true },
  { L"colour drift",   -0.030f, 0.030f, -0.006f, 0.006f, 0.15f, true },
  { L"wave size",       0.12f,  0.42f,  0.20f,  0.30f,  0.00f, true },
  { L"wave gain",       0.10f,  0.80f,  0.15f,  0.40f,  0.00f, true },
  { L"wave thickness",  0.0015f, 0.008f, 0.002f, 0.004f, 0.00f, true },
  { L"wave spin",      -1.2f,   1.2f,  -0.3f,   0.3f,   0.00f, true },
  { L"wave brightness", 0.25f,  1.0f,   0.45f,  0.8f,   0.00f, true },
  { L"petals",          2.0f,   7.0f,   2.0f,   5.0f,   0.00f, false },
  { L"spectrum ring",   0.0f,   1.0f,   0.4f,   0.8f,   0.15f, true },
  { L"ring radius",     0.05f,  0.40f,  0.15f,  0.30f,  0.00f, true },
  { L"tunnel rings",    0.0f,   1.0f,   0.5f,   0.9f,   0.30f, true },
  { L"sparkles",        0.0f,   1.0f,   0.4f,   0.8f,   0.45f, true },
  { L"orbs",            0.0f,   1.0f,   0.4f,   0.8f,   0.55f, true },
  { L"palette",         0.3f,   1.6f,   0.5f,   1.1f,   0.00f, true },
  { L"palette",         0.3f,   1.6f,   0.5f,   1.1f,   0.00f, true },
  { L"palette",         0.3f,   1.6f,   0.5f,   1.1f,   0.00f, true },
  { L"palette",         0.0f,   1.0f,   0.0f,   1.0f,   0.00f, true },
  { L"palette",         0.0f,   1.0f,   0.0f,   1.0f,   0.00f, true },
  { L"palette",         0.0f,   1.0f,   0.0f,   1.0f,   0.00f, true },
  { L"colour cycling", -0.25f,  0.25f, -0.06f,  0.06f,  0.00f, true },
  { L"colour spread",   0.2f,   3.0f,   0.3f,   1.2f,   0.00f, true },
  { L"kaleidoscope spin", -0.6f, 0.6f, -0.1f,   0.1f,   0.00f, true },
  { L"chromatic split", 0.0f,   0.030f, 0.004f, 0.010f, 0.40f, true },
  { L"echo",            0.0f,   0.6f,   0.2f,   0.4f,   0.50f, true },
  { L"echo zoom",       0.5f,   2.0f,   0.8f,   1.3f,   0.00f, true },
  { L"echo spin",      -0.5f,   0.5f,  -0.1f,   0.1f,   0.00f, true },
  { L"bass zoom",       0.0f,   0.030f, 0.0f,   0.010f, 0.00f, true },
  { L"beat kick",       0.0f,   1.0f,   0.0f,   0.4f,   0.00f, true },
  { L"beat flash",      0.0f,   0.25f,  0.02f,  0.08f,  0.35f, true },
};

struct ChoiceDef { const wchar_t* name; int n; float val[MAX_OPT]; float gate[MAX_OPT]; const wchar_t* label[MAX_OPT]; };
const ChoiceDef kChoices[C_COUNT] = {
  { L"wave shape", 5, { 0, 1, 2, 3, 4 }, { 0, 0, 0.10f, 0.25f, 0.35f }, { L"circle", L"line", L"scope", L"spiral", L"rose" } },
  { L"copies", 5, { 1, 2, 3, 4, 6 }, { 0, 0.20f, 0.30f, 0.45f, 0.60f }, { L"×1", L"×2", L"×3", L"×4", L"×6" } },
  { L"kaleidoscope", 7, { 1, 3, 4, 5, 6, 8, 12 }, { 0, 0.30f, 0.30f, 0.40f, 0.40f, 0.55f, 0.70f }, { L"off", L"3", L"4", L"5", L"6", L"8", L"12" } },
  { L"mirror", 4, { 0, 1, 2, 3 }, { 0, 0.35f, 0.45f, 0.60f }, { L"none", L"left-right", L"top-bottom", L"four-way" } },
  { L"echo flip", 4, { 0, 1, 2, 3 }, { 0, 0, 0, 0 }, { L"none", L"flip X", L"flip Y", L"flip XY" } },
  { L"tunnel shape", 4, { 0, 3, 4, 6 }, { 0, 0, 0, 0 }, { L"circles", L"triangles", L"squares", L"hexagons" } },
};
const int kFavFloats = 1 + G_COUNT + C_COUNT;
}  // namespace

float Evolver::optionValue(int c, int opt) { return kChoices[c].val[opt]; }
int Evolver::optionCount(int c) { return kChoices[c].n; }

void Evolver::range(int i, float& lo, float& hi) const {
  const GeneDef& d = kGenes[i];
  if (complexity < d.gate) { lo = hi = 0.f; return; }
  float f = std::clamp((complexity - d.gate) / (1.f - d.gate), 0.f, 1.f);
  lo = d.calmLo + (d.lo - d.calmLo) * f;
  hi = d.calmHi + (d.hi - d.calmHi) * f;
}

void Evolver::pickChoice(int c, bool mustChange) {
  const ChoiceDef& d = kChoices[c];
  int opts[MAX_OPT], n = 0;
  for (int o = 0; o < d.n; o++)
    if (d.gate[o] <= complexity && !(mustChange && o == choice[c])) opts[n++] = o;
  if (n) choice[c] = opts[std::uniform_int_distribution<int>(0, n - 1)(rng)];
}

void Evolver::randomize() {
  for (int i = 0; i < G_COUNT; i++) {
    float lo, hi;
    range(i, lo, hi);
    tgt[i] = uni(lo, hi);
    vel[i] = 0;
  }
  tgt[G_ROSE_K] = std::round(uni(2.f, 6.f));
  for (int c = 0; c < C_COUNT; c++) pickChoice(c, false);
}

void Evolver::init(unsigned seed, const std::wstring& path) {
  rng.seed(seed);
  favPath = path;
  loadFavs();
  complexity = prevComplexity = 0.f;
  for (int c = 0; c < C_COUNT; c++) choice[c] = 0;
  randomize();
  for (int i = 0; i < G_COUNT; i++) g[i] = tgt[i];
  for (int c = 0; c < C_COUNT; c++)
    for (int o = 0; o < MAX_OPT; o++) w[c][o] = o == choice[c] ? 1.f : 0.f;
  lastEvent = L"Started simple; layers unlock as the music keeps going.";
}

void Evolver::mutateScene(float strength, const wchar_t* why) {
  scene++;
  sceneTime = 0;
  int k = 2 + int(strength * 8.f);
  for (int i = 0; i < k; i++) {
    int gi = std::uniform_int_distribution<int>(0, G_COUNT - 1)(rng);
    float lo, hi;
    range(gi, lo, hi);
    if (gi == G_ROSE_K) { tgt[gi] = std::round(uni(2.f, 7.f)); continue; }
    float mix = 0.5f + 0.5f * strength;
    tgt[gi] += (uni(lo, hi) - tgt[gi]) * mix;
  }
  // Always change at least one discrete gene so a scene change is visible.
  std::wstring changed;
  int nc = 1 + (uni() < strength ? 1 : 0) + (uni() < strength * 0.5f ? 1 : 0);
  for (int i = 0; i < nc; i++) {
    int c = std::uniform_int_distribution<int>(0, C_COUNT - 1)(rng);
    int before = choice[c];
    pickChoice(c, true);
    if (choice[c] != before) {
      if (!changed.empty()) changed += L", ";
      changed += kChoices[c].name;
      changed += L" → ";
      changed += kChoices[c].label[choice[c]];
    }
  }
  boost = std::max(boost, 0.6f);
  lastEvent = std::wstring(why) + (changed.empty() ? L"" : L": " + changed);
}

void Evolver::newSpecies(const wchar_t* why) {
  generation++;
  scene = 1;
  sceneTime = 0;
  if (!favs.empty() && uni() < 0.5f) {
    const auto& A = favs[std::uniform_int_distribution<size_t>(0, favs.size() - 1)(rng)];
    const auto& B = favs[std::uniform_int_distribution<size_t>(0, favs.size() - 1)(rng)];
    complexity = std::max(0.05f, 0.5f * (A[0] + B[0]) * 0.8f);
    for (int i = 0; i < G_COUNT; i++) {
      tgt[i] = (uni() < 0.5f ? A : B)[1 + i];
      float lo, hi;
      range(i, lo, hi);
      if (i != G_ROSE_K) tgt[i] += gauss() * 0.05f * (hi - lo);
      vel[i] = 0;
    }
    for (int c = 0; c < C_COUNT; c++) {
      int o = int((uni() < 0.5f ? A : B)[1 + G_COUNT + c]);
      choice[c] = std::clamp(o, 0, kChoices[c].n - 1);
    }
    lastEvent = std::wstring(why) + L": bred from two of your kept looks";
  } else {
    complexity = 0.05f;
    randomize();
    lastEvent = std::wstring(why) + L": a fresh, simple look";
  }
  prevComplexity = complexity;
  boost = 2.0f;
}

void Evolver::update(float dt, const AudioFrame& a, const Settings& s) {
  if (lastBeats < 0) { lastBeats = a.beats; lastSections = a.sections; }
  bool beat = a.beats != lastBeats, section = a.sections != lastSections;
  lastBeats = a.beats;
  lastSections = a.sections;

  if (!s.freeze) {
    sceneTime += dt;
    // Complexity builds while music plays and drains during silence.
    if (a.silent) {
      silentTime += dt;
      if (silentTime > 2.f) complexity = std::max(0.f, complexity - dt * 0.2f);
    } else {
      if (silentTime > 4.f) newSpecies(L"New song");
      silentTime = 0;
      complexity = std::min(s.complexityCap, complexity + dt / std::max(6.f, s.buildMin * 60.f));
    }
    if (complexity > s.complexityCap) complexity = std::max(s.complexityCap, complexity - dt * 0.1f);

    // Layers unlock as complexity crosses their gate.
    for (int i = 0; i < G_COUNT; i++) {
      const GeneDef& d = kGenes[i];
      if (d.gate > 0 && prevComplexity < d.gate && complexity >= d.gate) {
        tgt[i] = uni(d.calmLo, d.calmHi);
        lastEvent = std::wstring(L"Unlocked ") + d.name;
      }
    }
    prevComplexity = complexity;

    // Slow drift: each gene's target wanders (a damped random walk) inside its allowed range.
    float sq = std::sqrt(std::max(dt, 1e-4f));
    for (int i = 0; i < G_COUNT; i++) {
      float lo, hi;
      range(i, lo, hi);
      if (kGenes[i].drift && hi > lo) {
        vel[i] = vel[i] * std::exp(-dt * 0.7f) + gauss() * sq * 0.8f;
        tgt[i] += vel[i] * dt * 0.04f * s.evoSpeed * (hi - lo);
      }
      if (tgt[i] < lo) { tgt[i] = lo + std::min(lo - tgt[i], hi - lo); vel[i] = std::fabs(vel[i]); }
      if (tgt[i] > hi) { tgt[i] = hi - std::min(tgt[i] - hi, hi - lo); vel[i] = -std::fabs(vel[i]); }
      tgt[i] = std::clamp(tgt[i], lo, hi);
    }

    // Small nudges on some beats.
    if (beat && uni() < 0.05f * s.evoSpeed) {
      int gi = std::uniform_int_distribution<int>(0, G_COUNT - 1)(rng);
      if (kGenes[gi].drift) {
        float lo, hi;
        range(gi, lo, hi);
        tgt[gi] += (uni(lo, hi) - tgt[gi]) * (0.1f + 0.3f * s.mutation);
      }
    }

    // Scene changes: the music changed character, or the scene ran its length.
    if (section && sceneTime > 6.f) mutateScene(0.4f + 0.6f * s.mutation, L"The music changed");
    else if (sceneTime > s.sceneLen) mutateScene(0.25f + 0.5f * s.mutation, L"Scene timer");

    // Options that are locked again (complexity fell) get replaced.
    for (int c = 0; c < C_COUNT; c++)
      if (kChoices[c].gate[choice[c]] > complexity) pickChoice(c, false);
  }

  // Ease the drawn values toward their targets; faster right after a new species.
  float k = 1.f - std::exp(-dt * (0.6f + boost));
  for (int i = 0; i < G_COUNT; i++) g[i] += (tgt[i] - g[i]) * k;
  float kc = 1.f - std::exp(-dt * (0.8f + boost));
  for (int c = 0; c < C_COUNT; c++)
    for (int o = 0; o < MAX_OPT; o++) w[c][o] += ((o == choice[c] ? 1.f : 0.f) - w[c][o]) * kc;
  boost = std::max(0.f, boost - dt * 1.5f);
}

std::wstring Evolver::describe() const {
  std::wstring s = kChoices[C_SHAPE].label[choice[C_SHAPE]];
  if (choice[C_COPIES] > 0) s += std::wstring(L" ") + kChoices[C_COPIES].label[choice[C_COPIES]];
  if (choice[C_KALEIDO] > 0) s += std::wstring(L" · kaleidoscope ") + kChoices[C_KALEIDO].label[choice[C_KALEIDO]];
  if (choice[C_MIRROR] > 0) s += std::wstring(L" · mirror ") + kChoices[C_MIRROR].label[choice[C_MIRROR]];
  struct { int gene; float min; const wchar_t* name; } layers[] = {
    { G_SPEC_RING, 0.1f, L"spectrum ring" }, { G_TUNNEL, 0.1f, L"tunnel" }, { G_SPARKLE, 0.1f, L"sparkles" },
    { G_ORBS, 0.1f, L"orbs" }, { G_ECHO, 0.08f, L"echo" }, { G_CHROMA, 0.004f, L"chroma split" },
  };
  for (auto& l : layers)
    if (tgt[l.gene] > l.min) s += std::wstring(L" · ") + l.name;
  return s;
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
  char line[4096];
  while (fgets(line, sizeof line, fp)) {
    std::vector<float> f;
    char* p = line;
    for (;;) {
      char* e;
      float v = strtof(p, &e);
      if (e == p) break;
      f.push_back(v);
      p = e;
    }
    if (int(f.size()) == kFavFloats) favs.push_back(f);   // skip lines from other versions
  }
  fclose(fp);
}

void Evolver::saveFavs() const {
  if (favPath.empty()) return;
  FILE* fp = _wfopen(favPath.c_str(), L"w");
  if (!fp) return;
  for (auto& f : favs) {
    for (size_t i = 0; i < f.size(); i++) fprintf(fp, i ? " %.6g" : "%.6g", f[i]);
    fputc('\n', fp);
  }
  fclose(fp);
}

/* ------------------------------ shader parameters ------------------------------ */
void Visuals::build(float* P, const Evolver& e, const AudioFrame& a, const Settings& s, float dt, int w, int h,
                    float gripX, float gripY, float gripR, float gripOp, float meanLum, int& copiesToDraw) {
  std::fill(P, P + P_FLOATS, 0.f);
  const float* g = e.g;
  time += dt;
  float f60 = std::min(dt * 60.f, 3.f), R = s.reactivity;
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
  const float target = 0.28f;
  if (meanLum >= 0) {
    float over = std::clamp((meanLum * (1.f + g[G_ECHO]) - target) / target, 0.f, 3.f);
    fill += (over - fill) * (1.f - std::exp(-dt * (over > fill ? 2.f : 0.7f)));
  }

  // Feedback motion.
  float zoom = g[G_ZOOM] + g[G_BASS_ZOOM] * bassX + g[G_BEAT_KICK] * pulse * 0.012f * R;
  P[S_ZOOM] = std::pow(std::max(zoom, 0.5f), f60);
  P[S_ROT] = (g[G_ROT] + g[G_BEAT_KICK] * pulse * 0.008f * R * (g[G_ROT] >= 0 ? 1.f : -1.f)) * f60;
  P[S_SWIRL] = g[G_SWIRL] * f60;
  P[S_WARP] = g[G_WARP] * (1.f + 0.6f * midX) * f60;
  P[S_WARP_FREQ] = g[G_WARP_FREQ];
  warpPhase += g[G_WARP_SPEED] * dt * (1.f + 0.3f * R * a.level);
  P[S_WARP_PHASE] = warpPhase;
  P[S_DRIFT_X] = g[G_DRIFT_X] * f60;
  P[S_DRIFT_Y] = g[G_DRIFT_Y] * f60;
  P[S_DECAY] = std::pow(std::clamp(g[G_DECAY] + s.trails * 0.035f - 0.025f * std::min(fill, 1.5f), 0.8f, 0.995f), f60);
  P[S_HUE] = g[G_HUE] * f60;
  const float* mw = e.w[C_MIRROR];
  P[S_MIRROR_X] = mw[1] + mw[3];
  P[S_MIRROR_Y] = mw[2] + mw[3];

  // Palette.
  for (int i = 0; i < 3; i++) { P[S_PAL_C + i] = g[G_PAL_C0 + i]; P[S_PAL_D + i] = g[G_PAL_D0 + i]; }
  palPhase += g[G_PAL_SPEED] * dt;
  P[S_PAL_PHASE] = palPhase;
  P[S_PAL_SPREAD] = g[G_PAL_SPREAD];

  // Layers.
  P[S_SPEC_RING] = g[G_SPEC_RING];
  P[S_SPEC_RADIUS] = g[G_SPEC_RADIUS];
  P[S_TUNNEL] = g[G_TUNNEL];
  P[S_TUNNEL_SIDES] = Evolver::optionValue(C_TUNNEL_SIDES, e.choice[C_TUNNEL_SIDES]);
  P[S_SPARKLE] = g[G_SPARKLE];
  P[S_ORBS] = g[G_ORBS];
  P[S_BASS] = bass; P[S_MID] = mid; P[S_TREB] = treb; P[S_LEVEL] = a.level;
  P[S_ADD] = f60;
  orbPhase += dt * (0.4f + 0.8f * a.level * R);
  P[S_ORB_PHASE] = orbPhase;

  // Waveform.
  for (int i = 0; i < 5; i++) P[S_W_CIRCLE + i] = e.w[C_SHAPE][i];
  P[S_WAVE_SCALE] = g[G_WAVE_SCALE] * (1.f + 0.12f * pulse * R);
  P[S_WAVE_GAIN] = g[G_WAVE_GAIN] * (0.3f + 0.7f * R);
  P[S_WAVE_THICK] = g[G_WAVE_THICK];
  waveAngle += g[G_WAVE_SPIN] * dt;
  P[S_WAVE_ANGLE] = waveAngle;
  P[S_WAVE_BRIGHT] = g[G_WAVE_BRIGHT] * (0.35f + 0.9f * a.level);
  P[S_ROSE_K] = g[G_ROSE_K];
  float eff = 0, alpha[6] = {};
  for (int o = 0; o < Evolver::optionCount(C_COPIES); o++) {
    float n = Evolver::optionValue(C_COPIES, o), wt = e.w[C_COPIES][o];
    eff += wt * n;
    for (int c = 0; c < 6; c++) if (c < n) alpha[c] += wt;
  }
  P[S_COPIES] = std::max(eff, 1.f);
  copiesToDraw = 1;
  for (int c = 0; c < 6; c++) {
    P[S_COPY_ALPHA + c] = alpha[c];
    if (alpha[c] > 0.002f) copiesToDraw = c + 1;
  }

  // Composite: blend the two strongest kaleidoscope options.
  const float* kw = e.w[C_KALEIDO];
  int a1 = 0, a2 = -1;
  for (int o = 1; o < Evolver::optionCount(C_KALEIDO); o++) if (kw[o] > kw[a1]) a1 = o;
  for (int o = 0; o < Evolver::optionCount(C_KALEIDO); o++) if (o != a1 && (a2 < 0 || kw[o] > kw[a2])) a2 = o;
  float wa = kw[a1], wb = a2 >= 0 ? kw[a2] : 0.f;
  P[S_KA] = Evolver::optionValue(C_KALEIDO, a1);
  P[S_KB] = Evolver::optionValue(C_KALEIDO, a2 >= 0 ? a2 : a1);
  P[S_KMIX] = wb / std::max(wa + wb, 1e-4f);
  kSpin += g[G_KSPIN] * dt;
  P[S_KSPIN] = kSpin;
  P[S_CHROMA] = g[G_CHROMA] * (1.f + pulse * R);
  P[S_ECHO] = g[G_ECHO];
  P[S_ECHO_ZOOM] = std::max(g[G_ECHO_ZOOM], 0.2f);
  echoAngle += g[G_ECHO_SPIN] * dt;
  P[S_ECHO_ANGLE] = echoAngle;
  const float* ew = e.w[C_ECHO_FLIP];
  P[S_ECHO_FLIP_X] = ew[1] + ew[3];
  P[S_ECHO_FLIP_Y] = ew[2] + ew[3];
  P[S_BRIGHT] = s.brightness * 1.3f / (1.f + 0.6f * fill);
  P[S_BLACK] = std::clamp(meanLum, 0.f, 2.f) * std::min(fill, 1.f) * 0.45f;
  P[S_SAT] = 0.35f * std::min(fill, 1.f);
  P[S_FLASH] = g[G_BEAT_FLASH] * pulse * pulse * R * 0.5f;
  P[S_GRIP_X] = gripX; P[S_GRIP_Y] = gripY; P[S_GRIP_R] = gripR; P[S_GRIP_OP] = gripOp;

  // Tunnel rings: born on beats, expand and fade.
  if (beat && g[G_TUNNEL] > 0.02f) {
    for (int i = 7; i > 0; i--) { rings[i][0] = rings[i - 1][0]; rings[i][1] = rings[i - 1][1]; }
    rings[0][0] = 0.02f;
    rings[0][1] = 0.5f + 0.5f * std::min(bassX, 1.f);
  }
  for (int i = 0; i < 8; i++) {
    if (rings[i][1] <= 0) continue;
    rings[i][0] += dt * (0.3f + 0.3f * a.level);
    rings[i][1] *= std::exp(-dt * 0.7f);
    if (rings[i][0] > 1.6f || rings[i][1] < 0.01f) rings[i][1] = 0;
    P[S_RINGS + i * 2] = rings[i][0];
    P[S_RINGS + i * 2 + 1] = rings[i][1];
  }
}
