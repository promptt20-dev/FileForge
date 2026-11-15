import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { QuickRoot } from '../src/shared/types.js';

const APP_PROJECT_ROOT = path.resolve(process.cwd());
export const DEFAULT_WORKSPACE_DIR = path.join(APP_PROJECT_ROOT, 'workspace_files');
export const TRASH_VAULT_DIR_NAME = '.fileforge_trash';

// Protected system paths across Windows 10/11, macOS, and Linux
const UNIX_PROTECTED_EXACT = new Set([
  '/',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib32',
  '/lib64',
  '/proc',
  '/root',
  '/run',
  '/sbin',
  '/sys',
  '/usr',
  '/var',
  '/System',
  '/Library',
  '/Applications',
]);

const WINDOWS_PROTECTED_PREFIXES = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
  'c:\\$recycle.bin',
  'c:\\system volume information',
  'c:\\recovery',
  'c:\\boot',
];

export interface PathSafetyCheck {
  allowed: boolean;
  isProtected: boolean;
  isAppSource: boolean;
  warningMessage?: string;
  resolvedPath: string;
}

export function normalizeComparablePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isProtectedSystemPath(targetPath: string): {
  isProtected: boolean;
  isAppSource: boolean;
  reason?: string;
} {
  if (!targetPath || typeof targetPath !== 'string' || targetPath.includes('\0')) {
    return { isProtected: true, isAppSource: false, reason: 'Invalid or malformed filesystem path.' };
  }

  const resolved = path.resolve(targetPath);
  const comparable = normalizeComparablePath(resolved);

  // Windows drive root (e.g. C:\)
  if (/^[a-z]:\\?$/i.test(resolved)) {
    return {
      isProtected: true,
      isAppSource: false,
      reason: 'Drive root directories are protected. Select a specific subfolder instead.',
    };
  }

  // Windows system directories
  for (const prefix of WINDOWS_PROTECTED_PREFIXES) {
    if (comparable === prefix || comparable.startsWith(prefix + '\\')) {
      return {
        isProtected: true,
        isAppSource: false,
        reason: `Protected Windows system directory (${resolved}). Modifications are blocked to prevent OS instability.`,
      };
    }
  }

  // Unix system directories
  if (UNIX_PROTECTED_EXACT.has(resolved)) {
    return {
      isProtected: true,
      isAppSource: false,
      reason: `Protected operating system directory (${resolved}). Destructive operations are blocked.`,
    };
  }

  for (const protectedDir of ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/sbin', '/sys', '/usr', '/System']) {
    if (resolved === protectedDir || resolved.startsWith(protectedDir + '/')) {
      return {
        isProtected: true,
        isAppSource: false,
        reason: `Protected OS directory (${protectedDir}). Read-only inspection only.`,
      };
    }
  }

  // Protect FileForge's own application code & node_modules from accidental modification
  const appProtectedDirs = ['src', 'server', 'electron', 'node_modules', 'dist', 'public', '.git'];
  for (const sub of appProtectedDirs) {
    const protectedSub = path.join(APP_PROJECT_ROOT, sub);
    if (resolved === protectedSub || resolved.startsWith(protectedSub + path.sep)) {
      return {
        isProtected: true,
        isAppSource: true,
        reason: 'Application source and dependency directories are protected from automated cleanup.',
      };
    }
  }

  if (resolved === APP_PROJECT_ROOT) {
    return {
      isProtected: true,
      isAppSource: true,
      reason: 'Project root contains FileForge application source files. Use workspace_files or a user folder for organization and cleanup.',
    };
  }

  return { isProtected: false, isAppSource: false };
}

export function validatePathForRead(targetPath: string): PathSafetyCheck {
  if (!targetPath || typeof targetPath !== 'string' || targetPath.includes('\0')) {
    return {
      allowed: false,
      isProtected: true,
      isAppSource: false,
      warningMessage: 'Invalid path provided.',
      resolvedPath: DEFAULT_WORKSPACE_DIR,
    };
  }

  const resolved = path.resolve(targetPath);
  const safety = isProtectedSystemPath(resolved);

  // Never allow reading /proc, /sys, /dev, or Windows Recycle Bin directly
  const hardBlockedPrefixes = ['/proc', '/sys', '/dev', 'c:\\$recycle.bin', 'c:\\system volume information'];
  const comparable = normalizeComparablePath(resolved);
  for (const blocked of hardBlockedPrefixes) {
    if (comparable === blocked || comparable.startsWith(blocked + path.sep)) {
      return {
        allowed: false,
        isProtected: true,
        isAppSource: false,
        warningMessage: `Access denied: ${resolved} is a restricted kernel or system volume location.`,
        resolvedPath: resolved,
      };
    }
  }

  return {
    allowed: true,
    isProtected: safety.isProtected,
    isAppSource: safety.isAppSource,
    warningMessage: safety.reason,
    resolvedPath: resolved,
  };
}

export function validatePathForMutation(targetPath: string): PathSafetyCheck {
  const readCheck = validatePathForRead(targetPath);
  if (!readCheck.allowed) {
    return readCheck;
  }
  if (readCheck.isProtected) {
    return {
      ...readCheck,
      allowed: false,
      warningMessage:
        readCheck.warningMessage ||
        'Protected directory: FileForge refuses automated move, rename, or trash operations inside system directories.',
    };
  }
  return readCheck;
}

export function getQuickRoots(): QuickRoot[] {
  const roots: QuickRoot[] = [
    {
      label: 'FileForge Workspace',
      path: DEFAULT_WORKSPACE_DIR,
      description: 'Dedicated managed workspace with real files',
      isDefaultWorkspace: true,
    },
  ];

  const home = os.homedir();
  const candidateHomes = [
    { label: 'Downloads', dir: path.join(home, 'Downloads'), desc: 'User Downloads directory' },
    { label: 'Documents', dir: path.join(home, 'Documents'), desc: 'User Documents directory' },
    { label: 'Desktop', dir: path.join(home, 'Desktop'), desc: 'User Desktop directory' },
  ];

  for (const item of candidateHomes) {
    try {
      if (fs.existsSync(item.dir) && fs.statSync(item.dir).isDirectory()) {
        roots.push({
          label: item.label,
          path: item.dir,
          description: item.desc,
          isDefaultWorkspace: false,
        });
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  const tmpDir = os.tmpdir();
  if (fs.existsSync(tmpDir)) {
    roots.push({
      label: 'Temp Directory',
      path: tmpDir,
      description: 'System temporary files folder',
      isDefaultWorkspace: false,
    });
  }

  return roots;
}
