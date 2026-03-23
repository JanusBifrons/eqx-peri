import React from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { styled } from '@mui/material/styles';
import { GameEngine } from '../game/core/GameEngine';
import { useGameStore } from '../stores/gameStore';
import { useWorldOverlay, OVERLAY_BUTTON_BASE_SIZE, ScreenAnchor } from './useWorldOverlay';

export type { ScreenAnchor };

// ── Types ────────────────────────────────────────────────────────────────────

export interface OverlayButton {
  key: string;
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  /** Optional tint color (CSS string). Dark background + colored border when set. */
  color?: string;
  disabled?: boolean;
}

interface Props {
  gameEngine: GameEngine | null;
  /**
   * Called each animation frame. Return a `ScreenAnchor` with the bracket's
   * screen-pixel top-left and half-size, or `null` to hide the panel.
   * Use `computeScreenAnchor()` from `useWorldOverlay` to compute this.
   */
  getScreenAnchor: () => ScreenAnchor | null;
  buttons: OverlayButton[];
}

// ── Styled container ─────────────────────────────────────────────────────────

const OverlayContainer = styled(Box)(() => ({
  position: 'absolute',
  pointerEvents: 'auto',
  display: 'flex',
  flexDirection: 'row',
  zIndex: 1500,
}));

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Generic world-space-anchored action panel.
 *
 * Renders a horizontal row of icon buttons that track a world-space entity's
 * selection bracket with zero React re-render overhead for position/zoom updates.
 *
 * Supply a `getScreenAnchor` function (called every rAF tick) that returns the
 * bracket's screen-space top-left corner and half-size — use `computeScreenAnchor`
 * from `useWorldOverlay.ts` to compute it. Return `null` to hide the panel.
 */
const WorldOverlayPanel: React.FC<Props> = ({ gameEngine, getScreenAnchor, buttons }) => {
  const containerRef = useWorldOverlay(gameEngine, getScreenAnchor);
  const viewportScale = useGameStore(s => s.viewportScale);

  const btnScale   = Math.max(0.5, Math.min(1.5, viewportScale));
  const scaledSize = OVERLAY_BUTTON_BASE_SIZE * btnScale;

  return (
    <OverlayContainer ref={containerRef} sx={{ visibility: 'hidden' }}>
      {buttons.map((btn) => {
        const hasColor = !!btn.color;
        return (
          <Tooltip key={btn.key} title={btn.tooltip} placement="top" arrow>
            {/* span wrapper required so Tooltip still works when button is disabled */}
            <span>
              <IconButton
                size="small"
                onClick={btn.onClick}
                disabled={btn.disabled}
                sx={{
                  width:     scaledSize,
                  height:    scaledSize,
                  fontSize:  scaledSize * 0.65,
                  color:           hasColor ? btn.color : '#111',
                  backgroundColor: hasColor ? 'rgba(10, 12, 18, 0.85)' : 'rgba(240, 240, 240, 0.92)',
                  border:          hasColor
                    ? `1px solid ${btn.color}`
                    : '1px solid rgba(255,255,255,0.6)',
                  borderRadius: 1,
                  '&:hover': {
                    backgroundColor: hasColor ? 'rgba(30, 35, 50, 0.95)' : 'rgba(255, 255, 255, 1)',
                    borderColor: '#00ccff',
                  },
                  '&.Mui-disabled': { opacity: 0.4 },
                }}
              >
                {btn.icon}
              </IconButton>
            </span>
          </Tooltip>
        );
      })}
    </OverlayContainer>
  );
};

export default WorldOverlayPanel;
