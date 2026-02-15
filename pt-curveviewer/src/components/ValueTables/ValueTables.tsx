// ============================================================
// Value Tables — Set & Actual Value Tables with synced scroll
// ============================================================

import React, { useRef, useCallback, useState, useMemo } from 'react';
import { useFileStore } from '../../stores/fileStore';
import { useGroupStore } from '../../stores/groupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { intColorToHex } from '../../utils/colorConverter';
import { ValueDetailModal } from './ValueDetailModal';
import './ValueTables.css';

const DEFAULT_COL_WIDTH = 140; // px — default width per file column
const DEFAULT_DESC_WIDTH = 220; // px — default description column width
const MIN_COL_WIDTH = 60;
const MIN_DESC_WIDTH = 100;

// ── Tooltip state type ──────────────────────────────────────
interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  lines: { label: string; value: string; color?: string }[];
}

export const ValueTables: React.FC = () => {
  const allFiles = useFileStore((s) => s.files);
  const groups = useGroupStore((s) => s.groups);
  const channelVisibility = useSettingsStore((s) => s.plotSettings.channelVisibility);
  const treeSelection = useSettingsStore((s) => s.treeSelection);

  // Filter files: only those in an active group (with visible channels) OR tree-selected
  const files = useMemo(() => {
    const activeGroups = groups.filter((g) => g.isActive);

    // Build a set of hidden channel keys from channelVisibility
    const hiddenKeys = new Set<string>();
    for (const cv of channelVisibility) {
      if (!cv.visible) {
        hiddenKeys.add(`${cv.groupId}|${cv.fileId}|${cv.channelId}`);
      }
    }

    // Files with at least one visible channel in an active group
    const visibleFileIds = new Set<string>();
    for (const group of activeGroups) {
      for (const ref of group.channels) {
        const key = `${group.id}|${ref.fileId}|${ref.channelId}`;
        if (!hiddenKeys.has(key)) {
          visibleFileIds.add(ref.fileId);
        }
      }
    }

    // Files with at least one tree-selected channel
    for (const selKey of treeSelection) {
      const fileId = selKey.split('::')[0];
      visibleFileIds.add(fileId);
    }

    if (visibleFileIds.size === 0) return []; // nothing grouped or selected → show nothing
    return allFiles.filter((f) => visibleFileIds.has(f.id));
  }, [allFiles, groups, channelVisibility, treeSelection]);

  const scrollRefSet = useRef<HTMLDivElement>(null);
  const scrollRefAct = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  // Filter state — one search term per table
  const [filterSet, setFilterSet] = useState('');
  const [filterAct, setFilterAct] = useState('');

  // Custom tooltip state
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, lines: [] });
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltip = useCallback((e: React.MouseEvent, lines: { label: string; value: string; color?: string }[]) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ visible: true, x: rect.left + rect.width / 2, y: rect.bottom + 6, lines });
  }, []);

  const hideTooltip = useCallback(() => {
    tooltipTimer.current = setTimeout(() => setTooltip(prev => ({ ...prev, visible: false })), 120);
  }, []);

  // Resizable column widths — per-file column widths
  const [descWidth, setDescWidth] = useState(DEFAULT_DESC_WIDTH);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  // Modal state for value detail (trend + histogram)
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    description: string;
    rowNumber: number;
    type: 'set' | 'actual';
  }>({ isOpen: false, description: '', rowNumber: 0, type: 'set' });

  const openDetailModal = useCallback(
    (desc: string, rowNum: number, tableType: 'set' | 'actual') => {
      setModalState({ isOpen: true, description: desc, rowNumber: rowNum, type: tableType });
    },
    [],
  );

  const closeDetailModal = useCallback(() => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Get width for a specific file column (fallback to default)
  const getColWidth = useCallback((fileId: string) => colWidths[fileId] ?? DEFAULT_COL_WIDTH, [colWidths]);

  // Drag-resize refs
  const resizeDrag = useRef<{
    type: 'desc' | 'col';
    fileId?: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, type: 'desc' | 'col', fileId?: string) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = type === 'desc' ? descWidth : (fileId ? getColWidth(fileId) : DEFAULT_COL_WIDTH);
      resizeDrag.current = { type, fileId, startX, startWidth };

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizeDrag.current) return;
        const delta = ev.clientX - resizeDrag.current.startX;
        const newW = Math.max(
          resizeDrag.current.type === 'desc' ? MIN_DESC_WIDTH : MIN_COL_WIDTH,
          resizeDrag.current.startWidth + delta,
        );
        if (resizeDrag.current.type === 'desc') {
          setDescWidth(newW);
        } else if (resizeDrag.current.fileId) {
          setColWidths((prev) => ({ ...prev, [resizeDrag.current!.fileId!]: newW }));
        }
      };

      const onMouseUp = () => {
        resizeDrag.current = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [descWidth, getColWidth],
  );

  // Synchronise horizontal scroll between Set and Actual tables
  const handleScroll = useCallback((source: 'set' | 'actual') => {
    if (isSyncing.current) return;
    isSyncing.current = true;

    const src = source === 'set' ? scrollRefSet.current : scrollRefAct.current;
    const tgt = source === 'set' ? scrollRefAct.current : scrollRefSet.current;
    if (src && tgt) {
      tgt.scrollLeft = src.scrollLeft;
    }

    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, []);

  if (allFiles.length === 0) {
    return (
      <div className="vt-empty">
        <div className="vt-empty-card">
          <span className="vt-empty-icon">📋</span>
          <span>Import data to see Set &amp; Actual Value tables</span>
        </div>
      </div>
    );
  }

  // Collect all descriptions (union across all files)
  // Filter out deactivated values (status === 1)
  const collectDescriptions = (type: 'set' | 'actual') => {
    const descriptions = new Map<number, string>();
    for (const file of files) {
      const values = type === 'set' ? file.setValues : file.actualValues;
      for (const v of values) {
        if (v.status === 256) continue; // skip deactivated
        descriptions.set(v.rowNumber, v.description);
      }
    }
    return Array.from(descriptions.entries()).sort((a, b) => a[0] - b[0]);
  };

  const setDescs = collectDescriptions('set');
  const actDescs = collectDescriptions('actual');

  // Apply text filter
  const filteredSetDescs = useMemo(() => {
    if (!filterSet.trim()) return setDescs;
    const q = filterSet.toLowerCase();
    return setDescs.filter(([, desc]) => desc.toLowerCase().includes(q));
  }, [setDescs, filterSet]);

  const filteredActDescs = useMemo(() => {
    if (!filterAct.trim()) return actDescs;
    const q = filterAct.toLowerCase();
    return actDescs.filter(([, desc]) => desc.toLowerCase().includes(q));
  }, [actDescs, filterAct]);

  // ── PDF Export: combined A4 with column pagination + repeating headers ──
  const handleExportCombinedPDF = useCallback(async () => {
    try {
      const { jsPDF } = await import('jspdf');

      // A4 landscape
      const pageW = 841.89; // pt
      const pageH = 595.28; // pt
      const margin = 30;
      const usableW = pageW - margin * 2;

      // Fixed column dimensions for readability
      const descW = 140; // pt — description column (always present)
      const colW = 52;   // pt — per data file column (fixed, readable)
      const headerH = 16;
      const minRowH = 12; // minimum row height; grows with wrapped text
      const lineH = 7;    // line height for wrapped text
      const titleH = 20;
      const footerH = 18;
      const fontSize = 6;

      // How many file columns fit on one page (alongside the description column)?
      const maxColsPerPage = Math.floor((usableW - descW) / colW);
      const nFiles = files.length;
      // Split file indices into column "chunks"
      const colChunks: number[][] = [];
      for (let start = 0; start < nFiles; start += maxColsPerPage) {
        colChunks.push(
          Array.from({ length: Math.min(maxColsPerPage, nFiles - start) }, (_, i) => start + i)
        );
      }

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      let pageStarted = false; // track whether we need addPage

      /** Draw a column-header row for given file indices — with text wrapping */
      const drawColumnHeader = (y: number, sectionTitle: string, fileIndices: number[], chunkIdx: number, totalChunks: number): number => {
        // Section title
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(40);
        const titleSuffix = totalChunks > 1 ? ` (Spalten ${chunkIdx + 1}/${totalChunks})` : '';
        pdf.text(sectionTitle + titleSuffix, margin, y + 12);
        y += titleH;

        const tblW = descW + fileIndices.length * colW;

        // Calculate header height based on longest wrapped column name
        pdf.setFontSize(fontSize);
        pdf.setFont('helvetica', 'bold');
        let maxHeaderLines = 1;
        const headerWrapped: string[][] = [];
        for (let ci = 0; ci < fileIndices.length; ci++) {
          const fi = fileIndices[ci];
          const label = files[fi].header.idString || files[fi].filename;
          const lines = pdf.splitTextToSize(label, colW - 4) as string[];
          headerWrapped.push(lines);
          maxHeaderLines = Math.max(maxHeaderLines, lines.length);
        }
        const dynamicHeaderH = Math.max(headerH, maxHeaderLines * lineH + 5);

        // Header background
        pdf.setFillColor(235, 237, 242);
        pdf.rect(margin, y, tblW, dynamicHeaderH, 'F');
        pdf.setDrawColor(190);
        pdf.line(margin, y + dynamicHeaderH, margin + tblW, y + dynamicHeaderH);

        // Description header
        pdf.setFontSize(fontSize);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(90);
        pdf.text('Beschreibung', margin + 3, y + 11);

        // File column headers — wrapped
        for (let ci = 0; ci < fileIndices.length; ci++) {
          const x = margin + descW + ci * colW;
          pdf.setDrawColor(210);
          pdf.line(x, y, x, y + dynamicHeaderH);
          pdf.setTextColor(60);
          pdf.setFontSize(fontSize);
          const lines = headerWrapped[ci];
          for (let li = 0; li < lines.length; li++) {
            pdf.text(lines[li], x + 2, y + 9 + li * lineH);
          }
        }

        return y + dynamicHeaderH;
      };

      /** Draw rows for one section + one column chunk. Returns final y. */
      const drawSectionChunk = (
        descriptions: [number, string][],
        type: 'set' | 'actual',
        sectionTitle: string,
        fileIndices: number[],
        chunkIdx: number,
        totalChunks: number,
        startY: number,
      ): number => {
        let y = drawColumnHeader(startY, sectionTitle, fileIndices, chunkIdx, totalChunks);
        const tblW = descW + fileIndices.length * colW;
        let rowIdx = 0;

        for (const [rowNum, desc] of descriptions) {
          // Calculate dynamic row height based on text wrapping
          pdf.setFontSize(fontSize);
          pdf.setFont('helvetica', 'normal');
          const descLines = pdf.splitTextToSize(desc, descW - 6) as string[];
          let maxLines = descLines.length;

          // Also check value cells for wrapping
          const valLineArrays: (string[] | null)[] = [];
          for (let ci = 0; ci < fileIndices.length; ci++) {
            const fi = fileIndices[ci];
            const values = type === 'set' ? files[fi].setValues : files[fi].actualValues;
            const value = values.find((v) => v.rowNumber === rowNum);
            if (value) {
              const valText = `${value.value}${value.unit ? ' ' + value.unit : ''}`;
              const valLines = pdf.splitTextToSize(valText, colW - 6) as string[];
              valLineArrays.push(valLines);
              maxLines = Math.max(maxLines, valLines.length);
            } else {
              valLineArrays.push(null);
            }
          }

          const rowH = Math.max(minRowH, maxLines * lineH + 4);

          // Page break — repeat header
          if (y + rowH > pageH - margin - footerH) {
            pdf.addPage();
            y = margin;
            y = drawColumnHeader(y, sectionTitle + ' (Forts.)', fileIndices, chunkIdx, totalChunks);
          }

          // Zebra stripe
          if (rowIdx % 2 === 0) {
            pdf.setFillColor(248, 248, 252);
            pdf.rect(margin, y, tblW, rowH, 'F');
          }

          // Row border
          pdf.setDrawColor(230);
          pdf.line(margin, y + rowH, margin + tblW, y + rowH);

          // Description cell — wrapped
          pdf.setFontSize(fontSize);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(40);
          for (let li = 0; li < descLines.length; li++) {
            pdf.text(descLines[li], margin + 3, y + 9 + li * lineH);
          }

          // Data cells for this chunk
          for (let ci = 0; ci < fileIndices.length; ci++) {
            const fi = fileIndices[ci];
            const values = type === 'set' ? files[fi].setValues : files[fi].actualValues;
            const value = values.find((v) => v.rowNumber === rowNum);
            const cellX = margin + descW + ci * colW;

            // Separator
            pdf.setDrawColor(225);
            pdf.line(cellX, y, cellX, y + rowH);

            if (!value) continue;

            // Cell background
            const bg = intColorToHex(value.backColorValue);
            if (bg && bg !== '#ffffff') {
              const r = parseInt(bg.slice(1, 3), 16);
              const g = parseInt(bg.slice(3, 5), 16);
              const b = parseInt(bg.slice(5, 7), 16);
              pdf.setFillColor(r, g, b);
              pdf.rect(cellX, y, colW, rowH, 'F');
            }

            // Text color
            const tc = intColorToHex(value.textColorValue);
            if (tc) {
              const r = parseInt(tc.slice(1, 3), 16);
              const g = parseInt(tc.slice(3, 5), 16);
              const b = parseInt(tc.slice(5, 7), 16);
              pdf.setTextColor(r, g, b);
            } else {
              pdf.setTextColor(40);
            }

            // Value text — wrapped, right-aligned
            pdf.setFontSize(fontSize);
            const valLines = valLineArrays[ci];
            if (valLines) {
              for (let li = 0; li < valLines.length; li++) {
                pdf.text(valLines[li], cellX + colW - 3, y + 9 + li * lineH, { align: 'right' });
              }
            }
          }

          y += rowH;
          rowIdx++;
        }

        return y;
      };

      // ── Render all column chunks for SET VALUES ──
      for (let ci = 0; ci < colChunks.length; ci++) {
        if (pageStarted) pdf.addPage();
        pageStarted = true;
        drawSectionChunk(setDescs, 'set', 'SET VALUES', colChunks[ci], ci, colChunks.length, margin);
      }

      // ── Render all column chunks for ACTUAL VALUES ──
      for (let ci = 0; ci < colChunks.length; ci++) {
        pdf.addPage();
        drawSectionChunk(actDescs, 'actual', 'ACTUAL VALUES', colChunks[ci], ci, colChunks.length, margin);
      }

      // Footer on all pages
      const pageCount = pdf.getNumberOfPages();
      for (let p = 1; p <= pageCount; p++) {
        pdf.setPage(p);
        pdf.setFontSize(6.5);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(150);
        pdf.text(`Set & Actual Values — Seite ${p} / ${pageCount}`, margin, pageH - 10);
        pdf.text(new Date().toLocaleDateString('de-DE'), pageW - margin, pageH - 10, { align: 'right' });
      }

      pdf.save('Set_Actual_Values-Export.pdf');
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('PDF export failed.');
    }
  }, [files, setDescs, actDescs]);

  const renderTable = (
    type: 'set' | 'actual',
    sortedDescriptions: [number, string][],
    scrollRef: React.RefObject<HTMLDivElement | null>,
    filterValue: string,
    onFilterChange: (v: string) => void,
    totalCount: number,
  ) => {
    const totalDataWidth = files.reduce((sum, f) => sum + getColWidth(f.id), 0);
    return (
      <div className="vt-panel">
        {/* Title bar */}
        <div className={`vt-title ${type === 'set' ? 'vt-title-set' : 'vt-title-act'}`}>
          <span className="vt-title-icon">{type === 'set' ? '⚙' : '📊'}</span>
          <span className="vt-title-text">
            {type === 'set' ? 'SET VALUES' : 'ACTUAL VALUES'}
          </span>
          <span className="vt-title-badge">
            {filterValue ? `${sortedDescriptions.length}/${totalCount}` : totalCount}
          </span>
        </div>

        {/* Filter input */}
        <div className="vt-filter-bar">
          <span className="vt-filter-icon">🔍</span>
          <input
            className="vt-filter-input"
            type="text"
            placeholder="Beschreibung suchen…"
            value={filterValue}
            onChange={(e) => onFilterChange(e.target.value)}
          />
          {filterValue && (
            <button className="vt-filter-clear" onClick={() => onFilterChange('')} title="Filter löschen">
              ✕
            </button>
          )}
        </div>

        {/* Scrollable table */}
        <div
          className="vt-scroll"
          ref={scrollRef}
          onScroll={() => handleScroll(type)}
        >
          <div className="vt-table" style={{ minWidth: descWidth + totalDataWidth }}>
            {/* Header row */}
            <div className="vt-header-row">
              <div className="vt-desc-header" style={{ width: descWidth, minWidth: descWidth }}>
                Description
                <div
                  className="vt-resize-handle"
                  onMouseDown={(e) => handleResizeMouseDown(e, 'desc')}
                />
              </div>
              {files.map((file) => {
                const isNOK = file.header.isMarked;
                const w = getColWidth(file.id);
                const h = file.header;
                const headerLines: { label: string; value: string; color?: string }[] = [
                  ...(h.idString ? [{ label: 'ID', value: h.idString }] : []),
                  ...(h.machineDesc ? [{ label: 'Maschine', value: `${h.machineDesc}${h.machineShortDesc ? ` (${h.machineShortDesc})` : ''}` }] : []),
                  ...(h.moduleDesc ? [{ label: 'Modul', value: `${h.moduleDesc}${h.moduleShortDesc ? ` (${h.moduleShortDesc})` : ''}` }] : []),
                  ...(h.nameOfMeasurePoint ? [{ label: 'Messpunkt', value: h.nameOfMeasurePoint }] : []),
                  ...(h.diagramTitle ? [{ label: 'Titel', value: h.diagramTitle }] : []),
                  ...(h.date ? [{ label: 'Datum', value: h.date }] : []),
                  ...((h.type || h.variant) ? [{ label: 'Typ/Variante', value: `${h.type || '–'} / ${h.variant || '–'}` }] : []),
                  { label: 'Status', value: isNOK ? 'NOK' : 'OK', color: isNOK ? 'var(--danger)' : 'var(--success-text)' },
                ];
                return (
                  <div
                    key={file.id}
                    className={`vt-file-header ${isNOK ? 'vt-nok-header' : 'vt-ok-header'}`}
                    style={{ width: w, minWidth: w }}
                    onMouseEnter={(e) => showTooltip(e, headerLines)}
                    onMouseLeave={hideTooltip}
                  >
                    {file.header.idString || file.filename}
                    <div
                      className="vt-resize-handle"
                      onMouseDown={(e) => handleResizeMouseDown(e, 'col', file.id)}
                    />
                  </div>
                );
              })}
            </div>

            {/* Body rows */}
            {sortedDescriptions.map(([rowNum, desc]) => (
              <div key={rowNum} className="vt-row">
                <div
                  className="vt-desc-cell vt-desc-clickable"
                  style={{ width: descWidth, minWidth: descWidth }}
                  onClick={() => openDetailModal(desc, rowNum, type)}
                >
                  {desc}
                </div>
                {files.map((file) => {
                  const values = type === 'set' ? file.setValues : file.actualValues;
                  const value = values.find((v) => v.rowNumber === rowNum);
                  const w = getColWidth(file.id);

                  if (!value) {
                    return (
                      <div
                        key={file.id}
                        className="vt-data-cell vt-empty-cell"
                        style={{ width: w, minWidth: w }}
                      >
                        —
                      </div>
                    );
                  }

                  const bgColor = intColorToHex(value.backColorValue);
                  const textColor = intColorToHex(value.textColorValue);
                  // NOK if individual value status >= 502
                  const isNOK = value.status >= 502;

                  return (
                    <div
                      key={file.id}
                      className={`vt-data-cell ${isNOK ? 'vt-nok' : ''}`}
                      style={{ backgroundColor: bgColor, color: textColor, width: w, minWidth: w }}
                    >
                      <span className="vt-val">{value.value}</span>
                      {value.unit && <span className="vt-unit">{value.unit}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="vt-root">
      <div className="vt-toolbar">
        <button
          className="vt-export-combined-btn"
          onClick={handleExportCombinedPDF}
          title="Set & Actual Values als A4 PDF exportieren (mit Seitenumbrüchen)"
        >
          📄 PDF Export (Set + Actual)
        </button>
      </div>
      <div className="vt-panels">
        {renderTable('set', filteredSetDescs, scrollRefSet, filterSet, setFilterSet, setDescs.length)}
        <div className="vt-divider" />
        {renderTable('actual', filteredActDescs, scrollRefAct, filterAct, setFilterAct, actDescs.length)}
      </div>

      {/* Value Detail Modal (Trend + Histogram) */}
      <ValueDetailModal
        isOpen={modalState.isOpen}
        onClose={closeDetailModal}
        description={modalState.description}
        rowNumber={modalState.rowNumber}
        type={modalState.type}
        files={files}
      />

      {/* Custom modern tooltip */}
      {tooltip.visible && (
        <div
          className="vt-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          onMouseEnter={() => { if (tooltipTimer.current) clearTimeout(tooltipTimer.current); }}
          onMouseLeave={hideTooltip}
        >
          {tooltip.lines.map((line, i) => (
            <div key={i} className="vt-tooltip-row">
              <span className="vt-tooltip-label">{line.label}</span>
              <span className="vt-tooltip-value" style={line.color ? { color: line.color, fontWeight: 700 } : undefined}>
                {line.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
