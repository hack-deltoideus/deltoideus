# AGENTS.local.md — machine-local instruction overrides

This file is **not committed**. Add it to `.gitignore` and tailor it to your
local environment without affecting the shared team baseline in `AGENTS.md`.

Common uses:
- Override the default model or provider for local runs.
- Set a local proxy or custom API base URL.
- Add personal tool-allow/deny rules.
- Note local paths that differ from CI (e.g. a local Ollama instance).

---

## Local model preference

<!-- Uncomment and edit as needed:
model: qwen2.5-coder
-->

## Local proxy

<!-- Uncomment and edit as needed:
ANTHROPIC_BASE_URL: http://127.0.0.1:8080
OPENAI_BASE_URL: http://127.0.0.1:11434/v1
-->

## Personal working notes

<!-- Add any per-machine or per-developer context here. -->
