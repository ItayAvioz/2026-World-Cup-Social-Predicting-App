// Supabase client — single source of truth for all pages
// window.supabase is exposed by the UMD CDN script loaded before this file

const SUPABASE_URL     = 'https://ftryuvfdihmhlzvbpfeu.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_hNTtICDrKMNgAclh28BhrQ_bHTeeFB9'

const _supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) ?? null
