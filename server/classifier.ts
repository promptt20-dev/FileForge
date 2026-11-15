import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';
import type { FileCategory } from '../src/shared/types.js';

const EXTENSION_CATEGORY_MAP: Record<string, FileCategory> = {
  // Documents
  '.pdf': 'Documents',
  '.doc': 'Documents',
  '.docx': 'Documents',
  '.odt': 'Documents',
  '.rtf': 'Documents',
  '.txt': 'Documents',
  '.md': 'Documents',
  '.markdown': 'Documents',
  '.csv': 'Documents',
  '.tsv': 'Documents',
  '.xls': 'Documents',
  '.xlsx': 'Documents',
  '.ods': 'Documents',
  '.ppt': 'Documents',
  '.pptx': 'Documents',
  '.odp': 'Documents',
  '.epub': 'Documents',
  '.pages': 'Documents',
  '.numbers': 'Documents',
  '.key': 'Documents',
  '.tex': 'Documents',

  // Images
  '.png': 'Images',
  '.jpg': 'Images',
  '.jpeg': 'Images',
  '.gif': 'Images',
  '.webp': 'Images',
  '.svg': 'Images',
  '.bmp': 'Images',
  '.ico': 'Images',
  '.tiff': 'Images',
  '.tif': 'Images',
  '.heic': 'Images',
  '.heif': 'Images',
  '.avif': 'Images',
  '.raw': 'Images',
  '.psd': 'Images',

  // Videos
  '.mp4': 'Videos',
  '.mkv': 'Videos',
  '.mov': 'Videos',
  '.avi': 'Videos',
  '.wmv': 'Videos',
  '.flv': 'Videos',
  '.webm': 'Videos',
  '.m4v': 'Videos',
  '.mpeg': 'Videos',
  '.mpg': 'Videos',

  // Audio
  '.mp3': 'Audio',
  '.wav': 'Audio',
  '.flac': 'Audio',
  '.aac': 'Audio',
  '.ogg': 'Audio',
  '.opus': 'Audio',
  '.m4a': 'Audio',
  '.wma': 'Audio',
  '.aiff': 'Audio',
  '.mid': 'Audio',
  '.midi': 'Audio',

  // Archives
  '.zip': 'Archives',
  '.rar': 'Archives',
  '.7z': 'Archives',
  '.tar': 'Archives',
  '.gz': 'Archives',
  '.tgz': 'Archives',
  '.bz2': 'Archives',
  '.xz': 'Archives',
  '.iso': 'Archives',
  '.cab': 'Archives',

  // Applications
  '.exe': 'Applications',
  '.msi': 'Applications',
  '.msix': 'Applications',
  '.appx': 'Applications',
  '.bat': 'Applications',
  '.cmd': 'Applications',
  '.ps1': 'Applications',
  '.dmg': 'Applications',
  '.pkg': 'Applications',
  '.appimage': 'Applications',
  '.deb': 'Applications',
  '.rpm': 'Applications',
  '.apk': 'Applications',
  '.dll': 'Applications',

  // Code
  '.ts': 'Code',
  '.tsx': 'Code',
  '.js': 'Code',
  '.jsx': 'Code',
  '.mjs': 'Code',
  '.cjs': 'Code',
  '.py': 'Code',
  '.java': 'Code',
  '.c': 'Code',
  '.cpp': 'Code',
  '.h': 'Code',
  '.hpp': 'Code',
  '.cs': 'Code',
  '.go': 'Code',
  '.rs': 'Code',
  '.rb': 'Code',
  '.php': 'Code',
  '.swift': 'Code',
  '.kt': 'Code',
  '.html': 'Code',
  '.htm': 'Code',
  '.css': 'Code',
  '.scss': 'Code',
  '.less': 'Code',
  '.json': 'Code',
  '.yaml': 'Code',
  '.yml': 'Code',
  '.toml': 'Code',
  '.xml': 'Code',
  '.sql': 'Code',
  '.sh': 'Code',
  '.bash': 'Code',
  '.zsh': 'Code',
  '.vue': 'Code',
  '.svelte': 'Code',
  '.env': 'Code',
};

const SPECIAL_CODE_FILENAMES = new Set([
  'dockerfile',
  'makefile',
  'cmakelists.txt',
  'package.json',
  'tsconfig.json',
  'cargo.toml',
  'go.mod',
  '.gitignore',
  '.editorconfig',
  '.prettierrc',
  '.eslintrc',
]);

const SPECIAL_DOCUMENT_FILENAMES = new Set([
  'readme',
  'readme.txt',
  'readme.md',
  'license',
  'license.txt',
  'changelog',
  'changelog.md',
]);

interface MagicSignature {
  category: FileCategory;
  mimeType: string;
  label: string;
}

function sniffMagicBytes(filePath: string, size: number): MagicSignature | null {
  if (size < 4) return null;
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    if (bytesRead < 4) return null;

    // PDF: %PDF-
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
      return { category: 'Documents', mimeType: 'application/pdf', label: 'Magic header (%PDF)' };
    }
    // PNG: 89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { category: 'Images', mimeType: 'image/png', label: 'Magic header (PNG)' };
    }
    // JPEG: FF D8 FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return { category: 'Images', mimeType: 'image/jpeg', label: 'Magic header (JPEG)' };
    }
    // GIF: GIF8
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
      return { category: 'Images', mimeType: 'image/gif', label: 'Magic header (GIF)' };
    }
    // RIFF WAVE / WEBP
    if (buf.toString('ascii', 0, 4) === 'RIFF' && bytesRead >= 12) {
      const sub = buf.toString('ascii', 8, 12);
      if (sub === 'WAVE') {
        return { category: 'Audio', mimeType: 'audio/wav', label: 'Magic header (RIFF WAVE)' };
      }
      if (sub === 'WEBP') {
        return { category: 'Images', mimeType: 'image/webp', label: 'Magic header (RIFF WEBP)' };
      }
      if (sub === 'AVI ') {
        return { category: 'Videos', mimeType: 'video/x-msvideo', label: 'Magic header (RIFF AVI)' };
      }
    }
    // MP3 ID3
    if (buf.toString('ascii', 0, 3) === 'ID3') {
      return { category: 'Audio', mimeType: 'audio/mpeg', label: 'Magic header (ID3 MP3)' };
    }
    // MP4 / MOV ftyp
    if (bytesRead >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') {
      return { category: 'Videos', mimeType: 'video/mp4', label: 'Magic header (ISO BMFF/MP4)' };
    }
    // ZIP: PK 03 04
    if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)) {
      return { category: 'Archives', mimeType: 'application/zip', label: 'Magic header (PKZip)' };
    }
    // GZIP: 1F 8B
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      return { category: 'Archives', mimeType: 'application/gzip', label: 'Magic header (GZIP)' };
    }
    // Windows PE executable: MZ
    if (buf[0] === 0x4d && buf[1] === 0x5a) {
      return { category: 'Applications', mimeType: 'application/vnd.microsoft.portable-executable', label: 'Magic header (Win32/64 PE)' };
    }
    // ELF binary
    if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
      return { category: 'Applications', mimeType: 'application/x-elf', label: 'Magic header (ELF binary)' };
    }
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors
      }
    }
  }
  return null;
}

function classifyByMime(mimeType: string): FileCategory | null {
  if (!mimeType || mimeType === 'application/octet-stream') return null;
  if (mimeType.startsWith('image/')) return 'Images';
  if (mimeType.startsWith('video/')) return 'Videos';
  if (mimeType.startsWith('audio/')) return 'Audio';
  if (
    mimeType === 'application/pdf' ||
    mimeType.includes('wordprocessingml') ||
    mimeType.includes('spreadsheetml') ||
    mimeType.includes('presentationml') ||
    mimeType.includes('msword') ||
    mimeType.includes('ms-excel') ||
    mimeType.includes('ms-powerpoint') ||
    mimeType === 'text/plain' ||
    mimeType === 'text/markdown' ||
    mimeType === 'text/csv'
  ) {
    return 'Documents';
  }
  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-rar-compressed' ||
    mimeType === 'application/x-7z-compressed' ||
    mimeType === 'application/gzip' ||
    mimeType === 'application/x-tar'
  ) {
    return 'Archives';
  }
  if (
    mimeType === 'application/x-msdownload' ||
    mimeType === 'application/vnd.microsoft.portable-executable' ||
    mimeType === 'application/x-msi'
  ) {
    return 'Applications';
  }
  if (
    mimeType === 'application/json' ||
    mimeType === 'application/javascript' ||
    mimeType === 'text/javascript' ||
    mimeType === 'text/html' ||
    mimeType === 'text/css' ||
    mimeType === 'application/xml' ||
    mimeType === 'text/x-python'
  ) {
    return 'Code';
  }
  return null;
}

export interface ClassificationResult {
  category: FileCategory;
  mimeType: string;
  reason: string;
}

export function classifyFile(
  filePath: string,
  fileName: string,
  extension: string,
  size: number
): ClassificationResult {
  const extLower = extension.toLowerCase();
  const nameLower = fileName.toLowerCase();

  const magic = sniffMagicBytes(filePath, size);
  const lookedUpMime = mime.lookup(fileName) || '';
  const mimeType = magic?.mimeType || lookedUpMime || 'application/octet-stream';

  const signals: string[] = [];

  // 1. Magic byte signature takes priority for binary formats (or misnamed files)
  if (magic) {
    signals.push(magic.label);
    if (extLower) signals.push(`Extension (${extLower})`);
    if (lookedUpMime) signals.push(`MIME (${mimeType})`);
    return {
      category: magic.category,
      mimeType,
      reason: signals.join(' · '),
    };
  }

  // 2. Special filename conventions (Dockerfile, README, etc.)
  if (SPECIAL_CODE_FILENAMES.has(nameLower)) {
    return {
      category: 'Code',
      mimeType: lookedUpMime || 'text/plain',
      reason: `Filename pattern (${fileName}) · Developer config/source`,
    };
  }
  if (SPECIAL_DOCUMENT_FILENAMES.has(nameLower)) {
    return {
      category: 'Documents',
      mimeType: lookedUpMime || 'text/plain',
      reason: `Filename pattern (${fileName}) · Documentation`,
    };
  }

  // 3. Extension mapping
  const extCategory = EXTENSION_CATEGORY_MAP[extLower];
  if (extCategory) {
    signals.push(`Extension (${extLower})`);
    if (lookedUpMime) {
      signals.push(`MIME (${lookedUpMime})`);
    }
    if (/invoice|report|contract|statement|resume|cv|notes/i.test(nameLower) && extCategory === 'Documents') {
      signals.push('Filename keyword');
    } else if (/screenshot|img_|dsc_|photo|wallpaper|banner/i.test(nameLower) && extCategory === 'Images') {
      signals.push('Filename keyword');
    } else if (/setup|installer|portable/i.test(nameLower) && extCategory === 'Applications') {
      signals.push('Filename keyword');
    }
    return {
      category: extCategory,
      mimeType,
      reason: signals.join(' · '),
    };
  }

  // 4. MIME fallback
  const mimeCategory = classifyByMime(mimeType);
  if (mimeCategory) {
    return {
      category: mimeCategory,
      mimeType,
      reason: `MIME (${mimeType})`,
    };
  }

  // 5. Name-based fallback for extensionless files
  if (/invoice|receipt|notes|memo|report|letter/i.test(nameLower)) {
    return {
      category: 'Documents',
      mimeType: 'text/plain',
      reason: `Filename heuristic (${fileName})`,
    };
  }
  if (/setup|install|launcher/i.test(nameLower)) {
    return {
      category: 'Applications',
      mimeType,
      reason: `Filename heuristic (${fileName})`,
    };
  }

  return {
    category: 'Other files',
    mimeType,
    reason: extLower ? `Unmapped extension (${extLower})` : 'Unclassified binary/metadata',
  };
}
