import React, { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { GameEngine } from '../game/core/GameEngine';
import { ENTITY_DEFINITIONS, EntityType } from '../types/GameTypes';
import { ShipRecord, shipLibraryService } from '../game/ship/ShipLibraryService';
import ShipLibraryModal from './ShipLibraryModal';

// Must match DRAWER_WIDTH_CLOSED in MiniDrawer.tsx to avoid overlap
const MINI_DRAWER_CLOSED_WIDTH = 52;

interface Props {
  gameEngine: GameEngine | null;
}

interface BlockCategory {
  label: string;
  types: EntityType[];
}

const BLOCK_CATEGORIES: BlockCategory[] = [
  {
    label: 'Command',
    types: ['Cockpit', 'LargeCockpit', 'CapitalCore'],
  },
  {
    label: 'Propulsion',
    types: ['Engine', 'LargeEngine', 'CapitalEngine'],
  },
  {
    label: 'Weapons',
    types: ['Gun', 'LargeGun', 'Beam', 'LargeBeam', 'MissileLauncher', 'LargeMissileLauncher', 'CapitalMissileLauncher', 'CapitalWeapon'],
  },
  {
    label: 'Power',
    types: ['PowerCell', 'LargePowerCell', 'PowerReactor'],
  },
  {
    label: 'Defence',
    types: ['Shield', 'LargeShield'],
  },
  {
    label: 'Hull',
    types: ['Hull', 'HeavyHull', 'MegaHull', 'RectHull', 'Hull1x3', 'Hull1x4', 'Hull2x2',
            'Hull5x1', 'Hull3x2', 'Hull4x2', 'Hull5x2',
            'Hull3x3', 'Hull4x3', 'Hull5x3', 'Hull4x4', 'Hull5x4', 'Hull5x5'],
  },
  {
    label: 'Tri-Hull',
    types: ['TriHull', 'TriHull2x1', 'TriHull3x1', 'TriHull2x2',
            'TriHull4x1', 'TriHull5x1', 'TriHull3x2', 'TriHull4x2', 'TriHull5x2',
            'TriHull3x3', 'TriHull4x3', 'TriHull5x3', 'TriHull4x4', 'TriHull5x4', 'TriHull5x5'],
  },
];

/** Returns a short grid-size label like "1×1", "2×2", etc. */
function gridLabel(type: EntityType): string {
  const def = ENTITY_DEFINITIONS[type];
  if (!def) return '';
  const cols = def.gridCols ?? 1;
  const rows = def.gridRows ?? 1;
  return `${cols}×${rows}`;
}

/**
 * Generates a unique copy name like "Fighter (1)", "Fighter (2)", etc.
 * Checks against existing ship names in the library.
 */
function generateCopyName(baseName: string): string {
  const allNames = new Set(shipLibraryService.getAll().map(r => r.name));
  // Strip any existing copy suffix
  const stripped = baseName.replace(/\s*\(\d+\)$/, '');
  let n = 1;
  let candidate = `${stripped} (${n})`;
  while (allNames.has(candidate)) {
    n++;
    candidate = `${stripped} (${n})`;
  }
  return candidate;
}

/**
 * Tracks the current build session — what ship is being created/edited
 * and how to save it.
 */
interface BuilderSession {
  /** Display name for the ship being built */
  name: string;
  /** ID in the library if this ship has been saved at least once. Null = new, never saved. */
  savedId: string | null;
  /**
   * True when the ship was loaded from an existing library record.
   * The first save will trigger an overwrite/copy prompt.
   */
  isFromExisting: boolean;
  /**
   * How subsequent saves are handled after the first-save prompt.
   * 'none' = prompt not yet shown (only relevant when isFromExisting=true).
   * 'overwrite' = update the original record.
   * 'copy' = update the new copy record.
   */
  saveResolution: 'none' | 'overwrite' | 'copy';
}

const ShipBuilderPanel: React.FC<Props> = ({ gameEngine }) => {
  const [session, setSession] = useState<BuilderSession | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [overwriteOpen, setOverwriteOpen] = useState(false);

  const handleBlockClick = (type: EntityType): void => {
    gameEngine?.spawnBlockForBuilder(type);
  };

  // ── Save logic ─────────────────────────────────────────────────────────────

  const handleSave = (): void => {
    if (!session) {
      // No active session — open the library so the user can Create or load a ship
      setLibraryOpen(true);
      return;
    }

    const parts = gameEngine?.getBuilderShipParts() ?? null;
    if (!parts) {
      gameEngine?.showError('Nothing to save.');
      return;
    }

    if (!session.isFromExisting) {
      // New ship: create or update the record
      if (!session.savedId) {
        const record = shipLibraryService.create(session.name, parts);
        setSession(s => s ? { ...s, savedId: record.id } : s);
        showToast(`Saved "${session.name}"`);
      } else {
        shipLibraryService.update(session.savedId, { parts });
        showToast(`Saved "${session.name}"`);
      }
    } else if (session.saveResolution === 'none') {
      // First save of an edited existing ship → ask overwrite or copy
      setOverwriteOpen(true);
    } else if (session.saveResolution === 'overwrite') {
      if (session.savedId) shipLibraryService.update(session.savedId, { parts });
      showToast(`Updated "${session.name}"`);
    } else {
      // copy — savedId points to the copy
      if (session.savedId) shipLibraryService.update(session.savedId, { parts });
      showToast(`Saved "${session.name}"`);
    }
  };

  const showToast = (msg: string): void => {
    gameEngine?.showSuccess(msg);
  };

  const handleOverwriteChoiceOverwrite = (): void => {
    const parts = gameEngine?.getBuilderShipParts() ?? null;
    if (!parts || !session?.savedId) { setOverwriteOpen(false); return; }
    shipLibraryService.update(session.savedId, { parts });
    setSession(s => s ? { ...s, saveResolution: 'overwrite' } : s);
    setOverwriteOpen(false);
    showToast(`Updated "${session.name}"`);
  };

  const handleOverwriteChoiceCopy = (): void => {
    const parts = gameEngine?.getBuilderShipParts() ?? null;
    if (!parts || !session) { setOverwriteOpen(false); return; }
    const copyName = generateCopyName(session.name);
    const copy = shipLibraryService.create(copyName, parts);
    setSession(s => s ? { ...s, name: copyName, savedId: copy.id, isFromExisting: false, saveResolution: 'copy' } : s);
    setOverwriteOpen(false);
    showToast(`Saved as "${copyName}"`);
  };

  // ── Library modal callbacks ────────────────────────────────────────────────

  const handleCreateShip = (name: string): void => {
    // User named a new ship — no save yet, just establish the session
    setSession({ name, savedId: null, isFromExisting: false, saveResolution: 'none' });
    setLibraryOpen(false);
    showToast(`Building "${name}" — click Save when done`);
  };

  const handleEditShip = (record: ShipRecord): void => {
    gameEngine?.loadShipIntoBuilder(record.parts);
    setSession({
      name: record.name,
      savedId: record.isBuiltIn ? null : record.id,
      isFromExisting: !record.isBuiltIn,
      saveResolution: 'none',
    });
    setLibraryOpen(false);
  };

  return (
    <>
      {/* Left sidebar panel — offset by MINI_DRAWER_CLOSED_WIDTH to avoid MiniDrawer overlap */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: MINI_DRAWER_CLOSED_WIDTH,
          width: 200,
          height: '100%',
          backgroundColor: 'rgba(0, 4, 12, 0.92)',
          borderRight: '1px solid #333',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1000,
          pointerEvents: 'auto',
          overflowY: 'auto',
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': { background: '#444', borderRadius: 2 },
        }}
      >
        {/* Header */}
        <Box sx={{ p: 1.5, borderBottom: '1px solid #333', flexShrink: 0 }}>
          <Typography
            sx={{
              fontFamily: 'monospace',
              color: '#00ccff',
              fontSize: '0.8rem',
              fontWeight: 'bold',
              letterSpacing: '0.1em',
              textAlign: 'center',
            }}
          >
            BLOCK PALETTE
          </Typography>
          {/* Active ship name indicator */}
          <Typography
            sx={{
              fontFamily: 'monospace',
              color: session ? '#00ccff' : '#555',
              fontSize: '0.6rem',
              textAlign: 'center',
              mt: 0.25,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {session ? session.name : '— unsaved —'}
          </Typography>
          <Typography sx={{ fontFamily: 'monospace', color: '#666', fontSize: '0.6rem', textAlign: 'center', mt: 0.25 }}>
            Click to spawn · drag to snap
          </Typography>
        </Box>

        {/* Block categories */}
        <Box sx={{ flex: 1, overflowY: 'auto', px: 1, py: 0.5 }}>
          {BLOCK_CATEGORIES.map((cat) => (
            <Box key={cat.label} sx={{ mb: 1 }}>
              <Typography
                sx={{
                  fontFamily: 'monospace',
                  color: '#888',
                  fontSize: '0.6rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  px: 0.5,
                  py: 0.5,
                }}
              >
                {cat.label}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {cat.types.map((type) => {
                  const def = ENTITY_DEFINITIONS[type];
                  if (!def) return null;
                  return (
                    <Tooltip key={type} title={`${type} (${gridLabel(type)})`} placement="right" arrow>
                      <Box
                        onClick={() => handleBlockClick(type)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          px: 0.75,
                          py: 0.5,
                          borderRadius: '3px',
                          cursor: 'pointer',
                          border: '1px solid transparent',
                          '&:hover': {
                            backgroundColor: 'rgba(0, 204, 255, 0.08)',
                            borderColor: 'rgba(0, 204, 255, 0.3)',
                          },
                          '&:active': { backgroundColor: 'rgba(0, 204, 255, 0.15)' },
                        }}
                      >
                        <Box
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '2px',
                            backgroundColor: def.color,
                            flexShrink: 0,
                            border: '1px solid rgba(255,255,255,0.15)',
                          }}
                        />
                        <Typography
                          sx={{
                            fontFamily: 'monospace',
                            color: '#cccccc',
                            fontSize: '0.65rem',
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {type}
                        </Typography>
                        <Typography
                          sx={{
                            fontFamily: 'monospace',
                            color: '#555',
                            fontSize: '0.55rem',
                            flexShrink: 0,
                          }}
                        >
                          {gridLabel(type)}
                        </Typography>
                      </Box>
                    </Tooltip>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>

        {/* Footer — Save + Load icons */}
        <Box
          sx={{
            p: 1,
            borderTop: '1px solid #333',
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'center',
            gap: 1,
          }}
        >
          <Tooltip title={session ? `Save "${session.name}"` : 'Save ship (open library first)'}>
            <IconButton
              onClick={handleSave}
              size="small"
              sx={{
                color: session ? '#00ccff' : '#555',
                border: `1px solid ${session ? 'rgba(0,204,255,0.4)' : '#333'}`,
                borderRadius: '4px',
                '&:hover': { backgroundColor: 'rgba(0, 204, 255, 0.1)' },
              }}
            >
              <SaveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Open ship library">
            <IconButton
              onClick={() => setLibraryOpen(true)}
              size="small"
              sx={{
                color: '#aaa',
                border: '1px solid #333',
                borderRadius: '4px',
                '&:hover': { backgroundColor: 'rgba(0, 204, 255, 0.1)', color: '#00ccff' },
              }}
            >
              <FolderOpenIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Ship library CRUD modal */}
      <ShipLibraryModal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onCreateShip={handleCreateShip}
        onEditShip={handleEditShip}
      />

      {/* Overwrite / copy dialog — shown on first save of an edited existing ship */}
      <Dialog
        open={overwriteOpen}
        onClose={() => setOverwriteOpen(false)}
        PaperProps={{
          sx: { backgroundColor: 'rgba(0, 4, 16, 0.98)', border: '1px solid #336', minWidth: 360 },
        }}
      >
        <DialogTitle sx={{ fontFamily: 'monospace', color: '#00ccff', fontSize: '0.85rem', pb: 1 }}>
          Save Ship
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontFamily: 'monospace', color: '#ccc', fontSize: '0.75rem' }}>
            Overwrite <strong style={{ color: '#fff' }}>{session?.name}</strong> with your changes,
            or save as a new copy?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button
            onClick={() => setOverwriteOpen(false)}
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#888' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleOverwriteChoiceCopy}
            variant="outlined"
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#aaa', borderColor: '#555' }}
          >
            Save as Copy
          </Button>
          <Button
            onClick={handleOverwriteChoiceOverwrite}
            variant="outlined"
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#00ccff', borderColor: '#336' }}
          >
            Overwrite
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ShipBuilderPanel;
