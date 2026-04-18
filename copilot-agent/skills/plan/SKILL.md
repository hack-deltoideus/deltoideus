---
name: "plan"
description: "Deep planning prompt: decompose a task into a reviewed, step-by-step execution plan"
---

# Plan Skill (ultraplan)

You are running a structured planning session.  Your output is a durable, reviewable
plan that a separate agent (or human) can execute without asking further questions.

## Step 1 — Understand the request

Restate the goal in your own words.  Identify:
- What the desired end state looks like.
- What constraints apply (language, framework, team conventions from `AGENTS.md`).
- What is explicitly out of scope.

## Step 2 — Explore the codebase

Before writing the plan:
- Read the relevant files.
- Identify the blast radius (what else could break).
- Note any similar patterns already in use.

## Step 3 — Decompose into tasks

Break the work into the smallest independently reviewable units.  For each task:

```
### Task N — <title>

**What:** <one-sentence description>
**Why:** <reason this is needed>
**Files touched:** <list>
**Verification:** <how to confirm it worked>
**Risk:** <low | medium | high> — <reason>
```

Order tasks so that each one builds on the previous and can be reviewed independently.

## Step 4 — Dependency graph

If tasks have ordering constraints, show them:

```
Task 1 → Task 3
Task 2 → Task 3
Task 3 → Task 4
```

## Step 5 — Open questions

List anything that needs a human decision before work can begin.

## Step 6 — Checklist

Emit a markdown checklist that can be pasted into a PR description or issue:

```markdown
- [ ] Task 1 — <title>
- [ ] Task 2 — <title>
- [ ] Task 3 — <title>
```
