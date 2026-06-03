# WC Summary Crew 🏆🤖

A small Python service that writes the WorldCup app's nightly roast. It reads your **real
data** from Supabase, produces **Hebrew**, and never touches your live Edge Function (it runs
in **shadow mode** — read-only, alongside the EF, so you can compare side by side at zero
production risk).

> **The honest one-liner:** "crew" is just the project name. Under the hood this is a fixed
> **workflow** of structured LLM calls (Stats → Personality → Writer → Judge) — the order is
> hard-coded in [`app/crew.py`](app/crew.py) and none of those stages choose tools or loop on
> their own. The one genuinely **tool-using agent** in this repo is
> [`app/agents/support.py`](app/agents/support.py): a Q&A agent where the LLM decides at
> runtime which tool to call. That contrast — fixed workflow vs. real agent — is the whole
> lesson.

### 👉 Start here

New to the project? Read **[`docs/00-LEARN.md`](docs/00-LEARN.md)** — the guided walkthrough
that takes you from "run it once" to "understand every stage" in order. This README is just
the front door: what it is, how to run it, and where each file lives.

The deeper Hebrew companion docs:
[server & deploy](docs/01-server-and-deploy.md) ·
[the workflow explained](docs/02-multi-agent-system.md) ·
[dev insights & the 7 bugs we fixed](docs/03-dev-insights.md).

---

## How to run 🚀

```bash
# 1. Environment (once) — Python 3.11
python3.11 -m venv venv_wc-summary-crew
source venv_wc-summary-crew/bin/activate
pip install -r requirements.txt

# 2. Secrets
cp .env.example .env
#   Fill in:
#   SUPABASE_SERVICE_KEY  → Supabase dashboard → Project Settings → API → service_role (secret)
#   OPENAI_API_KEY        → the same key the EF uses
#   (Start with the DEV project, ftryuvfdihmhlzvbpfeu, to play safely)

# 3. Tests — no keys needed for unit + integration (e2e is opt-in)
pip install -r requirements-dev.txt
pytest                       # offline unit + integration, ~2s
python -m tests.test_stats   # or a zero-dependency quick check (Stats only, no pytest)

# 4. Shadow mode — run on a real (group, date) and compare to the EF
python -m scripts.run_shadow --recent                    # list available (group_id, date)
python -m scripts.run_shadow --ef <group_id> 2026-06-15  # print ONLY the EF's English roast (no crew, no LLM cost)
python -m scripts.run_shadow <group_id> 2026-06-15       # run the crew + print Hebrew vs the EF's English

# 5. As a service
uvicorn app.main:app --reload
#   GET  /health  → {"ok": true}
#   POST /summary body: {"group_id":"...","date":"2026-06-15"}            → the nightly roast (the workflow)
#   POST /ask     body: {"question":"...","group_id":"..."|null}          → the support agent (tool-using)
```

Both POST endpoints sit behind the same optional `x-crew-secret` header gate (enforced only
when `CREW_API_SECRET` is set, so local dev on `127.0.0.1` stays friction-free).

The opt-in live end-to-end test (real Supabase + OpenAI, spends tokens):

```bash
RUN_E2E=1 SUPABASE_SERVICE_KEY=... OPENAI_API_KEY=... \
  E2E_GROUP_ID=<uuid> E2E_DATE=2026-06-15 pytest tests/test_e2e.py
```

Deploying to a real always-on host (Railway, ~$5/mo) is covered in
[`docs/01-server-and-deploy.md`](docs/01-server-and-deploy.md).

---

## What's yours to do (learn by doing) ✍️

* **★ The Writer is yours:** [`app/agents/writer.py`](app/agents/writer.py). The workflow
  runs and already emits Hebrew — but the prompt there is a deliberately flat starting point.
  **Turning it into genuinely funny Hebrew (not a translation) is the highest-value work in
  the project.** The numbered `TODO(Itay)` inside the file is the single source of truth for
  the task list (tone, using the tags, banning Hebrew clichés, structure, edge cases). Use
  [`app/agents/personality.py`](app/agents/personality.py) as the working pattern to copy.

* **Stretch goals** are listed in [`docs/02-multi-agent-system.md`](docs/02-multi-agent-system.md) §7
  — the self-improvement loop (persist winning `prompt_versions`) and growing the support
  agent into a fuller chatbot / RAG over HowToPlay.

---

## File map 🗺️

| File | What it is |
|---|---|
| [`app/models.py`](app/models.py) | The typed contracts between stages — incl. `PlayerStyle`, `SupportAnswer` |
| [`app/data.py`](app/data.py) | Live, read-only Supabase access (same RPCs as the EF) |
| [`app/agents/stats.py`](app/agents/stats.py) | The Stats **step** — pure Python, no LLM |
| [`app/agents/personality.py`](app/agents/personality.py) | **Full worked PydanticAI example** (structured output) |
| [`app/agents/writer.py`](app/agents/writer.py) | **★ yours to tune** — the Hebrew writer |
| [`app/agents/judge.py`](app/agents/judge.py) | The Judge, ported from the EF |
| [`app/agents/support.py`](app/agents/support.py) | **The real tool-using agent** — LLM picks `search_rules` vs. `get_group_standings` |
| [`app/crew.py`](app/crew.py) | The workflow: Stats→Personality→Writer→Judge + retry |
| [`app/main.py`](app/main.py) | The FastAPI service — `/summary`, `/ask`, `/health` |
| [`scripts/run_shadow.py`](scripts/run_shadow.py) | Shadow-mode runner + EF comparison |
| [`tests/test_stats.py`](tests/test_stats.py) | Offline test (no keys) |
| [`docs/`](docs/) | Start at [`00-LEARN.md`](docs/00-LEARN.md); Hebrew companion guides alongside |

---

## Toward the June 22 session 📅

Exactly as you said — *"play with the things a bit, then talk."* Play with shadow mode, tune
the Writer until the Hebrew lands, and we'll go through it together: wire up the
self-improvement loop and grow the support agent on the same service. 🤝
