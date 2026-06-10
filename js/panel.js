import * as DOM from './dom.js';
import * as S from './state.js';
import { sync, add, addSys, dots, updateGoBtn, toggleAgentMode, toggleAnon, resizeInp, handleAgentUpdate, showAskDialog } from './ui.js';
import { init } from './init.js';
import { submit } from './submit.js';
import { startAgent } from './agent.js';
import * as cmd from './cmd.js';

function onInp() {
  resizeInp();
  updateGoBtn();
  cmd.handleKey({ key: 'none' });
}

function onGo() {
  const val = DOM.inp.value.trim();
  if (!val) return;
  if (val.startsWith('/')) {
    DOM.inp.value = '';
    updateGoBtn();
    resizeInp();
    cmd.run(val);
    return;
  }
  DOM.inp.value = '';
  updateGoBtn();
  resizeInp();
  if (S.mode === 'agent') {
    startAgent(val);
  } else {
    submit(val);
  }
}

function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onGo();
    return;
  }
  cmd.handleKey(e);
}

document.addEventListener('DOMContentLoaded', async function () {
  sync();
  init();

  DOM.inp.addEventListener('input', onInp);
  DOM.inp.addEventListener('keydown', onKey);
  DOM.go.addEventListener('click', onGo);

  DOM.badge.addEventListener('click', function () {
    chrome.tabs.create({ url: 'settings.html' }).catch(() => {});
  });

  DOM.anonToggle.addEventListener('click', toggleAnon);

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    switch (msg.type) {
      case 'STATE_UPDATED':
      case 'UI_REFRESH':
        sync();
        break;
      case 'AGENT_UPDATE':
        handleAgentUpdate(msg.tabId, msg.update);
        break;
      case 'AGENT_REASONING':
        dots(msg.on);
        break;
      case 'ASK_CONFIRM':
        if (S.anon) {
          chrome.runtime.sendMessage({ type: 'AGENT_RESPOND', tabId: msg.tabId, decision: 'confirm' }).catch(() => {});
        } else {
          showAskDialog(msg.tabId, msg.actions, msg.step);
        }
        break;
      case 'AGENT_MODE_ACTIVATE':
        if (S.mode !== 'agent') toggleAgentMode();
        break;
    }
    sendResponse({ ok: true });
  });
});
