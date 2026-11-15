import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, FolderTree, RefreshCw, ShieldAlert, Sparkles, Square } from 'lucide-react';
import { CATEGORY_COLORS, fileforgeClient, formatBytes } from '../api/fileforgeClient';
import { FILE_CATEGORIES, type FileCategory, type OrganizePreviewResponse, type OrganizeProposal } from '../shared/types';
import type { CleanupActionPreview } from './SafeCleanupModal';

interface OrganizerViewProps {
  activeRootPath: string;
  onRequestApproval: (preview: CleanupActionPreview) => void;
  onOrganizationApplied: () => void;
}

export function OrganizerView({ activeRootPath, onRequestApproval, onOrganizationApplied }: OrganizerViewProps) {
  const [preview, setPreview] = useState<OrganizePreviewResponse | null>(null);
  const [proposals, setProposals] = useState<OrganizeProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<'all' | FileCategory>('all');

  async function loadPlan() {
    setLoading(true);
    setError(null);
    try {
      const data = await fileforgeClient.previewOrganize(activeRootPath);
      setPreview(data);
      setProposals(data.proposals);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (activeRootPath) {
      loadPlan();
    }
  }, [activeRootPath]);

  const filteredProposals = useMemo(() => {
    if (activeCategory === 'all') return proposals;
    return proposals.filter((p) => p.category === activeCategory);
  }, [proposals, activeCategory]);

  const selectedProposals = useMemo(() => proposals.filter((p) => p.selected), [proposals]);
  const selectedBytes = useMemo(
    () => selectedProposals.reduce((acc, p) => acc + p.size, 0),
    [selectedProposals]
  );

  function toggleProposal(id: string) {
    setProposals((prev) => prev.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)));
  }

  function toggleAllVisible(select: boolean) {
    const visibleIds = new Set(filteredProposals.map((p) => p.id));
    setProposals((prev) => prev.map((p) => (visibleIds.has(p.id) ? { ...p, selected: select } : p)));
  }

  function handleRequestApply() {
    if (!preview || selectedProposals.length === 0) return;

    onRequestApproval({
      mode: 'organize',
      title: 'Confirm Smart File Organization',
      description: `FileForge will organize ${selectedProposals.length} selected files into category folders under ${preview.rootPath}. Every move is atomic and recorded in SQLite for one-click undo.`,
      rootPath: preview.rootPath,
      isProtectedWarning: preview.isProtected,
      items: selectedProposals.map((p) => ({
        sourcePath: p.relativeSource,
        targetPath: p.relativeTarget,
        size: p.size,
        label: `${p.category} · ${p.reason}`,
      })),
      onConfirm: async () => {
        await fileforgeClient.applyOrganize(
          preview.rootPath,
          selectedProposals.map((p) => ({
            sourcePath: p.sourcePath,
            targetPath: p.targetPath,
            size: p.size,
          }))
        );
        await loadPlan();
        onOrganizationApplied();
      },
    });
  }

  return (
    <div className="p-6 space-y-6 max-w-[1440px]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#F8FAFC]">Smart File Organizer</h2>
          <p className="text-xs text-[#A1A1AA] mt-0.5">
            Classifies files by extension, MIME type, magic-byte header, and filename metadata. Preview every move before applying.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadPlan}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-white/10 hover:bg-white/5 text-[#F8FAFC] transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Plan
          </button>
          <button
            type="button"
            onClick={handleRequestApply}
            disabled={loading || Boolean(preview?.isProtected) || selectedProposals.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-45 text-[#F8FAFC] transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Preview & Apply ({selectedProposals.length})
          </button>
        </div>
      </div>

      {preview?.isProtected && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-200">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <p className="font-semibold text-red-300">Organization Blocked in Protected Directory</p>
            <p className="mt-0.5 text-red-200/80">{preview.warningMessage}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-300">{error}</div>
      )}

      {/* Category Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl bg-[#151520] border border-white/8">
        <button
          type="button"
          onClick={() => setActiveCategory('all')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
            activeCategory === 'all' ? 'bg-[#8B5CF6] text-[#F8FAFC]' : 'text-[#A1A1AA] hover:text-[#F8FAFC]'
          }`}
        >
          All Proposed ({proposals.length})
        </button>
        {FILE_CATEGORIES.map((cat) => {
          const count = proposals.filter((p) => p.category === cat).length;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeCategory === cat ? 'bg-[#8B5CF6] text-[#F8FAFC]' : 'text-[#A1A1AA] hover:text-[#F8FAFC]'
              }`}
            >
              <span
                className="w-2 h-2 rounded-xs shrink-0"
                style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                aria-hidden="true"
              />
              {cat} ({count})
            </button>
          );
        })}
      </div>

      {/* Proposed Changes Table */}
      <section className="rounded-xl bg-[#151520] border border-white/8 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-white/8 text-xs">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => toggleAllVisible(true)}
              className="text-[#06B6D4] hover:text-[#22D3EE] font-medium transition-colors"
            >
              Select all visible
            </button>
            <button
              type="button"
              onClick={() => toggleAllVisible(false)}
              className="text-[#A1A1AA] hover:text-[#F8FAFC] transition-colors"
            >
              Clear visible
            </button>
          </div>
          <div className="text-[#A1A1AA] font-mono tabular-nums">
            {selectedProposals.length} moves selected · {formatBytes(selectedBytes)} ·{' '}
            {preview?.alreadyOrganizedCount ?? 0} already organized
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-[#0B0B12]/70 border-b border-white/8 text-[11px] font-medium text-[#A1A1AA]">
              <tr>
                <th className="py-2.5 px-4 w-10">Move</th>
                <th className="py-2.5 px-3">File & Current Location</th>
                <th className="py-2.5 px-3">Proposed Destination</th>
                <th className="py-2.5 px-3">Category & Signals</th>
                <th className="py-2.5 px-4 text-right">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[#A1A1AA]">
                    Inspecting headers, MIME types, and file metadata...
                  </td>
                </tr>
              ) : filteredProposals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <FolderTree className="w-8 h-8 text-[#06B6D4] mx-auto mb-2" />
                    <p className="text-sm font-medium text-[#F8FAFC]">
                      {proposals.length === 0
                        ? 'All files in this directory are already organized'
                        : 'No files in this category need moving'}
                    </p>
                    <p className="text-xs text-[#A1A1AA] mt-1">
                      {preview?.alreadyOrganizedCount ?? 0} files are already placed in matching category folders.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredProposals.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => toggleProposal(item.id)}
                    className="cursor-pointer hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="py-3 px-4">
                      {item.selected ? (
                        <CheckSquare className="w-4 h-4 text-[#8B5CF6]" />
                      ) : (
                        <Square className="w-4 h-4 text-[#A1A1AA]" />
                      )}
                    </td>
                    <td className="py-3 px-3 max-w-[260px]">
                      <p className="font-medium text-[#F8FAFC] truncate">{item.fileName}</p>
                      <p className="font-mono text-[11px] text-[#A1A1AA] truncate" title={item.relativeSource}>
                        {item.relativeSource}
                      </p>
                    </td>
                    <td className="py-3 px-3 max-w-[260px]">
                      <p className="font-mono text-[11px] text-[#06B6D4] truncate" title={item.relativeTarget}>
                        {item.relativeTarget}
                      </p>
                      {item.hasConflict && (
                        <p className="text-[11px] text-amber-300 mt-0.5">Auto-renamed to prevent overwrite</p>
                      )}
                    </td>
                    <td className="py-3 px-3 max-w-[260px]">
                      <p className="font-medium text-[#F8FAFC]">{item.category}</p>
                      <p className="text-[11px] text-[#A1A1AA] truncate" title={item.reason}>
                        {item.reason}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-[#F8FAFC] tabular-nums whitespace-nowrap">
                      {formatBytes(item.size)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
