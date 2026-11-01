export const RESEARCH = {
  'power-hammer': { id: 'power-hammer', branch: 'power', tier: 1, requires: null, unlocks: ['hammer'] },
  'power-mortar': { id: 'power-mortar', branch: 'power', tier: 2, requires: 'power-hammer', unlocks: ['mortar'] },
  'power-surge': { id: 'power-surge', branch: 'power', tier: 3, requires: 'power-mortar', effect: 'surge' },
  'protection-armor': { id: 'protection-armor', branch: 'protection', tier: 1, requires: null, unlocks: ['armor'] },
  'protection-repair': { id: 'protection-repair', branch: 'protection', tier: 2, requires: 'protection-armor', effect: 'repair' },
  'protection-guard': { id: 'protection-guard', branch: 'protection', tier: 3, requires: 'protection-repair', effect: 'guard' },
  'mobility-boost': { id: 'mobility-boost', branch: 'mobility', tier: 1, requires: null, unlocks: ['boost'] },
  'mobility-sensor': { id: 'mobility-sensor', branch: 'mobility', tier: 2, requires: 'mobility-boost', unlocks: ['sensor'] },
  'mobility-agile': { id: 'mobility-agile', branch: 'mobility', tier: 3, requires: 'mobility-sensor', effect: 'agile' }
};

const unit = (id, name, chassis, modules, behavior = 'nearest') => ({ id, name, chassis, behavior, modules: modules.map(([id, socket]) => ({ id, socket })) });

export const DEFAULT_TEAM = {
  units: [
    unit('nib', 'Nib', 'light', [['blade', 'left'], ['repair', 'top']]),
    unit('clank', 'Clank', 'heavy', [['shield', 'left'], ['blaster', 'top']]),
    unit('pip', 'Pip', 'spider', [['blaster', 'right'], ['battery', 'back']], 'keepRange')
  ]
};

export const EXAMPLE_TEAMS = {
  balanced: DEFAULT_TEAM,
  bulwark: { units: [
    unit('bastion', 'Bastion', 'heavy', [['shield', 'left'], ['armor', 'back'], ['blaster', 'top']], 'protect'),
    unit('socket', 'Socket', 'heavy', [['hammer', 'right'], ['repair', 'back']]),
    unit('gleam', 'Gleam', 'spider', [['repair', 'top'], ['battery', 'back'], ['sensor', 'left']], 'fragile')
  ] },
  skirmish: { units: [
    unit('zip', 'Zip', 'light', [['blade', 'left'], ['boost', 'back'], ['battery', 'top']], 'fragile'),
    unit('dot', 'Dot', 'spider', [['blaster', 'right'], ['sensor', 'top']], 'keepRange'),
    unit('moth', 'Moth', 'light', [['mortar', 'top'], ['battery', 'back']], 'keepRange')
  ] }
};

export const OPPONENTS = [
  {
    id: 'tin-can-choir', name: 'tinCanChoir', arena: 'workbench', research: [],
    team: { units: [
      unit('rival-a', 'Rattle', 'light', [['blade', 'left']]),
      unit('rival-b', 'Iris', 'light', [['blaster', 'right']], 'keepRange'),
      unit('rival-c', 'Mend', 'heavy', [['shield', 'left'], ['repair', 'top']])
    ] }
  },
  {
    id: 'roof-runners', name: 'roofRunners', arena: 'rooftop', research: ['mobility-boost'],
    team: { units: [
      unit('rival-a', 'Skip', 'light', [['blade', 'left'], ['boost', 'back']]),
      unit('rival-b', 'Slink', 'spider', [['blaster', 'right']], 'keepRange'),
      unit('rival-c', 'Anchor', 'heavy', [['shield', 'left'], ['repair', 'top']])
    ] }
  },
  {
    id: 'glasshouse-garden', name: 'glasshouseGarden', arena: 'greenhouse', research: ['power-hammer', 'power-mortar', 'protection-armor'],
    team: { units: [
      unit('rival-a', 'Bloom', 'spider', [['mortar', 'top'], ['battery', 'back']], 'keepRange'),
      unit('rival-b', 'Pot', 'heavy', [['blade', 'left'], ['armor', 'back']]),
      unit('rival-c', 'Sprout', 'light', [['repair', 'top'], ['battery', 'back'], ['blade', 'left']])
    ] }
  },
  {
    id: 'iron-umbrella', name: 'ironUmbrella', arena: 'workbench', research: ['power-hammer', 'protection-armor', 'mobility-boost', 'mobility-sensor'],
    team: { units: [
      unit('rival-a', 'Umbra', 'heavy', [['hammer', 'right'], ['shield', 'left']], 'protect'),
      unit('rival-b', 'Rivet', 'heavy', [['blaster', 'right'], ['armor', 'back']], 'keepRange'),
      unit('rival-c', 'Wisp', 'spider', [['repair', 'back'], ['sensor', 'top'], ['blade', 'left']], 'fragile')
    ] }
  },
  {
    id: 'needle-parliament', name: 'needleParliament', arena: 'rooftop', research: ['power-hammer', 'power-mortar', 'mobility-boost', 'mobility-sensor', 'mobility-agile'],
    team: { units: [
      unit('rival-a', 'Needle', 'light', [['blaster', 'right'], ['sensor', 'top'], ['battery', 'back']], 'keepRange'),
      unit('rival-b', 'Quorum', 'spider', [['mortar', 'top'], ['battery', 'back'], ['blade', 'left']], 'fragile'),
      unit('rival-c', 'Speaker', 'heavy', [['hammer', 'right'], ['repair', 'back']])
    ] }
  },
  {
    id: 'grand-salvager', name: 'grandSalvager', arena: 'greenhouse', research: ['power-hammer', 'power-mortar', 'power-surge', 'protection-armor', 'protection-repair', 'protection-guard', 'mobility-boost', 'mobility-sensor', 'mobility-agile'],
    team: { units: [
      unit('rival-a', 'Grand Claw', 'heavy', [['blaster', 'right'], ['shield', 'left'], ['armor', 'back']], 'protect'),
      unit('rival-b', 'Oracle', 'spider', [['mortar', 'top'], ['sensor', 'left'], ['boost', 'back']], 'fragile'),
      unit('rival-c', 'Keeper', 'heavy', [['blaster', 'right'], ['repair', 'back'], ['battery', 'top']], 'keepRange')
    ] }
  }
];
