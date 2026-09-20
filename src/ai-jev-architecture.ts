export type InteractionKind = 'click' | 'type' | 'select' | 'scroll' | 'navigate' | 'done';

export type PageElement = {
  id: string;
  role: string;
  text?: string;
  value?: string;
  href?: string;
  placeholder?: string;
};

export type PageObservation = {
  task: string;
  url: string;
  pageText: string;
  elements: PageElement[];
};

export type ActionCandidate = {
  id: string;
  kind: InteractionKind;
  label: string;
  confidence: number;
  targetId?: string;
  targetSelector?: string;
  value?: string;
};

export type AgentDecisionResult = {
  pageSummary: string;
  selectedAction: ActionCandidate;
  reasoning: string;
};

export type AgentLoopInput = PageObservation & { candidates?: ActionCandidate[] };

export type AgentLoopDeps = {
  aiReader: (observation: PageObservation) => Promise<string>;
  jev: (task: string, pageSummary: string, candidates: ActionCandidate[]) => Promise<ActionCandidate>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function tokenise(value: string): string[] {
  return Array.from(new Set((value.match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 2)));
}

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function deriveInteractionKind(element: PageElement): InteractionKind {
  const roleText = normalizeText(element.role || '');
  const labelText = normalizeText([element.text ?? '', element.placeholder ?? '', element.value ?? ''].join(' '));

  if (/(search|query|email|password|username|message|textarea|textbox|field)/.test(roleText) || /(search|email|password|username|message|query)/.test(labelText)) {
    return 'type';
  }

  if (/(select|dropdown|option|choose|filter)/.test(labelText) || /select/.test(roleText)) {
    return 'select';
  }

  if (/(next|more|scroll|load|continue)/.test(labelText) || /scroll/.test(roleText)) {
    return 'scroll';
  }

  if (element.href && /https?:\/\//.test(element.href)) {
    return 'navigate';
  }

  return 'click';
}

export function resolveActionTarget(candidate: Partial<ActionCandidate>): string {
  if (candidate.targetSelector) return candidate.targetSelector;

  const label = candidate.label ? normalizeText(candidate.label) : '';
  const targetId = candidate.targetId ? candidate.targetId.trim() : '';

  if (targetId) {
    return `#${targetId}, [id="${targetId}"]`;
  }

  if (candidate.kind === 'type') {
    const labelSelector = label ? `input[placeholder*="${candidate.label}" i], input[name*="${label}" i], textarea[placeholder*="${candidate.label}" i], input[type="text"], input:not([type="hidden"])` : 'input:not([type="hidden"]), textarea';
    return labelSelector;
  }

  if (candidate.kind === 'select') {
    return 'select, [role="combobox"], option';
  }

  if (candidate.kind === 'navigate') {
    return 'a[href], area[href]';
  }

  if (candidate.kind === 'scroll') {
    return 'html, body';
  }

  if (candidate.kind === 'done') {
    return 'body';
  }

  const base = label ? `button:contains("${candidate.label}"), a:contains("${candidate.label}"), [role="button"], input[type="submit"], input[type="button"]` : 'button, a, [role="button"], input[type="submit"], input[type="button"]';
  return base;
}

export function scoreCandidate(task: string, element: PageElement): number {
  const taskText = normalizeText(task);
  const candidateText = normalizeText([
    element.text ?? '',
    element.value ?? '',
    element.role ?? '',
    element.placeholder ?? '',
    element.href ?? '',
  ].join(' '));

  if (!taskText || !candidateText) return 0.12;

  const taskTokens = tokenise(taskText);
  const candidateTokens = tokenise(candidateText);
  const overlap = taskTokens.filter((token) => candidateTokens.includes(token)).length;
  const exactPhraseBoost = taskText.includes(candidateText) || candidateText.includes(taskText) ? 0.18 : 0;
  const semanticBoost = /(search|submit|login|continue|save|next|open|add|buy|checkout|filter|select|close)/.test(candidateText) ? 0.2 : 0;
  const roleBoost = /(button|link|input|search|textbox|submit)/.test(element.role.toLowerCase()) ? 0.15 : 0;
  const kindBoost = deriveInteractionKind(element) === 'type' && /(search|query|login|email|password)/.test(taskText) ? 0.12 : 0;

  const score = (overlap / Math.max(taskTokens.length, 1)) + exactPhraseBoost + semanticBoost + roleBoost + kindBoost;
  return clamp(score, 0.08, 0.99);
}

export function summarizePage(observation: PageObservation): string {
  const pageText = (observation.pageText ?? '').replace(/\s+/g, ' ').trim();
  const controlSummary = observation.elements.slice(0, 6).map((element) => {
    const label = [element.text, element.value, element.placeholder, element.role].filter(Boolean).join(' / ');
    return label || element.id;
  }).join('; ') || 'No prominent controls detected';

  const excerpt = pageText ? pageText.slice(0, 260) : 'The page has no meaningful visible text.';
  return `Page context: ${excerpt} Controls: ${controlSummary}.`;
}

export function buildActionCandidates(task: string, elements: PageElement[]): ActionCandidate[] {
  const seen = new Set<string>();
  const ranked = elements
    .filter((element) => element && element.role && element.role !== 'hidden')
    .map((element, index) => {
      const kind = deriveInteractionKind(element);
      const label = [element.text, element.value, element.placeholder, element.role].find((value) => Boolean(value)) ?? `Element ${index + 1}`;
      const candidate: ActionCandidate = {
        id: element.id || `action-${index}`,
        kind,
        label,
        confidence: scoreCandidate(task, element),
        targetId: element.id,
        targetSelector: resolveActionTarget({
          id: element.id || `action-${index}`,
          kind,
          label,
          targetId: element.id,
        }),
        value: element.value,
      };

      if (seen.has(candidate.id)) {
        candidate.id = `${candidate.id}-${index}`;
      }
      seen.add(candidate.id);
      return candidate;
    })
    .sort((a, b) => b.confidence - a.confidence);

  if (!ranked.length) {
    return [{ id: 'done', kind: 'done', label: 'Mark task complete', confidence: 0.18 }];
  }

  return ranked.filter((candidate) => candidate.confidence >= 0.12).slice(0, 8);
}

export function validateObservation(observation: Partial<AgentLoopInput>): PageObservation & { candidates?: ActionCandidate[] } {
  const safeTask = (observation.task ?? 'Complete the current task on this page.').trim() || 'Complete the current task on this page.';
  return {
    task: safeTask,
    url: observation.url ?? 'about:blank',
    pageText: observation.pageText ?? '',
    elements: Array.isArray(observation.elements) ? observation.elements : [],
    candidates: Array.isArray(observation.candidates) ? observation.candidates : undefined,
  };
}

export function createAgentLoop({ aiReader, jev }: AgentLoopDeps) {
  return async function runAgentLoop(observation: AgentLoopInput): Promise<AgentDecisionResult> {
    const safeObservation = validateObservation(observation);
    const normalizedTask = safeObservation.task.trim();
    const pageSummary = await aiReader(safeObservation);
    const candidates = safeObservation.candidates?.length
      ? safeObservation.candidates
      : buildActionCandidates(normalizedTask, safeObservation.elements);
    const selectedAction = await jev(normalizedTask.toLowerCase(), pageSummary, candidates);

    const finalSelection: ActionCandidate = selectedAction && selectedAction.label
      ? {
          id: selectedAction.id || 'done',
          kind: selectedAction.kind || 'done',
          label: selectedAction.label,
          confidence: typeof selectedAction.confidence === 'number' ? selectedAction.confidence : 0.18,
          targetId: selectedAction.targetId,
        }
      : { id: 'done', kind: 'done', label: 'Mark task complete', confidence: 0.18 };

    return {
      pageSummary,
      selectedAction: finalSelection,
      reasoning: 'AI page reader interpreted the page state, and Jev selected the highest-value interaction based on task relevance and current DOM context.',
    };
  };
}
