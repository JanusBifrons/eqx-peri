# /src/game/core — Fundamental Physics Objects

`GameEngine`, `Assembly`, and `Entity` — the bottom of the dependency graph. Nothing in `core/` imports from `ai/`, `weapons/`, `ship/`, or `systems/` except `GameEngine` (which wires everything together).

## Rules

- `Entity` = one physical block; one `Matter.Body` per entity. Never create entities outside `Assembly`.
- `Assembly` = compound ship; owns the connection graph and all its entities' bodies.
- Destruction cascades through `Assembly.removeEntity()` — never manipulate bodies directly from outside.
- `GameEngine` is the only place Matter.js `Events` listeners are registered.
- Import paths from files in this directory: `../../types/GameTypes`, `../../data/ships.json`

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
