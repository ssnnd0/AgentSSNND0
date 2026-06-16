/**
 * agent.js — Agentic Orchestration Loop
 *
 * Drives the LLM through multi-step browser automation:
 *   Observe DOM + Screenshot → Send to LLM → Parse tool calls → Execute → Repeat
 */
import { resolve, buildUrl } from './backends.js';
import { ensure } from './relay.js';
import { KEYS, get } from './keeper.js';
import * as debug from './debugger.js';

const MAX_STEPS_DEFAULT = 25;
const HISTORY_FULL = 8;

const AGENT_SYSTEM = `You are a browser automation agent. You can see a structured snapshot of the current webpage AND a screenshot of what the user sees. Use both to understand the page layout.

IMPORTANT RULES:
1. Always respond with valid JSON only. No markdown, no explanation outside the JSON.
2. Analyze BOTH the element snapshot AND the screenshot carefully before acting.
3. Only use element IDs from the current snapshot (e.g. "e0", "e5").
4. If you need to wait for a page to load after navigation or a click, use the "wait" tool.
5. When the task is complete, use the "done" tool with a detailed summary.
6. Think step-by-step. Each response should have your reasoning and usually ONE action (unless multiple are clearly safe together, like clearing + typing).
7. If the page doesn't seem to have changed after an action, try a different approach.
8. If you're stuck after 3 attempts, use "done" with an explanation of what went wrong.
9. To search the web, use the "search" tool with your query — it will navigate to DuckDuckGo results.
10. Use the screenshot to understand visual layout, especially for images, icons, and page structure.

AVAILABLE TOOLS:
- click: { "tool": "click", "elementId": "e3" }
- type: { "tool": "type", "elementId": "e0", "text": "hello", "clear": true }
- select: { "tool": "select", "elementId": "e2", "value": "option1" }
- scroll: { "tool": "scroll", "direction": "down|up|top|bottom", "amount": 400 }
- navigate: { "tool": "navigate", "url": "https://..." }
- search: { "tool": "search", "query": "best restaurants in NYC" }
- wait: { "tool": "wait", "ms": 1000 }
- keypress: { "tool": "keypress", "key": "Enter", "modifiers": ["ctrl"] }
- extract: { "tool": "extract", "elementId": "e5" }
- switchTab: { "tool": "switchTab", "index": 0 }
- hover: { "tool": "hover", "elementId": "e4" }
- done: { "tool": "done", "summary": "Found 3 apartments under $2000..." }

RESPONSE FORMAT (strict JSON):
{
  "thinking": "I can see a search input (e0) and a submit button (e1). I'll type the query and click search.",
  "actions": [
    { "tool": "type", "elementId": "e0", "text": "3 bedroom apartments", "clear": true },
    { "tool": "click", "elementId": "e1" }
  ]
}`;

/* ── Tool definitions prepended to every user message so the LLM always sees them ── */
const TOOL_DEFS = `AVAILABLE TOOLS (use only these):
- click(elementId) — click element visible on screen
- type(elementId, text, clear) — type text into input (clear=true erases first)
- select(elementId, value) — pick an option from a select/dropdown
- scroll(direction, amount) — scroll page: "down"|"up"|"top"|"bottom"
- navigate(url) — go to a URL (use full https:// address)
- search(query) — search the web via DuckDuckGo
- wait(ms) — pause (max 5000ms)
- keypress(key, modifiers) — press Enter, Escape, Tab, ArrowDown, etc.
- extract(elementId) — read text content from an element
- switchTab(index) — switch to another tab in the group
- hover(elementId) — move cursor to element to trigger hover effects
- done(summary) — mark task complete with a summary

RESPONSE MUST BE VALID JSON ONLY:
{ "thinking": "your reasoning here", "actions": [ { "tool": "...", ... } ] }`;

/** Active agent sessions: tabId → { cancel, step, task } */
const sessions = new Map();

/* ── Multimodal Body Builders ── */

function buildMultimodalBody(backendId, messages, system, model, maxTok) {
  const temp = 0.2;

  switch (backendId) {
    case 'anthropic': {
      return {
        model,
        max_tokens: maxTok || 4096,
        temperature: temp,
        system: system || undefined,
        messages: messages.map(m => {
          if (m.image) {
            return {
              role: m.role,
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: m.imageMime || 'image/jpeg',
                    data: m.image,
                  },
                },
                { type: 'text', text: m.content },
              ],
            };
          }
          return { role: m.role, content: m.content };
        }),
      };
    }

    case 'gemini': {
      const body = {
        contents: messages.map(m => {
          const parts = [];
          if (m.image) {
            parts.push({
              inlineData: {
                mimeType: m.imageMime || 'image/jpeg',
                data: m.image,
              },
            });
          }
          parts.push({ text: m.content });
          return {
            role: m.role === 'assistant' ? 'model' : 'user',
            parts,
          };
        }),
        generationConfig: {
          maxOutputTokens: maxTok || 4096,
          temperature: temp,
        },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      return body;
    }

    default: {
      // OpenAI-compatible: openai, openrouter, deepseek, mistral
      const msgs = [];
      if (system) msgs.push({ role: 'system', content: system });
      for (const m of messages) {
        if (m.image) {
          msgs.push({
            role: m.role,
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${m.imageMime || 'image/jpeg'};base64,${m.image}`,
                  detail: 'low',
                },
              },
              { type: 'text', text: m.content },
            ],
          });
        } else {
          msgs.push({ role: m.role, content: m.content });
        }
      }
      return { model, max_tokens: maxTok || 4096, temperature: temp, messages: msgs };
    }
  }
}

/* ── Snapshot Formatting ── */

function formatSnapshot(snap) {
  if (!snap) return '[No snapshot available — the page may still be loading]';
  let out = `PAGE: ${snap.title}\nURL: ${snap.url}\nVIEWPORT: ${snap.viewport.width}×${snap.viewport.height}  SCROLL: ${snap.scrollY}/${snap.scrollHeight}\n\n`;
  out += `INTERACTIVE ELEMENTS (${snap.elementCount}):\n`;
  for (const el of snap.elements) {
    let line = `[${el.id}] <${el.tag}`;
    if (el.type) line += ` type="${el.type}"`;
    if (el.role) line += ` role="${el.role}"`;
    line += `>`;
    if (el.text) line += ` "${el.text}"`;
    if (el.value) line += ` value="${el.value}"`;
    if (el.placeholder) line += ` placeholder="${el.placeholder}"`;
    if (el.href) line += ` href="${el.href}"`;
    if (el.disabled) line += ` [disabled]`;
    if (el.checked) line += ` [checked=${el.checked}]`;
    if (el.expanded) line += ` [expanded=${el.expanded}]`;
    if (el.options) {
      const opts = el.options
        .map(o => `${o.selected ? '→' : ' '}${o.text}`)
        .join(' | ');
      line += ` options=[${opts}]`;
    }
    line += `  @(${el.bbox.x},${el.bbox.y} ${el.bbox.w}×${el.bbox.h})`;
    out += line + '\n';
  }
  if (snap.pageText) {
    out += `\nPAGE TEXT:\n${snap.pageText.slice(0, 2000)}`;
  }
  return out;
}

/* ── History Compaction ── */

function compactHistory(history) {
  if (history.length <= HISTORY_FULL * 2) return history;
  const keep = history.slice(-HISTORY_FULL * 2);
  const old = history.slice(0, -HISTORY_FULL * 2);
  const summary = old
    .map(h => {
      if (h.role === 'user') return `[Step observation]`;
      return `[Agent: ${(h.content || '').slice(0, 100)}]`;
    })
    .join('\n');
  return [
    { role: 'user', content: `[Earlier steps summary]\n${summary}` },
    ...keep,
  ];
}

/* ── JSON Parsing ── */

function parseAgentResponse(text) {
  let clean = text.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(clean);
  } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return { thinking: clean, actions: [] };
  }
}

/* ── LLM Request ── */

async function llmRequest(messages, systemPrompt, onToken) {
  const cfg = await ensure();
  const backend = resolve(cfg.id);
  const model = cfg.model || backend.fallback;
  const url = buildUrl(cfg.id, cfg.gw, model);

  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, backend.extraHeaders?.() || {});
  if (backend.auth.scheme === 'Bearer') {
    headers[backend.auth.header] = `Bearer ${cfg.secret}`;
  } else if (backend.auth.scheme === 'ApiKey') {
    headers[backend.auth.header] = cfg.secret;
  }

  // Build body — use multimodal path if any message has an image
  const hasImages = messages.some(m => m.image);
  let body;
  if (hasImages) {
    body = buildMultimodalBody(
      cfg.id,
      messages,
      systemPrompt,
      model,
      cfg.maxTok || 4096
    );
  } else {
    body = backend.wrap(messages, systemPrompt, model, cfg.maxTok || 4096);
    if (body) body.temperature = 0.2;
  }

  var lastError;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`LLM ${res.status}: ${errBody.slice(0, 500) || '(no body)'}`);
      }

      const ctype = res.headers.get('content-type') || '';
      if (ctype.includes('event-stream')) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '',
          full = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;
            try {
              const pkt = JSON.parse(raw);
              const tok =
                backend.extractStream?.(pkt) ||
                pkt.choices?.[0]?.delta?.content ||
                '';
              if (tok) {
                full += tok;
                if (onToken) onToken(tok);
              }
            } catch {}
          }
        }
        if (!full) throw new Error('LLM returned empty streaming response');
        return full;
      } else {
        const text = await res.text();
        if (!text) throw new Error('LLM returned empty response');
        var json;
        try { json = JSON.parse(text); } catch { throw new Error('LLM returned non-JSON: ' + text.slice(0, 300)); }
        const content = backend.unwrap(json);
        if (!content) throw new Error('LLM returned empty content (check model permissions)');
        return content;
      }
    } catch (err) {
      lastError = err;
      var isFatal = /400|401|403|429/.test(err.message);
      if (attempt === 0 && !isFatal) {
        await new Promise(function (r) { setTimeout(r, 1500); });
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

/* ── Visual Overlay (injected into page) ──
   Pulsing slate frame, status pill, and a smooth animated cursor so
   the user can SEE what the agent is doing. CSP-safe: only CSSOM inline
   styles + the Web Animations API — no injected stylesheets. */

function injectedOverlaySetup() {
  if (window.__ssnnd0_ui) {
    window.__ssnnd0_ui.show();
    return true;
  }

  var Z = 2147483640;
  var SLATE = '#708090';

  var css = function (el, obj) { for (var k in obj) el.style[k] = obj[k]; return el; };
  var div = function (obj) { return css(document.createElement('div'), obj); };

  /* — Big visible cursor — */
  var cursor = div({
    position: 'fixed', left: '0', top: '0', zIndex: Z + 3,
    width: '42px', height: '42px', pointerEvents: 'none',
    transform: 'translate(0,0)',
    transition: 'transform .35s cubic-bezier(.22,1,.36,1)',
    opacity: '0',
    filter: 'drop-shadow(0 3px 10px rgba(0,0,0,.6)) drop-shadow(0 0 18px rgba(112,128,144,.5))',
  });
  cursor.innerHTML =
    '<svg width="42" height="42" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 2 L4 22 L9.5 17.2 L13.5 24.5 L16.5 23 L12.5 15.5 L20 14.5 Z" ' +
    'fill="#ffffff" stroke="#708090" stroke-width="2.2" stroke-linejoin="round"/>' +
    '<circle cx="6" cy="6" r="1.5" fill="rgba(112,128,144,.35)"/></svg>';

  document.documentElement.appendChild(cursor);

  var cx = 0, cy = 0;

  var api = {
    show: function () {
      cursor.style.opacity = '1';
    },
    moveTo: function (x, y) {
      cx = x; cy = y;
      cursor.style.opacity = '1';
      cursor.style.transform = 'translate(' + (x - 5) + 'px, ' + (y - 4) + 'px)';
    },
    ripple: function (x, y) {
      var r = div({
        position: 'fixed', left: (x - 26) + 'px', top: (y - 26) + 'px',
        width: '52px', height: '52px', borderRadius: '50%', zIndex: Z + 1,
        border: '3px solid ' + SLATE, pointerEvents: 'none',
        background: 'rgba(112,128,144,.12)',
      });
      document.documentElement.appendChild(r);
      r.animate(
        [{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }],
        { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)' }
      ).onfinish = function () { r.remove(); };
      cursor.animate(
        [{ transform: 'translate(' + (cx - 5) + 'px,' + (cy - 4) + 'px) scale(1)' },
         { transform: 'translate(' + (cx - 5) + 'px,' + (cy - 4) + 'px) scale(.75)' },
         { transform: 'translate(' + (cx - 5) + 'px,' + (cy - 4) + 'px) scale(1)' }],
        { duration: 260, easing: 'ease-out' }
      );
    },
    done: function () {
      setTimeout(function () { api.hide(); }, 800);
    },
    hide: function () {
      cursor.style.opacity = '0';
      setTimeout(function () {
        cursor.remove();
        delete window.__ssnnd0_ui;
      }, 500);
    },
  };

  window.__ssnnd0_ui = api;
  api.show();
  return true;
}

function injectedOverlayCmd(cmd, payload) {
  var ui = window.__ssnnd0_ui;
  if (!ui) return false;
  try {
    switch (cmd) {
      case 'done': ui.done(); break;
      case 'hide': ui.hide(); break;
      case 'moveTo': ui.moveTo(payload.x, payload.y); break;
      case 'ripple': ui.ripple(payload.x, payload.y); break;
    }
  } catch (e) {}
  return true;
}

/* ── Main Agent Loop ── */

async function overlay(tabId, cmd, payload) {
  try {
    var expr;
    if (cmd === 'setup') {
      expr = '(' + injectedOverlaySetup.toString() + ')()';
    } else {
      expr = '(' + injectedOverlayCmd.toString() + ')(' + JSON.stringify(cmd) + ',' + JSON.stringify(payload ?? null) + ')';
    }
    await debug.sendCommand(tabId, 'Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: false,
    });
  } catch (e) {
    console.warn('[agent] overlay failed:', cmd, e.message);
  }
}

/**
 * Run the agent loop for a task on a given tab.
 *
 * @param {number} tabId
 * @param {string} task
 * @param {(update: object) => void} onUpdate
 * @param {number} groupId
 * @returns {Promise<{ summary: string, steps: number }>}
 */
export async function runAgent(tabId, task, onUpdate, onAsk, groupId) {
  if (sessions.has(tabId)) {
    sessions.get(tabId).cancel = true;
    await new Promise(r => setTimeout(r, 200));
  }

  const useScreenshots = (await get(KEYS.agentScreenshots)) !== false;
  const maxSteps = (await get(KEYS.agentMaxSteps)) || MAX_STEPS_DEFAULT;
  const askBeforeActing = (await get(KEYS.askBeforeActing)) === true;

  var currentTabId = tabId;
  const session = { cancel: false, paused: false, step: 0, task, groupId, currentTabId: tabId };
  sessions.set(tabId, session);

  const history = [];
  let lastSummary = 'Task was cancelled.';
  let finished = false;

  try {
    await debug.attach(currentTabId);
    var healthy = await debug.healthCheck(currentTabId);
    if (!healthy) {
      throw new Error('CDP health check failed — debugger not responding');
    }
    console.log('[agent] CDP health check passed for tab', currentTabId);
    onUpdate({ type: 'agent-start', task, maxSteps });

    for (let step = 0; step < maxSteps; step++) {
      if (session.cancel) {
        onUpdate({ type: 'agent-cancelled', step });
        break;
      }
      while (session.paused && !session.cancel) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (session.cancel) {
        onUpdate({ type: 'agent-cancelled', step });
        break;
      }
      session.step = step;

      await overlay(currentTabId, 'setup');

      // ── 1. Capture Screenshot via CDP (first, so thumbnail shows ASAP) ──
      var screenshotData = null;
      if (useScreenshots) {
        onUpdate({ type: 'agent-step', step, phase: 'screenshot', label: 'Capturing screenshot…' });
        try {
          screenshotData = await debug.screenshot(currentTabId, true);
          if (screenshotData) {
            onUpdate({ type: 'agent-screenshot', data: screenshotData.data, mimeType: screenshotData.mimeType });
          }
        } catch (err) {
          onUpdate({ type: 'agent-step', step, phase: 'screenshot', label: 'Screenshot failed: ' + err.message });
        }
      }

      // ── 2. Observe DOM via CDP ──
      onUpdate({ type: 'agent-step', step, phase: 'observing', label: 'Reading page…' });

      let snap;
      try {
        snap = await debug.observe(currentTabId);
        if (!snap) throw new Error('Snapshot returned null');
      } catch (err) {
        onUpdate({ type: 'agent-step', step, phase: 'error', label: 'Observe failed: ' + err.message });
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      // Build element map from snapshot
      var elementMap = new Map();
      if (snap.elements) {
        for (var i = 0; i < snap.elements.length; i++) {
          var e = snap.elements[i];
          elementMap.set(e.id, e.bbox);
        }
      }

      // Collect console / errors / dialogs from CDP monitoring
      var logs = debug.getCollectedLogs(currentTabId);
      var errors = debug.getCollectedErrors(currentTabId);
      var dialog = debug.getLastDialog(currentTabId);
      debug.clearCollected(currentTabId);

      // ── 3. Build prompt and call LLM ──
      onUpdate({ type: 'agent-step', step, phase: 'thinking', label: 'Analyzing page…' });

      var domText = formatSnapshot(snap);

      // List group tabs
      if (groupId != null) {
        try {
          var groupTabs = await chrome.tabs.query({ groupId: groupId });
          if (groupTabs && groupTabs.length > 0) {
            domText += '\n\nGROUP TABS (' + groupTabs.length + '):\n';
            for (var ti = 0; ti < groupTabs.length; ti++) {
              var gt = groupTabs[ti];
              domText += '[' + ti + '] ' + (gt.active ? '★ ' : '  ') + gt.title + ' — ' + gt.url + '\n';
            }
            domText += 'You are currently on tab [' + groupTabs.findIndex(function (t) { return t.id === currentTabId; }) + ']. Use switchTab to switch to another tab in the group.\n';
          }
        } catch {}
      }

      // Append console/error/dialog context
      if (logs.length > 0) {
        domText += '\n\nBROWSER CONSOLE:\n';
        for (var li = 0; li < logs.length; li++) {
          domText += '[' + logs[li].type + '] ' + logs[li].text + '\n';
        }
      }
      if (errors.length > 0) {
        domText += '\n\nJS ERRORS:\n';
        for (var ei = 0; ei < errors.length; ei++) {
          domText += errors[ei].text + '\n';
        }
      }
      if (dialog) {
        domText += '\n\nDIALOG: [' + dialog.type + '] ' + dialog.message;
      }

      // Prepend tool definitions to every user message so the LLM always sees them
      var userContent = TOOL_DEFS + '\n\n' + (step === 0
        ? 'TASK: ' + task + '\n\nCURRENT PAGE STATE:\n' + domText
        : 'ACTION RESULTS FROM PREVIOUS STEP — NOW OBSERVE THE UPDATED PAGE:\n\n' + domText);

      var message = { role: 'user', content: userContent };
      if (screenshotData) {
        message.image = screenshotData.data;
        message.imageMime = screenshotData.mimeType;
      }
      history.push(message);

      var compacted = compactHistory(
        history.map(function (m, idx) {
          if (idx < history.length - 1 && m.image) {
            return { role: m.role, content: m.content };
          }
          return m;
        })
      );

      // Stream thinking tokens to panel in real-time
      var thinkingBuf = '';
      var responseText;
      try {
        responseText = await llmRequest(compacted, AGENT_SYSTEM, function (tok) {
          thinkingBuf += tok;
          onUpdate({ type: 'agent-thinking', text: thinkingBuf });
        });
      } catch (err) {
        onUpdate({ type: 'agent-step', step, phase: 'error', label: 'LLM error: ' + err.message });
        lastSummary = 'Failed at step ' + step + ': ' + err.message;
        break;
      }

      history.push({ role: 'assistant', content: responseText });

      // ── 4. Parse response ──
      var parsed = parseAgentResponse(responseText);
      onUpdate({
        type: 'agent-step', step, phase: 'acting',
        thinking: parsed.thinking || '',
        actions: parsed.actions || [],
        label: parsed.thinking ? parsed.thinking.slice(0, 100) : 'Executing…',
      });

      if (!parsed.actions || parsed.actions.length === 0) {
        history.push({
          role: 'user',
          content: 'You did not provide any actions. Please analyze the page and provide your next action, or use "done" if the task is complete.',
        });
        continue;
      }

      // ── 5. Ask user before executing (if toggle is on) ──
      if (askBeforeActing && parsed.actions && parsed.actions.length > 0) {
        var hasDoneAction = parsed.actions.some(function (a) { return a.tool === 'done'; });
        if (!hasDoneAction) {
          var confirmed = await onAsk(currentTabId, parsed.actions, step);
          if (!confirmed) {
            session.cancel = true;
            lastSummary = 'Cancelled by user.';
            onUpdate({ type: 'agent-step', step, phase: 'error', label: 'Cancelled by user' });
            break;
          }
        }
      }
      if (session.cancel) break;

      // ── 6. Execute actions via CDP ──
      var isDone = false;
      for (var ai = 0; ai < parsed.actions.length; ai++) {
        var action = parsed.actions[ai];
        if (session.cancel) break;

        if (action.tool === 'done') {
          isDone = true;
          finished = true;
          lastSummary = action.summary || 'Task completed.';
          onUpdate({ type: 'agent-step', step, phase: 'done', label: lastSummary });
          break;
        }

        if (action.tool === 'navigate') {
          onUpdate({ type: 'agent-action', step, tool: 'navigate', label: 'Going to ' + action.url });
          try {
            await debug.navigateTab(currentTabId, action.url);
            await overlay(currentTabId, 'setup');
          } catch (err) {
            history.push({ role: 'user', content: 'Navigation failed: ' + err.message });
          }
          continue;
        }

        if (action.tool === 'wait') {
          var ms = Math.min(action.ms || 1000, 5000);
          onUpdate({ type: 'agent-action', step, tool: 'wait', label: 'Waiting ' + ms + 'ms…' });
          await new Promise(function (r) { setTimeout(r, ms); });
          continue;
        }

        if (action.tool === 'search') {
          onUpdate({ type: 'agent-action', step, tool: 'search', label: 'Searching for "' + (action.query || '').slice(0, 60) + '"…' });
          try {
            var result = await debug.searchWeb(currentTabId, action.query || '');
            await overlay(currentTabId, 'setup');
            history.push({ role: 'user', content: 'Search result: ' + JSON.stringify(result) });
          } catch (err) {
            history.push({ role: 'user', content: 'Search failed: ' + err.message });
          }
          continue;
        }

        if (action.tool === 'switchTab') {
          onUpdate({ type: 'agent-action', step, tool: 'switchTab', label: 'Switching tab…' });
          try {
            var groupTabs = groupId != null ? await chrome.tabs.query({ groupId: groupId }) : [];
            var targetTab = groupTabs[action.index];
            if (!targetTab) throw new Error('Tab index ' + action.index + ' not found (' + groupTabs.length + ' tabs in group)');
            await overlay(currentTabId, 'hide');
            await debug.detach(currentTabId);
            session.currentTabId = targetTab.id;
            currentTabId = targetTab.id;
            await chrome.tabs.update(currentTabId, { active: true });
            await debug.attach(currentTabId);
            await overlay(currentTabId, 'setup');
            history.push({ role: 'user', content: 'Switched to tab [' + action.index + ']: ' + targetTab.title });
          } catch (err) {
            history.push({ role: 'user', content: 'switchTab failed: ' + err.message });
          }
          continue;
        }

        var center = null;
        if (action.elementId && elementMap.has(action.elementId)) {
          var b = elementMap.get(action.elementId);
          center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        }

        if (center) {
          await overlay(currentTabId, 'moveTo', { x: center.x, y: center.y });
          await new Promise(r => setTimeout(r, 400));
          if (action.tool === 'click' || action.tool === 'select') {
            await overlay(currentTabId, 'ripple', { x: center.x, y: center.y });
            await new Promise(r => setTimeout(r, 200));
          }
        }

        try {
          var result = await debug.executeAction(currentTabId, action, elementMap);
          var label = result && result.ok ? result.result : (result && result.error ? result.error : 'Unknown error');
          onUpdate({ type: 'agent-action', step, tool: action.tool, label: label.slice(0, 100) });
          history.push({ role: 'user', content: 'Action "' + action.tool + '" result: ' + JSON.stringify(result) });
          await new Promise(function (r) { setTimeout(r, 300); });
        } catch (err) {
          onUpdate({ type: 'agent-action', step, tool: action.tool, label: 'Failed: ' + err.message });
          history.push({ role: 'user', content: 'Action "' + action.tool + '" threw error: ' + err.message });
        }
      }

      if (isDone || session.cancel) break;
      await new Promise(function (r) { setTimeout(r, 500); });
    }
  } finally {
    sessions.delete(tabId);
    await debug.detach(session.currentTabId);
  }

  await overlay(session.currentTabId, 'done', null);

  onUpdate({ type: 'agent-end', summary: lastSummary, steps: session.step + 1 });
  return { summary: lastSummary, steps: session.step + 1 };
}

/**
 * Cancel any running agent session for a tab.
 */
export function cancelAgent(tabId) {
  const s = sessions.get(tabId);
  if (s) {
    s.cancel = true;
    return true;
  }
  return false;
}

/**
 * Check if an agent is active on a tab.
 */
export function agentStatus(tabId) {
  const s = sessions.get(tabId);
  if (!s) return null;
  return { step: s.step, task: s.task, paused: !!s.paused };
}

export function pauseAgent(tabId) {
  const s = sessions.get(tabId);
  if (s) { s.paused = true; return true; }
  return false;
}

export function resumeAgent(tabId) {
  const s = sessions.get(tabId);
  if (s) { s.paused = false; return true; }
  return false;
}
