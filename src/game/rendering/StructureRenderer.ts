import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Structure } from '../structures/Structure';
import { StructureTurret } from '../structures/StructureTurret';
import { StructureAssemblyYard } from '../structures/StructureAssemblyYard';
import { StructureManufacturer } from '../structures/StructureManufacturer';
import { StructureRecycler } from '../structures/StructureRecycler';
import { ShieldWall } from '../structures/ShieldWall';
import { StructureManager } from '../structures/StructureManager';
import { GridPowerSummary, SHIELD_WALL_THICKNESS } from '../../types/GameTypes';

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

const NO_POWER_STYLE = new PIXI.TextStyle({
  fontFamily: 'monospace',
  fontSize: 8,
  fill: '#cc4444',
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
    private readonly getShieldWalls: () => ShieldWall[],
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

      // Body fill — under-construction structures get an opaque dark base
      // to occlude connection lines underneath, then the scaffolding tint on top.
      const fillColor = isBuilding
        ? 0x1a1a10  // dark amber tint for scaffolding
        : PIXI.utils.string2hex(structure.definition.color);
      const borderColor = isBuilding
        ? CONSTRUCTION_BORDER_COLOR
        : PIXI.utils.string2hex(structure.definition.borderColor);
      const borderWidth = Math.max(1.5, 2 * scale);

      // Opaque dark base for under-construction (hides connection lines behind)
      if (isBuilding) {
        this.graphics.lineStyle(0);
        this.graphics.beginFill(0x0a0a0a, 0.95);
        if (structure.definition.shape === 'hex') {
          this.drawHexagon(cx, cy, hw);
        } else {
          this.graphics.drawRect(cx - hw, cy - hh, hw * 2, hh * 2);
        }
        this.graphics.endFill();
      }

      const fillAlpha = isBuilding ? 0.45 : 0.9;
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

      // Shield fence icon (small shield emblem)
      if (!isBuilding && structure.type === 'ShieldFence') {
        this.drawShieldFenceIcon(cx, cy, Math.min(hw, hh) * 0.5, scale);
      }

      // Refinery icon (gear/refine)
      if (!isBuilding && structure.type === 'Refinery') {
        this.drawRefineryIcon(cx, cy, Math.min(hw, hh) * 0.4, scale);
      }

      // Structure-type-specific icons (only when constructed)
      if (!isBuilding) {
        if (structure.type === 'Core') {
          // Diamond icon
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
        } else if (structure.type === 'SolarPanel') {
          // Sun icon — small circle with rays
          this.drawSolarIcon(cx, cy, Math.min(hw, hh) * 0.5, scale);
        } else if (structure.type === 'Battery') {
          // Battery icon — stacked horizontal bars
          this.drawBatteryIcon(cx, cy, Math.min(hw, hh) * 0.45, scale);
        } else if (structure.type === 'PowerStation') {
          // Lightning bolt icon
          this.drawLightningIcon(cx, cy, Math.min(hw, hh) * 0.4, scale);
        } else if (structure instanceof StructureTurret) {
          // Turret barrel
          this.drawTurretBarrel(cx, cy, structure, scale);

          // "NO POWER" indicator when fully depowered
          if (mgr && scale > 0.4) {
            const summary = mgr.getTeamGridSummary(structure.team);
            if (summary && summary.powerEfficiency <= 0) {
              this.placeText('NO POWER', cx, cy - hh - 12, NO_POWER_STYLE, 0.5);
            }
          }
        } else if (structure instanceof StructureAssemblyYard) {
          // Assembly Yard icon (wrench/gear)
          this.drawAssemblyYardIcon(cx, cy, Math.min(hw, hh) * 0.35, scale);

          // Build progress bar (orange)
          const buildFrac = structure.getBuildFraction();
          if (buildFrac > 0 && buildFrac < 1) {
            const barW = Math.max(hw * 1.4, 14 * scale);
            const barH = Math.max(2, 4 * scale);
            const barY = cy + hh + barH * 2;
            this.graphics.lineStyle(0);
            this.graphics.beginFill(0x333333, 0.7);
            this.graphics.drawRect(cx - barW / 2, barY, barW, barH);
            this.graphics.endFill();
            this.graphics.beginFill(0xcc8844, 0.9);
            this.graphics.drawRect(cx - barW / 2, barY, barW * buildFrac, barH);
            this.graphics.endFill();
          }

          // Ship count indicator
          if (scale > 0.4) {
            const count = structure.activeShipIds.length;
            const cap = 3; // ASSEMBLY_YARD_MAX_SHIPS
            this.placeText(`SHIPS: ${count}/${cap}`, cx, cy - hh - 12, READOUT_STYLE, 0.5);
          }
        } else if (structure instanceof StructureManufacturer) {
          // Manufacturer icon (gear)
          this.drawManufacturerIcon(cx, cy, Math.min(hw, hh) * 0.35, scale);

          // Build progress bar (green-yellow)
          const buildFrac = structure.getBuildFraction();
          if (buildFrac > 0 && buildFrac < 1) {
            const barW = Math.max(hw * 1.4, 14 * scale);
            const barH = Math.max(2, 4 * scale);
            const barY = cy + hh + barH * 2;
            this.graphics.lineStyle(0);
            this.graphics.beginFill(0x333333, 0.7);
            this.graphics.drawRect(cx - barW / 2, barY, barW, barH);
            this.graphics.endFill();
            this.graphics.beginFill(0xaacc44, 0.9);
            this.graphics.drawRect(cx - barW / 2, barY, barW * buildFrac, barH);
            this.graphics.endFill();
          }

          // Recipe name
          if (scale > 0.4) {
            this.placeText(structure.getRecipeName(), cx, cy - hh - 12, READOUT_STYLE, 0.5);
          }
        } else if (structure instanceof StructureRecycler) {
          // Recycler icon (recycle arrows)
          this.drawRecyclerIcon(cx, cy, Math.min(hw, hh) * 0.4, scale);

          // "NO POWER" indicator when fully depowered
          if (mgr && scale > 0.4) {
            const summary = mgr.getTeamGridSummary(structure.team);
            if (summary && summary.powerEfficiency <= 0) {
              this.placeText('NO POWER', cx, cy - hh - 12, NO_POWER_STYLE, 0.5);
            }
          }
        }
      }
    }

    // ── Shield walls ──────────────────────────────────────────────────────
    this.renderShieldWalls(viewport);
  }

  /** Render shield wall barriers between connected ShieldFence posts. */
  private renderShieldWalls(viewport: Viewport): void {
    const walls = this.getShieldWalls();
    if (walls.length === 0) return;

    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const sx = (wx: number): number => (wx - bounds.min.x) / bw * canvas.width;
    const sy = (wy: number): number => (wy - bounds.min.y) / bh * canvas.height;
    const scale = canvas.width / bw;

    for (const wall of walls) {
      const ax = sx(wall.postA.body.position.x);
      const ay = sy(wall.postA.body.position.y);
      const bx = sx(wall.postB.body.position.x);
      const by = sy(wall.postB.body.position.y);

      // Viewport culling
      const margin = 20;
      if (
        (ax < -margin && bx < -margin) ||
        (ax > canvas.width + margin && bx > canvas.width + margin) ||
        (ay < -margin && by < -margin) ||
        (ay > canvas.height + margin && by > canvas.height + margin)
      ) continue;

      const active = wall.isActive();
      const wallWidth = Math.max(2, SHIELD_WALL_THICKNESS * scale);

      if (active) {
        // Outer glow
        this.graphics.lineStyle(wallWidth * 2.5, 0x4488ff, 0.15);
        this.graphics.moveTo(ax, ay);
        this.graphics.lineTo(bx, by);

        // Core wall line
        this.graphics.lineStyle(wallWidth, 0x6699ff, 0.7);
        this.graphics.moveTo(ax, ay);
        this.graphics.lineTo(bx, by);

        // Bright inner core
        this.graphics.lineStyle(Math.max(1, wallWidth * 0.4), 0xaaccff, 0.9);
        this.graphics.moveTo(ax, ay);
        this.graphics.lineTo(bx, by);
      } else {
        // Inactive — dim flickering red line (stunned or unpowered)
        const now = Date.now();
        const flicker = Math.sin(now * 0.01) * 0.15 + 0.2;
        this.graphics.lineStyle(wallWidth, 0x664444, flicker);
        this.graphics.moveTo(ax, ay);
        this.graphics.lineTo(bx, by);

        // Status label
        if (scale > 0.3) {
          const midX = (ax + bx) / 2;
          const midY = (ay + by) / 2;
          const label = wall.isStunned ? 'STUNNED' : 'NO POWER';
          this.placeText(label, midX, midY - wallWidth - 10, NO_POWER_STYLE, 0.5);
        }
      }
    }
  }

  /** Draw diagonal cross-hatch lines clipped to the structure bounds. */
  private drawCrossHatch(
    cx: number, cy: number, hw: number, hh: number,
    scale: number, _isHex: boolean,
  ): void {
    const spacing = Math.max(4, 6 * scale);
    const lineAlpha = 0.15;
    const lineWidth = Math.max(0.5, scale);
    this.graphics.lineStyle(lineWidth, CONSTRUCTION_BORDER_COLOR, lineAlpha);

    const left = cx - hw;
    const right = cx + hw;
    const top = cy - hh;
    const bottom = cy + hh;
    const diagLen = hw + hh;
    const steps = Math.ceil((diagLen * 2) / spacing);

    // Diagonal lines (top-left to bottom-right), clipped to the rect bounds
    for (let i = -steps; i <= steps; i++) {
      const offset = i * spacing;
      // Line from (cx+offset-hh, top) to (cx+offset+hh, bottom) — slope 1:1
      let x1 = cx + offset - hh;
      let y1 = top;
      let x2 = cx + offset + hh;
      let y2 = bottom;

      // Clip to left edge
      if (x1 < left) { y1 += (left - x1); x1 = left; }
      // Clip to right edge
      if (x2 > right) { y2 -= (x2 - right); x2 = right; }
      // Clip to top edge
      if (y1 < top) { x1 += (top - y1); y1 = top; }
      // Clip to bottom edge
      if (y2 > bottom) { x2 -= (y2 - bottom); y2 = bottom; }

      if (x1 >= right || x2 <= left || y1 >= bottom || y2 <= top) continue;

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

  /** Draw a turret barrel line from center outward in the aim direction. */
  private drawTurretBarrel(
    cx: number, cy: number,
    turret: StructureTurret,
    scale: number,
  ): void {
    const barrelLen = (Math.max(turret.definition.widthPx, turret.definition.heightPx) / 2 + 6) * scale;
    const barrelWidth = Math.max(2, 4 * scale);
    const angle = turret.currentAimAngle;
    const endX = cx + Math.cos(angle) * barrelLen;
    const endY = cy + Math.sin(angle) * barrelLen;

    this.graphics.lineStyle(barrelWidth, PIXI.utils.string2hex(turret.definition.borderColor), 0.9);
    this.graphics.moveTo(cx, cy);
    this.graphics.lineTo(endX, endY);

    // Muzzle dot
    this.graphics.lineStyle(0);
    this.graphics.beginFill(PIXI.utils.string2hex(turret.definition.borderColor), 1);
    this.graphics.drawCircle(endX, endY, barrelWidth * 0.6);
    this.graphics.endFill();
  }

  /** Draw a small sun icon (circle + rays). */
  private drawSolarIcon(cx: number, cy: number, r: number, scale: number): void {
    const lw = Math.max(1, 1.5 * scale);
    this.graphics.lineStyle(lw, 0x4488cc, 0.8);
    this.graphics.drawCircle(cx, cy, r * 0.4);
    // 8 rays
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.graphics.moveTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55);
      this.graphics.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  }

  /** Draw a battery icon (stacked bars). */
  private drawBatteryIcon(cx: number, cy: number, r: number, scale: number): void {
    const lw = Math.max(1, 1.5 * scale);
    this.graphics.lineStyle(lw, 0xcc8844, 0.8);
    const barH = r * 0.25;
    const barW = r * 1.2;
    for (let i = -1; i <= 1; i++) {
      this.graphics.drawRect(cx - barW / 2, cy + i * barH * 1.5 - barH / 2, barW, barH);
    }
  }

  /** Draw a lightning bolt icon. */
  private drawLightningIcon(cx: number, cy: number, r: number, scale: number): void {
    const lw = Math.max(1, 2 * scale);
    this.graphics.lineStyle(lw, 0x6644cc, 0.9);
    // Simple zigzag bolt
    this.graphics.moveTo(cx + r * 0.15, cy - r);
    this.graphics.lineTo(cx - r * 0.3, cy - r * 0.1);
    this.graphics.lineTo(cx + r * 0.15, cy + r * 0.1);
    this.graphics.lineTo(cx - r * 0.15, cy + r);
  }

  /** Draw an assembly yard icon (crossed wrench). */
  private drawAssemblyYardIcon(cx: number, cy: number, r: number, scale: number): void {
    const lw = Math.max(1, 1.5 * scale);
    this.graphics.lineStyle(lw, 0xcc8844, 0.8);
    // Crossed wrenches
    this.graphics.moveTo(cx - r, cy - r);
    this.graphics.lineTo(cx + r, cy + r);
    this.graphics.moveTo(cx + r, cy - r);
    this.graphics.lineTo(cx - r, cy + r);
    // Wrench heads
    this.graphics.drawCircle(cx - r, cy - r, r * 0.25);
    this.graphics.drawCircle(cx + r, cy + r, r * 0.25);
  }

  /** Draw a shield fence icon (small chevron/shield shape). */
  private drawShieldFenceIcon(cx: number, cy: number, r: number, scale: number): void {
    const lw = Math.max(1, 1.5 * scale);
    this.graphics.lineStyle(lw, 0x4488ff, 0.9);
    // Shield-shaped chevron
    this.graphics.moveTo(cx - r * 0.5, cy - r * 0.6);
    this.graphics.lineTo(cx, cy + r * 0.6);
    this.graphics.lineTo(cx + r * 0.5, cy - r * 0.6);
  }

  /** Draw a refinery icon (small circle with arrow). */
  private drawRefineryIcon(cx: number, cy: number, r: number, scale: number): void {
    const lw = Math.max(1, 1.5 * scale);
    this.graphics.lineStyle(lw, 0x44cc44, 0.8);
    this.graphics.drawCircle(cx, cy, r * 0.5);
    // Small upward arrow inside
    this.graphics.moveTo(cx, cy - r * 0.3);
    this.graphics.lineTo(cx, cy + r * 0.3);
    this.graphics.moveTo(cx - r * 0.2, cy);
    this.graphics.lineTo(cx, cy - r * 0.3);
    this.graphics.lineTo(cx + r * 0.2, cy);
  }

  /** Draw a manufacturer icon (gear/cog shape). */
  private drawManufacturerIcon(cx: number, cy: number, r: number, scale: number): void {
    const lw = Math.max(1, 1.5 * scale);
    this.graphics.lineStyle(lw, 0xaacc44, 0.8);
    // Simple gear — outer circle with 4 teeth
    this.graphics.drawCircle(cx, cy, r * 0.4);
    const teeth = 4;
    for (let i = 0; i < teeth; i++) {
      const angle = (Math.PI * 2 / teeth) * i;
      const ix = cx + Math.cos(angle) * r * 0.35;
      const iy = cy + Math.sin(angle) * r * 0.35;
      const ox = cx + Math.cos(angle) * r * 0.7;
      const oy = cy + Math.sin(angle) * r * 0.7;
      this.graphics.moveTo(ix, iy);
      this.graphics.lineTo(ox, oy);
    }
  }

  /** Draw a recycler icon (triangular recycle arrows). */
  private drawRecyclerIcon(cx: number, cy: number, r: number, scale: number): void {
    const lw = Math.max(1, 1.5 * scale);
    this.graphics.lineStyle(lw, 0x44ccaa, 0.8);
    // Three arrows forming a triangle loop
    const sides = 3;
    for (let i = 0; i < sides; i++) {
      const a1 = (Math.PI * 2 / sides) * i - Math.PI / 2;
      const a2 = (Math.PI * 2 / sides) * (i + 1) - Math.PI / 2;
      const x1 = cx + Math.cos(a1) * r * 0.5;
      const y1 = cy + Math.sin(a1) * r * 0.5;
      const mx = cx + Math.cos((a1 + a2) / 2) * r * 0.55;
      const my = cy + Math.sin((a1 + a2) / 2) * r * 0.55;
      this.graphics.moveTo(x1, y1);
      this.graphics.lineTo(mx, my);
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
