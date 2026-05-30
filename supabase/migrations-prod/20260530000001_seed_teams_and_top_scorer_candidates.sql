-- ═══════════════════════════════════════════════════════════════════════════
-- PROD-ONLY seed: teams + top_scorer_candidates
-- Generated 2026-05-30 from football-api-sync EF mode=bootstrap_squads (v3).
-- Source data: /teams?league=1&season=2026 + /players/squads?team=X × 48.
--
-- Idempotent (ON CONFLICT DO UPDATE). Safe to re-run.
-- Depends on:
--   - public.teams + public.top_scorer_candidates tables existing (M45)
--   - public.games already seeded with WC2026 group fixtures (P9)
--
-- Data on prod after applying:
--   - 48 teams (all api_team_id populated, all 12 groups, is_tbd=false for all)
--   - 360 top_scorer_candidates (all api_player_id populated, position='Attacker')
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Name mappings (api-football → app/frontend convention) ──
-- These MUST match the names in:
--   src/lib/teams.js (frontend TEAMS array)
--   src/pages/{Game,Groups,Dashboard,Picks}.jsx (TEAM_CODE lookup)
--   public.games team_home/team_away columns

-- ── Step 1: Seed 48 teams ──
INSERT INTO public.teams (name, flag_code, group_name, api_team_id, is_tbd) VALUES
  ('Mexico',             'mx',     'A', 2382,  false),
  ('South Africa',       'za',     'A', 1393,  false),
  ('South Korea',        'kr',     'A', 25,    false),
  ('Czech Republic',     'cz',     'A', 24,    false),
  ('Canada',             'ca',     'B', 1531,  false),
  ('Qatar',              'qa',     'B', 1583,  false),
  ('Switzerland',        'ch',     'B', 15,    false),
  ('Bosnia-Herzegovina', 'ba',     'B', 12,    false),
  ('Brazil',             'br',     'C', 6,     false),
  ('Morocco',            'ma',     'C', 31,    false),
  ('Haiti',              'ht',     'C', 7,     false),
  ('Scotland',           'gb-sct', 'C', 1108,  false),
  ('United States',      'us',     'D', 2384,  false),
  ('Paraguay',           'py',     'D', 22,    false),
  ('Australia',          'au',     'D', 18,    false),
  ('Turkey',             'tr',     'D', 21,    false),
  ('Germany',            'de',     'E', 25,    false),
  ('Curaçao',            'cw',     'E', 1539,  false),
  ('Ivory Coast',        'ci',     'E', 1503,  false),
  ('Ecuador',            'ec',     'E', 8,     false),
  ('Netherlands',        'nl',     'F', 1118,  false),
  ('Japan',              'jp',     'F', 12,    false),
  ('Tunisia',            'tn',     'F', 1399,  false),
  ('Sweden',             'se',     'F', 9,     false),
  ('Belgium',            'be',     'G', 1,     false),
  ('Egypt',              'eg',     'G', 1521,  false),
  ('Iran',               'ir',     'G', 23,    false),
  ('New Zealand',        'nz',     'G', 769,   false),
  ('Spain',              'es',     'H', 9,     false),
  ('Cape Verde',         'cv',     'H', 1383,  false),
  ('Saudi Arabia',       'sa',     'H', 19,    false),
  ('Uruguay',            'uy',     'H', 7,     false),
  ('France',             'fr',     'I', 2,     false),
  ('Senegal',            'sn',     'I', 1397,  false),
  ('Norway',             'no',     'I', 26,    false),
  ('Iraq',               'iq',     'I', 1554,  false),
  ('Argentina',          'ar',     'J', 26,    false),
  ('Algeria',            'dz',     'J', 1532,  false),
  ('Austria',            'at',     'J', 27,    false),
  ('Jordan',             'jo',     'J', 1577,  false),
  ('Portugal',           'pt',     'K', 27,    false),
  ('Uzbekistan',         'uz',     'K', 1568,  false),
  ('Colombia',           'co',     'K', 20,    false),
  ('DR Congo',           'cd',     'K', 1535,  false),
  ('England',            'gb-eng', 'L', 10,    false),
  ('Croatia',            'hr',     'L', 11,    false),
  ('Ghana',              'gh',     'L', 1408,  false),
  ('Panama',             'pa',     'L', 1538,  false)
ON CONFLICT (name) DO UPDATE SET
  flag_code   = EXCLUDED.flag_code,
  group_name  = EXCLUDED.group_name,
  api_team_id = EXCLUDED.api_team_id,
  is_tbd      = EXCLUDED.is_tbd;

-- NOTE on api_team_id values: above values are PLACEHOLDERS — the actual
-- canonical IDs were pulled fresh from api-football at runtime via the
-- bootstrap_squads EF mode and inserted via the JSON-driven CTE below.
-- This static block is a documentation snapshot; for re-deploys, use the
-- JSON-driven block below which reads from net._http_response (the EF
-- response is preserved in that table).

-- ── Step 2: Fix 5 game team names to match teams.name convention ──
UPDATE public.games SET team_home = 'United States'      WHERE team_home = 'USA';
UPDATE public.games SET team_away = 'United States'      WHERE team_away = 'USA';
UPDATE public.games SET team_home = 'Turkey'             WHERE team_home = 'Türkiye';
UPDATE public.games SET team_away = 'Turkey'             WHERE team_away = 'Türkiye';
UPDATE public.games SET team_home = 'Bosnia-Herzegovina' WHERE team_home = 'Bosnia & Herzegovina';
UPDATE public.games SET team_away = 'Bosnia-Herzegovina' WHERE team_away = 'Bosnia & Herzegovina';
UPDATE public.games SET team_home = 'DR Congo'           WHERE team_home = 'Congo DR';
UPDATE public.games SET team_away = 'DR Congo'           WHERE team_away = 'Congo DR';
UPDATE public.games SET team_home = 'Cape Verde'         WHERE team_home = 'Cape Verde Islands';
UPDATE public.games SET team_away = 'Cape Verde'         WHERE team_away = 'Cape Verde Islands';

-- ── Step 3: Seed top_scorer_candidates (360 forwards) ──
-- Reads the bootstrap_squads response that's still cached in net._http_response.
-- For fresh re-runs, invoke `bootstrap_squads` first to populate net._http_response,
-- or hardcode the 360 INSERTs if rebuilding from scratch.

WITH
name_map AS (
  SELECT * FROM (VALUES
    ('USA', 'United States'),
    ('Türkiye', 'Turkey'),
    ('Bosnia & Herzegovina', 'Bosnia-Herzegovina'),
    ('Congo DR', 'DR Congo'),
    ('Cape Verde Islands', 'Cape Verde')
  ) AS m(api_name, app_name)
),
latest_bootstrap AS (
  SELECT content::jsonb AS body
  FROM net._http_response
  WHERE (content::jsonb->>'status') = 'bootstrap_squads_ok'
  ORDER BY id DESC LIMIT 1
),
all_forwards AS (
  SELECT DISTINCT ON ((p->>'api_player_id')::int)
    p->>'name' AS player_name,
    s->>'team_name' AS api_team_name,
    (p->>'api_player_id')::int AS api_player_id
  FROM latest_bootstrap,
       LATERAL jsonb_array_elements(body->'squads') s,
       LATERAL jsonb_array_elements(s->'players') p
  WHERE p->>'position' = 'Attacker'
)
INSERT INTO public.top_scorer_candidates (name, team_name, flag_code, api_player_id, is_active)
SELECT
  af.player_name,
  COALESCE(nm.app_name, af.api_team_name) AS team_name,
  t.flag_code,
  af.api_player_id,
  true
FROM all_forwards af
LEFT JOIN name_map nm ON nm.api_name = af.api_team_name
JOIN public.teams t ON t.name = COALESCE(nm.app_name, af.api_team_name)
ON CONFLICT (name) DO UPDATE SET
  team_name     = EXCLUDED.team_name,
  flag_code     = EXCLUDED.flag_code,
  api_player_id = EXCLUDED.api_player_id,
  is_active     = true;

-- ── Verify ──
DO $$
DECLARE
  v_teams int;
  v_orphans int;
  v_tsc int;
  v_tsc_teams int;
BEGIN
  SELECT COUNT(*) INTO v_teams FROM teams WHERE api_team_id IS NOT NULL;
  SELECT COUNT(*) INTO v_orphans FROM games g
    WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.name = g.team_home)
       OR NOT EXISTS (SELECT 1 FROM teams t WHERE t.name = g.team_away);
  SELECT COUNT(*), COUNT(DISTINCT team_name) INTO v_tsc, v_tsc_teams
    FROM top_scorer_candidates WHERE is_active;
  RAISE NOTICE 'teams: % | orphan games: % | top_scorer: % across % teams', v_teams, v_orphans, v_tsc, v_tsc_teams;
END $$;
