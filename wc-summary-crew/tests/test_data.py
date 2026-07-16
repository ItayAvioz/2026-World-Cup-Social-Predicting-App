"""Data layer (app/data.py).

  • _match_day_window  — pure function, tested offline.
  • fetch_group_day    — integration; skipped unless a live key + target are provided.
"""
from __future__ import annotations

import os

import pytest

from app import data


def test_match_day_window():
    """The 07:30-UTC match-day boundary (Supabase M110) → [start, end) one day apart."""
    start, end = data._match_day_window("2026-06-15")
    assert start == "2026-06-15T07:30:00+00:00"
    assert end == "2026-06-16T07:30:00+00:00"


@pytest.mark.skipif(
    not (os.environ.get("SUPABASE_SERVICE_KEY") and os.environ.get("E2E_GROUP_ID") and os.environ.get("E2E_DATE")),
    reason="integration: set SUPABASE_SERVICE_KEY + E2E_GROUP_ID + E2E_DATE to run against live Supabase",
)
def test_fetch_group_day_enriches_live():
    """Against real Supabase: the result has the shape Stats expects, and _enrich attached
    the game id + the human group name that the RPC itself omits."""
    gd = data.fetch_group_day(os.environ["E2E_GROUP_ID"], os.environ["E2E_DATE"])
    assert "group" in gd and "global_rank" in gd
    assert gd["group"].get("group_name")  # _enrich attached the real name (not a UUID)
    for g in gd["group"].get("games", []):
        assert "id" in g  # _enrich attached the game id used for the prediction join
