# Running BookFormatter Pro Locally

## Prerequisites

**Node.js v20 or newer**
Check your version with `node --version`. Download from [nodejs.org](https://nodejs.org) if needed.

**npm**
Comes bundled with Node.js.

---

## Setup Steps

### 1. Install dependencies

```bash
npm install
```

### 2. Create a `.env` file

Create a `.env` file in the project root:

```env
# Required for AI proofreading
OPENAI_API_KEY=sk-...

# Required for database admin operations and Stripe webhook plan updates
SUPABASE_SERVICE_KEY=...

# Required for payments (can be omitted if you don't need Stripe locally)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_SINGLE=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Optional — defaults to 5000
PORT=5000
```

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:5000](http://localhost:5000). Both the API and frontend are served from the same port.

---

## Commands

| Purpose | Command |
|---|---|
| Install packages | `npm install` |
| Run in development | `npm run dev` |
| Build for production | `npm run build` |
| Run production build | `npm start` |

---

## External Services

### Supabase (database + auth) — Required

The app connects to an existing Supabase project. The public URL and anon key are already hardcoded in the source, so you can connect to the same Supabase project as the live app without any code changes.

**If you want your own isolated Supabase database instead:**
1. Create a new project at [supabase.com](https://supabase.com)
2. Update the URL and anon key in `client/src/lib/supabase/client.ts`
3. Update the URL and fallback key in `server/supabase.ts`

**Either way, run these SQL migrations once in the Supabase SQL Editor:**

```sql
CREATE TABLE IF NOT EXISTS projects (id uuid primary key default gen_random_uuid());
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS processing_progress INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
```

**Disable email confirmation** so sign-up works immediately:
Supabase Dashboard → Authentication → Email → uncheck **"Enable email confirmations"**

---

### OpenAI — Required for AI proofreading

Get an API key from [platform.openai.com](https://platform.openai.com). The app uses `gpt-4o` and `gpt-4o-mini`. Set it as `OPENAI_API_KEY` in your `.env` file.

Without this key, upload and export still work — only the "Start Proofreading" step will fail.

---

### Stripe — Optional

The app starts fine without Stripe keys. The pricing/checkout buttons simply won't work. To test payments locally:

1. Create a Stripe account and grab test keys from [dashboard.stripe.com/test/apikeys](https://dashboard.stripe.com/test/apikeys)
2. Create two prices in the Stripe Dashboard:
   - A one-time price of $7 → `STRIPE_PRICE_SINGLE`
   - A recurring price of $19/mo → `STRIPE_PRICE_PRO`
3. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and forward webhooks locally:

```bash
stripe listen --forward-to localhost:5000/api/stripe/webhook
```

This command prints a `whsec_...` value to use as `STRIPE_WEBHOOK_SECRET`.

---

## Notes

- The Vite config includes Replit-specific dev plugins that only activate when the `REPL_ID` environment variable is set. They are skipped automatically on your local machine — no changes needed.
- The server runs on port `5000` by default. Change it with the `PORT` environment variable.

---

## Quick Checklist

- [ ] Node.js 20+
- [ ] `npm install`
- [ ] `.env` file with `OPENAI_API_KEY` and `SUPABASE_SERVICE_KEY`
- [ ] Supabase project accessible (shared or your own)
- [ ] SQL migrations run in Supabase SQL Editor
- [ ] Email confirmation disabled in Supabase Auth settings
- [ ] (Optional) Stripe keys + Stripe CLI for payment testing
- [ ] `npm run dev` → open [http://localhost:5000](http://localhost:5000)
