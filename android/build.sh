#!/usr/bin/env bash
# milk.chat APK 构建脚本（aapt2 + javac + d8 + zipalign + apksigner）
set -euo pipefail

ROOT="/workspace/android"
APP="$ROOT/app"
BUILD="$ROOT/build"
SDK="/opt/asdk"
BT="$SDK/android-14"
PLAT="$SDK/android-34"
OUT_APK="/workspace/milk.chat.apk"

echo "build-tools: $BT"
echo "platform:    $PLAT"

rm -rf "$BUILD"
mkdir -p "$BUILD/classes" "$BUILD/dex"

echo "[1/7] 准备资产..."
python3 "$ROOT/tools/make_icons.py"
python3 "$ROOT/tools/prepare_assets.py"

echo "[2/7] aapt2 编译资源..."
"$BT/aapt2" compile --dir "$APP/res" -o "$BUILD/res.zip"

echo "[3/7] aapt2 链接（含资产打包）..."
"$BT/aapt2" link \
    -o "$BUILD/base.apk" \
    -I "$PLAT/android.jar" \
    --manifest "$APP/AndroidManifest.xml" \
    -A "$APP/assets" \
    --java "$BUILD/gen" \
    --min-sdk-version 21 \
    --target-sdk-version 30 \
    --auto-add-overlay \
    "$BUILD/res.zip"

echo "[4/7] javac 编译..."
javac --release 8 -nowarn \
    -cp "$PLAT/android.jar" \
    -d "$BUILD/classes" \
    $(find "$APP/src" "$BUILD/gen" -name '*.java')

echo "[5/7] d8 dex..."
(cd "$BUILD/classes" && jar cf "$BUILD/classes-raw.jar" .)
R8JAR="$ROOT/tools/r8.jar"
if [ ! -f "$R8JAR" ]; then
    curl -sSL -o "$R8JAR" "https://dl.google.com/android/maven2/com/android/tools/r8/9.5.23/r8-9.5.23.jar"
fi
java -Xmx1g -cp "$R8JAR" com.android.tools.r8.D8 --release \
    --lib "$PLAT/android.jar" \
    --min-api 21 \
    --output "$BUILD/dex" \
    "$BUILD/classes-raw.jar"

echo "[6/7] 打包 dex + 对齐..."
(cd "$BUILD/dex" && zip -q -u "$BUILD/base.apk" classes.dex)
"$BT/zipalign" -f 4 "$BUILD/base.apk" "$BUILD/aligned.apk"

echo "[7/7] 签名..."
KS="$ROOT/milk.keystore"
if [ ! -f "$KS" ]; then
    keytool -genkeypair -v \
        -keystore "$KS" -alias milk \
        -keyalg RSA -keysize 2048 -validity 10950 \
        -storepass milkchat123 -keypass milkchat123 \
        -dname "CN=milk.chat, OU=milk, O=milk, L=Web, C=CN"
fi
"$BT/apksigner" sign \
    --ks "$KS" --ks-key-alias milk \
    --ks-pass pass:milkchat123 --key-pass pass:milkchat123 \
    --min-sdk-version 21 \
    --out "$OUT_APK" \
    "$BUILD/aligned.apk"

"$BT/apksigner" verify --print-certs "$OUT_APK" | head -5
ls -lh "$OUT_APK"
echo "DONE: $OUT_APK"
