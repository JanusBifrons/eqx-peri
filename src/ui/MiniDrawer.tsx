import React from 'react';
import {
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ScienceIcon from '@mui/icons-material/Science';
import ConstructionIcon from '@mui/icons-material/Construction';
import GroupsIcon from '@mui/icons-material/Groups';
import PublicIcon from '@mui/icons-material/Public';
import ExploreIcon from '@mui/icons-material/Explore';
import SettingsIcon from '@mui/icons-material/Settings';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';

const DRAWER_WIDTH_OPEN = 180;
const DRAWER_WIDTH_CLOSED = 52;

interface MiniDrawerProps {
  visible: boolean;
  showGalaxyMap: boolean;
  onSettingsClick: () => void;
  onExitClick: () => void;
  onGalaxyMapClick: () => void;
  onWorldViewClick: () => void;
}

const MiniDrawer: React.FC<MiniDrawerProps> = ({ visible, showGalaxyMap, onSettingsClick, onExitClick, onGalaxyMapClick, onWorldViewClick }) => {
  const [open, setOpen] = React.useState(false);

  if (!visible) return null;

  const drawerWidth = open ? DRAWER_WIDTH_OPEN : DRAWER_WIDTH_CLOSED;

  const gameplayItems = [
    showGalaxyMap
      ? { label: 'World View', icon: <ExploreIcon />, onClick: onWorldViewClick, active: false }
      : { label: 'Galaxy Map', icon: <PublicIcon />, onClick: onGalaxyMapClick, active: false },
    { label: 'Research', icon: <ScienceIcon />, onClick: () => {}, active: false },
    { label: 'Builder', icon: <ConstructionIcon />, onClick: () => {}, active: false },
    { label: 'Crew', icon: <GroupsIcon />, onClick: () => {}, active: false },
  ];

  const systemItems = [
    { label: 'Settings', icon: <SettingsIcon />, onClick: onSettingsClick },
    { label: 'Exit', icon: <ExitToAppIcon />, onClick: onExitClick },
  ];

  return (
    <Drawer
      variant="permanent"
      open={open}
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          transition: 'width 0.2s ease',
          overflowX: 'hidden',
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          borderRight: '1px solid #333',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1250, // above GalaxyMapView overlay (1200)
        },
      }}
    >
      {/* Hamburger toggle */}
      <Box sx={{ display: 'flex', justifyContent: open ? 'flex-end' : 'center', p: 0.5 }}>
        <IconButton onClick={() => setOpen(!open)} size="small" sx={{ color: '#ccc' }}>
          {open ? <ChevronLeftIcon /> : <MenuIcon />}
        </IconButton>
      </Box>

      <Divider sx={{ borderColor: '#333' }} />

      {/* Gameplay actions — top section */}
      <List sx={{ flex: 1, pt: 0 }}>
        {gameplayItems.map((item) => (
          <ListItem key={item.label} disablePadding sx={{ display: 'block' }}>
            <Tooltip title={open ? '' : item.label} placement="right" arrow>
              <ListItemButton
                onClick={item.onClick}
                sx={{
                  minHeight: 44,
                  justifyContent: open ? 'initial' : 'center',
                  px: open ? 2 : 1.5,
                  '&:hover': { backgroundColor: 'rgba(0, 204, 255, 0.1)' },
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 0,
                    mr: open ? 2 : 'auto',
                    justifyContent: 'center',
                    color: '#aaa',
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                {open && (
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{ fontSize: '0.8rem', color: '#ccc' }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          </ListItem>
        ))}
      </List>

      {/* System actions — bottom section */}
      <Divider sx={{ borderColor: '#444' }} />
      <List sx={{ pt: 0, pb: 0 }}>
        {systemItems.map((item) => (
          <ListItem key={item.label} disablePadding sx={{ display: 'block' }}>
            <Tooltip title={open ? '' : item.label} placement="right" arrow>
              <ListItemButton
                onClick={item.onClick}
                sx={{
                  minHeight: 44,
                  justifyContent: open ? 'initial' : 'center',
                  px: open ? 2 : 1.5,
                  '&:hover': {
                    backgroundColor: item.label === 'Exit'
                      ? 'rgba(255, 68, 68, 0.15)'
                      : 'rgba(0, 204, 255, 0.1)',
                  },
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 0,
                    mr: open ? 2 : 'auto',
                    justifyContent: 'center',
                    color: item.label === 'Exit' ? '#ff6666' : '#aaa',
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                {open && (
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{
                      fontSize: '0.8rem',
                      color: item.label === 'Exit' ? '#ff6666' : '#ccc',
                    }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          </ListItem>
        ))}
      </List>
    </Drawer>
  );
};

export default MiniDrawer;
