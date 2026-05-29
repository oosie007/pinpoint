const urlInput = document.getElementById('supabase-url');
const keyInput = document.getElementById('supabase-key');
const saveBtn = document.getElementById('save-btn');
const savedMsg = document.getElementById('saved-msg');

chrome.storage.local.get(['SUPABASE_URL', 'SUPABASE_ANON_KEY'], (data) => {
  if (data.SUPABASE_URL) urlInput.value = data.SUPABASE_URL;
  if (data.SUPABASE_ANON_KEY) keyInput.value = data.SUPABASE_ANON_KEY;
});

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    SUPABASE_URL: urlInput.value.trim(),
    SUPABASE_ANON_KEY: keyInput.value.trim(),
  }, () => {
    savedMsg.classList.add('visible');
    setTimeout(() => savedMsg.classList.remove('visible'), 2000);
  });
});
