"""pytest bootstrap — make `app` and `tests` importable when running `pytest` from here."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

# The crew's LLM agents (judge/personality/writer) build their OpenAI client at import time,
# which requires OPENAI_API_KEY to merely EXIST (not to be valid). Every offline test that
# imports app.main / app.crew therefore needs *some* key present. The actual LLM calls are
# always mocked or run under TestModel, so a dummy value is enough to import — and keeps the
# whole suite runnable with NO real key. A real key in the env (e.g. from .env) is left as-is.
os.environ.setdefault("OPENAI_API_KEY", "sk-test-dummy-offline")
