import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import { GameEngine } from '../game/core/GameEngine';

const STORAGE_KEY_DEBUG = 'eqx_physicsDebug';
const STORAGE_KEY_DEBUG_ONLY = 'eqx_physicsDebugOnly';

interface SettingsPanelProps {
  gameEngine: GameEngine | null;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ gameEngine }) => {
  const [open, setOpen] = useState(false);
  // Draft state: changes are only applied when OK is clicked.
  const [draftDebug, setDraftDebug] = useState(false);
  const [draftDebugOnly, setDraftDebugOnly] = useState(false);

  // When a (new) game engine arrives, apply the persisted settings immediately.
  useEffect(() => {
    if (!gameEngine) return;
    const debug = localStorage.getItem(STORAGE_KEY_DEBUG) === 'true';
    const debugOnly = localStorage.getItem(STORAGE_KEY_DEBUG_ONLY) === 'true';
    if (debug) gameEngine.setDebugPhysics(true, debugOnly);
  }, [gameEngine]);

  const handleOpen = (): void => {
    setDraftDebug(localStorage.getItem(STORAGE_KEY_DEBUG) === 'true');
    setDraftDebugOnly(localStorage.getItem(STORAGE_KEY_DEBUG_ONLY) === 'true');
    setOpen(true);
  };

  const handleCancel = (): void => {
    setOpen(false);
  };

  const handleOk = (): void => {
    localStorage.setItem(STORAGE_KEY_DEBUG, String(draftDebug));
    localStorage.setItem(STORAGE_KEY_DEBUG_ONLY, String(draftDebug && draftDebugOnly));
    gameEngine?.setDebugPhysics(draftDebug, draftDebug && draftDebugOnly);
    setOpen(false);
  };

  return (
    <>
      {/* Gear button — bottom-left HUD */}
      <Box sx={{ position: 'absolute', bottom: 10, left: 10, zIndex: 1100 }}>
        <IconButton
          onClick={handleOpen}
          size="small"
          title="Settings"
          sx={{
            background: 'rgba(0,0,0,0.75)',
            border: '1px solid #555',
            borderRadius: 1,
            color: '#ccc',
            '&:hover': { background: 'rgba(0,0,0,0.9)', color: '#fff' },
          }}
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Box>

      <Dialog
        open={open}
        onClose={handleCancel}
        PaperProps={{ sx: { minWidth: 340 } }}
      >
        <DialogTitle sx={{ pr: 6 }}>
          Settings
          <IconButton
            onClick={handleCancel}
            size="small"
            sx={{ position: 'absolute', right: 8, top: 8 }}
            aria-label="close"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers>
          <FormControlLabel
            control={
              <Checkbox
                checked={draftDebug}
                onChange={(e) => {
                  setDraftDebug(e.target.checked);
                  if (!e.target.checked) setDraftDebugOnly(false);
                }}
              />
            }
            label="Physics Debug (Wireframes)"
          />
          <Box sx={{ pl: 4 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={draftDebugOnly}
                  disabled={!draftDebug}
                  onChange={(e) => setDraftDebugOnly(e.target.checked)}
                />
              }
              label="Wireframes only (hide game rendering)"
              slotProps={{ typography: { color: draftDebug ? 'text.primary' : 'text.disabled' } }}
            />
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleOk} variant="contained">OK</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default SettingsPanel;
