#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

# Rebuild both submodule frontends on every dev launch so source changes are current.
"$ROOT/scripts/build-dev-frontends.sh"

export ACESWARM_PYTHON="${ACESWARM_PYTHON:-$ROOT/resources/python-runtime/bin/python3}"
export ACESWARM_CADDY="${ACESWARM_CADDY:-$ROOT/resources/app-gateway/caddy}"
exec "$ROOT/node_modules/.bin/electron" . "$@"
