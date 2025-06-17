import React, { useEffect, useState } from 'react';
import {
    Paper,
    Typography,
    Box,
    LinearProgress,
    Chip,
    Divider
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { GameEngine } from '../game/GameEngine';

interface StatusHUDProps {
    gameEngine: GameEngine | null;
}

const HUDPaper = styled(Paper)(() => ({
    position: 'absolute',
    bottom: 10,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 600,
    maxWidth: '90vw',
    height: 80,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    border: '1px solid #333',
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    gap: 2,
    '& .MuiTypography-root': {
        color: '#ffffff',
        fontSize: '0.75rem',
        fontFamily: 'monospace'
    }
}));

const StatusSection = styled(Box)(() => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    minWidth: 80,
    '& .status-label': {
        fontSize: '0.6rem',
        color: '#888',
        textTransform: 'uppercase',
        marginBottom: 2
    },
    '& .status-value': {
        fontSize: '0.8rem',
        color: '#00ff00',
        fontWeight: 'bold'
    }
}));

const HealthBar = styled(LinearProgress)(() => ({
    width: 100,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333',
    '& .MuiLinearProgress-bar': {
        borderRadius: 4,
        transition: 'background-color 0.3s ease'
    }
}));

const StatusHUD: React.FC<StatusHUDProps> = ({ gameEngine }) => {
    const [playerStatus, setPlayerStatus] = useState<any>(null);
    const [activeCommand, setActiveCommand] = useState<string | null>(null);

    useEffect(() => {
        if (!gameEngine) return;

        const updateStatus = () => {
            try {
                const playerAssembly = gameEngine.getPlayerAssembly();
                if (!playerAssembly || playerAssembly.destroyed) {
                    setPlayerStatus(null);
                    return;
                }

                const body = playerAssembly.rootBody;
                const velocity = body.velocity;
                const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);

                // Calculate health percentage
                const totalEntities = playerAssembly.entities.length;
                const healthyEntities = playerAssembly.entities.filter((e: any) => !e.destroyed).length;
                const healthPercent = totalEntities > 0 ? (healthyEntities / totalEntities) * 100 : 0;

                // Get active command info
                const selectedAssembly = gameEngine.getSelectedAssembly();
                const currentCommand = gameEngine.getPlayerCommand();

                setPlayerStatus({
                    position: {
                        x: Math.round(body.position.x),
                        y: Math.round(body.position.y)
                    },
                    speed: Math.round(speed * 10) / 10, // Round to 1 decimal
                    angle: Math.round((body.angle * 180 / Math.PI) % 360), // Convert to degrees
                    health: Math.round(healthPercent),
                    healthyBlocks: healthyEntities,
                    totalBlocks: totalEntities,
                    targetName: selectedAssembly ? (selectedAssembly.shipName || `Ship-${selectedAssembly.id.slice(-4)}`) : null,
                    targetDistance: selectedAssembly ? Math.round(Math.sqrt(
                        Math.pow(selectedAssembly.rootBody.position.x - body.position.x, 2) +
                        Math.pow(selectedAssembly.rootBody.position.y - body.position.y, 2)
                    )) : null
                });

                setActiveCommand(currentCommand);
            } catch (error) {
                console.error('Status HUD update error:', error);
            }
        };

        const interval = setInterval(updateStatus, 100); // Update 10 times per second
        return () => clearInterval(interval);
    }, [gameEngine]);

    if (!playerStatus) {
        return (
            <HUDPaper elevation={3}>
                <Typography sx={{ color: '#ff4444', fontSize: '0.8rem' }}>
                    🚫 Player Ship Destroyed or Not Found
                </Typography>
            </HUDPaper>
        );
    }

    const getHealthColor = (health: number) => {
        if (health > 75) return '#00ff00';
        if (health > 50) return '#ffff00';
        if (health > 25) return '#ff8800';
        return '#ff4444';
    };

    const getSpeedColor = (speed: number) => {
        if (speed < 1) return '#888';
        if (speed < 3) return '#00ff00';
        if (speed < 6) return '#ffff00';
        return '#ff4444';
    };

    return (
        <HUDPaper elevation={3}>
            {/* Health Section */}
            <StatusSection>
                <Typography className="status-label">Health</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <HealthBar
                        variant="determinate"
                        value={playerStatus.health}
                        sx={{
                            '& .MuiLinearProgress-bar': {
                                backgroundColor: getHealthColor(playerStatus.health)
                            }
                        }}
                    />
                    <Typography className="status-value" sx={{ color: getHealthColor(playerStatus.health) }}>
                        {playerStatus.health}%
                    </Typography>
                </Box>
                <Typography sx={{ fontSize: '0.6rem', color: '#666' }}>
                    {playerStatus.healthyBlocks}/{playerStatus.totalBlocks} blocks
                </Typography>
            </StatusSection>

            <Divider orientation="vertical" sx={{ height: 50, borderColor: '#333' }} />

            {/* Speed Section */}
            <StatusSection>
                <Typography className="status-label">Speed</Typography>
                <Typography className="status-value" sx={{ color: getSpeedColor(playerStatus.speed) }}>
                    {playerStatus.speed}
                </Typography>
                <Typography sx={{ fontSize: '0.6rem', color: '#666' }}>
                    units/s
                </Typography>
            </StatusSection>

            <Divider orientation="vertical" sx={{ height: 50, borderColor: '#333' }} />

            {/* Position Section */}
            <StatusSection>
                <Typography className="status-label">Position</Typography>
                <Typography className="status-value">
                    {playerStatus.position.x}, {playerStatus.position.y}
                </Typography>
                <Typography sx={{ fontSize: '0.6rem', color: '#666' }}>
                    {playerStatus.angle}° heading
                </Typography>
            </StatusSection>

            <Divider orientation="vertical" sx={{ height: 50, borderColor: '#333' }} />

            {/* Target/Command Section */}
            <StatusSection sx={{ minWidth: 120 }}>
                <Typography className="status-label">
                    {activeCommand ? 'Command' : 'Target'}
                </Typography>
                {activeCommand ? (
                    <>
                        <Chip
                            size="small"
                            label={activeCommand.toUpperCase()}
                            sx={{
                                backgroundColor: '#00ff00',
                                color: '#000',
                                fontSize: '0.7rem',
                                height: 20
                            }}
                        />
                        {playerStatus.targetName && (
                            <Typography sx={{ fontSize: '0.6rem', color: '#666' }}>
                                → {playerStatus.targetName}
                            </Typography>
                        )}
                    </>
                ) : playerStatus.targetName ? (
                    <>
                        <Typography className="status-value" sx={{ fontSize: '0.7rem' }}>
                            {playerStatus.targetName}
                        </Typography>
                        <Typography sx={{ fontSize: '0.6rem', color: '#666' }}>
                            {playerStatus.targetDistance} units
                        </Typography>
                    </>
                ) : (
                    <Typography sx={{ fontSize: '0.7rem', color: '#666' }}>
                        No Target
                    </Typography>
                )}
            </StatusSection>
        </HUDPaper>
    );
};

export default StatusHUD;
