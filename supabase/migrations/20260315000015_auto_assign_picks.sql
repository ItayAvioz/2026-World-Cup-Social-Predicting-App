-- Migration 15: Auto-assign champion + top scorer picks at KO
-- Adds is_auto column to both picks tables
-- Creates fn_auto_assign_picks() — random strategy (each missing user gets own random pick)
-- Schedules pg_cron job at 2026-06-11T19:00:00Z

ALTER TABLE public.champion_pick   ADD COLUMN IF NOT EXISTS is_auto boolean NOT NULL DEFAULT false;
ALTER TABLE public.top_scorer_pick ADD COLUMN IF NOT EXISTS is_auto boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.fn_auto_assign_picks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user     record;
  v_champion text;
  v_player   jsonb;
  v_teams    text[] := ARRAY[
    'Mexico','South Africa','South Korea','Canada','Qatar','Switzerland',
    'Brazil','Morocco','Haiti','Scotland','United States','Paraguay',
    'Australia','Germany','Curaçao','Ivory Coast','Ecuador','Netherlands',
    'Japan','Tunisia','Belgium','Egypt','Iran','New Zealand','Spain',
    'Cape Verde','Saudi Arabia','Uruguay','France','Senegal','Norway',
    'Argentina','Algeria','Austria','Jordan','Portugal','Uzbekistan',
    'Colombia','England','Croatia','Ghana','Panama',
    'UEFA PO-A','UEFA PO-B','UEFA PO-C','UEFA PO-D','IC PO-1','IC PO-2'
  ];
  v_players  jsonb[] := ARRAY[
    '{"name":"Kylian Mbappé","id":278}'::jsonb,
    '{"name":"Erling Haaland","id":1100}'::jsonb,
    '{"name":"Lionel Messi","id":154}'::jsonb,
    '{"name":"Vinicius Jr","id":2295}'::jsonb,
    '{"name":"Harry Kane","id":3501}'::jsonb,
    '{"name":"Lautaro Martinez","id":4200}'::jsonb,
    '{"name":"Neymar Jr","id":5001}'::jsonb
  ];
BEGIN
  -- Random champion pick per missing user
  FOR v_user IN
    SELECT p.id FROM public.profiles p
    WHERE NOT EXISTS (SELECT 1 FROM public.champion_pick cp WHERE cp.user_id = p.id)
  LOOP
    v_champion := v_teams[1 + floor(random() * array_length(v_teams, 1))::int];
    INSERT INTO public.champion_pick (user_id, team, is_auto)
    VALUES (v_user.id, v_champion, true)
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;

  -- Random top scorer pick per missing user
  FOR v_user IN
    SELECT p.id FROM public.profiles p
    WHERE NOT EXISTS (SELECT 1 FROM public.top_scorer_pick ts WHERE ts.user_id = p.id)
  LOOP
    v_player := v_players[1 + floor(random() * array_length(v_players, 1))::int];
    INSERT INTO public.top_scorer_pick (user_id, player_name, top_scorer_api_id, is_auto)
    VALUES (v_user.id, v_player->>'name', (v_player->>'id')::int, true)
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;
END;
$$;

-- Schedule at first game KO: June 11 2026 19:00 UTC
SELECT cron.schedule(
  'auto-assign-picks',
  '0 19 11 6 *',
  $$SELECT public.fn_auto_assign_picks();$$
);
