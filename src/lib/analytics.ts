import { useEffect } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export type EventType = 'page_view' | 'prediction_submit' | 'pick_submit' | 'heartbeat'

function getSessionId(): string {
  let id = sessionStorage.getItem('wc_session_id')
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem('wc_session_id', id)
  }
  return id
}

export function logEvent(
  supabase: SupabaseClient,
  userId: string,
  eventType: EventType,
  page?: string
): void {
  // Fire and forget — never blocks the UI
  supabase.from('app_events').insert({
    user_id:    userId,
    event_type: eventType,
    page:       page ?? null,
    session_id: getSessionId(),
  }).then()
}

export function useHeartbeat(supabase: SupabaseClient, userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return

    let interval: ReturnType<typeof setInterval> | null = null

    const tick = () => logEvent(supabase, userId, 'heartbeat')

    const start = () => {
      tick()
      interval = setInterval(tick, 15_000)
    }

    const stop = () => {
      if (interval !== null) {
        clearInterval(interval)
        interval = null
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop()
      } else {
        start()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    start()

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [userId])
}
