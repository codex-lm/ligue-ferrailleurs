import { MODULES, TICK_SECONDS, weaponRange } from '../data/catalog.js';
import { distance, findPath, reachableStep } from '../sim/grid.js';

export function selectTarget(state, unit) {
  if (unit.priorityTarget) {
    const priority = state.units.find(other => other.id === unit.priorityTarget && other.active && other.team !== unit.team);
    if (priority) return priority;
  }
  const enemies = state.units.filter(other => other.active && other.team !== unit.team);
  const fragile = unit.behavior === 'fragile';
  return enemies.sort((a, b) => {
    if (fragile) return (a.hp / a.maxHp) - (b.hp / b.maxHp) || distance(unit, a) - distance(unit, b) || a.id.localeCompare(b.id);
    return distance(unit, a) - distance(unit, b) || (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id.localeCompare(b.id);
  })[0] || null;
}

const ready = (unit, entry) => (unit.cooldowns[entry.id] || 0) <= 0;

function pathAction(state, unit, path, reason, target = null) {
  if (!path?.[1] || unit.moveCooldown > 0) return null;
  const boost = unit.modules.find(entry => MODULES[entry.id]?.effect === 'dash' && ready(unit, entry));
  const destination = boost && path[2] ? path[2] : path[1];
  return { type: 'move', x: destination[0], y: destination[1], boost: boost && path[2] ? boost : null, reason, target };
}

export function chooseUnitAction(state, unit) {
  const target = selectTarget(state, unit);
  const injured = state.units.filter(ally => ally.active && ally.team === unit.team && ally.id !== unit.id && ally.hp < ally.maxHp)
    .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id.localeCompare(b.id));
  const support = unit.modules.find(entry => {
    const module = MODULES[entry.id];
    return module?.kind === 'support' && ready(unit, entry) && injured.some(ally => distance(unit, ally) <= module.range);
  });
  if (support) {
    const module = MODULES[support.id];
    const ally = injured.find(candidate => distance(unit, candidate) <= module.range);
    return { type: 'support', module: support, target: ally, reason: 'repair-ready' };
  }
  if (target) {
    const weapon = unit.modules.find(entry => {
      const module = MODULES[entry.id];
      const range = module?.kind === 'weapon' ? weaponRange(unit, module) : 0;
      return range && ready(unit, entry) && distance(unit, target) <= range && distance(unit, target) >= (module.minRange || 1);
    });
    if (weapon) return { type: 'attack', module: weapon, target, reason: 'attack-ready' };
  }
  if (unit.moveCooldown <= 0 && unit.retreatUntil > state.tick && target) {
    const step = reachableStep(state, unit, (x, y) => distance({ x, y }, target));
    if (step) return { type: 'move', ...step, reason: 'retreat', target };
  }
  const ranged = unit.modules.some(entry => MODULES[entry.id]?.kind === 'weapon' && MODULES[entry.id].range > 1);
  if (target && (unit.behavior === 'keepRange' || (ranged && !unit.modules.some(entry => MODULES[entry.id]?.range === 1)))) {
    const minimum = Math.max(2, ...unit.modules.map(entry => MODULES[entry.id]?.minRange || 1));
    if (unit.moveCooldown <= 0 && distance(unit, target) < minimum) {
      const step = reachableStep(state, unit, (x, y) => distance({ x, y }, target));
      if (step) return { type: 'move', ...step, reason: 'keep-range', target };
    }
    const maximum = Math.max(0, ...unit.modules.map(entry => {
      const module = MODULES[entry.id];
      return module?.kind === 'weapon' ? weaponRange(unit, module) : 0;
    }));
    if (distance(unit, target) <= maximum) return { type: 'wait', reason: 'keep-range', target };
  }
  if (unit.behavior === 'protect') {
    const ally = state.units.filter(other => other.active && other.team === unit.team && other.id !== unit.id)
      .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id.localeCompare(b.id))[0];
    if (ally && distance(unit, ally) > 2 && (!target || distance(unit, target) > 1)) {
      const action = pathAction(state, unit, findPath(state, unit, (x, y) => distance({ x, y }, ally) <= 2), 'protect', ally);
      if (action) return action;
    }
  }
  const repair = unit.modules.find(entry => MODULES[entry.id]?.kind === 'support');
  if (repair && injured.length) {
    const range = MODULES[repair.id].range;
    const action = pathAction(state, unit, findPath(state, unit, (x, y) => injured.some(ally => distance({ x, y }, ally) <= range)), 'approach-repair', injured[0]);
    if (action) return action;
  }
  if (target) {
    const range = Math.max(1, ...unit.modules.map(entry => {
      const module = MODULES[entry.id];
      return module?.kind === 'weapon' ? weaponRange(unit, module) : 1;
    }));
    const action = pathAction(state, unit, findPath(state, unit, (x, y) => {
      const d = distance({ x, y }, target);
      return d <= range && d >= 1;
    }), 'pursue', target);
    if (action) return action;
  }
  return { type: 'wait', reason: waitReason(state, unit, target), target };
}

function waitReason(state, unit, target) {
  if (unit.moveCooldown > 0) return 'move-cooldown';
  if (unit.modules.some(entry => (unit.cooldowns[entry.id] || 0) > 0)) return 'cooldown';
  if (target) return 'blocked';
  return 'idle';
}

export function describeUnitAction(state, unit) {
  const action = chooseUnitAction(state, unit);
  const pursuit = selectTarget(state, unit);
  const target = action.target || pursuit;
  const entry = action.module || action.boost || null;
  return {
    ...action,
    targetId: target?.id || null,
    pursuitTargetId: pursuit?.id || null,
    moduleId: entry?.id || null,
    socket: entry?.socket || null,
    destination: action.type === 'move' ? [action.x, action.y] : null,
    basisTick: state.tick,
    stateRevision: state.revision
  };
}

export function cooldownFor(unit, entry, tick = 0) {
  const module = MODULES[entry.id];
  const overloaded = unit.overload?.moduleId === entry.id && unit.overload.until > tick;
  return Math.max(1, Math.round(module.cooldown * (overloaded ? 0.55 : 1) / TICK_SECONDS));
}
