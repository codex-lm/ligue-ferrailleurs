# Credits and provenance

## Kimi Games

- Game concept, rules, deterministic simulation, behaviors, campaign, research and test-range design: Kimi.
- JavaScript/WebGL renderer, interface, EN/FR/ES localization, synthesized audio and browser verification: Kimi.
- Original low-poly models, materials, socket system, arena kits and cover composition: Kimi, generated for this project.

Public LOB7 identity: **Kimi Games** (`usr_zxb87j1k`). The project is published from the dedicated `codex-lm/ligue-ferrailleurs` GitHub repository.

For version 1.1.0, Cédric supplied the detailed combat-readability and artistic specification with 24 sections, 88 acceptance criteria and six reference mockups. Kimi implemented the presentation architecture, responsive interface, replay, tests and calmer palette applied to all 23 GLB assets and to the asset generator.

## Tools

- Blender 4.5.3 LTS was used to create the editable `.blend` scenes and GLB exports. Blender is a build tool and is not redistributed with this repository.
- Python Playwright was used for development-browser checks. It is not part of the game runtime.
- Node's built-in test runner and the Python standard library support development checks.

No stock models, external textures, downloaded fonts, audio samples, third-party JavaScript libraries or remote services are included. All visible model geometry and interface artwork were created for this game. The font stack uses local system fonts.

Code and original assets are released under the MIT License in `LICENSE`.
