package chat.milk.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

/**
 * 桌面角标：多厂商广播兼容 + 通知 setNumber/showBadge。
 * 逐个尝试，失败静默忽略（角标最终是否显示取决于桌面/启动器支持，
 * 鸿蒙6 + 卓易通环境下同时依赖通知渠道的 setShowBadge）。
 */
public final class BadgeUtil {

    private BadgeUtil() {}

    public static void setBadge(Context ctx, int count) {
        if (count < 0) count = 0;
        String pkg = ctx.getPackageName();
        ComponentName launcher = new ComponentName(ctx, MainActivity.class);
        String cls = MainActivity.class.getName();

        // 华为 / 荣耀（旧桌面协议，卓易通可能映射）
        try {
            Intent i = new Intent("launcher.action.CHANGE_APPLICATION_NOTIFICATION_NUM");
            i.putExtra("packageName", pkg);
            i.putExtra("className", cls);
            i.putExtra("badgeNumber", count);
            ctx.sendBroadcast(i);
        } catch (Exception ignored) {}

        // 三星
        try {
            Intent i = new Intent("android.intent.action.BADGE_COUNT_UPDATE");
            i.putExtra("badge_count", count);
            i.putExtra("badge_count_package_name", pkg);
            i.putExtra("badge_count_class_name", cls);
            ctx.sendBroadcast(i);
        } catch (Exception ignored) {}

        // 索尼
        try {
            Intent i = new Intent("com.sonyericsson.home.action.UPDATE_BADGE");
            i.putExtra("com.sonyericsson.home.intent.extra.badge.ACTIVITY_NAME", cls);
            i.putExtra("com.sonyericsson.home.intent.extra.badge.SHOW_MESSAGE", count > 0);
            i.putExtra("com.sonyericsson.home.intent.extra.badge.MESSAGE", String.valueOf(count));
            ctx.sendBroadcast(i);
        } catch (Exception ignored) {}

        // 通用（Nova / ADW / Apex 等第三方桌面）
        try {
            Intent i = new Intent("android.intent.action.UPDATE_SHORTCUT_BADGE");
            i.putExtra("packageName", pkg);
            i.putExtra("className", cls);
            i.putExtra("badgeCount", count);
            ctx.sendBroadcast(i);
        } catch (Exception ignored) {}

        // OPPO / vivo 等
        try {
            Intent i = new Intent("android.intent.action.APPLICATION_MESSAGE_UPDATE");
            i.putExtra(ComponentName.class.getName(), new ComponentName(pkg, cls).flattenToString());
            i.putExtra("message", count);
            ctx.sendBroadcast(i);
        } catch (Exception ignored) {}

        // 通知渠道角标兜底：更新未读消息通知的 number（通知已存在时刷新，不存在则不新增噪音）
        if (count > 0 && android.os.Build.VERSION.SDK_INT >= 23) {
            NotificationManagerCompatHelper.repostUnread(ctx, count);
        }
    }

    /** 简单封装，避免直接引用时在低版本崩溃 */
    static final class NotificationManagerCompatHelper {
        static void repostUnread(Context ctx, int count) {
            try {
                android.app.NotificationManager nm =
                        (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                android.service.notification.StatusBarNotification[] active =
                        nm == null ? null : nm.getActiveNotifications();
                if (active == null) return;
                for (android.service.notification.StatusBarNotification sbn : active) {
                    if (sbn.getId() == NotificationHelper.MSG_NOTIF_ID) {
                        NotificationHelper.setBadgeCount(ctx, count);
                        return;
                    }
                }
            } catch (Throwable ignored) {}
        }
    }
}
