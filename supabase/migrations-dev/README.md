# supabase/migrations-dev/

**Dev-only SQL.** Apply ONLY to the dev Supabase project (`ftryuvfdihmhlzvbpfeu`). Never apply to prod.

## When to use

- Chatbot / RAG / multi-agent experiments
- Test triggers, debug helpers
- Anything you wouldn't want real users (on prod) to be exposed to

## When NOT to use

- Schema changes that affect both environments → use `supabase/migrations/`
- Prod-only seed/fixes → use `supabase/migrations-prod/`

## Convention

Each file:
- Filename: `YYYYMMDDHHMMSS_short_description.sql`
- First line: `-- target: dev-only`
- Second line: one-sentence purpose

## Applying

Via Claude/MCP:
```
mcp__supabase__apply_migration project_id=ftryuvfdihmhlzvbpfeu
```

Never with `project_id=<PROD_REF>` (that would leak experimental schema to prod).

## Applied dev-only migrations

| File | Purpose |
|---|---|
| `20260602120000_disable_noisy_dev_crons.sql` | Unschedules 510 noisy cron jobs (ai-summary daily, ai-summary-push, ai-summary-schedule-daily, ko-notif, trivia, af-odds-daily, verify-game, sync-game) + `admin-daily-digest` so dev makes **zero** external calls (push / OpenAI / api-football / odds / admin email) while used only for screen-recording demos. Keeps DB-only jobs (auto-predict, auto-assign-picks, cleanup-push-subs-daily). Pattern-based + idempotent. Applied to dev `ftryuvfdihmhlzvbpfeu` 2026-06-02. **To re-enable** later: re-run the scheduling functions (`SELECT fn_schedule_ai_summaries();`, re-add `admin-daily-digest` / `af-odds-daily` / `trivia-push-daily` crons, and re-seed ko-notif/verify/sync via `trg_auto_schedule_game` or the backfill loops). |
