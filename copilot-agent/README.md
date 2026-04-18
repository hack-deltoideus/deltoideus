# copilot-agent

A self-contained, portable agent configuration folder for Copilot GPT-Codex agent mode.

Copy this folder into any repository to get a ready-to-use instruction hierarchy, skill catalog,
agent role playbooks, and config defaults — no CLI binary required, no dependency on the
source repository.

## Quick start

```bash
# From the root of any repo you want to set up:
bash copilot-agent/install.sh
```

`install.sh` is idempotent and handles all wiring automatically.  See [Manual setup](#manual-setup)
below if you prefer step-by-step control.

---

## What's inside

| Path | Purpose |
|---|---|
| `install.sh` | Idempotent setup script — run this in any new repo |
| `instructions/AGENTS.md` | Project-level system instructions template (committed) |
| `instructions/local.md` | Local override template (gitignored per user) |
| `skills/review/SKILL.md` | Code-review skill playbook |
| `skills/plan/SKILL.md` | Planning / ultraplan skill playbook |
| `skills/security-review/SKILL.md` | Security review skill playbook |
| `agents/architect.md` | Architect role — design and decomposition |
| `agents/implementer.md` | Implementer role — tightly-scoped code changes |
| `agents/reviewer.md` | Reviewer role — quality gate and feedback |
| `config/settings.json` | Copilot agent config defaults template |
| `config/hooks.md` | Hook pipeline documentation |
| `.gitignore` | Gitignore template (excludes local override files) |

---

## Manual setup

### 1. Copy this folder into your target repo

```bash
cp -r copilot-agent/ /path/to/your-repo/
```

### 2. Wire up project-level instructions

Copilot agent mode reads instructions from `AGENTS.md` at the repository root (and ancestor
directories). Copy the template:

```bash
cp copilot-agent/instructions/AGENTS.md AGENTS.md
```

Open `AGENTS.md` and fill in:
- The language / framework stack (the `## Detected stack` section)
- The real lint / build / test commands (the `## Verification` section)
- The repository layout (the `## Repository shape` section)

### 3. Add a local override (optional)

For machine-local or personal preferences that should not be committed:

```bash
cp copilot-agent/instructions/local.md AGENTS.local.md
echo "AGENTS.local.md" >> .gitignore
```

### 4. Use skills

Each subdirectory under `skills/` is a self-contained skill playbook. Reference them in
your Copilot prompt:

```
Run the "review" skill on my last set of changes.
Run the "security-review" skill on src/auth/.
Run the "plan" skill and give me a task breakdown for X.
```

### 5. Use agent roles

The `agents/` folder contains role-scoped instruction files for multi-step tasks:

```
Act as the Architect role (see copilot-agent/agents/architect.md) and design
the migration plan for X.
```

### 6. Apply config defaults

Copy `config/settings.json` to the repo root as `.copilot-agent.json` and edit to taste.
See `config/hooks.md` for hook pipeline documentation and GitHub Actions equivalents.

---

## Instruction file precedence

Copilot resolves instruction files from the innermost directory outward:

1. `AGENTS.md` at repo root — committed team baseline
2. `AGENTS.local.md` at repo root — machine-local overrides (gitignored)
3. Subdirectory `AGENTS.md` files — module-level guidance

Later (more specific) files take precedence over earlier (more general) ones.
