// ============================================================
// Settings Page — Preferences, Stats, Maintenance
// ============================================================

import React, { useState, useEffect } from 'react';
import type { DatabaseStats } from '../../shared/types';

export function SettingsPage() {
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [threshold, setThreshold] = useState(0.6);
  const [loading, setLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const data = await window.electronAPI.settings.getStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }

  async function handleClearTraining() {
    setLoading(true);
    try {
      await window.electronAPI.settings.clearTrainingData();
      setConfirmClear(false);
      loadStats();
    } catch (err) {
      console.error('Failed to clear training data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetDatabase() {
    setLoading(true);
    try {
      await window.electronAPI.settings.resetDatabase();
      setConfirmReset(false);
      loadStats();
    } catch (err) {
      console.error('Failed to reset database:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page" id="page-settings">
      <div className="page-header">
        <h2 className="page-title">Settings</h2>
        <p className="page-description">Configure recognition settings and manage your data.</p>
      </div>

      <div className="flex flex-col gap-6" style={{ maxWidth: 640 }}>
        {/* Recognition Settings */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recognition Settings</h3>
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="input-threshold">
              Confidence Threshold: {threshold.toFixed(2)}
            </label>
            <div className="flex items-center gap-4">
              <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>Strict (0.4)</span>
              <input
                id="input-threshold"
                type="range"
                min="0.4"
                max="0.8"
                step="0.05"
                value={threshold}
                onChange={e => setThreshold(parseFloat(e.target.value))}
                style={{
                  flex: 1,
                  height: 4,
                  accentColor: 'var(--color-accent-primary)',
                }}
              />
              <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>Loose (0.8)</span>
            </div>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-2)' }}>
              Lower values require closer matches (more precise, fewer false positives).
              Higher values are more lenient (more matches, but may misidentify).
            </p>
          </div>
        </div>

        {/* Database Statistics */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Database Statistics</h3>
            <button className="btn btn-ghost btn-sm" onClick={loadStats} id="btn-refresh-stats">
              🔄 Refresh
            </button>
          </div>

          {stats ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 'var(--space-4)',
            }}>
              <StatItem label="Albums" value={stats.albumCount} icon="📁" />
              <StatItem label="Total Photos" value={stats.imageCount} icon="📷" />
              <StatItem label="Thumbnails Downloaded" value={stats.downloadedThumbs} icon="🖼️" />
              <StatItem label="Medium Downloaded" value={stats.downloadedMedium} icon="📐" />
              <StatItem label="Faces Scanned" value={stats.facesDetected} icon="🔍" />
              <StatItem label="People Identified" value={stats.peopleCount} icon="👤" />
              <StatItem label="Training Samples" value={stats.descriptorCount} icon="🧬" />
              <StatItem label="Photos Tagged" value={stats.taggedImages} icon="🏷️" />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="spinner" />
              <span className="text-muted">Loading statistics...</span>
            </div>
          )}
        </div>

        {/* Danger Zone */}
        <div className="card" style={{ borderColor: 'rgba(239, 68, 68, 0.2)' }}>
          <div className="card-header">
            <h3 className="card-title" style={{ color: 'var(--color-danger)' }}>⚠️ Danger Zone</h3>
          </div>

          <div className="flex flex-col gap-4">
            {/* Clear Training Data */}
            <div className="flex justify-between items-center">
              <div>
                <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>Clear Training Data</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                  Removes all people and face descriptors. Albums and images are kept.
                </div>
              </div>
              {confirmClear ? (
                <div className="flex gap-2">
                  <button className="btn btn-danger btn-sm" onClick={handleClearTraining} disabled={loading} id="btn-confirm-clear">
                    Confirm
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)} id="btn-cancel-clear">
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="btn btn-danger btn-sm" onClick={() => setConfirmClear(true)} id="btn-clear-training">
                  Clear
                </button>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)' }} />

            {/* Reset Database */}
            <div className="flex justify-between items-center">
              <div>
                <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>Reset Entire Database</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                  Deletes ALL data — albums, images, people, and training data.
                </div>
              </div>
              {confirmReset ? (
                <div className="flex gap-2">
                  <button className="btn btn-danger btn-sm" onClick={handleResetDatabase} disabled={loading} id="btn-confirm-reset">
                    Confirm
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(false)} id="btn-cancel-reset">
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="btn btn-danger btn-sm" onClick={() => setConfirmReset(true)} id="btn-reset-db">
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        {/* About */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">About</h3>
          </div>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            SmugMug Face Tagger v1.0.0
          </p>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-2)' }}>
            Automatically tag people in your SmugMug photos using face recognition.
            Keywords are stored as <code style={{ color: 'var(--color-accent-primary)' }}>Person:Name</code> on SmugMug.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatItem({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div style={{
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--color-bg-tertiary)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
    }}>
      <span style={{ fontSize: 'var(--font-size-lg)' }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 'var(--font-size-xl)' }}>
          {value.toLocaleString()}
        </div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
          {label}
        </div>
      </div>
    </div>
  );
}
