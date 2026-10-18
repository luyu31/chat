package chat.milk.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/**
 * 后台主动消息到点：发一条消息通知，然后排下一条。
 * 完全不依赖 WebView —— App 被从后台划掉后仍然能照常发消息。
 */
public class AutoMsgReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        Context ctx = context.getApplicationContext();

        JSONObject cfg = AutoMsgScheduler.getConfig(ctx);
        if (cfg == null || !cfg.optBoolean("enabled", false)) return;

        String text = AutoMsgScheduler.pickText(cfg);
        String name = AutoMsgScheduler.partnerName(cfg);

        if (text != null && text.length() > 0) {
            if (MainActivity.isAppForeground()) {
                // App 就在前台：不弹通知（会挡住聊天），直接把消息塞进聊天流
                MainActivity.dispatchAutoMsgToJs(text);
            } else {
                NotificationHelper.notifyMessage(ctx, name, text, "autom");
                // 若 WebView 还活着，顺带在聊天里补一条（开着 App 时能连上上下文）
                MainActivity.dispatchAutoMsgToJs(text);
            }
        }

        // 排下一条
        AutoMsgScheduler.scheduleNext(ctx);
    }
}
