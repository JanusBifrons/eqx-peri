import * as Matter from 'matter-js';
import { Entity } from './Entity';
import { EntityConfig, GRID_SIZE, Vector2 } from '../types/GameTypes';

export class Assembly {
  public id: string;
  public rootBody: Matter.Body;
  public entities: Entity[] = [];
  public isPlayerControlled: boolean = false;
  public destroyed: boolean = false;
  public lastFireTime: number = 0;
  public fireRate: number = 500; // 500ms between shots = 2 shots per second
  constructor(entityConfigs: EntityConfig[], position: Vector2 = { x: 0, y: 0 }) {
    this.id = Math.random().toString(36).substr(2, 9);
    
    // Create entities
    this.entities = entityConfigs.map(config => new Entity(config));    // Create root body
    this.rootBody = Matter.Body.create({
      parts: this.entities.map(e => e.body),
      isStatic: false,
      frictionAir: 0, // No air resistance in space
      friction: 0.001 // Minimal friction for surface contact
    });

    // Set position
    Matter.Body.setPosition(this.rootBody, position);
    
    // Store reference to this assembly in the body
    this.rootBody.assembly = this;
  }
  public update(): void {
    if (this.destroyed) return;

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
  }

  public applyThrust(force: Vector2): void {
    if (this.destroyed) return;
    
    const engines = this.entities.filter(e => e.canProvideThrust());
    if (engines.length === 0) return;

    // Apply thrust from the center of mass
    const forceVector = Matter.Vector.mult(force, engines.length);
    Matter.Body.applyForce(this.rootBody, this.rootBody.position, forceVector);
  }
  public applyTorque(torque: number): void {
    if (this.destroyed) return;
    
    // Apply rotational force
    const targetAngularVelocity = torque * 0.1;
    
    Matter.Body.setAngularVelocity(this.rootBody, targetAngularVelocity);
  }  public fireWeapons(targetAngle?: number): Matter.Body[] {
    if (this.destroyed) return [];
    
    const currentTime = Date.now();
    
    // Enforce firing rate limit
    if (currentTime - this.lastFireTime < this.fireRate) {
      return []; // Can't fire yet, return empty array
    }
    
    const weapons = this.entities.filter(e => e.canFire());
    const lasers: Matter.Body[] = [];
    
    weapons.forEach(weapon => {
      const laser = this.createLaser(weapon, targetAngle);
      if (laser) {
        lasers.push(laser);
      }
    });
    
    // Update last fire time to current time
    this.lastFireTime = currentTime;
    
    return lasers;
  }  private createLaser(weapon: Entity, targetAngle?: number): Matter.Body | null {
    // Calculate laser spawn position and direction
    const weaponWorldPos = weapon.body.position;
    const assemblyAngle = this.rootBody.angle;
    const weaponLocalAngle = weapon.rotation * Math.PI / 180;
    
    // Use target angle if provided, otherwise use weapon's natural direction
    const firingAngle = targetAngle !== undefined ? targetAngle : assemblyAngle + weaponLocalAngle;
    
    // Spawn laser further in front of weapon to avoid self-collision
    const spawnDistance = 40;
    const spawnX = weaponWorldPos.x + Math.cos(firingAngle) * spawnDistance;
    const spawnY = weaponWorldPos.y + Math.sin(firingAngle) * spawnDistance;
    
    // Create rectangular laser body - longer and thinner for laser appearance
    const laserWidth = 20; // Length of the laser
    const laserHeight = 4; // Thickness of the laser
    
    const laser = Matter.Bodies.rectangle(spawnX, spawnY, laserWidth, laserHeight, {
      isSensor: true, // Lasers are sensors - they pass through objects but trigger collision events
      render: {
        fillStyle: '#00ffff', // Cyan laser color
        strokeStyle: '#ffffff',
        lineWidth: 1
      }
    });
    
    // Rotate the laser to match the firing direction
    Matter.Body.rotate(laser, firingAngle);
    
    // Set laser velocity using the firing angle
    const laserSpeed = 10;
    const velocity = {
      x: Math.cos(firingAngle) * laserSpeed,
      y: Math.sin(firingAngle) * laserSpeed
    };
      Matter.Body.setVelocity(laser, velocity);
    
    // Mark as bullet for collision detection (keeping original property name for compatibility)
    laser.isBullet = true;
    laser.timeToLive = Date.now() + 3000; // 3 seconds from now
    
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
    
    components.forEach((component) => {      const newAssembly = this.createNewAssemblyFromComponent(
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
      isStatic: false
    });
    
    // Restore position
    Matter.Body.setPosition(this.rootBody, currentPosition);
    
    // Store reference
    this.rootBody.assembly = this;
  }  private createNewAssemblyFromComponent(component: Entity[], basePosition: Vector2, velocity: Vector2, angularVelocity: number, baseAngle: number): Assembly {
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
    
    console.log(`🔧 Creating new assembly at (${newPosition.x}, ${newPosition.y}) with ${component.length} parts`);    const newAssembly = new Assembly(configs, newPosition);
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
  }
  private findConnectedComponents(): Entity[][] {
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
  }

  private areEntitiesConnected(entity1: Entity, entity2: Entity): boolean {
    const pos1 = entity1.localOffset;
    const pos2 = entity2.localOffset;
    
    // Check if entities are adjacent on the grid - cardinal connections only
    const dx = Math.abs(pos1.x - pos2.x);
    const dy = Math.abs(pos1.y - pos2.y);
    
    return (dx === GRID_SIZE && dy === 0) || (dx === 0 && dy === GRID_SIZE);
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
}

// Extend Matter.js Body type to include our assembly reference
declare module 'matter-js' {
  interface Body {
    assembly?: Assembly;
    isBullet?: boolean;
    timeToLive?: number;
  }
}
