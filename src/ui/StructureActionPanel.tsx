import React, { useState, useCallback } from 'react';
import { Box } from '@mui/material';
import DeconstructIcon from '@mui/icons-material/DeleteForever';
import CancelDeconIcon from '@mui/icons-material/Cancel';
import BoltIcon from '@mui/icons-material/Bolt';
import InventoryIcon from '@mui/icons-material/Inventory2';
import SettingsIcon from '@mui/icons-material/Settings';
import { GameEngine } from '../game/core/GameEngine';
import GenericModal from './GenericModal';
import CargoModal from './CargoModal';
import { useGameStore } from '../stores/gameStore';
import WorldOverlayPanel, { OverlayButton, ScreenAnchor } from './WorldOverlayPanel';
import { computeScreenAnchor } from './useWorldOverlay';

interface Props {
  gameEngine: GameEngine | null;
}

// World-space action buttons for the selected structure.
const StructureActionPanel: React.FC<Props> = ({ gameEngine }) => {
  const [cargoOpen, setCargoOpen] = useState(false);
  const [drillDownOpen, setDrillDownOpen] = useState(false);

  // Called every rAF tick — computes the bracket screen position from the
  // same formula ShipHighlightRenderer uses, guaranteeing pixel-perfect alignment.
  const getScreenAnchor = useCallback((): ScreenAnchor | null => {
    if (!gameEngine) return null;
    const sel = useGameStore.getState().selectedStructure;
    if (!sel || sel.isDestroyed()) return null;
    const worldRadius = Math.max(sel.definition.widthPx, sel.definition.heightPx) / 2;
    return computeScreenAnchor(gameEngine, sel.body.position.x, sel.body.position.y, worldRadius);
  }, [gameEngine]);

  // Subscribe to the store for reactive button-state rebuilds.
  const structure = useGameStore(s => s.selectedStructure);
  // frameTick drives re-renders so isPoweredOn / isDeconstructing stay current.
  useGameStore(s => s.frameTick);

  const handleDeconstruct  = useCallback(() => { if (gameEngine && structure) gameEngine.toggleDeconstruction(structure); }, [gameEngine, structure]);
  const handleTogglePower  = useCallback(() => { if (gameEngine && structure) gameEngine.toggleStructurePower(structure); }, [gameEngine, structure]);
  const handleOpenCargo    = useCallback(() => setCargoOpen(true), []);
  const handleOpenSettings = useCallback(() => setDrillDownOpen(true), []);

  if (!structure) return null;

  const actions: OverlayButton[] = [];

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
    onClick: handleOpenSettings,
  });

  return (
    <>
      <WorldOverlayPanel
        gameEngine={gameEngine}
        getScreenAnchor={getScreenAnchor}
        buttons={actions}
      />

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
