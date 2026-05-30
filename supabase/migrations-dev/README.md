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

## Folder is currently empty

Use it when you start chatbot R&D.
