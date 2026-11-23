// Audio capture (WASAPI loopback of the default playback device) and analysis.
// The capture code follows led-sim's led-audio.cpp.
#include "audio.h"
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <mmreg.h>
#include <timeapi.h>
#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdint>
#include <vector>
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "winmm.lib")

namespace {
const float PI = 3.14159265358979f;
const PROPERTYKEY kFriendlyName = { { 0xa45c254e, 0xdf1c, 0x4efd, { 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0 } }, 14 };

double nowS() {
  static LARGE_INTEGER f = [] { LARGE_INTEGER x; QueryPerformanceFrequency(&x); return x; }();
  LARGE_INTEGER t; QueryPerformanceCounter(&t);
  return double(t.QuadPart) / double(f.QuadPart);
}

/* ------------------------------ loopback capture ------------------------------ */
struct Loopback {
  IAudioClient* client = nullptr;
  IAudioCaptureClient* cap = nullptr;
  WAVEFORMATEX* fmt = nullptr;
  int channels = 2, bits = 32, rate = 48000;
  bool isFloat = true;
  std::wstring name;

  void release() {
    if (client) client->Stop();
    if (cap) { cap->Release(); cap = nullptr; }
    if (client) { client->Release(); client = nullptr; }
    if (fmt) { CoTaskMemFree(fmt); fmt = nullptr; }
  }
  bool open() {
    release();
    IMMDeviceEnumerator* en = nullptr;
    IMMDevice* dev = nullptr;
    bool ok = false;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void**)&en))) return false;
    if (SUCCEEDED(en->GetDefaultAudioEndpoint(eRender, eConsole, &dev)) &&
        SUCCEEDED(dev->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&client)) &&
        SUCCEEDED(client->GetMixFormat(&fmt)) &&
        SUCCEEDED(client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 1000000, 0, fmt, nullptr)) &&
        SUCCEEDED(client->GetService(__uuidof(IAudioCaptureClient), (void**)&cap)) &&
        SUCCEEDED(client->Start())) {
      channels = fmt->nChannels; bits = fmt->wBitsPerSample; rate = fmt->nSamplesPerSec;
      DWORD tag = fmt->wFormatTag;
      if (tag == WAVE_FORMAT_EXTENSIBLE) tag = ((WAVEFORMATEXTENSIBLE*)fmt)->SubFormat.Data1;
      isFloat = tag == WAVE_FORMAT_IEEE_FLOAT;
      ok = isFloat ? bits == 32 : (bits == 16 || bits == 32);
      name = L"Playback device";
      IPropertyStore* props = nullptr;
      if (ok && SUCCEEDED(dev->OpenPropertyStore(STGM_READ, &props))) {
        PROPVARIANT v; PropVariantInit(&v);
        if (SUCCEEDED(props->GetValue(kFriendlyName, &v)) && v.vt == VT_LPWSTR) name = v.pwszVal;
        PropVariantClear(&v);
        props->Release();
      }
    }
    if (dev) dev->Release();
    en->Release();
    if (!ok) release();
    return ok;
  }
  // Appends mono samples. Returns false if the device went away.
  bool read(std::vector<float>& out) {
    UINT32 pk = 0;
    HRESULT hr;
    while (SUCCEEDED(hr = cap->GetNextPacketSize(&pk)) && pk) {
      BYTE* data; UINT32 frames; DWORD flags;
      if (FAILED(hr = cap->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
      for (UINT32 i = 0; i < frames; i++) {
        float m = 0;
        if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT)) {
          for (int c = 0; c < channels; c++) {
            size_t k = size_t(i) * channels + c;
            if (isFloat) m += ((float*)data)[k];
            else if (bits == 16) m += ((int16_t*)data)[k] / 32768.f;
            else m += ((int32_t*)data)[k] / 2147483648.f;
          }
          m /= channels;
        }
        out.push_back(m);
      }
      cap->ReleaseBuffer(frames);
    }
    return SUCCEEDED(hr);
  }
};

/* ------------------------------ demo beat ------------------------------ */
// A small 124 BPM loop whose arrangement changes every 8 bars, so the visualizer has
// beats and section changes to react to without anything playing.
struct Demo {
  double t = 0, kickPh = 0, bassPh = 0, leadPh = 0, padPh[3] = {};
  float bassLp = 0, hatPrev = 0;
  uint32_t rnd = 12345;

  float noise() { rnd = rnd * 1664525u + 1013904223u; return float(rnd >> 8) / float(1 << 24) * 2.f - 1.f; }
  static double hz(int note) { return 440.0 * std::pow(2.0, (note - 69) / 12.0); }
  static void wrap(double& p) { p -= std::floor(p); }

  void gen(float* out, int n, int rate) {
    static const int bassNotes[8] = { 33, 33, 45, 33, 36, 33, 43, 40 };
    static const int chords[4][3] = { { 57, 60, 64 }, { 53, 57, 60 }, { 55, 59, 62 }, { 52, 55, 59 } };
    const double step = 60.0 / 124.0 / 4.0;
    for (int i = 0; i < n; i++) {
      double tt = t + double(i) / rate;
      long si = long(tt / step);
      double ts = tt - si * step, tq = tt - (si - si % 4) * step;
      int s16 = int(si % 16);
      long bar = si / 16;
      int section = int(bar / 8) % 4, chord = int(bar / 2) % 4;
      float x = 0;
      if (section == 1 || section == 2) {          // kick on every quarter
        double f = 48 + 110 * std::exp(-tq * 35);
        kickPh += f / rate; wrap(kickPh);
        x += float(std::sin(2 * PI * kickPh) * std::exp(-tq * 7) * 0.8);
      }
      if (section == 2) {                           // filtered saw bass
        bassPh += hz(bassNotes[(si / 2) % 8]) / rate; wrap(bassPh);
        float saw = float(2 * bassPh - 1), env = float(std::exp(-ts * 8));
        bassLp += (saw - bassLp) * (0.03f + 0.15f * env);
        x += bassLp * 0.45f * (0.5f + 0.5f * env);
      }
      if (section != 3) {                           // hats
        float nz = noise(), hp = nz - hatPrev; hatPrev = nz;
        x += hp * (s16 % 4 == 2 ? 0.25f : 0.08f) * float(std::exp(-ts * 60));
      }
      if (section >= 2) {                           // square arpeggio
        leadPh += hz(chords[chord][s16 % 3] + 12) / rate; wrap(leadPh);
        x += (leadPh < 0.5 ? 1.f : -1.f) * 0.07f * float(std::exp(-ts * 12));
      }
      if (section != 2) {                           // pad
        for (int k = 0; k < 3; k++) {
          padPh[k] += hz(chords[chord][k]) / rate; wrap(padPh[k]);
          x += float(std::sin(2 * PI * padPh[k])) * 0.06f;
        }
      }
      out[i] = x * 0.8f;
    }
    t += double(n) / rate;
  }
};

/* ------------------------------ analysis ------------------------------ */
void fft(std::vector<std::complex<float>>& a) {
  size_t n = a.size();
  for (size_t i = 1, j = 0; i < n; i++) {
    size_t bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) std::swap(a[i], a[j]);
  }
  for (size_t len = 2; len <= n; len <<= 1) {
    float ang = -2 * PI / float(len);
    std::complex<float> wl(std::cos(ang), std::sin(ang));
    for (size_t i = 0; i < n; i += len) {
      std::complex<float> w(1);
      for (size_t k = 0; k < len / 2; k++) {
        auto u = a[i + k], v = a[i + k + len / 2] * w;
        a[i + k] = u + v; a[i + k + len / 2] = u - v;
        w *= wl;
      }
    }
  }
}

const int FFT_N = 2048, RING = 8192;

struct Analyzer {
  std::vector<float> ring = std::vector<float>(RING, 0.f), hann = std::vector<float>(FFT_N), pw = std::vector<float>(FFT_N / 2 + 2);
  std::vector<std::complex<float>> buf = std::vector<std::complex<float>>(FFT_N);
  size_t pos = 0;
  float specPeak = -40, spec[SPEC_N] = {}, wavePeak = 0.05f;
  float lvlPeak = -40, lvl = 0;
  float bandAvg[3] = { -1, -1, -1 }, rel[3] = { 1, 1, 1 };
  float bassHist[100] = {}; int hp = 0, histN = 0;
  double lastBeat = 0, lastSection = 0, quietSince = 0;
  int beats = 0, sections = 0;
  float fShort[8] = {}, fLong[8] = {};
  bool fInit = false;

  Analyzer() { for (int i = 0; i < FFT_N; i++) hann[i] = 0.5f - 0.5f * std::cos(2 * PI * i / (FFT_N - 1)); }
  void push(const float* s, size_t n) { for (size_t i = 0; i < n; i++) { ring[pos] = s[i]; pos = (pos + 1) % RING; } }
  float at(size_t back) const { return ring[(pos + RING - 1 - back) % RING]; }   // back = 0 is the newest sample

  float bandPower(float f0, float f1, float binHz) const {
    float k0 = f0 / binHz, k1 = f1 / binHz;
    if (k1 - k0 < 1.f) {   // narrower than one FFT bin: interpolate at the centre, scale by width
      float kc = 0.5f * (k0 + k1);
      int k = std::clamp(int(kc), 0, FFT_N / 2 - 1);
      float fr = kc - k;
      return (pw[k] * (1 - fr) + pw[k + 1] * fr) * (k1 - k0);
    }
    float p = 0;
    for (int k = std::max(1, int(k0)); k < std::min(FFT_N / 2, int(k1)); k++) p += pw[k];
    return p;
  }

  void analyze(int rate, int hop, double t, AudioFrame& f) {
    for (int i = 0; i < FFT_N; i++) buf[i] = at(FFT_N - 1 - i) * hann[i];
    fft(buf);
    const float norm = 1.f / (float(FFT_N) * FFT_N / 16.f), binHz = float(rate) / FFT_N;
    for (int k = 0; k <= FFT_N / 2; k++) pw[k] = std::norm(buf[k]) * norm;
    pw[FFT_N / 2 + 1] = 0;

    // Spectrum bands, auto-gained: follow the loudest band, fall 3 dB/s, show the top 48 dB.
    float db[SPEC_N], maxDb = -200;
    const float ratio = 16000.f / 30.f;
    for (int b = 0; b < SPEC_N; b++) {
      float f0 = 30.f * std::pow(ratio, b / float(SPEC_N)), f1 = 30.f * std::pow(ratio, (b + 1) / float(SPEC_N));
      db[b] = 10.f * std::log10(bandPower(f0, f1, binHz) + 1e-12f);
      maxDb = std::max(maxDb, db[b]);
    }
    specPeak = std::max({ maxDb, specPeak - 0.03f, -45.f });
    for (int b = 0; b < SPEC_N; b++) {
      float v = std::clamp((db[b] - (specPeak - 48.f)) / 48.f, 0.f, 1.f);
      spec[b] = std::max(v, spec[b] * 0.86f);
      f.spec[b] = spec[b];
    }

    // Bass / mid / treble relative to their own ~2 s average.
    float p3[3] = { bandPower(20, 250, binHz), bandPower(250, 2000, binHz), bandPower(2000, 16000, binHz) };
    for (int i = 0; i < 3; i++) {
      if (bandAvg[i] < 0) bandAvg[i] = p3[i];
      bandAvg[i] += (p3[i] - bandAvg[i]) * 0.005f;
      float r = std::clamp(p3[i] / (bandAvg[i] + 1e-9f), 0.f, 4.f);
      rel[i] += (r - rel[i]) * 0.35f;
    }
    f.bass = rel[0]; f.mid = rel[1]; f.treb = rel[2];

    // Beat: bass energy jumps well above its 1-second average.
    float avg = 0;
    for (float h : bassHist) avg += h;
    avg /= 100.f;
    if (histN >= 100 && p3[0] > 1.5f * avg && p3[0] > 1e-6f && t - lastBeat > 0.18) { lastBeat = t; beats++; }
    bassHist[hp] = p3[0]; hp = (hp + 1) % 100; histN++;

    // Loudness.
    float rms = 0;
    for (int i = 0; i < hop; i++) { float x = at(i); rms += x * x; }
    float lvlDb = 20.f * std::log10(std::sqrt(rms / hop) + 1e-9f);
    lvlPeak = std::max({ lvlDb, lvlPeak - 0.03f, -35.f });
    lvl = std::max(std::clamp((lvlDb - (lvlPeak - 40.f)) / 40.f, 0.f, 1.f), lvl * 0.9f);
    f.level = lvl;
    f.dbfs = lvlDb;
    if (lvlDb > -80.f) quietSince = t;   // loopback silence is digital zero; quiet listening sits around -60
    f.silent = t - quietSince > 2.0;

    // Section changes: the octave-band profile of the last ~0.5 s drifts away from the last ~8 s.
    float fe[8];
    for (int o = 0; o < 8; o++) fe[o] = std::max(-90.f, 10.f * std::log10(bandPower(40.f * (1 << o), 80.f * (1 << o), binHz) + 1e-12f));
    float nov = 0;
    for (int o = 0; o < 8; o++) {
      if (!fInit || f.silent) fShort[o] = fLong[o] = fe[o];
      fShort[o] += (fe[o] - fShort[o]) * 0.02f;
      fLong[o] += (fe[o] - fLong[o]) * 0.0012f;
      nov += std::fabs(fShort[o] - fLong[o]) / 8.f;
    }
    fInit = true;
    if (!f.silent && nov > 5.f && t - lastSection > 6.0) {
      sections++; lastSection = t;
      for (int o = 0; o < 8; o++) fLong[o] = fShort[o];
    }
    f.novelty = nov; f.beats = beats; f.sections = sections;

    // Waveform: start at a rising zero crossing so it stands still like a triggered scope.
    size_t start = WAVE_N + 511;
    for (size_t b = WAVE_N + 1; b < WAVE_N + 512; b++)
      if (at(b) <= 0.f && at(b - 1) > 0.f) { start = b; break; }
    float peak = 0;
    for (int j = 0; j < WAVE_N; j++) {
      size_t b = start - j;
      float x = 0.25f * at(b + 1) + 0.5f * at(b) + 0.25f * at(b > 0 ? b - 1 : 0);
      f.wave[j] = x;
      peak = std::max(peak, std::fabs(x));
    }
    wavePeak = std::max(peak, wavePeak * 0.995f);
    float gain = 1.f / std::max(wavePeak, 0.02f);
    for (int j = 0; j < WAVE_N; j++) f.wave[j] = std::clamp(f.wave[j] * gain, -1.f, 1.f);
  }
};
}  // namespace

void Audio::start() {
  quit = false;
  th = std::thread([this] { run(); });
}

void Audio::stop() {
  quit = true;
  if (th.joinable()) th.join();
}

void Audio::get(AudioFrame& out) {
  std::lock_guard<std::mutex> l(mu);
  out = latest;
}

void Audio::run() {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  timeBeginPeriod(1);
  Loopback lb;
  Analyzer an;
  Demo demo;
  AudioFrame f;
  std::vector<float> samples;
  bool haveDev = false;
  double next = nowS(), lastData = nowS(), lastOpenTry = -10;
  while (!quit) {
    double t = nowS();
    bool useDemo = wantDemo;
    if (useDemo && haveDev) { lb.release(); haveDev = false; }
    if (!useDemo && !haveDev && t - lastOpenTry > 1.0) { lastOpenTry = t; haveDev = lb.open(); }
    if (haveDev) {
      samples.clear();
      if (!lb.read(samples)) { lb.release(); haveDev = false; }
      else if (!samples.empty()) { an.push(samples.data(), samples.size()); lastData = t; }
    }
    if (t >= next) {
      next += 0.01;
      if (t - next > 0.1) next = t + 0.01;
      int rate = (!useDemo && haveDev) ? lb.rate : 48000, hop = rate / 100;
      if (useDemo) {
        samples.resize(hop);
        demo.gen(samples.data(), hop, rate);
        an.push(samples.data(), hop);
      } else if (t - lastData > 0.03) {
        // Loopback delivers nothing while nothing plays; feed silence so everything falls.
        samples.assign(hop, 0.f);
        an.push(samples.data(), hop);
      }
      an.analyze(rate, hop, t, f);
      f.demo = useDemo;
      f.device = useDemo ? L"Demo beat (built in)" : haveDev ? lb.name : L"No playback device yet, retrying...";
      std::lock_guard<std::mutex> l(mu);
      latest = f;
    }
    Sleep(1);
  }
  lb.release();
  timeEndPeriod(1);
  CoUninitialize();
}
