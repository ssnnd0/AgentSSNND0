import { KEYS, get, set, getModelForBackend, getPresets, getPreprompts, getSkills } from '../lib/keeper.js';
import { ensure, refresh } from '../lib/relay.js';
import { resolve } from '../lib/backends.js';
import { pool, foot, inp, inpShell, go, badge, presetBar, agentPill, anonToggle, anonWarn } from './dom.js';
import * as S from './state.js';

export function clearHint() {
  const h = pool.querySelector('.hint');
  if (h) h.remove();
}

export function md(text) {
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let html = esc(text);
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code>${esc(code.trim())}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return '<p>' + html + '</p>';
}

export function add(content, cls) {
  clearHint();
  const el = document.createElement('div');
  el.className = 'bubble ' + cls;
  if (cls === 'other' || cls === 'me') el.innerHTML = md(content);
  else el.textContent = content;
  pool.appendChild(el);
  pool.scrollTop = pool.scrollHeight;
  return el;
}

export function addSys(m) {
  add(m, 'sysmsg');
}

export function dots(on) {
  const ex = document.getElementById('dots');
  if (ex) ex.remove();
  if (!on) return;
  clearHint();
  const e = document.createElement('div');
  e.id = 'dots'; e.className = 'bubble other';
  e.innerHTML = '<div class="three-dots"><span></span><span></span><span></span></div>';
  pool.appendChild(e); pool.scrollTop = pool.scrollHeight;
}

export function resizeInp() {
  inp.style.height = 'auto';
  inp.style.height = inp.scrollHeight + 'px';
}

export function updateGoBtn() {
  if (S.busy) { go.disabled = true; go.classList.remove('ready'); return; }
  if (inp.value.trim().length > 0) {
    go.classList.add('ready');
    go.disabled = false;
  } else {
    go.classList.remove('ready');
    go.disabled = true;
  }
}

export function toggleAgentMode() {
  var isAgent = S.mode === 'agent';
  var newMode = isAgent ? 'chat' : 'agent';
  S.setMode(newMode);
  agentPill.classList.toggle('agent-on', !isAgent);
  inpShell.classList.toggle('agent', !isAgent);
  document.body.classList.toggle('agent-mode', !isAgent);
  inp.placeholder = !isAgent
    ? 'Describe a task for the agent to do on this tab\u2026'
    : 'Message\u2026';
  if (!isAgent) {
    /* Entering agent mode — ensure tab is grouped */
    chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      if (tabs[0]) {
        chrome.runtime.sendMessage({ type: 'AGENT_MODE_ACTIVATE', tabId: tabs[0].id }).catch(function () {});
      }
    }).catch(function () {});
  }
}

export function toggleAnon() {
  const newState = !S.anon;
  S.setAnon(newState);
  const textEl = anonToggle.querySelector('.anon-text');
  if (newState) {
    anonToggle.classList.add('danger');
    if (textEl) textEl.textContent = 'Anon';
    anonWarn.classList.add('show');
    addSys('Warning: Anonymous agent can access all personal data');
  } else {
    anonToggle.classList.remove('danger');
    if (textEl) textEl.textContent = 'Ask';
    anonWarn.classList.remove('show');
  }
}

export function renderPresets() {
  presetBar.innerHTML = '';
  S.presetsList.forEach(p => {
    const c = document.createElement('span');
    c.className = 'preset-chip'; c.textContent = p.name; c.title = p.desc || '';
    c.addEventListener('click', () => applyPreset(p));
    presetBar.appendChild(c);
  });
}

export async function applyPreset(p) {
  const parts = [];
  if (p.preamble) parts.push('sys\xB7' + p.preamble.slice(0,40) + '\u2026');
  if (p.temp != null) parts.push('T' + p.temp);
  if (p.model) parts.push(p.model);
  addSys('Preset "' + p.name + '" \u2192 ' + parts.join('  '));
  if (p.preamble) await set(KEYS.preamble, p.preamble);
  if (p.temp != null) await set(KEYS.temperature, p.temp);
  if (p.model) await set(KEYS.model, p.model);
  await refresh();
}

export async function sync() {
  const cfg = await ensure();
  S.setCurrent(cfg.id);
  const b = resolve(cfg.id);
  const saved = await getModelForBackend(cfg.id) || cfg.model || b.fallback;
  badge.textContent = saved;
  S.setCurrentModel(saved);
  S.allModels[cfg.id] = b.models;
  const [sks, pps, prs] = await Promise.all([
    getSkills(), getPreprompts(), getPresets()
  ]);
  S.setSkillsList(sks);
  S.setPrepromptsList(pps);
  S.setPresetsList(prs);
  renderPresets();
}

export function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function stepRow(stepNum, thinking) {
  const row = document.createElement('div');
  row.className = 'step active';
  row.innerHTML =
    '<div class="rail"><div class="node"></div><div class="line"></div></div>' +
    '<div class="body"><div class="phase">Step ' + stepNum + '</div><div class="txt"></div></div>';
  if (thinking) row.querySelector('.txt').textContent = thinking;
  return row;
}

var TOOLS_HTML = '<div class="tools-bar">' +
  '<span class="tool-tag" title="Click an element">click</span>' +
  '<span class="tool-tag" title="Type into an input">type</span>' +
  '<span class="tool-tag" title="Select a dropdown option">select</span>' +
  '<span class="tool-tag" title="Scroll the page">scroll</span>' +
  '<span class="tool-tag" title="Navigate to a URL">navigate</span>' +
  '<span class="tool-tag" title="Search the web via DuckDuckGo">search</span>' +
  '<span class="tool-tag" title="Wait for page to load">wait</span>' +
  '<span class="tool-tag" title="Press a keyboard key">keypress</span>' +
  '<span class="tool-tag" title="Extract text from element">extract</span>' +
  '<span class="tool-tag" title="Switch browser tab">switchTab</span>' +
  '<span class="tool-tag" title="Mark task done">done</span>' +
  '</div>';

export function buildRunCard(tabId, task) {
  clearHint();
  const card = document.createElement('div');
  card.className = 'run-card';
  card.innerHTML =
    '<div class="run-head">' +
    '  <span class="run-pulse"></span>' +
    '  <span class="run-title"></span>' +
    '  <button class="run-pause" data-paused="0" title="Pause agent">Pause</button>' +
    '  <button class="run-stop">Cancel</button>' +
    ' </div>' +
    ' <div class="run-screenshot"></div>' +
    ' <div class="run-steps"></div>' +
    TOOLS_HTML +
    ' <div class="run-foot"></div>';
  card.querySelector('.run-title').textContent = task;
  const stopBtn = card.querySelector('.run-stop');
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'AGENT_CANCEL', tabId }).catch(() => {});
    stopBtn.disabled = true; stopBtn.textContent = 'Stopping\u2026';
  });
  const pauseBtn = card.querySelector('.run-pause');
  pauseBtn.addEventListener('click', () => {
    const paused = pauseBtn.dataset.paused === '1';
    if (paused) {
      chrome.runtime.sendMessage({ type: 'AGENT_RESUME', tabId }).catch(() => {});
    } else {
      chrome.runtime.sendMessage({ type: 'AGENT_PAUSE', tabId }).catch(() => {});
    }
  });
  pool.appendChild(card);
  pool.scrollTop = pool.scrollHeight;
  const ref = { card, steps: card.querySelector('.run-steps'), stop: stopBtn, pause: pauseBtn,
                foot: card.querySelector('.run-foot'), pulse: card.querySelector('.run-pulse'),
                shot: card.querySelector('.run-screenshot'),
                lastStep: -1, stepEl: null };
  S.runCards.set(tabId, ref);
  return ref;
}

export function handleAgentUpdate(tabId, u) {
  let ref = S.runCards.get(tabId);
  if (!ref && u.type !== 'agent-start') return;

  switch (u.type) {
    case 'agent-start': break;

    case 'agent-screenshot': {
      if (!ref || !ref.shot) return;
      ref.shot.innerHTML = '';
      var img = document.createElement('img');
      img.className = 'shot-thumb';
      img.src = 'data:' + (u.mimeType || 'image/jpeg') + ';base64,' + u.data;
      img.alt = 'Screenshot';
      img.title = 'Click to open full screenshot in new tab';
      img.addEventListener('click', function () {
        window.open(img.src, '_blank');
      });
      ref.shot.appendChild(img);
      break;
    }

    case 'agent-thinking': {
      if (!ref || !ref.stepEl) return;
      var txtEl = ref.stepEl.querySelector('.txt');
      if (txtEl) {
        txtEl.textContent = u.text || '';
        txtEl.classList.add('think');
        ref.steps.scrollTop = ref.steps.scrollHeight;
      }
      break;
    }

    case 'agent-paused': {
      if (ref && ref.pause) {
        ref.pause.dataset.paused = '1';
        ref.pause.textContent = 'Resume';
        ref.pause.title = 'Resume agent';
      }
      break;
    }

    case 'agent-resumed': {
      if (ref && ref.pause) {
        ref.pause.dataset.paused = '0';
        ref.pause.textContent = 'Pause';
        ref.pause.title = 'Pause agent';
      }
      break;
    }

    case 'agent-step': {
      if (!ref) return;
      if (ref.stepEl) ref.stepEl.classList.remove('active');
      if (u.step !== ref.lastStep) {
        ref.lastStep = u.step;
        ref.stepEl = stepRow(u.step + 1, u.thinking || '');
        ref.steps.appendChild(ref.stepEl);
      } else if (ref.stepEl) {
        ref.stepEl.querySelector('.phase').textContent = 'Step ' + (u.step + 1);
        ref.stepEl.querySelector('.txt').textContent = u.thinking || u.label || '';
        ref.stepEl.classList.add('active');
      }
      if (u.phase === 'error') ref.stepEl?.classList.add('error');
      if (u.phase === 'done') ref.stepEl?.classList.add('done');
      ref.steps.scrollTop = ref.steps.scrollHeight;
      break;
    }

    case 'agent-action': {
      if (!ref || !ref.stepEl) return;
      const tag = document.createElement('div');
      tag.className = 'act';
      tag.innerHTML = '<b>' + (u.tool || '') + '</b> ' + (u.label || '').replace(/</g,'&lt;');
      ref.stepEl.querySelector('.body').appendChild(tag);
      ref.steps.scrollTop = ref.steps.scrollHeight;
      break;
    }

    case 'agent-cancelled':
      if (ref) { ref.pulse.classList.add('bad'); ref.stepEl?.classList.add('error'); }
      break;

    case 'agent-end': {
      if (ref) {
        if (ref.stepEl) ref.stepEl.classList.remove('active');
        const ok = !/cancel|fail|error|crash|stopped/i.test(u.summary || '') && /complete|done/i.test(u.summary || '');
        ref.pulse.classList.add(ok ? 'ok' : 'bad');
        ref.stepEl?.classList.add(ok ? 'done' : 'error');
        ref.stop.disabled = true; ref.stop.textContent = ok ? 'Done' : 'Ended';
        ref.pause.disabled = true; ref.pause.style.display = 'none';
        ref.foot.textContent = u.summary || 'Finished.';
        ref.foot.classList.add('show', ok ? 'ok' : 'bad');
        ref.steps.scrollTop = ref.steps.scrollHeight;
      }
      pool.scrollTop = pool.scrollHeight;
      S.setAgentStartTime(0);
      S.setBusy(false); updateGoBtn();
      try { chrome.runtime.sendMessage({ type: 'BEEP' }).catch(() => {}); } catch {}
      break;
    }
  }
}

export function showAskDialog(tabId, actions, step) {
  if (S.askCard) return;
  const card = document.createElement('div');
  card.className = 'ask-card';
  let html =
    '<div class="ask-hdr">Confirm action' + (actions.length > 1 ? 's' : '') + ' <span class="ask-step">Step ' + (step + 1) + '</span></div>' +
    '<div class="ask-body">';
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    let desc = a.tool;
    if (a.elementId) desc += ' \u2192 ' + a.elementId;
    if (a.text) desc += ' "' + a.text.slice(0, 60) + '"';
    if (a.url) desc += ' ' + a.url.slice(0, 80);
    html += '<div class="ask-act"><span class="ask-tag">' + a.tool + '</span> ' + escHtml(desc) + '</div>';
  }
  html +=
    '</div>' +
    '<div class="ask-actions">' +
    '<button class="ask-btn ask-cancel" data-ok="0">Cancel</button>' +
    '<button class="ask-btn ask-confirm" data-ok="1">Confirm</button>' +
    '</div>';
  card.innerHTML = html;
  card.querySelector('.ask-cancel').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'AGENT_RESPOND', tabId, decision: 'cancel' }).catch(function () {});
    card.remove(); S.setAskCard(null);
  });
  card.querySelector('.ask-confirm').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'AGENT_RESPOND', tabId, decision: 'confirm' }).catch(function () {});
    card.remove(); S.setAskCard(null);
  });
  foot.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  S.setAskCard(card);
}
