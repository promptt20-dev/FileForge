import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpLeft,
  ChevronRight,
  ExternalLink,
  File as FileIcon,
  Folder,
  FolderPlus,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import { fileforgeClient, formatBytes, formatDateShort } from '../api/fileforgeClient';
import type { DirectoryListing, FileEntry, ScanResult } from '../shared/types';
import { FilePreviewPanel } from './FilePreviewPanel';

type SortField = 'name' | 'size' | 'type' | 'date';

interface ExplorerViewProps {
  activeRootPath: string;
  scan: ScanResult | null;
  initialSelectedFile: FileEntry | null;
  onRequestTrash: (files: FileEntry[]) => void;
  onDirectoryMutated: () => void;
}

export function ExplorerView({
  activeRootPath,
  scan,
  initialSelectedFile,
  onRequestTrash,
  onDirectoryMutated,
}: ExplorerViewProps) {
  const [currentDir, setCurrentDir] = useState<string>(activeRootPath);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchGlobal, setSearchGlobal] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [extFilter, setExtFilter] = useState<string>('all');
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(initialSelectedFile);

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCurrentDir(activeRootPath);
  }, [activeRootPath]);

  useEffect(() => {
    if (initialSelectedFile) {
      setSelectedFile(initialSelectedFile);
      if (initialSelectedFile.parentPath) {
        setCurrentDir(initialSelectedFile.parentPath);
      }
    }
  }, [initialSelectedFile]);

  async function loadDirectory(targetPath: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await fileforgeClient.listDirectory(targetPath);
      setListing(data);
      setCurrentDir(data.currentPath);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (currentDir) {
      loadDirectory(currentDir);
    }
  }, [currentDir]);

  const sourceEntries = useMemo(() => {
    if (searchGlobal && scan) {
      return scan.allFiles;
    }
    return listing?.entries || [];
  }, [searchGlobal, scan, listing]);

  const availableExtensions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of sourceEntries) {
      if (entry.isDirectory) continue;
      const ext = entry.extension || '(none)';
      counts.set(ext, (counts.get(ext) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [sourceEntries]);

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = sourceEntries.filter((entry) => {
      if (q && !entry.name.toLowerCase().includes(q) && !entry.relativePath.toLowerCase().includes(q)) {
        return false;
      }
      if (extFilter !== 'all') {
        if (entry.isDirectory) return false;
        const entryExt = entry.extension || '(none)';
        if (entryExt !== extFilter) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'size') {
        cmp = a.size - b.size;
      } else if (sortField === 'type') {
        cmp = (a.extension || a.category).localeCompare(b.extension || b.category);
      } else if (sortField === 'date') {
        cmp = a.modifiedAt - b.modifiedAt;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [sourceEntries, searchQuery, extFilter, sortField, sortAsc]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(field === 'name' || field === 'type');
    }
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    try {
      await fileforgeClient.createDirectory(currentDir, newFolderName.trim());
      setNewFolderName('');
      setCreatingFolder(false);
      await loadDirectory(currentDir);
      onDirectoryMutated();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function handleUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      await fileforgeClient.uploadFiles(currentDir, files);
      await loadDirectory(currentDir);
      onDirectoryMutated();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  // Build path breadcrumbs supporting both / and \ separators
  const breadcrumbs = useMemo(() => {
    const parts = currentDir.split(/[/\\]/).filter(Boolean);
    const isWindows = /^[a-z]:/i.test(currentDir);
    const items: Array<{ label: string; fullPath: string }> = [];
    let running = isWindows ? '' : '/';
    parts.forEach((part, idx) => {
      if (isWindows) {
        running = idx === 0 ? `${part}\\` : `${running}${running.endsWith('\\') ? '' : '\\'}${part}`;
      } else {
        running = running === '/' ? `/${part}` : `${running}/${part}`;
      }
      items.push({ label: part, fullPath: running });
    });
    return items;
  }, [currentDir]);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Explorer Toolbar */}
        <div className="px-6 py-4 border-b border-white/8 space-y-3 bg-[#0B0B12]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Breadcrumb Navigation */}
            <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto">
              <button
                type="button"
                onClick={() => listing?.parentPath && loadDirectory(listing.parentPath)}
                disabled={!listing?.parentPath}
                title="Parent directory"
                className="p-1.5 rounded-lg border border-white/10 text-[#A1A1AA] hover:text-[#F8FAFC] hover:bg-white/5 disabled:opacity-35 transition-colors shrink-0"
              >
                <ArrowUpLeft className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-center gap-1 text-xs font-mono overflow-x-auto py-1">
                {breadcrumbs.map((crumb, idx) => (
                  <div key={crumb.fullPath} className="flex items-center gap-1 shrink-0">
                    {idx > 0 && <ChevronRight className="w-3 h-3 text-[#A1A1AA]/60" />}
                    <button
                      type="button"
                      onClick={() => {
                        setSearchGlobal(false);
                        loadDirectory(crumb.fullPath);
                      }}
                      className={`px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors ${
                        idx === breadcrumbs.length - 1 ? 'text-[#F8FAFC] font-medium' : 'text-[#A1A1AA]'
                      }`}
                    >
                      {crumb.label}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Folder Actions */}
            <div className="flex items-center gap-2 shrink-0">
              {!fileforgeClient.isElectron() && (
                <>
                  <input
                    ref={uploadInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handleUploadFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => uploadInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 hover:bg-white/5 text-[#F8FAFC] transition-colors whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#06B6D4]" />
                    Add Files
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setCreatingFolder((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 hover:bg-white/5 text-[#F8FAFC] transition-colors whitespace-nowrap"
              >
                <FolderPlus className="w-3.5 h-3.5 text-[#8B5CF6]" />
                New Folder
              </button>
            </div>
          </div>

          {creatingFolder && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#151520] border border-[#8B5CF6]/40">
              <input
                type="text"
                placeholder="Folder name..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') setCreatingFolder(false);
                }}
                className="flex-1 bg-[#0B0B12] border border-white/10 rounded-md px-3 py-1.5 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#8B5CF6]"
              />
              <button
                type="button"
                onClick={handleCreateFolder}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#8B5CF6] hover:bg-[#7C3AED] text-[#F8FAFC]"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreatingFolder(false)}
                className="px-3 py-1.5 text-xs text-[#A1A1AA] hover:text-[#F8FAFC]"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Search, Scope & Filter Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-[#A1A1AA] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchGlobal ? 'Search all scanned files...' : 'Filter current folder...'}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#151520] border border-white/10 rounded-lg text-[#F8FAFC] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div className="flex items-center p-0.5 rounded-lg bg-[#151520] border border-white/8">
              <button
                type="button"
                onClick={() => setSearchGlobal(false)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap ${
                  !searchGlobal ? 'bg-[#8B5CF6] text-[#F8FAFC] font-medium' : 'text-[#A1A1AA] hover:text-[#F8FAFC]'
                }`}
              >
                Current Folder
              </button>
              <button
                type="button"
                onClick={() => setSearchGlobal(true)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap ${
                  searchGlobal ? 'bg-[#8B5CF6] text-[#F8FAFC] font-medium' : 'text-[#A1A1AA] hover:text-[#F8FAFC]'
                }`}
              >
                All Scanned ({scan?.totalFiles ?? 0})
              </button>
            </div>

            <select
              aria-label="Filter by file extension"
              value={extFilter}
              onChange={(e) => setExtFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-[#151520] border border-white/10 rounded-lg text-[#F8FAFC] focus:outline-none focus:border-[#8B5CF6]"
            >
              <option value="all">All Extensions</option>
              {availableExtensions.map(([ext, count]) => (
                <option key={ext} value={ext}>
                  {ext} ({count})
                </option>
              ))}
            </select>
          </div>

          {listing?.isProtected && (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{listing.warningMessage || 'Protected directory: read-only browsing enabled.'}</span>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* High-Density Explorer Data Grid */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-[#151520] border-b border-white/8 text-[11px] font-medium text-[#A1A1AA]">
              <tr>
                <th className="py-2.5 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('name')}
                    className="inline-flex items-center gap-1 hover:text-[#F8FAFC] transition-colors"
                  >
                    Name
                    {sortField === 'name' && (sortAsc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                  </button>
                </th>
                <th className="py-2.5 px-3">
                  <button
                    type="button"
                    onClick={() => toggleSort('type')}
                    className="inline-flex items-center gap-1 hover:text-[#F8FAFC] transition-colors"
                  >
                    Type / Category
                    {sortField === 'type' && (sortAsc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('size')}
                    className="inline-flex items-center gap-1 hover:text-[#F8FAFC] transition-colors ml-auto"
                  >
                    Size
                    {sortField === 'size' && (sortAsc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('date')}
                    className="inline-flex items-center gap-1 hover:text-[#F8FAFC] transition-colors ml-auto"
                  >
                    Modified
                    {sortField === 'date' && (sortAsc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                  </button>
                </th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[#A1A1AA]">
                    Loading directory entries...
                  </td>
                </tr>
              ) : filteredAndSorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#A1A1AA]">
                    No matching files or folders found.
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((entry) => {
                  const isSelected = selectedFile?.path === entry.path;
                  return (
                    <tr
                      key={entry.path}
                      onClick={() => {
                        if (entry.isDirectory) {
                          setSearchGlobal(false);
                          setExtFilter('all');
                          loadDirectory(entry.path);
                        } else {
                          setSelectedFile(entry);
                        }
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-[#8B5CF6]/12' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <td className="py-2.5 px-4 max-w-[320px]">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {entry.isDirectory ? (
                            <Folder className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                          ) : (
                            <FileIcon className="w-4 h-4 text-[#06B6D4] shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="text-[#F8FAFC] font-medium truncate">{entry.name}</p>
                            {searchGlobal && (
                              <p className="text-[11px] font-mono text-[#A1A1AA] truncate">{entry.relativePath}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-[#A1A1AA] whitespace-nowrap">
                        {entry.isDirectory ? (
                          'Folder'
                        ) : (
                          <span>
                            {entry.category} · <span className="font-mono">{entry.extension || 'bin'}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[#F8FAFC] tabular-nums whitespace-nowrap">
                        {entry.isDirectory ? '—' : formatBytes(entry.size)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[#A1A1AA] tabular-nums whitespace-nowrap">
                        {formatDateShort(entry.modifiedAt)}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {!entry.isDirectory && (
                          <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => fileforgeClient.openWithOS(entry.path)}
                              title="Open with OS"
                              className="p-1.5 rounded hover:bg-white/10 text-[#A1A1AA] hover:text-[#F8FAFC] transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onRequestTrash([entry])}
                              title="Move to Trash"
                              className="p-1.5 rounded hover:bg-red-500/15 text-[#A1A1AA] hover:text-red-300 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* File Preview Right Panel */}
      <FilePreviewPanel
        file={selectedFile}
        onClose={() => setSelectedFile(null)}
        onRequestTrash={(f) => onRequestTrash([f])}
        onFileRenamed={() => {
          setSelectedFile(null);
          loadDirectory(currentDir);
          onDirectoryMutated();
        }}
      />
    </div>
  );
}
