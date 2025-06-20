import React, { useState, useEffect } from 'react';
import {
    Box,
    Tooltip
} from '@mui/material';
import {
    FlashOn,
    RocketLaunch,
    Radar
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

// Compact power management container
const PowerContainer = styled(Box)(() => ({
    position: 'absolute',
    bottom: 15,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    border: '1px solid #444',
    borderRadius: 8,
    padding: '8px 16px',
    backdropFilter: 'blur(10px)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.6)'
}));

// System icon with power slots
const SystemGroup = styled(Box)(() => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6
}));

// System icon
const SystemIcon = styled(Box)<{ color: string }>(({ color }) => ({
    color: color,
    display: 'flex',
    alignItems: 'center',
    fontSize: 18,
    opacity: 0.9
}));

// Power slot (small rectangle)
const PowerSlot = styled(Box)<{ filled: boolean; color: string }>(({ filled, color }) => ({
    width: 12,
    height: 8,
    backgroundColor: filled ? color : '#333',
    border: `1px solid ${filled ? color : '#555'}`,
    borderRadius: 2,
    transition: 'all 0.2s ease',
    cursor: 'pointer',
    boxShadow: filled ? `0 0 4px ${color}40` : 'none',
    '&:hover': {
        borderColor: color,
        backgroundColor: filled ? color : '#444',
        transform: 'scale(1.1)'
    }
}));

// Power cells bank (yellow rectangles)
const PowerCellsBank = styled(Box)(() => ({
    display: 'flex',
    gap: 3,
    alignItems: 'center'
}));

const PowerCell = styled(Box)<{ allocated: boolean }>(({ allocated }) => ({
    width: 8,
    height: 16,
    backgroundColor: allocated ? '#333' : '#FFD700',
    border: `1px solid ${allocated ? '#555' : '#FFB000'}`,
    borderRadius: 2,
    transition: 'all 0.3s ease',
    boxShadow: allocated ? 'none' : '0 0 6px rgba(255, 215, 0, 0.5)'
}));

// Divider
const SlimDivider = styled(Box)(() => ({
    width: 1,
    height: 24,
    backgroundColor: '#555',
    margin: '0 4px'
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
            },
            {
                id: 'weapons',
                name: 'WEAPONS',
                icon: <FlashOn />,
                maxPower: 0,
                currentPower: 0,
                color: '#FF4444',
                description: 'Weapons: Click to allocate/deallocate power'
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
        // Negative changes (deallocation) should always be allowed
        if (powerChange > 0 && powerChange > powerSystem.getAvailablePower()) return;

        const newAllocation = {
            ...currentAllocation,
            [systemId]: newPower
        };

        powerSystem.setPowerAllocation(newAllocation);
        updatePowerState();
    };    const renderPowerSlots = (system: PowerSystemUI) => {
        const slots = [];
        for (let i = 0; i < system.maxPower; i++) {
            // Fill from bottom to top: bottom slots fill first
            // So slot at index (maxPower - 1 - i) should be filled if we have enough power
            const slotFromBottom = system.maxPower - 1 - i;
            const filled = slotFromBottom < system.currentPower;
            slots.push(
                <PowerSlot
                    key={i}
                    filled={filled}
                    color={system.color}
                    onClick={() => {
                        if (filled) {
                            allocatePower(system.id, -1);
                        } else {
                            allocatePower(system.id, 1);
                        }
                    }}
                />
            );
        }
        return slots;
    };const renderPowerCells = () => {
        const cells = [];
        const allocatedPower = powerState.totalPower - powerState.availablePower;
        
        for (let i = 0; i < powerState.totalPower; i++) {
            // Top cells should be allocated (dark) first
            // Bottom cells should remain available (bright) until needed
            const isAllocated = i < allocatedPower;
            cells.push(
                <PowerCell key={i} allocated={isAllocated} />
            );
        }
        return cells;
    };

    if (!playerExists) {
        return null; // Hide completely when no player
    }

    return (
        <PowerContainer>
            {/* Power Cells Bank */}
            <Tooltip title={`${powerState.availablePower}/${powerState.totalPower} Power Available`} placement="top">
                <PowerCellsBank>
                    {renderPowerCells()}
                </PowerCellsBank>
            </Tooltip>

            <SlimDivider />

            {/* Systems */}
            {powerState.systems.map((system, index) => (
                <React.Fragment key={system.id}>
                    {system.maxPower > 0 && (
                        <Tooltip title={system.description} placement="top">
                            <SystemGroup>
                                <SystemIcon color={system.color}>
                                    {system.icon}
                                </SystemIcon>
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                    {renderPowerSlots(system)}
                                </Box>
                            </SystemGroup>
                        </Tooltip>
                    )}
                    {index < powerState.systems.length - 1 && system.maxPower > 0 &&
                        powerState.systems[index + 1].maxPower > 0 && <SlimDivider />}
                </React.Fragment>
            ))}
        </PowerContainer>
    );
};

export default PowerManagement;
