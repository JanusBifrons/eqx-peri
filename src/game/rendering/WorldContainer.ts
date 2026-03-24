import * as PIXI from 'pixi.js';

/**
 * A PIXI.Container that represents the world-space viewport.
 *
 * All children added to this container draw in world coordinates.
 * The container's `scale` and `position` are set each frame by
 * `syncWithBounds()` so that PIXI's scene graph automatically
 * handles the world-to-screen transform for all children.
 *
 * This replaces the need for manual `worldToScreen()` calls in
 * every renderer — draw at world coords, and the GPU transform
 * matrix handles the rest.
 */
export class WorldContainer extends PIXI.Container {
  /**
   * Sync this container's transform so that the visible world region
   * defined by `bounds` maps exactly onto the screen area of size
   * `screenWidth × screenHeight`.
   *
   * After calling this, a child drawn at world position (wx, wy)
   * appears at screen pixel:
   *   screenX = (wx - bounds.min.x) * scale
   *   screenY = (wy - bounds.min.y) * scale
   */
  syncWithBounds(
    bounds: { min: { x: number; y: number }; max: { x: number; y: number } },
    screenWidth: number,
    screenHeight: number,
  ): void {
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    if (bw <= 0 || bh <= 0) return;

    const scaleX = screenWidth / bw;
    const scaleY = screenHeight / bh;

    this.scale.set(scaleX, scaleY);
    this.position.set(-bounds.min.x * scaleX, -bounds.min.y * scaleY);
  }
}
