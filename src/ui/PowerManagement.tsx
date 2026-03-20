import React from 'react';
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
import { GameEngine } from '../game/core/GameEngine';
import { PowerSystem as GamePowerSystem } from '../game/systems/PowerSystem';
import { useGameStore } from '../stores/gameStore';

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





const SYSTEM_META: Record<string, { name: string; icon: React.ReactNode; color: string; description: string }> = {
    engines:  { name: 'ENGINES',  icon: <RocketLaunch />, color: '#00BFFF', description: 'Engines: Click to allocate/deallocate power' },
    weapons:  { name: 'WEAPONS',  icon: <FlashOn />,      color: '#FF4444', description: 'Weapons & Missiles: Click to allocate/deallocate power' },
    sensors:  { name: 'SENSORS',  icon: <Radar />,        color: '#00FF00', description: 'Sensors: Click to allocate/deallocate power' },
};

const PowerManagement: React.FC<PowerManagementProps> = ({ gameEngine: _gameEngine }) => {
    const powerSystem = GamePowerSystem.getInstance();
    const storePower = useGameStore(s => s.powerState);
    const playerAssembly = useGameStore(s => s.playerAssembly);
    const playerExists = !!playerAssembly && !playerAssembly.destroyed;

    // Build UI-enriched power state from store data
    const powerState: PowerState = storePower ? {
        totalPower: storePower.totalPower,
        availablePower: storePower.availablePower,
        systems: storePower.systems.map(s => {
            const meta = SYSTEM_META[s.key] ?? { name: s.name, icon: null, color: '#aaa', description: '' };
            return {
                id: s.key,
                name: meta.name,
                icon: meta.icon,
                maxPower: s.maxPower,
                currentPower: s.currentPower,
                color: meta.color,
                description: meta.description,
            };
        }),
    } : { totalPower: 0, availablePower: 0, systems: [] };    const allocatePower = (systemId: string, amount: number) => {
        const currentAllocation = powerSystem.getPowerAllocation();
        const system = powerState.systems.find(s => s.id === systemId);
        if (!system) return;

        const newPower = Math.max(0, Math.min(system.maxPower, system.currentPower + amount));
        const powerChange = newPower - system.currentPower;

        if (powerChange > 0 && powerChange > powerSystem.getAvailablePower()) return;

        const newAllocation = {
            ...currentAllocation,
            [systemId]: newPower
        };
        powerSystem.setPowerAllocation(newAllocation);
    };

    const allocatePowerToLevel = (systemId: string, targetLevel: number) => {
        const currentAllocation = powerSystem.getPowerAllocation();
        const system = powerState.systems.find(s => s.id === systemId);
        if (!system) return;

        const clampedTarget = Math.max(0, Math.min(system.maxPower, targetLevel));
        const powerChange = clampedTarget - system.currentPower;

        if (powerChange > 0 && powerChange > powerSystem.getAvailablePower()) return;

        const newAllocation = {
            ...currentAllocation,
            [systemId]: clampedTarget
        };
        powerSystem.setPowerAllocation(newAllocation);
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
