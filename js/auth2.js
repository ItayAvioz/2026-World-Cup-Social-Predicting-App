// js/auth.js — Registration, login, session guard, invite flow
// Uses _supabase from js/supabase.js (must be loaded before this file)

(async () => {
  // File:// protocol — app must be served from a web server
  if (window.location.protocol === 'file:' || !_supabase) {
    const hero = document.querySelector('.hero-content') || document.body
    hero.insertAdjacentHTML('afterbegin', `
      <div style="background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem;text-align:center">
        <p style="color:#f0f0f0;font-size:1rem;margin:0 0 .75rem">⚠️ App cannot run from a local file</p>
        <p style="color:#888;font-size:.875rem;margin:0">Open a terminal in the project folder and run:<br>
        <code style="background:#0a0a0a;color:#4ade80;padding:.2em .6em;border-radius:4px;margin-top:.5rem;display:inline-block">npm run dev</code><br>
        <span style="font-size:.75rem;color:#666;margin-top:.5rem;display:block">then visit localhost:5173</span></p>
      </div>
    `)
    return
  }

  // Parse invite code from URL query string → persist for after auth
  const params = new URLSearchParams(window.location.search)
  const inviteCode = params.get('invite')
  if (inviteCode) localStorage.setItem('wc2026_pending_invite', inviteCode)

  // Session guard — already logged in?
  const { data: { session } } = await _supabase.auth.getSession()
  if (session) {
    const pending = localStorage.getItem('wc2026_pending_invite')
    if (pending) {
      localStorage.removeItem('wc2026_pending_invite')
      // Pass code in URL — Groups.jsx handles the join with full error feedback
      window.location.href = `./app.html#/groups?invite=${encodeURIComponent(pending)}`
    } else {
      window.location.href = './app.html#/dashboard'
    }
    return
  }

  // ── FORM TOGGLE ──────────────────────────────────────────────
  const formRegister = document.getElementById('form-register')
  const formLogin    = document.getElementById('form-login')
  const toggleLink   = document.getElementById('toggle-link')
  const toggleText   = document.getElementById('toggle-text')
  const formSub      = document.getElementById('form-sub')

  let isLogin = false

  toggleLink.addEventListener('click', e => {
    e.preventDefault()
    isLogin = !isLogin
    formRegister.style.display = isLogin ? 'none' : ''
    formLogin.style.display    = isLogin ? ''     : 'none'
    toggleText.textContent     = isLogin ? "Don't have an account? " : 'Already have an account? '
    toggleLink.textContent     = isLogin ? 'Sign Up' : 'Sign In'
    formSub.textContent        = isLogin
      ? 'Sign in to continue predicting'
      : 'Join thousands of fans predicting the 2026 World Cup and compete with friends'
  })

  // ── REGISTER ─────────────────────────────────────────────────
  formRegister.addEventListener('submit', async e => {
    e.preventDefault()
    const username = document.getElementById('reg-username').value.trim()
    const email    = document.getElementById('reg-email').value.trim()
    const password = document.getElementById('reg-password').value

    if (username.length < 3 || username.length > 20 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      showToast('Username must be 3–20 characters (letters, numbers, underscores)', 'error')
      return
    }

    const btn = formRegister.querySelector('button[type=submit]')
    btn.disabled = true
    btn.textContent = 'Creating account…'

    const { error: signUpError } = await _supabase.auth.signUp({
      email, password,
      options: { data: { username } }
    })

    if (signUpError) {
      showToast(signUpError.message, 'error')
      btn.disabled = false
      btn.textContent = 'Create Account →'
      return
    }

    const pending = localStorage.getItem('wc2026_pending_invite')
    if (pending) localStorage.removeItem('wc2026_pending_invite')

    // Await profile creation with 1.5s cap — ensures no pending request when redirect fires
    await Promise.race([
      _supabase.rpc('create_profile', { p_username: username }),
      new Promise(resolve => setTimeout(resolve, 1500))
    ]).catch(() => {})

    localStorage.setItem('wc2026_welcome', username)
    btn.textContent = '✓ Redirecting…'
    // Pass invite code in URL — Groups.jsx handles the join (with retry for profile race)
    window.location.href = pending
      ? `./app.html#/groups?invite=${encodeURIComponent(pending)}`
      : './app.html#/dashboard'
  })

  // ── LOGIN ─────────────────────────────────────────────────────
  formLogin.addEventListener('submit', async e => {
    e.preventDefault()
    const email    = document.getElementById('login-email').value.trim()
    const password = document.getElementById('login-password').value

    const btn = formLogin.querySelector('button[type=submit]')
    btn.disabled = true
    btn.textContent = 'Signing in…'

    const { data: signInData, error } = await _supabase.auth.signInWithPassword({ email, password })

    if (error) {
      showToast(error.message, 'error')
      btn.disabled = false
      btn.textContent = 'Login →'
      return
    }

    // Profile fallback — fix any user who registered before profile creation was reliable
    const { data: profile } = await _supabase
      .from('profiles').select('id').eq('id', signInData.user.id).maybeSingle()
    if (!profile) {
      const username = signInData.user.user_metadata?.username
        || email.split('@')[0]
      await _supabase.rpc('create_profile', { p_username: username })
    }

    const pending = localStorage.getItem('wc2026_pending_invite')
    if (pending) {
      localStorage.removeItem('wc2026_pending_invite')
      // Pass code in URL — Groups.jsx handles the join with full error feedback
      window.location.href = `./app.html#/groups?invite=${encodeURIComponent(pending)}`
    } else {
      window.location.href = './app.html#/dashboard'
    }
  })
})()
