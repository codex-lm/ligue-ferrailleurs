import { ARENAS, CHASSIS, hasModule, MAX_TICKS, MODULES, moduleEntry } from '../data/catalog.js';
import { chooseUnitAction, cooldownFor } from '../ai/behaviors.js';
import { distance, isAccessible, occupied } from './grid.js';
import { validateTeam } from './assembly.js';
import { unlockedModules } from './progression.js';

function makeRuntimeUnit(unit, team, index, arena, research) {
  const chassis = CHASSIS[unit.chassis];
  const start = unit.position || arena.starts[team][index];
  return {
    id: unit.id || `${team[0]}${index + 1}`, blueprintId: unit.id || `unit-${index + 1}`,
    name: unit.name || unit.id || `${team}-${index + 1}`,
    team, chassis: unit.chassis, behavior: unit.behavior || 'nearest', research: [...research],
    modules: (unit.modules || []).map(moduleEntry),
    x: start[0] ?? start.x, y: start[1] ?? start.y,
    hp: unit.hp ?? chassis.hp, maxHp: chassis.hp, active: true, narrow: chassis.narrow,
    moveCooldown: 0, cooldowns: {}, cooldownMaximums: {}, priorityTarget: null, retreatUntil: 0,
    overload: null, damageDealt: 0, damageTaken: 0, healingDone: 0, disables: 0, ordersReceived: 0,
    lastAction: null, facing: team === 'player' ? 1 : -1
  };
}

export function createBattle({ playerTeam, enemyTeam, arena = 'workbench', maxTicks = MAX_TICKS, playerHp = null, playerResearch = null, enemyResearch = null }) {
  const playerCheck = validateTeam(playerTeam, playerResearch ? unlockedModules(playerResearch) : null);
  const enemyCheck = validateTeam(enemyTeam, enemyResearch ? unlockedModules(enemyResearch) : null);
  if (!playerCheck.valid || !enemyCheck.valid) throw new Error(`Invalid team: ${JSON.stringify({ player: playerCheck.errors, enemy: enemyCheck.errors })}`);
  const board = typeof arena === 'string' ? ARENAS[arena] : arena;
  const units = [
    ...playerTeam.units.map((unit, index) => makeRuntimeUnit(unit, 'player', index, board, playerResearch || [])),
    ...enemyTeam.units.map((unit, index) => makeRuntimeUnit(unit, 'enemy', index, board, enemyResearch || []))
  ];
  for (const unit of units) {
    if (!isAccessible(board, unit.x, unit.y, true) || occupied({ units }, unit.x, unit.y, unit.id)) throw new Error(`Invalid start position for ${unit.id}`);
  }
  if (playerHp) units.filter(unit => unit.team === 'player').forEach(unit => { unit.hp = Math.max(1, Math.min(unit.maxHp, playerHp[unit.blueprintId] ?? unit.hp)); });
  return { tick: 0, maxTicks, arena: board, units, charges: { player: 3, enemy: 3 }, result: null, events: [], nextEventId: 1, sequenceInTick: 0, revision: 0 };
}

export const cloneBattle = state => JSON.parse(JSON.stringify(state));

export function snapshotBattle(state) {
  return cloneBattle({
    tick: state.tick, maxTicks: state.maxTicks, arena: state.arena, units: state.units,
    charges: state.charges, result: state.result, revision: state.revision
  });
}

function emit(state, event) {
  const complete = {
    id: state.nextEventId++, tick: state.tick, sequenceInTick: state.sequenceInTick++, ...event
  };
  state.events.push(complete);
  return complete;
}

function deactivate(state, unit, source) {
  unit.hp = 0;
  unit.active = false;
  if (source) source.disables = (source.disables || 0) + 1;
  emit(state, { type: 'disabled', unit: unit.id, source: source?.id || null, x: unit.x, y: unit.y, actorCell: source ? [source.x, source.y] : null, targetCell: [unit.x, unit.y] });
  for (const ally of state.units) {
    if (ally.priorityTarget !== unit.id) continue;
    ally.priorityTarget = null;
    emit(state, { type: 'order-ended', order: 'target', reason: 'target-disabled', unit: ally.id, target: unit.id });
  }
}

function shieldSources(state, target) {
  return state.units.filter(unit => unit.active && unit.team === target.team && hasModule(unit, 'shield') && (unit.id === target.id || distance(unit, target) <= 1));
}

export function calculateDamage(state, source, target, moduleId, amount = MODULES[moduleId]?.damage || 0) {
  if (!target.active) return { base: amount, modified: 0, armor: 0, shieldFactor: 1, shieldSources: [], rawDamage: 0, effectiveDamage: 0, mitigation: 0, hullBefore: target.hp, hullAfter: target.hp };
  const overloaded = source.overload?.moduleId === moduleId && source.overload.until > state.tick;
  const modified = Math.max(1, Math.round(amount * (overloaded ? 1.35 : 1) * (hasModule(source, 'sensor') ? 1.15 : 1)));
  const armor = target.modules.reduce((sum, entry) => sum + (MODULES[entry.id]?.effect === 'armor' ? MODULES[entry.id].amount : 0), 0);
  const protectors = shieldSources(state, target);
  const shieldFactor = protectors.length ? (target.research.includes('protection-guard') ? 0.6 : 0.7) : 1;
  const rawDamage = Math.max(1, Math.round((modified - armor) * shieldFactor));
  const dealt = Math.min(target.hp, rawDamage);
  return {
    base: amount, modified, armor, shieldFactor, shieldSources: protectors.map(unit => unit.id),
    rawDamage, effectiveDamage: dealt, mitigation: Math.max(0, modified - rawDamage),
    hullBefore: target.hp, hullAfter: target.hp - dealt
  };
}

export function calculateHealing(state, source, target, moduleId) {
  const module = MODULES[moduleId];
  const overloaded = source.overload?.moduleId === moduleId && source.overload.until > state.tick;
  const research = source.research.includes('protection-repair') ? 1.2 : 1;
  const possible = Math.round((module?.heal || 0) * (overloaded ? 1.35 : 1) * research);
  const effectiveHeal = Math.min(Math.max(0, target.maxHp - target.hp), possible);
  return { base: module?.heal || 0, possible, effectiveHeal, hullBefore: target.hp, hullAfter: target.hp + effectiveHeal };
}

function applyDamage(state, source, target, moduleId, actionId, socket, centerCell = null) {
  if (!target.active) return 0;
  const module = MODULES[moduleId];
  const result = calculateDamage(state, source, target, moduleId);
  target.hp = result.hullAfter;
  target.damageTaken += result.effectiveDamage;
  source.damageDealt += result.effectiveDamage;
  emit(state, {
    type: module?.effect === 'aoe' ? 'blast' : 'attack', actionId,
    unit: source.id, target: target.id, module: moduleId, socket: socket || null,
    amount: result.effectiveDamage, x: target.x, y: target.y,
    actorCell: [source.x, source.y], targetCell: [target.x, target.y], centerCell,
    hullBefore: result.hullBefore, hullAfter: result.hullAfter,
    effectiveDamage: result.effectiveDamage, mitigation: result.mitigation,
    base: result.base, modified: result.modified, armor: result.armor,
    shieldFactor: result.shieldFactor, shieldSources: result.shieldSources
  });
  if (target.hp <= 0) deactivate(state, target, source);
  return result.effectiveDamage;
}

function setCooldown(state, unit, entry) {
  const ticks = cooldownFor(unit, entry, state.tick);
  unit.cooldowns[entry.id] = ticks;
  unit.cooldownMaximums[entry.id] = ticks;
}

function performAction(state, unit, action) {
  unit.lastAction = action.type;
  if (action.type === 'move') {
    const from = [unit.x, unit.y];
    emit(state, {
      type: 'move', actionId: `${state.tick}:${unit.id}:move`, unit: unit.id,
      from, path: [from, [action.x, action.y]], x: action.x, y: action.y,
      actorCell: from, targetCell: [action.x, action.y], dash: Boolean(action.boost),
      module: action.boost?.id || null, socket: action.boost?.socket || null, reason: action.reason || 'pursue'
    });
    unit.x = action.x;
    unit.y = action.y;
    unit.moveCooldown = Math.max(2, CHASSIS[unit.chassis].moveEvery - (unit.research.includes('mobility-agile') ? 1 : 0));
    if (action.boost) setCooldown(state, unit, action.boost);
    return;
  }
  if (action.type === 'attack') {
    const module = MODULES[action.module.id];
    const actionId = `${state.tick}:${unit.id}:${action.module.id}:${state.sequenceInTick + 1}`;
    setCooldown(state, unit, action.module);
    unit.facing = action.target.x >= unit.x ? 1 : -1;
    if (module.effect === 'aoe') {
      const victims = state.units.filter(other => other.active && other.team !== unit.team && distance(other, action.target) <= module.area);
      victims.forEach(victim => applyDamage(state, unit, victim, module.id, actionId, action.module.socket, [action.target.x, action.target.y]));
    } else {
      applyDamage(state, unit, action.target, module.id, actionId, action.module.socket);
      if (module.effect === 'stun' && action.target.active) action.target.moveCooldown += 4;
    }
    return;
  }
  if (action.type === 'support') {
    const result = calculateHealing(state, unit, action.target, action.module.id);
    setCooldown(state, unit, action.module);
    action.target.hp = result.hullAfter;
    unit.healingDone += result.effectiveHeal;
    emit(state, {
      type: 'repair', actionId: `${state.tick}:${unit.id}:${action.module.id}`,
      unit: unit.id, target: action.target.id, module: action.module.id, socket: action.module.socket || null,
      amount: result.effectiveHeal, x: action.target.x, y: action.target.y,
      actorCell: [unit.x, unit.y], targetCell: [action.target.x, action.target.y],
      hullBefore: result.hullBefore, hullAfter: result.hullAfter,
      effectiveHeal: result.effectiveHeal, possible: result.possible
    });
  }
}

function finish(state) {
  const teams = ['player', 'enemy'];
  const alive = Object.fromEntries(teams.map(team => [team, state.units.some(unit => unit.active && unit.team === team)]));
  if (!alive.player || !alive.enemy) {
    state.result = { winner: alive.player ? 'player' : alive.enemy ? 'enemy' : 'draw', reason: 'neutralized', tick: state.tick };
    return;
  }
  if (state.tick < state.maxTicks) return;
  const hull = Object.fromEntries(teams.map(team => [team, state.units.filter(unit => unit.team === team).reduce((sum, unit) => sum + unit.hp / unit.maxHp, 0)]));
  const damage = Object.fromEntries(teams.map(team => [team, state.units.filter(unit => unit.team === team).reduce((sum, unit) => sum + unit.damageDealt, 0)]));
  const winner = Math.abs(hull.player - hull.enemy) > 0.0001 ? (hull.player > hull.enemy ? 'player' : 'enemy') : damage.player === damage.enemy ? 'draw' : damage.player > damage.enemy ? 'player' : 'enemy';
  state.result = { winner, reason: winner === 'draw' ? 'time-draw' : Math.abs(hull.player - hull.enemy) > 0.0001 ? 'time-hull' : 'time-damage', tick: state.tick, hull, damage };
}

export function stepBattle(state) {
  if (state.result) return state;
  state.tick += 1;
  state.sequenceInTick = 0;
  for (const unit of state.units) {
    unit.moveCooldown = Math.max(0, unit.moveCooldown - 1);
    for (const id of Object.keys(unit.cooldowns)) unit.cooldowns[id] = Math.max(0, unit.cooldowns[id] - 1);
    if (unit.retreatUntil === state.tick) emit(state, { type: 'order-ended', order: 'retreat', unit: unit.id, reason: 'expired' });
    if (unit.overload?.until === state.tick) emit(state, { type: 'order-ended', order: 'overload', unit: unit.id, module: unit.overload.moduleId, reason: 'expired' });
  }
  const order = state.units.filter(unit => unit.active).sort((a, b) => ((a.team === 'player' ? 0 : 1) - (b.team === 'player' ? 0 : 1)) * (state.tick % 2 ? 1 : -1) || a.id.localeCompare(b.id));
  for (const unit of order) {
    if (!unit.active || state.result) continue;
    performAction(state, unit, chooseUnitAction(state, unit));
    finish(state);
  }
  finish(state);
  state.revision += 1;
  return state;
}

export function issueOrder(state, team, order) {
  if (state.result || state.charges[team] <= 0) return { ok: false, reason: 'unavailable' };
  const unit = state.units.find(candidate => candidate.active && candidate.team === team && candidate.id === order.unitId);
  if (!unit) return { ok: false, reason: 'unit' };
  let target = null;
  let sockets = [];
  let previousOverload = null;
  let untilTick = null;
  if (order.type === 'target') {
    target = state.units.find(candidate => candidate.active && candidate.team !== team && candidate.id === order.targetId);
    if (!target) return { ok: false, reason: 'target' };
    unit.priorityTarget = target.id;
  } else if (order.type === 'retreat') {
    untilTick = state.tick + 35;
    unit.retreatUntil = untilTick;
  } else if (order.type === 'overload') {
    const entries = unit.modules.filter(entry => entry.id === order.moduleId);
    if (!entries.length) return { ok: false, reason: 'module' };
    if (entries.some(entry => MODULES[entry.id]?.kind === 'passive')) return { ok: false, reason: 'passive' };
    previousOverload = unit.overload ? { ...unit.overload } : null;
    untilTick = state.tick + (unit.research.includes('power-surge') ? 70 : 50);
    sockets = entries.map(entry => entry.socket);
    unit.overload = { moduleId: order.moduleId, until: untilTick };
  } else return { ok: false, reason: 'order' };
  state.charges[team] -= 1;
  unit.ordersReceived = (unit.ordersReceived || 0) + 1;
  const event = emit(state, {
    type: 'order', order: order.type, unit: unit.id, target: target?.id || null,
    module: order.moduleId || null, sockets, untilTick, previousOverload,
    actorCell: [unit.x, unit.y], targetCell: target ? [target.x, target.y] : null,
    chargesAfter: state.charges[team]
  });
  state.revision += 1;
  return { ok: true, eventId: event.id, chargesAfter: state.charges[team], untilTick };
}

export function projectNextStep(state) {
  const projected = cloneBattle(state);
  const firstEventId = projected.nextEventId;
  stepBattle(projected);
  return { state: projected, events: projected.events.filter(event => event.id >= firstEventId) };
}

export function runBattle(config) {
  const state = createBattle(config);
  while (!state.result) stepBattle(state);
  return state;
}

export function summarizeBattle(state) {
  return {
    winner: state.result.winner, reason: state.result.reason, ticks: state.result.tick,
    playerHull: state.units.filter(unit => unit.team === 'player').reduce((sum, unit) => sum + unit.hp, 0),
    enemyHull: state.units.filter(unit => unit.team === 'enemy').reduce((sum, unit) => sum + unit.hp, 0),
    playerDamage: state.units.filter(unit => unit.team === 'player').reduce((sum, unit) => sum + unit.damageDealt, 0),
    enemyDamage: state.units.filter(unit => unit.team === 'enemy').reduce((sum, unit) => sum + unit.damageDealt, 0)
  };
}
