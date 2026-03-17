export type EntityType = 'Cockpit' | 'Engine' | 'Gun' | 'Hull' | 'PowerCell' |
  'LargeCockpit' | 'LargeEngine' | 'LargeGun' | 'HeavyHull' | 'LargePowerCell' |
  'CapitalCore' | 'CapitalEngine' | 'CapitalWeapon' | 'MegaHull' | 'PowerReactor' |
  'MissileLauncher' | 'LargeMissileLauncher' | 'CapitalMissileLauncher' |
  'Shield' | 'LargeShield' |
  'Beam' | 'LargeBeam' |
  'RectHull' | 'Hull1x3' | 'Hull1x4' | 'Hull2x2' |
  'Hull5x1' | 'Hull3x2' | 'Hull4x2' | 'Hull5x2' |
  'Hull3x3' | 'Hull4x3' | 'Hull5x3' | 'Hull4x4' | 'Hull5x4' | 'Hull5x5' |
  'TriHull' | 'TriHull2x1' | 'TriHull3x1' | 'TriHull2x2' |
  'TriHull4x1' | 'TriHull5x1' | 'TriHull3x2' | 'TriHull4x2' | 'TriHull5x2' |
  'TriHull3x3' | 'TriHull4x3' | 'TriHull5x3' | 'TriHull4x4' | 'TriHull5x4' | 'TriHull5x5';

export interface EntityConfig {
  type: EntityType;
  x: number;
  y: number;
  rotation: number; // 0, 90, 180, 270
  health?: number;
  maxHealth?: number;
}

export interface Vector2 {
  x: number;
  y: number;
}

export interface ShipDefinition {
  name: string;
  parts: EntityConfig[];
}

export interface EntityTypeDefinition {
  type: EntityType;
  width: number;
  height: number;
  /** Grid columns occupied at rotation 0. Default 1. */
  gridCols?: number;
  /** Grid rows occupied at rotation 0. Default 1. */
  gridRows?: number;
  mass: number;
  defaultHealth: number;
  color: string;
  /** Block geometry shape — 'rect' for rectangular, 'triangle' for right-angle triangle. */
  shape: 'rect' | 'triangle';
  thrust?: number;    // Optional thrust value for engine parts
  shieldHp?: number;  // Max shield field HP for shield-type blocks
  shieldRadius?: number; // Fixed shield bubble radius in world units (shield blocks only)
  beamRange?: number; // Max beam length in world units (beam weapons only)
  beamDps?: number;   // Damage per second (beam weapons only)
  /** Sides (at rotation 0) where this block has no physical face — used for TriHull. */
  blockedSidesBase?: readonly ('north' | 'east' | 'south' | 'west')[];
  canAttachTo: EntityType[];
  attachmentPoints: Vector2[]; // relative to anchor cell, in grid units
}

// Shield field state — stored on Assembly, not Entity.
// currentHp regenerates; maxHp degrades when hits land.
export interface ShieldState {
  currentHp: number;
  maxHp: number;
  isActive: boolean;
  lastHitTime: number;   // ms timestamp of last shield impact
  cooldownUntil: number; // ms timestamp — shield cannot reactivate before this
}

export const SHIELD_REGEN_DELAY_MS = 3000;      // Time after last hit before regen begins
export const SHIELD_REGEN_DURATION_MS = 1000;   // Full regen from 0→max in this many ms
export const SHIELD_COLLAPSE_COOLDOWN_MS = 8000; // Post-collapse lockout before reactivation

// Beam weapon constants
export const BEAM_SMALL_RANGE = 400;     // Max range in world units for Beam
export const BEAM_SMALL_DPS = 30;        // Damage per second for Beam
export const BEAM_LARGE_RANGE = 600;     // Max range in world units for LargeBeam
export const BEAM_LARGE_DPS = 80;        // Damage per second for LargeBeam
export const BEAM_DISPLAY_DURATION_MS = 80; // How long beam visual persists after last firing

// Performance metrics snapshot — returned by GameEngine.getPerformanceMetrics()
export interface PerformanceMetrics {
  fps: number;              // Smoothed frames per second
  tickMs: number;           // Last game-loop tick duration in ms
  memoryMb: number | null;  // JS heap used (MB) — null if browser doesn't expose it
  physicsBodyCount: number; // Total bodies in the Matter.js world
  assemblyCount: number;    // Live assemblies (ships + debris)
  entityCount: number;      // Total entity blocks across all assemblies
  laserCount: number;       // Active laser bolts
  missileCount: number;     // Active (non-destroyed) missiles
  collisionsPerSecond: number; // Physics collision pairs per second (1 s rolling average)
}

// Connection information for tracking what's attached to each attachment point
export interface AttachmentConnection {
  connectedEntity: string | null; // Entity ID that's connected to this point
  attachmentPointIndex: number; // Which attachment point index this connects to
}

export const GRID_SIZE = 16;

// ---------------------------------------------------------------------------
// Structural block constants & factory functions
// ---------------------------------------------------------------------------

const RECT_HULL_MASS_PER_CELL = 600;
const RECT_HULL_HEALTH_PER_CELL = 120; // slightly less for multi-cell (first cell full, rest ~93)
const TRI_HULL_MASS_PER_CELL = 300;
const TRI_HULL_HEALTH_PER_CELL = 60;
const STRUCTURAL_COLOR = '#778899';

/** Returns true if the given entity type is a structural hull block (rect or triangle). */
export function isStructuralBlock(type: EntityType): boolean {
  const def = ENTITY_DEFINITIONS[type];
  return def !== undefined && STRUCTURAL_TYPES.has(type);
}

/** Set of all structural block type names — used by isStructuralBlock and canAttachTo filtering. */
const STRUCTURAL_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  // Rectangular hulls
  'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2',
  'Hull5x1', 'Hull3x2', 'Hull4x2', 'Hull5x2',
  'Hull3x3', 'Hull4x3', 'Hull5x3', 'Hull4x4', 'Hull5x4', 'Hull5x5',
  // Triangle hulls
  'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2',
  'TriHull4x1', 'TriHull5x1', 'TriHull3x2', 'TriHull4x2', 'TriHull5x2',
  'TriHull3x3', 'TriHull4x3', 'TriHull5x3', 'TriHull4x4', 'TriHull5x4', 'TriHull5x5',
]);

/**
 * Auto-generate attachment points for a rectangular hull block.
 * One point per external face of each occupied cell (perimeter only).
 */
function generateRectAttachmentPoints(cols: number, rows: number): Vector2[] {
  const points: Vector2[] = [];
  for (let c = 0; c < cols; c++) {
    points.push({ x: c, y: -1 });        // north face
    points.push({ x: c, y: rows });      // south face
  }
  for (let r = 0; r < rows; r++) {
    points.push({ x: -1, y: r });        // west face
    points.push({ x: cols, y: r });      // east face
  }
  return points;
}

/**
 * Auto-generate attachment points for a triangle hull block.
 * Only the straight sides (north + west at rotation 0) have connection points;
 * the hypotenuse (east + south) is blocked.
 */
function generateTriAttachmentPoints(cols: number, rows: number): Vector2[] {
  const points: Vector2[] = [];
  // North face — full width
  for (let c = 0; c < cols; c++) {
    points.push({ x: c, y: -1 });
  }
  // West face — full height
  for (let r = 0; r < rows; r++) {
    points.push({ x: -1, y: r });
  }
  return points;
}

/** Factory: create a rectangular structural hull definition. */
function createRectHullDef(type: EntityType, cols: number, rows: number): EntityTypeDefinition {
  const cells = cols * rows;
  return {
    type,
    width: GRID_SIZE * cols,
    height: GRID_SIZE * rows,
    gridCols: cols > 1 || rows > 1 ? cols : undefined,
    gridRows: cols > 1 || rows > 1 ? rows : undefined,
    mass: RECT_HULL_MASS_PER_CELL * cells,
    defaultHealth: RECT_HULL_HEALTH_PER_CELL * cells,
    color: STRUCTURAL_COLOR,
    shape: 'rect',
    canAttachTo: [], // populated after ENTITY_DEFINITIONS is built
    attachmentPoints: generateRectAttachmentPoints(cols, rows),
  };
}

/** Factory: create a triangular structural hull definition. */
function createTriHullDef(type: EntityType, cols: number, rows: number): EntityTypeDefinition {
  const cells = cols * rows;
  return {
    type,
    width: GRID_SIZE * cols,
    height: GRID_SIZE * rows,
    gridCols: cols > 1 || rows > 1 ? cols : undefined,
    gridRows: cols > 1 || rows > 1 ? rows : undefined,
    mass: TRI_HULL_MASS_PER_CELL * cells,
    defaultHealth: TRI_HULL_HEALTH_PER_CELL * cells,
    color: STRUCTURAL_COLOR,
    shape: 'triangle',
    blockedSidesBase: ['east', 'south'] as const,
    canAttachTo: [], // populated after ENTITY_DEFINITIONS is built
    attachmentPoints: generateTriAttachmentPoints(cols, rows),
  };
}

export const ENTITY_DEFINITIONS: Record<EntityType, EntityTypeDefinition> = {
  Cockpit: {
    type: 'Cockpit',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 500,
    defaultHealth: 1000,
    color: '#00ff00',
    shape: 'rect',
    thrust: 0.5, // Emergency RCS only — engines are the primary propulsion source
    canAttachTo: ['Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam'],
    attachmentPoints: [
      { x: 0, y: -1 }, // top
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // bottom
      { x: -1, y: 0 }  // left
    ]
  },
  Engine: {
    type: 'Engine',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 750,
    defaultHealth: 80,
    color: '#ff6600',
    shape: 'rect',
    thrust: 2.0, // Primary propulsion block; ~4× better efficiency per mass than Cockpit
    canAttachTo: ['Cockpit', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam'],
    attachmentPoints: [
      { x: 0, y: -1 }, // top (exhaust is bottom)
      { x: 1, y: 0 },  // right
      { x: -1, y: 0 }  // left
    ]
  },
  Gun: {
    type: 'Gun',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 400, // Significantly increased for realistic physics
    defaultHealth: 60,
    color: '#ff0000',
    shape: 'rect',
    canAttachTo: ['Cockpit', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam'],
    attachmentPoints: [
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // bottom
      { x: -1, y: 0 }  // left
    ]
  },
  Hull: createRectHullDef('Hull', 1, 1),
  PowerCell: {
    type: 'PowerCell',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 300, // Significantly increased for realistic physics
    defaultHealth: 40,
    color: '#ffff00',
    shape: 'rect',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam'],
    attachmentPoints: [
      { x: 0, y: -1 }, // top
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // bottom
      { x: -1, y: 0 }  // left
    ]
  },

  // Large sized blocks (2x2)
  LargeCockpit: {
    type: 'LargeCockpit',
    width: GRID_SIZE * 2,
    height: GRID_SIZE * 2,
    gridCols: 2,
    gridRows: 2,
    mass: 2000,
    defaultHealth: 2500,
    color: '#00aa00',
    shape: 'rect',
    thrust: 2.0, // Emergency RCS (same efficiency as Cockpit — 0.001 thrust/mass)
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam', 'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher'],
    attachmentPoints: [
      { x: 0, y: -2 }, // top center
      { x: 1, y: -1 }, // top right
      { x: 2, y: 0 },  // right center
      { x: 1, y: 1 },  // bottom right
      { x: 0, y: 2 },  // bottom center
      { x: -1, y: 1 }, // bottom left
      { x: -2, y: 0 }, // left center
      { x: -1, y: -1 } // top left
    ]
  },
  LargeEngine: {
    type: 'LargeEngine',
    width: GRID_SIZE * 2,
    height: GRID_SIZE * 2,
    gridCols: 2,
    gridRows: 2,
    mass: 3000,
    defaultHealth: 200,
    color: '#cc4400',
    shape: 'rect',
    thrust: 8.0, // Primary propulsion (0.00267 thrust/mass — consistent with Engine)
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam', 'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher'],
    attachmentPoints: [
      { x: 0, y: -2 }, // top center
      { x: 1, y: -1 }, // top right
      { x: 2, y: 0 },  // right center
      { x: -1, y: -1 }, // top left
      { x: -2, y: 0 }  // left center
      // No bottom connections - exhaust
    ]
  },
  LargeGun: {
    type: 'LargeGun',
    width: GRID_SIZE * 2,
    height: GRID_SIZE * 2,
    gridCols: 2,
    gridRows: 2,
    mass: 1600, // 4x mass for 4x size (2x2)
    defaultHealth: 150,
    color: '#cc0000',
    shape: 'rect',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam', 'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher'],
    attachmentPoints: [
      { x: 1, y: 1 },  // bottom right
      { x: 0, y: 2 },  // bottom center
      { x: -1, y: 1 }, // bottom left
      { x: -2, y: 0 }, // left center
      { x: 2, y: 0 }   // right center
      // No top connections - weapon fires forward
    ]
  },
  HeavyHull: {
    type: 'HeavyHull',
    width: GRID_SIZE * 2,
    height: GRID_SIZE * 2,
    gridCols: 2,
    gridRows: 2,
    mass: 2400, // 4x mass for 4x size (2x2)
    defaultHealth: 300,
    color: '#666666',
    shape: 'rect',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam', 'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher'],
    attachmentPoints: [
      { x: 0, y: -2 }, // top center
      { x: 1, y: -1 }, // top right
      { x: 2, y: 0 },  // right center
      { x: 1, y: 1 },  // bottom right
      { x: 0, y: 2 },  // bottom center
      { x: -1, y: 1 }, // bottom left
      { x: -2, y: 0 }, // left center
      { x: -1, y: -1 } // top left
    ]
  },
  LargePowerCell: {
    type: 'LargePowerCell',
    width: GRID_SIZE * 2,
    height: GRID_SIZE * 2,
    gridCols: 2,
    gridRows: 2,
    mass: 1200, // 4x mass for 4x size (2x2)
    defaultHealth: 100,
    color: '#dddd00',
    shape: 'rect',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam', 'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher'],
    attachmentPoints: [
      { x: 0, y: -2 }, // top center
      { x: 1, y: -1 }, // top right
      { x: 2, y: 0 },  // right center
      { x: 1, y: 1 },  // bottom right
      { x: 0, y: 2 },  // bottom center
      { x: -1, y: 1 }, // bottom left
      { x: -2, y: 0 }, // left center
      { x: -1, y: -1 } // top left
    ]
  },

  // Capital ship sized blocks (4x4)
  CapitalCore: {
    type: 'CapitalCore',
    width: GRID_SIZE * 4,
    height: GRID_SIZE * 4,
    gridCols: 4,
    gridRows: 4,
    mass: 8000,
    defaultHealth: 10000,
    color: '#0066ff',
    shape: 'rect',
    thrust: 8.0, // Emergency RCS (0.001 thrust/mass — consistent with Cockpit tier)
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam', 'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher'],
    attachmentPoints: [
      { x: 0, y: -4 }, // top center
      { x: 2, y: -2 }, // top right
      { x: 4, y: 0 },  // right center
      { x: 2, y: 2 },  // bottom right
      { x: 0, y: 4 },  // bottom center
      { x: -2, y: 2 }, // bottom left
      { x: -4, y: 0 }, // left center
      { x: -2, y: -2 } // top left
    ]
  },
  CapitalEngine: {
    type: 'CapitalEngine',
    width: GRID_SIZE * 4,
    height: GRID_SIZE * 4,
    gridCols: 4,
    gridRows: 4,
    mass: 12000,
    defaultHealth: 800,
    color: '#ff3300',
    shape: 'rect',
    thrust: 32.0, // Primary propulsion (0.00267 thrust/mass — consistent with Engine tier)
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam', 'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher'],
    attachmentPoints: [
      { x: 0, y: -4 }, // top center
      { x: 2, y: -2 }, // top right
      { x: 4, y: 0 },  // right center
      { x: -2, y: -2 }, // top left
      { x: -4, y: 0 }  // left center
      // No bottom connections - massive exhaust
    ]
  },
  CapitalWeapon: {
    type: 'CapitalWeapon',
    width: GRID_SIZE * 4,
    height: GRID_SIZE * 4,
    gridCols: 4,
    gridRows: 4,
    mass: 6400, // 16x mass for 16x size (4x4)
    defaultHealth: 600,
    color: '#aa0000',
    shape: 'rect',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam', 'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher'],
    attachmentPoints: [
      { x: 2, y: 2 },  // bottom right
      { x: 0, y: 4 },  // bottom center
      { x: -2, y: 2 }, // bottom left
      { x: -4, y: 0 }, // left center
      { x: 4, y: 0 }   // right center
      // No top connections - weapon fires forward
    ]
  },
  MegaHull: {
    type: 'MegaHull',
    width: GRID_SIZE * 4,
    height: GRID_SIZE * 4,
    gridCols: 4,
    gridRows: 4,
    mass: 9600, // 16x mass for 16x size (4x4)
    defaultHealth: 1200,
    color: '#444444',
    shape: 'rect',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield'],
    attachmentPoints: [
      { x: 0, y: -4 }, // top center
      { x: 2, y: -2 }, // top right
      { x: 4, y: 0 },  // right center
      { x: 2, y: 2 },  // bottom right
      { x: 0, y: 4 },  // bottom center
      { x: -2, y: 2 }, // bottom left
      { x: -4, y: 0 }, // left center
      { x: -2, y: -2 } // top left
    ]
  },
  PowerReactor: {
    type: 'PowerReactor',
    width: GRID_SIZE * 4,
    height: GRID_SIZE * 4,
    gridCols: 4,
    gridRows: 4,
    mass: 4800, // 16x mass for 16x size (4x4)
    defaultHealth: 400,
    color: '#ffaa00',
    shape: 'rect',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'Shield', 'LargeShield'],
    attachmentPoints: [
      { x: 0, y: -4 }, // top center
      { x: 2, y: -2 }, // top right
      { x: 4, y: 0 },  // right center
      { x: 2, y: 2 },  // bottom right
      { x: 0, y: 4 },  // bottom center
      { x: -2, y: 2 }, // bottom left
      { x: -4, y: 0 }, // left center
      { x: -2, y: -2 } // top left
    ]
  },

  // Missile Launchers
  MissileLauncher: {
    type: 'MissileLauncher',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 450, // Similar to guns but slightly heavier
    defaultHealth: 70,
    color: '#ff9900', // Orange color for missiles
    shape: 'rect',
    canAttachTo: ['Cockpit', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam'],
    attachmentPoints: [
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // bottom
      { x: -1, y: 0 }  // left
    ]
  },
  LargeMissileLauncher: {
    type: 'LargeMissileLauncher',
    width: GRID_SIZE * 2,
    height: GRID_SIZE * 2,
    gridCols: 2,
    gridRows: 2,
    mass: 1800, // 4x mass for 4x size
    defaultHealth: 180,
    color: '#ff7700', // Darker orange for large launchers
    shape: 'rect',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam', 'MissileLauncher', 'CapitalMissileLauncher'],
    attachmentPoints: [
      { x: 1, y: 1 },  // bottom right
      { x: 0, y: 2 },  // bottom center
      { x: -1, y: 1 }, // bottom left
      { x: -2, y: 0 }, // left center
      { x: 2, y: 0 }   // right center
    ]
  },
  CapitalMissileLauncher: {
    type: 'CapitalMissileLauncher',
    width: GRID_SIZE * 4,
    height: GRID_SIZE * 4,
    gridCols: 4,
    gridRows: 4,
    mass: 7200, // 16x mass for 16x size
    defaultHealth: 720,
    color: '#ff5500', // Even darker orange for capital launchers
    shape: 'rect',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam', 'LargeBeam', 'MissileLauncher', 'LargeMissileLauncher'],
    attachmentPoints: [
      { x: 2, y: 2 },  // bottom right
      { x: 0, y: 4 },  // bottom center
      { x: -2, y: 2 }, // bottom left
      { x: -4, y: 0 }, // left center
      { x: 4, y: 0 }   // right center
    ]
  },

  // Shield blocks — generate an energy field that absorbs damage.
  // The field HP is stored separately on the Assembly (shieldState) and regenerates
  // Halo-style: rapid regen after a delay, long lockout after full collapse.
  Shield: {
    type: 'Shield',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 600,
    defaultHealth: 200,
    color: '#4488ff',
    shape: 'rect',
    shieldHp: 300,
    shieldRadius: 80, // Fixed bubble radius (5 grid cells) — does NOT scale with assembly size
    canAttachTo: [
      'Cockpit', 'Engine', 'Gun', 'PowerCell',
      'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell',
      'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor',
      'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher',
      'Beam', 'LargeShield'
    ],
    attachmentPoints: [
      { x: 0, y: -1 }, // top
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // bottom
      { x: -1, y: 0 }  // left
    ]
  },
  LargeShield: {
    type: 'LargeShield',
    width: GRID_SIZE * 2,
    height: GRID_SIZE * 2,
    gridCols: 2,
    gridRows: 2,
    mass: 2400,
    defaultHealth: 400,
    color: '#2255cc',
    shape: 'rect',
    shieldHp: 700,
    shieldRadius: 130, // Fixed bubble radius (8 grid cells) — does NOT scale with assembly size
    canAttachTo: [
      'Cockpit', 'Engine', 'Gun', 'PowerCell',
      'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell',
      'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor',
      'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher',
      'Beam', 'LargeBeam', 'Shield'
    ],
    attachmentPoints: [
      { x: 0, y: -2 }, // top center
      { x: 1, y: -1 }, // top right
      { x: 2, y: 0 },  // right center
      { x: 1, y: 1 },  // bottom right
      { x: 0, y: 2 },  // bottom center
      { x: -1, y: 1 }, // bottom left
      { x: -2, y: 0 }, // left center
      { x: -1, y: -1 } // top left
    ]
  },

  // Beam weapons — fire a continuous instant-hit raycast beam rather than projectiles.
  // Damage is applied as DPS × deltaTime each tick; the beam visual fades after BEAM_DISPLAY_DURATION_MS.
  Beam: {
    type: 'Beam',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 400,
    defaultHealth: 60,
    color: '#00ccff',
    shape: 'rect',
    beamRange: BEAM_SMALL_RANGE,
    beamDps: BEAM_SMALL_DPS,
    canAttachTo: ['Cockpit', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'LargeBeam'],
    attachmentPoints: [
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // bottom
      { x: -1, y: 0 }  // left
      // No forward attachment — fires forward
    ]
  },
  LargeBeam: {
    type: 'LargeBeam',
    width: GRID_SIZE * 2,
    height: GRID_SIZE * 2,
    gridCols: 2,
    gridRows: 2,
    mass: 1600,
    defaultHealth: 150,
    color: '#0066cc',
    shape: 'rect',
    beamRange: BEAM_LARGE_RANGE,
    beamDps: BEAM_LARGE_DPS,
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield', 'Beam'],
    attachmentPoints: [
      { x: 1, y: 1 },  // bottom right
      { x: 0, y: 2 },  // bottom center
      { x: -1, y: 1 }, // bottom left
      { x: -2, y: 0 }, // left center
      { x: 2, y: 0 }   // right center
      // No top connections — fires forward
    ]
  },

  // Structural hull blocks — generated by factory functions.
  // Rectangular hulls connect on all 4 sides; triangle hulls only on straight sides.
  // To add a new size: add type to EntityType union + STRUCTURAL_TYPES, then one line here.
  RectHull:    createRectHullDef('RectHull', 2, 1),
  Hull1x3:     createRectHullDef('Hull1x3', 3, 1),
  Hull1x4:     createRectHullDef('Hull1x4', 4, 1),
  Hull2x2:     createRectHullDef('Hull2x2', 2, 2),
  Hull5x1:     createRectHullDef('Hull5x1', 5, 1),
  Hull3x2:     createRectHullDef('Hull3x2', 3, 2),
  Hull4x2:     createRectHullDef('Hull4x2', 4, 2),
  Hull5x2:     createRectHullDef('Hull5x2', 5, 2),
  Hull3x3:     createRectHullDef('Hull3x3', 3, 3),
  Hull4x3:     createRectHullDef('Hull4x3', 4, 3),
  Hull5x3:     createRectHullDef('Hull5x3', 5, 3),
  Hull4x4:     createRectHullDef('Hull4x4', 4, 4),
  Hull5x4:     createRectHullDef('Hull5x4', 5, 4),
  Hull5x5:     createRectHullDef('Hull5x5', 5, 5),
  TriHull:     createTriHullDef('TriHull', 1, 1),
  TriHull2x1:  createTriHullDef('TriHull2x1', 2, 1),
  TriHull3x1:  createTriHullDef('TriHull3x1', 3, 1),
  TriHull2x2:  createTriHullDef('TriHull2x2', 2, 2),
  TriHull4x1:  createTriHullDef('TriHull4x1', 4, 1),
  TriHull5x1:  createTriHullDef('TriHull5x1', 5, 1),
  TriHull3x2:  createTriHullDef('TriHull3x2', 3, 2),
  TriHull4x2:  createTriHullDef('TriHull4x2', 4, 2),
  TriHull5x2:  createTriHullDef('TriHull5x2', 5, 2),
  TriHull3x3:  createTriHullDef('TriHull3x3', 3, 3),
  TriHull4x3:  createTriHullDef('TriHull4x3', 4, 3),
  TriHull5x3:  createTriHullDef('TriHull5x3', 5, 3),
  TriHull4x4:  createTriHullDef('TriHull4x4', 4, 4),
  TriHull5x4:  createTriHullDef('TriHull5x4', 5, 4),
  TriHull5x5:  createTriHullDef('TriHull5x5', 5, 5),
};

/**
 * Check if two entity types can connect to each other.
 * Structural blocks can attach to anything; functional blocks use their canAttachTo lists.
 * This replaces direct `def.canAttachTo.includes()` checks throughout the codebase.
 */
export function canTypesConnect(_typeA: EntityType, _typeB: EntityType): boolean {
  // All block types can connect to all other block types.
  // Connection restrictions are enforced solely by attachment points
  // (blocked sides like weapon fronts, thruster exhausts, triangle hypotenuses).
  return true;
}

// ---------------------------------------------------------------------------
// Populate canAttachTo for structural blocks.
// Structural blocks can connect to every other block type in the game.
// This is done after ENTITY_DEFINITIONS is built so we can enumerate all types.
// ---------------------------------------------------------------------------
{
  const allTypes = Object.keys(ENTITY_DEFINITIONS) as EntityType[];
  for (const sType of STRUCTURAL_TYPES) {
    ENTITY_DEFINITIONS[sType].canAttachTo = [...allTypes];
  }
}

// ---------------------------------------------------------------------------
// Multi-cell block helpers
//
// Convention for rectangular blocks (gridCols > 1 or gridRows > 1):
//   • `localOffset` = anchor = top-left cell of the block's footprint in the
//     CURRENT orientation, always at an integer multiple of GRID_SIZE.
//   • `bodyOffset`  = pixel offset from anchor to the physics-body centre.
//     For a 1×2 block at rotation 0: bodyOffset = {x: 8, y: 0}.
//   • At rotations 90/270 the effective cols/rows are swapped.
// ---------------------------------------------------------------------------

/**
 * Returns the pixel offset from `localOffset` (anchor) to the centre of the
 * physics body for the given block type and rotation.
 * For 1×1 rect blocks this is always {0, 0}.
 * For TriHull variants the centroid sits at a rotation-dependent offset from localOffset:
 *   bodyOffset = { W/3 − GRID_SIZE/2, H/3 − GRID_SIZE/2 } at rot 0, etc.
 * This places the bounding-box edges exactly on grid-cell borders for flush snapping.
 */
export function getEntityBodyOffset(type: EntityType, rotation: number): Vector2 {
  const def = ENTITY_DEFINITIONS[type];
  if (def.shape === 'triangle') {
    const W = (def.gridCols ?? 1) * GRID_SIZE;
    const H = (def.gridRows ?? 1) * GRID_SIZE;
    // Each 90° CW step rotates the RA corner: NW→NE→SE→SW.
    // bodyOffset derived from: bbox-min must land at localOffset − GRID_SIZE/2.
    switch (rotation) {
      case 0:   return { x: W/3   - GRID_SIZE/2, y: H/3   - GRID_SIZE/2 };
      case 90:  return { x: 2*H/3 - GRID_SIZE/2, y: W/3   - GRID_SIZE/2 };
      case 180: return { x: 2*W/3 - GRID_SIZE/2, y: 2*H/3 - GRID_SIZE/2 };
      case 270: return { x: H/3   - GRID_SIZE/2, y: 2*W/3 - GRID_SIZE/2 };
      default:  return { x: W/3   - GRID_SIZE/2, y: H/3   - GRID_SIZE/2 };
    }
  }

  const gridCols = def.gridCols ?? 1;
  const gridRows = def.gridRows ?? 1;
  const swap = rotation === 90 || rotation === 270;
  const effectiveCols = swap ? gridRows : gridCols;
  const effectiveRows = swap ? gridCols : gridRows;
  return {
    x: (effectiveCols - 1) * GRID_SIZE / 2,
    y: (effectiveRows - 1) * GRID_SIZE / 2,
  };
}

/**
 * Returns vertices (centred at centroid = {0,0}) for any triangle-hull type at the
 * given rotation.  Each 90° CW step applies (x,y)→(−y,x) (CW in screen coords).
 *
 * W = gridCols × GRID_SIZE, H = gridRows × GRID_SIZE (pre-rotation dimensions).
 *
 *   rot   0: [{-W/3,-H/3}, { 2W/3,-H/3}, {-W/3, 2H/3}]  RA NW
 *   rot  90: [{ H/3,-W/3}, { H/3, 2W/3}, {-2H/3,-W/3}]  RA NE
 *   rot 180: [{ W/3, H/3}, {-2W/3, H/3}, { W/3,-2H/3}]  RA SE
 *   rot 270: [{-H/3, W/3}, {-H/3,-2W/3}, { 2H/3, W/3}]  RA SW
 */
export function getTriHullVertices(type: EntityType, rotation: number): Vector2[] {
  const def = ENTITY_DEFINITIONS[type];
  const W = (def.gridCols ?? 1) * GRID_SIZE;
  const H = (def.gridRows ?? 1) * GRID_SIZE;
  switch (rotation) {
    case 0:   return [{ x: -W/3,   y: -H/3   }, { x:  2*W/3, y: -H/3   }, { x: -W/3,   y:  2*H/3 }];
    case 90:  return [{ x:  H/3,   y: -W/3   }, { x:  H/3,   y:  2*W/3 }, { x: -2*H/3, y: -W/3   }];
    case 180: return [{ x:  W/3,   y:  H/3   }, { x: -2*W/3, y:  H/3   }, { x:  W/3,   y: -2*H/3 }];
    case 270: return [{ x: -H/3,   y:  W/3   }, { x: -H/3,   y: -2*W/3 }, { x:  2*H/3, y:  W/3   }];
    default:  return [{ x: -W/3,   y: -H/3   }, { x:  2*W/3, y: -H/3   }, { x: -W/3,   y:  2*H/3 }];
  }
}

/**
 * Returns the grid directions (unit vectors) from which this entity CANNOT accept
 * connections, based on its type and current rotation.  For most block types this
 * returns an empty array (all four sides are connectable).
 *
 * For TriHull the hypotenuse side has no physical face, so two directions are
 * blocked.  The blocked directions rotate with the entity: each 90 ° CW step of
 * the block corresponds to a 90 ° CCW rotation of the blocked direction vectors
 * (direction (x,y) → (−y, x) per CCW step).
 */
export function getBlockedConnectionDirs(type: EntityType, rotation: number): Vector2[] {
  const def = ENTITY_DEFINITIONS[type];
  if (!def.blockedSidesBase || def.blockedSidesBase.length === 0) return [];

  const sideToDir: Record<string, Vector2> = {
    north: { x:  0, y: -1 },
    east:  { x:  1, y:  0 },
    south: { x:  0, y:  1 },
    west:  { x: -1, y:  0 },
  };

  const steps = (Math.round(rotation / 90) % 4 + 4) % 4;
  let blocked: Vector2[] = def.blockedSidesBase.map(side => ({ ...sideToDir[side] }));
  for (let i = 0; i < steps; i++) {
    blocked = blocked.map(({ x, y }) => ({ x: -y, y: x }));
  }
  return blocked;
}

/**
 * Returns all grid cells (as {x, y} in grid units, NOT pixel units) occupied
 * by an entity given its anchor localOffset, type, and current rotation.
 * For 1×1 blocks returns a single cell — identical to the existing single-cell
 * grid-map logic.
 */
export function getEntityOccupiedGridCells(
  localOffset: Vector2,
  type: EntityType,
  rotation: number,
): Vector2[] {
  const def = ENTITY_DEFINITIONS[type];
  const gridCols = def.gridCols ?? 1;
  const gridRows = def.gridRows ?? 1;
  const swap = rotation === 90 || rotation === 270;
  const effectiveCols = swap ? gridRows : gridCols;
  const effectiveRows = swap ? gridCols : gridRows;

  const anchorGx = Math.round(localOffset.x / GRID_SIZE);
  const anchorGy = Math.round(localOffset.y / GRID_SIZE);

  const cells: Vector2[] = [];
  for (let col = 0; col < effectiveCols; col++) {
    for (let row = 0; row < effectiveRows; row++) {
      cells.push({ x: anchorGx + col, y: anchorGy + row });
    }
  }
  return cells;
}

export type ScenarioId = 'debug' | 'duel' | 'small-battle' | 'medium-battle' | 'huge' | 'sandbox' | 'open-world' | 'ship-builder';

export interface ScenarioConfig {
  id: ScenarioId;
  label: string;
  description: string;
  teamSize: number;
  spawnX: number;         // blue at -spawnX, red at +spawnX
  shipIndex: number;      // index into ships.json — used for ALL spawns
  lineFormation: boolean; // true = vertical line; false = circular spread
  spawnDebris: boolean;
  debrisCount: number;
  sandboxMode: boolean;   // true = start as bare cockpit, scavenge blocks to build
  spawnAsteroids: boolean; // true = stream procedural asteroid chunks around camera
  shipBuilderMode: boolean; // true = static cockpit at origin, palette-driven block placement
}

export const SHIP_SPAWN_SPACING = 300;
export const DUEL_SPAWN_X = 1200;
export const BATTLE_SPAWN_X = 2000;

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioConfig>> = {
  'ship-builder':  { id: 'ship-builder',   label: 'Ship Builder',  description: 'Design your ship from scratch using a block palette.', teamSize: 0, spawnX: 0, shipIndex: 0, lineFormation: false, spawnDebris: false, debrisCount: 0, sandboxMode: false, spawnAsteroids: false, shipBuilderMode: true  },
  debug:           { id: 'debug',          label: 'Debug',         description: '1v1 sandbox with debris.',          teamSize: 1,   spawnX: DUEL_SPAWN_X,   shipIndex: 5, lineFormation: false, spawnDebris: true,  debrisCount: 12, sandboxMode: false, spawnAsteroids: false, shipBuilderMode: false },
  duel:            { id: 'duel',           label: 'Duel',          description: '1v1, clean space, ships face off.', teamSize: 1,   spawnX: DUEL_SPAWN_X,   shipIndex: 5, lineFormation: true,  spawnDebris: false, debrisCount: 0,  sandboxMode: false, spawnAsteroids: false, shipBuilderMode: false },
  'small-battle':  { id: 'small-battle',   label: 'Small Battle',  description: '5v5 — two squads engage.',          teamSize: 5,   spawnX: BATTLE_SPAWN_X, shipIndex: 0, lineFormation: true,  spawnDebris: false, debrisCount: 0,  sandboxMode: false, spawnAsteroids: false, shipBuilderMode: false },
  'medium-battle': { id: 'medium-battle',  label: 'Medium Battle', description: '10v10 — fleet engagement.',         teamSize: 10,  spawnX: BATTLE_SPAWN_X, shipIndex: 0, lineFormation: true,  spawnDebris: false, debrisCount: 0,  sandboxMode: false, spawnAsteroids: false, shipBuilderMode: false },
  huge:            { id: 'huge',           label: 'Huge',          description: '100v100 — maximum chaos.',          teamSize: 100, spawnX: BATTLE_SPAWN_X, shipIndex: 0, lineFormation: true,  spawnDebris: false, debrisCount: 0,  sandboxMode: false, spawnAsteroids: false, shipBuilderMode: false },
  sandbox:         { id: 'sandbox',        label: 'Sandbox',       description: 'Start as a bare cockpit. Scavenge blocks to build your ship.', teamSize: 0, spawnX: 0, shipIndex: 0, lineFormation: false, spawnDebris: false, debrisCount: 0, sandboxMode: true,  spawnAsteroids: false, shipBuilderMode: false },
  'open-world':    { id: 'open-world',     label: 'Open World',    description: 'Build your ship and explore a procedural asteroid field.',        teamSize: 0, spawnX: 0, shipIndex: 0, lineFormation: false, spawnDebris: false, debrisCount: 0, sandboxMode: true,  spawnAsteroids: true,  shipBuilderMode: false },
} as const;

export const SCENARIO_ORDER: ScenarioId[] = ['ship-builder', 'sandbox', 'open-world', 'debug', 'duel', 'small-battle', 'medium-battle', 'huge'];
