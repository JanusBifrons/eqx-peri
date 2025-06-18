import React, { useState } from 'react';
import {
    IconButton,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    Chip,
    List,
    ListItem,
    ListItemText,
    Divider,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper
} from '@mui/material';
import { Info } from '@mui/icons-material';
import { ENTITY_DEFINITIONS } from '../types/GameTypes';

const PartsInfo: React.FC = () => {
    const [open, setOpen] = useState(false);

    const handleOpen = () => setOpen(true);
    const handleClose = () => setOpen(false);

    const partCategories = {
        'Control Centers': ['Cockpit', 'LargeCockpit', 'CapitalCore'],
        'Weapons': ['Gun', 'LargeGun', 'CapitalWeapon'],
        'Engines': ['Engine', 'LargeEngine', 'CapitalEngine'],
        'Structure': ['Hull', 'HeavyHull', 'MegaHull'],
        'Power': ['PowerCell', 'LargePowerCell', 'PowerReactor']
    };

    const getPartIcon = (type: string) => {
        if (type.includes('Cockpit') || type.includes('Core')) return '🎮';
        if (type.includes('Gun') || type.includes('Weapon')) return '🔫';
        if (type.includes('Engine')) return '🚀';
        if (type.includes('Hull')) return '🛡️';
        if (type.includes('Power')) return '🔋';
        return '⚙️';
    };

    const getSizeCategory = (type: string) => {
        if (type.includes('Capital') || type === 'MegaHull' || type === 'PowerReactor') return 'Capital (4x4)';
        if (type.includes('Large') || type === 'HeavyHull') return 'Large (2x2)';
        return 'Standard (1x1)';
    };

    return (
        <>
            <IconButton
                onClick={handleOpen}
                sx={{
                    color: '#00ccff',
                    '&:hover': { backgroundColor: 'rgba(0, 204, 255, 0.1)' }
                }}
                title="Parts Information"
            >
                <Info />
            </IconButton>

            <Dialog
                open={open}
                onClose={handleClose}
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
                    ⚙️ Ship Parts Reference
                </DialogTitle>

                <DialogContent>
                    {Object.entries(partCategories).map(([category, parts]) => (
                        <Box key={category} sx={{ mb: 3 }}>
                            <Typography variant="h6" sx={{ color: '#00ff00', mb: 2 }}>
                                {category}
                            </Typography>

                            <TableContainer component={Paper} sx={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', mb: 2 }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ color: '#ccc', fontWeight: 'bold' }}>Part</TableCell>
                                            <TableCell sx={{ color: '#ccc', fontWeight: 'bold' }}>Size</TableCell>
                                            <TableCell sx={{ color: '#ccc', fontWeight: 'bold' }}>Health</TableCell>
                                            <TableCell sx={{ color: '#ccc', fontWeight: 'bold' }}>Mass</TableCell>
                                            <TableCell sx={{ color: '#ccc', fontWeight: 'bold' }}>Special</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {parts.map(partType => {
                                            const definition = ENTITY_DEFINITIONS[partType as keyof typeof ENTITY_DEFINITIONS];
                                            if (!definition) return null;

                                            const specialFeatures = [];
                                            if (definition.thrust) specialFeatures.push(`Thrust: ${definition.thrust}`);
                                            if (partType.includes('Cockpit') || partType.includes('Core')) {
                                                specialFeatures.push('Built-in Weapon/Engine');
                                                specialFeatures.push('10x Health');
                                            }
                                            if (partType.includes('Gun') || partType.includes('Weapon')) {
                                                specialFeatures.push('Fires Projectiles');
                                            }

                                            return (
                                                <TableRow key={partType}>
                                                    <TableCell>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                            <Box
                                                                sx={{
                                                                    width: 16,
                                                                    height: 16,
                                                                    backgroundColor: definition.color,
                                                                    border: '1px solid #555'
                                                                }}
                                                            />
                                                            <Typography sx={{ color: '#ccc' }}>
                                                                {getPartIcon(partType)} {partType}
                                                            </Typography>
                                                        </Box>
                                                    </TableCell>
                                                    <TableCell sx={{ color: '#ccc' }}>
                                                        {getSizeCategory(partType)}
                                                    </TableCell>
                                                    <TableCell sx={{ color: '#ccc' }}>
                                                        {definition.defaultHealth}
                                                    </TableCell>
                                                    <TableCell sx={{ color: '#ccc' }}>
                                                        {definition.mass}
                                                    </TableCell>
                                                    <TableCell sx={{ color: '#ccc' }}>
                                                        {specialFeatures.length > 0 ? (
                                                            <Box>
                                                                {specialFeatures.map((feature, index) => (
                                                                    <Chip
                                                                        key={index}
                                                                        label={feature}
                                                                        size="small"
                                                                        sx={{
                                                                            mr: 0.5,
                                                                            mb: 0.5,
                                                                            backgroundColor: 'rgba(0, 204, 255, 0.2)',
                                                                            color: '#00ccff'
                                                                        }}
                                                                    />
                                                                ))}
                                                            </Box>
                                                        ) : '-'}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>
                    ))}

                    <Divider sx={{ my: 2, borderColor: '#333' }} />

                    <Typography variant="h6" sx={{ color: '#00ccff', mb: 2 }}>
                        🎮 Cockpit Survival Features
                    </Typography>

                    <List>
                        <ListItem>
                            <ListItemText
                                primary="Built-in Weapon System"
                                secondary="Cockpits can fire when nothing is connected on their top/north side"
                                primaryTypographyProps={{ color: '#00ff00' }}
                                secondaryTypographyProps={{ color: '#ccc' }}
                            />
                        </ListItem>
                        <ListItem>
                            <ListItemText
                                primary="Built-in Engine System"
                                secondary="Cockpits can provide thrust when nothing is connected on their bottom/south side"
                                primaryTypographyProps={{ color: '#00ff00' }}
                                secondaryTypographyProps={{ color: '#ccc' }}
                            />
                        </ListItem>
                        <ListItem>
                            <ListItemText
                                primary="Enhanced Survivability"
                                secondary="All cockpits have 10x health and high thrust-to-weight ratios for escape scenarios"
                                primaryTypographyProps={{ color: '#00ff00' }}
                                secondaryTypographyProps={{ color: '#ccc' }}
                            />
                        </ListItem>
                        <ListItem>
                            <ListItemText
                                primary="Visual Indicators"
                                secondary="Cockpits flash orange when firing weapons and green when using thrust"
                                primaryTypographyProps={{ color: '#00ff00' }}
                                secondaryTypographyProps={{ color: '#ccc' }}
                            />
                        </ListItem>
                    </List>
                </DialogContent>

                <DialogActions>
                    <Button onClick={handleClose} sx={{ color: '#00ccff' }}>
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default PartsInfo;
