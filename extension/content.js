(function () {
  'use strict';

  const GENERIC_CLASSES = new Set([
    'active', 'open', 'visible', 'hidden', 'show', 'hide', 'disabled', 'enabled',
    'selected', 'focus', 'hover', 'current', 'first', 'last', 'even', 'odd',
    'd-flex', 'd-block', 'd-inline', 'd-none', 'd-grid', 'flex', 'grid', 'row', 'col',
    'container', 'wrapper', 'content', 'main', 'header', 'footer', 'nav',
    'w-full', 'h-full', 'w-100', 'h-100', 'text-center', 'text-left', 'text-right',
    'mx-auto', 'my-auto', 'p-0', 'm-0', 'btn', 'form-control', 'input',
  ]);

  const GENERIC_PREFIXES = ['col-', 'col-md-', 'col-lg-', 'col-sm-', 'col-xs-', 'p-', 'm-', 'px-', 'py-', 'mx-', 'my-', 'pt-', 'pb-', 'mt-', 'mb-', 'gap-', 'text-', 'bg-', 'border-', 'rounded-', 'fs-', 'fw-', 'lh-', 'align-', 'justify-', 'order-', 'offset-', 'g-', 'w-', 'h-', 'min-', 'max-', 'top-', 'bottom-', 'start-', 'end-', 'z-', 'opacity-', 'shadow-', 'd-sm-', 'd-md-', 'd-lg-', 'd-xl-'];

  let feedbackMode = false;
  let hoveredEl = null;
  let supabaseUrl = '';
  let supabaseAnonKey = '';
  let pins = [];
  let pinContainer = null;
  let toggleBtn = null;
  let popover = null;
  let tooltip = null;

  function getPrototypeId() {
    const meta = document.querySelector('meta[name="prototype-id"]');
    if (meta && meta.content) return meta.content.trim();
    const slug = (window.location.hostname + window.location.pathname)
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    return slug || 'unknown';
  }

  function isGenericClass(cls) {
    if (!cls || cls.length < 2) return true;
    if (GENERIC_CLASSES.has(cls)) return true;
    for (const prefix of GENERIC_PREFIXES) {
      if (cls.startsWith(prefix)) return true;
    }
    if (/^\d+$/.test(cls)) return true;
    if (/^[a-f0-9]{6,}$/i.test(cls)) return true;
    return false;
  }

  function segmentForElement(el) {
    if (!el || el === document.documentElement) return null;

    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
      return `#${CSS.escape(el.id)}`;
    }

    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;

    const cy = el.getAttribute('data-cy');
    if (cy) return `[data-cy="${cy.replace(/"/g, '\\"')}"]`;

    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList || []).filter((c) => !isGenericClass(c));
    if (classes.length > 0) {
      return tag + '.' + classes.slice(0, 3).map((c) => CSS.escape(c)).join('.');
    }

    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(el) + 1;
        return `${tag}:nth-of-type(${index})`;
      }
    }

    return tag;
  }

  function generateSelector(el) {
    const segments = [];
    let current = el;
    while (current && current !== document.documentElement && segments.length < 5) {
      const seg = segmentForElement(current);
      if (seg) segments.unshift(seg);
      current = current.parentElement;
    }
    return segments.join(' > ') || el.tagName.toLowerCase();
  }

  function getElementText(el) {
    const text = (el.innerText || el.textContent || '').trim();
    return text.slice(0, 200) || null;
  }

  function loadCredentials(callback) {
    chrome.storage.local.get(['SUPABASE_URL', 'SUPABASE_ANON_KEY'], (data) => {
      supabaseUrl = (data.SUPABASE_URL || '').replace(/\/$/, '');
      supabaseAnonKey = data.SUPABASE_ANON_KEY || '';
      callback();
    });
  }

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const bstr = atob(parts[1]);
    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
    return new Blob([u8arr], { type: mime });
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function showToast(message) {
    const existing = document.querySelector('.pnpt-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'pnpt-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  function ensurePinContainer() {
    if (!pinContainer) {
      pinContainer = document.createElement('div');
      pinContainer.id = 'pnpt-pin-container';
      pinContainer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483644;';
      document.body.appendChild(pinContainer);
    }
    return pinContainer;
  }

  function clearPins() {
    pins.forEach((p) => p.remove());
    pins = [];
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  }

  function positionPin(pin, el) {
    const rect = el.getBoundingClientRect();
    pin.style.position = 'absolute';
    pin.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
    pin.style.top = `${rect.top + window.scrollY + rect.height / 2}px`;
    pin.style.pointerEvents = 'auto';
  }

  function showPinTooltip(item, x, y) {
    if (tooltip) tooltip.remove();
    tooltip = document.createElement('div');
    tooltip.className = 'pnpt-pin-tooltip';
    const cat = item.category.charAt(0).toUpperCase() + item.category.slice(1);
    tooltip.innerHTML = `<strong>${escapeHtml(item.user_name)}</strong> · ${cat}<br>${escapeHtml(item.comment)}`;
    document.body.appendChild(tooltip);
    const tr = tooltip.getBoundingClientRect();
    let left = x + 12;
    let top = y - tr.height / 2;
    if (left + tr.width > window.innerWidth - 8) left = x - tr.width - 12;
    if (top < 8) top = 8;
    if (top + tr.height > window.innerHeight - 8) top = window.innerHeight - tr.height - 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function renderPins(items) {
    clearPins();
    ensurePinContainer();
    items.forEach((item, index) => {
      let el = null;
      try {
        el = document.querySelector(item.element_selector);
      } catch (e) {
        return;
      }
      if (!el) return;

      const pin = document.createElement('div');
      pin.className = 'pnpt-pin';
      pin.textContent = String(index + 1);
      pin.title = item.comment;
      document.body.appendChild(pin);
      positionPin(pin, el);

      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        showPinTooltip(item, e.clientX, e.clientY);
      });

      pin.addEventListener('mouseenter', (e) => {
        showPinTooltip(item, e.clientX, e.clientY);
      });

      pin.addEventListener('mouseleave', () => {
        if (tooltip) {
          tooltip.remove();
          tooltip = null;
        }
      });

      pins.push(pin);
    });
  }

  async function fetchPins() {
    if (!supabaseUrl || !supabaseAnonKey) return;
    const protoId = getPrototypeId();
    const pageUrl = window.location.href;
    const url = `${supabaseUrl}/rest/v1/feedback?prototype_id=eq.${encodeURIComponent(protoId)}&page_url=eq.${encodeURIComponent(pageUrl)}&select=*&order=created_at.asc`;
    try {
      const res = await fetch(url, {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
      });
      if (!res.ok) return;
      const items = await res.json();
      renderPins(items);
    } catch (e) {
      console.warn('[Pinpoint] Failed to load pins', e);
    }
  }

  function setFeedbackMode(on) {
    feedbackMode = on;
    document.body.style.cursor = on ? 'crosshair' : '';
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', on);
      toggleBtn.textContent = on ? 'ON' : 'Pinpoint';
    }
    if (!on && hoveredEl) {
      hoveredEl.classList.remove('pnpt-hover-highlight');
      hoveredEl = null;
    }
    closePopover();
  }

  function closePopover() {
    if (popover) {
      popover.remove();
      popover = null;
    }
  }

  function positionPopover(x, y) {
    const rect = popover.getBoundingClientRect();
    let left = x;
    let top = y + 12;
    if (left + rect.width > window.innerWidth - 16) {
      left = window.innerWidth - rect.width - 16;
    }
    if (left < 16) left = 16;
    if (top + rect.height > window.innerHeight - 16) {
      top = y - rect.height - 12;
    }
    if (top < 16) top = 16;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function captureScreenshot() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, (response) => {
        resolve(response && response.dataUrl ? response.dataUrl : null);
      });
    });
  }

  async function uploadScreenshot(dataUrl) {
    const blob = dataUrlToBlob(dataUrl);
    const filename = `${Date.now()}-${randomId()}.png`;
    const res = await fetch(`${supabaseUrl}/storage/v1/object/screenshots/${filename}`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'image/png',
      },
      body: blob,
    });
    if (!res.ok) throw new Error('Screenshot upload failed');
    return `${supabaseUrl}/storage/v1/object/public/screenshots/${filename}`;
  }

  async function submitFeedback(record) {
    const res = await fetch(`${supabaseUrl}/rest/v1/feedback`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error('Feedback insert failed');
  }

  async function showPopover(el, clickX, clickY) {
    closePopover();
    const screenshotDataUrl = await captureScreenshot();
    if (!screenshotDataUrl) {
      showToast('Could not capture screenshot');
      return;
    }

    const selector = generateSelector(el);
    const elementText = getElementText(el);
    const protoId = getPrototypeId();
    const pageUrl = window.location.href;

    popover = document.createElement('div');
    popover.className = 'pnpt-popover';

    const thumb = document.createElement('img');
    thumb.className = 'pnpt-screenshot-thumb';
    thumb.src = screenshotDataUrl;
    thumb.alt = 'Screenshot';
    popover.appendChild(thumb);

    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Your name';
    popover.appendChild(nameLabel);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Your name';
    popover.appendChild(nameInput);

    const commentLabel = document.createElement('label');
    commentLabel.textContent = 'Comment';
    popover.appendChild(commentLabel);

    const commentArea = document.createElement('textarea');
    commentArea.placeholder = 'Describe the issue or idea...';
    popover.appendChild(commentArea);

    const catLabel = document.createElement('label');
    catLabel.textContent = 'Category';
    popover.appendChild(catLabel);

    const catSelect = document.createElement('select');
    [
      ['bug', 'Bug'],
      ['idea', 'Idea'],
      ['question', 'Question'],
      ['unclear', 'Unclear'],
    ].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      catSelect.appendChild(opt);
    });
    popover.appendChild(catSelect);

    const btnRow = document.createElement('div');
    btnRow.className = 'pnpt-btn-row';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'pnpt-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      closePopover();
      setFeedbackMode(false);
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'pnpt-submit-btn';
    submitBtn.textContent = 'Submit';

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    popover.appendChild(btnRow);

    document.body.appendChild(popover);
    positionPopover(clickX, clickY);

    chrome.storage.local.get(['PINPOINT_USER_NAME'], (data) => {
      if (data.PINPOINT_USER_NAME) nameInput.value = data.PINPOINT_USER_NAME;
    });

    submitBtn.addEventListener('click', async () => {
      const userName = nameInput.value.trim();
      const comment = commentArea.value.trim();
      const category = catSelect.value;

      if (!userName || !comment) {
        showToast('Name and comment are required');
        return;
      }

      if (!supabaseUrl || !supabaseAnonKey) {
        showToast('Set Supabase credentials in extension popup');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      try {
        const screenshotUrl = await uploadScreenshot(screenshotDataUrl);
        await submitFeedback({
          prototype_id: protoId,
          page_url: pageUrl,
          element_selector: selector,
          element_text: elementText,
          screenshot_url: screenshotUrl,
          user_name: userName,
          comment,
          category,
        });

        chrome.storage.local.set({ PINPOINT_USER_NAME: userName });
        closePopover();
        setFeedbackMode(false);
        showToast('Feedback saved');
        await fetchPins();
      } catch (e) {
        console.error('[Pinpoint]', e);
        showToast('Failed to save feedback');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      }
    });

    popover.addEventListener('click', (e) => e.stopPropagation());
  }

  function onMouseOver(e) {
    if (!feedbackMode) return;
    const target = e.target;
    if (
      target.closest('.pnpt-toggle-btn') ||
      target.closest('.pnpt-popover') ||
      target.closest('.pnpt-pin') ||
      target.closest('.pnpt-toast')
    ) {
      return;
    }
    if (hoveredEl && hoveredEl !== target) {
      hoveredEl.classList.remove('pnpt-hover-highlight');
    }
    hoveredEl = target;
    hoveredEl.classList.add('pnpt-hover-highlight');
  }

  function onMouseOut(e) {
    if (!feedbackMode || !hoveredEl) return;
    if (e.target === hoveredEl) {
      hoveredEl.classList.remove('pnpt-hover-highlight');
      hoveredEl = null;
    }
  }

  function onClick(e) {
    if (!feedbackMode) return;
    const target = e.target;
    if (
      target.closest('.pnpt-toggle-btn') ||
      target.closest('.pnpt-popover') ||
      target.closest('.pnpt-pin')
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (hoveredEl) hoveredEl.classList.remove('pnpt-hover-highlight');
    showPopover(target, e.clientX, e.clientY);
  }

  function createToggleButton() {
    toggleBtn = document.createElement('button');
    toggleBtn.className = 'pnpt-toggle-btn';
    toggleBtn.textContent = 'Pinpoint';
    toggleBtn.type = 'button';
    toggleBtn.title = 'Toggle Pinpoint feedback mode';
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setFeedbackMode(!feedbackMode);
    });
    document.body.appendChild(toggleBtn);
  }

  function init() {
    if (window.__pinpointInitialized) return;
    window.__pinpointInitialized = true;

    createToggleButton();
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);

    window.addEventListener('scroll', () => {
      loadCredentials(() => fetchPins());
    }, { passive: true });

    loadCredentials(() => fetchPins());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
