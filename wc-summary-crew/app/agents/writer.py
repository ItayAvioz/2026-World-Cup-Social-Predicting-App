"""Writer agent — ★ THIS ONE IS YOURS, ITAY. ★

The crew runs end-to-end exactly as it ships, so you'll see Hebrew come out on the very
first run. But the prompt below is a deliberately plain starting point. Turning it into
genuinely funny *Hebrew* — not translated-English — is the highest-value work in this
whole project, and it's the precise thing the crew architecture exists to enable: there
is exactly ONE place that owns language, and this is it. Tune here; nothing upstream moves.

Look at what `run()` receives: typed objects — a `StatsBlock` (facts) and a
`list[PlayerStyle]` (player tags), already computed by the stages before it. The Writer's
single job is to turn those into Hebrew.

That is the literal answer to the question from the session ("what's the difference
between this and the prompt I write today?"): the INPUT is structured and the
RESPONSIBILITY is narrow — so you can tune THIS prompt in isolation, measure it with the
Judge, and even swap its model, without touching stats or tagging.
"""
from __future__ import annotations

from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings

from .. import config, models

# ── ★ TODO(Itay): this is the prompt to make great. Everything below works; this is
#    where your taste goes. ──────────────────────────────────────────────────────────
_SYSTEM_PROMPT = """אתה כותב סיכום לילי קצר, מצחיק וחברתי לקבוצת ניחושים של גביע העולם 2026.
- כתוב בעברית טבעית וזורמת, לא תרגום מאנגלית.
- מותר (ורצוי) לעקוץ ולפרגן — אבל אסור להמציא עובדות. השתמש רק במה שנתון לך.
- קצר וקולע, מתאים לוואטסאפ.
זוהי נקודת התחלה בלבד — ראה את ה-TODOs בקובץ וכוונן אותי."""

# TODO(Itay) — in priority order:
#   1. TONE. Run `python -m scripts.run_shadow --recent` to find a (group_id, date), then
#      `python -m scripts.run_shadow --ef <group_id> <date>` to print that day's EF English
#      roast. Write the Hebrew you actually wish your friends had received. That gap is the job.
#   2. USE THE TAGS. Each member arrives with a PlayerStyle (the_coward / the_sniper / ...).
#      Give each a recurring Hebrew nickname so the group recognises themselves.
#   3. BAN CLICHÉS. Port your EF's banned-words idea (journey/remarkable/...) to Hebrew
#      clichés you're sick of ("ערב מטורף", "דרמה ענקית", ...).
#   4. STRUCTURE. Decide the shape: opener → 1-2 game beats → leaderboard jab → sign-off.
#   5. EDGE CASES. Inactive members, all-auto "ghosts", a player who swept the night.

writer_agent = Agent(
    f"openai-chat:{config.CREW_MODEL}",  # Chat Completions, like the EF
    output_type=models.CrewSummary,
    model_settings=ModelSettings(temperature=config.TEMPERATURE, seed=config.SEED),
    system_prompt=_SYSTEM_PROMPT,
)


def _brief(stats: models.StatsBlock, styles: list[models.PlayerStyle]) -> str:
    """Assemble the typed facts + tags into the Writer's prompt. (Plain data in, Hebrew out.)"""
    style_lines = "\n".join(f"- {s.username}: {s.style} — {s.evidence}" for s in styles) or "—"
    game_lines = (
        "\n".join(
            f"- {g.match} [{g.phase_label}]"
            + (f", {g.group_exact_n} ניחשו במדויק" if g.group_exact_n else "")
            + (" (הפתעה מול הקבוצה)" if g.group_upset else "")
            for g in stats.games
        )
        or "—"
    )
    lb = "\n".join(
        f"- #{m.group_rank} {m.username}: {m.total_pts} נק' (+{m.today_pts} היום)"
        + (" [לא פעיל]" if m.is_inactive else "")
        for m in sorted(stats.members, key=lambda m: m.group_rank)
    )
    return (
        f"קבוצה: {stats.group_name} — {stats.date}\n"
        f"עובדת כותרת: {stats.headline_fact or '—'}\n\n"
        f"משחקים היום:\n{game_lines}\n\n"
        f"טבלה:\n{lb}\n\n"
        f"סגנונות שחקנים:\n{style_lines}\n\n"
        f"כתוב את הסיכום בעברית."
    )


async def run(
    stats: models.StatsBlock,
    styles: list[models.PlayerStyle],
    judge_feedback: str | None = None,
) -> models.CrewSummary:
    prompt = _brief(stats, styles)
    if judge_feedback:
        # On a retry the Judge's note is appended so the Writer fixes the weak spot.
        prompt += f"\n\nהערת שיפור מהשופט (תקן בדיוק את זה): {judge_feedback}"
    result = await writer_agent.run(prompt)
    return result.output
