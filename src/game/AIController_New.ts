import { Assembly } from './Assembly';
import { Controller, ControlInput } from './Controller';
import { Vector2 } from '../types/GameTypes';

export class AIController extends Controller {
    private target?: Assembly;
    private lastTargetScanTime: number = 0;
    private targetScanInterval: number = 500; // Scan for targets every 500ms
    private aggressionLevel: number = 1.0; // How aggressive this AI is
    private preferredRange: number = 300; // Preferred combat distance

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

        // Scan for targets periodically
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
        // This would be called by the GameEngine with available targets
        // For now, keep existing target or idle
    }

    setAvailableTargets(targets: Assembly[]): void {
        if (!this.target || this.target.destroyed) {
            // Find closest enemy target
            const enemyTargets = targets.filter(t =>
                t.team !== this.assembly.team &&
                !t.destroyed
            );

            if (enemyTargets.length > 0) {
                this.target = this.findClosestTarget(enemyTargets);
            }
        }
    }

    private findClosestTarget(targets: Assembly[]): Assembly {
        let closest = targets[0];
        let closestDistance = this.getDistanceToTarget(closest);

        for (let i = 1; i < targets.length; i++) {
            const distance = this.getDistanceToTarget(targets[i]);
            if (distance < closestDistance) {
                closest = targets[i];
                closestDistance = distance;
            }
        }

        return closest;
    }

    private getDistanceToTarget(target: Assembly): number {
        const dx = target.rootBody.position.x - this.assembly.rootBody.position.x;
        const dy = target.rootBody.position.y - this.assembly.rootBody.position.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private getIdleInput(): ControlInput {
        return {
            thrust: { x: 0, y: 0 },
            torque: 0,
            fire: false
        };
    }

    private getCombatInput(): ControlInput {
        if (!this.target) return this.getIdleInput();

        const myPos = this.assembly.rootBody.position;
        const targetPos = this.target.rootBody.position;
        const distance = this.getDistanceToTarget(this.target);

        // Calculate angle to target
        const angleToTarget = Math.atan2(
            targetPos.y - myPos.y,
            targetPos.x - myPos.x
        );

        // Calculate movement
        const thrust = this.calculateMovement(distance, angleToTarget);

        // Calculate rotation to face target
        const torque = this.calculateRotation(angleToTarget);

        // Decide whether to fire
        const shouldFire = this.shouldFire(distance, angleToTarget);

        return {
            thrust,
            torque,
            fire: shouldFire,
            targetAngle: angleToTarget
        };
    }

    private calculateMovement(distance: number, angleToTarget: number): Vector2 {
        const thrustPower = 0.01 * this.aggressionLevel;

        if (distance > this.preferredRange * 1.5) {
            // Too far - move closer
            return {
                x: Math.cos(angleToTarget) * thrustPower,
                y: Math.sin(angleToTarget) * thrustPower
            };
        } else if (distance < this.preferredRange * 0.5) {
            // Too close - back away
            return {
                x: -Math.cos(angleToTarget) * thrustPower * 0.5,
                y: -Math.sin(angleToTarget) * thrustPower * 0.5
            };
        } else {
            // Good range - strafe around target
            const strafeAngle = angleToTarget + Math.PI / 2;
            return {
                x: Math.cos(strafeAngle) * thrustPower * 0.3,
                y: Math.sin(strafeAngle) * thrustPower * 0.3
            };
        }
    }

    private calculateRotation(angleToTarget: number): number {
        const currentAngle = this.assembly.rootBody.angle;
        let angleDiff = angleToTarget - currentAngle;

        // Normalize angle difference to [-π, π]
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        // Apply proportional control
        return angleDiff * 2.0;
    }

    private shouldFire(distance: number, angleToTarget: number): boolean {
        if (distance > 500) return false; // Too far to fire effectively

        // Check if we're roughly facing the target
        const currentAngle = this.assembly.rootBody.angle;
        let angleDiff = Math.abs(angleToTarget - currentAngle);
        while (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

        // Fire if we're facing roughly in the right direction
        return angleDiff < Math.PI / 6; // 30 degree cone
    }
}
