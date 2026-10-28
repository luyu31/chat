package com.applediary.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * 通话前台服务（方案 A）。
 *
 * 通话开始时由 JS 桥拉起，退到后台保持通话：
 *  - 常驻通知（通话计时，点击回到通话界面）
 *  - PARTIAL_WAKE_LOCK，避免 Doze 掐掉 WebView 里的计时与心跳
 *  - 循环播放 assets 里的静音音频，满足 mediaPlayback 类型前台服务的要求
 *
 * 通话结束（JS 主动挂断）时收到 ACTION_STOP 自行停止；用户从最近任务划掉 App
 * （stopWithTask=true）时也会被系统回收，不会留下孤儿通知。
 */
public class CallForegroundService extends Service {

    private static final String TAG = "AppleCallService";

    static final String ACTION_START  = "com.applediary.app.CALL_START";
    static final String ACTION_UPDATE = "com.applediary.app.CALL_UPDATE";
    static final String ACTION_STOP   = "com.applediary.app.CALL_STOP";
    static final String EXTRA_NAME    = "name";
    static final String EXTRA_START   = "start_ts";

    private static final String CHANNEL_ID = "apple_call";
    private static final int NOTIFY_ID = 4200;
    private static final String PREFS = "apple_call_prefs";
    private static final String K_NAME = "name";
    private static final String K_START = "start_ts";

    /** 单次通话最长保活 6 小时；正常挂断会提前释放。 */
    private static final long LOCK_TIMEOUT = 6 * 60 * 60 * 1000L;

    private PowerManager.WakeLock wakeLock;
    private MediaPlayer silence;
    private boolean foreground = false;
    private static volatile boolean running = false;

    /** 通话前台服务是否正在运行：用来决定后台是否还要再弹一条常驻通知。 */
    static boolean isRunning() {
        return running;
    }

    // ---------------- 供 MainActivity 桥调用 ----------------

    static void start(Context ctx, String name, long startTs) {
        try {
            Intent i = new Intent(ctx, CallForegroundService.class);
            i.setAction(ACTION_START);
            i.putExtra(EXTRA_NAME, name == null ? "" : name);
            i.putExtra(EXTRA_START, startTs);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Exception e) {
            Log.w(TAG, "start failed", e);
        }
    }

    static void update(Context ctx, long startTs) {
        try {
            Intent i = new Intent(ctx, CallForegroundService.class);
            i.setAction(ACTION_UPDATE);
            i.putExtra(EXTRA_START, startTs);
            ctx.startService(i);
        } catch (Exception e) {
            Log.w(TAG, "update failed", e);
        }
    }

    static void stop(Context ctx) {
        try {
            Intent i = new Intent(ctx, CallForegroundService.class);
            i.setAction(ACTION_STOP);
            ctx.startService(i);
        } catch (Exception e) {
            Log.w(TAG, "stop failed", e);
        }
    }

    // ---------------- 生命周期 ----------------

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            shutdown();
            return START_NOT_STICKY;
        }
        if (ACTION_START.equals(action)) {
            String name = intent.getStringExtra(EXTRA_NAME);
            if (name != null && !name.isEmpty()) prefs().edit().putString(K_NAME, name).apply();
            show(intent.getLongExtra(EXTRA_START, 0));
        } else if (ACTION_UPDATE.equals(action)) {
            show(intent.getLongExtra(EXTRA_START, 0));
        } else if (!foreground) {
            show(0); // 系统重启服务等场景：没有现场信息时按“呼叫中”恢复显示
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseLock();
        stopSilence();
        try {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } catch (Exception ignored) {}
        prefs().edit().remove(K_START).apply();
        foreground = false;
        running = false;
        super.onDestroy();
    }

    // ---------------- 通知 ----------------

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "通话中",
                NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("通话进行中的常驻提醒");
        ch.setShowBadge(false);
        ch.enableVibration(false);
        ch.setSound(null, null);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(ch);
    }

    private Notification buildNotification(boolean answered, long startTs) {
        String name = prefs().getString(K_NAME, "");
        if (name == null || name.isEmpty()) name = "对方";

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 1, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        long when = startedTs(startTs);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(answered ? "与 " + name + " 通话中" : "正在呼叫 " + name)
                .setContentText(answered ? "点击回到通话界面" : "等待对方接听…")
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(true)
                .setWhen(when)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        if (answered) b.setUsesChronometer(true);
        return b.build();
    }

    /** 已经接通时用真实开始时间做计时起点；未接通就先给当前时间占位。 */
    private long startedTs(long startTs) {
        if (startTs > 0) return startTs;
        long saved = prefs().getLong(K_START, 0);
        return saved > 0 ? saved : System.currentTimeMillis();
    }

    private void show(long startTs) {
        ensureChannel();
        SharedPreferences sp = prefs();
        if (startTs > 0) sp.edit().putLong(K_START, startTs).apply();
        long ts = sp.getLong(K_START, 0);

        Notification n = buildNotification(ts > 0, ts);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFY_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFY_ID, n);
        }
        foreground = true;
        running = true;

        acquireLock();
        startSilence();
    }

    private void shutdown() {
        releaseLock();
        stopSilence();
        try {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } catch (Exception ignored) {}
        prefs().edit().remove(K_START).apply();
        foreground = false;
        running = false;
        stopSelf();
    }

    // ---------------- 唤醒锁 ----------------

    private void acquireLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AppleDiary:Call");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(LOCK_TIMEOUT);
        } catch (Exception e) {
            Log.w(TAG, "wake lock failed", e);
        }
    }

    private void releaseLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {}
        wakeLock = null;
    }

    // ---------------- 静音音频（满足 mediaPlayback 前台类型） ----------------

    private void startSilence() {
        if (silence != null) {
            try {
                if (!silence.isPlaying()) silence.start();
            } catch (Exception ignored) {}
            return;
        }
        try {
            MediaPlayer mp = new MediaPlayer();
            AssetFileDescriptor afd = getAssets().openFd("www/assets/audio/silence.mp3");
            mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            afd.close();
            mp.setLooping(true);
            mp.setVolume(0.01f, 0.01f);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mp.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build());
            }
            mp.prepare();
            mp.start();
            silence = mp;
        } catch (Exception e) {
            Log.w(TAG, "silence playback failed", e);
        }
    }

    private void stopSilence() {
        MediaPlayer mp = silence;
        silence = null;
        if (mp == null) return;
        try {
            if (mp.isPlaying()) mp.stop();
        } catch (Exception ignored) {}
        try {
            mp.release();
        } catch (Exception ignored) {}
    }
}
