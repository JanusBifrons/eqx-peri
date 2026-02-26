# /src/game/ai — Control & Decision-Making

`Controller` (base/interfaces), `PlayerController`, `AIController`, `FlightController`, `ControllerManager`.

## Rules

- `Controller` is the abstract base; `PlayerController` and `AIController` extend it.
- `FlightController` handles player-assist movement (orbit/follow modes for spectating). Combat AI logic lives directly in `AIController`.
- Target acquisition updates every 500 ms; engagement range is 400 units.
- Flee threshold: 30% health — AI switches to `DEFENSIVE` below this.
- AI teams: `PLAYER`, `ENEMY_RED`, `ENEMY_BLUE` (defined in `GameTypes.ts`).
- Behaviours: `AGGRESSIVE`, `DEFENSIVE`, `PATROL`, `ESCORT`.
- Import paths from files in this directory: `../core/Assembly`, `../../types/GameTypes`

## AI Movement: Arrive Steering with Dead Reckoning

Zero-friction space requires velocity-aware steering. The pattern used in `AIController.arriveThrust()`:

1. **Desired position** — stand off at `preferredRange` from the target along the current separation axis.
2. **Desired velocity** — point toward desired position at `MAX_SPEED`, tapered to zero within `ARRIVAL_RADIUS` (natural braking).
3. **Steering** = `desiredVelocity − currentVelocity`. This corrects for existing momentum so ships decelerate instead of looping.
4. **World → local conversion** — `applyThrust` takes ship-local coordinates; always rotate world-space steering by `−shipAngle` before returning from a controller.

Do **not** compute thrust as a direction-toward-target without subtracting current velocity — in frictionless space this causes unbounded acceleration and loop behaviour.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
