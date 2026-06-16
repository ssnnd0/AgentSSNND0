import { BACKENDS, resolve, buildUrl } from '../lib/backends.js';
import { KEYS, get, set, remove, mget } from '../lib/keeper.js';

document.addEventListener('DOMContentLoaded', function () {

var $ = function (id) { return document.getElementById(id); };

var backend  = $('backend');
var gateway  = $('gateway');
var secret   = $('secret');
var model    = $('model');
var preamble = $('preamble');
var temperature = $('temperature');
var maxTokens = $('maxTokens');
var defGw    = $('defGw');
var docs     = $('docs');
var avail    = $('avail');
var toast    = $('toast');
var keyStatus = $('keyStatus');
var connResult = $('connResult');
var endpointDisplay = $('endpointDisplay');
var testConn = $('testConn');

var agentAskToggle = $('agentAskToggle');
var agentScreenshotsCb = $('agentScreenshots');
var agentMaxStepsInp = $('agentMaxSteps');

var ppName    = $('ppName');
var ppContent = $('ppContent');
var skName    = $('skName');
var skIcon    = $('skIcon');
var skPrompt  = $('skPrompt');

var prepromptList = $('prepromptList');
var skillList     = $('skillList');
var presetList    = $('presetList');

function msg(text, type) {
  toast.textContent = text;
  toast.className = 'toast ' + type;
  setTimeout(function () { toast.className = 'toast'; }, 3000);
}

function updateKeyStatus() {
  var val = secret.value.trim();
  keyStatus.textContent = val ? '\u2713 configured' : '\u2717 not set';
  keyStatus.style.color = val ? '#16a34a' : '#ef4444';
}

function updateEndpointDisplay() {
  var id = backend.value;
  var b = resolve(id);
  var gw = gateway.value.trim() || b.gateway;
  var mdl = model.value || b.fallback;
  try {
    var url = buildUrl(id, gateway.value.trim(), mdl);
    endpointDisplay.textContent = '\u2192 ' + url;
  } catch (e) {
    endpointDisplay.textContent = '\u2192 (invalid configuration)';
  }
}

function populateBackends() {
  backend.innerHTML = '';
  Object.entries(BACKENDS).forEach(function (entry) {
    var o = document.createElement('option');
    o.value = entry[0];
    o.textContent = entry[1].label;
    backend.appendChild(o);
  });
}

function populateModels() {
  var id = backend.value;
  var b = resolve(id);
  defGw.textContent = '(default: ' + b.gateway + ')';
  model.innerHTML = '';
  b.models.forEach(function (m) {
    var o = document.createElement('option');
    o.value = m;
    o.textContent = m;
    model.appendChild(o);
  });
  avail.innerHTML = b.models.map(function (m) { return '<span class="tag">' + m + '</span>'; }).join('');
  docs.textContent = '';
  updateEndpointDisplay();
}

backend.addEventListener('change', populateModels);
gateway.addEventListener('input', updateEndpointDisplay);
secret.addEventListener('input', updateKeyStatus);
model.addEventListener('change', updateEndpointDisplay);

document.querySelectorAll('.tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
    tab.classList.add('active');
    $('tab-' + tab.dataset.tab).classList.add('active');
  });
});

testConn.addEventListener('click', async function () {
  var id = backend.value;
  var gw = gateway.value.trim();
  var sec = secret.value.trim();
  var mdl = model.value;
  if (!sec) { connResult.textContent = '\u2717 Enter a secret key first'; connResult.style.color = '#ef4444'; return; }

  testConn.disabled = true;
  testConn.textContent = 'Testing\u2026';
  connResult.textContent = '';

  try {
    var response = await chrome.runtime.sendMessage({
      type: 'TEST_CONNECTION',
      backend: id,
      gateway: gw,
      secret: sec,
      model: mdl,
    });

    if (response && response.success) {
      connResult.textContent = '\u2713 Connection successful';
      connResult.style.color = '#16a34a';
    } else {
      connResult.textContent = '\u2717 ' + (response && response.error || 'Connection failed');
      connResult.style.color = '#ef4444';
    }
  } catch (err) {
    connResult.textContent = '\u2717 ' + err.message;
    connResult.style.color = '#ef4444';
  } finally {
    testConn.disabled = false;
    testConn.textContent = 'Test Connection';
  }
});

async function loadPreprompts() {
  var list = (await get(KEYS.preprompts)) || [];
  prepromptList.innerHTML = '';
  if (!list.length) { prepromptList.innerHTML = '<p class="hint">No preprompts yet.</p>'; return; }
  list.forEach(function (p) {
    var div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML =
      '<div class="info">' +
        '<div class="name">' + p.name + '</div>' +
        '<div class="meta">' + ((p.content || '').slice(0, 80) + ((p.content||'').length > 80 ? '...' : '')) + '</div>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="mini-btn load" data-name="' + p.name + '">Load</button>' +
        '<button class="mini-btn del" data-name="' + p.name + '">Delete</button>' +
      '</div>';
    div.querySelector('.mini-btn.load').addEventListener('click', function () {
      ppName.value = p.name;
      ppContent.value = p.content;
    });
    div.querySelector('.mini-btn.del').addEventListener('click', async function () {
      var keep = await import('../lib/keeper.js');
      await keep.deletePreprompt(p.name);
      await loadPreprompts();
      msg('Deleted.', 'ok');
    });
    prepromptList.appendChild(div);
  });
}

async function loadSkills() {
  var list = (await get(KEYS.skills)) || [];
  skillList.innerHTML = '';
  if (!list.length) { skillList.innerHTML = '<p class="hint">No skills yet.</p>'; return; }
  list.forEach(function (s) {
    var div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML =
      '<div class="info">' +
        '<div class="name">' + (s.icon || '\u2192') + ' ' + s.name + '</div>' +
        '<div class="meta">' + ((s.prompt || '').slice(0, 80) + ((s.prompt||'').length > 80 ? '...' : '')) + '</div>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="mini-btn load" data-name="' + s.name + '">Edit</button>' +
        '<button class="mini-btn del" data-name="' + s.name + '">Delete</button>' +
      '</div>';
    div.querySelector('.mini-btn.load').addEventListener('click', function () {
      skName.value = s.name;
      skIcon.value = s.icon || '';
      skPrompt.value = s.prompt || '';
    });
    div.querySelector('.mini-btn.del').addEventListener('click', async function () {
      var keep = await import('../lib/keeper.js');
      await keep.deleteSkill(s.name);
      await loadSkills();
      msg('Deleted.', 'ok');
    });
    skillList.appendChild(div);
  });
}

async function loadPresets() {
  var list = (await get(KEYS.presets)) || [];
  presetList.innerHTML = '';
  if (!list.length) { presetList.innerHTML = '<p class="hint">No presets yet. Use /save in the panel.</p>'; return; }
  list.forEach(function (p) {
    var div = document.createElement('div');
    div.className = 'list-item';
    var info = [p.model, p.temp ? ('temp ' + p.temp) : '', p.preamble ? 'has prompt' : ''].filter(Boolean).join(', ');
    div.innerHTML =
      '<div class="info">' +
        '<div class="name">' + p.name + '</div>' +
        '<div class="meta">' + (info || 'empty preset') + '</div>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="mini-btn del" data-name="' + p.name + '">Delete</button>' +
      '</div>';
    div.querySelector('.mini-btn.del').addEventListener('click', async function () {
      var keep = await import('../lib/keeper.js');
      await keep.deletePreset(p.name);
      await loadPresets();
      msg('Deleted.', 'ok');
    });
    presetList.appendChild(div);
  });
}

async function loadSettings() {
  var cfg = await mget([
    KEYS.backend, KEYS.customGw, KEYS.secret, KEYS.model, KEYS.preamble,
    KEYS.temperature, KEYS.maxTokens, KEYS.agentScreenshots, KEYS.agentMaxSteps,
    KEYS.askBeforeActing,
  ]);
  backend.value = cfg[KEYS.backend] || 'openrouter';
  populateModels();
  if (cfg[KEYS.model]) model.value = cfg[KEYS.model];
  gateway.value = cfg[KEYS.customGw] || '';
  secret.value = cfg[KEYS.secret] || '';
  preamble.value = cfg[KEYS.preamble] || '';
  temperature.value = cfg[KEYS.temperature] ?? '';
  maxTokens.value = cfg[KEYS.maxTokens] ?? '';
  agentAskToggle.checked = cfg[KEYS.askBeforeActing] === true;
  agentScreenshotsCb.checked = cfg[KEYS.agentScreenshots] !== false;
  agentMaxStepsInp.value = cfg[KEYS.agentMaxSteps] ?? '';
  updateKeyStatus();
  updateEndpointDisplay();
  await loadPreprompts();
  await loadSkills();
  await loadPresets();
}

async function saveSettings() {
  await set(KEYS.backend, backend.value);
  await set(KEYS.model, model.value);
  await set(KEYS.customGw, gateway.value.trim());
  await set(KEYS.secret, secret.value.trim());
  await set(KEYS.preamble, preamble.value.trim());
  await set(KEYS.temperature, parseFloat(temperature.value) || 0.7);
  await set(KEYS.maxTokens, parseInt(maxTokens.value) || 4096);
  await set(KEYS.askBeforeActing, agentAskToggle.checked);
  await set(KEYS.agentScreenshots, agentScreenshotsCb.checked);
  await set(KEYS.agentMaxSteps, parseInt(agentMaxStepsInp.value) || 25);

  try { await chrome.runtime.sendMessage({ type: 'REFRESH' }); } catch (e) {}
  msg('Saved.', 'ok');
}

async function resetSettings() {
  await remove(KEYS.backend);
  await remove(KEYS.model);
  await remove(KEYS.customGw);
  await remove(KEYS.secret);
  await remove(KEYS.preamble);
  await remove(KEYS.temperature);
  await remove(KEYS.maxTokens);
  await remove(KEYS.askBeforeActing);
  await remove(KEYS.agentScreenshots);
  await remove(KEYS.agentMaxSteps);
  await loadSettings();
  msg('Defaults restored.', 'ok');
}

$('saveAll').addEventListener('click', saveSettings);
$('resetAll').addEventListener('click', resetSettings);

$('savePp').addEventListener('click', async function () {
  var name = ppName.value.trim();
  var content = ppContent.value.trim();
  if (!name || !content) { msg('Name and content required.', 'bad'); return; }
  var keep = await import('../lib/keeper.js');
  await keep.savePreprompt(name, content);
  ppName.value = '';
  ppContent.value = '';
  await loadPreprompts();
  msg('Preprompt saved.', 'ok');
});

$('saveSk').addEventListener('click', async function () {
  var name = skName.value.trim();
  var prompt = skPrompt.value.trim();
  var icon = skIcon.value.trim() || '\u2192';
  if (!name || !prompt) { msg('Name and prompt required.', 'bad'); return; }
  var keep = await import('../lib/keeper.js');
  await keep.saveSkill(name, prompt, icon);
  skName.value = '';
  skIcon.value = '';
  skPrompt.value = '';
  await loadSkills();
  msg('Skill saved.', 'ok');
});

populateBackends();
loadSettings();

});
