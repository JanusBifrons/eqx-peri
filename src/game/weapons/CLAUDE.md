# /src/game/weapons — Missile & Weapon Systems

`Missile` (individual projectile) and `MissileSystem` (lifecycle manager).

## Rules

- Three missile types: `Torpedo`, `HeatSeeker`, `Guided` — extend `MissileType` enum to add new types; handle the new type in `MissileSystem`.
- Thrust phases: Launch (1.5×) → Search/Cruise (0.6–0.8×) → Full Throttle (2.0×); preserve this phase structure for any new missile type.
- `MissileSystem` is accessed via `GameEngine.missileSystem` — do not instantiate it elsewhere.
- Import paths from files in this directory: `../core/Assembly`, `../../types/GameTypes`

## Collision Detection

Missiles use Matter.js for collision detection:
1. **Matter.js CCD**: Bodies are created with `bullet: true` for continuous collision detection to prevent tunneling.
2. **Matter.js collision events**: `collisionStart` events trigger `MissileSystem.handleMissileHit()`.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
