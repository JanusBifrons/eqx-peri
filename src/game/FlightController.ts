import * as Matter from 'matter-js';
import { Assembly } from './Assembly';
import { Vector2 } from '../types/GameTypes';
import { ControlInput } from './Controller';

/**
 * Virtual pilot system that issues discrete commands like a human player
 * Uses the same control inputs as keyboard/mouse controls for fair gameplay
 */
export class FlightController {
    private assembly: Assembly;    // Decision thresholds for virtual pilot (smart feathering)
    private readonly THRUST_THRESHOLD = 0.15;        // Minimum force needed to issue thrust command
    private readonly ANGLE_THRESHOLD = 0.08;         // Reduced threshold for more precise control
    private readonly DECISION_INTERVAL = 50;         // Faster decision making for smoother control
    private readonly MAX_ANGULAR_VELOCITY = 2.0;     // Maximum desired angular velocity
    private readonly ANGLE_BRAKE_ZONE = 0.3;         // Start braking when within this angle (radians)
    private readonly VELOCITY_BRAKE_THRESHOLD = 0.5; // Angular velocity threshold for braking
    private lastDecisionTime = 0;
    private currentCommand: ControlInput = { thrust: { x: 0, y: 0 }, torque: 0, fire: false };

    constructor(assembly: Assembly) {
        this.assembly = assembly;
    }    /**
     * Virtual pilot that makes discrete decisions like a human player
     * Issues brief command pulses rather than continuous commands
     */
    private makeDecision(target: Assembly, desiredDistance: number, mode: 'follow' | 'orbit'): void {
        const currentTime = Date.now();

        // Only make decisions at human-like intervals
        if (currentTime - this.lastDecisionTime < this.DECISION_INTERVAL) {
            return;
        }

        this.lastDecisionTime = currentTime;

        // Reset command
        this.currentCommand = { thrust: { x: 0, y: 0 }, torque: 0, fire: false };
        const playerPos = this.assembly.rootBody.position;
        const targetPos = target.rootBody.position;

        // Calculate what direction we need to go (world coordinates)
        let desiredDirection: Vector2;

        if (mode === 'follow') {
            // Follow: get behind the target
            const toTarget = Matter.Vector.normalise(Matter.Vector.sub(targetPos, playerPos));
            const desiredPos = {
                x: targetPos.x - toTarget.x * desiredDistance,
                y: targetPos.y - toTarget.y * desiredDistance
            };
            desiredDirection = Matter.Vector.normalise(Matter.Vector.sub(desiredPos, playerPos));
        } else {
            // Orbit: perpendicular to current position
            const toPlayer = Matter.Vector.sub(playerPos, targetPos);
            const distance = Matter.Vector.magnitude(toPlayer);

            if (distance > desiredDistance + 50) {
                // Too far, move toward target
                desiredDirection = Matter.Vector.normalise(Matter.Vector.sub(targetPos, playerPos));
            } else if (distance < desiredDistance - 50) {
                // Too close, move away from target
                desiredDirection = Matter.Vector.normalise(Matter.Vector.sub(playerPos, targetPos));
            } else {
                // Good distance, move tangentially for orbit
                const normalized = Matter.Vector.normalise(toPlayer);
                desiredDirection = { x: -normalized.y, y: normalized.x }; // Perpendicular
            }
        }

        // Convert world direction to ship-local coordinates
        const shipAngle = this.assembly.rootBody.angle;
        const localDirection = {
            x: desiredDirection.x * Math.cos(-shipAngle) - desiredDirection.y * Math.sin(-shipAngle),
            y: desiredDirection.x * Math.sin(-shipAngle) + desiredDirection.y * Math.cos(-shipAngle)
        };

        // Decide on thrust (discrete like keyboard input)
        if (Math.abs(localDirection.x) > this.THRUST_THRESHOLD) {
            if (localDirection.x > 0) {
                this.currentCommand.thrust.x = 1.0; // Forward thrust
            } else {
                this.currentCommand.thrust.x = -0.5; // Reverse thrust (like 'S' key)
            }
        }

        if (Math.abs(localDirection.y) > this.THRUST_THRESHOLD) {
            // Side thrust is not standard in the player controls, but we'll allow it for AI
            this.currentCommand.thrust.y = Math.sign(localDirection.y) * 0.5;
        }        // Smart rotation control with feathering based on angular velocity and angle error
        const targetAngle = mode === 'follow' ?
            Math.atan2(targetPos.y - playerPos.y, targetPos.x - playerPos.x) :
            Math.atan2(desiredDirection.y, desiredDirection.x);

        const currentAngle = this.assembly.rootBody.angle;
        const currentAngularVel = this.assembly.rootBody.angularVelocity;

        let angleError = targetAngle - currentAngle;

        // Normalize angle error
        while (angleError > Math.PI) angleError -= 2 * Math.PI;
        while (angleError < -Math.PI) angleError += 2 * Math.PI;

        // Smart feathering logic
        this.currentCommand.torque = this.calculateSmartTorque(angleError, currentAngularVel);

        // Decide on firing (for now, don't fire during navigation)
        this.currentCommand.fire = false;
    }

    /**
     * Follow a target like a human pilot would
     */
    followTarget(target: Assembly, desiredDistance: number = 150): ControlInput {
        this.makeDecision(target, desiredDistance, 'follow');
        return { ...this.currentCommand };
    }

    /**
     * Orbit a target like a human pilot would
     */
    orbitTarget(target: Assembly, orbitDistance: number = 200): ControlInput {
        this.makeDecision(target, orbitDistance, 'orbit');
        return { ...this.currentCommand };
    }

    /**
     * Calculate smart torque with feathering based on current angular velocity and angle error
     * This mimics how a skilled pilot would feather the controls for smooth rotation
     */
    private calculateSmartTorque(angleError: number, currentAngularVel: number): number {
        // If angle error is very small, don't apply any torque
        if (Math.abs(angleError) < this.ANGLE_THRESHOLD) {
            return 0;
        }

        // Determine the direction we want to turn
        const desiredDirection = Math.sign(angleError);

        // Check if we're approaching the target angle and need to start braking
        const approachingTarget = Math.abs(angleError) < this.ANGLE_BRAKE_ZONE;

        // Check if we're rotating too fast in the desired direction
        const rotatingTooFast = Math.abs(currentAngularVel) > this.MAX_ANGULAR_VELOCITY;

        // Check if we're rotating in the wrong direction or need to brake
        const needsCounterRotation = (desiredDirection > 0 && currentAngularVel < -this.VELOCITY_BRAKE_THRESHOLD) ||
            (desiredDirection < 0 && currentAngularVel > this.VELOCITY_BRAKE_THRESHOLD);

        // If we're approaching the target and rotating fast, apply counter-torque to brake
        if (approachingTarget && Math.abs(currentAngularVel) > this.VELOCITY_BRAKE_THRESHOLD) {
            // Apply braking torque (opposite to current velocity)
            return -Math.sign(currentAngularVel) * 1.0;
        }

        // If we're rotating too fast in the desired direction, don't add more torque
        if (rotatingTooFast && Math.sign(currentAngularVel) === desiredDirection) {
            return 0;
        }

        // If we need counter-rotation (wrong direction), apply full torque
        if (needsCounterRotation) {
            return desiredDirection * 1.0;
        }

        // Normal case: apply torque in the desired direction if not rotating too fast
        if (Math.abs(currentAngularVel) < this.MAX_ANGULAR_VELOCITY) {
            return desiredDirection * 1.0;
        }

        // Default: no torque
        return 0;
    }
}
