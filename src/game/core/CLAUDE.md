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

## Shield System

`Assembly` manages an optional `shieldState: ShieldState | null` property for assemblies that contain `Shield` or `LargeShield` blocks.

- **`initializeShieldState()`**: scans `this.entities` for shield blocks; sums their `shieldHp` values for `maxHp`. Preserves existing wear/cooldown state when called from `createFreshBody()` (after block destruction).
- **`updateShield(deltaTimeMs)`**: called every frame from `Assembly.update()`. Handles regen timing and reactivation after cooldown.
- **`damageShield(damage, now)`**: returns `true` if shield absorbed the hit (callers must skip entity damage). Reduces both `currentHp` and `maxHp` (wear). Triggers collapse (`isActive=false`, `cooldownUntil`) when HP hits 0.
- **`hasActiveShield()`** / **`getShieldRadius()`**: utility accessors for rendering and interception checks.
- Shield state is refreshed (via `initializeShieldState()`) at the end of `createFreshBody()` to account for destroyed shield blocks reducing max capacity.
- Physics optimization (inner parts opt-out of collision) was evaluated and **not implemented** — Matter.js cannot change compound-body part collision filters without a full rebuild, and adding a separate shield body with constraint has force-transfer accuracy issues. The shield is purely game-logic interception.

## Rendering Architecture

`RenderSystem` owns the `requestAnimationFrame` loop and all visual output. Matter.js physics continues to run via its runner, but `Matter.Render.run()` is **not** called — `RenderSystem` replaces it entirely.

**Key rules:**
- `GameEngine` creates `RenderSystem` in `setupRenderSystem()` and registers seven `IRenderer` instances (one per visual concern, sorted by `renderPriority`).
- Each renderer receives only what it needs via getter closures injected at construction — no renderer holds a reference to `GameEngine`.
- `Entity.body.render.fillStyle/strokeStyle/lineWidth` are the visual data contract: `Entity.updateFlash()` and `Entity.updateVisualState()` write these; `BlockBodyRenderer` reads them. Do not bypass this contract.
- Camera management stays in `GameEngine.updateCamera()` via `Matter.Render.lookAt(this.render, ...)`. `RenderSystem` reads `this.render.bounds` each frame via a `getBounds` getter — zero camera logic lives in the render system.
- Physics debug wireframe overlay: `GameEngine.setDebugPhysics(enabled)` delegates to `RenderSystem.setDebugPhysics()`, which creates/destroys a second `Matter.Render` instance (`wireframes: true`, `background: 'transparent'`) positioned absolutely over the game canvas. Its bounds are synced to the main viewport each frame via `Matter.Render.lookAt()`.
- `executePlayerCommands()` runs in the **game loop** (not in any render event) — it is game logic, not rendering.

**Renderer priorities:**

| Priority | Renderer | Visual concern |
|----------|----------|----------------|
| 10 | `GridRenderer` | Background grid lines |
| 20 | `BlockBodyRenderer` | Ship/block bodies (fills + strokes using vertex data) |
| 30 | `BlockFrillsRenderer` | Decorative frills on block edges |
| 40 | `ShieldRenderer` | Shield gradient + collapse ring |
| 45 | `BeamRenderer` | Continuous beam weapon visuals (glow + core line + impact flash) |
| 50 | `ShipHighlightRenderer` | Hover/selected bounding boxes, locked-target brackets |
| 60 | `AimingDebugRenderer` | Weapon arc, distance rings, aim line |
| 70 | `BlockPickupRenderer` | Block pickup ghost/snap overlay |

## Projectile Collision Detection (Tunneling Prevention)

Fast-moving projectiles (lasers, missiles) can "tunnel" through targets if they move farther than the target's width in a single physics tick. Two mechanisms prevent this:

1. **Matter.js CCD**: All projectile bodies are created with `bullet: true` in options, enabling Matter.js continuous collision detection.
2. **Projectile Length**: Lasers are sized to be at least 1.5× their per-tick travel distance (accounting for ship velocity inheritance), ensuring they overlap any target they pass through.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
