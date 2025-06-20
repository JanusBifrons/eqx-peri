// Debug attachment points
import { ENTITY_DEFINITIONS, GRID_SIZE } from './src/types/GameTypes.ts';
import { CoordinateSystem } from './src/game/BlockSystem.ts';

console.log('=== DEBUGGING ATTACHMENT POINTS ===');
console.log(`GRID_SIZE: ${GRID_SIZE}`);

// Test Cockpit and Engine attachment points
const cockpit = ENTITY_DEFINITIONS.Cockpit;
const engine = ENTITY_DEFINITIONS.Engine;

console.log('\nCockpit attachment points:', cockpit.attachmentPoints);
console.log('Engine attachment points:', engine.attachmentPoints);

console.log('\nCockpit can attach to:', cockpit.canAttachTo);
console.log('Engine can attach to:', engine.canAttachTo);

// Test specific connection: Cockpit at (0,0), Engine at (-1,0)
const block1 = { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 };
const block2 = { type: 'Engine', gridPosition: { x: -1, y: 0 }, rotation: 180 };

console.log('\n=== TESTING CONNECTION ===');
console.log('Block1 (Cockpit):', block1);
console.log('Block2 (Engine):', block2);

// Convert to world coordinates
const pos1 = CoordinateSystem.gridToWorld(block1.gridPosition);
const pos2 = CoordinateSystem.gridToWorld(block2.gridPosition);

console.log('World pos1:', pos1);
console.log('World pos2:', pos2);

// Calculate attachment point positions
console.log('\n=== ATTACHMENT POINT POSITIONS ===');
for (const ap1 of cockpit.attachmentPoints) {
  const worldAP1 = {
    x: pos1.x + ap1.x * GRID_SIZE,
    y: pos1.y + ap1.y * GRID_SIZE
  };
  console.log(`Cockpit AP ${ap1.x},${ap1.y} -> World ${worldAP1.x},${worldAP1.y}`);
}

for (const ap2 of engine.attachmentPoints) {
  const worldAP2 = {
    x: pos2.x + ap2.x * GRID_SIZE,
    y: pos2.y + ap2.y * GRID_SIZE
  };
  console.log(`Engine AP ${ap2.x},${ap2.y} -> World ${worldAP2.x},${worldAP2.y}`);
}

// Check distances between all attachment point pairs
console.log('\n=== DISTANCE CHECKS ===');
for (const ap1 of cockpit.attachmentPoints) {
  const worldAP1 = {
    x: pos1.x + ap1.x * GRID_SIZE,
    y: pos1.y + ap1.y * GRID_SIZE
  };
  
  for (const ap2 of engine.attachmentPoints) {
    const worldAP2 = {
      x: pos2.x + ap2.x * GRID_SIZE,
      y: pos2.y + ap2.y * GRID_SIZE
    };
    
    const distance = Math.sqrt(
      Math.pow(worldAP1.x - worldAP2.x, 2) + 
      Math.pow(worldAP1.y - worldAP2.y, 2)
    );
    
    console.log(`Cockpit(${ap1.x},${ap1.y}) to Engine(${ap2.x},${ap2.y}): distance = ${distance}`);
  }
}
