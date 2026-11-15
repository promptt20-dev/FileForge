import { AlertTriangle, CheckCircle2, ShieldAlert, Trash2, FolderOutput, X } from 'lucide-react';
import { formatBytes } from '../api/fileforgeClient';

export interface CleanupActionPreview {
  mode: 'trash' | 'organize';
  title: string;
  description: string;
  rootPath: string;
  isProtectedWarning?: boolean;
  items: Array<{
    sourcePath: string;
    targetPath?: string;
    size: number;
    label?: string;
  }>;
  onConfirm: () => Promise<void>;
}

interface SafeCleanupModalProps {
  preview: CleanupActionPreview | null;
  executing: boolean;
  onCancel: () => void;
}

export function SafeCleanupModal({ preview, executing, onCancel }: SafeCleanupModalProps) {
  if (!preview) return null;

  const totalBytes = preview.items.reduce((acc, item) => acc + item.size, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="safe-cleanup-title"
    >
      <div className="w-full max-w-2xl rounded-xl bg-[#151520] border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div className="flex items-center gap-3">
            {preview.mode === 'trash' ? (
              <Trash2 className="w-5 h-5 text-[#06B6D4]" />
            ) : (
              <FolderOutput className="w-5 h-5 text-[#8B5CF6]" />
            )}
            <h2 id="safe-cleanup-title" className="text-lg font-semibold text-[#F8FAFC]">
              {preview.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={executing}
            aria-label="Close confirmation modal"
            className="p-1.5 rounded-lg text-[#A1A1AA] hover:text-[#F8FAFC] hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-sm text-[#A1A1AA] leading-relaxed">{preview.description}</p>

          {preview.isProtectedWarning ? (
            <div className="flex items-start gap-3 p-3.5 rounded-lg bg-red-500/10 border border-red-500/25 text-sm text-red-200">
              <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-300">System Directory Warning</p>
                <p className="text-xs text-red-200/80 mt-0.5">
                  This operation touches a guarded path. FileForge will block mutations inside protected OS directories.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 p-3.5 rounded-lg bg-[#0B0B12] border border-white/8 text-sm">
              <CheckCircle2 className="w-5 h-5 text-[#06B6D4] shrink-0 mt-0.5" />
              <div className="text-xs text-[#A1A1AA] space-y-1">
                <p className="text-[#F8FAFC] font-medium">Reversible Safety Guarantee</p>
                <p>
                  {preview.mode === 'trash'
                    ? 'Files are never permanently erased. They are moved to the OS Recycle Bin / FileForge Recovery Vault and logged in SQLite for undo.'
                    : 'Every file move is recorded in the SQLite operation journal and can be reverted in one click from Cleanup & History.'}
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-[#A1A1AA] border-b border-white/8 pb-2">
            <span>
              Affected items: <strong className="text-[#F8FAFC] tabular-nums">{preview.items.length}</strong>
            </span>
            <span>
              Total size: <strong className="text-[#F8FAFC] font-mono tabular-nums">{formatBytes(totalBytes)}</strong>
            </span>
          </div>

          <div className="max-h-60 overflow-y-auto rounded-lg bg-[#0B0B12] border border-white/8 divide-y divide-white/6">
            {preview.items.map((item, idx) => (
              <div key={`${item.sourcePath}-${idx}`} className="px-3.5 py-2.5 text-xs space-y-1">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-[#F8FAFC] truncate" title={item.sourcePath}>
                    {item.sourcePath}
                  </span>
                  <span className="font-mono text-[#A1A1AA] tabular-nums shrink-0">{formatBytes(item.size)}</span>
                </div>
                {item.targetPath && (
                  <div className="font-mono text-[11px] text-[#06B6D4] truncate" title={item.targetPath}>
                    → {item.targetPath}
                  </div>
                )}
                {item.label && <div className="text-[11px] text-[#A1A1AA]">{item.label}</div>}
              </div>
            ))}
          </div>

          {preview.mode === 'trash' && (
            <div className="flex items-center gap-2 text-xs text-amber-300/90">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Explicit approval required: review the list above before proceeding.</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-[#0B0B12]/60 border-t border-white/8">
          <button
            type="button"
            onClick={onCancel}
            disabled={executing}
            className="px-4 py-2 text-xs font-medium text-[#A1A1AA] hover:text-[#F8FAFC] rounded-lg border border-white/10 hover:bg-white/5 transition-colors whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={preview.onConfirm}
            disabled={executing || preview.items.length === 0}
            className="px-4 py-2 text-xs font-semibold text-[#F8FAFC] bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {executing
              ? 'Applying...'
              : preview.mode === 'trash'
              ? `Move ${preview.items.length} to Trash`
              : `Apply ${preview.items.length} Moves`}
          </button>
        </div>
      </div>
    </div>
  );
}
