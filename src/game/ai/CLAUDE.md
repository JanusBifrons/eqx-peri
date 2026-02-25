# /src/game/ai — Control & Decision-Making

`Controller` (base/interfaces), `PlayerController`, `AIController`, `FlightController`, `ControllerManager`.

## Rules

- `Controller` is the abstract base; `PlayerController` and `AIController` extend it.
- `FlightController` handles low-level movement; use its `follow`/`orbit` modes — do not write raw thrust logic in `AIController`.
- Target acquisition updates every 500 ms; engagement range is 400 units.
- Flee threshold: 30% health — AI switches to `DEFENSIVE` below this.
- AI teams: `PLAYER`, `ENEMY_RED`, `ENEMY_BLUE` (defined in `GameTypes.ts`).
- Behaviours: `AGGRESSIVE`, `DEFENSIVE`, `PATROL`, `ESCORT`.
- Import paths from files in this directory: `../core/Assembly`, `../../types/GameTypes`

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
