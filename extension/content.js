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
  let launcherBtn = null;
  let mainPanel = null;
  let popover = null;
  let tooltip = null;
  let drawLayer = null;
  let replayOverlay = null;
  let replayTimer = null;
  let replayScrollHandler = null;
  let replayResizeHandler = null;
  let activeReplayData = null;
  let sessionUser = null;
  let activePrototype = null;
  let panelOpen = false;
  let panelFilter = '';
  let activePanelTab = 'capture';
  let configReady = false;

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

  async function loadState(callback) {
    const configRes = await bg({ type: 'GET_CONFIG' });
    configReady = false;
    if (configRes.ok && configRes.data) {
      supabaseUrl = (configRes.data.url || '').replace(/\/$/, '');
      supabaseAnonKey = configRes.data.anonKey || '';
      dashboardUrl = configRes.data.dashboardUrl || DEFAULT_DASHBOARD_URL;
      configReady = Boolean(configRes.data.configured);
    }
    const sessionRes = await bg({ type: 'GET_SESSION' });
    sessionUser = sessionRes.ok ? sessionRes.data?.session?.user : null;
    const protoRes = await bg({ type: 'FIND_PROTOTYPE_FOR_PAGE', pageUrl: getPageUrl() });
    activePrototype = protoRes.ok ? protoRes.data : null;
    ownerMode = activePrototype ? activePrototype.show_team_feedback !== false : false;
    updatePanelChrome();
    callback();
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
      if (item.annotation_data) {
        renderAnnotationOverlay(item.annotation_data, { duration: 5000 });
      }
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
    if (item.annotation_data) {
      renderAnnotationOverlay(item.annotation_data, { duration: 5000 });
    }
    setTimeout(clearTargetHighlight, 3000);
  }

  function renderPins(items) {
    clearPins();
    ensurePinContainer();

    const onPage = [];

    items.forEach((item) => {
      const el = resolveElement(item.element_selector);
      if (el) onPage.push({ item, el });
    });

    onPage.forEach(({ item, el }, index) => {
      const pin = createPinElement(item, index + 1);
      document.body.appendChild(pin);
      positionPin(pin, el);
      attachPinListeners(pin, item, el);
      pins.push({ el: pin, target: el, item });
    });

  }

  async function fetchPins() {
    const sessionRes = await bg({ type: 'GET_SESSION' });
    if (!sessionRes.ok || !sessionRes.data?.session) return;

    if (!activePrototype) {
      const protoRes = await bg({ type: 'FIND_PROTOTYPE_FOR_PAGE', pageUrl: getPageUrl() });
      activePrototype = protoRes.ok ? protoRes.data : null;
      ownerMode = activePrototype ? activePrototype.show_team_feedback !== false : false;
    }

    const protoId = getPrototypeId();
    const pageUrl = getPageUrl();
    let path;
    if (activePrototype?.id) {
      path = `feedback?prototype_uuid=eq.${activePrototype.id}&select=*&order=created_at.asc`;
    } else {
      path = `feedback?prototype_id=eq.${encodeURIComponent(protoId)}&select=*&order=created_at.asc`;
    }
    if (!ownerMode) {
      path += `&page_url=eq.${encodeURIComponent(pageUrl)}`;
    }

    try {
      const res = await bg({ type: 'REST', path });
      if (!res.ok) {
        console.warn('[Pinpoint] Failed to load pins:', res.error);
        if (panelOpen) {
          const list = mainPanel?.querySelector('.pnpt-panel-list');
          if (list) {
            list.innerHTML = `<li class="pnpt-panel-empty pnpt-panel-error">${escapeHtml(res.error || 'Could not load feedback')}</li>`;
          }
        }
        return;
      }
      const items = res.data || [];
      pinRecords = items;
      renderPins(items);
      if (panelOpen && mainPanel) renderFeedbackTabList(items);
    } catch (e) {
      console.warn('[Pinpoint] Failed to load pins', e);
      if (panelOpen) showToast(e.message || 'Could not load feedback');
    }
  }

  function setFeedbackMode(on) {
    feedbackMode = on;
    document.body.style.cursor = on ? 'crosshair' : '';
    if (launcherBtn) {
      launcherBtn.classList.toggle('pnpt-launcher-capture', on);
      launcherBtn.title = on ? 'Capture mode on — click an element' : 'Open Pinpoint';
    }
    updateCaptureTab();
    if (!on && hoveredEl) {
      hoveredEl.classList.remove('pnpt-hover-highlight');
      hoveredEl = null;
    }
    if (!on) {
      closePopover();
      removeDrawLayer();
    } else {
      closePopover();
    }
  }

  function closePopover() {
    if (popover) {
      popover.remove();
      popover = null;
    }
    removeDrawLayer();
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

  async function captureScreenshot() {
    const res = await bg({ type: 'CAPTURE_SCREENSHOT' });
    if (!res.ok) {
      console.warn('[Pinpoint] Screenshot failed:', res.error);
      return null;
    }
    return res.data?.dataUrl || null;
  }

  async function uploadScreenshot(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const filename = `${Date.now()}-${randomId()}.png`;
    const res = await bg({ type: 'STORAGE_UPLOAD', filename, base64 });
    if (!res.ok) throw new Error(res.error || 'Screenshot upload failed');
    return res.data;
  }

  async function submitFeedback(record) {
    const res = await bg({
      type: 'REST',
      method: 'POST',
      path: 'feedback',
      body: record,
      prefer: 'return=minimal',
    });
    if (!res.ok) throw new Error(res.error || 'Feedback insert failed');
  }

  async function toggleVote(feedbackId) {
    if (!sessionUser?.id) {
      showToast('Sign in to upvote');
      return;
    }
    const res = await bg({
      type: 'REST',
      method: 'POST',
      path: 'feedback_votes',
      body: { feedback_id: feedbackId, user_id: sessionUser.id },
      prefer: 'return=minimal',
    });
    if (!res.ok) showToast(res.error || 'Vote failed');
    else await fetchPins();
  }

  function isDocumentCoords(annotationData) {
    if (!annotationData) return false;
    if (annotationData.coordinateSpace === 'document' || annotationData.version >= 2) return true;
    const first = annotationData.strokes && annotationData.strokes[0];
    if (!first || !first.points || !first.points.length) return false;
    const pt = first.points[0];
    return pt && typeof pt === 'object' && !Array.isArray(pt) && 'x' in pt;
  }

  function getCaptureContext(el) {
    const rect = el.getBoundingClientRect();
    return {
      elementRect: {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      },
      viewport: {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };
  }

  function elementRectToViewport(elementRect, viewport, documentCoords) {
    if (!elementRect || !viewport) return null;
    if (documentCoords) {
      return {
        left: elementRect.left - (viewport.scrollX || 0),
        top: elementRect.top - (viewport.scrollY || 0),
        width: elementRect.width,
        height: elementRect.height,
      };
    }
    return elementRect;
  }

  function strokePointsToNormalized(points, viewport, documentCoords) {
    const vw = viewport.width || window.innerWidth;
    const vh = viewport.height || window.innerHeight;
    const sx = viewport.scrollX || 0;
    const sy = viewport.scrollY || 0;
    return points.map((pt) => {
      if (documentCoords) {
        return [(pt.x - sx) / vw, (pt.y - sy) / vh];
      }
      return [pt[0], pt[1]];
    });
  }

  function drawStrokesOnContext(ctx, width, height, strokes, elementRect, viewport, documentCoords) {
    const docCoords = documentCoords !== undefined
      ? documentCoords
      : isDocumentCoords({ strokes, elementRect, viewport });

    const vpRect = elementRectToViewport(elementRect, viewport, docCoords);
    if (vpRect && viewport) {
      const scaleX = width / viewport.width;
      const scaleY = height / viewport.height;
      ctx.save();
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
      ctx.lineWidth = 2 * Math.max(scaleX, scaleY);
      ctx.setLineDash([6 * scaleX, 4 * scaleX]);
      ctx.strokeRect(
        vpRect.left * scaleX,
        vpRect.top * scaleY,
        vpRect.width * scaleX,
        vpRect.height * scaleY
      );
      ctx.restore();
    }

    strokes.forEach((stroke) => {
      if (!stroke.points || stroke.points.length < 2) return;
      const normalized = strokePointsToNormalized(stroke.points, viewport, docCoords);
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const baseWidth = docCoords
        ? (stroke.width || 0.004) * (viewport.width || width)
        : (stroke.width || 3) * width;
      let lineWidth = baseWidth;
      if (stroke.tool === 'highlighter') {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = stroke.color;
        lineWidth = baseWidth * 3;
      } else {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke.color;
      }
      ctx.lineWidth = lineWidth * (width / (viewport.width || width));
      normalized.forEach((pt, i) => {
        const x = pt[0] * width;
        const y = pt[1] * height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  function drawStrokesOnPageCanvas(ctx, strokes, elementRect, options) {
    const opacity = (options && options.opacity) != null ? options.opacity : 1;
    const docCoords = options && options.documentCoords;

    if (elementRect && docCoords) {
      const vpRect = elementRectToViewport(elementRect, {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
      }, true);
      if (vpRect) {
        ctx.save();
        ctx.strokeStyle = `rgba(99, 102, 241, ${0.9 * opacity})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(vpRect.left, vpRect.top, vpRect.width, vpRect.height);
        ctx.restore();
      }
    } else if (elementRect && !docCoords) {
      ctx.save();
      ctx.strokeStyle = `rgba(99, 102, 241, ${0.9 * opacity})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(elementRect.left, elementRect.top, elementRect.width, elementRect.height);
      ctx.restore();
    }

    strokes.forEach((stroke) => {
      if (!stroke.points || stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const baseWidth = docCoords
        ? (stroke.width || 0.004) * window.innerWidth
        : (stroke.width || 3) * window.innerWidth;
      let lineWidth = baseWidth;
      if (stroke.tool === 'highlighter') {
        ctx.globalAlpha = 0.35 * opacity;
        ctx.strokeStyle = stroke.color;
        lineWidth = baseWidth * 3;
      } else {
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = stroke.color;
      }
      ctx.lineWidth = lineWidth;
      stroke.points.forEach((pt, i) => {
        let x;
        let y;
        if (docCoords) {
          x = pt.x - window.scrollX;
          y = pt.y - window.scrollY;
        } else {
          x = pt[0] * window.innerWidth;
          y = pt[1] * window.innerHeight;
        }
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
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
        if (!strokes.length) {
          resolve(baseDataUrl);
          return;
        }
        const elementRect = annotationData && annotationData.elementRect;
        const viewport = annotationData && annotationData.viewport;
        const docCoords = isDocumentCoords(annotationData);
        drawStrokesOnContext(ctx, canvas.width, canvas.height, strokes, elementRect, viewport, docCoords);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = baseDataUrl;
    });
  }

  function removeDrawLayer() {
    if (drawLayer) {
      drawLayer.remove();
      drawLayer = null;
    }
  }

  function clearAnnotationOverlay() {
    if (replayTimer) {
      clearTimeout(replayTimer);
      replayTimer = null;
    }
    if (replayScrollHandler) {
      window.removeEventListener('scroll', replayScrollHandler);
      replayScrollHandler = null;
    }
    if (replayResizeHandler) {
      window.removeEventListener('resize', replayResizeHandler);
      replayResizeHandler = null;
    }
    if (replayOverlay) {
      replayOverlay.remove();
      replayOverlay = null;
    }
    activeReplayData = null;
  }

  function redrawReplayOverlay() {
    if (!replayOverlay || !activeReplayData) return;
    const canvas = replayOverlay.querySelector('canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const strokes = activeReplayData.strokes || [];
    if (!strokes.length) return;
    const docCoords = isDocumentCoords(activeReplayData);
    drawStrokesOnPageCanvas(ctx, strokes, activeReplayData.elementRect, {
      documentCoords: docCoords,
      opacity: activeReplayData._opacity != null ? activeReplayData._opacity : 1,
    });
  }

  function renderAnnotationOverlay(annotationData, options) {
    if (!annotationData || !annotationData.strokes || !annotationData.strokes.length) return;
    clearAnnotationOverlay();
    activeReplayData = Object.assign({}, annotationData);
    if (options && options.opacity != null) activeReplayData._opacity = options.opacity;

    replayOverlay = document.createElement('div');
    replayOverlay.className = 'pnpt-replay-layer';
    const canvas = document.createElement('canvas');
    replayOverlay.appendChild(canvas);
    document.body.appendChild(replayOverlay);
    redrawReplayOverlay();

    replayScrollHandler = () => redrawReplayOverlay();
    replayResizeHandler = () => redrawReplayOverlay();
    window.addEventListener('scroll', replayScrollHandler, { passive: true });
    window.addEventListener('resize', replayResizeHandler, { passive: true });

    const duration = (options && options.duration) || 0;
    if (duration > 0) {
      replayTimer = setTimeout(clearAnnotationOverlay, duration);
    }
  }

  function createAnnotateToolbar(onToolChange) {
    const toolbar = document.createElement('div');
    toolbar.className = 'pnpt-draw-toolbar pnpt-annotate-toolbar';

    const hint = document.createElement('p');
    hint.className = 'pnpt-draw-hint';
    hint.textContent = 'Draw on the page to highlight the element, then click Done';
    toolbar.appendChild(hint);

    const penBtn = document.createElement('button');
    penBtn.type = 'button';
    penBtn.className = 'pnpt-annotate-tool active';
    penBtn.textContent = 'Pen';

    const hiBtn = document.createElement('button');
    hiBtn.type = 'button';
    hiBtn.className = 'pnpt-annotate-tool';
    hiBtn.textContent = 'Highlight';

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'pnpt-annotate-tool';
    undoBtn.textContent = 'Undo';

    toolbar.appendChild(penBtn);
    toolbar.appendChild(hiBtn);
    toolbar.appendChild(undoBtn);

    const colorRow = document.createElement('div');
    colorRow.className = 'pnpt-annotate-colors';
    let activeColor = ANNOTATE_COLORS[0];
    const colorButtons = ANNOTATE_COLORS.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pnpt-annotate-color';
      b.style.background = c;
      if (c === activeColor) b.classList.add('active');
      b.addEventListener('click', () => {
        activeColor = c;
        colorButtons.forEach((btn) => btn.classList.toggle('active', btn === b));
      });
      colorRow.appendChild(b);
      return b;
    });
    toolbar.appendChild(colorRow);

    let activeTool = 'pen';
    penBtn.addEventListener('click', () => {
      activeTool = 'pen';
      penBtn.classList.add('active');
      hiBtn.classList.remove('active');
      onToolChange(activeTool);
    });
    hiBtn.addEventListener('click', () => {
      activeTool = 'highlighter';
      hiBtn.classList.add('active');
      penBtn.classList.remove('active');
      onToolChange(activeTool);
    });

    return {
      toolbar,
      getActiveTool: () => activeTool,
      getActiveColor: () => activeColor,
      undoBtn,
    };
  }

  function openPageDrawLayer(captureContext) {
    return new Promise((resolve) => {
      removeDrawLayer();
      const strokes = [];
      let drawing = false;
      let currentStroke = null;
      let activeTool = 'pen';

      drawLayer = document.createElement('div');
      drawLayer.className = 'pnpt-draw-layer';

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        redraw();
      }

      function redraw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawStrokesOnPageCanvas(ctx, strokes, captureContext.elementRect, { documentCoords: true });
      }

      const { toolbar, getActiveTool, getActiveColor, undoBtn } = createAnnotateToolbar((tool) => {
        activeTool = tool;
      });

      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'pnpt-draw-done-btn';
      doneBtn.textContent = 'Done';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'pnpt-draw-cancel-btn';
      cancelBtn.textContent = 'Cancel';

      toolbar.appendChild(doneBtn);
      toolbar.appendChild(cancelBtn);

      drawLayer.appendChild(canvas);
      document.body.appendChild(drawLayer);
      document.body.appendChild(toolbar);
      resizeCanvas();

      undoBtn.addEventListener('click', () => {
        strokes.pop();
        redraw();
      });

      function docPoint(e) {
        return { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
      }

      function onPointerDown(e) {
        if (e.target.closest('.pnpt-draw-toolbar')) return;
        e.preventDefault();
        e.stopPropagation();
        drawing = true;
        canvas.setPointerCapture(e.pointerId);
        const pt = docPoint(e);
        activeTool = getActiveTool();
        currentStroke = {
          tool: activeTool,
          color: getActiveColor(),
          width: activeTool === 'highlighter' ? 0.008 : 0.004,
          points: [pt],
        };
        strokes.push(currentStroke);
      }

      function onPointerMove(e) {
        if (!drawing || !currentStroke) return;
        e.preventDefault();
        currentStroke.points.push(docPoint(e));
        redraw();
      }

      function onPointerUp(e) {
        if (!drawing) return;
        drawing = false;
        currentStroke = null;
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (err) {
          /* ignore */
        }
      }

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);

      function teardown() {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        window.removeEventListener('resize', resizeCanvas);
        toolbar.remove();
        removeDrawLayer();
      }

      function buildAnnotationData() {
        return {
          version: 2,
          coordinateSpace: 'document',
          strokes: strokes.map((s) => ({
            tool: s.tool,
            color: s.color,
            width: s.width,
            points: s.points.map((p) => ({ x: p.x, y: p.y })),
          })),
          elementRect: captureContext.elementRect,
          viewport: {
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            width: window.innerWidth,
            height: window.innerHeight,
          },
        };
      }

      doneBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        doneBtn.disabled = true;
        doneBtn.textContent = 'Capturing…';
        const annotationData = buildAnnotationData();
        const screenshotDataUrl = await captureScreenshot();
        teardown();
        resolve({ annotationData, screenshotDataUrl });
      });

      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        teardown();
        resolve(null);
      });

      window.addEventListener('resize', resizeCanvas, { passive: true });
    });
  }

  function isPnptUiElement(target) {
    return !!(
      target.closest('.pnpt-launcher') ||
      target.closest('.pnpt-main-panel') ||
      target.closest('.pnpt-popover') ||
      target.closest('.pnpt-pin') ||
      target.closest('.pnpt-toast') ||
      target.closest('.pnpt-draw-layer') ||
      target.closest('.pnpt-draw-toolbar') ||
      target.closest('.pnpt-replay-layer')
    );
  }

  async function showFeedbackPopover(el, clickX, clickY, screenshotDataUrl, annotationData) {
    closePopover();

    const selector = generateSelector(el);
    const elementText = getElementText(el);
    const protoId = getPrototypeId();
    const pageUrl = getPageUrl();

    popover = document.createElement('div');
    popover.className = 'pnpt-popover';

    if (screenshotDataUrl) {
      const preview = document.createElement('img');
      preview.className = 'pnpt-screenshot-preview';
      preview.src = screenshotDataUrl;
      preview.alt = 'Annotated screenshot';
      popover.appendChild(preview);
    }

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

      if (!sessionUser) {
        showToast('Sign in via the Pinpoint extension popup');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      try {
        if (!configReady) {
          showToast('Extension not configured — add config.js and reload');
          return;
        }
        const hasStrokes = annotationData.strokes && annotationData.strokes.length > 0;
        const uploadDataUrl = hasStrokes
          ? screenshotDataUrl
          : await compositeScreenshot(screenshotDataUrl, annotationData);
        if (!uploadDataUrl) {
          showToast('Could not prepare screenshot');
          return;
        }
        const screenshotUrl = await uploadScreenshot(uploadDataUrl);
        await submitFeedback({
          prototype_id: activePrototype?.prototype_slug || protoId,
          prototype_uuid: activePrototype?.id || null,
          user_id: sessionUser.id,
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
        if (panelOpen) setPanelTab('feedback');
      } catch (e) {
        console.error('[Pinpoint]', e);
        showToast(e.message || 'Failed to save feedback');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      }
    });

    popover.addEventListener('click', (e) => e.stopPropagation());
  }

  async function startFeedbackFlow(el, clickX, clickY) {
    closePopover();
    removeDrawLayer();
    const captureContext = getCaptureContext(el);
    const drawResult = await openPageDrawLayer(captureContext);
    if (!drawResult) {
      setFeedbackMode(false);
      return;
    }
    let { annotationData, screenshotDataUrl } = drawResult;
    if (!screenshotDataUrl) {
      screenshotDataUrl = await captureScreenshot();
    }
    if (!screenshotDataUrl) {
      showToast('Could not capture screenshot');
      setFeedbackMode(false);
      return;
    }
    const hasStrokes = annotationData.strokes && annotationData.strokes.length > 0;
    if (!hasStrokes) {
      screenshotDataUrl = await compositeScreenshot(screenshotDataUrl, annotationData);
    }
    await showFeedbackPopover(el, clickX, clickY, screenshotDataUrl, annotationData);
  }

  function onMouseOver(e) {
    if (!feedbackMode) return;
    const target = e.target;
    if (isPnptUiElement(target)) {
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
    if (isPnptUiElement(target)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (hoveredEl) hoveredEl.classList.remove('pnpt-hover-highlight');
    startFeedbackFlow(target, e.clientX, e.clientY);
  }

  function getPanelStatusMessage() {
    if (!configReady) {
      return 'Extension is not configured. Copy config.example.js to config.js, add Supabase keys, and reload the extension.';
    }
    if (!sessionUser) {
      return 'Sign in from the Pinpoint extension popup (toolbar icon), then reload this page.';
    }
    if (!activePrototype) {
      return 'No prototype registered for this URL. Add this site in the extension popup under your prototypes.';
    }
    return null;
  }

  function updatePanelChrome() {
    if (!mainPanel) return;
    const statusEl = mainPanel.querySelector('.pnpt-panel-status');
    const statusMsg = getPanelStatusMessage();
    if (statusEl) {
      statusEl.textContent = statusMsg || '';
      statusEl.hidden = !statusMsg;
      statusEl.classList.toggle('pnpt-panel-status-error', Boolean(statusMsg));
    }
    const dashLink = mainPanel.querySelector('.pnpt-dashboard-link');
    if (dashLink) {
      dashLink.href = dashboardUrl;
      dashLink.hidden = !sessionUser;
    }
    const protoLabel = mainPanel.querySelector('.pnpt-proto-label');
    if (protoLabel) {
      protoLabel.textContent = activePrototype
        ? activePrototype.name || activePrototype.url_pattern
        : '';
      protoLabel.hidden = !activePrototype;
    }
    updateCaptureTab();
  }

  function updateCaptureTab() {
    if (!mainPanel) return;
    const captureBtn = mainPanel.querySelector('.pnpt-capture-start-btn');
    const hint = mainPanel.querySelector('.pnpt-capture-hint');
    const blocked = Boolean(getPanelStatusMessage());
    if (captureBtn) {
      captureBtn.disabled = blocked;
      captureBtn.textContent = feedbackMode ? 'Cancel capture' : 'Start capture';
      captureBtn.classList.toggle('active', feedbackMode);
    }
    if (hint) {
      hint.textContent = feedbackMode
        ? 'Click any element on the page, draw your annotation, then submit.'
        : 'Turn on capture, click an element, draw on the page, and submit feedback.';
    }
  }

  function setPanelTab(tab) {
    activePanelTab = tab;
    if (!mainPanel) return;
    mainPanel.querySelectorAll('.pnpt-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    mainPanel.querySelectorAll('.pnpt-tab-panel').forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== tab;
    });
    if (tab === 'feedback') renderFeedbackTabList(pinRecords);
  }

  function renderFeedbackTabList(items) {
    const list = mainPanel?.querySelector('.pnpt-panel-list');
    if (!list) return;
    const q = panelFilter.trim().toLowerCase();
    const filtered = q
      ? items.filter(
          (i) =>
            (i.comment || '').toLowerCase().includes(q) ||
            (i.user_name || '').toLowerCase().includes(q) ||
            (i.category || '').toLowerCase().includes(q)
        )
      : items;
    list.innerHTML = '';
    if (!sessionUser) {
      list.innerHTML = '<li class="pnpt-panel-empty">Sign in to view feedback</li>';
      return;
    }
    if (!filtered.length) {
      list.innerHTML = '<li class="pnpt-panel-empty">No feedback yet</li>';
      return;
    }
    filtered.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = `pnpt-panel-item category-${item.category}`;
      const votes = item.vote_count || 0;
      const pageHint = item.page_url
        ? `<span class="pnpt-panel-page">${escapeHtml(formatPageLabel(item.page_url))}</span>`
        : '';
      const upvoteBtn =
        activePrototype?.allow_upvotes !== false
          ? `<button type="button" class="pnpt-upvote-btn" data-id="${item.id}">▲ ${votes}</button>`
          : '';
      li.innerHTML = `<div class="pnpt-panel-item-head"><strong>#${idx + 1}</strong> · ${escapeHtml(item.user_name)} · ${escapeHtml(item.category)}</div>
        <p>${escapeHtml(item.comment)}</p>${pageHint}${upvoteBtn}`;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.pnpt-upvote-btn')) return;
        const onPage = item.page_url === getPageUrl();
        if (onPage) scrollToAndHighlight(item);
        else window.open(item.page_url, '_blank', 'noopener');
      });
      const voteBtn = li.querySelector('.pnpt-upvote-btn');
      if (voteBtn) {
        voteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleVote(item.id);
        });
      }
      list.appendChild(li);
    });
  }

  function toggleMainPanel(open) {
    panelOpen = open !== undefined ? open : !panelOpen;
    if (mainPanel) mainPanel.classList.toggle('pnpt-main-panel-open', panelOpen);
    if (launcherBtn) launcherBtn.classList.toggle('pnpt-launcher-open', panelOpen);
    if (panelOpen) {
      setPanelTab(activePanelTab);
      fetchPins();
      updatePanelChrome();
    } else if (feedbackMode) {
      setFeedbackMode(false);
    }
  }

  function createPinpointUi() {
    launcherBtn = document.createElement('button');
    launcherBtn.type = 'button';
    launcherBtn.className = 'pnpt-launcher';
    launcherBtn.title = 'Open Pinpoint';
    launcherBtn.setAttribute('aria-label', 'Open Pinpoint');
    launcherBtn.innerHTML = '<span class="pnpt-launcher-icon" aria-hidden="true"></span>';
    launcherBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMainPanel();
    });

    mainPanel = document.createElement('aside');
    mainPanel.className = 'pnpt-main-panel';
    mainPanel.innerHTML = `
      <div class="pnpt-main-panel-header">
        <strong>Pinpoint</strong>
        <button type="button" class="pnpt-panel-close" aria-label="Close">×</button>
      </div>
      <p class="pnpt-proto-label" hidden></p>
      <div class="pnpt-panel-status pnpt-panel-status-error" hidden></div>
      <div class="pnpt-panel-tabs" role="tablist">
        <button type="button" class="pnpt-tab active" data-tab="capture" role="tab">Capture</button>
        <button type="button" class="pnpt-tab" data-tab="feedback" role="tab">All feedback</button>
      </div>
      <div class="pnpt-tab-panel" data-tab-panel="capture">
        <p class="pnpt-capture-hint"></p>
        <button type="button" class="pnpt-capture-start-btn pnpt-btn-primary">Start capture</button>
      </div>
      <div class="pnpt-tab-panel" data-tab-panel="feedback" hidden>
        <input type="search" class="pnpt-panel-search" placeholder="Filter feedback…">
        <ul class="pnpt-panel-list"></ul>
        <a class="pnpt-dashboard-link" target="_blank" rel="noopener noreferrer">Open dashboard (export)</a>
      </div>
    `;

    mainPanel.querySelector('.pnpt-panel-close').addEventListener('click', () => toggleMainPanel(false));
    mainPanel.querySelectorAll('.pnpt-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => setPanelTab(tabBtn.dataset.tab));
    });
    mainPanel.querySelector('.pnpt-capture-start-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (getPanelStatusMessage()) {
        showToast(getPanelStatusMessage());
        return;
      }
      setFeedbackMode(!feedbackMode);
      if (feedbackMode) toggleMainPanel(false);
    });
    mainPanel.querySelector('.pnpt-panel-search').addEventListener('input', (e) => {
      panelFilter = e.target.value;
      renderFeedbackTabList(pinRecords);
    });

    document.body.appendChild(mainPanel);
    document.body.appendChild(launcherBtn);
    updatePanelChrome();
    setPanelTab('capture');
  }

  function init() {
    if (window.__pinpointInitialized) return;
    window.__pinpointInitialized = true;

    createPinpointUi();
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
      if (changes.PINPOINT_SESSION || changes.PINPOINT_ACTIVE_PROTOTYPE) {
        loadState(() => fetchPins());
      }
    });

    loadState(() => fetchPins());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
