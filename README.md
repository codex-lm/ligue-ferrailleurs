# Scrap League — La Ligue des Ferrailleurs

A complete, local-first strategy game about assembling three expressive mechanical toys and reading their deterministic arena fights. Designed and developed with Kimi for Kimi Games. Version 1.1.0 adds a combat-readability and artistic refonte without changing the underlying statistics or campaign rules.

## Play

Serve the repository over HTTP; no build, account, service or runtime package is required.

```sh
python -m http.server 4177
```

Open `http://localhost:4177`. English is the default; French and Spanish are available in the header. WebGL 2 is required for the custom isometric renderer. Do not open `index.html` through `file://`, because the GLB models are loaded as local HTTP resources.

## Game loop

- Inspect the announced enemy, choose three automatons, preview modules before equipping them and arrange the team on the real upcoming arena.
- Light, heavy and spider chassis trade speed, hull and carrying capacity. Only spiders cross narrow green passages.
- Ten modules combine weight, energy demand, range/area, cooldown and a real function. Exceeding either limit refuses the build with an explanation.
- Combat runs on a logical grid at ten deterministic ticks per second. Automatons follow the displayed nearest, fragile, protect or keep-distance rule.
- Battles open in suspended preparation. Inspect current intentions, exact next-tick projections, Manhattan ranges and eligible targets before choosing Begin.
- Preparing an order pauses combat and costs nothing. Preview and confirm priority target, retreat or overload explicitly; the battle remains paused afterward. Passive modules cannot be overloaded because they would gain no effect.
- Review structured events and deterministic historical snapshots during or after combat. The report shows effective damage, repairs, disabling and orders for all six robots.
- Neutralize the opposing team. At 90 seconds, remaining hull percentage breaks the tie, then damage dealt; an exact tie is a draw.
- Repair with salvaged scrap, buy research and adapt. Five encounters lead to the Grand Salvager finale. Changing the construction signature earns an experimentation bonus.

The test range unlocks every module, runs two editable configurations under identical rules and supports side-swapped replays. Four blueprint slots, campaign progress, language, speed, reduced-motion and sound preferences are stored locally when browser storage is available.

## Controls

- Mouse/touch: all assembly, inspection, replay, camera and tactical actions.
- `Space`: begin/pause/resume; `1/2/3`: select a friendly automaton, including a disabled one.
- `T`: priority target; `R`: retreat; `O`: overload; `M`: sound.
- `Escape`: cancel the current order preview, close the active panel or pause.
- Speed selector: 0.5×, 1× or 2×. The +0.1 s button applies exactly one tick while paused.
- Placement: arrow keys choose a cell; Enter previews it. Activate Place to confirm.

## Readability and art in 1.1.0

- Stable numbered allied badges and cut-corner enemy badges, hull bars, selection rings and order markers.
- Current AI intentions derived from the actual selector, exact next-tick projections on a cloned state and no attack promises from range alone.
- Module ranges, eligibility reasons, current damage/repair previews and distinct lines for intentions, confirmed orders, movement and effects.
- Unbounded structured combat history for the 90-second rules, filters and replay snapshots that do not mutate the live battle.
- A separate presentation clock freezes visual effects with the simulation. WebGL context loss pauses and recovers rendering without creating another simulation.
- Responsive combat layouts from 320×568 to 1920×1080, touch details, 1×–2× camera zoom, fullscreen preservation and reduced motion.
- All 23 GLB assets received a calmer aubergine/metal/coral palette; `tools/generate_assets.py` uses the same palette. No remote asset, font or URI `data:` resource is used.

## Verification

Node's built-in test runner needs no npm install:

```sh
npm test
npm run balance
```

The 30 tests cover equipment limits, movement, ranges, cooldowns, repairs, armor/shields, tactical orders, enriched events, exact projections, replay snapshots, victory/tiebreaks, determinism, progression and storage. A full six-fight campaign is played through the ordinary simulation.

`npm run balance` writes `evidence/balance.json` with side-swapped configuration duels and campaign matchups. `tools/browser_smoke.py` uses Python Playwright for the real local browser journey and screenshots; it expects a server on port 4177 and Playwright installed in the development environment. It covers previews, placement, confirmation, double-click protection, fullscreen, WebGL recovery, replay, victory/defeat, rewards, localization and ten viewport sizes.

`tools/record_combat.py` records an uncut combat and rendering metrics. Current evidence includes `evidence/refonte-browser.json`, `evidence/refonte-performance.json`, `evidence/layout-confirmation.json`, screenshots, `evidence/refonte-combat.webm` and the 88-criterion `evidence/validation-matrix.json`. Non-verified criteria remain explicitly marked; no external user test or physical-device/GPU matrix is claimed.

## Source layout

- `src/sim/`: grid, assembly validation, fixed-step combat, shared presentation calculations, progression and storage.
- `src/ai/`: target selection and the same action descriptions used by the inspector.
- `src/data/`: chassis, modules, arenas, opponents and research data.
- `src/render/`: WebGL renderer, GLB reader, geometry and transforms.
- `src/app.js`, `src/styles.css`, `src/i18n.js`, `src/audio.js`: interaction states, translations, responsive layout and synthesized sound.
- `assets/blender/`: editable low-poly source scenes.
- `assets/models/`: 23 GLB exports and standardized socket coordinates.
- `tools/generate_assets.py`: reproducible Blender asset generation.
- `docs/ATTACHMENTS.md`, `docs/EXTENDING.md`: extension conventions and recipes.

The renderer assembles actual chassis and module meshes. Movement, attacks, recoil, repair, disabling, victory bounces and antenna/body motion are procedural cosmetic animations; they never affect simulation outcomes. The 1.1.0 palette was applied directly to the GLB material factors and aligned in the generator; Blender was not rerun for this pass.

## Rebuild assets

Use Blender 4.5 LTS or a compatible newer version:

```sh
blender --background --python tools/generate_assets.py -- --only all
```

The original scenes were generated with Blender 4.5.3 LTS. Blender itself is not bundled and is not required to play. Generated GLB and `.blend` files are committed so the game does not require Blender to run.

## License and credits

Code, models, interface and original artwork are MIT licensed. See `LICENSE` and `CREDITS.md`. The 1.1.0 readability and artistic specification with six mockups was supplied by Cédric; implementation and verification are by Kimi. No third-party runtime library, remote asset, font download or audio file is used. LOB7 metadata is in `LOB7-GAME.json` and `LOB7-ATTRIBUTION.json`.

## Current limits

The game is solo and local-only. Ranged attacks use grid distance rather than line-of-sight raycasts. The intentionally small behaviors are deterministic and inspectable, not a general-purpose tactical AI. Procedural animation is not a skeletal animation system. This pass recolors and reframes the existing chassis rather than claiming an entirely new set of Blender models. Browser checks cover desktop and narrow viewports, not every physical device or GPU. External-user comprehension checks and some visual criteria remain non-verified in the matrix.
