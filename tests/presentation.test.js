import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES } from '../src/data/catalog.js';
import { DEFAULT_TEAM, OPPONENTS } from '../src/data/campaign.js';
import { cloneBattle, createBattle, issueOrder, projectNextStep, runBattle, snapshotBattle, stepBattle } from '../src/sim/combat.js';
import { effectPreview, moduleTargets, previewOrder, rangeOverlay, targetIneligibility } from '../src/sim/presentation.js';

const unit = (id, chassis, modules, behavior = 'nearest', position = null) => ({ id, name: id, chassis, behavior, position, modules: modules.map(([id, socket]) => ({ id, socket })) });
const team = units => ({ units });
const basicTeam = (prefix = 'u') => team([
  unit(prefix + '1', 'heavy', [['blade', 'left']]),
  unit(prefix + '2', 'light', [['blaster', 'right']], 'keepRange'),
  unit(prefix + '3', 'spider', [['repair', 'top']])
]);

test('Manhattan ranges distinguish too-close targets and sensor extension', () => {
  const playerTeam = team([
    unit('source', 'light', [['blaster', 'right'], ['sensor', 'top']], 'nearest', [0, 1]),
    unit('ally-a', 'heavy', [], 'nearest', [0, 5]), unit('ally-b', 'heavy', [], 'nearest', [0, 6])
  ]);
  const enemyTeam = team([
    unit('near', 'heavy', [], 'nearest', [1, 1]), unit('far', 'heavy', [], 'nearest', [5, 1]), unit('away', 'heavy', [], 'nearest', [8, 6])
  ]);
  const state = createBattle({ playerTeam, enemyTeam });
  const source = state.units[0];
  const entry = source.modules.find(candidate => candidate.id === 'blaster');
  assert.equal(targetIneligibility(state, source, entry, state.units[3]), 'too-close');
  assert.deepEqual(moduleTargets(state, source, entry).map(target => target.id), ['far']);
  assert.equal(rangeOverlay(state, source, entry).find(cell => cell.x === 1 && cell.y === 1).kind, 'too-close');
  assert.equal(rangeOverlay(state, source, entry).find(cell => cell.x === 5 && cell.y === 1).kind, 'in-range');
  assert.equal(MODULES.blaster.minRange, 2);
});

test('Repair eligibility excludes self, full allies and enemies', () => {
  const state = createBattle({ playerTeam: basicTeam('p'), enemyTeam: basicTeam('e') });
  const source = state.units.find(candidate => candidate.id === 'p3');
  const injured = state.units.find(candidate => candidate.id === 'p2');
  injured.hp -= 9;
  source.hp -= 7;
  const entry = source.modules[0];
  assert.deepEqual(moduleTargets(state, source, entry).map(target => target.id), ['p2']);
  assert.equal(targetIneligibility(state, source, entry, source), 'self-repair');
  assert.equal(targetIneligibility(state, source, entry, state.units.find(candidate => candidate.id === 'p1')), 'full-hull');
  assert.equal(effectPreview(state, source, entry, injured).effectiveHeal, 9);
});

test('Damage preview and resolved event share armor, shield and effective hull math', () => {
  const playerTeam = team([unit('a', 'light', [['blade', 'left']], 'nearest', [0, 1]), unit('b', 'heavy', [], 'nearest', [0, 5]), unit('c', 'heavy', [], 'nearest', [0, 6])]);
  const enemyTeam = team([unit('target', 'heavy', [['armor', 'back'], ['shield', 'left']], 'nearest', [1, 1]), unit('d', 'heavy', [], 'nearest', [8, 5]), unit('e', 'heavy', [], 'nearest', [8, 6])]);
  const state = createBattle({ playerTeam, enemyTeam });
  const attacker = state.units[0], target = state.units[3];
  const preview = effectPreview(state, attacker, attacker.modules[0], target);
  assert.equal(preview.modified, 16);
  assert.equal(preview.armor, 2);
  assert.equal(preview.shieldFactor, 0.7);
  assert.equal(preview.rawDamage, 10);
  assert.equal(preview.effectiveDamage, 10);
  stepBattle(state);
  const event = state.events.find(candidate => candidate.type === 'attack' && candidate.target === 'target');
  assert.equal(event.amount, preview.effectiveDamage);
  assert.equal(event.hullBefore, 92);
  assert.equal(event.hullAfter, 82);
  assert.equal(event.mitigation, preview.mitigation);
  assert.deepEqual(event.actorCell, [0, 1]);
  assert.deepEqual(event.targetCell, [1, 1]);
});

test('Next-tick projection exactly matches the real alternating team processing', () => {
  const state = createBattle({ playerTeam: DEFAULT_TEAM, enemyTeam: OPPONENTS[2].team });
  for (let tick = 0; tick < 8; tick += 1) {
    const projection = projectNextStep(state);
    assert.equal(state.tick, tick);
    stepBattle(state);
    assert.deepEqual(projection.events, state.events.filter(event => event.tick === tick + 1));
    assert.deepEqual(projection.state.units.map(unit => [unit.id, unit.x, unit.y, unit.hp]), state.units.map(unit => [unit.id, unit.x, unit.y, unit.hp]));
  }
});

test('Passive overload is rejected without charge, event or state mutation', () => {
  const playerTeam = basicTeam('p');
  playerTeam.units[0].modules.push({ id: 'battery', socket: 'back' });
  const state = createBattle({ playerTeam, enemyTeam: basicTeam('e') });
  const before = snapshotBattle(state);
  const result = issueOrder(state, 'player', { type: 'overload', unitId: 'p1', moduleId: 'battery' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'passive');
  assert.deepEqual(snapshotBattle(state), before);
});

test('Order previews use a clone and leave live charges and orders untouched', () => {
  const state = createBattle({ playerTeam: DEFAULT_TEAM, enemyTeam: OPPONENTS[0].team });
  const before = snapshotBattle(state);
  const preview = previewOrder(state, 'player', { type: 'retreat', unitId: DEFAULT_TEAM.units[0].id });
  assert.equal(preview.result.ok, true);
  assert.equal(preview.state.charges.player, 2);
  assert.ok(preview.action.basisTick === 0);
  assert.deepEqual(snapshotBattle(state), before);
});

test('Snapshots remain independent from subsequent combat and cloning preserves events', () => {
  const state = createBattle({ playerTeam: DEFAULT_TEAM, enemyTeam: OPPONENTS[0].team });
  const snapshot = snapshotBattle(state);
  stepBattle(state);
  assert.equal(snapshot.tick, 0);
  assert.equal(snapshot.units[0].hp, 52);
  const cloned = cloneBattle(state);
  assert.deepEqual(cloned.events, state.events);
  assert.notEqual(cloned.units, state.units);
});

test('History keeps its beginning beyond the former 600-event implementation limit', () => {
  const state = createBattle({ playerTeam: basicTeam('p'), enemyTeam: basicTeam('e') });
  state.events = Array.from({ length: 600 }, (_, index) => ({ id: index + 1, tick: 0, type: 'fixture' }));
  state.nextEventId = 601;
  stepBattle(state);
  assert.ok(state.events.length > 600);
  assert.equal(state.events[0].id, 1);
  assert.equal(state.events[0].type, 'fixture');
});

test('Long no-weapon battles still finish at 90 seconds with explicit timeout data', () => {
  const peaceful = prefix => team([
    unit(prefix + '1', 'heavy', [], 'nearest'), unit(prefix + '2', 'heavy', [], 'nearest'), unit(prefix + '3', 'heavy', [], 'nearest')
  ]);
  const state = runBattle({ playerTeam: peaceful('p'), enemyTeam: peaceful('e') });
  assert.equal(state.result.tick, 900);
  assert.equal(state.result.reason, 'time-draw');
  assert.equal(state.result.winner, 'draw');
  assert.equal(state.events[0].id, 1);
});


test('Priority target ends visibly when its target is disabled', () => {
  const playerTeam = team([unit('a', 'light', [['blade', 'left']], 'nearest', [0, 1]), unit('b', 'heavy', [], 'nearest', [0, 5]), unit('c', 'heavy', [], 'nearest', [0, 6])]);
  const enemyTeam = team([unit('target', 'heavy', [], 'nearest', [1, 1]), unit('d', 'heavy', [], 'nearest', [8, 5]), unit('e', 'heavy', [], 'nearest', [8, 6])]);
  const state = createBattle({ playerTeam, enemyTeam });
  state.units[3].hp = 1;
  assert.equal(issueOrder(state, 'player', { type: 'target', unitId: 'a', targetId: 'target' }).ok, true);
  stepBattle(state);
  assert.equal(state.units[0].priorityTarget, null);
  assert.ok(state.events.some(event => event.type === 'order-ended' && event.order === 'target' && event.reason === 'target-disabled'));
});

test('Mortar victims share one action and center while allied hull is untouched', () => {
  const playerTeam = team([
    unit('mortar', 'light', [['mortar', 'top']], 'keepRange', [0, 1]),
    unit('ally-near', 'heavy', [], 'nearest', [2, 1]), unit('ally-far', 'heavy', [], 'nearest', [0, 6])
  ]);
  const enemyTeam = team([
    unit('center', 'heavy', [], 'nearest', [3, 1]), unit('victim-a', 'heavy', [], 'nearest', [3, 2]), unit('victim-b', 'heavy', [], 'nearest', [3, 0])
  ]);
  const state = createBattle({ playerTeam, enemyTeam });
  const allyHull = state.units[1].hp;
  stepBattle(state);
  const blasts = state.events.filter(event => event.type === 'blast');
  assert.equal(blasts.length, 3);
  assert.equal(new Set(blasts.map(event => event.actionId)).size, 1);
  assert.deepEqual(blasts.map(event => event.centerCell), [[3, 1], [3, 1], [3, 1]]);
  assert.equal(state.units[1].hp, allyHull);
});

test('Overload leaves engaged cooldown intact and reports duplicate sockets and replacement', () => {
  const playerTeam = team([unit('a', 'heavy', [['blade', 'left'], ['blade', 'right'], ['repair', 'back']]), unit('b', 'heavy', [], 'nearest', [0, 5]), unit('c', 'heavy', [], 'nearest', [0, 6])]);
  const state = createBattle({ playerTeam, enemyTeam: basicTeam('e') });
  const actor = state.units[0];
  actor.cooldowns.blade = 5;
  const first = issueOrder(state, 'player', { type: 'overload', unitId: 'a', moduleId: 'blade' });
  assert.equal(first.ok, true);
  assert.equal(actor.cooldowns.blade, 5);
  const firstEvent = state.events.find(event => event.id === first.eventId);
  assert.deepEqual(firstEvent.sockets, ['left', 'right']);
  const second = issueOrder(state, 'player', { type: 'overload', unitId: 'a', moduleId: 'repair' });
  const secondEvent = state.events.find(event => event.id === second.eventId);
  assert.equal(secondEvent.previousOverload.moduleId, 'blade');
  assert.deepEqual(secondEvent.sockets, ['back']);
  assert.equal(actor.overload.moduleId, 'repair');
});

test('Overloaded repair uses effective missing hull rather than raw potential', () => {
  const playerTeam = team([unit('a', 'heavy', [['repair', 'back']]), unit('b', 'heavy', [], 'nearest', [0, 5]), unit('c', 'heavy', [], 'nearest', [0, 6])]);
  const state = createBattle({ playerTeam, enemyTeam: basicTeam('e') });
  const actor = state.units[0], ally = state.units[1];
  ally.hp -= 10;
  assert.equal(issueOrder(state, 'player', { type: 'overload', unitId: 'a', moduleId: 'repair' }).ok, true);
  const preview = effectPreview(state, actor, actor.modules[0], ally);
  assert.equal(preview.possible, 20);
  assert.equal(preview.effectiveHeal, 10);
});
