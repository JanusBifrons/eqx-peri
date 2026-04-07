import Matter from 'matter-js';
import { StructureType, StructureDefinition, STRUCTURE_DEFINITIONS, Vector2, REPAIR_COST_PER_HP, InventoryItemType, MaterialType, OreType, BATTERY_STUN_MS } from '../../types/GameTypes';

let nextStructureId = 1;

/** Fraction of maxHealth that an under-construction structure starts with. */
const SCAFFOLDING_HP_FRACTION = 0.1;

/**
 * Base class for a placed structure in the world.
 * Wraps a static Matter.js body with HP, team ownership, power, and a typed material inventory.
 *
 * The inventory stores specific materials (ore and refined types) in kg.
 * All material flows (construction, distribution, repair) go through the inventory API.
 */
export class Structure {
  public readonly id: string;
  public readonly type: StructureType;
  public readonly definition: StructureDefinition;
  public readonly body: Matter.Body;
  public readonly team: number;

  public currentHealth: number;
  public maxHealth: number;

  /** Typed material inventory. All amounts in kg. */
  protected _inventory: Map<InventoryItemType, number> = new Map();

  /** Per-material kg delivered toward construction. */
  public constructionDelivered: Map<MaterialType, number> = new Map();
  /** Whether the structure is fully built and operational. */
  public isConstructed: boolean = false;

  /** Whether the player has manually toggled power off on this structure. */
  public isPoweredOn: boolean = true;

  /** Current aim angle in world-space radians (used by single-turret parts with rotation: 'aim'). */
  public currentAimAngle: number = 0;

  /** Per-turret aim angles for multi-turret structures (indexed by StructurePartDefinition.turretIndex). */
  public turretAngles: number[] = [];

  /** Whether this structure is currently deconstructing (reverse of construction). */
  public isDeconstructing: boolean = false;
  /** Resources returned to the grid so far during deconstruction. */
  public deconstructionReturned: number = 0;

  /**
   * Refinery batch progress (0–1). Fills as ore is processed each pulse;
   * resets to fractional carry-over when a batch completes and materials are yielded.
   */
  public refiningProgress: number = 0;
  /** The ore type currently being accumulated into the refinery batch. Reset when ore type changes. */
  public refiningOreType: OreType | null = null;


  /** Temporary power consumption spike (e.g. from grid absorbing shield wall hits). */
  private _powerSpikeAmount: number = 0;
  /** Timestamp (ms) when the current power spike expires. */
  private _powerSpikeUntil: number = 0;

  /** Stored energy for Battery structures (watt-seconds). Zero on all other types. */
  private _storedPower: number = 0;
  /** Timestamp (ms) until which this battery cannot recharge (triggered when drained to zero). */
  private _powerStunUntil: number = 0;

  constructor(type: StructureType, position: Vector2, team: number) {
    this.id = `structure-${nextStructureId++}`;
    this.type = type;
    this.definition = STRUCTURE_DEFINITIONS[type];
    this.team = team;

    this.maxHealth = this.definition.maxHealth;

    // Structures with zero construction cost are pre-built
    if (this.definition.constructionCost <= 0) {
      this.isConstructed = true;
      this.currentHealth = this.maxHealth;
    } else {
      this.isConstructed = false;
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

    (this.body as unknown as Record<string, unknown>).structure = this;
  }

  // ── Inventory ──────────────────────────────────────────────────────────

  /** Total kg of all materials stored (read-only proxy for backward compat). */
  public get storedResources(): number {
    return this.getInventoryTotal();
  }

  /** Amount (kg) of a specific material in inventory. */
  public getInventoryAmount(type: InventoryItemType): number {
    return this._inventory.get(type) ?? 0;
  }

  /** Sum of all inventory values (kg). */
  public getInventoryTotal(): number {
    let total = 0;
    for (const v of this._inventory.values()) total += v;
    return total;
  }

  /** All non-zero inventory entries as [type, amount] pairs. */
  public getInventoryItems(): [InventoryItemType, number][] {
    return Array.from(this._inventory.entries()).filter(([, v]) => v > 0);
  }

  /**
   * Add a material to inventory, capped at storageCapacity.
   * Returns the amount actually added.
   */
  public addToInventory(type: InventoryItemType, amount: number): number {
    if (amount <= 0) return 0;
    const cap = this.getStorageCapacity();
    if (cap <= 0) return 0;
    const space = cap - this.getInventoryTotal();
    const added = Math.min(amount, Math.max(0, space));
    if (added <= 0) return 0;
    this._inventory.set(type, (this._inventory.get(type) ?? 0) + added);
    return added;
  }

  /**
   * Remove a specific material from inventory.
   * Returns the amount actually removed.
   */
  public removeFromInventory(type: InventoryItemType, amount: number): number {
    if (amount <= 0) return 0;
    const current = this._inventory.get(type) ?? 0;
    const removed = Math.min(amount, current);
    if (removed <= 0) return 0;
    const remaining = current - removed;
    if (remaining <= 0) {
      this._inventory.delete(type);
    } else {
      this._inventory.set(type, remaining);
    }
    return removed;
  }

  /**
   * Remove up to `amount` kg from inventory, draining materials sequentially.
   * Returns total kg actually removed.
   */
  public removeAnyMaterials(amount: number): number {
    if (amount <= 0) return 0;
    let remaining = amount;
    for (const [type, current] of this._inventory) {
      if (remaining <= 0) break;
      const take = Math.min(current, remaining);
      remaining -= take;
      const newAmt = current - take;
      if (newAmt <= 0) {
        this._inventory.delete(type);
      } else {
        this._inventory.set(type, newAmt);
      }
    }
    return amount - remaining;
  }

  /**
   * Initialize inventory with specific amounts, bypassing storage capacity.
   * Used for scenario setup (Core starting resources, etc.).
   */
  public initInventory(items: Partial<Record<InventoryItemType, number>>): void {
    this._inventory.clear();
    for (const [k, v] of Object.entries(items)) {
      if (v && v > 0) {
        this._inventory.set(k as InventoryItemType, v);
      }
    }
  }

  // ── Construction ──────────────────────────────────────────────────────

  /**
   * Record that `amount` kg of `material` has been delivered toward construction.
   * GridManager calls this after deducting from the source.
   * Checks completion after each delivery.
   */
  public deliverConstructionMaterial(material: MaterialType, amount: number): void {
    if (this.isConstructed || amount <= 0) return;
    this.constructionDelivered.set(
      material,
      (this.constructionDelivered.get(material) ?? 0) + amount,
    );
    this.checkConstructionComplete();
  }

  /** How much more of this material is still needed for construction. */
  public getConstructionRemaining(material: MaterialType): number {
    const recipe = this.definition.constructionRecipe;
    if (!recipe) return 0;
    const needed = recipe[material] ?? 0;
    const delivered = this.constructionDelivered.get(material) ?? 0;
    return Math.max(0, needed - delivered);
  }

  /** Check if all recipe materials have been fully delivered. */
  private checkConstructionComplete(): void {
    const recipe = this.definition.constructionRecipe;
    if (!recipe) return;
    for (const [material, needed] of Object.entries(recipe) as [MaterialType, number][]) {
      if ((this.constructionDelivered.get(material) ?? 0) < needed) return;
    }
    this.isConstructed = true;
    this.currentHealth = this.maxHealth;
  }

  /**
   * Apply resource units toward repair (consumes caller-supplied generic amount).
   * GridManager drains source inventory; this method restores HP.
   * Returns the amount actually useful for repair.
   */
  public applyRepairResources(amount: number): number {
    if (!this.isConstructed) return 0;
    if (this.currentHealth >= this.maxHealth) return 0;
    const hpNeeded = this.maxHealth - this.currentHealth;
    const maxResourcesUseful = hpNeeded * REPAIR_COST_PER_HP;
    const consumed = Math.min(amount, maxResourcesUseful);
    this.currentHealth = Math.min(this.maxHealth, this.currentHealth + consumed / REPAIR_COST_PER_HP);
    return consumed;
  }

  /** Mark this structure as pre-built (used by Core and test scenarios). */
  public markPreBuilt(): void {
    this.isConstructed = true;
    this.currentHealth = this.maxHealth;
  }

  /** 0–1 fraction of construction completion. 1 if cost is 0 or fully built. */
  public getConstructionFraction(): number {
    if (this.isConstructed) return 1;
    const recipe = this.definition.constructionRecipe;
    if (!recipe) return 1;
    const totalCost = this.definition.constructionCost;
    if (totalCost <= 0) return 1;
    let delivered = 0;
    for (const v of this.constructionDelivered.values()) delivered += v;
    return Math.min(1, delivered / totalCost);
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

  // ── Power & storage ───────────────────────────────────────────────────

  public getPowerOutput(): number {
    if (!this.isConstructed || !this.isPoweredOn || this.isDeconstructing) return 0;
    return this.definition.powerOutput;
  }

  public getPowerConsumption(): number {
    if (!this.isConstructed || !this.isPoweredOn || this.isDeconstructing) return 0;
    const base = this.definition.powerConsumption;
    const spike = Date.now() < this._powerSpikeUntil ? this._powerSpikeAmount : 0;
    return base + spike;
  }

  /** Apply a temporary consumption spike (stacks if within the current window). */
  public applyPowerSpike(amount: number, durationMs: number): void {
    const now = Date.now();
    if (now < this._powerSpikeUntil) {
      this._powerSpikeAmount += amount;
    } else {
      this._powerSpikeAmount = amount;
    }
    this._powerSpikeUntil = now + durationMs;
  }

  public getStorageCapacity(): number {
    return this.isConstructed ? this.definition.storageCapacity : 0;
  }

  public getStorageUtilization(): number {
    const cap = this.getStorageCapacity();
    return cap > 0 ? this.getInventoryTotal() / cap : 0;
  }

  // ── Battery power storage ────────────────────────────────────────────

  /** Max energy this structure can hold (watt-seconds). Zero if not a Battery or not constructed. */
  public getPowerStorageCapacity(): number {
    return this.isConstructed ? (this.definition.powerStorageCapacity ?? 0) : 0;
  }

  /** Current stored energy (watt-seconds). */
  public getStoredPower(): number {
    return this._storedPower;
  }

  /** True while this battery is locked out from recharging after being fully drained. */
  public isPowerStunned(): boolean {
    return Date.now() < this._powerStunUntil;
  }

  /**
   * Add energy to the battery (e.g. from grid surplus each frame).
   * Blocked while the battery is stunned (recently fully drained).
   * Capped at powerStorageCapacity. Returns amount actually stored.
   */
  public chargePower(amount: number): number {
    if (amount <= 0) return 0;
    if (this.isPowerStunned()) return 0;
    const cap = this.getPowerStorageCapacity();
    if (cap <= 0) return 0;
    const space = cap - this._storedPower;
    const added = Math.min(amount, Math.max(0, space));
    this._storedPower += added;
    return added;
  }

  /**
   * Remove energy from the battery (e.g. shield wall damage absorption).
   * If drained to zero, enters a recharge lockout for BATTERY_STUN_MS.
   * Returns amount actually drained.
   */
  public drainPower(amount: number): number {
    if (amount <= 0) return 0;
    const drained = Math.min(amount, this._storedPower);
    this._storedPower -= drained;
    if (this._storedPower <= 0) {
      this._powerStunUntil = Date.now() + BATTERY_STUN_MS;
    }
    return drained;
  }

  // ── Deconstruction ──────────────────────────────────────────────────

  /** Total resources that must be returned during deconstruction. */
  public getDeconstructionTotal(): number {
    return this.definition.constructionCost + this.getInventoryTotal();
  }

  /** 0–1 fraction of deconstruction progress (1 = fully deconstructed). */
  public getDeconstructionFraction(): number {
    const total = this.getDeconstructionTotal();
    if (total <= 0) return 1;
    return Math.min(1, this.deconstructionReturned / total);
  }

  /** Start deconstruction — halts normal operation. */
  public beginDeconstruction(): void {
    if (this.isDeconstructing) return;
    this.isDeconstructing = true;
    this.deconstructionReturned = 0;
  }

  /** Cancel deconstruction — structure returns to construction mode if incomplete. */
  public cancelDeconstruction(): void {
    if (!this.isDeconstructing) return;
    this.isDeconstructing = false;
    this.deconstructionReturned = 0;
    // If we returned some resources, the structure may no longer be fully constructed.
    // Re-enter construction state if construction cost > 0.
    if (this.definition.constructionCost > 0) {
      this.isConstructed = false;
    }
  }

  /**
   * Tick deconstruction — returns resources to the network.
   * Returns the kg of resources released this tick (for the grid to absorb).
   * Returns -1 when deconstruction is complete (caller should remove the structure).
   */
  public tickDeconstruction(rateKg: number): number {
    if (!this.isDeconstructing) return 0;
    const total = this.getDeconstructionTotal();
    if (total <= 0) return -1; // nothing to deconstruct

    const remaining = total - this.deconstructionReturned;
    if (remaining <= 0) return -1; // done

    const amount = Math.min(rateKg, remaining);
    this.deconstructionReturned += amount;

    // Drain inventory proportionally as we deconstruct
    if (this.getInventoryTotal() > 0) {
      this.removeAnyMaterials(Math.min(amount, this.getInventoryTotal()));
    }

    if (this.deconstructionReturned >= total) return -1; // complete
    return amount;
  }

  /** Whether this structure is fully operational (constructed, powered on, not deconstructing). */
  public isOperational(): boolean {
    return this.isConstructed && this.isPoweredOn && !this.isDeconstructing;
  }

  // ── Type guard helpers ────────────────────────────────────────────────

  /** Whether this material is an ore type (not yet refined). */
  public static isOreType(type: InventoryItemType): type is OreType {
    return type === 'CarbonaceousOre' || type === 'SilicateOre' || type === 'MetallicOre';
  }

  /** Whether this material is a refined material type. */
  public static isMaterialType(type: InventoryItemType): type is MaterialType {
    return !Structure.isOreType(type);
  }
}
