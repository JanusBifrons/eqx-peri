import * as Matter from 'matter-js';
import { Vector2 } from '../../types/GameTypes';
import { Assembly } from '../core/Assembly';

export enum MissileType {
    TORPEDO = 'torpedo',        // Flies straight, high damage, no tracking
    HEAT_SEEKER = 'heat_seeker', // Tracks nearest enemy
    GUIDED = 'guided'           // Tracks locked target
}

export interface MissileConfig {
    type: MissileType;
    damage: number;
    speed: number;
    maxSpeed: number;
    turnRate: number; // radians per second
    fuel: number; // seconds of fuel
    proximityRadius: number; // detection radius for heat seekers
    launcherSize: 'small' | 'large' | 'capital';
}

export const MISSILE_CONFIGS: Record<MissileType, MissileConfig> = {
    [MissileType.TORPEDO]: {
        type: MissileType.TORPEDO,
        damage: 50, // High damage
        speed: 35,
        maxSpeed: 35, // Slightly faster torpedoes
        turnRate: 0, // No turning
        fuel: 8, // 8 seconds of flight
        proximityRadius: 0, // No proximity detection
        launcherSize: 'small'
    },    [MissileType.HEAT_SEEKER]: {
        type: MissileType.HEAT_SEEKER,
        damage: 25, // Medium damage
        speed: 30,
        maxSpeed: 60, // Higher max speed for better intercept
        turnRate: 4.0, // Higher turning ability to prevent orbiting
        fuel: 10, // 10 seconds of fuel
        proximityRadius: 100000, // Very large detection range for space combat
        launcherSize: 'small'
    },
    [MissileType.GUIDED]: {
        type: MissileType.GUIDED,
        damage: 35, // High-medium damage
        speed: 25,
        maxSpeed: 65, // Fastest missiles for precision strikes
        turnRate: 5.0, // Even higher turning ability for guided missiles
        fuel: 15, // 15 seconds of fuel
        proximityRadius: 0, // Uses locked target
        launcherSize: 'small'
    }
};

export class Missile {
    public body: Matter.Body;
    public config: MissileConfig;
    public sourceAssemblyId: string;
    public targetAssembly: Assembly | null = null;
    public fuelRemaining: number; 
    public age: number = 0;
    public destroyed: boolean = false;    public hasTarget: boolean = false; // Track if missile has acquired a target
    public launchCollisionDelay: number = 0.5; // 0.5 seconds before missile can collide with its source
    
    // Miss recovery tracking
    private lastDistanceToTarget: number = Infinity;
    private closestApproachDistance: number = Infinity;
    private missRecoveryTimer: number = 0;
    private inMissRecovery: boolean = false;
    private readonly MISS_DETECTION_DISTANCE = 200; // Distance threshold to detect close approach
    private readonly MISS_RECOVERY_DURATION = 2.0; // Seconds to fly past before aggressive steering

    constructor(
        position: Vector2,
        initialAngle: number,
        missileType: MissileType,
        sourceAssemblyId: string,
        targetAssembly?: Assembly
    ) {
        this.config = { ...MISSILE_CONFIGS[missileType] };
        this.sourceAssemblyId = sourceAssemblyId;
        this.targetAssembly = targetAssembly || null;
        this.fuelRemaining = this.config.fuel;        // Create missile body with no friction for realistic space physics
        const size = this.getMissileSize();
        this.body = Matter.Bodies.rectangle(position.x, position.y, size.width, size.height, {
            mass: 2, // Lighter for better maneuverability
            frictionAir: 0, // No air resistance in space
            inertia: 0.5, // Lower moment of inertia for quicker rotation
            angle: initialAngle,
            // Enable Matter.js Continuous Collision Detection for high-speed bodies
            // @ts-ignore - bullet is a valid Matter.js option but not in the TypeScript definitions
            bullet: true,
            collisionFilter: {
                category: 0x0004, // Missile collision category
                mask: 0x0001 | 0x0002, // Can collide with default bodies and other missiles, but not source assembly initially
                group: 0 // No collision group
            },
            render: {
                fillStyle: this.getMissileColor(),
                strokeStyle: '#ffffff',
                lineWidth: 1
            }
        });

        // Mark as missile
        (this.body as any).isMissile = true;
        (this.body as any).missile = this;
        (this.body as any).sourceAssemblyId = sourceAssemblyId;        // Set initial velocity for proper missile launch with separation from source
        const initialSpeed = 4.0; // Faster initial speed to clear the launching ship
        const initialVelocity = {
            x: Math.cos(initialAngle) * initialSpeed,
            y: Math.sin(initialAngle) * initialSpeed
        };
        Matter.Body.setVelocity(this.body, initialVelocity);        // Move missile slightly forward to prevent immediate collision with source
        const separationDistance = 20; // Move 20 pixels away from launch point
        const separationOffset = {
            x: Math.cos(initialAngle) * separationDistance,
            y: Math.sin(initialAngle) * separationDistance
        };
        Matter.Body.setPosition(this.body, {
            x: position.x + separationOffset.x,
            y: position.y + separationOffset.y
        });
        
        // Initialize miss tracking
        this.lastDistanceToTarget = Infinity;
        this.closestApproachDistance = Infinity;
        this.missRecoveryTimer = 0;
        this.inMissRecovery = false;
    }

    public update(deltaTime: number, availableTargets: Assembly[]): void {
        if (this.destroyed) return; this.age += deltaTime;
        this.fuelRemaining -= deltaTime;

        // Check if out of fuel
        if (this.fuelRemaining <= 0) {
            this.destroy();
            return;
        }        // Apply missile behavior based on type
        switch (this.config.type) {
            case MissileType.TORPEDO:
                this.updateTorpedo(deltaTime);
                break;
            case MissileType.HEAT_SEEKER:
                this.updateHeatSeeker(deltaTime, availableTargets);
                break;            case MissileType.GUIDED:
                this.updateGuided(deltaTime, availableTargets);
                break;
        }

        // Limit speed
        this.limitSpeed();
    }    private updateTorpedo(_deltaTime: number): void {
        // Torpedoes fly straight with realistic acceleration profile
        
        const launchPhase = 0.5; // Half second launch phase
        let targetSpeed: number;
        
        if (this.age < launchPhase) {
            // Launch phase - build up speed quickly
            targetSpeed = 20.0;
        } else {
            // Cruise phase - high speed straight flight
            targetSpeed = 35.0;
        }
        
        // Calculate current speed
        const currentSpeed = Math.sqrt(this.body.velocity.x ** 2 + this.body.velocity.y ** 2);
        
        // Only accelerate if below target speed
        if (currentSpeed < targetSpeed) {
            const speedDiff = targetSpeed - currentSpeed;
            const thrustMagnitude = Math.min(speedDiff * 0.4, 4.0); // Strong acceleration for torpedoes
            
            // Apply thrust in the direction the torpedo is facing
            const thrustDirection = {
                x: Math.cos(this.body.angle),
                y: Math.sin(this.body.angle)
            };
            
            const thrustForce = {
                x: thrustDirection.x * thrustMagnitude,
                y: thrustDirection.y * thrustMagnitude
            };
            
            // Add thrust to current velocity
            const newVelocity = {
                x: this.body.velocity.x + thrustForce.x,
                y: this.body.velocity.y + thrustForce.y
            };
            
            Matter.Body.setVelocity(this.body, newVelocity);
        }
    }private updateHeatSeeker(_deltaTime: number, availableTargets: Assembly[]): void {
        // Heat seekers have 2-phase behavior:
        // Phase 1 (0-0.3s): Launch acceleration - get up to speed, no seeking
        // Phase 2 (0.3s+): Search for targets and track them
          const launchPhase = 0.3; // Shorter launch phase
        
        let nearestTarget: Assembly | null = null;
        let nearestDistance = this.config.proximityRadius;        // Only search for targets after launch phase
        if (this.age > launchPhase) {
            // Reduce console spam - only log every 60 frames (1 second at 60fps)
            const shouldLog = Math.floor(this.age * 60) % 60 === 0;
            
            if (shouldLog) {
                console.log(`🔍 Heat seeker ${this.body.id} searching, available targets: ${availableTargets.length}`);
                console.log(`🚀 Missile source assembly: ${this.sourceAssemblyId}`);
            }
            
            // Find the source assembly to get its team
            const sourceAssembly = availableTargets.find(a => a.id === this.sourceAssemblyId);
            const sourceTeam = sourceAssembly ? sourceAssembly.team : -1;
            
            if (shouldLog) {
                console.log(`🏁 Source team: ${sourceTeam}`);
            }
            
            for (const target of availableTargets) {
                if (shouldLog) {
                    console.log(`  Checking target ${target.id} (team ${target.team}, destroyed: ${target.destroyed})`);
                }
                
                // Skip if it's the source assembly or destroyed
                if (target.id === this.sourceAssemblyId || target.destroyed) {
                    if (shouldLog) {
                        console.log(`    ❌ Skipped - source assembly or destroyed`);
                    }
                    continue;
                }
                
                // Skip debris (team -1)
                if (target.team === -1) {
                    if (shouldLog) {
                        console.log(`    ❌ Skipped - debris (team -1)`);
                    }
                    continue;
                }
                
                // Skip targets on the same team as the source assembly
                if (target.team === sourceTeam) {
                    if (shouldLog) {
                        console.log(`    ❌ Skipped - same team as source (${sourceTeam})`);
                    }
                    continue;
                }
                
                const distance = this.getDistanceToTarget(target);
                
                if (shouldLog) {
                    console.log(`    ✓ Valid enemy target ${target.id} team ${target.team} at distance ${distance.toFixed(0)}px`);
                }
                
                if (distance < nearestDistance) {
                    nearestTarget = target;
                    nearestDistance = distance;
                    if (shouldLog) {
                        console.log(`    🎯 New nearest target!`);
                    }
                }            }
            
            if (nearestTarget && shouldLog) {
                console.log(`🎯 Heat seeker locked onto target ${nearestTarget.id} at ${nearestDistance.toFixed(0)}px`);
            } else if (shouldLog) {
                console.log(`❌ Heat seeker found no targets within ${this.config.proximityRadius}px`);
            }}
        
        // Update target acquisition status and current target for debugging
        this.hasTarget = nearestTarget !== null;
        // For heat seekers, store the current target for debug visualization
        if (this.config.type === MissileType.HEAT_SEEKER) {
            this.targetAssembly = nearestTarget;
        }        // Simple speed control and steering
        this.updateMissileMovement(nearestTarget, this.age < launchPhase);
    }

    private updateGuided(_deltaTime: number, availableTargets: Assembly[]): void {
        // Guided missiles have similar behavior to heat seekers but with locked targets:
        // Phase 1 (0-0.3s): Launch acceleration - get up to speed
        // Phase 2 (0.3s+): Check for valid target and track it
        
        const launchPhase = 0.3; // Shorter launch phase
          let validTarget = false;
        if (this.age > launchPhase && this.targetAssembly && !this.targetAssembly.destroyed && this.targetAssembly.team !== -1) {
            // Also check that it's not the same team
            const sourceAssembly = availableTargets.find(a => a.id === this.sourceAssemblyId);
            if (!sourceAssembly || this.targetAssembly.team !== sourceAssembly.team) {
                validTarget = true;
            }
        }
        
        // Update target acquisition status
        this.hasTarget = validTarget;

        // Simple speed control and steering
        const currentTarget = validTarget ? this.targetAssembly : null;
        this.updateMissileMovement(currentTarget, this.age < launchPhase);
    }    /**
     * Unified movement logic for all missile types with targets
     * Simple logic: only accelerate when pointing roughly towards target or when target is very close
     * Added miss recovery logic to create elliptical attack patterns
     */
    private updateMissileMovement(target: Assembly | null, isLaunchPhase: boolean): void {
        // Update miss recovery timer
        if (this.inMissRecovery) {
            this.missRecoveryTimer -= 1/60; // Assuming 60 FPS
            if (this.missRecoveryTimer <= 0) {
                this.inMissRecovery = false;
                this.closestApproachDistance = Infinity; // Reset for next approach
                
                // Debug log recovery end
                if (Math.floor(this.age * 60) % 60 === 0) {
                    console.log(`🔄 Missile ${this.body.id} ending miss recovery - turning back for another attack`);
                }
            }
        }
        
        // Track distance to target for miss detection
        if (target && !isLaunchPhase) {
            const currentDistance = this.getDistanceToTarget(target);
            
            // Update closest approach distance
            if (currentDistance < this.closestApproachDistance) {
                this.closestApproachDistance = currentDistance;
            }
            
            // Detect if we're moving away from target after a close approach (miss detection)
            if (!this.inMissRecovery && 
                this.closestApproachDistance < this.MISS_DETECTION_DISTANCE && 
                currentDistance > this.lastDistanceToTarget + 10 && // Moving away with some threshold
                currentDistance > this.closestApproachDistance + 50) { // Significantly further than closest approach
                
                // Start miss recovery phase
                this.inMissRecovery = true;
                this.missRecoveryTimer = this.MISS_RECOVERY_DURATION;
                
                // Debug log miss detection
                console.log(`❌ Missile ${this.body.id} detected miss - closest approach: ${this.closestApproachDistance.toFixed(0)}, current distance: ${currentDistance.toFixed(0)}, entering recovery phase for ${this.MISS_RECOVERY_DURATION}s`);
            }
            
            this.lastDistanceToTarget = currentDistance;
        }
        
        // Determine target speed based on phase and target status
        let targetSpeed: number;
        
        if (isLaunchPhase) {
            // Launch phase - moderate initial speed to clear launching ship
            targetSpeed = 18.0;
        } else if (target) {
            // Target acquired - high speed pursuit
            targetSpeed = 55.0;
        } else {
            // No target - cruise at moderate speed
            targetSpeed = 35.0;
        }
        
        // Apply steering and acceleration logic
        let shouldAccelerate = true;
        if (target && !isLaunchPhase) {
            // Calculate angle to target for acceleration decision
            const targetPos = target.rootBody.position;
            const missilePos = this.body.position;
            const dx = targetPos.x - missilePos.x;
            const dy = targetPos.y - missilePos.y;
            const distanceToTarget = Math.sqrt(dx * dx + dy * dy);
            const targetAngle = Math.atan2(dy, dx);
              let angleError = targetAngle - this.body.angle;
            while (angleError > Math.PI) angleError -= 2 * Math.PI;
            while (angleError < -Math.PI) angleError += 2 * Math.PI;
            
            // Modify behavior during miss recovery
            let alignmentThreshold: number;
            let emergencyDistance: number;
            let steeringAuthority: number;
            
            if (this.inMissRecovery) {
                // During miss recovery: much tighter steering constraints to fly past
                alignmentThreshold = 0.08; // ~4.5 degrees - very tight
                emergencyDistance = 80; // Only steer aggressively when very close
                steeringAuthority = 0.4; // Reduced steering authority
                shouldAccelerate = Math.abs(angleError) < alignmentThreshold || distanceToTarget < emergencyDistance;
            } else {
                // Normal behavior
                alignmentThreshold = 0.3; // ~17 degrees
                emergencyDistance = 150; // Close distance for emergency acceleration
                steeringAuthority = 1.0; // Full steering authority
                shouldAccelerate = Math.abs(angleError) < alignmentThreshold || distanceToTarget < emergencyDistance;
            }
            
            const finalApproachAngle = 0.15; // ~8.5 degrees - small angle for final approach corrections
            
            // Apply steering with different intensities based on situation
            if (shouldAccelerate && Math.abs(angleError) < finalApproachAngle) {
                // Final approach - allow gentle steering corrections while accelerating
                this.steerTowardsTarget(target, 0, 0.3 * steeringAuthority); // Reduced steering authority for fine adjustments
            } else {
                // Normal steering when not accelerating or large angle error
                this.steerTowardsTarget(target, 0, steeringAuthority); // Steering authority based on recovery state
            }
            
            // Debug logging
            if (Math.floor(this.age * 60) % 120 === 0) {
                const steeringMode = (shouldAccelerate && Math.abs(angleError) < finalApproachAngle) ? "gentle" : "full";
                const recoveryStatus = this.inMissRecovery ? `RECOVERY(${this.missRecoveryTimer.toFixed(1)}s)` : "normal";
                console.log(`🚀 Missile: angleError=${(angleError * 180 / Math.PI).toFixed(1)}°, distance=${distanceToTarget.toFixed(0)}, accelerating=${shouldAccelerate}, steering=${steeringMode}, status=${recoveryStatus}`);
            }
        }
        
        // Calculate current speed
        const currentSpeed = Math.sqrt(this.body.velocity.x ** 2 + this.body.velocity.y ** 2);
        
        // Only accelerate if we should and we're below target speed
        if (shouldAccelerate && currentSpeed < targetSpeed) {
            const speedDiff = targetSpeed - currentSpeed;
            const thrustMagnitude = Math.min(speedDiff * 0.4, 4.0);
            
            // Apply thrust in the direction the missile is facing (like a real rocket)
            const thrustDirection = {
                x: Math.cos(this.body.angle),
                y: Math.sin(this.body.angle)
            };
            
            const thrustForce = {
                x: thrustDirection.x * thrustMagnitude,
                y: thrustDirection.y * thrustMagnitude
            };
            
            // Add thrust to current velocity
            const newVelocity = {
                x: this.body.velocity.x + thrustForce.x,
                y: this.body.velocity.y + thrustForce.y
            };
            
            Matter.Body.setVelocity(this.body, newVelocity);        }
    }

    private steerTowardsTarget(target: Assembly, _deltaTime: number, steeringMultiplier: number = 1.0): void {
        const targetPos = target.rootBody.position;
        const missilePos = this.body.position;

        // Calculate desired direction to target
        const dx = targetPos.x - missilePos.x;
        const dy = targetPos.y - missilePos.y;
        const targetAngle = Math.atan2(dy, dx);

        // Get current state
        const currentAngle = this.body.angle;
        const currentAngularVel = this.body.angularVelocity;

        // Calculate angle error (same as FlightController)
        let angleError = targetAngle - currentAngle;
        while (angleError > Math.PI) angleError -= 2 * Math.PI;
        while (angleError < -Math.PI) angleError += 2 * Math.PI;        // Use the same smart torque calculation as FlightController
        const torqueInput = this.calculateSmartTorque(angleError, currentAngularVel) * steeringMultiplier;
        
        // Apply torque using the same method as Assembly
        this.applyTorque(torqueInput);          // Debug log for steering (reduce frequency)
        if (Math.floor(this.age * 60) % 120 === 0) { // Less frequent logging
            const currentSpeed = Math.sqrt(this.body.velocity.x ** 2 + this.body.velocity.y ** 2);
            console.log(`🎯 Missile steering: angleError=${(angleError * 180 / Math.PI).toFixed(1)}°, torque=${torqueInput.toFixed(2)}, angVel=${currentAngularVel.toFixed(3)}, speed=${currentSpeed.toFixed(1)}`);
        }
    }

    /**
     * Smart torque calculation mirrored from FlightController
     * This provides the same smooth, non-oversteering behavior as AI ships
     */
    private calculateSmartTorque(angleError: number, currentAngularVel: number): number {
        // Missile-specific thresholds (slightly more aggressive than ships for quick response)
        const ANGLE_THRESHOLD = 0.03;         // Smaller dead zone for precision
        const MAX_ANGULAR_VELOCITY = 0.08;    // Higher max angular velocity for missiles
        const ANGLE_BRAKE_ZONE = 0.15;        // Start braking closer to target angle
        const VELOCITY_BRAKE_THRESHOLD = 0.03; // Brake threshold
        
        // If angle error is very small, don't apply any torque
        if (Math.abs(angleError) < ANGLE_THRESHOLD) {
            return 0;
        }

        // Determine the direction we want to turn
        const desiredDirection = Math.sign(angleError);

        // Check if we're approaching the target angle and need to start braking
        const approachingTarget = Math.abs(angleError) < ANGLE_BRAKE_ZONE;

        // Check if we're rotating too fast in the desired direction
        const rotatingTooFast = Math.abs(currentAngularVel) > MAX_ANGULAR_VELOCITY;

        // Check if we're rotating in the wrong direction or need to brake
        const needsCounterRotation = (desiredDirection > 0 && currentAngularVel < -VELOCITY_BRAKE_THRESHOLD) ||
            (desiredDirection < 0 && currentAngularVel > VELOCITY_BRAKE_THRESHOLD);

        // If we're approaching the target and rotating fast, apply counter-torque to brake
        if (approachingTarget && Math.abs(currentAngularVel) > VELOCITY_BRAKE_THRESHOLD) {
            // Apply braking torque (opposite to current velocity)
            return -Math.sign(currentAngularVel) * 0.8; // Stronger braking for missiles
        }

        // If we're rotating too fast in the desired direction, don't add more torque
        if (rotatingTooFast && Math.sign(currentAngularVel) === desiredDirection) {
            return 0;
        }

        // If we need counter-rotation (wrong direction), apply full torque
        if (needsCounterRotation) {
            return desiredDirection * 1.0; // Full torque for counter-rotation
        }

        // Normal case: apply torque in the desired direction if not rotating too fast
        if (Math.abs(currentAngularVel) < MAX_ANGULAR_VELOCITY) {
            // Scale torque based on angle error for more precise control
            const torqueScale = Math.min(1.0, Math.abs(angleError) / 0.3); // Full torque for errors > 0.3 radians
            return desiredDirection * 0.8 * torqueScale; // Base torque for missiles
        }

        // Default: no torque
        return 0;
    }

    /**
     * Apply torque using the same method as Assembly for consistent physics
     */
    private applyTorque(torqueInput: number): void {
        if (this.destroyed) return;

        // Use the same torque application method as Assembly
        const currentAngularVelocity = this.body.angularVelocity;
        const maxAngularVelocity = 0.08; // Higher than ships for more agile missiles
        
        // Clamp torque input to prevent over-steering
        const clampedTorque = Math.max(-1.0, Math.min(1.0, torqueInput));
        
        const desiredAngularVelocity = clampedTorque * maxAngularVelocity;
        const dampening = 0.25; // Slightly higher dampening than ships for stability

        const newAngularVelocity = currentAngularVelocity +
            (desiredAngularVelocity - currentAngularVelocity) * dampening;

        Matter.Body.setAngularVelocity(this.body, newAngularVelocity);
    }

    private limitSpeed(): void {
        const velocity = this.body.velocity;
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);

        if (speed > this.config.maxSpeed) {
            const scale = this.config.maxSpeed / speed;
            Matter.Body.setVelocity(this.body, {
                x: velocity.x * scale,
                y: velocity.y * scale
            });
        }
    }

    private getDistanceToTarget(target: Assembly): number {
        const dx = target.rootBody.position.x - this.body.position.x;
        const dy = target.rootBody.position.y - this.body.position.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private getMissileSize(): { width: number, height: number } {
        switch (this.config.launcherSize) {
            case 'small': return { width: 12, height: 4 };
            case 'large': return { width: 16, height: 6 };
            case 'capital': return { width: 20, height: 8 };
            default: return { width: 12, height: 4 };
        }
    }

    private getMissileColor(): string {
        switch (this.config.type) {
            case MissileType.TORPEDO: return '#ffaa00'; // Orange
            case MissileType.HEAT_SEEKER: return '#ff6600'; // Red-orange
            case MissileType.GUIDED: return '#ff3300'; // Red
            default: return '#ffaa00';
        }
    }

    public destroy(): void {
        this.destroyed = true;
    }    // Debug methods for rendering targeting information
    public getCurrentTarget(): Assembly | null {
        return this.targetAssembly;
    }

    public isTrackingTarget(): boolean {
        return this.hasTarget;
    }

    public getMissileType(): MissileType {
        return this.config.type;
    }    public getDamage(): number {
        return this.config.damage;
    }
    
    // Miss recovery debug information
    public isInMissRecovery(): boolean {
        return this.inMissRecovery;
    }
    
    public getMissRecoveryTimeRemaining(): number {
        return this.missRecoveryTimer;
    }
}
