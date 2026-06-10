/**
 * observer.js — DOM Snapshot Engine
 *
 * Walks the visible DOM, extracts interactive elements with bounding boxes,
 * assigns short stable IDs, and returns a compact JSON snapshot for the LLM.
 */

const INTERACTIVE = [
  'A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION',
  'DETAILS', 'SUMMARY', 'LABEL', 'VIDEO', 'AUDIO',
];

const INTERACTIVE_ROLES = [
  'button', 'link', 'menuitem', 'tab', 'checkbox', 'radio',
  'switch', 'option', 'combobox', 'textbox', 'searchbox',
  'slider', 'spinbutton', 'listbox', 'menu',
];

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'META',
  'LINK', 'BR', 'HR', 'HEAD', 'DEFS', 'CLIPPATH',
]);

const MAX_ELEMENTS = 200;
const MAX_TEXT = 150;
const VIEWPORT_BUFFER = 200;

function isVisible(el) {
  if (!el.offsetParent && el.tagName !== 'BODY' && el.tagName !== 'HTML') return false;
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
  return true;
}

function isInteractable(el) {
  const tag = el.tagName;
  if (INTERACTIVE.includes(tag)) return true;
  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.includes(role)) return true;
  if (el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return true;
  if (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') return true;
  if (el.closest('[onclick]') === el) return true;
  // Elements with cursor pointer
  const s = getComputedStyle(el);
  if (s.cursor === 'pointer' && el.textContent.trim().length > 0 && el.textContent.trim().length < 80) return true;
  return false;
}

function inViewport(rect, vw, vh) {
  return (
    rect.bottom > -VIEWPORT_BUFFER &&
    rect.top < vh + VIEWPORT_BUFFER &&
    rect.right > -VIEWPORT_BUFFER &&
    rect.left < vw + VIEWPORT_BUFFER &&
    rect.width > 0 && rect.height > 0
  );
}

function truncate(s, max) {
  if (!s) return '';
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function getLabel(el) {
  // aria-label takes priority
  const aria = el.getAttribute('aria-label');
  if (aria) return truncate(aria, MAX_TEXT);
  // title
  const title = el.getAttribute('title');
  if (title) return truncate(title, MAX_TEXT);
  // placeholder for inputs
  if (el.placeholder) return truncate(el.placeholder, MAX_TEXT);
  // innerText (only direct children to avoid deep nesting noise)
  const text = el.innerText || el.textContent || '';
  return truncate(text, MAX_TEXT);
}

export function snapshot() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const elements = [];
  const elementMap = new Map();
  let counter = 0;

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let node = walker.currentNode;
  while (node && counter < MAX_ELEMENTS * 3) {
    if (node.nodeType === Node.ELEMENT_NODE && isVisible(node)) {
      const rect = node.getBoundingClientRect();
      if (inViewport(rect, vw, vh) && isInteractable(node)) {
        if (counter >= MAX_ELEMENTS) break;
        const id = `e${counter}`;
        const entry = {
          id,
          tag: node.tagName,
          text: getLabel(node),
          bbox: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
          visible: true,
          interactable: true,
        };

        // Extra attributes for specific types
        if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
          entry.type = node.type || 'text';
          entry.value = truncate(node.value, MAX_TEXT);
          entry.placeholder = node.placeholder || '';
        }
        if (node.tagName === 'SELECT') {
          entry.type = 'select';
          entry.options = [...node.options].slice(0, 20).map(o => ({
            value: o.value,
            text: truncate(o.textContent, 60),
            selected: o.selected,
          }));
        }
        if (node.tagName === 'A') {
          entry.href = node.href || '';
        }
        const role = node.getAttribute('role');
        if (role) entry.role = role;
        if (node.disabled) entry.disabled = true;
        if (node.getAttribute('aria-expanded')) entry.expanded = node.getAttribute('aria-expanded');
        if (node.getAttribute('aria-checked')) entry.checked = node.getAttribute('aria-checked');

        elements.push(entry);
        elementMap.set(id, node);
        counter++;
      }
    }
    node = walker.nextNode();
  }

  // Grab some page text context (visible text blocks)
  const textBlocks = [];
  let charBudget = 2000;
  const textWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
        const text = node.textContent.trim();
        if (text.length < 3) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let tNode = textWalker.nextNode();
  while (tNode && charBudget > 0) {
    const text = tNode.textContent.trim();
    if (text.length > 2) {
      const chunk = truncate(text, Math.min(300, charBudget));
      textBlocks.push(chunk);
      charBudget -= chunk.length;
    }
    tNode = textWalker.nextNode();
  }

  return {
    url: location.href,
    title: document.title,
    viewport: { width: vw, height: vh },
    scrollY: Math.round(window.scrollY),
    scrollHeight: Math.round(document.documentElement.scrollHeight),
    elementCount: elements.length,
    elements,
    pageText: textBlocks.join('\n'),
    _elementMap: elementMap,
  };
}
