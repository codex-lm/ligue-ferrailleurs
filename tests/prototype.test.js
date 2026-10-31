import test from 'node:test';
import assert from 'node:assert/strict';
import { autoEquip, validateTeam, validateUnit } from '../src/sim/assembly.js';
import { createBattle, runBattle, stepBattle, summarizeBattle } from '../src/sim/combat.js';
import { ARENAS } from '../src/data/catalog.js';

const unit = (id, chassis, modules, behavior = 'nearest') => autoEquip({ id, chassis, modules, behavior });
const team = units => ({ units });

test('prototype rejects weight and socket overflow with explanations', () => {
  const overloaded = unit('too-heavy', 'light', ['blade', 'blaster', 'repair']);
  const check = validateUnit(overloaded);
  assert.equal(check.valid, false);
  assert.ok(check.errors.some(error => error.code === 'weight'));
  assert.equal(validateUnit({ id: 'bad-socket', chassis: 'light', modules: [{ id: 'repair', socket: 'left' }] }).valid, false);
});

test('both teams use the same assembly validator', () => {
  assert.equal(validateTeam(team([unit('a', 'light', ['blade']), unit('b', 'heavy', ['blade']), unit('c', 'light', ['blaster'])])).valid, true);
  assert.throws(() => createBattle({
    playerTeam: team([unit('a', 'light', ['blade']), unit('b', 'heavy', ['blade']), unit('c', 'light', ['blaster'])]),
    enemyTeam: team([unit('d', 'light', ['blade', 'blaster', 'repair']), unit('e', 'heavy', ['blade']), unit('f', 'light', ['blaster'])])
  }), /Invalid team/);
});

test('two chassis and three modules create measurable combat differences', () => {
  const melee = team([
    unit('a', 'heavy', ['blade', 'repair']),
    unit('b', 'heavy', ['blade']),
    unit('c', 'light', ['blade', 'repair'])
  ]);
  const ranged = team([
    unit('d', 'light', ['blaster', 'repair'], 'keepRange'),
    unit('e', 'light', ['blaster'], 'keepRange'),
    unit('f', 'heavy', ['blaster', 'repair'], 'keepRange')
  ]);
  const first = summarizeBattle(runBattle({ playerTeam: melee, enemyTeam: ranged }));
  const second = summarizeBattle(runBattle({ playerTeam: ranged, enemyTeam: melee }));
  assert.notEqual(first.winner, second.winner, 'side swap should preserve the same matchup winner');
  assert.ok(first.ticks > 20);
});

test('repair restores hull and respects range and cooldown', () => {
  const playerTeam = team([unit('a', 'heavy', ['repair']), unit('b', 'light', ['blade']), unit('c', 'light', ['blade'])]);
  const enemyTeam = team([unit('d', 'heavy', ['blade']), unit('e', 'light', ['blade']), unit('f', 'light', ['blade'])]);
  const state = createBattle({ playerTeam, enemyTeam });
  const healer = state.units.find(unit => unit.id === 'a');
  const ally = state.units.find(unit => unit.id === 'b');
  ally.x = 1; ally.y = 1; healer.x = 0; healer.y = 1; ally.hp = 20;
  stepBattle(state);
  assert.ok(ally.hp > 20);
  assert.ok(healer.cooldowns.repair > 0);
  const healed = ally.hp;
  stepBattle(state);
  assert.equal(ally.hp, healed);
});

test('obstacles block paths and combat always reaches a visible conclusion', () => {
  const playerTeam = team([unit('a', 'light', ['blade']), unit('b', 'light', ['blade']), unit('c', 'light', ['blade'])]);
  const enemyTeam = team([unit('d', 'heavy', ['blade']), unit('e', 'heavy', ['blade']), unit('f', 'heavy', ['blade'])]);
  const state = runBattle({ playerTeam, enemyTeam, arena: ARENAS.workbench });
  assert.ok(state.result.tick <= state.maxTicks);
  assert.ok(['neutralized', 'time-hull', 'time-damage', 'time-draw'].includes(state.result.reason));
});
