# הצינור (workflow) של קריאות LLM מובנות — מה קורה ומה השתנה

זה המסמך שמסביר את הלב של מה שדיברנו עליו במפגש — ה-crew. מה זה באמת, איך זה שונה ממה שהיה,
מה כבר קיים (ובנית בעצמך), ומה עוד חסר.

הבהרה אחת מראש, כי היא חשובה ונשארת נכונה לכל המסמך: מה שבנינו כאן הוא **workflow** — רצף
שלבים בסדר *קבוע ומקודד-קשיח* בקובץ `crew.py`. אף שלב לא "מחליט" מה לקרוא הבא, ואף שלב לא
משתמש ב-tools. מ-PydanticAI אנחנו לוקחים פיצ'ר אחד בלבד — **structured output** (`output_type`).
המילה "crew" היא שם הפרויקט, לא טענה שיש כאן agents אוטונומיים. את ה-agent האמיתי (כזה
שה-LLM בוחר בו tool בזמן ריצה) בנינו בנפרד — ראה §6 "workflow מול agent".

---

## 1. מ-ensemble ל-crew — ההבדל בשורה אחת

* מה שיש לך היום, **ensemble**: אותו *תפקיד* רץ כמה פעמים. 5 פרומפטים כמעט-זהים שכולם
  מנסים לכתוב את אותו סיכום, ו-Judge בוחר את הטוב מביניהם. זה כמו לשאול 5 כותבים את אותה שאלה
  ולבחור את התשובה הכי טובה.
* מה שבנינו כאן, **crew**: *תפקידים שונים* בשרשרת. שלב אחד מחשב סטטיסטיקות, שלב מתייג אישיות,
  שלב כותב בעברית, שלב שופט. זה כמו צוות מערכת: כתב, עורך, מבקר — כל אחד עבודה אחת.

הנקודה החשובה מהמפגש: ה-5 שלך הם **אותו תפקיד ×5**, לא 5 אישיויות. ה-Judge הוא התפקיד השני
האמיתי היחיד שכבר היה לך. ה-crew מוסיף תפקידים *חדשים* — לא עוד עותקים.

הערה על מילון: לאורך המסמך אני קורא לכל חוליה בשרשרת **שלב** (stage/step), לא "agent". זה לא
קוסמטי — זה ההבדל ב-§6: שלב הוא חוליה בצינור קבוע; agent הוא ישות שבוחרת פעולה.

---

## 2. הצינור (workflow) — מה קורה שלב-שלב

הצינור הזה הוא הדיאגרמה הקנונית; שאר המסמכים מקשרים לכאן ולא משכפלים אותה.

```
   fetch (live, read-only from Supabase)
        |  group + members + predictions + games + leaderboard
        v
   +-------------+
   |   Stats     |  pure Python, NO LLM. Deterministic facts:
   |  (step)     |  who leads, who scored most today, who went cold,
   |             |  how many nailed the exact score, did a result upset the group.
   +------+------+  -> StatsBlock (typed)
          |
          v
   +-------------+
   | Personality |  LLM. Tags each member with a style:
   |  (step)     |  the_optimist / the_coward / the_sniper / the_ghost ...
   |             |  + evidence -- one real fact from the data behind the tag.
   +------+------+  -> list[PlayerStyle] (typed, one per member)
          |
          v
   +-------------+
   |   Writer    |  LLM. Takes the facts + tags, writes the roast in Hebrew.
   |  (yours!)   |  The ONLY step that owns language.
   +------+------+  -> CrewSummary (text_he)
          |
          v
   +-------------+
   |   Judge     |  LLM (expensive model). Scores accuracy/humor/hebrew/structure 0-10.
   |  (step)     |  Below threshold -> back to Writer with feedback, up to N attempts.
   +-------------+  -> JudgeVerdict
```

כל חץ בדיאגרמה הוא **handoff מובנה (typed)**: הפלט של שלב אחד הוא הקלט של הבא, כאובייקט עם
מבנה (schema) קבוע — לא בלוב טקסט. זה כל היופי: כל שלב מבודד וניתן לכיוונון בנפרד. שים לב למה
שזה *לא*: אף שלב כאן לא רושם tools ולא מחליט לבד לאן ללכת — הסדר נקבע ידנית בלולאה ב-`crew.py`,
לא על-ידי מודל.

---

## 3. מה כל שלב עושה

| שלב | LLM? | קלט | פלט | קובץ |
|---|---|---|---|---|
| שלב **Stats** | לא | raw data | `StatsBlock` | `app/agents/stats.py` |
| שלב **Personality** | כן | `MemberStat` | `PlayerStyle` | `app/agents/personality.py` |
| שלב **Writer** | כן | facts + tags | `CrewSummary` (עברית) | `app/agents/writer.py` |
| שלב **Judge** | כן | facts + roast | `JudgeVerdict` | `app/agents/judge.py` |

שלב ה-Stats הוא פייתון טהור (בלי LLM) — שלב דטרמיניסטי בצינור. בדיוק כמו אצלך ב-EF: מחשבים
את העובדות קודם, ורק אז נותנים אותן למודלים, כדי שה-LLM יכתוב פרוזה מעל מספרים שכבר אומתו.
פונקציית פייתון בלי LLM ובלי אוטונומיה היא **שלב בצינור, לא agent** — אל תיתן ל"שם של
התיקייה" (`agents/`) לבלבל; ראה §6.

ועוד דיוק שחשוב לא לפספס: גם שלושת השלבים שכן קוראים ל-LLM (Personality, Writer, Judge) **לא
רושמים tools**. כל אחד מהם מקבל קלט, קורא ל-LLM פעם אחת עם `output_type`, ומחזיר אובייקט typed.
הם שלבים מובנים — לא agents שבוחרים פעולה.

---

## 4. למה PydanticAI (ולא LangGraph/CrewAI)

בגלל ש-PydanticAI ממשיך בדיוק את מה שכבר עשית — בלי DSL חדש ובלי framework כבד. הוא נותן כאן
דבר אחד מרכזי: **structured output**. כשאתה מגדיר לשלב `output_type=PlayerStyle`, המודל
**מחויב** להחזיר בדיוק את ה-schema הזה. אין `JSON.parse`, אין "בבקשה תחזיר JSON תקין", ואין
שום retry ידני על הפענוח.

דיוק חשוב על המילה "tool-call": מתחת למכסה המנוע, structured output ממומש דרך ה-function-calling
הפנימי של OpenAI — זה מנגנון שמכריח את צורת הפלט, **לא** tool שהשלב בחר להפעיל. הלולאה שה-framework
עושה בשבילך כאן היא בדיוק זו: schema-validation + re-ask על קריאה **אחת**, עד שהפלט תקין. זה
מה ש-framework קונה לך מעל prompt גולמי. הלולאה ההדדית בין Writer ל-Judge וסדר השלבים — אלה
כתובים ביד ב-`crew.py`; ה-framework לא מנהל את ה-workflow.

הדוגמה העובדת המלאה: [`app/agents/personality.py`](../app/agents/personality.py). קרא אותה
מלמעלה למטה — זו ה-class הקטן (`PlayerStyle`) שביקשת לראות במפגש, בקוד שרץ.

---

## 5. התשובה לשאלת הזהב: Writer מול ה-prompt שאתה כותב היום ⭐

שאלת: *"מה ההבדל בין ה-Writer לבין ה-prompt שאני כותב היום?"*

ההבדל הוא **הקלט והאחריות**:

* היום: prompt אחד שמקבל בלוב JSON, צריך "להבין הכול" ולכתוב.
* ה-Writer: מקבל **אובייקטים typed** — `StatsBlock` (עובדות) + `list[PlayerStyle]` (תיוגים)
  שכבר חושבו עבורו. תפקידו **צר**: עברית בלבד.

ובגלל זה — אתה יכול לכוונן את ה-Writer **לבד**, למדוד אותו עם ה-Judge, ואפילו להחליף לו מודל,
**בלי לגעת** בחישוב הסטטיסטיקות או בתיוג. עם prompt ענק אחד אין לך את ההפרדה הזו. את ה-TODO
הממוספר של ה-Writer (לפי עדיפות) שמור בקובץ עצמו, [`app/agents/writer.py`](../app/agents/writer.py)
— זה ה-source of truth, ולא משוכפל כאן.

---

## 6. ההבדל workflow מול agent — איפה הצינור הזה על הסקאלה, ומה ה-agent האמיתי

זאת הנקודה הכי חשובה במסמך, וגם זו שהכי קל לטעות בה. שני המונחים *נשמעים* אותו דבר, אבל
הם קצוות של סקאלה:

* צד ה-**workflow** (מה שה-crew הוא): רצף שלבים *מקודד-קשיח*. אתה, המתכנת, קבעת בקוד מי רץ אחרי
  מי. ה-LLM כותב טקסט בתוך שלב — אבל לא בוחר מה השלב הבא, ולא מפעיל כלים. כל ה-flow ב-`crew.py`
  הוא `fetch` ואז `stats.run` ואז `personality.run` ואז לולאת `writer`/`judge`. סדר נוקשה.
* צד ה-**agent** (הקצה השני): ישות שמקבלת מטרה ו**בוחרת בעצמה** אילו tools להפעיל ובאיזה סדר,
  בזמן ריצה. אתה נותן לה כלים + מטרה; ה-LLM מחליט. אין "סדר שלבים" קבוע מראש — ההחלטה היא של
  המודל בכל צעד.

למה זה משנה לך מעשית: ב-workflow אתה שולט ב-flow (צפוי, נוח לבדיקה, זול), ומשלם בכך שהוא נוקשה.
ב-agent אתה מקבל גמישות (מתאים ל"שאל אותי כל דבר") ומשלם באי-ודאות (המודל עלול לבחור tool
מיותר/שגוי). שניהם לגיטימיים; פשוט תדע מה בנית.

### ה-agent האמיתי בפרויקט: `support.py`

כדי שההבדל לא יישאר תאוריה, יש בריפו דוגמה אחת *מנוגדת* ל-crew — agent אמיתי שבוחר tools:

קובץ: `app/agents/support.py`. זה agent של PydanticAI שמקבל שאלת משתמש, וחושף לו **2 tools**
שה-LLM **מחליט** ביניהם בזמן ריצה:

* כלי ראשון, **search_rules(query)** — חיפוש מילות-מפתח (פייתון טהור, ניקוד פשוט) מעל corpus
  ה-HowToPlay בזיכרון. בלי dependencies חדשים, בלי embeddings.
* כלי שני, **get_group_standings(group_id)** — קורא את הטבלה האמיתית דרך `app/data.py` הקיים.
  מוגן: מחזיר מחרוזת "unavailable" ידידותית על שגיאה או keys חסרים, ולא מפיל את ה-agent.

הפלט שלו הוא מודל typed, `SupportAnswer` (ב-`app/models.py`): השדה `answer_he` (התשובה בעברית),
השדה `used_tools` (אילו tools באמת נקראו), והשדה `escalate` (האם להעביר לאדם). נגיש דרך endpoint
חדש, `POST /ask` (body: `question`, `group_id` אופציונלי), מאחורי **אותו** שער `x-crew-secret`
האופציונלי כמו `/summary`.

זה כל השיעור בשורה אחת: ה-crew (השרשרת Stats, Personality, Writer, Judge) הוא **workflow**
קבוע; הקובץ `support.py` הוא **agent** אמיתי — ה-LLM בוחר איזה tool להפעיל בזמן ריצה. שים את
שתי הצורות זו לצד זו וההבחנה נהיית מוחשית.

---

## 7. מה כבר קיים — דברים שאתה כבר בנית (continuity)

ה-crew הזה **לא** מתחיל מאפס. הוא ממשיך אותך:

| מה | מאיפה זה בא |
|---|---|
| שלב **Judge** | בנית אותו ב-EF (gpt-4o, rubric עם משקלים, hard floor). כאן הוא מנקד את ה-Writer. |
| **חישוב stats דטרמיניסטי** | אתה כבר עושה את זה ב-EF — חישוב לפני LLM. |
| יכולת **reproducibility** | seed + temperature נמוך, בדיוק האינסטינקט שלך מ-PR#1 (seed=42 ב-config). |
| יכולת **audit** | שמירת reasoning + scores, בדיוק כמו `ai_judge_runs` שלך. |
| **המעגל הסגור** | הרעיון של Judge שמחזיר feedback — גזרת אותו לבד במפגש. |

---

## 8. הלולאה ההדדית בין Writer ל-Judge (ומה זה "מערכת שמשתפרת לבד")

ב-[`app/crew.py`](../app/crew.py) ה-Writer וה-Judge רצים בלולאה:

1. שלב ה-Writer כותב roast.
2. שלב ה-Judge מנקד (0–10). אם מספיק טוב — שולחים.
3. אם לא — ה-Judge מחזיר **feedback** ("העברית פה צולעת", "ההלצה שטוחה"), וה-Writer מנסה שוב
   עם ההערה. עד `MAX_WRITER_ATTEMPTS`.

שים לב למה שזה *לא*: זו לולאה שאתה כתבת ביד ב-`crew.py`, לא תזמור אוטונומי של ה-framework.
ה-framework (כלומר PydanticAI) מריץ עבורך רק את לולאת ה-validation/re-ask של **קריאה בודדת**
(ה-structured output); את הלולאה ההדדית בין Writer ל-Judge ואת סדר השלבים אתה מנהל בקוד שלך.

זה הצעד הראשון של "מערכת שמשתפרת לבד". הצעד הבא (ה-stretch) — לשמור את הגרסאות שניצחו
ל-`prompt_versions` ולתת ל-Writer ללמוד מהיסטוריה. זה בדיוק ה"מעגל הסגור" שדיברנו עליו, שכבה
אחת מעל ה-Judge שכבר בנית.

---

## 9. מה עוד חסר (האופק)

המשימה האמיתית והקרובה שלך היא כיוונון העברית של ה-Writer — והרשימה הממוספרת לכך חיה בקובץ
[`app/agents/writer.py`](../app/agents/writer.py). מעבר לזה, אלה כיווני ההמשך:

| מה | סטטוס | איפה |
|---|---|---|
| לולאת **self-improvement** | זרע קיים | ה-loop ב-`crew.py` רץ; חסר לשמור גרסאות מנצחות ל-`prompt_versions` per-stage |
| צ׳אטבוט **RAG** מעל HowToPlay | התחלה קיימת | `support.py` הוא הזרע — agent אמיתי עם tools; אפשר להרחיב ל-retrieval מלא |
| שער **gate** לנרשמים | אופק | middleware על אותו service |
| **כתיבה ל-`ai_summaries`** | בכוונה לא | כרגע read-only (shadow). תוסיף כתיבה כשתחליף את ה-EF |

הרצה, deploy ו-shadow mode מתועדים במקום אחר ולא משוכפלים כאן: ראה את ה-README
([`../README.md`](../README.md)) ואת [`01-server-and-deploy.md`](01-server-and-deploy.md).
