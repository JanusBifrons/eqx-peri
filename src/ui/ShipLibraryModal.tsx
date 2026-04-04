import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { ShipRecord, ShipStats, computeShipStats, shipLibraryService } from '../game/ship/ShipLibraryService';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when the user creates a new named ship — provides just the name (no save yet). */
  onCreateShip: (name: string) => void;
  /** Called when the user selects Edit — the ship should be loaded into the builder. */
  onEditShip: (record: ShipRecord) => void;
}

const CELL_SX = { fontFamily: 'monospace', fontSize: '0.72rem', color: '#ccc', py: 0.75, px: 1.5 };
const HEAD_SX = { fontFamily: 'monospace', fontSize: '0.65rem', color: '#00ccff', py: 0.5, px: 1.5, borderColor: '#333' };

function formatMass(kg: number): string {
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(1)} Mt`;
  if (kg >= 1_000) return `${(kg / 1_000).toFixed(1)} t`;
  return `${kg} kg`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

const ShipLibraryModal: React.FC<Props> = ({ open, onClose, onCreateShip, onEditShip }) => {
  const [records, setRecords] = useState<ShipRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create sub-dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');

  // Delete confirm sub-dialog
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Refresh records whenever the modal opens
  useEffect(() => {
    if (open) {
      setRecords(shipLibraryService.getAll());
      setSelectedId(null);
    }
  }, [open]);

  const statsMap = useMemo<Map<string, ShipStats>>(() => {
    const m = new Map<string, ShipStats>();
    for (const r of records) {
      m.set(r.id, computeShipStats(r.parts));
    }
    return m;
  }, [records]);

  const selected = records.find(r => r.id === selectedId) ?? null;

  // ── Create flow ─────────────────────────────────────────────────────────────
  const handleOpenCreate = (): void => {
    setNewName('');
    setCreateError('');
    setCreateOpen(true);
  };

  const handleCreateOk = (): void => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setCreateError('Name is required.');
      return;
    }
    // Close both modals and hand the name back to the parent
    setCreateOpen(false);
    onCreateShip(trimmed);
    onClose();
  };

  // ── Edit flow ────────────────────────────────────────────────────────────────
  const handleEdit = (): void => {
    if (!selected) return;
    onEditShip(selected);
    onClose();
  };

  // ── Delete flow ──────────────────────────────────────────────────────────────
  const handleDeleteConfirm = (): void => {
    if (!selectedId) return;
    shipLibraryService.delete(selectedId);
    setRecords(shipLibraryService.getAll());
    setSelectedId(null);
    setDeleteOpen(false);
  };

  const canDelete = !!selected && !selected.isBuiltIn;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(0, 4, 16, 0.97)',
            border: '1px solid #336',
            minWidth: 700,
          },
        }}
      >
        <DialogTitle
          sx={{
            fontFamily: 'monospace',
            color: '#00ccff',
            fontSize: '0.9rem',
            borderBottom: '1px solid #333',
            pb: 1,
          }}
        >
          Ship Library
        </DialogTitle>

        <DialogContent sx={{ p: 0 }}>
          {/* Toolbar */}
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              px: 2,
              pt: 1.5,
              pb: 1,
              borderBottom: '1px solid #222',
            }}
          >
            <Tooltip title="Create new ship">
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={handleOpenCreate}
                sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#00ccff', borderColor: '#336' }}
              >
                Create
              </Button>
            </Tooltip>
            <Tooltip title={selectedId ? 'Load ship for editing' : 'Select a ship first'}>
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<EditIcon />}
                  onClick={handleEdit}
                  disabled={!selectedId}
                  sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#aaa', borderColor: '#444' }}
                >
                  Edit
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={!selectedId ? 'Select a ship first' : selected?.isBuiltIn ? 'Cannot delete built-in ships' : 'Delete selected ship'}>
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DeleteIcon />}
                  onClick={() => setDeleteOpen(true)}
                  disabled={!canDelete}
                  sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#ff6666', borderColor: '#633' }}
                >
                  Delete
                </Button>
              </span>
            </Tooltip>
          </Box>

          {/* Table */}
          <Box sx={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={HEAD_SX}>Name</TableCell>
                  <TableCell sx={{ ...HEAD_SX, textAlign: 'right' }}>Blocks</TableCell>
                  <TableCell sx={{ ...HEAD_SX, textAlign: 'right' }}>Mass</TableCell>
                  <TableCell sx={{ ...HEAD_SX, textAlign: 'right' }}>Engines</TableCell>
                  <TableCell sx={{ ...HEAD_SX, textAlign: 'right' }}>Weapons</TableCell>
                  <TableCell sx={HEAD_SX}>Created</TableCell>
                  <TableCell sx={HEAD_SX}>Updated</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {records.map(r => {
                  const stats = statsMap.get(r.id);
                  const isSelected = r.id === selectedId;
                  return (
                    <TableRow
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      sx={{
                        cursor: 'pointer',
                        backgroundColor: isSelected ? 'rgba(0, 204, 255, 0.1)' : 'transparent',
                        '&:hover': { backgroundColor: 'rgba(0, 204, 255, 0.06)' },
                        '& .MuiTableCell-root': { borderColor: '#222' },
                      }}
                    >
                      <TableCell sx={CELL_SX}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {r.name}
                          {r.isBuiltIn && (
                            <Chip
                              label="built-in"
                              size="small"
                              sx={{
                                height: 16,
                                fontSize: '0.55rem',
                                fontFamily: 'monospace',
                                backgroundColor: '#222',
                                color: '#777',
                                border: '1px solid #444',
                              }}
                            />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ ...CELL_SX, textAlign: 'right' }}>{stats?.blockCount ?? '—'}</TableCell>
                      <TableCell sx={{ ...CELL_SX, textAlign: 'right' }}>{stats ? formatMass(stats.totalMass) : '—'}</TableCell>
                      <TableCell sx={{ ...CELL_SX, textAlign: 'right' }}>{stats?.engineCount ?? '—'}</TableCell>
                      <TableCell sx={{ ...CELL_SX, textAlign: 'right' }}>{stats?.weaponCount ?? '—'}</TableCell>
                      <TableCell sx={CELL_SX}>{formatDate(r.createdAt)}</TableCell>
                      <TableCell sx={CELL_SX}>{formatDate(r.updatedAt)}</TableCell>
                    </TableRow>
                  );
                })}
                {records.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ ...CELL_SX, color: '#555', textAlign: 'center', py: 3 }}>
                      No ships saved yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2, borderTop: '1px solid #222' }}>
          <Button
            onClick={onClose}
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#888' }}
          >
            Cancel
          </Button>
          <Button
            onClick={onClose}
            variant="outlined"
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#00ccff', borderColor: '#336' }}
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Create sub-dialog ─────────────────────────────────────────────── */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        PaperProps={{
          sx: { backgroundColor: 'rgba(0, 4, 16, 0.98)', border: '1px solid #336', minWidth: 340 },
        }}
      >
        <DialogTitle sx={{ fontFamily: 'monospace', color: '#00ccff', fontSize: '0.85rem', pb: 1 }}>
          New Ship
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Ship name"
            value={newName}
            onChange={e => { setNewName(e.target.value); setCreateError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateOk(); }}
            error={!!createError}
            helperText={createError || ' '}
            size="small"
            InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
            InputLabelProps={{ sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setCreateOpen(false)}
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#888' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateOk}
            variant="outlined"
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#00ccff', borderColor: '#336' }}
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete confirm sub-dialog ─────────────────────────────────────── */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        PaperProps={{
          sx: { backgroundColor: 'rgba(0, 0, 0, 0.95)', border: '1px solid #444' },
        }}
      >
        <DialogTitle sx={{ fontFamily: 'monospace', color: '#ff6666', fontSize: '0.85rem' }}>
          Delete Ship
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#ccc' }}>
            Delete <strong style={{ color: '#fff' }}>{selected?.name}</strong>? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setDeleteOpen(false)}
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#888' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            variant="outlined"
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#ff6666', borderColor: '#633' }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ShipLibraryModal;
