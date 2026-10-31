export const SOCKETS = ['left', 'right', 'top', 'back'];

export const CHASSIS = {
  light: {
    id: 'light', name: 'light', hp: 52, weight: 8, energy: 7, moveEvery: 3,
    model: 'chassis-light', sockets: SOCKETS, narrow: false
  },
  heavy: {
    id: 'heavy', name: 'heavy', hp: 92, weight: 15, energy: 9, moveEvery: 6,
    model: 'chassis-heavy', sockets: SOCKETS, narrow: false
  }
};

export const MODULES = {
  blade: {
    id: 'blade', name: 'blade', kind: 'weapon', weight: 3, energy: 2,
    sockets: ['left', 'right'], range: 1, cooldown: 0.8, damage: 16, model: 'module-blade'
  },
  blaster: {
    id: 'blaster', name: 'blaster', kind: 'weapon', weight: 3, energy: 3,
    sockets: ['left', 'right', 'top'], range: 4, minRange: 2, cooldown: 1.2, damage: 10, model: 'module-blaster'
  },
  repair: {
    id: 'repair', name: 'repair', kind: 'support', weight: 3, energy: 3,
    sockets: ['top', 'back'], range: 3, cooldown: 1.8, heal: 15, model: 'module-repair'
  }
};

export const ARENAS = {
  workbench: {
    id: 'workbench', name: 'workbench', width: 9, height: 7, kit: 'workbench',
    obstacles: [[4, 1], [4, 5]], narrow: [],
    starts: {
      player: [[0, 1], [0, 3], [0, 5]],
      enemy: [[8, 1], [8, 3], [8, 5]]
    }
  }
};

export const BEHAVIORS = ['nearest', 'fragile', 'protect', 'keepRange'];
export const TICK_SECONDS = 0.1;
export const MAX_TICKS = 900;

export function moduleEntry(entry) {
  return typeof entry === 'string' ? { id: entry, socket: MODULES[entry]?.sockets[0] } : entry;
}
