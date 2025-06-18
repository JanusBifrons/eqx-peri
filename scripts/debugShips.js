import { ShipDesignManager } from '../src/game/ShipDesignManager';

// Test each ship design individually
const designs = ShipDesignManager.createStandardDesigns();

designs.forEach((design, index) => {
  console.log(`\n=== Testing ${design.name} ===`);
  console.log(`Blocks: ${design.blocks.length}`);
  
  design.blocks.forEach((block, i) => {
    console.log(`${i}: ${block.type} at (${block.gridPosition.x}, ${block.gridPosition.y}) rotation ${block.rotation}°`);
  });
  
  try {
    const result = ShipDesignManager.validateStandardDesigns()[index];
    console.log(`Result: ${result.valid ? '✅ Valid' : '❌ Invalid'}`);
    if (result.error) {
      console.log(`Error: ${result.error}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
});
