package com.milk.chat;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

/**
 * 后台保活服务：前台服务 + 常驻通知 + 部分唤醒锁。
 * 保证进程不被系统回收，WebView 里的计时器（ta 主动找你、回复延迟等）能继续跑。
 */
public class KeepAliveService extends Service {

    public static final String ACTION_START = "com.milk.chat.action.KEEPALIVE_START";
    public static final String ACTION_STOP = "com.milk.chat.action.KEEPALIVE_STOP";

    private static final long WAKELOCK_TIMEOUT_MS = 10 * 60 * 1000L;
    private static final long WAKELOCK_RENEW_MS = 9 * 60 * 1000L;

    private PowerManager.WakeLock wakeLock;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable renew = new Runnable() {
        @Override
        public void run() {
            acquireWakeLock();
            handler.postDelayed(this, WAKELOCK_RENEW_MS);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationHelper.ensureChannels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }

        startForegroundCompat();

        acquireWakeLock();
        handler.removeCallbacks(renew);
        handler.postDelayed(renew, WAKELOCK_RENEW_MS);

        // 被系统杀掉后自动重启
        return START_STICKY;
    }

    private void startForegroundCompat() {
        Notification n = NotificationHelper.buildServiceNotification(this);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NotificationHelper.ID_KEEPALIVE, n,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NotificationHelper.ID_KEEPALIVE, n);
            }
        } catch (Throwable t) {
            try {
                startForeground(NotificationHelper.ID_KEEPALIVE, n);
            } catch (Throwable ignored) {}
        }
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm == null) return;
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "milk.chat:keepalive");
                wakeLock.setReferenceCounted(false);
            }
            if (!wakeLock.isHeld()) {
                wakeLock.acquire(WAKELOCK_TIMEOUT_MS);
            }
        } catch (Throwable ignored) {}
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Throwable ignored) {}
        wakeLock = null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // 从最近任务里划掉后，延迟一秒再把自己拉起来
        try {
            Intent restart = new Intent(getApplicationContext(), KeepAliveService.class);
            restart.setAction(ACTION_START);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getService(this, 1002, restart, flags);
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                long at = SystemClock.elapsedRealtime() + 1000L;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi);
                } else {
                    am.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi);
                }
            }
        } catch (Throwable ignored) {}
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(renew);
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}