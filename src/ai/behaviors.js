import { MODULES, TICK_SECONDS } from '../data/catalog.js';
import { distance, findPath, reachableStep } from '../sim/grid.js';

function livingEnemies(state, unit) {
  return state.units.filter(other => other.active && other.team !== unit.team);
}

export function selectTarget(state, unit) {
  if (unit.priorityTarget) {
    const priority = state.units.find(other => other.id === unit.priorityTarget && other.active && other.team !== unit.team);
    if (priority) return priority;
  }
  const enemies = livingEnemies(state, unit);
  const fragile = unit.behavior === 'fragile';
  return enemies.sort((a, b) => {
    if (fragile) return (a.hp / a.maxHp) - (b.hp / b.maxHp) || distance(unit, a) - distance(unit, b) || a.id.localeCompare(b.id);
    return distance(unit, a) - distance(unit, b) || (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id.localeCompare(b.id);
  })[0] || null;
}

function ready(unit, entry) {
  return (unit.cooldowns[entry.id] || 0) <= 0;
}

export function chooseUnitAction(state, unit) {
  const target = selectTarget(state, unit);
  const support = unit.modules.find(entry => {
    const module = MODULES[entry.id];
    if (module?.kind !== 'support' || !ready(unit, entry)) return false;
    return state.units.some(ally => ally.active && ally.team === unit.team && ally.hp < ally.maxHp && distance(unit, ally) <= module.range);
  });
  if (support) {
    const module = MODULES[support.id];
    const ally = state.units.filter(other => other.active && other.team === unit.team && other.hp < other.maxHp && distance(unit, other) <= module.range)
      .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id.localeCompare(b.id))[0];
    return { type: 'support', module: support, target: ally };
  }
  if (target) {
    const weapon = unit.modules.find(entry => {
      const module = MODULES[entry.id];
      return module?.kind === 'weapon' && ready(unit, entry) && distance(unit, target) <= module.range && distance(unit, target) >= (module.minRange || 1);
    });
    if (weapon) return { type: 'attack', module: weapon, target };
  }
  if (unit.retreatUntil > state.tick && target) {
    const step = reachableStep(state, unit, (x, y) => distance({ x, y }, target));
    if (step) return { type: 'move', ...step };
  }
  const ranged = unit.modules.some(entry => MODULES[entry.id]?.range > 1);
  if (target && (unit.behavior === 'keepRange' || (ranged && !unit.modules.some(entry => MODULES[entry.id]?.range === 1)))) {
    const minimum = Math.max(2, ...unit.modules.map(entry => MODULES[entry.id]?.minRange || 1));
    if (distance(unit, target) < minimum) {
      const step = reachableStep(state, unit, (x, y) => distance({ x, y }, target));
      if (step) return { type: 'move', ...step };
    }
    if (distance(unit, target) <= Math.max(...unit.modules.map(entry => MODULES[entry.id]?.range || 1))) return { type: 'wait' };
  }
  if (unit.behavior === 'protect') {
    const ally = state.units.filter(other => other.active && other.team === unit.team && other.id !== unit.id)
      .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id.localeCompare(b.id))[0];
    if (ally && distance(unit, ally) > 2 && (!target || distance(unit, target) > 1)) {
      const path = findPath(state, unit, (x, y) => distance({ x, y }, ally) <= 2);
      if (path?.[1]) return { type: 'move', x: path[1][0], y: path[1][1] };
    }
  }
  if (target && unit.moveCooldown <= 0) {
    const range = Math.max(1, ...unit.modules.map(entry => MODULES[entry.id]?.range || 1));
    const path = findPath(state, unit, (x, y) => {
      const d = distance({ x, y }, target);
      return d <= range && d >= 1;
    });
    if (path?.[1]) return { type: 'move', x: path[1][0], y: path[1][1] };
  }
  return { type: 'wait' };
}

export function cooldownFor(unit, entry) {
  const module = MODULES[entry.id];
  const overloaded = unit.overload?.moduleId === entry.id && unit.overload.until > 0;
  return Math.max(1, Math.round(module.cooldown * (overloaded ? 0.55 : 1) / TICK_SECONDS));
}
