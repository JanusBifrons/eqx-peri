export type EntityType = 'Cockpit' | 'Engine' | 'Gun' | 'Hull' | 'PowerCell' |
  'LargeCockpit' | 'LargeEngine' | 'LargeGun' | 'HeavyHull' | 'LargePowerCell' |
  'CapitalCore' | 'CapitalEngine' | 'CapitalWeapon' | 'MegaHull' | 'PowerReactor';

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
  thrust?: number; // Optional thrust value for engine parts
  canAttachTo: EntityType[];
  attachmentPoints: Vector2[]; // relative to center, in grid units
}

export const GRID_SIZE = 16;

export const ENTITY_DEFINITIONS: Record<EntityType, EntityTypeDefinition> = {
  Cockpit: {
    type: 'Cockpit',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 50, // Increased from 10
    defaultHealth: 100,
    color: '#00ff00',
    canAttachTo: ['Engine', 'Gun', 'Hull', 'PowerCell'],
    attachmentPoints: [
      { x: 0, y: -1 }, // top
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // bottom
      { x: -1, y: 0 }  // left
    ]
  }, Engine: {
    type: 'Engine',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 75, // Increased from 15
    defaultHealth: 80,
    color: '#ff6600',
    thrust: 0.1, // Increased from 0.002 to 0.1 (50x stronger)
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell'],
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
    mass: 40, // Increased from 8
    defaultHealth: 60,
    color: '#ff0000',
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell'],
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
    mass: 60, // Increased from 12
    defaultHealth: 120,
    color: '#888888',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell'],
    attachmentPoints: [
      { x: 0, y: -1 }, // top
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // bottom
      { x: -1, y: 0 }  // left
    ]
  }, PowerCell: {
    type: 'PowerCell',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 30, // Increased from 6
    defaultHealth: 40,
    color: '#ffff00',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull'],
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
    mass: 125, // Increased from 25
    defaultHealth: 250,
    color: '#00aa00',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'],
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
  }, LargeEngine: {
    type: 'LargeEngine',
    width: GRID_SIZE * 2,
    height: GRID_SIZE * 2,
    mass: 200, // Increased from 40
    defaultHealth: 200,
    color: '#cc4400',
    thrust: 0.3, // Increased from 0.006 to 0.3 (50x stronger)
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell'],
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
    mass: 100, // Increased from 20
    defaultHealth: 150,
    color: '#cc0000',
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell'],
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
    mass: 150, // Increased from 30
    defaultHealth: 300,
    color: '#666666',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell'],
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
    mass: 75, // Increased from 15
    defaultHealth: 100,
    color: '#dddd00',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull'],
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
    mass: 500, // Increased from 100
    defaultHealth: 1000,
    color: '#0066ff',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor'],
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
  }, CapitalEngine: {
    type: 'CapitalEngine',
    width: GRID_SIZE * 4,
    height: GRID_SIZE * 4,
    mass: 750, // Increased from 150
    defaultHealth: 800,
    color: '#ff3300',
    thrust: 0.7, // Increased from 0.014 to 0.7 (50x stronger)
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'MegaHull', 'PowerReactor'],
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
    mass: 400, // Increased from 80
    defaultHealth: 600,
    color: '#aa0000',
    canAttachTo: ['Cockpit', 'Hull', 'PowerCell', 'LargeCockpit', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'MegaHull', 'PowerReactor'],
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
    mass: 600, // Increased from 120
    defaultHealth: 1200,
    color: '#444444',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'LargePowerCell', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull', 'PowerReactor'],
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
    mass: 300, // Increased from 60
    defaultHealth: 400,
    color: '#ffaa00',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'LargeCockpit', 'LargeEngine', 'LargeGun', 'HeavyHull', 'CapitalCore', 'CapitalEngine', 'CapitalWeapon', 'MegaHull'],
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
  }
};
