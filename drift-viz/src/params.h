// Slots in the float4 P[40] constant buffer shared by every shader pass.
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
// math wave shapes
#define S_W_SUPER 88
#define S_W_LISS 89
#define S_SF_M 90
#define S_SF_N1 91
#define S_SF_N2 92
#define S_SF_N3 93
#define S_LISS_A 94
#define S_LISS_B 95
// flame warp (feedback): four (variation, weight) pairs, then the affine map and variation parameters
#define S_VAR_IDX 96
#define V_VAR_IDX 24
#define S_VAR_W 100
#define V_VAR_W 25
#define S_FLAME 104
#define S_AFF_ROT 105
#define S_AFF_SCALE 106
#define S_AFF_SHEAR 107
#define S_AFF_X 108
#define S_AFF_Y 109
#define S_VAR_P1 110
#define S_VAR_P2 111
// curl-noise flow (feedback) and vignette
#define S_FLOW 112
#define S_FLOW_SCALE 113
#define S_FLOW_PHASE 114
#define S_VIGNETTE 115
// complex lens and wallpaper tiling (composite): two options each, cross-faded
#define S_VIEW_A 116
#define S_VIEW_B 117
#define S_VIEW_MIX 118
#define S_VIEW_AMT 119
#define S_VIEW_P1 120
#define S_VIEW_P2 121
#define S_VIEW_PHASE 122
#define S_LISS_PHASE 123
#define S_TILE_A 124
#define S_TILE_B 125
#define S_TILE_MIX 126
#define S_TILE_AMT 127
#define S_TILE_SCALE 128
#define S_KAMT 129
#define S_USER_SAT 130
#define S_ATTR_ITER 131
// strange attractor point pass: a, b, c, d in one float4
#define S_ATTR_A 132
#define V_ATTR_K 33
#define S_ATTR_FAM_A 136
#define S_ATTR_FAM_B 137
#define S_ATTR_MIX 138
#define S_ATTR_BRIGHT 139
#define S_ATTR_SCALE 140
#define S_ATTR_SPIN 141
#define S_ATTR_SIZE 142
#define S_ATTR_SEED 143
#define P_FLOATS 160
