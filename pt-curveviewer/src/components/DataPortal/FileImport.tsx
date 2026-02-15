// ============================================================
// File Import Component - Drag & Drop + File/Folder picker
// ============================================================

import React, { useCallback, useRef, useState } from 'react';
import { useFileStore } from '../../stores/fileStore';
import { processFiles, captureDroppedFiles, captureDroppedEntries, readFilesFromEntries, hasDirectoryEntries, isElectron, getDroppedPaths, processDroppedPaths } from '../../services/fileImporter';
import { parseXmlString } from '../../services/xmlParser';
import type { ImportProgress } from '../../services/fileImporter';
import './FileImport.css';

export const FileImport: React.FC = () => {
  const addFiles = useFileStore((s) => s.addFiles);
  const setLoading = useFileStore((s) => s.setLoading);
  const setProgress = useFileStore((s) => s.setProgress);
  const isLoading = useFileStore((s) => s.isLoading);
  const loadingProgress = useFileStore((s) => s.loadingProgress);
  const progressCurrent = useFileStore((s) => s.progressCurrent);
  const progressTotal = useFileStore((s) => s.progressTotal);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onProgress = useCallback(
    (p: ImportProgress) => {
      setProgress(p.current, p.total, `${p.current} / ${p.total}  —  ${p.filename}`);
    },
    [setProgress],
  );

  const handleCancelImport = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false, 'Import cancelled');
    setTimeout(() => setLoading(false, ''), 2500);
  }, [setLoading]);

  const handleFilesSelected = useCallback(
    async (files: FileList | File[]) => {
      const ac = new AbortController();
      abortRef.current = ac;
      const total = files instanceof FileList ? files.length : files.length;
      setLoading(true, `0 / ${total}`);
      setProgress(0, total);
      try {
        const imported = await processFiles(files, onProgress, ac.signal, addFiles);
        if (ac.signal.aborted) return;
        setLoading(false, `${imported.length} file(s) imported`);
        setTimeout(() => setLoading(false, ''), 2500);
      } catch (err) {
        if (ac.signal.aborted) return;
        console.error('[FileImport] handleFilesSelected error:', err);
        setLoading(false, 'Import error');
      } finally {
        abortRef.current = null;
      }
    },
    [addFiles, setLoading, setProgress, onProgress],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFilesSelected(e.target.files);
      }
      e.target.value = '';
    },
    [handleFilesSelected],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const ac = new AbortController();
      abortRef.current = ac;

      // ── Electron path: use Node.js fs via IPC (supports folders natively) ──
      if (isElectron()) {
        const paths = getDroppedPaths(e.dataTransfer);
        console.log('[FileImport] Electron drop:', paths.length, 'path(s)');

        if (paths.length === 0) {
          setLoading(false, 'No files dropped');
          setTimeout(() => setLoading(false, ''), 2500);
          return;
        }

        setLoading(true, 'Scanning…');
        try {
          const imported = await processDroppedPaths(paths, onProgress, ac.signal, addFiles);
          if (ac.signal.aborted) return;
          setLoading(false, `${imported.length} file(s) imported`);
          setTimeout(() => setLoading(false, ''), 2500);
        } catch (err) {
          if (ac.signal.aborted) return;
          console.error('[FileImport] Electron drop error:', err);
          setLoading(false, 'Import error');
        } finally {
          abortRef.current = null;
        }
        return;
      }

      // ── Browser path: use DataTransfer APIs ──
      // IMPORTANT: Capture SYNCHRONOUSLY before any async work.
      // Chrome clears DataTransfer after the event handler returns.

      // 1. Try the Entry API first — this supports folders (directories)
      //    (returns null on file:// origin where Entry API is broken)
      const entries = captureDroppedEntries(e.dataTransfer);
      // 2. Check if directories were dropped (for user feedback on file://)
      const droppedFolders = hasDirectoryEntries(e.dataTransfer);
      // 3. Also capture flat files as fallback
      const flatFiles = captureDroppedFiles(e.dataTransfer);

      let files: File[];

      if (entries && entries.length > 0) {
        // Traverse directories asynchronously to collect all xml/zpg files
        setLoading(true, 'Scanning folders…');
        try {
          files = await readFilesFromEntries(entries);
          console.log('[FileImport] Entry API found', files.length, 'file(s) from', entries.length, 'entries');
        } catch (err) {
          console.warn('[FileImport] Entry API traversal failed, falling back to flat files', err);
          files = flatFiles;
        }
      } else {
        files = flatFiles;
        console.log('[FileImport] Drop captured', files.length, 'file(s)', droppedFolders ? '(folders detected but Entry API unavailable)' : '');
      }

      // If folders were dropped but we couldn't read them (file:// origin),
      // guide the user to use the folder picker button instead.
      if (files.length === 0 && droppedFolders) {
        setLoading(false, 'Ordner-Drop auf file:// nicht möglich — bitte den 📂-Button verwenden');
        setTimeout(() => setLoading(false, ''), 4000);
        return;
      }

      if (files.length === 0) {
        setLoading(false, 'No XML/ZPG files found');
        setTimeout(() => setLoading(false, ''), 2500);
        return;
      }

      setLoading(true, `0 / ${files.length}`);
      setProgress(0, files.length);
      try {
        const imported = await processFiles(files, onProgress, ac.signal, addFiles);
        if (ac.signal.aborted) return;
        setLoading(false, `${imported.length} file(s) imported`);
        setTimeout(() => setLoading(false, ''), 2500);
      } catch (err) {
        if (ac.signal.aborted) return;
        console.error('[FileImport] handleDrop error:', err);
        setLoading(false, 'Import error');
      } finally {
        abortRef.current = null;
        // Safety net: always clear loading after a short delay
        setTimeout(() => { if (abortRef.current === null) setLoading(false, ''); }, 5000);
      }
    },
    [addFiles, setLoading, setProgress, onProgress],
  );

  const handleLoadSample = useCallback(async () => {
    setLoading(true, 'Loading sample file…');
    setProgress(0, 1);
    try {
      // Use relative path for portability (works with both http and file:// origins)
      const resp = await fetch('./sample.xml');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const xmlString = await resp.text();
      const imported = parseXmlString(xmlString, 'sample.xml');
      addFiles([imported]);
      setProgress(1, 1);
      setLoading(false, '1 sample file imported');
      setTimeout(() => setLoading(false, ''), 2500);
    } catch (err) {
      console.error('[FileImport] Sample load error:', err);
      setLoading(false, 'Loading error — sample.xml not found');
    }
  }, [addFiles, setLoading, setProgress]);

  const pct = progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0;

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  return (
    <div className="file-import">
      {/* Drop Zone */}
      <div
        className={`drop-zone ${isDragOver ? 'drag-over' : ''} ${isLoading ? 'loading' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div className="drop-zone-content">
          {isLoading ? (
            <div className="import-progress">
              <div className="progress-header">
                <div className="spinner" />
                <span className="progress-text">{loadingProgress}</span>
                <button className="cancel-btn" onClick={handleCancelImport} title="Cancel import">✕ Cancel</button>
              </div>
              {progressTotal > 0 && (
                <div className="progress-bar-wrap">
                  <div className="progress-bar" style={{ width: `${pct}%` }} />
                </div>
              )}
              {progressTotal > 0 && (
                <span className="progress-pct">{pct}%</span>
              )}
            </div>
          ) : (
            <>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              <span className="drop-text">
                Drop XML / ZPG files or folders here
              </span>
              <div className="button-row">
                <button
                  className="import-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Files
                </button>
                <button
                  className="import-btn"
                  onClick={() => folderInputRef.current?.click()}
                >
                  Folder
                </button>
                <button
                  className="import-btn sample-btn"
                  onClick={handleLoadSample}
                >
                  Load Sample
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".xml,.zpg"
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is not in types
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />
    </div>
  );
};
