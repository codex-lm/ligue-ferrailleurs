import { mkdirSync, writeFileSync } from 'node:fs';
import { EXAMPLE_TEAMS, OPPONENTS, RESEARCH } from '../src/data/campaign.js';
import { validateTeam } from '../src/sim/assembly.js';
import { runBattle, summarizeBattle } from '../src/sim/combat.js';

const unit = (id, chassis, modules, behavior = 'nearest') => ({ id, name: id, chassis, behavior, modules: modules.map(([id, socket]) => ({ id, socket })) });
const configurations = {
  ...EXAMPLE_TEAMS,
  rangedWall: { units: [
    unit('wall', 'heavy', [['shield', 'left'], ['armor', 'back'], ['blaster', 'top']], 'protect'),
    unit('gun', 'heavy', [['blaster', 'right'], ['repair', 'back'], ['battery', 'top']], 'keepRange'),
    unit('mortar', 'spider', [['mortar', 'top'], ['battery', 'back'], ['blade', 'left']], 'keepRange')
  ] },
  hammerPair: { units: [
    unit('mallet', 'heavy', [['hammer', 'left'], ['repair', 'back'], ['battery', 'top']]),
    unit('rivet', 'heavy', [['hammer', 'left'], ['blaster', 'right']]),
    unit('mender', 'spider', [['blaster', 'right'], ['repair', 'top'], ['battery', 'back']], 'keepRange')
  ] }
};
const allResearch = Object.keys(RESEARCH);
const report = { schemaVersion: 1, stage: 'complete', configurations, validation: {}, duels: [], opponentMatches: [], dominantConfigurations: [] };
for (const [name, team] of Object.entries(configurations)) {
  report.validation[name] = validateTeam(team, new Set(Object.keys((await import('../src/data/catalog.js')).MODULES)));
  if (!report.validation[name].valid) throw new Error(`Invalid example ${name}`);
}
for (const [leftName, left] of Object.entries(configurations)) {
  for (const [rightName, right] of Object.entries(configurations)) {
    if (leftName >= rightName) continue;
    const forward = summarizeBattle(runBattle({ playerTeam: left, enemyTeam: right, playerResearch: allResearch, enemyResearch: allResearch }));
    const reverse = summarizeBattle(runBattle({ playerTeam: right, enemyTeam: left, playerResearch: allResearch, enemyResearch: allResearch }));
    report.duels.push({ left: leftName, right: rightName, forward, reverse });
    console.log(`${leftName} vs ${rightName}: ${forward.winner} / ${reverse.winner}`);
  }
}
for (const [name, team] of Object.entries(configurations)) {
  const losses = report.duels.filter(duel => duel.left === name || duel.right === name).filter(duel => {
    const wonForward = duel.left === name ? duel.forward.winner === 'player' : duel.forward.winner === 'enemy';
    const wonReverse = duel.left === name ? duel.reverse.winner === 'enemy' : duel.reverse.winner === 'player';
    return !wonForward || !wonReverse;
  });
  if (!losses.length) report.dominantConfigurations.push(name);
}
const campaignResearch = ['power-hammer', 'protection-armor', 'power-mortar', 'mobility-boost', 'mobility-sensor'];
for (const [name, team] of Object.entries(configurations)) {
  for (const opponent of OPPONENTS) {
    const summary = summarizeBattle(runBattle({ playerTeam: team, enemyTeam: opponent.team, arena: opponent.arena, playerResearch: campaignResearch, enemyResearch: opponent.research }));
    report.opponentMatches.push({ configuration: name, opponent: opponent.id, ...summary });
  }
}
mkdirSync(new URL('../evidence/', import.meta.url), { recursive: true });
writeFileSync(new URL('../evidence/balance.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Dominant configurations: ${report.dominantConfigurations.join(', ') || 'none'}`);
