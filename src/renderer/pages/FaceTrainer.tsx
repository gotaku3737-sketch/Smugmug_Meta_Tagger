// ============================================================
// Face Trainer — Label Faces in Photos
// ============================================================

import React, { useState, useEffect } from 'react';
import type { ImageRecord, Person } from '../../shared/types';

interface FaceTrainerProps {
  albumKey: string | null;
}

export function FaceTrainer({ albumKey }: FaceTrainerProps) {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (albumKey) {
      loadData();
    }
  }, [albumKey]);

  async function loadData() {
    setLoading(true);
    try {
      const [imgs, ppl] = await Promise.all([
        window.electronAPI.albums.getImages(albumKey!),
        window.electronAPI.faces.getPeople(),
      ]);
      // Only show images that have faces detected
      setImages(imgs.filter(img => img.facesDetected && img.faceCount > 0));
      setPeople(ppl);
    } catch (err) {
      console.error('Failed to load trainer data:', err);
    } finally {
      setLoading(false);
    }
  }

  const currentImage = images[currentIndex];

  if (!albumKey) {
    return (
      <div className="page" id="page-trainer">
        <div className="empty-state">
          <div className="empty-state-icon">🎓</div>
          <h3 className="empty-state-title">No Album Selected</h3>
          <p className="empty-state-description">
            Go to Galleries and click &quot;Train&quot; on an album to start labeling faces.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page" id="page-trainer">
        <div className="empty-state">
          <div className="spinner spinner-lg" />
          <p className="text-muted mt-4">Loading photos with detected faces...</p>
        </div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="page" id="page-trainer">
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <h3 className="empty-state-title">No Faces Detected</h3>
          <p className="empty-state-description">
            This album hasn&apos;t been scanned yet. Go to Galleries and click &quot;Scan Faces&quot; first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page" id="page-trainer">
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="page-title">Face Trainer</h2>
            <p className="page-description">
              Photo {currentIndex + 1} of {images.length} · {currentImage?.faceCount || 0} faces detected
            </p>
          </div>

          <div className="flex gap-3">
            <button
              className="btn btn-secondary"
              onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
              id="btn-prev-photo"
            >
              ← Previous
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setCurrentIndex(Math.min(images.length - 1, currentIndex + 1))}
              disabled={currentIndex === images.length - 1}
              id="btn-next-photo"
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Main photo area */}
        <div className="card" style={{ flex: 1 }}>
          {currentImage?.mediumPath ? (
            <div className="face-container" style={{ width: '100%' }}>
              <img
                src={`file://${currentImage.mediumPath}`}
                alt={currentImage.filename}
                style={{
                  width: '100%',
                  height: 'auto',
                  borderRadius: 'var(--radius-md)',
                }}
              />
              {/* Face boxes will be rendered here when face engine is wired */}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
              <p className="text-muted">Medium-res image not downloaded yet</p>
            </div>
          )}

          <div style={{ marginTop: 'var(--space-4)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}>
            {currentImage?.filename}
          </div>
        </div>

        {/* People sidebar */}
        <div style={{ width: 260, flexShrink: 0 }}>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">People</h3>
              <span className="badge badge-info">{people.length}</span>
            </div>

            {people.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                No people labeled yet. Click on detected faces to start labeling.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {people.map(person => (
                  <div
                    key={person.id}
                    className="flex items-center justify-between"
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--color-bg-tertiary)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
                        {person.name}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                        {person.descriptorCount} sample{person.descriptorCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <span className={`badge ${person.descriptorCount >= 3 ? 'badge-success' : 'badge-warning'}`}>
                      {person.descriptorCount >= 3 ? '✓ Ready' : 'Need more'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Training tips */}
          <div className="card" style={{ marginTop: 'var(--space-4)' }}>
            <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
              💡 Training Tips
            </h4>
            <ul style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-secondary)',
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}>
              <li>• Label 3–5 photos per person for best results</li>
              <li>• Include different angles and lighting</li>
              <li>• The more samples, the better the accuracy</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
