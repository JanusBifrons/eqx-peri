import { useEffect, useRef } from 'react';
import { GameEngine } from '../game/core/GameEngine';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Base size (px) of each action button at scale=1. Keep in sync with WorldOverlayPanel. */
export const OVERLAY_BUTTON_BASE_SIZE = 26;

/** Minimum viewport scale below which the overlay is hidden. */
const MIN_OVERLAY_SCALE = 0.3;

// ── Anchor type ───────────────────────────────────────────────────────────────

/**
 * Screen-space position of the bracket's top-left corner and its half-size.
 *
 * - `sx` / `sy`  — pixel coordinates of the top-left corner of the selection bracket
 *                  (same value that ShipHighlightRenderer draws at).
 * - `hs`         — bracket half-size in screen pixels, used to scale margin and gap
 *                  so small targets get tight spacing and large targets get generous spacing.
 *
 * Compute `hs` with the same formula ShipHighlightRenderer uses:
 *   `hs = Math.max(MIN_HALF_PX, worldRadius * viewportScale) + SCREEN_PAD`
 * where `MIN_HALF_PX = 20` and `SCREEN_PAD = 12`.
 */
export interface ScreenAnchor {
  sx: number;
  sy: number;
  hs: number;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Manages a RAF-based position tracker for a world-space-anchored DOM overlay.
 *
 * `getScreenAnchor` is called every animation frame. It should return a
 * `ScreenAnchor` with the bracket's **screen-pixel** top-left + half-size, or
 * `null` to hide the panel.
 *
 * Position, gap, and visibility are updated imperatively via `containerRef` to
 * avoid React re-renders on every camera-pan or zoom tick.
 *
 * Margin and gap auto-scale with `hs` (bracket screen size):
 *   - cockpit (hs ≈ 32 px)  → margin 2 px, gap 3 px
 *   - structure (hs ≈ 62 px) → margin 4 px, gap 5 px
 *   - capital   (hs ≥ 200 px) → margin 6 px, gap 8 px
 */
export function useWorldOverlay(
  gameEngine: GameEngine | null,
  getScreenAnchor: () => ScreenAnchor | null,
): React.RefObject<HTMLDivElement> {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep latest callback in a ref so the RAF closure always calls the current
  // version without restarting the effect when the parent re-renders.
  const anchorRef = useRef(getScreenAnchor);
  anchorRef.current = getScreenAnchor;

  useEffect(() => {
    if (!gameEngine) return;
    let rafId = 0;

    const tick = (): void => {
      const el = containerRef.current;
      if (!el) { rafId = requestAnimationFrame(tick); return; }

      const scale = gameEngine.getViewportScale();
      if (scale < MIN_OVERLAY_SCALE) {
        el.style.visibility = 'hidden';
        rafId = requestAnimationFrame(tick);
        return;
      }

      const anchor = anchorRef.current();
      if (!anchor) {
        el.style.visibility = 'hidden';
        rafId = requestAnimationFrame(tick);
        return;
      }

      const { sx, sy, hs } = anchor;

      // Margin and gap scale with the bracket's screen size.
      const margin = Math.max(2, Math.min(6, hs * 0.06));
      const gap    = Math.max(2, Math.min(8, hs * 0.08));

      const btnScale   = Math.max(0.5, Math.min(1.5, scale));
      const scaledSize = OVERLAY_BUTTON_BASE_SIZE * btnScale;

      // Start at the bracket's top-left corner, offset by margin.
      // Sit just above the bracket's top edge.
      el.style.left       = `${Math.round(sx + margin)}px`;
      el.style.top        = `${Math.round(sy - scaledSize - margin)}px`;
      el.style.gap        = `${gap}px`;
      el.style.visibility = 'visible';

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [gameEngine]);

  return containerRef;
}

// ── Bracket helpers ───────────────────────────────────────────────────────────

// These must match ShipHighlightRenderer's constants exactly.
const BRACKET_SCREEN_PAD  = 12;
const BRACKET_MIN_HALF_PX = 20;

/**
 * Compute the screen-space `ScreenAnchor` for a circular/square world entity.
 *
 * Pass the entity's world-space centre and bounding radius.
 * Returns `null` if the engine isn't initialised or the entity is off-screen.
 */
export function computeScreenAnchor(
  gameEngine: GameEngine,
  worldCX: number,
  worldCY: number,
  worldRadius: number,
): ScreenAnchor | null {
  const sp = gameEngine.worldToScreen(worldCX, worldCY);
  if (!sp) return null;
  const scale = gameEngine.getViewportScale();
  const hs = Math.max(BRACKET_MIN_HALF_PX, worldRadius * scale) + BRACKET_SCREEN_PAD;
  return { sx: sp.x - hs, sy: sp.y - hs, hs };
}
