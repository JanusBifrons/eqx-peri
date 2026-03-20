import { create } from 'zustand';
import { Assembly } from '../game/core/Assembly';
import { Structure } from '../game/structures/Structure';
import { PerformanceMetrics, StructureType } from '../types/GameTypes';

// ── Derived screen-space data for structure action buttons ──────────
export interface StructureScreenState {
  screenX: number;
  screenY: number;
  scale: number;
}

// ── Power system slice ──────────────────────────────────────────────
export interface PowerSystemState {
  totalPower: number;
  availablePower: number;
  systems: {
    name: string;
    key: string;
    maxPower: number;
    currentPower: number;
  }[];
}

// ── Radar data item ─────────────────────────────────────────────────
export interface RadarBlip {
  id: string;
  shipName: string;
  x: number;
  y: number;
  team: number;
  isPlayer: boolean;
  isSelected: boolean;
  isHovered: boolean;
  distance: number;
  speed: number;
  healthPercent: number;
  hasControlCenter: boolean;
}

// ── Store interface ─────────────────────────────────────────────────
export interface GameStore {
  // ── Core state ──────────────────────────────────────────────────
  /** Whether a player is piloting a ship (false = observer mode). */
  isObserverMode: boolean;

  /** The player's piloted assembly, or null in observer mode. */
  playerAssembly: Assembly | null;

  /** Currently selected assembly (click-selected in the world). */
  selectedAssembly: Assembly | null;

  /** Currently hovered assembly (mouse-over in the world). */
  hoveredAssembly: Assembly | null;

  /** Currently selected structure (click-selected in the world). */
  selectedStructure: Structure | null;

  // ── Viewport ────────────────────────────────────────────────────
  /** Pixels per world unit at the current zoom level. */
  viewportScale: number;

  /** Current zoom multiplier. */
  currentZoom: number;

  /** Whether speed-based zoom is enabled. */
  speedBasedZoom: boolean;

  // ── Player ship state ───────────────────────────────────────────
  playerSpeed: number;
  inertialDampening: boolean;
  canEject: boolean;
  playerDamagePercent: number;

  // ── Structure action panel helpers ──────────────────────────────
  /** Screen-space position + scale for the selected structure. Null if offscreen/no selection. */
  structureScreen: StructureScreenState | null;

  // ── Structure placement ─────────────────────────────────────────
  /** The structure type currently being placed, or null. */
  placingStructureType: StructureType | null;

  // ── Performance metrics ─────────────────────────────────────────
  performanceMetrics: PerformanceMetrics;

  // ── Power management ────────────────────────────────────────────
  powerState: PowerSystemState | null;

  // ── Selected assembly helpers ──────────────────────────────────
  /** Whether the currently selected assembly has an active AI controller. */
  selectedAssemblyAIEnabled: boolean;

  // ── Radar ───────────────────────────────────────────────────────
  radarBlips: RadarBlip[];

  // ── Frame counter (increments each push, triggers subscribers) ─
  frameTick: number;

  // ── Batch setter — called once per game frame from GameEngine ──
  pushFrame: (patch: Partial<Omit<GameStore, 'pushFrame'>>) => void;
}

const DEFAULT_PERF: PerformanceMetrics = {
  fps: 0,
  tickMs: 0,
  memoryMb: null,
  physicsBodyCount: 0,
  assemblyCount: 0,
  entityCount: 0,
  laserCount: 0,
  missileCount: 0,
  collisionsPerSecond: 0,
};

export const useGameStore = create<GameStore>((set) => ({
  // Defaults
  isObserverMode: true,
  playerAssembly: null,
  selectedAssembly: null,
  hoveredAssembly: null,
  selectedStructure: null,
  viewportScale: 1,
  currentZoom: 1,
  speedBasedZoom: true,
  playerSpeed: 0,
  inertialDampening: false,
  canEject: false,
  playerDamagePercent: 0,
  structureScreen: null,
  placingStructureType: null,
  performanceMetrics: DEFAULT_PERF,
  powerState: null,
  selectedAssemblyAIEnabled: false,
  radarBlips: [],
  frameTick: 0,

  pushFrame: (patch) => set((state) => ({ ...patch, frameTick: state.frameTick + 1 })),
}));
