import * as Matter from 'matter-js';
import { EntityConfig, EntityType, ENTITY_DEFINITIONS, Vector2, GRID_SIZE, AttachmentConnection } from '../../types/GameTypes';

export class Entity {
  public id: string;
  public type: EntityType;
  public health: number;
  public maxHealth: number;
  public body: Matter.Body; public destroyed: boolean = false;
  public localOffset: { x: number; y: number };
  public rotation: number; public flashTimer: number = 0;
  public isFlashing: boolean = false;
  private originalFillStyle: string = '';  // New properties for visual effects
  public thrustLevel: number = 0; // 0-1, how much thrust is being applied
  public isFiring: boolean = false;
  public fireFlashTimer: number = 0;
  public thrustParticles: Array<{ x: number, y: number, age: number, maxAge: number }> = [];
  private readonly MAX_PARTICLES = 4; // Reduced from 8

  // Invulnerability system
  public invulnerableUntil: number = 0; // Timestamp when invulnerability ends
  public isInvulnerable: boolean = false;

  // Weapon aiming state for smooth turret rotation
  public currentAimAngle: number = 0; // Current turret angle relative to weapon's natural direction
  public targetAimAngle: number = 0; // Desired turret angle
  public aimRotationSpeed: number = 0.005; // Radians per second rotation speed - extremely slow for testing

  // Connection tracking system
  public attachmentConnections: AttachmentConnection[] = [];

  // Side-based connection tracking - what entity is attached to each logical side
  public northConnection: string | null = null;
  public southConnection: string | null = null;
  public eastConnection: string | null = null;
  public westConnection: string | null = null;

  constructor(config: EntityConfig) {
    this.id = Math.random().toString(36).substr(2, 9);
    this.type = config.type;
    this.localOffset = { x: config.x, y: config.y };
    this.rotation = config.rotation;

    const definition = ENTITY_DEFINITIONS[this.type];
    if (!definition) {
      throw new Error(`Unknown entity type: ${this.type}`);
    }

    // Initialize connection tracking for each attachment point
    this.attachmentConnections = definition.attachmentPoints.map(() => ({
      connectedEntity: null,
      attachmentPointIndex: -1
    }));

    this.maxHealth = config.maxHealth || definition.defaultHealth;
    this.health = config.health || this.maxHealth;

    // Debug logging for cockpits
    if (this.type === 'Cockpit' || this.type === 'LargeCockpit' || this.type === 'CapitalCore') {
      console.log(`🛡️ Created ${this.type} with health: ${this.health}/${this.maxHealth} (default: ${definition.defaultHealth})`);
    }    // Create Matter.js body at exact position with enhanced physics and visual styling
    this.body = Matter.Bodies.rectangle(
      config.x,
      config.y,
      definition.width,
      definition.height,
      {
        mass: definition.mass,
        frictionAir: 0, // No air resistance in space
        friction: 0, // No surface friction in space
        restitution: 0.2, // Low bounce - space debris doesn't bounce much
        inertia: definition.mass * (definition.width * definition.width + definition.height * definition.height) / 12, // Realistic rotational inertia
        render: {
          fillStyle: this.getSolidHullColor(this.type), // Solid grey hull colors
          strokeStyle: this.getHullStrokeColor(this.type), // Darker grey borders for depth
          lineWidth: 3 // Moderate border thickness for solid appearance
        }
      }
    );

    // Store reference to this entity in the body
    this.body.entity = this;

    // Apply rotation
    if (this.rotation !== 0) {
      Matter.Body.rotate(this.body, (this.rotation * Math.PI) / 180);
    }
  } public takeDamage(damage: number): boolean {
    if (this.destroyed) return false;

    // Check invulnerability
    const currentTime = Date.now();
    if (this.isInvulnerable && currentTime < this.invulnerableUntil) {
      console.log(`🛡️ ${this.type} is invulnerable, damage blocked`);
      return false;
    }

    // Clear invulnerability if time has passed
    if (currentTime >= this.invulnerableUntil) {
      this.isInvulnerable = false;
    }

    this.health -= damage;

    // Update visual feedback based on health
    if (!this.isFlashing) {
      this.updateVisualState();
    }

    if (this.health <= 0) {
      this.destroy();
      return true;
    }

    return false;
  }  public destroy(): void {
    this.destroyed = true;
    this.health = 0;
    this.isFlashing = false; // Stop any flashing
    
    // Make destroyed entities completely invisible
    if (this.body.render) {
      this.body.render.fillStyle = 'transparent';
      this.body.render.strokeStyle = 'transparent';
      this.body.render.visible = false;
    }
    
    console.log(`💀 Entity ${this.type} destroyed and made invisible`);
  }

  /**
   * Remove this entity's physics body from the Matter.js world
   * This should be called by the Assembly when the entity is being removed
   */
  public removeFromWorld(world: Matter.World): void {
    if (this.body) {
      Matter.World.remove(world, this.body);
      console.log(`🗑️ Entity ${this.type} body removed from physics world`);
    }
  }public canFire(): boolean {
    // Traditional weapons
    if ((this.type === 'Gun' || this.type === 'LargeGun' || this.type === 'CapitalWeapon') && !this.destroyed) {
      return true;
    }

    // Missile launchers
    if ((this.type === 'MissileLauncher' || this.type === 'LargeMissileLauncher' || this.type === 'CapitalMissileLauncher') && !this.destroyed) {
      return true;
    }

    // Cockpit weapons - can fire if nothing is connected on top
    if ((this.type === 'Cockpit' || this.type === 'LargeCockpit' || this.type === 'CapitalCore') && !this.destroyed) {
      return this.canUseCockpitWeapon();
    }

    return false;
  }

  public isMissileLauncher(): boolean {
    return this.type === 'MissileLauncher' ||
      this.type === 'LargeMissileLauncher' ||
      this.type === 'CapitalMissileLauncher';
  }

  public canProvideThrust(): boolean {
    // Traditional engines
    if ((this.type === 'Engine' || this.type === 'LargeEngine' || this.type === 'CapitalEngine') && !this.destroyed) {
      return true;
    }    // Cockpit engines - can provide thrust if nothing is connected on bottom/south
    if ((this.type === 'Cockpit' || this.type === 'LargeCockpit' || this.type === 'CapitalCore') && !this.destroyed) {
      return this.canUseCockpitEngine();
    }

    return false;  }

  /**
   * Check if cockpit can use its built-in weapon (nothing connected on north side)
   */
  private canUseCockpitWeapon(): boolean {
    // Simple check: iterate through attachment connections and see if any north-side attachment points are connected
    for (let i = 0; i < this.attachmentConnections.length; i++) {
      const connection = this.attachmentConnections[i];
      if (connection.connectedEntity !== null) {
        const side = this.getLogicalSideForAttachmentPoint(i);
        if (side === 'north') {
          return false; // Something is connected on the north side
        }
      }
    }
    
    return true; // No north connections found
  }
  /**
   * Check if cockpit can use its built-in engine (nothing connected on south side)
   */
  private canUseCockpitEngine(): boolean {
    // Simple check: iterate through attachment connections and see if any south-side attachment points are connected
    for (let i = 0; i < this.attachmentConnections.length; i++) {
      const connection = this.attachmentConnections[i];
      if (connection.connectedEntity !== null) {
        const side = this.getLogicalSideForAttachmentPoint(i);
        if (side === 'south') {
          return false; // Something is connected on the south side
        }
      }
    }
    
    return true; // No south connections found
  }

  /**
   * Transform a local attachment point to world coordinates, accounting for rotation
   */
  private transformAttachmentPointToWorld(localPoint: Vector2): Vector2 {
    const worldPos = this.body.position;
    const angle = this.body.angle;
    
    // Apply rotation transformation
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    const scaledLocalX = localPoint.x * GRID_SIZE;
    const scaledLocalY = localPoint.y * GRID_SIZE;
    
    return {
      x: worldPos.x + (scaledLocalX * cos - scaledLocalY * sin),
      y: worldPos.y + (scaledLocalX * sin + scaledLocalY * cos)
    };
  }  /**
   * Get all attachment points in world coordinates for this entity
   */
  public getWorldAttachmentPoints(): Vector2[] {
    const definition = ENTITY_DEFINITIONS[this.type];
    if (!definition) return [];
    
    return definition.attachmentPoints.map(point => 
      this.transformAttachmentPointToWorld(point)
    );
  }

  private interpolateColor(color1: string, color2: string, factor: number): string {
    // Simple color interpolation for damage visualization
    const c1 = this.hexToRgb(color1);
    const c2 = this.hexToRgb(color2);

    if (!c1 || !c2) return color1;

    const r = Math.round(c1.r + (c2.r - c1.r) * factor);
    const g = Math.round(c1.g + (c2.g - c1.g) * factor);
    const b = Math.round(c1.b + (c2.b - c1.b) * factor);

    return `rgb(${r}, ${g}, ${b})`;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }


  private getSolidHullColor(entityType: EntityType): string {
    // Return solid grey colors for different entity types to make ships look more realistic
    switch (entityType) {
      case 'Hull':
      case 'HeavyHull':
      case 'MegaHull':
        return '#707070'; // Medium grey for basic hull
      
      case 'Cockpit':
      case 'LargeCockpit':
      case 'CapitalCore':
        return '#808080'; // Slightly lighter grey for cockpits
      
      case 'Engine':
      case 'LargeEngine':
      case 'CapitalEngine':
        return '#606060'; // Darker grey for engines
      
      case 'Gun':
      case 'LargeGun':
      case 'CapitalWeapon':
      case 'MissileLauncher':
      case 'LargeMissileLauncher':
      case 'CapitalMissileLauncher':
        return '#656565'; // Dark grey for weapons
      
      case 'PowerCell':
      case 'LargePowerCell':
      case 'PowerReactor':
        return '#757575'; // Medium-light grey for power systems
      
      default:
        return '#707070'; // Default medium grey
    }
  }

  private getHullStrokeColor(entityType: EntityType): string {
    // Return darker stroke colors for depth and definition
    switch (entityType) {
      case 'Hull':
      case 'HeavyHull':
      case 'MegaHull':
        return '#404040'; // Dark grey stroke for hull
      
      case 'Cockpit':
      case 'LargeCockpit':
      case 'CapitalCore':
        return '#505050'; // Medium-dark grey for cockpits
      
      case 'Engine':
      case 'LargeEngine':
      case 'CapitalEngine':
        return '#303030'; // Very dark grey for engines
      
      case 'Gun':
      case 'LargeGun':
      case 'CapitalWeapon':
      case 'MissileLauncher':
      case 'LargeMissileLauncher':
      case 'CapitalMissileLauncher':
        return '#353535'; // Dark grey for weapons
      
      case 'PowerCell':
      case 'LargePowerCell':
      case 'PowerReactor':
        return '#454545'; // Medium-dark grey for power systems
      
      default:
        return '#404040'; // Default dark grey stroke
    }
  }  public triggerCollisionFlash(): void {
    this.isFlashing = true;
    this.flashTimer = 200; // Reduced flash duration (200ms instead of 400ms)
    // Store original colors if not already stored
    if (!this.originalFillStyle) {
      this.originalFillStyle = this.body.render.fillStyle || '';
    }

    // Set solid flash colors for better visibility
    this.body.render.fillStyle = '#ffffff'; // Solid white flash
    this.body.render.strokeStyle = '#88ccff'; // Softer cyan border
    this.body.render.lineWidth = 5; // Moderate border during flash
  }  public updateFlash(deltaTime: number): void {
    if (!this.isFlashing) return;

    this.flashTimer -= deltaTime;

    if (this.flashTimer <= 0) {
      // Flash finished, restore original colors
      this.isFlashing = false;
      this.flashTimer = 0;

      // Restore colors based on current health state
      this.updateVisualState();
    } else {
      // Create pulsing effect during flash with solid colors
      const flashIntensity = Math.sin((200 - this.flashTimer) * 0.05) * 0.3 + 0.7;
      
      // Solid color transitions for better visibility
      const cyclePosition = (200 - this.flashTimer) * 0.008;
      const colorMix = Math.sin(cyclePosition) * 0.3 + 0.7;

      if (colorMix > 0.5) {
        this.body.render.fillStyle = '#ffffff'; // Solid white
        this.body.render.strokeStyle = '#00ccff';
      } else {
        this.body.render.fillStyle = '#cccccc'; // Light grey
        this.body.render.strokeStyle = '#0088cc';
      }      // Pulsing border thickness
      this.body.render.lineWidth = 4 + Math.round(flashIntensity * 3);
    }
  }
  private updateVisualState(): void {
    // Don't update visual state if currently flashing - let flash logic handle it
    if (this.isFlashing) return;
    
    const healthRatio = this.health / this.maxHealth;
    
    // Start with solid hull colors
    let fillColor = this.getSolidHullColor(this.type);
    let strokeColor = this.getHullStrokeColor(this.type);
    let lineWidth = 3;

    // Apply engine thrust effects - make VERY obvious with directional indicators
    if (this.canProvideThrust() && this.thrustLevel > 0) {
      const thrustIntensity = this.thrustLevel;

      // Make engines EXTREMELY bright when thrusting
      fillColor = '#ffff00'; // Bright yellow fill
      strokeColor = '#ff6600'; // Orange stroke
      lineWidth = 6 + Math.round(thrustIntensity * 6); // Thick border when thrusting

      // Add directional thrust indicator by modifying the stroke pattern
      // We'll make the "exhaust" side much brighter
      if (this.rotation === 180) { // Engine pointing backward (standard)
        strokeColor = '#ff0000'; // Red exhaust side
      } else if (this.rotation === 0) { // Engine pointing forward  
        strokeColor = '#00ff00'; // Green exhaust side
      } else if (this.rotation === 90) { // Engine pointing right
        strokeColor = '#0000ff'; // Blue exhaust side
      } else if (this.rotation === 270) { // Engine pointing left
        strokeColor = '#ff00ff'; // Magenta exhaust side
      }
    }

    // Apply weapon firing effects
    if (this.canFire() && this.isFiring) {
      fillColor = '#ffff00'; // Bright yellow flash
      strokeColor = '#ffffff'; // White border
      lineWidth = 6;
    }

    // Apply cockpit weapon effects when firing
    if (this.isControlCenter() && this.canFire() && this.isFiring) {
      fillColor = '#ff8800'; // Orange flash for cockpit weapon
      strokeColor = '#ffffff'; // White border
      lineWidth = 6;
    }

    // Apply cockpit engine effects when thrusting
    if (this.isControlCenter() && this.canProvideThrust() && this.thrustLevel > 0) {
      const thrustIntensity = this.thrustLevel;

      // Cockpit engines get a different color scheme
      fillColor = '#88ff88'; // Light green for cockpit thrust
      strokeColor = '#44ff44'; // Bright green stroke
      lineWidth = 5 + Math.round(thrustIntensity * 3);
    }

    // Apply health-based damage coloring - keep hull solid but show damage
    if (this.destroyed) {
      this.body.render.fillStyle = '#330000'; // Dark red solid for destroyed parts
      this.body.render.strokeStyle = '#ff0000'; // Red border
      this.body.render.lineWidth = 3;
    } else if (healthRatio > 0.75) {
      this.body.render.fillStyle = fillColor; // Use solid hull colors
      this.body.render.strokeStyle = strokeColor;
      this.body.render.lineWidth = lineWidth;
    } else if (healthRatio > 0.5) {
      // Lightly damaged - mix in some brown/rust
      const damagedColor = this.interpolateColor(fillColor, '#8B4513', (1 - healthRatio) * 2);
      this.body.render.fillStyle = damagedColor;
      this.body.render.strokeStyle = '#654321'; // Brown stroke
      this.body.render.lineWidth = lineWidth + 1;
    } else if (healthRatio > 0.25) {
      // Moderately damaged - more brown/rust
      const damagedColor = this.interpolateColor('#8B4513', '#A0522D', (0.5 - healthRatio) * 4);
      this.body.render.fillStyle = damagedColor;
      this.body.render.strokeStyle = '#8B4513'; // Dark brown stroke
      this.body.render.lineWidth = lineWidth + 1;
    } else if (healthRatio > 0) {
      // Heavily damaged - dark red but still solid
      this.body.render.fillStyle = '#800000'; // Dark red solid
      this.body.render.strokeStyle = '#FF0000'; // Bright red stroke
      this.body.render.lineWidth = lineWidth + 2;
    }
  }

  public setThrustLevel(level: number): void {
    this.thrustLevel = Math.max(0, Math.min(1, level)); // Clamp 0-1

    // Generate thrust particles if this is an engine
    if (this.canProvideThrust() && level > 0.1) {
      this.generateThrustParticles();
    }
  }
  private generateThrustParticles(): void {
    // Add new particles if we have room (reduced number)
    if (this.thrustParticles.length < Math.floor(this.MAX_PARTICLES * 0.5)) { // 50% fewer particles
      // Generate particles behind the engine
      const engineAngle = this.body.angle + (this.rotation * Math.PI / 180);
      const exhaustDistance = 15 + Math.random() * 10; // Reduced distance

      // Particles spawn behind the engine
      const particleX = this.body.position.x - Math.cos(engineAngle) * exhaustDistance;
      const particleY = this.body.position.y - Math.sin(engineAngle) * exhaustDistance;

      this.thrustParticles.push({
        x: particleX + (Math.random() - 0.5) * 6, // Reduced spread
        y: particleY + (Math.random() - 0.5) * 6,
        age: 0,
        maxAge: 200 + Math.random() * 100 // Shorter lifetime (0.2-0.3 seconds)
      });
    }
  }
  public triggerWeaponFire(): void {
    this.isFiring = true;
    this.fireFlashTimer = 100; // Reduced flash duration (100ms instead of 200ms)
  }
  public updateVisualEffects(deltaTime: number): void {
    // Update weapon fire flash
    if (this.fireFlashTimer > 0) {
      this.fireFlashTimer -= deltaTime;
      if (this.fireFlashTimer <= 0) {
        this.isFiring = false;
      }
    }

    // Update weapon aiming rotation smoothly
    this.updateWeaponAiming(deltaTime);

    // Update thrust particles
    this.updateThrustParticles(deltaTime);

    // Update thrust and visual state
    this.updateFlash(deltaTime);
    this.updateVisualState();
  }
  private updateThrustParticles(deltaTime: number): void {
    if (this.destroyed || this.thrustLevel <= 0) {
      // Clear particles if destroyed or no thrust
      this.thrustParticles = [];
      return;
    }

    // Add new particle less frequently
    if (this.thrustParticles.length < Math.floor(this.MAX_PARTICLES * 0.5) && Math.random() < 0.7) { // 70% chance instead of 100%
      this.thrustParticles.push({
        x: this.body.position.x,
        y: this.body.position.y,
        age: 0,
        maxAge: 80 + Math.random() * 60 // Shorter lifetime (80-140ms)
      });
    }

    // Update existing particles
    for (let i = 0; i < this.thrustParticles.length; i++) {
      const particle = this.thrustParticles[i];
      particle.age += deltaTime;

      // Remove old particles
      if (particle.age > particle.maxAge) {
        this.thrustParticles.splice(i, 1);
        i--;
      }
    }
  }
  // Draw custom thrust effects
  public drawThrustEffects(ctx: CanvasRenderingContext2D): void {
    if (!this.canProvideThrust() || this.thrustLevel <= 0) return;

    const thrustIntensity = this.thrustLevel * 0.6; // Reduced intensity
    const pos = this.body.position;
    const engineAngle = this.body.angle + (this.rotation * Math.PI / 180);

    // Calculate exhaust position (behind the engine) - smaller effect
    const exhaustDistance = 15 + thrustIntensity * 8; // Reduced from 20 + 15
    const exhaustX = pos.x - Math.cos(engineAngle) * exhaustDistance;
    const exhaustY = pos.y - Math.sin(engineAngle) * exhaustDistance;

    // Draw thrust plume
    ctx.save();
    ctx.globalAlpha = thrustIntensity * 0.5; // Reduced opacity

    // Create gradient for thrust plume - more subtle
    const gradient = ctx.createRadialGradient(
      pos.x, pos.y, 1,
      exhaustX, exhaustY, exhaustDistance * 0.8
    );
    gradient.addColorStop(0, '#ffaa00'); // Less bright yellow
    gradient.addColorStop(0.5, '#ff4400'); // Less bright orange 
    gradient.addColorStop(1, 'rgba(255, 100, 0, 0)'); // Transparent orange at end

    ctx.fillStyle = gradient;
    ctx.beginPath();

    // Draw smaller triangular plume
    const plumeWidth = 4 + thrustIntensity * 2; // Reduced from 8 + 4
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(
      exhaustX - Math.sin(engineAngle) * plumeWidth,
      exhaustY + Math.cos(engineAngle) * plumeWidth
    );
    ctx.lineTo(
      exhaustX + Math.sin(engineAngle) * plumeWidth,
      exhaustY - Math.cos(engineAngle) * plumeWidth
    );
    ctx.closePath();
    ctx.fill();

    // Remove the directional arrow - it was too prominent
    ctx.restore();
  }

  public isControlCenter(): boolean {
    return (this.type === 'Cockpit' || this.type === 'LargeCockpit' || this.type === 'CapitalCore') && !this.destroyed;
  }
  private updateWeaponAiming(deltaTime: number): void {
    // Only update aiming for weapons
    if (!this.canFire()) return;

    // Smoothly rotate current aim angle toward target aim angle
    let angleDiff = this.targetAimAngle - this.currentAimAngle;

    // Normalize angle difference
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;    // Apply rotation at limited speed for mechanical feel
    const maxRotationThisFrame = this.aimRotationSpeed * deltaTime;

    if (Math.abs(angleDiff) <= maxRotationThisFrame) {
      // Close enough, snap to target
      this.currentAimAngle = this.targetAimAngle;
    } else {
      // Rotate toward target at limited speed
      if (angleDiff > 0) {
        this.currentAimAngle += maxRotationThisFrame;
      } else {
        this.currentAimAngle -= maxRotationThisFrame;
      }
    }

    // Keep current angle in reasonable range
    while (this.currentAimAngle > Math.PI) this.currentAimAngle -= 2 * Math.PI;
    while (this.currentAimAngle < -Math.PI) this.currentAimAngle += 2 * Math.PI;
  }

  public setTargetAimAngle(angle: number): void {
    this.targetAimAngle = angle;
  }

  public getCurrentFiringAngle(assemblyAngle: number): number {
    const weaponLocalAngle = this.rotation * Math.PI / 180;
    const weaponNaturalAngle = assemblyAngle + weaponLocalAngle;
    return weaponNaturalAngle + this.currentAimAngle;
  }

  public setInvulnerable(durationMs: number): void {
    this.isInvulnerable = true;
    this.invulnerableUntil = Date.now() + durationMs;
    console.log(`🛡️ ${this.type} is now invulnerable for ${durationMs}ms`);
  }
  /**
   * Connect this entity to another entity at specific attachment points
   */
  public connectTo(otherEntity: Entity, myAttachmentIndex: number, theirAttachmentIndex: number): void {
    // Set my connection
    this.attachmentConnections[myAttachmentIndex] = {
      connectedEntity: otherEntity.id,
      attachmentPointIndex: theirAttachmentIndex
    };

    // Set their connection
    otherEntity.attachmentConnections[theirAttachmentIndex] = {
      connectedEntity: this.id,
      attachmentPointIndex: myAttachmentIndex
    };
  }

  /**
   * Disconnect from an entity
   */
  public disconnectFrom(otherEntity: Entity): void {
    // Clear connections to this entity
    this.attachmentConnections.forEach(connection => {
      if (connection.connectedEntity === otherEntity.id) {
        connection.connectedEntity = null;
        connection.attachmentPointIndex = -1;
      }
    });

    // Clear their connections to this entity
    otherEntity.attachmentConnections.forEach(connection => {
      if (connection.connectedEntity === this.id) {
        connection.connectedEntity = null;
        connection.attachmentPointIndex = -1;
      }
    });
  }

  /**
   * Set what entity is connected to a specific side
   */
  public setConnectionOnSide(side: 'north' | 'south' | 'east' | 'west', entityId: string | null): void {
    switch (side) {
      case 'north': this.northConnection = entityId; break;
      case 'south': this.southConnection = entityId; break;
      case 'east': this.eastConnection = entityId; break;
      case 'west': this.westConnection = entityId; break;
    }
  }

  /**
   * Get the entity ID connected to a specific side
   */
  public getConnectionOnSide(side: 'north' | 'south' | 'east' | 'west'): string | null {
    switch (side) {
      case 'north': return this.northConnection;
      case 'south': return this.southConnection;
      case 'east': return this.eastConnection;
      case 'west': return this.westConnection;
      default: return null;
    }
  }

  /**
   * Clear all side-based connections
   */
  public clearAllSideConnections(): void {
    this.northConnection = null;
    this.southConnection = null;
    this.eastConnection = null;
    this.westConnection = null;
  }
  /**
   * Get the logical side of an attachment point considering entity rotation
   */
  public getLogicalSideForAttachmentPoint(attachmentIndex: number): 'north' | 'south' | 'east' | 'west' | null {
    const definition = ENTITY_DEFINITIONS[this.type];
    if (!definition || attachmentIndex >= definition.attachmentPoints.length) return null;
    
    const point = definition.attachmentPoints[attachmentIndex];
    
    // Determine the original side based on coordinates
    let originalSide: 'north' | 'south' | 'east' | 'west';
    if (point.y < 0) originalSide = 'north';
    else if (point.y > 0) originalSide = 'south';
    else if (point.x > 0) originalSide = 'east';
    else if (point.x < 0) originalSide = 'west';
    else return null; // Center point, no side
    
    // Apply rotation to determine current logical side
    const rotationSteps = (this.rotation / 90) % 4;
    const sides: ('north' | 'south' | 'east' | 'west')[] = ['north', 'east', 'south', 'west'];
    const originalIndex = sides.indexOf(originalSide);
    const currentIndex = (originalIndex + rotationSteps) % 4;
    
    return sides[currentIndex];
  }
  /**
   * Check if a specific logical side has any connections
   */
  public hasConnectionOnSide(side: 'north' | 'south' | 'east' | 'west'): boolean {
    return this.getConnectionOnSide(side) !== null;
  }

  /**
   * Get all entities connected to this entity
   */
  public getConnectedEntities(): string[] {
    return this.attachmentConnections
      .filter(connection => connection.connectedEntity !== null)
      .map(connection => connection.connectedEntity!);
  }

  // ...existing methods...
}

// Extend Matter.js Body type to include our entity reference
declare module 'matter-js' {
  interface Body {
    entity?: Entity;
  }
}
