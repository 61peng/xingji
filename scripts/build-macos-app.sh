#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_BUNDLE="$PROJECT_ROOT/mac-dist/行迹.app"
CONTENTS="$APP_BUNDLE/Contents"
ICONSET="$PROJECT_ROOT/mac-dist/AppIcon.iconset"
ICON_SOURCE="$PROJECT_ROOT/macos/AppIcon-1024.png"

cd "$PROJECT_ROOT"
npm run mobile:build

rm -rf "$APP_BUNDLE" "$ICONSET"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources/web" "$ICONSET"

xcrun swiftc \
  -parse-as-library \
  -target arm64-apple-macos13.0 \
  -framework AppKit \
  -framework WebKit \
  "$PROJECT_ROOT/macos/XingjiApp.swift" \
  -o "$CONTENTS/MacOS/Xingji"

cp "$PROJECT_ROOT/macos/Info.plist" "$CONTENTS/Info.plist"
APP_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")"
BUILD_NUMBER="${GITHUB_RUN_NUMBER:-1}"
plutil -replace CFBundleShortVersionString -string "$APP_VERSION" "$CONTENTS/Info.plist"
plutil -replace CFBundleVersion -string "$BUILD_NUMBER" "$CONTENTS/Info.plist"
ditto "$PROJECT_ROOT/mobile-dist" "$CONTENTS/Resources/web"

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

node "$PROJECT_ROOT/scripts/create-icns.mjs" "$ICONSET" "$CONTENTS/Resources/AppIcon.icns"
rm -rf "$ICONSET"

codesign --force --deep --sign - --identifier io.github.peng61.xingji.macos "$APP_BUNDLE" >/dev/null
echo "$APP_BUNDLE"
