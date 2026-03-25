# /src/game/weapons — Weapon Systems

Missile, Beam, and Harpoon weapon subsystems. Each system is instantiated by `GameEngine` and accessed via named fields.

## Systems Overview

| System | File | Accessed via | Role |
|--------|------|--------------|------|
| `MissileSystem` | `MissileSystem.ts` | `GameEngine.missileSystem` | Missile lifecycle: creation, update, hit handling |
| `BeamSystem` | `BeamSystem.ts` | `GameEngine.beamSystem` | Beam/tractor beam raycast, damage, and force application |
| `HarpoonSystem` | `HarpoonSystem.ts` | `GameEngine.harpoonSystem` | Harpoon projectile + tether constraint lifecycle |

Import paths from files in this directory: `../core/Assembly`, `../../types/GameTypes`

## Missile System (rewritten)

Three missile variants configured via `MISSILE_CONFIGS` in `GameTypes.ts`:

| Launcher | Variant | Damage | Behaviour |
|----------|---------|--------|-----------|
| `MissileLauncher` | `tracking` | 25 | Proportional navigation, full steering |
| `LargeMissileLauncher` | `standard` | 40 | Moderate turn rate, accelerates fast |
| `CapitalMissileLauncher` | `torpedo` | 80 | No turning, straight-line heavy hitter |

**Phase-based flight** (`Missile.ts`):
- `launch` (0–0.5 s): `initialSpeed`, no steering, no collisions (launch delay)
- `boost` (0.5–2.5 s): linear ramp from `initialSpeed` to `maxSpeed`, steering active
- `cruise` (2.5 s+): `maxSpeed`, full tracking

**Velocity-vector steering**: `steerTowardTarget()` blends the current velocity direction toward the desired direction by `turnRate * deltaTime`. Proportional navigation with pure-pursuit blending for tracking missiles. Body angle set to velocity direction each frame.

**Body tagging**: `(body).isMissile = true`, `(body).missile = this`, `render.visible = false` (MissileRenderer handles drawing).

**Collision detection**: Matter.js `collisionStart` events trigger `MissileSystem.handleMissileHit()`. Bodies created with `bullet: true` for CCD.

**PDC interception**: missile bodies are included in the laser raycast candidate list. `GameEngine.handleLaserHitMissile()` destroys both the laser and the missile on hit.

## Beam System

`BeamSystem.processBeamFire()` performs ray-convex-polygon intersection against entity bodies + shield parts. Handles damage, shield interception, mining, structures, shield walls.

### Tractor Beam

`TractorBeam` weapon type is routed to `BeamSystem.processTractorBeamFire()` instead of the regular damage path.

- Finds all enemy assemblies within a cone (`TRACTOR_CONE_HALF_ANGLE`, ~14°) of the beam direction
- Applies `Matter.Body.applyForce()` toward the beam origin, scaled by target mass and cone centering
- No damage dealt
- Force constant: `TRACTOR_BEAM_FORCE` (0.015), range: `TRACTOR_BEAM_RANGE` (300)
- Rendered with green beam style in `BeamRenderer` (`BEAM_STYLES.TractorBeam`)

### Mining Callback

- `BeamSystem.setMiningCallback(cb)` wires asteroid ore extraction.
- When a beam hits an asteroid body and the weapon has `miningRate`, calls `onMiningHit(sourceAssemblyId, asteroidClass, oreKg)`.
- `GameEngine.handleMiningHit()` routes ore to assembly cargo or structure inventory.

## Harpoon System

`HarpoonSystem` manages harpoon projectiles and tether constraints.

- `fireHarpoon()`: spawns a small physics body (`isHarpoon = true`, collision category `0x0008`)
- `handleHarpoonHit()`: removes projectile, creates `Matter.Constraint` between source and target assemblies with `HARPOON_STIFFNESS` (0.001) and `HARPOON_DAMPING` (0.05)
- `update()`: validates tethers (assemblies alive, distance < `TETHER_BREAK_LENGTH` = 800), removes expired projectiles (TTL 5 s)
- Shield interception: `GameEngine.handleHarpoonHitShield()` damages shield and destroys harpoon
- Friendly pass-through: `tryDisableFriendlyShieldPair` checks `harpoonData.sourceTeam`

## Friendly Shield Pass-Through

All weapon types check team before shield interaction:
- `Missile.sourceTeam` → `MissileSystem.handleMissileHit()` and `GameEngine.handleMissileHitShield()`
- `BeamSystem.processBeamFire()` excludes same-team shield parts from candidates
- `HarpoonSystem` → `GameEngine.handleHarpoonHitShield()` checks source team
- `GameEngine.tryDisableFriendlyShieldPair()` handles missiles, harpoons, and entity bodies

## PDC System

PDCs (`Assembly.getPDCFires()`) fire autonomously — not gated by the fire input. They:
- Scan for the nearest enemy missile within `PDC_SCAN_RADIUS` (500)
- Compute lead prediction based on missile velocity
- Create laser bodies with `isLaser = true`, `isPDCProjectile = true`
- Per-entity fire timing via `entityFireTimes` Map at `PDC_FIRE_RATE_MS` (100 ms)
- PDC projectiles travel through the existing laser raycast path; `handleLaserHitMissile()` handles interception

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
