import { Vector2, GridPowerSummary, Recipe, RecipeIngredient, MaterialType, MANUFACTURER_PROCESS_RATE_KG } from '../../types/GameTypes';
import { Structure } from './Structure';

/**
 * Manufacturer — assembles ship parts and components from refined materials.
 *
 * Consumes specific materials (per recipe) from its own typed inventory
 * to produce manufactured parts. Power-gated: will not produce if grid netPower < 0.
 */
export class StructureManufacturer extends Structure {
  /** Current recipe being manufactured (null if idle). */
  public currentRecipe: Recipe | null = null;
  /** Resources accumulated toward the current recipe. */
  public buildProgress: number = 0;
  /** Number of items produced (lifetime counter for display). */
  public itemsProduced: number = 0;

  constructor(position: Vector2, team: number) {
    super('Manufacturer', position, team);
  }

  /** Set the recipe to manufacture. Resets progress if changing recipes. */
  public setRecipe(recipe: Recipe | null): void {
    if (this.currentRecipe?.id !== recipe?.id) {
      this.buildProgress = 0;
    }
    this.currentRecipe = recipe;
  }

  /** Total cost of the current recipe in kg. */
  public getRecipeTotalCost(): number {
    if (!this.currentRecipe) return 0;
    return this.currentRecipe.ingredients.reduce(
      (sum: number, ing: RecipeIngredient) => sum + ing.amountKg, 0,
    );
  }

  /** 0–1 fraction of build progress toward the current item. */
  public getBuildFraction(): number {
    const cost = this.getRecipeTotalCost();
    if (cost <= 0) return 0;
    return Math.min(1, this.buildProgress / cost);
  }

  /** Whether an item is ready to be produced. */
  public isItemReady(): boolean {
    const cost = this.getRecipeTotalCost();
    return cost > 0 && this.buildProgress >= cost;
  }

  /**
   * Per-pulse build tick. Consumes specific materials per recipe from own inventory.
   * Returns true if an item was completed this tick.
   */
  public tickBuild(gridSummary: GridPowerSummary): boolean {
    if (!this.isConstructed || this.isDestroyed()) return false;
    if (gridSummary.powerEfficiency <= 0) return false;
    if (!this.currentRecipe) return false;

    const totalCost = this.getRecipeTotalCost();
    if (totalCost <= 0) return false;

    // Scale process rate by power efficiency
    const effectiveRate = MANUFACTURER_PROCESS_RATE_KG * gridSummary.powerEfficiency;

    // Check each required material is available in inventory
    let minFraction = 1.0;
    const remaining = totalCost - this.buildProgress;
    const pulseCost = Math.min(remaining, effectiveRate);
    const pulseFraction = pulseCost / totalCost;

    for (const { material, amountKg } of this.currentRecipe.ingredients) {
      const needed = pulseFraction * amountKg;
      const have = this.getInventoryAmount(material);
      minFraction = Math.min(minFraction, needed > 0 ? Math.min(1, have / needed) : 1);
    }

    if (minFraction <= 0) return false;

    // Consume materials proportionally
    for (const { material, amountKg } of this.currentRecipe.ingredients) {
      const consume = minFraction * pulseFraction * amountKg;
      this.removeFromInventory(material, consume);
    }

    this.buildProgress += minFraction * pulseCost;

    if (this.isItemReady()) {
      this.itemsProduced++;
      this.buildProgress = Math.max(0, this.buildProgress - totalCost);
      return true;
    }
    return false;
  }

  /** Get display info about the current recipe for rendering. */
  public getRecipeName(): string {
    return this.currentRecipe?.name ?? 'Idle';
  }

  /** Get the list of required materials for the current recipe. */
  public getRequiredMaterials(): ReadonlyArray<{ material: MaterialType; amountKg: number }> {
    if (!this.currentRecipe) return [];
    return this.currentRecipe.ingredients;
  }
}
