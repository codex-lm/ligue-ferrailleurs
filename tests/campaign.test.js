import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEAM, OPPONENTS } from '../src/data/campaign.js';
import { createBattle, issueOrder, runBattle, stepBattle, summarizeBattle } from '../src/sim/combat.js';
import { applyVictory, createCampaign, purchaseResearch, repairCost, repairUnit } from '../src/sim/progression.js';

const unit = (id, chassis, modules, behavior = 'nearest') => ({ id, name: id, chassis, behavior, modules: modules.map(([id, socket]) => ({ id, socket })) });
const wall = () => unit('wall', 'heavy', [['shield', 'left'], ['armor', 'back'], ['blaster', 'top']], 'protect');
const gun = () => unit('gun', 'heavy', [['blaster', 'right'], ['repair', 'back'], ['battery', 'top']], 'keepRange');
const rangedTeam = () => ({ units: [wall(), gun(), unit('mortar', 'spider', [['mortar', 'top'], ['battery', 'back'], ['blade', 'left']], 'keepRange')] });
const finalTeam = () => ({ units: [wall(), gun(), unit('dart', 'spider', [['blaster', 'right'], ['sensor', 'left'], ['boost', 'back']], 'keepRange')] });

test('five encounters and the finale are beatable through ordinary builds, repairs, research and orders', () => {
  const campaign = createCampaign();
  const nodes = ['power-hammer', 'protection-armor', 'power-mortar', 'mobility-boost', 'mobility-sensor'];
  const summaries = [];
  for (const opponent of OPPONENTS) {
    if (campaign.encounter >= 3) campaign.team = campaign.encounter === 5 ? finalTeam() : rangedTeam();
    const config = { playerTeam: campaign.team, enemyTeam: opponent.team, arena: opponent.arena, playerResearch: campaign.research, enemyResearch: opponent.research, playerHp: campaign.hull };
    let state;
    if (campaign.encounter === 5) {
      state = createBattle(config);
      assert.equal(issueOrder(state, 'player', { type: 'target', unitId: 'wall', targetId: 'rival-b' }).ok, true);
      assert.equal(issueOrder(state, 'player', { type: 'target', unitId: 'dart', targetId: 'rival-b' }).ok, true);
      assert.equal(issueOrder(state, 'player', { type: 'overload', unitId: 'wall', moduleId: 'blaster' }).ok, true);
      while (!state.result) stepBattle(state);
    } else state = runBattle(config);
    summaries.push({ opponent: opponent.id, ...summarizeBattle(state) });
    assert.equal(state.result.winner, 'player', `Failed at ${opponent.id}`);
    applyVictory(campaign, state);
    if (campaign.encounter <= 5) assert.equal(purchaseResearch(campaign, nodes[campaign.encounter - 1]), true);
    for (const member of campaign.team.units) if (repairCost(campaign, member.id) <= campaign.scrap) repairUnit(campaign, member.id);
  }
  assert.equal(campaign.completed, true);
  assert.equal(campaign.victories, 6);
  assert.equal(campaign.research.length, 5);
  assert.ok(summaries[5].ticks < 900);
});
