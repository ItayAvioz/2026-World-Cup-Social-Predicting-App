"""Integration test for the crew pipeline + the Writer⇄Judge retry loop.

The LLM agents and the DB read are MOCKED (monkeypatched), so this runs offline with no
keys and no token cost — it tests the *orchestration logic*, which is the part most likely
to break: does it ship on a good first attempt, retry on a low score, and always keep the
best attempt?
"""
from __future__ import annotations

import asyncio

import pytest

from app import config, crew, models

# Minimal (group, day) of the shape stats.run() expects — one active member, one finished game.
FAKE_GROUP_DAY = {
    "group_id": "g1",
    "date": "2026-06-15",
    "global_rank": {"u1": 1},
    "champ_picks": [],
    "tsr_picks": [],
    "group": {
        "group_name": "Test FC",
        "members": [
            {
                "user_id": "u1",
                "username": "alice",
                "current_streak": 1,
                "predictions": [
                    {"game_id": "m1", "pred_home": 2, "pred_away": 1, "points": 3, "is_auto": False}
                ],
            }
        ],
        "games": [
            {"id": "m1", "team_home": "A", "team_away": "B", "score_home": 2, "score_away": 1, "phase": "group"}
        ],
        "leaderboard": [{"group_rank": 1, "username": "alice", "total_points": 10, "exact_scores": 2}],
    },
}


def _verdict(score: int) -> models.JudgeVerdict:
    # equal weights → JudgeVerdict.total == score
    return models.JudgeVerdict(
        accuracy=score, humor=score, hebrew_quality=score, structure=score, reasoning=f"score {score}"
    )


@pytest.fixture
def patched(monkeypatch):
    """Mock the DB read + the Personality LLM. Stats runs for real (pure Python)."""
    monkeypatch.setattr(crew.data, "fetch_group_day", lambda gid, date: FAKE_GROUP_DAY)

    async def fake_personality(stats):
        return [
            models.PlayerStyle(username=m.username, style="the_optimist", evidence="predicted goals")
            for m in stats.members
        ]

    monkeypatch.setattr(crew.personality, "run", fake_personality)
    return monkeypatch


def test_ships_on_first_good_attempt(patched):
    async def writer(stats, styles, judge_feedback=None):
        return models.CrewSummary(text_he="גרסה טובה")

    async def judge(stats, summary):
        return _verdict(9)  # ≥ JUDGE_MIN_TOTAL → no retry

    patched.setattr(crew.writer, "run", writer)
    patched.setattr(crew.judge, "run", judge)

    result = asyncio.run(crew.run_crew("g1", "2026-06-15"))
    assert result.attempts == 1
    assert result.summary_he == "גרסה טובה"
    assert result.judge.total >= config.JUDGE_MIN_TOTAL
    assert result.stats.group_name == "Test FC"  # real name flowed through


def test_retries_then_keeps_the_better_attempt(patched):
    texts = iter(["גרסה חלשה", "גרסה מצוינת"])
    scores = iter([3, 9])  # first attempt low → retry; second high → ship

    async def writer(stats, styles, judge_feedback=None):
        return models.CrewSummary(text_he=next(texts))

    async def judge(stats, summary):
        return _verdict(next(scores))

    patched.setattr(crew.writer, "run", writer)
    patched.setattr(crew.judge, "run", judge)

    result = asyncio.run(crew.run_crew("g1", "2026-06-15"))
    assert result.attempts == 2
    assert result.summary_he == "גרסה מצוינת"


def test_all_low_stops_at_max_and_keeps_best(patched):
    # scores per attempt: 2, 5, 3 — never crosses the threshold, best is attempt #2 (5).
    texts = iter([f"v{i}" for i in range(10)])
    scores = iter([2, 5, 3] + [1] * 10)

    async def writer(stats, styles, judge_feedback=None):
        return models.CrewSummary(text_he=next(texts))

    async def judge(stats, summary):
        return _verdict(next(scores))

    patched.setattr(crew.writer, "run", writer)
    patched.setattr(crew.judge, "run", judge)

    result = asyncio.run(crew.run_crew("g1", "2026-06-15"))
    assert result.attempts == config.MAX_WRITER_ATTEMPTS
    assert result.summary_he == "v1"  # attempt #2 had the top score (5)
    assert result.judge.total == 5
