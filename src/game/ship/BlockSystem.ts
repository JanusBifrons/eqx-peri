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

import { EntityType, ENTITY_DEFINITIONS, GRID_SIZE } from '../../types/GameTypes';

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
  }  /**
   * Check if two blocks can connect at their given positions
   * Updated to use the existing ENTITY_DEFINITIONS system
   */
  static canBlocksConnect(block1: BlockPlacement, block2: BlockPlacement): boolean {
    const def1 = ENTITY_DEFINITIONS[block1.type];
    const def2 = ENTITY_DEFINITIONS[block2.type];

    if (!def1 || !def2) return false;

    // Check mutual compatibility using the existing canAttachTo system
    if (!def1.canAttachTo.includes(block2.type) || !def2.canAttachTo.includes(block1.type)) {
      return false;
    }

    // Calculate the actual distance between block centers
    const dx = block2.gridPosition.x - block1.gridPosition.x;
    const dy = block2.gridPosition.y - block1.gridPosition.y;

    // For the existing system, blocks are considered adjacent if they're exactly 1 grid unit apart
    const isAdjacentX = Math.abs(dx) === 1 && dy === 0;
    const isAdjacentY = Math.abs(dy) === 1 && dx === 0;

    if (!(isAdjacentX || isAdjacentY)) {
      return false; // Not properly adjacent
    }

    // Convert to world coordinates to check attachment points
    const pos1 = CoordinateSystem.gridToWorld(block1.gridPosition);
    const pos2 = CoordinateSystem.gridToWorld(block2.gridPosition);

    // Check if any attachment points are close enough to connect
    for (const ap1 of def1.attachmentPoints) {
      const worldAP1 = {
        x: pos1.x + ap1.x * GRID_SIZE,
        y: pos1.y + ap1.y * GRID_SIZE
      };

      for (const ap2 of def2.attachmentPoints) {
        const worldAP2 = {
          x: pos2.x + ap2.x * GRID_SIZE,
          y: pos2.y + ap2.y * GRID_SIZE
        };

        const distance = Math.sqrt(
          Math.pow(worldAP1.x - worldAP2.x, 2) + 
          Math.pow(worldAP1.y - worldAP2.y, 2)
        );        // If attachment points are close enough (within 1 grid unit), they can connect
        if (distance <= GRID_SIZE + 1) {
          return true;
        }
      }
    }

    return false;
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
 * Robust connection detection for ship entities
 * Uses grid-based positioning with proper adjacency rules
 */
export class ConnectionDetector {
  /**
   * Check if two entities are properly connected
   * This is the main function that should be used for connection detection
   */
  static areEntitiesConnected(entity1: any, entity2: any): boolean {
    const def1 = ENTITY_DEFINITIONS[entity1.type as EntityType];
    const def2 = ENTITY_DEFINITIONS[entity2.type as EntityType];

    if (!def1 || !def2) {
      return false;
    }

    // Check if the entities can actually connect to each other (mutual compatibility)
    if (!def1.canAttachTo.includes(entity2.type) || !def2.canAttachTo.includes(entity1.type)) {
      return false;
    }

    // Use the entity's built-in attachment point transformation methods
    let entity1WorldPoints = [];
    let entity2WorldPoints = [];

    // Check if these are actual Entity objects with the getWorldAttachmentPoints method
    if (typeof entity1.getWorldAttachmentPoints === 'function') {
      entity1WorldPoints = entity1.getWorldAttachmentPoints();
    } else {
      // Fallback for plain config objects - transform manually
      const pos1 = { x: entity1.x, y: entity1.y };
      entity1WorldPoints = def1.attachmentPoints.map(ap => ({
        x: pos1.x + ap.x * GRID_SIZE,
        y: pos1.y + ap.y * GRID_SIZE
      }));
    }

    if (typeof entity2.getWorldAttachmentPoints === 'function') {
      entity2WorldPoints = entity2.getWorldAttachmentPoints();
    } else {
      // Fallback for plain config objects - transform manually
      const pos2 = { x: entity2.x, y: entity2.y };
      entity2WorldPoints = def2.attachmentPoints.map(ap => ({
        x: pos2.x + ap.x * GRID_SIZE,
        y: pos2.y + ap.y * GRID_SIZE
      }));
    }

    if (entity1WorldPoints.length === 0 || entity2WorldPoints.length === 0) {
      return false;
    }

    // Check all attachment point pairs for connection
    for (const point1 of entity1WorldPoints) {
      for (const point2 of entity2WorldPoints) {
        const distance = Math.sqrt(
          Math.pow(point1.x - point2.x, 2) + 
          Math.pow(point1.y - point2.y, 2)
        );

        // Allow for connections within a reasonable distance
        // For large blocks (4x4 = 64px), adjacent blocks can have attachment points up to ~90px apart
        if (distance <= 66) {
          return true;
        }
      }
    }
    
    return false;  }
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use ConnectionDetector.areEntitiesConnected instead
 */
export function areEntitiesAdjacent(entity1: any, entity2: any): boolean {
  return ConnectionDetector.areEntitiesConnected(entity1, entity2);
}

// Initialize the block registry
initializeBlockRegistry();
