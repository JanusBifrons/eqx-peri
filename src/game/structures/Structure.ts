import Matter from 'matter-js';
import { StructureType, StructureDefinition, STRUCTURE_DEFINITIONS, Vector2, REPAIR_COST_PER_HP } from '../../types/GameTypes';

let nextStructureId = 1;

/** Fraction of maxHealth that an under-construction structure starts with. */
const SCAFFOLDING_HP_FRACTION = 0.1;

/**
 * Base class for a placed structure in the world.
 * Wraps a static Matter.js body with HP, team ownership, power, and storage.
 *
 * Structures with constructionCost > 0 start as scaffolding and must receive
 * resources through the grid network to be built. Only fully constructed
 * structures provide power, storage, and full HP.
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

  /** Resource units invested toward construction so far. */
  public constructionProgress: number = 0;
  /** Whether the structure is fully built and operational. */
  public isConstructed: boolean = false;

  constructor(type: StructureType, position: Vector2, team: number) {
    this.id = `structure-${nextStructureId++}`;
    this.type = type;
    this.definition = STRUCTURE_DEFINITIONS[type];
    this.team = team;

    this.maxHealth = this.definition.maxHealth;
    this.storedResources = 0;

    // Structures with zero construction cost are pre-built
    if (this.definition.constructionCost <= 0) {
      this.isConstructed = true;
      this.constructionProgress = 0;
      this.currentHealth = this.maxHealth;
    } else {
      this.isConstructed = false;
      this.constructionProgress = 0;
      this.currentHealth = Math.floor(this.maxHealth * SCAFFOLDING_HP_FRACTION);
    }

    const bodyOpts: Matter.IBodyDefinition = {
      isStatic: true,
      friction: 0,
      frictionAir: 0,
      label: `structure-${this.type}`,
      render: {
        fillStyle: this.definition.color,
        strokeStyle: this.definition.borderColor,
        lineWidth: this.definition.shape === 'hex' ? 1.5 : 3,
      },
    };

    if (this.definition.shape === 'hex') {
      // Regular hexagon — radius = half the widthPx
      this.body = Matter.Bodies.polygon(
        position.x, position.y,
        6, this.definition.widthPx / 2,
        bodyOpts,
      );
    } else {
      this.body = Matter.Bodies.rectangle(
        position.x, position.y,
        this.definition.widthPx, this.definition.heightPx,
        bodyOpts,
      );
    }

    // Back-reference so collision handlers can look up the structure from the body
    (this.body as unknown as Record<string, unknown>).structure = this;
  }

  // ── Construction ──────────────────────────────────────────────────────

  /**
   * Apply resource units toward construction. Returns the amount actually consumed.
   * When fully built, sets isConstructed and restores full HP.
   */
  public applyConstructionResources(amount: number): number {
    if (this.isConstructed) return 0;
    const remaining = this.definition.constructionCost - this.constructionProgress;
    const consumed = Math.min(amount, remaining);
    this.constructionProgress += consumed;

    if (this.constructionProgress >= this.definition.constructionCost) {
      this.isConstructed = true;
      this.currentHealth = this.maxHealth;
    }
    return consumed;
  }

  /**
   * Apply resource units toward repair. Returns the amount actually consumed.
   * Only works when fully constructed and damaged.
   */
  public applyRepairResources(amount: number): number {
    if (!this.isConstructed) return 0;
    if (this.currentHealth >= this.maxHealth) return 0;

    const hpNeeded = this.maxHealth - this.currentHealth;
    const maxResourcesUseful = hpNeeded * REPAIR_COST_PER_HP;
    const consumed = Math.min(amount, maxResourcesUseful);
    const hpRestored = consumed / REPAIR_COST_PER_HP;

    this.currentHealth = Math.min(this.maxHealth, this.currentHealth + hpRestored);
    return consumed;
  }

  /** Mark this structure as pre-built (used by Core and test scenarios). */
  public markPreBuilt(): void {
    this.constructionProgress = this.definition.constructionCost;
    this.isConstructed = true;
    this.currentHealth = this.maxHealth;
  }

  /** 0–1 fraction of construction completion. 1 if cost is 0 or fully built. */
  public getConstructionFraction(): number {
    if (this.definition.constructionCost <= 0) return 1;
    return Math.min(1, this.constructionProgress / this.definition.constructionCost);
  }

  /** Whether this structure needs construction resources. */
  public needsConstruction(): boolean {
    return !this.isConstructed && this.definition.constructionCost > 0;
  }

  /** Whether this structure is constructed but damaged. */
  public needsRepair(): boolean {
    return this.isConstructed && this.currentHealth < this.maxHealth;
  }

  // ── Damage ────────────────────────────────────────────────────────────

  public takeDamage(amount: number): void {
    this.currentHealth = Math.max(0, this.currentHealth - amount);
  }

  public isDestroyed(): boolean {
    return this.currentHealth <= 0;
  }

  public getHealthFraction(): number {
    return this.maxHealth > 0 ? this.currentHealth / this.maxHealth : 0;
  }

  // ── Power & storage (gated behind isConstructed) ──────────────────────

  public getPowerOutput(): number {
    return this.isConstructed ? this.definition.powerOutput : 0;
  }

  public getPowerConsumption(): number {
    return this.isConstructed ? this.definition.powerConsumption : 0;
  }

  public getStorageCapacity(): number {
    return this.isConstructed ? this.definition.storageCapacity : 0;
  }

  public getStorageUtilization(): number {
    const cap = this.getStorageCapacity();
    return cap > 0 ? this.storedResources / cap : 0;
  }
}
