import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Structure } from '../structures/Structure';
import { StructureManager } from '../structures/StructureManager';
import { GridPowerSummary } from '../../types/GameTypes';

const CORE_ICON_FRACTION = 0.35;
const CONSTRUCTION_BORDER_COLOR = 0xd4a843; // amber for scaffolding

const READOUT_STYLE = new PIXI.TextStyle({
  fontFamily: 'monospace',
  fontSize: 10,
  fill: '#cccccc',
});

const READOUT_LABEL_STYLE = new PIXI.TextStyle({
  fontFamily: 'monospace',
  fontSize: 9,
  fill: '#d4a843',
  fontWeight: 'bold',
});

const BUILDING_LABEL_STYLE = new PIXI.TextStyle({
  fontFamily: 'monospace',
  fontSize: 8,
  fill: '#d4a843',
  fontWeight: 'bold',
});

export class StructureRenderer implements IRenderer {
  readonly renderPriority = 15;

  private graphics!: PIXI.Graphics;
  private textContainer!: PIXI.Container;
  private textPool: PIXI.Text[] = [];

  constructor(
    private readonly getStructures: () => Structure[],
    private readonly getStructureManager: () => StructureManager | null,
  ) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
    this.textContainer = new PIXI.Container();
    stage.addChild(this.textContainer);
  }

  render(viewport: Viewport): void {
    this.graphics.clear();
    // Hide all pooled texts — only the ones needed this frame will be shown
    for (const t of this.textPool) t.visible = false;

    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const sx = (wx: number): number => (wx - bounds.min.x) / bw * canvas.width;
    const sy = (wy: number): number => (wy - bounds.min.y) / bh * canvas.height;
    const scale = canvas.width / bw;

    const mgr = this.getStructureManager();

    for (const structure of this.getStructures()) {
      const body = structure.body;
      const cx = sx(body.position.x);
      const cy = sy(body.position.y);
      const hw = (structure.definition.widthPx / 2) * scale;
      const hh = (structure.definition.heightPx / 2) * scale;

      // Viewport culling
      if (cx + hw < 0 || cx - hw > canvas.width || cy + hh < 0 || cy - hh > canvas.height) continue;

      const isBuilding = !structure.isConstructed;

      // Body fill
      const fillColor = isBuilding
        ? 0x1a1a10  // dark amber tint for scaffolding
        : PIXI.utils.string2hex(structure.definition.color);
      const borderColor = isBuilding
        ? CONSTRUCTION_BORDER_COLOR
        : PIXI.utils.string2hex(structure.definition.borderColor);
      const fillAlpha = isBuilding ? 0.35 : 0.9;
      const borderWidth = Math.max(1.5, 2 * scale);

      this.graphics.lineStyle(borderWidth, borderColor, isBuilding ? 0.6 : 1);
      this.graphics.beginFill(fillColor, fillAlpha);
      if (structure.definition.shape === 'hex') {
        this.drawHexagon(cx, cy, hw);
      } else {
        this.graphics.drawRect(cx - hw, cy - hh, hw * 2, hh * 2);
      }
      this.graphics.endFill();

      // Cross-hatch overlay for under-construction structures
      if (isBuilding && hw > 3) {
        this.drawCrossHatch(cx, cy, hw, hh, scale, structure.definition.shape === 'hex');
      }

      // Construction progress bar (amber) — shown when under construction
      if (isBuilding) {
        const frac = structure.getConstructionFraction();
        const barW = Math.max(hw * 1.6, 16 * scale);
        const barH = Math.max(2, 4 * scale);
        const barY = cy + hh + barH * 2;
        this.graphics.lineStyle(0);
        this.graphics.beginFill(0x333333, 0.7);
        this.graphics.drawRect(cx - barW / 2, barY, barW, barH);
        this.graphics.endFill();
        this.graphics.beginFill(CONSTRUCTION_BORDER_COLOR, 0.9);
        this.graphics.drawRect(cx - barW / 2, barY, barW * frac, barH);
        this.graphics.endFill();

        // "BUILDING" label above the structure
        if (scale > 0.4) {
          const pct = Math.floor(frac * 100);
          this.placeText(`BUILDING ${pct}%`, cx, cy - hh - 12, BUILDING_LABEL_STYLE, 0.5);
        }
      }

      // Health bar (only if constructed and damaged)
      if (!isBuilding) {
        const hpFrac = structure.getHealthFraction();
        if (hpFrac < 1) {
          const barW = hw * 1.6;
          const barH = Math.max(2, 4 * scale);
          const barY = cy + hh + barH * 2;
          this.graphics.lineStyle(0);
          this.graphics.beginFill(0x333333, 0.7);
          this.graphics.drawRect(cx - barW / 2, barY, barW, barH);
          this.graphics.endFill();
          this.graphics.beginFill(hpFrac > 0.5 ? 0x44cc44 : hpFrac > 0.25 ? 0xcccc44 : 0xcc4444, 0.9);
          this.graphics.drawRect(cx - barW / 2, barY, barW * hpFrac, barH);
          this.graphics.endFill();
        }
      }

      // Core icon — small diamond in the center (only when constructed)
      if (structure.type === 'Core' && !isBuilding) {
        const iconR = Math.min(hw, hh) * CORE_ICON_FRACTION;
        this.graphics.lineStyle(Math.max(1, 1.5 * scale), PIXI.utils.string2hex(structure.definition.borderColor), 0.9);
        this.graphics.moveTo(cx, cy - iconR);
        this.graphics.lineTo(cx + iconR, cy);
        this.graphics.lineTo(cx, cy + iconR);
        this.graphics.lineTo(cx - iconR, cy);
        this.graphics.closePath();

        // World-space readout — power grid summary rendered below the Core
        if (mgr) {
          const summary = mgr.getTeamGridSummary(structure.team);
          if (summary) {
            const hpFrac = structure.getHealthFraction();
            this.renderCoreReadout(cx, cy + hh, scale, summary, hpFrac < 1);
          }
        }
      }
    }
  }

  /** Draw diagonal cross-hatch lines inside the structure shape. */
  private drawCrossHatch(
    cx: number, cy: number, hw: number, hh: number,
    scale: number, isHex: boolean,
  ): void {
    const spacing = Math.max(4, 6 * scale);
    const lineAlpha = 0.15;
    const lineWidth = Math.max(0.5, scale);
    this.graphics.lineStyle(lineWidth, CONSTRUCTION_BORDER_COLOR, lineAlpha);

    const r = isHex ? hw : Math.max(hw, hh);
    const steps = Math.ceil((r * 2) / spacing);

    // Diagonal lines (top-left to bottom-right)
    for (let i = -steps; i <= steps; i++) {
      const offset = i * spacing;
      const x1 = cx + offset - r;
      const y1 = cy - r;
      const x2 = cx + offset + r;
      const y2 = cy + r;
      this.graphics.moveTo(x1, y1);
      this.graphics.lineTo(x2, y2);
    }
  }

  /** Render the Core's power/storage readout in world-space, anchored below the structure. */
  private renderCoreReadout(
    cx: number,
    bottomY: number,
    scale: number,
    summary: GridPowerSummary,
    hasDamageBar: boolean,
  ): void {
    // Don't render text if zoomed out too far (unreadable)
    if (scale < 0.4) return;

    const lineH = 13;
    // Offset below the structure (accounting for health bar if present)
    let y = bottomY + (hasDamageBar ? 14 : 6) * Math.max(1, scale);

    // Title
    this.placeText('CORE', cx, y, READOUT_LABEL_STYLE, 0.5);
    y += lineH;

    // Power
    const netColor = summary.netPower >= 0 ? '#44cc44' : '#cc4444';
    const netSign = summary.netPower >= 0 ? '+' : '';
    this.placeText(
      `PWR: ${netSign}${summary.netPower}  (${summary.totalPowerOutput} out / ${summary.totalPowerConsumption} in)`,
      cx, y, { ...READOUT_STYLE, fill: netColor } as PIXI.TextStyle, 0.5,
    );
    y += lineH;

    // Storage
    this.placeText(
      `STR: ${summary.usedCapacity} / ${summary.totalCapacity}`,
      cx, y, READOUT_STYLE, 0.5,
    );
  }

  /** Acquire a text from the pool or create a new one, position it, and make it visible. */
  private placeText(
    content: string,
    x: number,
    y: number,
    style: PIXI.TextStyle,
    anchorX: number,
  ): void {
    let text = this.textPool.find(t => !t.visible);
    if (!text) {
      text = new PIXI.Text('', style);
      this.textContainer.addChild(text);
      this.textPool.push(text);
    }
    text.style = style;
    text.text = content;
    text.x = x;
    text.y = y;
    text.anchor.set(anchorX, 0);
    text.visible = true;
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
