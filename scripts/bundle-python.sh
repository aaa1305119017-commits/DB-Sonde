#!/usr/bin/env bash
# Build the bundled Python runtime for Sonde's Python workbench.
#
# Produces  src-tauri/binaries/python-runtime.tar.gz  — a relocatable CPython
# (python-build-standalone) with the core data-work packages pre-installed.
# At first launch the app extracts this into ~/.db-sonde/runtime/python so
# users never touch pip / virtualenvs.  Bundling a single tarball (rather than
# loose files) sidesteps Tauri's resource copier mangling symlinks + exec bits.
#
# The tarball is gitignored and must be rebuilt before `npm run tauri build`.
set -euo pipefail

PY_VERSION="3.12.14"
PBS_TAG="20260901"

# 目标三元组。默认按本机推断;CI 里传参为各平台分别构建。
# 注意 pip 装的是**原生 wheel**(numpy/pandas/pyarrow 都是),所以每个平台必须
# 在自己的机器上构建,不能交叉。
TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  TARGET="aarch64-apple-darwin" ;;
    Darwin-x86_64) TARGET="x86_64-apple-darwin" ;;
    Linux-x86_64)  TARGET="x86_64-unknown-linux-gnu" ;;
    MINGW*|MSYS*|CYGWIN*) TARGET="x86_64-pc-windows-msvc" ;;
    *) echo "!! 无法推断目标平台,请显式传参,例如 $0 x86_64-pc-windows-msvc"; exit 1 ;;
  esac
fi

ASSET="cpython-${PY_VERSION}+${PBS_TAG}-${TARGET}-install_only.tar.gz"
GH_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${ASSET}"
# 直连优先(CI 上通);国内直连不通,再走镜像。
MIRRORS=("" "https://gh-proxy.com/" "https://ghfast.top/")
PIP_INDEX="${PIP_INDEX:-https://pypi.tuna.tsinghua.edu.cn/simple}"

# Runtime version marker — bump when the python/packages change so the app
# knows to re-extract on upgrade.
RUNTIME_VERSION="py${PY_VERSION}-pkgs3"

CORE_PACKAGES=(
  numpy pandas polars pyarrow
  SQLAlchemy PyMySQL psycopg2-binary openpyxl
  requests httpx python-dotenv
  beautifulsoup4 lxml tabulate tqdm python-dateutil
  # Phase 3: plotting (inline图), completion (jedi), linting (ruff binary)
  matplotlib jedi ruff
  # 血缘: sqlglot 解析 SQL 出表级/字段级血缘(多方言)
  sqlglot
)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/src-tauri/binaries"
WORK="$(mktemp -d)/pybuild"
mkdir -p "$WORK" "$OUT_DIR"
trap 'rm -rf "$(dirname "$WORK")"' EXIT

echo "→ downloading $ASSET"
ok=""
for m in "${MIRRORS[@]}"; do
  echo "   via ${m}"
  if curl -fL --retry 2 -m 300 -o "$WORK/py.tar.gz" "${m}${GH_URL}"; then ok=1; break; fi
done
[ -n "$ok" ] || { echo "!! all mirrors failed"; exit 1; }

echo "→ extracting"
tar -xzf "$WORK/py.tar.gz" -C "$WORK"          # → $WORK/python/
PYROOT="$WORK/python"
# install_only 的布局:unix 在 bin/python3,Windows 在 python.exe(根目录)。
if [ -x "$PYROOT/bin/python3" ]; then PYBIN="$PYROOT/bin/python3"
elif [ -f "$PYROOT/python.exe" ]; then PYBIN="$PYROOT/python.exe"
else PYBIN="$PYROOT/bin/python3"; fi
[ -e "$PYBIN" ] || { echo "!! python not found after extract"; exit 1; }
echo "   $("$PYBIN" --version)"

echo "→ installing core packages (清华镜像)"
"$PYBIN" -m pip install --no-cache-dir --disable-pip-version-check -i "$PIP_INDEX" \
  "${CORE_PACKAGES[@]}"

echo "→ stripping down (tests / caches / gui)"
# Drop the fat we never use in a headless data runtime.
rm -rf \
  "$PYROOT"/lib/python*/test \
  "$PYROOT"/lib/python*/tkinter \
  "$PYROOT"/lib/python*/turtledemo \
  "$PYROOT"/lib/python*/idlelib \
  "$PYROOT"/lib/python*/lib2to3 \
  "$PYROOT"/lib/python*/ensurepip \
  "$PYROOT"/lib/tcl* "$PYROOT"/lib/tk* "$PYROOT"/lib/Tix* "$PYROOT"/lib/itcl* \
  "$PYROOT"/Lib/test "$PYROOT"/Lib/tkinter "$PYROOT"/Lib/turtledemo \
  "$PYROOT"/Lib/idlelib "$PYROOT"/Lib/lib2to3 "$PYROOT"/Lib/ensurepip \
  "$PYROOT"/tcl 2>/dev/null || true
# Purge caches + compiled bytecode + bundled package tests.
find "$PYROOT" -type d -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
find "$PYROOT" -type d -name "tests" -path "*/site-packages/*" -prune -exec rm -rf {} + 2>/dev/null || true
find "$PYROOT" -name "*.pyc" -delete 2>/dev/null || true

echo "$RUNTIME_VERSION" > "$PYROOT/RUNTIME_VERSION"

# 本机构建时产出 binaries/python-runtime.tar.gz(给 tauri 内置用);
# 带参数为某个平台构建时,额外产出带三元组的名字,供上传 Release。
OUT="$OUT_DIR/python-runtime.tar.gz"
echo "→ repacking → $(basename "$OUT")"
tar -czf "$OUT" -C "$WORK" python
cp "$OUT" "$OUT_DIR/python-runtime-${TARGET}.tar.gz"

echo "→ done:"
du -sh "$PYROOT" | awk '{print "   extracted runtime:", $1}'
ls -lh "$OUT" | awk '{print "   bundled tarball:  ", $5}'
echo "   target:            $TARGET"
echo "   runtime version:   $RUNTIME_VERSION"
if command -v shasum >/dev/null; then
  shasum -a 256 "$OUT_DIR/python-runtime-${TARGET}.tar.gz"
else
  sha256sum "$OUT_DIR/python-runtime-${TARGET}.tar.gz"
fi
