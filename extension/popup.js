const screens = {
  auth: document.getElementById('screen-auth'),
  checkEmail: document.getElementById('screen-check-email'),
  home: document.getElementById('screen-home'),
  addProto: document.getElementById('screen-add-proto'),
  detail: document.getElementById('screen-proto-detail'),
  settings: document.getElementById('screen-settings'),
};

let currentPrototype = null;

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove('active'));
  screens[name].classList.add('active');
}

function bg(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, error: 'No response' });
    });
  });
}

function parseHashTokens() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const access = params.get('access_token');
  const refresh = params.get('refresh_token');
  if (!access) return null;
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: parseInt(params.get('expires_in') || '3600', 10),
  };
}

async function checkExtensionConfig() {
  const configErrEl = document.getElementById('auth-config-error');
  configErrEl.hidden = true;

  const configRes = await bg({ type: 'GET_CONFIG' });
  if (!configRes.ok || !configRes.data?.configured) {
    showConfigError(
      'Copy extension/config.example.js to extension/config.js and add your Supabase credentials, then reload the extension.'
    );
    document.getElementById('auth-send-btn').disabled = true;
    return false;
  }
  document.getElementById('auth-send-btn').disabled = false;
  return true;
}

async function tryRestoreSession() {
  const tokens = parseHashTokens();
  if (tokens) {
    await bg({
      type: 'SET_SESSION_TOKENS',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    });
    history.replaceState(null, '', 'popup.html');
  }

  const params = new URLSearchParams(window.location.search);
  const invite = params.get('invite');
  if (invite) {
    const res = await bg({ type: 'ACCEPT_INVITE', token: invite });
    if (res.ok) {
      await bg({ type: 'SET_ACTIVE_PROTOTYPE', prototype: res.data });
      history.replaceState(null, '', 'popup.html');
      showToast('Invite accepted');
    }
  }

  const sessionRes = await bg({ type: 'GET_SESSION' });
  if (sessionRes.ok && sessionRes.data?.session) {
    await renderHome(sessionRes.data.session);
    return true;
  }
  showScreen('auth');
  await checkExtensionConfig();
  return false;
}

function showToast(msg) {
  const sub = document.getElementById('header-subtitle');
  const prev = sub.textContent;
  sub.textContent = msg;
  setTimeout(() => { sub.textContent = prev; }, 2500);
}

function showAuthError(msg) {
  const errEl = document.getElementById('auth-error');
  errEl.textContent = msg;
  errEl.hidden = false;
  console.error('[Pinpoint]', msg);
}

function showConfigError(msg) {
  const errEl = document.getElementById('auth-config-error');
  errEl.textContent = msg;
  errEl.hidden = false;
}

function setAuthLoading(loading) {
  const btn = document.getElementById('auth-send-btn');
  btn.disabled = loading;
  btn.textContent = loading ? 'Sending…' : 'Send magic link';
  btn.classList.toggle('pnpt-btn-loading', loading);
}

async function renderHome(session) {
  const email = session.user?.email || 'there';
  document.getElementById('home-greeting').textContent = `Signed in as ${email}`;
  showScreen('home');

  const listEl = document.getElementById('proto-list');
  listEl.innerHTML = '<li class="pnpt-msg">Loading…</li>';

  const res = await bg({ type: 'LIST_PROTOTYPES' });
  if (!res.ok) {
    listEl.innerHTML = `<li class="pnpt-error">${res.error}</li>`;
    return;
  }

  const protos = res.data || [];
  if (!protos.length) {
    listEl.innerHTML = '<li class="pnpt-msg">No prototypes yet. Add one to get started.</li>';
    return;
  }

  listEl.innerHTML = '';
  protos.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'pnpt-proto-item';
    li.innerHTML = `<strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.url_pattern)}</span>`;
    li.addEventListener('click', () => openPrototypeDetail(p));
    listEl.appendChild(li);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

async function openPrototypeDetail(proto) {
  currentPrototype = proto;
  await bg({ type: 'SET_ACTIVE_PROTOTYPE', prototype: proto });
  document.getElementById('detail-name').textContent = proto.name;
  document.getElementById('detail-url').textContent = proto.url_pattern;
  document.getElementById('invite-link-box').hidden = true;
  showScreen('detail');
}

document.getElementById('auth-send-btn').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value.trim();
  document.getElementById('auth-error').hidden = true;
  if (!email) {
    showAuthError('Enter your email');
    return;
  }

  setAuthLoading(true);
  try {
    const configRes = await bg({ type: 'GET_CONFIG' });
    if (!configRes.ok) {
      showAuthError(configRes.error || 'Extension is not configured');
      showToast(configRes.error || 'Extension is not configured');
      return;
    }
    if (!configRes.data?.configured) {
      const msg =
        'Copy extension/config.example.js to extension/config.js and add your Supabase credentials.';
      showAuthError(msg);
      showToast('Missing config.js');
      return;
    }

    const res = await bg({ type: 'SIGN_IN_OTP', email });
    if (!res.ok) {
      showAuthError(res.error || 'Magic link failed');
      showToast(res.error || 'Magic link failed');
      return;
    }
    showScreen('checkEmail');
    showToast('Check your email');
  } catch (err) {
    const msg = err?.message || 'Something went wrong';
    showAuthError(msg);
    showToast(msg);
    console.error('[Pinpoint] magic link', err);
  } finally {
    setAuthLoading(false);
  }
});

document.getElementById('auth-back-btn').addEventListener('click', async () => {
  showScreen('auth');
  await checkExtensionConfig();
});

document.getElementById('sign-out-btn').addEventListener('click', async () => {
  await bg({ type: 'SIGN_OUT' });
  showScreen('auth');
});

document.getElementById('add-proto-btn').addEventListener('click', () => {
  document.getElementById('proto-name').value = '';
  document.getElementById('proto-url').value = '';
  document.getElementById('add-error').hidden = true;
  showScreen('addProto');
});

document.getElementById('add-back-btn').addEventListener('click', () => showScreen('home'));

document.getElementById('create-proto-btn').addEventListener('click', async () => {
  const name = document.getElementById('proto-name').value.trim();
  const url = document.getElementById('proto-url').value.trim();
  const errEl = document.getElementById('add-error');
  errEl.hidden = true;
  if (!url) {
    errEl.textContent = 'Paste a prototype URL';
    errEl.hidden = false;
    return;
  }
  const res = await bg({ type: 'CREATE_PROTOTYPE', name, url });
  if (!res.ok) {
    errEl.textContent = res.error;
    errEl.hidden = false;
    return;
  }
  await openPrototypeDetail(res.data);
});

document.getElementById('detail-back-btn').addEventListener('click', async () => {
  const sessionRes = await bg({ type: 'GET_SESSION' });
  if (sessionRes.ok) await renderHome(sessionRes.data.session);
});

document.getElementById('open-proto-btn').addEventListener('click', () => {
  if (currentPrototype?.url_pattern) {
    chrome.tabs.create({ url: currentPrototype.url_pattern });
  }
});

document.getElementById('invite-btn').addEventListener('click', async () => {
  const email = document.getElementById('invite-email').value.trim();
  if (!email || !currentPrototype) return;
  const res = await bg({
    type: 'INVITE_COLLABORATOR',
    prototypeId: currentPrototype.id,
    email,
    role: 'collaborator',
  });
  if (!res.ok) {
    showToast(res.error);
    return;
  }
  const configRes = await bg({ type: 'GET_CONFIG' });
  const dashboard = configRes.data?.dashboardUrl || '';
  const link = `${dashboard}/invite/${res.data.invite_token}`;
  const box = document.getElementById('invite-link-box');
  box.textContent = link;
  box.hidden = false;
  try {
    await navigator.clipboard.writeText(link);
    showToast('Invite link copied');
  } catch {
    showToast('Invite link ready');
  }
});

document.getElementById('detail-settings-btn').addEventListener('click', () => {
  if (!currentPrototype) return;
  document.getElementById('toggle-team-feedback').checked = currentPrototype.show_team_feedback !== false;
  document.getElementById('toggle-upvotes').checked = currentPrototype.allow_upvotes !== false;
  showScreen('settings');
});

document.getElementById('settings-back-btn').addEventListener('click', () => showScreen('detail'));

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  if (!currentPrototype) return;
  const body = {
    show_team_feedback: document.getElementById('toggle-team-feedback').checked,
    allow_upvotes: document.getElementById('toggle-upvotes').checked,
  };
  const res = await bg({
    type: 'REST',
    method: 'PATCH',
    path: `prototypes?id=eq.${currentPrototype.id}`,
    body,
    prefer: 'return=representation',
  });
  if (res.ok) {
    currentPrototype = Array.isArray(res.data) ? res.data[0] : { ...currentPrototype, ...body };
    await bg({ type: 'SET_ACTIVE_PROTOTYPE', prototype: currentPrototype });
    showToast('Settings saved');
    showScreen('detail');
  } else {
    showToast(res.error || 'Save failed');
  }
});

// Poll for session after magic link (user may complete auth in browser tab)
setInterval(async () => {
  if (!screens.checkEmail.classList.contains('active')) return;
  const res = await bg({ type: 'GET_SESSION' });
  if (res.ok && res.data?.session) {
    await renderHome(res.data.session);
  }
}, 2000);

tryRestoreSession();
