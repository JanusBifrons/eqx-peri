import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { STRUCTURE_DEFINITIONS, StructureType, CONNECTION_MAX_RANGE } from '../../types/GameTypes';
import { StructurePlacementSystem } from '../systems/StructurePlacementSystem';

/**
 * Renders the placement hologram and connection preview lines
 * when the player is in structure place mode.
 *
 * Priority 71 — drawn on top of almost everything so the preview is clearly visible.
 */
export class StructurePlacementRenderer implements IRenderer {
  readonly renderPriority = 71;

  private graphics!: PIXI.Graphics;

  constructor(
    private readonly getPlacementSystem: () => StructurePlacementSystem | null,
  ) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
  }

  render(viewport: Viewport): void {
    this.graphics.clear();

    const ps = this.getPlacementSystem();
    if (!ps) return;

    const placingType = ps.getPlacingType();
    if (!placingType) return;

    const cursor = ps.getCursorWorldPos();
    const { sx, sy, scale } = this.viewportHelpers(viewport);
    const screenX = sx(cursor.x);
    const screenY = sy(cursor.y);

    // Draw the hologram ghost
    this.drawHologram(screenX, screenY, scale, placingType);

    // Draw connection preview lines to nearby structures (valid only)
    const candidates = ps.getPlacementConnectCandidates();
    for (const { structure, valid } of candidates) {
      if (!valid) continue;
      const tgtX = sx(structure.body.position.x);
      const tgtY = sy(structure.body.position.y);

      const lineWidth = Math.max(1, 1.5 * scale);
      this.graphics.lineStyle(lineWidth, 0x44ddff, 0.5);
      this.graphics.moveTo(screenX, screenY);
      this.graphics.lineTo(tgtX, tgtY);
    }

    // Draw range circle (faint) so the player knows connection reach
    const rangeRadius = CONNECTION_MAX_RANGE * scale;
    this.graphics.lineStyle(Math.max(1, scale), 0x4488aa, 0.12);
    this.graphics.drawCircle(screenX, screenY, rangeRadius);
  }

  private drawHologram(cx: number, cy: number, scale: number, type: StructureType): void {
    const def = STRUCTURE_DEFINITIONS[type];
    const hw = (def.widthPx / 2) * scale;
    const hh = (def.heightPx / 2) * scale;

    const fillColor = PIXI.utils.string2hex(def.color);
    const borderColor = PIXI.utils.string2hex(def.borderColor);
    const borderWidth = Math.max(1.5, 2 * scale);

    if (def.shape === 'hex') {
      // Hexagonal preview
      const radius = hw;
      this.graphics.lineStyle(borderWidth, borderColor, 0.6);
      this.graphics.beginFill(fillColor, 0.3);
      this.drawHexagon(cx, cy, radius);
      this.graphics.endFill();
    } else {
      // Rectangular preview
      this.graphics.lineStyle(borderWidth, borderColor, 0.6);
      this.graphics.beginFill(fillColor, 0.3);
      this.graphics.drawRect(cx - hw, cy - hh, hw * 2, hh * 2);
      this.graphics.endFill();
    }
  }

  private drawHexagon(cx: number, cy: number, radius: number): void {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6; // flat-top orientation
      const px = cx + radius * Math.cos(angle);
      const py = cy + radius * Math.sin(angle);
      if (i === 0) {
        this.graphics.moveTo(px, py);
      } else {
        this.graphics.lineTo(px, py);
      }
    }
    this.graphics.closePath();
  }

  private viewportHelpers(viewport: Viewport): {
    sx: (wx: number) => number;
    sy: (wy: number) => number;
    scale: number;
  } {
    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    return {
      sx: (wx: number): number => (wx - bounds.min.x) / bw * canvas.width,
      sy: (wy: number): number => (wy - bounds.min.y) / bh * canvas.height,
      scale: canvas.width / bw,
    };
  }
}
