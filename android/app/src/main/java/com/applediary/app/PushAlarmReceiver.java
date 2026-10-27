package com.applediary.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 后台提醒链的闹钟触发点。 */
public class PushAlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        PushCenter.fireChain(context);
    }
}
