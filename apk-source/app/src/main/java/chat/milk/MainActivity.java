package chat.milk;

import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 把“字卡传讯”网页包装成 Android 应用的 WebView 容器。
 * - 加载本地 assets/www/index.html
 * - 启用 DOM 存储 / IndexedDB / 无手势媒体播放 / 混合内容
 * - 桥接：blob 下载导出、Web Notification、文件选择(含相机)
 */
public class MainActivity extends AppCompatActivity {

    private static final String CHANNEL_ID = "chuanxun_messages";
    private static final int NOTIF_REQ_CODE = 0x77a1;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    private final ActivityResultLauncher<Intent> fileChooserLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (filePathCallback == null) return;
                Uri[] results = null;
                if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                    Intent data = result.getData();
                    if (data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    } else if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    }
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            });

    private final ActivityResultLauncher<String> notifPermissionLauncher =
            registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
                // 结果由 JS 侧的 Notification.requestPermission 覆盖层模拟为 granted
            });

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 强制浅色：避免系统/容器深色模式触发网页自动黑夜模式
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO);

        createNotificationChannel();
        ensureNotificationPermission();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setDefaultTextEncodingName("UTF-8");
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        // 禁止 WebView 强制变暗（安卓深色模式下的自动反色）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            //noinspection deprecation
            webView.setForceDarkAllowed(false);
        }

        WebView.setWebContentsDebuggingEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                // 所有链接都在 WebView 内打开(便于云同步回调)
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectBridges(view);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                // 允许多选
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    fileChooserLauncher.launch(Intent.createChooser(intent, "选择文件"));
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "没有可用的文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            // http/https 下载交给系统
            if (url.startsWith("http://") || url.startsWith("https://")) {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception ignored) {
                }
            }
            // blob:/data: 已由 JS 桥接处理
        });

        webView.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl("file:///android_asset/www/index.html");
        }
    }

    /** 注入：拦截 <a download> 与 window.Notification，桥接到原生 */
    private void injectBridges(WebView view) {
        view.evaluateJavascript(
        "(function(){\n" +
        "  if (window.__cxBridgeInjected) return;\n" +
        "  window.__cxBridgeInjected = true;\n" +
        "  window.addEventListener('error', function(e){ try { AndroidBridge.showError(String(e.message||'未知错误')+' @ '+String(e.filename||'').split('/').pop()+':'+e.lineno); } catch(_){} });\n" +
        "  window.addEventListener('unhandledrejection', function(e){ try { var r=e.reason; AndroidBridge.showError('Promise: '+String(r&&(r.message||r)).substring(0,120)); } catch(_){} });\n" +
        "  function blobToBase64(blob, cb){\n" +
        "    var r=new FileReader();\n" +
        "    r.onload=function(){var s=r.result;cb(s.substring(s.indexOf(',')+1));};\n" +
        "    r.onerror=function(){cb(null);};\n" +
        "    r.readAsDataURL(blob);\n" +
        "  }\n" +
        "  document.addEventListener('click', function(e){\n" +
        "    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;\n" +
        "    if(!a || !a.href) return;\n" +
        "    var href = a.href;\n" +
        "    if(href.indexOf('blob:')!==0 && href.indexOf('data:')!==0) return;\n" +
        "    e.preventDefault(); e.stopPropagation();\n" +
        "    var name = a.getAttribute('download') || ('chuanxun_'+Date.now()+'.bin');\n" +
        "    fetch(href).then(function(r){return r.blob ? r.blob() : r.arrayBuffer().then(function(b){return new Blob([b]);});}).then(function(b){\n" +
        "      if(!b){return;}\n" +
        "      var mime = b.type || (a.getAttribute('type')||'application/octet-stream');\n" +
        "      blobToBase64(b, function(b64){\n" +
        "        if(b64){ AndroidBridge.downloadBlob(name, mime, b64); }\n" +
        "      });\n" +
        "    }).catch(function(){});\n" +
        "  }, true);\n" +
        "  // Notification 桥接\n" +
        "  function CxNotification(title, options){\n" +
        "    options = options || {};\n" +
        "    try { AndroidBridge.showNotification(String(title||'传讯'), String(options.body||''), String(options.tag||'')); } catch(e){}\n" +
        "    this.title = title; this.body = options.body||''; this.tag = options.tag||'';\n" +
        "  }\n" +
        "  CxNotification.permission = 'granted';\n" +
        "  CxNotification.requestPermission = function(cb){ if(typeof cb==='function') cb('granted'); return Promise.resolve('granted'); };\n" +
        "  Object.defineProperty(window, 'Notification', { value: CxNotification, writable:true, configurable:true });\n" +
        "  // navigator.share 不可用：交给后续 a[download] 处理（已在上方）\n" +
        "})();\n",
        null);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "消息提醒", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("梦角发来消息时的提醒");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, "android.permission.POST_NOTIFICATIONS")
                    != PackageManager.PERMISSION_GRANTED) {
                notifPermissionLauncher.launch("android.permission.POST_NOTIFICATIONS");
            }
        }
    }

    @Override
    protected void onSaveInstanceState(android.os.Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            ((android.view.ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /** 暴露给 JS 的原生桥接 */
    static class AndroidBridge {
        private final Context ctx;
        AndroidBridge(Context ctx) { this.ctx = ctx; }

        @JavascriptInterface
        public void downloadBlob(String fileName, String mime, String base64) {
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                saveToDownloads(fileName, mime, data);
            } catch (Exception e) {
                show("导出失败：" + e.getMessage());
            }
        }

        @JavascriptInterface
        public void showError(String msg) {
            show("脚本错误: " + msg);
        }

        @JavascriptInterface
        public void showNotification(String title, String body, String tag) {
            try {
                NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                        .setSmallIcon(android.R.drawable.ic_dialog_info)
                        .setContentTitle(title == null ? "传讯" : title)
                        .setContentText(body == null ? "" : body)
                        .setAutoCancel(true)
                        .setPriority(NotificationCompat.PRIORITY_DEFAULT);
                NotificationManagerCompat mgr = NotificationManagerCompat.from(ctx);
                int id = (tag == null ? String.valueOf(System.currentTimeMillis()) : tag).hashCode();
                mgr.notify(id, b.build());
            } catch (Exception ignored) {
            }
        }

        private void saveToDownloads(String fileName, String mime, byte[] data) throws Exception {
            String displayName = (fileName == null || fileName.isEmpty()) ? "chuanxun_export.bin" : fileName;
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Downloads.DISPLAY_NAME, displayName);
            cv.put(MediaStore.Downloads.MIME_TYPE, mime == null ? "application/octet-stream" : mime);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                ContentResolver cr = ctx.getContentResolver();
                Uri uri = cr.insert(MediaStore.Downloads.getContentUri("external"), cv);
                if (uri == null) throw new Exception("无法创建下载文件");
                try (OutputStream os = cr.openOutputStream(uri)) {
                    if (os == null) throw new Exception("无法写入文件");
                    os.write(data);
                }
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File out = new File(dir, displayName);
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(data);
                }
            }
            show("已导出到下载文件夹：" + displayName);
        }

        private void show(final String msg) {
            new android.os.Handler(android.os.Looper.getMainLooper()).post(() ->
                    Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show());
        }
    }
}
