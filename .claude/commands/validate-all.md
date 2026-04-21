---
name: validate-all
description: Read-only validation suite for WorldCup 2026. Checks DB schema, RLS, business rules, DB objects, doc consistency, and pending items against app characterization (CLAUDE.md), live ERD (SKILL.md), and memory files. Never modifies anything. Each DB check runs 3 times for repeatability. Outputs a full report to docs/VALIDATION_REPORT.md.
argument-hint: ""
allowed-tools: Read, Bash, Grep, Glob, Agent, Write
---

# WorldCup 2026 — Master Validation Runner

## ABSOLUTE RULE: READ-ONLY
All 6 agents are strictly read-only:
- SQL: SELECT only — no INSERT, UPDATE, DELETE, DDL of any kind
- Files: read only — no edits to migrations, memory, or SKILL.md
- The ONLY write allowed is creating `docs/VALIDATION_REPORT.md` at the end
- If an agent finds a problem → it reports it, never fixes it

---

## Sources of Truth (leading — define correct behavior)
1. `CLAUDE.md` — app characterization, business rules, UI/UX rules
2. `.claude/skills/db-feature/SKILL.md` — live ERD, RLS spec, helper functions list
3. `memory/db-phase.md` — schema decisions, what's deployed, what's pending

## Targets (agents verify everything else against the sources above)
- `supabase/migrations/*.sql` — does migration code match the spec?
- Live Supabase DB via SQL API — does the live DB match the migrations?
- `docs/*.md` — are the docs in sync with the sources of truth?
- `test/*.html` — do the test pages cover the full spec?

---

## SQL Query Helper (for agents hitting the live DB — SELECT only)

```bash
PAT=$(cat "C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_pat.txt")
curl -s -X POST "https://api.supabase.com/v1/projects/ftryuvfdihmhlzvbpfeu/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  --data-binary '{"query":"SQL_HERE"}'
```

---

## Invocation Protocol

When `/validate-all` is invoked:

### Step 1 — Read all 6 agent prompt files
```
.claude/skills/validate-all/agent-schema.md
.claude/skills/validate-all/agent-rls.md
.claude/skills/validate-all/agent-rules.md
.claude/skills/validate-all/agent-objects.md
.claude/skills/validate-all/agent-consistency.md
.claude/skills/validate-all/agent-pending.md
```

### Step 2 — Spawn all 6 agents IN PARALLEL (background)
Use the Agent tool with `run_in_background: true` for all 6.
Pass the full content of each agent file as the prompt.
Use `subagent_type: "Explore"` for ALL agents.

WHY Explore: the Explore subagent type has Edit, Write, and NotebookEdit
tools removed by design — agents literally cannot modify any file or schema.
This is technical enforcement, not just a prompt instruction.

### Step 3 — Wait for all 6 agents to complete
Do not proceed until all 6 background agents have returned results.

### Step 4 — Collect and merge all 6 reports

### Step 5 — Write merged report to `docs/VALIDATION_REPORT.md`

### Step 6 — Print console summary (severity counts + top critical findings)

---

## Repeatability Rule

Agents 1–4 (DB-facing) run every SQL check **3 times** (R1, R2, R3):
- All 3 identical → ✅ CONSISTENT — reliable
- Any difference → ⚠️ FLAKY — report all 3 results, flag as timing/cron issue

Agents 5–6 (file-only) run each check once (no repeatability needed — files don't change mid-run).

---

## Master Report Format (docs/VALIDATION_REPORT.md)

```markdown
# WorldCup 2026 — Validation Report
Generated: [date]
Agents run: 6 | DB checks: 3× each | File checks: 1×

---

## Summary Table
| Agent          | Checks | ❌ Critical | ⚠️ Gap | ℹ️ Improvement | 📋 Decision |
|----------------|--------|------------|--------|----------------|-------------|
| Schema (A1)    |        |            |        |                |             |
| RLS (A2)       |        |            |        |                |             |
| Rules (A3)     |        |            |        |                |             |
| Objects (A4)   |        |            |        |                |             |
| Consistency(A5)|        |            |        |                |             |
| Pending (A6)   |        |            |        |                |             |
| **TOTAL**      |        |            |        |                |             |

---

## ❌ Critical Findings (fix before next phase)
[Each finding with full detail — ID, check, source, runs, fix recommendation]

## ⚠️ Gaps (important but not blocking)
[...]

## ℹ️ Improvements
[...]

## 📋 Decisions Needed
[...]

## ⚠️ Repeatability Issues (flaky checks)
[Any check that returned different results across 3 runs]

## Pending Items Priority Table
[From Agent 6 — full prioritized table]

---

## Gate: Ready for Edge Function Phase?
Based on findings:
- ❌ BLOCKED — [reason]
- ✅ CLEAR — all critical checks pass
```

---

## Finding Format (each finding)

```
ID      | A1-003
Agent   | Schema
Check   | S-02: games — no status column
RUN 1   | [result]
RUN 2   | [result]
RUN 3   | [result]
MATCH   | ✅ CONSISTENT / ⚠️ FLAKY
STATUS  | ✅ PASS / ❌ FAIL / ⚠️ GAP / ℹ️ NOTE
SOURCE  | CLAUDE.md: "NO status column" / SKILL.md line 83
FINDING | [exact finding description]
FIX     | [recommended action — never performed by agents]
```

---

## Agent Files Reference

| File | Agent | Scope | DB calls? |
|---|---|---|---|
| agent-schema.md | A1 | Tables, columns, constraints, FKs | YES — 3× each |
| agent-rls.md | A2 | RLS enabled, policies, USING/WITH CHECK | YES — 3× each |
| agent-rules.md | A3 | Business rules enforced in SQL | YES — 3× each |
| agent-objects.md | A4 | RPCs, triggers, views, cron jobs | YES — 3× each |
| agent-consistency.md | A5 | Cross-doc conflicts, outdated docs | NO — files only |
| agent-pending.md | A6 | ⚠️ items, TBDs, blockers, decisions | NO — files only |
