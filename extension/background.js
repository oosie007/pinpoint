importScripts('config.js');

const STORAGE_SESSION = 'PINPOINT_SESSION';
const STORAGE_ACTIVE_PROTOTYPE = 'PINPOINT_ACTIVE_PROTOTYPE';

function getConfig() {
  return {
    url: (PINPOINT_CONFIG.SUPABASE_URL || '').replace(/\/$/, ''),
    anonKey: PINPOINT_CONFIG.SUPABASE_ANON_KEY || '',
    dashboardUrl: PINPOINT_CONFIG.DASHBOARD_URL || 'https://pinpoint-nu-jade.vercel.app',
  };
}

function authHeaders(anonKey, accessToken) {
  const token = accessToken || anonKey;
  return {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

async function storageSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, resolve);
  });
}

async function getSession() {
  const data = await storageGet([STORAGE_SESSION]);
  const session = data[STORAGE_SESSION];
  if (!session || !session.access_token) return null;
  const expiresAt = session.expires_at || 0;
  if (expiresAt && Date.now() / 1000 > expiresAt - 60) {
    const refreshed = await refreshSession(session.refresh_token);
    return refreshed;
  }
  return session;
}

async function refreshSession(refreshToken) {
  const { url, anonKey } = getConfig();
  if (!url || !refreshToken) return null;
  const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: authHeaders(anonKey),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    await storageSet({ [STORAGE_SESSION]: null });
    return null;
  }
  const body = await res.json();
  const session = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (body.expires_in || 3600),
    user: body.user,
  };
  await storageSet({ [STORAGE_SESSION]: session });
  return session;
}

async function saveSessionFromAuthResponse(body) {
  const session = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (body.expires_in || 3600),
    user: body.user,
  };
  await storageSet({ [STORAGE_SESSION]: session });
  return session;
}

async function signInWithOtp(email) {
  const { url, anonKey, dashboardUrl } = getConfig();
  const extensionRedirect = chrome.runtime.getURL('popup.html');
  const res = await fetch(`${url}/auth/v1/otp`, {
    method: 'POST',
    headers: authHeaders(anonKey),
    body: JSON.stringify({
      email,
      create_user: true,
      data: {},
      options: {
        email_redirect_to: extensionRedirect,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.msg || err.error_description || 'Magic link failed');
  }
  return { ok: true };
}

async function signOut() {
  const session = await getSession();
  const { url, anonKey } = getConfig();
  if (session?.access_token) {
    await fetch(`${url}/auth/v1/logout`, {
      method: 'POST',
      headers: authHeaders(anonKey, session.access_token),
    }).catch(() => {});
  }
  await storageSet({ [STORAGE_SESSION]: null, [STORAGE_ACTIVE_PROTOTYPE]: null });
  return { ok: true };
}

async function setSessionFromTokens(accessToken, refreshToken, expiresIn, user) {
  const session = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + (expiresIn || 3600),
    user: user || null,
  };
  await storageSet({ [STORAGE_SESSION]: session });
  if (!user && accessToken) {
    const { url, anonKey } = getConfig();
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: authHeaders(anonKey, accessToken),
    });
    if (res.ok) {
      session.user = await res.json();
      await storageSet({ [STORAGE_SESSION]: session });
    }
  }
  return session;
}

async function supabaseRest(path, options = {}) {
  const { url, anonKey } = getConfig();
  const session = await getSession();
  const headers = {
    ...authHeaders(anonKey, session?.access_token),
    ...(options.headers || {}),
  };
  if (options.prefer) headers.Prefer = options.prefer;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data;
}

async function storageUpload(filename, base64Data) {
  const { url, anonKey } = getConfig();
  const session = await getSession();
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const res = await fetch(`${url}/storage/v1/object/screenshots/${filename}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${session?.access_token || anonKey}`,
      'Content-Type': 'image/png',
    },
    body: bytes,
  });
  if (!res.ok) throw new Error('Screenshot upload failed');
  return `${url}/storage/v1/object/public/screenshots/${filename}`;
}

function urlMatchesPattern(pageUrl, pattern) {
  try {
    const page = new URL(pageUrl);
    const base = new URL(pattern.includes('://') ? pattern : `https://${pattern}`);
    if (page.origin !== base.origin) return false;
    const basePath = base.pathname.replace(/\/$/, '') || '/';
    const pagePath = page.pathname.replace(/\/$/, '') || '/';
    return pagePath === basePath || pagePath.startsWith(`${basePath}/`);
  } catch {
    return false;
  }
}

function slugFromUrl(inputUrl) {
  try {
    const u = new URL(inputUrl.includes('://') ? inputUrl : `https://${inputUrl}`);
    return (u.hostname + u.pathname)
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  } catch {
    return `prototype-${Date.now()}`;
  }
}

async function listPrototypes() {
  const session = await getSession();
  if (!session) return [];
  return supabaseRest(
    'prototypes?select=*&order=created_at.desc',
    { method: 'GET' }
  );
}

async function createPrototype({ name, url }) {
  const session = await getSession();
  if (!session?.user?.id) throw new Error('Not signed in');
  const urlPattern = url.includes('://') ? url : `https://${url}`;
  const slug = slugFromUrl(urlPattern);
  const rows = await supabaseRest('prototypes?select=*', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      owner_id: session.user.id,
      name: name || slug,
      url_pattern: urlPattern,
      prototype_slug: slug,
    },
  });
  const prototype = Array.isArray(rows) ? rows[0] : rows;
  await supabaseRest('prototype_members', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      prototype_id: prototype.id,
      user_id: session.user.id,
      email: session.user.email,
      role: 'owner',
      accepted_at: new Date().toISOString(),
    },
  });
  return prototype;
}

async function findPrototypeForPage(pageUrl) {
  const active = (await storageGet([STORAGE_ACTIVE_PROTOTYPE]))[STORAGE_ACTIVE_PROTOTYPE];
  if (active?.url_pattern && urlMatchesPattern(pageUrl, active.url_pattern)) {
    return active;
  }
  const list = await listPrototypes();
  return list.find((p) => urlMatchesPattern(pageUrl, p.url_pattern)) || null;
}

async function acceptInviteToken(token) {
  const session = await getSession();
  if (!session?.user) throw new Error('Sign in to accept invite');
  const members = await supabaseRest(
    `prototype_members?invite_token=eq.${encodeURIComponent(token)}&select=*,prototypes(*)`,
    { method: 'GET' }
  );
  const member = members?.[0];
  if (!member) throw new Error('Invite not found');
  await supabaseRest(`prototype_members?id=eq.${member.id}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      user_id: session.user.id,
      accepted_at: new Date().toISOString(),
    },
  });
  return member.prototypes || null;
}

async function inviteCollaborator(prototypeId, email, role = 'collaborator') {
  const rows = await supabaseRest('prototype_members?select=*', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      prototype_id: prototypeId,
      email: email.toLowerCase().trim(),
      role,
    },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = async () => {
    switch (message.type) {
      case 'GET_CONFIG':
        return getConfig();
      case 'GET_SESSION':
        return { session: await getSession(), config: getConfig() };
      case 'SIGN_IN_OTP':
        return signInWithOtp(message.email);
      case 'SIGN_OUT':
        return signOut();
      case 'SET_SESSION_TOKENS':
        return setSessionFromTokens(
          message.access_token,
          message.refresh_token,
          message.expires_in,
          message.user
        );
      case 'REST':
        return supabaseRest(message.path, {
          method: message.method,
          body: message.body,
          prefer: message.prefer,
          headers: message.headers,
        });
      case 'STORAGE_UPLOAD':
        return storageUpload(message.filename, message.base64);
      case 'LIST_PROTOTYPES':
        return listPrototypes();
      case 'CREATE_PROTOTYPE':
        return createPrototype(message);
      case 'SET_ACTIVE_PROTOTYPE':
        await storageSet({ [STORAGE_ACTIVE_PROTOTYPE]: message.prototype });
        return { ok: true };
      case 'GET_ACTIVE_PROTOTYPE':
        return (await storageGet([STORAGE_ACTIVE_PROTOTYPE]))[STORAGE_ACTIVE_PROTOTYPE];
      case 'FIND_PROTOTYPE_FOR_PAGE':
        return findPrototypeForPage(message.pageUrl);
      case 'ACCEPT_INVITE':
        return acceptInviteToken(message.token);
      case 'INVITE_COLLABORATOR':
        return inviteCollaborator(message.prototypeId, message.email, message.role);
      case 'CAPTURE_SCREENSHOT':
        return new Promise((resolve) => {
          chrome.tabs.captureVisibleTab(
            _sender.tab.windowId,
            { format: 'png', quality: 90 },
            (dataUrl) => resolve({ dataUrl })
          );
        });
      default:
        throw new Error('Unknown message type');
    }
  };

  handle()
    .then((result) => sendResponse({ ok: true, data: result }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
