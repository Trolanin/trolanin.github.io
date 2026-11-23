# Public projects (repo trolanin.github.io)

This repo is **public** and is the owner's GitHub Pages site: every push to `main` goes live at
https://trolanin.github.io/ within about a minute. Each project is a subfolder, served at
`/<folder>/`. `index.html` and `README.md` list the projects; update both when adding one.

## Ground rules
- Every project README starts with the owner's disclaimer: "⚠️ **Heads up:** this is AI vibe-coded (built with Claude) by a dumbass who has no idea what he's doing. Use at your own risk; no warranty, no promises." Add it to any new project or repo.
- Anything committed here is public. Never add secrets, personal data, or other people's
  copyrighted material.
- Projects are private by default. Only add a project here after the owner has said it should be
  public. Ask before moving or adding projects, or otherwise restructuring.
- On the owner's PC this repo is the `public` folder inside their private projects folder (whose
  repo ignores it). Commit and push finished work so the other machine can pull it.

## led-sim: ESP32 LED simulator + audio-reactive designer
Browser tools, no build step: `designer.html` (design → generated FastLED .ino) and `index.html`
(simulator). See `led-sim/README.md`.
- Arduino C++ is transpiled to JS (`transpiler.js`) and run in a Web Worker (`runtime.js`).
- `designer-gen.js` generates the sketch; the design JSON rides in its `// LEDDESIGN` line.
- Tests: `test.html`, `test2.html` and `designer-test.html` print PASS/FAIL in the page and must
  stay ALL PASSED. On the owner's PC `cdp.ps1` drives headless Edge (`-Page` takes a file or a full
  URL); elsewhere use any headless Chromium.
- Generated code must compile clean for a real ESP32. That only works on the owner's PC:
  arduino-cli in `D:\Claude Misc\arduino` (ESP32 core 3.3.12, FastLED 3.10.9, FQBN
  `esp32:esp32:esp32`), and `flash.ps1` uploads.
- `led-audio.exe` (`led-audio.cpp`, Windows WASAPI loopback, built with `build.bat`/MSVC) streams
  19-byte audio frames to ws://localhost:8000 and/or a COM port.
- `android/` is the LED Audio app (Java, Android 10+). It is the phone version of led-audio.exe: it captures
  other apps' playback and serves the same frames on ws://127.0.0.1:8000. `Analyzer.java` must stay in step
  with the analysis in `led-audio.cpp`. To build it, run `android\build-apk.ps1` on the owner's PC. It uses the
  plain SDK tools, no Gradle, and writes `led-audio.apk` (which is committed so the site can serve it). Use no
  lambdas: the build compiles against android.jar, which can't support them. The signing key stays out of this
  repo. `android.html` is the install page.
- The owner prefers native C++ tooling. Ask before switching languages or stacks to avoid an install.

## drift-viz: Windows music visualizer (native C++)
Win32 + Direct3D 11 + WASAPI loopback, no frameworks. `index.html` is the download page; `drift-viz.exe`
is committed so the site can serve it. Rebuild it and recommit it after every source change. See `drift-viz/README.md`.
- Build: `cmd /c "D:\Projects\public\drift-viz\build.bat"` from PowerShell. It needs VS 2022 Build Tools. It runs fxc to
  compile the shaders into `build\*.h`, then rc and cl. The `build\` folder is ignored by git.
- `src/params.h` holds the shader parameter slots and is shared by HLSL and C++. Add new slots there, never as raw numbers.
- Threads:
  - The UI thread runs `main.cpp`.
  - The render thread (`render.cpp`) fetches audio, runs the evolution, then renders and presents.
  - The audio thread (`audio.cpp`) analyses at 100 Hz.
  - They share the `Shared` struct (`app.h`), guarded by its mutex plus atomics.
- `evolve.cpp` is the progressive engine:
  - Genes do a damped random walk inside complexity-dependent ranges, and layers unlock at gates.
  - Scenes mutate on section changes or when the scene timer runs out. A new species starts after 4 s of silence.
  - `Visuals::build` maps genes and audio to `P[]`. It includes the brightness control fed by `Gpu::meanLum`
    (an average from a 1x1 mip, read back a few frames late).
- Test hooks: `--demo --docked/--undocked --size WxH --evo-scale K --shot f.png --shots N --after S --every S --log path`.
  `--shot` runs headless-ish (no focus steal, no settings save). Check visuals with a contact sheet of the `--shots` output.
  On the owner's PC the display scale is 250%, so UI automation must call `SetThreadDpiAwarenessContext(-4)`.
- Frame pacing: a waitable swap chain with max latency 1, plus a cap at the monitor refresh rate. Without them the flip model
  ran at more than 6000 fps on this PC.
