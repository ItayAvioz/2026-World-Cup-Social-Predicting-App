"""The typed contracts that flow between the agents.

This file *is* the answer to the question Itay asked in the session and never got
on screen (transcript 15:33): "what's the difference between a Writer agent and the
prompt I write today?"

The difference is right here: every agent's OUTPUT is a typed object, and that object
is the next agent's typed INPUT. Nobody passes a blob of text around. The pipeline is:

    Stats(numbers)  →  Personality(one PlayerStyle per member)  →  Writer(Hebrew text)  →  Judge(score)

Because the handoffs are typed, each agent has ONE job and can be tuned, measured, and
swapped independently. That is the whole reason to reach for a framework instead of one
giant prompt.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ── Stats agent output (computed in pure Python — no LLM) ─────────────────────
class MemberStat(BaseModel):
    """One member's match-day line. Pure facts."""
    username: str
    today_pts: int
    today_exact: int
    total_pts: int
    group_rank: int
    global_rank: Optional[int] = None
    streak: int = 0
    is_inactive: bool = False
    all_auto: bool = False  # every prediction was auto-generated → roast differently
    predicted_scores: list[str] = Field(default_factory=list)  # this day's scorelines, e.g. ["2-1","0-0"]


class GameStat(BaseModel):
    """One finished game, with the group's angle on it."""
    match: str                       # "Brazil 2-1 Serbia"
    result: Literal["home_win", "draw", "away_win"]
    phase_label: str
    group_exact_n: int = 0           # how many in THIS group nailed the exact score
    group_upset: bool = False        # result defied the group's majority pick
    scorers: list[str] = Field(default_factory=list)


class StatsBlock(BaseModel):
    """Everything the language models need to know, as facts. Deterministic."""
    group_name: str
    date: str
    members: list[MemberStat]
    games: list[GameStat]
    leader: Optional[str] = None
    biggest_mover: Optional[str] = None       # most points today
    most_painful_miss: Optional[str] = None   # coldest active member today
    headline_fact: Optional[str] = None       # one ready-made sentence of material


# ── Personality agent output (LLM, structured) ────────────────────────────────
class PlayerStyle(BaseModel):
    """One tag per member — the Personality agent's job.

    THIS is the tiny class Itay explicitly asked to see (transcript 15:25) and the
    pacing never allowed. It's ~4 lines, and it's the entire point of PydanticAI:
    the model is *forced* to return this shape — no hand-written parse / validate / retry.
    """
    username: str
    style: Literal[
        "the_optimist",      # always predicts goals for everyone
        "the_contrarian",    # bets against the group
        "the_coward",        # 1-0, 0-0, safe scores
        "the_homer",         # backs the favourites every time
        "the_sniper",        # rare predictions, but deadly accurate
        "the_chaos_agent",   # wild scorelines, occasional genius
        "the_ghost",         # barely shows up / all auto-predicted
    ]
    evidence: str = Field(
        description="One concrete fact from the data that justifies the label "
                    "(e.g. 'predicted 3+ goals in 4 of 5 games')."
    )


# ── Writer agent output (LLM, Hebrew) ─────────────────────────────────────────
class CrewSummary(BaseModel):
    """The actual roast that ships to WhatsApp — in Hebrew. The Writer owns language."""
    text_he: str = Field(description="The full nightly roast, written in Hebrew.")


# ── Judge agent output (LLM — ported from Itay's existing EF judge) ───────────
class JudgeVerdict(BaseModel):
    """Same rubric idea Itay already built in the Judge PR, ported to the crew and
    repurposed: instead of picking 1-of-5 candidates, it scores the single Writer
    output and decides whether to send it back for another attempt."""
    accuracy: int = Field(ge=0, le=10, description="Are the facts right? No invented results.")
    humor: int = Field(ge=0, le=10, description="Is it actually funny / social?")
    hebrew_quality: int = Field(ge=0, le=10, description="Natural Hebrew, not translated-English.")
    structure: int = Field(ge=0, le=10, description="Tight, readable, WhatsApp-shaped.")
    reasoning: str = Field(description="One line: why this score; quote the weakest part.")

    @property
    def total(self) -> float:
        # Accuracy-heavy, same spirit as his 45/30/15/10 EF weighting.
        return round(
            self.accuracy * 0.40
            + self.humor * 0.30
            + self.hebrew_quality * 0.20
            + self.structure * 0.10,
            2,
        )


# ── Final bundle (audit-friendly, mirrors his ai_summaries + ai_judge_runs) ───
class CrewResult(BaseModel):
    group_id: str
    date: str
    summary_he: str
    judge: JudgeVerdict
    attempts: int
    styles: list[PlayerStyle]
    stats: StatsBlock
    model: str
    seed: int
    temperature: float
