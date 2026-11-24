#pragma once
// The "excessive options": every extra knob, described by one table (options.cpp) that
// drives the settings UI, the settings file and the defaults. Code reads them as
// Settings::x[XF_...] (sliders) and Settings::xi[XI_...] (drop-downs).

enum XF {
  // audio analysis
  XF_BEAT_SENS, XF_BEAT_GAP, XF_SECTION_DB, XF_SECTION_COOL, XF_EVENT_SENS, XF_SILENCE_DB, XF_NEWSONG,
  XF_SPEC_FALL, XF_SPEC_RANGE,
  // mutate on audio events (amount, 0 = off)
  XF_T_SECTION, XF_T_DROP, XF_T_BUILD, XF_T_BREAK, XF_T_BRIGHT, XF_T_HATS, XF_T_VOCAL, XF_T_TEMPO, XF_T_HIT,
  XF_T_PHRASE, XF_T_COOLDOWN,
  // audio steers the drift
  XF_STEER,
  // evolution engine
  XF_DAMPING, XF_NUDGE_CHANCE, XF_NUDGE_SIZE, XF_GENES_PER_SCENE, XF_CHOICES_PER_SCENE, XF_FADE, XF_EASE,
  XF_BREED, XF_BREED_JITTER, XF_DRAIN, XF_START_CX, XF_LATENT, XF_LORENZ,
  // layer strengths
  XF_L_WAVE, XF_L_SPEC, XF_L_TUNNEL, XF_L_SPARKLE, XF_L_ORBS, XF_L_ATTR, XF_L_ECHO, XF_L_CHROMA, XF_L_FLASH,
  XF_L_KALEIDO, XF_L_MIRROR,
  // math space
  XF_M_GATE, XF_M_FLAME, XF_M_VIEW, XF_M_TILE, XF_M_FLOW, XF_M_SHAPES, XF_ATTR_POINTS, XF_ATTR_ITER, XF_ATTR_SIZE,
  // fine look
  XF_SATURATION, XF_EXPO_TARGET, XF_EXPO_AUTO, XF_VIGNETTE, XF_PAL_SPEED, XF_HUE_SPEED, XF_ZOOM_BIAS, XF_ROT_BIAS,
  XF_MOTION_SPEED, XF_WAVE_THICK, XF_GRIP_SIZE,
  XF_COUNT
};

enum XI {
  XI_T_SECTION, XI_T_DROP, XI_T_BUILD, XI_T_BREAK, XI_T_BRIGHT, XI_T_HATS, XI_T_VOCAL, XI_T_TEMPO, XI_T_HIT,
  XI_T_PHRASE, XI_PHRASE_LEN,
  XI_ST_MOTION, XI_ST_COLOUR, XI_ST_SHAPE, XI_ST_LAYERS, XI_ST_SPACE, XI_ST_SYMMETRY,
  XI_FPS,
  XI_COUNT
};

// What an audio event mutates (XI_T_* values).
enum Target { TGT_ALL, TGT_MOTION, TGT_COLOUR, TGT_SHAPE, TGT_LAYERS, TGT_SPACE, TGT_SYMMETRY, TGT_SPECIES };
// Which audio feature speeds up a group's drift (XI_ST_* values).
enum Steer { ST_OFF, ST_LEVEL, ST_BASS, ST_MID, ST_TREB, ST_BRIGHT, ST_BEATS, ST_NOVELTY };

extern const int kPhraseBeats[4];
extern const int kFpsCaps[6];   // 0 = monitor refresh

enum OptKind { OPT_SLIDER, OPT_COMBO };
enum OptFmt { FMT_PCT, FMT_SEC, FMT_MIN, FMT_SIGNED, FMT_DB, FMT_X, FMT_INT, FMT_K, FMT_SEC2, FMT_PX, FMT_PCT_OFF };

struct OptDef {
  OptKind kind;
  int index;                 // into Settings::x (slider) or Settings::xi (combo)
  int section;               // into kOptSections
  const wchar_t* label;
  const char* key;           // settings-file key
  float lo, hi, def;         // sliders: range and default; combos: def = default item
  int fmt;
  const wchar_t* const* items;   // combos
  int nItems;
  const wchar_t* tip;        // mouse-over description: what changing it does to the picture
};

extern const OptDef kOpts[];
extern const int kOptCount;
extern const wchar_t* const kOptSections[];
extern const int kOptSectionCount;

void optDefaults(float* x, int* xi);
// False for the practical knobs a section's "Random" button leaves alone (frame rate, grip dot,
// the silence level: random values there would only get in the way).
bool optRandomizable(const OptDef& d);
