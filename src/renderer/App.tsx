// ============================================================
// App Shell — Sidebar Navigation + Page Router
// ============================================================

import React, { useState, useEffect } from 'react';
import type { AuthStatus } from '../shared/types';
import { LoginPage } from './pages/LoginPage';
import { GalleryBrowser } from './pages/GalleryBrowser';
import { FaceTrainer } from './pages/FaceTrainer';
import { AutoTagger } from './pages/AutoTagger';
import { SettingsPage } from './pages/SettingsPage';

// Extend window for the electronAPI bridge
declare global {
  interface Window {
    electronAPI: import('../shared/types').ElectronAPI;
  }
}

type Page = 'login' | 'galleries' | 'trainer' | 'tagger' | 'settings';

const NAV_ITEMS: { id: Page; icon: string; label: string }[] = [
  { id: 'login', icon: '🔑', label: 'Connect' },
  { id: 'galleries', icon: '📸', label: 'Galleries' },
  { id: 'trainer', icon: '🎓', label: 'Face Trainer' },
  { id: 'tagger', icon: '🏷️', label: 'Auto-Tagger' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
];

export function App() {
  const [currentPage, setCurrentPage] = useState<Page>('login');
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ state: 'disconnected' });
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string | null>(null);

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const status = await window.electronAPI.smugmug.getAuthStatus();
      setAuthStatus(status);
      if (status.state === 'connected' && currentPage === 'login') {
        setCurrentPage('galleries');
      }
    } catch (err) {
      console.error('Failed to check auth status:', err);
    }
  }

  function handleAuthComplete(status: AuthStatus) {
    setAuthStatus(status);
    if (status.state === 'connected') {
      setCurrentPage('galleries');
    }
  }

  function handleOpenTrainer(albumKey: string) {
    setSelectedAlbumKey(albumKey);
    setCurrentPage('trainer');
  }

  function renderPage() {
    switch (currentPage) {
      case 'login':
        return <LoginPage authStatus={authStatus} onAuthComplete={handleAuthComplete} />;
      case 'galleries':
        return <GalleryBrowser onOpenTrainer={handleOpenTrainer} />;
      case 'trainer':
        return <FaceTrainer albumKey={selectedAlbumKey} />;
      case 'tagger':
        return <AutoTagger />;
      case 'settings':
        return <SettingsPage />;
    }
  }

  const isConnected = authStatus.state === 'connected';
  const userInitial = isConnected && authStatus.state === 'connected'
    ? authStatus.user.displayName.charAt(0).toUpperCase()
    : '?';
  const userName = isConnected && authStatus.state === 'connected'
    ? authStatus.user.displayName
    : 'Not connected';

  return (
    <>
      <div className="titlebar-drag-region" />
      <div className="app-layout" id="app-layout">
        {/* Sidebar */}
        <aside className="sidebar" id="sidebar">
          <div className="sidebar-header">
            <h1>SmugMug Tagger</h1>
            <div className="subtitle">Face Recognition</div>
          </div>

          <nav className="sidebar-nav" id="sidebar-nav">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                className={`sidebar-nav-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => setCurrentPage(item.id)}
                disabled={item.id !== 'login' && item.id !== 'settings' && !isConnected}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <div className="user-info">
              <div className="user-avatar">{userInitial}</div>
              <div className="user-details">
                <div className="user-name">{userName}</div>
                <div className={`user-status ${isConnected ? '' : 'disconnected'}`}>
                  {isConnected ? 'Connected' : 'Disconnected'}
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="main-content" id="main-content">
          {renderPage()}
        </main>
      </div>
    </>
  );
}
