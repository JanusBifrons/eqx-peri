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
        name: "Scout Fighter",
        blocks: [
          // Simple horizontal line: Engine-Cockpit-Gun
          { type: 'Engine', gridPosition: { x: -1, y: 0 }, rotation: 180 },
          { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 },
          { type: 'Gun', gridPosition: { x: 1, y: 0 }, rotation: 0 }
        ]
      },
      {
        name: "Heavy Cruiser", 
        blocks: [
          // Basic cross pattern
          { type: 'Engine', gridPosition: { x: -1, y: 0 }, rotation: 180 },
          { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 },
          { type: 'Gun', gridPosition: { x: 1, y: 0 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 0, y: -1 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 0, y: 1 }, rotation: 0 }
        ]
      },
      {
        name: "Battleship",
        blocks: [
          // Simple line with power
          { type: 'Engine', gridPosition: { x: -2, y: 0 }, rotation: 180 },
          { type: 'PowerCell', gridPosition: { x: -1, y: 0 }, rotation: 0 },
          { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 },
          { type: 'Hull', gridPosition: { x: 1, y: 0 }, rotation: 0 },
          { type: 'Gun', gridPosition: { x: 2, y: 0 }, rotation: 0 }
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
