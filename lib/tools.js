/**
 * tools.js — Tool Definitions & Executor
 *
 * Executes LLM-issued commands against the DOM using the element map
 * built by observer.js. Dispatches realistic browser events.
 */

/* ── Helpers ── */
function sleep(ms) {
  return new Promise(r => setTimeout(r, Math.min(ms, 5000)));
}

function fireEvent(el, type, EventClass = MouseEvent, opts = {}) {
  const defaults = { bubbles: true, cancelable: true, composed: true, view: window };
  el.dispatchEvent(new EventClass(type, { ...defaults, ...opts }));
}

function scrollIntoViewIfNeeded(el) {
  const rect = el.getBoundingClientRect();
  const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
  if (!inView) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }
  return false;
}

/* ── Tool Implementations ── */
const TOOLS = {
  async click(params, elementMap) {
    const el = elementMap.get(params.elementId);
    if (!el) return { ok: false, error: `Element ${params.elementId} not found` };
    scrollIntoViewIfNeeded(el);
    await sleep(80);
    const rect = el.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const mOpts = { clientX: cx, clientY: cy, button: 0 };
    fireEvent(el, 'pointerdown', PointerEvent, mOpts);
    fireEvent(el, 'mousedown', MouseEvent, mOpts);
    await sleep(30);
    fireEvent(el, 'pointerup', PointerEvent, mOpts);
    fireEvent(el, 'mouseup', MouseEvent, mOpts);
    fireEvent(el, 'click', MouseEvent, mOpts);
    return {
      ok: true,
      result: `Clicked "${(el.innerText || el.getAttribute('aria-label') || el.tagName).slice(0, 60)}"`,
    };
  },

  async type(params, elementMap) {
    const el = elementMap.get(params.elementId);
    if (!el) return { ok: false, error: `Element ${params.elementId} not found` };
    scrollIntoViewIfNeeded(el);
    el.focus();
    fireEvent(el, 'focus', FocusEvent);
    await sleep(40);
    if (params.clear) {
      el.value = '';
      fireEvent(el, 'input', InputEvent, { inputType: 'deleteContentBackward' });
    }
    // Type character by character for realism (batched for speed)
    const text = params.text || '';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.value = params.clear ? text : el.value + text;
    } else if (el.getAttribute('contenteditable') !== null) {
      el.textContent = params.clear ? text : el.textContent + text;
    }
    fireEvent(el, 'input', InputEvent, { inputType: 'insertText', data: text });
    fireEvent(el, 'change', Event);
    return { ok: true, result: `Typed "${text.slice(0, 60)}" into ${params.elementId}` };
  },

  async select(params, elementMap) {
    const el = elementMap.get(params.elementId);
    if (!el) return { ok: false, error: `Element ${params.elementId} not found` };
    if (el.tagName !== 'SELECT') return { ok: false, error: `${params.elementId} is not a SELECT` };
    scrollIntoViewIfNeeded(el);
    el.focus();
    el.value = params.value;
    fireEvent(el, 'input', InputEvent);
    fireEvent(el, 'change', Event);
    return { ok: true, result: `Selected "${params.value}" in ${params.elementId}` };
  },

  async scroll(params) {
    const amount = params.amount || 400;
    const dir = (params.direction || 'down').toLowerCase();
    const opts = { behavior: 'smooth' };
    switch (dir) {
      case 'down': window.scrollBy({ top: amount, ...opts }); break;
      case 'up': window.scrollBy({ top: -amount, ...opts }); break;
      case 'left': window.scrollBy({ left: -amount, ...opts }); break;
      case 'right': window.scrollBy({ left: amount, ...opts }); break;
      case 'bottom': window.scrollTo({ top: document.body.scrollHeight, ...opts }); break;
      case 'top': window.scrollTo({ top: 0, ...opts }); break;
    }
    await sleep(350);
    return { ok: true, result: `Scrolled ${dir} by ${amount}px. Now at scrollY=${Math.round(window.scrollY)}` };
  },

  async navigate(params) {
    if (!params.url) return { ok: false, error: 'No URL provided' };
    window.location.href = params.url;
    return { ok: true, result: `Navigating to ${params.url}` };
  },

  async wait(params) {
    const ms = Math.min(params.ms || 1000, 5000);
    await sleep(ms);
    return { ok: true, result: `Waited ${ms}ms` };
  },

  async keypress(params) {
    const key = params.key || 'Enter';
    const target = document.activeElement || document.body;
    const opts = {
      key,
      code: key,
      keyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : key === 'Tab' ? 9 : 0,
      bubbles: true, cancelable: true,
    };
    if (params.modifiers) {
      if (params.modifiers.includes('ctrl')) opts.ctrlKey = true;
      if (params.modifiers.includes('shift')) opts.shiftKey = true;
      if (params.modifiers.includes('alt')) opts.altKey = true;
      if (params.modifiers.includes('meta')) opts.metaKey = true;
    }
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keypress', opts));
    await sleep(30);
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
    return { ok: true, result: `Pressed ${key}` };
  },

  async extract(params, elementMap) {
    let el;
    if (params.elementId) {
      el = elementMap.get(params.elementId);
    } else if (params.selector) {
      el = document.querySelector(params.selector);
    } else {
      el = document.body;
    }
    if (!el) return { ok: false, error: 'Element not found for extraction' };
    const text = (el.innerText || el.textContent || '').trim().slice(0, 3000);
    return { ok: true, result: text };
  },

  async done(params) {
    return { ok: true, done: true, summary: params.summary || 'Task completed.' };
  },
};

/**
 * Execute a single tool action.
 * @param {{ tool: string, [key: string]: any }} action
 * @param {Map<string, Element>} elementMap
 * @returns {Promise<{ ok: boolean, result?: string, error?: string, done?: boolean }>}
 */
export async function execute(action, elementMap) {
  const fn = TOOLS[action.tool];
  if (!fn) return { ok: false, error: `Unknown tool: ${action.tool}` };
  try {
    return await fn(action, elementMap);
  } catch (err) {
    return { ok: false, error: `Tool "${action.tool}" failed: ${err.message}` };
  }
}

export const TOOL_NAMES = Object.keys(TOOLS);
