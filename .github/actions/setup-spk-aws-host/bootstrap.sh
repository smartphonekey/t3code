#!/usr/bin/env bash
set -euo pipefail

if command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y \
    git jq curl tar gzip xz unzip which patch bzip2 \
    gcc gcc-c++ make pkgconf-pkg-config libsecret-devel python3
elif command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y \
    git jq curl tar gzip xz-utils unzip patch bzip2 \
    build-essential pkg-config libsecret-1-dev python3
else
  echo "No supported package manager for spk-aws host bootstrap." >&2
  exit 1
fi

node_version="${SPK_BOOTSTRAP_NODE_VERSION:-}"
if [[ -z "$node_version" && -f package.json ]]; then
  node_version="$(jq -r '.engines.node' package.json | sed 's/^\^//')"
fi
node_version="${node_version:-26.12.1}"

node_home="$HOME/.cache/spk-ci-node/v${node_version}"
if [[ ! -x "$node_home/bin/node" ]]; then
  tmp="$(mktemp -d)"
  node_archive="$tmp/node.tar.xz"
  curl -fsSL \
    "https://nodejs.org/dist/v${node_version}/node-v${node_version}-linux-x64.tar.xz" \
    -o "$node_archive"
  mkdir -p "$tmp/node"
  if tar -xJf "$node_archive" -C "$tmp/node" --strip-components=1 2>/dev/null; then
    :
  else
    xz -dc "$node_archive" | tar -xf - -C "$tmp/node" --strip-components=1
  fi
  mkdir -p "$node_home"
  cp -a "$tmp/node"/. "$node_home/"
  rm -rf "$tmp"
fi

export PATH="$node_home/bin:$PATH"
echo "PATH=$PATH" >> "$GITHUB_ENV"
echo "$node_home/bin" >> "$GITHUB_PATH"
"$node_home/bin/node" --version
"$node_home/bin/npm" --version
