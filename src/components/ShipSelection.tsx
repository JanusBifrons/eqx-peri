import React, { useState } from 'react';
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
    Divider,
    List,
    ListItem,
    ListItemText,
    IconButton,
    Collapse
} from '@mui/material';
import { Info, ExpandMore, ExpandLess } from '@mui/icons-material';
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
    parts: EntityConfig[];
}

const ShipSelection: React.FC<ShipSelectionProps> = ({
    open,
    onShipSelect,
    onClose,
    title = "Select Your Ship"
}) => {
    const [expandedShip, setExpandedShip] = useState<number | null>(null);
    const ships = shipsData.ships as ShipInfo[];

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

    const toggleExpanded = (index: number) => {
        setExpandedShip(expandedShip === index ? null : index);
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
            </DialogTitle>

            <DialogContent>        <Box sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: 2
            }}>
                {ships.map((ship, index) => {
                    const stats = getShipStats(ship.parts);
                    const partCounts = getPartsByType(ship.parts);
                    const isExpanded = expandedShip === index;

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
                            >
                                <CardContent>
                                    <Typography variant="h6" sx={{ color: '#00ff00', mb: 1 }}>
                                        {ship.name}
                                    </Typography>

                                    <Box sx={{ mb: 2 }}>
                                        <Chip
                                            label={`${stats.partCount} Parts`}
                                            size="small"
                                            sx={{ mr: 1, mb: 1 }}
                                        />
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
                                </CardContent>

                                <CardActions sx={{ justifyContent: 'space-between' }}>
                                    <IconButton
                                        onClick={() => toggleExpanded(index)}
                                        sx={{ color: '#00ccff' }}
                                    >
                                        <Info sx={{ mr: 0.5 }} />
                                        {isExpanded ? <ExpandLess /> : <ExpandMore />}
                                    </IconButton>

                                    <Button
                                        variant="contained"
                                        onClick={() => onShipSelect(index)}
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
                                </CardActions>                </Card>
                        </Box>
                    );
                })}
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
