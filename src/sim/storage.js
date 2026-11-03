import { sanitizeCampaign } from './progression.js';

const PREFIX = 'scrap-league-v1:';

export function createStorage(backing = null) {
  const memory = new Map();
  const available = backing || (() => {
    try {
      const storage = globalThis.localStorage;
      storage.setItem(`${PREFIX}probe`, '1');
      storage.removeItem(`${PREFIX}probe`);
      return storage;
    } catch {
      return null;
    }
  })();
  return {
    persistent: Boolean(available),
    get(key, fallback = null) {
      try {
        const raw = available ? available.getItem(PREFIX + key) : memory.get(key);
        return raw === null || raw === undefined ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      try {
        if (available) available.setItem(PREFIX + key, raw);
        else memory.set(key, raw);
        return true;
      } catch { return false; }
    },
    remove(key) {
      try {
        if (available) available.removeItem(PREFIX + key);
        else memory.delete(key);
      } catch { /* storage is optional */ }
    }
  };
}

export function loadCampaign(storage) {
  return sanitizeCampaign(storage.get('campaign', null));
}

export function saveCampaign(storage, campaign) {
  return storage.set('campaign', campaign);
}

export function loadBlueprints(storage) {
  const plans = storage.get('blueprints', []);
  return Array.from({ length: 4 }, (_, index) => plans[index] || null);
}

export function saveBlueprint(storage, slot, team, name) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 3) return false;
  const plans = loadBlueprints(storage);
  plans[slot] = { name: String(name || `Plan ${slot + 1}`).slice(0, 32), team: JSON.parse(JSON.stringify(team)), savedAt: new Date().toISOString() };
  return storage.set('blueprints', plans);
}
