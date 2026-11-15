import { useState } from 'react';
import { History, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { fileforgeClient, formatBytes, formatDateTime } from '../api/fileforgeClient';
import type { OperationRecord } from '../shared/types';

interface CleanupHistoryViewProps {
  operations: OperationRecord[];
  onRefresh: () => Promise<void>;
  onWorkspaceReseeded: () => Promise<void>;
}

export function CleanupHistoryView({
  operations,
  onRefresh,
  onWorkspaceReseeded,
}: CleanupHistoryViewProps) {
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reseeding, setReseeding] = useState(false);

  async function handleUndo(opId: string) {
    setUndoingId(opId);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const res = await fileforgeClient.undoOperation(opId);
      setStatusMessage(res.message);
      await onRefresh();
    } catch (err: unknown) {
      setErrorMessage((err as Error).message);
    } finally {
      setUndoingId(null);
    }
  }

  async function handleReseed() {
    setReseeding(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      await onWorkspaceReseeded();
      setStatusMessage('Workspace files verified and scanned.');
    } catch (err: unknown) {
      setErrorMessage((err as Error).message);
    } finally {
      setReseeding(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-[1440px]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#F8FAFC]">Safe Cleanup & Operation History</h2>
          <p className="text-xs text-[#A1A1AA] mt-0.5">
            Every organization, rename, and trash action is journaled in SQLite. Revert supported operations in one click.
          </p>
        </div>

        <button
          type="button"
          onClick={handleReseed}
          disabled={reseeding}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-white/10 hover:bg-white/5 text-[#F8FAFC] transition-colors whitespace-nowrap"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#06B6D4]" />
          {reseeding ? 'Checking...' : 'Ensure Sample Workspace'}
        </button>
      </div>

      {/* Safety Architecture Banner */}
      <section className="rounded-xl bg-[#151520] border border-white/8 p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#F8FAFC]">
            <ShieldCheck className="w-4 h-4 text-[#06B6D4]" />
            <span>Zero Silent Deletion</span>
          </div>
          <p className="text-xs text-[#A1A1AA] leading-relaxed">
            FileForge never deletes files automatically. Every operation presents an explicit preview before disk execution.
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#F8FAFC]">
            <ShieldCheck className="w-4 h-4 text-[#8B5CF6]" />
            <span>OS Recycle Bin Priority</span>
          </div>
          <p className="text-xs text-[#A1A1AA] leading-relaxed">
            On Windows 10/11 Electron, cleaned files move to the Windows Recycle Bin; in workspace mode, a reversible trash vault enables 1-click restore.
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#F8FAFC]">
            <ShieldCheck className="w-4 h-4 text-[#06B6D4]" />
            <span>System Directory Guard</span>
          </div>
          <p className="text-xs text-[#A1A1AA] leading-relaxed">
            Blocks mutations inside C:\Windows, C:\Program Files, /etc, /usr, /bin, /System, and application source folders.
          </p>
        </div>
      </section>

      {statusMessage && (
        <div className="px-4 py-3 rounded-xl bg-[#06B6D4]/10 border border-[#06B6D4]/30 text-xs text-[#F8FAFC]">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {errorMessage}
        </div>
      )}

      {/* Operation Journal Table */}
      <section className="rounded-xl bg-[#151520] border border-white/8 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#8B5CF6]" />
            <h3 className="text-sm font-semibold text-[#F8FAFC]">SQLite Operation Journal</h3>
          </div>
          <span className="text-xs font-mono text-[#A1A1AA] tabular-nums">{operations.length} recorded</span>
        </div>

        <div className="divide-y divide-white/6">
          {operations.length === 0 ? (
            <p className="px-5 py-12 text-xs text-center text-[#A1A1AA]">
              No filesystem operations recorded yet. Organize files, rename, or clean duplicates to see undoable history here.
            </p>
          ) : (
            operations.map((op) => {
              const isExpanded = expandedId === op.id;
              return (
                <div key={op.id} className="px-5 py-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5 text-xs">
                        <span className="font-semibold text-[#F8FAFC]">{op.summary}</span>
                        <span className="text-[#A1A1AA] font-mono tabular-nums">
                          · {formatBytes(op.totalBytes)} · {formatDateTime(op.createdAt)}
                        </span>
                      </div>
                      <p className="font-mono text-[11px] text-[#A1A1AA] truncate mt-0.5">{op.rootPath}</p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : op.id)}
                        className="text-xs text-[#A1A1AA] hover:text-[#F8FAFC] transition-colors"
                      >
                        {isExpanded ? 'Hide items' : `View ${op.itemCount} items`}
                      </button>

                      {op.undone ? (
                        <span className="text-xs font-medium text-[#A1A1AA]">Reverted</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleUndo(op.id)}
                          disabled={undoingId === op.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 hover:border-[#06B6D4]/50 hover:bg-[#06B6D4]/10 text-[#06B6D4] transition-colors whitespace-nowrap"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {undoingId === op.id ? 'Undoing...' : 'Undo'}
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="rounded-lg bg-[#0B0B12] border border-white/8 divide-y divide-white/6 max-h-48 overflow-y-auto">
                      {op.items.map((item) => (
                        <div key={item.id} className="px-3 py-2 text-[11px] font-mono space-y-0.5">
                          <div className="text-[#A1A1AA] truncate">From: {item.sourcePath}</div>
                          <div className="text-[#06B6D4] truncate">To: {item.targetPath}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
