// ============================================================
// Preload Script — contextBridge IPC Exposure
// ============================================================

import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI, DownloadProgress, FaceDetectionProgress, TagUploadProgress, BoundingBox } from '../shared/types';

const electronAPI: ElectronAPI = {
  smugmug: {
    setCredentials: (consumerKey: string, consumerSecret: string) =>
      ipcRenderer.invoke('smugmug:setCredentials', consumerKey, consumerSecret),
    startAuth: () =>
      ipcRenderer.invoke('smugmug:startAuth'),
    completeAuth: (verifier: string) =>
      ipcRenderer.invoke('smugmug:completeAuth', verifier),
    getAuthStatus: () =>
      ipcRenderer.invoke('smugmug:getAuthStatus'),
    disconnect: () =>
      ipcRenderer.invoke('smugmug:disconnect'),
  },

  albums: {
    sync: () => ipcRenderer.invoke('albums:sync'),
    getAll: () => ipcRenderer.invoke('albums:getAll'),
    getImages: (albumKey: string) => ipcRenderer.invoke('albums:getImages', albumKey),
  },

  photos: {
    downloadThumbnails: (albumKey: string) =>
      ipcRenderer.invoke('photos:downloadThumbnails', albumKey),
    downloadMedium: (albumKey: string) =>
      ipcRenderer.invoke('photos:downloadMedium', albumKey),
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: DownloadProgress) => callback(progress);
      ipcRenderer.on('photos:downloadProgress', handler);
      return () => ipcRenderer.removeListener('photos:downloadProgress', handler);
    },
  },

  faces: {
    detectInAlbum: (albumKey: string) =>
      ipcRenderer.invoke('faces:detectInAlbum', albumKey),
    trainFace: (imageKey: string, bbox: BoundingBox, personName: string) =>
      ipcRenderer.invoke('faces:trainFace', imageKey, bbox, personName),
    getPeople: () =>
      ipcRenderer.invoke('faces:getPeople'),
    deletePerson: (personId: number) =>
      ipcRenderer.invoke('faces:deletePerson', personId),
    onDetectionProgress: (callback: (progress: FaceDetectionProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: FaceDetectionProgress) => callback(progress);
      ipcRenderer.on('faces:detectionProgress', handler);
      return () => ipcRenderer.removeListener('faces:detectionProgress', handler);
    },
  },

  tags: {
    runAutoTagger: () =>
      ipcRenderer.invoke('tags:runAutoTagger'),
    getUntaggedResults: () =>
      ipcRenderer.invoke('tags:getUntaggedResults'),
    approveMatches: (imageKey: string, approvedNames: string[]) =>
      ipcRenderer.invoke('tags:approveMatches', imageKey, approvedNames),
    uploadTags: (imageKeys: string[]) =>
      ipcRenderer.invoke('tags:uploadTags', imageKeys),
    onUploadProgress: (callback: (progress: TagUploadProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: TagUploadProgress) => callback(progress);
      ipcRenderer.on('tags:uploadProgress', handler);
      return () => ipcRenderer.removeListener('tags:uploadProgress', handler);
    },
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (settings) => ipcRenderer.invoke('settings:update', settings),
    getStats: () => ipcRenderer.invoke('settings:getStats'),
    clearTrainingData: () => ipcRenderer.invoke('settings:clearTrainingData'),
    resetDatabase: () => ipcRenderer.invoke('settings:resetDatabase'),
  },

  util: {
    openExternal: (url: string) => ipcRenderer.invoke('util:openExternal', url),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
