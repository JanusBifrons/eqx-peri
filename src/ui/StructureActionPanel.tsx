import React, { useState, useCallback } from 'react';
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
  // Read from Zustand store — component re-renders only when these slices change
  const structure = useGameStore(s => s.selectedStructure);
  const structureScreen = useGameStore(s => s.structureScreen);
  const viewportScale = useGameStore(s => s.viewportScale);
  // frameTick forces re-render each game frame so we pick up structure state changes
  // (e.g. isDeconstructing, isPoweredOn) without extra polling
  useGameStore(s => s.frameTick);

  const [cargoOpen, setCargoOpen] = useState(false);
  const [drillDownOpen, setDrillDownOpen] = useState(false);

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

  if (!structure || !structureScreen || structureScreen.scale < MIN_ACTION_SCALE) return null;

  // Build action button list
  const actions: ActionButton[] = [];

  // 1. Deconstruct / Cancel deconstruction
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

  // 2. Power toggle — green when on, red when off
  actions.push({
    key: 'power',
    icon: <BoltIcon fontSize="inherit" />,
    tooltip: structure.isPoweredOn
      ? 'Power ON — click to turn off (stops consuming/producing power)'
      : 'Power OFF — click to turn on (resumes normal operation)',
    onClick: handleTogglePower,
    color: structure.isPoweredOn ? '#44cc44' : '#cc4444',
  });

  // 3. Open cargo
  if (structure.definition.storageCapacity > 0) {
    actions.push({
      key: 'cargo',
      icon: <InventoryIcon fontSize="inherit" />,
      tooltip: 'Open cargo — view stored materials',
      onClick: handleOpenCargo,
    });
  }

  // 4. Drill-down / Settings
  actions.push({
    key: 'settings',
    icon: <SettingsIcon fontSize="inherit" />,
    tooltip: 'Settings — structure configuration and details',
    onClick: handleOpenDrillDown,
  });

  const btnScale = Math.max(0.5, Math.min(1.5, viewportScale));
  const scaledSize = BUTTON_BASE_SIZE * btnScale;
  const scaledSpacing = BUTTON_SPACING * btnScale;

  return (
    <>
      <ActionContainer
        sx={{
          left: structureScreen.screenX,
          top: structureScreen.screenY - scaledSize - 6,
          gap: `${scaledSpacing}px`,
        }}
      >
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

      {/* Cargo modal */}
      <CargoModal
        open={cargoOpen}
        structure={structure}
        onClose={() => setCargoOpen(false)}
      />

      {/* Drill-down / Settings modal (placeholder) */}
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
