"""Unit tests for the typed contracts (app/models.py) — pure, no keys, no network."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app import models


def test_judge_total_weighting():
    # accuracy 0.40, humor 0.30, hebrew 0.20, structure 0.10
    v = models.JudgeVerdict(accuracy=10, humor=0, hebrew_quality=0, structure=0, reasoning="x")
    assert v.total == 4.0
    v2 = models.JudgeVerdict(accuracy=8, humor=6, hebrew_quality=7, structure=5, reasoning="x")
    assert v2.total == pytest.approx(6.9)  # 3.2 + 1.8 + 1.4 + 0.5


def test_judge_score_bounds_enforced():
    with pytest.raises(ValidationError):
        models.JudgeVerdict(accuracy=11, humor=0, hebrew_quality=0, structure=0, reasoning="x")
    with pytest.raises(ValidationError):
        models.JudgeVerdict(accuracy=-1, humor=0, hebrew_quality=0, structure=0, reasoning="x")


def test_playerstyle_rejects_unknown_style():
    models.PlayerStyle(username="a", style="the_sniper", evidence="rare but exact")  # valid
    with pytest.raises(ValidationError):
        models.PlayerStyle(username="a", style="the_wizard", evidence="nope")  # not in the Literal set


def test_memberstat_defaults():
    m = models.MemberStat(username="a", today_pts=0, today_exact=0, total_pts=0, group_rank=1)
    assert m.predicted_scores == []
    assert m.global_rank is None
    assert m.all_auto is False
    assert m.is_inactive is False
