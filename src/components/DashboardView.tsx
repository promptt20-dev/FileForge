import { ArrowUpRight, CopyCheck, FolderOpen, HardDrive, Layers } from 'lucide-react';
import { CATEGORY_COLORS, formatBytes, formatDateShort } from '../api/fileforgeClient';
import type { FileCategory, FileEntry, ScanResult } from '../shared/types';

interface DashboardViewProps {
  scan: ScanResult | null;
  scanning: boolean;
  onInspectFile: (file: FileEntry) => void;
  onNavigateTab: (tab: 'explorer' | 'organizer' | 'duplicates' | 'analyzer' | 'cleanup') => void;
  onRescan: () => void;
}

export function DashboardView({
  scan,
  scanning,
  onInspectFile,
  onNavigateTab,
  onRescan,
}: DashboardViewProps) {
  if (scanning && !scan) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="h-28 rounded-xl bg-[#151520] border border-white/8 animate-pulse" />
          ))}
        </div>
        <div className="h-72 rounded-xl bg-[#151520] border border-white/8 animate-pulse" />
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[420px] text-center">
        <HardDrive className="w-10 h-10 text-[#8B5CF6] mb-3" />
        <h2 className="text-lg font-semibold text-[#F8FAFC]">No Directory Scanned Yet</h2>
        <p className="text-sm text-[#A1A1AA] max-w-md mt-1 mb-5">
          Select a folder or scan the active workspace to analyze storage distribution, detect SHA-256 duplicates, and preview organization plans.
        </p>
        <button
          type="button"
          onClick={onRescan}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-[#F8FAFC] transition-colors"
        >
          Scan Active Directory
        </button>
      </div>
    );
  }

  const activeCategories = scan.categoryDistribution.filter((c) => c.count > 0 || c.totalBytes > 0);
  const totalBytes = Math.max(1, scan.totalBytes);

  // Build SVG Donut arcs
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  let cumulativeFraction = 0;

  return (
    <div className="p-6 space-y-6 max-w-[1440px]">
      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl bg-[#151520] border border-white/8 p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#A1A1AA]">
            <span>Total Storage Scanned</span>
            <HardDrive className="w-4 h-4 text-[#8B5CF6]" />
          </div>
          <div className="mt-3">
            <p className="text-2xl font-semibold text-[#F8FAFC] font-mono tabular-nums">
              {formatBytes(scan.totalBytes)}
            </p>
            <p className="text-xs text-[#A1A1AA] mt-1 font-mono tabular-nums">
              {scan.totalBytes.toLocaleString()} bytes · {scan.durationMs} ms scan
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-[#151520] border border-white/8 p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#A1A1AA]">
            <span>Total Files</span>
            <Layers className="w-4 h-4 text-[#06B6D4]" />
          </div>
          <div className="mt-3">
            <p className="text-2xl font-semibold text-[#F8FAFC] font-mono tabular-nums">
              {scan.totalFiles.toLocaleString()}
            </p>
            <p className="text-xs text-[#A1A1AA] mt-1">
              {activeCategories.length} active file categories
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-[#151520] border border-white/8 p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#A1A1AA]">
            <span>Total Folders</span>
            <FolderOpen className="w-4 h-4 text-[#8B5CF6]" />
          </div>
          <div className="mt-3">
            <p className="text-2xl font-semibold text-[#F8FAFC] font-mono tabular-nums">
              {scan.totalFolders.toLocaleString()}
            </p>
            <button
              type="button"
              onClick={() => onNavigateTab('explorer')}
              className="mt-1 inline-flex items-center gap-1 text-xs text-[#06B6D4] hover:text-[#22D3EE] transition-colors"
            >
              Browse directory tree
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-[#151520] border border-white/8 p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#A1A1AA]">
            <span>Duplicate Files Detected</span>
            <CopyCheck className="w-4 h-4 text-[#06B6D4]" />
          </div>
          <div className="mt-3">
            <p className="text-2xl font-semibold text-[#F8FAFC] font-mono tabular-nums">
              {scan.duplicateFilesCount.toLocaleString()}
            </p>
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-[#A1A1AA] font-mono tabular-nums">
                {formatBytes(scan.recoverableBytes)} recoverable
              </span>
              <button
                type="button"
                onClick={() => onNavigateTab('duplicates')}
                className="text-[#8B5CF6] hover:text-[#A78BFA] font-medium transition-colors"
              >
                Inspect
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Visual Storage Usage Chart + Category Distribution */}
      <section className="rounded-xl bg-[#151520] border border-white/8 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-base font-semibold text-[#F8FAFC]">Storage Distribution</h2>
            <p className="text-xs text-[#A1A1AA] mt-0.5">
              Breakdown across 8 FileForge smart categories by total byte consumption
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onNavigateTab('organizer')}
              className="text-xs font-medium text-[#8B5CF6] hover:text-[#A78BFA] transition-colors whitespace-nowrap"
            >
              Open Smart Organizer
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('analyzer')}
              className="text-xs font-medium text-[#06B6D4] hover:text-[#22D3EE] transition-colors whitespace-nowrap"
            >
              Full Storage Analyzer
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Interactive SVG Ring Chart */}
          <div className="lg:col-span-4 flex items-center justify-center">
            <div className="relative w-48 h-48 flex items-center justify-center">
              <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90" aria-label="Storage usage donut chart">
                <circle
                  cx="80"
                  cy="80"
                  r={radius}
                  fill="none"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="16"
                />
                {scan.categoryDistribution.map((cat) => {
                  if (cat.totalBytes <= 0) return null;
                  const fraction = cat.totalBytes / totalBytes;
                  const dash = fraction * circumference;
                  const offset = -cumulativeFraction * circumference;
                  cumulativeFraction += fraction;

                  return (
                    <circle
                      key={cat.category}
                      cx="80"
                      cy="80"
                      r={radius}
                      fill="none"
                      stroke={CATEGORY_COLORS[cat.category as FileCategory]}
                      strokeWidth="16"
                      strokeDasharray={`${Math.max(1, dash - 1.5)} ${circumference}`}
                      strokeDashoffset={offset}
                      className="transition-opacity duration-150 hover:opacity-80"
                    />
                  );
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                <span className="text-[11px] text-[#A1A1AA]">Indexed</span>
                <span className="text-lg font-semibold font-mono text-[#F8FAFC] tabular-nums">
                  {formatBytes(scan.totalBytes)}
                </span>
                <span className="text-[11px] text-[#A1A1AA] font-mono tabular-nums">
                  {scan.totalFiles} files
                </span>
              </div>
            </div>
          </div>

          {/* Horizontal Category Bars */}
          <div className="lg:col-span-8 space-y-3">
            {scan.categoryDistribution.map((cat) => {
              const color = CATEGORY_COLORS[cat.category];
              return (
                <div key={cat.category} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: color }}
                        aria-hidden="true"
                      />
                      <span className="font-medium text-[#F8FAFC]">{cat.category}</span>
                      <span className="text-[#A1A1AA] font-mono tabular-nums">
                        {cat.count} {cat.count === 1 ? 'file' : 'files'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono tabular-nums shrink-0">
                      <span className="text-[#F8FAFC]">{formatBytes(cat.totalBytes)}</span>
                      <span className="text-[#A1A1AA] w-12 text-right">{cat.percentage.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#0B0B12] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max(cat.totalBytes > 0 ? 1.5 : 0, cat.percentage)}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Largest Files & Recent Files */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl bg-[#151520] border border-white/8 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
            <h2 className="text-sm font-semibold text-[#F8FAFC]">Largest Files</h2>
            <button
              type="button"
              onClick={() => onNavigateTab('analyzer')}
              className="text-xs text-[#06B6D4] hover:text-[#22D3EE] transition-colors"
            >
              View all
            </button>
          </div>
          <div className="divide-y divide-white/6">
            {scan.largestFiles.slice(0, 7).map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => onInspectFile(file)}
                className="w-full px-5 py-3 flex items-center justify-between gap-4 text-left hover:bg-white/[0.03] transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#F8FAFC] truncate">{file.name}</p>
                  <p className="text-[11px] text-[#A1A1AA] truncate mt-0.5">
                    {file.category} · {file.relativePath}
                  </p>
                </div>
                <span className="text-xs font-mono text-[#F8FAFC] tabular-nums shrink-0">
                  {formatBytes(file.size)}
                </span>
              </button>
            ))}
            {scan.largestFiles.length === 0 && (
              <p className="px-5 py-8 text-xs text-[#A1A1AA] text-center">No files found in directory.</p>
            )}
          </div>
        </section>

        <section className="rounded-xl bg-[#151520] border border-white/8 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
            <h2 className="text-sm font-semibold text-[#F8FAFC]">Recent Files</h2>
            <button
              type="button"
              onClick={() => onNavigateTab('explorer')}
              className="text-xs text-[#8B5CF6] hover:text-[#A78BFA] transition-colors"
            >
              Open Explorer
            </button>
          </div>
          <div className="divide-y divide-white/6">
            {scan.recentFiles.slice(0, 7).map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => onInspectFile(file)}
                className="w-full px-5 py-3 flex items-center justify-between gap-4 text-left hover:bg-white/[0.03] transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#F8FAFC] truncate">{file.name}</p>
                  <p className="text-[11px] text-[#A1A1AA] truncate mt-0.5">
                    {file.category} · {file.relativePath}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-mono text-[#F8FAFC] tabular-nums">{formatDateShort(file.modifiedAt)}</p>
                  <p className="text-[11px] font-mono text-[#A1A1AA] tabular-nums">{formatBytes(file.size)}</p>
                </div>
              </button>
            ))}
            {scan.recentFiles.length === 0 && (
              <p className="px-5 py-8 text-xs text-[#A1A1AA] text-center">No recent files detected.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
