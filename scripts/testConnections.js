/**
 * Simple test to understand the connection system
 */

import { ShipDesignManager } from '../src/game/ShipDesignManager.js';
import { ShipValidator } from '../src/game/BlockSystem.js';

// Test simple designs to understand connection rules
const testDesigns = [
  {
    name: "Simple Line",
    blocks: [
      { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 },
      { type: 'Hull', gridPosition: { x: 1, y: 0 }, rotation: 0 }
    ]
  },
  {
    name: "Three Part Line",
    blocks: [
      { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 },
      { type: 'Hull', gridPosition: { x: 1, y: 0 }, rotation: 0 },
      { type: 'Engine', gridPosition: { x: 2, y: 0 }, rotation: 0 }
    ]
  },
  {
    name: "T Shape",
    blocks: [
      { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 },
      { type: 'Hull', gridPosition: { x: 1, y: 0 }, rotation: 0 },
      { type: 'Hull', gridPosition: { x: 0, y: 1 }, rotation: 0 }
    ]
  }
];

// Test each design
testDesigns.forEach(design => {
  try {
    console.log(`\nTesting ${design.name}...`);
    const valid = ShipValidator.isValidDesign(design);
    console.log(`${valid ? '✅' : '❌'} ${design.name}: ${valid ? 'Valid' : 'Invalid'}`);
    
    if (valid) {
      const parts = ShipDesignManager.shipDesignToEntityConfigs(design);
      console.log(`  Parts: ${parts.length}`);
      parts.forEach((part, i) => {
        console.log(`    ${i+1}. ${part.type} at (${part.x}, ${part.y})`);
      });
    }
  } catch (error) {
    console.error(`❌ ${design.name}: ${error.message}`);
  }
});
