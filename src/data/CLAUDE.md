# /src/data — Static Game Data

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

## economy.json

Resource economy data — asteroid ore types, refining loot tables, and material recipes.

### Structure

- `resource_nodes[]` — one entry per asteroid class (C-Type, S-Type, M-Type). Each has `ore_type`, `waste_fraction` (0.80 = 80% slag), and `refined_drops[]` with `material`, `rarity`, `drop_chance_pct`, `yield_kg`.
- `recipes.ship_parts[]` — recipes for manufacturing ship blocks. Each has `id`, `name`, `ingredients[]` with `material` and `amount_kg`.
- `recipes.world_structures[]` — recipes for constructing world structures. Same format.

### Editing Rules

- Material names must match the `MaterialType` union in `GameTypes.ts` (PascalCase, no spaces).
- Drop chances per asteroid type should sum to 100%.
- All amounts are in **kg** (the game's mass standard: 1 Matter.js mass unit = 1 kg).

---

MAINTENANCE MANDATE: If you change the ships.json schema or add new required fields, update this file and the `EntityConfig` interface in `GameTypes.ts`. If you change economy.json, ensure material names match the `MaterialType` union.
