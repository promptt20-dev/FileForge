import type {
  DirectoryListing,
  FileCategory,
  FilePreviewPayload,
  OperationRecord,
  OrganizePreviewResponse,
  ScanResult,
  SystemCapabilities,
} from '../shared/types';

declare global {
  interface Window {
    fileforge?: {
      isElectron: boolean;
      getCapabilities: () => Promise<SystemCapabilities>;
      selectFolder: () => Promise<string | null>;
      openWithOS: (filePath: string) => Promise<{ opened: boolean }>;
      revealInExplorer: (filePath: string) => Promise<{ revealed: boolean }>;
      scanDirectory: (targetPath?: string, staleDays?: number) => Promise<ScanResult>;
      listDirectory: (targetPath?: string) => Promise<DirectoryListing>;
      createDirectory: (parentPath: string, folderName: string) => Promise<{ createdPath: string }>;
      previewFile: (filePath: string) => Promise<FilePreviewPayload>;
      hashFile: (filePath: string) => Promise<{ filePath: string; sha256: string }>;
      renameFile: (filePath: string, newName: string) => Promise<OperationRecord>;
      previewOrganize: (targetPath?: string) => Promise<OrganizePreviewResponse>;
      applyOrganize: (
        rootPath: string,
        proposals: Array<{ sourcePath: string; targetPath: string; size: number }>
      ) => Promise<OperationRecord>;
      trashFiles: (rootPath: string, filePaths: string[]) => Promise<OperationRecord>;
      getOperations: () => Promise<OperationRecord[]>;
      undoOperation: (operationId: string) => Promise<{ restoredCount: number; message: string }>;
    };
  }
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const fileforgeClient = {
  isElectron(): boolean {
    return Boolean(typeof window !== 'undefined' && window.fileforge?.isElectron);
  },

  async getCapabilities(): Promise<SystemCapabilities> {
    if (window.fileforge) return window.fileforge.getCapabilities();
    return apiJson<SystemCapabilities>('/api/system/capabilities');
  },

  async selectFolder(): Promise<string | null> {
    if (window.fileforge) return window.fileforge.selectFolder();
    return null;
  },

  async openWithOS(filePath: string): Promise<void> {
    if (window.fileforge) {
      await window.fileforge.openWithOS(filePath);
      return;
    }
    // Web mode fallback: stream file directly in browser tab or trigger download
    const url = `/api/file/raw?path=${encodeURIComponent(filePath)}`;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  async scanDirectory(targetPath?: string, staleDays?: number): Promise<ScanResult> {
    if (window.fileforge) return window.fileforge.scanDirectory(targetPath, staleDays);
    return apiJson<ScanResult>('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ targetPath, staleDays }),
    });
  },

  async reseedWorkspace(): Promise<ScanResult> {
    return apiJson<ScanResult>('/api/workspace/reseed', { method: 'POST' });
  },

  async listDirectory(targetPath?: string): Promise<DirectoryListing> {
    if (window.fileforge) return window.fileforge.listDirectory(targetPath);
    const qs = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
    return apiJson<DirectoryListing>(`/api/explorer/list${qs}`);
  },

  async createDirectory(parentPath: string, folderName: string): Promise<{ createdPath: string }> {
    if (window.fileforge) return window.fileforge.createDirectory(parentPath, folderName);
    return apiJson<{ createdPath: string }>('/api/explorer/mkdir', {
      method: 'POST',
      body: JSON.stringify({ parentPath, folderName }),
    });
  },

  async uploadFiles(targetDir: string, files: FileList): Promise<{ uploaded: string[] }> {
    const encoded: Array<{ name: string; base64: string }> = [];
    for (const file of Array.from(files)) {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      encoded.push({ name: file.name, base64: btoa(binary) });
    }
    return apiJson<{ uploaded: string[] }>('/api/explorer/upload', {
      method: 'POST',
      body: JSON.stringify({ targetDir, files: encoded }),
    });
  },

  async previewFile(filePath: string): Promise<FilePreviewPayload> {
    if (window.fileforge) return window.fileforge.previewFile(filePath);
    return apiJson<FilePreviewPayload>(`/api/file/preview?path=${encodeURIComponent(filePath)}`);
  },

  async hashFile(filePath: string): Promise<{ filePath: string; sha256: string }> {
    if (window.fileforge) return window.fileforge.hashFile(filePath);
    return apiJson<{ filePath: string; sha256: string }>('/api/file/hash', {
      method: 'POST',
      body: JSON.stringify({ filePath }),
    });
  },

  async renameFile(filePath: string, newName: string): Promise<OperationRecord> {
    if (window.fileforge) return window.fileforge.renameFile(filePath, newName);
    return apiJson<OperationRecord>('/api/file/rename', {
      method: 'POST',
      body: JSON.stringify({ filePath, newName }),
    });
  },

  async previewOrganize(targetPath?: string): Promise<OrganizePreviewResponse> {
    if (window.fileforge) return window.fileforge.previewOrganize(targetPath);
    return apiJson<OrganizePreviewResponse>('/api/organizer/preview', {
      method: 'POST',
      body: JSON.stringify({ targetPath }),
    });
  },

  async applyOrganize(
    rootPath: string,
    proposals: Array<{ sourcePath: string; targetPath: string; size: number }>
  ): Promise<OperationRecord> {
    if (window.fileforge) return window.fileforge.applyOrganize(rootPath, proposals);
    return apiJson<OperationRecord>('/api/organizer/apply', {
      method: 'POST',
      body: JSON.stringify({ rootPath, proposals }),
    });
  },

  async trashFiles(rootPath: string, filePaths: string[]): Promise<OperationRecord> {
    if (window.fileforge) return window.fileforge.trashFiles(rootPath, filePaths);
    return apiJson<OperationRecord>('/api/cleanup/trash', {
      method: 'POST',
      body: JSON.stringify({ rootPath, filePaths }),
    });
  },

  async getOperations(): Promise<OperationRecord[]> {
    if (window.fileforge) return window.fileforge.getOperations();
    return apiJson<OperationRecord[]>('/api/operations');
  },

  async undoOperation(operationId: string): Promise<{ restoredCount: number; message: string }> {
    if (window.fileforge) return window.fileforge.undoOperation(operationId);
    return apiJson<{ restoredCount: number; message: string }>('/api/operations/undo', {
      method: 'POST',
      body: JSON.stringify({ operationId }),
    });
  },
};

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, idx);
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

export function formatDateShort(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function daysAgo(ms: number): number {
  return Math.max(0, Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24)));
}

export const CATEGORY_COLORS: Record<FileCategory, string> = {
  Documents: '#8B5CF6',
  Images: '#06B6D4',
  Videos: '#3B82F6',
  Audio: '#EC4899',
  Archives: '#F59E0B',
  Applications: '#10B981',
  Code: '#6366F1',
  'Other files': '#71717A',
};
