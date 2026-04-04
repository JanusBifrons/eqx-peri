import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Typography,
} from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import PublicIcon from '@mui/icons-material/Public';
import { ScenarioConfig, SCENARIO_ORDER, SCENARIOS } from '../types/GameTypes';

interface MainMenuProps {
  onStart: (scenario: ScenarioConfig) => void;
}

const MainMenu: React.FC<MainMenuProps> = ({ onStart }) => {
  const [selectedId, setSelectedId] = useState<string>('duel');

  const handleLaunch = (): void => {
    const scenario = SCENARIOS[selectedId as keyof typeof SCENARIOS];
    onStart(scenario);
  };

  const sectorConquestCfg = SCENARIOS['sector-conquest'];

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        backgroundColor: 'rgba(0, 8, 20, 0.97)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        overflowY: 'auto',
        py: 4,
      }}
    >
      {/* Title */}
      <Typography
        variant="h2"
        sx={{
          fontFamily: 'monospace',
          color: '#00ccff',
          letterSpacing: '0.3em',
          textShadow: '0 0 30px rgba(0, 204, 255, 0.6)',
          fontWeight: 'bold',
        }}
      >
        EQX PERI
      </Typography>

      {/* ── Featured: Sector Conquest ─────────────────────────────── */}
      <Box sx={{ width: '100%', maxWidth: 900, px: 2 }}>
        <Box
          onClick={() => onStart(sectorConquestCfg)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            p: 3,
            borderRadius: 2,
            border: '2px solid #ffaa00',
            background: 'linear-gradient(135deg, rgba(30,18,0,0.95) 0%, rgba(40,24,0,0.95) 100%)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            boxShadow: '0 0 24px rgba(255,170,0,0.25)',
            '&:hover': {
              border: '2px solid #ffc940',
              boxShadow: '0 0 36px rgba(255,170,0,0.45)',
              background: 'linear-gradient(135deg, rgba(40,24,0,0.98) 0%, rgba(55,33,0,0.98) 100%)',
            },
          }}
        >
          <PublicIcon sx={{ color: '#ffaa00', fontSize: 56, flexShrink: 0 }} />
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
              <Typography
                variant="h4"
                sx={{
                  fontFamily: 'monospace',
                  color: '#ffaa00',
                  fontWeight: 'bold',
                  letterSpacing: '0.15em',
                  textShadow: '0 0 16px rgba(255,170,0,0.5)',
                }}
              >
                SECTOR CONQUEST
              </Typography>
              <Chip
                label="CAMPAIGN"
                size="small"
                sx={{
                  backgroundColor: 'rgba(255,170,0,0.2)',
                  color: '#ffaa00',
                  border: '1px solid #ffaa00',
                  fontFamily: 'monospace',
                  fontSize: '0.65rem',
                  fontWeight: 'bold',
                  letterSpacing: '0.1em',
                }}
              />
            </Box>
            <Typography
              variant="body1"
              sx={{ color: '#ccaa66', fontFamily: 'monospace', fontSize: '0.85rem' }}
            >
              {sectorConquestCfg.description}
            </Typography>
          </Box>
          <RocketLaunchIcon sx={{ color: '#ffaa00', fontSize: 32, flexShrink: 0 }} />
        </Box>
      </Box>

      {/* ── Other Scenarios ───────────────────────────────────────── */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          gap: 2,
          flexWrap: 'wrap',
          justifyContent: 'center',
          maxWidth: 900,
          px: 2,
        }}
      >
        {SCENARIO_ORDER.map((id) => {
          const cfg = SCENARIOS[id];
          const isSelected = selectedId === id;
          return (
            <Card
              key={id}
              variant="outlined"
              sx={{
                width: 160,
                cursor: 'pointer',
                backgroundColor: isSelected
                  ? 'rgba(0, 204, 255, 0.12)'
                  : 'rgba(0, 0, 0, 0.7)',
                borderColor: isSelected ? '#00ccff' : '#333',
                borderWidth: isSelected ? 2 : 1,
                transition: 'all 0.15s ease',
                '&:hover': {
                  borderColor: '#00ccff',
                  backgroundColor: 'rgba(0, 204, 255, 0.08)',
                },
              }}
            >
              <CardActionArea onClick={() => setSelectedId(id)} sx={{ height: '100%' }}>
                <CardContent sx={{ p: 1.5 }}>
                  <Typography
                    variant="h6"
                    sx={{
                      fontFamily: 'monospace',
                      color: isSelected ? '#00ccff' : '#ffffff',
                      fontSize: '0.9rem',
                      fontWeight: 'bold',
                      mb: 0.75,
                    }}
                  >
                    {cfg.label}
                  </Typography>
                  <Chip
                    label={cfg.sandboxMode ? 'Builder' : `${cfg.teamSize}v${cfg.teamSize}`}
                    size="small"
                    sx={{
                      backgroundColor: isSelected
                        ? 'rgba(0, 204, 255, 0.25)'
                        : 'rgba(255,255,255,0.08)',
                      color: isSelected ? '#00ccff' : '#aaaaaa',
                      fontFamily: 'monospace',
                      fontSize: '0.65rem',
                      height: 18,
                      mb: 1,
                    }}
                  />
                  <Typography
                    variant="body2"
                    sx={{
                      color: '#aaaaaa',
                      fontSize: '0.68rem',
                      lineHeight: 1.4,
                    }}
                  >
                    {cfg.description}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          );
        })}
      </Box>

      {/* Launch button */}
      <Button
        variant="contained"
        size="large"
        startIcon={<RocketLaunchIcon />}
        onClick={handleLaunch}
        sx={{
          fontFamily: 'monospace',
          fontSize: '1rem',
          letterSpacing: '0.15em',
          px: 5,
          py: 1.5,
          backgroundColor: '#00ccff',
          color: '#000814',
          fontWeight: 'bold',
          '&:hover': {
            backgroundColor: '#33d6ff',
          },
        }}
      >
        LAUNCH
      </Button>
    </Box>
  );
};

export default MainMenu;
