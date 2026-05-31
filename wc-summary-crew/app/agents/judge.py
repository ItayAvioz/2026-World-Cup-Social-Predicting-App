"""Judge agent — ported from the judge Itay already built in his EF.

In the EF the judge picks the best of 5 candidates. Here it does the other half of the
same idea: it scores the single Writer output and decides whether to send it back for
another attempt (the Writer ⇄ Judge loop). Same instincts, carried over verbatim:
  • verification-first — check facts before vibes (his EF v19);
  • reproducible — temperature 0.1, seed 1 (his EF judge);
  • a weighted rubric with accuracy weighted highest (his 45/30/15/10 → see JudgeVerdict.total).
"""
from __future__ import annotations

from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings

from .. import config, models

_SYSTEM_PROMPT = (
    "You are the judge of a nightly Hebrew WhatsApp roast for a World Cup prediction group.\n"
    "Verify FIRST, score SECOND:\n"
    "  • accuracy: every name, score, and rank in the roast must match the facts you're given. "
    "Any invented result or wrong number caps accuracy low.\n"
    "  • humor: is it genuinely funny and social, not a dry recap?\n"
    "  • hebrew_quality: natural, idiomatic Hebrew — penalise translated-English phrasing.\n"
    "  • structure: tight and WhatsApp-shaped.\n"
    "In `reasoning`, give ONE line and quote the single weakest phrase so the Writer can fix it."
)

judge_agent = Agent(
    f"openai-chat:{config.JUDGE_MODEL}",  # Chat Completions, like the EF
    output_type=models.JudgeVerdict,
    # His EF judge values — reproducible verdicts.
    model_settings=ModelSettings(temperature=0.1, seed=1),
    system_prompt=_SYSTEM_PROMPT,
)


def _facts_block(stats: models.StatsBlock) -> str:
    games = "; ".join(g.match for g in stats.games) or "—"
    table = "; ".join(
        f"#{m.group_rank} {m.username} {m.total_pts}pts(+{m.today_pts})"
        for m in sorted(stats.members, key=lambda m: m.group_rank)
    )
    return f"GROUND TRUTH\nGames: {games}\nTable: {table}\nHeadline: {stats.headline_fact or '—'}"


async def run(stats: models.StatsBlock, summary: models.CrewSummary) -> models.JudgeVerdict:
    prompt = (
        f"{_facts_block(stats)}\n\n"
        f"ROAST TO JUDGE (Hebrew):\n{summary.text_he}\n\n"
        f"Score it against the ground truth."
    )
    result = await judge_agent.run(prompt)
    return result.output
