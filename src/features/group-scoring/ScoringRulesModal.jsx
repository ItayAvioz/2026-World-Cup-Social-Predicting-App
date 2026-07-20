import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase.js'
import Modal from '../../components/Modal.jsx'
import { SYSTEM_DEFAULTS } from './constants.js'

const STEPS = ['Group Stage', 'Knockout', 'Picks', 'Extras', 'Confirm']

const EMPTY_DRAFT = {
  ...SYSTEM_DEFAULTS,
  group_stage_outcome_points: '',
  group_stage_exact_points: '',
  group_stage_exact_odds_multiplier: '3',
  knockout_outcome_points: '',
  knockout_exact_points: '',
  knockout_exact_odds_multiplier: '3',
  champion_custom_points: '',
  top_scorer_custom_points: '',
}

function num(v) { return v === '' || v === null || v === undefined ? null : Number(v) }

function summaryLines(d) {
  const match = (mode, x, y, m) =>
    mode === 'system' ? 'Correct result 1 pt · Exact 3 pts'
    : mode === 'odds' ? `Correct result = odds · Exact = odds ×${m || '?'}`
    : `Correct result ${x || '?'} pts · Exact ${y || '?'} pts`
  return [
    ['Group Stage', match(d.group_stage_mode, d.group_stage_outcome_points, d.group_stage_exact_points, d.group_stage_exact_odds_multiplier)],
    ['Knockout', match(d.knockout_mode, d.knockout_outcome_points, d.knockout_exact_points, d.knockout_exact_odds_multiplier)
      + (d.knockout_result_basis === 'extra_time' ? ' · after extra time' : ' · after 90 minutes')],
    ['Champion', d.champion_mode === 'system' ? '10 pts' : d.champion_mode === 'odds' ? 'Team odds at pick time' : `${d.champion_custom_points || '?'} pts`],
    ['Top Scorer', d.top_scorer_mode === 'system' ? '10 pts' : `${d.top_scorer_custom_points || '?'} pts`],
    ['Trivia', !d.trivia_included ? 'Not counted' : d.trivia_inclusion_timing === 'immediate' ? 'Counted immediately' : 'Counted at tournament end'],
    ['Road to Final', !d.bracket_included ? 'Not counted' : d.bracket_inclusion_timing === 'immediate' ? 'Counted immediately' : 'Counted at tournament end'],
  ]
}

function ModeRow({ label, value, options, onChange }) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <div className="gs-seg">
        {options.map(([v, txt]) => (
          <button key={v} type="button"
            className={`gs-seg-btn${value === v ? ' gs-seg-btn--active' : ''}`}
            onClick={() => onChange(v)}>
            {txt}
          </button>
        ))}
      </div>
    </div>
  )
}

function NumInput({ label, value, onChange, step = '0.5' }) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <input type="number" inputMode="decimal" min="0" step={step} value={value}
        onChange={e => onChange(e.target.value)} />
    </div>
  )
}

export default function ScoringRulesModal({ isOpen, onClose, group, isCaptain, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [locked, setLocked] = useState(false)
  const [hasConfig, setHasConfig] = useState(false)
  const [step, setStep] = useState(0)
  const [d, setD] = useState(EMPTY_DRAFT)

  useEffect(() => {
    if (!isOpen) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !group) return
    setLoading(true); setError(null); setStep(0)
    supabase.from('group_scoring_config').select('*').eq('group_id', group.id).maybeSingle()
      .then(({ data, error: e }) => {
        if (e) { setError(e.message); setLoading(false); return }
        if (data) {
          setHasConfig(true)
          setLocked(!!data.locked_at)
          setD({
            ...EMPTY_DRAFT,
            ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v ?? EMPTY_DRAFT[k] ?? ''])),
          })
        } else {
          setHasConfig(false); setLocked(false); setD(EMPTY_DRAFT)
        }
        setLoading(false)
      })
  }, [isOpen, group])

  if (!group) return null
  const readOnly = !isCaptain || locked
  const set = (k) => (v) => setD(prev => ({ ...prev, [k]: v }))

  const warnings = []
  if (d.group_stage_mode === 'custom' && num(d.group_stage_exact_points) !== null && num(d.group_stage_outcome_points) !== null
      && num(d.group_stage_exact_points) < num(d.group_stage_outcome_points))
    warnings.push('Group-stage exact points are lower than correct-result points.')
  if (d.knockout_mode === 'custom' && num(d.knockout_exact_points) !== null && num(d.knockout_outcome_points) !== null
      && num(d.knockout_exact_points) < num(d.knockout_outcome_points))
    warnings.push('Knockout exact points are lower than correct-result points.')
  if ((d.group_stage_mode === 'odds' && num(d.group_stage_exact_odds_multiplier) > 10)
      || (d.knockout_mode === 'odds' && num(d.knockout_exact_odds_multiplier) > 10))
    warnings.push('That exact-score multiplier is unusually high.')

  async function save(confirm) {
    setSaving(true); setError(null)
    const { error: e } = await supabase.rpc('save_group_scoring_config', {
      p_group_id: group.id,
      p_group_stage_mode: d.group_stage_mode,
      p_knockout_mode: d.knockout_mode,
      p_knockout_result_basis: d.knockout_result_basis,
      p_champion_mode: d.champion_mode,
      p_top_scorer_mode: d.top_scorer_mode,
      p_trivia_included: d.trivia_included,
      p_bracket_included: d.bracket_included,
      p_group_stage_outcome_points: num(d.group_stage_outcome_points),
      p_group_stage_exact_points: num(d.group_stage_exact_points),
      p_group_stage_exact_odds_multiplier: num(d.group_stage_exact_odds_multiplier),
      p_knockout_outcome_points: num(d.knockout_outcome_points),
      p_knockout_exact_points: num(d.knockout_exact_points),
      p_knockout_exact_odds_multiplier: num(d.knockout_exact_odds_multiplier),
      p_champion_custom_points: num(d.champion_custom_points),
      p_top_scorer_custom_points: num(d.top_scorer_custom_points),
      p_trivia_inclusion_timing: d.trivia_included ? d.trivia_inclusion_timing : null,
      p_bracket_inclusion_timing: d.bracket_included ? d.bracket_inclusion_timing : null,
      p_confirm: confirm,
    })
    setSaving(false)
    if (e) {
      const msg = e.message ?? ''
      setError(
        msg.includes('not_captain') ? 'Only the group captain can change scoring rules.'
        : msg.includes('config_locked') ? 'Rules are locked and can no longer be changed.'
        : msg.includes('invalid_multiplier') ? 'The odds multiplier must be greater than 0.'
        : msg.includes('invalid_custom_points') ? 'Custom points must be filled in and cannot be negative.'
        : msg.includes('invalid_timing') ? 'Choose when the points are counted.'
        : `Could not save: ${msg}`)
      return
    }
    onSaved?.(confirm)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h2 className="modal-title">{readOnly ? '📊 Scoring Rules' : '⚙️ Group Scoring Rules'}</h2>

      {loading ? (
        <div className="dash-skeleton" style={{ height: 120 }} />
      ) : readOnly ? (
        <div className="gs-summary">
          {!hasConfig && <p className="grp-modal-note">This group uses the standard system rules.</p>}
          {summaryLines(d).map(([k, v]) => (
            <div key={k} className="gs-summary-row"><span className="gs-summary-k">{k}</span><span>{v}</span></div>
          ))}
          {locked && <p className="grp-modal-note">🔒 Rules are locked.</p>}
          {!isCaptain && !locked && hasConfig && <p className="grp-modal-note">Draft — not confirmed by the captain yet.</p>}
        </div>
      ) : (
        <>
          <div className="gs-steps">
            {STEPS.map((s, i) => (
              <button key={s} type="button"
                className={`gs-step-btn${i === step ? ' gs-step-btn--active' : ''}`}
                onClick={() => setStep(i)}>
                {i + 1}. {s}
              </button>
            ))}
          </div>

          {step === 0 && (
            <div>
              <ModeRow label="Group-stage match scoring" value={d.group_stage_mode}
                options={[['system', 'System ★'], ['odds', 'Odds'], ['custom', 'Custom']]}
                onChange={set('group_stage_mode')} />
              {d.group_stage_mode === 'system' && <p className="grp-modal-note">Correct result: 1 pt · Exact score: 3 pts (recommended)</p>}
              {d.group_stage_mode === 'odds' && (
                <>
                  <p className="grp-modal-note">Correct result earns the odds of your predicted outcome, locked when you submit. Exact score = odds × multiplier.</p>
                  <NumInput label="Exact-score multiplier" value={d.group_stage_exact_odds_multiplier} onChange={set('group_stage_exact_odds_multiplier')} />
                </>
              )}
              {d.group_stage_mode === 'custom' && (
                <>
                  <NumInput label="Correct result (W/D/L) points" value={d.group_stage_outcome_points} onChange={set('group_stage_outcome_points')} />
                  <NumInput label="Exact score points" value={d.group_stage_exact_points} onChange={set('group_stage_exact_points')} />
                </>
              )}
            </div>
          )}

          {step === 1 && (
            <div>
              <ModeRow label="Knockout match scoring" value={d.knockout_mode}
                options={[['system', 'System ★'], ['odds', 'Odds'], ['custom', 'Custom']]}
                onChange={set('knockout_mode')} />
              {d.knockout_mode === 'system' && <p className="grp-modal-note">Correct result: 1 pt · Exact score: 3 pts (recommended)</p>}
              {d.knockout_mode === 'odds' && (
                <NumInput label="Exact-score multiplier" value={d.knockout_exact_odds_multiplier} onChange={set('knockout_exact_odds_multiplier')} />
              )}
              {d.knockout_mode === 'custom' && (
                <>
                  <NumInput label="Correct result (W/D/L) points" value={d.knockout_outcome_points} onChange={set('knockout_outcome_points')} />
                  <NumInput label="Exact score points" value={d.knockout_exact_points} onChange={set('knockout_exact_points')} />
                </>
              )}
              <ModeRow label="Score result based on" value={d.knockout_result_basis}
                options={[['ninety_minutes', '90 minutes ★'], ['extra_time', 'Include extra time']]}
                onChange={set('knockout_result_basis')} />
              <p className="grp-modal-note">Penalty shootouts never affect the predicted match score.</p>
            </div>
          )}

          {step === 2 && (
            <div>
              <ModeRow label="Champion pick" value={d.champion_mode}
                options={[['system', 'System — 10 pts ★'], ['odds', 'Odds'], ['custom', 'Custom']]}
                onChange={set('champion_mode')} />
              {d.champion_mode === 'odds' && <p className="grp-modal-note">A correct champion earns the team's winner odds, locked when the pick was made.</p>}
              {d.champion_mode === 'custom' && (
                <NumInput label="Correct champion points" value={d.champion_custom_points} onChange={set('champion_custom_points')} />
              )}
              <ModeRow label="Top scorer pick" value={d.top_scorer_mode}
                options={[['system', 'System — 10 pts ★'], ['custom', 'Custom']]}
                onChange={set('top_scorer_mode')} />
              {d.top_scorer_mode === 'custom' && (
                <NumInput label="Correct top scorer points" value={d.top_scorer_custom_points} onChange={set('top_scorer_custom_points')} />
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <ModeRow label="Count Trivia points in this group?" value={d.trivia_included ? 'yes' : 'no'}
                options={[['yes', 'Yes'], ['no', 'No']]}
                onChange={(v) => setD(prev => ({ ...prev, trivia_included: v === 'yes' }))} />
              {d.trivia_included && (
                <ModeRow label="When?" value={d.trivia_inclusion_timing}
                  options={[['immediate', 'Immediately'], ['tournament_finish', 'At tournament end ★']]}
                  onChange={set('trivia_inclusion_timing')} />
              )}
              <ModeRow label="Count Road to Final points?" value={d.bracket_included ? 'yes' : 'no'}
                options={[['yes', 'Yes'], ['no', 'No']]}
                onChange={(v) => setD(prev => ({ ...prev, bracket_included: v === 'yes' }))} />
              {d.bracket_included && (
                <ModeRow label="When?" value={d.bracket_inclusion_timing}
                  options={[['immediate', 'Immediately'], ['tournament_finish', 'At tournament end ★']]}
                  onChange={set('bracket_inclusion_timing')} />
              )}
            </div>
          )}

          {step === 4 && (
            <div className="gs-summary">
              {summaryLines(d).map(([k, v]) => (
                <div key={k} className="gs-summary-row"><span className="gs-summary-k">{k}</span><span>{v}</span></div>
              ))}
              {warnings.map(w => <p key={w} className="gs-warn">⚠️ {w}</p>)}
              <p className="grp-modal-note">Confirming locks the rules — they cannot be changed afterwards. All members can view them.</p>
            </div>
          )}

          {error && <p className="gs-error">⚠️ {error}</p>}

          <div className="gs-footer">
            {step < 4 ? (
              <button className="btn btn-gold btn-full" type="button" onClick={() => setStep(step + 1)}>Next</button>
            ) : (
              <>
                <button className="btn btn-outline btn-full" type="button" disabled={saving} onClick={() => save(false)}>
                  {saving ? 'Saving…' : 'Save draft'}
                </button>
                <button className="btn btn-gold btn-full" type="button" disabled={saving} onClick={() => save(true)}>
                  {saving ? 'Saving…' : '🔒 Confirm & lock rules'}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
