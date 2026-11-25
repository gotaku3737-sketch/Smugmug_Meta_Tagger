// ============================================================
// Gallery Browser — Browse & Download Albums
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import type {
  AlbumPrivacy,
  AlbumRecord,
  DownloadProgress,
  FaceDetectionProgress,
} from '../../shared/types';
import { useToast } from '../components/Toast';

interface GalleryBrowserProps {
  onOpenTrainer: (albumKey: string) => void;
}

type AlbumStatus = 'downloading' | 'scanning' | null;

function getPrivacyBadgeProps(privacy: AlbumPrivacy): {
  className: string;
  style?: React.CSSProperties;
  icon: string;
} {
  switch (privacy) {
    case 'Public':
      return { className: 'badge badge-warning', icon: '🌐' };
    case 'Unlisted':
      return {
        className: 'badge',
        style: {
          background: 'var(--color-accent-glow)',
          color: 'var(--color-accent-primary)',
          border: '1px solid rgba(99, 102, 241, 0.3)',
        },
        icon: '🔗',
      };
    case 'Private':
      return { className: 'badge badge-success', icon: '🔒' };
    case 'Unknown':
    default:
      return {
        className: 'badge',
        style: {
          background: 'var(--color-bg-tertiary)',
          color: 'var(--color-text-secondary)',
        },
        icon: '❓',
      };
  }
}

export function GalleryBrowser({ onOpenTrainer }: GalleryBrowserProps) {
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [scanProgress, setScanProgress] = useState<FaceDetectionProgress | null>(null);
  const [activeAlbum, setActiveAlbum] = useState<{ key: string; status: AlbumStatus } | null>(null);
  const [refreshingAlbumKey, setRefreshingAlbumKey] = useState<string | null>(null);
  const [togglingLocalKey, setTogglingLocalKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    loadAlbums();

    const unsubDownload = window.electronAPI.photos.onDownloadProgress((progress) => {
      setDownloadProgress(progress);
      if (progress.completed === progress.total) {
        setTimeout(() => {
          setDownloadProgress(null);
          setActiveAlbum(prev => prev ? { ...prev, status: null } : null);
          loadAlbums();
        }, 800);
      }
    });

    const unsubFaces = window.electronAPI.faces.onDetectionProgress((progress) => {
      setScanProgress(progress);
      if (progress.completed === progress.total) {
        setTimeout(() => {
          setScanProgress(null);
          setActiveAlbum(null);
          loadAlbums();
          showToast(
            `Face scan complete — found ${progress.facesFound} faces across ${progress.total} photos`,
            'success'
          );
        }, 800);
      }
    });

    return () => {
      unsubDownload();
      unsubFaces();
    };
  }, []);

  const loadAlbums = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.albums.getAll();
      setAlbums(data);
    } catch (err) {
      console.error('Failed to load albums:', err);
      showToast('Failed to load albums', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  async function handleSync() {
    setSyncing(true);
    try {
      const data = await window.electronAPI.albums.sync();
      setAlbums(data);
      showToast(`Synced ${data.length} albums from SmugMug`, 'success');
    } catch (err) {
      console.error('Failed to sync albums:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Sync failed: ${msg}`, 'error', 8000);
    } finally {
      setSyncing(false);
    }
  }

  async function handleDownloadThumbnails(albumKey: string) {
    setActiveAlbum({ key: albumKey, status: 'downloading' });
    try {
      await window.electronAPI.photos.downloadThumbnails(albumKey);
    } catch (err) {
      console.error('Failed to download thumbnails:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Download failed: ${msg}`, 'error');
      setActiveAlbum(null);
    }
  }

  async function handleScanFaces(albumKey: string) {
    setActiveAlbum({ key: albumKey, status: 'scanning' });
    try {
      // Step 1 — download medium-res images
      await window.electronAPI.photos.downloadMedium(albumKey);
      // Step 2 — run face detection
      await window.electronAPI.faces.detectInAlbum(albumKey);
    } catch (err) {
      console.error('Failed to scan faces:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Face scan failed: ${msg}`, 'error', 8000);
      setActiveAlbum(null);
      setScanProgress(null);
    } finally {
      await loadAlbums();
    }
  }

  async function handleToggleLocalOnly(album: AlbumRecord) {
    const nextLocalOnly = !album.localOnly;
    setTogglingLocalKey(album.albumKey);
    try {
      await window.electronAPI.albums.setLocalOnly(album.albumKey, nextLocalOnly);
      setAlbums(prev =>
        prev.map(a => (a.albumKey === album.albumKey ? { ...a, localOnly: nextLocalOnly } : a))
      );
      showToast(
        nextLocalOnly
          ? `Marked "${album.title}" as local-only`
          : `Allowed SmugMug uploads for "${album.title}"`,
        'info'
      );
    } catch (err) {
      console.error('Failed to toggle local-only album:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Failed to update local-only setting: ${msg}`, 'error');
    } finally {
      setTogglingLocalKey(null);
    }
  }

  async function handleRefreshImages(album: AlbumRecord) {
    setRefreshingAlbumKey(album.albumKey);
    try {
      const images = await window.electronAPI.albums.refreshImages(album.albumKey);
      await loadAlbums();
      showToast(`Refreshed ${album.title} (${images.length} photos)`, 'success');
    } catch (err) {
      console.error('Failed to refresh album images:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Refresh failed: ${msg}`, 'error', 8000);
    } finally {
      setRefreshingAlbumKey(null);
    }
  }

  const filteredAlbums = albums.filter(a =>
    a.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalPhotos = albums.reduce((sum, a) => sum + a.imageCount, 0);
  const isBusy = activeAlbum !== null;

  return (
    <div className="page" id="page-galleries">
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="page-title">Galleries</h2>
            <p className="page-description">
              {albums.length > 0
                ? `${albums.length} albums · ${totalPhotos.toLocaleString()} photos`
                : 'Sync your SmugMug galleries to get started'}
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSync}
            disabled={syncing || isBusy}
            id="btn-sync-albums"
          >
            {syncing ? <span className="spinner" /> : '🔄'}
            {syncing ? 'Syncing...' : 'Sync Albums'}
          </button>
        </div>
      </div>

      {/* Download Progress */}
      {downloadProgress && activeAlbum && (
        <div className="card mb-4" id="download-progress">
          <div className="flex justify-between items-center mb-4">
            <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
              {activeAlbum.status === 'scanning' ? '⬇ Downloading medium-res' : '⬇ Downloading thumbnails'} — {downloadProgress.currentFile}
            </span>
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {downloadProgress.completed} / {downloadProgress.total}
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${(downloadProgress.completed / downloadProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Face Scan Progress */}
      {scanProgress && (
        <div className="card mb-4" id="scan-progress">
          <div className="flex justify-between items-center mb-4">
            <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
              🔍 Scanning faces — {scanProgress.currentImage}
            </span>
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {scanProgress.completed} / {scanProgress.total} · {scanProgress.facesFound} faces
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{
                width: `${(scanProgress.completed / scanProgress.total) * 100}%`,
                background: 'linear-gradient(90deg, var(--color-accent-primary), #8b5cf6)',
              }}
            />
          </div>
        </div>
      )}

      {/* Search */}
      {albums.length > 0 && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <input
            className="input"
            type="text"
            placeholder="Search albums..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            id="input-search-albums"
            style={{ width: '100%', maxWidth: 400 }}
          />
        </div>
      )}

      {/* Albums Grid */}
      {loading && albums.length === 0 ? (
        <div className="empty-state">
          <div className="spinner spinner-lg" />
          <p className="text-muted mt-4">Loading albums...</p>
        </div>
      ) : albums.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📸</div>
          <h3 className="empty-state-title">No Albums Yet</h3>
          <p className="empty-state-description">
            Click &quot;Sync Albums&quot; to fetch your SmugMug galleries.
          </p>
        </div>
      ) : filteredAlbums.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <h3 className="empty-state-title">No Matches</h3>
          <p className="empty-state-description">No albums match &quot;{searchQuery}&quot;</p>
        </div>
      ) : (
        <div className="album-grid" id="album-grid">
          {filteredAlbums.map(album => {
            const isActive = activeAlbum?.key === album.albumKey;
            const status = isActive ? activeAlbum!.status : null;

            return (
              <div key={album.albumKey} className="album-card" id={`album-${album.albumKey}`}>
                <div
                  className="album-card-cover"
                  style={{
                    background: album.coverImageUrl
                      ? `url(${album.coverImageUrl}) center/cover`
                      : 'linear-gradient(135deg, var(--color-bg-tertiary), var(--color-bg-hover))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '2rem',
                    color: 'var(--color-text-tertiary)',
                    position: 'relative',
                  }}
                >
                  {!album.coverImageUrl && '📷'}
                  {isActive && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(0,0,0,0.55)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backdropFilter: 'blur(2px)',
                    }}>
                      <span className="spinner" style={{ width: 28, height: 28 }} />
                    </div>
                  )}
                </div>

                <div className="album-card-body">
                  <div className="album-card-title">{album.title}</div>
                  <div className="album-card-meta">
                    <span>📷 {album.imageCount} photos</span>
                    {album.syncedAt && (
                      <span>· {new Date(album.syncedAt).toLocaleDateString()}</span>
                    )}
                  </div>

                  <div className="album-card-badges">
                    {album.privacy && (() => {
                      const badgeProps = getPrivacyBadgeProps(album.privacy);
                      return (
                        <span
                          className={badgeProps.className}
                          style={badgeProps.style}
                          id={`badge-privacy-${album.albumKey}`}
                        >
                          {badgeProps.icon} {album.privacy}
                        </span>
                      );
                    })()}
                    {album.thumbsDownloaded && (
                      <span className="badge badge-success">✓ Thumbnails</span>
                    )}
                    <label
                      className="badge"
                      style={{
                        cursor: isBusy || togglingLocalKey === album.albumKey ? 'not-allowed' : 'pointer',
                        background: album.localOnly ? 'var(--color-info-bg)' : 'var(--color-bg-tertiary)',
                        color: album.localOnly ? 'var(--color-info)' : 'var(--color-text-secondary)',
                        border: `1px solid ${album.localOnly ? 'rgba(59, 130, 246, 0.3)' : 'var(--color-border)'}`,
                      }}
                      title="Keep tags local-only and skip SmugMug uploads for this album"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(album.localOnly)}
                        disabled={isBusy || togglingLocalKey === album.albumKey}
                        onChange={() => handleToggleLocalOnly(album)}
                        id={`toggle-local-only-${album.albumKey}`}
                        style={{ accentColor: 'var(--color-info)', width: 13, height: 13, cursor: 'pointer' }}
                      />
                      Local-only
                    </label>
                  </div>

                  <div className="flex gap-2" style={{ marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
                    {!album.thumbsDownloaded ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleDownloadThumbnails(album.albumKey)}
                        disabled={isBusy || refreshingAlbumKey === album.albumKey}
                        id={`btn-download-${album.albumKey}`}
                      >
                        {status === 'downloading' ? <span className="spinner" /> : '⬇'}
                        {status === 'downloading' ? 'Downloading...' : 'Download'}
                      </button>
                    ) : (
                      <>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleScanFaces(album.albumKey)}
                          disabled={isBusy || refreshingAlbumKey === album.albumKey}
                          id={`btn-scan-${album.albumKey}`}
                        >
                          {status === 'scanning' ? <span className="spinner" /> : '🔍'}
                          {status === 'scanning' ? 'Scanning...' : 'Scan Faces'}
                        </button>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => onOpenTrainer(album.albumKey)}
                          disabled={isBusy || refreshingAlbumKey === album.albumKey}
                          id={`btn-train-${album.albumKey}`}
                        >
                          🎓 Train
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleRefreshImages(album)}
                      disabled={isBusy || refreshingAlbumKey !== null}
                      id={`btn-refresh-${album.albumKey}`}
                      title="Pull newly added photos from SmugMug"
                    >
                      {refreshingAlbumKey === album.albumKey ? (
                        <span className="spinner" style={{ width: 14, height: 14 }} />
                      ) : (
                        '🔄'
                      )}
                      {refreshingAlbumKey === album.albumKey ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
