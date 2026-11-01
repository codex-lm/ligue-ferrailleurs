# Standard attachment convention

All source models use metres in Blender. Blender **Z is up** and the face points toward **−Y**. The glTF exporter produces runtime coordinates with **+Y up** and **+Z forward**. One grid cell is 1.25 world units; a chassis is roughly one cell wide.

Each module GLB has its mating point at `(0, 0, 0)`. Its connector points toward +Z in its local runtime frame; geometry extends forward from that point. Do not move a module mesh to a chassis-specific offset: the offset belongs to the socket manifest.

`assets/models/attachments.json` records the four standard sockets for every chassis:

- `left` and `right`: arm hardpoints, suitable for weapons and the shield;
- `top`: sensor, ranged weapon, repair or battery hardpoint;
- `back`: support, battery, boost and armor hardpoint.

The manifest uses exported glTF coordinates, not Blender coordinates. Convert a Blender point `(x, y, z)` to `(x, z, −y)`. Socket rings are visible lime toruses with orange bolts in the chassis model, so an empty slot remains legible.

## Add a module

1. Create a collection named `module-your-id` in `assets/blender/modules.blend` or in `tools/generate_assets.py`.
2. Build around the origin and retain the standard connector. Reuse the existing material palette or add a named material.
3. Export it as `assets/models/module-your-id.glb`, with no camera, light or animation dependency.
4. Add its data to `src/data/catalog.js`: `model: "module-your-id"`, weight, energy, compatible sockets, range/area, cooldown and function. Numerical variants require no renderer change.
5. If the module needs a genuinely new action, implement it in the relevant small behavior/effect function and add rule tests. Existing model loading and attachment rendering need no new code.

The runtime groups GLB primitives by material, applies node transforms and attaches the resulting model to the selected socket. Procedural attack, recoil and repair transforms are cosmetic; the deterministic simulation never reads them.
