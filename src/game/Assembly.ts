import * as Matter from 'matter-js';
import { Entity } from './Entity';
import { EntityConfig, Vector2, EntityType, ENTITY_DEFINITIONS } from '../types/GameTypes';
import { areEntitiesAdjacent } from './BlockSystem';

export class Assembly {
  public id: string;
  public rootBody: Matter.Body;
  public entities: Entity[] = [];
  public shipName: string = 'Unknown Ship'; // Ship name for display
  public isPlayerControlled: boolean = false;
  public destroyed: boolean = false;
  public lastFireTime: number = 0;
  public fireRate: number = 300; // 300ms between shots = 3.3 shots per second (faster firing)
  public team: number = 0; // Team assignment for combat
  constructor(entityConfigs: EntityConfig[], position: Vector2 = { x: 0, y: 0 }) {
    this.id = Math.random().toString(36).substr(2, 9);

    // Create entities
    this.entities = entityConfigs.map(config => new Entity(config));    // Create root body
    this.rootBody = Matter.Body.create({
      parts: this.entities.map(e => e.body),
      isStatic: false,
      frictionAir: 0.01, // Small air resistance to prevent runaway acceleration
      friction: 0.001 // Minimal friction for surface contact
    });

    // Set position
    Matter.Body.setPosition(this.rootBody, position);

    // Store reference to this assembly in the body
    this.rootBody.assembly = this;
  } public update(): void {
    if (this.destroyed) return;

    // Update visual effects for all entities
    this.entities.forEach(entity => {
      entity.updateVisualEffects(16); // Assuming ~60fps, 16ms per frame
    });

    // Check if we still have a control center
    const hasControlCenter = this.entities.some(e => e.isControlCenter());

    // Remove destroyed entities and rebuild if needed
    const activeEntities = this.entities.filter(e => !e.destroyed);

    if (activeEntities.length !== this.entities.length) {
      // Some entities were destroyed - we need to rebuild completely
      this.entities = activeEntities;

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

    const engines = this.entities.filter(e => e.canProvideThrust());
    if (engines.length === 0) return;

    // Calculate thrust magnitude for visual effects
    const thrustMagnitude = Math.sqrt(thrustInput.x * thrustInput.x + thrustInput.y * thrustInput.y);

    // Debug logging
    if (thrustMagnitude > 0) {
      console.log(`🚀 Thrust Input: x=${thrustInput.x.toFixed(2)}, y=${thrustInput.y.toFixed(2)}, engines=${engines.length}`);
    }    // SIMPLIFIED: Apply thrust directly in ship-local coordinates
    engines.forEach((engine) => {
      // Get engine thrust values
      const engineThrust = this.getEngineThrust(engine.type);

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
  }  public applyTorque(torqueInput: number): void {
    if (this.destroyed) return;

    // Balanced rotation using Matter.js angular velocity
    const currentAngularVelocity = this.rootBody.angularVelocity;
    const maxAngularVelocity = 0.02; // Reduced from 0.1 to 0.02 (much more reasonable)

    const desiredAngularVelocity = torqueInput * maxAngularVelocity;
    const dampening = 0.15; // Reduced from 0.3 to 0.15 (less twitchy)

    const newAngularVelocity = currentAngularVelocity +
      (desiredAngularVelocity - currentAngularVelocity) * dampening;

    Matter.Body.setAngularVelocity(this.rootBody, newAngularVelocity);
  }public fireWeapons(targetAngle?: number): Matter.Body[] {
    if (this.destroyed) return [];

    const currentTime = Date.now();

    // Enforce firing rate limit
    if (currentTime - this.lastFireTime < this.fireRate) {
      return []; // Can't fire yet, return empty array
    }

    const weapons = this.entities.filter(e => e.canFire());
    const lasers: Matter.Body[] = [];

    weapons.forEach(weapon => {
      // Trigger visual firing effect
      weapon.triggerWeaponFire();

      const laser = this.createLaser(weapon, targetAngle);
      if (laser) {
        lasers.push(laser);
      }
    });

    // Update last fire time to current time
    this.lastFireTime = currentTime;

    return lasers;
  } private createLaser(weapon: Entity, targetAngle?: number): Matter.Body | null {
    // Calculate laser spawn position and direction
    const weaponWorldPos = weapon.body.position;
    const assemblyAngle = this.rootBody.angle;
    const weaponLocalAngle = weapon.rotation * Math.PI / 180;

    // Use target angle if provided, otherwise use weapon's natural direction
    const firingAngle = targetAngle !== undefined ? targetAngle : assemblyAngle + weaponLocalAngle;

    // Configure laser properties based on weapon type - 10x faster speeds
    let laserWidth = 20; // Length of the laser
    let laserHeight = 4; // Thickness of the laser
    let laserSpeed = 250; // 10x faster than before (was 25)
    let spawnDistance = 20; // Much closer to weapon for accurate positioning
    let laserColor = '#00ffff'; // Default cyan

    switch (weapon.type) {
      case 'Gun':
        laserSpeed = 250; // 10x faster (was 25)
        spawnDistance = 20; // Closer to weapon (was 120)
        break;
      case 'LargeGun':
        laserWidth = 30;
        laserHeight = 6;
        laserSpeed = 280; // 10x faster (was 28)
        spawnDistance = 25; // Closer to weapon (was 150)
        laserColor = '#ff6600'; // Orange for large guns
        break;
      case 'CapitalWeapon':
        laserWidth = 50;
        laserHeight = 10;
        laserSpeed = 300; // 10x faster (was 30)
        spawnDistance = 30; // Closer to weapon (was 200)
        laserColor = '#ff0000'; // Red for capital weapons
        break;
    }

    // Spawn laser much closer to the weapon for accurate positioning
    const spawnX = weaponWorldPos.x + Math.cos(firingAngle) * spawnDistance;
    const spawnY = weaponWorldPos.y + Math.sin(firingAngle) * spawnDistance;// Create rectangular laser body
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
    Matter.Body.rotate(laser, firingAngle);    // Set laser velocity using the firing angle, inheriting ship's velocity
    const shipVelocity = this.rootBody.velocity;
    const velocity = {
      x: Math.cos(firingAngle) * laserSpeed + shipVelocity.x,
      y: Math.sin(firingAngle) * laserSpeed + shipVelocity.y
    };

    Matter.Body.setVelocity(laser, velocity);    // Mark as bullet for collision detection and store the source assembly ID
    laser.isBullet = true;
    laser.timeToLive = Date.now() + 5000; // 5 seconds from now (longer since lasers are faster)
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
    const currentAngle = this.rootBody.angle; // Store the rotation angle
    const wasPlayerControlled = this.isPlayerControlled;

    // Remove the destroyed entity
    this.entities.splice(entityIndex, 1);

    if (this.entities.length === 0) {
      this.destroy();
      return [];
    }

    // Mark this assembly as destroyed so it gets cleaned up properly
    this.destroyed = true;
    // Find connected components from remaining entities
    const components = this.findConnectedComponents();

    // Create completely new assemblies for each component
    const newAssemblies: Assembly[] = [];

    components.forEach((component) => {
      const newAssembly = this.createNewAssemblyFromComponent(
        component,
        currentPosition,
        currentVelocity,
        currentAngularVelocity,
        currentAngle
      );
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
    this.entities = newEntities;    // Create new root body
    this.rootBody = Matter.Body.create({
      parts: this.entities.map(e => e.body),
      isStatic: false,
      frictionAir: 0.01, // Small air resistance to prevent runaway acceleration
      friction: 0.001 // Minimal friction for surface contact
    });

    // Restore position
    Matter.Body.setPosition(this.rootBody, currentPosition);

    // Store reference
    this.rootBody.assembly = this;
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

    console.log(`🔧 Creating new assembly at (${newPosition.x}, ${newPosition.y}) with ${component.length} parts`); const newAssembly = new Assembly(configs, newPosition);
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

    console.log(`🔍 Finding connected components for ${this.entities.length} entities`);

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
        console.log(`📦 Found component with ${component.length} entities: ${component.map(e => e.type).join(', ')}`);
      }
    });

    console.log(`🔧 Total components found: ${components.length}`);
    return components;
  } private areEntitiesConnected(entity1: Entity, entity2: Entity): boolean {
    // Use the updated adjacency function from BlockSystem that handles different block sizes
    const result = areEntitiesAdjacent(
      { type: entity1.type, x: entity1.localOffset.x, y: entity1.localOffset.y },
      { type: entity2.type, x: entity2.localOffset.x, y: entity2.localOffset.y }
    );

    // Debug logging to understand connectivity
    console.log(`🔗 Checking connection: ${entity1.type}(${entity1.localOffset.x},${entity1.localOffset.y}) -> ${entity2.type}(${entity2.localOffset.x},${entity2.localOffset.y}) = ${result}`);

    return result;
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
}

// Extend Matter.js Body type to include our assembly reference
declare module 'matter-js' {
  interface Body {
    assembly?: Assembly;
    isBullet?: boolean;
    timeToLive?: number;
  }
}
