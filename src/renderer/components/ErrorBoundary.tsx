// ============================================================
// Error Boundary — catches unhandled render errors
// ============================================================

import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          id="error-boundary-fallback"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 48,
            gap: 16,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h3 style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-lg)', margin: 0 }}>
            Something went wrong
          </h3>
          <p style={{
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--font-size-sm)',
            maxWidth: 480,
            fontFamily: 'monospace',
            background: 'var(--color-bg-tertiary)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            wordBreak: 'break-word',
          }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            className="btn btn-secondary"
            onClick={this.handleReset}
            id="btn-error-retry"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
