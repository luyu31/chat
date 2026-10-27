package com.applediary.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "AppleDiary";
    private static final String APP_URL = "https://appassets.androidplatform.net/assets/www/index.html";

    private static final int REQ_FILE_PICK = 1001;
    private static final int REQ_CAMERA_CAPTURE = 1002;
    private static final int REQ_CAMERA_PERM = 1003;
    private static final int REQ_WEB_PERM = 1004;
    private static final int REQ_SAVE_FILE = 1005;
    private static final int REQ_NOTIFICATION = 1006;

    private WebView webView;
    private FrameLayout cover;
    private boolean coverDismissed = false;
    private long createdAt = 0;

    private ValueCallback<Uri[]> pendingFileCallback;
    private String[] pendingAccept;
    private boolean pendingMultiple;
    private Uri cameraOutputUri;
    private PermissionRequest pendingWebPermission;

    private final Map<String, SaveTask> saveTasks = new ConcurrentHashMap<>();
    private final Map<String, ReceiveTask> receiveTasks = new ConcurrentHashMap<>();
    private SaveTask pendingSaveTask;
    private String pendingSaveToken;

    private SyncServer syncServer;
    private String sendToken;
    private File sendFile;
    private BufferedOutputStream sendOut;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createdAt = System.currentTimeMillis();
        setContentView(R.layout.activity_main);

        initBars(true);
        webView = findViewById(R.id.web_view);
        cover = findViewById(R.id.cover);
        android.widget.ImageView coverLogo = findViewById(R.id.cover_logo);
        if (coverLogo != null && coverLogo.getDrawable() instanceof BitmapDrawable) {
            ((BitmapDrawable) coverLogo.getDrawable()).setFilterBitmap(false);
        }
        mainHandler.postDelayed(this::dismissCover, 8000);
        setupWebView();
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

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_OFF);
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false);
        }

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && "appassets.androidplatform.net".equals(uri.getHost())) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    toast("无法打开这个链接");
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                long elapsed = System.currentTimeMillis() - createdAt;
                long delay = Math.max(300, 1100 - elapsed);
                mainHandler.postDelayed(MainActivity.this::dismissCover, delay);
                maybeAskNotification();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams params) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = filePathCallback;
                pendingAccept = params != null ? params.getAcceptTypes() : new String[0];
                pendingMultiple = params != null && params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
                if (isImageOnly(pendingAccept)) {
                    showImageSourceDialog();
                } else {
                    openDocumentPicker();
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, final android.webkit.JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("好", (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final android.webkit.JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("确定", (d, w) -> result.confirm())
                        .setNegativeButton("取消", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue,
                                      final android.webkit.JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setView(input)
                        .setPositiveButton("确定", (d, w) -> result.confirm(input.getText().toString()))
                        .setNegativeButton("取消", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress >= 90) {
                    dismissCover();
                }
            }

            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage msg) {
                Log.d(TAG, msg.message() + " @" + msg.lineNumber());
                return true;
            }
        });

        webView.addJavascriptInterface(new Bridge(), "AppleDiary");
        webView.loadUrl(APP_URL);
    }

    // ---------------- 权限 ----------------

    private boolean hasPermission(String permission) {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void maybeAskNotification() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (hasPermission(Manifest.permission.POST_NOTIFICATIONS)) return;
        SharedPreferences sp = getSharedPreferences("apple_diary", MODE_PRIVATE);
        if (sp.getBoolean("notification_asked", false)) return;
        sp.edit().putBoolean("notification_asked", true).apply();
        ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATION);
    }

    private void handleWebPermission(PermissionRequest request) {
        List<String> needed = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    || PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                String permission = PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                        ? Manifest.permission.RECORD_AUDIO : Manifest.permission.CAMERA;
                if (!hasPermission(permission)) needed.add(permission);
            }
        }
        if (needed.isEmpty()) {
            request.grant(request.getResources());
            return;
        }
        pendingWebPermission = request;
        ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), REQ_WEB_PERM);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CAMERA_PERM) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                launchCamera();
            } else {
                toast("没有相机权限，可改为从相册选择");
                finishFileChooser(null);
            }
        } else if (requestCode == REQ_WEB_PERM) {
            PermissionRequest request = pendingWebPermission;
            pendingWebPermission = null;
            if (request == null) return;
            boolean allGranted = true;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }
            if (allGranted) request.grant(request.getResources());
            else request.deny();
        }
    }

    // ---------------- 选图 / 拍照 ----------------

    private boolean isImageOnly(String[] accept) {
        boolean hasImage = false;
        for (String type : accept) {
            if (type == null) continue;
            String t = type.trim().toLowerCase();
            if (t.isEmpty()) continue;
            if (t.contains("video") || t.contains("audio")) return false;
            if (t.contains("image")) hasImage = true;
            else if (t.startsWith(".") || t.contains("/")) return false;
        }
        return hasImage;
    }

    private void showImageSourceDialog() {
        new AlertDialog.Builder(this)
                .setTitle("选择图片")
                .setItems(new String[]{"拍照", "从相册选择"}, (d, which) -> {
                    if (which == 0) {
                        if (hasPermission(Manifest.permission.CAMERA)) {
                            launchCamera();
                        } else {
                            ActivityCompat.requestPermissions(this,
                                    new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PERM);
                        }
                    } else {
                        openDocumentPicker();
                    }
                })
                .setNegativeButton("取消", (d, w) -> finishFileChooser(null))
                .setOnCancelListener(d -> finishFileChooser(null))
                .show();
    }

    private void launchCamera() {
        File dir = new File(getCacheDir(), "images");
        if (!dir.exists() && !dir.mkdirs()) {
            toast("无法创建临时文件");
            finishFileChooser(null);
            return;
        }
        File photo = new File(dir, "IMG_" + System.currentTimeMillis() + ".jpg");
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", photo);

        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (intent.resolveActivity(getPackageManager()) == null) {
            toast("这台手机没有可用的相机");
            finishFileChooser(null);
            return;
        }
        cameraOutputUri = uri;
        try {
            startActivityForResult(intent, REQ_CAMERA_CAPTURE);
        } catch (Exception e) {
            toast("相机启动失败");
            finishFileChooser(null);
        }
    }

    private void openDocumentPicker() {
        List<String> mimes = new ArrayList<>();
        boolean wildcard = false;
        if (pendingAccept != null) {
            for (String type : pendingAccept) {
                if (type == null) continue;
                String t = type.trim().toLowerCase();
                if (t.isEmpty()) continue;
                if (t.startsWith(".")) {
                    wildcard = true;
                } else if (t.contains("/")) {
                    mimes.add(t);
                } else {
                    wildcard = true;
                }
            }
        }

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (!wildcard && mimes.size() == 1) {
            intent.setType(mimes.get(0));
        } else {
            intent.setType("*/*");
            if (!mimes.isEmpty()) {
                intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
            }
        }
        if (pendingMultiple) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        try {
            startActivityForResult(intent, REQ_FILE_PICK);
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Intent.ACTION_GET_CONTENT);
                fallback.addCategory(Intent.CATEGORY_OPENABLE);
                fallback.setType("*/*");
                fallback.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, pendingMultiple);
                startActivityForResult(fallback, REQ_FILE_PICK);
            } catch (Exception e2) {
                toast("没有可用的文件选择器");
                finishFileChooser(null);
            }
        }
    }

    private void finishFileChooser(Uri[] uris) {
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(uris);
        }
        pendingFileCallback = null;
        pendingAccept = null;
        pendingMultiple = false;
        cameraOutputUri = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_PICK) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                List<Uri> uris = new ArrayList<>();
                ClipData clip = data.getClipData();
                if (clip != null) {
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        Uri uri = clip.getItemAt(i).getUri();
                        if (uri != null) uris.add(uri);
                    }
                } else if (data.getData() != null) {
                    uris.add(data.getData());
                }
                finishFileChooser(uris.isEmpty() ? null : uris.toArray(new Uri[0]));
            } else {
                finishFileChooser(null);
            }
        } else if (requestCode == REQ_CAMERA_CAPTURE) {
            if (resultCode == Activity.RESULT_OK && cameraOutputUri != null) {
                finishFileChooser(new Uri[]{cameraOutputUri});
            } else {
                finishFileChooser(null);
            }
        } else if (requestCode == REQ_SAVE_FILE) {
            SaveTask task = pendingSaveTask;
            pendingSaveTask = null;
            pendingSaveToken = null;
            if (task == null) return;
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
                try {
                    java.io.InputStream in = new java.io.FileInputStream(task.file);
                    java.io.OutputStream out = getContentResolver().openOutputStream(data.getData());
                    if (out == null) throw new IOException("无法写入");
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    in.close();
                    out.flush();
                    out.close();
                    toast("已保存：" + task.fileName);
                } catch (Exception e) {
                    toast("保存失败：" + e.getMessage());
                }
            } else {
                toast("已取消保存");
            }
            task.file.delete();
            saveTasks.remove(task.token);
        }
    }

    // ---------------- 封面 ----------------

    private void dismissCover() {
        if (coverDismissed || cover == null) return;
        coverDismissed = true;
        if (cover.getVisibility() != View.VISIBLE) return;
        cover.animate().alpha(0f).setDuration(450).withEndAction(() -> {
            cover.setVisibility(View.GONE);
            initBars(false);
        }).start();
    }

    private void initBars(boolean showCover) {
        Window window = getWindow();
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        int barColor;
        boolean lightIcons;
        if (showCover) {
            barColor = Color.parseColor("#BEE9FF");
            lightIcons = true;
        } else if (night) {
            barColor = Color.parseColor("#1B1714");
            lightIcons = false;
        } else {
            barColor = Color.parseColor("#FFF6E8");
            lightIcons = true;
        }
        window.setStatusBarColor(barColor);
        window.setNavigationBarColor(barColor);
        int flags = window.getDecorView().getSystemUiVisibility();
        if (lightIcons) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
        } else {
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
        }
        window.getDecorView().setSystemUiVisibility(flags);
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (coverDismissed) initBars(false);
    }

    // ---------------- 返回键 ----------------

    @SuppressLint("GestureBackNavigation")
    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return !!(window.__appleHandleBack && window.__appleHandleBack());}catch(e){return false;}})()",
                value -> {
                    if ("true".equals(value)) return;
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        MainActivity.super.onBackPressed();
                    }
                });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopSyncServer();
        for (ReceiveTask task : receiveTasks.values()) {
            task.interrupt();
            if (task.file != null) task.file.delete();
        }
        receiveTasks.clear();
        if (webView != null) {
            webView.removeJavascriptInterface("AppleDiary");
            webView.destroy();
            webView = null;
        }
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
    }

    // ---------------- 同步 ----------------

    private void stopSyncServer() {
        SyncServer server = syncServer;
        syncServer = null;
        if (server != null) server.stop();
        try {
            if (sendOut != null) sendOut.close();
        } catch (IOException ignored) {}
        sendOut = null;
        if (sendFile != null) {
            sendFile.delete();
            sendFile = null;
        }
        sendToken = null;
    }

    private void evalJsCallback(String fn, String json) {
        if (webView == null) return;
        final String js = "window." + fn + " && window." + fn + "(" + JSONObject.quote(json) + ");";
        webView.post(() -> {
            if (webView != null) webView.evaluateJavascript(js, null);
        });
    }

    private class SaveTask {
        String token;
        String fileName;
        String mime;
        File file;
        BufferedOutputStream out;
    }

    private class ReceiveTask {
        String token;
        File file;
        volatile String state = "downloading";
        volatile String error = null;
        volatile long received = 0;
        volatile long total = 0;
        Thread thread;

        void interrupt() {
            if (thread != null) thread.interrupt();
        }
    }

    // ---------------- JS 桥 ----------------

    private class Bridge {

        @JavascriptInterface
        public boolean isNative() {
            return true;
        }

        @JavascriptInterface
        public String getVersion() {
            return "1.0.0";
        }

        @JavascriptInterface
        public String getDeviceName() {
            return Build.MODEL == null ? "Android" : Build.MODEL;
        }

        @JavascriptInterface
        public void pageReady() {
            mainHandler.postDelayed(MainActivity.this::dismissCover, 100);
        }

        @JavascriptInterface
        public void toastMsg(String msg) {
            toast(msg);
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null) v.vibrate(Math.max(10, Math.min(ms, 200)));
        }

        @JavascriptInterface
        public void openAppSettings() {
            Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            try {
                startActivity(intent);
            } catch (Exception e) {
                toast("无法打开系统设置");
            }
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(MainActivity.this::maybeAskNotification);
        }

        @JavascriptInterface
        public String saveBegin(String fileName, String mime) {
            try {
                File dir = new File(getCacheDir(), "exports");
                if (!dir.exists()) dir.mkdirs();
                String safe = fileName == null ? "apple-diary" : fileName.replace("/", "_").replace("\\", "_");
                File file = new File(dir, safe);
                SaveTask task = new SaveTask();
                task.token = UUID.randomUUID().toString();
                task.fileName = safe;
                task.mime = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
                task.file = file;
                task.out = new BufferedOutputStream(new FileOutputStream(file));
                saveTasks.put(task.token, task);
                return task.token;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean saveChunk(String token, String base64) {
            SaveTask task = saveTasks.get(token);
            if (task == null || task.out == null) return false;
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                task.out.write(bytes);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void saveFinish(String token) {
            SaveTask task = saveTasks.get(token);
            if (task == null) return;
            try {
                task.out.flush();
                task.out.close();
            } catch (IOException ignored) {}
            task.out = null;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(task.mime);
                intent.putExtra(Intent.EXTRA_TITLE, task.fileName);
                try {
                    pendingSaveTask = task;
                    pendingSaveToken = token;
                    startActivityForResult(intent, REQ_SAVE_FILE);
                } catch (Exception e) {
                    toast("无法打开保存位置");
                    task.file.delete();
                    saveTasks.remove(token);
                }
            });
        }

        @JavascriptInterface
        public void saveCancel(String token) {
            SaveTask task = saveTasks.remove(token);
            if (task != null) {
                try { if (task.out != null) task.out.close(); } catch (IOException ignored) {}
                task.file.delete();
            }
        }

        @JavascriptInterface
        public synchronized String syncBeginSend(String code) {
            stopSyncServer();
            try {
                File dir = new File(getCacheDir(), "sync");
                if (!dir.exists()) dir.mkdirs();
                sendFile = new File(dir, "apple-diary-sync-" + System.currentTimeMillis() + ".zip");
                sendOut = new BufferedOutputStream(new FileOutputStream(sendFile));
                sendToken = UUID.randomUUID().toString();
                return sendToken;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public synchronized boolean syncPushChunk(String token, String base64) {
            if (sendToken == null || !sendToken.equals(token) || sendOut == null) return false;
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                sendOut.write(bytes);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public synchronized String syncFinishSend(String token, String code) {
            if (sendToken == null || !sendToken.equals(token) || sendOut == null || sendFile == null) {
                return "{\"ok\":false,\"error\":\"没有待发送的数据\"}";
            }
            try {
                sendOut.flush();
                sendOut.close();
            } catch (IOException ignored) {}
            sendOut = null;
            if (sendFile.length() <= 0) {
                sendFile.delete();
                sendFile = null;
                sendToken = null;
                return "{\"ok\":false,\"error\":\"备份包为空\"}";
            }
            try {
                syncServer = new SyncServer(sendFile, code, Build.MODEL);
                syncServer.start();
                JSONObject obj = new JSONObject();
                obj.put("ok", true);
                obj.put("code", code);
                obj.put("ip", SyncServer.findLocalIpv4());
                obj.put("port", syncServer.getPort());
                obj.put("bytes", sendFile.length());
                return obj.toString();
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"无法开启局域网服务\"}";
            }
        }

        @JavascriptInterface
        public synchronized void syncStopSend() {
            stopSyncServer();
        }

        @JavascriptInterface
        public boolean syncIsSending() {
            SyncServer server = syncServer;
            return server != null && server.isRunning();
        }

        @JavascriptInterface
        public void syncDiscover() {
            new Thread(() -> {
                List<SyncClient.Peer> peers = SyncClient.discover(1600);
                JSONArray arr = new JSONArray();
                for (SyncClient.Peer p : peers) {
                    try {
                        JSONObject item = new JSONObject();
                        item.put("name", p.name);
                        item.put("host", p.host);
                        item.put("port", p.port);
                        arr.put(item);
                    } catch (Exception ignored) {}
                }
                evalJsCallback("__appleSyncPeers", arr.toString());
            }, "apple-sync-discover").start();
        }

        @JavascriptInterface
        public String syncBeginReceive(String host, int port, String code) {
            try {
                File dir = new File(getCacheDir(), "sync");
                if (!dir.exists()) dir.mkdirs();
                ReceiveTask task = new ReceiveTask();
                task.token = UUID.randomUUID().toString();
                task.file = new File(dir, "incoming-" + System.currentTimeMillis() + ".zip");
                task.total = 0;
                receiveTasks.put(task.token, task);
                task.thread = new Thread(() -> {
                    try {
                        SyncClient.download(host, port, code, task.file, (received, total) -> {
                            task.received = received;
                            task.total = total;
                        });
                        task.state = "done";
                    } catch (Exception e) {
                        task.error = e.getMessage() == null ? "同步失败" : e.getMessage();
                        task.state = "error";
                    }
                }, "apple-sync-receive");
                task.thread.start();
                return task.token;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String syncReceiveState(String token) {
            ReceiveTask task = receiveTasks.get(token);
            if (task == null) return "{\"state\":\"error\",\"error\":\"任务不存在\"}";
            JSONObject obj = new JSONObject();
            try {
                obj.put("state", task.state);
                obj.put("received", task.received);
                obj.put("total", task.total);
                if (task.error != null) obj.put("error", task.error);
            } catch (Exception ignored) {}
            return obj.toString();
        }

        @JavascriptInterface
        public String syncReadChunk(String token, long offset, int length) {
            ReceiveTask task = receiveTasks.get(token);
            if (task == null || task.file == null) return "";
            int size = Math.min(Math.max(length, 1), 512 * 1024);
            try {
                RandomAccessFile raf = new RandomAccessFile(task.file, "r");
                try {
                    raf.seek(offset);
                    byte[] buf = new byte[size];
                    int n = raf.read(buf);
                    if (n <= 0) return "";
                    return Base64.encodeToString(buf, 0, n, Base64.NO_WRAP);
                } finally {
                    raf.close();
                }
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public long syncReceiveSize(String token) {
            ReceiveTask task = receiveTasks.get(token);
            return task != null && task.file != null ? task.file.length() : 0;
        }

        @JavascriptInterface
        public void syncCloseReceive(String token) {
            ReceiveTask task = receiveTasks.remove(token);
            if (task != null) {
                task.interrupt();
                if (task.file != null) task.file.delete();
            }
        }

        @JavascriptInterface
        public String syncLanInfo() {
            try {
                JSONObject obj = new JSONObject();
                obj.put("ip", SyncServer.findLocalIpv4());
                obj.put("device", Build.MODEL);
                return obj.toString();
            } catch (Exception e) {
                return "{}";
            }
        }
    }
}
