import * as S from './state.js';
import { add, updateGoBtn } from './ui.js';

export async function startAgent(task) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0] ? tabs[0].id : null;
    if (!tabId) {
      add('No active tab found', 'err');
      return;
    }
    add('Starting agent: ' + task, 'sysmsg');
    S.setAgentStartTime(Date.now());
    S.setBusy(true);
    updateGoBtn();
    S.setMode('agent');
    chrome.runtime.sendMessage({ type: 'AGENT_START', tabId: tabId, task: task }).catch(function () {
      add('Failed to start agent', 'err');
      S.setBusy(false);
      updateGoBtn();
    });
  } catch (err) {
    add('Error: ' + err.message, 'err');
  }
}
