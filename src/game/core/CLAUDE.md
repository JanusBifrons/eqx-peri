# /src/game/core — Fundamental Physics Objects

`GameEngine`, `Assembly`, and `Entity` — the bottom of the dependency graph. Nothing in `core/` imports from `ai/`, `weapons/`, `ship/`, or `systems/` except `GameEngine` (which wires everything together).

## Rules

- `Entity` = one physical block; one `Matter.Body` per entity. Never create entities outside `Assembly`.
- `Assembly` = compound ship; owns the connection graph and all its entities' bodies.
- Destruction cascades through `Assembly.removeEntity()` — never manipulate bodies directly from outside.
- `GameEngine` is the only place Matter.js `Events` listeners are registered.
- Import paths from files in this directory: `../../types/GameTypes`, `../../data/ships.json`

## Ship Coordinate System

Ships face **east (right)** by default. In `ships.json` part coordinates:
- **X axis = forward/backward** along the ship's nose-to-tail direction. Negative X = rear (engine side); positive X = nose (gun side).
- **Y axis = lateral / wingspan**. Negative Y = top wing; positive Y = bottom wing.

So a "7-long × 3-wide" ship spans `x: -48..+48` (7 grid units along the spine) and `y: -16..+16` (3 grid units of wingspan). The **part count** is not the ship's width — count grid extents in each axis instead.

`applyThrust` takes **ship-local** coordinates: `{x:1,y:0}` means "thrust forward along the ship's nose direction" regardless of world angle. Any code computing thrust in world space must rotate by `-shipAngle` before passing it to `applyThrust`.

## Compound Body Lifecycle

Matter.js compound bodies are created via `Matter.Body.create({ parts: [...] })`. When added to the world with `Matter.World.add`, **each part body is also added individually** to `world.bodies` (not just the compound root). This means:

- **Always use `GameEngine.removeBodyWithParts(body)`** to remove a compound — never `Matter.World.remove(world, body)` alone. Removing only the root leaves orphaned part bodies in `world.bodies` that continue to collide with stale entity references and render as ghost geometry.
- After any block destruction, `Assembly.createFreshBody()` creates a new compound and stores the old compound reference in `assembly.pendingBodySwap`. `GameEngine` detects this flag each frame and performs the world swap (`removeBodyWithParts(old)` + `World.add(new)`).

## Connection Graph Rules

- `buildConnectionGraph()` and `findConnectedComponents()` determine whether a ship splits when a block is destroyed.
- **Always use `entity.localOffset`** (ship-local pixel coordinates, always multiples of `GRID_SIZE`) for grid-position lookup — never `entity.body.position` (world coordinates that are no longer grid-aligned after rotation). Using world positions causes every block destruction on a rotated ship to appear as a full fragmentation.
- `entity.localOffset` is set once at Entity construction from `config.x/y` and never changes. Fragment assemblies (`createNewAssemblyFromComponent`) also compute configs from `localOffset` relative to the fragment center to preserve grid alignment.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
