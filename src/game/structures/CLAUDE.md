# /src/game/structures — Base-Building Structure System

Static structures for base-building, defense, resource production, and trading. Structures are orders of magnitude more powerful and resilient than mobile Assemblies.

## Class Hierarchy

| Class | Purpose |
|-------|---------|
| `Structure` | Base class — wraps a static Matter.js body with HP, team, power, and storage |
| `StructureCore` | The foundational structure; provides baseline power + storage |
| `StructureTurret` | Turret subclass — autonomous targeting, aiming, and laser firing |
| `StructureManager` | Lifecycle manager — spawn, update, dispose; delegates networking to `GridManager` |
| `Connection` | Data-only link between two structures (throughput, flash state) |
| `GridManager` | Network graph, connected components (BFS), A* routing, power aggregation, pulse transfer |

## Physics Conventions

- All structure bodies are **`isStatic: true`** — they do not move.
- Bodies use `body.structure = this` back-reference (same pattern as `body.entity` / `body.assembly`).
- Body label format: `structure-{type}` (e.g., `structure-Core`).
- Hex bodies: `Matter.Bodies.polygon(x, y, 6, radius)` for `shape: 'hex'` (Connector).
- Visual styling is set via `body.render.fillStyle/strokeStyle/lineWidth` and also read by `StructureRenderer`.

## Structure Definitions

Defined in `GameTypes.ts` as `STRUCTURE_DEFINITIONS: Record<StructureType, StructureDefinition>`. To add a new structure type:

1. Add the type name to the `StructureType` union in `GameTypes.ts`.
2. Add its definition to `STRUCTURE_DEFINITIONS`.
3. If it needs special behavior, create a subclass extending `Structure`.
4. Add a spawn method to `StructureManager`.

## StructureTurret (Defense)

- Extends `Structure` with targeting, aiming, and laser creation.
- `SmallTurret` and `LargeTurret` types use this subclass (routed by `StructureManager.spawnStructure()`).
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
- `spawnStructure()` routes `SmallTurret`/`LargeTurret` to `StructureTurret` constructor, `Core` to `StructureCore`, others to base `Structure`.
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
- Constants: `CONSTRUCTION_PULSE_AMOUNT` (5/pulse), `REPAIR_PULSE_AMOUNT` (3/pulse), `REPAIR_COST_PER_HP` (0.1).
- Disconnected structures cannot receive resources and remain as scaffolding until connected.

## GridManager

- **Connections**: `connect(a, b)`, `disconnect(conn)`, `canConnect(a, b)` — checks range (`CONNECTION_MAX_RANGE`), max connections, and duplicates.
- **Topology**: BFS-based connected component detection, rebuilt only when `topologyDirty` flag is set.
- **Power aggregation**: `getGridPowerSummary(structure, allStructures)` — instant, unlimited throughput across connected grid. Only counts `isConstructed` structures (gated by Structure methods).
- **A* routing**: `findRoute(from, to)` with hop-count cost and Euclidean heuristic. Route cache invalidated on topology changes.
- **Pulse transfer**: every `TRANSFER_PULSE_MS` (1s), processes queued `requestTransfer()` calls. Respects bottleneck throughput along the route. Flashes connections on transfer.
- **Construction/repair pulse**: `processConstructionPulse()` runs alongside transfer pulse. Delivers resources from grid storage to unbuilt structures (`CONSTRUCTION_PULSE_AMOUNT`) and damaged structures (`REPAIR_PULSE_AMOUNT`). Flashes route connections on delivery.

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
