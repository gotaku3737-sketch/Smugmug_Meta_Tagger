// ============================================================
// Login Page — API Credentials + OAuth Flow
// ============================================================

import React, { useState } from 'react';
import type { AuthStatus, OAuthRequestToken } from '../../shared/types';

interface LoginPageProps {
  authStatus: AuthStatus;
  onAuthComplete: (status: AuthStatus) => void;
}

export function LoginPage({ authStatus, onAuthComplete }: LoginPageProps) {
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [verifier, setVerifier] = useState('');
  const [pendingAuth, setPendingAuth] = useState<OAuthRequestToken | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    if (!consumerKey.trim() || !consumerSecret.trim()) {
      setError('Please enter both API Key and API Secret');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await window.electronAPI.smugmug.setCredentials(consumerKey.trim(), consumerSecret.trim());
      const requestToken = await window.electronAPI.smugmug.startAuth();
      setPendingAuth(requestToken);

      // Open the authorization URL in the system browser
      window.open(requestToken.authorizationUrl, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start authentication');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!verifier.trim()) {
      setError('Please enter the 6-digit verification code');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const user = await window.electronAPI.smugmug.completeAuth(verifier.trim());
      onAuthComplete({ state: 'connected', user });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    await window.electronAPI.smugmug.disconnect();
    setPendingAuth(null);
    setVerifier('');
    onAuthComplete({ state: 'disconnected' });
  }

  // Connected state
  if (authStatus.state === 'connected') {
    return (
      <div className="page" id="page-login">
        <div className="page-header">
          <h2 className="page-title">SmugMug Connected</h2>
          <p className="page-description">You're connected and ready to start tagging photos.</p>
        </div>

        <div className="card" style={{ maxWidth: 480 }}>
          <div className="flex items-center gap-4 mb-4">
            <div className="user-avatar" style={{ width: 56, height: 56, fontSize: '1.5rem' }}>
              {authStatus.user.displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 600 }}>
                {authStatus.user.displayName}
              </div>
              <div className="text-muted">@{authStatus.user.nickname}</div>
            </div>
          </div>

          <div className="flex gap-3" style={{ marginTop: 'var(--space-6)' }}>
            <button className="btn btn-primary" onClick={() => onAuthComplete(authStatus)} id="btn-go-galleries">
              📸 Go to Galleries
            </button>
            <button className="btn btn-danger" onClick={handleDisconnect} id="btn-disconnect">
              Disconnect
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" id="page-login">
      <div className="page-header">
        <h2 className="page-title">Connect to SmugMug</h2>
        <p className="page-description">
          Enter your SmugMug API credentials to get started. You can get an API key at{' '}
          <a href="https://api.smugmug.com/api/developer/apply" target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent-primary)' }}>
            api.smugmug.com
          </a>
        </p>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--color-danger)', marginBottom: 'var(--space-6)', maxWidth: 480 }}>
          <div style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}>
            ⚠️ {error}
          </div>
        </div>
      )}

      {!pendingAuth ? (
        /* Step 1: Enter API Credentials */
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-header">
            <h3 className="card-title">API Credentials</h3>
            <span className="badge badge-info">Step 1</span>
          </div>

          <div className="flex flex-col gap-4">
            <div className="input-group">
              <label className="input-label" htmlFor="input-consumer-key">API Key (Consumer Key)</label>
              <input
                id="input-consumer-key"
                className="input"
                type="text"
                placeholder="Your SmugMug API key..."
                value={consumerKey}
                onChange={e => setConsumerKey(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="input-consumer-secret">API Secret (Consumer Secret)</label>
              <input
                id="input-consumer-secret"
                className="input"
                type="password"
                placeholder="Your SmugMug API secret..."
                value={consumerSecret}
                onChange={e => setConsumerSecret(e.target.value)}
                disabled={loading}
              />
            </div>

            <button
              className="btn btn-primary btn-lg"
              onClick={handleConnect}
              disabled={loading || !consumerKey.trim() || !consumerSecret.trim()}
              id="btn-connect"
              style={{ marginTop: 'var(--space-2)' }}
            >
              {loading ? <span className="spinner" /> : '🔗'}
              Connect to SmugMug
            </button>
          </div>
        </div>
      ) : (
        /* Step 2: Enter Verification Code */
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-header">
            <h3 className="card-title">Verify Connection</h3>
            <span className="badge badge-warning">Step 2</span>
          </div>

          <p className="text-muted" style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-sm)' }}>
            A browser window should have opened. Authorize the app on SmugMug, then enter the 6-digit verification code below.
          </p>

          <div className="flex flex-col gap-4">
            <div className="input-group">
              <label className="input-label" htmlFor="input-verifier">Verification Code</label>
              <input
                id="input-verifier"
                className="input"
                type="text"
                placeholder="Enter 6-digit code..."
                value={verifier}
                onChange={e => setVerifier(e.target.value)}
                disabled={loading}
                maxLength={6}
                style={{ letterSpacing: '0.3em', fontSize: 'var(--font-size-xl)', textAlign: 'center' }}
              />
            </div>

            <div className="flex gap-3">
              <button
                className="btn btn-primary btn-lg"
                onClick={handleVerify}
                disabled={loading || !verifier.trim()}
                id="btn-verify"
                style={{ flex: 1 }}
              >
                {loading ? <span className="spinner" /> : '✓'}
                Verify
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => { setPendingAuth(null); setVerifier(''); }}
                disabled={loading}
                id="btn-back"
              >
                Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
