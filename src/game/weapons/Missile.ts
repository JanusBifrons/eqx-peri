import * as Matter from 'matter-js';
import { MissileConfig, Vector2 } from '../../types/GameTypes';

// Collision filter category for missiles
const MISSILE_COLLISION_CATEGORY = 0x0004;

// Phase durations (seconds)
const LAUNCH_PHASE_DURATION = 0.5;
const BOOST_PHASE_DURATION = 2.0;

// Launch collision delay — missiles can't collide with anything during this window
const LAUNCH_COLLISION_DELAY = 0.5;

// Separation distance from launch point to avoid self-collision
const SEPARATION_DISTANCE = 20;

// Initial launch speed (world units per tick)
const INITIAL_LAUNCH_SPEED = 4.0;

export type MissilePhase = 'launch' | 'boost' | 'cruise';

export class Missile {
  public readonly body: Matter.Body;
  public readonly config: MissileConfig;
  public readonly sourceAssemblyId: string;
  public readonly sourceTeam: number;
  public targetAssembly: { rootBody: Matter.Body; destroyed: boolean; id: string; team: number } | null;
  public age: number = 0;
  public fuelRemaining: number;
  public destroyed: boolean = false;
  public phase: MissilePhase = 'launch';

  // Previous line-of-sight angle for proportional navigation
  private prevLosAngle: number = 0;
  private losInitialized: boolean = false;

  constructor(
    position: Vector2,
    initialAngle: number,
    config: MissileConfig,
    sourceAssemblyId: string,
    sourceTeam: number,
    targetAssembly?: { rootBody: Matter.Body; destroyed: boolean; id: string; team: number },
  ) {
    this.config = config;
    this.sourceAssemblyId = sourceAssemblyId;
    this.sourceTeam = sourceTeam;
    this.targetAssembly = targetAssembly ?? null;
    this.fuelRemaining = config.fuel;

    const size = this.getMissileSize();
    this.body = Matter.Bodies.rectangle(position.x, position.y, size.width, size.height, {
      mass: 2,
      frictionAir: 0,
      inertia: 0.5,
      angle: initialAngle,
      // @ts-expect-error - bullet is a valid Matter.js option but not in the TypeScript definitions
      bullet: true,
      collisionFilter: {
        category: MISSILE_COLLISION_CATEGORY,
        mask: 0x0001 | 0x0002,
        group: 0,
      },
      render: {
        fillStyle: this.getMissileColor(),
        strokeStyle: '#ffffff',
        lineWidth: 1,
        visible: false, // MissileRenderer handles drawing
      },
    });

    // Tag the body for collision detection
    (this.body as unknown as Record<string, unknown>).isMissile = true;
    (this.body as unknown as Record<string, unknown>).missile = this;
    (this.body as unknown as Record<string, unknown>).sourceAssemblyId = sourceAssemblyId;

    // Set initial velocity in the firing direction
    Matter.Body.setVelocity(this.body, {
      x: Math.cos(initialAngle) * INITIAL_LAUNCH_SPEED,
      y: Math.sin(initialAngle) * INITIAL_LAUNCH_SPEED,
    });

    // Offset from launch point to avoid immediate self-collision
    Matter.Body.setPosition(this.body, {
      x: position.x + Math.cos(initialAngle) * SEPARATION_DISTANCE,
      y: position.y + Math.sin(initialAngle) * SEPARATION_DISTANCE,
    });
  }

  public get launchCollisionDelay(): number {
    return LAUNCH_COLLISION_DELAY;
  }

  public update(deltaTime: number, availableTargets: { rootBody: Matter.Body; destroyed: boolean; id: string; team: number }[]): void {
    if (this.destroyed) return;

    this.age += deltaTime;
    this.fuelRemaining -= deltaTime;

    if (this.fuelRemaining <= 0) {
      this.destroy();
      return;
    }

    // Update phase
    if (this.age < LAUNCH_PHASE_DURATION) {
      this.phase = 'launch';
    } else if (this.age < LAUNCH_PHASE_DURATION + BOOST_PHASE_DURATION) {
      this.phase = 'boost';
    } else {
      this.phase = 'cruise';
    }

    // Acquire or validate target for tracking missiles
    if (this.config.variant === 'tracking' && this.phase !== 'launch') {
      this.acquireTarget(availableTargets);
    }

    // Steering (not during launch phase, and only for missiles with turnRate > 0)
    if (this.phase !== 'launch' && this.config.turnRate > 0 && this.targetAssembly && !this.targetAssembly.destroyed) {
      this.steerTowardTarget(deltaTime);
    }

    // Acceleration
    this.applyThrust(deltaTime);

    // Align body angle to velocity direction (missiles always face their travel direction)
    const vel = this.body.velocity;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
    if (speed > 0.5) {
      Matter.Body.setAngle(this.body, Math.atan2(vel.y, vel.x));
    }

    // Clamp speed
    this.limitSpeed();
  }

  private acquireTarget(targets: { rootBody: Matter.Body; destroyed: boolean; id: string; team: number }[]): void {
    // If current target is still valid, keep it
    if (this.targetAssembly && !this.targetAssembly.destroyed && this.targetAssembly.team !== this.sourceTeam) {
      return;
    }

    // Find nearest enemy target
    let nearest: typeof targets[0] | null = null;
    let nearestDist = Infinity;

    for (const t of targets) {
      if (t.destroyed || t.id === this.sourceAssemblyId || t.team === this.sourceTeam || t.team === -1) continue;
      const dx = t.rootBody.position.x - this.body.position.x;
      const dy = t.rootBody.position.y - this.body.position.y;
      const dist = dx * dx + dy * dy;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.targetAssembly = nearest;
  }

  /**
   * Velocity-vector steering using proportional navigation.
   * Instead of torque, we blend the velocity direction toward the desired intercept heading.
   */
  private steerTowardTarget(deltaTime: number): void {
    if (!this.targetAssembly) return;

    const tPos = this.targetAssembly.rootBody.position;
    const mPos = this.body.position;
    const dx = tPos.x - mPos.x;
    const dy = tPos.y - mPos.y;
    const losAngle = Math.atan2(dy, dx);

    // Proportional navigation: steer proportional to the rate of change of line-of-sight
    if (!this.losInitialized) {
      this.prevLosAngle = losAngle;
      this.losInitialized = true;
    }

    let losRate = losAngle - this.prevLosAngle;
    // Normalize
    while (losRate > Math.PI) losRate -= 2 * Math.PI;
    while (losRate < -Math.PI) losRate += 2 * Math.PI;
    this.prevLosAngle = losAngle;

    // Navigation constant (higher = more aggressive interception)
    const N = 4.0;
    const vel = this.body.velocity;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
    if (speed < 0.1) return;

    const currentAngle = Math.atan2(vel.y, vel.x);

    // Desired heading change based on PN
    let desiredTurn = N * losRate;

    // Clamp turn rate
    const maxTurn = this.config.turnRate * deltaTime;
    desiredTurn = Math.max(-maxTurn, Math.min(maxTurn, desiredTurn));

    // Also add a pure pursuit component for when PN rate is near zero
    // (missile heading directly at target but not turning)
    let pursuitError = losAngle - currentAngle;
    while (pursuitError > Math.PI) pursuitError -= 2 * Math.PI;
    while (pursuitError < -Math.PI) pursuitError += 2 * Math.PI;

    const pursuitTurn = Math.max(-maxTurn, Math.min(maxTurn, pursuitError * 0.5));

    // Blend PN and pure pursuit: PN dominates when LOS rate is significant
    const pnWeight = Math.min(1.0, Math.abs(losRate) * 60); // losRate per frame -> per second
    const finalTurn = desiredTurn * pnWeight + pursuitTurn * (1 - pnWeight);

    const newAngle = currentAngle + finalTurn;
    Matter.Body.setVelocity(this.body, {
      x: Math.cos(newAngle) * speed,
      y: Math.sin(newAngle) * speed,
    });
  }

  private applyThrust(deltaTime: number): void {
    const vel = this.body.velocity;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

    // Target speed varies by phase
    let targetSpeed: number;
    switch (this.phase) {
      case 'launch':
        targetSpeed = this.config.initialSpeed;
        break;
      case 'boost': {
        // Linearly ramp from initialSpeed to maxSpeed over the boost phase
        const boostProgress = (this.age - LAUNCH_PHASE_DURATION) / BOOST_PHASE_DURATION;
        targetSpeed = this.config.initialSpeed + (this.config.maxSpeed - this.config.initialSpeed) * boostProgress;
        break;
      }
      case 'cruise':
        targetSpeed = this.config.maxSpeed;
        break;
    }

    if (speed < targetSpeed) {
      const accel = this.config.acceleration * deltaTime;
      const thrustDir = {
        x: Math.cos(this.body.angle),
        y: Math.sin(this.body.angle),
      };
      Matter.Body.setVelocity(this.body, {
        x: vel.x + thrustDir.x * accel,
        y: vel.y + thrustDir.y * accel,
      });
    }
  }

  private limitSpeed(): void {
    const vel = this.body.velocity;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
    if (speed > this.config.maxSpeed) {
      const scale = this.config.maxSpeed / speed;
      Matter.Body.setVelocity(this.body, {
        x: vel.x * scale,
        y: vel.y * scale,
      });
    }
  }

  private getMissileSize(): { width: number; height: number } {
    switch (this.config.launcherSize) {
      case 'small':   return { width: 12, height: 4 };
      case 'large':   return { width: 16, height: 6 };
      case 'capital':  return { width: 20, height: 8 };
    }
  }

  private getMissileColor(): string {
    switch (this.config.variant) {
      case 'tracking':  return '#ff6600';
      case 'standard':  return '#ff3300';
      case 'torpedo':   return '#ffaa00';
    }
  }

  public getDamage(): number {
    return this.config.damage;
  }

  public destroy(): void {
    this.destroyed = true;
  }
}
