export type FileCategory =
  | 'Documents'
  | 'Images'
  | 'Videos'
  | 'Audio'
  | 'Archives'
  | 'Applications'
  | 'Code'
  | 'Other files';

export const FILE_CATEGORIES: FileCategory[] = [
  'Documents',
  'Images',
  'Videos',
  'Audio',
  'Archives',
  'Applications',
  'Code',
  'Other files',
];

export interface FileEntry {
  path: string;
  name: string;
  relativePath: string;
  parentPath: string;
  isDirectory: boolean;
  size: number;
  extension: string;
  mimeType: string;
  category: FileCategory;
  classificationReason: string;
  createdAt: number;
  modifiedAt: number;
  accessedAt: number;
  isHidden: boolean;
  isReadOnly: boolean;
  sha256?: string;
}

export interface CategoryStat {
  category: FileCategory;
  count: number;
  totalBytes: number;
  percentage: number;
}

export interface ExtensionStat {
  extension: string;
  count: number;
  totalBytes: number;
}

export interface FolderStat {
  path: string;
  name: string;
  relativePath: string;
  fileCount: number;
  totalBytes: number;
  percentage: number;
}

export interface RedundantCandidate {
  file: FileEntry;
  reason: 'duplicate_copy' | 'zero_byte' | 'temp_clutter' | 'system_junk' | 'stale_archive';
  label: string;
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  copiesCount: number;
  recoverableBytes: number;
  files: FileEntry[];
}

export interface SimilarNameNotice {
  basePrefix: string;
  filesCount: number;
  message: string;
}

export interface ScanResult {
  scanId: string;
  rootPath: string;
  scannedAt: number;
  durationMs: number;
  isProtectedWarning: boolean;
  protectionNotice?: string;
  totalFiles: number;
  totalFolders: number;
  totalBytes: number;
  duplicateGroupsCount: number;
  duplicateFilesCount: number;
  recoverableBytes: number;
  categoryDistribution: CategoryStat[];
  extensionDistribution: ExtensionStat[];
  largestFiles: FileEntry[];
  recentFiles: FileEntry[];
  oldFiles: FileEntry[];
  folderSizes: FolderStat[];
  duplicateGroups: DuplicateGroup[];
  similarNameNotices: SimilarNameNotice[];
  redundantCandidates: RedundantCandidate[];
  allFiles: FileEntry[];
}

export interface DirectoryListing {
  currentPath: string;
  parentPath: string | null;
  isProtected: boolean;
  warningMessage?: string;
  entries: FileEntry[];
}

export interface OrganizeProposal {
  id: string;
  sourcePath: string;
  targetPath: string;
  relativeSource: string;
  relativeTarget: string;
  fileName: string;
  category: FileCategory;
  extension: string;
  mimeType: string;
  reason: string;
  size: number;
  hasConflict: boolean;
  selected: boolean;
}

export interface OrganizePreviewResponse {
  rootPath: string;
  isProtected: boolean;
  warningMessage?: string;
  proposals: OrganizeProposal[];
  categoryCounts: Record<FileCategory, number>;
  totalBytesToMove: number;
  alreadyOrganizedCount: number;
}

export interface OperationItem {
  id: string;
  operationId: string;
  sourcePath: string;
  targetPath: string;
  trashBackupPath?: string | null;
  size: number;
  status: string;
}

export interface OperationRecord {
  id: string;
  type: 'organize' | 'trash' | 'rename' | 'move';
  rootPath: string;
  summary: string;
  createdAt: number;
  itemCount: number;
  totalBytes: number;
  undone: boolean;
  items: OperationItem[];
}

export interface QuickRoot {
  label: string;
  path: string;
  description: string;
  isDefaultWorkspace: boolean;
}

export interface FilePreviewPayload {
  file: FileEntry;
  previewType: 'image' | 'text' | 'pdf' | 'audio' | 'video' | 'binary';
  textContent?: string;
  truncated?: boolean;
  mediaUrl?: string;
}

export interface SystemCapabilities {
  runtime: 'electron' | 'web';
  platform: string;
  defaultWorkspacePath: string;
  quickRoots: QuickRoot[];
  trashMode: 'os-recycle-bin' | 'recoverable-vault';
}
