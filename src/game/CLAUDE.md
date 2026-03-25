# /src/game — Core Game Engine & Systems

All game logic, physics, AI, and entity management. No React imports here — this layer is framework-agnostic and communicates with the UI only through data that components poll.

## Subdirectory Layout

| Directory | Contents |
|-----------|----------|
| `core/`       | `GameEngine`, `Assembly`, `Entity`, `RenderSystem` — fundamental physics objects and render loop |
| `ai/`         | `AIController`, `FlightController`, `ControllerManager`, `Controller` |
| `weapons/`    | `Missile`, `MissileSystem`, `BeamSystem`, `HarpoonSystem` |
| `ship/`       | `BlockSystem`, `ShipDesigner`, `ShipDesignManager` |
| `systems/`    | `ToastSystem`, `SoundSystem`, `BlockPickupSystem`, `AsteroidFieldSystem` — singletons and support services |
| `rendering/`  | `IRenderer` interface, `Viewport`, and one renderer class per visual concern (grid, blocks, frills, shields, highlights, aiming, block-pickup, structures) |
| `structures/` | `Structure`, `StructureCore`, `StructureManager` — static base-building structures (Phase 0+) |

## Physics Conventions (Matter.js)

- World is **zero-gravity, zero-friction**: `gravity = {x:0, y:0}`, `frictionAir = 0`, `friction = 0`
- Apply forces with `Matter.Body.applyForce()` — never set `body.velocity` directly mid-simulation
- Angular damping for debris: multiply `body.angularVelocity` by `0.98` per frame (not Matter's built-in friction)
- All force values are in the **50x-scaled** unit system — document the raw value and the scaled value in comments when tuning
- Collision handling goes in `GameEngine.ts` via Matter's `Events.on(engine, 'collisionStart', ...)` callbacks

## Class & System Patterns

**Entity / Assembly:**
- `Entity` = one physical block (cockpit, gun, hull, etc.); one Matter body per entity
- `Assembly` = compound ship made of connected entities; manages the connection graph
- Destruction cascades: when an entity is destroyed, call `Assembly.removeEntity()` — do not manipulate bodies directly

**Singletons:**
- `ToastSystem` — access via the instance on `GameEngine`
- `MissileSystem` — accessed via `GameEngine.missileSystem`
- `HarpoonSystem` — accessed via `GameEngine.harpoonSystem`
- `SoundSystem` — access via `SoundSystem.getInstance()`; call `init()` after user interaction, uses Web Audio API for procedural sounds
- Do not create additional singletons without documenting them here

**Asteroid field (`AsteroidFieldSystem`):**
- Lives in `src/game/systems/AsteroidFieldSystem.ts`; NOT a singleton — instantiated by `GameEngine` when `ScenarioConfig.spawnAsteroids` is true.
- Chunk-based streaming: world is divided into `CHUNK_SIZE=2000` unit cells. Chunks within `LOAD_RADIUS=10000` of the camera centre are loaded; chunks beyond `UNLOAD_RADIUS=14000` are unloaded (hysteresis prevents thrashing).
- Asteroid bodies are `isStatic: true` plain `Matter.Body` objects — **not entities or assemblies**. Rendered automatically by `BlockBodyRenderer`'s non-entity world-body loop via `body.render.fillStyle/strokeStyle/lineWidth`.
- Matter.js skips static-static collision natively, so overlapping asteroids cost nothing in physics and create interesting visual terrain features.
- Each chunk's asteroid count and positions are derived from a deterministic seeded PRNG (`mulberry32` seeded from chunk coords), so chunks regenerate identically on re-entry.
- `body.label = 'asteroid'` tags asteroid bodies for identification.
- Constructor: `(addBodyToWorld, removeBodyFromWorld)` callbacks; `update(cameraCenter, viewportHalfDiag)` called every game loop frame; `dispose()` on scene teardown.

**Shield damage interception:**
- Damage from lasers, missiles, and collisions is routed through `Assembly.damageShield(damage, now)` before reaching entity HP.
- `damageShield` returns `true` if the shield absorbed the hit — the caller must early-return and skip `entity.takeDamage()`.
- Interception points: `GameEngine.handleLaserHit` (lasers), `GameEngine.handleEntityCollision` (collisions), `MissileSystem.handleMissileHit` (missiles), `BeamSystem.processBeamFire` (beams).
- Rendering: `ShieldRenderer` (priority 40, in `src/game/rendering/`) handles the shield visual each frame.

**Beam weapons (`BeamSystem`):**
- `Beam` and `LargeBeam` blocks fire instant-hit continuous raycast beams — no physics body is spawned.
- `Assembly.getBeamFires()` returns `BeamFireSpec[]` each tick the trigger is held; `ControllerManager.applyInput()` routes these to `BeamSystem.processBeamFire(spec, assemblies, deltaTime)`.
- `BeamSystem.processBeamFire` uses `Matter.Query.ray()` (native SAT detection) against a candidate list of entity block bodies **and** shield circle parts (`isShieldPart = true`). It finds the closest hit by projecting SAT support points onto the ray direction, applies `DPS × deltaTime` damage, handles shield interception, and invokes an `onEntityDestroyed` callback for destruction cascade. No bespoke polygon geometry code.
- Entity destruction from beams routes through `GameEngine.processEntityDestruction()` — the same cascade helper used by laser hits.
- `BeamRenderer` (priority 45) renders active beams as glowing canvas lines; each beam record is keyed by weapon entity ID and fades after `BEAM_DISPLAY_DURATION_MS`.

**AI:**
- AI teams: `PLAYER`, `ENEMY_RED`, `ENEMY_BLUE` (defined in `GameTypes.ts`)
- Behaviours: `AGGRESSIVE`, `DEFENSIVE`, `PATROL`, `ESCORT`
- Target acquisition updates every 500 ms; engagement range is 400 units
- Flee threshold: 30% health — AI switches to `DEFENSIVE` below this
- `FlightController` makes decisions every 50 ms; use its `follow` / `orbit` modes rather than writing raw thrust logic in AI controllers

**Missiles:**
- Three variants: `tracking` (MissileLauncher), `standard` (LargeMissileLauncher), `torpedo` (CapitalMissileLauncher) — configured via `MISSILE_CONFIGS` in `GameTypes.ts`
- Phase-based flight: launch (0–0.5 s, no steering) → boost (0.5–2.5 s, accelerating) → cruise (2.5 s+, max speed)
- Velocity-vector steering with proportional navigation for tracking missiles
- Matter.js CCD (`bullet: true`) + `collisionStart` events for hit detection
- PDC interception: missile bodies included in laser raycast candidates; `handleLaserHitMissile()` destroys both

**Harpoons:**
- `HarpoonSystem` fires a projectile; on hit creates a `Matter.Constraint` tether between source and target assemblies
- Tethers break if either assembly is destroyed or separation exceeds `TETHER_BREAK_LENGTH` (800 units)
- Rendered by `HarpoonRenderer` (priority 44, world-space)

**Tractor Beam:**
- Extension of `BeamSystem` — `processTractorBeamFire()` applies attractive force within a cone instead of damage
- Targets can escape with sufficient engine thrust

**PDC (Point Defence Cannon):**
- Autonomous anti-missile weapon; fires via `Assembly.getPDCFires()` without fire input
- Creates laser bodies that travel through the existing raycast system

## Test Scripts

`scripts/test-*.js` and `scripts/debug-*.js` are plain Node.js scripts (no test framework). Run with `node scripts/<name>.js`. Use them to validate physics math and document tuning decisions — they are **living documentation**, not throwaway scripts.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
