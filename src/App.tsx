import React, { useEffect, useRef } from 'react';
import { GameEngine } from './game/GameEngine';
import TestMatter from './TestMatter';

const App: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const gameEngineRef = useRef<GameEngine | null>(null);  useEffect(() => {
    console.log('🎮 App useEffect triggered');
    console.log('Canvas ref current:', canvasRef.current);
    
    // Add a small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      if (canvasRef.current && !gameEngineRef.current) {
        console.log('🚀 Creating GameEngine...');
        console.log('Container dimensions:', canvasRef.current.clientWidth, 'x', canvasRef.current.clientHeight);
        gameEngineRef.current = new GameEngine(canvasRef.current);
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
      }
    };
  }, []);  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', backgroundColor: '#001122' }}>
      <div ref={canvasRef} style={{ 
        width: '100%', 
        height: '100%', 
        border: '2px solid #333'
      }} /><div style={{ 
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
      }}>        <div style={{ color: '#00ff00', marginBottom: '8px', fontWeight: 'bold' }}>🚀 MODULAR SPACE GAME - BREAKING DEMO</div>
        <div style={{ marginBottom: '6px' }}>Controls:</div>
        <div>W - Apply Thrust</div>
        <div>A/D - Rotate Ship</div>
        <div>S - Reverse Thrust</div>
        <div>Space - Fire Guns</div>
        <div style={{ marginTop: '8px', marginBottom: '6px' }}>Spawn:</div>
        <div>1 - Add Random Ship</div>
        <div>G - Toggle Grid</div>
        <div style={{ marginTop: '8px', color: '#ffff00', fontSize: '12px' }}>
          • Shoot at ships to break them apart<br/>
          • Parts split into new ships when destroyed<br/>
          • Each fragment becomes independent<br/>
          • Cockpit required for control
          • Matter.js physics + debug rendering
        </div>
      </div>
    </div>
  );
};

export default App;
