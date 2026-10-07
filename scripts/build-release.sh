#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

printf '%s\n' '[1/3] Verifying repository and submodules'
# Initialize missing checkouts without resetting already checked-out revisions.
# A developer may be packaging newer submodule commits than the parent records.
while IFS= read -r entry; do
  if [[ "$entry" == -* ]]; then
    read -r revision submodule_path remainder <<< "$entry"
    git submodule update --init --recursive -- "$submodule_path"
  fi
done < <(git submodule status)

printf '%s\n' '[2/3] Building the private runtime from the submodules'
npm run bundle:runtime

printf '%s\n' '[3/3] Verifying and packaging ACEswarm'
npm run bundle:verify
npm run dist -- "$@"

printf '\nRelease artifact:\n%s\n' "$ROOT/dist/ACEswarm-$(node -p "require('./package.json').version")-x86_64.AppImage"
