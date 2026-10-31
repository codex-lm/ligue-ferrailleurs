import { mkdirSync, writeFileSync } from 'node:fs';
import { autoEquip } from '../src/sim/assembly.js';
import { runBattle, summarizeBattle } from '../src/sim/combat.js';

const unit = (id, chassis, modules, behavior = 'nearest') => autoEquip({ id, chassis, modules, behavior });
const configurations = {
  rivetGuard: [unit('guard', 'heavy', ['blade', 'repair']), unit('striker', 'heavy', ['blade']), unit('mender', 'light', ['blade', 'repair'])],
  sparkSkirmish: [unit('skirmisher', 'light', ['blaster', 'repair'], 'keepRange'), unit('needle', 'light', ['blaster'], 'keepRange'), unit('anchor', 'heavy', ['blaster', 'repair'], 'keepRange')],
  mixedScrap: [unit('wall', 'heavy', ['blade', 'repair'], 'protect'), unit('flanker', 'light', ['blade']), unit('shooter', 'light', ['blaster'], 'keepRange')]
};
const report = { schemaVersion: 1, stage: 'prototype', configurations: {}, duels: [] };
for (const [name, units] of Object.entries(configurations)) report.configurations[name] = units;
for (const [leftName, left] of Object.entries(configurations)) {
  for (const [rightName, right] of Object.entries(configurations)) {
    if (leftName >= rightName) continue;
    const forward = summarizeBattle(runBattle({ playerTeam: { units: left }, enemyTeam: { units: right } }));
    const reverse = summarizeBattle(runBattle({ playerTeam: { units: right }, enemyTeam: { units: left } }));
    report.duels.push({ left: leftName, right: rightName, forward, reverse });
    console.log(`${leftName} vs ${rightName}: ${forward.winner} / ${reverse.winner} (${forward.ticks}/${reverse.ticks} ticks)`);
  }
}
writeFileSync(new URL('../evidence/prototype-balance.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
