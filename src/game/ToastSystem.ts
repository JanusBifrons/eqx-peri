export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error' | 'kill' | 'team';
  duration: number; // in milliseconds
  timestamp: number;
}

export class ToastSystem {
  private toasts: Toast[] = [];
  private container: HTMLElement;
  private nextId = 1;

  constructor(parentElement: HTMLElement) {
    this.container = this.createToastContainer();
    parentElement.appendChild(this.container);
  }

  private createToastContainer(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
      max-width: 400px;
    `;
    return container;
  }

  public showToast(message: string, type: Toast['type'] = 'info', duration: number = 4000): void {
    const toast: Toast = {
      id: `toast-${this.nextId++}`,
      message,
      type,
      duration,
      timestamp: Date.now()
    };

    this.toasts.push(toast);
    this.renderToast(toast);

    // Auto-remove after duration
    setTimeout(() => {
      this.removeToast(toast.id);
    }, duration);
  }

  private renderToast(toast: Toast): void {
    const toastElement = document.createElement('div');
    toastElement.id = toast.id;
    toastElement.style.cssText = this.getToastStyle(toast.type);
    
    // Add icon based on type
    const icon = this.getToastIcon(toast.type);
    
    toastElement.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 16px;">${icon}</span>
        <span style="flex: 1;">${toast.message}</span>
      </div>
    `;

    // Add slide-in animation
    toastElement.style.transform = 'translateX(100%)';
    toastElement.style.transition = 'all 0.3s ease-out';
    
    this.container.appendChild(toastElement);
    
    // Trigger slide-in animation
    requestAnimationFrame(() => {
      toastElement.style.transform = 'translateX(0)';
    });

    // Add fade-out animation before removal
    setTimeout(() => {
      toastElement.style.opacity = '0';
      toastElement.style.transform = 'translateX(100%)';
    }, toast.duration - 300);
  }

  private getToastStyle(type: Toast['type']): string {
    const baseStyle = `
      padding: 12px 16px;
      border-radius: 8px;
      color: white;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      font-weight: bold;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      border: 2px solid;
      backdrop-filter: blur(4px);
      max-width: 100%;
      word-wrap: break-word;
    `;

    const typeStyles = {
      info: `
        background: linear-gradient(135deg, rgba(0,122,255,0.9), rgba(0,122,255,0.7));
        border-color: #007AFF;
      `,
      warning: `
        background: linear-gradient(135deg, rgba(255,159,10,0.9), rgba(255,159,10,0.7));
        border-color: #FF9F0A;
      `,
      success: `
        background: linear-gradient(135deg, rgba(52,199,89,0.9), rgba(52,199,89,0.7));
        border-color: #34C759;
      `,
      error: `
        background: linear-gradient(135deg, rgba(255,69,58,0.9), rgba(255,69,58,0.7));
        border-color: #FF453A;
      `,
      kill: `
        background: linear-gradient(135deg, rgba(255,20,20,0.9), rgba(139,0,0,0.8));
        border-color: #FF1414;
        animation: pulse 0.5s ease-in-out;
      `,
      team: `
        background: linear-gradient(135deg, rgba(138,43,226,0.9), rgba(138,43,226,0.7));
        border-color: #8A2BE2;
      `
    };

    return baseStyle + typeStyles[type];
  }

  private getToastIcon(type: Toast['type']): string {
    const icons = {
      info: 'ℹ️',
      warning: '⚠️',
      success: '✅',
      error: '❌',
      kill: '💀',
      team: '🏴'
    };
    return icons[type];
  }

  private removeToast(id: string): void {
    const toastElement = document.getElementById(id);
    if (toastElement) {
      toastElement.remove();
    }
    
    this.toasts = this.toasts.filter(toast => toast.id !== id);
  }

  public clearAllToasts(): void {
    this.toasts.forEach(toast => {
      const element = document.getElementById(toast.id);
      if (element) {
        element.remove();
      }
    });
    this.toasts = [];
  }

  // Convenience methods for different types
  public showKill(killer: string, victim: string): void {
    this.showToast(`${killer} destroyed ${victim}`, 'kill', 5000);
  }

  public showTeamChange(ship: string, newTeam: string): void {
    this.showToast(`${ship} joined ${newTeam} team`, 'team', 4000);
  }

  public showGameEvent(message: string): void {
    this.showToast(message, 'info', 4000);
  }

  public showWarning(message: string): void {
    this.showToast(message, 'warning', 4000);
  }

  public showSuccess(message: string): void {
    this.showToast(message, 'success', 3000);
  }

  public showError(message: string): void {
    this.showToast(message, 'error', 5000);
  }
}
