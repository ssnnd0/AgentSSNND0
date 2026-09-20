import type { ActionCandidate, PageObservation } from './index';

type AgentDecisionMessage = {
  result?: {
    pageSummary: string;
    selectedAction?: ActionCandidate;
    reasoning?: string;
  };
};

const taskInput = document.querySelector('#task-input') as HTMLTextAreaElement | null;
const pageSummary = document.querySelector('#page-summary') as HTMLParagraphElement | null;
const decisionList = document.querySelector('#decision-list') as HTMLUListElement | null;
const insightTags = document.querySelector('#insight-tags') as HTMLDivElement | null;
const runTaskButton = document.querySelector('#run-task') as HTMLButtonElement | null;
const readPageButton = document.querySelector('#read-page') as HTMLButtonElement | null;
const settingsButton = document.querySelector('#open-settings') as HTMLButtonElement | null;
const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode-button'));
let activeMode: 'chat' | 'agent' | 'inspect' | 'cursor-follow' = 'chat';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderInsights(source: string, candidates: ActionCandidate[]) {
  if (!insightTags) return;

  const tokens = Array.from(new Set([
    ...source.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3 && token.length < 18),
    ...candidates.flatMap((candidate) => candidate.kind.split('-')),
    ...candidates.flatMap((candidate) => candidate.label.toLowerCase().split(/[^a-z0-9]+/)).filter((token) => token.length > 3 && token.length < 16),
  ])).slice(0, 6);

  insightTags.innerHTML = tokens.length
    ? tokens.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')
    : '<span class="tag">page ready</span>';
}

function renderDecisions(candidates: ActionCandidate[]) {
  if (!decisionList) return;
  const ranked = [...candidates].sort((a, b) => b.confidence - a.confidence);

  decisionList.innerHTML = ranked
    .map((candidate) => `
      <li class="decision-item">
        <div class="decision-main">
          <strong>${escapeHtml(candidate.label)}</strong>
          <span class="decision-kind">${escapeHtml(candidate.kind)}</span>
        </div>
        <div class="decision-meta">
          <span class="confidence-label">confidence</span>
          <span class="confidence-score">${candidate.confidence.toFixed(2)}</span>
        </div>
      </li>
    `)
    .join('');
}

async function readCurrentPage(): Promise<{ pageSummary: string; selectedAction?: ActionCandidate; reasoning?: string; candidates?: ActionCandidate[] }> {
  const task = taskInput?.value?.trim() || 'Complete the current task on this page.';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return {
        pageSummary: 'No active tab is available. Open a page to inspect it.',
        selectedAction: { id: 'done', kind: 'done', label: 'No active tab', confidence: 0.12 },
        candidates: [{ id: 'done', kind: 'done', label: 'No active tab', confidence: 0.12 }],
      };
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_SNAPSHOT', task });
    const snapshot = response?.snapshot as (PageObservation & { candidates: ActionCandidate[] }) | undefined;

    if (snapshot && Array.isArray(snapshot.candidates) && snapshot.elements?.length) {
      const result = (await chrome.runtime.sendMessage({
        type: 'READ_PAGE_AND_SELECT_ACTION',
        payload: snapshot,
      })) as AgentDecisionMessage;

      const selected = result?.result?.selectedAction ?? snapshot.candidates[0];
      const summary = result?.result?.pageSummary ?? (snapshot.pageText.slice(0, 180) || 'No summary available yet.');

      return {
        pageSummary: summary,
        selectedAction: selected,
        reasoning: result?.result?.reasoning,
        candidates: snapshot.candidates,
      };
    }
  } catch (error) {
    console.warn('Page snapshot error:', error);
  }

  return {
    pageSummary: 'Page could not be inspected from the active tab yet. Try reloading or opening a normal webpage.',
    selectedAction: { id: 'done', kind: 'done', label: 'Page unavailable', confidence: 0.12 },
    candidates: [{ id: 'done', kind: 'done', label: 'Page unavailable', confidence: 0.12 }],
  };
}

async function runDecisionFlow() {
  const result = await readCurrentPage();
  if (pageSummary) {
    pageSummary.textContent = result.pageSummary || 'No page summary available.';
  }

  const selected = result.selectedAction ?? { id: 'done', kind: 'done', label: 'No action', confidence: 0.12 };
  const candidates = result.candidates && result.candidates.length ? result.candidates : [selected];

  renderInsights(result.pageSummary, candidates);
  renderDecisions([selected, ...candidates.filter((candidate) => candidate.id !== selected.id)]);
}

function applyMode(mode: typeof activeMode) {
  activeMode = mode;

  for (const button of modeButtons) {
    button.classList.toggle('active', button.dataset.mode === mode);
  }

  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab?.id) return;
    const enabled = mode === 'cursor-follow' || mode === 'inspect';
    void chrome.tabs.sendMessage(tab.id, {
      type: 'SET_CURSOR_FOLLOW_MODE',
      enabled,
    }).catch(() => undefined);

    if (mode === 'cursor-follow' && pageSummary) {
      pageSummary.textContent = 'Cursor follow mode is active. Hover elements to inspect them.';
      renderInsights('Cursor follow mode active', [{ id: 'hover', kind: 'click', label: 'Hover target', confidence: 0.92 }]);
    }
  }).catch(() => undefined);
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const nextMode = button.dataset.mode as typeof activeMode;
    applyMode(nextMode);
    if (nextMode !== 'cursor-follow') {
      void runDecisionFlow();
    }
  });
});

runTaskButton?.addEventListener('click', () => {
  void runDecisionFlow();
});

readPageButton?.addEventListener('click', () => {
  void runDecisionFlow();
});

settingsButton?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'settings.html' });
});

if (pageSummary) {
  pageSummary.textContent = 'Waiting for page context…';
}
renderInsights('Waiting for page context...', [{ id: 'ready', kind: 'done', label: 'Ready', confidence: 0.2 }]);
renderDecisions([{ id: 'ready', kind: 'done', label: 'Ready', confidence: 0.2 }]);
