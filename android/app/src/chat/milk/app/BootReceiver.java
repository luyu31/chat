package chat.milk.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 开机 / 应用被更新 / 任务被划掉后，重新拉起保活前台服务。 */
public class BootReceiver extends BroadcastReceiver {

    public static final String ACTION_RESTART_KEEPALIVE = "chat.milk.app.ACTION_RESTART_KEEPALIVE";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null || intent.getAction() == null ? "" : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || ACTION_RESTART_KEEPALIVE.equals(action)) {
            NotificationHelper.startKeepAlive(context);
        }
    }
}
