# WC Summary Crew 🏆🤖

צוות הסוכנים (multi-agent crew) לסיכום הלילי של אפליקציית המונדיאל — זה ה-reference
implementation של מה שדיברנו עליו במפגש 6. הצינור רץ מקצה לקצה ומוציא **עברית**, הוא קורא
את ה-**data האמיתי שלך** מ-Supabase, והוא לא נוגע ב-Edge Function החי שלך אפילו פעם אחת.

> אחי, זה בנוי כדי שתשחק איתו ותלמד מתוך העשייה. רוב הקוד עובד; חלק אחד — ה-**Writer** —
> השארתי לך בכוונה. הוא הלב, וזה החלק שהכי שווה לך לכתוב בעצמך. פירוט למטה.

---

## מה זה, ולמה (ה-lesson של המפגש)

הסיכום הלילי שלך היום הוא **ensemble**: חמש וריאציות של *אותו תפקיד* (אותו prompt, שינויים
קטנים) + Judge שבוחר את הטוב. זה עובד — אבל אם אתה רוצה עברית טובה אתה צריך לכוונן חמישה
prompts במקביל.

כאן זה **crew** — חלוקה ל-*תפקידים* שונים, כל אחד עם עבודה אחת:

```
   fetch (live, read-only מ-Supabase)
        │
        ▼
   ┌──────────┐   facts     ┌──────────────┐   PlayerStyle   ┌──────────┐   עברית   ┌─────────┐
   │  Stats   │ ──────────▶ │ Personality  │ ──────────────▶ │  Writer  │ ───────▶ │  Judge  │
   │ (פייתון, │             │   (LLM)      │                 │  (LLM,   │   ⇄      │  (LLM)  │
   │  בלי LLM)│             │ תיוג שחקנים  │                 │  עברית)  │  ניקוד+  │ 0–10 +  │
   └──────────┘             └──────────────┘                 └──────────┘  retry   │ feedback│
                                                                                    └─────────┘
```

כל שלב מקבל **אובייקט typed** ומחזיר **אובייקט typed**. זה כל העניין של ה-framework: בגלל
שה-handoff מובנה, כל סוכן עושה דבר אחד — ואפשר לכוונן/למדוד/להחליף כל אחד בנפרד.

---

## התשובה לשאלה ששאלת (Writer מול prompt רגיל) ⭐

במפגש שאלת: *"מה ההבדל בין ה-Writer לבין ה-prompt שאני כותב היום?"* — והתשובה אף פעם לא
עלתה על המסך. הנה היא, בקוד:

* פתח את [`app/models.py`](app/models.py) — שם יושב ה-`PlayerStyle` (ה-class הזעיר שביקשת לראות).
* פתח את [`app/agents/writer.py`](app/agents/writer.py) — תראה שה-Writer מקבל `StatsBlock` +
  `list[PlayerStyle]`, כלומר **עובדות ותגיות מוכנות**, לא בלוב טקסט.

ההבדל הוא שניים:
1. **ה-INPUT מובנה** — לא "תבין הכול ותכתוב", אלא אובייקט typed שכבר חושב.
2. **האחריות צרה** — תפקיד יחיד: עברית. רק עברית.

לכן אתה יכול לכוונן את ה-prompt הזה *לבד*, למדוד אותו עם ה-Judge, ואפילו להחליף לו מודל —
בלי לגעת ב-Stats או ב-Personality. עם prompt אחד ענק לא הייתה לך את ההפרדה הזאת.

---

## האמת הלא-נעימה (ושווה שתכיר אותה) 🧠

**קריאות LLM עובדות מצוין ב-TypeScript.** אתה *לא חייב* Python בשביל לקבל עברית — היית יכול
להוסיף שלב Writer בתוך ה-EF הקיים. אז למה הדבר הזה קיים?

1. **הקפיצה הקריירתית** — backend אמיתי (FastAPI), framework אמיתי (PydanticAI). זה Track F.
2. **ארכיטקטורה נקייה** — מקום אחד שאחראי על שפה, במקום חמישה prompts.
3. **שדה משחק בטוח** — ללמוד multi-agent על ה-data האמיתי שלך *בלי לסכן* את ה-EF החי 11 ימים
   לפני המונדיאל.

זה רץ ב-**shadow mode**: ה-EF ממשיך לייצר את הסיכום (האנגלי) כרגיל, וה-crew רץ לידו וקורא
את אותו data. אתה משווה צד-לצד. אפס סיכון לפרודקשן.

---

## איך מריצים 🚀

```bash
# 1. סביבה (פעם אחת) — Python 3.11
python3.11 -m venv venv_wc-summary-crew
source venv_wc-summary-crew/bin/activate
pip install -r requirements.txt

# 2. secrets
cp .env.example .env
#   ערוך את .env ומלא:
#   SUPABASE_SERVICE_KEY  → Supabase dashboard → Project Settings → API → service_role (secret)
#   OPENAI_API_KEY        → אותו key של ה-EF
#   (התחל עם פרויקט ה-DEV, ftryuvfdihmhlzvbpfeu, כדי לשחק בבטחה)

# 3. בדיקה שלא צריכה keys בכלל — מאמתת את ה-Stats agent
python -m tests.test_stats

# 4. shadow mode — הרץ על קבוצה+תאריך אמיתיים והשווה ל-EF
python -m scripts.run_shadow --recent                  # מראה (group_id, date) זמינים
python -m scripts.run_shadow --ef <group_id> 2026-06-15 # מדפיס רק את ה-roast האנגלי של ה-EF (בלי crew, בלי LLM)
python -m scripts.run_shadow <group_id> 2026-06-15      # מריץ את ה-crew + מדפיס עברית מול האנגלית של ה-EF

# 5. כ-service (סלייד 5 — "סקריפט שמתחיל ב-app = FastAPI()")
uvicorn app.main:app --reload
#   POST http://127.0.0.1:8000/summary   body: {"group_id":"...","date":"2026-06-15"}
```

---

## מה **אתה** צריך לעשות (learn by doing) ✍️

* **★ ה-Writer הוא שלך:** [`app/agents/writer.py`](app/agents/writer.py). הצינור רץ ומוציא
  עברית כבר עכשיו — אבל ה-prompt שם הוא נקודת התחלה שטוחה בכוונה. **להפוך אותו לעברית באמת
  מצחיקה (לא תרגום) זו העבודה הכי בעלת-ערך בכל הפרויקט.** בפנים יש `TODO(Itay)` ממוספר לפי
  עדיפות (tone, שימוש ב-tags, באן לקלישאות בעברית כמו ה-banned-words שלך ב-EF, מבנה, edge cases).
  השתמש ב-[`app/agents/personality.py`](app/agents/personality.py) כדוגמה עובדת לתבנית.

* **Stretch (אחרי שה-Writer טוב):**
  * **self-improvement loop** — לחבר את ה-Judge ל-`prompt_versions` per-agent, בדיוק ה"מעגל
    הסגור" שגזרת לבד במפגש. ה-loop כבר קיים ב-[`app/crew.py`](app/crew.py); מה שחסר זה לשמור
    גרסאות מנצחות.
  * **chatbot/RAG** מעל ה-HowToPlay — אותו Python service, סוכן נוסף. הזרע כבר פה.

---

## מפת הקבצים 🗺️

| קובץ | מה זה |
|---|---|
| [`app/models.py`](app/models.py) | החוזים ה-typed בין הסוכנים — כולל `PlayerStyle` |
| [`app/data.py`](app/data.py) | קריאה live, read-only ל-Supabase (אותם RPCs כמו ה-EF) |
| [`app/agents/stats.py`](app/agents/stats.py) | סוכן ה-Stats — פייתון טהור, בלי LLM |
| [`app/agents/personality.py`](app/agents/personality.py) | **דוגמה עובדת מלאה** ל-PydanticAI |
| [`app/agents/writer.py`](app/agents/writer.py) | **★ שלך לכוונן** — סוכן הכתיבה בעברית |
| [`app/agents/judge.py`](app/agents/judge.py) | ה-Judge שלך, מועבר מה-EF |
| [`app/crew.py`](app/crew.py) | הצינור: Stats→Personality→Writer→Judge + retry |
| [`app/main.py`](app/main.py) | ה-FastAPI service |
| [`scripts/run_shadow.py`](scripts/run_shadow.py) | runner ל-shadow mode + השוואה ל-EF |
| [`tests/test_stats.py`](tests/test_stats.py) | בדיקה offline (בלי keys) |

---

## לקראת מפגש 22/6 📅

בדיוק כמו שאמרת — *"קצת לשחק עם הדברים ואז לדבר"*. שחק עם ה-shadow mode, כוונן את ה-Writer
עד שהעברית מצחיקה, ובמפגש נעבור על זה יחד: נחבר את ה-self-improvement loop ונוסיף את
ה-chatbot על אותו service. 🤝
