import * as S from './state.js';
import { add, addSys, dots, updateGoBtn } from './ui.js';
import { send } from '../lib/relay.js';
import { set } from '../lib/keeper.js';

export function submit(text) {
  const thread = [...S.thread, { role: 'user', content: text }];
  S.setThread(thread);
  add(text, 'me');
  dots(true);
  S.setBusy(true);
  updateGoBtn();

  let responseText = '';
  let bubble = null;

  const onToken = function (tok) {
    dots(false);
    if (!bubble) {
      bubble = add('', 'other');
      S.setCurrentBubble(bubble);
    }
    responseText += tok;
    bubble.textContent = responseText;
    S.setCurrentText(responseText);
  };

  const onDone = function (msg) {
    dots(false);
    S.setBusy(false);
    updateGoBtn();
    S.setCurrentBubble(null);
    S.setCurrentText('');
    if (msg && msg.content) {
      if (!bubble) {
        add(msg.content, 'other');
      }
      S.setThread([...S.thread, { role: 'assistant', content: msg.content }]);
    }
    set('ssnnd0:thread', S.thread).catch(function () {});
  };

  const onFail = function (err) {
    dots(false);
    S.setBusy(false);
    updateGoBtn();
    addSys('Error: ' + err.message);
  };

  send(thread, onToken, onDone, onFail);
}
