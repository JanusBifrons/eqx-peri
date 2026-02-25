import React, { useState, useRef, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Card,
    CardContent,
    CardActions,
    Typography,
    Box,
    Chip,
    Divider, List,
    ListItem,
    ListItemText,
    IconButton,
    Collapse,
    Tabs,
    Tab
} from '@mui/material';
import { Info, ExpandMore, ExpandLess, Visibility } from '@mui/icons-material';
import shipsData from '../data/ships.json';
import { EntityConfig, ENTITY_DEFINITIONS } from '../types/GameTypes';

interface ShipSelectionProps {
    open: boolean;
    onShipSelect: (shipIndex: number) => void;
    onClose: () => void;
    title?: string;
}

interface ShipInfo {
    name: string;
    category?: string;
    size?: string;
    parts: EntityConfig[];
}

const ShipSelection: React.FC<ShipSelectionProps> = ({
    open,
    onShipSelect,
    onClose,
    title = "Select Your Ship"
}) => {
    const [expandedShip, setExpandedShip] = useState<number | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [previewShip, setPreviewShip] = useState<number | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const ships = shipsData.ships as ShipInfo[];

    // Get unique categories
    const categories = ['All', ...Array.from(new Set(ships.map(ship => ship.category || 'Uncategorized')))];

    // Filter ships by category
    const filteredShips = selectedCategory === 'All'
        ? ships
        : ships.filter(ship => (ship.category || 'Uncategorized') === selectedCategory);

    const getShipStats = (parts: EntityConfig[]) => {
        let totalHealth = 0;
        let totalThrust = 0;
        let totalMass = 0;
        let weaponCount = 0;
        let engineCount = 0;
        let hasCockpit = false;

        parts.forEach(part => {
            const definition = ENTITY_DEFINITIONS[part.type];
            if (definition) {
                totalHealth += part.maxHealth || definition.defaultHealth;
                totalMass += definition.mass;

                if (definition.thrust) {
                    totalThrust += definition.thrust;
                    engineCount++;
                }

                if (part.type === 'Gun' || part.type === 'LargeGun' || part.type === 'CapitalWeapon') {
                    weaponCount++;
                }

                if (part.type === 'Cockpit' || part.type === 'LargeCockpit' || part.type === 'CapitalCore') {
                    hasCockpit = true;
                    // Cockpits can also provide thrust and weapons
                    if (definition.thrust) {
                        totalThrust += definition.thrust;
                    }
                }
            }
        });

        const thrustToWeight = totalMass > 0 ? (totalThrust / totalMass * 1000).toFixed(1) : '0';

        return {
            totalHealth,
            totalThrust: totalThrust.toFixed(1),
            totalMass,
            weaponCount,
            engineCount,
            hasCockpit,
            thrustToWeight,
            partCount: parts.length
        };
    };

    const getPartsByType = (parts: EntityConfig[]) => {
        const partCounts: { [key: string]: number } = {};
        parts.forEach(part => {
            partCounts[part.type] = (partCounts[part.type] || 0) + 1;
        });
        return partCounts;
    };
    const getPartColor = (type: string) => {
        const definition = ENTITY_DEFINITIONS[type as keyof typeof ENTITY_DEFINITIONS];
        return definition?.color || '#ffffff';
    };

    // Ship preview rendering
    useEffect(() => {
        if (previewShip !== null && canvasRef.current) {
            drawShipPreview(ships[previewShip]);
        }
    }, [previewShip, ships]);

    const drawShipPreview = (ship: ShipInfo) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Calculate bounds of the ship
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        ship.parts.forEach(part => {
            const def = ENTITY_DEFINITIONS[part.type];
            const halfWidth = def.width / 2;
            const halfHeight = def.height / 2;

            minX = Math.min(minX, part.x - halfWidth);
            minY = Math.min(minY, part.y - halfHeight);
            maxX = Math.max(maxX, part.x + halfWidth);
            maxY = Math.max(maxY, part.y + halfHeight);
        });

        // Add padding
        const padding = 20;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        // Calculate scale to fit in canvas
        const shipWidth = maxX - minX;
        const shipHeight = maxY - minY;
        const scale = Math.min(canvas.width / shipWidth, canvas.height / shipHeight);

        // Calculate offset to center the ship
        const offsetX = (canvas.width - shipWidth * scale) / 2 - minX * scale;
        const offsetY = (canvas.height - shipHeight * scale) / 2 - minY * scale;

        // Draw each part
        ship.parts.forEach(part => {
            const def = ENTITY_DEFINITIONS[part.type];
            const x = part.x * scale + offsetX;
            const y = part.y * scale + offsetY;
            const width = def.width * scale;
            const height = def.height * scale;

            // Save context for rotation
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(part.rotation * Math.PI / 180);

            // Draw the part
            ctx.fillStyle = def.color;
            ctx.fillRect(-width / 2, -height / 2, width, height);

            // Draw border
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.strokeRect(-width / 2, -height / 2, width, height);

            // Add part type label for larger parts
            if (width > 20 && height > 20) {
                ctx.fillStyle = '#fff';
                ctx.font = '8px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(part.type, 0, 2);
            }

            ctx.restore();
        });
    };

    const getShipSizeInfo = (parts: EntityConfig[]) => {
        // Calculate ship bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let totalVolume = 0;

        parts.forEach(part => {
            const def = ENTITY_DEFINITIONS[part.type];
            const halfWidth = def.width / 2;
            const halfHeight = def.height / 2;

            minX = Math.min(minX, part.x - halfWidth);
            minY = Math.min(minY, part.y - halfHeight);
            maxX = Math.max(maxX, part.x + halfWidth);
            maxY = Math.max(maxY, part.y + halfHeight);

            totalVolume += def.width * def.height;
        });

        const width = maxX - minX;
        const height = maxY - minY;
        const area = width * height;

        // Determine if this is a large ship that needs auto-zoom
        const isLargeShip = area > 10000 || totalVolume > 50000; // Threshold for large ships

        return {
            width: Math.round(width),
            height: Math.round(height),
            area: Math.round(area),
            isLargeShip
        };
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="lg"
            fullWidth
            PaperProps={{
                sx: {
                    backgroundColor: 'rgba(0, 17, 34, 0.95)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid #00ccff',
                }
            }}
        >
            <DialogTitle sx={{ color: '#00ccff', textAlign: 'center' }}>
                🚀 {title}
            </DialogTitle>            <DialogContent>
                {/* Category Tabs */}
                <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                    <Tabs
                        value={selectedCategory}
                        onChange={(_, newValue) => setSelectedCategory(newValue)}
                        sx={{
                            '& .MuiTab-root': { color: '#ccc' },
                            '& .Mui-selected': { color: '#00ccff' },
                            '& .MuiTabs-indicator': { backgroundColor: '#00ccff' }
                        }}
                    >
                        {categories.map(category => (
                            <Tab key={category} label={category} value={category} />
                        ))}
                    </Tabs>
                </Box>

                {/* Ship Preview Modal */}
                {previewShip !== null && (
                    <Dialog
                        open={true}
                        onClose={() => setPreviewShip(null)}
                        maxWidth="md"
                        PaperProps={{
                            sx: {
                                backgroundColor: 'rgba(0, 17, 34, 0.95)',
                                border: '1px solid #00ccff',
                            }
                        }}
                    >
                        <DialogTitle sx={{ color: '#00ccff' }}>
                            🚀 {ships[previewShip]?.name} Preview
                        </DialogTitle>
                        <DialogContent>
                            <canvas
                                ref={canvasRef}
                                width={400}
                                height={300}
                                style={{
                                    backgroundColor: '#001122',
                                    border: '1px solid #333',
                                    borderRadius: '4px'
                                }}
                            />
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setPreviewShip(null)} sx={{ color: '#ccc' }}>
                                Close
                            </Button>
                        </DialogActions>
                    </Dialog>
                )}

                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                    gap: 2
                }}>
                    {filteredShips.map((ship, index) => {
                        // Find the original index in the full ships array
                        const originalIndex = ships.findIndex(s => s.name === ship.name);
                        const stats = getShipStats(ship.parts);
                        const sizeInfo = getShipSizeInfo(ship.parts);
                        const partCounts = getPartsByType(ship.parts);
                        const isExpanded = expandedShip === originalIndex;

                        return (
                            <Box key={index}>
                                <Card
                                    sx={{
                                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                                        border: '1px solid #333',
                                        '&:hover': {
                                            border: '1px solid #00ccff',
                                            backgroundColor: 'rgba(0, 204, 255, 0.1)'
                                        }
                                    }}
                                >                                <CardContent>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                            <Typography variant="h6" sx={{ color: '#00ff00' }}>
                                                {ship.name}
                                            </Typography>
                                            {sizeInfo.isLargeShip && (
                                                <Chip
                                                    label="LARGE SHIP"
                                                    size="small"
                                                    sx={{
                                                        backgroundColor: '#ff6600',
                                                        color: '#fff',
                                                        fontWeight: 'bold'
                                                    }}
                                                />
                                            )}
                                        </Box>

                                        {/* Category and Size Info */}
                                        <Box sx={{ mb: 2 }}>
                                            <Chip
                                                label={ship.category || 'Uncategorized'}
                                                size="small"
                                                sx={{
                                                    mr: 1,
                                                    mb: 1,
                                                    backgroundColor: ship.category === 'Capital Ship' ? '#0066ff' :
                                                        ship.category === 'Battleship' ? '#ff6600' :
                                                            ship.category === 'Cruiser' ? '#ffaa00' : '#888888',
                                                    color: '#fff'
                                                }}
                                            />
                                            <Chip
                                                label={`${sizeInfo.width} × ${sizeInfo.height}`}
                                                size="small"
                                                sx={{ mr: 1, mb: 1, backgroundColor: '#333', color: '#ccc' }}
                                            />
                                            <Chip
                                                label={`${stats.partCount} Parts`}
                                                size="small"
                                                sx={{ mr: 1, mb: 1 }}
                                            />
                                        </Box>

                                        <Box sx={{ mb: 2 }}>
                                            <Chip
                                                label={`${stats.totalHealth} HP`}
                                                size="small"
                                                color="success"
                                                sx={{ mr: 1, mb: 1 }}
                                            />
                                            <Chip
                                                label={`${stats.weaponCount} Weapons`}
                                                size="small"
                                                color="error"
                                                sx={{ mr: 1, mb: 1 }}
                                            />
                                            <Chip
                                                label={`${stats.engineCount} Engines`}
                                                size="small"
                                                color="warning"
                                                sx={{ mr: 1, mb: 1 }}
                                            />
                                        </Box>

                                        <Typography variant="body2" sx={{ color: '#ccc', mb: 1 }}>
                                            <strong>Thrust:</strong> {stats.totalThrust} ({stats.thrustToWeight} T/W)
                                        </Typography>
                                        <Typography variant="body2" sx={{ color: '#ccc', mb: 1 }}>
                                            <strong>Mass:</strong> {stats.totalMass} kg
                                        </Typography>
                                        <Typography variant="body2" sx={{ color: stats.hasCockpit ? '#00ff00' : '#ff4444' }}>
                                            <strong>Cockpit:</strong> {stats.hasCockpit ? '✅ Has Control Center' : '❌ No Cockpit'}
                                        </Typography>

                                        {sizeInfo.isLargeShip && (
                                            <Typography variant="body2" sx={{ color: '#ff6600', mt: 1 }}>
                                                ⚠️ Large ship - Auto-zoom enabled
                                            </Typography>
                                        )}

                                        <Collapse in={isExpanded}>
                                            <Divider sx={{ my: 2, borderColor: '#333' }} />
                                            <Typography variant="subtitle2" sx={{ color: '#00ccff', mb: 1 }}>
                                                Parts Breakdown:
                                            </Typography>
                                            <List dense>
                                                {Object.entries(partCounts).map(([type, count]) => (
                                                    <ListItem key={type} sx={{ py: 0.5 }}>
                                                        <Box
                                                            sx={{
                                                                width: 12,
                                                                height: 12,
                                                                backgroundColor: getPartColor(type),
                                                                mr: 1,
                                                                border: '1px solid #555'
                                                            }}
                                                        />
                                                        <ListItemText
                                                            primary={`${count}x ${type}`}
                                                            primaryTypographyProps={{
                                                                variant: 'body2',
                                                                sx: { color: '#ccc' }
                                                            }}
                                                        />
                                                    </ListItem>
                                                ))}
                                            </List>
                                        </Collapse>
                                    </CardContent>                                <CardActions sx={{ justifyContent: 'space-between' }}>
                                        <Box>
                                            <IconButton
                                                onClick={() => setExpandedShip(isExpanded ? null : originalIndex)}
                                                sx={{ color: '#00ccff' }}
                                            >
                                                <Info sx={{ mr: 0.5 }} />
                                                {isExpanded ? <ExpandLess /> : <ExpandMore />}
                                            </IconButton>

                                            <IconButton
                                                onClick={() => setPreviewShip(originalIndex)}
                                                sx={{ color: '#ffaa00', ml: 1 }}
                                            >
                                                <Visibility />
                                            </IconButton>
                                        </Box>

                                        <Button
                                            variant="contained"
                                            onClick={() => onShipSelect(originalIndex)}
                                            disabled={!stats.hasCockpit}
                                            sx={{
                                                backgroundColor: stats.hasCockpit ? '#00ccff' : '#666',
                                                '&:hover': {
                                                    backgroundColor: stats.hasCockpit ? '#0099cc' : '#666'
                                                }
                                            }}
                                        >
                                            Select Ship
                                        </Button>
                                    </CardActions></Card>
                            </Box>
                        );
                    })}
                </Box>
                <Box sx={{ mt: 2, textAlign: 'center' }}>
                    <Typography variant="subtitle1" sx={{ color: '#00ccff', mb: 1 }}>
                        Ship Preview:
                    </Typography>
                    <canvas
                        ref={canvasRef}
                        width={300}
                        height={300}
                        style={{
                            border: '1px solid #00ccff',
                            borderRadius: 4,
                            backgroundColor: 'rgba(0, 0, 0, 0.7)',
                            display: previewShip !== null ? 'block' : 'none',
                            margin: '0 auto'
                        }}
                    />
                    <Typography variant="caption" sx={{ color: '#ccc', mt: 1 }}>
                        Note: The preview may not represent the exact ship layout.
                    </Typography>
                </Box>
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} sx={{ color: '#ccc' }}>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ShipSelection;
