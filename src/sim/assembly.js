import { CHASSIS, MODULES, moduleEntry } from '../data/catalog.js';

export function validateUnit(unit, unlocked = null) {
  const errors = [];
  const chassis = CHASSIS[unit.chassis];
  if (!chassis) return { valid: false, errors: [{ code: 'unknown-chassis', id: unit.chassis }], weight: 0, energy: 0, maxWeight: 0, maxEnergy: 0 };
  const entries = (unit.modules || []).map(moduleEntry);
  const usedSockets = new Set();
  let weight = 0;
  let energy = 0;
  let bonusEnergy = 0;
  for (const entry of entries) {
    const module = MODULES[entry.id];
    if (!module) {
      errors.push({ code: 'unknown-module', id: entry.id });
      continue;
    }
    if (unlocked && !unlocked.has(entry.id)) errors.push({ code: 'locked-module', id: entry.id });
    if (!chassis.sockets.includes(entry.socket) || !module.sockets.includes(entry.socket)) {
      errors.push({ code: 'bad-socket', id: entry.id, socket: entry.socket });
    }
    if (usedSockets.has(entry.socket)) errors.push({ code: 'occupied-socket', id: entry.id, socket: entry.socket });
    usedSockets.add(entry.socket);
    weight += module.weight;
    energy += module.energy;
    if (module.effect === 'battery') bonusEnergy += module.amount;
  }
  const maxEnergy = chassis.energy + bonusEnergy;
  if (weight > chassis.weight) errors.push({ code: 'weight', actual: weight, limit: chassis.weight });
  if (energy > maxEnergy) errors.push({ code: 'energy', actual: energy, limit: maxEnergy });
  return { valid: errors.length === 0, errors, weight, energy, maxWeight: chassis.weight, maxEnergy };
}

export function validateTeam(team, unlocked = null) {
  const units = team.units || [];
  const errors = units.flatMap((unit, index) => validateUnit(unit, unlocked).errors.map(error => ({ ...error, unit: index })));
  if (units.length !== 3) errors.push({ code: 'team-size', actual: units.length, limit: 3 });
  return { valid: errors.length === 0, errors };
}

export function autoEquip(unit) {
  const used = new Set();
  return {
    ...unit,
    modules: (unit.modules || []).map(entry => {
      const item = moduleEntry(entry);
      const module = MODULES[item.id];
      const socket = module?.sockets.find(candidate => !used.has(candidate)) || item.socket;
      used.add(socket);
      return { id: item.id, socket };
    })
  };
}
