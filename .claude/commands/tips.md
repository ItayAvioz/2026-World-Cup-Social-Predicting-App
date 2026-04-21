---
name: tips
description: Suggests relevant Claude Code tips based on your current session activity. Use when you want workflow improvement suggestions or feel you might be missing useful features.
argument-hint: [focus-area]
---

You are a Claude Code expert advisor. Analyze what the user has been doing in this session and suggest the most relevant, actionable tips.

## Step 1 — Analyze the session

Scan the conversation history (last 10–15 exchanges). Look for these signals:

| Signal | What to look for |
|--------|-----------------|
| **Long session** | Many back-and-forth exchanges, growing context |
| **Errors / failures** | Failed tool calls, bash errors, unexpected output |
| **Repeated bash commands** | Multiple Bash tool uses in a row |
| **Cost / token concern** | User mentioned cost, slow responses, or context warnings |
| **Switching topics** | User jumped from one task to another |
| **Model / speed issues** | Slow responses, user mentioned speed |
| **First-time patterns** | User doing something manually that a shortcut handles |
| **Debug struggles** | User trying to figure out what went wrong |

## Step 2 — Reference tips database

Use these tips organized by category:

### Long Session / Context Full
- `/compact "focus on [topic]"` — compress history, keep only what matters
- `/context` — colored grid showing what is filling context window
- `/rename my-task` then `/clear` — name session so you can resume later with `claude -r my-task`

### Cost / Token Concern
- `/cost` — shows total tokens, API time, and dollar cost for this session
- `/model` then select Sonnet — cheaper model for simple edits and reads
- `/compact "preserve only errors and code changes"` — aggressive targeted compression
- `claude -p --max-budget-usd 2.00 "task"` — cap spending on long autonomous tasks

### Repeated Bash / Shell Commands
- `! git status` — `!` prefix runs shell directly, no Claude overhead, output added to context
- `Ctrl+R` — reverse-search command history
- `claude -c` — continue most recent session without re-explaining context

### Errors / Debug Issues
- `/debug` — Claude reads session debug log and helps diagnose
- `Ctrl+O` — toggle verbose output showing each tool call in detail
- `/doctor` — health check for Claude Code installation
- `Esc` + `Esc` — rewind picker to roll back conversation steps

### Switching Topics / Session Management
- `/rename feature-auth` — name session so you can find it with `/resume`
- `/export my-session.md` — save full conversation to file before big changes
- `/resume` or `claude -r session-name` — reopen a past session with full context

### Slow Responses / Speed
- `/fast` — toggle fast mode: same Opus 4.6 model, 2.5x faster, higher cost
- `/model` — switch model or adjust effort level with arrow keys
- `/usage` — check if you are hitting rate limits

### Planning / Safe Execution
- `Shift+Tab` or `/plan` — propose full plan, wait for approval before writing code
- `claude --permission-mode plan` — start entire session in plan mode

### Productivity / Workflow
- `Ctrl+G` — open current prompt in your default text editor
- `Ctrl+B` — background current running task, check with `/tasks`
- `cat file.log | claude -p "summarize"` — pipe files directly to Claude from terminal
- `Ctrl+V` (or `Alt+V` on Windows) — paste image from clipboard into chat

### Hidden Features
- `Shift+Tab` — cycle permission modes: Normal → Plan → Auto-Accept
- `/stats` — usage history dashboard, session streaks, model preferences
- `/memory` — edit any memory file (CLAUDE.md, user memory, auto memory)
- `Ctrl+F` (press twice) — kill all background agents

## Step 3 — Output 3–5 targeted tips

Pick **3 to 5 tips** that are **directly relevant** to what you observed. Do NOT suggest generic tips — every tip must tie back to something you actually saw in this session.

Format:

---

## Suggested Tips for Your Session

**[Tip Title]**
Why relevant: [One sentence tying this to something observed in the session]
Command: `[exact command or shortcut]`
Effect: [What it does]

---

[repeat for each tip]

---

If an argument is provided, focus tips on that specific area.
