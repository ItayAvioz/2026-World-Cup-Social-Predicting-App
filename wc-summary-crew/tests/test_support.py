"""Offline tests for the tool-using SUPPORT agent — no keys, no network, no real LLM.

Three layers, mirroring the mocking discipline in tests/test_crew.py + tests/test_api.py:

  1. search_rules() — pure-Python keyword scoring. Deterministic, asserted directly.
  2. The agent's TOOL WIRING — run the real agent under pydantic_ai's TestModel (offline;
     it auto-calls every registered tool), and assert from the message trace that both
     tools were actually offered/called and that a typed SupportAnswer comes back. This is
     the whole point of the file: proving it's a genuine tool-using agent, not a workflow.
  3. The /ask endpoint — `support.run` mocked, so we exercise routing + the shared-secret
     gate + generic-500 handling, exactly like test_api.py does for /summary.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel

from app import main, models
from app.agents import support


# ── 1. Pure-Python rule search (no LLM) ───────────────────────────────────────────
def test_search_rules_ranks_scoring_question_first():
    hits = support.search_rules("how many points for an exact scoreline")
    assert hits, "a scoring question must match at least one section"
    assert hits[0]["title"] == "Scoring System"
    # scores are sorted best-first and every returned hit has a positive score
    assert hits == sorted(hits, key=lambda h: h["score"], reverse=True)
    assert all(h["score"] > 0 for h in hits)


def test_search_rules_matches_the_right_topic():
    assert support.search_rules("when do champion picks lock")[0]["title"] in (
        "Key Deadlines",
        "Champion & Top Scorer Picks",
    )
    assert support.search_rules("invite a friend to my group")[0]["title"] == "Groups & Invites"
    assert support.search_rules("daily trivia question")[0]["title"] == "Daily Trivia"


def test_search_rules_is_deterministic_and_bounded():
    q = "how does the leaderboard ranking work"
    assert support.search_rules(q) == support.search_rules(q)          # deterministic
    assert len(support.search_rules(q, limit=2)) <= 2                   # respects limit


def test_search_rules_empty_or_stopwords_only_returns_nothing():
    assert support.search_rules("") == []
    assert support.search_rules("how do i ?") == []  # all stopwords/punctuation → no signal


# ── 2. get_group_standings tool — guarded fallbacks (no keys needed) ──────────────
class _FakeCtx:
    """Minimal stand-in for RunContext: the tool only reads ctx.deps.group_id."""

    def __init__(self, group_id):
        self.deps = support._Deps(group_id=group_id)


def test_standings_tool_says_unavailable_without_group():
    assert "unavailable" in support.get_group_standings(_FakeCtx(None)).lower()


def test_standings_tool_degrades_to_string_on_db_error(monkeypatch):
    def boom(group_id):
        raise RuntimeError("no service key in this env")

    monkeypatch.setattr(support.data, "fetch_group_standings", boom)
    out = support.get_group_standings(_FakeCtx("g1"))
    assert "unavailable" in out.lower()
    assert "no service key" not in out  # internal error text is NOT leaked into the reply


def test_standings_tool_formats_rows(monkeypatch):
    monkeypatch.setattr(
        support.data,
        "fetch_group_standings",
        lambda gid: [
            {"rank": 1, "username": "alice", "total_points": 40},
            {"rank": 2, "username": "bob", "total_points": 22},
        ],
    )
    out = support.get_group_standings(_FakeCtx("g1"))
    assert "#1 alice" in out and "40 pts" in out
    assert "#2 bob" in out


# ── 3. The agent is genuinely TOOL-USING (offline via TestModel) ──────────────────
def _tool_names_in_trace(result) -> set[str]:
    names: set[str] = set()
    for msg in result.all_messages():
        for part in getattr(msg, "parts", []):
            tn = getattr(part, "tool_name", None)
            if tn:
                names.add(tn)
    return names


def test_agent_calls_its_tools_and_returns_typed_answer(monkeypatch):
    # Keep the standings tool offline-safe regardless of env.
    monkeypatch.setattr(
        support.data, "fetch_group_standings", lambda gid: [{"rank": 1, "username": "x", "total_points": 5}]
    )

    async def go():
        # TestModel auto-calls every registered tool once — perfect for proving the wiring.
        with support.support_agent.override(model=TestModel()):
            return await support.support_agent.run(
                "how does scoring work and how am I doing?", deps=support._Deps(group_id="g1")
            )

    result = asyncio.run(go())
    assert isinstance(result.output, models.SupportAnswer)  # output_type enforced
    # Both real tools were offered to / called by the model — this is a real agent, not a pipeline.
    called = _tool_names_in_trace(result)
    assert "search_rules_tool" in called
    assert "get_group_standings" in called


def test_run_helper_returns_supportanswer():
    async def go():
        with support.support_agent.override(model=TestModel()):
            return await support.run("what are the rules?", group_id=None)

    ans = asyncio.run(go())
    assert isinstance(ans, models.SupportAnswer)
    assert isinstance(ans.used_tools, list)
    assert isinstance(ans.escalate, bool)


# ── 4. /ask endpoint — support.run mocked (routing + gate + error shape) ──────────
@pytest.fixture
def client():
    return TestClient(main.app)


def test_ask_ok_when_no_secret_configured(client, monkeypatch):
    monkeypatch.delenv("CREW_API_SECRET", raising=False)

    async def fake(question, group_id):
        # asserts the populated-used_tools path the task calls for
        return models.SupportAnswer(answer_he="ניקוד מדויק שווה 3 נקודות", used_tools=["search_rules"], escalate=False)

    monkeypatch.setattr(main.support, "run", fake)
    r = client.post("/ask", json={"question": "כמה נקודות על תוצאה מדויקת?", "group_id": None})
    assert r.status_code == 200
    body = r.json()
    assert body["answer_he"]
    assert body["used_tools"] == ["search_rules"]  # used_tools is populated
    assert body["escalate"] is False


def test_ask_gate_blocks_without_header_when_secret_set(client, monkeypatch):
    monkeypatch.setenv("CREW_API_SECRET", "topsecret")

    async def fake(question, group_id):
        return models.SupportAnswer(answer_he="ok", used_tools=[], escalate=False)

    monkeypatch.setattr(main.support, "run", fake)

    assert client.post("/ask", json={"question": "hi", "group_id": None}).status_code == 401
    assert (
        client.post("/ask", json={"question": "hi"}, headers={"x-crew-secret": "wrong"}).status_code == 401
    )
    ok = client.post("/ask", json={"question": "hi"}, headers={"x-crew-secret": "topsecret"})
    assert ok.status_code == 200


def test_ask_error_does_not_leak_internals(client, monkeypatch):
    monkeypatch.delenv("CREW_API_SECRET", raising=False)

    async def boom(question, group_id):
        raise RuntimeError("SECRET_INTERNAL_DETAIL_xyz")

    monkeypatch.setattr(main.support, "run", boom)
    r = client.post("/ask", json={"question": "hi", "group_id": None})
    assert r.status_code == 500
    assert "SECRET_INTERNAL_DETAIL_xyz" not in r.text
    assert "internal error" in r.json()["detail"]


def test_ask_rejects_malformed_body(client):
    # missing 'question' → 422 before the handler runs (group_id is optional)
    assert client.post("/ask", json={"group_id": "g1"}).status_code == 422
