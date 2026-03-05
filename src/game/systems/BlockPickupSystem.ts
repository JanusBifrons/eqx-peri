import * as Matter from 'matter-js';
import * as PIXI from 'pixi.js';
import { Assembly } from '../core/Assembly';
import { Entity } from '../core/Entity';
import { Vector2, GRID_SIZE, ENTITY_DEFINITIONS } from '../../types/GameTypes';
import { Viewport } from '../rendering/Viewport';

interface SnapCandidate {
  anchorEntity: Entity;       // entity in heldAssembly closest to the attachment slot
  targetEntity: Entity;       // entity in the snap-target assembly beside the attachment slot
  targetAssembly: Assembly;   // the assembly we are snapping onto
  snapDirection: Vector2;     // unit grid direction in target-LOCAL space (+x/-x/+y/-y)
  relativeAngle: number;      // angle to rotate held assembly, in radians, rounded to nearest π/2
  previewLocalOffsets: Map<string, { localOffset: Vector2; rotation: number }>;
  dist: number;
}

interface PreDetachState {
  entity: Entity;
  playerAssembly: Assembly;
}

interface PendingPickupState {
  assembly: Assembly;
  startScreenPos: { x: number; y: number };
  startTime: number;
}

interface ActiveDragState {
  heldAssembly: Assembly;
  cursorBody: Matter.Body;
  spring: Matter.Constraint;
  originalCollisionFilter: { category: number; mask: number; group: number };
}

// World pixels: enter snap zone / exit snap zone (hysteresis)
const SNAP_RADIUS = 48;
const DETACH_RADIUS = 64;

// Physics-drag constants
const DETACH_PULL_THRESHOLD = 40;  // px — how far to pull before block pops off

// Floating-block pickup thresholds — drag only starts after one of these is exceeded
const DRAG_HOLD_MS = 400;        // hold mousedown this long to start drag
const DRAG_MIN_SCREEN_PX = 6;    // or move this many screen pixels while held
const SPRING_STIFFNESS = 0.04;
const SPRING_DAMPING = 0.1;
const SPRING_LENGTH = 0;
const CURSOR_BODY_RADIUS = 4;

export class BlockPickupSystem {
  private pendingPickupState: PendingPickupState | null = null;
  private preDetachState: PreDetachState | null = null;
  private activeDrag: ActiveDragState | null = null;
  private activeSnap: SnapCandidate | null = null;
  private lastCursorWorldPos: Vector2 = { x: 0, y: 0 };
  /** Number of 90° CCW rotation steps applied on top of the default player-aligned orientation. */
  private pendingRotationSteps: number = 0;
  /** The assembly currently serving as the snap/attach target (updated each frame by update()). */
  private snapTargetAssembly: Assembly | null = null;

  private readonly doRemoveBodyWithParts: (body: Matter.Body) => void;
  private readonly doAddBodyToWorld: (body: Matter.Body) => void;
  /** Called when an assembly is picked up — remove it from the engine's tracked list. */
  private readonly onPickUp: (assembly: Assembly) => void;
  /** Called when an assembly is dropped back (no snap) — add it back to the tracked list. */
  private readonly onDrop: (assembly: Assembly) => void;
  private readonly doAddConstraintToWorld: (c: Matter.Constraint) => void;
  private readonly doRemoveConstraintFromWorld: (c: Matter.Constraint) => void;

  constructor(
    removeBodyWithParts: (body: Matter.Body) => void,
    addBodyToWorld: (body: Matter.Body) => void,
    onPickUp: (assembly: Assembly) => void,
    onDrop: (assembly: Assembly) => void,
    addConstraintToWorld: (c: Matter.Constraint) => void,
    removeConstraintFromWorld: (c: Matter.Constraint) => void,
  ) {
    this.doRemoveBodyWithParts = removeBodyWithParts;
    this.doAddBodyToWorld = addBodyToWorld;
    this.onPickUp = onPickUp;
    this.onDrop = onDrop;
    this.doAddConstraintToWorld = addConstraintToWorld;
    this.doRemoveConstraintFromWorld = removeConstraintFromWorld;
  }

  /** True once a block is actually being dragged or pre-detached (not just pending). */
  public isHolding(): boolean {
    return this.preDetachState !== null || this.activeDrag !== null;
  }

  /** True during the hold/distance waiting period before drag actually begins. */
  public isPendingPickup(): boolean {
    return this.pendingPickupState !== null;
  }

  /** True when a block is actively being dragged (physics spring active). */
  public isDragging(): boolean {
    return this.activeDrag !== null;
  }

  public getHeldAssembly(): Assembly | null {
    return this.activeDrag?.heldAssembly ?? null;
  }

  /**
   * Cycle the held piece through 90° rotation increments relative to the player's orientation.
   * No-op when not dragging.
   */
  public rotateHeld(): void {
    if (!this.activeDrag) return;
    this.pendingRotationSteps = (this.pendingRotationSteps + 1) % 4;
    this.activeSnap = null;
  }

  /**
   * Try to pick up a block at the given world position.
   * Checks player's own blocks first (for pre-detach), then floating assemblies.
   * Returns true if an interaction was initiated (suppresses weapon fire).
   * Floating blocks enter a pending state — drag only starts after hold/distance threshold.
   */
  public tryPickUp(
    worldPos: Vector2,
    screenPos: { x: number; y: number },
    assemblies: Assembly[],
    playerAssembly: Assembly | null
  ): boolean {
    // Check player assembly blocks first
    if (playerAssembly && !playerAssembly.destroyed) {
      for (const entity of playerAssembly.entities) {
        const bounds = entity.body.bounds;
        if (
          worldPos.x >= bounds.min.x && worldPos.x <= bounds.max.x &&
          worldPos.y >= bounds.min.y && worldPos.y <= bounds.max.y
        ) {
          // Only initiate pre-detach if block can be detached without fragmenting ship
          if (playerAssembly.canDetachEntity(entity)) {
            this.preDetachState = { entity, playerAssembly };
            this.activeSnap = null;
            return true;
          }
          // Block found but not detachable (cockpit / load-bearing) — don't intercept click
          return false;
        }
      }
    }

    // Check floating assemblies (non-cockpit, non-player)
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
          // Don't drag immediately — wait for hold time or minimum movement
          this.pendingPickupState = {
            assembly,
            startScreenPos: { ...screenPos },
            startTime: performance.now(),
          };
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Called each frame. Advances pending → active drag if thresholds met,
   * then updates cursor position and recalculates snap candidate.
   */
  public update(mouseWorldPos: Vector2, mouseScreenPos: { x: number; y: number }, playerAssembly: Assembly | null): void {
    this.lastCursorWorldPos = { ...mouseWorldPos };

    // Check pending pickup: promote to active drag if hold time or distance exceeded
    if (this.pendingPickupState) {
      const { assembly, startScreenPos, startTime } = this.pendingPickupState;
      if (assembly.destroyed) {
        this.pendingPickupState = null;
      } else {
        const elapsed = performance.now() - startTime;
        const dx = mouseScreenPos.x - startScreenPos.x;
        const dy = mouseScreenPos.y - startScreenPos.y;
        const screenDist = Math.sqrt(dx * dx + dy * dy);
        if (elapsed >= DRAG_HOLD_MS || screenDist >= DRAG_MIN_SCREEN_PX) {
          this.pendingPickupState = null;
          this.startPhysicsDrag(assembly);
        }
      }
      return;
    }

    if (this.preDetachState) {
      const { entity, playerAssembly: pa } = this.preDetachState;
      if (pa.destroyed) {
        this.preDetachState = null;
        return;
      }
      const dx = mouseWorldPos.x - entity.body.position.x;
      const dy = mouseWorldPos.y - entity.body.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= DETACH_PULL_THRESHOLD) {
        this.triggerDetach(mouseWorldPos);
      }
      return;
    }

    // Track the current snap target (player's ship when piloting, nearest friendly when observing)
    this.snapTargetAssembly = playerAssembly;

    if (this.activeDrag) {
      if (this.activeDrag.heldAssembly.destroyed) {
        this.cancelDrag();
        return;
      }
      Matter.Body.setPosition(this.activeDrag.cursorBody, mouseWorldPos);
      if (this.snapTargetAssembly && !this.snapTargetAssembly.destroyed) {
        // Lock held body to snap-target orientation + R key offset so the player can see how it will attach
        const targetAngle = this.snapTargetAssembly.rootBody.angle + this.pendingRotationSteps * (Math.PI / 2);
        Matter.Body.setAngle(this.activeDrag.heldAssembly.rootBody, targetAngle);
        Matter.Body.setAngularVelocity(this.activeDrag.heldAssembly.rootBody, 0);
        this.activeSnap = this.findBestSnap(this.activeDrag.heldAssembly, this.snapTargetAssembly);
      } else {
        this.activeSnap = null;
      }
    }
  }

  /**
   * Drop or attach the held assembly.
   * If in pre-detach state, cancel it (released before pulling far enough).
   * If dragging with a valid snap, attach. Otherwise drop freely.
   */
  public tryRelease(): void {
    if (this.pendingPickupState) {
      // Released before reaching drag threshold — no-op, just cancel
      this.pendingPickupState = null;
      return;
    }

    if (this.preDetachState) {
      this.preDetachState = null;
      this.activeSnap = null;
      return;
    }

    if (!this.activeDrag) return;

    const drag = this.activeDrag;
    const snapTarget = this.activeSnap?.targetAssembly ?? null;

    if (this.activeSnap && snapTarget && !snapTarget.destroyed) {
      // Attach: remove held body from world first, then merge into snap-target assembly
      this.cleanupDragPhysics(drag);
      this.doRemoveBodyWithParts(drag.heldAssembly.rootBody);
      snapTarget.attachExternalAssembly(drag.heldAssembly, this.activeSnap.previewLocalOffsets);
    } else {
      // Drop: restore collision and re-add to tracked list (body stays in world)
      this.cleanupDragPhysics(drag);
      this.onDrop(drag.heldAssembly);
    }

    this.activeDrag = null;
    this.activeSnap = null;
  }

  /**
   * Immediately drop the held assembly into the physics world (used when player dies).
   */
  public forceDropAtCurrentPosition(): void {
    if (this.pendingPickupState) {
      this.pendingPickupState = null;
      return;
    }

    if (this.preDetachState) {
      this.preDetachState = null;
      return;
    }
    if (this.activeDrag) {
      this.cleanupDragPhysics(this.activeDrag);
      this.onDrop(this.activeDrag.heldAssembly);
      this.activeDrag = null;
      this.activeSnap = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Physics drag helpers
  // ---------------------------------------------------------------------------

  private startPhysicsDrag(assembly: Assembly): void {
    const body = assembly.rootBody;
    const originalCollisionFilter = {
      category: body.collisionFilter.category ?? 0x0001,
      mask: body.collisionFilter.mask ?? 0xFFFFFFFF,
      group: body.collisionFilter.group ?? 0,
    };

    // Disable collisions on compound root and all parts
    const noCollide = { category: 0x0004, mask: 0, group: 0 };
    body.collisionFilter = { ...noCollide };
    body.parts.slice(1).forEach(part => { part.collisionFilter = { ...noCollide }; });

    // Invisible static body that the spring pulls toward the cursor
    const cursorBody = Matter.Bodies.circle(
      body.position.x, body.position.y,
      CURSOR_BODY_RADIUS,
      {
        isStatic: true,
        collisionFilter: { category: 0x0004, mask: 0 },
        render: { visible: false },
      }
    );

    const spring = Matter.Constraint.create({
      bodyA: body,
      bodyB: cursorBody,
      stiffness: SPRING_STIFFNESS,
      damping: SPRING_DAMPING,
      length: SPRING_LENGTH,
      render: { visible: false },
    });

    this.doAddBodyToWorld(cursorBody);
    this.doAddConstraintToWorld(spring);
    this.onPickUp(assembly);

    this.pendingRotationSteps = 0;
    this.activeDrag = { heldAssembly: assembly, cursorBody, spring, originalCollisionFilter };
  }

  private triggerDetach(mouseWorldPos: Vector2): void {
    if (!this.preDetachState) return;
    const { entity, playerAssembly } = this.preDetachState;
    if (playerAssembly.destroyed) { this.preDetachState = null; return; }

    const detachedAssembly = playerAssembly.detachEntity(entity);

    // Process pendingBodySwap synchronously to avoid 1-frame double-render artifact
    if (playerAssembly.pendingBodySwap) {
      this.doRemoveBodyWithParts(playerAssembly.pendingBodySwap.oldBody);
      this.doAddBodyToWorld(playerAssembly.rootBody);
      playerAssembly.pendingBodySwap = null;
    }

    this.doAddBodyToWorld(detachedAssembly.rootBody);
    this.preDetachState = null;

    this.startPhysicsDrag(detachedAssembly);

    // Snap cursor body to current mouse position immediately
    if (this.activeDrag) {
      Matter.Body.setPosition(this.activeDrag.cursorBody, mouseWorldPos);
    }
  }

  private cleanupDragPhysics(drag: ActiveDragState): void {
    this.doRemoveConstraintFromWorld(drag.spring);
    this.doRemoveBodyWithParts(drag.cursorBody);
    // Restore collision filter on compound root and all parts
    const f = drag.originalCollisionFilter;
    drag.heldAssembly.rootBody.collisionFilter = { ...f };
    drag.heldAssembly.rootBody.parts.slice(1).forEach(part => { part.collisionFilter = { ...f }; });
  }

  private cancelDrag(): void {
    if (!this.activeDrag) return;
    this.doRemoveConstraintFromWorld(this.activeDrag.spring);
    this.doRemoveBodyWithParts(this.activeDrag.cursorBody);
    // Do NOT restore collision filter or call onDrop — assembly is destroyed
    this.activeDrag = null;
    this.activeSnap = null;
  }

  // ---------------------------------------------------------------------------
  // Snap detection
  // ---------------------------------------------------------------------------

  private findBestSnap(heldAssembly: Assembly, playerAssembly: Assembly): SnapCandidate | null {
    const playerAngle = playerAssembly.rootBody.angle;
    // relativeAngle is the rotation applied to held block relative to player orientation
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

        for (const heldEntity of heldAssembly.entities) {
          const anchorDef = ENTITY_DEFINITIONS[heldEntity.type];
          if (!anchorDef) continue;
          if (!anchorDef.canAttachTo.includes(targetEntity.type)) continue;
          if (!targetDef.canAttachTo.includes(heldEntity.type)) continue;

          const heldWorldPos = this.getHeldEntityWorldPosFromBody(heldEntity, heldAssembly);
          const dx = heldWorldPos.x - slotWorldX;
          const dy = heldWorldPos.y - slotWorldY;
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
        targetAssembly: playerAssembly,
        snapDirection: pair.localDir,
        relativeAngle,
        previewLocalOffsets: preview,
        dist: pair.dist,
      };
    }

    return null;
  }

  /**
   * Compute the world position of a held entity from the held assembly's physics body.
   * Uses the compound body's center of mass and the entity's local offset.
   */
  private getHeldEntityWorldPosFromBody(entity: Entity, heldAssembly: Assembly): Vector2 {
    const angle = heldAssembly.rootBody.angle;
    const cm = heldAssembly.rootBody.position;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return {
      x: cm.x + entity.localOffset.x * cosA - entity.localOffset.y * sinA,
      y: cm.y + entity.localOffset.x * sinA + entity.localOffset.y * cosA,
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
    const heldAssembly = this.activeDrag?.heldAssembly;
    if (!heldAssembly) return null;

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

    for (const entity of heldAssembly.entities) {
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
    gfx: PIXI.Graphics,
    viewport: Viewport,
  ): void {
    if (this.preDetachState) {
      this.renderPreDetachTension(gfx, viewport);
      return;
    }

    if (!this.activeDrag) return;

    const snapTarget = this.snapTargetAssembly;
    if (snapTarget && !snapTarget.destroyed) {
      this.renderAvailableSlots(gfx, viewport, snapTarget);
    }

    if (this.activeSnap && this.activeSnap.targetAssembly && !this.activeSnap.targetAssembly.destroyed) {
      this.renderSnapPreview(gfx, viewport, this.activeSnap.targetAssembly, this.activeDrag.heldAssembly);
    }
  }

  /**
   * Draw a tension line from the held block to the cursor while in pre-detach state.
   */
  private renderPreDetachTension(gfx: PIXI.Graphics, viewport: Viewport): void {
    if (!this.preDetachState) return;
    const { entity } = this.preDetachState;
    const { bounds, canvas } = viewport;
    const scaleX = canvas.width / (bounds.max.x - bounds.min.x);
    const scaleY = canvas.height / (bounds.max.y - bounds.min.y);
    const toX = (wx: number) => (wx - bounds.min.x) * scaleX;
    const toY = (wy: number) => (wy - bounds.min.y) * scaleY;

    const blockPos = entity.body.position;
    const cursorPos = this.lastCursorWorldPos;
    const dx = cursorPos.x - blockPos.x;
    const dy = cursorPos.y - blockPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const tension = Math.min(dist / DETACH_PULL_THRESHOLD, 1);

    // Colour: yellow → orange-red (approximate: lerp green channel)
    const greenFrac = 1 - tension;
    const lineColor = (0xff << 16) | (Math.round(greenFrac * 255) << 8);
    const lineAlpha = 0.5 + tension * 0.4;

    // Tension line (solid, semi-transparent to approximate dashed)
    gfx.lineStyle(2, lineColor, lineAlpha);
    gfx.moveTo(toX(blockPos.x), toY(blockPos.y));
    gfx.lineTo(toX(cursorPos.x), toY(cursorPos.y));

    // Highlight rect around the block (rotated)
    const def = ENTITY_DEFINITIONS[entity.type];
    const w = def.width * scaleX;
    const h = def.height * scaleY;
    const rectAlpha = 0.3 + tension * 0.5;
    gfx.lineStyle(2, lineColor, rectAlpha);
    drawRotatedRect(gfx, toX(blockPos.x), toY(blockPos.y), w, h, entity.body.angle);
  }

  /**
   * Draw snap preview: bright anchor line + hint lines + target slot border.
   */
  private renderSnapPreview(
    gfx: PIXI.Graphics,
    viewport: Viewport,
    playerAssembly: Assembly,
    heldAssembly: Assembly,
  ): void {
    if (!this.activeSnap) return;

    const { bounds, canvas } = viewport;
    const scaleX = canvas.width / (bounds.max.x - bounds.min.x);
    const scaleY = canvas.height / (bounds.max.y - bounds.min.y);
    const toX = (wx: number) => (wx - bounds.min.x) * scaleX;
    const toY = (wy: number) => (wy - bounds.min.y) * scaleY;

    const playerAngle = playerAssembly.rootBody.angle;
    const refEntity = this.activeSnap.targetEntity;
    const cosP = Math.cos(playerAngle);
    const sinP = Math.sin(playerAngle);
    const activeAnchorId = this.activeSnap.anchorEntity.id;
    const heldEntities = heldAssembly.entities;

    const occupiedOffsets = new Set<string>();
    playerAssembly.entities.forEach(e => {
      occupiedOffsets.add(`${e.localOffset.x},${e.localOffset.y}`);
    });
    const localDirs = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    ];
    const HINT_RANGE = DETACH_RADIUS * 2.5;

    for (const heldEntity of heldEntities) {
      const heldWorldPos = this.getHeldEntityWorldPosFromBody(heldEntity, heldAssembly);
      const ghostX = heldWorldPos.x;
      const ghostY = heldWorldPos.y;

      if (heldEntity.id === activeAnchorId) {
        // Bright line: anchor ghost → snap landing position
        const anchorSnapData = this.activeSnap.previewLocalOffsets.get(heldEntity.id);
        if (anchorSnapData) {
          const dlx = anchorSnapData.localOffset.x - refEntity.localOffset.x;
          const dly = anchorSnapData.localOffset.y - refEntity.localOffset.y;
          const landX = refEntity.body.position.x + dlx * cosP - dly * sinP;
          const landY = refEntity.body.position.y + dlx * sinP + dly * cosP;

          // Anchor line (solid semi-transparent, approximating dashed)
          gfx.lineStyle(1.5, 0x00ff88, 0.75);
          gfx.moveTo(toX(ghostX), toY(ghostY));
          gfx.lineTo(toX(landX), toY(landY));
          // Anchor dot
          gfx.lineStyle(0);
          gfx.beginFill(0x00ff88, 0.9);
          gfx.drawCircle(toX(ghostX), toY(ghostY), 3);
          gfx.endFill();
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

            const ddx = ghostX - slotWX;
            const ddy = ghostY - slotWY;
            const d = Math.sqrt(ddx * ddx + ddy * ddy);
            if (d < nearestDist) {
              nearestDist = d;
              nearestSlotX = slotWX;
              nearestSlotY = slotWY;
              found = true;
            }
          }
        }

        if (found) {
          const hintAlpha = 0.25 * Math.max(0, 1 - nearestDist / HINT_RANGE);
          gfx.lineStyle(1, 0x00ff88, hintAlpha);
          gfx.moveTo(toX(ghostX), toY(ghostY));
          gfx.lineTo(toX(nearestSlotX), toY(nearestSlotY));
        }
      }
    }

    // Green border around the target attachment cell on the player assembly
    const target = this.activeSnap.targetEntity;
    const dir = this.activeSnap.snapDirection;
    const attachWorldX = target.body.position.x + (dir.x * cosP - dir.y * sinP) * GRID_SIZE;
    const attachWorldY = target.body.position.y + (dir.x * sinP + dir.y * cosP) * GRID_SIZE;

    gfx.lineStyle(2, 0x00ff00, 0.7);
    drawRotatedRect(gfx, toX(attachWorldX), toY(attachWorldY), GRID_SIZE * scaleX, GRID_SIZE * scaleY, playerAngle);
  }

  /**
   * Draw dashed cyan outlines at every open adjacent slot on the player's assembly.
   * Gives the player a spatial map of where they can attach the held block.
   */
  private renderAvailableSlots(
    gfx: PIXI.Graphics,
    viewport: Viewport,
    playerAssembly: Assembly
  ): void {
    const { bounds, canvas } = viewport;
    const scaleX = canvas.width / (bounds.max.x - bounds.min.x);
    const scaleY = canvas.height / (bounds.max.y - bounds.min.y);
    const toX = (wx: number) => (wx - bounds.min.x) * scaleX;
    const toY = (wy: number) => (wy - bounds.min.y) * scaleY;

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

    gfx.lineStyle(1.5, 0x00ccff, 0.35);
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

        drawRotatedRect(gfx, toX(worldX), toY(worldY), GRID_SIZE * scaleX, GRID_SIZE * scaleY, playerAngle);
      }
    }
  }
}

function drawRotatedRect(
  gfx: PIXI.Graphics,
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number,
): void {
  const hw = w / 2;
  const hh = h / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    { x: -hw, y: -hh },
    { x:  hw, y: -hh },
    { x:  hw, y:  hh },
    { x: -hw, y:  hh },
  ].map(({ x, y }) => ({
    x: cx + x * cos - y * sin,
    y: cy + x * sin + y * cos,
  }));
  gfx.moveTo(corners[0].x, corners[0].y);
  gfx.lineTo(corners[1].x, corners[1].y);
  gfx.lineTo(corners[2].x, corners[2].y);
  gfx.lineTo(corners[3].x, corners[3].y);
  gfx.lineTo(corners[0].x, corners[0].y);
}
