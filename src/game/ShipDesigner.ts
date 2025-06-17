import { EntityConfig, EntityType } from '../types/GameTypes';

/**
 * Grid-based ship designer that ensures proper block placement and connections
 */
export class ShipDesigner {
  private static readonly GRID_UNIT = 16; // Base grid unit in pixels

  /**
   * Get the grid size for a block type
   */
  private static getBlockGridSize(type: EntityType): number {
    switch (type) {
      case 'Cockpit':
      case 'Engine':
      case 'Gun':
      case 'Hull':
      case 'PowerCell':
        return 1; // 1x1 blocks
      
      case 'LargeCockpit':
      case 'LargeEngine':
      case 'LargeGun':
      case 'HeavyHull':
      case 'LargePowerCell':
        return 2; // 2x2 blocks
      
      case 'CapitalCore':
      case 'CapitalEngine':
      case 'CapitalWeapon':
      case 'MegaHull':
      case 'PowerReactor':
        return 4; // 4x4 blocks
      
      default:
        return 1;
    }
  }

  /**
   * Convert grid coordinates to world coordinates
   */
  private static gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: gridX * this.GRID_UNIT,
      y: gridY * this.GRID_UNIT
    };
  }

  /**
   * Place a block at grid coordinates, ensuring it's properly positioned
   */
  private static placeBlock(type: EntityType, gridX: number, gridY: number, rotation: number = 0): EntityConfig {
    const worldPos = this.gridToWorld(gridX, gridY);
    return {
      type,
      x: worldPos.x,
      y: worldPos.y,
      rotation
    };
  }

  /**
   * Design a massive capital ship using proper grid placement
   */
  static createCapitalDreadnought(): EntityConfig[] {
    const parts: EntityConfig[] = [];

    // Central core at origin (0,0) - 4x4 block
    parts.push(this.placeBlock('CapitalCore', 0, 0));

    // Main structural cross - 4x4 blocks positioned adjacent to core
    parts.push(this.placeBlock('MegaHull', 0, -8));  // North: core extends -2 to +2, hull at -6 to -2, gap at -4
    parts.push(this.placeBlock('MegaHull', 0, 8));   // South: core extends -2 to +2, hull at +2 to +6, gap at +4
    parts.push(this.placeBlock('MegaHull', -8, 0));  // West
    parts.push(this.placeBlock('MegaHull', 8, 0));   // East

    // Forward weapons section - 4x4 capital weapon
    parts.push(this.placeBlock('CapitalWeapon', 0, -16)); // North of forward hull

    // Rear propulsion - 4x4 capital engine
    parts.push(this.placeBlock('CapitalEngine', 0, 16, 180)); // South of rear hull

    // Power reactors in the corners - 4x4 blocks
    parts.push(this.placeBlock('PowerReactor', -8, -8));  // Northwest
    parts.push(this.placeBlock('PowerReactor', 8, -8));   // Northeast
    parts.push(this.placeBlock('PowerReactor', -8, 8));   // Southwest
    parts.push(this.placeBlock('PowerReactor', 8, 8));    // Southeast

    // Secondary weapons - 2x2 large guns
    parts.push(this.placeBlock('LargeGun', -12, -4));  // Port side
    parts.push(this.placeBlock('LargeGun', -12, 4));   // Port side
    parts.push(this.placeBlock('LargeGun', 12, -4));   // Starboard side
    parts.push(this.placeBlock('LargeGun', 12, 4));    // Starboard side

    // Forward battery - 2x2 large guns
    parts.push(this.placeBlock('LargeGun', -4, -12));  // Port forward
    parts.push(this.placeBlock('LargeGun', 4, -12));   // Starboard forward

    // Secondary engines - 2x2 large engines
    parts.push(this.placeBlock('LargeEngine', -4, 12, 180));  // Port rear
    parts.push(this.placeBlock('LargeEngine', 4, 12, 180));   // Starboard rear

    // Structural support - 2x2 heavy hull
    parts.push(this.placeBlock('HeavyHull', -12, -8));  // Port forward structure
    parts.push(this.placeBlock('HeavyHull', 12, -8));   // Starboard forward structure
    parts.push(this.placeBlock('HeavyHull', -12, 8));   // Port rear structure
    parts.push(this.placeBlock('HeavyHull', 12, 8));    // Starboard rear structure

    // Command bridge - 2x2 large cockpit
    parts.push(this.placeBlock('LargeCockpit', 0, -4));  // Forward of core

    // Power distribution - 2x2 large power cells
    parts.push(this.placeBlock('LargePowerCell', -4, 0));  // Port of core
    parts.push(this.placeBlock('LargePowerCell', 4, 0));   // Starboard of core

    // Point defense turrets - 1x1 guns
    parts.push(this.placeBlock('Gun', -14, -6));  // Port side defense
    parts.push(this.placeBlock('Gun', -14, 6));   // Port side defense
    parts.push(this.placeBlock('Gun', 14, -6));   // Starboard side defense
    parts.push(this.placeBlock('Gun', 14, 6));    // Starboard side defense
    parts.push(this.placeBlock('Gun', -6, -14));  // Forward port defense
    parts.push(this.placeBlock('Gun', 6, -14));   // Forward starboard defense

    // Maneuvering thrusters - 1x1 engines
    parts.push(this.placeBlock('Engine', -6, 14, 180));  // Rear port thruster
    parts.push(this.placeBlock('Engine', 6, 14, 180));   // Rear starboard thruster
    parts.push(this.placeBlock('Engine', -10, 10, 180)); // Rear port corner
    parts.push(this.placeBlock('Engine', 10, 10, 180));  // Rear starboard corner

    // Additional power cells - 1x1 power cells
    parts.push(this.placeBlock('PowerCell', -10, -2));  // Port power
    parts.push(this.placeBlock('PowerCell', -10, 2));   // Port power
    parts.push(this.placeBlock('PowerCell', 10, -2));   // Starboard power
    parts.push(this.placeBlock('PowerCell', 10, 2));    // Starboard power

    // Structural fill - 1x1 hull pieces
    parts.push(this.placeBlock('Hull', -2, -10));  // Forward port
    parts.push(this.placeBlock('Hull', 2, -10));   // Forward starboard
    parts.push(this.placeBlock('Hull', -2, 10));   // Rear port
    parts.push(this.placeBlock('Hull', 2, 10));    // Rear starboard
    parts.push(this.placeBlock('Hull', -10, -10)); // Port forward corner
    parts.push(this.placeBlock('Hull', 10, -10));  // Starboard forward corner

    return parts;
  }

  /**
   * Create a medium cruiser with mixed block sizes
   */
  static createHeavyCruiser(): EntityConfig[] {
    const parts: EntityConfig[] = [];

    // Central command - 2x2 large cockpit
    parts.push(this.placeBlock('LargeCockpit', 0, 0));

    // Main structure - 2x2 heavy hull
    parts.push(this.placeBlock('HeavyHull', 0, -4));  // Forward
    parts.push(this.placeBlock('HeavyHull', 0, 4));   // Rear

    // Main weapons - 2x2 large guns
    parts.push(this.placeBlock('LargeGun', 0, -8));   // Forward gun
    parts.push(this.placeBlock('LargeGun', -4, -2));  // Port gun  
    parts.push(this.placeBlock('LargeGun', 4, -2));   // Starboard gun

    // Propulsion - 2x2 large engine
    parts.push(this.placeBlock('LargeEngine', 0, 8, 180)); // Main engine

    // Power - 2x2 large power cell
    parts.push(this.placeBlock('LargePowerCell', 0, 2));

    // Secondary systems - 1x1 blocks
    parts.push(this.placeBlock('Gun', -2, -6));      // Port defense
    parts.push(this.placeBlock('Gun', 2, -6));       // Starboard defense
    parts.push(this.placeBlock('Engine', -2, 6, 180)); // Port thruster
    parts.push(this.placeBlock('Engine', 2, 6, 180));  // Starboard thruster
    parts.push(this.placeBlock('PowerCell', -2, 2));   // Port power
    parts.push(this.placeBlock('PowerCell', 2, 2));    // Starboard power

    return parts;
  }
}
