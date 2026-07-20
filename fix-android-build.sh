#!/usr/bin/env bash
# One-shot fix for the stuck `./gradlew bundleRelease` (Metro hanging at
# "0% EXECUTING"). Run from the project root:  bash fix-android-build.sh
set -e
cd "$(dirname "$0")"

echo "==> node version (RN 0.85 needs >= 22.11.0):"
node -v || true

echo "==> Killing any stale Metro / bundler processes..."
pkill -f "cli.*bundle" 2>/dev/null || true
pkill -f "metro" 2>/dev/null || true

echo "==> Resetting watchman (the likely culprit; safe if watchman isn't installed)..."
watchman watch-del-all 2>/dev/null || true
watchman shutdown-server 2>/dev/null || true

echo "==> Clearing Metro / haste caches..."
rm -rf "${TMPDIR:-/tmp}"/metro-* "${TMPDIR:-/tmp}"/haste-map-* "${TMPDIR:-/tmp}"/metro-cache 2>/dev/null || true
rm -rf node_modules/.cache 2>/dev/null || true

echo "==> Cleaning stale Android build output (was ~6GB)..."
( cd android && ./gradlew clean )

echo "==> Building release bundle..."
( cd android && ./gradlew bundleRelease )

echo ""
echo "==> Done. Output AAB:"
ls -lh android/app/build/outputs/bundle/release/*.aab 2>/dev/null || echo "  (check android/app/build/outputs/bundle/release/)"
