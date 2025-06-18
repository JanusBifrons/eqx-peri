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
        mass: 500, // Significantly increased for realistic physics
        defaultHealth: 1000, // 10x health for survival capability
        color: '#00ff00',
        thrust: 4.0, // Significantly increased thrust for high thrust-to-weight ratio
        canAttachTo: ['Engine', 'Gun', 'Hull', 'PowerCell'],
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
        mass: 400, // Significantly increased for realistic physics
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
        mass: 600, // Significantly increased for realistic physics
        defaultHealth: 120,
        color: '#888888',
        canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull', 'PowerCell'],
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
        mass: 2000, // 4x mass for 4x size (2x2)
        defaultHealth: 2500, // 10x health for survival capability
        color: '#00aa00',
        thrust: 16.0, // Very high thrust for excellent thrust-to-weight ratio
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
    LargeEngine: {
        type: 'LargeEngine',
        width: GRID_SIZE * 2,
        height: GRID_SIZE * 2,
        mass: 3000, // 4x mass for 4x size (2x2)
        defaultHealth: 200,
        color: '#cc4400',
        thrust: 6.0, // Proportional to mass (3000/500 * 1.0)
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
        mass: 1600, // 4x mass for 4x size (2x2)
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
        mass: 2400, // 4x mass for 4x size (2x2)
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
        mass: 1200, // 4x mass for 4x size (2x2)
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
        mass: 8000, // 16x mass for 16x size (4x4)
        defaultHealth: 10000, // 10x health for survival capability
        color: '#0066ff',
        thrust: 64.0, // Massive thrust for incredible thrust-to-weight ratio
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
    CapitalEngine: {
        type: 'CapitalEngine',
        width: GRID_SIZE * 4,
        height: GRID_SIZE * 4,
        mass: 12000, // 16x mass for 16x size (4x4)
        defaultHealth: 800,
        color: '#ff3300',
        thrust: 24.0, // Proportional to mass (12000/500 * 1.0)
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
        mass: 6400, // 16x mass for 16x size (4x4)
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
        mass: 9600, // 16x mass for 16x size (4x4)
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
        mass: 4800, // 16x mass for 16x size (4x4)
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
