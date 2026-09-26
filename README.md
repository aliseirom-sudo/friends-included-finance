# Friends Included Finance

A fictional finance workflow for Wedding Guests for Hire. Supabase is the source of truth; Google Sheets is a read-only copy. Website and Telegram submissions use the same validation and commission rules.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill it with the values below. Never commit `.env.local` or put secrets in `NEXT_PUBLIC_*` variables.
3. Start the site with `npm run dev`.

Required server-side variables:

- `NEXT_PUBLIC_SUPABASE_URL`: the Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role key; server only.
- `GOOGLE_SPREADSHEET_ID`: the ID of the Friends Included project data spreadsheet.
- `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`: the service-account JSON key encoded as base64; server only.
- `TELEGRAM_BOT_TOKEN`: the BotFather token; server only.
- `TELEGRAM_WEBHOOK_SECRET`: a random secret used to verify Telegram webhook requests.
- `DEMO_SESSION_SECRET`: a separate random value used to sign demonstration-role cookies.
- `APP_URL`: the public deployment URL, required to register the bot webhook.

Do not use a Supabase service-role key or either bot/Google credential in browser code, public environment variables, screenshots, chat, or GitHub.

## Database

The SQL migrations in `supabase/migrations` define the fictional employee roster, transactions, security restrictions, and stable row numbers for idempotent sheet updates. Apply each migration to the `friends-included-finance` Supabase project, in filename order. Do not add sample transactions; Tests 1 and 2 are to be entered through the actual website and bot.

## Google Sheets

Share the project data spreadsheet with the service account as Editor. The backend writes to fixed, per-record row numbers so a retry updates the existing record rather than appending another copy. Each synchronization state and error is retained on the Supabase record.

## Telegram

Start a private chat with the bot. Use `/id` to show the user ID and chat ID for Svetlana to link. Salespeople can submit with `/sale S01 | Customer | A | Description | 1000 | 50,30,20`. Kevin can submit with `/expense E01 | Description | Materials | 120 | A`. The webhook must be registered to `${"${APP_URL}"}/api/telegram/webhook` with `TELEGRAM_WEBHOOK_SECRET` as Telegram's secret token.

## Validation

`npm test` checks commission rounding, rejected input, and project/company calculations. `npm run lint` and `npm run build` validate the application.
