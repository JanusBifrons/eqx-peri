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

  constructor(structureManager: StructureManager, gridManager: GridManager, team: number) {
    this.structureManager = structureManager;
    this.gridManager = gridManager;
    this.team = team;
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

    const placed = this.structureManager.spawnStructure(this.mode.structureType, worldPos, this.team);

    // Auto-connect to all nearby structures within range
    for (const s of this.structureManager.getStructures()) {
      if (s === placed) continue;
      if (this.gridManager.canConnect(placed, s)) {
        this.gridManager.connect(placed, s);
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
      const dx = s.body.position.x - source.body.position.x;
      const dy = s.body.position.y - source.body.position.y;
      return Math.sqrt(dx * dx + dy * dy) <= CONNECTION_MAX_RANGE;
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

    const results: { structure: Structure; valid: boolean }[] = [];
    let validCount = 0;

    for (const s of this.structureManager.getStructures()) {
      const dx = s.body.position.x - cursor.x;
      const dy = s.body.position.y - cursor.y;
      if (Math.sqrt(dx * dx + dy * dy) > CONNECTION_MAX_RANGE) continue;

      // Can the existing structure accept another connection?
      const existingCanAccept = this.gridManager.canAddConnection(s);
      // Would the new structure still have connection slots?
      const newCanAccept = validCount < maxConns;
      const valid = existingCanAccept && newCanAccept;

      results.push({ structure: s, valid });
      if (valid) validCount++;
    }

    return results;
  }
}
