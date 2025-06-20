/**
 * Test script to validate just the B52 Bomber design
 */

import { ShipDesignManager } from '../src/game/ShipDesignManager.js';

// Create just the B52 Bomber design
const b52Design = {
  name: "B52 Bomber",
  blocks: [
    // Main fuselage spine - central backbone
    { type: 'Engine', gridPosition: { x: -5, y: 0 }, rotation: 180 }, // Main rear engine
    { type: 'PowerCell', gridPosition: { x: -4, y: 0 }, rotation: 0 },
    { type: 'PowerCell', gridPosition: { x: -3, y: 0 }, rotation: 0 },
    { type: 'PowerCell', gridPosition: { x: -2, y: 0 }, rotation: 0 },
    { type: 'Hull', gridPosition: { x: -1, y: 0 }, rotation: 0 },
    { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 }, // Command center
    { type: 'Hull', gridPosition: { x: 1, y: 0 }, rotation: 0 },
    { type: 'Hull', gridPosition: { x: 2, y: 0 }, rotation: 0 },
    { type: 'Gun', gridPosition: { x: 3, y: 0 }, rotation: 0 }, // Nose gun
    
    // Port (left) wing - extending upward from center
    { type: 'Hull', gridPosition: { x: -1, y: -1 }, rotation: 0 },
    { type: 'Hull', gridPosition: { x: -1, y: -2 }, rotation: 0 },
    { type: 'Gun', gridPosition: { x: 0, y: -1 }, rotation: 0 }, // Wing gun
    { type: 'Hull', gridPosition: { x: 0, y: -2 }, rotation: 0 },
    { type: 'Gun', gridPosition: { x: 0, y: -3 }, rotation: 0 }, // Wing tip gun
    { type: 'Hull', gridPosition: { x: 1, y: -1 }, rotation: 0 },
    { type: 'Hull', gridPosition: { x: 1, y: -2 }, rotation: 0 },
    { type: 'Gun', gridPosition: { x: 1, y: -3 }, rotation: 0 }, // Wing tip gun
    { type: 'Engine', gridPosition: { x: -1, y: -3 }, rotation: 0 }, // Reverse engine for turning
    
    // Starboard (right) wing - extending downward from center  
    { type: 'Hull', gridPosition: { x: -1, y: 1 }, rotation: 0 },
    { type: 'Hull', gridPosition: { x: -1, y: 2 }, rotation: 0 },
    { type: 'Gun', gridPosition: { x: 0, y: 1 }, rotation: 0 }, // Wing gun
    { type: 'Hull', gridPosition: { x: 0, y: 2 }, rotation: 0 },
    { type: 'Gun', gridPosition: { x: 0, y: 3 }, rotation: 0 }, // Wing tip gun
    { type: 'Hull', gridPosition: { x: 1, y: 1 }, rotation: 0 },
    { type: 'Hull', gridPosition: { x: 1, y: 2 }, rotation: 0 },
    { type: 'Gun', gridPosition: { x: 1, y: 3 }, rotation: 0 }, // Wing tip gun
    { type: 'Engine', gridPosition: { x: -1, y: 3 }, rotation: 0 }, // Reverse engine for turning
    
    // Wing-mounted main engines for forward thrust
    { type: 'Engine', gridPosition: { x: -2, y: -1 }, rotation: 180 }, // Port wing engine
    { type: 'Engine', gridPosition: { x: -2, y: 1 }, rotation: 180 }, // Starboard wing engine
    
    // Additional maneuvering engines
    { type: 'Hull', gridPosition: { x: 2, y: -1 }, rotation: 0 },
    { type: 'Engine', gridPosition: { x: 3, y: -1 }, rotation: 0 }, // Forward port maneuvering
    { type: 'Hull', gridPosition: { x: 2, y: 1 }, rotation: 0 },
    { type: 'Engine', gridPosition: { x: 3, y: 1 }, rotation: 0 } // Forward starboard maneuvering
  ]
};

// Test the B52 design
try {
  console.log('Testing B52 Bomber design...');
  const parts = ShipDesignManager.shipDesignToEntityConfigs(b52Design);
  console.log('✅ B52 Bomber design is valid!');
  console.log(`Parts: ${parts.length}`);
  console.log('Ship layout:');
  parts.forEach((part, i) => {
    console.log(`  ${i+1}. ${part.type} at (${part.x}, ${part.y})`);
  });
} catch (error) {
  console.error('❌ B52 Bomber design is invalid:');
  console.error(error.message);
}
