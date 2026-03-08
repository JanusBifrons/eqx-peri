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
- `GameEngine.removeBodyWithParts` is **public** — required so BlockPickupSystem can remove compound bodies and all their part bodies from the physics world in one call.
- `Assembly.attachExternalAssembly(source, newLocalOffsets)` merges a source assembly's entities into the receiver at the caller-supplied grid offsets, then calls `buildConnectionGraph()` + `createFreshBody()`.  The source assembly is discarded after this call.
- `ScenarioConfig.sandboxMode: boolean` — when true, `GameEngine.initializeBattle` calls `spawnSandboxScenario` instead of the normal team-spawn path. No player ship is assigned; two Cockpit blocks scatter among the loose parts as team-0 AI ships the player can pilot.
- Snap detection uses player-local `localOffset` arithmetic, not world positions, so it is rotation-independent.
- **Physics-based drag**: blocks stay in the Matter.js world when held. A `Matter.Constraint` spring pulls the held assembly's body toward an invisible static `cursorBody` (radius 4px). Collisions on the held body are disabled (`mask: 0`) while dragged and restored on drop.
- **Pending pickup state** (`PendingPickupState`): clicking a floating block (no control center) enters this state rather than immediately dragging. The drag only starts after `DRAG_HOLD_MS` (400 ms) hold time OR `DRAG_MIN_SCREEN_PX` (6 px) screen movement, preventing accidental drag on clicks. Quick release cancels with no side effects.
- **Pre-detach state** (`PreDetachState`): clicking a player-ship block enters this state instead of immediately detaching. A tension line is drawn from block to cursor. When the cursor moves ≥ `DETACH_PULL_THRESHOLD` (80px) from the block, `triggerDetach` fires: calls `Assembly.detachEntity(entity)`, processes `pendingBodySwap` synchronously, adds the new single-entity assembly to the world, then begins a physics drag on it.
- **`Assembly.canDetachEntity(entity)`**: read-only BFS check — returns `false` if removing the entity would fragment remaining entities or if the entity is a control center. Uses `localOffset`-based grid adjacency + `canEntitiesConnect()`.
- **`Assembly.detachEntity(entity)`**: removes the entity from the assembly, calls `createFreshBody()` (sets `pendingBodySwap`), and returns a new single-entity Assembly at the block's world position. The caller must process `pendingBodySwap` synchronously.
- **Orientation locking**: while dragging, the held body's angle is set each frame to `playerAngle + pendingRotationSteps * π/2` (zeroing angular velocity), so the block visually aligns with the ship. R key cycles through 4 × 90° offsets from this default; `rotateHeld()` increments `pendingRotationSteps`. R key restarts battle when not holding.
- **`BlockFrillsRenderer`** takes a second `getHeldAssembly` getter so the dragged block's frills render even though it's removed from the main assemblies list.
- **`BlockPickupSystem` constructor**: takes 6 callbacks — `removeBodyWithParts`, `addBodyToWorld`, `onPickUp`, `onDrop`, `addConstraintToWorld`, `removeConstraintFromWorld`. `update()` now takes `(mouseWorldPos, mouseScreenPos, playerAssembly)` and must be called every frame (not just when holding). `tryPickUp()` now takes `(worldPos, screenPos, assemblies, playerAssembly)`.

**AI targeting & power (`AIController` + `Assembly`):**
- AI only targets assemblies that pass `isValidTarget()`: enemy team + not destroyed + `hasControlCenter()`. Loose scrap/debris is never engaged.
- Current target is re-validated every frame (in `setAvailableTargets`) and every 500 ms (in `validateCurrentTarget`). A ship that loses its cockpit mid-fight is immediately dropped as a target.
- **Attacker priority**: `AIController` tracks `assembly.lastHitByAssemblyId` (written by `GameEngine` on hits). The last attacker is preferred as the next target for `ATTACKER_PRIORITY_MS` (8 s); falls back to closest enemy after timeout.
- **AI weapon power**: `Assembly.computeAIWeaponPowerEfficiency()` (private) sums live power cells + cockpit backup power and divides by weapon count. For non-player assemblies, `fireWeapons()`, `getMissileLaunchRequests()`, and `getBeamFires()` all apply this efficiency to scale the fire rate (same `3 − 2×efficiency` formula as the player power system). Destroying AI power cells degrades their firing rate; zero power blocks firing entirely.

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

**Observer mode + Pilot system (`GameEngine`):**
- All ships start under AI control — no player-assigned ship at spawn (team-line and sandbox).
- `GameEngine.pilotAssembly(assembly)`: removes AI controller, sets `isPlayerControlled`, creates player controller, updates PowerSystem.
- `GameEngine.exitPilot()`: restores AI, clears `playerAssembly` and `flightController`, sets PowerSystem to null.
- `GameEngine.isObserverMode()`: `return !this.playerAssembly`
- `GameEngine.isAIEnabled(assembly)`: checks `ControllerManager.hasController(id) && !isPlayerControlled`
- `GameEngine.disableAI(assembly)` / `enableAI(assembly)`: remove / create AI controller.
- `ControllerManager.hasController(id: string): boolean` — added for AI-state queries.
- Camera: `updateCamera(deltaTime)` dispatches to `updatePilotCamera()` (follows ship + mouse offset) or `updateObserverCamera(deltaTime)` (WASD + edge-scroll pan at `OBSERVER_PAN_SPEED / zoomLevel`).
- Ship destroyed while piloting → `observerPos` set to wreck position, AI respawned on surviving cockpit fragment, `playerAssembly = null`.
- `onPlayerDestroyed` callback removed — no auto-return-to-menu on ship death.
- **UI**: `ShipActionPanel.tsx` (bottom-center) shows Pilot / Disable AI / Enable AI for team-0 selected ships. `ConfirmDialog.tsx` is a generic OK/Cancel MUI dialog. App.tsx has a ☰ Menu button (top-left) + Escape key → confirm dialog → return to menu.
- Touch controls: `setupTouchControls()` — 1-finger drag pans observer camera or updates aim cursor while piloting; 2-finger pinch zooms; tap selects assembly.

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
- **PixiJS is the rendering engine**: `pixi.js@7` (`PIXI.Application`, `PIXI.Graphics`, `PIXI.Container`, `PIXI.Text`). The PIXI canvas overlays the Matter.js canvas (`position: absolute`, `pointer-events: none`); the Matter.js canvas is `opacity: 0` (invisible but still handles mouse events and provides `render.bounds`).
- `IRenderer` interface: `renderPriority: number` + `init(stage: PIXI.Container)` + `render(viewport, timestamp)` + optional `dispose()`. **No Canvas 2D context** — all drawing uses `PIXI.Graphics` created in `init()` and cleared/redrawn each frame.
- `Viewport` class: wraps `Matter.Bounds` + PIXI canvas, provides `worldToScreen(wx, wy)` and `scale` getter.
- Renderer priorities: GridRenderer(10) → BlockBodyRenderer(20) → BlockFrillsRenderer(30) → ShieldRenderer(40) → BeamRenderer(45) → ShipHighlightRenderer(50) → AimingDebugRenderer(60) → BlockPickupRenderer(70).
- Each renderer receives data via getter functions injected in its constructor — no direct GameEngine coupling.
- `RenderSystem.setDebugPhysics(enabled, engine, container)` creates/destroys a second wireframe `Matter.Render` canvas positioned absolutely over the game canvas (pointer-events: none).
- `GameEngine.setDebugPhysics(enabled)` is the public API; `SettingsPanel.tsx` calls it via the ⚙ gear button.
- `Entity.body.render.fillStyle/strokeStyle/lineWidth` remain the data contract between Entity's visual state and `BlockBodyRenderer`. `BlockBodyRenderer` uses a `cssColor(css, fallback)` helper that handles `#rrggbb`, `rgb(r,g,b)` (from `Entity.interpolateColor()`), and `'transparent'`.
- **Text pooling**: `ShipHighlightRenderer` and `AimingDebugRenderer` reuse `PIXI.Text` objects by toggling `visible` — avoids per-frame GPU texture uploads.
- **Rotated rectangles**: `BlockPickupSystem` uses a module-level `drawRotatedRect(gfx, cx, cy, w, h, angle)` helper (manually computes rotated corners) since PIXI.Graphics has no transform stack equivalent.
- **Radial gradients**: `ShieldRenderer` approximates them with concentric `drawCircle()` calls at varying alpha.
- **Dashed lines**: approximated as solid semi-transparent lines (PIXI v7 has no native dash support).
- `pixi-filters@5` is installed but no filters are currently active.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
