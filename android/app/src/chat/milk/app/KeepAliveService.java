package chat.milk.app;

import android.app.Notification;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/** 前台保活服务：常驻通知（通知栏 + 锁屏可见），进程被杀后自动拉起。 */
public class KeepAliveService extends Service {

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationHelper.init(this);
        startKeepForeground();
        // 重启/被杀后恢复定时问候闹钟（AlarmManager 闹钟在重启后会丢失）
        AlarmScheduler.scheduleAll(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startKeepForeground();
        return START_STICKY;
    }

    private void startKeepForeground() {
        Notification n = NotificationHelper.buildKeepAliveNotification(this);
        try {
            startForeground(NotificationHelper.KEEP_ALIVE_NOTIF_ID, n);
        } catch (Exception ignored) {}
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // 用户从最近任务划掉后，通过闹钟广播重新拉起服务
        NotificationHelper.scheduleRestart(this);
        super.onTaskRemoved(rootIntent);
    }
}
