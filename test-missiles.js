// Test missile functionality
console.log('=== MISSILE SYSTEM TEST ===');

import { GameEngine } from './src/game/GameEngine.ts';
import { MissileSystem } from './src/game/MissileSystem.ts';
import { Missile, MissileType } from './src/game/Missile.ts';
import { Assembly } from './src/game/Assembly.ts';
import shipsData from './src/data/ships.json';

// Test 1: Check if Missile Corvette exists in ships data
console.log('\n1. Testing ship data...');
const ships = shipsData.ships;
const missileCorvette = ships.find(ship => ship.name === 'Missile Corvette');

if (missileCorvette) {
  console.log('✅ Missile Corvette found in ship data');
  console.log(`   - Has ${missileCorvette.parts.length} parts`);
  
  const missileLaunchers = missileCorvette.parts.filter(part => 
    part.type === 'MissileLauncher' || 
    part.type === 'LargeMissileLauncher' || 
    part.type === 'CapitalMissileLauncher'
  );
  
  console.log(`   - Has ${missileLaunchers.length} missile launchers`);
  missileLaunchers.forEach(launcher => {
    console.log(`     * ${launcher.type} at (${launcher.x}, ${launcher.y})`);
  });
} else {
  console.log('❌ Missile Corvette NOT found in ship data');
}

// Test 2: Check if Assembly has separate missile fire timing
console.log('\n2. Testing Assembly missile timing...');
try {
  const testAssembly = new Assembly([], { x: 0, y: 0 });
  if ('lastMissileFireTime' in testAssembly) {
    console.log('✅ Assembly has separate lastMissileFireTime property');
  } else {
    console.log('❌ Assembly missing lastMissileFireTime property');
  }
} catch (error) {
  console.log('❌ Error creating test assembly:', error.message);
}

// Test 3: Check missile configurations
console.log('\n3. Testing missile configurations...');
console.log('Heat Seeker proximity radius:', MISSILE_CONFIGS[MissileType.HEAT_SEEKER].proximityRadius);
console.log('Guided missile turn rate:', MISSILE_CONFIGS[MissileType.GUIDED].turnRate);
console.log('Torpedo damage:', MISSILE_CONFIGS[MissileType.TORPEDO].damage);

console.log('\n=== TEST COMPLETE ===');
console.log('\nTo test in game:');
console.log('1. Press "4" to spawn Missile Corvette');
console.log('2. Select it as your ship or let AI control it');
console.log('3. Watch for missile firing and tracking behavior');
