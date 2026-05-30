# supabase/migrations-prod/

**Prod-only SQL.** Apply ONLY to the production Supabase project. Never apply to dev.

## When to use

- Prod-only seed scripts (e.g., backfilling auth users, populating prod-only reference rows)
- Prod-only data fixes (e.g., correcting a row that only exists in prod)
- Post-launch hardening that for some reason should NOT be in dev

## When NOT to use

- Schema changes that affect both environments → use `supabase/migrations/`
- Experimental features (chatbot, RAG) → use `supabase/migrations-dev/`

## Convention

Each file:
- Filename: `YYYYMMDDHHMMSS_short_description.sql`
- First line: `-- target: prod-only`
- Second line: one-sentence purpose

## Applying

Via Claude/MCP:
```
mcp__supabase__apply_migration project_id=<PROD_REF>
```

Never with `project_id=ftryuvfdihmhlzvbpfeu` (that's dev).

## Folder is currently empty

We have no prod-only migrations on day 1. Most schema changes go through `supabase/migrations/` (applied to both).
