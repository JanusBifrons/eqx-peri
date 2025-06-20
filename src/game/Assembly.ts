import * as Matter from 'matter-js';
import { Entity } from './Entity';
import { EntityConfig, Vector2, EntityType, ENTITY_DEFINITIONS } from '../types/GameTypes';
import { ConnectionDetector } from './BlockSystem';
import { PowerSystem } from './PowerSystem';
import { MissileType } from './Missile';

// Interface for missile launch requests
export interface MissileLaunchRequest {
  position: Vector2;
  angle: number;
  missileType: MissileType;
  sourceAssemblyId: string;
  targetAssembly?: Assembly;
}

export class Assembly {
  public id: string;
  public rootBody: Matter.Body;
  public entities: Entity[] = [];
  public shipName: string = 'Unknown Ship'; public isPlayerControlled: boolean = false;
  public destroyed: boolean = false;
  public lastFireTime: number = 0;
  public fireRate: number = 300;
  public team: number = 0;

  // Targeting system properties
  public lockedTargets: Set<string> = new Set();
  public primaryTarget: Assembly | null = null;
  public cursorPosition: Vector2 | null = null;

  // Kill tracking properties
  public lastHitByPlayer: boolean = false;
  public lastHitByAssemblyId: string | null = null;

  constructor(entityConfigs: EntityConfig[], position: Vector2 = { x: 0, y: 0 }) {
    this.id = Math.random().toString(36).substr(2, 9);

    // Create entities
    this.entities = entityConfigs.map(config => new Entity(config));

    // Calculate expected total mass
    const expectedTotalMass = this.entities.reduce((sum, e) => sum + e.body.mass, 0);    // Assembly created with combined mass

    // Create root body with realistic physics settings
    this.rootBody = Matter.Body.create({
      parts: this.entities.map(e => e.body),
      isStatic: false,
      frictionAir: 0.01, // Very small air resistance to dampen spinning
      friction: 0, // No surface friction in space
      restitution: 0.2 // Low bounce for realistic space debris
    });

    // Debug: Check if Matter.js calculated the mass correctly
    // Create the Matter.js compound body
    if (Math.abs(this.rootBody.mass - expectedTotalMass) > 0.1) {
      console.warn(`⚠️ Mass mismatch! Matter.js mass: ${this.rootBody.mass}, calculated: ${expectedTotalMass} `);
    }

    // Set position
    Matter.Body.setPosition(this.rootBody, position);    // Store reference to this assembly in the body
    this.rootBody.assembly = this;

    // Also set assembly reference on individual entity bodies
    this.entities.forEach(entity => {
      entity.body.assembly = this;
    });
  }

  public update(): void {
    if (this.destroyed) return;

    // Update visual effects for all entities
    this.entities.forEach(entity => {
      entity.updateVisualEffects(16); // Assuming ~60fps, 16ms per frame
    });

    // Check if we still have a control center
    const hasControlCenter = this.entities.some(e => e.isControlCenter());

    // Remove destroyed entities and rebuild if needed
    const activeEntities = this.entities.filter(e => !e.destroyed); if (activeEntities.length !== this.entities.length) {
      // Some entities were destroyed - we need to rebuild completely
      this.entities = activeEntities;

      // Update power system if this is the player ship
      if (this.isPlayerControlled) {
        const powerSystem = PowerSystem.getInstance();
        powerSystem.setPlayerAssembly(this);
        powerSystem.updatePowerAfterDamage();
      }

      if (this.entities.length === 0) {
        this.destroy();
        return;
      }

      // Recreate the body completely with remaining entities
      this.createFreshBody();
    }

    // If no control center and this was player controlled, find new player ship
    if (this.isPlayerControlled && !hasControlCenter) {
      this.isPlayerControlled = false;
    }
  } public applyThrust(thrustInput: Vector2): void {
    if (this.destroyed) return;

    // Check if this is the player assembly and if engines have power
    if (this.isPlayerControlled) {
      const powerSystem = PowerSystem.getInstance();
      if (!powerSystem.canUseThrusters()) {
        // No engine power - disable all thrust
        const engines = this.entities.filter(e => e.canProvideThrust());
        engines.forEach(engine => engine.setThrustLevel(0));
        return;
      }
    }

    const engines = this.entities.filter(e => e.canProvideThrust());
    if (engines.length === 0) return;// Calculate thrust magnitude for visual effects
    const thrustMagnitude = Math.sqrt(thrustInput.x * thrustInput.x + thrustInput.y * thrustInput.y);

    // Debug logging disabled to reduce spam
    // if (thrustMagnitude > 0) {
    //   console.log(`🚀 Thrust Input: x = ${ thrustInput.x.toFixed(2) }, y = ${ thrustInput.y.toFixed(2) }, engines = ${ engines.length } `);
    // }    // SIMPLIFIED: Apply thrust directly in ship-local coordinates
    engines.forEach((engine) => {
      // Get engine thrust values
      let engineThrust = this.getEngineThrust(engine.type);

      // Apply power efficiency for player ships
      if (this.isPlayerControlled) {
        const powerSystem = PowerSystem.getInstance();
        const efficiency = powerSystem.getEngineEfficiency();
        engineThrust *= efficiency;
      }

      // Set visual thrust level for this engine
      engine.setThrustLevel(thrustMagnitude);

      // SIMPLE LOGIC: All engines contribute to movement in the requested direction
      // The physics engine will handle the realistic movement behavior
      let thrustContribution = { x: 0, y: 0 };

      // If requesting any thrust, all engines contribute proportionally
      if (thrustMagnitude > 0) {
        thrustContribution.x = thrustInput.x * engineThrust;
        thrustContribution.y = thrustInput.y * engineThrust;
      }

      if (thrustContribution.x !== 0 || thrustContribution.y !== 0) {
        // Convert ship-local thrust to world coordinates
        const shipAngle = this.rootBody.angle;
        const worldForce = {
          x: thrustContribution.x * Math.cos(shipAngle) - thrustContribution.y * Math.sin(shipAngle),
          y: thrustContribution.x * Math.sin(shipAngle) + thrustContribution.y * Math.cos(shipAngle)
        };

        // Apply force at CENTER OF MASS to avoid unwanted torque from engine positioning
        Matter.Body.applyForce(this.rootBody, this.rootBody.position, worldForce);
      }
    });
  } private getEngineThrust(engineType: string): number {
    // Get thrust from engine part definition
    const definition = ENTITY_DEFINITIONS[engineType as EntityType];
    if (definition && definition.thrust) {
      return definition.thrust;
    }
    return 0;
  } public applyTorque(torqueInput: number): void {
    if (this.destroyed) return;

    // Balanced rotation using Matter.js angular velocity
    const currentAngularVelocity = this.rootBody.angularVelocity;
    const maxAngularVelocity = 0.02; // Reduced from 0.1 to 0.02 (much more reasonable)

    const desiredAngularVelocity = torqueInput * maxAngularVelocity;
    const dampening = 0.15; // Reduced from 0.3 to 0.15 (less twitchy)

    const newAngularVelocity = currentAngularVelocity +
      (desiredAngularVelocity - currentAngularVelocity) * dampening;

    Matter.Body.setAngularVelocity(this.rootBody, newAngularVelocity);
  } public fireWeapons(): Matter.Body[] {
    if (this.destroyed) return [];

    // Check if this is the player assembly and if weapons have power
    if (this.isPlayerControlled) {
      const powerSystem = PowerSystem.getInstance();
      if (!powerSystem.canFireWeapons()) {
        // No weapon power - cannot fire
        return [];
      }
    } const currentTime = Date.now();

    // Calculate effective firing rate based on weapon power for player ships
    let effectiveFireRate = this.fireRate;
    if (this.isPlayerControlled) {
      const powerSystem = PowerSystem.getInstance();
      const weaponEfficiency = powerSystem.getWeaponEfficiency();
      // More power = faster firing (lower fire rate delay)
      // At 0% efficiency: fireRate * 3 (much slower)
      // At 100% efficiency: fireRate * 1 (normal speed)
      effectiveFireRate = this.fireRate * (3 - 2 * weaponEfficiency);
    }

    // Enforce firing rate limit
    if (currentTime - this.lastFireTime < effectiveFireRate) {
      return []; // Can't fire yet, return empty array
    } const weapons = this.entities.filter(e => e.canFire() && !e.isMissileLauncher());
    const lasers: Matter.Body[] = [];

    weapons.forEach(weapon => {
      // Trigger visual firing effect
      weapon.triggerWeaponFire();

      // Fire using the weapon's current (smoothly interpolated) aiming angle
      const currentFiringAngle = weapon.getCurrentFiringAngle(this.rootBody.angle);
      const laser = this.createLaser(weapon, currentFiringAngle);
      if (laser) {
        lasers.push(laser);
      }
    });

    // Update last fire time to current time
    this.lastFireTime = currentTime;

    return lasers;
  }

  public getMissileLaunchRequests(): MissileLaunchRequest[] {
    if (this.destroyed) return [];

    // Check if this is the player assembly and if weapons have power
    if (this.isPlayerControlled) {
      const powerSystem = PowerSystem.getInstance();
      if (!powerSystem.canFireWeapons()) {
        return [];
      }
    }

    const currentTime = Date.now();

    // Calculate effective firing rate
    let effectiveFireRate = this.fireRate;
    if (this.isPlayerControlled) {
      const powerSystem = PowerSystem.getInstance();
      const weaponEfficiency = powerSystem.getWeaponEfficiency();
      effectiveFireRate = this.fireRate * (3 - 2 * weaponEfficiency);
    }

    // Enforce firing rate limit
    if (currentTime - this.lastFireTime < effectiveFireRate) {
      return [];
    }

    const missileLaunchers = this.entities.filter(e => e.isMissileLauncher() && e.canFire());
    const missileRequests: MissileLaunchRequest[] = [];

    missileLaunchers.forEach(launcher => {
      // Trigger visual firing effect
      launcher.triggerWeaponFire();

      // Calculate launch position and angle
      const launcherWorldPos = launcher.body.position;
      const currentFiringAngle = launcher.getCurrentFiringAngle(this.rootBody.angle);

      // Determine missile type based on launcher type
      let missileType: MissileType;
      switch (launcher.type) {
        case 'MissileLauncher':
          missileType = MissileType.HEAT_SEEKER; // Default to heat seekers for small launchers
          break;
        case 'LargeMissileLauncher':
          missileType = MissileType.GUIDED; // Guided missiles for large launchers
          break;
        case 'CapitalMissileLauncher':
          missileType = MissileType.TORPEDO; // Heavy torpedoes for capital launchers
          break;
        default:
          missileType = MissileType.HEAT_SEEKER;
      }

      // If we have a primary target and it's a guided missile, use it
      const targetAssembly = (missileType === MissileType.GUIDED && this.primaryTarget && !this.primaryTarget.destroyed)
        ? this.primaryTarget
        : undefined;

      missileRequests.push({
        position: launcherWorldPos,
        angle: currentFiringAngle,
        missileType,
        sourceAssemblyId: this.id,
        targetAssembly
      });
    });

    return missileRequests;
  }

  public canWeaponAimAtTarget(weapon: Entity, targetPosition: Vector2): boolean {
    const weaponAngle = this.calculateWeaponAimAngle(weapon, targetPosition);
    const weaponNaturalAngle = this.rootBody.angle + (weapon.rotation * Math.PI / 180);

    // Normalize angle difference
    let angleDiff = weaponAngle - weaponNaturalAngle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    // Check if target is within weapon's aiming arc
    const aimingArc = this.getWeaponAimingArc(weapon.type);
    return Math.abs(angleDiff) <= aimingArc / 2;
  }

  public calculateWeaponAimAngle(weapon: Entity, targetPosition: Vector2): number {
    const weaponWorldPos = weapon.body.position;
    return Math.atan2(
      targetPosition.y - weaponWorldPos.y,
      targetPosition.x - weaponWorldPos.x
    );
  }
  public getWeaponAimingArc(weaponType: string): number {
    // Return aiming arc in radians - significantly widened for debugging
    switch (weaponType) {
      case 'Gun':
      case 'Cockpit':
        return Math.PI; // 180 degrees total arc (90 degrees each side)
      case 'LargeGun':
      case 'LargeCockpit':
        return Math.PI * 1.2; // 216 degrees total arc
      case 'CapitalWeapon':
      case 'CapitalCore':
        return Math.PI * 1.5; // 270 degrees total arc
      default:
        return Math.PI; // Default 180 degrees
    }
  } private createLaser(weapon: Entity, targetAngle?: number): Matter.Body | null {
    // Calculate laser spawn position and direction
    const weaponWorldPos = weapon.body.position;
    const assemblyAngle = this.rootBody.angle;
    const weaponLocalAngle = weapon.rotation * Math.PI / 180;

    let firingAngle: number;

    if (targetAngle !== undefined) {
      // Use target angle but apply aiming arc constraints
      const weaponNaturalAngle = assemblyAngle + weaponLocalAngle;
      let angleDiff = targetAngle - weaponNaturalAngle;

      // Normalize angle difference
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      // Clamp angle difference to weapon's aiming arc
      const aimingArc = this.getWeaponAimingArc(weapon.type);
      const maxAngleDiff = aimingArc / 2;
      angleDiff = Math.max(-maxAngleDiff, Math.min(maxAngleDiff, angleDiff));

      firingAngle = weaponNaturalAngle + angleDiff;
    } else {
      // Use weapon's natural direction
      firingAngle = assemblyAngle + weaponLocalAngle;
    }

    // Configure laser properties - much slower speeds with length matching speed to prevent tunneling
    let laserSpeed = 50; // Much slower speed
    let laserHeight = 4; // Thickness of the laser
    let spawnDistance = 20; // Distance from weapon
    let laserColor = '#00ffff'; // Default cyan

    // Calculate laser length based on speed to prevent tunneling
    // Length should be at least as long as the distance traveled per frame at 60fps
    const frameTime = 1 / 60; // 60fps
    let laserWidth = Math.max(laserSpeed * frameTime * 2, 20); // At least 2 frames of travel distance

    switch (weapon.type) {
      case 'Gun':
        laserSpeed = 50; // Much slower
        laserWidth = Math.max(laserSpeed * frameTime * 2, 20);
        spawnDistance = 20;
        break;
      case 'LargeGun':
        laserSpeed = 60; // Slightly faster for large guns
        laserWidth = Math.max(laserSpeed * frameTime * 2, 25);
        laserHeight = 6;
        spawnDistance = 25;
        laserColor = '#ff6600'; // Orange for large guns
        break;
      case 'CapitalWeapon':
        laserSpeed = 70; // Fastest but still reasonable
        laserWidth = Math.max(laserSpeed * frameTime * 2, 30);
        laserHeight = 10;
        spawnDistance = 30;
        laserColor = '#ff0000'; // Red for capital weapons
        break;
    }

    // Spawn laser much closer to the weapon for accurate positioning
    const spawnX = weaponWorldPos.x + Math.cos(firingAngle) * spawnDistance;
    const spawnY = weaponWorldPos.y + Math.sin(firingAngle) * spawnDistance;

    // Create rectangular laser body
    const laser = Matter.Bodies.rectangle(spawnX, spawnY, laserWidth, laserHeight, {
      isSensor: true, // Lasers are sensors - they pass through objects but trigger collision events
      frictionAir: 0, // No air resistance in space
      collisionFilter: {
        category: 0x0002, // Laser category
        mask: 0x0001 // Only collides with default category (not with other lasers or same assembly)
      },
      render: {
        fillStyle: laserColor,
        strokeStyle: '#ffffff',
        lineWidth: 1
      }
    });

    // Rotate the laser to match the firing direction
    Matter.Body.rotate(laser, firingAngle);

    // Set laser velocity using the firing angle, inheriting ship's velocity
    const shipVelocity = this.rootBody.velocity;
    const velocity = {
      x: Math.cos(firingAngle) * laserSpeed + shipVelocity.x,
      y: Math.sin(firingAngle) * laserSpeed + shipVelocity.y
    };

    Matter.Body.setVelocity(laser, velocity);

    // Mark as bullet for collision detection and store the source assembly ID
    laser.isBullet = true;
    laser.timeToLive = Date.now() + 8000; // 8 seconds for slower lasers
    (laser as any).sourceAssemblyId = this.id; // Store which assembly fired this laser

    return laser;
  }
  public removeEntity(entity: Entity): Assembly[] {
    const entityIndex = this.entities.findIndex(e => e.id === entity.id);
    if (entityIndex === -1) return [this];

    // Store current physics state before destroying
    const currentVelocity = this.rootBody.velocity;
    const currentAngularVelocity = this.rootBody.angularVelocity;
    const currentPosition = this.rootBody.position;
    const currentAngle = this.rootBody.angle;
    const wasPlayerControlled = this.isPlayerControlled;

    // Remove the destroyed entity
    this.entities.splice(entityIndex, 1);

    if (this.entities.length === 0) {
      this.destroy();
      return [];
    }

    // Find connected components from remaining entities
    const components = this.findConnectedComponents();

    // If there's only one component, the ship remains intact - no need to break apart
    if (components.length === 1) {
      console.log(`🔗 Ship remains intact after losing ${entity.type} - all parts still connected`);
      // Recreate the assembly body without the destroyed entity to update physics
      this.createFreshBody();
      return [this];
    }

    // Multiple components found - ship breaks apart
    console.log(`💥 Ship breaking into ${components.length} components after losing ${entity.type} `);

    // Mark this assembly as destroyed since it's being split
    this.destroyed = true;

    // Create completely new assemblies for each component
    const newAssemblies: Assembly[] = []; components.forEach((component) => {
      const newAssembly = this.createNewAssemblyFromComponent(
        component,
        currentPosition,
        currentVelocity,
        currentAngularVelocity,
        currentAngle
      );

      // Set team and naming for broken parts
      if (component.length === 1 && !newAssembly.hasControlCenter()) {
        // Single part without cockpit = debris
        newAssembly.setTeam(-1); // Neutral debris
        newAssembly.setShipName(`${component[0].type} Debris`);
      } else {
        // Multi-part assembly or has cockpit = maintains original team
        newAssembly.setTeam(this.team);
        newAssembly.setShipName(`${this.shipName} Fragment`);
      }

      // Transfer player control to first assembly with a cockpit
      if (wasPlayerControlled && newAssembly.hasControlCenter() && !newAssemblies.some(a => a.isPlayerControlled)) {
        newAssembly.isPlayerControlled = true;
      }

      newAssemblies.push(newAssembly);
    });
    return newAssemblies;
  }

  private createFreshBody(): void {
    // Store the current position before recreating
    const currentPosition = this.rootBody ? this.rootBody.position : { x: 0, y: 0 };

    // Create completely new entities with fresh bodies
    const newEntities: Entity[] = [];

    this.entities.forEach(oldEntity => {
      const config: EntityConfig = {
        type: oldEntity.type,
        x: oldEntity.localOffset.x,
        y: oldEntity.localOffset.y,
        rotation: oldEntity.rotation,
        health: oldEntity.health,
        maxHealth: oldEntity.maxHealth
      };
      newEntities.push(new Entity(config));
    });
    this.entities = newEntities;    // Create new root body with realistic physics settings
    this.rootBody = Matter.Body.create({
      parts: this.entities.map(e => e.body),
      isStatic: false,
      frictionAir: 0.01, // Very small air resistance to dampen spinning
      friction: 0, // No surface friction in space
      restitution: 0.2 // Low bounce for realistic space debris
    });

    // Restore position
    Matter.Body.setPosition(this.rootBody, currentPosition);    // Store reference
    this.rootBody.assembly = this;

    // Also set assembly reference on individual entity bodies
    this.entities.forEach(entity => {
      entity.body.assembly = this;
    });
  } private createNewAssemblyFromComponent(component: Entity[], basePosition: Vector2, velocity: Vector2, angularVelocity: number, baseAngle: number): Assembly {
    // Calculate the center offset of this component relative to original assembly
    const avgOffsetX = component.reduce((sum, e) => sum + e.localOffset.x, 0) / component.length;
    const avgOffsetY = component.reduce((sum, e) => sum + e.localOffset.y, 0) / component.length;

    // Rotate the average offset by the assembly's current angle to get world offset
    const cos = Math.cos(baseAngle);
    const sin = Math.sin(baseAngle);
    const worldOffsetX = avgOffsetX * cos - avgOffsetY * sin;
    const worldOffsetY = avgOffsetX * sin + avgOffsetY * cos;

    // Create configs with positions relative to the NEW assembly's center (not the original)
    const configs: EntityConfig[] = component.map(entity => ({
      type: entity.type,
      x: entity.localOffset.x - avgOffsetX, // Make relative to new assembly center
      y: entity.localOffset.y - avgOffsetY, // Make relative to new assembly center
      rotation: entity.rotation,
      health: entity.health,
      maxHealth: entity.maxHealth
    }));

    // Position the new assembly at the component's world position
    const newPosition = {
      x: basePosition.x + worldOffsetX,
      y: basePosition.y + worldOffsetY
    };

    console.log(`🔧 Creating new assembly at(${newPosition.x}, ${newPosition.y}) with ${component.length} parts`); const newAssembly = new Assembly(configs, newPosition);
    // Set the assembly's rotation to match the original
    Matter.Body.setAngle(newAssembly.rootBody, baseAngle);

    // Conserve all energy - inherit full velocity and angular momentum
    Matter.Body.setVelocity(newAssembly.rootBody, velocity);
    Matter.Body.setAngularVelocity(newAssembly.rootBody, angularVelocity);

    // Add small explosion force for dramatic effect
    const explosionForce = 0.5; // Small explosion magnitude
    const randomAngle = Math.random() * Math.PI * 2;
    const explosionVelocity = {
      x: Math.cos(randomAngle) * explosionForce,
      y: Math.sin(randomAngle) * explosionForce
    };

    // Apply the explosion force on top of the conserved momentum
    const finalVelocity = {
      x: velocity.x + explosionVelocity.x,
      y: velocity.y + explosionVelocity.y
    };

    Matter.Body.setVelocity(newAssembly.rootBody, finalVelocity);

    return newAssembly;
  } private findConnectedComponents(): Entity[][] {
    if (this.entities.length <= 1) return [this.entities];



    // Build connectivity graph
    const graph = new Map<string, Set<string>>();

    // Initialize graph
    this.entities.forEach(entity => {
      graph.set(entity.id, new Set());
    });

    // Check connections between all pairs
    for (let i = 0; i < this.entities.length; i++) {
      for (let j = i + 1; j < this.entities.length; j++) {
        if (this.areEntitiesConnected(this.entities[i], this.entities[j])) {
          graph.get(this.entities[i].id)!.add(this.entities[j].id);
          graph.get(this.entities[j].id)!.add(this.entities[i].id);
        }
      }
    }

    // Find connected components using DFS
    const visited = new Set<string>();
    const components: Entity[][] = [];

    this.entities.forEach(entity => {
      if (!visited.has(entity.id)) {
        const component: Entity[] = [];
        this.dfsComponent(entity.id, graph, visited, component);
        components.push(component);

      }
    });


    return components;
  } private areEntitiesConnected(entity1: Entity, entity2: Entity): boolean {
    // Use the robust connection detection system
    // Create temporary objects with the required structure for the connection detector
    const entityData1 = {
      type: entity1.type,
      x: entity1.body.position.x,
      y: entity1.body.position.y
    };

    const entityData2 = {
      type: entity2.type,
      x: entity2.body.position.x,
      y: entity2.body.position.y
    };

    const isConnected = ConnectionDetector.areEntitiesConnected(entityData1, entityData2);

    // Debug logging for troubleshooting
    if (isConnected) {

    }

    return isConnected;
  }

  private dfsComponent(
    entityId: string,
    graph: Map<string, Set<string>>,
    visited: Set<string>,
    component: Entity[]
  ): void {
    visited.add(entityId);
    const entity = this.entities.find(e => e.id === entityId);
    if (entity) {
      component.push(entity);
    }

    const neighbors = graph.get(entityId);
    if (neighbors) {
      neighbors.forEach(neighborId => {
        if (!visited.has(neighborId)) {
          this.dfsComponent(neighborId, graph, visited, component);
        }
      });
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.entities.forEach(entity => entity.destroy());
  }

  public getControlCenter(): Entity | null {
    return this.entities.find(e => e.isControlCenter()) || null;
  }
  public hasControlCenter(): boolean {
    return this.getControlCenter() !== null;
  }

  public setTeam(team: number): void {
    this.team = team;
    this.updateTeamColors();
  }

  public getTeam(): number {
    return this.team;
  }
  private updateTeamColors(): void {
    // Set MUCH more obvious team-based colors for all entities
    const teamColor = this.team === 0 ? '#0066ff' : '#ff0000'; // Much more vibrant colors
    const teamAccent = this.team === 0 ? '#00aaff' : '#ff3333';
    const teamBright = this.team === 0 ? '#66ccff' : '#ff6666';

    this.entities.forEach(entity => {
      if (entity.body.render) {
        // Override the default entity colors with MUCH more obvious team colors
        if (entity.isControlCenter()) {
          // Cockpits get the brightest color to stand out dramatically
          entity.body.render.fillStyle = teamBright;
          entity.body.render.strokeStyle = '#ffffff';
          entity.body.render.lineWidth = 3; // Thicker border        } else {
          // Other parts get the main team color - much more vibrant
          entity.body.render.fillStyle = teamColor;
          entity.body.render.strokeStyle = teamAccent;
          entity.body.render.lineWidth = 2; // Thicker borders for visibility
        }
      }
    });
  }

  // Set ship name for display
  public setShipName(name: string): void {
    this.shipName = name;
  }
  public getDamagePercentage(): number {
    const totalMaxHealth = this.entities.reduce((sum, e) => sum + e.maxHealth, 0);
    const currentHealth = this.entities.reduce((sum, e) => sum + e.health, 0);
    return totalMaxHealth > 0 ? (1 - (currentHealth / totalMaxHealth)) * 100 : 0;
  }
  public canEject(): boolean {
    // Can eject if there's a control center and there are non-control parts to eject
    const hasControlCenter = this.hasControlCenter();
    const hasNonControlParts = this.entities.some(e => !e.isControlCenter());
    return hasControlCenter && hasNonControlParts;
  }
  public ejectNonControlParts(): Assembly[] {
    console.log('🚀 EJECTING! Separating non-control parts from assembly');

    const controlCenter = this.getControlCenter();
    if (!controlCenter) {
      console.warn('⚠️ Cannot eject - no control center found');
      return [];
    }

    // Separate entities into cockpit and non-cockpit
    const ejectEntities = this.entities.filter(e => !e.isControlCenter());

    console.log(`💥 EXPLOSION! Ejecting ${ejectEntities.length} parts with explosive force from cockpit origin`);

    // Create new assemblies for ejected parts (each part becomes its own debris)
    const newAssemblies: Assembly[] = [];
    const cockpitPos = controlCenter.body.position;
    const explosionForce = 0.005; // Force magnitude for Matter.js physics
    const explosionRadius = 200; // Maximum effective radius of explosion

    ejectEntities.forEach(entity => {
      // Create individual debris assemblies for each ejected part
      const debrisConfig: EntityConfig = {
        type: entity.type,
        x: entity.body.position.x,
        y: entity.body.position.y,
        rotation: (entity.body.angle * 180) / Math.PI,
        health: entity.health,
        maxHealth: entity.maxHealth
      };

      const debrisAssembly = new Assembly([debrisConfig], entity.body.position);
      debrisAssembly.setTeam(-1); // Mark as neutral debris
      debrisAssembly.setShipName(`${entity.type} Debris`);

      // Calculate explosion effect from cockpit origin using Matter.js forces
      const entityPos = entity.body.position;
      const explosionVector = {
        x: entityPos.x - cockpitPos.x,
        y: entityPos.y - cockpitPos.y
      };

      // Calculate distance from explosion center
      const distance = Math.sqrt(explosionVector.x * explosionVector.x + explosionVector.y * explosionVector.y);

      if (distance > 0) {
        // Normalize the explosion vector
        const normalizedVector = {
          x: explosionVector.x / distance,
          y: explosionVector.y / distance
        };

        // Calculate explosion force based on distance (closer = more force)
        const distanceFactor = Math.max(0.1, 1 - (distance / explosionRadius));
        const forceMultiplier = explosionForce * distanceFactor;

        // Add some randomness to make it more organic (±30 degrees)
        const randomAngle = (Math.random() - 0.5) * Math.PI / 3;
        const forceAngle = Math.atan2(normalizedVector.y, normalizedVector.x) + randomAngle;

        // Apply explosion force with some random variation
        const forceVariation = 0.8 + Math.random() * 0.4; // 0.8x to 1.2x force
        const force = {
          x: Math.cos(forceAngle) * forceMultiplier * forceVariation,
          y: Math.sin(forceAngle) * forceMultiplier * forceVariation
        };

        // Apply force at the center of mass - this is the proper Matter.js way
        Matter.Body.applyForce(debrisAssembly.rootBody, debrisAssembly.rootBody.position, force);

        console.log(`💥 Debris ${entity.type} ejected with force ${forceMultiplier.toFixed(4)} at distance ${distance.toFixed(1)} `);
      } else {
        // If entity is at exact same position as cockpit, use random direction
        const randomAngle = Math.random() * Math.PI * 2;
        const randomForce = explosionForce * (0.5 + Math.random() * 0.5);
        const force = {
          x: Math.cos(randomAngle) * randomForce,
          y: Math.sin(randomAngle) * randomForce
        };
        Matter.Body.applyForce(debrisAssembly.rootBody, debrisAssembly.rootBody.position, force);
      }

      // Add random spin - we can still set angular velocity for this
      const spinIntensity = 0.1 + Math.random() * 0.3;
      Matter.Body.setAngularVelocity(debrisAssembly.rootBody, (Math.random() - 0.5) * spinIntensity);

      newAssemblies.push(debrisAssembly);
    });    // Create new cockpit-only assembly
    const cockpitConfig: EntityConfig = {
      type: controlCenter.type,
      x: controlCenter.body.position.x,
      y: controlCenter.body.position.y,
      rotation: (controlCenter.body.angle * 180) / Math.PI,
      health: controlCenter.health,
      maxHealth: controlCenter.maxHealth
    }; const cockpitAssembly = new Assembly([cockpitConfig], controlCenter.body.position);
    cockpitAssembly.setTeam(this.team);
    cockpitAssembly.isPlayerControlled = this.isPlayerControlled;
    cockpitAssembly.setShipName(`${this.shipName} (Cockpit)`);

    // Make cockpit briefly invulnerable after ejection to prevent immediate damage
    const cockpitEntity = cockpitAssembly.entities[0];
    if (cockpitEntity) {
      cockpitEntity.setInvulnerable(2000); // 2 seconds of invulnerability
    }

    // Apply gentle recoil to cockpit from explosion (much smaller than debris)
    const originalVel = this.rootBody.velocity;
    const recoilForce = 1.5; // Much smaller than debris explosion force
    const recoilAngle = Math.random() * Math.PI * 2; // Random direction

    Matter.Body.setVelocity(cockpitAssembly.rootBody, {
      x: originalVel.x * 0.8 + Math.cos(recoilAngle) * recoilForce,
      y: originalVel.y * 0.8 + Math.sin(recoilAngle) * recoilForce
    });

    console.log(`💥 Cockpit recoil applied: ${recoilForce} force at ${(recoilAngle * 180 / Math.PI).toFixed(1)}°`);

    // Mark this assembly as destroyed
    this.destroyed = true;

    console.log(`🚀 Ejection complete: 1 cockpit assembly + ${newAssemblies.length} debris pieces`);

    return [cockpitAssembly, ...newAssemblies];
  }
  public getShipBounds(): { minX: number, minY: number, maxX: number, maxY: number, width: number, height: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    this.entities.forEach(entity => {
      const def = ENTITY_DEFINITIONS[entity.type];
      const halfWidth = def.width / 2;
      const halfHeight = def.height / 2;

      // Get entity position relative to assembly root
      const entityX = entity.body.position.x;
      const entityY = entity.body.position.y;

      minX = Math.min(minX, entityX - halfWidth);
      minY = Math.min(minY, entityY - halfHeight);
      maxX = Math.max(maxX, entityX + halfWidth);
      maxY = Math.max(maxY, entityY + halfHeight);
    });

    const width = maxX - minX;
    const height = maxY - minY;

    return { minX, minY, maxX, maxY, width, height };
  }

  public getShipRadius(): number {
    const bounds = this.getShipBounds();
    // Return the radius as half the diagonal of the bounding box
    return Math.sqrt(bounds.width * bounds.width + bounds.height * bounds.height) / 2;
  }

  public lockTarget(target: Assembly): void {
    this.lockedTargets.add(target.id);
    console.log(`🔒 ${this.shipName} locked onto ${target.shipName} `);
  }

  public unlockTarget(target: Assembly): void {
    this.lockedTargets.delete(target.id);
    if (this.primaryTarget?.id === target.id) {
      this.primaryTarget = null;
    }
    console.log(`🔓 ${this.shipName} unlocked ${target.shipName} `);
  }

  public setPrimaryTarget(target: Assembly | null): void {
    this.primaryTarget = target;
    if (target) {
      this.lockTarget(target);
      console.log(`🎯 ${this.shipName} set primary target: ${target.shipName} `);
    } else {
      console.log(`🎯 ${this.shipName} cleared primary target`);
    }
  }

  public isTargetLocked(target: Assembly): boolean {
    return this.lockedTargets.has(target.id);
  }
  public getLockedTargets(): Assembly[] {
    // This method will be called by GameEngine which should provide the current assemblies
    // For now, return empty array - GameEngine will handle the mapping
    return [];
  }

  // Auto-fire at primary target if weapons can aim at it
  public autoFireAtPrimaryTarget(): Matter.Body[] {
    if (!this.primaryTarget || this.primaryTarget.destroyed) {
      return [];
    }
    return this.fireWeapons();
  }

  // Update weapon aiming continuously (called every frame)
  public updateWeaponAiming(): void {
    if (this.destroyed) return;

    const weapons = this.entities.filter(e => e.canFire()); weapons.forEach(weapon => {
      // Weapon targeting priority order:
      // 1. Primary target assembly (highest priority)
      // 2. Mouse cursor position (fallback)
      let aimingTarget: Vector2 | null = null;

      if (this.primaryTarget && !this.primaryTarget.destroyed) {
        aimingTarget = this.primaryTarget.rootBody.position;
      } else if (this.cursorPosition) {
        aimingTarget = this.cursorPosition;
      }

      // Calculate desired aiming angle and set it as the weapon's target
      if (aimingTarget) {
        const desiredAngle = this.calculateWeaponAimAngle(weapon, aimingTarget);
        const weaponNaturalAngle = this.rootBody.angle + (weapon.rotation * Math.PI / 180);

        // Calculate the desired rotation relative to weapon's natural direction
        let desiredRelativeAngle = desiredAngle - weaponNaturalAngle;
        while (desiredRelativeAngle > Math.PI) desiredRelativeAngle -= 2 * Math.PI;
        while (desiredRelativeAngle < -Math.PI) desiredRelativeAngle += 2 * Math.PI;

        // Simple clamping to weapon's aiming arc
        const aimingArc = this.getWeaponAimingArc(weapon.type);
        const maxAngle = aimingArc / 2;
        desiredRelativeAngle = Math.max(-maxAngle, Math.min(maxAngle, desiredRelativeAngle));

        // Set the weapon's target aim angle
        weapon.setTargetAimAngle(desiredRelativeAngle);
      } else {
        // No target, return to natural position
        weapon.setTargetAimAngle(0);
      }
    });
  }
}

// Extend Matter.js Body type to include our assembly reference
declare module 'matter-js' {
  interface Body {
    assembly?: Assembly;
    isBullet?: boolean;
    timeToLive?: number;
  }
}
