import * as S from './state.js';
import { get } from '../lib/keeper.js';
import { add } from './ui.js';

export async function init() {
  try {
    const saved = await get('ssnnd0:thread');
    if (saved && saved.length) {
      S.setThread(saved);
      saved.forEach(msg => {
        add(msg.content || '', msg.role === 'user' ? 'me' : 'other');
      });
    }
  } catch {}
}
