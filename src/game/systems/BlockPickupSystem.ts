import * as Matter from 'matter-js';
import * as PIXI from 'pixi.js';
import { Assembly } from '../core/Assembly';
import { Entity } from '../core/Entity';
import { Vector2, GRID_SIZE, ENTITY_DEFINITIONS, getEntityOccupiedGridCells, getEntityBodyOffset, getBlockedConnectionDirs, canTypesConnect } from '../../types/GameTypes';
import { Viewport } from '../rendering/Viewport';

interface SnapCandidate {
  anchorEntity: Entity;       // entity in heldAssembly closest to the attachment slot
  targetEntity: Entity;       // entity in the snap-target assembly beside the attachment slot
  targetAssembly: Assembly;   // the assembly we are snapping onto
  snapDirection: Vector2;     // unit grid direction in target-LOCAL space (+x/-x/+y/-y)
  relativeAngle: number;      // angle to rotate held assembly, in radians, rounded to nearest π/2
  previewLocalOffsets: Map<string, { localOffset: Vector2; rotation: number }>;
  snapSlotLocalOffset: Vector2; // player-local pixel offset of the attachment slot
  snapHeldCell: Vector2;        // grid cell (in held-assembly space) that triggered the snap
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
// These are BASE values for 1×1 blocks; larger blocks get an increased radius
// proportional to the entity body offset so the effective snap area scales with block size.
const SNAP_RADIUS_BASE = 48;
const DETACH_RADIUS_BASE = 64;

// Physics-drag constants
const DETACH_PULL_THRESHOLD = 40;  // px — how far to pull before block pops off

// Floating-block pickup thresholds — drag only starts after one of these is exceeded
const DRAG_HOLD_MS = 400;        // hold mousedown this long to start drag
const DRAG_MIN_SCREEN_PX = 6;    // or move this many screen pixels while held
const SPRING_STIFFNESS_BASE = 0.04;
const SPRING_STIFFNESS_REF_MASS = 600; // 1×1 hull mass — spring feels "normal" at this mass
const SPRING_STIFFNESS_MAX = 0.25;      // cap to prevent physics instability
const SPRING_DAMPING = 0.1;
const SPRING_LENGTH = 0;
const CURSOR_BODY_RADIUS = 4;
// Distance penalty (px) added to non-current snap candidates to prevent flip-flopping
// between two equally-distant slots. The current snap target gets no penalty,
// so it wins ties and near-ties.
const SNAP_STABILITY_BIAS = 5;

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

    // Scale spring stiffness with body mass so heavier blocks respond as snappily
    // as light ones — without this, a 2×2 hull (mass 2400) lags 4× more than a 1×1 (600).
    const scaledStiffness = Math.min(
      SPRING_STIFFNESS_BASE * (body.mass / SPRING_STIFFNESS_REF_MASS),
      SPRING_STIFFNESS_MAX,
    );
    const spring = Matter.Constraint.create({
      bodyA: body,
      bodyB: cursorBody,
      stiffness: scaledStiffness,
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
    const relativeAngle = this.pendingRotationSteps * (Math.PI / 2);

    const localDirs: Vector2[] = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    ];

    // Build the set of ALL grid cells occupied by the player assembly (pixel-based keys
    // so existing comparisons stay consistent: "pixelX,pixelY" in local-offset space).
    const occupiedGridCells = new Set<string>();
    playerAssembly.entities.forEach(e => {
      getEntityOccupiedGridCells(e.localOffset, e.type, e.rotation).forEach(cell => {
        occupiedGridCells.add(`${cell.x},${cell.y}`);
      });
    });

    const baseThreshold = this.activeSnap ? DETACH_RADIUS_BASE : SNAP_RADIUS_BASE;
    const cosP = Math.cos(playerAngle);
    const sinP = Math.sin(playerAngle);

    type Pair = {
      heldEntity: Entity;
      targetEntity: Entity;
      localDir: Vector2;
      candidateLocalOffset: Vector2;
      slotLocalOffset: Vector2;
      heldCell: Vector2;
      dist: number;
    };
    const pairs: Pair[] = [];

    for (const targetEntity of playerAssembly.entities) {
      const targetDef = ENTITY_DEFINITIONS[targetEntity.type];
      if (!targetDef) continue;

      const targetBodyOffset = getEntityBodyOffset(targetEntity.type, targetEntity.rotation);
      const targetCells = getEntityOccupiedGridCells(
        targetEntity.localOffset, targetEntity.type, targetEntity.rotation,
      );

      for (const targetCell of targetCells) {
        // World position of this target cell's centre.
        // targetEntity.body.position is the body centre (= localOffset + bodyOffset in
        // compound-local space, then transformed to world).
        const cellRelX = targetCell.x * GRID_SIZE - (targetEntity.localOffset.x + targetBodyOffset.x);
        const cellRelY = targetCell.y * GRID_SIZE - (targetEntity.localOffset.y + targetBodyOffset.y);
        const cellWorldX = targetEntity.body.position.x + cellRelX * cosP - cellRelY * sinP;
        const cellWorldY = targetEntity.body.position.y + cellRelX * sinP + cellRelY * cosP;

        for (const localDir of localDirs) {
          const slotGrid: Vector2 = { x: targetCell.x + localDir.x, y: targetCell.y + localDir.y };
          if (occupiedGridCells.has(`${slotGrid.x},${slotGrid.y}`)) continue;

          // Skip if the target entity has no face on this side (e.g. TriHull hypotenuse)
          const targetBlocked = getBlockedConnectionDirs(targetEntity.type, targetEntity.rotation);
          if (targetBlocked.some(b => b.x === localDir.x && b.y === localDir.y)) continue;

          const slotWorldX = cellWorldX + (localDir.x * cosP - localDir.y * sinP) * GRID_SIZE;
          const slotWorldY = cellWorldY + (localDir.x * sinP + localDir.y * cosP) * GRID_SIZE;
          const slotLocalOffset: Vector2 = { x: slotGrid.x * GRID_SIZE, y: slotGrid.y * GRID_SIZE };

          for (const heldEntity of heldAssembly.entities) {
            if (!ENTITY_DEFINITIONS[heldEntity.type]) continue;
            if (!canTypesConnect(heldEntity.type, targetEntity.type)) continue;

            // Effective rotation of held entity after pendingRotationSteps
            const effectiveRot = ((heldEntity.rotation + this.pendingRotationSteps * 90) % 360 + 360) % 360;
            const heldBodyOffset = getEntityBodyOffset(heldEntity.type, effectiveRot);
            // Scale snap threshold by the held entity's body offset — for larger blocks,
            // cells are further from the body center (≈ cursor), so the user needs a
            // larger detection radius to get the same "snap feel" as a 1×1 block.
            const bodyOffsetMag = Math.sqrt(heldBodyOffset.x * heldBodyOffset.x + heldBodyOffset.y * heldBodyOffset.y);
            const threshold = baseThreshold + bodyOffsetMag;
            const heldCells = getEntityOccupiedGridCells(heldEntity.localOffset, heldEntity.type, effectiveRot);
            const heldBodyWorldPos = this.getHeldEntityWorldPosFromBody(heldEntity, heldAssembly);

            for (const heldCell of heldCells) {
              // World position of this specific cell of the held entity.
              // effectiveRot cells are in player-local space, so rotate by playerAngle (not
              // bodyAngle which includes pendingRotationSteps — that would double-count).
              const hcRelX = heldCell.x * GRID_SIZE - (heldEntity.localOffset.x + heldBodyOffset.x);
              const hcRelY = heldCell.y * GRID_SIZE - (heldEntity.localOffset.y + heldBodyOffset.y);
              const heldCellWorldX = heldBodyWorldPos.x + hcRelX * cosP - hcRelY * sinP;
              const heldCellWorldY = heldBodyWorldPos.y + hcRelX * sinP + hcRelY * cosP;

              const dx = heldCellWorldX - slotWorldX;
              const dy = heldCellWorldY - slotWorldY;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < threshold) {
                // Skip if the held entity has no face on the side that would touch the target
                // (direction from held cell toward target is the reverse of localDir)
                const heldBlocked = getBlockedConnectionDirs(heldEntity.type, effectiveRot);
                if (heldBlocked.some(b => b.x === -localDir.x && b.y === -localDir.y)) continue;

                // Skip if this held cell is an interior cell on the touching face — i.e.
                // another held cell already exists between it and the target.
                // Without this check, a 2×2 block can snap with its interior cell at the
                // slot, overlapping the target block by one row/column.
                const innerPos = { x: heldCell.x - localDir.x, y: heldCell.y - localDir.y };
                if (heldCells.some(c => c.x === innerPos.x && c.y === innerPos.y)) continue;

                // Adjust candidateLocalOffset so THIS cell lands at slotLocalOffset.
                const heldCellOffX = heldCell.x * GRID_SIZE - heldEntity.localOffset.x;
                const heldCellOffY = heldCell.y * GRID_SIZE - heldEntity.localOffset.y;
                const candidateLocalOffset: Vector2 = {
                  x: slotLocalOffset.x - heldCellOffX,
                  y: slotLocalOffset.y - heldCellOffY,
                };
                pairs.push({ heldEntity, targetEntity, localDir, candidateLocalOffset, slotLocalOffset, heldCell, dist });
              }
            }
          }
        }
      }
    }

    // Stability bias: if there's a current snap, penalise candidates targeting a
    // different slot so the display doesn't flip-flop between two near-equal options.
    const currentSlot = this.activeSnap?.snapSlotLocalOffset;
    const biasedDist = (p: Pair): number => {
      if (currentSlot && (p.slotLocalOffset.x !== currentSlot.x || p.slotLocalOffset.y !== currentSlot.y)) {
        return p.dist + SNAP_STABILITY_BIAS;
      }
      return p.dist;
    };
    pairs.sort((a, b) => biasedDist(a) - biasedDist(b));

    for (const pair of pairs) {
      const preview = this.computePreviewOffsets(
        pair.heldEntity,
        pair.candidateLocalOffset,
        relativeAngle,
        playerAssembly,
      );
      if (!preview) continue;

      return {
        anchorEntity: pair.heldEntity,
        targetEntity: pair.targetEntity,
        targetAssembly: playerAssembly,
        snapDirection: pair.localDir,
        relativeAngle,
        previewLocalOffsets: preview,
        snapSlotLocalOffset: pair.slotLocalOffset,
        snapHeldCell: pair.heldCell,
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

    // Pre-build the set of occupied grid cells for ALL player entities (including
    // multi-cell blocks).  Stored as pixel-based "x,y" keys matching localOffset values.
    const occupiedOffsets = new Set<string>();
    playerAssembly.entities.forEach(e => {
      getEntityOccupiedGridCells(e.localOffset, e.type, e.rotation).forEach(cell => {
        occupiedOffsets.add(`${cell.x * GRID_SIZE},${cell.y * GRID_SIZE}`);
      });
    });

    const result = new Map<string, { localOffset: Vector2; rotation: number }>();

    for (const entity of heldAssembly.entities) {
      const lx = entity.localOffset.x;
      const ly = entity.localOffset.y;

      const finalAnchorX = snap(lx * cosA - ly * sinA) + shiftX;
      const finalAnchorY = snap(lx * sinA + ly * cosA) + shiftY;

      const newRotation = ((entity.rotation + rotateDegrees) % 360 + 360) % 360;

      // Check ALL cells of this entity in its final position (handles multi-cell blocks).
      const def = ENTITY_DEFINITIONS[entity.type];
      const gridCols = def.gridCols ?? 1;
      const gridRows = def.gridRows ?? 1;
      const swap = newRotation === 90 || newRotation === 270;
      const effectiveCols = swap ? gridRows : gridCols;
      const effectiveRows = swap ? gridCols : gridRows;

      for (let col = 0; col < effectiveCols; col++) {
        for (let row = 0; row < effectiveRows; row++) {
          const cellX = finalAnchorX + col * GRID_SIZE;
          const cellY = finalAnchorY + row * GRID_SIZE;
          if (occupiedOffsets.has(`${cellX},${cellY}`)) return null;
        }
      }

      result.set(entity.id, { localOffset: { x: finalAnchorX, y: finalAnchorY }, rotation: newRotation });
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
      getEntityOccupiedGridCells(e.localOffset, e.type, e.rotation).forEach(cell => {
        occupiedOffsets.add(`${cell.x * GRID_SIZE},${cell.y * GRID_SIZE}`);
      });
    });
    const localDirs = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    ];
    const HINT_RANGE = DETACH_RADIUS_BASE * 2.5;

    for (const heldEntity of heldEntities) {
      const heldWorldPos = this.getHeldEntityWorldPosFromBody(heldEntity, heldAssembly);
      const ghostX = heldWorldPos.x;
      const ghostY = heldWorldPos.y;

      if (heldEntity.id === activeAnchorId) {
        // Bright line: snapping cell of held block → snap landing position on player assembly.
        const anchorSnapData = this.activeSnap.previewLocalOffsets.get(heldEntity.id);
        if (anchorSnapData) {
          // Compute world position of the specific held cell that triggered the snap.
          // effectiveRot cells are in player-local space; rotate by playerAngle only
          // (bodyAngle includes pendingRotationSteps which effectiveRot already accounts for).
          const effectiveRot = ((heldEntity.rotation + this.pendingRotationSteps * 90) % 360 + 360) % 360;
          const heldBodyOff = getEntityBodyOffset(heldEntity.type, effectiveRot);
          const snapCell = this.activeSnap.snapHeldCell;
          const hcRelX = snapCell.x * GRID_SIZE - (heldEntity.localOffset.x + heldBodyOff.x);
          const hcRelY = snapCell.y * GRID_SIZE - (heldEntity.localOffset.y + heldBodyOff.y);
          const snapCellWorldX = heldWorldPos.x + hcRelX * cosP - hcRelY * sinP;
          const snapCellWorldY = heldWorldPos.y + hcRelX * sinP + hcRelY * cosP;

          // Compute world position of where the snapping cell will land on the player assembly.
          // snapSlotLocalOffset is the player-local pixel offset of the attachment slot.
          const refBodyOff = getEntityBodyOffset(refEntity.type, refEntity.rotation);
          const sdlx = this.activeSnap.snapSlotLocalOffset.x - (refEntity.localOffset.x + refBodyOff.x);
          const sdly = this.activeSnap.snapSlotLocalOffset.y - (refEntity.localOffset.y + refBodyOff.y);
          const landX = refEntity.body.position.x + sdlx * cosP - sdly * sinP;
          const landY = refEntity.body.position.y + sdlx * sinP + sdly * cosP;

          // Anchor line (solid semi-transparent, approximating dashed)
          gfx.lineStyle(1.5, 0x00ff88, 0.75);
          gfx.moveTo(toX(snapCellWorldX), toY(snapCellWorldY));
          gfx.lineTo(toX(landX), toY(landY));
          // Anchor dot at the snapping cell
          gfx.lineStyle(0);
          gfx.beginFill(0x00ff88, 0.9);
          gfx.drawCircle(toX(snapCellWorldX), toY(snapCellWorldY), 3);
          gfx.endFill();
        }
      } else {
        // Faint hint: find nearest compatible open slot for this entity using
        // per-cell distances (not entity body center) so hints scale correctly
        // for multi-cell blocks.
        const anchorDef = ENTITY_DEFINITIONS[heldEntity.type];
        if (!anchorDef) continue;

        const effectiveRotH = ((heldEntity.rotation + this.pendingRotationSteps * 90) % 360 + 360) % 360;
        const heldBodyOffH = getEntityBodyOffset(heldEntity.type, effectiveRotH);
        const heldCellsH = getEntityOccupiedGridCells(heldEntity.localOffset, heldEntity.type, effectiveRotH);

        let nearestDist = HINT_RANGE;
        let nearestSlotX = 0;
        let nearestSlotY = 0;
        let nearestCellWX = ghostX;
        let nearestCellWY = ghostY;
        let found = false;

        for (const targetEntity of playerAssembly.entities) {
          if (!ENTITY_DEFINITIONS[targetEntity.type]) continue;
          if (!canTypesConnect(heldEntity.type, targetEntity.type)) continue;

          const tBodyOff = getEntityBodyOffset(targetEntity.type, targetEntity.rotation);
          const tCells = getEntityOccupiedGridCells(targetEntity.localOffset, targetEntity.type, targetEntity.rotation);
          for (const tCell of tCells) {
          for (const dir of localDirs) {
            const slotGx = tCell.x + dir.x;
            const slotGy = tCell.y + dir.y;
            if (occupiedOffsets.has(`${slotGx * GRID_SIZE},${slotGy * GRID_SIZE}`)) continue;
            // Skip blocked sides (e.g. TriHull hypotenuse)
            const tBlocked = getBlockedConnectionDirs(targetEntity.type, targetEntity.rotation);
            if (tBlocked.some(b => b.x === dir.x && b.y === dir.y)) continue;

            const tCellRelX = tCell.x * GRID_SIZE - (targetEntity.localOffset.x + tBodyOff.x);
            const tCellRelY = tCell.y * GRID_SIZE - (targetEntity.localOffset.y + tBodyOff.y);
            const tCellWX = targetEntity.body.position.x + tCellRelX * cosP - tCellRelY * sinP;
            const tCellWY = targetEntity.body.position.y + tCellRelX * sinP + tCellRelY * cosP;
            const slotWX = tCellWX + (dir.x * cosP - dir.y * sinP) * GRID_SIZE;
            const slotWY = tCellWY + (dir.x * sinP + dir.y * cosP) * GRID_SIZE;

            // Check distance from each held cell to this slot (not entity center).
            // effectiveRot cells are in player-local space; rotate by playerAngle.
            for (const hc of heldCellsH) {
              const hcRX = hc.x * GRID_SIZE - (heldEntity.localOffset.x + heldBodyOffH.x);
              const hcRY = hc.y * GRID_SIZE - (heldEntity.localOffset.y + heldBodyOffH.y);
              const hcWX = ghostX + hcRX * cosP - hcRY * sinP;
              const hcWY = ghostY + hcRX * sinP + hcRY * cosP;
              const ddx = hcWX - slotWX;
              const ddy = hcWY - slotWY;
              const d = Math.sqrt(ddx * ddx + ddy * ddy);
              if (d < nearestDist) {
                nearestDist = d;
                nearestSlotX = slotWX;
                nearestSlotY = slotWY;
                nearestCellWX = hcWX;
                nearestCellWY = hcWY;
                found = true;
              }
            }
          }
          } // end tCell loop
        }

        if (found) {
          const hintAlpha = 0.25 * Math.max(0, 1 - nearestDist / HINT_RANGE);
          gfx.lineStyle(1, 0x00ff88, hintAlpha);
          gfx.moveTo(toX(nearestCellWX), toY(nearestCellWY));
          gfx.lineTo(toX(nearestSlotX), toY(nearestSlotY));
        }
      }
    }

    // Green border around the target attachment cell on the player assembly.
    // Convert snapSlotLocalOffset (player-local pixels) → world space via the target entity
    // as the reference point: target.body.position corresponds to localOffset + bodyOffset
    // in player-local space, so we subtract that to get the delta, then rotate by playerAngle.
    const target = this.activeSnap.targetEntity;
    const snapSlot = this.activeSnap.snapSlotLocalOffset;
    const tBodyOff = getEntityBodyOffset(target.type, target.rotation);
    const sdlx = snapSlot.x - (target.localOffset.x + tBodyOff.x);
    const sdly = snapSlot.y - (target.localOffset.y + tBodyOff.y);
    const attachWorldX = target.body.position.x + sdlx * cosP - sdly * sinP;
    const attachWorldY = target.body.position.y + sdlx * sinP + sdly * cosP;

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

    // All occupied grid cells (handles multi-cell blocks)
    const occupiedGridCells = new Set<string>();
    playerAssembly.entities.forEach(e => {
      getEntityOccupiedGridCells(e.localOffset, e.type, e.rotation).forEach(cell => {
        occupiedGridCells.add(`${cell.x},${cell.y}`);
      });
    });

    const localDirs: { x: number; y: number }[] = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    ];

    const drawnSlots = new Set<string>();

    gfx.lineStyle(1.5, 0x00ccff, 0.35);
    for (const entity of playerAssembly.entities) {
      const bodyOff = getEntityBodyOffset(entity.type, entity.rotation);
      const cells = getEntityOccupiedGridCells(entity.localOffset, entity.type, entity.rotation);

      for (const cell of cells) {
        for (const dir of localDirs) {
          const slotGx = cell.x + dir.x;
          const slotGy = cell.y + dir.y;
          const key = `${slotGx},${slotGy}`;
          if (occupiedGridCells.has(key) || drawnSlots.has(key)) continue;
          drawnSlots.add(key);

          // Compute this cell's world position and add one GRID_SIZE step in dir.
          const cellRelX = cell.x * GRID_SIZE - (entity.localOffset.x + bodyOff.x);
          const cellRelY = cell.y * GRID_SIZE - (entity.localOffset.y + bodyOff.y);
          const cellWX = entity.body.position.x + cellRelX * cosP - cellRelY * sinP;
          const cellWY = entity.body.position.y + cellRelX * sinP + cellRelY * cosP;
          const worldX = cellWX + (dir.x * cosP - dir.y * sinP) * GRID_SIZE;
          const worldY = cellWY + (dir.x * sinP + dir.y * cosP) * GRID_SIZE;

          drawRotatedRect(gfx, toX(worldX), toY(worldY), GRID_SIZE * scaleX, GRID_SIZE * scaleY, playerAngle);
        }
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
