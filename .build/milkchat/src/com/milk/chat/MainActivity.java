package com.milk.chat;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * milk.chat —— 把网页版「字卡传讯」封装成原生 App。
 *
 * 关键点：
 *  1. 网页资源全部打包在 assets/web 里，通过 shouldInterceptRequest 以
 *     https://appassets.androidplatform.net/ 这个「安全来源」提供给 WebView，
 *     这样 localStorage / IndexedDB / 音频播放等行为和浏览器里完全一致，且离线可用。
 *  2. 通过注入脚本接管 window.Notification，让网页里原本的浏览器通知变成
 *     系统级通知（横幅 / 锁屏 / 通知栏 / 桌面角标）。
 *  3. 前台服务 + 唤醒锁做后台保活，配合网页自带的「保活音频」防止计时器被降频。
 */
public class MainActivity extends Activity {

    /** 自定义安全来源，仅在本应用内有效 */
    public static final String APP_HOST = "appassets.androidplatform.net";
    public static final String START_URL = "https://" + APP_HOST + "/index.html";

    private static final int REQ_FILE_CHOOSER = 2001;
    private static final int REQ_NOTIFICATION = 2002;
    private static final int REQ_WEB_PERMISSIONS = 2003;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private int unreadCount = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        NotificationHelper.ensureChannels(this);
        applyStatusBar(true);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#FFF4EEE8"));
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        setupWebView();
        webView.loadUrl(START_URL);

        startKeepAlive();
        requestNotificationPermission();
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                maybeAskBatteryOptimization();
            }
        }, 2500);
    }

    // ------------------------------------------------------------------ WebView

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadsImagesAutomatically(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setTextZoom(100);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // 允许网页在无用户手势时播放音频（保活音频 / 背景音需要）
        s.setMediaPlaybackRequiresUserGesture(false);
        try {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        } catch (Throwable ignored) {}
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                s.setSafeBrowsingEnabled(false);
            } catch (Throwable ignored) {}
        }

        webView.setBackgroundColor(Color.parseColor("#FFF4EEE8"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.addJavascriptInterface(new NativeBridge(), "AndroidNative");

        webView.setWebViewClient(new WebViewClient() {

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveLocalAsset(request == null ? null : request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request == null ? null : request.getUrl();
                if (u == null) return false;
                String scheme = u.getScheme();
                if (scheme == null) return false;
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    // 站内资源由 shouldInterceptRequest 处理；外部链接交给系统浏览器
                    if (APP_HOST.equals(u.getHost())) return false;
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, u));
                    } catch (Throwable ignored) {}
                    return true;
                }
                // 其它 scheme（tel: mailto: 等）交给系统
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Throwable ignored) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                injectShim(view);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // 网页请求麦克风 / 摄像头：补一次系统运行时权限后再同意
                if (request == null) return;
                final String[] resources = request.getResources();
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            java.util.ArrayList<String> need = new java.util.ArrayList<>();
                            for (String r : resources) {
                                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) need.add(Manifest.permission.RECORD_AUDIO);
                                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) need.add(Manifest.permission.CAMERA);
                            }
                            if (!need.isEmpty()) {
                                requestPermissions(need.toArray(new String[0]), REQ_WEB_PERMISSIONS);
                            }
                            request.grant(resources);
                        } catch (Throwable ignored) {}
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                String[] accept = params == null ? null : params.getAcceptTypes();
                String type = "*/*";
                if (accept != null && accept.length > 0 && accept[0] != null
                        && !accept[0].trim().isEmpty() && !"*/*".equals(accept[0])) {
                    type = accept[0];
                }
                intent.setType(type);
                if (params != null && params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(Intent.createChooser(intent, "选择文件"), REQ_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });
    }

    /** 把 assets/web 下的网页资源当成本地服务器来应答 */
    private WebResourceResponse serveLocalAsset(Uri url) {
        if (url == null || !APP_HOST.equals(url.getHost())) return null;

        String path = url.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";

        String assetPath = "web" + path;
        try {
            InputStream is = getAssets().open(assetPath);
            String mime = guessMime(assetPath);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-cache");
            boolean text = mime.startsWith("text/")
                    || mime.contains("javascript")
                    || mime.contains("json")
                    || mime.contains("svg");
            return new WebResourceResponse(mime, text ? "UTF-8" : null, 200, "OK", headers, is);
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    new HashMap<String, String>(), null);
        }
    }

    private static String guessMime(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html";
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "application/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".gif")) return "image/gif";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".bmp")) return "image/bmp";
        if (n.endsWith(".ico")) return "image/x-icon";
        if (n.endsWith(".mp3")) return "audio/mpeg";
        if (n.endsWith(".m4a")) return "audio/mp4";
        if (n.endsWith(".aac")) return "audio/aac";
        if (n.endsWith(".wav")) return "audio/wav";
        if (n.endsWith(".ogg")) return "audio/ogg";
        if (n.endsWith(".mp4")) return "video/mp4";
        if (n.endsWith(".webm")) return "video/webm";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".woff")) return "font/woff";
        if (n.endsWith(".ttf")) return "font/ttf";
        if (n.endsWith(".otf")) return "font/otf";
        if (n.endsWith(".txt")) return "text/plain";
        if (n.endsWith(".xml")) return "text/xml";
        return "application/octet-stream";
    }

    /** 兜底注入：正常情况 index.html 头部已经引入同一份脚本 */
    private void injectShim(final WebView view) {
        try {
            String js = readAsset("web/native-shim.js");
            if (js == null || js.isEmpty()) return;
            view.evaluateJavascript(js, null);
        } catch (Throwable ignored) {}
    }

    private String readAsset(String path) {
        InputStream is = null;
        try {
            is = getAssets().open(path);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), "UTF-8");
        } catch (Throwable t) {
            return null;
        } finally {
            if (is != null) try { is.close(); } catch (IOException ignored) {}
        }
    }

    // ------------------------------------------------------------------ 原生能力（供网页调用）

    private class NativeBridge {

        @JavascriptInterface
        public void notify(String title, String body, String tag) {
            final String t = title, b = body;
            ui.post(new Runnable() {
                @Override
                public void run() {
                    unreadCount++;
                    NotificationHelper.postMessage(MainActivity.this, t, b, unreadCount);
                }
            });
        }

        @JavascriptInterface
        public void setBadge(int count) {
            final int c = Math.max(0, count);
            ui.post(new Runnable() {
                @Override
                public void run() {
                    unreadCount = c;
                    BadgeHelper.setBadge(MainActivity.this, c);
                }
            });
        }

        @JavascriptInterface
        public void clearBadge() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    unreadCount = 0;
                    NotificationHelper.clearAll(MainActivity.this);
                }
            });
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.requestNotificationPermission();
                }
            });
        }

        @JavascriptInterface
        public void setStatusBarTheme(final String theme) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    applyStatusBar(!"dark".equalsIgnoreCase(theme));
                }
            });
        }

        @JavascriptInterface
        public void toast(final String msg) {
            if (msg == null) return;
            ui.post(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void startKeepAlive() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.startKeepAlive();
                }
            });
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String appName() {
            return "milk.chat";
        }
    }

    // ------------------------------------------------------------------ 状态栏 / 保活 / 权限

    /** light = true 表示浅色状态栏（深色图标） */
    private void applyStatusBar(final boolean light) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return;
            Window w = getWindow();
            w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            w.setStatusBarColor(light ? Color.WHITE : Color.parseColor("#FF111111"));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                View decor = w.getDecorView();
                int flags = decor.getSystemUiVisibility();
                if (light) {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                } else {
                    flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                }
                decor.setSystemUiVisibility(flags);
            }
        } catch (Throwable ignored) {}
    }

    private void startKeepAlive() {
        try {
            Intent i = new Intent(this, KeepAliveService.class);
            i.setAction(KeepAliveService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(i);
            } else {
                startService(i);
            }
        } catch (Throwable ignored) {}
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        try {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATION);
            }
        } catch (Throwable ignored) {}
    }

    private void maybeAskBatteryOptimization() {
        try {
            SharedPreferences sp = getSharedPreferences("milk_chat", MODE_PRIVATE);
            if (sp.getBoolean("battery_asked", false)) return;
            sp.edit().putBoolean("battery_asked", true).apply();

            boolean ignoring = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) ignoring = pm.isIgnoringBatteryOptimizations(getPackageName());
            }
            if (ignoring) return;

            new AlertDialog.Builder(this)
                    .setTitle("保持后台运行")
                    .setMessage("为了让 milk.chat 在熄屏、切到后台时也能及时收到消息通知，"
                            + "建议允许它在后台运行、并关闭电池优化。")
                    .setPositiveButton("去设置", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            openBatterySettings();
                        }
                    })
                    .setNegativeButton("以后再说", null)
                    .show();
        } catch (Throwable ignored) {}
    }

    private void openBatterySettings() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                i.setData(Uri.parse("package:" + getPackageName()));
                startActivity(i);
                return;
            }
        } catch (Throwable ignored) {}
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName())));
        } catch (Throwable ignored) {}
    }

    // ------------------------------------------------------------------ 生命周期

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 回到前台：清掉角标和残留通知
        unreadCount = 0;
        ui.post(new Runnable() {
            @Override
            public void run() {
                NotificationHelper.clearAll(MainActivity.this);
            }
        });
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        // 有意不调用 webView.onPause()：保持网页脚本在后台继续运行（保活关键）
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        // 退到桌面但不杀进程，配合前台服务继续在后台收消息
        moveTaskToBack(true);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int n = data.getClipData().getItemCount();
                        results = new Uri[n];
                        for (int i = 0; i < n; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    } else if (data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    }
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        try {
            if (webView != null) {
                webView.removeJavascriptInterface("AndroidNative");
            }
        } catch (Throwable ignored) {}
        super.onDestroy();
    }
}