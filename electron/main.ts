import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../server/db.js';
import {
  applySmartOrganize,
  getFilePreview,
  getFileSha256,
  getOperationHistory,
  listDirectory,
  previewSmartOrganize,
  renameFileSafe,
  safeTrashFiles,
  scanDirectory,
  undoOperation,
} from '../server/fsEngine.js';
import { DEFAULT_WORKSPACE_DIR, getQuickRoots, validatePathForMutation, validatePathForRead } from '../server/safety.js';
import { ensureSeededWorkspace } from '../server/seedWorkspace.js';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#0B0B12',
    title: 'FileForge — Organize Smarter. Find Faster.',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle('fileforge:capabilities', () => ({
    runtime: 'electron',
    platform: process.platform,
    defaultWorkspacePath: DEFAULT_WORKSPACE_DIR,
    quickRoots: getQuickRoots(),
    trashMode: 'os-recycle-bin',
  }));

  ipcMain.handle('fileforge:selectFolder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Directory to Scan with FileForge',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('fileforge:openWithOS', async (_event, filePath: string) => {
    const check = validatePathForRead(filePath);
    if (!check.allowed) throw new Error(check.warningMessage || 'Access denied');
    const errorMsg = await shell.openPath(check.resolvedPath);
    if (errorMsg) throw new Error(errorMsg);
    return { opened: true };
  });

  ipcMain.handle('fileforge:revealInExplorer', async (_event, filePath: string) => {
    const check = validatePathForRead(filePath);
    if (!check.allowed) throw new Error(check.warningMessage || 'Access denied');
    shell.showItemInFolder(check.resolvedPath);
    return { revealed: true };
  });

  ipcMain.handle('fileforge:scan', async (_event, params: { targetPath?: string; staleDays?: number }) => {
    return scanDirectory(params?.targetPath, { staleDays: params?.staleDays });
  });

  ipcMain.handle('fileforge:listDir', async (_event, targetPath?: string) => {
    return listDirectory(targetPath);
  });

  ipcMain.handle('fileforge:mkdir', async (_event, params: { parentPath: string; folderName: string }) => {
    const safeName = String(params.folderName || '').trim();
    if (!safeName || safeName.includes('/') || safeName.includes('\\')) {
      throw new Error('Invalid folder name.');
    }
    const target = path.join(path.resolve(params.parentPath || DEFAULT_WORKSPACE_DIR), safeName);
    const safety = validatePathForMutation(target);
    if (!safety.allowed) throw new Error(safety.warningMessage || 'Protected directory.');
    await fs.promises.mkdir(safety.resolvedPath, { recursive: true });
    return { createdPath: safety.resolvedPath };
  });

  ipcMain.handle('fileforge:previewFile', async (_event, filePath: string) => {
    const payload = await getFilePreview(filePath);
    if (payload.mediaUrl) {
      // In Electron, serve local media via file:// URL safely for preview
      const check = validatePathForRead(filePath);
      if (check.allowed) {
        payload.mediaUrl = `file://${check.resolvedPath.replace(/\\/g, '/')}`;
      }
    }
    return payload;
  });

  ipcMain.handle('fileforge:hashFile', async (_event, filePath: string) => {
    const sha256 = await getFileSha256(filePath);
    return { filePath, sha256 };
  });

  ipcMain.handle('fileforge:renameFile', async (_event, params: { filePath: string; newName: string }) => {
    return renameFileSafe(params.filePath, params.newName);
  });

  ipcMain.handle('fileforge:previewOrganize', async (_event, targetPath?: string) => {
    return previewSmartOrganize(targetPath);
  });

  ipcMain.handle(
    'fileforge:applyOrganize',
    async (_event, params: { rootPath: string; proposals: Array<{ sourcePath: string; targetPath: string; size: number }> }) => {
      return applySmartOrganize(params.rootPath, params.proposals);
    }
  );

  ipcMain.handle('fileforge:trashFiles', async (_event, params: { rootPath: string; filePaths: string[] }) => {
    // Use native Windows 10/11 Recycle Bin via Electron shell.trashItem
    return safeTrashFiles(params.rootPath, params.filePaths, async (target) => {
      await shell.trashItem(target);
      return true;
    });
  });

  ipcMain.handle('fileforge:operations', async () => {
    return getOperationHistory(40);
  });

  ipcMain.handle('fileforge:undoOperation', async (_event, operationId: string) => {
    return undoOperation(operationId);
  });
}

app.whenReady().then(() => {
  const userDataDir = app.getPath('userData');
  getDb(userDataDir);
  ensureSeededWorkspace();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
