import { useState, useEffect, useMemo } from 'react'
import {
  LEFT_COLS, RIGHT_COLS, PHASE_LABEL, TEAM_SHORT,
  NODES_BY_PHASE, nodeCandidates, bronzeTeams, CHAMPION_NODE, THIRD_WINNER_NODE,
} from './bracketTree.js'
import { useKnockoutPrediction } from './useKnockoutPrediction.js'
import { knockoutReached, knockoutEliminated, knockoutOutOfBronze, actualWinner } from './scoring.js'
import {
  MAX_POINTS, KO_PREDICT_LOCK, KO_FINAL_KICKOFF, ROUND_BONUS, PER_TEAM,
  CHAMPION_POINTS, THIRD_WINNER_POINTS,
} from './constants.js'

function Flag({ name, code }) {
  const [broken, setBroken] = useState(false)
  if (!code || broken) return <div className="rtf-m-flag-ph" />
  return (
    <img src={`https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${code}.svg`}
      alt="" className="rtf-m-flag" onError={() => setBroken(true)} />
  )
}
const short = t => (t ? (TEAM_SHORT[t] ?? t) : 'TBD')
const isR16 = n => NODES_BY_PHASE.r16.includes(n)

// Exact lock moment, formatted in Israel time (e.g. "Sat 4 Jul, 18:00").
const LOCK_LABEL = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', weekday: 'short', day: 'numeric', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(KO_PREDICT_LOCK))
// Which actual round a pick at this node must reach to be correct.
const roundOfNode = n =>
  isR16(n) ? 'qf' : NODES_BY_PHASE.qf.includes(n) ? 'sf' : 'final'

// Live countdown: closes-in → (after lock) time-to-final. Ticks every second.
function Countdown({ finalTs }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const lock = new Date(KO_PREDICT_LOCK).getTime()
  const final = new Date(finalTs || KO_FINAL_KICKOFF).getTime()
  const beforeLock = now < lock
  const target = beforeLock ? lock : final
  let ms = Math.max(0, target - now)
  const d = Math.floor(ms / 86400000); ms -= d * 86400000
  const h = Math.floor(ms / 3600000);  ms -= h * 3600000
  const m = Math.floor(ms / 60000);    ms -= m * 60000
  const s = Math.floor(ms / 1000)
  const pad = n => String(n).padStart(2, '0')
  const label = beforeLock ? 'closes in' : 'time to final'
  const cls = beforeLock ? 'rtf-clock' : 'rtf-clock rtf-clock--final'
  return (
    <div className={cls}>
      <span className="rtf-clock-lbl">{label}</span>
      <span className="rtf-clock-val">
        {d > 0 && <>{d}d </>}{pad(h)}:{pad(m)}:{pad(s)}
      </span>
      {beforeLock && <span className="rtf-clock-sub">{LOCK_LABEL} Israel</span>}
    </div>
  )
}

export default function KnockoutPredict({ games, userId, teamCodeMap, showToast }) {
  const { picks, byNode, setPick, save, saving, dirty, locked, score, filled } =
    useKnockoutPrediction(userId, games)
  const codeOf = t => teamCodeMap[t]
  const reached = useMemo(() => knockoutReached(games || []), [games])
  const eliminated = useMemo(() => knockoutEliminated(games || []), [games])
  const outOfBronze = useMemo(() => knockoutOutOfBronze(games || []), [games])
  const finalTs = useMemo(
    () => (games || []).find(g => g.phase === 'final' && g.kick_off_time)?.kick_off_time,
    [games]
  )

  // Per-game result colour for a picked team:
  //   reached its round  → gold (whole round all-correct = bonus) else green
  //   eliminated (lost)  → red
  //   still alive / game not played yet → uncolored (no premature red)
  const teamResultClass = (team, round) => {
    if (!team) return ''
    if (reached[round]?.has(team)) return score.breakdown[round]?.bonus > 0
      ? ' rtf-pred-row--gold'
      : ' rtf-pred-row--correct'
    if (eliminated.has(team)) return ' rtf-pred-row--wrong'
    return ''
  }

  // Read-only actual R32 card (establishes the R16 matchups)
  function ActualCard({ node }) {
    const g = byNode[node]
    if (!g) return <div className="rtf-match rtf-match--empty"><div className="rtf-m-row"><div className="rtf-m-flag-ph" /><span className="rtf-m-name">—</span></div><div className="rtf-m-row"><div className="rtf-m-flag-ph" /><span className="rtf-m-name">—</span></div></div>
    const row = team => (
      <div className={`rtf-m-row${g.knockout_winner === team ? ' rtf-m-row--win' : ''}`}>
        <Flag name={team} code={codeOf(team)} /><span className="rtf-m-name">{short(team)}</span>
      </div>
    )
    return <div className="rtf-match">{row(g.team_home)}{row(g.team_away)}</div>
  }

  // Tappable R16/QF/SF node — pick the winner of the two candidates.
  // On an SF box the NON-selected candidate is the implicit 3rd-place pick (win-gated):
  // colour it against the actual bronze winner so its +2 is visible, not silent.
  function PickCard({ node }) {
    const cands = nodeCandidates(node, byNode, picks)
    const sel = picks[node]
    const round = roundOfNode(node)
    const isSf = NODES_BY_PHASE.sf.includes(node)
    return (
      <div className="rtf-match rtf-pred">
        {cands.map((team, i) => {
          const isSel = team && sel === team
          const isThird = isSf && !!sel && !!team && !isSel
          const result = isSel ? teamResultClass(team, round)
            : isThird ? winnerResultClass(team, true, actualBronzeWin, outOfBronze.has(team))
            : ''
          const showTick = isSel || (isThird && !!result)
          return (
            <button
              key={i}
              type="button"
              className={`rtf-pred-row${isSel ? ' rtf-pred-row--sel' : ''}${result}`}
              disabled={!team || locked}
              onClick={() => team && setPick(node, team)}
            >
              <Flag name={team} code={codeOf(team)} />
              <span className="rtf-m-name">{short(team)}</span>
              {showTick && <span className="rtf-pred-tick" aria-hidden="true">{result.includes('wrong') ? '✗' : '✓'}</span>}
            </button>
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

  // Centre: finalists (SF picks) → tap the champion; 3rd/4th (SF losers) → tap the winner.
  const finalists = [picks.LS, picks.RS]
  const bronze = bronzeTeams(picks)
  const actualChampion = useMemo(() => actualWinner(games || [], 'final'), [games])
  const actualBronzeWin = useMemo(() => actualWinner(games || [], 'third'), [games])

  // Colour the SELECTED winner row. Once the game is decided → gold if right, red if wrong.
  // Before that, `isOut(team)` reds-out a pick that can no longer win, so a dead pick doesn't
  // stay gold. Each card passes its OWN out-test: champion → `eliminated` (any KO loss ends the
  // title run); 3rd-winner → `outOfBronze` (SF losers stay eligible). Never share the same set.
  const winnerResultClass = (team, isSel, actual, isOut) => {
    if (!team || !isSel) return ''
    if (actual) return team === actual ? ' rtf-pred-row--gold' : ' rtf-pred-row--wrong'
    if (isOut) return ' rtf-pred-row--wrong'
    return ''
  }

  // Tap one of two teams to crown the winner of a single match (champion / 3rd-place).
  function WinnerPickCard({ node, teams, actual, outFn }) {
    const sel = picks[node]
    return (
      <div className="rtf-match rtf-pred">
        {[0, 1].map(i => {
          const team = teams[i]
          const isSel = team && sel === team
          const result = isSel ? winnerResultClass(team, isSel, actual, outFn?.(team)) : ''
          return (
            <button
              key={i}
              type="button"
              className={`rtf-pred-row${isSel ? ' rtf-pred-row--sel' : ''}${result}`}
              disabled={!team || locked}
              onClick={() => team && setPick(node, team)}
            >
              <Flag name={team} code={codeOf(team)} />
              <span className="rtf-m-name">{short(team)}</span>
              {isSel && <span className="rtf-pred-tick" aria-hidden="true">{result.includes('wrong') ? '✗' : '✓'}</span>}
            </button>
          )
        })}
      </div>
    )
  }

  async function onSave() {
    const { error } = await save()
    if (error) showToast?.(error.message === 'predictions_locked' ? 'Predictions are locked' : 'Save failed — try again', 'error')
    else showToast?.('Bracket prediction saved!', 'success')
  }

  return (
    <div className="rtf-predict">
      <div className="rtf-pred-head">
        <div className="rtf-pred-stat">
          <span className="rtf-pred-stat-num">{score.total}</span>
          <span className="rtf-pred-stat-lbl">your pts (of {MAX_POINTS})</span>
        </div>
        <div className="rtf-pred-stat">
          <span className="rtf-pred-stat-num">{filled}/16</span>
          <span className="rtf-pred-stat-lbl">picks made</span>
        </div>
        <Countdown finalTs={finalTs} />
        {!locked && (
          <button className="btn btn-gold rtf-pred-save" onClick={onSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      <p className="rtf-pred-note">
        {locked
          ? `🔒 Predictions locked (${LOCK_LABEL} Israel). Counts toward the leaderboard from Jul 20.`
          : `Tap a team to send it through. Locks ${LOCK_LABEL} Israel time · counts toward the leaderboard from Jul 20.`}
      </p>

      <details className="rtf-score-help">
        <summary>How scoring works · max {MAX_POINTS} pts</summary>
        <div className="rtf-score-help-body">
          <p><b>+{PER_TEAM} pts</b> for every team you correctly send into a round (QF, SF, Final).</p>
          <p><b>All-correct bonus</b> when every team in a round is right:
            QF +{ROUND_BONUS.qf} · SF +{ROUND_BONUS.sf} · Final +{ROUND_BONUS.final}.</p>
          <p><b>3rd place +{PER_TEAM}</b> for the team that <b>wins</b> the 3rd-place play-off
            (not just reaches it).</p>
          <p><b>Champion +{CHAMPION_POINTS}</b> for the correct Final winner ·
            <b> 3rd-place winner +{THIRD_WINNER_POINTS}</b> for the correct 3rd/4th winner.</p>
          <p>Once a round is played, your pick turns <span className="rtf-h rtf-h-green">green</span> if right,
            <span className="rtf-h rtf-h-red">red</span> if wrong, and <span className="rtf-h rtf-h-gold">gold</span> when you nail the whole round.</p>
          <p>It's one bracket per player. Points fold into the leaderboard on <b>Jul 20</b>.</p>
        </div>
      </details>

      <div className="rtf-bracket-scroll">
        <div className="rtf-bracket">
          <div className="rtf-side">{LEFT_COLS.map(c => renderCol(c, 'left'))}</div>
          <div className="rtf-center">
            <div className="rtf-round-title">Champion</div>
            <WinnerPickCard node={CHAMPION_NODE} teams={finalists} actual={actualChampion} outFn={t => eliminated.has(t)} />
            <div className="rtf-round-title rtf-third-title">3rd Place Winner</div>
            <WinnerPickCard node={THIRD_WINNER_NODE} teams={bronze} actual={actualBronzeWin} outFn={t => outOfBronze.has(t)} />
          </div>
          <div className="rtf-side">{RIGHT_COLS.map(c => renderCol(c, 'right'))}</div>
        </div>
      </div>
    </div>
  )
}
