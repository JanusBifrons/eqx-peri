import React from 'react';
import { Box, Button, Tooltip, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import { STRUCTURE_DEFINITIONS, StructureType } from '../types/GameTypes';

interface Props {
  // GameEngine ref will be used once placement logic is wired (Phase 1)
  // For now the panel is a visual palette only
}

interface StructureCategory {
  label: string;
  types: StructureType[];
}

const BUILD_CATEGORIES: StructureCategory[] = [
  { label: 'Core', types: ['Core'] },
  // Future phases will add categories here:
  // { label: 'Production', types: ['Refinery', 'Manufacturer', 'Recycler', 'AssemblyYard'] },
  // { label: 'Defense',    types: ['SmallTurret', 'MediumTurret', 'LargeTurret'] },
  // { label: 'Power',      types: ['SolarPanel', 'PowerStation', 'Battery'] },
  // { label: 'Network',    types: ['Connector'] },
  // { label: 'Shield',     types: ['ShieldFence'] },
];

// Left-side build panel
const PanelContainer = styled(Box)(() => ({
  position: 'absolute',
  top: 60,
  left: 12,
  width: 200,
  backgroundColor: 'rgba(10, 12, 18, 0.88)',
  border: '1px solid rgba(0, 204, 255, 0.3)',
  borderRadius: 6,
  padding: '10px 12px',
  pointerEvents: 'auto',
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}));

const CategoryLabel = styled(Typography)(() => ({
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 1.2,
  color: 'rgba(0, 204, 255, 0.6)',
  marginBottom: 2,
}));

const BuildButton = styled(Button)(() => ({
  justifyContent: 'flex-start',
  textTransform: 'none',
  fontSize: 12,
  padding: '4px 10px',
  color: '#ccc',
  borderColor: 'rgba(255,255,255,0.15)',
  '&:hover': {
    borderColor: '#00ccff',
    color: '#00ccff',
  },
  '&.Mui-disabled': {
    color: 'rgba(255,255,255,0.2)',
    borderColor: 'rgba(255,255,255,0.06)',
  },
}));

// Placeholder entries for future structure types (greyed out)
const COMING_SOON = [
  'Refinery',
  'Manufacturer',
  'Recycler',
  'Assembly Yard',
  'Small Turret',
  'Medium Turret',
  'Large Turret',
  'Solar Panel',
  'Power Station',
  'Battery',
  'Connector',
  'Shield Fence',
];

const StructuresPanel: React.FC<Props> = () => {
  const handleBuildClick = (_type: StructureType): void => {
    // Phase 1: attach blueprint to cursor for placement
    // For now this is a no-op placeholder
  };

  return (
    <PanelContainer>
      <Typography variant="subtitle2" sx={{ color: '#00ccff', fontWeight: 700, fontSize: 13 }}>
        Build Structures
      </Typography>

      {/* Available structure types */}
      {BUILD_CATEGORIES.map((cat) => (
        <Box key={cat.label}>
          <CategoryLabel>{cat.label}</CategoryLabel>
          {cat.types.map((type) => {
            const def = STRUCTURE_DEFINITIONS[type];
            return (
              <Tooltip key={type} title={`${def.label} — HP: ${def.maxHealth}  Power: +${def.powerOutput}`} placement="right" arrow>
                <BuildButton
                  variant="outlined"
                  size="small"
                  fullWidth
                  onClick={() => handleBuildClick(type)}
                >
                  {def.label}
                </BuildButton>
              </Tooltip>
            );
          })}
        </Box>
      ))}

      {/* Coming soon — greyed out future structure types */}
      <Box sx={{ mt: 0.5, borderTop: '1px solid rgba(255,255,255,0.08)', pt: 1 }}>
        <CategoryLabel sx={{ color: 'rgba(255,255,255,0.25)' }}>Coming Soon</CategoryLabel>
        {COMING_SOON.map((name) => (
          <BuildButton
            key={name}
            variant="outlined"
            size="small"
            fullWidth
            disabled
          >
            {name}
          </BuildButton>
        ))}
      </Box>
    </PanelContainer>
  );
};

export default StructuresPanel;
