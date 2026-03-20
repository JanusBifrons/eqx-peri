import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { styled } from '@mui/material/styles';
import DeconstructIcon from '@mui/icons-material/DeleteForever';
import CancelDeconIcon from '@mui/icons-material/Cancel';
import BoltIcon from '@mui/icons-material/Bolt';
import InventoryIcon from '@mui/icons-material/Inventory2';
import SettingsIcon from '@mui/icons-material/Settings';
import { GameEngine } from '../game/core/GameEngine';
import GenericModal from './GenericModal';
import CargoModal from './CargoModal';
import { useGameStore } from '../stores/gameStore';

interface Props {
  gameEngine: GameEngine | null;
}

/** Minimum zoom scale below which action buttons are hidden. */
const MIN_ACTION_SCALE = 0.3;

/** Base size (px) of each action button at scale=1. */
const BUTTON_BASE_SIZE = 26;

/** Spacing between buttons (px) at scale=1. */
const BUTTON_SPACING = 8;

const ActionContainer = styled(Box)(() => ({
  position: 'absolute',
  pointerEvents: 'auto',
  display: 'flex',
  flexDirection: 'row',
  zIndex: 1500,
}));

interface ActionButton {
  key: string;
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  color?: string;
}

const StructureActionPanel: React.FC<Props> = ({ gameEngine }) => {
  const structure = useGameStore(s => s.selectedStructure);
  const viewportScale = useGameStore(s => s.viewportScale);
  useGameStore(s => s.frameTick);

  const [cargoOpen, setCargoOpen] = useState(false);
  const [drillDownOpen, setDrillDownOpen] = useState(false);

  // Direct DOM ref for lag-free position updates
  const containerRef = useRef<HTMLDivElement>(null);

  // Own RAF loop reads worldToScreen directly from the game engine each display frame,
  // so buttons track the canvas with zero frame delay (no store intermediary for position).
  useEffect(() => {
    if (!gameEngine) return;
    let rafId = 0;
    const tick = (): void => {
      const el = containerRef.current;
      const sel = useGameStore.getState().selectedStructure;
      if (el && sel && !sel.isDestroyed()) {
        const scale = gameEngine.getViewportScale();
        if (scale < MIN_ACTION_SCALE) {
          el.style.visibility = 'hidden';
        } else {
          const hw = sel.definition.widthPx / 2;
          const hh = sel.definition.heightPx / 2;
          const sp = gameEngine.worldToScreen(
            sel.body.position.x - hw,
            sel.body.position.y - hh,
          );
          if (sp) {
            const btnScale = Math.max(0.5, Math.min(1.5, scale));
            const scaledSize = BUTTON_BASE_SIZE * btnScale;
            el.style.left = `${Math.round(sp.x)}px`;
            el.style.top = `${Math.round(sp.y) - scaledSize - 6}px`;
            el.style.gap = `${BUTTON_SPACING * btnScale}px`;
            el.style.visibility = 'visible';
          } else {
            el.style.visibility = 'hidden';
          }
        }
      } else if (el) {
        el.style.visibility = 'hidden';
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [gameEngine]);

  const handleDeconstruct = useCallback(() => {
    if (!gameEngine || !structure) return;
    gameEngine.toggleDeconstruction(structure);
  }, [gameEngine, structure]);

  const handleTogglePower = useCallback(() => {
    if (!gameEngine || !structure) return;
    gameEngine.toggleStructurePower(structure);
  }, [gameEngine, structure]);

  const handleOpenCargo = useCallback(() => {
    setCargoOpen(true);
  }, []);

  const handleOpenDrillDown = useCallback(() => {
    setDrillDownOpen(true);
  }, []);

  if (!structure) return null;

  // Build action button list
  const actions: ActionButton[] = [];

  if (structure.isDeconstructing) {
    actions.push({
      key: 'cancel-decon',
      icon: <CancelDeconIcon fontSize="inherit" />,
      tooltip: 'Cancel deconstruction — returns to construction mode',
      onClick: handleDeconstruct,
    });
  } else {
    actions.push({
      key: 'deconstruct',
      icon: <DeconstructIcon fontSize="inherit" />,
      tooltip: 'Deconstruct — disassemble and return resources to the network',
      onClick: handleDeconstruct,
    });
  }

  actions.push({
    key: 'power',
    icon: <BoltIcon fontSize="inherit" />,
    tooltip: structure.isPoweredOn
      ? 'Power ON — click to turn off (stops consuming/producing power)'
      : 'Power OFF — click to turn on (resumes normal operation)',
    onClick: handleTogglePower,
    color: structure.isPoweredOn ? '#44cc44' : '#cc4444',
  });

  if (structure.definition.storageCapacity > 0) {
    actions.push({
      key: 'cargo',
      icon: <InventoryIcon fontSize="inherit" />,
      tooltip: 'Open cargo — view stored materials',
      onClick: handleOpenCargo,
    });
  }

  actions.push({
    key: 'settings',
    icon: <SettingsIcon fontSize="inherit" />,
    tooltip: 'Settings — structure configuration and details',
    onClick: handleOpenDrillDown,
  });

  const btnScale = Math.max(0.5, Math.min(1.5, viewportScale));
  const scaledSize = BUTTON_BASE_SIZE * btnScale;

  return (
    <>
      <ActionContainer ref={containerRef} sx={{ visibility: 'hidden' }}>
        {actions.map((action) => {
          const hasColor = !!action.color;
          return (
            <Tooltip key={action.key} title={action.tooltip} placement="top" arrow>
              <IconButton
                size="small"
                onClick={action.onClick}
                sx={{
                  width: scaledSize,
                  height: scaledSize,
                  fontSize: scaledSize * 0.65,
                  color: hasColor ? action.color : '#111',
                  backgroundColor: hasColor ? 'rgba(10, 12, 18, 0.85)' : 'rgba(240, 240, 240, 0.92)',
                  border: hasColor
                    ? `1px solid ${action.color}`
                    : '1px solid rgba(255,255,255,0.6)',
                  borderRadius: 1,
                  '&:hover': {
                    backgroundColor: hasColor ? 'rgba(30, 35, 50, 0.95)' : 'rgba(255, 255, 255, 1)',
                    borderColor: '#00ccff',
                  },
                }}
              >
                {action.icon}
              </IconButton>
            </Tooltip>
          );
        })}
      </ActionContainer>

      <CargoModal
        open={cargoOpen}
        structure={structure}
        onClose={() => setCargoOpen(false)}
      />

      <GenericModal
        title={`${structure.definition.label} — Settings`}
        open={drillDownOpen}
        onClose={() => setDrillDownOpen(false)}
        initialWidth={350}
        initialHeight={250}
      >
        <Box sx={{ color: '#666', fontSize: 13, textAlign: 'center', mt: 4 }}>
          No configuration options available yet.
        </Box>
      </GenericModal>
    </>
  );
};

export default StructureActionPanel;
