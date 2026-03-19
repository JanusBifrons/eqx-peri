import React, { useState, useEffect } from 'react';
import { Box, Button, Tooltip, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import { STRUCTURE_DEFINITIONS, StructureType } from '../types/GameTypes';
import { GameEngine } from '../game/core/GameEngine';

interface Props {
  gameEngine: GameEngine | null;
}

interface StructureCategory {
  label: string;
  types: StructureType[];
}

const BUILD_CATEGORIES: StructureCategory[] = [
  { label: 'Infrastructure', types: ['Core', 'Connector', 'ShieldFence'] },
  { label: 'Power', types: ['SolarPanel', 'Battery', 'PowerStation'] },
  { label: 'Economy', types: ['Refinery', 'AssemblyYard'] },
  { label: 'Defense', types: ['SmallTurret', 'MediumTurret', 'LargeTurret'] },
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
  'Manufacturer',
  'Recycler',
];

const StructuresPanel: React.FC<Props> = ({ gameEngine }) => {
  const [activeType, setActiveType] = useState<StructureType | null>(null);

  // Poll placement system to sync active button highlight
  useEffect(() => {
    if (!gameEngine) return;
    const interval = setInterval(() => {
      const ps = gameEngine.getStructurePlacementSystem();
      if (ps) {
        setActiveType(ps.getPlacingType());
      } else {
        setActiveType(null);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [gameEngine]);

  const handleBuildClick = (type: StructureType): void => {
    if (!gameEngine) return;
    if (activeType === type) {
      // Clicking the same type again cancels placement
      gameEngine.cancelStructurePlacement();
      setActiveType(null);
    } else {
      gameEngine.enterStructurePlaceMode(type);
      setActiveType(type);
    }
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
            const isActive = activeType === type;
            return (
              <Tooltip key={type} title={`${def.label} — HP: ${def.maxHealth}${def.powerOutput > 0 ? `  Power: +${def.powerOutput}` : ''}${def.powerConsumption > 0 ? `  Power: -${def.powerConsumption}` : ''}${def.storageCapacity > 0 ? `  Storage: ${def.storageCapacity}` : ''}${def.weaponRange ? `  Range: ${def.weaponRange}` : ''}${def.constructionCost > 0 ? `  Cost: ${def.constructionCost}` : '  (Pre-built)'}`} placement="right" arrow>
                <BuildButton
                  variant="outlined"
                  size="small"
                  fullWidth
                  onClick={() => handleBuildClick(type)}
                  sx={isActive ? {
                    borderColor: '#00ccff',
                    color: '#00ccff',
                    backgroundColor: 'rgba(0, 204, 255, 0.1)',
                  } : undefined}
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
