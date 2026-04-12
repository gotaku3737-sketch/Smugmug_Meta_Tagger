// ============================================================
// Gallery Browser — Browse & Download Albums
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import type { AlbumRecord, DownloadProgress, FaceDetectionProgress } from '../../shared/types';
import { useToast } from '../components/Toast';

interface GalleryBrowserProps {
  onOpenTrainer: (albumKey: string) => void;
}

type AlbumStatus = 'downloading' | 'scanning' | null;

export function GalleryBrowser({ onOpenTrainer }: GalleryBrowserProps) {
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [scanProgress, setScanProgress] = useState<FaceDetectionProgress | null>(null);
  const [activeAlbum, setActiveAlbum] = useState<{ key: string; status: AlbumStatus } | null>(null);
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
                    {album.thumbsDownloaded && (
                      <span className="badge badge-success">✓ Thumbnails</span>
                    )}
                  </div>

                  <div className="flex gap-2" style={{ marginTop: 'var(--space-4)' }}>
                    {!album.thumbsDownloaded ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleDownloadThumbnails(album.albumKey)}
                        disabled={isBusy}
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
                          disabled={isBusy}
                          id={`btn-scan-${album.albumKey}`}
                        >
                          {status === 'scanning' ? <span className="spinner" /> : '🔍'}
                          {status === 'scanning' ? 'Scanning...' : 'Scan Faces'}
                        </button>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => onOpenTrainer(album.albumKey)}
                          disabled={isBusy}
                          id={`btn-train-${album.albumKey}`}
                        >
                          🎓 Train
                        </button>
                      </>
                    )}
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
