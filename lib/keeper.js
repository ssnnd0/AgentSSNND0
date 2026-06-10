const NS = 'ssnnd0';

export const KEYS = {
  backend:      `${NS}:backend`,
  customGw:     `${NS}:gateway`,
  secret:       `${NS}:secret`,
  model:        `${NS}:model`,
  preamble:     `${NS}:preamble`,
  token:        `${NS}:token`,

  temperature:  `${NS}:temp`,
  maxTokens:    `${NS}:maxtok`,
  modelPerBackend: `${NS}:modelmap`,

  presets:      `${NS}:presets`,
  activePreset: `${NS}:activePreset`,

  preprompts:   `${NS}:preprompts`,
  activePreprompt: `${NS}:activePreprompt`,

  skills:       `${NS}:skills`,

  agentScreenshots: `${NS}:agentScreenshots`,
  agentMaxSteps:    `${NS}:agentMaxSteps`,
  askBeforeActing:  `${NS}:askBeforeActing`,
};

export async function get(key) {
  const r = await chrome.storage.local.get(key);
  return r[key];
}

export async function set(key, val) {
  await chrome.storage.local.set({ [key]: val });
}

export async function remove(key) {
  await chrome.storage.local.remove(key);
}

export async function mget(keys) {
  return await chrome.storage.local.get(keys);
}

export function watch(fn) {
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local') fn(c);
  });
}

export async function getModelForBackend(backendId) {
  const map = await get(KEYS.modelPerBackend);
  return map?.[backendId] || null;
}

export async function setModelForBackend(backendId, model) {
  const map = (await get(KEYS.modelPerBackend)) || {};
  map[backendId] = model;
  await set(KEYS.modelPerBackend, map);
}

export async function getPresets() {
  return (await get(KEYS.presets)) || [];
}

export async function savePreset(name, data) {
  const presets = await getPresets();
  const idx = presets.findIndex(p => p.name === name);
  const entry = { name, ...data, updated: Date.now() };
  if (idx >= 0) presets[idx] = entry;
  else presets.push(entry);
  await set(KEYS.presets, presets);
  return entry;
}

export async function deletePreset(name) {
  const presets = await getPresets();
  await set(KEYS.presets, presets.filter(p => p.name !== name));
}

export async function getPreprompts() {
  return (await get(KEYS.preprompts)) || [];
}

export async function savePreprompt(name, content) {
  const list = await getPreprompts();
  const idx = list.findIndex(p => p.name === name);
  const entry = { name, content, updated: Date.now() };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  await set(KEYS.preprompts, list);
  return entry;
}

export async function deletePreprompt(name) {
  const list = await getPreprompts();
  await set(KEYS.preprompts, list.filter(p => p.name !== name));
}

export async function getSkills() {
  return (await get(KEYS.skills)) || [];
}

export async function saveSkill(name, prompt, icon) {
  const list = await getSkills();
  const idx = list.findIndex(s => s.name === name);
  const entry = { name, prompt, icon: icon || '→', updated: Date.now() };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  await set(KEYS.skills, list);
  return entry;
}

export async function deleteSkill(name) {
  const list = await getSkills();
  await set(KEYS.skills, list.filter(s => s.name !== name));
}
