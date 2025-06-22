import React, { useState, useEffect } from 'react';
import {
    Box,
    Tooltip
} from '@mui/material';
import {
    FlashOn,
    RocketLaunch,
    Radar,
    BatteryFull
} from '@mui/icons-material';
import { styled } from '@mui/material/styles';
import { GameEngine } from '../game/GameEngine';
import { PowerSystem as GamePowerSystem } from '../game/PowerSystem';

interface PowerManagementProps {
    gameEngine: GameEngine | null;
}

interface PowerSystemUI {
    id: string;
    name: string;
    icon: React.ReactNode;
    maxPower: number;
    currentPower: number;
    color: string;
    description: string;
}

interface PowerState {
    totalPower: number;
    availablePower: number;
    systems: PowerSystemUI[];
}

// FTL-style power management container - bottom left
const PowerContainer = styled(Box)(() => ({
    position: 'absolute',
    bottom: 20,
    left: 20,
    display: 'flex',
    alignItems: 'flex-end',
    gap: 24,
    pointerEvents: 'auto',
    zIndex: 1000
}));

// Power available section - left side
const PowerAvailableSection = styled(Box)(() => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4
}));

// Power icon button - non-clickable version
const PowerIconDisplay = styled(Box)(() => ({
    width: 48,
    height: 48,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    border: '2px solid #FFD700',
    borderRadius: 8,
    color: '#FFD700',
    fontSize: 24,
    boxShadow: '0 0 8px rgba(255, 215, 0, 0.4)',
    // Non-clickable styling - no hover effects or cursor
}));

// Remove the old power available container and text styles
// Power available display with cells
const PowerAvailableContainer = styled(Box)(() => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    marginTop: 4
}));

// Remove PowerAvailableText and PowerCellContainer - we'll use PowerBarContainer instead

// Systems container - horizontal layout
const SystemsContainer = styled(Box)(() => ({
    display: 'flex',
    gap: 16,
    alignItems: 'flex-end'
}));

// System column container
const SystemColumn = styled(Box)(() => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4
}));

// Large prominent icon button
const SystemIconButton = styled(Box, {
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

// Power bar container - vertical bars for horizontal layout
const PowerBarContainer = styled(Box)(() => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    marginTop: 4
}));

// Individual power bar segment - match icon width
const PowerBarSegment = styled(Box, {
    shouldForwardProp: (prop) => prop !== 'filled' && prop !== 'color' && prop !== 'isClickable'
})<{ filled: boolean; color: string; isClickable: boolean }>(({ filled, color, isClickable }) => ({
    width: 44, // Match icon width minus border/padding (48px - 4px)
    height: 12,
    backgroundColor: filled ? color : '#333',
    border: `1px solid ${filled ? color : '#555'}`,
    borderRadius: 2,
    transition: 'all 0.2s ease',
    cursor: isClickable ? 'pointer' : 'default',
    boxShadow: filled ? `0 0 3px ${color}40` : 'none',
    '&:hover': isClickable ? {
        borderColor: color,
        backgroundColor: filled ? color : '#444',
        transform: 'scale(1.05)'
    } : {}
}));





const PowerManagement: React.FC<PowerManagementProps> = ({ gameEngine }) => {
    const powerSystem = GamePowerSystem.getInstance();
    const [powerState, setPowerState] = useState<PowerState>({
        totalPower: 0,
        availablePower: 0,
        systems: [
            {
                id: 'engines',
                name: 'ENGINES',
                icon: <RocketLaunch />,
                maxPower: 0,
                currentPower: 0,
                color: '#00BFFF',
                description: 'Engines: Click to allocate/deallocate power'
            },            {
                id: 'weapons',
                name: 'WEAPONS',
                icon: <FlashOn />,
                maxPower: 0,
                currentPower: 0,
                color: '#FF4444',
                description: 'Weapons & Missiles: Click to allocate/deallocate power'
            },
            {
                id: 'sensors',
                name: 'SENSORS',
                icon: <Radar />,
                maxPower: 0,
                currentPower: 0,
                color: '#00FF00',
                description: 'Sensors: Click to allocate/deallocate power'
            }
        ]
    });

    const [playerExists, setPlayerExists] = useState(false);

    useEffect(() => {
        if (!gameEngine) return;

        const checkPlayerStatus = () => {
            const playerAssembly = gameEngine.getPlayerAssembly();
            const exists = !!playerAssembly && !playerAssembly.destroyed;
            setPlayerExists(exists);

            if (exists) {
                powerSystem.setPlayerAssembly(playerAssembly);
                updatePowerState();
            }
        };

        const interval = setInterval(checkPlayerStatus, 100);
        return () => clearInterval(interval);
    }, [gameEngine]);

    const updatePowerState = () => {
        const allocation = powerSystem.getPowerAllocation();
        setPowerState({
            totalPower: powerSystem.getTotalPowerCells(),
            availablePower: powerSystem.getAvailablePower(),
            systems: [
                {
                    id: 'engines',
                    name: 'ENGINES',
                    icon: <RocketLaunch />,
                    maxPower: powerSystem.getMaxPowerForSystem('engines'),
                    currentPower: allocation.engines,
                    color: '#00BFFF',
                    description: 'Engines: Click to allocate/deallocate power'
                },
                {
                    id: 'weapons',
                    name: 'WEAPONS',
                    icon: <FlashOn />,
                    maxPower: powerSystem.getMaxPowerForSystem('weapons'),
                    currentPower: allocation.weapons,
                    color: '#FF4444',
                    description: 'Weapons: Click to allocate/deallocate power'
                },
                {
                    id: 'sensors',
                    name: 'SENSORS',
                    icon: <Radar />,
                    maxPower: powerSystem.getMaxPowerForSystem('sensors'),
                    currentPower: allocation.sensors,
                    color: '#00FF00',
                    description: 'Sensors: Click to allocate/deallocate power'
                }
            ]
        });
    };    const allocatePower = (systemId: string, amount: number) => {
        const currentAllocation = powerSystem.getPowerAllocation();
        const system = powerState.systems.find(s => s.id === systemId);
        if (!system) return;

        const newPower = Math.max(0, Math.min(system.maxPower, system.currentPower + amount));
        const powerChange = newPower - system.currentPower;

        // Only check available power for positive changes (allocation)
        if (powerChange > 0 && powerChange > powerSystem.getAvailablePower()) return;

        const newAllocation = {
            ...currentAllocation,
            [systemId]: newPower
        };
        powerSystem.setPowerAllocation(newAllocation);
        updatePowerState();
    };

    const allocatePowerToLevel = (systemId: string, targetLevel: number) => {
        const currentAllocation = powerSystem.getPowerAllocation();
        const system = powerState.systems.find(s => s.id === systemId);
        if (!system) return;

        const clampedTarget = Math.max(0, Math.min(system.maxPower, targetLevel));
        const powerChange = clampedTarget - system.currentPower;

        // Only check available power for positive changes (allocation)
        if (powerChange > 0 && powerChange > powerSystem.getAvailablePower()) return;

        const newAllocation = {
            ...currentAllocation,
            [systemId]: clampedTarget
        };
        powerSystem.setPowerAllocation(newAllocation);
        updatePowerState();
    };

    const handleIconButtonClick = (systemId: string, isRightClick: boolean) => {
        const amount = isRightClick ? -1 : 1;
        allocatePower(systemId, amount);
    };    const renderPowerBar = (system: PowerSystemUI) => {
        const segments = [];
        // Render from bottom to top (reverse order)
        for (let i = system.maxPower - 1; i >= 0; i--) {
            const filled = i < system.currentPower;
            segments.push(
                <PowerBarSegment
                    key={i}
                    filled={filled}
                    color={system.color}
                    isClickable={true}
                    onClick={() => allocatePowerToLevel(system.id, i + 1)}
                />
            );
        }
        return segments;
    };    const renderPowerCells = () => {
        const segments = [];
        // Render from bottom to top (reverse order) to match system power bars
        for (let i = powerState.totalPower - 1; i >= 0; i--) {
            const filled = i < powerState.availablePower;
            segments.push(
                <PowerBarSegment
                    key={i}
                    filled={filled}
                    color="#FFD700"
                    isClickable={false} // Power cells are not clickable
                />
            );
        }
        return segments;
    };if (!playerExists) {
        return null; // Hide completely when no player
    }    return (
        <PowerContainer>
            {/* Power Available Section - Left Side */}
            <PowerAvailableSection>
                <PowerAvailableContainer>
                    {renderPowerCells()}
                </PowerAvailableContainer>
                <PowerIconDisplay>
                    <BatteryFull />
                </PowerIconDisplay>
            </PowerAvailableSection>            {/* System Power Controls - Right Side */}
            <SystemsContainer>
                {powerState.systems.map((system) => (
                    system.maxPower > 0 && (
                        <Tooltip 
                            key={system.id}
                            title={`${system.name}: Left click +1, Right click -1`} 
                            placement="top"
                            enterDelay={1000}
                            leaveDelay={200}
                            arrow
                        >
                            <SystemColumn>
                                <PowerBarContainer>
                                    {renderPowerBar(system)}
                                </PowerBarContainer>
                                <SystemIconButton
                                    color={system.color}
                                    onClick={() => handleIconButtonClick(system.id, false)}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        handleIconButtonClick(system.id, true);
                                    }}
                                >
                                    {system.icon}
                                </SystemIconButton>
                            </SystemColumn>
                        </Tooltip>
                    )
                ))}
            </SystemsContainer>
        </PowerContainer>
    );
};

export default PowerManagement;
