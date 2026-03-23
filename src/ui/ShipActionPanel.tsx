import React from 'react';
import { Box, Typography, LinearProgress, styled } from '@mui/material';
import { GameEngine } from '../game/core/GameEngine';
import { useGameStore } from '../stores/gameStore';

interface Props {
  gameEngine: GameEngine | null;
}

// bottom-center HUD panel — ship name + health bar for the currently selected ship
const PanelContainer = styled(Box)(() => ({
  position: 'absolute',
  bottom: 20,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  pointerEvents: 'none',
  zIndex: 1000,
  backgroundColor: 'rgba(0, 0, 0, 0.85)',
  border: '1px solid #333',
  borderRadius: 8,
  padding: '8px 16px',
  minWidth: 180,
}));

const ShipActionPanel: React.FC<Props> = ({ gameEngine: _gameEngine }) => {
  const selectedAssembly = useGameStore(s => s.selectedAssembly);
  const playerAssembly   = useGameStore(s => s.playerAssembly);
  // frameTick ensures we re-render each frame to pick up damage changes.
  useGameStore(s => s.frameTick);

  // Hide when nothing selected or when the selected ship is the one being piloted.
  if (!selectedAssembly || selectedAssembly === playerAssembly) return null;

  const shipName      = selectedAssembly.shipName;
  const damagePercent = selectedAssembly.getDamagePercentage();
  const isFriendly    = selectedAssembly.team === 0;
  const healthPercent = 100 - damagePercent;
  const healthColor   = healthPercent > 60 ? '#00ff00' : healthPercent > 30 ? '#ffaa00' : '#ff4444';

  return (
    <PanelContainer>
      <Typography
        variant="caption"
        sx={{ color: isFriendly ? '#00ccff' : '#ff4444', fontWeight: 'bold', fontSize: '0.75rem' }}
      >
        {shipName}
      </Typography>

      <Box sx={{ width: '100%' }}>
        <LinearProgress
          variant="determinate"
          value={healthPercent}
          sx={{
            height: 6,
            borderRadius: 3,
            backgroundColor: '#333',
            '& .MuiLinearProgress-bar': { backgroundColor: healthColor },
          }}
        />
        <Typography variant="caption" sx={{ color: '#aaa', fontSize: '0.65rem' }}>
          {Math.round(healthPercent)}% hull integrity
        </Typography>
      </Box>
    </PanelContainer>
  );
};

export default ShipActionPanel;
