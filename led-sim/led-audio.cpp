// led-audio: captures whatever Windows is playing (WASAPI loopback), reduces it to
// 16 bands + level + beat counter every 10 ms, and sends 19-byte frames to
//   - the LED simulator (WebSocket on ws://127.0.0.1:8000), and/or
//   - a real ESP32 over USB serial (--port COM5).
// Frame: 0xFF, level, beatCounter, band[0..15]. Data bytes are 0..254, so 0xFF only ever marks a frame start.
//
// Build: build.bat     Run: led-audio.exe [--port COM5] [--baud 115200] [--ws-port 8000] [--no-ws]
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <mmreg.h>
#include <bcrypt.h>
#include <wincrypt.h>
#include <timeapi.h>
#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "winmm.lib")

static const int N = 1024;          // FFT window (~21 ms at 48 kHz)
static const int BANDS = 16;
static const double FRAME_S = 0.010;
static const float PI = 3.14159265358979f;
static const PROPERTYKEY kFriendlyName = { { 0xa45c254e, 0xdf1c, 0x4efd, { 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0 } }, 14 };

static double nowS() {
  static LARGE_INTEGER f = [] { LARGE_INTEGER x; QueryPerformanceFrequency(&x); return x; }();
  LARGE_INTEGER t; QueryPerformanceCounter(&t);
  return double(t.QuadPart) / double(f.QuadPart);
}

/* ------------------------------ audio capture ------------------------------ */
struct Loopback {
  IAudioClient* client = nullptr;
  IAudioCaptureClient* cap = nullptr;
  WAVEFORMATEX* fmt = nullptr;
  int channels = 2, bits = 32, rate = 48000;
  bool isFloat = true;

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
      IPropertyStore* props = nullptr;
      if (ok && SUCCEEDED(dev->OpenPropertyStore(STGM_READ, &props))) {
        PROPVARIANT name; PropVariantInit(&name);
        if (SUCCEEDED(props->GetValue(kFriendlyName, &name)) && name.vt == VT_LPWSTR)
          wprintf(L"Capturing: %ls  (%d Hz, %d ch, %hs%d)\n", name.pwszVal, rate, channels, isFloat ? "float" : "int", bits);
        PropVariantClear(&name);
        props->Release();
      }
    }
    if (dev) dev->Release();
    en->Release();
    if (!ok) release();
    return ok;
  }
  // Appends mono samples to out. Returns false if the device went away.
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

/* -------------------------------- analysis -------------------------------- */
static void fft(std::vector<std::complex<float>>& a) {
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

struct Analyzer {
  std::vector<float> ring = std::vector<float>(N, 0.f), hann = std::vector<float>(N);
  size_t pos = 0;
  float bandPeak = -40, lvlPeak = -35, smooth[BANDS] = {}, lvlSmooth = 0;
  float bassHist[100] = {}; int histPos = 0;
  double lastBeat = 0;
  uint8_t beatCount = 0;

  Analyzer() { for (int i = 0; i < N; i++) hann[i] = 0.5f - 0.5f * std::cos(2 * PI * i / (N - 1)); }
  void push(const std::vector<float>& s) { for (float x : s) { ring[pos] = x; pos = (pos + 1) % N; } }

  void frame(int rate, int hop, uint8_t out[3 + BANDS]) {
    std::vector<std::complex<float>> a(N);
    for (int i = 0; i < N; i++) a[i] = ring[(pos + i) % N] * hann[i];
    fft(a);
    // Hann-windowed full-scale sine peaks at N/4, so this scale puts it near 0 dB.
    const float norm = 1.f / (float(N) * N / 16.f), binHz = float(rate) / N;
    float db[BANDS], bass = 0, maxDb = -200;
    for (int b = 0; b < BANDS; b++) {
      float f0 = 40.f * std::pow(400.f, b / float(BANDS)), f1 = 40.f * std::pow(400.f, (b + 1) / float(BANDS));
      int lo = std::max(1, int(f0 / binHz)), hi = std::min(N / 2, std::max(lo + 1, int(f1 / binHz)));
      float p = 0;
      for (int k = lo; k < hi; k++) p += std::norm(a[k]) * norm;
      if (b < 4) bass += p;
      db[b] = 10.f * std::log10(p + 1e-12f);
      maxDb = std::max(maxDb, db[b]);
    }
    // Auto-gain: follow the loudest band instantly, let it fall 4 dB/s; never amplify below -40 dB.
    bandPeak = std::max({ maxDb, bandPeak - 0.04f, -40.f });
    for (int b = 0; b < BANDS; b++) {
      float v = std::clamp((db[b] - (bandPeak - 45.f)) / 45.f, 0.f, 1.f) * 254.f;
      smooth[b] = std::max(v, smooth[b] * 0.85f);   // instant attack, ~60 ms release
      out[3 + b] = uint8_t(smooth[b]);
    }
    float rms = 0;
    for (int i = 0; i < hop; i++) { float x = ring[(pos + N - 1 - i) % N]; rms += x * x; }
    float lvlDb = 20.f * std::log10(std::sqrt(rms / hop) + 1e-9f);
    lvlPeak = std::max({ lvlDb, lvlPeak - 0.03f, -35.f });
    lvlSmooth = std::max(std::clamp((lvlDb - (lvlPeak - 40.f)) / 40.f, 0.f, 1.f) * 254.f, lvlSmooth * 0.85f);
    // Beat: bass energy jumps well above its 1-second average.
    float avg = 0;
    for (float h : bassHist) avg += h;
    avg /= 100.f;
    double t = nowS();
    if (bass > 1.6f * avg && bass > 1e-5f && t - lastBeat > 0.15) { lastBeat = t; beatCount = uint8_t((beatCount + 1) % 255); }
    bassHist[histPos] = bass; histPos = (histPos + 1) % 100;
    out[0] = 0xFF; out[1] = uint8_t(lvlSmooth); out[2] = beatCount;
  }
};

/* ---------------------------- WebSocket server ---------------------------- */
static std::string wsAccept(const std::string& key) {
  std::string s = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  BYTE hash[20];
  BCRYPT_ALG_HANDLE alg;
  BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA1_ALGORITHM, nullptr, 0);
  BCryptHash(alg, nullptr, 0, (PUCHAR)s.data(), ULONG(s.size()), hash, 20);
  BCryptCloseAlgorithmProvider(alg, 0);
  char b64[64]; DWORD n = sizeof b64;
  CryptBinaryToStringA(hash, 20, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, b64, &n);
  return std::string(b64, n);
}

struct WsServer {
  struct Client { SOCKET s; bool open; std::string req; };
  SOCKET lsn = INVALID_SOCKET;
  std::vector<Client> clients;

  bool listen(int port) {
    lsn = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons(u_short(port));
    inet_pton(AF_INET, "127.0.0.1", &a.sin_addr);   // local machine only
    u_long nb = 1; ioctlsocket(lsn, FIONBIO, &nb);
    return bind(lsn, (sockaddr*)&a, sizeof a) == 0 && ::listen(lsn, 8) == 0;
  }
  void poll() {
    for (SOCKET s; (s = accept(lsn, nullptr, nullptr)) != INVALID_SOCKET;) {
      u_long nb = 1; ioctlsocket(s, FIONBIO, &nb);
      BOOL nd = TRUE; setsockopt(s, IPPROTO_TCP, TCP_NODELAY, (char*)&nd, sizeof nd);
      clients.push_back({ s, false, "" });
    }
    for (auto& c : clients) {
      char buf[2048];
      int r = recv(c.s, buf, sizeof buf, 0);
      if (r == 0 || (r < 0 && WSAGetLastError() != WSAEWOULDBLOCK)) { closesocket(c.s); c.s = INVALID_SOCKET; continue; }
      if (r < 0) continue;
      if (c.open) { if ((buf[0] & 0x0F) == 8) { closesocket(c.s); c.s = INVALID_SOCKET; } continue; }
      c.req.append(buf, r);
      if (c.req.find("\r\n\r\n") == std::string::npos) { if (c.req.size() > 8192) { closesocket(c.s); c.s = INVALID_SOCKET; } continue; }
      std::string lower = c.req;
      std::transform(lower.begin(), lower.end(), lower.begin(), [](char ch) { return char(tolower((unsigned char)ch)); });
      size_t k = lower.find("sec-websocket-key:");
      if (k == std::string::npos) { closesocket(c.s); c.s = INVALID_SOCKET; continue; }
      k += 18;
      size_t e = c.req.find("\r\n", k);
      std::string key = c.req.substr(k, e - k);
      key.erase(0, key.find_first_not_of(" \t"));
      key.erase(key.find_last_not_of(" \t") + 1);
      std::string resp = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n";
      send(c.s, resp.data(), int(resp.size()), 0);
      c.open = true;
    }
    clients.erase(std::remove_if(clients.begin(), clients.end(), [](const Client& c) { return c.s == INVALID_SOCKET; }), clients.end());
  }
  void broadcast(const uint8_t* p, int n) {
    std::vector<char> f = { char(0x82), char(n) };
    f.insert(f.end(), p, p + n);
    for (auto& c : clients) {
      if (!c.open) continue;
      if (send(c.s, f.data(), int(f.size()), 0) != int(f.size()) && WSAGetLastError() != WSAEWOULDBLOCK) { closesocket(c.s); c.s = INVALID_SOCKET; }
    }
  }
  int count() const { int k = 0; for (auto& c : clients) k += c.open; return k; }
};

/* ------------------------------- serial port ------------------------------- */
struct SerialOut {
  std::string port; int baud = 115200;
  HANDLE h = INVALID_HANDLE_VALUE;
  double nextTry = 0;

  void write(const uint8_t* p, int n) {
    if (port.empty()) return;
    if (h == INVALID_HANDLE_VALUE) {
      if (nowS() < nextTry) return;
      nextTry = nowS() + 1.0;
      h = CreateFileA(("\\\\.\\" + port).c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
      if (h == INVALID_HANDLE_VALUE) return;
      DCB d{}; d.DCBlength = sizeof d;
      GetCommState(h, &d);
      d.BaudRate = DWORD(baud); d.ByteSize = 8; d.Parity = NOPARITY; d.StopBits = ONESTOPBIT;
      d.fDtrControl = DTR_CONTROL_DISABLE; d.fRtsControl = RTS_CONTROL_DISABLE;   // keep ESP32 auto-reset lines released
      d.fOutxCtsFlow = FALSE; d.fOutxDsrFlow = FALSE; d.fOutX = FALSE; d.fInX = FALSE;
      SetCommState(h, &d);
      COMMTIMEOUTS to{}; to.WriteTotalTimeoutConstant = 20; to.ReadIntervalTimeout = MAXDWORD;
      SetCommTimeouts(h, &to);
      printf("\nOpened %s at %d baud\n", port.c_str(), baud);
    }
    DWORD w = 0;
    if (!WriteFile(h, p, DWORD(n), &w, nullptr)) {
      CloseHandle(h); h = INVALID_HANDLE_VALUE;
      printf("\n%s disconnected, retrying...\n", port.c_str());
    } else {
      // Drain anything the ESP32 prints so its TX buffer never backs up.
      char sink[256]; DWORD r;
      while (ReadFile(h, sink, sizeof sink, &r, nullptr) && r) {}
    }
  }
};

/* ---------------------------------- main ---------------------------------- */
int main(int argc, char** argv) {
  SerialOut ser;
  int wsPort = 8000;
  bool useWs = true;
  for (int i = 1; i < argc; i++) {
    std::string a = argv[i];
    if (a == "--port" && i + 1 < argc) ser.port = argv[++i];
    else if (a == "--baud" && i + 1 < argc) ser.baud = atoi(argv[++i]);
    else if (a == "--ws-port" && i + 1 < argc) wsPort = atoi(argv[++i]);
    else if (a == "--no-ws") useWs = false;
    else { printf("usage: led-audio [--port COM5] [--baud 115200] [--ws-port 8000] [--no-ws]\n"); return 1; }
  }

  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  WSADATA wsa; WSAStartup(MAKEWORD(2, 2), &wsa);
  timeBeginPeriod(1);

  WsServer ws;
  if (useWs) {
    if (!ws.listen(wsPort)) { printf("Port %d is busy (another led-audio or server running?)\n", wsPort); return 1; }
    printf("Simulator link: ws://localhost:%d\n", wsPort);
  }
  if (!ser.port.empty()) printf("ESP32 link: %s at %d baud\n", ser.port.c_str(), ser.baud);

  Loopback lb;
  Analyzer an;
  std::vector<float> samples;
  double next = nowS(), lastData = nowS(), lastPrint = 0, lastOpenTry = 0;
  bool haveDev = false;
  const char* ramp = " .:-=+*#%@";

  for (;;) {
    double t = nowS();
    if (!haveDev && t - lastOpenTry > 1.0) {
      lastOpenTry = t;
      haveDev = lb.open();
      if (!haveDev) printf("\rNo playback device yet, retrying...   ");
    }
    if (haveDev) {
      samples.clear();
      if (!lb.read(samples)) { haveDev = false; printf("\nPlayback device changed, reopening...\n"); }
      if (!samples.empty()) { an.push(samples); lastData = t; }
    }
    if (t >= next) {
      next += FRAME_S;
      if (t - next > 0.1) next = t + FRAME_S;
      int rate = haveDev ? lb.rate : 48000, hop = int(rate * FRAME_S);
      // Loopback delivers nothing while nothing plays; feed silence so the bars fall.
      if (t - lastData > 0.03) an.push(std::vector<float>(hop, 0.f));
      uint8_t frame[3 + BANDS];
      an.frame(rate, hop, frame);
      if (useWs) ws.broadcast(frame, sizeof frame);
      ser.write(frame, sizeof frame);
      if (t - lastPrint > 0.05) {
        lastPrint = t;
        char bars[BANDS + 1];
        for (int b = 0; b < BANDS; b++) bars[b] = ramp[frame[3 + b] * 9 / 254];
        bars[BANDS] = 0;
        int lv = frame[1] * 20 / 254;
        printf("\rlevel [%-20.*s] bands [%s] beat %3d  sim clients %d   ", lv, "####################", bars, frame[2], ws.count());
      }
    }
    if (useWs) ws.poll();
    Sleep(1);
  }
}
