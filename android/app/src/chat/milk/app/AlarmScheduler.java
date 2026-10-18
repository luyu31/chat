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
 * 为每个启用的闹钟注册下一个触发点。
 *
 * 用 {@link AlarmManager#setAlarmClock} 注册（而不是普通的 setExact）：
 *  - 这是系统给"闹钟类应用"的专用通道，不受 Doze 休眠压制，到点几乎必响
 *  - 状态栏会显示闹钟图标，跟手机自带闹钟一样
 *  - 系统会提前把设备唤醒，保证响铃 + 点亮屏幕来得及
 *
 * 两类闹钟：
 *  - 每日闹钟（ACTION_ALARM）：按每天的 HH:mm 排下一次，响完自动排明天
 *  - 贪睡闹钟（ACTION_SNOOZE）：用户点「贪睡」后的一次性 N 分钟后触发，
 *    用不同的 requestCode，所以下次 JS 同步（会重排每日闹钟）不会把它冲掉
 */
public final class AlarmScheduler {

    public static final String PREFS = "milk_alarms";
    private static final String KEY_JSON = "alarms_json";

    public static final String ACTION_ALARM  = "chat.milk.app.ALARM_GREET";
    public static final String ACTION_SNOOZE = "chat.milk.app.ALARM_SNOOZE";
    public static final String ACTION_STOP   = "chat.milk.app.ALARM_STOP";

    /** 默认最长响铃时长（分钟） */
    public static final int DEFAULT_MAX_RING_MIN = 10;
    /** 默认贪睡时长（分钟） */
    public static final int DEFAULT_SNOOZE_MIN = 5;

    private AlarmScheduler() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** JS 同步：{"partnerName":"xx","snoozeMinutes":5,"maxRingMinutes":10,"alarms":[{"id","name","time","texts"}]} */
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

    static int snoozeMinutes(Context ctx) {
        try {
            JSONObject cfg = getConfig(ctx);
            if (cfg == null) return DEFAULT_SNOOZE_MIN;
            int v = cfg.optInt("snoozeMinutes", DEFAULT_SNOOZE_MIN);
            return v > 0 ? v : DEFAULT_SNOOZE_MIN;
        } catch (Exception e) { return DEFAULT_SNOOZE_MIN; }
    }

    static int maxRingMinutes(Context ctx) {
        try {
            JSONObject cfg = getConfig(ctx);
            if (cfg == null) return DEFAULT_MAX_RING_MIN;
            int v = cfg.optInt("maxRingMinutes", DEFAULT_MAX_RING_MIN);
            return v > 0 ? v : DEFAULT_MAX_RING_MIN;
        } catch (Exception e) { return DEFAULT_MAX_RING_MIN; }
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

    /** 全量重排每日闹钟：先清掉旧的每日闹钟，再为每个启用的闹钟注册下一次。
     *  注意：不会动「贪睡」闹钟，避免 App 一回前台同步就把待触发的贪睡冲掉。 */
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

    private static int reqCodeDaily(String id)  { return ("alarm_"  + id).hashCode() & 0x7fffffff; }
    private static int reqCodeSnooze(String id) { return ("snooze_" + id).hashCode() & 0x7fffffff; }

    private static PendingIntent dailyPi(Context ctx, String id, boolean gentle) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction(ACTION_ALARM);
        i.putExtra("id", id);
        i.putExtra("gentle", gentle);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx, reqCodeDaily(id), i, flags);
    }

    private static PendingIntent snoozePi(Context ctx, String id, int flagsExtra) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction(ACTION_SNOOZE);
        i.putExtra("id", id);
        i.putExtra("snooze", true);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx, reqCodeSnooze(id), i, flags);
    }

    /**
     * setAlarmClock 需要传入的 showIntent：用户在状态栏点「即将响的闹钟」图标时打开什么。
     * 这里开主界面（不是全屏闹钟界面）——否则闹钟还没到点，点一下图标就先响起来了。
     */
    private static PendingIntent alarmShowPi(Context ctx, String id) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, reqCodeDaily(id) + 7, i, flags);
    }

    /** 注册某个每日闹钟的下一次触发（今天已过时间则排明天）。
     *  温柔提醒（gentle）走普通精确闹钟，不用 setAlarmClock —— 这样不显示状态栏闹钟图标、
     *  也不走"闹钟优先"通道；真闹钟才用 setAlarmClock。 */
    static void scheduleNext(Context ctx, String id, String hhmm) {
        if (id == null || id.length() == 0) return;
        Calendar cal = nextOccurrence(hhmm);
        if (cal == null) return;
        JSONObject a = findAlarm(ctx, id);
        boolean gentle = a != null && a.optBoolean("gentle", false);
        if (gentle) {
            setExactWake(ctx, cal.getTimeInMillis(), dailyPi(ctx, id, true));
        } else {
            setAlarmClock(ctx, cal.getTimeInMillis(), dailyPi(ctx, id, false), id);
        }
    }

    private static void setExactWake(Context ctx, long triggerAtMs, PendingIntent operation) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            if (Build.VERSION.SDK_INT >= 23) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, operation);
            else if (Build.VERSION.SDK_INT >= 19) am.setExact(AlarmManager.RTC_WAKEUP, triggerAtMs, operation);
            else am.set(AlarmManager.RTC_WAKEUP, triggerAtMs, operation);
        } catch (Exception e) {
            try { am.set(AlarmManager.RTC_WAKEUP, triggerAtMs, operation); } catch (Exception ignored) {}
        }
    }

    private static Calendar nextOccurrence(String hhmm) {
        String[] parts = (hhmm == null ? "" : hhmm).split(":");
        if (parts.length != 2) return null;
        int h, mi;
        try {
            h = Integer.parseInt(parts[0].trim());
            mi = Integer.parseInt(parts[1].trim());
        } catch (NumberFormatException e) { return null; }
        if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;

        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, h);
        cal.set(Calendar.MINUTE, mi);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        // 给补发逻辑留一点余量：恰好"现在"时排明天
        if (cal.getTimeInMillis() <= System.currentTimeMillis() + 20000) {
            cal.add(Calendar.DAY_OF_YEAR, 1);
        }
        return cal;
    }

    /** 贪睡：过 minutes 分钟后响一次（一次性，不影响每日闹钟） */
    static void scheduleSnooze(Context ctx, String id, int minutes, int maxRingMinutes) {
        if (id == null || id.length() == 0) return;
        int min = minutes > 0 ? minutes : DEFAULT_SNOOZE_MIN;
        long at = System.currentTimeMillis() + min * 60L * 1000L;
        setAlarmClock(ctx, at, snoozePi(ctx, id, 0), id);
    }

    /** 取消某个闹钟待触发的贪睡 */
    static void cancelSnooze(Context ctx, String id) {
        if (id == null || id.length() == 0) return;
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(snoozePi(ctx, id, 0));
        } catch (Exception ignored) {}
    }

    private static void setAlarmClock(Context ctx, long triggerAtMs, PendingIntent operation, String id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            AlarmManager.AlarmClockInfo info =
                    new AlarmManager.AlarmClockInfo(triggerAtMs, alarmShowPi(ctx, id));
            am.setAlarmClock(info, operation);
        } catch (Exception e) {
            // 极端情况下退回精确闹钟，保证至少能响
            try {
                if (Build.VERSION.SDK_INT >= 23) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, operation);
                else am.setExact(AlarmManager.RTC_WAKEUP, triggerAtMs, operation);
            } catch (Exception ignored) {}
        }
    }

    /** 取消所有「每日闹钟」（贪睡闹钟不在内，见 cancelSnooze） */
    static void cancelAll(Context ctx) {
        try {
            JSONObject cfg = getConfig(ctx);
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            if (cfg != null) {
                JSONArray arr = cfg.optJSONArray("alarms");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject a = arr.optJSONObject(i);
                        if (a == null) continue;
                        try { am.cancel(dailyPi(ctx, a.optString("id"), false)); } catch (Exception ignored) {}
                    }
                }
            }
        } catch (Exception ignored) {}
    }
}
