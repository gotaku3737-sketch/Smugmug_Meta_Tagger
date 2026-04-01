// ============================================================
// Gallery Browser — Browse & Download Albums
// ============================================================

import React, { useState, useEffect } from 'react';
import type { AlbumRecord, DownloadProgress } from '../../shared/types';

interface GalleryBrowserProps {
  onOpenTrainer: (albumKey: string) => void;
}

export function GalleryBrowser({ onOpenTrainer }: GalleryBrowserProps) {
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadingAlbum, setDownloadingAlbum] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadAlbums();

    const unsubscribe = window.electronAPI.photos.onDownloadProgress((progress) => {
      setDownloadProgress(progress);
      if (progress.completed === progress.total) {
        setTimeout(() => {
          setDownloadProgress(null);
          setDownloadingAlbum(null);
          loadAlbums(); // Refresh status
        }, 1000);
      }
    });

    return unsubscribe;
  }, []);

  async function loadAlbums() {
    setLoading(true);
    try {
      const data = await window.electronAPI.albums.getAll();
      setAlbums(data);
    } catch (err) {
      console.error('Failed to load albums:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const data = await window.electronAPI.albums.sync();
      setAlbums(data);
    } catch (err) {
      console.error('Failed to sync albums:', err);
    } finally {
      setSyncing(false);
    }
  }

  async function handleDownloadThumbnails(albumKey: string) {
    setDownloadingAlbum(albumKey);
    try {
      await window.electronAPI.photos.downloadThumbnails(albumKey);
    } catch (err) {
      console.error('Failed to download thumbnails:', err);
      setDownloadingAlbum(null);
    }
  }

  async function handleScanFaces(albumKey: string) {
    setDownloadingAlbum(albumKey);
    try {
      // First download medium-res, then detect faces
      await window.electronAPI.photos.downloadMedium(albumKey);
      await window.electronAPI.faces.detectInAlbum(albumKey);
    } catch (err) {
      console.error('Failed to scan faces:', err);
    } finally {
      setDownloadingAlbum(null);
      loadAlbums();
    }
  }

  const filteredAlbums = albums.filter(a =>
    a.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalPhotos = albums.reduce((sum, a) => sum + a.imageCount, 0);

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
            disabled={syncing}
            id="btn-sync-albums"
          >
            {syncing ? <span className="spinner" /> : '🔄'}
            {syncing ? 'Syncing...' : 'Sync Albums'}
          </button>
        </div>
      </div>

      {/* Download Progress */}
      {downloadProgress && downloadingAlbum && (
        <div className="card mb-4" id="download-progress">
          <div className="flex justify-between items-center mb-4">
            <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
              Downloading {downloadProgress.phase} — {downloadProgress.currentFile}
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
      ) : (
        <div className="album-grid" id="album-grid">
          {filteredAlbums.map(album => (
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
                }}
              >
                {!album.coverImageUrl && '📷'}
              </div>

              <div className="album-card-body">
                <div className="album-card-title">{album.title}</div>
                <div className="album-card-meta">
                  <span>📷 {album.imageCount} photos</span>
                  {album.syncedAt && (
                    <span>· Synced {new Date(album.syncedAt).toLocaleDateString()}</span>
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
                      disabled={downloadingAlbum !== null}
                      id={`btn-download-${album.albumKey}`}
                    >
                      ⬇️ Download
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleScanFaces(album.albumKey)}
                        disabled={downloadingAlbum !== null}
                        id={`btn-scan-${album.albumKey}`}
                      >
                        🔍 Scan Faces
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => onOpenTrainer(album.albumKey)}
                        id={`btn-train-${album.albumKey}`}
                      >
                        🎓 Train
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
