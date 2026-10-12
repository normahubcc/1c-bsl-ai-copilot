#!/usr/bin/env bash
# ==============================================================================
# 1C BSL AI Copilot Marketplace Publisher
# Publishes to Visual Studio Marketplace and Open-VSX Registry (Cursor/VSCodium)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== 1C BSL AI Copilot Marketplace Release Pipeline ==="

# 1. Run Tests and Build
echo "--> [1/4] Running full test suite..."
npm test

echo "--> [2/4] Building production bundles..."
npm run build

echo "--> [3/4] Building VSIX package..."
python3 build_vsix.py

VSIX_FILE=$(find . -maxdepth 1 -name "1c-bsl-ai-copilot-*.vsix" | head -n 1)
if [[ -z "$VSIX_FILE" || ! -f "$VSIX_FILE" ]]; then
    echo "Error: VSIX package not found!" >&2
    exit 1
fi

echo "--> [4/4] Package ready: $VSIX_FILE"

# 2. Check and Publish to Open-VSX (Cursor, VSCodium, Windsurf)
if [[ -n "${OVSX_PAT:-}" ]]; then
    echo "--> Publishing to Open-VSX (Cursor, VSCodium)..."
    npx --yes ovsx publish "$VSIX_FILE" --pat "$OVSX_PAT"
    echo "✓ Successfully published to Open-VSX: https://open-vsx.org/extension/normahub/1c-bsl-ai-copilot"
else
    echo "ℹ️  OVSX_PAT not set. Skipping Open-VSX publication."
    echo "   To publish to Open-VSX: export OVSX_PAT='your-token' && ./publish.sh"
fi

# 3. Check and Publish to VS Code Marketplace (Microsoft)
if [[ -n "${VSCE_PAT:-}" ]]; then
    echo "--> Publishing to Visual Studio Marketplace..."
    npx --yes @vscode/vsce@2.24.0 publish -p "$VSCE_PAT" --packagePath "$VSIX_FILE"
    echo "✓ Successfully published to Visual Studio Marketplace: https://marketplace.visualstudio.com/items?itemName=normahub.1c-bsl-ai-copilot"
else
    echo "ℹ️  VSCE_PAT not set. Skipping Visual Studio Marketplace publication."
    echo "   To publish to VS Code Marketplace: export VSCE_PAT='your-token' && ./publish.sh"
fi

echo "=== Marketplace Release Pipeline Complete ==="
