#!/bin/sh
# Builds For-Aarya.apk without Gradle: the app has no libraries, so the SDK's own tools are enough.
# Needs Java 17 and the Android SDK (platform 34, build-tools 34.0.0). The signing key lives outside
# the repo, in ../../love-letter-app-key; updates must be signed with the same key or the phone refuses them.
set -e
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
KEY="../../love-letter-app-key"
VERSION_CODE="${1:-1}"
VERSION_NAME="${2:-1.0}"

rm -rf build
mkdir -p build/gen build/classes build/dex
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/unsigned.apk -I "$JAR" --manifest AndroidManifest.xml build/res.zip \
  --java build/gen --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME"
"$JAVA_HOME/bin/javac" -source 8 -target 8 -bootclasspath "$JAR" -Xlint:-options -d build/classes \
  $(find src build/gen -name '*.java')
"$BT/d8" --min-api 24 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q ../unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
"$BT/apksigner" sign --ks "$KEY/for-aarya.jks" --ks-pass "file:$KEY/password.txt" --out For-Aarya.apk build/aligned.apk
rm -f For-Aarya.apk.idsig
echo "Built $(pwd)/For-Aarya.apk"
