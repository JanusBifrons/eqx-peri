# /src/game/ai — Control & Decision-Making

`Controller` (base/interfaces), `PlayerController`, `AIController`, `FlightController`, `ControllerManager`.

## Rules

- `Controller` is the abstract base; `PlayerController` and `AIController` extend it.
- `FlightController` handles player-assist movement (orbit/follow modes for spectating). Combat AI logic lives directly in `AIController`.
- Target acquisition updates every 500 ms; engagement range uses per-weapon `weaponRange` from `EntityTypeDefinition` (falls back to `FIRING_RANGE` constant).
- Import paths from files in this directory: `../core/Assembly`, `../../types/GameTypes`

## Target Selection (`AIController`)

- **Valid targets only**: AI will only engage assemblies that satisfy `isValidTarget()` — enemy team, not destroyed, and `hasControlCenter()`. Loose scrap/debris (no cockpit) is never targeted.
- **Target validated every frame** in `setAvailableTargets()` and every scan interval in `validateCurrentTarget()`. A target that loses its cockpit mid-fight is cleared immediately.
- **Attacker priority**: `AIController` monitors `assembly.lastHitByAssemblyId` (written by `GameEngine` on damage events). If the last attacker is a valid enemy, it becomes the priority target for `ATTACKER_PRIORITY_MS` (8 s). After that timeout, the AI falls back to the closest valid enemy.
- Constants `FIRING_RANGE`, `AIM_READY_THRESHOLD`, `ATTACKER_PRIORITY_MS` are declared at the top of `AIController.ts`. `FIRING_CONE` is **removed** — the AI no longer fires based on ship nose angle.

## Combat State Machine (`AIController`)

Ships cycle through four states. Transitions are evaluated every 350 ms.

| State | Preferred range | Speed | Lateral damp | Fire | Heading |
|-------|----------------|-------|--------------|------|---------|
| `SIZING_UP` | 600 | 0.65× | 0.96 approach / 0.98 holding | **no** | weapons-optimal |
| `ENGAGE` | 400 | 1.0× | 0.96 approach / 0.98 holding | yes | weapons-optimal |
| `PURSUE` | 250 | 1.45× | 0.96 always | yes | weapons-optimal |
| `RETREAT` | 800 | 1.4× | **none** | yes (if arc) | nose away from target |

**Assessment axes:**
- `ownHealth` = total current HP / total max HP across all blocks
- `powerRatio` = `computeCombatPower(self)` / `computeCombatPower(target)`
- `computeCombatPower` = sum of live weapon-block ratings × assembly health ratio; heavier weapons (CapitalWeapon=5, LargeGun=2.5, …) count more

**Transition rules (constants in `AIController.ts`):**
- `ownHealth < RETREAT_HEALTH_THRESHOLD (0.30)` → RETREAT immediately from any state
- After `SIZING_UP_DURATION_MS (2500 ms)`:  powerRatio ≥ `POWER_RATIO_PURSUE (1.40)` → PURSUE; ≤ `POWER_RATIO_RETREAT (0.65)` → RETREAT; else ENGAGE
- ENGAGE: re-evaluates power balance each tick, can transition to PURSUE or RETREAT
- RETREAT → SIZING_UP only if powerRatio ≥ PURSUE threshold AND health > 30% (enemy crippled while we fled)
- Any target change resets to SIZING_UP via `syncTargetLock()`

**SIZING_UP fire suppression**: `fire = false` for the full window — ships approach, assess, and weapons track before the first shot is fired.
**RETREAT heading**: `computeRetreatHeading()` returns the angle directly away from the target so forward thrust propels the ship along the escape vector. Weapons don't fire during retreat unless they happen to have rear-facing arc coverage.

## AI Weapon Aiming & Lock-On

- **Lock-on sync**: `AIController.syncTargetLock()` sets `assembly.primaryTarget` directly whenever the combat target changes. This hooks into `Assembly.updateWeaponAiming()` which is already called every frame for all assemblies — no extra calls needed. Set directly (not via `setPrimaryTarget`) to avoid triggering player-UI toast/lock side-effects.
- **Optimal heading**: `AIController.computeOptimalHeading()` computes the circular mean of all weapon natural directions (ship-local angles). The result is the ship heading that minimises average arc usage across the whole battery. For all-forward ships this equals `angleToTarget`; asymmetric designs split optimally between weapon axes.
- **Per-weapon fire readiness**: `AIController.hasWeaponsReadyToFire()` replaces the old ship-nose-angle cone check. It returns `true` when at least one weapon (a) is within its `weaponRange` of its target, (b) has the target inside its aiming arc (`Assembly.canWeaponAimAtTarget`), **and** (c) has its turret tracked to within `AIM_READY_THRESHOLD` (0.25 rad ≈ 14°) of its `targetAimAngle`. Each weapon checks range individually using `ENTITY_DEFINITIONS[type].weaponRange`.
- **Turret rotation speed**: `Entity.aimRotationSpeed` is now set per weapon type in the `Entity` constructor via `defaultAimRotationSpeed()`. Small guns: 2.5 rad/s; Large guns: 1.8; Capital: 1.2; Beams: 3.0. The old hard-coded `0.005` (effectively immobile) is removed.

## AI Movement: Arrive Steering with Dead Reckoning

Zero-friction space requires velocity-aware steering. The pattern used in `AIController.arriveThrust()`:

1. **Desired position** — stand off at `preferredRange` from the target along the current separation axis.
2. **Desired velocity** — point toward desired position at `MAX_SPEED`, tapered to zero within `ARRIVAL_RADIUS` (natural braking).
3. **Steering** = `desiredVelocity − currentVelocity`. This corrects for existing momentum so ships decelerate instead of looping.
4. **World → local conversion** — `applyThrust` takes ship-local coordinates; always rotate world-space steering by `−shipAngle` before returning from a controller.

Do **not** compute thrust as a direction-toward-target without subtracting current velocity — in frictionless space this causes unbounded acceleration and loop behaviour.

**Two-mode thrust**: `getCombatInput()` dispatches to `approachThrust()` (long range, full arrive steering) or `engagementThrust()` (inside `FIRING_RANGE`, calm radial-only corrections) based on distance.

**Why ships orbit with forward-only engines**: Even though thrust is always forward-only (`{x: mag, y: 0}` in ship-local), the ship rotates every frame to aim weapons. Over many frames the "forward" direction sweeps around, accumulating velocity in a curve. In zero-friction space that curve never decays → stable orbit. **Fix**: axis-decomposed inertial dampening (see below) + `engagementThrust()` dead-band.

**Axis-decomposed inertial dampening** (`ControllerManager.applyInput`): when `ControlInput.lateralDampenFactor` is set, velocity is split into forward (along ship nose) and lateral (perpendicular) components. The lateral component is multiplied by `lateralDampenFactor` every physics frame; the forward component by `dampenFactor`. Two tiers: **holding position** — `dampenFactor=0.99, lateralDampenFactor=0.98` (gentle drag simulating internal dampeners; ~0.55× speed after 1 s, ~0.30× after 2 s); **approaching** — `dampenFactor=1.0, lateralDampenFactor=0.96` (forward speed preserved for closing, lateral drift slowly suppressed). Player inputs leave `lateralDampenFactor` unset, using the original uniform-factor path (backward compatible). **Rule**: dampening must never be aggressive enough to stop a ship "on a dime" — deceleration should be visibly gradual. Active braking thrust (below) does the heavy lifting.

**Dead-band with active braking**: `engagementThrust()` uses a ±120-unit dead-band around `preferredRange`. Inside the band, active retro-thrust is applied opposing the ship's current velocity — the ship uses its engines to decelerate (physics-correct) rather than having velocity artificially zeroed. Braking magnitude scales with speed (up to 60% thrust), tapering to zero as the ship slows. Outside the band, small radial corrections (capped at 35% of max thrust) push toward the preferred range.

## Team Coordination & Formation

**Formation slots**: `ControllerManager.updateAITargets()` groups AI controllers by shared combat target. Ships targeting the same enemy are assigned evenly-spaced angular slots (`FORMATION_ARC_SPACING = 60°`) around the target. `approachThrust()` and `engagementThrust()` offset the desired standoff position by the ship's formation angle, preventing stacking.

**Separation steering**: `computeSeparationSteering()` produces a repulsive force pushing the ship away from any friendly within `SEPARATION_RADIUS` (150 units). Strength is inverse-linear (full at contact, zero at radius edge). Applied in both `approachThrust()` and `engagementThrust()`. Constant `SEPARATION_STRENGTH = 0.4`.

**Team-level retreat**: `ControllerManager` computes total combat power per team each frame and passes the `teamPowerRatio` to each `AIController`. Retreat decisions in `updateCombatState()` check both the individual power ratio AND the team ratio:
- A ship only retreats if its individual matchup is bad AND the team overall is not winning (`teamPowerRatio < TEAM_RETREAT_THRESHOLD = 0.85`).
- Exception: ships below 15% HP always retreat regardless of team status.
- Ships can re-engage from RETREAT if either their individual ratio improves OR the team starts dominating.
- This prevents one damaged ship from fleeing while its allies are winning the overall battle.

**Data flow**: `ControllerManager` → `AIController.setFriendlies(sameTeamAssemblies)`, `setTeamPowerRatio(ratio)`, `setFormationSlot(index, total)`. Formation slots are sorted by assembly ID for frame-to-frame stability.

## AI Order System (RTS-style)

`AIController` accepts player-issued orders via `setOrder(order: AIOrder | null)`. When a move order is active, it takes priority over the combat state machine.

**Move order** (`type: 'move'`): `MoveOrder` stores `targetPosition`, `waypoints: Vector2[]` (computed by `PathfindingSystem` at issue time), and `currentWaypointIndex`. `processMoveOrder()` advances through waypoints sequentially; intermediate waypoints use `WAYPOINT_ADVANCE_THRESHOLD` (120 units, no stop), the final waypoint uses `MOVE_ARRIVAL_THRESHOLD` (60 units, full stop at `speed < 0.15`). `steerTowardPoint()` handles per-waypoint arrive-steering. When stationary, the ship rotates to face the heading before thrusting (avoids S-curves). All dampening uses the same `ControlInput` flags as the player (`dampenFactor: 0.985`, `angularDampenFactor: 0.98`).

**Pathfinding**: `PathfindingSystem` (in `src/game/systems/`) wraps `pathfinding` npm (A* with diagonal movement). Builds a local grid (80-unit cells, 400-unit margin) on demand when a move order is issued. Static obstacles (structures, asteroids, shield walls) are inflated by 60 units. Returns smoothed world-coordinate waypoints. Falls back to direct path when no obstacles or grid too large.

**Issuing orders**: `GameEngine.issueAIOrder(assemblyId, order)` stores the order in both `AIController` and an `aiOrders` map. Right-clicking empty space with a friendly (team 0) AI ship selected computes waypoints via `PathfindingSystem.findPath()` and issues a move order. `GameEngine.getActiveAIOrders()` returns live orders for rendering (auto-prunes completed/invalid).

**`ControllerManager.getAIControllerForAssembly(id)`**: typed accessor returning `AIController | null` for a given assembly ID.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
