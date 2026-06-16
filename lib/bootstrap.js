import { refresh, send, testConnection } from './relay.js';
import { runAgent, cancelAgent, agentStatus, pauseAgent, resumeAgent } from './agent.js';
import { KEYS, get } from './keeper.js';

const GROUP_TITLE = 'AgentSSNND0';

const activeAgents = new Map();
const pendingAsk = new Map();

/* ── Debug logger ── */
function dbg(msg, data) {
  var line = '[boot] ' + msg;
  if (data !== undefined) line += ' ' + JSON.stringify(data);
  console.log(line);
}

/* ── Derive a short descriptive title from the user's task ── */
function deriveTitle(task) {
  var t = task.trim();
  t = t.replace(/^(please\s+)?(can\s+you\s+)?(i\s+(need|want|would\s+like)\s+(you\s+(to\s+)?)?)?/i, '');
  t = t.replace(/^(do|make|create|find|search|go|navigate|visit|get|tell|show|give|write|read|open|close|check|run|start|stop|help\s+(me\s+)?)\s+/i, '');
  t = t.replace(/^(to\s+)?/i, '');
  t = t.replace(/[.!?]+$/, '');
  var words = t.split(/\s+/).filter(function (w) { return w.length > 2; });
  if (words.length === 0) { words = t.split(/\s+/).filter(function (w) { return w.length > 0; }); }
  if (words.length > 6) words = words.slice(0, 6);
  if (words.length === 0) return GROUP_TITLE;
  var title = words.join(' ');
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/* ── Update tab group title in-place ── */
async function updateGroupTitle(groupId, title) {
  if (groupId == null) return;
  try {
    await chrome.tabGroups.update(groupId, { title: title });
  } catch (e) {
    console.warn('[boot] updateGroupTitle failed:', e.message);
  }
}

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
    var tab = await chrome.tabs.get(tabId);
    var groups = await chrome.tabGroups.query({
      windowId: tab.windowId,
      title: GROUP_TITLE,
    });
    var groupId = groups[0]?.id ?? null;

    if (groupId !== null && tab.groupId === groupId) {
      dbg('tab already in group', { tabId: tabId, groupId: groupId });
      return groupId;
    } else if (groupId !== null) {
      dbg('adding tab to existing group', { tabId: tabId, groupId: groupId });
      await chrome.tabs.group({ tabIds: tabId, groupId: groupId });
    } else {
      dbg('creating new group for tab', { tabId: tabId });
      groupId = await chrome.tabs.group({ tabIds: tabId });
    }
    await chrome.tabGroups.update(groupId, {
      title: GROUP_TITLE,
      color: 'grey',
      collapsed: false,
    });
    return groupId;
  } catch (e) {
    console.warn('[boot] addTabToGroup failed:', e.message);
    return null;
  }
}

async function ensureAgentGroup(tabId, title) {
  var g = await addTabToGroup(tabId);
  if (g == null) {
    dbg('ensureAgentGroup: addTabToGroup returned null');
    return null;
  }
  title = title || GROUP_TITLE;
  try {
    await chrome.tabGroups.update(g, { color: 'yellow', title: title + ' · running' });
    dbg('group set to yellow · running', { tabId: tabId, groupId: g, title: title });
  } catch (e) {
    console.warn('[boot] ensureAgentGroup update failed:', e.message);
  }
  return g;
}

async function settleAgentGroup(groupId, title, ok) {
  if (groupId == null) return;
  title = title || GROUP_TITLE;
  try {
    var color = ok ? 'grey' : 'red';
    var displayTitle = ok ? title : title + ' · failed';
    await chrome.tabGroups.update(groupId, { color: color, title: displayTitle });
    dbg('group settled', { groupId: groupId, color: color, title: displayTitle });
  } catch (e) {
    console.warn('[boot] settleAgentGroup failed:', e.message);
  }
}

chrome.tabs.onCreated.addListener(async function (tab) {
  if (!tab.openerTabId || !activeAgents.has(tab.openerTabId)) return;
  var groupId = activeAgents.get(tab.openerTabId);
  if (groupId === null) return;
  try {
    await chrome.tabs.group({ tabIds: tab.id, groupId: groupId });
    dbg('new tab added to agent group', { tabId: tab.id, groupId: groupId });
  } catch (e) {
    console.warn('[boot] onCreated group failed:', e.message);
  }
});

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(function () {});
}

async function handleAsk(tabId, actions, step) {
  broadcast({ type: 'AGENT_ASK', tabId: tabId, actions: actions, step: step });
  return new Promise(function (resolve) {
    var timer = setTimeout(function () {
      if (pendingAsk.has(tabId)) {
        pendingAsk.delete(tabId);
        resolve(false);
      }
    }, 120000);
    pendingAsk.set(tabId, { resolve: resolve, timer: timer });
  });
}

/* ── Cancel all active agent sessions across the entire browser ── */
function cancelAllAgents() {
  if (activeAgents.size === 0) return;
  dbg('cancelling all active agents', { count: activeAgents.size });
  activeAgents.forEach(function (gid, tid) {
    cancelAgent(tid);
    if (pendingAsk.has(tid)) {
      pendingAsk.get(tid).resolve(false);
      pendingAsk.delete(tid);
    }
  });
  activeAgents.clear();
}

async function validateConfig() {
  var secret = await get(KEYS.secret);
  if (!secret) throw new Error('No API key configured. Open Settings and add your secret key.');
  var backend = await get(KEYS.backend);
  if (!backend) throw new Error('No backend selected. Open Settings and choose an AI provider.');
  return true;
}

async function startAgent(tabId, task) {
  dbg('startAgent called', { tabId: tabId, task: task.slice(0, 80) });

  try {
    await validateConfig();
  } catch (err) {
    dbg('validateConfig failed', { error: err.message });
    broadcast({ type: 'AGENT_UPDATE', tabId: tabId, update: { type: 'agent-end', summary: err.message, steps: 0 } });
    return { summary: err.message, steps: 0 };
  }

  /* ── Cancel any existing agent across the entire browser ── */
  cancelAllAgents();
  await new Promise(function (r) { setTimeout(r, 300); });

  var agentTitle = deriveTitle(task);
  var groupId = await ensureAgentGroup(tabId, agentTitle);
  if (groupId == null) {
    dbg('failed to create tab group, running without group');
  } else {
    activeAgents.set(tabId, groupId);
    dbg('agent registered', { tabId: tabId, groupId: groupId, title: agentTitle, activeCount: activeAgents.size });
  }

  var failed = false;
  try {
    var res = await runAgent(tabId, task, function (update) {
      if (update.type === 'agent-cancelled') failed = true;
      if (update.type === 'agent-step' && update.phase === 'error') failed = true;
      /* Update group title with current step phase */
      if (update.type === 'agent-step' && update.phase && groupId != null) {
        updateGroupTitle(groupId, agentTitle + ' \xB7 ' + update.phase);
      }
      broadcast({ type: 'AGENT_UPDATE', tabId: tabId, update: update });
    }, handleAsk, groupId);
    dbg('agent finished', { tabId: tabId, summary: res.summary.slice(0, 80) });
    return res;
  } catch (err) {
    failed = true;
    console.error('[boot] agent crash:', err);
    broadcast({
      type: 'AGENT_UPDATE',
      tabId: tabId,
      update: { type: 'agent-end', summary: 'Agent crashed: ' + err.message, steps: 0 },
    });
    throw err;
  } finally {
    activeAgents.delete(tabId);
    settleAgentGroup(groupId, agentTitle, !failed);
    dbg('agent cleaned up', { tabId: tabId, groupId: groupId, title: agentTitle, failed: failed });
  }
}

chrome.runtime.onInstalled.addListener(async function () {
  await spawnOffscreen();
  await refresh();
});

chrome.runtime.onStartup.addListener(spawnOffscreen);

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  (async function () {
    switch (msg.type) {

      case 'PING':
        reply({ ok: true });
        break;

      case 'PANEL_OPEN':
        dbg('PANEL_OPEN', { tabId: msg.tabId });
        await addTabToGroup(msg.tabId);
        reply({ ok: true });
        break;

      case 'REFRESH':
        await refresh();
        reply({ ok: true });
        break;

      case 'AGENT_START':
      case 'AGENT_RUN': {
        var tabId = msg.tabId;
        if (typeof tabId !== 'number') { reply({ ok: false, error: 'No tabId' }); break; }
        reply({ ok: true });
        dbg('agent message received', { type: msg.type, tabId: tabId });
        startAgent(tabId, msg.task).catch(function (err) {
          console.error('[boot] startAgent unhandled:', err);
        });
        break;
      }

      case 'AGENT_CANCEL': {
        var ok = cancelAgent(msg.tabId);
        if (pendingAsk.has(msg.tabId)) {
          pendingAsk.get(msg.tabId).resolve(false);
          pendingAsk.delete(msg.tabId);
        }
        reply({ ok: ok });
        break;
      }

      case 'AGENT_PAUSE': {
        var paused = pauseAgent(msg.tabId);
        broadcast({ type: 'AGENT_UPDATE', tabId: msg.tabId, update: { type: 'agent-paused' } });
        reply({ ok: paused });
        break;
      }

      case 'AGENT_RESUME': {
        var resumed = resumeAgent(msg.tabId);
        broadcast({ type: 'AGENT_UPDATE', tabId: msg.tabId, update: { type: 'agent-resumed' } });
        reply({ ok: resumed });
        break;
      }

      case 'AGENT_RESPOND': {
        var p = pendingAsk.get(msg.tabId);
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

      case 'AGENT_MODE_ACTIVATE':
        /* Panel signals agent mode is on — ensure tab is in group */
        dbg('AGENT_MODE_ACTIVATE', { tabId: msg.tabId });
        if (msg.tabId) addTabToGroup(msg.tabId).catch(function () {});
        reply({ ok: true });
        break;

      case 'CHAT': {
        try {
          await send(
            msg.msgs,
            function (tok) {
              try { chrome.runtime.sendMessage({ type: 'TOKEN', tok: tok, id: msg.id }); } catch (e) {}
            },
            function (res) {
              try { chrome.runtime.sendMessage({ type: 'DONE', res: res, id: msg.id }); } catch (e) {}
            },
            function (err) {
              try { chrome.runtime.sendMessage({ type: 'FAIL', err: err.message, id: msg.id }); } catch (e) {}
            },
          );
        } catch (err) {
          try { chrome.runtime.sendMessage({ type: 'FAIL', err: err.message, id: msg.id }); } catch (e) {}
        }
        reply({ ok: true });
        break;
      }

      case 'BEEP':
        try {
          var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          for (var i = 0; i < tabs.length; i++) {
            chrome.tabs.sendMessage(tabs[i].id, { type: 'BEEP' }).catch(function () {});
          }
        } catch (e) {}
        break;

      case 'TEST_CONNECTION': {
        try {
          var result = await testConnection(msg.backend, msg.gateway, msg.secret, msg.model);
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

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
chrome.action.onClicked.addListener(async function (tab) {
  try { await chrome.sidePanel.open({ tabId: tab.id }); } catch (e) {}
});
