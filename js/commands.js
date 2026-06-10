import { inp, foot, cmdOverlay, ovBody, ovDetail, ovCnt, pool, badge } from './dom.js';
import * as S from './state.js';
import { KEYS, get, set, getPresets, savePreset, getPreprompts, getSkills, setModelForBackend } from '../lib/keeper.js';
import { ensure, refresh } from '../lib/relay.js';
import { BACKENDS } from '../lib/backends.js';
import { add, addSys, updateGoBtn, resizeInp, toggleAgentMode, renderPresets, clearHint, applyPreset, sync } from './ui.js';

export function getCmds(filterText) {
  const ft = (filterText || '').toLowerCase().trim();
  const out = [];
  const addC = (cmd, icon, desc, group, extra) => out.push({ cmd, icon, desc, group, ...extra });

  const spaceIdx = ft.indexOf(' ');
  if (spaceIdx > 0) {
    const baseCmd = ft.slice(0, spaceIdx);
    const partial = ft.slice(spaceIdx + 1);
    if (baseCmd === 'preset') {
      S.presetsList.filter(p => p.name.toLowerCase().includes(partial))
        .forEach(p => addC(p.name, '\u25A4', (p.desc || '').slice(0, 50), 'presets', { token: '/preset ' + p.name + ' ', run: () => runCommand('preset', p.name) }));
      return out;
    }
    if (baseCmd === 'preprompt') {
      S.prepromptsList.filter(pp => pp.name.toLowerCase().includes(partial))
        .forEach(pp => addC(pp.name, 'P', (pp.content || '').slice(0, 50), 'preprompts', { token: '/preprompt ' + pp.name + ' ', run: () => runCommand('preprompt', pp.name) }));
      return out;
    }
    if (baseCmd === 'skill') {
      S.skillsList.filter(s => s.name.toLowerCase().includes(partial))
        .forEach(s => addC(s.name, s.icon || '\u26A1', (s.prompt || '').slice(0, 50), 'skills', { token: '/skill ' + s.name + ' ', run: () => { inp.value = s.prompt || ''; inp.focus(); resizeInp(); updateGoBtn(); addSys('Skill "' + s.name + '" loaded.'); } }));
      return out;
    }
    if (baseCmd === 'provider') {
      Object.keys(BACKENDS).filter(function (k) { return k.includes(partial) || BACKENDS[k].label.toLowerCase().includes(partial); })
        .forEach(function (k) { return addC(k, '\u2699', BACKENDS[k].label, 'providers', { token: '/provider ' + k + ' ', run: function () { runCommand('provider', k); } }); });
      return out;
    }
  }

  addC('agent', '\u25C6', 'Switch to agent mode', 'mode', { run: () => runCommand('agent', '') });
  addC('chat', '\u25C7', 'Switch to chat mode', 'mode', { run: () => runCommand('chat', '') });
  addC('clear', '\u232B', 'Clear conversation', 'built-in', { run: () => runCommand('clear', '') });
  addC('temp', 'T', 'Set temperature \u2014 /temp <0-2>', 'built-in', { run: () => runCommand('temp', '') });
  addC('preset', '\u25A4', 'Load a preset \u2014 /preset <name>', 'built-in', { run: () => runCommand('preset', '') });
  addC('save', '+', 'Save current as preset \u2014 /save <name>', 'built-in', { run: () => runCommand('save', '') });
  addC('preprompt', 'P', 'Activate a preprompt \u2014 /preprompt <name>', 'built-in', { run: () => runCommand('preprompt', '') });
  addC('skill', '\u26A1', 'Load a skill \u2014 /skill <name>', 'built-in', { run: () => runCommand('skill', '') });
  addC('skills', '\u26A1', 'List all skills', 'built-in', { run: () => runCommand('skills', '') });
  addC('provider', '\u2699', 'Switch provider and model \u2014 /provider', 'built-in', { run: () => runCommand('provider', '') });
  addC('help', '?', 'Open this palette', 'built-in', { run: () => openOverlay('', S.slashStart) });

  S.skillsList.forEach(s =>
    addC(s.name, s.icon || '\u26A1', (s.prompt || '').slice(0, 60), 'skills',
      { run: () => { inp.value = s.prompt || ''; inp.focus(); resizeInp(); updateGoBtn(); addSys('Skill "' + s.name + '" loaded.'); } }));

  if (ft) return out.filter(i => i.cmd.toLowerCase().includes(ft));
  return out;
}

export function renderOverlay(filter) {
  const all = getCmds(filter);
  S.setOvItems(all);
  S.setOvIdx(all.length ? 0 : -1);
  ovBody.innerHTML = '';
  ovCnt.textContent = all.length;

  if (!all.length) { ovBody.innerHTML = '<div class="ov-empty">No matching commands</div>'; return; }

  let lastGroup = '';
  all.forEach((item, i) => {
    if (item.group !== lastGroup) {
      lastGroup = item.group;
      const h = document.createElement('div');
      h.className = 'ov-hdr-s'; h.textContent = item.group;
      ovBody.appendChild(h);
    }
    const div = document.createElement('div');
    div.className = 'ov-item' + (i === S.ovIdx ? ' sel' : '');
    div.innerHTML = '<span class="i-icon">' + item.icon + '</span><span class="i-label">' + item.cmd + '</span><span class="i-desc">' + item.desc + '</span>';
    div.addEventListener('click', () => selectOv(i));
    div.addEventListener('mouseenter', () => { S.setOvIdx(i); markSel(); });
    ovBody.appendChild(div);
  });
  renderDetail(S.ovIdx);
}

export function markSel() {
  ovBody.querySelectorAll('.ov-item').forEach((el, j) => el.classList.toggle('sel', j === S.ovIdx));
  renderDetail(S.ovIdx);
}

function getArgItems(cmd) {
  switch (cmd) {
    case 'temp': return [
      { label: '0.0', value: '0' },
      { label: '0.5', value: '0.5' },
      { label: '0.7', value: '0.7' },
      { label: '1.0', value: '1' },
      { label: '1.5', value: '1.5' },
      { label: '2.0', value: '2' },
    ];
    case 'preset': return S.presetsList.map(function (p) {
      return { label: p.name, value: p.name };
    });
    case 'preprompt': return S.prepromptsList.map(function (pp) {
      return { label: pp.name, value: pp.name };
    });
    case 'skill': return S.skillsList.map(function (s) {
      return { label: s.name, value: s.name };
    });
    case 'provider': return Object.keys(BACKENDS).map(function (k) {
      return { label: BACKENDS[k].label + ' (' + k + ')', value: k };
    });
    default: return [];
  }
}

function detectBackend(modelName) {
  if (modelName.indexOf('/') > 0) return 'openrouter';
  var found = null;
  Object.keys(BACKENDS).some(function (id) {
    var b = BACKENDS[id];
    if (b.models && b.models.indexOf(modelName) >= 0) { found = id; return true; }
    return false;
  });
  if (found) return found;
  if (/^gpt\b|^o1\b|^o3\b/i.test(modelName)) return 'openai';
  if (/^claude/i.test(modelName)) return 'anthropic';
  if (/^gemini/i.test(modelName)) return 'gemini';
  if (/^deepseek/i.test(modelName)) return 'deepseek';
  if (/^mistral/i.test(modelName)) return 'mistral';
  if (/^grok/i.test(modelName)) return 'openrouter';
  return null;
}

function renderDetail(idx) {
  ovDetail.innerHTML = '';
  if (idx < 0 || idx >= S.ovItems.length) return;
  var item = S.ovItems[idx];
  var args = getArgItems(item.cmd);
  if (!args.length) return;

  var partial = '';
  var hasSpace = false;
  if (S.slashStart >= 0) {
    var afterSlash = inp.value.slice(S.slashStart + 1);
    var si = afterSlash.indexOf(' ');
    if (si >= 0) { hasSpace = true; partial = afterSlash.slice(si + 1); }
  }
  if (!hasSpace) return;
  if (partial) {
    var lower = partial.toLowerCase();
    args = args.filter(function (a) {
      return a.value.toLowerCase().includes(lower) || a.label.toLowerCase().includes(lower);
    });
  }

  args.forEach(function (a) {
    var chip = document.createElement('span');
    chip.className = 'ov-arg';
    chip.textContent = a.label;
    chip.addEventListener('click', function () {
      applyToken('/' + item.cmd + ' ' + a.value + ' ');
      closeOverlay();
      inp.focus();
      resizeInp();
      updateGoBtn();
    });
    ovDetail.appendChild(chip);
  });
}

export function applyToken(text) {
  if (S.slashStart < 0) { inp.value = ''; return; }
  const before = inp.value.slice(0, S.slashStart);
  inp.value = before + text;
  resizeInp();
  updateGoBtn();
}

export function selectOv(idx) {
  const item = S.ovItems[idx];
  if (!item) return;
  closeOverlay();
  applyToken('');
  inp.focus();
  item.run();
}

export function openOverlay(filter, startIdx) {
  S.setOvOpen(true);
  S.setSlashStart(startIdx != null ? startIdx : S.slashStart);
  cmdOverlay.classList.add('show');
  renderOverlay(filter || '');
}

export function closeOverlay() {
  S.setOvOpen(false);
  cmdOverlay.classList.remove('show');
  ovDetail.innerHTML = '';
  S.setOvIdx(-1); S.setSlashStart(-1);
}

export function navOv(dir) {
  const items = ovBody.querySelectorAll('.ov-item');
  if (!items.length) return;
  const newIdx = dir === 'down' ? Math.min(S.ovIdx + 1, items.length - 1) : Math.max(S.ovIdx - 1, 0);
  S.setOvIdx(newIdx);
  markSel();
  items[newIdx]?.scrollIntoView({ block: 'nearest' });
}

export function detectSlash() {
  const v = inp.value;
  const pos = inp.selectionStart;
  if (pos == null) return;

  let i = pos - 1;
  while (i >= 0 && !/\s/.test(v[i])) i--;
  const tokenStart = i + 1;

  const charBefore = tokenStart > 0 ? v[tokenStart - 1] : '';
  const validLead = tokenStart === 0 || /\s/.test(charBefore);

  if (validLead && v.startsWith('/', tokenStart)) {
    S.setSlashStart(tokenStart);
    const filter = v.slice(tokenStart + 1, pos);
    if (!S.ovOpen) openOverlay(filter, tokenStart);
    else renderOverlay(filter);
  } else if (S.ovOpen) {
    closeOverlay();
  }
}

export function runCommand(cmd, args) {
  switch (cmd) {
    case 'help': openOverlay('', 0); break;
    case 'agent': if (S.mode !== 'agent') toggleAgentMode(); addSys('Agent mode on.'); break;
    case 'chat': if (S.mode !== 'chat') toggleAgentMode(); addSys('Chat mode on.'); break;
    case 'clear': S.setThread([]); pool.innerHTML = ''; S.setRunCards(new Map()); add('Conversation cleared.', 'sysmsg'); break;
    case 'model':
      if (args) {
        var backendId = detectBackend(args);
        if (backendId && backendId !== S.current) {
          (async function () {
            await set(KEYS.backend, backendId);
            await refresh();
            S.setCurrent(backendId);
            setModelForBackend(backendId, args);
            await set(KEYS.model, args);
            S.setCurrentModel(args);
            badge.textContent = args;
            addSys('Provider \u2192 ' + BACKENDS[backendId].label + ' \xB7 Model \u2192 ' + args);
          })();
        } else {
          S.setCurrentModel(args);
          setModelForBackend(S.current, args);
          set(KEYS.model, args);
          badge.textContent = args;
          addSys('Model \u2192 ' + args);
        }
      }
      else add('Model: ' + S.currentModel, 'other');
      break;
    case 'temp':
      if (args) { const t = parseFloat(args); if (t >= 0 && t <= 2) { set(KEYS.temperature, t); addSys('Temp \u2192 ' + t); } else add('Temp must be 0\u20132', 'err'); }
      else add('Usage: /temp <0-2>', 'err');
      break;
    case 'preset':
      if (args) { const p = S.presetsList.find(pr => pr.name.toLowerCase() === args.toLowerCase()); if (p) applyPreset(p); else add('Preset "' + args + '" not found', 'err'); }
      else add(S.presetsList.length ? 'Presets: ' + S.presetsList.map(p => p.name).join(', ') : 'No presets saved', 'other');
      break;
    case 'save':
      if (!args) { add('Usage: /save <name>', 'err'); break; }
      (async () => {
        const cfg = await ensure();
        await savePreset(args, { preamble: cfg.preamble, temp: cfg.temp, model: cfg.model, desc: 'Saved ' + new Date().toLocaleString() });
        S.setPresetsList(await getPresets());
        renderPresets();
        addSys('Preset "' + args + '" saved.');
      })();
      break;
    case 'preprompt':
      if (args) { const pp = S.prepromptsList.find(p => p.name.toLowerCase() === args.toLowerCase()); if (pp) { set(KEYS.activePreprompt, pp.name); addSys('Preprompt \u2192 "' + pp.name + '"'); refresh(); } else add('Not found: ' + args, 'err'); }
      else add(S.prepromptsList.length ? 'Preprompts: ' + S.prepromptsList.map(p => p.name).join(', ') : 'No preprompts', 'other');
      break;
    case 'skill':
      if (args) { const sk = S.skillsList.find(s => s.name.toLowerCase() === args.toLowerCase()); if (sk) { inp.value = sk.prompt; inp.focus(); resizeInp(); updateGoBtn(); addSys('Skill "' + sk.name + '" loaded.'); } else add('Skill "' + args + '" not found', 'err'); }
      else add('Usage: /skill <name>', 'err');
      break;
    case 'provider':
      if (args) {
        var pid = args.toLowerCase();
        var match = Object.keys(BACKENDS).find(function (k) { return k === pid || BACKENDS[k].label.toLowerCase() === pid; }) || null;
        if (match) {
          (async function () {
            await set(KEYS.backend, match);
            await refresh();
            S.setCurrent(match);
            var b = BACKENDS[match];
            var mdl = b.models && b.models[0] ? b.models[0] : b.fallback;
            S.setCurrentModel(mdl);
            setModelForBackend(match, mdl);
            await set(KEYS.model, mdl);
            badge.textContent = mdl;
            addSys('Provider \u2192 ' + b.label + ' \xB7 Model \u2192 ' + mdl);
          })();
        } else {
          add('Unknown provider "' + args + '". Try: ' + Object.keys(BACKENDS).join(', '), 'err');
        }
      } else {
        showProviderSelector();
      }
      break;
    case 'skills':
      add(S.skillsList.length ? 'Skills: ' + S.skillsList.map(s => (s.icon || '\u2192') + ' ' + s.name).join(', ') : 'No skills', 'other');
      break;
    default: {
      const sk = S.skillsList.find(s => s.name.toLowerCase() === cmd.toLowerCase());
      if (sk) { inp.value = sk.prompt || ''; inp.focus(); resizeInp(); updateGoBtn(); addSys('Skill "' + sk.name + '" loaded.'); }
      else add('Unknown command: /' + cmd + '. Press / to browse.', 'err');
    }
  }
}

export function showProviderSelector() {
  const curId = S.current;
  const curModel = S.currentModel;

  const existing = document.getElementById('providerCard');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.id = 'providerCard';
  card.className = 'provider-card';

  let html = '<div class="pc-hdr">Select provider &amp; model</div><div class="pc-providers">';

  Object.keys(BACKENDS).forEach(function (id) {
    const b = BACKENDS[id];
    const active = id === curId ? ' active' : '';
    html += '<div class="pc-prov' + active + '" data-id="' + id + '">' + (b.label || id) + '</div>';
  });

  html += '</div><div class="pc-models" id="pcModels">';
  (BACKENDS[curId]?.models || []).forEach(function (m) {
    const active = m === curModel ? ' active' : '';
    html += '<div class="pc-model' + active + '" data-model="' + m.replace(/"/g, '&quot;') + '">' + m.replace(/"/g, '&quot;') + '</div>';
  });
  html += '</div><div class="pc-close">Close</div>';

  card.innerHTML = html;

  card.querySelectorAll('.pc-prov').forEach(function (el) {
    el.addEventListener('click', async function () {
      const id = el.dataset.id;
      await set(KEYS.backend, id);
      await refresh();
      S.setCurrent(id);
      card.querySelectorAll('.pc-prov').forEach(function (p) { p.classList.remove('active'); });
      el.classList.add('active');
      const modelsEl = card.querySelector('#pcModels');
      modelsEl.innerHTML = '';
      (BACKENDS[id]?.models || []).forEach(function (m) {
        const me = document.createElement('div');
        me.className = 'pc-model' + (m === (S.currentModel) ? ' active' : '');
        me.dataset.model = m;
        me.textContent = m;
        me.addEventListener('click', onModelClick);
        modelsEl.appendChild(me);
      });
      await sync();
    });
  });

  function onModelClick() {
    const model = this.dataset.model;
    (async function () {
      await setModelForBackend(S.current, model);
      await set(KEYS.model, model);
      S.setCurrentModel(model);
      badge.textContent = model;
      await refresh();
      await sync();
      addSys('Model \u2192 ' + model);
      card.remove();
    })();
  }

  card.querySelectorAll('.pc-model').forEach(function (el) {
    el.addEventListener('click', onModelClick);
  });

  card.querySelector('.pc-close').addEventListener('click', function () {
    card.remove();
  });

  foot.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
