import { BASE_UNLOCKED, CHASSIS } from '../data/catalog.js';
import { DEFAULT_TEAM, RESEARCH } from '../data/campaign.js';

export const clone = value => JSON.parse(JSON.stringify(value));

export function unlockedModules(research = []) {
  const unlocked = new Set(BASE_UNLOCKED);
  research.forEach(id => (RESEARCH[id]?.unlocks || []).forEach(module => unlocked.add(module)));
  return unlocked;
}

export function createCampaign() {
  return {
    schemaVersion: 1, encounter: 0, scrap: 12, research: [], researchPoints: 0,
    team: clone(DEFAULT_TEAM), hull: {}, previousSignature: null, completed: false,
    victories: 0, defeats: 0, rewards: []
  };
}

export function signature(team) {
  return team.units.map(unit => `${unit.chassis}:${unit.modules.map(entry => entry.id).sort().join('+')}`).sort().join('|');
}

export function applyVictory(campaign, state) {
  const currentSignature = signature(campaign.team);
  const variety = campaign.previousSignature && campaign.previousSignature !== currentSignature ? 6 : 0;
  const scrap = 18 + campaign.encounter * 4 + variety;
  campaign.scrap += scrap;
  campaign.researchPoints += 1;
  campaign.victories += 1;
  campaign.hull = Object.fromEntries(state.units.filter(unit => unit.team === 'player').map(unit => [unit.blueprintId, Math.max(1, unit.hp)]));
  campaign.rewards.push({ encounter: campaign.encounter, scrap, variety });
  campaign.previousSignature = currentSignature;
  campaign.encounter += 1;
  campaign.completed = campaign.encounter >= 6;
  return { scrap, variety, research: 1 };
}

export function applyDefeat(campaign) {
  campaign.defeats += 1;
  campaign.scrap += 8;
  return { scrap: 8 };
}

export function repairCost(campaign, unitId) {
  const unit = campaign.team.units.find(candidate => candidate.id === unitId);
  if (!unit) return 0;
  const hp = campaign.hull[unitId];
  if (hp === undefined) return 0;
  const maxHp = CHASSIS[unit.chassis].hp;
  return Math.ceil(Math.max(0, maxHp - hp) / 5);
}

export function repairUnit(campaign, unitId) {
  const cost = repairCost(campaign, unitId);
  if (!cost || campaign.scrap < cost) return false;
  campaign.scrap -= cost;
  delete campaign.hull[unitId];
  return true;
}

export function purchaseResearch(campaign, nodeId) {
  const node = RESEARCH[nodeId];
  if (!node || campaign.research.includes(nodeId) || campaign.researchPoints < 1) return false;
  if (node.requires && !campaign.research.includes(node.requires)) return false;
  campaign.research.push(nodeId);
  campaign.researchPoints -= 1;
  return true;
}

export function sanitizeCampaign(value) {
  if (!value || value.schemaVersion !== 1 || !value.team || !Array.isArray(value.team.units)) return createCampaign();
  const fresh = createCampaign();
  return {
    ...fresh, ...value,
    encounter: Math.max(0, Math.min(6, Number(value.encounter) || 0)),
    research: Array.isArray(value.research) ? value.research.filter(id => RESEARCH[id]) : [],
    rewards: Array.isArray(value.rewards) ? value.rewards.slice(-12) : []
  };
}
