import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FileEntry, OperationItem, OperationRecord } from '../src/shared/types.js';

let dbInstance: DatabaseSync | null = null;

export function getDb(customDbDir?: string): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dataDir = customDbDir || path.join(os.tmpdir(), 'fileforge-sqlite');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'fileforge.db');

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      scanned_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      total_files INTEGER NOT NULL,
      total_folders INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL,
      duplicate_groups INTEGER NOT NULL,
      recoverable_bytes INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS indexed_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id TEXT NOT NULL,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_path TEXT NOT NULL,
      size INTEGER NOT NULL,
      extension TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      modified_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL,
      sha256 TEXT,
      FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_indexed_files_scan ON indexed_files(scan_id);
    CREATE INDEX IF NOT EXISTS idx_indexed_files_hash ON indexed_files(sha256);

    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      root_path TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      item_count INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL,
      undone INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS operation_items (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
      trash_backup_path TEXT,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE
    );
  `);

  dbInstance = db;
  return db;
}

export function saveScanMetadata(params: {
  scanId: string;
  rootPath: string;
  scannedAt: number;
  durationMs: number;
  totalFiles: number;
  totalFolders: number;
  totalBytes: number;
  duplicateGroups: number;
  recoverableBytes: number;
  files: FileEntry[];
}) {
  const db = getDb();

  db.exec('BEGIN');
  try {
    // Keep only recent 15 scans to prevent unbounded db growth
    db.prepare(`
      DELETE FROM scans WHERE id NOT IN (
        SELECT id FROM scans ORDER BY scanned_at DESC LIMIT 14
      )
    `).run();

    db.prepare(`
      INSERT INTO scans (id, root_path, scanned_at, duration_ms, total_files, total_folders, total_bytes, duplicate_groups, recoverable_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.scanId,
      params.rootPath,
      params.scannedAt,
      params.durationMs,
      params.totalFiles,
      params.totalFolders,
      params.totalBytes,
      params.duplicateGroups,
      params.recoverableBytes
    );

    const insertFile = db.prepare(`
      INSERT INTO indexed_files (scan_id, path, name, parent_path, size, extension, mime_type, category, created_at, modified_at, accessed_at, sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const file of params.files) {
      insertFile.run(
        params.scanId,
        file.path,
        file.name,
        file.parentPath,
        file.size,
        file.extension,
        file.mimeType,
        file.category,
        file.createdAt,
        file.modifiedAt,
        file.accessedAt,
        file.sha256 || null
      );
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function recordOperation(record: OperationRecord) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO operations (id, type, root_path, summary, created_at, item_count, total_bytes, undone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.type,
      record.rootPath,
      record.summary,
      record.createdAt,
      record.itemCount,
      record.totalBytes,
      record.undone ? 1 : 0
    );

    const insertItem = db.prepare(`
      INSERT INTO operation_items (id, operation_id, source_path, target_path, trash_backup_path, size, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of record.items) {
      insertItem.run(
        item.id,
        record.id,
        item.sourcePath,
        item.targetPath,
        item.trashBackupPath || null,
        item.size,
        item.status
      );
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listOperations(limit = 30): OperationRecord[] {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT id, type, root_path, summary, created_at, item_count, total_bytes, undone
      FROM operations
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(limit) as Array<{
    id: string;
    type: OperationRecord['type'];
    root_path: string;
    summary: string;
    created_at: number;
    item_count: number;
    total_bytes: number;
    undone: number;
  }>;

  const itemStmt = db.prepare(`
    SELECT id, operation_id, source_path, target_path, trash_backup_path, size, status
    FROM operation_items
    WHERE operation_id = ?
  `);

  return rows.map((row) => {
    const rawItems = itemStmt.all(row.id) as Array<{
      id: string;
      operation_id: string;
      source_path: string;
      target_path: string;
      trash_backup_path: string | null;
      size: number;
      status: string;
    }>;

    const items: OperationItem[] = rawItems.map((it) => ({
      id: it.id,
      operationId: it.operation_id,
      sourcePath: it.source_path,
      targetPath: it.target_path,
      trashBackupPath: it.trash_backup_path,
      size: it.size,
      status: it.status,
    }));

    return {
      id: row.id,
      type: row.type,
      rootPath: row.root_path,
      summary: row.summary,
      createdAt: row.created_at,
      itemCount: row.item_count,
      totalBytes: row.total_bytes,
      undone: Boolean(row.undone),
      items,
    };
  });
}

export function getOperationById(operationId: string): OperationRecord | null {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT id, type, root_path, summary, created_at, item_count, total_bytes, undone
      FROM operations
      WHERE id = ?
    `)
    .get(operationId) as
    | {
        id: string;
        type: OperationRecord['type'];
        root_path: string;
        summary: string;
        created_at: number;
        item_count: number;
        total_bytes: number;
        undone: number;
      }
    | undefined;

  if (!row) return null;

  const rawItems = db
    .prepare(`
      SELECT id, operation_id, source_path, target_path, trash_backup_path, size, status
      FROM operation_items
      WHERE operation_id = ?
    `)
    .all(row.id) as Array<{
    id: string;
    operation_id: string;
    source_path: string;
    target_path: string;
    trash_backup_path: string | null;
    size: number;
    status: string;
  }>;

  return {
    id: row.id,
    type: row.type,
    rootPath: row.root_path,
    summary: row.summary,
    createdAt: row.created_at,
    itemCount: row.item_count,
    totalBytes: row.total_bytes,
    undone: Boolean(row.undone),
    items: rawItems.map((it) => ({
      id: it.id,
      operationId: it.operation_id,
      sourcePath: it.source_path,
      targetPath: it.target_path,
      trashBackupPath: it.trash_backup_path,
      size: it.size,
      status: it.status,
    })),
  };
}

export function markOperationUndone(operationId: string) {
  const db = getDb();
  db.prepare(`UPDATE operations SET undone = 1 WHERE id = ?`).run(operationId);
}
