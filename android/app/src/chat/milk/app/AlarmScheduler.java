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
 * 定时问候闹钟调度：JS 侧把闹钟表同步过来（syncAlarms），
 * 为每个启用的闹钟注册下一个触发点（AlarmManager 精确闹钟，锁屏也会触发）。
 */
public final class AlarmScheduler {

    public static final String PREFS = "milk_alarms";
    private static final String KEY_JSON = "alarms_json";

    private AlarmScheduler() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** JS 同步：{"partnerName":"xx","alarms":[{"id","name","time","texts"}]} */
    static void syncFromJson(Context ctx, String json) {
        prefs(ctx).edit().putString(KEY_JSON, json == null ? "" : json).apply();
        scheduleAll(ctx);
    }

    static JSONObject getConfig(Context ctx) {
        try {
            String raw = prefs(ctx).getString(KEY_JSON, "");
            if (raw == null || raw.length() == 0) return null;
            return new JSONObject(raw);
        } catch (Exception e) { return null; }
    }

    static JSONObject findAlarm(Context ctx, String id) {
        try {
            JSONObject cfg = getConfig(ctx);
            if (cfg == null) return null;
            JSONArray arr = cfg.optJSONArray("alarms");
            if (arr == null) return null;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject a = arr.optJSONObject(i);
                if (a != null && id.equals(a.optString("id"))) return a;
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** 全量重排：先清掉本应用所有闹钟，再为每个启用的闹钟注册下一次 */
    static void scheduleAll(Context ctx) {
        cancelAll(ctx);
        try {
            JSONObject cfg = getConfig(ctx);
            if (cfg == null) return;
            JSONArray arr = cfg.optJSONArray("alarms");
            if (arr == null) return;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject a = arr.optJSONObject(i);
                if (a == null) continue;
                scheduleNext(ctx, a.optString("id"), a.optString("time"));
            }
        } catch (Exception ignored) {}
    }

    /** 注册某个闹钟的下一次触发（今天已过时间则排明天） */
    static void scheduleNext(Context ctx, String id, String hhmm) {
        if (id == null || id.length() == 0) return;
        String[] parts = (hhmm == null ? "" : hhmm).split(":");
        if (parts.length != 2) return;
        int h, mi;
        try {
            h = Integer.parseInt(parts[0].trim());
            mi = Integer.parseInt(parts[1].trim());
        } catch (NumberFormatException e) { return; }
        if (h < 0 || h > 23 || mi < 0 || mi > 59) return;

        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, h);
        cal.set(Calendar.MINUTE, mi);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        // 给补发逻辑留一点余量：恰好"现在"时排下一分钟今天，否则明天
        if (cal.getTimeInMillis() <= System.currentTimeMillis() + 20000) {
            cal.add(Calendar.DAY_OF_YEAR, 1);
        }

        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction("chat.milk.app.ALARM_GREET");
        i.putExtra("id", id);
        int requestCode = ("alarm_" + id).hashCode() & 0x7fffffff;
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getBroadcast(ctx, requestCode, i, flags);

        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            // targetSdk 30：无需 SCHEDULE_EXACT_ALARM 用户授权即可精确触发
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
        } catch (Exception e) {
            try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi); } catch (Exception ignored) {}
        }
    }

    static void cancelAll(Context ctx) {
        try {
            JSONObject cfg = getConfig(ctx);
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            // 用配置里出现过的 id 一一取消；再兜底取消固定集合外无法枚举的情况
            if (cfg != null) {
                JSONArray arr = cfg.optJSONArray("alarms");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject a = arr.optJSONObject(i);
                        if (a == null) continue;
                        cancelOne(ctx, am, a.optString("id"));
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    private static void cancelOne(Context ctx, AlarmManager am, String id) {
        try {
            Intent i = new Intent(ctx, AlarmReceiver.class);
            i.setAction("chat.milk.app.ALARM_GREET");
            i.putExtra("id", id);
            int requestCode = ("alarm_" + id).hashCode() & 0x7fffffff;
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(ctx, requestCode, i, flags);
            am.cancel(pi);
        } catch (Exception ignored) {}
    }
}
