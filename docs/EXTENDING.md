# Extending Scrap League

Keep rules independent of presentation. Numerical variants belong in data; only a genuinely new verb should need a localized code change. Run `npm test` and add a focused rule test for new behavior.

## Add a chassis

1. Model `chassis-your-id` in Blender around a ground-level origin, including four visible standard sockets. Follow `docs/ATTACHMENTS.md` and export `assets/models/chassis-your-id.glb`.
2. Add socket coordinates under `sockets.your-id` in `assets/models/attachments.json`.
3. Add `CHASSIS['your-id']` in `src/data/catalog.js`: hull, weight/energy capacity, movement interval, model name, sockets and narrow-passage permission.
4. Add translations and a description in `src/i18n.js`. The workshop, repair costs, simulation and renderer read the chassis catalog.
5. Test path permissions, capacity and a combat matchup. A new movement verb, rather than a stat variant, belongs in `src/ai/behaviors.js` with a small effect in `src/sim/combat.js`.

## Add a weapon

For a range, damage or cadence variant, only add a module entry and model:

1. Export `module-your-id.glb` and add its data to `MODULES` in `src/data/catalog.js`: `kind: 'weapon'`, weight, energy, compatible sockets, range/minimum range, cooldown, damage and model.
2. Decide whether it is initially available (`BASE_UNLOCKED`) or research-gated (`unlocks` in a research node), then add translations.
3. Existing single-target attacks need no combat-code change. Area damage uses `effect: 'aoe'` plus `area`; movement delay uses `effect: 'stun'`.
4. A new attack verb is selected in `chooseUnitAction` (`src/ai/behaviors.js`) and resolved in `performAction`/`applyDamage` (`src/sim/combat.js`). Keep rendering event-driven in `src/render/renderer.js`.

## Add a support module

1. Add the model and a `kind: 'support'` entry with weight, energy, sockets, range, cooldown and healing/effect data.
2. Ally selection and support range checks live in `chooseUnitAction`; resource restoration is localized in the support branch of `performAction`.
3. Passive support such as energy capacity, shielding or armor uses `kind: 'passive'` and a named `effect`. Its validator or damage/energy hook is the only rule code to extend.
4. Test target choice, range, cooldown, maximum hull and interaction with overload/research.

## Add an opponent

Append an entry to `OPPONENTS` in `src/data/campaign.js` with an id, translation key, arena, research and exactly three units. Use the same module/socket objects as player blueprints. Enemy unlocks are resolved by `unlockedModules(opponent.research)` and passed through `validateTeam`, exactly like the player. Do not give enemies hidden hull, damage or cooldown multipliers. Add a deterministic duel and check that the battle reaches a conclusion.

## Add an arena

1. Create an `arena-your-kit` environment and any obstacle GLBs in `assets/blender/arenas.blend` and `tools/generate_assets.py`; export them to `assets/models/`.
2. Add the logical board to `ARENAS` in `src/data/catalog.js`: width, height, kit, blocked cells, narrow cells and three starts per side.
3. Add the environment model name to the loading list in `Renderer.load` and choose obstacle models in the existing renderer mapping if new props are needed.
4. Add translations. Test path blocking, spider-only narrow routes, valid starts, range behavior and the 90-second conclusion.

## Add a research node

1. Add a node to `RESEARCH` in `src/data/campaign.js`: branch, tier, prerequisite and either `unlocks` or a named effect.
2. Add its name/description in all three language dictionaries. The UI builds the nine-node tree from this data.
3. Module unlocks need no additional rule code. A new effect should have one explicit hook: combat effects in `src/sim/combat.js`, movement in `src/ai/behaviors.js` or assembly in `src/sim/assembly.js`.
4. Test prerequisites, point spending, persistence and the actual effect. Keep a campaign route that does not require every node.
