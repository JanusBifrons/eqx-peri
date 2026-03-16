import { Assembly } from '../core/Assembly';
import { Controller, ControlInput } from './Controller';
import { Vector2 } from '../../types/GameTypes';

// ─── Steering constants ────────────────────────────────────────────────────
const MAX_SPEED    = 3.0;  // world units / physics frame (base)
const ARRIVAL_RADIUS = 250; // distance at which arrive-steering begins braking
const FIRING_RANGE   = 500; // max range at which weapons can fire
const AIM_READY_THRESHOLD = 0.25; // rad (~14°) — weapon considered on-target below this

// How long (ms) the AI keeps a recent attacker as priority target.
const ATTACKER_PRIORITY_MS = 8000;

// ─── Combat state machine ──────────────────────────────────────────────────

/**
 * Duration of the initial SIZING_UP phase.  Ships approach, assess the power
 * balance, and commit to a behaviour after this window.
 */
const SIZING_UP_DURATION_MS = 2500;

/**
 * HP ratio (own total current HP / total max HP) below which the ship
 * immediately switches to RETREAT regardless of power balance.
 */
const RETREAT_HEALTH_THRESHOLD = 0.30;

/**
 * If ownPower / enemyPower ≥ this, the ship PURSUEs — it has a clear advantage
 * and should close aggressively to press it.
 */
const POWER_RATIO_PURSUE = 1.40;

/**
 * If ownPower / enemyPower ≤ this, the ship REATREATs after sizing up — the
 * enemy is significantly stronger and a slugging match would be suicidal.
 */
const POWER_RATIO_RETREAT = 0.65;

/** Preferred standoff range for each state (world units). */
const RANGE_SIZING_UP = 600; // Hang back just outside firing range while assessing
const RANGE_ENGAGE    = 400; // Standard engagement: slug it out at medium range
const RANGE_PURSUE    = 250; // Aggressive close-in when we have the advantage
const RANGE_RETREAT   = 800; // Back off and create distance when outmatched

/** Speed multipliers applied on top of MAX_SPEED × aggressionLevel. */
const SPEED_SIZING_UP = 0.65; // Measured approach — don't rush in blind
const SPEED_ENGAGE    = 1.00; // Standard combat pace
const SPEED_PURSUE    = 1.45; // Press the advantage at speed
const SPEED_RETREAT   = 1.40; // Flee fast

enum CombatState {
    /** Brief assessment: approach to hold range, evaluate the power balance, then commit. */
    SIZING_UP = 'SIZING_UP',
    /** Roughly matched: hold preferred range, aim weapons, and fight. */
    ENGAGE    = 'ENGAGE',
    /** We have the advantage: close aggressively and press the attack. */
    PURSUE    = 'PURSUE',
    /** Outmatched or badly damaged: flee to safety. */
    RETREAT   = 'RETREAT',
}

export class AIController extends Controller {
    // ── Target tracking ──────────────────────────────────────────────────
    private target?: Assembly;
    private lastTargetScanTime   = 0;
    private readonly targetScanInterval = 500;
    private aggressionLevel = 1.0;

    private lastKnownAttackerId: string | null = null;
    private lastAttackerNoticeTime = 0;

    // ID currently set as assembly.primaryTarget — only updated on change.
    private currentTargetId: string | null = null;

    // ── State machine ─────────────────────────────────────────────────────
    private combatState: CombatState = CombatState.SIZING_UP;
    private sizingUpStartTime = Date.now();
    private lastStateUpdateTime = 0;
    private readonly stateUpdateInterval = 350; // ms between state evaluations

    constructor(assembly: Assembly) {
        super(assembly);
    }

    setTarget(target: Assembly): void {
        this.target = target;
    }

    setAggressionLevel(level: number): void {
        this.aggressionLevel = Math.max(0.1, Math.min(2.0, level));
    }

    /** Human-readable label for the current combat state, used by the renderer. */
    getCombatStateLabel(): string {
        switch (this.combatState) {
            case CombatState.SIZING_UP: return 'SIZING UP';
            case CombatState.ENGAGE:    return 'ENGAGE';
            case CombatState.PURSUE:    return 'PURSUE';
            case CombatState.RETREAT:   return 'RETREAT';
        }
    }

    update(_deltaTime: number): ControlInput {
        const now = Date.now();

        // Sync attacker priority from the damage record written by GameEngine.
        const attackerId = this.assembly.lastHitByAssemblyId;
        if (attackerId && attackerId !== this.lastKnownAttackerId) {
            this.lastKnownAttackerId = attackerId;
            this.lastAttackerNoticeTime = now;
        }

        if (now - this.lastTargetScanTime > this.targetScanInterval) {
            this.validateCurrentTarget();
            this.lastTargetScanTime = now;
        }

        if (!this.target || !this.isValidTarget(this.target)) {
            this.syncTargetLock();
            return this.getIdleInput();
        }

        this.syncTargetLock();

        if (now - this.lastStateUpdateTime > this.stateUpdateInterval) {
            this.updateCombatState();
            this.lastStateUpdateTime = now;
        }

        return this.getCombatInput();
    }

    setAvailableTargets(targets: Assembly[]): void {
        if (this.target && !this.isValidTarget(this.target)) {
            this.target = undefined;
        }

        if (!this.target) {
            const enemies = targets.filter(t => this.isValidTarget(t));
            if (enemies.length > 0) {
                this.target = this.selectBestTarget(enemies);
            }
        }
    }

    // ── Validity & selection ─────────────────────────────────────────────

    private isValidTarget(a: Assembly): boolean {
        return !a.destroyed && a.team !== this.assembly.team && a.hasControlCenter();
    }

    private validateCurrentTarget(): void {
        if (this.target && !this.isValidTarget(this.target)) this.target = undefined;
    }

    private selectBestTarget(enemies: Assembly[]): Assembly {
        const now = Date.now();
        if (
            this.lastKnownAttackerId !== null &&
            now - this.lastAttackerNoticeTime < ATTACKER_PRIORITY_MS
        ) {
            const attacker = enemies.find(e => e.id === this.lastKnownAttackerId);
            if (attacker) return attacker;
        }
        return this.findClosestTarget(enemies);
    }

    private findClosestTarget(targets: Assembly[]): Assembly {
        let best = targets[0];
        let bestDist = this.distanceTo(best);
        for (let i = 1; i < targets.length; i++) {
            const d = this.distanceTo(targets[i]);
            if (d < bestDist) { best = targets[i]; bestDist = d; }
        }
        return best;
    }

    private distanceTo(a: Assembly): number {
        const dx = a.rootBody.position.x - this.assembly.rootBody.position.x;
        const dy = a.rootBody.position.y - this.assembly.rootBody.position.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ── Target lock sync ─────────────────────────────────────────────────

    /**
     * Keeps assembly.primaryTarget in sync with the AI's combat target so that
     * Assembly.updateWeaponAiming() auto-tracks turrets each frame.
     * Also resets the state machine whenever the target changes — every new
     * opponent starts with a fresh SIZING_UP phase.
     */
    private syncTargetLock(): void {
        const newId = this.target?.id ?? null;
        if (newId === this.currentTargetId) return;

        // Target changed — restart assessment
        if (newId !== null) this.setCombatState(CombatState.SIZING_UP);

        this.currentTargetId = newId;
        this.assembly.primaryTarget = this.target ?? null;
    }

    // ── State machine ─────────────────────────────────────────────────────

    private setCombatState(state: CombatState): void {
        if (state === this.combatState) return;
        this.combatState = state;
        if (state === CombatState.SIZING_UP) this.sizingUpStartTime = Date.now();
    }

    /**
     * Evaluates the tactical situation and transitions between combat states.
     *
     * Decision axes:
     *   ownHealth  — own total HP / total max HP across all blocks
     *   powerRatio — own combat power / enemy combat power (weapons × health)
     *
     * Resulting behaviour:
     *   SIZING_UP  → wait 2.5 s, then commit based on power balance
     *   ENGAGE     → slug it out; retreat if health critical or badly outmatched
     *   PURSUE     → press a clear advantage; back off if balance shifts
     *   RETREAT    → flee; only re-engage if enemy is crippled and we're healthy
     */
    private updateCombatState(): void {
        if (!this.target) { this.setCombatState(CombatState.SIZING_UP); return; }

        const ownHealth  = this.getOwnHealthRatio();
        const powerRatio = this.computePowerRatio();

        // Always retreat immediately if critically damaged.
        if (ownHealth < RETREAT_HEALTH_THRESHOLD && this.combatState !== CombatState.RETREAT) {
            this.setCombatState(CombatState.RETREAT);
            return;
        }

        switch (this.combatState) {
            case CombatState.SIZING_UP: {
                if (Date.now() - this.sizingUpStartTime >= SIZING_UP_DURATION_MS) {
                    if      (powerRatio >= POWER_RATIO_PURSUE)  this.setCombatState(CombatState.PURSUE);
                    else if (powerRatio <= POWER_RATIO_RETREAT) this.setCombatState(CombatState.RETREAT);
                    else                                         this.setCombatState(CombatState.ENGAGE);
                }
                break;
            }
            case CombatState.ENGAGE: {
                if      (powerRatio >= POWER_RATIO_PURSUE)  this.setCombatState(CombatState.PURSUE);
                else if (powerRatio <= POWER_RATIO_RETREAT) this.setCombatState(CombatState.RETREAT);
                break;
            }
            case CombatState.PURSUE: {
                if      (powerRatio <= POWER_RATIO_RETREAT)  this.setCombatState(CombatState.RETREAT);
                else if (powerRatio <  POWER_RATIO_PURSUE)   this.setCombatState(CombatState.ENGAGE);
                break;
            }
            case CombatState.RETREAT: {
                // Only re-engage once the balance has tipped strongly in our favour
                // (enemy crippled by our fire while we fled).
                if (powerRatio >= POWER_RATIO_PURSUE && ownHealth > RETREAT_HEALTH_THRESHOLD) {
                    this.setCombatState(CombatState.SIZING_UP);
                }
                break;
            }
        }
    }

    // ── Power / health assessment ─────────────────────────────────────────

    private getOwnHealthRatio(): number {
        const es = this.assembly.entities;
        if (es.length === 0) return 0;
        const cur = es.reduce((s, e) => s + e.health, 0);
        const max = es.reduce((s, e) => s + e.maxHealth, 0);
        return max > 0 ? cur / max : 0;
    }

    /**
     * Estimates an assembly's combat effectiveness from its live weapon blocks,
     * scaled by its overall health ratio.  Heavier weapons count for more so a
     * capital-weapon ship is correctly rated far above a cockpit-only ship.
     */
    private computeCombatPower(a: Assembly): number {
        let power = 0;
        for (const e of a.entities) {
            if (e.destroyed) continue;
            switch (e.type) {
                case 'Gun':                    power += 1.0; break;
                case 'LargeGun':               power += 2.5; break;
                case 'CapitalWeapon':          power += 5.0; break;
                case 'MissileLauncher':        power += 1.5; break;
                case 'LargeMissileLauncher':   power += 3.5; break;
                case 'CapitalMissileLauncher': power += 7.0; break;
                case 'Beam':                   power += 1.5; break;
                case 'LargeBeam':              power += 4.0; break;
                case 'Cockpit':                power += 0.5; break;
                case 'LargeCockpit':           power += 1.0; break;
                case 'CapitalCore':            power += 2.0; break;
                default: break;
            }
        }
        // Scale by health so a badly-damaged ship is rated weaker.
        const cur = a.entities.reduce((s, e) => s + e.health, 0);
        const max = a.entities.reduce((s, e) => s + e.maxHealth, 0);
        const healthRatio = max > 0 ? cur / max : 0;
        return power * healthRatio;
    }

    /** ownPower / enemyPower.  >1 means we are stronger; <1 means enemy is stronger. */
    private computePowerRatio(): number {
        if (!this.target) return 1;
        const own   = this.computeCombatPower(this.assembly);
        const enemy = this.computeCombatPower(this.target);
        if (enemy <= 0) return 99; // unarmed target — pursue freely
        if (own   <= 0) return 0;  // we are unarmed — flee
        return own / enemy;
    }

    // ── Combat input ──────────────────────────────────────────────────────

    private getCombatInput(): ControlInput {
        if (!this.target) return this.getIdleInput();

        const targetPos = this.target.rootBody.position;
        const distance  = this.distanceTo(this.target);
        const preferred = this.statePreferredRange();
        const speedMult = this.stateSpeedMultiplier();

        // RETREAT: face away so forward thrust propels us along the escape vector.
        // All other states: orient weapons toward the target.
        const heading = this.combatState === CombatState.RETREAT
            ? this.computeRetreatHeading()
            : this.computeOptimalHeading(targetPos);

        // Engagement mode (dead-band + small radial corrections) only when holding
        // position in ENGAGE or SIZING_UP within firing range.
        const holdingPosition =
            (this.combatState === CombatState.ENGAGE || this.combatState === CombatState.SIZING_UP)
            && distance < FIRING_RANGE;

        const thrust = this.combatState === CombatState.RETREAT
            ? this.retreatThrust()
            : holdingPosition
                ? this.engagementThrust(distance, preferred)
                : this.approachThrust(preferred, speedMult);

        // Inertial dampening — applied every frame in all states except RETREAT.
        //
        // When holdingPosition the ship should stop and rotate in place rather
        // than orbit.  Full omnidirectional dampening (both forward and lateral)
        // kills residual velocity so the ship decelerates to near-zero within a
        // second and can then aim and fire without drifting.
        //
        //   holding:    dampenFactor 0.82 + lateralDampenFactor 0.82 — kills all
        //               velocity uniformly; at 60 Hz speed is <0.001× in ~0.5 s.
        //   approaching: dampenFactor 1.0 + lateralDampenFactor 0.86 — forward
        //               speed preserved for closing; lateral drift suppressed.
        //   No dampening during RETREAT — every m/s of escape speed matters.
        const dampen = this.combatState !== CombatState.RETREAT;
        const dampenFactor        = holdingPosition ? 0.82 : 1.0;
        const lateralDampenFactor = holdingPosition ? 0.82 : 0.86;

        // Suppress fire during the sizing-up window — let the ships approach and
        // let weapon tracking settle before the fight begins.
        const fire = this.combatState !== CombatState.SIZING_UP
            && this.hasWeaponsReadyToFire(distance);

        return { thrust, torque: this.calculateRotation(heading), fire, dampen, dampenFactor, lateralDampenFactor, targetAngle: heading };
    }

    private statePreferredRange(): number {
        switch (this.combatState) {
            case CombatState.SIZING_UP: return RANGE_SIZING_UP;
            case CombatState.ENGAGE:    return RANGE_ENGAGE;
            case CombatState.PURSUE:    return RANGE_PURSUE;
            case CombatState.RETREAT:   return RANGE_RETREAT;
        }
    }

    private stateSpeedMultiplier(): number {
        switch (this.combatState) {
            case CombatState.SIZING_UP: return SPEED_SIZING_UP;
            case CombatState.ENGAGE:    return SPEED_ENGAGE;
            case CombatState.PURSUE:    return SPEED_PURSUE;
            case CombatState.RETREAT:   return SPEED_RETREAT;
        }
    }

    // ── Heading helpers ───────────────────────────────────────────────────

    /**
     * Ship heading that aligns the weapon battery toward the target.
     * Circular mean of all weapon natural directions gives the heading that
     * minimises total arc usage across the battery.
     * Reduces to angleToTarget for standard all-forward loadouts.
     */
    private computeOptimalHeading(targetPos: Vector2): number {
        const myPos = this.assembly.rootBody.position;
        const angleToTarget = Math.atan2(targetPos.y - myPos.y, targetPos.x - myPos.x);

        const weapons = this.assembly.entities.filter(e => e.canFire() && !e.destroyed);
        if (weapons.length === 0) return angleToTarget;

        let sinSum = 0, cosSum = 0;
        for (const w of weapons) {
            const a = w.rotation * Math.PI / 180;
            sinSum += Math.sin(a);
            cosSum += Math.cos(a);
        }
        return angleToTarget - Math.atan2(sinSum, cosSum);
    }

    /**
     * Heading pointing the nose directly away from the target so that forward
     * thrust moves the ship along the retreat vector.
     */
    private computeRetreatHeading(): number {
        const my = this.assembly.rootBody.position;
        const tg = this.target!.rootBody.position;
        return Math.atan2(my.y - tg.y, my.x - tg.x);
    }

    // ── Thrust helpers ─────────────────────────────────────────────────────

    /**
     * Long-range arrive steering.  Approaches the preferred standoff distance at
     * up to MAX_SPEED × aggressionLevel × speedMult, braking within ARRIVAL_RADIUS.
     * Also used for retreat (large preferredRange pushes the desired position behind
     * the ship, so steering naturally thrusts away once the nose faces rearward).
     */
    private approachThrust(preferredRange: number, speedMult = 1.0): Vector2 {
        const myPos = this.assembly.rootBody.position;
        const tgPos = this.target!.rootBody.position;
        const myVel = this.assembly.rootBody.velocity;

        const sep    = { x: myPos.x - tgPos.x, y: myPos.y - tgPos.y };
        const sepMag = Math.sqrt(sep.x * sep.x + sep.y * sep.y) || 1;
        const desired = {
            x: tgPos.x + (sep.x / sepMag) * preferredRange,
            y: tgPos.y + (sep.y / sepMag) * preferredRange,
        };

        const toDes = { x: desired.x - myPos.x, y: desired.y - myPos.y };
        const dist  = Math.sqrt(toDes.x * toDes.x + toDes.y * toDes.y);

        const topSpeed  = MAX_SPEED * this.aggressionLevel * speedMult;
        const spTarget  = topSpeed * Math.min(1, dist / ARRIVAL_RADIUS);
        const norm      = dist > 0.1 ? { x: toDes.x / dist, y: toDes.y / dist } : { x: 0, y: 0 };
        const desVel    = { x: norm.x * spTarget, y: norm.y * spTarget };

        const steering = { x: desVel.x - myVel.x, y: desVel.y - myVel.y };
        const stMag    = Math.sqrt(steering.x * steering.x + steering.y * steering.y);
        if (stMag < 0.001) return { x: 0, y: 0 };

        const tMag  = Math.min(1.0, stMag / topSpeed);
        const wt    = { x: (steering.x / stMag) * tMag, y: (steering.y / stMag) * tMag };
        const nose  = this.assembly.rootBody.angle;
        const fwd   = Math.max(0, wt.x * Math.cos(nose) + wt.y * Math.sin(nose));
        return { x: fwd, y: 0 };
    }

    /**
     * Full-throttle forward thrust used during RETREAT.
     * No arrive-steering braking — the ship should flee at maximum speed
     * indefinitely.  The nose is already pointed away from the target via
     * computeRetreatHeading(), so {x:1, y:0} drives directly along the
     * escape vector.
     */
    private retreatThrust(): Vector2 {
        return { x: 1.0, y: 0 };
    }

    /**
     * In-combat radial-only distance correction with a dead-band.
     * Zero thrust within ±60 units of preferredRange; only small radial pushes
     * outside that band.  Lateral drift is left to inertial dampening (dampen flag)
     * so the ship doesn't accumulate new orbital velocity while holding position.
     */
    private engagementThrust(distance: number, preferredRange: number): Vector2 {
        const DEAD_BAND = 120; // wider band gives more "stop zone" at preferred range
        const distError = distance - preferredRange;
        if (Math.abs(distError) < DEAD_BAND) return { x: 0, y: 0 };

        const myPos = this.assembly.rootBody.position;
        const tgPos = this.target!.rootBody.position;
        const myVel = this.assembly.rootBody.velocity;

        const sep    = { x: myPos.x - tgPos.x, y: myPos.y - tgPos.y };
        const sepMag = Math.sqrt(sep.x * sep.x + sep.y * sep.y) || 1;
        const radial = { x: sep.x / sepMag, y: sep.y / sepMag };

        const radialVel    = myVel.x * radial.x + myVel.y * radial.y;
        const CORR_SPEED   = MAX_SPEED * 0.35;
        const desRadialVel = distError > 0 ? -CORR_SPEED : +CORR_SPEED;
        const correction   = desRadialVel - radialVel;
        if (Math.abs(correction) < 0.05) return { x: 0, y: 0 };

        const sign  = correction > 0 ? 1 : -1;
        const tMag  = Math.min(0.35, Math.abs(correction) / MAX_SPEED);
        const wDir  = { x: radial.x * sign, y: radial.y * sign };
        const nose  = this.assembly.rootBody.angle;
        const fwd   = Math.max(0, wDir.x * Math.cos(nose) + wDir.y * Math.sin(nose));
        return { x: fwd * tMag, y: 0 };
    }

    // ── Fire readiness ─────────────────────────────────────────────────────

    /**
     * Returns true when at least one weapon has a target in range and its
     * turret is tracked to within AIM_READY_THRESHOLD of that target.
     *
     * With per-weapon independent targeting each weapon may be aimed at a
     * different entity body, so readiness is checked against the per-weapon
     * target stored in assembly.weaponTargetPositions rather than the shared
     * primary-target COM.
     */
    private hasWeaponsReadyToFire(distanceToTarget: number): boolean {
        if (distanceToTarget > FIRING_RANGE) return false;
        const weapons = this.assembly.entities.filter(e => e.canFire() && !e.destroyed);
        return weapons.some(w => {
            // Use the per-weapon target position when available; fall back to
            // the primary target COM so the old single-target path still works.
            const targetPos = this.assembly.weaponTargetPositions.get(w.id)
                ?? this.target?.rootBody.position;
            if (!targetPos) return false;
            if (!this.assembly.canWeaponAimAtTarget(w, targetPos)) return false;
            let err = w.targetAimAngle - w.currentAimAngle;
            while (err >  Math.PI) err -= 2 * Math.PI;
            while (err < -Math.PI) err += 2 * Math.PI;
            return Math.abs(err) < AIM_READY_THRESHOLD;
        });
    }

    // ── Rotation ──────────────────────────────────────────────────────────

    private calculateRotation(targetAngle: number): number {
        let diff = targetAngle - this.assembly.rootBody.angle;
        while (diff >  Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        return diff * 2.0; // proportional — clamped by Assembly.applyTorque
    }

    private getIdleInput(): ControlInput {
        return { thrust: { x: 0, y: 0 }, torque: 0, fire: false };
    }
}
