import React, { useState, useEffect } from 'react';
import { Button, Box, Typography, styled, keyframes } from '@mui/material';
import { GameEngine } from '../game/core/GameEngine';

interface EjectButtonProps {
    gameEngine: GameEngine | null;
}

const pulseAnimation = keyframes`
  0% { 
    background-color: #ff0000;
    box-shadow: 0 0 10px rgba(255, 0, 0, 0.8);
  }
  50% { 
    background-color: #ff4444;
    box-shadow: 0 0 30px rgba(255, 0, 0, 1.0);
  }
  100% { 
    background-color: #ff0000;
    box-shadow: 0 0 10px rgba(255, 0, 0, 0.8);
  }
`;

const StyledEjectButton = styled(Button)<{ isFlashing: boolean }>(({ isFlashing }) => ({
    backgroundColor: isFlashing ? '#ff0000' : '#ff6600',
    color: 'white',
    fontSize: '1.2rem',
    fontWeight: 'bold',
    fontFamily: 'monospace',
    padding: '12px 24px',
    borderRadius: '8px',
    border: '3px solid #ffffff',
    boxShadow: '0 0 20px rgba(255, 100, 0, 0.8)',
    animation: isFlashing ? `${pulseAnimation} 1s infinite` : 'none',
    '&:hover': {
        backgroundColor: isFlashing ? '#cc0000' : '#cc4400',
        boxShadow: '0 0 30px rgba(255, 100, 0, 1.0)',
    },
    '&:active': {
        backgroundColor: '#990000',
    }
}));

const EjectButton: React.FC<EjectButtonProps> = ({ gameEngine }) => {
    const [canEject, setCanEject] = useState(false);
    const [damagePercentage, setDamagePercentage] = useState(0);
    const [isFlashing, setIsFlashing] = useState(false);

    useEffect(() => {
        if (!gameEngine) return;

        const updateEjectStatus = () => {
            const canEjectNow = gameEngine.canPlayerEject();
            const damage = gameEngine.getPlayerDamagePercentage();

            setCanEject(canEjectNow);
            setDamagePercentage(damage);

            // Flash the button when damage is high (60%+) to indicate emergency status
            setIsFlashing(damage >= 60);
        };

        // Update every 100ms for responsive UI
        const interval = setInterval(updateEjectStatus, 100);
        updateEjectStatus(); // Initial update

        return () => clearInterval(interval);
    }, [gameEngine]);

    const handleEject = () => {
        if (gameEngine && canEject) {
            gameEngine.ejectPlayer();
        }
    };

    if (!gameEngine || !canEject) {
        return null; // Don't show button if can't eject
    }    return (        <Box
            sx={{
                position: 'absolute',
                bottom: 20,
                right: 20,
                zIndex: 1000,
                pointerEvents: 'auto'
            }}
        >
            <StyledEjectButton
                variant="contained"
                onClick={handleEject}
                isFlashing={isFlashing}
            >
                🚀 EJECT
            </StyledEjectButton>

            {/* Damage indicator */}
            <Typography
                variant="caption"
                sx={{
                    display: 'block',
                    textAlign: 'center',
                    color: damagePercentage >= 60 ? '#ff4444' : '#ffaa00',
                    fontWeight: 'bold',
                    marginTop: '4px',
                    fontSize: '0.8rem',
                    textShadow: '1px 1px 2px rgba(0,0,0,0.8)'
                }}
            >
                {damagePercentage >= 60 ? '⚠️ EMERGENCY' : `${Math.round(damagePercentage)}% DAMAGE`}
            </Typography>
        </Box>
    );
};

export default EjectButton;
