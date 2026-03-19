import { Vector2, ASSEMBLY_YARD_MAX_SHIPS, GridPowerSummary } from '../../types/GameTypes';
import { Structure } from './Structure';

/**
 * Assembly Yard — builds AI-controlled ships over time.
 * Consumes resources from grid storage to produce ships at regular intervals.
 * Power-gated: will not build if grid netPower < 0.
 * Ship-capped: each yard can have at most ASSEMBLY_YARD_MAX_SHIPS alive at once.
 */
export class StructureAssemblyYard extends Structure {
  /** Resources accumulated toward the current ship build. */
  public buildProgress: number = 0;
  /** IDs of ships spawned by this yard that are still alive. */
  public activeShipIds: string[] = [];

  constructor(position: Vector2, team: number) {
    super('AssemblyYard', position, team);
  }

  /** Whether the yard is at its ship cap. */
  public isAtShipCap(): boolean {
    return this.activeShipIds.length >= ASSEMBLY_YARD_MAX_SHIPS;
  }

  /** 0–1 fraction of build progress toward the next ship. */
  public getBuildFraction(): number {
    const cost = this.definition.shipBuildCost ?? 0;
    if (cost <= 0) return 0;
    return Math.min(1, this.buildProgress / cost);
  }

  /** Whether a ship is ready to be spawned. */
  public isShipReady(): boolean {
    const cost = this.definition.shipBuildCost ?? 0;
    return cost > 0 && this.buildProgress >= cost;
  }

  /**
   * Per-pulse build tick. Pulls resources from own storage (any material type).
   * Returns true if a ship is ready to spawn.
   */
  public tickBuild(gridSummary: GridPowerSummary): boolean {
    if (!this.isConstructed || this.isDestroyed()) return false;
    if (gridSummary.powerEfficiency <= 0) return false;
    if (this.isAtShipCap()) return false;

    const cost = this.definition.shipBuildCost ?? 0;
    if (cost <= 0) return false;

    // Pull resources from own storage, scaled by power efficiency
    const remaining = cost - this.buildProgress;
    const pull = Math.min(remaining, this.getInventoryTotal(), 5 * gridSummary.powerEfficiency);
    if (pull <= 0) return false;

    this.removeAnyMaterials(pull);
    this.buildProgress += pull;

    return this.isShipReady();
  }

  /** Reset build progress after a ship has been spawned. */
  public resetBuild(): void {
    const cost = this.definition.shipBuildCost ?? 0;
    this.buildProgress = Math.max(0, this.buildProgress - cost);
  }

  /** Remove a ship ID from the active list (e.g., when it's destroyed). */
  public removeActiveShip(shipId: string): void {
    this.activeShipIds = this.activeShipIds.filter(id => id !== shipId);
  }
}
