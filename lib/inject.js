(function () {
  if (window.__SSNND0__) return;
  window.__SSNND0__ = true;

  chrome.runtime.onMessage.addListener((msg, _, reply) => {
    switch (msg.type) {
      case 'TOKEN':
        window.dispatchEvent(new CustomEvent('ssnnd0-token', { detail: msg }));
        break;
      case 'DONE':
        window.dispatchEvent(new CustomEvent('ssnnd0-done', { detail: msg }));
        break;
      case 'FAIL':
        window.dispatchEvent(new CustomEvent('ssnnd0-fail', { detail: msg }));
        break;
      case 'BEEP':
        try {
          const a = new Audio(chrome.runtime.getURL('audio/chime.mp3'));
          a.volume = 0.4;
          a.play().catch(() => {});
        } catch {}
        break;
    }
    reply?.({ ok: true });
  });
})();
