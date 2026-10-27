package com.applediary.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 手机重启后恢复后台提醒链。 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            PushCenter.resumeAfterBoot(context);
        }
    }
}
