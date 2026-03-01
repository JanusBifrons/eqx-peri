# /src/game — Core Game Engine & Systems

All game logic, physics, AI, and entity management. No React imports here — this layer is framework-agnostic and communicates with the UI only through data that components poll.

## Subdirectory Layout

| Directory | Contents |
|-----------|----------|
| `core/`       | `GameEngine`, `Assembly`, `Entity`, `RenderSystem` — fundamental physics objects and render loop |
| `ai/`         | `AIController`, `FlightController`, `ControllerManager`, `Controller` |
| `weapons/`    | `Missile`, `MissileSystem` |
| `ship/`       | `BlockSystem`, `ShipDesigner`, `ShipDesignManager` |
| `systems/`    | `PowerSystem`, `ToastSystem`, `SoundSystem` — singletons and support services |
| `rendering/`  | `IRenderer` interface, `Viewport`, and one renderer class per visual concern (grid, blocks, frills, shields, highlights, aiming, block-pickup) |

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
- `PowerSystem` — access via `PowerSystem.getInstance()`; never instantiate directly
- `ToastSystem` — access via the instance on `GameEngine`
- `MissileSystem` — accessed via `GameEngine.missileSystem`
- `SoundSystem` — access via `SoundSystem.getInstance()`; call `init()` after user interaction, uses Web Audio API for procedural sounds
- Do not create additional singletons without documenting them here

**Shield damage interception:**
- Damage from lasers, missiles, and collisions is routed through `Assembly.damageShield(damage, now)` before reaching entity HP.
- `damageShield` returns `true` if the shield absorbed the hit — the caller must early-return and skip `entity.takeDamage()`.
- Interception points: `GameEngine.handleBulletHit` (lasers), `GameEngine.handleEntityCollision` (collisions), `MissileSystem.handleMissileHit` (missiles).
- Rendering: `ShieldRenderer` (priority 40, in `src/game/rendering/`) handles the shield visual each frame.

**AI:**
- AI teams: `PLAYER`, `ENEMY_RED`, `ENEMY_BLUE` (defined in `GameTypes.ts`)
- Behaviours: `AGGRESSIVE`, `DEFENSIVE`, `PATROL`, `ESCORT`
- Target acquisition updates every 500 ms; engagement range is 400 units
- Flee threshold: 30% health — AI switches to `DEFENSIVE` below this
- `FlightController` makes decisions every 50 ms; use its `follow` / `orbit` modes rather than writing raw thrust logic in AI controllers

**Missiles:**
- Three types: `Torpedo`, `HeatSeeker`, `Guided` — add new types by extending `MissileType` enum and handling in `MissileSystem`
- Thrust phases: Launch (1.5×) → Search/Cruise (0.6–0.8×) → Full Throttle (2.0×); preserve this phase structure for any new missile type
- Proximity collision uses distance checks per frame — do not rely on Matter's built-in collision for missile hits

## Test Scripts

`scripts/test-*.js` and `scripts/debug-*.js` are plain Node.js scripts (no test framework). Run with `node scripts/<name>.js`. Use them to validate physics math and document tuning decisions — they are **living documentation**, not throwaway scripts.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
