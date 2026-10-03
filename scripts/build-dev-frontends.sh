#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

build_frontend() {
  local ui_dir="$1"
  if [[ ! -f "$ui_dir/package.json" || ! -f "$ui_dir/package-lock.json" ]]; then
    echo "Frontend checkout is incomplete: $ui_dir" >&2
    exit 1
  fi
  if [[ ! -x "$ui_dir/node_modules/.bin/vite" ]]; then
    npm --prefix "$ui_dir" ci --include=dev --no-audit --no-fund
  fi
  npm --prefix "$ui_dir" run build
}

build_frontend "$ROOT/aivudaOS/aivudaos/resources/ui"
build_frontend "$ROOT/aivudaAppStore/aivudaappstore/resources/ui"
