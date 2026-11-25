package io.github.trolanin.drift;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/**
 * Holds the MediaProjection that Android requires for capturing other apps' sound, as a
 * foreground service (Android insists). The audio itself is read by {@link AudioIn}.
 */
public final class CaptureService extends Service {
    static final String EXTRA_CODE = "code", EXTRA_DATA = "data";
    static volatile boolean running;
    private MediaProjection projection;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        startForeground(1, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        try {
            if (projection != null) { projection.stop(); projection = null; }
            int code = intent.getIntExtra(EXTRA_CODE, 0);
            Intent data = android.os.Build.VERSION.SDK_INT >= 33
                    ? intent.getParcelableExtra(EXTRA_DATA, Intent.class)
                    : legacyIntentExtra(intent);
            projection = getSystemService(MediaProjectionManager.class).getMediaProjection(code, data);
            if (projection == null) throw new IllegalStateException("sharing was not granted");
            projection.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() { stopSelf(); }
            }, new Handler(Looper.getMainLooper()));
            AudioIn.startPlayback(projection);
            running = true;
        } catch (Exception e) {
            AudioIn.error = "Phone audio: " + e.getMessage();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @SuppressWarnings("deprecation")
    private static Intent legacyIntentExtra(Intent intent) { return intent.getParcelableExtra(EXTRA_DATA); }

    private Notification buildNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("capture", "Listening", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, "capture")
                .setSmallIcon(R.drawable.icon)
                .setContentTitle("Drift is listening")
                .setContentText("Visualizing what this phone plays")
                .setContentIntent(open)
                .setOngoing(true)
                .build();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (AudioIn.source == AudioIn.PHONE) AudioIn.startDemo();
        if (projection != null) { try { projection.stop(); } catch (Exception ignored) { } projection = null; }
        super.onDestroy();
    }
}
