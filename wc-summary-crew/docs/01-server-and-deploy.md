# השרת: מה בנינו, ארכיטקטורה חדשה מול ישנה, ואיך מריצים בענן

מסמך הסבר ברמת high-level + הוראות הרצה ודיפלוי מדויקות. הקוד עצמו מתועד באנגלית; כאן ההסבר
בעברית.

---

## 0. קודם כול — למה זה בטוח לפרודקשן 🔒

לפני כל דבר אחר, האמת החשובה: השירות הזה **לא נוגע בכלום ממה שכבר עובד אצלך.**

> שירות **תוסף (additive), read-only, ב-shadow mode**, שיושב **בתיקייה משלו** (`wc-summary-crew/`)
> ו**לא משנה אף קובץ קיים** ולא נוגע ב-Edge Function החי שלך.

הפירוק:

- **תיקייה נפרדת** — כל הקוד יושב ב-`wc-summary-crew/` בלבד; שום קובץ של האפליקציה, של ה-frontend
  או של ה-Supabase לא נערך.
- **קריאה בלבד (read-only)** — השירות רק *קורא* את ה-data מ-Supabase (אותו data שה-EF קורא).
  הוא לא כותב ל-`ai_summaries` ולא לשום טבלה אחרת.
- **מצב צל (shadow mode)** — ה-EF הלילי שלך ממשיך לרוץ ולייצר את הסיכום (באנגלית) כרגיל; השירות
  רץ *לידו*, קורא את אותו data, ומייצר גרסת crew בעברית. אתה משווה צד-לצד. **אפס סיכון לפרודקשן.**

כלומר אפשר להריץ, להתנסות ולכוונן בלי שום חשש שמשהו במונדיאל יישבר.

---

## 1. התמונה הגדולה — מה בנינו

בנינו **Python service** (FastAPI) שרץ **לצד** Supabase, לא במקומו. הוא מנוע (engine) שלוקח
את ה-data שכבר יושב אצלך ב-Supabase, מריץ עליו workflow של קריאות LLM מובנות + שלב חישוב בפייתון
(ה-crew), ומחזיר סיכום לילי בעברית.

זה בדיוק המהלך משקף 5 במפגש:

> **הנוסחה: Supabase = הדאטה, Python = המנוע.** ה-Edge Functions נשארים איפה שהם; השרת החדש
> הוא זה שמתזמן ומנהל את ה-AI.

---

## 2. ארכיטקטורה: ישן מול חדש

זה המסמך שמחזיק את ההשוואה הארכיטקטונית **ישן מול חדש** (runtime, אירוח, timeout). את
ה-pipeline המפורט עצמו (Stats, אחריו Personality, אחריו Writer בלולאה מול Judge) ואת ההסבר
הרעיוני ensemble-מול-crew תמצא במקום אחד:
[`02-multi-agent-system.md`](02-multi-agent-system.md). פה רק המסגרת.

### הישן — `nightly-summary` Edge Function

מהות: serverless. אין תהליך חי; כל לילה ה-cron מעיר את ה-EF, הוא קורא stats + leaderboard
מ-Supabase, מריץ 5 קריאות LLM במקביל (ensemble — *אותו תפקיד* ×5), Judge בוחר את הטוב מביניהן,
וכותב ל-`ai_summaries` (אנגלית). מגבלות: timeout של Supabase (כבר נשברת עליו במעבר מ-5 ל-8
קבוצות), ושפה אחת.

### החדש — `wc-summary-crew` Python service

מהות: always-on. תהליך חי ב-FastAPI, בלי תקרת timeout, שיכול לשרת גם דברים שצריכים תגובה מיידית
(chatbot, gate) בעתיד. במקום ensemble — workflow מובנה של שלבים שונים, כל שלב עבודה אחת
ו-handoff typed, והעברית חיה במקום אחד (ה-Writer). הפירוט המלא ב-`docs/02`.

### טבלת השוואה

| | ישן (EF) | חדש (crew) |
|---|---|---|
| שפה/runtime | TypeScript / Deno | Python / FastAPI |
| איפה רץ | Supabase (serverless) | שרת always-on (Railway וכו') |
| ארכיטקטורת AI | ensemble (אותו תפקיד ×5) | workflow (שלבים שונים) |
| שפת פלט | אנגלית | עברית |
| תקרת timeout | יש (מגבלת Supabase) | אין |
| מתאים ל-chatbot/gate חיים | פחות | כן |
| שלב Judge | קיים (בורר מבין 5) | קיים (אותו רעיון, מנקד את ה-Writer) |

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
| ספק Railway ⭐ | ~$5/חודש | always-on אמיתי. ההמלצה מהמפגש. |
| ספק Render | חינם / $7 | ה-tier החינמי **נרדם** אחרי חוסר פעילות (cold start של שניות בכל בקשה) |
| ספק Fly.io | חינם-מוגבל / לפי שימוש | גמיש, מעט יותר setup |

**עלויות נוספות שכבר קיימות (לא חדשות):**
- **מפתח OpenAI API** — אותו key של ה-EF; אתה כבר משלם לפי שימוש. ה-crew פשוט עושה עוד קריאות.
- **שירות Supabase** — נשאר כמו שהוא. **אתה לא צריך Supabase Pro ($25)** בשביל זה.

> זוכר את ההכרעה מהמפגש? **$5 Railway, לא $25 Supabase Pro.** השרת ב-$5 נותן לך גם dev/prod
> מובנה, אז אין צורך ב-Branching של Pro.

**הכרעה מומלצת:** התחל ב-**Render free** רק כדי לראות שזה עולה (לא אכפת לך מ-cold start
בהתנסות), וכשתרצה always-on אמיתי — **Railway ב-$5**.

---

## 4. הרצה מקומית (לפני שמדברים על ענן)

```bash
cd wc-summary-crew
python3.11 -m venv venv_wc-summary-crew
source venv_wc-summary-crew/bin/activate
pip install -r requirements.txt
cp .env.example .env          # ואז מלא SUPABASE_SERVICE_KEY + OPENAI_API_KEY (+ SUPABASE_URL)
uvicorn app.main:app --reload # פתח http://127.0.0.1:8000/health  ->  {"ok": true}
```

המתכון המלא (כולל tests, shadow mode והשוואה ל-EF) נמצא ב-README תחת "How to run" — אל
תשכפל אותו פה. ה-`SUPABASE_SERVICE_KEY` מגיע מ-Supabase dashboard, במסך Project Settings,
לשונית API, השדה service_role (סוד!); וה-`OPENAI_API_KEY` הוא אותו key של ה-EF.

---

## 5. דיפלוי ל-Railway — צעד-אחר-צעד 🚂

הערה לפני שמתחילים: דיפלוי אחד מעלה את **שני** ה-endpoints. אותו service מגיש את המסלול
הלילי `POST /summary` (ה-crew) וגם את מסלול ה-`POST /ask` — סוכן ה-support, שבוחר בעצמו באיזה
כלי (tool) להשתמש: חיפוש בחוקים או שליפת standings. שניהם יושבים מאחורי אותו gate
(`x-crew-secret`), ואין צורך לפרוס שום דבר נפרד.

(הקובץ `Procfile` כבר בריפו ואומר ל-Railway איך להריץ: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.)

1. **חשבון** — היכנס ל-[railway.app](https://railway.app), התחבר עם GitHub.
2. **פתיחת פרויקט** — לחץ New Project, אחר כך Deploy from GitHub repo, ובחר את `2026-World-Cup-Social-Predicting-App`.
3. **הגדרת Root Directory** — בהגדרות ה-service (תחת Settings ואז Source) קבע
   `Root Directory = wc-summary-crew`. **קריטי** — אחרת Railway ינסה לבנות את כל הריפו.
4. **משתני סביבה** (Variables) — הוסף:
   - המשתנה `SUPABASE_URL` = `https://<project>.supabase.co`
   - המשתנה `SUPABASE_SERVICE_KEY` = ה-service_role key
   - המשתנה `OPENAI_API_KEY` = ה-key שלך
   - המשתנה `CREW_API_SECRET` = מחרוזת אקראית (כדי לנעול את ה-endpoint — ראה למטה)
5. **הרצת Deploy** — Railway יזהה Python, יתקין מ-`requirements.txt`, ויריץ לפי ה-`Procfile`.
6. **כתובת ציבורית** — תחת Settings, אחר כך Networking, ואז Generate Domain. תקבל URL כמו
   `https://wc-summary-crew-production.up.railway.app`.
7. **בדיקה** — `GET https://<url>/health` צריך להחזיר `{"ok": true}`.

### אבטחה לפני שחושפים החוצה 🔒

ה-service מחזיק את ה-service_role key (שעוקף RLS וקורא הכול). לכן **שני** ה-endpoints
(`/summary` וגם `/ask`) נועלים את עצמם **אם** הגדרת `CREW_API_SECRET`:

```bash
curl -X POST https://<url>/summary \
  -H "x-crew-secret: <CREW_API_SECRET>" \
  -H "content-type: application/json" \
  -d '{"group_id":"...","date":"2026-06-15"}'
```

בלי ה-header הנכון תקבל 401 — אותו gate בדיוק חל גם על `POST /ask`. (בלי `CREW_API_SECRET`
בכלל ה-endpoints פתוחים — מתאים רק ל-localhost.)

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

- [ ] יצירת venv + `pip install -r requirements.txt`
- [ ] קובץ `.env` עם service_role key + OpenAI key
- [ ] הפקודה `python -m tests.test_stats` עוברת (בלי keys)
- [ ] הפקודה `uvicorn app.main:app --reload` מחזירה ב-`/health` את ok
- [ ] הסקריפט `run_shadow` מייצר עברית ומשווה ל-EF
- [ ] (כשתרצה ענן) Railway: root dir = `wc-summary-crew`, env vars, domain, `/health`
- [ ] המשתנה `CREW_API_SECRET` מוגדר לפני חשיפה ציבורית
