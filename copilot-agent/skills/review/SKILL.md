---
name: "review"
description: "Run a focused code review on current or specified changes"
---

# Review Skill

You are running a structured code review.  Follow these steps in order:

## 1. Scope

- If a file, directory, or diff is specified, review that scope only.
- Otherwise review all staged and unstaged changes in the current workspace.

## 2. Review checklist

Work through each category and report findings:

### Correctness
- [ ] Logic is sound and handles expected inputs and edge cases.
- [ ] Error paths are handled; errors are not silently swallowed.
- [ ] No off-by-one errors, integer overflow risks, or incorrect comparisons.

### Security
- [ ] No injection vulnerabilities (SQL, shell, XSS, path traversal).
- [ ] Secrets and credentials are not hardcoded or logged.
- [ ] User-controlled input is validated before use.

### Code quality
- [ ] Names are clear and consistent with the surrounding codebase.
- [ ] No dead code, commented-out blocks, or speculative abstractions.
- [ ] Functions are small and focused; complex logic is explained with comments.

### Tests
- [ ] New behaviour is covered by tests.
- [ ] Existing tests still pass (or failures are explicitly noted).

### Documentation
- [ ] Public APIs and non-obvious decisions are documented.
- [ ] `CHANGELOG` / release notes updated if applicable.

## 3. Output format

Summarise findings as:

```
## Review summary

**Overall:** <LGTM | Minor issues | Major issues>

### Findings
- [CRITICAL] <description and file:line>
- [MAJOR]    <description and file:line>
- [MINOR]    <description and file:line>
- [NIT]      <description and file:line>

### Suggestions
<Optional improvement ideas that are not blockers>
```

If there are no findings, say so explicitly.
