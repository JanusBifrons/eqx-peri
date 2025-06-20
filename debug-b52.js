// Debug B52 Bomber design specifically
import { ShipDesignManager } from './src/game/ShipDesignManager.ts';
import { ShipValidator } from './src/game/BlockSystem.ts';

console.log('=== DEBUGGING B52 BOMBER ===');

const designs = ShipDesignManager.createStandardDesigns();
const b52 = designs.find(d => d.name === 'B52 Bomber');

if (b52) {
  console.log(`B52 has ${b52.blocks.length} blocks:`);
  b52.blocks.forEach((block, i) => {
    console.log(`  ${i}: ${block.type} at (${block.gridPosition.x}, ${block.gridPosition.y})`);
  });

  // Test individual connections
  console.log('\n=== TESTING INDIVIDUAL CONNECTIONS ===');
  
  // Test each block connection to all others
  for (let i = 0; i < b52.blocks.length; i++) {
    const block1 = b52.blocks[i];
    let hasConnection = false;
    
    for (let j = 0; j < b52.blocks.length; j++) {
      if (i === j) continue;
      
      const block2 = b52.blocks[j];
      const canConnect = ShipValidator.canBlocksConnect(block1, block2);
      
      if (canConnect) {
        hasConnection = true;
        console.log(`✅ ${block1.type}(${block1.gridPosition.x},${block1.gridPosition.y}) connects to ${block2.type}(${block2.gridPosition.x},${block2.gridPosition.y})`);
      }
    }
    
    if (!hasConnection) {
      console.log(`❌ ${block1.type}(${block1.gridPosition.x},${block1.gridPosition.y}) has NO connections!`);
    }
  }
  
  // Test overall validity
  const isValid = ShipValidator.isValidDesign(b52);
  console.log(`\nOverall B52 validity: ${isValid}`);
  
} else {
  console.log('B52 Bomber not found!');
}
