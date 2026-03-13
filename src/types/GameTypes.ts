export type EntityType = 'Cockpit' | 'Engine' | 'Gun' | 'Hull' | 'PowerCell' |
  'LargeCockpit' | 'LargeEngine' | 'LargeGun' | 'HeavyHull' | 'LargePowerCell' |
  'CapitalCore' | 'CapitalEngine' | 'CapitalWeapon' | 'MegaHull' | 'PowerReactor' |
  'MissileLauncher' | 'LargeMissileLauncher' | 'CapitalMissileLauncher' |
  'Shield' | 'LargeShield' |
  'Beam' | 'LargeBeam' |
  'RectHull' | 'Hull1x3' | 'Hull1x4' | 'Hull2x2' |
  'TriHull' | 'TriHull2x1' | 'TriHull3x1' | 'TriHull2x2';

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
  thrust?: number;    // Optional thrust value for engine parts
  shieldHp?: number;  // Max shield field HP for shield-type blocks
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

// Connection information for tracking what's attached to each attachment point
export interface AttachmentConnection {
  connectedEntity: string | null; // Entity ID that's connected to this point
  attachmentPointIndex: number; // Which attachment point index this connects to
}

export const GRID_SIZE = 16;

export const ENTITY_DEFINITIONS: Record<EntityType, EntityTypeDefinition> = {
  Cockpit: {
    type: 'Cockpit',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 500,
    defaultHealth: 1000,
    color: '#00ff00',
    thrust: 0.5, // Emergency RCS only — engines are the primary propulsion source
    canAttachTo: ['Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'Shield', 'LargeShield', 'Beam'],
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
    thrust: 2.0, // Primary propulsion block; ~4× better efficiency per mass than Cockpit
    canAttachTo: ['Cockpit', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'Shield', 'LargeShield'],
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
    canAttachTo: ['Cockpit', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'Shield', 'LargeShield', 'Beam'],
    attachmentPoints: [
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // bottom
      { x: -1, y: 0 }  // left
    ]
  },
  Hull: {
    type: 'Hull',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 600, // Significantly increased for realistic physics
    defaultHealth: 120,
    color: '#888888',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'Shield', 'LargeShield', 'Beam'],
    attachmentPoints: [
      { x: 0, y: -1 }, // top
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // bottom
      { x: -1, y: 0 }  // left
    ]
  },
  PowerCell: {
    type: 'PowerCell',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 300, // Significantly increased for realistic physics
    defaultHealth: 40,
    color: '#ffff00',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'Shield', 'LargeShield', 'Beam'],
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
    mass: 2000,
    defaultHealth: 2500,
    color: '#00aa00',
    thrust: 2.0, // Emergency RCS (same efficiency as Cockpit — 0.001 thrust/mass)
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'Shield', 'LargeShield', 'Beam', 'LargeBeam'],
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
    mass: 3000,
    defaultHealth: 200,
    color: '#cc4400',
    thrust: 8.0, // Primary propulsion (0.00267 thrust/mass — consistent with Engine)
    canAttachTo: ['Cockpit', 'Hull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'Shield', 'LargeShield'],
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
    mass: 1600, // 4x mass for 4x size (2x2)
    defaultHealth: 150,
    color: '#cc0000',
    canAttachTo: ['Cockpit', 'Hull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'Shield', 'LargeShield', 'LargeBeam'],
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
    mass: 2400, // 4x mass for 4x size (2x2)
    defaultHealth: 300,
    color: '#666666',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'Shield', 'LargeShield', 'Beam', 'LargeBeam'],
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
    mass: 1200, // 4x mass for 4x size (2x2)
    defaultHealth: 100,
    color: '#dddd00',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'Shield', 'LargeShield', 'Beam', 'LargeBeam'],
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
    mass: 8000,
    defaultHealth: 10000,
    color: '#0066ff',
    thrust: 8.0, // Emergency RCS (0.001 thrust/mass — consistent with Cockpit tier)
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield'],
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
    mass: 12000,
    defaultHealth: 800,
    color: '#ff3300',
    thrust: 32.0, // Primary propulsion (0.00267 thrust/mass — consistent with Engine tier)
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield'],
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
    mass: 6400, // 16x mass for 16x size (4x4)
    defaultHealth: 600,
    color: '#aa0000',
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield'],
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
    mass: 9600, // 16x mass for 16x size (4x4)
    defaultHealth: 1200,
    color: '#444444',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield'],
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
    mass: 4800, // 16x mass for 16x size (4x4)
    defaultHealth: 400,
    color: '#ffaa00',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'Shield', 'LargeShield'],
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
    canAttachTo: ['Cockpit', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'Shield', 'LargeShield'],
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
    mass: 1800, // 4x mass for 4x size
    defaultHealth: 180,
    color: '#ff7700', // Darker orange for large launchers
    canAttachTo: ['Cockpit', 'Hull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'Shield', 'LargeShield'],
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
    mass: 7200, // 16x mass for 16x size
    defaultHealth: 720,
    color: '#ff5500', // Even darker orange for capital launchers
    canAttachTo: ['Cockpit', 'Hull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield'],
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
    shieldHp: 300,
    canAttachTo: [
      'Cockpit', 'Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell',
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
    mass: 2400,
    defaultHealth: 400,
    color: '#2255cc',
    shieldHp: 700,
    canAttachTo: [
      'Cockpit', 'Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell',
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
    beamRange: BEAM_SMALL_RANGE,
    beamDps: BEAM_SMALL_DPS,
    canAttachTo: ['Cockpit', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'Shield', 'LargeShield'],
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
    mass: 1600,
    defaultHealth: 150,
    color: '#0066cc',
    beamRange: BEAM_LARGE_RANGE,
    beamDps: BEAM_LARGE_DPS,
    canAttachTo: ['Cockpit', 'Hull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'Shield', 'LargeShield'],
    attachmentPoints: [
      { x: 1, y: 1 },  // bottom right
      { x: 0, y: 2 },  // bottom center
      { x: -1, y: 1 }, // bottom left
      { x: -2, y: 0 }, // left center
      { x: 2, y: 0 }   // right center
      // No top connections — fires forward
    ]
  },

  // Rectangular hull — 1×2 grid cells (32×16 px).
  // Anchor (localOffset) is the LEFT cell at rotation 0.
  // Connection points: 1 on each end cap, 2 on each long side = 6 total.
  RectHull: {
    type: 'RectHull',
    width: GRID_SIZE * 2,  // 32 px
    height: GRID_SIZE,     // 16 px
    gridCols: 2,
    gridRows: 1,
    mass: 900,             // ~1.5× Hull — proportional to area
    defaultHealth: 200,    // ~1.7× Hull
    color: '#778899',      // Distinct slate-blue so it's recognisable in sandbox
    canAttachTo: [
      'Cockpit', 'Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell',
      'Shield', 'LargeShield', 'Beam', 'MissileLauncher',
    ],
    // Attachment points relative to anchor cell (top-left at rotation 0), in grid units
    attachmentPoints: [
      { x: -1, y: 0 },  // west end cap
      { x:  2, y: 0 },  // east end cap
      { x:  0, y: -1 }, // north long-side, left half
      { x:  1, y: -1 }, // north long-side, right half
      { x:  0, y:  1 }, // south long-side, left half
      { x:  1, y:  1 }, // south long-side, right half
    ]
  },

  // 1×3 rectangular hull — 3 grid cells wide, 1 tall (48×16 px).
  Hull1x3: {
    type: 'Hull1x3',
    width: GRID_SIZE * 3,
    height: GRID_SIZE,
    gridCols: 3,
    gridRows: 1,
    mass: 1350,
    defaultHealth: 280,
    color: '#778899',
    canAttachTo: [
      'Cockpit', 'Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell',
      'Shield', 'LargeShield', 'Beam', 'MissileLauncher',
    ],
    attachmentPoints: [
      { x: -1, y:  0 }, // west end cap
      { x:  3, y:  0 }, // east end cap
      { x:  0, y: -1 }, // north, col 0
      { x:  1, y: -1 }, // north, col 1
      { x:  2, y: -1 }, // north, col 2
      { x:  0, y:  1 }, // south, col 0
      { x:  1, y:  1 }, // south, col 1
      { x:  2, y:  1 }, // south, col 2
    ],
  },

  // 1×4 rectangular hull — 4 grid cells wide, 1 tall (64×16 px).
  Hull1x4: {
    type: 'Hull1x4',
    width: GRID_SIZE * 4,
    height: GRID_SIZE,
    gridCols: 4,
    gridRows: 1,
    mass: 1800,
    defaultHealth: 360,
    color: '#778899',
    canAttachTo: [
      'Cockpit', 'Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell',
      'Shield', 'LargeShield', 'Beam', 'MissileLauncher',
    ],
    attachmentPoints: [
      { x: -1, y:  0 }, // west end cap
      { x:  4, y:  0 }, // east end cap
      { x:  0, y: -1 }, // north, col 0
      { x:  1, y: -1 }, // north, col 1
      { x:  2, y: -1 }, // north, col 2
      { x:  3, y: -1 }, // north, col 3
      { x:  0, y:  1 }, // south, col 0
      { x:  1, y:  1 }, // south, col 1
      { x:  2, y:  1 }, // south, col 2
      { x:  3, y:  1 }, // south, col 3
    ],
  },

  // 2×2 square hull — 2 grid cells wide, 2 tall (32×32 px).
  // Uses gridCols/gridRows for the new-style multi-cell system.
  Hull2x2: {
    type: 'Hull2x2',
    width: GRID_SIZE * 2,
    height: GRID_SIZE * 2,
    gridCols: 2,
    gridRows: 2,
    mass: 2400,
    defaultHealth: 400,
    color: '#778899',
    canAttachTo: [
      'Cockpit', 'Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2', 'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell',
      'Shield', 'LargeShield', 'Beam', 'MissileLauncher',
      'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell',
      'LargeMissileLauncher', 'LargeBeam',
    ],
    attachmentPoints: [
      { x:  0, y: -1 }, // north, col 0
      { x:  1, y: -1 }, // north, col 1
      { x:  0, y:  2 }, // south, col 0
      { x:  1, y:  2 }, // south, col 1
      { x: -1, y:  0 }, // west, row 0
      { x: -1, y:  1 }, // west, row 1
      { x:  2, y:  0 }, // east, row 0
      { x:  2, y:  1 }, // east, row 1
    ],
  },

  // Right-angle triangle hull — occupies 1×1 grid cell; body is triangular.
  // At rotation 0 the right angle is at the top-left (NW corner).
  // The two straight sides (north + west at rot 0) accept connections;
  // the hypotenuse (east + south at rot 0) is blocked via blockedSidesBase.
  // Body center = centroid, placed at localOffset (bodyOffset = {0,0}).
  TriHull: {
    type: 'TriHull',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 300,
    defaultHealth: 60,
    color: '#778899',
    blockedSidesBase: ['east', 'south'],
    canAttachTo: [
      'Cockpit', 'Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2',
      'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell',
      'Shield', 'LargeShield', 'Beam', 'MissileLauncher',
    ],
    attachmentPoints: [
      { x:  0, y: -1 }, // north straight side
      { x: -1, y:  0 }, // west straight side
    ],
  },

  // Right-angle triangle hull — 2 cols × 1 row (32×16 px).
  // RA at NW; north leg 2 cells, west leg 1 cell; hyp faces SE → blocked east + south.
  TriHull2x1: {
    type: 'TriHull2x1',
    width: GRID_SIZE * 2,
    height: GRID_SIZE,
    gridCols: 2,
    gridRows: 1,
    mass: 600,
    defaultHealth: 120,
    color: '#778899',
    blockedSidesBase: ['east', 'south'],
    canAttachTo: [
      'Cockpit', 'Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2',
      'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell',
      'Shield', 'LargeShield', 'Beam', 'MissileLauncher',
    ],
    attachmentPoints: [
      { x:  0, y: -1 }, // north, col 0
      { x:  1, y: -1 }, // north, col 1
      { x: -1, y:  0 }, // west
    ],
  },

  // Right-angle triangle hull — 3 cols × 1 row (48×16 px).
  // RA at NW; north leg 3 cells, west leg 1 cell; hyp faces SE → blocked east + south.
  TriHull3x1: {
    type: 'TriHull3x1',
    width: GRID_SIZE * 3,
    height: GRID_SIZE,
    gridCols: 3,
    gridRows: 1,
    mass: 900,
    defaultHealth: 180,
    color: '#778899',
    blockedSidesBase: ['east', 'south'],
    canAttachTo: [
      'Cockpit', 'Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2',
      'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell',
      'Shield', 'LargeShield', 'Beam', 'MissileLauncher',
    ],
    attachmentPoints: [
      { x:  0, y: -1 }, // north, col 0
      { x:  1, y: -1 }, // north, col 1
      { x:  2, y: -1 }, // north, col 2
      { x: -1, y:  0 }, // west
    ],
  },

  // Right-angle triangle hull — 2 cols × 2 rows (32×32 px), isoceles right triangle.
  // RA at NW; north leg 2 cells, west leg 2 cells; hyp faces SE → blocked east + south.
  TriHull2x2: {
    type: 'TriHull2x2',
    width: GRID_SIZE * 2,
    height: GRID_SIZE * 2,
    gridCols: 2,
    gridRows: 2,
    mass: 1200,
    defaultHealth: 240,
    color: '#778899',
    blockedSidesBase: ['east', 'south'],
    canAttachTo: [
      'Cockpit', 'Engine', 'Gun', 'Hull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2',
      'TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2', 'PowerCell',
      'Shield', 'LargeShield', 'Beam', 'MissileLauncher',
      'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell',
      'LargeMissileLauncher', 'LargeBeam',
    ],
    attachmentPoints: [
      { x:  0, y: -1 }, // north, col 0
      { x:  1, y: -1 }, // north, col 1
      { x: -1, y:  0 }, // west, row 0
      { x: -1, y:  1 }, // west, row 1
    ],
  },
};

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
  if (type === 'TriHull' || type === 'TriHull2x1' || type === 'TriHull3x1' || type === 'TriHull2x2') {
    const def = ENTITY_DEFINITIONS[type];
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

  const def = ENTITY_DEFINITIONS[type];
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

export type ScenarioId = 'debug' | 'duel' | 'small-battle' | 'medium-battle' | 'huge' | 'sandbox' | 'open-world';

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
}

export const SHIP_SPAWN_SPACING = 300;
export const DUEL_SPAWN_X = 1200;
export const BATTLE_SPAWN_X = 2000;

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioConfig>> = {
  debug:           { id: 'debug',          label: 'Debug',         description: '1v1 sandbox with debris.',          teamSize: 1,   spawnX: DUEL_SPAWN_X,   shipIndex: 5, lineFormation: false, spawnDebris: true,  debrisCount: 12, sandboxMode: false, spawnAsteroids: false },
  duel:            { id: 'duel',           label: 'Duel',          description: '1v1, clean space, ships face off.', teamSize: 1,   spawnX: DUEL_SPAWN_X,   shipIndex: 5, lineFormation: true,  spawnDebris: false, debrisCount: 0,  sandboxMode: false, spawnAsteroids: false },
  'small-battle':  { id: 'small-battle',   label: 'Small Battle',  description: '5v5 — two squads engage.',          teamSize: 5,   spawnX: BATTLE_SPAWN_X, shipIndex: 0, lineFormation: true,  spawnDebris: false, debrisCount: 0,  sandboxMode: false, spawnAsteroids: false },
  'medium-battle': { id: 'medium-battle',  label: 'Medium Battle', description: '10v10 — fleet engagement.',         teamSize: 10,  spawnX: BATTLE_SPAWN_X, shipIndex: 0, lineFormation: true,  spawnDebris: false, debrisCount: 0,  sandboxMode: false, spawnAsteroids: false },
  huge:            { id: 'huge',           label: 'Huge',          description: '100v100 — maximum chaos.',          teamSize: 100, spawnX: BATTLE_SPAWN_X, shipIndex: 0, lineFormation: true,  spawnDebris: false, debrisCount: 0,  sandboxMode: false, spawnAsteroids: false },
  sandbox:         { id: 'sandbox',        label: 'Sandbox',       description: 'Start as a bare cockpit. Scavenge blocks to build your ship.', teamSize: 0, spawnX: 0, shipIndex: 0, lineFormation: false, spawnDebris: false, debrisCount: 0, sandboxMode: true,  spawnAsteroids: false },
  'open-world':    { id: 'open-world',     label: 'Open World',    description: 'Build your ship and explore a procedural asteroid field.',        teamSize: 0, spawnX: 0, shipIndex: 0, lineFormation: false, spawnDebris: false, debrisCount: 0, sandboxMode: true,  spawnAsteroids: true  },
} as const;

export const SCENARIO_ORDER: ScenarioId[] = ['sandbox', 'open-world', 'debug', 'duel', 'small-battle', 'medium-battle', 'huge'];
