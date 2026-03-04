import React, { useEffect, useState } from 'react';
import {
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
    Box,
    Chip,
    Button,
    Divider,
    IconButton
} from '@mui/material';
import {
    MyLocation,
    PersonPinCircle,
    RadioButtonUnchecked,
    SocialDistance,
    GpsFixed,
    ZoomIn,
    ZoomOut,
    CenterFocusStrong
} from '@mui/icons-material';
import { styled } from '@mui/material/styles';
import { GameEngine } from '../game/core/GameEngine';

interface RadarProps {
    gameEngine: GameEngine | null;
}

// Helper function to format distance
const formatDistance = (distance: number): string => {
    if (distance >= 1000000) {
        return `${(distance / 1000000).toFixed(1)}M`;
    } else if (distance >= 1000) {
        return `${(distance / 1000).toFixed(1)}k`;
    }
    return Math.round(distance).toString();
};

interface RadarProps {
    gameEngine: GameEngine | null;
}

const CompactPaper = styled(Paper)(() => ({
    width: 280,
    maxHeight: '60vh',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    border: '1px solid #333',
    pointerEvents: 'auto', // Allow pointer events only on this component
    '& .MuiTableCell-root': {
        padding: '4px 8px',
        fontSize: '0.75rem',
        color: '#ffffff',
        borderColor: '#333'
    },
    '& .MuiTableHead-root .MuiTableCell-root': {
        backgroundColor: 'rgba(0, 50, 100, 0.3)',
        fontWeight: 600
    }
}));

const RadarDot = styled('div')<{ team: number; isPlayer: boolean; isSelected: boolean; isDebris: boolean; isMissile?: boolean }>(({ team, isPlayer, isSelected, isDebris, isMissile }) => {
    // Color logic: Blue for friendly (team 0), Red for enemy (team 1), Green for player, Gray for debris, Yellow for missiles
    const getColor = () => {
        if (isDebris) return '#888888'; // Gray for debris
        if (isMissile) return '#ffff00'; // Yellow for missiles
        if (isPlayer) return '#00ff00'; // Bright green for player
        if (team === 0) return '#0088ff'; // Blue for friendly team
        if (team === 1) return '#ff4444'; // Red for enemy team
        return '#ffffff'; // White fallback
    };

    const getSize = () => {
        if (isDebris) return 4; // Smaller dots for debris
        if (isMissile) return 3; // Very small dots for missiles
        return 8; // Normal size for ships
    };

    const size = getSize();
    return {
        width: size,
        height: size,
        borderRadius: isMissile ? '50%' : (isDebris ? '50%' : '2px'), // Circles for missiles and debris, squares for ships
        backgroundColor: getColor(),
        border: isSelected ? '2px solid #ffff00' : (isPlayer ? '1px solid #ffffff' : 'none'),
        margin: '0 auto',
        boxShadow: isPlayer ? '0 0 4px #00ff00' : 'none' // Glow effect for player
    };
});

const Radar: React.FC<RadarProps> = ({ gameEngine }) => {
    const [radarData, setRadarData] = useState<any[]>([]);
    const [selectedShip, setSelectedShip] = useState<any>(null);
    const [activeCommand, setActiveCommand] = useState<string | null>(null);
    const [commandTarget, setCommandTarget] = useState<string | null>(null);
    const [currentZoom, setCurrentZoom] = useState<number>(0.1);
    const [currentSpeed, setCurrentSpeed] = useState<number>(0); const [speedBasedZoom, setSpeedBasedZoom] = useState<boolean>(true);

    useEffect(() => {
        if (!gameEngine) return;

        const updateRadar = () => {
            try {
                const data = gameEngine.getRadarData();
                const playerShip = data.find(ship => ship.isPlayer);

                if (playerShip) {
                    // Calculate distances and sort by distance
                    const shipsWithDistance = data.map(ship => ({
                        ...ship,
                        distance: Math.sqrt(
                            Math.pow(ship.x - playerShip.x, 2) +
                            Math.pow(ship.y - playerShip.y, 2)
                        )
                    })).sort((a, b) => a.distance - b.distance);

                    setRadarData(shipsWithDistance);
                } else {
                    setRadarData(data);
                }

                // Update zoom and speed info from GameEngine
                setCurrentZoom(gameEngine.getCurrentZoom());
                setCurrentSpeed(gameEngine.getCurrentSpeed());
                setSpeedBasedZoom(gameEngine.isSpeedBasedZoomEnabled());

                // Update selected ship info
                const selected = gameEngine.getSelectedAssembly();
                if (selected) {
                    const selectedData = data.find(ship => ship.id === selected.id);
                    setSelectedShip(selectedData);
                } else {
                    setSelectedShip(null);
                }
            } catch (error) {
                console.error('Radar update error:', error);
            }
        };

        const interval = setInterval(updateRadar, 100);
        return () => clearInterval(interval);
    }, [gameEngine]);

    const handleZoomIn = () => {
        if (gameEngine) {
            gameEngine.zoomIn();
        }
    };

    const handleZoomOut = () => {
        if (gameEngine) {
            gameEngine.zoomOut();
        }
    }; const handleZoomReset = () => {
        if (gameEngine) {
            gameEngine.resetZoom();
        }
    };

    const toggleSpeedBasedZoom = () => {
        if (gameEngine) {
            gameEngine.toggleSpeedBasedZoom();
        }
    };

    const handleTurnToFace = (ship: any) => {
        if (gameEngine && ship) {
            gameEngine.turnPlayerToFaceTarget(ship.x, ship.y);
        }
    }; const handleFollow = (ship: any) => {
        if (gameEngine && ship) {
            console.log('🎯 Follow command for:', ship.shipName || ship.id);
            gameEngine.setPlayerCommand('follow', ship.id);
            setActiveCommand('follow');
            setCommandTarget(ship.id);
        }
    };

    const handleOrbit = (ship: any) => {
        if (gameEngine && ship) {
            console.log('🌀 Orbit command for:', ship.shipName || ship.id);
            gameEngine.setPlayerCommand('orbit', ship.id);
            setActiveCommand('orbit');
            setCommandTarget(ship.id);
        }
    };

    const handleKeepDistance = (ship: any) => {
        if (gameEngine && ship) {
            console.log('📏 Keep distance command for:', ship.shipName || ship.id);
            gameEngine.setPlayerCommand('keepDistance', ship.id);
            setActiveCommand('keepDistance');
            setCommandTarget(ship.id);
        }
    }; const handleLockOn = (ship: any) => {
        if (gameEngine && ship) {
            console.log('🔒 Lock on target (passive):', ship.shipName || ship.id);
            // Find the target assembly and use passive target locking instead of active steering command
            const targetAssembly = gameEngine.getAllAssemblies().find((a: any) => a.id === ship.id);
            if (targetAssembly) {
                const playerAssembly = gameEngine.getPlayerAssembly();
                if (playerAssembly) {
                    if (playerAssembly.isTargetLocked(targetAssembly)) {
                        playerAssembly.unlockTarget(targetAssembly);
                        console.log('🔓 Unlocked target:', targetAssembly.shipName);
                    } else {
                        playerAssembly.lockTarget(targetAssembly);
                        console.log('🔒 Locked target:', targetAssembly.shipName);

                        // Set as primary target if it's the first lock
                        if (playerAssembly.primaryTarget === null) {
                            playerAssembly.setPrimaryTarget(targetAssembly);
                            console.log('🎯 Set as primary target:', targetAssembly.shipName);
                        }
                    }
                }
            }
        }
    }; const isCommandActive = (command: string, ship: any) => {
        return activeCommand === command && commandTarget === ship.id;
    }; const isTargetLocked = (ship: any) => {
        if (!gameEngine || !ship) return false;
        const playerAssembly = gameEngine.getPlayerAssembly();
        if (!playerAssembly) return false;
        const targetAssembly = gameEngine.getAllAssemblies().find((a: any) => a.id === ship.id);
        return targetAssembly ? playerAssembly.isTargetLocked(targetAssembly) : false;
    };

    const handleClearCommand = () => {
        if (gameEngine) {
            console.log('🚫 Clearing player command');
            gameEngine.setPlayerCommand('stop');
            setActiveCommand(null);
            setCommandTarget(null);
        }
    }; const handleShipSelect = (ship: any) => {
        console.log('📡 Radar: Selecting ship', ship.shipName || ship.id);

        // Update local state immediately
        setSelectedShip(ship);
        console.log('📡 Radar: Local state updated to:', ship.shipName || ship.id);

        // Select the assembly in the GameEngine
        if (gameEngine) {
            console.log('📡 Radar: Calling gameEngine.selectAssemblyById with:', ship.id);
            gameEngine.selectAssemblyById(ship.id);

            // Verify the selection was set
            setTimeout(() => {
                const selected = gameEngine.getSelectedAssembly();
                console.log('📡 Radar: Selection verification - selected assembly:', selected?.shipName || 'none');
            }, 10);
        } else {
            console.error('📡 Radar: GameEngine is null!');
        }
    };

    return (
        <CompactPaper elevation={3}>
            <Box sx={{ p: 1 }}>                <Typography variant="h6" sx={{ color: '#00ff00', fontSize: '0.9rem', mb: 1 }}>
                📡 RADAR
            </Typography>                {/* Zoom Controls */}
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 1,
                    p: 0.5,
                    backgroundColor: 'rgba(0, 50, 100, 0.2)',
                    borderRadius: 0.5
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <IconButton
                            size="small"
                            onClick={handleZoomOut}
                            sx={{ color: '#00ccff', p: 0.25 }}
                        >
                            <ZoomOut sx={{ fontSize: '14px' }} />
                        </IconButton>
                        <IconButton
                            size="small"
                            onClick={handleZoomIn}
                            sx={{ color: '#00ccff', p: 0.25 }}
                        >
                            <ZoomIn sx={{ fontSize: '14px' }} />
                        </IconButton>
                        <IconButton
                            size="small"
                            onClick={handleZoomReset}
                            sx={{ color: '#00ccff', p: 0.25 }}
                        >
                            <CenterFocusStrong sx={{ fontSize: '14px' }} />
                        </IconButton>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {speedBasedZoom && (
                            <Typography variant="caption" sx={{
                                fontSize: '0.6rem',
                                color: '#00ff00',
                                minWidth: '40px'
                            }}>
                                {Math.round(currentSpeed)}u/s
                            </Typography>
                        )}
                        <Button
                            size="small"
                            onClick={toggleSpeedBasedZoom}
                            sx={{
                                fontSize: '0.6rem',
                                color: speedBasedZoom ? '#00ff00' : '#666',
                                minWidth: 'auto',
                                p: 0.25
                            }}
                        >
                            AUTO
                        </Button>
                    </Box>
                </Box>                {/* Radar Legend */}
                <Box sx={{ mb: 1, display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 8, height: 8, backgroundColor: '#00ff00', borderRadius: '2px', boxShadow: '0 0 2px #00ff00' }} />
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#00ff00' }}>YOU</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 8, height: 8, backgroundColor: '#0088ff', borderRadius: '2px' }} />
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#0088ff' }}>ALLY</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 8, height: 8, backgroundColor: '#ff4444', borderRadius: '2px' }} />
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#ff4444' }}>ENEMY</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 4, height: 4, backgroundColor: '#888888', borderRadius: '50%' }} />
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#888888' }}>DEBRIS</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 3, height: 3, backgroundColor: '#ffff00', borderRadius: '50%' }} />
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#ffff00' }}>MISSILE</Typography>
                    </Box>
                </Box>

                {/* Radar Visual */}
                <Box sx={{
                    width: '100%',
                    height: 120,
                    backgroundColor: 'rgba(0, 20, 0, 0.3)',
                    border: '1px solid #004400',
                    borderRadius: 1,
                    position: 'relative',
                    mb: 1
                }}>                    {/* Zoom level indicator */}
                    <Typography variant="caption" sx={{
                        position: 'absolute',
                        top: 2,
                        right: 4,
                        fontSize: '0.6rem',
                        color: '#00ff00',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        px: 0.5,
                        borderRadius: 0.25
                    }}>
                        {(1 / currentZoom).toFixed(0)}x
                    </Typography>                    {radarData.map((item) => {
                        const playerShip = radarData.find(s => s.isPlayer);
                        if (!playerShip) return null;

                        // Use fixed radar scale independent of game zoom
                        const centerX = 140;
                        const centerY = 60;
                        const radarRange = 10000; // Fixed radar range in game units
                        const radarScale = 50 / radarRange; // Fixed scale: 50 pixels = 10000 units
                        const x = centerX + (item.x - playerShip.x) * radarScale;
                        const y = centerY + (item.y - playerShip.y) * radarScale;

                        // Keep dots within bounds
                        const clampedX = Math.max(8, Math.min(272, x));
                        const clampedY = Math.max(8, Math.min(112, y));

                        const dotSize = item.isMissile ? 3 : (item.isDebris ? 4 : 8);
                        return (
                            <RadarDot
                                key={item.id}
                                team={item.team}
                                isPlayer={item.isPlayer}
                                isSelected={selectedShip?.id === item.id}
                                isDebris={item.isDebris || false}
                                isMissile={item.isMissile || false}
                                style={{
                                    position: 'absolute',
                                    left: clampedX - (dotSize / 2),
                                    top: clampedY - (dotSize / 2)
                                }}
                            />
                        );
                    })}
                </Box>

                <Divider sx={{ borderColor: '#333', mb: 1 }} />                {/* Sector Objects Table */}
                <Typography variant="subtitle2" sx={{ color: '#00ccff', fontSize: '0.8rem', mb: 1 }}>
                    Sector Objects ({radarData.length})
                </Typography><TableContainer sx={{ maxHeight: '30vh', overflow: 'auto' }}>
                    <Table size="small" stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell>Name</TableCell>
                                <TableCell align="right">Dist</TableCell>
                                <TableCell align="center">Type</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {radarData.slice(0, 20).map((item) => (
                                <TableRow
                                    key={item.id}
                                    hover
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        // Only allow selection of ships (not missiles)
                                        if (!item.isMissile) {
                                            handleShipSelect(item);
                                        }
                                    }}
                                    sx={{
                                        cursor: item.isMissile ? 'default' : 'pointer',
                                        '&:hover': { backgroundColor: item.isMissile ? 'inherit' : 'rgba(255, 255, 255, 0.05)' }
                                    }}
                                >
                                    <TableCell>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <RadarDot
                                                team={item.team}
                                                isPlayer={item.isPlayer}
                                                isSelected={selectedShip?.id === item.id}
                                                isDebris={item.isDebris || false}
                                                isMissile={item.isMissile || false}
                                            />
                                            <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
                                                {item.isMissile ? item.shipName :
                                                    item.isDebris ? 'Debris' : 
                                                    (item.shipName || `Ship-${item.id.slice(-4)}`)}
                                            </Typography>
                                        </Box>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
                                            {item.distance ? formatDistance(item.distance) : '0'}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="center">
                                        <Chip
                                            label={
                                                item.isMissile ? 'MSL' :
                                                    item.isDebris ? 'DBR' :
                                                        item.isPlayer ? 'PLR' :
                                                            item.team === 0 ? 'ALLY' : 'ENMY'
                                            }
                                            size="small"
                                            variant="outlined"
                                            sx={{
                                                height: 16,
                                                fontSize: '0.6rem',
                                                color: item.isMissile ? '#ffff00' :
                                                    item.isDebris ? '#888888' :
                                                        item.isPlayer ? '#00ff00' :
                                                            item.team === 0 ? '#0088ff' : '#ff4444',
                                                borderColor: item.isMissile ? '#ffff00' :
                                                    item.isDebris ? '#888888' :
                                                        item.isPlayer ? '#00ff00' :
                                                            item.team === 0 ? '#0088ff' : '#ff4444'
                                            }}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>

                {radarData.length > 20 && (
                    <Typography variant="caption" sx={{ 
                        fontSize: '0.6rem', 
                        color: '#666', 
                        textAlign: 'center', 
                        display: 'block',
                        mt: 0.5
                    }}>
                        Showing 20 of {radarData.length} objects
                    </Typography>
                )}{/* Selected Ship Info */}
                {selectedShip && (
                    <>
                        <Divider sx={{ borderColor: '#333', my: 1 }} />
                        <Typography variant="subtitle2" sx={{ color: '#ffff00', fontSize: '0.8rem', mb: 1 }}>
                            Selected: {selectedShip.shipName || `Ship-${selectedShip.id.slice(-4)}`}
                        </Typography>

                        {/* Active Command Indicator */}
                        {activeCommand && commandTarget === selectedShip.id && (
                            <Box sx={{
                                mb: 1,
                                p: 0.5,
                                backgroundColor: 'rgba(0, 255, 0, 0.1)',
                                border: '1px solid #00ff00',
                                borderRadius: 1
                            }}>
                                <Typography variant="caption" sx={{
                                    fontSize: '0.7rem',
                                    color: '#00ff00',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.5
                                }}>
                                    🎯 Active: {activeCommand.toUpperCase()}
                                    <Button
                                        size="small"
                                        onClick={handleClearCommand}
                                        sx={{
                                            minWidth: 'auto',
                                            fontSize: '0.6rem',
                                            color: '#ff6666',
                                            ml: 'auto',
                                            p: 0.25
                                        }}
                                    >
                                        ✕ Clear
                                    </Button>
                                </Typography>
                            </Box>
                        )}

                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: '#ccc' }}>
                                Team: {selectedShip.team} | Type: {selectedShip.shipType}
                            </Typography>
                            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: '#ccc' }}>
                                Distance: {selectedShip.distance ? Math.round(selectedShip.distance) : 0}
                            </Typography>                            {!selectedShip.isPlayer && (
                                <Box sx={{
                                    mt: 0.5,
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: 0.5
                                }}>                                    <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => handleTurnToFace(selectedShip)}
                                    startIcon={<MyLocation sx={{ fontSize: '12px !important' }} />}
                                    sx={{
                                        fontSize: '0.65rem',
                                        color: '#00ccff',
                                        borderColor: '#00ccff',
                                        minHeight: 24,
                                        '&:hover': {
                                            borderColor: '#00aadd',
                                            backgroundColor: 'rgba(0, 200, 255, 0.1)'
                                        }
                                    }}
                                >
                                        Turn To
                                    </Button>                                    <Button
                                        size="small"
                                        variant={isCommandActive('follow', selectedShip) ? 'contained' : 'outlined'}
                                        onClick={() => handleFollow(selectedShip)}
                                        startIcon={<PersonPinCircle sx={{ fontSize: '12px !important' }} />}
                                        sx={{
                                            fontSize: '0.65rem',
                                            color: isCommandActive('follow', selectedShip) ? '#000' : '#00ff88',
                                            borderColor: '#00ff88',
                                            backgroundColor: isCommandActive('follow', selectedShip) ? '#00ff88' : 'transparent',
                                            minHeight: 24,
                                            '&:hover': {
                                                borderColor: '#00dd77',
                                                backgroundColor: isCommandActive('follow', selectedShip) ? '#00dd77' : 'rgba(0, 255, 136, 0.1)'
                                            }
                                        }}
                                    >
                                        Follow
                                    </Button>
                                    <Button
                                        size="small"
                                        variant={isCommandActive('orbit', selectedShip) ? 'contained' : 'outlined'}
                                        onClick={() => handleOrbit(selectedShip)}
                                        startIcon={<RadioButtonUnchecked sx={{ fontSize: '12px !important' }} />}
                                        sx={{
                                            fontSize: '0.65rem',
                                            color: isCommandActive('orbit', selectedShip) ? '#000' : '#ffaa00',
                                            borderColor: '#ffaa00',
                                            backgroundColor: isCommandActive('orbit', selectedShip) ? '#ffaa00' : 'transparent',
                                            minHeight: 24,
                                            '&:hover': {
                                                borderColor: '#dd8800',
                                                backgroundColor: isCommandActive('orbit', selectedShip) ? '#dd8800' : 'rgba(255, 170, 0, 0.1)'
                                            }
                                        }}
                                    >
                                        Orbit
                                    </Button>
                                    <Button
                                        size="small"
                                        variant={isCommandActive('keepDistance', selectedShip) ? 'contained' : 'outlined'}
                                        onClick={() => handleKeepDistance(selectedShip)}
                                        startIcon={<SocialDistance sx={{ fontSize: '12px !important' }} />}
                                        sx={{
                                            fontSize: '0.65rem',
                                            color: isCommandActive('keepDistance', selectedShip) ? '#000' : '#ff6600',
                                            borderColor: '#ff6600',
                                            backgroundColor: isCommandActive('keepDistance', selectedShip) ? '#ff6600' : 'transparent',
                                            minHeight: 24,
                                            '&:hover': {
                                                borderColor: '#dd4400',
                                                backgroundColor: isCommandActive('keepDistance', selectedShip) ? '#dd4400' : 'rgba(255, 102, 0, 0.1)'
                                            }
                                        }}
                                    >
                                        Keep Dist.
                                    </Button>                                    <Button
                                        size="small"
                                        variant={isTargetLocked(selectedShip) ? 'contained' : 'outlined'}
                                        onClick={() => handleLockOn(selectedShip)}
                                        startIcon={<GpsFixed sx={{ fontSize: '12px !important' }} />}
                                        sx={{
                                            fontSize: '0.65rem',
                                            color: isTargetLocked(selectedShip) ? '#000' : '#ff4444',
                                            borderColor: '#ff4444',
                                            backgroundColor: isTargetLocked(selectedShip) ? '#ff4444' : 'transparent',
                                            minHeight: 24,
                                            gridColumn: '1 / -1', // Span both columns
                                            '&:hover': {
                                                borderColor: '#dd2222',
                                                backgroundColor: isTargetLocked(selectedShip) ? '#dd2222' : 'rgba(255, 68, 68, 0.1)'
                                            }
                                        }}
                                    >
                                        Lock On Target
                                    </Button>
                                </Box>
                            )}
                        </Box>
                    </>
                )}
            </Box>
        </CompactPaper>
    );
};

export default Radar;
