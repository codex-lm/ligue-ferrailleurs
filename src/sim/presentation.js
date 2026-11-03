import { MODULES, weaponRange } from '../data/catalog.js';
import { describeUnitAction } from '../ai/behaviors.js';
import { calculateDamage, calculateHealing, cloneBattle, issueOrder, projectNextStep } from './combat.js';
import { distance, inBounds } from './grid.js';

export const cellName = (x, y) => `${String.fromCharCode(65 + x)}${y + 1}`;
export const unitById = (state, id) => state?.units.find(unit => unit.id === id) || null;

export function moduleRange(unit, entry) {
  const module = MODULES[entry.id];
  return module?.kind === 'weapon' ? weaponRange(unit, module) : module?.range || 0;
}

export function moduleTargets(state, unit, entry) {
  const module = MODULES[entry.id];
  if (!module) return [];
  if (module.effect === 'shield') return state.units.filter(other => other.active && other.team === unit.team && (other.id === unit.id || distance(unit, other) <= 1));
  if (module.kind === 'passive' || module.kind === 'mobility') return [];
  const maximum = moduleRange(unit, entry);
  return state.units.filter(other => {
    if (!other.active || other.id === unit.id) return false;
    const range = distance(unit, other);
    if (module.kind === 'weapon') return other.team !== unit.team && range >= (module.minRange || 1) && range <= maximum;
    if (module.kind === 'support') return other.team === unit.team && other.hp < other.maxHp && range <= maximum;
    return false;
  });
}

export function targetIneligibility(state, unit, entry, target) {
  const module = MODULES[entry.id];
  if (!target?.active) return 'target-disabled';
  if (moduleTargets(state, unit, entry).some(other => other.id === target.id)) return null;
  if (module.kind === 'weapon' && target.team === unit.team) return 'ally';
  if (module.kind === 'support' && target.id === unit.id) return 'self-repair';
  if (module.kind === 'support' && target.hp >= target.maxHp) return 'full-hull';
  const range = distance(unit, target);
  if (range < (module.minRange || 1)) return 'too-close';
  if (range > moduleRange(unit, entry)) return 'too-far';
  return 'ineligible';
}

export function rangeOverlay(state, unit, entry) {
  const module = MODULES[entry.id];
  if (!module || module.kind === 'passive' || module.kind === 'mobility') return [];
  const maximum = moduleRange(unit, entry);
  const cells = [];
  for (let y = 0; y < state.arena.height; y += 1) {
    for (let x = 0; x < state.arena.width; x += 1) {
      if (!inBounds(state.arena, x, y)) continue;
      const range = Math.abs(unit.x - x) + Math.abs(unit.y - y);
      if (range > maximum) continue;
      cells.push({ x, y, kind: range < (module.minRange || 1) ? 'too-close' : 'in-range' });
    }
  }
  return cells;
}

export function describeBattle(state) {
  return Object.fromEntries(state.units.map(unit => [unit.id, unit.active ? describeUnitAction(state, unit) : { type: 'disabled', targetId: null, basisTick: state.tick, stateRevision: state.revision }]));
}

export function effectPreview(state, unit, entry, target) {
  const module = MODULES[entry.id];
  if (!module || !target) return null;
  if (module.kind === 'weapon') return calculateDamage(state, unit, target, entry.id);
  if (module.kind === 'support') return calculateHealing(state, unit, target, entry.id);
  return null;
}

export function previewOrder(state, team, order) {
  const projected = cloneBattle(state);
  const result = issueOrder(projected, team, order);
  if (!result.ok) return { result };
  const actor = unitById(projected, order.unitId);
  return { result, state: projected, action: describeUnitAction(projected, actor) };
}

export { projectNextStep };
