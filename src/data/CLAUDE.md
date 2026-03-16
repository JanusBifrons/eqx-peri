# /src/data — Ship Definitions

## ships.json

The authoritative source for all playable ship configurations. Imported at runtime via `resolveJsonModule` in `tsconfig.json`.

### Structure

Each ship entry is an object with:
- `name: string` — display name; used in `ShipSelection` UI and scenario setup.
- `entities: EntityConfig[]` — ordered list of blocks; each block has `type`, `x`, `y`, `rotation`.

### Coordinate Convention

- Ships face **east (right)** by default.
- **X axis = forward/backward** (negative = rear/engine side, positive = nose/gun side).
- **Y axis = lateral** (negative = top wing, positive = bottom wing).
- All `x` and `y` values are pixel coordinates at multiples of `GRID_SIZE` (16 px).

### Editing Rules

- Do not add `any` types or optional fields not present in `EntityConfig` — strict TypeScript mode will reject them.
- After adding or changing a ship, verify connectivity with `node scripts/debug-connections.js` or the equivalent debug script.
- `ships.json.backup` is a manual backup — update it after significant changes.

---

MAINTENANCE MANDATE: If you change the ships.json schema or add new required fields, update this file and the `EntityConfig` interface in `GameTypes.ts`.
