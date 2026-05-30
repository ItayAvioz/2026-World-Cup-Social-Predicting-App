import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('Notification_Key')!

// Project-aware constants. Detected via SUPABASE_URL (auto-injected per project).
// Each project has its own VAPID keypair + frontend origin for icon/badge URLs.
const isProd = SUPABASE_URL.includes('asugxlvgcmkx')
const VAPID_PUBLIC_KEY = isProd
  ? 'BHqSjdXYn7Q8igXYPUtg9NXpKoGPVitpn1SXcKBUx627JiLT6MuoNR5UsH52Yz0cAljnzTVbVhShJrJTD-jG3BA'  // prod (pickyguessers.com)
  : 'BJ20vvrlNRoYvxDAes6ZRhNx76MDWV-Oblzbohn98B2vGLZMSVQSbCG9CiVyqewFFFvV2E0WqPKmPiHmH0MMTac'  // dev (itayavioz.github.io)
const ICON_BASE = isProd
  ? 'https://pickyguessers.com'
  : 'https://itayavioz.github.io/2026-World-Cup-Social-Predicting-App'

webpush.setVapidDetails('mailto:itayavioz1@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

Deno.serve(async (req) => {
  try {
    const { title, body, url = '/app.html#/dashboard', user_ids } = await req.json()

    if (!title || !body) return new Response(JSON.stringify({ error: 'title and body required' }), { status: 400 })

    let query = supabase.from('push_subscriptions').select('*')
    if (user_ids?.length) query = query.in('user_id', user_ids)
    const { data: subs, error } = await query
    if (error) throw error

    const payload = JSON.stringify({
      title,
      body,
      url,
      icon: `${ICON_BASE}/icon-notif.png?v=4`,
      badge: `${ICON_BASE}/icon-badge.png?v=4`
    })

    // urgency:'high' is the only "Time Sensitive" lever PWAs have (Apple's native entitlement is locked).
    // TTL:60 forces APNS/FCM to fail fast on dead endpoints (returns 410) so we can prune stale subs instead of silently swallowing for 4 weeks.
    const opts = { TTL: 60, urgency: 'high' as const }

    const outcomes = await Promise.allSettled(
      (subs ?? []).map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          opts
        )
        .then(() => ({ ok: true as const, id: sub.id }))
        .catch((err: any) => ({ ok: false as const, id: sub.id, statusCode: err?.statusCode, message: err?.message }))
      )
    )

    const results = { sent: 0, failed: 0, stale: [] as string[] }
    const staleIds: string[] = []

    for (const o of outcomes) {
      if (o.status !== 'fulfilled') { results.failed++; continue }
      const r = o.value
      if (r.ok) { results.sent++; continue }
      if (r.statusCode === 410 || r.statusCode === 404) {
        staleIds.push(r.id)
        results.stale.push(r.id)
      } else {
        results.failed++
        console.error('push failed:', r.id, r.statusCode, r.message)
      }
    }

    if (staleIds.length) {
      await supabase.from('push_subscriptions').delete().in('id', staleIds)
    }

    // Visibility: non-stale failures mean push may be broken for real users (bad VAPID, provider outage).
    // Log to ef_errors → triggers admin email + shows in daily digest. (410/404 are normal pruning, not logged.)
    if (results.failed > 0) {
      await supabase.from('ef_errors').insert({
        ef_name:    'send-push',
        error_type: 'push-send',
        error_msg:  `${results.failed} push send(s) failed (non-stale)`,
        context:    { sent: results.sent, failed: results.failed, stale: results.stale.length, title }
      })
    }

    return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err: any) {
    console.error('send-push error:', err.message)
    // Whole-batch failure (e.g. bad VAPID config) — log so a total push outage is not silent.
    try {
      await supabase.from('ef_errors').insert({
        ef_name: 'send-push', error_type: 'push-send', error_msg: err?.message ?? String(err), context: null
      })
    } catch { /* best-effort */ }
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
