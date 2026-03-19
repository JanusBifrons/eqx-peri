import { Vector2 } from '../../types/GameTypes';
import { Structure } from './Structure';

/**
 * The Core is the foundational structure for a team's base.
 * It provides baseline power output and storage, and serves as the
 * anchor point from which all other structures connect.
 *
 * In test scenarios, the Core is initialized with a large starting inventory
 * of refined materials so all structure types can be built without mining.
 */
export class StructureCore extends Structure {
  constructor(position: Vector2, team: number) {
    super('Core', position, team);
  }

  /**
   * Initialize the Core with a large starting material inventory for testing.
   * Call this after spawning the Core in test/sandbox scenarios.
   * All amounts are in kg (1 Matter.js mass unit = 1 kg).
   */
  public initStartingInventory(): void {
    this.initInventory({
      // M-Type derived (structural metals)
      Iron:      500000,
      Nickel:    100000,
      Copper:    100000,
      Cobalt:     10000,
      // S-Type derived (electronics, armor)
      Silicon:   100000,
      Magnesium:  50000,
      Lithium:    50000,
      Titanium:   20000,
      // C-Type derived (fuels, coolants)
      Carbon:     50000,
      Coolant:    50000,
      Hydrogen:   30000,
      Oxygen:     30000,
      Ammonia:    10000,
    });
  }
}
