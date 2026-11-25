// ============================================================
// Settings Page — Preferences, Stats, Maintenance
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  mergeKeywords,
  PERSON_PREFIX,
  sanitizeKeywordPrefix,
  type DatabaseStats,
  type KeywordFormatMode,
  type Person,
} from '../../shared/types';
import { useToast } from '../components/Toast';

export function SettingsPage() {
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [threshold, setThreshold] = useState(0.6);
  const [keywordFormat, setKeywordFormat] = useState<KeywordFormatMode>('prefixed');
  const [keywordPrefix, setKeywordPrefix] = useState(PERSON_PREFIX);
  const [autoSaveTagManifest, setAutoSaveTagManifest] = useState(true);
  const [autoPurgeMediumCache, setAutoPurgeMediumCache] = useState(false);
  const [allowPublicUploads, setAllowPublicUploads] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [togglingPersonId, setTogglingPersonId] = useState<number | null>(null);
  const [forgettingPersonId, setForgettingPersonId] = useState<number | null>(null);
  const [removeFromSmugMug, setRemoveFromSmugMug] = useState(false);
  const [forgettingBusy, setForgettingBusy] = useState(false);
  const [savingKeywords, setSavingKeywords] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    loadStats();
    loadSettings();
    loadPeople();
  }, []);

  async function loadSettings() {
    try {
      const current = await window.electronAPI.settings.get();
      setThreshold(current.recognitionThreshold);
      setKeywordFormat(current.keywordFormat);
      setKeywordPrefix(current.keywordPrefix);
      setAutoSaveTagManifest(current.autoSaveTagManifest);
      setAutoPurgeMediumCache(Boolean(current.autoPurgeMediumCache));
      setAllowPublicUploads(Boolean(current.allowPublicUploads));
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  async function loadPeople() {
    setPeopleLoading(true);
    try {
      const list = await window.electronAPI.faces.getPeople();
      setPeople(list);
    } catch (err) {
      console.error('Failed to load people:', err);
      showToast('Failed to load trained people', 'error');
    } finally {
      setPeopleLoading(false);
    }
  }

  async function handleThresholdChange(nextThreshold: number) {
    setThreshold(nextThreshold);
    try {
      await window.electronAPI.settings.update({ recognitionThreshold: nextThreshold });
    } catch (err) {
      console.error('Failed to update threshold:', err);
    }
  }

  async function handleSaveKeywordSettings() {
    setSavingKeywords(true);
    const sanitizedPrefix = sanitizeKeywordPrefix(keywordPrefix);
    try {
      await window.electronAPI.settings.update({
        keywordFormat,
        keywordPrefix: sanitizedPrefix,
      });
      setKeywordPrefix(sanitizedPrefix);
      showToast('Keyword format settings saved', 'success');
    } catch (err) {
      console.error('Failed to save keyword settings:', err);
      showToast('Failed to save keyword format settings', 'error');
    } finally {
      setSavingKeywords(false);
    }
  }

  async function handleToggleAutoSaveManifest(enabled: boolean) {
    setAutoSaveTagManifest(enabled);
    try {
      await window.electronAPI.settings.update({ autoSaveTagManifest: enabled });
      showToast(
        enabled ? 'Auto-save tags.json enabled' : 'Auto-save tags.json disabled',
        'success'
      );
    } catch (err) {
      console.error('Failed to update auto-save manifest setting:', err);
      setAutoSaveTagManifest(!enabled);
      showToast('Failed to update auto-save setting', 'error');
    }
  }

  async function handleToggleAutoPurgeMedium(enabled: boolean) {
    setAutoPurgeMediumCache(enabled);
    try {
      await window.electronAPI.settings.update({ autoPurgeMediumCache: enabled });
      showToast(
        enabled
          ? 'Auto-purge medium-res cache enabled'
          : 'Auto-purge medium-res cache disabled',
        'success'
      );
    } catch (err) {
      console.error('Failed to update auto-purge setting:', err);
      setAutoPurgeMediumCache(!enabled);
      showToast('Failed to update medium cache setting', 'error');
    }
  }

  async function handleToggleAllowPublicUploads(enabled: boolean) {
    setAllowPublicUploads(enabled);
    try {
      await window.electronAPI.settings.update({ allowPublicUploads: enabled });
      showToast(
        enabled
          ? 'Public/Unlisted uploads allowed without extra warning'
          : 'Public/Unlisted upload confirmation enabled',
        enabled ? 'warning' : 'success'
      );
    } catch (err) {
      console.error('Failed to update public uploads setting:', err);
      setAllowPublicUploads(!enabled);
      showToast('Failed to update public upload setting', 'error');
    }
  }

  async function handleTogglePersonLocalOnly(person: Person) {
    const nextLocalOnly = !person.localOnly;
    setTogglingPersonId(person.id);
    try {
      await window.electronAPI.faces.setPersonLocalOnly(person.id, nextLocalOnly);
      setPeople(prev =>
        prev.map(p => (p.id === person.id ? { ...p, localOnly: nextLocalOnly } : p))
      );
      showToast(
        nextLocalOnly
          ? `${person.name} marked as local-only (excluded from uploads)`
          : `${person.name} allowed in SmugMug uploads`,
        'info'
      );
    } catch (err) {
      console.error('Failed to toggle person local-only:', err);
      showToast(`Failed to update privacy for ${person.name}`, 'error');
    } finally {
      setTogglingPersonId(null);
    }
  }

  async function handleConfirmForgetPerson(person: Person) {
    setForgettingBusy(true);
    try {
      const res = await window.electronAPI.faces.forgetPerson(person.id, removeFromSmugMug);
      setForgettingPersonId(null);
      setRemoveFromSmugMug(false);
      await Promise.all([loadPeople(), loadStats()]);
      const remoteNote = removeFromSmugMug
        ? `, ${res.removedRemote} SmugMug photo${res.removedRemote === 1 ? '' : 's'}`
        : '';
      showToast(
        `Forgot ${person.name} (removed from ${res.removedLocal} local photo${res.removedLocal === 1 ? '' : 's'}${remoteNote})`,
        'success',
        6000
      );
    } catch (err) {
      console.error('Failed to forget person:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Failed to forget ${person.name}: ${msg}`, 'error');
    } finally {
      setForgettingBusy(false);
    }
  }

  async function handleExportManifest() {
    setExportBusy(true);
    try {
      const res = await window.electronAPI.tags.exportManifest();
      if (!res.canceled) {
        showToast(`Exported ${res.count} tags to ${res.filePath}`, 'success');
      }
    } catch (err) {
      console.error('Failed to export JSON manifest:', err);
      showToast('Failed to export JSON manifest', 'error');
    } finally {
      setExportBusy(false);
    }
  }

  async function handleImportManifest() {
    setExportBusy(true);
    try {
      const res = await window.electronAPI.tags.importManifest();
      if (!res.canceled) {
        loadStats();
        loadPeople();
        showToast(
          `Imported ${res.importedCount} tags (${res.skippedCount} skipped)`,
          'success'
        );
      }
    } catch (err) {
      console.error('Failed to import JSON manifest:', err);
      showToast('Failed to import JSON manifest', 'error');
    } finally {
      setExportBusy(false);
    }
  }

  async function handleExportCsv() {
    setExportBusy(true);
    try {
      const res = await window.electronAPI.tags.exportCsv();
      if (!res.canceled) {
        showToast(`Exported ${res.count} tag rows to CSV`, 'success');
      }
    } catch (err) {
      console.error('Failed to export CSV:', err);
      showToast('Failed to export CSV', 'error');
    } finally {
      setExportBusy(false);
    }
  }

  async function handleExportXmp() {
    setExportBusy(true);
    try {
      const res = await window.electronAPI.tags.exportXmp();
      if (!res.canceled) {
        showToast(`Exported ${res.count} XMP sidecar files`, 'success');
      }
    } catch (err) {
      console.error('Failed to export XMP sidecars:', err);
      showToast('Failed to export XMP sidecars', 'error');
    } finally {
      setExportBusy(false);
    }
  }

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
      await Promise.all([loadStats(), loadPeople()]);
      showToast('Cleared training data and local image tags', 'success');
    } catch (err) {
      console.error('Failed to clear training data:', err);
      showToast('Failed to clear training data', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetDatabase() {
    setLoading(true);
    try {
      await window.electronAPI.settings.resetDatabase();
      setConfirmReset(false);
      await Promise.all([loadStats(), loadPeople()]);
      showToast('Database and local caches reset', 'success');
    } catch (err) {
      console.error('Failed to reset database:', err);
      showToast('Failed to reset database', 'error');
    } finally {
      setLoading(false);
    }
  }

  const previewKeywords = mergeKeywords('vacation; hawaii', ['Jane Smith', 'John Doe'], {
    mode: keywordFormat,
    prefix: keywordPrefix,
  });

  const activeFormatExample =
    keywordFormat === 'plain' ? 'Name' : `${sanitizeKeywordPrefix(keywordPrefix)}Name`;

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
                onChange={e => handleThresholdChange(parseFloat(e.target.value))}
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

        {/* SmugMug Keyword Format */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">SmugMug Keyword Format</h3>
          </div>

          <div className="flex flex-col gap-4">
            <div className="input-group">
              <span className="input-label">Keyword Style</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  id="btn-format-prefixed"
                  className={`btn btn-sm ${keywordFormat === 'prefixed' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setKeywordFormat('prefixed')}
                >
                  Prefixed ({PERSON_PREFIX}Name)
                </button>
                <button
                  type="button"
                  id="btn-format-plain"
                  className={`btn btn-sm ${keywordFormat === 'plain' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setKeywordFormat('plain')}
                >
                  Plain Name (Name)
                </button>
              </div>
            </div>

            {keywordFormat === 'prefixed' && (
              <div className="input-group">
                <label className="input-label" htmlFor="input-keyword-prefix">
                  Keyword Prefix
                </label>
                <input
                  id="input-keyword-prefix"
                  type="text"
                  className="input"
                  value={keywordPrefix}
                  placeholder={PERSON_PREFIX}
                  onChange={e => setKeywordPrefix(e.target.value)}
                />
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                  Semicolons are removed automatically; leaving this blank resets to{' '}
                  <code>{PERSON_PREFIX}</code>.
                </p>
              </div>
            )}

            <div className="input-group">
              <span className="input-label">Live Preview</span>
              <div
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <code style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-accent-primary)' }}>
                  {previewKeywords}
                </code>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                id="btn-save-keyword-settings"
                className="btn btn-primary btn-sm"
                onClick={handleSaveKeywordSettings}
                disabled={savingKeywords}
              >
                {savingKeywords ? 'Saving...' : 'Save Keyword Format'}
              </button>
            </div>
          </div>
        </div>

        {/* Local Tag Backup & Exports */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Local Tag Backup &amp; Exports</h3>
          </div>

          <div className="flex flex-col gap-4">
            <label
              htmlFor="toggle-auto-save-manifest"
              className="flex items-center gap-3"
              style={{ cursor: 'pointer' }}
            >
              <input
                id="toggle-auto-save-manifest"
                type="checkbox"
                checked={autoSaveTagManifest}
                onChange={e => handleToggleAutoSaveManifest(e.target.checked)}
                style={{ accentColor: 'var(--color-accent-primary)', width: 16, height: 16 }}
              />
              <span className="input-label">
                Auto-save local <code>tags.json</code> manifest on tag updates
              </span>
            </label>

            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
              Export tags to a portable <code>tags.json</code> backup (with re-import support),
              flat CSV for spreadsheet review, or XMP sidecars with MWG face bounding boxes for
              Lightroom, DigiKam, and Darktable.
            </p>

            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                id="btn-export-json"
                className="btn btn-secondary btn-sm"
                onClick={handleExportManifest}
                disabled={exportBusy}
              >
                Export JSON
              </button>
              <button
                type="button"
                id="btn-import-json"
                className="btn btn-secondary btn-sm"
                onClick={handleImportManifest}
                disabled={exportBusy}
              >
                Import JSON
              </button>
              <button
                type="button"
                id="btn-export-csv"
                className="btn btn-secondary btn-sm"
                onClick={handleExportCsv}
                disabled={exportBusy}
              >
                Export CSV
              </button>
              <button
                type="button"
                id="btn-export-xmp"
                className="btn btn-secondary btn-sm"
                onClick={handleExportXmp}
                disabled={exportBusy}
              >
                Export XMP Sidecars
              </button>
            </div>
          </div>
        </div>

        {/* Privacy & Cache */}
        <div className="card" id="card-privacy-cache">
          <div className="card-header">
            <h3 className="card-title">Privacy &amp; Cache</h3>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="toggle-auto-purge-medium"
                className="flex items-center gap-3"
                style={{ cursor: 'pointer' }}
              >
                <input
                  id="toggle-auto-purge-medium"
                  type="checkbox"
                  checked={autoPurgeMediumCache}
                  onChange={e => handleToggleAutoPurgeMedium(e.target.checked)}
                  style={{ accentColor: 'var(--color-accent-primary)', width: 16, height: 16 }}
                />
                <span className="input-label">
                  Auto-purge medium-res (~800px) cache after face scanning
                </span>
              </label>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-1)', marginLeft: 28 }}>
                Deletes temporary medium-res photos from disk after face embeddings are saved locally.
              </p>
            </div>

            <div>
              <label
                htmlFor="toggle-allow-public-uploads"
                className="flex items-center gap-3"
                style={{ cursor: 'pointer' }}
              >
                <input
                  id="toggle-allow-public-uploads"
                  type="checkbox"
                  checked={allowPublicUploads}
                  onChange={e => handleToggleAllowPublicUploads(e.target.checked)}
                  style={{ accentColor: 'var(--color-warning)', width: 16, height: 16 }}
                />
                <span className="input-label">
                  Allow uploads to Public/Unlisted albums without extra warning (not recommended)
                </span>
              </label>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-1)', marginLeft: 28 }}>
                When unchecked, uploading to Public or Unlisted galleries requires explicit confirmation in the upload preview.
              </p>
            </div>
          </div>
        </div>

        {/* People & Privacy */}
        <div className="card" id="card-people-privacy">
          <div className="card-header">
            <h3 className="card-title">People &amp; Privacy</h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={loadPeople}
              disabled={peopleLoading}
              id="btn-refresh-people"
            >
              {peopleLoading ? 'Loading...' : '🔄 Refresh'}
            </button>
          </div>

          {peopleLoading && people.length === 0 ? (
            <div className="flex items-center gap-3">
              <div className="spinner" />
              <span className="text-muted">Loading trained people...</span>
            </div>
          ) : people.length === 0 ? (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}>
              No trained people yet. Label faces in the Face Trainer to manage local-only status or forget people.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {people.map(person => {
                const isForgetting = forgettingPersonId === person.id;
                return (
                  <div
                    key={person.id}
                    id={`person-privacy-row-${person.id}`}
                    style={{
                      padding: 'var(--space-3) var(--space-4)',
                      background: 'var(--color-bg-tertiary)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <div className="flex justify-between items-center" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
                            {person.name}
                          </span>
                          {person.localOnly && (
                            <span className="badge badge-info" style={{ padding: '1px 8px', fontSize: '11px' }}>
                              Local-only
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                          {person.descriptorCount} sample{person.descriptorCount === 1 ? '' : 's'}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <label
                          htmlFor={`toggle-person-local-${person.id}`}
                          className="flex items-center gap-2"
                          style={{ cursor: 'pointer', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}
                        >
                          <input
                            id={`toggle-person-local-${person.id}`}
                            type="checkbox"
                            checked={Boolean(person.localOnly)}
                            disabled={togglingPersonId === person.id || forgettingBusy}
                            onChange={() => handleTogglePersonLocalOnly(person)}
                            style={{ accentColor: 'var(--color-info)', width: 14, height: 14 }}
                          />
                          Local-only
                        </label>

                        {!isForgetting && (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            id={`btn-forget-person-${person.id}`}
                            onClick={() => {
                              setForgettingPersonId(person.id);
                              setRemoveFromSmugMug(false);
                            }}
                            disabled={forgettingBusy}
                          >
                            Forget Person
                          </button>
                        )}
                      </div>
                    </div>

                    {isForgetting && (
                      <div
                        id={`confirm-forget-panel-${person.id}`}
                        style={{
                          marginTop: 'var(--space-3)',
                          paddingTop: 'var(--space-3)',
                          borderTop: '1px solid var(--color-border)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 'var(--space-3)',
                        }}
                      >
                        <label
                          htmlFor={`checkbox-forget-remote-${person.id}`}
                          className="flex items-center gap-2"
                          style={{ cursor: 'pointer', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}
                        >
                          <input
                            id={`checkbox-forget-remote-${person.id}`}
                            type="checkbox"
                            checked={removeFromSmugMug}
                            onChange={e => setRemoveFromSmugMug(e.target.checked)}
                            disabled={forgettingBusy}
                            style={{ accentColor: 'var(--color-danger)', width: 14, height: 14 }}
                          />
                          Also remove from SmugMug keywords
                        </label>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            id={`btn-confirm-forget-${person.id}`}
                            onClick={() => handleConfirmForgetPerson(person)}
                            disabled={forgettingBusy}
                          >
                            {forgettingBusy ? 'Forgetting...' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            id={`btn-cancel-forget-${person.id}`}
                            onClick={() => {
                              setForgettingPersonId(null);
                              setRemoveFromSmugMug(false);
                            }}
                            disabled={forgettingBusy}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
                  Clears all people, face descriptors, and local image tags (and updates{' '}
                  <code>tags.json</code>). Albums and downloaded images are kept.
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
                  Deletes all DB tables plus cached thumbnails, medium images,{' '}
                  <code>tags.json</code>, and exports.
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
            Keywords are stored as <code style={{ color: 'var(--color-accent-primary)' }}>{activeFormatExample}</code> on SmugMug.
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
