package io.github.trolanin.drift;

/**
 * A trimmed phone version of drift-viz's audio.cpp. Mono 48 kHz samples go in through
 * {@link #push}; every 10 ms it updates the waveform, a 128-band log spectrum, loudness, band
 * energies and a few event counters (beats, hits, drops, hi-hat rushes, section changes).
 * The renderer copies the result with {@link #snapshot}. Pure Java, no Android classes.
 */
final class Analyzer {
    static final int RATE = 48000, HOP = RATE / 100, N = 2048, WAVE_N = 512, SPEC_N = 128;
    private static final float HOP_S = HOP / (float) RATE;

    /** What the visuals see. */
    static final class Frame {
        final float[] wave = new float[WAVE_N];   // zero-crossing aligned, about -1..1
        final float[] spec = new float[SPEC_N];   // log bands 30 Hz..16 kHz, 0..1
        float level;                              // 0..1, auto-gained
        float bass = 1, mid = 1, treb = 1;        // energy relative to the last few seconds (1 = normal)
        int beats, hits, drops, hatRushes, sections;
        boolean silent = true;

        void copyFrom(Frame f) {
            System.arraycopy(f.wave, 0, wave, 0, WAVE_N);
            System.arraycopy(f.spec, 0, spec, 0, SPEC_N);
            level = f.level; bass = f.bass; mid = f.mid; treb = f.treb;
            beats = f.beats; hits = f.hits; drops = f.drops; hatRushes = f.hatRushes; sections = f.sections;
            silent = f.silent;
        }
    }

    private final float[] ring = new float[N];
    private int ringPos, hopFill;
    private long lastPushNs;
    private final Frame cur = new Frame();

    // FFT tables and scratch
    private final float[] win = new float[N], cosT = new float[N / 2], sinT = new float[N / 2];
    private final int[] rev = new int[N];
    private final float[] re = new float[N], im = new float[N], pw = new float[N / 2];
    private final int[] bandLo = new int[SPEC_N], bandHi = new int[SPEC_N];
    private final float[] lin = new float[N];

    // running state
    private float peakDb = -40, levelPeakDb = -30, ampPeak = 0.05f;
    private float bassAvg = 1e-6f, midAvg = 1e-6f, trebAvg = 1e-6f;
    private float beatAvg = 1f, bassLocal = 1e-6f, trebLocal = 1e-6f, prevBass, prevTreb;
    private float sinceBeat = 1, sinceHit = 5, sinceHat = 1, sinceRush = 10, sinceSection = 10;
    private float hatShort, hatLong, bassSlow = 1, quietTime;
    private float dbShort = -60, dbLong = -60;
    private float silentTime = 10;

    Analyzer() {
        float wsum = 0;
        for (int i = 0; i < N; i++) { win[i] = 0.5f - 0.5f * (float) Math.cos(2 * Math.PI * i / (N - 1)); wsum += win[i]; }
        for (int i = 0; i < N; i++) win[i] *= 2f / wsum;   // a full-scale sine reads about 1.0
        for (int i = 0; i < N / 2; i++) { cosT[i] = (float) Math.cos(2 * Math.PI * i / N); sinT[i] = (float) -Math.sin(2 * Math.PI * i / N); }
        int bits = Integer.numberOfTrailingZeros(N);
        for (int i = 0; i < N; i++) rev[i] = Integer.reverse(i) >>> (32 - bits);
        double f0 = 30, f1 = 16000, binHz = RATE / (double) N;
        for (int b = 0; b < SPEC_N; b++) {
            double lo = f0 * Math.pow(f1 / f0, b / (double) SPEC_N), hi = f0 * Math.pow(f1 / f0, (b + 1) / (double) SPEC_N);
            bandLo[b] = Math.max(1, (int) Math.floor(lo / binHz));
            bandHi[b] = Math.max(bandLo[b] + 1, (int) Math.ceil(hi / binHz));
        }
    }

    synchronized void push(float[] x, int n) {
        for (int i = 0; i < n; i++) {
            ring[ringPos] = x[i];
            ringPos = (ringPos + 1) & (N - 1);
            if (++hopFill == HOP) { hopFill = 0; analyse(); }
        }
        lastPushNs = System.nanoTime();
    }

    /** Copies the latest result. If no samples came for a while (nothing playing), feeds silence so things fall. */
    synchronized void snapshot(Frame out) {
        long now = System.nanoTime();
        long gap = now - lastPushNs;
        if (gap > 60_000_000L) {
            int hops = (int) Math.min(30, gap / 10_000_000L);
            for (int h = 0; h < hops; h++) {
                for (int i = 0; i < HOP; i++) { ring[ringPos] = 0; ringPos = (ringPos + 1) & (N - 1); }
                analyse();
            }
            lastPushNs = now;
        }
        out.copyFrom(cur);
    }

    private static float follow(float v, float target, float a) { return v + (target - v) * a; }

    private void analyse() {
        // Ordered copy of the ring, windowed, into the FFT input.
        for (int i = 0; i < N; i++) lin[i] = ring[(ringPos + i) & (N - 1)];
        for (int i = 0; i < N; i++) { re[rev[i]] = lin[i] * win[i]; im[rev[i]] = 0; }
        for (int size = 2; size <= N; size <<= 1) {
            int half = size >> 1, step = N / size;
            for (int s = 0; s < N; s += size) {
                for (int k = 0; k < half; k++) {
                    float c = cosT[k * step], sn = sinT[k * step];
                    int a = s + k, b = a + half;
                    float tr = re[b] * c - im[b] * sn, ti = re[b] * sn + im[b] * c;
                    re[b] = re[a] - tr; im[b] = im[a] - ti;
                    re[a] += tr; im[a] += ti;
                }
            }
        }
        for (int k = 0; k < N / 2; k++) pw[k] = re[k] * re[k] + im[k] * im[k];

        // Loudness of the last 10 ms.
        double sq = 0;
        float amp = 0;
        for (int i = N - HOP; i < N; i++) { sq += lin[i] * lin[i]; amp = Math.max(amp, Math.abs(lin[i])); }
        float db = 10f * (float) Math.log10(sq / HOP + 1e-12);
        if (db > -70) silentTime = 0; else silentTime += HOP_S;
        cur.silent = silentTime > 2f;

        // Spectrum, auto-gained against the loudest band (fast attack, slow release).
        float maxDb = -200;
        for (int b = 0; b < SPEC_N; b++) {
            float s = 0;
            for (int k = bandLo[b]; k < bandHi[b] && k < N / 2; k++) s += pw[k];
            s /= (bandHi[b] - bandLo[b]);
            float bdb = 10f * (float) Math.log10(s + 1e-14);
            maxDb = Math.max(maxDb, bdb);
            float v = Math.max(0, Math.min(1, (bdb - (peakDb - 48f)) / 48f));
            float old = cur.spec[b];
            cur.spec[b] = v > old ? follow(old, v, 0.6f) : Math.max(v, old - 0.012f);
        }
        peakDb = maxDb > peakDb ? follow(peakDb, maxDb, 0.3f) : Math.max(peakDb - 0.02f, -70f);

        // Overall level, auto-gained.
        levelPeakDb = db > levelPeakDb ? follow(levelPeakDb, db, 0.2f) : Math.max(levelPeakDb - 0.015f, -60f);
        float lv = Math.max(0, Math.min(1, (db - (levelPeakDb - 36f)) / 36f));
        cur.level = follow(cur.level, lv, lv > cur.level ? 0.5f : 0.1f);

        // Band energies relative to their running averages (a few seconds).
        float binHz = RATE / (float) N, bassE = 0, midE = 0, trebE = 0;
        for (int k = 1; k < N / 2; k++) {
            float f = k * binHz;
            if (f < 150) bassE += pw[k]; else if (f < 2000) midE += pw[k]; else if (f < 16000) trebE += pw[k];
        }
        bassAvg = follow(bassAvg, bassE, 0.004f);
        midAvg = follow(midAvg, midE, 0.004f);
        trebAvg = follow(trebAvg, trebE, 0.004f);
        float floorE = 1e-9f;
        cur.bass = follow(cur.bass, Math.min(4f, bassE / (bassAvg + floorE)), 0.4f);
        cur.mid = follow(cur.mid, Math.min(4f, midE / (midAvg + floorE)), 0.3f);
        cur.treb = follow(cur.treb, Math.min(4f, trebE / (trebAvg + floorE)), 0.4f);

        // Beats: bass jumps well above its local (about 1 s) mean.
        sinceBeat += HOP_S; sinceHit += HOP_S; sinceHat += HOP_S; sinceRush += HOP_S; sinceSection += HOP_S;
        bassLocal = follow(bassLocal, bassE, 0.012f);
        if (!cur.silent && bassE > bassLocal * 1.45f && bassE > prevBass * 1.1f && sinceBeat > 0.2f && bassE > bassAvg * 0.3f) {
            cur.beats++;
            sinceBeat = 0;
            // A hit: a beat far stronger than the recent beats.
            if (bassE > beatAvg * 2.2f && sinceHit > 3f) { cur.hits++; sinceHit = 0; }
            beatAvg = follow(beatAvg, bassE, 0.15f);
        }
        prevBass = bassE;

        // Hi-hat rush: treble onsets suddenly much more frequent than usual.
        trebLocal = follow(trebLocal, trebE, 0.03f);
        boolean hat = !cur.silent && trebE > trebLocal * 1.6f && trebE > prevTreb * 1.15f && sinceHat > 0.06f;
        if (hat) sinceHat = 0;
        prevTreb = trebE;
        hatShort = follow(hatShort, hat ? 100f : 0f, 0.01f);   // onsets per second, ~1 s window
        hatLong = follow(hatLong, hat ? 100f : 0f, 0.001f);    // ~10 s window
        if (hatShort > hatLong * 1.5f + 0.5f && sinceRush > 6f) { cur.hatRushes++; sinceRush = 0; }

        // Drop: the bass comes back after a lull of a second and a half.
        bassSlow = follow(bassSlow, bassE / (bassAvg + floorE), 0.05f);
        if (!cur.silent && bassSlow < 0.35f) quietTime += HOP_S;
        else if (bassSlow > 0.9f) {
            if (quietTime > 1.5f) cur.drops++;
            quietTime = 0;
        }

        // Section change: the last half second is much louder or quieter than the last eight.
        if (!cur.silent) {
            dbShort = follow(dbShort, db, 0.02f);
            dbLong = follow(dbLong, db, 0.0012f);
            if (Math.abs(dbShort - dbLong) > 6f && sinceSection > 6f) { cur.sections++; sinceSection = 0; dbLong = dbShort; }
        }

        // Waveform: decimated by two (about 21 ms), starting at a rising zero crossing, auto-scaled.
        ampPeak = amp > ampPeak ? amp : Math.max(0.02f, ampPeak * 0.995f);
        int span = WAVE_N * 2, start = N - span - 1, best = start;
        for (int i = start; i > start - 400 && i > 0; i--) {
            if (lin[i - 1] < 0 && lin[i] >= 0) { best = i; break; }
        }
        float g = 0.9f / ampPeak;
        for (int i = 0; i < WAVE_N; i++) {
            float v = (lin[best + 2 * i] + lin[best + 2 * i + 1]) * 0.5f * g;
            cur.wave[i] = follow(cur.wave[i], v, 0.7f);
        }
    }
}
