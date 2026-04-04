import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface GalaxyStore {
  /** IDs of sectors the player has captured. */
  capturedSectors: string[];
  /** Mark a sector as captured. */
  captureSector: (id: string) => void;
}

export const useGalaxyStore = create<GalaxyStore>()(
  persist(
    (set) => ({
      capturedSectors: [],
      captureSector: (id: string) =>
        set((state) => ({
          capturedSectors: state.capturedSectors.includes(id)
            ? state.capturedSectors
            : [...state.capturedSectors, id],
        })),
    }),
    { name: 'eqx-galaxy' },
  ),
);
