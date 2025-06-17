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
    this.health = config.health || this.maxHealth;    // Create Matter.js body at exact position with enhanced visual styling
    this.body = Matter.Bodies.rectangle(
      config.x,
      config.y,
      definition.width,
      definition.height,
      {
        mass: definition.mass,
        frictionAir: 0, // No air resistance in space
        friction: 0.001, // Minimal friction for surface contact,
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

    if (this.destroyed) {
      this.body.render.fillStyle = this.makeTransparent('#330000', 0.5);
      this.body.render.strokeStyle = '#ff0000';
      this.body.render.lineWidth = 5;
    } else if (healthRatio > 0.75) {
      this.body.render.fillStyle = this.makeTransparent(definition.color, 0.6);
      this.body.render.strokeStyle = this.brightenColor(definition.color);
      this.body.render.lineWidth = 5;
    } else if (healthRatio > 0.5) {
      const damagedColor = this.interpolateColor(definition.color, '#ff9900', (1 - healthRatio) * 2);
      this.body.render.fillStyle = this.makeTransparent(damagedColor, 0.7);
      this.body.render.strokeStyle = this.brightenColor('#ffaa00');
      this.body.render.lineWidth = 6;
    } else if (healthRatio > 0.25) {
      const damagedColor = this.interpolateColor('#ff9900', '#ff3300', (0.5 - healthRatio) * 4);
      this.body.render.fillStyle = this.makeTransparent(damagedColor, 0.8);
      this.body.render.strokeStyle = this.brightenColor('#ff6600');
      this.body.render.lineWidth = 6;
    } else if (healthRatio > 0) {
      this.body.render.fillStyle = this.makeTransparent('#ff0000', 0.9);
      this.body.render.strokeStyle = this.brightenColor('#ff0000');
      this.body.render.lineWidth = 7;
    }
  }

  // ...existing code...
}

// Extend Matter.js Body type to include our entity reference
declare module 'matter-js' {
  interface Body {
    entity?: Entity;
  }
}
