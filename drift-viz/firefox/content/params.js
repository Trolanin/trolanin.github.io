// Slots in the 160-float parameter block shared by every shader pass (same layout as src/params.h).
// Slot s lives in P[s / 4], component s % 4.
"use strict";
const PARAMS = {
  S_RES_X: 0, S_RES_Y: 1, S_ASPECT: 2, S_TIME: 3,
  S_ZOOM: 4, S_ROT: 5, S_SWIRL: 6, S_WARP: 7, S_WARP_FREQ: 8, S_WARP_PHASE: 9, S_DRIFT_X: 10, S_DRIFT_Y: 11,
  S_DECAY: 12, S_HUE: 13, S_MIRROR_X: 14, S_MIRROR_Y: 15,
  S_PAL_C: 16, S_PAL_PHASE: 19, S_PAL_D: 20, S_PAL_SPREAD: 23,
  S_SPEC_RING: 24, S_SPEC_RADIUS: 25, S_TUNNEL: 26, S_TUNNEL_SIDES: 27, S_SPARKLE: 28, S_ORBS: 29,
  S_BASS: 30, S_MID: 31, S_TREB: 32, S_LEVEL: 33, S_ADD: 34, S_ORB_PHASE: 35,
  S_W_CIRCLE: 36, S_W_LINE: 37, S_W_SCOPE: 38, S_W_SPIRAL: 39, S_W_ROSE: 40, S_WAVE_SCALE: 41, S_WAVE_GAIN: 42,
  S_WAVE_THICK: 43, S_WAVE_ANGLE: 44, S_WAVE_BRIGHT: 45, S_ROSE_K: 46, S_COPIES: 47, S_COPY_ALPHA: 48, V_COPY_ALPHA: 12,
  S_BLACK: 54, S_SAT: 55,
  S_KA: 56, S_KB: 57, S_KMIX: 58, S_KSPIN: 59, S_CHROMA: 60, S_ECHO: 61, S_ECHO_ZOOM: 62, S_ECHO_ANGLE: 63,
  S_ECHO_FLIP_X: 64, S_ECHO_FLIP_Y: 65, S_BRIGHT: 66, S_FLASH: 67, S_GRIP_X: 68, S_GRIP_Y: 69, S_GRIP_R: 70, S_GRIP_OP: 71,
  S_RINGS: 72, V_RINGS: 18,
  S_W_SUPER: 88, S_W_LISS: 89, S_SF_M: 90, S_SF_N1: 91, S_SF_N2: 92, S_SF_N3: 93, S_LISS_A: 94, S_LISS_B: 95,
  S_VAR_IDX: 96, V_VAR_IDX: 24, S_VAR_W: 100, V_VAR_W: 25, S_FLAME: 104, S_AFF_ROT: 105, S_AFF_SCALE: 106,
  S_AFF_SHEAR: 107, S_AFF_X: 108, S_AFF_Y: 109, S_VAR_P1: 110, S_VAR_P2: 111,
  S_FLOW: 112, S_FLOW_SCALE: 113, S_FLOW_PHASE: 114, S_VIGNETTE: 115,
  S_VIEW_A: 116, S_VIEW_B: 117, S_VIEW_MIX: 118, S_VIEW_AMT: 119, S_VIEW_P1: 120, S_VIEW_P2: 121, S_VIEW_PHASE: 122,
  S_LISS_PHASE: 123, S_TILE_A: 124, S_TILE_B: 125, S_TILE_MIX: 126, S_TILE_AMT: 127, S_TILE_SCALE: 128,
  S_KAMT: 129, S_USER_SAT: 130, S_ATTR_ITER: 131,
  S_ATTR_A: 132, V_ATTR_K: 33, S_ATTR_FAM_A: 136, S_ATTR_FAM_B: 137, S_ATTR_MIX: 138, S_ATTR_BRIGHT: 139,
  S_ATTR_SCALE: 140, S_ATTR_SPIN: 141, S_ATTR_SIZE: 142, S_ATTR_SEED: 143,
  P_FLOATS: 160,
};
const P_FLOATS = PARAMS.P_FLOATS;

// The same values as GLSL #defines, for the shaders.
function paramDefines() {
  return Object.entries(PARAMS).map(([k, v]) => `#define ${k} ${v}`).join("\n");
}

/* ------------------------------ options ------------------------------ */
// The desktop app's "excessive options", at their defaults (src/options.cpp). Same order.
const XF_LIST = [
  ["BEAT_SENS", 1], ["BEAT_GAP", 0.18], ["SECTION_DB", 5], ["SECTION_COOL", 6], ["EVENT_SENS", 1], ["SILENCE_DB", -80],
  ["NEWSONG", 4], ["SPEC_FALL", 0.5], ["SPEC_RANGE", 48],
  ["T_SECTION", 1], ["T_DROP", 0.7], ["T_BUILD", 0.5], ["T_BREAK", 0.5], ["T_BRIGHT", 0.4], ["T_HATS", 0.35],
  ["T_VOCAL", 0.4], ["T_TEMPO", 0.6], ["T_HIT", 0.2], ["T_PHRASE", 0], ["T_COOLDOWN", 5],
  ["STEER", 0.5],
  ["DAMPING", 0.7], ["NUDGE_CHANCE", 0.05], ["NUDGE_SIZE", 0.25], ["GENES_PER_SCENE", 6], ["CHOICES_PER_SCENE", 2],
  ["FADE", 1], ["EASE", 1], ["BREED", 0.5], ["BREED_JITTER", 0.05], ["DRAIN", 0.2], ["START_CX", 0.05], ["LATENT", 0.4],
  ["LORENZ", 0.3],
  ["L_WAVE", 1], ["L_SPEC", 1], ["L_TUNNEL", 1], ["L_SPARKLE", 1], ["L_ORBS", 1], ["L_ATTR", 1], ["L_ECHO", 1],
  ["L_CHROMA", 1], ["L_FLASH", 1], ["L_KALEIDO", 1], ["L_MIRROR", 1],
  ["M_GATE", 0.35], ["M_FLAME", 1], ["M_VIEW", 1], ["M_TILE", 1], ["M_FLOW", 1], ["M_SHAPES", 1], ["ATTR_POINTS", 40],
  ["ATTR_ITER", 18], ["ATTR_SIZE", 1.2],
  ["SATURATION", 1], ["EXPO_TARGET", 0.28], ["EXPO_AUTO", 1], ["VIGNETTE", 0.35], ["PAL_SPEED", 1], ["HUE_SPEED", 1],
  ["ZOOM_BIAS", 0], ["ROT_BIAS", 0], ["MOTION_SPEED", 1], ["WAVE_THICK", 1], ["GRIP_SIZE", 4.5],
];
const XI_LIST = [
  ["T_SECTION", 0], ["T_DROP", 1], ["T_BUILD", 5], ["T_BREAK", 2], ["T_BRIGHT", 2], ["T_HATS", 3], ["T_VOCAL", 4],
  ["T_TEMPO", 0], ["T_HIT", 6], ["T_PHRASE", 0], ["PHRASE_LEN", 2],
  ["ST_MOTION", 2], ["ST_COLOUR", 5], ["ST_SHAPE", 4], ["ST_LAYERS", 1], ["ST_SPACE", 7], ["ST_SYMMETRY", 6],
  ["FPS", 0],
];
const XF = {}, XI = {};
XF_LIST.forEach(([k], i) => (XF[k] = i));
XI_LIST.forEach(([k], i) => (XI[k] = i));
const TGT_ALL = 0, TGT_SPECIES = 7, ST_OFF = 0;
const PHRASE_BEATS = [8, 16, 32, 64];

// Everything the popup can change, plus the options at their defaults.
function defaultSettings() {
  return {
    x: XF_LIST.map(([, d]) => d),
    xi: XI_LIST.map(([, d]) => d),
    reactivity: 1, evoSpeed: 1, mutation: 0.5, sceneLen: 30, buildMin: 3, complexityCap: 1,
    freeze: false, trails: 0, brightness: 1,
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
