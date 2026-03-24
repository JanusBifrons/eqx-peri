import * as PIXI from 'pixi.js';
import { Viewport } from './Viewport';

export interface IRenderer {
  readonly renderPriority: number;
  /**
   * Whether this renderer draws in world space or screen space.
   * - 'world': PIXI objects are added to the WorldContainer; draw at world coordinates
   *   and the scene graph handles the world-to-screen transform automatically.
   * - 'screen': PIXI objects are added to a screen-space container; use
   *   viewport.worldToScreen() for positioning as needed.
   *
   * Defaults to 'screen' for backwards compatibility.
   */
  readonly renderSpace?: 'world' | 'screen';
  /** Called once when registered — add persistent PIXI objects to stage here. */
  init(stage: PIXI.Container): void;
  /** Called every frame — update PIXI objects for the current game state. */
  render(viewport: Viewport, timestamp: number): void;
  dispose?(): void;
}
