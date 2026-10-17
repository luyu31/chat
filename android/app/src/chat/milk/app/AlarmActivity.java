package chat.milk.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 全屏闹钟界面 —— 像手机原生闹钟一样：
 * 锁屏/息屏时由 fullScreenIntent 直接拉起（点亮屏幕、盖在锁屏上），
 * 显示当前时间 + 梦角的问候语，底部两个大按钮：「停止」「贪睡 N 分钟」。
 *
 * 响铃与震动由 AlarmPlayer 负责；本界面只负责熄灭它 + 排贪睡。
 */
public class AlarmActivity extends Activity {

    public static final String EXTRA_ID = "alarm_id";
    public static final String EXTRA_PARTNER = "partner_name";
    public static final String EXTRA_TEXT = "alarm_text";
    public static final String EXTRA_SNOOZE_MIN = "snooze_minutes";
    public static final String EXTRA_MAX_RING_MIN = "max_ring_minutes";
    /** 由闹钟到点流程拉起时为 true；仅仅是点开界面（误触）时为 false */
    public static final String EXTRA_RING = "ring";

    /** 时间显示每秒刷新 */
    private final Handler ticker = new Handler(Looper.getMainLooper());
    private TextView clockTv;
    private TextView whoTv;
    private TextView msgTv;
    private final SimpleDateFormat hmFmt = new SimpleDateFormat("HH:mm", Locale.getDefault());

    private String alarmId;
    private int snoozeMinutes = 5;
    private int maxRingMinutes = AlarmPlayer.DEFAULT_MAX_RING_MIN;
    private long createdMs;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (clockTv != null) clockTv.setText(hmFmt.format(new Date()));
            // 响铃已停（到最长时长自动停，或用户在通知栏点了「停止」）→ 界面一起收掉；
            // 刚进来的 1.5 秒内即使还没开始响也先不关，避免拉起瞬间闪一下
            if (!AlarmPlayer.isRinging() && System.currentTimeMillis() - createdMs > 1500) {
                dismiss();
                return;
            }
            ticker.postDelayed(tick, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 盖在锁屏上 + 点亮屏幕（原生闹钟就是这个行为）
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        Intent it = getIntent();
        alarmId = it == null ? null : it.getStringExtra(EXTRA_ID);
        String partner = it == null ? null : it.getStringExtra(EXTRA_PARTNER);
        String text = it == null ? null : it.getStringExtra(EXTRA_TEXT);
        if (it != null) {
            snoozeMinutes = it.getIntExtra(EXTRA_SNOOZE_MIN, 5);
            maxRingMinutes = it.getIntExtra(EXTRA_MAX_RING_MIN, AlarmPlayer.DEFAULT_MAX_RING_MIN);
        }
        if (partner == null || partner.length() == 0) partner = "对方";
        if (text == null || text.length() == 0) text = "时间到了，起来啦";
        if (snoozeMinutes <= 0) snoozeMinutes = 5;

        // 深色渐变背景（呼应 milk.chat 的粉调夜景）
        GradientDrawable bg = new GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0xFF2E2233, 0xFF15121A});
        getWindow().setBackgroundDrawable(bg);

        FrameLayout root = new FrameLayout(this);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(28), 0, dp(28), dp(54));
        col.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        col.setGravity(Gravity.CENTER_HORIZONTAL | Gravity.CENTER_VERTICAL);

        // 上面一行小字：谁在叫你
        whoTv = new TextView(this);
        whoTv.setText(partner);
        whoTv.setTextColor(0xFFF2A9BC);
        whoTv.setTextSize(17);
        whoTv.setTypeface(Typeface.DEFAULT_BOLD);
        whoTv.setGravity(Gravity.CENTER);
        col.addView(whoTv);

        // 大时钟
        clockTv = new TextView(this);
        clockTv.setText(hmFmt.format(new Date()));
        clockTv.setTextColor(0xFFF6F1EA);
        clockTv.setTextSize(76);
        clockTv.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        clockTv.setGravity(Gravity.CENTER);
        clockTv.setIncludeFontPadding(false);
        LinearLayout.LayoutParams clockLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        clockLp.topMargin = dp(10);
        clockTv.setLayoutParams(clockLp);
        col.addView(clockTv);

        // 问候语（就是刚才那条文案）
        msgTv = new TextView(this);
        msgTv.setText(text);
        msgTv.setTextColor(0xD9F6F1EA);
        msgTv.setTextSize(18);
        msgTv.setGravity(Gravity.CENTER);
        msgTv.setLineSpacing(dp(4), 1f);
        LinearLayout.LayoutParams msgLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        msgLp.topMargin = dp(22);
        msgTv.setLayoutParams(msgLp);
        col.addView(msgTv);

        // 按钮区
        LinearLayout btns = new LinearLayout(this);
        btns.setOrientation(LinearLayout.HORIZONTAL);
        btns.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams btnsLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        btnsLp.topMargin = dp(48);
        btns.setLayoutParams(btnsLp);

        btns.addView(makeButton("贪睡 " + snoozeMinutes + " 分钟", 0xFF5A4A63, 0xFFF6F1EA, new View.OnClickListener() {
            @Override
            public void onClick(View v) { doSnooze(); }
        }));
        View gap = new View(this);
        gap.setLayoutParams(new LinearLayout.LayoutParams(dp(14), 1));
        btns.addView(gap);
        btns.addView(makeButton("停止", 0xFFE8556D, 0xFFFFFFFF, new View.OnClickListener() {
            @Override
            public void onClick(View v) { doStop(); }
        }));

        col.addView(btns);
        root.addView(col);
        setContentView(root);

        // 只有"真的该响"才启动：Receiver 已经先启动过（isRingingFor 命中），
        // 或者 intent 明确带了 ring=true。否则说明只是误触打开，直接关掉。
        createdMs = System.currentTimeMillis();
        boolean wantRing = AlarmPlayer.isRingingFor(alarmId)
                || (it != null && it.getBooleanExtra(EXTRA_RING, false));
        if (!wantRing) {
            finish();
            return;
        }
        AlarmPlayer.start(this, alarmId, maxRingMinutes);
        ticker.post(tick);
    }

    /** 圆角大按钮 */
    private Button makeButton(String label, int bgColor, int textColor, View.OnClickListener click) {
        Button b = new Button(this);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.RECTANGLE);
        bg.setCornerRadius(dp(26));
        bg.setColor(bgColor);
        b.setBackgroundDrawable(bg);
        b.setText(label);
        b.setTextColor(textColor);
        b.setTextSize(16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setAllCaps(false);
        b.setOnClickListener(click);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(58), 1f);
        b.setLayoutParams(lp);
        return b;
    }

    private void doStop() {
        AlarmPlayer.stop(this);
        // 停止 = 今天这个闹钟彻底不响了，顺手把可能存在的贪睡也一起取消
        AlarmScheduler.cancelSnooze(this, alarmId);
        NotificationHelper.cancelAlarmNotification(this);
        // 告诉 JS：用户已经起床关掉了（聊天流里记一笔，顺便停 TTS/界面状态）
        MainActivity.dispatchAlarmAction("stop", alarmId);
        dismiss();
    }

    private void doSnooze() {
        AlarmPlayer.stop(this);
        NotificationHelper.cancelAlarmNotification(this);
        // 排一个 N 分钟后的一次性闹钟（同一个 id，但不影响明天的每日闹钟）
        AlarmScheduler.scheduleSnooze(this, alarmId, snoozeMinutes, maxRingMinutes);
        MainActivity.dispatchAlarmAction("snooze", alarmId);
        dismiss();
    }

    /** 只关界面，不停响铃（用于被系统/用户划走的兜底路径） */
    private void dismiss() {
        finish();
    }

    @Override
    protected void onStart() {
        super.onStart();
        // 从后台回到本界面：只要还在响就继续保持（start 对同一个 id 是幂等的，不会重启一遍）
        if (AlarmPlayer.isRingingFor(alarmId)) {
            AlarmPlayer.start(this, alarmId, maxRingMinutes);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // 两个闹钟挨得很近时会复用同一个界面：把新闹钟的信息刷新上去，别显示上一条
        applyIntent(intent);
    }

    /** 把 intent 里的闹钟信息刷到界面/状态上（新建时与复用界面时都用） */
    private void applyIntent(Intent it) {
        if (it == null) return;
        String partner = it.getStringExtra(EXTRA_PARTNER);
        String text = it.getStringExtra(EXTRA_TEXT);
        int sn = it.getIntExtra(EXTRA_SNOOZE_MIN, 5);
        int mr = it.getIntExtra(EXTRA_MAX_RING_MIN, AlarmPlayer.DEFAULT_MAX_RING_MIN);
        alarmId = it.getStringExtra(EXTRA_ID);
        snoozeMinutes = sn > 0 ? sn : 5;
        maxRingMinutes = mr > 0 ? mr : AlarmPlayer.DEFAULT_MAX_RING_MIN;
        if (whoTv != null) whoTv.setText((partner == null || partner.length() == 0) ? "对方" : partner);
        if (msgTv != null) msgTv.setText((text == null || text.length() == 0) ? "时间到了，起来啦" : text);
        createdMs = System.currentTimeMillis();
        if (AlarmPlayer.isRingingFor(alarmId) || it.getBooleanExtra(EXTRA_RING, false)) {
            AlarmPlayer.start(this, alarmId, maxRingMinutes);
            ticker.removeCallbacks(tick);
            ticker.post(tick);
        }
    }

    @Override
    public void onBackPressed() {
        // 原生闹钟不许用返回键草草关掉：只能「停止」或「贪睡」
        // （保留空实现，避免误触退出后铃声还在响）
    }

    @Override
    protected void onDestroy() {
        ticker.removeCallbacks(tick);
        super.onDestroy();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
