#!/usr/bin/env bash
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PLUGIN_NAME="calendar"

echo "📦 Installing Hermes Calendar Plugin..."

# 1. Desktop plugin (UI)
DESKTOP_DIR="$HERMES_HOME/desktop-plugins/$PLUGIN_NAME"
mkdir -p "$DESKTOP_DIR"
cp plugin.js "$DESKTOP_DIR/plugin.js"
echo "  ✓ Desktop plugin → $DESKTOP_DIR/plugin.js"

# 2. Python backend (API)
BACKEND_DIR="$HERMES_HOME/plugins/$PLUGIN_NAME/dashboard"
mkdir -p "$BACKEND_DIR"
cp dashboard/manifest.json "$BACKEND_DIR/manifest.json"
cp dashboard/plugin_api.py "$BACKEND_DIR/plugin_api.py"
echo "  ✓ Backend API → $BACKEND_DIR/plugin_api.py"

# 3. Enable in config
if command -v hermes &>/dev/null; then
  if hermes plugins list 2>/dev/null | grep -q "$PLUGIN_NAME"; then
    echo "  ✓ Plugin already enabled"
  else
    hermes plugins enable "$PLUGIN_NAME" 2>/dev/null || true
    echo "  ✓ Plugin enabled via \`hermes plugins enable $PLUGIN_NAME\`"
  fi
else
  echo "  ⚠  'hermes' CLI not found. Add '$PLUGIN_NAME' to plugins.enabled in config.yaml manually."
fi

echo ""
echo "✅ Calendar plugin installed!"
echo "   Reload desktop plugins (⌘K → Reload desktop plugins)"
echo "   or restart Hermes for the backend API to take effect."
echo ""
echo "   Then navigate to /calendar via sidebar or ⌘K → Calendar: Open"