#include "options.h"

const int kPhraseBeats[4] = { 8, 16, 32, 64 };
const int kFpsCaps[6] = { 0, 30, 60, 90, 120, 144 };

namespace {
const wchar_t* const kTargets[] = { L"everything", L"motion", L"colour", L"shape", L"layers", L"math space", L"symmetry",
                                    L"a new species" };
const wchar_t* const kSteers[] = { L"nothing (fixed)", L"loudness", L"bass", L"mids", L"treble", L"tone brightness",
                                   L"beat density", L"novelty" };
const wchar_t* const kPhrases[] = { L"8 beats", L"16 beats", L"32 beats", L"64 beats" };
const wchar_t* const kFps[] = { L"Monitor refresh", L"30 fps", L"60 fps", L"90 fps", L"120 fps", L"144 fps" };
#define SL(i, sec, label, key, lo, hi, def, fmt) { OPT_SLIDER, i, sec, label, key, lo, hi, def, fmt, nullptr, 0 }
#define CB(i, sec, label, key, def, items) { OPT_COMBO, i, sec, label, key, 0, 0, def, 0, items, int(sizeof items / sizeof items[0]) }
#define TGT L"   ↳ changes"
}  // namespace

const wchar_t* const kOptSections[] = { L"Audio analysis", L"Mutate on audio events", L"Audio steers the drift",
                                        L"Evolution engine", L"Layer strengths", L"Math space", L"Fine look" };
const int kOptSectionCount = int(sizeof kOptSections / sizeof kOptSections[0]);

const OptDef kOpts[] = {
  SL(XF_BEAT_SENS, 0, L"Beat sensitivity", "x.beatSens", 0.25f, 2.f, 1.f, FMT_PCT),
  SL(XF_BEAT_GAP, 0, L"Beat min. gap", "x.beatGap", 0.08f, 0.6f, 0.18f, FMT_SEC2),
  SL(XF_SECTION_DB, 0, L"Change threshold", "x.sectionDb", 2.f, 12.f, 5.f, FMT_DB),
  SL(XF_SECTION_COOL, 0, L"Change cooldown", "x.sectionCool", 2.f, 30.f, 6.f, FMT_SEC),
  SL(XF_EVENT_SENS, 0, L"Event sensitivity", "x.eventSens", 0.25f, 2.5f, 1.f, FMT_PCT),
  SL(XF_SILENCE_DB, 0, L"Silence below", "x.silenceDb", -110.f, -40.f, -80.f, FMT_DB),
  SL(XF_NEWSONG, 0, L"New song after", "x.newSong", 1.f, 20.f, 4.f, FMT_SEC),
  SL(XF_SPEC_FALL, 0, L"Spectrum fall-off", "x.specFall", 0.f, 1.f, 0.5f, FMT_PCT),
  SL(XF_SPEC_RANGE, 0, L"Spectrum range", "x.specRange", 24.f, 80.f, 48.f, FMT_DB),

  SL(XF_T_SECTION, 1, L"Music changes", "x.tSection", 0.f, 1.f, 1.f, FMT_PCT_OFF),
  CB(XI_T_SECTION, 1, TGT, "x.tSectionTo", TGT_ALL, kTargets),
  SL(XF_T_DROP, 1, L"Bass drop", "x.tDrop", 0.f, 1.f, 0.7f, FMT_PCT_OFF),
  CB(XI_T_DROP, 1, TGT, "x.tDropTo", TGT_MOTION, kTargets),
  SL(XF_T_BUILD, 1, L"Build-up", "x.tBuild", 0.f, 1.f, 0.5f, FMT_PCT_OFF),
  CB(XI_T_BUILD, 1, TGT, "x.tBuildTo", TGT_SPACE, kTargets),
  SL(XF_T_BREAK, 1, L"Breakdown", "x.tBreak", 0.f, 1.f, 0.5f, FMT_PCT_OFF),
  CB(XI_T_BREAK, 1, TGT, "x.tBreakTo", TGT_COLOUR, kTargets),
  SL(XF_T_BRIGHT, 1, L"Tone shift", "x.tBright", 0.f, 1.f, 0.4f, FMT_PCT_OFF),
  CB(XI_T_BRIGHT, 1, TGT, "x.tBrightTo", TGT_COLOUR, kTargets),
  SL(XF_T_HATS, 1, L"Hi-hats pick up", "x.tHats", 0.f, 1.f, 0.35f, FMT_PCT_OFF),
  CB(XI_T_HATS, 1, TGT, "x.tHatsTo", TGT_SHAPE, kTargets),
  SL(XF_T_VOCAL, 1, L"Vocals / melody in", "x.tVocal", 0.f, 1.f, 0.4f, FMT_PCT_OFF),
  CB(XI_T_VOCAL, 1, TGT, "x.tVocalTo", TGT_LAYERS, kTargets),
  SL(XF_T_TEMPO, 1, L"Tempo change", "x.tTempo", 0.f, 1.f, 0.6f, FMT_PCT_OFF),
  CB(XI_T_TEMPO, 1, TGT, "x.tTempoTo", TGT_ALL, kTargets),
  SL(XF_T_HIT, 1, L"Big hits", "x.tHit", 0.f, 1.f, 0.2f, FMT_PCT_OFF),
  CB(XI_T_HIT, 1, TGT, "x.tHitTo", TGT_SYMMETRY, kTargets),
  SL(XF_T_PHRASE, 1, L"Every phrase", "x.tPhrase", 0.f, 1.f, 0.f, FMT_PCT_OFF),
  CB(XI_T_PHRASE, 1, TGT, "x.tPhraseTo", TGT_ALL, kTargets),
  CB(XI_PHRASE_LEN, 1, L"Phrase length", "x.phraseLen", 2, kPhrases),
  SL(XF_T_COOLDOWN, 1, L"Event cooldown", "x.tCooldown", 1.f, 30.f, 5.f, FMT_SEC),

  SL(XF_STEER, 2, L"Steering strength", "x.steer", 0.f, 1.f, 0.5f, FMT_PCT),
  CB(XI_ST_MOTION, 2, L"Motion follows", "x.stMotion", ST_BASS, kSteers),
  CB(XI_ST_COLOUR, 2, L"Colour follows", "x.stColour", ST_BRIGHT, kSteers),
  CB(XI_ST_SHAPE, 2, L"Shape follows", "x.stShape", ST_TREB, kSteers),
  CB(XI_ST_LAYERS, 2, L"Layers follow", "x.stLayers", ST_LEVEL, kSteers),
  CB(XI_ST_SPACE, 2, L"Math follows", "x.stSpace", ST_NOVELTY, kSteers),
  CB(XI_ST_SYMMETRY, 2, L"Symmetry follows", "x.stSymmetry", ST_BEATS, kSteers),

  SL(XF_DAMPING, 3, L"Drift damping", "x.damping", 0.1f, 3.f, 0.7f, FMT_X),
  SL(XF_NUDGE_CHANCE, 3, L"Beat nudge chance", "x.nudgeChance", 0.f, 0.5f, 0.05f, FMT_PCT),
  SL(XF_NUDGE_SIZE, 3, L"Beat nudge size", "x.nudgeSize", 0.f, 1.f, 0.25f, FMT_PCT),
  SL(XF_GENES_PER_SCENE, 3, L"Genes per scene", "x.genesPerScene", 1.f, 30.f, 6.f, FMT_INT),
  SL(XF_CHOICES_PER_SCENE, 3, L"Switches per scene", "x.choicesPerScene", 1.f, 8.f, 2.f, FMT_INT),
  SL(XF_FADE, 3, L"Cross-fade speed", "x.fade", 0.2f, 4.f, 1.f, FMT_X),
  SL(XF_EASE, 3, L"Ease speed", "x.ease", 0.2f, 4.f, 1.f, FMT_X),
  SL(XF_BREED, 3, L"Breed chance", "x.breed", 0.f, 1.f, 0.5f, FMT_PCT),
  SL(XF_BREED_JITTER, 3, L"Breed mutation", "x.breedJitter", 0.f, 0.4f, 0.05f, FMT_PCT),
  SL(XF_DRAIN, 3, L"Silence drain", "x.drain", 0.f, 1.f, 0.2f, FMT_PCT),
  SL(XF_START_CX, 3, L"Lowest start", "x.startLow", 0.f, 0.8f, 0.05f, FMT_PCT),
  SL(XF_LATENT, 3, L"Latent mixing", "x.latent", 0.f, 1.f, 0.4f, FMT_PCT),
  SL(XF_LORENZ, 3, L"Lorenz chaos", "x.lorenz", 0.f, 1.f, 0.3f, FMT_PCT),

  SL(XF_L_WAVE, 4, L"Waveform", "x.lWave", 0.f, 2.f, 1.f, FMT_PCT),
  SL(XF_L_SPEC, 4, L"Spectrum ring", "x.lSpec", 0.f, 2.f, 1.f, FMT_PCT),
  SL(XF_L_TUNNEL, 4, L"Tunnel rings", "x.lTunnel", 0.f, 2.f, 1.f, FMT_PCT),
  SL(XF_L_SPARKLE, 4, L"Sparkles", "x.lSparkle", 0.f, 2.f, 1.f, FMT_PCT),
  SL(XF_L_ORBS, 4, L"Orbs", "x.lOrbs", 0.f, 2.f, 1.f, FMT_PCT),
  SL(XF_L_ATTR, 4, L"Strange attractor", "x.lAttr", 0.f, 2.f, 1.f, FMT_PCT),
  SL(XF_L_ECHO, 4, L"Echo", "x.lEcho", 0.f, 2.f, 1.f, FMT_PCT),
  SL(XF_L_CHROMA, 4, L"Chromatic split", "x.lChroma", 0.f, 2.f, 1.f, FMT_PCT),
  SL(XF_L_FLASH, 4, L"Beat flash", "x.lFlash", 0.f, 2.f, 1.f, FMT_PCT),
  SL(XF_L_KALEIDO, 4, L"Kaleidoscope", "x.lKaleido", 0.f, 1.f, 1.f, FMT_PCT),
  SL(XF_L_MIRROR, 4, L"Mirror folds", "x.lMirror", 0.f, 1.f, 1.f, FMT_PCT),

  SL(XF_M_GATE, 5, L"Math threshold", "x.mGate", 0.f, 0.9f, 0.35f, FMT_PCT),
  SL(XF_M_FLAME, 5, L"Flame warp", "x.mFlame", 0.f, 2.f, 1.f, FMT_PCT),
  SL(XF_M_VIEW, 5, L"Complex lens", "x.mView", 0.f, 1.5f, 1.f, FMT_PCT),
  SL(XF_M_TILE, 5, L"Wallpaper tiling", "x.mTile", 0.f, 1.5f, 1.f, FMT_PCT),
  SL(XF_M_FLOW, 5, L"Curl-noise flow", "x.mFlow", 0.f, 2.f, 1.f, FMT_PCT),
  SL(XF_M_SHAPES, 5, L"Math shapes", "x.mShapes", 0.f, 1.f, 1.f, FMT_PCT),
  SL(XF_ATTR_POINTS, 5, L"Attractor points", "x.attrPoints", 4.f, 120.f, 40.f, FMT_K),
  SL(XF_ATTR_ITER, 5, L"Attractor iterations", "x.attrIter", 6.f, 48.f, 18.f, FMT_INT),
  SL(XF_ATTR_SIZE, 5, L"Attractor dot size", "x.attrSize", 0.5f, 3.f, 1.2f, FMT_PX),

  SL(XF_SATURATION, 6, L"Saturation", "x.saturation", 0.f, 2.f, 1.f, FMT_PCT),
  SL(XF_EXPO_TARGET, 6, L"Exposure target", "x.expoTarget", 0.1f, 0.6f, 0.28f, FMT_PCT),
  SL(XF_EXPO_AUTO, 6, L"Auto exposure", "x.expoAuto", 0.f, 1.f, 1.f, FMT_PCT),
  SL(XF_VIGNETTE, 6, L"Vignette", "x.vignette", 0.f, 1.f, 0.35f, FMT_PCT),
  SL(XF_PAL_SPEED, 6, L"Colour cycling", "x.palSpeed", 0.f, 3.f, 1.f, FMT_PCT),
  SL(XF_HUE_SPEED, 6, L"Colour drift", "x.hueSpeed", 0.f, 3.f, 1.f, FMT_PCT),
  SL(XF_ZOOM_BIAS, 6, L"Zoom bias", "x.zoomBias", -1.f, 1.f, 0.f, FMT_SIGNED),
  SL(XF_ROT_BIAS, 6, L"Spin bias", "x.rotBias", -1.f, 1.f, 0.f, FMT_SIGNED),
  SL(XF_MOTION_SPEED, 6, L"Motion speed", "x.motionSpeed", 0.2f, 2.f, 1.f, FMT_PCT),
  SL(XF_WAVE_THICK, 6, L"Line thickness", "x.waveThick", 0.3f, 3.f, 1.f, FMT_X),
  SL(XF_GRIP_SIZE, 6, L"Grip dot size", "x.gripSize", 2.f, 12.f, 4.5f, FMT_PX),
  CB(XI_FPS, 6, L"Frame rate", "x.fps", 0, kFps),
};
const int kOptCount = int(sizeof kOpts / sizeof kOpts[0]);

void optDefaults(float* x, int* xi) {
  for (int i = 0; i < kOptCount; i++) {
    const OptDef& d = kOpts[i];
    if (d.kind == OPT_SLIDER) x[d.index] = d.def;
    else xi[d.index] = int(d.def);
  }
}
