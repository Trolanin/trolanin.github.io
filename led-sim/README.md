# LED Strip Simulator

Browser simulator for ESP32 addressable-LED sketches (FastLED / Adafruit_NeoPixel), with a 60-LED strip, ring or matrix view and real WS2812 timing.

## Quick start

Open `index.html` in Edge or Chrome (no server needed), paste a sketch, press **Run**.

Live online: <https://trolanin.github.io/led-sim/designer.html> (designer) and <https://trolanin.github.io/led-sim/> (simulator). For live music, run `led-audio.exe` on the same PC as the browser; if the browser asks to allow access to devices on your local network, allow it.

## Music-reactive LEDs

`led-audio.exe` captures whatever Windows is playing (WASAPI loopback — no microphone or virtual cable) and turns it into a 19-byte frame every 10 ms:

| byte | meaning |
|------|---------|
| 0 | `0xFF` start marker (data bytes never reach 255) |
| 1 | overall level, 0–254 |
| 2 | beat counter — changes on every detected beat |
| 3–18 | 16 bands, bass → treble (40 Hz – 16 kHz, log spaced), 0–254 |

The frames are fed into the sketch's `Serial` input, the same way a real ESP32 receives them over USB, so a sketch tested here runs unchanged on hardware. See the **Audio spectrum** example.

```
led-audio.exe                    # feed the simulator (ws://localhost:8000)
led-audio.exe --port COM5        # also feed a real ESP32 on COM5
led-audio.exe --port COM5 --no-ws --baud 921600
```

Close the Arduino serial monitor first — only one program can hold the COM port. Latency from sound to frame is about 15–25 ms (10 ms frame interval + ~21 ms analysis window, centred), plus the WS2812 refresh.

## Audio designer

`designer.html` builds a music-reactive sketch without writing code:

- **Layers**, stacked and added together. Each picks **what it reacts to** (a frequency range, overall loudness, or beats), **how it responds** (noise gate, gain, curve, attack, release), an **effect** (pulse, VU meter, spectrum, ripples, sparkles, scrolling history, comet, fire), **colour** (solid, gradient, by loudness, rainbow, palette) and **where on the strip** (start, length, mirror, reverse).
- **Strip & board**: LED count, pin, chip, colour order, brightness, power limit, frame rate, trails, colour drift, idle look, baud.
- The preview runs the exact generated sketch. "What the lights hear" shows the incoming bands and what the selected layer gets after its response settings. Drag across its bars to choose the selected layer's frequencies, drag the red line to set its noise gate, or click level / beat to follow those instead.
- Every slider has a number box for exact values; typed values may go beyond the slider's range (e.g. gain up to 16×).
- **Colour change** steps or flows through a palette with the music. **Custom palettes** of 1–16 colours are picked on a colour wheel (or by hex, "Fill from" a built-in, Gradient, 🎲); any effect in Palette mode can use them.
- **Brightness pattern**: draw up to 16 brightness levels that step on beats, flow, or follow loudness — as its own effect (**Intensity pattern**) or switched on for any layer.
- **Palette change** picks a palette to match the mood: each palette has BPM / bass / treble / loudness ranges, and the first one that matches the music wins. The live readings are shown next to each range. BPM is estimated from detected beats, so it can read double or half the real tempo.
- **🎲** on each layer re-rolls its settings; its **▾** menu chooses which groups it may change and has an Enabled/Disabled safeguard.
- **Solo** on a layer previews that layer alone (a banner says so); the downloaded sketch always contains every enabled layer.
- **Undo / Redo** (Ctrl+Z / Ctrl+Shift+Z) cover every design edit, including deleting a layer or loading a preset. Double-click a slider to reset it; hover a dotted-underlined label for an explanation.
- No music handy? Audio → Test beat feeds a synthetic 120 BPM groove.
- **Download .ino** gives a plain FastLED sketch for the ESP32. The design is stored in its `LEDDESIGN` comment line, so **Import…** brings it back for editing. `designer-test.html` checks that every effect/colour combination compiles and animates.

## Flashing the ESP32

Drag a downloaded .ino onto `flash.bat` (or `flash.bat my_design.ino COM5`). It compiles with arduino-cli, finds the ESP32's port, stops led-audio.exe (it holds the port), uploads, then restarts `led-audio.exe --port <that port>` so the board gets audio.

The toolchain lives in `D:\Claude Misc\arduino` (arduino-cli, ESP32 core 3.3.12, FastLED 3.10.9; config in `arduino-cli.yaml` there). Board: `esp32:esp32:esp32` (ESP32 Dev Module); pass `-Fqbn` to `flash.ps1` for others, e.g. `esp32:esp32:esp32s3`.

## Layout shapes

The preview can show the LEDs as a straight strip, circle, square, triangle, hexagon, star, heart or serpentine matrix. Outline shapes space the LEDs evenly along the outline, starting at the top and running clockwise.

### Rebuilding led-audio.exe

Needs Visual Studio 2022 Build Tools with the C++ workload (installed). Run `build.bat`.

## Testing

`test.html` and `test2.html` are self-tests; open them and they print PASS/FAIL. `cdp.ps1` drives headless Edge for automated checks.

## Files

- `transpiler.js` — Arduino C++ → JavaScript
- `runtime.js` — Arduino core, FastLED, NeoPixel, Serial on a virtual clock (runs in a Web Worker)
- `app.js`, `index.html` — UI; relays led-audio frames to the sketch's Serial input
- `examples.js` — example sketches
- `led-audio.cpp`, `build.bat` — PC-side audio capture
- `designer.html`, `designer.js`, `designer-gen.js` — audio designer UI and sketch generator
