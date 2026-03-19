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
- **Power spike**: every hit applies `damage` as temporary power consumption to both fence posts for `SHIELD_WALL_POWER_SPIKE_MS` (1.5s). Stacks additively — multiple simultaneous hits compound, potentially pushing `netPower` negative and browning out turrets/consumers.
- **Grid-powered damage resolution** (`GridManager.resolveShieldWallDamage()`):
  1. If damage ≤ grid `netPower` → fully absorbed, no effect (impenetrable).
  2. If damage > `netPower` → excess drains Battery structures' `storedResources` (only Battery type, not Core/Connectors).
  3. If damage > `netPower` + battery reserves → wall is **stunned** for `SHIELD_WALL_STUN_MS` (5s).
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

## Connection Rules

- **General rule**: at least one side must be a Connector (or Core), OR both sides are ShieldFence.
- **Non-connector structures** have `maxConnections: 1` — single link to one Connector.
- **ShieldFence**: `maxConnections: 3`; can ONLY connect to Connectors or other ShieldFences.
- **Fence-to-fence connection** creates a physical ShieldWall barrier between the two posts.
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
