# Pinpoint — Build Spec for Claude Code

> **Purpose of this document**: Hand this entire file to Claude Code as the starting context. It contains everything needed to build the full Pinpoint system from scratch — no clarifying questions required. Work through the checkpoints in order. Do not skip ahead.

---

## What is Pinpoint?

Pinpoint is a visual feedback tool for web prototypes. It consists of:

1. **A Chrome extension** — reviewers install it once and can then click any element on any prototype to leave a pinned comment with a screenshot. No code changes needed to the prototype.
2. **A React dashboard** — a shared web app where a central owner sees all feedback across all prototypes, triages items, sets priority, and exports structured task manifests.
3. **Supabase backend** — Postgres database + file storage. The extension and dashboard talk directly to Supabase. No custom backend server required.

The end-to-end flow:
- Reviewer opens any prototype URL in Chrome → activates Pinpoint extension → clicks an element → types name + comment + category → submits
- Submission writes a record to Supabase with: element selector, screenshot, page URL, prototype ID, user name, comment, category, timestamp
- Dashboard owner opens the Pinpoint dashboard → sees all feedback live (real-time) → triages → exports selected items as a Claude Code task manifest JSON

---

## Prerequisites (human must complete before starting)

Before running any build steps, confirm these are ready:

- [ ] GitHub repo created (monorepo, empty). Note the repo URL.
- [ ] Supabase project created at supabase.com. Note: `SUPABASE_URL` and `SUPABASE_ANON_KEY` from Project Settings → API.
- [ ] Vercel project created and linked to the GitHub repo.
- [ ] Node.js 18+ installed locally.

---

## Repo Structure

Scaffold this exact structure at the start. Do not deviate.

```
pinpoint/
├── extension/                  # Chrome extension
│   ├── manifest.json
│   ├── content.js              # injected into every page
│   ├── background.js           # service worker
│   ├── popup.html              # extension toolbar popup (settings)
│   ├── popup.js
│   ├── overlay.css             # styles injected into host pages
│   └── icons/
│       ├── icon16.png
│       ├── icon32.png
│       ├── icon48.png
│       └── icon128.png         # use simple coloured square placeholders
│
├── dashboard/                  # React app (Vite)
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── vercel.json
│   ├── .env.example
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── supabaseClient.js
│       ├── components/
│       │   ├── FeedbackFeed.jsx
│       │   ├── FeedbackCard.jsx
│       │   ├── FilterBar.jsx
│       │   ├── TriagePanel.jsx
│       │   └── ExportButton.jsx
│       └── styles/
│           └── global.css
│
├── supabase/
│   └── schema.sql              # full schema — run once in Supabase SQL editor
│
├── .gitignore
└── README.md
```

---

## Checkpoint 1 — Supabase Schema

**File: `supabase/schema.sql`**

Write and run this SQL in the Supabase SQL editor before building anything else. Verify the tables exist before proceeding.

```sql
-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Main feedback table
create table feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),

  -- Capture context (immutable after insert)
  prototype_id text not null,
  page_url text not null,
  element_selector text not null,
  element_text text,
  screenshot_url text,
  annotation_data jsonb,

  -- Reviewer identity
  user_name text not null,
  comment text not null,
  category text not null check (category in ('bug', 'idea', 'question', 'unclear')),

  -- Triage fields (mutable)
  priority text check (priority in ('p1', 'p2', 'p3', null)),
  status text not null default 'open' check (status in ('open', 'doing', 'done')),
  tags text[] default '{}',
  assignee text
);

-- Index for common dashboard queries
create index feedback_prototype_idx on feedback(prototype_id);
create index feedback_status_idx on feedback(status);
create index feedback_created_idx on feedback(created_at desc);

-- Storage bucket for screenshots
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict do nothing;

-- Allow anonymous inserts (extension users are not authenticated)
create policy "allow anon insert" on feedback
  for insert to anon with check (true);

-- Allow anonymous reads (dashboard reads without login for now)
create policy "allow anon select" on feedback
  for select to anon using (true);

-- Allow anonymous updates (triage from dashboard)
create policy "allow anon update" on feedback
  for update to anon using (true);

-- Storage policy: allow anon upload and read
create policy "allow anon upload" on storage.objects
  for insert to anon with check (bucket_id = 'screenshots');

create policy "allow anon read" on storage.objects
  for select to anon using (bucket_id = 'screenshots');

-- Enable RLS
alter table feedback enable row level security;
```

**Checkpoint 1 verification**: Open Supabase Table Editor. Confirm `feedback` table exists with all columns. Confirm `screenshots` bucket exists in Storage.

---

## Checkpoint 2 — Chrome Extension

Build the extension files in `extension/`. The extension must work as an unpacked extension loaded via `chrome://extensions` with Developer Mode on.

### `extension/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Pinpoint",
  "version": "1.0.0",
  "description": "Click any element on any prototype to leave visual feedback",
  "permissions": [
    "activeTab",
    "storage",
    "tabs"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["overlay.css"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### `extension/background.js`

Handles screenshot capture using `chrome.tabs.captureVisibleTab` (higher quality than html2canvas). Listens for messages from content.js.

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_SCREENSHOT') {
    chrome.tabs.captureVisibleTab(
      sender.tab.windowId,
      { format: 'png', quality: 90 },
      (dataUrl) => {
        sendResponse({ dataUrl });
      }
    );
    return true; // keep message channel open for async response
  }
});
```

### `extension/content.js`

This is the core file. It must:

1. **Inject a floating toggle button** into every page — a small circular button fixed to the bottom-right corner, labelled "Pinpoint". When clicked, toggles feedback mode on/off.

2. **In feedback mode**:
   - Change cursor to crosshair
   - Highlight hovered elements with a visible outline (2px solid `#6366f1`)
   - On element click, prevent default behaviour, capture the element details, request a screenshot from background.js, then show the comment popover

3. **Generate a stable CSS selector** for the clicked element using this priority order:
   - `id` attribute → `#id-value`
   - `data-testid` attribute → `[data-testid="value"]`
   - `data-cy` attribute → `[data-cy="value"]`
   - Meaningful class combination (non-generic classes only — skip classes like `active`, `open`, `visible`, `d-flex`, `col-md-6` etc.) + tag
   - Fall back to: tag + position among siblings only if nothing semantic is available
   - Never generate a selector longer than 5 levels deep

4. **Show a comment popover** near the clicked element (but always fully within the viewport). The popover contains:
   - Name field (pre-filled from `chrome.storage.local` if previously saved)
   - Comment textarea
   - Category select: Bug / Idea / Question / Unclear
   - Submit button
   - Cancel button
   - Small thumbnail of the screenshot

5. **On submit**:
   - Upload screenshot PNG to Supabase Storage bucket `screenshots` with filename `{timestamp}-{randomId}.png`
   - Insert a record into the `feedback` table
   - Show a brief success toast "Feedback saved"
   - Close the popover
   - Save the user's name to `chrome.storage.local`

6. **Show existing pins**: On page load (and after each submission), fetch all feedback records for the current `prototype_id` and `page_url` from Supabase. Render small numbered pin markers at the element positions. Clicking a pin shows a read-only tooltip with the comment, user, and category.

**Prototype ID detection**: Read `document.querySelector('meta[name="prototype-id"]')?.content`. If not found, use `window.location.hostname + window.location.pathname` cleaned to a slug (replace non-alphanumeric with `-`).

**Supabase credentials in the extension**: Read from `chrome.storage.local` keys `SUPABASE_URL` and `SUPABASE_ANON_KEY`. These are set via the popup. Do not hardcode credentials.

**Supabase calls from content.js**: Use `fetch()` directly against the Supabase REST API — do not import the Supabase JS SDK (it won't work in content scripts without a bundler). Use these patterns:

```javascript
// INSERT
fetch(`${supabaseUrl}/rest/v1/feedback`, {
  method: 'POST',
  headers: {
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${supabaseAnonKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  },
  body: JSON.stringify(record)
});

// SELECT
fetch(`${supabaseUrl}/rest/v1/feedback?prototype_id=eq.${protoId}&page_url=eq.${encodeURIComponent(pageUrl)}&select=*`, {
  headers: {
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${supabaseAnonKey}`
  }
});

// Storage upload
fetch(`${supabaseUrl}/storage/v1/object/screenshots/${filename}`, {
  method: 'POST',
  headers: {
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${supabaseAnonKey}`,
    'Content-Type': 'image/png'
  },
  body: pngBlob
});
```

### `extension/overlay.css`

Styles for the injected UI elements. All class names must be prefixed with `pnpt-` to avoid collisions with host page styles.

```css
.pnpt-toggle-btn {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483647;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #6366f1;
  color: #fff;
  border: none;
  cursor: pointer;
  font-size: 11px;
  font-family: system-ui, sans-serif;
  font-weight: 600;
  letter-spacing: 0.02em;
  box-shadow: 0 4px 12px rgba(99,102,241,0.4);
  transition: transform 0.15s, background 0.15s;
}

.pnpt-toggle-btn:hover { transform: scale(1.08); }
.pnpt-toggle-btn.active { background: #4f46e5; }

.pnpt-hover-highlight {
  outline: 2px solid #6366f1 !important;
  outline-offset: 2px !important;
}

.pnpt-popover {
  position: fixed;
  z-index: 2147483646;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px;
  width: 300px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: #111;
}

.pnpt-popover input,
.pnpt-popover textarea,
.pnpt-popover select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
  font-family: inherit;
  margin-top: 4px;
  margin-bottom: 10px;
  outline: none;
}

.pnpt-popover input:focus,
.pnpt-popover textarea:focus,
.pnpt-popover select:focus {
  border-color: #6366f1;
}

.pnpt-popover textarea { resize: vertical; min-height: 72px; }

.pnpt-btn-row {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.pnpt-submit-btn {
  flex: 1;
  background: #6366f1;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.pnpt-cancel-btn {
  background: #f3f4f6;
  color: #374151;
  border: none;
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
}

.pnpt-screenshot-thumb {
  width: 100%;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  margin-bottom: 12px;
  max-height: 120px;
  object-fit: cover;
}

.pnpt-pin {
  position: absolute;
  z-index: 2147483645;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #6366f1;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  font-family: system-ui, sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(99,102,241,0.4);
  transform: translate(-50%, -50%);
}

.pnpt-pin-tooltip {
  position: fixed;
  z-index: 2147483646;
  background: #1f2937;
  color: #f9fafb;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  font-family: system-ui, sans-serif;
  max-width: 240px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  pointer-events: none;
}

.pnpt-toast {
  position: fixed;
  bottom: 80px;
  right: 24px;
  z-index: 2147483647;
  background: #10b981;
  color: #fff;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-family: system-ui, sans-serif;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(16,185,129,0.3);
  animation: pnpt-fadein 0.2s ease;
}

@keyframes pnpt-fadein {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

### `extension/popup.html` and `extension/popup.js`

A simple settings popup (180×220px) with two inputs:
- Supabase URL
- Supabase Anon Key

And a Save button that writes both values to `chrome.storage.local`. Show a green checkmark confirmation after saving. Pre-fill inputs with existing stored values on load.

**Checkpoint 2 verification**: Load the extension unpacked. Open any webpage. Confirm the Pinpoint toggle button appears. Open the popup and save your Supabase credentials. Click the toggle button to activate feedback mode — the cursor should change and elements should highlight on hover. Click an element — the popover should appear with a screenshot thumbnail. Submit — confirm a record appears in the Supabase `feedback` table and the screenshot appears in the `screenshots` storage bucket.

---

## Checkpoint 3 — Dashboard

Build the React dashboard in `dashboard/`. Use Vite as the build tool. Use the Supabase JS SDK (`@supabase/supabase-js`).

### `dashboard/package.json`

```json
{
  "name": "pinpoint-dashboard",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "vite": "^5.0.0"
  }
}
```

### `dashboard/.env.example`

```
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

The actual `.env` file must be created by the user — never commit it. Add `.env` to `.gitignore`.

### `dashboard/vercel.json`

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### `dashboard/src/supabaseClient.js`

```javascript
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

### Dashboard design

The dashboard must be clean, minimal, and information-dense. Dark background (`#0f1117`), light text. Use `DM Mono` for code/selector values, `DM Sans` for UI text. Both available from Google Fonts.

Colour accents:
- Indigo `#6366f1` — primary actions, active states
- Emerald `#10b981` — done status
- Amber `#f59e0b` — P1 priority
- Rose `#f43f5e` — bugs
- Sky `#38bdf8` — ideas
- Violet `#a78bfa` — questions
- Gray `#6b7280` — unclear

### `dashboard/src/App.jsx`

Top-level layout with two columns on desktop (filter sidebar left, feed right) and single column on mobile. Loads feedback on mount and subscribes to real-time inserts via Supabase Realtime.

```jsx
// Structure (implement fully):
// - Header: "Pinpoint" wordmark + total count badge + Export button
// - FilterBar: dropdowns for prototype_id, category, status, priority + search input
// - FeedbackFeed: scrollable list of FeedbackCard components
// - Real-time: subscribe to INSERT on feedback table, prepend new items to feed
```

### `dashboard/src/components/FilterBar.jsx`

Renders filter controls. Derives unique `prototype_id` values from the loaded feedback for the prototype dropdown. All filters are applied client-side (no re-fetching). Filters:

- Prototype (select — all unique values + "All")
- Category (select — All / Bug / Idea / Question / Unclear)
- Status (select — All / Open / Doing / Done)
- Priority (select — All / P1 / P2 / P3 / Unset)
- Search (text — matches against comment and element_text)

### `dashboard/src/components/FeedbackCard.jsx`

Each card displays:

- **Top row**: Pin number (auto-incremented, displayed as `#042`), prototype_id as a pill badge, category badge (coloured), created_at formatted as "2 hours ago" or "May 28"
- **User + comment**: `userName` in medium weight, comment text below
- **Element context**: `element_text` and `element_selector` in monospace, truncated with expand on click
- **Screenshot**: Thumbnail image (click to open full size in new tab)
- **Triage row**: Priority select (`—` / P1 / P2 / P3), Status select (Open / Doing / Done), Tags input (comma-separated, save on blur)

Triage field changes must immediately PATCH the record in Supabase using:

```javascript
supabase.from('feedback').update({ priority }).eq('id', item.id)
```

Visual treatment per category:
- Bug → left border `#f43f5e`
- Idea → left border `#38bdf8`
- Question → left border `#a78bfa`
- Unclear → left border `#6b7280`

### `dashboard/src/components/ExportButton.jsx`

A button "Export for Claude Code" that:

1. Filters to items where `status !== 'done'` and `priority` is not null (i.e. triaged items only)
2. Sorts by priority (P1 first)
3. Generates a JSON file in this exact shape:

```json
{
  "generated_at": "2025-05-29T10:00:00Z",
  "prototype": "all",
  "task_count": 5,
  "tasks": [
    {
      "id": "fb-{short-uuid}",
      "priority": "p1",
      "category": "bug",
      "user_name": "Sid",
      "comment": "Button overlaps the field label on mobile",
      "element_selector": "#step-2 > button.continue",
      "element_text": "Continue",
      "page_url": "/onboarding/step/2",
      "prototype_id": "catalyst-onboarding-v3",
      "screenshot_url": "https://...",
      "created_at": "2025-05-28T14:22:00Z"
    }
  ]
}
```

4. Triggers a browser file download of `pinpoint-tasks-{date}.json`

Also render a count badge on the button showing how many exportable items exist: "Export for Claude Code (7)".

**Checkpoint 3 verification**: Run `npm run dev` in `dashboard/`. Confirm the dashboard loads, shows feedback submitted in Checkpoint 2, filtering works, triage fields update in Supabase, and Export downloads a valid JSON file.

---

## Checkpoint 4 — Polish and Deploy

### README.md

Write a clear README covering:
1. What Pinpoint is (2 sentences)
2. Setup — Prerequisites
3. Supabase setup (run schema.sql, copy credentials)
4. Extension setup (load unpacked, enter credentials in popup)
5. Dashboard setup (clone repo, create .env, `npm install`, `npm run dev`)
6. Deploy dashboard to Vercel (`vercel --prod` or via GitHub integration)
7. Adding prototype-id to a prototype (`<meta name="prototype-id" content="my-prototype-v1">`)
8. Using the Claude Code export

### `.gitignore`

```
node_modules/
.env
.env.local
dashboard/dist/
.DS_Store
```

### Icons

Generate simple placeholder PNG icons at 16×16, 32×32, 48×48, 128×128. Each is a rounded indigo (`#6366f1`) square with a white circle in the centre. Use a canvas-based Node script or create them programmatically — do not leave them missing as the extension will fail to load.

### Final deployment

1. Confirm `dashboard/.env` exists with real Supabase credentials (user must provide)
2. Run `npm run build` in `dashboard/` — confirm no errors
3. Push all code to GitHub
4. Confirm Vercel auto-deploys from the GitHub push
5. Confirm the live Vercel URL loads the dashboard and connects to Supabase

**Checkpoint 4 verification**: The live dashboard URL works. The extension on a local machine can submit feedback that appears in the live dashboard in real time.

---

## Using the Claude Code Export

Once you have a `pinpoint-tasks-{date}.json` file, use it with Claude Code like this:

```bash
claude "Read pinpoint-tasks-2025-05-29.json and work through each task in priority order. For each task: locate the component identified by element_selector in the codebase, read the user comment, make the appropriate code change, and commit with message 'fix(pinpoint): {fb-id} — {short description}'. Work through all tasks before stopping."
```

Each task record gives Claude Code:
- The exact element selector to locate the component
- The user's verbatim comment
- A screenshot URL for visual context
- The page and prototype for broader context
- Priority for ordering

---

## Key Decisions and Constraints

- **No custom backend server** — extension and dashboard talk directly to Supabase REST API
- **No auth for now** — anon key used throughout; add Supabase Auth in a future iteration if needed
- **No bundler for extension** — content.js must be plain ES5/ES6 compatible JavaScript, no imports. All Supabase calls use raw `fetch()`.
- **Supabase credentials in extension** stored in `chrome.storage.local`, set via popup — never hardcoded
- **Stable selectors are critical** — the selector generation logic in content.js directly determines Claude Code's ability to locate components. Do not use positional or generic selectors.
- **Screenshot via `chrome.tabs.captureVisibleTab`** — called from background.js in response to a message from content.js
- **Real-time in dashboard** — use Supabase Realtime `channel().on('postgres_changes', ...)` subscription for live feed updates
- **Monorepo, no shared packages** — extension and dashboard are completely independent; do not attempt to share code between them

---

## What Success Looks Like

A reviewer with the extension installed opens any URL, clicks the Pinpoint button, clicks a button on the prototype, writes "This CTA is too small on mobile — Sid", selects "Bug", and hits Submit. Ten seconds later the dashboard owner sees a new card appear in real time with the screenshot, the CSS selector, Sid's comment, and controls to set it as P1. They export. They hand the JSON to Claude Code. Claude Code opens the repo, finds the component, fixes it, commits.

That is the complete loop. Build toward it.
