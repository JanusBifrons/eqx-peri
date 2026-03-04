import * as PIXI from 'pixi.js';
import { Viewport } from './Viewport';

export interface IRenderer {
  readonly renderPriority: number;
  /** Called once when registered — add persistent PIXI objects to stage here. */
  init(stage: PIXI.Container): void;
  /** Called every frame — update PIXI objects for the current game state. */
  render(viewport: Viewport, timestamp: number): void;
  dispose?(): void;
}
