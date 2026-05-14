import { useEffect } from 'react'

export default function HowToPlay({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return
    const handleKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="htp-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="htp-modal">

        <div className="htp-header">
          <span className="htp-header-title">🏆 How to Play</span>
          <button className="htp-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="htp-body">

          <p className="htp-tagline">
            48 teams. 104 games. One group chat that will never be the same.<br />
            Predict scores, climb the leaderboard, and survive the nightly AI roast.
          </p>

          {/* ── Scoring ── */}
          <div className="htp-section">
            <h2 className="htp-section-title">⚽ The Scoring System</h2>
            <p className="htp-desc">Points are earned through accuracy and consistency. Trivia points are the "dark horse" — they stay hidden until the Final to create a massive late-game swing.</p>
            <table className="htp-table">
              <thead>
                <tr><th>Action</th><th>Points</th></tr>
              </thead>
              <tbody>
                <tr><td>⭐ Exact Scoreline</td><td className="htp-pts">3 pts</td></tr>
                <tr><td>✓ Correct Outcome (W/D/L)</td><td className="htp-pts">1 pt</td></tr>
                <tr><td>🏆 Correct Champion</td><td className="htp-pts">10 pts</td></tr>
                <tr><td>⚽ Correct Top Scorer</td><td className="htp-pts">10 pts</td></tr>
                <tr><td>🧠 Daily Trivia</td><td className="htp-pts">1 pt</td></tr>
              </tbody>
            </table>
            <p className="htp-note">Points are not cumulative. An exact score earns 3 pts total — inclusive of the outcome.</p>
            <div className="htp-callout">
              <strong>The Safety Net:</strong> Missed a prediction? The app auto-predicts a random score for you. You can still earn points on pure luck.
            </div>
          </div>

          {/* ── Dashboard ── */}
          <div className="htp-section">
            <h2 className="htp-section-title">📊 Your Dashboard</h2>
            <p className="htp-desc">Your command center for the entire tournament.</p>
            <ul className="htp-list">
              <li><strong>Live Countdown:</strong> Tracks time to the next kickoff — and the long road to the Final (July 19).</li>
              <li><strong>Global Leaderboard:</strong> Every player ranked in real time. Each row shows their rank, group, champion pick flag, top scorer pick, and total points. Your row is always highlighted.</li>
              <li><strong>Match Cards:</strong> Today's games appear first, then the next matchday. Each card shows your per-group prediction chip — tap to predict or update before kickoff.</li>
              <li><strong>My Stats</strong> <span className="htp-private">(private — only visible to you)</span><strong>:</strong> your group rank, global rank, champion pick, top scorer pick, Exact %, Hit %, and your current Hot/Cold Streak 🔥❄️. One card per group you're in.</li>
            </ul>
          </div>

          {/* ── Match Page ── */}
          <div className="htp-section">
            <h2 className="htp-section-title">🏟️ The Match Page</h2>
            <p className="htp-desc">Deep-dive into the data before and after the whistle.</p>

            <p className="htp-sub-label">Pre-Kickoff — arm yourself:</p>
            <ul className="htp-list">
              <li><strong>Odds (Bet365):</strong> Home Win / Draw / Away Win + Under &amp; Over 2.5 Goals line. Appears in the 3 days before kickoff.</li>
              <li><strong>Tournament Record:</strong> Each team's form badges in chronological order — W, D, L, W·ET, L·P. You see the full journey.</li>
              <li><strong>Tournament Avg Stats:</strong> Goals scored &amp; conceded, possession, shots, on target, corners, fouls, cards, offsides — accumulated across every tournament game, updated live after each match.</li>
            </ul>

            <div className="htp-callout">
              <strong>Your Prediction:</strong> One row per group. Predict or update in any group right up until the moment of kickoff.
            </div>

            <p className="htp-sub-label" style={{ marginTop: '1rem' }}>Post-Game — the full picture:</p>
            <ul className="htp-list">
              <li><strong>Goal Timeline:</strong> Every scorer, every minute in chronological order — including injury time.</li>
              <li><strong>Full Match Stats:</strong> Possession, shots, on target, pass accuracy, corners, fouls, yellow &amp; red cards, offsides, and <strong>xG (Expected Goals)</strong>.</li>
              <li><strong>ET &amp; Penalties:</strong> Extra time and shootout scores shown separately when applicable.</li>
            </ul>
            <p className="htp-note">Group predictions for this game? They live on the Groups page — revealed at kickoff.</p>
          </div>

          {/* ── Groups ── */}
          <div className="htp-section">
            <h2 className="htp-section-title">👥 Groups &amp; "The Wisdom Engine"</h2>
            <p className="htp-desc">Every group is its own private battlefield with an independent leaderboard, champion pick, top scorer pick, predictions and nightly AI summary. Max <strong>3 groups</strong> per user · max <strong>10 members</strong> per group.</p>
            <ul className="htp-list">
              <li><strong>Group Leaderboard:</strong> Ranks members by total points — group rank and global rank side by side. Shareable in one tap.</li>
              <li><strong>Live Game Focus:</strong> The current or next upcoming game sits below the leaderboard with your prediction chip per group.</li>
              <li><strong>The Reveal:</strong> The moment kickoff passes, all group member predictions are unmasked — including auto-generated ones ⚡.</li>
            </ul>

            <p className="htp-sub-label">The Wisdom Engine — three levels of insight after every kickoff:</p>
            <ul className="htp-list">
              <li><strong>Your Wisdom:</strong> How you read the game.</li>
              <li><strong>Group Wisdom:</strong> How your friends voted — outcome split (🏠/═/✈️), goals range (0–1 / 2–3 / 4+), most popular scoreline.</li>
              <li><strong>Global Wisdom:</strong> How the entire platform called it. See whether your group was with the world or against it.</li>
            </ul>
            <p className="htp-note">Reading the distribution is how you spot the Contrarian — whoever went alone against the crowd. 🌶️</p>

            <div className="htp-callout">
              <strong>Getting started:</strong> Create a group in one tap — name it, get an invite link. On mobile the invite opens WhatsApp with a ready message; on desktop it copies to clipboard. Join via a friend's link or paste the code — you're in automatically.
            </div>
          </div>

          {/* ── Picks ── */}
          <div className="htp-section">
            <h2 className="htp-section-title">🎯 Your Picks</h2>
            <p className="htp-desc">Two tabs — <strong>Picks</strong> for your big bets, <strong>Predictions</strong> for your full game-by-game. Everything is per group — switch groups with the tabs at the top.</p>
            <ul className="htp-list">
              <li><strong>Champion Pick:</strong> Choose from all 48 qualified teams. Live <strong>William Hill odds</strong> shown next to each team so you know exactly what you're backing. Worth <strong>10 pts</strong> if correct.</li>
              <li><strong>Top Scorer Pick:</strong> Choose from the full tournament squads — every player, every nation. Each player's <strong>live goal tally</strong> updates throughout the competition. Worth <strong>10 pts</strong> if correct.</li>
              <li><strong>Predictions Tab:</strong> Browse every tournament game in two views:
                <ul className="htp-list" style={{ marginTop: '.4rem' }}>
                  <li><strong>Upcoming:</strong> All games not yet played. Enter predictions for each group inline — or tap a game to open it and predict for all your groups at once, with full tournament avg stats for each team.</li>
                  <li><strong>History:</strong> Completed games. Full match stats, chronological goal timeline, and your prediction alongside the final score. Your complete tournament record, game by game.</li>
                </ul>
              </li>
            </ul>
            <div className="htp-callout htp-callout--warn">
              <strong>Deadline: June 11 · 22:00 IDT.</strong> After that — locked for everyone. Miss it and the app auto-assigns at random. Points are awarded the moment the Final result is confirmed.
            </div>
          </div>

          {/* ── AI Feed ── */}
          <div className="htp-section">
            <h2 className="htp-section-title">🤖 The AI Feed (The Nightly Roast)</h2>
            <p className="htp-desc">Every night, once the final whistle blows, the AI analyses the day's damage — one roast per group, for groups with 3 or more members.</p>
            <ul className="htp-list">
              <li><strong>The Roast:</strong> A written verdict on who was a genius, who got lucky, and who is making lifestyle choices with 0–0 predictions three games running. One summary per group. Never the same twice. Never kind.</li>
              <li><strong>Day Standings:</strong> A mini-leaderboard showing who "won the day" with points earned.</li>
              <li><strong>Total Standings:</strong> The full group leaderboard at that exact moment, with global rank alongside.</li>
              <li><strong>React:</strong> Vote on the AI's verdict with 🔥 😂 😭 👑 — and share the summary or standings straight to the group chat.</li>
            </ul>
          </div>

          {/* ── Trivia ── */}
          <div className="htp-section">
            <h2 className="htp-section-title">🧠 Daily Trivia</h2>
            <ul className="htp-list">
              <li><strong>The Window:</strong> One question drops every day at 22:00 IDT, starting June 11.</li>
              <li><strong>The Catch:</strong> 60 seconds on the clock. One shot — no retries, no going back.</li>
              <li><strong>The Long Game:</strong> Trivia points are banked silently. They don't appear on the leaderboard during the tournament — so no one knows who's ahead. The moment the World Cup Final result is confirmed, every trivia point lands simultaneously across every group. It's not over until the trivia lands.</li>
            </ul>
          </div>

          {/* ── Deadlines ── */}
          <div className="htp-section">
            <h2 className="htp-section-title">📅 Key Deadlines</h2>
            <div className="htp-deadlines">
              <div className="htp-deadline-row">
                <span className="htp-deadline-date">June 11 · 22:00 IDT</span>
                <span className="htp-deadline-desc">Tournament begins. Champion and Top Scorer picks lock forever.</span>
              </div>
              <div className="htp-deadline-row">
                <span className="htp-deadline-date">Each kickoff</span>
                <span className="htp-deadline-desc">Prediction window closes for that game. Auto-predict fires for anyone who missed it.</span>
              </div>
              <div className="htp-deadline-row">
                <span className="htp-deadline-date">Every night</span>
                <span className="htp-deadline-desc">AI roast drops per group.</span>
              </div>
              <div className="htp-deadline-row">
                <span className="htp-deadline-date">July 19 · The Final</span>
                <span className="htp-deadline-desc">All banked trivia, champion, and top scorer points activate at once. The champion is crowned.</span>
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="htp-footer">
            <p>One account. Up to 3 groups. Every group is its own competition — its own leaderboard, picks, and nightly roast. You could be last in one and first in another.</p>
            <p>Tap the logo anytime for the full tournament schedule and enough World Cup history facts to sound dangerous at dinner.</p>
            <p className="htp-footer-cta">Good luck. No mercy. Game on. 🏆</p>
          </div>

        </div>
      </div>
    </div>
  )
}
