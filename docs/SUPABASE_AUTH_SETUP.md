# Supabase Auth setup (Pinpoint)

Enable in the [Supabase Dashboard](https://supabase.com/dashboard) → **Authentication** → **Providers**:

1. **Email** — enable Email provider (magic link / OTP).
2. **Site URL** — set to your dashboard URL (e.g. `https://pinpoint-nu-jade.vercel.app`).
3. **Redirect URLs** — add:
   - `https://pinpoint-nu-jade.vercel.app/auth/callback`
   - `http://localhost:5173/auth/callback` (local Vite dev)
   - `chrome-extension://<YOUR_EXTENSION_ID>/popup.html` (optional; primary flow uses dashboard callback)

Magic links redirect to `/auth/callback` where the dashboard (or user session) is established. The extension popup polls for a session after sign-in, or users can complete auth in the browser tab.

## Extension config

Copy `extension/config.example.js` → `extension/config.js` with the same values as `dashboard/.env` (`VITE_SUPABASE_*`). Reload the unpacked extension after changes.
