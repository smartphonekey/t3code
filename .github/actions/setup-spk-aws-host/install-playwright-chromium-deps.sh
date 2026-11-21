#!/usr/bin/env bash
set -euo pipefail

if ! command -v sudo >/dev/null 2>&1; then
  echo "playwright chromium deps on spk-aws requires sudo." >&2
  exit 1
fi

if command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y \
    alsa-lib at-spi2-atk at-spi2-core atk cups-libs dbus-libs \
    gtk3 libX11 libXcomposite libXcursor libXdamage libXext libXi libXrandr \
    libXScrnSaver libXtst liberation-fonts mesa-libgbm nss nspr pango cairo libdrm \
    libxkbcommon
elif command -v yum >/dev/null 2>&1; then
  sudo yum install -y \
    alsa-lib at-spi2-atk at-spi2-core atk cups-libs dbus-libs \
    gtk3 libX11 libXcomposite libXcursor libXdamage libXext libXi libXrandr \
    libXScrnSaver libXtst liberation-fonts mesa-libgbm nss nspr pango cairo libdrm \
    libxkbcommon
else
  echo "No dnf/yum available to install Playwright Chromium system dependencies." >&2
  exit 1
fi
