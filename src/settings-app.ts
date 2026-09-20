type SavedConfig = {
  provider?: string;
  apiKey?: string;
  model?: string;
};

const providerSelect = document.querySelector('#provider') as HTMLSelectElement | null;
const apiKeyInput = document.querySelector('#api-key') as HTMLInputElement | null;
const modelInput = document.querySelector('#model') as HTMLInputElement | null;
const statusText = document.querySelector('#status') as HTMLParagraphElement | null;
const saveButton = document.querySelector('#save-settings') as HTMLButtonElement | null;

if (providerSelect && apiKeyInput && modelInput && saveButton) {
  saveButton.addEventListener('click', () => {
    const config: SavedConfig = {
      provider: providerSelect.value,
      apiKey: apiKeyInput.value,
      model: modelInput.value,
    };

    chrome.storage.local.set({ 'jev-agent-config': config }, () => {
      statusText && (statusText.textContent = 'Saved locally.');
    });
  });

  chrome.storage.local.get('jev-agent-config', (items) => {
    const config = (items['jev-agent-config'] ?? {}) as SavedConfig;
    providerSelect.value = config.provider ?? 'openrouter';
    apiKeyInput.value = config.apiKey ?? '';
    modelInput.value = config.model ?? 'openai/gpt-4o-mini';
  });
}
