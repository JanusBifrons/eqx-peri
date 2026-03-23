import Matter from 'matter-js';
import { StructureType, CONNECTION_MAX_RANGE, STRUCTURE_DEFINITIONS, Vector2 } from '../../types/GameTypes';
import { Structure } from '../structures/Structure';
import { StructureManager } from '../structures/StructureManager';
import { GridManager } from '../structures/GridManager';

type PlacementMode =
  | { kind: 'none' }
  | { kind: 'place'; structureType: StructureType }
  | { kind: 'link'; sourceNode: Structure };

/**
 * Handles player interaction for placing structures and creating connections.
 *
 * Two modes:
 * - **Place mode**: a structure type is selected; click to place at cursor position
 * - **Link mode**: a source structure is selected; click a second structure to connect them
 */
export class StructurePlacementSystem {
  private mode: PlacementMode = { kind: 'none' };
  private cursorWorldPos: Vector2 = { x: 0, y: 0 };
  private structureManager: StructureManager;
  private gridManager: GridManager;
  private team: number;
  private getWorldBodies: () => Matter.Body[];

  constructor(
    structureManager: StructureManager,
    gridManager: GridManager,
    team: number,
    getWorldBodies: () => Matter.Body[] = () => [],
  ) {
    this.structureManager = structureManager;
    this.gridManager = gridManager;
    this.team = team;
    this.getWorldBodies = getWorldBodies;
  }

  // ── Mode control (called from UI) ──────────────────────────────────────

  /** Enter place mode — next click places a structure of this type. */
  public enterPlaceMode(type: StructureType): void {
    this.mode = { kind: 'place', structureType: type };
  }

  /** Enter link mode — first node selected, waiting for second. */
  public enterLinkMode(source: Structure): void {
    this.mode = { kind: 'link', sourceNode: source };
  }

  /** Cancel the current mode. */
  public cancel(): void {
    this.mode = { kind: 'none' };
  }

  public getMode(): PlacementMode {
    return this.mode;
  }

  public isActive(): boolean {
    return this.mode.kind !== 'none';
  }

  // ── Per-frame update ───────────────────────────────────────────────────

  public updateCursor(worldPos: Vector2): void {
    this.cursorWorldPos = worldPos;
  }

  public getCursorWorldPos(): Vector2 {
    return this.cursorWorldPos;
  }

  // ── Click handling ─────────────────────────────────────────────────────

  /**
   * Handle a world-space click. Returns true if the click was consumed.
   */
  public handleClick(worldPos: Vector2): boolean {
    if (this.mode.kind === 'place') {
      return this.handlePlaceClick(worldPos);
    }
    if (this.mode.kind === 'link') {
      return this.handleLinkClick(worldPos);
    }
    return false;
  }

  private handlePlaceClick(worldPos: Vector2): boolean {
    if (this.mode.kind !== 'place') return false;

    // Block placement if the position overlaps existing objects
    if (this.isPlacementBlocked(worldPos, this.mode.structureType)) return true;

    const placed = this.structureManager.spawnStructure(this.mode.structureType, worldPos, this.team);

    // Auto-connect to nearby structures, closest first
    const candidates = this.structureManager.getStructures()
      .filter(s => s !== placed)
      .map(s => {
        const dx = s.body.position.x - worldPos.x;
        const dy = s.body.position.y - worldPos.y;
        return { structure: s, dist: Math.sqrt(dx * dx + dy * dy) };
      })
      .sort((a, b) => a.dist - b.dist);

    for (const { structure } of candidates) {
      if (this.gridManager.canConnect(placed, structure)) {
        this.gridManager.connect(placed, structure);
      }
    }

    // Stay in place mode so the player can place multiple structures quickly
    return true;
  }

  private handleLinkClick(worldPos: Vector2): boolean {
    if (this.mode.kind !== 'link') return false;

    const target = this.findStructureAtPosition(worldPos);
    if (!target || target === this.mode.sourceNode) {
      // Clicked empty space or same node — cancel link mode
      this.cancel();
      return true;
    }

    if (this.gridManager.canConnect(this.mode.sourceNode, target)) {
      this.gridManager.connect(this.mode.sourceNode, target);
    }

    // Return to none mode after a link attempt
    this.cancel();
    return true;
  }

  /** Find the closest structure to a world position (within hit radius). */
  private findStructureAtPosition(worldPos: Vector2): Structure | null {
    const structures = this.structureManager.getStructures();
    let closest: Structure | null = null;
    let closestDist = Infinity;

    for (const s of structures) {
      const dx = s.body.position.x - worldPos.x;
      const dy = s.body.position.y - worldPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Hit radius = half the structure's width + small margin
      const hitRadius = s.definition.widthPx / 2 + 10;
      if (dist < hitRadius && dist < closestDist) {
        closest = s;
        closestDist = dist;
      }
    }

    return closest;
  }

  // ── Placement validity ───────────────────────────────────────────────

  /** Check if the cursor position is blocked by existing objects. */
  public isPlacementBlocked(worldPos: Vector2, type: StructureType): boolean {
    const def = STRUCTURE_DEFINITIONS[type];
    const hw = def.widthPx / 2;
    const hh = def.heightPx / 2;

    // Check overlap with existing structures (AABB)
    for (const s of this.structureManager.getStructures()) {
      const sHw = s.definition.widthPx / 2;
      const sHh = s.definition.heightPx / 2;
      const dx = Math.abs(s.body.position.x - worldPos.x);
      const dy = Math.abs(s.body.position.y - worldPos.y);
      if (dx < hw + sHw && dy < hh + sHh) return true;
    }

    // Check overlap with sensor areas (e.g. Refinery deposit zone)
    for (const s of this.structureManager.getStructures()) {
      const sensorR = s.definition.sensorRadius;
      if (!sensorR) continue;
      const dx = s.body.position.x - worldPos.x;
      const dy = s.body.position.y - worldPos.y;
      if (Math.sqrt(dx * dx + dy * dy) < sensorR + Math.max(hw, hh)) return true;
    }

    // Check overlap with active shield walls (inactive walls have no physics body)
    for (const wall of this.gridManager.getShieldWalls()) {
      if (!wall.isActive()) continue;
      const wallBounds = wall.body.bounds;
      const wMinX = wallBounds.min.x;
      const wMinY = wallBounds.min.y;
      const wMaxX = wallBounds.max.x;
      const wMaxY = wallBounds.max.y;
      if (
        worldPos.x + hw > wMinX && worldPos.x - hw < wMaxX &&
        worldPos.y + hh > wMinY && worldPos.y - hh < wMaxY
      ) return true;
    }

    // Check overlap with world bodies (assemblies, entities, asteroids, etc.)
    // Use Matter.Query.region for efficient broad-phase check
    const placementBounds = {
      min: { x: worldPos.x - hw, y: worldPos.y - hh },
      max: { x: worldPos.x + hw, y: worldPos.y + hh },
    };
    const worldBodies = this.getWorldBodies();
    const overlapping = Matter.Query.region(worldBodies, placementBounds);
    // Filter out lasers and sensors — they shouldn't block placement
    for (const body of overlapping) {
      if (body.isSensor) continue;
      if (body.isLaser) continue;
      if (body.label === 'cursor') continue;
      return true;
    }

    return false;
  }

  /** Whether the current cursor placement is valid (not blocked). */
  public isCurrentPlacementValid(): boolean {
    if (this.mode.kind !== 'place') return true;
    return !this.isPlacementBlocked(this.cursorWorldPos, this.mode.structureType);
  }

  // ── Preview data for rendering ─────────────────────────────────────────

  /** Get the source node for link preview line (null if not in link mode). */
  public getLinkSource(): Structure | null {
    return this.mode.kind === 'link' ? this.mode.sourceNode : null;
  }

  /** Get the structure type being placed (null if not in place mode). */
  public getPlacingType(): StructureType | null {
    return this.mode.kind === 'place' ? this.mode.structureType : null;
  }

  /** Get the linkable target at cursor (for UI feedback). */
  public getLinkTargetAtCursor(): Structure | null {
    if (this.mode.kind !== 'link') return null;
    const target = this.findStructureAtPosition(this.cursorWorldPos);
    if (!target || target === this.mode.sourceNode) return null;
    if (!this.gridManager.canConnect(this.mode.sourceNode, target)) return null;
    return target;
  }

  /** Get all structures within link range of the source node. */
  public getLinkCandidates(): Structure[] {
    if (this.mode.kind !== 'link') return [];
    const source = this.mode.sourceNode;
    return this.structureManager.getStructures().filter(s => {
      if (s === source) return false;
      return GridManager.edgeDistance(s, source) <= CONNECTION_MAX_RANGE;
    });
  }

  /**
   * Get all structures that would auto-connect to a new structure placed at cursorWorldPos.
   * Each result includes whether the connection is valid (within max connections).
   */
  public getPlacementConnectCandidates(): { structure: Structure; valid: boolean }[] {
    if (this.mode.kind !== 'place') return [];
    const cursor = this.cursorWorldPos;
    const placingDef = STRUCTURE_DEFINITIONS[this.mode.structureType];
    const maxConns = placingDef.maxConnections;

    // Collect candidates within range, sorted by edge distance (closest first).
    // Use AABB edge-to-edge: the new structure (at cursor) has its own half-sizes.
    const placingHW = placingDef.widthPx / 2;
    const placingHH = placingDef.heightPx / 2;
    const inRange: { structure: Structure; dist: number }[] = [];
    for (const s of this.structureManager.getStructures()) {
      const dx = Math.max(0, Math.abs(s.body.position.x - cursor.x) - placingHW - s.definition.widthPx / 2);
      const dy = Math.max(0, Math.abs(s.body.position.y - cursor.y) - placingHH - s.definition.heightPx / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > CONNECTION_MAX_RANGE) continue;
      inRange.push({ structure: s, dist });
    }
    inRange.sort((a, b) => a.dist - b.dist);

    const results: { structure: Structure; valid: boolean }[] = [];
    let validCount = 0;

    for (const { structure: s } of inRange) {
      // Can the existing structure accept another connection?
      const existingCanAccept = this.gridManager.canAddConnection(s);
      // Would the new structure still have connection slots?
      const newCanAccept = validCount < maxConns;
      // Is the line blocked by another structure?
      const lineBlocked = this.gridManager.isConnectionLineBlocked(cursor, s.body.position, s);
      const valid = existingCanAccept && newCanAccept && !lineBlocked;

      results.push({ structure: s, valid });
      if (valid) validCount++;
    }

    return results;
  }
}
