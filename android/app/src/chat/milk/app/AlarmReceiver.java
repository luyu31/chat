package chat.milk.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Random;

/**
 * 闹钟到点：发系统通知（横幅/锁屏/角标）+ 通知 JS 在聊天流里补消息 + 排明天的闹钟。
 * JS 若不响应（App 被杀/WebView 冻结），通知照常送达；消息由 JS 打开 App 时补发。
 */
public class AlarmReceiver extends BroadcastReceiver {

    private static final Random RNG = new Random();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String id = intent.getStringExtra("id");
        if (id == null || id.length() == 0) return;
        Context ctx = context.getApplicationContext();

        JSONObject alarm = AlarmScheduler.findAlarm(ctx, id);
        if (alarm == null) return; // 已被删除/停用

        // 随机挑一条文案
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

        String partnerName = "对方";
        try {
            JSONObject cfg = AlarmScheduler.getConfig(ctx);
            if (cfg != null && cfg.optString("partnerName").length() > 0) {
                partnerName = cfg.optString("partnerName");
            }
        } catch (Exception ignored) {}

        // 1) 系统通知（消息通道：横幅 + 铃声 + 锁屏 + 角标）
        NotificationHelper.notifyMessage(ctx, partnerName, text, "alarm_" + id);

        // 2) 排明天的同一时间
        AlarmScheduler.scheduleNext(ctx, id, alarm.optString("time"));

        // 3) 通知 JS 立刻在聊天流里发消息（若 WebView 还活着）
        MainActivity.dispatchAlarmToJs(id);
    }
}
