# WhatsApp Campaign Manager

מערכת לניהול קמפיינים שיווקיים ב-WhatsApp Business Cloud API: אנשי קשר והסכמות, הסרות אוטומטיות, תבניות, קמפיינים, תיבת הודעות, מעקב קליקים, דוחות ו-API ל-n8n.

**טכנולוגיות:** Next.js 16 (App Router) · TypeScript · Tailwind + shadcn/ui (RTL) · PostgreSQL + Prisma 7 · Worker נפרד לתור השליחה · Railway.

---

## מבנה

| רכיב | תפקיד |
|---|---|
| `src/app` | ממשק (עברית, RTL), Server Actions, Route Handlers (`/api/webhooks/whatsapp`, `/api/v1/*`, `/r/:token`, `/api/health`) |
| `src/server` | שכבת השירותים: הרשאות, הפרדה בין עסקים, הסכמות, הסרות, קמפיינים, מנוע שליחה, Webhooks |
| `src/worker` | תהליך רקע: שליחה מתוזמנת עם נעילה וקצב, התאוששות מקריסה, ניסיונות חוזרים, Webhooks יוצאים, סנכרון Sheets, שמירת מידע |
| `prisma` | סכמה ומיגרציות |
| `tests` | בדיקות אוטומטיות (Vitest) מול PostgreSQL אמיתי |

התור נשמר ב-PostgreSQL (ללא Redis): `FOR UPDATE SKIP LOCKED` מונע שליחה כפולה, כל הודעה נשלחת עם `biz_opaque_callback_data` לצורך שחזור אחרי קריסה, והודעה שמצבה לא ודאי לעולם לא נשלחת שוב אוטומטית.

---

## פריסה ל-Railway

הפרויקט כולל `Dockerfile` אחד ושני קובצי הגדרה: `railway.json` לשירות ה-Web ו-`railway.worker.json` לשירות ה-Worker.

### 1. יצירת הפרויקט
1. ב-Railway: **New Project → Deploy from GitHub repo** ובחירת הריפוזיטורי. זה יוצר את שירות ה-**Web**.
2. **+ New → Database → PostgreSQL**. זה בסיס הנתונים של המערכת.
3. **+ New → GitHub Repo** (אותו ריפו) ליצירת שירות שני, ה-**Worker**. ב-Settings שלו: **Config-as-code → Config file path** = `railway.worker.json`.

### 2. משתני סביבה
יש להגדיר בשני השירותים (Web ו-Worker). אפשר להגדיר פעם אחת כ-Shared Variables:

| משתנה | ערך |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `ENCRYPTION_KEY` | מחרוזת אקראית של 32 תווים ומעלה. מצפינה אסימוני גישה. |
| `HASH_PEPPER` | מחרוזת אקראית נוספת, 32 תווים ומעלה. **אסור לשנות אחרי עלייה לאוויר** (רשימת ההסרה תלויה בה). |
| `APP_URL` | הכתובת הציבורית של שירות ה-Web, למשל `https://xxx.up.railway.app` |
| `META_GRAPH_API_VERSION` | `v25.0` |
| `META_APP_SECRET` | ה-App Secret של אפליקציית Meta (או הזנה לכל חשבון במסך החשבונות) |
| `META_WEBHOOK_VERIFY_TOKEN` | מחרוזת אקראית. משמשת ל-Webhook המשותף. |

לשירות ה-Web בלבד, לפריסה הראשונה (ליצירת המשתמש הראשון):

| משתנה | ערך |
|---|---|
| `BOOTSTRAP_ORG_NAME` | `לינדר פיננסים` |
| `BOOTSTRAP_ADMIN_EMAIL` | המייל שלך |
| `BOOTSTRAP_ADMIN_NAME` | השם שלך |
| `BOOTSTRAP_ADMIN_PASSWORD` | סיסמה: 10 תווים ומעלה, אותיות ומספרים |

אחרי שהפריסה הראשונה מצליחה ואפשר להתחבר, מוחקים את `BOOTSTRAP_ADMIN_PASSWORD`.

לא חובה: `TRACKING_BASE_URL` (דומיין קצר לקישורי מעקב), `GOOGLE_SERVICE_ACCOUNT_JSON` (סנכרון Google Sheets).

### 3. דומיין ופריסה
- בשירות ה-Web: **Settings → Networking → Generate Domain**. מעדכנים את `APP_URL` לכתובת שנוצרה.
- כל פריסה מריצה אוטומטית `prisma migrate deploy` (מיגרציות) ואת יצירת המשתמש הראשון (רק אם עוד אין עסק).
- בדיקת תקינות: `GET /api/health`. השדה `worker` צריך להיות `ok` כשה-Worker רץ.

### 4. חיבור WhatsApp
1. מתחברים למערכת, נכנסים ל**חשבונות WhatsApp**, לוחצים **חיבור חשבון** ומזינים את WhatsApp Business Account ID, Access Token קבוע של System User ו-App Secret.
2. לוחצים **בדיקת תקינות**. המספרים נטענים אוטומטית.
3. ב-Meta for Developers, תחת **WhatsApp → Configuration**, מזינים את ה-Callback URL ואת ה-Verify Token שמוצגים בכרטיס החשבון, ומסמנים את השדות: `messages`, `message_template_status_update`, `phone_number_quality_update`, `account_update`.
4. לוחצים **רישום ל-Webhooks** ואז **סנכרון תבניות**.
5. משלימים **הגדרות ← תאימות ← אישור והשלמה** (פעם אחת).

### גיבוי ושחזור
- Railway PostgreSQL: מומלץ להפעיל **Backups** בשירות בסיס הנתונים.
- גיבוי ידני: `pg_dump "$DATABASE_URL" -Fc -f backup.dump`
- שחזור: `pg_restore -d "$DATABASE_URL" --clean --no-owner backup.dump`
- `ENCRYPTION_KEY` ו-`HASH_PEPPER` חייבים להישמר יחד עם הגיבוי. בלעדיהם אסימונים מוצפנים ורשימת ההסרה לא יהיו שמישים.

---

## פיתוח מקומי

```bash
pnpm install
cp .env.example .env          # ומילוי ערכים
pnpm db:migrate               # מיגרציות
pnpm db:seed                  # עסק + משתמש ראשון (לפי משתני BOOTSTRAP_*)
pnpm dev                      # http://localhost:3000
pnpm worker                   # בטרמינל נוסף — מנוע השליחה
```

בדיקות: `pnpm test` (דורש `TEST_DATABASE_URL` לבסיס נתונים שמסתיים ב-`_test`).

בדיקה מקצה לקצה ללא חשבון אמיתי: `node scripts/fake-meta.mjs` מדמה את Graph API ושולח Webhooks חתומים. מפעילים את השרת וה-Worker עם `META_GRAPH_BASE_URL=http://localhost:4010` (מתעלמים ממנו ב-production).

---

## API ל-n8n

מפתחות API נוצרים ב**אוטומציות ← מפתחות API** עם הרשאות לפי צורך. בסיס: `/api/v1`, כותרת `Authorization: Bearer wcm_…`.
עיקרי: `POST /contacts`, `POST /contacts/import` (עם `consentSource`), `GET /consent?phone=`, `GET /campaigns`, `GET /messages`, `POST /leads`, `POST /conversions`, `GET /suppressions?since=`.
Webhooks יוצאים חתומים (`X-WCM-Signature`) מוגדרים ב**אוטומציות ← Webhooks יוצאים**.
