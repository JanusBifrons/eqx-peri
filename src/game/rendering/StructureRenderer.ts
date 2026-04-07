import * as PIXI from 'pixi.js';
import { CRTFilter } from 'pixi-filters';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Structure } from '../structures/Structure';
import { StructureTurret } from '../structures/StructureTurret';
import { StructureAssemblyYard } from '../structures/StructureAssemblyYard';
import { StructureManufacturer } from '../structures/StructureManufacturer';
import { StructureRecycler } from '../structures/StructureRecycler';
import { StructureMiningPlatform } from '../structures/StructureMiningPlatform';
import { ShieldWall } from '../structures/ShieldWall';
import { StructureManager } from '../structures/StructureManager';
import { SHIELD_WALL_THICKNESS, StructurePartDefinition, StructurePartDetail } from '../../types/GameTypes';

const CORE_ICON_FRACTION = 0.35;
const CONSTRUCTION_BORDER_COLOR = 0xd4a843; // amber for scaffolding
const DECONSTRUCTION_COLOR = 0xcc4444; // red for deconstruction

/** Types that are too small or don't warrant a power/storage readout. */
const SKIP_READOUT_TYPES = new Set(['Connector', 'ShieldFence']);

// ── World-space readout panel constants (all in world units) ────────────
// Everything is multiplied by `scale` (viewport px-per-world-unit) at render
// time so the panel is drawn physically onto the structure body and moves +
// scales with it. Nothing here is in screen pixels.

/** Fixed panel width in world units. */
const PANEL_WORLD_W = 220;
/** Minimum structure screen half-width (px) below which the readout is skipped. */
const MIN_STRUCT_SCREEN_HW = 16;
/** Rasterisation size for all PIXI.Text objects in readouts. */
const RASTER = 32;
/** Height of a readout/data row in world units. */
const READOUT_WORLD_H = 12;
/** Height of the status value text in world units. */
const STATUS_WORLD_H = 20;
/** Height of the subtle "STATUS" header in world units. */
const HEADER_WORLD_H = 9;
/** Line height per data row in world units (text height × leading). */
const READOUT_LINE_WH = READOUT_WORLD_H * 1.4;   // 22.4 wu
/** Line height for the status value line. */
const STATUS_LINE_WH = STATUS_WORLD_H * 1.3;      // 33.8 wu
/** Line height for the "STATUS" header. */
const HEADER_LINE_WH = HEADER_WORLD_H * 1.4;      // 16.8 wu
/** Top/bottom padding inside the panel, world units. */
const PANEL_PAD_WH = 10;
/** Left padding inside the panel, world units. */
const PANEL_PAD_WX = 12;
/** Gap between status section and data rows, world units. */
const SEP_WH = 10;
/** Approx char width for monospace text at READOUT_WORLD_H (world units). */
const CHAR_WW = READOUT_WORLD_H * 0.6;            // 9.6 wu per char

const READOUT_STYLE = new PIXI.TextStyle({
  fontFamily: 'monospace',
  fontSize: RASTER,
  fill: '#ffffff',
});

const STATUS_VALUE_STYLE = new PIXI.TextStyle({
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: RASTER,
  fontWeight: 'bold',
  fill: '#ffffff',
});

const STATUS_HEADER_STYLE = new PIXI.TextStyle({
  fontFamily: 'monospace',
  fontSize: RASTER,
  fill: '#555555',
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

// ── Status computation ───────────────────────────────────────────────────

interface StatusInfo { text: string; color: string; }

/** Derive a short (1–3 word) status string for the readout panel. */
function computeStructureStatus(
  structure: Structure,
  mgr: StructureManager | null,
): StatusInfo {
  if (structure.isDeconstructing) return { text: 'Deconstructing', color: '#cc6644' };

  if (!structure.isConstructed) {
    // Check if a connection to this structure is currently flashing (resources in transit)
    if (mgr) {
      const conns = mgr.gridManager.getConnections();
      const receiving = conns.some(
        c => (c.nodeA.id === structure.id || c.nodeB.id === structure.id) && c.isFlashing(),
      );
      if (receiving) return { text: 'Receiving', color: '#4488ff' };
    }
    return { text: 'Requesting', color: '#d4a843' };
  }

  if (!structure.isPoweredOn) return { text: 'Offline', color: '#555555' };

  // Battery: stunned takes priority
  if (structure.type === 'Battery' && structure.isPowerStunned()) {
    return { text: 'Stunned', color: '#cc4444' };
  }

  // Grid brownout / low power (only relevant for consumers)
  if (structure.definition.powerConsumption > 0 && mgr) {
    const summary = mgr.getTeamGridSummary(structure.team);
    if (summary) {
      if (summary.powerEfficiency <= 0) return { text: 'No Power', color: '#cc4444' };
      if (summary.powerEfficiency < 0.95) return { text: 'Low Power', color: '#ccaa44' };
    }
  }

  // Connection transfer flash (any connection from/to this structure actively flashing)
  if (mgr) {
    const conns = mgr.gridManager.getConnections();
    const transferring = conns.some(
      c => (c.nodeA.id === structure.id || c.nodeB.id === structure.id) && c.isFlashing(),
    );
    if (transferring) return { text: 'Transferring', color: '#4488ff' };
  }

  // Repair in progress
  if (structure.needsRepair()) return { text: 'Repairing', color: '#ccaa44' };

  // Structure-specific statuses
  if (structure instanceof StructureAssemblyYard) {
    if (structure.isAtShipCap()) return { text: 'At Capacity', color: '#ccaa44' };
    if (structure.getBuildFraction() > 0) return { text: 'Building', color: '#4488ff' };
    if (structure.getInventoryTotal() <= 0) return { text: 'No Materials', color: '#666666' };
    return { text: 'Idle', color: '#666666' };
  }

  if (structure instanceof StructureManufacturer) {
    if (structure.getBuildFraction() > 0) return { text: 'Working', color: '#aacc44' };
    return { text: 'Idle', color: '#666666' };
  }

  if (structure instanceof StructureRecycler) {
    if (structure.getInventoryTotal() > 0) return { text: 'Recycling', color: '#44ccaa' };
    return { text: 'Idle', color: '#666666' };
  }

  if (structure instanceof StructureTurret) {
    if (structure.hasActiveTarget()) return { text: 'Targeting', color: '#cc4444' };
    return { text: 'Armed', color: '#44cc44' };
  }

  if (structure instanceof StructureMiningPlatform) {
    if (structure.hasActiveTarget()) return { text: 'Mining', color: '#44ccaa' };
    return { text: 'Seeking', color: '#666666' };
  }

  // Refinery: check sensor area deposit state
  if (structure.type === 'Refinery' && mgr) {
    const states = mgr.getSensorAreaStates();
    const sensorState = states.find(s => s.structure.id === structure.id);
    if (sensorState?.depositing) return { text: 'Unloading', color: '#44cc44' };
    if (sensorState?.assemblyInside) return { text: 'Receiving', color: '#ccaa44' };
    if (structure.getInventoryTotal() > 0) return { text: 'Refining', color: '#aacc44' };
  }

  // Battery charge state
  if (structure.type === 'Battery') {
    const cap = structure.getPowerStorageCapacity();
    if (cap > 0) {
      const stored = structure.getStoredPower();
      if (stored >= cap * 0.99) return { text: 'Full', color: '#44cc44' };
      return { text: 'Charging', color: '#4488ff' };
    }
  }

  // Power producers (Solar, PowerStation, Core)
  if (structure.definition.powerOutput > 0) return { text: 'Generating', color: '#44cc44' };

  return { text: 'Active', color: '#888888' };
}

// ── Formatting helpers ──────────────────────────────────────────────────

/** Format a power value with auto-scaled unit (W / kW / MW). */
function formatPower(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MW`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)} kW`;
  return `${Math.round(value)} W`;
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

/** Per-structure readout display with its own CRT filter. */
interface ReadoutEntry {
  container: PIXI.Container;
  graphics: PIXI.Graphics;
  filter: CRTFilter;
  texts: PIXI.Text[];
  active: boolean;  // marked true each frame if used
}

export class StructureRenderer implements IRenderer {
  readonly renderPriority = 15;

  private graphics!: PIXI.Graphics;
  /** Parent container for all per-structure readout containers. */
  private readoutParent!: PIXI.Container;
  /** One readout entry per structure, keyed by structure ID. */
  private readoutMap = new Map<string, ReadoutEntry>();
  /** Container for non-CRT labels (BUILDING, sensor, shield wall text). */
  private labelContainer!: PIXI.Container;
  private labelPool: PIXI.Text[] = [];
  private crtTime = 0;

  constructor(
    private readonly getStructures: () => Structure[],
    private readonly getStructureManager: () => StructureManager | null,
    private readonly getShieldWalls: () => ShieldWall[],
  ) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
    this.readoutParent = new PIXI.Container();
    stage.addChild(this.readoutParent);
    this.labelContainer = new PIXI.Container();
    stage.addChild(this.labelContainer);
  }

  render(viewport: Viewport): void {
    this.graphics.clear();
    // Advance shared CRT time
    this.crtTime += 0.04;
    // Mark all readout entries as inactive; hide their contents
    for (const entry of this.readoutMap.values()) {
      entry.active = false;
      entry.graphics.clear();
      for (const t of entry.texts) t.visible = false;
    }
    // Hide all label pool texts
    for (const t of this.labelPool) t.visible = false;

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

      const hasParts = structure.definition.parts && structure.definition.parts.length > 0;

      if (hasParts) {
        // Composite parts rendering — draw each sub-part (base, turret, etc.)
        this.drawCompositeParts(structure, cx, cy, scale, isBuilding, isDeconstructing);
      } else {
        // Default single-shape rendering
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

        const fillAlpha = (isBuilding || isDeconstructing) ? 0.45 : 1.0;
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
        if (scale > 0.4) {
          const pct = Math.floor(frac * 100);
          this.placeLabel(`BUILDING ${pct}%`, cx, cy - hh - 12, BUILDING_LABEL_STYLE, 0.5);
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

        if (scale > 0.4) {
          const pct = Math.floor(frac * 100);
          this.placeLabel(`DECONSTRUCTING ${pct}%`, cx, cy - hh - 12, DECON_LABEL_STYLE, 0.5);
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

      // Structure-type-specific icons (only for non-composite, constructed structures)
      if (!hasParts) {
        // Shield fence icon (small shield emblem)
        if (!isBuilding && structure.type === 'ShieldFence') {
          this.drawShieldFenceIcon(cx, cy, Math.min(hw, hh) * 0.5, scale);
        }

        // Refinery icon + batch progress bar
        if (!isBuilding && structure.type === 'Refinery') {
          this.drawRefineryIcon(cx, cy, Math.min(hw, hh) * 0.4, scale);
          const refineFrac = structure.refiningProgress;
          if (refineFrac > 0) {
            const bBarW = Math.max(hw * 1.4, 14 * scale);
            const bBarH = Math.max(2, 4 * scale);
            this.graphics.lineStyle(0);
            this.graphics.beginFill(0x333333, 0.7);
            this.graphics.drawRect(cx - bBarW / 2, barY, bBarW, bBarH);
            this.graphics.endFill();
            this.graphics.beginFill(0x44cc88, 0.9);
            this.graphics.drawRect(cx - bBarW / 2, barY, bBarW * Math.min(refineFrac, 1), bBarH);
            this.graphics.endFill();
            barY += bBarH + 2;
          }
        }

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
      }

      // ── World-space readouts (power + storage) drawn ON the structure ──
      if (!SKIP_READOUT_TYPES.has(structure.type) && !hasParts) {
        this.renderStructureReadout(structure, cx, cy, hw, hh, scale, mgr);
      }
    }

    // Hide readout containers for structures that weren't rendered this frame;
    // remove stale entries for structures that no longer exist.
    for (const [_id, entry] of this.readoutMap) {
      if (entry.active) {
        entry.container.visible = true;
        entry.filter.time = this.crtTime;
        entry.filter.seed = Math.random();
      } else {
        entry.container.visible = false;
      }
    }

    // ── Sensor areas (e.g. Refinery ore deposit zone) ──────────────────
    this.renderSensorAreas(viewport);

    // ── Shield walls ──────────────────────────────────────────────────────
    this.renderShieldWalls(viewport);
  }

  // ── Per-structure readout management ─────────────────────────────────

  /** Get or create a readout entry (container + CRT filter) for a structure. */
  private getReadoutEntry(structureId: string): ReadoutEntry {
    let entry = this.readoutMap.get(structureId);
    if (!entry) {
      const container = new PIXI.Container();
      const graphics = new PIXI.Graphics();
      container.addChild(graphics);
      const filter = new CRTFilter({
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
      container.filters = [filter];
      this.readoutParent.addChild(container);
      entry = { container, graphics, filter, texts: [], active: false };
      this.readoutMap.set(structureId, entry);
    }
    entry.active = true;
    return entry;
  }

  // ── World-space readout drawn ON the structure body ─────────────────

  /**
   * Render a world-space readout panel physically painted onto the structure body.
   *
   * All dimensions are defined in world units and multiplied by `scale` (viewport
   * pixels-per-world-unit) so the panel scales and translates with the structure
   * exactly like any other world geometry. Rendering is skipped when the structure
   * is too small on screen (structure hw < MIN_STRUCT_SCREEN_HW px).
   *
   * Panel dimensions are FIXED world-unit constants (not derived from structure
   * size), so every structure gets an identically-proportioned display regardless
   * of its physical footprint.
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
    // Skip when structure is too small on screen to read
    if (hw < MIN_STRUCT_SCREEN_HW) return;

    const s = scale; // viewport pixels per world unit

    const def = structure.definition;

    // Each row is a sequence of text segments with individual colors
    interface TextSegment { text: string; color: string }
    interface ReadoutRow { segments: TextSegment[] }
    const rows: ReadoutRow[] = [];

    // ── Power row ────────────────────────────────────────────────────
    const isProducer = def.powerOutput > 0;
    const isConsumer = def.powerConsumption > 0;
    if (isProducer || isConsumer) {
      const active = structure.isPoweredOn && structure.isConstructed && !structure.isDeconstructing;
      const defValue = isProducer ? def.powerOutput : def.powerConsumption;
      // When powered off, show 0 rather than the definition value
      const effectiveValue = active ? defValue : 0;
      const valueColor = active
        ? (isProducer ? '#44cc44' : '#cc4444')
        : '#555555';
      rows.push({ segments: [
        { text: 'PWR  ', color: '#888888' },
        { text: formatPower(effectiveValue), color: valueColor },
      ]});
    }

    // ── Storage row ──────────────────────────────────────────────────
    if (def.storageCapacity > 0) {
      const used = structure.getInventoryTotal();
      const pct = Math.round((used / def.storageCapacity) * 100);
      const usedColor = pct >= 90 ? '#cc4444' : pct >= 60 ? '#ccaa44' : '#44cc44';
      // Keep current amount coloured; capacity + percentage dim — all in one
      // contiguous string per segment so x-positions never drift.
      rows.push({ segments: [
        { text: 'STR  ', color: '#777777' },
        { text: formatWeight(used), color: usedColor },
        { text: ` / ${formatWeight(def.storageCapacity)}  (${pct}%)`, color: '#555555' },
      ]});
    }

    // ── Battery power storage row ────────────────────────────────────
    if (def.powerStorageCapacity && def.powerStorageCapacity > 0) {
      const stored = structure.getStoredPower();
      const cap = def.powerStorageCapacity;
      const pct = Math.round((stored / cap) * 100);
      const storedColor = pct >= 90 ? '#44cc44' : pct >= 30 ? '#ccaa44' : '#cc4444';
      rows.push({ segments: [
        { text: 'BATT ', color: '#777777' },
        { text: formatPower(stored), color: storedColor },
        { text: ` / ${formatPower(cap)}  (${pct}%)`, color: '#555555' },
      ]});
    }

    // ── Type-specific extra row ──────────────────────────────────────
    if (structure instanceof StructureAssemblyYard && structure.isConstructed) {
      const count = structure.activeShipIds.length;
      rows.push({ segments: [
        { text: 'BLD  ', color: '#888888' },
        { text: `${count}/3 ships`, color: '#aaaaaa' },
      ]});
    } else if (structure instanceof StructureManufacturer && structure.isConstructed) {
      rows.push({ segments: [
        { text: 'MFG  ', color: '#888888' },
        { text: structure.getRecipeName(), color: '#aacc44' },
      ]});
    }

    // ── Compute world→screen layout ───────────────────────────────────
    const statusInfo = computeStructureStatus(structure, mgr);

    const panelW     = PANEL_WORLD_W   * s;
    const rowLineH   = READOUT_LINE_WH * s;
    const statusLineH = STATUS_LINE_WH * s;
    const headerLineH = HEADER_LINE_WH * s;
    const padY       = PANEL_PAD_WH    * s;
    const padX       = PANEL_PAD_WX    * s;
    const sepH       = SEP_WH          * s;
    const charW      = CHAR_WW         * s;

    const hasSeparator = rows.length > 0;
    const panelH = padY
      + headerLineH + statusLineH
      + (hasSeparator ? sepH + rows.length * rowLineH : 0)
      + padY;

    const margin = 1.5 * s;
    const boxX   = cx - hw + margin;
    const boxY   = cy - hh + margin;
    const radius = Math.max(1, 1.5 * s);

    // Text scales: rasterise at RASTER, display at world-unit height × scale
    const readoutScale = (READOUT_WORLD_H * s) / RASTER;
    const statusScale  = (STATUS_WORLD_H  * s) / RASTER;
    const headerScale  = (HEADER_WORLD_H  * s) / RASTER;

    // Get (or create) the CRT-filtered readout container for this structure
    const entry = this.getReadoutEntry(structure.id);

    // Black fill (CRT-filtered)
    entry.graphics.lineStyle(0);
    entry.graphics.beginFill(0x000000, 0.9);
    entry.graphics.drawRoundedRect(boxX, boxY, panelW, panelH, radius);
    entry.graphics.endFill();

    // Subtle border (non-CRT, drawn on shared graphics)
    this.graphics.lineStyle(Math.max(1, s * 0.5), 0xffffff, 0.4);
    this.graphics.beginFill(0x000000, 0);
    this.graphics.drawRoundedRect(boxX, boxY, panelW, panelH, radius);
    this.graphics.endFill();

    // ── Status header ("STATUS") — subtle monospace label ────────────
    let y = boxY + padY;
    this.placeReadoutText(
      entry, 'STATUS',
      boxX + padX, y,
      { ...STATUS_HEADER_STYLE, fontSize: RASTER, fill: '#444444' } as PIXI.TextStyle,
      0, 0, headerScale,
    );
    y += headerLineH;

    // ── Status value — large bold, coloured ──────────────────────────
    this.placeReadoutText(
      entry, statusInfo.text,
      boxX + padX, y,
      { ...STATUS_VALUE_STYLE, fontSize: RASTER, fill: statusInfo.color } as PIXI.TextStyle,
      0, 0, statusScale,
    );
    y += statusLineH;

    if (!hasSeparator) return;

    // ── Separator line ────────────────────────────────────────────────
    entry.graphics.lineStyle(Math.max(0.5, s * 0.3), 0x333333, 0.9);
    entry.graphics.moveTo(boxX + padX, y + sepH * 0.3);
    entry.graphics.lineTo(boxX + panelW - padX, y + sepH * 0.3);
    y += sepH;

    // ── Data rows ─────────────────────────────────────────────────────
    for (const row of rows) {
      let x = boxX + padX;
      for (const seg of row.segments) {
        this.placeReadoutText(
          entry, seg.text, x, y,
          { ...READOUT_STYLE, fontSize: RASTER, fill: seg.color } as PIXI.TextStyle,
          0, 0, readoutScale,
        );
        x += seg.text.length * charW;
      }
      y += rowLineH;
    }
  }

  // ── Sensor areas ──────────────────────────────────────────────────────

  /** Render sensor area zones (dashed circle + floating text). */
  private renderSensorAreas(viewport: Viewport): void {
    const sm = this.getStructureManager();
    if (!sm) return;
    const states = sm.getSensorAreaStates();
    if (states.length === 0) return;

    for (const { structure, assemblyInside, depositing, sensorRadius } of states) {
      const pos = viewport.worldToScreen(structure.body.position.x, structure.body.position.y);
      const r = sensorRadius * viewport.scale;

      // Draw dashed circle outline
      const color = depositing ? 0x44cc44 : (assemblyInside ? 0xcccc44 : 0x448844);
      const alpha = depositing ? 0.5 : 0.25;
      this.graphics.lineStyle(2, color, alpha);
      const segments = 32;
      for (let i = 0; i < segments; i++) {
        // Draw every other segment for dashed effect
        if (i % 2 === 0) {
          const a0 = (i / segments) * Math.PI * 2;
          const a1 = ((i + 1) / segments) * Math.PI * 2;
          this.graphics.moveTo(pos.x + Math.cos(a0) * r, pos.y + Math.sin(a0) * r);
          this.graphics.lineTo(pos.x + Math.cos(a1) * r, pos.y + Math.sin(a1) * r);
        }
      }

      // Floating text
      if (viewport.scale > 0.4 * 0.5) {
        const label = depositing ? 'DEPOSITING...' : 'DROP ORE HERE';
        const style = new PIXI.TextStyle({
          fontFamily: 'monospace',
          fontSize: depositing ? 12 : 10,
          fill: depositing ? '#44ff44' : '#88cc88',
          fontWeight: 'bold',
        });
        this.placeLabel(label, pos.x, pos.y - r - 12, style, 0.5, 0.5);
      }
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
          this.placeLabel(label, midX, midY - wallWidth - 10, NO_POWER_STYLE, 0.5);
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

  /** Place text inside a per-structure readout container (affected by CRT filter). */
  private placeReadoutText(
    entry: ReadoutEntry,
    content: string,
    x: number,
    y: number,
    style: PIXI.TextStyle,
    anchorX: number,
    anchorY: number = 0,
    textScale: number = 1,
  ): void {
    let text = entry.texts.find(t => !t.visible);
    if (!text) {
      text = new PIXI.Text('', style);
      entry.container.addChild(text);
      entry.texts.push(text);
    }
    text.style = style;
    text.text = content;
    text.scale.set(textScale);
    text.x = x;
    text.y = y;
    text.anchor.set(anchorX, anchorY);
    text.visible = true;
  }

  /** Place text in the non-CRT label container (BUILDING, sensor, shield wall text). */
  private placeLabel(
    content: string,
    x: number,
    y: number,
    style: PIXI.TextStyle,
    anchorX: number,
    anchorY: number = 0,
    textScale: number = 1,
  ): void {
    let text = this.labelPool.find(t => !t.visible);
    if (!text) {
      text = new PIXI.Text('', style);
      this.labelContainer.addChild(text);
      this.labelPool.push(text);
    }
    text.style = style;
    text.text = content;
    text.scale.set(textScale);
    text.x = x;
    text.y = y;
    text.anchor.set(anchorX, anchorY);
    text.visible = true;
  }

  // ── Composite structure parts ───────────────────────────────────────────

  /**
   * Draw all sub-parts of a composite structure (base, turret arm, etc.).
   * Parts are drawn in zOrder. 'aim' parts rotate with structure.currentAimAngle.
   */
  private drawCompositeParts(
    structure: Structure,
    cx: number, cy: number,
    scale: number,
    isBuilding: boolean,
    isDeconstructing: boolean,
  ): void {
    const parts = structure.definition.parts!;
    const sorted = [...parts].sort((a, b) => a.zOrder - b.zOrder);
    const aimAngle = structure.currentAimAngle;
    const fillAlphaBase = (isBuilding || isDeconstructing) ? 0.45 : 1.0;
    const borderAlpha = (isBuilding || isDeconstructing) ? 0.6 : 1;

    for (const part of sorted) {
      // Compute part center in screen coords
      let partCx: number;
      let partCy: number;
      let partAngle: number;

      if (part.rotation === 'aim') {
        // Resolve aim angle: use turretIndex if defined, otherwise single currentAimAngle
        const resolvedAngle = (part.turretIndex !== undefined && structure.turretAngles.length > part.turretIndex)
          ? structure.turretAngles[part.turretIndex]
          : aimAngle;
        // offsetX/Y is the true rotation pivot; forwardOffset shifts the drawn shape
        // forward along the aim angle (e.g. so a barrel overhangs its mount).
        const pivot = {
          x: cx + part.offsetX * scale,
          y: cy + part.offsetY * scale,
        };
        const fwd = (part.forwardOffset ?? 0) * scale;
        partCx = pivot.x + Math.cos(resolvedAngle) * fwd;
        partCy = pivot.y + Math.sin(resolvedAngle) * fwd;
        partAngle = resolvedAngle;
      } else {
        // Fixed parts can have a fixedAngle for angled arms
        const fixedAngle = part.fixedAngle ?? 0;
        if (Math.abs(fixedAngle) > 0.001) {
          // Offset is defined in the arm's direction — not rotated, offset already in world frame
          partCx = cx + part.offsetX * scale;
          partCy = cy + part.offsetY * scale;
          partAngle = fixedAngle;
        } else {
          partCx = cx + part.offsetX * scale;
          partCy = cy + part.offsetY * scale;
          partAngle = 0;
        }
      }

      const phw = (part.widthPx / 2) * scale;
      const phh = (part.heightPx / 2) * scale;
      const lw = Math.max(1, (part.lineWidth ?? 2) * scale);

      // Dark background for construction/deconstruction
      if (isBuilding || isDeconstructing) {
        this.graphics.lineStyle(0);
        this.graphics.beginFill(0x0a0a0a, 0.9);
        this.drawPartShape(part.shape, partCx, partCy, phw, phh, partAngle);
        this.graphics.endFill();
      }

      // Fill + border
      const fillColor = (isBuilding || isDeconstructing)
        ? (isDeconstructing ? 0x1a0a0a : 0x1a1a10)
        : PIXI.utils.string2hex(part.color);
      const borderColor = isDeconstructing
        ? DECONSTRUCTION_COLOR
        : (isBuilding ? CONSTRUCTION_BORDER_COLOR : PIXI.utils.string2hex(part.borderColor));

      this.graphics.lineStyle(lw, borderColor, borderAlpha);
      this.graphics.beginFill(fillColor, fillAlphaBase);
      this.drawPartShape(part.shape, partCx, partCy, phw, phh, partAngle);
      this.graphics.endFill();

      // Draw detail elements (only when not building)
      if (!isBuilding && part.details) {
        this.drawPartDetails(part.details, partCx, partCy, partAngle, scale);
      }
    }

    // Cross-hatch overlay over the entire structure footprint
    const hw = (structure.definition.widthPx / 2) * scale;
    const hh = (structure.definition.heightPx / 2) * scale;
    if (isBuilding && hw > 3) {
      this.drawCrossHatch(cx, cy, hw, hh, scale, structure.definition.shape === 'hex');
    }

    // Powered-off X overlay
    if (!structure.isPoweredOn && structure.isConstructed && !isDeconstructing) {
      const lw = Math.max(1, 2 * scale);
      this.graphics.lineStyle(lw, 0xcc4444, 0.4);
      this.graphics.moveTo(cx - hw * 0.5, cy - hh * 0.5);
      this.graphics.lineTo(cx + hw * 0.5, cy + hh * 0.5);
      this.graphics.moveTo(cx + hw * 0.5, cy - hh * 0.5);
      this.graphics.lineTo(cx - hw * 0.5, cy + hh * 0.5);
    }
  }

  /** Draw a shape (rect, hex, circle) at a given screen position with optional rotation. */
  private drawPartShape(
    shape: StructurePartDefinition['shape'],
    cx: number, cy: number,
    hw: number, hh: number,
    angle: number,
  ): void {
    if (shape === 'hex') {
      this.drawHexagon(cx, cy, hw);
    } else if (shape === 'circle') {
      this.graphics.drawCircle(cx, cy, hw);
    } else {
      // Rotated rectangle
      if (Math.abs(angle) < 0.001) {
        this.graphics.drawRect(cx - hw, cy - hh, hw * 2, hh * 2);
      } else {
        this.drawRotatedRect(cx, cy, hw, hh, angle);
      }
    }
  }

  /** Draw a rotated rectangle by computing corner vertices. */
  private drawRotatedRect(
    cx: number, cy: number,
    hw: number, hh: number,
    angle: number,
  ): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Corners relative to center, then rotated
    const corners = [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ];
    for (let i = 0; i < 4; i++) {
      const rx = corners[i].x * cos - corners[i].y * sin + cx;
      const ry = corners[i].x * sin + corners[i].y * cos + cy;
      if (i === 0) this.graphics.moveTo(rx, ry);
      else this.graphics.lineTo(rx, ry);
    }
    this.graphics.closePath();
  }

  /** Draw decorative detail elements within a part, transformed by part angle. */
  private drawPartDetails(
    details: StructurePartDetail[],
    partCx: number, partCy: number,
    angle: number,
    scale: number,
  ): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Transform a part-local point to screen coords
    const tx = (lx: number, ly: number) => partCx + (lx * cos - ly * sin) * scale;
    const ty = (lx: number, ly: number) => partCy + (lx * sin + ly * cos) * scale;

    for (const d of details) {
      const alpha = d.alpha ?? 1;
      const lw = Math.max(1, (d.lineWidth ?? 1.5) * scale);

      if (d.type === 'line') {
        this.graphics.lineStyle(lw, PIXI.utils.string2hex(d.color), alpha);
        this.graphics.moveTo(tx(d.x1 ?? 0, d.y1 ?? 0), ty(d.x1 ?? 0, d.y1 ?? 0));
        this.graphics.lineTo(tx(d.x2 ?? 0, d.y2 ?? 0), ty(d.x2 ?? 0, d.y2 ?? 0));
      } else if (d.type === 'circle') {
        const dcx = tx(d.cx ?? 0, d.cy ?? 0);
        const dcy = ty(d.cx ?? 0, d.cy ?? 0);
        const r = (d.radius ?? 5) * scale;
        if (d.fill) {
          this.graphics.lineStyle(0);
          this.graphics.beginFill(PIXI.utils.string2hex(d.color), alpha);
          this.graphics.drawCircle(dcx, dcy, r);
          this.graphics.endFill();
        } else {
          this.graphics.lineStyle(lw, PIXI.utils.string2hex(d.color), alpha);
          this.graphics.drawCircle(dcx, dcy, r);
        }
      } else if (d.type === 'rect') {
        const rx = d.x ?? 0;
        const ry = d.y ?? 0;
        const rw = d.w ?? 10;
        const rh = d.h ?? 10;
        // Draw as a rotated rect centered on the detail's center
        const rcx = rx + rw / 2;
        const rcy = ry + rh / 2;
        const screenCx = tx(rcx, rcy);
        const screenCy = ty(rcx, rcy);
        const rhw = (rw / 2) * scale;
        const rhh = (rh / 2) * scale;
        if (d.fill) {
          this.graphics.lineStyle(0);
          this.graphics.beginFill(PIXI.utils.string2hex(d.color), alpha);
          this.drawRotatedRect(screenCx, screenCy, rhw, rhh, angle);
          this.graphics.endFill();
        } else {
          this.graphics.lineStyle(lw, PIXI.utils.string2hex(d.color), alpha);
          this.graphics.beginFill(0, 0);
          this.drawRotatedRect(screenCx, screenCy, rhw, rhh, angle);
          this.graphics.endFill();
        }
      }
    }
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
