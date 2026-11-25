package io.github.trolanin.drift;

import java.util.Random;

/**
 * A silent built-in groove so the visuals move before any audio permission is given: 124 BPM,
 * kick, hats, a bass line and a pad, in 64-beat cycles with a breakdown (no kick), a riser
 * and a drop. It is only fed to the analyser, never played. Pure Java.
 */
final class DemoSynth {
    private final Random rnd = new Random(7);
    private long n;
    private double bassPh, padPh1, padPh2, padPh3;
    private static final double BPM = 124, BEAT = 60.0 / BPM;
    private static final double[] ROOTS = { 55.0, 55.0, 43.65, 49.0 };   // A, A, F, G

    void render(float[] out, int count) {
        double sr = Analyzer.RATE;
        for (int i = 0; i < count; i++, n++) {
            double t = n / sr;
            double beatPos = t / BEAT;
            int beat = (int) Math.floor(beatPos);
            int cyc = beat % 64;
            double b = (beatPos - beat) * BEAT;          // seconds since this beat
            boolean breakdown = cyc >= 40 && cyc < 56;
            boolean riser = cyc >= 48 && cyc < 56;
            double root = ROOTS[(beat / 8) % 4];

            double kick = 0;
            if (!breakdown && b < 0.35) kick = Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-b * 28)) * b) * Math.exp(-b * 8);
            double hb = (beatPos + 0.5) % 1.0 * BEAT;   // off-beat
            boolean fastHats = cyc >= 16 && cyc < 32;
            if (fastHats) hb = (beatPos * 2 % 1.0) * BEAT / 2;
            double hat = (rnd.nextDouble() * 2 - 1) * Math.exp(-hb * 70) * (breakdown ? 0.05 : 0.22);
            bassPh += 2 * Math.PI * root / sr;
            double env = breakdown ? 0.3 : 0.6 + 0.4 * Math.exp(-((beatPos * 2) % 1.0) * 4);
            double bass = 0.22 * Math.tanh(2.5 * Math.sin(bassPh)) * env;
            padPh1 += 2 * Math.PI * root * 4 / sr;
            padPh2 += 2 * Math.PI * root * 4 * 1.189 / sr;
            padPh3 += 2 * Math.PI * root * 4 * 1.498 / sr;
            double pad = 0.05 * (Math.sin(padPh1) + Math.sin(padPh2) + Math.sin(padPh3)) * (breakdown ? 2.0 : 1.0);
            double rise = 0;
            if (riser) {
                double k = (cyc - 48 + (beatPos - beat)) / 8.0;
                rise = (rnd.nextDouble() * 2 - 1) * 0.25 * k * k;
            }
            double v = 0.65 * kick + hat + bass + pad + rise;
            out[i] = (float) Math.max(-1, Math.min(1, v * 0.8));
        }
    }
}
