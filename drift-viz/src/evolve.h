#pragma once
#include "app.h"
#include "audio.h"
#include <random>
#include <vector>

// Continuous genes. Motion values are per frame at 60 fps; Visuals rescales them to the real frame time.
// The order is stored in favourites.txt: only ever append.
enum Gene {
  G_ZOOM, G_ROT, G_SWIRL, G_WARP, G_WARP_FREQ, G_WARP_SPEED, G_DRIFT_X, G_DRIFT_Y, G_DECAY, G_HUE,
  G_WAVE_SCALE, G_WAVE_GAIN, G_WAVE_THICK, G_WAVE_SPIN, G_WAVE_BRIGHT, G_ROSE_K,
  G_SPEC_RING, G_SPEC_RADIUS, G_TUNNEL, G_SPARKLE, G_ORBS,
  G_PAL_C0, G_PAL_C1, G_PAL_C2, G_PAL_D0, G_PAL_D1, G_PAL_D2, G_PAL_SPEED, G_PAL_SPREAD,
  G_KSPIN, G_CHROMA, G_ECHO, G_ECHO_ZOOM, G_ECHO_SPIN,
  G_BASS_ZOOM, G_BEAT_KICK, G_BEAT_FLASH,
  // math space (version 2)
  G_FLAME, G_FLAME_MIX, G_AFF_ROT, G_AFF_SCALE, G_AFF_SHEAR, G_AFF_X, G_AFF_Y, G_VAR_P1, G_VAR_P2,
  G_FLOW, G_FLOW_SCALE, G_FLOW_SPEED,
  G_VIEW, G_VIEW_P1, G_VIEW_P2, G_VIEW_SPEED,
  G_TILE, G_TILE_SCALE,
  G_SF_M, G_SF_N1, G_SF_N2, G_SF_N3, G_LISS_A, G_LISS_B, G_LISS_SPEED,
  G_ATTR, G_ATTR_A, G_ATTR_B, G_ATTR_C, G_ATTR_D, G_ATTR_SCALE, G_ATTR_SPIN,
  G_COUNT
};

// Discrete genes. They cross-fade between options instead of jumping. Append only.
enum Choice {
  C_SHAPE, C_COPIES, C_KALEIDO, C_MIRROR, C_ECHO_FLIP, C_TUNNEL_SIDES,
  C_FLAME_A, C_FLAME_B, C_VIEW, C_TILE, C_ATTR,
  C_COUNT
};
constexpr int MAX_OPT = 24;

// What part of the look a gene or choice belongs to. Audio events mutate groups, and each
// group's drift speed can follow a different feature of the music. Same order as Target - 1.
enum Group { GR_MOTION, GR_COLOUR, GR_SHAPE, GR_LAYERS, GR_SPACE, GR_SYMMETRY, GR_COUNT };
constexpr unsigned GM_ALL = (1u << GR_COUNT) - 1;

// The evolving part: a genome that drifts continuously, mutates on scene changes (the music
// changing character, audio events, or a randomly timed scene timer), and starts a fresh
// "species" after a silence (a new song), sometimes bred from the looks you kept.
//
// "Complexity" wanders up and down toward targets redrawn at random moments. Each species
// draws its own threshold for every layer and every option, plus its own starting complexity,
// so which layers show up, and in what order, is different every time (some never appear).
//
// On top of each gene's own random walk, two shared signals move many genes at once, so the
// genome travels along directions no single gene has:
//  - latent mixing: six slow random factors, each loaded onto a sparse random set of genes;
//  - a Lorenz attractor, integrated slowly, whose chaotic wings are loaded onto other genes.
// Both loadings are redrawn for every species.
class Evolver {
public:
  float g[G_COUNT] = {};            // current values (what is drawn)
  float w[C_COUNT][MAX_OPT] = {};   // current option weights
  int choice[C_COUNT] = {};         // option each choice is heading to
  float complexity = 0.f;
  int generation = 1, scene = 1;
  std::wstring lastEvent;

  void init(unsigned seed, const std::wstring& favPath, const Settings& s);
  void update(float dt, const AudioFrame& a, const Settings& s);
  void mutateScene(float strength, const std::wstring& why, unsigned groups = GM_ALL);
  void newSpecies(const wchar_t* why);
  void like();
  void loadFav(int k);     // bring back kept look k, as a new species that starts from it
  void deleteFav(int k);
  int favoriteCount() const { return int(favs.size()); }
  std::vector<std::wstring> favLabels() const;   // one line per kept look, for the settings window
  int favVersion = 0;      // bumped whenever the kept looks change
  std::wstring describe() const;
  std::wstring heard(const AudioFrame& a) const;
  static float optionValue(int c, int opt);
  static int optionCount(int c);
  static const wchar_t* optionLabel(int c, int opt);

private:
  static constexpr int LATENT = 6;
  float base[G_COUNT] = {}, tgt[G_COUNT] = {}, vel[G_COUNT] = {};
  float loadL[G_COUNT][LATENT] = {}, loadZ[G_COUNT][3] = {};
  float z[LATENT] = {}, lor[3] = { 1.f, 1.f, 20.f };
  float steerMul[GR_COUNT] = { 1, 1, 1, 1, 1, 1 }, feat[GR_COUNT] = {};
  // Per-species thresholds. < 0 = always there; otherwise added to the species' math threshold
  // for math genes and options. easeMul / fadeMul vary how fast each change settles.
  float relGate[G_COUNT] = {}, relOpt[C_COUNT][MAX_OPT] = {}, mathJit = 0;
  float easeMul[G_COUNT] = {}, fadeMul[C_COUNT] = {};
  float cxTarget = 0.5f, cxTimer = 0, sceneFrac = 1;
  std::mt19937 rng;
  Settings set;   // last settings seen (for ranges and breeding)
  float sceneTime = 0, silentTime = 0, boost = 0, prevComplexity = 0, sinceEvent = 100, mathGate = 0.35f;
  int lastBeats = -1, phraseBeats = 0;
  int lastCount[9] = {};
  bool countsInit = false;
  std::vector<std::vector<float>> favs;
  std::vector<long long> favTime;   // when each was kept (unix time; 0 = before times were saved)
  std::wstring favPath;

  float uni(float a = 0.f, float b = 1.f) { return a + (b - a) * std::uniform_real_distribution<float>(0.f, 1.f)(rng); }
  float gauss() { return std::normal_distribution<float>(0.f, 1.f)(rng); }
  int pick(int n) { return std::uniform_int_distribution<int>(0, n - 1)(rng); }
  float spMath() const;
  float gateOf(int gene) const;
  float optGate(int c, int opt) const;
  void range(int gene, float& lo, float& hi) const;
  void pickChoice(int c, bool mustChange);
  void randomize();
  void newLoadings();
  void newGates();
  void newPacing();
  float startComplexity();
  static std::wstring describeLook(const float* genes, const int* choices);
  void loadFavs();
  void saveFavs() const;
};

// Turns the genome plus the live audio into shader parameters, and keeps the
// accumulators (phases, beat pulse, tunnel rings) that need memory between frames.
struct DrawInfo { int copies = 1, attrPoints = 0; };
class Visuals {
public:
  // meanLum: average brightness of the feedback buffer (from the GPU, a few frames late; -1 = unknown).
  void build(float* P, const Evolver& e, const AudioFrame& a, const Settings& s, float dt, int w, int h,
             float gripX, float gripY, float gripR, float gripOp, float meanLum, DrawInfo& out);
  float fill = 0;   // how far over the brightness target the picture is (smoothed), for the log
  void seed(unsigned s);   // random starting phases, so the first seconds differ every launch
private:
  float time = 0, warpPhase = 0, palPhase = 0, waveAngle = 0, kSpin = 0, orbPhase = 0, echoAngle = 0;
  float flowPhase = 0, viewPhase = 0, lissPhase = 0, attrAngle = 0;
  float pulse = 0, bass = 1, mid = 1, treb = 1;
  int lastBeats = -1;
  unsigned frame = 0;
  float rings[8][2] = {};
};
