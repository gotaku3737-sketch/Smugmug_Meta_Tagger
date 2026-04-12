// ============================================================
// Auto-Tagger — Review & Upload Face Tags
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import type { ImageRecord, TagUploadProgress } from '../../shared/types';
import { VirtualList } from '../components/VirtualList';
import { useToast } from '../components/Toast';

const ROW_HEIGHT = 72;
const LIST_HEIGHT = 500;

export function AutoTagger() {
  const [results, setResults] = useState<ImageRecord[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<TagUploadProgress | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadResults();

    const unsubscribe = window.electronAPI.tags.onUploadProgress((progress) => {
      setUploadProgress(progress);
      if (progress.completed === progress.total) {
        setTimeout(() => {
          setUploadProgress(null);
          setUploading(false);
          loadResults();
          showToast(`Successfully uploaded tags for ${progress.total} photos`, 'success');
        }, 1500);
      }
    });

    return unsubscribe;
  }, []);

  const loadResults = useCallback(async () => {
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
      showToast('Failed to load tagging results', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

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

  async function handleUpload() {
    if (selectedKeys.size === 0) return;
    setUploading(true);
    try {
      await window.electronAPI.tags.uploadTags(Array.from(selectedKeys));
    } catch (err) {
      console.error('Failed to upload tags:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Upload failed: ${msg}`, 'error');
      setUploading(false);
    }
  }

  function confidenceColor(confidence: number): string {
    if (confidence >= 0.7) return 'var(--color-success)';
    if (confidence >= 0.5) return 'var(--color-warning)';
    return 'var(--color-danger)';
  }

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
                  onClick={handleUpload}
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
          {/* Stats row */}
          <div className="flex gap-4 mb-4" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
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
                selected={selectedKeys.has(img.imageKey)}
                onToggle={toggleSelection}
                confidenceColor={confidenceColor}
              />
            )}
          />
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------
// Row component — memoised to avoid re-renders
// -----------------------------------------------------------

interface TaggerRowProps {
  img: ImageRecord;
  selected: boolean;
  onToggle: (key: string) => void;
  confidenceColor: (c: number) => string;
}

const TaggerRow = React.memo(function TaggerRow({ img, selected, onToggle, confidenceColor }: TaggerRowProps) {
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

      {/* Filename + face count */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {img.filename}
        </div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
          {img.faceCount} face{img.faceCount !== 1 ? 's' : ''} detected
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
