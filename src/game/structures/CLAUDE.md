# /src/game/structures — Base-Building Structure System

Static structures for base-building, defense, resource production, and trading. Structures are orders of magnitude more powerful and resilient than mobile Assemblies.

## Class Hierarchy

| Class | Purpose |
|-------|---------|
| `Structure` | Base class — wraps a static Matter.js body with HP, team, power, and storage |
| `StructureCore` | The foundational structure; provides baseline power + storage |
| `StructureTurret` | Turret subclass — autonomous targeting, aiming, and laser firing |
| `StructureAssemblyYard` | Assembly Yard subclass — builds AI ships over time from stored resources |
| `StructureManufacturer` | Manufacturer subclass — assembles ship parts from refined materials per recipe |
| `StructureRecycler` | Recycler subclass — breaks down scrap into recovered materials at 60% yield |
| `ShieldWall` | Physical barrier body between two connected ShieldFence posts |
| `StructureManager` | Lifecycle manager — spawn, update, dispose; delegates networking to `GridManager` |
| `Connection` | Data-only link between two structures (throughput, flash state) |
| `GridManager` | Network graph, connected components (BFS), A* routing, power aggregation, pulse transfer, shield wall management |

## Composite Structure Parts

Structures can define an optional `parts: StructurePartDefinition[]` on their `StructureDefinition` to render as composite multi-part objects instead of a single shape.

- **`StructurePartDefinition`** and **`StructurePartDetail`** interfaces are in `GameTypes.ts`.
- Each part has `shape`, `widthPx/heightPx`, `offsetX/offsetY` (from structure center), `color/borderColor`, and `zOrder` (lower = drawn first).
- `rotation: 'fixed'` = static (uses `fixedAngle` if set); `rotation: 'aim'` = rotates with `structure.currentAimAngle` (single turret) or `structure.turretAngles[turretIndex]` (multi-turret).
- `fixedAngle?: number` — for 'fixed' parts that need a static rotation (e.g. diagonal arms).
- `turretIndex?: number` — for 'aim' parts with multiple independent turrets; indexes into `Structure.turretAngles[]`.
- `details` array adds decorative sub-elements (lines, circles, rects) in part-local coordinates.
- **Physics**: the primary collision body still comes from the definition's `widthPx/heightPx/shape`. Parts are visual-only (no separate collision bodies).
- **`Structure.currentAimAngle`** lives on the base class (inherited by `StructureTurret`). `Structure.turretAngles: number[]` supports multi-turret structures (inherited by `StructureMiningPlatform`).
- **Rendering**: `StructureRenderer.drawCompositeParts()` handles all part drawing. When `definition.parts` exists, the default single-shape fill, icon drawing, and CRT readout panel are all skipped.
- **First use case**: `MiningPlatform` — X-shaped base with 4 diagonal arms + center hub (fixed parts) and 4 independent rotating turrets at the arm tips (aim parts with `turretIndex` 0–3).

## Line-of-Sight (LOS) Checks

- **`checkLineOfSight(from, to, obstacles, excludeIds)`** in `src/game/weapons/WeaponUtils.ts` — shared utility using `Matter.Query.ray()`.
- Both `StructureTurret` and `StructureMiningPlatform` use LOS checks before firing. Obstacle bodies = asteroids + all structure bodies (excluding self).
- `StructureManager.update()` builds the obstacle body list once per frame and passes it to all turrets and mining platforms.

## Physics Conventions

- All structure bodies are **`isStatic: true`** — they do not move.
- Bodies use `body.structure = this` back-reference (same pattern as `body.entity` / `body.assembly`).
- Body label format: `structure-{type}` (e.g., `structure-Core`).
- Hex bodies: `Matter.Bodies.polygon(x, y, 6, radius)` for `shape: 'hex'` (Connector).
- Shield wall bodies: `body.shieldWall = this` back-reference; label `'shield-wall'`. Static rectangle spanning between two ShieldFence posts.
- Visual styling is set via `body.render.fillStyle/strokeStyle/lineWidth` and also read by `StructureRenderer`.

## Structure Definitions

Defined in `GameTypes.ts` as `STRUCTURE_DEFINITIONS: Record<StructureType, StructureDefinition>`. To add a new structure type:

1. Add the type name to the `StructureType` union in `GameTypes.ts`.
2. Add its definition to `STRUCTURE_DEFINITIONS`.
3. If it needs special behavior, create a subclass extending `Structure`.
4. Add a spawn method to `StructureManager`.

## StructureTurret (Defense)

- Extends `Structure` with targeting, aiming, and laser creation.
- `SmallTurret`, `MediumTurret`, and `LargeTurret` types use this subclass (routed by `StructureManager.spawnStructure()`).
- `StructureDefinition` turret fields: `weaponRange`, `fireRateMs`, `laserDamage`, `laserSpeed`, `laserColor`, `laserHeight`, `aimRotationSpeed`.
- `updateTurret(deltaTimeMs, now, assemblies, gridSummary)` — called each frame by StructureManager; returns `Matter.Body[]` of lasers created.
- **Targeting**: finds closest enemy assembly with control center within `weaponRange`; re-scans every 500ms.
- **Aiming**: smoothly rotates `currentAimAngle` toward target at `aimRotationSpeed` rad/s; fires when within 0.15 rad.
- **Power gating**: will not fire if `gridSummary.netPower < 0` — destroying power structures cripples turrets.
- **Laser creation**: same pattern as `Assembly.createLaser()` — `isSensor`, `bullet: true`, inherits no velocity (static turret). Tags: `sourceStructureId`, `sourceTeam` for friendly-fire prevention.
- **Friendly fire prevention**: `setupLaserRaycast` skips same-team assemblies, structures, and shields for turret lasers (checks `sourceStructureId` + `sourceTeam`).
- `getBarrelEndpoint()` — returns world-space barrel tip position for rendering.

## StructureManager

- Constructor takes `(addBodyToWorld, removeBodyFromWorld)` callbacks (same pattern as `AsteroidFieldSystem`).
- `gridManager` is a **public** field — accessed by `GameEngine`, renderers, and `StructurePlacementSystem`.
- `update(deltaTimeMs, assemblies)` — removes destroyed structures, severs their connections, calls `gridManager.update()`, ticks turrets. Returns `Matter.Body[]` of turret lasers.
- `spawnStructure()` routes turrets to `StructureTurret`, `Core` to `StructureCore`, `AssemblyYard` to `StructureAssemblyYard`, others to base `Structure`.
- `setShipSpawnCallback(callback)` — sets the callback for when an Assembly Yard completes a build. Called by `GameEngine` to wire up ship spawning.
- `getStructures()` — returns all structures (for rendering).
- `getTeamCore(team)` / `getTeamGridSummary(team)` — convenience accessors for UI (delegates to `GridManager`).
- `dispose()` — tears down all structures on scene change.

## Construction System

- `StructureDefinition.constructionCost` — total resource units to fully build. Core has cost 0 (pre-built bootstrapping anchor).
- `Structure.constructionProgress` / `Structure.isConstructed` track build state. Unbuilt structures start at 10% HP (fragile scaffolding).
- Power, storage, and consumption are **gated behind `isConstructed`** — `getPowerOutput()`, `getStorageCapacity()`, etc. return 0 until fully built.
- `applyConstructionResources(amount)` / `applyRepairResources(amount)` — consume resources, return amount actually used.
- `markPreBuilt()` — instantly completes construction (used by Core and initial scenario setup).
- Construction and repair are **automatic**: `GridManager.processConstructionPulse()` runs each pulse, finds grid members with stored resources, routes them to unbuilt/damaged structures.
- **Sequential construction**: unconstructed structures cannot relay resources or power. BFS topology and A* routing treat them as dead ends — reachable as destinations but not traversable. A chain A→B→C→D builds sequentially: A funds B, then B completes and the grid expands to include C, etc. Topology is rebuilt when a structure completes construction (`topologyDirty = true`).
- Constants: `CONSTRUCTION_PULSE_AMOUNT` (5/pulse), `REPAIR_PULSE_AMOUNT` (3/pulse), `REPAIR_COST_PER_HP` (0.1).
- Disconnected structures cannot receive resources and remain as scaffolding until connected.

## Deconstruction System

- `Structure.isDeconstructing` / `Structure.deconstructionReturned` track deconstruction state.
- `beginDeconstruction()` starts; `cancelDeconstruction()` stops (structure returns to construction mode).
- `tickDeconstruction(rateKg)` returns kg released per tick, or `-1` when complete (caller removes structure).
- `DECONSTRUCTION_RATE_KG` (100 kg/pulse) in `GameTypes.ts`.
- Deconstruction halts all structure operations: `getPowerOutput()` / `getPowerConsumption()` return 0; turrets stop; economy structures stop ticking.
- `StructureManager.update()` ticks deconstruction before the grid update; removes completed structures and severs connections.
- Progress bar renders red (starts full, empties) via `StructureRenderer`.
- `GameEngine.toggleDeconstruction(structure)` is the public API.

## Power Toggle

- `Structure.isPoweredOn` (default `true`) — player-toggled power gate.
- When off: `getPowerOutput()` / `getPowerConsumption()` return 0; turrets/economy structures skip their tick.
- `Structure.isOperational()` = `isConstructed && isPoweredOn && !isDeconstructing` — preferred gate for subclass ticks.
- `GameEngine.toggleStructurePower(structure)` is the public API.
- Visual: dimmed fill alpha (0.5) + red X overlay drawn by `StructureRenderer`.

## GridManager

- **Connections**: `connect(a, b)`, `disconnect(conn)`, `canConnect(a, b)` — checks range (`CONNECTION_MAX_RANGE`), max connections, connection type rules, and duplicates.
- **Shield walls**: `setWorldCallbacks(addBody, removeBody)` — fence-to-fence connections spawn `ShieldWall` physics bodies (gated on both posts being constructed). `getShieldWalls()` returns all walls. `updateShieldWallActivation()` creates/removes walls as fences complete construction. `updateShieldWallStuns()` reactivates stunned walls after cooldown.
- **Topology**: BFS-based connected component detection, rebuilt only when `topologyDirty` flag is set.
- **Power aggregation**: `getGridPowerSummary(structure, allStructures)` — instant, unlimited throughput across connected grid. Only counts `isConstructed` structures (gated by Structure methods).
- **A* routing**: `findRoute(from, to)` with hop-count cost and Euclidean heuristic. Route cache invalidated on topology changes.
- **Pulse transfer**: every `TRANSFER_PULSE_MS` (1s), processes queued `requestTransfer()` calls. Respects bottleneck throughput along the route. Flashes connections on transfer.
- **Resource generation**: `processResourceGeneration()` runs first in pulse cycle. Power-gated. Generates into structure's own `storedResources` buffer (e.g., Refinery).
- **Construction/repair pulse**: `processConstructionPulse()` runs alongside transfer pulse. Delivers resources from grid storage to unbuilt structures (`CONSTRUCTION_PULSE_AMOUNT`) and damaged structures (`REPAIR_PULSE_AMOUNT`). Flashes route connections on delivery.

## ShieldWall (Shield Fence Barriers)

- Physical static barrier body spanning between two connected ShieldFence posts.
- **Construction-gated**: wall only spawns when BOTH fence posts are `isConstructed`. `GridManager.updateShieldWallActivation()` checks each frame and creates/removes walls as fences complete construction.
- Removed automatically by `GridManager.disconnect()` when posts are disconnected.
- **No friendly pass-through**: blocks ALL movement and weapons (deliberate design choice).
- `body.shieldWall = this` back-reference; label `'shield-wall'`.
- Thickness: `SHIELD_WALL_THICKNESS` (6 world units). **No HP** — damage is grid-powered.
- **Grid-powered damage resolution** (`GridManager.resolveShieldWallDamage()`):
  1. Battery stored power absorbs the damage first (1:1 watt-seconds). If batteries fully absorb → wall stays up.
  2. If batteries are depleted, remaining damage is checked against grid `netPower`. If grid absorbs → wall stays up.
  3. If grid cannot absorb the remainder → wall is **stunned** for `SHIELD_WALL_STUN_MS` (5s).
- Note: the old power-spike mechanic (`applyPowerSpike` on fence posts) has been removed. It inflated grid consumption before the netPower check, causing spurious stuns and phantom power-cuts via `updateShieldWallActivation`.
- **Power-gated**: `isPowered` flag managed by `updateShieldWallActivation()`. Wall body removed from physics when grid `netPower ≤ 0`; re-added when power is restored. Rendered as dim red + "NO POWER" label when unpowered.
- **Stun state**: `isStunned` + `stunUntil`. Stunned wall body is removed from physics (pass-through). Re-added when cooldown expires (`updateShieldWallStuns()`), but only if also powered. Rendered as dim red + "STUNNED" label.
- `isActive()` returns `!isStunned && isPowered` — used by placement validation and rendering.
- Damage wired in: `handleLaserHitShieldWall` (lasers), `handleMissileHitShieldWall` (missiles via `collisionStart`), `BeamSystem` (via `onShieldWallDamage` callback).
- Turret lasers skip same-team walls (friendly-fire prevention via `sourceTeam` check).
- Rendered by `StructureRenderer.renderShieldWalls()`: active = glowing blue lines; inactive (stunned/unpowered) = dim red flickering + status label.
- `ConnectionRenderer` skips fence-to-fence connections (they're rendered as walls instead).

## StructureAssemblyYard (Ship Production)

- Extends `Structure` with build cycle and ship tracking.
- `tickBuild(gridSummary)` — pulls resources from own `storedResources` each pulse; power-gated.
- `activeShipIds` — tracks spawned ships; pruned each frame against live assemblies.
- Ship cap: `ASSEMBLY_YARD_MAX_SHIPS` (3) — won't start building when at cap.
- Build cost: `shipBuildCost` from definition (150); build rate: 5 resources per pulse.
- `GameEngine.spawnShipFromYard(yard)` — spawns a random small ship design near the yard, assigns AI.
- Rendered by `StructureRenderer`: crossed-wrench icon, build progress bar, ship count readout.

## StructureManufacturer (Part Assembly)

- Extends `Structure` with recipe-based manufacturing.
- `currentRecipe: Recipe | null` — set via `setRecipe(recipe)`. Changing recipe resets progress.
- `tickBuild(gridSummary)` — pulls resources from own `storedResources` each pulse; power-gated.
- Build rate: `MANUFACTURER_PROCESS_RATE_KG` (50 kg) per pulse.
- `getBuildFraction()` — 0–1 progress toward current recipe completion.
- `getRecipeName()` — display name for rendering (or "Idle" when no recipe set).
- `getRequiredMaterials()` — lists recipe ingredients for UI display.
- `itemsProduced` — lifetime counter for stats display.
- Currently uses simplified single-resource model (`storedResources`). Will consume specific `MaterialType` quantities per recipe once inventory system is live.
- Rendered by `StructureRenderer`: gear icon, green-yellow build progress bar, recipe name readout.

## StructureRecycler (Scrap Recovery)

- Extends `Structure` with scrap processing.
- `tickProcess(gridSummary)` — processes scrap from `storedResources` each pulse; power-gated.
- Process rate: `RECYCLER_PROCESS_RATE_KG` (30 kg) per pulse.
- Recovery yield: `RECYCLER_YIELD_FRACTION` (60%) — 40% is waste.
- Recovered materials deposited back into own `storedResources` for grid distribution.
- Lifetime stats: `totalProcessedKg`, `totalRecoveredKg` (via `getLifetimeStats()`).
- Currently uses simplified single-resource model. Will output specific `MaterialType` quantities once inventory system is live.
- Rendered by `StructureRenderer`: triangular recycle-arrows icon, NO POWER indicator when brownout.

## StructureMiningPlatform (Multi-Turret Autonomous Mining)

- Extends `Structure` with 4 independent turret slots on an X-shaped base.
- `updateTurrets(deltaTimeMs, now, asteroidBodies, gridSummary, obstacleBodies)` — called each frame by `StructureManager`; returns `BeamFireSpec[]` (up to 4).
- **Power-gated**: requires `gridSummary.powerEfficiency > 0` and `isOperational()`.
- **Targeting**: each turret independently finds closest asteroid within `miningRange`; prefers unclaimed asteroids (not targeted by other turrets on same platform). Re-scans every `ASTEROID_SCAN_INTERVAL_MS` (1s). Drops target at 1.2× range.
- **Barrel rotation**: each turret smoothly rotates `turretAngles[i]` at 1.5 rad/s; fires only when within `AIM_THRESHOLD_RAD` (0.2 rad).
- **LOS check**: uses `checkLineOfSight()` before firing — won't fire through obstacles.
- **Beam spec**: `weaponType: 'MiningLaser'` so `BeamSystem` triggers the mining callback. `weaponId` includes turret index.
- `getTurretBarrelEndpoint(i)` — world-space barrel tip for turret `i`.
- `getTargetAsteroidClass()` — returns any current target's `AsteroidClass` (for UI).
- `StructureManager` routes `'MiningPlatform'` to this subclass in `spawnStructure()`.
- `StructureManager` collects beam specs from all mining platforms in `update()` and exposes them via `getMiningBeamSpecs()`. `GameEngine` routes these to `BeamSystem.processBeamFire()`.

## Sensor Areas (Refinery Ore Deposit)

- Refineries have `sensorRadius` in their `StructureDefinition` (`REFINERY_SENSOR_RADIUS = 350` world units).
- **Non-physics zone**: no Matter.js body — purely a distance check in `StructureManager.processSensorAreas()`.
- **Dwell-time trigger**: when an assembly with ore cargo remains inside a sensor zone for `SENSOR_DEPOSIT_DWELL_MS` (3s), its ore is transferred to the structure's `storedResources`.
- `SensorDwellState` interface tracks `{ assemblyId, enteredAt }` per structure. Reset when assembly leaves zone.
- `StructureManager.getSensorAreaStates()` — returns sensor area positions + active dwell states for rendering.
- Rendered by `StructureRenderer.renderSensorAreas()`: dashed circle + "DROP ORE HERE" / "DEPOSITING..." text with color changes (green depositing, yellow assembly inside, dim green idle).
- `StructurePlacementRenderer` draws a dashed circle preview when placing a structure with `sensorRadius`.
- `StructurePlacementSystem.isPlacementBlocked()` prevents placing structures inside existing sensor zones.

## Connection Rules

- **General rule**: at least one side must be a Connector (or Core), OR both sides are ShieldFence.
- **Non-connector structures** have `maxConnections: 1` — single link to one Connector.
- **ShieldFence**: `maxConnections: 3`; can ONLY connect to Connectors or other ShieldFences.
- **Fence-to-fence connection** creates a physical ShieldWall barrier between the two posts.
- **Line-of-sight**: connections are rejected if the straight line between the two structures passes through any other structure's bounding box. `isConnectionLineBlocked(posA, posB, excludeA?, excludeB?)` is the public API (used by both `canConnect` and `StructurePlacementSystem` preview).
- `canConnect()` enforces all these rules before allowing a link.

## Connection

- Data-only class: `id`, `nodeA`, `nodeB`, `throughput` (from `CONNECTION_THROUGHPUT`), `flashUntil`.
- `flash()` triggers a 300ms visual pulse on the connection line.
- Rendered by `ConnectionRenderer` (priority 13).

## Import Paths

From files in this directory:
- `../../types/GameTypes`
- `./Structure` (for subclasses and manager)
- `./Connection` (for GridManager)

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
