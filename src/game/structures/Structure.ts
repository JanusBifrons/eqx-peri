import Matter from 'matter-js';
import { StructureType, StructureDefinition, STRUCTURE_DEFINITIONS, Vector2 } from '../../types/GameTypes';

let nextStructureId = 1;

/**
 * Base class for a placed structure in the world.
 * Wraps a static Matter.js body with HP, team ownership, power, and storage.
 */
export class Structure {
  public readonly id: string;
  public readonly type: StructureType;
  public readonly definition: StructureDefinition;
  public readonly body: Matter.Body;
  public readonly team: number;

  public currentHealth: number;
  public maxHealth: number;
  public storedResources: number;

  constructor(type: StructureType, position: Vector2, team: number) {
    this.id = `structure-${nextStructureId++}`;
    this.type = type;
    this.definition = STRUCTURE_DEFINITIONS[type];
    this.team = team;

    this.maxHealth = this.definition.maxHealth;
    this.currentHealth = this.maxHealth;
    this.storedResources = 0;

    this.body = Matter.Bodies.rectangle(
      position.x,
      position.y,
      this.definition.widthPx,
      this.definition.heightPx,
      {
        isStatic: true,
        friction: 0,
        frictionAir: 0,
        label: `structure-${this.type}`,
        render: {
          fillStyle: this.definition.color,
          strokeStyle: this.definition.borderColor,
          lineWidth: 3,
        },
      },
    );

    // Back-reference so collision handlers can look up the structure from the body
    (this.body as unknown as Record<string, unknown>).structure = this;
  }

  public takeDamage(amount: number): void {
    this.currentHealth = Math.max(0, this.currentHealth - amount);
  }

  public isDestroyed(): boolean {
    return this.currentHealth <= 0;
  }

  public getHealthFraction(): number {
    return this.maxHealth > 0 ? this.currentHealth / this.maxHealth : 0;
  }

  public getPowerOutput(): number {
    return this.definition.powerOutput;
  }

  public getPowerConsumption(): number {
    return this.definition.powerConsumption;
  }

  public getStorageCapacity(): number {
    return this.definition.storageCapacity;
  }

  public getStorageUtilization(): number {
    const cap = this.getStorageCapacity();
    return cap > 0 ? this.storedResources / cap : 0;
  }
}
