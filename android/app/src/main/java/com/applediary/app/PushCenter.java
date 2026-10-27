package com.applediary.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * 本地消息推送：用 AlarmManager 定时唤起广播，再发系统通知。
 * 不依赖服务器，App 退到后台甚至进程被回收后仍能按时提醒。
 */
final class PushCenter {

    static final String CHANNEL_ID = "apple_messages";
    static final String PREFS = "apple_push_prefs";
    private static final String KEY_PENDING = "pending";
    private static final String ACTION_SHOW = "com.applediary.app.PUSH_SHOW";
    private static final int REQ_BASE = 2300;
    private static final int MAX_SLOTS = 8;
    private static final AtomicInteger NOTIFY_ID = new AtomicInteger(4100);

    private PushCenter() {}

    static NotificationManager manager(Context ctx) {
        return (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = manager(ctx);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "消息提醒",
                NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("梦角发来新消息时提醒你");
        ch.enableVibration(true);
        ch.setShowBadge(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(ch);
    }

    static boolean enabled(Context ctx) {
        try {
            return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
        } catch (Exception e) {
            return true;
        }
    }

    static void post(Context ctx, String title, String body, long when) {
        ensureChannel(ctx);
        if (!enabled(ctx)) return;
        try {
            Intent intent = new Intent(ctx, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(ctx, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(ctx, CHANNEL_ID)
                    : new Notification.Builder(ctx);
            b.setSmallIcon(R.drawable.ic_notify)
                    .setContentTitle(title == null || title.isEmpty() ? "苹果日记" : title)
                    .setContentText(body == null ? "" : body)
                    .setStyle(new Notification.BigTextStyle().bigText(body == null ? "" : body))
                    .setAutoCancel(true)
                    .setWhen(when > 0 ? when : System.currentTimeMillis())
                    .setShowWhen(true)
                    .setContentIntent(pi);
            NotificationManager nm = manager(ctx);
            if (nm != null) nm.notify(NOTIFY_ID.incrementAndGet(), b.build());
        } catch (Exception ignored) {
        }
    }

    static synchronized void savePending(Context ctx, String title, String body, long when) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray();
            String raw = sp.getString(KEY_PENDING, "");
            if (raw != null && !raw.isEmpty()) {
                try {
                    arr = new JSONArray(raw);
                } catch (Exception ignored) {
                }
            }
            JSONObject obj = new JSONObject();
            obj.put("title", title == null ? "" : title);
            obj.put("body", body == null ? "" : body);
            obj.put("time", when > 0 ? when : System.currentTimeMillis());
            arr.put(obj);
            // 最多留 20 条，避免一直堆着
            JSONArray out = new JSONArray();
            int start = Math.max(0, arr.length() - 20);
            for (int i = start; i < arr.length(); i++) out.put(arr.get(i));
            sp.edit().putString(KEY_PENDING, out.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static synchronized String takePending(Context ctx) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String raw = sp.getString(KEY_PENDING, "");
            sp.edit().remove(KEY_PENDING).apply();
            if (raw == null || raw.isEmpty()) return "[]";
            JSONArray arr = new JSONArray(raw);
            return arr.toString();
        } catch (Exception e) {
            return "[]";
        }
    }

    static void schedule(Context ctx, JSONArray items, JSONArray texts, long gap) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        cancelAll(ctx);
        long now = System.currentTimeMillis();
        long safeGap = Math.max(gap, 60 * 1000L);
        // 后台不断链，最多延续 6 小时，避免消息一直响个不停
        long until = now + 6 * 60 * 60 * 1000L;
        int count = Math.min(items == null ? 0 : items.length(), MAX_SLOTS);
        for (int i = 0; i < count; i++) {
            try {
                JSONObject item = items.getJSONObject(i);
                long at = item.optLong("at", now + 10 * 60 * 1000L);
                if (at < now + 15000) at = now + 15000;
                String title = item.optString("title", "苹果日记");
                String body = item.optString("body", "");
                scheduleSlot(ctx, i, at, title, body, i, texts, safeGap, until);
            } catch (Exception ignored) {
            }
        }
    }

    static void scheduleSlot(Context ctx, int slot, long at, String title, String body,
                             int pos, JSONArray texts, long gap, long until) {
        if (slot < 0 || slot >= MAX_SLOTS) return;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            Intent intent = new Intent(ctx, PushAlarmReceiver.class);
            intent.setAction(ACTION_SHOW + "." + slot);
            intent.putExtra("title", title);
            intent.putExtra("body", body);
            intent.putExtra("slot", slot);
            intent.putExtra("pos", pos);
            intent.putExtra("gap", gap);
            intent.putExtra("until", until);
            if (texts != null) intent.putExtra("texts", texts.toString());
            PendingIntent pi = PendingIntent.getBroadcast(ctx, REQ_BASE + slot, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                    || am.canScheduleExactAlarms();
            if (exact) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Exception ignored) {
        }
    }

    static void cancelAll(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        for (int i = 0; i < MAX_SLOTS; i++) {
            Intent intent = new Intent(ctx, PushAlarmReceiver.class);
            intent.setAction(ACTION_SHOW + "." + i);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, REQ_BASE + i, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            try {
                am.cancel(pi);
            } catch (Exception ignored) {
            }
            pi.cancel();
        }
    }
}
