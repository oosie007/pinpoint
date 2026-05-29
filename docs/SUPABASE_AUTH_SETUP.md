# Supabase Auth setup (Pinpoint)

Configure auth in the [Supabase Dashboard](https://supabase.com/dashboard) → **Authentication** → **URL Configuration**.

## Site URL (critical)

Pinpoint’s **primary UI is the browser extension** (magic link should open `chrome-extension://…/popup.html`). The dashboard is optional (export/triage).

Set **Site URL** to your production dashboard (fallback when redirect URLs fail):

```text
https://pinpoint-nu-jade.vercel.app
```

**Do not** leave this as `http://localhost:3000` (or any localhost URL) unless you are actively developing auth locally.

Supabase uses **Site URL** as the fallback when:

- A client omits `email_redirect_to` / `emailRedirectTo`, or
- The requested redirect URL is not on the allowlist, or
- An auth error occurs (e.g. expired OTP) and Supabase redirects with `#error=...` in the hash.

If Site URL is `http://localhost:3000`, magic links and error pages open localhost even when the user signed in from the extension or production dashboard.

For local dashboard dev only, you can temporarily set Site URL to `http://localhost:5173` (Vite default). Switch it back to production when done.

## Redirect URLs (allowlist)

Add every URL that should receive the user after they click a magic link:

| Client | Redirect URL |
|--------|----------------|
| Production dashboard | `https://pinpoint-nu-jade.vercel.app/auth/callback` |
| Local dashboard (Vite) | `http://localhost:5173/auth/callback` |
| Browser extension | `chrome-extension://<YOUR_EXTENSION_ID>/popup.html` |

**Extension ID:** open `chrome://extensions`, enable Developer mode, copy the ID under the unpacked Pinpoint extension. Or log it from the service worker console: `chrome.runtime.getURL('popup.html')`.

Without the `chrome-extension://…/popup.html` entry, extension magic links fail or fall back to Site URL.

## Providers

Under **Authentication** → **Providers**, enable **Email** (magic link / OTP).

## How each client sends redirects

- **Dashboard** (`AuthScreen.jsx`): `signInWithOtp` with `emailRedirectTo` set to `VITE_APP_URL/auth/callback`, or `https://pinpoint-nu-jade.vercel.app/auth/callback` in production builds, or `window.location.origin/auth/callback` in local dev.
- **Extension** (`background.js`): `POST /auth/v1/otp` with `options.email_redirect_to` set to `chrome.runtime.getURL('popup.html')` (a `chrome-extension://…/popup.html` URL).

If the extension sends OTP **without** `email_redirect_to`, or the URL is not allowlisted, Supabase uses **Site URL** → the localhost bug.

## `otp_expired` / `#error=access_denied`

If a magic link opens with a hash like:

```text
#error=access_denied&error_code=otp_expired
```

the link was already used, expired (default ~1 hour), or invalidated after you changed Site URL / Redirect URLs.

**Fix config first** (Site URL + Redirect URLs above), then request a **new** magic link from the extension popup or dashboard. Old links will keep failing.

## Extension config

Copy `extension/config.example.js` → `extension/config.js` with the same Supabase values as `dashboard/.env` (`VITE_SUPABASE_*`). Reload the unpacked extension after changes. Without `config.js`, **Send magic link** shows an error in the popup.

## Dashboard env

Optional in `dashboard/.env` / Vercel environment variables:

```env
VITE_APP_URL=https://pinpoint-nu-jade.vercel.app
```

If unset, production builds default to `https://pinpoint-nu-jade.vercel.app`; local dev uses the current origin (typically `http://localhost:5173`).
