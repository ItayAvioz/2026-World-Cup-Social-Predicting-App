-- M72: v13-unique-2 — ban verbatim "not just this group, but the whole competition" opener
-- Fine-tuning from 2026-05-04 run review: v13 replaced one template with another.
-- Fix: GLOBAL TOP RULE no longer prescribes the literal phrase; quality check catches it.

UPDATE prompt_versions
SET system_prompt = replace(
    replace(
      system_prompt,
      'If the leader topped the competition: use it in P1 as suspicious scale - "not just this group, the whole competition."',
      'If the leader topped the competition: use it in P1 as suspicious scale — express this idea in your own words. Do not use the phrase "not just this group, but the whole competition" verbatim.'
    ),
    '- scan every paragraph opener: if it is a general observation, rewrite with a specific data fact',
    '- scan every paragraph opener: if it is a general observation, rewrite with a specific data fact' || E'\n' ||
    '- scan P1 for the literal phrase "not just this group, but the whole competition" — if present, rewrite with a different expression of the same idea'
  )
WHERE version_tag = 'v13-unique-2';
