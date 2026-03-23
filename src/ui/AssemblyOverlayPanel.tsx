import React, { useCallback } from 'react';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { GameEngine } from '../game/core/GameEngine';
import { useGameStore } from '../stores/gameStore';
import WorldOverlayPanel, { OverlayButton, ScreenAnchor } from './WorldOverlayPanel';
import { computeScreenAnchor } from './useWorldOverlay';

interface Props {
  gameEngine: GameEngine | null;
}

// World-space Pilot / AI buttons above the selected team-0 assembly.
const AssemblyOverlayPanel: React.FC<Props> = ({ gameEngine }) => {
  const selectedAssembly = useGameStore(s => s.selectedAssembly);
  const playerAssembly   = useGameStore(s => s.playerAssembly);
  const hasAI            = useGameStore(s => s.selectedAssemblyAIEnabled);
  // frameTick drives re-renders so AI-enabled state stays current.
  useGameStore(s => s.frameTick);

  // Called every rAF tick — computes the exact bracket screen position.
  const getScreenAnchor = useCallback((): ScreenAnchor | null => {
    if (!gameEngine) return null;
    const assembly = useGameStore.getState().selectedAssembly;
    const player   = useGameStore.getState().playerAssembly;
    if (!assembly || assembly === player || assembly.destroyed) return null;
    if (assembly.team !== 0) return null;
    const pos = assembly.rootBody.position;
    return computeScreenAnchor(gameEngine, pos.x, pos.y, assembly.getBoundingRadius());
  }, [gameEngine]);

  // Don't render at all for enemy ships or when piloting.
  if (
    !selectedAssembly ||
    selectedAssembly === playerAssembly ||
    selectedAssembly.destroyed ||
    selectedAssembly.team !== 0
  ) {
    return null;
  }

  const buttons: OverlayButton[] = [
    {
      key: 'pilot',
      icon: <FlightTakeoffIcon fontSize="inherit" />,
      tooltip: 'Pilot — take direct control of this ship',
      onClick: () => {
        const assembly = gameEngine?.getSelectedAssembly();
        if (assembly) gameEngine?.pilotAssembly(assembly);
      },
      color: '#00ccff',
    },
    hasAI
      ? {
          key: 'disable-ai',
          icon: <SmartToyIcon fontSize="inherit" />,
          tooltip: 'Disable AI — ship will drift without control',
          onClick: () => {
            const assembly = gameEngine?.getSelectedAssembly();
            if (assembly) gameEngine?.disableAI(assembly);
          },
          color: '#ffaa00',
        }
      : {
          key: 'enable-ai',
          icon: <SmartToyOutlinedIcon fontSize="inherit" />,
          tooltip: 'Enable AI — resume autonomous control',
          onClick: () => {
            const assembly = gameEngine?.getSelectedAssembly();
            if (assembly) gameEngine?.enableAI(assembly);
          },
          color: '#888888',
        },
  ];

  return (
    <WorldOverlayPanel
      gameEngine={gameEngine}
      getScreenAnchor={getScreenAnchor}
      buttons={buttons}
    />
  );
};

export default AssemblyOverlayPanel;
