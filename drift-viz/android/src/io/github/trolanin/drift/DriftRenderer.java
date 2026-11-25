package io.github.trolanin.drift;

import android.opengl.GLES30;
import android.opengl.GLSurfaceView;
import android.util.Log;

import java.nio.Buffer;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * OpenGL ES 3.0 renderer. Per frame: feedback warp into the other half of a ping-pong pair,
 * the waveform and attractor added on top (additive blending), then the composite to the screen.
 * The feedback buffers are half-float when the GPU can render to them, and are kept at up to
 * about 1280 px on the long side so phones hold their frame rate.
 */
final class DriftRenderer implements GLSurfaceView.Renderer {
    private static final String TAG = "Drift";

    final Evolver evo = new Evolver(System.nanoTime());
    static volatile String glError;
    static volatile float fps;

    private int progWarp, progWave, progAttr, progComp;
    private int locWarp, locWave, locAttr, locComp;
    private final int[] tex = new int[2], fbo = new int[2];
    private int audioTex, vao, cur;
    private int screenW, screenH, fbW, fbH;
    private boolean halfFloat;
    private final float[] P = new float[Params.FLOATS];
    private final Analyzer.Frame frame = new Analyzer.Frame();
    private final FloatBuffer audioBuf = ByteBuffer.allocateDirect(512 * 2 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
    private long lastNs;
    private float fpsAcc;
    private int fpsFrames;
    private boolean ready;
    // Brightness readback: the feedback buffer blitted down to LUM x LUM, read through two PBOs.
    private static final int LUM = 32;
    private final int[] lumFbo = new int[1], lumTex = new int[1], pbo = new int[2];
    private int lumFrame, pboFilled;

    @Override
    public void onSurfaceCreated(GL10 unused, EGLConfig config) {
        ready = false;
        try {
            progWarp = program(Shaders.FULL_VS, Shaders.WARP_FS);
            progWave = program(Shaders.WAVE_VS, Shaders.WAVE_FS);
            progAttr = program(Shaders.ATTR_VS, Shaders.ATTR_FS);
            progComp = program(Shaders.FULL_VS, Shaders.COMP_FS);
        } catch (RuntimeException e) {
            glError = e.getMessage();
            Log.e(TAG, "shader build failed", e);
            return;
        }
        locWarp = GLES30.glGetUniformLocation(progWarp, "P");
        locWave = GLES30.glGetUniformLocation(progWave, "P");
        locAttr = GLES30.glGetUniformLocation(progAttr, "P");
        locComp = GLES30.glGetUniformLocation(progComp, "P");

        // Draws use gl_VertexID only, but ES 3 still wants a vertex array bound.
        int[] ids = new int[1];
        GLES30.glGenVertexArrays(1, ids, 0);
        vao = ids[0];
        GLES30.glBindVertexArray(vao);

        // Audio: row 0 the waveform (512), row 1 the spectrum (128). Read with texelFetch.
        GLES30.glGenTextures(1, ids, 0);
        audioTex = ids[0];
        GLES30.glActiveTexture(GLES30.GL_TEXTURE1);
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, audioTex);
        GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_R32F, 512, 2, 0, GLES30.GL_RED, GLES30.GL_FLOAT, null);
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_NEAREST);
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_NEAREST);
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0);

        String ext = GLES30.glGetString(GLES30.GL_EXTENSIONS);
        halfFloat = ext != null && (ext.contains("GL_EXT_color_buffer_half_float") || ext.contains("GL_EXT_color_buffer_float"));
        GLES30.glGenTextures(1, lumTex, 0);
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, lumTex[0]);
        GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA8, LUM, LUM, 0, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, null);
        GLES30.glGenFramebuffers(1, lumFbo, 0);
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, lumFbo[0]);
        GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, lumTex[0], 0);
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        GLES30.glGenBuffers(2, pbo, 0);
        for (int i = 0; i < 2; i++) {
            GLES30.glBindBuffer(GLES30.GL_PIXEL_PACK_BUFFER, pbo[i]);
            GLES30.glBufferData(GLES30.GL_PIXEL_PACK_BUFFER, LUM * LUM * 4, null, GLES30.GL_STREAM_READ);
        }
        GLES30.glBindBuffer(GLES30.GL_PIXEL_PACK_BUFFER, 0);
        pboFilled = 0;
        tex[0] = tex[1] = 0;
        lastNs = 0;
        ready = true;
    }

    private static int shader(int type, String body) {
        int s = GLES30.glCreateShader(type);
        GLES30.glShaderSource(s, Shaders.build(body));
        GLES30.glCompileShader(s);
        int[] ok = new int[1];
        GLES30.glGetShaderiv(s, GLES30.GL_COMPILE_STATUS, ok, 0);
        if (ok[0] == 0) {
            String log = GLES30.glGetShaderInfoLog(s);
            GLES30.glDeleteShader(s);
            throw new RuntimeException("Shader compile failed: " + log);
        }
        return s;
    }

    private static int program(String vs, String fs) {
        int p = GLES30.glCreateProgram();
        GLES30.glAttachShader(p, shader(GLES30.GL_VERTEX_SHADER, vs));
        GLES30.glAttachShader(p, shader(GLES30.GL_FRAGMENT_SHADER, fs));
        GLES30.glLinkProgram(p);
        int[] ok = new int[1];
        GLES30.glGetProgramiv(p, GLES30.GL_LINK_STATUS, ok, 0);
        if (ok[0] == 0) throw new RuntimeException("Shader link failed: " + GLES30.glGetProgramInfoLog(p));
        GLES30.glUseProgram(p);
        GLES30.glUniform1i(GLES30.glGetUniformLocation(p, "tex0"), 0);
        GLES30.glUniform1i(GLES30.glGetUniformLocation(p, "audioTex"), 1);
        return p;
    }

    @Override
    public void onSurfaceChanged(GL10 unused, int w, int h) {
        screenW = w;
        screenH = h;
        if (!ready) return;
        float s = Math.min(1f, 1280f / Math.max(w, h));
        fbW = Math.max(16, Math.round(w * s));
        fbH = Math.max(16, Math.round(h * s));
        if (tex[0] != 0) {
            GLES30.glDeleteTextures(2, tex, 0);
            GLES30.glDeleteFramebuffers(2, fbo, 0);
        }
        if (!makeTargets(halfFloat) && halfFloat) {
            halfFloat = false;
            GLES30.glDeleteTextures(2, tex, 0);
            GLES30.glDeleteFramebuffers(2, fbo, 0);
            makeTargets(false);
        }
    }

    private boolean makeTargets(boolean hf) {
        GLES30.glGenTextures(2, tex, 0);
        GLES30.glGenFramebuffers(2, fbo, 0);
        boolean ok = true;
        for (int i = 0; i < 2; i++) {
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, tex[i]);
            if (hf) GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA16F, fbW, fbH, 0, GLES30.GL_RGBA, GLES30.GL_HALF_FLOAT, null);
            else GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA8, fbW, fbH, 0, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, null);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_MIRRORED_REPEAT);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_MIRRORED_REPEAT);
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo[i]);
            GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, tex[i], 0);
            if (GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER) != GLES30.GL_FRAMEBUFFER_COMPLETE) ok = false;
            GLES30.glClearColor(0, 0, 0, 1);
            GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT);
        }
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        return ok;
    }

    @Override
    public void onDrawFrame(GL10 unused) {
        if (!ready || tex[0] == 0) {
            GLES30.glClearColor(0, 0, 0, 1);
            GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT);
            return;
        }
        long now = System.nanoTime();
        float dt = lastNs == 0 ? 1f / 60 : Math.min(0.1f, Math.max(0.001f, (now - lastNs) / 1e9f));
        lastNs = now;
        fpsAcc += dt;
        if (++fpsFrames >= 30) { fps = fpsFrames / fpsAcc; fpsFrames = 0; fpsAcc = 0; }

        AudioIn.ANALYZER.snapshot(frame);
        evo.update(dt, frame);
        evo.build(P, frame, dt, fbW, fbH);

        audioBuf.position(0);
        audioBuf.put(frame.wave);
        audioBuf.put(frame.spec);
        for (int i = Analyzer.SPEC_N; i < 512; i++) audioBuf.put(0f);
        audioBuf.position(0);
        GLES30.glActiveTexture(GLES30.GL_TEXTURE1);
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, audioTex);
        GLES30.glTexSubImage2D(GLES30.GL_TEXTURE_2D, 0, 0, 0, 512, 2, GLES30.GL_RED, GLES30.GL_FLOAT, audioBuf);
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0);
        GLES30.glBindVertexArray(vao);

        // 1. feedback warp
        int dst = 1 - cur;
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo[dst]);
        GLES30.glViewport(0, 0, fbW, fbH);
        GLES30.glDisable(GLES30.GL_BLEND);
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, tex[cur]);
        GLES30.glUseProgram(progWarp);
        GLES30.glUniform4fv(locWarp, Params.VEC4S, P, 0);
        GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, 3);

        // 2. waveform and 3. attractor, added on top
        GLES30.glEnable(GLES30.GL_BLEND);
        GLES30.glBlendFunc(GLES30.GL_ONE, GLES30.GL_ONE);
        GLES30.glUseProgram(progWave);
        GLES30.glUniform4fv(locWave, Params.VEC4S, P, 0);
        GLES30.glDrawArraysInstanced(GLES30.GL_TRIANGLES, 0, 255 * 6, evo.copies());
        int pts = evo.attrPoints();
        if (pts > 0) {
            GLES30.glUseProgram(progAttr);
            GLES30.glUniform4fv(locAttr, Params.VEC4S, P, 0);
            GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, pts * 6);
        }
        GLES30.glDisable(GLES30.GL_BLEND);
        if ((++lumFrame & 3) == 0) measure(dst);

        // 4. composite to the screen
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        GLES30.glViewport(0, 0, screenW, screenH);
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, tex[dst]);
        GLES30.glUseProgram(progComp);
        GLES30.glUniform4fv(locComp, Params.VEC4S, P, 0);
        GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, 3);
        cur = dst;
    }

    /** Starts an async readback of the frame just drawn and reads the one started 4 frames ago. */
    private void measure(int src) {
        int slot = (lumFrame >> 2) & 1;
        GLES30.glBindFramebuffer(GLES30.GL_READ_FRAMEBUFFER, fbo[src]);
        GLES30.glBindFramebuffer(GLES30.GL_DRAW_FRAMEBUFFER, lumFbo[0]);
        GLES30.glBlitFramebuffer(0, 0, fbW, fbH, 0, 0, LUM, LUM, GLES30.GL_COLOR_BUFFER_BIT, GLES30.GL_LINEAR);
        GLES30.glBindFramebuffer(GLES30.GL_READ_FRAMEBUFFER, lumFbo[0]);
        GLES30.glBindBuffer(GLES30.GL_PIXEL_PACK_BUFFER, pbo[slot]);
        GLES30.glReadPixels(0, 0, LUM, LUM, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, 0);
        pboFilled++;
        if (pboFilled >= 2) {
            GLES30.glBindBuffer(GLES30.GL_PIXEL_PACK_BUFFER, pbo[1 - slot]);
            Buffer b = GLES30.glMapBufferRange(GLES30.GL_PIXEL_PACK_BUFFER, 0, LUM * LUM * 4, GLES30.GL_MAP_READ_BIT);
            if (b instanceof ByteBuffer) {
                ByteBuffer px = (ByteBuffer) b;
                long sum = 0;
                for (int i = 0; i < LUM * LUM; i++) {
                    int r = px.get(i * 4) & 0xFF, g = px.get(i * 4 + 1) & 0xFF, bl = px.get(i * 4 + 2) & 0xFF;
                    sum += 54 * r + 183 * g + 19 * bl;   // Rec. 709 luma, x256
                }
                evo.setMeanLum(sum / (256f * 255f * LUM * LUM));
            }
            GLES30.glUnmapBuffer(GLES30.GL_PIXEL_PACK_BUFFER);
        }
        GLES30.glBindBuffer(GLES30.GL_PIXEL_PACK_BUFFER, 0);
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
    }
}
