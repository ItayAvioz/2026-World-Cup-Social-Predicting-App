#!/usr/bin/env node
/**
 * Regenerate data/wc2026_squads.json from the finalized PROD DB (top_scorer_candidates).
 *
 * WHY: the JSON is the documented seed "source of truth", but after the manual
 * squad-finalization sprint (June 2026) it went stale vs the DB AND still held the
 * old GK/DF/MF/FW short codes that broke the Picks position filter.
 * This script makes JSON == DB 1:1 with FULL-NAME positions, so any future
 * JSON -> DB re-sync reproduces the finalized DB and can't reintroduce that bug.
 *
 * Run:  node scripts/regen-squads-json.cjs
 */
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// PROD (pickyguessers-prod). anon key is safe to expose; frontend reads this same data.
const SUPABASE_URL = 'https://asugxlvgcmkxspzokydk.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzdWd4bHZnY21reHNwem9reWRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNDQ1OTQsImV4cCI6MjA5NTcyMDU5NH0.ytDL0oVyZ9M9ngao1uYAWvqIiUwe_QvuLA3fE974Y6E'

const POS_RANK = { Goalkeeper: 0, Defender: 1, Midfielder: 2, Attacker: 3 }

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  const { data: teams, error: tErr } = await supabase
    .from('teams')
    .select('name, group_name, flag_code, is_tbd')
    .eq('is_tbd', false)
    .range(0, 99999)
  if (tErr) throw tErr

  // Paginate: the project enforces a 1000-row server cap that .range() can't exceed
  // in a single request, and active candidates > 1000.
  const cands = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('top_scorer_candidates')
      .select('name, team_name, position, api_player_id, id_verification')
      .eq('is_active', true)
      .order('team_name')
      .order('name')
      .range(from, from + PAGE - 1)
    if (error) throw error
    cands.push(...data)
    if (data.length < PAGE) break
  }

  const byTeam = new Map()
  for (const c of cands) {
    if (!byTeam.has(c.team_name)) byTeam.set(c.team_name, [])
    byTeam.get(c.team_name).push(c)
  }

  const teamObjs = teams
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(tm => {
      const players = (byTeam.get(tm.name) || [])
        .slice()
        .sort((a, b) =>
          (POS_RANK[a.position] ?? 9) - (POS_RANK[b.position] ?? 9) ||
          a.name.localeCompare(b.name))
        .map(p => ({
          number: null,
          name: p.name,
          position: p.position,
          club: '',
          dob: '',
          api_player_id: p.api_player_id,
          id_verification: p.id_verification,
        }))
      return {
        team_name: tm.name,
        group: tm.group_name,
        flag_code: tm.flag_code,
        team_status: 'final',
        announced_date: '2026-06-07',
        player_count: players.length,
        players,
      }
    })

  const totalPlayers = teamObjs.reduce((s, t) => s + t.players.length, 0)
  const placeholders = teamObjs.reduce(
    (s, t) => s + t.players.filter(p => p.api_player_id < 0).length, 0)

  const doc = {
    _meta: {
      tournament: 'FIFA World Cup 2026',
      source: 'Regenerated from PROD top_scorer_candidates (finalized 26-man squads)',
      regenerated_date: '2026-06-07',
      regenerated_by: 'scripts/regen-squads-json.cjs',
      team_count: teamObjs.length,
      total_players: totalPlayers,
      placeholder_count: placeholders,
      position_values:
        'FULL api-football form: Goalkeeper | Defender | Midfielder | Attacker (NOT GK/DF/MF/FW). DB stores these verbatim; never write short codes.',
      note:
        'This file mirrors the finalized DB 1:1. Negative api_player_id = placeholder pending post-game lineup resolution (see docs/PLAN_LINEUP_VERIFICATION.md).',
    },
    teams: teamObjs,
  }

  const out = path.join(__dirname, '..', 'data', 'wc2026_squads.json')
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`Wrote ${out}`)
  console.log(`teams=${teamObjs.length} players=${totalPlayers} placeholders=${placeholders}`)
}

main().catch(e => { console.error(e); process.exit(1) })
