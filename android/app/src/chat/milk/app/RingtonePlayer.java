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
    /** 本次来电是否请求了响铃，供 IncomingCallActivity 补响时判断 */
    static boolean ringRequested;
    /** 本次来电是否请求了震动（由 JS 侧"来电震动"开关传入） */
    static boolean vibrateRequested;

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
     * 开始来电提醒：是否响铃由 playSound 控制，是否震动由 vibrate 控制（JS 侧"来电震动"开关）。
     * 铃声走「铃声」音量（真机来电就该走铃声流）。幂等：已在响/正在震则忽略。
     */
    public static synchronized void start(Context ctx, boolean playSound, boolean vibrate) {
        startInternal(ctx, playSound, vibrate, false);
    }

    /**
     * 试听专用：铃声改装走「媒体」音量（USAGE_MEDIA / STREAM_MUSIC）。
     * 手机铃声音量是 0、或处于静音/振动模式时，走铃声流的试听会完全没声音，
     * 用户就以为"功能坏了"。试听走媒体流既有声音，也不影响真正来电时的铃声流行为。
     */
    public static synchronized void preview(Context ctx, boolean playSound, boolean vibrate) {
        startInternal(ctx, playSound, vibrate, true);
    }

    private static synchronized void startInternal(Context ctx, boolean playSound, boolean vibrate, boolean useMediaStream) {
        // 已经在响（或正在震）就不重复启动
        if (playSound ? isPlaying() : (vibrate && vibrating)) return;
        stopInternal();
        ringRequested = playSound;
        vibrateRequested = vibrate;
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
                    // 内置铃声：把 asset 拷成本地文件再播。
                    // 之前用 Assets.openFd()，但 aapt2 默认会把 mp3 压缩进 APK，
                    // openFd 对压缩过的资源会抛异常 → 内置铃声永远加载失败。
                    // 拷成文件后无论有没有被压缩都能正常播。
                    File builtin = ensureBuiltinRingtoneFile(app);
                    if (builtin != null) {
                        try {
                            player.setDataSource(builtin.getAbsolutePath());
                            loaded = true;
                        } catch (IOException ignored) {}
                    }
                }
                if (!loaded) {
                    Uri def = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                    if (def != null) player.setDataSource(app, def);
                }
                if (useMediaStream) {
                    player.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build());
                    player.setAudioStreamType(AudioManager.STREAM_MUSIC);
                } else {
                    player.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build());
                    player.setAudioStreamType(AudioManager.STREAM_RING);
                }
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

        if (vibrate) startVibrate(app);
        if (stopCap == null) {
            stopCap = new Runnable() {
                @Override
                public void run() { stop(app); }
            };
            handler.postDelayed(stopCap, RING_CAP_MS);
        }
    }

    /**
     * 把内置来电铃声从 assets 拷到缓存目录，返回本地文件。
     * 拷贝一次即可，后续直接复用；失败返回 null（上层会退到系统默认铃声）。
     */
    private static File ensureBuiltinRingtoneFile(Context app) {
        try {
            File f = new File(app.getCacheDir(), "builtin_invite_videocall.mp3");
            if (f.exists() && f.length() > 0) return f;
            java.io.InputStream is = null;
            java.io.FileOutputStream os = null;
            try {
                is = app.getAssets().open("www/assets/audio/invite_videocall.mp3");
                os = new java.io.FileOutputStream(f);
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
                os.flush();
            } finally {
                if (is != null) try { is.close(); } catch (Exception ignored) {}
                if (os != null) try { os.close(); } catch (Exception ignored) {}
            }
            return (f.exists() && f.length() > 0) ? f : null;
        } catch (Exception e) {
            return null;
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
        vibrateRequested = false;
        stopVibrate();
        releaseWakeLock();
    }

    private static void startVibrate(Context ctx) {
        try {
            vibrator = getVibrator(ctx);
            if (vibrator == null || !vibrator.hasVibrator()) { vibrator = null; return; }
            vibrating = true;
            final long[] pattern = VIBRATE_PATTERN;
            Runnable loop = new Runnable() {
                @Override
                public void run() {
                    if (!vibrating || vibrator == null) return;
                    if (Build.VERSION.SDK_INT >= 26) {
                        // 用最大振幅，保证真机上震感明显（默认振幅在部分机型上很弱）
                        int[] amps = amplitudeArray(pattern);
                        try {
                            vibrator.vibrate(VibrationEffect.createWaveform(pattern, amps, 0));
                        } catch (Exception e) {
                            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                        }
                    } else {
                        vibrator.vibrate(pattern, 0);
                    }
                }
            };
            loop.run();
        } catch (Exception e) { vibrator = null; }
    }

    /** 按 timings 生成振幅数组：震动段=255（最大），静止段=0 */
    static int[] amplitudeArray(long[] timings) {
        int[] amps = new int[timings.length];
        for (int i = 1; i < timings.length; i += 2) amps[i] = 255;
        return amps;
    }

    /**
     * 取系统震动器。Android 12(31) 起官方推荐 VibratorManager；
     * 老系统仍走 VIBRATOR_SERVICE。两条路都取不到就返回 null。
     */
    static android.os.Vibrator getVibrator(Context ctx) {
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                Object vm = ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (vm instanceof android.os.VibratorManager) {
                    android.os.Vibrator v = ((android.os.VibratorManager) vm).getDefaultVibrator();
                    if (v != null && v.hasVibrator()) return v;
                }
            }
        } catch (Exception ignored) {}
        return (android.os.Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
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
