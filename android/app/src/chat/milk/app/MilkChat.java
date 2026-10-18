package chat.milk.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

/** JS 桥：页面里通过 window.MilkChat 调用原生通知 / 角标 / 提醒能力。 */
public class MilkChat {

    public static java.lang.ref.WeakReference<MainActivity> activityRef;

    private final Context ctx;

    public MilkChat(Context c) {
        this.ctx = c.getApplicationContext();
    }

    /** 发一条系统通知（横幅 + 锁屏 + 通知栏 + 角标+1） */
    @JavascriptInterface
    public void notify(String title, String body, String tag) {
        NotificationHelper.notifyMessage(ctx, title, body, tag);
    }

    /** 当前通知权限状态：granted / default / denied */
    @JavascriptInterface
    public String notifPermission() {
        if (Build.VERSION.SDK_INT < 33) return "granted";
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        boolean enabled = nm != null && nm.areNotificationsEnabled();
        if (enabled) return "granted";
        return NotificationHelper.isNotifPermissionAsked(ctx) ? "denied" : "default";
    }

    /**
     * 请求通知权限。返回 "granted"（已授权或系统无需授权）或 "pending"（弹窗进行中，轮询 notifPermission）。
     */
    @JavascriptInterface
    public String requestNotifPermission() {
        if (Build.VERSION.SDK_INT < 33) return "granted";
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && nm.areNotificationsEnabled()) return "granted";
        NotificationHelper.markNotifPermissionAsked(ctx);
        MainActivity act = activityRef == null ? null : activityRef.get();
        if (act != null) {
            act.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity a = activityRef == null ? null : activityRef.get();
                    if (a != null) {
                        a.requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},
                                MainActivity.NOTIF_PERM_CODE);
                    }
                }
            });
            return "pending";
        }
        return "default";
    }

    @JavascriptInterface
    public int getBadge() {
        return NotificationHelper.getUnread(ctx);
    }

    @JavascriptInterface
    public void setBadge(int n) {
        NotificationHelper.setBadgeCount(ctx, n);
    }

    @JavascriptInterface
    public void clearBadge() {
        NotificationHelper.setBadgeCount(ctx, 0);
    }

    @JavascriptInterface
    public void toast(final String msg) {
        MainActivity act = activityRef == null ? null : activityRef.get();
        if (act == null) return;
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show();
            }
        });
    }

    @JavascriptInterface
    public void vibrate(int ms) {
        try {
            android.os.Vibrator v = (android.os.Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(Math.max(1, Math.min(ms, 3000)));
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public boolean isBackground() {
        return true; // 仅在 JS 侧配合 document.hidden 判断使用
    }

    // ─── 全屏来电 ───

    /**
     * 来电：保存头像（可选）→ 播放原生铃声（可选）→ 发全屏来电通知。
     * @param name 对方名字
     * @param avatarDataUrl 头像 dataURL（http 链接或空则不显示头像）
     * @param ring 是否响铃（JS 侧根据用户音效设置传）
     * @param vibrate 是否震动（JS 侧根据"来电震动"开关传，缺省按 true 处理）
     * @param mode "voice"=语音通话 / 其它=视频通话（只影响原生界面的文案）
     */
    @JavascriptInterface
    public void startRinging(String name, String avatarDataUrl, boolean ring, Boolean vibrate, String mode) {
        try {
            if (avatarDataUrl != null && avatarDataUrl.startsWith("data:image/")) {
                String b64 = avatarDataUrl.substring(avatarDataUrl.indexOf(",") + 1);
                byte[] data = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                java.io.FileOutputStream fos = ctx.openFileOutput("call_avatar.png", Context.MODE_PRIVATE);
                fos.write(data); fos.flush(); fos.close();
            }
        } catch (Exception ignored) {}
        boolean voice = "voice".equals(mode);
        boolean v = (vibrate == null) || vibrate;
        if (ring) RingtonePlayer.start(ctx, true, v);
        else RingtonePlayer.start(ctx, false, v); // 关铃声时仍可走原生震动（比 navigator.vibrate 可靠）
        NotificationHelper.showIncomingCallNotification(ctx, name, voice);

        // 直接拉起全屏来电界面：锁屏走上面 fullScreenIntent，这里再兜底一遍，
        // 让"亮屏但 App 在后台/在别的 App 里"时也尽量像系统来电一样全屏弹出。
        // 系统若拦截后台启动 Activity 会抛异常，直接吞掉，仍有横幅通知可用。
        try {
            Intent i = new Intent(ctx, IncomingCallActivity.class);
            i.putExtra(IncomingCallActivity.EXTRA_NAME, name);
            i.putExtra(IncomingCallActivity.EXTRA_VOICE, voice);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            ctx.startActivity(i);
        } catch (Exception ignored) {}
    }

    /** 停止铃声并取消来电通知（接听/拒绝/超时后由 JS 调用） */
    @JavascriptInterface
    public void stopRinging() {
        RingtonePlayer.stop(ctx);
        NotificationHelper.cancelCallNotification(ctx);
    }

    // ─── 自选来电铃声 ───

    /** 打开系统铃声选择器（选系统铃声）；失败则回退文件选择 */
    @JavascriptInterface
    public void pickRingtone() {
        MainActivity act = activityRef == null ? null : activityRef.get();
        if (act == null) return;
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                MainActivity a = activityRef == null ? null : activityRef.get();
                if (a != null) a.launchRingtonePicker();
            }
        });
    }

    /** 打开文件选择器选铃声（下载的音乐等） */
    @JavascriptInterface
    public void pickRingtoneFile() {
        MainActivity act = activityRef == null ? null : activityRef.get();
        if (act == null) return;
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                MainActivity a = activityRef == null ? null : activityRef.get();
                if (a != null) a.launchRingtoneFilePicker();
            }
        });
    }

    /** 是否已设置自选铃声 */
    @JavascriptInterface
    public boolean hasRingtone() {
        return RingtonePlayer.hasCustom(ctx);
    }

    /** 当前铃声名字（未设置为空串） */
    @JavascriptInterface
    public String getRingtoneName() {
        return RingtonePlayer.getName(ctx);
    }

    /** 恢复默认铃声 */
    @JavascriptInterface
    public void clearRingtone() {
        try { new java.io.File(ctx.getFilesDir(), "ringtone").delete(); } catch (Exception ignored) {}
        RingtonePlayer.setPrefs(ctx, null, null);
    }

    /** 试听当前铃声 3 秒（走媒体音量；震动与否由 JS 侧"来电震动"开关决定） */
    @JavascriptInterface
    public void previewRingtone(Boolean vibrate) {
        boolean v = (vibrate == null) || vibrate;
        // preview 而非 start：试听走媒体音量，避免铃声音量为 0 / 静音模式下"试听没声音"
        RingtonePlayer.preview(ctx, true, v);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try { Thread.sleep(3000); } catch (InterruptedException ignored) {}
                RingtonePlayer.stop(ctx);
            }
        }).start();
    }

    /**
     * 震动测试：设置里"震动测试"按钮用，只震不响铃。
     * 用最大振幅连震约 3 秒（默认振幅在部分机型上弱到几乎感觉不到）。
     */
    @JavascriptInterface
    public void vibrateTest() {
        try {
            android.os.Vibrator vt = RingtonePlayer.getVibrator(ctx);
            if (vt == null || !vt.hasVibrator()) {
                toast("震动测试失败：这台设备没有可用的震动器");
                return;
            }
            final long[] pattern = {0, 600, 200, 600, 200, 600, 200, 600};
            if (Build.VERSION.SDK_INT >= 26) {
                try {
                    vt.vibrate(android.os.VibrationEffect.createWaveform(
                            pattern, RingtonePlayer.amplitudeArray(pattern), -1));
                } catch (Exception e) {
                    vt.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1));
                }
            } else {
                vt.vibrate(pattern, -1);
            }
            toast("已发送震动信号（约 3 秒）");
        } catch (Exception e) {
            toast("震动测试失败：" + (e.getMessage() == null ? "未知原因" : e.getMessage()));
        }
    }

    /**
     * 设备声音/震动状态自检：把关键状态返回给 JS，设置里"设备检测"按钮用。
     * 用来判断"为什么没声音/没震动"到底是手机设置问题还是功能问题。
     */
    @JavascriptInterface
    public String audioDiag() {
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            android.media.AudioManager am = (android.media.AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int rm = am.getRingerMode();
                o.put("ringerMode", rm == android.media.AudioManager.RINGER_MODE_SILENT ? "silent"
                        : (rm == android.media.AudioManager.RINGER_MODE_VIBRATE ? "vibrate" : "normal"));
                o.put("ringVol", am.getStreamVolume(android.media.AudioManager.STREAM_RING));
                o.put("ringMax", am.getStreamMaxVolume(android.media.AudioManager.STREAM_RING));
                o.put("musicVol", am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC));
                o.put("musicMax", am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC));
                o.put("dnd", am.getStreamVolume(android.media.AudioManager.STREAM_RING) == 0 && rm == android.media.AudioManager.RINGER_MODE_SILENT);
            }
            android.os.Vibrator v = RingtonePlayer.getVibrator(ctx);
            boolean hasV = v != null && v.hasVibrator();
            o.put("hasVibrator", hasV);
            o.put("amplitude", hasV && Build.VERSION.SDK_INT >= 26 && v.hasAmplitudeControl());
            o.put("sdk", Build.VERSION.SDK_INT);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    // ─── 定时问候闹钟 ───

    /**
     * JS 同步闹钟表（每次增删改/启动/回前台时调用）：
     * {"partnerName":"xx","snoozeMinutes":5,"maxRingMinutes":10,
     *  "alarms":[{"id","name","time","texts":[...]}]}
     * 原生为每个启用的闹钟注册 AlarmManager 闹钟（setAlarmClock 通道，
     * 不受 Doze 压制），到点响铃 + 震动 + 全屏闹钟界面。
     */
    @JavascriptInterface
    public void syncAlarms(String json) {
        AlarmScheduler.syncFromJson(ctx, json);
    }

    /** 立刻试响一次闹钟（设置里的「试一下」按钮）：响 1 分钟或用户点停止 */
    @JavascriptInterface
    public void testAlarm(String name, String text) {
        String who = (name == null || name.length() == 0) ? "对方" : name;
        String body = (text == null || text.length() == 0) ? "闹钟试响一下～" : text;
        final int cap = 1; // 试响最长 1 分钟，不吵太久
        AlarmPlayer.start(ctx, "__test__", cap);
        NotificationHelper.showAlarmNotification(ctx, who, body, "__test__",
                AlarmScheduler.snoozeMinutes(ctx), cap);
        try {
            android.content.Intent act = new android.content.Intent(ctx, AlarmActivity.class);
            act.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK
                    | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
            act.putExtra(AlarmActivity.EXTRA_ID, "__test__");
            act.putExtra(AlarmActivity.EXTRA_PARTNER, who);
            act.putExtra(AlarmActivity.EXTRA_TEXT, body);
            act.putExtra(AlarmActivity.EXTRA_SNOOZE_MIN, AlarmScheduler.snoozeMinutes(ctx));
            act.putExtra(AlarmActivity.EXTRA_MAX_RING_MIN, cap);
            act.putExtra(AlarmActivity.EXTRA_RING, true);
            ctx.startActivity(act);
        } catch (Exception ignored) {}
    }

    /** 停止正在响的闹钟（用户在 App 里点了停止时调用） */
    @JavascriptInterface
    public void stopAlarm() {
        AlarmPlayer.stop(ctx);
        NotificationHelper.cancelAlarmNotification(ctx);
    }

    /** 贪睡：停响 + 排 N 分钟后再响一次 */
    @JavascriptInterface
    public void snoozeAlarm(String id, int minutes) {
        AlarmPlayer.stop(ctx);
        NotificationHelper.cancelAlarmNotification(ctx);
        if (id != null && id.length() > 0) {
            AlarmScheduler.scheduleSnooze(ctx, id,
                    minutes > 0 ? minutes : AlarmScheduler.snoozeMinutes(ctx),
                    AlarmScheduler.maxRingMinutes(ctx));
        }
    }

    /** 当前是否有闹钟正在响 */
    @JavascriptInterface
    public boolean isAlarmRinging() {
        return AlarmPlayer.isRinging();
    }

    // ─── 后台主动消息（App 被划掉也能发） ───

    /**
     * JS 同步后台主动消息配置：
     * {"enabled":true,"partnerName":"xx","minGapMin":30,"maxGapMin":120,"texts":[...]}
     * 原生会按随机间隔自己发通知 —— 不依赖 WebView，所以后台划掉 App 也照发。
     */
    @JavascriptInterface
    public void syncAutoMsg(String json) {
        AutoMsgScheduler.syncFromJson(ctx, json);
    }

    // ─── 自定义应用图标（桌面快捷方式） ───

    /**
     * 在桌面钉一个自定义图标/名字的启动快捷方式（固定 id，重复添加=覆盖）。
     * 原应用图标不受影响。需要 Android 8.0+ 且桌面支持 pin shortcut。
     * @param label 图标下显示的名字（空则用默认）
     * @param iconBase64 PNG dataURL 的 base64 部分（192×192 圆角图）
     * @return "ok" 系统确认窗已弹出 / "no_launcher" 桌面不支持 /
     *         "old_android" 系统 < 8.0 / "error" 参数异常
     */
    @JavascriptInterface
    public String pinAppShortcut(final String label, final String iconBase64) {
        if (Build.VERSION.SDK_INT < 26) return "old_android";

        // 桌面是否支持钉快捷方式（同步查，保证返回码准确）
        android.content.pm.ShortcutManager smCheck =
                (android.content.pm.ShortcutManager) ctx.getSystemService(Context.SHORTCUT_SERVICE);
        if (smCheck == null || !smCheck.isRequestPinShortcutSupported()) return "no_launcher";

        // 解码图标（在桥线程做，别占 UI 线程）
        android.graphics.Bitmap bmp = null;
        try {
            String b64 = iconBase64;
            if (b64 != null && b64.startsWith("data:image/")) {
                b64 = b64.substring(b64.indexOf(",") + 1);
            }
            byte[] data = android.util.Base64.decode(b64 == null ? "" : b64, android.util.Base64.DEFAULT);
            bmp = android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length);
        } catch (Exception ignored) {}
        if (bmp == null) return "error";

        final String name = (label == null || label.trim().length() == 0) ? "milk.chat" : label.trim();
        final android.graphics.Bitmap icon = bmp;

        final MainActivity act = activityRef == null ? null : activityRef.get();
        if (act == null) return "error";

        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    android.content.pm.ShortcutManager sm =
                            (android.content.pm.ShortcutManager) ctx.getSystemService(Context.SHORTCUT_SERVICE);
                    if (sm == null) return;
                    // 快捷方式点开 = 启动 MainActivity（singleTask，热启动直接回前台）
                    Intent it = new Intent(ctx, MainActivity.class);
                    it.setAction(Intent.ACTION_MAIN);
                    it.addCategory(Intent.CATEGORY_LAUNCHER);
                    it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                    android.content.pm.ShortcutInfo info =
                            new android.content.pm.ShortcutInfo.Builder(ctx, "custom_app_icon")
                                    .setShortLabel(name)
                                    .setLongLabel(name)
                                    .setIcon(android.graphics.drawable.Icon.createWithBitmap(icon))
                                    .setIntent(it)
                                    .build();
                    sm.requestPinShortcut(info, null);
                } catch (Exception e) {
                    Toast.makeText(ctx, "添加图标失败", Toast.LENGTH_SHORT).show();
                }
            }
        });
        return "ok";
    }

    /** 备份导出：JS 侧把 blob/data 内容转成 base64 交由原生保存（SAF 选择位置） */
    @JavascriptInterface
    public void saveFile(String name, String base64) {
        try {
            byte[] data = android.util.Base64.decode(base64 == null ? "" : base64, android.util.Base64.DEFAULT);
            MainActivity act = activityRef == null ? null : activityRef.get();
            if (act == null) return;
            MainActivity.PendingSave ps = new MainActivity.PendingSave();
            ps.name = (name == null || name.length() == 0) ? "milk.chat-export" : name;
            ps.data = data;
            MainActivity.pendingSave = ps;
            act.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity a = activityRef == null ? null : activityRef.get();
                    if (a != null) a.startSaveActivity();
                }
            });
        } catch (Exception ignored) {}
    }
}
