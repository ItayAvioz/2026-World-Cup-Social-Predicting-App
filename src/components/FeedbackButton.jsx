import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import Modal from './Modal.jsx'

const INITIAL = {
  step: 'closed',       // 'closed' | 'category' | 'form' | 'success'
  category: null,       // 'issue' | 'idea'
  priority: null,       // 'low' | 'medium' | 'high'
  message: '',
  screenshotFile: null,
  screenshotWarn: false,
  submitting: false,
}

function fileExt(file) {
  const parts = file.name.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'jpg'
}

export default function FeedbackButton() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [s, setS] = useState(INITIAL)

  const upd = (patch) => setS(prev => ({ ...prev, ...patch }))
  const handleOpen  = () => setS({ ...INITIAL, step: 'category' })
  const handleClose = () => setS(INITIAL)

  const handleSubmit = async () => {
    if (!s.message.trim() || !s.priority) return
    upd({ submitting: true, screenshotWarn: false })

    let screenshotPath = null

    if (s.screenshotFile && user) {
      const ext  = fileExt(s.screenshotFile)
      const path = `${user.id}/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('feedback-screenshots')
        .upload(path, s.screenshotFile, { contentType: s.screenshotFile.type })

      if (uploadErr) {
        upd({ screenshotWarn: true })
      } else {
        const { data: urlData } = supabase.storage
          .from('feedback-screenshots')
          .getPublicUrl(path)
        screenshotPath = urlData.publicUrl
      }
    }

    const { error: dbErr } = await supabase.from('feedback').insert({
      user_id:        user.id,
      category:       s.category,
      priority:       s.priority,
      message:        s.message.trim(),
      screenshot_url: screenshotPath,
    })

    if (dbErr) {
      showToast('שגיאה בשליחת הפידבק', 'error')
      upd({ submitting: false })
      return
    }

    upd({ step: 'success', submitting: false })
  }

  if (!user) return null

  return (
    <>
      {s.step === 'closed' && (
        <button className="feedback-fab" onClick={handleOpen} aria-label="שלח פידבק">
          💬
        </button>
      )}

      <Modal isOpen={s.step !== 'closed'} onClose={handleClose}>

        {/* ── STEP 1: Category ── */}
        {s.step === 'category' && (
          <div className="feedback-step">
            <h2 className="feedback-title">שלח פידבק</h2>
            <p className="feedback-subtitle">במה מדובר?</p>
            <div className="feedback-category-grid">
              <button className="feedback-cat-btn" onClick={() => upd({ category: 'issue', step: 'form' })}>
                <span className="feedback-cat-icon">🔧</span>
                <span className="feedback-cat-label">בעיה</span>
                <span className="feedback-cat-desc">משהו לא עובד?</span>
              </button>
              <button className="feedback-cat-btn" onClick={() => upd({ category: 'idea', step: 'form' })}>
                <span className="feedback-cat-icon">✨</span>
                <span className="feedback-cat-label">שיפור</span>
                <span className="feedback-cat-desc">יש לך רעיון?</span>
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Form ── */}
        {s.step === 'form' && (
          <div className="feedback-step">
            <button className="feedback-back" onClick={() => upd({ step: 'category' })}>
              ← חזרה
            </button>
            <h2 className="feedback-title">
              {s.category === 'issue' ? 'דיווח על בעיה' : 'הצעת שיפור'}
            </h2>

            <p className="feedback-label">עדיפות</p>
            <div className="feedback-priority-row">
              {[['low', 'נמוך'], ['medium', 'בינוני'], ['high', 'גבוה']].map(([val, label]) => (
                <button
                  key={val}
                  className={`feedback-priority-pill priority-${val}${s.priority === val ? ' active' : ''}`}
                  onClick={() => upd({ priority: val })}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="feedback-label">הודעה</p>
            <textarea
              className="feedback-textarea"
              placeholder="תאר את הבעיה או הרעיון..."
              value={s.message}
              onChange={e => upd({ message: e.target.value })}
              rows={4}
              dir="rtl"
              autoFocus
            />

            <p className="feedback-label">צילום מסך (אופציונלי)</p>
            <label className="feedback-file-label">
              <input
                type="file"
                accept="image/*"
                className="feedback-file-input"
                onChange={e => upd({ screenshotFile: e.target.files?.[0] ?? null, screenshotWarn: false })}
              />
              <span className="feedback-file-btn">
                {s.screenshotFile ? `📎 ${s.screenshotFile.name}` : '📷 בחר תמונה'}
              </span>
            </label>
            {s.screenshotWarn && (
              <p className="feedback-warn">העלאת התמונה נכשלה — הפידבק ישלח ללא צילום מסך</p>
            )}

            <button
              className="btn btn-gold btn-full"
              style={{ marginTop: '1.2rem' }}
              onClick={handleSubmit}
              disabled={s.submitting || !s.message.trim() || !s.priority}
            >
              {s.submitting ? 'שולח...' : 'שלח פידבק'}
            </button>
          </div>
        )}

        {/* ── STEP 3: Success ── */}
        {s.step === 'success' && (
          <div className="feedback-step feedback-success">
            <div className="feedback-success-icon">
              {s.category === 'issue' ? '🔧' : '✨'}
            </div>
            <p className="feedback-success-msg">
              {s.category === 'issue'
                ? 'תודה על הדיווח! נבדוק את הבעיה בהקדם 🔧'
                : 'תודה על הרעיון! כל הצעה חשובה לנו ✨'}
            </p>
            <button className="btn btn-gold" onClick={handleClose}>סגור</button>
          </div>
        )}

      </Modal>
    </>
  )
}
