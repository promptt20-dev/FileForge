import { useMemo, useState } from 'react';
import { Clock, FileWarning, Folder, HardDrive, Trash2 } from 'lucide-react';
import { CATEGORY_COLORS, daysAgo, fileforgeClient, formatBytes, formatDateShort } from '../api/fileforgeClient';
import type { FileEntry, ScanResult } from '../shared/types';
import type { CleanupActionPreview } from './SafeCleanupModal';

type AnalyzerTab = 'folders' | 'large' | 'types' | 'old' | 'redundant';

interface AnalyzerViewProps {
  scan: ScanResult | null;
  staleDays: number;
  onChangeStaleDays: (days: number) => void;
  onInspectFile: (file: FileEntry) => void;
  onRequestApproval: (preview: CleanupActionPreview) => void;
  onCleanupDone: () => void;
}

export function AnalyzerView({
  scan,
  staleDays,
  onChangeStaleDays,
  onInspectFile,
  onRequestApproval,
  onCleanupDone,
}: AnalyzerViewProps) {
  const [activeTab, setActiveTab] = useState<AnalyzerTab>('folders');
  const [minLargeKb, setMinLargeKb] = useState<number>(10);
  const [selectedRedundant, setSelectedRedundant] = useState<Set<string>>(new Set());

  const largeFilesFiltered = useMemo(() => {
    if (!scan) return [];
    const minBytes = minLargeKb * 1024;
    return scan.allFiles
      .filter((f) => f.size >= minBytes)
      .sort((a, b) => b.size - a.size)
      .slice(0, 50);
  }, [scan, minLargeKb]);

  if (!scan) {
    return (
      <div className="p-8 text-center text-sm text-[#A1A1AA]">Scan a directory to analyze storage usage.</div>
    );
  }

  function toggleRedundant(path: string) {
    setSelectedRedundant((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleTrashRedundant() {
    if (!scan || selectedRedundant.size === 0) return;
    const candidates = scan.redundantCandidates.filter((c) => selectedRedundant.has(c.file.path));
    onRequestApproval({
      mode: 'trash',
      title: 'Confirm Redundant Clutter Cleanup',
      description: `Move ${candidates.length} selected redundant files to Trash / Recycle Bin. You can undo this operation from Cleanup & History.`,
      rootPath: scan.rootPath,
      items: candidates.map((c) => ({
        sourcePath: c.file.path,
        size: c.file.size,
        label: c.label,
      })),
      onConfirm: async () => {
        await fileforgeClient.trashFiles(
          scan.rootPath,
          candidates.map((c) => c.file.path)
        );
        setSelectedRedundant(new Set());
        onCleanupDone();
      },
    });
  }

  const maxFolderBytes = Math.max(1, ...scan.folderSizes.map((f) => f.totalBytes));
  const maxExtBytes = Math.max(1, ...scan.extensionDistribution.map((e) => e.totalBytes));

  return (
    <div className="p-6 space-y-6 max-w-[1440px]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#F8FAFC]">Storage Analyzer</h2>
          <p className="text-xs text-[#A1A1AA] mt-0.5">
            Inspect folder consumption, large files, file-type distribution, aged untouched files, and redundant clutter.
          </p>
        </div>

        {/* Sub-module Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#151520] border border-white/8">
          {[
            { id: 'folders', label: `Folder Sizes (${scan.folderSizes.length})` },
            { id: 'large', label: 'Large Files' },
            { id: 'types', label: 'File Types' },
            { id: 'old', label: `Old Files (${scan.oldFiles.length})` },
            { id: 'redundant', label: `Redundant (${scan.redundantCandidates.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as AnalyzerTab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeTab === tab.id ? 'bg-[#8B5CF6] text-[#F8FAFC]' : 'text-[#A1A1AA] hover:text-[#F8FAFC]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Folder Sizes */}
      {activeTab === 'folders' && (
        <section className="rounded-xl bg-[#151520] border border-white/8 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">Folder Storage Consumption</h3>
            <span className="text-xs font-mono text-[#A1A1AA] tabular-nums">
              Total: {formatBytes(scan.totalBytes)}
            </span>
          </div>
          <div className="divide-y divide-white/6">
            {scan.folderSizes.length === 0 ? (
              <p className="px-5 py-10 text-xs text-center text-[#A1A1AA]">
                No subdirectories inside {scan.rootPath}.
              </p>
            ) : (
              scan.folderSizes.map((folder) => {
                const barWidth = Math.max(2, (folder.totalBytes / maxFolderBytes) * 100);
                return (
                  <div key={folder.path} className="px-5 py-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-4 text-xs">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Folder className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                        <span className="font-medium text-[#F8FAFC] truncate">{folder.relativePath}</span>
                        <span className="text-[#A1A1AA] font-mono tabular-nums shrink-0">
                          {folder.fileCount} {folder.fileCount === 1 ? 'file' : 'files'}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums shrink-0 text-[#F8FAFC]">
                        {formatBytes(folder.totalBytes)}{' '}
                        <span className="text-[#A1A1AA]">({folder.percentage.toFixed(1)}%)</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-[#0B0B12] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#8B5CF6]"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* 2. Large Files */}
      {activeTab === 'large' && (
        <section className="rounded-xl bg-[#151520] border border-white/8 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/8 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-[#06B6D4]" />
              <h3 className="text-sm font-semibold text-[#F8FAFC]">Large Files</h3>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[#A1A1AA]">Minimum size:</span>
              {[
                { label: 'All > 0 B', val: 0 },
                { label: '>= 10 KB', val: 10 },
                { label: '>= 50 KB', val: 50 },
                { label: '>= 1 MB', val: 1024 },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setMinLargeKb(opt.val)}
                  className={`px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap ${
                    minLargeKb === opt.val
                      ? 'bg-[#8B5CF6] border-[#8B5CF6] text-[#F8FAFC]'
                      : 'bg-[#0B0B12] border-white/10 text-[#A1A1AA] hover:text-[#F8FAFC]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-white/6">
            {largeFilesFiltered.length === 0 ? (
              <p className="px-5 py-10 text-xs text-center text-[#A1A1AA]">
                No files exceed {minLargeKb} KB in this directory.
              </p>
            ) : (
              largeFilesFiltered.map((file) => (
                <div
                  key={file.path}
                  className="px-5 py-3 flex items-center justify-between gap-4 text-xs hover:bg-white/[0.02]"
                >
                  <button
                    type="button"
                    onClick={() => onInspectFile(file)}
                    className="min-w-0 text-left flex-1"
                  >
                    <p className="font-medium text-[#F8FAFC] truncate">{file.name}</p>
                    <p className="font-mono text-[11px] text-[#A1A1AA] truncate mt-0.5">
                      {file.category} · {file.relativePath}
                    </p>
                  </button>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="font-mono text-[#F8FAFC] tabular-nums">{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      onClick={() =>
                        onRequestApproval({
                          mode: 'trash',
                          title: 'Confirm Large File Cleanup',
                          description: `Move "${file.name}" (${formatBytes(file.size)}) to Trash / Recycle Bin.`,
                          rootPath: scan.rootPath,
                          items: [{ sourcePath: file.path, size: file.size }],
                          onConfirm: async () => {
                            await fileforgeClient.trashFiles(scan.rootPath, [file.path]);
                            onCleanupDone();
                          },
                        })
                      }
                      title="Move to Trash"
                      className="p-1.5 rounded hover:bg-red-500/15 text-[#A1A1AA] hover:text-red-300 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* 3. File-Type Distribution */}
      {activeTab === 'types' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="rounded-xl bg-[#151520] border border-white/8 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">By Category</h3>
            <div className="space-y-3">
              {scan.categoryDistribution.map((cat) => (
                <div key={cat.category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#F8FAFC] font-medium">
                      {cat.category} · <span className="text-[#A1A1AA] font-mono tabular-nums">{cat.count} files</span>
                    </span>
                    <span className="font-mono text-[#F8FAFC] tabular-nums">
                      {formatBytes(cat.totalBytes)} ({cat.percentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#0B0B12] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(cat.totalBytes > 0 ? 1.5 : 0, cat.percentage)}%`,
                        backgroundColor: CATEGORY_COLORS[cat.category],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl bg-[#151520] border border-white/8 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">Top Extensions</h3>
            <div className="space-y-3">
              {scan.extensionDistribution.map((ext) => (
                <div key={ext.extension} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-[#F8FAFC]">
                      {ext.extension} <span className="text-[#A1A1AA]">· {ext.count} files</span>
                    </span>
                    <span className="font-mono text-[#06B6D4] tabular-nums">{formatBytes(ext.totalBytes)}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#0B0B12] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#06B6D4]"
                      style={{ width: `${Math.max(2, (ext.totalBytes / maxExtBytes) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* 4. Old & Untouched Files */}
      {activeTab === 'old' && (
        <section className="rounded-xl bg-[#151520] border border-white/8 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/8 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#06B6D4]" />
              <h3 className="text-sm font-semibold text-[#F8FAFC]">
                Aged Files (Untouched &gt; {staleDays} days)
              </h3>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              {[30, 90, 180, 365].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => onChangeStaleDays(days)}
                  className={`px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap ${
                    staleDays === days
                      ? 'bg-[#8B5CF6] border-[#8B5CF6] text-[#F8FAFC]'
                      : 'bg-[#0B0B12] border-white/10 text-[#A1A1AA] hover:text-[#F8FAFC]'
                  }`}
                >
                  {days}d+
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-white/6">
            {scan.oldFiles.length === 0 ? (
              <p className="px-5 py-10 text-xs text-center text-[#A1A1AA]">
                No files older than {staleDays} days found.
              </p>
            ) : (
              scan.oldFiles.map((file) => (
                <div
                  key={file.path}
                  className="px-5 py-3 flex items-center justify-between gap-4 text-xs hover:bg-white/[0.02]"
                >
                  <button type="button" onClick={() => onInspectFile(file)} className="min-w-0 text-left flex-1">
                    <p className="font-medium text-[#F8FAFC] truncate">{file.name}</p>
                    <p className="font-mono text-[11px] text-[#A1A1AA] truncate mt-0.5">{file.relativePath}</p>
                  </button>
                  <div className="text-right font-mono tabular-nums shrink-0">
                    <p className="text-amber-300">{daysAgo(file.modifiedAt)} days ago</p>
                    <p className="text-[11px] text-[#A1A1AA]">
                      {formatDateShort(file.modifiedAt)} · {formatBytes(file.size)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* 5. Potentially Redundant Files */}
      {activeTab === 'redundant' && (
        <section className="rounded-xl bg-[#151520] border border-white/8 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/8 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileWarning className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-[#F8FAFC]">Potentially Redundant Files</h3>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSelectedRedundant(new Set(scan.redundantCandidates.map((c) => c.file.path)))}
                className="text-xs text-[#06B6D4] hover:text-[#22D3EE]"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={handleTrashRedundant}
                disabled={selectedRedundant.size === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-45 text-[#F8FAFC] transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Review & Trash ({selectedRedundant.size})
              </button>
            </div>
          </div>

          <div className="divide-y divide-white/6">
            {scan.redundantCandidates.length === 0 ? (
              <p className="px-5 py-10 text-xs text-center text-[#A1A1AA]">
                No temporary clutter, zero-byte files, or redundant duplicates detected.
              </p>
            ) : (
              scan.redundantCandidates.map((item) => {
                const checked = selectedRedundant.has(item.file.path);
                return (
                  <div
                    key={item.file.path}
                    onClick={() => toggleRedundant(item.file.path)}
                    className={`px-5 py-3 flex items-center justify-between gap-4 text-xs cursor-pointer transition-colors ${
                      checked ? 'bg-[#8B5CF6]/10' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {}}
                        className="accent-[#8B5CF6] rounded"
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-[#F8FAFC] truncate">{item.file.name}</p>
                        <p className="text-[11px] text-[#A1A1AA] truncate">
                          {item.label} · <span className="font-mono">{item.file.relativePath}</span>
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-[#F8FAFC] tabular-nums shrink-0">
                      {formatBytes(item.file.size)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}
    </div>
  );
}
