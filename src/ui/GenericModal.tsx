import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, IconButton, Typography, Button } from '@mui/material';
import { styled } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  onOk?: () => void;
  showOkCancel?: boolean;
  okLabel?: string;
  cancelLabel?: string;
  initialWidth?: number;
  initialHeight?: number;
  children?: React.ReactNode;
}

const ModalContainer = styled(Box)(() => ({
  position: 'fixed',
  backgroundColor: 'rgba(10, 12, 18, 0.95)',
  border: '1px solid rgba(0, 204, 255, 0.4)',
  borderRadius: 6,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  zIndex: 2000,
  pointerEvents: 'auto',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6)',
  minWidth: 280,
  minHeight: 180,
}));

const TitleBar = styled(Box)(() => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 10px',
  backgroundColor: 'rgba(0, 204, 255, 0.1)',
  borderBottom: '1px solid rgba(0, 204, 255, 0.2)',
  cursor: 'grab',
  userSelect: 'none',
  '&:active': { cursor: 'grabbing' },
}));

const ContentArea = styled(Box)(() => ({
  flex: 1,
  overflow: 'auto',
  padding: '10px 12px',
}));

const FooterBar = styled(Box)(() => ({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '6px 10px',
  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
}));

const ResizeHandle = styled(Box)(() => ({
  position: 'absolute',
  right: 0,
  bottom: 0,
  width: 14,
  height: 14,
  cursor: 'nwse-resize',
  '&::after': {
    content: '""',
    position: 'absolute',
    right: 3,
    bottom: 3,
    width: 8,
    height: 8,
    borderRight: '2px solid rgba(0, 204, 255, 0.4)',
    borderBottom: '2px solid rgba(0, 204, 255, 0.4)',
  },
}));

const GenericModal: React.FC<Props> = ({
  title,
  open,
  onClose,
  onOk,
  showOkCancel = false,
  okLabel = 'OK',
  cancelLabel = 'Cancel',
  initialWidth = 400,
  initialHeight = 300,
  children,
}) => {
  const [pos, setPos] = useState({ x: -1, y: -1 });
  const [size, setSize] = useState({ w: initialWidth, h: initialHeight });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Center on first open
  useEffect(() => {
    if (open && pos.x === -1) {
      setPos({
        x: Math.max(0, (window.innerWidth - size.w) / 2),
        y: Math.max(0, (window.innerHeight - size.h) / 2),
      });
    }
  }, [open, pos.x, size.w, size.h]);

  // ── Drag ──────────────────────────────────────────────────────────
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos.x, pos.y]);

  // ── Resize ────────────────────────────────────────────────────────
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      setSize({
        w: Math.max(280, resizeRef.current.origW + (ev.clientX - resizeRef.current.startX)),
        h: Math.max(180, resizeRef.current.origH + (ev.clientY - resizeRef.current.startY)),
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size.w, size.h]);

  if (!open) return null;

  return (
    <ModalContainer
      ref={containerRef}
      sx={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      <TitleBar onMouseDown={onDragStart}>
        <Typography variant="subtitle2" sx={{ color: '#00ccff', fontWeight: 700, fontSize: 13 }}>
          {title}
        </Typography>
        <IconButton size="small" onClick={onClose} sx={{ color: '#aaa', p: 0.3 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </TitleBar>

      <ContentArea>
        {children}
      </ContentArea>

      {showOkCancel && (
        <FooterBar>
          <Button size="small" variant="outlined" onClick={onClose}
            sx={{ color: '#aaa', borderColor: 'rgba(255,255,255,0.15)', textTransform: 'none', fontSize: 12 }}>
            {cancelLabel}
          </Button>
          <Button size="small" variant="outlined" onClick={onOk ?? onClose}
            sx={{ color: '#00ccff', borderColor: 'rgba(0,204,255,0.4)', textTransform: 'none', fontSize: 12 }}>
            {okLabel}
          </Button>
        </FooterBar>
      )}

      <ResizeHandle onMouseDown={onResizeStart} />
    </ModalContainer>
  );
};

export default GenericModal;
