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
        gap: 6,
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

      {/* Scenario cards */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          gap: 2,
          flexWrap: 'wrap',
          justifyContent: 'center',
          maxWidth: 900,
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
