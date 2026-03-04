export type EntityType = 'Cockpit' | 'Engine' | 'Gun' | 'Hull' | 'PowerCell' |
  'LargeCockpit' | 'LargeEngine' | 'LargeGun' | 'HeavyHull' | 'LargePowerCell' |
  'CapitalCore' | 'CapitalEngine' | 'CapitalWeapon' | 'MegaHull' | 'PowerReactor' |
  'MissileLauncher' | 'LargeMissileLauncher' | 'CapitalMissileLauncher' |
  'Shield' | 'LargeShield' |
  'Beam' | 'LargeBeam';

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
  mass: number;
  defaultHealth: number;
  color: string;
  thrust?: number;    // Optional thrust value for engine parts
  shieldHp?: number;  // Max shield field HP for shield-type blocks
  beamRange?: number; // Max beam length in world units (beam weapons only)
  beamDps?: number;   // Damage per second (beam weapons only)
  canAttachTo: EntityType[];
  attachmentPoints: Vector2[]; // relative to center, in grid units
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
    mass: 500, // Significantly increased for realistic physics
    defaultHealth: 1000, // 10x health for survival capability
    color: '#00ff00',
    thrust: 4.0, // Significantly increased thrust for high thrust-to-weight ratio
    canAttachTo: ['Engine', 'Gun', 'Hull', 'PowerCell', 'Shield', 'LargeShield', 'Beam'],
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
    mass: 750, // Significantly increased for realistic physics
    defaultHealth: 80,
    color: '#ff6600',
    thrust: 1.5, // Increased proportionally with mass (750/500 * 1.0)
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'Shield', 'LargeShield'],
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
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'Shield', 'LargeShield', 'Beam'],
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
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'Shield', 'LargeShield', 'Beam'],
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
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'Shield', 'LargeShield', 'Beam'],
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
    mass: 2000, // 4x mass for 4x size (2x2)
    defaultHealth: 2500, // 10x health for survival capability
    color: '#00aa00',
    thrust: 16.0, // Very high thrust for excellent thrust-to-weight ratio
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'Shield', 'LargeShield', 'Beam', 'LargeBeam'],
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
    mass: 3000, // 4x mass for 4x size (2x2)
    defaultHealth: 200,
    color: '#cc4400',
    thrust: 6.0, // Proportional to mass (3000/500 * 1.0)
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'Shield', 'LargeShield'],
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
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'Shield', 'LargeShield', 'LargeBeam'],
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
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'Shield', 'LargeShield', 'Beam', 'LargeBeam'],
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
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'Shield', 'LargeShield', 'Beam', 'LargeBeam'],
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
    mass: 8000, // 16x mass for 16x size (4x4)
    defaultHealth: 10000, // 10x health for survival capability
    color: '#0066ff',
    thrust: 64.0, // Massive thrust for incredible thrust-to-weight ratio
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield'],
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
    mass: 12000, // 16x mass for 16x size (4x4)
    defaultHealth: 800,
    color: '#ff3300',
    thrust: 24.0, // Proportional to mass (12000/500 * 1.0)
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
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield'],
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
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'Shield', 'LargeShield'],
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
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'Shield', 'LargeShield'],
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
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'Shield', 'LargeShield'],
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
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'MegaHull', 'PowerReactor', 'Shield', 'LargeShield'],
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
      'Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell',
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
      'Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell',
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
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'Shield', 'LargeShield'],
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
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'Shield', 'LargeShield'],
    attachmentPoints: [
      { x: 1, y: 1 },  // bottom right
      { x: 0, y: 2 },  // bottom center
      { x: -1, y: 1 }, // bottom left
      { x: -2, y: 0 }, // left center
      { x: 2, y: 0 }   // right center
      // No top connections — fires forward
    ]
  }
};

export type ScenarioId = 'debug' | 'duel' | 'small-battle' | 'medium-battle' | 'huge' | 'sandbox';

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
}

export const SHIP_SPAWN_SPACING = 300;
export const DUEL_SPAWN_X = 1200;
export const BATTLE_SPAWN_X = 2000;

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioConfig>> = {
  debug:           { id: 'debug',          label: 'Debug',         description: '1v1 sandbox with debris.',          teamSize: 1,   spawnX: DUEL_SPAWN_X,   shipIndex: 5, lineFormation: false, spawnDebris: true,  debrisCount: 12, sandboxMode: false },
  duel:            { id: 'duel',           label: 'Duel',          description: '1v1, clean space, ships face off.', teamSize: 1,   spawnX: DUEL_SPAWN_X,   shipIndex: 5, lineFormation: true,  spawnDebris: false, debrisCount: 0,  sandboxMode: false },
  'small-battle':  { id: 'small-battle',   label: 'Small Battle',  description: '5v5 — two squads engage.',          teamSize: 5,   spawnX: BATTLE_SPAWN_X, shipIndex: 0, lineFormation: true,  spawnDebris: false, debrisCount: 0,  sandboxMode: false },
  'medium-battle': { id: 'medium-battle',  label: 'Medium Battle', description: '10v10 — fleet engagement.',         teamSize: 10,  spawnX: BATTLE_SPAWN_X, shipIndex: 0, lineFormation: true,  spawnDebris: false, debrisCount: 0,  sandboxMode: false },
  huge:            { id: 'huge',           label: 'Huge',          description: '100v100 — maximum chaos.',          teamSize: 100, spawnX: BATTLE_SPAWN_X, shipIndex: 0, lineFormation: true,  spawnDebris: false, debrisCount: 0,  sandboxMode: false },
  sandbox:         { id: 'sandbox',        label: 'Sandbox',       description: 'Start as a bare cockpit. Scavenge blocks to build your ship.', teamSize: 0, spawnX: 0, shipIndex: 0, lineFormation: false, spawnDebris: false, debrisCount: 0, sandboxMode: true  },
} as const;

export const SCENARIO_ORDER: ScenarioId[] = ['sandbox', 'debug', 'duel', 'small-battle', 'medium-battle', 'huge'];
