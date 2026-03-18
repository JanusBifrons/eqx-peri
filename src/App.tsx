import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './game/core/GameEngine';
import Radar from './ui/Radar';
import LockedTargets from './ui/LockedTargets';
import PowerManagement from './ui/PowerManagement';
import FlightControls from './ui/FlightControls';
import MainMenu from './ui/MainMenu';
import SettingsPanel from './ui/SettingsPanel';
import ShipActionPanel from './ui/ShipActionPanel';
import ShipBuilderPanel from './ui/ShipBuilderPanel';
import StructuresPanel from './ui/StructuresPanel';
import ConfirmDialog from './ui/ConfirmDialog';
import PerformanceBar from './ui/PerformanceBar';
import {
  Box,
  Button,
  ThemeProvider,
  createTheme
} from '@mui/material';
import { ScenarioConfig } from './types/GameTypes';
import { PERF_BAR_HEIGHT } from './ui/PerformanceBar';

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

type AppScreen = 'main-menu' | 'playing';

const App: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const gameEngineRef = useRef<GameEngine | null>(null);
  const [gameEngine, setGameEngine] = useState<GameEngine | null>(null);
  const [screen, setScreen] = useState<AppScreen>('main-menu');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showPerfBar, setShowPerfBar] = useState(false);
  const [isShipBuilder, setIsShipBuilder] = useState(false);
  const [isStructuresSandbox, setIsStructuresSandbox] = useState(false);

  const handlePerfBarChange = (visible: boolean): void => {
    setShowPerfBar(visible);
  };

  const returnToMenu = (): void => {
    if (gameEngineRef.current) {
      gameEngineRef.current.stop();
      gameEngineRef.current = null;
    }
    setGameEngine(null);
    setIsShipBuilder(false);
    setIsStructuresSandbox(false);
    setConfirmOpen(false);
    setScreen('main-menu');
  };

  const handleScenarioStart = (scenario: ScenarioConfig): void => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current);
    gameEngineRef.current = engine;
    setGameEngine(engine);
    engine.setScenario(scenario);
    engine.start();
    setIsShipBuilder(scenario.shipBuilderMode);
    setIsStructuresSandbox(scenario.structuresSandboxMode);
    setScreen('playing');
  };

  // Escape key opens the exit confirm dialog during gameplay
  useEffect(() => {
    if (screen !== 'playing') return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setConfirmOpen(prev => !prev);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [screen]);

  useEffect(() => {
    return () => {
      if (gameEngineRef.current) {
        gameEngineRef.current.stop();
        setGameEngine(null);
      }
    };
  }, []);

  return (
    <ThemeProvider theme={darkTheme}>
      <div style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        backgroundColor: '#001122',
        overflow: 'hidden'
      }}>
        <div ref={canvasRef} style={{
          width: '100%',
          height: '100%',
          border: '2px solid #333'
        }} />

        {/* Main Menu overlay */}
        {screen === 'main-menu' && <MainMenu onStart={handleScenarioStart} />}

        {/* Menu button — top-left, always visible during gameplay */}
        {screen === 'playing' && (
          <Button
            variant="outlined"
            size="small"
            onClick={() => setConfirmOpen(true)}
            sx={{
              position: 'absolute',
              top: showPerfBar ? PERF_BAR_HEIGHT + 10 : 10,
              left: 10,
              zIndex: 1100,
              fontSize: '0.7rem',
              color: '#888',
              borderColor: '#555',
              pointerEvents: 'auto',
              minWidth: 'unset',
              px: 1.5,
              py: 0.5,
              '&:hover': { borderColor: '#00ccff', color: '#00ccff' },
            }}
          >
            ☰ Menu
          </Button>
        )}

        {/* Ship builder palette — shown only in ship builder mode */}
        {screen === 'playing' && isShipBuilder && (
          <ShipBuilderPanel gameEngine={gameEngine} />
        )}

        {/* Structures build menu — shown only in structures sandbox mode */}
        {screen === 'playing' && isStructuresSandbox && (
          <StructuresPanel gameEngine={gameEngine} />
        )}

        {/* Combat HUD — hidden in ship builder mode */}
        {screen === 'playing' && !isShipBuilder && (
          <>
            {/* Right-side UI Container */}
            <Box
              sx={{
                position: 'absolute',
                top: showPerfBar ? PERF_BAR_HEIGHT + 10 : 10,
                right: 10,
                display: 'flex',
                flexDirection: 'row',
                gap: 1,
                alignItems: 'flex-start',
                zIndex: 1000,
                pointerEvents: 'none'
              }}
            >
              <LockedTargets gameEngine={gameEngine} />
              <Radar gameEngine={gameEngine} />
            </Box>

            {/* Power Management - bottom */}
            <PowerManagement gameEngine={gameEngine} />

            {/* Ship action panel - bottom center */}
            <ShipActionPanel gameEngine={gameEngine} />

            {/* Flight Controls - bottom right */}
            <FlightControls gameEngine={gameEngine} />
          </>
        )}

        {/* Settings panel - bottom left */}
        <SettingsPanel gameEngine={gameEngine} onPerfBarChange={handlePerfBarChange} />

        {/* Performance bar - top of screen, toggled via Settings */}
        <PerformanceBar gameEngine={gameEngine} visible={showPerfBar} />


        {/* Return-to-menu confirm dialog */}
        <ConfirmDialog
          open={confirmOpen}
          title="Return to Main Menu?"
          message="Your current battle will end. Return to the main menu?"
          onConfirm={returnToMenu}
          onCancel={() => setConfirmOpen(false)}
        />
      </div>
    </ThemeProvider>
  );
};

export default App;
