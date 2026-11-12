#!/usr/bin/env bash
set -euo pipefail

HERDR_HOME="${HOME}/.config/herdr-app"
TARGET_DIR="${HERDR_HOME}/mods/pierre-tree-files"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${SCRIPT_DIR}/mods/pierre-tree-files"
TARGET_EDITOR="${HERDR_HOME}/mods/editor"
SOURCE_EDITOR="${SCRIPT_DIR}/mods/editor"

if [ ! -d "${SOURCE_DIR}" ]; then
  echo "Error: Source directory not found: ${SOURCE_DIR}" >&2
  exit 1
fi

echo "==> Installing pierre-tree-files to ${TARGET_DIR} ..."
mkdir -p "${TARGET_DIR}"
cp -R "${SOURCE_DIR}/"* "${TARGET_DIR}/"

if [ -d "${SOURCE_EDITOR}" ]; then
  echo "==> Installing companion editor mod to ${TARGET_EDITOR} ..."
  mkdir -p "${TARGET_EDITOR}"
  cp -R "${SOURCE_EDITOR}/"* "${TARGET_EDITOR}/"
fi

echo "==> Verifying mod with herdr-app check..."
if command -v herdr-app >/dev/null 2>&1; then
  herdr-app check "${TARGET_DIR}"
  echo "==> pierre-tree-files installed and verified successfully!"
else
  echo "==> Copied files. (herdr-app command not found in PATH to verify)"
fi

echo ""
echo "To use it, update your layout (e.g. layouts/main.json):"
echo '  "content": { "mod": "pierre-tree-files" }'
echo ""
echo "Enjoy your Pierre-style file tree!"
