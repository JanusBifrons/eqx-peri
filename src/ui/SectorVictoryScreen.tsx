import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import PublicIcon from '@mui/icons-material/Public';
import MapIcon from '@mui/icons-material/Map';

interface SectorVictoryScreenProps {
  onOpenGalaxyMap: () => void;
}

// Full-screen victory overlay shown when the sector is captured
const SectorVictoryScreen: React.FC<SectorVictoryScreenProps> = ({ onOpenGalaxyMap }) => {
  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        backgroundColor: 'rgba(4, 0, 16, 0.88)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}
    >
      <PublicIcon sx={{ color: '#8844ff', fontSize: 80, filter: 'drop-shadow(0 0 24px #8844ff)' }} />

      <Typography
        variant="h2"
        sx={{
          fontFamily: 'monospace',
          color: '#8844ff',
          letterSpacing: '0.25em',
          fontWeight: 'bold',
          textShadow: '0 0 40px rgba(136,68,255,0.8)',
        }}
      >
        SECTOR CAPTURED
      </Typography>

      <Typography
        sx={{
          fontFamily: 'monospace',
          color: '#aa88ff',
          fontSize: '1rem',
          letterSpacing: '0.1em',
        }}
      >
        Your forces have secured control of this sector.
      </Typography>

      <Button
        variant="contained"
        size="large"
        startIcon={<MapIcon />}
        onClick={onOpenGalaxyMap}
        sx={{
          fontFamily: 'monospace',
          fontSize: '1rem',
          letterSpacing: '0.15em',
          px: 5,
          py: 1.5,
          backgroundColor: '#8844ff',
          color: '#ffffff',
          fontWeight: 'bold',
          mt: 2,
          '&:hover': {
            backgroundColor: '#aa66ff',
          },
        }}
      >
        VIEW GALAXY MAP
      </Button>
    </Box>
  );
};

export default SectorVictoryScreen;
