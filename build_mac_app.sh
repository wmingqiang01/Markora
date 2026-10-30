#!/bin/sh
set -e

APP_NAME="Markora"
APP_BUNDLE="${APP_NAME}.app"
CONTENTS_DIR="${APP_BUNDLE}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"

rm -rf "${APP_BUNDLE}"
mkdir -p "${MACOS_DIR}"
mkdir -p "${RESOURCES_DIR}/app"
mkdir -p "${RESOURCES_DIR}/starter_workspace"
mkdir -p assets

# Sync vector SVG icon
if [ -f "src/assets/icon.svg" ]; then
  cp "src/assets/icon.svg" "assets/icon.svg"
fi

# Generate multi-resolution macOS AppIcon.icns if needed
if [ ! -f "assets/AppIcon.icns" ]; then
  clang -fobjc-arc -O2 -framework Cocoa -framework CoreGraphics macos/generate_icon.m -o /tmp/gen_markora_icon
  /tmp/gen_markora_icon
  iconutil -c icns assets/AppIcon.iconset -o assets/AppIcon.icns
  rm -rf /tmp/gen_markora_icon assets/AppIcon.iconset
fi

# Generate multi-resolution macOS DocumentIcon.icns for .md files if needed
if [ ! -f "assets/DocumentIcon.icns" ]; then
  clang -fobjc-arc -O2 -framework Cocoa -framework CoreGraphics macos/generate_doc_icon.m -o /tmp/gen_doc_icon
  /tmp/gen_doc_icon
  iconutil -c icns assets/DocumentIcon.iconset -o assets/DocumentIcon.icns
  rm -rf /tmp/gen_doc_icon assets/DocumentIcon.iconset
fi

# Copy frontend assets, starter workspace, AppIcon.icns, and DocumentIcon.icns into bundle resources
cp -R src/* "${RESOURCES_DIR}/app/"
if [ -d "workspace" ]; then
  cp -R workspace/* "${RESOURCES_DIR}/starter_workspace/"
fi
cp "assets/AppIcon.icns" "${RESOURCES_DIR}/AppIcon.icns"
cp "assets/DocumentIcon.icns" "${RESOURCES_DIR}/DocumentIcon.icns"

# Create Info.plist (with .md / .markdown / .txt document association)
cat > "${CONTENTS_DIR}/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>com.markora.desktop</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key>
      <string>Markdown Document</string>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
      <key>LSHandlerRank</key>
      <string>Alternate</string>
      <key>CFBundleTypeIconFile</key>
      <string>DocumentIcon</string>
      <key>CFBundleTypeExtensions</key>
      <array>
        <string>md</string>
        <string>markdown</string>
        <string>mdown</string>
        <string>txt</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
EOF

# Compile Native macOS AppKit + WebKit Binary (Universal arm64 + x86_64 when supported)
if clang -arch arm64 -arch x86_64 -fobjc-arc -O2 \
  -framework Cocoa \
  -framework WebKit \
  -framework CoreServices \
  macos/main.m \
  -o "${MACOS_DIR}/${APP_NAME}" 2>/dev/null; then
  echo "✅ Compiled Universal macOS binary (arm64 + x86_64)"
else
  clang -fobjc-arc -O2 \
    -framework Cocoa \
    -framework WebKit \
    -framework CoreServices \
    macos/main.m \
    -o "${MACOS_DIR}/${APP_NAME}"
fi

chmod +x "${MACOS_DIR}/${APP_NAME}"

# Ad-hoc sign the app bundle so macOS Gatekeeper / Launchpad accepts it cleanly in /Applications
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "${APP_BUNDLE}" >/dev/null 2>&1 || true
fi

touch "${APP_BUNDLE}"
echo "✅ Built standalone native macOS desktop app: ${APP_BUNDLE}"
