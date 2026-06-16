/**
 * debugger.js — CDP (Chrome DevTools Protocol) wrapper for browser automation.
 *
 * Replaces chrome.scripting.executeScript for DOM observation, input simulation,
 * screenshots, navigation, and adds dialog/console/error monitoring.
 */

const sessions = new Map();
const REQUIRED_DOMAINS = ['Page', 'Runtime', 'Input', 'DOM', 'Console'];

function send(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

export function sendCommand(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

function getSession(tabId) {
  const s = sessions.get(tabId);
  if (!s) throw new Error(`Debugger not attached to tab ${tabId}`);
  return s;
}

/* ── Lifecycle ── */

export async function attach(tabId) {
  if (sessions.has(tabId)) {
    const existing = sessions.get(tabId);
    existing.info.collectedLogs = [];
    existing.info.collectedErrors = [];
    existing.info.lastDialog = null;
    if (existing.pendingLoad?.timer) clearTimeout(existing.pendingLoad.timer);
    existing.pendingLoad = { resolve: null, timer: null };
    return existing.info;
  }
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (err) {
    if (/already attached/i.test(err.message)) {
      const existing = sessions.get(tabId);
      if (existing) {
        existing.info.collectedLogs = [];
        existing.info.collectedErrors = [];
        existing.info.lastDialog = null;
        if (existing.pendingLoad?.timer) clearTimeout(existing.pendingLoad.timer);
        existing.pendingLoad = { resolve: null, timer: null };
        return existing.info;
      }
    }
    throw new Error(`Debugger attach failed: ${err.message}`);
  }

  for (const domain of REQUIRED_DOMAINS) {
    await send(tabId, `${domain}.enable`).catch(function (e) { console.warn('[debugger] domain enable failed:', domain, e.message); });
  }

  const info = {
    tabId,
    collectedLogs: [],
    collectedErrors: [],
    lastDialog: null,
  };
  const pendingLoad = { resolve: null, timer: null };

  sessions.set(tabId, { info, pendingLoad });
  return info;
}

export async function detach(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;
  if (session.pendingLoad?.timer) clearTimeout(session.pendingLoad.timer);
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) { console.warn('[debugger] detach failed:', e.message); }
  sessions.delete(tabId);
}

export function isAttached(tabId) {
  return sessions.has(tabId);
}

/* ── CDP Event Listener ── */

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId === undefined) return;
  const session = sessions.get(source.tabId);
  if (!session) return;
  const { info, pendingLoad } = session;

  switch (method) {
    case 'Page.javascriptDialogOpening': {
      info.lastDialog = {
        message: params.message,
        type: params.type,
        url: params.url,
      };
      send(source.tabId, 'Page.handleJavaScriptDialog', { accept: false }).catch(function (e) { console.warn('[debugger] dialog dismiss failed:', e.message); });
      break;
    }
    case 'Runtime.consoleAPICalled': {
      const text = (params.args || [])
        .map(a => a.value !== undefined ? String(a.value) : a.description || '')
        .join(' ');
      info.collectedLogs.push({ type: params.type, text, timestamp: Date.now() });
      if (info.collectedLogs.length > 200) info.collectedLogs.splice(0, 50);
      break;
    }
    case 'Runtime.exceptionThrown': {
      const desc =
        params.exceptionDetails?.exception?.description ||
        params.exceptionDetails?.text ||
        'Unknown error';
      info.collectedErrors.push({ text: desc, timestamp: Date.now() });
      if (info.collectedErrors.length > 100) info.collectedErrors.shift();
      break;
    }
    case 'Page.loadEventFired': {
      if (pendingLoad.resolve) pendingLoad.resolve(true);
      break;
    }
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === undefined) return;
  const session = sessions.get(source.tabId);
  if (session) {
    if (session.pendingLoad?.resolve) session.pendingLoad.resolve(false);
    sessions.delete(source.tabId);
  }
});

/* ── Helpers ── */

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ── Injected Observer (serialized for CDP Runtime.evaluate) ── */

function _observe() {
  var INTER = [
    'A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION',
    'DETAILS', 'SUMMARY', 'LABEL', 'VIDEO', 'AUDIO',
  ];
  var ROLES = [
    'button', 'link', 'menuitem', 'tab', 'checkbox', 'radio',
    'switch', 'option', 'combobox', 'textbox', 'searchbox',
    'slider', 'spinbutton', 'listbox', 'menu',
  ];
  var SKIP = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'META',
    'LINK', 'BR', 'HR', 'HEAD', 'DEFS', 'CLIPPATH',
  ]);
  var MAX = 200, MAXT = 150, BUF = 200;
  var vw = window.innerWidth, vh = window.innerHeight;

  function vis(el) {
    if (!el.offsetParent && el.tagName !== 'BODY' && el.tagName !== 'HTML') return false;
    try { var s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'; } catch { return false; }
  }
  function inter(el) {
    if (INTER.includes(el.tagName)) return true;
    var r = el.getAttribute('role');
    if (r && ROLES.includes(r)) return true;
    if (el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return true;
    if (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') return true;
    try { if (getComputedStyle(el).cursor === 'pointer' && (el.textContent || '').trim().length > 0 && (el.textContent || '').trim().length < 80) return true; } catch {}
    return false;
  }
  function trunc(s, m) {
    if (!s) return '';
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > m ? s.slice(0, m) + '\u2026' : s;
  }
  function label(el) {
    return trunc(
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.placeholder ||
      el.innerText ||
      el.textContent || '',
      MAXT
    );
  }

  var elements = [];
  var c = 0;
  var w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: function (n) { return SKIP.has(n.tagName) ? 2 : 1; },
  });
  var nd = w.currentNode;
  while (nd && c < MAX * 3) {
    if (nd.nodeType === 1 && vis(nd)) {
      var r = nd.getBoundingClientRect();
      if (r.bottom > -BUF && r.top < vh + BUF && r.right > -BUF && r.left < vw + BUF && r.width > 0 && r.height > 0 && inter(nd)) {
        if (c >= MAX) break;
        var e = { id: 'e' + c, tag: nd.tagName, text: label(nd), bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
        if (nd.tagName === 'INPUT' || nd.tagName === 'TEXTAREA') { e.type = nd.type || 'text'; e.value = trunc(nd.value, MAXT); e.placeholder = nd.placeholder || ''; }
        if (nd.tagName === 'SELECT') { e.type = 'select'; e.options = [].slice.call(nd.options, 0, 15).map(function (o) { return { value: o.value, text: trunc(o.textContent, 60), selected: o.selected }; }); }
        if (nd.tagName === 'A') e.href = nd.href || '';
        var rl = nd.getAttribute('role'); if (rl) e.role = rl;
        if (nd.disabled) e.disabled = true;
        elements.push(e); c++;
      }
    }
    nd = w.nextNode();
  }

  var tb = []; var cb = 2000;
  var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) {
      var p = n.parentElement;
      if (!p || SKIP.has(p.tagName)) return 2;
      try { if (getComputedStyle(p).display === 'none') return 2; } catch {}
      return (n.textContent || '').trim().length > 2 ? 1 : 2;
    },
  });
  var tn = tw.nextNode();
  while (tn && cb > 0) {
    var t = tn.textContent.trim();
    if (t.length > 2) { var ch = t.slice(0, Math.min(300, cb)); tb.push(ch); cb -= ch.length; }
    tn = tw.nextNode();
  }

  return {
    url: location.href,
    title: document.title,
    viewport: { width: vw, height: vh },
    scrollY: Math.round(window.scrollY),
    scrollHeight: Math.round(document.documentElement.scrollHeight),
    elementCount: elements.length,
    elements: elements,
    pageText: tb.join('\n'),
  };
}

/* ── DOM Observation via CDP ── */

export async function observe(tabId) {
  var fnStr = _observe.toString();
  try {
    var result = await send(tabId, 'Runtime.evaluate', {
      expression: '(' + fnStr + ')()',
      returnByValue: true,
      awaitPromise: false,
    });
    if (result && result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'CDP evaluation exception');
    }
    return (result && result.result && result.result.value) || null;
  } catch (err) {
    if (/detached|not found|cannot access/i.test(err.message)) throw err;
    console.warn('[debugger] observe failed:', err.message);
    return null;
  }
}

/* ── Screenshot via CDP ── */

export async function screenshot(tabId, fullPage) {
  if (fullPage == null) fullPage = false;
  try {
    if (fullPage) {
      var metrics = await send(tabId, 'Page.getLayoutMetrics');
      var cw = (metrics.cssContentSize && metrics.cssContentSize.width) || (metrics.contentSize && metrics.contentSize.width) || 1280;
      var ch = Math.min((metrics.cssContentSize && metrics.cssContentSize.height) || (metrics.contentSize && metrics.contentSize.height) || 900, 10000);
      var result = await send(tabId, 'Page.captureScreenshot', {
        format: 'jpeg', quality: 55,
        clip: { x: 0, y: 0, width: Math.ceil(cw), height: Math.ceil(ch), scale: 1 },
        captureBeyondViewport: true,
      });
      return result && result.data ? { data: result.data, mimeType: 'image/jpeg' } : null;
    }
    var result = await send(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 55 });
    return result && result.data ? { data: result.data, mimeType: 'image/jpeg' } : null;
  } catch (err) {
    console.warn('[debugger] screenshot failed:', err.message);
    return null;
  }
}

/* ── Helper: resolve element center from elementMap ── */

function getCenter(elementMap, elementId) {
  if (elementMap && elementMap.has(elementId)) {
    var b = elementMap.get(elementId);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  return null;
}

function escQuotes(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/* ── Input Primitives ── */

export async function hoverAt(tabId, x, y) {
  var rx = Math.round(x);
  var ry = Math.round(y);
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: rx, y: ry
  });
}

export async function clickAt(tabId, x, y) {
  var rx = Math.round(x);
  var ry = Math.round(y);
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: rx, y: ry, button: 'left', clickCount: 1,
  });
  await sleep(50);
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: rx, y: ry, button: 'left', clickCount: 1,
  });
}

export async function typeText(tabId, text) {
  await send(tabId, 'Input.insertText', { text: text });
}

async function clearInputField(tabId) {
  await send(tabId, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown', modifiers: ['ctrl'], key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65,
  });
  await sleep(20);
  await send(tabId, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown', modifiers: [], key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
  });
  await sleep(20);
  await send(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp', modifiers: [], key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
  });
}

export async function keypress(tabId, key, modifiers) {
  if (!modifiers) modifiers = [];
  var keyInfo = (
    key === 'Enter' ? { code: 'Enter', vk: 13 } :
    key === 'Escape' ? { code: 'Escape', vk: 27 } :
    key === 'Tab' ? { code: 'Tab', vk: 9 } :
    key === 'Backspace' ? { code: 'Backspace', vk: 8 } :
    key === 'Delete' ? { code: 'Delete', vk: 46 } :
    key === 'ArrowUp' ? { code: 'ArrowUp', vk: 38 } :
    key === 'ArrowDown' ? { code: 'ArrowDown', vk: 40 } :
    key === 'ArrowLeft' ? { code: 'ArrowLeft', vk: 37 } :
    key === 'ArrowRight' ? { code: 'ArrowRight', vk: 39 } :
    { code: key, vk: key.length === 1 ? key.charCodeAt(0) : 0 }
  );
  var mods = [];
  for (var i = 0; i < modifiers.length; i++) {
    var m = modifiers[i];
    if (m === 'ctrl' || m === 'shift' || m === 'alt' || m === 'meta') mods.push(m);
  }
  await send(tabId, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown', modifiers: mods, key: key, code: keyInfo.code,
    windowsVirtualKeyCode: keyInfo.vk,
  });
  await sleep(30);
  await send(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp', modifiers: mods, key: key, code: keyInfo.code,
    windowsVirtualKeyCode: keyInfo.vk,
  });
}

/* ── Tool Execution ── */

export async function executeAction(tabId, action, elementMap, lastSnapshot) {
  var tool = action.tool;
  var center = null;
  if (tool !== 'scroll' && tool !== 'keypress' && tool !== 'done' && tool !== 'navigate' && tool !== 'search') {
    center = getCenter(elementMap, action.elementId);
  }

  switch (tool) {
    case 'click': {
      if (!center) return { ok: false, error: 'Element ' + action.elementId + ' not found' };
      await clickAt(tabId, center.x, center.y);
      return { ok: true, result: 'Clicked at (' + Math.round(center.x) + ', ' + Math.round(center.y) + ')' };
    }

    case 'hover': {
      if (!center) return { ok: false, error: 'Element ' + action.elementId + ' not found' };
      await hoverAt(tabId, center.x, center.y);
      return { ok: true, result: 'Hovered at (' + Math.round(center.x) + ', ' + Math.round(center.y) + ')' };
    }

    case 'type': {
      if (!center) return { ok: false, error: 'Element ' + action.elementId + ' not found' };
      await clickAt(tabId, center.x, center.y);
      await sleep(200);
      if (action.clear) await clearInputField(tabId);
      await typeText(tabId, action.text || '');
      return { ok: true, result: 'Typed "' + (action.text || '').slice(0, 60) + '"' };
    }

    case 'select': {
      if (!center) return { ok: false, error: 'Element ' + action.elementId + ' not found' };
      await clickAt(tabId, center.x, center.y);
      await sleep(150);
      var sv = escQuotes(action.value);
      try {
        await send(tabId, 'Runtime.evaluate', {
          expression: '(function(){var cx=' + Math.round(center.x) + ',cy=' + Math.round(center.y) + ';var e=document.elementFromPoint(cx,cy);while(e&&e.tagName!==\'SELECT\')e=e.parentElement;if(!e)return false;e.value=\'' + sv + '\';e.dispatchEvent(new Event("change",{bubbles:true}));return true;})()',
          returnByValue: true,
        });
      } catch (e) { console.warn('[debugger] select eval failed:', e.message); }
      return { ok: true, result: 'Selected "' + action.value + '"' };
    }

    case 'scroll': {
      var amt = Number(action.amount) || 400;
      var d = (action.direction || 'down').toLowerCase();
      var validDirections = ['down', 'up', 'bottom', 'top'];
      if (!validDirections.includes(d)) d = 'down';
      var expr = '';
      if (d === 'down') expr = 'window.scrollBy({top:' + amt + ',behavior:"instant"});';
      else if (d === 'up') expr = 'window.scrollBy({top:-' + amt + ',behavior:"instant"});';
      else if (d === 'bottom') expr = 'window.scrollTo({top:document.body.scrollHeight,behavior:"instant"});';
      else if (d === 'top') expr = 'window.scrollTo({top:0,behavior:"instant"});';
      try { await send(tabId, 'Runtime.evaluate', { expression: expr }); } catch (e) { console.warn('[debugger] scroll eval failed:', e.message); }
      await sleep(300);
      return { ok: true, result: 'Scrolled ' + d };
    }

    case 'keypress': {
      var k = action.key || 'Enter';
      await keypress(tabId, k, action.modifiers || []);
      return { ok: true, result: 'Pressed ' + k };
    }

    case 'extract': {
      if (!center) {
        try {
          var result = await send(tabId, 'Runtime.evaluate', {
            expression: '(function(){return document.body.innerText.slice(0,3000);})()',
            returnByValue: true,
          });
          var txt = result && result.result && result.result.value;
          return txt != null ? { ok: true, result: txt } : { ok: false, error: 'No text' };
        } catch (err) { return { ok: false, error: err.message }; }
      }
      try {
        var result = await send(tabId, 'Runtime.evaluate', {
          expression: '(function(){var e=document.elementFromPoint(' + Math.round(center.x) + ',' + Math.round(center.y) + ');if(!e)return null;return (e.innerText||e.textContent||"").trim().slice(0,3000);})()',
          returnByValue: true,
        });
        var txt = result && result.result && result.result.value;
        return txt != null ? { ok: true, result: txt } : { ok: false, error: 'Element not found' };
      } catch (err) { return { ok: false, error: err.message }; }
    }

    case 'navigate': {
      try {
        await navigateTab(tabId, action.url);
        return { ok: true, result: 'Navigated to ' + action.url };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'search': {
      try {
        return await searchWeb(tabId, action.query || '');
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'done':
      return { ok: true, done: true, summary: action.summary || 'Task completed.' };

    default:
      return { ok: false, error: 'Unknown tool: ' + tool };
  }
}

/* ── Navigation ── */

export async function navigateTab(tabId, url) {
  var session = getSession(tabId);
  if (session.pendingLoad.timer) clearTimeout(session.pendingLoad.timer);
  session.pendingLoad.resolve = null;

  await send(tabId, 'Page.navigate', { url: url });

  return new Promise(function (resolve) {
    session.pendingLoad.resolve = resolve;
    session.pendingLoad.timer = setTimeout(function () {
      session.pendingLoad.resolve = null;
      resolve(false);
    }, 15000);
  });
}

/* ── Monitoring Accessors ── */

export function getCollectedLogs(tabId) {
  var session = sessions.get(tabId);
  return session ? session.info.collectedLogs.slice() : [];
}

export function getCollectedErrors(tabId) {
  var session = sessions.get(tabId);
  return session ? session.info.collectedErrors.slice() : [];
}

export function clearCollected(tabId) {
  var session = sessions.get(tabId);
  if (session) {
    session.info.collectedLogs = [];
    session.info.collectedErrors = [];
    session.info.lastDialog = null;
  }
}

export function getLastDialog(tabId) {
  var session = sessions.get(tabId);
  return session ? session.info.lastDialog : null;
}

/* ── Health Check ── */

export async function healthCheck(tabId) {
  try {
    var result = await send(tabId, 'Runtime.evaluate', {
      expression: '1+1',
      returnByValue: true,
    });
    return result && result.result && result.result.value === 2;
  } catch (e) {
    console.warn('[debugger] healthCheck failed:', e.message);
    return false;
  }
}

/* ── Web Search via DuckDuckGo ── */

export async function searchWeb(tabId, query) {
  var url = 'https://duckduckgo.com/?q=' + encodeURIComponent(query) + '&ia=web';
  await navigateTab(tabId, url);
  return { ok: true, result: 'Searched DuckDuckGo for "' + query + '"' };
}
