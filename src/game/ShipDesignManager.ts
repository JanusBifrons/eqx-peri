/**
 * Ship Design Manager
 * 
 * Converts between the new BlockSystem and the existing Entity/Assembly system
 * while ensuring proper positioning and connections.
 */

import {
  ShipDesign,
  BlockPlacement,
  CoordinateSystem,
  BlockRegistry,
  ShipValidator,
  initializeBlockRegistry
} from './BlockSystem';
import { EntityConfig } from '../types/GameTypes';

export class ShipDesignManager {
  private static initialized = false;

  /**
   * Initialize the system
   */
  static initialize(): void {
    if (!this.initialized) {
      initializeBlockRegistry();
      this.initialized = true;
    }
  }

  /**
   * Convert a ShipDesign to EntityConfig array for the existing system
   */
  static shipDesignToEntityConfigs(design: ShipDesign): EntityConfig[] {
    this.initialize();

    // Validate the design first
    if (!ShipValidator.isValidDesign(design)) {
      throw new Error(`Invalid ship design: ${design.name} - blocks are not properly connected`);
    }

    return design.blocks.map(block => {
      const worldPos = CoordinateSystem.gridToWorld(block.gridPosition);
      const blockDef = BlockRegistry.get(block.type);

      if (!blockDef) {
        throw new Error(`Unknown block type: ${block.type}`);
      }

      return {
        type: block.type,
        x: worldPos.x,
        y: worldPos.y,
        rotation: block.rotation,
        health: blockDef.health,
        maxHealth: blockDef.health
      };
    });
  }

  /**
   * Convert EntityConfig array back to ShipDesign
   */
  static entityConfigsToShipDesign(configs: EntityConfig[], name: string): ShipDesign {
    this.initialize();

    const blocks: BlockPlacement[] = configs.map(config => ({
      type: config.type,
      gridPosition: CoordinateSystem.worldToGrid({ x: config.x, y: config.y }),
      rotation: config.rotation
    }));

    return {
      name,
      blocks
    };
  }  /**
   * Create predefined ship designs using horizontal layout (right = forward)
   */
  static createStandardDesigns(): ShipDesign[] {
    this.initialize();

    return [
      {
        name: "Long Scout",
        blocks: [
          // Extended horizontal line - Engine can connect east to Hull
          { type: 'Engine', gridPosition: { x: -3, y: 0 }, rotation: 180 },
          { type: 'Hull', gridPosition: { x: -2, y: 0 }, rotation: 0 },
          { type: 'PowerCell', gridPosition: { x: -1, y: 0 }, rotation: 0 },
          { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 1, y: 0 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 2, y: 0 }, rotation: 0 },
          { type: 'Gun', gridPosition: { x: 3, y: 0 }, rotation: 0 }
        ]
      }, {
        name: "Wide Fighter",
        blocks: [
          // T-shape with side engines instead of tip engines
          { type: 'Engine', gridPosition: { x: -2, y: 0 }, rotation: 180 },
          { type: 'PowerCell', gridPosition: { x: -1, y: 0 }, rotation: 0 },
          { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 1, y: 0 }, rotation: 0 },
          { type: 'Gun', gridPosition: { x: 2, y: 0 }, rotation: 0 },
          // Wing extensions with side-mounted engines
          { type: 'Hull', gridPosition: { x: 0, y: -1 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: -1, y: -1 }, rotation: 0 },
          { type: 'Engine', gridPosition: { x: -2, y: -1 }, rotation: 180 }, // Side engine
          { type: 'Hull', gridPosition: { x: 0, y: 1 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: -1, y: 1 }, rotation: 0 },
          { type: 'Engine', gridPosition: { x: -2, y: 1 }, rotation: 180 } // Side engine
        ]
      }, {
        name: "Long Cruiser",
        blocks: [
          // Very long line with side-mounted engines for maneuvering
          { type: 'Engine', gridPosition: { x: -4, y: 0 }, rotation: 180 },
          { type: 'Hull', gridPosition: { x: -3, y: 0 }, rotation: 0 },
          { type: 'PowerCell', gridPosition: { x: -2, y: 0 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: -1, y: 0 }, rotation: 0 },
          { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 1, y: 0 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 2, y: 0 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 3, y: 0 }, rotation: 0 },
          { type: 'Gun', gridPosition: { x: 4, y: 0 }, rotation: 0 },
          // Side maneuvering engines (side-mounted for proper connections)
          { type: 'Hull', gridPosition: { x: -2, y: -1 }, rotation: 0 },
          { type: 'Engine', gridPosition: { x: -3, y: -1 }, rotation: 180 }, // Port side engine
          { type: 'Hull', gridPosition: { x: -2, y: 1 }, rotation: 0 },
          { type: 'Engine', gridPosition: { x: -3, y: 1 }, rotation: 180 }, // Starboard side engine
          { type: 'Hull', gridPosition: { x: 2, y: -1 }, rotation: 0 },
          { type: 'Engine', gridPosition: { x: 1, y: -1 }, rotation: 0 }, // Forward port engine
          { type: 'Hull', gridPosition: { x: 2, y: 1 }, rotation: 0 },
          { type: 'Engine', gridPosition: { x: 1, y: 1 }, rotation: 0 } // Forward starboard engine
        ]
      }, {
        name: "Wide Battleship",
        blocks: [
          // Cross pattern with multiple side-mounted engines
          { type: 'Engine', gridPosition: { x: -3, y: 0 }, rotation: 180 },
          { type: 'Hull', gridPosition: { x: -2, y: 0 }, rotation: 0 },
          { type: 'PowerCell', gridPosition: { x: -1, y: 0 }, rotation: 0 },
          { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 1, y: 0 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 2, y: 0 }, rotation: 0 },
          { type: 'Gun', gridPosition: { x: 3, y: 0 }, rotation: 0 },
          // Extended wings with proper hull connections
          { type: 'Hull', gridPosition: { x: 0, y: -1 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 0, y: -2 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 0, y: 1 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 0, y: 2 }, rotation: 0 },
          // Side engines connected properly (avoiding exhaust port issues)
          { type: 'Hull', gridPosition: { x: -1, y: -1 }, rotation: 0 },
          { type: 'Engine', gridPosition: { x: -2, y: -1 }, rotation: 180 }, // Left wing engine
          { type: 'Hull', gridPosition: { x: -1, y: 1 }, rotation: 0 },
          { type: 'Engine', gridPosition: { x: -2, y: 1 }, rotation: 180 }, // Right wing engine
          { type: 'Hull', gridPosition: { x: 1, y: -1 }, rotation: 0 },
          { type: 'Engine', gridPosition: { x: 2, y: -1 }, rotation: 0 }, // Forward left engine
          { type: 'Hull', gridPosition: { x: 1, y: 1 }, rotation: 0 },
          { type: 'Engine', gridPosition: { x: 2, y: 1 }, rotation: 0 } // Forward right engine
        ]
      }
    ];
  }

  /**
   * Generate ships.json content from standard designs
   */
  static generateShipsJson(): any {
    const designs = this.createStandardDesigns();

    return {
      ships: designs.map(design => ({
        name: design.name,
        parts: this.shipDesignToEntityConfigs(design)
      }))
    };
  }

  /**
   * Validate all standard designs
   */
  static validateStandardDesigns(): { design: string; valid: boolean; error?: string }[] {
    const designs = this.createStandardDesigns();

    return designs.map(design => {
      try {
        const valid = ShipValidator.isValidDesign(design);
        return { design: design.name, valid };
      } catch (error) {
        return {
          design: design.name,
          valid: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
  }
}
