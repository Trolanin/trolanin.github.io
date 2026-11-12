package io.github.trolanin.ledaudio;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** One screen: start/stop capture, live meter, and a shortcut to the designer. */
public final class MainActivity extends Activity {
    static final String DESIGNER_URL = "https://trolanin.github.io/led-sim/designer.html";
    private static final int REQ_PERMS = 1, REQ_PROJECTION = 2;

    private TextView status;
    private Button toggle, beatBtn;
    private static final TestBeat beat = new TestBeat();   // survives screen rotation
    private Meter meter;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override public void run() { refresh(); ui.postDelayed(this, 33); }
    };

    private int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    private TextView text(String s, float sp) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setPadding(0, dp(6), 0, dp(6));
        return t;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(20), dp(20), dp(20), dp(20));

        col.addView(text("Sends whatever this phone is playing to the LED designer open in this phone's browser, "
                + "the same way led-audio.exe does on a PC.", 15));

        status = text("", 16);
        col.addView(status);

        meter = new Meter(this);
        col.addView(meter, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(120)));

        toggle = new Button(this);
        // Anonymous classes, not lambdas: android.jar can't back javac's lambda bootstrap.
        toggle.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { if (CaptureService.running) stopCapture(); else startCapture(); }
        });
        col.addView(toggle, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)));

        beatBtn = new Button(this);
        beatBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { if (beat.isPlaying()) beat.stop(); else beat.start(); refresh(); }
        });
        col.addView(beatBtn, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)));

        Button open = new Button(this);
        open.setText("Open the LED designer");
        open.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(DESIGNER_URL))); }
        });
        col.addView(open, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)));

        col.addView(text("How to use\n"
                + "1. Tap Start and allow sharing. Android shows a screen-sharing prompt because that's how it "
                + "grants audio capture; no video is recorded.\n"
                + "2. Play music in a music app (see below).\n"
                + "3. Open the designer. If Chrome asks to let the page access other apps and services on this device, "
                + "allow it. The audio badge should say \"Live\".\n\n"
                + "Use a music app (YouTube and YouTube Music allow capture). Some apps block capture of their sound; "
                + "Chrome is one, so music playing in a browser tab won't show up. If the bars stay flat, try "
                + "another app, or the test beat above to check capture itself works.", 14));

        ScrollView scroll = new ScrollView(this);
        scroll.setFitsSystemWindows(true);
        scroll.addView(col);
        setContentView(scroll);
    }

    @Override protected void onResume() { super.onResume(); ui.post(tick); }
    @Override protected void onPause() { super.onPause(); ui.removeCallbacks(tick); }

    private void refresh() {
        boolean on = CaptureService.running;
        toggle.setText(on ? "Stop" : "Start");
        beatBtn.setText(beat.isPlaying() ? "Stop test beat" : "Play a test beat (checks capture works)");
        String err = CaptureService.error;
        if (on) {
            int n = CaptureService.clients;
            status.setText("Listening · " + (n == 0 ? "designer not connected yet" : n == 1 ? "1 designer tab connected" : n + " designer tabs connected"));
        } else {
            status.setText(err != null ? "Stopped: " + err : "Stopped");
        }
        meter.invalidate();
    }

    private void startCapture() {
        boolean needNotif = Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || needNotif) {
            requestPermissions(needNotif
                    ? new String[] { Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS }
                    : new String[] { Manifest.permission.RECORD_AUDIO }, REQ_PERMS);
            return;
        }
        askProjection();
    }

    @SuppressWarnings("deprecation")
    private void askProjection() {
        MediaProjectionManager mpm = getSystemService(MediaProjectionManager.class);
        // Whole-device sharing, so audio from every app is included.
        Intent i = Build.VERSION.SDK_INT >= 34
                ? mpm.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
                : mpm.createScreenCaptureIntent();
        startActivityForResult(i, REQ_PROJECTION);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req != REQ_PERMS) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) askProjection();
        else CaptureService.error = "Android only allows playback capture with the microphone permission (the mic itself isn't used).";
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int req, int code, Intent data) {
        super.onActivityResult(req, code, data);
        if (req != REQ_PROJECTION) return;
        if (code != RESULT_OK || data == null) { CaptureService.error = "Sharing was cancelled."; return; }
        Intent svc = new Intent(this, CaptureService.class)
                .putExtra(CaptureService.EXTRA_CODE, code)
                .putExtra(CaptureService.EXTRA_DATA, data);
        startForegroundService(svc);
    }

    private void stopCapture() {
        stopService(new Intent(this, CaptureService.class));
        CaptureService.error = null;
    }

    /** 16 band bars plus a level bar, read from the service's latest frame. */
    static final class Meter extends View {
        private final Paint bar = new Paint(Paint.ANTI_ALIAS_FLAG), track = new Paint(), lvl = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final byte[] f = new byte[Analyzer.FRAME_LEN];

        Meter(Context c) {
            super(c);
            bar.setColor(Color.rgb(0x3D, 0xDC, 0x97));
            lvl.setColor(Color.rgb(0x7B, 0x8C, 0xFF));
            track.setColor(Color.argb(40, 128, 128, 128));
        }

        @Override
        protected void onDraw(Canvas c) {
            synchronized (CaptureService.lastFrame) { System.arraycopy(CaptureService.lastFrame, 0, f, 0, f.length); }
            int w = getWidth(), h = getHeight(), slots = Analyzer.BANDS + 2;
            float sw = w / (float) slots, gap = sw * 0.2f;
            for (int i = 0; i < slots; i++) {
                if (i == Analyzer.BANDS) continue;   // spacer before the level bar
                float x = i * sw;
                int v = (i < Analyzer.BANDS ? f[3 + i] : f[1]) & 0xFF;
                c.drawRect(x, 0, x + sw - gap, h, track);
                float top = h - h * v / 254f;
                c.drawRect(x, top, x + sw - gap, h, i < Analyzer.BANDS ? bar : lvl);
            }
        }
    }
}
