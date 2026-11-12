package io.github.trolanin.ledaudio;

/**
 * Same analysis as led-audio.cpp (the Windows capture tool), so a design reacts the same to the
 * phone as to the PC: 1024-point FFT, 16 log-spaced bands 40 Hz–16 kHz, auto-gain, level, beat
 * counter. Frame: 0xFF, level, beatCount, band[0..15]; data bytes are 0..254.
 */
final class Analyzer {
    static final int N = 1024, BANDS = 16, FRAME_LEN = 3 + BANDS;

    private final float[] ring = new float[N], hann = new float[N];
    private final float[] re = new float[N], im = new float[N];
    private int pos = 0;
    private float bandPeak = -40, lvlPeak = -35, lvlSmooth = 0;
    private final float[] smooth = new float[BANDS];
    private final float[] bassHist = new float[100];
    private int histPos = 0;
    private double lastBeat = 0;
    private int beatCount = 0;

    Analyzer() {
        for (int i = 0; i < N; i++) hann[i] = 0.5f - 0.5f * (float) Math.cos(2 * Math.PI * i / (N - 1));
    }

    void push(float[] s, int n) {
        for (int i = 0; i < n; i++) { ring[pos] = s[i]; pos = (pos + 1) % N; }
    }

    void pushSilence(int n) {
        for (int i = 0; i < n; i++) { ring[pos] = 0; pos = (pos + 1) % N; }
    }

    private void fft() {
        for (int i = 1, j = 0; i < N; i++) {
            int bit = N >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                float t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (int len = 2; len <= N; len <<= 1) {
            double ang = -2 * Math.PI / len;
            float wlr = (float) Math.cos(ang), wli = (float) Math.sin(ang);
            for (int i = 0; i < N; i += len) {
                float wr = 1, wi = 0;
                for (int k = 0; k < len / 2; k++) {
                    int a = i + k, b = i + k + len / 2;
                    float vr = re[b] * wr - im[b] * wi, vi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - vr; im[b] = im[a] - vi;
                    re[a] += vr; im[a] += vi;
                    float nwr = wr * wlr - wi * wli;
                    wi = wr * wli + wi * wlr; wr = nwr;
                }
            }
        }
    }

    private static float clamp01(float v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    void frame(int rate, int hop, byte[] out) {
        for (int i = 0; i < N; i++) { re[i] = ring[(pos + i) % N] * hann[i]; im[i] = 0; }
        fft();
        // Hann-windowed full-scale sine peaks at N/4, so this scale puts it near 0 dB.
        final float norm = 1f / ((float) N * N / 16f), binHz = (float) rate / N;
        float[] db = new float[BANDS];
        float bass = 0, maxDb = -200;
        for (int b = 0; b < BANDS; b++) {
            float f0 = 40f * (float) Math.pow(400, b / (float) BANDS), f1 = 40f * (float) Math.pow(400, (b + 1) / (float) BANDS);
            int lo = Math.max(1, (int) (f0 / binHz)), hi = Math.min(N / 2, Math.max(lo + 1, (int) (f1 / binHz)));
            float p = 0;
            for (int k = lo; k < hi; k++) p += (re[k] * re[k] + im[k] * im[k]) * norm;
            if (b < 4) bass += p;
            db[b] = 10f * (float) Math.log10(p + 1e-12f);
            maxDb = Math.max(maxDb, db[b]);
        }
        // Auto-gain: follow the loudest band instantly, let it fall 4 dB/s; never amplify below -40 dB.
        bandPeak = Math.max(maxDb, Math.max(bandPeak - 0.04f, -40f));
        for (int b = 0; b < BANDS; b++) {
            float v = clamp01((db[b] - (bandPeak - 45f)) / 45f) * 254f;
            smooth[b] = Math.max(v, smooth[b] * 0.85f);   // instant attack, ~60 ms release
            out[3 + b] = (byte) (int) smooth[b];
        }
        float rms = 0;
        for (int i = 0; i < hop; i++) { float x = ring[(pos + N - 1 - i) % N]; rms += x * x; }
        float lvlDb = 20f * (float) Math.log10(Math.sqrt(rms / hop) + 1e-9f);
        lvlPeak = Math.max(lvlDb, Math.max(lvlPeak - 0.03f, -35f));
        lvlSmooth = Math.max(clamp01((lvlDb - (lvlPeak - 40f)) / 40f) * 254f, lvlSmooth * 0.85f);
        // Beat: bass energy jumps well above its 1-second average.
        float avg = 0;
        for (float h : bassHist) avg += h;
        avg /= 100f;
        double t = System.nanoTime() / 1e9;
        if (bass > 1.6f * avg && bass > 1e-5f && t - lastBeat > 0.15) { lastBeat = t; beatCount = (beatCount + 1) % 255; }
        bassHist[histPos] = bass; histPos = (histPos + 1) % 100;
        out[0] = (byte) 0xFF; out[1] = (byte) (int) lvlSmooth; out[2] = (byte) beatCount;
    }
}
