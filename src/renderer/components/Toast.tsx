// ============================================================
// Toast Notification System
// ============================================================

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timerRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    timerRefs.current.delete(id);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((
    message: string,
    type: ToastType = 'info',
    duration = 4000
  ) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const toast: Toast = { id, type, message, duration };

    setToasts(prev => [...prev.slice(-4), toast]); // Max 5 visible at once

    if (duration > 0) {
      const timer = setTimeout(() => dismissToast(id), duration);
      timerRefs.current.set(id, timer);
    }
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// -----------------------------------------------------------
// Toast Container UI
// -----------------------------------------------------------

const TOAST_ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const TOAST_COLORS: Record<ToastType, string> = {
  success: 'var(--color-success)',
  error: 'var(--color-danger)',
  warning: 'var(--color-warning)',
  info: 'var(--color-accent-primary)',
};

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      id="toast-container"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 9999,
        maxWidth: 380,
      }}
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          id={`toast-${toast.id}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-secondary)',
            border: `1px solid ${TOAST_COLORS[toast.type]}40`,
            boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px ${TOAST_COLORS[toast.type]}20`,
            animation: 'slideInRight 0.25s ease-out',
          }}
        >
          <div style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: `${TOAST_COLORS[toast.type]}20`,
            color: TOAST_COLORS[toast.type],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 700,
            flexShrink: 0,
          }}>
            {TOAST_ICONS[toast.type]}
          </div>
          <p style={{
            flex: 1,
            margin: 0,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-primary)',
            lineHeight: 1.4,
          }}>
            {toast.message}
          </p>
          <button
            onClick={() => onDismiss(toast.id)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 2px',
              flexShrink: 0,
              lineHeight: 1,
            }}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
