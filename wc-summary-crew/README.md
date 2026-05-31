# WC Summary Crew 🏆🤖

A multi-agent crew that writes the WorldCup app's nightly roast — the reference
implementation of the architecture from session 6. The pipeline runs end to end and
produces **Hebrew**, it reads your **real data** from Supabase, and it never touches your
live Edge Function.

> Built so you learn it by running and extending it. Most of the code works as-is; one
> piece — the **Writer** — is deliberately left for you. It's the heart, and it's the part
> most worth writing yourself. Details below.

> 📚 **Hebrew companion docs** (deeper, narrative) live in [`docs/`](docs/):
> [the server & deploy guide](docs/01-server-and-deploy.md) ·
> [the multi-agent system explained](docs/02-multi-agent-system.md) ·
> [dev insights & bugs to crack yourself](docs/03-dev-insights.md).

---

## What it is, and why

Today's nightly summary is an **ensemble**: five variants of the *same role* (the same
prompt with small tweaks) + a Judge that picks the best. It works — but to get good
Hebrew you'd have to tune five prompts in parallel.

This is a **crew** instead — split into distinct *roles*, each with one job:

```
   fetch (live, read-only from Supabase)
        │
        ▼
   ┌──────────┐   facts     ┌──────────────┐  PlayerStyle   ┌──────────┐  Hebrew   ┌─────────┐
   │  Stats   │ ──────────▶ │ Personality  │ ─────────────▶ │  Writer  │ ───────▶ │  Judge  │
   │ (Python, │             │    (LLM)     │                │  (LLM,   │   ⇄      │  (LLM)  │
   │  no LLM) │             │  tag players │                │  Hebrew) │  score+  │ 0–10 +  │
   └──────────┘             └──────────────┘                └──────────┘  retry   │ feedback│
                                                                                   └─────────┘
```

Each stage takes a **typed object** and returns a **typed object**. That's the whole point
of the framework: because the handoff is structured, every agent does one thing — and you
can tune / measure / swap each one independently.

---

## The question this answers in code (Writer vs. a plain prompt) ⭐

In the session you asked: *"what's the difference between a Writer agent and the prompt I
write today?"* — and it never made it onto the screen. Here it is, in code:

* Open [`app/models.py`](app/models.py) — that's where `PlayerStyle` lives (the tiny class you asked to see).
* Open [`app/agents/writer.py`](app/agents/writer.py) — the Writer receives a `StatsBlock` +
  `list[PlayerStyle]`: **facts and tags already computed**, not a blob of text.

The difference is two things:
1. **The INPUT is structured** — not "figure everything out and write," but a typed object that already did the thinking.
2. **The responsibility is narrow** — one job: Hebrew. Only Hebrew.

So you can tune this one prompt *in isolation*, measure it with the Judge, even swap its
model — without touching Stats or Personality. One giant prompt never gave you that split.

---

## The honest tradeoff (worth knowing) 🧠

**LLM calls work great in TypeScript.** You don't *need* Python to get Hebrew — you could
add a Writer step inside the existing EF. So why does this exist?

1. **The career jump** — a real backend (FastAPI), a real framework (PydanticAI). This is Track F.
2. **A cleaner architecture** — one place owns language, instead of five prompts.
3. **A safe sandbox** — learn multi-agent on your real data *without risking* the live EF.

It runs in **shadow mode**: the EF keeps producing the (English) summary as usual, and the
crew runs alongside it reading the same data. You compare side by side. Zero production risk.

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

# 3. A test that needs no keys at all — verifies the Stats agent
python -m tests.test_stats

# 4. Shadow mode — run on a real (group, date) and compare to the EF
python -m scripts.run_shadow --recent                   # list available (group_id, date)
python -m scripts.run_shadow --ef <group_id> 2026-06-15  # print ONLY the EF's English roast (no crew, no LLM cost)
python -m scripts.run_shadow <group_id> 2026-06-15       # run the crew + print Hebrew vs the EF's English

# 5. As a service (slide 5 — "a script that starts with app = FastAPI()")
uvicorn app.main:app --reload
#   POST http://127.0.0.1:8000/summary   body: {"group_id":"...","date":"2026-06-15"}
```

Deploying it to a real always-on host (Railway, ~$5/mo) is covered in
[`docs/01-server-and-deploy.md`](docs/01-server-and-deploy.md).

---

## What's yours to do (learn by doing) ✍️

* **★ The Writer is yours:** [`app/agents/writer.py`](app/agents/writer.py). The pipeline runs
  and already emits Hebrew — but the prompt there is a deliberately flat starting point.
  **Turning it into genuinely funny Hebrew (not a translation) is the highest-value work in
  the project.** Inside there's a numbered `TODO(Itay)` by priority (tone, using the tags,
  banning Hebrew clichés like the banned-words list in your EF, structure, edge cases). Use
  [`app/agents/personality.py`](app/agents/personality.py) as the working pattern to copy.

* **Stretch (once the Writer is good):**
  * **self-improvement loop** — wire the Judge to per-agent `prompt_versions`, the exact
    "closed loop" you derived in the session. The loop already exists in
    [`app/crew.py`](app/crew.py); what's missing is persisting winning versions.
  * **chatbot / RAG** over HowToPlay — same Python service, one more agent. The seed is here.

---

## File map 🗺️

| File | What it is |
|---|---|
| [`app/models.py`](app/models.py) | The typed contracts between agents — incl. `PlayerStyle` |
| [`app/data.py`](app/data.py) | Live, read-only Supabase access (same RPCs as the EF) |
| [`app/agents/stats.py`](app/agents/stats.py) | The Stats agent — pure Python, no LLM |
| [`app/agents/personality.py`](app/agents/personality.py) | **Full worked PydanticAI example** |
| [`app/agents/writer.py`](app/agents/writer.py) | **★ yours to tune** — the Hebrew writer |
| [`app/agents/judge.py`](app/agents/judge.py) | Your Judge, ported from the EF |
| [`app/crew.py`](app/crew.py) | The pipeline: Stats→Personality→Writer→Judge + retry |
| [`app/main.py`](app/main.py) | The FastAPI service |
| [`scripts/run_shadow.py`](scripts/run_shadow.py) | Shadow-mode runner + EF comparison |
| [`tests/test_stats.py`](tests/test_stats.py) | Offline test (no keys) |
| [`docs/`](docs/) | Hebrew companion docs (server, multi-agent, dev insights) |

---

## Toward the June 22 session 📅

Exactly as you said — *"play with the things a bit, then talk."* Play with shadow mode,
tune the Writer until the Hebrew lands, and we'll go through it together: wire up the
self-improvement loop and add the chatbot on the same service. 🤝
