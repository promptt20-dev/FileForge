import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';
import { createServer as createViteServer } from 'vite';
import { getDb } from './server/db.js';
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
} from './server/fsEngine.js';
import { DEFAULT_WORKSPACE_DIR, getQuickRoots, validatePathForMutation, validatePathForRead } from './server/safety.js';
import { ensureSeededWorkspace } from './server/seedWorkspace.js';

const PORT = 3000;

async function startServer() {
  // Initialize SQLite and seed real demo workspace if empty
  getDb();
  ensureSeededWorkspace();

  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // System capabilities & quick roots
  app.get('/api/system/capabilities', (_req, res) => {
    res.json({
      runtime: 'web',
      platform: process.platform,
      defaultWorkspacePath: DEFAULT_WORKSPACE_DIR,
      quickRoots: getQuickRoots(),
      trashMode: process.platform === 'win32' || process.platform === 'darwin' ? 'os-recycle-bin' : 'recoverable-vault',
    });
  });

  // Reset/re-seed default workspace safely if user wants fresh sample files
  app.post('/api/workspace/reseed', async (_req, res) => {
    try {
      ensureSeededWorkspace();
      const result = await scanDirectory(DEFAULT_WORKSPACE_DIR);
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Full recursive scan + worker-thread SHA-256 duplicate detection + storage analytics
  app.post('/api/scan', async (req, res) => {
    try {
      const { targetPath, staleDays } = req.body || {};
      const result = await scanDirectory(targetPath, { staleDays });
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // File explorer directory listing
  app.get('/api/explorer/list', async (req, res) => {
    try {
      const targetPath = typeof req.query.path === 'string' ? req.query.path : undefined;
      const listing = await listDirectory(targetPath);
      res.json(listing);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Create real subfolder inside active non-protected directory
  app.post('/api/explorer/mkdir', async (req, res) => {
    try {
      const { parentPath, folderName } = req.body || {};
      const safeName = String(folderName || '').trim();
      if (!safeName || safeName.includes('/') || safeName.includes('\\')) {
        return res.status(400).json({ error: 'Invalid folder name.' });
      }
      const target = path.join(path.resolve(parentPath || DEFAULT_WORKSPACE_DIR), safeName);
      const safety = validatePathForMutation(target);
      if (!safety.allowed) {
        return res.status(403).json({ error: safety.warningMessage || 'Protected directory.' });
      }
      await fs.promises.mkdir(safety.resolvedPath, { recursive: true });
      res.json({ createdPath: safety.resolvedPath });
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Upload real files from user browser into a safe workspace folder
  app.post('/api/explorer/upload', async (req, res) => {
    try {
      const { targetDir, files } = req.body as {
        targetDir?: string;
        files?: Array<{ name: string; base64: string }>;
      };
      const destDir = path.resolve(targetDir || DEFAULT_WORKSPACE_DIR);
      const safety = validatePathForMutation(destDir);
      if (!safety.allowed) {
        return res.status(403).json({ error: safety.warningMessage || 'Protected directory.' });
      }
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'No files provided.' });
      }
      await fs.promises.mkdir(safety.resolvedPath, { recursive: true });
      const written: string[] = [];
      for (const f of files) {
        const cleanName = path.basename(String(f.name || 'uploaded_file')).replace(/\0/g, '');
        const destFile = path.join(safety.resolvedPath, cleanName);
        const buf = Buffer.from(f.base64, 'base64');
        await fs.promises.writeFile(destFile, buf);
        written.push(destFile);
      }
      res.json({ uploaded: written });
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // File metadata + preview content
  app.get('/api/file/preview', async (req, res) => {
    try {
      const filePath = typeof req.query.path === 'string' ? req.query.path : '';
      if (!filePath) return res.status(400).json({ error: 'Missing file path.' });
      const payload = await getFilePreview(filePath);
      res.json(payload);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Raw file stream for image, pdf, audio, video, and download/OS open fallback
  app.get('/api/file/raw', async (req, res) => {
    try {
      const filePath = typeof req.query.path === 'string' ? req.query.path : '';
      const safety = validatePathForRead(filePath);
      if (!safety.allowed) {
        return res.status(403).send(safety.warningMessage || 'Access denied');
      }
      if (!fs.existsSync(safety.resolvedPath)) {
        return res.status(404).send('File not found');
      }
      const stat = await fs.promises.stat(safety.resolvedPath);
      if (!stat.isFile()) {
        return res.status(400).send('Not a file');
      }
      const contentType = mime.lookup(safety.resolvedPath) || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(safety.resolvedPath)}"`);
      }
      fs.createReadStream(safety.resolvedPath).pipe(res);
    } catch (err: unknown) {
      res.status(400).send((err as Error).message);
    }
  });

  // On-demand streaming SHA-256 checksum
  app.post('/api/file/hash', async (req, res) => {
    try {
      const { filePath } = req.body || {};
      const sha256 = await getFileSha256(filePath);
      res.json({ filePath, sha256 });
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Safe rename with SQLite undo log
  app.post('/api/file/rename', async (req, res) => {
    try {
      const { filePath, newName } = req.body || {};
      const op = await renameFileSafe(filePath, newName);
      res.json(op);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Smart File Organizer: dry-run preview
  app.post('/api/organizer/preview', async (req, res) => {
    try {
      const { targetPath } = req.body || {};
      const preview = await previewSmartOrganize(targetPath);
      res.json(preview);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Smart File Organizer: execute approved moves
  app.post('/api/organizer/apply', async (req, res) => {
    try {
      const { rootPath, proposals } = req.body || {};
      const record = await applySmartOrganize(rootPath, proposals);
      res.json(record);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Safe Cleanup: move selected files to Trash / Recycle Bin with undo journal
  app.post('/api/cleanup/trash', async (req, res) => {
    try {
      const { rootPath, filePaths } = req.body || {};
      const record = await safeTrashFiles(rootPath, filePaths);
      res.json(record);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Operation history & undo
  app.get('/api/operations', (_req, res) => {
    try {
      const history = getOperationHistory(40);
      res.json(history);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/operations/undo', async (req, res) => {
    try {
      const { operationId } = req.body || {};
      const result = await undoOperation(operationId);
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Vite dev middleware or static production build
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FileForge server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start FileForge server:', err);
  process.exit(1);
});
