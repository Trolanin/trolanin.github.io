#pragma once
#include "app.h"
#include "audio.h"
#include <random>
#include <vector>

// Continuous genes. Motion values are per frame at 60 fps; Visuals rescales them to the real frame time.
enum Gene {
  G_ZOOM, G_ROT, G_SWIRL, G_WARP, G_WARP_FREQ, G_WARP_SPEED, G_DRIFT_X, G_DRIFT_Y, G_DECAY, G_HUE,
  G_WAVE_SCALE, G_WAVE_GAIN, G_WAVE_THICK, G_WAVE_SPIN, G_WAVE_BRIGHT, G_ROSE_K,
  G_SPEC_RING, G_SPEC_RADIUS, G_TUNNEL, G_SPARKLE, G_ORBS,
  G_PAL_C0, G_PAL_C1, G_PAL_C2, G_PAL_D0, G_PAL_D1, G_PAL_D2, G_PAL_SPEED, G_PAL_SPREAD,
  G_KSPIN, G_CHROMA, G_ECHO, G_ECHO_ZOOM, G_ECHO_SPIN,
  G_BASS_ZOOM, G_BEAT_KICK, G_BEAT_FLASH,
  G_COUNT
};

// Discrete genes. They cross-fade between options instead of jumping.
enum Choice { C_SHAPE, C_COPIES, C_KALEIDO, C_MIRROR, C_ECHO_FLIP, C_TUNNEL_SIDES, C_COUNT };
constexpr int MAX_OPT = 8;

// The progressive part: a genome that drifts continuously, mutates on scene changes
// (the music changing character, or a timer), unlocks extra layers as "complexity"
// builds up over minutes of music, and starts a fresh, simple "species" after a silence
// (a new song), sometimes bred from the looks you kept.
class Evolver {
public:
  float g[G_COUNT] = {};            // current values (what is drawn)
  float w[C_COUNT][MAX_OPT] = {};   // current option weights
  int choice[C_COUNT] = {};         // option each choice is heading to
  float complexity = 0.f;
  int generation = 1, scene = 1;
  std::wstring lastEvent;

  void init(unsigned seed, const std::wstring& favPath);
  void update(float dt, const AudioFrame& a, const Settings& s);
  void mutateScene(float strength, const wchar_t* why);
  void newSpecies(const wchar_t* why);
  void like();
  int favoriteCount() const { return int(favs.size()); }
  std::wstring describe() const;
  static float optionValue(int c, int opt);
  static int optionCount(int c);

private:
  float tgt[G_COUNT] = {}, vel[G_COUNT] = {};
  std::mt19937 rng;
  float sceneTime = 0, silentTime = 0, boost = 0, prevComplexity = 0;
  int lastBeats = -1, lastSections = -1;
  std::vector<std::vector<float>> favs;
  std::wstring favPath;

  float uni(float a = 0.f, float b = 1.f) { return a + (b - a) * std::uniform_real_distribution<float>(0.f, 1.f)(rng); }
  float gauss() { return std::normal_distribution<float>(0.f, 1.f)(rng); }
  void range(int gene, float& lo, float& hi) const;
  void pickChoice(int c, bool mustChange);
  void randomize();
  void loadFavs();
  void saveFavs() const;
};

// Turns the genome plus the live audio into shader parameters, and keeps the
// accumulators (phases, beat pulse, tunnel rings) that need memory between frames.
class Visuals {
public:
  // meanLum: average brightness of the feedback buffer (from the GPU, a few frames late; -1 = unknown).
  void build(float* P, const Evolver& e, const AudioFrame& a, const Settings& s, float dt, int w, int h,
             float gripX, float gripY, float gripR, float gripOp, float meanLum, int& copiesToDraw);
  float fill = 0;   // how far over the brightness target the picture is (smoothed), for the log
private:
  float time = 0, warpPhase = 0, palPhase = 0, waveAngle = 0, kSpin = 0, orbPhase = 0, echoAngle = 0;
  float pulse = 0, bass = 1, mid = 1, treb = 1;
  int lastBeats = -1;
  float rings[8][2] = {};
};
