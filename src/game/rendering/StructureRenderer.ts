import * as PIXI from 'pixi.js';
import { CRTFilter } from 'pixi-filters';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Structure } from '../structures/Structure';
import { StructureTurret } from '../structures/StructureTurret';
import { StructureAssemblyYard } from '../structures/StructureAssemblyYard';
import { StructureManufacturer } from '../structures/StructureManufacturer';
import { StructureRecycler } from '../structures/StructureRecycler';
import { ShieldWall } from '../structures/ShieldWall';
import { StructureManager } from '../structures/StructureManager';
import { SHIELD_WALL_THICKNESS } from '../../types/GameTypes';

const CORE_ICON_FRACTION = 0.35;
const CONSTRUCTION_BORDER_COLOR = 0xd4a843; // amber for scaffolding
const DECONSTRUCTION_COLOR = 0xcc4444; // red for deconstruction

/** Minimum zoom scale to render text readouts (avoids unreadable micro-text). */
const MIN_TEXT_SCALE = 0.4;

/** Types that are too small or don't warrant a power/storage readout. */
const SKIP_READOUT_TYPES = new Set(['Connector', 'ShieldFence']);

const READOUT_STYLE = new PIXI.TextStyle({
  fontFamily: 'monospace',
  fontSize: 10,
  fill: '#ffffff',
});

const BUILDING_LABEL_STYLE = new PIXI.TextStyle({
  fontFamily: 'monospace',
  fontSize: 8,
  fill: '#d4a843',
  fontWeight: 'bold',
});

const DECON_LABEL_STYLE = new PIXI.TextStyle({
  fontFamily: 'monospace',
  fontSize: 8,
  fill: '#cc4444',
  fontWeight: 'bold',
});

const NO_POWER_STYLE = new PIXI.TextStyle({
  fontFamily: 'monospace',
  fontSize: 8,
  fill: '#cc4444',
  fontWeight: 'bold',
});

// ── Formatting helpers ──────────────────────────────────────────────────

/** Format a power value with auto-scaled unit (W / kW / MW). */
function formatPower(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MW`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)} kW`;
  return `${value} W`;
}

/** Format a weight value in kg to human-readable (g / kg / t / kt / Mt). */
function formatWeight(kg: number): string {
  if (kg < 1) return `${Math.round(kg * 1000)} g`;
  if (kg < 1_000) return `${Math.round(kg)} kg`;
  if (kg < 1_000_000) return `${(kg / 1_000).toFixed(1)} t`;
  if (kg < 1_000_000_000) return `${(kg / 1_000_000).toFixed(1)} kt`;
  return `${(kg / 1_000_000_000).toFixed(1)} Mt`;
}

/** Pad a string to a fixed width (right-align numbers for consistency). */

export class StructureRenderer implements IRenderer {
  readonly renderPriority = 15;

  private graphics!: PIXI.Graphics;
  private textContainer!: PIXI.Container;
  private readoutGraphics!: PIXI.Graphics;  // backdrop rects drawn inside textContainer
  private crtFilter!: CRTFilter;
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
    // Readout backdrops are drawn inside textContainer so the CRT filter covers them
    this.readoutGraphics = new PIXI.Graphics();
    this.textContainer.addChild(this.readoutGraphics);
    // Subtle CRT / LCD scanline effect on all readout panels
    this.crtFilter = new CRTFilter({
      curvature: 4,
      lineWidth: 4,
      lineContrast: 0.6,
      noise: 0.25,
      noiseSize: 1.0,
      vignetting: 0.3,
      vignettingAlpha: 0.8,
      vignettingBlur: 0.4,
      verticalLine: false,
    });
    this.textContainer.filters = [this.crtFilter];
    stage.addChild(this.textContainer);
  }

  render(viewport: Viewport): void {
    this.graphics.clear();
    this.readoutGraphics.clear();
    // Animate CRT scanlines
    this.crtFilter.time += 0.04;
    this.crtFilter.seed = Math.random();
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
      const isDeconstructing = structure.isDeconstructing;

      // Body fill — under-construction / deconstructing structures get an opaque dark base
      const fillColor = isBuilding || isDeconstructing
        ? (isDeconstructing ? 0x1a0a0a : 0x1a1a10)
        : PIXI.utils.string2hex(structure.definition.color);
      const borderColor = isDeconstructing
        ? DECONSTRUCTION_COLOR
        : (isBuilding ? CONSTRUCTION_BORDER_COLOR : PIXI.utils.string2hex(structure.definition.borderColor));
      const borderWidth = Math.max(1.5, 2 * scale);

      // Opaque dark base for under-construction / deconstructing (hides connection lines behind)
      if (isBuilding || isDeconstructing) {
        this.graphics.lineStyle(0);
        this.graphics.beginFill(0x0a0a0a, 0.95);
        if (structure.definition.shape === 'hex') {
          this.drawHexagon(cx, cy, hw);
        } else {
          this.graphics.drawRect(cx - hw, cy - hh, hw * 2, hh * 2);
        }
        this.graphics.endFill();
      }

      const fillAlpha = (isBuilding || isDeconstructing) ? 0.45 : (structure.isPoweredOn ? 0.9 : 0.5);
      this.graphics.lineStyle(borderWidth, borderColor, (isBuilding || isDeconstructing) ? 0.6 : 1);
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

      // "Powered off" overlay — dim X pattern
      if (!structure.isPoweredOn && structure.isConstructed && !isDeconstructing) {
        const lw = Math.max(1, 2 * scale);
        this.graphics.lineStyle(lw, 0xcc4444, 0.4);
        this.graphics.moveTo(cx - hw * 0.5, cy - hh * 0.5);
        this.graphics.lineTo(cx + hw * 0.5, cy + hh * 0.5);
        this.graphics.moveTo(cx + hw * 0.5, cy - hh * 0.5);
        this.graphics.lineTo(cx - hw * 0.5, cy + hh * 0.5);
      }

      // ── Progress bars ──────────────────────────────────────────────
      // Track the Y position below the structure for stacking bars + readouts
      let barY = cy + hh + Math.max(2, 4 * scale) * 2;

      // Construction progress bar (amber)
      if (isBuilding && !isDeconstructing) {
        const frac = structure.getConstructionFraction();
        const barW = Math.max(hw * 1.6, 16 * scale);
        const barH = Math.max(2, 4 * scale);
        this.graphics.lineStyle(0);
        this.graphics.beginFill(0x333333, 0.7);
        this.graphics.drawRect(cx - barW / 2, barY, barW, barH);
        this.graphics.endFill();
        this.graphics.beginFill(CONSTRUCTION_BORDER_COLOR, 0.9);
        this.graphics.drawRect(cx - barW / 2, barY, barW * frac, barH);
        this.graphics.endFill();
        barY += barH + 2;

        // "BUILDING" label above the structure
        if (scale > MIN_TEXT_SCALE) {
          const pct = Math.floor(frac * 100);
          this.placeText(`BUILDING ${pct}%`, cx, cy - hh - 12, BUILDING_LABEL_STYLE, 0.5);
        }
      }

      // Deconstruction progress bar (red, starts full, empties)
      if (isDeconstructing) {
        const frac = 1 - structure.getDeconstructionFraction();
        const barW = Math.max(hw * 1.6, 16 * scale);
        const barH = Math.max(2, 4 * scale);
        this.graphics.lineStyle(0);
        this.graphics.beginFill(0x333333, 0.7);
        this.graphics.drawRect(cx - barW / 2, barY, barW, barH);
        this.graphics.endFill();
        this.graphics.beginFill(DECONSTRUCTION_COLOR, 0.9);
        this.graphics.drawRect(cx - barW / 2, barY, barW * frac, barH);
        this.graphics.endFill();
        barY += barH + 2;

        if (scale > MIN_TEXT_SCALE) {
          const pct = Math.floor(frac * 100);
          this.placeText(`DECONSTRUCTING ${pct}%`, cx, cy - hh - 12, DECON_LABEL_STYLE, 0.5);
        }
      }

      // Health bar (only if constructed and damaged, not deconstructing)
      if (!isBuilding && !isDeconstructing) {
        const hpFrac = structure.getHealthFraction();
        if (hpFrac < 1) {
          const barW = hw * 1.6;
          const barH = Math.max(2, 4 * scale);
          this.graphics.lineStyle(0);
          this.graphics.beginFill(0x333333, 0.7);
          this.graphics.drawRect(cx - barW / 2, barY, barW, barH);
          this.graphics.endFill();
          this.graphics.beginFill(hpFrac > 0.5 ? 0x44cc44 : hpFrac > 0.25 ? 0xcccc44 : 0xcc4444, 0.9);
          this.graphics.drawRect(cx - barW / 2, barY, barW * hpFrac, barH);
          this.graphics.endFill();
          barY += barH + 2;
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
        } else if (structure.type === 'SolarPanel') {
          this.drawSolarIcon(cx, cy, Math.min(hw, hh) * 0.5, scale);
        } else if (structure.type === 'Battery') {
          this.drawBatteryIcon(cx, cy, Math.min(hw, hh) * 0.45, scale);
        } else if (structure.type === 'PowerStation') {
          this.drawLightningIcon(cx, cy, Math.min(hw, hh) * 0.4, scale);
        } else if (structure instanceof StructureTurret) {
          this.drawTurretBarrel(cx, cy, structure, scale);
        } else if (structure instanceof StructureAssemblyYard) {
          this.drawAssemblyYardIcon(cx, cy, Math.min(hw, hh) * 0.35, scale);

          // Build progress bar (orange)
          const buildFrac = structure.getBuildFraction();
          if (buildFrac > 0 && buildFrac < 1) {
            const bBarW = Math.max(hw * 1.4, 14 * scale);
            const bBarH = Math.max(2, 4 * scale);
            this.graphics.lineStyle(0);
            this.graphics.beginFill(0x333333, 0.7);
            this.graphics.drawRect(cx - bBarW / 2, barY, bBarW, bBarH);
            this.graphics.endFill();
            this.graphics.beginFill(0xcc8844, 0.9);
            this.graphics.drawRect(cx - bBarW / 2, barY, bBarW * buildFrac, bBarH);
            this.graphics.endFill();
            barY += bBarH + 2;
          }
        } else if (structure instanceof StructureManufacturer) {
          this.drawManufacturerIcon(cx, cy, Math.min(hw, hh) * 0.35, scale);

          // Build progress bar (green-yellow)
          const buildFrac = structure.getBuildFraction();
          if (buildFrac > 0 && buildFrac < 1) {
            const bBarW = Math.max(hw * 1.4, 14 * scale);
            const bBarH = Math.max(2, 4 * scale);
            this.graphics.lineStyle(0);
            this.graphics.beginFill(0x333333, 0.7);
            this.graphics.drawRect(cx - bBarW / 2, barY, bBarW, bBarH);
            this.graphics.endFill();
            this.graphics.beginFill(0xaacc44, 0.9);
            this.graphics.drawRect(cx - bBarW / 2, barY, bBarW * buildFrac, bBarH);
            this.graphics.endFill();
            barY += bBarH + 2;
          }
        } else if (structure instanceof StructureRecycler) {
          this.drawRecyclerIcon(cx, cy, Math.min(hw, hh) * 0.4, scale);
        }
      }

      // ── World-space readouts (power + storage) drawn ON the structure ──
      if (!SKIP_READOUT_TYPES.has(structure.type)) {
        this.renderStructureReadout(structure, cx, cy, hw, hh, scale, mgr);
      }
    }

    // ── Shield walls ──────────────────────────────────────────────────────
    this.renderShieldWalls(viewport);
  }

  // ── World-space readout drawn ON the structure body ─────────────────

  /**
   * Render power and storage as text overlaid on the structure face,
   * like a physical LED billboard mounted on the building.
   *
   * All sizes derive from the structure's world dimensions × scale.
   * fontSize is set directly (not via text.scale) so PIXI rasterises
   * at the correct resolution — no blur on zoom-in.
   */
  private renderStructureReadout(
    structure: Structure,
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    scale: number,
    mgr: StructureManager | null,
  ): void {
    const def = structure.definition;

    // Each row is a sequence of text segments with individual colors
    interface TextSegment { text: string; color: string }
    interface ReadoutRow { segments: TextSegment[] }
    const rows: ReadoutRow[] = [];

    // ── Power row ────────────────────────────────────────────────────
    const isProducer = def.powerOutput > 0;
    const isConsumer = def.powerConsumption > 0;
    if (isProducer || isConsumer) {
      const active = structure.isPoweredOn && !structure.isDeconstructing;
      const value = isProducer ? def.powerOutput : def.powerConsumption;
      let valueColor = active
        ? (isProducer ? '#44cc44' : '#cc4444')
        : '#666666';
      let valueText = formatPower(value);

      // NO POWER override for depowered turrets/recyclers
      if (!structure.isDeconstructing && mgr && (
        structure instanceof StructureTurret ||
        structure instanceof StructureRecycler
      )) {
        const summary = mgr.getTeamGridSummary(structure.team);
        if (summary && summary.powerEfficiency <= 0) {
          valueText = 'NO POWER';
          valueColor = '#cc4444';
        }
      }
      rows.push({ segments: [
        { text: 'PWR  ', color: '#ffffff' },
        { text: valueText, color: valueColor },
      ]});
    }

    // ── Storage row — split into separately colored segments ────────
    if (def.storageCapacity > 0) {
      const used = structure.getInventoryTotal();
      const pct = Math.round((used / def.storageCapacity) * 100);

      let usedColor: string;
      if (pct >= 90) { usedColor = '#cc4444'; }
      else if (pct >= 60) { usedColor = '#ccaa44'; }
      else { usedColor = '#44cc44'; }

      rows.push({ segments: [
        { text: 'STR  ', color: '#ffffff' },
        { text: formatWeight(used), color: usedColor },
        { text: ' / ', color: '#ffffff' },
        { text: formatWeight(def.storageCapacity), color: '#ffffff' },
        { text: ` (${pct}%)`, color: usedColor },
      ]});
    }

    // ── Type-specific extra row ─────────────────────────────────────
    if (structure instanceof StructureAssemblyYard && structure.isConstructed) {
      const count = structure.activeShipIds.length;
      rows.push({ segments: [
        { text: 'BLD  ', color: '#ffffff' },
        { text: `${count}/3 SHIPS`, color: '#cccccc' },
      ]});
    } else if (structure instanceof StructureManufacturer && structure.isConstructed) {
      rows.push({ segments: [
        { text: 'MFG  ', color: '#ffffff' },
        { text: structure.getRecipeName(), color: '#aacc44' },
      ]});
    }

    if (rows.length === 0) return;

    // ── Layout: black backdrop sized to content, top-left of structure ─
    const RASTER_FONT = 32;
    const worldTextH = def.heightPx * 0.035;
    const textScale = (worldTextH * scale) / RASTER_FONT;
    const screenTextH = RASTER_FONT * textScale;
    const charW = screenTextH * 0.6; // monospace char width ≈ 0.6 × height
    const lineH = screenTextH * 1.4;
    const margin = 6 * scale;
    const pad = 4 * scale;

    // Find the longest row in characters to size the backdrop
    let maxChars = 0;
    for (const row of rows) {
      let rowChars = 0;
      for (const seg of row.segments) rowChars += seg.text.length;
      if (rowChars > maxChars) maxChars = rowChars;
    }

    const boxX = cx - hw + margin;
    const boxY = cy - hh + margin;
    const boxW = maxChars * charW + pad * 2;
    const contentH = rows.length * lineH + pad * 2;
    const minH = contentH * 1.5; // slightly taller than content
    const boxH = Math.max(contentH, minH);
    const radius = 2 * scale;

    // Black fill — on readoutGraphics (inside textContainer, affected by CRT filter)
    this.readoutGraphics.lineStyle(0);
    this.readoutGraphics.beginFill(0x000000, 0.9);
    this.readoutGraphics.drawRoundedRect(boxX, boxY, boxW, boxH, radius);
    this.readoutGraphics.endFill();

    // White border — on main graphics (NOT affected by CRT filter)
    const borderWidth = Math.max(1, 1.5 * scale);
    this.graphics.lineStyle(borderWidth, 0xffffff, 0.7);
    this.graphics.beginFill(0x000000, 0); // transparent fill
    this.graphics.drawRoundedRect(boxX, boxY, boxW, boxH, radius);
    this.graphics.endFill();

    let y = boxY + pad;
    for (const row of rows) {
      let x = boxX + pad;
      for (const seg of row.segments) {
        this.placeText(
          seg.text, x, y,
          { ...READOUT_STYLE, fontSize: RASTER_FONT, fill: seg.color } as PIXI.TextStyle,
          0, 0, textScale,
        );
        x += seg.text.length * charW;
      }
      y += lineH;
    }
  }

  // ── Shield walls ──────────────────────────────────────────────────────

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

  // ── Scaffolding cross-hatch ───────────────────────────────────────────

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
      let x1 = cx + offset - hh;
      let y1 = top;
      let x2 = cx + offset + hh;
      let y2 = bottom;

      if (x1 < left) { y1 += (left - x1); x1 = left; }
      if (x2 > right) { y2 -= (x2 - right); x2 = right; }
      if (y1 < top) { x1 += (top - y1); y1 = top; }
      if (y2 > bottom) { x2 -= (y2 - bottom); y2 = bottom; }

      if (x1 >= right || x2 <= left || y1 >= bottom || y2 <= top) continue;

      this.graphics.moveTo(x1, y1);
      this.graphics.lineTo(x2, y2);
    }
  }

  // ── Text pooling ──────────────────────────────────────────────────────

  /** Acquire a text from the pool or create a new one, position it, and make it visible. */
  private placeText(
    content: string,
    x: number,
    y: number,
    style: PIXI.TextStyle,
    anchorX: number,
    anchorY: number = 0,
    textScale: number = 1,
  ): void {
    let text = this.textPool.find(t => !t.visible);
    if (!text) {
      text = new PIXI.Text('', style);
      this.textContainer.addChild(text);
      this.textPool.push(text);
    }
    text.style = style;
    text.text = content;
    text.scale.set(textScale);
    text.x = x;
    text.y = y;
    text.anchor.set(anchorX, anchorY);
    text.visible = true;
  }

  // ── Structure-type icons ──────────────────────────────────────────────

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
    this.graphics.moveTo(cx + r * 0.15, cy - r);
    this.graphics.lineTo(cx - r * 0.3, cy - r * 0.1);
    this.graphics.lineTo(cx + r * 0.15, cy + r * 0.1);
    this.graphics.lineTo(cx - r * 0.15, cy + r);
  }

  /** Draw an assembly yard icon (crossed wrench). */
  private drawAssemblyYardIcon(cx: number, cy: number, r: number, scale: number): void {
    const lw = Math.max(1, 1.5 * scale);
    this.graphics.lineStyle(lw, 0xcc8844, 0.8);
    this.graphics.moveTo(cx - r, cy - r);
    this.graphics.lineTo(cx + r, cy + r);
    this.graphics.moveTo(cx + r, cy - r);
    this.graphics.lineTo(cx - r, cy + r);
    this.graphics.drawCircle(cx - r, cy - r, r * 0.25);
    this.graphics.drawCircle(cx + r, cy + r, r * 0.25);
  }

  /** Draw a shield fence icon (small chevron/shield shape). */
  private drawShieldFenceIcon(cx: number, cy: number, r: number, scale: number): void {
    const lw = Math.max(1, 1.5 * scale);
    this.graphics.lineStyle(lw, 0x4488ff, 0.9);
    this.graphics.moveTo(cx - r * 0.5, cy - r * 0.6);
    this.graphics.lineTo(cx, cy + r * 0.6);
    this.graphics.lineTo(cx + r * 0.5, cy - r * 0.6);
  }

  /** Draw a refinery icon (small circle with arrow). */
  private drawRefineryIcon(cx: number, cy: number, r: number, scale: number): void {
    const lw = Math.max(1, 1.5 * scale);
    this.graphics.lineStyle(lw, 0x44cc44, 0.8);
    this.graphics.drawCircle(cx, cy, r * 0.5);
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
      const angle = (Math.PI / 3) * i - Math.PI / 6;
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
