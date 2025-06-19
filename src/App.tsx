import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './game/GameEngine';
import Radar from './components/Radar';
import LockedTargets from './components/LockedTargets';
import PowerManagement from './components/PowerManagement';
import ShipSelection from './components/ShipSelection';
import PartsInfo from './components/PartsInfo';
import {
  Paper,
  Typography,
  Box,
  Chip,
  Divider,
  ThemeProvider,
  createTheme
} from '@mui/material';

// Create a dark theme for the space game
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#00ccff',
    },
    secondary: {
      main: '#00ff00',
    },
    background: {
      default: '#001122',
      paper: 'rgba(0, 0, 0, 0.85)',
    },
    text: {
      primary: '#ffffff',
      secondary: '#cccccc',
    },
  },
  typography: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          border: '1px solid #333',
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
        },
      },
    },
  },
});

const App: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const gameEngineRef = useRef<GameEngine | null>(null);
  const [gameEngine, setGameEngine] = useState<GameEngine | null>(null);
  // Game state management
  const [, setGameState] = useState<'ship-selection' | 'playing' | 'respawn'>('ship-selection');
  const [, setSelectedShipIndex] = useState<number | null>(null);
  const [showShipSelection, setShowShipSelection] = useState(true); const [playerDestroyed, setPlayerDestroyed] = useState(false);
  // Handle ship selection
  const handleShipSelect = (shipIndex: number) => {
    setSelectedShipIndex(shipIndex);
    setShowShipSelection(false);
    setGameState('playing');
    setPlayerDestroyed(false);

    // Start the game with the selected ship
    startGameWithShip(shipIndex);
  };

  const handleRespawn = (shipIndex: number) => {
    setSelectedShipIndex(shipIndex);
    setShowShipSelection(false);
    setGameState('playing');
    setPlayerDestroyed(false);

    // Respawn with new ship and apply auto-zoom
    if (gameEngineRef.current) {
      gameEngineRef.current.setAutoZoomForShip(shipIndex);
      gameEngineRef.current.spawnPlayerShip(shipIndex);
    }
  };
  const startGameWithShip = (shipIndex: number) => {
    if (canvasRef.current && !gameEngineRef.current) {
      console.log('🚀 Creating GameEngine with selected ship...');
      gameEngineRef.current = new GameEngine(canvasRef.current);
      setGameEngine(gameEngineRef.current);

      // Set the selected ship index before starting
      gameEngineRef.current.setPlayerShipIndex(shipIndex);

      // Apply auto-zoom for large ships
      gameEngineRef.current.setAutoZoomForShip(shipIndex);

      console.log('▶️  Starting GameEngine...');
      gameEngineRef.current.start();
      console.log('✅ GameEngine started with ship', shipIndex);

      // Set up player destruction callback
      gameEngineRef.current.onPlayerDestroyed = () => {
        setPlayerDestroyed(true);
        setGameState('respawn');
        setShowShipSelection(true);
      };
    }
  };

  useEffect(() => {
    console.log('🎮 App useEffect triggered');
    console.log('Canvas ref current:', canvasRef.current);

    // Don't auto-start the game anymore - wait for ship selection
    // The game will start when a ship is selected

    return () => {
      if (gameEngineRef.current) {
        console.log('🛑 Stopping GameEngine...');
        gameEngineRef.current.stop();
        setGameEngine(null);
      }
    };
  }, []); return (
    <ThemeProvider theme={darkTheme}>
      <div style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        backgroundColor: '#001122',
        overflow: 'hidden' // Prevent any potential scrollbars
      }}>
        <div ref={canvasRef} style={{
          width: '100%',
          height: '100%',
          border: '2px solid #333'
        }} />

        {/* Compact Controls Panel */}
        <Paper
          elevation={3}
          sx={{
            position: 'absolute',
            top: 10,
            left: 10,
            maxWidth: 300,
            p: 1.5,
            borderRadius: 2,
          }}
        >
          <Box sx={{ mb: 1 }}>
            <Typography
              variant="h6"
              sx={{
                color: 'secondary.main',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                mb: 0.5
              }}
            >
              🚀 AI BATTLE SPACE
            </Typography>
            <Chip
              label="TEAM COMBAT"
              size="small"
              color="primary"
              variant="outlined"
              sx={{ fontSize: '0.65rem', height: 18 }}
            />
          </Box>          <Divider sx={{ my: 1 }} />

          <Box sx={{ display: 'flex', gap: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ color: 'primary.main', fontSize: '0.75rem', mb: 0.5 }}>
                Keyboard
              </Typography>              <Box sx={{ fontSize: '0.7rem', lineHeight: 1.2 }}>
                <div>W/S - Thrust</div>
                <div>A/D - Rotate</div>
                <div>Space - Fire</div>
                <div style={{ color: '#ff4444', fontWeight: 'bold' }}>E - Eject (60%+ damage)</div>
                <div>R - Restart</div>
                <div>G - Grid</div>
                <div>1 - Add Ship</div>
              </Box>
            </Box>

            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ color: 'primary.main', fontSize: '0.75rem', mb: 0.5 }}>
                Mouse
              </Typography>
              <Box sx={{ fontSize: '0.7rem', lineHeight: 1.2, color: 'text.secondary' }}>
                <div>Move - Aim</div>
                <div>L.Click - Fire</div>
                <div>Hold - Auto-fire</div>
                <div>R.Click - Snap turn</div>
                <div>Wheel - Zoom</div>
              </Box>
            </Box>
          </Box>          <Divider sx={{ my: 1 }} />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2" sx={{ color: 'primary.main', fontSize: '0.75rem' }}>
              Information
            </Typography>
            <PartsInfo />
          </Box>

          <Box sx={{ fontSize: '0.7rem', color: '#ffff00', lineHeight: 1.3 }}>
            <div>• <Chip label="Blue" size="small" sx={{
              backgroundColor: '#0088ff',
              color: 'white',
              fontSize: '0.6rem',
              height: 16,
              mr: 0.5
            }} /> Your team (left side)</div>
            <div>• <Chip label="Red" size="small" sx={{
              backgroundColor: '#ff4444',
              color: 'white',
              fontSize: '0.6rem',
              height: 16,
              mr: 0.5
            }} /> AI team (right side)</div>
            <div style={{ marginTop: 4 }}>• AI ships hunt and attack enemies</div>
            <div>• Ships break apart when damaged</div>
            <div style={{ marginTop: 4 }}>• <strong style={{ color: '#00ff00' }}>Cockpit: Bright Green</strong> - 10x health for survival</div>
          </Box>
        </Paper>

        {/* Ship Selection Dialog */}
        <ShipSelection
          open={showShipSelection}
          onShipSelect={playerDestroyed ? handleRespawn : handleShipSelect}
          onClose={() => { }} // Don't allow closing without selection
          title={playerDestroyed ? "Your Ship Was Destroyed - Select New Ship" : "Select Your Ship"}
        />        {/* Right-side UI Container */}
        <Box
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            display: 'flex',
            flexDirection: 'row',
            gap: 1,
            alignItems: 'flex-start',
            zIndex: 1000
          }}
        >
          {/* Locked Targets Component */}
          <LockedTargets gameEngine={gameEngine} />

          {/* Radar Component */}
          <Radar gameEngine={gameEngine} />
        </Box>        {/* Power Management - Always visible at bottom */}
        <PowerManagement gameEngine={gameEngine} />
      </div>
    </ThemeProvider>
  );
};

export default App;
