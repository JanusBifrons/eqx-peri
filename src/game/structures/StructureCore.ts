import { GridPowerSummary, Vector2 } from '../../types/GameTypes';
import { Structure } from './Structure';

/**
 * The Core is the foundational structure for a team's base.
 * It provides baseline power output and storage, and serves as the
 * anchor point from which all other structures connect.
 */
export class StructureCore extends Structure {
  constructor(position: Vector2, team: number) {
    super('Core', position, team);
  }

  /**
   * Returns a summary of the power grid this Core is part of.
   * In Phase 0 this only reports the Core's own stats; later phases
   * will aggregate across all connected structures.
   */
  public getGridSummary(allStructures: Structure[]): GridPowerSummary {
    let totalPowerOutput = 0;
    let totalPowerConsumption = 0;
    let totalCapacity = 0;
    let usedCapacity = 0;

    for (const s of allStructures) {
      if (s.team !== this.team) continue;
      totalPowerOutput += s.getPowerOutput();
      totalPowerConsumption += s.getPowerConsumption();
      totalCapacity += s.getStorageCapacity();
      usedCapacity += s.storedResources;
    }

    return {
      totalPowerOutput,
      totalPowerConsumption,
      netPower: totalPowerOutput - totalPowerConsumption,
      totalCapacity,
      usedCapacity,
    };
  }
}
