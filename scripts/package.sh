#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
ARCH_APPIMAGE="x86_64"

echo "==> [1/3] Building React 19 + Tailwind CSS frontend (Vite)..."
npm run build

echo "==> [2/3] Building native Tauri v2 + Axum Rust binary (release, LTO, stripped)..."
cargo build --release --manifest-path src-tauri/Cargo.toml

BIN="src-tauri/target/release/youterm"
if [[ ! -f "$BIN" ]]; then
  echo "Error: Binary $BIN not found" >&2
  exit 1
fi

RELEASES="$ROOT/build/releases"
STAGE="$ROOT/build/linux/YouTerm-${VERSION}-linux-x64"

rm -rf "$STAGE"
mkdir -p "$STAGE" "$RELEASES"

# Prepare AppDir / Stage
mkdir -p "$STAGE/usr/bin" \
         "$STAGE/usr/lib/youterm" \
         "$STAGE/usr/share/applications" \
         "$STAGE/usr/share/licenses/youterm" \
         "$STAGE/usr/share/doc/youterm" \
         "$STAGE/usr/share/icons/hicolor/scalable/apps" \
         "$STAGE/usr/share/icons/hicolor/256x256/apps"

cp "$BIN" "$STAGE/usr/lib/youterm/youterm"
chmod 0755 "$STAGE/usr/lib/youterm/youterm"
cp -r dist "$STAGE/usr/lib/youterm/dist"
cp .env.example "$STAGE/usr/lib/youterm/config.example.env"
cp LICENSE COPYRIGHT "$STAGE/usr/share/licenses/youterm/"
cat > "$STAGE/usr/share/doc/youterm/SOURCE.txt" << EOF
YouTerm ${VERSION} — corresponding source code and build scripts:
https://github.com/RDSM243/YouTerm/tree/v${VERSION}
https://github.com/RDSM243/YouTerm/archive/refs/tags/v${VERSION}.tar.gz
EOF

cat > "$STAGE/usr/bin/youterm" << 'EOF'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
export YOUTERM_STATIC_DIR="$HERE/../lib/youterm/dist"
exec "$HERE/../lib/youterm/youterm" "$@"
EOF
chmod 0755 "$STAGE/usr/bin/youterm"

cat > "$STAGE/AppRun" << 'EOF'
#!/bin/sh
set -e
HERE="$(dirname "$(readlink -f "$0")")"
export YOUTERM_STATIC_DIR="$HERE/usr/lib/youterm/dist"
export XDG_DATA_DIRS="$HERE/usr/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
exec "$HERE/usr/lib/youterm/youterm" "$@"
EOF
chmod 0755 "$STAGE/AppRun"

cat > "$STAGE/youterm.desktop" << EOF
[Desktop Entry]
Type=Application
Name=YouTerm
Comment=Lightweight YouTube Music player with customizable terminal themes (Rust + Tauri v2)
Comment[pt_BR]=Player de YouTube Music nativo em Rust + Tauri v2 com temas de terminal
Exec=youterm
Icon=youterm
Terminal=false
Categories=AudioVideo;Audio;Player;
StartupNotify=true
StartupWMClass=youterm
X-AppImage-Version=${VERSION}
EOF

cp "$STAGE/youterm.desktop" "$STAGE/usr/share/applications/youterm.desktop"
cp "$STAGE/youterm.desktop" "$STAGE/usr/share/applications/io.github.youterm.Player.desktop"
cp public/youterm.svg "$STAGE/youterm.svg"
cp public/youterm.png "$STAGE/youterm.png"
cp public/youterm.png "$STAGE/.DirIcon"
cp public/youterm.svg "$STAGE/usr/share/icons/hicolor/scalable/apps/youterm.svg"
cp public/youterm.png "$STAGE/usr/share/icons/hicolor/256x256/apps/youterm.png"

echo "==> [3/3] Packaging native AppImage..."
APPIMAGETOOL=""
if [[ -x "$ROOT/.cache/tools/appimagetool" ]]; then
  APPIMAGETOOL="$ROOT/.cache/tools/appimagetool"
elif command -v appimagetool >/dev/null 2>&1; then
  APPIMAGETOOL="$(command -v appimagetool)"
else
  mkdir -p "$ROOT/.cache/tools"
  APPIMAGETOOL="$ROOT/.cache/tools/appimagetool"
  curl -sL "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH_APPIMAGE}.AppImage" -o "$APPIMAGETOOL"
  chmod +x "$APPIMAGETOOL"
fi

APPIMAGE_OUT="$RELEASES/YouTerm-${VERSION}-${ARCH_APPIMAGE}.AppImage"
rm -f "$APPIMAGE_OUT"
ARCH="$ARCH_APPIMAGE" "$APPIMAGETOOL" --appimage-extract-and-run --no-appstream "$STAGE" "$APPIMAGE_OUT"
chmod 0755 "$APPIMAGE_OUT"

echo ""
echo "==> Build Artifacts Ready:"
ls -lh "$BIN" "$APPIMAGE_OUT"
