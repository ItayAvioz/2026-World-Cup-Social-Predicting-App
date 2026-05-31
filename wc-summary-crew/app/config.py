"""Central config — all env-driven, no secrets in code.

Mirrors two of Itay's instincts from the Judge PR:
  • a cheap model for the crew, a pricier model for the judge;
  • reproducibility (seed + low-ish temperature) so the same input → the same output.
"""
import os

from dotenv import load_dotenv

load_dotenv()

# ── Supabase (live, read-only) ────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# ── OpenAI ────────────────────────────────────────────────────────────────────
# PydanticAI's OpenAI provider reads OPENAI_API_KEY from the environment directly;
# load_dotenv() above puts it there.
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

# ── Models (same split as the EF: 5× cheap candidates + 1 pricey judge) ───────
CREW_MODEL = os.environ.get("CREW_MODEL", "gpt-4o-mini")
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "gpt-4o")

# ── Reproducibility ───────────────────────────────────────────────────────────
SEED = int(os.environ.get("CREW_SEED", "42"))
TEMPERATURE = float(os.environ.get("CREW_TEMPERATURE", "0.6"))

# ── Judge retry loop (Writer ⇄ Judge, his idea — now per-agent) ───────────────
JUDGE_MIN_TOTAL = float(os.environ.get("JUDGE_MIN_TOTAL", "7.0"))
MAX_WRITER_ATTEMPTS = int(os.environ.get("MAX_WRITER_ATTEMPTS", "3"))


def require(*names: str) -> None:
    """Fail fast with a friendly message if a required secret is missing."""
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        raise RuntimeError(
            f"Missing env var(s): {', '.join(missing)}.\n"
            f"→ Copy .env.example to .env and fill them in "
            f"(SUPABASE_SERVICE_KEY = service_role key from the Supabase dashboard)."
        )
