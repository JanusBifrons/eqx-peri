import Matter from 'matter-js';
import { Vector2, GridPowerSummary, STRUCTURE_DEFINITIONS, AsteroidClass } from '../../types/GameTypes';
import { Structure } from './Structure';
import { BeamFireSpec } from '../weapons/BeamSystem';

/** Interval between asteroid re-evaluation scans (ms). */
const ASTEROID_SCAN_INTERVAL_MS = 1000;
/** Max angular deviation (radians) from target before the laser will fire. */
const AIM_THRESHOLD_RAD = 0.2;

/**
 * A structure-based mining laser that autonomously acquires and mines
 * asteroids within its range. Produces BeamFireSpec entries each frame
 * for the BeamSystem to process (ore extraction + visuals).
 */
export class StructureMiningLaser extends Structure {
  /** Current barrel angle in world-space radians. */
  public currentAimAngle: number = 0;
  /** Desired angle toward the current target. */
  private targetAimAngle: number = 0;
  /** Currently tracked asteroid body. */
  private targetAsteroid: Matter.Body | null = null;
  /** Timestamp of the last target scan. */
  private lastScanTime: number = 0;

  constructor(position: Vector2, team: number) {
    super('StructureMiningLaser', position, team);
    this.currentAimAngle = 0;
    this.targetAimAngle = 0;
  }

  /** Whether this mining laser currently has an asteroid target locked. */
  public hasActiveTarget(): boolean {
    return this.targetAsteroid !== null;
  }

  /**
   * Per-frame update: scan for asteroids, rotate barrel, return beam fire specs.
   * The caller routes these to BeamSystem.processBeamFire() for damage + ore extraction.
   */
  public updateMiningLaser(
    deltaTimeMs: number,
    now: number,
    asteroidBodies: Matter.Body[],
    gridSummary: GridPowerSummary | null,
  ): BeamFireSpec | null {
    if (!this.isOperational() || this.isDestroyed()) return null;

    // Power gating
    const efficiency = gridSummary?.powerEfficiency ?? 0;
    if (efficiency <= 0) return null;

    const def = STRUCTURE_DEFINITIONS['StructureMiningLaser'];
    const range = def.miningRange ?? 800;

    // Asteroid scanning (throttled)
    if (now - this.lastScanTime >= ASTEROID_SCAN_INTERVAL_MS) {
      this.lastScanTime = now;
      this.targetAsteroid = this.findClosestAsteroid(asteroidBodies, range);
    }

    // Validate current target is still in world and in range
    if (this.targetAsteroid) {
      const dx = this.targetAsteroid.position.x - this.body.position.x;
      const dy = this.targetAsteroid.position.y - this.body.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > range * 1.2) {
        this.targetAsteroid = null;
      }
    }

    if (!this.targetAsteroid) return null;

    // Rotate barrel toward target
    const dx = this.targetAsteroid.position.x - this.body.position.x;
    const dy = this.targetAsteroid.position.y - this.body.position.y;
    this.targetAimAngle = Math.atan2(dy, dx);

    // Smoothly rotate barrel
    const rotSpeed = 1.5; // rad/s
    let angleDiff = this.targetAimAngle - this.currentAimAngle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    const maxStep = rotSpeed * (deltaTimeMs / 1000);
    if (Math.abs(angleDiff) <= maxStep) {
      this.currentAimAngle = this.targetAimAngle;
    } else {
      this.currentAimAngle += Math.sign(angleDiff) * maxStep;
    }

    // Only fire when aimed close enough
    if (Math.abs(angleDiff) > AIM_THRESHOLD_RAD) return null;

    // Produce a beam fire spec — the caller routes this to BeamSystem
    const barrelEnd = this.getBarrelEndpoint();
    const miningRate = def.miningRate ?? 50;

    return {
      weaponId: `${this.id}-mining`,
      origin: barrelEnd,
      angle: this.currentAimAngle,
      maxRange: range,
      damagePerSecond: miningRate, // BeamSystem uses this for mining rate via callback
      sourceAssemblyId: this.id,  // Structure ID — mining callback handles structures too
      weaponType: 'MiningLaser',
    };
  }

  /** Find the closest asteroid body within range. */
  private findClosestAsteroid(bodies: Matter.Body[], range: number): Matter.Body | null {
    let closest: Matter.Body | null = null;
    let closestDist = Infinity;
    const sx = this.body.position.x;
    const sy = this.body.position.y;

    for (const b of bodies) {
      if (b.label !== 'asteroid') continue;
      const dx = b.position.x - sx;
      const dy = b.position.y - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= range && dist < closestDist) {
        closest = b;
        closestDist = dist;
      }
    }
    return closest;
  }

  /** World-space position of the barrel tip (used as beam origin). */
  public getBarrelEndpoint(): Vector2 {
    const barrelLen = this.definition.widthPx / 2 + 5;
    return {
      x: this.body.position.x + Math.cos(this.currentAimAngle) * barrelLen,
      y: this.body.position.y + Math.sin(this.currentAimAngle) * barrelLen,
    };
  }

  /**
   * Get the asteroid class of the current target (for rendering/UI).
   * Returns null if no target.
   */
  public getTargetAsteroidClass(): AsteroidClass | null {
    if (!this.targetAsteroid) return null;
    return (this.targetAsteroid as unknown as Record<string, unknown>).asteroidClass as AsteroidClass ?? null;
  }
}
