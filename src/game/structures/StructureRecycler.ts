import { Vector2, GridPowerSummary, RECYCLER_YIELD_FRACTION, RECYCLER_PROCESS_RATE_KG, OreType } from '../../types/GameTypes';
import { Structure } from './Structure';

/**
 * Recycler — breaks down debris and scrap into recoverable materials.
 *
 * When destroyed ships or debris drift near a Recycler, the scrap mass is
 * collected into its storage buffer. Each pulse, the Recycler processes
 * stored scrap and converts it into refined materials at RECYCLER_YIELD_FRACTION
 * (60%) efficiency. Power-gated: will not process if grid netPower < 0.
 *
 * The current implementation uses the simplified single-resource model
 * (storedResources as "scrap mass in kg"). When the inventory system is live,
 * the Recycler will output specific MaterialType quantities based on the
 * composition of the recycled items.
 */
export class StructureRecycler extends Structure {
  /** Total mass (kg) of scrap processed over this Recycler's lifetime. */
  public totalProcessedKg: number = 0;
  /** Total mass (kg) of materials recovered over this Recycler's lifetime. */
  public totalRecoveredKg: number = 0;

  constructor(position: Vector2, team: number) {
    super('Recycler', position, team);
  }

  /**
   * Per-pulse processing tick. Consumes any inventory materials as scrap,
   * converts RECYCLER_YIELD_FRACTION into recovered Iron (generic recovered metal),
   * and deposits it back into inventory to be distributed by the grid.
   *
   * Returns the amount of materials recovered this tick (kg).
   */
  public tickProcess(gridSummary: GridPowerSummary): number {
    if (!this.isConstructed || this.isDestroyed()) return 0;
    if (gridSummary.powerEfficiency <= 0) return 0;
    if (this.getInventoryTotal() <= 0) return 0;

    // Only process ore types (scrap is treated as generic ore)
    const oreTypes: OreType[] = ['CarbonaceousOre', 'SilicateOre', 'MetallicOre'];
    let totalScrap = 0;
    for (const ore of oreTypes) {
      totalScrap += this.getInventoryAmount(ore);
    }
    void totalScrap; // tracked for potential future use

    // Process up to RECYCLER_PROCESS_RATE_KG of any stored material per pulse, scaled by power
    const effectiveRate = RECYCLER_PROCESS_RATE_KG * gridSummary.powerEfficiency;
    const processAmount = Math.min(this.getInventoryTotal(), effectiveRate);
    if (processAmount <= 0) return 0;

    const removed = this.removeAnyMaterials(processAmount);
    this.totalProcessedKg += removed;

    // Recover RECYCLER_YIELD_FRACTION of processed mass as Iron (generic recovered metal)
    const recovered = removed * RECYCLER_YIELD_FRACTION;
    const deposited = this.addToInventory('Iron', recovered);
    this.totalRecoveredKg += deposited;

    return deposited;
  }

  /** Get the recycling efficiency as a display percentage. */
  public getEfficiencyPct(): number {
    return RECYCLER_YIELD_FRACTION * 100;
  }

  /** Get lifetime stats for rendering. */
  public getLifetimeStats(): { processedKg: number; recoveredKg: number } {
    return {
      processedKg: this.totalProcessedKg,
      recoveredKg: this.totalRecoveredKg,
    };
  }
}
