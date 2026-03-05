import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from '@mui/material';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ open, title, message, onConfirm, onCancel }) => (
    <Dialog
        open={open}
        onClose={onCancel}
        PaperProps={{ sx: { backgroundColor: 'rgba(0, 0, 0, 0.95)', border: '1px solid #444' } }}
    >
        <DialogTitle sx={{ color: '#00ccff', fontFamily: 'monospace' }}>{title}</DialogTitle>
        <DialogContent>
            <DialogContentText sx={{ color: '#ccc', fontFamily: 'monospace' }}>{message}</DialogContentText>
        </DialogContent>
        <DialogActions>
            <Button onClick={onCancel} sx={{ color: '#888' }}>Cancel</Button>
            <Button onClick={onConfirm} variant="outlined" sx={{ color: '#00ccff', borderColor: '#00ccff' }}>
                Confirm
            </Button>
        </DialogActions>
    </Dialog>
);

export default ConfirmDialog;
