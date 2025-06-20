import * as Matter from 'matter-js';
import { EntityType, EntityConfig, ENTITY_DEFINITIONS, Vector2, GRID_SIZE } from '../types/GameTypes';

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

  constructor(config: EntityConfig) {
    this.id = Math.random().toString(36).substr(2, 9);
    this.type = config.type;
    this.localOffset = { x: config.x, y: config.y };
    this.rotation = config.rotation;

    const definition = ENTITY_DEFINITIONS[this.type];
    if (!definition) {
      throw new Error(`Unknown entity type: ${this.type}`);
    } this.maxHealth = config.maxHealth || definition.defaultHealth;
    this.health = config.health || this.maxHealth;

    // Debug logging for cockpits
    if (this.type === 'Cockpit' || this.type === 'LargeCockpit' || this.type === 'CapitalCore') {
      console.log(`🛡️ Created ${this.type} with health: ${this.health}/${this.maxHealth} (default: ${definition.defaultHealth})`);
    }// Create Matter.js body at exact position with enhanced physics and visual styling
    this.body = Matter.Bodies.rectangle(
      config.x,
      config.y,
      definition.width,
      definition.height,
      {
        mass: definition.mass,
        frictionAir: 0.01, // Very small air resistance to dampen spinning debris
        friction: 0, // No surface friction in space
        restitution: 0.2, // Low bounce - space debris doesn't bounce much
        inertia: definition.mass * (definition.width * definition.width + definition.height * definition.height) / 12, // Realistic rotational inertia
        render: {
          fillStyle: this.makeTransparent(definition.color, 0.6), // Semi-transparent background
          strokeStyle: this.brightenColor(definition.color), // Brighter border color
          lineWidth: 5 // Much thicker border for better visibility
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
  }

  public destroy(): void {
    this.destroyed = true;
    this.health = 0;
    this.isFlashing = false; // Stop any flashing
    this.updateVisualState();
  } public canFire(): boolean {
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
    }

    // Cockpit engines - can provide thrust if nothing is connected on top
    if ((this.type === 'Cockpit' || this.type === 'LargeCockpit' || this.type === 'CapitalCore') && !this.destroyed) {
      return this.canUseCockpitEngine();
    }

    return false;
  }
  /**
   * Check if cockpit can use its built-in weapon (nothing connected on top/north)
   */
  private canUseCockpitWeapon(): boolean {
    if (!this.body.assembly) {
      console.log(`🔍 canUseCockpitWeapon: No assembly reference for ${this.type}`);
      return false;
    }

    const hasNorthConnection = this.hasConnectionOnSide('north');
    console.log(`🔍 ${this.type} canUseCockpitWeapon: assembly entities=${this.body.assembly.entities.length}, hasNorthConnection=${hasNorthConnection}`);
    
    // Check if there's anything connected on the top (north) attachment point
    return !hasNorthConnection;
  }

  /**
   * Check if cockpit can use its built-in engine (nothing connected on bottom/south) 
   */
  private canUseCockpitEngine(): boolean {
    if (!this.body.assembly) {
      console.log(`🔍 canUseCockpitEngine: No assembly reference for ${this.type}`);
      return false;
    }

    const hasSouthConnection = this.hasConnectionOnSide('south');
    console.log(`🔍 ${this.type} canUseCockpitEngine: assembly entities=${this.body.assembly.entities.length}, hasSouthConnection=${hasSouthConnection}`);
    
    // Check if there's anything connected on the bottom (south) attachment point
    return !hasSouthConnection;
  }
  /**
   * Check if there's a connection on a specific side of this entity using attachment points
   * This is a more robust system that uses the defined attachment points rather than distance
   */
  private hasConnectionOnSide(side: 'north' | 'south' | 'east' | 'west'): boolean {
    if (!this.body.assembly) return false;

    const assembly = this.body.assembly;
    const myDefinition = ENTITY_DEFINITIONS[this.type];
    if (!myDefinition) return false;

    // Get my attachment points for the specified side
    const myAttachmentPoints = this.getAttachmentPointsForSide(side);
    if (myAttachmentPoints.length === 0) return false;

    // Convert my attachment points to world coordinates
    const myWorldPos = this.body.position;
    const myWorldAttachmentPoints = myAttachmentPoints.map(point => ({
      x: myWorldPos.x + point.x * GRID_SIZE,
      y: myWorldPos.y + point.y * GRID_SIZE
    }));

    // Check all other entities in the assembly
    for (const otherEntity of assembly.entities) {
      if (otherEntity.id === this.id) continue;

      const otherDefinition = ENTITY_DEFINITIONS[otherEntity.type];
      if (!otherDefinition) continue;

      // Get all attachment points of the other entity
      const otherEntityPos = otherEntity.body.position;
      const otherWorldAttachmentPoints = otherDefinition.attachmentPoints.map(point => ({
        x: otherEntityPos.x + point.x * GRID_SIZE,
        y: otherEntityPos.y + point.y * GRID_SIZE
      }));

      // Check if any of my side's attachment points align with any of the other entity's attachment points
      for (const myPoint of myWorldAttachmentPoints) {
        for (const otherPoint of otherWorldAttachmentPoints) {
          const distance = Math.sqrt(
            Math.pow(myPoint.x - otherPoint.x, 2) +
            Math.pow(myPoint.y - otherPoint.y, 2)
          );

          // If attachment points are very close (within 2 pixels), they're connected
          if (distance < 2) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Get attachment points for a specific side of this entity
   */
  private getAttachmentPointsForSide(side: 'north' | 'south' | 'east' | 'west'): Vector2[] {
    const definition = ENTITY_DEFINITIONS[this.type];
    if (!definition) return [];

    return definition.attachmentPoints.filter(point => {
      switch (side) {
        case 'north': // Top - negative Y
          return point.y < 0;
        case 'south': // Bottom - positive Y
          return point.y > 0;
        case 'east': // Right - positive X
          return point.x > 0;
        case 'west': // Left - negative X
          return point.x < 0;
        default:
          return false;
      }
    });
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

  private makeTransparent(color: string, alpha: number): string {
    // Convert hex color to rgba with transparency
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private brightenColor(color: string, factor: number = 0.3): string {
    // Convert hex to RGB and brighten
    const hex = color.replace('#', '');
    const r = Math.min(255, parseInt(hex.substr(0, 2), 16) + Math.round(255 * factor));
    const g = Math.min(255, parseInt(hex.substr(2, 2), 16) + Math.round(255 * factor));
    const b = Math.min(255, parseInt(hex.substr(4, 2), 16) + Math.round(255 * factor));
    return `rgb(${r}, ${g}, ${b})`;
  } public triggerCollisionFlash(): void {
    this.isFlashing = true;
    this.flashTimer = 200; // Reduced flash duration (200ms instead of 400ms)
    // Store original colors if not already stored
    if (!this.originalFillStyle) {
      this.originalFillStyle = this.body.render.fillStyle || '';
    }

    // Set more subtle flash colors
    this.body.render.fillStyle = 'rgba(255, 255, 255, 0.7)'; // Less intense white
    this.body.render.strokeStyle = '#88ccff'; // Softer cyan
    this.body.render.lineWidth = 6; // Thinner border during flash (was 10)
  }
  public updateFlash(deltaTime: number): void {
    if (!this.isFlashing) return;

    this.flashTimer -= deltaTime;

    if (this.flashTimer <= 0) {
      // Flash finished, restore original colors
      this.isFlashing = false;
      this.flashTimer = 0;

      // Restore colors based on current health state
      this.updateVisualState();
    } else {
      // Create more subtle pulsing effect during flash
      const flashIntensity = Math.sin((200 - this.flashTimer) * 0.05) * 0.3 + 0.7; // Reduced intensity
      const alpha = 0.5 + (flashIntensity * 0.2); // Less dramatic alpha changes

      // Softer color transitions
      const cyclePosition = (200 - this.flashTimer) * 0.008; // Slower cycling
      const colorMix = Math.sin(cyclePosition) * 0.3 + 0.7; // Less dramatic color mixing

      if (colorMix > 0.5) {
        this.body.render.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        this.body.render.strokeStyle = '#00ffff';
      } else {
        this.body.render.fillStyle = `rgba(0, 255, 255, ${alpha})`;
        this.body.render.strokeStyle = '#ffffff';
      }

      // Pulsing border thickness
      this.body.render.lineWidth = 8 + Math.round(flashIntensity * 4);
    }
  }
  private updateVisualState(): void {
    const healthRatio = this.health / this.maxHealth;
    const definition = ENTITY_DEFINITIONS[this.type];

    // Base colors
    let fillColor = definition.color;
    let strokeColor = this.brightenColor(definition.color);
    let lineWidth = 5;
    let alpha = 0.6;    // Apply engine thrust effects - make VERY obvious with directional indicators
    if (this.canProvideThrust() && this.thrustLevel > 0) {
      const thrustIntensity = this.thrustLevel;

      // Make engines EXTREMELY bright when thrusting
      fillColor = '#ffff00'; // Bright yellow fill
      strokeColor = '#ff6600'; // Orange stroke
      alpha = 0.95; // Almost opaque
      lineWidth = 8 + Math.round(thrustIntensity * 8); // Very thick border

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
      alpha = 0.9;
      lineWidth = 8;
    }

    // Apply cockpit weapon effects when firing
    if (this.isControlCenter() && this.canFire() && this.isFiring) {
      fillColor = '#ff8800'; // Orange flash for cockpit weapon
      strokeColor = '#ffffff'; // White border
      alpha = 0.9;
      lineWidth = 8;
    }

    // Apply cockpit engine effects when thrusting
    if (this.isControlCenter() && this.canProvideThrust() && this.thrustLevel > 0) {
      const thrustIntensity = this.thrustLevel;

      // Cockpit engines get a different color scheme
      fillColor = '#88ff88'; // Light green for cockpit thrust
      strokeColor = '#44ff44'; // Bright green stroke
      alpha = 0.8 + (thrustIntensity * 0.2);
      lineWidth = 6 + Math.round(thrustIntensity * 4);
    }

    // Apply health-based damage coloring
    if (this.destroyed) {
      this.body.render.fillStyle = this.makeTransparent('#330000', 0.5);
      this.body.render.strokeStyle = '#ff0000';
      this.body.render.lineWidth = 5;
    } else if (healthRatio > 0.75) {
      this.body.render.fillStyle = this.makeTransparent(fillColor, alpha);
      this.body.render.strokeStyle = strokeColor;
      this.body.render.lineWidth = lineWidth;
    } else if (healthRatio > 0.5) {
      const damagedColor = this.interpolateColor(fillColor, '#ff9900', (1 - healthRatio) * 2);
      this.body.render.fillStyle = this.makeTransparent(damagedColor, alpha + 0.1);
      this.body.render.strokeStyle = this.brightenColor('#ffaa00');
      this.body.render.lineWidth = lineWidth + 1;
    } else if (healthRatio > 0.25) {
      const damagedColor = this.interpolateColor('#ff9900', '#ff3300', (0.5 - healthRatio) * 4);
      this.body.render.fillStyle = this.makeTransparent(damagedColor, alpha + 0.2);
      this.body.render.strokeStyle = this.brightenColor('#ff6600');
      this.body.render.lineWidth = lineWidth + 1;
    } else if (healthRatio > 0) {
      this.body.render.fillStyle = this.makeTransparent('#ff0000', alpha + 0.3);
      this.body.render.strokeStyle = this.brightenColor('#ff0000');
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
}

// Extend Matter.js Body type to include our entity reference
declare module 'matter-js' {
  interface Body {
    entity?: Entity;
  }
}
