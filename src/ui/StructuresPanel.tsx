import React from 'react';
import { Box, Button, Tooltip, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import { STRUCTURE_DEFINITIONS, StructureType } from '../types/GameTypes';
import { GameEngine } from '../game/core/GameEngine';
import { useGameStore } from '../stores/gameStore';
import FloatingPanel from './FloatingPanel';

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
  { label: 'Economy', types: ['Refinery', 'Manufacturer', 'Recycler', 'AssemblyYard', 'StructureMiningLaser'] },
  { label: 'Defense', types: ['SmallTurret', 'MediumTurret', 'LargeTurret'] },
  { label: 'Conquest', types: ['TerritoryControlUnit'] },
];

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
const COMING_SOON: string[] = [];

/**
 * Default position: x=72 clears the MiniDrawer (52px); y=230 clears the ObjectivesPanel
 * (~210px tall at max). In non-conquest modes ObjectivesPanel is hidden, so y=80 would be
 * fine there too — but 230 is always safe. Users can reposition and it will persist.
 */
const PANEL_DEFAULT_POS = { x: 72, y: 230 };
const PANEL_DEFAULT_SIZE = { w: 210, h: 400 };

const StructuresPanel: React.FC<Props> = ({ gameEngine }) => {
  const activeType = useGameStore(s => s.placingStructureType);

  const handleBuildClick = (type: StructureType): void => {
    if (!gameEngine) return;
    if (activeType === type) {
      gameEngine.cancelStructurePlacement();
    } else {
      gameEngine.enterStructurePlaceMode(type);
    }
  };

  return (
    <FloatingPanel
      storageKey="structures-panel"
      title="Build Structures"
      defaultPos={PANEL_DEFAULT_POS}
      defaultSize={PANEL_DEFAULT_SIZE}
      minWidth={160}
      minHeight={180}
    >
      {/* Available structure types */}
      {BUILD_CATEGORIES.map((cat) => (
        <Box key={cat.label} sx={{ mb: 1 }}>
          <CategoryLabel>{cat.label}</CategoryLabel>
          {cat.types.map((type) => {
            const def = STRUCTURE_DEFINITIONS[type];
            const isActive = activeType === type;
            return (
              <Tooltip
                key={type}
                title={[
                  def.label,
                  `HP: ${def.maxHealth}`,
                  def.powerOutput > 0 ? `Power: +${def.powerOutput}` : '',
                  def.powerConsumption > 0 ? `Power: -${def.powerConsumption}` : '',
                  def.storageCapacity > 0 ? `Storage: ${def.storageCapacity}` : '',
                  def.weaponRange ? `Range: ${def.weaponRange}` : '',
                  def.constructionCost > 0 ? `Cost: ${def.constructionCost}` : '(Pre-built)',
                ].filter(Boolean).join('  ·  ')}
                placement="right"
                arrow
              >
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
      {COMING_SOON.length > 0 && (
        <Box sx={{ mt: 0.5, borderTop: '1px solid rgba(255,255,255,0.08)', pt: 1 }}>
          <CategoryLabel sx={{ color: 'rgba(255,255,255,0.25)' }}>Coming Soon</CategoryLabel>
          {COMING_SOON.map((name) => (
            <BuildButton key={name} variant="outlined" size="small" fullWidth disabled>
              {name}
            </BuildButton>
          ))}
        </Box>
      )}
    </FloatingPanel>
  );
};

export default StructuresPanel;
