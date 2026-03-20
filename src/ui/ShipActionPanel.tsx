import React from 'react';
import { Box, Button, Typography, LinearProgress, styled } from '@mui/material';
import { FlightTakeoff, SmartToy, SmartToyOutlined } from '@mui/icons-material';
import { GameEngine } from '../game/core/GameEngine';
import { useGameStore } from '../stores/gameStore';

interface ShipActionPanelProps {
    gameEngine: GameEngine | null;
}

// bottom-center HUD panel — shown when an enemy or friendly ship is selected (but not piloted)
const PanelContainer = styled(Box)(() => ({
    position: 'absolute',
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    pointerEvents: 'auto',
    zIndex: 1000,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    border: '1px solid #333',
    borderRadius: 8,
    padding: '10px 16px',
    minWidth: 200,
}));

const ShipActionPanel: React.FC<ShipActionPanelProps> = ({ gameEngine }) => {
    const selectedAssembly = useGameStore(s => s.selectedAssembly);
    const playerAssembly = useGameStore(s => s.playerAssembly);
    const hasAI = useGameStore(s => s.selectedAssemblyAIEnabled);
    // frameTick ensures we re-render each frame to pick up damage changes
    useGameStore(s => s.frameTick);

    // Hide when nothing selected or selected ship is the one being piloted
    if (!selectedAssembly || selectedAssembly === playerAssembly) return null;

    const shipName = selectedAssembly.shipName;
    const damagePercent = selectedAssembly.getDamagePercentage();
    const isFriendly = selectedAssembly.team === 0;
    const healthPercent = 100 - damagePercent;
    const healthColor = healthPercent > 60 ? '#00ff00' : healthPercent > 30 ? '#ffaa00' : '#ff4444';

    const handlePilot = (): void => {
        const assembly = gameEngine?.getSelectedAssembly();
        if (assembly) gameEngine?.pilotAssembly(assembly);
    };

    const handleDisableAI = (): void => {
        const assembly = gameEngine?.getSelectedAssembly();
        if (assembly) gameEngine?.disableAI(assembly);
    };

    const handleEnableAI = (): void => {
        const assembly = gameEngine?.getSelectedAssembly();
        if (assembly) gameEngine?.enableAI(assembly);
    };

    return (
        <PanelContainer>
            <Typography
                variant="caption"
                sx={{ color: isFriendly ? '#00ccff' : '#ff4444', fontWeight: 'bold', fontSize: '0.75rem' }}
            >
                {shipName}
            </Typography>

            <Box sx={{ width: '100%' }}>
                <LinearProgress
                    variant="determinate"
                    value={healthPercent}
                    sx={{
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: '#333',
                        '& .MuiLinearProgress-bar': { backgroundColor: healthColor },
                    }}
                />
                <Typography variant="caption" sx={{ color: '#aaa', fontSize: '0.65rem' }}>
                    {Math.round(healthPercent)}% hull integrity
                </Typography>
            </Box>

            {isFriendly && (
                <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<FlightTakeoff />}
                        onClick={handlePilot}
                        sx={{
                            fontSize: '0.7rem',
                            color: '#00ccff',
                            borderColor: '#00ccff',
                            '&:hover': { backgroundColor: 'rgba(0, 204, 255, 0.1)', borderColor: '#00ccff' },
                        }}
                    >
                        Pilot
                    </Button>

                    {hasAI ? (
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<SmartToy />}
                            onClick={handleDisableAI}
                            sx={{
                                fontSize: '0.7rem',
                                color: '#ffaa00',
                                borderColor: '#ffaa00',
                                '&:hover': { backgroundColor: 'rgba(255, 170, 0, 0.1)', borderColor: '#ffaa00' },
                            }}
                        >
                            Disable AI
                        </Button>
                    ) : (
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<SmartToyOutlined />}
                            onClick={handleEnableAI}
                            sx={{
                                fontSize: '0.7rem',
                                color: '#888',
                                borderColor: '#888',
                                '&:hover': { backgroundColor: 'rgba(136, 136, 136, 0.1)', borderColor: '#888' },
                            }}
                        >
                            Enable AI
                        </Button>
                    )}
                </Box>
            )}
        </PanelContainer>
    );
};

export default ShipActionPanel;
