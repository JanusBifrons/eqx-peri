// Test missile power system integration
console.log('=== MISSILE POWER SYSTEM TEST ===');

import { PowerSystem } from './src/game/PowerSystem.ts';
import { Assembly } from './src/game/Assembly.ts';
import shipsData from './src/data/ships.json';

// Test 1: Create Missile Corvette and check power analysis
console.log('\n1. Testing power analysis with missiles...');

const ships = shipsData.ships;
const missileCorvette = ships.find(ship => ship.name === 'Missile Corvette');

if (missileCorvette) {
  try {
    const assembly = new Assembly(missileCorvette.parts, { x: 0, y: 0 });
    const powerSystem = PowerSystem.getInstance();
    powerSystem.setPlayerAssembly(assembly);
    
    const analysis = powerSystem.analyzeShipPower();
    
    console.log('✅ Power Analysis Results:');
    console.log(`   - Total Power Cells: ${analysis.totalPowerCells}`);
    console.log(`   - Max Engines: ${analysis.maxEngines}`);
    console.log(`   - Max Weapons (including missiles): ${analysis.maxWeapons}`);
    console.log(`   - Max Sensors: ${analysis.maxSensors}`);
    
    // Count missile launchers specifically
    const missileLaunchers = missileCorvette.parts.filter(part => 
      part.type.includes('MissileLauncher')
    );
    
    console.log(`   - Missile Launchers found: ${missileLaunchers.length}`);
    
    // Test power allocation
    const allocation = powerSystem.getPowerAllocation();
    console.log(`   - Weapon Power Allocated: ${allocation.weapons}`);
    
    // Test missile firing capability
    const canFireMissiles = powerSystem.canFireMissiles();
    console.log(`   - Can Fire Missiles: ${canFireMissiles ? '✅ YES' : '❌ NO'}`);
    
    // Test with zero weapon power
    powerSystem.setPowerAllocation({
      engines: allocation.engines,
      weapons: 0,  // Remove all weapon power
      sensors: allocation.sensors
    });
    
    const canFireWithoutPower = powerSystem.canFireMissiles();
    console.log(`   - Can Fire Missiles (no weapon power): ${canFireWithoutPower ? '❌ YES (BUG!)' : '✅ NO (CORRECT)'}`);
    
    // Test missile launch requests with no power
    const requests = assembly.getMissileLaunchRequests();
    console.log(`   - Missile Launch Requests (no power): ${requests.length} (should be 0)`);
    
  } catch (error) {
    console.log('❌ Error testing power system:', error.message);
  }
} else {
  console.log('❌ Missile Corvette not found');
}

console.log('\n=== POWER SYSTEM TEST COMPLETE ===');
console.log('\nTo test in game:');
console.log('1. Press "4" to spawn Missile Corvette');
console.log('2. Select it as your ship');
console.log('3. Check Power Management UI at bottom-left');
console.log('4. Try reducing weapon power to 0');
console.log('5. Press Space - missiles should NOT fire');
console.log('6. Restore weapon power and try again');
