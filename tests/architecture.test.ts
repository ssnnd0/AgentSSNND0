import { describe, expect, it } from 'vitest';
import { createAgentLoop, resolveActionTarget, type ActionCandidate, type PageObservation } from '../src/ai-jev-architecture';

describe('AI + Jev agent loop', () => {
  it('reads page intent with the AI and lets Jev decide the next human-like interaction', async () => {
    const aiReader = async (observation: PageObservation): Promise<string> => {
      const pageText = observation.pageText.toLowerCase();
      if (pageText.includes('search')) {
        return 'The page has a search box and a submit button. The user likely wants to search for the term in the query field.';
      }
      return 'The page is a catalog with product cards and a visible add-to-cart button.';
    };

    const candidates: ActionCandidate[] = [
      { id: 'click-search', kind: 'click', label: 'Search', confidence: 0.91 },
      { id: 'type-query', kind: 'type', label: 'Type query', confidence: 0.72 },
      { id: 'done', kind: 'done', label: 'Complete', confidence: 0.25 },
    ];

    const jev = async (goal: string, pageSummary: string, options: ActionCandidate[]) => {
      expect(goal).toContain('search');
      expect(pageSummary).toContain('search box');
      return options[0];
    };

    const loop = createAgentLoop({ aiReader, jev });
    const decision = await loop({
      task: 'Search for the term and continue',
      url: 'https://example.com',
      pageText: 'Search for products in the catalog',
      elements: [
        { id: 'e1', role: 'textbox', text: 'Search', value: '' },
        { id: 'e2', role: 'button', text: 'Submit', value: '' },
      ],
      candidates,
    });

    expect(decision.selectedAction.id).toBe('click-search');
    expect(decision.pageSummary).toContain('search box');
  });

  it('derives browser-ready selectors so the agent can execute real page actions', () => {
    const target = resolveActionTarget({
      id: 'search-field',
      kind: 'type',
      label: 'Search',
      confidence: 0.88,
      targetId: 'search-field',
      targetSelector: 'input[placeholder="Search"]',
      value: 'ai tests',
    });

    expect(target).toContain('input');
    expect(target).toContain('Search');
  });
});
