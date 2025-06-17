/**
 * Test the new BlockSystem
 */

import { ShipDesignManager } from './game/ShipDesignManager';

// Initialize and test the system
console.log('🧪 Testing BlockSystem...');

// Test ship design generation
const designs = ShipDesignManager.createStandardDesigns();
console.log(`\n📋 Created ${designs.length} ship designs:`);

designs.forEach(design => {
  console.log(`\n🚀 ${design.name}:`);
  design.blocks.forEach(block => {
    console.log(`  - ${block.type} at grid (${block.gridPosition.x}, ${block.gridPosition.y}) = world (${block.gridPosition.x * 16}, ${block.gridPosition.y * 16})`);
  });
});

// Validate designs
console.log('\n✅ Validating designs...');
const validationResults = ShipDesignManager.validateStandardDesigns();
validationResults.forEach(result => {
  console.log(`- ${result.design}: ${result.valid ? '✅ Valid' : '❌ Invalid'}`);
  if (result.error) {
    console.log(`  Error: ${result.error}`);
  }
});

// Generate entity configs
console.log('\n🔧 Converting to entity configs...');
designs.forEach(design => {
  try {
    const entityConfigs = ShipDesignManager.shipDesignToEntityConfigs(design);
    console.log(`\n${design.name} entity configs:`);
    entityConfigs.forEach(config => {
      console.log(`  { "type": "${config.type}", "x": ${config.x}, "y": ${config.y}, "rotation": ${config.rotation} }`);
    });
  } catch (error) {
    console.error(`❌ Error converting ${design.name}:`, error);
  }
});

// Generate ships.json format
const shipsJson = ShipDesignManager.generateShipsJson();
console.log('\n📄 Generated ships.json:');
console.log(JSON.stringify(shipsJson, null, 2));
