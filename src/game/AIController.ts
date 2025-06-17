import * as Matter from 'matter-js';
import { Assembly } from './Assembly';
import { Vector2 } from '../types/GameTypes';

export enum AITeam {
    PLAYER = 'player',
    ENEMY_RED = 'enemy_red',
    ENEMY_BLUE = 'enemy_blue'
}

export enum AIBehavior {
    AGGRESSIVE = 'aggressive',
    DEFENSIVE = 'defensive',
    PATROL = 'patrol',
    ESCORT = 'escort'
}

export interface AIState {
    behavior: AIBehavior;
    target: Assembly | null;
    lastTargetUpdate: number;
    lastFireTime: number;
    patrolCenter: Vector2;
    patrolRadius: number;
    patrolAngle: number;
    isEngaging: boolean;
    fleeHealth: number; // Health percentage to start fleeing
}

export class AIController {
    public assembly: Assembly;
    public team: AITeam;
    public state: AIState; private targetUpdateInterval: number = 500; // Update target every 500ms
    private engagementRange: number = 400; // Distance to start engaging
    private maxSpeed: number = 2.0; // Maximum velocity
    private rotationSpeed: number = 0.05; // How fast to rotate toward target

    constructor(assembly: Assembly, team: AITeam, behavior: AIBehavior = AIBehavior.AGGRESSIVE) {
        this.assembly = assembly;
        this.team = team;
        this.state = {
            behavior,
            target: null,
            lastTargetUpdate: 0,
            lastFireTime: 0,
            patrolCenter: { x: assembly.rootBody.position.x, y: assembly.rootBody.position.y },
            patrolRadius: 300,
            patrolAngle: Math.random() * Math.PI * 2,
            isEngaging: false,
            fleeHealth: 0.3 // Flee when below 30% health
        };
    }

    public update(allAssemblies: Assembly[], deltaTime: number): void {
        if (!this.assembly || this.assembly.destroyed) return;

        const currentTime = Date.now();

        // Update target periodically
        if (currentTime - this.state.lastTargetUpdate > this.targetUpdateInterval) {
            this.updateTarget(allAssemblies);
            this.state.lastTargetUpdate = currentTime;
        }

        // Execute behavior based on current state
        switch (this.state.behavior) {
            case AIBehavior.AGGRESSIVE:
                this.executeAggressiveBehavior(deltaTime);
                break;
            case AIBehavior.DEFENSIVE:
                this.executeDefensiveBehavior(deltaTime);
                break;
            case AIBehavior.PATROL:
                this.executePatrolBehavior(deltaTime);
                break;
            case AIBehavior.ESCORT:
                this.executeEscortBehavior(deltaTime);
                break;
        }

        // Apply movement and rotation limits
        this.limitVelocity();
    }

    private updateTarget(allAssemblies: Assembly[]): void {
        const enemies = this.getEnemyAssemblies(allAssemblies);
        if (enemies.length === 0) {
            this.state.target = null;
            return;
        }

        // Find closest enemy
        const myPos = this.assembly.rootBody.position;
        let closestEnemy: Assembly | null = null;
        let closestDistance = Infinity;

        enemies.forEach(enemy => {
            const distance = Matter.Vector.magnitude(
                Matter.Vector.sub(enemy.rootBody.position, myPos)
            );

            if (distance < closestDistance) {
                closestDistance = distance;
                closestEnemy = enemy;
            }
        });

        this.state.target = closestEnemy;
        this.state.isEngaging = closestDistance < this.engagementRange;
    }

    private getEnemyAssemblies(allAssemblies: Assembly[]): Assembly[] {
        return allAssemblies.filter(assembly => {
            if (!assembly.aiController || assembly === this.assembly || assembly.destroyed) return false;
            return assembly.aiController.team !== this.team;
        });
    }

    private executeAggressiveBehavior(_deltaTime: number): void {
        if (!this.state.target || this.state.target.destroyed) return;

        const myPos = this.assembly.rootBody.position;
        const targetPos = this.state.target.rootBody.position;
        const distance = Matter.Vector.magnitude(Matter.Vector.sub(targetPos, myPos));

        // Check if we should flee due to low health
        const healthPercentage = this.getHealthPercentage();
        if (healthPercentage < this.state.fleeHealth) {
            this.executeFleeBehavior();
            return;
        }

        if (distance < this.engagementRange) {
            // Close enough to engage
            this.rotateToward(targetPos);

            // Move toward target but maintain some distance
            if (distance > 200) {
                this.moveToward(targetPos, 0.7); // Reduced speed for better control
            } else {
                // Circle strafe when close
                this.circleStrafe(targetPos);
            }

            // Fire at target
            this.fireAtTarget();
        } else {
            // Too far, move closer
            this.moveToward(targetPos, 1.0);
            this.rotateToward(targetPos);
        }
    }

    private executeDefensiveBehavior(_deltaTime: number): void {
        if (!this.state.target || this.state.target.destroyed) return;

        const myPos = this.assembly.rootBody.position;
        const targetPos = this.state.target.rootBody.position;
        const distance = Matter.Vector.magnitude(Matter.Vector.sub(targetPos, myPos));

        // Stay near patrol center and only engage when enemy gets close
        const distanceFromCenter = Matter.Vector.magnitude(
            Matter.Vector.sub(myPos, this.state.patrolCenter)
        );

        if (distance < this.engagementRange && distanceFromCenter < this.state.patrolRadius) {
            this.rotateToward(targetPos);
            this.fireAtTarget();
        } else if (distanceFromCenter > this.state.patrolRadius) {
            // Return to patrol area
            this.moveToward(this.state.patrolCenter, 0.8);
            this.rotateToward(this.state.patrolCenter);
        }
    }

    private executePatrolBehavior(deltaTime: number): void {
        // Move in a circle around patrol center
        this.state.patrolAngle += 0.01; // Slow rotation

        const patrolTarget = {
            x: this.state.patrolCenter.x + Math.cos(this.state.patrolAngle) * this.state.patrolRadius,
            y: this.state.patrolCenter.y + Math.sin(this.state.patrolAngle) * this.state.patrolRadius
        };

        this.moveToward(patrolTarget, 0.5);
        this.rotateToward(patrolTarget);

        // If we have a target and they're close, switch to aggressive temporarily
        if (this.state.target && !this.state.target.destroyed) {
            const distance = Matter.Vector.magnitude(
                Matter.Vector.sub(this.state.target.rootBody.position, this.assembly.rootBody.position)
            );

            if (distance < this.engagementRange) {
                this.executeAggressiveBehavior(deltaTime);
            }
        }
    }

    private executeEscortBehavior(deltaTime: number): void {
        // Find player assembly to escort
        // For now, just act defensively
        this.executeDefensiveBehavior(deltaTime);
    }

    private executeFleeBehavior(): void {
        if (!this.state.target) return;

        const myPos = this.assembly.rootBody.position;
        const targetPos = this.state.target.rootBody.position;

        // Calculate flee direction (opposite of target)
        const fleeDirection = Matter.Vector.normalise(
            Matter.Vector.sub(myPos, targetPos)
        );

        const fleeTarget = {
            x: myPos.x + fleeDirection.x * 300,
            y: myPos.y + fleeDirection.y * 300
        };

        this.moveToward(fleeTarget, 1.0); // Full speed retreat
        this.rotateToward(fleeTarget);
    }

    private moveToward(target: Vector2, speedMultiplier: number): void {
        const myPos = this.assembly.rootBody.position;
        const direction = Matter.Vector.normalise(Matter.Vector.sub(target, myPos));

        // Calculate thrust force
        const thrustForce = {
            x: direction.x * 0.05 * speedMultiplier,
            y: direction.y * 0.05 * speedMultiplier
        };

        this.assembly.applyThrust(thrustForce);
    }

    private rotateToward(target: Vector2): void {
        const myPos = this.assembly.rootBody.position;
        const targetAngle = Math.atan2(target.y - myPos.y, target.x - myPos.x);
        const currentAngle = this.assembly.rootBody.angle;

        // Calculate shortest rotation
        let angleDiff = targetAngle - currentAngle;

        // Normalize angle difference to [-π, π]
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        // Apply rotation based on angle difference
        if (Math.abs(angleDiff) > 0.1) {
            const rotationDirection = angleDiff > 0 ? 1 : -1;
            this.assembly.applyTorque(rotationDirection * this.rotationSpeed);
        }
    }

    private circleStrafe(target: Vector2): void {
        const myPos = this.assembly.rootBody.position;
        const toTarget = Matter.Vector.sub(target, myPos);

        // Calculate perpendicular direction for strafing
        const strafeDirection = {
            x: -toTarget.y,
            y: toTarget.x
        };

        const normalizedStrafe = Matter.Vector.normalise(strafeDirection);

        const thrustForce = {
            x: normalizedStrafe.x * 0.03,
            y: normalizedStrafe.y * 0.03
        };

        this.assembly.applyThrust(thrustForce);
    }

    private fireAtTarget(): void {
        if (!this.state.target || this.state.target.destroyed) return;

        const currentTime = Date.now();
        if (currentTime - this.state.lastFireTime < this.assembly.fireRate) return;

        // Calculate angle to target
        const myPos = this.assembly.rootBody.position;
        const targetPos = this.state.target.rootBody.position;
        const targetAngle = Math.atan2(targetPos.y - myPos.y, targetPos.x - myPos.x);

        // Fire weapons
        const bullets = this.assembly.fireWeapons(targetAngle);
        if (bullets.length > 0) {
            this.state.lastFireTime = currentTime;
            // Notify game engine about new bullets (this will be handled by the game engine)
            bullets.forEach(bullet => {
                (bullet as any).isAIBullet = true; // Mark as AI bullet for identification
            });
        }
    }

    private limitVelocity(): void {
        const velocity = this.assembly.rootBody.velocity;
        const speed = Matter.Vector.magnitude(velocity);

        if (speed > this.maxSpeed) {
            const normalizedVelocity = Matter.Vector.normalise(velocity);
            const limitedVelocity = Matter.Vector.mult(normalizedVelocity, this.maxSpeed);
            Matter.Body.setVelocity(this.assembly.rootBody, limitedVelocity);
        }
    }

    private getHealthPercentage(): number {
        if (this.assembly.entities.length === 0) return 0;

        let totalHealth = 0;
        let maxHealth = 0;

        this.assembly.entities.forEach(entity => {
            totalHealth += entity.health;
            if (entity.maxHealth) {
                maxHealth += entity.maxHealth;
            }
        });

        return maxHealth > 0 ? totalHealth / maxHealth : 1;
    }

    public setPatrolArea(center: Vector2, radius: number): void {
        this.state.patrolCenter = center;
        this.state.patrolRadius = radius;
    }

    public setBehavior(behavior: AIBehavior): void {
        this.state.behavior = behavior;
    }
}
