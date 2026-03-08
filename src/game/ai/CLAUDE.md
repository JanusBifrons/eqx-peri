# /src/game/ai — Control & Decision-Making

`Controller` (base/interfaces), `PlayerController`, `AIController`, `FlightController`, `ControllerManager`.

## Rules

- `Controller` is the abstract base; `PlayerController` and `AIController` extend it.
- `FlightController` handles player-assist movement (orbit/follow modes for spectating). Combat AI logic lives directly in `AIController`.
- Target acquisition updates every 500 ms; engagement range is 400 units (`FIRING_RANGE`).
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
| `SIZING_UP` | 600 | 0.65× | 0.88 approach / 0.80 holding | **no** | weapons-optimal |
| `ENGAGE` | 400 | 1.0× | 0.88 approach / 0.80 holding | yes | weapons-optimal |
| `PURSUE` | 250 | 1.45× | 0.88 always | yes | weapons-optimal |
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
- **Per-weapon fire readiness**: `AIController.hasWeaponsReadyToFire()` replaces the old ship-nose-angle cone check. It returns `true` when at least one weapon (a) has the target inside its aiming arc (`Assembly.canWeaponAimAtTarget`) **and** (b) has its turret tracked to within `AIM_READY_THRESHOLD` (0.25 rad ≈ 14°) of its `targetAimAngle`. This means AI waits for lock-on before firing, just as a player would.
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

**Axis-decomposed inertial dampening** (`ControllerManager.applyInput`): when `ControlInput.lateralDampenFactor` is set, velocity is split into forward (along ship nose) and lateral (perpendicular) components. The lateral component is multiplied by `lateralDampenFactor` every physics frame; the forward component by `dampenFactor` (default 1.0 = untouched). AI sets `lateralDampenFactor = 0.80` when holding position and `0.88` when approaching — at 60 Hz this kills orbital drift to <0.1% of its value within 0.5 s without significantly penalising closing speed. Player inputs leave `lateralDampenFactor` unset, using the original uniform-factor path (backward compatible).

**Dead-band**: `engagementThrust()` additionally uses a ±60-unit dead-band around `preferredRange` where zero thrust is applied. Outside the band, only small radial corrections (capped at 35% of max thrust) are issued, preventing new lateral velocity generation when holding position.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
