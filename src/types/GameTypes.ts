export type EntityType = 'Cockpit' | 'Engine' | 'Gun' | 'Hull' | 'PowerCell';

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
  canAttachTo: EntityType[];
  attachmentPoints: Vector2[]; // relative to center, in grid units
}

export const GRID_SIZE = 32;

export const ENTITY_DEFINITIONS: Record<EntityType, EntityTypeDefinition> = {
  Cockpit: {
    type: 'Cockpit',
    width: GRID_SIZE,
    height: GRID_SIZE,
    mass: 10,
    defaultHealth: 100,
    color: '#00ff00',
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
    mass: 15,
    defaultHealth: 80,
    color: '#ff6600',
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
    mass: 8,
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
    mass: 12,
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
    mass: 6,
    defaultHealth: 40,
    color: '#ffff00',
    canAttachTo: ['Cockpit', 'Engine', 'Gun', 'Hull'],
    attachmentPoints: [
      { x: 0, y: -1 }, // top
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // bottom
      { x: -1, y: 0 }  // left
    ]
  }
};
