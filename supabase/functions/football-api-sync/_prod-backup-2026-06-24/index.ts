/**
 * football-api-sync v18 — fixes RECURRING Bosnia name mismatch (Pattern B) at the ROOT.
 * normalizeTeam strips punctuation to EMPTY, so DB "Bosnia-Herzegovina" -> "bosniaherzegovina"
 * (hyphen deleted, words fused) while api "Bosnia & Herzegovina" -> "bosnia herzegovina"
 * (ampersand had spaces). They never matched, so canon() fell through to the raw api name and
 * re-stored "Bosnia & Herzegovina" EVERY Bosnia game. Fix: two TEAM_ALIASES entries map BOTH
 * normalized forms to the same key so canon() resolves to the DB games name. Diacritic ranges
 * rewritten as ̀-ͯ (ASCII-safe, behaviorally identical to v17's literal range).
 * (v17 czechia. v16 congo dr. v15 cape verde islands. v14 — writeStats canon().)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const FOOTBALL_API_BASE = 'https://v3.football.api-sports.io'
const WC_LEAGUE_ID = 1
const WC_SEASON    = 2026
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FOOTBALL_API_KEY = Deno.env.get('FOOTBALL_API_KEY')!
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}
async function reportEfError(supabase: ReturnType<typeof createClient>, errorType: 'crash' | 'quota' | 'stats_write', errorMsg: string, context?: Record<string, unknown>): Promise<void> {
  try { await supabase.from('ef_errors').insert({ ef_name: 'football-api-sync', error_type: errorType, error_msg: errorMsg, context: context ?? null }) } catch (e) { console.error('reportEfError failed:', e instanceof Error ? e.message : e) }
}
const TEAM_ALIASES: Record<string,string> = {"cote divoire":"ivory coast","korea republic":"south korea","cabo verde":"cape verde","cape verde islands":"cape verde","congo dr":"dr congo","czechia":"czech republic","usa":"united states","ir iran":"iran","turkiye":"turkey","bosnia herzegovina":"bosnia-herzegovina","bosniaherzegovina":"bosnia-herzegovina"}
function normalizeTeam(name: string): string {
  let n = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim()
  return TEAM_ALIASES[n] ?? n
}
async function footballApiGet(path: string): Promise<any[]> {
  const res = await fetch(`${FOOTBALL_API_BASE}${path}`, { headers: { 'x-apisports-key': FOOTBALL_API_KEY } })
  if (res.status === 429) throw new Error('RATE_LIMIT')
  if (res.status === 401 || res.status === 403) throw new Error('AUTH_FAILED')
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (data.errors && typeof data.errors==='object' && Object.keys(data.errors).length>0) throw new Error(`API errors: ${JSON.stringify(data.errors)}`)
  return data.response ?? []
}
async function footballApiGetRaw(path: string): Promise<any> {
  const res = await fetch(`${FOOTBALL_API_BASE}${path}`, { headers: { 'x-apisports-key': FOOTBALL_API_KEY } })
  if (res.status === 429) throw new Error('RATE_LIMIT')
  if (res.status === 401 || res.status === 403) throw new Error('AUTH_FAILED')
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return await res.json()
}
async function footballApiPaginate(basePath: string, maxPages = 20): Promise<any[]> {
  const all: any[] = []
  let page = 1
  while (page <= maxPages) {
    const sep = basePath.includes('?') ? '&' : '?'
    const data = await footballApiGetRaw(`${basePath}${sep}page=${page}`)
    all.push(...(data.response ?? []))
    if (page >= (data.paging?.total ?? 1)) break
    page++
    await new Promise(r => setTimeout(r, 200))
  }
  return all
}
function deriveKnockoutWinner(status: string, goals: { home: number; away: number }, score: any, teams: any): string {
  if (status === 'PEN') return ((score.penalty?.home ?? 0) > (score.penalty?.away ?? 0)) ? teams.home.name : teams.away.name
  if (status === 'AET') return ((score.extratime?.home ?? 0) > (score.extratime?.away ?? 0)) ? teams.home.name : teams.away.name
  return goals.home > goals.away ? teams.home.name : teams.away.name
}
function normLetters(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'')
}
function normName(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z\s'-]/g,' ').replace(/\s+/g,' ').trim()
}
function nameTokens(s: string): string[] {
  const STOP = ['de','la','el','al','van','der','jr','sr','ben','da','dos','do','di','le','von']
  return normName(s).split(/[\s-]+/).filter(w => w.length >= 2 && !STOP.includes(w))
}
async function handleVerifyPlayerIds(items: Array<{api_player_id:number, our_name:string, team_name?:string}>): Promise<Response> {
  if (!Array.isArray(items) || items.length === 0) return json({ error: 'items required' }, 400)
  if (items.length > 250) return json({ error: 'max 250 items per call' }, 400)
  const mismatches: any[] = []
  const errors: any[] = []
  let okCount = 0
  for (const item of items) {
    try {
      const raw = await footballApiGetRaw(`/players/profiles?player=${item.api_player_id}`)
      const profile = raw.response?.[0]?.player
      if (!profile) {
        mismatches.push({ api_player_id: item.api_player_id, our_name: item.our_name, team_name: item.team_name, status: 'not_found', api_full: null, api_nat: null })
        continue
      }
      const apiFirst = profile.firstname || ''
      const apiLast = profile.lastname || ''
      const apiFull = profile.name || `${apiFirst} ${apiLast}`
      const apiNat = profile.nationality || ''
      const ourToks = nameTokens(item.our_name)
      const apiAllToks = nameTokens(`${apiFirst} ${apiLast} ${apiFull}`)
      const ourLettersAll = normLetters(item.our_name)
      const apiLettersAll = normLetters(`${apiFirst} ${apiLast} ${apiFull}`)
      const ourLast = ourToks[ourToks.length - 1] || ''
      const rawWords = item.our_name.trim().split(/\s+/)
      const ourFirstRaw = rawWords[0] || ''
      const ourFirstIsInitial = /^[A-Za-z]\.?$/.test(ourFirstRaw)
      const ourFirst = ourFirstIsInitial
        ? ourFirstRaw.replace('.','').toLowerCase()
        : (ourToks[0] || '')
      const apiFirstNorm = normName(apiFirst).split(/\s+/)[0] || ''
      const lastnameMatch = ourLast && (
        apiAllToks.includes(ourLast) ||
        apiLettersAll.includes(ourLast) ||
        ourLettersAll.includes(normLetters(apiLast))
      )
      let firstMatch: boolean
      if (!ourFirst || !apiFirstNorm) {
        firstMatch = true
      } else if (ourFirstIsInitial) {
        firstMatch = apiFirstNorm[0] === ourFirst[0]
      } else {
        firstMatch = ourFirst === apiFirstNorm ||
          (ourFirst.length >= 3 && apiFirstNorm.startsWith(ourFirst)) ||
          (apiFirstNorm.length >= 3 && ourFirst.startsWith(apiFirstNorm)) ||
          apiLettersAll.includes(ourFirst)
      }
      let status: string
      if (lastnameMatch && firstMatch) status = 'ok'
      else if (lastnameMatch) status = 'suspect_first'
      else status = 'mismatch'
      if (status === 'ok') {
        okCount++
      } else {
        mismatches.push({ api_player_id: item.api_player_id, our_name: item.our_name, team_name: item.team_name, status, api_full: apiFull, api_first: apiFirst, api_last: apiLast, api_nat: apiNat })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push({ api_player_id: item.api_player_id, our_name: item.our_name, team_name: item.team_name, error: msg })
      if (msg === 'RATE_LIMIT') { await new Promise(r => setTimeout(r, 2000)) }
    }
    await new Promise(r => setTimeout(r, 300))
  }
  return json({ status:'verify_ok', total: items.length, ok: okCount, mismatches: mismatches.length, errors: errors.length, mismatch_list: mismatches, error_list: errors })
}
async function handleLookupPlayers(queries: Array<{name:string, nationality?:string}>): Promise<Response> {
  const out: any[] = []
  for (const q of queries) {
    const cleaned = q.name.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z\s'-]/g,' ').trim()
    const words = cleaned.split(/\s+/).filter(w => w.length >= 3 && !['the','de','la','el','al','van','der','jr','sr','ben'].includes(w.toLowerCase()))
    const search = words[words.length - 1] || cleaned.split(/\s+/)[0]
    try {
      const raw = await footballApiGetRaw(`/players/profiles?search=${encodeURIComponent(search)}`)
      const arr = raw.response ?? []
      const candidates = arr.map((r:any) => ({
        id: r.player?.id, name: r.player?.name, firstname: r.player?.firstname, lastname: r.player?.lastname,
        nationality: r.player?.nationality, age: r.player?.age, position: r.player?.position
      }))
      const filtered = q.nationality ? candidates.filter((c:any) => c.nationality && c.nationality.toLowerCase().includes(q.nationality!.toLowerCase().split(/[\s-]/)[0])) : candidates
      out.push({ query: q.name, search_term: search, total: arr.length, candidates: filtered.length ? filtered : candidates.slice(0, 5) })
    } catch (e) {
      out.push({ query: q.name, search_term: search, error: e instanceof Error ? e.message : String(e) })
    }
    await new Promise(r => setTimeout(r, 300))
  }
  return json({ status: 'lookup_ok', count: out.length, results: out })
}
async function handleBootstrapSquads(): Promise<Response> {
  const teamsRaw = await footballApiGet(`/teams?league=${WC_LEAGUE_ID}&season=${WC_SEASON}`)
  const teams = teamsRaw.map((t:any) => ({api_team_id:t.team.id,name:t.team.name})).sort((a:any,b:any)=>a.name.localeCompare(b.name))
  const squads:any[]=[]; const errors:any[]=[]
  for (const team of teams) {
    try {
      const squadRaw = await footballApiGet(`/players/squads?team=${team.api_team_id}`)
      const players = squadRaw[0]?.players ?? []
      squads.push({api_team_id:team.api_team_id, team_name:team.name, players: players.map((p:any)=>({api_player_id:p.id,name:p.name,position:p.position,number:p.number,age:p.age}))})
    } catch (e) { errors.push({api_team_id:team.api_team_id,team_name:team.name,error:e instanceof Error?e.message:String(e)}) }
  }
  return json({status:'bootstrap_squads_ok', teams_count:teams.length, squads_count:squads.length, total_players:squads.reduce((s,q)=>s+q.players.length,0), errors, teams, squads})
}
async function handleProbeWcTeam(api_team_id: number, season?: number): Promise<Response> {
  if (!api_team_id) return json({ error: 'api_team_id required' }, 400)
  const useSeason = (typeof season === 'number' && season > 0) ? season : WC_SEASON
  const raw = await footballApiPaginate(`/players?team=${api_team_id}&season=${useSeason}`)
  const m: Map<number,any> = new Map()
  for (const r of raw) { const id = r.player?.id; if (!id) continue; const pos = r.statistics?.[0]?.games?.position ?? null; const ex = m.get(id); if (!ex) m.set(id, {api_player_id:id,name:r.player.name,firstname:r.player.firstname,lastname:r.player.lastname,nationality:r.player.nationality,position:pos,team:r.statistics?.[0]?.team?.name,appearences:r.statistics?.[0]?.games?.appearences}); else if (!ex.position && pos) ex.position = pos }
  return json({ status:'probe_wc_team_ok', api_team_id, season: useSeason, total_players:m.size, players:Array.from(m.values()) })
}
async function handleBootstrapWcPlayers(): Promise<Response> {
  const teamsRaw = await footballApiGet(`/teams?league=${WC_LEAGUE_ID}&season=${WC_SEASON}`)
  const teams = teamsRaw.map((t:any)=>({api_team_id:t.team.id,name:t.team.name})).sort((a:any,b:any)=>a.name.localeCompare(b.name))
  const squads:any[]=[]; const errors:any[]=[]
  for (const team of teams) {
    try {
      const raw = await footballApiPaginate(`/players?team=${team.api_team_id}&season=${WC_SEASON}`)
      const m: Map<number,any> = new Map()
      for (const r of raw) { const id = r.player?.id; if (!id) continue; const pos = r.statistics?.[0]?.games?.position ?? null; const ex = m.get(id); if (!ex) m.set(id,{api_player_id:id,name:r.player.name,position:pos}); else if (!ex.position && pos) ex.position = pos }
      squads.push({api_team_id:team.api_team_id,team_name:team.name,players:Array.from(m.values())})
    } catch (e) { errors.push({api_team_id:team.api_team_id,team_name:team.name,error:e instanceof Error?e.message:String(e)}) }
    await new Promise(r=>setTimeout(r,200))
  }
  return json({status:'bootstrap_wc_players_ok',teams_count:teams.length,squads_count:squads.length,total_players:squads.reduce((s,q)=>s+q.players.length,0),total_forwards:squads.reduce((s,q)=>s+q.players.filter((p:any)=>p.position==='Attacker').length,0),errors,teams,squads})
}
async function handleSetup(supabase: ReturnType<typeof createClient>): Promise<Response> {
  const fixtures = await footballApiGet(`/fixtures?league=${WC_LEAGUE_ID}&season=${WC_SEASON}`)
  const { data: games, error: dbErr } = await supabase.from('games').select('id, team_home, team_away, kick_off_time, api_fixture_id').range(0,99999)
  if (dbErr) throw new Error(`DB error: ${dbErr.message}`)
  const matched:any[]=[]; const unmatched:any[]=[]; let skipped=0
  for (const fixture of fixtures) {
    const apiHome = normalizeTeam(fixture.teams.home.name); const apiAway = normalizeTeam(fixture.teams.away.name); const apiDate = new Date(fixture.fixture.date)
    const game = (games ?? []).find((g:any)=>{if(g.api_fixture_id && g.api_fixture_id!==fixture.fixture.id) return false; const t=Math.abs(new Date(g.kick_off_time).getTime()-apiDate.getTime()); return normalizeTeam(g.team_home)===apiHome && normalizeTeam(g.team_away)===apiAway && t<300000})
    if (game) { if (game.api_fixture_id===fixture.fixture.id) {skipped++;continue}; await supabase.from('games').update({api_fixture_id:fixture.fixture.id}).eq('id',game.id); matched.push({game_id:game.id,api_fixture_id:fixture.fixture.id}) }
    else if (!fixture.teams.home.name.includes('TBD') && !fixture.teams.away.name.includes('TBD')) unmatched.push({home:fixture.teams.home.name,away:fixture.teams.away.name,date:fixture.fixture.date})
  }
  return json({status:'done',matched:matched.length,skipped,unmatched})
}
async function handleVerify(supabase: ReturnType<typeof createClient>, game_id: string): Promise<Response> {
  if (!game_id) return json({error:'game_id required'},400)
  const { data: game, error } = await supabase.from('games').select('id,api_fixture_id,kick_off_time').eq('id',game_id).single()
  if (error || !game) return json({error:'Game not found'},404)
  if (!game.api_fixture_id) return json({error:'api_fixture_id not set'},400)
  const fx = await footballApiGet(`/fixtures?id=${game.api_fixture_id}`)
  if (!fx.length) return json({error:`Fixture not found`},404)
  const apiDate = new Date(fx[0].fixture.date); const dbDate = new Date(game.kick_off_time); const diffMin = Math.abs(apiDate.getTime()-dbDate.getTime())/60000
  if (diffMin > 5) { await supabase.from('games').update({kick_off_time:apiDate.toISOString()}).eq('id',game_id); await supabase.rpc('fn_schedule_game_sync',{p_game_id:game_id}); await supabase.rpc('fn_reschedule_game',{p_game_id:game_id}); return json({status:'updated',db_time:dbDate.toISOString(),api_time:apiDate.toISOString(),diff_minutes:diffMin}) }
  return json({status:'match',kick_off_time:dbDate.toISOString(),diff_minutes:diffMin})
}
async function handleSync(supabase: ReturnType<typeof createClient>, game_id: string, phase: string, stage: string): Promise<Response> {
  if (!game_id) return json({error:'game_id required'},400)
  const { data: game, error: gameErr } = await supabase.from('games').select('id,api_fixture_id,team_home,team_away,kick_off_time').eq('id',game_id).single()
  if (gameErr || !game) return json({error:'Game not found'},404)
  if (!game.api_fixture_id) return json({error:'api_fixture_id not set'},400)
  let fixtures
  try { fixtures = await footballApiGet(`/fixtures?id=${game.api_fixture_id}`) }
  catch (e) { const msg=e instanceof Error?e.message:String(e); if (msg==='RATE_LIMIT') { await reportEfError(supabase,'quota',msg,{game_id,stage}); await supabase.rpc('fn_schedule_retry_sync',{p_game_id:game_id,p_stage:stage,p_delay_minutes:10}); return json({status:'rate_limited_retry_10min',game_id}) } throw e }
  if (!fixtures.length) return json({error:`Fixture not found`},404)
  const fixture = fixtures[0]; const {fixture:fix,goals,score,teams} = fixture; const status = fix.status.short
  const groupDone = phase==='group' && status==='FT'; const knockoutDone = phase==='knockout' && (status==='FT'||status==='AET'||status==='PEN'); const etFollowupDone = stage==='et_followup' && (status==='AET'||status==='PEN'); const gameFinished = groupDone||knockoutDone||etFollowupDone
  const etInProgress = phase==='knockout' && stage==='initial' && (status==='ET'||status==='BT'); const penaltyInProgress = phase==='knockout' && stage==='initial' && status==='P'
  if (gameFinished) {
    if (goals.home===null||goals.away===null) { await supabase.rpc('fn_schedule_retry_sync',{p_game_id:game_id,p_stage:stage,p_delay_minutes:5}); return json({status:'score_null_retry',game_id}) }
    const update: any = {score_home:score.fulltime?.home??goals.home, score_away:score.fulltime?.away??goals.away}
    if (phase==='knockout') { update.went_to_extra_time = status==='AET'||status==='PEN'; if (status==='AET'||status==='PEN') { update.et_score_home=score.extratime?.home??null; update.et_score_away=score.extratime?.away??null; update.went_to_penalties=status==='PEN'; if(status==='PEN') {update.penalty_score_home=score.penalty?.home??null; update.penalty_score_away=score.penalty?.away??null} } update.knockout_winner = deriveKnockoutWinner(status,goals,score,teams) }
    let updateErr; for (let a=1;a<=3;a++) { const {error} = await supabase.from('games').update(update).eq('id',game_id); updateErr=error; if (!error) break; if (a<3) await new Promise(r=>setTimeout(r,1000)) }
    if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`)
    await writeStats(supabase, game_id, game.api_fixture_id)
    await supabase.rpc('fn_unschedule_game_sync',{p_game_id:game_id})
    return json({status:'done',game_id,score:`${goals.home}-${goals.away}`,api_status:status})
  }
  if (etInProgress) { await supabase.from('games').update({score_home:score.fulltime?.home??goals.home,score_away:score.fulltime?.away??goals.away,went_to_extra_time:true}).eq('id',game_id); await supabase.rpc('fn_schedule_retry_sync',{p_game_id:game_id,p_stage:'et_followup',p_delay_minutes:40}); return json({status:'et_in_progress',game_id}) }
  if (penaltyInProgress) { await supabase.from('games').update({score_home:score.fulltime?.home??goals.home,score_away:score.fulltime?.away??goals.away,went_to_extra_time:true,et_score_home:score.extratime?.home??null,et_score_away:score.extratime?.away??null,went_to_penalties:true}).eq('id',game_id); await supabase.rpc('fn_schedule_retry_sync',{p_game_id:game_id,p_stage:'et_followup',p_delay_minutes:5}); return json({status:'penalty_in_progress',game_id}) }
  const TERMINAL = ['PST','SUSP','ABD','CANC','AWD','WO','INT']
  if (TERMINAL.includes(status)) { await supabase.rpc('fn_unschedule_game_sync',{p_game_id:game_id}); await reportEfError(supabase,'crash',`Terminal status ${status}`,{game_id,api_status:status}); return json({status:'terminal_stopped',game_id,api_status:status}) }
  if (game.kick_off_time && Date.now() > new Date(game.kick_off_time as string).getTime()+6*3600000) { await supabase.rpc('fn_unschedule_game_sync',{p_game_id:game_id}); await reportEfError(supabase,'crash',`Stale 6h`,{game_id,api_status:status}); return json({status:'stale_stopped',game_id,api_status:status}) }
  await supabase.rpc('fn_schedule_retry_sync',{p_game_id:game_id,p_stage:stage,p_delay_minutes:5})
  return json({status:'retry_scheduled',game_id,api_status:status})
}
const BET365_ID = 8
async function handleSyncAfOdds(supabase: ReturnType<typeof createClient>): Promise<Response> {
  const now = new Date(); const td = new Date(now.getTime()+259200000)
  const { data: games, error: dbErr } = await supabase.from('games').select('id,api_fixture_id,team_home,team_away').gt('kick_off_time',now.toISOString()).lt('kick_off_time',td.toISOString()).not('api_fixture_id','is',null).is('score_home',null)
  if (dbErr) throw new Error(`DB error: ${dbErr.message}`)
  if (!games?.length) return json({status:'no_upcoming_games',matched:0})
  let matched=0; const errors:string[]=[]
  for (const game of games) {
    try {
      const odds = await footballApiGet(`/odds?fixture=${game.api_fixture_id}`); const oe = odds[0]; if (!oe) continue
      const bms:any[] = oe.bookmakers ?? []; const bm = bms.find((b:any)=>b.id===BET365_ID) ?? bms[0]; if (!bm) continue
      const h = (bm.bets??[]).find((b:any)=>b.name==='Match Winner'); const t = (bm.bets??[]).find((b:any)=>b.name==='Goals Over/Under'); if (!h) continue
      const ho = parseFloat(h.values?.find((v:any)=>v.value==='Home')?.odd)||null; const dr = parseFloat(h.values?.find((v:any)=>v.value==='Draw')?.odd)||null; const aw = parseFloat(h.values?.find((v:any)=>v.value==='Away')?.odd)||null
      const o25 = parseFloat(t?.values?.find((v:any)=>v.value==='Over 2.5')?.odd)||null; const u25 = parseFloat(t?.values?.find((v:any)=>v.value==='Under 2.5')?.odd)||null
      const src = bm.id===BET365_ID?'bet365':`af_${bm.id}`
      const { error: ue } = await supabase.from('game_odds').upsert({game_id:game.id,source:src,home_win:ho,draw:dr,away_win:aw,over_2_5:o25,under_2_5:u25,updated_at:new Date().toISOString()},{onConflict:'game_id,source'})
      if (ue) throw new Error(ue.message)
      matched++
    } catch (e) { errors.push(`${game.team_home} vs ${game.team_away}: ${e instanceof Error?e.message:String(e)}`) }
  }
  return json({status:'done',games_checked:games.length,matched,errors})
}
async function handleSyncStats(supabase: ReturnType<typeof createClient>, game_id?: string): Promise<Response> {
  let q = supabase.from('games').select('id,api_fixture_id,team_home,team_away').not('score_home','is',null).not('api_fixture_id','is',null).range(0,99999)
  if (game_id) q = q.eq('id',game_id)
  const { data: games, error: dbErr } = await q
  if (dbErr) throw new Error(`DB error: ${dbErr.message}`)
  if (!games?.length) return json({status:'no_games',count:0})
  const results:any[] = []
  for (const game of games) { try { await writeStats(supabase, game.id, game.api_fixture_id); results.push({game:`${game.team_home} vs ${game.team_away}`,status:'ok'}) } catch (e) { results.push({game:`${game.team_home} vs ${game.team_away}`,status:e instanceof Error?e.message:String(e)}) } }
  return json({status:'done',total:games.length,results})
}
async function writeStats(supabase: ReturnType<typeof createClient>, game_id: string, api_fixture_id: number): Promise<void> {
  try {
    const [tsArr, psArr] = await Promise.all([footballApiGet(`/fixtures/statistics?fixture=${api_fixture_id}`), footballApiGet(`/fixtures/players?fixture=${api_fixture_id}`)])
    const { data: _g } = await supabase.from('games').select('team_home,team_away').eq('id',game_id).single()
    const canon = (apiName: string): string => { const n=normalizeTeam(apiName); if(_g&&normalizeTeam(String(_g.team_home))===n) return String(_g.team_home); if(_g&&normalizeTeam(String(_g.team_away))===n) return String(_g.team_away); return apiName }
    const rcBy: Record<string,number> = {}
    for (const te of psArr) { const tn = te.team?.name??''; let c=0; for (const pe of (te.players??[])) c += pe.statistics?.[0]?.cards?.red??0; rcBy[tn] = c }
    for (const ts of tsArr) {
      const team = canon(ts.team.name)
      const stat = (type:string):number|null=>{const e=ts.statistics?.find((s:any)=>s.type===type);if(!e||e.value===null||e.value===undefined) return null;if(typeof e.value==='string'&&e.value.endsWith('%')) return parseInt(e.value,10);return typeof e.value==='number'?e.value:null}
      const sf = (type:string):number|null=>{const e=ts.statistics?.find((s:any)=>s.type===type);if(!e||e.value===null||e.value===undefined) return null;const v=parseFloat(String(e.value));return isNaN(v)?null:v}
      await supabase.from('game_team_stats').upsert({game_id,team,possession:stat('Ball Possession'),shots_total:stat('Total Shots')??0,shots_on_target:stat('Shots on Goal')??0,shots_insidebox:stat('Shots insidebox')??0,corners:stat('Corner Kicks')??0,fouls:stat('Fouls')??0,yellow_cards:stat('Yellow Cards')??0,red_cards:rcBy[ts.team.name]??0,offsides:stat('Offsides')??0,passes_total:stat('Total passes'),passes_accuracy:stat('Passes %'),xg:sf('expected_goals')},{onConflict:'game_id,team'})
    }
    const rows = []
    for (const te of psArr) { const tn = te.team?.name??''; for (const pe of (te.players??[])) { const p=pe.player; const s=pe.statistics?.[0]; if(!p||!s) continue; const rr=s.games?.rating; const rt=rr?parseFloat(String(rr)):null; rows.push({game_id,api_player_id:p.id,player_name:p.name,team:canon(s.team?.name??tn),minutes_played:s.games?.minutes??null,position:s.games?.position??null,rating:isNaN(rt as number)?null:rt,goals:s.goals?.total??0,assists:s.goals?.assists??0,yellow_cards:s.cards?.yellow??0,red_cards:s.cards?.red??0,gk_saves:s.goalkeeper?.saves??null,gk_conceded:s.goalkeeper?.conceded??null}) } }
    if (rows.length>0) await supabase.from('game_player_stats').upsert(rows,{onConflict:'game_id,api_player_id'})
    const evRaw = await footballApiGet(`/fixtures/events?fixture=${api_fixture_id}`)
    const evRows:any[] = []
    for (const ev of evRaw) { const t=ev.type as string; const d=ev.detail as string; let et:string|null=null; if(t==='Goal'&&['Normal Goal','Own Goal','Penalty'].includes(d)) et='goal'; else if(t==='Card'&&['Red Card','Second Yellow card'].includes(d)) et='red_card'; if (!et) continue; evRows.push({game_id,team:canon(ev.team?.name??''),player_name:ev.player?.name??null,event_type:et,minute:ev.time?.elapsed??0,minute_extra:ev.time?.extra??null,detail:d}) }
    if (evRows.length>0) await supabase.from('game_events').upsert(evRows,{onConflict:'game_id,team,player_name,event_type,minute'})
  } catch (e) { const msg=e instanceof Error?e.message:String(e); console.error(`stats failed:`,msg); const _sb=createClient(SUPABASE_URL,SERVICE_ROLE_KEY); await reportEfError(_sb,'stats_write',msg,{game_id}) }
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json()
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    switch (body.mode) {
      case 'setup': return await handleSetup(supabase)
      case 'bootstrap_squads': return await handleBootstrapSquads()
      case 'probe_wc_team': return await handleProbeWcTeam(body.api_team_id, body.season)
      case 'bootstrap_wc_players': return await handleBootstrapWcPlayers()
      case 'lookup_players': return await handleLookupPlayers(body.queries ?? [])
      case 'verify_player_ids': return await handleVerifyPlayerIds(body.items ?? [])
      case 'sync_stats': return await handleSyncStats(supabase, body.game_id)
      case 'sync_af_odds': return await handleSyncAfOdds(supabase)
      case 'verify': return await handleVerify(supabase, body.game_id)
      case 'sync': { const rp = body.phase??'group'; const ph = rp==='group'?'group':'knockout'; return await handleSync(supabase, body.game_id, ph, body.stage??'initial') }
      default: return json({error:'Unknown mode'},400)
    }
  } catch (e) { const msg=e instanceof Error?e.message:String(e); console.error('error:',msg); try { const _sb=createClient(SUPABASE_URL,SERVICE_ROLE_KEY); await reportEfError(_sb,'crash',msg) } catch {} return json({error:msg},500) }
})
