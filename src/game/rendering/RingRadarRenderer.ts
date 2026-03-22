import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

// --- Configurable constants ---

/** Pixel distance from the screen centre at which indicators are drawn. */
const RING_RADIUS = 280;

/** Base size of each arrow indicator in pixels (at scale 1.0). */
const ARROW_SIZE_BASE = 7;

/**
 * At or below this world-unit distance an indicator renders at MAX_SCALE.
 * At or above SCALE_FAR_DIST it renders at MIN_SCALE.
 */
const SCALE_CLOSE_DIST = 600;
const SCALE_FAR_DIST   = 5000;

/** Clamped scale bounds — arrows never shrink below MIN or grow above MAX. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 1.8;

// --- Colours ---
const COLOR_ENEMY    = 0xff3333;
const COLOR_FRIENDLY = 0x33ff66;

/** Rendered between ShipHighlightRenderer (50) and AimingDebugRenderer (60). */
const RENDER_PRIORITY = 55;

export class RingRadarRenderer implements IRenderer {
  public readonly renderPriority = RENDER_PRIORITY;

  private graphics!: PIXI.Graphics;

  constructor(
    private readonly getAssemblies:    () => Assembly[],
    private readonly getPlayerAssembly: () => Assembly | null,
  ) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.graphics.clear();

    const canvas        = viewport.canvas;
    const screenCentreX = canvas.width  / 2;
    const screenCentreY = canvas.height / 2;

    const playerAssembly = this.getPlayerAssembly();

    // Reference point in world space: player body if piloting, else viewport centre.
    const refWorldX = playerAssembly
      ? playerAssembly.rootBody.position.x
      : (viewport.bounds.min.x + viewport.bounds.max.x) / 2;
    const refWorldY = playerAssembly
      ? playerAssembly.rootBody.position.y
      : (viewport.bounds.min.y + viewport.bounds.max.y) / 2;

    // Always treat team 0 as "friendly" — even in observer mode the player is team 0.
    const playerTeam = playerAssembly?.team ?? 0;

    for (const assembly of this.getAssemblies()) {
      if (assembly === playerAssembly)    continue;
      if (assembly.destroyed)             continue;
      if (!assembly.hasControlCenter())   continue;

      const worldPos = assembly.rootBody.position;

      // Direction from screen centre to this target's screen position.
      const screenPos = viewport.worldToScreen(worldPos.x, worldPos.y);
      const dx        = screenPos.x - screenCentreX;
      const dy        = screenPos.y - screenCentreY;
      const screenDist = Math.sqrt(dx * dx + dy * dy);

      if (screenDist < 0.001) continue; // coincident — skip

      // Skip if the target is already visible inside the viewport.
      if (
        screenPos.x >= 0 && screenPos.x <= canvas.width &&
        screenPos.y >= 0 && screenPos.y <= canvas.height
      ) continue;

      // Place the indicator on the ring perimeter.
      const nx = dx / screenDist;
      const ny = dy / screenDist;
      const ix = screenCentreX + nx * RING_RADIUS;
      const iy = screenCentreY + ny * RING_RADIUS;

      // Scale by world-space distance so near ships get bigger arrows.
      const worldDx   = worldPos.x - refWorldX;
      const worldDy   = worldPos.y - refWorldY;
      const worldDist = Math.sqrt(worldDx * worldDx + worldDy * worldDy);
      const t         = Math.min(1, Math.max(0,
        (worldDist - SCALE_CLOSE_DIST) / (SCALE_FAR_DIST - SCALE_CLOSE_DIST),
      ));
      const scale = MAX_SCALE - t * (MAX_SCALE - MIN_SCALE);

      // Colour by faction relative to the player's team (team 0 when observing).
      const color = assembly.team === playerTeam ? COLOR_FRIENDLY : COLOR_ENEMY;

      this.drawArrow(ix, iy, Math.atan2(ny, nx), ARROW_SIZE_BASE * scale, color);
    }
  }

  /**
   * Draws a filled isoceles triangle centred at (cx, cy).
   * The tip points in the given angle (toward the target).
   */
  private drawArrow(
    cx:    number,
    cy:    number,
    angle: number,
    size:  number,
    color: number,
  ): void {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Tip: 1.0 × size forward from centre.
    const tipX = cx + cosA * size;
    const tipY = cy + sinA * size;

    // Two base corners: 0.5 × size backward, ±0.35 × size perpendicular (narrow/pointy).
    const halfBack = size * 0.5;
    const halfWing = size * 0.35;

    const leftX  = cx - cosA * halfBack - sinA * halfWing;
    const leftY  = cy - sinA * halfBack + cosA * halfWing;
    const rightX = cx - cosA * halfBack + sinA * halfWing;
    const rightY = cy - sinA * halfBack - cosA * halfWing;

    this.graphics.beginFill(color, 0.9);
    this.graphics.moveTo(tipX, tipY);
    this.graphics.lineTo(leftX, leftY);
    this.graphics.lineTo(rightX, rightY);
    this.graphics.closePath();
    this.graphics.endFill();
  }

  dispose(): void {
    this.graphics.destroy();
  }
}
