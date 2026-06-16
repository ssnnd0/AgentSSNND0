import * as S from './state.js';
import { get } from '../lib/keeper.js';
import { add } from './ui.js';

export async function init() {
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      chrome.runtime.sendMessage({ type: 'PANEL_OPEN', tabId: tabs[0].id }).catch(function () {});
    }
  } catch (e) {
    console.warn('[init] PANEL_OPEN send failed:', e);
  }
  try {
    var saved = await get('ssnnd0:thread');
    if (saved && saved.length) {
      S.setThread(saved);
      saved.forEach(function (msg) {
        add(msg.content || '', msg.role === 'user' ? 'me' : 'other');
      });
    }
  } catch (e) {
    console.warn('[init] thread load failed:', e);
  }
}
