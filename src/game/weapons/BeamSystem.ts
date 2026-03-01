import * as Matter from 'matter-js';
import { EntityType, BEAM_DISPLAY_DURATION_MS } from '../../types/GameTypes';
import { Assembly } from '../core/Assembly';
import { Entity } from '../core/Entity';

// Spec describing one beam fire event, produced by Assembly.getBeamFires()
export interface BeamFireSpec {
  weaponId: string;       // Unique Entity ID of the weapon block
  origin: { x: number; y: number };
  angle: number;          // World-space firing angle in radians
  maxRange: number;       // World units
  damagePerSecond: number;
  sourceAssemblyId: string;
  weaponType: EntityType;
}

// Visual record of a beam — one per weapon entity, overwritten each tick while firing
export interface ActiveBeam {
  weaponId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  hit: boolean;           // Whether the far end is a hit point (vs max range)
  sourceAssemblyId: string;
  weaponType: EntityType;
  lastUpdatedAt: number;  // ms timestamp — beam fades after BEAM_DISPLAY_DURATION_MS
}

type EntityDestroyedCallback = (entity: Entity, hitAssembly: Assembly, sourceAssemblyId: string) => void;

export class BeamSystem {
  // Keyed by weapon entity ID so each weapon has exactly one active beam record
  private readonly activeBeams: Map<string, ActiveBeam> = new Map();
  private readonly onEntityDestroyed: EntityDestroyedCallback;

  constructor(onEntityDestroyed: EntityDestroyedCallback) {
    this.onEntityDestroyed = onEntityDestroyed;
  }

  /**
   * Process one beam fire using Matter.js's native Matter.Query.ray().
   *
   * The candidate body list is built from each assembly's entity bodies AND its shield
   * circle part (if present), so the native SAT check sees the shield the same way
   * Matter.js collision events do for regular laser projectiles.
   */
  processBeamFire(spec: BeamFireSpec, assemblies: Assembly[], deltaTime: number): void {
    const dirX = Math.cos(spec.angle);
    const dirY = Math.sin(spec.angle);
    const endPoint = {
      x: spec.origin.x + dirX * spec.maxRange,
      y: spec.origin.y + dirY * spec.maxRange,
    };

    // Build the set of bodies to test: entity block bodies + shield circle parts,
    // excluding the source assembly (no self-hits) and already-destroyed entities.
    const testBodies: Matter.Body[] = [];
    for (const assembly of assemblies) {
      if (assembly.destroyed || assembly.id === spec.sourceAssemblyId) continue;

      for (const entity of assembly.entities) {
        if (!entity.destroyed) testBodies.push(entity.body);
      }

      // Include the shield circle only when the shield is currently active.
      // An inactive (collapsed/cooldown) shield must not block the beam — the circle
      // part persists in the compound body even when the shield is down, so we gate
      // on hasActiveShield() to prevent the beam from silently hitting an invisible shield.
      if (assembly.hasActiveShield()) {
        for (const part of assembly.rootBody.parts) {
          if ((part as any).isShieldPart) testBodies.push(part);
        }
      }
    }

    // Matter.js native raycast — uses SAT collision detection against each candidate.
    // Returns all bodies that overlap the ray segment; we then pick the closest one.
    const collisions = Matter.Query.ray(testBodies, spec.origin, endPoint, 1);

    // Find the closest hit by projecting each collision's support points onto the
    // ray direction.  We only track the scalar distance (closestT); the visual
    // endpoint is computed after the loop so it always lies exactly on the ray line.
    let closestT = spec.maxRange;
    let closestBody: Matter.Body | null = null;
    let hitEndX = endPoint.x;
    let hitEndY = endPoint.y;

    for (const collision of collisions) {
      // Matter.js types for Query.ray are incomplete; body and supports are runtime fields
      const body = (collision as any).body as Matter.Body;

      let minT: number;

      if ((body as any).isShieldPart) {
        // Use exact ray-circle intersection for ordering.  SAT support points on a circle
        // polygon can land on the far/back face of the intersection region, reporting a t
        // value larger than blocks that sit inside the shield — causing the beam to skip the
        // shield and hit those blocks instead.  Exact geometry avoids this entirely.
        const center = body.position;
        const hitAssemblyRef = (body as any).parentAssembly as Assembly;
        const radius = hitAssemblyRef?.getShieldRadius() ?? 0;
        const tc = (center.x - spec.origin.x) * dirX + (center.y - spec.origin.y) * dirY;
        const perpX = center.x - (spec.origin.x + dirX * tc);
        const perpY = center.y - (spec.origin.y + dirY * tc);
        const entry = tc - Math.sqrt(Math.max(0, radius * radius - perpX * perpX - perpY * perpY));
        minT = isFinite(entry) ? entry : Infinity;
      } else {
        const supports: { x: number; y: number }[] = (collision as any).supports ?? [];
        if (supports.length > 0) {
          minT = Infinity;
          for (const s of supports) {
            const t = (s.x - spec.origin.x) * dirX + (s.y - spec.origin.y) * dirY;
            if (t < minT) minT = t;
          }
        } else {
          // Fallback when supports array is empty: use body centroid projection
          minT = (body.position.x - spec.origin.x) * dirX + (body.position.y - spec.origin.y) * dirY;
        }
      }

      if (minT >= 0 && minT < closestT) {
        closestT = minT;
        closestBody = body;
      }
    }

    // Project the endpoint onto the ray line (origin + dir * closestT).
    // For shields, closestT is already the exact ray-circle entry distance from the loop above.
    // For entity blocks, this eliminates lateral drift from rotating SAT support points.
    if (closestBody !== null) {
      hitEndX = spec.origin.x + dirX * closestT;
      hitEndY = spec.origin.y + dirY * closestT;
    }

    // Apply damage based on what was hit
    if (closestBody) {
      if ((closestBody as any).isShieldPart) {
        // Beam hit the physical shield circle — same path as handleBulletHitShield
        const hitAssembly = (closestBody as any).parentAssembly as Assembly;
        if (hitAssembly && !hitAssembly.destroyed) {
          const sourceAssembly = assemblies.find(a => a.id === spec.sourceAssemblyId);
          hitAssembly.lastHitByAssemblyId = spec.sourceAssemblyId;
          hitAssembly.lastHitByPlayer = sourceAssembly?.isPlayerControlled ?? false;
          hitAssembly.damageShield(spec.damagePerSecond * deltaTime, Date.now());
          hitAssembly.entities
            .filter(e => (e.type === 'Shield' || e.type === 'LargeShield') && !e.destroyed)
            .forEach(e => e.triggerCollisionFlash());
        }
      } else if ((closestBody as any).entity) {
        // Beam hit an entity block body — same path as handleBulletHit
        const entity = (closestBody as any).entity as Entity;
        const hitAssembly = assemblies.find(a => a.entities.includes(entity));
        if (hitAssembly && !entity.destroyed) {
          const damage = spec.damagePerSecond * deltaTime;
          const sourceAssembly = assemblies.find(a => a.id === spec.sourceAssemblyId);
          hitAssembly.lastHitByAssemblyId = spec.sourceAssemblyId;
          hitAssembly.lastHitByPlayer = sourceAssembly?.isPlayerControlled ?? false;

          // Shield interception check — mirrors handleBulletHit logic
          if (hitAssembly.damageShield(damage, Date.now())) {
            hitAssembly.entities
              .filter(e => (e.type === 'Shield' || e.type === 'LargeShield') && !e.destroyed)
              .forEach(e => e.triggerCollisionFlash());
          } else {
            if (!entity.destroyed) entity.triggerCollisionFlash();
            const destroyed = entity.takeDamage(damage);
            if (destroyed) {
              this.onEntityDestroyed(entity, hitAssembly, spec.sourceAssemblyId);
            }
          }
        }
      }
    }

    // Update the visual beam record (overwrite previous for this weapon)
    this.activeBeams.set(spec.weaponId, {
      weaponId: spec.weaponId,
      startX: spec.origin.x,
      startY: spec.origin.y,
      endX: hitEndX,
      endY: hitEndY,
      hit: closestBody !== null,
      sourceAssemblyId: spec.sourceAssemblyId,
      weaponType: spec.weaponType,
      lastUpdatedAt: Date.now(),
    });
  }

  /** Age out beams that haven't been refreshed in BEAM_DISPLAY_DURATION_MS. */
  update(_deltaTime: number): void {
    const now = Date.now();
    for (const [weaponId, beam] of this.activeBeams) {
      if (now - beam.lastUpdatedAt > BEAM_DISPLAY_DURATION_MS) {
        this.activeBeams.delete(weaponId);
      }
    }
  }

  getActiveBeams(): ActiveBeam[] {
    return Array.from(this.activeBeams.values());
  }
}
