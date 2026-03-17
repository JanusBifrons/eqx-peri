import * as Matter from 'matter-js';
import { EntityType, BEAM_DISPLAY_DURATION_MS } from '../../types/GameTypes';
import { Assembly } from '../core/Assembly';
import { Entity } from '../core/Entity';
import { SoundSystem } from '../systems/SoundSystem';

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

/**
 * Exact ray-convex-polygon entry distance.
 *
 * Iterates all edges of the polygon and finds each ray–edge intersection via
 * Cramer's rule.  Returns the minimum non-negative t (distance along the
 * unit-direction ray) where the ray crosses an edge, or Infinity when the ray
 * misses every edge (can happen if the origin is inside the polygon — treated
 * as t=0 in the caller).
 */
function rayPolygonEntry(
  ox: number, oy: number,
  dx: number, dy: number,
  vertices: { x: number; y: number }[],
): number {
  const n = vertices.length;
  let minT = Infinity;
  for (let i = 0; i < n; i++) {
    const vA = vertices[i];
    const vB = vertices[(i + 1) % n];
    // Edge direction
    const ex = vB.x - vA.x;
    const ey = vB.y - vA.y;
    // det = D × E  (2-D cross product)
    const det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-10) continue; // ray parallel to this edge
    // Solve for t (along ray) and s (along edge, must be in [0,1])
    const relX = vA.x - ox;
    const relY = vA.y - oy;
    const t = (relX * ey - relY * ex) / det;
    const s = (relX * dy - relY * dx) / det;
    if (t >= -1e-6 && s >= -1e-6 && s <= 1 + 1e-6) {
      minT = Math.min(minT, Math.max(0, t));
    }
  }
  return minT;
}

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
    const sourceAssembly = assemblies.find(a => a.id === spec.sourceAssemblyId);
    const sourceTeam = sourceAssembly?.getTeam() ?? -1;
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
      // Friendly shields are skipped — same-team beams pass through allied shield fields.
      if (assembly.hasActiveShield() && (sourceTeam < 0 || assembly.getTeam() !== sourceTeam)) {
        for (const part of assembly.rootBody.parts) {
          if ((part as any).isShieldPart) testBodies.push(part);
        }
      }
    }

    // Matter.js native raycast — uses SAT collision detection against each candidate.
    // Returns all bodies that overlap the ray segment; we then pick the closest one.
    const collisions = Matter.Query.ray(testBodies, spec.origin, endPoint, 1);

    // Find the closest hit using exact ray-polygon intersection.  We track
    // closestT (distance along the ray); the visual endpoint is computed after
    // the loop so it always lies exactly on the ray line.
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
        // Exact ray-polygon entry distance using the body's actual vertex data.
        // This replaces the SAT support-point heuristic which drifted for rotated blocks.
        minT = rayPolygonEntry(spec.origin.x, spec.origin.y, dirX, dirY, body.vertices);
        if (!isFinite(minT)) {
          // Origin is inside the polygon (or a degenerate body) — treat as t=0 so we
          // still record a hit rather than silently skipping it.
          minT = 0;
        }
      }

      if (minT >= 0 && minT < closestT) {
        closestT = minT;
        closestBody = body;
      }
    }

    // Project the endpoint onto the ray line (origin + dir * closestT).
    // Both shield and block paths now use exact geometry, so closestT is the
    // precise entry distance into the hit surface.
    if (closestBody !== null) {
      hitEndX = spec.origin.x + dirX * closestT;
      hitEndY = spec.origin.y + dirY * closestT;
    }

    // Sound: beam-fire hum always; impact sizzle only when the ray hit something
    const sound = SoundSystem.getInstance();
    sound.playBeamFire();
    if (closestBody !== null) sound.playBeamHit();

    // Apply damage based on what was hit
    if (closestBody) {
      if ((closestBody as any).isShieldPart) {
        // Beam hit the physical shield circle — same path as handleLaserHitShield
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
        // Beam hit an entity block body — same path as handleLaserHit
        const entity = (closestBody as any).entity as Entity;
        const hitAssembly = assemblies.find(a => a.entities.includes(entity));
        if (hitAssembly && !entity.destroyed) {
          const damage = spec.damagePerSecond * deltaTime;
          const sourceAssembly = assemblies.find(a => a.id === spec.sourceAssemblyId);
          hitAssembly.lastHitByAssemblyId = spec.sourceAssemblyId;
          hitAssembly.lastHitByPlayer = sourceAssembly?.isPlayerControlled ?? false;

          // Shield interception check — mirrors handleLaserHit logic.
          // Friendly beams bypass allied shields (same team).
          const isFriendlyBeam = sourceTeam >= 0 && hitAssembly.getTeam() === sourceTeam;
          if (!isFriendlyBeam && hitAssembly.damageShield(damage, Date.now())) {
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
