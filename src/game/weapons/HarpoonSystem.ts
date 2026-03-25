import * as Matter from 'matter-js';
import { HARPOON_SPEED, HARPOON_DAMAGE, HARPOON_REEL_SPEED, Vector2 } from '../../types/GameTypes';
import { SoundSystem } from '../systems/SoundSystem';

// Maximum tether length before it snaps
const TETHER_BREAK_LENGTH = 800;

// Collision delay for harpoon projectiles (must be shorter than travel time to nearest target)
const HARPOON_LAUNCH_DELAY = 0.05;

// How long in-flight before it reels back (seconds)
const HARPOON_MAX_FLY_TIME = 1.5;

// How long the reel-back takes before it can fire again (seconds)
const HARPOON_REEL_DURATION = 1.5;

// Elastic tether tuning — only applies when overstretched (dist > tetherLength)
// Peak stiffness at full overstretch. Below tetherLength, stiffness is always 0.
const ELASTIC_MAX_STIFFNESS = 0.04;
// Damping — suppresses oscillation when the tether snaps taut
const ELASTIC_DAMPING = 0.02;
// How many world units of overstretch it takes to reach full stiffness
const ELASTIC_RAMP_DISTANCE = 300;

/** Convert a world-space point to body-local coordinates (inverse of body rotation). */
function worldToBodyLocal(body: Matter.Body, wx: number, wy: number): { x: number; y: number } {
  const dx = wx - body.position.x;
  const dy = wy - body.position.y;
  const cos = Math.cos(-body.angle);
  const sin = Math.sin(-body.angle);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/** Convert a body-local point to world-space coordinates. */
function bodyLocalToWorld(body: Matter.Body, lx: number, ly: number): { x: number; y: number } {
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  return {
    x: body.position.x + lx * cos - ly * sin,
    y: body.position.y + lx * sin + ly * cos,
  };
}

/** Minimal assembly interface to avoid circular import. */
interface HarpoonTarget {
  rootBody: Matter.Body;
  destroyed: boolean;
  id: string;
  team: number;
  getTeam?: () => number;
  damageShield?: (damage: number, now: number) => boolean;
  lastHitByAssemblyId?: string | null;
  lastHitByPlayer?: boolean;
  isPlayerControlled?: boolean;
}

export interface ActiveHarpoon {
  id: string;
  /** In-flight projectile body, null once embedded or reeling. */
  projectileBody: Matter.Body | null;
  /** Matter.Constraint used as an elastic tether (stiffness varied dynamically). */
  constraint: Matter.Constraint | null;
  sourceAssemblyId: string;
  sourceTeam: number;
  targetAssemblyId: string | null;
  age: number;
  destroyed: boolean;
  /** Current state of the harpoon lifecycle. */
  state: 'flying' | 'tethered' | 'reeling';
  /** Reel-back timer — counts down to 0. */
  reelTimer: number;
  /**
   * Anchor tracking: offsets are relative to the specific entity PART body
   * (not the assembly COM), so they rotate correctly even if the compound
   * body is rebuilt and the COM shifts.
   */
  /** Reference to the harpoon weapon entity's part body. */
  sourcePartBody: Matter.Body | null;
  /** Offset from sourcePartBody center to the muzzle tip, in entity-local coords. */
  sourceEntityOffset: Vector2;
  /** Reference to the hit entity's part body on the target assembly. */
  targetPartBody: Matter.Body | null;
  /** Offset from targetPartBody center to the hit point, in entity-local coords. */
  targetEntityOffset: Vector2;
  /** Body-local offset of the weapon muzzle on the source assembly (for renderer/constraint). */
  sourceLocalAnchor: Vector2;
  /** Body-local offset of the impact point on the target assembly (for renderer/constraint). */
  targetLocalAnchor: Vector2;
  /** Maximum rope length (distance at time of impact). */
  tetherLength: number;
}

let nextHarpoonId = 0;

export class HarpoonSystem {
  private harpoons: ActiveHarpoon[] = [];
  private readonly world: Matter.World;

  constructor(world: Matter.World) {
    this.world = world;
  }

  public fireHarpoon(
    position: Vector2,
    angle: number,
    sourceAssemblyId: string,
    sourceTeam: number,
    sourceBody?: Matter.Body,
    sourceEntityBody?: Matter.Body,
  ): ActiveHarpoon {
    const body = Matter.Bodies.rectangle(
      position.x + Math.cos(angle) * 15,
      position.y + Math.sin(angle) * 15,
      10, 4,
      {
        mass: 1,
        frictionAir: 0,
        angle,
        // @ts-expect-error - bullet is a valid Matter.js option
        bullet: true,
        collisionFilter: {
          category: 0x0008,
          mask: 0x0001 | 0x0002,
          group: 0,
        },
        render: {
          fillStyle: '#cc8844',
          strokeStyle: '#ffffff',
          lineWidth: 1,
          visible: false, // HarpoonRenderer handles drawing
        },
      },
    );

    (body as unknown as Record<string, unknown>).isHarpoon = true;
    (body as unknown as Record<string, unknown>).sourceAssemblyId = sourceAssemblyId;

    Matter.Body.setVelocity(body, {
      x: Math.cos(angle) * HARPOON_SPEED,
      y: Math.sin(angle) * HARPOON_SPEED,
    });

    Matter.World.add(this.world, body);
    SoundSystem.getInstance().playLaserFire();

    // Compute entity-local offset: from the entity part body center to the muzzle tip.
    // This is rotation-stable — it tracks the entity, not the assembly COM.
    const sourceEntOffset = sourceEntityBody
      ? worldToBodyLocal(sourceEntityBody, position.x, position.y)
      : { x: 0, y: 0 };

    const harpoon: ActiveHarpoon = {
      id: `harpoon-${nextHarpoonId++}`,
      projectileBody: body,
      constraint: null,
      sourceAssemblyId,
      sourceTeam,
      targetAssemblyId: null,
      age: 0,
      destroyed: false,
      state: 'flying',
      reelTimer: 0,
      sourcePartBody: sourceEntityBody ?? null,
      sourceEntityOffset: sourceEntOffset,
      targetPartBody: null,
      targetEntityOffset: { x: 0, y: 0 },
      sourceLocalAnchor: sourceBody
        ? worldToBodyLocal(sourceBody, position.x, position.y)
        : { x: 0, y: 0 },
      targetLocalAnchor: { x: 0, y: 0 },
      tetherLength: 0,
    };

    (body as unknown as Record<string, unknown>).harpoonData = harpoon;
    this.harpoons.push(harpoon);
    return harpoon;
  }

  /** Return all flying harpoon projectile bodies for raycast processing. */
  public getFlyingHarpoons(): ActiveHarpoon[] {
    return this.harpoons.filter(h => h.state === 'flying' && !h.destroyed && h.projectileBody);
  }

  public update(deltaTime: number, assemblies: HarpoonTarget[]): void {
    for (let i = this.harpoons.length - 1; i >= 0; i--) {
      const h = this.harpoons[i];
      h.age += deltaTime;

      if (h.destroyed) {
        this.removeHarpoon(h);
        this.harpoons.splice(i, 1);
        continue;
      }

      if (h.state === 'flying') {
        if (h.age > HARPOON_MAX_FLY_TIME) {
          this.startReel(h, assemblies);
        }
      } else if (h.state === 'reeling') {
        this.updateReel(h, deltaTime, assemblies);
      } else if (h.state === 'tethered') {
        this.updateTether(h, assemblies);
      }
    }
  }

  /** Start reeling the harpoon back toward the source ship. */
  private startReel(h: ActiveHarpoon, assemblies: HarpoonTarget[]): void {
    const source = assemblies.find(a => a.id === h.sourceAssemblyId);
    if (!source || source.destroyed) {
      h.destroyed = true;
      return;
    }

    h.state = 'reeling';
    h.reelTimer = HARPOON_REEL_DURATION;

    if (h.projectileBody) {
      Matter.Body.set(h.projectileBody, {
        collisionFilter: { category: 0, mask: 0, group: 0 },
      });
    }
  }

  /** Pull the reeling projectile back toward the source ship. */
  private updateReel(h: ActiveHarpoon, deltaTime: number, assemblies: HarpoonTarget[]): void {
    h.reelTimer -= deltaTime;

    if (h.reelTimer <= 0 || !h.projectileBody) {
      h.destroyed = true;
      return;
    }

    const source = assemblies.find(a => a.id === h.sourceAssemblyId);
    if (!source || source.destroyed) {
      h.destroyed = true;
      return;
    }

    const srcPos = source.rootBody.position;
    const hPos = h.projectileBody.position;
    const dx = srcPos.x - hPos.x;
    const dy = srcPos.y - hPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 30) {
      h.destroyed = true;
      return;
    }

    const nx = dx / dist;
    const ny = dy / dist;
    Matter.Body.setVelocity(h.projectileBody, {
      x: nx * HARPOON_REEL_SPEED,
      y: ny * HARPOON_REEL_SPEED,
    });
    Matter.Body.setAngle(h.projectileBody, Math.atan2(ny, nx));
  }

  /**
   * Elastic tether using a Matter.Constraint with dynamic stiffness.
   *
   * - dist <= tetherLength: stiffness = 0 → completely inert, no push, no pull
   * - dist > tetherLength: stiffness ramps up with the square of overstretch distance,
   *   giving a smooth elastic feel that gets progressively firmer
   *
   * The constraint length stays fixed at tetherLength. When stiffness is 0 the
   * constraint does nothing. When stiffness > 0 and dist > length, it only pulls.
   */
  private updateTether(h: ActiveHarpoon, assemblies: HarpoonTarget[]): void {
    if (!h.constraint) {
      h.destroyed = true;
      return;
    }

    const sourceAssembly = assemblies.find(a => a.id === h.sourceAssemblyId);
    const targetAssembly = assemblies.find(a => a.id === h.targetAssemblyId);

    if (!sourceAssembly || sourceAssembly.destroyed || !targetAssembly || targetAssembly.destroyed) {
      h.destroyed = true;
      return;
    }

    // Recompute constraint anchors each frame from entity part bodies.
    // This ensures the anchor tracks the specific entity correctly even if
    // the compound body is rebuilt and the assembly COM shifts.
    this.refreshConstraintAnchors(h, sourceAssembly, targetAssembly);

    // Compute current distance between anchor points
    const srcAnchor = bodyLocalToWorld(sourceAssembly.rootBody, h.sourceLocalAnchor.x, h.sourceLocalAnchor.y);
    const tgtAnchor = bodyLocalToWorld(targetAssembly.rootBody, h.targetLocalAnchor.x, h.targetLocalAnchor.y);
    const dx = tgtAnchor.x - srcAnchor.x;
    const dy = tgtAnchor.y - srcAnchor.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Snap if way overstretched
    if (dist > TETHER_BREAK_LENGTH) {
      h.destroyed = true;
      return;
    }

    if (dist <= h.tetherLength) {
      // Slack — zero BOTH stiffness and damping.
      // Damping alone applies velocity-dependent forces even with stiffness=0.
      h.constraint.stiffness = 0;
      h.constraint.damping = 0;
    } else {
      // Overstretched — ramp stiffness with the square of overstretch.
      // t goes 0→1 over ELASTIC_RAMP_DISTANCE world units of overstretch.
      const overstretch = dist - h.tetherLength;
      const t = Math.min(1, overstretch / ELASTIC_RAMP_DISTANCE);
      h.constraint.stiffness = ELASTIC_MAX_STIFFNESS * t * t;
      h.constraint.damping = ELASTIC_DAMPING * t;
    }
  }

  /**
   * Recompute constraint pointA/pointB from entity part bodies each frame.
   * Entity part bodies rotate with the compound but their position is always
   * correct in world space. Converting through them avoids COM-relative drift
   * when the compound body is rebuilt after block destruction.
   */
  private refreshConstraintAnchors(
    h: ActiveHarpoon,
    sourceAssembly: HarpoonTarget,
    targetAssembly: HarpoonTarget,
  ): void {
    if (!h.constraint) return;

    // Source anchor: entity part body → world → assembly-COM-local
    if (h.sourcePartBody) {
      const srcWorld = bodyLocalToWorld(h.sourcePartBody, h.sourceEntityOffset.x, h.sourceEntityOffset.y);
      const newPointA = worldToBodyLocal(sourceAssembly.rootBody, srcWorld.x, srcWorld.y);
      h.constraint.pointA = newPointA;
      h.sourceLocalAnchor = newPointA;
    }

    // Target anchor: entity part body → world → assembly-COM-local
    if (h.targetPartBody) {
      const tgtWorld = bodyLocalToWorld(h.targetPartBody, h.targetEntityOffset.x, h.targetEntityOffset.y);
      const newPointB = worldToBodyLocal(targetAssembly.rootBody, tgtWorld.x, tgtWorld.y);
      h.constraint.pointB = newPointB;
      h.targetLocalAnchor = newPointB;
    }

    // Also keep constraint body references in sync (compound body may have been rebuilt)
    if (h.constraint.bodyA !== sourceAssembly.rootBody) {
      h.constraint.bodyA = sourceAssembly.rootBody;
    }
    if (h.constraint.bodyB !== targetAssembly.rootBody) {
      h.constraint.bodyB = targetAssembly.rootBody;
    }
  }

  /**
   * Handle harpoon hitting an entity, called from raycast with precise positions.
   * @param hitPos — exact surface intersection on the target (from raycast)
   * @param sourceMuzzlePos — current world-space muzzle position of the weapon entity
   * @param hitEntityBody — the specific part body that was hit on the target assembly
   */
  public handleHarpoonHit(
    harpoon: ActiveHarpoon,
    targetAssembly: HarpoonTarget,
    sourceAssembly: HarpoonTarget | undefined,
    hitPos: { x: number; y: number },
    sourceMuzzlePos: { x: number; y: number },
    hitEntityBody?: Matter.Body,
  ): boolean {
    if (harpoon.destroyed) return false;
    if (harpoon.state !== 'flying') return false;
    if (harpoon.age < HARPOON_LAUNCH_DELAY) return false;

    // Don't tether to self
    if (targetAssembly.id === harpoon.sourceAssemblyId) return false;

    // Don't tether to same team
    if (targetAssembly.team === harpoon.sourceTeam) return false;

    if (!sourceAssembly || sourceAssembly.destroyed) {
      harpoon.destroyed = true;
      return false;
    }

    // Shield interception
    if (targetAssembly.damageShield) {
      if (targetAssembly.damageShield(HARPOON_DAMAGE, Date.now())) {
        harpoon.destroyed = true;
        return true;
      }
    }

    SoundSystem.getInstance().playLaserImpact();

    // Remove the projectile body from the world
    if (harpoon.projectileBody) {
      Matter.World.remove(this.world, harpoon.projectileBody);
      harpoon.projectileBody = null;
    }
    harpoon.targetAssemblyId = targetAssembly.id;
    harpoon.state = 'tethered';

    // Store target entity part body and entity-local offset for rotation-correct tracking.
    if (hitEntityBody) {
      harpoon.targetPartBody = hitEntityBody;
      harpoon.targetEntityOffset = worldToBodyLocal(hitEntityBody, hitPos.x, hitPos.y);
    }

    // Compute assembly-COM-relative anchors from entity part bodies.
    // These are used by the constraint and updated each frame in updateTether
    // to stay correct even if the compound body is rebuilt (COM shift).
    const sourceWorld = this.getEntityAnchorWorld(harpoon.sourcePartBody, harpoon.sourceEntityOffset, sourceMuzzlePos);
    const targetWorld = hitPos;

    const pointA = worldToBodyLocal(sourceAssembly.rootBody, sourceWorld.x, sourceWorld.y);
    const pointB = worldToBodyLocal(targetAssembly.rootBody, targetWorld.x, targetWorld.y);
    harpoon.sourceLocalAnchor = pointA;
    harpoon.targetLocalAnchor = pointB;

    // Tether length = distance between anchors at moment of impact
    harpoon.tetherLength = Math.sqrt(
      (sourceWorld.x - targetWorld.x) ** 2 + (sourceWorld.y - targetWorld.y) ** 2,
    );

    // Create constraint — starts fully slack; updateTether ramps stiffness & damping
    const constraint = Matter.Constraint.create({
      bodyA: sourceAssembly.rootBody,
      pointA,
      bodyB: targetAssembly.rootBody,
      pointB,
      length: harpoon.tetherLength,
      stiffness: 0,
      damping: 0,
      render: { visible: false },
    });

    Matter.World.add(this.world, constraint);
    harpoon.constraint = constraint;

    // Track attacker
    targetAssembly.lastHitByAssemblyId = harpoon.sourceAssemblyId;
    targetAssembly.lastHitByPlayer = sourceAssembly?.isPlayerControlled ?? false;

    return true;
  }

  /** Compute world position of an anchor from its entity part body + entity-local offset. */
  private getEntityAnchorWorld(
    partBody: Matter.Body | null,
    entityOffset: Vector2,
    fallback: { x: number; y: number },
  ): { x: number; y: number } {
    if (!partBody) return fallback;
    return bodyLocalToWorld(partBody, entityOffset.x, entityOffset.y);
  }

  private removeHarpoon(h: ActiveHarpoon): void {
    if (h.projectileBody) {
      Matter.World.remove(this.world, h.projectileBody);
      h.projectileBody = null;
    }
    if (h.constraint) {
      Matter.World.remove(this.world, h.constraint);
      h.constraint = null;
    }
  }

  public getActiveHarpoons(): ActiveHarpoon[] {
    return this.harpoons.filter(h => !h.destroyed);
  }

  public cleanup(): void {
    for (const h of this.harpoons) {
      this.removeHarpoon(h);
    }
    this.harpoons = [];
  }
}
