// Slots in the float4 P[32] constant buffer shared by every shader pass.
// Slot s lives in P[s / 4], component s % 4. Included by both the HLSL and the C++ side.
#define S_RES_X 0
#define S_RES_Y 1
#define S_ASPECT 2
#define S_TIME 3
// feedback warp (already scaled to this frame's length)
#define S_ZOOM 4
#define S_ROT 5
#define S_SWIRL 6
#define S_WARP 7
#define S_WARP_FREQ 8
#define S_WARP_PHASE 9
#define S_DRIFT_X 10
#define S_DRIFT_Y 11
#define S_DECAY 12
#define S_HUE 13
#define S_MIRROR_X 14
#define S_MIRROR_Y 15
// colour palette: 0.5 + 0.5 * cos(2pi * (C * t + D))
#define S_PAL_C 16
#define S_PAL_PHASE 19
#define S_PAL_D 20
#define S_PAL_SPREAD 23
// extra layers drawn into the feedback
#define S_SPEC_RING 24
#define S_SPEC_RADIUS 25
#define S_TUNNEL 26
#define S_TUNNEL_SIDES 27
#define S_SPARKLE 28
#define S_ORBS 29
#define S_BASS 30
#define S_MID 31
#define S_TREB 32
#define S_LEVEL 33
#define S_ADD 34
#define S_ORB_PHASE 35
// waveform shape weights and look
#define S_W_CIRCLE 36
#define S_W_LINE 37
#define S_W_SCOPE 38
#define S_W_SPIRAL 39
#define S_W_ROSE 40
#define S_WAVE_SCALE 41
#define S_WAVE_GAIN 42
#define S_WAVE_THICK 43
#define S_WAVE_ANGLE 44
#define S_WAVE_BRIGHT 45
#define S_ROSE_K 46
#define S_COPIES 47
#define S_COPY_ALPHA 48
#define V_COPY_ALPHA 12
// exposure control (composite): black level pulled down, saturation pushed back up
#define S_BLACK 54
#define S_SAT 55
// final composite
#define S_KA 56
#define S_KB 57
#define S_KMIX 58
#define S_KSPIN 59
#define S_CHROMA 60
#define S_ECHO 61
#define S_ECHO_ZOOM 62
#define S_ECHO_ANGLE 63
#define S_ECHO_FLIP_X 64
#define S_ECHO_FLIP_Y 65
#define S_BRIGHT 66
#define S_FLASH 67
#define S_GRIP_X 68
#define S_GRIP_Y 69
#define S_GRIP_R 70
#define S_GRIP_OP 71
// tunnel rings: 8 x (radius, strength), two rings per float4
#define S_RINGS 72
#define V_RINGS 18
#define P_FLOATS 128
