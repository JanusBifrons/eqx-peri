import * as Matter from 'matter-js';
import { Vector2 } from '../types/GameTypes';
import { Assembly } from './Assembly';

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
        speed: 30,
        maxSpeed: 30, // Increased max speed for torpedoes
        turnRate: 0, // No turning
        fuel: 8, // 8 seconds of flight
        proximityRadius: 0, // No proximity detection
        launcherSize: 'small'
    },    [MissileType.HEAT_SEEKER]: {
        type: MissileType.HEAT_SEEKER,
        damage: 25, // Medium damage
        speed: 25,
        maxSpeed: 50, // Much higher max speed for heat seekers
        turnRate: 4.0, // Higher turning ability to prevent orbiting
        fuel: 10, // 10 seconds of fuel
        proximityRadius: 100000, // Very large detection range for space combat
        launcherSize: 'small'
    },
    [MissileType.GUIDED]: {
        type: MissileType.GUIDED,
        damage: 35, // High-medium damage
        speed: 20,
        maxSpeed: 55, // Highest max speed for guided missiles
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
    public destroyed: boolean = false;
    public hasTarget: boolean = false; // Track if missile has acquired a target
    public launchCollisionDelay: number = 0.5; // 0.5 seconds before missile can collide with its source

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
        Matter.Body.setVelocity(this.body, initialVelocity);

        // Move missile slightly forward to prevent immediate collision with source
        const separationDistance = 20; // Move 20 pixels away from launch point
        const separationOffset = {
            x: Math.cos(initialAngle) * separationDistance,
            y: Math.sin(initialAngle) * separationDistance
        };
        Matter.Body.setPosition(this.body, {
            x: position.x + separationOffset.x,
            y: position.y + separationOffset.y
        });
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
        // Torpedoes fly straight with gradual velocity increase
        
        const launchPhase = 0.3;
        let targetSpeed = 8.0; // Much faster initial speed
        
        if (this.age > launchPhase) {
            targetSpeed = 25.0; // Much faster steady cruising speed
        }
        
        // Gradually adjust velocity toward target speed (linear acceleration)
        const currentSpeed = Math.sqrt(this.body.velocity.x ** 2 + this.body.velocity.y ** 2);
        const speedDiff = targetSpeed - currentSpeed;
        const acceleration = speedDiff * 0.4; // Much faster acceleration rate
        
        // Apply velocity change in current direction
        const velocityMagnitude = Math.sqrt(this.body.velocity.x ** 2 + this.body.velocity.y ** 2) || 1;
        const velocityDirection = {
            x: this.body.velocity.x / velocityMagnitude,
            y: this.body.velocity.y / velocityMagnitude
        };
        
        const newVelocity = {
            x: this.body.velocity.x + velocityDirection.x * acceleration,
            y: this.body.velocity.y + velocityDirection.y * acceleration
        };
        
        Matter.Body.setVelocity(this.body, newVelocity);
    }private updateHeatSeeker(deltaTime: number, availableTargets: Assembly[]): void {
        // Heat seekers have 4-phase behavior:
        // Phase 1 (0-0.3s): Launch acceleration - get up to speed, no seeking
        // Phase 2 (0.3-1.0s): Cruise and search for targets
        // Phase 3 (target acquired): Full throttle pursuit
        // Phase 4 (target lost): Return to cruise
          const launchPhase = 0.8; // Longer launch phase for predictable behavior
        
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
        }        // Determine speed based on phase and target status
        let targetSpeed = 8.0; // Base speed when no target
        let shouldAccelerate = true; // Whether to apply acceleration
        
        if (this.age < launchPhase) {
            // Launch phase - fast initial movement
            targetSpeed = 15.0; // Faster launch speed
        } else if (this.hasTarget) {
            // Target acquired - speed based on distance to target and aiming accuracy
            const distanceToTarget = this.getDistanceToTarget(nearestTarget!);
            
            // Calculate how well we're aiming at the target
            const targetPos = nearestTarget!.rootBody.position;
            const missilePos = this.body.position;
            const dx = targetPos.x - missilePos.x;
            const dy = targetPos.y - missilePos.y;
            const targetAngle = Math.atan2(dy, dx);
            const currentAngle = this.body.angle;
            let angleDiff = targetAngle - currentAngle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            // Only accelerate if we're pointing roughly toward the target (within 45 degrees)
            const aimingAccuracy = Math.abs(angleDiff);
            shouldAccelerate = aimingAccuracy < Math.PI / 4; // 45 degrees
            
            if (distanceToTarget > 150) {
                // Far from target - full speed if aiming correctly
                targetSpeed = shouldAccelerate ? 45.0 : 15.0;
            } else {
                // Close to target - reduce speed regardless
                const slowdownFactor = distanceToTarget / 150;
                targetSpeed = 15.0 + (20.0 * slowdownFactor); // 15.0 to 35.0 speed range
            }
            
            // Apply steering
            this.steerTowardsTarget(nearestTarget!, deltaTime);
        } else {
            // No target found - cruise speed
            targetSpeed = 25.0;
        }
        
        // Only apply acceleration if we should accelerate
        if (shouldAccelerate) {
            const currentSpeed = Math.sqrt(this.body.velocity.x ** 2 + this.body.velocity.y ** 2);
            const speedDiff = targetSpeed - currentSpeed;
            const acceleration = speedDiff * 0.12; // Moderate acceleration rate
            
            // Apply velocity change in current direction
            const velocityMagnitude = Math.sqrt(this.body.velocity.x ** 2 + this.body.velocity.y ** 2) || 1;
            const velocityDirection = {
                x: this.body.velocity.x / velocityMagnitude || Math.cos(this.body.angle),
                y: this.body.velocity.y / velocityMagnitude || Math.sin(this.body.angle)
            };
            
            const newVelocity = {
                x: this.body.velocity.x + velocityDirection.x * acceleration,
                y: this.body.velocity.y + velocityDirection.y * acceleration
            };
            
            Matter.Body.setVelocity(this.body, newVelocity);
        }
    }    private updateGuided(deltaTime: number, availableTargets: Assembly[]): void {
        // Guided missiles have similar behavior to heat seekers but with locked targets:
        // Phase 1 (0-0.3s): Launch acceleration - get up to speed
        // Phase 2 (0.3s+): Check for valid target
        // Phase 3 (valid target): Full throttle pursuit
        // Phase 4 (no target): Cruise straight like torpedo
        
        const launchPhase = 0.8; // Longer launch phase for predictable behavior
          let validTarget = false;
        if (this.age > launchPhase && this.targetAssembly && !this.targetAssembly.destroyed && this.targetAssembly.team !== -1) {
            // Also check that it's not the same team
            const sourceAssembly = availableTargets.find(a => a.id === this.sourceAssemblyId);
            if (!sourceAssembly || this.targetAssembly.team !== sourceAssembly.team) {
                validTarget = true;
            }
        }
        
        // Update target acquisition status
        this.hasTarget = validTarget;        // Determine speed based on phase and target status
        let targetSpeed = 8.0; // Base speed when no target
        let shouldAccelerate = true; // Whether to apply acceleration
        
        if (this.age < launchPhase) {
            // Launch phase - fast initial movement
            targetSpeed = 15.0; // Faster launch speed
        } else if (this.hasTarget) {
            // Target locked - speed based on distance to target and aiming accuracy
            const distanceToTarget = this.getDistanceToTarget(this.targetAssembly!);
            
            // Calculate how well we're aiming at the target
            const targetPos = this.targetAssembly!.rootBody.position;
            const missilePos = this.body.position;
            const dx = targetPos.x - missilePos.x;
            const dy = targetPos.y - missilePos.y;
            const targetAngle = Math.atan2(dy, dx);
            const currentAngle = this.body.angle;
            let angleDiff = targetAngle - currentAngle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            // Only accelerate if we're pointing roughly toward the target (within 45 degrees)
            const aimingAccuracy = Math.abs(angleDiff);
            shouldAccelerate = aimingAccuracy < Math.PI / 4; // 45 degrees
            
            if (distanceToTarget > 150) {
                // Far from target - full speed if aiming correctly
                targetSpeed = shouldAccelerate ? 50.0 : 15.0; // Higher top speed for guided missiles
            } else {
                // Close to target - reduce speed regardless
                const slowdownFactor = distanceToTarget / 150;
                targetSpeed = 15.0 + (25.0 * slowdownFactor); // 15.0 to 40.0 speed range
            }
            
            // Apply steering
            this.steerTowardsTarget(this.targetAssembly!, deltaTime);
        } else {
            // No target - cruise speed
            targetSpeed = 25.0;
        }
        
        // Only apply acceleration if we should accelerate
        if (shouldAccelerate) {
            const currentSpeed = Math.sqrt(this.body.velocity.x ** 2 + this.body.velocity.y ** 2);
            const speedDiff = targetSpeed - currentSpeed;
            const acceleration = speedDiff * 0.12; // Moderate acceleration rate
            
            // Apply velocity change in current direction
            const velocityMagnitude = Math.sqrt(this.body.velocity.x ** 2 + this.body.velocity.y ** 2) || 1;
            const velocityDirection = {
                x: this.body.velocity.x / velocityMagnitude || Math.cos(this.body.angle),
                y: this.body.velocity.y / velocityMagnitude || Math.sin(this.body.angle)
            };
            
            const newVelocity = {
                x: this.body.velocity.x + velocityDirection.x * acceleration,
                y: this.body.velocity.y + velocityDirection.y * acceleration
            };            
            Matter.Body.setVelocity(this.body, newVelocity);
        }
    }    private steerTowardsTarget(target: Assembly, _deltaTime: number): void {
        const targetPos = target.rootBody.position;
        const missilePos = this.body.position;

        // Calculate desired direction
        const dx = targetPos.x - missilePos.x;
        const dy = targetPos.y - missilePos.y;
        const targetAngle = Math.atan2(dy, dx);

        // Calculate current angle
        const currentAngle = this.body.angle;

        // Calculate angle difference
        let angleDiff = targetAngle - currentAngle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        // Apply angular velocity for smooth physics-based turning
        const maxAngularVelocity = this.config.turnRate;
        const desiredAngularVelocity = Math.max(-maxAngularVelocity, Math.min(maxAngularVelocity, angleDiff * 8)); // Higher responsiveness multiplier
        Matter.Body.setAngularVelocity(this.body, desiredAngularVelocity);
        
        // Apply thrust in the direction the missile is turning towards
        const currentSpeed = Math.sqrt(this.body.velocity.x ** 2 + this.body.velocity.y ** 2);
        const steeringForce = 0.4; // Increased steering force
        
        // Calculate thrust direction (blend current velocity with target direction)
        const currentVelAngle = Math.atan2(this.body.velocity.y, this.body.velocity.x);
        let thrustAngle = currentVelAngle + angleDiff * steeringForce;
        
        // Apply velocity in the thrust direction
        const thrustMagnitude = currentSpeed * 0.15; // Increased steering thrust
        const thrustX = Math.cos(thrustAngle) * thrustMagnitude;
        const thrustY = Math.sin(thrustAngle) * thrustMagnitude;
        
        // Add steering force to current velocity
        const newVelocity = {
            x: this.body.velocity.x + thrustX,
            y: this.body.velocity.y + thrustY
        };
        
        Matter.Body.setVelocity(this.body, newVelocity);
        
        // Debug log for steering (reduce frequency)
        if (Math.floor(this.age * 60) % 120 === 0) { // Less frequent logging
            console.log(`🎯 Missile steering: angleDiff=${(angleDiff * 180 / Math.PI).toFixed(1)}°, angVel=${desiredAngularVelocity.toFixed(2)}`);
        }
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
    }

    public getDamage(): number {
        return this.config.damage;
    }
}
