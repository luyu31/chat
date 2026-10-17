package chat.milk.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Random;

/**
 * 闹钟到点：像手机原生闹钟一样「响起来」。
 *
 *  - 用 AlarmPlayer 走「闹钟」音量流循环播放 + 持续震动（静音模式下也会响），
 *    并弹出全屏闹钟界面（锁屏时通过 fullScreenIntent 直接盖在锁屏上、点亮屏幕）
 *  - 通知栏留一个 ongoing 通知，自带「停止 / 贪睡」按钮
 *  - 到点同时在聊天流里补上梦角那句问候（JS 侧负责）
 *  - 每日闹钟响完自动排明天；「贪睡」是一次性闹钟，不重复排
 */
public class AlarmReceiver extends BroadcastReceiver {

    private static final Random RNG = new Random();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction() == null ? AlarmScheduler.ACTION_ALARM : intent.getAction();
        String id = intent.getStringExtra("id");
        if (id == null || id.length() == 0) return;
        Context ctx = context.getApplicationContext();

        // ── 通知栏/界面上的「停止」：停响 + 收通知 + 取消贪睡 ──
        if (AlarmScheduler.ACTION_STOP.equals(action)) {
            AlarmPlayer.stop(ctx);
            AlarmScheduler.cancelSnooze(ctx, id);
            NotificationHelper.cancelAlarmNotification(ctx);
            MainActivity.dispatchAlarmAction("stop", id);
            return;
        }

        // ── 「贪睡」按钮：停响 + 排 N 分钟后的一次性闹钟 ──
        if (AlarmScheduler.ACTION_SNOOZE.equals(action)) {
            AlarmPlayer.stop(ctx);
            NotificationHelper.cancelAlarmNotification(ctx);
            AlarmScheduler.scheduleSnooze(ctx, id,
                    AlarmScheduler.snoozeMinutes(ctx), AlarmScheduler.maxRingMinutes(ctx));
            MainActivity.dispatchAlarmAction("snooze", id);
            return;
        }

        // ── 闹钟到点（每日 ACTION_ALARM 或 ACTION_SNOOZE 到点）──
        JSONObject alarm = AlarmScheduler.findAlarm(ctx, id);
        if (alarm == null) return; // 已被删除/停用

        boolean isSnooze = AlarmScheduler.ACTION_SNOOZE.equals(action) || intent.getBooleanExtra("snooze", false);

        String text = pickText(alarm);
        String partnerName = partnerName(ctx);
        int snoozeMin = AlarmScheduler.snoozeMinutes(ctx);
        int maxRingMin = AlarmScheduler.maxRingMinutes(ctx);

        // 1) 真的响起来：闹钟音量流循环 + 持续震动 + 持有唤醒锁
        AlarmPlayer.start(ctx, id, maxRingMin);

        // 2) 通知（ongoing + CATEGORY_ALARM + fullScreenIntent）：
        //    锁屏/息屏时系统会直接拉起 AlarmActivity 全屏闹钟界面并点亮屏幕
        NotificationHelper.showAlarmNotification(ctx, partnerName, text, id, snoozeMin, maxRingMin);

        // 3) 兜底再直接拉一次 Activity：App 在前台/已解锁时图标可能不弹全屏，
        //    这里直接 startActivity 保证一定能看到闹钟界面（后台启动被拦截就吞掉，仍有通知）
        try {
            Intent act = new Intent(ctx, AlarmActivity.class);
            act.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            act.putExtra(AlarmActivity.EXTRA_ID, id);
            act.putExtra(AlarmActivity.EXTRA_PARTNER, partnerName);
            act.putExtra(AlarmActivity.EXTRA_TEXT, text);
            act.putExtra(AlarmActivity.EXTRA_SNOOZE_MIN, snoozeMin);
            act.putExtra(AlarmActivity.EXTRA_MAX_RING_MIN, maxRingMin);
            act.putExtra(AlarmActivity.EXTRA_RING, true);
            ctx.startActivity(act);
        } catch (Exception ignored) {}

        // 4) 每日闹钟：排明天的同一时间（贪睡是一次性的，不重复排）
        if (!isSnooze) {
            AlarmScheduler.scheduleNext(ctx, id, alarm.optString("time"));
        }

        // 5) 通知 JS 在聊天流里补上那句问候（贪睡重响不重复发消息，交给 JS 去重）
        if (!isSnooze) {
            MainActivity.dispatchAlarmToJs(id);
        }
    }

    private static String pickText(JSONObject alarm) {
        String text = "";
        try {
            JSONArray texts = alarm.optJSONArray("texts");
            if (texts != null && texts.length() > 0) {
                int n = 0;
                for (int i = 0; i < texts.length(); i++) {
                    String t = texts.optString(i);
                    if (t != null && t.trim().length() > 0) n++;
                }
                if (n > 0) {
                    int pick = RNG.nextInt(n);
                    for (int i = 0; i < texts.length(); i++) {
                        String t = texts.optString(i);
                        if (t == null || t.trim().length() == 0) continue;
                        if (pick-- == 0) { text = t.trim(); break; }
                    }
                }
            }
        } catch (Exception ignored) {}
        if (text.length() == 0) text = "（" + alarm.optString("name", "提醒") + "）";
        return text;
    }

    private static String partnerName(Context ctx) {
        try {
            JSONObject cfg = AlarmScheduler.getConfig(ctx);
            if (cfg != null && cfg.optString("partnerName").length() > 0) return cfg.optString("partnerName");
        } catch (Exception ignored) {}
        return "对方";
    }
}
