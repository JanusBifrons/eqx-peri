# /src/game/weapons — Missile & Weapon Systems

`Missile` (individual projectile) and `MissileSystem` (lifecycle manager).

## Rules

- Three missile types: `Torpedo`, `HeatSeeker`, `Guided` — extend `MissileType` enum to add new types; handle the new type in `MissileSystem`.
- Thrust phases: Launch (1.5×) → Search/Cruise (0.6–0.8×) → Full Throttle (2.0×); preserve this phase structure for any new missile type.
- Proximity collision uses per-frame distance checks — do not rely on Matter.js built-in collision for missile hits.
- `MissileSystem` is accessed via `GameEngine.missileSystem` — do not instantiate it elsewhere.
- Import paths from files in this directory: `../core/Assembly`, `../../types/GameTypes`

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
