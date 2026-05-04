import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const ADMIN_EMAIL  = 'itayavioz1@gmail.com'
const FROM_ADDRESS = 'onboarding@resend.dev'
const RESEND_URL   = 'https://api.resend.com/emails'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function fmtTime(isoString: string): string {
  return new Date(isoString).toUTCString()
}

function priorityBadge(priority: string): string {
  if (priority === 'high')   return '🔴'
  if (priority === 'medium') return '🟡'
  return '🟢'
}

// ── Email builders ─────────────────────────────────────────────────────────────

function buildNewUser(d: Record<string, unknown>): { subject: string; html: string } {
  return {
    subject: `[WC2026] New user: ${d.username}`,
    html: `
      <h2>New registration</h2>
      <p><strong>Username:</strong> ${d.username}</p>
      <p><strong>User ID:</strong> ${d.id}</p>
      <p><strong>Time:</strong> ${fmtTime(d.created_at as string ?? new Date().toISOString())}</p>
    `,
  }
}

function buildFeedback(d: Record<string, unknown>): { subject: string; html: string } {
  const badge = priorityBadge(d.priority as string)
  const screenshotHtml = d.screenshot_url
    ? `<p><a href="${d.screenshot_url}">View screenshot</a></p>`
    : ''
  return {
    subject: `[WC2026] Feedback [${d.category}] ${badge} ${d.priority}`,
    html: `
      <h2>New feedback</h2>
      <table cellpadding="6" style="border-collapse:collapse">
        <tr><td><strong>Category</strong></td><td>${d.category}</td></tr>
        <tr><td><strong>Priority</strong></td><td>${badge} ${d.priority}</td></tr>
        <tr><td><strong>Message</strong></td><td>${d.message}</td></tr>
      </table>
      ${screenshotHtml}
      <p style="color:#888;font-size:12px">User: ${d.user_id} | ${fmtTime(d.created_at as string)}</p>
    `,
  }
}

function buildFailedSummary(d: Record<string, unknown>): { subject: string; html: string } {
  const contentLen = String(d.content ?? '').length
  return {
    subject: `[WC2026] AI summary failed — ${d.date}`,
    html: `
      <h2>AI summary failed to save</h2>
      <table cellpadding="6" style="border-collapse:collapse">
        <tr><td><strong>Group</strong></td><td>${d.group_id}</td></tr>
        <tr><td><strong>Date</strong></td><td>${d.date}</td></tr>
        <tr><td><strong>Error</strong></td><td>${d.error_msg ?? 'unknown'}</td></tr>
        <tr><td><strong>Content</strong></td><td>${contentLen} chars — not lost, saved in failed_summaries</td></tr>
      </table>
    `,
  }
}

function buildEfError(d: Record<string, unknown>): { subject: string; html: string } {
  const contextHtml = d.context
    ? `<pre style="background:#f5f5f5;padding:8px;font-size:12px">${JSON.stringify(d.context, null, 2)}</pre>`
    : ''
  return {
    subject: `[WC2026] EF error — ${d.ef_name} [${d.error_type}]`,
    html: `
      <h2>Edge Function error</h2>
      <table cellpadding="6" style="border-collapse:collapse">
        <tr><td><strong>Function</strong></td><td>${d.ef_name}</td></tr>
        <tr><td><strong>Type</strong></td><td>${d.error_type}</td></tr>
        <tr><td><strong>Message</strong></td><td>${d.error_msg}</td></tr>
      </table>
      ${contextHtml}
      <p style="color:#888;font-size:12px">${fmtTime(d.created_at as string)}</p>
    `,
  }
}

function buildDailyDigest(d: Record<string, unknown>): { subject: string; html: string } {
  // per-game rows
  const games = (d.games as Array<Record<string, unknown>> ?? [])
  const gameRows = games.length > 0
    ? games.map(g => {
        const total   = Number(g.total_preds)  || 0
        const exact   = Number(g.exact)        || 0
        const correct = Number(g.correct_outcome) || 0
        const auto    = Number(g.auto_preds)   || 0
        const exactPct   = total ? Math.round(exact   / total * 100) : 0
        const correctPct = total ? Math.round(correct / total * 100) : 0
        const autoPct    = total ? Math.round(auto    / total * 100) : 0
        return `<tr>
          <td>${g.team_home} ${g.score_home}–${g.score_away} ${g.team_away}</td>
          <td>${total} preds</td>
          <td>Exact: ${exact} (${exactPct}%)</td>
          <td>W/D/L: ${correct} (${correctPct}%)</td>
          <td>Auto: ${auto} (${autoPct}%)</td>
        </tr>`
      }).join('')
    : `<tr><td colspan="5" style="color:#888">No finished games yesterday</td></tr>`

  // ef errors list
  const efErrors = (d.ef_errors_list as Array<Record<string, unknown>> ?? [])
  const efErrorsHtml = efErrors.length > 0
    ? `<ul>${efErrors.map(e =>
        `<li><strong>${e.ef_name}</strong> [${e.error_type}]: ${e.error_msg}</li>`
      ).join('')}</ul>`
    : '<p style="color:green">No EF errors in the past 24h ✓</p>'

  // usage
  const avgSecs  = Number(d.avg_session_seconds) || 0
  const avgMins  = Math.floor(avgSecs / 60)
  const avgRem   = Math.round(avgSecs % 60)
  const avgLabel = avgSecs > 0 ? `${avgMins} min ${avgRem} sec` : '—'

  const peakHour = d.peak_hour !== null && d.peak_hour !== undefined
    ? `${String(d.peak_hour).padStart(2, '0')}:00–${String(Number(d.peak_hour) + 1).padStart(2, '0')}:00 UTC (${d.peak_active_users} active)`
    : '—'

  const row = (label: string, value: unknown) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555">${label}</td><td style="padding:4px 0"><strong>${value}</strong></td></tr>`

  return {
    subject: `[WC2026] Daily digest — ${d.digest_date}`,
    html: `
      <h2>WorldCup 2026 — Daily digest (${d.digest_date})</h2>

      <h3>Games yesterday</h3>
      <table cellpadding="6" style="border-collapse:collapse;width:100%">
        <thead><tr style="background:#f0f0f0">
          <th>Match</th><th>Predictions</th><th>Exact</th><th>W/D/L</th><th>Auto</th>
        </tr></thead>
        <tbody>${gameRows}</tbody>
      </table>

      <h3>AI summaries</h3>
      <table><tbody>
        ${row('Created',  d.summaries_created)}
        ${row('Failed',   d.summaries_failed)}
        ${row('Tokens in',  Number(d.tokens_in_total).toLocaleString())}
        ${row('Tokens out', Number(d.tokens_out_total).toLocaleString())}
      </tbody></table>

      <h3>Users &amp; feedback</h3>
      <table><tbody>
        ${row('New users',    d.new_users)}
        ${row('New feedback', d.new_feedback)}
      </tbody></table>

      <h3>App usage (yesterday)</h3>
      <table><tbody>
        ${row('Active users',    d.active_users)}
        ${row('Avg time/user',   avgLabel)}
        ${row('Peak hour',       peakHour)}
        ${row('Predictions',     d.prediction_actions)}
        ${row('Pick submits',    d.pick_actions)}
        ${row('Page views',      d.page_views)}
      </tbody></table>

      <h3>Judge LLM (yesterday)</h3>
      <table><tbody>
        ${row('Runs', Number(d.judge_runs) || 0)}
        ${row('v11-main wins',      Number(d.judge_v11_wins) || 0)}
        ${row('v12-picks wins',     Number(d.judge_v12_wins) || 0)}
        ${row('v13-unique wins',    Number(d.judge_v13_wins) || 0)}
        ${row('v10-baseline wins',  Number(d.judge_v10_wins) || 0)}
      </tbody></table>

      <h3>EF errors (24h) — ${d.ef_errors_count}</h3>
      ${efErrorsHtml}
    `,
  }
}

// ── Entry point ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)

    const body = await req.json() as { type: string; data?: Record<string, unknown> }
    const data = body.data ?? {}

    let subject: string
    let html: string

    switch (body.type) {
      case 'new_user':       ({ subject, html } = buildNewUser(data));        break
      case 'feedback':       ({ subject, html } = buildFeedback(data));       break
      case 'failed_summary': ({ subject, html } = buildFailedSummary(data));  break
      case 'ef_error':       ({ subject, html } = buildEfError(data));        break
      case 'daily_digest':   ({ subject, html } = buildDailyDigest(data));    break
      default:
        return json({ error: `Unknown type: ${body.type}` }, 400)
    }

    const res = await fetch(RESEND_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [ADMIN_EMAIL], subject, html }),
    })

    if (!res.ok) {
      const detail = await res.text()
      console.error('notify-admin: Resend error', res.status, detail)
      return json({ error: `Resend returned ${res.status}`, detail }, 500)
    }

    const resData = await res.json()
    return json({ sent: true, id: resData.id })

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('notify-admin error:', msg)
    return json({ error: msg }, 500)
  }
})
