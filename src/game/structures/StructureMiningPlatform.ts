import Matter from 'matter-js';
import { Vector2, GridPowerSummary, STRUCTURE_DEFINITIONS, AsteroidClass } from '../../types/GameTypes';
import { Structure } from './Structure';
import { BeamFireSpec } from '../weapons/BeamSystem';
import { checkLineOfSight } from '../weapons/WeaponUtils';

/** Number of turret slots on the mining platform. */
const TURRET_COUNT = 4;
/** Interval between asteroid re-evaluation scans per turret (ms). */
const ASTEROID_SCAN_INTERVAL_MS = 1000;
/** Max angular deviation (radians) from target before a turret will fire. */
const AIM_THRESHOLD_RAD = 0.2;
/** Barrel rotation speed in radians per second. */
const AIM_ROTATION_SPEED = 1.5;
/** Arm angles for each turret (radians from structure center). */
const ARM_ANGLES = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];
/** Max angular deviation from arm direction that a turret can fire (radians). ±90° */
const MAX_TURRET_ARC_RAD = Math.PI / 2;

/** Per-turret targeting state. */
interface TurretSlot {
  targetAsteroid: Matter.Body | null;
  lastScanTime: number;
}

/**
 * A mining platform structure with 4 independent turret slots arranged
 * on the tips of an X-shaped base. Each turret autonomously targets
 * and mines the nearest asteroid within range.
 */
export class StructureMiningPlatform extends Structure {
  private readonly turrets: TurretSlot[] = [];

  constructor(position: Vector2, team: number) {
    super('MiningPlatform', position, team);
    // Initialize turret slots and angles
    for (let i = 0; i < TURRET_COUNT; i++) {
      this.turrets.push({ targetAsteroid: null, lastScanTime: 0 });
      // Start each turret facing outward along its arm angle
      const armAngles = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];
      this.turretAngles.push(armAngles[i]);
    }
  }

  /** Whether any turret currently has an asteroid target locked. */
  public hasActiveTarget(): boolean {
    return this.turrets.some(t => t.targetAsteroid !== null);
  }

  /**
   * Per-frame update: scan for asteroids, rotate each turret, return beam fire specs.
   * The caller routes these to BeamSystem.processBeamFire() for damage + ore extraction.
   */
  public updateTurrets(
    deltaTimeMs: number,
    now: number,
    asteroidBodies: Matter.Body[],
    gridSummary: GridPowerSummary | null,
    obstacleBodies: Matter.Body[],
  ): BeamFireSpec[] {
    if (!this.isOperational() || this.isDestroyed()) return [];

    const efficiency = gridSummary?.powerEfficiency ?? 0;
    if (efficiency <= 0) return [];

    const def = STRUCTURE_DEFINITIONS['MiningPlatform'];
    const range = def.miningRange ?? 800;
    const miningRate = def.miningRate ?? 50;
    const specs: BeamFireSpec[] = [];

    for (let i = 0; i < TURRET_COUNT; i++) {
      const slot = this.turrets[i];
      const pivot = this.getTurretPivotPosition(i);

      // Asteroid scanning (throttled, staggered by turret index)
      if (now - slot.lastScanTime >= ASTEROID_SCAN_INTERVAL_MS) {
        slot.lastScanTime = now;
        slot.targetAsteroid = this.findClosestAsteroid(asteroidBodies, range, i);
      }

      // Validate current target: range from turret pivot + firing arc
      if (slot.targetAsteroid) {
        const dx = slot.targetAsteroid.position.x - pivot.x;
        const dy = slot.targetAsteroid.position.y - pivot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > range) {
          slot.targetAsteroid = null;
        } else {
          // Check firing arc — target must be within ±90° of arm direction
          const angleToTarget = Math.atan2(dy, dx);
          let arcDiff = angleToTarget - ARM_ANGLES[i];
          while (arcDiff > Math.PI) arcDiff -= 2 * Math.PI;
          while (arcDiff < -Math.PI) arcDiff += 2 * Math.PI;
          if (Math.abs(arcDiff) > MAX_TURRET_ARC_RAD) {
            slot.targetAsteroid = null;
          }
        }
      }

      if (!slot.targetAsteroid) continue;

      // Compute target angle from turret pivot (not structure center)
      const dx = slot.targetAsteroid.position.x - pivot.x;
      const dy = slot.targetAsteroid.position.y - pivot.y;
      const targetAngle = Math.atan2(dy, dx);

      let angleDiff = targetAngle - this.turretAngles[i];
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      const maxStep = AIM_ROTATION_SPEED * (deltaTimeMs / 1000);
      if (Math.abs(angleDiff) <= maxStep) {
        this.turretAngles[i] = targetAngle;
      } else {
        this.turretAngles[i] += Math.sign(angleDiff) * maxStep;
      }

      // Only fire when aimed close enough
      if (Math.abs(angleDiff) > AIM_THRESHOLD_RAD) continue;

      // Per-frame range check from barrel to target (not just scan-time)
      const barrelEnd = this.getTurretBarrelEndpoint(i);
      const bDx = slot.targetAsteroid.position.x - barrelEnd.x;
      const bDy = slot.targetAsteroid.position.y - barrelEnd.y;
      if (Math.sqrt(bDx * bDx + bDy * bDy) > range) continue;

      // LOS check — don't fire if blocked by obstacles
      // Exclude self body AND the target asteroid (ray always hits the target)
      const targetPos = slot.targetAsteroid.position;
      const losExclude = new Set([this.body.id, slot.targetAsteroid.id]);
      if (!checkLineOfSight(barrelEnd, targetPos, obstacleBodies, losExclude)) continue;

      // Produce beam fire spec
      specs.push({
        weaponId: `${this.id}-mining-${i}`,
        origin: barrelEnd,
        angle: this.turretAngles[i],
        maxRange: range,
        damagePerSecond: miningRate,
        sourceAssemblyId: this.id,
        weaponType: 'MiningLaser',
      });
    }

    return specs;
  }

  /**
   * Find closest asteroid for a specific turret, preferring targets
   * not already claimed by other turrets on this platform.
   */
  private findClosestAsteroid(
    bodies: Matter.Body[],
    range: number,
    turretIndex: number,
  ): Matter.Body | null {
    // Use turret pivot position (arm tip) for distance + arc calculations
    const pivot = this.getTurretPivotPosition(turretIndex);
    const sx = pivot.x;
    const sy = pivot.y;
    const armAngle = ARM_ANGLES[turretIndex];

    // Collect bodies already targeted by other turrets
    const claimed = new Set<number>();
    for (let i = 0; i < TURRET_COUNT; i++) {
      if (i !== turretIndex && this.turrets[i].targetAsteroid) {
        claimed.add(this.turrets[i].targetAsteroid!.id);
      }
    }

    let bestUnclaimed: Matter.Body | null = null;
    let bestUnclaimedDist = Infinity;
    let bestAny: Matter.Body | null = null;
    let bestAnyDist = Infinity;

    for (const b of bodies) {
      if (b.label !== 'asteroid') continue;
      const dx = b.position.x - sx;
      const dy = b.position.y - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > range) continue;

      // Firing arc check — only target asteroids within ±90° of arm direction
      const angleToAsteroid = Math.atan2(dy, dx);
      let arcDiff = angleToAsteroid - armAngle;
      while (arcDiff > Math.PI) arcDiff -= 2 * Math.PI;
      while (arcDiff < -Math.PI) arcDiff += 2 * Math.PI;
      if (Math.abs(arcDiff) > MAX_TURRET_ARC_RAD) continue;

      if (dist < bestAnyDist) {
        bestAny = b;
        bestAnyDist = dist;
      }
      if (!claimed.has(b.id) && dist < bestUnclaimedDist) {
        bestUnclaimed = b;
        bestUnclaimedDist = dist;
      }
    }

    // Prefer unclaimed targets, fall back to any if all are claimed
    return bestUnclaimed ?? bestAny;
  }

  /** World-space position of a turret's pivot (center of its rotating part). */
  public getTurretPivotPosition(turretIndex: number): Vector2 {
    const turretPart = this.definition.parts?.find(
      p => p.rotation === 'aim' && p.turretIndex === turretIndex,
    );
    if (!turretPart) {
      return { x: this.body.position.x, y: this.body.position.y };
    }
    return {
      x: this.body.position.x + turretPart.offsetX,
      y: this.body.position.y + turretPart.offsetY,
    };
  }

  /** World-space position of a specific turret's barrel tip. */
  public getTurretBarrelEndpoint(turretIndex: number): Vector2 {
    const turretPart = this.definition.parts?.find(
      p => p.rotation === 'aim' && p.turretIndex === turretIndex,
    );
    if (!turretPart) {
      // Fallback — shouldn't happen with correct definition
      return { x: this.body.position.x, y: this.body.position.y };
    }

    const angle = this.turretAngles[turretIndex];
    // Pivot is at offsetX/Y (hex base center); forwardOffset shifts the drawn rect forward.
    const pivotX = this.body.position.x + turretPart.offsetX;
    const pivotY = this.body.position.y + turretPart.offsetY;
    // Barrel tip = pivot + forwardOffset + half-width + small gap
    const forwardOffset = turretPart.forwardOffset ?? 0;
    const barrelLen = turretPart.widthPx / 2 + forwardOffset + 5;
    return {
      x: pivotX + Math.cos(angle) * barrelLen,
      y: pivotY + Math.sin(angle) * barrelLen,
    };
  }

  /**
   * Get the asteroid class of any current target (for UI).
   * Returns the first turret's target class, or null.
   */
  public getTargetAsteroidClass(): AsteroidClass | null {
    for (const slot of this.turrets) {
      if (slot.targetAsteroid) {
        return (slot.targetAsteroid as unknown as Record<string, unknown>).asteroidClass as AsteroidClass ?? null;
      }
    }
    return null;
  }
}
