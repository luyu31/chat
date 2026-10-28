package com.applediary.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * 后台常驻前台服务（仿微信 / milk.chat）。
 *
 * App 退到后台时由 MainActivity.onPause 拉起，常驻一条「其他」渠道的通知，
 * 把进程优先级提到前台服务级别，避免被系统回收，从而持续保持连接、接收新消息。
 *
 * - 通知常驻（setOngoing），用户不能左右滑掉；
 * - 回到前台（onResume）时由 MainActivity 主动停止；
 * - 通话中不启动本服务：CallForegroundService 已经在保活，再弹一条会重复打扰；
 * - 从最近任务划掉时 stopWithTask=true 跟随销毁，不留下孤儿通知。
 */
public class KeepAliveForegroundService extends Service {

    private static final String TAG = "AppleKeepAlive";

    static final String ACTION_START = "com.applediary.app.KEEPALIVE_START";
    static final String ACTION_STOP  = "com.applediary.app.KEEPALIVE_STOP";

    private static final int NOTIFY_ID = 4300;

    private volatile boolean foreground = false;

    static void start(Context ctx) {
        try {
            Intent i = new Intent(ctx, KeepAliveForegroundService.class);
            i.setAction(ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Exception e) {
            Log.w(TAG, "start failed", e);
        }
    }

    static void stop(Context ctx) {
        try {
            Intent i = new Intent(ctx, KeepAliveForegroundService.class);
            i.setAction(ACTION_STOP);
            ctx.startService(i);
        } catch (Exception e) {
            Log.w(TAG, "stop failed", e);
        }
    }

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
        show();
        // 进程被系统杀掉后重启：继续常驻，等用户回前台再停
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        try {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } catch (Exception ignored) {}
        foreground = false;
        super.onDestroy();
    }

    private Notification buildNotification() {
        PushCenter.ensureChannel(this);

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, NOTIFY_ID, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, PushCenter.CHANNEL_OTHER)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle("苹果日记 正在后台运行")
                .setContentText("保持连接，随时接收新消息")
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .build();
    }

    private void show() {
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFY_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFY_ID, n);
            }
            foreground = true;
        } catch (Exception e) {
            Log.w(TAG, "startForeground failed", e);
        }
    }

    private void shutdown() {
        try {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } catch (Exception ignored) {}
        foreground = false;
        stopSelf();
    }
}
