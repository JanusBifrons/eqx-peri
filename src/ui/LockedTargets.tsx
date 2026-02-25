import React, { useEffect, useState, useRef } from 'react';
import { Paper, Typography, Box } from '@mui/material';
import { GameEngine } from '../game/core/GameEngine';
import { Assembly } from '../game/core/Assembly';

interface LockedTargetsProps {
    gameEngine: GameEngine | null;
}

interface TargetDisplay {
    id: string;
    shipName: string;
    team: number;
    destroyed: boolean;
    assembly: Assembly;
    distance: number;
    speed: number;
}

// Component for drawing ship schematic
const ShipSchematic: React.FC<{ assembly: Assembly; size: number }> = ({ assembly, size }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !assembly) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, size, size);

        // Calculate bounds of all entities
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        assembly.entities.forEach(entity => {
            const bounds = entity.body.bounds;
            minX = Math.min(minX, bounds.min.x);
            maxX = Math.max(maxX, bounds.max.x);
            minY = Math.min(minY, bounds.min.y);
            maxY = Math.max(maxY, bounds.max.y);
        });

        const shipWidth = maxX - minX;
        const shipHeight = maxY - minY;
        const scale = Math.min((size - 8) / Math.max(shipWidth, shipHeight, 1), 1);

        // Center the drawing
        const centerX = size / 2;
        const centerY = size / 2;
        const shipCenterX = (minX + maxX) / 2;
        const shipCenterY = (minY + maxY) / 2;

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(assembly.rootBody.angle);
        ctx.scale(scale, scale);
        ctx.translate(-shipCenterX, -shipCenterY);        // Draw each entity
        assembly.entities.forEach(entity => {
            const bounds = entity.body.bounds;
            const width = bounds.max.x - bounds.min.x;
            const height = bounds.max.y - bounds.min.y;

            // Choose color based on entity type
            let color = '#666666'; // Default gray

            if (entity.type === 'Cockpit' || entity.type === 'LargeCockpit' || entity.type === 'CapitalCore') {
                color = '#00ff00'; // Bright green for control centers
            } else if (entity.type === 'Gun' || entity.type === 'LargeGun' || entity.type === 'CapitalWeapon') {
                color = '#ff4444'; // Red for weapons
            } else if (entity.type === 'Engine' || entity.type === 'LargeEngine' || entity.type === 'CapitalEngine') {
                color = '#0088ff'; // Blue for engines
            } else if (entity.type === 'Hull' || entity.type === 'HeavyHull' || entity.type === 'MegaHull') {
                color = '#888888'; // Light gray for hull
            } else if (entity.type === 'PowerCell' || entity.type === 'LargePowerCell' || entity.type === 'PowerReactor') {
                color = '#ffff00'; // Yellow for power
            }

            ctx.fillStyle = color;
            ctx.fillRect(bounds.min.x, bounds.min.y, width, height);

            // Add a subtle border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(bounds.min.x, bounds.min.y, width, height);
        });

        ctx.restore();
    }, [assembly, size]);

    return (
        <canvas
            ref={canvasRef}
            width={size}
            height={size}
            style={{
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '2px',
                backgroundColor: 'rgba(0, 0, 0, 0.3)'
            }}
        />
    );
};

const LockedTargets: React.FC<LockedTargetsProps> = ({ gameEngine }) => {
    const [lockedTargets, setLockedTargets] = useState<TargetDisplay[]>([]);
    const [primaryTargetId, setPrimaryTargetId] = useState<string | null>(null);

    useEffect(() => {
        if (!gameEngine) return;

        const updateLockedTargets = () => {
            try {
                const playerAssembly = gameEngine.getPlayerAssembly();
                if (!playerAssembly) {
                    setLockedTargets([]);
                    setPrimaryTargetId(null);
                    return;
                }                // Get locked targets from the game engine
                const targets = gameEngine.getLockedTargets(playerAssembly);
                const primaryTarget = playerAssembly.primaryTarget;
                const playerPos = playerAssembly.rootBody.position;

                // Convert to display format with additional data
                const targetsDisplay = targets.map(target => {
                    // Calculate distance
                    const targetPos = target.rootBody.position;
                    const distance = Math.sqrt(
                        Math.pow(targetPos.x - playerPos.x, 2) +
                        Math.pow(targetPos.y - playerPos.y, 2)
                    );

                    // Calculate speed
                    const velocity = target.rootBody.velocity;
                    const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);

                    return {
                        id: target.id,
                        shipName: target.shipName,
                        team: target.team,
                        destroyed: target.destroyed,
                        assembly: target,
                        distance: Math.round(distance),
                        speed: Math.round(speed * 10) / 10 // Round to 1 decimal
                    };
                });

                setLockedTargets(targetsDisplay);
                setPrimaryTargetId(primaryTarget?.id || null);
            } catch (error) {
                console.error('Error updating locked targets:', error);
            }
        };

        const interval = setInterval(updateLockedTargets, 200);
        updateLockedTargets();

        return () => clearInterval(interval);
    }, [gameEngine]);

    if (!gameEngine) return null; return (<Paper
        elevation={2}
        sx={{
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            border: '1px solid #333',
            borderRadius: 1,
            p: 1,
            minWidth: 140,
            maxWidth: 180,
            maxHeight: '60vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto' // Allow pointer events only on this component
        }}
    >
        <Typography
            variant="caption"
            sx={{
                color: '#ff8800',
                fontSize: '0.65rem',
                fontWeight: 'bold',
                display: 'block',
                mb: 0.5,
                letterSpacing: '0.3px',
                fontFamily: 'monospace'
            }}
        >
            LOCKED TARGETS
        </Typography>

        {lockedTargets.length === 0 ? (
            <Typography
                variant="caption"
                sx={{
                    color: '#666666',
                    fontSize: '0.6rem',
                    fontStyle: 'italic',
                    fontFamily: 'monospace'
                }}
            >
                Use radar "Lock On"
            </Typography>) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {lockedTargets.map((target) => {
                    const isPrimary = target.id === primaryTargetId;
                    const teamColor = target.team === 0 ? '#0088ff' : '#ff4444';

                    return (
                        <Box
                            key={target.id}
                            sx={{
                                border: isPrimary ? '2px solid #ffff00' : '1px solid rgba(255, 255, 255, 0.2)',
                                borderRadius: 1,
                                p: 1,
                                backgroundColor: isPrimary ? 'rgba(255, 255, 0, 0.1)' : 'rgba(0, 0, 0, 0.3)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 0.5,
                                minWidth: 120
                            }}
                        >
                            {/* Ship Schematic */}
                            <ShipSchematic assembly={target.assembly} size={80} />

                            {/* Ship Details */}
                            <Box sx={{ textAlign: 'center', width: '100%' }}>
                                {/* Ship Name */}
                                <Typography
                                    variant="caption"
                                    sx={{
                                        color: isPrimary ? '#ffff88' : teamColor,
                                        fontSize: '0.7rem',
                                        fontFamily: 'monospace',
                                        fontWeight: 'bold',
                                        display: 'block'
                                    }}
                                >
                                    {target.shipName}
                                </Typography>

                                {/* Distance */}
                                <Typography
                                    variant="caption"
                                    sx={{
                                        color: '#cccccc',
                                        fontSize: '0.6rem',
                                        fontFamily: 'monospace',
                                        display: 'block'
                                    }}
                                >
                                    {target.distance}m
                                </Typography>

                                {/* Speed */}
                                <Typography
                                    variant="caption"
                                    sx={{
                                        color: '#cccccc',
                                        fontSize: '0.6rem',
                                        fontFamily: 'monospace',
                                        display: 'block'
                                    }}
                                >
                                    {target.speed} m/s
                                </Typography>

                                {isPrimary && (
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            color: '#ffff00',
                                            fontSize: '0.5rem',
                                            fontFamily: 'monospace',
                                            fontWeight: 'bold',
                                            display: 'block'
                                        }}
                                    >
                                        PRIMARY
                                    </Typography>
                                )}
                            </Box>
                        </Box>
                    );
                })}
            </Box>
        )}
    </Paper>
    );
};

export default LockedTargets;
