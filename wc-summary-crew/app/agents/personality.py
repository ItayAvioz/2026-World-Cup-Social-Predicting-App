"""Personality agent — the WORKED EXAMPLE of the whole session.

Read this file top to bottom: it's the concrete PydanticAI example Itay asked for and
never saw on screen. Three things to notice:

  1.  The agent is declared ONCE (at import), not rebuilt per call.
  2.  `output_type=models.PlayerStyle` *forces* the model to return that exact shape.
      No `JSON.parse`, no "please return valid JSON", no manual retry — the framework
      does the tool-call + schema-validation + re-ask loop for you. THIS is the thing a
      framework buys you over a raw prompt.
  3.  `seed` + `temperature` come straight from config — same reproducibility instinct
      as Itay's EF (seed=42, low temp → same input, same tag).

Use this as the pattern when you write the Writer (see app/agents/writer.py).
"""
from __future__ import annotations

import asyncio

from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings

from .. import config, models

_SYSTEM_PROMPT = (
    "You label a World Cup prediction player's STYLE from one match-day of data.\n"
    "Choose exactly one style from the allowed set and justify it with ONE concrete fact\n"
    "taken from the data you are given. This feeds a comedic roast, so be sharp — but the\n"
    "evidence must be literally true (no invented predictions or results).\n"
    "Guidance: lots of high-scoring predictions → the_optimist; safe 1-0 / 0-0 scores →\n"
    "the_coward; results that defied the group → the_contrarian; rare but exact →\n"
    "the_sniper; everything auto-generated or absent → the_ghost."
)

# One agent instance, reused for every member.
personality_agent = Agent(
    # 'openai-chat:' pins the Chat Completions API explicitly (same as Itay's EF). The bare
    # 'openai:' alias is reserved for the Responses API and may change defaults across
    # pydantic-ai majors — pinning the prefix keeps this worked example stable.
    f"openai-chat:{config.CREW_MODEL}",
    output_type=models.PlayerStyle,
    model_settings=ModelSettings(temperature=config.TEMPERATURE, seed=config.SEED),
    system_prompt=_SYSTEM_PROMPT,
)


def _member_brief(m: models.MemberStat) -> str:
    """Turn one member's facts into the prompt the model sees. Plain, factual material."""
    scores = ", ".join(m.predicted_scores) if m.predicted_scores else "no manual predictions"
    return (
        f"Player: {m.username}\n"
        f"This match-day predicted scorelines: {scores}\n"
        f"Points today: {m.today_pts} (exact hits: {m.today_exact})\n"
        f"Season total: {m.total_pts} pts, group rank #{m.group_rank}, streak {m.streak}\n"
        f"All predictions auto-generated: {'yes' if m.all_auto else 'no'}\n"
        f"Inactive: {'yes' if m.is_inactive else 'no'}\n"
        f"Return their PlayerStyle."
    )


async def tag_member(m: models.MemberStat) -> models.PlayerStyle:
    result = await personality_agent.run(_member_brief(m))
    return result.output  # typed PlayerStyle — guaranteed by output_type


async def run(stats: models.StatsBlock) -> list[models.PlayerStyle]:
    """Tag every member — concurrently, the same shape as Itay's `Promise.all` over the
    5 EF candidates. Inactive members are tagged too (the Writer decides whether to spare
    or roast them)."""
    if not stats.members:
        return []
    return list(await asyncio.gather(*(tag_member(m) for m in stats.members)))
