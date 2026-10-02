#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
lock="$root/resources/runtime-lock.json"
runtime="$root/resources/python-runtime"
wheels="$root/resources/python-wheels"
packages="$root/resources/python-packages"
cache="${ACESWARM_DOWNLOAD_CACHE:-/tmp/aceswarm-download}"
mkdir -p "$cache" "$wheels" "$runtime" "$packages"
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Only Linux x86_64 is supported for this release' >&2; exit 1; }
read_lock() { node -p "require('$lock').$1.$2"; }
download() {
  local kind="$1" output="$2" url hash
  url="$(read_lock "$kind" url)"; hash="$(read_lock "$kind" sha256)"
  [[ "$hash" =~ ^[a-f0-9]{64}$ ]] || { echo "Unpinned $kind SHA-256 in $lock" >&2; exit 1; }
  if [[ ! -f "$output" ]]; then
    local flags=()
    if [[ "${ACESWARM_CURL_INSECURE:-0}" == 1 ]]; then flags=(-k); fi
    [[ "${ACESWARM_OFFLINE:-0}" != 1 ]] || { echo "Missing cached archive: $output" >&2; exit 1; }
    curl "${flags[@]}" -fL --connect-timeout 5 --max-time 120 --retry 0 --silent --show-error "$url" -o "$output.part" || {
      echo "Cannot download $url; configure TLS trust or use explicitly verified cached archive $output" >&2; exit 1;
    }
    mv "$output.part" "$output"
  fi
  echo "$hash  $output" | sha256sum -c - || { echo "Archive checksum mismatch: $output" >&2; exit 1; }
}
if [[ ! -x "$runtime/bin/python3" ]]; then
  download python "$cache/python.tar.gz"
fi
if [[ ! -x "$root/resources/app-gateway/caddy" ]]; then
  download caddy "$cache/caddy.tar.gz"
fi
if [[ ! -x "$runtime/bin/python3" ]]; then
  tar -xzf "$cache/python.tar.gz" -C "$runtime" --strip-components=1
fi
mkdir -p "$root/resources/app-gateway"
if [[ ! -x "$root/resources/app-gateway/caddy" ]]; then
  tar -xOzf "$cache/caddy.tar.gz" caddy > "$root/resources/app-gateway/caddy"
  chmod +x "$root/resources/app-gateway/caddy"
fi
python="$runtime/bin/python3"
"$python" -c 'import setuptools, wheel; assert setuptools.__version__ == "80.9.0" and wheel.__version__ == "0.45.1"' || {
  if [[ "${ACESWARM_OFFLINE:-0}" == 1 ]]; then echo 'Pinned Python build tools missing in offline mode' >&2; exit 1; fi
  "$python" -m ensurepip --upgrade
  "$python" -m pip install --retries 0 'setuptools==80.9.0' 'wheel==0.45.1'
}
for repo in aivudaOS aivudaAppStore; do
  ui="$root/../$repo/$( [[ "$repo" == aivudaOS ]] && echo aivudaos || echo aivudaappstore )/resources/ui"
  [[ -f "$ui/dist/index.html" ]] || { echo "Build $repo frontend independently before bundling: $ui" >&2; exit 1; }
done
export AIVUDAOS_BUILD_DATE=20261002 AIVUDAOS_BUILD_SEQ=01
export AIVUDAAPPSTORE_BUILD_DATE=20261002 AIVUDAAPPSTORE_BUILD_SEQ=01
export SOURCE_DATE_EPOCH=1790899200
pip_options=(--retries 0)
if [[ "${ACESWARM_OFFLINE:-0}" == 1 ]]; then pip_options+=(--no-index --find-links "$wheels"); fi
staging="$root/resources/build-sources"
rm -rf "$staging"
mkdir -p "$staging/aivudaOS" "$staging/aivudaAppStore"
trap 'rm -rf "$staging"' EXIT
for pair in 'aivudaOS aivudaos' 'aivudaAppStore aivudaappstore'; do
  read -r repo module <<< "$pair"
  cp "$root/../$repo/"{setup.py,pyproject.toml,requirements.txt,README.md} "$staging/$repo/"
  rsync -a --exclude=node_modules --exclude=.vite --exclude=.vite-temp --exclude=package.json --exclude=package-lock.json --exclude=__pycache__ "$root/../$repo/$module/" "$staging/$repo/$module/"
done
"$python" -m pip wheel "${pip_options[@]}" --no-build-isolation --wheel-dir "$wheels" "$staging/aivudaOS" "$staging/aivudaAppStore"
find "$wheels" -maxdepth 1 -name '*.whl' -type f -printf '%f\n' | sort | (cd "$wheels" && xargs sha256sum) > "$root/resources/wheels.lock.generated"
if [[ -f "$root/resources/wheels.lock" ]]; then
  cmp -s "$root/resources/wheels.lock" "$root/resources/wheels.lock.generated" || {
    echo "Wheelhouse differs from pinned resources/wheels.lock; inspect upstream package/dependency drift" >&2; exit 1;
  }
else
  cp "$root/resources/wheels.lock.generated" "$root/resources/wheels.lock"
fi
rm -rf "$packages"
mkdir -p "$packages"
"$python" -m pip install --no-index --find-links "$wheels" --target "$packages" aivudaos aivudaappstore
node "$root/scripts/verify-bundle.js"
