# Pinpoint

Pinpoint is a visual feedback tool for web prototypes. Reviewers use a Chrome extension to click any element and leave pinned comments with screenshots; owners triage everything in a shared React dashboard and export structured task manifests for Claude Code.

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- Chrome (for the extension)
- Optional: [Vercel](https://vercel.com) account for dashboard hosting

## Supabase setup

1. Open your Supabase project → **SQL Editor**.
2. Run the full contents of [`supabase/schema.sql`](supabase/schema.sql).
3. Confirm in **Table Editor** that the `feedback` table exists.
4. Confirm in **Storage** that the `screenshots` bucket exists (public).
5. Copy from **Project Settings → API**:
   - **Project URL** → `VITE_SUPABASE_URL` / extension popup “Supabase URL”
   - **anon public** key → `VITE_SUPABASE_ANON_KEY` / extension popup “Supabase Anon Key”

## Extension setup

1. Open Chrome → `chrome://extensions` → enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder.
3. Click the Pinpoint toolbar icon → enter your Supabase URL and anon key → **Save**.
4. Open any prototype URL → click the **Pinpoint** floating button → click an element → submit feedback.

## Dashboard setup (local)

```bash
cd dashboard
cp .env.example .env
# Edit .env with your Supabase URL and anon key
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Deploy dashboard to Vercel

1. Connect this repo to Vercel (root directory: `dashboard` or set **Root Directory** to `dashboard` in project settings).
2. Add environment variables in Vercel → **Settings → Environment Variables**:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
3. Deploy (`vercel --prod` or push to the linked branch).

`vercel.json` includes SPA rewrites so client routing works.

## Prototype ID

Add to each prototype’s HTML `<head>` for stable grouping:

```html
<meta name="prototype-id" content="my-prototype-v1">
```

If omitted, Pinpoint derives an ID from hostname + pathname.

## Claude Code export

1. In the dashboard, set **Priority** (P1–P3) on items you want exported; leave **Status** not `Done`.
2. Click **Export for Claude Code (N)** to download `pinpoint-tasks-YYYY-MM-DD.json`.
3. Run in your app repo:

```bash
claude "Read pinpoint-tasks-2025-05-29.json and work through each task in priority order. For each task: locate the component identified by element_selector in the codebase, read the user comment, make the appropriate code change, and commit with message 'fix(pinpoint): {fb-id} — {short description}'. Work through all tasks before stopping."
```

## Repo structure

```
pinpoint/
├── extension/     # Chrome MV3 extension (plain JS, fetch → Supabase)
├── dashboard/     # Vite + React dashboard
├── supabase/      # schema.sql
└── README.md
```

## Security note

This MVP uses the Supabase **anon** key with RLS policies allowing anonymous read/write. Add Supabase Auth before production use with sensitive data.
