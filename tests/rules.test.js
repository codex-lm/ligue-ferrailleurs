import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENAS, CHASSIS, MODULES, weaponRange } from '../src/data/catalog.js';
import { DEFAULT_TEAM, OPPONENTS, RESEARCH } from '../src/data/campaign.js';
import { validateTeam, validateUnit } from '../src/sim/assembly.js';
import { createBattle, issueOrder, runBattle, stepBattle, summarizeBattle } from '../src/sim/combat.js';
import { findPath, isAccessible } from '../src/sim/grid.js';
import { applyVictory, createCampaign, purchaseResearch, repairCost, repairUnit, unlockedModules } from '../src/sim/progression.js';
import { createStorage, loadBlueprints, loadCampaign, saveBlueprint, saveCampaign } from '../src/sim/storage.js';
import { cooldownFor } from '../src/ai/behaviors.js';

const unit = (id, chassis, modules, behavior = 'nearest', position = null) => ({ id, name: id, chassis, behavior, position, modules: modules.map(([id, socket]) => ({ id, socket })) });
const team = units => ({ units });
const basicTeam = (prefix = 'u') => team([
  unit(prefix + '1', 'heavy', [['blade', 'left']]),
  unit(prefix + '2', 'light', [['blaster', 'right']], 'keepRange'),
  unit(prefix + '3', 'spider', [['repair', 'top']])
]);

test('weight and energy have separate explanatory limits; battery adds capacity', () => {
  const invalid = unit('limits', 'light', [['blade', 'left'], ['blaster', 'right'], ['repair', 'top']]);
  const check = validateUnit(invalid);
  assert.deepEqual(new Set(check.errors.map(error => error.code)), new Set(['weight', 'energy']));
  const hungry = unit('hungry', 'heavy', [['hammer', 'left'], ['shield', 'right'], ['repair', 'back']]);
  const hungryCheck = validateUnit(hungry);
  assert.deepEqual(hungryCheck.errors.map(error => error.code), ['energy']);
  assert.equal(hungryCheck.energy, 8);
  assert.equal(hungryCheck.maxEnergy, 7);
  const batteryBuild = unit('battery', 'heavy', [['blade', 'left'], ['shield', 'right'], ['blaster', 'top'], ['battery', 'back']]);
  assert.equal(validateUnit(batteryBuild).valid, true);
  assert.equal(validateUnit(batteryBuild).maxEnergy, CHASSIS.heavy.energy + 4);
});

test('all six opponents and the default team satisfy their own unlock rules', () => {
  for (const opponent of OPPONENTS) assert.equal(validateTeam(opponent.team, unlockedModules(opponent.research)).valid, true, opponent.id);
  assert.equal(validateTeam(DEFAULT_TEAM, unlockedModules([])).valid, true);
  assert.equal(Object.keys(RESEARCH).length, 9);
});

test('spider alone crosses narrow cells and deterministic paths cannot cross walls', () => {
  const arena = { ...ARENAS.workbench, width: 7, height: 3, obstacles: [[3, 0], [3, 2]], narrow: [[3, 1]] };
  const spider = { id: 's', x: 1, y: 1, narrow: true };
  const light = { id: 'l', x: 1, y: 1, narrow: false };
  const state = { arena, units: [spider] };
  assert.equal(isAccessible(arena, 3, 1, false), false);
  assert.equal(isAccessible(arena, 3, 1, true), true);
  assert.ok(findPath(state, spider, (x, y) => x === 5 && y === 1));
  assert.equal(findPath({ arena, units: [light] }, light, (x, y) => x === 5 && y === 1), null);
});

test('targeting sensor extends range and overload expires', () => {
  const unitWithSensor = { modules: [{ id: 'sensor' }] };
  assert.equal(weaponRange(unitWithSensor, MODULES.blaster), MODULES.blaster.range + 1);
  const runtime = { overload: { moduleId: 'blade', until: 50 } };
  assert.equal(cooldownFor(runtime, { id: 'blade' }, 20), 4);
  assert.equal(cooldownFor(runtime, { id: 'blade' }, 51), 8);
});

test('spring boost crosses two clear cells and starts its recharge', () => {
  const playerTeam = team([
    unit('dash', 'light', [['blade', 'left'], ['boost', 'back']], 'nearest', [0, 1]),
    unit('far-a', 'heavy', [], 'nearest', [0, 5]),
    unit('far-b', 'heavy', [], 'nearest', [0, 6])
  ]);
  const enemyTeam = team([
    unit('target', 'heavy', [], 'nearest', [6, 1]),
    unit('far-c', 'heavy', [], 'nearest', [8, 5]),
    unit('far-d', 'heavy', [], 'nearest', [8, 6])
  ]);
  const state = createBattle({ playerTeam, enemyTeam });
  stepBattle(state);
  const dasher = state.units.find(unit => unit.id === 'dash');
  assert.equal(dasher.x, 2);
  assert.ok(dasher.cooldowns.boost >= 39);
  assert.ok(state.events.some(event => event.unit === 'dash' && event.dash));
});

test('armor and shield change incoming damage rather than only displayed stats', () => {
  const make = (targetModules) => {
    const playerTeam = team([
      unit('attacker', 'light', [['blade', 'left']], 'nearest', [0, 1]),
      unit('ally-a', 'heavy', [], 'nearest', [0, 5]), unit('ally-b', 'heavy', [], 'nearest', [0, 6])
    ]);
    const enemyTeam = team([
      unit('target', 'heavy', targetModules, 'nearest', [1, 1]),
      unit('enemy-a', 'heavy', [], 'nearest', [8, 5]), unit('enemy-b', 'heavy', [], 'nearest', [8, 6])
    ]);
    return createBattle({ playerTeam, enemyTeam });
  };
  const plain = make([]), armored = make([['armor', 'back']]), shielded = make([['shield', 'left']]);
  stepBattle(plain); stepBattle(armored); stepBattle(shielded);
  const taken = state => state.units.find(unit => unit.id === 'target').damageTaken;
  assert.equal(taken(plain), 16);
  assert.equal(taken(armored), 14);
  assert.equal(taken(shielded), 11);
});

test('three tactical orders spend exactly three shared charges', () => {
  const state = createBattle({ playerTeam: basicTeam('p'), enemyTeam: basicTeam('e') });
  assert.equal(issueOrder(state, 'player', { type: 'target', unitId: 'p1', targetId: 'e1' }).ok, true);
  assert.equal(issueOrder(state, 'player', { type: 'retreat', unitId: 'p1' }).ok, true);
  assert.equal(issueOrder(state, 'player', { type: 'overload', unitId: 'p1', moduleId: 'blade' }).ok, true);
  assert.equal(state.charges.player, 3 - 3);
  assert.equal(issueOrder(state, 'player', { type: 'retreat', unitId: 'p1' }).ok, false);
  assert.equal(state.units.find(unit => unit.id === 'p1').priorityTarget, 'e1');
  assert.equal(state.units.find(unit => unit.id === 'p1').overload.moduleId, 'blade');
});

test('neutralization and time tiebreak produce explicit results', () => {
  const state = createBattle({ playerTeam: basicTeam('p'), enemyTeam: basicTeam('e') });
  state.units.filter(unit => unit.team === 'enemy').forEach(unit => { unit.active = false; unit.hp = 0; });
  stepBattle(state);
  assert.deepEqual(state.result, { winner: 'player', reason: 'neutralized', tick: 1 });
  const timed = createBattle({ playerTeam: basicTeam('p'), enemyTeam: basicTeam('e'), maxTicks: 1 });
  timed.units.find(unit => unit.id === 'e1').hp = 10;
  stepBattle(timed);
  assert.equal(timed.result.reason, 'time-hull');
  assert.equal(timed.result.winner, 'player');
});

test('identical configurations produce identical battles and every arena terminates', () => {
  for (const arena of Object.keys(ARENAS)) {
    const first = runBattle({ playerTeam: DEFAULT_TEAM, enemyTeam: OPPONENTS[2].team, arena });
    const second = runBattle({ playerTeam: DEFAULT_TEAM, enemyTeam: OPPONENTS[2].team, arena });
    assert.deepEqual(summarizeBattle(first), summarizeBattle(second));
    assert.ok(first.result.tick <= 900);
  }
});

test('research prerequisites, salvage, variety bonus and repairs persist', () => {
  const campaign = createCampaign();
  assert.equal(purchaseResearch(campaign, 'power-mortar'), false);
  campaign.researchPoints = 1;
  assert.equal(purchaseResearch(campaign, 'power-hammer'), true);
  assert.ok(unlockedModules(campaign.research).has('hammer'));
  const state = runBattle({ playerTeam: DEFAULT_TEAM, enemyTeam: OPPONENTS[0].team });
  state.result = { winner: 'player' };
  const first = applyVictory(campaign, state);
  assert.equal(first.scrap, 18);
  campaign.team.units[0].modules.push({ id: 'battery', socket: 'back' });
  const second = applyVictory(campaign, state);
  assert.equal(second.variety, 6);
  campaign.hull[campaign.team.units[0].id] = 10;
  const cost = repairCost(campaign, campaign.team.units[0].id);
  campaign.scrap = cost;
  assert.ok(cost > 0);
  assert.equal(repairUnit(campaign, campaign.team.units[0].id), true);
  assert.equal(repairCost(campaign, campaign.team.units[0].id), 0);
});

test('campaign and four local blueprint slots round-trip through storage', () => {
  const values = new Map();
  const backing = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const storage = createStorage(backing);
  const campaign = createCampaign();
  campaign.scrap = 42;
  assert.equal(saveCampaign(storage, campaign), true);
  assert.equal(loadCampaign(storage).scrap, 42);
  for (let slot = 0; slot < 4; slot += 1) assert.equal(saveBlueprint(storage, slot, DEFAULT_TEAM, `Plan ${slot}`), true);
  assert.deepEqual(loadBlueprints(storage).map(plan => plan.name), ['Plan 0', 'Plan 1', 'Plan 2', 'Plan 3']);
  assert.equal(saveBlueprint(storage, 4, DEFAULT_TEAM, 'bad'), false);
});
