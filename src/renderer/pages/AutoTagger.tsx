// ============================================================
// Auto-Tagger — Review & Upload Face Tags
// ============================================================

import React, { useState, useEffect } from 'react';
import type { ImageRecord, TagUploadProgress } from '../../shared/types';

export function AutoTagger() {
  const [results, setResults] = useState<ImageRecord[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<TagUploadProgress | null>(null);

  useEffect(() => {
    loadResults();

    const unsubscribe = window.electronAPI.tags.onUploadProgress((progress) => {
      setUploadProgress(progress);
      if (progress.completed === progress.total) {
        setTimeout(() => {
          setUploadProgress(null);
          setUploading(false);
          loadResults();
        }, 1500);
      }
    });

    return unsubscribe;
  }, []);

  async function loadResults() {
    setLoading(true);
    try {
      const data = await window.electronAPI.tags.getUntaggedResults();
      setResults(data);
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
    } finally {
      setLoading(false);
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

  async function handleUpload() {
    if (selectedKeys.size === 0) return;
    setUploading(true);
    try {
      await window.electronAPI.tags.uploadTags(Array.from(selectedKeys));
    } catch (err) {
      console.error('Failed to upload tags:', err);
      setUploading(false);
    }
  }

  function confidenceColor(confidence: number): string {
    if (confidence >= 0.7) return 'var(--color-success)';
    if (confidence >= 0.5) return 'var(--color-warning)';
    return 'var(--color-danger)';
  }

  if (loading) {
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
                ? `${results.length} photos ready for tagging · ${selectedKeys.size} selected`
                : 'No photos ready for tagging yet'}
            </p>
          </div>

          {results.length > 0 && (
            <div className="flex gap-3">
              <button className="btn btn-ghost btn-sm" onClick={selectHighConfidence} id="btn-select-high">
                ✓ Select High Confidence
              </button>
              <button className="btn btn-ghost btn-sm" onClick={selectAll} id="btn-select-all">
                Select All
              </button>
              <button
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={uploading || selectedKeys.size === 0}
                id="btn-upload-tags"
              >
                {uploading ? <span className="spinner" /> : '🏷️'}
                Upload Tags ({selectedKeys.size})
              </button>
            </div>
          )}
        </div>
      </div>

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
            Scan albums for faces and train the recognizer first. Then come back here to review and upload tags.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {results.map(img => (
            <div
              key={img.imageKey}
              className="card"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                padding: 'var(--space-4) var(--space-5)',
                cursor: 'pointer',
                borderColor: selectedKeys.has(img.imageKey) ? 'var(--color-accent-primary)' : undefined,
                background: selectedKeys.has(img.imageKey) ? 'var(--color-accent-glow)' : undefined,
              }}
              onClick={() => toggleSelection(img.imageKey)}
              id={`tagger-row-${img.imageKey}`}
            >
              {/* Checkbox */}
              <div style={{
                width: 20,
                height: 20,
                borderRadius: 'var(--radius-sm)',
                border: `2px solid ${selectedKeys.has(img.imageKey) ? 'var(--color-accent-primary)' : 'var(--color-border)'}`,
                background: selectedKeys.has(img.imageKey) ? 'var(--color-accent-primary)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                color: 'white',
                flexShrink: 0,
              }}>
                {selectedKeys.has(img.imageKey) && '✓'}
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
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
              </div>

              {/* Filename */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
                  {img.filename}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                  {img.faceCount} face{img.faceCount !== 1 ? 's' : ''} detected
                </div>
              </div>

              {/* Matched people */}
              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                {img.detectedPeople?.map((match, i) => (
                  <span
                    key={i}
                    className="badge"
                    style={{
                      background: `${confidenceColor(match.confidence)}15`,
                      color: confidenceColor(match.confidence),
                      border: `1px solid ${confidenceColor(match.confidence)}30`,
                    }}
                  >
                    {match.personName} ({Math.round(match.confidence * 100)}%)
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
