// Debug script to test ship connections
import { ShipDesignManager } from './dist/game/ShipDesignManager.js';
import { ShipValidator, CoordinateSystem } from './dist/game/BlockSystem.js';
import { ENTITY_DEFINITIONS, GRID_SIZE } from './dist/types/GameTypes.js';

console.log('🔧 Testing ship connection system...');

async function testConnections() {
  try {
    // Test individual connection logic
    console.log('\n=== TESTING CONNECTION LOGIC ===');
    
    const cockpit = { type: 'Cockpit', gridPosition: { x: 0, y: 0 }, rotation: 0 };
    const engine = { type: 'Engine', gridPosition: { x: -1, y: 0 }, rotation: 180 };
    
    console.log('Testing Cockpit at (0,0) to Engine at (-1,0)');
    
    // Check attachment points
    const cockpitDef = ENTITY_DEFINITIONS[cockpit.type];
    const engineDef = ENTITY_DEFINITIONS[engine.type];
    
    console.log(`Cockpit attachment points:`, cockpitDef.attachmentPoints);
    console.log(`Engine attachment points:`, engineDef.attachmentPoints);
    
    // Check world positions
    const cockpitWorld = CoordinateSystem.gridToWorld(cockpit.gridPosition);
    const engineWorld = CoordinateSystem.gridToWorld(engine.gridPosition);
    
    console.log(`Cockpit world pos:`, cockpitWorld);
    console.log(`Engine world pos:`, engineWorld);
    
    // Check specific attachment point positions
    console.log('\nAttachment point world positions:');
    cockpitDef.attachmentPoints.forEach((ap, i) => {
      const worldAP = {
        x: cockpitWorld.x + ap.x * GRID_SIZE,
        y: cockpitWorld.y + ap.y * GRID_SIZE
      };
      console.log(`  Cockpit AP ${i}: grid(${ap.x},${ap.y}) -> world(${worldAP.x},${worldAP.y})`);
    });
    
    engineDef.attachmentPoints.forEach((ap, i) => {
      const worldAP = {
        x: engineWorld.x + ap.x * GRID_SIZE,
        y: engineWorld.y + ap.y * GRID_SIZE
      };
      console.log(`  Engine AP ${i}: grid(${ap.x},${ap.y}) -> world(${worldAP.x},${worldAP.y})`);
    });
    
    // Test connection
    const canConnect = ShipValidator.canBlocksConnect(cockpit, engine);
    console.log(`\nConnection result: ${canConnect ? '✅ CAN CONNECT' : '❌ CANNOT CONNECT'}`);
    
    // Test simple design
    console.log('\n=== TESTING SIMPLE DESIGN ===');
    const simpleDesign = {
      name: "Simple Test",
      blocks: [cockpit, engine]
    };
    
    const isValid = ShipValidator.isValidDesign(simpleDesign);
    console.log(`Simple design valid: ${isValid ? '✅ VALID' : '❌ INVALID'}`);
    
    // Test all standard designs
    console.log('\n=== TESTING STANDARD DESIGNS ===');
    const results = ShipDesignManager.validateStandardDesigns();
    results.forEach(result => {
      console.log(`${result.design}: ${result.valid ? '✅ Valid' : '❌ Invalid'}`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testConnections();
