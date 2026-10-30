# 苹果日记 - 发布版混淆/压缩规则
#
# 本应用主体是 WebView + JS Bridge，绝大多数逻辑在 assets/www 里，
# 因此这里的规则目标只有一个：R8 不能动到 JS 回调的那部分原生入口。

# ── 1. JS Bridge：WebView 通过反射调用 @JavascriptInterface 方法 ────────
#    AGP 自带的 consumer rules 已经会保留 @JavascriptInterface，
#    但 Bridge 是 MainActivity 的内部类，显式 keep 更稳妥。
-keep class com.applediary.app.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class com.applediary.app.MainActivity$Bridge {
    public *;
}

# ── 2. Manifest 注册的组件（R8 默认保留，但显式声明以防万一） ──────────────
-keep class com.applediary.app.PushAlarmReceiver { *; }
-keep class com.applediary.app.BootReceiver { *; }
-keep class com.applediary.app.CallForegroundService { *; }
-keep class com.applediary.app.KeepAliveForegroundService { *; }
-keep class com.applediary.app.MainActivity { *; }

# ── 3. 通用：枚举、注解、序列化 ───────────────────────────────────────────
-keepattributes *Annotation*, InnerClasses, EnclosingMethod, Signature
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ── 4. 第三方库 ──────────────────────────────────────────────────────────
# WebViewAssetLoader 由 androidx.webkit 提供，其 consumer rules 已自处理。
# 如引入 Gson/OkHttp 等再在此补充对应 keep 规则。
