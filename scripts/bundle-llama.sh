#!/usr/bin/env bash
# Collect llama-server + all its non-system dylibs (and the Metal backend
# plugin) into a self-contained, relocatable folder that the Sonde app can
# ship, so end users need neither Homebrew nor a separate llama.cpp install.
#
# Usage: scripts/bundle-llama.sh   (run on an arm64 Mac with `brew install llama.cpp`)
set -euo pipefail

BREW="${BREW:-/opt/homebrew}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries/llama"
SRC_BIN="$BREW/bin/llama-server"

[ -x "$SRC_BIN" ] || { echo "llama-server not found at $SRC_BIN — run: brew install llama.cpp"; exit 1; }

echo "→ bundling into $DEST"
rm -rf "$DEST"; mkdir -p "$DEST"

# Copy the binary (resolve the Cellar symlink) + the dylibs it needs.
cp -L "$SRC_BIN" "$DEST/llama-server"
copy_lib() { # copy a dylib by real path, naming it by its versioned soname
  local real dest
  real="$(readlink -f "$1")" || return 0
  dest="$DEST/$2"
  [ -f "$dest" ] || cp "$real" "$dest"
}
copy_lib "$BREW/Cellar/llama.cpp/"*/lib/libllama-server-impl.dylib libllama-server-impl.dylib
copy_lib "$BREW/Cellar/llama.cpp/"*/lib/libllama-common.0.dylib     libllama-common.0.dylib
copy_lib "$BREW/Cellar/llama.cpp/"*/lib/libmtmd.0.dylib             libmtmd.0.dylib
copy_lib "$BREW/Cellar/llama.cpp/"*/lib/libllama.0.dylib            libllama.0.dylib
copy_lib "$BREW/opt/ggml/lib/libggml.0.dylib"                       libggml.0.dylib
copy_lib "$BREW/opt/ggml/lib/libggml-base.0.dylib"                  libggml-base.0.dylib
copy_lib "$BREW/opt/libomp/lib/libomp.dylib"                        libomp.dylib
copy_lib "$BREW/opt/openssl@3/lib/libssl.3.dylib"                   libssl.3.dylib
copy_lib "$BREW/opt/openssl@3/lib/libcrypto.3.dylib"               libcrypto.3.dylib
# Metal backend is dlopen'd at runtime; ship it alongside.
cp "$BREW/Cellar/ggml/"*/libexec/libggml-metal.so "$DEST/libggml-metal.so" 2>/dev/null || echo "  (no metal backend found; CPU only)"

chmod u+w "$DEST"/*

# Rewrite every dependency that points at a bundled lib to @rpath/<name>, and
# add an rpath so @rpath resolves to the folder the file lives in.
BUNDLED="$(cd "$DEST" && ls *.dylib *.so 2>/dev/null)"
fix() {
  local file="$1" loader="$2"
  install_name_tool -id "@rpath/$(basename "$file")" "$file" 2>/dev/null || true
  while read -r dep; do
    local base; base="$(basename "$dep")"
    if echo "$BUNDLED" | grep -qx "$base"; then
      install_name_tool -change "$dep" "@rpath/$base" "$file" 2>/dev/null || true
    fi
  done < <(otool -L "$file" | tail -n +2 | awk '{print $1}')
  install_name_tool -add_rpath "$loader" "$file" 2>/dev/null || true
  codesign --force --sign - "$file" >/dev/null 2>&1 || true
}
for lib in "$DEST"/*.dylib "$DEST"/*.so; do [ -f "$lib" ] && fix "$lib" "@loader_path"; done
fix "$DEST/llama-server" "@executable_path"

echo "→ done. Contents:"; ls -la "$DEST"
