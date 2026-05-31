"""Live, read-only access to Itay's Supabase.

The crew reads the SAME data the `nightly-summary` Edge Function reads — it calls the
exact same RPCs (`get_group_summary_data`, `get_leaderboard`). This is the "Supabase =
data, Python = engine" split from slide 5: we don't move the data, we just read it.

Read-only by discipline: only `.rpc(...)` reads and `.select(...)`. Never a write.
That's what makes this safe to run in *shadow mode* next to the live EF — the EF keeps
generating the real (English) summary; this service just reads the same rows alongside.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from supabase import Client, create_client

from . import config


def _client() -> Client:
    config.require("SUPABASE_URL", "SUPABASE_SERVICE_KEY")
    return create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)


def _match_day_window(date: str) -> tuple[str, str]:
    """The app's "match-day" runs 07:30 UTC → 07:30 UTC next day (Supabase migration M110),
    so a US late game past midnight stays in one summary. Returns ISO [start, end)."""
    start = datetime.fromisoformat(date).replace(tzinfo=timezone.utc) + timedelta(hours=7, minutes=30)
    return start.isoformat(), (start + timedelta(days=1)).isoformat()


def _enrich(sb: Client, group: dict, group_id: str, date: str) -> None:
    """get_group_summary_data omits two things the roast needs, so we read them the same
    read-only way the EF does:
      • the game `id` — the RPC's games[] carries only team names, but predictions carry
        `game_id`. Without the id the prediction↔game join silently never matches, so
        group_exact_n / group_upset would always be 0/False. We key the id by team pair within
        the match-day window (unique per day), exactly like the EF's separate `games` query.
      • the human group name — the RPC returns only group_id, else the roast is titled with a UUID.
    """
    start, end = _match_day_window(date)
    rows = (
        sb.table("games")
        .select("id, team_home, team_away")
        .gte("kick_off_time", start)
        .lt("kick_off_time", end)
        .execute()
        .data
        or []
    )
    id_by_pair = {(r["team_home"], r["team_away"]): r["id"] for r in rows}
    for g in group.get("games", []):
        g["id"] = id_by_pair.get((g.get("team_home"), g.get("team_away")))

    name_row = sb.table("groups").select("name").eq("id", group_id).single().execute().data
    group["group_name"] = name_row.get("name") if name_row else None


def fetch_group_day(group_id: str, date: str) -> dict:
    """Pull everything the crew needs for one (group, date).

    Returns a plain dict (raw DB shape) that the Stats agent turns into facts:
        {
          "group":        <get_group_summary_data result: members, predictions, games, leaderboard>,
          "global_rank":  {user_id: rank} for this group,
          "champ_picks":  [{user_id, team}],
          "tsr_picks":    [{user_id, player_name}],
          "group_id", "date"
        }
    """
    sb = _client()

    # 1) Members + their predictions + the day's games + the group leaderboard.
    #    Same RPC the EF uses to build its LLM payload (nightly-summary/index.ts).
    res = sb.rpc("get_group_summary_data", {"p_group_id": group_id, "p_date": date}).execute()
    group = res.data
    if not group:
        raise RuntimeError(
            f"get_group_summary_data returned nothing for group={group_id} date={date}. "
            f"Is the group_id right, and were there finished games that day?"
        )

    # 1b) Attach the game id (for the prediction↔game join) + the human group name — both
    #     omitted by the RPC. See _enrich.
    _enrich(sb, group, group_id, date)

    # 2) Global rank per (user × group) — canonical leaderboard (EF v35 switched to this
    #    RPC to dodge the JS 1000-row cap; we read the same source of truth).
    lb = sb.rpc("get_leaderboard").execute().data or []
    global_rank = {
        row["user_id"]: row["rank"]
        for row in lb
        if row.get("group_id") == group_id and row.get("user_id")
    }

    # 3) This group's champion + top-scorer picks (per-group, like the EF).
    champ = (
        sb.table("champion_pick").select("user_id, team").eq("group_id", group_id).execute().data
        or []
    )
    tsr = (
        sb.table("top_scorer_pick")
        .select("user_id, player_name")
        .eq("group_id", group_id)
        .execute()
        .data
        or []
    )

    return {
        "group": group,
        "global_rank": global_rank,
        "champ_picks": champ,
        "tsr_picks": tsr,
        "group_id": group_id,
        "date": date,
    }


def fetch_ef_summary(group_id: str, date: str) -> str | None:
    """The EF's own summary for the same day — so shadow mode can show them side by side."""
    sb = _client()
    rows = (
        sb.table("ai_summaries")
        .select("content")
        .eq("group_id", group_id)
        .eq("date", date)
        .limit(1)
        .execute()
        .data
    )
    return rows[0]["content"] if rows else None


def list_recent_summaries(limit: int = 10) -> list[dict]:
    """Convenience: recent (group_id, date) pairs that already have an EF summary —
    handy targets to point the crew at when you're poking around."""
    sb = _client()
    return (
        sb.table("ai_summaries")
        .select("group_id, date")
        .order("date", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )
