#pragma once
#include "app.h"
#include <thread>

constexpr int WAVE_N = 512;
constexpr int SPEC_N = 128;

struct AudioFrame {
  float wave[WAVE_N] = {};   // newest waveform, zero-crossing aligned, auto-scaled to about -1..1
  float spec[SPEC_N] = {};   // log-spaced bands 30 Hz..16 kHz, 0..1, auto-gained
  float level = 0;           // 0..1 loudness, auto-gained
  float dbfs = -180;         // raw loudness of the last 10 ms, dB full scale
  float bass = 1, mid = 1, treb = 1;  // energy relative to the last few seconds (1 = normal)
  int beats = 0;             // goes up by one on every detected beat
  int sections = 0;          // goes up by one when the music changes character (drop, breakdown...)
  float novelty = 0;         // dB difference between the last ~0.5 s and the last ~8 s
  // Musical events. Each counter goes up by one when the event is heard.
  int drops = 0;             // the bass comes back after a lull
  int builds = 0;            // level and treble climb together for a few seconds
  int breaks = 0;            // a sudden drop in level that isn't silence
  int toneShifts = 0;        // the spectral centre of mass moves (darker / brighter)
  int hatRushes = 0;         // treble onsets suddenly get much more frequent
  int vocals = 0;            // the mid band (voice, lead) suddenly takes a bigger share
  int tempoChanges = 0;      // the beat interval settles on a new value
  int hits = 0;              // a beat far louder than the recent ones
  // Continuous features, 0..1, used to steer the drift.
  float bright = 0;          // spectral centroid on a log-frequency scale
  float beatDensity = 0;     // beats per second, 3/s = 1
  float bpm = 0;             // 0 = not locked yet
  bool silent = true;        // nothing audible for about 2 seconds
  bool demo = false;
  std::wstring device;
};

// Analysis knobs from the excessive options.
struct AudioParams {
  float beatSens = 1, beatGap = 0.18f, sectionDb = 5, sectionCool = 6, eventSens = 1, silenceDb = -80;
  float specFall = 0.5f, specRange = 48;
};

// Captures what Windows is playing (WASAPI loopback) or plays a built-in demo beat,
// and analyses it 100 times a second on its own thread.
class Audio {
public:
  void start();
  void stop();
  void setDemo(bool d) { wantDemo = d; }
  void setParams(const AudioParams& p) { std::lock_guard<std::mutex> l(mu); params = p; }
  void get(AudioFrame& out);
private:
  void run();
  std::thread th;
  std::atomic<bool> quit{ false }, wantDemo{ false };
  std::mutex mu;
  AudioFrame latest;
  AudioParams params;
};
