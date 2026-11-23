#pragma once
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <atomic>
#include <mutex>
#include <string>
#include "options.h"

// Everything the settings window can change. The UI thread writes it (under Shared::mu);
// the render thread copies it once per frame.
struct Settings {
  Settings() { optDefaults(x, xi); }
  float x[XF_COUNT];            // excessive options, sliders (see options.h)
  int xi[XI_COUNT];             // excessive options, drop-downs
  bool excessive = false;       // show them in the settings window
  int source = 0;               // 0 = what Windows is playing, 1 = built-in demo beat
  float reactivity = 1.0f;      // how hard the music pushes the motion
  float evoSpeed = 1.0f;        // drift speed and small-mutation rate
  float mutation = 0.5f;        // how much a scene change alters
  float sceneLen = 30.0f;       // longest a scene lasts, seconds
  float buildMin = 3.0f;        // minutes of music to reach full complexity
  float complexityCap = 1.0f;
  bool freeze = false;
  float trails = 0.0f;          // -1..1, added to the feedback decay
  float brightness = 1.0f;
  int renderScale = 100;        // internal resolution, % of the window
  float gripOpacity = 0.2f;
  bool onTop = false;
  bool docked = true;
  RECT floatRc = { 0, 0, 0, 0 }; // undocked window (0 = pick a spot)
  RECT mainRc = { 0, 0, 0, 0 };  // settings window while docked (0 = default)
  int panelW = 340;             // settings column width, 96-dpi pixels
};

struct Status {
  std::wstring audio, evo, scene, error, heard;
  float level = 0;
  int favorites = 0;
};

struct Shared {
  std::mutex mu;
  Settings s;
  HWND target = nullptr;        // window the visualizer draws into
  bool targetFloating = false;  // true = the undocked window (draws the grip dot)
  Status st;
  std::atomic<bool> quit{ false };
  std::atomic<int> mutateReq{ 0 }, speciesReq{ 0 }, likeReq{ 0 };
  std::wstring favPath;
  // test hooks (command line)
  float evoScale = 1.0f;
  std::wstring shotPath;
  int shotCount = 0;
  float shotAfter = 3.0f, shotEvery = 3.0f;
  HWND notify = nullptr;
  std::wstring logPath;
};

#define WM_APP_SHOTS_DONE (WM_APP + 1)

// Grip dot on the undocked window, in 96-dpi pixels (its radius is the "Grip dot size" option).
constexpr float GRIP_X = 12.0f, GRIP_HIT = 14.0f;
inline float gripHit(float radius) { return radius * 3.f > GRIP_HIT ? radius * 3.f : GRIP_HIT; }

void renderThread(Shared* sh);
