#!/usr/bin/env bash
# milk.chat 手工构建脚本：aapt2 -> javac -> d8 -> zipalign -> apksigner
set -euo pipefail

SDK=/opt/android-sdk
BT=$SDK/build-tools/34.0.0
ANDROID_JAR=$SDK/platforms/android-34/android.jar
PROJ=/workspace/.build/milkchat
OUT=/workspace/.build/out
KS=/workspace/.build/milkchat.keystore

# 用 JDK 17 编译/打包：build-tools 34 的 R8 不兼容 JDK 25
export JAVA_HOME=/opt/jdk17
export PATH="$JAVA_HOME/bin:$PATH"

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/res"

echo "==> [1/7] aapt2 compile 资源"
"$BT/aapt2" compile --dir "$PROJ/res" -o "$OUT/res/res.zip"

echo "==> [2/7] aapt2 link 生成 base.apk（含 assets）"
"$BT/aapt2" link \
  -o "$OUT/base-unsigned.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$PROJ/AndroidManifest.xml" \
  -A "$PROJ/assets" \
  --java "$OUT/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 33 \
  --auto-add-overlay \
  "$OUT/res/res.zip"

echo "==> [3/7] javac 编译 Java 源码"
find "$PROJ/src" "$OUT/gen" -name "*.java" > "$OUT/sources.txt"
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -nowarn \
  -bootclasspath "$ANDROID_JAR" \
  -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" \
  @"$OUT/sources.txt"
test -f "$OUT/classes/com/milk/chat/MainActivity.class"

echo "==> [4/7] d8 dex 转换"
find "$OUT/classes" -name "*.class" > "$OUT/classes.txt"
"$BT/d8" --min-api 24 --lib "$ANDROID_JAR" --output "$OUT/dex" @"$OUT/classes.txt"

echo "==> [5/7] 把 classes.dex 打进 APK"
cd "$OUT"
python3 - <<'PY'
import zipfile, shutil, os
src = "/workspace/.build/out/base-unsigned.apk"
dst = "/workspace/.build/out/with-dex.apk"
with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        zout.writestr(item, zin.read(item.filename))
    zout.write("/workspace/.build/out/dex/classes.dex", "classes.dex")
print("classes.dex 已写入")
PY

echo "==> [6/7] zipalign 对齐"
"$BT/zipalign" -f -p 4 "$OUT/with-dex.apk" "$OUT/aligned.apk"

echo "==> [7/7] 签名"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -v -keystore "$KS" -alias milkchat \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass milkchat -keypass milkchat \
    -dname "CN=milk.chat, OU=milk.chat, O=milk.chat, C=CN" >/dev/null 2>&1
  echo "    已生成签名证书"
fi
"$BT/apksigner" sign \
  --ks "$KS" --ks-key-alias milkchat \
  --ks-pass pass:milkchat --key-pass pass:milkchat \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$OUT/milk.apk" "$OUT/aligned.apk"

"$BT/apksigner" verify --print-certs "$OUT/milk.apk" | head -5
echo "==> 完成: $OUT/milk.apk"
ls -la "$OUT/milk.apk"