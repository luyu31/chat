package chat.milk.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.File;
import java.io.FileInputStream;

/**
 * 全屏来电界面：锁屏时由 fullScreenIntent 通知直接拉起（像系统来电），
 * 亮屏但 App 在后台时以横幅通知形式出现，点横幅也会进入本界面。
 */
public class IncomingCallActivity extends Activity {

    public static final String EXTRA_NAME = "name";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 锁屏上直接显示 + 点亮屏幕
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        String name = getIntent().getStringExtra(EXTRA_NAME);
        if (name == null || name.length() == 0) name = "对方";

        // 背景：深色渐变（粉调，呼应 milk.chat）
        GradientDrawable bg = new GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0xFF3A2A38, 0xFF171219});
        getWindow().setBackgroundDrawable(bg);

        FrameLayout root = new FrameLayout(this);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(0, dp(76), 0, dp(64));
        card.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        // 头像（圆形，无头像用粉色渐变占位）
        ImageView avatar = new ImageView(this);
        Bitmap circle = makeCircleAvatar();
        if (circle != null) {
            avatar.setImageBitmap(circle);
        } else {
            GradientDrawable avBg = new GradientDrawable();
            avBg.setShape(GradientDrawable.OVAL);
            avBg.setColors(new int[]{0xFFF2A9BC, 0xFFE58AA4});
            avBg.setOrientation(GradientDrawable.Orientation.TL_BR);
            avatar.setImageDrawable(avBg);
        }
        avatar.setLayoutParams(new LinearLayout.LayoutParams(dp(96), dp(96)));
        card.addView(avatar);

        // 名字
        TextView nameTv = new TextView(this);
        nameTv.setText(name);
        nameTv.setTextColor(0xFFF6F1EA);
        nameTv.setTextSize(26);
        nameTv.setTypeface(Typeface.DEFAULT_BOLD);
        nameTv.setPadding(0, dp(18), 0, 0);
        nameTv.setGravity(Gravity.CENTER);
        card.addView(nameTv);

        // 副标题
        TextView subTv = new TextView(this);
        subTv.setText("milk.chat · 邀请您进行视频通话");
        subTv.setTextColor(0xB3F6F1EA);
        subTv.setTextSize(14);
        subTv.setPadding(dp(24), dp(8), dp(24), 0);
        subTv.setGravity(Gravity.CENTER);
        card.addView(subTv);

        // 按钮区：拒绝 / 接听
        LinearLayout btns = new LinearLayout(this);
        btns.setOrientation(LinearLayout.HORIZONTAL);
        btns.setGravity(Gravity.CENTER_HORIZONTAL);
        LinearLayout.LayoutParams btnsLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        btnsLp.topMargin = dp(56);
        btns.setLayoutParams(btnsLp);

        btns.addView(makeAction("拒绝", "✕", 0xFFE8556D, "decline"));
        View gap = new View(this);
        gap.setLayoutParams(new LinearLayout.LayoutParams(dp(64), 1));
        btns.addView(gap);
        btns.addView(makeAction("接听", "✓", 0xFF3EAE5A, "answer"));

        card.addView(btns);
        root.addView(card);
        setContentView(root);
    }

    /** 圆形按钮 + 下方文字，点击触发对应动作 */
    private View makeAction(String label, String glyph, int color, final String action) {
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setGravity(Gravity.CENTER_HORIZONTAL);

        Button circle = new Button(this);
        GradientDrawable cd = new GradientDrawable();
        cd.setShape(GradientDrawable.OVAL);
        cd.setColor(color);
        circle.setBackgroundDrawable(cd);
        circle.setText(glyph);
        circle.setTextColor(0xFFFFFFFF);
        circle.setTextSize(24);
        circle.setPadding(0, 0, 0, 0);
        circle.setLayoutParams(new LinearLayout.LayoutParams(dp(72), dp(72)));
        View.OnClickListener click = new View.OnClickListener() {
            @Override
            public void onClick(View v) { action(action); }
        };
        circle.setOnClickListener(click);

        TextView tv = new TextView(this);
        tv.setText(label);
        tv.setTextColor(0xCCF6F1EA);
        tv.setTextSize(15);
        tv.setPadding(0, dp(10), 0, 0);
        tv.setGravity(Gravity.CENTER);

        wrap.addView(circle);
        wrap.addView(tv);
        wrap.setOnClickListener(click);
        return wrap;
    }

    private void action(String act) {
        RingtonePlayer.stop(this);
        NotificationHelper.cancelCallNotification(this);
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra("call_action", act);
        try { startActivity(i); } catch (Exception ignored) {}
        finish();
    }

    private Bitmap makeCircleAvatar() {
        try {
            File f = new File(getFilesDir(), "call_avatar.png");
            if (!f.exists()) return null;
            Bitmap src = BitmapFactory.decodeStream(new FileInputStream(f));
            if (src == null) return null;
            int sz = dp(96);
            BitmapShader shader = new BitmapShader(src,
                    BitmapShader.TileMode.CLAMP, BitmapShader.TileMode.CLAMP);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setShader(shader);
            Bitmap circle = Bitmap.createBitmap(sz, sz, Bitmap.Config.ARGB_8888);
            new Canvas(circle).drawCircle(sz / 2f, sz / 2f, sz / 2f, paint);
            return circle;
        } catch (Exception e) {
            return null;
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onStart() {
        super.onStart();
        // 横幅点进来但铃声没响（如铃声被系统停了）时补响
        if (!RingtonePlayer.isPlaying()) RingtonePlayer.start(this);
    }

    @Override
    public void onBackPressed() {
        // 来电界面不响应返回键（像系统来电），只能接听或拒绝
    }
}
