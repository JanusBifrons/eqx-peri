import React, { useState, useEffect } from 'react';
import { Box, Tooltip } from '@mui/material';
import { Air, Eject } from '@mui/icons-material';
import { styled, keyframes } from '@mui/material/styles';
import { GameEngine } from '../game/core/GameEngine';

interface FlightControlsProps {
    gameEngine: GameEngine | null;
}

const DAMPENING_ON_COLOR = '#00ccff';
const DAMPENING_OFF_COLOR = '#444444';
const EJECT_NORMAL_COLOR = '#ff6600';

const ejectPulse = keyframes`
  0%   { border-color: #ff6600; box-shadow: 0 0 8px rgba(255, 102, 0, 0.4); color: #ff6600; }
  50%  { border-color: #ff0000; box-shadow: 0 0 24px rgba(255, 0, 0, 0.7);  color: #ff0000; }
  100% { border-color: #ff6600; box-shadow: 0 0 8px rgba(255, 102, 0, 0.4); color: #ff6600; }
`;

// bottom-right HUD panel — flight controls (inertial dampening + eject)
const FlightControlsContainer = styled(Box)(() => ({
    position: 'absolute',
    bottom: 20,
    right: 20,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    pointerEvents: 'auto',
    zIndex: 1000
}));

const ToggleIconButton = styled(Box, {
    shouldForwardProp: (prop) => prop !== 'color'
})<{ color: string }>(({ color }) => ({
    width: 48,
    height: 48,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    border: `2px solid ${color}`,
    borderRadius: 8,
    color: color,
    fontSize: 24,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: `0 0 8px ${color}40`,
    '&:hover': {
        backgroundColor: `${color}20`,
        boxShadow: `0 0 16px ${color}60`,
        transform: 'scale(1.05)'
    },
    '&:active': {
        transform: 'scale(0.95)'
    }
}));

const EjectIconButton = styled(Box, {
    shouldForwardProp: (prop) => prop !== 'isCritical'
})<{ isCritical: boolean }>(({ isCritical }) => ({
    width: 48,
    height: 48,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    border: `2px solid ${EJECT_NORMAL_COLOR}`,
    borderRadius: 8,
    color: EJECT_NORMAL_COLOR,
    fontSize: 24,
    cursor: 'pointer',
    boxShadow: `0 0 8px rgba(255, 102, 0, 0.4)`,
    animation: isCritical ? `${ejectPulse} 1s infinite` : 'none',
    transition: isCritical ? 'none' : 'all 0.2s ease',
    '&:hover': {
        backgroundColor: 'rgba(255, 102, 0, 0.15)',
        boxShadow: '0 0 16px rgba(255, 102, 0, 0.6)',
        transform: 'scale(1.05)'
    },
    '&:active': {
        transform: 'scale(0.95)'
    }
}));

const FlightControls: React.FC<FlightControlsProps> = ({ gameEngine }) => {
    const [dampeningEnabled, setDampeningEnabled] = useState<boolean>(true);
    const [canEject, setCanEject] = useState<boolean>(false);
    const [damagePercentage, setDamagePercentage] = useState<number>(0);
    const [playerExists, setPlayerExists] = useState<boolean>(false);

    useEffect(() => {
        if (!gameEngine) return;

        const interval = setInterval(() => {
            const player = gameEngine.getPlayerAssembly();
            setPlayerExists(!!player && !player.destroyed);
            setDampeningEnabled(gameEngine.isInertialDampeningEnabled());
            setCanEject(gameEngine.canPlayerEject());
            setDamagePercentage(gameEngine.getPlayerDamagePercentage());
        }, 100);

        return () => clearInterval(interval);
    }, [gameEngine]);

    if (!playerExists) return null;

    const dampeningColor = dampeningEnabled ? DAMPENING_ON_COLOR : DAMPENING_OFF_COLOR;
    const isCritical = damagePercentage >= 60;

    return (
        <FlightControlsContainer>
            {canEject && (
                <Tooltip
                    title={isCritical
                        ? `EMERGENCY EJECT — ${Math.round(damagePercentage)}% damage`
                        : `Eject cockpit — ${Math.round(damagePercentage)}% damage`}
                    placement="left"
                    enterDelay={300}
                    arrow
                >
                    <EjectIconButton
                        isCritical={isCritical}
                        onClick={() => gameEngine?.ejectPlayer()}
                    >
                        <Eject />
                    </EjectIconButton>
                </Tooltip>
            )}
            <Tooltip
                title={dampeningEnabled
                    ? 'Inertial dampening ON — velocity damping active (click to disable)'
                    : 'Inertial dampening OFF — pure Newtonian flight (click to enable)'}
                placement="left"
                enterDelay={500}
                arrow
            >
                <ToggleIconButton
                    color={dampeningColor}
                    onClick={() => gameEngine?.toggleInertialDampening()}
                >
                    <Air />
                </ToggleIconButton>
            </Tooltip>
        </FlightControlsContainer>
    );
};

export default FlightControls;
