#!/usr/bin/env bash
set -euo pipefail

playwright_cli="${1:?playwright cli path required}"
browser=$(find "$HOME/.cache/ms-playwright" -name chrome-headless-shell -type f -print -quit)
test -n "$browser"

if ! ldd "$browser" 2>/dev/null | grep -q '=> not found'; then
  exit 0
fi

if command -v apt-get >/dev/null 2>&1; then
  node "$playwright_cli" install-deps chromium
else
  bash "$(dirname "$0")/install-playwright-chromium-deps.sh"
fi

if ldd "$browser" | grep '=> not found'; then
  echo "Chromium is still missing shared libraries after installing system dependencies." >&2
  ldd "$browser" | grep '=> not found' || true
  exit 1
fi
