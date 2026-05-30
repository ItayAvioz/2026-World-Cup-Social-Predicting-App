// Supabase client — hostname-routed single source of truth for vanilla pages
// window.supabase is exposed by the UMD CDN script loaded before this file
//
// Routing:
//   pickyguessers.com (or www.) → PROD project (asugxlvgcmkxspzokydk, Frankfurt)
//   anything else (localhost / 127.0.0.1 / file://) → DEV project (ftryuvfdihmhlzvbpfeu, Tokyo)
//
// Both anon keys are safe to expose (publishable-class keys, RLS gates real access).

const _host = typeof window !== 'undefined' ? window.location.hostname : ''
const _isProd = _host === 'pickyguessers.com' || _host === 'www.pickyguessers.com'

const SUPABASE_URL      = _isProd
  ? 'https://asugxlvgcmkxspzokydk.supabase.co'
  : 'https://ftryuvfdihmhlzvbpfeu.supabase.co'

const SUPABASE_ANON_KEY = _isProd
  ? 'sb_publishable_CMmLSm_rA43-5Y0PLfHHog_36NKnjCA'
  : 'sb_publishable_hNTtICDrKMNgAclh28BhrQ_bHTeeFB9'

const _supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) ?? null
