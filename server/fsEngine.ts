import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import trash from 'trash';
import { classifyFile } from './classifier.js';
import {
  getOperationById,
  listOperations,
  markOperationUndone,
  recordOperation,
  saveScanMetadata,
} from './db.js';
import { computeSingleFileSha256, runHashWorkerBatch } from './hashWorker.js';
import {
  DEFAULT_WORKSPACE_DIR,
  TRASH_VAULT_DIR_NAME,
  validatePathForMutation,
  validatePathForRead,
} from './safety.js';
import {
  FILE_CATEGORIES,
  type CategoryStat,
  type DirectoryListing,
  type DuplicateGroup,
  type ExtensionStat,
  type FileCategory,
  type FileEntry,
  type FilePreviewPayload,
  type FolderStat,
  type OperationItem,
  type OperationRecord,
  type OrganizePreviewResponse,
  type OrganizeProposal,
  type RedundantCandidate,
  type ScanResult,
  type SimilarNameNotice,
} from '../src/shared/types.js';

const SKIP_SCAN_DIRS = new Set([TRASH_VAULT_DIR_NAME, 'node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']);

function buildFileEntry(fullPath: string, rootPath: string, stats: fs.Stats, isDir: boolean): FileEntry {
  const name = path.basename(fullPath);
  const parentPath = path.dirname(fullPath);
  const relativePath = path.relative(rootPath, fullPath) || name;
  const extension = isDir ? '' : path.extname(name).toLowerCase();
  const isHidden = name.startsWith('.');
  const isReadOnly = (stats.mode & 0o200) === 0;

  if (isDir) {
    return {
      path: fullPath,
      name,
      relativePath,
      parentPath,
      isDirectory: true,
      size: 0,
      extension: '',
      mimeType: 'inode/directory',
      category: 'Other files',
      classificationReason: 'Directory',
      createdAt: Math.round(stats.birthtimeMs || stats.ctimeMs),
      modifiedAt: Math.round(stats.mtimeMs),
      accessedAt: Math.round(stats.atimeMs),
      isHidden,
      isReadOnly,
    };
  }

  const classified = classifyFile(fullPath, name, extension, stats.size);
  return {
    path: fullPath,
    name,
    relativePath,
    parentPath,
    isDirectory: false,
    size: stats.size,
    extension,
    mimeType: classified.mimeType,
    category: classified.category,
    classificationReason: classified.reason,
    createdAt: Math.round(stats.birthtimeMs || stats.ctimeMs),
    modifiedAt: Math.round(stats.mtimeMs),
    accessedAt: Math.round(stats.atimeMs),
    isHidden,
    isReadOnly,
  };
}

async function moveFileAtomic(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.promises.rename(src, dest);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EXDEV') {
      await fs.promises.copyFile(src, dest);
      await fs.promises.unlink(src);
    } else {
      throw err;
    }
  }
}

export async function scanDirectory(
  inputPath?: string,
  options?: { staleDays?: number; largeThresholdBytes?: number }
): Promise<ScanResult> {
  const startTime = Date.now();
  const targetPath = inputPath ? path.resolve(inputPath) : DEFAULT_WORKSPACE_DIR;
  const safety = validatePathForRead(targetPath);
  if (!safety.allowed) {
    throw new Error(safety.warningMessage || 'Access to this directory is restricted.');
  }
  const rootPath = safety.resolvedPath;
  if (!fs.existsSync(rootPath)) {
    throw new Error(`Directory does not exist: ${rootPath}`);
  }
  const rootStat = await fs.promises.stat(rootPath);
  if (!rootStat.isDirectory()) {
    throw new Error(`Selected path is not a directory: ${rootPath}`);
  }

  const staleDays = options?.staleDays ?? 90;
  const staleCutoffMs = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  const allFiles: FileEntry[] = [];
  const folderByteMap = new Map<string, { path: string; name: string; relativePath: string; fileCount: number; totalBytes: number }>();
  let totalFolders = 0;

  async function walk(currentDir: string, depth: number) {
    if (depth > 25) return; // Safety depth limit
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return; // Skip unreadable directories gracefully
    }

    for (const dirent of dirEntries) {
      if (SKIP_SCAN_DIRS.has(dirent.name)) continue;
      if (dirent.isSymbolicLink()) continue; // Avoid symlink cycles

      const fullPath = path.join(currentDir, dirent.name);
      let stats: fs.Stats;
      try {
        stats = await fs.promises.lstat(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        totalFolders++;
        const rel = path.relative(rootPath, fullPath);
        if (!folderByteMap.has(fullPath)) {
          folderByteMap.set(fullPath, {
            path: fullPath,
            name: dirent.name,
            relativePath: rel,
            fileCount: 0,
            totalBytes: 0,
          });
        }
        await walk(fullPath, depth + 1);
      } else if (stats.isFile()) {
        const entry = buildFileEntry(fullPath, rootPath, stats, false);
        allFiles.push(entry);

        // Attribute size to every ancestor folder inside rootPath
        let cursor = currentDir;
        while (cursor.startsWith(rootPath)) {
          if (cursor === rootPath) break;
          const folderStat = folderByteMap.get(cursor);
          if (folderStat) {
            folderStat.fileCount += 1;
            folderStat.totalBytes += entry.size;
          }
          const next = path.dirname(cursor);
          if (next === cursor) break;
          cursor = next;
        }
      }
    }
  }

  await walk(rootPath, 0);

  const totalBytes = allFiles.reduce((acc, f) => acc + f.size, 0);

  // Stage 1 duplicate pre-filter: group non-zero files by exact byte size
  const sizeGroups = new Map<number, FileEntry[]>();
  for (const file of allFiles) {
    if (file.size <= 0) continue;
    const list = sizeGroups.get(file.size) || [];
    list.push(file);
    sizeGroups.set(file.size, list);
  }

  const partialCandidates: FileEntry[] = [];
  for (const group of sizeGroups.values()) {
    if (group.length > 1) {
      partialCandidates.push(...group);
    }
  }

  // Stage 2: Partial head+tail hash in background worker thread
  const partialResults = await runHashWorkerBatch(
    partialCandidates.map((f) => ({ path: f.path, size: f.size, mode: 'partial' as const }))
  );

  const partialGroups = new Map<string, FileEntry[]>();
  const entryByPath = new Map<string, FileEntry>(allFiles.map((f) => [f.path, f]));

  for (const res of partialResults) {
    if (!res.hash) continue;
    const entry = entryByPath.get(res.path);
    if (!entry) continue;
    const list = partialGroups.get(res.hash) || [];
    list.push(entry);
    partialGroups.set(res.hash, list);
  }

  // Stage 3: Full streaming SHA-256 in background worker thread for partial-hash collisions
  const fullCandidates: FileEntry[] = [];
  for (const group of partialGroups.values()) {
    if (group.length > 1) {
      fullCandidates.push(...group);
    }
  }

  const fullResults = await runHashWorkerBatch(
    fullCandidates.map((f) => ({ path: f.path, size: f.size, mode: 'full' as const }))
  );

  const shaGroups = new Map<string, FileEntry[]>();
  for (const res of fullResults) {
    if (!res.hash) continue;
    const entry = entryByPath.get(res.path);
    if (!entry) continue;
    entry.sha256 = res.hash;
    const list = shaGroups.get(res.hash) || [];
    list.push(entry);
    shaGroups.set(res.hash, list);
  }

  const duplicateGroups: DuplicateGroup[] = [];
  let duplicateFilesCount = 0;
  let recoverableBytes = 0;

  for (const [hash, files] of shaGroups.entries()) {
    if (files.length > 1) {
      // Sort oldest modified first so "Original" is stable
      files.sort((a, b) => a.modifiedAt - b.modifiedAt || a.path.length - b.path.length);
      const size = files[0].size;
      const recoverable = size * (files.length - 1);
      duplicateGroups.push({
        hash,
        size,
        copiesCount: files.length,
        recoverableBytes: recoverable,
        files,
      });
      duplicateFilesCount += files.length - 1;
      recoverableBytes += recoverable;
    }
  }

  duplicateGroups.sort((a, b) => b.recoverableBytes - a.recoverableBytes);

  // Detect similarly named files that are NOT byte-identical (to inform user SHA-256 excluded false positives)
  const namePrefixGroups = new Map<string, FileEntry[]>();
  for (const f of allFiles) {
    const stem = path
      .basename(f.name, f.extension)
      .toLowerCase()
      .replace(/(\s*\(\d+\)|\s*copy|\s*_v\d+|\s*-copy|\s*_final|\s*_backup)$/i, '')
      .trim();
    if (stem.length < 4) continue;
    const key = `${stem}${f.extension}`;
    const arr = namePrefixGroups.get(key) || [];
    arr.push(f);
    namePrefixGroups.set(key, arr);
  }

  const similarNameNotices: SimilarNameNotice[] = [];
  for (const [prefix, files] of namePrefixGroups.entries()) {
    if (files.length > 1) {
      const hashes = new Set(files.map((f) => f.sha256 || `unique-size-${f.size}-${f.path}`));
      if (hashes.size > 1) {
        similarNameNotices.push({
          basePrefix: prefix,
          filesCount: files.length,
          message: `${files.length} files share the base name "${prefix}" with differing SHA-256 content; kept separate and not flagged as duplicates.`,
        });
      }
    }
  }

  // Category & Extension distributions
  const catStatsMap = new Map<FileCategory, { count: number; totalBytes: number }>();
  for (const cat of FILE_CATEGORIES) {
    catStatsMap.set(cat, { count: 0, totalBytes: 0 });
  }
  const extStatsMap = new Map<string, { count: number; totalBytes: number }>();

  for (const f of allFiles) {
    const c = catStatsMap.get(f.category)!;
    c.count += 1;
    c.totalBytes += f.size;

    const extKey = f.extension || '(no ext)';
    const e = extStatsMap.get(extKey) || { count: 0, totalBytes: 0 };
    e.count += 1;
    e.totalBytes += f.size;
    extStatsMap.set(extKey, e);
  }

  const categoryDistribution: CategoryStat[] = FILE_CATEGORIES.map((cat) => {
    const item = catStatsMap.get(cat)!;
    return {
      category: cat,
      count: item.count,
      totalBytes: item.totalBytes,
      percentage: totalBytes > 0 ? Number(((item.totalBytes / totalBytes) * 100).toFixed(1)) : 0,
    };
  }).sort((a, b) => b.totalBytes - a.totalBytes);

  const extensionDistribution: ExtensionStat[] = Array.from(extStatsMap.entries())
    .map(([extension, stat]) => ({
      extension,
      count: stat.count,
      totalBytes: stat.totalBytes,
    }))
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .slice(0, 15);

  const largestFiles = [...allFiles].sort((a, b) => b.size - a.size).slice(0, 20);
  const recentFiles = [...allFiles].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 20);
  const oldFiles = allFiles
    .filter((f) => f.modifiedAt < staleCutoffMs)
    .sort((a, b) => a.modifiedAt - b.modifiedAt);

  const folderSizes: FolderStat[] = Array.from(folderByteMap.values())
    .map((f) => ({
      ...f,
      percentage: totalBytes > 0 ? Number(((f.totalBytes / totalBytes) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.totalBytes - a.totalBytes);

  // Potentially redundant candidates
  const redundantCandidates: RedundantCandidate[] = [];
  const seenRedundantPaths = new Set<string>();

  for (const group of duplicateGroups) {
    // Index 0 is preserved original; indices 1..N are redundant copies
    for (let i = 1; i < group.files.length; i++) {
      const f = group.files[i];
      if (!seenRedundantPaths.has(f.path)) {
        seenRedundantPaths.add(f.path);
        redundantCandidates.push({
          file: f,
          reason: 'duplicate_copy',
          label: `Exact SHA-256 duplicate of ${group.files[0].name}`,
        });
      }
    }
  }

  for (const f of allFiles) {
    if (seenRedundantPaths.has(f.path)) continue;
    const lowerName = f.name.toLowerCase();
    if (f.size === 0) {
      seenRedundantPaths.add(f.path);
      redundantCandidates.push({
        file: f,
        reason: 'zero_byte',
        label: 'Zero-byte empty file',
      });
    } else if (lowerName === 'thumbs.db' || lowerName === '.ds_store' || lowerName === 'desktop.ini') {
      seenRedundantPaths.add(f.path);
      redundantCandidates.push({
        file: f,
        reason: 'system_junk',
        label: 'OS thumbnail/metadata cache artifact',
      });
    } else if (['.tmp', '.bak', '.log', '.dmp', '.old'].includes(f.extension)) {
      seenRedundantPaths.add(f.path);
      redundantCandidates.push({
        file: f,
        reason: 'temp_clutter',
        label: `Temporary or log clutter (${f.extension})`,
      });
    } else if (f.category === 'Archives' && f.modifiedAt < Date.now() - 180 * 24 * 60 * 60 * 1000) {
      seenRedundantPaths.add(f.path);
      redundantCandidates.push({
        file: f,
        reason: 'stale_archive',
        label: 'Archived bundle untouched for over 180 days',
      });
    }
  }

  const scanId = crypto.randomUUID();
  const scannedAt = Date.now();
  const durationMs = Math.max(1, scannedAt - startTime);

  saveScanMetadata({
    scanId,
    rootPath,
    scannedAt,
    durationMs,
    totalFiles: allFiles.length,
    totalFolders,
    totalBytes,
    duplicateGroups: duplicateGroups.length,
    recoverableBytes,
    files: allFiles,
  });

  return {
    scanId,
    rootPath,
    scannedAt,
    durationMs,
    isProtectedWarning: safety.isProtected,
    protectionNotice: safety.warningMessage,
    totalFiles: allFiles.length,
    totalFolders,
    totalBytes,
    duplicateGroupsCount: duplicateGroups.length,
    duplicateFilesCount,
    recoverableBytes,
    categoryDistribution,
    extensionDistribution,
    largestFiles,
    recentFiles,
    oldFiles,
    folderSizes,
    duplicateGroups,
    similarNameNotices,
    redundantCandidates,
    allFiles,
  };
}

export async function listDirectory(inputPath?: string): Promise<DirectoryListing> {
  const targetPath = inputPath ? path.resolve(inputPath) : DEFAULT_WORKSPACE_DIR;
  const safety = validatePathForRead(targetPath);
  if (!safety.allowed) {
    throw new Error(safety.warningMessage || 'Directory access denied.');
  }

  const resolved = safety.resolvedPath;
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory not found: ${resolved}`);
  }

  const dirEntries = await fs.promises.readdir(resolved, { withFileTypes: true });
  const entries: FileEntry[] = [];

  for (const dirent of dirEntries) {
    if (dirent.name === TRASH_VAULT_DIR_NAME) continue;
    const fullPath = path.join(resolved, dirent.name);
    try {
      const stats = await fs.promises.lstat(fullPath);
      if (stats.isSymbolicLink()) continue;
      entries.push(buildFileEntry(fullPath, resolved, stats, stats.isDirectory()));
    } catch {
      continue;
    }
  }

  // Folders first, then alphabetical
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const parent = path.dirname(resolved);
  const parentPath = parent !== resolved ? parent : null;

  return {
    currentPath: resolved,
    parentPath,
    isProtected: safety.isProtected,
    warningMessage: safety.warningMessage,
    entries,
  };
}

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml', '.toml', '.xml',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.c', '.cpp', '.h', '.cs',
  '.go', '.rs', '.rb', '.php', '.html', '.htm', '.css', '.scss', '.sql', '.sh', '.log', '.env', '.ini',
]);

export async function getFilePreview(filePath: string): Promise<FilePreviewPayload> {
  const safety = validatePathForRead(filePath);
  if (!safety.allowed) {
    throw new Error(safety.warningMessage || 'Access denied.');
  }

  const resolved = safety.resolvedPath;
  const stats = await fs.promises.stat(resolved);
  if (!stats.isFile()) {
    throw new Error('Selected path is not a readable file.');
  }

  const entry = buildFileEntry(resolved, path.dirname(resolved), stats, false);
  const ext = entry.extension.toLowerCase();

  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)) {
    return {
      file: entry,
      previewType: 'image',
      mediaUrl: `/api/file/raw?path=${encodeURIComponent(resolved)}`,
    };
  }

  if (ext === '.pdf') {
    return {
      file: entry,
      previewType: 'pdf',
      mediaUrl: `/api/file/raw?path=${encodeURIComponent(resolved)}`,
    };
  }

  if (['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a'].includes(ext)) {
    return {
      file: entry,
      previewType: 'audio',
      mediaUrl: `/api/file/raw?path=${encodeURIComponent(resolved)}`,
    };
  }

  if (['.mp4', '.webm', '.mov', '.m4v'].includes(ext)) {
    return {
      file: entry,
      previewType: 'video',
      mediaUrl: `/api/file/raw?path=${encodeURIComponent(resolved)}`,
    };
  }

  const isSpecialTextName = ['dockerfile', 'makefile', 'readme', 'license', '.gitignore'].includes(
    entry.name.toLowerCase()
  );

  if (TEXT_EXTENSIONS.has(ext) || isSpecialTextName || entry.mimeType.startsWith('text/')) {
    const maxBytes = 128 * 1024;
    const fd = await fs.promises.open(resolved, 'r');
    try {
      const readLen = Math.min(stats.size, maxBytes);
      const buf = Buffer.alloc(readLen);
      await fd.read(buf, 0, readLen, 0);
      return {
        file: entry,
        previewType: 'text',
        textContent: buf.toString('utf8'),
        truncated: stats.size > maxBytes,
      };
    } finally {
      await fd.close();
    }
  }

  return {
    file: entry,
    previewType: 'binary',
  };
}

export async function getFileSha256(filePath: string): Promise<string> {
  const safety = validatePathForRead(filePath);
  if (!safety.allowed) {
    throw new Error(safety.warningMessage || 'Access denied.');
  }
  return computeSingleFileSha256(safety.resolvedPath);
}

export async function previewSmartOrganize(inputPath?: string): Promise<OrganizePreviewResponse> {
  const targetRoot = inputPath ? path.resolve(inputPath) : DEFAULT_WORKSPACE_DIR;
  const safety = validatePathForMutation(targetRoot);

  const scan = await scanDirectory(targetRoot);
  const categoryCounts: Record<FileCategory, number> = {
    Documents: 0,
    Images: 0,
    Videos: 0,
    Audio: 0,
    Archives: 0,
    Applications: 0,
    Code: 0,
    'Other files': 0,
  };

  const proposals: OrganizeProposal[] = [];
  const plannedTargets = new Set<string>();
  let alreadyOrganizedCount = 0;
  let totalBytesToMove = 0;

  for (const file of scan.allFiles) {
    categoryCounts[file.category] += 1;

    const expectedCategoryDir = path.join(scan.rootPath, file.category);
    // Already inside <root>/<Category>/
    if (path.dirname(file.path) === expectedCategoryDir) {
      alreadyOrganizedCount += 1;
      continue;
    }

    const ext = path.extname(file.name);
    const stem = path.basename(file.name, ext);
    let candidateTarget = path.join(expectedCategoryDir, file.name);
    let counter = 1;
    let hasConflict = false;

    while (
      (fs.existsSync(candidateTarget) && candidateTarget !== file.path) ||
      plannedTargets.has(candidateTarget.toLowerCase())
    ) {
      hasConflict = true;
      candidateTarget = path.join(expectedCategoryDir, `${stem} (${counter})${ext}`);
      counter += 1;
    }

    plannedTargets.add(candidateTarget.toLowerCase());
    totalBytesToMove += file.size;

    proposals.push({
      id: crypto.randomUUID(),
      sourcePath: file.path,
      targetPath: candidateTarget,
      relativeSource: path.relative(scan.rootPath, file.path),
      relativeTarget: path.relative(scan.rootPath, candidateTarget),
      fileName: file.name,
      category: file.category,
      extension: file.extension,
      mimeType: file.mimeType,
      reason: file.classificationReason,
      size: file.size,
      hasConflict,
      selected: true,
    });
  }

  return {
    rootPath: scan.rootPath,
    isProtected: !safety.allowed,
    warningMessage: safety.allowed ? undefined : safety.warningMessage,
    proposals,
    categoryCounts,
    totalBytesToMove,
    alreadyOrganizedCount,
  };
}

export async function applySmartOrganize(
  rootPath: string,
  proposals: Array<{ sourcePath: string; targetPath: string; size: number }>
): Promise<OperationRecord> {
  const rootSafety = validatePathForMutation(rootPath);
  if (!rootSafety.allowed) {
    throw new Error(rootSafety.warningMessage || 'Cannot organize a protected directory.');
  }

  if (!proposals || proposals.length === 0) {
    throw new Error('No file moves were selected.');
  }

  const operationId = crypto.randomUUID();
  const items: OperationItem[] = [];
  let totalBytes = 0;

  for (const prop of proposals) {
    const srcSafety = validatePathForMutation(prop.sourcePath);
    const dstSafety = validatePathForMutation(prop.targetPath);
    if (!srcSafety.allowed || !dstSafety.allowed) {
      throw new Error(srcSafety.warningMessage || dstSafety.warningMessage || 'Protected path encountered.');
    }

    if (!fs.existsSync(srcSafety.resolvedPath)) continue;

    let finalDest = dstSafety.resolvedPath;
    if (fs.existsSync(finalDest) && finalDest !== srcSafety.resolvedPath) {
      const ext = path.extname(finalDest);
      const stem = path.basename(finalDest, ext);
      const dir = path.dirname(finalDest);
      let idx = 1;
      while (fs.existsSync(path.join(dir, `${stem} (${idx})${ext}`))) idx++;
      finalDest = path.join(dir, `${stem} (${idx})${ext}`);
    }

    await moveFileAtomic(srcSafety.resolvedPath, finalDest);
    totalBytes += prop.size;
    items.push({
      id: crypto.randomUUID(),
      operationId,
      sourcePath: srcSafety.resolvedPath,
      targetPath: finalDest,
      size: prop.size,
      status: 'moved',
    });
  }

  // Clean up empty legacy subfolders inside rootPath (never delete rootPath or trash)
  try {
    const entries = await fs.promises.readdir(rootSafety.resolvedPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_SCAN_DIRS.has(entry.name)) continue;
      const subDir = path.join(rootSafety.resolvedPath, entry.name);
      const contents = await fs.promises.readdir(subDir);
      if (contents.length === 0) {
        await fs.promises.rmdir(subDir);
      }
    }
  } catch {
    // Ignore cleanup errors for non-empty dirs
  }

  const record: OperationRecord = {
    id: operationId,
    type: 'organize',
    rootPath: rootSafety.resolvedPath,
    summary: `Organized ${items.length} file${items.length === 1 ? '' : 's'} into smart categories`,
    createdAt: Date.now(),
    itemCount: items.length,
    totalBytes,
    undone: false,
    items,
  };

  recordOperation(record);
  return record;
}

export async function safeTrashFiles(
  rootPath: string,
  filePaths: string[],
  customOsTrashHandler?: (filePath: string) => Promise<boolean>
): Promise<OperationRecord> {
  const rootSafety = validatePathForMutation(rootPath);
  if (!rootSafety.allowed) {
    throw new Error(rootSafety.warningMessage || 'Cleanup blocked inside protected directory.');
  }

  if (!filePaths || filePaths.length === 0) {
    throw new Error('No files selected for safe cleanup.');
  }

  const operationId = crypto.randomUUID();
  const vaultDir = path.join(rootSafety.resolvedPath, TRASH_VAULT_DIR_NAME, operationId);
  await fs.promises.mkdir(vaultDir, { recursive: true });

  const items: OperationItem[] = [];
  let totalBytes = 0;

  for (const target of filePaths) {
    const safety = validatePathForMutation(target);
    if (!safety.allowed) {
      throw new Error(safety.warningMessage || `Protected file blocked: ${target}`);
    }

    const resolved = safety.resolvedPath;
    if (!fs.existsSync(resolved)) continue;
    const stats = await fs.promises.stat(resolved);
    if (!stats.isFile()) continue;

    const backupName = `${items.length}_${path.basename(resolved)}`;
    const vaultBackupPath = path.join(vaultDir, backupName);

    let sentToOsBin = false;
    if (customOsTrashHandler) {
      try {
        // Store reversible backup or rely on OS Recycle Bin depending on handler
        sentToOsBin = await customOsTrashHandler(resolved);
      } catch {
        sentToOsBin = false;
      }
    } else if (process.platform === 'win32' || process.platform === 'darwin') {
      try {
        await trash(resolved);
        sentToOsBin = true;
      } catch {
        sentToOsBin = false;
      }
    }

    if (!sentToOsBin) {
      // Move into FileForge's reversible Trash Vault so Undo restores 100% of files safely
      await moveFileAtomic(resolved, vaultBackupPath);
    }

    totalBytes += stats.size;
    items.push({
      id: crypto.randomUUID(),
      operationId,
      sourcePath: resolved,
      targetPath: sentToOsBin ? 'OS Recycle Bin' : vaultBackupPath,
      trashBackupPath: sentToOsBin ? null : vaultBackupPath,
      size: stats.size,
      status: sentToOsBin ? 'os_recycled' : 'trashed_vault',
    });
  }

  const record: OperationRecord = {
    id: operationId,
    type: 'trash',
    rootPath: rootSafety.resolvedPath,
    summary: `Safely moved ${items.length} file${items.length === 1 ? '' : 's'} to Trash / Recycle Bin`,
    createdAt: Date.now(),
    itemCount: items.length,
    totalBytes,
    undone: false,
    items,
  };

  recordOperation(record);
  return record;
}

export async function renameFileSafe(filePath: string, newName: string): Promise<OperationRecord> {
  const safety = validatePathForMutation(filePath);
  if (!safety.allowed) {
    throw new Error(safety.warningMessage || 'Cannot rename files in a protected directory.');
  }

  const sanitized = newName.trim();
  if (!sanitized || sanitized.includes('/') || sanitized.includes('\\') || sanitized.includes('\0')) {
    throw new Error('Invalid filename. Do not include path separators.');
  }

  const resolved = safety.resolvedPath;
  const stats = await fs.promises.stat(resolved);
  const targetPath = path.join(path.dirname(resolved), sanitized);

  if (fs.existsSync(targetPath)) {
    throw new Error(`A file or folder named "${sanitized}" already exists.`);
  }

  await moveFileAtomic(resolved, targetPath);

  const operationId = crypto.randomUUID();
  const record: OperationRecord = {
    id: operationId,
    type: 'rename',
    rootPath: path.dirname(resolved),
    summary: `Renamed "${path.basename(resolved)}" to "${sanitized}"`,
    createdAt: Date.now(),
    itemCount: 1,
    totalBytes: stats.size,
    undone: false,
    items: [
      {
        id: crypto.randomUUID(),
        operationId,
        sourcePath: resolved,
        targetPath,
        size: stats.size,
        status: 'renamed',
      },
    ],
  };

  recordOperation(record);
  return record;
}

export async function undoOperation(operationId: string): Promise<{ restoredCount: number; message: string }> {
  const record = getOperationById(operationId);
  if (!record) {
    throw new Error('Operation record not found.');
  }
  if (record.undone) {
    throw new Error('This operation has already been undone.');
  }

  let restoredCount = 0;

  for (const item of record.items) {
    if (record.type === 'organize' || record.type === 'rename' || record.type === 'move') {
      if (fs.existsSync(item.targetPath)) {
        await moveFileAtomic(item.targetPath, item.sourcePath);
        restoredCount++;
      }
    } else if (record.type === 'trash') {
      if (item.trashBackupPath && fs.existsSync(item.trashBackupPath)) {
        await moveFileAtomic(item.trashBackupPath, item.sourcePath);
        restoredCount++;
      }
    }
  }

  markOperationUndone(operationId);
  return {
    restoredCount,
    message:
      restoredCount > 0
        ? `Restored ${restoredCount} file${restoredCount === 1 ? '' : 's'} to original locations.`
        : 'Marked operation undone. Files sent directly to the OS Recycle Bin can be restored from Windows Recycle Bin.',
  };
}

export function getOperationHistory(limit = 30): OperationRecord[] {
  return listOperations(limit);
}
