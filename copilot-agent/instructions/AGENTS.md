# AGENTS.md

This file provides instructions to Copilot GPT-Codex agent mode when working with code
in this repository.  Fill in the placeholder sections below to reflect the actual stack,
commands, and conventions of your project.

---

## Detected stack

- Languages: <!-- TODO: e.g. Rust, Python, TypeScript, Go -->
- Frameworks: <!-- TODO: e.g. Next.js, React, Django, or "none" -->
- Package manager: <!-- TODO: e.g. npm, cargo, pip, go modules -->

## Verification

Replace the commands below with the real lint/build/test commands for this repo.

```bash
# TODO: replace with this repo's actual commands
# Examples by ecosystem:
#   Node / TypeScript:  npm run lint && npm run build && npm test
#   Python:             ruff check . && pytest
#   Rust:               cargo fmt --check && cargo clippy -- -D warnings && cargo test
#   Go:                 go vet ./... && go test ./...
echo "configure verification commands in AGENTS.md"
```

- Tests and source files should be kept in sync; update both surfaces together when behavior changes.

## Repository shape

<!-- TODO: describe the layout of this repo -->
- `src/` — primary source tree (rename/remove if not applicable)
- `tests/` — validation surfaces; review alongside code changes (rename/remove if not applicable)
- `docs/` — documentation; update when public APIs or behavior change (remove if not applicable)

## Working agreement

- Prefer small, reviewable changes. Do not bundle unrelated fixes in a single PR.
- Read relevant code before changing it; keep changes tightly scoped to the request.
- Do not add speculative abstractions, compatibility shims, or unrelated cleanup.
- Do not create files unless they are required to complete the task.
- If an approach fails, diagnose the failure before switching tactics.
- Be careful not to introduce security vulnerabilities (command injection, XSS, SQL injection).
- Report outcomes faithfully: if verification fails or was not run, say so explicitly.
- Actions that affect shared systems, publish state, or delete data require explicit user
  authorisation or a durable workspace instruction before proceeding.

## Instruction file precedence

Copilot resolves instruction files from the innermost directory outward:

1. `AGENTS.md` at repo root (this file) — committed team baseline
2. `AGENTS.local.md` at repo root — machine-local overrides (gitignored)
3. Subdirectory `AGENTS.md` files — module-level guidance

Later (more specific) files take precedence over earlier (more general) ones.

## Tool and permission expectations

- File reads and workspace-local edits: allowed freely.
- Bash commands that modify shared infrastructure, publish artefacts, or destroy data:
  confirm with the user before running.
- Network requests outside the repo: flag before issuing unless the task explicitly asks
  for them.
- When in doubt, prefer the more conservative action and ask.
