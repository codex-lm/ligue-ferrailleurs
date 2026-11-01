# Scrap League — La Ligue des Ferrailleurs

A local-first strategy game about assembling three expressive mechanical toys and watching construction choices come alive in deterministic arena fights. Designed and developed with Kimi for Kimi Games.

## Play

This `main` branch is the self-contained static LOB7 export. Serve it over HTTP; no build, account, service or runtime package is required.

```sh
python -m http.server 4177
```

Open `http://localhost:4177`. English is the default; French and Spanish are included. WebGL 2 is required. Do not use `file://`, because the local GLB models are loaded over HTTP.

## Rules and controls

- Inspect the announced enemy, choose three automatons, equip four visible sockets per machine and arrange starting cells.
- Three chassis and ten modules trade hull, speed, weight, energy, range/area and cooldown. Only spiders cross narrow green passages. Invalid weight or energy refuses combat with an explanation.
- Combat runs at ten deterministic ticks per second. Each automaton follows its visible nearest, fragile, protect or keep-distance rule.
- Pause to inspect. Spend three shared tactical charges on priority target, retreat or overload.
- Neutralize the enemy. At 90 seconds, hull percentage then damage dealt breaks the tie; exact ties draw.
- Repair, salvage and research through five encounters and a finale. Changing the construction signature earns an experimentation bonus.
- The test range compares two editable teams with side-swapped replays. Four blueprint slots and campaign/preferences are stored locally when available.

Mouse/touch controls everything. `Space` pauses, `1/2/3` selects, `T` targets, `R` retreats, `O` overloads, `M` toggles sound and `Escape` closes help or pauses.

## Sources and verification

The [`development` branch](https://github.com/codex-lm/ligue-ferrailleurs/tree/development) contains the four editable Blender scenes, asset-generation script, automated tests, balance/browser evidence, mission tracking and complete documentation. Development commit: [`7c16af49836919c4b5db42ea13cedde46d615506`](https://github.com/codex-lm/ligue-ferrailleurs/commit/7c16af49836919c4b5db42ea13cedde46d615506).

On that branch, `npm test` runs the rules and the full six-fight campaign; `npm run balance` compares configurations in both directions. `tools/browser_smoke.py` verifies the real local browser journey. These development tools are intentionally excluded from this static export.

The runtime separates `src/sim/`, `src/ai/`, `src/data/` and `src/render/`. Actual GLB chassis and module meshes are assembled at the standardized sockets documented in `docs/ATTACHMENTS.md`. Extension recipes are in `docs/EXTENDING.md`.

## License and limits

Code, original models, interface and artwork are MIT licensed; see `LICENSE` and `CREDITS.md`. No third-party runtime library, remote asset, downloaded font or audio sample is used.

The game is solo and local-only. Ranged attacks use grid distance, not line-of-sight raycasts. Behaviors are deliberately small and deterministic. Animations are procedural rather than skeletal. Desktop and narrow mobile viewports are checked, not every physical device/GPU.
