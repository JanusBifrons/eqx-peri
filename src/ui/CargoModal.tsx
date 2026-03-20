import React, { useState, useEffect } from 'react';
import {
  Table, TableHead, TableBody, TableRow, TableCell,
  Typography, Box,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { Structure } from '../game/structures/Structure';
import GenericModal from './GenericModal';

interface Props {
  open: boolean;
  structure: Structure | null;
  onClose: () => void;
}

const StyledTableCell = styled(TableCell)(() => ({
  color: '#ccc',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  fontSize: 12,
  padding: '4px 10px',
  fontFamily: 'monospace',
}));

const HeaderCell = styled(TableCell)(() => ({
  color: '#00ccff',
  borderBottom: '1px solid rgba(0,204,255,0.2)',
  fontSize: 11,
  fontWeight: 700,
  padding: '4px 10px',
  textTransform: 'uppercase',
  fontFamily: 'monospace',
}));

/** Format kg with appropriate unit and commas. */
function formatKg(kg: number): string {
  if (kg < 1) return `${Math.round(kg * 1000).toLocaleString('en-US')} g`;
  if (kg < 1_000) return `${Math.round(kg).toLocaleString('en-US')} kg`;
  if (kg < 1_000_000) return `${(kg / 1_000).toFixed(1)} t`;
  return `${(kg / 1_000_000).toFixed(1)} kt`;
}

/** Make a display name from a camelCase material type. */
function displayName(type: string): string {
  return type
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\s/, '')
    .replace(/Ore$/, ' Ore');
}

const CargoModal: React.FC<Props> = ({ open, structure, onClose }) => {
  const [items, setItems] = useState<[string, number][]>([]);
  const [total, setTotal] = useState(0);
  const [capacity, setCapacity] = useState(0);

  // Poll inventory while open
  useEffect(() => {
    if (!open || !structure) return;
    const interval = setInterval(() => {
      if (structure.isDestroyed()) {
        onClose();
        return;
      }
      setItems(structure.getInventoryItems());
      setTotal(structure.getInventoryTotal());
      setCapacity(structure.getStorageCapacity());
    }, 250);
    // Initial
    setItems(structure.getInventoryItems());
    setTotal(structure.getInventoryTotal());
    setCapacity(structure.getStorageCapacity());
    return () => clearInterval(interval);
  }, [open, structure, onClose]);

  const pct = capacity > 0 ? Math.round((total / capacity) * 100) : 0;

  return (
    <GenericModal
      title={`${structure?.definition.label ?? 'Structure'} — Cargo`}
      open={open}
      onClose={onClose}
      initialWidth={380}
      initialHeight={320}
    >
      {/* Summary line */}
      <Box sx={{ mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography sx={{ color: '#aaa', fontSize: 11, fontFamily: 'monospace' }}>
          {formatKg(total)} / {formatKg(capacity)} ({pct}%)
        </Typography>
      </Box>

      {/* Inventory table */}
      {items.length === 0 ? (
        <Box sx={{ color: '#666', fontSize: 13, textAlign: 'center', mt: 3 }}>
          Cargo is empty.
        </Box>
      ) : (
        <Table size="small" sx={{ tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              <HeaderCell sx={{ width: '60%' }}>Material</HeaderCell>
              <HeaderCell sx={{ width: '40%', textAlign: 'right' }}>Amount</HeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map(([type, amount]) => (
              <TableRow key={type} sx={{ '&:hover': { backgroundColor: 'rgba(0,204,255,0.05)' } }}>
                <StyledTableCell>{displayName(type)}</StyledTableCell>
                <StyledTableCell sx={{ textAlign: 'right' }}>{formatKg(amount)}</StyledTableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </GenericModal>
  );
};

export default CargoModal;
