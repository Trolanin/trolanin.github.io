package io.github.trolanin.drift;

import java.util.Random;

/**
 * A compact take on drift-viz's evolve.cpp.
 *  - Genes do a damped random walk toward targets inside their ranges.
 *  - Layers (spectrum ring, tunnel, flame warp, lens, tiling, kaleidoscope, attractor...) fade in
 *    and out as "complexity" wanders past thresholds drawn fresh for every species.
 *  - Discrete options (wave shape, flame variation, lens, tiling...) fade out, switch and fade back in.
 *  - Audio events mutate gene groups: a drop rebuilds motion and space, a hi-hat rush the colours,
 *    a section change everything; a scene timer adds small mutations; 4 s of silence starts a new species.
 * {@link #build} turns the genome plus live audio into the shader slots. Pure Java, GL thread only.
 */
final class Evolver {
    // Groups that audio events mutate.
    static final int MOTION = 0, COLOUR = 1, SHAPE = 2, SPACE = 3, SYMMETRY = 4, GROUPS = 5;

    // ---------------- genes: (group, low, high) ----------------
    private static final int ZOOM = 0, ROT = 1, SWIRL = 2, WARP = 3, WARP_FREQ = 4, WARP_SPEED = 5, DRIFT_X = 6, DRIFT_Y = 7,
            DECAY = 8, HUE = 9, BASS_ZOOM = 10, BEAT_KICK = 11,
            PAL_C0 = 12, PAL_C1 = 13, PAL_C2 = 14, PAL_D0 = 15, PAL_D1 = 16, PAL_D2 = 17, PAL_SPEED = 18, PAL_SPREAD = 19, CHROMA = 20,
            WAVE_SCALE = 21, WAVE_GAIN = 22, WAVE_THICK = 23, WAVE_SPIN = 24, WAVE_BRIGHT = 25, ROSE_K = 26, LISS_A = 27, LISS_B = 28,
            LISS_SPEED = 29, SPEC_RADIUS = 30,
            FLAME = 31, VAR_MIX = 32, AFF_ROT = 33, AFF_SCALE = 34, AFF_X = 35, AFF_Y = 36, FLOW = 37, FLOW_SCALE = 38, FLOW_SPEED = 39,
            VIEW_P1 = 40, VIEW_SPEED = 41, TILE_SCALE = 42,
            ATTR_A = 43, ATTR_B = 44, ATTR_C = 45, ATTR_D = 46, ATTR_SCALE = 47, ATTR_SPIN = 48,
            KSPIN = 49, ECHO_ZOOM = 50, ECHO_SPIN = 51, BEAT_FLASH = 52,
            GENES = 53;

    private static final float[][] RANGE = new float[GENES][];
    private static final int[] GROUP = new int[GENES];
    private static void g(int i, int grp, float lo, float hi) { GROUP[i] = grp; RANGE[i] = new float[] { lo, hi }; }
    static {
        // Motion values are per frame at 60 fps; build() rescales them to the real frame time.
        g(ZOOM, MOTION, 0.988f, 1.022f); g(ROT, MOTION, -0.012f, 0.012f); g(SWIRL, MOTION, -0.03f, 0.03f);
        g(WARP, MOTION, 0f, 0.01f); g(WARP_FREQ, MOTION, 2f, 12f); g(WARP_SPEED, MOTION, 0.005f, 0.05f);
        g(DRIFT_X, MOTION, -0.003f, 0.003f); g(DRIFT_Y, MOTION, -0.003f, 0.003f); g(DECAY, MOTION, 0.9f, 0.975f);
        g(HUE, COLOUR, -0.012f, 0.012f); g(BASS_ZOOM, MOTION, 0f, 0.025f); g(BEAT_KICK, MOTION, 0f, 1f);
        g(PAL_C0, COLOUR, 0.3f, 1.4f); g(PAL_C1, COLOUR, 0.3f, 1.4f); g(PAL_C2, COLOUR, 0.3f, 1.4f);
        g(PAL_D0, COLOUR, 0f, 1f); g(PAL_D1, COLOUR, 0f, 1f); g(PAL_D2, COLOUR, 0f, 1f);
        g(PAL_SPEED, COLOUR, 0f, 0.004f); g(PAL_SPREAD, COLOUR, 0.3f, 2f); g(CHROMA, COLOUR, 0f, 0.012f);
        g(WAVE_SCALE, SHAPE, 0.14f, 0.36f); g(WAVE_GAIN, SHAPE, 0.15f, 0.6f); g(WAVE_THICK, SHAPE, 0.002f, 0.007f);
        g(WAVE_SPIN, SHAPE, -0.02f, 0.02f); g(WAVE_BRIGHT, SHAPE, 0.35f, 1.1f); g(ROSE_K, SHAPE, 2f, 7f);
        g(LISS_A, SHAPE, 1f, 5f); g(LISS_B, SHAPE, 1f, 5f); g(LISS_SPEED, SHAPE, 0f, 0.02f); g(SPEC_RADIUS, SHAPE, 0.12f, 0.38f);
        g(FLAME, SPACE, 0.01f, 0.08f); g(VAR_MIX, SPACE, 0f, 1f); g(AFF_ROT, SPACE, -3.14f, 3.14f); g(AFF_SCALE, SPACE, 0.6f, 1.4f);
        g(AFF_X, SPACE, -0.3f, 0.3f); g(AFF_Y, SPACE, -0.3f, 0.3f); g(FLOW, SPACE, 0.0005f, 0.004f); g(FLOW_SCALE, SPACE, 1f, 6f);
        g(FLOW_SPEED, SPACE, 0.002f, 0.03f); g(VIEW_P1, SPACE, 0f, 1f); g(VIEW_SPEED, SPACE, -0.01f, 0.01f); g(TILE_SCALE, SPACE, 1f, 3f);
        g(ATTR_A, SPACE, -2.2f, 2.2f); g(ATTR_B, SPACE, -2.2f, 2.2f); g(ATTR_C, SPACE, -1.4f, 1.4f); g(ATTR_D, SPACE, -1.4f, 1.4f);
        g(ATTR_SCALE, SPACE, 0.1f, 0.2f); g(ATTR_SPIN, SPACE, -0.01f, 0.01f);
        g(KSPIN, SYMMETRY, -0.01f, 0.01f); g(ECHO_ZOOM, SYMMETRY, 1.2f, 2.5f); g(ECHO_SPIN, SYMMETRY, -0.01f, 0.01f);
        g(BEAT_FLASH, COLOUR, 0f, 0.1f);
    }

    // ---------------- layers: faded in when complexity passes the species' gate ----------------
    private static final int L_SPEC = 0, L_TUNNEL = 1, L_SPARKLE = 2, L_ORBS = 3, L_FLAME = 4, L_FLOW = 5, L_VIEW = 6,
            L_TILE = 7, L_KALEIDO = 8, L_ECHO = 9, L_ATTR = 10, L_MIRROR = 11, L_CHROMA = 12, LAYERS = 13;
    private static final int[] LAYER_GROUP = { SHAPE, SHAPE, COLOUR, SHAPE, SPACE, MOTION, SPACE, SPACE, SYMMETRY, SYMMETRY, SPACE, SYMMETRY, COLOUR };
    // Typical gate per layer: the plain ones come early, the heavy maths later.
    private static final float[] LAYER_BIAS = { 0.2f, 0.35f, 0.3f, 0.45f, 0.4f, 0.3f, 0.6f, 0.75f, 0.45f, 0.55f, 0.5f, 0.6f, 0.4f };

    // ---------------- discrete options: fade out, switch, fade in ----------------
    static final class Choice {
        final int group, count, base;
        int cur, pending = -1;
        float fade = 1;
        Choice(int group, int base, int count) { this.group = group; this.base = base; this.count = count; }
        int value() { return base + cur; }
        void update(float dt) {
            if (pending >= 0) {
                fade -= dt / 0.7f;
                if (fade <= 0) { fade = 0; cur = pending; pending = -1; }
            } else fade = Math.min(1, fade + dt / 0.9f);
        }
    }
    private static final int C_SHAPE = 0, C_VAR_A = 1, C_VAR_B = 2, C_VIEW = 3, C_TILE = 4, C_KALEIDO = 5, C_SIDES = 6,
            C_COPIES = 7, C_ATTR = 8, C_MIRROR = 9, CHOICES = 10;
    private static final float[] KALEIDO_N = { 3, 4, 5, 6, 8 }, SIDES = { 0, 3, 4, 5, 6 }, COPIES_N = { 1, 2, 3, 4, 6 };
    private final Choice[] ch = {
        new Choice(SHAPE, 0, 6),      // circle, line, scope, spiral, rose, lissajous
        new Choice(SPACE, 1, 14),     // flame variation A
        new Choice(SPACE, 1, 14),     // flame variation B
        new Choice(SPACE, 1, 8),      // lens
        new Choice(SPACE, 1, 5),      // tiling
        new Choice(SYMMETRY, 0, 5),   // kaleidoscope folds
        new Choice(SHAPE, 0, 5),      // tunnel sides
        new Choice(SHAPE, 0, 5),      // wave copies
        new Choice(SPACE, 0, 4),      // attractor family
        new Choice(SYMMETRY, 0, 3),   // mirror x / y / both
    };

    private final Random rng;
    private final float[] v = new float[GENES], tgt = new float[GENES];
    private final float[] gate = new float[LAYERS], layer = new float[LAYERS];
    private final float[] shapeW = new float[6];
    private float complexity, cxTarget, cxTimer, sceneTimer, silentTime;
    private int lastBeats, lastHits, lastDrops, lastRushes, lastSections;
    private boolean countsInit;
    int species = 0, scene = 0;
    String lastEvent = "";

    // accumulators for build()
    private float time, warpPhase, palPhase, waveAngle, kSpin, orbPhase, echoAngle, flowPhase, viewPhase, lissPhase, attrAngle;
    private float pulse, flash;
    // Brightness control: how far over (> 1) or under (< 1) the target the feedback's mean brightness is.
    private float fill = 1, trim = 0;   // trim: slow log-domain correction that removes the steady error
    private static final float LUM_TARGET = 0.2f;
    private final float[][] rings = new float[8][2];
    private int ringNext;
    private int frameNo;

    Evolver(long seed) {
        rng = new Random(seed);
        time = rng.nextFloat() * 100;
        newSpecies("start");
    }

    private float uni(float a, float b) { return a + (b - a) * rng.nextFloat(); }

    void newSpecies(String why) {
        species++;
        scene = 1;
        lastEvent = "new species (" + why + ")";
        for (int i = 0; i < GENES; i++) { tgt[i] = uni(RANGE[i][0], RANGE[i][1]); v[i] = tgt[i]; }
        for (int l = 0; l < LAYERS; l++) gate[l] = Math.max(0.02f, LAYER_BIAS[l] + (float) rng.nextGaussian() * 0.25f);
        complexity = uni(0.05f, 0.7f);
        cxTarget = uni(0.1f, 1f);
        cxTimer = uni(8f, 30f);
        sceneTimer = uni(6f, 20f);
        for (Choice c : ch) { c.cur = rng.nextInt(c.count); c.pending = -1; c.fade = 0; }
        for (int l = 0; l < LAYERS; l++) layer[l] = 0;
        flash = 0.25f;
    }

    /** Re-draws targets and options in the given groups (bit mask), by an amount 0..1. */
    void mutate(int groups, float strength, String why) {
        scene++;
        lastEvent = why;
        for (int i = 0; i < GENES; i++) {
            if ((groups & (1 << GROUP[i])) == 0) continue;
            tgt[i] += (uni(RANGE[i][0], RANGE[i][1]) - tgt[i]) * strength;
        }
        for (Choice c : ch) {
            if ((groups & (1 << c.group)) == 0 || rng.nextFloat() > strength) continue;
            int n = rng.nextInt(c.count - 1);
            c.pending = n >= c.cur ? n + 1 : n;
        }
        // Sometimes the music also redraws a layer's threshold.
        for (int l = 0; l < LAYERS; l++) {
            if ((groups & (1 << LAYER_GROUP[l])) != 0 && rng.nextFloat() < strength * 0.3f)
                gate[l] = Math.max(0.02f, LAYER_BIAS[l] + (float) rng.nextGaussian() * 0.25f);
        }
    }

    void update(float dt, Analyzer.Frame a) {
        // Events from the audio counters.
        if (!countsInit) {
            lastBeats = a.beats; lastHits = a.hits; lastDrops = a.drops; lastRushes = a.hatRushes; lastSections = a.sections;
            countsInit = true;
        }
        if (a.beats != lastBeats) {
            pulse = 1;
            rings[ringNext][0] = 0.02f; rings[ringNext][1] = 1; ringNext = (ringNext + 1) & 7;
        }
        if (a.drops != lastDrops) { mutate((1 << MOTION) | (1 << SPACE), 0.8f, "drop"); flash = 0.35f; cxTarget = uni(0.6f, 1f); }
        if (a.sections != lastSections) mutate((1 << GROUPS) - 1, 0.5f, "section change");
        if (a.hatRushes != lastRushes) mutate((1 << COLOUR) | (1 << SHAPE), 0.6f, "hi-hats");
        if (a.hits != lastHits) { mutate(1 << SYMMETRY, 0.7f, "big hit"); flash = Math.max(flash, 0.2f); }
        lastBeats = a.beats; lastHits = a.hits; lastDrops = a.drops; lastRushes = a.hatRushes; lastSections = a.sections;

        // Silence: after 4 s a new species starts with the next sound.
        if (a.silent) silentTime += dt;
        else {
            if (silentTime > 4f) newSpecies("new song");
            silentTime = 0;
        }

        sceneTimer -= dt;
        if (sceneTimer <= 0) { mutate(1 << rng.nextInt(GROUPS), 0.4f, "scene timer"); sceneTimer = uni(6f, 24f); }

        cxTimer -= dt;
        if (cxTimer <= 0) { cxTarget = uni(0.05f, 1f); cxTimer = uni(8f, 40f); }
        complexity += (cxTarget - complexity) * (1 - (float) Math.exp(-dt / 6f));

        // Genes: targets random-walk, values ease toward them.
        float ease = 1 - (float) Math.exp(-dt / 2.5f), walk = (float) Math.sqrt(dt) * 0.04f;
        for (int i = 0; i < GENES; i++) {
            float lo = RANGE[i][0], hi = RANGE[i][1];
            tgt[i] = Math.max(lo, Math.min(hi, tgt[i] + (float) rng.nextGaussian() * walk * (hi - lo)));
            v[i] += (tgt[i] - v[i]) * ease;
        }
        for (Choice c : ch) c.update(dt);
        float lf = 1 - (float) Math.exp(-dt / 1.5f);
        for (int l = 0; l < LAYERS; l++) {
            float want = smooth((complexity - gate[l]) / 0.12f + 0.5f);
            layer[l] += (want - layer[l]) * lf;
        }
        trim = Math.max(-2.5f, Math.min(0.4f, trim - (float) Math.log(fill) * dt * 0.25f));

        // Wave shape: one-hot, cross-faded.
        int shape = ch[C_SHAPE].value();
        for (int s = 0; s < 6; s++) shapeW[s] += ((s == shape ? 1f : 0f) - shapeW[s]) * (1 - (float) Math.exp(-dt / 0.8f));
    }

    private static float smooth(float x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

    /** Mean luminance (0..1) of the feedback buffer, measured on the GPU a few frames late. */
    void setMeanLum(float m) {
        float f = Math.max(0.05f, m / LUM_TARGET);
        fill += (f - fill) * (f > fill ? 0.35f : 0.15f);
    }

    /** Number of attractor points to draw this frame (0 = skip the pass). */
    int attrPoints() { return layer[L_ATTR] > 0.01f ? 14000 : 0; }
    int copies() { return (int) COPIES_N[ch[C_COPIES].value()]; }

    void build(float[] P, Analyzer.Frame a, float dt, int w, int h) {
        float k = dt * 60f;
        time += dt;
        frameNo++;
        pulse *= (float) Math.exp(-dt * 7);
        flash *= (float) Math.exp(-dt * 5);
        float bass = Math.min(a.bass, 3f), mid = Math.min(a.mid, 3f), treb = Math.min(a.treb, 3f), lvl = a.level;

        P[Params.RES_X] = w; P[Params.RES_Y] = h; P[Params.ASPECT] = w / (float) h; P[Params.TIME] = time;

        float zoom = v[ZOOM] + v[BASS_ZOOM] * Math.max(0, bass - 1) * 0.5f + v[BEAT_KICK] * pulse * 0.015f;
        P[Params.ZOOM] = (float) Math.pow(zoom, k);
        P[Params.ROT] = v[ROT] * k * (0.6f + 0.4f * mid);
        P[Params.SWIRL] = v[SWIRL] * k;
        P[Params.WARP] = v[WARP] * (0.4f + lvl);
        P[Params.WARP_FREQ] = v[WARP_FREQ];
        warpPhase += v[WARP_SPEED] * k * (0.5f + lvl);
        P[Params.WARP_PHASE] = warpPhase;
        P[Params.DRIFT_X] = v[DRIFT_X] * k;
        P[Params.DRIFT_Y] = v[DRIFT_Y] * k;
        // Trails fade faster while the picture is over its brightness target, so it can't white out.
        float over = Math.min(2.5f, Math.max(0, fill - 1)), under = Math.max(0, 1 - fill);
        P[Params.DECAY] = (float) Math.pow(v[DECAY] * (1 - 0.025f * over + 0.012f * Math.min(0, trim)), k);
        P[Params.HUE] = v[HUE] * k;
        int mirror = ch[C_MIRROR].value();
        float mw = layer[L_MIRROR] * ch[C_MIRROR].fade;
        P[Params.MIRROR_X] = mirror != 1 ? mw : 0;
        P[Params.MIRROR_Y] = mirror != 0 ? mw : 0;

        palPhase += v[PAL_SPEED] * k * (1 + treb * 0.5f);
        P[Params.PAL_C0] = v[PAL_C0]; P[Params.PAL_C1] = v[PAL_C1]; P[Params.PAL_C2] = v[PAL_C2];
        P[Params.PAL_D0] = v[PAL_D0]; P[Params.PAL_D1] = v[PAL_D1]; P[Params.PAL_D2] = v[PAL_D2];
        P[Params.PAL_PHASE] = palPhase;
        P[Params.PAL_SPREAD] = v[PAL_SPREAD];

        P[Params.SPEC_RING] = layer[L_SPEC];
        P[Params.SPEC_RADIUS] = v[SPEC_RADIUS];
        P[Params.TUNNEL] = layer[L_TUNNEL] * ch[C_SIDES].fade;
        P[Params.TUNNEL_SIDES] = SIDES[ch[C_SIDES].value()];
        P[Params.SPARKLE] = layer[L_SPARKLE];
        P[Params.ORBS] = layer[L_ORBS];
        orbPhase += 0.012f * k * (1 + lvl);
        P[Params.ORB_PHASE] = orbPhase;
        P[Params.ADD] = (float) Math.exp(trim) / (1 + 0.7f * over);
        P[Params.BASS] = bass; P[Params.MID] = mid; P[Params.TREB] = treb; P[Params.LEVEL] = lvl;

        // Tunnel rings: born on beats, flying outward.
        for (int i = 0; i < 8; i++) {
            rings[i][0] *= (float) Math.pow(1.025f + 0.01f * lvl, k);
            rings[i][1] *= (float) Math.exp(-dt * 1.2f);
            if (rings[i][0] > 1.2f) rings[i][1] = 0;
            P[Params.RINGS + i * 2] = rings[i][0];
            P[Params.RINGS + i * 2 + 1] = rings[i][1] * 0.6f;
        }

        float sf = ch[C_SHAPE].fade;
        P[Params.W_CIRCLE] = shapeW[0] * sf; P[Params.W_LINE] = shapeW[1] * sf; P[Params.W_SCOPE] = shapeW[2] * sf;
        P[Params.W_SPIRAL] = shapeW[3] * sf; P[Params.W_ROSE] = shapeW[4] * sf; P[Params.W_LISS] = shapeW[5] * sf;
        P[Params.ROSE_K] = Math.round(v[ROSE_K]);
        P[Params.LISS_A] = Math.round(v[LISS_A]);
        P[Params.LISS_B] = Math.round(v[LISS_B]);
        lissPhase += v[LISS_SPEED] * k;
        P[Params.LISS_PHASE] = lissPhase;
        P[Params.WAVE_SCALE] = v[WAVE_SCALE] * (1 + 0.15f * pulse * v[BEAT_KICK]);
        P[Params.WAVE_GAIN] = v[WAVE_GAIN];
        P[Params.WAVE_THICK] = v[WAVE_THICK];
        waveAngle += v[WAVE_SPIN] * k;
        P[Params.WAVE_ANGLE] = waveAngle;
        P[Params.WAVE_BRIGHT] = v[WAVE_BRIGHT] * (0.35f + 0.9f * lvl) * ch[C_COPIES].fade;
        P[Params.COPIES] = copies();
        P[Params.COPY_ALPHA] = 0.7f;

        P[Params.FLAME] = v[FLAME] * layer[L_FLAME] * Math.min(ch[C_VAR_A].fade, ch[C_VAR_B].fade) * k;
        P[Params.VAR_A] = ch[C_VAR_A].value();
        P[Params.VAR_B] = ch[C_VAR_B].value();
        P[Params.VAR_MIX] = v[VAR_MIX];
        P[Params.AFF_ROT] = v[AFF_ROT]; P[Params.AFF_SCALE] = v[AFF_SCALE]; P[Params.AFF_X] = v[AFF_X]; P[Params.AFF_Y] = v[AFF_Y];
        P[Params.FLOW] = v[FLOW] * layer[L_FLOW] * k * (0.5f + lvl);
        P[Params.FLOW_SCALE] = v[FLOW_SCALE];
        flowPhase += v[FLOW_SPEED] * k;
        P[Params.FLOW_PHASE] = flowPhase;

        float kw = layer[L_KALEIDO] * ch[C_KALEIDO].fade;
        P[Params.KA] = kw > 0.001f ? KALEIDO_N[ch[C_KALEIDO].value()] : 0;
        P[Params.KAMT] = kw;
        kSpin += v[KSPIN] * k;
        P[Params.KSPIN] = kSpin;
        P[Params.CHROMA] = v[CHROMA] * layer[L_CHROMA] * (0.5f + bass * 0.5f);
        P[Params.ECHO] = 0.45f * layer[L_ECHO];
        P[Params.ECHO_ZOOM] = v[ECHO_ZOOM];
        echoAngle += v[ECHO_SPIN] * k;
        P[Params.ECHO_ANGLE] = echoAngle;
        P[Params.BRIGHT] = 1.5f * (1 + 0.8f * under) / (1 + 0.5f * over);
        P[Params.FLASH] = flash + v[BEAT_FLASH] * pulse * Math.min(1, bass);
        P[Params.VIGNETTE] = 0.6f;
        P[Params.SAT] = 0.25f + 0.25f * Math.min(1, over);
        P[Params.BLACK] = 0.02f + 0.08f * over;

        P[Params.VIEW] = ch[C_VIEW].value();
        P[Params.VIEW_AMT] = layer[L_VIEW] * ch[C_VIEW].fade;
        P[Params.VIEW_P1] = v[VIEW_P1];
        viewPhase += v[VIEW_SPEED] * k;
        P[Params.VIEW_PHASE] = viewPhase;
        P[Params.TILE] = ch[C_TILE].value();
        P[Params.TILE_AMT] = layer[L_TILE] * ch[C_TILE].fade;
        P[Params.TILE_SCALE] = v[TILE_SCALE];

        P[Params.ATTR_FAM] = ch[C_ATTR].value();
        P[Params.ATTR_BRIGHT] = 0.05f * layer[L_ATTR] * ch[C_ATTR].fade * (0.5f + lvl);
        P[Params.ATTR_SCALE] = v[ATTR_SCALE] * (1 + 0.1f * pulse);
        attrAngle += v[ATTR_SPIN] * k;
        P[Params.ATTR_SPIN] = attrAngle;
        P[Params.ATTR_SIZE] = 1.5f;
        P[Params.ATTR_A] = v[ATTR_A]; P[Params.ATTR_B] = v[ATTR_B]; P[Params.ATTR_C] = v[ATTR_C]; P[Params.ATTR_D] = v[ATTR_D];
        P[Params.ATTR_SEED] = (frameNo % 997) + 0.5f;
        P[Params.ATTR_ITER] = 24;
    }

    /** One line for the overlay. */
    String describe() {
        return "Species " + species + " · scene " + scene + " · complexity " + Math.round(complexity * 100) + "%"
                + " · exposure " + Math.round(fill * 100) + "%"
                + (lastEvent.isEmpty() ? "" : " · last: " + lastEvent);
    }
}
