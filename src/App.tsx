import { useCallback, useEffect, useState } from 'react';
import {
  CopyCheck,
  FolderOpen,
  FolderSearch,
  HardDrive,
  History,
  LayoutDashboard,
  PieChart,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { fileforgeClient, formatBytes } from './api/fileforgeClient';
import { AnalyzerView } from './components/AnalyzerView';
import { CleanupHistoryView } from './components/CleanupHistoryView';
import { DashboardView } from './components/DashboardView';
import { DuplicatesView } from './components/DuplicatesView';
import { ExplorerView } from './components/ExplorerView';
import { OrganizerView } from './components/OrganizerView';
import { SafeCleanupModal, type CleanupActionPreview } from './components/SafeCleanupModal';
import type { FileEntry, OperationRecord, ScanResult, SystemCapabilities } from './shared/types';

type NavTab = 'dashboard' | 'explorer' | 'organizer' | 'duplicates' | 'analyzer' | 'cleanup';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [activeRootPath, setActiveRootPath] = useState<string>('');
  const [customPathInput, setCustomPathInput] = useState<string>('');
  const [editingPath, setEditingPath] = useState(false);

  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [staleDays, setStaleDays] = useState<number>(90);
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [inspectedFile, setInspectedFile] = useState<FileEntry | null>(null);

  const [approvalPreview, setApprovalPreview] = useState<CleanupActionPreview | null>(null);
  const [executingApproval, setExecutingApproval] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  }, []);

  const refreshOperations = useCallback(async () => {
    try {
      const ops = await fileforgeClient.getOperations();
      setOperations(ops);
    } catch {
      // Ignore background history refresh errors
    }
  }, []);

  const runScan = useCallback(
    async (targetPath?: string, customStaleDays?: number) => {
      setScanning(true);
      setBannerError(null);
      try {
        const result = await fileforgeClient.scanDirectory(targetPath, customStaleDays ?? staleDays);
        setScanResult(result);
        setActiveRootPath(result.rootPath);
        setCustomPathInput(result.rootPath);
        await refreshOperations();
      } catch (err: unknown) {
        setBannerError((err as Error).message);
      } finally {
        setScanning(false);
      }
    },
    [staleDays, refreshOperations]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const caps = await fileforgeClient.getCapabilities();
        if (!mounted) return;
        setCapabilities(caps);
        setActiveRootPath(caps.defaultWorkspacePath);
        setCustomPathInput(caps.defaultWorkspacePath);
        await runScan(caps.defaultWorkspacePath, 90);
      } catch (err: unknown) {
        if (mounted) setBannerError((err as Error).message);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [runScan]);

  async function handleSelectFolder() {
    if (fileforgeClient.isElectron()) {
      const picked = await fileforgeClient.selectFolder();
      if (picked) {
        await runScan(picked);
      }
    } else {
      setEditingPath((prev) => !prev);
    }
  }

  async function handleConfirmCustomPath() {
    const trimmed = customPathInput.trim();
    if (!trimmed) return;
    setEditingPath(false);
    await runScan(trimmed);
  }

  async function handleExecuteApproval() {
    if (!approvalPreview) return;
    setExecutingApproval(true);
    setBannerError(null);
    try {
      await approvalPreview.onConfirm();
      setApprovalPreview(null);
      await runScan(activeRootPath);
      showToast(
        approvalPreview.mode === 'trash'
          ? 'Files moved to Trash / Recycle Bin safely.'
          : 'Smart organization applied and logged for undo.'
      );
    } catch (err: unknown) {
      setBannerError((err as Error).message);
    } finally {
      setExecutingApproval(false);
    }
  }

  function handleInspectFile(file: FileEntry) {
    setInspectedFile(file);
    setActiveTab('explorer');
  }

  function handleRequestTrash(files: FileEntry[]) {
    if (!activeRootPath || files.length === 0) return;
    setApprovalPreview({
      mode: 'trash',
      title: `Move ${files.length === 1 ? 'File' : `${files.length} Files`} to Trash`,
      description: `Review the files below before moving them to the Trash / Recycle Bin. This operation is logged in SQLite and supports undo.`,
      rootPath: activeRootPath,
      items: files.map((f) => ({ sourcePath: f.path, size: f.size })),
      onConfirm: async () => {
        await fileforgeClient.trashFiles(
          activeRootPath,
          files.map((f) => f.path)
        );
        if (inspectedFile && files.some((f) => f.path === inspectedFile.path)) {
          setInspectedFile(null);
        }
      },
    });
  }

  const latestUndoable = operations.find((op) => !op.undone);

  async function handleQuickUndo() {
    if (!latestUndoable) return;
    try {
      const res = await fileforgeClient.undoOperation(latestUndoable.id);
      await runScan(activeRootPath);
      showToast(res.message);
    } catch (err: unknown) {
      setBannerError((err as Error).message);
    }
  }

  const navItems: Array<{ id: NavTab; label: string; icon: typeof LayoutDashboard; count?: number }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'explorer', label: 'File Explorer', icon: FolderOpen, count: scanResult?.totalFiles },
    { id: 'organizer', label: 'Smart Organizer', icon: Sparkles },
    {
      id: 'duplicates',
      label: 'Duplicate Finder',
      icon: CopyCheck,
      count: scanResult?.duplicateFilesCount,
    },
    { id: 'analyzer', label: 'Storage Analyzer', icon: PieChart },
    { id: 'cleanup', label: 'Cleanup & History', icon: History, count: operations.filter((o) => !o.undone).length },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0B0B12] text-[#F8FAFC]">
      {/* Left Navigation Sidebar */}
      <aside className="w-[252px] shrink-0 bg-[#151520] border-r border-white/8 flex flex-col justify-between">
        <div className="flex flex-col overflow-hidden">
          {/* Brand Lockup */}
          <div className="px-5 py-5 border-b border-white/8 flex items-center gap-3">
            <img
              src="/assets/aistudio/FileForge_logo_be1503bf.png"
              alt="FileForge Logo"
              referrerPolicy="no-referrer"
              className="w-10 h-10 rounded-lg object-cover shrink-0 bg-[#0B0B12]"
            />
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-tight text-[#F8FAFC] leading-tight">FileForge</h1>
              <p className="text-[11px] text-[#A1A1AA] truncate mt-0.5">Organize Smarter. Find Faster.</p>
            </div>
          </div>

          {/* Primary Navigation */}
          <nav className="p-3 space-y-1" aria-label="Primary navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[#8B5CF6] text-[#F8FAFC]'
                      : 'text-[#A1A1AA] hover:text-[#F8FAFC] hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        active ? 'text-[#F8FAFC]/90' : 'text-[#A1A1AA]'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Quick Directory Roots */}
          <div className="px-4 pt-3 pb-2 border-t border-white/8 mt-2">
            <p className="text-[11px] font-medium text-[#A1A1AA] mb-2">Quick Directories</p>
            <div className="space-y-1 max-h-44 overflow-y-auto">
              {capabilities?.quickRoots.map((root) => {
                const isCurrent = activeRootPath === root.path;
                return (
                  <button
                    key={root.path}
                    type="button"
                    onClick={() => runScan(root.path)}
                    title={root.path}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 ${
                      isCurrent
                        ? 'bg-[#0B0B12] text-[#06B6D4] border border-[#06B6D4]/30'
                        : 'text-[#A1A1AA] hover:text-[#F8FAFC] hover:bg-white/[0.03]'
                    }`}
                  >
                    <HardDrive className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{root.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Active Storage Summary Footer */}
        <div className="p-4 border-t border-white/8 bg-[#0B0B12]/50 text-xs space-y-1">
          <div className="flex items-center justify-between text-[#A1A1AA]">
            <span>Indexed Volume</span>
            <span className="font-mono text-[#F8FAFC] tabular-nums">
              {scanResult ? formatBytes(scanResult.totalBytes) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-[#A1A1AA]">
            <span>Runtime</span>
            <span className="font-mono text-[#06B6D4]">
              {capabilities?.runtime === 'electron' ? 'Windows Desktop' : 'Local Engine'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 shrink-0 px-6 border-b border-white/8 bg-[#0B0B12] flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {editingPath ? (
              <div className="flex items-center gap-2 flex-1 max-w-2xl">
                <input
                  type="text"
                  value={customPathInput}
                  onChange={(e) => setCustomPathInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmCustomPath();
                    if (e.key === 'Escape') setEditingPath(false);
                  }}
                  placeholder="Enter directory path (e.g. C:\Users\Name\Downloads or /tmp)"
                  className="flex-1 px-3 py-1.5 text-xs font-mono bg-[#151520] border border-[#8B5CF6]/50 rounded-lg text-[#F8FAFC] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleConfirmCustomPath}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-[#F8FAFC] whitespace-nowrap"
                >
                  Open & Scan
                </button>
                <button
                  type="button"
                  onClick={() => setEditingPath(false)}
                  className="px-2.5 py-1.5 text-xs text-[#A1A1AA] hover:text-[#F8FAFC]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-xs text-[#A1A1AA] shrink-0">Active Directory</span>
                <span className="text-[#A1A1AA]/40 shrink-0">/</span>
                <button
                  type="button"
                  onClick={handleSelectFolder}
                  title="Click to switch folder"
                  className="font-mono text-xs text-[#F8FAFC] hover:text-[#06B6D4] truncate transition-colors"
                >
                  {activeRootPath || 'Initializing...'}
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {latestUndoable && (
              <button
                type="button"
                onClick={handleQuickUndo}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 hover:border-[#06B6D4]/50 text-[#06B6D4] transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Undo Last
              </button>
            )}
            <button
              type="button"
              onClick={handleSelectFolder}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg border border-white/10 hover:bg-white/5 text-[#F8FAFC] transition-colors whitespace-nowrap shrink-0"
            >
              <FolderSearch className="w-3.5 h-3.5 text-[#06B6D4]" />
              {fileforgeClient.isElectron() ? 'Select Folder' : 'Change Path'}
            </button>
            <button
              type="button"
              onClick={() => runScan(activeRootPath)}
              disabled={scanning || !activeRootPath}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-[#F8FAFC] transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning...' : 'Scan Folder'}
            </button>
          </div>
        </header>

        {/* System Notices */}
        {scanResult?.isProtectedWarning && (
          <div className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/25 flex items-center gap-2.5 text-xs text-amber-200">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{scanResult.protectionNotice}</span>
          </div>
        )}

        {bannerError && (
          <div className="px-6 py-2.5 bg-red-500/10 border-b border-red-500/25 flex items-center justify-between text-xs text-red-200">
            <span>{bannerError}</span>
            <button
              type="button"
              onClick={() => setBannerError(null)}
              className="text-red-300 hover:text-white ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {toastMessage && (
          <div className="px-6 py-2.5 bg-[#06B6D4]/12 border-b border-[#06B6D4]/30 flex items-center justify-between text-xs text-[#F8FAFC]">
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-[#06B6D4] hover:text-white ml-4"
            >
              Close
            </button>
          </div>
        )}

        {/* Active Module Viewport */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {activeTab === 'dashboard' && (
            <DashboardView
              scan={scanResult}
              scanning={scanning}
              onInspectFile={handleInspectFile}
              onNavigateTab={(tab) => setActiveTab(tab)}
              onRescan={() => runScan(activeRootPath)}
            />
          )}

          {activeTab === 'explorer' && (
            <ExplorerView
              activeRootPath={activeRootPath}
              scan={scanResult}
              initialSelectedFile={inspectedFile}
              onRequestTrash={handleRequestTrash}
              onDirectoryMutated={() => runScan(activeRootPath)}
            />
          )}

          {activeTab === 'organizer' && (
            <OrganizerView
              activeRootPath={activeRootPath}
              onRequestApproval={(preview) => setApprovalPreview(preview)}
              onOrganizationApplied={() => runScan(activeRootPath)}
            />
          )}

          {activeTab === 'duplicates' && (
            <DuplicatesView
              scan={scanResult}
              onInspectFile={handleInspectFile}
              onRequestApproval={(preview) => setApprovalPreview(preview)}
              onCleanupDone={() => runScan(activeRootPath)}
            />
          )}

          {activeTab === 'analyzer' && (
            <AnalyzerView
              scan={scanResult}
              staleDays={staleDays}
              onChangeStaleDays={(days) => {
                setStaleDays(days);
                runScan(activeRootPath, days);
              }}
              onInspectFile={handleInspectFile}
              onRequestApproval={(preview) => setApprovalPreview(preview)}
              onCleanupDone={() => runScan(activeRootPath)}
            />
          )}

          {activeTab === 'cleanup' && (
            <CleanupHistoryView
              operations={operations}
              onRefresh={async () => {
                await runScan(activeRootPath);
              }}
              onWorkspaceReseeded={async () => {
                const reseeded = await fileforgeClient.reseedWorkspace();
                setScanResult(reseeded);
                setActiveRootPath(reseeded.rootPath);
                await refreshOperations();
              }}
            />
          )}
        </main>
      </div>

      {/* Explicit Approval Confirmation Modal */}
      <SafeCleanupModal
        preview={approvalPreview}
        executing={executingApproval}
        onCancel={() => !executingApproval && setApprovalPreview(null)}
      />
    </div>
  );
}
