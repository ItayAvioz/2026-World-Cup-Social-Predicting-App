"""Support agent — the COUNTER-EXAMPLE to the crew, and the whole lesson in one file.

The crew (Stats → Personality → Writer → Judge, see app/crew.py) is a fixed WORKFLOW:
the order is hard-coded in Python, every stage runs every time, and no stage decides what
runs next. PydanticAI is used there only for structured output (output_type=...).

THIS is a real AGENT. It is handed two tools and, on each step, the *LLM itself* decides
whether to call search_rules, get_group_standings, both, or neither — then writes the
answer. We never hand-dispatch the tools; the model does (the agentic loop). That single
difference — fixed pipeline vs. model-chosen tool calls — is the point of the exercise.

Two tools the model chooses between:
  • search_rules(query)         — pure-Python keyword search over the in-app "How to Play"
                                  rules (no LLM, no embeddings, no new deps).
  • get_group_standings(group_id) — reads the real live leaderboard via app/data.py.

Output is models.SupportAnswer (answer_he / used_tools / escalate) — same output_type
idiom the crew's stages use, so structured output and tool-using compose cleanly.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from pydantic_ai import Agent, RunContext

from .. import config, data
from ..models import SupportAnswer

# ── The "How to Play" corpus (verbatim from the in-app HowToPlay modal). ──────────
# Plain Python data — the search tool scores over this. Kept here so the agent has zero
# network/LLM cost to answer a rules question.
HOWTOPLAY: list[dict[str, str]] = [
    {
        "title": "Scoring System",
        "text": "Exact scoreline = 3 pts, correct outcome (win/draw/loss) = 1 pt, "
                "correct champion = 10 pts, correct top scorer = 10 pts, and each daily "
                "trivia = 1 pt. Points are not cumulative: an exact score earns 3 pts "
                "total, inclusive of the outcome.",
    },
    {
        "title": "Predictions & Auto-Predict",
        "text": "Predict a scoreline for each game per group, up until that game's kickoff. "
                "If you miss a prediction, the app auto-predicts a random score for you, and "
                "auto-predictions earn points the same way as manual ones (and luck can still "
                "pay off).",
    },
    {
        "title": "Champion & Top Scorer Picks",
        "text": "Pick one champion (from all 48 qualified teams) and one top scorer (from the "
                "full tournament squads), independently per group. Each is worth 10 pts if "
                "correct, and points are awarded the moment the Final result is confirmed. "
                "Live odds and goal tallies are shown to guide your picks.",
    },
    {
        "title": "Key Deadlines",
        "text": "Champion and top scorer picks lock forever at June 11, 22:00 IDT, when the "
                "tournament begins; miss it and the app auto-assigns at random. Each game's "
                "prediction window closes at that game's kickoff. The AI roast drops every "
                "night, and all banked trivia/champion/top-scorer points activate at once on "
                "July 19 (the Final).",
    },
    {
        "title": "Groups & Invites",
        "text": "Groups are private and invitation-only, each with its own independent "
                "leaderboard, picks, predictions, and nightly AI summary. Max 3 groups per "
                "user and max 10 members per group. Create a group in one tap to get an invite "
                "link (opens WhatsApp on mobile, copies to clipboard on desktop); join via a "
                "friend's link or by pasting the code, and you're in automatically.",
    },
    {
        "title": "Prediction Reveal & Wisdom Stats",
        "text": "Group members' predictions stay hidden until kickoff, then all of them "
                "(including auto-generated ones) are revealed. After kickoff you also get "
                "Group Wisdom and Global Wisdom: outcome split, goals range, and most popular "
                "scoreline, which reveal the contrarian who went against the crowd.",
    },
    {
        "title": "AI Feed (Nightly Roast)",
        "text": "Every night after the final whistle, the AI generates one funny roast per "
                "group for groups with 3 or more members, calling out who was a genius and who "
                "got lucky. It also shows Day Standings (who won the day) and Total Standings "
                "(the full group leaderboard with global rank), and you can react with emojis "
                "or share to the group chat.",
    },
    {
        "title": "Daily Trivia",
        "text": "One football trivia question drops every day at 22:00 IDT starting June 11. "
                "You get 40 seconds and one shot (no retries); a correct answer is 1 point, "
                "while a wrong answer or timeout is 0. Trivia points are banked silently and "
                "don't show on the leaderboard until the Final result is confirmed, when they "
                "all land at once.",
    },
    {
        "title": "Leaderboards",
        "text": "The Dashboard always shows the global leaderboard, ranking every player with "
                "rank, group, champion pick flag, top scorer pick, and total points (your row "
                "is highlighted). Each group also has its own leaderboard showing group rank "
                "and global rank side by side. You're scored independently per group, so you "
                "could be last in one and first in another.",
    },
]

_WORD = re.compile(r"[a-z0-9]+")
# Common words that carry no topic signal — dropped before scoring so "how many points"
# doesn't match every section via "how/many".
_STOP = {
    "the", "a", "an", "is", "are", "do", "does", "how", "what", "when", "where", "who",
    "i", "my", "me", "you", "your", "to", "of", "for", "in", "on", "and", "or", "can",
    "it", "this", "that", "with", "if", "be", "get", "many", "much", "they", "them",
}


def _tokens(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1}


def search_rules(query: str, *, limit: int = 3) -> list[dict]:
    """Pure-Python ranking of the HOWTOPLAY sections against `query`.

    Scoring is plain set-overlap of significant tokens (title weighted 2×, body 1×) — no
    LLM, no embeddings, no extra deps. Deterministic, so it's unit-testable on its own.
    Returns up to `limit` sections sorted best-first: [{title, text, score}].
    """
    q = _tokens(query)
    if not q:
        return []
    scored: list[dict] = []
    for sec in HOWTOPLAY:
        title_hits = len(q & _tokens(sec["title"]))
        body_hits = len(q & _tokens(sec["text"]))
        score = title_hits * 2 + body_hits
        if score:
            scored.append({"title": sec["title"], "text": sec["text"], "score": score})
    scored.sort(key=lambda s: s["score"], reverse=True)
    return scored[:limit]


# ── The agent — declared ONCE at import (same as the crew's stages). ──────────────
_SYSTEM_PROMPT = (
    "You are the support assistant for the WorldCup 2026 social predictions app. "
    "Answer the user's question in natural, friendly Hebrew.\n"
    "You have TWO tools and you decide which to use:\n"
    "  • search_rules(query): look up how the app works (scoring, deadlines, picks, "
    "groups, trivia, leaderboards). Use it for ANY 'how does X work / how many points / "
    "when does Y lock' question, and answer ONLY from what it returns — never invent a rule.\n"
    "  • get_group_standings(group_id): fetch the live leaderboard for the user's group. "
    "Use it only when they ask about current standings / who is winning / their rank, and "
    "only if a group_id is available.\n"
    "Call a tool when it helps; you may call both, or neither for a trivial reply. If the "
    "question is unrelated to the app's rules or standings (account issues, payments, bugs), "
    "set escalate=true and tell them an admin will help. List every tool you actually called "
    "in used_tools."
)


# What each run carries: the user's group_id (may be None). Read inside tools as ctx.deps.
# A plain @dataclass is the idiomatic deps type (facts.pydai) — no extra dependency.
@dataclass
class _Deps:
    group_id: str | None


support_agent = Agent(
    # Same 'openai-chat:' prefix the crew pins (Chat Completions, not the Responses API).
    f"openai-chat:{config.CREW_MODEL}",
    deps_type=_Deps,
    output_type=SupportAnswer,
    system_prompt=_SYSTEM_PROMPT,
    # Don't build the OpenAI client at import time — lets this module (and its offline tests,
    # which use TestModel via .override()) import with NO OPENAI_API_KEY. The real key is only
    # needed when an actual run hits OpenAI.
    defer_model_check=True,
)


@support_agent.tool_plain
def search_rules_tool(query: str) -> list[dict]:
    """Search the app's "How to Play" rules for the given query.

    Use this to answer how the app works: scoring/points, predictions & auto-predict,
    champion & top-scorer picks, deadlines, groups & invites, prediction reveal, the
    nightly AI roast, daily trivia, and leaderboards. Returns the most relevant rule
    sections (title + text). Answer only from these results.

    Args:
        query: The user's question or keywords, e.g. "how many points for exact score".
    """
    return search_rules(query)


@support_agent.tool
def get_group_standings(ctx: RunContext[_Deps]) -> str:
    """Get the live leaderboard for the user's current group.

    Use this only when the user asks about current standings, who is winning, or their
    own rank — and only when a group is known. Returns a short human-readable standings
    list, or a friendly 'unavailable' line if there is no group or the data can't be read.
    """
    group_id = ctx.deps.group_id
    if not group_id:
        return "Standings unavailable: no group was provided with this question."
    try:
        rows = data.fetch_group_standings(group_id)
    except Exception:
        # Missing keys, RLS, network — never crash the agent over a tool; degrade to a string.
        return "Standings unavailable right now (could not read the leaderboard)."
    if not rows:
        return "Standings unavailable: no players found for this group yet."
    lines = [
        f"#{r['rank']} {r['username']} — {r['total_points']} pts"
        for r in rows
        if r.get("username")
    ]
    return "Current standings:\n" + "\n".join(lines)


async def run(question: str, group_id: str | None = None) -> SupportAnswer:
    """Answer one user question. The LLM decides which (if any) tool to call.

    deps carries group_id so get_group_standings can read it via ctx.deps — `deps` is a
    kwarg of .run() (while deps_type was set on the Agent constructor).
    """
    result = await support_agent.run(question, deps=_Deps(group_id=group_id))
    return result.output  # typed SupportAnswer — guaranteed by output_type
