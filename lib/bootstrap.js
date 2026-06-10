import { refresh, send } from './relay.js';
import { runAgent, cancelAgent, agentStatus } from './agent.js';
import { KEYS, get } from './keeper.js';

const GROUP_TITLE = 'AgentSSNND0';

const activeAgents = new Map();
const pendingAsk = new Map();

async function spawnOffscreen() {
  try {
    await chrome.offscreen.createDocument({
      url: 'pages/silence.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Keep service worker alive + notification sounds',
    });
  } catch (e) {
    if (!/already exists/i.test(e.message)) console.warn('[boot] offscreen:', e);
  }
}

async function addTabToGroup(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const groups = await chrome.tabGroups.query({
      windowId: tab.windowId,
      title: GROUP_TITLE,
    });
    let groupId = groups[0]?.id ?? null;

    if (groupId !== null && tab.groupId === groupId) {
      return groupId;
    } else if (groupId !== null) {
      await chrome.tabs.group({ tabIds: tabId, groupId });
    } else {
      groupId = await chrome.tabs.group({ tabIds: tabId });
    }
    await chrome.tabGroups.update(groupId, {
      title: GROUP_TITLE,
      color: 'grey',
      collapsed: false,
    });
    return groupId;
  } catch (e) {
    console.warn('[boot] group:', e.message);
    return null;
  }
}

async function ensureAgentGroup(tabId) {
  const g = await addTabToGroup(tabId);
  try {
    await chrome.tabGroups.update(g, { color: 'yellow', title: GROUP_TITLE + ' · running' });
  } catch { }
  return g;
}

async function settleAgentGroup(groupId, ok) {
  if (groupId == null) return;
  try {
    await chrome.tabGroups.update(groupId, { 
      color: ok ? 'grey' : 'red',
      title: ok ? GROUP_TITLE : GROUP_TITLE + ' · failed',
    });
  } catch { }
}

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.openerTabId || !activeAgents.has(tab.openerTabId)) return;
  const groupId = activeAgents.get(tab.openerTabId);
  if (groupId === null) return;
  try {
    await chrome.tabs.group({ tabIds: tab.id, groupId });
  } catch { }
});

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => { });
}

async function handleAsk(tabId, actions, step) {
  broadcast({ type: 'AGENT_ASK', tabId, actions, step });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingAsk.has(tabId)) {
        pendingAsk.delete(tabId);
        resolve(false);
      }
    }, 120000);
    pendingAsk.set(tabId, { resolve, timer });
  });
}

async function validateConfig() {
  const secret = await get(KEYS.secret);
  if (!secret) throw new Error('No API key configured. Open Settings and add your secret key.');
  const backend = await get(KEYS.backend);
  if (!backend) throw new Error('No backend selected. Open Settings and choose an AI provider.');
  return true;
}

async function startAgent(tabId, task) {
  try {
    await validateConfig();
  } catch (err) {
    broadcast({ type: 'AGENT_UPDATE', tabId, update: { type: 'agent-end', summary: err.message, steps: 0 } });
    return { summary: err.message, steps: 0 };
  }

  if (activeAgents.has(tabId)) {
    cancelAgent(tabId);
    if (pendingAsk.has(tabId)) {
      pendingAsk.get(tabId).resolve(false);
      pendingAsk.delete(tabId);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  const groupId = await ensureAgentGroup(tabId);
  activeAgents.set(tabId, groupId);

  let failed = false;
  try {
    const res = await runAgent(tabId, task, (update) => {
      if (update.type === 'agent-cancelled') failed = true;
      if (update.type === 'agent-step' && update.phase === 'error') failed = true;
      broadcast({ type: 'AGENT_UPDATE', tabId, update });
    }, handleAsk, groupId);
    return res;
  } catch (err) {
    failed = true;
    console.error('[agent] crash:', err);
    broadcast({
      type: 'AGENT_UPDATE',
      tabId,
      update: { type: 'agent-end', summary: `Agent crashed: ${err.message}`, steps: 0 },
    });
    throw err;
  } finally {
    activeAgents.delete(tabId);
    settleAgentGroup(groupId, !failed);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await spawnOffscreen();
  await refresh();
});

chrome.runtime.onStartup.addListener(spawnOffscreen);

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    switch (msg.type) {
      case 'PING':
        reply({ ok: true });
        break;

      case 'PANEL_OPEN':
        await addTabToGroup(msg.tabId);
        reply({ ok: true });
        break;

      case 'REFRESH':
        await refresh();
        reply({ ok: true });
        break;

      case 'AGENT_RUN': {
        const tabId = msg.tabId;
        if (typeof tabId !== 'number') { reply({ ok: false, error: 'No tabId' }); break; }
        reply({ ok: true });
        startAgent(tabId, msg.task).catch(() => { });
        break;
      }

      case 'AGENT_CANCEL': {
        const ok = cancelAgent(msg.tabId);
        if (pendingAsk.has(msg.tabId)) {
          pendingAsk.get(msg.tabId).resolve(false);
          pendingAsk.delete(msg.tabId);
        }
        reply({ ok });
        break;
      }

      case 'AGENT_RESPOND': {
        const p = pendingAsk.get(msg.tabId);
        if (p) {
          clearTimeout(p.timer);
          p.resolve(msg.decision === 'confirm');
          pendingAsk.delete(msg.tabId);
        }
        reply({ ok: true });
        break;
      }

      case 'AGENT_STATUS': {
        reply({ ok: true, status: agentStatus(msg.tabId) });
        break;
      }

      case 'CHAT': {
        try {
          await send(
            msg.msgs,
            (tok) => {
              try { chrome.runtime.sendMessage({ type: 'TOKEN', tok, id: msg.id }); } catch { }
            },
            (res) => {
              try { chrome.runtime.sendMessage({ type: 'DONE', res, id: msg.id }); } catch { }
            },
            (err) => {
              try { chrome.runtime.sendMessage({ type: 'FAIL', err: err.message, id: msg.id }); } catch { }
            },
          );
        } catch (err) {
          try { chrome.runtime.sendMessage({ type: 'FAIL', err: err.message, id: msg.id }); } catch { }
        }
        reply({ ok: true });
        break;
      }

      case 'BEEP':
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          for (const t of tabs) {
            chrome.tabs.sendMessage(t.id, { type: 'BEEP' }).catch(() => { });
          }
        } catch { }
        break;

      case 'TEST_CONNECTION': {
        try {
          const { testBackend } = await import('./backends.js');
          const { testConnection } = await import('./relay.js');
          const result = await testConnection(msg.backend, msg.gateway, msg.secret, msg.model);
          reply({ ok: true, success: result.success, error: result.error });
        } catch (err) {
          reply({ ok: true, success: false, error: err.message });
        }
        break;
      }
    }
  })();
  return true;
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });
chrome.action.onClicked.addListener(async (tab) => {
  try { await chrome.sidePanel.open({ tabId: tab.id }); } catch { }
});
