# נקודת הכניסה: כל מה שצריך כדי להבין ולהריץ ב-5 דקות

מדריך זה הוא הדלת הראשונה ל-wc-summary-crew. מטרתו אחת: שתריץ את הפרויקט, תבין מה הוא באמת (ומה הוא לא), ותדע איפה העבודה שלך — בלי לפתוח ארבעה קבצים. שאר המסמכים בתיקייה הם העמקה; כאן זה רק האונבורדינג.

---

## התחל כאן (5 דקות)

הרץ את הבלוק הבא משורש `wc-summary-crew/`. אין צורך במפתחות עד שלב ה-shadow:

```bash
# 1. סביבה (פעם אחת) — Python 3.11
python3.11 -m venv venv_wc-summary-crew
source venv_wc-summary-crew/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt

# 2. בדיקות — בלי מפתחות, offline, בערך 2 שניות
pytest                       # unit + integration
python -m tests.test_stats   # בדיקת Stats בלבד, אפס תלויות

# 3. מפתחות (רק לשלב הבא) — מלא ב-.env
cp .env.example .env
#   SUPABASE_SERVICE_KEY + OPENAI_API_KEY (+ SUPABASE_URL)

# 4. shadow mode — הרצה על (group, date) אמיתי, השוואה מול ה-EF
python -m scripts.run_shadow --recent                    # מצא (group_id, date) זמין
python -m scripts.run_shadow --ef <group_id> 2026-06-15  # רק הראסט באנגלית מה-EF (בלי crew, בלי עלות LLM)
python -m scripts.run_shadow <group_id> 2026-06-15       # הרץ את ה-crew + הדפס עברית מול האנגלית של ה-EF
```

עכשיו ראית את הצינור רץ מקצה לקצה: עובדות נשלפות מ-Supabase, מחושבות בפייתון, ועוברות דרך שרשרת קצרה של קריאות LLM עד שיוצא ראסט בעברית. `--recent` נותן לך יעד חי; `--ef` מדפיס את פלט ה-EF הקיים כדי שתשווה צד-לצד; הריצה ללא דגלים מריצה את ה-crew עצמו.

---

## מה זה באמת — workflow, לא חבורת agents

הלקח המרכזי, וחשוב להגיד אותו ישר: ה-crew הוא **workflow** — רצף קבוע ומקודד-מראש של ארבעה שלבים. זה לא צוות סוכנים אוטונומיים שמחליטים מה לעשות. אף שלב לא בוחר את הצעד הבא; הסדר כתוב ב-`app/crew.py`. כל אחד מהשלבים הוא **קריאת LLM מובנית אחת** (חוץ מ-Stats שהוא פייתון טהור בלי LLM), ו-PydanticAI משמש כאן רק כדי לאכוף פלט עם טיפוס (`output_type=...`) — אף שלב לא רושם tools ולא רץ בלולאה אוטונומית.

הספקטרום של ארכיטקטורות LLM, מהפשוט למורכב, במילים:

קריאת LLM אחת — שאלה אחת, תשובה אחת.
שרשרת (chain) — פלט של קריאה אחת נכנס לבאה, בסדר קבוע.
ניתוב (routing) — מסווג ראשון מחליט לאיזה מסלול לשלוח.
מעריך-מייעל (evaluator-optimizer) — כותב מייצר, שופט מנקד, וחוזרים אם צריך. כאן יושב ה-crew: ה-Writer מול ה-Judge.
סוכן עם tools — ה-LLM מקבל כלים ומחליט בעצמו מתי לקרוא לכל אחד.
סוכן אוטונומי — מתכנן, פועל, מתקן בעצמו לאורך ריצה ארוכה.

ארבעת השלבים שלנו, בסדר קבוע — שורת התמצית (התרשים המלא והמוסבר חי במקום אחד,
ב-[`02-multi-agent-system.md`](02-multi-agent-system.md) §2; כאן רק כיוון מהיר, LTR בבלוק קוד כדי לא להתהפך):

```
fetch (read-only) -> Stats (Python, no LLM) -> Personality (LLM) -> Writer (LLM, Hebrew) <-> Judge (LLM, score + retry)
```

הבחירה ב-workflow כאן היא **הבחירה הנכונה**, לא פשרה: היא צפויה (אותו סדר בכל ריצה), זולה (מספר קריאות ידוע מראש), וקלה לדיבוג (כל שלב מקבל ומחזיר אובייקט עם טיפוס, אז קל לבדוד מי שגה). סוכן אוטונומי כאן רק היה מוסיף חוסר ודאות ועלות בלי תועלת — אין כאן שום החלטה שצריך למסור ל-LLM.

---

## מה זה כן agent אמיתי

כדי לראות את הניגוד, יש בפרויקט סוכן אמיתי אחד: `app/agents/support.py`. בניגוד ל-crew, כאן ה-LLM **מחליט בעצמו** באיזה כלי להשתמש מתוך שניים: `search_rules(query)` (חיפוש בחוקי HowToPlay בזיכרון, ניקוד מילולי בפייתון, בלי תלויות חדשות) ו-`get_group_standings(group_id)` (קריאת הטבלה האמיתית דרך `app/data.py`). זאת בדיוק ההגדרה של agent: הקוד לא מנתב — ה-LLM בורר את הכלי בזמן ריצה.

הסוכן חשוף ב-endpoint נפרד, `POST /ask`, מאחורי אותו gate אופציונלי של `x-crew-secret` כמו `/summary`. הרם את השרת והרץ:

```bash
uvicorn app.main:app --reload
```

ואז שלח שאלה (אם `CREW_API_SECRET` מוגדר, הוסף את ה-header; ב-localhost ללא secret הוא לא נאכף):

```bash
curl -X POST http://127.0.0.1:8000/ask \
  -H "Content-Type: application/json" \
  -H "x-crew-secret: $CREW_API_SECRET" \
  -d '{"question":"כמה נקודות יש על הצ׳מפיון?","group_id":null}'
```

התשובה חוזרת כ-`SupportAnswer`: `answer_he` (התשובה בעברית), `used_tools` (אילו כלים ה-LLM באמת קרא להם), ו-`escalate` (אם צריך אדם). שים לב ל-`used_tools` — שם רואים שחור-על-לבן שה-LLM הוא זה שבחר. זה כל ההבדל בין workflow ל-agent.

---

## התור שלך

ה-Writer (`app/agents/writer.py`) הוא שלך לכוונן, וזו העבודה בעלת הערך הגבוה ביותר בפרויקט: כל שאר השלבים עובדים, ויש בדיוק מקום אחד שאחראי על השפה — הוא. רשימת ה-`TODO(Itay)` בקובץ היא ה-source of truth לסדר העדיפויות (טון, שימוש בתגיות PlayerStyle, איסור קלישאות עבריות, מבנה, edge cases); אל תשכפל אותה — קרא אותה שם.

שני יעדי המשך (stretch), כל אחד בשורה:

לולאת שיפור-עצמי — חיבור ה-Judge ל-`prompt_versions` כך שגרסאות מנצחות נשמרות; שלד הלולאה כבר ב-`app/crew.py`.
צ׳אטבוט / RAG מעל HowToPlay — אותו שירות פייתון, סוכן נוסף; הזרע כבר קיים ב-`app/agents/support.py`.

---

## לאן הלאה

מדריך זה הוא האינדקס בלבד; כל אחד מהבאים מעמיק בנושא אחד, בלי כפילות כאן:

מסמך 01, [server & deploy](01-server-and-deploy.md) — השרת, ה-deploy ל-Railway, ושער האבטחה `CREW_API_SECRET`.
מסמך 02, [the workflow explained](02-multi-agent-system.md) — ה-crew מוסבר לעומק: התפקידים, ה-pipeline צעד-צעד, וההבדל מ-ensemble.
מסמך 03, [dev insights](03-dev-insights.md) — הבאגים שתיקנו ותובנות הפיתוח מאחוריהם.
