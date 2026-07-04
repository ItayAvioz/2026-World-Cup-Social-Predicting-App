import { useMemo, useState } from 'react'
import {
  LEFT_COLS, RIGHT_COLS, PHASE_LABEL, TEAM_SHORT, NODES_BY_PHASE,
  nodeCandidates, bronzeTeams, CHAMPION_NODE, THIRD_WINNER_NODE, placeGamesOnNodes,
} from './bracketTree.js'
import { actualRoundTeams, actualWinner, computeKnockoutScore } from './scoring.js'
import { picksToRounds } from './reconstruct.js'
import { MAX_POINTS } from './constants.js'

// Read-only view of ONE player's knockout bracket (no taps, no save).
// Mirrors KnockoutPredict's layout + result coloring, but every cell is static.
// `picks` = node→team, already reconstructed via roundsToPicks for this member.

function Flag({ code }) {
  const [broken, setBroken] = useState(false)
  if (!code || broken) return <div className="rtf-m-flag-ph" />
  return (
    <img src={`https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${code}.svg`}
      alt="" className="rtf-m-flag" onError={() => setBroken(true)} />
  )
}
const short = t => (t ? (TEAM_SHORT[t] ?? t) : 'TBD')
const isR16 = n => NODES_BY_PHASE.r16.includes(n)
const roundOfNode = n =>
  isR16(n) ? 'qf' : NODES_BY_PHASE.qf.includes(n) ? 'sf' : 'final'

export default function ReadonlyBracket({ picks, games, teamCodeMap }) {
  const codeOf = t => teamCodeMap[t]
  const byNode = useMemo(() => placeGamesOnNodes(games || []), [games])
  const actual = useMemo(() => actualRoundTeams(games || []), [games])
  const score = useMemo(
    () => computeKnockoutScore(picksToRounds(picks), games || []),
    [picks, games]
  )
  const actualChampion  = useMemo(() => actualWinner(games || [], 'final'), [games])
  const actualBronzeWin = useMemo(() => actualWinner(games || [], 'third'), [games])

  // Result colour for a bracket pick once its round has actual teams.
  const teamResultClass = (team, round) => {
    if (!team) return ''
    const act = actual[round]
    if (!act || act.size === 0) return ''
    if (!act.has(team)) return ' rtf-pred-row--wrong'
    return score.breakdown[round]?.bonus > 0 ? ' rtf-pred-row--gold' : ' rtf-pred-row--correct'
  }
  const winnerResultClass = (team, actualTeam) => {
    if (!team || !actualTeam) return ''
    return team === actualTeam ? ' rtf-pred-row--gold' : ' rtf-pred-row--wrong'
  }

  // Static actual R32 card (establishes the R16 matchups)
  function ActualCard({ node }) {
    const g = byNode[node]
    if (!g) return (
      <div className="rtf-match rtf-match--empty">
        <div className="rtf-m-row"><div className="rtf-m-flag-ph" /><span className="rtf-m-name">—</span></div>
        <div className="rtf-m-row"><div className="rtf-m-flag-ph" /><span className="rtf-m-name">—</span></div>
      </div>
    )
    const row = team => (
      <div className={`rtf-m-row${g.knockout_winner === team ? ' rtf-m-row--win' : ''}`}>
        <Flag code={codeOf(team)} /><span className="rtf-m-name">{short(team)}</span>
      </div>
    )
    return <div className="rtf-match">{row(g.team_home)}{row(g.team_away)}</div>
  }

  // Static pick card — two candidates, the member's pick highlighted + coloured.
  function PickCard({ node }) {
    const cands = nodeCandidates(node, byNode, picks)
    const sel = picks[node]
    const round = roundOfNode(node)
    return (
      <div className="rtf-match rtf-pred">
        {cands.map((team, i) => {
          const isSel = team && sel === team
          const result = isSel ? teamResultClass(team, round) : ''
          return (
            <div key={i} className={`rtf-pred-row rtf-pred-row--ro${isSel ? ' rtf-pred-row--sel' : ''}${result}`}>
              <Flag code={codeOf(team)} />
              <span className="rtf-m-name">{short(team)}</span>
              {isSel && <span className="rtf-pred-tick" aria-hidden="true">✓</span>}
            </div>
          )
        })}
      </div>
    )
  }

  // Static winner card (champion / 3rd-place winner) — the member's single pick.
  function WinnerCard({ node, teams, actualTeam }) {
    const sel = picks[node]
    return (
      <div className="rtf-match rtf-pred">
        {[0, 1].map(i => {
          const team = teams[i]
          const isSel = team && sel === team
          const result = isSel ? winnerResultClass(team, actualTeam) : ''
          return (
            <div key={i} className={`rtf-pred-row rtf-pred-row--ro${isSel ? ' rtf-pred-row--sel' : ''}${result}`}>
              <Flag code={codeOf(team)} />
              <span className="rtf-m-name">{short(team)}</span>
              {isSel && <span className="rtf-pred-tick" aria-hidden="true">✓</span>}
            </div>
          )
        })}
      </div>
    )
  }

  function renderCol(col, side) {
    return (
      <div key={`${col.phase}-${side}`} className="rtf-col">
        <div className="rtf-round-title">{PHASE_LABEL[col.phase]}</div>
        <div className="rtf-col-slots">
          {col.nodes.map(node =>
            col.phase === 'r32'
              ? <ActualCard key={node} node={node} />
              : <PickCard key={node} node={node} />
          )}
        </div>
      </div>
    )
  }

  const finalists = [picks.LS, picks.RS]
  const bronze = bronzeTeams(picks)

  return (
    <div className="rtf-predict rtf-predict--ro">
      <div className="rtf-pred-head">
        <div className="rtf-pred-stat">
          <span className="rtf-pred-stat-num">{score.total}</span>
          <span className="rtf-pred-stat-lbl">pts (of {MAX_POINTS})</span>
        </div>
      </div>
      <div className="rtf-bracket-scroll">
        <div className="rtf-bracket">
          <div className="rtf-side">{LEFT_COLS.map(c => renderCol(c, 'left'))}</div>
          <div className="rtf-center">
            <div className="rtf-round-title">Champion</div>
            <WinnerCard node={CHAMPION_NODE} teams={finalists} actualTeam={actualChampion} />
            <div className="rtf-round-title rtf-third-title">3rd Place Winner</div>
            <WinnerCard node={THIRD_WINNER_NODE} teams={bronze} actualTeam={actualBronzeWin} />
          </div>
          <div className="rtf-side">{RIGHT_COLS.map(c => renderCol(c, 'right'))}</div>
        </div>
      </div>
    </div>
  )
}
