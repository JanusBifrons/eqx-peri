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
  Slider,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import { GameEngine } from '../game/core/GameEngine';
import { SoundSystem } from '../game/systems/SoundSystem';

// ── Storage keys ────────────────────────────────────────────────────────────
const STORAGE_KEY_DEBUG         = 'eqx_physicsDebug';
const STORAGE_KEY_DEBUG_ONLY    = 'eqx_physicsDebugOnly';
const STORAGE_KEY_MASTER_VOL    = 'eqx_masterVolume';
const STORAGE_KEY_MUSIC_VOL     = 'eqx_musicVolume';
const STORAGE_KEY_SFX_VOL       = 'eqx_sfxVolume';
const STORAGE_KEY_MUSIC_ENABLED = 'eqx_musicEnabled';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a 0-1 volume from localStorage, falling back to `def` on missing/NaN. */
const parseVol = (key: string, def: number): number => {
  const v = parseFloat(localStorage.getItem(key) ?? '');
  return isNaN(v) ? def : Math.max(0, Math.min(1, v));
};

interface AudioSettings {
  masterVolume: number;
  musicVolume:  number;
  sfxVolume:    number;
  musicEnabled: boolean;
}

const loadAudioSettings = (): AudioSettings => ({
  masterVolume: parseVol(STORAGE_KEY_MASTER_VOL, 0.5),
  musicVolume:  parseVol(STORAGE_KEY_MUSIC_VOL,  0.3),
  sfxVolume:    parseVol(STORAGE_KEY_SFX_VOL,    0.7),
  // Absent key → default enabled; only explicit 'false' disables.
  musicEnabled: localStorage.getItem(STORAGE_KEY_MUSIC_ENABLED) !== 'false',
});

// ── Component ────────────────────────────────────────────────────────────────

interface SettingsPanelProps {
  gameEngine: GameEngine | null;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ gameEngine }) => {
  const [open,    setOpen]    = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  // General tab — draft state, applied only on OK.
  const [draftDebug,     setDraftDebug]     = useState(false);
  const [draftDebugOnly, setDraftDebugOnly] = useState(false);

  // Audio tab — applied immediately for live preview; Cancel reverts.
  const [masterVolume,  setMasterVolume]  = useState(0.5);
  const [musicVolume,   setMusicVolume]   = useState(0.3);
  const [sfxVolume,     setSfxVolume]     = useState(0.7);
  const [musicEnabled,  setMusicEnabled]  = useState(true);
  // Snapshot captured when the dialog opens so Cancel can fully undo live changes.
  const [origAudio, setOrigAudio] = useState<AudioSettings>({
    masterVolume: 0.5, musicVolume: 0.3, sfxVolume: 0.7, musicEnabled: true,
  });

  // ── Apply persisted settings whenever a (new) GameEngine is available ──────
  useEffect(() => {
    if (!gameEngine) return;

    // Debug physics
    const debug     = localStorage.getItem(STORAGE_KEY_DEBUG)      === 'true';
    const debugOnly = localStorage.getItem(STORAGE_KEY_DEBUG_ONLY) === 'true';
    if (debug) gameEngine.setDebugPhysics(true, debugOnly);

    // Audio — apply volumes and honour the music-enabled flag.
    // Volumes are safe to set before or after SoundSystem.init(); the stored
    // settings.* values are read by init() when it creates the gain nodes.
    const audio = loadAudioSettings();
    const ss = SoundSystem.getInstance();
    ss.setMasterVolume(audio.masterVolume);
    ss.setMusicVolume(audio.musicVolume);
    ss.setSfxVolume(audio.sfxVolume);
    // GameEngine.start() calls startMusic() asynchronously via Howler, so
    // calling stopMusic() here cancels the pending load before audio begins.
    if (!audio.musicEnabled) ss.stopMusic();
  }, [gameEngine]);

  // ── Dialog open/close ──────────────────────────────────────────────────────

  const handleOpen = (): void => {
    setDraftDebug(localStorage.getItem(STORAGE_KEY_DEBUG) === 'true');
    setDraftDebugOnly(localStorage.getItem(STORAGE_KEY_DEBUG_ONLY) === 'true');

    // Mirror the live SoundSystem state so sliders start at their real values.
    const ss = SoundSystem.getInstance();
    const live = ss.getSettings();
    const orig: AudioSettings = {
      masterVolume: live.masterVolume,
      musicVolume:  live.musicVolume,
      sfxVolume:    live.sfxVolume,
      musicEnabled: localStorage.getItem(STORAGE_KEY_MUSIC_ENABLED) !== 'false',
    };
    setMasterVolume(orig.masterVolume);
    setMusicVolume(orig.musicVolume);
    setSfxVolume(orig.sfxVolume);
    setMusicEnabled(orig.musicEnabled);
    setOrigAudio(orig);
    setOpen(true);
  };

  const handleCancel = (): void => {
    // Revert live audio to what it was before the dialog opened.
    const ss = SoundSystem.getInstance();
    ss.setMasterVolume(origAudio.masterVolume);
    ss.setMusicVolume(origAudio.musicVolume);
    ss.setSfxVolume(origAudio.sfxVolume);
    if (origAudio.musicEnabled) {
      ss.startMusic();
    } else {
      ss.stopMusic();
    }
    setOpen(false);
  };

  const handleOk = (): void => {
    // Persist debug (and apply to engine).
    localStorage.setItem(STORAGE_KEY_DEBUG,      String(draftDebug));
    localStorage.setItem(STORAGE_KEY_DEBUG_ONLY, String(draftDebug && draftDebugOnly));
    gameEngine?.setDebugPhysics(draftDebug, draftDebug && draftDebugOnly);

    // Persist audio (already live).
    localStorage.setItem(STORAGE_KEY_MASTER_VOL,    String(masterVolume));
    localStorage.setItem(STORAGE_KEY_MUSIC_VOL,     String(musicVolume));
    localStorage.setItem(STORAGE_KEY_SFX_VOL,       String(sfxVolume));
    localStorage.setItem(STORAGE_KEY_MUSIC_ENABLED, String(musicEnabled));
    setOpen(false);
  };

  // ── Live audio handlers ────────────────────────────────────────────────────

  const handleMasterVolume = (_e: Event, value: number | number[]): void => {
    const v = (value as number) / 100;
    setMasterVolume(v);
    SoundSystem.getInstance().setMasterVolume(v);
  };

  const handleMusicVolume = (_e: Event, value: number | number[]): void => {
    const v = (value as number) / 100;
    setMusicVolume(v);
    SoundSystem.getInstance().setMusicVolume(v);
  };

  const handleSfxVolume = (_e: Event, value: number | number[]): void => {
    const v = (value as number) / 100;
    setSfxVolume(v);
    SoundSystem.getInstance().setSfxVolume(v);
  };

  const handleMusicEnabled = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const enabled = e.target.checked;
    setMusicEnabled(enabled);
    if (enabled) {
      SoundSystem.getInstance().startMusic();
    } else {
      SoundSystem.getInstance().stopMusic();
    }
  };

  const pct = (v: number): number => Math.round(v * 100);

  // ── Render ─────────────────────────────────────────────────────────────────

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
        PaperProps={{
          sx: {
            // Both an absolute floor and a viewport-relative minimum.
            minWidth:  'max(420px, 30vw)',
            minHeight: 'max(360px, 35vh)',
          },
        }}
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

        {/* Tab bar sits between title and scrollable content */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v as number)}
            aria-label="settings tabs"
          >
            <Tab label="General" id="settings-tab-0" aria-controls="settings-panel-0" />
            <Tab label="Audio"   id="settings-tab-1" aria-controls="settings-panel-1" />
          </Tabs>
        </Box>

        <DialogContent>

          {/* ── General ─────────────────────────────────────────────────── */}
          <Box
            role="tabpanel"
            hidden={activeTab !== 0}
            id="settings-panel-0"
            aria-labelledby="settings-tab-0"
          >
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
          </Box>

          {/* ── Audio ───────────────────────────────────────────────────── */}
          <Box
            role="tabpanel"
            hidden={activeTab !== 1}
            id="settings-panel-1"
            aria-labelledby="settings-tab-1"
          >
            <FormControlLabel
              control={<Checkbox checked={musicEnabled} onChange={handleMusicEnabled} />}
              label="Music enabled"
              sx={{ mb: 2 }}
            />

            <VolumeRow
              label="Master Volume"
              value={pct(masterVolume)}
              onChange={handleMasterVolume}
            />

            <VolumeRow
              label="Music Volume"
              value={pct(musicVolume)}
              onChange={handleMusicVolume}
              disabled={!musicEnabled}
            />

            <VolumeRow
              label="SFX Volume"
              value={pct(sfxVolume)}
              onChange={handleSfxVolume}
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

// ── VolumeRow sub-component ───────────────────────────────────────────────────

interface VolumeRowProps {
  label:    string;
  value:    number;                                              // 0-100
  onChange: (_e: Event, value: number | number[]) => void;
  disabled?: boolean;
}

const VolumeRow: React.FC<VolumeRowProps> = ({ label, value, onChange, disabled = false }) => (
  <Box sx={{ mb: 2 }}>
    <Typography variant="body2" color="text.secondary" gutterBottom>
      {label}
    </Typography>
    <Stack direction="row" alignItems="center" spacing={2}>
      <Slider
        value={value}
        onChange={onChange}
        min={0}
        max={100}
        size="small"
        disabled={disabled}
        valueLabelDisplay="auto"
        valueLabelFormat={(v: number) => `${v}%`}
        aria-label={label}
        sx={{ flex: 1 }}
      />
      <Typography
        variant="body2"
        color={disabled ? 'text.disabled' : 'text.primary'}
        sx={{ minWidth: 38, textAlign: 'right' }}
      >
        {value}%
      </Typography>
    </Stack>
  </Box>
);

export default SettingsPanel;
