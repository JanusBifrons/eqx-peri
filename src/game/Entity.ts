import * as Matter from 'matter-js';
import { EntityType, EntityConfig, ENTITY_DEFINITIONS } from '../types/GameTypes';

export class Entity {
  public id: string;
  public type: EntityType;
  public health: number;
  public maxHealth: number;
  public body: Matter.Body; public destroyed: boolean = false;
  public localOffset: { x: number; y: number };
  public rotation: number; public flashTimer: number = 0;
  public isFlashing: boolean = false;
  private originalFillStyle: string = '';

  // New properties for visual effects
  public thrustLevel: number = 0; // 0-1, how much thrust is being applied
  public isFiring: boolean = false;
  public fireFlashTimer: number = 0;
  public thrustParticles: Array<{ x: number, y: number, age: number, maxAge: number }> = [];
  private readonly MAX_PARTICLES = 8;

  constructor(config: EntityConfig) {
    this.id = Math.random().toString(36).substr(2, 9);
    this.type = config.type;
    this.localOffset = { x: config.x, y: config.y };
    this.rotation = config.rotation;

    const definition = ENTITY_DEFINITIONS[this.type];
    if (!definition) {
      throw new Error(`Unknown entity type: ${this.type}`);
    }

    this.maxHealth = config.maxHealth || definition.defaultHealth;
    this.health = config.health || this.maxHealth;    // Create Matter.js body at exact position with enhanced physics and visual styling
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
  }
  public canFire(): boolean {
    return (this.type === 'Gun' || this.type === 'LargeGun' || this.type === 'CapitalWeapon') && !this.destroyed;
  }

  public canProvideThrust(): boolean {
    return (this.type === 'Engine' || this.type === 'LargeEngine' || this.type === 'CapitalEngine') && !this.destroyed;
  }

  public isControlCenter(): boolean {
    return (this.type === 'Cockpit' || this.type === 'LargeCockpit' || this.type === 'CapitalCore') && !this.destroyed;
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
  }
  public triggerCollisionFlash(): void {
    this.isFlashing = true;
    this.flashTimer = 400; // Flash for 400 milliseconds (longer for better visibility)
    // Store original colors if not already stored
    if (!this.originalFillStyle) {
      this.originalFillStyle = this.body.render.fillStyle || '';
    }

    // Set intense flash colors (bright white/cyan)
    this.body.render.fillStyle = 'rgba(255, 255, 255, 0.95)';
    this.body.render.strokeStyle = '#00ffff'; // Bright cyan
    this.body.render.lineWidth = 10; // Very thick border during flash
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
      // Create intense pulsing effect during flash
      const flashIntensity = Math.sin((400 - this.flashTimer) * 0.03) * 0.6 + 0.4;
      const alpha = 0.7 + (flashIntensity * 0.3);

      // Alternate between white and cyan for more dramatic effect
      const cyclePosition = (400 - this.flashTimer) * 0.01;
      const colorMix = Math.sin(cyclePosition) * 0.5 + 0.5;

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
    // Add new particles if we have room
    if (this.thrustParticles.length < this.MAX_PARTICLES) {
      // Generate particles behind the engine
      const engineAngle = this.body.angle + (this.rotation * Math.PI / 180);
      const exhaustDistance = 20 + Math.random() * 15;

      // Particles spawn behind the engine
      const particleX = this.body.position.x - Math.cos(engineAngle) * exhaustDistance;
      const particleY = this.body.position.y - Math.sin(engineAngle) * exhaustDistance;

      this.thrustParticles.push({
        x: particleX + (Math.random() - 0.5) * 10, // Add some spread
        y: particleY + (Math.random() - 0.5) * 10,
        age: 0,
        maxAge: 300 + Math.random() * 200 // 0.3-0.5 seconds
      });
    }
  }

  public triggerWeaponFire(): void {
    this.isFiring = true;
    this.fireFlashTimer = 200; // Flash for 200ms
  }

  public updateVisualEffects(deltaTime: number): void {
    // Update weapon fire flash
    if (this.fireFlashTimer > 0) {
      this.fireFlashTimer -= deltaTime;
      if (this.fireFlashTimer <= 0) {
        this.isFiring = false;
      }
    }

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

    // Add new particle
    if (this.thrustParticles.length < this.MAX_PARTICLES) {
      this.thrustParticles.push({
        x: this.body.position.x,
        y: this.body.position.y,
        age: 0,
        maxAge: 100 + Math.random() * 100 // 100 to 200 ms lifetime
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

    const thrustIntensity = this.thrustLevel;
    const pos = this.body.position;
    const engineAngle = this.body.angle + (this.rotation * Math.PI / 180);

    // Calculate exhaust position (behind the engine)
    const exhaustDistance = 20 + thrustIntensity * 15;
    const exhaustX = pos.x - Math.cos(engineAngle) * exhaustDistance;
    const exhaustY = pos.y - Math.sin(engineAngle) * exhaustDistance;

    // Draw thrust plume
    ctx.save();
    ctx.globalAlpha = thrustIntensity * 0.8;

    // Create gradient for thrust plume
    const gradient = ctx.createRadialGradient(
      pos.x, pos.y, 2,
      exhaustX, exhaustY, exhaustDistance
    );
    gradient.addColorStop(0, '#ffff00'); // Bright yellow at engine
    gradient.addColorStop(0.5, '#ff6600'); // Orange in middle
    gradient.addColorStop(1, 'rgba(255, 0, 0, 0)'); // Transparent red at end

    ctx.fillStyle = gradient;
    ctx.beginPath();

    // Draw triangular plume
    const plumeWidth = 8 + thrustIntensity * 4;
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

    // Draw directional arrow
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 1.0;

    // Arrow pointing in thrust direction
    const arrowLength = 30;
    const arrowX = pos.x - Math.cos(engineAngle) * arrowLength;
    const arrowY = pos.y - Math.sin(engineAngle) * arrowLength;

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(arrowX, arrowY);

    // Arrow head
    const arrowHeadSize = 8;
    ctx.lineTo(
      arrowX + Math.cos(engineAngle - 2.5) * arrowHeadSize,
      arrowY + Math.sin(engineAngle - 2.5) * arrowHeadSize
    );
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(
      arrowX + Math.cos(engineAngle + 2.5) * arrowHeadSize,
      arrowY + Math.sin(engineAngle + 2.5) * arrowHeadSize
    );
    ctx.stroke();

    ctx.restore();
  }
}

// Extend Matter.js Body type to include our entity reference
declare module 'matter-js' {
  interface Body {
    entity?: Entity;
  }
}
