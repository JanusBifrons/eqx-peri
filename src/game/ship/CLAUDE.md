# /src/game/ship — Ship Design Utilities

Offline/design-time helpers for composing and validating ship layouts. These are **not** runtime game systems — they convert design-time descriptions into `EntityConfig[]` arrays that `Assembly` then ingests.

## Files

| File | Purpose |
|------|---------|
| `BlockSystem.ts` | Types, registries, validators, and coordinate helpers for block-based ship designs |
| `ShipDesigner.ts` | Static factory methods that return preset `EntityConfig[]` layouts (BasicFighter, HeavyCruiser, etc.) |
| `ShipDesignManager.ts` | Converts a `ShipDesign` (from `BlockSystem`) into `EntityConfig[]` via `ENTITY_DEFINITIONS` |
| `ShipLibraryService.ts` | localStorage-backed CRUD for user-created ship records; merges with built-in `ships.json` ships |

## ShipLibraryService

- `ShipRecord` — extends `EntityConfig[]` parts with `id`, `name`, `createdAt`, `updatedAt` (ISO 8601), and optional `isBuiltIn: true` for ships.json entries.
- `ShipStats` — `{ blockCount, totalMass, engineCount, weaponCount }` computed from parts.
- `computeShipStats(parts)` — standalone function that sums mass from `ENTITY_DEFINITIONS[type].mass` and counts engines/weapons.
- `shipLibraryService` — module-level singleton instance. Use this in UI components; do not instantiate multiple instances.
- Built-in ships (from `ships.json`) have `id: 'builtin-<index>'`, empty `createdAt`/`updatedAt`, and `isBuiltIn: true`. They are read-only: `update()` and `delete()` silently ignore built-in ids.
- localStorage key: `eqx_ship_library_v1`. Schema is a `ShipRecord[]` array (user ships only; built-ins are derived at runtime).
- `getAll()` returns built-ins first (preserving `ships.json` order), then user ships sorted by `updatedAt` descending.

## BlockSystem Concepts

- `BlockRegistry` — static `Map<EntityType, BlockDefinition>` populated by `initializeBlockRegistry()` (called at module load). **Separate from `ENTITY_DEFINITIONS`** in `GameTypes.ts`; the two systems coexist.
- `ShipValidator.isValidDesign(design)` — BFS check that all blocks in a `ShipDesign` are reachable from the first block.
- `ConnectionDetector.areEntitiesConnected(e1, e2)` — preferred connection check for runtime entity objects; falls back to attachment-point proximity for plain config objects.
- `CoordinateSystem` — static helpers: `gridToWorld`, `worldToGrid`, `getAdjacentPosition`.
- `areEntitiesAdjacent` — deprecated alias for `ConnectionDetector.areEntitiesConnected`.

## Rules

- `BLOCK_SIZE = 16` (same as `GRID_SIZE` in `GameTypes.ts`) — keep them in sync.
- Ship coordinate convention: **X = forward (nose direction), Y = lateral**. Ships face **east** by default.
- `ShipDesigner` uses `Direction` (`'forward' | 'backward' | 'left' | 'right'`) which maps to 0°/180°/270°/90° respectively.
- `ShipDesignManager.shipDesignToEntityConfigs()` validates before converting — it will throw on an invalid design. Call `ShipValidator.isValidDesign()` first if you want a boolean check.
- Do not add gameplay logic (physics, damage, AI) to this directory — it is design-time only.

## Import Paths

From files in this directory:
- `../../types/GameTypes`

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
