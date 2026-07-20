// targeted_probe_v33_findings.mjs — probes for the 5 issues found reviewing a real bot
// conversation on 2026-07-20 (DEV ONLY). Each group generalizes ONE bug class beyond the
// single phrasing that surfaced it, so the fine-tuning report can state a real prevalence
// number instead of "found once."
//
// [id, question, family, expected substrings; '!' = must NOT appear]
export const CASES = [
  // ---- Family 1: GAME-scoped superlative, PLURAL "games"/"matches" (dimToMetric gameWord) ----
  // Bug: /\bgame\b|\bmatch\b/ (singular-only) misses "games"/"matches" -> falls to player-level.
  ['plural-red-games', 'which are the games with most red cards?', 'plural_game_dim', ['!players are tied', '!player with the most red cards']],
  ['plural-red-games2', 'in which games were the most red cards drawn?', 'plural_game_dim', ['!players are tied', '!player with the most red cards']],
  ['plural-yellow-games', 'which games had the most yellow cards?', 'plural_game_dim', ['!players are tied', '!player with the most yellow']],
  ['plural-corners-games', 'which games had the most corners?', 'plural_game_dim', ['!players are tied']],
  ['plural-goals-matches', 'which matches had the most goals?', 'plural_game_dim', ['!players are tied']],
  ['singular-control-red', 'which game had the most red cards?', 'plural_game_dim_control', ['!players are tied']],  // must still pass (control)

  // ---- Family 2: popularity topical gate, PLURAL "winners" (\bwinner\b singular-only) ----
  ['plural-winners-champion', 'who are the 3 teams most chosen by users as world cup winners?', 'plural_popularity', ['across the whole app', '!which stat do you mean']],
  ['plural-winners-champion2', 'which team is the most chosen world cup winners pick?', 'plural_popularity', ['!which stat do you mean']],
  ['singular-control-winner', 'who are the 3 teams most chosen by users as world cup winner?', 'plural_popularity_control', ['!which stat do you mean']],

  // ---- Family 3: compound clause elides the shared noun ("games") in clause 2 ----
  ['compound-elided-noun', 'how much games went to extra time? and how much to penalties?', 'compound_elision', ['extra time', 'penalt', '!focus on the']],
  ['compound-elided-noun2', 'how many games ended in a draw? and how many in a win?', 'compound_elision', ['!focus on the', '!which stat do you mean']],
  ['compound-elided-noun3', 'how many yellow cards were shown? and how many red?', 'compound_elision', ['yellow', 'red', '!focus on the']],

  // ---- Family 4: friendly-scope ambiguity — "how many games has TEAM played" right after ----
  // a friendly for that team was just discussed. No history param here (single-shot); this
  // measures whether the BARE answer at least signals scope, not the multi-turn confusion.
  ['friendly-scope-arsenal', 'how many games has arsenal played?', 'friendly_scope', ['Arsenal']],
  ['friendly-scope-psg', 'how many games has paris saint germain played?', 'friendly_scope', ['Paris Saint Germain']],

  // ---- Family 5: typo'd compound — clause 1 typo causes misroute, clause 2 (clean) rescues it ----
  ['typo-compound-played', 'how mucg games played? and how much remain?', 'typo_compound', ['!upcoming games are scheduled']],
  ['typo-compound-played2', 'how mny games have ben played?', 'typo_compound', ['!upcoming games are scheduled', 'played']],
  ['typo-compound-played3', 'hw many games played so far?', 'typo_compound', ['!upcoming games are scheduled', 'played']],
]
