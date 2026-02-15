// ============================================================
// Main App Layout - Tab-based navigation
// ============================================================

import React, { useState, useCallback, useEffect, useRef, Suspense, lazy } from 'react';
import { useSettingsStore } from './stores/settingsStore';
import { useFileStore } from './stores/fileStore';
import { isElectron, getDroppedPaths, processDroppedPaths, captureDroppedEntries, captureDroppedFiles, readFilesFromEntries, hasDirectoryEntries, processFiles } from './services/fileImporter';
import type { ImportProgress } from './services/fileImporter';
import './App.css';

// Lazy load to isolate import errors
const DataPortal = lazy(() =>
  import('./components/DataPortal/DataPortal').then((m) => ({ default: m.DataPortal }))
);
const CurvePlot = lazy(() =>
  import('./components/CurvePlot/CurvePlot').then((m) => ({ default: m.CurvePlot }))
);
const ValueTables = lazy(() =>
  import('./components/ValueTables/ValueTables').then((m) => ({ default: m.ValueTables }))
);

// ── Progress Bar ─────────────────────────────────────────────
const ProgressBar: React.FC = () => (
  <div className="progress-bar-track">
    <div className="progress-bar-fill" />
  </div>
);

// ── Suspense wrapper that shows ProgressBar ──────────────────
const TabSuspense: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={<ProgressBar />}>
    {children}
  </Suspense>
);

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ color: 'var(--danger)', padding: 20, fontFamily: 'monospace', background: 'var(--bg-primary)', height: '100vh' }}>
          <h2>Runtime Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--text-tertiary)' }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

type TabType = 'portal' | 'plot' | 'tables';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('portal');
  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const setStoreActiveTab = useSettingsStore((s) => s.setActiveTab);

  // Track which tabs have been visited (lazy-mount on first visit, then keep alive)
  const [mounted, setMounted] = useState<Set<TabType>>(() => new Set(['portal']));

  // Loading state: brief progress bar when switching to a not-yet-mounted tab
  const [loading, setLoading] = useState(false);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const switchTab = useCallback((tab: TabType) => {
    if (tab === activeTab) return;
    const isNew = !mounted.has(tab);
    if (isNew) {
      setLoading(true);
      setMounted((prev) => new Set(prev).add(tab));
    }
    setActiveTab(tab);
    setStoreActiveTab(tab);
    // Clear loading after a short delay to allow Suspense to resolve
    if (isNew) {
      if (loadingTimer.current) clearTimeout(loadingTimer.current);
      loadingTimer.current = setTimeout(() => setLoading(false), 100);
    }
  }, [activeTab, mounted]);

  useEffect(() => {
    return () => { if (loadingTimer.current) clearTimeout(loadingTimer.current); };
  }, []);

  // Auto-switch to Data Portal tab when dragging files into the app window
  // AND make the entire window a valid drop target so no data is lost
  const addFiles = useFileStore((s) => s.addFiles);
  const setImportLoading = useFileStore((s) => s.setLoading);
  const setImportProgress = useFileStore((s) => s.setProgress);
  const globalAbortRef = useRef<AbortController | null>(null);

  const onImportProgress = useCallback(
    (p: ImportProgress) => {
      setImportProgress(p.current, p.total, `${p.current} / ${p.total}  —  ${p.filename}`);
    },
    [setImportProgress],
  );

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        switchTab('portal');
      }
    };
    // CRITICAL: prevent default on dragover so the entire window is a valid drop target.
    // Without this, Chrome/Electron invalidates the DataTransfer during dragging.
    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
      }
    };
    // Global drop handler: catches drops anywhere in the window
    // (the FileImport drop zone also handles drops, but only when the drop lands on it)
    const handleGlobalDrop = async (e: DragEvent) => {
      // If a component (like FileImport's drop zone) already handled this, skip
      if (e.defaultPrevented) return;
      if (!e.dataTransfer?.types?.includes('Files')) return;

      e.preventDefault();

      const ac = new AbortController();
      globalAbortRef.current = ac;

      if (isElectron()) {
        const paths = getDroppedPaths(e.dataTransfer);
        if (paths.length === 0) return;

        setImportLoading(true, 'Scanning…');
        try {
          const imported = await processDroppedPaths(paths, onImportProgress, ac.signal, addFiles);
          if (ac.signal.aborted) return;
          setImportLoading(false, `${imported.length} file(s) imported`);
          setTimeout(() => setImportLoading(false, ''), 2500);
        } catch (err) {
          if (ac.signal.aborted) return;
          console.error('[App] Global drop error:', err);
          setImportLoading(false, 'Import error');
        } finally {
          globalAbortRef.current = null;
        }
        return;
      }

      // Browser path
      const entries = captureDroppedEntries(e.dataTransfer);
      const droppedFolders = hasDirectoryEntries(e.dataTransfer);
      const flatFiles = captureDroppedFiles(e.dataTransfer);

      let files: File[];
      if (entries && entries.length > 0) {
        setImportLoading(true, 'Scanning folders…');
        try {
          files = await readFilesFromEntries(entries);
        } catch {
          files = flatFiles;
        }
      } else {
        files = flatFiles;
      }

      if (files.length === 0 && droppedFolders) {
        setImportLoading(false, 'Ordner-Drop auf file:// nicht möglich — bitte den 📂-Button verwenden');
        setTimeout(() => setImportLoading(false, ''), 4000);
        return;
      }
      if (files.length === 0) return;

      setImportLoading(true, `0 / ${files.length}`);
      setImportProgress(0, files.length);
      try {
        const imported = await processFiles(files, onImportProgress, ac.signal, addFiles);
        if (ac.signal.aborted) return;
        setImportLoading(false, `${imported.length} file(s) imported`);
        setTimeout(() => setImportLoading(false, ''), 2500);
      } catch (err) {
        if (ac.signal.aborted) return;
        console.error('[App] Global drop error:', err);
        setImportLoading(false, 'Import error');
      } finally {
        globalAbortRef.current = null;
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleGlobalDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleGlobalDrop);
    };
  }, [switchTab, addFiles, setImportLoading, setImportProgress, onImportProgress]);

  return (
    <ErrorBoundary>
      <div className="app">
        {/* Global progress bar */}
        {loading && <ProgressBar />}

        <div className="tab-bar">
          <div className="tab-bar-left">
            <span className="app-title">PT CurveViewer Gen2</span>
          </div>
          <div className="tab-bar-tabs">
            <button
              className={`tab ${activeTab === 'portal' ? 'active' : ''}`}
              onClick={() => switchTab('portal')}
            >
              Data Portal
            </button>
            <button
              className={`tab ${activeTab === 'plot' ? 'active' : ''}`}
              onClick={() => switchTab('plot')}
            >
              CurvePlot
            </button>
            <button
              className={`tab ${activeTab === 'tables' ? 'active' : ''}`}
              onClick={() => switchTab('tables')}
            >
              Value Tables
            </button>
          </div>
          <div className="tab-bar-spacer" />
          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>

        <div className="tab-content">
          {/* All visited tabs stay mounted — CSS hides inactive ones (no re-init) */}
          <div className="tab-pane" style={{ display: activeTab === 'portal' ? 'flex' : 'none' }}>
            <TabSuspense><DataPortal /></TabSuspense>
          </div>
          {mounted.has('plot') && (
            <div className="tab-pane" style={{ display: activeTab === 'plot' ? 'flex' : 'none' }}>
              <TabSuspense><CurvePlot /></TabSuspense>
            </div>
          )}
          {mounted.has('tables') && (
            <div className="tab-pane" style={{ display: activeTab === 'tables' ? 'flex' : 'none' }}>
              <TabSuspense><ValueTables /></TabSuspense>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default App;
