#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 is required" >&2; exit 1; }

printf '%s\n' '[1/4] Initializing Git submodules'
git submodule update --init --recursive

printf '%s\n' '[2/4] Installing ACEswarm JavaScript dependencies'
npm ci --include=dev

printf '%s\n' '[3/4] Creating the local development Python environment'
if [[ ! -x "$ROOT/.venv/bin/python" ]]; then
  python3 -m venv "$ROOT/.venv"
fi
"$ROOT/.venv/bin/python" -m pip install --upgrade pip
"$ROOT/.venv/bin/python" -m pip install -r "$ROOT/aivudaOS/requirements.txt" -r "$ROOT/aivudaAppStore/requirements.txt"

printf '%s\n' '[4/4] Building the submodule frontends and private development runtime'
# This also downloads/locks the development Caddy binary and creates a self-contained Python runtime.
npm run bundle:runtime

cat <<EOF

Development setup is ready. Start ACEswarm with:
  npm run dev

The development services use the checked-out submodules under:
  $ROOT/aivudaOS
  $ROOT/aivudaAppStore
EOF
