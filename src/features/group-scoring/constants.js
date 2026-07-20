// Group scoring feature flags — mirrors the KO_PREDICT_DEV kill-switch pattern (Picks.jsx:32).
// GROUP_SCORING_DEV: one-line kill-switch — set false to hide the Scoring/Rules buttons everywhere.
// First rollout additionally gated behind admin test mode (wc2026_test_mode, Dashboard pattern).
export const GROUP_SCORING_DEV = true

export const isTestMode = () =>
  typeof localStorage !== 'undefined' && localStorage.getItem('wc2026_test_mode') === '1'

export const MODES = { system: 'System', odds: 'Odds', custom: 'Custom' }

export const SYSTEM_DEFAULTS = {
  group_stage_mode: 'system',
  knockout_mode: 'system',
  knockout_result_basis: 'ninety_minutes',
  champion_mode: 'system',
  top_scorer_mode: 'system',
  trivia_included: true,
  trivia_inclusion_timing: 'tournament_finish',
  bracket_included: true,
  bracket_inclusion_timing: 'tournament_finish',
}
