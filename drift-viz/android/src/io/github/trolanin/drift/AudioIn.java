package io.github.trolanin.drift;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.os.Process;

/**
 * Feeds {@link #ANALYZER} from one source at a time: the silent demo groove, the microphone, or
 * other apps' playback (Android 10+ playback capture, through a MediaProjection held by
 * {@link CaptureService}). Starting a source stops the previous one.
 */
final class AudioIn {
    static final int DEMO = 0, MIC = 1, PHONE = 2;
    static final Analyzer ANALYZER = new Analyzer();

    static volatile int source = -1;
    static volatile String error;

    private static Thread thread;
    private static volatile boolean stopping;
    private static AudioRecord record;

    private AudioIn() { }

    static synchronized void startDemo() {
        stop();
        source = DEMO;
        run(new Runnable() {
            @Override public void run() {
                DemoSynth syn = new DemoSynth();
                float[] buf = new float[Analyzer.HOP];
                long next = System.nanoTime();
                while (!stopping) {
                    syn.render(buf, buf.length);
                    ANALYZER.push(buf, buf.length);
                    next += 10_000_000L;
                    long wait = next - System.nanoTime();
                    if (wait < -200_000_000L) next = System.nanoTime();
                    if (wait > 0) {
                        try { Thread.sleep(wait / 1_000_000L, (int) (wait % 1_000_000L)); } catch (InterruptedException e) { return; }
                    }
                }
            }
        });
    }

    /** Needs RECORD_AUDIO already granted. */
    static synchronized void startMic() {
        stop();
        try {
            record = new AudioRecord.Builder()
                    .setAudioSource(MediaRecorder.AudioSource.MIC)
                    .setAudioFormat(format())
                    .setBufferSizeInBytes(bufferBytes())
                    .build();
            startRecord(MIC);
        } catch (Exception e) {
            fail("Microphone: " + e.getMessage());
        }
    }

    /** Needs RECORD_AUDIO and a running media projection. */
    static synchronized void startPlayback(MediaProjection projection) {
        stop();
        try {
            AudioPlaybackCaptureConfiguration cfg = new AudioPlaybackCaptureConfiguration.Builder(projection)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                    .build();
            record = new AudioRecord.Builder()
                    .setAudioFormat(format())
                    .setBufferSizeInBytes(bufferBytes())
                    .setAudioPlaybackCaptureConfig(cfg)
                    .build();
            startRecord(PHONE);
        } catch (Exception e) {
            fail("Phone audio: " + e.getMessage());
        }
    }

    private static AudioFormat format() {
        return new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(Analyzer.RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                .build();
    }

    private static int bufferBytes() {
        int min = AudioRecord.getMinBufferSize(Analyzer.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        return Math.max(min, Analyzer.HOP * 2 * 4);
    }

    private static void startRecord(int src) {
        if (record.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("couldn't open the recorder");
        record.startRecording();
        error = null;
        source = src;
        final AudioRecord rec = record;
        // Anonymous classes, not lambdas: android.jar can't back javac's lambda bootstrap.
        run(new Runnable() {
            @Override public void run() {
                short[] pcm = new short[Analyzer.HOP];
                float[] f = new float[Analyzer.HOP];
                while (!stopping) {
                    int n = rec.read(pcm, 0, pcm.length, AudioRecord.READ_BLOCKING);
                    if (n < 0) { error = "Capture stopped (" + n + ")."; break; }
                    for (int i = 0; i < n; i++) f[i] = pcm[i] / 32768f;
                    if (n > 0) ANALYZER.push(f, n);
                }
            }
        });
    }

    private static void run(Runnable r) {
        stopping = false;
        final Runnable body = r;
        thread = new Thread(new Runnable() {
            @Override public void run() {
                Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
                body.run();
            }
        }, "audio-in");
        thread.start();
    }

    private static void fail(String msg) {
        error = msg;
        stop();
        startDemo();
        error = msg;   // keep the message visible over the demo
    }

    static synchronized void stop() {
        stopping = true;
        if (record != null) { try { record.stop(); } catch (Exception ignored) { } }
        if (thread != null) {
            try { thread.join(500); } catch (InterruptedException ignored) { }
            thread = null;
        }
        if (record != null) { record.release(); record = null; }
        source = -1;
    }
}
