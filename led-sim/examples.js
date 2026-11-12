/* Example sketches for the LED simulator. Plain Arduino C++ — they should
   compile unchanged for a real ESP32 with FastLED / Adafruit_NeoPixel installed. */
window.LED_EXAMPLES = [
{
  name: 'Demo reel (FastLED)',
  layout: 'strip',
  code: `#include <FastLED.h>

#define DATA_PIN    5
#define LED_TYPE    WS2812B
#define COLOR_ORDER GRB
#define NUM_LEDS    60
#define BRIGHTNESS  160
#define FRAMES_PER_SECOND 120

CRGB leds[NUM_LEDS];

void rainbow();
void rainbowGlitter();
void confetti();
void sweep();
void juggle();
void pulse();

// A table of pattern functions; loop() calls whichever one is current.
typedef void (*PatternFn)();
PatternFn patterns[] = { rainbow, rainbowGlitter, confetti, sweep, juggle, pulse };
const char* names[] = { "rainbow", "rainbow + glitter", "confetti", "sweep", "juggle", "pulse" };

uint8_t current = 0;   // index into patterns[]
uint8_t hue = 0;       // slowly rotating base colour

void setup() {
  Serial.begin(115200);
  FastLED.addLeds<LED_TYPE, DATA_PIN, COLOR_ORDER>(leds, NUM_LEDS).setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(BRIGHTNESS);
  Serial.println("Demo reel started");
}

void loop() {
  patterns[current]();
  FastLED.show();
  FastLED.delay(1000 / FRAMES_PER_SECOND);

  EVERY_N_MILLISECONDS(20) { hue++; }
  EVERY_N_SECONDS(8) { nextPattern(); }
}

void nextPattern() {
  current = (current + 1) % ARRAY_SIZE(patterns);
  Serial.print("Pattern: ");
  Serial.println(names[current]);
}

void rainbow() {
  fill_rainbow(leds, NUM_LEDS, hue, 7);
}

void addGlitter(uint8_t chance) {
  if (random8() < chance) {
    leds[random16(NUM_LEDS)] += CRGB::White;
  }
}

void rainbowGlitter() {
  rainbow();
  addGlitter(80);
}

void confetti() {
  fadeToBlackBy(leds, NUM_LEDS, 10);
  int pos = random16(NUM_LEDS);
  leds[pos] += CHSV(hue + random8(64), 200, 255);
}

void sweep() {
  fadeToBlackBy(leds, NUM_LEDS, 20);
  int pos = beatsin16(13, 0, NUM_LEDS - 1);
  leds[pos] += CHSV(hue, 255, 192);
}

void juggle() {
  fadeToBlackBy(leds, NUM_LEDS, 20);
  uint8_t dotHue = 0;
  for (int i = 0; i < 8; i++) {
    leds[beatsin16(i + 7, 0, NUM_LEDS - 1)] |= CHSV(dotHue, 200, 255);
    dotHue += 32;
  }
}

void pulse() {
  uint8_t beat = beatsin8(62, 64, 255);
  CRGBPalette16 palette = PartyColors_p;
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i] = ColorFromPalette(palette, hue + (i * 2), beat - hue + (i * 10));
  }
}
`,
},
{
  name: 'Strand test (Adafruit NeoPixel)',
  layout: 'strip',
  code: `#include <Adafruit_NeoPixel.h>

#define LED_PIN    5
#define LED_COUNT 60

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

void setup() {
  strip.begin();
  strip.show();              // all pixels off
  strip.setBrightness(120);
}

void loop() {
  colorWipe(strip.Color(255,   0,   0), 15);   // red
  colorWipe(strip.Color(  0, 255,   0), 15);   // green
  colorWipe(strip.Color(  0,   0, 255), 15);   // blue

  theaterChase(strip.Color(127, 127, 127), 60);
  theaterChase(strip.Color(127,   0,   0), 60);

  rainbowCycle(4);
  theaterChaseRainbow(60);
}

// Fill the strip one pixel at a time.
void colorWipe(uint32_t color, int wait) {
  for (int i = 0; i < strip.numPixels(); i++) {
    strip.setPixelColor(i, color);
    strip.show();
    delay(wait);
  }
}

// Marquee-style chasing lights.
void theaterChase(uint32_t color, int wait) {
  for (int a = 0; a < 10; a++) {
    for (int b = 0; b < 3; b++) {
      strip.clear();
      for (int c = b; c < strip.numPixels(); c += 3) {
        strip.setPixelColor(c, color);
      }
      strip.show();
      delay(wait);
    }
  }
}

// Rainbow spread across the whole strip, scrolling.
void rainbowCycle(int wait) {
  for (long firstPixelHue = 0; firstPixelHue < 3 * 65536; firstPixelHue += 256) {
    for (int i = 0; i < strip.numPixels(); i++) {
      int pixelHue = firstPixelHue + (i * 65536L / strip.numPixels());
      strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(pixelHue)));
    }
    strip.show();
    delay(wait);
  }
}

void theaterChaseRainbow(int wait) {
  int firstPixelHue = 0;
  for (int a = 0; a < 30; a++) {
    for (int b = 0; b < 3; b++) {
      strip.clear();
      for (int c = b; c < strip.numPixels(); c += 3) {
        int      hue   = firstPixelHue + c * 65536L / strip.numPixels();
        uint32_t color = strip.gamma32(strip.ColorHSV(hue));
        strip.setPixelColor(c, color);
      }
      strip.show();
      delay(wait);
      firstPixelHue += 65536 / 90;
    }
  }
}
`,
},
{
  name: 'Fire',
  layout: 'strip',
  code: `#include <FastLED.h>

#define DATA_PIN  5
#define NUM_LEDS 60

// How much each cell cools per frame: lower = taller flames.
#define COOLING  55
// Chance (out of 255) that a new spark ignites each frame.
#define SPARKING 120

CRGB leds[NUM_LEDS];
uint8_t heat[NUM_LEDS];

void setup() {
  FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(200);
}

void loop() {
  // 1. Every cell cools down a little.
  for (int i = 0; i < NUM_LEDS; i++) {
    heat[i] = qsub8(heat[i], random8(0, ((COOLING * 10) / NUM_LEDS) + 2));
  }

  // 2. Heat drifts upward and diffuses.
  for (int k = NUM_LEDS - 1; k >= 2; k--) {
    heat[k] = (heat[k - 1] + heat[k - 2] + heat[k - 2]) / 3;
  }

  // 3. Randomly ignite new sparks near the bottom.
  if (random8() < SPARKING) {
    int y = random8(7);
    heat[y] = qadd8(heat[y], random8(160, 255));
  }

  // 4. Map heat to colour.
  for (int j = 0; j < NUM_LEDS; j++) {
    leds[j] = HeatColor(heat[j]);
  }

  FastLED.show();
  FastLED.delay(1000 / 60);
}
`,
},
{
  name: 'Comet (millis, non-blocking)',
  layout: 'ring',
  code: `#include <FastLED.h>

#define DATA_PIN  5
#define NUM_LEDS 60

CRGB leds[NUM_LEDS];

unsigned long lastFrame = 0;
const unsigned long FRAME_MS = 16;

float position = 0;      // head of the comet, in LEDs
float velocity = 0.45;   // LEDs per frame
uint8_t hue = 140;

void setup() {
  Serial.begin(115200);
  FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(180);
}

void loop() {
  // No delay(): the loop spins freely and we act when enough time has passed.
  unsigned long now = millis();
  if (now - lastFrame < FRAME_MS) return;
  lastFrame = now;

  // The tail is whatever is left over from earlier frames, fading out.
  fadeToBlackBy(leds, NUM_LEDS, 28);

  position += velocity;
  if (position >= NUM_LEDS) {
    position -= NUM_LEDS;
    hue += 24;
    Serial.printf("lap done, hue is now %d\\n", hue);
  }

  // Draw the head across two pixels so it moves smoothly between LEDs.
  int   index = (int)position;
  float frac  = position - index;
  leds[index]                  += CHSV(hue, 220, 255 * (1.0 - frac));
  leds[(index + 1) % NUM_LEDS] += CHSV(hue, 220, 255 * frac);

  // A few random sparkles shed from the tail.
  if (random8() < 40) {
    int behind = (index + NUM_LEDS - random8(3, 12)) % NUM_LEDS;
    leds[behind] += CRGB(40, 40, 40);
  }

  FastLED.show();
}
`,
},
{
  name: 'Palette drift (noise)',
  layout: 'strip',
  code: `#include <FastLED.h>

#define DATA_PIN  5
#define NUM_LEDS 60

CRGB leds[NUM_LEDS];

CRGBPalette16 currentPalette = OceanColors_p;
CRGBPalette16 targetPalette  = LavaColors_p;

// A custom gradient: position (0-255), then R, G, B.
DEFINE_GRADIENT_PALETTE(sunset_gp) {
    0,  10,   0,  40,
   80, 140,  10,  90,
  160, 255,  90,  10,
  220, 255, 200,  40,
  255, 255, 255, 180
};

uint8_t paletteIndex = 0;

void setup() {
  Serial.begin(115200);
  FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(170);
}

void loop() {
  uint32_t t = millis();

  // Perlin noise gives each LED a smoothly wandering palette position.
  for (int i = 0; i < NUM_LEDS; i++) {
    uint8_t n      = inoise8(i * 28, t / 6);
    uint8_t bright = inoise8(i * 45 + 5000, t / 3);
    leds[i] = ColorFromPalette(currentPalette, n + (t / 40), qadd8(bright, 60));
  }

  // Cross-fade a little toward the target palette every few milliseconds.
  EVERY_N_MILLISECONDS(15) {
    nblendPaletteTowardPalette(currentPalette, targetPalette, 16);
  }

  EVERY_N_SECONDS(6) {
    paletteIndex = (paletteIndex + 1) % 4;
    switch (paletteIndex) {
      case 0: targetPalette = LavaColors_p;   Serial.println("-> lava");   break;
      case 1: targetPalette = sunset_gp;      Serial.println("-> sunset"); break;
      case 2: targetPalette = ForestColors_p; Serial.println("-> forest"); break;
      default: targetPalette = OceanColors_p; Serial.println("-> ocean");  break;
    }
  }

  FastLED.show();
  delay(10);
}
`,
},
{
  name: 'Bouncing balls (structs + physics)',
  layout: 'strip',
  code: `#include <FastLED.h>

#define DATA_PIN  5
#define NUM_LEDS 60
#define NUM_BALLS 4

CRGB leds[NUM_LEDS];

struct Ball {
  float height;     // 0.0 (floor) .. 1.0 (top of the strip)
  float velocity;   // strip lengths per second
  float bounce;     // energy kept after each bounce
  CRGB  color;
};

Ball balls[NUM_BALLS];

const float GRAVITY = -3.2;
unsigned long lastMicros = 0;

void launch(Ball &b, int n) {
  b.height   = 0;
  b.velocity = 2.4 - n * 0.12;
  b.bounce   = 0.90 - n * 0.05;
}

void setup() {
  FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(200);
  for (int i = 0; i < NUM_BALLS; i++) {
    launch(balls[i], i);
    balls[i].color = CHSV(i * 256 / NUM_BALLS, 230, 255);
  }
  lastMicros = micros();
}

void loop() {
  unsigned long now = micros();
  float dt = (now - lastMicros) / 1000000.0;
  lastMicros = now;

  fadeToBlackBy(leds, NUM_LEDS, 70);

  for (int i = 0; i < NUM_BALLS; i++) {
    Ball &b = balls[i];
    b.velocity += GRAVITY * dt;
    b.height   += b.velocity * dt;

    if (b.height < 0) {
      b.height   = 0;
      b.velocity = -b.velocity * b.bounce;
      if (b.velocity < 0.25) launch(b, i);   // ran out of energy: throw it again
    }

    int pos = constrain((int)(b.height * (NUM_LEDS - 1)), 0, NUM_LEDS - 1);
    leds[pos] += b.color;
  }

  FastLED.show();
  delay(8);
}
`,
},
{
  name: 'Button + knob (inputs)',
  layout: 'strip',
  code: `#include <FastLED.h>

// Use the Pins panel: press the GPIO 4 button to change mode,
// drag the GPIO 34 slider to change brightness.

#define DATA_PIN    5
#define BUTTON_PIN  4     // push button to GND, internal pull-up
#define POT_PIN    34     // potentiometer wiper (ADC1)
#define NUM_LEDS   60

CRGB leds[NUM_LEDS];

enum Mode { SOLID, CHASE, BREATHE, MODE_COUNT };
uint8_t mode = CHASE;

bool lastReading = HIGH;
bool buttonState = HIGH;
unsigned long lastChange = 0;
const unsigned long DEBOUNCE_MS = 25;

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);
  FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, NUM_LEDS);
}

void readButton() {
  bool reading = digitalRead(BUTTON_PIN);
  if (reading != lastReading) lastChange = millis();
  lastReading = reading;

  if (millis() - lastChange > DEBOUNCE_MS && reading != buttonState) {
    buttonState = reading;
    digitalWrite(LED_BUILTIN, buttonState == LOW);
    if (buttonState == LOW) {            // pressed (active low)
      mode = (mode + 1) % MODE_COUNT;
      Serial.print("mode = ");
      Serial.println(mode);
    }
  }
}

void loop() {
  readButton();

  // ESP32 ADC is 12-bit: 0..4095. Keep a floor so the strip never goes fully dark.
  int raw = analogRead(POT_PIN);
  FastLED.setBrightness(map(raw, 0, 4095, 25, 255));

  uint8_t t = millis() / 12;
  switch (mode) {
    case SOLID:
      fill_solid(leds, NUM_LEDS, CRGB::DarkOrange);
      break;
    case CHASE:
      for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = CHSV(150, 255, cubicwave8(i * 12 - t * 3));
      }
      break;
    case BREATHE:
      fill_solid(leds, NUM_LEDS, CHSV(210, 200, beatsin8(12, 30, 255)));
      break;
  }

  FastLED.show();
  delay(10);
}
`,
},
{
  name: 'Ring clock (60 LEDs)',
  layout: 'ring',
  code: `#include <FastLED.h>

// 60 LEDs on a ring = one LED per second / minute.
// The clock runs fast so you can watch the hands move:
// use the speed control, or change TIME_SCALE.

#define DATA_PIN   5
#define NUM_LEDS  60
#define TIME_SCALE 30      // simulated seconds per real second

CRGB leds[NUM_LEDS];

class Hand {
  public:
    Hand(CRGB c, uint8_t w) : color(c), width(w) {}

    void draw(float position) {
      for (int k = -width; k <= width; k++) {
        float d = fabs(k - (position - floor(position)));
        uint8_t level = d >= width + 1 ? 0 : 255 * (1.0 - d / (width + 1));
        int idx = ((int)floor(position) + k + NUM_LEDS) % NUM_LEDS;
        CRGB c = color;
        c.nscale8(dim8_video(level));
        leds[idx] += c;
      }
    }

  private:
    CRGB color;
    uint8_t width;
};

Hand hourHand(CRGB(255, 40, 0), 2);
Hand minuteHand(CRGB(0, 160, 60), 1);
Hand secondHand(CRGB(60, 80, 255), 0);

void setup() {
  FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(200);
}

void loop() {
  // Start at 10:08:00 and count up.
  float seconds = 10 * 3600 + 8 * 60 + millis() * (TIME_SCALE / 1000.0);

  float s = fmod(seconds, 60.0);
  float m = fmod(seconds / 60.0, 60.0);
  float h = fmod(seconds / 3600.0, 12.0);

  fill_solid(leds, NUM_LEDS, CRGB::Black);

  // Dim tick marks every 5 minutes, brighter at the quarters.
  for (int i = 0; i < NUM_LEDS; i += 5) {
    leds[i] = (i % 15 == 0) ? CRGB(28, 28, 28) : CRGB(8, 8, 8);
  }

  hourHand.draw(h * 5.0);
  minuteHand.draw(m);
  secondHand.draw(s);

  FastLED.show();
  delay(15);
}
`,
},
{
  name: 'Audio spectrum (needs led-audio.exe)',
  layout: 'strip',
  code: `// Music-reactive spectrum. Run led-audio.exe on the PC: it sends what Windows
// is playing over Serial (to this simulator, or to a real ESP32 with --port COMx).
#include <FastLED.h>

#define DATA_PIN  5
#define NUM_LEDS  60
#define NUM_BANDS 16
#define FRAME_LEN (2 + NUM_BANDS)   // bytes after the 0xFF start marker

CRGB leds[NUM_LEDS];

// Latest frame from led-audio: overall level, beat counter, 16 bands (bass first). All 0-254.
uint8_t level = 0, beatCount = 0, bands[NUM_BANDS];
uint8_t frame[FRAME_LEN];
uint8_t got = 0;
bool inFrame = false;
unsigned long lastFrameMs = 0;

void readAudio() {
  while (Serial.available()) {
    int b = Serial.read();
    if (b == 0xFF) { inFrame = true; got = 0; continue; }
    if (!inFrame) continue;
    frame[got++] = b;
    if (got == FRAME_LEN) {
      level = frame[0];
      beatCount = frame[1];
      for (int i = 0; i < NUM_BANDS; i++) bands[i] = frame[2 + i];
      inFrame = false;
      lastFrameMs = millis();
    }
  }
}

uint8_t lastBeat = 0;
uint8_t flash = 0;

void setup() {
  Serial.begin(115200);
  FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(180);
}

void loop() {
  readAudio();
  if (beatCount != lastBeat) { lastBeat = beatCount; flash = 200; }

  if (millis() - lastFrameMs > 1000) {
    // No audio frames for a second: breathe dim blue so a dead link is obvious.
    fill_solid(leds, NUM_LEDS, CHSV(160, 255, beatsin8(20, 4, 40)));
  } else {
    for (int i = 0; i < NUM_LEDS; i++) {
      // Mirror around the centre: bass in the middle, treble at both ends.
      int d = abs(i - NUM_LEDS / 2);
      int b = d * NUM_BANDS / (NUM_LEDS / 2 + 1);
      uint8_t v = bands[b];
      leds[i] = CHSV(b * 14 - flash / 8, 240, dim8_video(v));
      leds[i] += CRGB(flash / 5, flash / 5, flash / 5);
    }
    flash = qsub8(flash, 20);
  }
  FastLED.show();
}
`,
},
];
