import React from 'react';
import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';
import NearMeIcon from '@mui/icons-material/NearMe';
import BuildIcon from '@mui/icons-material/Build';
import { useGameStore } from '../stores/gameStore';

const ModeToggle: React.FC = () => {
  const interactionMode = useGameStore(s => s.interactionMode);
  const setInteractionMode = useGameStore(s => s.setInteractionMode);

  const handleChange = (_: React.MouseEvent<HTMLElement>, newMode: 'select' | 'build' | null): void => {
    if (newMode !== null) {
      setInteractionMode(newMode);
    }
  };

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1100,
        pointerEvents: 'auto',
      }}
    >
      <ToggleButtonGroup
        value={interactionMode}
        exclusive
        onChange={handleChange}
        size="small"
        sx={{
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          border: '1px solid #444',
          borderRadius: 1,
          '& .MuiToggleButton-root': {
            color: '#888',
            borderColor: '#444',
            px: 2,
            py: 0.5,
            fontSize: '0.75rem',
            textTransform: 'none',
            gap: 0.5,
            '&.Mui-selected': {
              color: '#00ccff',
              backgroundColor: 'rgba(0, 204, 255, 0.12)',
              '&:hover': {
                backgroundColor: 'rgba(0, 204, 255, 0.2)',
              },
            },
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            },
          },
        }}
      >
        <ToggleButton value="select">
          <NearMeIcon sx={{ fontSize: 16 }} />
          Select
        </ToggleButton>
        <ToggleButton value="build">
          <BuildIcon sx={{ fontSize: 16 }} />
          Build
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
};

export default ModeToggle;
