"""Shadow-mode runner — the "play with it" entry point.

Point the crew at a REAL (group, date) from Itay's DB, print the Hebrew roast + the judge
verdict, and show the EF's live English summary next to it for comparison. The EF is never
touched — this only reads.

Usage (from the repo root, venv active):
    python -m scripts.run_shadow --recent                 # list recent (group, date) targets
    python -m scripts.run_shadow --ef <group_id> <date>   # print ONLY the EF's English roast (no crew, no LLM cost)
    python -m scripts.run_shadow <group_id> <YYYY-MM-DD>  # run the crew + compare to the EF
"""
from __future__ import annotations

import asyncio
import sys

from app import data
from app.crew import run_crew

LINE = "=" * 72


def _print_recent() -> None:
    rows = data.list_recent_summaries()
    if not rows:
        print("No summaries found. Is SUPABASE_SERVICE_KEY set and pointing at the right project?")
        return
    print("Recent (group_id, date) targets that already have an EF summary:\n")
    for r in rows:
        print(f"  {r['group_id']}   {r['date']}")
    print("\nRun:  python -m scripts.run_shadow <group_id> <date>")


async def _run(group_id: str, date: str) -> None:
    print(f"Running the crew on group={group_id} date={date} …\n")
    result = await run_crew(group_id, date)

    print(LINE)
    print("CREW — Hebrew roast (this is what the new architecture produces):\n")
    print(result.summary_he)
    print(
        f"\n[judge {result.judge.total}/10 after {result.attempts} attempt(s) — "
        f"{result.judge.reasoning}]"
    )
    print(LINE)

    ef = data.fetch_ef_summary(group_id, date)
    if ef:
        print("\nEF — live English summary (for side-by-side comparison):\n")
        print(ef)
        print(LINE)
    else:
        print("\n(No EF summary stored for this day — nothing to compare against.)")


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return
    if args[0] == "--recent":
        _print_recent()
        return
    if args[0] == "--ef":
        if len(args) < 3:
            print("Need: --ef <group_id> <YYYY-MM-DD>")
            sys.exit(2)
        ef = data.fetch_ef_summary(args[1], args[2])
        print(ef or "(no EF summary stored for that day)")
        return
    if len(args) < 2:
        print("Need: <group_id> <YYYY-MM-DD>   (or --recent / --ef)")
        sys.exit(2)
    asyncio.run(_run(args[0], args[1]))


if __name__ == "__main__":
    main()
