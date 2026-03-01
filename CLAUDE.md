# EQX Peri

A 2D space combat game built with React, TypeScript, and Matter.js physics. Ships are assembled from modular block components; players and AI fight in zero-gravity environments with missiles, guns, and power management.

## Commands

```bash
npm run dev        # Start Vite dev server (http://localhost:5173)
npm run build      # Type-check + production build
npm run lint       # ESLint (zero warnings enforced)
npm run preview    # Preview production build
node scripts/<name>.js  # Run individual physics/logic test scripts
```

## Project Structure

```
scripts/        # Node.js test/debug scripts (node scripts/<name>.js)
src/
  ui/           # React UI overlay (HUD, radar, power management, SettingsPanel)
  game/
    core/       # Fundamental physics objects: GameEngine, Assembly, Entity, RenderSystem
    ai/         # Control & decision-making: AIController, FlightController, ControllerManager, Controller
    weapons/    # Missile, MissileSystem, BeamSystem
    ship/       # Ship design: BlockSystem, ShipDesigner, ShipDesignManager
    systems/    # Singletons & services: PowerSystem, ToastSystem, BlockPickupSystem
    rendering/  # IRenderer, Viewport, and individual renderer classes
  types/        # Shared TypeScript interfaces and enums (GameTypes.ts)
  data/         # Ship definitions (ships.json)
```

## Universal Coding Standards

**Naming:**
- Classes and interfaces: `PascalCase`
- Functions and variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Files: `PascalCase.ts` for classes, `camelCase.ts` for utilities, `PascalCase.tsx` for components

**TypeScript:**
- Strict mode is enforced — no `any`, no unused locals/parameters
- Define interfaces for all prop types and config objects
- Use `resolveJsonModule` for JSON imports (already configured)

**Git Commits:**
- Format: `<type>: <short imperative description>` (e.g. `fix: correct missile thrust scaling`)
- Types: `feat`, `fix`, `refactor`, `chore`, `docs`
- Keep subject line under 72 characters; no period at end

**General:**
- One class per `.ts` file
- No magic numbers — extract to named constants
- Prefer explicit return types on exported functions

**Ship coordinates (`ships.json`):**
- Ships face **east (right)** by default. X = forward (nose → tail); Y = lateral (wingspan).
- "Width" of a ship = its Y extent in grid units, not its part count.
- `applyThrust` takes **ship-local** input. World-space vectors must be rotated by `−shipAngle` first.

**Block pickup / assembly building (`BlockPickupSystem`):**
- Lives in `src/game/systems/BlockPickupSystem.ts`; instantiated by `GameEngine` (not a singleton).
- `GameEngine.removeBodyWithParts` is **public** — required so BlockPickupSystem can remove a picked-up assembly's compound body and all its part bodies from the physics world in one call.
- `Assembly.attachExternalAssembly(source, newLocalOffsets)` merges a source assembly's entities into the receiver at the caller-supplied grid offsets, then calls `buildConnectionGraph()` + `createFreshBody()`.  The source assembly is discarded after this call.
- `ScenarioConfig.sandboxMode: boolean` — when true, `GameEngine.initializeBattle` calls `spawnSandboxScenario` instead of the normal team-spawn path (player gets a bare Cockpit; loose blocks are scattered nearby).
- Snap detection uses player-local `localOffset` arithmetic, not world positions, so it is rotation-independent.

**Shield system (`Assembly.shieldState`):**
- `Shield` and `LargeShield` are physical block types (in `ENTITY_DEFINITIONS`) that grant an assembly a damage-absorbing shield field.
- Shield state is tracked in `Assembly.shieldState: ShieldState | null` (initialized/refreshed by `initializeShieldState()`).
- Damage interception is **game-logic only** — no Matter.js physics filter changes. `Assembly.damageShield(damage, now)` returns `true` if the shield absorbed the hit; callers must early-return and skip entity damage when it returns `true`.
- Shield wear mechanic: each hit reduces both `currentHp` **and** `maxHp` (max HP degrades permanently per hit, within a session).
- Regen: after `SHIELD_REGEN_DELAY_MS` with no hits, shield regenerates to current `maxHp` over `SHIELD_REGEN_DURATION_MS`.
- Collapse: when `currentHp` reaches 0, `isActive = false` and `cooldownUntil = now + SHIELD_COLLAPSE_COOLDOWN_MS` (8 s).
- All three constants (`SHIELD_REGEN_DELAY_MS`, `SHIELD_REGEN_DURATION_MS`, `SHIELD_COLLAPSE_COOLDOWN_MS`) live in `GameTypes.ts`.
- Interception is wired in three places: `GameEngine.handleBulletHit` (lasers), `GameEngine.handleEntityCollision` (collisions), `MissileSystem.handleMissileHit` (missiles).
- Rendering: `ShieldRenderer` (priority 40) in `src/game/rendering/` draws translucent blue gradient circles each frame via `RenderSystem`.

**Beam weapon system (`BeamSystem` + `BeamRenderer`):**
- `Beam` (1×1) and `LargeBeam` (2×2) are block types that fire instant-hit continuous beams — no physics body is spawned.
- Beam constants (`BEAM_SMALL_RANGE`, `BEAM_SMALL_DPS`, `BEAM_LARGE_RANGE`, `BEAM_LARGE_DPS`, `BEAM_DISPLAY_DURATION_MS`) live in `GameTypes.ts`. `beamRange` and `beamDps` optional fields added to `EntityTypeDefinition`.
- `Entity.isBeamWeapon()` returns `true` for Beam/LargeBeam. `Assembly.fireWeapons()` excludes beam weapons (they are not projectiles); `Assembly.getBeamFires()` returns `BeamFireSpec[]` each tick while the trigger is held.
- `ControllerManager.applyInput()` calls `assembly.getBeamFires()` and routes each spec to `BeamSystem.processBeamFire(spec, assemblies, deltaTime)`, which performs ray-convex-polygon intersection against all entity bodies, applies `DPS × deltaTime` damage, handles shield interception, and invokes an `onEntityDestroyed` callback when an entity is killed.
- Entity destruction is routed through `GameEngine.processEntityDestruction()` — the shared cascade method now used by both `handleBulletHit` and `handleBeamEntityDestroyed`.
- `BeamRenderer` (priority 45, between ShieldRenderer and ShipHighlightRenderer) draws active beams as a two-layer glow (outer halo + bright core) with an impact flash at the hit point. Beams fade over `BEAM_DISPLAY_DURATION_MS` (80 ms) after the last firing tick.
- Active beams are stored in a `Map<weaponId, ActiveBeam>` in `BeamSystem`, overwritten each tick the weapon fires (so each weapon has at most one beam record at a time).

**Rendering system (`RenderSystem` + `src/game/rendering/`):**
- `Matter.Render.run()` is **not called** — Matter.js is physics-only; `RenderSystem` owns the `requestAnimationFrame` loop.
- `Matter.Render.lookAt()` is still used for camera/viewport management; `RenderSystem` reads `this.render.bounds` each frame.
- `IRenderer` interface: `renderPriority: number` + `render(ctx, viewport, timestamp)` + optional `dispose()`.
- `Viewport` class: wraps `Matter.Bounds` + canvas, provides `worldToScreen(wx, wy)` and `scale` getter.
- Renderer priorities: GridRenderer(10) → BlockBodyRenderer(20) → BlockFrillsRenderer(30) → ShieldRenderer(40) → BeamRenderer(45) → ShipHighlightRenderer(50) → AimingDebugRenderer(60) → BlockPickupRenderer(70).
- Each renderer receives data via getter functions injected in its constructor — no direct GameEngine coupling.
- `RenderSystem.setDebugPhysics(enabled, engine, container)` creates/destroys a second wireframe `Matter.Render` canvas positioned absolutely over the game canvas (pointer-events: none).
- `GameEngine.setDebugPhysics(enabled)` is the public API; `SettingsPanel.tsx` calls it via the ⚙ gear button.
- `Entity.body.render.fillStyle/strokeStyle/lineWidth` remain the data contract between Entity's visual state and `BlockBodyRenderer`.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
