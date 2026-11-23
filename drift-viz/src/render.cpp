// Direct3D 11 renderer and the render thread (audio -> evolution -> shaders -> screen).
#include "app.h"
#include "audio.h"
#include "evolve.h"
#include "params.h"
#include <d3d11.h>
#include <dxgi1_3.h>
#include <wincodec.h>
#include <wrl/client.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include "VS_Full.h"
#include "VS_Wave.h"
#include "PS_Warp.h"
#include "PS_Wave.h"
#include "PS_Comp.h"
#include "PS_Copy.h"
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "user32.lib")

using Microsoft::WRL::ComPtr;

namespace {
double nowS() {
  static LARGE_INTEGER f = [] { LARGE_INTEGER x; QueryPerformanceFrequency(&x); return x; }();
  LARGE_INTEGER t; QueryPerformanceCounter(&t);
  return double(t.QuadPart) / double(f.QuadPart);
}

const int WAVE_SEGS = 255;

class Gpu {
public:
  std::wstring error;
  bool flip = true;
  HRESULT lastPresent = S_OK;
  float meanLum = -1;   // average brightness of the feedback buffer a few frames ago (-1 = not known yet)

  bool init() {
    D3D_FEATURE_LEVEL fl = D3D_FEATURE_LEVEL_11_0;
    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, &fl, 1, D3D11_SDK_VERSION, &dev, nullptr, &ctx);
    if (FAILED(hr)) hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, flags, &fl, 1, D3D11_SDK_VERSION, &dev, nullptr, &ctx);
    if (FAILED(hr)) { error = L"Direct3D 11 is not available on this PC."; return false; }
    ComPtr<IDXGIDevice> dd;
    ComPtr<IDXGIAdapter> ad;
    if (FAILED(dev.As(&dd)) || FAILED(dd->GetAdapter(&ad)) || FAILED(ad->GetParent(IID_PPV_ARGS(&fac)))) { error = L"DXGI 1.2 is not available."; return false; }

    dev->CreateVertexShader(g_VS_Full, sizeof g_VS_Full, nullptr, &vsFull);
    dev->CreateVertexShader(g_VS_Wave, sizeof g_VS_Wave, nullptr, &vsWave);
    dev->CreatePixelShader(g_PS_Warp, sizeof g_PS_Warp, nullptr, &psWarp);
    dev->CreatePixelShader(g_PS_Wave, sizeof g_PS_Wave, nullptr, &psWave);
    dev->CreatePixelShader(g_PS_Comp, sizeof g_PS_Comp, nullptr, &psComp);
    dev->CreatePixelShader(g_PS_Copy, sizeof g_PS_Copy, nullptr, &psCopy);

    D3D11_SAMPLER_DESC sd = {};
    sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_MIRROR;
    sd.MaxLOD = D3D11_FLOAT32_MAX;
    dev->CreateSamplerState(&sd, &sMirror);
    sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    dev->CreateSamplerState(&sd, &sClamp);

    D3D11_BLEND_DESC bd = {};
    bd.RenderTarget[0].BlendEnable = TRUE;
    bd.RenderTarget[0].SrcBlend = bd.RenderTarget[0].DestBlend = D3D11_BLEND_ONE;
    bd.RenderTarget[0].BlendOp = D3D11_BLEND_OP_ADD;
    bd.RenderTarget[0].SrcBlendAlpha = D3D11_BLEND_ZERO;
    bd.RenderTarget[0].DestBlendAlpha = D3D11_BLEND_ONE;
    bd.RenderTarget[0].BlendOpAlpha = D3D11_BLEND_OP_ADD;
    bd.RenderTarget[0].RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
    dev->CreateBlendState(&bd, &addBlend);

    D3D11_RASTERIZER_DESC rd = {};
    rd.FillMode = D3D11_FILL_SOLID;
    rd.CullMode = D3D11_CULL_NONE;
    rd.DepthClipEnable = TRUE;
    dev->CreateRasterizerState(&rd, &raster);

    D3D11_BUFFER_DESC cbd = {};
    cbd.ByteWidth = P_FLOATS * 4;
    cbd.Usage = D3D11_USAGE_DYNAMIC;
    cbd.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    cbd.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    dev->CreateBuffer(&cbd, nullptr, &cb);

    D3D11_TEXTURE2D_DESC td = {};
    td.Width = WAVE_N; td.Height = 2; td.MipLevels = 1; td.ArraySize = 1;
    td.Format = DXGI_FORMAT_R32_FLOAT;
    td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_DYNAMIC;
    td.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    td.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    dev->CreateTexture2D(&td, nullptr, &audioTex);
    dev->CreateShaderResourceView(audioTex.Get(), nullptr, &audioSrv);

    if (!vsFull || !vsWave || !psWarp || !psWave || !psComp || !psCopy || !cb || !audioSrv) { error = L"Could not create the GPU resources."; return false; }
    return true;
  }

  ~Gpu() { if (waitObj) CloseHandle(waitObj); }

  // Blocks until the swap chain can take another frame (keeps latency to one frame).
  void waitReady() { if (waitObj) WaitForSingleObjectEx(waitObj, 100, TRUE); }

  void setTarget(HWND h) {
    if (ctx) ctx->OMSetRenderTargets(0, nullptr, nullptr);
    bbRtv.Reset();
    sc.Reset();
    if (waitObj) { CloseHandle(waitObj); waitObj = nullptr; }
    scFlags = 0;
    if (ctx) ctx->Flush();
    hwnd = h;
    bw = bh = 0;
    if (!h) return;
    RECT rc;
    GetClientRect(h, &rc);
    DXGI_SWAP_CHAIN_DESC1 d = {};
    d.Width = UINT(std::max<LONG>(rc.right, 8));
    d.Height = UINT(std::max<LONG>(rc.bottom, 8));
    d.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    d.SampleDesc.Count = 1;
    d.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    d.BufferCount = 2;
    d.Scaling = DXGI_SCALING_STRETCH;
    d.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
    d.AlphaMode = DXGI_ALPHA_MODE_IGNORE;
    d.Flags = DXGI_SWAP_CHAIN_FLAG_FRAME_LATENCY_WAITABLE_OBJECT;
    flip = true;
    if (FAILED(fac->CreateSwapChainForHwnd(dev.Get(), h, &d, nullptr, nullptr, &sc))) {
      // Older systems: fall back to the blt model.
      flip = false;
      d.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
      d.BufferCount = 1;
      d.Flags = 0;
      if (FAILED(fac->CreateSwapChainForHwnd(dev.Get(), h, &d, nullptr, nullptr, &sc))) { sc.Reset(); error = L"Could not create a swap chain."; return; }
    }
    scFlags = d.Flags;
    ComPtr<IDXGISwapChain2> sc2;
    if (flip && SUCCEEDED(sc.As(&sc2))) {
      sc2->SetMaximumFrameLatency(1);
      waitObj = sc2->GetFrameLatencyWaitableObject();
    }
    fac->MakeWindowAssociation(h, DXGI_MWA_NO_ALT_ENTER | DXGI_MWA_NO_WINDOW_CHANGES);
    bw = int(d.Width); bh = int(d.Height);
    makeBackbufferView();
  }

  bool ready() const { return sc && bbRtv; }

  void resize(int w, int h, int scalePct) {
    if (!sc) return;
    if (w != bw || h != bh) {
      ctx->OMSetRenderTargets(0, nullptr, nullptr);
      bbRtv.Reset();
      if (FAILED(sc->ResizeBuffers(0, UINT(w), UINT(h), DXGI_FORMAT_UNKNOWN, scFlags))) return;
      bw = w; bh = h;
      makeBackbufferView();
    }
    int iw = std::max(16, w * scalePct / 100), ih = std::max(16, h * scalePct / 100);
    if (iw != fw || ih != fh) makeFeedback(iw, ih);
  }

  void render(const float* P, const AudioFrame& a, int copies) {
    D3D11_MAPPED_SUBRESOURCE m;
    if (SUCCEEDED(ctx->Map(cb.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) { memcpy(m.pData, P, P_FLOATS * 4); ctx->Unmap(cb.Get(), 0); }
    if (SUCCEEDED(ctx->Map(audioTex.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) {
      float* row0 = (float*)m.pData;
      float* row1 = (float*)((BYTE*)m.pData + m.RowPitch);
      memcpy(row0, a.wave, sizeof a.wave);
      memset(row1, 0, WAVE_N * 4);
      memcpy(row1, a.spec, sizeof a.spec);
      ctx->Unmap(audioTex.Get(), 0);
    }
    ID3D11Buffer* cbs[] = { cb.Get() };
    ID3D11SamplerState* ss[] = { sMirror.Get(), sClamp.Get() };
    ID3D11ShaderResourceView* none[2] = {};
    ctx->IASetInputLayout(nullptr);
    ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    ctx->RSSetState(raster.Get());
    ctx->VSSetConstantBuffers(0, 1, cbs);
    ctx->PSSetConstantBuffers(0, 1, cbs);
    ctx->VSSetSamplers(0, 2, ss);
    ctx->PSSetSamplers(0, 2, ss);

    // 1. Warp the previous frame into the next one and add the layers.
    int nxt = cur ^ 1;
    ctx->PSSetShaderResources(0, 2, none);
    setTargetView(fbRtv[nxt].Get(), fw, fh);
    ctx->OMSetBlendState(nullptr, nullptr, 0xffffffff);
    ctx->VSSetShader(vsFull.Get(), nullptr, 0);
    ctx->PSSetShader(psWarp.Get(), nullptr, 0);
    ID3D11ShaderResourceView* warpIn[] = { fbSrv[cur].Get(), audioSrv.Get() };
    ctx->PSSetShaderResources(0, 2, warpIn);
    ctx->Draw(3, 0);

    // 2. Waveform lines, added on top.
    ID3D11ShaderResourceView* waveIn[] = { nullptr, audioSrv.Get() };
    ctx->VSSetShaderResources(0, 2, waveIn);
    ctx->OMSetBlendState(addBlend.Get(), nullptr, 0xffffffff);
    ctx->VSSetShader(vsWave.Get(), nullptr, 0);
    ctx->PSSetShader(psWave.Get(), nullptr, 0);
    ctx->DrawInstanced(WAVE_SEGS * 6, UINT(std::clamp(copies, 1, 6)), 0, 0);
    ctx->OMSetBlendState(nullptr, nullptr, 0xffffffff);
    cur = nxt;

    // Average brightness: shrink the frame to 1x1 with mips and read it back a few frames
    // later, so the CPU never waits on the GPU.
    ctx->OMSetRenderTargets(0, nullptr, nullptr);
    ctx->GenerateMips(fbSrv[cur].Get());
    ctx->CopySubresourceRegion(probe[probeAt % 3].Get(), 0, 0, 0, 0, fb[cur].Get(), fbMips - 1, nullptr);
    probeAt++;
    if (probeAt >= 3) {
      D3D11_MAPPED_SUBRESOURCE pm;
      if (SUCCEEDED(ctx->Map(probe[probeAt % 3].Get(), 0, D3D11_MAP_READ, D3D11_MAP_FLAG_DO_NOT_WAIT, &pm))) {
        const uint16_t* h = (const uint16_t*)pm.pData;
        meanLum = 0.2126f * halfToFloat(h[0]) + 0.7152f * halfToFloat(h[1]) + 0.0722f * halfToFloat(h[2]);
        ctx->Unmap(probe[probeAt % 3].Get(), 0);
      }
    }

    // 3. Composite to the screen.
    ctx->PSSetShaderResources(0, 2, none);
    setTargetView(bbRtv.Get(), bw, bh);
    ctx->VSSetShader(vsFull.Get(), nullptr, 0);
    ctx->PSSetShader(psComp.Get(), nullptr, 0);
    ID3D11ShaderResourceView* compIn[] = { fbSrv[cur].Get(), audioSrv.Get() };
    ctx->PSSetShaderResources(0, 2, compIn);
    ctx->Draw(3, 0);
    ctx->PSSetShaderResources(0, 2, none);
  }

  // Returns false if the device was lost.
  bool present() {
    HRESULT hr = sc->Present(1, 0);
    lastPresent = hr;
    if (hr == DXGI_STATUS_OCCLUDED) Sleep(15);
    return hr != DXGI_ERROR_DEVICE_REMOVED && hr != DXGI_ERROR_DEVICE_RESET;
  }

  bool saveShot(const std::wstring& path) {
    ComPtr<ID3D11Texture2D> bb, st;
    if (FAILED(sc->GetBuffer(0, IID_PPV_ARGS(&bb)))) return false;
    D3D11_TEXTURE2D_DESC d;
    bb->GetDesc(&d);
    d.Usage = D3D11_USAGE_STAGING; d.BindFlags = 0; d.CPUAccessFlags = D3D11_CPU_ACCESS_READ; d.MiscFlags = 0;
    if (FAILED(dev->CreateTexture2D(&d, nullptr, &st))) return false;
    ctx->CopyResource(st.Get(), bb.Get());
    D3D11_MAPPED_SUBRESOURCE m;
    if (FAILED(ctx->Map(st.Get(), 0, D3D11_MAP_READ, 0, &m))) return false;
    bool ok = false;
    ComPtr<IWICImagingFactory> wic;
    ComPtr<IWICStream> stream;
    ComPtr<IWICBitmapEncoder> enc;
    ComPtr<IWICBitmapFrameEncode> frame;
    WICPixelFormatGUID fmt = GUID_WICPixelFormat32bppBGRA;
    if (SUCCEEDED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&wic))) &&
        SUCCEEDED(wic->CreateStream(&stream)) &&
        SUCCEEDED(stream->InitializeFromFilename(path.c_str(), GENERIC_WRITE)) &&
        SUCCEEDED(wic->CreateEncoder(GUID_ContainerFormatPng, nullptr, &enc)) &&
        SUCCEEDED(enc->Initialize(stream.Get(), WICBitmapEncoderNoCache)) &&
        SUCCEEDED(enc->CreateNewFrame(&frame, nullptr)) &&
        SUCCEEDED(frame->Initialize(nullptr)) &&
        SUCCEEDED(frame->SetSize(d.Width, d.Height)) &&
        SUCCEEDED(frame->SetPixelFormat(&fmt)) && fmt == GUID_WICPixelFormat32bppBGRA &&
        SUCCEEDED(frame->WritePixels(d.Height, m.RowPitch, m.RowPitch * d.Height, (BYTE*)m.pData)) &&
        SUCCEEDED(frame->Commit()) && SUCCEEDED(enc->Commit()))
      ok = true;
    ctx->Unmap(st.Get(), 0);
    return ok;
  }

private:
  ComPtr<ID3D11Device> dev;
  ComPtr<ID3D11DeviceContext> ctx;
  ComPtr<IDXGIFactory2> fac;
  ComPtr<IDXGISwapChain1> sc;
  ComPtr<ID3D11RenderTargetView> bbRtv;
  HWND hwnd = nullptr;
  HANDLE waitObj = nullptr;
  UINT scFlags = 0;
  int bw = 0, bh = 0;
  ComPtr<ID3D11Texture2D> fb[2];
  ComPtr<ID3D11RenderTargetView> fbRtv[2];
  ComPtr<ID3D11ShaderResourceView> fbSrv[2];
  int fw = 0, fh = 0, cur = 0, fbMips = 1;
  ComPtr<ID3D11Texture2D> probe[3];
  unsigned probeAt = 0;
  ComPtr<ID3D11Texture2D> audioTex;

  static float halfToFloat(uint16_t h) {
    uint32_t s = (h >> 15) & 1, e = (h >> 10) & 31, m = h & 1023;
    float v = e == 0 ? std::ldexp(float(m), -24) : e == 31 ? 65504.f : std::ldexp(float(m | 1024), int(e) - 25);
    return s ? -v : v;
  }
  ComPtr<ID3D11ShaderResourceView> audioSrv;
  ComPtr<ID3D11Buffer> cb;
  ComPtr<ID3D11VertexShader> vsFull, vsWave;
  ComPtr<ID3D11PixelShader> psWarp, psWave, psComp, psCopy;
  ComPtr<ID3D11SamplerState> sMirror, sClamp;
  ComPtr<ID3D11BlendState> addBlend;
  ComPtr<ID3D11RasterizerState> raster;

  void makeBackbufferView() {
    ComPtr<ID3D11Texture2D> bb;
    if (SUCCEEDED(sc->GetBuffer(0, IID_PPV_ARGS(&bb)))) dev->CreateRenderTargetView(bb.Get(), nullptr, &bbRtv);
  }

  void setTargetView(ID3D11RenderTargetView* rtv, int w, int h) {
    ctx->OMSetRenderTargets(1, &rtv, nullptr);
    D3D11_VIEWPORT vp = { 0, 0, float(w), float(h), 0, 1 };
    ctx->RSSetViewports(1, &vp);
  }

  // (Re)creates the feedback buffers, carrying the old picture over so resizing doesn't blank it.
  void makeFeedback(int w, int h) {
    ComPtr<ID3D11ShaderResourceView> old = fbSrv[cur];
    ComPtr<ID3D11Texture2D> t[2];
    ComPtr<ID3D11RenderTargetView> r[2];
    ComPtr<ID3D11ShaderResourceView> s[2];
    D3D11_TEXTURE2D_DESC td = {};
    int mips = 1;
    while ((std::max(w, h) >> (mips - 1)) > 1) mips++;
    td.Width = UINT(w); td.Height = UINT(h); td.MipLevels = UINT(mips); td.ArraySize = 1;
    td.Format = DXGI_FORMAT_R16G16B16A16_FLOAT;
    td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_DEFAULT;
    td.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    td.MiscFlags = D3D11_RESOURCE_MISC_GENERATE_MIPS;
    if (!probe[0]) {
      D3D11_TEXTURE2D_DESC pd = td;
      pd.Width = pd.Height = 1; pd.MipLevels = 1; pd.MiscFlags = 0; pd.BindFlags = 0;
      pd.Usage = D3D11_USAGE_STAGING; pd.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
      for (auto& p : probe) if (FAILED(dev->CreateTexture2D(&pd, nullptr, &p))) return;
    }
    const float black[4] = { 0, 0, 0, 1 };
    for (int i = 0; i < 2; i++) {
      if (FAILED(dev->CreateTexture2D(&td, nullptr, &t[i]))) return;
      dev->CreateRenderTargetView(t[i].Get(), nullptr, &r[i]);
      dev->CreateShaderResourceView(t[i].Get(), nullptr, &s[i]);
      ctx->ClearRenderTargetView(r[i].Get(), black);
    }
    if (old) {
      ID3D11ShaderResourceView* none[2] = {};
      ctx->PSSetShaderResources(0, 2, none);
      setTargetView(r[0].Get(), w, h);
      ctx->OMSetBlendState(nullptr, nullptr, 0xffffffff);
      ctx->IASetInputLayout(nullptr);
      ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
      ctx->RSSetState(raster.Get());
      ID3D11SamplerState* ss[] = { sMirror.Get(), sClamp.Get() };
      ctx->PSSetSamplers(0, 2, ss);
      ctx->VSSetShader(vsFull.Get(), nullptr, 0);
      ctx->PSSetShader(psCopy.Get(), nullptr, 0);
      ID3D11ShaderResourceView* in[] = { old.Get() };
      ctx->PSSetShaderResources(0, 1, in);
      ctx->Draw(3, 0);
      ctx->PSSetShaderResources(0, 2, none);
      ctx->OMSetRenderTargets(0, nullptr, nullptr);
    }
    for (int i = 0; i < 2; i++) { fb[i] = t[i]; fbRtv[i] = r[i]; fbSrv[i] = s[i]; }
    cur = 0; fw = w; fh = h; fbMips = mips;
  }
};

int monitorHz(HWND h) {
  MONITORINFOEXW mi = {};
  mi.cbSize = sizeof mi;
  DEVMODEW dm = {};
  dm.dmSize = sizeof dm;
  if (GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mi) && EnumDisplaySettingsW(mi.szDevice, ENUM_CURRENT_SETTINGS, &dm) &&
      dm.dmDisplayFrequency > 1)
    return int(dm.dmDisplayFrequency);
  return 60;
}

// Sleeps with sub-millisecond precision (high-resolution waitable timer, Windows 10 1803+).
void preciseSleep(double sec) {
  static HANDLE timer = [] {
    HANDLE t = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
    return t ? t : CreateWaitableTimerW(nullptr, TRUE, nullptr);
  }();
  LARGE_INTEGER due;
  due.QuadPart = -LONGLONG(sec * 1e7);
  if (timer && SetWaitableTimer(timer, &due, 0, nullptr, nullptr, FALSE)) WaitForSingleObject(timer, 1000);
  else Sleep(DWORD(sec * 1000));
}

std::wstring shotName(const std::wstring& base, int index, int count) {
  if (count <= 1) return base;
  size_t dot = base.find_last_of(L'.');
  std::wstring stem = dot == std::wstring::npos ? base : base.substr(0, dot);
  std::wstring ext = dot == std::wstring::npos ? L".png" : base.substr(dot);
  return stem + L"-" + std::to_wstring(index + 1) + ext;
}
}  // namespace

void renderThread(Shared* sh) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  Gpu gpu;
  bool gpuOk = gpu.init();
  if (!gpuOk) {
    std::lock_guard<std::mutex> l(sh->mu);
    sh->st.error = gpu.error;
  }
  Audio audio;
  audio.start();
  Evolver evo;
  evo.init(unsigned(GetTickCount64() ^ GetCurrentProcessId()), sh->favPath);
  Visuals vis;
  AudioFrame af;
  HWND cur = nullptr;
  float P[P_FLOATS];
  double last = nowS(), lastStatus = 0, fpsT = last, firstFrame = -1;
  int frames = 0, shots = 0;
  float fps = 0;

  double lastHzCheck = -10;
  int hz = 60;
  while (!sh->quit) {
    if (gpuOk && cur && gpu.ready()) gpu.waitReady();
    double frameStart = nowS();
    Settings s;
    HWND want;
    bool floating;
    {
      std::lock_guard<std::mutex> l(sh->mu);
      s = sh->s;
      want = sh->target;
      floating = sh->targetFloating;
    }
    audio.setDemo(s.source == 1);
    double t = nowS();
    float dt = float(std::min(t - last, 0.1));
    last = t;
    audio.get(af);
    if (sh->mutateReq.exchange(0)) evo.mutateScene(1.f, L"Mutated by hand");
    if (sh->speciesReq.exchange(0)) evo.newSpecies(L"New species by hand");
    if (sh->likeReq.exchange(0)) evo.like();
    evo.update(dt * sh->evoScale, af, s);

    if (t - lastStatus > 0.25) {
      lastStatus = t;
      wchar_t line[256];
      swprintf(line, 256, L"Generation %d · scene %d · complexity %d%%%s · %.0f fps", evo.generation, evo.scene,
               int(evo.complexity * 100.f + 0.5f), s.freeze ? L" · frozen" : L"", fps);
      std::lock_guard<std::mutex> l(sh->mu);
      sh->st.audio = af.device + (af.silent && !af.demo ? L" (silent)" : L"");
      sh->st.level = af.level;
      sh->st.evo = line;
      sh->st.scene = evo.describe() + L"\n" + evo.lastEvent;
      sh->st.favorites = evo.favoriteCount();
    }

    if (!gpuOk) { Sleep(50); continue; }
    if (want != cur) { gpu.setTarget(want); cur = want; }
    bool show = cur && gpu.ready() && IsWindowVisible(cur) && !IsIconic(GetAncestor(cur, GA_ROOT));
    RECT rc = {};
    if (show) GetClientRect(cur, &rc);
    if (!show || rc.right < 8 || rc.bottom < 8) { Sleep(20); continue; }
    gpu.resize(rc.right, rc.bottom, s.renderScale);

    float gx = 0, gy = 0, gr = 0, gop = 0;
    if (floating) {
      float k = GetDpiForWindow(cur) / 96.f;
      gx = gy = GRIP_X * k;
      gr = GRIP_R * k;
      POINT pt;
      GetCursorPos(&pt);
      ScreenToClient(cur, &pt);
      float dx = pt.x - gx, dy = pt.y - gy, hit = GRIP_HIT * k;
      gop = std::min(1.f, s.gripOpacity * (dx * dx + dy * dy < hit * hit ? 2.5f : 1.f));
    }
    int copies = 1;
    vis.build(P, evo, af, s, dt, rc.right, rc.bottom, gx, gy, gr, gop, gpu.meanLum, copies);
    gpu.render(P, af, copies);

    if (firstFrame < 0) firstFrame = t;
    if (!sh->shotPath.empty() && shots < sh->shotCount && t - firstFrame >= sh->shotAfter + shots * sh->shotEvery) {
      gpu.saveShot(shotName(sh->shotPath, shots, sh->shotCount));
      if (++shots == sh->shotCount && sh->notify) PostMessageW(sh->notify, WM_APP_SHOTS_DONE, 0, 0);
    }

    if (!gpu.present()) {
      // Device lost (driver update, GPU reset): start over.
      gpu.setTarget(nullptr);
      gpu = Gpu();
      gpuOk = gpu.init();
      cur = nullptr;
    }
    // Frame cap at the monitor's refresh rate, for when presents don't wait for vsync
    // (display asleep, remote sessions, some drivers).
    if (t - lastHzCheck > 2.0) { lastHzCheck = t; hz = std::clamp(monitorHz(cur), 30, 500); }
    double budget = 1.0 / hz - (nowS() - frameStart);
    if (budget > 0.0005) preciseSleep(budget);
    frames++;
    if (t - fpsT >= 1.0) {
      fps = float(frames / (t - fpsT));
      frames = 0;
      fpsT = t;
      if (!sh->logPath.empty()) {
        auto u8 = [](const std::wstring& w) {
          std::string s(WideCharToMultiByte(CP_UTF8, 0, w.c_str(), int(w.size()), nullptr, 0, nullptr, nullptr), '\0');
          WideCharToMultiByte(CP_UTF8, 0, w.c_str(), int(w.size()), s.data(), int(s.size()), nullptr, nullptr);
          return s;
        };
        if (FILE* f = _wfopen(sh->logPath.c_str(), L"ab")) {
          fprintf(f, "fps %.0f flip %d present 0x%08lx size %ldx%ld mean %.2f fill %.2f | %s level %.2f dB %.0f silent %d beats %d sections %d | gen %d scene %d cx %.2f | %s\n",
                  fps, gpu.flip, (unsigned long)gpu.lastPresent, rc.right, rc.bottom, gpu.meanLum, vis.fill, u8(af.device).c_str(), af.level, af.dbfs, int(af.silent),
                  af.beats, af.sections, evo.generation, evo.scene, evo.complexity, u8(evo.lastEvent).c_str());
          fclose(f);
        }
      }
    }
  }
  audio.stop();
  CoUninitialize();
}
