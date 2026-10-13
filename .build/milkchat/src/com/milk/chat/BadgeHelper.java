package com.milk.chat;

import android.content.Context;
import android.content.Intent;

/**
 * 桌面角标。除了通知自带的 setNumber（大多数系统由它驱动角标）之外，
 * 再补一层各主流启动器的角标广播，覆盖华为 / 荣耀 / 小米 / 三星 / 索尼 / vivo 等。
 * 任何一步失败都静默忽略，不影响主流程。
 */
final class BadgeHelper {

    private BadgeHelper() {}

    private static String launcherClass(Context c) {
        return c.getPackageName() + ".MainActivity";
    }

    static void setBadge(Context ctx, int count) {
        if (count < 0) count = 0;
        try {
            String pkg = ctx.getPackageName();
            String cls = launcherClass(ctx);

            // 华为
            Intent hw = new Intent("com.huawei.android.launcher.action.CHANGE_BADGE");
            hw.putExtra("package", pkg);
            hw.putExtra("class", cls);
            hw.putExtra("badgenumber", count);
            send(ctx, hw);

            // 荣耀
            Intent honor = new Intent("com.hihonor.android.launcher.action.CHANGE_BADGE");
            honor.putExtra("package", pkg);
            honor.putExtra("class", cls);
            honor.putExtra("badgenumber", count);
            send(ctx, honor);

            // 小米 / 红米
            Intent mi = new Intent("android.intent.action.APPLICATION_MESSAGE_UPDATE");
            mi.putExtra("android.intent.extra.update_application_component_name", pkg + "/" + cls);
            mi.putExtra("android.intent.extra.update_application_message_text",
                    count == 0 ? "" : String.valueOf(count));
            send(ctx, mi);

            // 三星
            Intent ss = new Intent("android.intent.action.BADGE_COUNT_UPDATE");
            ss.putExtra("badge_count", count);
            ss.putExtra("badge_count_package_name", pkg);
            ss.putExtra("badge_count_class_name", cls);
            send(ctx, ss);

            // 索尼
            Intent se = new Intent("com.sonyericsson.home.action.UPDATE_BADGE");
            se.putExtra("com.sonyericsson.home.intent.extra.badge.PACKAGE_NAME", pkg);
            se.putExtra("com.sonyericsson.home.intent.extra.badge.ACTIVITY_NAME", cls);
            se.putExtra("com.sonyericsson.home.intent.extra.badge.MESSAGE", String.valueOf(count));
            se.putExtra("com.sonyericsson.home.intent.extra.badge.SHOW_MESSAGE", count > 0);
            send(ctx, se);

            // vivo
            Intent vivo = new Intent("launcher.action.CHANGE_APPLICATION_NOTIFICATION_NUM");
            vivo.putExtra("packageName", pkg);
            vivo.putExtra("className", cls);
            vivo.putExtra("notificationNum", count);
            send(ctx, vivo);

            // 通用（ADW / Nova / Apex 等）
            Intent any = new Intent("com.anddoes.launcher.COUNT_UPDATE");
            any.putExtra("package", pkg);
            any.putExtra("class", cls);
            any.putExtra("count", count);
            send(ctx, any);
        } catch (Throwable ignored) {}
    }

    private static void send(Context ctx, Intent i) {
        try {
            ctx.sendBroadcast(i);
        } catch (Throwable ignored) {}
    }
}