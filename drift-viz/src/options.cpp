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
#define SL(i, sec, label, key, lo, hi, def, fmt, tip) { OPT_SLIDER, i, sec, label, key, lo, hi, def, fmt, nullptr, 0, tip }
#define CB(i, sec, label, key, def, items, tip) { OPT_COMBO, i, sec, label, key, 0, 0, def, 0, items, int(sizeof items / sizeof items[0]), tip }
#define TGT L"   ↳ changes"
#define TGT_TIP                                                                                                        \
  L"Which part of the look the event above mutates: everything; only the motion (zoom, spin, swirl); the colours; the " \
  L"waveform shapes; which layers show; the math space (flames, lenses, tiling, attractors); the symmetry "            \
  L"(kaleidoscope, mirror, tiling); or a whole new species (a fresh look)."
#define STEER_TIP(what)                                                                                                \
  L"Whenever this part of the music is strong, " what L" drifts faster, so it changes more during those moments. "     \
  L"\"Nothing\" keeps a steady pace. How much it speeds up is set by Steering strength."
}  // namespace

const wchar_t* const kOptSections[] = { L"Audio analysis", L"Mutate on audio events", L"Audio steers the drift",
                                        L"Evolution engine", L"Layer strengths", L"Math space", L"Fine look" };
const int kOptSectionCount = int(sizeof kOptSections / sizeof kOptSections[0]);

const OptDef kOpts[] = {
  SL(XF_BEAT_SENS, 0, L"Beat sensitivity", "x.beatSens", 0.25f, 2.f, 1.f, FMT_PCT,
     L"How easily a beat is detected. Higher: softer hits count too, so you get more beat kicks, flashes and nudges. "
     L"Lower: only strong beats register."),
  SL(XF_BEAT_GAP, 0, L"Beat min. gap", "x.beatGap", 0.08f, 0.6f, 0.18f, FMT_SEC2,
     L"Shortest time allowed between two beats. Raise it if flashes and kicks fire too rapidly on busy drums."),
  SL(XF_SECTION_DB, 0, L"Change threshold", "x.sectionDb", 2.f, 12.f, 5.f, FMT_DB,
     L"How big a shift in the overall sound counts as a new part of the song (the \"Music changes\" event). Lower: "
     L"those mutations happen more often."),
  SL(XF_SECTION_COOL, 0, L"Change cooldown", "x.sectionCool", 2.f, 30.f, 6.f, FMT_SEC,
     L"Minimum time between two detected song-part changes. Higher: fewer back-to-back \"Music changes\" mutations."),
  SL(XF_EVENT_SENS, 0, L"Event sensitivity", "x.eventSens", 0.25f, 2.5f, 1.f, FMT_PCT,
     L"How easily drops, build-ups, breakdowns, hi-hat runs, vocals and big hits are detected. Higher: more "
     L"music-triggered mutations."),
  SL(XF_SILENCE_DB, 0, L"Silence below", "x.silenceDb", -110.f, -40.f, -80.f, FMT_DB,
     L"Sound quieter than this counts as silence: the picture calms down and, after a while, a new species starts. "
     L"Raise it if quiet passages should count as silence."),
  SL(XF_NEWSONG, 0, L"New song after", "x.newSong", 1.f, 20.f, 4.f, FMT_SEC,
     L"How long a silence must last before a brand-new look (species) is born. Shorter: brief gaps also reset the look."),
  SL(XF_SPEC_FALL, 0, L"Spectrum fall-off", "x.specFall", 0.f, 1.f, 0.5f, FMT_PCT,
     L"How quickly the spectrum ring's bars drop after a sound. Higher: snappy, jumpy bars. Lower: smooth bars that "
     L"linger."),
  SL(XF_SPEC_RANGE, 0, L"Spectrum range", "x.specRange", 24.f, 80.f, 48.f, FMT_DB,
     L"Loudness range the spectrum ring shows. Wider: quiet sounds show up too, so the ring looks fuller and flatter. "
     L"Narrower: only loud parts stick out."),

  SL(XF_T_SECTION, 1, L"Music changes", "x.tSection", 0.f, 1.f, 1.f, FMT_PCT_OFF,
     L"When the song moves to a new part (verse, chorus...), mutate the look this strongly. Off: ignore it."),
  CB(XI_T_SECTION, 1, TGT, "x.tSectionTo", TGT_ALL, kTargets, TGT_TIP),
  SL(XF_T_DROP, 1, L"Bass drop", "x.tDrop", 0.f, 1.f, 0.7f, FMT_PCT_OFF,
     L"When the bass drops out and slams back in, mutate the look this strongly. Off: ignore it."),
  CB(XI_T_DROP, 1, TGT, "x.tDropTo", TGT_MOTION, kTargets, TGT_TIP),
  SL(XF_T_BUILD, 1, L"Build-up", "x.tBuild", 0.f, 1.f, 0.5f, FMT_PCT_OFF,
     L"When the music climbs for a few seconds (rising treble and volume), mutate the look this strongly. Off: ignore it."),
  CB(XI_T_BUILD, 1, TGT, "x.tBuildTo", TGT_SPACE, kTargets, TGT_TIP),
  SL(XF_T_BREAK, 1, L"Breakdown", "x.tBreak", 0.f, 1.f, 0.5f, FMT_PCT_OFF,
     L"When the music gets much quieter without stopping, mutate the look this strongly. Off: ignore it."),
  CB(XI_T_BREAK, 1, TGT, "x.tBreakTo", TGT_COLOUR, kTargets, TGT_TIP),
  SL(XF_T_BRIGHT, 1, L"Tone shift", "x.tBright", 0.f, 1.f, 0.4f, FMT_PCT_OFF,
     L"When the sound turns darker or brighter in tone, mutate the look this strongly. Off: ignore it."),
  CB(XI_T_BRIGHT, 1, TGT, "x.tBrightTo", TGT_COLOUR, kTargets, TGT_TIP),
  SL(XF_T_HATS, 1, L"Hi-hats pick up", "x.tHats", 0.f, 1.f, 0.35f, FMT_PCT_OFF,
     L"When the hi-hats suddenly get busier, mutate the look this strongly. Off: ignore it."),
  CB(XI_T_HATS, 1, TGT, "x.tHatsTo", TGT_SHAPE, kTargets, TGT_TIP),
  SL(XF_T_VOCAL, 1, L"Vocals / melody in", "x.tVocal", 0.f, 1.f, 0.4f, FMT_PCT_OFF,
     L"When a voice or lead melody comes in, mutate the look this strongly. Off: ignore it."),
  CB(XI_T_VOCAL, 1, TGT, "x.tVocalTo", TGT_LAYERS, kTargets, TGT_TIP),
  SL(XF_T_TEMPO, 1, L"Tempo change", "x.tTempo", 0.f, 1.f, 0.6f, FMT_PCT_OFF,
     L"When the song settles into a new tempo, mutate the look this strongly. Off: ignore it."),
  CB(XI_T_TEMPO, 1, TGT, "x.tTempoTo", TGT_ALL, kTargets, TGT_TIP),
  SL(XF_T_HIT, 1, L"Big hits", "x.tHit", 0.f, 1.f, 0.2f, FMT_PCT_OFF,
     L"When a beat lands much harder than the ones before, mutate the look this strongly. Off: ignore it."),
  CB(XI_T_HIT, 1, TGT, "x.tHitTo", TGT_SYMMETRY, kTargets, TGT_TIP),
  SL(XF_T_PHRASE, 1, L"Every phrase", "x.tPhrase", 0.f, 1.f, 0.f, FMT_PCT_OFF,
     L"Mutate the look at a steady rhythm, every phrase (length below), whatever the music does. Off by default."),
  CB(XI_T_PHRASE, 1, TGT, "x.tPhraseTo", TGT_ALL, kTargets, TGT_TIP),
  CB(XI_PHRASE_LEN, 1, L"Phrase length", "x.phraseLen", 2, kPhrases,
     L"How many beats make one phrase for \"Every phrase\". Shorter: more frequent regular changes."),
  SL(XF_T_COOLDOWN, 1, L"Event cooldown", "x.tCooldown", 1.f, 30.f, 5.f, FMT_SEC,
     L"Minimum time between two music-triggered mutations. Higher: calmer, fewer back-to-back changes. Lower: the look "
     L"reacts to nearly every event."),

  SL(XF_STEER, 2, L"Steering strength", "x.steer", 0.f, 1.f, 0.5f, FMT_PCT,
     L"How much the music speeds up the slow drift of the groups below. 0: the drift ignores the music."),
  CB(XI_ST_MOTION, 2, L"Motion follows", "x.stMotion", ST_BASS, kSteers, STEER_TIP(L"the motion (zoom, spin, swirl)")),
  CB(XI_ST_COLOUR, 2, L"Colour follows", "x.stColour", ST_BRIGHT, kSteers, STEER_TIP(L"the colour palette")),
  CB(XI_ST_SHAPE, 2, L"Shape follows", "x.stShape", ST_TREB, kSteers, STEER_TIP(L"the waveform shape")),
  CB(XI_ST_LAYERS, 2, L"Layers follow", "x.stLayers", ST_LEVEL, kSteers, STEER_TIP(L"the mix of layers")),
  CB(XI_ST_SPACE, 2, L"Math follows", "x.stSpace", ST_NOVELTY, kSteers,
     STEER_TIP(L"the math space (flames, lenses, tiling, attractors)")),
  CB(XI_ST_SYMMETRY, 2, L"Symmetry follows", "x.stSymmetry", ST_BEATS, kSteers,
     STEER_TIP(L"the symmetry (kaleidoscope, mirror, tiling)")),

  SL(XF_DAMPING, 3, L"Drift damping", "x.damping", 0.1f, 3.f, 0.7f, FMT_X,
     L"Low: the slow drift glides in long, sweeping moves in one direction. High: it wanders in short, hesitant steps "
     L"and stays closer to where it is."),
  SL(XF_NUDGE_CHANCE, 3, L"Beat nudge chance", "x.nudgeChance", 0.f, 0.5f, 0.05f, FMT_PCT,
     L"Chance that a beat gives one random setting a small push. Higher: more little changes in time with the music."),
  SL(XF_NUDGE_SIZE, 3, L"Beat nudge size", "x.nudgeSize", 0.f, 1.f, 0.25f, FMT_PCT,
     L"How big those beat nudges are. Higher: each nudge visibly jolts the look."),
  SL(XF_GENES_PER_SCENE, 3, L"Genes per scene", "x.genesPerScene", 1.f, 30.f, 6.f, FMT_INT,
     L"How many continuous settings (zoom, colours, warp amounts...) change in one mutation. Higher: each mutation "
     L"changes more at once."),
  SL(XF_CHOICES_PER_SCENE, 3, L"Switches per scene", "x.choicesPerScene", 1.f, 8.f, 2.f, FMT_INT,
     L"How many either/or choices (waveform shape, kaleidoscope folds, lens type, tiling pattern...) can flip in one "
     L"mutation. Higher: bigger structural changes."),
  SL(XF_FADE, 3, L"Cross-fade speed", "x.fade", 0.2f, 4.f, 1.f, FMT_X,
     L"How quickly a flipped choice blends from the old option into the new one. Lower: slow morphs. Higher: "
     L"near-instant cuts."),
  SL(XF_EASE, 3, L"Ease speed", "x.ease", 0.2f, 4.f, 1.f, FMT_X,
     L"How quickly the picture glides to new values after a change. Lower: slow, smooth transitions. Higher: snappy."),
  SL(XF_BREED, 3, L"Breed chance", "x.breed", 0.f, 1.f, 0.5f, FMT_PCT,
     L"Chance that a new species is bred from looks you kept with ♥, instead of being totally random. Higher: new songs "
     L"look more like your favourites. Does nothing until you have kept some."),
  SL(XF_BREED_JITTER, 3, L"Breed mutation", "x.breedJitter", 0.f, 0.4f, 0.05f, FMT_PCT,
     L"How far a bred species strays from its parent favourites. 0: close copies. Higher: looser variations."),
  SL(XF_DRAIN, 3, L"Silence drain", "x.drain", 0.f, 1.f, 0.2f, FMT_PCT,
     L"How fast the picture simplifies back toward calm during silence. 0: it stays as busy as it was."),
  SL(XF_START_CX, 3, L"Lowest start", "x.startLow", 0.f, 0.8f, 0.05f, FMT_PCT,
     L"The least complex a new species may start. Higher: new songs never start bare; they begin with more layers in."),
  SL(XF_LATENT, 3, L"Latent mixing", "x.latent", 0.f, 1.f, 0.4f, FMT_PCT,
     L"Hidden factors that make unrelated settings move together. Higher: more coordinated, sweeping changes across "
     L"the whole look. 0: every setting drifts on its own."),
  SL(XF_LORENZ, 3, L"Lorenz chaos", "x.lorenz", 0.f, 1.f, 0.3f, FMT_PCT,
     L"A never-repeating chaotic signal that pushes the settings around. Higher: more restless, unpredictable wandering."),

  SL(XF_L_WAVE, 4, L"Waveform", "x.lWave", 0.f, 2.f, 1.f, FMT_PCT,
     L"Brightness of the audio waveform lines and shapes. 0: hide them."),
  SL(XF_L_SPEC, 4, L"Spectrum ring", "x.lSpec", 0.f, 2.f, 1.f, FMT_PCT,
     L"Strength of the ring of frequency bars around the centre (bass at the bottom, treble at the top). 0: hide it."),
  SL(XF_L_TUNNEL, 4, L"Tunnel rings", "x.lTunnel", 0.f, 2.f, 1.f, FMT_PCT,
     L"Strength of the concentric rings that give a flying-through-a-tunnel look. 0: hide them."),
  SL(XF_L_SPARKLE, 4, L"Sparkles", "x.lSparkle", 0.f, 2.f, 1.f, FMT_PCT,
     L"Amount of glittering sparkle points. 0: none."),
  SL(XF_L_ORBS, 4, L"Orbs", "x.lOrbs", 0.f, 2.f, 1.f, FMT_PCT,
     L"Strength of the glowing orbs that circle around. 0: hide them."),
  SL(XF_L_ATTR, 4, L"Strange attractor", "x.lAttr", 0.f, 2.f, 1.f, FMT_PCT,
     L"Brightness of the cloud of glowing points that traces a strange attractor (swirly, galaxy- or smoke-like "
     L"shapes). 0: hide it."),
  SL(XF_L_ECHO, 4, L"Echo", "x.lEcho", 0.f, 2.f, 1.f, FMT_PCT,
     L"Strength of a second, rotated, zoomed and sometimes flipped copy of the picture laid over it (a ghosted double "
     L"image). 0: no echo."),
  SL(XF_L_CHROMA, 4, L"Chromatic split", "x.lChroma", 0.f, 2.f, 1.f, FMT_PCT,
     L"Pulls red, green and blue apart into offset copies, kicked harder on beats: rainbow fringes and a glitchy look. "
     L"0: clean colours."),
  SL(XF_L_FLASH, 4, L"Beat flash", "x.lFlash", 0.f, 2.f, 1.f, FMT_PCT,
     L"How strongly the picture flashes brighter on beats. 0: no flashes."),
  SL(XF_L_KALEIDO, 4, L"Kaleidoscope", "x.lKaleido", 0.f, 1.f, 1.f, FMT_PCT,
     L"Strength of the kaleidoscope that folds the picture into 3 to 12 mirrored wedges around the centre. "
     L"0: never kaleidoscoped."),
  SL(XF_L_MIRROR, 4, L"Mirror folds", "x.lMirror", 0.f, 1.f, 1.f, FMT_PCT,
     L"Strength of the mirroring that reflects the picture left/right, top/bottom or into four quadrants. 0: never "
     L"mirrored."),

  SL(XF_M_GATE, 5, L"Math threshold", "x.mGate", 0.f, 0.9f, 0.35f, FMT_PCT,
     L"How busy the picture must get before the math effects (flame warps, lenses, tiling, attractors) appear. "
     L"Lower: they show up sooner and more often. Higher: mostly plain layers."),
  SL(XF_M_FLAME, 5, L"Flame warp", "x.mFlame", 0.f, 2.f, 1.f, FMT_PCT,
     L"Strength of the fractal-flame warp that bends trails into swirls, spirals, hearts and bubbles. 0: never."),
  SL(XF_M_VIEW, 5, L"Complex lens", "x.mView", 0.f, 1.5f, 1.f, FMT_PCT,
     L"Strength of the lens that bends the whole view (fish-eye, spiral, inversion, tunnel and similar warps). "
     L"0: never."),
  SL(XF_M_TILE, 5, L"Wallpaper tiling", "x.mTile", 0.f, 1.5f, 1.f, FMT_PCT,
     L"Strength of the effect that repeats the picture as tiles (square, hex, triangle, brick or pinwheel grids). "
     L"0: never tiled."),
  SL(XF_M_FLOW, 5, L"Curl-noise flow", "x.mFlow", 0.f, 2.f, 1.f, FMT_PCT,
     L"Strength of the smoke-like flow that makes trails curl and drift. 0: none."),
  SL(XF_M_SHAPES, 5, L"Math shapes", "x.mShapes", 0.f, 1.f, 1.f, FMT_PCT,
     L"How much the waveform may become star/flower shapes (superformula) or looping figures (Lissajous). 0: it uses "
     L"a plain circle instead."),
  SL(XF_ATTR_POINTS, 5, L"Attractor points", "x.attrPoints", 4.f, 120.f, 40.f, FMT_K,
     L"How many points (in thousands) make up the attractor cloud. More: denser, smoother shapes, but more GPU work."),
  SL(XF_ATTR_ITER, 5, L"Attractor iterations", "x.attrIter", 6.f, 48.f, 18.f, FMT_INT,
     L"How many steps each attractor point takes. More: points settle onto the true shape, with sharper detail. "
     L"Fewer: fuzzier."),
  SL(XF_ATTR_SIZE, 5, L"Attractor dot size", "x.attrSize", 0.5f, 3.f, 1.2f, FMT_PX,
     L"Size of each glowing attractor point. Bigger: softer, brighter cloud."),

  SL(XF_SATURATION, 6, L"Saturation", "x.saturation", 0.f, 2.f, 1.f, FMT_PCT,
     L"Colour intensity. 0: black and white. Higher: more vivid."),
  SL(XF_EXPO_TARGET, 6, L"Exposure target", "x.expoTarget", 0.1f, 0.6f, 0.28f, FMT_PCT,
     L"How bright the automatic exposure aims for on average. Higher: brighter overall picture."),
  SL(XF_EXPO_AUTO, 6, L"Auto exposure", "x.expoAuto", 0.f, 1.f, 1.f, FMT_PCT,
     L"How strongly the picture dims itself (shorter trails, lower brightness) when it gets too bright. 0: let it wash "
     L"out to white."),
  SL(XF_VIGNETTE, 6, L"Vignette", "x.vignette", 0.f, 1.f, 0.35f, FMT_PCT,
     L"Darkening toward the edges of the picture. 0: even brightness to the corners."),
  SL(XF_PAL_SPEED, 6, L"Colour cycling", "x.palSpeed", 0.f, 3.f, 1.f, FMT_PCT,
     L"How fast colours move through the palette (the bands of colour flowing along the trails). 0: still bands."),
  SL(XF_HUE_SPEED, 6, L"Colour drift", "x.hueSpeed", 0.f, 3.f, 1.f, FMT_PCT,
     L"How fast the hue of the trails rotates as they fade. 0: trails keep their colour."),
  SL(XF_ZOOM_BIAS, 6, L"Zoom bias", "x.zoomBias", -1.f, 1.f, 0.f, FMT_SIGNED,
     L"Adds a constant zoom. +: the picture keeps flowing outward, as if flying forward. −: it keeps pulling inward."),
  SL(XF_ROT_BIAS, 6, L"Spin bias", "x.rotBias", -1.f, 1.f, 0.f, FMT_SIGNED,
     L"Adds a constant spin, one way for + and the other for −."),
  SL(XF_MOTION_SPEED, 6, L"Motion speed", "x.motionSpeed", 0.2f, 2.f, 1.f, FMT_PCT,
     L"Overall speed of all movement: zoom, spin, warps, flow and orbs."),
  SL(XF_WAVE_THICK, 6, L"Line thickness", "x.waveThick", 0.3f, 3.f, 1.f, FMT_X,
     L"Thickness of the waveform and shape lines."),
  SL(XF_GRIP_SIZE, 6, L"Grip dot size", "x.gripSize", 2.f, 12.f, 4.5f, FMT_PX,
     L"Size of the drag dot in the top-left corner of the undocked window."),
  CB(XI_FPS, 6, L"Frame rate", "x.fps", 0, kFps,
     L"Caps how many frames per second are drawn. Lower: less GPU work and power, slightly less smooth motion. The "
     L"speed of things doesn't change."),
};
const int kOptCount = int(sizeof kOpts / sizeof kOpts[0]);

void optDefaults(float* x, int* xi) {
  for (int i = 0; i < kOptCount; i++) {
    const OptDef& d = kOpts[i];
    if (d.kind == OPT_SLIDER) x[d.index] = d.def;
    else xi[d.index] = int(d.def);
  }
}
