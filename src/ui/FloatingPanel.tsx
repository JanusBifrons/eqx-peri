/**
 * FloatingPanel — a generic draggable, resizable panel with localStorage persistence.
 *
 * ## Usage
 * ```tsx
 * <FloatingPanel
 *   storageKey="my-panel"          // unique key; saved as "eqx-panel-my-panel" in localStorage
 *   title="My Panel"
 *   defaultPos={{ x: 72, y: 200 }} // first-launch position (choose to avoid known fixed UI)
 *   defaultSize={{ w: 220, h: 360 }}
 * >
 *   {/* panel content *\/}
 * </FloatingPanel>
 * ```
 *
 * ## Choosing defaultPos
 * Fixed UI anchors to avoid:
 *   - MiniDrawer (left sidebar): x < 60
 *   - ObjectivesPanel (top-left): roughly x 68–330, y 16–220
 *   - WaveInfoPanel (top-right): roughly right 16–270, y 16–100
 *
 * Recommended safe columns:
 *   - Left column (below objectives): x=72, y ≥ 230
 *   - Far-left clear column: x=72, y=80 (no sector conquest panels)
 *   - Right column: x=window.innerWidth-240, y=120 (avoids wave panel)
 *
 * ## Persistence
 * Position and size are saved to localStorage under the key `eqx-panel-<storageKey>` whenever
 * the user finishes dragging or resizing. The saved state is read once on mount; stale/invalid
 * JSON is discarded silently.
 *
 * ## Clamping
 * On mount, the resolved position is clamped inside the current viewport so off-screen panels
 * (e.g. from a smaller previous window) snap back into view.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

const STORAGE_PREFIX = 'eqx-panel-';
const TITLE_BAR_HEIGHT = 28;

interface SavedPanelState {
  x: number;
  y: number;
  w: number;
  h: number;
}

function loadSavedState(key: string): SavedPanelState | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedPanelState>;
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.w === 'number' &&
      typeof parsed.h === 'number'
    ) {
      return parsed as SavedPanelState;
    }
    return null;
  } catch {
    return null;
  }
}

function persistState(key: string, state: SavedPanelState): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state));
  } catch {
    // Ignore quota errors
  }
}

/** Clamp pos so the panel title bar is always reachable within the viewport. */
function clampPos(x: number, y: number, w: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, Math.max(0, window.innerWidth - w))),
    y: Math.max(0, Math.min(y, Math.max(0, window.innerHeight - TITLE_BAR_HEIGHT))),
  };
}

export interface FloatingPanelProps {
  /** Unique identifier; determines the localStorage key. */
  storageKey: string;
  /** Text shown in the title/drag bar. */
  title: string;
  /** First-launch position in pixels from top-left of the viewport. Choose to avoid fixed UI. */
  defaultPos?: { x: number; y: number };
  /** First-launch size in pixels. */
  defaultSize?: { w: number; h: number };
  /** Minimum width in px (default 160). */
  minWidth?: number;
  /** Minimum height in px (default 120). */
  minHeight?: number;
  children: React.ReactNode;
}

const FloatingPanel: React.FC<FloatingPanelProps> = ({
  storageKey,
  title,
  defaultPos = { x: 72, y: 200 },
  defaultSize = { w: 220, h: 360 },
  minWidth = 160,
  minHeight = 120,
  children,
}) => {
  // Initialise from localStorage, falling back to defaults. Clamp on mount.
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const saved = loadSavedState(storageKey);
    const raw = saved ? { x: saved.x, y: saved.y } : defaultPos;
    return clampPos(raw.x, raw.y, saved?.w ?? defaultSize.w);
  });
  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    const saved = loadSavedState(storageKey);
    return saved
      ? { w: Math.max(minWidth, saved.w), h: Math.max(minHeight, saved.h) }
      : defaultSize;
  });

  // Persist whenever pos or size settles (after mouse-up, handled in event listeners below).
  const persistRef = useRef({ pos, size, storageKey });
  persistRef.current = { pos, size, storageKey };

  // Re-clamp if the window is resized and the panel would be off-screen.
  useEffect(() => {
    const onResize = (): void => {
      setPos(p => clampPos(p.x, p.y, size.w));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [size.w]);

  // ── Drag ──────────────────────────────────────────────────────────────────
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };

    const onMove = (ev: MouseEvent): void => {
      if (!dragState.current) return;
      const next = clampPos(
        dragState.current.origX + (ev.clientX - dragState.current.startX),
        dragState.current.origY + (ev.clientY - dragState.current.startY),
        persistRef.current.size.w,
      );
      setPos(next);
    };

    const onUp = (): void => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      persistState(persistRef.current.storageKey, { ...persistRef.current.pos, ...persistRef.current.size });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos.x, pos.y]);

  // ── Resize ────────────────────────────────────────────────────────────────
  const resizeState = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeState.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h };

    const onMove = (ev: MouseEvent): void => {
      if (!resizeState.current) return;
      setSize({
        w: Math.max(minWidth, resizeState.current.origW + (ev.clientX - resizeState.current.startX)),
        h: Math.max(minHeight, resizeState.current.origH + (ev.clientY - resizeState.current.startY)),
      });
    };

    const onUp = (): void => {
      resizeState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      persistState(persistRef.current.storageKey, { ...persistRef.current.pos, ...persistRef.current.size });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size.w, size.h, minWidth, minHeight]);

  return (
    <Box
      sx={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'rgba(10, 12, 18, 0.92)',
        border: '1px solid rgba(0, 204, 255, 0.3)',
        borderRadius: '6px',
        overflow: 'hidden',
        zIndex: 1100,
        pointerEvents: 'auto',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.55)',
      }}
    >
      {/* Title / drag bar */}
      <Box
        onMouseDown={onDragStart}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          height: TITLE_BAR_HEIGHT,
          px: 1,
          flexShrink: 0,
          backgroundColor: 'rgba(0, 204, 255, 0.08)',
          borderBottom: '1px solid rgba(0, 204, 255, 0.2)',
          cursor: 'grab',
          userSelect: 'none',
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicatorIcon sx={{ color: 'rgba(0,204,255,0.4)', fontSize: 14 }} />
        <Typography sx={{ fontFamily: 'monospace', fontSize: '0.72rem', fontWeight: 700, color: '#00ccff', letterSpacing: '0.06em' }}>
          {title}
        </Typography>
      </Box>

      {/* Scrollable content area */}
      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', p: 1.25 }}>
        {children}
      </Box>

      {/* Resize handle — bottom-right corner */}
      <Box
        onMouseDown={onResizeStart}
        sx={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 16,
          height: 16,
          cursor: 'nwse-resize',
          '&::after': {
            content: '""',
            position: 'absolute',
            right: 3,
            bottom: 3,
            width: 9,
            height: 9,
            borderRight: '2px solid rgba(0,204,255,0.35)',
            borderBottom: '2px solid rgba(0,204,255,0.35)',
          },
        }}
      />
    </Box>
  );
};

export default FloatingPanel;
