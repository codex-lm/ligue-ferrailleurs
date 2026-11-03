import { ARENAS, BEHAVIORS, CHASSIS, MODULES, SOCKETS } from './data/catalog.js';
import { DEFAULT_TEAM, EXAMPLE_TEAMS, OPPONENTS, RESEARCH } from './data/campaign.js';
import { translate } from './i18n.js';
import { validateTeam, validateUnit } from './sim/assembly.js';
import { createBattle, issueOrder, snapshotBattle, stepBattle } from './sim/combat.js';
import { cooldownFor, describeUnitAction } from './ai/behaviors.js';
import { cellName, describeBattle, effectPreview, moduleRange, moduleTargets, previewOrder, projectNextStep, rangeOverlay, targetIneligibility, unitById } from './sim/presentation.js';
import { applyDefeat, applyVictory, clone, createCampaign, purchaseResearch, repairCost, repairUnit, unlockedModules } from './sim/progression.js';
import { createStorage, loadBlueprints, loadCampaign, saveBlueprint, saveCampaign } from './sim/storage.js';
import { Renderer } from './render/renderer.js';
import { AudioBus } from './audio.js';

const app = document.getElementById('app');
const storage = createStorage();
const preferences = storage.get('preferences', { lang: 'en', sound: true, seenHelp: false });
const allResearch = Object.keys(RESEARCH);
const systemReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
const state = {
  lang: ['en', 'fr', 'es'].includes(preferences.lang) ? preferences.lang : 'en',
  screen: 'home', mode: 'campaign', campaign: loadCampaign(storage),
  selectedUnit: 0, editSide: 0, battle: null, paused: false, battleStarted: false,
  speed: [0.5, 1, 2].includes(preferences.speed) ? preferences.speed : 0.5,
  reducedMotion: preferences.reducedMotion ?? systemReducedMotion,
  selectedBattleUnit: null, rangeInspection: null, orderMode: null, orderError: null,
  orderConfirmationLocked: false, readCombat: false, help: false, toast: null,
  detailsOpen: false, historyOpen: false, historyFilter: 'all', replayEventId: null, replayPlaying: false,
  timeline: [], presentation: null, presentationRevision: -1,
  workshopTab: 'assemble', selectedSocket: 'right', previewModule: null, workshopRotation: 0.35,
  placement: null, camera: { zoom: 1, pan: [0, 0] },
  lab: { teams: [clone(DEFAULT_TEAM), clone(OPPONENTS[2].team)], arena: 'workbench', history: [] },
  lastReward: null, hasSave: Boolean(storage.get('campaign', null)), claiming: false
};
const audio = new AudioBus(preferences.sound !== false);
const scene = document.createElement('div');
scene.className = 'scene-card';
scene.innerHTML = '<canvas id="scene-gl" aria-label="3D mechanical automatons"></canvas><canvas id="scene-overlay" aria-hidden="true"></canvas><div class="scene-caption" id="scene-caption"></div><div id="scene-extra"></div>';
let renderer;
let accumulator = 0;
let previousFrame = performance.now();
let presentationTime = 0;
let previousHud = 0;
let lastAudioEvent = 0;
let lastReplayStep = 0;
let toastTimer;
let combatBottomSignature = '';
let resultSignature = '';
let drag = null;
let suppressSceneClick = false;

const t = (key, vars) => translate(state.lang, key, vars);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const currentTeam = () => state.mode === 'campaign' ? state.campaign.team : state.lab.teams[state.editSide];
const currentOpponent = () => state.mode === 'campaign' ? OPPONENTS[Math.min(state.campaign.encounter, OPPONENTS.length - 1)] : { name: 'testRange', arena: state.lab.arena, research: allResearch, team: state.lab.teams[1 - state.editSide] };
const currentResearch = () => state.mode === 'campaign' ? state.campaign.research : allResearch;
const currentUnlocked = () => unlockedModules(currentResearch());
const socketName = socket => socket === 'back' ? t('backSocket') : t(socket);
const formatTime = ticks => `${Math.floor(ticks / 600)}:${String(Math.ceil(ticks / 10) % 60).padStart(2, '0')}`;
const formatSeconds = ticks => `${(ticks / 10).toFixed(1).replace('.', state.lang === 'en' ? '.' : ',')}${t('seconds')}`;
const unitBadge = (battle, unit) => {
  const index = battle.units.filter(other => other.team === unit.team).findIndex(other => other.id === unit.id);
  if (state.mode === 'lab') return `${unit.team === 'player' ? 'A' : 'B'}${index + 1}`;
  return unit.team === 'player' ? String(index + 1) : String.fromCharCode(65 + index);
};
const unitLabel = (battle, id) => {
  const unit = unitById(battle, id);
  return unit ? `${unitBadge(battle, unit)} ${unit.name}` : id || '—';
};

function icon(name, className = '') {
  const paths = {
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
    retreat: '<path d="M9 5 3 12l6 7M4 12h10a6 6 0 0 1 6 6"/>',
    overload: '<path d="m13 2-8 12h6l-1 8 9-13h-7z"/>',
    repair: '<path d="M12 4v16M4 12h16"/><circle cx="12" cy="12" r="9"/>',
    shield: '<path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6z"/>',
    move: '<path d="M3 12h16m-6-6 6 6-6 6"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    history: '<path d="M4 7v5h5M4.5 12a8 8 0 1 0 2-5M12 7v5l3 2"/>',
    read: '<path d="M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="3"/>',
    fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    weight: '<path d="M8 8a4 4 0 1 1 8 0h3l2 12H3L5 8z"/>',
    energy: '<path d="m13 2-8 12h6l-1 8 9-13h-7z"/>',
    blade: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>',
    hammer: '<path d="m5 21 9-13M3 3h11v7H3z"/>',
    blaster: '<path d="M3 9h13v7H3zM16 11h5v3h-5M6 16v4m4-4v4"/>',
    mortar: '<path d="m8 20 3-13 6 2-3 13zM10 7l1-3 7 2-1 3"/>',
    boost: '<path d="m8 3 8 3-8 3 8 3-8 3 8 3-8 3z"/>',
    battery: '<rect x="5" y="6" width="14" height="15" rx="2"/><path d="M9 2v4m6-4v4M9 11v5m6-5v5"/>',
    armor: '<path d="M5 4h14v16H5zM8 4v16M5 9h14"/>',
    sensor: '<circle cx="12" cy="10" r="7"/><circle cx="12" cy="10" r="3"/><path d="M12 17v5M8 21h8"/>',
    details: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>'
  };
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.details}</svg>`;
}

function persistPreferences() {
  storage.set('preferences', {
    lang: state.lang, sound: audio.enabled, seenHelp: Boolean(preferences.seenHelp),
    speed: state.speed, reducedMotion: state.reducedMotion
  });
}

function persistCampaign() {
  const saved = saveCampaign(storage, state.campaign);
  state.hasSave = true;
  if (!saved && storage.persistent) toast(t('storageWarning'));
}

function toast(message) {
  state.toast = message;
  clearTimeout(toastTimer);
  document.querySelector('.toast')?.remove();
  const element = document.createElement('div');
  element.className = 'toast';
  element.setAttribute('role', 'status');
  element.textContent = message;
  document.body.appendChild(element);
  toastTimer = setTimeout(() => element.remove(), 2600);
}

function announce(message) {
  const region = document.getElementById('announcer');
  if (region) region.textContent = message;
}

function moduleChips(unit) {
  return unit.modules.length ? unit.modules.map(entry => `<span class="chip">${icon(entry.id)}${esc(t(entry.id))}</span>`).join('') : `<span class="small">${t('empty')}</span>`;
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
      <div class="eyebrow">Kimi Games · LOB7</div><h1>${esc(t('title'))}</h1>
      <p class="tagline">${esc(t('tagline'))}</p><p class="muted">${esc(t('intro'))}</p>
      <div class="hero-actions">
        ${state.hasSave ? `<button class="primary" data-action="continue">${icon('play')} ${t('continue')}</button>` : ''}
        <button class="${state.hasSave ? 'secondary' : 'primary'}" data-action="new-campaign">⚙ ${t('newCampaign')}</button>
        <button class="secondary" data-action="test-range">↔ ${t('testRange')}</button>
        <button class="ghost" data-action="help">? ${t('howTo')}</button>
      </div>
      <div class="feature-list"><span class="chip">3 ${t('chassis').toLowerCase()}</span><span class="chip">10 ${t('modules').toLowerCase()}</span><span class="chip">6 ${t('arena').toLowerCase()}</span><span class="chip">EN · FR · ES</span></div>
      <p class="small storage-note">${storage.persistent === false ? t('storageWarning') : t('localOnly')}</p>
    </section><div data-scene></div>
  </div></main>`;
}

function unitTabs() {
  return `<div class="unit-tabs">${currentTeam().units.map((unit, index) => {
    const hp = unitHull(unit), max = CHASSIS[unit.chassis].hp;
    return `<button class="unit-tab ${index === state.selectedUnit ? 'active' : ''}" data-action="select-unit" data-index="${index}" aria-pressed="${index === state.selectedUnit}">
      <span class="unit-number">${index + 1}</span><span><strong>${esc(unit.name)}</strong><small>${t(unit.chassis)} · ${Math.ceil(hp)}/${max} ${t('hull')}</small></span><span class="hp-pip" style="height:${Math.max(4, 30 * hp / max)}px"></span>
    </button>`;
  }).join('')}</div>`;
}

function opponentPanel() {
  const opponent = currentOpponent();
  return `<section class="panel opponent-card"><div class="panel-title"><h3>${t('opponentIntel')}</h3><span class="chip">${t(opponent.arena)}</span></div>
    <strong class="enemy-text">${esc(t(opponent.name))}</strong>
    <div class="enemy-list">${opponent.team.units.map((unit, index) => `<div class="enemy-row"><strong><span><span class="mini-badge enemy">${String.fromCharCode(65 + index)}</span> ${esc(unit.name)}</span><span>${t(unit.chassis)}</span></strong><small>${t(unit.behavior)} · ${unit.modules.map(entry => t(entry.id)).join(' + ')}</small></div>`).join('')}</div>
  </section>`;
}

function errorText(error) {
  const names = { 'unknown-chassis': 'chassis', 'unknown-module': 'unknownModule', 'locked-module': 'lockedModule', 'bad-socket': 'badSocket', 'occupied-socket': 'occupiedSocket', 'team-size': 'teamSize', weight: 'overweight', energy: 'overenergy' };
  const detail = error.actual !== undefined ? ` (${error.actual}/${error.limit})` : error.id ? ` · ${t(error.id)}` : '';
  return `${t(names[error.code] || error.code)}${detail}`;
}

function previewUnit() {
  const unit = clone(currentTeam().units[state.selectedUnit]);
  if (state.previewModule) {
    unit.modules = unit.modules.filter(entry => entry.socket !== state.previewModule.socket);
    if (state.previewModule.id) unit.modules.push({ id: state.previewModule.id, socket: state.previewModule.socket });
  }
  return unit;
}

function budgetPanel() {
  const actual = validateUnit(currentTeam().units[state.selectedUnit], currentUnlocked());
  const preview = validateUnit(previewUnit(), currentUnlocked());
  const changed = Boolean(state.previewModule);
  return `<div class="budgets"><div><div class="meter-head"><span>${icon('weight')} ${t('weight')}</span><strong>${actual.weight}/${actual.maxWeight}${changed ? ` → ${preview.weight}/${preview.maxWeight}` : ''}</strong></div><div class="meter ${preview.weight > preview.maxWeight ? 'over' : ''}"><span style="width:${Math.min(100, preview.weight / preview.maxWeight * 100)}%"></span></div></div>
    <div><div class="meter-head"><span>${icon('energy')} ${t('energy')}</span><strong>${actual.energy}/${actual.maxEnergy}${changed ? ` → ${preview.energy}/${preview.maxEnergy}` : ''}</strong></div><div class="meter ${preview.energy > preview.maxEnergy ? 'over' : ''}"><span style="width:${Math.min(100, preview.energy / preview.maxEnergy * 100)}%"></span></div></div></div>`;
}

function moduleStats(module) {
  if (module.kind === 'weapon') return `${module.damage} ${t('damageShort')} · ${t('range')} ${module.minRange || 1}–${module.range} · ${module.cooldown.toFixed(1)}${t('seconds')}`;
  if (module.kind === 'support') return `+${module.heal} ${t('hull')} · ${t('range')} ${module.range} · ${module.cooldown.toFixed(1)}${t('seconds')}`;
  if (module.effect === 'dash') return `${t('dashSummary')} · ${module.cooldown.toFixed(1)}${t('seconds')}`;
  return t(`${module.id}Desc`);
}

function assemblyPanel() {
  const team = currentTeam();
  const unit = team.units[state.selectedUnit];
  const unlocked = currentUnlocked();
  const teamCheck = validateTeam(team, unlocked);
  const behaviors = BEHAVIORS.filter(behavior => behavior !== 'fragile' || state.mode === 'lab' || state.campaign.research.includes('mobility-agile'));
  if (!behaviors.includes(unit.behavior)) behaviors.push(unit.behavior);
  const compatible = Object.values(MODULES).filter(module => module.sockets.includes(state.selectedSocket) && unlocked.has(module.id));
  const preview = state.previewModule ? MODULES[state.previewModule.id] : null;
  return `<section class="panel assembly-panel"><div class="panel-title"><div><h2>${esc(unit.name)}</h2><span class="small">${t(state.selectedSocket === 'back' ? 'backSocket' : state.selectedSocket)}</span></div><span class="chip">${t(unit.chassis)}</span></div>
    <div class="unit-config"><div class="field"><label for="unit-name">${t('selected')}</label><input id="unit-name" type="text" maxlength="16" value="${esc(unit.name)}" data-change="unit-name"></div>
    <div class="field"><label for="unit-chassis">${t('chassis')}</label><select id="unit-chassis" data-change="chassis">${Object.values(CHASSIS).map(chassis => `<option value="${chassis.id}" ${unit.chassis === chassis.id ? 'selected' : ''}>${t(chassis.id)} · ${chassis.hp} ${t('hull')}</option>`).join('')}</select></div>
    <div class="field"><label for="unit-behavior">${t('behavior')}</label><select id="unit-behavior" data-change="behavior">${behaviors.map(behavior => `<option value="${behavior}" ${unit.behavior === behavior ? 'selected' : ''}>${t(behavior)}</option>`).join('')}</select></div></div>
    <div class="socket-grid">${SOCKETS.map(socket => {
      const current = unit.modules.find(entry => entry.socket === socket);
      return `<button class="socket-card ${state.selectedSocket === socket ? 'active' : ''}" data-action="select-socket" data-socket="${socket}"><span>${socketName(socket)}</span><strong>${current ? `${icon(current.id)} ${t(current.id)}` : t('empty')}</strong></button>`;
    }).join('')}</div>
    <div class="catalog-head"><h3>${t('compatibleModules')}</h3><button class="ghost" data-action="rotate-robot" aria-label="${t('rotate')}">↻ ${t('rotate')}</button></div>
    <div class="module-catalog"><button class="module-card ${state.previewModule?.id === '' ? 'preview' : ''}" data-action="preview-module" data-module=""><strong>${t('empty')}</strong><small>${t('removeModule')}</small></button>${compatible.map(module => `<button class="module-card ${state.previewModule?.id === module.id ? 'preview' : ''}" data-action="preview-module" data-module="${module.id}"><span class="module-icon">${icon(module.id)}</span><strong>${t(module.id)}</strong><small>${t(module.kind)}</small><span class="module-numbers">${module.weight} ${t('weight').toLowerCase()} · ${module.energy} ${t('energy').toLowerCase()}</span><small>${moduleStats(module)}</small></button>`).join('')}</div>
    ${state.previewModule ? `<div class="preview-explain"><span class="eyebrow">${t('previewNotEquipped')}</span><strong>${preview ? t(preview.id) : t('empty')}</strong><p>${preview ? t(`${preview.id}Desc`) : t('removeModule')}</p><div class="button-row"><button data-action="cancel-preview">${t('cancel')}</button><button class="primary grow" data-action="equip-preview">${preview ? `${t('equip')} ${t(preview.id)}` : t('remove')}</button></div></div>` : ''}
    ${unit.modules.some(entry => MODULES[entry.id]?.kind === 'weapon') ? '' : `<div class="support-warning">${t('noOffensive')}</div>`}
    <div class="validation ${teamCheck.valid ? '' : 'invalid'}"><strong>${teamCheck.valid ? '✓ ' + t('validBuild') : '× ' + t('invalidBuild')}</strong>${teamCheck.errors.length ? `<br>${teamCheck.errors.map(errorText).join('<br>')}` : ''}</div>
  </section>`;
}

function legalPlacementCells() {
  const unit = currentTeam().units[state.selectedUnit];
  const arena = ARENAS[currentOpponent().arena];
  const cells = [];
  for (let y = 0; y < arena.height; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const blocked = arena.obstacles.some(cell => cell[0] === x && cell[1] === y);
      const narrow = arena.narrow.some(cell => cell[0] === x && cell[1] === y);
      if (!blocked && (!narrow || CHASSIS[unit.chassis].narrow)) cells.push({ x, y });
    }
  }
  return cells;
}

function placementPanel() {
  const unit = currentTeam().units[state.selectedUnit];
  const candidate = state.placement;
  const occupant = candidate ? currentTeam().units.find((other, index) => index !== state.selectedUnit && (other.position?.[0] ?? 0) === candidate.x && (other.position?.[1] ?? [1, 3, 5][index]) === candidate.y) : null;
  return `<section class="panel placement-panel"><div class="panel-title"><h2>${t('startPositions')}</h2><span class="chip">${t(currentOpponent().arena)}</span></div>
    <p>${t('positionHelp')}</p><div class="placement-readout"><span class="eyebrow">${t('selected')}</span><strong>${state.selectedUnit + 1} ${esc(unit.name)}</strong><span>${candidate ? `${cellName(unit.position?.[0] ?? 0, unit.position?.[1] ?? [1, 3, 5][state.selectedUnit])} → ${cellName(candidate.x, candidate.y)}` : t('chooseCell')}</span>${occupant ? `<span class="order-note">${t('swapUnits', { first: state.selectedUnit + 1, second: currentTeam().units.indexOf(occupant) + 1 })}</span>` : ''}</div>
    <div class="button-row"><button data-action="cancel-placement" ${candidate ? '' : 'disabled'}>${t('cancel')}</button><button class="primary grow" data-action="confirm-placement" ${candidate ? '' : 'disabled'}>${t('place')}</button></div>
    <p class="small">${t('placementKeyboard')}</p></section>`;
}

function plansPanel() {
  if (state.mode === 'campaign') return '';
  const plans = loadBlueprints(storage);
  return `<section class="panel"><div class="panel-title"><h3>${t('blueprints')}</h3><span class="small">${t('localOnly')}</span></div>
    <div class="plan-grid">${plans.map((plan, index) => `<div class="plan-slot"><strong>${esc(plan?.name || `${t('planSlot')} ${index + 1}`)}</strong>${plan?.savedAt ? `<small>${new Date(plan.savedAt).toLocaleDateString(state.lang)}</small>` : ''}<div class="button-row"><button data-action="save-plan" data-slot="${index}">${t('savePlan')}</button><button data-action="load-plan" data-slot="${index}" ${plan ? '' : 'disabled'}>${t('loadPlan')}</button></div></div>`).join('')}</div>
    <div class="field"><label for="example-select">${t('examples')}</label><select id="example-select">${Object.keys(EXAMPLE_TEAMS).map(name => `<option value="${name}">${t(name)}</option>`).join('')}</select></div><button class="secondary wide" data-action="apply-example">${t('applyExample')}</button>
  </section>`;
}

function workshopView() {
  const teamCheck = validateTeam(currentTeam(), currentUnlocked());
  return `<main class="main"><div class="workshop-grid ${state.workshopTab === 'placement' ? 'placement-mode' : ''}">
    <aside class="workshop-side"><section class="panel"><div class="panel-title"><h2>${state.mode === 'lab' ? t(state.editSide === 0 ? 'teamA' : 'teamB') : t('yourTeam')}</h2><span class="eyebrow">${t('workshop')}</span></div>
      ${state.mode === 'lab' ? `<div class="button-row lab-side-buttons"><button class="grow ${state.editSide === 0 ? 'primary' : ''}" data-action="edit-side" data-side="0">${t('editA')}</button><button class="grow ${state.editSide === 1 ? 'primary' : ''}" data-action="edit-side" data-side="1">${t('editB')}</button></div><div class="field"><label>${t('arenaSelect')}</label><select data-change="lab-arena">${Object.keys(ARENAS).map(id => `<option value="${id}" ${state.lab.arena === id ? 'selected' : ''}>${t(id)}</option>`).join('')}</select></div>` : ''}
      ${unitTabs()}<div class="workshop-tabs"><button class="${state.workshopTab === 'assemble' ? 'active' : ''}" data-action="workshop-tab" data-tab="assemble">${t('assembly')}</button><button class="${state.workshopTab === 'placement' ? 'active' : ''}" data-action="workshop-tab" data-tab="placement">${t('placement')}</button></div></section>${opponentPanel()}</aside>
    <section class="workshop-center"><div data-scene class="scene-host"></div>${budgetPanel()}<div class="workshop-launch"><button class="primary" data-action="start-battle" ${teamCheck.valid ? '' : 'disabled'}>${icon('play')} ${state.mode === 'lab' ? t('compare') : t('launch')}</button><span class="small">${teamCheck.valid ? t('suspendedPreparation') : t('correctBuildFirst')}</span></div></section>
    <aside class="workshop-side">${state.workshopTab === 'placement' ? placementPanel() : assemblyPanel()}${plansPanel()}</aside>
  </div></main>`;
}

function liveIntent(unit) {
  if (!state.battle || !unit?.active) return { type: 'disabled' };
  if (state.presentationRevision !== state.battle.revision || !state.presentation) {
    state.presentation = describeBattle(state.battle);
    state.presentationRevision = state.battle.revision;
  }
  return state.presentation[unit.id] || describeUnitAction(state.battle, unit);
}

function intentText(battle, unit, short = false) {
  if (!unit.active) return t('disabled');
  const intent = unit.team && state.battle === battle ? liveIntent(unit) : describeUnitAction(battle, unit);
  const target = intent.targetId ? unitLabel(battle, intent.targetId) : '';
  if (intent.type === 'attack') return short ? t('shortAttack', { target }) : t('actionAttack', { module: t(intent.moduleId), target });
  if (intent.type === 'support') return short ? t('shortRepair', { target }) : t('actionRepair', { target });
  if (intent.type === 'move') return short ? t(intent.reason === 'retreat' ? 'shortRetreat' : 'shortMove') : t('actionMove', { cell: cellName(...intent.destination) });
  if (intent.reason === 'cooldown' || intent.reason === 'move-cooldown') return t('waitCooldown');
  if (intent.reason === 'keep-range') return t('waitRange');
  if (intent.reason === 'blocked') return t('moveBlocked');
  return t('waiting');
}

function nextTickText(battle, unit) {
  if (!unit.active) return t('disabled');
  const projection = projectNextStep(battle);
  const event = projection.events.find(candidate => candidate.unit === unit.id && candidate.type !== 'order-ended');
  if (event) return eventText(event, false);
  return intentText(projection.state, unitById(projection.state, unit.id));
}

function activeOrderText(battle, unit) {
  const orders = [];
  if (unit.priorityTarget) orders.push(t('priorityActive', { target: unitLabel(battle, unit.priorityTarget) }));
  if (unit.retreatUntil > battle.tick) orders.push(t('retreatActive', { time: formatSeconds(unit.retreatUntil - battle.tick) }));
  if (unit.overload?.until > battle.tick) orders.push(t('overloadActive', { module: t(unit.overload.moduleId), time: formatSeconds(unit.overload.until - battle.tick) }));
  return orders;
}

function combatUnitButton(unit) {
  const battle = replayFrame();
  const selected = state.selectedBattleUnit === unit.id;
  const order = activeOrderText(battle, unit)[0] || intentText(battle, unit, true);
  return `<button class="combat-unit ${unit.team} ${selected ? 'active' : ''} ${unit.active ? '' : 'inactive'}" data-action="combat-unit" data-id="${unit.id}" aria-pressed="${selected}" aria-label="${esc(`${unitLabel(battle, unit.id)} · ${Math.ceil(unit.hp)}/${unit.maxHp} ${t('hull')} · ${order}`)}">
    <span class="unit-card-head"><span class="mini-badge ${unit.team}">${unitBadge(battle, unit)}</span><strong>${esc(unit.name)}</strong><span class="hull-value">${Math.ceil(unit.hp)}/${unit.maxHp}</span></span>
    <span class="hull-line"><span style="width:${Math.max(0, unit.hp / unit.maxHp * 100)}%"></span></span><small>${unit.active && unit.hp / unit.maxHp < 0.25 ? '△ ' : ''}${esc(order)}</small>
  </button>`;
}

function combatTeamPanel() {
  if (!state.battle) return '';
  const battle = replayFrame();
  const player = battle.units.filter(unit => unit.team === 'player');
  const enemy = battle.units.filter(unit => unit.team === 'enemy');
  return `<section class="team-section"><div class="panel-title"><h3>${state.mode === 'lab' ? t('teamA') : t('yourTeam')}</h3><span class="small">${player.filter(unit => unit.active).length}/3</span></div>${player.map(combatUnitButton).join('')}</section>
    <section class="team-section"><div class="panel-title"><h3>${state.orderMode?.type === 'target' ? t('chooseEnemy') : state.mode === 'lab' ? t('teamB') : t('enemyTeam')}</h3><span class="small">${enemy.filter(unit => unit.active).length}/3</span></div>${enemy.map(combatUnitButton).join('')}</section>`;
}

function selectedModule() {
  const inspection = state.rangeInspection;
  if (!inspection || !state.battle) return null;
  const unit = unitById(state.battle, inspection.unitId);
  const entry = unit?.modules.find(candidate => candidate.socket === inspection.socket);
  return unit && entry ? { unit, entry } : null;
}

function replayInspector() {
  const event = state.battle.events.find(candidate => candidate.id === state.replayEventId);
  if (!event) return '';
  return `<section class="panel inspector-panel"><span class="eyebrow">${t('selectedEvent')}</span><div class="action-card"><strong>${formatSeconds(event.tick)}</strong><p>${esc(eventText(event, false))}</p></div><p class="small">${t('replayExplanation')}</p>${event.hullBefore !== undefined ? `<div class="hull-comparison">${event.hullBefore} → ${event.hullAfter} ${t('hull')}</div>` : ''}</section>`;
}

function inspectPanel() {
  if (state.replayEventId) return replayInspector();
  const battle = state.battle;
  const unit = unitById(battle, state.selectedBattleUnit) || battle?.units[0];
  if (!unit) return '';
  const orders = activeOrderText(battle, unit);
  const selection = selectedModule();
  const selectionCanTarget = selection && ['weapon', 'support'].includes(MODULES[selection.entry.id].kind);
  const inspectedTarget = selectionCanTarget ? (state.orderMode?.candidateTargetId ? unitById(battle, state.orderMode.candidateTargetId) : selection.unit.id !== unit.id ? unit : null) : null;
  const ineligibility = selectionCanTarget && inspectedTarget ? targetIneligibility(battle, selection.unit, selection.entry, inspectedTarget) : null;
  const targetModule = selectionCanTarget ? MODULES[selection.entry.id] : null;
  const targetDistance = selectionCanTarget && inspectedTarget ? Math.abs(selection.unit.x - inspectedTarget.x) + Math.abs(selection.unit.y - inspectedTarget.y) : 0;
  const targetReason = !ineligibility ? t('eligibleTarget') : ineligibility === 'too-close' ? t('tooCloseReason', { min: targetModule.minRange || 1 }) : ineligibility === 'too-far' ? t('tooFarReason', { max: moduleRange(selection.unit, selection.entry) }) : ineligibility === 'self-repair' ? t('selfRepairReason') : ineligibility === 'full-hull' ? t('fullHull') : ineligibility === 'ally' ? t('allyTarget') : t('targetUnavailable');
  const targetEffect = selectionCanTarget && inspectedTarget && !ineligibility ? effectPreview(battle, selection.unit, selection.entry, inspectedTarget) : null;
  return `<section class="panel inspector-panel"><div class="inspect-identity"><span class="mini-badge ${unit.team}">${unitBadge(battle, unit)}</span><div><h2>${esc(unit.name)}</h2><span class="small">${t(unit.chassis)} · ${Math.ceil(unit.hp)}/${unit.maxHp} ${t('hull')}</span></div><button class="icon-button details-close" data-action="details" aria-label="${t('close')}">${icon('close')}</button></div>
    <div class="action-card"><span class="eyebrow">${t('currentAction')}</span><strong>${esc(intentText(battle, unit))}</strong>${liveIntent(unit).moduleId ? `<small>${t(liveIntent(unit).moduleId)}${liveIntent(unit).socket ? ` · ${socketName(liveIntent(unit).socket)}` : ''}</small>` : ''}${state.paused && state.battleStarted && !battle.result ? `<small>${t('nextTick')} · ${esc(nextTickText(battle, unit))}</small>` : ''}</div>
    ${inspectedTarget ? `<div class="action-card target-status"><span class="eyebrow">${t('range')} · ${t('distance')} ${targetDistance}</span><strong>${esc(targetReason)}</strong>${targetEffect ? `<small>${targetEffect.effectiveDamage !== undefined ? t('impactNow', { amount: targetEffect.effectiveDamage }) : t('healNow', { amount: targetEffect.effectiveHeal, possible: targetEffect.possible })}</small>` : ''}</div>` : ''}
    ${liveIntent(unit).pursuitTargetId ? `<div class="inspect-order"><span>${t('pursuitTarget')}</span><strong>${unitLabel(battle, liveIntent(unit).pursuitTargetId)}</strong></div>` : ''}
    ${orders.map(order => `<div class="inspect-order active-order"><span>${t('activeOrder')}</span><strong>${esc(order)}</strong></div>`).join('')}
    <div class="inspect-modules">${unit.modules.map(entry => {
      const module = MODULES[entry.id];
      const cooling = unit.cooldowns[entry.id] || 0;
      const maximum = unit.cooldownMaximums?.[entry.id] || Math.max(1, Math.round(module.cooldown * 10));
      const ready = cooling <= 0;
      const passive = module.kind === 'passive';
      const overloadMode = state.orderMode?.type === 'overload' && state.orderMode.actorId === unit.id;
      const preview = selection?.unit.id === unit.id && selection.entry.socket === entry.socket && inspectedTarget && !ineligibility ? effectPreview(battle, unit, entry, inspectedTarget) : null;
      return `<div class="inspect-module ${selection?.unit.id === unit.id && selection.entry.socket === entry.socket ? 'selected' : ''}"><button class="module-inspect-button" data-action="inspect-module" data-id="${unit.id}" data-socket="${entry.socket}"><span class="module-icon">${icon(entry.id)}</span><span><strong>${t(entry.id)}</strong><small>${socketName(entry.socket)} · ${module.range ? `${t('range')} ${module.minRange || 1}–${moduleRange(unit, entry)}` : t(module.kind)}</small></span><span class="module-state">${passive ? t('passive') : ready ? t('ready') : formatSeconds(cooling)}</span></button>
      ${passive ? `<p>${t(`${entry.id}Desc`)}</p>` : `<div class="cooldown-line"><span style="width:${100 - Math.min(100, cooling / maximum * 100)}%"></span></div>`}
      ${preview ? `<p class="effect-preview">${preview.effectiveDamage !== undefined ? t('impactNow', { amount: preview.effectiveDamage }) : t('healNow', { amount: preview.effectiveHeal, possible: preview.possible })}</p>` : ''}
      ${overloadMode ? `<button class="wide overload-choice" data-action="choose-overload-module" data-module="${entry.id}" ${passive ? 'disabled' : ''}>${icon('overload')} ${passive ? t('passiveNoOverload') : t('chooseOverload')}</button>` : ''}</div>`;
    }).join('')}</div>
    ${selection?.unit.id === unit.id ? `<p class="small range-help">${t('rangeInspectionHelp')}${targetModule?.minRange ? ` ${t('minimumRange', { min: targetModule.minRange })}` : ''}</p>` : ''}
  </section>`;
}

function eventText(event, withTime = true) {
  const battle = state.battle;
  const time = withTime ? `${formatSeconds(event.tick)} · ` : '';
  const actor = unitLabel(battle, event.unit);
  const target = unitLabel(battle, event.target || event.source);
  if (event.type === 'move') return `${time}${actor} · ${cellName(...event.from)} → ${cellName(event.x, event.y)} · ${t(event.reason === 'retreat' ? 'retreatMove' : event.dash ? 'eventDash' : 'eventMove')}`;
  if (event.type === 'attack' || event.type === 'blast') return `${time}${actor} → ${unitLabel(battle, event.target)} · ${t(event.module)} · −${event.amount} ${t('hull')}`;
  if (event.type === 'repair') return `${time}${actor} → ${unitLabel(battle, event.target)} · ${t('repair')} · +${event.amount} ${t('hull')}`;
  if (event.type === 'disabled') return `${time}${actor} · ${t('eventDisabled')} · ${unitLabel(battle, event.source)}`;
  if (event.type === 'order') return `${time}${actor}${event.target ? ` → ${target}` : ''} · ${t(event.order)}${event.module ? ` · ${t(event.module)}` : ''} · ${event.chargesAfter}/3 ${t('charges').toLowerCase()}`;
  if (event.type === 'order-ended') return `${time}${actor} · ${t(event.order)} · ${t('orderEnded')}`;
  return `${time}${actor} · ${t(event.type)}`;
}

function battleLog() {
  const events = state.battle.events.filter(event => ['attack', 'blast', 'repair', 'disabled', 'order', 'order-ended'].includes(event.type)).slice(-2).reverse();
  if (!events.length) return `<div>${t('noEvents')}</div>`;
  return events.map(event => `<div class="recent-event ${event.type}"><span>${formatSeconds(event.tick)}</span>${esc(eventText(event, false))}</div>`).join('');
}

function orderDraft() {
  if (!state.orderMode) return null;
  const draft = state.orderMode;
  const order = { type: draft.type, unitId: draft.actorId, targetId: draft.candidateTargetId, moduleId: draft.candidateModuleId };
  const ready = draft.type === 'retreat' || (draft.type === 'target' && Boolean(draft.candidateTargetId)) || (draft.type === 'overload' && Boolean(draft.candidateModuleId));
  return { draft, order, ready, preview: ready ? previewOrder(state.battle, 'player', order) : null };
}

function orderPreviewText(data) {
  if (!data?.ready) return t(data?.draft.type === 'target' ? 'chooseEnemy' : 'chooseModule');
  if (!data.preview?.result.ok) return orderReason(data.preview?.result.reason);
  const { draft, preview } = data;
  const actor = unitById(state.battle, draft.actorId);
  if (draft.type === 'target') {
    const target = unitById(state.battle, draft.candidateTargetId);
    const weapon = actor.modules.find(entry => MODULES[entry.id]?.kind === 'weapon');
    const inRange = weapon && moduleTargets(state.battle, actor, weapon).some(unit => unit.id === target.id);
    return `${t('validPriority')} ${inRange ? t('targetInRangeNow') : t('targetMayRequireMove')}`;
  }
  if (draft.type === 'retreat') return `${intentText(preview.state, unitById(preview.state, draft.actorId))} · ${t('retreatPreviewNote')}`;
  const module = MODULES[draft.candidateModuleId];
  const projectedActor = unitById(preview.state, draft.actorId);
  const entry = projectedActor.modules.find(candidate => candidate.id === draft.candidateModuleId);
  const boostedDamage = module.damage ? Math.round(module.damage * 1.35 * (actor.modules.some(candidate => candidate.id === 'sensor') ? 1.15 : 1)) : null;
  const old = actor.overload;
  return `${module.damage ? `${t('baseDamage')} ${module.damage} → ${boostedDamage} · ` : module.heal ? `${t('baseHeal')} ${module.heal} → ${Math.round(module.heal * 1.35 * (actor.research.includes('protection-repair') ? 1.2 : 1))} · ` : ''}${t('newCooldown')} ${module.cooldown.toFixed(1)}${t('seconds')} → ${(cooldownFor(projectedActor, entry, state.battle.tick) / 10).toFixed(1)}${t('seconds')} · ${formatSeconds((projectedActor.overload?.until || 0) - state.battle.tick)}${old ? ` · ${t('replacesOverload', { module: t(old.moduleId), time: formatSeconds(Math.max(0, old.until - state.battle.tick)) })}` : ''}`;
}

function orderReason(reason) {
  return t({ unavailable: 'noCharges', unit: 'unitUnavailable', target: 'targetUnavailable', module: 'moduleUnavailable', passive: 'passiveNoOverload', order: 'orderUnavailable' }[reason] || 'orderUnavailable');
}

function combatBottom() {
  const battle = state.battle;
  if (state.replayEventId) {
    const index = battle.events.findIndex(event => event.id === state.replayEventId);
    return `<div class="replay-controls"><button data-action="previous-event" ${index <= 0 ? 'disabled' : ''}>◀ ${t('previousEvent')}</button><button data-action="replay-play">${state.replayPlaying ? icon('pause') : icon('play')} ${state.replayPlaying ? t('pause') : t('playReplay')}</button><input type="range" min="0" max="${Math.max(0, battle.events.length - 1)}" value="${Math.max(0, index)}" data-change="replay-slider" aria-label="${t('replayTimeline')}"><button data-action="next-event" ${index >= battle.events.length - 1 ? 'disabled' : ''}>${t('nextEvent')} ▶</button><button class="primary" data-action="return-live">${t('returnLive')}</button></div>`;
  }
  if (state.orderMode) {
    const data = orderDraft();
    const actor = unitById(battle, data.draft.actorId);
    const target = data.draft.candidateTargetId ? unitById(battle, data.draft.candidateTargetId) : null;
    const module = data.draft.candidateModuleId ? MODULES[data.draft.candidateModuleId] : null;
    return `<div class="order-confirm"><div class="order-summary"><span class="eyebrow">${t('tacticalPause')} · ${t(data.draft.type)}</span><strong>${esc(actor?.name || '')}${target ? ` → ${esc(target.name)}` : module ? ` · ${t(module.id)}` : ''}</strong><p>${esc(orderPreviewText(data))}</p>${state.orderError ? `<p class="order-error" role="alert">${esc(state.orderError)}</p>` : ''}</div><button data-action="cancel-order">${t('cancel')}</button><button class="primary confirm-order" data-action="confirm-order" ${data.ready && !state.orderConfirmationLocked ? '' : 'disabled'}>${t('confirmOrder', { actor: actor?.name || '', target: target?.name || (module ? t(module.id) : '') })}<small>1 ${t('charge')} · ${t('staysPaused')}</small></button></div>`;
  }
  const selected = unitById(battle, state.selectedBattleUnit);
  const disabled = state.replayEventId || battle.result || !state.battleStarted;
  return `<div class="orders-row"><div class="charges-panel"><span>${t('charges')} <strong>${battle.charges.player}/3</strong></span><div class="charge-dots">${Array.from({ length: 3 }, (_, index) => `<span class="charge-dot ${index < battle.charges.player ? '' : 'used'}"></span>`).join('')}</div></div>
    <div class="orders"><button data-action="order-target" ${disabled ? 'disabled' : ''}>${icon('target')}<span>${t('target')}</span><small>1 ${t('charge')}</small></button><button data-action="order-retreat" ${disabled ? 'disabled' : ''}>${icon('retreat')}<span>${t('retreat')}</span><small>1 ${t('charge')}</small></button><button data-action="order-overload" ${disabled ? 'disabled' : ''}>${icon('overload')}<span>${t('overload')}</span><small>1 ${t('charge')}</small></button></div>
    <div class="order-help"><span>${battle.result ? t('battleResult') : state.orderError || (!selected?.active ? t('unitUnavailable') : t('orderHelp'))}</span><small>${t('keyboardShort')}</small></div></div>`;
}

function historyDrawer() {
  if (!state.historyOpen) return '';
  const filters = ['all', 'orders', 'damage', 'support', 'moves'];
  const match = event => state.historyFilter === 'all' || (state.historyFilter === 'orders' && ['order', 'order-ended'].includes(event.type)) || (state.historyFilter === 'damage' && ['attack', 'blast', 'disabled'].includes(event.type)) || (state.historyFilter === 'support' && event.type === 'repair') || (state.historyFilter === 'moves' && event.type === 'move');
  const events = state.battle.events.filter(match).slice().reverse();
  return `<aside class="history-drawer" role="dialog" aria-modal="false" aria-labelledby="history-title"><div class="panel-title"><h2 id="history-title">${t('combatHistory')}</h2><button class="icon-button" data-action="close-history" aria-label="${t('close')}">${icon('close')}</button></div><div class="history-filters">${filters.map(filter => `<button class="${state.historyFilter === filter ? 'active' : ''}" data-action="history-filter" data-filter="${filter}">${t(filter)}</button>`).join('')}</div><div class="history-list">${events.length ? events.map(event => `<button data-action="replay-event" data-id="${event.id}" class="history-event ${event.id === state.replayEventId ? 'active' : ''}"><span>${formatSeconds(event.tick)}</span><strong>${esc(eventText(event, false))}</strong></button>`).join('') : `<p>${t('noEvents')}</p>`}</div></aside>`;
}

function resultView() {
  const battle = state.battle;
  if (!battle?.result) return '';
  const result = battle.result;
  const won = result.winner === 'player';
  const draw = result.winner === 'draw';
  const reason = result.reason === 'neutralized' ? (won ? 'neutralized' : 'defeat') : result.reason === 'time-hull' ? 'timeHull' : result.reason === 'time-damage' ? 'timeDamage' : 'timeDraw';
  const moments = [
    battle.events.find(event => event.type === 'disabled'),
    battle.events.filter(event => ['attack', 'blast'].includes(event.type)).sort((a, b) => b.amount - a.amount)[0],
    battle.events.filter(event => event.type === 'repair').sort((a, b) => b.amount - a.amount)[0]
  ].filter(Boolean).filter((event, index, array) => array.findIndex(other => other.id === event.id) === index).slice(0, 3);
  return `<section class="result-sheet ${won || draw ? '' : 'defeat'}"><div class="result-heading"><div><span class="eyebrow">${t('battleResult')}</span><h2>${draw ? t('draw') : won ? t('victory') : t('defeat')}</h2></div><button class="icon-button" data-action="hide-result" aria-label="${t('close')}">${icon('close')}</button></div><p>${t(reason)} · ${t('battleDuration')} <strong>${formatSeconds(result.tick)}</strong></p>
    <div class="result-table-wrap"><table class="result-table"><thead><tr><th>${t('robot')}</th><th>${t('hull')}</th><th>${t('dealt')}</th><th>${t('taken')}</th><th>${t('healed')}</th><th>KO</th><th>${t('orders')}</th></tr></thead><tbody>${battle.units.map(unit => `<tr><td><span class="mini-badge ${unit.team}">${unitBadge(battle, unit)}</span> ${esc(unit.name)}</td><td>${Math.ceil(unit.hp)}/${unit.maxHp}</td><td>${unit.damageDealt}</td><td>${unit.damageTaken}</td><td>${unit.healingDone}</td><td>${unit.disables || 0}</td><td>${unit.ordersReceived || 0}</td></tr>`).join('')}</tbody></table></div>
    <div class="result-moments">${moments.map(event => `<button data-action="replay-event" data-id="${event.id}">${icon('history')} ${esc(eventText(event))}</button>`).join('')}</div>
    <div class="result-actions"><button data-action="review-combat">${icon('history')} ${t('reviewCombat')}</button>${state.mode === 'lab' ? `<button class="primary" data-action="swap-replay">↔ ${t('swapReplay')}</button><button data-action="fight-again">${t('newFight')}</button><button data-action="edit-teams">${t('editTeams')}</button>` : won ? `<button class="primary" data-action="claim">${t('claim')} →</button>` : `<button class="orange" data-action="retry">${t('retry')}</button>`}</div></section>`;
}

function combatView() {
  const opponent = currentOpponent();
  const battle = state.battle;
  const replayEvent = battle.events.find(event => event.id === state.replayEventId);
  return `<main class="combat-shell ${state.detailsOpen ? 'details-open' : ''}"><header class="combat-top"><button class="brand" data-action="home"><span class="brand-mark">⚙</span><span>${esc(t('title'))}</span></button><div class="combat-context"><strong>${esc(t(opponent.name))}</strong><span>${t(battle.arena.id)} · ${state.mode === 'campaign' ? `${t('encounter')} ${state.campaign.encounter + 1}/6` : t('testRange')}</span></div>
    <div class="time-controls"><button class="pause-control" data-action="pause" id="pause-button">${!state.battleStarted ? `${icon('play')} ${t('beginBattle')}` : state.paused ? `${icon('play')} ${t('resume')}` : `${icon('pause')} ${t('pause')}`}</button><select data-change="speed" class="speed-select" aria-label="${t('speed')}">${[0.5, 1, 2].map(speed => `<option value="${speed}" ${state.speed === speed ? 'selected' : ''}>${speed}×</option>`).join('')}</select><button class="step-button" data-action="step" ${state.paused && state.battleStarted && !battle.result && !state.replayEventId ? '' : 'disabled'} title="${t('stepHint')}">+0,1 ${t('seconds')}</button><div class="timer" title="${t('tiebreak')}"><span>${t('timeLeft')}</span><strong id="timer-value">${formatTime(battle.maxTicks - battle.tick)}</strong></div><button class="icon-button" data-action="fullscreen" aria-label="${t('fullscreen')}">${icon('fullscreen')}</button></div></header>
    <div class="combat-body"><aside class="combat-left" id="combat-left">${combatTeamPanel()}</aside><section class="combat-center"><div class="scene-toolbar"><button class="${state.readCombat ? 'active' : ''}" data-action="read-combat">${icon('read')} ${t('readCombat')}</button><button data-action="open-history">${icon('history')} ${t('reviewRecent')}</button><button data-action="details">${icon('details')} ${t('inspect')}</button><div class="camera-controls"><button data-action="zoom-out" aria-label="${t('zoomOut')}">−</button><button data-action="zoom-fit">${t('fit')}</button><button data-action="zoom-in" aria-label="${t('zoomIn')}">+</button></div></div><div data-scene class="scene-host"></div>${replayEvent ? `<div class="replay-banner">${t('replayBanner', { time: formatSeconds(replayEvent.tick) })}</div>` : ''}<div class="recent-log" id="battle-log">${battleLog()}</div></section><aside class="combat-right" id="inspect-holder">${inspectPanel()}</aside></div>
    <footer class="combat-bottom" id="combat-bottom">${combatBottom()}</footer>${historyDrawer()}<div id="result-holder">${state.resultHidden ? '' : resultView()}</div><div class="sr-only" id="announcer" aria-live="polite"></div></main>`;
}

function repairPanel() {
  return `<section class="panel"><div class="panel-title"><h2>${t('repairs')}</h2><span class="resource">⚙ ${state.campaign.scrap}</span></div><div class="repair-list">${state.campaign.team.units.map(unit => {
    const cost = repairCost(state.campaign, unit.id);
    const hp = unitHull(unit), max = CHASSIS[unit.chassis].hp;
    return `<div class="repair-row"><header><strong>${esc(unit.name)}</strong><span>${Math.ceil(hp)}/${max}</span></header><div class="hull-line"><span style="width:${hp / max * 100}%"></span></div><button data-action="repair" data-id="${unit.id}" ${!cost || state.campaign.scrap < cost ? 'disabled' : ''}>${cost ? `${t('repair')} · ⚙ ${cost}` : t('fullHull')}</button></div>`;
  }).join('')}</div></section>`;
}

function researchPanel() {
  return `<section class="panel"><div class="panel-title"><div><h2>${t('researchChoice')}</h2><p class="small">${t('researchHelp')}</p></div><span class="resource">✦ ${state.campaign.researchPoints}</span></div><div class="research-branches">${['power', 'protection', 'mobility'].map(branch => `<div class="research-branch"><h3>${t(branch)}</h3>${Object.values(RESEARCH).filter(node => node.branch === branch).map(node => {
    const owned = state.campaign.research.includes(node.id);
    const requirement = !node.requires || state.campaign.research.includes(node.requires);
    return `<div class="research-node ${owned ? 'owned' : ''}"><span class="tiny">0${node.tier}</span><h3>${t(node.id)}</h3><p>${t(`${node.id}Desc`)}</p><button data-action="research" data-id="${node.id}" ${owned || !requirement || state.campaign.researchPoints < 1 ? 'disabled' : ''}>${owned ? '✓ ' + t('unlocked') : requirement ? '✦ ' + t('unlock') : `${t('requires')} ${t(node.requires)}`}</button></div>`;
  }).join('')}</div>`).join('')}</div></section>`;
}

function rewardView() {
  if (state.campaign.completed) return completeView();
  return `<main class="main"><div class="eyebrow">${t('encounter')} ${state.campaign.encounter}/6</div><h1 class="salvage-title">${t('salvage')}</h1><div class="panel reward-summary"><div class="button-row"><span class="chip">⚙ +${state.lastReward?.scrap || 0} ${t('scrap')}</span>${state.lastReward?.variety ? `<span class="chip ally-text">✦ +${state.lastReward.variety} ${t('varietyBonus')}</span>` : ''}<span class="chip">✦ +1 ${t('researchPoints')}</span></div><p class="small">${t('salvageText')}</p></div><div class="reward-grid"><aside>${repairPanel()}<button class="primary wide next-arena" data-action="next-arena">${t('nextArena')} →</button></aside>${researchPanel()}</div></main>`;
}

function completeView() {
  return `<main class="main"><section class="panel hero complete-hero"><div class="eyebrow">${t('finale')}</div><h1>${t('campaignComplete')}</h1><p class="tagline">${t('campaignCompleteText')}</p><div class="feature-list"><span class="chip">${state.campaign.victories} ${t('victory')}</span><span class="chip">⚙ ${state.campaign.scrap}</span><span class="chip">✦ ${state.campaign.research.length}/9</span></div><div class="hero-actions"><button class="primary" data-action="new-campaign">${t('playAgain')}</button><button data-action="test-range">${t('keepExperimenting')}</button></div></section></main>`;
}

function helpModal() {
  if (!state.help) return '';
  return `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><section class="modal-card"><div class="panel-title"><h2 id="help-title">${t('helpTitle')}</h2><button class="icon-button" data-action="close-help" aria-label="${t('close')}">${icon('close')}</button></div><div class="help-steps"><div class="help-step"><strong>${t('helpBuild')}</strong><p>${t('helpBuildText')}</p></div><div class="help-step"><strong>${t('helpFight')}</strong><p>${t('helpFightText')}</p></div><div class="help-step"><strong>${t('helpProgress')}</strong><p>${t('helpProgressText')}</p></div></div><p>${t('helpReadCombat')}</p><p class="small">${t('helpRange')}</p><p class="small">${t('keyboard')}</p><button class="secondary wide motion-button" data-action="toggle-motion">${state.reducedMotion ? '✓ ' : ''}${t('reducedMotion')}</button><button class="primary wide" data-action="close-help">${t('gotIt')}</button></section></div>`;
}

function render() {
  document.documentElement.lang = state.lang;
  document.title = `${t('title')} — Kimi Games`;
  app.classList.toggle('combat-app', state.screen === 'combat');
  const views = { home: homeView, workshop: workshopView, combat: combatView, reward: rewardView, complete: completeView };
  app.innerHTML = `${state.screen === 'combat' ? '' : header()}${(views[state.screen] || homeView)()}${helpModal()}`;
  const host = app.querySelector('[data-scene]');
  if (host) host.appendChild(scene);
  const caption = document.getElementById('scene-caption');
  if (caption) caption.textContent = state.screen === 'combat' ? (state.battleStarted ? t('arenaLegend') : t('preparationLegend')) : state.workshopTab === 'placement' ? t('positionHelp') : t('previewHelp');
  combatBottomSignature = '';
  resultSignature = '';
  updateCombatHud(true);
}

function replaceHtml(element, html, force = false) {
  if (!element) return;
  if (!force && element.contains(document.activeElement) && document.activeElement !== document.body) return;
  element.innerHTML = html;
}

function updateCombatHud(force = false) {
  if (state.screen !== 'combat' || !state.battle) return;
  const battle = state.battle;
  const timer = document.getElementById('timer-value');
  const displayedTick = state.replayEventId ? battle.events.find(event => event.id === state.replayEventId)?.tick ?? battle.tick : battle.tick;
  if (timer) {
    timer.textContent = formatTime(battle.maxTicks - displayedTick);
    timer.classList.toggle('urgent', battle.maxTicks - displayedTick <= 150);
  }
  const pause = document.getElementById('pause-button');
  if (pause) {
    pause.disabled = Boolean(battle.result);
    pause.innerHTML = battle.result ? `${icon('history')} ${t('battleResult')}` : !state.battleStarted ? `${icon('play')} ${t('beginBattle')}` : state.paused ? `${icon('play')} ${t('resume')}` : `${icon('pause')} ${t('pause')}`;
  }
  const step = document.querySelector('[data-action="step"]');
  if (step) step.disabled = !(state.paused && state.battleStarted && !battle.result && !state.replayEventId);
  const caption = document.getElementById('scene-caption');
  if (caption) caption.textContent = state.replayEventId ? t('replayExplanation') : state.battleStarted ? t('arenaLegend') : t('preparationLegend');
  replaceHtml(document.getElementById('combat-left'), combatTeamPanel(), force);
  replaceHtml(document.getElementById('inspect-holder'), inspectPanel(), force);
  replaceHtml(document.getElementById('battle-log'), battleLog(), force);
  const bottomSignature = JSON.stringify([state.paused, state.battleStarted, state.speed, battle.charges.player, state.orderMode, state.orderError, state.replayEventId, state.replayPlaying, battle.result, state.selectedBattleUnit]);
  if (force || bottomSignature !== combatBottomSignature) {
    replaceHtml(document.getElementById('combat-bottom'), combatBottom(), force);
    combatBottomSignature = bottomSignature;
  }
  const nextResultSignature = state.resultHidden ? 'hidden' : String(battle.result?.tick || '');
  if (nextResultSignature !== resultSignature) {
    const holder = document.getElementById('result-holder');
    if (holder) holder.innerHTML = state.resultHidden ? '' : resultView();
    resultSignature = nextResultSignature;
  }
}

function resetRendererEvents() {
  renderer.lastEvent = 0;
  renderer.animations.clear();
  renderer.effects = [];
  lastAudioEvent = 0;
  accumulator = 0;
  presentationTime = 0;
}

function recordTimeline() {
  const eventId = state.battle.nextEventId - 1;
  const previous = state.timeline[state.timeline.length - 1];
  if (previous?.eventId === eventId && previous.tick === state.battle.tick) previous.snapshot = snapshotBattle(state.battle);
  else state.timeline.push({ eventId, tick: state.battle.tick, snapshot: snapshotBattle(state.battle) });
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
  state.paused = true;
  state.battleStarted = false;
  state.orderMode = null;
  state.orderError = null;
  state.rangeInspection = null;
  state.replayEventId = null;
  state.replayPlaying = false;
  state.historyOpen = false;
  state.resultHidden = false;
  state.readCombat = false;
  state.presentation = null;
  state.presentationRevision = -1;
  state.timeline = [];
  state.screen = 'combat';
  state.battle.settled = false;
  state.claiming = false;
  state.camera = { zoom: 1, pan: [0, 0] };
  recordTimeline();
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
  if (!state.battle || state.replayEventId) return;
  for (const event of state.battle.events) {
    if (event.id <= lastAudioEvent) continue;
    lastAudioEvent = event.id;
    if (['attack', 'blast', 'repair', 'disabled', 'order'].includes(event.type)) audio.event(event.type);
  }
}

function selectCombatUnit(id) {
  const unit = unitById(state.battle, id);
  if (!unit) return;
  if (state.orderMode?.type === 'target' && unit.team === 'enemy' && unit.active) {
    state.orderMode.candidateTargetId = id;
    state.orderError = null;
  }
  state.selectedBattleUnit = id;
  updateCombatHud(true);
}

function startOrder(type) {
  if (!state.battle || state.battle.result || state.replayEventId || !state.battleStarted) return;
  state.paused = true;
  state.replayPlaying = false;
  const actor = unitById(state.battle, state.selectedBattleUnit);
  if (!actor?.active || actor.team !== 'player') {
    state.orderError = t('unitUnavailable');
    announce(state.orderError);
    updateCombatHud(true);
    return;
  }
  if (state.battle.charges.player <= 0) {
    state.orderError = t('noCharges');
    announce(state.orderError);
    updateCombatHud(true);
    return;
  }
  const currentModule = selectedModule();
  state.orderMode = {
    type, actorId: actor.id, candidateTargetId: null,
    candidateModuleId: type === 'overload' && currentModule?.unit.id === actor.id && MODULES[currentModule.entry.id].kind !== 'passive' ? currentModule.entry.id : null,
    token: `${state.battle.tick}:${state.battle.nextEventId}:${type}`
  };
  state.orderError = null;
  announce(t('tacticalPause'));
  updateCombatHud(true);
}

function confirmOrder() {
  const data = orderDraft();
  if (!data?.ready || state.orderConfirmationLocked) return;
  state.orderConfirmationLocked = true;
  const token = data.draft.token;
  const result = issueOrder(state.battle, 'player', data.order);
  if (state.orderMode?.token !== token) {
    state.orderConfirmationLocked = false;
    return;
  }
  if (!result.ok) {
    state.orderError = orderReason(result.reason);
    state.orderConfirmationLocked = false;
    announce(state.orderError);
    updateCombatHud(true);
    return;
  }
  const accepted = state.battle.events.find(event => event.id === result.eventId);
  state.orderMode = null;
  state.orderError = null;
  state.paused = true;
  state.presentation = null;
  state.presentationRevision = -1;
  recordTimeline();
  const message = eventText(accepted);
  toast(message);
  announce(message);
  audio.event('order');
  state.orderConfirmationLocked = false;
  updateCombatHud(true);
}

function cancelOrder() {
  state.orderMode = null;
  state.orderError = null;
  state.orderConfirmationLocked = false;
  state.paused = true;
  updateCombatHud(true);
}

function doStep() {
  if (!state.battle || state.battle.result) return;
  stepBattle(state.battle);
  if (state.battle.result) state.paused = true;
  state.presentation = null;
  state.presentationRevision = -1;
  recordTimeline();
  processAudio();
  settleDefeat();
  if (state.battle.result) updateCombatHud(true);
}

function openReplay(eventId) {
  const event = state.battle?.events.find(candidate => candidate.id === Number(eventId));
  if (!event) return;
  state.paused = true;
  state.orderMode = null;
  state.historyOpen = false;
  state.replayEventId = event.id;
  state.replayPlaying = false;
  state.resultHidden = true;
  render();
}

function replayFrame() {
  if (!state.replayEventId) return state.battle;
  const frames = state.timeline.filter(frame => frame.eventId < state.replayEventId);
  const frame = frames[frames.length - 1] || state.timeline[0];
  return { ...frame.snapshot, events: state.battle.events };
}

function changeReplayEvent(direction) {
  const events = state.battle.events;
  const index = events.findIndex(event => event.id === state.replayEventId);
  const next = events[Math.max(0, Math.min(events.length - 1, index + direction))];
  if (next) openReplay(next.id);
}

function returnLive() {
  state.replayEventId = null;
  state.replayPlaying = false;
  state.paused = true;
  state.resultHidden = false;
  render();
}

function closeHelp() {
  state.help = false;
  preferences.seenHelp = true;
  persistPreferences();
  render();
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (app.requestFullscreen) await app.requestFullscreen();
    else toast(t('fullscreenUnavailable'));
  } catch { toast(t('fullscreenUnavailable')); }
}

function handleAction(button) {
  const action = button.dataset.action;
  audio.unlock();
  if (action === 'home') { state.screen = 'home'; state.battle = null; state.replayEventId = null; render(); }
  else if (action === 'help') { state.help = true; if (state.screen === 'combat') state.paused = true; render(); }
  else if (action === 'close-help') closeHelp();
  else if (action === 'sound') { audio.enabled = !audio.enabled; persistPreferences(); render(); }
  else if (action === 'toggle-motion') { state.reducedMotion = !state.reducedMotion; persistPreferences(); render(); }
  else if (action === 'fullscreen') toggleFullscreen();
  else if (action === 'new-campaign') {
    if (state.hasSave && state.campaign.encounter > 0 && !window.confirm(t('confirmNew'))) return;
    state.campaign = createCampaign(); state.mode = 'campaign'; state.selectedUnit = 0; state.screen = 'workshop'; state.workshopTab = 'assemble'; state.hasSave = true;
    persistCampaign(); state.help = !preferences.seenHelp; render();
  }
  else if (action === 'continue') { state.mode = 'campaign'; state.screen = state.campaign.completed ? 'complete' : 'workshop'; state.selectedUnit = 0; state.workshopTab = 'assemble'; render(); }
  else if (action === 'test-range') { state.mode = 'lab'; state.screen = 'workshop'; state.editSide = 0; state.selectedUnit = 0; state.workshopTab = 'assemble'; render(); }
  else if (action === 'select-unit') { state.selectedUnit = Number(button.dataset.index); state.previewModule = null; state.placement = null; render(); }
  else if (action === 'edit-side') { state.editSide = Number(button.dataset.side); state.selectedUnit = 0; state.previewModule = null; render(); }
  else if (action === 'workshop-tab') { state.workshopTab = button.dataset.tab; state.previewModule = null; state.placement = null; render(); }
  else if (action === 'select-socket') { state.selectedSocket = button.dataset.socket; state.previewModule = null; render(); }
  else if (action === 'rotate-robot') { state.workshopRotation = (state.workshopRotation + Math.PI / 2) % (Math.PI * 2); }
  else if (action === 'preview-module') { state.previewModule = { id: button.dataset.module, socket: state.selectedSocket }; render(); }
  else if (action === 'cancel-preview') { state.previewModule = null; render(); }
  else if (action === 'equip-preview') {
    if (!state.previewModule) return;
    const unit = currentTeam().units[state.selectedUnit];
    unit.modules = unit.modules.filter(entry => entry.socket !== state.previewModule.socket);
    if (state.previewModule.id) unit.modules.push({ id: state.previewModule.id, socket: state.previewModule.socket });
    state.previewModule = null;
    if (state.mode === 'campaign') persistCampaign();
    render();
  }
  else if (action === 'cancel-placement') { state.placement = null; render(); }
  else if (action === 'confirm-placement') {
    if (!state.placement) return;
    const unit = currentTeam().units[state.selectedUnit];
    const previous = unit.position || [0, [1, 3, 5][state.selectedUnit]];
    const other = currentTeam().units.find((candidate, index) => candidate !== unit && (candidate.position?.[0] ?? 0) === state.placement.x && (candidate.position?.[1] ?? [1, 3, 5][index]) === state.placement.y);
    if (other) other.position = previous;
    unit.position = [state.placement.x, state.placement.y];
    state.placement = null;
    if (state.mode === 'campaign') persistCampaign();
    render();
  }
  else if (action === 'start-battle') startBattle();
  else if (action === 'pause') {
    if (state.replayEventId) returnLive();
    else if (!state.battleStarted) { state.battleStarted = true; state.paused = false; announce(t('battleStarted')); }
    else state.paused = !state.paused;
    updateCombatHud(true);
  }
  else if (action === 'step') { if (state.paused) doStep(); state.paused = true; updateCombatHud(true); }
  else if (action === 'combat-unit') selectCombatUnit(button.dataset.id);
  else if (action === 'inspect-module') {
    const key = { unitId: button.dataset.id, socket: button.dataset.socket };
    state.rangeInspection = state.rangeInspection?.unitId === key.unitId && state.rangeInspection?.socket === key.socket ? null : key;
    updateCombatHud(true);
  }
  else if (action === 'read-combat') { state.readCombat = !state.readCombat; render(); }
  else if (action === 'details') { state.detailsOpen = !state.detailsOpen; if (state.detailsOpen) state.paused = true; render(); }
  else if (action === 'order-target') startOrder('target');
  else if (action === 'order-retreat') startOrder('retreat');
  else if (action === 'order-overload') startOrder('overload');
  else if (action === 'choose-overload-module') { if (state.orderMode?.type === 'overload') { state.orderMode.candidateModuleId = button.dataset.module; state.orderError = null; updateCombatHud(true); } }
  else if (action === 'confirm-order') confirmOrder();
  else if (action === 'cancel-order') cancelOrder();
  else if (action === 'open-history') { state.historyOpen = true; state.paused = true; render(); }
  else if (action === 'close-history') { state.historyOpen = false; render(); }
  else if (action === 'history-filter') { state.historyFilter = button.dataset.filter; render(); }
  else if (action === 'replay-event') openReplay(Number(button.dataset.id));
  else if (action === 'review-combat') { if (state.battle.events.length) openReplay(state.battle.events[0].id); else toast(t('historyUnavailable')); }
  else if (action === 'previous-event') changeReplayEvent(-1);
  else if (action === 'next-event') changeReplayEvent(1);
  else if (action === 'replay-play') { state.replayPlaying = !state.replayPlaying; lastReplayStep = 0; updateCombatHud(true); }
  else if (action === 'return-live') returnLive();
  else if (action === 'hide-result') { state.resultHidden = true; updateCombatHud(true); }
  else if (action === 'claim') {
    if (state.claiming || state.screen !== 'combat' || !state.battle?.result || state.battle.settled) return;
    state.claiming = true;
    state.battle.settled = true;
    const reward = applyVictory(state.campaign, state.battle);
    state.lastReward = reward; persistCampaign(); state.screen = 'reward'; state.battle = null; audio.event('victory'); state.claiming = false; render();
  }
  else if (action === 'retry') { state.screen = 'workshop'; state.battle = null; render(); }
  else if (action === 'next-arena') { state.screen = state.campaign.completed ? 'complete' : 'workshop'; state.selectedUnit = 0; state.workshopTab = 'assemble'; render(); }
  else if (action === 'repair') { if (repairUnit(state.campaign, button.dataset.id)) { persistCampaign(); toast(t('repaired')); } else toast(t('notEnoughScrap')); render(); }
  else if (action === 'research') { if (purchaseResearch(state.campaign, button.dataset.id)) { persistCampaign(); toast(t('unlocked')); audio.event('repair'); } render(); }
  else if (action === 'swap-replay') { state.lab.teams.reverse(); startBattle(); }
  else if (action === 'fight-again') startBattle();
  else if (action === 'edit-teams') { state.screen = 'workshop'; state.battle = null; render(); }
  else if (action === 'save-plan') {
    const slot = Number(button.dataset.slot);
    if (loadBlueprints(storage)[slot] && !window.confirm(t('confirmOverwritePlan'))) return;
    saveBlueprint(storage, slot, currentTeam(), `${t(state.editSide === 0 ? 'teamA' : 'teamB')} ${slot + 1}`); toast(t('saved')); render();
  }
  else if (action === 'load-plan') { const plan = loadBlueprints(storage)[Number(button.dataset.slot)]; if (plan && window.confirm(t('confirmLoadPlan'))) { state.lab.teams[state.editSide] = clone(plan.team); state.selectedUnit = 0; toast(t('loaded')); render(); } }
  else if (action === 'apply-example') { const selected = document.getElementById('example-select').value; state.lab.teams[state.editSide] = clone(EXAMPLE_TEAMS[selected]); state.selectedUnit = 0; render(); }
  else if (action === 'zoom-in') { state.camera.zoom = Math.min(2, state.camera.zoom + 0.25); }
  else if (action === 'zoom-out') { state.camera.zoom = Math.max(1, state.camera.zoom - 0.25); if (state.camera.zoom === 1) state.camera.pan = [0, 0]; }
  else if (action === 'zoom-fit') { state.camera = { zoom: 1, pan: [0, 0] }; }
}

app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button && !button.disabled) handleAction(button);
});

scene.addEventListener('click', event => {
  if (suppressSceneClick) { suppressSceneClick = false; return; }
  if (event.target.closest('button') || event.target.tagName.toLowerCase() !== 'canvas') return;
  const picked = renderer.pick(event.clientX, event.clientY);
  if (!picked) return;
  if (picked.type === 'work-unit' && state.screen === 'workshop') return;
  if (picked.type === 'socket' && state.screen === 'workshop') { state.selectedSocket = picked.socket; state.previewModule = null; render(); }
  if (picked.type === 'unit' && state.screen === 'combat') selectCombatUnit(picked.id);
  if (picked.type === 'cell' && state.screen === 'workshop' && state.workshopTab === 'placement') {
    if (!legalPlacementCells().some(cell => cell.x === picked.gridX && cell.y === picked.gridY)) { toast(t('illegalCell')); return; }
    state.placement = { unitId: currentTeam().units[state.selectedUnit].id, x: picked.gridX, y: picked.gridY };
    render();
  }
});

scene.addEventListener('pointerdown', event => {
  if (event.target.tagName.toLowerCase() !== 'canvas' || state.camera.zoom <= 1) return;
  drag = { x: event.clientX, y: event.clientY, pan: [...state.camera.pan], moved: false };
  scene.setPointerCapture(event.pointerId);
});
scene.addEventListener('pointermove', event => {
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (Math.hypot(dx, dy) > 6) drag.moved = true;
  if (drag.moved) state.camera.pan = [drag.pan[0] - dx * 0.018 / state.camera.zoom, drag.pan[1] - dy * 0.018 / state.camera.zoom];
});
scene.addEventListener('pointerup', () => { if (drag?.moved) suppressSceneClick = true; drag = null; });

app.addEventListener('change', event => {
  const input = event.target.closest('[data-change]');
  if (!input) return;
  const action = input.dataset.change;
  if (action === 'language') { state.lang = input.value; persistPreferences(); render(); return; }
  if (action === 'speed') { state.speed = Number(input.value); persistPreferences(); return; }
  if (action === 'replay-slider') { const eventAt = state.battle.events[Number(input.value)]; if (eventAt) openReplay(eventAt.id); return; }
  if (action === 'lab-arena') { state.lab.arena = input.value; state.placement = null; render(); return; }
  const unit = currentTeam().units[state.selectedUnit];
  if (action === 'unit-name') unit.name = input.value.trim().slice(0, 16) || unit.name;
  if (action === 'chassis') { unit.chassis = input.value; state.placement = null; }
  if (action === 'behavior') unit.behavior = input.value;
  if (state.mode === 'campaign') persistCampaign();
  render();
});

window.addEventListener('keydown', event => {
  if (event.target.matches('input, select, textarea')) return;
  if (event.key === 'Escape') {
    if (state.help) closeHelp();
    else if (state.orderMode) cancelOrder();
    else if (state.historyOpen || state.detailsOpen) { state.historyOpen = false; state.detailsOpen = false; render(); }
    else if (state.replayEventId) returnLive();
    else if (state.screen === 'combat') { state.paused = true; updateCombatHud(true); }
    return;
  }
  if (event.repeat) return;
  if (event.key.toLowerCase() === 'm') { audio.enabled = !audio.enabled; persistPreferences(); render(); return; }
  if (state.screen === 'workshop' && state.workshopTab === 'placement' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) {
    event.preventDefault();
    const current = state.placement || { x: currentTeam().units[state.selectedUnit].position?.[0] ?? 0, y: currentTeam().units[state.selectedUnit].position?.[1] ?? [1, 3, 5][state.selectedUnit] };
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], Enter: [0, 0] }[event.key];
    const x = Math.max(0, Math.min(2, current.x + delta[0])), y = Math.max(0, Math.min(6, current.y + delta[1]));
    if (legalPlacementCells().some(cell => cell.x === x && cell.y === y)) state.placement = { unitId: currentTeam().units[state.selectedUnit].id, x, y };
    render();
    return;
  }
  if (state.screen !== 'combat' || !state.battle) return;
  if (event.code === 'Space') { event.preventDefault(); document.getElementById('pause-button')?.click(); }
  if (['1', '2', '3'].includes(event.key)) { const unit = state.battle.units.filter(candidate => candidate.team === 'player')[Number(event.key) - 1]; if (unit) selectCombatUnit(unit.id); }
  if (event.key.toLowerCase() === 't') startOrder('target');
  if (event.key.toLowerCase() === 'r') startOrder('retreat');
  if (event.key.toLowerCase() === 'o') startOrder('overload');
});

function presentationOptions(display) {
  const replayEvent = state.battle.events.find(event => event.id === state.replayEventId) || null;
  const selection = selectedModule();
  const draft = orderDraft();
  return {
    intents: replayEvent ? {} : state.presentation || describeBattle(display),
    readCombat: state.readCombat && !replayEvent,
    range: selection && !replayEvent ? { cells: rangeOverlay(state.battle, selection.unit, selection.entry), targetIds: moduleTargets(state.battle, selection.unit, selection.entry).map(unit => unit.id) } : null,
    highlightSocket: selection,
    orderPreview: draft?.ready && draft.preview?.result.ok && !replayEvent ? { actorId: draft.draft.actorId, targetId: draft.draft.candidateTargetId, action: draft.preview.action } : null,
    replayEvent, camera: state.camera, reducedMotion: state.reducedMotion, lab: state.mode === 'lab'
  };
}

function frame(now) {
  const delta = Math.min(100, now - previousFrame);
  previousFrame = now;
  if (state.renderLost) { requestAnimationFrame(frame); return; }
  if (state.screen === 'combat' && state.battle) {
    if (!state.paused && !state.battle.result && !state.replayEventId && state.battleStarted) {
      presentationTime += delta * state.speed;
      accumulator += delta * state.speed;
      while (accumulator >= 100 && !state.battle.result) {
        doStep();
        accumulator -= 100;
      }
      settleDefeat();
    }
    if (state.replayPlaying && state.replayEventId) {
      if (!lastReplayStep) lastReplayStep = now;
      if (now - lastReplayStep > 420 / state.speed) {
        const index = state.battle.events.findIndex(event => event.id === state.replayEventId);
        if (index >= state.battle.events.length - 1) state.replayPlaying = false;
        else {
          state.replayEventId = state.battle.events[index + 1].id;
          lastReplayStep = now;
          updateCombatHud(true);
        }
      }
    }
    const display = replayFrame();
    renderer.renderBattle(display, state.selectedBattleUnit, presentationTime, presentationOptions(display));
    if (!state.paused && !state.replayEventId && now - previousHud > 220) { updateCombatHud(); previousHud = now; }
  } else if (['home', 'workshop'].includes(state.screen)) {
    if (state.screen === 'workshop' && state.workshopTab === 'placement') {
      const opponent = currentOpponent();
      const selected = currentTeam().units[state.selectedUnit];
      renderer.renderDeployment(ARENAS[opponent.arena], currentTeam().units, opponent.team.units, selected.id, now, {
        placement: { legalCells: legalPlacementCells(), candidate: state.placement }, camera: state.camera, reducedMotion: state.reducedMotion, lab: state.mode === 'lab'
      });
    } else renderer.renderWorkshop(previewUnit(), now, { rotation: state.workshopRotation, reducedMotion: state.reducedMotion, highlightSocket: state.selectedSocket });
  }
  requestAnimationFrame(frame);
}

const resizeObserver = new ResizeObserver(entries => {
  const rect = entries[0].contentRect;
  app.dataset.layout = rect.width < 600 ? 'portrait' : rect.height < 600 ? 'low' : rect.width < 760 ? 'portrait' : rect.width < 1180 ? 'tablet' : rect.width < 1440 || rect.height < 800 ? 'compact' : 'wide';
});
resizeObserver.observe(app);

async function boot() {
  try {
    renderer = new Renderer(scene.querySelector('#scene-gl'), scene.querySelector('#scene-overlay'));
    await renderer.load();
    const glCanvas = scene.querySelector('#scene-gl');
    glCanvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      state.renderLost = true;
      state.paused = true;
      toast(t('webglLost'));
      announce(t('webglLost'));
      updateCombatHud(true);
    });
    glCanvas.addEventListener('webglcontextrestored', async () => {
      try {
        const replacement = new Renderer(glCanvas, scene.querySelector('#scene-overlay'));
        await replacement.load();
        renderer = replacement;
        resetRendererEvents();
        state.renderLost = false;
        render();
        toast(t('webglRestored'));
      } catch (error) { console.error(error); toast(t('loadError')); }
    });
    render();
    requestAnimationFrame(frame);
    window.__SCRAP_LEAGUE__ = {
      version: '1.1.0',
      snapshot: () => ({
        screen: state.screen, mode: state.mode, encounter: state.campaign.encounter,
        battleTick: state.battle?.tick || 0, paused: state.paused, started: state.battleStarted,
        speed: state.speed, charges: state.battle?.charges.player ?? null,
        selectedUnit: state.selectedBattleUnit, orderMode: state.orderMode?.type || null,
        replayEventId: state.replayEventId, events: state.battle?.events.length || 0,
        orders: state.battle?.events.filter(event => event.type === 'order').length || 0,
        cameraZoom: state.camera.zoom, renderLost: Boolean(state.renderLost), presentationTime: Math.round(presentationTime),
        result: state.battle?.result || null, modulesVisible: renderer.gpu.size,
        layout: app.dataset.layout, drawCalls: renderer.stats.drawCalls,
        pageWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth,
        pageHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight
      })
    };
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="boot"><strong>${t('loadError')}</strong><span>${t('webgl')}</span><button onclick="location.reload()">${t('retryLoad')}</button></div>`;
  }
}

boot();
