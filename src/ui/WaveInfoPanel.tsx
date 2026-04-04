import React from 'react';
import { Box, Typography } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useGameStore } from '../stores/gameStore';

/** Converts milliseconds to a "m:ss" string. */
function formatEta(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Fixed top-right HUD panel
const WaveInfoPanel: React.FC = () => {
  const incomingWave = useGameStore(s => s.incomingWave);

  if (!incomingWave) return null;

  const isPulsing = incomingWave.etaMs < 30_000;
  const etaText = formatEta(incomingWave.etaMs);
  const shipText = incomingWave.ships
    .map(s => `${s.count}× ${s.name}`)
    .join('  ·  ');

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 1200,
        backgroundColor: isPulsing ? 'rgba(60,10,10,0.92)' : 'rgba(30,20,10,0.88)',
        border: `2px solid ${isPulsing ? '#ff3333' : '#cc6600'}`,
        borderRadius: 1,
        px: 2,
        py: 1.5,
        minWidth: 240,
        animation: isPulsing ? 'waveInfoPulse 0.8s ease-in-out infinite alternate' : 'none',
        '@keyframes waveInfoPulse': {
          from: { boxShadow: '0 0 8px rgba(255,50,50,0.4)' },
          to:   { boxShadow: '0 0 20px rgba(255,50,50,0.8)' },
        },
      }}
    >
      {/* Header row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <WarningAmberIcon sx={{ color: isPulsing ? '#ff3333' : '#ff8800', fontSize: 18 }} />
        <Typography
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.7rem',
            fontWeight: 'bold',
            letterSpacing: '0.15em',
            color: isPulsing ? '#ff5555' : '#ff8800',
          }}
        >
          INCOMING HOSTILES
        </Typography>
      </Box>

      {/* Ship composition */}
      <Typography
        sx={{
          fontFamily: 'monospace',
          fontSize: '0.75rem',
          color: '#ffccaa',
          mb: 0.75,
        }}
      >
        {shipText}
      </Typography>

      {/* ETA */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#888' }}>
          ETA
        </Typography>
        <Typography
          sx={{
            fontFamily: 'monospace',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            color: isPulsing ? '#ff5555' : '#ffaa44',
            letterSpacing: '0.1em',
          }}
        >
          {etaText}
        </Typography>
      </Box>
    </Box>
  );
};

export default WaveInfoPanel;
