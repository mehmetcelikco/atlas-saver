#!/bin/bash
# Installs the Atlas Saver helper so screenshots go straight to Atlas without a download.
# Usage: ./install.sh <extension-id>   (the popup shows the full command)
set -euo pipefail
ID="${1:-}"
if [[ ! "$ID" =~ ^[a-p]{32}$ ]]; then
  echo "Pass the extension id, e.g. ./install.sh abcdefghijklmnopabcdefghijklmnop" >&2
  exit 1
fi
NAME="atlas_saver.helper"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Atlas Saver"
mkdir -p "$DEST"
cp "$HERE/atlas_saver_host.py" "$DEST/atlas_saver_host.py"
chmod 755 "$DEST/atlas_saver_host.py"

MANIFEST=$(cat <<JSON
{
  "name": "$NAME",
  "description": "Atlas Saver helper",
  "path": "$DEST/atlas_saver_host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ID/"]
}
JSON
)

installed=0
for dir in \
  "$HOME/Library/Application Support/Google/Chrome" \
  "$HOME/Library/Application Support/Google/Chrome Beta" \
  "$HOME/Library/Application Support/Google/Chrome Canary" \
  "$HOME/Library/Application Support/Chromium" \
  "$HOME/Library/Application Support/Microsoft Edge" \
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser" \
  "$HOME/Library/Application Support/Arc/User Data" \
  "$HOME/Library/Application Support/Vivaldi"; do
  if [ -d "$dir" ]; then
    mkdir -p "$dir/NativeMessagingHosts"
    printf '%s\n' "$MANIFEST" > "$dir/NativeMessagingHosts/$NAME.json"
    echo "Installed for: ${dir#$HOME/Library/Application Support/}"
    installed=1
  fi
done
[ "$installed" = 1 ] || { echo "No Chromium browser found." >&2; exit 1; }
echo "Done. Take a screenshot again — no restart needed."
