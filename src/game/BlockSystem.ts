/**
 * Modular Block System
 * 
 * This system defines how blocks connect, their properties, and provides
 * utilities for creating and validating ship designs using SOLID principles.
 * 
 * - Single Responsibility: Each class has one clear purpose
 * - Open/Closed: Easy to add new block types without modifying existing code
 * - Liskov Substitution: All blocks implement the same interface
 * - Interface Segregation: Minimal interfaces for specific capabilities
 * - Dependency Inversion: Depends on abstractions, not concrete implementations
 */

import { EntityType } from '../types/GameTypes';

// Base unit for all positioning and sizing
export const BLOCK_SIZE = 16;

// Connection directions (cardinal only for structural integrity)
export enum ConnectionDirection {
  NORTH = 'north',
  EAST = 'east', 
  SOUTH = 'south',
  WEST = 'west'
}

// Grid position (always in block-sized increments)
export interface GridPosition {
  x: number; // In BLOCK_SIZE units
  y: number; // In BLOCK_SIZE units
}

// World position (actual pixel coordinates)
export interface WorldPosition {
  x: number; // In pixels
  y: number; // In pixels
}

// Connection point definition
export interface ConnectionPoint {
  direction: ConnectionDirection;
  position: GridPosition; // Relative to block center
  canConnectTo: EntityType[];
}

// Block definition interface
export interface BlockDefinition {
  type: EntityType;
  displayName: string;
  
  // Physical properties
  size: { width: number; height: number }; // In BLOCK_SIZE units (usually 1x1)
  mass: number;
  health: number;
  
  // Visual properties  
  color: string;
  
  // Connection system
  connectionPoints: ConnectionPoint[];
  
  // Capabilities
  capabilities: BlockCapability[];
}

// Block capabilities (using interface segregation)
export enum BlockCapability {
  CONTROL = 'control',        // Can control the ship
  THRUST = 'thrust',          // Can provide propulsion
  WEAPON = 'weapon',          // Can fire weapons
  POWER = 'power',            // Can provide power
  STRUCTURE = 'structure'     // Provides structural support
}

// Block placement in a design
export interface BlockPlacement {
  type: EntityType;
  gridPosition: GridPosition;
  rotation: number; // 0, 90, 180, 270 degrees
}

// Ship design (collection of connected blocks)
export interface ShipDesign {
  name: string;
  blocks: BlockPlacement[];
}

/**
 * Utility class for grid/world coordinate conversion
 */
export class CoordinateSystem {
  /**
   * Convert grid position to world position
   */
  static gridToWorld(gridPos: GridPosition): WorldPosition {
    return {
      x: gridPos.x * BLOCK_SIZE,
      y: gridPos.y * BLOCK_SIZE
    };
  }
  
  /**
   * Convert world position to grid position
   */
  static worldToGrid(worldPos: WorldPosition): GridPosition {
    return {
      x: Math.round(worldPos.x / BLOCK_SIZE),
      y: Math.round(worldPos.y / BLOCK_SIZE)
    };
  }
  
  /**
   * Get adjacent grid position in a direction
   */
  static getAdjacentPosition(pos: GridPosition, direction: ConnectionDirection): GridPosition {
    switch (direction) {
      case ConnectionDirection.NORTH:
        return { x: pos.x, y: pos.y - 1 };
      case ConnectionDirection.EAST:
        return { x: pos.x + 1, y: pos.y };
      case ConnectionDirection.SOUTH:
        return { x: pos.x, y: pos.y + 1 };
      case ConnectionDirection.WEST:
        return { x: pos.x - 1, y: pos.y };
    }
  }
}

/**
 * Block registry containing all available block types
 */
export class BlockRegistry {
  private static definitions = new Map<EntityType, BlockDefinition>();
  
  static register(definition: BlockDefinition): void {
    this.definitions.set(definition.type, definition);
  }
  
  static get(type: EntityType): BlockDefinition | undefined {
    return this.definitions.get(type);
  }
  
  static getAll(): BlockDefinition[] {
    return Array.from(this.definitions.values());
  }
}

/**
 * Ship design validator
 */
export class ShipValidator {
  /**
   * Check if a ship design is valid (all blocks are connected)
   */
  static isValidDesign(design: ShipDesign): boolean {
    if (design.blocks.length === 0) return false;
    if (design.blocks.length === 1) return true;
    
    // Build adjacency map
    const adjacencyMap = this.buildAdjacencyMap(design);
    
    // Check if all blocks are reachable from the first block
    const visited = new Set<string>();
    const toVisit = [this.getBlockKey(design.blocks[0])];
    
    while (toVisit.length > 0) {
      const current = toVisit.pop()!;
      if (visited.has(current)) continue;
      
      visited.add(current);
      const neighbors = adjacencyMap.get(current) || [];
      toVisit.push(...neighbors.filter(n => !visited.has(n)));
    }
    
    return visited.size === design.blocks.length;
  }
    /**
   * Check if two blocks can connect at their given positions
   */
  static canBlocksConnect(block1: BlockPlacement, block2: BlockPlacement): boolean {
    const def1 = BlockRegistry.get(block1.type);
    const def2 = BlockRegistry.get(block2.type);
    
    if (!def1 || !def2) return false;
    
    // Calculate the actual distance between block centers
    const dx = block2.gridPosition.x - block1.gridPosition.x;
    const dy = block2.gridPosition.y - block1.gridPosition.y;
    
    // Calculate expected distance for edge-to-edge connection
    // For blocks to connect, they need to be adjacent (edge touching)
    const expectedDistanceX = (def1.size.width + def2.size.width) / 2;
    const expectedDistanceY = (def1.size.height + def2.size.height) / 2;
    
    // Check if blocks are properly adjacent (not overlapping, not too far apart)
    const isAdjacentX = Math.abs(dx) === expectedDistanceX && dy === 0;
    const isAdjacentY = Math.abs(dy) === expectedDistanceY && dx === 0;
    
    if (!(isAdjacentX || isAdjacentY)) {
      return false; // Not properly adjacent
    }
    
    // Determine the connection direction from block1 to block2
    let direction: ConnectionDirection;
    if (isAdjacentX) {
      direction = dx > 0 ? ConnectionDirection.EAST : ConnectionDirection.WEST;
    } else {
      direction = dy > 0 ? ConnectionDirection.SOUTH : ConnectionDirection.NORTH;
    }
    
    // Check if block1 has a connection point in that direction that accepts block2's type
    const connectionPoint = def1.connectionPoints.find(cp => cp.direction === direction);
    if (!connectionPoint || !connectionPoint.canConnectTo.includes(block2.type)) {
      return false;
    }
    
    // Check reverse connection (block2 should accept block1's type)
    const reverseDirection = this.getReverseDirection(direction);
    const reverseConnectionPoint = def2.connectionPoints.find(cp => cp.direction === reverseDirection);
    if (!reverseConnectionPoint || !reverseConnectionPoint.canConnectTo.includes(block1.type)) {
      return false;
    }
    
    return true;
  }
  
  private static buildAdjacencyMap(design: ShipDesign): Map<string, string[]> {
    const map = new Map<string, string[]>();
    
    for (const block of design.blocks) {
      map.set(this.getBlockKey(block), []);
    }
    
    for (let i = 0; i < design.blocks.length; i++) {
      for (let j = i + 1; j < design.blocks.length; j++) {
        const block1 = design.blocks[i];
        const block2 = design.blocks[j];
        
        if (this.canBlocksConnect(block1, block2)) {
          const key1 = this.getBlockKey(block1);
          const key2 = this.getBlockKey(block2);
          
          map.get(key1)!.push(key2);
          map.get(key2)!.push(key1);
        }
      }
    }
    
    return map;
  }
  
  private static getBlockKey(block: BlockPlacement): string {
    return `${block.gridPosition.x},${block.gridPosition.y}`;
  }
  
  private static getReverseDirection(direction: ConnectionDirection): ConnectionDirection {
    switch (direction) {
      case ConnectionDirection.NORTH: return ConnectionDirection.SOUTH;
      case ConnectionDirection.EAST: return ConnectionDirection.WEST;
      case ConnectionDirection.SOUTH: return ConnectionDirection.NORTH;
      case ConnectionDirection.WEST: return ConnectionDirection.EAST;
    }
  }
}

/**
 * Initialize the block registry with standard block definitions
 */
export function initializeBlockRegistry(): void {
  // Cockpit - Command and control center
  BlockRegistry.register({
    type: 'Cockpit',
    displayName: 'Cockpit',
    size: { width: 1, height: 1 },
    mass: 10,
    health: 100,
    color: '#00ff00',
    capabilities: [BlockCapability.CONTROL],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: 0 }, canConnectTo: ['Engine', 'Gun', 'Hull', 'PowerCell'] },
      { direction: ConnectionDirection.EAST, position: { x: 0, y: 0 }, canConnectTo: ['Engine', 'Gun', 'Hull', 'PowerCell'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 0 }, canConnectTo: ['Engine', 'Gun', 'Hull', 'PowerCell'] },
      { direction: ConnectionDirection.WEST, position: { x: 0, y: 0 }, canConnectTo: ['Engine', 'Gun', 'Hull', 'PowerCell'] }
    ]
  });
  
  // Engine - Propulsion system
  BlockRegistry.register({
    type: 'Engine',
    displayName: 'Engine',
    size: { width: 1, height: 1 },
    mass: 15,
    health: 80,
    color: '#ff6600',
    capabilities: [BlockCapability.THRUST],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Hull', 'PowerCell'] },
      { direction: ConnectionDirection.EAST, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Hull', 'PowerCell'] },
      { direction: ConnectionDirection.WEST, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Hull', 'PowerCell'] }
      // No south connection - exhaust port
    ]
  });
  
  // Gun - Weapon system
  BlockRegistry.register({
    type: 'Gun',
    displayName: 'Gun',
    size: { width: 1, height: 1 },
    mass: 8,
    health: 60,
    color: '#ff0000',
    capabilities: [BlockCapability.WEAPON],
    connectionPoints: [
      { direction: ConnectionDirection.EAST, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Hull', 'PowerCell'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Hull', 'PowerCell'] },
      { direction: ConnectionDirection.WEST, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Hull', 'PowerCell'] }
      // No north connection - weapon fires forward
    ]
  });
  
  // Hull - Structural support
  BlockRegistry.register({
    type: 'Hull',
    displayName: 'Hull',
    size: { width: 1, height: 1 },
    mass: 12,
    health: 120,
    color: '#888888',
    capabilities: [BlockCapability.STRUCTURE],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell'] },
      { direction: ConnectionDirection.EAST, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell'] },
      { direction: ConnectionDirection.WEST, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell'] }
    ]
  });
    // PowerCell - Energy storage
  BlockRegistry.register({
    type: 'PowerCell',
    displayName: 'Power Cell',
    size: { width: 1, height: 1 },
    mass: 6,
    health: 40,
    color: '#ffff00',
    capabilities: [BlockCapability.POWER],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull'] },
      { direction: ConnectionDirection.EAST, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull'] },
      { direction: ConnectionDirection.WEST, position: { x: 0, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull'] }
    ]
  });

  // Large sized blocks (2x2)
  BlockRegistry.register({
    type: 'LargeCockpit',
    displayName: 'Large Cockpit',
    size: { width: 2, height: 2 },
    mass: 25,
    health: 250,
    color: '#00aa00',
    capabilities: [BlockCapability.CONTROL],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: -1 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.EAST, position: { x: 1, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 1 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.WEST, position: { x: -1, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] }
    ]
  });
  BlockRegistry.register({
    type: 'LargeEngine',
    displayName: 'Large Engine',
    size: { width: 2, height: 2 },
    mass: 40,
    health: 200,
    color: '#cc4400',
    capabilities: [BlockCapability.THRUST],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: -1 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.EAST, position: { x: 1, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 1 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.WEST, position: { x: -1, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] }
    ]
  });
  BlockRegistry.register({
    type: 'LargeGun',
    displayName: 'Large Gun',
    size: { width: 2, height: 2 },
    mass: 20,
    health: 150,
    color: '#cc0000',
    capabilities: [BlockCapability.WEAPON],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: -1 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.EAST, position: { x: 1, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 1 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.WEST, position: { x: -1, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] }
    ]
  });

  BlockRegistry.register({
    type: 'HeavyHull',
    displayName: 'Heavy Hull',
    size: { width: 2, height: 2 },
    mass: 30,
    health: 300,
    color: '#666666',
    capabilities: [BlockCapability.STRUCTURE],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: -1 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.EAST, position: { x: 1, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 1 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.WEST, position: { x: -1, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] }
    ]
  });
  BlockRegistry.register({
    type: 'LargePowerCell',
    displayName: 'Large Power Cell',
    size: { width: 2, height: 2 },
    mass: 15,
    health: 100,
    color: '#dddd00',
    capabilities: [BlockCapability.POWER],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: -1 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.EAST, position: { x: 1, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 1 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] },
      { direction: ConnectionDirection.WEST, position: { x: -1, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'] }
    ]
  });

  // Capital ship sized blocks (4x4)
  BlockRegistry.register({
    type: 'CapitalCore',
    displayName: 'Capital Core',
    size: { width: 4, height: 4 },
    mass: 100,
    health: 1000,
    color: '#0066ff',
    capabilities: [BlockCapability.CONTROL, BlockCapability.POWER],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: -2 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor'] },
      { direction: ConnectionDirection.EAST, position: { x: 2, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 2 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor'] },
      { direction: ConnectionDirection.WEST, position: { x: -2, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor'] }
    ]
  });

  BlockRegistry.register({
    type: 'CapitalEngine',
    displayName: 'Capital Engine',
    size: { width: 4, height: 4 },
    mass: 150,
    health: 800,
    color: '#ff3300',
    capabilities: [BlockCapability.THRUST],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: -2 }, canConnectTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'MegaHull', 'PowerReactor'] },
      { direction: ConnectionDirection.EAST, position: { x: 2, y: 0 }, canConnectTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'MegaHull', 'PowerReactor'] },
      { direction: ConnectionDirection.WEST, position: { x: -2, y: 0 }, canConnectTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'MegaHull', 'PowerReactor'] }
    ]
  });

  BlockRegistry.register({
    type: 'CapitalWeapon',
    displayName: 'Capital Weapon',
    size: { width: 4, height: 4 },
    mass: 80,
    health: 600,
    color: '#aa0000',
    capabilities: [BlockCapability.WEAPON],
    connectionPoints: [
      { direction: ConnectionDirection.EAST, position: { x: 2, y: 0 }, canConnectTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'MegaHull', 'PowerReactor'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 2 }, canConnectTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'MegaHull', 'PowerReactor'] },
      { direction: ConnectionDirection.WEST, position: { x: -2, y: 0 }, canConnectTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'MegaHull', 'PowerReactor'] }
    ]
  });

  BlockRegistry.register({
    type: 'MegaHull',
    displayName: 'Mega Hull',
    size: { width: 4, height: 4 },
    mass: 120,
    health: 1200,
    color: '#444444',
    capabilities: [BlockCapability.STRUCTURE],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: -2 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor'] },
      { direction: ConnectionDirection.EAST, position: { x: 2, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 2 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor'] },
      { direction: ConnectionDirection.WEST, position: { x: -2, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor'] }
    ]
  });

  BlockRegistry.register({
    type: 'PowerReactor',
    displayName: 'Power Reactor',
    size: { width: 4, height: 4 },
    mass: 60,
    health: 400,
    color: '#ffaa00',
    capabilities: [BlockCapability.POWER],
    connectionPoints: [
      { direction: ConnectionDirection.NORTH, position: { x: 0, y: -2 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull'] },
      { direction: ConnectionDirection.EAST, position: { x: 2, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull'] },
      { direction: ConnectionDirection.SOUTH, position: { x: 0, y: 2 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull'] },
      { direction: ConnectionDirection.WEST, position: { x: -2, y: 0 }, canConnectTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull'] }
    ]
  });
}

/**
 * Validate entity placement using the new block system
 */
export function validateEntityPlacement(entities: any[]): boolean {
  if (entities.length === 0) return false;
  
  // Convert entities to block placements
  const blocks: BlockPlacement[] = entities.map(entity => ({
    type: entity.type,
    gridPosition: CoordinateSystem.worldToGrid({ x: entity.x, y: entity.y }),
    rotation: entity.rotation || 0
  }));
  
  const design: ShipDesign = {
    name: 'Validation',
    blocks: blocks
  };
  
  return ShipValidator.isValidDesign(design);
}

/**
 * Get block definition for an entity type
 */
export function getBlockDefinition(type: EntityType): BlockDefinition | undefined {
  return BlockRegistry.get(type);
}

/**
 * Check if two entities are properly adjacent (touching but not overlapping)
 */
export function areEntitiesAdjacent(entity1: any, entity2: any): boolean {
  const def1 = BlockRegistry.get(entity1.type);
  const def2 = BlockRegistry.get(entity2.type);
  
  if (!def1 || !def2) return false;
  
  // Check if entities have any connection points that align
  for (const cp1 of def1.connectionPoints) {
    // Calculate world position of connection point 1
    const cp1WorldX = entity1.x + (cp1.position.x * BLOCK_SIZE);
    const cp1WorldY = entity1.y + (cp1.position.y * BLOCK_SIZE);
    
    for (const cp2 of def2.connectionPoints) {
      // Calculate world position of connection point 2
      const cp2WorldX = entity2.x + (cp2.position.x * BLOCK_SIZE);
      const cp2WorldY = entity2.y + (cp2.position.y * BLOCK_SIZE);
      
      // Check if connection points are close enough and compatible
      const cpDx = Math.abs(cp1WorldX - cp2WorldX);
      const cpDy = Math.abs(cp1WorldY - cp2WorldY);
      
      // Connection points should be very close (within 1 pixel tolerance)
      const arePointsAligned = cpDx <= 1 && cpDy <= 1;
      
      // Check if connection directions are opposite (they connect to each other)
      const areDirectionsCompatible = 
        (cp1.direction === ConnectionDirection.NORTH && cp2.direction === ConnectionDirection.SOUTH) ||
        (cp1.direction === ConnectionDirection.SOUTH && cp2.direction === ConnectionDirection.NORTH) ||
        (cp1.direction === ConnectionDirection.EAST && cp2.direction === ConnectionDirection.WEST) ||
        (cp1.direction === ConnectionDirection.WEST && cp2.direction === ConnectionDirection.EAST);
      
      // Check if the block types are compatible
      const areTypesCompatible = 
        cp1.canConnectTo.includes(entity2.type) && cp2.canConnectTo.includes(entity1.type);
      
      if (arePointsAligned && areDirectionsCompatible && areTypesCompatible) {
        return true;
      }
    }
  }
  
  return false;
}

// Initialize the block registry
initializeBlockRegistry();
