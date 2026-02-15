// ============================================================
// Data TreeView – full header multi-select filter + date range
// ============================================================

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useFileStore } from '../../stores/fileStore';
import { useGroupStore } from '../../stores/groupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { intColorToHex } from '../../utils/colorConverter';
import type { ImportedFile, CurveChannel, ChannelRef } from '../../types';
import './DataTreeView.css';

// ── Types ────────────────────────────────────────────────────

interface DynamicFilterCat {
  key: string;       // header field name
  label: string;     // display label
  values: Map<string, number>; // value → file count
}

/** Keys to skip when auto-discovering header fields (date has its own range filter) */
const SKIP_HEADER_KEYS = new Set(['date']);

// ── Helpers ──────────────────────────────────────────────────

/** Safe cast of HeaderInfo to Record for dynamic key access. */
function headerRec(h: import('../../types').HeaderInfo): Record<string, unknown> {
  return h as unknown as Record<string, unknown>;
}

/** Try to parse a date string from header. Returns epoch ms or NaN. */
function parseHeaderDate(dateStr: string): number {
  if (!dateStr) return NaN;
  // Try ISO first, then common European "DD.MM.YYYY HH:MM:SS" etc.
  let d = Date.parse(dateStr);
  if (!isNaN(d)) return d;
  // Try DD.MM.YYYY or DD.MM.YYYY HH:MM:SS
  const m = dateStr.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, day, month, year, hh, mm, ss] = m;
    d = new Date(+year, +month - 1, +day, +(hh || 0), +(mm || 0), +(ss || 0)).getTime();
    if (!isNaN(d)) return d;
  }
  return NaN;
}

/** Dynamically discover header fields and build filter categories + channel names + date range */
function deriveFilterOptions(files: ImportedFile[]) {
  // Discover all header keys from the first file (or accumulate across all)
  const headerKeys = new Set<string>();
  for (const f of files) {
    for (const k of Object.keys(f.header)) {
      if (!SKIP_HEADER_KEYS.has(k)) headerKeys.add(k);
    }
  }

  // Build value maps per header key
  const catMaps = new Map<string, Map<string, number>>();
  for (const k of headerKeys) catMaps.set(k, new Map());

  const channelNames = new Map<string, number>();
  let dateMin = Infinity;
  let dateMax = -Infinity;

  for (const f of files) {
    const h = headerRec(f.header);
    for (const k of headerKeys) {
      const raw = h[k];
      let v = '';
      if (typeof raw === 'boolean') {
        // Special display for known boolean keys
        if (k === 'isMarked') v = raw ? 'NOK' : 'OK';
        else v = raw ? 'Yes' : 'No';
      } else if (raw != null && raw !== '') {
        v = String(raw);
      }
      if (v) {
        const m = catMaps.get(k)!;
        m.set(v, (m.get(v) || 0) + 1);
      }
    }
    for (const ch of f.curves) {
      const name = ch.description || ch.yName;
      if (name) channelNames.set(name, (channelNames.get(name) || 0) + 1);
    }
    const d = parseHeaderDate(f.header.date);
    if (!isNaN(d)) {
      if (d < dateMin) dateMin = d;
      if (d > dateMax) dateMax = d;
    }
  }

  // Build ordered dynamic category list — show ALL header fields (booleans first, then strings)
  const dynamicCats: DynamicFilterCat[] = [];
  for (const k of headerKeys) {
    const vals = catMaps.get(k)!;
    if (vals.size === 0) continue;
    dynamicCats.push({ key: k, label: k, values: vals });
  }
  // Sort: booleans first, then alphabetical by key
  dynamicCats.sort((a, b) => {
    const aB = typeof headerRec(files[0]?.header)?.[a.key] === 'boolean' ? 0 : 1;
    const bB = typeof headerRec(files[0]?.header)?.[b.key] === 'boolean' ? 0 : 1;
    if (aB !== bB) return aB - bB;
    return a.key.localeCompare(b.key);
  });

  return { dynamicCats, channelNames, dateMin: isFinite(dateMin) ? dateMin : NaN, dateMax: isFinite(dateMax) ? dateMax : NaN };
}

/** Extract a comparable string value for a header key from a file */
function extractHeaderValue(file: ImportedFile, key: string): string {
  const raw = headerRec(file.header)[key];
  if (typeof raw === 'boolean') {
    if (key === 'isMarked') return raw ? 'NOK' : 'OK';
    return raw ? 'Yes' : 'No';
  }
  return raw != null && raw !== '' ? String(raw) : '';
}

function filePassesFilter(
  file: ImportedFile,
  text: string,
  selections: Map<string, Set<string>>,
  dateFrom: string,
  dateTo: string,
  channelFilter: Set<string>,
  dynamicCats: DynamicFilterCat[],
): boolean {
  // Multi-select filters: AND across categories, OR within
  for (const cat of dynamicCats) {
    const sel = selections.get(cat.key);
    if (!sel || sel.size === 0) continue;
    if (!sel.has(extractHeaderValue(file, cat.key))) return false;
  }

  // Channel name filter: file must have at least one matching channel
  if (channelFilter.size > 0) {
    const hasMatch = file.curves.some((ch) => channelFilter.has(ch.description || ch.yName));
    if (!hasMatch) return false;
  }

  // Date range
  if (dateFrom || dateTo) {
    const fd = parseHeaderDate(file.header.date);
    if (isNaN(fd)) return false;
    if (dateFrom) {
      const fromMs = new Date(dateFrom).getTime();
      if (!isNaN(fromMs) && fd < fromMs) return false;
    }
    if (dateTo) {
      const toMs = new Date(dateTo).getTime();
      if (!isNaN(toMs) && fd > toMs) return false;
    }
  }

  // Free-text: search all header values + filename + channels
  if (!text) return true;
  const lf = text.toLowerCase();
  if (file.filename.toLowerCase().includes(lf)) return true;
  const h = headerRec(file.header);
  for (const k of Object.keys(h)) {
    const v = h[k];
    if (v != null && String(v).toLowerCase().includes(lf)) return true;
  }
  for (const ch of file.curves) {
    if (ch.description?.toLowerCase().includes(lf)) return true;
    if (ch.yName?.toLowerCase().includes(lf)) return true;
    if (ch.xName?.toLowerCase().includes(lf)) return true;
    if (ch.yUnit?.toLowerCase().includes(lf)) return true;
  }
  return false;
}

function selKey(fId: string, cId: string) { return `${fId}::${cId}`; }

/** Return the channels of a file that are visible given the current filter state. */
function getVisibleChannels(
  file: ImportedFile,
  channelFilter: Set<string>,
  searchText: string,
): import('../../types').CurveChannel[] {
  return file.curves.filter((c) => {
    const name = c.description || c.yName;
    if (channelFilter.size > 0 && !channelFilter.has(name)) return false;
    if (searchText) {
      const lf = searchText.toLowerCase();
      const matchesFileOrHeader =
        file.filename.toLowerCase().includes(lf) ||
        Object.values(headerRec(file.header)).some(
          (v) => v != null && String(v).toLowerCase().includes(lf),
        );
      if (!matchesFileOrHeader) {
        if (
          !(name?.toLowerCase().includes(lf)) &&
          !(c.yName?.toLowerCase().includes(lf)) &&
          !(c.xName?.toLowerCase().includes(lf)) &&
          !(c.yUnit?.toLowerCase().includes(lf)) &&
          !(c.xUnit?.toLowerCase().includes(lf))
        ) return false;
      }
    }
    return true;
  });
}

/** Estimate the pixel width of a string at ~11px font. Rough but fast. */
function estimateTextPx(text: string, fontSize = 11): number {
  // average char width ≈ 0.6 × fontSize for monospace-ish UI fonts
  return Math.ceil(text.length * fontSize * 0.58) + 30; // +30 for padding/arrow/clear
}

/** Compute the width a filter column needs: max(label, longest option, "N ausgewählt"). Capped. */
function calcFilterWidth(label: string, options: Map<string, number>, maxW = 220, minW = 80): number {
  let w = estimateTextPx(label, 9); // label row
  for (const [v] of options) w = Math.max(w, estimateTextPx(v));
  w = Math.max(w, estimateTextPx(`${options.size} selected`));
  return Math.max(minW, Math.min(w, maxW));
}

// ── MultiSelect dropdown sub-component ──────────────────────

interface MultiSelectProps {
  label: string;
  options: Map<string, number>;  // value → count
  selected: Set<string>;
  onToggle: (val: string) => void;
  onClear: () => void;
  width?: number; // auto-computed column width
}

const MultiSelect: React.FC<MultiSelectProps> = ({ label, options, selected, onToggle, onClear, width }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const entries = useMemo(() => {
    const arr = Array.from(options.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    if (!search) return arr;
    const lf = search.toLowerCase();
    return arr.filter(([v]) => v.toLowerCase().includes(lf));
  }, [options, search]);

  const triggerText = selected.size === 0
    ? 'All'
    : selected.size === 1
      ? Array.from(selected)[0]
      : `${selected.size} selected`;

  return (
    <div className="flt-row" ref={ref} style={width ? { width } : undefined}>
      <span className="flt-label">{label}</span>
      <div className="flt-ms">
        <button
          className={`flt-ms-trigger${selected.size > 0 ? ' active' : ''}`}
          onClick={() => setOpen(!open)}
        >
          <span className="flt-ms-text">{triggerText}</span>
          <span className="flt-ms-arrow">{open ? '▲' : '▼'}</span>
        </button>
        {selected.size > 0 && (
          <button className="flt-ms-clear" onClick={onClear} title="Reset filter">✕</button>
        )}
        {open && (
          <div className="flt-ms-popup">
            {options.size > 6 && (
              <input
                className="flt-ms-search"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            )}
            <div className="flt-ms-list">
              {entries.length === 0 && <div className="flt-ms-empty">No matches</div>}
              {entries.map(([val, cnt]) => (
                <label key={val} className="flt-ms-item">
                  <input
                    type="checkbox"
                    checked={selected.has(val)}
                    onChange={() => onToggle(val)}
                  />
                  <span className="flt-ms-val">{val}</span>
                  <span className="flt-ms-cnt">{cnt}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main Component ───────────────────────────────────────────
export const DataTreeView: React.FC = () => {
  const files = useFileStore((s) => s.files);
  const removeFile = useFileStore((s) => s.removeFile);
  const clearFiles = useFileStore((s) => s.clearFiles);
  const groups = useGroupStore((s) => s.groups);
  const createGroup = useGroupStore((s) => s.createGroup);
  const addChannelsToGroup = useGroupStore((s) => s.addChannelsToGroup);
  const clearGroups = useGroupStore((s) => s.clearGroups);
  const setTreeSelection = useSettingsStore((s) => s.setTreeSelection);

  // collapse / expand
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [expandedHeaders, setExpandedHeaders] = useState<Set<string>>(new Set());

  // filter state
  const [searchText, setSearchText] = useState('');
  const [selections, setSelections] = useState<Map<string, Set<string>>>(new Map());
  const [channelFilter, setChannelFilter] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterOpen, setFilterOpen] = useState(true);
  const [dataOpen, setDataOpen] = useState(true);

  // sort
  type SortKey = 'name' | 'name-desc' | 'date' | 'date-desc' | 'import' | 'import-desc' | 'channels' | 'channels-desc';
  const [sortKey, setSortKey] = useState<SortKey>('import');

  // selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);

  // ── Toggle helpers ──
  const toggleFile = useCallback((id: string) => {
    setCollapsedFiles((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const toggleHeader = useCallback((id: string) => {
    setExpandedHeaders((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  // ── Filter option data ──
  const filterOpts = useMemo(() => deriveFilterOptions(files), [files]);

  // Dynamic categories are already filtered in deriveFilterOptions
  const visibleCats = filterOpts.dynamicCats;

  const hasDates = !isNaN(filterOpts.dateMin);
  const hasChannels = filterOpts.channelNames.size > 1;

  const toggleChannelFilter = useCallback((name: string) => {
    setChannelFilter((prev) => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }, []);

  const clearChannelFilter = useCallback(() => setChannelFilter(new Set()), []);

  const toggleSelection = useCallback((catKey: string, val: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const s = new Set(next.get(catKey) || []);
      s.has(val) ? s.delete(val) : s.add(val);
      s.size === 0 ? next.delete(catKey) : next.set(catKey, s);
      return next;
    });
  }, []);

  const clearCat = useCallback((catKey: string) => {
    setSelections((prev) => { const n = new Map(prev); n.delete(catKey); return n; });
  }, []);

  const activeFilterCount = useMemo(() => {
    let c = searchText ? 1 : 0;
    for (const v of selections.values()) c += v.size;
    c += channelFilter.size;
    if (dateFrom) c++;
    if (dateTo) c++;
    return c;
  }, [searchText, selections, channelFilter, dateFrom, dateTo]);

  const clearAllFilters = useCallback(() => {
    setSearchText('');
    setSelections(new Map());
    setChannelFilter(new Set());
    setDateFrom('');
    setDateTo('');
  }, []);

  // ── Filtered files ──
  const filteredFilesUnsorted = useMemo(() => {
    if (!searchText && selections.size === 0 && channelFilter.size === 0 && !dateFrom && !dateTo) return files;
    return files.filter((f) => filePassesFilter(f, searchText, selections, dateFrom, dateTo, channelFilter, visibleCats));
  }, [files, searchText, selections, channelFilter, dateFrom, dateTo, visibleCats]);

  // ── Sorted files ──
  const filteredFiles = useMemo(() => {
    const arr = [...filteredFilesUnsorted];
    const cmp = (a: ImportedFile, b: ImportedFile): number => {
      switch (sortKey) {
        case 'name':          return a.filename.localeCompare(b.filename);
        case 'name-desc':     return b.filename.localeCompare(a.filename);
        case 'date':          return (a.header.date || '').localeCompare(b.header.date || '');
        case 'date-desc':     return (b.header.date || '').localeCompare(a.header.date || '');
        case 'import':        return (a.importedAt ?? 0) - (b.importedAt ?? 0);
        case 'import-desc':   return (b.importedAt ?? 0) - (a.importedAt ?? 0);
        case 'channels':      return a.curves.length - b.curves.length;
        case 'channels-desc': return b.curves.length - a.curves.length;
        default: return 0;
      }
    };
    arr.sort(cmp);
    return arr;
  }, [filteredFilesUnsorted, sortKey]);

  // ── Selection helpers ──
  const toggleSelect = useCallback((fId: string, cId: string) => {
    const k = selKey(fId, cId);
    setSelected((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }, []);

  const selectAllOfFile = useCallback((file: ImportedFile) => {
    const vis = getVisibleChannels(file, channelFilter, searchText);
    setSelected((prev) => {
      const n = new Set(prev);
      const allSelected = vis.every((c) => n.has(selKey(file.id, c.id)));
      for (const c of vis) {
        if (allSelected) n.delete(selKey(file.id, c.id));
        else n.add(selKey(file.id, c.id));
      }
      return n;
    });
  }, [channelFilter, searchText]);

  // Pre-compute all selectable keys for the current filtered list (cached)
  const allSelectableKeys = useMemo(() => {
    const keys: string[] = [];
    for (const f of filteredFiles) {
      const vis = getVisibleChannels(f, channelFilter, searchText);
      for (const c of vis) keys.push(selKey(f.id, c.id));
    }
    return keys;
  }, [filteredFiles, channelFilter, searchText]);

  const selectAll = useCallback(() => {
    setSelected((prev) => {
      const allSelected = allSelectableKeys.length > 0 && allSelectableKeys.every((k) => prev.has(k));
      return allSelected ? new Set() : new Set(allSelectableKeys);
    });
  }, [allSelectableKeys]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectedRefs = useMemo((): ChannelRef[] =>
    Array.from(selected).map((k) => {
      const [fileId, channelId] = k.split('::');
      return { fileId, channelId };
    }),
  [selected]);

  // Sync tree-view checkbox selection to the global store (debounced)
  const treeSelTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(treeSelTimer.current);
    treeSelTimer.current = setTimeout(() => setTreeSelection(selected), 100);
    return () => clearTimeout(treeSelTimer.current);
  }, [selected, setTreeSelection]);

  // ── Group actions ──
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const handleGroupFromSelection = useCallback(() => {
    if (selectedRefs.length === 0) return;
    setNewGroupName(`Group ${groups.length + 1}`);
    setCreatingGroup(true);
  }, [groups.length, selectedRefs.length]);

  const finishCreateGroup = useCallback(() => {
    const name = newGroupName.trim();
    if (name && selectedRefs.length > 0) {
      createGroup(name, selectedRefs);
      clearSelection();
    }
    setCreatingGroup(false);
    setNewGroupName('');
  }, [newGroupName, selectedRefs, createGroup, clearSelection]);

  const cancelCreateGroup = useCallback(() => {
    setCreatingGroup(false);
    setNewGroupName('');
  }, []);

  const handleAssignToGroup = useCallback((gId: string) => {
    if (selectedRefs.length > 0) addChannelsToGroup(gId, selectedRefs);
    clearSelection();
    setAssignOpen(false);
  }, [selectedRefs, addChannelsToGroup, clearSelection]);

  const handleAddFileToGroup = useCallback(
    (gId: string, file: ImportedFile) => {
      const vis = getVisibleChannels(file, channelFilter, searchText);
      addChannelsToGroup(gId, vis.map((c) => ({ fileId: file.id, channelId: c.id })));
    },
    [addChannelsToGroup, channelFilter, searchText],
  );

  // ── Drag & drop ──
  const onDragChannel = useCallback(
    (e: React.DragEvent, fId: string, cId: string) => {
      const k = selKey(fId, cId);
      const refs = selected.has(k) && selected.size > 1 ? selectedRefs : [{ fileId: fId, channelId: cId }];
      e.dataTransfer.setData('application/channels', JSON.stringify(refs));
      e.dataTransfer.effectAllowed = 'copyMove';
    },
    [selected, selectedRefs],
  );

  const onDragFile = useCallback(
    (e: React.DragEvent, file: ImportedFile) => {
      // If any channel of this file is part of a multi-selection, drag ALL selected refs
      const fileHasSelection = file.curves.some((c) => selected.has(selKey(file.id, c.id)));
      if (fileHasSelection && selected.size > 1) {
        e.dataTransfer.setData('application/channels', JSON.stringify(selectedRefs));
      } else {
        const vis = getVisibleChannels(file, channelFilter, searchText);
        e.dataTransfer.setData(
          'application/channels',
          JSON.stringify(vis.map((c) => ({ fileId: file.id, channelId: c.id }))),
        );
      }
      e.dataTransfer.effectAllowed = 'copyMove';
    },
    [channelFilter, searchText, selected, selectedRefs],
  );

  // ── Render: channel row ──
  const renderChannel = (
    ch: CurveChannel,
    fId: string,
  ) => {
    const color = intColorToHex(ch.lineColor);
    const k = selKey(fId, ch.id);
    const isSel = selected.has(k);

    return (
      <div
        key={`${fId}-${ch.id}`}
        className={`tv-channel${isSel ? ' sel' : ''}`}
        draggable
        onDragStart={(e) => onDragChannel(e, fId, ch.id)}
      >
        <input
          type="checkbox"
          className="tv-cb"
          checked={isSel}
          onChange={() => toggleSelect(fId, ch.id)}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="tv-color" style={{ background: color }} />
        <span className="tv-ch-name">{ch.description || ch.yName}</span>
        <span className="tv-ch-unit">{ch.yUnit ? `[${ch.yUnit}]` : ''}</span>
        {ch.noOfPoints > 0 && <span className="tv-ch-pts">{ch.noOfPoints} pts</span>}
      </div>
    );
  };

  // ── Render: file node ──
  const renderFileNode = (file: ImportedFile) => {
    const collapsed = collapsedFiles.has(file.id);
    const headerOpen = expandedHeaders.has(file.id);
    const h = file.header;
    const visCh = getVisibleChannels(file, channelFilter, searchText);
    const allSel = visCh.length > 0 && visCh.every((c) => selected.has(selKey(file.id, c.id)));
    const someSel = visCh.some((c) => selected.has(selKey(file.id, c.id)));

    return (
      <div key={file.id} className="tv-file">
        <div className="tv-file-row" draggable onDragStart={(e) => onDragFile(e, file)}>
          <input
            type="checkbox"
            className="tv-cb"
            checked={allSel}
            ref={(el) => { if (el) el.indeterminate = someSel && !allSel; }}
            onChange={() => selectAllOfFile(file)}
            onClick={(e) => e.stopPropagation()}
          />
          <span className={`tv-caret${collapsed ? '' : ' open'}`} onClick={() => toggleFile(file.id)}>▶</span>
          <span className="tv-file-icon">📄</span>
          <span className="tv-file-name" onClick={() => toggleFile(file.id)} title={file.filename}>
            {file.filename}
          </span>
          <span className="tv-file-count">{visCh.length}{visCh.length !== file.curves.length ? ` / ${file.curves.length}` : ''} ch</span>
          <div className="tv-file-actions">
            {groups.length > 0 && (
              <select
                className="tv-group-sel"
                value=""
                title="Add file to group"
                onChange={(e) => { if (e.target.value) handleAddFileToGroup(e.target.value, file); e.target.value = ''; }}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="">→ Group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
            <button className="tv-x" title="Remove file" onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}>✕</button>
          </div>
        </div>
        {!collapsed && (
          <div className="tv-file-children">
            <div className="tv-header-row" onClick={() => toggleHeader(file.id)}>
              <span className={`tv-caret sm${headerOpen ? ' open' : ''}`}>▶</span>
              <span className="tv-header-label">Header</span>
              <span className="tv-header-summary">
                {h.machineShortDesc}{h.moduleShortDesc ? ` · ${h.moduleShortDesc}` : ''}
                {h.nameOfMeasurePoint ? ` · ${h.nameOfMeasurePoint}` : ''}
              </span>
            </div>
            {headerOpen && (
              <div className="tv-header-details">
                {h.machineDesc && <div className="hd"><span className="hd-k">Machine</span>{h.machineDesc} ({h.machineShortDesc})</div>}
                {h.moduleDesc && <div className="hd"><span className="hd-k">Module</span>{h.moduleDesc} ({h.moduleShortDesc})</div>}
                {h.nameOfMeasurePoint && <div className="hd"><span className="hd-k">Meas. Point</span>{h.nameOfMeasurePoint}</div>}
                {h.idString && <div className="hd"><span className="hd-k">ID</span>{h.idString}</div>}
                {h.diagramTitle && <div className="hd"><span className="hd-k">Title</span>{h.diagramTitle}</div>}
                {h.date && <div className="hd"><span className="hd-k">Date</span>{h.date}</div>}
                {(h.type || h.variant) && <div className="hd"><span className="hd-k">Type/Var</span>{h.type} / {h.variant}</div>}
              </div>
            )}
            {getVisibleChannels(file, channelFilter, searchText)
              .map((c) => renderChannel(c, file.id))}
          </div>
        )}
      </div>
    );
  };

  // ── Windowed rendering ──
  const FILE_ROW_HEIGHT = 28; // estimated px per collapsed file row
  const OVERSCAN = 20; // render this many extra rows above/below viewport
  const fileListRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 80]);

  const updateVisibleRange = useCallback(() => {
    const el = fileListRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const viewH = el.clientHeight;
    const startIdx = Math.max(0, Math.floor(scrollTop / FILE_ROW_HEIGHT) - OVERSCAN);
    const endIdx = Math.ceil((scrollTop + viewH) / FILE_ROW_HEIGHT) + OVERSCAN;
    setVisibleRange((prev) => {
      if (prev[0] === startIdx && prev[1] === endIdx) return prev;
      return [startIdx, endIdx];
    });
  }, []);

  // Attach scroll listener to file list container
  useEffect(() => {
    const el = fileListRef.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => { updateVisibleRange(); ticking = false; });
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    updateVisibleRange();
    return () => el.removeEventListener('scroll', onScroll);
  }, [updateVisibleRange, filteredFiles.length, dataOpen]);

  // ── Active filter tags (summary) ──
  const filterTags = useMemo(() => {
    const tags: { label: string; onRemove: () => void }[] = [];
    for (const [catKey, sel] of selections.entries()) {
      if (sel.size === 0) continue;
      const catLabel = visibleCats.find((c) => c.key === catKey)?.label || catKey;
      for (const v of sel) {
        tags.push({ label: `${catLabel}: ${v}`, onRemove: () => toggleSelection(catKey, v) });
      }
    }
    for (const v of channelFilter) {
      tags.push({ label: `Channel: ${v}`, onRemove: () => toggleChannelFilter(v) });
    }
    if (dateFrom) tags.push({ label: `From: ${dateFrom.replace('T', ' ')}`, onRemove: () => setDateFrom('') });
    if (dateTo) tags.push({ label: `To: ${dateTo.replace('T', ' ')}`, onRemove: () => setDateTo('') });
    return tags;
  }, [selections, channelFilter, dateFrom, dateTo, toggleSelection, toggleChannelFilter]);

  // ── Main render ──
  const allSel = allSelectableKeys.length > 0 && allSelectableKeys.every((k) => selected.has(k));

  return (
    <div className="data-tree-view">
      {/* ── Filter Panel ── */}
      <div className="tv-filter">
        {/* Free-text search */}
        <div className="tv-search-row">
          <span className="tv-search-icon">🔍</span>
          <input
            className="tv-search"
            type="text"
            placeholder="Search: filename, channel, unit ..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          {activeFilterCount > 0 && (
            <button className="tv-filter-badge" onClick={clearAllFilters} title="Reset all filters">
              {activeFilterCount} ✕
            </button>
          )}
        </div>

        {/* Collapsible multi-select filter panel */}
        {files.length > 0 && (visibleCats.length > 0 || hasDates) && (
          <div className="tv-flt-panel">
            <div className="tv-flt-header" onClick={() => setFilterOpen(!filterOpen)}>
              <span className={`tv-caret sm${filterOpen ? ' open' : ''}`}>▶</span>
              <span className="tv-flt-title">Filter</span>
              {activeFilterCount > 0 && <span className="tv-flt-count">{activeFilterCount} active</span>}
            </div>
            {filterOpen && (
              <div className="tv-flt-body">
                {visibleCats.map((cat) => (
                  <MultiSelect
                    key={cat.key}
                    label={cat.label}
                    options={cat.values}
                    selected={selections.get(cat.key) || new Set()}
                    onToggle={(v) => toggleSelection(cat.key, v)}
                    onClear={() => clearCat(cat.key)}
                    width={calcFilterWidth(cat.label, cat.values)}
                  />
                ))}
                {hasChannels && (
                  <MultiSelect
                    key="__channel"
                    label="Channel"
                    options={filterOpts.channelNames}
                    selected={channelFilter}
                    onToggle={toggleChannelFilter}
                    onClear={clearChannelFilter}
                    width={calcFilterWidth('Channel', filterOpts.channelNames)}
                  />
                )}
                {hasDates && (
                  <div className="flt-row flt-row-wide">
                    <span className="flt-label">Date</span>
                    <div className="flt-date-range">
                      <input
                        type="datetime-local"
                        step="1"
                        className="flt-date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        title="From"
                      />
                      <span className="flt-date-sep">–</span>
                      <input
                        type="datetime-local"
                        step="1"
                        className="flt-date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        title="To"
                      />
                      {(dateFrom || dateTo) && (
                        <button className="flt-ms-clear" onClick={() => { setDateFrom(''); setDateTo(''); }} title="Reset">✕</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Active filter tags */}
        {filterTags.length > 0 && (
          <div className="tv-flt-tags">
            {filterTags.map((t, i) => (
              <span key={i} className="tv-flt-tag">
                {t.label}
                <button className="tv-flt-tag-x" onClick={t.onRemove}>✕</button>
              </span>
            ))}
            <button className="tv-flt-tag-clear" onClick={clearAllFilters}>Clear all</button>
          </div>
        )}
      </div>

      {/* ── Selection toolbar ── */}
      {selected.size > 0 && (
        <div className="tv-sel-bar">
          <span className="tv-sel-count">{selected.size} selected</span>
          <button className="tv-sel-btn" onClick={selectAll}>All</button>
          <button className="tv-sel-btn" onClick={clearSelection}>Deselect</button>
          <button className="tv-sel-btn accent" onClick={handleGroupFromSelection}>+ New Group</button>
          {creatingGroup && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                autoFocus
                className="tv-filter-input"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') finishCreateGroup(); if (e.key === 'Escape') cancelCreateGroup(); }}
                style={{ width: 120, padding: '2px 6px', fontSize: 11 }}
                placeholder="Group name"
              />
              <button className="tv-sel-btn accent" onClick={finishCreateGroup} style={{ padding: '2px 8px' }} title="Create group (Enter)">OK</button>
              <button className="tv-sel-btn" onClick={cancelCreateGroup} style={{ padding: '2px 8px' }} title="Cancel (Escape)">✕</button>
            </div>
          )}
          {groups.length > 0 && (
            <div className="tv-sel-assign">
              <button className="tv-sel-btn accent" onClick={() => setAssignOpen(!assignOpen)}>→ Group ▾</button>
              {assignOpen && (
                <div className="tv-sel-dropdown">
                  {groups.map((g) => (
                    <button key={g.id} className="tv-sel-dd-item" onClick={() => handleAssignToGroup(g.id)}>
                      {g.name} ({g.channels.length})
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Files ── */}
      <div className="tv-section-hdr" onClick={() => setDataOpen(!dataOpen)}>
        <span className="tv-section-toggle">
          <span className={`tv-caret sm${dataOpen ? ' open' : ''}`}>▶</span>
          Files ({filteredFiles.length}{activeFilterCount > 0 ? ` / ${files.length}` : ''})
        </span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          <select
            className="tv-sort-sel"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            title="Sort"
          >
            <option value="import">Import ↑</option>
            <option value="import-desc">Import ↓</option>
            <option value="name">Name A→Z</option>
            <option value="name-desc">Name Z→A</option>
            <option value="date">Date ↑</option>
            <option value="date-desc">Date ↓</option>
            <option value="channels">Channels ↑</option>
            <option value="channels-desc">Channels ↓</option>
          </select>
          {files.length > 0 && (
            <button className="tv-btn-danger" onClick={() => { if (confirm(`Delete all ${files.length} files and all groups?`)) { clearFiles(); clearGroups(); } }} title="Remove all imported files and groups">🗑 Clear</button>
          )}
          {filteredFiles.length > 0 && (
            <button className="tv-btn-text" onClick={selectAll}>{allSel ? '☑' : '☐'} All</button>
          )}
        </div>
      </div>
      {dataOpen && (filteredFiles.length === 0 ? (
        <div className="tv-empty">{files.length === 0 ? 'No files imported' : 'No matches'}</div>
      ) : (
        <div
          className="tv-file-list"
          ref={fileListRef}
          style={{ flex: 1, overflowY: 'auto', position: 'relative' }}
        >
          {/* Top spacer for windowed rendering */}
          {visibleRange[0] > 0 && (
            <div style={{ height: visibleRange[0] * FILE_ROW_HEIGHT }} />
          )}
          {filteredFiles.slice(visibleRange[0], visibleRange[1]).map((file) => renderFileNode(file))}
          {/* Bottom spacer */}
          {visibleRange[1] < filteredFiles.length && (
            <div style={{ height: (filteredFiles.length - visibleRange[1]) * FILE_ROW_HEIGHT }} />
          )}
        </div>
      ))}
    </div>
  );
};
