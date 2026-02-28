import * as Matter from 'matter-js';
import { Assembly } from '../core/Assembly';
import { Entity } from '../core/Entity';
import { Vector2, GRID_SIZE, ENTITY_DEFINITIONS } from '../../types/GameTypes';

interface SnapCandidate {
  anchorEntity: Entity;       // entity in heldAssembly closest to the attachment slot
  targetEntity: Entity;       // entity in playerAssembly beside the attachment slot
  snapDirection: Vector2;     // unit grid direction in player-LOCAL space (+x/-x/+y/-y)
  relativeAngle: number;      // angle to rotate held assembly, in radians, rounded to nearest π/2
  previewLocalOffsets: Map<string, { localOffset: Vector2; rotation: number }>;
  dist: number;
}

// World pixels: enter snap zone / exit snap zone (hysteresis)
const SNAP_RADIUS = 48;
const DETACH_RADIUS = 64;

export class BlockPickupSystem {
  private heldAssembly: Assembly | null = null;
  private activeSnap: SnapCandidate | null = null;
  private heldWorldPos: Vector2 = { x: 0, y: 0 };

  private readonly doRemoveBodyWithParts: (body: Matter.Body) => void;
  private readonly doAddBodyToWorld: (body: Matter.Body) => void;
  /** Called when an assembly is picked up — remove it from the engine's tracked list. */
  private readonly onPickUp: (assembly: Assembly) => void;
  /** Called when an assembly is dropped back (no snap) — add it back to the tracked list. */
  private readonly onDrop: (assembly: Assembly) => void;

  constructor(
    removeBodyWithParts: (body: Matter.Body) => void,
    addBodyToWorld: (body: Matter.Body) => void,
    onPickUp: (assembly: Assembly) => void,
    onDrop: (assembly: Assembly) => void
  ) {
    this.doRemoveBodyWithParts = removeBodyWithParts;
    this.doAddBodyToWorld = addBodyToWorld;
    this.onPickUp = onPickUp;
    this.onDrop = onDrop;
  }

  public isHolding(): boolean {
    return this.heldAssembly !== null;
  }

  /**
   * Try to pick up a non-cockpit assembly at the given world position.
   * Returns true if something was picked up.
   */
  public tryPickUp(
    worldPos: Vector2,
    assemblies: Assembly[],
    playerAssembly: Assembly | null
  ): boolean {
    for (const assembly of assemblies) {
      if (assembly.destroyed) continue;
      if (assembly.hasControlCenter()) continue;
      if (assembly === playerAssembly) continue;

      for (const entity of assembly.entities) {
        const bounds = entity.body.bounds;
        if (
          worldPos.x >= bounds.min.x && worldPos.x <= bounds.max.x &&
          worldPos.y >= bounds.min.y && worldPos.y <= bounds.max.y
        ) {
          this.heldAssembly = assembly;
          this.heldWorldPos = { ...worldPos };
          this.activeSnap = null;
          // Remove from physics world AND from the engine's tracked assembly list so
          // the orphaned entity bodies don't interfere with hover/snap detection.
          this.doRemoveBodyWithParts(assembly.rootBody);
          this.onPickUp(assembly);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Called each frame while holding.  Updates held position and recalculates snap candidate.
   */
  public update(mouseWorldPos: Vector2, playerAssembly: Assembly | null): void {
    if (!this.heldAssembly) return;

    if (this.heldAssembly.destroyed) {
      this.heldAssembly = null;
      this.activeSnap = null;
      return;
    }

    this.heldWorldPos = { ...mouseWorldPos };

    if (!playerAssembly || playerAssembly.destroyed) {
      this.activeSnap = null;
      return;
    }

    this.activeSnap = this.findBestSnap(playerAssembly);
  }

  /**
   * Drop or attach the held assembly.
   * If there is an active snap candidate and the player ship is alive, attach.
   * Otherwise place the assembly back in the physics world at the current cursor position.
   */
  public tryRelease(playerAssembly: Assembly | null): void {
    if (!this.heldAssembly) return;

    if (this.activeSnap && playerAssembly && !playerAssembly.destroyed) {
      // Attach: assembly is absorbed — body and list entry were already removed on pickup.
      playerAssembly.attachExternalAssembly(this.heldAssembly, this.activeSnap.previewLocalOffsets);
    } else {
      // Drop: put the assembly back into the physics world AND the tracked list.
      Matter.Body.setPosition(this.heldAssembly.rootBody, this.heldWorldPos);
      this.doAddBodyToWorld(this.heldAssembly.rootBody);
      this.onDrop(this.heldAssembly);
    }

    this.heldAssembly = null;
    this.activeSnap = null;
  }

  /**
   * Immediately drop the held assembly into the physics world (used when player dies).
   */
  public forceDropAtCurrentPosition(): void {
    if (!this.heldAssembly) return;
    Matter.Body.setPosition(this.heldAssembly.rootBody, this.heldWorldPos);
    this.doAddBodyToWorld(this.heldAssembly.rootBody);
    this.onDrop(this.heldAssembly);
    this.heldAssembly = null;
    this.activeSnap = null;
  }

  // ---------------------------------------------------------------------------
  // Snap detection
  // ---------------------------------------------------------------------------

  private findBestSnap(playerAssembly: Assembly): SnapCandidate | null {
    if (!this.heldAssembly) return null;

    const playerAngle = playerAssembly.rootBody.angle;
    const heldAngle = this.heldAssembly.rootBody.angle;

    // Round relative angle to nearest 90°
    const alpha_rel = heldAngle - playerAngle;
    const relativeAngle = Math.round(alpha_rel / (Math.PI / 2)) * (Math.PI / 2);

    // Four cardinal attachment directions in player-local space
    const localDirs: Vector2[] = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];

    // Set of occupied local offsets in the player assembly
    const occupiedOffsets = new Set<string>();
    playerAssembly.entities.forEach(e => {
      occupiedOffsets.add(`${e.localOffset.x},${e.localOffset.y}`);
    });

    const threshold = this.activeSnap ? DETACH_RADIUS : SNAP_RADIUS;
    let bestDist = threshold;
    let bestCandidate: SnapCandidate | null = null;

    for (const targetEntity of playerAssembly.entities) {
      const targetDef = ENTITY_DEFINITIONS[targetEntity.type];
      if (!targetDef) continue;

      for (const localDir of localDirs) {
        const candidateLocalOffset: Vector2 = {
          x: targetEntity.localOffset.x + localDir.x * GRID_SIZE,
          y: targetEntity.localOffset.y + localDir.y * GRID_SIZE,
        };

        if (occupiedOffsets.has(`${candidateLocalOffset.x},${candidateLocalOffset.y}`)) continue;

        // Rotate local direction into world space
        const cosA = Math.cos(playerAngle);
        const sinA = Math.sin(playerAngle);
        const worldDirX = localDir.x * cosA - localDir.y * sinA;
        const worldDirY = localDir.x * sinA + localDir.y * cosA;

        const candidateWorldPos: Vector2 = {
          x: targetEntity.body.position.x + worldDirX * GRID_SIZE,
          y: targetEntity.body.position.y + worldDirY * GRID_SIZE,
        };

        // Find nearest entity in heldAssembly to this candidate world position
        let nearestEntity: Entity | null = null;
        let nearestDist = Infinity;

        for (const heldEntity of this.heldAssembly.entities) {
          const entityWorldPos = this.getHeldEntityWorldPos(heldEntity);
          const dx = entityWorldPos.x - candidateWorldPos.x;
          const dy = entityWorldPos.y - candidateWorldPos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestEntity = heldEntity;
          }
        }

        if (!nearestEntity || nearestDist >= bestDist) continue;

        // Type compatibility: both sides must mutually accept each other
        const anchorDef = ENTITY_DEFINITIONS[nearestEntity.type];
        if (!anchorDef) continue;
        if (
          !anchorDef.canAttachTo.includes(targetEntity.type) ||
          !targetDef.canAttachTo.includes(nearestEntity.type)
        ) continue;

        // Compute final grid positions for all held entities; reject if any would overlap
        const preview = this.computePreviewOffsets(
          nearestEntity,
          candidateLocalOffset,
          relativeAngle,
          playerAssembly
        );
        if (!preview) continue;

        bestDist = nearestDist;
        bestCandidate = {
          anchorEntity: nearestEntity,
          targetEntity,
          snapDirection: localDir,
          relativeAngle,
          previewLocalOffsets: preview,
          dist: nearestDist,
        };
      }
    }

    return bestCandidate;
  }

  /**
   * Compute the world position of a held entity for snap-distance calculation.
   * The centre of the held assembly tracks heldWorldPos; entities are offset from there.
   */
  private getHeldEntityWorldPos(entity: Entity): Vector2 {
    if (!this.heldAssembly) return { ...this.heldWorldPos };

    const heldEntities = this.heldAssembly.entities;
    const heldAngle = this.heldAssembly.rootBody.angle;

    // Geometric centre of held assembly in local space
    const centerLocalX = heldEntities.reduce((s, e) => s + e.localOffset.x, 0) / heldEntities.length;
    const centerLocalY = heldEntities.reduce((s, e) => s + e.localOffset.y, 0) / heldEntities.length;

    const relX = entity.localOffset.x - centerLocalX;
    const relY = entity.localOffset.y - centerLocalY;

    const cosH = Math.cos(heldAngle);
    const sinH = Math.sin(heldAngle);
    return {
      x: this.heldWorldPos.x + relX * cosH - relY * sinH,
      y: this.heldWorldPos.y + relX * sinH + relY * cosH,
    };
  }

  /**
   * Compute final player-space localOffsets for every entity in the held assembly,
   * rotating by relativeAngle and shifting so anchorEntity lands at anchorTargetLocalOffset.
   * Returns null if any final position would collide with an existing player entity.
   */
  private computePreviewOffsets(
    anchorEntity: Entity,
    anchorTargetLocalOffset: Vector2,
    relativeAngle: number,
    playerAssembly: Assembly
  ): Map<string, { localOffset: Vector2; rotation: number }> | null {
    if (!this.heldAssembly) return null;

    const cosA = Math.cos(relativeAngle);
    const sinA = Math.sin(relativeAngle);

    // Grid-snap a raw pixel value to the nearest GRID_SIZE multiple
    const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE;

    // Rotate anchor's local offset and grid-snap
    const ax = anchorEntity.localOffset.x;
    const ay = anchorEntity.localOffset.y;
    const rotatedAnchorX = snap(ax * cosA - ay * sinA);
    const rotatedAnchorY = snap(ax * sinA + ay * cosA);

    const shiftX = anchorTargetLocalOffset.x - rotatedAnchorX;
    const shiftY = anchorTargetLocalOffset.y - rotatedAnchorY;

    const rotateDegrees = Math.round(relativeAngle * 180 / Math.PI);

    // Pre-build the set of occupied offsets for collision checking
    const occupiedOffsets = new Set<string>();
    playerAssembly.entities.forEach(e => {
      occupiedOffsets.add(`${e.localOffset.x},${e.localOffset.y}`);
    });

    const result = new Map<string, { localOffset: Vector2; rotation: number }>();

    for (const entity of this.heldAssembly.entities) {
      const lx = entity.localOffset.x;
      const ly = entity.localOffset.y;

      const finalX = snap(lx * cosA - ly * sinA) + shiftX;
      const finalY = snap(lx * sinA + ly * cosA) + shiftY;

      if (occupiedOffsets.has(`${finalX},${finalY}`)) return null;

      const newRotation = ((entity.rotation + rotateDegrees) % 360 + 360) % 360;
      result.set(entity.id, { localOffset: { x: finalX, y: finalY }, rotation: newRotation });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  public renderOverlay(
    ctx: CanvasRenderingContext2D,
    bounds: Matter.Bounds,
    playerAssembly: Assembly | null
  ): void {
    if (!this.heldAssembly) return;

    const canvas = ctx.canvas;
    const scaleX = canvas.width / (bounds.max.x - bounds.min.x);
    const scaleY = canvas.height / (bounds.max.y - bounds.min.y);

    const toCanvasX = (wx: number) => (wx - bounds.min.x) * scaleX;
    const toCanvasY = (wy: number) => (wy - bounds.min.y) * scaleY;

    ctx.save();

    // Show available attachment slots on player assembly whenever holding a block
    if (playerAssembly && !playerAssembly.destroyed) {
      this.renderAvailableSlots(ctx, bounds, playerAssembly);
    }

    if (this.activeSnap && playerAssembly && !playerAssembly.destroyed) {
      const playerAngle = playerAssembly.rootBody.angle;

      // rootBody.position is the compound's centre of mass, NOT the localOffset
      // coordinate origin.  Use a real entity (targetEntity) as a reference anchor:
      //   worldPos(lx, ly) = refEntity.body.position + rotate((lx−refLx, ly−refLy), angle)
      const refEntity = this.activeSnap.targetEntity;
      const cosP = Math.cos(playerAngle);
      const sinP = Math.sin(playerAngle);

      // Draw each held entity at its snapped grid position (ghost, green tint + frills)
      this.activeSnap.previewLocalOffsets.forEach((data, entityId) => {
        const entity = this.heldAssembly!.entities.find(e => e.id === entityId);
        if (!entity) return;

        const def = ENTITY_DEFINITIONS[entity.type];
        const dlx = data.localOffset.x - refEntity.localOffset.x;
        const dly = data.localOffset.y - refEntity.localOffset.y;

        const worldX = refEntity.body.position.x + dlx * cosP - dly * sinP;
        const worldY = refEntity.body.position.y + dlx * sinP + dly * cosP;

        const cx = toCanvasX(worldX);
        const cy = toCanvasY(worldY);
        const w = def.width * scaleX;
        const h = def.height * scaleY;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(playerAngle + (data.rotation * Math.PI / 180));
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#00ff88';
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.restore();

        // Draw frills at the snapped world position so orientation is clear
        ctx.globalAlpha = 0.8;
        entity.drawBlockFrills(ctx, bounds, canvas, playerAngle, { x: worldX, y: worldY }, data.rotation);
        ctx.globalAlpha = 1;
      });

      // Draw a bright green border around the target attachment cell
      const target = this.activeSnap.targetEntity;
      const dir = this.activeSnap.snapDirection;
      const attachWorldX = target.body.position.x + (dir.x * cosP - dir.y * sinP) * GRID_SIZE;
      const attachWorldY = target.body.position.y + (dir.x * sinP + dir.y * cosP) * GRID_SIZE;

      ctx.save();
      ctx.translate(toCanvasX(attachWorldX), toCanvasY(attachWorldY));
      ctx.rotate(playerAngle);
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        -GRID_SIZE * scaleX / 2,
        -GRID_SIZE * scaleY / 2,
        GRID_SIZE * scaleX,
        GRID_SIZE * scaleY
      );
      ctx.restore();
    } else {
      // Free-floating: draw ghost at cursor (yellow tint + frills for orientation)
      const heldEntities = this.heldAssembly.entities;
      const heldAngle = this.heldAssembly.rootBody.angle;
      const cosH = Math.cos(heldAngle);
      const sinH = Math.sin(heldAngle);

      const centerLocalX = heldEntities.reduce((s, e) => s + e.localOffset.x, 0) / heldEntities.length;
      const centerLocalY = heldEntities.reduce((s, e) => s + e.localOffset.y, 0) / heldEntities.length;

      heldEntities.forEach(entity => {
        const def = ENTITY_DEFINITIONS[entity.type];
        const relX = entity.localOffset.x - centerLocalX;
        const relY = entity.localOffset.y - centerLocalY;

        const worldX = this.heldWorldPos.x + relX * cosH - relY * sinH;
        const worldY = this.heldWorldPos.y + relX * sinH + relY * cosH;

        const cx = toCanvasX(worldX);
        const cy = toCanvasY(worldY);
        const w = def.width * scaleX;
        const h = def.height * scaleY;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(heldAngle + (entity.rotation * Math.PI / 180));
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#ffff88';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.restore();

        // Draw frills so the player can tell the block's orientation while dragging
        ctx.globalAlpha = 0.75;
        entity.drawBlockFrills(ctx, bounds, canvas, heldAngle, { x: worldX, y: worldY }, entity.rotation);
        ctx.globalAlpha = 1;
      });
    }

    ctx.restore();
  }

  /**
   * Draw dashed cyan outlines at every open adjacent slot on the player's assembly.
   * Gives the player a spatial map of where they can attach the held block.
   */
  private renderAvailableSlots(
    ctx: CanvasRenderingContext2D,
    bounds: Matter.Bounds,
    playerAssembly: Assembly
  ): void {
    const canvas = ctx.canvas;
    const scaleX = canvas.width / (bounds.max.x - bounds.min.x);
    const scaleY = canvas.height / (bounds.max.y - bounds.min.y);
    const toCanvasX = (wx: number) => (wx - bounds.min.x) * scaleX;
    const toCanvasY = (wy: number) => (wy - bounds.min.y) * scaleY;

    const playerAngle = playerAssembly.rootBody.angle;
    const cosP = Math.cos(playerAngle);
    const sinP = Math.sin(playerAngle);

    const occupiedOffsets = new Set<string>();
    playerAssembly.entities.forEach(e => {
      occupiedOffsets.add(`${e.localOffset.x},${e.localOffset.y}`);
    });

    const localDirs: { x: number; y: number }[] = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    ];

    // Track drawn slots to avoid duplicating indicators for shared edges
    const drawnSlots = new Set<string>();

    ctx.save();
    for (const entity of playerAssembly.entities) {
      for (const dir of localDirs) {
        const candidateX = entity.localOffset.x + dir.x * GRID_SIZE;
        const candidateY = entity.localOffset.y + dir.y * GRID_SIZE;
        const key = `${candidateX},${candidateY}`;

        if (occupiedOffsets.has(key) || drawnSlots.has(key)) continue;
        drawnSlots.add(key);

        // World position of this adjacent slot (relative to the entity body that borders it)
        const worldX = entity.body.position.x + (dir.x * cosP - dir.y * sinP) * GRID_SIZE;
        const worldY = entity.body.position.y + (dir.x * sinP + dir.y * cosP) * GRID_SIZE;

        ctx.save();
        ctx.translate(toCanvasX(worldX), toCanvasY(worldY));
        ctx.rotate(playerAngle);
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#00ccff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(
          -GRID_SIZE * scaleX / 2,
          -GRID_SIZE * scaleY / 2,
          GRID_SIZE * scaleX,
          GRID_SIZE * scaleY
        );
        ctx.restore();
      }
    }
    ctx.restore();
  }
}
