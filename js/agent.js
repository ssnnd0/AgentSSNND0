import * as S from './state.js';
import { add, updateGoBtn } from './ui.js';

export async function startAgent(task) {
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tabId = tabs[0] ? tabs[0].id : null;
    if (!tabId) {
      add('No active tab found', 'err');
      return;
    }
    console.log('[agent] startAgent called', { tabId: tabId, task: task.slice(0, 80) });
    add('Starting agent: ' + task, 'sysmsg');
    S.setAgentStartTime(Date.now());
    S.setBusy(true);
    updateGoBtn();
    S.setMode('agent');
    chrome.runtime.sendMessage({ type: 'AGENT_START', tabId: tabId, task: task }).catch(function (err) {
      console.warn('[agent] send AGENT_START failed:', err);
      add('Failed to start agent', 'err');
      S.setBusy(false);
      updateGoBtn();
    });
  } catch (err) {
    console.warn('[agent] startAgent error:', err);
    add('Error: ' + err.message, 'err');
  }
}
