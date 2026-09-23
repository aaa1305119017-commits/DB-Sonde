#!/usr/bin/env bash
# Package an already-built .app into a distributable .dmg AND .zip.
#
# Two problems this handles that `npm run tauri build` alone does not:
#  1. Tauri's DMG step (bundle_dmg.sh) uses osascript/Finder to arrange icons,
#     which needs an interactive GUI session and fails headless. We skip that and
#     let `hdiutil` compress a staged folder directly.
#  2. Bundling the llama.cpp binaries as app resources leaves the app's code
#     signature inconsistent ("code has no resources but signature indicates they
#     must be present") — which reads as "damaged" on another Mac. We deep
#     ad-hoc re-sign the whole bundle so the signature is valid.
#
# NOTE: ad-hoc signing is not Apple notarization. On another Mac the recipient
# must still strip the quarantine flag once:  xattr -cr "/path/DB Sonde.app"
# For warning-free distribution, sign with a Developer ID + notarize instead.
#
# Usage: scripts/make-dmg.sh   (after `npm run tauri build`)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT/src-tauri/target/release/bundle/macos"
APP="$APP_DIR/DB Sonde.app"
VERSION="$(grep -m1 '"version"' "$ROOT/src-tauri/tauri.conf.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
DMG="$APP_DIR/DB-Sonde_${VERSION}_aarch64.dmg"
ZIP="$APP_DIR/DB-Sonde_${VERSION}_macOS_arm64.zip"

[ -d "$APP" ] || { echo "no .app at $APP — run: npm run tauri build"; exit 1; }

echo "→ deep ad-hoc re-sign (seals the bundled llama binaries into a valid signature)"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "  signature valid"

echo "→ staging"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

echo "→ creating compressed DMG"
rm -f "$DMG"
hdiutil create -volname "DB Sonde" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null

echo "→ creating ZIP"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"

echo "→ done:"
echo "   $DMG ($(du -h "$DMG" | cut -f1))"
echo "   $ZIP ($(du -h "$ZIP" | cut -f1))"
