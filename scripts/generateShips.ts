/**
 * Ship Generator Script
 * 
 * This script generates properly positioned ship designs using the new BlockSystem
 */

import { ShipDesignManager } from '../src/game/ShipDesignManager';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate the ships.json file
const shipsData = ShipDesignManager.generateShipsJson();

// Validate all designs
const validationResults = ShipDesignManager.validateStandardDesigns();
console.log('Ship Design Validation:');
validationResults.forEach(result => {
  console.log(`- ${result.design}: ${result.valid ? '✅ Valid' : '❌ Invalid'}`);
  if (result.error) {
    console.log(`  Error: ${result.error}`);
  }
});

// Write to ships.json
const shipsJsonPath = path.join(__dirname, '../src/data/ships.json');
fs.writeFileSync(shipsJsonPath, JSON.stringify(shipsData, null, 2));

console.log('\n✅ Generated ships.json with proper block positioning');
console.log('Ships created:');
shipsData.ships.forEach((ship: any) => {
  console.log(`- ${ship.name} (${ship.parts.length} parts)`);
  ship.parts.forEach((part: any) => {
    console.log(`  ${part.type} at (${part.x}, ${part.y})`);
  });
});
