#!/usr/bin/env bash
# install.sh — idempotent setup script for copilot-agent
#
# Run from the ROOT of any repository where you want to activate this agent config:
#
#   bash copilot-agent/install.sh
#
# What it does:
#   1. Copies instructions/AGENTS.md → AGENTS.md  (skips if already present)
#   2. Adds AGENTS.local.md to .gitignore          (idempotent)
#   3. Copies config/settings.json → .copilot-agent.json  (skips if already present)
#   4. Prints a reminder to fill in the TODO sections of AGENTS.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(pwd)"

echo "==> copilot-agent install"
echo "    source : $SCRIPT_DIR"
echo "    target : $REPO_ROOT"
echo ""

# ── 1. AGENTS.md ──────────────────────────────────────────────────────────────
AGENTS_DST="$REPO_ROOT/AGENTS.md"
if [[ -f "$AGENTS_DST" ]]; then
    echo "[skip] AGENTS.md already exists — not overwriting"
else
    cp "$SCRIPT_DIR/instructions/AGENTS.md" "$AGENTS_DST"
    echo "[ ok ] Copied instructions/AGENTS.md → AGENTS.md"
fi

# ── 2. .gitignore — add AGENTS.local.md if not already present ────────────────
GITIGNORE="$REPO_ROOT/.gitignore"
touch "$GITIGNORE"
if grep -qxF "AGENTS.local.md" "$GITIGNORE" 2>/dev/null; then
    echo "[skip] AGENTS.local.md already in .gitignore"
else
    printf "\n# copilot-agent local overrides (machine-local, not committed)\nAGENTS.local.md\n" >> "$GITIGNORE"
    echo "[ ok ] Added AGENTS.local.md to .gitignore"
fi

# ── 3. .copilot-agent.json ────────────────────────────────────────────────────
CONFIG_DST="$REPO_ROOT/.copilot-agent.json"
if [[ -f "$CONFIG_DST" ]]; then
    echo "[skip] .copilot-agent.json already exists — not overwriting"
else
    cp "$SCRIPT_DIR/config/settings.json" "$CONFIG_DST"
    echo "[ ok ] Copied config/settings.json → .copilot-agent.json"
fi

# ── 4. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "==> Done.  Next steps:"
echo ""
echo "    1. Open AGENTS.md and fill in the three TODO sections:"
echo "       - ## Detected stack      (languages, frameworks, package manager)"
echo "       - ## Verification        (real lint/build/test commands for this repo)"
echo "       - ## Repository shape    (describe the folder layout)"
echo ""
echo "    2. Optionally create a local override:"
echo "       cp copilot-agent/instructions/local.md AGENTS.local.md"
echo ""
echo "    3. Commit AGENTS.md (and .copilot-agent.json if desired):"
echo "       git add AGENTS.md .copilot-agent.json .gitignore && git commit -m 'chore: add copilot-agent config'"
echo ""
