# AGENTS.md

This file provides instructions to Copilot agent mode when working with code
in this repository.

## Detected stack

- Languages: Markdown, JSON, Bash
- Frameworks: none
- Package manager: none

## Verification

Run lightweight validation that matches this repository's contents:

```bash
bash -n install.sh
python -m json.tool .copilot-agent.json > /dev/null
```

- Keep docs, templates, and installer behavior in sync when changing setup flows.

## Repository shape

- `agents/` - role playbooks for architect, implementer, and reviewer flows
- `config/` - default Copilot agent configuration and hook documentation
- `instructions/` - baseline repo instruction templates and local override template
- `skills/` - reusable skill playbooks
- `install.sh` - idempotent setup script for copying the config into a target repo
- `README.md` - usage and setup documentation

## Working agreement

- Prefer small, reviewable changes. Do not bundle unrelated fixes in a single PR.
- Read relevant files before changing them; keep edits tightly scoped to the request.
- Do not add speculative abstractions or extra tooling that this portable repo does not need.
- Update documentation whenever setup behavior, file locations, or defaults change.
- Report outcomes faithfully: if verification fails or was not run, say so explicitly.
- Actions that publish state, touch external systems, or delete data require explicit user authorisation.

## Instruction file precedence

Copilot resolves instruction files from the innermost directory outward:

1. `AGENTS.md` at repo root - committed team baseline
2. `AGENTS.local.md` at repo root - machine-local overrides (gitignored)
3. Subdirectory `AGENTS.md` files - module-level guidance

Later (more specific) files take precedence over earlier (more general) ones.

## Tool and permission expectations

- File reads and workspace-local edits are allowed freely.
- Ask before running commands that publish artefacts, modify shared infrastructure, or delete data.
- Keep network access opt-in unless the task explicitly requires it.
