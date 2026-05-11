-- Remove TBD placeholder teams — all 48 WC 2026 teams now confirmed
DELETE FROM teams WHERE is_tbd = true;
