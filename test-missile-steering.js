// Test missile steering by creating a missile and observing its behavior
const testMissileSteering = () => {
    console.log('🔧 Testing Missile Steering');
    
    // Test missile configurations
    console.log('📋 Missile Configurations:');
    const { MISSILE_CONFIGS, MissileType } = require('./src/game/Missile.ts');
    
    for (const [type, config] of Object.entries(MISSILE_CONFIGS)) {
        console.log(`  ${type}:`);
        console.log(`    Turn Rate: ${config.turnRate} rad/s`);
        console.log(`    Speed: ${config.speed}`);
        console.log(`    Max Speed: ${config.maxSpeed}`);
        console.log(`    Proximity Radius: ${config.proximityRadius}`);
    }
    
    // Test steering calculations
    console.log('\n🎯 Testing Steering Math:');
    
    // Simulate a missile at angle 0 (facing right) trying to turn to angle PI/2 (facing up)
    const currentAngle = 0;
    const targetAngle = Math.PI / 2;
    
    let angleDiff = targetAngle - currentAngle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    console.log(`Current angle: ${currentAngle} rad (${currentAngle * 180 / Math.PI}°)`);
    console.log(`Target angle: ${targetAngle} rad (${targetAngle * 180 / Math.PI}°)`);
    console.log(`Angle difference: ${angleDiff} rad (${angleDiff * 180 / Math.PI}°)`);
    
    const deltaTime = 1/60; // 60 FPS
    const turnRate = 2.0; // Heat seeker turn rate
    const maxTurn = turnRate * deltaTime;
    const turnAmount = Math.max(-maxTurn, Math.min(maxTurn, angleDiff));
    
    console.log(`Delta time: ${deltaTime}s`);
    console.log(`Max turn per frame: ${maxTurn} rad (${maxTurn * 180 / Math.PI}°)`);
    console.log(`Actual turn amount: ${turnAmount} rad (${turnAmount * 180 / Math.PI}°)`);
    
    // Test thrust force calculation
    console.log('\n🚀 Testing Thrust Force:');
    const speed = 25; // Heat seeker speed
    const thrustMultiplier = 0.5;
    const newAngle = currentAngle + turnAmount;
    
    const thrustForce = {
        x: Math.cos(newAngle) * speed * thrustMultiplier,
        y: Math.sin(newAngle) * speed * thrustMultiplier
    };
    
    console.log(`New missile angle: ${newAngle} rad (${newAngle * 180 / Math.PI}°)`);
    console.log(`Thrust force: x=${thrustForce.x.toFixed(2)}, y=${thrustForce.y.toFixed(2)}`);
    console.log(`Force magnitude: ${Math.sqrt(thrustForce.x**2 + thrustForce.y**2).toFixed(2)}`);
};

testMissileSteering();
