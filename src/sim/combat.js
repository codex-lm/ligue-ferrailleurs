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
    moveCooldown: 0, cooldowns: {}, priorityTarget: null, retreatUntil: 0,
    overload: null, damageDealt: 0, damageTaken: 0, healingDone: 0,
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
  return { tick: 0, maxTicks, arena: board, units, charges: { player: 3, enemy: 3 }, result: null, events: [], nextEventId: 1 };
}

function emit(state, event) {
  state.events.push({ id: state.nextEventId++, tick: state.tick, ...event });
  if (state.events.length > 600) state.events.shift();
}

function deactivate(state, unit, source) {
  unit.hp = 0;
  unit.active = false;
  emit(state, { type: 'disabled', unit: unit.id, source: source?.id || null, x: unit.x, y: unit.y });
}

function shieldFactor(state, target) {
  const shielded = target.modules.some(entry => MODULES[entry.id]?.effect === 'shield') || state.units.some(unit => unit.active && unit.team === target.team && unit.id !== target.id && distance(unit, target) <= 1 && hasModule(unit, 'shield'));
  if (!shielded) return 1;
  return target.research.includes('protection-guard') ? 0.6 : 0.7;
}

function applyDamage(state, source, target, amount, moduleId) {
  if (!target.active) return 0;
  const module = MODULES[moduleId];
  const overloaded = source.overload?.moduleId === moduleId && source.overload.until > state.tick;
  let value = Math.max(1, Math.round(amount * (overloaded ? 1.35 : 1) * (hasModule(source, 'sensor') ? 1.15 : 1)));
  const armor = target.modules.reduce((sum, entry) => sum + (MODULES[entry.id]?.effect === 'armor' ? MODULES[entry.id].amount : 0), 0);
  value = Math.max(1, Math.round((value - armor) * shieldFactor(state, target)));
  const dealt = Math.min(target.hp, value);
  target.hp -= dealt;
  target.damageTaken += dealt;
  source.damageDealt += dealt;
  emit(state, { type: module?.effect === 'aoe' ? 'blast' : 'attack', unit: source.id, target: target.id, module: moduleId, amount: dealt, x: target.x, y: target.y });
  if (target.hp <= 0) deactivate(state, target, source);
  return dealt;
}

function performAction(state, unit, action) {
  unit.lastAction = action.type;
  if (action.type === 'move') {
    emit(state, { type: 'move', unit: unit.id, from: [unit.x, unit.y], x: action.x, y: action.y, dash: Boolean(action.boost) });
    unit.x = action.x;
    unit.y = action.y;
    unit.moveCooldown = Math.max(2, CHASSIS[unit.chassis].moveEvery - (unit.research.includes('mobility-agile') ? 1 : 0));
    if (action.boost) unit.cooldowns[action.boost.id] = cooldownFor(unit, action.boost, state.tick);
    return;
  }
  if (action.type === 'attack') {
    const module = MODULES[action.module.id];
    unit.cooldowns[action.module.id] = cooldownFor(unit, action.module, state.tick);
    unit.facing = action.target.x >= unit.x ? 1 : -1;
    if (module.effect === 'aoe') {
      const victims = state.units.filter(other => other.active && other.team !== unit.team && distance(other, action.target) <= module.area);
      victims.forEach(victim => applyDamage(state, unit, victim, module.damage, module.id));
    } else {
      applyDamage(state, unit, action.target, module.damage, module.id);
      if (module.effect === 'stun' && action.target.active) action.target.moveCooldown += 4;
    }
    return;
  }
  if (action.type === 'support') {
    const module = MODULES[action.module.id];
    unit.cooldowns[action.module.id] = cooldownFor(unit, action.module, state.tick);
    const overloaded = unit.overload?.moduleId === action.module.id && unit.overload.until > state.tick;
    const research = unit.research.includes('protection-repair') ? 1.2 : 1;
    const healed = Math.min(action.target.maxHp - action.target.hp, Math.round(module.heal * (overloaded ? 1.35 : 1) * research));
    action.target.hp += healed;
    unit.healingDone += healed;
    emit(state, { type: 'repair', unit: unit.id, target: action.target.id, module: action.module.id, amount: healed, x: action.target.x, y: action.target.y });
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
  for (const unit of state.units) {
    unit.moveCooldown = Math.max(0, unit.moveCooldown - 1);
    for (const id of Object.keys(unit.cooldowns)) unit.cooldowns[id] = Math.max(0, unit.cooldowns[id] - 1);
  }
  const order = state.units.filter(unit => unit.active).sort((a, b) => ((a.team === 'player' ? 0 : 1) - (b.team === 'player' ? 0 : 1)) * (state.tick % 2 ? 1 : -1) || a.id.localeCompare(b.id));
  for (const unit of order) {
    if (!unit.active || state.result) continue;
    performAction(state, unit, chooseUnitAction(state, unit));
    finish(state);
  }
  finish(state);
  return state;
}

export function issueOrder(state, team, order) {
  if (state.result || state.charges[team] <= 0) return { ok: false, reason: 'unavailable' };
  const unit = state.units.find(candidate => candidate.active && candidate.team === team && candidate.id === order.unitId);
  if (!unit) return { ok: false, reason: 'unit' };
  if (order.type === 'target') {
    const target = state.units.find(candidate => candidate.active && candidate.team !== team && candidate.id === order.targetId);
    if (!target) return { ok: false, reason: 'target' };
    unit.priorityTarget = target.id;
  } else if (order.type === 'retreat') {
    unit.retreatUntil = state.tick + 35;
  } else if (order.type === 'overload') {
    if (!unit.modules.some(entry => entry.id === order.moduleId)) return { ok: false, reason: 'module' };
    unit.overload = { moduleId: order.moduleId, until: state.tick + (unit.research.includes('power-surge') ? 70 : 50) };
  } else return { ok: false, reason: 'order' };
  state.charges[team] -= 1;
  emit(state, { type: 'order', order: order.type, unit: unit.id, target: order.targetId || null, module: order.moduleId || null });
  return { ok: true };
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
