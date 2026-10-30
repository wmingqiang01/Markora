#!/bin/sh
set -e

VERSION="${1:-v1.0.0}"
APP_NAME="Markora"
APP_BUNDLE="${APP_NAME}.app"
DIST_DIR="dist"

# 1. Build fresh Universal Markora.app
sh build_mac_app.sh

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}/dmg_root"

# 2. Package .zip archive (preserving macOS bundle metadata & symlinks)
ZIP_NAME="${APP_NAME}-${VERSION}-macOS-Universal.zip"
ditto -c -k --sequesterRsrc --keepParent "${APP_BUNDLE}" "${DIST_DIR}/${ZIP_NAME}"
echo "✅ Created ${DIST_DIR}/${ZIP_NAME}"

# 3. Package .dmg disk image with Applications drag-and-drop shortcut
DMG_NAME="${APP_NAME}-${VERSION}-macOS-Universal.dmg"
cp -R "${APP_BUNDLE}" "${DIST_DIR}/dmg_root/"
ln -s /Applications "${DIST_DIR}/dmg_root/Applications"

hdiutil create \
  -volname "${APP_NAME}" \
  -srcfolder "${DIST_DIR}/dmg_root" \
  -ov \
  -format UDZO \
  "${DIST_DIR}/${DMG_NAME}"

rm -rf "${DIST_DIR}/dmg_root"
echo "✅ Created ${DIST_DIR}/${DMG_NAME}"

# 4. Generate SHA-256 checksums
(
  cd "${DIST_DIR}"
  shasum -a 256 "${DMG_NAME}" "${ZIP_NAME}" > SHA256SUMS.txt
)
echo "✅ Generated ${DIST_DIR}/SHA256SUMS.txt"
