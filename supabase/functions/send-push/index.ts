import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('Notification_Key')!
const VAPID_PUBLIC_KEY = 'BJ20vvrlNRoYvxDAes6ZRhNx76MDWV-Oblzbohn98B2vGLZMSVQSbCG9CiVyqewFFFvV2E0WqPKmPiHmH0MMTac'

webpush.setVapidDetails('mailto:itayavioz1@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

Deno.serve(async (req) => {
  try {
    const { title, body, url = '/app.html#/dashboard', user_ids } = await req.json()

    if (!title || !body) return new Response(JSON.stringify({ error: 'title and body required' }), { status: 400 })

    // Fetch subscriptions — all users or specific user_ids
    let query = supabase.from('push_subscriptions').select('*')
    if (user_ids?.length) query = query.in('user_id', user_ids)
    const { data: subs, error } = await query
    if (error) throw error

    const payload = JSON.stringify({
      title,
      body,
      url,
      icon: 'https://itayavioz.github.io/2026-World-Cup-Social-Predicting-App/icon-notif.png',
      badge: 'https://itayavioz.github.io/2026-World-Cup-Social-Predicting-App/icon-badge.png'
    })

    const results = { sent: 0, failed: 0, stale: [] as string[] }

    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
        results.sent++
      } catch (err: any) {
        // 410 Gone = subscription expired/uninstalled → delete it
        if (err.statusCode === 410) {
          results.stale.push(sub.id)
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        } else {
          results.failed++
          console.error('push failed:', sub.id, err.message)
        }
      }
    }

    return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err: any) {
    console.error('send-push error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
