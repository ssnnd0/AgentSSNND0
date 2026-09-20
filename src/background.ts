import { buildActionCandidates, createBrowserAgent, summarizePage, type ActionCandidate, type PageObservation } from './index';

const aiReader = async (observation: PageObservation): Promise<string> => summarizePage(observation);

const jevSelectAction = async (task: string, _pageSummary: string, candidates: ActionCandidate[]) => {
  const ranked = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const top = ranked[0] ?? {
    id: 'done',
    kind: 'done',
    label: 'Mark task complete',
    confidence: 0.18,
  };

  if (task.toLowerCase().includes('search') && top.kind === 'click') {
    const searchCandidate = ranked.find((candidate) => /search|input|text/.test(candidate.label.toLowerCase()));
    if (searchCandidate) return { ...searchCandidate, confidence: Math.max(searchCandidate.confidence, 0.77) };
  }

  if (task.toLowerCase().includes('click') && top.kind === 'type') {
    const clickCandidate = ranked.find((candidate) => candidate.kind === 'click');
    if (clickCandidate) return clickCandidate;
  }

  return top;
};

export const browserAgent = createBrowserAgent({ aiReadPage: aiReader, jevSelectAction });

let cursorFollowEnabled = false;

function applyCursorFollowState(enabled: boolean, tabId?: number) {
  cursorFollowEnabled = enabled;
  if (typeof tabId === 'number') {
    void chrome.tabs.sendMessage(tabId, { type: 'SET_CURSOR_FOLLOW_MODE', enabled }).catch(() => undefined);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    if (message?.type === 'READ_PAGE_AND_SELECT_ACTION') {
      const payload = message.payload as PageObservation & { candidates: ActionCandidate[] };
      const normalized = {
        ...payload,
        candidates: payload.candidates?.length
          ? payload.candidates
          : buildActionCandidates(payload.task, payload.elements),
      };
      const result = await browserAgent(normalized);
      sendResponse({ ok: true, result });
      return;
    }

    if (message?.type === 'SET_CURSOR_FOLLOW_MODE') {
      const enabled = Boolean(message.enabled);
      const tabId = typeof message.tabId === 'number' ? message.tabId : undefined;
      applyCursorFollowState(enabled, tabId);
      sendResponse({ ok: true, enabled });
      return;
    }

    if (message?.type === 'EXECUTE_AGENT_ACTION') {
      const action = message.action as ActionCandidate | undefined;
      if (!action) {
        sendResponse({ ok: false, error: 'No action supplied' });
        return;
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }

      const result = await chrome.tabs.sendMessage(tab.id, { type: 'EXECUTE_AGENT_ACTION', action });
      sendResponse({ ok: true, result });
      return;
    }

    if (message?.type === 'GET_CURSOR_CONTEXT') {
      sendResponse({ ok: true, context: { enabled: cursorFollowEnabled } });
    }
  })();

  return true;
});

chrome.commands?.onCommand.addListener((command) => {
  if (command === 'toggle-cursor-follow') {
    cursorFollowEnabled = !cursorFollowEnabled;
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        void chrome.tabs.sendMessage(tab.id, { type: 'SET_CURSOR_FOLLOW_MODE', enabled: cursorFollowEnabled }).catch(() => undefined);
      }
    }).catch(() => undefined);
  }

  if (command === 'toggle-inspect-mode') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        void chrome.tabs.sendMessage(tab.id, { type: 'SET_INSPECT_MODE', mode: 'inspect' }).catch(() => undefined);
      }
    }).catch(() => undefined);
  }
});
