# /src/game/structures — Base-Building Structure System

Static structures for base-building, defense, resource production, and trading. Structures are orders of magnitude more powerful and resilient than mobile Assemblies.

## Class Hierarchy

| Class | Purpose |
|-------|---------|
| `Structure` | Base class — wraps a static Matter.js body with HP, team, power, and storage |
| `StructureCore` | The foundational structure; provides baseline power + storage; aggregates grid summary |
| `StructureManager` | Lifecycle manager — spawn, update, dispose; provides getters for UI and rendering |

## Physics Conventions

- All structure bodies are **`isStatic: true`** — they do not move.
- Bodies use `body.structure = this` back-reference (same pattern as `body.entity` / `body.assembly`).
- Body label format: `structure-{type}` (e.g., `structure-Core`).
- Visual styling is set via `body.render.fillStyle/strokeStyle/lineWidth` and also read by `StructureRenderer`.

## Structure Definitions

Defined in `GameTypes.ts` as `STRUCTURE_DEFINITIONS: Record<StructureType, StructureDefinition>`. To add a new structure type:

1. Add the type name to the `StructureType` union in `GameTypes.ts`.
2. Add its definition to `STRUCTURE_DEFINITIONS`.
3. If it needs special behavior, create a subclass extending `Structure`.
4. Add a spawn method to `StructureManager`.

## StructureManager

- Constructor takes `(addBodyToWorld, removeBodyFromWorld)` callbacks (same pattern as `AsteroidFieldSystem`).
- `update(deltaTimeMs)` — removes destroyed structures each frame.
- `getStructures()` — returns all structures (for rendering).
- `getTeamCore(team)` / `getTeamGridSummary(team)` — convenience accessors for UI.
- `dispose()` — tears down all structures on scene change.

## Import Paths

From files in this directory:
- `../../types/GameTypes`
- `./Structure` (for subclasses and manager)

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
