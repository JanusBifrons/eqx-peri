import React from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { useGameStore } from '../stores/gameStore';
import { TCU_CAPTURE_DURATION_MS } from '../types/GameTypes';

/** Converts milliseconds to "m:ss". */
function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const PHASE_LABELS = [
  'ESTABLISH BASE',
  'ECONOMY',
  'DEFENSES',
  'CAPTURE',
  'CAPTURING',
];

// Fixed top-left HUD panel (offset to clear the MiniDrawer at 52px)
const ObjectivesPanel: React.FC = () => {
  const objectiveItems = useGameStore(s => s.objectiveItems);
  const objectivesPhase = useGameStore(s => s.objectivesPhase);
  const tcuCountdownMs = useGameStore(s => s.tcuCountdownMs);

  const phaseLabel = PHASE_LABELS[objectivesPhase] ?? 'COMPLETE';
  const captureProgress = tcuCountdownMs !== null
    ? (1 - tcuCountdownMs / TCU_CAPTURE_DURATION_MS) * 100
    : 0;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 16,
        left: 68, // 52px MiniDrawer + 16px gap
        zIndex: 1200,
        backgroundColor: 'rgba(8, 16, 28, 0.88)',
        border: '1px solid #334',
        borderRadius: 1,
        px: 2,
        py: 1.5,
        minWidth: 230,
        maxWidth: 260,
      }}
    >
      {/* Phase heading */}
      <Typography
        sx={{
          fontFamily: 'monospace',
          fontSize: '0.62rem',
          letterSpacing: '0.2em',
          color: '#4488aa',
          mb: 1,
          fontWeight: 'bold',
        }}
      >
        OBJECTIVES — {phaseLabel}
      </Typography>

      {/* Objective items */}
      {objectiveItems.map((item, idx) => (
        <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          {item.done
            ? <CheckCircleIcon sx={{ color: '#44cc44', fontSize: 14, flexShrink: 0 }} />
            : <RadioButtonUncheckedIcon sx={{ color: '#555', fontSize: 14, flexShrink: 0 }} />}
          <Typography
            sx={{
              fontFamily: 'monospace',
              fontSize: '0.72rem',
              color: item.done ? '#668866' : '#cccccc',
              textDecoration: item.done ? 'line-through' : 'none',
            }}
          >
            {item.label}
          </Typography>
        </Box>
      ))}

      {/* TCU capture countdown */}
      {tcuCountdownMs !== null && tcuCountdownMs > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#9966ff', fontWeight: 'bold', letterSpacing: '0.1em' }}>
              CAPTURING SECTOR
            </Typography>
            <Typography sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#bb88ff', fontWeight: 'bold' }}>
              {formatCountdown(tcuCountdownMs)}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={captureProgress}
            sx={{
              height: 6,
              borderRadius: 1,
              backgroundColor: 'rgba(100,50,180,0.2)',
              '& .MuiLinearProgress-bar': { backgroundColor: '#8844ff' },
            }}
          />
        </Box>
      )}
    </Box>
  );
};

export default ObjectivesPanel;
