"""Stats agent — the first stage of the crew.

Deliberately PURE PYTHON, no LLM. The lesson here (transcript 15:28): in a crew, not
every "agent" is a language model. Itay already does exactly this in the EF — compute
the facts deterministically first, *then* hand them to the models. We're just naming
that step and giving it a typed output (`StatsBlock`) so the next agent can rely on it.

Input:  the raw dict from `data.fetch_group_day` (or a fixture of the same shape).
Output: a `StatsBlock` of clean facts — no flavour, no opinions.
"""
from __future__ import annotations

from .. import models


def _outcome(home: int, away: int) -> str:
    return "home_win" if home > away else "draw" if home == away else "away_win"


def run(group_day: dict) -> models.StatsBlock:
    group = group_day["group"]
    global_rank: dict = group_day.get("global_rank", {})
    members_raw: list[dict] = group.get("members") or []
    games_raw: list[dict] = group.get("games") or []
    lb_raw: list[dict] = group.get("leaderboard") or []

    # ── per-member today line (points / exacts / auto) keyed by username ──
    today: dict[str, dict] = {}
    for m in members_raw:
        preds = m.get("predictions") or []
        pts = sum((p.get("points") or 0) for p in preds)
        exact = sum(1 for p in preds if (p.get("points") or 0) == 3)
        all_auto = len(preds) > 0 and all(p.get("is_auto") for p in preds)
        scores = [
            f"{p.get('pred_home')}-{p.get('pred_away')}"
            for p in preds
            if p.get("pred_home") is not None and p.get("pred_away") is not None
        ]
        today[m["username"]] = {
            "user_id": m.get("user_id"),
            "today_pts": pts,
            "today_exact": exact,
            "streak": m.get("current_streak") or 0,
            "is_inactive": bool(m.get("is_inactive", False)),
            "all_auto": all_auto,
            "predicted_scores": scores,
        }

    # ── merge with the leaderboard (totals + ranks) into MemberStat rows ──
    members: list[models.MemberStat] = []
    for row in lb_raw:
        u = row["username"]
        t = today.get(u, {})
        uid = t.get("user_id")
        members.append(
            models.MemberStat(
                username=u,
                today_pts=t.get("today_pts", 0),
                today_exact=t.get("today_exact", 0),
                total_pts=row.get("total_points", 0),
                group_rank=row.get("group_rank", 0),
                global_rank=global_rank.get(uid) if uid else None,
                streak=t.get("streak", 0),
                is_inactive=t.get("is_inactive", False),
                all_auto=t.get("all_auto", False),
                predicted_scores=t.get("predicted_scores", []),
            )
        )

    # ── games: result + group exacts / upsets ──
    # Predictions carry game_id; data.py injects each game's id (the RPC omits it) so we can
    # join on it. If an id is still missing we degrade gracefully — result only, no group split.
    game_by_id = {
        g["id"]: g
        for g in games_raw
        if g.get("id") and g.get("score_home") is not None and g.get("score_away") is not None
    }
    games: list[models.GameStat] = []
    for g in games_raw:
        if g.get("score_home") is None or g.get("score_away") is None:
            continue  # not finished (need both halves of the score)
        sh, sa = g["score_home"], g["score_away"]
        result = _outcome(sh, sa)

        group_exact_n = 0
        group_upset = False
        gid = g.get("id")
        if gid and gid in game_by_id:
            home = draw = away = 0
            for m in members_raw:
                pred = next((p for p in (m.get("predictions") or []) if p.get("game_id") == gid), None)
                if not pred:
                    continue
                ph, pa = pred.get("pred_home"), pred.get("pred_away")
                if ph is None or pa is None:
                    continue  # null prediction → no outcome, doesn't count toward the majority
                if ph == sh and pa == sa:
                    group_exact_n += 1
                d = _outcome(ph, pa)
                home += d == "home_win"
                draw += d == "draw"
                away += d == "away_win"
            if home or draw or away:
                majority = "home_win" if home >= draw and home >= away else "away_win" if away > draw else "draw"
                group_upset = result != majority

        games.append(
            models.GameStat(
                match=f"{g['team_home']} {sh}-{sa} {g['team_away']}",
                result=result,
                phase_label=str(g.get("phase", "group")).replace("_", " ").title(),
                group_exact_n=group_exact_n,
                group_upset=group_upset,
            )
        )

    # ── headline derivations (roast fuel) ──
    active = [m for m in members if not m.is_inactive]
    leader = min(members, key=lambda m: m.group_rank).username if members else None
    biggest_mover = max(active, key=lambda m: m.today_pts).username if active else None
    # coldest active player today (tie → the better-ranked one, i.e. "the leader who flopped").
    # Exclude the night's winner so one person is never labelled both mover AND flop.
    cold_pool = [m for m in active if m.username != biggest_mover] or active
    most_painful_miss = (
        min(cold_pool, key=lambda m: (m.today_pts, m.group_rank)).username if active else None
    )

    headline = None
    if leader:
        bits = [f"{leader} leads the table"]
        if biggest_mover:
            mv = next(m for m in members if m.username == biggest_mover)
            bits.append(f"{biggest_mover} won the night (+{mv.today_pts})")
        if most_painful_miss and most_painful_miss != biggest_mover:
            fl = next(m for m in members if m.username == most_painful_miss)
            bits.append(f"{most_painful_miss} went cold ({fl.today_pts} today)")
        headline = "; ".join(bits) + "."

    return models.StatsBlock(
        group_name=group.get("group_name") or group.get("name") or group_day["group_id"],
        date=group_day["date"],
        members=members,
        games=games,
        leader=leader,
        biggest_mover=biggest_mover,
        most_painful_miss=most_painful_miss,
        headline_fact=headline,
    )
