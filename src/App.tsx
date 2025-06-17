import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './game/GameEngine';
import Radar from './components/Radar';

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
    <div style={{ width: '100vw', height: '100vh', position: 'relative', backgroundColor: '#001122' }}>
      <div ref={canvasRef} style={{
        width: '100%',
        height: '100%',
        border: '2px solid #333'
      }} />      {/* Controls Panel */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: 'rgba(0,0,0,0.8)',
        padding: '15px',
        borderRadius: '8px',
        fontSize: '14px',
        fontFamily: 'monospace',
        color: '#ffffff',
        border: '1px solid #333'
      }}>
        <div style={{ color: '#00ff00', marginBottom: '8px', fontWeight: 'bold' }}>🚀 AI BATTLE SPACE GAME - TEAM COMBAT</div>
        <div style={{ marginBottom: '6px' }}>Keyboard Controls:</div>
        <div>W/S - Forward/Reverse Thrust</div>
        <div>A/D - Manual Rotation</div>
        <div>Space - Fire Guns</div>
        <div>R - Restart Battle</div>
        <div>G - Toggle Grid</div>
        <div>1 - Add Random Ship</div>

        <div style={{ marginTop: '8px', marginBottom: '6px', color: '#00ccff' }}>Mouse Controls:</div>
        <div style={{ color: '#cccccc' }}>Move Mouse - Rotate ship to face cursor</div>
        <div style={{ color: '#cccccc' }}>Left Click - Fire at cursor</div>
        <div style={{ color: '#cccccc' }}>Hold Left Click - Continuous fire</div>
        <div style={{ color: '#cccccc' }}>Right Click - Instant rotate to cursor</div>
        <div style={{ color: '#cccccc' }}>Mouse Wheel - Zoom in/out</div>
        <div style={{ marginTop: '8px', color: '#ffff00', fontSize: '12px' }}>
          • You are on the blue team (left side)<br />
          • AI controls red team ships (right side)<br />
          • AI ships will hunt and attack enemies<br />
          • Ships break apart when damaged<br />
          • Press R to restart the battle
        </div>
      </div>      {/* Radar Component - Always visible */}
      <Radar gameEngine={gameEngine} />
    </div>
  );
};

export default App;
