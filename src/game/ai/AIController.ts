import { Assembly } from '../core/Assembly';
import { Controller, ControlInput } from './Controller';
import { Vector2, ENTITY_DEFINITIONS, AIOrder } from '../../types/GameTypes';

// ─── Steering constants ────────────────────────────────────────────────────
const MAX_SPEED    = 3.0;  // world units / physics frame (base)
const ARRIVAL_RADIUS = 250; // distance at which arrive-steering begins braking
const FIRING_RANGE   = 500; // max range at which weapons can fire
const AIM_READY_THRESHOLD = 0.25; // rad (~14°) — weapon considered on-target below this

// How long (ms) the AI keeps a recent attacker as priority target.
const ATTACKER_PRIORITY_MS = 8000;

// ─── Move order constants ────────────────────────────────────────────────────
/** Distance (world units) at which a move order is considered reached. */
const MOVE_ARRIVAL_THRESHOLD = 60;
/** Braking ramp distance for move orders (arrive-steering tapers speed within this). */
const MOVE_ARRIVAL_RADIUS = 300;

// ─── Formation & coordination constants ─────────────────────────────────────

/** Minimum distance between friendly ships before separation steering kicks in. */
const SEPARATION_RADIUS = 150;
/** Strength of the separation steering force (0–1 scale, applied as thrust). */
const SEPARATION_STRENGTH = 0.4;

/**
 * Angular spacing (radians) between friendly ships orbiting the same target.
 * Ships are assigned evenly-spaced formation slots around the target.
 */
const FORMATION_ARC_SPACING = Math.PI / 3; // 60° between ships

/**
 * Team power balance threshold: a ship only retreats individually when the
 * team-level power ratio is also below this value.  Prevents one damaged ship
 * from fleeing while the team is winning.
 */
const TEAM_RETREAT_THRESHOLD = 0.85;

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

    // ── Formation & team coordination ────────────────────────────────────
    /** Friendly ships on the same team (updated each frame by ControllerManager). */
    private friendlies: Assembly[] = [];
    /** This ship's formation slot index among friendlies sharing the same target. */
    private formationSlotIndex = 0;
    /** Total number of friendlies sharing this ship's current target. */
    private formationSlotCount = 1;
    /** Team-level power ratio (ownTeamPower / enemyTeamPower), set by ControllerManager. */
    private teamPowerRatio = 1.0;

    // ── Move order ────────────────────────────────────────────────────────
    private moveOrder: AIOrder | null = null;

    constructor(assembly: Assembly) {
        super(assembly);
    }

    setTarget(target: Assembly): void {
        this.target = target;
    }

    setAggressionLevel(level: number): void {
        this.aggressionLevel = Math.max(0.1, Math.min(2.0, level));
    }

    /** Called by ControllerManager each frame with same-team assemblies. */
    setFriendlies(friendlies: Assembly[]): void {
        this.friendlies = friendlies;
    }

    /** Called by ControllerManager each frame with the overall team power balance. */
    setTeamPowerRatio(ratio: number): void {
        this.teamPowerRatio = ratio;
    }

    /** Called by ControllerManager each frame with this ship's formation slot. */
    setFormationSlot(index: number, total: number): void {
        this.formationSlotIndex = index;
        this.formationSlotCount = total;
    }

    /** Expose the current target for formation slot computation. */
    getTarget(): Assembly | undefined {
        return this.target;
    }

    /** Set a move/attack/patrol order. Replaces any existing order. */
    setOrder(order: AIOrder | null): void {
        this.moveOrder = order;
    }

    /** Get the current active order, or null if none. */
    getOrder(): AIOrder | null {
        return this.moveOrder;
    }

    /** Human-readable label for the current combat state, used by the renderer. */
    getCombatStateLabel(): string {
        if (this.moveOrder) return 'MOVING';
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

        // ── Move order takes priority over combat ──────────────────────────
        if (this.moveOrder && this.moveOrder.type === 'move') {
            return this.getMoveOrderInput(this.moveOrder.targetPosition);
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

        // Team-aware retreat: a ship should only retreat if BOTH its individual
        // matchup is bad AND the team overall is not winning.  This prevents
        // one damaged ship from fleeing while its allies are dominating.
        const shouldRetreat = (condition: boolean): boolean => {
            if (!condition) return false;
            // Always retreat if nearly dead regardless of team status
            if (ownHealth < RETREAT_HEALTH_THRESHOLD * 0.5) return true;
            // If the team is winning overall, stay and fight (unless critically low HP)
            if (this.teamPowerRatio >= TEAM_RETREAT_THRESHOLD) return false;
            return true;
        };

        // Retreat immediately if critically damaged AND team isn't dominating.
        if (ownHealth < RETREAT_HEALTH_THRESHOLD && this.combatState !== CombatState.RETREAT) {
            if (shouldRetreat(true)) {
                this.setCombatState(CombatState.RETREAT);
                return;
            }
        }

        switch (this.combatState) {
            case CombatState.SIZING_UP: {
                if (Date.now() - this.sizingUpStartTime >= SIZING_UP_DURATION_MS) {
                    if      (powerRatio >= POWER_RATIO_PURSUE)  this.setCombatState(CombatState.PURSUE);
                    else if (shouldRetreat(powerRatio <= POWER_RATIO_RETREAT)) this.setCombatState(CombatState.RETREAT);
                    else                                         this.setCombatState(CombatState.ENGAGE);
                }
                break;
            }
            case CombatState.ENGAGE: {
                if      (powerRatio >= POWER_RATIO_PURSUE)  this.setCombatState(CombatState.PURSUE);
                else if (shouldRetreat(powerRatio <= POWER_RATIO_RETREAT)) this.setCombatState(CombatState.RETREAT);
                break;
            }
            case CombatState.PURSUE: {
                if      (shouldRetreat(powerRatio <= POWER_RATIO_RETREAT))  this.setCombatState(CombatState.RETREAT);
                else if (powerRatio <  POWER_RATIO_PURSUE)   this.setCombatState(CombatState.ENGAGE);
                break;
            }
            case CombatState.RETREAT: {
                // Re-engage if the individual or team balance tips in our favour.
                const teamWinning = this.teamPowerRatio >= POWER_RATIO_PURSUE;
                const individualWinning = powerRatio >= POWER_RATIO_PURSUE && ownHealth > RETREAT_HEALTH_THRESHOLD;
                if (individualWinning || (teamWinning && ownHealth > RETREAT_HEALTH_THRESHOLD)) {
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
        // Gentle dampening simulates internal dampeners — ships decelerate
        // noticeably over 1–2 seconds rather than stopping on a dime.
        // Active braking thrust in engagementThrust() does the heavy lifting;
        // dampening just prevents infinite drift from rounding errors.
        //
        //   holding:     dampenFactor 0.99 + lateralDampenFactor 0.98 — gentle
        //                drag; at 60 Hz speed is ~0.55× after 1 s, ~0.30× after 2 s.
        //   approaching: dampenFactor 1.0  + lateralDampenFactor 0.96 — forward
        //                speed preserved for closing; lateral drift slowly suppressed.
        //   No dampening during RETREAT — every m/s of escape speed matters.
        const dampen = this.combatState !== CombatState.RETREAT;
        const dampenFactor        = holdingPosition ? 0.99 : 1.0;
        const lateralDampenFactor = holdingPosition ? 0.98 : 0.96;

        // Suppress fire during the sizing-up window — let the ships approach and
        // let weapon tracking settle before the fight begins.
        const fire = this.combatState !== CombatState.SIZING_UP
            && this.hasWeaponsReadyToFire(distance);

        return { thrust, torque: this.calculateRotation(heading), fire, dampen, dampenFactor, lateralDampenFactor, angularDampen: true, angularDampenFactor: 0.98, targetAngle: heading };
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
     *
     * When multiple friendlies share the same target, each ship is assigned a
     * formation slot — an angular offset around the target — so they spread out
     * instead of stacking on top of each other.
     */
    private approachThrust(preferredRange: number, speedMult = 1.0): Vector2 {
        const myPos = this.assembly.rootBody.position;
        const tgPos = this.target!.rootBody.position;
        const myVel = this.assembly.rootBody.velocity;

        const sep    = { x: myPos.x - tgPos.x, y: myPos.y - tgPos.y };

        // Formation offset: rotate the desired standoff position around the
        // target so that friendlies spread evenly.  Slot 0 takes the direct
        // approach angle; subsequent slots fan out symmetrically.
        const baseAngle = Math.atan2(sep.y, sep.x);
        const formationAngle = baseAngle + this.getFormationAngleOffset();

        const desired = {
            x: tgPos.x + Math.cos(formationAngle) * preferredRange,
            y: tgPos.y + Math.sin(formationAngle) * preferredRange,
        };

        const toDes = { x: desired.x - myPos.x, y: desired.y - myPos.y };
        const dist  = Math.sqrt(toDes.x * toDes.x + toDes.y * toDes.y);

        const topSpeed  = MAX_SPEED * this.aggressionLevel * speedMult;
        const spTarget  = topSpeed * Math.min(1, dist / ARRIVAL_RADIUS);
        const norm      = dist > 0.1 ? { x: toDes.x / dist, y: toDes.y / dist } : { x: 0, y: 0 };
        const desVel    = { x: norm.x * spTarget, y: norm.y * spTarget };

        // Blend in separation steering to avoid friendly collisions.
        const sepSteer = this.computeSeparationSteering();

        const steering = {
            x: desVel.x - myVel.x + sepSteer.x,
            y: desVel.y - myVel.y + sepSteer.y,
        };
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
     * In-combat distance correction with active braking.
     * Inside the ±120-unit dead-band around preferredRange, the ship applies
     * retro-thrust (thrust opposing current velocity) to decelerate naturally
     * using its engines rather than relying on artificial dampening.
     * Outside the band, small radial corrections push toward the preferred range.
     */
    private engagementThrust(distance: number, preferredRange: number): Vector2 {
        const DEAD_BAND = 120;
        const distError = distance - preferredRange;

        const myPos = this.assembly.rootBody.position;
        const tgPos = this.target!.rootBody.position;
        const myVel = this.assembly.rootBody.velocity;

        // Separation force from nearby friendlies — always active during engagement.
        const sepSteer = this.computeSeparationSteering();
        const sepMag = Math.sqrt(sepSteer.x * sepSteer.x + sepSteer.y * sepSteer.y);

        // Inside dead-band: apply braking thrust against current velocity so the
        // ship decelerates using its engines (physics-correct) rather than
        // having velocity zeroed out by dampening.
        if (Math.abs(distError) < DEAD_BAND) {
            // If separation force is active, prioritise it over braking.
            if (sepMag > 0.01) {
                const nose = this.assembly.rootBody.angle;
                const fwd = Math.max(0, sepSteer.x * Math.cos(nose) + sepSteer.y * Math.sin(nose));
                return { x: Math.min(0.5, fwd), y: 0 };
            }

            const speed = Math.sqrt(myVel.x * myVel.x + myVel.y * myVel.y);
            if (speed < 0.5) return { x: 0, y: 0 }; // already near-stationary

            // Desired direction: opposite to current velocity (retrograde)
            const brakeDir = { x: -myVel.x / speed, y: -myVel.y / speed };
            const nose     = this.assembly.rootBody.angle;
            // Project retrograde onto ship's forward axis (can only thrust forward)
            const fwd      = Math.max(0, brakeDir.x * Math.cos(nose) + brakeDir.y * Math.sin(nose));
            // Scale by speed — stronger braking when faster, tapering to zero
            const brakeMag = Math.min(0.6, speed / MAX_SPEED);
            return { x: fwd * brakeMag, y: 0 };
        }

        const sep    = { x: myPos.x - tgPos.x, y: myPos.y - tgPos.y };
        const sepMagR = Math.sqrt(sep.x * sep.x + sep.y * sep.y) || 1;
        const radial = { x: sep.x / sepMagR, y: sep.y / sepMagR };

        // Blend radial correction with formation offset — nudge tangentially
        // toward this ship's assigned formation slot.
        const formationOffset = this.getFormationAngleOffset();
        const currentAngle = Math.atan2(sep.y, sep.x);
        const desiredAngle = currentAngle + formationOffset;
        // Tangential direction toward the formation slot
        const tangent = { x: -Math.sin(desiredAngle), y: Math.cos(desiredAngle) };
        const angleDiff = this.wrapAngle(desiredAngle - currentAngle);
        const tangentStrength = Math.min(0.3, Math.abs(angleDiff)) * Math.sign(angleDiff);

        const radialVel    = myVel.x * radial.x + myVel.y * radial.y;
        const CORR_SPEED   = MAX_SPEED * 0.35;
        const desRadialVel = distError > 0 ? -CORR_SPEED : +CORR_SPEED;
        const correction   = desRadialVel - radialVel;

        // Combine radial correction + tangential formation drift + separation
        const wDir = {
            x: radial.x * (correction > 0 ? 1 : -1) + tangent.x * tangentStrength + sepSteer.x,
            y: radial.y * (correction > 0 ? 1 : -1) + tangent.y * tangentStrength + sepSteer.y,
        };
        const wDirMag = Math.sqrt(wDir.x * wDir.x + wDir.y * wDir.y) || 1;

        const tMag  = Math.min(0.45, (Math.abs(correction) / MAX_SPEED) + Math.abs(tangentStrength) + sepMag * 0.5);
        if (tMag < 0.02) return { x: 0, y: 0 };

        const nose  = this.assembly.rootBody.angle;
        const fwd   = Math.max(0, (wDir.x / wDirMag) * Math.cos(nose) + (wDir.y / wDirMag) * Math.sin(nose));
        return { x: fwd * tMag, y: 0 };
    }

    // ── Formation & separation ─────────────────────────────────────────────

    /**
     * Computes an angular offset for this ship's formation slot.  Ships sharing
     * the same target are spaced symmetrically: slot 0 at the base angle,
     * subsequent slots fan out alternating left/right.
     */
    private getFormationAngleOffset(): number {
        if (this.formationSlotCount <= 1) return 0;
        // Center the formation: slots fan out symmetrically from the middle.
        // E.g. 3 ships → offsets: -60°, 0°, +60°
        const centeredIndex = this.formationSlotIndex - (this.formationSlotCount - 1) / 2;
        return centeredIndex * FORMATION_ARC_SPACING;
    }

    /**
     * Separation steering: produces a world-space force vector pushing this
     * ship away from any friendly that is within SEPARATION_RADIUS.  Strength
     * increases as ships get closer (inverse-linear falloff).
     */
    private computeSeparationSteering(): Vector2 {
        const myPos = this.assembly.rootBody.position;
        let fx = 0, fy = 0;

        for (const ally of this.friendlies) {
            if (ally.id === this.assembly.id || ally.destroyed) continue;
            const dx = myPos.x - ally.rootBody.position.x;
            const dy = myPos.y - ally.rootBody.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < SEPARATION_RADIUS && dist > 1) {
                // Inverse-linear: full strength at dist=0, zero at SEPARATION_RADIUS
                const strength = SEPARATION_STRENGTH * (1 - dist / SEPARATION_RADIUS);
                fx += (dx / dist) * strength;
                fy += (dy / dist) * strength;
            }
        }

        return { x: fx, y: fy };
    }

    /** Wrap an angle to [-π, π]. */
    private wrapAngle(a: number): number {
        while (a >  Math.PI) a -= 2 * Math.PI;
        while (a < -Math.PI) a += 2 * Math.PI;
        return a;
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
        // Quick reject: if target is beyond the longest weapon's range, skip per-weapon checks
        if (distanceToTarget > FIRING_RANGE * 2) return false;
        const weapons = this.assembly.entities.filter(e => e.canFire() && !e.destroyed);
        return weapons.some(w => {
            // Per-weapon range check — use the weapon's defined range, fall back to FIRING_RANGE
            const weaponRange = ENTITY_DEFINITIONS[w.type].weaponRange ?? FIRING_RANGE;
            const targetPos = this.assembly.weaponTargetPositions.get(w.id)
                ?? this.target?.rootBody.position;
            if (!targetPos) return false;

            // Check distance from this weapon to its target
            const dx = targetPos.x - w.body.position.x;
            const dy = targetPos.y - w.body.position.y;
            const distToTarget = Math.sqrt(dx * dx + dy * dy);
            if (distToTarget > weaponRange) return false;

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

    // ── Move order steering ─────────────────────────────────────────────

    /**
     * Arrive-steering toward a fixed world position.
     *
     * Uses a single unified approach: compute `desiredVelocity` (toward target,
     * speed tapered by distance), then `steering = desired − current`.  The
     * ship always faces the steering vector direction and thrusts forward.
     *
     * This naturally handles all phases:
     *   - Far away: steering ≈ toward target → accelerate.
     *   - Approaching fast: desired is small, current is large →
     *     steering ≈ −velocity (retrograde) → ship flips and brakes.
     *   - Near and slow: steering ≈ toward target gently → nudge in.
     *
     * Uses the same dampening system as the player (dampen + angularDampen
     * flags on ControlInput, processed in ControllerManager.applyInput).
     *
     * The order only clears when truly on-target and nearly stationary.
     */
    private getMoveOrderInput(target: Vector2): ControlInput {
        const myPos = this.assembly.rootBody.position;
        const myVel = this.assembly.rootBody.velocity;

        const dx = target.x - myPos.x;
        const dy = target.y - myPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const speed = Math.sqrt(myVel.x * myVel.x + myVel.y * myVel.y);

        // Shared dampening — same values the player uses.
        const baseDampen = {
            dampen: true,
            dampenFactor: 0.985,
            angularDampen: true,
            angularDampenFactor: 0.98,
        };

        // Only complete when truly on top of the target AND nearly stationary.
        if (dist < MOVE_ARRIVAL_THRESHOLD && speed < 0.15) {
            this.moveOrder = null;
            return { thrust: { x: 0, y: 0 }, torque: 0, fire: false, ...baseDampen };
        }

        const topSpeed = MAX_SPEED * this.aggressionLevel;

        // Desired velocity: toward target, magnitude tapered by distance.
        // As dist → 0, desiredSpeed → 0, so steering naturally becomes
        // the negative of current velocity (i.e. retrograde braking).
        const desiredSpeed = topSpeed * Math.min(1, dist / MOVE_ARRIVAL_RADIUS);
        const toTarget = dist > 0.1
            ? { x: dx / dist, y: dy / dist }
            : { x: 0, y: 0 };
        const desVel = { x: toTarget.x * desiredSpeed, y: toTarget.y * desiredSpeed };

        // Steering = desired − current.  This single vector encodes both
        // "accelerate toward target" and "brake against current velocity".
        const steer = { x: desVel.x - myVel.x, y: desVel.y - myVel.y };
        const stMag = Math.sqrt(steer.x * steer.x + steer.y * steer.y);

        if (stMag < 0.001) {
            return { thrust: { x: 0, y: 0 }, torque: 0, fire: false, ...baseDampen };
        }

        // Face the steering direction.  When braking, this IS retrograde.
        const heading = Math.atan2(steer.y, steer.x);
        const nose = this.assembly.rootBody.angle;
        const angVel = this.assembly.rootBody.angularVelocity;

        // How far off the nose is from the desired heading.
        let headingError = heading - nose;
        while (headingError >  Math.PI) headingError -= 2 * Math.PI;
        while (headingError < -Math.PI) headingError += 2 * Math.PI;

        // When nearly stationary: rotate first, THEN thrust.
        // This avoids the S-curve caused by thrusting while the nose is
        // still swinging into alignment.  Once moving, thrust dynamically
        // since corrections are unavoidable anyway.
        const isStationary = speed < 0.3;
        const isAligned = Math.abs(headingError) < 0.15; // ~8.5°
        const isStillRotating = Math.abs(angVel) > 0.005;

        if (isStationary && (!isAligned || isStillRotating)) {
            // Pure rotation — no thrust until pointed at target and rotation settled.
            return {
                thrust: { x: 0, y: 0 },
                torque: this.calculateRotation(heading),
                fire: false,
                ...baseDampen,
            };
        }

        // Thrust magnitude: proportional to steering magnitude, capped at 1.
        const tMag = Math.min(1.0, stMag / topSpeed);

        // Project onto ship's forward axis (ships can only thrust forward).
        const steerNormX = steer.x / stMag;
        const steerNormY = steer.y / stMag;
        const fwd = Math.max(0, steerNormX * Math.cos(nose) + steerNormY * Math.sin(nose));

        return {
            thrust: { x: fwd * tMag, y: 0 },
            torque: this.calculateRotation(heading),
            fire: false,
            ...baseDampen,
        };
    }

    private getIdleInput(): ControlInput {
        // Same dampening as the player — idle AI ships stay alive, not dead scrap.
        return {
            thrust: { x: 0, y: 0 }, torque: 0, fire: false,
            dampen: true, dampenFactor: 0.985,
            angularDampen: true, angularDampenFactor: 0.98,
        };
    }
}
