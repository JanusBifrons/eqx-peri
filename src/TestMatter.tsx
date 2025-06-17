import React, { useEffect, useRef } from 'react';
import * as Matter from 'matter-js';

const TestMatter: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Create engine
    const engine = Matter.Engine.create();
    
    // Create renderer
    const render = Matter.Render.create({
      element: canvasRef.current,
      engine: engine,
      options: {
        width: 800,
        height: 600,
        wireframes: false,
        background: '#001122'
      }
    });

    // Create a simple box
    const box = Matter.Bodies.rectangle(400, 200, 80, 80, {
      render: {
        fillStyle: '#ff0000'
      }
    });

    // Add box to world
    Matter.World.add(engine.world, box);

    // Start renderer and engine
    Matter.Render.run(render);
    Matter.Runner.run(Matter.Runner.create(), engine);

    console.log('Test Matter.js setup complete');

    return () => {
      Matter.Render.stop(render);
      Matter.Engine.clear(engine);
    };
  }, []);

  return (
    <div>
      <h2>Matter.js Test</h2>
      <div ref={canvasRef} style={{ border: '2px solid #fff' }} />
    </div>
  );
};

export default TestMatter;
