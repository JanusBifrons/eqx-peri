import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './game/GameEngine';
import Radar from './components/Radar';
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
  const [gameEngine, setGameEngine] = useState<GameEngine | null>(null); useEffect(() => {
    console.log('🎮 App useEffect triggered');
    console.log('Canvas ref current:', canvasRef.current);

    // Add a small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      if (canvasRef.current && !gameEngineRef.current) {
        console.log('🚀 Creating GameEngine...');
        console.log('Container dimensions:', canvasRef.current.clientWidth, 'x', canvasRef.current.clientHeight);
        gameEngineRef.current = new GameEngine(canvasRef.current);
        setGameEngine(gameEngineRef.current);
        console.log('▶️  Starting GameEngine...');
        gameEngineRef.current.start();
        console.log('✅ GameEngine started');
      } else {
        console.log('❌ Canvas ref not available or GameEngine already exists');
      }
    }, 100);

    return () => {
      clearTimeout(timer);
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
              </Typography>
              <Box sx={{ fontSize: '0.7rem', lineHeight: 1.2 }}>
                <div>W/S - Thrust</div>
                <div>A/D - Rotate</div>
                <div>Space - Fire</div>
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
          </Box>

          <Divider sx={{ my: 1 }} />

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
          </Box>
        </Paper>

        {/* Radar Component - Always visible */}
        <Radar gameEngine={gameEngine} />
      </div>
    </ThemeProvider>
  );
};

export default App;
