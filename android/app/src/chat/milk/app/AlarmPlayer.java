package chat.milk.app;

import android.content.Context;
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

/**
 * 闹钟播放器 —— 让定时问候像手机原生闹钟一样「真的响」。
 *
 * 和来电铃声（RingtonePlayer）的关键区别：
 *  - 走「闹钟」音量流 STREAM_ALARM：手机静音/仅振动时照样出声，这也是原生闹钟的行为
 *  - 音量由小到大渐强（0.35 → 1.0），不会一上来就吓一跳
 *  - 持续震动（最大振幅，循环节奏），直到用户「停止」或「贪睡」
 *  - 最长响铃时长可配（默认 10 分钟）：到点自动停，避免一直响下去
 */
public final class AlarmPlayer {

    /** 默认最长响铃时长 */
    public static final int DEFAULT_MAX_RING_MIN = 10;

    /** 闹钟震动节奏：响 800ms 停 600ms，循环 */
    private static final long[] VIBRATE_PATTERN = {0, 800, 600};

    private static MediaPlayer player;
    private static Vibrator vibrator;
    private static Handler handler;
    private static Runnable stopRunnable;
    private static Runnable rampRunnable;
    private static PowerManager.WakeLock wakeLock;

    private static volatile boolean ringing;
    private static String currentAlarmId;
    private static float gain = 1f;

    private AlarmPlayer() {}

    public static boolean isRinging() { return ringing; }

    public static String currentAlarmId() { return currentAlarmId; }

    /** 正在响的闹钟是不是这个 id（供 AlarmActivity 判断按钮该不该显示） */
    public static boolean isRingingFor(String id) {
        return ringing && id != null && id.equals(currentAlarmId);
    }

    /**
     * 开始响铃 + 震动。
     * @param alarmId        闹钟 id（用于取消时判断）
     * @param maxRingMinutes 最长响铃分钟数；<=0 时用默认值
     */
    public static synchronized void start(Context ctx, String alarmId, int maxRingMinutes) {
        // 同一个闹钟已经在响，不重复启动（AlarmActivity 的 onStart 会再调一次，必须是幂等的）
        if (ringing && alarmId != null && alarmId.equals(currentAlarmId)) return;

        stop(ctx);

        final Context app = ctx.getApplicationContext();
        ringing = true;
        currentAlarmId = alarmId;
        gain = 1f;
        if (handler == null) handler = new Handler(Looper.getMainLooper());

        int capMin = maxRingMinutes > 0 ? maxRingMinutes : DEFAULT_MAX_RING_MIN;
        final long capMs = capMin * 60L * 1000L;

        acquireWakeLock(app, capMs + 60000L);

        // ── 铃声：闹钟音量流 ──
        try {
            player = new MediaPlayer();
            boolean loaded = false;
            // 优先系统默认闹钟铃声（最"原生"），失败再退到内置资源
            try {
                Uri alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (alarmUri == null) alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                if (alarmUri != null) {
                    player.setDataSource(app, alarmUri);
                    loaded = true;
                }
            } catch (Exception ignored) {}
            if (!loaded) {
                java.io.File builtin = ensureBuiltinAlarmFile(app);
                if (builtin != null) {
                    try {
                        player.setDataSource(builtin.getAbsolutePath());
                        loaded = true;
                    } catch (Exception ignored) {}
                }
            }
            if (loaded) {
                player.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                player.setAudioStreamType(AudioManager.STREAM_ALARM);
                player.setLooping(true);
                // 渐强：起始音量压低，几秒内升到最大
                player.setVolume(0.35f, 0.35f);
                player.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
                    @Override
                    public void onPrepared(MediaPlayer mp) {
                        try { mp.start(); } catch (Exception ignored) {}
                    }
                });
                player.prepareAsync();
                startVolumeRamp();
            } else {
                try { player.release(); } catch (Exception ignored) {}
                player = null;
            }
        } catch (Exception e) {
            try { if (player != null) player.release(); } catch (Exception ignored) {}
            player = null;
        }

        startVibrate(app);

        // 到点自动停（响太久不好），并保证 Activity 也能收到停止信号
        stopRunnable = new Runnable() {
            @Override
            public void run() { stop(app); }
        };
        handler.postDelayed(stopRunnable, capMs);
    }

    /** 音量渐强：每 1.2 秒往上抬一点，总共约 10 秒升到最大 */
    private static void startVolumeRamp() {
        gain = 0.35f;
        rampRunnable = new Runnable() {
            @Override
            public void run() {
                if (!ringing || player == null) return;
                gain = Math.min(1f, gain + 0.08f);
                try { player.setVolume(gain, gain); } catch (Exception ignored) {}
                if (gain < 1f && handler != null) handler.postDelayed(rampRunnable, 1200);
            }
        };
        if (handler != null) handler.postDelayed(rampRunnable, 1200);
    }

    /** 停止响铃与震动 */
    public static synchronized void stop(Context ctx) {
        ringing = false;
        currentAlarmId = null;

        if (player != null) {
            try { player.stop(); } catch (Exception ignored) {}
            try { player.release(); } catch (Exception ignored) {}
            player = null;
        }
        if (handler != null) {
            if (stopRunnable != null) { handler.removeCallbacks(stopRunnable); stopRunnable = null; }
            if (rampRunnable != null) { handler.removeCallbacks(rampRunnable); rampRunnable = null; }
        }
        stopVibrate();
        releaseWakeLock();
    }

    private static void startVibrate(Context ctx) {
        try {
            vibrator = RingtonePlayer.getVibrator(ctx);
            if (vibrator == null || !vibrator.hasVibrator()) { vibrator = null; return; }
            if (Build.VERSION.SDK_INT >= 26) {
                int[] amps = RingtonePlayer.amplitudeArray(VIBRATE_PATTERN);
                try {
                    vibrator.vibrate(VibrationEffect.createWaveform(VIBRATE_PATTERN, amps, 0));
                } catch (Exception e) {
                    vibrator.vibrate(VibrationEffect.createWaveform(VIBRATE_PATTERN, 0));
                }
            } else {
                vibrator.vibrate(VIBRATE_PATTERN, 0);
            }
        } catch (Exception e) { vibrator = null; }
    }

    private static void stopVibrate() {
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
            vibrator = null;
        }
    }

    private static void acquireWakeLock(Context ctx, long timeoutMs) {
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "milkchat:alarm");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(timeoutMs);
        } catch (Exception e) { wakeLock = null; }
    }

    private static void releaseWakeLock() {
        if (wakeLock != null) {
            try { if (wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
            wakeLock = null;
        }
    }

    /** 内置兜底铃声（和来电铃声同一个资源文件），拷到本地再播 */
    private static java.io.File ensureBuiltinAlarmFile(Context app) {
        try {
            java.io.File f = new java.io.File(app.getCacheDir(), "builtin_invite_videocall.mp3");
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
        } catch (Exception e) { return null; }
    }
}
