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
