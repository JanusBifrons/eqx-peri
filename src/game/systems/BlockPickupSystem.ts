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
  /** 0–3: number of 90° CCW steps applied to the held piece (relative to player orientation). */
  private pendingRotationSteps: number = 0;
  /** Last known player assembly angle, used to render the free-float ghost at the intended orientation. */
  private lastKnownPlayerAngle: number = 0;

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
   * Cycle the held piece through 90° rotation increments (CCW relative to player orientation).
   * No-op when not holding anything.
   */
  public rotateHeld(): void {
    if (!this.heldAssembly) return;
    this.pendingRotationSteps = (this.pendingRotationSteps + 1) % 4;
    // Recompute snap with the new rotation so the preview updates immediately.
    this.activeSnap = null;
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
          this.pendingRotationSteps = 0;
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

    this.lastKnownPlayerAngle = playerAssembly.rootBody.angle;
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
    const relativeAngle = this.pendingRotationSteps * (Math.PI / 2);

    const localDirs: Vector2[] = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    ];

    const occupiedOffsets = new Set<string>();
    playerAssembly.entities.forEach(e => {
      occupiedOffsets.add(`${e.localOffset.x},${e.localOffset.y}`);
    });

    const threshold = this.activeSnap ? DETACH_RADIUS : SNAP_RADIUS;
    const cosA = Math.cos(playerAngle);
    const sinA = Math.sin(playerAngle);

    // Build ALL (heldEntity, playerSlot) pairs that are type-compatible and within range.
    // Sorting the full cross-product globally guarantees we always try the truly nearest
    // pair first, regardless of which player entity or direction it comes from.
    // The old per-slot "nearest only" approach would skip the second-nearest entity to a
    // given slot even when that entity was the only collision-free option for that slot.
    type Pair = {
      heldEntity: Entity;
      targetEntity: Entity;
      localDir: Vector2;
      candidateLocalOffset: Vector2;
      dist: number;
    };
    const pairs: Pair[] = [];

    for (const targetEntity of playerAssembly.entities) {
      const targetDef = ENTITY_DEFINITIONS[targetEntity.type];
      if (!targetDef) continue;

      for (const localDir of localDirs) {
        const candidateLocalOffset: Vector2 = {
          x: targetEntity.localOffset.x + localDir.x * GRID_SIZE,
          y: targetEntity.localOffset.y + localDir.y * GRID_SIZE,
        };
        if (occupiedOffsets.has(`${candidateLocalOffset.x},${candidateLocalOffset.y}`)) continue;

        const slotWorldX = targetEntity.body.position.x + (localDir.x * cosA - localDir.y * sinA) * GRID_SIZE;
        const slotWorldY = targetEntity.body.position.y + (localDir.x * sinA + localDir.y * cosA) * GRID_SIZE;

        for (const heldEntity of this.heldAssembly.entities) {
          const anchorDef = ENTITY_DEFINITIONS[heldEntity.type];
          if (!anchorDef) continue;
          // Filter incompatible pairs before sorting — no point sorting work we'll discard
          if (!anchorDef.canAttachTo.includes(targetEntity.type)) continue;
          if (!targetDef.canAttachTo.includes(heldEntity.type)) continue;

          const ghostPos = this.getHeldEntityWorldPos(heldEntity);
          const dx = ghostPos.x - slotWorldX;
          const dy = ghostPos.y - slotWorldY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < threshold) {
            pairs.push({ heldEntity, targetEntity, localDir, candidateLocalOffset, dist });
          }
        }
      }
    }

    // Sort ascending by distance so we always try the closest pair first
    pairs.sort((a, b) => a.dist - b.dist);

    // Walk in order and return the first pair whose placement is collision-free
    for (const pair of pairs) {
      const preview = this.computePreviewOffsets(
        pair.heldEntity,
        pair.candidateLocalOffset,
        relativeAngle,
        playerAssembly
      );
      if (!preview) continue;

      return {
        anchorEntity: pair.heldEntity,
        targetEntity: pair.targetEntity,
        snapDirection: pair.localDir,
        relativeAngle,
        previewLocalOffsets: preview,
        dist: pair.dist,
      };
    }

    return null;
  }

  /**
   * Compute the ghost world position of a held entity for snap-distance calculation.
   * Uses the GHOST angle (player orientation + pending rotation steps), not the body's
   * physical angle — the physical angle is whatever the block was spinning at when
   * picked up and bears no relation to where the visual ghost is drawn.
   */
  private getHeldEntityWorldPos(entity: Entity): Vector2 {
    if (!this.heldAssembly) return { ...this.heldWorldPos };

    const ghostAngle = this.lastKnownPlayerAngle + this.pendingRotationSteps * (Math.PI / 2);
    const heldEntities = this.heldAssembly.entities;

    const centerLocalX = heldEntities.reduce((s, e) => s + e.localOffset.x, 0) / heldEntities.length;
    const centerLocalY = heldEntities.reduce((s, e) => s + e.localOffset.y, 0) / heldEntities.length;

    const relX = entity.localOffset.x - centerLocalX;
    const relY = entity.localOffset.y - centerLocalY;

    const cosH = Math.cos(ghostAngle);
    const sinH = Math.sin(ghostAngle);
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

    // --- Cursor ghost: always drawn at the mouse position ---
    // ghostAngle is used for entity layout (spreading multi-block assemblies correctly).
    // ctx.rotate uses lastKnownPlayerAngle as the base because displayRotation already
    // includes the pending rotation offset — adding ghostAngle would double-apply it.
    const heldEntities = this.heldAssembly.entities;
    const ghostAngle = this.lastKnownPlayerAngle + this.pendingRotationSteps * (Math.PI / 2);
    const pendingDegrees = this.pendingRotationSteps * 90;
    const cosH = Math.cos(ghostAngle);
    const sinH = Math.sin(ghostAngle);

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

      // displayRotation = entity's own rotation + pending steps; used as the sole
      // rotation argument so the pending offset is applied exactly once.
      const displayRotation = ((entity.rotation + pendingDegrees) % 360 + 360) % 360;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.lastKnownPlayerAngle + (displayRotation * Math.PI / 180));
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#ffff88';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();

      ctx.globalAlpha = 0.75;
      entity.drawBlockFrills(ctx, bounds, canvas, this.lastKnownPlayerAngle, { x: worldX, y: worldY }, displayRotation);
      ctx.globalAlpha = 1;
    });

    // --- Snap preview: drawn in addition to the cursor ghost when a valid slot is nearby ---
    // For each held entity we compute its individual ghost world position.
    //   • Active anchor  → bright dashed line from its ghost pos to its exact snap landing pos
    //                       + small dot at the ghost to mark which block is snapping
    //   • Other entities → faint line to their nearest compatible open player slot
    //                       (alpha fades with distance; shows all reachable snap points)
    if (this.activeSnap && playerAssembly && !playerAssembly.destroyed) {
      const playerAngle = playerAssembly.rootBody.angle;
      const refEntity = this.activeSnap.targetEntity;
      const cosP = Math.cos(playerAngle);
      const sinP = Math.sin(playerAngle);
      const activeAnchorId = this.activeSnap.anchorEntity.id;

      // Precompute occupied offsets + open-slot world positions for hint lines
      const occupiedOffsets = new Set<string>();
      playerAssembly.entities.forEach(e => {
        occupiedOffsets.add(`${e.localOffset.x},${e.localOffset.y}`);
      });
      const localDirs = [
        { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      ];
      const HINT_RANGE = DETACH_RADIUS * 2.5;

      for (const heldEntity of heldEntities) {
        // Ghost world position of this specific entity (same math as cursor ghost section)
        const relX = heldEntity.localOffset.x - centerLocalX;
        const relY = heldEntity.localOffset.y - centerLocalY;
        const ghostX = this.heldWorldPos.x + relX * cosH - relY * sinH;
        const ghostY = this.heldWorldPos.y + relX * sinH + relY * cosH;

        if (heldEntity.id === activeAnchorId) {
          // Bright line: anchor ghost position → exact snap landing position
          const anchorSnapData = this.activeSnap.previewLocalOffsets.get(heldEntity.id);
          if (anchorSnapData) {
            const dlx = anchorSnapData.localOffset.x - refEntity.localOffset.x;
            const dly = anchorSnapData.localOffset.y - refEntity.localOffset.y;
            const landX = refEntity.body.position.x + dlx * cosP - dly * sinP;
            const landY = refEntity.body.position.y + dlx * sinP + dly * cosP;

            ctx.save();
            ctx.globalAlpha = 0.75;
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(toCanvasX(ghostX), toCanvasY(ghostY));
            ctx.lineTo(toCanvasX(landX), toCanvasY(landY));
            ctx.stroke();
            // Dot at the anchor ghost to make clear which block is the snap point
            ctx.setLineDash([]);
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = '#00ff88';
            ctx.beginPath();
            ctx.arc(toCanvasX(ghostX), toCanvasY(ghostY), 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        } else {
          // Faint hint: find nearest compatible open slot for this entity
          const anchorDef = ENTITY_DEFINITIONS[heldEntity.type];
          if (!anchorDef) continue;

          let nearestDist = HINT_RANGE;
          let nearestSlotX = 0;
          let nearestSlotY = 0;
          let found = false;

          for (const targetEntity of playerAssembly.entities) {
            const targetDef = ENTITY_DEFINITIONS[targetEntity.type];
            if (!targetDef) continue;
            if (!anchorDef.canAttachTo.includes(targetEntity.type)) continue;
            if (!targetDef.canAttachTo.includes(heldEntity.type)) continue;

            for (const dir of localDirs) {
              const cX = targetEntity.localOffset.x + dir.x * GRID_SIZE;
              const cY = targetEntity.localOffset.y + dir.y * GRID_SIZE;
              if (occupiedOffsets.has(`${cX},${cY}`)) continue;

              const slotWX = targetEntity.body.position.x + (dir.x * cosP - dir.y * sinP) * GRID_SIZE;
              const slotWY = targetEntity.body.position.y + (dir.x * sinP + dir.y * cosP) * GRID_SIZE;

              const dx = ghostX - slotWX;
              const dy = ghostY - slotWY;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < nearestDist) {
                nearestDist = dist;
                nearestSlotX = slotWX;
                nearestSlotY = slotWY;
                found = true;
              }
            }
          }

          if (found) {
            ctx.save();
            ctx.globalAlpha = 0.25 * Math.max(0, 1 - nearestDist / HINT_RANGE);
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 5]);
            ctx.beginPath();
            ctx.moveTo(toCanvasX(ghostX), toCanvasY(ghostY));
            ctx.lineTo(toCanvasX(nearestSlotX), toCanvasY(nearestSlotY));
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // Green border around the target attachment cell on the player assembly
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
