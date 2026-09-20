import { buildActionCandidates, resolveActionTarget, type ActionCandidate, type PageObservation } from './index';

const hoverState = {
  enabled: false,
  tooltip: null as HTMLDivElement | null,
};

function isVisible(element: Element): boolean {
  const style = window.getComputedStyle(element as HTMLElement);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = (element as HTMLElement).getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

function elementSummary(target: Element | null): string {
  if (!target || !(target instanceof Element)) return 'Nothing under the pointer.';

  const name = (target as HTMLElement).tagName.toLowerCase();
  const role = (target as HTMLElement).getAttribute('role') || '';
  const label = (target as HTMLElement).getAttribute('aria-label') || (target as HTMLElement).textContent?.trim() || (target as HTMLInputElement).value || '';
  const placeholder = (target as HTMLElement).getAttribute('placeholder') || '';
  const href = (target as HTMLAnchorElement).href || '';

  const parts = [role, label, placeholder, href].filter(Boolean).slice(0, 3);
  const description = parts.length ? parts.join(' • ') : `${name} element`;
  return `Hover target: ${description}`;
}

function ensureTooltip(): HTMLDivElement {
  if (!hoverState.tooltip) {
    const tooltip = document.createElement('div');
    tooltip.id = 'agentssnnd0-hover-tooltip';
    tooltip.style.position = 'fixed';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.zIndex = '2147483647';
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    tooltip.style.maxWidth = '320px';
    tooltip.style.padding = '8px 10px';
    tooltip.style.borderRadius = '12px';
    tooltip.style.background = 'rgba(9, 17, 31, 0.96)';
    tooltip.style.border = '1px solid rgba(125, 211, 252, 0.35)';
    tooltip.style.color = '#e2f3ff';
    tooltip.style.fontSize = '12px';
    tooltip.style.lineHeight = '1.5';
    tooltip.style.boxShadow = '0 18px 42px rgba(0, 0, 0, 0.35)';
    tooltip.style.transform = 'translate(14px, 14px)';
    tooltip.style.whiteSpace = 'pre-wrap';
    document.body.appendChild(tooltip);
    hoverState.tooltip = tooltip;
  }
  return hoverState.tooltip;
}

function hideTooltip() {
  if (hoverState.tooltip) {
    hoverState.tooltip.style.display = 'none';
  }
}

function updateTooltip(event: MouseEvent) {
  const target = event.target as Element | null;
  const tooltip = ensureTooltip();
  const summary = elementSummary(target);
  tooltip.textContent = summary;
  tooltip.style.display = 'block';
  tooltip.style.left = `${Math.min(event.clientX + 18, window.innerWidth - 340)}px`;
  tooltip.style.top = `${Math.min(event.clientY + 18, window.innerHeight - 120)}px`;
}

function setCursorFollowEnabled(enabled: boolean) {
  hoverState.enabled = enabled;
  if (!enabled) {
    hideTooltip();
    document.removeEventListener('mousemove', updateTooltip);
    return;
  }

  document.addEventListener('mousemove', updateTooltip);
  updateTooltip({ clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 } as MouseEvent);
}

function gatherPageSnapshot(task = 'Complete the current task on this page'): PageObservation & { candidates: ActionCandidate[] } {
  const elements = Array.from(document.querySelectorAll('a, button, input, select, textarea, [role], [tabindex]'))
    .filter((node) => {
      const el = node as HTMLElement;
      const tag = node.tagName.toLowerCase();
      const type = (node as HTMLInputElement).type;
      if (type === 'hidden') return false;
      if ('disabled' in el && el.disabled) return false;
      if (!isVisible(node)) return false;
      return tag === 'a' || tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' || node.hasAttribute('role') || node.hasAttribute('tabindex');
    })
    .slice(0, 30)
    .map((node, index) => {
      const element = node as HTMLElement;
      const role = element.getAttribute('role') || node.tagName.toLowerCase();
      const inputLike = node as HTMLInputElement;
      const text = element.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('name') || '';
      return {
        id: `e${index}`,
        role: role.toLowerCase(),
        text,
        value: inputLike.value || element.getAttribute('value') || '',
        placeholder: element.getAttribute('placeholder') || '',
        href: (node as HTMLAnchorElement).href || '',
      };
    });

  const candidates = buildActionCandidates(task, elements);

  return {
    task,
    url: window.location.href,
    pageText: document.body.innerText.slice(0, 2000),
    elements,
    candidates,
  };
}

function executeAgentAction(action: ActionCandidate | undefined) {
  if (!action) {
    return { ok: false, message: 'No action supplied' };
  }

  const selector = resolveActionTarget(action);
  const target = document.querySelector(selector) ?? (action.targetId ? document.getElementById(action.targetId) : null) ?? document.body;

  if (!target) {
    return { ok: false, message: `Could not resolve target for: ${action.label}`, selector };
  }

  try {
    if (action.kind === 'type') {
      const value = action.value ?? '';
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.focus();
        target.value = value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, message: `Typed into ${action.label}`, selector, value };
      }

      if (target instanceof HTMLElement) {
        target.setAttribute('value', value);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return { ok: true, message: `Prepared ${action.label}`, selector, value };
    }

    if (action.kind === 'select') {
      if (target instanceof HTMLSelectElement) {
        const nextValue = action.value || target.value;
        target.value = nextValue;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, message: `Selected ${action.label}`, selector, value: nextValue };
      }
    }

    if (action.kind === 'scroll') {
      window.scrollBy({ top: 240, behavior: 'smooth' });
      return { ok: true, message: `Scrolled the page for ${action.label}`, selector };
    }

    if (action.kind === 'navigate' && target instanceof HTMLAnchorElement) {
      window.location.href = target.href;
      return { ok: true, message: `Navigated to ${target.href}`, selector };
    }

    if (target instanceof HTMLElement) {
      target.click();
      return { ok: true, message: `Clicked ${action.label}`, selector };
    }
  } catch (error) {
    return { ok: false, message: `Action failed for ${action.label}: ${(error as Error).message ?? 'unknown error'}`, selector };
  }

  return { ok: true, message: `Executed ${action.label}`, selector };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_PAGE_SNAPSHOT') {
    const task = typeof message.task === 'string' ? message.task : 'Complete the current task on this page';
    sendResponse({ ok: true, snapshot: gatherPageSnapshot(task) });
    return;
  }

  if (message?.type === 'READ_PAGE_AND_SELECT_ACTION') {
    const payload = message.payload as PageObservation & { candidates: ActionCandidate[] };
    const task = payload?.task || 'Complete the current task on this page';
    sendResponse({ ok: true, snapshot: gatherPageSnapshot(task), payload });
    return;
  }

  if (message?.type === 'EXECUTE_AGENT_ACTION') {
    const action = message.action as ActionCandidate | undefined;
    sendResponse({ ok: true, result: executeAgentAction(action) });
    return;
  }

  if (message?.type === 'SET_CURSOR_FOLLOW_MODE') {
    const enabled = Boolean(message.enabled);
    setCursorFollowEnabled(enabled);
    sendResponse({ ok: true, enabled });
    return;
  }

  if (message?.type === 'SET_INSPECT_MODE') {
    const mode = typeof message.mode === 'string' ? message.mode : 'inspect';
    setCursorFollowEnabled(mode === 'cursor-follow' || mode === 'inspect');
    sendResponse({ ok: true, mode });
    return;
  }

  if (message?.type === 'GET_CURSOR_CONTEXT') {
    const target = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) || document.body;
    sendResponse({ ok: true, context: elementSummary(target) });
  }
});

function handleKeybind(event: KeyboardEvent) {
  const isAlt = event.altKey || event.metaKey;
  const isShift = event.shiftKey;
  if (!isAlt || !isShift) return;
  const code = event.key.toLowerCase();

  if (code === 'f') {
    event.preventDefault();
    setCursorFollowEnabled(!hoverState.enabled);
  }

  if (code === 'i') {
    event.preventDefault();
    setCursorFollowEnabled(true);
  }
}

document.addEventListener('keydown', handleKeybind);

async function runDecisionLoop() {
  const snapshot = gatherPageSnapshot();
  const response = await chrome.runtime.sendMessage({
    type: 'READ_PAGE_AND_SELECT_ACTION',
    payload: snapshot,
  });

  if (!response?.ok) {
    console.warn('JEV page-read decision failed', response);
    return;
  }

  const action = response.result?.selectedAction ?? snapshot.candidates[0];
  const status = document.createElement('div');
  status.style.position = 'fixed';
  status.style.zIndex = '2147483647';
  status.style.bottom = '16px';
  status.style.right = '16px';
  status.style.maxWidth = '360px';
  status.style.padding = '12px 14px';
  status.style.borderRadius = '12px';
  status.style.background = 'rgba(9,17,31,0.95)';
  status.style.color = '#e5eefb';
  status.style.border = '1px solid rgba(125,211,252,0.35)';
  status.style.fontFamily = 'Inter, sans-serif';
  status.style.fontSize = '12px';
  status.textContent = `AI page read: ${response.result?.pageSummary ?? 'Page detected'} — Jev selected: ${action.label} (${action.kind})`;
  document.body.appendChild(status);
}

void runDecisionLoop();
