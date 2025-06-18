import { EntityConfig, EntityType } from '../types/GameTypes';

/**
 * Direction enumeration for intuitive ship design
 */
export type Direction = 'forward' | 'backward' | 'left' | 'right';

/**
 * Grid-based ship designer that ensures proper block placement and connections
 */
export class ShipDesigner {
  private static readonly GRID_UNIT = 16; // Base grid unit in pixels

  /**
   * Convert direction to rotation angle
   * forward = 0° (pointing right/positive X)
   * right = 90° (pointing down/positive Y) 
   * backward = 180° (pointing left/negative X)
   * left = 270° (pointing up/negative Y)
   */
  private static directionToRotation(direction: Direction): number {
    switch (direction) {
      case 'forward': return 0;
      case 'right': return 90;
      case 'backward': return 180;
      case 'left': return 270;
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
   * Place a block at grid coordinates with directional facing
   */
  private static placeBlock(type: EntityType, gridX: number, gridY: number, facing: Direction = 'forward'): EntityConfig {
    const worldPos = this.gridToWorld(gridX, gridY);
    return {
      type,
      x: worldPos.x,
      y: worldPos.y,
      rotation: this.directionToRotation(facing)
    };
  }

  /**
   * Legacy method for backward compatibility with numerical rotations
   */  // @ts-ignore - Currently unused but may be needed later
  private static placeBlockWithRotation(type: EntityType, gridX: number, gridY: number, rotation: number = 0): EntityConfig {
    const worldPos = this.gridToWorld(gridX, gridY);
    return {
      type,
      x: worldPos.x,
      y: worldPos.y,
      rotation
    };
  }
  /**
   * Create a simple horizontal fighter ship
   * Layout: Engine <- Hull <- Cockpit -> Gun
   */
  static createBasicFighter(): EntityConfig[] {
    const parts: EntityConfig[] = [];

    // Central cockpit at origin
    parts.push(this.placeBlock('Cockpit', 0, 0, 'forward')); // Faces right

    // Gun at front (right side)
    parts.push(this.placeBlock('Gun', 1, 0, 'forward')); // Faces right

    // Hull behind cockpit
    parts.push(this.placeBlock('Hull', -1, 0, 'forward'));

    // Engine at back (left side) - faces backward to push ship forward
    parts.push(this.placeBlock('Engine', -2, 0, 'backward')); // Faces left to push right

    // Power cell
    parts.push(this.placeBlock('PowerCell', 0, 1, 'forward'));

    return parts;
  }

  /**
   * Create a horizontal heavy cruiser
   * Layout: Engine <- Hull <- Cockpit -> Hull -> Gun
   */
  static createHeavyCruiser(): EntityConfig[] {
    const parts: EntityConfig[] = [];

    // Central large cockpit
    parts.push(this.placeBlock('LargeCockpit', 0, 0, 'forward')); // 2x2 block

    // Forward section (right side)
    parts.push(this.placeBlock('LargeGun', 3, 0, 'forward')); // 2x2 gun
    parts.push(this.placeBlock('Hull', 2, 1, 'forward'));
    parts.push(this.placeBlock('Hull', 2, -1, 'forward'));

    // Rear section (left side)  
    parts.push(this.placeBlock('LargeEngine', -3, 0, 'backward')); // 2x2 engine
    parts.push(this.placeBlock('Hull', -2, 1, 'forward'));
    parts.push(this.placeBlock('Hull', -2, -1, 'forward'));

    // Side weapons
    parts.push(this.placeBlock('Gun', 1, 2, 'right'));  // Port gun faces down
    parts.push(this.placeBlock('Gun', 1, -2, 'left'));  // Starboard gun faces up

    // Power systems
    parts.push(this.placeBlock('LargePowerCell', -1, 0, 'forward')); // 2x2 power

    return parts;
  }

  /**
   * Create a massive horizontal capital ship
   * Layout: Multiple engines on left, core in center, weapons on right
   */
  static createCapitalDreadnought(): EntityConfig[] {
    const parts: EntityConfig[] = [];

    // Central core
    parts.push(this.placeBlock('CapitalCore', 0, 0, 'forward')); // 4x4 core

    // Forward weapons section (right side)
    parts.push(this.placeBlock('CapitalWeapon', 5, 0, 'forward')); // 4x4 weapon
    parts.push(this.placeBlock('LargeGun', 3, 3, 'forward')); // 2x2 gun
    parts.push(this.placeBlock('LargeGun', 3, -3, 'forward')); // 2x2 gun

    // Rear propulsion (left side)
    parts.push(this.placeBlock('CapitalEngine', -5, 0, 'backward')); // 4x4 engine
    parts.push(this.placeBlock('LargeEngine', -3, 3, 'backward')); // 2x2 engine  
    parts.push(this.placeBlock('LargeEngine', -3, -3, 'backward')); // 2x2 engine

    // Power systems
    parts.push(this.placeBlock('PowerReactor', 0, 5, 'forward')); // 4x4 reactor
    parts.push(this.placeBlock('PowerReactor', 0, -5, 'forward')); // 4x4 reactor

    // Structural hull
    parts.push(this.placeBlock('MegaHull', 2, 0, 'forward')); // 4x4 hull
    parts.push(this.placeBlock('MegaHull', -2, 0, 'forward')); // 4x4 hull

    // Additional defensive guns
    parts.push(this.placeBlock('Gun', 1, 6, 'right'));  // Top defense
    parts.push(this.placeBlock('Gun', 1, -6, 'left'));  // Bottom defense
    parts.push(this.placeBlock('Gun', -1, 6, 'right')); // Top rear defense
    parts.push(this.placeBlock('Gun', -1, -6, 'left')); // Bottom rear defense

    return parts;
  }

  /**
   * Create a survival test ship that demonstrates cockpit weapon/engine features
   * Layout: Engine <- Hull <- Cockpit (with clear top and bottom for built-in systems)
   */
  static createSurvivalTest(): EntityConfig[] {
    const parts: EntityConfig[] = [];

    // Central cockpit at origin - deliberately leave top and bottom clear
    parts.push(this.placeBlock('Cockpit', 0, 0, 'forward')); // Faces right

    // Hull to the left (rear)
    parts.push(this.placeBlock('Hull', -1, 0, 'forward'));

    // Traditional engine behind hull
    parts.push(this.placeBlock('Engine', -2, 0, 'backward')); // Faces left to push right

    // Gun to the right (front) - but offset so cockpit top is clear
    parts.push(this.placeBlock('Gun', 1, 1, 'forward')); // Offset down so cockpit top is free

    // Power cell below hull
    parts.push(this.placeBlock('PowerCell', -1, 1, 'forward'));

    return parts;
  }

  /**
   * Create a large survival ship with enhanced cockpit
   * Layout: Large cockpit with strategic connections to test survival features
   */
  static createLargeSurvivalTest(): EntityConfig[] {
    const parts: EntityConfig[] = [];

    // Central large cockpit at origin
    parts.push(this.placeBlock('LargeCockpit', 0, 0, 'forward')); // 2x2 block

    // Connect only to sides to leave top and bottom clear for built-in systems
    parts.push(this.placeBlock('HeavyHull', -3, 0, 'forward')); // Left side
    parts.push(this.placeBlock('HeavyHull', 3, 0, 'forward'));  // Right side

    // Add traditional components to sides
    parts.push(this.placeBlock('LargeEngine', -6, 0, 'backward')); // Far left
    parts.push(this.placeBlock('LargeGun', 6, 0, 'forward'));     // Far right

    // Power support
    parts.push(this.placeBlock('LargePowerCell', 0, 3, 'forward')); // Below, but not blocking cockpit bottom

    return parts;
  }
}
