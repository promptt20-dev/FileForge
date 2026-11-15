import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, CopyCheck, ExternalLink, Info, ShieldCheck, Square, Trash2 } from 'lucide-react';
import { fileforgeClient, formatBytes, formatDateShort } from '../api/fileforgeClient';
import type { FileEntry, ScanResult } from '../shared/types';
import type { CleanupActionPreview } from './SafeCleanupModal';

interface DuplicatesViewProps {
  scan: ScanResult | null;
  onInspectFile: (file: FileEntry) => void;
  onRequestApproval: (preview: CleanupActionPreview) => void;
  onCleanupDone: () => void;
}

export function DuplicatesView({
  scan,
  onInspectFile,
  onRequestApproval,
  onCleanupDone,
}: DuplicatesViewProps) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Default: pre-select all redundant copies (index >= 1) while keeping index 0 (oldest original) untouched
  useEffect(() => {
    if (!scan) return;
    const defaults = new Set<string>();
    for (const group of scan.duplicateGroups) {
      for (let i = 1; i < group.files.length; i++) {
        defaults.add(group.files[i].path);
      }
    }
    setSelectedPaths(defaults);
  }, [scan]);

  const groups = scan?.duplicateGroups || [];

  const { selectedCount, selectedBytes } = useMemo(() => {
    let count = 0;
    let bytes = 0;
    for (const group of groups) {
      for (const f of group.files) {
        if (selectedPaths.has(f.path)) {
          count++;
          bytes += f.size;
        }
      }
    }
    return { selectedCount: count, selectedBytes: bytes };
  }, [groups, selectedPaths]);

  function applyRetentionRule(rule: 'oldest' | 'newest' | 'shortest_path') {
    const next = new Set<string>();
    for (const group of groups) {
      const sorted = [...group.files];
      if (rule === 'oldest') {
        sorted.sort((a, b) => a.modifiedAt - b.modifiedAt || a.path.length - b.path.length);
      } else if (rule === 'newest') {
        sorted.sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.length - b.path.length);
      } else {
        sorted.sort((a, b) => a.path.length - b.path.length || a.modifiedAt - b.modifiedAt);
      }
      // Keep sorted[0], mark rest for cleanup
      for (let i = 1; i < sorted.length; i++) {
        next.add(sorted[i].path);
      }
    }
    setSelectedPaths(next);
  }

  function togglePath(groupFiles: FileEntry[], targetPath: string) {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(targetPath)) {
        next.delete(targetPath);
        return next;
      }
      // Safety guard: never allow selecting EVERY copy in a duplicate group automatically
      const remainingUnselected = groupFiles.filter((f) => f.path !== targetPath && !next.has(f.path));
      if (remainingUnselected.length === 0) {
        return prev;
      }
      next.add(targetPath);
      return next;
    });
  }

  function handleRequestCleanup() {
    if (!scan || selectedPaths.size === 0) return;
    const targets: Array<{ sourcePath: string; size: number; label: string }> = [];
    for (const group of groups) {
      for (const f of group.files) {
        if (selectedPaths.has(f.path)) {
          targets.push({
            sourcePath: f.path,
            size: f.size,
            label: `SHA-256 ${group.hash.slice(0, 12)}... (${group.copiesCount} copies)`,
          });
        }
      }
    }

    onRequestApproval({
      mode: 'trash',
      title: 'Confirm Duplicate File Cleanup',
      description: `Move ${targets.length} verified byte-identical duplicate copies to the Trash / Recycle Bin. At least one original copy of each file remains untouched.`,
      rootPath: scan.rootPath,
      items: targets,
      onConfirm: async () => {
        await fileforgeClient.trashFiles(
          scan.rootPath,
          targets.map((t) => t.sourcePath)
        );
        onCleanupDone();
      },
    });
  }

  if (!scan) {
    return (
      <div className="p-8 text-center text-sm text-[#A1A1AA]">Run a directory scan to detect SHA-256 duplicates.</div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1440px]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#F8FAFC]">SHA-256 Duplicate Detection</h2>
          <p className="text-xs text-[#A1A1AA] mt-0.5">
            Streaming cryptographic verification in background worker threads. Files are matched strictly by identical byte content.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRequestCleanup}
          disabled={selectedCount === 0}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-45 text-[#F8FAFC] transition-colors whitespace-nowrap"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Move Selected to Trash ({selectedCount} · {formatBytes(selectedBytes)})
        </button>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl bg-[#151520] border border-white/8 p-4">
          <p className="text-xs text-[#A1A1AA]">Exact Duplicate Groups</p>
          <p className="text-xl font-semibold font-mono text-[#F8FAFC] tabular-nums mt-1">
            {scan.duplicateGroupsCount}
          </p>
        </div>
        <div className="rounded-xl bg-[#151520] border border-white/8 p-4">
          <p className="text-xs text-[#A1A1AA]">Redundant Copies Found</p>
          <p className="text-xl font-semibold font-mono text-[#F8FAFC] tabular-nums mt-1">
            {scan.duplicateFilesCount}
          </p>
        </div>
        <div className="rounded-xl bg-[#151520] border border-white/8 p-4">
          <p className="text-xs text-[#A1A1AA]">Storage Potentially Recoverable</p>
          <p className="text-xl font-semibold font-mono text-[#06B6D4] tabular-nums mt-1">
            {formatBytes(scan.recoverableBytes)}
          </p>
        </div>
      </div>

      {/* Retention Policy Controls */}
      {groups.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#151520] border border-white/8 text-xs">
          <div className="flex items-center gap-2 text-[#A1A1AA]">
            <ShieldCheck className="w-4 h-4 text-[#06B6D4]" />
            <span>Retention safeguard active: at least 1 copy per hash group is always preserved.</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#A1A1AA]">Auto-select rule:</span>
            <button
              type="button"
              onClick={() => applyRetentionRule('oldest')}
              className="px-2.5 py-1 rounded-md bg-[#0B0B12] border border-white/10 hover:border-[#8B5CF6]/50 text-[#F8FAFC] transition-colors whitespace-nowrap"
            >
              Keep Oldest
            </button>
            <button
              type="button"
              onClick={() => applyRetentionRule('newest')}
              className="px-2.5 py-1 rounded-md bg-[#0B0B12] border border-white/10 hover:border-[#8B5CF6]/50 text-[#F8FAFC] transition-colors whitespace-nowrap"
            >
              Keep Newest
            </button>
            <button
              type="button"
              onClick={() => applyRetentionRule('shortest_path')}
              className="px-2.5 py-1 rounded-md bg-[#0B0B12] border border-white/10 hover:border-[#8B5CF6]/50 text-[#F8FAFC] transition-colors whitespace-nowrap"
            >
              Keep Shortest Path
            </button>
            <button
              type="button"
              onClick={() => setSelectedPaths(new Set())}
              className="px-2.5 py-1 rounded-md text-[#A1A1AA] hover:text-[#F8FAFC] transition-colors whitespace-nowrap"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Duplicate Groups List */}
      {groups.length === 0 ? (
        <div className="rounded-xl bg-[#151520] border border-white/8 p-12 text-center">
          <CopyCheck className="w-9 h-9 text-[#06B6D4] mx-auto mb-2.5" />
          <p className="text-sm font-semibold text-[#F8FAFC]">Zero Exact Duplicates Detected</p>
          <p className="text-xs text-[#A1A1AA] mt-1">
            All {scan.totalFiles} scanned files have unique SHA-256 content digests.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.hash} className="rounded-xl bg-[#151520] border border-white/8 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-[#0B0B12]/60 border-b border-white/8">
                <div className="min-w-0">
                  <div className="flex items-center gap-3 text-sm font-semibold text-[#F8FAFC]">
                    <span className="truncate">{group.files[0].name}</span>
                    <span className="text-xs font-normal text-[#A1A1AA] font-mono tabular-nums">
                      {group.copiesCount} copies · {formatBytes(group.size)} each
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-[#A1A1AA] mt-0.5 truncate" title={group.hash}>
                    SHA-256: {group.hash}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] text-[#A1A1AA]">Recoverable</p>
                  <p className="text-sm font-semibold font-mono text-[#06B6D4] tabular-nums">
                    {formatBytes(group.recoverableBytes)}
                  </p>
                </div>
              </div>

              <div className="divide-y divide-white/6">
                {group.files.map((file) => {
                  const isChecked = selectedPaths.has(file.path);
                  const unselectedCount = group.files.filter((f) => !selectedPaths.has(f.path)).length;
                  const wouldLeaveZero = !isChecked && unselectedCount <= 1;

                  return (
                    <div
                      key={file.path}
                      className={`px-5 py-3 flex items-center justify-between gap-4 text-xs transition-colors ${
                        isChecked ? 'bg-[#8B5CF6]/10' : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => togglePath(group.files, file.path)}
                          disabled={wouldLeaveZero}
                          title={
                            wouldLeaveZero
                              ? 'At least one copy must be retained'
                              : isChecked
                              ? 'Keep this copy'
                              : 'Select copy for trash'
                          }
                          className="shrink-0 disabled:opacity-35"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-[#8B5CF6]" />
                          ) : (
                            <Square className="w-4 h-4 text-[#A1A1AA]" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[#F8FAFC] truncate">{file.name}</span>
                            <span className="text-[11px] text-[#A1A1AA]">
                              {isChecked ? 'Marked for Trash' : 'Retained copy'}
                            </span>
                          </div>
                          <p className="font-mono text-[11px] text-[#A1A1AA] truncate mt-0.5" title={file.path}>
                            {file.path}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <span className="font-mono text-[#A1A1AA] tabular-nums">
                          {formatDateShort(file.modifiedAt)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onInspectFile(file)}
                          className="text-xs text-[#06B6D4] hover:text-[#22D3EE] transition-colors"
                        >
                          Inspect
                        </button>
                        <button
                          type="button"
                          onClick={() => fileforgeClient.openWithOS(file.path)}
                          title="Open file"
                          className="p-1 text-[#A1A1AA] hover:text-[#F8FAFC] transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Similarly-named non-duplicate verification notice */}
      {scan.similarNameNotices.length > 0 && (
        <section className="rounded-xl bg-[#151520] border border-white/8 p-5 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#F8FAFC]">
            <Info className="w-4 h-4 text-[#06B6D4]" />
            <span>Similar Filenames Verified Distinct by SHA-256</span>
          </div>
          <div className="space-y-1.5">
            {scan.similarNameNotices.map((notice) => (
              <p key={notice.basePrefix} className="text-xs text-[#A1A1AA]">
                {notice.message}
              </p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
