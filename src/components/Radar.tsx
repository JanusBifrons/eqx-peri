import React, { useEffect, useRef, useState } from 'react';

interface RadarBlip {
    x: number;
    y: number;
    team: number;
    isPlayer: boolean;
    id: string;
}

interface RadarProps {
    gameEngine: any;
}

const Radar: React.FC<RadarProps> = ({ gameEngine }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [radarData, setRadarData] = useState<RadarBlip[]>([]);
    const radarSize = 200;
    const radarRange = 100000; useEffect(() => {
        const updateRadar = () => {
            console.log('📡 Radar update - gameEngine:', !!gameEngine);

            if (gameEngine && typeof gameEngine.getRadarData === 'function') {
                try {
                    const data = gameEngine.getRadarData();
                    console.log('📡 Radar received data:', data?.length || 0, 'blips');
                    console.log('📡 Raw radar data:', data);
                    setRadarData(data || []);
                } catch (error) {
                    console.error('📡 Radar update failed:', error);
                    setRadarData([]);
                }
            } else {
                console.log('📡 GameEngine not ready or missing getRadarData method');
                setRadarData([]);
            }
        };

        // Update more frequently to catch data sooner
        const interval = setInterval(updateRadar, 500);
        updateRadar();
        return () => clearInterval(interval);
    }, [gameEngine]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, radarSize, radarSize);
        ctx.fillStyle = 'rgba(0, 30, 0, 0.9)';
        ctx.fillRect(0, 0, radarSize, radarSize);

        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, radarSize - 2, radarSize - 2);

        const center = radarSize / 2;
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(center, 0);
        ctx.lineTo(center, radarSize);
        ctx.moveTo(0, center);
        ctx.lineTo(radarSize, center);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '10px monospace';
        ctx.fillText(`Engine: ${gameEngine ? 'OK' : 'NULL'}`, 5, 15);
        ctx.fillText(`Blips: ${radarData.length}`, 5, 25);

        if (radarData.length === 0) {
            ctx.fillStyle = '#ff0000';
            ctx.fillText('NO DATA', center - 25, center);
            return;
        }

        const playerBlip = radarData.find(blip => blip.isPlayer);
        const centerBlip = playerBlip || radarData[0];

        radarData.forEach((blip) => {
            const relX = centerBlip ? blip.x - centerBlip.x : blip.x;
            const relY = centerBlip ? blip.y - centerBlip.y : blip.y;

            const radarX = center + (relX / radarRange) * (radarSize * 0.4);
            const radarY = center + (relY / radarRange) * (radarSize * 0.4);

            if (radarX >= 5 && radarX <= radarSize - 5 && radarY >= 5 && radarY <= radarSize - 5) {
                ctx.beginPath();

                if (blip.isPlayer) {
                    const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
                    ctx.arc(radarX, radarY, 6, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(0, 255, 255, ${pulse})`;
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                } else {
                    ctx.arc(radarX, radarY, 4, 0, Math.PI * 2);
                    ctx.fillStyle = blip.team === 0 ? '#0066ff' : '#ff0000';
                    ctx.fill();
                }
            }
        });

        const sweepAngle = (Date.now() / 1000) % (Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(center, center);
        ctx.lineTo(
            center + Math.cos(sweepAngle) * (radarSize * 0.4),
            center + Math.sin(sweepAngle) * (radarSize * 0.4)
        );
        ctx.stroke();

    }, [radarData, radarSize, radarRange]);

    return (
        <div style={{
            position: 'absolute',
            top: 10,
            right: 10,
            background: 'rgba(0, 0, 0, 0.9)',
            border: '2px solid #00ff00',
            borderRadius: '8px',
            padding: '10px',
            zIndex: 10000
        }}>
            <div style={{
                color: '#00ff00',
                fontSize: '12px',
                fontFamily: 'monospace',
                marginBottom: '5px',
                textAlign: 'center',
                fontWeight: 'bold'
            }}>
                ◉ RADAR ◉
            </div>
            <canvas
                ref={canvasRef}
                width={radarSize}
                height={radarSize}
                style={{ border: '1px solid #00ff00' }}
            />
            <div style={{
                color: '#00ff00',
                fontSize: '10px',
                fontFamily: 'monospace',
                marginTop: '5px',
                textAlign: 'center',
                lineHeight: '1.2'
            }}>
                <div style={{ color: '#0066ff' }}>🔵 BLUE TEAM</div>
                <div style={{ color: '#ff0000' }}>🔴 RED TEAM</div>
                <div style={{ color: '#00ffff' }}>⭐ YOU</div>
            </div>
        </div>
    );
};

export default Radar;
