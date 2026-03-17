import React, { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import { GameEngine } from '../game/core/GameEngine';
import { ENTITY_DEFINITIONS, EntityType } from '../types/GameTypes';

interface Props {
  gameEngine: GameEngine | null;
}

interface BlockCategory {
  label: string;
  types: EntityType[];
}

const BLOCK_CATEGORIES: BlockCategory[] = [
  {
    label: 'Command',
    types: ['Cockpit', 'LargeCockpit', 'CapitalCore'],
  },
  {
    label: 'Propulsion',
    types: ['Engine', 'LargeEngine', 'CapitalEngine'],
  },
  {
    label: 'Weapons',
    types: ['Gun', 'LargeGun', 'Beam', 'LargeBeam', 'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher', 'CapitalWeapon'],
  },
  {
    label: 'Power',
    types: ['PowerCell', 'LargePowerCell', 'PowerReactor'],
  },
  {
    label: 'Defence',
    types: ['Shield', 'LargeShield'],
  },
  {
    label: 'Hull',
    types: ['Hull', 'HeavyHull', 'MegaHull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2',
            'Hull5x1', 'Hull3x2', 'Hull4x2', 'Hull5x2',
            'Hull3x3', 'Hull4x3', 'Hull5x3', 'Hull4x4', 'Hull5x4', 'Hull5x5'],
  },
  {
    label: 'Tri-Hull',
    types: ['TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2',
            'TriHull4x1', 'TriHull5x1', 'TriHull3x2', 'TriHull4x2', 'TriHull5x2',
            'TriHull3x3', 'TriHull4x3', 'TriHull5x3', 'TriHull4x4', 'TriHull5x4', 'TriHull5x5'],
  },
];

/** Returns a short grid-size label like "1×1", "2×2", etc. */
function gridLabel(type: EntityType): string {
  const def = ENTITY_DEFINITIONS[type];
  if (!def) return '';
  const cols = def.gridCols ?? 1;
  const rows = def.gridRows ?? 1;
  return `${cols}×${rows}`;
}

const ShipBuilderPanel: React.FC<Props> = ({ gameEngine }) => {
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveJson, setSaveJson] = useState('');

  const handleBlockClick = (type: EntityType): void => {
    gameEngine?.spawnBlockForBuilder(type);
  };

  const handleSave = (): void => {
    const json = gameEngine?.exportShipAsJson() ?? null;
    setSaveJson(json ?? '(no ship data)');
    setSaveOpen(true);
  };

  return (
    <>
      {/* Left sidebar panel */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 200,
          height: '100%',
          backgroundColor: 'rgba(0, 4, 12, 0.92)',
          borderRight: '1px solid #333',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1000,
          pointerEvents: 'auto',
          overflowY: 'auto',
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': { background: '#444', borderRadius: 2 },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            p: 1.5,
            borderBottom: '1px solid #333',
            flexShrink: 0,
          }}
        >
          <Typography
            sx={{
              fontFamily: 'monospace',
              color: '#00ccff',
              fontSize: '0.8rem',
              fontWeight: 'bold',
              letterSpacing: '0.1em',
              textAlign: 'center',
            }}
          >
            BLOCK PALETTE
          </Typography>
          <Typography
            sx={{
              fontFamily: 'monospace',
              color: '#666',
              fontSize: '0.6rem',
              textAlign: 'center',
              mt: 0.5,
            }}
          >
            Click to spawn · drag to snap
          </Typography>
        </Box>

        {/* Block categories */}
        <Box sx={{ flex: 1, overflowY: 'auto', px: 1, py: 0.5 }}>
          {BLOCK_CATEGORIES.map((cat) => (
            <Box key={cat.label} sx={{ mb: 1 }}>
              <Typography
                sx={{
                  fontFamily: 'monospace',
                  color: '#888',
                  fontSize: '0.6rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  px: 0.5,
                  py: 0.5,
                }}
              >
                {cat.label}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {cat.types.map((type) => {
                  const def = ENTITY_DEFINITIONS[type];
                  if (!def) return null;
                  return (
                    <Tooltip
                      key={type}
                      title={`${type} (${gridLabel(type)})`}
                      placement="right"
                      arrow
                    >
                      <Box
                        onClick={() => handleBlockClick(type)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          px: 0.75,
                          py: 0.5,
                          borderRadius: '3px',
                          cursor: 'pointer',
                          border: '1px solid transparent',
                          '&:hover': {
                            backgroundColor: 'rgba(0, 204, 255, 0.08)',
                            borderColor: 'rgba(0, 204, 255, 0.3)',
                          },
                          '&:active': {
                            backgroundColor: 'rgba(0, 204, 255, 0.15)',
                          },
                        }}
                      >
                        {/* Color swatch */}
                        <Box
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '2px',
                            backgroundColor: def.color,
                            flexShrink: 0,
                            border: '1px solid rgba(255,255,255,0.15)',
                          }}
                        />
                        {/* Block name */}
                        <Typography
                          sx={{
                            fontFamily: 'monospace',
                            color: '#cccccc',
                            fontSize: '0.65rem',
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {type}
                        </Typography>
                        {/* Grid size badge */}
                        <Typography
                          sx={{
                            fontFamily: 'monospace',
                            color: '#555',
                            fontSize: '0.55rem',
                            flexShrink: 0,
                          }}
                        >
                          {gridLabel(type)}
                        </Typography>
                      </Box>
                    </Tooltip>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>

        {/* Save button */}
        <Box
          sx={{
            p: 1.5,
            borderTop: '1px solid #333',
            flexShrink: 0,
          }}
        >
          <Button
            fullWidth
            variant="outlined"
            size="small"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            sx={{
              fontFamily: 'monospace',
              fontSize: '0.7rem',
              color: '#00ccff',
              borderColor: '#00ccff',
              '&:hover': {
                backgroundColor: 'rgba(0, 204, 255, 0.1)',
                borderColor: '#33d6ff',
              },
            }}
          >
            Export JSON
          </Button>
        </Box>
      </Box>

      {/* Save / export dialog */}
      <Dialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(0, 4, 16, 0.97)',
            border: '1px solid #336',
          },
        }}
      >
        <DialogTitle
          sx={{
            fontFamily: 'monospace',
            color: '#00ccff',
            fontSize: '0.9rem',
            borderBottom: '1px solid #333',
            pb: 1,
          }}
        >
          Export Ship JSON
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography
            sx={{
              fontFamily: 'monospace',
              color: '#888',
              fontSize: '0.7rem',
              mb: 1.5,
            }}
          >
            Copy this JSON into <code>src/data/ships.json</code> under the{' '}
            <code>"ships"</code> array to save your ship design.
          </Typography>
          <TextField
            value={saveJson}
            multiline
            fullWidth
            minRows={12}
            maxRows={24}
            InputProps={{
              readOnly: true,
              sx: {
                fontFamily: 'monospace',
                fontSize: '0.72rem',
                color: '#ccffcc',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
              },
            }}
            onFocus={(e) => e.target.select()}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => {
              navigator.clipboard.writeText(saveJson).catch(() => undefined);
            }}
            variant="outlined"
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#00ccff', borderColor: '#00ccff' }}
          >
            Copy
          </Button>
          <Button
            onClick={() => setSaveOpen(false)}
            variant="outlined"
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#888', borderColor: '#555' }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ShipBuilderPanel;
