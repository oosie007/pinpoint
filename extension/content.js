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

  const CATEGORY_COLORS = {
    bug: '#ef4444',
    idea: '#38bdf8',
    question: '#a78bfa',
    unclear: '#9ca3af',
  };

  const ANNOTATE_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];
  const DEFAULT_DASHBOARD_URL = 'https://pinpoint-nu-jade.vercel.app';

  let feedbackMode = false;
  let ownerMode = false;
  let hoveredEl = null;
  let highlightedTargetEl = null;
  let supabaseUrl = '';
  let supabaseAnonKey = '';
  let dashboardUrl = DEFAULT_DASHBOARD_URL;
  let pins = [];
  let pinRecords = [];
  let pinContainer = null;
  let toggleBtn = null;
  let dashboardBtn = null;
  let allFeedbackPanel = null;
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

  function getPageUrl() {
    return window.location.href;
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
    chrome.storage.local.get(
      ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'PINPOINT_MODE', 'DASHBOARD_URL'],
      (data) => {
        supabaseUrl = (data.SUPABASE_URL || '').replace(/\/$/, '');
        supabaseAnonKey = data.SUPABASE_ANON_KEY || '';
        ownerMode = data.PINPOINT_MODE === 'owner';
        dashboardUrl = (data.DASHBOARD_URL || '').trim() || DEFAULT_DASHBOARD_URL;
        if (dashboardBtn) dashboardBtn.href = dashboardUrl;
        callback();
      }
    );
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

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatPageLabel(url) {
    try {
      const u = new URL(url);
      return u.pathname + (u.search || '');
    } catch (e) {
      return url;
    }
  }

  function resolveElement(selector) {
    try {
      return document.querySelector(selector);
    } catch (e) {
      return null;
    }
  }

  function clearTargetHighlight() {
    if (highlightedTargetEl) {
      highlightedTargetEl.classList.remove('pnpt-hover-highlight', 'pnpt-pin-target-highlight');
      highlightedTargetEl = null;
    }
  }

  function highlightTargetElement(el, category) {
    clearTargetHighlight();
    if (!el) return;
    highlightedTargetEl = el;
    el.classList.add('pnpt-hover-highlight', 'pnpt-pin-target-highlight');
    el.style.setProperty('--pnpt-pin-color', CATEGORY_COLORS[category] || CATEGORY_COLORS.unclear);
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
    pins.forEach((p) => p.el.remove());
    pins = [];
    pinRecords = [];
    clearTargetHighlight();
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
    if (allFeedbackPanel) {
      allFeedbackPanel.remove();
      allFeedbackPanel = null;
    }
  }

  function positionPin(pinEl, el) {
    const rect = el.getBoundingClientRect();
    pinEl.style.position = 'absolute';
    pinEl.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
    pinEl.style.top = `${rect.top + window.scrollY + rect.height / 2}px`;
    pinEl.style.pointerEvents = 'auto';
  }

  function repositionAllPins() {
    pins.forEach(({ el, target }) => {
      if (target && document.contains(target)) {
        positionPin(el, target);
      }
    });
  }

  function showPinTooltip(item, x, y) {
    if (tooltip) tooltip.remove();
    tooltip = document.createElement('div');
    tooltip.className = `pnpt-pin-tooltip category-${item.category}`;
    const cat = item.category.charAt(0).toUpperCase() + item.category.slice(1);
    const pageLine = item.page_url
      ? `<div class="pnpt-tooltip-page">${escapeHtml(formatPageLabel(item.page_url))}</div>`
      : '';
    tooltip.innerHTML = `${pageLine}<strong>${escapeHtml(item.user_name)}</strong> · ${cat}<br>${escapeHtml(item.comment)}`;
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

  function attachPinListeners(pinEl, item, targetEl) {
    const show = (e) => {
      highlightTargetElement(targetEl, item.category);
      showPinTooltip(item, e.clientX, e.clientY);
    };
    const hide = () => {
      clearTargetHighlight();
      if (tooltip) {
        tooltip.remove();
        tooltip = null;
      }
    };

    pinEl.addEventListener('click', (e) => {
      e.stopPropagation();
      show(e);
    });
    pinEl.addEventListener('mouseenter', show);
    pinEl.addEventListener('mouseleave', hide);
  }

  function createPinElement(item, index) {
    const pin = document.createElement('div');
    pin.className = `pnpt-pin category-${item.category}`;
    pin.innerHTML = `<span class="pnpt-pin-ring"></span><span class="pnpt-pin-badge">${index}</span>`;
    pin.title = item.comment;
    pin.dataset.feedbackId = item.id || '';
    return pin;
  }

  function scrollToAndHighlight(item) {
    const el = resolveElement(item.element_selector);
    if (!el) {
      showToast('Element not found on this page');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightTargetElement(el, item.category);
    const rect = el.getBoundingClientRect();
    showPinTooltip(item, rect.left + rect.width / 2, rect.top);
    setTimeout(clearTargetHighlight, 3000);
  }

  function renderAllFeedbackPanel(items, onPageIds) {
    if (!ownerMode || items.length === 0) return;

    if (allFeedbackPanel) allFeedbackPanel.remove();
    allFeedbackPanel = document.createElement('div');
    allFeedbackPanel.className = 'pnpt-all-feedback-panel';

    const header = document.createElement('div');
    header.className = 'pnpt-all-feedback-header';
    header.textContent = `All feedback (${items.length})`;
    allFeedbackPanel.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'pnpt-all-feedback-list';

    items.forEach((item, i) => {
      const onPage = onPageIds.has(item.id);
      const li = document.createElement('li');
      li.className = `pnpt-all-feedback-item category-${item.category}${onPage ? ' on-page' : ' off-page'}`;

      const num = document.createElement('span');
      num.className = 'pnpt-all-feedback-num';
      num.textContent = String(i + 1);

      const body = document.createElement('div');
      body.className = 'pnpt-all-feedback-body';
      body.innerHTML = `<strong>${escapeHtml(item.user_name)}</strong> · ${escapeHtml(item.category)}<br>${escapeHtml(item.comment.slice(0, 80))}${item.comment.length > 80 ? '…' : ''}`;

      const pageLink = document.createElement('a');
      pageLink.className = 'pnpt-all-feedback-page';
      pageLink.href = item.page_url;
      pageLink.target = '_blank';
      pageLink.rel = 'noopener noreferrer';
      pageLink.textContent = formatPageLabel(item.page_url);
      pageLink.addEventListener('click', (e) => e.stopPropagation());

      li.appendChild(num);
      li.appendChild(body);
      li.appendChild(pageLink);

      li.addEventListener('click', () => {
        if (onPage) {
          scrollToAndHighlight(item);
        } else {
          window.open(item.page_url, '_blank', 'noopener');
        }
      });

      list.appendChild(li);
    });

    allFeedbackPanel.appendChild(list);
    document.body.appendChild(allFeedbackPanel);
  }

  function renderPins(items) {
    clearPins();
    ensurePinContainer();

    const onPage = [];
    const onPageIds = new Set();

    items.forEach((item) => {
      const el = resolveElement(item.element_selector);
      if (el) {
        onPage.push({ item, el });
        if (item.id) onPageIds.add(item.id);
      }
    });

    onPage.forEach(({ item, el }, index) => {
      const pin = createPinElement(item, index + 1);
      document.body.appendChild(pin);
      positionPin(pin, el);
      attachPinListeners(pin, item, el);
      pins.push({ el: pin, target: el, item });
    });

    if (ownerMode) {
      renderAllFeedbackPanel(items, onPageIds);
    }
  }

  async function fetchPins() {
    if (!supabaseUrl || !supabaseAnonKey) return;
    const protoId = getPrototypeId();
    const pageUrl = getPageUrl();
    let url = `${supabaseUrl}/rest/v1/feedback?prototype_id=eq.${encodeURIComponent(protoId)}&select=*&order=created_at.asc`;
    if (!ownerMode) {
      url += `&page_url=eq.${encodeURIComponent(pageUrl)}`;
    }

    try {
      const res = await fetch(url, {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
      });
      if (!res.ok) return;
      const items = await res.json();
      pinRecords = items;
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

  function getCaptureContext(el) {
    const rect = el.getBoundingClientRect();
    return {
      elementRect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };
  }

  function drawStrokesOnContext(ctx, width, height, strokes, elementRect, viewport) {
    if (elementRect && viewport) {
      const scaleX = width / viewport.width;
      const scaleY = height / viewport.height;
      ctx.save();
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
      ctx.lineWidth = 2 * Math.max(scaleX, scaleY);
      ctx.setLineDash([6 * scaleX, 4 * scaleX]);
      ctx.strokeRect(
        elementRect.left * scaleX,
        elementRect.top * scaleY,
        elementRect.width * scaleX,
        elementRect.height * scaleY
      );
      ctx.restore();
    }

    strokes.forEach((stroke) => {
      if (!stroke.points || stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const lineWidth = (stroke.width || 3) * width;
      ctx.lineWidth = lineWidth;
      if (stroke.tool === 'highlighter') {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = lineWidth * 3;
      } else {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke.color;
      }
      stroke.points.forEach((pt, i) => {
        const x = pt[0] * width;
        const y = pt[1] * height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  function redrawAnnotationCanvas(canvas, ctx, img, strokes, elementRect, viewport) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    drawStrokesOnContext(ctx, w, h, strokes, elementRect, viewport);
  }

  function compositeScreenshot(baseDataUrl, annotationData) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const strokes = (annotationData && annotationData.strokes) || [];
        const elementRect = annotationData && annotationData.elementRect;
        const viewport = annotationData && annotationData.viewport;
        drawStrokesOnContext(ctx, canvas.width, canvas.height, strokes, elementRect, viewport);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = baseDataUrl;
    });
  }

  function createAnnotationEditor(screenshotDataUrl, captureContext) {
    const wrap = document.createElement('div');
    wrap.className = 'pnpt-annotate-wrap';

    const stage = document.createElement('div');
    stage.className = 'pnpt-annotate-stage';

    const img = document.createElement('img');
    img.className = 'pnpt-screenshot-thumb';
    img.src = screenshotDataUrl;
    img.alt = 'Screenshot';

    const canvas = document.createElement('canvas');
    canvas.className = 'pnpt-annotate-canvas';

    const toolbar = document.createElement('div');
    toolbar.className = 'pnpt-annotate-toolbar';

    const strokes = [];
    let activeTool = 'pen';
    let activeColor = ANNOTATE_COLORS[0];
    let drawing = false;
    let currentStroke = null;
    let ctx = null;

    const penBtn = document.createElement('button');
    penBtn.type = 'button';
    penBtn.className = 'pnpt-annotate-tool active';
    penBtn.textContent = 'Pen';
    penBtn.title = 'Pen';

    const hiBtn = document.createElement('button');
    hiBtn.type = 'button';
    hiBtn.className = 'pnpt-annotate-tool';
    hiBtn.textContent = 'Highlight';
    hiBtn.title = 'Highlighter';

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'pnpt-annotate-tool';
    undoBtn.textContent = 'Undo';
    undoBtn.title = 'Undo last stroke';

    toolbar.appendChild(penBtn);
    toolbar.appendChild(hiBtn);
    toolbar.appendChild(undoBtn);

    const colorRow = document.createElement('div');
    colorRow.className = 'pnpt-annotate-colors';
    const colorButtons = ANNOTATE_COLORS.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pnpt-annotate-color';
      b.style.background = c;
      b.title = c;
      if (c === activeColor) b.classList.add('active');
      b.addEventListener('click', () => {
        activeColor = c;
        colorButtons.forEach((btn) => btn.classList.toggle('active', btn === b));
      });
      colorRow.appendChild(b);
      return b;
    });

    toolbar.appendChild(colorRow);
    stage.appendChild(img);
    stage.appendChild(canvas);
    wrap.appendChild(toolbar);
    wrap.appendChild(stage);

    function canvasPoint(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
    }

    function setupCanvas() {
      const displayWidth = stage.clientWidth || wrap.clientWidth || 268;
      const scale = displayWidth / img.naturalWidth;
      const displayHeight = Math.round(img.naturalHeight * scale);
      canvas.width = displayWidth;
      canvas.height = displayHeight;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      ctx = canvas.getContext('2d');
      redrawAnnotationCanvas(
        canvas,
        ctx,
        img,
        strokes,
        captureContext.elementRect,
        captureContext.viewport
      );
    }

    img.addEventListener('load', setupCanvas);

    penBtn.addEventListener('click', () => {
      activeTool = 'pen';
      penBtn.classList.add('active');
      hiBtn.classList.remove('active');
    });

    hiBtn.addEventListener('click', () => {
      activeTool = 'highlighter';
      hiBtn.classList.add('active');
      penBtn.classList.remove('active');
    });

    undoBtn.addEventListener('click', () => {
      strokes.pop();
      redrawAnnotationCanvas(
        canvas,
        ctx,
        img,
        strokes,
        captureContext.elementRect,
        captureContext.viewport
      );
    });

    function onPointerDown(e) {
      e.preventDefault();
      drawing = true;
      const pt = canvasPoint(e);
      currentStroke = {
        tool: activeTool,
        color: activeColor,
        width: activeTool === 'highlighter' ? 0.008 : 0.004,
        points: [[pt.x, pt.y]],
      };
      strokes.push(currentStroke);
    }

    function onPointerMove(e) {
      if (!drawing || !currentStroke) return;
      e.preventDefault();
      const pt = canvasPoint(e);
      currentStroke.points.push([pt.x, pt.y]);
      redrawAnnotationCanvas(
        canvas,
        ctx,
        img,
        strokes,
        captureContext.elementRect,
        captureContext.viewport
      );
    }

    function onPointerUp() {
      drawing = false;
      currentStroke = null;
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);

    return {
      wrap,
      getAnnotationData() {
        return {
          strokes: strokes.map((s) => ({
            tool: s.tool,
            color: s.color,
            width: s.width,
            points: s.points.slice(),
          })),
          elementRect: captureContext.elementRect,
          viewport: captureContext.viewport,
        };
      },
    };
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
    const pageUrl = getPageUrl();
    const captureContext = getCaptureContext(el);

    popover = document.createElement('div');
    popover.className = 'pnpt-popover';

    const editor = createAnnotationEditor(screenshotDataUrl, captureContext);
    popover.appendChild(editor.wrap);

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
        const annotationData = editor.getAnnotationData();
        const compositeDataUrl = await compositeScreenshot(screenshotDataUrl, annotationData);
        const screenshotUrl = await uploadScreenshot(compositeDataUrl);
        await submitFeedback({
          prototype_id: protoId,
          page_url: pageUrl,
          element_selector: selector,
          element_text: elementText,
          screenshot_url: screenshotUrl,
          annotation_data: annotationData,
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
      target.closest('.pnpt-dashboard-btn') ||
      target.closest('.pnpt-popover') ||
      target.closest('.pnpt-pin') ||
      target.closest('.pnpt-toast') ||
      target.closest('.pnpt-all-feedback-panel')
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
      target.closest('.pnpt-dashboard-btn') ||
      target.closest('.pnpt-popover') ||
      target.closest('.pnpt-pin') ||
      target.closest('.pnpt-all-feedback-panel')
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

  function createDashboardButton() {
    dashboardBtn = document.createElement('a');
    dashboardBtn.className = 'pnpt-dashboard-btn';
    dashboardBtn.textContent = 'Open dashboard';
    dashboardBtn.href = dashboardUrl;
    dashboardBtn.target = '_blank';
    dashboardBtn.rel = 'noopener noreferrer';
    dashboardBtn.title = 'Open Pinpoint triage dashboard';
    document.body.appendChild(dashboardBtn);
  }

  function init() {
    if (window.__pinpointInitialized) return;
    window.__pinpointInitialized = true;

    createToggleButton();
    createDashboardButton();
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);

    window.addEventListener(
      'scroll',
      () => {
        repositionAllPins();
      },
      { passive: true }
    );

    window.addEventListener(
      'resize',
      () => {
        repositionAllPins();
      },
      { passive: true }
    );

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.PINPOINT_MODE || changes.DASHBOARD_URL || changes.SUPABASE_URL || changes.SUPABASE_ANON_KEY) {
        loadCredentials(() => fetchPins());
      }
    });

    loadCredentials(() => fetchPins());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
