# Supabase Auth setup (Pinpoint)

Enable in the [Supabase Dashboard](https://supabase.com/dashboard) → **Authentication** → **Providers**:

1. **Email** — enable Email provider (magic link / OTP).
2. **Site URL** — set to your dashboard URL (e.g. `https://pinpoint-nu-jade.vercel.app`).
3. **Redirect URLs** — add all URLs your clients use after the user clicks the magic link:
   - `https://pinpoint-nu-jade.vercel.app/auth/callback` (dashboard production)
   - `http://localhost:5173/auth/callback` (local Vite dev)
   - `chrome-extension://<YOUR_EXTENSION_ID>/popup.html` (**required for the browser extension**)

   Find the extension redirect URL after loading the unpacked extension: open `chrome://extensions`, copy the extension ID, then add  
   `chrome-extension://<EXTENSION_ID>/popup.html`  
   to **Redirect URLs**. You can also log it from the service worker: `chrome.runtime.getURL('popup.html')`.

The dashboard sends magic links with `emailRedirectTo` set to `/auth/callback`. The extension sends OTP via `POST /auth/v1/otp` with `options.email_redirect_to` set to `chrome-extension://…/popup.html`. If that URL is not allowlisted, Supabase returns an error and the popup shows it.

After the user clicks the extension magic link, the popup opens with tokens in the URL hash; the extension stores the session and shows the home screen. The “check email” screen also polls every 2s if the user completes auth elsewhere.

## Extension config

Copy `extension/config.example.js` → `extension/config.js` with the same values as `dashboard/.env` (`VITE_SUPABASE_*`). Reload the unpacked extension after changes. Without `config.js`, **Send magic link** shows an error in the popup (the UI still loads).
