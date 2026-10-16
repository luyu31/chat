package chat.milk.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

import java.io.File;
import java.io.IOException;

/**
 * 原生来电铃声播放器（像系统来电一样）：
 * 优先用户自选铃声（files/ringtone 或系统铃声 URI），否则用内置 invite_videocall.mp3。
 * 循环播放 + 来电震动节奏，60 秒未接自动停止（对应 JS 侧 60s 未接挂断）。
 */
public final class RingtonePlayer {

    public static final String PREFS = "milk_ringtone";
    public static final String KEY_NAME = "ringtone_name";
    public static final String KEY_URI = "ringtone_uri";

    private static final long RING_CAP_MS = 60000;
    private static final long[] VIBRATE_PATTERN = {0, 800, 600, 800, 1200};

    private static MediaPlayer player;
    private static Vibrator vibrator;
    private static Handler handler;
    private static Runnable stopCap;
    private static volatile boolean vibrating;
    private static PowerManager.WakeLock wakeLock;
    /** 本次来电是否请求了响铃（震动永远请求），供 IncomingCallActivity 补响时判断 */
    static boolean ringRequested;

    private RingtonePlayer() {}

    public static File ringtoneFile(Context ctx) {
        return new File(ctx.getFilesDir(), "ringtone");
    }

    public static boolean hasCustom(Context ctx) {
        return ringtoneFile(ctx).exists() || getUriPref(ctx) != null;
    }

    public static String getName(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String n = sp.getString(KEY_NAME, null);
        return n == null ? "" : n;
    }

    static String getUriPref(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_URI, null);
    }

    static void setPrefs(Context ctx, String name, String uri) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_NAME, name == null ? "" : name)
                .putString(KEY_URI, uri)
                .apply();
    }

    public static boolean isPlaying() {
        try { return player != null && player.isPlaying(); } catch (Exception e) { return false; }
    }

    /**
     * 开始来电提醒：永远震动（像手机来电），铃声是否播放由 playSound 控制。
     * 幂等：已在响/震则忽略。
     */
    public static synchronized void start(Context ctx, boolean playSound) {
        // 已经在响（或正在震）就不重复启动
        if (playSound ? isPlaying() : vibrating) return;
        stopInternal();
        ringRequested = playSound;
        Context app = ctx.getApplicationContext();
        if (handler == null) handler = new Handler(Looper.getMainLooper());

        // 响铃期间持有 PARTIAL_WAKE_LOCK，保证 CPU 不休眠、铃声和震动能持续到接听/超时
        acquireWakeLock(app);

        if (playSound) {
            player = new MediaPlayer();
            try {
                boolean loaded = false;
                File custom = ringtoneFile(app);
                if (custom.exists()) {
                    try {
                        player.setDataSource(custom.getAbsolutePath());
                        loaded = true;
                    } catch (IOException ignored) {}
                }
                if (!loaded) {
                    String uri = getUriPref(app);
                    if (uri != null) {
                        try {
                            player.setDataSource(app, Uri.parse(uri));
                            loaded = true;
                        } catch (Exception ignored) {}
                    }
                }
                if (!loaded) {
                    try {
                        player.setDataSource(app.getAssets().openFd("www/assets/audio/invite_videocall.mp3"));
                        loaded = true;
                    } catch (IOException ignored) {}
                }
                if (!loaded) {
                    Uri def = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                    if (def != null) player.setDataSource(app, def);
                }
                player.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build());
                player.setAudioStreamType(AudioManager.STREAM_RING);
                player.setLooping(true);
                player.setVolume(1f, 1f);
                player.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
                    @Override
                    public void onPrepared(MediaPlayer mp) { try { mp.start(); } catch (IllegalStateException ignored) {} }
                });
                player.prepareAsync();
            } catch (Exception e) {
                try { player.release(); } catch (Exception ignored) {}
                player = null;
            }
        }

        startVibrate(app);
        if (stopCap == null) {
            stopCap = new Runnable() {
                @Override
                public void run() { stop(app); }
            };
            handler.postDelayed(stopCap, RING_CAP_MS);
        }
    }

    /** 停止响铃与震动 */
    public static synchronized void stop(Context ctx) {
        stopInternal();
    }

    private static void stopInternal() {
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) {}
            try { player.release(); } catch (Exception ignored) {}
            player = null;
        }
        if (handler != null && stopCap != null) {
            handler.removeCallbacks(stopCap);
            stopCap = null;
        }
        ringRequested = false;
        stopVibrate();
        releaseWakeLock();
    }

    private static void startVibrate(Context ctx) {
        try {
            vibrator = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) { vibrator = null; return; }
            vibrating = true;
            final long[] pattern = VIBRATE_PATTERN;
            Runnable loop = new Runnable() {
                @Override
                public void run() {
                    if (!vibrating || vibrator == null) return;
                    if (Build.VERSION.SDK_INT >= 26) {
                        vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                    } else {
                        vibrator.vibrate(pattern, 0);
                    }
                }
            };
            loop.run();
        } catch (Exception e) { vibrator = null; }
    }

    private static void stopVibrate() {
        vibrating = false;
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
            vibrator = null;
        }
    }

    private static void acquireWakeLock(Context ctx) {
        try {
            if (wakeLock != null && wakeLock.isHeld()) return;
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "milkchat:ringtone");
            wakeLock.setReferenceCounted(false);
            // 超时兜底：即使 stop 没被调到，最多比铃声上限多 5 秒也会自动释放
            wakeLock.acquire(RING_CAP_MS + 5000);
        } catch (Exception e) { wakeLock = null; }
    }

    private static void releaseWakeLock() {
        if (wakeLock != null) {
            try { if (wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
            wakeLock = null;
        }
    }
}
