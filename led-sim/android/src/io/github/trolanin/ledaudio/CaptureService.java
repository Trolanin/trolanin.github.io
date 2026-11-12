package io.github.trolanin.ledaudio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Process;

/**
 * Captures what other apps are playing (Android 10+ playback capture), analyses it exactly like
 * led-audio.exe, and serves 19-byte frames every 10 ms on ws://127.0.0.1:8000 for the LED
 * designer / simulator open in this phone's browser.
 */
public final class CaptureService extends Service {
    static final String EXTRA_CODE = "code", EXTRA_DATA = "data";
    static final int PORT = 8000, RATE = 48000, HOP = RATE / 100;   // 10 ms

    // Read by MainActivity for its status display.
    static volatile boolean running;
    static volatile String error;
    static volatile int clients;
    static final byte[] lastFrame = new byte[Analyzer.FRAME_LEN];

    private MediaProjection projection;
    private AudioRecord record;
    private WsServer ws;
    private Thread captureThread, tickThread;
    private volatile boolean stopping;
    private final Analyzer analyzer = new Analyzer();
    private volatile long lastDataNs;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (running || intent == null) return START_NOT_STICKY;
        error = null;
        startForeground(1, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        try {
            int code = intent.getIntExtra(EXTRA_CODE, 0);
            Intent data = android.os.Build.VERSION.SDK_INT >= 33
                    ? intent.getParcelableExtra(EXTRA_DATA, Intent.class)
                    : legacyIntentExtra(intent);
            MediaProjectionManager mpm = getSystemService(MediaProjectionManager.class);
            projection = mpm.getMediaProjection(code, data);
            if (projection == null) throw new IllegalStateException("Sharing permission was not granted.");
            projection.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() { stopSelf(); }
            }, new Handler(Looper.getMainLooper()));

            AudioPlaybackCaptureConfiguration cfg = new AudioPlaybackCaptureConfiguration.Builder(projection)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                    .build();
            AudioFormat fmt = new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(RATE)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                    .build();
            int minBuf = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            record = new AudioRecord.Builder()
                    .setAudioFormat(fmt)
                    .setBufferSizeInBytes(Math.max(minBuf, HOP * 2 * 4))
                    .setAudioPlaybackCaptureConfig(cfg)
                    .build();
            record.startRecording();

            ws = new WsServer();
            ws.start(PORT);
        } catch (SecurityException e) {
            return fail("Microphone permission is needed for playback capture.");
        } catch (java.net.BindException e) {
            return fail("Port " + PORT + " is busy. Is another copy running?");
        } catch (Exception e) {
            return fail(e.getMessage() != null ? e.getMessage() : e.toString());
        }

        running = true;
        stopping = false;
        lastDataNs = System.nanoTime();
        // Anonymous classes, not lambdas: android.jar can't back javac's lambda bootstrap.
        captureThread = new Thread(new Runnable() { @Override public void run() { captureLoop(); } }, "capture");
        tickThread = new Thread(new Runnable() { @Override public void run() { tickLoop(); } }, "frames");
        captureThread.start();
        tickThread.start();
        return START_NOT_STICKY;
    }

    @SuppressWarnings("deprecation")
    private static Intent legacyIntentExtra(Intent intent) { return intent.getParcelableExtra(EXTRA_DATA); }

    private int fail(String msg) {
        error = msg;
        cleanup();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
        return START_NOT_STICKY;
    }

    private void captureLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        short[] pcm = new short[HOP];
        float[] f = new float[HOP];
        while (!stopping) {
            int n = record.read(pcm, 0, HOP, AudioRecord.READ_BLOCKING);
            if (n <= 0) { if (n < 0) { error = "Capture stopped (" + n + ")."; break; } continue; }
            for (int i = 0; i < n; i++) f[i] = pcm[i] / 32768f;
            synchronized (analyzer) { analyzer.push(f, n); }
            lastDataNs = System.nanoTime();
        }
    }

    private void tickLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        byte[] frame = new byte[Analyzer.FRAME_LEN];
        long period = 10_000_000L, next = System.nanoTime();
        while (!stopping) {
            long now = System.nanoTime();
            if (now < next) {
                long ms = (next - now) / 1_000_000L;
                try { if (ms > 0) Thread.sleep(ms); else Thread.yield(); } catch (InterruptedException e) { return; }
                continue;
            }
            next += period;
            if (now - next > 100_000_000L) next = now + period;
            synchronized (analyzer) {
                // Nothing playing can mean no data at all; feed silence so the bars fall.
                if (now - lastDataNs > 30_000_000L) analyzer.pushSilence(HOP);
                analyzer.frame(RATE, HOP, frame);
            }
            ws.broadcast(frame);
            clients = ws.clients();
            synchronized (lastFrame) { System.arraycopy(frame, 0, lastFrame, 0, frame.length); }
        }
    }

    private Notification buildNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("capture", "Audio capture", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, "capture")
                .setSmallIcon(R.drawable.icon)
                .setContentTitle("LED Audio is listening")
                .setContentText("Sending this phone's sound to the LED designer")
                .setContentIntent(open)
                .setOngoing(true)
                .build();
    }

    private void cleanup() {
        stopping = true;
        running = false;
        clients = 0;
        if (record != null) {
            try { record.stop(); } catch (Exception ignored) { }
        }
        try { if (captureThread != null) captureThread.join(500); } catch (InterruptedException ignored) { }
        try { if (tickThread != null) tickThread.join(500); } catch (InterruptedException ignored) { }
        if (record != null) { record.release(); record = null; }
        if (ws != null) { ws.stop(); ws = null; }
        if (projection != null) { try { projection.stop(); } catch (Exception ignored) { } projection = null; }
        synchronized (lastFrame) { java.util.Arrays.fill(lastFrame, (byte) 0); }
    }

    @Override
    public void onDestroy() {
        cleanup();
        super.onDestroy();
    }
}
