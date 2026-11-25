// ============================================================
// Auto-Tagger — Review & Upload Face Tags
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  mergeKeywords,
  type AlbumPrivacy,
  type AlbumRecord,
  type ImageRecord,
  type KeywordDiffPreview,
  type TagUploadProgress,
  type UploadTagsResult,
} from '../../shared/types';
import { VirtualList } from '../components/VirtualList';
import { useToast } from '../components/Toast';

const ROW_HEIGHT = 72;
const LIST_HEIGHT = 500;

function getPrivacyBadgeProps(privacy: AlbumPrivacy): {
  className: string;
  style?: React.CSSProperties;
} {
  switch (privacy) {
    case 'Public':
      return { className: 'badge badge-warning' };
    case 'Unlisted':
      return {
        className: 'badge',
        style: {
          background: 'var(--color-accent-glow)',
          color: 'var(--color-accent-primary)',
          border: '1px solid rgba(99, 102, 241, 0.3)',
        },
      };
    case 'Private':
      return { className: 'badge badge-success' };
    case 'Unknown':
    default:
      return {
        className: 'badge',
        style: {
          background: 'var(--color-bg-tertiary)',
          color: 'var(--color-text-secondary)',
        },
      };
  }
}

export function AutoTagger() {
  const [results, setResults] = useState<ImageRecord[]>([]);
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<TagUploadProgress | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previews, setPreviews] = useState<KeywordDiffPreview[]>([]);
  const [allowPublicSetting, setAllowPublicSetting] = useState(false);
  const [confirmPublicChecked, setConfirmPublicChecked] = useState(false);
  const { showToast } = useToast();

  const albumMap = useMemo(() => new Map(albums.map(a => [a.albumKey, a])), [albums]);

  const loadResults = useCallback(async () => {
    setLoading(true);
    try {
      const [data, albumList, currentSettings] = await Promise.all([
        window.electronAPI.tags.getUntaggedResults(),
        window.electronAPI.albums.getAll(),
        window.electronAPI.settings.get(),
      ]);
      setResults(data);
      setAlbums(albumList);
      setAllowPublicSetting(Boolean(currentSettings.allowPublicUploads));
      // Auto-select high confidence matches
      const highConfidence = new Set<string>();
      data.forEach(img => {
        if (img.detectedPeople?.every(p => p.confidence > 0.7)) {
          highConfidence.add(img.imageKey);
        }
      });
      setSelectedKeys(highConfidence);
    } catch (err) {
      console.error('Failed to load tagger results:', err);
      showToast('Failed to load tagging results', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadResults();

    const unsubscribe = window.electronAPI.tags.onUploadProgress((progress) => {
      setUploadProgress(progress);
      if (progress.completed === progress.total) {
        setTimeout(() => {
          setUploadProgress(null);
        }, 1200);
      }
    });

    return unsubscribe;
  }, [loadResults]);

  async function handleRunAutoTagger() {
    setRunning(true);
    try {
      showToast('Running face recognition — this may take a while…', 'info', 0);
      await window.electronAPI.tags.runAutoTagger();
      await loadResults();
      showToast('Auto-tagging complete! Review matches below.', 'success');
    } catch (err) {
      console.error('Auto-tagger failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Auto-tagger failed: ${msg}`, 'error', 8000);
    } finally {
      setRunning(false);
    }
  }

  function toggleSelection(imageKey: string) {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(imageKey)) {
        next.delete(imageKey);
      } else {
        next.add(imageKey);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedKeys(new Set(results.map(r => r.imageKey)));
  }

  function selectHighConfidence() {
    const highConf = new Set<string>();
    results.forEach(img => {
      if (img.detectedPeople?.every(p => p.confidence > 0.7)) {
        highConf.add(img.imageKey);
      }
    });
    setSelectedKeys(highConf);
  }

  function selectNone() {
    setSelectedKeys(new Set());
  }

  async function handleOpenUploadPreview() {
    if (selectedKeys.size === 0) return;
    const keys = Array.from(selectedKeys);
    setPreviewOpen(true);
    setPreviewLoading(true);
    setConfirmPublicChecked(false);
    try {
      const [rawPreviews, currentSettings, people] = await Promise.all([
        window.electronAPI.tags.previewUpload(keys),
        window.electronAPI.settings.get(),
        window.electronAPI.faces.getPeople(),
      ]);
      setAllowPublicSetting(Boolean(currentSettings.allowPublicUploads));

      const peopleByName = new Map(people.map(p => [p.name, p]));
      const resultsByKey = new Map(results.map(r => [r.imageKey, r]));
      const knownPeopleNames =
        currentSettings.keywordFormat === 'plain' ? people.map(p => p.name) : [];

      // If matches haven't been approved yet in DB, project the keyword diff from detectedPeople
      const resolvedPreviews = rawPreviews.map((preview) => {
        const img = resultsByKey.get(preview.imageKey);
        const pendingNames = Array.from(
          new Set((img?.detectedPeople ?? []).map(p => p.personName))
        );
        if (
          preview.afterKeywords === preview.beforeKeywords &&
          preview.skippedPeople.length === 0 &&
          !preview.localOnly &&
          pendingNames.length > 0
        ) {
          const skippedPeople = pendingNames.filter(name => Boolean(peopleByName.get(name)?.localOnly));
          const uploadableNames = pendingNames.filter(name => !peopleByName.get(name)?.localOnly);
          const isLocalOnly = uploadableNames.length === 0;
          const afterKeywords = isLocalOnly
            ? preview.beforeKeywords
            : mergeKeywords(preview.beforeKeywords, uploadableNames, {
                mode: currentSettings.keywordFormat,
                prefix: currentSettings.keywordPrefix,
                previousPersonNames:
                  currentSettings.keywordFormat === 'plain' ? knownPeopleNames : undefined,
              });
          return {
            ...preview,
            afterKeywords,
            localOnly: isLocalOnly,
            skippedPeople,
          };
        }
        return preview;
      });

      setPreviews(resolvedPreviews);
    } catch (err) {
      console.error('Failed to preview upload:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Preview failed: ${msg}`, 'error');
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleConfirmUpload() {
    if (selectedKeys.size === 0) return;
    const keys = Array.from(selectedKeys);
    setUploading(true);
    try {
      const selectedImages = results.filter(img => selectedKeys.has(img.imageKey));
      for (const img of selectedImages) {
        if (img.detectedPeople && img.detectedPeople.length > 0) {
          const uniqueNames = Array.from(new Set(img.detectedPeople.map(p => p.personName)));
          await window.electronAPI.tags.approveMatches(img.imageKey, uniqueNames);
        }
      }

      const allowPublic = hasPublicOrUnlistedTarget
        ? allowPublicSetting || confirmPublicChecked
        : allowPublicSetting;

      const uploadResult: UploadTagsResult = await window.electronAPI.tags.uploadTags(keys, {
        allowPublic,
      });

      setPreviewOpen(false);
      await loadResults();

      const summaryParts = [
        `Uploaded ${uploadResult.uploaded} photo${uploadResult.uploaded === 1 ? '' : 's'}`,
      ];
      if (uploadResult.skippedPublic > 0) {
        summaryParts.push(`${uploadResult.skippedPublic} skipped (Public/Unlisted)`);
      }
      if (uploadResult.skippedLocalOnly > 0) {
        summaryParts.push(`${uploadResult.skippedLocalOnly} skipped (Local-only)`);
      }
      if (uploadResult.skippedUnapproved > 0) {
        summaryParts.push(`${uploadResult.skippedUnapproved} skipped (Unapproved)`);
      }
      const hasSkipped =
        uploadResult.skippedPublic > 0 ||
        uploadResult.skippedLocalOnly > 0 ||
        uploadResult.skippedUnapproved > 0;
      const toastType =
        uploadResult.uploaded === 0 && hasSkipped
          ? 'warning'
          : hasSkipped
            ? 'info'
            : 'success';
      showToast(summaryParts.join(' · '), toastType, 6000);
    } catch (err) {
      console.error('Failed to upload tags:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Upload failed: ${msg}`, 'error');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function handleExport(kind: 'json' | 'csv' | 'xmp') {
    setExporting(true);
    try {
      if (kind === 'json') {
        const res = await window.electronAPI.tags.exportManifest();
        if (!res.canceled) showToast(`Exported ${res.count} tags to JSON`, 'success');
      } else if (kind === 'csv') {
        const res = await window.electronAPI.tags.exportCsv();
        if (!res.canceled) showToast(`Exported ${res.count} tag rows to CSV`, 'success');
      } else {
        const res = await window.electronAPI.tags.exportXmp();
        if (!res.canceled) showToast(`Exported ${res.count} XMP sidecars`, 'success');
      }
    } catch (err) {
      console.error(`Failed to export ${kind}:`, err);
      showToast(`Failed to export ${kind.toUpperCase()}`, 'error');
    } finally {
      setExporting(false);
    }
  }

  function confidenceColor(confidence: number): string {
    if (confidence >= 0.7) return 'var(--color-success)';
    if (confidence >= 0.5) return 'var(--color-warning)';
    return 'var(--color-danger)';
  }

  const publicOrUnlistedMatched = useMemo(
    () =>
      results.filter(img => {
        const album = albumMap.get(img.albumKey);
        return album?.privacy === 'Public' || album?.privacy === 'Unlisted';
      }),
    [results, albumMap]
  );

  const publicOrUnlistedSelectedCount = useMemo(
    () =>
      publicOrUnlistedMatched.filter(
        img => selectedKeys.has(img.imageKey) && !albumMap.get(img.albumKey)?.localOnly
      ).length,
    [publicOrUnlistedMatched, selectedKeys, albumMap]
  );

  const hasPublicOrUnlistedTarget = useMemo(
    () =>
      previews.some(
        p => !p.localOnly && (p.albumPrivacy === 'Public' || p.albumPrivacy === 'Unlisted')
      ),
    [previews]
  );

  if (loading && results.length === 0) {
    return (
      <div className="page" id="page-tagger">
        <div className="empty-state">
          <div className="spinner spinner-lg" />
          <p className="text-muted mt-4">Loading auto-tag results...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page" id="page-tagger">
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="page-title">Auto-Tagger</h2>
            <p className="page-description">
              {results.length > 0
                ? `${results.length} photos ready · ${selectedKeys.size} selected`
                : 'Run the auto-tagger to match faces to people'}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              className="btn btn-secondary"
              onClick={handleRunAutoTagger}
              disabled={running || uploading}
              id="btn-run-auto-tagger"
            >
              {running ? <span className="spinner" /> : '🤖'}
              {running ? 'Recognizing...' : 'Run Auto-Tagger'}
            </button>

            {results.length > 0 && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={selectHighConfidence} id="btn-select-high">
                  ✓ High Confidence
                </button>
                <button className="btn btn-ghost btn-sm" onClick={selectAll} id="btn-select-all">
                  All
                </button>
                <button className="btn btn-ghost btn-sm" onClick={selectNone} id="btn-select-none">
                  None
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleOpenUploadPreview}
                  disabled={uploading || selectedKeys.size === 0}
                  id="btn-upload-tags"
                >
                  {uploading ? <span className="spinner" /> : '🏷️'}
                  Upload ({selectedKeys.size})
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Public / Unlisted Album Warning Banner */}
      {publicOrUnlistedMatched.length > 0 && (
        <div
          className="card mb-4"
          id="public-album-warning-banner"
          style={{
            borderColor: 'rgba(245, 158, 11, 0.35)',
            background: 'var(--color-warning-bg)',
            padding: 'var(--space-4) var(--space-5)',
          }}
        >
          <div className="flex items-center gap-3">
            <span style={{ fontSize: 'var(--font-size-lg)' }}>⚠️</span>
            <div style={{ fontSize: 'var(--font-size-sm)' }}>
              <strong style={{ color: 'var(--color-warning)' }}>
                Public / Unlisted Gallery Notice:
              </strong>{' '}
              {publicOrUnlistedMatched.length} matched photo
              {publicOrUnlistedMatched.length === 1 ? '' : 's'} belong to{' '}
              <strong>Public</strong> or <strong>Unlisted</strong> albums
              {publicOrUnlistedSelectedCount > 0
                ? ` (${publicOrUnlistedSelectedCount} currently selected for upload)`
                : ''}
              . Uploading will make recognized person names visible on SmugMug unless marked{' '}
              <code>Local-only</code>.
            </div>
          </div>
        </div>
      )}

      {/* Upload Progress */}
      {uploadProgress && (
        <div className="card mb-4" id="upload-progress">
          <div className="flex justify-between items-center mb-4">
            <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
              Uploading tags — {uploadProgress.currentImage}
            </span>
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {uploadProgress.completed} / {uploadProgress.total}
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${(uploadProgress.completed / uploadProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {results.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏷️</div>
          <h3 className="empty-state-title">No Results Yet</h3>
          <p className="empty-state-description">
            First scan albums for faces and label people in the Face Trainer.
            Then click <strong>Run Auto-Tagger</strong> to match faces automatically.
          </p>
          <button
            className="btn btn-primary"
            onClick={handleRunAutoTagger}
            disabled={running}
            id="btn-run-auto-tagger-empty"
            style={{ marginTop: 'var(--space-4)' }}
          >
            {running ? <span className="spinner" /> : '🤖'}
            Run Auto-Tagger
          </button>
        </div>
      ) : (
        <>
          {/* Stats & local export bar */}
          <div className="flex justify-between items-center mb-4" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            <div className="flex gap-4" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              <span>
                🟢 High confidence: {results.filter(r => r.detectedPeople?.every(p => p.confidence >= 0.7)).length}
              </span>
              <span>
                🟡 Medium: {results.filter(r => r.detectedPeople?.some(p => p.confidence >= 0.5 && p.confidence < 0.7)).length}
              </span>
              <span>
                🔴 Low: {results.filter(r => r.detectedPeople?.some(p => p.confidence < 0.5)).length}
              </span>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                id="btn-tagger-export-json"
                onClick={() => handleExport('json')}
                disabled={exporting || uploading}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                id="btn-tagger-export-csv"
                onClick={() => handleExport('csv')}
                disabled={exporting || uploading}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                id="btn-tagger-export-xmp"
                onClick={() => handleExport('xmp')}
                disabled={exporting || uploading}
              >
                Export XMP
              </button>
            </div>
          </div>

          {/* Virtualised results list */}
          <VirtualList
            id="tagger-results-list"
            items={results}
            itemHeight={ROW_HEIGHT}
            containerHeight={LIST_HEIGHT}
            keyExtractor={(img) => img.imageKey}
            renderItem={(img) => (
              <TaggerRow
                img={img}
                album={albumMap.get(img.albumKey)}
                selected={selectedKeys.has(img.imageKey)}
                onToggle={toggleSelection}
                confidenceColor={confidenceColor}
              />
            )}
          />
        </>
      )}

      {/* Preview & Confirm Upload Modal */}
      {previewOpen && (
        <div
          id="upload-preview-modal"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-6)',
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 760,
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--color-bg-secondary)',
              borderColor: 'var(--color-border-hover)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div className="card-header">
              <div>
                <h3 className="card-title">Preview &amp; Confirm Upload</h3>
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  Review SmugMug keyword changes for {selectedKeys.size} selected photo
                  {selectedKeys.size === 1 ? '' : 's'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPreviewOpen(false)}
                disabled={uploading}
                id="btn-close-preview-modal"
              >
                ✕
              </button>
            </div>

            {previewLoading ? (
              <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                <div className="spinner spinner-lg" />
                <p className="text-muted mt-4">Preparing keyword diff preview...</p>
              </div>
            ) : (
              <>
                {hasPublicOrUnlistedTarget && (
                  <div
                    id="modal-public-upload-warning"
                    style={{
                      padding: 'var(--space-4)',
                      marginBottom: 'var(--space-4)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-warning-bg)',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: 'var(--color-warning)', fontSize: 'var(--font-size-sm)' }}>
                      ⚠️ Uploading to Public / Unlisted SmugMug Galleries
                    </div>
                    <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-primary)', marginTop: 'var(--space-1)' }}>
                      One or more selected photos belong to a Public or Unlisted album. Person names
                      written to SmugMug keywords may be visible to anyone with access to the gallery.
                    </p>
                    {!allowPublicSetting ? (
                      <label
                        htmlFor="checkbox-confirm-public-upload"
                        className="flex items-center gap-2 mt-4"
                        style={{ cursor: 'pointer', fontSize: 'var(--font-size-xs)', fontWeight: 500 }}
                      >
                        <input
                          id="checkbox-confirm-public-upload"
                          type="checkbox"
                          checked={confirmPublicChecked}
                          onChange={e => setConfirmPublicChecked(e.target.checked)}
                          disabled={uploading}
                          style={{ accentColor: 'var(--color-warning)', width: 15, height: 15 }}
                        />
                        I understand that uploading writes person names to Public/Unlisted SmugMug galleries
                      </label>
                    ) : (
                      <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)' }}>
                        Note: &quot;Allow uploads to Public/Unlisted albums&quot; is enabled in Settings.
                      </p>
                    )}
                  </div>
                )}

                <div
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)',
                    paddingRight: 'var(--space-1)',
                  }}
                >
                  {previews.map((item) => {
                    const privacyBadge = getPrivacyBadgeProps(item.albumPrivacy);
                    return (
                      <div
                        key={item.imageKey}
                        id={`preview-item-${item.imageKey}`}
                        style={{
                          padding: 'var(--space-3) var(--space-4)',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--color-bg-tertiary)',
                          border: '1px solid var(--color-border)',
                        }}
                      >
                        <div className="flex justify-between items-center" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                          <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
                            {item.filename}
                          </div>
                          <div className="flex items-center gap-2">
                            {item.albumTitle && (
                              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                                {item.albumTitle}
                              </span>
                            )}
                            <span className={privacyBadge.className} style={privacyBadge.style}>
                              {item.albumPrivacy}
                            </span>
                            {item.localOnly && (
                              <span className="badge badge-info">Local-only (will skip)</span>
                            )}
                          </div>
                        </div>

                        {item.skippedPeople.length > 0 && (
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-info)', marginTop: 'var(--space-2)' }}>
                            Skipped local-only people: {item.skippedPeople.join(', ')}
                          </div>
                        )}

                        <div
                          style={{
                            marginTop: 'var(--space-2)',
                            display: 'grid',
                            gridTemplateColumns: '64px 1fr',
                            gap: '4px 8px',
                            fontSize: 'var(--font-size-xs)',
                          }}
                        >
                          <span style={{ color: 'var(--color-text-tertiary)' }}>Before:</span>
                          <code style={{ color: 'var(--color-text-secondary)', wordBreak: 'break-word' }}>
                            {item.beforeKeywords || '(none)'}
                          </code>
                          <span style={{ color: 'var(--color-text-tertiary)' }}>After:</span>
                          <code
                            style={{
                              color: item.localOnly
                                ? 'var(--color-text-tertiary)'
                                : item.afterKeywords !== item.beforeKeywords
                                  ? 'var(--color-success)'
                                  : 'var(--color-text-secondary)',
                              wordBreak: 'break-word',
                            }}
                          >
                            {item.afterKeywords || '(none)'}
                          </code>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="flex justify-between items-center mt-4" style={{ paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                Matches are approved upon confirmation before uploading.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPreviewOpen(false)}
                  disabled={uploading}
                  id="btn-cancel-upload-preview"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleConfirmUpload}
                  disabled={
                    previewLoading ||
                    uploading ||
                    (hasPublicOrUnlistedTarget && !allowPublicSetting && !confirmPublicChecked)
                  }
                  id="btn-confirm-upload"
                >
                  {uploading ? <span className="spinner" /> : '✓'}
                  {uploading ? 'Uploading...' : 'Confirm Upload'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------
// Row component — memoised to avoid re-renders
// -----------------------------------------------------------

interface TaggerRowProps {
  img: ImageRecord;
  album?: AlbumRecord;
  selected: boolean;
  onToggle: (key: string) => void;
  confidenceColor: (c: number) => string;
}

const TaggerRow = React.memo(function TaggerRow({
  img,
  album,
  selected,
  onToggle,
  confidenceColor,
}: TaggerRowProps) {
  const privacyBadge = album?.privacy ? getPrivacyBadgeProps(album.privacy) : null;

  return (
    <div
      className="card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: '0 var(--space-5)',
        height: 64,
        margin: '4px 0',
        cursor: 'pointer',
        borderColor: selected ? 'var(--color-accent-primary)' : undefined,
        background: selected ? 'var(--color-accent-glow)' : undefined,
        transition: 'background 0.1s, border-color 0.1s',
      }}
      onClick={() => onToggle(img.imageKey)}
      id={`tagger-row-${img.imageKey}`}
    >
      {/* Checkbox */}
      <div style={{
        width: 20,
        height: 20,
        borderRadius: 'var(--radius-sm)',
        border: `2px solid ${selected ? 'var(--color-accent-primary)' : 'var(--color-border)'}`,
        background: selected ? 'var(--color-accent-primary)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        color: 'white',
        flexShrink: 0,
        transition: 'background 0.15s, border-color 0.15s',
      }}>
        {selected && '✓'}
      </div>

      {/* Thumbnail */}
      <div style={{
        width: 48,
        height: 48,
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg-tertiary)',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        {img.thumbPath && (
          <img
            src={`file://${img.thumbPath}`}
            alt={img.filename}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </div>

      {/* Filename + face count + album privacy */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {img.filename}
        </div>
        <div className="flex items-center gap-2" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', overflow: 'hidden' }}>
          <span style={{ whiteSpace: 'nowrap' }}>
            {img.faceCount} face{img.faceCount !== 1 ? 's' : ''} detected
          </span>
          {album && (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              · {album.title}
            </span>
          )}
          {privacyBadge && album?.privacy && (
            <span
              className={privacyBadge.className}
              style={{ ...privacyBadge.style, padding: '1px 6px', fontSize: '10px' }}
            >
              {album.privacy}
            </span>
          )}
          {album?.localOnly && (
            <span
              className="badge badge-info"
              style={{ padding: '1px 6px', fontSize: '10px' }}
            >
              Local-only
            </span>
          )}
        </div>
      </div>

      {/* Matched people badges */}
      <div className="flex gap-2" style={{ flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 280 }}>
        {img.detectedPeople?.map((match, i) => (
          <span
            key={i}
            className="badge"
            style={{
              background: `${confidenceColor(match.confidence)}15`,
              color: confidenceColor(match.confidence),
              border: `1px solid ${confidenceColor(match.confidence)}30`,
              fontSize: 'var(--font-size-xs)',
            }}
          >
            {match.personName} {Math.round(match.confidence * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
});
