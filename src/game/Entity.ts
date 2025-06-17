import * as Matter from 'matter-js';
import { EntityType, EntityConfig, ENTITY_DEFINITIONS } from '../types/GameTypes';

export class Entity {
  public id: string;
  public type: EntityType;
  public health: number;
  public maxHealth: number;
  public body: Matter.Body;
  public destroyed: boolean = false;
  public localOffset: { x: number; y: number };
  public rotation: number;  constructor(config: EntityConfig) {
    this.id = Math.random().toString(36).substr(2, 9);
    this.type = config.type;
    this.localOffset = { x: config.x, y: config.y };
    this.rotation = config.rotation;
    
    const definition = ENTITY_DEFINITIONS[this.type];
    if (!definition) {
      throw new Error(`Unknown entity type: ${this.type}`);
    }
    
    this.maxHealth = config.maxHealth || definition.defaultHealth;
    this.health = config.health || this.maxHealth;

    // Create Matter.js body
    this.body = Matter.Bodies.rectangle(
      config.x, 
      config.y, 
      definition.width, 
      definition.height,
      {
        mass: definition.mass,
        render: {
          fillStyle: definition.color,
          strokeStyle: '#ffffff',
          lineWidth: 1
        }
      }
    );

    // Store reference to this entity in the body
    this.body.entity = this;

    // Apply rotation
    if (this.rotation !== 0) {
      Matter.Body.rotate(this.body, (this.rotation * Math.PI) / 180);
    }
  }
  public takeDamage(damage: number): boolean {
    if (this.destroyed) return false;
    
    this.health -= damage;
    
    // Update visual feedback based on health - enhanced for MVP
    const healthRatio = this.health / this.maxHealth;
    const definition = ENTITY_DEFINITIONS[this.type];
    
    if (healthRatio > 0.75) {
      this.body.render.fillStyle = definition.color;
      this.body.render.strokeStyle = '#ffffff';
      this.body.render.lineWidth = 1;
    } else if (healthRatio > 0.5) {
      this.body.render.fillStyle = this.interpolateColor(definition.color, '#ff9900', (1 - healthRatio) * 2);
      this.body.render.strokeStyle = '#ffaa00';
      this.body.render.lineWidth = 2;
    } else if (healthRatio > 0.25) {
      this.body.render.fillStyle = this.interpolateColor('#ff9900', '#ff3300', (0.5 - healthRatio) * 4);
      this.body.render.strokeStyle = '#ff6600';
      this.body.render.lineWidth = 2;
    } else if (healthRatio > 0) {
      this.body.render.fillStyle = '#ff0000';
      this.body.render.strokeStyle = '#ff0000';
      this.body.render.lineWidth = 3;
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
    this.body.render.fillStyle = '#330000';
    this.body.render.strokeStyle = '#ff0000';
    this.body.render.lineWidth = 2;
  }

  public canFire(): boolean {
    return this.type === 'Gun' && !this.destroyed;
  }

  public canProvideThrust(): boolean {
    return this.type === 'Engine' && !this.destroyed;
  }

  public isControlCenter(): boolean {
    return this.type === 'Cockpit' && !this.destroyed;
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
}

// Extend Matter.js Body type to include our entity reference
declare module 'matter-js' {
  interface Body {
    entity?: Entity;
  }
}
