-- M65 (prompt_v3): Two targeted fixes across all 4 active prompt slots
-- 1. Champion confusion guard: add explicit rule that picks[].champion is a tournament pick,
--    never a team name in today's games[]. Fixes hallucination where AI mixed champion pick with game teams.
-- 2. v12-picks-2 direction synonym fix: expand quality check to cover synonym phrases
--    ("had a field day", "saw it coming", etc.) not just the literal "competitors got it right".

-- ─── v11-main-2 (main slot) ───────────────────────────────────────────────
UPDATE prompt_versions
SET system_prompt = replace(
  system_prompt,
  '- no invented facts - do not claim a champion won or lost unless champion_result is present in picks[]',
  '- no invented facts - do not claim a champion won or lost unless champion_result is present in picks[]' || chr(10) ||
  '- picks[].champion is the member''s tournament winner pick — never use it as a team name in games[]. Teams playing today are only in games[].home_team and games[].away_team'
)
WHERE version_tag = 'v11-main-2';

-- ─── v12-picks-2 (candidate_2 slot) ──────────────────────────────────────
UPDATE prompt_versions
SET system_prompt = replace(
  system_prompt,
  '- no invented facts - champion_result must come from picks[] not inferred',
  '- no invented facts - champion_result must come from picks[] not inferred' || chr(10) ||
  '- picks[].champion is the member''s tournament winner pick — never use it as a team name in games[]. Teams playing today are only in games[].home_team and games[].away_team'
)
WHERE version_tag = 'v12-picks-2';

-- v12 direction synonym fix: expand quality check to cover synonym phrases
UPDATE prompt_versions
SET system_prompt = replace(
  system_prompt,
  'verify "competitors got it right" does NOT appear - they were wrong too; rewrite if present',
  'verify no phrase implies competitors predicted correctly ("got it right", "had a field day", "saw it coming", "were correct", "got it", "called it") — they were also wrong; rewrite if present'
)
WHERE version_tag = 'v12-picks-2';

-- ─── v13-unique-2 (candidate_3 slot) ─────────────────────────────────────
UPDATE prompt_versions
SET system_prompt = replace(
  system_prompt,
  '- no invented facts - champion_result must come from picks[], not inferred',
  '- no invented facts - champion_result must come from picks[], not inferred' || chr(10) ||
  '- picks[].champion is the member''s tournament winner pick — never use it as a team name in games[]. Teams playing today are only in games[].home_team and games[].away_team'
)
WHERE version_tag = 'v13-unique-2';

-- ─── v10B (candidate_4 slot) ─────────────────────────────────────────────
UPDATE prompt_versions
SET system_prompt = replace(
  system_prompt,
  '- no invented facts - do not claim a champion won or lost unless champion_played_today=true in picks[]',
  '- no invented facts - do not claim a champion won or lost unless champion_played_today=true in picks[]' || chr(10) ||
  '- picks[].champion is the member''s tournament winner pick — never use it as a team name in games[]. Teams playing today are only in games[].home_team and games[].away_team'
)
WHERE version_tag = 'v10B';
