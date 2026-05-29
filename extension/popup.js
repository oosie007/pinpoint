const urlInput = document.getElementById('supabase-url');
const keyInput = document.getElementById('supabase-key');
const dashboardInput = document.getElementById('dashboard-url');
const modeSelect = document.getElementById('pinpoint-mode');
const saveBtn = document.getElementById('save-btn');
const savedMsg = document.getElementById('saved-msg');

const DEFAULT_DASHBOARD_URL = 'https://pinpoint-nu-jade.vercel.app';

chrome.storage.local.get(
  ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DASHBOARD_URL', 'PINPOINT_MODE'],
  (data) => {
    if (data.SUPABASE_URL) urlInput.value = data.SUPABASE_URL;
    if (data.SUPABASE_ANON_KEY) keyInput.value = data.SUPABASE_ANON_KEY;
    dashboardInput.value = data.DASHBOARD_URL || DEFAULT_DASHBOARD_URL;
    modeSelect.value = data.PINPOINT_MODE === 'owner' ? 'owner' : 'reviewer';
  }
);

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set(
    {
      SUPABASE_URL: urlInput.value.trim(),
      SUPABASE_ANON_KEY: keyInput.value.trim(),
      DASHBOARD_URL: dashboardInput.value.trim() || DEFAULT_DASHBOARD_URL,
      PINPOINT_MODE: modeSelect.value,
    },
    () => {
      savedMsg.classList.add('visible');
      setTimeout(() => savedMsg.classList.remove('visible'), 2000);
    }
  );
});
