package chat.milk.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.app.DownloadManager;
import android.content.Context;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.util.ArrayList;

public class MainActivity extends Activity {

    private static final int FILE_CHOOSER_CODE = 1001;
    private static final int MEDIA_PERM_CODE = 1002;
    public static final int NOTIF_PERM_CODE = 1003;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingMediaRequest;
    private boolean notifPermRequested = false;

    public static final int SAVE_FILE_CODE = 2001;
    public static final int RINGTONE_SYS_CODE = 3001;
    public static final int RINGTONE_FILE_CODE = 3002;

    /** 消息通知携带的跳转目标（NotificationHelper 塞的 extra）：进 app 后直达那条消息 */
    public static final String EXTRA_JUMP_MSG_ID = "jump_msg_id";

    /** 全屏来电界面带回来的动作（answer/decline），等页面加载完执行 */
    private String pendingCallAction;
    /** 点通知进 app（含冷启动）时要跳转到的消息 id，等页面加载完执行 */
    private String pendingJumpMsgId;
    private boolean pageLoaded;

    /** 供 AlarmReceiver 等外部组件回调 JS 用 */
    private static java.lang.ref.WeakReference<MainActivity> instanceRef;

    /** 闹钟到点：把 id 交给 JS（聊天流发消息 + TTS） */
    public static void dispatchAlarmToJs(final String id) {
        final MainActivity a = instanceRef == null ? null : instanceRef.get();
        if (a == null) return;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                a.evaluateJsSafe("window._onNativeAlarmFired && window._onNativeAlarmFired('" + id + "')");
            }
        });
    }

    /** 闹钟被用户「停止 / 贪睡」：把动作告诉 JS（记一笔 + 联动界面状态） */
    public static void dispatchAlarmAction(final String action, final String id) {
        final MainActivity a = instanceRef == null ? null : instanceRef.get();
        if (a == null) return;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                a.evaluateJsSafe("window._onNativeAlarmAction && window._onNativeAlarmAction('"
                        + action + "','" + id + "')");
            }
        });
    }

    public static class PendingSave {
        public String name;
        public byte[] data;
    }

    public static volatile PendingSave pendingSave;

    public void startSaveActivity() {
        PendingSave ps = pendingSave;
        if (ps == null) return;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(guessMime(ps.name));
        i.putExtra(Intent.EXTRA_TITLE, ps.name);
        try {
            startActivityForResult(i, SAVE_FILE_CODE);
        } catch (Exception e) {
            pendingSave = null;
            Toast.makeText(this, "无法打开保存窗口", Toast.LENGTH_SHORT).show();
        }
    }

    private static String guessMime(String name) {
        if (name == null) return "*/*";
        String n = name.toLowerCase();
        if (n.endsWith(".zip")) return "application/zip";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".txt")) return "text/plain";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".mp3")) return "audio/mpeg";
        return "*/*";
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instanceRef = new java.lang.ref.WeakReference<>(this);

        // ── 全屏沉浸式：让 WebView 铺满整个屏幕（包含状态栏和导航栏区域） ──
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            @SuppressWarnings("deprecation")
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                      | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                      | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }

        NotificationHelper.init(this);
        MilkChat.activityRef = new java.lang.ref.WeakReference<>(this);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFFF6F1EA);

        WebSettings st = webView.getSettings();
        st.setJavaScriptEnabled(true);
        st.setDomStorageEnabled(true);
        st.setDatabaseEnabled(true);
        st.setAllowFileAccess(true);
        st.setAllowContentAccess(true);
        st.setMediaPlaybackRequiresUserGesture(false);
        st.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        st.setCacheMode(WebSettings.LOAD_DEFAULT);
        st.setUseWideViewPort(true);
        st.setLoadWithOverviewMode(true);
        st.setTextZoom(100);

        webView.addJavascriptInterface(new MilkChat(this), "MilkChat");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return false;
                if (url.startsWith("file://") || url.startsWith("data:") || url.startsWith("blob:")
                        || url.startsWith("javascript:")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
                if (pendingCallAction != null) {
                    final String act = pendingCallAction;
                    pendingCallAction = null;
                    handleCallAction(act);
                }
                if (pendingJumpMsgId != null) {
                    final String jid = pendingJumpMsgId;
                    pendingJumpMsgId = null;
                    evaluateJsSafe("window._onNativeJumpMsg && window._onNativeJumpMsg('" + jid + "')");
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                try {
                    Intent intent = params.createIntent();
                    // 开启多选：HTML input 的 multiple 才能真正生效（表情包批量添加）
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(intent, FILE_CHOOSER_CODE);
                } catch (Exception e) {
                    filePathCallback = null;
                    cb.onReceiveValue(null);
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        ArrayList<String> need = new ArrayList<>();
                        String[] res = request.getResources();
                        for (String r : res) {
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)
                                    && !hasPerm(android.Manifest.permission.RECORD_AUDIO)) {
                                need.add(android.Manifest.permission.RECORD_AUDIO);
                            }
                            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)
                                    && !hasPerm(android.Manifest.permission.CAMERA)) {
                                need.add(android.Manifest.permission.CAMERA);
                            }
                        }
                        if (need.isEmpty()) {
                            request.grant(request.getResources());
                            return;
                        }
                        pendingMediaRequest = request;
                        requestPermissions(need.toArray(new String[0]), MEDIA_PERM_CODE);
                    }
                });
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                try {
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    String name = Uri.parse(url).getLastPathSegment();
                    if (name == null || name.length() == 0) name = "milk.chat-download";
                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) dm.enqueue(req);
                } catch (Exception ignored) {}
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl("file:///android_asset/www/index.html");
        }

        // ── 把系统栏 insets 传给 JS：让 JS 端能用 safe-area padding 避开状态栏/导航栏 ──
        getWindow().getDecorView().setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int top = 0, bottom = 0, left = 0, right = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    android.graphics.Insets statusBars = insets.getInsets(WindowInsets.Type.statusBars());
                    android.graphics.Insets navBars   = insets.getInsets(WindowInsets.Type.navigationBars());
                    top    = statusBars.top;
                    left   = Math.max(statusBars.left, navBars.left);
                    right  = Math.max(statusBars.right, navBars.right);
                    bottom = navBars.bottom;
                } else {
                    @SuppressWarnings("deprecation")
                    android.graphics.Rect r = new android.graphics.Rect();
                    getWindow().getDecorView().getWindowVisibleDisplayFrame(r);
                    int w = v.getWidth(), h = v.getHeight();
                    top    = r.top;
                    left   = r.left;
                    right  = Math.max(0, w - r.right);
                    bottom = Math.max(0, h - r.bottom);
                }
                final int t = top, l = left, r = right, b = bottom;
                webView.post(new Runnable() {
                    @Override
                    public void run() {
                        if (webView == null) return;
                        String js = "(function(){" +
                            "var d=document.documentElement;" +
                            "d.style.setProperty('--sat','" + t + "px');" +
                            "d.style.setProperty('--sal','" + l + "px');" +
                            "d.style.setProperty('--sar','" + r + "px');" +
                            "d.style.setProperty('--sab','" + b + "px');" +
                            "try{window._nativeSafeInsets={top:" + t + ",left:" + l + ",right:" + r + ",bottom:" + b + "};}catch(e){}" +
                            "try{var fn=window._onNativeSafeInsets;if(typeof fn==='function')fn(window._nativeSafeInsets);}catch(e){}" +
                        "})()";
                        evaluateJsSafe(js);
                    }
                });
                return insets;
            }
        });

        setContentView(webView);

        NotificationHelper.startKeepAlive(this);
        NotificationHelper.onAppOpen(this);
        requestNotificationPermissionIfNeeded();
        handleCallAction(getIntent() != null ? getIntent().getStringExtra("call_action") : null);
        handleJumpMsg(getIntent() != null ? getIntent().getStringExtra(EXTRA_JUMP_MSG_ID) : null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        NotificationHelper.onAppOpen(this);
        handleCallAction(intent != null ? intent.getStringExtra("call_action") : null);
        handleJumpMsg(intent != null ? intent.getStringExtra(EXTRA_JUMP_MSG_ID) : null);
    }

    /** App 是否在前台（后台主动消息靠它决定要不要弹通知） */
    private static volatile boolean appForeground = false;

    public static boolean isAppForeground() { return appForeground; }

    /** 后台主动消息：把文案交给 JS，在聊天流里补一条 */
    public static void dispatchAutoMsgToJs(final String text) {
        final MainActivity a = instanceRef == null ? null : instanceRef.get();
        if (a == null || text == null) return;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                // 用 JSONObject.quote 做转义，避免文案里有引号/换行把 JS 打断
                String arg = org.json.JSONObject.quote(text);
                a.evaluateJsSafe("window._onNativeAutoMsg && window._onNativeAutoMsg(" + arg + ")");
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        appForeground = true;
        MilkChat.activityRef = new java.lang.ref.WeakReference<>(this);
        NotificationHelper.startKeepAlive(this);
        NotificationHelper.onAppOpen(this);
        // 回前台时把后台主动消息重新排一遍（间隔重新随机）
        AutoMsgScheduler.scheduleNext(this);
        requestNotificationPermissionIfNeeded();
    }

    @Override
    protected void onPause() {
        appForeground = false;
        super.onPause();
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33 || notifPermRequested) return;
        notifPermRequested = true;
        if (!hasPerm(android.Manifest.permission.POST_NOTIFICATIONS)) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},
                    NOTIF_PERM_CODE);
        }
    }

    private boolean hasPerm(String p) {
        if (Build.VERSION.SDK_INT < 23) return true;
        return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == MEDIA_PERM_CODE && pendingMediaRequest != null) {
            boolean all = true;
            for (int r : results) if (r != PackageManager.PERMISSION_GRANTED) all = false;
            if (all) pendingMediaRequest.grant(pendingMediaRequest.getResources());
            else pendingMediaRequest.deny();
            pendingMediaRequest = null;
        }
    }

    /** 打开系统铃声选择器；设备不支持时回退为文件选择器 */
    public void launchRingtonePicker() {
        try {
            Intent i = new Intent(android.media.RingtoneManager.ACTION_RINGTONE_PICKER);
            i.putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_TYPE,
                    android.media.RingtoneManager.TYPE_RINGTONE);
            i.putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_TITLE, "选择来电铃声");
            i.putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, false);
            i.putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false);
            startActivityForResult(i, RINGTONE_SYS_CODE);
        } catch (Exception e) {
            launchRingtoneFilePicker();
        }
    }

    /** 从文件里选（下载的音乐等） */
    public void launchRingtoneFilePicker() {
        try {
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("audio/*");
            startActivityForResult(Intent.createChooser(i, "选择来电铃声"), RINGTONE_FILE_CODE);
        } catch (Exception e) {
            Toast.makeText(this, "无法打开铃声选择", Toast.LENGTH_SHORT).show();
        }
    }

    private void saveRingtoneFromUri(Uri uri, String sysName) {
        if (uri == null) { notifyJsRingtoneChanged(false); return; }
        String name = sysName;
        // 尝试把铃声内容拷贝到私有目录（系统铃声多为 content://，可直接复制）
        boolean copied = false;
        try {
            java.io.InputStream in = getContentResolver().openInputStream(uri);
            if (in != null) {
                File out = new File(getFilesDir(), "ringtone");
                java.io.OutputStream os = new java.io.FileOutputStream(out);
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                os.flush(); os.close(); in.close();
                copied = out.length() > 0;
            }
        } catch (Exception ignored) {}
        if (name == null || name.length() == 0) {
            String last = uri.getLastPathSegment();
            name = last == null ? "自选铃声" : last.replaceAll("^.*/", "");
            int q = name.indexOf('?');
            if (q > 0) name = name.substring(0, q);
        }
        // 拷贝失败时保留 URI 由 MediaPlayer 直接播放
        RingtonePlayer.setPrefs(this, name, copied ? null : uri.toString());
        notifyJsRingtoneChanged(true);
    }

    private void notifyJsRingtoneChanged(final boolean ok) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                evaluateJsSafe("window._onNativeRingtone && window._onNativeRingtone(" + (ok ? "true" : "false") + ")");
            }
        });
    }

    private void evaluateJsSafe(String js) {
        try {
            if (webView != null) webView.evaluateJavascript(js, null);
        } catch (Exception ignored) {}
    }

    private void handleCallAction(String action) {
        if (action == null) return;
        RingtonePlayer.stop(this);
        NotificationHelper.cancelCallNotification(this);
        final String js = "window._nativeCallAction && window._nativeCallAction('" + action + "')";
        if (pageLoaded) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { evaluateJsSafe(js); }
            });
        } else {
            pendingCallAction = action;
        }
    }

    /** 点消息通知进 app：跳转到通知对应的那条消息（冷启动时等页面加载完再跳，
     *  JS 侧 _onNativeJumpMsg 还会等消息数据从 localforage 加载完，两头都有兜底） */
    private void handleJumpMsg(String msgId) {
        if (msgId == null || msgId.length() == 0) return;
        final String js = "window._onNativeJumpMsg && window._onNativeJumpMsg('" + msgId + "')";
        if (pageLoaded) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { evaluateJsSafe(js); }
            });
        } else {
            pendingJumpMsgId = msgId;
        }
    }

    /** 解析文件选择器结果：兼容单选（getData）与多选（getClipData） */
    private Uri[] parseChooserResult(int resultCode, Intent data) {
        if (resultCode != RESULT_OK) return null;
        if (data == null) return null;
        try {
            // 单选
            Uri single = data.getData();
            if (single != null) return new Uri[]{single};
            // 多选：URI 在 ClipData 里
            android.content.ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                ArrayList<Uri> uris = new ArrayList<>();
                for (int i = 0; i < clip.getItemCount(); i++) {
                    android.content.ClipData.Item item = clip.getItemAt(i);
                    Uri u = item.getUri();
                    if (u != null) uris.add(u);
                }
                if (!uris.isEmpty()) return uris.toArray(new Uri[0]);
            }
        } catch (Exception ignored) {}
        // 兜底走官方解析
        try {
            return WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_CODE && filePathCallback != null) {
            filePathCallback.onReceiveValue(parseChooserResult(resultCode, data));
            filePathCallback = null;
            return;
        }
        if (requestCode == RINGTONE_SYS_CODE) {
            if (resultCode == RESULT_OK && data != null) {
                Uri uri = data.getParcelableExtra(android.media.RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
                String sysName = null;
                try {
                    if (uri != null) {
                        android.media.Ringtone r = android.media.RingtoneManager.getRingtone(this, uri);
                        if (r != null) sysName = r.getTitle(this);
                    }
                } catch (Exception ignored) {}
                saveRingtoneFromUri(uri, sysName);
            } else {
                notifyJsRingtoneChanged(false);
            }
            return;
        }
        if (requestCode == RINGTONE_FILE_CODE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                saveRingtoneFromUri(data.getData(), null);
            } else {
                notifyJsRingtoneChanged(false);
            }
            return;
        }
        if (requestCode == SAVE_FILE_CODE) {
            final PendingSave ps = pendingSave;
            pendingSave = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || ps == null) return;
            final Uri uri = data.getData();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        java.io.OutputStream os = getContentResolver().openOutputStream(uri);
                        if (os != null) {
                            os.write(ps.data);
                            os.flush();
                            os.close();
                        }
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                Toast.makeText(MainActivity.this, "已保存 ✓", Toast.LENGTH_SHORT).show();
                            }
                        });
                    } catch (Exception e) {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                Toast.makeText(MainActivity.this, "保存失败，请重试", Toast.LENGTH_SHORT).show();
                            }
                        });
                    }
                }
            }).start();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            // 退到后台而不是销毁，配合前台服务实现保活
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onDestroy() {
        if (MilkChat.activityRef != null && MilkChat.activityRef.get() == this) {
            MilkChat.activityRef.clear();
        }
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
