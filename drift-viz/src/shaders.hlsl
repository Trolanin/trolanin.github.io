// Drift shaders. Three passes per frame:
//   1. PS_Warp:  previous frame -> new frame, zoomed/rotated/warped and faded, plus the
//                procedural layers (spectrum ring, tunnel rings, sparkles, orbs).
//   2. VS/PS_Wave: the waveform as thick additive lines, morphing between shapes.
//   3. PS_Comp:  new frame -> screen with kaleidoscope, echo, chromatic split, tone map.
#include "params.h"

cbuffer Params : register(b0) { float4 P[32]; };
#define PR(s) P[(s) / 4][(s) % 4]

Texture2D tex0 : register(t0);
Texture2D<float> audioTex : register(t1);
SamplerState sMirror : register(s0);
SamplerState sClamp : register(s1);

static const float TAU = 6.28318530718;
static const float PI = 3.14159265359;

struct VOut { float4 pos : SV_Position; float2 uv : TEXCOORD0; };

VOut VS_Full(uint id : SV_VertexID) {
  VOut o;
  float2 uv = float2((id << 1) & 2, id & 2);
  o.uv = uv;
  o.pos = float4(uv * float2(2, -2) + float2(-1, 1), 0, 1);
  return o;
}

// Row 0 of the audio texture is the waveform (512), row 1 the spectrum (first 128 texels).
float wave(float u) { return audioTex.SampleLevel(sClamp, float2((0.5 + saturate(u) * 511.0) / 512.0, 0.25), 0); }
float spec(float u) { return audioTex.SampleLevel(sClamp, float2((0.5 + saturate(u) * 127.0) / 512.0, 0.75), 0); }

float3 pal(float t) {
  float3 c = float3(PR(S_PAL_C), PR(S_PAL_C + 1), PR(S_PAL_C + 2));
  float3 d = float3(PR(S_PAL_D), PR(S_PAL_D + 1), PR(S_PAL_D + 2));
  return 0.5 + 0.5 * cos(TAU * (c * t + d));
}

float hash21(float2 p) {
  p = frac(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return frac(p.x * p.y);
}

float2 rot2(float2 v, float a) {
  float c = cos(a), s = sin(a);
  return float2(c * v.x - s * v.y, s * v.x + c * v.y);
}

float3 hueRot(float3 c, float a) {
  const float3 k = float3(0.57735, 0.57735, 0.57735);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1 - ca);
}

// "Radius" of p measured as a regular polygon (sides < 3 = circle).
float polyDist(float2 p, float sides) {
  float r = length(p);
  if (sides < 2.5) return r;
  float a = atan2(p.y, p.x);
  float k = TAU / sides;
  float aa = (frac(a / k + 0.5) - 0.5) * k;
  return r * cos(aa) / cos(PI / sides);
}

float3 layers(float2 p) {
  float3 c = 0;
  float r = length(p);
  float ang = atan2(p.y, p.x);

  float sr = PR(S_SPEC_RING);
  if (sr > 0.002) {
    // Bass at the bottom, treble at the top, mirrored left/right, turning with the waveform.
    float2 pr = rot2(p, -PR(S_WAVE_ANGLE) * 0.5);
    float u = abs(atan2(pr.x, pr.y)) / PI;
    const float bars = 40;
    float bu = u * bars;
    float bi = floor(bu);
    float h = spec((bi + 0.5) / bars);
    float r0 = PR(S_SPEC_RADIUS), r1 = r0 + 0.015 + h * 0.2;
    float fu = frac(bu), aw = fwidth(bu) + 1e-4, rw = fwidth(r) + 1e-4;
    float bar = smoothstep(0.0, aw, fu) * smoothstep(0.0, aw, 0.78 - fu);
    float m = smoothstep(r0 - rw, r0, r) * (1 - smoothstep(r1, r1 + rw, r)) * bar;
    c += pal(bi / bars * PR(S_PAL_SPREAD) + PR(S_PAL_PHASE)) * m * sr * (0.2 + h) * 0.35;
  }

  float tw = PR(S_TUNNEL);
  if (tw > 0.002) {
    float d = polyDist(p, PR(S_TUNNEL_SIDES));
    [unroll] for (int j = 0; j < 4; j++) {
      float4 R = P[V_RINGS + j];
      float e1 = (d - R.x) / 0.006, e2 = (d - R.z) / 0.006;
      c += pal(j * 0.27 + PR(S_PAL_PHASE) + 0.5) * exp(-e1 * e1) * R.y * tw;
      c += pal(j * 0.27 + 0.13 + PR(S_PAL_PHASE) + 0.5) * exp(-e2 * e2) * R.w * tw;
    }
  }

  float sw = PR(S_SPARKLE);
  if (sw > 0.002) {
    float2 gp = p * 28.0;
    float2 id = floor(gp);
    float h = hash21(id + floor(PR(S_TIME) * 10.0) * 17.31);
    float chance = 0.015 + 0.1 * saturate(PR(S_TREB) - 0.8);
    if (h < chance) {
      float2 o = float2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5;
      float2 f = frac(gp) - 0.5 - o * 0.6;
      c += pal(h * 37.0 + PR(S_PAL_PHASE)) * exp(-dot(f, f) * 120.0) * sw * 1.5;
    }
  }

  float ow = PR(S_ORBS);
  if (ow > 0.002) {
    float ph = PR(S_ORB_PHASE);
    float rad = 0.015 + 0.03 * saturate(PR(S_BASS) - 0.5);
    [unroll] for (int i = 0; i < 5; i++) {
      float fi = i;
      float2 o = float2(sin(ph * (0.7 + fi * 0.23) + fi * 1.9) * 0.36 * PR(S_ASPECT), cos(ph * (0.53 + fi * 0.17) + fi * 2.7) * 0.36);
      float2 dv = p - o;
      c += pal(fi * 0.21 + PR(S_PAL_PHASE)) * exp(-dot(dv, dv) / (rad * rad)) * ow * 0.6;
    }
  }
  return c * PR(S_ADD);
}

float4 PS_Warp(VOut i) : SV_Target {
  float aspect = PR(S_ASPECT);
  float2 p = (i.uv - 0.5) * float2(aspect, 1);
  float r = length(p);
  // Where did this pixel's content come from last frame?
  float ang = PR(S_ROT) + PR(S_SWIRL) * (0.5 - r);
  float2 q = rot2(p, -ang) / PR(S_ZOOM);
  float f = PR(S_WARP_FREQ), ph = PR(S_WARP_PHASE);
  q += PR(S_WARP) * float2(sin(q.y * f + ph), cos(q.x * f * 1.13 + ph * 0.87));
  q -= float2(PR(S_DRIFT_X), PR(S_DRIFT_Y));
  q.x = lerp(q.x, abs(q.x), PR(S_MIRROR_X));
  q.y = lerp(q.y, abs(q.y), PR(S_MIRROR_Y));
  float3 c = tex0.SampleLevel(sMirror, q / float2(aspect, 1) + 0.5, 0).rgb;
  c = max(hueRot(c, PR(S_HUE)) * PR(S_DECAY) - 0.002 * PR(S_ADD), 0);
  // Soft ceiling so long trails cannot pile up into a white-out.
  float m = max(c.r, max(c.g, c.b));
  if (m > 1.5) c *= (1.5 + (m - 1.5) * 0.5) / m;
  c += layers(p);
  return float4(c, 1);
}

float4 PS_Copy(VOut i) : SV_Target { return tex0.SampleLevel(sClamp, i.uv, 0); }

/* ------------------------------ waveform lines ------------------------------ */
struct WOut { float4 pos : SV_Position; float2 t : TEXCOORD0; float3 col : COLOR0; };

float2 shapePos(float u) {
  float S = PR(S_WAVE_SCALE), G = PR(S_WAVE_GAIN);
  float w = wave(u), ws = wave(1 - abs(2 * u - 1));
  float a = TAU * u;
  float2 pos = 0;
  pos += PR(S_W_CIRCLE) * (S * (1 + G * ws)) * float2(cos(a), sin(a));
  pos += PR(S_W_LINE) * float2((u - 0.5) * PR(S_ASPECT) * 0.9, G * 0.5 * w);
  pos += PR(S_W_SCOPE) * float2(wave(u * 0.95), wave(u * 0.95 + 0.05)) * S * (0.6 + G * 2.0);
  float sa = TAU * u * 3.0;
  pos += PR(S_W_SPIRAL) * (S * 1.5 * u * (1 + G * 0.7 * w)) * float2(cos(sa), sin(sa));
  pos += PR(S_W_ROSE) * (S * (0.55 + 0.45 * cos(PR(S_ROSE_K) * a)) * (1 + G * ws)) * float2(cos(a), sin(a));
  return pos;
}

WOut VS_Wave(uint vid : SV_VertexID, uint inst : SV_InstanceID) {
  const float SEGS = 255.0;
  uint seg = vid / 6, corner = vid % 6;
  float along = (corner == 1 || corner == 4 || corner == 5) ? 1.0 : 0.0;
  float side = (corner == 2 || corner == 3 || corner == 5) ? 1.0 : -1.0;
  float u0 = seg / SEGS, u1 = (seg + 1) / SEGS;
  float copyAng = PR(S_WAVE_ANGLE) + TAU * (float)inst / max(PR(S_COPIES), 1.0);
  float2 a = rot2(shapePos(u0), copyAng), b = rot2(shapePos(u1), copyAng);
  float2 d = b - a;
  float len = length(d);
  float2 dir = len > 1e-6 ? d / len : float2(1, 0);
  float2 n = float2(-dir.y, dir.x);
  float th = PR(S_WAVE_THICK);
  float2 pp = lerp(a, b, along) + n * side * th + dir * (along * 2 - 1) * th * 0.5;
  float alpha = dot(P[V_COPY_ALPHA], float4(inst == 0, inst == 1, inst == 2, inst == 3)) +
                dot(P[V_COPY_ALPHA + 1].xy, float2(inst == 4, inst == 5));
  WOut o;
  o.pos = float4(pp.x * 2 / PR(S_ASPECT), -pp.y * 2, 0, 1);
  o.t = float2(along, side);
  o.col = pal(lerp(u0, u1, along) * PR(S_PAL_SPREAD) + PR(S_PAL_PHASE) + inst * 0.17) * alpha * PR(S_WAVE_BRIGHT) * PR(S_ADD);
  return o;
}

float4 PS_Wave(WOut i) : SV_Target {
  float v = i.t.y;
  return float4(i.col * exp(-v * v * 3.0), 0);
}

/* ------------------------------ composite ------------------------------ */
float3 sampleChroma(float2 p) {
  float2 uv = p / float2(PR(S_ASPECT), 1) + 0.5;
  float2 dir = p * PR(S_CHROMA);
  float3 c;
  c.r = tex0.SampleLevel(sMirror, uv + dir, 0).r;
  c.g = tex0.SampleLevel(sMirror, uv, 0).g;
  c.b = tex0.SampleLevel(sMirror, uv - dir, 0).b;
  return c;
}

float2 kaleido(float2 p, float n) {
  if (n < 1.5) return p;
  float r = length(p);
  float a = atan2(p.y, p.x) + PR(S_KSPIN);
  float seg = TAU / n;
  a = abs(frac(a / seg) * seg - seg * 0.5);
  return r * float2(cos(a), sin(a));
}

float3 viewAt(float2 p, float n) {
  float2 k = kaleido(p, n);
  float3 c = sampleChroma(k);
  float e = PR(S_ECHO);
  if (e > 0.002) {
    float2 q = rot2(k, PR(S_ECHO_ANGLE)) / PR(S_ECHO_ZOOM);
    q.x = lerp(q.x, -q.x, PR(S_ECHO_FLIP_X));
    q.y = lerp(q.y, -q.y, PR(S_ECHO_FLIP_Y));
    c += sampleChroma(q) * e;
  }
  return c;
}

float4 PS_Comp(VOut i) : SV_Target {
  float2 p = (i.uv - 0.5) * float2(PR(S_ASPECT), 1);
  float3 c = viewAt(p, PR(S_KA));
  float km = PR(S_KMIX);
  if (km > 0.001) c = lerp(c, viewAt(p, PR(S_KB)), km);
  c = max(c - PR(S_BLACK), 0);
  c = 1 - exp(-c * PR(S_BRIGHT));
  float luma = dot(c, float3(0.2126, 0.7152, 0.0722));
  c = max(lerp(luma, c, 1 + PR(S_SAT)), 0);
  c += PR(S_FLASH);
  c *= 1 - 0.35 * dot(p, p);
  float gr = PR(S_GRIP_R);
  if (gr > 0) {
    float d = length(i.uv * float2(PR(S_RES_X), PR(S_RES_Y)) - float2(PR(S_GRIP_X), PR(S_GRIP_Y)));
    c = lerp(c, 1, (1 - smoothstep(gr - 1.0, gr + 1.0, d)) * PR(S_GRIP_OP));
  }
  return float4(saturate(c), 1);
}
