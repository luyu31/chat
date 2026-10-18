package chat.milk.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * 后台主动消息调度 —— 让「用户把 App 从后台划掉」之后他还能发来消息。
 *
 * 为什么必须放在原生：App 被划掉后 WebView 连同 JS 一起没了，
 * 网页侧的任何定时器都不会再跑。所以这里由原生自己排闹钟、自己发通知，
 * 完全不依赖 WebView —— 只要进程还能被闹钟唤醒（划掉后台不影响），消息就照发。
 *
 * JS 侧把「字卡池 + 间隔」同步过来（syncAutoMsg），原生按随机间隔从池子里抽一句发出去。
 * 注意：用户在系统设置里「强行停止」过本应用后，Android 会冻结全部闹钟与广播，
 * 直到用户再次手动打开 App —— 这是系统限制，任何第三方应用都绕不过。
 */
public final class AutoMsgScheduler {

    public static final String PREFS = "milk_automsg";
    private static final String KEY_JSON = "automsg_json";
    public static final String ACTION = "chat.milk.app.AUTO_MSG";
    private static final int REQ = 0x5150;

    /** 安静时段：这段时间内不发（避免半夜把人吵醒），推迟到 7:00 之后 */
    private static final int QUIET_START_HOUR = 0;
    private static final int QUIET_END_HOUR = 7;

    private AutoMsgScheduler() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** JS 同步：{"enabled":true,"partnerName":"xx","minGapMin":30,"maxGapMin":120,"texts":[...]} */
    static void syncFromJson(Context ctx, String json) {
        prefs(ctx).edit().putString(KEY_JSON, json == null ? "" : json).apply();
        cancel(ctx);
        scheduleNext(ctx);
    }

    static JSONObject getConfig(Context ctx) {
        try {
            String raw = prefs(ctx).getString(KEY_JSON, "");
            if (raw == null || raw.length() == 0) return null;
            return new JSONObject(raw);
        } catch (Exception e) { return null; }
    }

    static void cancel(Context ctx) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(pi(ctx));
        } catch (Exception ignored) {}
    }

    /** 排下一条：间隔在 [minGapMin, maxGapMin] 里随机，落在安静时段就推到 7 点后 */
    static void scheduleNext(Context ctx) {
        JSONObject cfg = getConfig(ctx);
        if (cfg == null || !cfg.optBoolean("enabled", false)) return;
        JSONArray texts = cfg.optJSONArray("texts");
        if (texts == null || texts.length() == 0) return;

        int min = Math.max(5, cfg.optInt("minGapMin", 30));
        int max = Math.max(min, cfg.optInt("maxGapMin", 120));
        long delayMs = (long) ((min + Math.random() * (max - min)) * 60000L);
        long at = System.currentTimeMillis() + delayMs;

        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(at);
        int h = c.get(Calendar.HOUR_OF_DAY);
        if (h < QUIET_END_HOUR && h >= QUIET_START_HOUR) {
            c.set(Calendar.HOUR_OF_DAY, QUIET_END_HOUR);
            c.set(Calendar.MINUTE, 0);
            c.set(Calendar.SECOND, 0);
            c.set(Calendar.MILLISECOND, 0);
            at = c.getTimeInMillis();
        }

        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            // setAndAllowWhileIdle：Doze 休眠里也能醒来发消息，同时对电量友好
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(ctx));
        } catch (Exception ignored) {}
    }

    private static PendingIntent pi(Context ctx) {
        Intent i = new Intent(ctx, AutoMsgReceiver.class);
        i.setAction(ACTION);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx, REQ, i, flags);
    }

    /** 从字卡池里随机抽一句（跳过空串） */
    static String pickText(JSONObject cfg) {
        if (cfg == null) return null;
        try {
            JSONArray texts = cfg.optJSONArray("texts");
            if (texts == null || texts.length() == 0) return null;
            int n = 0;
            for (int i = 0; i < texts.length(); i++) {
                String t = texts.optString(i);
                if (t != null && t.trim().length() > 0) n++;
            }
            if (n == 0) return null;
            int pick = (int) (Math.random() * n);
            for (int i = 0; i < texts.length(); i++) {
                String t = texts.optString(i);
                if (t == null || t.trim().length() == 0) continue;
                if (pick-- == 0) return t.trim();
            }
        } catch (Exception ignored) {}
        return null;
    }

    static String partnerName(JSONObject cfg) {
        try {
            if (cfg != null && cfg.optString("partnerName").length() > 0) return cfg.optString("partnerName");
        } catch (Exception ignored) {}
        return "对方";
    }
}
