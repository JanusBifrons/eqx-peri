import Matter from 'matter-js';
import { StructureType, Vector2, GridPowerSummary } from '../../types/GameTypes';
import { Structure } from './Structure';
import { Assembly } from '../core/Assembly';

/** Interval between target re-evaluation scans (ms). */
const TARGET_SCAN_INTERVAL_MS = 500;
/** Max angular deviation (radians) from target before the turret will fire. */
const AIM_THRESHOLD_RAD = 0.15;

/**
 * A turret structure that autonomously targets and fires at enemy assemblies.
 * Extends Structure with aiming, targeting, and laser creation.
 */
export class StructureTurret extends Structure {
  /** Current barrel angle in world-space radians. */
  public currentAimAngle: number = 0;
  /** Desired angle toward the current target. */
  private targetAimAngle: number = 0;
  /** Currently tracked enemy assembly. */
  private targetAssembly: Assembly | null = null;
  /** Timestamp of the last target scan. */
  private lastScanTime: number = 0;
  /** Timestamp of the last shot fired. */
  private lastFireTime: number = 0;

  constructor(type: StructureType, position: Vector2, team: number) {
    super(type, position, team);
    // Start barrel pointing right (east)
    this.currentAimAngle = 0;
    this.targetAimAngle = 0;
  }

  /**
   * Per-frame update: scan for targets, rotate barrel, fire if ready.
   * Returns any laser bodies created this frame.
   */
  public updateTurret(
    deltaTimeMs: number,
    now: number,
    assemblies: Assembly[],
    gridSummary: GridPowerSummary | null,
  ): Matter.Body[] {
    // Not operational until fully constructed
    if (!this.isConstructed || this.isDestroyed()) return [];

    // Power efficiency: turret fires slower when underpowered, stops at 0
    const efficiency = gridSummary?.powerEfficiency ?? 0;

    // Target scanning (throttled)
    if (now - this.lastScanTime >= TARGET_SCAN_INTERVAL_MS) {
      this.lastScanTime = now;
      this.targetAssembly = this.findBestTarget(assemblies);
    }

    // Validate current target is still alive and in range
    if (this.targetAssembly) {
      if (this.targetAssembly.destroyed || !this.targetAssembly.hasControlCenter()) {
        this.targetAssembly = null;
      } else {
        const dx = this.targetAssembly.rootBody.position.x - this.body.position.x;
        const dy = this.targetAssembly.rootBody.position.y - this.body.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const range = this.definition.weaponRange ?? 500;
        if (dist > range * 1.2) {
          // Target moved out of range (with hysteresis)
          this.targetAssembly = null;
        }
      }
    }

    // Rotate barrel toward target
    if (this.targetAssembly) {
      const dx = this.targetAssembly.rootBody.position.x - this.body.position.x;
      const dy = this.targetAssembly.rootBody.position.y - this.body.position.y;
      this.targetAimAngle = Math.atan2(dy, dx);
    }

    // Smoothly rotate barrel
    const rotSpeed = this.definition.aimRotationSpeed ?? 2.0;
    let angleDiff = this.targetAimAngle - this.currentAimAngle;
    // Normalize to [-PI, PI]
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    const maxStep = rotSpeed * (deltaTimeMs / 1000);
    if (Math.abs(angleDiff) <= maxStep) {
      this.currentAimAngle = this.targetAimAngle;
    } else {
      this.currentAimAngle += Math.sign(angleDiff) * maxStep;
    }

    // Fire if conditions met
    if (efficiency <= 0 || !this.targetAssembly) return [];

    // Scale fire rate inversely with power efficiency (slower when underpowered)
    const baseFireRate = this.definition.fireRateMs ?? 400;
    const fireRate = baseFireRate / efficiency;
    if (now - this.lastFireTime < fireRate) return [];

    // Check aim alignment
    if (Math.abs(angleDiff) > AIM_THRESHOLD_RAD) return [];

    // Fire!
    this.lastFireTime = now;
    const laser = this.createTurretLaser();
    return laser ? [laser] : [];
  }

  /** Find the closest enemy assembly with a control center within weapon range. */
  private findBestTarget(assemblies: Assembly[]): Assembly | null {
    const range = this.definition.weaponRange ?? 500;
    const rangeSq = range * range;
    let bestDist = Infinity;
    let best: Assembly | null = null;

    for (const a of assemblies) {
      if (a.destroyed) continue;
      if (!a.hasControlCenter()) continue;
      // Must be enemy team
      if (a.getTeam() < 0 || a.getTeam() === this.team) continue;

      const dx = a.rootBody.position.x - this.body.position.x;
      const dy = a.rootBody.position.y - this.body.position.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < rangeSq && distSq < bestDist) {
        bestDist = distSq;
        best = a;
      }
    }
    return best;
  }

  /** Create a laser projectile body fired from the barrel tip. */
  private createTurretLaser(): Matter.Body | null {
    const speed = this.definition.laserSpeed ?? 50;
    const height = this.definition.laserHeight ?? 4;
    const color = this.definition.laserColor ?? '#ff4444';
    const range = this.definition.weaponRange ?? 500;

    // Laser length = 1.5x speed (same tunneling prevention as Assembly.createLaser)
    const laserWidth = Math.max(speed * 1.5, 30);

    // Barrel tip position (center of structure + half its size + half laser length in aim direction)
    const barrelLen = Math.max(this.definition.widthPx, this.definition.heightPx) / 2;
    const muzzleX = this.body.position.x + Math.cos(this.currentAimAngle) * barrelLen;
    const muzzleY = this.body.position.y + Math.sin(this.currentAimAngle) * barrelLen;

    const spawnX = muzzleX + Math.cos(this.currentAimAngle) * (laserWidth / 2);
    const spawnY = muzzleY + Math.sin(this.currentAimAngle) * (laserWidth / 2);

    const laser = Matter.Bodies.rectangle(spawnX, spawnY, laserWidth, height, {
      isSensor: true,
      frictionAir: 0,
      // @ts-expect-error - bullet is a valid Matter.js option but not in TS definitions
      bullet: true,
      collisionFilter: {
        category: 0x0002,
        mask: 0x0001,
      },
      render: {
        fillStyle: color,
        strokeStyle: '#ffffff',
        lineWidth: 1,
      },
    });

    Matter.Body.rotate(laser, this.currentAimAngle);

    // Static turret — no velocity inheritance
    Matter.Body.setVelocity(laser, {
      x: Math.cos(this.currentAimAngle) * speed,
      y: Math.sin(this.currentAimAngle) * speed,
    });

    // TTL from range: range / speed gives ticks, × 1000/60 converts to ms, +20% buffer
    const ttlMs = (range / speed) * (1000 / 60) * 1.2;
    laser.isLaser = true;
    laser.timeToLive = Date.now() + ttlMs;
    (laser as unknown as Record<string, unknown>).sourceStructureId = this.id;
    (laser as unknown as Record<string, unknown>).sourceTeam = this.team;

    return laser;
  }

  /** Get the world-space position of the barrel tip (for rendering). */
  public getBarrelEndpoint(): Vector2 {
    const barrelLen = Math.max(this.definition.widthPx, this.definition.heightPx) / 2 + 4;
    return {
      x: this.body.position.x + Math.cos(this.currentAimAngle) * barrelLen,
      y: this.body.position.y + Math.sin(this.currentAimAngle) * barrelLen,
    };
  }
}
