import * as S from './state.js';
import { inp } from './dom.js';
import { closeOverlay, navOv, selectOv, runCommand, detectSlash, applyToken } from './commands.js';
import { resizeInp, updateGoBtn } from './ui.js';

export function run(input) {
  if (!input.startsWith('/')) return;
  const trimmed = input.replace(/^\//, '').trim();
  const spaceIdx = trimmed.indexOf(' ');
  const cmd = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
  const args = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : '';
  runCommand(cmd, args);
}

export function handleKey(e) {
  if (e.key !== 'none') {
    if (S.ovOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); navOv('down'); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); navOv('up'); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const item = S.ovItems[S.ovIdx];
        if (item) {
          if (e.key === 'Tab') {
            applyToken(item.token || ('/' + item.cmd + ' '));
            closeOverlay();
            inp.focus();
            resizeInp();
            updateGoBtn();
          } else {
            selectOv(S.ovIdx);
          }
        }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); return; }
    }
    if (e.key === 'Escape' && S.ovOpen) {
      e.preventDefault();
      closeOverlay();
    }
  }
  detectSlash();
}
