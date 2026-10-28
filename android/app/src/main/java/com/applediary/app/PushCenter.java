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

/**
 * 本地消息推送：一条常驻的「会话式」通知 + 后台闹钟链。
 * 退到后台后按设定频率持续提醒，App 被回收或手机重启也能继续，直到用户回到 App。
 */
final class PushCenter {

    static final String CHANNEL_ID = "apple_messages";
    static final String PREFS = "apple_push_prefs";
    static final String ACTION_CHAIN = "com.applediary.app.PUSH_CHAIN";

    private static final int NOTIFY_ID = 4100;
    private static final int REQ_CHAIN = 2400;
    private static final long MIN_GAP = 5 * 60 * 1000L;
    private static final long MAX_UNTIL = 30L * 24 * 60 * 60 * 1000L;

    private static final String K_COUNT = "count";
    private static final String K_PENDING = "pending";
    private static final String K_ACTIVE = "chain_active";
    private static final String K_UNTIL = "chain_until";
    private static final String K_GAP = "chain_gap";
    private static final String K_TITLE = "chain_title";
    private static final String K_TEXTS = "chain_texts";
    private static final String K_POS = "chain_pos";

    private PushCenter() {}

    static NotificationManager manager(Context ctx) {
        return (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
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

    /** 发一条会话式通知；同一 ID 覆盖更新，通知栏里始终只占一条。 */
    static void post(Context ctx, String title, String body, long when) {
        ensureChannel(ctx);
        if (!enabled(ctx)) return;
        try {
            int count = bumpCount(ctx);
            Intent intent = new Intent(ctx, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(ctx, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            String text = body == null ? "" : body;
            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(ctx, CHANNEL_ID)
                    : new Notification.Builder(ctx);
            b.setSmallIcon(R.drawable.ic_notify)
                    .setContentTitle(title == null || title.isEmpty() ? "苹果日记" : title)
                    .setContentText(text)
                    .setStyle(new Notification.BigTextStyle().bigText(text))
                    .setSubText(count > 1 ? "共 " + count + " 条新消息" : null)
                    .setNumber(count)
                    .setGroup("apple_chat")
                    .setCategory(Notification.CATEGORY_MESSAGE)
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(false)
                    .setWhen(when > 0 ? when : System.currentTimeMillis())
                    .setShowWhen(true)
                    .setContentIntent(pi);
            NotificationManager nm = manager(ctx);
            if (nm != null) nm.notify(NOTIFY_ID, b.build());
        } catch (Exception ignored) {
        }
    }

    static synchronized int bumpCount(Context ctx) {
        SharedPreferences sp = prefs(ctx);
        int n = sp.getInt(K_COUNT, 0) + 1;
        sp.edit().putInt(K_COUNT, n).apply();
        return n;
    }

    static synchronized void resetCount(Context ctx) {
        prefs(ctx).edit().putInt(K_COUNT, 0).apply();
    }

    static synchronized void clearNotifications(Context ctx) {
        try {
            NotificationManager nm = manager(ctx);
            // 只清自己的消息通知：cancelAll 会把通话前台服务的常驻通知一起清掉
            if (nm != null) nm.cancel(NOTIFY_ID);
        } catch (Exception ignored) {
        }
        resetCount(ctx);
    }

    static synchronized void savePending(Context ctx, String title, String body, long when) {
        try {
            SharedPreferences sp = prefs(ctx);
            JSONArray arr = new JSONArray();
            String raw = sp.getString(K_PENDING, "");
            if (raw != null && !raw.isEmpty()) {
                try {
                    arr = new JSONArray(raw);
                } catch (Exception ignored) {
                }
            }
            org.json.JSONObject obj = new org.json.JSONObject();
            obj.put("title", title == null ? "" : title);
            obj.put("body", body == null ? "" : body);
            obj.put("time", when > 0 ? when : System.currentTimeMillis());
            arr.put(obj);
            JSONArray out = new JSONArray();
            int start = Math.max(0, arr.length() - 200);
            for (int i = start; i < arr.length(); i++) out.put(arr.get(i));
            sp.edit().putString(K_PENDING, out.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static synchronized String takePending(Context ctx) {
        try {
            SharedPreferences sp = prefs(ctx);
            String raw = sp.getString(K_PENDING, "");
            sp.edit().remove(K_PENDING).apply();
            if (raw == null || raw.isEmpty()) return "[]";
            return new JSONArray(raw).toString();
        } catch (Exception e) {
            return "[]";
        }
    }

    /** 开启后台提醒链：每 gap 毫秒提醒一次，直到 until（最长 30 天）。 */
    static void startChain(Context ctx, long gap, long until, String title, JSONArray texts) {
        long now = System.currentTimeMillis();
        if (gap < MIN_GAP) gap = MIN_GAP;
        if (until <= now || until - now > MAX_UNTIL) until = now + MAX_UNTIL;
        SharedPreferences.Editor e = prefs(ctx).edit()
                .putBoolean(K_ACTIVE, true)
                .putLong(K_GAP, gap)
                .putLong(K_UNTIL, until)
                .putString(K_TITLE, title == null || title.isEmpty() ? "苹果日记" : title)
                .putString(K_TEXTS, texts == null ? "[]" : texts.toString())
                .putInt(K_POS, 0);
        e.apply();
        cancelAlarms(ctx);
        scheduleNext(ctx, now + gap);
    }

    static boolean isChainActive(Context ctx) {
        SharedPreferences sp = prefs(ctx);
        return sp.getBoolean(K_ACTIVE, false)
                && sp.getLong(K_UNTIL, 0) > System.currentTimeMillis();
    }

    static long chainGap(Context ctx) {
        return prefs(ctx).getLong(K_GAP, 15 * 60 * 1000L);
    }

    static long chainUntil(Context ctx) {
        return prefs(ctx).getLong(K_UNTIL, 0);
    }

    static void stopChain(Context ctx) {
        prefs(ctx).edit().putBoolean(K_ACTIVE, false).apply();
        cancelAlarms(ctx);
    }

    /** 闹钟触发时调用：发通知、留存消息、再排下一条。 */
    static synchronized void fireChain(Context ctx) {
        if (!enabled(ctx)) {
            stopChain(ctx);
            return;
        }
        SharedPreferences sp = prefs(ctx);
        long now = System.currentTimeMillis();
        long until = sp.getLong(K_UNTIL, 0);
        if (!sp.getBoolean(K_ACTIVE, false) || now >= until) {
            sp.edit().putBoolean(K_ACTIVE, false).apply();
            return;
        }
        String title = sp.getString(K_TITLE, "苹果日记");
        JSONArray texts = new JSONArray();
        try {
            texts = new JSONArray(sp.getString(K_TEXTS, "[]"));
        } catch (Exception ignored) {
        }
        String body = "在吗？";
        int pos = sp.getInt(K_POS, 0);
        if (texts.length() > 0) {
            body = texts.optString(pos % texts.length(), body);
            pos = (pos + 1) % texts.length();
        }
        post(ctx, title, body, now);
        savePending(ctx, title, body, now);
        sp.edit().putInt(K_POS, pos).apply();

        long gap = Math.max(sp.getLong(K_GAP, 15 * 60 * 1000L), MIN_GAP);
        long next = now + gap;
        if (next < until) {
            scheduleNext(ctx, next);
        } else {
            sp.edit().putBoolean(K_ACTIVE, false).apply();
        }
    }

    /** 开机后接着提醒（闹钟在重启时会被系统清空）。 */
    static void resumeAfterBoot(Context ctx) {
        if (!isChainActive(ctx) || !enabled(ctx)) return;
        scheduleNext(ctx, System.currentTimeMillis() + chainGap(ctx));
    }

    static void scheduleNext(Context ctx, long at) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            Intent intent = new Intent(ctx, PushAlarmReceiver.class);
            intent.setAction(ACTION_CHAIN);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, REQ_CHAIN, intent,
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

    static void cancelAlarms(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            Intent intent = new Intent(ctx, PushAlarmReceiver.class);
            intent.setAction(ACTION_CHAIN);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, REQ_CHAIN, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            am.cancel(pi);
            pi.cancel();
        } catch (Exception ignored) {
        }
    }
}
