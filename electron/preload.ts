import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fileforge', {
  isElectron: true,
  getCapabilities: () => ipcRenderer.invoke('fileforge:capabilities'),
  selectFolder: () => ipcRenderer.invoke('fileforge:selectFolder'),
  openWithOS: (filePath: string) => ipcRenderer.invoke('fileforge:openWithOS', filePath),
  revealInExplorer: (filePath: string) => ipcRenderer.invoke('fileforge:revealInExplorer', filePath),
  scanDirectory: (targetPath?: string, staleDays?: number) =>
    ipcRenderer.invoke('fileforge:scan', { targetPath, staleDays }),
  listDirectory: (targetPath?: string) => ipcRenderer.invoke('fileforge:listDir', targetPath),
  createDirectory: (parentPath: string, folderName: string) =>
    ipcRenderer.invoke('fileforge:mkdir', { parentPath, folderName }),
  previewFile: (filePath: string) => ipcRenderer.invoke('fileforge:previewFile', filePath),
  hashFile: (filePath: string) => ipcRenderer.invoke('fileforge:hashFile', filePath),
  renameFile: (filePath: string, newName: string) =>
    ipcRenderer.invoke('fileforge:renameFile', { filePath, newName }),
  previewOrganize: (targetPath?: string) => ipcRenderer.invoke('fileforge:previewOrganize', targetPath),
  applyOrganize: (
    rootPath: string,
    proposals: Array<{ sourcePath: string; targetPath: string; size: number }>
  ) => ipcRenderer.invoke('fileforge:applyOrganize', { rootPath, proposals }),
  trashFiles: (rootPath: string, filePaths: string[]) =>
    ipcRenderer.invoke('fileforge:trashFiles', { rootPath, filePaths }),
  getOperations: () => ipcRenderer.invoke('fileforge:operations'),
  undoOperation: (operationId: string) => ipcRenderer.invoke('fileforge:undoOperation', operationId),
});
