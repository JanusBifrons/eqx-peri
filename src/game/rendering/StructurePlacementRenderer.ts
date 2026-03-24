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
  readonly renderSpace = 'world' as const;

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
    const scale = viewport.scale;

    const placementValid = ps.isCurrentPlacementValid();

    // Draw the hologram ghost (red if blocked)
    this.drawHologram(cursor.x, cursor.y, scale, placingType, placementValid);

    // Draw connection preview lines to nearby structures (only when placement is valid)
    if (placementValid) {
      const candidates = ps.getPlacementConnectCandidates();
      for (const { structure, valid } of candidates) {
        if (!valid) continue;
        const tgtX = structure.body.position.x;
        const tgtY = structure.body.position.y;

        const lineWidth = Math.max(1 / scale, 1.5);
        this.graphics.lineStyle(lineWidth, 0x44ddff, 0.5);
        this.graphics.moveTo(cursor.x, cursor.y);
        this.graphics.lineTo(tgtX, tgtY);
      }
    }

    // Draw range circle (faint) so the player knows connection reach
    this.graphics.lineStyle(Math.max(1 / scale, 1), placementValid ? 0x4488aa : 0xaa4444, 0.12);
    this.graphics.drawCircle(cursor.x, cursor.y, CONNECTION_MAX_RANGE);
  }

  private drawHologram(cx: number, cy: number, scale: number, type: StructureType, valid: boolean): void {
    const def = STRUCTURE_DEFINITIONS[type];
    const hw = def.widthPx / 2;
    const hh = def.heightPx / 2;

    const fillColor = valid ? PIXI.utils.string2hex(def.color) : 0x661111;
    const borderColor = valid ? PIXI.utils.string2hex(def.borderColor) : 0xff3333;
    const borderWidth = Math.max(1.5 / scale, 2);
    const fillAlpha = valid ? 0.3 : 0.35;
    const borderAlpha = valid ? 0.6 : 0.8;

    if (def.shape === 'hex') {
      const radius = hw;
      this.graphics.lineStyle(borderWidth, borderColor, borderAlpha);
      this.graphics.beginFill(fillColor, fillAlpha);
      this.drawHexagon(cx, cy, radius);
      this.graphics.endFill();
    } else {
      this.graphics.lineStyle(borderWidth, borderColor, borderAlpha);
      this.graphics.beginFill(fillColor, fillAlpha);
      this.graphics.drawRect(cx - hw, cy - hh, hw * 2, hh * 2);
      this.graphics.endFill();
    }

    // Draw sensor area preview if this structure type has one
    if (def.sensorRadius) {
      this.graphics.lineStyle(Math.max(1 / scale, 1), valid ? 0x448844 : 0x664444, 0.3);
      const segments = 24;
      for (let i = 0; i < segments; i++) {
        if (i % 2 === 0) {
          const a0 = (i / segments) * Math.PI * 2;
          const a1 = ((i + 1) / segments) * Math.PI * 2;
          this.graphics.moveTo(cx + Math.cos(a0) * def.sensorRadius, cy + Math.sin(a0) * def.sensorRadius);
          this.graphics.lineTo(cx + Math.cos(a1) * def.sensorRadius, cy + Math.sin(a1) * def.sensorRadius);
        }
      }
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
}
