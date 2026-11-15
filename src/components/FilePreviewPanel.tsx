import { useEffect, useState } from 'react';
import {
  Check,
  Edit3,
  ExternalLink,
  FileCode2,
  FileText,
  Fingerprint,
  Image as ImageIcon,
  Music,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { fileforgeClient, formatBytes, formatDateTime } from '../api/fileforgeClient';
import type { FileEntry, FilePreviewPayload } from '../shared/types';

interface FilePreviewPanelProps {
  file: FileEntry | null;
  onClose: () => void;
  onRequestTrash: (file: FileEntry) => void;
  onFileRenamed: () => void;
}

export function FilePreviewPanel({ file, onClose, onRequestTrash, onFileRenamed }: FilePreviewPanelProps) {
  const [payload, setPayload] = useState<FilePreviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [computedHash, setComputedHash] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!file || file.isDirectory) {
      setPayload(null);
      setComputedHash(null);
      setRenaming(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setActionError(null);
    setComputedHash(file.sha256 || null);
    setNewName(file.name);
    setRenaming(false);

    fileforgeClient
      .previewFile(file.path)
      .then((res) => {
        if (!cancelled) setPayload(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  if (!file) return null;

  async function handleComputeHash() {
    if (!file) return;
    setHashing(true);
    setActionError(null);
    try {
      const res = await fileforgeClient.hashFile(file.path);
      setComputedHash(res.sha256);
    } catch (err: unknown) {
      setActionError((err as Error).message);
    } finally {
      setHashing(false);
    }
  }

  async function handleConfirmRename() {
    if (!file || !newName.trim() || newName.trim() === file.name) {
      setRenaming(false);
      return;
    }
    setActionError(null);
    try {
      await fileforgeClient.renameFile(file.path, newName.trim());
      setRenaming(false);
      onFileRenamed();
    } catch (err: unknown) {
      setActionError((err as Error).message);
    }
  }

  return (
    <aside className="w-96 shrink-0 border-l border-white/8 bg-[#151520] flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
        <div className="min-w-0">
          <p className="text-xs text-[#A1A1AA]">File Inspector</p>
          <h3 className="text-sm font-semibold text-[#F8FAFC] truncate" title={file.name}>
            {file.name}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview panel"
          className="p-1.5 rounded-lg text-[#A1A1AA] hover:text-[#F8FAFC] hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Action Bar */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileforgeClient.openWithOS(file.path)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-[#F8FAFC] transition-colors whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open File
          </button>
          <button
            type="button"
            onClick={() => {
              setNewName(file.name);
              setRenaming((prev) => !prev);
            }}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-white/10 hover:bg-white/5 text-[#F8FAFC] transition-colors whitespace-nowrap"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Rename
          </button>
          <button
            type="button"
            onClick={() => onRequestTrash(file)}
            aria-label="Move file to trash"
            className="inline-flex items-center justify-center p-2 text-xs font-medium rounded-lg border border-white/10 hover:border-red-500/40 hover:bg-red-500/10 text-[#A1A1AA] hover:text-red-300 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {renaming && (
          <div className="p-3 rounded-lg bg-[#0B0B12] border border-[#8B5CF6]/40 space-y-2">
            <label className="block text-xs text-[#A1A1AA]">New filename</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmRename();
                  if (e.key === 'Escape') setRenaming(false);
                }}
                className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-[#151520] border border-white/10 rounded-md text-[#F8FAFC] focus:outline-none focus:border-[#8B5CF6]"
              />
              <button
                type="button"
                onClick={handleConfirmRename}
                className="p-1.5 rounded-md bg-[#8B5CF6] text-[#F8FAFC] hover:bg-[#7C3AED]"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {actionError && (
          <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-300">
            {actionError}
          </div>
        )}

        {/* Content Preview */}
        <div className="rounded-lg bg-[#0B0B12] border border-white/8 overflow-hidden">
          {loading ? (
            <div className="h-44 flex items-center justify-center text-xs text-[#A1A1AA]">Loading preview...</div>
          ) : error ? (
            <div className="p-4 text-xs text-red-300">{error}</div>
          ) : payload?.previewType === 'image' && payload.mediaUrl ? (
            <div className="p-3 flex flex-col items-center justify-center bg-[#0B0B12]">
              <img
                src={payload.mediaUrl}
                alt={file.name}
                referrerPolicy="no-referrer"
                className="max-h-56 w-auto rounded object-contain"
              />
            </div>
          ) : payload?.previewType === 'text' ? (
            <div className="max-h-64 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-[#F8FAFC]/90 whitespace-pre-wrap break-words">
              {payload.textContent || '(Empty file)'}
              {payload.truncated && (
                <p className="mt-2 pt-2 border-t border-white/8 text-[#A1A1AA]">
                  Preview truncated at 128 KB. Open file to inspect full contents.
                </p>
              )}
            </div>
          ) : payload?.previewType === 'pdf' && payload.mediaUrl ? (
            <iframe
              src={payload.mediaUrl}
              title={file.name}
              className="w-full h-56 bg-white"
            />
          ) : payload?.previewType === 'audio' && payload.mediaUrl ? (
            <div className="p-4 flex flex-col items-center gap-3">
              <Music className="w-8 h-8 text-[#06B6D4]" />
              <audio controls src={payload.mediaUrl} className="w-full h-9" />
            </div>
          ) : payload?.previewType === 'video' && payload.mediaUrl ? (
            <video controls src={payload.mediaUrl} className="w-full max-h-56 bg-black" />
          ) : (
            <div className="h-36 flex flex-col items-center justify-center gap-2 text-[#A1A1AA] p-4 text-center">
              {file.category === 'Images' ? (
                <ImageIcon className="w-7 h-7 text-[#06B6D4]" />
              ) : file.category === 'Code' ? (
                <FileCode2 className="w-7 h-7 text-[#8B5CF6]" />
              ) : file.category === 'Videos' ? (
                <Video className="w-7 h-7 text-[#06B6D4]" />
              ) : (
                <FileText className="w-7 h-7 text-[#A1A1AA]" />
              )}
              <p className="text-xs">Binary format ({file.mimeType})</p>
              <p className="text-[11px] text-[#A1A1AA]/70">Use Open File to launch in OS application.</p>
            </div>
          )}
        </div>

        {/* Metadata Table */}
        <div className="space-y-2.5">
          <h4 className="text-xs font-medium text-[#A1A1AA]">Metadata & Classification</h4>
          <dl className="divide-y divide-white/6 rounded-lg bg-[#0B0B12] border border-white/8 text-xs">
            <div className="flex items-center justify-between px-3 py-2 gap-3">
              <dt className="text-[#A1A1AA]">Category</dt>
              <dd className="text-[#F8FAFC] font-medium">{file.category}</dd>
            </div>
            <div className="flex items-center justify-between px-3 py-2 gap-3">
              <dt className="text-[#A1A1AA]">Size</dt>
              <dd className="font-mono text-[#F8FAFC] tabular-nums">
                {formatBytes(file.size)} ({file.size.toLocaleString()} B)
              </dd>
            </div>
            <div className="flex items-center justify-between px-3 py-2 gap-3">
              <dt className="text-[#A1A1AA]">MIME Type</dt>
              <dd className="font-mono text-[#F8FAFC] truncate max-w-[200px]" title={file.mimeType}>
                {file.mimeType}
              </dd>
            </div>
            <div className="flex items-center justify-between px-3 py-2 gap-3">
              <dt className="text-[#A1A1AA]">Modified</dt>
              <dd className="font-mono text-[#F8FAFC] tabular-nums">{formatDateTime(file.modifiedAt)}</dd>
            </div>
            <div className="flex items-center justify-between px-3 py-2 gap-3">
              <dt className="text-[#A1A1AA]">Created</dt>
              <dd className="font-mono text-[#F8FAFC] tabular-nums">{formatDateTime(file.createdAt)}</dd>
            </div>
            <div className="px-3 py-2 space-y-1">
              <dt className="text-[#A1A1AA]">Signals</dt>
              <dd className="text-[#F8FAFC]/90 leading-snug">{file.classificationReason}</dd>
            </div>
            <div className="px-3 py-2 space-y-1">
              <dt className="text-[#A1A1AA]">Full Path</dt>
              <dd className="font-mono text-[11px] text-[#A1A1AA] break-all">{file.path}</dd>
            </div>
          </dl>
        </div>

        {/* Cryptographic Checksum */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-[#A1A1AA]">SHA-256 Digest</h4>
            {!computedHash && (
              <button
                type="button"
                onClick={handleComputeHash}
                disabled={hashing}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#06B6D4] hover:text-[#22D3EE] transition-colors"
              >
                <Fingerprint className="w-3.5 h-3.5" />
                {hashing ? 'Hashing...' : 'Compute SHA-256'}
              </button>
            )}
          </div>
          <div className="p-2.5 rounded-lg bg-[#0B0B12] border border-white/8 font-mono text-[11px] text-[#A1A1AA] break-all">
            {computedHash || 'Click Compute SHA-256 or run a scan to verify byte identity.'}
          </div>
        </div>
      </div>
    </aside>
  );
}
