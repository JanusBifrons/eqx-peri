import { Assembly } from '../core/Assembly';
import { Controller, ControlInput } from './Controller';
import { Vector2 } from '../../types/GameTypes';

// Maximum cruising speed used by the arrive steering behaviour (world units / frame).
// Ships will accelerate up to this speed when far from the desired position and
// decelerate back toward zero as they arrive, giving natural braking in zero-friction space.
const MAX_SPEED = 3.0;

// Distance from the desired position at which the ship starts throttling down.
// At this range the desired speed equals MAX_SPEED; at 0 distance desired speed is 0.
const ARRIVAL_RADIUS = 250;

export class AIController extends Controller {
    private target?: Assembly;
    private lastTargetScanTime: number = 0;
    private readonly targetScanInterval: number = 500;
    private aggressionLevel: number = 1.0;
    private readonly preferredRange: number = 400; // Standoff distance from target

    constructor(assembly: Assembly) {
        super(assembly);
    }

    setTarget(target: Assembly): void {
        this.target = target;
    }

    setAggressionLevel(level: number): void {
        this.aggressionLevel = Math.max(0.1, Math.min(2.0, level));
    }

    update(_deltaTime: number): ControlInput {
        const currentTime = Date.now();

        if (currentTime - this.lastTargetScanTime > this.targetScanInterval) {
            this.scanForTargets();
            this.lastTargetScanTime = currentTime;
        }

        if (!this.target || this.target.destroyed) {
            return this.getIdleInput();
        }

        return this.getCombatInput();
    }

    private scanForTargets(): void {
        // Targets are supplied via setAvailableTargets; nothing to do here
    }

    setAvailableTargets(targets: Assembly[]): void {
        if (!this.target || this.target.destroyed) {
            const enemies = targets.filter(t => t.team !== this.assembly.team && !t.destroyed);
            if (enemies.length > 0) {
                this.target = this.findClosestTarget(enemies);
            }
        }
    }

    private findClosestTarget(targets: Assembly[]): Assembly {
        let closest = targets[0];
        let closestDist = this.distanceTo(closest);
        for (let i = 1; i < targets.length; i++) {
            const d = this.distanceTo(targets[i]);
            if (d < closestDist) { closest = targets[i]; closestDist = d; }
        }
        return closest;
    }

    private distanceTo(target: Assembly): number {
        const dx = target.rootBody.position.x - this.assembly.rootBody.position.x;
        const dy = target.rootBody.position.y - this.assembly.rootBody.position.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private getIdleInput(): ControlInput {
        return { thrust: { x: 0, y: 0 }, torque: 0, fire: false };
    }

    private getCombatInput(): ControlInput {
        if (!this.target) return this.getIdleInput();

        const myPos = this.assembly.rootBody.position;
        const targetPos = this.target.rootBody.position;
        const distance = this.distanceTo(this.target);
        const angleToTarget = Math.atan2(targetPos.y - myPos.y, targetPos.x - myPos.x);

        return {
            thrust: this.arriveThrust(),
            torque: this.calculateRotation(angleToTarget),
            fire: this.shouldFire(distance, angleToTarget),
            targetAngle: angleToTarget,
        };
    }

    /**
     * Arrive steering with dead reckoning for zero-friction space.
     *
     * Algorithm:
     *   1. Compute a desired position at preferredRange from the target along the
     *      current separation axis (so the ship holds its attack angle).
     *   2. Compute a desired velocity pointing at that position, scaled down as
     *      the ship gets within ARRIVAL_RADIUS (natural braking).
     *   3. Steering = desiredVelocity − currentVelocity. This accounts for
     *      current momentum so the ship actively decelerates instead of looping.
     *   4. Convert the world-space steering vector to ship-local coordinates
     *      (applyThrust expects local space, where +X = forward along ship nose).
     */
    private arriveThrust(): Vector2 {
        const myPos = this.assembly.rootBody.position;
        const targetPos = this.target!.rootBody.position;
        const myVel = this.assembly.rootBody.velocity;

        // --- Desired world position: stand off at preferredRange ---
        const sep = { x: myPos.x - targetPos.x, y: myPos.y - targetPos.y };
        const sepMag = Math.sqrt(sep.x * sep.x + sep.y * sep.y) || 1;
        const desiredPos = {
            x: targetPos.x + (sep.x / sepMag) * this.preferredRange,
            y: targetPos.y + (sep.y / sepMag) * this.preferredRange,
        };

        // --- Desired velocity: taper speed toward zero as we arrive ---
        const toDesired = { x: desiredPos.x - myPos.x, y: desiredPos.y - myPos.y };
        const dist = Math.sqrt(toDesired.x * toDesired.x + toDesired.y * toDesired.y);

        const speedTarget = MAX_SPEED * this.aggressionLevel * Math.min(1, dist / ARRIVAL_RADIUS);
        const toDesiredNorm = dist > 0.1
            ? { x: toDesired.x / dist, y: toDesired.y / dist }
            : { x: 0, y: 0 };
        const desiredVel = { x: toDesiredNorm.x * speedTarget, y: toDesiredNorm.y * speedTarget };

        // --- Steering = velocity error (dead reckoning) ---
        const steering = { x: desiredVel.x - myVel.x, y: desiredVel.y - myVel.y };
        const steeringMag = Math.sqrt(steering.x * steering.x + steering.y * steering.y);
        if (steeringMag < 0.001) return { x: 0, y: 0 };

        // Scale thrust magnitude 0-1 relative to MAX_SPEED
        const thrustMag = Math.min(1.0, steeringMag / MAX_SPEED);
        const worldThrust = {
            x: (steering.x / steeringMag) * thrustMag,
            y: (steering.y / steeringMag) * thrustMag,
        };

        // --- Convert world thrust → ship-local coordinates ---
        // applyThrust rotates its input by shipAngle to get world force,
        // so we must supply the inverse-rotated vector here.
        const a = -this.assembly.rootBody.angle;
        return {
            x: worldThrust.x * Math.cos(a) - worldThrust.y * Math.sin(a),
            y: worldThrust.x * Math.sin(a) + worldThrust.y * Math.cos(a),
        };
    }

    private calculateRotation(angleToTarget: number): number {
        const currentAngle = this.assembly.rootBody.angle;
        let angleDiff = angleToTarget - currentAngle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        return angleDiff * 2.0; // Proportional — clamped by Assembly.applyTorque
    }

    private shouldFire(distance: number, angleToTarget: number): boolean {
        if (distance > 500) return false;
        const currentAngle = this.assembly.rootBody.angle;
        let angleDiff = Math.abs(angleToTarget - currentAngle);
        while (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
        return angleDiff < Math.PI / 6; // 30-degree firing cone
    }
}
