"""Integration test for the FastAPI layer (app/main.py).

`run_crew` is mocked, so this exercises the HTTP surface — routing, the request schema, the
optional shared-secret gate, and error handling — with no LLM and no DB.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main, models


def _fake_result() -> models.CrewResult:
    return models.CrewResult(
        group_id="g1",
        date="2026-06-15",
        summary_he="שלום עולם",
        judge=models.JudgeVerdict(accuracy=8, humor=8, hebrew_quality=8, structure=8, reasoning="ok"),
        attempts=1,
        styles=[],
        stats=models.StatsBlock(group_name="Test FC", date="2026-06-15", members=[], games=[]),
        model="gpt-4o-mini",
        seed=42,
        temperature=0.6,
    )


@pytest.fixture
def client():
    return TestClient(main.app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_summary_ok_when_no_secret_configured(client, monkeypatch):
    monkeypatch.delenv("CREW_API_SECRET", raising=False)

    async def fake(group_id, date):
        return _fake_result()

    monkeypatch.setattr(main, "run_crew", fake)
    r = client.post("/summary", json={"group_id": "g1", "date": "2026-06-15"})
    assert r.status_code == 200
    assert r.json()["summary_he"] == "שלום עולם"


def test_summary_gate_blocks_without_header_when_secret_set(client, monkeypatch):
    monkeypatch.setenv("CREW_API_SECRET", "topsecret")

    async def fake(group_id, date):
        return _fake_result()

    monkeypatch.setattr(main, "run_crew", fake)

    # missing/ wrong header → 401
    assert client.post("/summary", json={"group_id": "g1", "date": "2026-06-15"}).status_code == 401
    assert (
        client.post(
            "/summary", json={"group_id": "g1", "date": "2026-06-15"}, headers={"x-crew-secret": "wrong"}
        ).status_code
        == 401
    )
    # correct header → 200
    ok = client.post(
        "/summary", json={"group_id": "g1", "date": "2026-06-15"}, headers={"x-crew-secret": "topsecret"}
    )
    assert ok.status_code == 200


def test_summary_error_does_not_leak_internals(client, monkeypatch):
    monkeypatch.delenv("CREW_API_SECRET", raising=False)

    async def boom(group_id, date):
        raise RuntimeError("SECRET_INTERNAL_DETAIL_xyz")

    monkeypatch.setattr(main, "run_crew", boom)
    r = client.post("/summary", json={"group_id": "g1", "date": "2026-06-15"})
    assert r.status_code == 500
    assert "SECRET_INTERNAL_DETAIL_xyz" not in r.text  # raw exception text not echoed
    assert "internal error" in r.json()["detail"]


def test_summary_rejects_malformed_body(client):
    # missing 'date' → FastAPI/Pydantic 422 before the handler runs
    assert client.post("/summary", json={"group_id": "g1"}).status_code == 422
