package io.github.trolanin.drift;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.opengl.GLSurfaceView;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Full-screen visualizer. Tap to show or hide the panel: pick the sound source (the silent demo
 * groove, what this phone plays, or the microphone) or jump to a new look.
 */
public final class MainActivity extends Activity {
    private static final int REQ_PHONE = 1, REQ_MIC = 2, REQ_PROJECTION = 3;

    private GLSurfaceView view;
    private DriftRenderer renderer;
    private LinearLayout panel;
    private TextView status;
    private Button phoneBtn, micBtn, demoBtn;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private long panelUntil;

    // Anonymous classes, not lambdas: android.jar can't back javac's lambda bootstrap.
    private final Runnable tick = new Runnable() {
        @Override public void run() { refresh(); ui.postDelayed(this, 250); }
    };

    private int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        view = new GLSurfaceView(this);
        view.setEGLContextClientVersion(3);
        view.setEGLConfigChooser(8, 8, 8, 8, 0, 0);
        view.setPreserveEGLContextOnPause(true);
        renderer = new DriftRenderer();
        view.setRenderer(renderer);
        view.setOnTouchListener(new View.OnTouchListener() {
            @Override public boolean onTouch(View v, MotionEvent e) {
                if (e.getAction() == MotionEvent.ACTION_UP) togglePanel();
                return true;
            }
        });

        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(16), dp(14), dp(16), dp(14));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(200, 10, 12, 16));
        bg.setCornerRadius(dp(14));
        panel.setBackground(bg);

        TextView title = new TextView(this);
        title.setText("Drift");
        title.setTextColor(Color.WHITE);
        title.setTextSize(20);
        panel.addView(title);

        status = new TextView(this);
        status.setTextColor(Color.rgb(0xB8, 0xC0, 0xCC));
        status.setTextSize(13);
        status.setPadding(0, dp(4), 0, dp(10));
        panel.addView(status);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        phoneBtn = button("Phone audio", new View.OnClickListener() {
            @Override public void onClick(View v) { startPhone(); }
        });
        micBtn = button("Microphone", new View.OnClickListener() {
            @Override public void onClick(View v) { startMic(); }
        });
        demoBtn = button("Demo beat", new View.OnClickListener() {
            @Override public void onClick(View v) { stopService(new Intent(MainActivity.this, CaptureService.class)); AudioIn.error = null; AudioIn.startDemo(); }
        });
        row.addView(phoneBtn, weight());
        row.addView(micBtn, weight());
        row.addView(demoBtn, weight());
        panel.addView(row);

        Button next = button("New look", new View.OnClickListener() {
            @Override public void onClick(View v) {
                view.queueEvent(new Runnable() { @Override public void run() { renderer.evo.newSpecies("you asked"); } });
                showPanel();
            }
        });
        panel.addView(next, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        TextView hint = new TextView(this);
        hint.setText("Phone audio shows Android's screen-sharing prompt: that's how it grants sound capture, no video is recorded. "
                + "Some apps (Chrome, for one) block capture of their sound; music apps like YouTube Music and Spotify usually allow it. "
                + "Tap anywhere to hide this.");
        hint.setTextColor(Color.rgb(0x8A, 0x93, 0xA3));
        hint.setTextSize(12);
        hint.setPadding(0, dp(8), 0, 0);
        panel.addView(hint);

        FrameLayout root = new FrameLayout(this);
        root.addView(view);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM);
        lp.setMargins(dp(12), dp(12), dp(12), dp(28));
        root.addView(panel, lp);
        setContentView(root);

        if (AudioIn.source < 0) AudioIn.startDemo();
        showPanel();
    }

    private Button button(String text, View.OnClickListener l) {
        Button btn = new Button(this);
        btn.setText(text);
        btn.setAllCaps(false);
        btn.setOnClickListener(l);
        return btn;
    }

    private LinearLayout.LayoutParams weight() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
        p.setMargins(0, 0, dp(4), 0);
        return p;
    }

    private void showPanel() { panel.setVisibility(View.VISIBLE); panelUntil = System.currentTimeMillis() + 6000; }

    private void togglePanel() {
        if (panel.getVisibility() == View.VISIBLE) panel.setVisibility(View.GONE); else showPanel();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override protected void onResume() { super.onResume(); view.onResume(); ui.post(tick); }
    @Override protected void onPause() { super.onPause(); view.onPause(); ui.removeCallbacks(tick); }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (isFinishing()) {
            stopService(new Intent(this, CaptureService.class));
            AudioIn.stop();
        }
    }

    private void refresh() {
        if (panel.getVisibility() == View.VISIBLE && System.currentTimeMillis() > panelUntil) panel.setVisibility(View.GONE);
        int src = AudioIn.source;
        String s = src == AudioIn.PHONE ? "Listening to this phone" : src == AudioIn.MIC ? "Listening to the microphone"
                : "Demo beat (silent)";
        StringBuilder sb = new StringBuilder(s);
        sb.append(" · ").append(Math.round(DriftRenderer.fps)).append(" fps\n").append(renderer.evo.describe());
        if (AudioIn.error != null) sb.append("\n").append(AudioIn.error);
        if (DriftRenderer.glError != null) sb.append("\n").append(DriftRenderer.glError);
        status.setText(sb);
        phoneBtn.setEnabled(src != AudioIn.PHONE);
        micBtn.setEnabled(src != AudioIn.MIC);
        demoBtn.setEnabled(src != AudioIn.DEMO);
    }

    // ---------------- sources ----------------

    private boolean hasMic() { return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED; }

    private void startMic() {
        showPanel();
        if (!hasMic()) { requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, REQ_MIC); return; }
        stopService(new Intent(this, CaptureService.class));
        AudioIn.startMic();
    }

    private void startPhone() {
        showPanel();
        boolean needNotif = Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED;
        if (!hasMic() || needNotif) {
            requestPermissions(needNotif
                    ? new String[] { Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS }
                    : new String[] { Manifest.permission.RECORD_AUDIO }, REQ_PHONE);
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
        if (!hasMic()) {
            AudioIn.error = req == REQ_PHONE
                    ? "Android only allows capturing other apps' sound with the microphone permission (the mic itself isn't used)."
                    : "The microphone permission was not given.";
            return;
        }
        if (req == REQ_PHONE) askProjection();
        else if (req == REQ_MIC) startMic();
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int req, int code, Intent data) {
        super.onActivityResult(req, code, data);
        if (req != REQ_PROJECTION) return;
        if (code != RESULT_OK || data == null) { AudioIn.error = "Sharing was cancelled."; return; }
        startForegroundService(new Intent(this, CaptureService.class)
                .putExtra(CaptureService.EXTRA_CODE, code)
                .putExtra(CaptureService.EXTRA_DATA, data));
    }
}
