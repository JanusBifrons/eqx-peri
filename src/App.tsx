import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './game/core/GameEngine';
import FlightControls from './ui/FlightControls';
import MainMenu from './ui/MainMenu';
import MiniDrawer from './ui/MiniDrawer';
import ModeToggle from './ui/ModeToggle';
import SettingsPanel from './ui/SettingsPanel';
import ShipActionPanel from './ui/ShipActionPanel';
import ShipBuilderPanel from './ui/ShipBuilderPanel';
import StructuresPanel from './ui/StructuresPanel';
import StructureActionPanel from './ui/StructureActionPanel';
import ConfirmDialog from './ui/ConfirmDialog';
import PerformanceBar from './ui/PerformanceBar';
import {
  ThemeProvider,
  createTheme
} from '@mui/material';
import { ScenarioConfig } from './types/GameTypes';
import { useGameStore } from './stores/gameStore';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showPerfBar, setShowPerfBar] = useState(false);
  const [isShipBuilder, setIsShipBuilder] = useState(false);
  const [isStructuresSandbox, setIsStructuresSandbox] = useState(false);

  const interactionMode = useGameStore(s => s.interactionMode);

  // Cancel active structure placement when switching to select mode
  useEffect(() => {
    if (interactionMode === 'select' && gameEngine) {
      gameEngine.cancelStructurePlacement();
    }
  }, [interactionMode, gameEngine]);

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

  const isPlaying = screen === 'playing';

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

        {/* MUI Mini Variant Drawer — left side navigation */}
        <MiniDrawer
          visible={isPlaying}
          onSettingsClick={() => setSettingsOpen(true)}
          onExitClick={() => setConfirmOpen(true)}
        />

        {/* Ship builder palette — shown only in ship builder mode */}
        {isPlaying && isShipBuilder && (
          <ShipBuilderPanel gameEngine={gameEngine} />
        )}

        {/* Structures build menu — shown only in build mode within structures sandbox */}
        {isPlaying && isStructuresSandbox && interactionMode === 'build' && (
          <>
            <StructuresPanel gameEngine={gameEngine} />
            <StructureActionPanel gameEngine={gameEngine} />
          </>
        )}

        {/* Structure action panel — always visible when a structure is selected */}
        {isPlaying && isStructuresSandbox && interactionMode === 'select' && (
          <StructureActionPanel gameEngine={gameEngine} />
        )}

        {/* Combat HUD — hidden in ship builder mode */}
        {isPlaying && !isShipBuilder && (
          <>
            {/* Ship action panel - bottom center (offset right for mode toggle) */}
            <ShipActionPanel gameEngine={gameEngine} />

            {/* Flight Controls - bottom right */}
            <FlightControls gameEngine={gameEngine} />
          </>
        )}

        {/* Select / Build mode toggle — bottom center */}
        {isPlaying && !isShipBuilder && <ModeToggle />}

        {/* Settings dialog (no gear button — opened via MiniDrawer) */}
        <SettingsPanel
          gameEngine={gameEngine}
          onPerfBarChange={handlePerfBarChange}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />

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
