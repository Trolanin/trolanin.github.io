// WebGL2 renderer: a port of src/shaders.hlsl and the Gpu class in src/render.cpp.
// Four passes per frame: warp the previous frame (feedback) and add the layers, add the waveform
// lines, add the strange attractor points, then composite to the canvas.
//
// Coordinates follow the desktop shaders: uv (0,0) is the top-left corner. GL textures have their
// first row at the bottom, so feedback samples go through texD(), which flips v.
"use strict";

const GLSL_HEAD = () => `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
layout(std140) uniform Params { vec4 P[40]; };
#define PR(s) P[(s) / 4][(s) % 4]
${paramDefines()}
uniform sampler2D tex0;
uniform sampler2D audioTex;
const float TAU = 6.28318530718;
const float PI = 3.14159265359;

vec3 texD(vec2 d) { return textureLod(tex0, vec2(d.x, 1.0 - d.y), 0.0).rgb; }
float wave(float u) { return textureLod(audioTex, vec2((0.5 + clamp(u, 0.0, 1.0) * 511.0) / 512.0, 0.25), 0.0).r; }
float spec(float u) { return textureLod(audioTex, vec2((0.5 + clamp(u, 0.0, 1.0) * 127.0) / 512.0, 0.75), 0.0).r; }

vec3 pal(float t) {
  vec3 c = vec3(PR(S_PAL_C), PR(S_PAL_C + 1), PR(S_PAL_C + 2));
  vec3 d = vec3(PR(S_PAL_D), PR(S_PAL_D + 1), PR(S_PAL_D + 2));
  return 0.5 + 0.5 * cos(TAU * (c * t + d));
}
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
uint hashU(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
vec2 rot2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
vec3 hueRot(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { return cmul(a, vec2(b.x, -b.y)) / max(dot(b, b), 1e-6); }
vec2 csin(vec2 z) { return vec2(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y)); }
vec2 softLim(vec2 v, float m) { float l = length(v); return l > 1e-6 ? v * (m * tanh(l / m) / l) : v; }
vec2 foldN(vec2 p, float n, float spin) {
  float r = length(p);
  float a = atan(p.y, p.x) + spin;
  float seg = TAU / n;
  a = abs(fract(a / seg) * seg - seg * 0.5);
  return r * vec2(cos(a), sin(a));
}
vec2 hexCell(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 c = floor(vec4(p, p - vec2(0.5, 0.8660254)) / s.xyxy) + 0.5;
  vec2 a = p - c.xy * s, b = p - (c.zw + 0.5) * s;
  return dot(a, a) < dot(b, b) ? a : b;
}
float polyDist(vec2 p, float sides) {
  float r = length(p);
  if (sides < 2.5) return r;
  float a = atan(p.y, p.x);
  float k = TAU / sides;
  float aa = (fract(a / k + 0.5) - 0.5) * k;
  return r * cos(aa) / cos(PI / sides);
}
`;

const VS_FULL = () => GLSL_HEAD() + `
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = p;
  gl_Position = vec4(p * vec2(2, -2) + vec2(-1, 1), 0, 1);
}`;

const FS_WARP = () => GLSL_HEAD() + `
in vec2 uv;
out vec4 outColor;

vec2 variation(int i, vec2 z) {
  float r2 = dot(z, z) + 1e-6, r = sqrt(r2), ph = atan(z.y, z.x);
  float p1 = PR(S_VAR_P1), p2 = PR(S_VAR_P2);
  switch (i) {
    case 1: return sin(z);
    case 2: return z / r2;
    case 3: { float s = sin(r2), c = cos(r2); return vec2(z.x * s - z.y * c, z.x * c + z.y * s); }
    case 4: return vec2((z.x - z.y) * (z.x + z.y), 2.0 * z.x * z.y) / r;
    case 5: return vec2(ph / PI, r - 1.0);
    case 6: return r * vec2(sin(ph + r), cos(ph - r));
    case 7: return r * vec2(sin(ph * r), -cos(ph * r));
    case 8: return ph / PI * vec2(sin(PI * r), cos(PI * r));
    case 9: return vec2(cos(ph) + sin(r), sin(ph) - cos(r)) / r;
    case 10: return vec2(sin(ph) / r, r * cos(ph));
    case 11: return vec2(sin(ph) * cos(r), cos(ph) * sin(r));
    case 12: return 2.0 / (r + 1.0) * z.yx;
    case 13: return 4.0 / (r2 + 4.0) * z;
    case 14: { float amp = 0.1 + 0.5 * p1, fr = 1.5 + 6.0 * p2; return z + amp * sin(z.yx * fr); }
    case 15: { float n = 1.5 + 2.0 * p1; return pow(r, n) * vec2(cos(n * ph), sin(n * ph)); }
    case 16: return exp(z.x - 1.0) * vec2(cos(PI * z.y), sin(PI * z.y));
    case 17: return csin(z);
    case 18: { vec2 a = 0.75 * p1 * vec2(cos(TAU * p2), sin(TAU * p2)); return cdiv(z - a, vec2(1, 0) - cmul(vec2(a.x, -a.y), z)); }
    case 19: return z + (0.15 + 0.35 * p1) * vec2(z.x, -z.y) / r2;
    case 20: return vec2(log(r) * 0.5, ph / PI);
    case 21: return vec2(sin(z.x) / cos(z.y), tan(z.y));
    case 22: return z / max(abs(z.x * z.x - z.y * z.y), 0.05);
    case 23: { vec4 k = vec4(1.0 + 3.0 * p1, 1.0 + 3.0 * p2, 2.0 - p1, 2.0 - p2) * 1.3; return vec2(sin(k.x * z.y) - cos(k.y * z.x), sin(k.z * z.x) - cos(k.w * z.y)); }
    default: return z;
  }
  return z;
}

vec2 curlFlow(vec2 p, float t) {
  float a = p.x + t, b = 1.3 * p.y - 0.7 * t, c = 1.7 * (p.x + p.y) + 1.3 * t, d = 2.3 * p.x - 1.9 * p.y - 0.6 * t;
  float dx = cos(a) * cos(b) + 0.85 * cos(c) - 0.805 * sin(d);
  float dy = -1.3 * sin(a) * sin(b) + 0.85 * cos(c) + 0.665 * sin(d);
  return vec2(dy, -dx);
}

vec3 layers(vec2 p) {
  vec3 c = vec3(0);
  float r = length(p);
  float sr = PR(S_SPEC_RING);
  if (sr > 0.002) {
    vec2 pr = rot2(p, -PR(S_WAVE_ANGLE) * 0.5);
    float u = abs(atan(pr.x, pr.y)) / PI;
    const float bars = 40.0;
    float bu = u * bars;
    float bi = floor(bu);
    float h = spec((bi + 0.5) / bars);
    float r0 = PR(S_SPEC_RADIUS), r1 = r0 + 0.015 + h * 0.2;
    float fu = fract(bu), aw = fwidth(bu) + 1e-4, rw = fwidth(r) + 1e-4;
    float bar = smoothstep(0.0, aw, fu) * smoothstep(0.0, aw, 0.78 - fu);
    float m = smoothstep(r0 - rw, r0, r) * (1.0 - smoothstep(r1, r1 + rw, r)) * bar;
    c += pal(bi / bars * PR(S_PAL_SPREAD) + PR(S_PAL_PHASE)) * m * sr * (0.2 + h) * 0.35;
  }
  float tw = PR(S_TUNNEL);
  if (tw > 0.002) {
    float d = polyDist(p, PR(S_TUNNEL_SIDES));
    for (int j = 0; j < 4; j++) {
      vec4 R = P[V_RINGS + j];
      float e1 = (d - R.x) / 0.006, e2 = (d - R.z) / 0.006;
      c += pal(float(j) * 0.27 + PR(S_PAL_PHASE) + 0.5) * exp(-e1 * e1) * R.y * tw;
      c += pal(float(j) * 0.27 + 0.13 + PR(S_PAL_PHASE) + 0.5) * exp(-e2 * e2) * R.w * tw;
    }
  }
  float sw = PR(S_SPARKLE);
  if (sw > 0.002) {
    vec2 gp = p * 28.0;
    vec2 id = floor(gp);
    float h = hash21(id + floor(PR(S_TIME) * 10.0) * 17.31);
    float chance = 0.015 + 0.1 * clamp(PR(S_TREB) - 0.8, 0.0, 1.0);
    if (h < chance) {
      vec2 o = vec2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5;
      vec2 f = fract(gp) - 0.5 - o * 0.6;
      c += pal(h * 37.0 + PR(S_PAL_PHASE)) * exp(-dot(f, f) * 120.0) * sw * 1.5;
    }
  }
  float ow = PR(S_ORBS);
  if (ow > 0.002) {
    float ph = PR(S_ORB_PHASE);
    float rad = 0.015 + 0.03 * clamp(PR(S_BASS) - 0.5, 0.0, 1.0);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 o = vec2(sin(ph * (0.7 + fi * 0.23) + fi * 1.9) * 0.36 * PR(S_ASPECT), cos(ph * (0.53 + fi * 0.17) + fi * 2.7) * 0.36);
      vec2 dv = p - o;
      c += pal(fi * 0.21 + PR(S_PAL_PHASE)) * exp(-dot(dv, dv) / (rad * rad)) * ow * 0.6;
    }
  }
  return c * PR(S_ADD);
}

void main() {
  float aspect = PR(S_ASPECT);
  vec2 p = (uv - 0.5) * vec2(aspect, 1);
  float r = length(p);
  float ang = PR(S_ROT) + PR(S_SWIRL) * (0.5 - r);
  vec2 q = rot2(p, -ang) / PR(S_ZOOM);
  float f = PR(S_WARP_FREQ), ph = PR(S_WARP_PHASE);
  q += PR(S_WARP) * vec2(sin(q.y * f + ph), cos(q.x * f * 1.13 + ph * 0.87));
  float fa = PR(S_FLAME);
  if (fa > 1e-5) {
    vec2 z = rot2(q * 2.0, PR(S_AFF_ROT)) * PR(S_AFF_SCALE);
    z.x += PR(S_AFF_SHEAR) * z.y;
    z += vec2(PR(S_AFF_X), PR(S_AFF_Y));
    vec4 vi = P[V_VAR_IDX], vw = P[V_VAR_W];
    vec2 v = vw.x * variation(int(vi.x), z);
    if (vw.y > 1e-3) v += vw.y * variation(int(vi.y), z);
    if (vw.z > 1e-3) v += vw.z * variation(int(vi.z), z);
    if (vw.w > 1e-3) v += vw.w * variation(int(vi.w), z);
    q = mix(q, softLim(v, 2.5) * 0.5, fa);
  }
  float fl = PR(S_FLOW);
  if (fl > 1e-7) q += fl * curlFlow(q * PR(S_FLOW_SCALE), PR(S_FLOW_PHASE));
  q -= vec2(PR(S_DRIFT_X), PR(S_DRIFT_Y));
  q.x = mix(q.x, abs(q.x), PR(S_MIRROR_X));
  q.y = mix(q.y, abs(q.y), PR(S_MIRROR_Y));
  vec3 c = texD(q / vec2(aspect, 1) + 0.5);
  c = max(hueRot(c, PR(S_HUE)) * PR(S_DECAY) - 0.002 * PR(S_ADD), 0.0);
  float m = max(c.r, max(c.g, c.b));
  if (m > 1.5) c *= (1.5 + (m - 1.5) * 0.5) / m;
  c += layers(p);
  // Guard against NaN / inf from extreme warps, which would otherwise spread through the feedback.
  if (!(c.r < 1e4 && c.g < 1e4 && c.b < 1e4)) c = vec3(0);
  outColor = vec4(c, 1);
}`;

const FS_COPY = () => GLSL_HEAD() + `
in vec2 uv;
out vec4 outColor;
void main() { outColor = vec4(texD(uv), 1); }`;

// Average brightness of the feedback buffer: its smallest mip level, scaled into 0..1 (x2).
const FS_LUM = () => GLSL_HEAD() + `
uniform float lod;
out vec4 outColor;
void main() {
  vec3 c = textureLod(tex0, vec2(0.5), lod).rgb;
  outColor = vec4(clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)) * 0.5, 0.0, 1.0), 0, 0, 1);
}`;

const VS_WAVE = () => GLSL_HEAD() + `
out vec2 t;
out vec3 col;
vec2 shapePos(float u) {
  float S = PR(S_WAVE_SCALE), G = PR(S_WAVE_GAIN);
  float w = wave(u), ws = wave(1.0 - abs(2.0 * u - 1.0));
  float a = TAU * u;
  vec2 cs = vec2(cos(a), sin(a));
  vec2 pos = vec2(0);
  pos += PR(S_W_CIRCLE) * (S * (1.0 + G * ws)) * cs;
  pos += PR(S_W_LINE) * vec2((u - 0.5) * PR(S_ASPECT) * 0.9, G * 0.5 * w);
  pos += PR(S_W_SCOPE) * vec2(wave(u * 0.95), wave(u * 0.95 + 0.05)) * S * (0.6 + G * 2.0);
  float sa = TAU * u * 3.0;
  pos += PR(S_W_SPIRAL) * (S * 1.5 * u * (1.0 + G * 0.7 * w)) * vec2(cos(sa), sin(sa));
  pos += PR(S_W_ROSE) * (S * (0.55 + 0.45 * cos(PR(S_ROSE_K) * a)) * (1.0 + G * ws)) * cs;
  float wsf = PR(S_W_SUPER);
  if (wsf > 1e-3) {
    float tt = PR(S_SF_M) * a * 0.25;
    float rr = pow(pow(abs(cos(tt)), PR(S_SF_N2)) + pow(abs(sin(tt)), PR(S_SF_N3)) + 1e-4, -1.0 / PR(S_SF_N1));
    pos += wsf * S * 0.9 * min(rr, 1.8) * (1.0 + G * ws) * cs;
  }
  float wl = PR(S_W_LISS);
  if (wl > 1e-3) pos += wl * S * 1.25 * (1.0 + G * 0.6 * ws) * vec2(sin(PR(S_LISS_A) * a + PR(S_LISS_PHASE)), sin(PR(S_LISS_B) * a));
  return pos;
}
void main() {
  const float SEGS = 255.0;
  int seg = gl_VertexID / 6, corner = gl_VertexID % 6;
  int inst = gl_InstanceID;
  float along = (corner == 1 || corner == 4 || corner == 5) ? 1.0 : 0.0;
  float side = (corner == 2 || corner == 3 || corner == 5) ? 1.0 : -1.0;
  float u0 = float(seg) / SEGS, u1 = float(seg + 1) / SEGS;
  float copyAng = PR(S_WAVE_ANGLE) + TAU * float(inst) / max(PR(S_COPIES), 1.0);
  vec2 a = rot2(shapePos(u0), copyAng), b = rot2(shapePos(u1), copyAng);
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1, 0);
  vec2 n = vec2(-dir.y, dir.x);
  float th = PR(S_WAVE_THICK);
  vec2 pp = mix(a, b, along) + n * side * th + dir * (along * 2.0 - 1.0) * th * 0.5;
  float alpha = inst < 4 ? P[V_COPY_ALPHA][inst] : P[V_COPY_ALPHA + 1][inst - 4];
  gl_Position = vec4(pp.x * 2.0 / PR(S_ASPECT), -pp.y * 2.0, 0, 1);
  t = vec2(along, side);
  col = pal(mix(u0, u1, along) * PR(S_PAL_SPREAD) + PR(S_PAL_PHASE) + float(inst) * 0.17) * alpha * PR(S_WAVE_BRIGHT) * PR(S_ADD);
}`;

const FS_WAVE = () => GLSL_HEAD() + `
in vec2 t;
in vec3 col;
out vec4 outColor;
void main() { float v = t.y; outColor = vec4(col * exp(-v * v * 3.0), 0); }`;

const VS_ATTR = () => GLSL_HEAD() + `
out vec2 t;
out vec3 col;
vec2 attrFamily(float f, vec2 p, vec4 k) {
  if (f < 0.5) return vec2(sin(k.x * p.y) + k.z * cos(k.x * p.x), sin(k.y * p.x) + k.w * cos(k.y * p.y));
  if (f < 1.5) return vec2(sin(k.x * p.y) - cos(k.y * p.x), sin(k.z * p.x) - cos(k.w * p.y));
  if (f < 2.5) return vec2(k.w * sin(k.x * p.x) - sin(k.y * p.y), k.z * cos(k.x * p.x) + cos(k.y * p.y));
  return vec2(sin(k.y * p.y) + k.z * sin(k.y * p.x), sin(k.x * p.x) + k.w * sin(k.x * p.y));
}
void main() {
  uint pid = uint(gl_VertexID / 6);
  int corner = gl_VertexID % 6;
  uint h = hashU(pid * 2654435761u ^ hashU(floatBitsToUint(PR(S_ATTR_SEED)) + 0x9e3779b9u));
  vec2 x = vec2(float(h & 0xffffu), float(h >> 16u)) / 65535.0 * 4.0 - 2.0;
  vec4 k = P[V_ATTR_K];
  float fa = PR(S_ATTR_FAM_A), fb = PR(S_ATTR_FAM_B), m = PR(S_ATTR_MIX);
  int n = int(PR(S_ATTR_ITER));
  vec2 prev = x;
  for (int it = 0; it < 64; it++) {
    if (it >= n) break;
    prev = x;
    vec2 xa = attrFamily(fa, x, k);
    x = m > 1e-3 ? mix(xa, attrFamily(fb, x, k), m) : xa;
  }
  vec2 c = rot2(x * PR(S_ATTR_SCALE), PR(S_ATTR_SPIN));
  vec2 off = vec2((corner == 1 || corner == 4 || corner == 5) ? 1.0 : -1.0, (corner == 2 || corner == 3 || corner == 5) ? 1.0 : -1.0);
  float sz = PR(S_ATTR_SIZE);
  gl_Position = vec4(c.x * 2.0 / PR(S_ASPECT) + off.x * sz * 2.0 / PR(S_RES_X), -c.y * 2.0 + off.y * sz * 2.0 / PR(S_RES_Y), 0, 1);
  t = off;
  col = pal(length(x - prev) * 0.35 + PR(S_PAL_PHASE) + 0.3) * PR(S_ATTR_BRIGHT);
}`;

const FS_ATTR = () => GLSL_HEAD() + `
in vec2 t;
in vec3 col;
out vec4 outColor;
void main() { outColor = vec4(col * exp(-dot(t, t) * 2.5), 0); }`;

const FS_COMP = () => GLSL_HEAD() + `
in vec2 uv;
out vec4 outColor;

vec2 lens(int i, vec2 p) {
  float p1 = PR(S_VIEW_P1), p2 = PR(S_VIEW_P2), ph = PR(S_VIEW_PHASE);
  float r = length(p) + 1e-5, a = atan(p.y, p.x);
  switch (i) {
    case 1: { float n = floor(2.0 + 2.99 * p1); float rr = 0.5 * pow(2.0 * r, 0.5 + 0.5 * n); return rr * vec2(cos(n * a + ph), sin(n * a + ph)); }
    case 2: { float R = 0.2 + 0.25 * p1; return rot2(p * (R * R) / (r * r + 0.002), ph); }
    case 3: { vec2 z = 2.0 * p, c = 0.75 * p2 * vec2(cos(ph), sin(ph)); return 0.5 * cdiv(z - c, vec2(1, 0) - cmul(vec2(c.x, -c.y), z)); }
    case 4: {
      float s = 2.0 + 3.0 * p1, t = log(r / 0.25) / log(s) + ph * 0.3;
      t = abs(fract(t * 0.5) * 2.0 - 1.0);
      float a2 = a + p2 * t * 1.5;
      return 0.25 * pow(s, t) * vec2(cos(a2), sin(a2));
    }
    case 5: return vec2((abs(a) / PI - 0.5) * PR(S_ASPECT), (0.04 + 0.08 * p1) / r + ph);
    case 6: { float k = 1.0 + 4.0 * p1; return p / r * 0.5 * tanh(r * k) / tanh(0.5 * k); }
    case 7: return rot2(p, (1.0 + 3.0 * p1) * sin(r * (6.0 + 10.0 * p2) - ph * 3.0));
    case 8: return p * (1.0 + (p1 - 0.4) * 4.0 * r * r);
    case 9: { float k = 2.0 + 3.0 * p1; return csin(rot2(p, ph) * k) / k; }
    case 10: { vec2 z = rot2(2.0 * p, ph); return 0.25 * (z + (0.25 + 0.5 * p2) * vec2(z.x, -z.y) / max(dot(z, z), 1e-3)); }
    case 11: return vec2((abs(a) / PI - 0.5) * PR(S_ASPECT), (r - 0.3) * 1.5);
    default: return p;
  }
  return p;
}

vec2 tileMap(int i, vec2 p) {
  vec2 c = p * PR(S_TILE_SCALE);
  switch (i) {
    case 1: { vec2 f = abs(fract(c + 0.5) - 0.5); return f.y > f.x ? f.yx : f; }
    case 2: return foldN(hexCell(c), 6.0, 0.0);
    case 3: return foldN(hexCell(c), 3.0, 0.0);
    case 4: { c.x += 0.5 * floor(c.y); return fract(c) - 0.5; }
    case 5: {
      vec2 id = floor(c), f = fract(c) - 0.5;
      float k = mod(id.x + 2.0 * id.y, 4.0);
      return rot2(f, k * PI * 0.5);
    }
    default: return p;
  }
  return p;
}

vec3 sampleChroma(vec2 p) {
  vec2 u = p / vec2(PR(S_ASPECT), 1) + 0.5;
  vec2 dir = p * PR(S_CHROMA);
  return vec3(texD(u + dir).r, texD(u).g, texD(u - dir).b);
}
vec2 kaleido(vec2 p, float n) {
  if (n < 1.5) return p;
  return mix(p, foldN(p, n, PR(S_KSPIN)), PR(S_KAMT));
}
vec2 spaceMap(vec2 p) {
  float la = PR(S_VIEW_AMT);
  if (la > 1e-3) {
    vec2 q = lens(int(PR(S_VIEW_A)), p);
    float m = PR(S_VIEW_MIX);
    if (m > 1e-3) q = mix(q, lens(int(PR(S_VIEW_B)), p), m);
    p = mix(p, q, la);
  }
  float ta = PR(S_TILE_AMT);
  if (ta > 1e-3) {
    vec2 q = tileMap(int(PR(S_TILE_A)), p);
    float m = PR(S_TILE_MIX);
    if (m > 1e-3) q = mix(q, tileMap(int(PR(S_TILE_B)), p), m);
    p = mix(p, q, ta);
  }
  return p;
}
vec3 viewAt(vec2 p, float n) {
  vec2 k = kaleido(p, n);
  vec3 c = sampleChroma(k);
  float e = PR(S_ECHO);
  if (e > 0.002) {
    vec2 q = rot2(k, PR(S_ECHO_ANGLE)) / PR(S_ECHO_ZOOM);
    q.x = mix(q.x, -q.x, PR(S_ECHO_FLIP_X));
    q.y = mix(q.y, -q.y, PR(S_ECHO_FLIP_Y));
    c += sampleChroma(q) * e;
  }
  return c;
}
void main() {
  vec2 p0 = (uv - 0.5) * vec2(PR(S_ASPECT), 1);
  vec2 p = spaceMap(p0);
  vec3 c = viewAt(p, PR(S_KA));
  float km = PR(S_KMIX);
  if (km > 0.001) c = mix(c, viewAt(p, PR(S_KB)), km);
  c = max(c - PR(S_BLACK), 0.0);
  c = 1.0 - exp(-c * PR(S_BRIGHT));
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(luma), c, (1.0 + PR(S_SAT)) * PR(S_USER_SAT)), 0.0);
  c += PR(S_FLASH);
  c *= 1.0 - PR(S_VIGNETTE) * dot(p0, p0);
  outColor = vec4(clamp(c, 0.0, 1.0), 1);
}`;

const WAVE_SEGS = 255;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.error = "";
    this.meanLum = -1;
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    this.gl = gl;
    if (!gl) { this.error = "WebGL2 is not available"; return; }
    this.floatOk = !!gl.getExtension("EXT_color_buffer_float") || !!gl.getExtension("EXT_color_buffer_half_float");
    this.init();
  }

  init() {
    const gl = this.gl;
    const prog = (vs, fs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs()], [gl.FRAGMENT_SHADER, fs()]]) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
      const bi = gl.getUniformBlockIndex(p, "Params");
      if (bi !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, bi, 0);
      gl.useProgram(p);
      const t0 = gl.getUniformLocation(p, "tex0"), t1 = gl.getUniformLocation(p, "audioTex");
      if (t0) gl.uniform1i(t0, 0);
      if (t1) gl.uniform1i(t1, 1);
      return p;
    };
    try {
      this.pWarp = prog(VS_FULL, FS_WARP);
      this.pCopy = prog(VS_FULL, FS_COPY);
      this.pLum = prog(VS_FULL, FS_LUM);
      this.pWave = prog(VS_WAVE, FS_WAVE);
      this.pAttr = prog(VS_ATTR, FS_ATTR);
      this.pComp = prog(VS_FULL, FS_COMP);
    } catch (e) {
      this.error = e.message;
      return;
    }
    this.lodLoc = gl.getUniformLocation(this.pLum, "lod");
    this.vao = gl.createVertexArray();
    this.ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, P_FLOATS * 4, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);

    const samp = (wrap, min) => {
      const s = gl.createSampler();
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, wrap);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, wrap);
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, min);
      gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return s;
    };
    this.sMirror = samp(gl.MIRRORED_REPEAT, gl.LINEAR);
    this.sClamp = samp(gl.CLAMP_TO_EDGE, gl.LINEAR);
    this.sMip = samp(gl.CLAMP_TO_EDGE, gl.LINEAR_MIPMAP_LINEAR);

    this.audioTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, WAVE_N, 2);
    this.audioData = new Float32Array(WAVE_N * 2);

    // 1x1 brightness probe, read back a few frames late so the CPU never waits on the GPU.
    this.lumTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.lumTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
    this.lumFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lumFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lumTex, 0);
    this.lumPbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.lumPbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, 4, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.lumSync = null;
    this.lumBytes = new Uint8Array(4);
    this.frameNo = 0;

    this.fb = [];
    this.fw = this.fh = 0;
    this.cur = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  ok() { return this.gl && !this.error && !this.gl.isContextLost(); }

  // (Re)creates the feedback buffers, carrying the old picture over so resizing doesn't blank it.
  makeFeedback(w, h) {
    const gl = this.gl;
    let mips = 1;
    while (Math.max(w, h) >> (mips - 1) > 1) mips++;
    const fmt = this.floatOk ? gl.RGBA16F : gl.RGBA8;
    const next = [];
    for (let i = 0; i < 2; i++) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, mips, fmt, w, h);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      next.push({ tex, fbo });
    }
    const old = this.fb[this.cur];
    if (old) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, next[0].fbo);
      gl.useProgram(this.pCopy);
      gl.bindVertexArray(this.vao);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, old.tex);
      gl.bindSampler(0, this.sClamp);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (const f of this.fb) { gl.deleteFramebuffer(f.fbo); gl.deleteTexture(f.tex); }
    }
    this.fb = next;
    this.cur = 0;
    this.fw = w; this.fh = h; this.mips = mips;
  }

  resize(w, h) {
    const c = this.canvas;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    if (w !== this.fw || h !== this.fh) this.makeFeedback(w, h);
  }

  render(P, a, di) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, P);
    const ad = this.audioData;
    ad.set(a.wave, 0);
    ad.fill(0, WAVE_N);
    ad.set(a.spec, WAVE_N);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WAVE_N, 2, gl.RED, gl.FLOAT, ad);
    gl.bindSampler(1, this.sClamp);

    // 1. Warp the previous frame into the next one and add the layers.
    const nxt = this.cur ^ 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[nxt].fbo);
    gl.viewport(0, 0, this.fw, this.fh);
    gl.disable(gl.BLEND);
    gl.useProgram(this.pWarp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fb[this.cur].tex);
    gl.bindSampler(0, this.sMirror);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Waveform lines, added on top. 3. Strange attractor points, added on top.
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(this.pWave);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, WAVE_SEGS * 6, clamp(di.copies, 1, 6));
    if (di.attrPoints > 0) {
      gl.useProgram(this.pAttr);
      gl.drawArrays(gl.TRIANGLES, 0, di.attrPoints * 6);
    }
    gl.disable(gl.BLEND);
    this.cur = nxt;
    const curTex = this.fb[this.cur].tex;

    // Average brightness, every few frames.
    this.frameNo++;
    if (this.lumSync) {
      const st = gl.getSyncParameter(this.lumSync, gl.SYNC_STATUS);
      if (st === gl.SIGNALED) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.lumPbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.lumBytes);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.deleteSync(this.lumSync);
        this.lumSync = null;
        this.meanLum = (this.lumBytes[0] / 255) * 2;
      }
    } else if (this.frameNo % 4 === 0) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, curTex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindSampler(0, this.sMip);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.lumFbo);
      gl.viewport(0, 0, 1, 1);
      gl.useProgram(this.pLum);
      gl.uniform1f(this.lodLoc, this.mips - 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.lumPbo);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.lumSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    }

    // 4. Composite to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.pComp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, curTex);
    gl.bindSampler(0, this.sMirror);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy() {
    const ext = this.gl && this.gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
  }
}
