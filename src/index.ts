import {
  buildActionCandidates,
  createAgentLoop,
  resolveActionTarget,
  summarizePage,
  type ActionCandidate,
  type PageObservation,
} from './ai-jev-architecture';

export type BrowserTask = PageObservation & { candidates: ActionCandidate[] };

export function createBrowserAgent(opts: {
  aiReadPage: (observation: PageObservation) => Promise<string>;
  jevSelectAction: (task: string, pageSummary: string, candidates: ActionCandidate[]) => Promise<ActionCandidate>;
}) {
  return createAgentLoop({
    aiReader: opts.aiReadPage,
    jev: opts.jevSelectAction,
  });
}

export { buildActionCandidates, createAgentLoop, resolveActionTarget, summarizePage };
export type { ActionCandidate, PageObservation };
