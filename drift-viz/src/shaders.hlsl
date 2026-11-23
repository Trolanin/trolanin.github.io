// Drift shaders. Four passes per frame:
//   1. PS_Warp:  previous frame -> new frame, zoomed/rotated/warped (sine warp, flame variations,
//                curl-noise flow) and faded, plus the procedural layers (spectrum ring, tunnel rings,
//                sparkles, orbs).
//   2. VS/PS_Wave: the waveform as thick additive lines, morphing between shapes.
//   3. VS/PS_Attr: a strange attractor as thousands of additive points.
//   4. PS_Comp:  new frame -> screen through a complex lens, wallpaper tiling, kaleidoscope, echo,
//                chromatic split, tone map.
#include "params.h"

cbuffer Params : register(b0) { float4 P[40]; };
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

uint hashU(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
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

// Complex numbers as float2.
float2 cmul(float2 a, float2 b) { return float2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
float2 cdiv(float2 a, float2 b) { return cmul(a, float2(b.x, -b.y)) / max(dot(b, b), 1e-6); }
float2 csin(float2 z) { return float2(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y)); }

// Shrinks long vectors smoothly so a map with a pole can't throw samples to infinity.
float2 softLim(float2 v, float m) {
  float l = length(v);
  return l > 1e-6 ? v * (m * tanh(l / m) / l) : v;
}

// Folds the plane into one mirrored wedge of an n-fold kaleidoscope.
float2 foldN(float2 p, float n, float spin) {
  float r = length(p);
  float a = atan2(p.y, p.x) + spin;
  float seg = TAU / n;
  a = abs(frac(a / seg) * seg - seg * 0.5);
  return r * float2(cos(a), sin(a));
}

// Offset of p from the centre of its hexagonal cell (cells about 1 unit across).
float2 hexCell(float2 p) {
  const float2 s = float2(1, 1.7320508);
  float4 c = floor(float4(p, p - float2(0.5, 0.8660254)) / s.xyxy) + 0.5;
  float2 a = p - c.xy * s, b = p - (c.zw + 0.5) * s;
  return dot(a, a) < dot(b, b) ? a : b;
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

/* ------------------------------ flame variations ------------------------------ */
// Nonlinear maps of the plane in the spirit of fractal-flame variations. p1 and p2 (0..1) shape
// the parametric ones.
float2 variation(int i, float2 z) {
  float r2 = dot(z, z) + 1e-6, r = sqrt(r2), ph = atan2(z.y, z.x);
  float p1 = PR(S_VAR_P1), p2 = PR(S_VAR_P2);
  [branch] switch (i) {
    case 1: return sin(z);
    case 2: return z / r2;
    case 3: { float s = sin(r2), c = cos(r2); return float2(z.x * s - z.y * c, z.x * c + z.y * s); }
    case 4: return float2((z.x - z.y) * (z.x + z.y), 2 * z.x * z.y) / r;
    case 5: return float2(ph / PI, r - 1);
    case 6: return r * float2(sin(ph + r), cos(ph - r));
    case 7: return r * float2(sin(ph * r), -cos(ph * r));
    case 8: return ph / PI * float2(sin(PI * r), cos(PI * r));
    case 9: return float2(cos(ph) + sin(r), sin(ph) - cos(r)) / r;
    case 10: return float2(sin(ph) / r, r * cos(ph));
    case 11: return float2(sin(ph) * cos(r), cos(ph) * sin(r));
    case 12: return 2 / (r + 1) * z.yx;
    case 13: return 4 / (r2 + 4) * z;
    case 14: { float amp = 0.1 + 0.5 * p1, fr = 1.5 + 6 * p2; return z + amp * sin(z.yx * fr); }
    case 15: { float n = 1.5 + 2 * p1; return pow(r, n) * float2(cos(n * ph), sin(n * ph)); }
    case 16: return exp(z.x - 1) * float2(cos(PI * z.y), sin(PI * z.y));
    case 17: return csin(z);
    case 18: { float2 a = 0.75 * p1 * float2(cos(TAU * p2), sin(TAU * p2)); return cdiv(z - a, float2(1, 0) - cmul(float2(a.x, -a.y), z)); }
    case 19: return z + (0.15 + 0.35 * p1) * float2(z.x, -z.y) / r2;
    case 20: return float2(log(r) * 0.5, ph / PI);
    case 21: return float2(sin(z.x) / cos(z.y), tan(z.y));
    case 22: return z / max(abs(z.x * z.x - z.y * z.y), 0.05);
    case 23: { float4 k = float4(1 + 3 * p1, 1 + 3 * p2, 2 - p1, 2 - p2) * 1.3; return float2(sin(k.x * z.y) - cos(k.y * z.x), sin(k.z * z.x) - cos(k.w * z.y)); }
    default: return z;
  }
}

// A divergence-free flow: the rotated gradient of a sum of moving sine waves.
float2 curlFlow(float2 p, float t) {
  float a = p.x + t, b = 1.3 * p.y - 0.7 * t, c = 1.7 * (p.x + p.y) + 1.3 * t, d = 2.3 * p.x - 1.9 * p.y - 0.6 * t;
  float dx = cos(a) * cos(b) + 0.85 * cos(c) - 0.805 * sin(d);
  float dy = -1.3 * sin(a) * sin(b) + 0.85 * cos(c) + 0.665 * sin(d);
  return float2(dy, -dx);
}

/* ------------------------------ complex lenses ------------------------------ */
float2 lens(int i, float2 p) {
  float p1 = PR(S_VIEW_P1), p2 = PR(S_VIEW_P2), ph = PR(S_VIEW_PHASE);
  float r = length(p) + 1e-5, a = atan2(p.y, p.x);
  [branch] switch (i) {
    case 1: { float n = floor(2 + 2.99 * p1); float rr = 0.5 * pow(2 * r, 0.5 + 0.5 * n); return rr * float2(cos(n * a + ph), sin(n * a + ph)); }
    case 2: { float R = 0.2 + 0.25 * p1; return rot2(p * (R * R) / (r * r + 0.002), ph); }
    case 3: { float2 z = 2 * p, c = 0.75 * p2 * float2(cos(ph), sin(ph)); return 0.5 * cdiv(z - c, float2(1, 0) - cmul(float2(c.x, -c.y), z)); }
    case 4: {
      float s = 2 + 3 * p1, t = log(r / 0.25) / log(s) + ph * 0.3;
      t = abs(frac(t * 0.5) * 2 - 1);
      float a2 = a + p2 * t * 1.5;
      return 0.25 * pow(s, t) * float2(cos(a2), sin(a2));
    }
    case 5: return float2((abs(a) / PI - 0.5) * PR(S_ASPECT), (0.04 + 0.08 * p1) / r + ph);
    case 6: { float k = 1 + 4 * p1; return p / r * 0.5 * tanh(r * k) / tanh(0.5 * k); }
    case 7: return rot2(p, (1 + 3 * p1) * sin(r * (6 + 10 * p2) - ph * 3));
    case 8: return p * (1 + (p1 - 0.4) * 4 * r * r);
    case 9: { float k = 2 + 3 * p1; return csin(rot2(p, ph) * k) / k; }
    case 10: { float2 z = rot2(2 * p, ph); return 0.25 * (z + (0.25 + 0.5 * p2) * float2(z.x, -z.y) / max(dot(z, z), 1e-3)); }
    case 11: return float2((abs(a) / PI - 0.5) * PR(S_ASPECT), (r - 0.3) * 1.5);
    default: return p;
  }
}

/* ------------------------------ wallpaper tiling ------------------------------ */
// Maps the plane into a repeating cell; every cell shows the middle of the picture.
float2 tileMap(int i, float2 p) {
  float2 c = p * PR(S_TILE_SCALE);
  [branch] switch (i) {
    case 1: { float2 f = abs(frac(c + 0.5) - 0.5); return f.y > f.x ? f.yx : f; }          // p4m
    case 2: return foldN(hexCell(c), 6, 0);                                                 // p6m
    case 3: return foldN(hexCell(c), 3, 0);                                                 // p3m1
    case 4: { c.x += 0.5 * floor(c.y); return frac(c) - 0.5; }                              // bricks
    case 5: {                                                                               // p4
      float2 id = floor(c), f = frac(c) - 0.5;
      float k = fmod(fmod(id.x + 2 * id.y, 4) + 4, 4);
      return rot2(f, k * PI * 0.5);
    }
    default: return p;
  }
}

/* ------------------------------ feedback pass ------------------------------ */
float3 layers(float2 p) {
  float3 c = 0;
  float r = length(p);

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
  // Flame warp: pull each sample a little toward where an affine map plus blended variations sends it.
  float fa = PR(S_FLAME);
  if (fa > 1e-5) {
    float2 z = rot2(q * 2, PR(S_AFF_ROT)) * PR(S_AFF_SCALE);
    z.x += PR(S_AFF_SHEAR) * z.y;
    z += float2(PR(S_AFF_X), PR(S_AFF_Y));
    float4 vi = P[V_VAR_IDX], vw = P[V_VAR_W];
    float2 v = vw.x * variation((int)vi.x, z);
    if (vw.y > 1e-3) v += vw.y * variation((int)vi.y, z);
    if (vw.z > 1e-3) v += vw.z * variation((int)vi.z, z);
    if (vw.w > 1e-3) v += vw.w * variation((int)vi.w, z);
    q = lerp(q, softLim(v, 2.5) * 0.5, fa);
  }
  float fl = PR(S_FLOW);
  if (fl > 1e-7) q += fl * curlFlow(q * PR(S_FLOW_SCALE), PR(S_FLOW_PHASE));
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
  float2 cs = float2(cos(a), sin(a));
  float2 pos = 0;
  pos += PR(S_W_CIRCLE) * (S * (1 + G * ws)) * cs;
  pos += PR(S_W_LINE) * float2((u - 0.5) * PR(S_ASPECT) * 0.9, G * 0.5 * w);
  pos += PR(S_W_SCOPE) * float2(wave(u * 0.95), wave(u * 0.95 + 0.05)) * S * (0.6 + G * 2.0);
  float sa = TAU * u * 3.0;
  pos += PR(S_W_SPIRAL) * (S * 1.5 * u * (1 + G * 0.7 * w)) * float2(cos(sa), sin(sa));
  pos += PR(S_W_ROSE) * (S * (0.55 + 0.45 * cos(PR(S_ROSE_K) * a)) * (1 + G * ws)) * cs;
  float wsf = PR(S_W_SUPER);
  if (wsf > 1e-3) {
    // Superformula: r = (|cos(m a / 4)|^n2 + |sin(m a / 4)|^n3)^(-1 / n1)
    float t = PR(S_SF_M) * a * 0.25;
    float rr = pow(pow(abs(cos(t)), PR(S_SF_N2)) + pow(abs(sin(t)), PR(S_SF_N3)) + 1e-4, -1 / PR(S_SF_N1));
    pos += wsf * S * 0.9 * min(rr, 1.8) * (1 + G * ws) * cs;
  }
  float wl = PR(S_W_LISS);
  if (wl > 1e-3) pos += wl * S * 1.25 * (1 + G * 0.6 * ws) * float2(sin(PR(S_LISS_A) * a + PR(S_LISS_PHASE)), sin(PR(S_LISS_B) * a));
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

/* ------------------------------ strange attractor ------------------------------ */
// Four families of 2-D maps whose orbits settle onto fractal attractors; k = (a, b, c, d).
float2 attrFamily(float f, float2 p, float4 k) {
  if (f < 0.5) return float2(sin(k.x * p.y) + k.z * cos(k.x * p.x), sin(k.y * p.x) + k.w * cos(k.y * p.y));   // Clifford
  if (f < 1.5) return float2(sin(k.x * p.y) - cos(k.y * p.x), sin(k.z * p.x) - cos(k.w * p.y));               // de Jong
  if (f < 2.5) return float2(k.w * sin(k.x * p.x) - sin(k.y * p.y), k.z * cos(k.x * p.x) + cos(k.y * p.y));   // Svensson
  return float2(sin(k.y * p.y) + k.z * sin(k.y * p.x), sin(k.x * p.x) + k.w * sin(k.x * p.y));               // dream
}

WOut VS_Attr(uint vid : SV_VertexID) {
  uint pid = vid / 6, corner = vid % 6;
  // A fresh random start every frame; after a few iterations it lies on the attractor.
  uint h = hashU(pid * 2654435761u ^ hashU(asuint(PR(S_ATTR_SEED)) + 0x9e3779b9u));
  float2 x = float2(h & 0xffffu, h >> 16) / 65535.0 * 4 - 2;
  float4 k = P[V_ATTR_K];
  float fa = PR(S_ATTR_FAM_A), fb = PR(S_ATTR_FAM_B), m = PR(S_ATTR_MIX);
  int n = (int)PR(S_ATTR_ITER);
  float2 prev = x;
  [loop] for (int it = 0; it < 64; it++) {
    if (it >= n) break;
    prev = x;
    float2 xa = attrFamily(fa, x, k);
    x = m > 1e-3 ? lerp(xa, attrFamily(fb, x, k), m) : xa;
  }
  float2 c = rot2(x * PR(S_ATTR_SCALE), PR(S_ATTR_SPIN));
  float2 off = float2((corner == 1 || corner == 4 || corner == 5) ? 1 : -1, (corner == 2 || corner == 3 || corner == 5) ? 1 : -1);
  float sz = PR(S_ATTR_SIZE);
  WOut o;
  o.pos = float4(c.x * 2 / PR(S_ASPECT) + off.x * sz * 2 / PR(S_RES_X), -c.y * 2 + off.y * sz * 2 / PR(S_RES_Y), 0, 1);
  o.t = off;
  o.col = pal(length(x - prev) * 0.35 + PR(S_PAL_PHASE) + 0.3) * PR(S_ATTR_BRIGHT);
  return o;
}

float4 PS_Attr(WOut i) : SV_Target { return float4(i.col * exp(-dot(i.t, i.t) * 2.5), 0); }

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
  return lerp(p, foldN(p, n, PR(S_KSPIN)), PR(S_KAMT));
}

// Lens, then tiling; each is the blend of its two strongest options, faded in by its amount.
float2 spaceMap(float2 p) {
  float la = PR(S_VIEW_AMT);
  if (la > 1e-3) {
    float2 q = lens((int)PR(S_VIEW_A), p);
    float m = PR(S_VIEW_MIX);
    if (m > 1e-3) q = lerp(q, lens((int)PR(S_VIEW_B), p), m);
    p = lerp(p, q, la);
  }
  float ta = PR(S_TILE_AMT);
  if (ta > 1e-3) {
    float2 q = tileMap((int)PR(S_TILE_A), p);
    float m = PR(S_TILE_MIX);
    if (m > 1e-3) q = lerp(q, tileMap((int)PR(S_TILE_B), p), m);
    p = lerp(p, q, ta);
  }
  return p;
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
  float2 p0 = (i.uv - 0.5) * float2(PR(S_ASPECT), 1);
  float2 p = spaceMap(p0);
  float3 c = viewAt(p, PR(S_KA));
  float km = PR(S_KMIX);
  if (km > 0.001) c = lerp(c, viewAt(p, PR(S_KB)), km);
  c = max(c - PR(S_BLACK), 0);
  c = 1 - exp(-c * PR(S_BRIGHT));
  float luma = dot(c, float3(0.2126, 0.7152, 0.0722));
  c = max(lerp(luma, c, (1 + PR(S_SAT)) * PR(S_USER_SAT)), 0);
  c += PR(S_FLASH);
  c *= 1 - PR(S_VIGNETTE) * dot(p0, p0);
  float gr = PR(S_GRIP_R);
  if (gr > 0) {
    float d = length(i.uv * float2(PR(S_RES_X), PR(S_RES_Y)) - float2(PR(S_GRIP_X), PR(S_GRIP_Y)));
    c = lerp(c, 1, (1 - smoothstep(gr - 1.0, gr + 1.0, d)) * PR(S_GRIP_OP));
  }
  return float4(saturate(c), 1);
}
