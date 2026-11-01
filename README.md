# Scrap League — La Ligue des Ferrailleurs

A complete, local-first strategy game about assembling three expressive mechanical toys and watching construction choices come alive in deterministic arena fights. Designed and developed with Kimi for Kimi Games.

## Play

Serve the repository over HTTP; no build, account, service or runtime package is required.

```sh
python -m http.server 4177
```

Open `http://localhost:4177`. English is the default; French and Spanish are available in the header. WebGL 2 is required for the custom isometric renderer. Do not open `index.html` through `file://`, because the GLB models are loaded as local HTTP resources.

## Game loop

- Inspect the announced enemy, choose three automatons, equip four visible sockets per machine and arrange their starting cells.
- Light, heavy and spider chassis trade speed, hull and carrying capacity. Only spiders cross narrow green passages.
- Ten modules combine weight, energy demand, range/area, cooldown and a real function. Exceeding either limit refuses the build with an explanation.
- Combat runs on a logical grid at ten deterministic ticks per second. Automatons follow the displayed nearest, fragile, protect or keep-distance rule.
- Pause to inspect hull and module cooldowns. Spend three shared charges on priority target, retreat or a five-second module overload.
- Neutralize the opposing team. At 90 seconds, remaining hull percentage breaks the tie, then damage dealt; an exact tie is a draw.
- Repair with salvaged scrap, buy research and adapt. Five encounters lead to the Grand Salvager finale. Changing the construction signature earns an experimentation bonus.

The test range unlocks every module, runs two editable configurations under identical rules and supports side-swapped replays. Four blueprint slots, campaign progress, language and sound preferences are stored locally when browser storage is available.

## Controls

- Mouse/touch: all assembly, inspection and tactical actions.
- `Space`: pause/resume; `1/2/3`: select a friendly automaton.
- `T`: priority target; `R`: retreat; `O`: overload; `M`: sound.
- `Escape`: close help or pause/resume.

## Verification

Node's built-in test runner needs no npm install:

```sh
npm test
npm run balance
```

The tests cover equipment limits, enemy construction, movement and narrow passages, ranges, cooldowns, repairs, dash, armor/shields, tactical charges, victory/tiebreaks, determinism, progression and storage. A full six-fight campaign is played through the ordinary simulation, including repairs, five research choices and three tactical orders in the finale.

`npm run balance` writes `evidence/balance.json` with side-swapped configuration duels and all campaign matchups. `tools/browser_smoke.py` uses Python Playwright for the real local browser journey and screenshots; it expects a server on port 4177 and Playwright installed in the development environment. These development tools are not needed by the published game.

## Source layout

- `src/sim/`: grid, assembly validation, fixed-step combat, progression and storage.
- `src/ai/`: target selection and visible automaton behaviors.
- `src/data/`: chassis, modules, arenas, opponents and research data.
- `src/render/`: WebGL renderer, GLB reader, geometry and transforms.
- `src/app.js`, `src/styles.css`, `src/i18n.js`, `src/audio.js`: interface, translations and synthesized sound.
- `assets/blender/`: editable low-poly source scenes.
- `assets/models/`: 23 GLB exports and standardized socket coordinates.
- `tools/generate_assets.py`: reproducible Blender asset generation.
- `docs/ATTACHMENTS.md`, `docs/EXTENDING.md`: extension conventions and recipes.

The renderer assembles actual chassis and module meshes. Movement, attacks, recoil, repair, disabling, victory bounces and antenna/body motion are procedural cosmetic animations; they never affect simulation outcomes.

## Rebuild assets

Use Blender 4.5 LTS or a compatible newer version:

```sh
blender --background --python tools/generate_assets.py -- --only all
```

The workshop's verified generation used Blender 4.5.3 LTS. Blender itself is not bundled. Generated GLB and `.blend` files are committed so the game does not require Blender to run.

## License and credits

Code, models, interface and original artwork are MIT licensed. See `LICENSE` and `CREDITS.md`. No third-party runtime library, remote asset, font download or audio file is used. LOB7 metadata is in `LOB7-GAME.json` and `LOB7-ATTRIBUTION.json`.

## Current limits

The game is solo and local-only. Ranged attacks use grid distance rather than line-of-sight raycasts. The intentionally small behaviors are deterministic and inspectable, not a general-purpose tactical AI. Procedural animation is not a skeletal animation system. Browser checks cover desktop and a narrow mobile viewport, not every physical device or GPU.
