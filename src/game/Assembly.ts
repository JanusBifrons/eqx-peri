import * as Matter from 'matter-js';
import { Entity } from './Entity';
import { EntityConfig, GRID_SIZE, Vector2 } from '../types/GameTypes';

export class Assembly {
  public id: string;
  public rootBody: Matter.Body;
  public entities: Entity[] = [];
  public isPlayerControlled: boolean = false;
  public destroyed: boolean = false;  constructor(entityConfigs: EntityConfig[], position: Vector2 = { x: 0, y: 0 }) {
    this.id = Math.random().toString(36).substr(2, 9);
    
    // Create entities
    this.entities = entityConfigs.map(config => new Entity(config));
      // Create root body
    this.rootBody = Matter.Body.create({
      parts: this.entities.map(e => e.body),
      isStatic: false
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
  }  public fireWeapons(): Matter.Body[] {
    if (this.destroyed) return [];
    
    const weapons = this.entities.filter(e => e.canFire());
    const bullets: Matter.Body[] = [];
    
    weapons.forEach(weapon => {
      const bullet = this.createBullet(weapon);
      if (bullet) {
        bullets.push(bullet);
      }
    });
    
    return bullets;
  }

  private createBullet(weapon: Entity): Matter.Body | null {
    // Calculate bullet spawn position and direction
    const weaponWorldPos = weapon.body.position;
    const assemblyAngle = this.rootBody.angle;
    const weaponLocalAngle = weapon.rotation * Math.PI / 180;
    const totalAngle = assemblyAngle + weaponLocalAngle;
      // Spawn bullet further in front of weapon to avoid self-collision
    const spawnDistance = 40;
    const spawnX = weaponWorldPos.x + Math.cos(totalAngle) * spawnDistance;
    const spawnY = weaponWorldPos.y + Math.sin(totalAngle) * spawnDistance;
    
    // Create bullet body - smaller and faster
    const bullet = Matter.Bodies.circle(spawnX, spawnY, 4, {
      isSensor: false,
      render: {
        fillStyle: '#ffff00',
        strokeStyle: '#ffffff',
        lineWidth: 1
      }
    });
    
    // Set bullet velocity - faster but still visible
    const bulletSpeed = 8;
    const velocity = {
      x: Math.cos(totalAngle) * bulletSpeed,
      y: Math.sin(totalAngle) * bulletSpeed
    };
    
    Matter.Body.setVelocity(bullet, velocity);
    
    // Mark as bullet for collision detection
    bullet.isBullet = true;
    bullet.timeToLive = Date.now() + 3000; // 3 seconds from now
    
    return bullet;
  }  public removeEntity(entity: Entity): Assembly[] {
    const entityIndex = this.entities.findIndex(e => e.id === entity.id);
    if (entityIndex === -1) return [this];
    
    // Store current physics state before destroying
    const currentVelocity = this.rootBody.velocity;
    const currentAngularVelocity = this.rootBody.angularVelocity;
    const currentPosition = this.rootBody.position;
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
        currentAngularVelocity
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
    
    this.entities = newEntities;
      // Create new root body
    this.rootBody = Matter.Body.create({
      parts: this.entities.map(e => e.body),
      isStatic: false
    });
    
    // Restore position
    Matter.Body.setPosition(this.rootBody, currentPosition);
    
    // Store reference
    this.rootBody.assembly = this;
  }
  private createNewAssemblyFromComponent(component: Entity[], basePosition: Vector2, velocity: Vector2, angularVelocity: number): Assembly {
    const configs: EntityConfig[] = component.map(entity => ({
      type: entity.type,
      x: entity.localOffset.x,
      y: entity.localOffset.y,
      rotation: entity.rotation,
      health: entity.health,
      maxHealth: entity.maxHealth
    }));
    
    // Calculate the center offset of this component relative to original assembly
    const avgOffsetX = component.reduce((sum, e) => sum + e.localOffset.x, 0) / component.length;
    const avgOffsetY = component.reduce((sum, e) => sum + e.localOffset.y, 0) / component.length;
    
    // Position the new assembly at the component's world position
    const newPosition = {
      x: basePosition.x + avgOffsetX,
      y: basePosition.y + avgOffsetY
    };
    
    console.log(`🔧 Creating new assembly at (${newPosition.x}, ${newPosition.y}) with ${component.length} parts`);
    
    const newAssembly = new Assembly(configs, newPosition);
    
    // Give it some velocity with slight randomization for separation
    const separationFactor = 2;
    const randomAngle = Math.random() * Math.PI * 2;
    const newVelocity = {
      x: velocity.x + Math.cos(randomAngle) * separationFactor,
      y: velocity.y + Math.sin(randomAngle) * separationFactor
    };
    
    Matter.Body.setVelocity(newAssembly.rootBody, newVelocity);
    Matter.Body.setAngularVelocity(newAssembly.rootBody, angularVelocity * 0.8);
    
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
