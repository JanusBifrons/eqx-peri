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
        maxSpeed: 30,
        turnRate: 0, // No turning
        fuel: 8, // 8 seconds of flight
        proximityRadius: 0, // No proximity detection
        launcherSize: 'small'
    },
    [MissileType.HEAT_SEEKER]: {
        type: MissileType.HEAT_SEEKER,
        damage: 25, // Medium damage
        speed: 25,
        maxSpeed: 35,
        turnRate: 2.0, // Good turning ability
        fuel: 10, // 10 seconds of fuel
        proximityRadius: 150, // 150 pixel detection radius
        launcherSize: 'small'
    },
    [MissileType.GUIDED]: {
        type: MissileType.GUIDED,
        damage: 35, // High-medium damage
        speed: 20,
        maxSpeed: 40,
        turnRate: 3.0, // Excellent turning ability
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
    public fuelRemaining: number; public age: number = 0;
    public destroyed: boolean = false;

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
        this.fuelRemaining = this.config.fuel;

        // Create missile body
        const size = this.getMissileSize();
        this.body = Matter.Bodies.rectangle(position.x, position.y, size.width, size.height, {
            mass: 5, // Light but not too light
            frictionAir: 0.01, // Slight air resistance
            angle: initialAngle,
            render: {
                fillStyle: this.getMissileColor(),
                strokeStyle: '#ffffff',
                lineWidth: 1
            }
        });

        // Mark as missile
        (this.body as any).isMissile = true;
        (this.body as any).missile = this;
        (this.body as any).sourceAssemblyId = sourceAssemblyId;

        // Set initial velocity
        const initialVelocity = {
            x: Math.cos(initialAngle) * this.config.speed,
            y: Math.sin(initialAngle) * this.config.speed
        };
        Matter.Body.setVelocity(this.body, initialVelocity);
    }

    public update(deltaTime: number, availableTargets: Assembly[]): void {
        if (this.destroyed) return; this.age += deltaTime;
        this.fuelRemaining -= deltaTime;

        // Check if out of fuel
        if (this.fuelRemaining <= 0) {
            this.destroy();
            return;
        }

        // Apply missile behavior based on type
        switch (this.config.type) {
            case MissileType.TORPEDO:
                this.updateTorpedo(deltaTime);
                break;
            case MissileType.HEAT_SEEKER:
                this.updateHeatSeeker(deltaTime, availableTargets);
                break;
            case MissileType.GUIDED:
                this.updateGuided(deltaTime);
                break;
        }

        // Limit speed
        this.limitSpeed();
    }
    private updateTorpedo(_deltaTime: number): void {
        // Torpedoes just fly straight - no steering needed
        // They maintain their initial velocity
    }

    private updateHeatSeeker(deltaTime: number, availableTargets: Assembly[]): void {
        // Find nearest target within proximity radius
        let nearestTarget: Assembly | null = null;
        let nearestDistance = this.config.proximityRadius;

        for (const target of availableTargets) {
            if (target.id === this.sourceAssemblyId || target.destroyed) continue;

            const distance = this.getDistanceToTarget(target);
            if (distance < nearestDistance) {
                nearestTarget = target;
                nearestDistance = distance;
            }
        }

        if (nearestTarget) {
            this.steerTowardsTarget(nearestTarget, deltaTime);
        }
    }

    private updateGuided(deltaTime: number): void {
        if (this.targetAssembly && !this.targetAssembly.destroyed) {
            this.steerTowardsTarget(this.targetAssembly, deltaTime);
        }
    }

    private steerTowardsTarget(target: Assembly, deltaTime: number): void {
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

        // Apply turning
        const maxTurn = this.config.turnRate * deltaTime;
        const turnAmount = Math.max(-maxTurn, Math.min(maxTurn, angleDiff));

        const newAngle = currentAngle + turnAmount;
        Matter.Body.setAngle(this.body, newAngle);

        // Apply thrust in the direction we're facing
        const thrustForce = {
            x: Math.cos(newAngle) * this.config.speed * 0.1,
            y: Math.sin(newAngle) * this.config.speed * 0.1
        };
        Matter.Body.applyForce(this.body, this.body.position, thrustForce);
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
    } public getDamage(): number {
        return this.config.damage;
    }
}
