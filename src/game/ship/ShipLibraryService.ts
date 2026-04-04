import shipsData from '../../data/ships.json';
import { EntityConfig, ENTITY_DEFINITIONS, EntityType } from '../../types/GameTypes';

const STORAGE_KEY = 'eqx_ship_library_v1';

export interface ShipRecord {
  id: string;
  name: string;
  parts: EntityConfig[];
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
  isBuiltIn?: true;
}

export interface ShipStats {
  blockCount: number;
  totalMass: number;
  engineCount: number;
  weaponCount: number;
}

const ENGINE_TYPES = new Set<string>(['Engine', 'LargeEngine', 'CapitalEngine']);
const WEAPON_TYPES = new Set<string>([
  'Gun', 'LargeGun', 'CapitalWeapon', 'Beam', 'LargeBeam',
  'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher',
  'PDC', 'Harpoon', 'TractorBeam', 'MiningLaser',
]);

export function computeShipStats(parts: EntityConfig[]): ShipStats {
  let totalMass = 0;
  let engineCount = 0;
  let weaponCount = 0;
  for (const part of parts) {
    const def = ENTITY_DEFINITIONS[part.type as EntityType];
    if (def) totalMass += def.mass;
    if (ENGINE_TYPES.has(part.type)) engineCount++;
    if (WEAPON_TYPES.has(part.type)) weaponCount++;
  }
  return { blockCount: parts.length, totalMass, engineCount, weaponCount };
}

function makeBuiltInShips(): ShipRecord[] {
  return shipsData.ships.map((s, i) => ({
    id: `builtin-${i}`,
    name: s.name,
    parts: s.parts as EntityConfig[],
    createdAt: '',
    updatedAt: '',
    isBuiltIn: true as const,
  }));
}

export class ShipLibraryService {
  private userShips: ShipRecord[];

  constructor() {
    this.userShips = this.loadFromStorage();
  }

  private loadFromStorage(): ShipRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ShipRecord[]) : [];
    } catch {
      return [];
    }
  }

  private saveToStorage(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.userShips));
  }

  getAll(): ShipRecord[] {
    const user = [...this.userShips].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return [...makeBuiltInShips(), ...user];
  }

  create(name: string, parts: EntityConfig[]): ShipRecord {
    const now = new Date().toISOString();
    const record: ShipRecord = {
      id: crypto.randomUUID(),
      name,
      parts,
      createdAt: now,
      updatedAt: now,
    };
    this.userShips.push(record);
    this.saveToStorage();
    return record;
  }

  update(id: string, patch: Partial<Pick<ShipRecord, 'name' | 'parts'>>): ShipRecord | null {
    const idx = this.userShips.findIndex(s => s.id === id);
    if (idx === -1) return null;
    const updated: ShipRecord = {
      ...this.userShips[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.userShips[idx] = updated;
    this.saveToStorage();
    return updated;
  }

  delete(id: string): boolean {
    const before = this.userShips.length;
    this.userShips = this.userShips.filter(s => s.id !== id);
    if (this.userShips.length === before) return false;
    this.saveToStorage();
    return true;
  }

  getById(id: string): ShipRecord | undefined {
    return this.getAll().find(s => s.id === id);
  }
}

export const shipLibraryService = new ShipLibraryService();
