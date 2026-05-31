"""The crew — the pipeline that runs the four stages in order.

    fetch (live, read-only)
        → Stats     (pure Python: facts)
        → Personality (LLM: one PlayerStyle per member, concurrent)
        → Writer ⇄ Judge  (LLM: Hebrew roast, scored, retried until good enough)

This is the "rצף של סוכנים" (sequence of agents) from the session — each stage's typed
output is the next stage's typed input. The Writer ⇄ Judge loop is Itay's own
self-improvement idea (his EF judge), now wired per-agent instead of across 5 candidates.
"""
from __future__ import annotations

import asyncio

from . import config, data, models
from .agents import judge, personality, writer
from .agents import stats as stats_agent


async def run_crew(group_id: str, date: str) -> models.CrewResult:
    # Stage 0 — read his real data. supabase-py is sync, so run it off the event loop.
    group_day = await asyncio.to_thread(data.fetch_group_day, group_id, date)

    # Stage 1 — Stats (deterministic, no LLM).
    facts = stats_agent.run(group_day)

    # Stage 2 — Personality (LLM): tag every member concurrently.
    styles = await personality.run(facts)

    # Stage 3+4 — Writer ⇄ Judge loop. Keep the best attempt; stop early when good enough.
    best_summary: models.CrewSummary | None = None
    best_verdict: models.JudgeVerdict | None = None
    feedback: str | None = None
    attempts = 0

    for attempt in range(1, config.MAX_WRITER_ATTEMPTS + 1):
        attempts = attempt
        summary = await writer.run(facts, styles, judge_feedback=feedback)
        verdict = await judge.run(facts, summary)

        if best_verdict is None or verdict.total > best_verdict.total:
            best_summary, best_verdict = summary, verdict

        if verdict.total >= config.JUDGE_MIN_TOTAL:
            break  # ship it
        feedback = verdict.reasoning  # otherwise tell the Writer what to fix, try again

    assert best_summary is not None and best_verdict is not None  # loop always runs ≥1×

    return models.CrewResult(
        group_id=group_id,
        date=date,
        summary_he=best_summary.text_he,
        judge=best_verdict,
        attempts=attempts,
        styles=styles,
        stats=facts,
        model=config.CREW_MODEL,
        seed=config.SEED,
        temperature=config.TEMPERATURE,
    )
