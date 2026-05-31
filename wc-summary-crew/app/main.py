"""FastAPI service — literally "the script that starts with `app = FastAPI()`" from slide 5.

Supabase stays the data store and keeps running the EFs; this Python service is the engine
that orchestrates the crew. Run it:

    uvicorn app.main:app --reload

Then POST a (group_id, date) and get back the Hebrew roast + the judge verdict.
"""
from __future__ import annotations

import logging
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from . import models
from .crew import run_crew

logger = logging.getLogger("wc-summary-crew")

app = FastAPI(title="WC Summary Crew", version="0.1.0")


def _auth(x_crew_secret: str | None = Header(default=None)) -> None:
    """Optional shared-secret gate. This service holds a service-role key that bypasses RLS,
    so it can read every group's private predictions — don't expose it un-gated. The check is
    only enforced if CREW_API_SECRET is set (so local dev on 127.0.0.1 stays friction-free)."""
    expected = os.environ.get("CREW_API_SECRET")
    if expected and x_crew_secret != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


class SummaryRequest(BaseModel):
    group_id: str
    date: str  # "YYYY-MM-DD"


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/summary", response_model=models.CrewResult, dependencies=[Depends(_auth)])
async def summary(req: SummaryRequest) -> models.CrewResult:
    """Run the crew for one (group, date) and return the full audit-friendly result."""
    try:
        return await run_crew(req.group_id, req.date)
    except Exception as exc:
        # Log the real reason server-side; return a generic message (don't echo internals).
        logger.exception("crew run failed for group=%s date=%s", req.group_id, req.date)
        raise HTTPException(status_code=500, detail="internal error — see server logs") from exc
