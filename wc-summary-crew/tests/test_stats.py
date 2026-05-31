"""Offline unit test for the Stats agent — no keys, no network, no LLM.

Runnable two ways:
    python -m tests.test_stats      # standalone (no pytest needed)
    pytest                          # if you install pytest

The fixture mirrors what `stats.run` actually RECEIVES: the `get_group_summary_data` output
*after* `data.py` has attached each game's `id` (by team pair, see data._enrich) and the real
group name. The raw RPC itself returns games with no `id` and no group name — data.py injects
both — so the `"id"` keys and `"group_name"` below represent the post-injection shape the Stats
agent consumes, not the raw RPC payload.
"""
from __future__ import annotations

import copy

from app.agents import stats

GROUP_DAY = {
    "group_id": "g1",
    "date": "2026-06-15",
    "global_rank": {"u1": 3, "u2": 7, "u3": 12},
    "champ_picks": [],
    "tsr_picks": [],
    "group": {
        "group_name": "The Testers",
        "members": [
            {
                "user_id": "u1",
                "username": "alice",
                "current_streak": 2,
                "predictions": [
                    {"game_id": "m1", "pred_home": 2, "pred_away": 1, "points": 3, "is_auto": False},
                    {"game_id": "m2", "pred_home": 0, "pred_away": 0, "points": 1, "is_auto": False},
                ],
            },
            {
                "user_id": "u2",
                "username": "bob",
                "current_streak": 0,
                "predictions": [
                    {"game_id": "m1", "pred_home": 1, "pred_away": 1, "points": 0, "is_auto": False},
                    {"game_id": "m2", "pred_home": 3, "pred_away": 2, "points": 0, "is_auto": False},
                ],
            },
            {
                "user_id": "u3",
                "username": "carol",
                "is_inactive": True,
                "predictions": [
                    {"game_id": "m1", "pred_home": 0, "pred_away": 3, "points": 0, "is_auto": True},
                    {"game_id": "m2", "pred_home": 1, "pred_away": 1, "points": 1, "is_auto": True},
                ],
            },
        ],
        "games": [
            {"id": "m1", "team_home": "Brazil", "team_away": "Serbia", "score_home": 2, "score_away": 1, "phase": "group"},
            {"id": "m2", "team_home": "Spain", "team_away": "Japan", "score_home": 0, "score_away": 0, "phase": "group"},
        ],
        "leaderboard": [
            {"group_rank": 1, "username": "alice", "total_points": 40, "exact_scores": 5},
            {"group_rank": 2, "username": "bob", "total_points": 22, "exact_scores": 2},
            {"group_rank": 3, "username": "carol", "total_points": 15, "exact_scores": 1},
        ],
    },
}


def test_member_aggregates():
    block = stats.run(GROUP_DAY)
    by = {m.username: m for m in block.members}

    # alice: 3 + 1 = 4 today, one exact (the 3-pointer)
    assert by["alice"].today_pts == 4
    assert by["alice"].today_exact == 1
    assert by["alice"].global_rank == 3
    assert by["alice"].predicted_scores == ["2-1", "0-0"]

    # bob: cold night
    assert by["bob"].today_pts == 0
    assert by["bob"].today_exact == 0

    # carol: inactive + everything auto
    assert by["carol"].is_inactive is True
    assert by["carol"].all_auto is True
    assert by["carol"].today_pts == 1


def test_headline_derivations():
    block = stats.run(GROUP_DAY)
    assert block.leader == "alice"               # rank 1
    assert block.biggest_mover == "alice"        # most points today among active
    assert block.most_painful_miss == "bob"      # coldest active player
    assert block.group_name == "The Testers"


def test_game_stats():
    block = stats.run(GROUP_DAY)
    g = {gs.match: gs for gs in block.games}

    brazil = g["Brazil 2-1 Serbia"]
    assert brazil.result == "home_win"
    assert brazil.group_exact_n == 1             # only alice nailed 2-1
    assert brazil.group_upset is False           # group split 1/1/1 → home majority == result

    spain = g["Spain 0-0 Japan"]
    assert spain.result == "draw"
    assert spain.group_exact_n == 1              # only alice predicted 0-0


def test_null_prediction_does_not_crash():
    # A member can have a null-scoreline prediction on a finished game (stored before they
    # entered scores). That must not crash the stage, and must not count toward the majority.
    gd = copy.deepcopy(GROUP_DAY)
    gd["group"]["members"][1]["predictions"][0] = {
        "game_id": "m1", "pred_home": None, "pred_away": None, "points": 0, "is_auto": False,
    }
    block = stats.run(gd)  # must not raise
    brazil = next(gs for gs in block.games if gs.match == "Brazil 2-1 Serbia")
    assert brazil.group_exact_n == 1  # alice still nailed 2-1; bob's null pred is ignored


def _run_all() -> int:
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  PASS  {name}")
            except AssertionError as e:
                failures += 1
                print(f"  FAIL  {name}: {e}")
    print(f"\n{'ALL GREEN' if not failures else f'{failures} FAILURE(S)'}")
    return failures


if __name__ == "__main__":
    import sys

    sys.exit(1 if _run_all() else 0)
