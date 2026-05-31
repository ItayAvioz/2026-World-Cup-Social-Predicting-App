# השרת: מה בנינו, ארכיטקטורה חדשה מול ישנה, ואיך מריצים בענן

מסמך הסבר ברמת high-level + הוראות הרצה ודיפלוי מדויקות. הקוד עצמו מתועד באנגלית; כאן ההסבר
בעברית.

---

## 1. התמונה הגדולה — מה בנינו

בנינו **Python service** (FastAPI) שרץ **לצד** Supabase, לא במקומו. הוא מנוע (engine) שלוקח
את ה-data שכבר יושב אצלך ב-Supabase, מריץ עליו צוות של סוכני AI (ה-crew), ומחזיר סיכום לילי
בעברית.

זה בדיוק המהלך משקף 5 במפגש:

> **Supabase = הדאטה. Python = המנוע.** ה-Edge Functions נשארים איפה שהם; השרת החדש הוא זה
> שמתזמן ומנהל את ה-AI.

נכון לעכשיו הוא רץ ב-**shadow mode**: ה-EF הלילי שלך ממשיך לרוץ ולייצר את הסיכום (באנגלית)
כרגיל, וה-service הזה רץ *לידו*, קורא את אותו data ב-read-only, ומייצר גרסת crew בעברית.
אתה משווה צד-לצד. **אפס סיכון לפרודקשן.**

---

## 2. ארכיטקטורה: ישן מול חדש

### הישן — `nightly-summary` Edge Function

```
pg_cron  ──▶  Edge Function (Deno / TypeScript, ~1000 שורות)
                 │
                 ├─ קורא stats + leaderboard מ-Supabase
                 ├─ 5 קריאות LLM במקביל = אותו prompt ×5 (ensemble)
                 ├─ Judge (gpt-4o) בוחר את הטוב מבין ה-5
                 └─ כותב ל-ai_summaries  (אנגלית)
```

- **serverless** — אין תהליך חי; כל לילה ה-cron מעיר את ה-EF, הוא רץ, ונכבה.
- **ensemble** — חמש וריאציות של *אותו תפקיד*. כדי לקבל עברית טובה היית צריך לכוונן את כל ה-5.
- מגבלות: timeout של Supabase (כבר נשברת על זה במעבר מ-5 ל-8 קבוצות), ושפה אחת (אנגלית).

### החדש — `wc-summary-crew` Python service

```
cron / HTTP  ──▶  FastAPI service (Python, always-on)
                     │
                     ├─ Stats        (פייתון טהור — בלי LLM)
                     ├─ Personality  (LLM → PlayerStyle typed, פר שחקן)
                     ├─ Writer        (LLM → עברית)            ⇄  Judge (LLM, ניקוד + retry)
                     └─ מחזיר CrewResult  (עברית + audit)
```

- **always-on** — תהליך חי, בלי תקרת timeout, ויכול לשרת גם דברים שצריכים תגובה מיידית
  (chatbot, gate) בעתיד.
- **crew** — תפקידים שונים, כל אחד עבודה אחת, handoff מובנה (typed). העברית חיה במקום אחד (ה-Writer).

### טבלת השוואה

| | ישן (EF) | חדש (crew) |
|---|---|---|
| שפה/runtime | TypeScript / Deno | Python / FastAPI |
| איפה רץ | Supabase (serverless) | שרת always-on (Railway וכו') |
| ארכיטקטורת AI | ensemble (אותו תפקיד ×5) | crew (תפקידים שונים) |
| שפת פלט | אנגלית | עברית |
| תקרת timeout | יש (מגבלת Supabase) | אין |
| מתאים ל-chatbot/gate חיים | פחות | כן |
| Judge | קיים (בורר מבין 5) | קיים (אותו רעיון, מנקד את ה-Writer) |

### למה בכלל לעבור?

1. **אוריינות backend** — לבנות service אמיתי זו יכולת חשובה לשחרור מוצרים ל Production.
2. **ארכיטקטורה נקייה** — מקום אחד אחראי על שפה, במקום לכוונן 5 prompts.
3. **תשתית אחת פותחת 3 פיצ'רים** — אותו service יכול להריץ בעתיד גם את ה-chatbot (RAG) וגם
   את ה-gate לנרשמים.

> **חשוב — האמת המלאה:** קריאות LLM עובדות מצוין גם ב-TypeScript. את העברית *יכולת* להוסיף
> בתוך ה-EF הקיים. המעבר ל-Python הוא בעיקר **קפיצה לימודית/קריירתית** + ארכיטקטורה נקייה —
> לא הכרח טכני. שווה שתדע את זה ולא "תאמין" שחייבים.

---

## 3. המציאות: זה דורש שרת אמיתי (וכן — כסף) 💸

כן, בניגוד ל-EF (שמתארח חינם על Supabase), service פייתון always-on צריך **אירוח** — וזה
עולה כסף או דורש tradeoff. אלה האפשרויות:

| ספק | מחיר | ה-catch |
|---|---|---|
| **Railway** ⭐ | ~$5/חודש | always-on אמיתי. ההמלצה מהמפגש. |
| Render | חינם / $7 | ה-tier החינמי **נרדם** אחרי חוסר פעילות (cold start של שניות בכל בקשה) |
| Fly.io | חינם-מוגבל / לפי שימוש | גמיש, מעט יותר setup |

**עלויות נוספות שכבר קיימות (לא חדשות):**
- **OpenAI API** — אותו key של ה-EF; אתה כבר משלם לפי שימוש. ה-crew פשוט עושה עוד קריאות.
- **Supabase** — נשאר כמו שהוא. **אתה לא צריך Supabase Pro ($25)** בשביל זה.

> זוכר את ההכרעה מהמפגש? **$5 Railway, לא $25 Supabase Pro.** השרת ב-$5 נותן לך גם dev/prod
> מובנה, אז אין צורך ב-Branching של Pro.

**הכרעה מומלצת:** התחל ב-**Render free** רק כדי לראות שזה עולה (לא אכפת לך מ-cold start
בהתנסות), וכשתרצה always-on אמיתי — **Railway ב-$5**.

---

## 4. הרצה מקומית (לפני שמדברים על ענן)

```bash
cd wc-summary-crew

# סביבה (פעם אחת) — Python 3.11
python3.11 -m venv venv_wc-summary-crew
source venv_wc-summary-crew/bin/activate
pip install -r requirements.txt

# secrets
cp .env.example .env
# מלא ב-.env:
#   SUPABASE_SERVICE_KEY  ← Supabase dashboard → Project Settings → API → service_role (סוד!)
#   OPENAI_API_KEY        ← אותו key של ה-EF

# הרץ
uvicorn app.main:app --reload
# פתח: http://127.0.0.1:8000/health   →   {"ok": true}
```

לבדיקה מהירה בלי שרת, ראה את ה-`scripts/run_shadow.py` ב-README.

---

## 5. דיפלוי ל-Railway — צעד-אחר-צעד 🚂

(הקובץ `Procfile` כבר בריפו ואומר ל-Railway איך להריץ: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.)

1. **חשבון** — היכנס ל-[railway.app](https://railway.app), התחבר עם GitHub.
2. **New Project → Deploy from GitHub repo** → בחר את `2026-World-Cup-Social-Predicting-App`.
3. **Root Directory** — בהגדרות ה-service (Settings → Source) קבע
   `Root Directory = wc-summary-crew`. **קריטי** — אחרת Railway ינסה לבנות את כל הריפו.
4. **משתני סביבה** (Variables) — הוסף:
   - `SUPABASE_URL` = `https://<project>.supabase.co`
   - `SUPABASE_SERVICE_KEY` = ה-service_role key
   - `OPENAI_API_KEY` = ה-key שלך
   - `CREW_API_SECRET` = מחרוזת אקראית (כדי לנעול את ה-endpoint — ראה למטה)
5. **Deploy** — Railway יזהה Python, יתקין מ-`requirements.txt`, ויריץ לפי ה-`Procfile`.
6. **כתובת ציבורית** — Settings → Networking → Generate Domain. תקבל URL כמו
   `https://wc-summary-crew-production.up.railway.app`.
7. **בדיקה** — `GET https://<url>/health` צריך להחזיר `{"ok": true}`.

### אבטחה לפני שחושפים החוצה 🔒

ה-service מחזיק את ה-service_role key (שעוקף RLS וקורא הכול). לכן ה-endpoint נועל את עצמו
**אם** הגדרת `CREW_API_SECRET`:

```bash
curl -X POST https://<url>/summary \
  -H "x-crew-secret: <CREW_API_SECRET>" \
  -H "content-type: application/json" \
  -d '{"group_id":"...","date":"2026-06-15"}'
```

בלי ה-header הנכון → 401. (בלי `CREW_API_SECRET` בכלל ה-endpoint פתוח — מתאים רק ל-localhost.)

---

## 6. איך זה מתחבר לאפליקציה (בעתיד, אחרי shadow mode)

כרגע ה-crew רץ ידנית (`run_shadow`) או דרך POST. כשתחליט שהוא בשל להחליף את ה-EF:

1. במקום ש-`pg_cron` יקרא ל-`nightly-summary` EF, הוא יעשה `net.http_post` ל-`/summary`
   של ה-service (עם ה-`x-crew-secret`).
2. ה-service יכתוב ל-`ai_summaries` (כרגע הוא רק *קורא* — תוסיף שלב כתיבה כשתהיה מוכן).
3. את ה-EF אפשר להשאיר כ-fallback בהתחלה.

**אבל זה לא דחוף ולא למונדיאל.** shadow mode קודם: תריץ, תשווה, תכוונן את העברית — ורק כשזה
טוב יותר מה-EF, תחבר.

---

## צ'קליסט מהיר ✅

- [ ] venv + `pip install -r requirements.txt`
- [ ] `.env` עם service_role key + OpenAI key
- [ ] `python -m tests.test_stats` עובר (בלי keys)
- [ ] `uvicorn app.main:app --reload` → `/health` מחזיר ok
- [ ] `run_shadow` מייצר עברית ומשווה ל-EF
- [ ] (כשתרצה ענן) Railway: root dir = `wc-summary-crew`, env vars, domain, `/health`
- [ ] `CREW_API_SECRET` מוגדר לפני חשיפה ציבורית
