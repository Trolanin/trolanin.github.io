package io.github.trolanin.ledaudio;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;

/**
 * A synthetic 120 BPM groove (kick, off-beat hi-hat, bass note) played like any music app plays.
 * It goes through the same capture path as other apps, so it shows whether capture works here.
 */
final class TestBeat {
    private static final int RATE = 44100;
    private volatile boolean playing;
    private Thread thread;

    boolean isPlaying() { return playing; }

    void start() {
        if (playing) return;
        playing = true;
        thread = new Thread(new Runnable() { @Override public void run() { loop(); } }, "test-beat");
        thread.start();
    }

    void stop() {
        playing = false;
        try { if (thread != null) thread.join(500); } catch (InterruptedException ignored) { }
        thread = null;
    }

    private void loop() {
        int min = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        AudioTrack track = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build())
                .setAudioFormat(new AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build())
                .setBufferSizeInBytes(Math.max(min, RATE / 10 * 2))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();
        track.play();
        short[] buf = new short[RATE / 50];   // 20 ms chunks
        long n = 0;
        java.util.Random rnd = new java.util.Random(1);
        while (playing) {
            for (int i = 0; i < buf.length; i++, n++) {
                double t = n / (double) RATE, b = t % 0.5, h = (t + 0.25) % 0.5;
                double kick = b < 0.35 ? Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-b * 30)) * b) * Math.exp(-b * 9) : 0;
                double hat = (rnd.nextDouble() * 2 - 1) * Math.exp(-h * 60) * 0.3;
                double bass = 0.15 * Math.sin(2 * Math.PI * 55 * t);
                double v = Math.max(-1, Math.min(1, 0.6 * kick + hat + bass));
                buf[i] = (short) (v * 30000);
            }
            track.write(buf, 0, buf.length);
        }
        track.stop();
        track.release();
    }
}
