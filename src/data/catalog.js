export const SOCKETS = ['left', 'right', 'top', 'back'];

export const CHASSIS = {
  light: { id: 'light', name: 'light', hp: 52, weight: 8, energy: 5, moveEvery: 3, model: 'chassis-light', sockets: SOCKETS, narrow: false },
  heavy: { id: 'heavy', name: 'heavy', hp: 92, weight: 12, energy: 7, moveEvery: 6, model: 'chassis-heavy', sockets: SOCKETS, narrow: false },
  spider: { id: 'spider', name: 'spider', hp: 62, weight: 10, energy: 8, moveEvery: 4, model: 'chassis-spider', sockets: SOCKETS, narrow: true }
};

export const MODULES = {
  blade: { id: 'blade', name: 'blade', kind: 'weapon', weight: 3, energy: 2, sockets: ['left', 'right'], range: 1, cooldown: 0.8, damage: 16, model: 'module-blade' },
  hammer: { id: 'hammer', name: 'hammer', kind: 'weapon', weight: 5, energy: 3, sockets: ['left', 'right'], range: 1, cooldown: 2.8, damage: 22, effect: 'stun', model: 'module-hammer' },
  blaster: { id: 'blaster', name: 'blaster', kind: 'weapon', weight: 3, energy: 3, sockets: ['left', 'right', 'top'], range: 4, minRange: 2, cooldown: 1.2, damage: 10, model: 'module-blaster' },
  mortar: { id: 'mortar', name: 'mortar', kind: 'weapon', weight: 5, energy: 4, sockets: ['top'], range: 4, minRange: 2, area: 1, cooldown: 2.5, damage: 15, effect: 'aoe', model: 'module-mortar' },
  shield: { id: 'shield', name: 'shield', kind: 'passive', weight: 4, energy: 2, sockets: ['left', 'right'], effect: 'shield', amount: 0.3, model: 'module-shield' },
  repair: { id: 'repair', name: 'repair', kind: 'support', weight: 3, energy: 3, sockets: ['top', 'back'], range: 3, cooldown: 1.8, heal: 15, model: 'module-repair' },
  boost: { id: 'boost', name: 'boost', kind: 'mobility', weight: 2, energy: 2, sockets: ['back'], range: 2, cooldown: 4, effect: 'dash', model: 'module-boost' },
  battery: { id: 'battery', name: 'battery', kind: 'passive', weight: 2, energy: 0, sockets: ['top', 'back'], effect: 'battery', amount: 4, model: 'module-battery' },
  armor: { id: 'armor', name: 'armor', kind: 'passive', weight: 5, energy: 0, sockets: ['back', 'top'], effect: 'armor', amount: 2, model: 'module-armor' },
  sensor: { id: 'sensor', name: 'sensor', kind: 'passive', weight: 2, energy: 2, sockets: ['left', 'right', 'top'], effect: 'sensor', amount: 1, model: 'module-sensor' }
};

export const ARENAS = {
  workbench: {
    id: 'workbench', name: 'workbench', width: 9, height: 7, kit: 'workbench',
    obstacles: [[4, 1], [4, 5]], narrow: [],
    starts: { player: [[0, 1], [0, 3], [0, 5]], enemy: [[8, 1], [8, 3], [8, 5]] }
  },
  rooftop: {
    id: 'rooftop', name: 'rooftop', width: 9, height: 7, kit: 'rooftop',
    obstacles: [[3, 0], [3, 1], [5, 5], [5, 6], [4, 3]], narrow: [[3, 3], [5, 3]],
    starts: { player: [[0, 1], [0, 3], [0, 5]], enemy: [[8, 1], [8, 3], [8, 5]] }
  },
  greenhouse: {
    id: 'greenhouse', name: 'greenhouse', width: 9, height: 7, kit: 'greenhouse',
    obstacles: [[4, 0], [4, 2], [4, 4], [4, 6], [2, 3], [6, 3]], narrow: [[4, 1], [4, 3], [4, 5]],
    starts: { player: [[0, 1], [0, 3], [0, 5]], enemy: [[8, 1], [8, 3], [8, 5]] }
  }
};

export const BEHAVIORS = ['nearest', 'fragile', 'protect', 'keepRange'];
export const TICK_SECONDS = 0.1;
export const MAX_TICKS = 900;
export const BASE_UNLOCKED = ['blade', 'blaster', 'shield', 'repair', 'battery'];

export function moduleEntry(entry) {
  return typeof entry === 'string' ? { id: entry, socket: MODULES[entry]?.sockets[0] } : entry;
}

export function hasModule(unit, effect) {
  return unit.modules.some(entry => MODULES[entry.id]?.effect === effect);
}

export function weaponRange(unit, module) {
  return module.range + (module.kind === 'weapon' && hasModule(unit, 'sensor') ? 1 : 0);
}
