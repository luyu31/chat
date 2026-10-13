package com.milk.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.os.Build;
import android.provider.Settings;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * 通知中心。
 *
 * 渠道设计（对应需求里的四种通知形态）：
 *  - {@link #CH_MESSAGES} 高优先级渠道：横幅通知（Heads-up）、锁屏通知、通知栏通知、桌面角标一次全包。
 *  - {@link #CH_KEEPALIVE} 最低优先级渠道：前台服务常驻通知，安静、不上锁屏、不显示角标、不打扰。
 */
public final class NotificationHelper {

    /** 消息通知渠道 id */
    public static final String CH_MESSAGES = "milk_chat_messages";
    /** 后台保活渠道 id */
    public static final String CH_KEEPALIVE = "milk_chat_service";

    /** 保活通知固定 id */
    public static final int ID_KEEPALIVE = 1001;

    private static final AtomicInteger MSG_SEQ = new AtomicInteger(2000);

    private NotificationHelper() {}

    private static NotificationManager nm(Context c) {
        return (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    /** 创建（或补齐）通知渠道。可重复调用。 */
    public static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager m = nm(c);
        if (m == null) return;

        if (m.getNotificationChannel(CH_MESSAGES) == null) {
            NotificationChannel ch = new NotificationChannel(
                    CH_MESSAGES, "消息通知", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("收到新消息时在通知栏、锁屏界面弹出横幅提醒，并在桌面图标上显示角标");
            // 横幅 + 声音 + 振动
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 200, 120, 200});
            ch.enableLights(true);
            ch.setLightColor(Color.parseColor("#FF5C8A"));
            // 锁屏可见
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            // 桌面角标
            ch.setShowBadge(true);
            ch.setBypassDnd(false);
            try {
                ch.setSound(Settings.System.DEFAULT_NOTIFICATION_URI,
                        new AudioAttributes.Builder()
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                                .build());
            } catch (Throwable ignored) {}
            m.createNotificationChannel(ch);
        }

        if (m.getNotificationChannel(CH_KEEPALIVE) == null) {
            NotificationChannel ch = new NotificationChannel(
                    CH_KEEPALIVE, "后台运行", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("保持 milk 在后台运行，以便及时收到消息");
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
            ch.enableVibration(false);
            ch.enableLights(false);
            ch.setSound(null, null);
            m.createNotificationChannel(ch);
        }
    }

    private static PendingIntent contentIntent(Context c) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(c, 0, i, flags);
    }

    /**
     * 弹出一条消息通知：横幅 + 锁屏 + 通知栏 + 角标。
     *
     * @param badgeCount 当前未读消息数，用于桌面角标
     */
    public static void postMessage(Context c, String title, String body, int badgeCount) {
        ensureChannels(c);
        NotificationManager m = nm(c);
        if (m == null) return;

        String t = (title == null || title.trim().isEmpty()) ? "milk" : title.trim();
        String b = (body == null) ? "" : body;
        int badge = badgeCount > 0 ? badgeCount : 1;

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(c, CH_MESSAGES);
        } else {
            builder = new Notification.Builder(c);
            builder.setPriority(Notification.PRIORITY_HIGH);
            builder.setDefaults(Notification.DEFAULT_ALL);
        }

        builder.setSmallIcon(R.drawable.ic_notif);
        builder.setContentTitle(t);
        builder.setContentText(b);
        builder.setStyle(new Notification.BigTextStyle().bigText(b));
        builder.setWhen(System.currentTimeMillis());
        builder.setShowWhen(true);
        builder.setAutoCancel(true);
        builder.setOnlyAlertOnce(false);
        builder.setContentIntent(contentIntent(c));
        // 归类为社交消息，系统会按「社交通讯」样式展示（可直接回复/快捷入口）
        builder.setCategory(Notification.CATEGORY_MESSAGE);
        // 锁屏通知可见
        builder.setVisibility(Notification.VISIBILITY_PUBLIC);
        // 桌面角标数字
        builder.setNumber(badge);
        builder.setColor(Color.parseColor("#FF111111"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            builder.setGroup("milk_chat_group");
            builder.setGroupSummary(false);
        }

        try {
            m.notify(MSG_SEQ.incrementAndGet(), builder.build());
        } catch (Throwable ignored) {}

        BadgeHelper.setBadge(c, badge);
    }

    /** 清空全部消息通知 + 桌面角标 */
    public static void clearAll(Context c) {
        try {
            NotificationManager m = nm(c);
            if (m != null) m.cancelAll();
        } catch (Throwable ignored) {}
        BadgeHelper.setBadge(c, 0);
    }

    /** 前台服务常驻通知 */
    public static Notification buildServiceNotification(Context c) {
        ensureChannels(c);
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(c, CH_KEEPALIVE);
        } else {
            builder = new Notification.Builder(c);
            builder.setPriority(Notification.PRIORITY_MIN);
        }
        builder.setSmallIcon(R.drawable.ic_notif);
        builder.setContentTitle("milk 正在后台运行");
        builder.setContentText("保持连接，随时接收新消息");
        builder.setOngoing(true);
        builder.setShowWhen(false);
        builder.setContentIntent(contentIntent(c));
        builder.setCategory(Notification.CATEGORY_SERVICE);
        builder.setVisibility(Notification.VISIBILITY_SECRET);
        return builder.build();
    }
}