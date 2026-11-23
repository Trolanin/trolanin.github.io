// Drift: an evolving, music-reactive visualizer for Windows.
// UI thread: settings window (with the docked visualizer) and the undocked borderless window.
// Rendering, audio and evolution run on their own threads (render.cpp, audio.cpp, evolve.cpp).
#include "app.h"
#include <windowsx.h>
#include <commctrl.h>
#include <shellapi.h>
#include <shlobj.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <thread>
#include <vector>
#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "ole32.lib")

namespace {
enum {
  IDC_SOURCE = 100, IDC_SOURCE_LABEL, IDC_AUDIO_STATUS, IDC_FREEZE, IDC_MUTATE, IDC_SPECIES, IDC_LIKE,
  IDC_EVO_STATUS, IDC_SCENE_STATUS, IDC_SCALE, IDC_SCALE_LABEL, IDC_DOCK, IDC_SIZE_LABEL, IDC_W, IDC_X,
  IDC_H, IDC_APPLY, IDC_FILL, IDC_ONTOP, IDC_TIPS, IDC_METER,
  IDC_HEADER = 150, IDC_SLIDER = 200, IDC_SLIDER_VALUE = 300, IDC_SLIDER_LABEL = 400,
};
enum { CMD_MUTATE = 1000, CMD_SPECIES, CMD_LIKE, CMD_FREEZE, CMD_DOCK, CMD_FILL, CMD_ONTOP, CMD_SETTINGS, CMD_EXIT };
enum { FMT_PCT, FMT_SEC, FMT_MIN, FMT_SIGNED };

struct SliderDef { const wchar_t* label; float lo, hi; float Settings::* field; int fmt; };
const SliderDef kSliders[] = {
  { L"Reactivity", 0.f, 2.f, &Settings::reactivity, FMT_PCT },
  { L"Evolution speed", 0.f, 3.f, &Settings::evoSpeed, FMT_PCT },
  { L"Mutation strength", 0.f, 1.f, &Settings::mutation, FMT_PCT },
  { L"Max scene length", 8.f, 120.f, &Settings::sceneLen, FMT_SEC },
  { L"Build-up time", 0.5f, 10.f, &Settings::buildMin, FMT_MIN },
  { L"Max complexity", 0.f, 1.f, &Settings::complexityCap, FMT_PCT },
  { L"Trails", -1.f, 1.f, &Settings::trails, FMT_SIGNED },
  { L"Brightness", 0.3f, 2.f, &Settings::brightness, FMT_PCT },
  { L"Grip dot opacity", 0.05f, 0.8f, &Settings::gripOpacity, FMT_PCT },
};
const int kSliderCount = int(sizeof kSliders / sizeof kSliders[0]);
const int kScales[] = { 50, 75, 100 };
const wchar_t* kHeaders[] = { L"Audio", L"Evolution", L"Look", L"Window" };

struct App {
  HINSTANCE inst = nullptr;
  HWND main = nullptr, panel = nullptr, view = nullptr, flt = nullptr;
  Shared sh;
  std::thread rt;
  HFONT font = nullptr, bold = nullptr;
  HICON iconBig = nullptr, iconSmall = nullptr;
  UINT dpi = 96;
  int scrollY = 0, contentH = 0;
  bool filling = false, splitDrag = false, noSave = false, closing = false, inLayout = false, testRun = false;
  RECT preFill = {};
  std::wstring iniPath;
  HWND slider[16] = {}, sliderVal[16] = {}, sliderLabel[16] = {}, header[4] = {};
  HWND source, sourceLabel, audioStatus, meter, freeze, mutate, species, like, evoStatus, sceneStatus;
  HWND scale, scaleLabel, dock, sizeLabel, editW, editX, editH, apply, fill, onTop, tips;
} g;

Settings& S() { return g.sh.s; }
int Px(int v) { return MulDiv(v, int(g.dpi), 96); }

template <class F> void editSettings(F f) {
  std::lock_guard<std::mutex> l(g.sh.mu);
  f(g.sh.s);
}

void setTarget(HWND h, bool floating) {
  std::lock_guard<std::mutex> l(g.sh.mu);
  g.sh.target = h;
  g.sh.targetFloating = floating;
}

/* ------------------------------ settings file ------------------------------ */
void readRect(const wchar_t* key, RECT& r) {
  wchar_t buf[128];
  GetPrivateProfileStringW(L"drift", key, L"", buf, 128, g.iniPath.c_str());
  RECT t;
  if (swscanf(buf, L"%ld %ld %ld %ld", &t.left, &t.top, &t.right, &t.bottom) == 4 && t.right > t.left && t.bottom > t.top) r = t;
}

void loadSettings() {
  Settings& s = S();
  const wchar_t* ini = g.iniPath.c_str();
  auto rf = [&](const wchar_t* k, float& v) {
    wchar_t buf[64];
    GetPrivateProfileStringW(L"drift", k, L"", buf, 64, ini);
    if (*buf) v = float(_wtof(buf));
  };
  auto ri = [&](const wchar_t* k, int& v) { v = int(GetPrivateProfileIntW(L"drift", k, v, ini)); };
  auto rb = [&](const wchar_t* k, bool& v) { v = GetPrivateProfileIntW(L"drift", k, v ? 1 : 0, ini) != 0; };
  ri(L"source", s.source);
  rf(L"reactivity", s.reactivity);
  rf(L"evoSpeed", s.evoSpeed);
  rf(L"mutation", s.mutation);
  rf(L"sceneLen", s.sceneLen);
  rf(L"buildMin", s.buildMin);
  rf(L"complexityCap", s.complexityCap);
  rb(L"freeze", s.freeze);
  rf(L"trails", s.trails);
  rf(L"brightness", s.brightness);
  ri(L"renderScale", s.renderScale);
  rf(L"gripOpacity", s.gripOpacity);
  rb(L"onTop", s.onTop);
  rb(L"docked", s.docked);
  ri(L"panelW", s.panelW);
  readRect(L"floatRect", s.floatRc);
  readRect(L"mainRect", s.mainRc);
  s.source = std::clamp(s.source, 0, 1);
  for (auto& d : kSliders) s.*d.field = std::clamp(s.*d.field, d.lo, d.hi);
  if (s.renderScale != 50 && s.renderScale != 75) s.renderScale = 100;
  s.panelW = std::clamp(s.panelW, 280, 640);
}

void saveSettings() {
  const Settings& s = S();
  const wchar_t* ini = g.iniPath.c_str();
  wchar_t buf[128];
  auto wf = [&](const wchar_t* k, float v) { swprintf(buf, 128, L"%g", v); WritePrivateProfileStringW(L"drift", k, buf, ini); };
  auto wi = [&](const wchar_t* k, int v) { swprintf(buf, 128, L"%d", v); WritePrivateProfileStringW(L"drift", k, buf, ini); };
  auto wr = [&](const wchar_t* k, const RECT& r) {
    swprintf(buf, 128, L"%ld %ld %ld %ld", r.left, r.top, r.right, r.bottom);
    WritePrivateProfileStringW(L"drift", k, buf, ini);
  };
  wi(L"source", s.source);
  wf(L"reactivity", s.reactivity);
  wf(L"evoSpeed", s.evoSpeed);
  wf(L"mutation", s.mutation);
  wf(L"sceneLen", s.sceneLen);
  wf(L"buildMin", s.buildMin);
  wf(L"complexityCap", s.complexityCap);
  wi(L"freeze", s.freeze);
  wf(L"trails", s.trails);
  wf(L"brightness", s.brightness);
  wi(L"renderScale", s.renderScale);
  wf(L"gripOpacity", s.gripOpacity);
  wi(L"onTop", s.onTop);
  wi(L"docked", s.docked);
  wi(L"panelW", s.panelW);
  wr(L"floatRect", s.floatRc);
  wr(L"mainRect", s.mainRc);
}

/* ------------------------------ helpers ------------------------------ */
HICON makeIcon(int size) {
  BITMAPV5HEADER bi = {};
  bi.bV5Size = sizeof bi;
  bi.bV5Width = size;
  bi.bV5Height = -size;
  bi.bV5Planes = 1;
  bi.bV5BitCount = 32;
  bi.bV5Compression = BI_BITFIELDS;
  bi.bV5RedMask = 0x00FF0000; bi.bV5GreenMask = 0x0000FF00; bi.bV5BlueMask = 0x000000FF; bi.bV5AlphaMask = 0xFF000000;
  void* bits = nullptr;
  HDC dc = GetDC(nullptr);
  HBITMAP color = CreateDIBSection(dc, (BITMAPINFO*)&bi, DIB_RGB_COLORS, &bits, nullptr, 0);
  ReleaseDC(nullptr, dc);
  if (!color) return nullptr;
  uint32_t* px = (uint32_t*)bits;
  for (int y = 0; y < size; y++)
    for (int x = 0; x < size; x++) {
      float nx = (x + 0.5f) / size * 2 - 1, ny = (y + 0.5f) / size * 2 - 1;
      float r = std::sqrt(nx * nx + ny * ny), a = std::atan2(ny, nx);
      float t = a / 6.2831853f + r * 1.6f;
      float cr = 0.5f + 0.5f * std::cos(6.2831853f * (t + 0.0f)), cg = 0.5f + 0.5f * std::cos(6.2831853f * (t + 0.33f)),
            cb = 0.5f + 0.5f * std::cos(6.2831853f * (t + 0.67f));
      float glow = 0.35f + 0.65f * (1 - r);
      float alpha = std::clamp((1.f - r) * size * 0.5f, 0.f, 1.f);
      auto c8 = [](float v) { return uint32_t(std::clamp(v, 0.f, 1.f) * 255.f + 0.5f); };
      px[y * size + x] = (c8(alpha) << 24) | (c8(cr * glow) << 16) | (c8(cg * glow) << 8) | c8(cb * glow);
    }
  std::vector<BYTE> zeros(size_t(size) * size / 8 + 16, 0);
  HBITMAP mask = CreateBitmap(size, size, 1, 1, zeros.data());
  ICONINFO ii = { TRUE, 0, 0, mask, color };
  HICON icon = CreateIconIndirect(&ii);
  DeleteObject(mask);
  DeleteObject(color);
  return icon;
}

void makeFonts() {
  if (g.font) DeleteObject(g.font);
  if (g.bold) DeleteObject(g.bold);
  NONCLIENTMETRICSW ncm = { sizeof ncm };
  SystemParametersInfoForDpi(SPI_GETNONCLIENTMETRICS, sizeof ncm, &ncm, 0, g.dpi);
  g.font = CreateFontIndirectW(&ncm.lfMessageFont);
  LOGFONTW lf = ncm.lfMessageFont;
  lf.lfWeight = FW_BOLD;
  lf.lfHeight = MulDiv(lf.lfHeight, 115, 100);
  g.bold = CreateFontIndirectW(&lf);
}

void applyFonts() {
  for (HWND c = GetWindow(g.panel, GW_CHILD); c; c = GetWindow(c, GW_HWNDNEXT)) {
    int id = GetDlgCtrlID(c);
    SendMessageW(c, WM_SETFONT, (WPARAM)(id >= IDC_HEADER && id < IDC_HEADER + 4 ? g.bold : g.font), TRUE);
  }
}

std::wstring formatValue(int i, float v) {
  wchar_t b[32];
  switch (kSliders[i].fmt) {
    case FMT_SEC: swprintf(b, 32, L"%d s", int(std::lround(v))); break;
    case FMT_MIN: swprintf(b, 32, L"%.1f min", v); break;
    case FMT_SIGNED: swprintf(b, 32, L"%+d%%", int(std::lround(v * 100))); break;
    default: swprintf(b, 32, L"%d%%", int(std::lround(v * 100))); break;
  }
  return b;
}

void setTextIfChanged(HWND h, const std::wstring& text) {
  wchar_t cur[1024];
  GetWindowTextW(h, cur, 1024);
  if (text != cur) SetWindowTextW(h, text.c_str());
}

RECT workAreaFor(const RECT& r) {
  MONITORINFO mi = { sizeof mi };
  GetMonitorInfoW(MonitorFromRect(&r, MONITOR_DEFAULTTONEAREST), &mi);
  return mi.rcWork;
}

bool onScreen(const RECT& r) { return r.right > r.left && MonitorFromRect(&r, MONITOR_DEFAULTTONULL) != nullptr; }

void outerSizeFor(int clientW, int clientH, int& w, int& h) {
  RECT r = { 0, 0, clientW, clientH };
  AdjustWindowRectExForDpi(&r, DWORD(GetWindowLongW(g.main, GWL_STYLE)), FALSE, DWORD(GetWindowLongW(g.main, GWL_EXSTYLE)), g.dpi);
  w = r.right - r.left;
  h = r.bottom - r.top;
}

/* ------------------------------ layout ------------------------------ */
void layoutPanel() {
  if (!g.panel || g.inLayout) return;
  g.inLayout = true;
  RECT rc;
  GetClientRect(g.panel, &rc);
  for (int pass = 0; pass < 2; pass++) {
    int m = Px(12), x = m, w = std::max(int(rc.right) - 2 * m, Px(120)), y = Px(6) - g.scrollY;
    auto place = [&](HWND h, int px, int py, int pw, int ph) { SetWindowPos(h, nullptr, px, py, pw, ph, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOREDRAW); };
    int lw = Px(124), vw = Px(56);
    auto header = [&](int i) { y += Px(8); place(g.header[i], x, y, w, Px(22)); y += Px(26); };
    auto slider = [&](int i) {
      place(g.sliderLabel[i], x, y + Px(5), lw, Px(18));
      place(g.slider[i], x + lw, y, w - lw - vw, Px(28));
      place(g.sliderVal[i], x + w - vw, y + Px(5), vw, Px(18));
      y += Px(30);
    };
    auto combo = [&](HWND label, HWND cb) { place(label, x, y + Px(4), lw, Px(18)); place(cb, x + lw, y, w - lw, Px(200)); y += Px(32); };
    auto text = [&](HWND h, int lines) { place(h, x, y, w, Px(17) * lines); y += Px(17) * lines + Px(6); };
    auto check = [&](HWND h) { place(h, x, y, w, Px(22)); y += Px(26); };
    auto two = [&](HWND a, HWND b) {
      int bw = (w - Px(8)) / 2;
      place(a, x, y, bw, Px(30));
      place(b, x + bw + Px(8), y, w - bw - Px(8), Px(30));
      y += Px(36);
    };
    auto one = [&](HWND a) { place(a, x, y, w, Px(30)); y += Px(36); };

    header(0);
    combo(g.sourceLabel, g.source);
    text(g.audioStatus, 1);
    place(g.meter, x, y, w, Px(8));
    y += Px(16);
    slider(0);
    header(1);
    for (int i = 1; i <= 5; i++) slider(i);
    check(g.freeze);
    two(g.mutate, g.species);
    one(g.like);
    text(g.evoStatus, 2);
    text(g.sceneStatus, 4);
    header(2);
    slider(6);
    slider(7);
    combo(g.scaleLabel, g.scale);
    header(3);
    two(g.dock, g.fill);
    {
      int ew = Px(60), xw = Px(18);
      place(g.sizeLabel, x, y + Px(5), lw, Px(18));
      place(g.editW, x + lw, y + Px(1), ew, Px(24));
      place(g.editX, x + lw + ew, y + Px(5), xw, Px(18));
      place(g.editH, x + lw + ew + xw, y + Px(1), ew, Px(24));
      int ax = x + lw + 2 * ew + xw + Px(8);
      place(g.apply, ax, y, std::max(Px(50), x + w - ax), Px(28));
      y += Px(34);
    }
    check(g.onTop);
    slider(8);
    text(g.tips, 6);
    g.contentH = y + g.scrollY + Px(8);

    int maxScroll = std::max(0, g.contentH - int(rc.bottom));
    int clamped = std::clamp(g.scrollY, 0, maxScroll);
    if (clamped == g.scrollY) break;
    g.scrollY = clamped;
  }
  SCROLLINFO si = { sizeof si, SIF_RANGE | SIF_PAGE | SIF_POS, 0, g.contentH - 1, UINT(rc.bottom), g.scrollY, 0 };
  SetScrollInfo(g.panel, SB_VERT, &si, TRUE);
  RedrawWindow(g.panel, nullptr, nullptr, RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN);
  g.inLayout = false;
}

void layoutMain() {
  RECT rc;
  GetClientRect(g.main, &rc);
  int sp = Px(6);
  if (S().docked) {
    int pw = std::min(Px(S().panelW), std::max(Px(200), int(rc.right) - sp - Px(120)));
    MoveWindow(g.panel, 0, 0, pw, rc.bottom, TRUE);
    MoveWindow(g.view, pw + sp, 0, std::max(1, int(rc.right) - pw - sp), rc.bottom, TRUE);
  } else {
    MoveWindow(g.panel, 0, 0, rc.right, rc.bottom, TRUE);
  }
}

bool inSplitter(int x) {
  if (!S().docked) return false;
  RECT pr;
  GetWindowRect(g.panel, &pr);
  int pw = pr.right - pr.left;
  return x >= pw && x < pw + Px(6);
}

/* ------------------------------ dock / undock / fill ------------------------------ */
void applyOnTop() {
  SetWindowPos(g.flt, S().onTop ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

void undock() {
  if (!S().docked) return;
  RECT mr;
  GetWindowRect(g.main, &mr);
  RECT vr;
  GetWindowRect(g.view, &vr);
  RECT fr = S().floatRc;
  if (!onScreen(fr)) {
    // First undock: put the window right where the docked view was.
    fr = vr;
    if (fr.right - fr.left < Px(320)) fr.right = fr.left + Px(960);
    if (fr.bottom - fr.top < Px(200)) fr.bottom = fr.top + Px(540);
  }
  editSettings([&](Settings& s) { s.docked = false; s.mainRc = mr; s.floatRc = fr; });
  ShowWindow(g.view, SW_HIDE);
  SetWindowPos(g.flt, S().onTop ? HWND_TOPMOST : HWND_NOTOPMOST, fr.left, fr.top, fr.right - fr.left, fr.bottom - fr.top,
               SWP_SHOWWINDOW | (g.testRun ? SWP_NOACTIVATE : 0));
  setTarget(g.flt, true);
  // Shrink the settings window to just the settings column.
  int w, h;
  outerSizeFor(Px(S().panelW), 10, w, h);
  SetWindowPos(g.main, nullptr, 0, 0, w, mr.bottom - mr.top, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
  layoutMain();
}

void exitFill() {
  if (!g.filling) return;
  g.filling = false;
  SetWindowPos(g.flt, nullptr, g.preFill.left, g.preFill.top, g.preFill.right - g.preFill.left, g.preFill.bottom - g.preFill.top,
               SWP_NOZORDER | SWP_NOACTIVATE);
}

void dock() {
  if (S().docked) return;
  exitFill();
  RECT fr;
  GetWindowRect(g.flt, &fr);
  RECT mr = S().mainRc;
  RECT cur;
  GetWindowRect(g.main, &cur);
  int w = mr.right - mr.left, h = mr.bottom - mr.top;
  if (w < Px(S().panelW) + Px(300)) { w = Px(S().panelW + 6 + 900); h = cur.bottom - cur.top; }
  editSettings([&](Settings& s) { s.docked = true; s.floatRc = fr; });
  ShowWindow(g.flt, SW_HIDE);
  SetWindowPos(g.main, nullptr, 0, 0, w, h, SWP_NOMOVE | SWP_NOZORDER);
  ShowWindow(g.view, SW_SHOW);
  layoutMain();
  setTarget(g.view, false);
  if (IsIconic(g.main)) ShowWindow(g.main, SW_RESTORE);
}

void toggleDock() { S().docked ? undock() : dock(); }

void toggleFill() {
  if (S().docked) undock();
  if (g.filling) { exitFill(); return; }
  GetWindowRect(g.flt, &g.preFill);
  MONITORINFO mi = { sizeof mi };
  GetMonitorInfoW(MonitorFromWindow(g.flt, MONITOR_DEFAULTTONEAREST), &mi);
  g.filling = true;
  SetWindowPos(g.flt, nullptr, mi.rcMonitor.left, mi.rcMonitor.top, mi.rcMonitor.right - mi.rcMonitor.left,
               mi.rcMonitor.bottom - mi.rcMonitor.top, SWP_NOZORDER);
  SetForegroundWindow(g.flt);
}

void applySize() {
  int w = std::clamp(int(GetDlgItemInt(g.panel, IDC_W, nullptr, FALSE)), 64, 16384);
  int h = std::clamp(int(GetDlgItemInt(g.panel, IDC_H, nullptr, FALSE)), 64, 16384);
  if (S().docked) {
    int ow, oh;
    outerSizeFor(Px(S().panelW) + Px(6) + w, h, ow, oh);
    SetWindowPos(g.main, nullptr, 0, 0, ow, oh, SWP_NOMOVE | SWP_NOZORDER);
  } else {
    g.filling = false;
    SetWindowPos(g.flt, nullptr, 0, 0, w, h, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
  }
}

void doCommand(int cmd) {
  switch (cmd) {
    case CMD_MUTATE: g.sh.mutateReq++; break;
    case CMD_SPECIES: g.sh.speciesReq++; break;
    case CMD_LIKE: g.sh.likeReq++; break;
    case CMD_FREEZE:
      editSettings([](Settings& s) { s.freeze = !s.freeze; });
      Button_SetCheck(g.freeze, S().freeze ? BST_CHECKED : BST_UNCHECKED);
      break;
    case CMD_DOCK: toggleDock(); break;
    case CMD_FILL: toggleFill(); break;
    case CMD_ONTOP:
      editSettings([](Settings& s) { s.onTop = !s.onTop; });
      Button_SetCheck(g.onTop, S().onTop ? BST_CHECKED : BST_UNCHECKED);
      applyOnTop();
      break;
    case CMD_SETTINGS:
      if (IsIconic(g.main)) ShowWindow(g.main, SW_RESTORE);
      SetForegroundWindow(g.main);
      break;
    case CMD_EXIT: PostMessageW(g.main, WM_CLOSE, 0, 0); break;
  }
}

void showMenu(HWND owner, LPARAM lp) {
  POINT pt = { GET_X_LPARAM(lp), GET_Y_LPARAM(lp) };
  if (pt.x == -1 && pt.y == -1) { pt = { 0, 0 }; ClientToScreen(owner, &pt); }
  HMENU m = CreatePopupMenu();
  AppendMenuW(m, MF_STRING, CMD_MUTATE, L"Mutate now\tM");
  AppendMenuW(m, MF_STRING, CMD_SPECIES, L"New species\tN");
  AppendMenuW(m, MF_STRING, CMD_LIKE, L"Keep this look\tL");
  AppendMenuW(m, MF_STRING | (S().freeze ? MF_CHECKED : 0), CMD_FREEZE, L"Freeze evolution\tSpace");
  AppendMenuW(m, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(m, MF_STRING, CMD_DOCK, S().docked ? L"Undock\tD" : L"Dock into settings\tD");
  AppendMenuW(m, MF_STRING | (g.filling ? MF_CHECKED : 0), CMD_FILL, L"Fill screen\tF");
  AppendMenuW(m, MF_STRING | (S().onTop ? MF_CHECKED : 0) | (S().docked ? MF_GRAYED : 0), CMD_ONTOP, L"Always on top");
  AppendMenuW(m, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(m, MF_STRING, CMD_SETTINGS, L"Show settings");
  AppendMenuW(m, MF_STRING, CMD_EXIT, L"Exit");
  int cmd = TrackPopupMenu(m, TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.x, pt.y, 0, owner, nullptr);
  DestroyMenu(m);
  if (cmd) doCommand(cmd);
}

bool vizKey(WPARAM key) {
  switch (key) {
    case 'F': case VK_F11: doCommand(CMD_FILL); return true;
    case VK_ESCAPE: exitFill(); return true;
    case 'D': doCommand(CMD_DOCK); return true;
    case 'M': doCommand(CMD_MUTATE); return true;
    case 'N': doCommand(CMD_SPECIES); return true;
    case 'L': doCommand(CMD_LIKE); return true;
    case VK_SPACE: doCommand(CMD_FREEZE); return true;
  }
  return false;
}

/* ------------------------------ status refresh ------------------------------ */
void refreshStatus() {
  Status st;
  {
    std::lock_guard<std::mutex> l(g.sh.mu);
    st = g.sh.st;
  }
  setTextIfChanged(g.audioStatus, st.error.empty() ? st.audio : st.error);
  setTextIfChanged(g.evoStatus, st.evo);
  setTextIfChanged(g.sceneStatus, st.scene);
  setTextIfChanged(g.like, L"♥  Keep this look (" + std::to_wstring(st.favorites) + L" kept)");
  setTextIfChanged(g.dock, S().docked ? L"Undock visualizer" : L"Dock visualizer");
  setTextIfChanged(g.fill, g.filling ? L"Leave fill screen" : L"Fill screen");
  EnableWindow(g.onTop, !S().docked);
  HWND v = S().docked ? g.view : g.flt;
  RECT rc;
  GetClientRect(v, &rc);
  HWND focus = GetFocus();
  if (focus != g.editW && focus != g.editH) {
    setTextIfChanged(g.editW, std::to_wstring(rc.right));
    setTextIfChanged(g.editH, std::to_wstring(rc.bottom));
  }
}

/* ------------------------------ window procedures ------------------------------ */
HWND mk(const wchar_t* cls, const wchar_t* text, DWORD style, int id, DWORD ex = 0) {
  HWND h = CreateWindowExW(ex, cls, text, WS_CHILD | WS_VISIBLE | style, 0, 0, 10, 10, g.panel, (HMENU)(INT_PTR)id, g.inst, nullptr);
  SendMessageW(h, WM_SETFONT, (WPARAM)g.font, FALSE);
  return h;
}

void createControls() {
  const Settings& s = S();
  for (int i = 0; i < 4; i++) {
    g.header[i] = mk(WC_STATICW, kHeaders[i], SS_LEFT | SS_NOPREFIX, IDC_HEADER + i);
    SendMessageW(g.header[i], WM_SETFONT, (WPARAM)g.bold, FALSE);
  }
  g.sourceLabel = mk(WC_STATICW, L"Listen to", SS_LEFT, IDC_SOURCE_LABEL);
  g.source = mk(WC_COMBOBOXW, L"", CBS_DROPDOWNLIST | WS_VSCROLL | WS_TABSTOP, IDC_SOURCE);
  ComboBox_AddString(g.source, L"What Windows is playing");
  ComboBox_AddString(g.source, L"Demo beat (built in)");
  ComboBox_SetCurSel(g.source, s.source);
  g.audioStatus = mk(WC_STATICW, L"", SS_LEFT | SS_NOPREFIX | SS_ENDELLIPSIS, IDC_AUDIO_STATUS);
  g.meter = mk(PROGRESS_CLASSW, L"", PBS_SMOOTH, IDC_METER);
  SendMessageW(g.meter, PBM_SETRANGE32, 0, 100);
  for (int i = 0; i < kSliderCount; i++) {
    const SliderDef& d = kSliders[i];
    float v = s.*d.field;
    g.sliderLabel[i] = mk(WC_STATICW, d.label, SS_LEFT | SS_NOPREFIX, IDC_SLIDER_LABEL + i);
    g.slider[i] = mk(TRACKBAR_CLASSW, L"", TBS_HORZ | TBS_NOTICKS | WS_TABSTOP, IDC_SLIDER + i);
    SendMessageW(g.slider[i], TBM_SETRANGE, TRUE, MAKELPARAM(0, 1000));
    SendMessageW(g.slider[i], TBM_SETPAGESIZE, 0, 50);
    SendMessageW(g.slider[i], TBM_SETPOS, TRUE, LPARAM(std::lround((v - d.lo) / (d.hi - d.lo) * 1000.f)));
    g.sliderVal[i] = mk(WC_STATICW, formatValue(i, v).c_str(), SS_RIGHT | SS_NOPREFIX, IDC_SLIDER_VALUE + i);
  }
  g.freeze = mk(WC_BUTTONW, L"Freeze evolution (keep the current look)", BS_AUTOCHECKBOX | WS_TABSTOP, IDC_FREEZE);
  Button_SetCheck(g.freeze, s.freeze ? BST_CHECKED : BST_UNCHECKED);
  g.mutate = mk(WC_BUTTONW, L"Mutate now", BS_PUSHBUTTON | WS_TABSTOP, IDC_MUTATE);
  g.species = mk(WC_BUTTONW, L"New species", BS_PUSHBUTTON | WS_TABSTOP, IDC_SPECIES);
  g.like = mk(WC_BUTTONW, L"♥  Keep this look", BS_PUSHBUTTON | WS_TABSTOP, IDC_LIKE);
  g.evoStatus = mk(WC_STATICW, L"", SS_LEFT | SS_NOPREFIX, IDC_EVO_STATUS);
  g.sceneStatus = mk(WC_STATICW, L"", SS_LEFT | SS_NOPREFIX, IDC_SCENE_STATUS);
  g.scaleLabel = mk(WC_STATICW, L"Render resolution", SS_LEFT, IDC_SCALE_LABEL);
  g.scale = mk(WC_COMBOBOXW, L"", CBS_DROPDOWNLIST | WS_VSCROLL | WS_TABSTOP, IDC_SCALE);
  ComboBox_AddString(g.scale, L"50% (fastest)");
  ComboBox_AddString(g.scale, L"75%");
  ComboBox_AddString(g.scale, L"100% (sharpest)");
  ComboBox_SetCurSel(g.scale, s.renderScale == 50 ? 0 : s.renderScale == 75 ? 1 : 2);
  g.dock = mk(WC_BUTTONW, L"Undock visualizer", BS_PUSHBUTTON | WS_TABSTOP, IDC_DOCK);
  g.fill = mk(WC_BUTTONW, L"Fill screen", BS_PUSHBUTTON | WS_TABSTOP, IDC_FILL);
  g.sizeLabel = mk(WC_STATICW, L"Visualizer size", SS_LEFT, IDC_SIZE_LABEL);
  g.editW = mk(WC_EDITW, L"", ES_NUMBER | ES_AUTOHSCROLL | WS_TABSTOP, IDC_W, WS_EX_CLIENTEDGE);
  g.editX = mk(WC_STATICW, L"×", SS_CENTER, IDC_X);
  g.editH = mk(WC_EDITW, L"", ES_NUMBER | ES_AUTOHSCROLL | WS_TABSTOP, IDC_H, WS_EX_CLIENTEDGE);
  g.apply = mk(WC_BUTTONW, L"Apply", BS_PUSHBUTTON | WS_TABSTOP, IDC_APPLY);
  g.onTop = mk(WC_BUTTONW, L"Undocked window stays on top", BS_AUTOCHECKBOX | WS_TABSTOP, IDC_ONTOP);
  Button_SetCheck(g.onTop, s.onTop ? BST_CHECKED : BST_UNCHECKED);
  g.tips = mk(WC_STATICW,
              L"Undocked, the visualizer is a borderless window: drag the faint dot at its top-left to move it, "
              L"drag its edges to resize, double-click the dot to fill the screen. Right-click it for more.\n"
              L"Keys: F fill · Esc leave fill · D dock · M mutate · N new species · L keep · Space freeze",
              SS_LEFT | SS_NOPREFIX, IDC_TIPS);
}

LRESULT CALLBACK panelProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_CREATE:
      g.panel = h;
      createControls();
      SetTimer(h, 1, 250, nullptr);
      SetTimer(h, 2, 50, nullptr);
      return 0;
    case WM_SIZE: layoutPanel(); return 0;
    case WM_TIMER:
      if (wp == 1) refreshStatus();
      else {
        float level;
        {
          std::lock_guard<std::mutex> l(g.sh.mu);
          level = g.sh.st.level;
        }
        SendMessageW(g.meter, PBM_SETPOS, WPARAM(std::lround(level * 100.f)), 0);
      }
      return 0;
    case WM_HSCROLL: {
      int id = GetDlgCtrlID((HWND)lp) - IDC_SLIDER;
      if (id >= 0 && id < kSliderCount) {
        const SliderDef& d = kSliders[id];
        float v = d.lo + (d.hi - d.lo) * float(SendMessageW((HWND)lp, TBM_GETPOS, 0, 0)) / 1000.f;
        editSettings([&](Settings& s) { s.*d.field = v; });
        SetWindowTextW(g.sliderVal[id], formatValue(id, v).c_str());
      }
      return 0;
    }
    case WM_VSCROLL: {
      SCROLLINFO si = { sizeof si, SIF_ALL };
      GetScrollInfo(h, SB_VERT, &si);
      int y = si.nPos;
      switch (LOWORD(wp)) {
        case SB_LINEUP: y -= Px(30); break;
        case SB_LINEDOWN: y += Px(30); break;
        case SB_PAGEUP: y -= int(si.nPage); break;
        case SB_PAGEDOWN: y += int(si.nPage); break;
        case SB_THUMBTRACK: case SB_THUMBPOSITION: y = si.nTrackPos; break;
        case SB_TOP: y = 0; break;
        case SB_BOTTOM: y = si.nMax; break;
      }
      g.scrollY = y;
      layoutPanel();
      return 0;
    }
    case WM_MOUSEWHEEL:
      g.scrollY -= GET_WHEEL_DELTA_WPARAM(wp) * Px(60) / WHEEL_DELTA;
      layoutPanel();
      return 0;
    case WM_COMMAND: {
      int id = LOWORD(wp), code = HIWORD(wp);
      if (id == IDC_SOURCE && code == CBN_SELCHANGE) {
        int sel = ComboBox_GetCurSel(g.source);
        editSettings([&](Settings& s) { s.source = sel; });
      } else if (id == IDC_SCALE && code == CBN_SELCHANGE) {
        int sel = std::clamp(ComboBox_GetCurSel(g.scale), 0, 2);
        editSettings([&](Settings& s) { s.renderScale = kScales[sel]; });
      } else if (code == BN_CLICKED) {
        switch (id) {
          case IDC_FREEZE: { bool on = Button_GetCheck(g.freeze) == BST_CHECKED; editSettings([&](Settings& s) { s.freeze = on; }); break; }
          case IDC_ONTOP: { bool on = Button_GetCheck(g.onTop) == BST_CHECKED; editSettings([&](Settings& s) { s.onTop = on; }); applyOnTop(); break; }
          case IDC_MUTATE: doCommand(CMD_MUTATE); break;
          case IDC_SPECIES: doCommand(CMD_SPECIES); break;
          case IDC_LIKE: doCommand(CMD_LIKE); break;
          case IDC_DOCK: doCommand(CMD_DOCK); break;
          case IDC_FILL: doCommand(CMD_FILL); break;
          case IDC_APPLY: applySize(); break;
        }
      }
      return 0;
    }
  }
  return DefWindowProcW(h, msg, wp, lp);
}

// The docked visualizer: a plain child window the render thread draws into.
LRESULT CALLBACK viewProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: ValidateRect(h, nullptr); return 0;
    case WM_LBUTTONDOWN: SetFocus(h); return 0;
    case WM_LBUTTONDBLCLK: doCommand(CMD_DOCK); return 0;
    case WM_CONTEXTMENU: showMenu(h, lp); return 0;
    case WM_KEYDOWN: if (vizKey(wp)) return 0; break;
  }
  return DefWindowProcW(h, msg, wp, lp);
}

// The undocked visualizer: borderless; the grip dot moves it, the edges resize it.
LRESULT CALLBACK floatProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: ValidateRect(h, nullptr); return 0;
    case WM_NCHITTEST: {
      POINT pt = { GET_X_LPARAM(lp), GET_Y_LPARAM(lp) };
      ScreenToClient(h, &pt);
      RECT rc;
      GetClientRect(h, &rc);
      float k = GetDpiForWindow(h) / 96.f, gx = GRIP_X * k, hit = GRIP_HIT * k;
      float dx = pt.x - gx, dy = pt.y - gx;
      if (dx * dx + dy * dy <= hit * hit) return HTCAPTION;
      if (!g.filling) {
        int b = std::max(4, int(6 * k));
        bool l = pt.x < b, r = pt.x >= rc.right - b, t = pt.y < b, bt = pt.y >= rc.bottom - b;
        if (t && l) return HTTOPLEFT;
        if (t && r) return HTTOPRIGHT;
        if (bt && l) return HTBOTTOMLEFT;
        if (bt && r) return HTBOTTOMRIGHT;
        if (l) return HTLEFT;
        if (r) return HTRIGHT;
        if (t) return HTTOP;
        if (bt) return HTBOTTOM;
      }
      return HTCLIENT;
    }
    case WM_NCLBUTTONDBLCLK:
      if (wp == HTCAPTION) { toggleFill(); return 0; }
      break;
    case WM_EXITSIZEMOVE:
      if (g.filling) {
        // Dragged or resized away from the full-monitor rectangle: no longer filling.
        RECT r;
        GetWindowRect(h, &r);
        MONITORINFO mi = { sizeof mi };
        GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mi);
        if (!EqualRect(&r, &mi.rcMonitor)) g.filling = false;
      }
      return 0;
    case WM_GETMINMAXINFO: {
      auto* mm = (MINMAXINFO*)lp;
      mm->ptMinTrackSize = { 64, 64 };
      return 0;
    }
    case WM_DPICHANGED: {
      RECT* r = (RECT*)lp;
      SetWindowPos(h, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
      return 0;
    }
    case WM_CONTEXTMENU: showMenu(h, lp); return 0;
    case WM_KEYDOWN: if (vizKey(wp)) return 0; break;
    case WM_SYSCOMMAND:
      if ((wp & 0xFFF0) == SC_MAXIMIZE) { toggleFill(); return 0; }
      break;
    case WM_CLOSE: dock(); return 0;
  }
  return DefWindowProcW(h, msg, wp, lp);
}

void stopRenderThread() {
  g.sh.quit = true;
  if (!g.rt.joinable()) return;
  HANDLE th = g.rt.native_handle();
  // Keep pumping messages while waiting so the render thread can never block on us.
  while (MsgWaitForMultipleObjects(1, &th, FALSE, INFINITE, QS_ALLINPUT) == WAIT_OBJECT_0 + 1) {
    MSG m;
    while (PeekMessageW(&m, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&m); DispatchMessageW(&m); }
  }
  g.rt.join();
}

LRESULT CALLBACK mainProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_SIZE: layoutMain(); return 0;
    case WM_GETMINMAXINFO: {
      if (!g.panel) break;
      auto* mm = (MINMAXINFO*)lp;
      int w, hh;
      outerSizeFor(S().docked ? Px(S().panelW) + Px(6) + Px(160) : Px(260), Px(320), w, hh);
      mm->ptMinTrackSize = { w, hh };
      return 0;
    }
    case WM_SETCURSOR:
      if (LOWORD(lp) == HTCLIENT) {
        POINT pt;
        GetCursorPos(&pt);
        ScreenToClient(h, &pt);
        if (inSplitter(pt.x)) { SetCursor(LoadCursorW(nullptr, IDC_SIZEWE)); return TRUE; }
      }
      break;
    case WM_LBUTTONDOWN:
      if (inSplitter(GET_X_LPARAM(lp))) { g.splitDrag = true; SetCapture(h); }
      return 0;
    case WM_MOUSEMOVE:
      if (g.splitDrag) {
        RECT rc;
        GetClientRect(h, &rc);
        int x = std::clamp(int(GET_X_LPARAM(lp)), Px(280), std::max(Px(280), int(rc.right) - Px(166)));
        int w96 = std::clamp(MulDiv(x, 96, int(g.dpi)), 280, 640);
        editSettings([&](Settings& s) { s.panelW = w96; });
        layoutMain();
      }
      return 0;
    case WM_LBUTTONUP:
    case WM_CAPTURECHANGED:
      if (g.splitDrag) { g.splitDrag = false; if (msg == WM_LBUTTONUP) ReleaseCapture(); }
      return 0;
    case WM_DPICHANGED: {
      g.dpi = HIWORD(wp);
      makeFonts();
      applyFonts();
      RECT* r = (RECT*)lp;
      SetWindowPos(h, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
      layoutMain();
      layoutPanel();
      return 0;
    }
    case WM_APP_SHOTS_DONE:
      g.noSave = true;
      PostMessageW(h, WM_CLOSE, 0, 0);
      return 0;
    case WM_CLOSE: {
      if (g.closing) return 0;
      g.closing = true;
      stopRenderThread();
      if (!g.noSave) {
        RECT r;
        if (S().docked) { GetWindowRect(h, &r); S().mainRc = r; }
        else if (!g.filling) { GetWindowRect(g.flt, &r); S().floatRc = r; }
        else S().floatRc = g.preFill;
        saveSettings();
      }
      DestroyWindow(g.flt);
      DestroyWindow(h);
      return 0;
    }
    case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(h, msg, wp, lp);
}

std::wstring appDataDir() {
  PWSTR p = nullptr;
  std::wstring dir;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &p))) dir = std::wstring(p) + L"\\DriftViz";
  CoTaskMemFree(p);
  if (!dir.empty()) CreateDirectoryW(dir.c_str(), nullptr);
  return dir;
}
}  // namespace

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int show) {
  g.inst = inst;
  INITCOMMONCONTROLSEX icc = { sizeof icc, ICC_BAR_CLASSES | ICC_STANDARD_CLASSES | ICC_PROGRESS_CLASS };
  InitCommonControlsEx(&icc);

  std::wstring dir = appDataDir();
  g.iniPath = dir + L"\\settings.ini";
  g.sh.favPath = dir + L"\\favorites.txt";
  loadSettings();

  // Command line (mostly for testing): --demo --undocked --size WxH --evo-scale K
  // --shot file.png [--shots N] [--after S] [--every S] --no-save
  bool startUndocked = false;
  int sizeW = 0, sizeH = 0;
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  for (int i = 1; i < argc; i++) {
    std::wstring a = argv[i];
    auto next = [&]() -> std::wstring { return i + 1 < argc ? argv[++i] : L""; };
    if (a == L"--demo") editSettings([](Settings& s) { s.source = 1; });
    else if (a == L"--undocked") startUndocked = true;
    else if (a == L"--docked") editSettings([](Settings& s) { s.docked = true; });
    else if (a == L"--no-save") g.noSave = true;
    else if (a == L"--evo-scale") g.sh.evoScale = std::clamp(float(_wtof(next().c_str())), 0.1f, 100.f);
    else if (a == L"--shot") { g.sh.shotPath = next(); if (!g.sh.shotCount) g.sh.shotCount = 1; g.noSave = true; }
    else if (a == L"--shots") g.sh.shotCount = std::max(1, _wtoi(next().c_str()));
    else if (a == L"--after") g.sh.shotAfter = float(_wtof(next().c_str()));
    else if (a == L"--every") g.sh.shotEvery = float(_wtof(next().c_str()));
    else if (a == L"--size") swscanf(next().c_str(), L"%dx%d", &sizeW, &sizeH);
    else if (a == L"--log") g.sh.logPath = next();
  }
  LocalFree(argv);
  bool testRun = g.testRun = !g.sh.shotPath.empty();
  bool wantUndocked = startUndocked || !S().docked;
  S().docked = true;   // start docked, then undock below if needed

  g.iconBig = makeIcon(32);
  g.iconSmall = makeIcon(16);
  WNDCLASSEXW wc = { sizeof wc };
  wc.hInstance = inst;
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.hIcon = g.iconBig;
  wc.hIconSm = g.iconSmall;
  wc.lpfnWndProc = mainProc;
  wc.hbrBackground = GetSysColorBrush(COLOR_3DSHADOW);
  wc.lpszClassName = L"DriftMain";
  RegisterClassExW(&wc);
  wc.lpfnWndProc = panelProc;
  wc.hbrBackground = GetSysColorBrush(COLOR_BTNFACE);
  wc.lpszClassName = L"DriftPanel";
  RegisterClassExW(&wc);
  wc.style = CS_DBLCLKS;
  wc.lpfnWndProc = viewProc;
  wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
  wc.lpszClassName = L"DriftView";
  RegisterClassExW(&wc);
  wc.lpfnWndProc = floatProc;
  wc.lpszClassName = L"DriftFloat";
  RegisterClassExW(&wc);

  g.main = CreateWindowExW(0, L"DriftMain", L"Drift — settings", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, CW_USEDEFAULT, CW_USEDEFAULT,
                           1280, 760, nullptr, nullptr, inst, nullptr);
  g.dpi = GetDpiForWindow(g.main);
  makeFonts();
  // Size and place the settings window.
  {
    RECT r = S().mainRc;
    if (!onScreen(r) || r.right - r.left < Px(S().panelW) + Px(300)) {
      RECT wa = workAreaFor(RECT{ 0, 0, 100, 100 });
      int w = std::min(Px(S().panelW + 6 + 960), int(wa.right - wa.left)), h = std::min(Px(720), int(wa.bottom - wa.top));
      r = { wa.left + (wa.right - wa.left - w) / 2, wa.top + (wa.bottom - wa.top - h) / 2, 0, 0 };
      r.right = r.left + w;
      r.bottom = r.top + h;
    }
    SetWindowPos(g.main, nullptr, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOZORDER | SWP_NOACTIVATE);
  }
  CreateWindowExW(WS_EX_CONTROLPARENT, L"DriftPanel", L"", WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_VSCROLL, 0, 0, 10, 10, g.main,
                  nullptr, inst, nullptr);
  g.view = CreateWindowExW(0, L"DriftView", L"", WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS, 0, 0, 10, 10, g.main, nullptr, inst, nullptr);
  g.flt = CreateWindowExW(WS_EX_APPWINDOW, L"DriftFloat", L"Drift", WS_POPUP, 0, 0, 960, 540, nullptr, nullptr, inst, nullptr);
  layoutMain();
  layoutPanel();
  if (sizeW > 0 && sizeH > 0) {
    int ow, oh;
    outerSizeFor(Px(S().panelW) + Px(6) + sizeW, sizeH, ow, oh);
    SetWindowPos(g.main, nullptr, 0, 0, ow, oh, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
  }
  setTarget(g.view, false);
  g.sh.notify = g.main;
  ShowWindow(g.main, testRun ? SW_SHOWNOACTIVATE : show);
  UpdateWindow(g.main);
  if (wantUndocked) {
    undock();
    if (sizeW > 0 && sizeH > 0) SetWindowPos(g.flt, nullptr, 0, 0, sizeW, sizeH, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
  }
  refreshStatus();
  g.rt = std::thread(renderThread, &g.sh);

  MSG m;
  while (GetMessageW(&m, nullptr, 0, 0) > 0) {
    TranslateMessage(&m);
    DispatchMessageW(&m);
  }
  if (g.rt.joinable()) { g.sh.quit = true; g.rt.join(); }
  return 0;
}
