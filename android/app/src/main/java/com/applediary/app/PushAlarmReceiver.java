package com.applediary.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;

/** 定时闹钟触发：发一条系统通知，并把内容留给 App 下次打开时补进聊天记录。 */
public class PushAlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        long now = System.currentTimeMillis();
        PushCenter.post(context, title, body, now);
        PushCenter.savePending(context, title, body, now);

        // 自动续上下一轮提醒，App 一直不打开也能持续收到（最多 6 小时）
        long until = intent.getLongExtra("until", 0);
        if (until > now && PushCenter.enabled(context)) {
            long gap = instanceGap(intent);
            int slot = intent.getIntExtra("slot", 0);
            int pos = intent.getIntExtra("pos", 0);
            JSONArray texts = null;
            try {
                String raw = intent.getStringExtra("texts");
                if (raw != null && !raw.isEmpty()) texts = new JSONArray(raw);
            } catch (Exception ignored) {
            }
            String nextBody = body == null ? "" : body;
            int nextPos = pos;
            if (texts != null && texts.length() > 0) {
                nextPos = (pos + 1) % texts.length();
                nextBody = texts.optString(nextPos, nextBody);
            }
            PushCenter.scheduleSlot(context, slot, now + gap, title, nextBody, nextPos,
                    texts, gap, until);
        }
    }

    private static long instanceGap(Intent intent) {
        long gap = intent.getLongExtra("gap", 15 * 60 * 1000L);
        return Math.max(gap, 60 * 1000L);
    }
}
