-- PROD-ONLY re-seed: top_scorer_candidates with ALL 1383 players (Attacker + Mid + Def + GK).
-- Run after M115 (ADD COLUMN position + flip UNIQUE constraint to api_player_id).
-- Reads from cached bootstrap_squads response (net._http_response with status='bootstrap_squads_ok').
-- Idempotent (ON CONFLICT api_player_id).
--
-- Why all players, not just Attackers:
--   - User experience: let users pick ANY player for the top-scorer award
--     (not just forwards — World Cup history has midfielders + defenders top-scoring)
--   - Frontend later may add a position filter in the Picks dropdown
--
-- Result: 1383 rows across all 48 WC2026 teams.

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
all_players AS (
  SELECT DISTINCT ON ((p->>'api_player_id')::int)
    p->>'name' AS player_name,
    s->>'team_name' AS api_team_name,
    (p->>'api_player_id')::int AS api_player_id,
    p->>'position' AS position
  FROM latest_bootstrap,
       LATERAL jsonb_array_elements(body->'squads') s,
       LATERAL jsonb_array_elements(s->'players') p
)
INSERT INTO public.top_scorer_candidates (name, team_name, flag_code, api_player_id, position, is_active)
SELECT
  ap.player_name,
  COALESCE(nm.app_name, ap.api_team_name) AS team_name,
  t.flag_code,
  ap.api_player_id,
  ap.position,
  true
FROM all_players ap
LEFT JOIN name_map nm ON nm.api_name = ap.api_team_name
JOIN public.teams t ON t.name = COALESCE(nm.app_name, ap.api_team_name)
ON CONFLICT (api_player_id) DO UPDATE SET
  name      = EXCLUDED.name,
  team_name = EXCLUDED.team_name,
  flag_code = EXCLUDED.flag_code,
  position  = EXCLUDED.position,
  is_active = true;

-- Verify
DO $$
DECLARE v_total int; v_teams int; v_no_pos int; v_no_api_id int;
BEGIN
  SELECT COUNT(*), COUNT(DISTINCT team_name),
         COUNT(*) FILTER (WHERE position IS NULL),
         COUNT(*) FILTER (WHERE api_player_id IS NULL)
    INTO v_total, v_teams, v_no_pos, v_no_api_id
    FROM top_scorer_candidates WHERE is_active;
  RAISE NOTICE 'top_scorer_candidates: % rows across % teams (% null position, % null api_id)', v_total, v_teams, v_no_pos, v_no_api_id;
END $$;
