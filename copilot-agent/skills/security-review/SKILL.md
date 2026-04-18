---
name: "security-review"
description: "Focused security audit on the specified scope or recent changes"
---

# Security Review Skill

You are running a security-focused audit.  Work through each category methodically and
report every finding, even low-severity ones.

## Scope

- If a path, file, or diff is provided, review that scope.
- Otherwise audit the entire workspace, prioritising files that handle input, auth,
  file I/O, network, or subprocess execution.

## Category checklist

### Injection
- [ ] SQL injection — user input concatenated into queries without parameterisation.
- [ ] Shell injection — user input passed to `exec`, `spawn`, `system`, `eval`, or similar.
- [ ] Path traversal — user-controlled paths not normalised/validated before file access.
- [ ] XSS — user input reflected into HTML/JS without escaping.
- [ ] Template injection — user input interpolated into server-side templates.

### Authentication and authorisation
- [ ] Auth checks present on all sensitive endpoints/functions.
- [ ] Privilege escalation paths do not exist.
- [ ] Tokens and session IDs are not predictable or reusable after logout.

### Secrets and credential handling
- [ ] No hardcoded secrets, API keys, passwords, or tokens.
- [ ] Secrets not written to logs, error messages, or temp files.
- [ ] Cryptographic keys of adequate length; deprecated algorithms not used (MD5, SHA1, DES).

### Input validation
- [ ] All external input validated (type, length, format, range) before use.
- [ ] Numeric parsing cannot overflow or underflow.
- [ ] File uploads validated by content, not just extension.

### Dependency risks
- [ ] No known-vulnerable library versions (note if a scan tool is available).
- [ ] Transitive dependencies reviewed where feasible.

### Error handling and information leakage
- [ ] Stack traces and internal error details not exposed to callers.
- [ ] Error messages do not reveal sensitive system details.

### Concurrency
- [ ] No TOCTOU (time-of-check / time-of-use) races on file or resource access.
- [ ] Shared state protected appropriately under concurrent access.

## Output format

```
## Security review summary

**Overall risk:** <Low | Medium | High | Critical>

### Findings

| Severity | Category | Location | Description |
|---|---|---|---|
| CRITICAL | Injection | src/api.rs:42 | User input passed unsanitised to shell command |
| HIGH     | Secrets   | config.py:10  | API key hardcoded |

### Recommendations
<Remediation suggestions for each finding>
```

If no issues are found, state that explicitly and note what was reviewed.
