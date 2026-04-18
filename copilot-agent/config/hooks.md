# Hook Pipeline

Hooks are shell scripts fired at specific agent lifecycle points.  Register them in
`.copilot-agent.json` (see `config/settings.json`) to run before or after any agent
tool call.  In a pure Copilot / CI environment you can replicate the same gates with
GitHub Actions steps or pre-commit checks.

## Lifecycle points

| Hook | When it fires | GitHub Actions / CI equivalent |
|---|---|---|
| `PreToolUse` | Before the agent executes any tool call | Pre-commit hook, branch protection check |
| `PostToolUse` | After a successful tool call | Post-merge CI job, status check |
| `PostToolUseFailure` | After a failed tool call | CI failure notification, Slack/Discord alert |
| `Init` | Session startup | `workflow_dispatch` trigger, dev container `postStartCommand` |
| `Shutdown` | Session teardown | Post-session summary job |

## How to add a hook

1. Create a shell script, for example `scripts/hooks/pre.sh`.
2. Make it executable: `chmod +x scripts/hooks/pre.sh`.
3. Register it in `.copilot-agent.json`:

```json
{
  "hooks": {
    "PreToolUse": ["./scripts/hooks/pre.sh"]
  }
}
```

The script receives a JSON blob on stdin describing the tool call:

```json
{
  "tool": "bash",
  "input": { "command": "npm test" },
  "session_id": "..."
}
```

Exit code 0 → allow.  Any non-zero exit → block the tool call and report the hook output.

## How to replicate hooks in GitHub Actions

### Pre-push / pre-merge safety gate

```yaml
# .github/workflows/safety-gate.yml
# TODO: replace the run commands with this repo's real lint/build/test commands
on: [pull_request]
jobs:
  safety:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Lint
        run: echo "TODO: add lint command"
      - name: Test
        run: echo "TODO: add test command"
      - name: Security scan
        run: echo "TODO: add security scan command"
```

### Post-merge notification

```yaml
# .github/workflows/notify.yml
on:
  push:
    branches: [main]
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Discord notification
        uses: sarisia/actions-status-discord@v1
        with:
          webhook: ${{ secrets.DISCORD_WEBHOOK }}
          title: "Merged to main"
```

## Sample hook scripts

### Pre-tool: block writes to protected paths

```bash
#!/usr/bin/env bash
# scripts/hooks/pre.sh
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool')
if [ "$TOOL" = "write" ]; then
  PATH_ARG=$(echo "$INPUT" | jq -r '.input.path // empty')
  if [[ "$PATH_ARG" == *".env"* ]] || [[ "$PATH_ARG" == *"secrets"* ]]; then
    echo "Blocked: writing to sensitive path $PATH_ARG" >&2
    exit 1
  fi
fi
exit 0
```

### Post-tool: log tool usage for audit

```bash
#!/usr/bin/env bash
# scripts/hooks/post.sh
INPUT=$(cat)
mkdir -p .copilot-agent
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) tool_used: $(echo "$INPUT" | jq -r '.tool')" >> .copilot-agent/audit.log
exit 0
```
