import { ARENAS, BEHAVIORS, CHASSIS, MAX_TICKS, MODULES, SOCKETS } from './data/catalog.js';
import { DEFAULT_TEAM, EXAMPLE_TEAMS, OPPONENTS, RESEARCH } from './data/campaign.js';
import { translate } from './i18n.js';
import { validateTeam, validateUnit } from './sim/assembly.js';
import { createBattle, issueOrder, stepBattle } from './sim/combat.js';
import { applyDefeat, applyVictory, clone, createCampaign, purchaseResearch, repairCost, repairUnit, unlockedModules } from './sim/progression.js';
import { createStorage, loadBlueprints, loadCampaign, saveBlueprint, saveCampaign } from './sim/storage.js';
import { Renderer } from './render/renderer.js';
import { AudioBus } from './audio.js';

const app = document.getElementById('app');
const storage = createStorage();
const preferences = storage.get('preferences', { lang: 'en', sound: true, seenHelp: false });
const allResearch = Object.keys(RESEARCH);
const state = {
  lang: ['en', 'fr', 'es'].includes(preferences.lang) ? preferences.lang : 'en',
  screen: 'home', mode: 'campaign', campaign: loadCampaign(storage),
  selectedUnit: 0, editSide: 0, battle: null, paused: false, speed: 1,
  selectedBattleUnit: null, orderMode: null, help: false, toast: null,
  lab: { teams: [clone(DEFAULT_TEAM), clone(OPPONENTS[2].team)], arena: 'workbench', history: [] },
  lastReward: null, hasSave: Boolean(storage.get('campaign', null))
};
const audio = new AudioBus(preferences.sound !== false);
const scene = document.createElement('div');
scene.className = 'scene-card';
scene.innerHTML = '<canvas id="scene-gl" aria-label="3D mechanical automatons"></canvas><canvas id="scene-overlay"></canvas><div class="scene-caption" id="scene-caption"></div><div id="scene-extra"></div>';
let renderer;
let accumulator = 0;
let previousFrame = performance.now();
let previousHud = 0;
let lastAudioEvent = 0;
let toastTimer;

const t = (key, vars) => translate(state.lang, key, vars);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const currentTeam = () => state.mode === 'campaign' ? state.campaign.team : state.lab.teams[state.editSide];
const currentOpponent = () => state.mode === 'campaign' ? OPPONENTS[Math.min(state.campaign.encounter, OPPONENTS.length - 1)] : { name: 'testRange', arena: state.lab.arena, research: allResearch, team: state.lab.teams[1 - state.editSide] };
const currentResearch = () => state.mode === 'campaign' ? state.campaign.research : allResearch;
const currentUnlocked = () => unlockedModules(currentResearch());
const socketName = socket => socket === 'back' ? t('backSocket') : t(socket);

function persistPreferences() {
  storage.set('preferences', { lang: state.lang, sound: audio.enabled, seenHelp: preferences.seenHelp });
}

function persistCampaign() {
  saveCampaign(storage, state.campaign);
  state.hasSave = true;
}

function toast(message) {
  state.toast = message;
  clearTimeout(toastTimer);
  const show = () => {
    document.querySelector('.toast')?.remove();
    const element = document.createElement('div');
    element.className = 'toast';
    element.setAttribute('role', 'status');
    element.textContent = message;
    document.body.appendChild(element);
    toastTimer = setTimeout(() => element.remove(), 2400);
  };
  show();
}

function moduleChips(unit) {
  return unit.modules.length ? unit.modules.map(entry => `<span class="chip">${esc(t(entry.id))}</span>`).join('') : `<span class="small">${t('empty')}</span>`;
}

function unitHull(unit) {
  if (state.mode !== 'campaign') return CHASSIS[unit.chassis].hp;
  return state.campaign.hull[unit.id] ?? CHASSIS[unit.chassis].hp;
}

function header() {
  const encounter = state.mode === 'campaign' && !state.campaign.completed ? `${state.campaign.encounter === 5 ? t('finale') : `${t('encounter')} ${state.campaign.encounter + 1}`} ${t('of')} 6` : t(state.screen === 'home' ? 'title' : state.screen);
  return `<header class="topbar">
    <button class="brand" data-action="home" aria-label="${esc(t('title'))}"><span class="brand-mark">⚙</span>${esc(t('title'))}</button>
    <div class="crumbs"><span>${esc(encounter)}</span><span>·</span><span>${state.mode === 'lab' ? t('testRange') : t('campaign')}</span></div>
    ${state.mode === 'campaign' ? `<span class="resource">⚙ <strong>${state.campaign.scrap}</strong> ${t('scrap')}</span><span class="resource">✦ <strong>${state.campaign.researchPoints}</strong></span>` : ''}
    <div class="top-actions">
      <select class="lang-select" data-change="language" aria-label="${t('language')}"><option value="en" ${state.lang === 'en' ? 'selected' : ''}>EN</option><option value="fr" ${state.lang === 'fr' ? 'selected' : ''}>FR</option><option value="es" ${state.lang === 'es' ? 'selected' : ''}>ES</option></select>
      <button class="icon-button" data-action="sound" aria-label="${t('sound')}" title="${t('sound')}">${audio.enabled ? '♪' : '∅'}</button>
      <button class="icon-button help-button" data-action="help" aria-label="${t('howTo')}" title="${t('howTo')}">?</button>
    </div>
  </header>`;
}

function homeView() {
  return `<main class="main"><div class="home-grid">
    <section class="panel hero">
      <div class="eyebrow">Kimi Games · LOB7</div>
      <h1>${esc(t('title'))}</h1>
      <p class="tagline">${esc(t('tagline'))}</p>
      <p class="muted">${esc(t('intro'))}</p>
      <div class="hero-actions">
        ${state.hasSave ? `<button class="primary" data-action="continue">▶ ${t('continue')}</button>` : ''}
        <button class="${state.hasSave ? 'secondary' : 'primary'}" data-action="new-campaign">⚙ ${t('newCampaign')}</button>
        <button class="secondary" data-action="test-range">↔ ${t('testRange')}</button>
        <button class="ghost" data-action="help">? ${t('howTo')}</button>
      </div>
      <div class="feature-list"><span class="chip">3 ${t('chassis').toLowerCase()}</span><span class="chip">10 ${t('modules').toLowerCase()}</span><span class="chip">6 ${t('arena').toLowerCase()}</span><span class="chip">EN · FR · ES</span></div>
      <p class="small" style="margin-top:22px">${t('localOnly')}</p>
    </section>
    <div data-scene></div>
  </div></main>`;
}

function unitTabs() {
  return `<div class="unit-tabs">${currentTeam().units.map((unit, index) => {
    const hp = unitHull(unit), max = CHASSIS[unit.chassis].hp;
    return `<button class="unit-tab ${index === state.selectedUnit ? 'active' : ''}" data-action="select-unit" data-index="${index}">
      <span class="unit-number">${index + 1}</span><span><strong>${esc(unit.name)}</strong><small>${t(unit.chassis)} · ${Math.ceil(hp)}/${max} ${t('hull')}</small></span><span class="hp-pip" style="height:${Math.max(4, 30 * hp / max)}px"></span>
    </button>`;
  }).join('')}</div>`;
}

function opponentPanel() {
  const opponent = currentOpponent();
  return `<section class="panel opponent-card"><div class="panel-title"><h3>${t('opponentIntel')}</h3><span class="chip">${t(opponent.arena)}</span></div>
    <strong class="orange-text">${esc(t(opponent.name))}</strong>
    <div class="enemy-list" style="margin-top:10px">${opponent.team.units.map(unit => `<div class="enemy-row"><strong><span>${esc(unit.name)}</span><span>${t(unit.chassis)}</span></strong><small>${t(unit.behavior)} · ${unit.modules.map(entry => t(entry.id)).join(' + ')}</small></div>`).join('')}</div>
  </section>`;
}

function positionPanel() {
  const team = currentTeam();
  return `<section class="panel"><div class="panel-title"><h3>${t('startPositions')}</h3><span class="small">1 / 2 / 3</span></div>
    <p class="small">${t('positionHelp')}</p>
    <div class="position-grid">${Array.from({ length: 21 }, (_, index) => {
      const x = index % 3, y = Math.floor(index / 3);
      const occupant = team.units.findIndex(unit => (unit.position?.[0] ?? 0) === x && (unit.position?.[1] ?? [1, 3, 5][team.units.indexOf(unit)]) === y);
      return `<button class="position-cell ${occupant >= 0 ? 'occupied' : ''}" data-action="position" data-x="${x}" data-y="${y}" aria-label="${x + 1},${y + 1}">${occupant >= 0 ? occupant + 1 : '·'}</button>`;
    }).join('')}</div>
  </section>`;
}

function errorText(error) {
  const names = { 'unknown-chassis': 'chassis', 'unknown-module': 'unknownModule', 'locked-module': 'lockedModule', 'bad-socket': 'badSocket', 'occupied-socket': 'occupiedSocket', 'team-size': 'teamSize', weight: 'overweight', energy: 'overenergy' };
  const detail = error.actual !== undefined ? ` (${error.actual}/${error.limit})` : error.id ? ` · ${t(error.id)}` : '';
  return `${t(names[error.code] || error.code)}${detail}`;
}

function assemblyPanel() {
  const team = currentTeam();
  const unit = team.units[state.selectedUnit];
  const unlocked = currentUnlocked();
  const check = validateUnit(unit, unlocked);
  const teamCheck = validateTeam(team, unlocked);
  const behaviors = BEHAVIORS.filter(behavior => behavior !== 'fragile' || state.mode === 'lab' || state.campaign.research.includes('mobility-agile'));
  if (!behaviors.includes(unit.behavior)) behaviors.push(unit.behavior);
  return `<section class="panel"><div class="panel-title"><h2>${esc(unit.name)}</h2><span class="chip">${t(unit.chassis)}</span></div>
    <div class="field"><label for="unit-name">${t('selected')}</label><input id="unit-name" type="text" maxlength="16" value="${esc(unit.name)}" data-change="unit-name"></div>
    <div class="field"><label for="unit-chassis">${t('chassis')}</label><select id="unit-chassis" data-change="chassis">${Object.values(CHASSIS).map(chassis => `<option value="${chassis.id}" ${unit.chassis === chassis.id ? 'selected' : ''}>${t(chassis.id)} · ${chassis.hp} ${t('hull')}</option>`).join('')}</select><span class="small">${t(`${unit.chassis}Desc`)}</span></div>
    <div class="field"><label for="unit-behavior">${t('behavior')}</label><select id="unit-behavior" data-change="behavior">${behaviors.map(behavior => `<option value="${behavior}" ${unit.behavior === behavior ? 'selected' : ''}>${t(behavior)}</option>`).join('')}</select><span class="small">${t('behaviorHelp')}</span></div>
    <div class="socket-grid">${SOCKETS.map(socket => {
      const current = unit.modules.find(entry => entry.socket === socket);
      const options = Object.values(MODULES).filter(module => module.sockets.includes(socket) && (unlocked.has(module.id) || current?.id === module.id));
      return `<div class="socket-row"><label>${socketName(socket)}</label><select data-change="socket" data-socket="${socket}" aria-label="${socketName(socket)}"><option value="">${t('empty')}</option>${options.map(module => `<option value="${module.id}" ${current?.id === module.id ? 'selected' : ''}>${t(module.id)} · ${module.weight}⚙ ${module.energy}ϟ</option>`).join('')}</select></div>`;
    }).join('')}</div>
    <div class="meter-head"><span>${t('weight')}</span><strong>${check.weight}/${check.maxWeight}</strong></div><div class="meter ${check.weight > check.maxWeight ? 'over' : ''}"><span style="width:${Math.min(100, check.weight / check.maxWeight * 100)}%"></span></div>
    <div class="meter-head"><span>${t('energy')}</span><strong>${check.energy}/${check.maxEnergy}</strong></div><div class="meter ${check.energy > check.maxEnergy ? 'over' : ''}"><span style="width:${Math.min(100, check.energy / check.maxEnergy * 100)}%"></span></div>
    <div class="validation ${teamCheck.valid ? '' : 'invalid'}"><strong>${teamCheck.valid ? '✓ ' + t('validBuild') : '× ' + t('invalidBuild')}</strong>${teamCheck.errors.length ? `<br>${teamCheck.errors.map(errorText).join('<br>')}` : ''}</div>
    <button class="primary wide" data-action="start-battle" ${teamCheck.valid ? '' : 'disabled'}>▶ ${state.mode === 'lab' ? t('compare') : t('launch')}</button>
  </section>`;
}

function plansPanel() {
  if (state.mode === 'campaign') return '';
  const plans = loadBlueprints(storage);
  return `<section class="panel"><div class="panel-title"><h3>${t('blueprints')}</h3><span class="small">${t('localOnly')}</span></div>
    <div class="plan-grid">${plans.map((plan, index) => `<div class="plan-slot"><strong>${esc(plan?.name || `${t('planSlot')} ${index + 1}`)}</strong><div class="button-row"><button data-action="save-plan" data-slot="${index}">${t('savePlan')}</button><button data-action="load-plan" data-slot="${index}" ${plan ? '' : 'disabled'}>${t('loadPlan')}</button></div></div>`).join('')}</div>
    <div class="field" style="margin-top:12px"><label>${t('examples')}</label><select id="example-select">${Object.keys(EXAMPLE_TEAMS).map(name => `<option value="${name}">${t(name)}</option>`).join('')}</select></div><button class="secondary wide" data-action="apply-example">${t('applyExample')}</button>
  </section>`;
}

function workshopView() {
  const opponent = currentOpponent();
  return `<main class="main"><div class="workshop-grid">
    <aside class="workshop-side">
      <section class="panel"><div class="panel-title"><h2>${state.mode === 'lab' ? t(state.editSide === 0 ? 'teamA' : 'teamB') : t('yourTeam')}</h2><span class="eyebrow">${state.mode === 'campaign' && state.campaign.encounter === 5 ? t('finale') : t('workshop')}</span></div>
      ${state.mode === 'lab' ? `<div class="button-row" style="margin-bottom:10px"><button class="grow ${state.editSide === 0 ? 'primary' : ''}" data-action="edit-side" data-side="0">${t('editA')}</button><button class="grow ${state.editSide === 1 ? 'primary' : ''}" data-action="edit-side" data-side="1">${t('editB')}</button></div><div class="field"><label>${t('arenaSelect')}</label><select data-change="lab-arena">${Object.keys(ARENAS).map(id => `<option value="${id}" ${state.lab.arena === id ? 'selected' : ''}>${t(id)}</option>`).join('')}</select></div>` : ''}
      ${unitTabs()}</section>
      ${opponentPanel()}
    </aside>
    <section class="workshop-center"><div data-scene style="flex:1;display:flex"></div>${positionPanel()}</section>
    <aside class="workshop-side">${assemblyPanel()}${plansPanel()}</aside>
  </div><p class="footer-note">${state.mode === 'campaign' && state.campaign.encounter === 5 ? t('finalReady') : t('localOnly')}</p></main>`;
}

function combatUnitButton(unit) {
  const selected = state.selectedBattleUnit === unit.id;
  return `<button class="combat-unit ${unit.team} ${selected ? 'active' : ''}" data-action="combat-unit" data-id="${unit.id}" ${unit.active ? '' : 'disabled'}><strong>${esc(unit.name)}</strong><span class="tiny" style="float:right">${Math.ceil(unit.hp)}/${unit.maxHp}</span><small style="display:block;margin-top:3px">${t(unit.behavior)}</small><div class="hull-line"><span style="width:${Math.max(0, unit.hp / unit.maxHp * 100)}%"></span></div></button>`;
}

function combatTeamPanel() {
  if (!state.battle) return '';
  const player = state.battle.units.filter(unit => unit.team === 'player');
  const enemy = state.battle.units.filter(unit => unit.team === 'enemy');
  return `<section class="panel"><div class="panel-title"><h3>${t('yourTeam')}</h3><span class="small">${player.filter(unit => unit.active).length}/3</span></div>${player.map(combatUnitButton).join('')}</section>
    <section class="panel"><div class="panel-title"><h3>${state.orderMode?.type === 'target' ? t('chooseEnemy') : t('enemyTeam')}</h3><span class="small">${enemy.filter(unit => unit.active).length}/3</span></div>${enemy.map(combatUnitButton).join('')}</section>`;
}

function inspectPanel() {
  const battle = state.battle;
  const unit = battle?.units.find(candidate => candidate.id === state.selectedBattleUnit) || battle?.units[0];
  if (!unit) return '';
  return `<section class="panel"><div class="panel-title"><h3>${esc(unit.name)}</h3><span class="chip">${t(unit.chassis)}</span></div>
    <p class="small">${t(unit.behavior)} · ${unit.active ? t('active') : t('disabled')}</p>
    <div class="inspect-modules">${unit.modules.map(entry => {
      const module = MODULES[entry.id];
      const cooling = unit.cooldowns[entry.id] || 0;
      const maximum = Math.max(1, Math.round(module.cooldown * 10));
      const ready = cooling <= 0;
      return `<div class="inspect-module"><header><strong>${t(entry.id)}</strong><span>${ready ? '✓' : (cooling / 10).toFixed(1) + t('seconds')}</span></header><span class="tiny">${socketName(entry.socket)} · ${module.range ? `${t('range')} ${module.range}` : t(module.kind)}</span><div class="cooldown-line"><span style="width:${100 - Math.min(100, cooling / maximum * 100)}%"></span></div>${state.orderMode?.type === 'overload' && unit.team === 'player' ? `<button class="wide" style="margin-top:7px" data-action="overload-module" data-module="${entry.id}">ϟ ${t('overload')}</button>` : ''}</div>`;
    }).join('')}</div>
  </section>`;
}

function battleLog() {
  const events = state.battle.events.filter(event => ['attack', 'blast', 'repair', 'disabled', 'order'].includes(event.type)).slice(-5).reverse();
  if (!events.length) return `<div>${t('noEvents')}</div>`;
  const name = id => state.battle.units.find(unit => unit.id === id)?.name || id;
  return events.map(event => {
    let text = '';
    if (event.type === 'disabled') text = `${name(event.unit)} ${t('eventDisabled')}`;
    else if (event.type === 'order') text = `${t('eventOrder')}: ${t(event.order)} · ${name(event.unit)}`;
    else text = `${name(event.unit)} ${t(event.type === 'repair' ? 'eventRepair' : 'eventAttack')} ${name(event.target)} · ${event.amount}`;
    return `<div>${esc(text)}</div>`;
  }).join('');
}

function combatView() {
  const opponent = currentOpponent();
  return `<main class="main"><div class="combat-grid">
    <aside class="combat-side" id="combat-left">${combatTeamPanel()}</aside>
    <section class="combat-center">
      <div class="panel" style="padding:10px 13px"><div class="button-row"><button data-action="pause" id="pause-button" class="secondary">${state.paused ? '▶ ' + t('resume') : 'Ⅱ ' + t('pause')}</button><button data-action="speed" class="ghost">» <span id="speed-value">${state.speed}</span>×</button><div style="flex:1"></div><div class="timer"><span class="small">${t('timeLeft')}</span><strong id="timer-value">1:30</strong></div></div></div>
      <div data-scene style="flex:1;display:flex"></div>
      <div class="panel" style="padding:10px"><div class="orders"><button data-action="order-target" class="${state.orderMode?.type === 'target' ? 'armed' : ''}">◎ ${t('target')}</button><button data-action="order-retreat">↩ ${t('retreat')}</button><button data-action="order-overload" class="${state.orderMode?.type === 'overload' ? 'armed' : ''}">ϟ ${t('overload')}</button></div><div class="small" id="order-help" style="margin-top:7px">${state.orderMode ? t(state.orderMode.type === 'target' ? 'chooseEnemy' : 'chooseModule') : t('tiebreak')}</div></div>
    </section>
    <aside class="combat-side"><section class="panel"><div class="panel-title"><h3>${esc(t(opponent.name))}</h3><span class="chip">${t(state.battle.arena.id)}</span></div><div class="charge-dots" id="charge-dots"></div><p class="small" style="margin:7px 0 0">${t('charges')}</p></section><div id="inspect-holder">${inspectPanel()}</div><section class="panel"><div class="panel-title"><h3>${t('status')}</h3></div><div class="battle-log" id="battle-log">${battleLog()}</div></section></aside>
  </div></main>`;
}

function resultView() {
  const battle = state.battle;
  if (!battle?.result) return '';
  const result = battle.result;
  const won = result.winner === 'player';
  const draw = result.winner === 'draw';
  const reason = result.reason === 'neutralized' ? 'neutralized' : result.reason === 'time-hull' ? 'timeHull' : result.reason === 'time-damage' ? 'timeDamage' : 'timeDraw';
  const hull = team => Math.ceil(battle.units.filter(unit => unit.team === team).reduce((sum, unit) => sum + unit.hp, 0));
  return `<div class="result-veil"><section class="result-card ${won || draw ? '' : 'defeat'}"><div class="eyebrow">${state.mode === 'lab' ? t('comparison') : t('arena')}</div><h2>${draw ? t('draw') : won ? t('victory') : t('defeat')}</h2><p>${t(reason)}</p><div class="result-stats"><span><strong>${hull('player')}</strong>${state.mode === 'lab' ? 'A' : t('yourTeam')}</span><span><strong>${hull('enemy')}</strong>${state.mode === 'lab' ? 'B' : t('enemyTeam')}</span><span><strong>${(result.tick / 10).toFixed(1)}s</strong>${t('timeLeft')}</span></div><div class="button-row" style="justify-content:center">${state.mode === 'lab' ? `<button class="primary" data-action="swap-replay">↔ ${t('swapReplay')}</button><button data-action="fight-again">${t('newFight')}</button><button data-action="edit-teams">${t('editTeams')}</button>` : won ? `<button class="primary" data-action="claim">${t('claim')} →</button>` : `<button class="orange" data-action="retry">${t('retry')}</button>`}</div></section></div>`;
}

function repairPanel() {
  return `<section class="panel"><div class="panel-title"><h2>${t('repairs')}</h2><span class="resource">⚙ ${state.campaign.scrap}</span></div><div class="repair-list">${state.campaign.team.units.map(unit => {
    const cost = repairCost(state.campaign, unit.id);
    const hp = unitHull(unit), max = CHASSIS[unit.chassis].hp;
    return `<div class="repair-row"><header><strong>${esc(unit.name)}</strong><span>${Math.ceil(hp)}/${max}</span></header><div class="hull-line"><span style="width:${hp / max * 100}%"></span></div><button data-action="repair" data-id="${unit.id}" ${!cost || state.campaign.scrap < cost ? 'disabled' : ''}>${cost ? `${t('repair')} · ⚙ ${cost}` : t('fullHull')}</button></div>`;
  }).join('')}</div></section>`;
}

function researchPanel() {
  return `<section class="panel"><div class="panel-title"><div><h2>${t('researchChoice')}</h2><p class="small" style="margin:4px 0 0">${t('researchHelp')}</p></div><span class="resource">✦ ${state.campaign.researchPoints}</span></div><div class="research-branches">${['power', 'protection', 'mobility'].map(branch => `<div class="research-branch"><h3>${t(branch)}</h3>${Object.values(RESEARCH).filter(node => node.branch === branch).map(node => {
    const owned = state.campaign.research.includes(node.id);
    const requirement = !node.requires || state.campaign.research.includes(node.requires);
    return `<div class="research-node ${owned ? 'owned' : ''}"><span class="tiny">0${node.tier}</span><h3>${t(node.id)}</h3><p>${t(`${node.id}Desc`)}</p><button data-action="research" data-id="${node.id}" ${owned || !requirement || state.campaign.researchPoints < 1 ? 'disabled' : ''}>${owned ? '✓ ' + t('unlocked') : requirement ? '✦ ' + t('unlock') : `${t('requires')} ${t(node.requires)}`}</button></div>`;
  }).join('')}</div>`).join('')}</div></section>`;
}

function rewardView() {
  if (state.campaign.completed) return completeView();
  return `<main class="main"><div class="eyebrow">${t('encounter')} ${state.campaign.encounter}/6</div><h1 style="font-size:clamp(2rem,4vw,3.7rem);margin:8px 0 18px">${t('salvage')}</h1><div class="panel" style="margin-bottom:15px"><div class="button-row"><span class="chip">⚙ +${state.lastReward?.scrap || 0} ${t('scrap')}</span>${state.lastReward?.variety ? `<span class="chip lime">✦ +${state.lastReward.variety} ${t('varietyBonus')}</span>` : ''}<span class="chip">✦ +1 ${t('researchPoints')}</span></div><p class="small" style="margin:10px 0 0">${t('salvageText')}</p></div><div class="reward-grid"><aside>${repairPanel()}<button class="primary wide" style="margin-top:14px" data-action="next-arena">${t('nextArena')} →</button></aside>${researchPanel()}</div></main>`;
}

function completeView() {
  return `<main class="main"><section class="panel hero" style="min-height:65vh;text-align:center;align-items:center"><div class="eyebrow">${t('finale')}</div><h1>${t('campaignComplete')}</h1><p class="tagline">${t('campaignCompleteText')}</p><div class="feature-list"><span class="chip">${state.campaign.victories} ${t('victory')}</span><span class="chip">⚙ ${state.campaign.scrap}</span><span class="chip">✦ ${state.campaign.research.length}/9</span></div><div class="hero-actions"><button class="primary" data-action="new-campaign">${t('playAgain')}</button><button data-action="test-range">${t('keepExperimenting')}</button></div></section></main>`;
}

function helpModal() {
  if (!state.help) return '';
  return `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><section class="modal-card"><div class="panel-title"><h2 id="help-title">${t('helpTitle')}</h2><button class="icon-button" data-action="close-help">×</button></div><div class="help-steps"><div class="help-step"><strong>${t('helpBuild')}</strong><p>${t('helpBuildText')}</p></div><div class="help-step"><strong>${t('helpFight')}</strong><p>${t('helpFightText')}</p></div><div class="help-step"><strong>${t('helpProgress')}</strong><p>${t('helpProgressText')}</p></div></div><p class="small">${t('helpRange')}</p><p class="small">${t('keyboard')}</p><button class="primary wide" data-action="close-help">${t('gotIt')}</button></section></div>`;
}

function render() {
  document.documentElement.lang = state.lang;
  document.title = `${t('title')} — Kimi Games`;
  const views = { home: homeView, workshop: workshopView, combat: combatView, reward: rewardView, complete: completeView };
  app.innerHTML = `${header()}${(views[state.screen] || homeView)()}${helpModal()}`;
  const host = app.querySelector('[data-scene]');
  if (host) host.appendChild(scene);
  const extra = document.getElementById('scene-extra');
  if (state.screen !== 'combat' && extra) { extra.innerHTML = ''; extra.dataset.result = ''; }
  const caption = document.getElementById('scene-caption');
  if (caption) caption.textContent = state.screen === 'combat' ? t('tiebreak') : state.mode === 'lab' ? t('testRangeHelp') : t('behaviorHelp');
  updateCombatHud();
}

function updateCombatHud() {
  if (state.screen !== 'combat' || !state.battle) return;
  const remaining = Math.max(0, Math.ceil((state.battle.maxTicks - state.battle.tick) / 10));
  const timer = document.getElementById('timer-value');
  if (timer) {
    timer.textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
    timer.style.color = remaining <= 15 ? 'var(--orange)' : 'var(--lime)';
  }
  const speed = document.getElementById('speed-value');
  if (speed) speed.textContent = state.speed;
  const pause = document.getElementById('pause-button');
  if (pause) pause.textContent = state.paused ? `▶ ${t('resume')}` : `Ⅱ ${t('pause')}`;
  const left = document.getElementById('combat-left');
  if (left) left.innerHTML = combatTeamPanel();
  const inspect = document.getElementById('inspect-holder');
  if (inspect) inspect.innerHTML = inspectPanel();
  const log = document.getElementById('battle-log');
  if (log) log.innerHTML = battleLog();
  const charges = document.getElementById('charge-dots');
  if (charges) charges.innerHTML = Array.from({ length: 3 }, (_, index) => `<span class="charge-dot ${index < state.battle.charges.player ? '' : 'used'}"></span>`).join('');
  const extra = document.getElementById('scene-extra');
  if (extra && !extra.dataset.result || extra && extra.dataset.result !== String(state.battle.result?.tick || '')) {
    extra.innerHTML = resultView();
    extra.dataset.result = String(state.battle.result?.tick || '');
  }
}

function resetRendererEvents() {
  renderer.lastEvent = 0;
  renderer.animations.clear();
  renderer.effects = [];
  lastAudioEvent = 0;
  accumulator = 0;
}

function startBattle() {
  const team = currentTeam();
  const check = validateTeam(team, currentUnlocked());
  if (!check.valid) { toast(`${t('invalidBuild')}: ${check.errors.map(errorText).join(', ')}`); return; }
  const opponent = currentOpponent();
  try {
    state.battle = createBattle({
      playerTeam: team, enemyTeam: opponent.team, arena: opponent.arena,
      playerResearch: currentResearch(), enemyResearch: opponent.research,
      playerHp: state.mode === 'campaign' ? state.campaign.hull : null
    });
  } catch (error) { toast(error.message); return; }
  if (state.mode === 'campaign') persistCampaign();
  state.selectedBattleUnit = state.battle.units.find(unit => unit.team === 'player').id;
  state.paused = false;
  state.speed = 1;
  state.orderMode = null;
  state.screen = 'combat';
  state.battle.settled = false;
  resetRendererEvents();
  audio.unlock();
  render();
}

function settleDefeat() {
  if (state.mode !== 'campaign' || !state.battle?.result || state.battle.result.winner === 'player' || state.battle.settled) return;
  state.battle.settled = true;
  applyDefeat(state.campaign);
  persistCampaign();
}

function processAudio() {
  if (!state.battle) return;
  for (const event of state.battle.events) {
    if (event.id <= lastAudioEvent) continue;
    lastAudioEvent = event.id;
    if (['attack', 'blast', 'repair', 'disabled', 'order'].includes(event.type)) audio.event(event.type);
  }
}

function selectCombatUnit(id) {
  const unit = state.battle.units.find(candidate => candidate.id === id && candidate.active);
  if (!unit) return;
  if (state.orderMode?.type === 'target' && unit.team === 'enemy') {
    const result = issueOrder(state.battle, 'player', { type: 'target', unitId: state.selectedBattleUnit, targetId: id });
    if (result.ok) { state.orderMode = null; toast(t('targetSet')); audio.event('order'); }
    else toast(t('noCharges'));
  } else state.selectedBattleUnit = id;
  updateCombatHud();
}

function simpleOrder(type, moduleId = null) {
  const unit = state.battle.units.find(candidate => candidate.id === state.selectedBattleUnit && candidate.team === 'player' && candidate.active);
  if (!unit) return;
  const result = issueOrder(state.battle, 'player', { type, unitId: unit.id, moduleId });
  if (result.ok) {
    state.orderMode = null;
    toast(t(type === 'retreat' ? 'retreatSet' : 'overloadSet'));
    audio.event('order');
  } else toast(t('noCharges'));
  updateCombatHud();
}

function closeHelp() {
  state.help = false;
  preferences.seenHelp = true;
  persistPreferences();
  render();
}

function handleAction(button) {
  const action = button.dataset.action;
  audio.unlock();
  if (action === 'home') { state.screen = 'home'; state.battle = null; render(); }
  else if (action === 'help') { state.help = true; render(); }
  else if (action === 'close-help') closeHelp();
  else if (action === 'sound') { audio.enabled = !audio.enabled; persistPreferences(); render(); }
  else if (action === 'new-campaign') {
    if (state.hasSave && state.campaign.encounter > 0 && !window.confirm(t('confirmNew'))) return;
    state.campaign = createCampaign(); state.mode = 'campaign'; state.selectedUnit = 0; state.screen = 'workshop'; state.hasSave = true;
    persistCampaign(); state.help = !preferences.seenHelp; render();
  }
  else if (action === 'continue') { state.mode = 'campaign'; state.screen = state.campaign.completed ? 'complete' : 'workshop'; state.selectedUnit = 0; render(); }
  else if (action === 'test-range') { state.mode = 'lab'; state.screen = 'workshop'; state.editSide = 0; state.selectedUnit = 0; render(); }
  else if (action === 'select-unit') { state.selectedUnit = Number(button.dataset.index); render(); }
  else if (action === 'edit-side') { state.editSide = Number(button.dataset.side); state.selectedUnit = 0; render(); }
  else if (action === 'position') {
    const unit = currentTeam().units[state.selectedUnit];
    const x = Number(button.dataset.x), y = Number(button.dataset.y);
    const previous = unit.position || [0, [1, 3, 5][state.selectedUnit]];
    const other = currentTeam().units.find((candidate, index) => candidate !== unit && (candidate.position?.[0] ?? 0) === x && (candidate.position?.[1] ?? [1, 3, 5][index]) === y);
    if (other) other.position = previous;
    unit.position = [x, y];
    if (state.mode === 'campaign') persistCampaign();
    render();
  }
  else if (action === 'start-battle') startBattle();
  else if (action === 'pause') { state.paused = !state.paused; updateCombatHud(); }
  else if (action === 'speed') { state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 4 : 1; updateCombatHud(); }
  else if (action === 'combat-unit') selectCombatUnit(button.dataset.id);
  else if (action === 'order-target') { state.orderMode = { type: 'target' }; toast(t('chooseEnemy')); updateCombatHud(); }
  else if (action === 'order-retreat') simpleOrder('retreat');
  else if (action === 'order-overload') { state.orderMode = { type: 'overload' }; toast(t('chooseModule')); updateCombatHud(); }
  else if (action === 'overload-module') simpleOrder('overload', button.dataset.module);
  else if (action === 'claim') {
    const reward = applyVictory(state.campaign, state.battle);
    state.lastReward = reward; persistCampaign(); state.screen = 'reward'; state.battle = null; audio.event('victory'); render();
  }
  else if (action === 'retry') { state.screen = 'workshop'; state.battle = null; render(); }
  else if (action === 'next-arena') { state.screen = state.campaign.completed ? 'complete' : 'workshop'; state.selectedUnit = 0; render(); }
  else if (action === 'repair') { if (repairUnit(state.campaign, button.dataset.id)) { persistCampaign(); toast(t('repaired')); } else toast(t('notEnoughScrap')); render(); }
  else if (action === 'research') { if (purchaseResearch(state.campaign, button.dataset.id)) { persistCampaign(); toast(t('unlocked')); audio.event('repair'); } render(); }
  else if (action === 'swap-replay') { state.lab.teams.reverse(); startBattle(); }
  else if (action === 'fight-again') startBattle();
  else if (action === 'edit-teams') { state.screen = 'workshop'; state.battle = null; render(); }
  else if (action === 'save-plan') { saveBlueprint(storage, Number(button.dataset.slot), currentTeam(), `${t(state.editSide === 0 ? 'teamA' : 'teamB')} ${Number(button.dataset.slot) + 1}`); toast(t('saved')); render(); }
  else if (action === 'load-plan') { const plan = loadBlueprints(storage)[Number(button.dataset.slot)]; if (plan) { state.lab.teams[state.editSide] = clone(plan.team); state.selectedUnit = 0; toast(t('loaded')); render(); } }
  else if (action === 'apply-example') { const selected = document.getElementById('example-select').value; state.lab.teams[state.editSide] = clone(EXAMPLE_TEAMS[selected]); state.selectedUnit = 0; render(); }
}

app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button && !button.disabled) handleAction(button);
});

scene.addEventListener('click', event => {
  if (event.target.closest('button')) return;
  if (event.target.tagName.toLowerCase() !== 'canvas') return;
  const picked = renderer.pick(event.clientX, event.clientY);
  if (!picked) return;
  if (picked.type === 'work-unit' && state.screen === 'workshop') { state.selectedUnit = picked.index; render(); }
  if (picked.type === 'unit' && state.screen === 'combat') selectCombatUnit(picked.id);
});

app.addEventListener('change', event => {
  const input = event.target.closest('[data-change]');
  if (!input) return;
  const action = input.dataset.change;
  if (action === 'language') { state.lang = input.value; persistPreferences(); render(); return; }
  if (action === 'lab-arena') { state.lab.arena = input.value; render(); return; }
  const unit = currentTeam().units[state.selectedUnit];
  if (action === 'unit-name') unit.name = input.value.trim().slice(0, 16) || unit.name;
  if (action === 'chassis') unit.chassis = input.value;
  if (action === 'behavior') unit.behavior = input.value;
  if (action === 'socket') {
    unit.modules = unit.modules.filter(entry => entry.socket !== input.dataset.socket);
    if (input.value) unit.modules.push({ id: input.value, socket: input.dataset.socket });
  }
  if (state.mode === 'campaign') persistCampaign();
  render();
});

window.addEventListener('keydown', event => {
  if (event.target.matches('input, select')) return;
  if (event.key.toLowerCase() === 'm') { audio.enabled = !audio.enabled; persistPreferences(); render(); }
  if (event.key === 'Escape') { if (state.help) closeHelp(); else if (state.screen === 'combat') { state.paused = !state.paused; updateCombatHud(); } }
  if (state.screen !== 'combat' || !state.battle) return;
  if (event.code === 'Space') { event.preventDefault(); state.paused = !state.paused; updateCombatHud(); }
  if (['1', '2', '3'].includes(event.key)) { const unit = state.battle.units.filter(candidate => candidate.team === 'player')[Number(event.key) - 1]; if (unit?.active) state.selectedBattleUnit = unit.id; updateCombatHud(); }
  if (event.key.toLowerCase() === 't') { state.orderMode = { type: 'target' }; updateCombatHud(); }
  if (event.key.toLowerCase() === 'r') simpleOrder('retreat');
  if (event.key.toLowerCase() === 'o') { state.orderMode = { type: 'overload' }; updateCombatHud(); }
});

function frame(now) {
  const delta = Math.min(100, now - previousFrame);
  previousFrame = now;
  if (state.screen === 'combat' && state.battle) {
    if (!state.paused && !state.battle.result) {
      accumulator += delta * state.speed;
      while (accumulator >= 100 && !state.battle.result) {
        stepBattle(state.battle);
        accumulator -= 100;
      }
      processAudio();
      settleDefeat();
    }
    renderer.renderBattle(state.battle, state.selectedBattleUnit, now);
    if (!state.paused && now - previousHud > 140) { updateCombatHud(); previousHud = now; }
  } else if (['home', 'workshop'].includes(state.screen)) {
    renderer.renderWorkshop(currentTeam().units, state.selectedUnit, now);
  }
  requestAnimationFrame(frame);
}

async function boot() {
  try {
    renderer = new Renderer(scene.querySelector('#scene-gl'), scene.querySelector('#scene-overlay'));
    await renderer.load();
    render();
    requestAnimationFrame(frame);
    window.__SCRAP_LEAGUE__ = { version: '1.0.0', snapshot: () => ({ screen: state.screen, mode: state.mode, encounter: state.campaign.encounter, battleTick: state.battle?.tick || 0, result: state.battle?.result || null, modulesVisible: renderer.gpu.size }) };
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="boot"><strong>${t('loadError')}</strong><span>${t('webgl')}</span><button onclick="location.reload()">${t('retryLoad')}</button></div>`;
  }
}

boot();
