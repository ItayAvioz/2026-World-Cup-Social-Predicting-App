"""End-to-end: the REAL crew against live Supabase + OpenAI.

Opt-in only — it costs OpenAI tokens and needs live keys. Run with:

    RUN_E2E=1 SUPABASE_SERVICE_KEY=... OPENAI_API_KEY=... \
    E2E_GROUP_ID=<uuid> E2E_DATE=2026-06-15 \
    pytest tests/test_e2e.py -v

Otherwise it's skipped, so the default `pytest` run stays free and offline.
"""
from __future__ import annotations

import asyncio
import os

import pytest

pytestmark = pytest.mark.skipif(
    not (
        os.environ.get("RUN_E2E")
        and os.environ.get("SUPABASE_SERVICE_KEY")
        and os.environ.get("OPENAI_API_KEY")
        and os.environ.get("E2E_GROUP_ID")
        and os.environ.get("E2E_DATE")
    ),
    reason="set RUN_E2E=1 + keys + E2E_GROUP_ID + E2E_DATE to run the live e2e test",
)


def _has_hebrew(text: str) -> bool:
    return any("֐" <= c <= "׿" for c in text)


def test_full_crew_live():
    from app.crew import run_crew

    result = asyncio.run(run_crew(os.environ["E2E_GROUP_ID"], os.environ["E2E_DATE"]))

    assert result.summary_he.strip(), "crew produced empty text"
    assert _has_hebrew(result.summary_he), "summary is not in Hebrew"
    assert 0 <= result.judge.total <= 10
    assert result.attempts >= 1
    assert result.stats.members, "stats found no members"
