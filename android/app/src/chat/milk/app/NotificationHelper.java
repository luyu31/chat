package chat.milk.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

/** 通知中心：双通道（保活常驻 + 消息提醒），负责横幅/锁屏/通知栏/角标。 */
public final class NotificationHelper {

    public static final String CHANNEL_KEEP = "milk_keepalive";
    public static final String CHANNEL_MSG = "milk_messages";
    public static final String CHANNEL_CALL = "milk_call";
    public static final String CHANNEL_ALARM = "milk_alarm";
    public static final int KEEP_ALIVE_NOTIF_ID = 1;
    public static final int MSG_NOTIF_ID = 2001;
    public static final int CALL_NOTIF_ID = 3001;
    public static final int ALARM_NOTIF_ID = 4001;
    private static final String PREFS = "milk_notif";
    private static final String KEY_UNREAD = "unread";
    private static final String KEY_NOTIF_PERM_ASKED = "np_asked";

    private NotificationHelper() {}

    public static void init(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        // 保活常驻通知：低优先级、静默、不产生角标
        NotificationChannel keep = new NotificationChannel(CHANNEL_KEEP, "后台运行",
                NotificationManager.IMPORTANCE_LOW);
        keep.setDescription("保持 milk.chat 在后台持续运行");
        keep.setShowBadge(false);
        keep.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
        keep.setSound(null, null);
        keep.enableLights(false);
        keep.enableVibration(false);
        nm.createNotificationChannel(keep);

        // 消息通知：高优先级 → 横幅(banner) + 锁屏公开显示 + 通知栏 + 角标
        NotificationChannel msg = new NotificationChannel(CHANNEL_MSG, "新消息提醒",
                NotificationManager.IMPORTANCE_HIGH);
        msg.setDescription("梦角新消息提醒");
        msg.setShowBadge(true);
        msg.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        msg.setBypassDnd(false);
        msg.enableLights(true);
        msg.setLightColor(0xFFFF8FB3);
        msg.enableVibration(true);
        msg.setVibrationPattern(new long[]{0, 180, 120, 180});
        try {
            Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            msg.setSound(sound, new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
        } catch (Exception ignored) {}
        nm.createNotificationChannel(msg);

        // 来电通道：高优先级，横幅 + 锁屏，铃声由 RingtonePlayer 原生循环播放（不占通道音）。
        // 震动开着：前台来电走 RingtonePlayer 的来电震动节奏；万一系统拦了全屏来电 Activity
        // （Android 10+ 后台启动限制），这条通知自带震动兜底，保证后台来电也有触感提醒。
        NotificationChannel call = new NotificationChannel(CHANNEL_CALL, "来电提醒",
                NotificationManager.IMPORTANCE_HIGH);
        call.setDescription("梦角来电的全屏与横幅提醒");
        call.setShowBadge(true);
        call.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        call.setSound(null, null);
        call.enableVibration(true);
        call.setVibrationPattern(new long[]{0, 800, 600, 800, 1200});
        call.enableLights(true);
        call.setLightColor(0xFFF2A9BC);
        nm.createNotificationChannel(call);

        // 闹钟通道：专用"闹钟"类别。
        // 声音交给 AlarmPlayer 走闹钟音量流循环播放（通道本身不发声，避免双重声音）；
        // 类别设为 CATEGORY_ALARM + fullScreenIntent，锁屏时能像原生闹钟一样直接拉起全屏界面。
        NotificationChannel alarm = new NotificationChannel(CHANNEL_ALARM, "闹钟提醒",
                NotificationManager.IMPORTANCE_HIGH);
        alarm.setDescription("定时问候到点时的响铃与全屏提醒");
        alarm.setShowBadge(false);
        alarm.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        alarm.setSound(null, null);
        alarm.enableVibration(false);   // 震动由 AlarmPlayer 负责
        alarm.enableLights(true);
        alarm.setLightColor(0xFFF2A9BC);
        try { alarm.setBypassDnd(true); } catch (Exception ignored) {}
        nm.createNotificationChannel(alarm);
    }

    public static void startKeepAlive(Context ctx) {
        try {
            Intent i = new Intent(ctx, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Exception ignored) {}
    }

    public static Notification buildKeepAliveNotification(Context ctx) {
        PendingIntent pi = mainPendingIntent(ctx);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(ctx, CHANNEL_KEEP);
        } else {
            b = new Notification.Builder(ctx);
            b.setPriority(Notification.PRIORITY_LOW);
        }
        return b.setContentTitle("milk.chat 正在后台运行")
                .setContentText("保持连接，随时接收新消息")
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pi)
                .build();
    }

    /** 页面在后台收到新消息时调用：横幅 + 锁屏 + 通知栏 + 角标 +1。
     *  tag 为 "jump:&lt;msgId&gt;" 时（JS 侧 _sendPartnerNotification 带 msgId 发的），
     *  通知点击后会直达那条消息；其它 tag 按普通消息处理。 */
    public static void notifyMessage(Context ctx, String title, String body, String tag) {
        init(ctx);
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int unread = sp.getInt(KEY_UNREAD, 0) + 1;
        sp.edit().putInt(KEY_UNREAD, unread).apply();

        String jumpMsgId = null;
        if (tag != null && tag.startsWith("jump:") && tag.length() > 5) {
            jumpMsgId = tag.substring(5);
        }
        PendingIntent pi = mainPendingIntent(ctx, jumpMsgId);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(ctx, CHANNEL_MSG);
        } else {
            b = new Notification.Builder(ctx);
            b.setPriority(Notification.PRIORITY_HIGH);
            b.setDefaults(Notification.DEFAULT_ALL);
        }
        b.setContentTitle(title == null || title.length() == 0 ? "milk.chat" : title)
                .setContentText(body == null ? "" : body)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setNumber(unread)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                .setContentIntent(pi)
                .setOnlyAlertOnce(false);
        if (Build.VERSION.SDK_INT >= 26) {
            b.setBadgeIconType(Notification.BADGE_ICON_SMALL);
        }

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try { nm.notify(MSG_NOTIF_ID, b.build()); } catch (Exception ignored) {}
        }
        BadgeUtil.setBadge(ctx, unread);
    }

    /** 回到应用：清掉未读消息通知与角标 */
    public static void onAppOpen(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try { nm.cancel(MSG_NOTIF_ID); } catch (Exception ignored) {}
        }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_UNREAD, 0).apply();
        BadgeUtil.setBadge(ctx, 0);
    }

    /**
     * 全屏来电通知：
     *  - 锁屏/息屏：直接拉起 IncomingCallActivity（像系统来电）
     *  - 亮屏后台：横幅（heads-up）提醒
     *  - 铃声与震动由 RingtonePlayer 负责，通知本身不发声
     */
    public static void showIncomingCallNotification(Context ctx, String name) {
        showIncomingCallNotification(ctx, name, false);
    }

    public static void showIncomingCallNotification(Context ctx, String name, boolean voice) {
        init(ctx);
        Intent full = new Intent(ctx, IncomingCallActivity.class);
        full.putExtra(IncomingCallActivity.EXTRA_NAME, name);
        full.putExtra(IncomingCallActivity.EXTRA_VOICE, voice);
        full.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int pFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) pFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent fullPi = PendingIntent.getActivity(ctx, 4001, full, pFlags);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(ctx, CHANNEL_CALL);
        } else {
            b = new Notification.Builder(ctx);
            b.setPriority(Notification.PRIORITY_HIGH);
        }
        b.setContentTitle((name == null || name.length() == 0 ? "对方" : name) + " 来电")
                .setContentText(voice ? "邀请您进行语音通话" : "邀请您进行视频通话")
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setCategory(Notification.CATEGORY_CALL)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(true)
                .setContentIntent(fullPi)
                .setFullScreenIntent(fullPi, true);

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try { nm.notify(CALL_NOTIF_ID, b.build()); } catch (Exception ignored) {}
        }
    }

    /** 取消来电通知（接听/拒绝后） */
    public static void cancelCallNotification(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try { nm.cancel(CALL_NOTIF_ID); } catch (Exception ignored) {}
        }
    }

    /**
     * 闹钟通知：像原生闹钟一样
     *  - category = CATEGORY_ALARM + fullScreenIntent：锁屏/息屏时直接拉起 AlarmActivity（点亮屏幕）
     *  - ongoing：一直挂着，直到用户「停止」或「贪睡」
     *  - 自带「停止」「贪睡 N 分钟」两个按钮，不打开 App 也能直接操作
     *  声音与震动由 AlarmPlayer 走「闹钟」音量流循环播放，通知本身不发声。
     */
    public static void showAlarmNotification(Context ctx, String name, String text,
                                             String alarmId, int snoozeMinutes, int maxRingMinutes) {
        init(ctx);
        String who = (name == null || name.length() == 0) ? "对方" : name;
        String body = (text == null || text.length() == 0) ? "时间到了" : text;
        if (alarmId == null) alarmId = "";

        Intent full = new Intent(ctx, AlarmActivity.class);
        full.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        full.putExtra(AlarmActivity.EXTRA_ID, alarmId);
        full.putExtra(AlarmActivity.EXTRA_PARTNER, who);
        full.putExtra(AlarmActivity.EXTRA_TEXT, body);
        full.putExtra(AlarmActivity.EXTRA_SNOOZE_MIN, snoozeMinutes);
        full.putExtra(AlarmActivity.EXTRA_MAX_RING_MIN, maxRingMinutes);
        full.putExtra(AlarmActivity.EXTRA_RING, true);
        int pFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) pFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent fullPi = PendingIntent.getActivity(ctx, 5001, full, pFlags);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(ctx, CHANNEL_ALARM);
        } else {
            b = new Notification.Builder(ctx);
            b.setPriority(Notification.PRIORITY_MAX);
        }
        b.setContentTitle(who + " 的闹钟")
                .setContentText(body)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(fullPi)
                .setFullScreenIntent(fullPi, true);

        // 通知栏上的快捷操作（不进 App 也能停/贪睡）
        try {
            int min = snoozeMinutes > 0 ? snoozeMinutes : AlarmScheduler.DEFAULT_SNOOZE_MIN;
            b.addAction(new Notification.Action.Builder(0, "贪睡 " + min + " 分钟",
                    alarmActionPi(ctx, AlarmScheduler.ACTION_SNOOZE, alarmId)).build());
            b.addAction(new Notification.Action.Builder(0, "停止",
                    alarmActionPi(ctx, AlarmScheduler.ACTION_STOP, alarmId)).build());
        } catch (Exception ignored) {}

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try { nm.notify(ALARM_NOTIF_ID, b.build()); } catch (Exception ignored) {}
        }
    }

    /** 闹钟结束（停止/贪睡/超时）后收起通知 */
    public static void cancelAlarmNotification(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try { nm.cancel(ALARM_NOTIF_ID); } catch (Exception ignored) {}
        }
    }

    private static PendingIntent alarmActionPi(Context ctx, String action, String alarmId) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction(action);
        i.putExtra("id", alarmId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        int rc = (action + "#" + alarmId).hashCode() & 0x7fffffff;
        return PendingIntent.getBroadcast(ctx, rc, i, flags);
    }

    public static void setBadgeCount(Context ctx, int n) {
        n = Math.max(0, n);
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_UNREAD, n).apply();
        BadgeUtil.setBadge(ctx, n);
    }

    public static int getUnread(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_UNREAD, 0);
    }

    public static void markNotifPermissionAsked(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(KEY_NOTIF_PERM_ASKED, true).apply();
    }

    public static boolean isNotifPermissionAsked(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(KEY_NOTIF_PERM_ASKED, false);
    }

    /** 任务被划掉后 1.5s 通过广播拉起服务 */
    public static void scheduleRestart(Context ctx) {
        try {
            Intent i = new Intent(ctx, BootReceiver.class);
            i.setAction(BootReceiver.ACTION_RESTART_KEEPALIVE);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 99, i, flags);
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long at = System.currentTimeMillis() + 1500;
            if (Build.VERSION.SDK_INT >= 23) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else if (Build.VERSION.SDK_INT >= 19) {
                am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Exception ignored) {}
    }

    private static PendingIntent mainPendingIntent(Context ctx) {
        return mainPendingIntent(ctx, null);
    }

    /** jumpMsgId 非空时塞进 intent extra：MainActivity 收到后跳转到那条消息 */
    private static PendingIntent mainPendingIntent(Context ctx, String jumpMsgId) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (jumpMsgId != null && jumpMsgId.length() > 0) {
            i.putExtra(MainActivity.EXTRA_JUMP_MSG_ID, jumpMsgId);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, 0, i, flags);
    }
}
